#!/usr/bin/env python3
# ===========================================================================
# Проверка запроса `$('.enemy').within('#hero', 500)` в движке — ROADMAP, фаза 1.
#
# Юнит-тест tests/js/within_test.mjs проверяет чистую фильтрацию без движка.
# Здесь — главное обещание: выборка в радиусе считается НАТИВНЫМ запросом
# (broadphase Box2D через engine.queryCircle), узлы без тела не теряются,
# порядок результата детерминирован, а массовая операция поверх выборки
# (remove) работает.
#
# Фикстура tests/fixtures/within/main.js расставляет узлы по числам, поэтому
# ожидаемые длины проверяются арифметикой.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_within_test.py
# ===========================================================================

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
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(2)

        # --- выборка в радиусе от сущности ---------------------------------
        check(a.eval("typeof $('#hero').within") == "function",
              ".within() есть у обёртки")
        check(a.eval("$('.enemy').within('#hero', 500).length") == 2,
              "враги в 500 px: двое (200 и 400)")
        check(a.eval("$('.enemy').within('#hero', 200).length") == 1,
              "ровно на границе радиуса — попадает")
        check(a.eval("$('.goblin').within('#hero', 250).length") == 2,
              "враг на 200 px и спрайт без тела на 50 px")
        check(a.eval("$('.goblin').within('#hero', 50).length") == 1,
              "спрайт без тела считается по координатам")
        check(a.eval("$('enemy').within('#hero', 100).length") == 0,
              "в 100 px нет ни одного тела: ближайший враг на 200")
        check(a.eval("$('.goblin').within('#hero', 100).length") == 1,
              "…но спрайт без тела на 50 px в выборке есть")

        # --- цель: точка, узел, обёртка, пустой селектор --------------------
        check(a.eval("$('.enemy').within({ x: 500, y: 100 }, 10).length") == 1,
              "цель-точка: враг стоит ровно в ней")
        check(a.eval("$('.enemy').within($('#hero'), 250).length") == 1,
              "цель-обёртка (первый узел выборки)")
        check(a.eval("$('.enemy').within('#hero', -1).length") == 0,
              "отрицательный радиус — пусто, без исключения")
        check(a.eval("$('.enemy').within('#nope', 500).length") == 0,
              "пустой селектор-цель — пусто, без исключения")
        check(a.eval("$('.enemy').within(null, 500).length") == 0,
              "null-цель — пусто, без исключения")

        # --- нативный низкий уровень ---------------------------------------
        check(a.eval("Object.prototype.toString.call(engine.queryCircle(100, 100, 250, 0))")
              == "[object Int32Array]",
              "engine.queryCircle возвращает Int32Array")
        check(a.eval("engine.queryCircle(100, 100, 250, 0).length") == 2,
              "в радиусе 250 px тел: герой и враг на 200 px")
        check(a.eval("engine.queryCircle(100, 100, 250, 0x1).length") == 2,
              "маска слоя 1 (по умолчанию у всех тел) ничего не отсеивает")
        order = a.eval(
            "(() => {"
            "  const ids = engine.queryCircle(100, 100, 1000, 0);"
            "  const t = engine.getTransforms();"
            "  const d = [];"
            "  for (let i = 0; i < ids.length; i++) {"
            "    const id = ids[i];"
            "    d.push(Math.round(Math.hypot(t[id * 3] - 100, t[id * 3 + 1] - 100)));"
            "  }"
            "  return d.join(',');"
            "})()")
        check(order == "0,200,400,900",
              f"порядок по расстоянию детерминирован: {order}")

        # --- диагностика запроса (фаза 2) -----------------------------------
        a.eval("$('.enemy').within('#hero', 250)")
        stats = a.eval("$.debug.queryStats()")
        check(isinstance(stats, dict), "$.debug.queryStats() отдаёт объект")
        check(stats.get("calls", 0) > 0, "вызовы нативного запроса посчитаны")
        check(stats.get("candidates", 0) >= stats.get("results", 0),
              f"кандидатов не меньше результата: {stats}")
        check(stats.get("cap") == 256, "предел запроса виден")
        check(stats.get("truncated") is False, "в предел не упёрлись")
        check(stats.get("results") == 2,
              f"результат последнего запроса — двое: {stats}")

        # --- массовая операция поверх выборки -------------------------------
        before_bodies = a.eval("engine.bodyCount()")
        check(a.eval("$('.goblin').within('#hero', 250).remove().length") == 2,
              "remove() поверх выборки вернул саму выборку")
        check(a.eval("$('.goblin').length") == 2, "осталось двое дальних")
        check(a.eval("engine.bodyCount()") == before_bodies - 1,
              "тело удалённого врага уничтожено")
        check(a.eval("typeof engine.bodyAlive") == "function",
              "низкий уровень (engine.bodyAlive) на месте")

        # --- сохранность остальных узлов -------------------------------------
        check(a.eval("$('#hero').length") == 1, "герой на месте")
        check(a.eval("$('#far').length") == 1, "дальний спрайт на месте")

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
