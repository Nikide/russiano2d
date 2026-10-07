#!/usr/bin/env python3
# ===========================================================================
# Тест отложенного перезапуска скриптов: запрос на границе кадра.
#
# Что проверяется:
#   * $.script.request() ставит запрос, но не перезапускает рантайм сразу;
#   * после кадра запрос снят и перезапуск прошёл (счётчик вырос);
#   * сразу после запроса текущий кадр доигрывается — игра отвечает на вызовы;
#   * $.script.hotReload() сообщает состояние слежения за файлами.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_reload_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=os.path.join("tests", "fixtures", "text"), seed=5) as a:
        check(a.eval("typeof $.script") == "object", "$.script доступна игре")
        check(a.eval("$.script.pending()") is False, "до запроса перезапуска нет")

        before = a.eval("$.script.count()")
        check(a.eval("$.script.request('тест')") is True, "запрос принят")
        check(a.eval("$.script.pending()") is True, "запрос ждёт границы кадра")

        # Кадр доигрывается: вызовы в том же кадре работают, рантайм ещё жив.
        check(a.eval("1 + 1") == 2, "в том же кадре рантайм отвечает")

        a.step(2)
        check(a.eval("$.script.pending()") is False, "после кадра запрос снят")
        check(a.eval("$.script.count()") > before, "рантайм перезапустился")
        check(a.eval("typeof $") == "function", "игра загрузилась заново")

        hot = a.eval("$.script.hotReload()")
        check(hot in (True, False), "состояние слежения читается")

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
