#!/usr/bin/env python3
# ===========================================================================
# Гейт «у публичного имени есть документация» (api_docs_sync).
#
# Причина существования: трижды ловили один и тот же класс разъезда — код есть,
# документации нет (HRTF и захват выхода жили только в `highlevel/audiobus.md` и
# отсутствовали в `AGENT_API.md`; заморозка API устарела). Пожелание «не
# забывать про доки» не работает; работает гейт.
#
# Источник имён — снимок публичной поверхности `tests/api_freeze_baseline.txt`
# (тот же, что проверяет `tests/api_freeze_test.py`; второго парсера здесь нет).
# Свежесть снимка обеспечивает заморозка: появилось новое имя — падает
# `api_freeze_test`, его обновляют осознанно (`--write`), и тогда это имя
# обязано пройти здешнюю проверку.
#
# Правила (ровно те, что описывают наш API и нашу документацию):
#   1. имя встречается в `docs/**/*.md` буквально (с границей слова) — и НЕ в
#      строке с отрицанием: «`$.camera.visibleRect()` не существует» — это
#      описание ОТСУТСТВИЯ, а не документация, поэтому такие строки в зачёт не
#      идут (список признаков — NEGATION ниже). Иначе первое же имя, заведённое
#      после списка «чего нет», считалось бы задокументированным;
#   2. русский алиас (`$.ввод.tap`, `$.fn.высота`) считается задокументированным,
#      если задокументирован его английский двойник по таблицам `ru.js`
#      (`RU_NAMESPACES`, `RU_METHODS`). Пара «алиас → оригинал» проверяется:
#      если оригинала нет в снимке, это провал, а не пропуск;
#   3. метод обёртки узла `$.fn.at` задокументирован, если в доках есть `.at(`
#      или `` `.at` `` — так методы узлов и описываются (`docs/HIGH_LEVEL_API.md`);
#   4. приватные имена (сегмент с `_`: `$._node`, `$.camera._tick`) исключаются
#      автоматически и считаются отдельным числом — они не публичный контракт;
#   5. остаток, который ещё не описан, живёт в `tests/api_docs_allowlist.txt`
#      строкой «образец + причина». Строка без причины не принимается, а строка,
#      которая уже ничего не покрывает, — провал: список обязан уменьшаться, а
#      не обрастать мёртвыми записями.
#
# Запуск:
#   python3 tests/api_docs_sync_test.py
#   python3 tests/api_docs_sync_test.py --list     # что именно не описано
# ===========================================================================

import bisect
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, "tests", "api_freeze_baseline.txt")
ALLOWLIST = os.path.join(ROOT, "tests", "api_docs_allowlist.txt")
DOCS_DIR = os.path.join(ROOT, "docs")
RU = os.path.join(ROOT, "src", "highlevel", "ru.js")

#: Признаки отрицания. Строка с ними рядом с именем означает, что имя описано
#: как НЕсуществующее, и в зачёт документации такое упоминание не идёт.
#:
#: Правило узкое намеренно: «нет» встречается и в описаниях живого API
#: («`0` — нет полос», «если композиции нет»), поэтому
#:   * сильные обороты («не существует», «отсутствует», «не поддержан»,
#:     «заглушка»…) считаются в окне ±80 символов вокруг имени;
#:   * короткое «нет» — только вплотную к имени (±15 символов);
#:   * строка, начинающаяся с «Чего нет…» / «Чего у X нет…», исключает все
#:     имена на этой строке целиком.
NEGATION = re.compile(
    r"(?:не\s+существу\w+|отсутству(?:ет|ют)\b|не\s+реализован\w+|не\s+поддерж\w+|"
    r"заглушк\w*|удал[её]н\w*\s+из|убрано\s+из|больше\s+нет|нет\s+такого|нельзя|"
    r"не\s+работа\w+)",
    re.IGNORECASE)
NEGATION_NEAR = re.compile(r"\bнет\b", re.IGNORECASE)
NEGATION_LINE = re.compile(r"^\s*[|>#*\-\s]*чего\s+(?:у\s+[^:]{0,40}\s+)?нет\b", re.IGNORECASE)

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)
    return condition


def read_docs():
    """Текст всех docs/**/*.md одним куском (гейт статический, без движка)."""
    parts = []
    for root, _dirs, files in os.walk(DOCS_DIR):
        for name in sorted(files):
            if name.endswith(".md"):
                with open(os.path.join(root, name), encoding="utf-8", errors="replace") as handle:
                    parts.append(handle.read())
    return "\n".join(parts)


def parse_ru_table(source, table):
    """Пары «русское имя → каноническое» из таблицы ru.js.

    Разбор текстовый (гейт не поднимает движок), поэтому результат проверяется
    на правдоподобие: молча деградировать до пустой таблицы он не должен.
    """
    match = re.search(r"export const %s = \{(.*?)\n\};" % table, source, re.S)
    if not match:
        return None
    pairs = {}
    for key, value in re.findall(r"'([^']+)'\s*:\s*'([^']+)'", match.group(1)):
        pairs[key] = value
    return pairs


