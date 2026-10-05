#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы CPU-частиц через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/particles и проверяет то, что видит игра:
# создание <particles>, залпы, one_shot, время жизни, лимит пула, управление
# эмиссией, рампы/параметры, режим local/global, пресеты и попадание частиц в
# общий батч спрайтов.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_particles_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "particles")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Пространство имён и фикстура -------------------------------------
        check(a.eval("typeof $.particles") == "object", "$.particles доступно")
        names = a.eval("$.particles.presets()")
        check(isinstance(names, list) and len(names) == 6, "шесть встроенных пресетов")
        check("fire" in (names or []), "пресет fire на месте")
        check(a.eval("$('#fx').length") == 1, "декларативный <particles> создан")
        check(a.eval("$('#fx').params().amount") == 16, "параметры узла прочитались")

        a.step(3)
        check(a.eval("$('#fx').count()") > 0, "непрерывная эмиссия идёт")

        # --- burst и one_shot --------------------------------------------------
        a.eval("$('#fx').stop(); $('#fx').clear(); $('#fx').burst(10)")
        check(a.eval("$('#fx').count()") == 10, "burst(10) даёт ровно 10 частиц")

        a.eval(
            "$('<particles>', { id: 'fx2', one_shot: true, amount: 12, lifetime: 2000,"
            " speed: 0, max_particles: 64, seed: 1 }).at(400, 300).appendTo($.world)"
        )
        a.step(1)
        check(a.eval("$('#fx2').count()") == 12, "one_shot выдаёт ровно amount=12")

        # --- Время жизни -------------------------------------------------------
        a.step(140)   # 2000 мс при 1/60 — это 120 кадров
        check(a.eval("$('#fx2').count()") == 0, "частицы исчезают по времени жизни")

        # --- Управление эмиссией ----------------------------------------------
        check(a.eval("$('#fx').isEmitting()") is False, "stop() выключил эмиссию")
        a.eval("$('#fx').start()")
        check(a.eval("$('#fx').isEmitting()") is True, "start() включил эмиссию")
        a.eval("$('#fx').emitting(false)")
        check(a.eval("$('#fx').emitting()") is False, "сеттер/геттер .emitting()")
        a.eval("$('#fx').restart()")
        check(a.eval("$('#fx').count()") == 0, "restart() очистил пул")
        check(a.eval("$('#fx').isEmitting()") is True, "restart() заново включил эмиссию")

        # --- Лимит пула --------------------------------------------------------
        a.eval(
            "$('<particles>', { id: 'fx3', amount: 100, max_particles: 6, lifetime: 5000,"
            " rate: 10000, speed: 0, seed: 3 }).at(400, 300).appendTo($.world)"
        )
        a.step(1)
        check(a.eval("$('#fx3').count()") == 6, "max_particles=6 сдержал поток")
        a.step(20)
        check(a.eval("$('#fx3').count()") <= 6, "пул не переполняется со временем")
        a.eval("$('#fx3').clear()")
        check(a.eval("$('#fx3').count()") == 0, "clear() убрал все частицы")

        # --- Частичное обновление и particleAt --------------------------------
        a.eval("$('#fx').params({ amount: 5, speed: [10, 20] })")
        check(a.eval("$('#fx').params().amount") == 5, "params({amount}) обновил лимит")
        check(a.eval("$('#fx').params().speed_min") == 10, "params({speed}) обновил скорость")

        a.eval("$('#fx').restart(); $('#fx').burst(5)")
        particle = a.eval("$('#fx').particleAt(0)")
        check(isinstance(particle, dict) and "x" in particle and "life" in particle,
              "particleAt(0) вернул частицу")
        check(a.eval("$('#fx').particleAt(99)") is None, "particleAt вне пула — None")

        # --- Детерминизм -------------------------------------------------------
        seed_spec = ("amount: 4, burst: [4], emitting: false, lifetime: 5000,"
                     " speed: [50, 50], spread: 360, seed: 77, max_particles: 16")
        a.eval("$('<particles>', { id: 'd1', " + seed_spec + " }).at(400, 300).appendTo($.world)")
        a.eval("$('<particles>', { id: 'd2', " + seed_spec + " }).at(400, 300).appendTo($.world)")
        a.step(2)
        check(a.eval("$('#d1').count()") == 4 and a.eval("$('#d2').count()") == 4,
              "оба эмиттера выдали залп")
        same = all(
            a.eval("$('#d1').particleAt(%d).%s" % (i, field))
            == a.eval("$('#d2').particleAt(%d).%s" % (i, field))
            for i in range(4) for field in ("x", "y", "vx", "vy")
        )
        check(same, "один seed — одинаковая эволюция частиц")

        # --- local / global ----------------------------------------------------
        glob = ("one_shot: true, amount: 1, lifetime: 5000, speed: 0,"
                " max_particles: 8, seed: 5")
        a.eval("$('<particles>', { id: 'loc', local: true, " + glob + " }).at(100, 200).appendTo($.world)")
        a.eval("$('<particles>', { id: 'glo', global: true, " + glob + " }).at(100, 200).appendTo($.world)")
        a.step(1)
        loc = a.eval("$('#loc').particleAt(0)")
        glo = a.eval("$('#glo').particleAt(0)")
        check(abs(loc["x"]) < 1 and abs(loc["y"]) < 1, "local хранит смещение от узла")
        check(abs(glo["x"] - 100) < 1 and abs(glo["y"] - 200) < 1,
              "global хранит мировые координаты")

        # --- Пресеты и create --------------------------------------------------
        a.eval("$('<particles>', $.particles.preset('fire', { id: 'fxfire', emitting: false }))"
               ".at(400, 300).appendTo($.world)")
        check(a.eval("$('#fxfire').length") == 1, "пресет fire создаёт эмиттер")
        check(a.eval("$.particles.create({ amount: 5, seed: 1 }).length") == 1,
              "$.particles.create() создаёт узел")
        a.eval("$('<particles>', { id: 'fxblend', blend: 'add', emitting: false })"
               ".at(400, 300).appendTo($.world)")
        a.step(1)
        check(a.eval("$('#fxblend').length") == 1, "blend не роняет создание (предупреждение один раз)")

        # --- Отрисовка ---------------------------------------------------------
        # Ставим эмиттер в начало мира — там камера по умолчанию его точно
        # видит, и сравниваем число спрайтов до и после залпа.
        a.eval("$('#d1').at(0, 0); $('#d1').clear()")
        a.step(1)
        base = a.eval("$.gfx.stats().sprites")
        a.eval("$('#d1').restart(); $('#d1').burst(4)")
        a.step(1)
        after = a.eval("$.gfx.stats().sprites")
        check(after >= base + 4,
              "частицы попали в батч спрайтов (base=%s, after=%s)" % (base, after))

        # --- Движок жив ---------------------------------------------------------
        check(a.ping().get("pong") is True, "движок отвечает после работы частиц")
        check(a.eval("engine.frame") > 0, "кадры идут")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
