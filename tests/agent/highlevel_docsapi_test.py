#!/usr/bin/env python3
# ===========================================================================
# Тест «обещания справочника» — на расхождения, найденные аудитом
# docs/HIGH_LEVEL_API.md ↔ src/highlevel/*.js.
#
# Зачем отдельный тест: главный справочник не читал ни один тест, поэтому его
# примеры протухли — обещанный `.speed(250)` падал с TypeError в первом же
# примере, событие 'collision' из примера про пул пуль не срабатывало,
# `$.pool.tickPool()` и `$.input.rumble()` не существовали, а умолчания
# скорости тегов (enemy 90, npc 70) не доходили до .controls().
#
# Тест держит эти обещания: упал — значит справочник снова начал врать.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_docsapi_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "docsapi")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- .speed(): цепочка, которую обещает первый пример справочника ----
        check(a.eval("typeof $('#hero').speed") == "function",
              ".speed() существует как метод обёртки")
        check(a.eval("$('#hero').speed()") == 250, "player: скорость 250 из TAGS")
        check(a.eval("$('#foe').speed()") == 90, "enemy: скорость 90 из TAGS")
        check(a.eval("$('#villager').speed()") == 70, "npc: скорость 70 из TAGS")

        a.eval("$('#box').speed(120)")
        check(a.eval("$('#box').speed()") == 120, ".speed(120) задаёт скорость")
        check(a.eval("$('#box').attr('speed')") == 120,
              "скорость видна и через .attr('speed')")
        a.eval("$('#box').speed(0)")
        check(a.eval("$('#box').speed()") == 0, ".speed(0) — это ноль, а не «нет значения»")

        # --- Событие контакта: имя из документации и каноническое ------------
        check(a.eval("$.docsapi.collision") == 0, "счётчик 'collision' начинается с нуля")
        a.eval("$('#box').emit('collide', {})")
        check(a.eval("$.docsapi.collide") == 1, "каноническое 'collide' доходит")
        check(a.eval("$.docsapi.collision") == 1,
              "подписка на 'collision' из документации срабатывает на 'collide'")
        a.eval("$('#box').emit('collision', {})")
        check(a.eval("$.docsapi.collision") == 2,
              "emit('collision') тоже доходит до подписки")
        check(a.eval("$.docsapi.touched") == 0, "чужое событие не задевает 'hit'")

        # --- $.pool.tickPool() и $.pool.tick() --------------------------------
        check(a.eval("typeof $.pool.tickPool") == "function",
              "$.pool.tickPool() доступен из игры (обещан документацией)")
        check(a.eval("typeof $.pool.tick") == "function", "$.pool.tick() доступен")
        check(a.eval("$.pool.tickPool === $.pool.tick"), "это одна и та же функция")

        # --- $.input.rumble(): честная заглушка, а не отсутствие метода -------
        check(a.eval("typeof $.input.rumble") == "function",
              "$.input.rumble() существует (обещан таблицей ограничений)")
        check(a.eval("$.input.rumble({ strength: 1 })") is False,
              "без геймпада виброотклик честно возвращает false")
        check(a.eval("typeof $.input.gamepad(0).rumble") == "function",
              "адресный $.input.gamepad(0).rumble() на месте")

        # --- Узлы фикстуры живы, кадр идёт --------------------------------
        a.step(3)
        check(a.eval("engine.frame") > 0, "кадры идут")
        check(a.eval("$('#base').nodes.length") == 1, "фикстура собралась")

    print("Все проверки пройдены" if not FAILURES else "ПРОВАЛЕНО: %d" % len(FAILURES))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