def load_allowlist():
    """Строки allowlist: (образец, причина). Причина обязательна.

    Формат: `образец  # категория: причина`. Разделителем принимается и `=`
    (так удобнее тем, кто присылает правки), канонический — `#`.
    """
    if not os.path.exists(ALLOWLIST):
        return []
    entries = []
    with open(ALLOWLIST, encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            text = line.strip()
            if not text or text.startswith("#"):
                continue
            separator = "#" if "#" in text else ("=" if "=" in text else None)
            if separator is None:
                print("  FAIL %s:%d — у исключения нет причины: %r" % (
                    os.path.relpath(ALLOWLIST, ROOT), number, text))
                FAILURES.append("исключение без причины: " + text)
                continue
            pattern, reason = text.split(separator, 1)
            pattern, reason = pattern.strip(), reason.strip()
            if not pattern or not reason:
                print("  FAIL %s:%d — пустой образец или причина: %r" % (
                    os.path.relpath(ALLOWLIST, ROOT), number, text))
                FAILURES.append("пустое исключение: " + text)
                continue
            entries.append((pattern, reason))
    return entries


def pattern_matches(pattern, name):
    if pattern.endswith(".*"):
        return name == pattern[:-2] or name.startswith(pattern[:-1])
    return name == pattern


def main():
    show_list = "--list" in sys.argv[1:]
    if not os.path.exists(BASELINE):
        print("  FAIL нет снимка публичного API %s — его создаёт api_freeze_test --write"
              % os.path.relpath(BASELINE, ROOT))
        return 1
    with open(BASELINE, encoding="utf-8") as handle:
        # У констант в снимке есть значение: `$.alive.PULSE_MAX = 200` — для
        # проверки документации важно имя, а не значение.
        names = [line.split(" = ", 1)[0].strip() for line in handle if line.strip()]

    with open(RU, encoding="utf-8") as handle:
        ru_source = handle.read()
    ru_namespaces = parse_ru_table(ru_source, "RU_NAMESPACES")
    ru_methods = parse_ru_table(ru_source, "RU_METHODS")
    ok_tables = (ru_namespaces is not None and len(ru_namespaces) >= 10
                 and ru_methods is not None and len(ru_methods) >= 20
                 and all(re.search(r"[А-Яа-яЁё]", key) for key in ru_namespaces)
                 and all(re.search(r"[А-Яа-яЁё]", key) for key in ru_methods))
    if not check(ok_tables,
                 "таблицы русских алиасов разобраны (ru.js: %s неймспейсов, %s методов)"
                 % (len(ru_namespaces or {}), len(ru_methods or {}))):
        print("        формат ru.js изменился — поправьте parse_ru_table, "
              "иначе алиасы начнут считаться долгом")
        return 1

    docs = read_docs()
    check(len(docs) > 100000, "документация прочитана (%d символов из docs/**/*.md)" % len(docs))

    # Строки и их смещения: нужно понимать, в какой строке встретилось имя —
    # упоминание в строке с отрицанием («этого нет», «не существует») не
    # считается документацией, иначе список «чего нет» выдавал бы
    # несуществующее имя за задокументированное.
    docs_lines = docs.splitlines()
    line_starts = [0]
    for match in re.finditer(r"\n", docs):
        line_starts.append(match.end())

    negation_hits = []

    def line_info(position):
        """(текст строки, смещение внутри строки) для позиции в общем тексте."""
        index = bisect.bisect_right(line_starts, position) - 1
        if index < 0 or index >= len(docs_lines):
            return ("", 0)
        return (docs_lines[index], position - line_starts[index])

    def negated_mention(line, start, end):
        """Описывает ли эта строка имя как НЕсуществующее."""
        stripped = re.sub(r"[*_`]", "", line)
        if NEGATION_LINE.search(stripped):
            return True
        if NEGATION.search(line[max(0, start - 80):end + 80]):
            return True
        return NEGATION_NEAR.search(line[max(0, start - 15):end + 15]) is not None

    def literal(name):
        """Есть ли БЕЗоговорочное упоминание имени в доках (не в списке «чего нет»)."""
        found = False
        negated = False
        for match in re.finditer(re.escape(name) + r"(?![A-Za-z0-9_$])", docs):
            line, offset = line_info(match.start())
            if negated_mention(line, offset, offset + (match.end() - match.start())):
                negated = True
                continue
            found = True
            break
        if not found and negated:
            negation_hits.append(name)
        return found

    def wrapper_method(member):
        if not member:
            return False
        if re.search(r"\." + re.escape(member) + r"\s*\(", docs):
            return True
        if re.search(r"`\." + re.escape(member) + r"`", docs):
            return True
        if re.search(r"`" + re.escape(member) + r"\s*\(", docs):
            return True
        return False

    def documented(name):
        """Каким правилом имя признано задокументированным (или None).

        Возвращает `(правило, образец_allowlist)`: образец нужен, чтобы считать
        покрытие строк allowlist и ловить мёртвые записи.
        """
        if literal(name):
            return ("буквально", None)
        if re.search(r"\._", name):
            return ("приватное", None)
        cyrillic = re.search(r"[А-Яа-яЁё]", name)
        if name.startswith("$.fn."):
            # Метод обёртки: имя в доках пишется без префикса ($.fn.at → `.at(`).
            # Русский метод сначала переводится в канонический по RU_METHODS.
            member = name.split(".", 2)[2]
            if cyrillic and member:
                canonical_member = ru_methods.get(member)
                if canonical_member is None:
                    alias_problems.append("%s — нет пары в RU_METHODS" % name)
                    return (None, None)
                member = canonical_member
            return ("метод обёртки", None) if wrapper_method(member) else (None, None)
        if cyrillic:
            parts = name.split(".")
            if len(parts) < 2:
                return (None, None)
            alias, rest = parts[1], parts[2:]
            canonical = ru_namespaces.get(alias)
            if canonical is None:
                alias_problems.append("%s — нет пары в RU_NAMESPACES" % name)
                return (None, None)
            target = "$." + ".".join([canonical] + rest)
            if target not in name_set:
                alias_problems.append("%s → %s (оригинала нет в снимке)" % (name, target))
                return (None, None)
            # Алиас документирован ровно настолько, насколько документирован
            # оригинал: то же правило, тот же allowlist.
            rule, pattern = documented(target)
            if rule is None:
                return (None, None)
            return ("русский алиас", pattern)
        for pattern, _reason in allowed:
            if pattern_matches(pattern, name):
                return ("allowlist", pattern)
        return (None, None)

    name_set = set(names)
    alias_problems = []
    counts = {"буквально": 0, "русский алиас": 0, "метод обёртки": 0, "приватное": 0,
              "allowlist": 0}
    allowed = load_allowlist()
    coverage = {pattern: 0 for pattern, _reason in allowed}
    undocumented = []
    for name in names:
        rule, pattern = documented(name)
        if rule == "allowlist" and pattern is not None:
            coverage[pattern] += 1
        if rule is None:
            undocumented.append(name)
        else:
            counts[rule] += 1

    print("api_docs_sync: в снимке %d имён" % len(names))
    for rule in ("буквально", "русский алиас", "метод обёртки"):
        print("       задокументировано (%s): %d" % (rule, counts[rule]))
    print("       исключено (приватные): %d" % counts["приватное"])
    print("       исключено (allowlist, %d строк): %d" % (len(allowed), counts["allowlist"]))
    by_category = {}
    for pattern, reason in allowed:
        category = reason.split(":", 1)[0].strip() if ":" in reason else "без категории"
        by_category[category] = by_category.get(category, 0) + coverage[pattern]
    if by_category:
        print("       долг по категориям allowlist: %s"
              % ", ".join("%s %d" % (name, size) for name, size in sorted(by_category.items())))
    if negation_hits:
        print("       упомянуты только в списках «чего нет» (в зачёт не идут): %d — %s%s"
              % (len(negation_hits), ", ".join(sorted(negation_hits)[:5]),
                 " и др." if len(negation_hits) > 5 else ""))

    check(not alias_problems,
          "у каждого русского алиаса есть английский оригинал в снимке"
          + ("" if not alias_problems else ": " + "; ".join(alias_problems[:6])))

    # Мёртвые строки allowlist: долг закрыт, а исключение осталось.
    stale = [(pattern, coverage[pattern]) for pattern, _reason in allowed if coverage[pattern] == 0]
    check(not stale,
          "в allowlist нет мёртвых строк (не покрывают ничего: %s)"
          % (", ".join(pattern for pattern, _ in stale) if stale else "нет"))

    if undocumented:
        by_ns = {}
        for name in undocumented:
            parts = name.split(".")
            key = ".".join(parts[:2]) if len(parts) > 2 else name
            by_ns[key] = by_ns.get(key, 0) + 1
        top = sorted(by_ns.items(), key=lambda item: (-item[1], item[0]))[:12]
        print("       ДОЛГ (нет ни в docs, ни в allowlist): %d имён, крупнейшие: %s"
              % (len(undocumented), ", ".join("%s×%d" % (k, v) for k, v in top)))
        check(False, "у каждого публичного имени есть документация: не описано %d — %s%s"
              % (len(undocumented), ", ".join(undocumented[:8]),
                 " и др." if len(undocumented) > 8 else ""))
    else:
        check(True, "у каждого публичного имени есть документация")

    if show_list:
        print()
        for name in undocumented:
            print(name)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        print("\nКак чинить: задокументировать имя в docs/**/*.md (лучше — на странице "
              "своего неймспейса) либо добавить строку в %s с причиной."
              % os.path.relpath(ALLOWLIST, ROOT))
        return 1
    print("Все проверки пройдены (%d имён: документация или осознанное исключение)" % len(names))
    return 0


if __name__ == "__main__":
    sys.exit(main())
