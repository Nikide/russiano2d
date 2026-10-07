#!/usr/bin/env python3
# ===========================================================================
# Проверка касаний и мультигеймпада в движке.
#
# Касания и геймпады нельзя проверить без настоящего железа, поэтому агент
# умеет подставлять виртуальный палец (команда touch) и виртуальный геймпад
# (команда pad) — ровно так же, как виртуальную клавиатуру.
#
# ВАЖНО: номер пальца передаётся полем `finger`, а не `id`: клиент протокола
# подставляет в `id` номер запроса (сначала 1), и палец попадал бы в слот 1.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_touch_pad_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # --- касания ---------------------------------------------------------
        check(a.eval("$.input.touchCount()") == 0, "до касания пальцев нет")
        check(a.eval("$.input.touched()") is False, "и touched() молчит")
        check(a.eval("JSON.stringify($.input.touches())") == "[]", "список пуст")

        a.cmd("touch", action="down", x=100, y=200, finger=0)
        a.step(1)
        check(a.eval("$.input.touchCount()") == 1, "палец виден")
        one = json.loads(a.eval("JSON.stringify($.input.touch(0))"))
        check(abs(one["x"] - 100) < 1 and abs(one["y"] - 200) < 1,
              f"координаты пальца: {one['x']:.0f},{one['y']:.0f}")
        check(one["pressure"] > 0, f"давление есть: {one['pressure']}")

        # Движение: сдвиг считается за кадр.
        a.cmd("touch", action="move", x=140, y=200, finger=0)
        a.step(1)
        moved = json.loads(a.eval("JSON.stringify($.input.touch(0))"))
        check(abs(moved["dx"] - 40) < 1, f"сдвиг пальца за кадр: dx = {moved['dx']:.0f}")

        # Второй палец — мультитач: мышь так не умеет.
        a.cmd("touch", action="down", x=300, y=100, finger=1)
        a.step(1)
        check(a.eval("$.input.touchCount()") == 2, "два пальца одновременно")
        check(a.eval("$.input.touch(1) !== null") is True, "второй палец читается")
        check(a.eval("$.input.touches().length") == 2, "список отдаёт оба")

        # Отпускание: палец исчезает.
        a.cmd("touch", action="up", x=140, y=200, finger=0)
        a.step(1)
        check(a.eval("$.input.touchCount()") == 1, "после отпускания один палец")
        check(a.eval("$.input.touch(0)") is None, "отпущенный палец не читается")

        a.cmd("touch", action="clear")
        a.step(1)
        check(a.eval("$.input.touchCount()") == 0, "clear убирает все пальцы")

        # --- геймпады --------------------------------------------------------
        check(a.eval("typeof $.input.gamepad") == "object" or
              a.eval("typeof $.input.gamepad") == "function", "gamepad() есть")
        slots = a.eval("$.input.padSlots()")
        check(slots >= 4, f"слотов геймпада: {slots}")
        check(a.eval("$.input.padCount()") == 0, "настоящих геймпадов нет (CI)")
        check(a.eval("$.input.gamepad(1).connected()") is False, "слот 1 не подключён")

        # Виртуальный геймпад: кнопка и ось.
        a.cmd("pad", slot=1, button=0, down=True)     # SDL_GAMEPAD_BUTTON_SOUTH = 0
        a.step(1)
        check(a.eval("$.input.gamepad(1).down(0)") is True, "кнопка слота 1 нажата")
        check(a.eval("$.input.gamepad(0).down(0)") is False, "слот 0 не задет")
        check(a.eval("$.input.gamepad(1).pressed(0)") is True, "фронт нажатия виден")

        a.cmd("pad", slot=1, axis=0, value=0.75)      # левый стик по X
        a.step(1)
        axis = a.eval("$.input.gamepad(1).axis(0)")
        check(abs(axis - 0.75) < 0.01, f"ось слота 1: {axis:.2f}")

        a.cmd("pad", slot=1, button=0, down=False)
        a.step(1)
        check(a.eval("$.input.gamepad(1).down(0)") is False, "кнопка отпущена")

        # Вибро на несуществующем геймпаде честно отказывает.
        check(a.eval("$.input.gamepad(1).rumble({ ms: 100 })") is False,
              "вибро без настоящего геймпада — false, а не тихий успех")

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
