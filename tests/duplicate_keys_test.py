#!/usr/bin/env python3
# ===========================================================================
# Логика поиска повторяющихся ключей в объектных литералах.
#
# ЗАЧЕМ ЭТО ВООБЩЕ: в src/highlevel/input.js было ДВА метода `gamepad` в одном
# объекте — новый молча перекрывал старый, и новая функциональность не
# работала. JavaScript это разрешает и не предупреждает, а поведенческий тест
# падал так, что причину искали в C, привязках и виртуальном вводе.
#
# ЧЕСТНО О ГРАНИЦАХ. Полный проход по всем модулям здесь НЕ делается: разбор
# без настоящего парсера путает объектные литералы с блоками `if/else`, и на
# репозитории выходило 43 «дубля», из которых настоящих не было ни одного.
# Шумный страж хуже отсутствующего: его перестают читать. Поэтому проверяется
# ровно то, что работает надёжно: поиск на подсунутом коде, включая тот самый
# реальный случай из input.js.
#
# Запуск:
#   python3 tests/duplicate_keys_test.py
# ===========================================================================

import os
import re
import sys

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def blank_out(source):
    """Убрать строки, шаблоны и комментарии, сохранив переводы строк."""
    out = []
    i, n = 0, len(source)
    while i < n:
        c = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and source[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if c == "/" and nxt == "*":
            out.append("  ")
            i += 2
            while i < n and not (source[i] == "*" and i + 1 < n and source[i + 1] == "/"):
                out.append("\n" if source[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
            continue
        if c in "\"'`":
            quote = c
            out.append(" ")
            i += 1
            while i < n and source[i] != quote:
                if source[i] == "\\":
                    out.append("  ")
                    i += 2
                    continue
                out.append("\n" if source[i] == "\n" else " ")
                i += 1
            out.append(" ")
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


KEY = re.compile(r"([A-Za-z_$][\w$]*)\s*:")
METHOD = re.compile(r"([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{")


def find_duplicates(source):
    """Повторяющиеся ключи одного объектного литерала: [(key, line, first_line)]."""
    clean = blank_out(source)
    bad = []
    stack = []
    i, n = 0, len(clean)

    def line_at(pos):
        return clean.count("\n", 0, pos) + 1

    while i < n:
        c = clean[i]
        if c in "{[(":
            stack.append({"ch": c, "keys": {}})
            i += 1
            continue
        if c in "}])":
            if stack:
                stack.pop()
            i += 1
            continue

        m = KEY.match(clean, i)
        if m:
            top = stack[-1] if stack else None
            if top and top["ch"] == "{":
                key = m.group(1)
                if "?" not in clean[max(0, i - 3):i]:
                    if key in top["keys"]:
                        bad.append((key, line_at(i), top["keys"][key]))
                    else:
                        top["keys"][key] = line_at(i)
            i = m.end(1)
            continue

        mm = METHOD.match(clean, i)
        if mm:
            top = stack[-1] if stack else None
            if top and top["ch"] == "{":
                key = mm.group(1)
                if key in top["keys"]:
                    bad.append((key, line_at(i), top["keys"][key]))
                else:
                    top["keys"][key] = line_at(i)
            i = mm.end(1)
            continue

        i += 1
    return bad


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HL = os.path.join(ROOT, "src", "highlevel")


def check_missing_math_random():
    """
    Ни один модуль высокоуровневого API не должен звать Math.random().

    Причина: воспроизводимость. Движок детерминирован (--seed, --fixed-dt,
    свой генератор в $.random/fxRandom), но один вызов Math.random() в кадре
    ломает и реплей ($.replay), и разбор баг-репорта. Именно так было в
    timeline.js (дыхание и фаза героев) — нашлось аудитом, а не тестом.
    """
    offenders = []
    for name in sorted(f for f in os.listdir(HL) if f.endswith(".js")):
        with open(os.path.join(HL, name), encoding="utf-8", errors="replace") as fh:
            text = blank_out(fh.read())
        if "Math.random" in text:
            offenders.append(name)
    return offenders


def main():
    # Реальный случай, из-за которого страж появился.
    real = [
        "const input = {",
        "    gamepad(index) { return 1; },",
        "    padDown(button) { return 2; },",
        "    gamepad(slot) { return 3; },",
        "};",
    ]
    found = find_duplicates("\n".join(real))
    check(len(found) == 1, f"дубликат найден: {found}")
    check(found and found[0][0] == "gamepad", "ключ — gamepad")
    check(found and found[0][2] == 2, f"первое вхождение на строке 2, а не {found[0][2] if found else '—'}")

    # Одинаковые имена в РАЗНЫХ литералах — не дубликат.
    nested = "const o = { a: { x: 1 }, b: { x: 2 } };"
    check(not find_duplicates(nested), "разные литералы не считаются дублем")

    # Свойство в одном литерале — дубликат.
    same = "const o = { a: 1, a: 2 };"
    check(len(find_duplicates(same)) == 1, "два одинаковых свойства — дубль")

    # Строки и комментарии ключами не считаются.
    noise = 'const o = {\n  a: "b: 1, b: 2",\n  // c: 1, c: 2\n  d: 3,\n};'
    check(not find_duplicates(noise), "строки и комментарии не мешают")

    # Тернарник не ключ.
    tern = "const o = { a: c ? 1 : 2, b: 3 };"
    check(not find_duplicates(tern), "тернарник не считается ключом")

    # Ни один модуль не зовёт Math.random(): иначе ломается воспроизводимость.
    offenders = check_missing_math_random()
    check(not offenders, f"Math.random в модулях API нет (найдено: {offenders})")
    # Страж должен уметь находить: подсовываем файл с вызовом.
    sample = "const x = Math.random();"
    check("Math.random" in blank_out(sample), "страж видит Math.random в коде")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
