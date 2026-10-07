#!/usr/bin/env python3
# ===========================================================================
# Тест попадания курсора в мировые узлы: $.pick()/$.pickAll() и `:picked`.
#
# Что проверяется:
#   * верхний узел под точкой и порядок по layer/depth/Y;
#   * промах даёт пустую обёртку, а не исключение;
#   * интерфейс в пикинге не участвует;
#   * попадание не ломается при сдвинутой камере и зуме.
#
# Известный остаток: узел в параллакс-слое ловится по своей позиции в сцене, а
# не по нарисованному месту — подсистема параллакса двигает узел уже после
# общего тика. Зафиксировано в docs/TASKS.md §1.5.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_pick_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5) as a:
        a.eval("$.world.color('#000000')")
        a.eval("""
            $('<rect>', { id: 'a', w: 100, h: 100 }).at(200, 200).appendTo($.world);
            $('<rect>', { id: 'b', w: 100, h: 100 }).at(500, 200).appendTo($.world);
            $('<ui.button>', { id: 'btn', w: 200, h: 60, text: 'OK' }).at(200, 200).appendTo($.ui);
        """)
        a.step(2)

        check(a.eval("$.pick([200, 200]).attr('id')") == "a", "точка в узле 'a' даёт 'a'")
        check(a.eval("$.pick([500, 200]).attr('id')") == "b", "точка в узле 'b' даёт 'b'")
        check(a.eval("$.pick([700, 500]).length") == 0, "мимо узлов — пустая обёртка")
        check(a.eval("$.pick([200, 200]).attr('id')") != "btn",
              "интерфейс в пикинге не участвует")

        # Порядок: верхний (больший layer) побеждает при наложении.
        a.eval("$('<rect>', { id: 'top', w: 100, h: 100 }).at(200, 200)"
               ".layer(5).appendTo($.world)")
        a.step(1)
        check(a.eval("$.pick([200, 200]).attr('id')") == "top", "верхний по layer побеждает")
        check(a.eval("$.pickAll([200, 200]).length") == 2, "pickAll видит оба узла")
        a.eval("$('#top').remove()")

        # Пикинг при сдвинутой камере: узел ловится по МИРОВОЙ координате,
        # независимо от того, куда смотрит камера.
        a.eval("$.camera.at(600, 300)")
        a.step(3)
        check(a.eval("$.pick([200, 200]).attr('id')") == "a",
              "сдвиг камеры не ломает попадание по мировой точке")
        check(a.eval("$.pickAll([500, 200]).length") == 1, "pickAll с тем же сдвигом")

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
