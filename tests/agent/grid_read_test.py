#!/usr/bin/env python3
# ===========================================================================
# Тест чтения сетки (task-68): канонический геттер — $.grid.at, а не второй
# синоним $.grid.get.
#
# Проверяем живьём: at() отдаёт значение клетки и fallback за границей,
# count() считает клетки с явным значением, а $.grid.get НЕ существует —
# один путь к одной возможности (docs/highlevel/grid.md §3).
#
# Запуск (собранный движок):
#   python3 tests/agent/grid_read_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "utility")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # Фикстура utility: сетка 20×15, 12 'wall', нижний ряд 'ray'.
        check(a.eval("typeof $.grid.at") == "function", "$.grid.at — геттер клетки")
        check(a.eval("typeof $.grid.count") == "function", "$.grid.count — счётчик клеток")
        check(a.eval("typeof $.grid.get") == "undefined",
              "$.grid.get отсутствует: второй геттер не заводим")

        check(a.eval("$.grid.at(globalThis.__grid, 2, 2)") == "wall",
              "at(2,2) = 'wall' (первая клетка прямоугольника 4×3)")
        check(a.eval("$.grid.at(globalThis.__grid, 5, 4)") == "wall",
              "at(5,4) = 'wall' (последняя клетка прямоугольника)")
        check(a.eval("$.grid.at(globalThis.__grid, 0, 14)") == "ray",
              "at(0,14) = 'ray' (линия по нижнему ряду)")
        check(a.eval("$.grid.at(globalThis.__grid, 10, 10)") == "water",
              "at(10,10) = 'water' (заливка flood)")

        # За границей — fallback, без него undefined (в JSON это null).
        check(a.eval("$.grid.at(globalThis.__grid, -1, 0, 'edge')") == "edge",
              "at(-1,0,'edge') отдаёт fallback")
        check(a.eval("$.grid.at(globalThis.__grid, 999, 0, 'far')") == "far",
              "at(999,0,'far') отдаёт fallback")
        check(a.eval("$.grid.at(globalThis.__grid, -1, 0)") is None,
              "at(-1,0) без fallback = undefined")

        check(a.eval("$.grid.count(globalThis.__grid, 'wall')") == 12,
              "count('wall') = 12")
        check(a.eval("$.grid.count(globalThis.__grid, 'ray')") == 20,
              "count('ray') = 20")
        check(a.eval("$.grid.count(globalThis.__grid)") == 0,
              "count() без значения = 0 (сравнение с undefined, как в доке)")

        # at — ровно чтение data, без второго пути.
        check(a.eval("$.grid.at(globalThis.__grid, 3, 2) === "
                     "globalThis.__grid.data[2 * globalThis.__grid.cols + 3]") is True,
              "at читает ровно data[cy*cols+cx]")

    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
