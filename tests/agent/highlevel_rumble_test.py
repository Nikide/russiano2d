#!/usr/bin/env python3
# ===========================================================================
# Тест виброотклика через агентский интерфейс.
#
# Проверяет то, что можно проверить без железа: биндинги движка появились,
# $.input.rumble()/stopRumble()/rumbleSupported() отвечают и — главное —
# честно возвращают false, когда геймпада нет. Раньше вызов был заглушкой:
# писал «не подключён к SDL_RumbleGamepad» и молча ничего не делал.
#
# Живую вибрацию проверяет только человек с геймпадом в руках; тест на это и
# не претендует, зато ловит возврат заглушки и падение биндинга.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_rumble_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "bare")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5) as a:
        # --- Биндинги движка --------------------------------------------------
        check(a.eval("typeof engine.padRumble") == "function", "engine.padRumble есть")
        check(a.eval("typeof engine.padRumbleTriggers") == "function",
              "engine.padRumbleTriggers есть")
        check(a.eval("typeof engine.padConnected") == "function",
              "engine.padConnected есть")

        # --- Геймпада в headless-прогоне нет, и API это признаёт ---------------
        connected = a.eval("engine.padConnected()")
        check(connected is False, "геймпада нет: engine.padConnected() = false")
        check(a.eval("$.input.rumbleSupported()") is False,
              "$.input.rumbleSupported() = false")
        check(a.eval("$.input.gamepad(0).connected()") is False,
              "$.input.gamepad(0).connected() = false")

        # --- Вызовы не падают и честно возвращают false ------------------------
        check(a.eval("$.input.rumble()") is False, "rumble() без геймпада → false")
        check(a.eval("$.input.rumble({weak:0.4, strong:0.9, duration:300})") is False,
              "rumble({...}) без геймпада → false")
        check(a.eval("$.input.rumble({triggers:[0.5,0.5]})") is False,
              "вибрация курков без геймпада → false")
        check(a.eval("$.input.rumble(0)") is False, "rumble(0) — стоп, тоже false")
        check(a.eval("$.input.stopRumble()") is False, "stopRumble() → false")
        check(a.eval("$.input.gamepad(0).rumble({weak:1, strong:1, duration:50})") is False,
              "адресный gamepad(0).rumble → false")
        check(a.eval("$.input.gamepad(1).rumble({})") is False,
              "второго геймпада движок не открывает — false")
        check(a.eval("engine.padRumble(0.5, 0.5, 100)") is False,
              "engine.padRumble без геймпада → false")
        check(a.eval("engine.padRumbleTriggers(0.5, 0.5, 100)") is False,
              "engine.padRumbleTriggers без геймпада → false")

        # --- Заглушки больше нет: старого предупреждения в журнале быть не должно
        log = a.stderr_tail(40)
        check("не подключён к SDL_RumbleGamepad" not in log,
              "движок не пишет «rumble не подключён»")

        # --- Кадр после тряски жив: вызов ничего не сломал ----------------------
        a.step(5)
        check(a.eval("$('#hero').pos().x") > 0, "сцена продолжает жить после rumble")

    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
