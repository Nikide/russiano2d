#!/usr/bin/env python3
# ===========================================================================
# Проверка утверждений в понятиях мира — `$.expect(...)` (ROADMAP, фаза 6).
#
# Обещание: тест (и агент) формулирует ожидания селектором, а не самодельным JS
# через eval; провал приходит не только текстом, но и структурной деталью
# (subject/expected/actual) и попадает в снимок агента — чтобы падающий тест
# оставлял разбираемый артефакт.
#
# Фикстура tests/fixtures/within/main.js расставляет узлы по числам.
#
# Запуск после сборки:
#   python3 tests/agent/expect_test.py
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


def main():
    with Agent(game=GAME, seed=11, fixed_dt=1.0 / 60.0) as a:
        a.step(2)

        # --- успешные утверждения --------------------------------------------
        check(a.eval("typeof $.expect") == "function", "$.expect установлен")
        check(a.eval("$.expect('#hero').exists()") is True, "hero существует")
        check(a.eval("$.expect('#hero').hp(100)") is True, "hero: hp = 100")
        check(a.eval("$.expect('.enemy').count(3)") is True, "врагов трое")
        check(a.eval("$.expect('#hero').count(1)") is True, "hero один")
        check(a.eval("$.expect('#hero').positionNear(100, 100, 0.5)") is True,
              "hero стоит на (100, 100)")
        check(a.eval("$.expect('#hero').prop('id', 'hero')") is True,
              "свойство id = hero")
        check(a.eval("$.expect('#enemy0').prop('class', 'goblin enemy')") is True,
              "класс читается как строка (у enemy0 их два)")
        check(a.eval("$.expect('#nope').empty()") is True, "пустой селектор пуст")

        a.eval("$('#hero').attr('state', 'idle')")
        check(a.eval("$.expect('#hero').state('idle')") is True,
              "игровое состояние читается из свободного атрибута")

        # --- счётчик общий с $.test -------------------------------------------
        a.eval("$.test.reset()")
        a.eval("$.expect('#hero').exists()")
        a.eval("$.expect('.enemy').count(3)")
        results = json.loads(a.eval("JSON.stringify($.test.results())"))
        check(results["total"] == 2 and results["failed"] == 0,
              f"утверждения попали в общий счётчик: {results['total']} проверок")

        # --- провал: структурная деталь, а не только строка --------------------
        a.eval("$.test.reset()")
        check(a.eval("$.expect('#hero').hp(1)") is False, "hp(1) на 100 HP — провал")
        check(a.eval("$.expect('#hero').positionNear(100, 500, 0.5)") is False,
              "неверная позиция — провал")
        results = json.loads(a.eval("JSON.stringify($.test.results())"))
        check(results["failed"] == 2, f"провалов двое: {results['failed']}")
        details = results["details"]
        check(len(details) == 2, "детали провалов сохранены")
        check(details[0].get("subject") == "#hero", f"субъект в детали: {details[0].get('subject')}")
        check(details[0].get("expected") == 1 and details[0].get("actual") == 100,
              f"ожидание и факт в детали: {details[0]}")
        check(details[1].get("expected") == [100, 500], "позиция-ожидание в детали")

        # --- провалы видны агенту в снимке ------------------------------------
        snap = a.state()
        tests = snap.get("tests") or {}
        check(tests.get("failed") == 2, f"снимок агента видит провалы: {tests.get('failed')}")
        check(len(tests.get("details") or []) == 2, "детали попали в снимок агента")

        # --- провал не роняет игру -------------------------------------------
        a.step(3)
        check(a.eval("$('#hero').pos().x") == 100, "сцена продолжает жить")

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
