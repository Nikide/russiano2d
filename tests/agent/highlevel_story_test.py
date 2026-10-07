#!/usr/bin/env python3
# ===========================================================================
# Тест сценок: DSL сценариев, реплики, выборы, флаги и катсцена.
#
# Проверяется путь целиком: разбор текста, показ реплики, ожидание выбора,
# применение флагов, отбор управления у катсцены (@free этого не делает) и
# завершение по end с возвратом управления.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_story_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")

PROLOGUE = """@free
:start
set seen += 1
~ Пролог начался.
Некотян: Ты очнулся?
if seen < 2 -> start
objective Найди выход
end
"""

CUTSCENE = """Некотян: Кто здесь?
- Свой -> friend
- Молчать {silent = 1} -> end
:friend
set trust += 1
end
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5) as a:
        check(a.eval("typeof $.story") == "object", "$.story доступна игре")

        # --- Флаги и условия ---------------------------------------------------
        flags = a.eval("JSON.stringify($.story.parse('set trust = 2').commands[0])")
        check("trust" in flags, "разбор set-команды")

        # --- Сценка с @free: не отбирает управление ---------------------------
        check(a.eval("$.story.play({ text: %r })" % PROLOGUE) is True, "сценка запущена")
        check(a.eval("$.story.running()") is True, "сценка идёт")
        check(a.eval("$.story.locked()") is False, "@free не отбирает управление")

        # Первый кадр без автолистания: реплика стоит и ждёт игрока.
        a.step(1)
        check(a.eval("$.story.flags.seen") == 1, "set выполнился")
        line = a.eval("JSON.stringify($.story.last_line)")
        check("Пролог" in line, f"реплика показана: {line}")

        # Включаем автолистание: цикл `if seen < 2 -> start` проходит второй
        # раз и сценка заканчивается на end.
        a.eval("$.story.auto(true)")
        a.step(6)
        seen = a.eval("$.story.flags.seen")
        check(seen >= 2, f"цикл по метке прошёл (seen = {seen})")
        check(a.eval("$.story.running()") is False, "сценка дошла до end")
        a.eval("$.story.auto(false)")
        a.eval("$.story.stop()")

        # --- Катсцена: управление отобрано, выбор работает ---------------------
        a.eval("$.story.resetFlags()")
        a.eval("globalThis.__picked = 0")
        check(a.eval("$.story.play({ text: %r })" % CUTSCENE) is True, "катсцена запущена")
        a.eval("$.story.auto(true)")
        check(a.eval("$.story.locked()") is True, "катсцена отбирает управление")

        a.step(3)
        check(a.eval("$.story.flags.silent === undefined"), "до выбора флага нет")

        # Отвечаем за игрока: первый вариант — «Свой» (метка friend, trust += 1).
        a.eval("$.story.choose(0)")
        a.step(4)
        check(a.eval("$.story.flags.trust") == 1, "выбор применил флаг trust")
        check(a.eval("$.story.flags._last_choice") == 0, "запомнен номер выбора")
        check(a.eval("$.story.running()") is False, "после end сценка закончилась")
        check(a.eval("$.story.locked()") is False, "после конца управление вернулось")

        # --- Второй вариант ведёт в end и ставит свой флаг --------------------
        a.eval("$.story.resetFlags()")
        a.eval("$.story.play({ text: %r })" % CUTSCENE)
        a.step(3)
        a.eval("$.story.choose(1)")
        a.step(4)
        check(a.eval("$.story.flags.silent") == 1, "флаг варианта применён")
        check(a.eval("$.story.flags.trust === undefined"), "ветка friend не выполнялась")
        check(a.eval("$.story.running()") is False, "goto end завершил сценку")

        # --- Ошибки разбора уходят в журнал, но не роняют игру -----------------
        a.eval("$.story.play({ text: 'ерунда без двоеточия' })")
        a.step(1)
        check(a.eval("$.story.running()") in (True, False), "сценка с ошибкой не роняет движок")
        a.eval("$.story.stop()")

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
