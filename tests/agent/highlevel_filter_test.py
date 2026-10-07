#!/usr/bin/env python3
# ===========================================================================
# Тест переключения фильтрации спрайтов: nearest (пиксель-арт) и линейная.
#
# Проверяем, что режим действительно меняет картинку и возвращается обратно, а
# не просто запоминается в переменной.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_filter_test.py
# ===========================================================================

import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, path):
    a.cmd("screenshot", path=path)
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main():
    with Agent(game=os.path.join("tests", "fixtures", "text"), seed=5) as a:
        a.eval("$.world.color('#000000')")
        a.eval("$('<sprite>', { id: 'big', w: 300, h: 300 })"
               ".sprite('assets/tiles.png').at(400, 300).appendTo($.world)")
        a.step(2)
        check(a.eval("$.gfx.filter()") is False, "по умолчанию nearest")
        nearest = shot(a, "/tmp/filter_near.png")

        check(a.eval("$.gfx.filter(true)") is True, "линейная включается")
        a.step(2)
        linear = shot(a, "/tmp/filter_lin.png")
        check(nearest != linear, "линейная фильтрация меняет кадр")

        a.eval("$.gfx.filter(false)")
        a.step(2)
        check(shot(a, "/tmp/filter_back.png") == nearest,
              "возврат к nearest даёт прежний кадр")

        check(a.eval("engine.spriteFilter()") is False, "состояние читается из движка")

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
