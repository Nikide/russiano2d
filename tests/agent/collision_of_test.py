#!/usr/bin/env python3
# ===========================================================================
# Тест $.collision.of (task-68): имя слоя узла по ЛЮБОЙ цели.
#
# До правки строка-селектор не разворачивалась: of($('#hero')) → 'player',
# а of('#hero') → null. Тест фиксирует единый контракт цели (селектор, узел,
# обёртка) и связь с вопросами «с чем сталкивается» ($.world.contactsOf /
# $.world.touching), для которых второй синоним не заводится.
#
# Запуск (собранный движок):
#   python3 tests/agent/collision_of_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "world_api")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5) as a:
        check(a.eval("typeof $.collision.of") == "function", "$.collision.of существует")

        # Сохранённое поведение: обёртка и сырой узел.
        check(a.eval("$.collision.of($('#hero'))") == "player",
              "of(обёртка) = 'player'")
        check(a.eval("$.collision.of($('#hero').get(0))") == "player",
              "of(сырой узел) = 'player'")

        # Новое: строковый селектор разворачивается.
        check(a.eval("$.collision.of('#hero')") == "player",
              "of('#hero') = 'player' (селектор развёрнут)")
        check(a.eval("$.collision.of('.goblin')") == "enemies",
              "of('.goblin') = 'enemies' (первый узел выборки)")
        check(a.eval("$.collision.of('#goblin-2')") == "enemies",
              "of('#goblin-2') = 'enemies' (быстрый путь по id)")

        # Селектор и обёртка дают один и тот же ответ.
        check(a.eval("$.collision.of('#hero') === $.collision.of($('#hero'))") is True,
              "селектор и обёртка отвечают одинаково")

        # Узел без слоя и промах — null (не исключение).
        check(a.eval("$.collision.of('#marker')") is None,
              "of('#marker') = null: слой не ставился")
        check(a.eval("$.collision.of('#nope')") is None,
              "of('#nope') = null: селектор ничего не нашёл")
        check(a.eval("$.collision.of(null)") is None, "of(null) = null")
        check(a.eval("$.collision.of(123)") is None, "of(123) = null")

        # Метод узла .layerName() — тот же ответ (один путь).
        check(a.eval("$('#hero').layerName()") == "player",
              ".layerName() читает то же имя")
        check(a.eval("$('#hero').layerName() === $.collision.of('#hero')") is True,
              ".layerName() и of() не расходятся")

        # Связь с вопросами о столкновениях: of() — слой, контакты — факты.
        check(a.eval("typeof $.world.contactsOf") == "function",
              "«с кем сталкивается» отвечает $.world.contactsOf")
        check(a.eval("typeof $.world.touching") == "function",
              "«касаются ли двое» отвечает $.world.touching")
        check(a.eval("$.collision.of === $.collision.of") is True,
              "of() — один метод, второго имени для того же нет")

    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
