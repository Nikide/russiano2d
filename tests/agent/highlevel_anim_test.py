#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы анимации $.anim через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/anim и проверяет клипы (once/loop/pingpong),
# события в процентах, скорость, паузу, цепочные методы узла и переходы
# машины состояний по условию.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_anim_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "anim")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        # --- Реестр клипов ----------------------------------------------------
        check(a.eval("$.anim.has('slide')") is True, "клип объявлен и виден в $.anim.has")
        check(a.eval("$.anim.list().includes('spin')") is True, "$.anim.list содержит клип")
        check(a.eval("$.anim.get('slide').duration") == 1000, "$.anim.get отдаёт duration")
        check(a.eval("$.anim.get('slide').loop") == "once", "loop клипа сохранён")
        check(a.eval("$.anim.get('нет-такого')") is None, "неизвестный клип — null")

        # --- Клип once: интерполяция, событие, конец --------------------------
        check(a.eval("$('#actor').isPlayingClip()") is True, "playClip запустил клип")
        a.step(15)
        x = a.eval("$('#actor').pos().x")
        check(10 < x < 90, f"дорожка x интерполируется (x={x:.1f})")
        progress = a.eval("$('#actor').clipProgress()")
        check(0.1 < progress < 0.4, f"clipProgress растёт ({progress:.2f})")
        clip_time = a.eval("$('#actor').clipTime()")
        check(50 < clip_time < 450, f"clipTime в миллисекундах ({clip_time:.0f})")

        a.step(20)   # суммарно ~0.58 с — событие на 50 % уже прошло
        check(a.eval("$.store.get('lastKey')") == "slideHalf",
              "событие внутри клипа дошло как key")

        a.step(40)   # суммарно больше длительности
        check(a.eval("$('#actor').isPlayingClip()") is False, "once-клип завершился")
        check(a.eval("$.store.get('slideEnds')") >= 1, "clipEnd пришёл на узел")
        check(abs(a.eval("$('#actor').pos().x") - 100) < 0.5, "к концу клип довёл x до 100")
        check(abs(a.eval("$('#actor').alpha()") - 0.2) < 0.01, "дорожка alpha доехала до 0.2")

        # --- Клип loop --------------------------------------------------------
        angle0 = a.eval("$('#spinner').rotation()")
        a.step(20)
        angle1 = a.eval("$('#spinner').rotation()")
        check(angle0 != angle1, "loop-клип продолжает менять свойство")
        check(a.eval("$('#spinner').isPlayingClip()") is True, "loop-клип не завершается")

        # --- Клип pingpong ----------------------------------------------------
        # Перезапускаем клип: к этому моменту мир прожил ~75 кадров, и пик
        # (u = 1.0) уже позади — без restart выборка просто не увидела бы
        # максимум, хотя сам pingpong работает верно.
        a.eval("$('#pulsar').playClip('pulse', { restart: true })")
        samples = []
        for _ in range(65):
            a.step(1)
            samples.append(a.eval("$('#pulsar').get(0).scale_x"))
        check(max(samples) > 1.7, f"pingpong доходит до максимума ({max(samples):.2f})")
        check(min(samples) < 1.3, f"pingpong возвращается к минимуму ({min(samples):.2f})")

        # --- Пауза, скорость, остановка --------------------------------------
        a.eval("$('#spinner').pauseClip()")
        paused0 = a.eval("$('#spinner').clipTime()")
        a.step(5)
        paused1 = a.eval("$('#spinner').clipTime()")
        check(abs(paused0 - paused1) < 1e-6, "pauseClip замораживает время клипа")
        check(a.eval("$('#spinner').isPlayingClip()") is True, "на паузе клип ещё не завершён")
        a.eval("$('#spinner').resumeClip()")
        a.step(5)
        check(a.eval("$('#spinner').clipTime()") != paused1, "resumeClip продолжает время")

        a.eval("$('#spinner').clipSpeed(2)")
        check(abs(a.eval("$('#spinner').clipSpeed()") - 2) < 1e-6, "clipSpeed читается обратно")

        a.eval("$('#spinner').playClip('spin', { restart: true })")
        check(abs(a.eval("$('#spinner').clipProgress()")) < 1e-9, "restart сбрасывает прогресс")
        a.eval("$('#spinner').stopClip()")
        check(a.eval("$('#spinner').isPlayingClip()") is False, "stopClip останавливает клип")

        # --- Машина состояний -------------------------------------------------
        check(a.eval("$('#walker').state()") == "idle", "машина стартует с initial")
        check(a.eval("$('#walker').states().length") == 2, "$.states() перечисляет состояния")
        check(a.eval("$.store.get('lastState')") == "idle", "stateEnter пришёл на initial")

        a.eval("$('#walker').attr('moving', true)")
        a.step(3)
        check(a.eval("$('#walker').state()") == "walk", "переход по when сработал")
        check(a.eval("$.store.get('lastState')") == "walk", "stateEnter пришёл на новое состояние")
        check(a.eval("$('#walker').stateTime()") >= 0, "stateTime отвечает числом")

        a.eval("$('#walker').toState('idle')")
        check(a.eval("$('#walker').state()") == "idle", "toState переключает состояние")

        # --- Ошибки не роняют кадр -------------------------------------------
        a.eval("$('#actor').playClip('нет-такого')")
        a.step(2)
        check(a.ping().get("pong") is True, "неизвестный клип не останавливает движок")

        a.eval("$.anim.clear()")
        check(a.eval("$.anim.list().length") == 0, "$.anim.clear очищает реестр")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
