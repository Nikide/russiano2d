#!/usr/bin/env python3
# ===========================================================================
# Проверка DevTools в движке (ROADMAP, фаза 8): панель на RmlUi, F2, выбор.
#
# Юнит-тест tests/js/devtools_test.mjs проверяет состояние без GUI. Здесь —
# что панель действительно открывается документом RmlUi, что F2 её
# переключает, что список и выбор дают селектор для копирования и что закрытие
# не ломает кадр.
#
# Фикстура tests/fixtures/within/main.js: hero + три врага + два спрайта.
#
# Запуск после сборки:
#   python3 tests/agent/devtools_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def panel(a):
    return json.loads(a.eval("JSON.stringify($.devtools.panel())"))


def main():
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(2)

        check(a.eval("typeof $.devtools") == "object", "$.devtools установлен")
        check(a.eval("typeof engine.ui.loadMarkup") == "function",
              "движок умеет документ из строки разметки")
        check(panel(a)["open"] is False, "сначала панель закрыта")

        # --- открытие панели ---------------------------------------------------
        check(a.eval("$.devtools.open()") is True, "панель открылась")
        p = panel(a)
        check(p["open"] is True, "panel() видит открытие")
        check(p["doc"] >= 0, f"документ RmlUi создан: id={p['doc']}")
        check(p["entities"] >= 6, f"сущности перечислены: {p['entities']}")
        check(0 < p["rows"] <= 24, f"строк в списке: {p['rows']}")
        check(a.eval("engine.ui.visible(0)") is not None, "низкий уровень UI жив")

        # --- выбор сущности и селектор для копирования --------------------------
        check(a.eval("$.devtools.selectBy('#hero')") == "#hero", "selectBy по id")
        check(panel(a)["selector"] == "#hero", "panel() видит селектор")
        check(a.eval("$.devtools.selectBy('.goblin')") == "#enemy0",
              "без id выбирается первый подходящий и берётся его id")

        # --- F2 переключает панель --------------------------------------------
        a.key("F2", "tap")
        a.step(2)
        check(panel(a)["open"] is False, "F2 закрыла панель")
        a.key("F2", "tap")
        a.step(2)
        check(panel(a)["open"] is True, "F2 снова открыла")

        # --- обновление по кадрам и закрытие -----------------------------------
        before = panel(a)["refreshed"]
        a.step(8)
        check(panel(a)["refreshed"] > before, "содержимое обновляется по кадрам")
        check(a.eval("$.devtools.close()") is True, "панель закрылась")
        check(panel(a)["open"] is False, "panel() видит закрытие")

        # --- мир не тронут -----------------------------------------------------
        a.step(3)
        check(a.eval("$('#hero').pos().x") == 100, "игра продолжает работать")
        check(a.eval("engine.bodyCount()") == 4, "тела на месте")

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
