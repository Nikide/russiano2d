#!/usr/bin/env python3
# ===========================================================================
# Проверка: ВСЕ модули высокоуровневого API попадают в бинарник.
#
# Регрессия на настоящую ошибку: генератор таблицы модулей (tools/r2d_embed_js.c)
# держал жёсткий предел 64 файла. Когда в src/highlevel стало 65, последний
# (acoustics.js) МОЛЧА не попал в бинарник — движок падал на импорте, «$»
# оставался неопределённым, и вся игра работала «только на engine.*».
#
# Проверка независима от содержимого модулей: сравниваем число .js в каталоге
# с числом записей в сгенерированной таблице и заодно убеждаемся, что игра
# реально видит $.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_modules_test.py
# ===========================================================================

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HL_DIR = os.path.join(ROOT, "src", "highlevel")
HEADER = os.path.join(ROOT, "build", "generated", "r2d_js_data.h")

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    files = sorted(f for f in os.listdir(HL_DIR) if f.endswith(".js"))
    check(len(files) >= 65, f"в src/highlevel модулей: {len(files)}")

    check(os.path.isfile(HEADER), "таблица модулей сгенерирована")
    if not os.path.isfile(HEADER):
        return 1
    header = open(HEADER, encoding="utf-8", errors="replace").read()
    bundled = set(re.findall(r'"r2d/([A-Za-z0-9_.-]+\.js)"', header))

    missing = [f for f in files if f not in bundled]
    check(not missing, f"все модули в таблице (нет: {missing})")
    # Предел в 64 файла — ровно та ошибка, которую проверяем.
    check(len(bundled) >= 65 or len(files) < 65,
          f"таблица не обрезана: записей {len(bundled)}")

    with Agent(game=os.path.join("tests", "fixtures", "text"), seed=5) as a:
        check(a.eval("typeof $") == "function", "в игре есть $ (bootstrap прошёл)")
        check(a.eval("!!globalThis.__r2d_boot_started") is True,
              "bootstrap.js выполнился")
        check(a.eval("String(globalThis.__r2d_boot_error || '')") == "",
              "ошибки установки API нет")
        check(a.eval("typeof $.audio") == "object", "$.audio установлена")
        for name in ("proc", "cels", "raid", "weapons"):
            check(a.eval(f"typeof $.{name}") == "object", f"$.{name} установлена")

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
