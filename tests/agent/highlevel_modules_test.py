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
HEADER = next((p for p in (os.path.join(ROOT, "build-xmake", "generated", "r2d_js_data.h"),
                           os.path.join(ROOT, "build", "generated", "r2d_js_data.h"))
               if os.path.exists(p)),
              os.path.join(ROOT, "build-xmake", "generated", "r2d_js_data.h"))

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
    # Исключения — тоже факт сборки: при -DR2D_ENABLE_RE2D=OFF из таблицы
    # намеренно убраны 3D-модули (cmake/EmbedJs.cmake). Генератор печатает их
    # список рядом с таблицей, поэтому «нет модуля» здесь не гадание, а
    # сверка с тем, что решила сборка.
    excluded = set(re.findall(r'^\s*"([A-Za-z0-9_.-]+\.js)",\s*$',
                              header[header.find("r2d_js_module_excluded[]"):]
                              if "r2d_js_module_excluded[]" in header else "",
                              re.M))

    missing = [f for f in files if f not in bundled and f not in excluded]
    check(not missing, f"все модули в таблице (нет: {missing})")
    check(not (bundled & excluded), "исключённые модули в таблицу не попали")
    # Предел в 64 файла — ровно та ошибка, которую проверяем.
    check(len(bundled) >= 65 or len(files) - len(excluded) < 65,
          f"таблица не обрезана: записей {len(bundled)}, исключено {len(excluded)}")

    with Agent(game=os.path.join("tests", "fixtures", "text"), seed=5) as a:
        check(a.eval("typeof $") == "function", "в игре есть $ (bootstrap прошёл)")
        check(a.eval("!!globalThis.__r2d_boot_started") is True,
              "bootstrap.js выполнился")
        check(a.eval("String(globalThis.__r2d_boot_error || '')") == "",
              "ошибки установки API нет")
        check(a.eval("typeof $.audio") == "object", "$.audio установлена")
        for name in ("proc", "raid", "weapons"):
            check(a.eval(f"typeof $.{name}") == "object", f"$.{name} установлена")
        # RE2D-семейство ставится только в сборке с RE2D: модули в таблице есть
        # всегда (api.js импортирует их статически), но установка идёт по
        # нативным биндингам (api.js: re2dAvailable). Проверяем факт сборки, а не
        # угадываем по имени каталога.
        if a.eval("$.re2dEnabled") is True:
            check(a.eval("typeof $.cels") == "object", "$.cels установлена (RE2D=ON)")
        else:
            check(a.eval("typeof $.cels") == "undefined",
                  "$.cels отсутствует в сборке без RE2D")

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
