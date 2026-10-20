#!/usr/bin/env python3
# ===========================================================================
# Портитивность: платформенные зависимости, которых нет на MSVC.
#
# План дополировки (RUSSIANO2D_PRODUCTION_POLISH.md §4.1–4.3) требует не
# обещаний, а проверяемого факта:
#
#   * `M_PI` объявляет не всякий libc (MSVC — только с _USE_MATH_DEFINES),
#     поэтому у проекта своя константа `R2D_PI` (src/r2d.h);
#   * `strtok_r` — POSIX, на MSVC его нет; `strtok` держит состояние глобально
#     и ломается на вложенном разборе;
#   * runtime-sized C-массивы (VLA) MSVC не принимает вовсе (C2057/C2133).
#
# Проверка читает исходники, а не документацию: правило нарушено — прогон
# красный. Комментарии и строковые литералы из текста вырезаются, иначе
# объяснение «почему нельзя M_PI» само выглядело бы нарушением.
#
# Запуск:
#   python3 tests/portability_test.py
# ===========================================================================

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

#: Каталоги с собственным кодом, который обязан собираться и на MSVC.
CODE_DIRS = ("src", "sdk", "tools", "tests")

#: Расширения исходников C.
CODE_EXT = (".c", ".h")

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def strip_comments(text):
    """Убирает /*…*/ и //…, не трогая строковые и символьные литералы."""
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            end = text.find('*/', i + 2)
            i = n if end < 0 else end + 2
            out.append(' ')
        elif c == '/' and i + 1 < n and text[i + 1] == '/':
            end = text.find('\n', i)
            i = n if end < 0 else end
            out.append(' ')
        elif c in '"\'':
            quote = c
            out.append(c)
            i += 1
            while i < n:
                if text[i] == '\\' and i + 1 < n:
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                out.append(text[i])
                if text[i] == quote:
                    i += 1
                    break
                i += 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def code_files():
    for base in CODE_DIRS:
        for root, dirs, files in os.walk(os.path.join(ROOT, base)):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for name in sorted(files):
                if name.endswith(CODE_EXT):
                    yield os.path.join(root, name)


def read_code(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return strip_comments(f.read())


# ---------------------------------------------------------------------------
# 1. §4.1 — M_PI
# ---------------------------------------------------------------------------

def test_no_m_pi():
    print("\n== §4.1: M_PI не используется ==")
    offenders = []
    pattern = re.compile(r'\bM_PI\b')
    for path in code_files():
        for num, line in enumerate(read_code(path).splitlines(), 1):
            if pattern.search(line):
                offenders.append("%s:%d" % (os.path.relpath(path, ROOT), num))
    check(not offenders,
          "платформенного M_PI нет в коде (%s)" % (", ".join(offenders[:5]) or "чисто"))

    # Своя константа обязана существовать: иначе «нет M_PI» достигается
    # удалением математики, а не переносом её на переносимую константу.
    r2d_h = open(os.path.join(ROOT, "src", "r2d.h"), encoding="utf-8").read()
    check(re.search(r'#define\s+R2D_PI\s+3\.141592653589793', r2d_h) is not None,
          "каноническая константа R2D_PI объявлена в src/r2d.h")


# ---------------------------------------------------------------------------
# 2. §4.2 — strtok_r / strtok
# ---------------------------------------------------------------------------

def test_no_strtok():
    print("\n== §4.2: strtok_r/strtok не используются ==")
    offenders = []
    pattern = re.compile(r'\b(strtok_r|strtok_s|strtok)\s*\(')
    for path in code_files():
        for num, line in enumerate(read_code(path).splitlines(), 1):
            if pattern.search(line):
                offenders.append("%s:%d" % (os.path.relpath(path, ROOT), num))
    check(not offenders,
          "POSIX strtok_r и глобального strtok нет в коде (%s)"
          % (", ".join(offenders[:5]) or "чисто"))


# ---------------------------------------------------------------------------
# 3. §4.3 — VLA
# ---------------------------------------------------------------------------

#: Объявление массива: тип + имя + [размер]. После типа обязательна граница
#: слова, иначе выражение `bools[i]` читается как объявление `bool s[i]`.
ARRAY_DECL = re.compile(
    r'(?:^|[;{}(,])\s*(?:unsigned\s+|signed\s+|const\s+|static\s+|volatile\s+)*'
    r'(?:char|short|int|long|float|double|bool|size_t|ssize_t|'
    r'u?int(?:8|16|32|64)_t|[A-Z]\w*)(?![A-Za-z0-9_])\s*\**\s*'
    r'([A-Za-z_]\w*)\s*\[\s*([^\]]+?)\s*\]\s*[;=]')

#: Размер — константа времени компиляции: число, макрос, sizeof или их сумма.
#: Операнд константного выражения: число, sizeof или МАКРОС. Число может
#: стоять и первым: `3 * POLY_MAX` — такая же константа, как `POLY_MAX * 3`.
_CONST_OPERAND = (r'\(?\s*(?:\d+|0[xX][0-9a-fA-F]+|sizeof\b[^;]*'
                  r'|[A-Z][A-Z0-9_]*)\s*\)?')
CONST_SIZE = re.compile(
    r'^' + _CONST_OPERAND +
    r'(?:\s*[-+*/]\s*' + _CONST_OPERAND + r')*$')


def is_runtime_sized(size):
    """True, если размер не является константным выражением (то есть VLA)."""
    size = size.strip()
    if not size:
        return False
    if CONST_SIZE.match(size):
        return False
    # Выражение без единого идентификатора и без вызова — тоже константа
    # (например, 2 * 1024), даже если это не поймал CONST_SIZE из-за пробелов.
    if not re.search(r'[A-Za-z_]', size):
        return False
    return True


def test_no_vla():
    print("\n== §4.3: runtime-sized массивов нет ==")
    offenders = []
    for base in ("src", "sdk"):
        for root, dirs, files in os.walk(os.path.join(ROOT, base)):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for name in sorted(files):
                if not name.endswith(CODE_EXT):
                    continue
                path = os.path.join(root, name)
                for num, line in enumerate(read_code(path).splitlines(), 1):
                    for match in ARRAY_DECL.finditer(line):
                        if is_runtime_sized(match.group(2)):
                            offenders.append("%s:%d (%s[%s])" % (
                                os.path.relpath(path, ROOT), num,
                                match.group(1), match.group(2).strip()))
    check(not offenders,
          "runtime-sized C-массивов нет в переносимом коде (%s)"
          % (", ".join(offenders[:5]) or "чисто"))


def main():
    test_no_m_pi()
    test_no_strtok()
    test_no_vla()
    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
