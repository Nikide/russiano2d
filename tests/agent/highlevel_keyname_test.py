#!/usr/bin/env python3
# ===========================================================================
# Проверка: $.input.on('key') отдаёт ИМЯ клавиши, а не число.
#
# Регрессия на настоящую ошибку: биндинг engine.keyName в движке был, но
# input.js его не звал — таблица KEY_NAMES никем не заполнялась, и обработчик
# получал номер скан-кода. Из-за этого нельзя было показать «нажмите Пробел» и
# трудно было делать ребинд.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_keyname_test.py
# ===========================================================================

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
    with Agent(game=GAME, seed=5) as a:
        # Space = 44, A = 4 — скан-коды SDL, а не ASCII.
        check(a.eval("engine.keyName(44)") == "Space", "движок знает имя Space")
        check(a.eval("engine.keyName(4)") == "A", "движок знает имя A")

        a.eval("""
            globalThis.__keys = [];
            $.input.on('key', (e) => __keys.push(String(e.key)));
        """)
        a.eval("$.update(() => {})")
        a.step(1)

        a.key("Space", "down")
        a.step(2)
        got = a.eval("__keys.join(',')")
        check("Space" in got, f"обработчик получил имя клавиши: «{got}»")
        check(got != "44", "это не номер скан-кода")

        a.key("Space", "up")
        a.step(2)
        a.key("A", "down")
        a.step(2)
        got = a.eval("__keys.join(',')")
        check("A" in got, f"вторая клавиша тоже с именем: «{got}»")

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
