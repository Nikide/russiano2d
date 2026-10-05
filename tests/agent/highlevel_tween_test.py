#!/usr/bin/env python3
# ===========================================================================
# Тест Tween-объектов ($.tween) через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/tween и проверяет в живом движке движение
# узла, порядок шагов и chain, loops, callback/method, finished, паузу через
# $.time.pause() и kill().
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_tween_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "tween")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Движение и параллельность первого шага --------------------------
        x0 = a.eval("$('#mover').pos().x")
        check(abs(x0) < 1.0, f"узел стартует в нуле (x={x0:.2f})")

        a.step(30)                     # ~0.5 с: половина первого шага
        x = a.eval("$('#mover').pos().x")
        alpha = a.eval("$('#mover').alpha()")
        y = a.eval("$('#mover').pos().y")
        check(30 < x < 70, f"property двигает узел (x={x:.1f})")
        check(0.6 < alpha < 0.9, f"второе свойство идёт параллельно (alpha={alpha:.2f})")
        check(abs(y) < 1.0, "шаг после chain ещё не начался (y=0)")

        a.step(30)                     # ~1.0 с: первый шаг завершён
        x = a.eval("$('#mover').pos().x")
        check(90 < x <= 100.5, f"первый шаг доехал до цели (x={x:.1f})")
        check(a.eval("$.store.get('moverSteps')") == 1, "step пришёл после первого шага")

        a.step(30)                     # ~1.5 с: второй шаг по chain
        y = a.eval("$('#mover').pos().y")
        alpha = a.eval("$('#mover').alpha()")
        check(abs(y - 40) < 1.0, f"chain запустил второй шаг (y={y:.1f})")
        check(0.4 < alpha < 0.6, f"alpha доведена до 0.5 ({alpha:.2f})")
        check(a.eval("$.store.get('moverSteps')") == 2, "step пришёл и на втором шаге")
        check(a.eval("$.store.get('moverDone')") == 1, "finished пришёл ровно один раз")
        check(a.eval("$.store.get('moverTween').isRunning()") is False,
              "после finished твин не running")

        # --- loops(3) ---------------------------------------------------------
        a.step(30)                     # суммарно ~2.0 с > 1.5 с трёх проходов
        check(a.eval("$.store.get('loopCount')") == 2, "loop пришёл между проходами (2)")
        check(a.eval("$.store.get('loopDone')") == 1, "finished после всех проходов — один")
        lx = a.eval("$('#looper').pos().x")
        check(abs(lx - 50) < 1.0, f"цикл закончился на цели (x={lx:.1f})")
        check(a.eval("$.store.get('looperTween').isValid()") is True,
              "завершённый твин остаётся валидным")

        # --- callback и method ------------------------------------------------
        check(a.eval("$.store.get('cbFired')") >= 1, "callback сработал")
        mv = a.eval("$.store.get('methodValue')")
        check(abs(mv - 10) < 0.5, f"method довёл значение до 10 ({mv:.2f})")

        # --- Пауза игрового времени ------------------------------------------
        a.eval("(function(){ var t = $.tween($('#pauser'));"
               " t.property('x', 300, 1); $.store.set('pauseTween', t); return true; })()")
        a.step(10)
        x1 = a.eval("$('#pauser').pos().x")
        check(x1 > 0, f"твин паузы пошёл (x={x1:.1f})")

        a.eval("(function(){ $.time.pause(); return true; })()")
        a.step(15)
        x2 = a.eval("$('#pauser').pos().x")
        check(abs(x2 - x1) < 1e-6, "на паузе $.time.pause() твин заморожен")
        check(a.eval("$.store.get('pauseTween').isPaused()") is False,
              "isPaused() относится к самому твину, а не к паузе времени")

        a.eval("(function(){ $.time.resume(); return true; })()")
        a.step(15)
        x3 = a.eval("$('#pauser').pos().x")
        check(x3 > x2, f"после resume твин продолжил движение (x={x3:.1f})")

        # --- kill() -----------------------------------------------------------
        a.eval("(function(){ var t = $.tween($('#victim'));"
               " t.property('x', 300, 0.5);"
               " t.on('finished', function(){ $.store.set('victimDone',"
               " $.store.get('victimDone') + 1); });"
               " $.store.set('victimTween', t); return true; })()")
        a.step(12)
        vx = a.eval("$('#victim').pos().x")
        check(vx > 0, f"убиваемый твин двигает узел (x={vx:.1f})")
        a.eval("(function(){ $.store.get('victimTween').kill(); return true; })()")
        check(a.eval("$.store.get('victimTween').isValid()") is False, "kill() делает твин невалидным")
        check(a.eval("$.store.get('victimTween').isRunning()") is False, "убитый твин не running")

        a.step(30)
        vx2 = a.eval("$('#victim').pos().x")
        check(abs(vx2 - vx) < 1e-6, "после kill() узел больше не двигается")
        check(a.eval("$.store.get('victimDone')") == 0, "после kill() finished не приходит")

        # --- Ошибка в callback не роняет кадр ---------------------------------
        a.eval("(function(){ var t = $.tweenOf({ x: 0 });"
               " t.callback(function(){ throw new Error('бум'); }); return true; })()")
        a.step(2)
        check(a.ping().get("pong") is True, "ошибка в callback не остановила движок")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
