#!/usr/bin/env python3
# ===========================================================================
# Гейт «публичные методы обёрток» (долг Д1 из docs/NEXT_SESSION.md).
#
# Причина: `api_freeze` снимает только имена `$.` и их методы. Объекты,
# которые `$` ОТДАЁТ вызовом (`$.ui.doc(path)`), в снимок не попадали — так
# `$.ui.doc().layoutRect` появился в публичном API и прошёл мимо заморозки.
#
# Здесь — отдельный гейт, а не расширение api_freeze: снимок обёрток не
# зависит от версии ядра и не раздувает общий счёт имён. Список проб
# ЯВНЫЙ (whitelist): «обойти всё, что $ вернул» невозможно — обёртки бывают
# состоянием мира, а не контрактом.
#
#   python3 tests/api_wrapper_methods_test.py          # проверить
#   python3 tests/api_wrapper_methods_test.py --write  # обновить снимок осознанно
#
# Запуск без движка не работает: обёртки строятся в живом `$`.
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from agent_client import Agent   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, "tests", "api_wrapper_methods_baseline.txt")
GAME = os.path.join("tests", "fixtures", "uiclick")
FAILURES = []

#: Явный список проб: (выражение, подпись в снимке).
#: Новая обёртка попадает сюда только осознанно — вместе с документом.
PROBES = [
    ("$.ui.doc('tests/fixtures/uiclick/ui/p.rml')", "$.ui.doc()"),
    ("$.scene.scope('__probe__')", "$.scene.scope()"),
]


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def snapshot(a):
    names = []
    for expression, label in PROBES:
        # Обёртка живёт внутри движка; ключи собираем одним eval.
        result = a.eval(
            "(() => { const o = " + expression + ";"
            " if (!o || typeof o !== 'object') return null;"
            " const out = []; for (const k of Object.keys(o).sort()) {"
            "   if (typeof o[k] === 'function') out.push(k); } return out; })()")
        if result is None:
            print(f"  FAIL проба {label}: объект не получен ({expression})")
            FAILURES.append(label)
            continue
        for name in result:
            names.append(f"{label}.{name}")
    return names


def read_baseline():
    if not os.path.isfile(BASELINE):
        return []
    out = []
    with open(BASELINE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                out.append(line)
    return out


def write_baseline(names):
    with open(BASELINE, "w", encoding="utf-8") as f:
        f.write("# Методы обёрток, которые $ отдаёт вызовом (гейт api_wrapper_methods_test.py).\n")
        f.write("# Обновление: python3 tests/api_wrapper_methods_test.py --write\n")
        for name in names:
            f.write(name + "\n")


def main():
    write = "--write" in sys.argv[1:]
    with Agent(game=GAME, seed=1) as a:
        a.step(2)
        names = snapshot(a)
        if not names:
            print("ПРОВАЛ: ни одна проба не дала методов — движок не поднялся?")
            return 1
        if write:
            write_baseline(names)
            print(f"снимок обновлён: {len(names)} методов в {os.path.relpath(BASELINE, ROOT)}")
            return 0

        baseline = read_baseline()
        added = [n for n in names if n not in baseline]
        removed = [n for n in baseline if n not in names]
        check(not added, f"нет незамороженных методов обёрток (добавлено: {added})")
        check(not removed, f"нет пропавших методов обёрток (удалено: {removed})")
        check(len(names) == len(baseline),
              f"снимок совпал по числу: {len(names)} / {len(baseline)}")

        # Сама дыра Д1: у документа интерфейса есть layoutRect и он в снимке.
        check("$.ui.doc().layoutRect" in names,
              "$.ui.doc().layoutRect заморожен (та самая дыра Д1)")
        check("$.ui.doc().on" in names and "$.ui.doc().off" in names,
              "подписки документа заморожены (on/off)")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print(f"Все проверки пройдены: {len(baseline)} методов обёрток")
    return 0


if __name__ == "__main__":
    sys.exit(main())
