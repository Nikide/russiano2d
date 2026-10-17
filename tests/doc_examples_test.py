#!/usr/bin/env python3
# ===========================================================================
# Гейт «пути из примеров документации существуют» (долг Д2).
#
# Зачем: за сессию шесть раз ловили один класс — «дока обещает, код не
# делает»: `$.audio.room.define`, `$.fx.fade`, `$.inv.value()`,
# `$.world.bsp.order()` без дерева и т.п. Находили руками. Гейт вытаскивает
# из ```js-блоков `docs/highlevel/*.md` все публичные пути `$.a.b.c` и
# проверяет, что каждый существует в ЖИВОМ движке.
#
# Почему проверка статическая, а не «выполнить примеры»: примеры зависят от
# состояния игры (ассеты, узлы, слоты сейва), и последовательный прогон в
# одном движке даёт ложные падения на перекрёстном состоянии. Исполнение
# примеров — отдельный инструмент-прототип (2026-10-17: 475 блоков, 423
# запускаются, 53 падения — почти все фрагменты/контекст); он уже нашёл и
# закрыл SIGSEGV `$.world.bsp.order` до build и ложные имена в
# acoustics.md/alive.md, но стабильным гейтом быть не может. Здесь — то, что
# можно требовать от каждого примера всегда: имена существуют.
#
# Исключения — `tests/doc_examples_allowlist.txt`: строка
#     $.story.flags.* — причина
# Паттерн `*` в конце — «динамический контейнер» (ключи создаёт игра, а не
# движок). Строка без причины не принимается; мёртвая строка — провал.
#
# Запуск:
#   python3 tests/doc_examples_test.py
#   python3 tests/doc_examples_test.py --list
# ===========================================================================

import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from agent_client import Agent   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs", "highlevel")
ALLOWLIST = os.path.join(ROOT, "tests", "doc_examples_allowlist.txt")
GAME = os.path.join("tests", "fixtures", "hello")
FAILURES = []

#: Пути, которые не являются публичным контрактом движка:
#: `$.ctx.*` — внутренности контекста, `$.fn.*` — методы узлов (проверяются
#: гейтом обёрток), `$.xxx` — плейсхолдер в _CONTRACT.md.
SKIP_PREFIXES = ("$.ctx.", "$.fn.", "$._")

PATH_RE = re.compile(r"\$\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)")


def strip_literals(code):
    code = re.sub(r"//[^\n]*", "", code)
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.S)
    code = re.sub(r"`(?:\\.|[^`\\])*`", "``", code, flags=re.S)
    code = re.sub(r"'(?:\\.|[^'\\])*'", "''", code)
    code = re.sub(r'"(?:\\.|[^"\\])*"', '""', code)
    return code


def paths_from_docs():
    """Уникальные `$.a.b` из js-блоков: путь → [файл:строка, …]."""
    found = {}
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith(".md"):
            continue
        text = open(os.path.join(DOCS, name), encoding="utf-8").read()
        for match in re.finditer(r"```js\n(.*?)```", text, re.S):
            line = text[:match.start()].count("\n") + 1
            code = strip_literals(match.group(1))
            for raw in PATH_RE.findall(code):
                path = "$." + raw
                found.setdefault(path, set()).add("%s:%d" % (name, line))
    return found


def read_allowlist():
    rules = []
    if not os.path.isfile(ALLOWLIST):
        return rules
    with open(ALLOWLIST, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            pattern, _, reason = line.partition("—")
            rules.append((pattern.strip(), reason.strip()))
    return rules


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def matches(path, pattern):
    if pattern.endswith("*"):
        return path.startswith(pattern[:-1])
    return path == pattern


def main():
    list_only = "--list" in sys.argv[1:]
    paths = paths_from_docs()
    check(len(paths) > 500,
          "примеров достаточно, чтобы гейт был не пустым: уникальных путей %d" % len(paths))

    rules = read_allowlist()
    for pattern, reason in rules:
        check(bool(reason), "у исключения %r есть причина" % pattern)
        used = any(matches(p, pattern) for p in paths)
        check(used, "исключение %r что-то покрывает (не мёртвое)" % pattern)

    checked = []
    for path in sorted(paths):
        if path.startswith(SKIP_PREFIXES):
            continue
        if any(matches(path, pattern) for pattern, _ in rules):
            continue
        checked.append(path)

    if list_only:
        for path in checked:
            print(path + "   " + ", ".join(sorted(paths[path])[:2]))
        print("путей: %d (проверяются: %d, исключено правилами: %d)"
              % (len(paths), len(checked), len(paths) - len(checked)))
        return 0

    with Agent(game=GAME, seed=1) as a:
        a.step(2)
        missing = a.eval(
            "(() => { const out = [];"
            " for (const p of %s) {"
            "   let o = $; let ok = true;"
            "   for (const k of p) {"
            "     if (o === undefined || o === null) { ok = false; break; }"
            "     o = o[k];"
            "   }"
            "   if (!ok || o === undefined) out.push(p.join('.'));"
            " } return out; })()"
            % json.dumps([[segment for segment in path.split(".")[1:]] for path in checked]))

    missing = set(missing or [])
    for path in sorted(missing):
        where = ", ".join(sorted(paths.get(path, set()))[:2])
        check(False, "путь из примера не существует: %s (%s)" % (path, where))
    check(not missing, "все публичные пути из js-примеров существуют (%d шт.)" % len(checked))

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены: %d путей из docs/highlevel/*.md" % len(checked))
    return 0


if __name__ == "__main__":
    sys.exit(main())
