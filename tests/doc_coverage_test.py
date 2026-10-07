#!/usr/bin/env python3
# ===========================================================================
# Страж покрытия документацией: у каждого модуля есть страница.
#
# Причина существования: §11.4 аудита — у 17 модулей не было страницы
# `docs/highlevel/<имя>.md`, и об этом никто не узнавал, потому что проверки не
# было. Здесь она есть: новый модуль без страницы падает на этом тесте.
#
# Запуск:
#   python3 tests/doc_coverage_test.py
# ===========================================================================

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HL = os.path.join(ROOT, "src", "highlevel")
DOCS = os.path.join(ROOT, "docs", "highlevel")

# Модули, которым страница не нужна: служебные и «не для игры».
EXEMPT = set()

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    modules = sorted(f[:-3] for f in os.listdir(HL) if f.endswith(".js"))
    pages = set(f[:-3] for f in os.listdir(DOCS) if f.endswith(".md"))
    check(len(modules) > 50, f"модулей в src/highlevel: {len(modules)}")

    missing = [m for m in modules if m not in pages and m not in EXEMPT]
    check(not missing, f"у каждого модуля есть страница (нет: {missing})")

    # Файлы, у которых есть ТЕСТ: он либо импортирует модуль, либо назван по нему.
    tests = []
    for root, _, files in os.walk(os.path.join(ROOT, "tests")):
        for f in files:
            if f.endswith((".mjs", ".py")):
                tests.append(os.path.join(root, f))
    blobs = []
    for path in tests:
        try:
            blobs.append((path, open(path, encoding="utf-8", errors="replace").read()))
        except OSError:
            pass

    untested = []
    for m in modules:
        if m in EXEMPT:
            continue
        hit = any((m in os.path.basename(p)) or (("/%s.js" % m) in s) or ("'%s.js'" % m in s)
                  for p, s in blobs)
        if not hit:
            untested.append(m)
    check(not untested, f"у каждого модуля есть проверка (нет: {untested})")

    # Страницы не должны быть пустышками.
    thin = []
    for m in modules:
        path = os.path.join(DOCS, m + ".md")
        if not os.path.isfile(path):
            continue
        text = open(path, encoding="utf-8", errors="replace").read()
        if len(text.splitlines()) < 12:
            thin.append(m)
    check(not thin, f"страницы не пустышки (короткие: {thin})")

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
