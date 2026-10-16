#!/usr/bin/env python3
# ===========================================================================
# DevTools §31/§33: вкладки КОНСОЛЬ и ШАГ.
#
# КОНСОЛЬ: команды — тонкие обёртки над существующими API (pause/resume/step/
# timescale/reload/dump/errors/watches/goto-node), история с повтором по клику,
# лог в панели равен данным. ШАГ: пауза, шаг кадра (время идёт ровно N кадров и
# пауза возвращается сама), hit-stop, замедление, масштабы 0.1…2 и свой.
#
# Запуск после сборки:
#   python3 tests/agent/devtools_console_test.py
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


def ui(a, doc, element_id):
    raw = a.eval("engine.ui.getText(%s,%r)" % (doc, element_id)) or ""
    return (raw.replace("&quot;", '"').replace("&lt;", "<")
               .replace("&gt;", ">").replace("&amp;", "&"))


def click(a, doc, element_id):
    r = a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(3)


def type_and_run(a, doc, text):
    a.eval("engine.ui.setValue(%s,'rt-console-input',%r)" % (doc, text))
    click(a, doc, "rt-console-run")


def main():
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(5)
        check(a.eval("$.devtools.openRuntime()") is True, "панель F1 открылась документом RmlUi")
        doc = a.eval("$.devtools.runtimePanel().doc")

        # --- §31 CONSOLE -------------------------------------------------------
        click(a, doc, "rt-tab-console")
        check(a.eval("$.devtools.tabName()") == "console", "клик открыл вкладку КОНСОЛЬ")
        a.step(4)
        check("Консоль пуста" in ui(a, doc, "rt-console-log"),
              "пустая консоль говорит об этом прямо")

        type_and_run(a, doc, "help")
        check("pause" in a.eval("$.devtools.consoleLast().out"), "help перечисляет команды")
        type_and_run(a, doc, "pause")
        check(a.eval("$.time.isPaused()") is True, "команда pause поставила паузу")
        type_and_run(a, doc, "resume")
        check(a.eval("$.time.isPaused()") is False, "команда resume сняла паузу")
        type_and_run(a, doc, "timescale 0.5")
        check(abs(a.eval("$.time.scale()") - 0.5) < 1e-9, "timescale 0.5 применён движку")
        type_and_run(a, doc, "timescale abc")
        check(abs(a.eval("$.time.scale()") - 0.5) < 1e-9
              and a.eval("$.devtools.consoleLast().ok") is False,
              "невалидный аргумент отклонён, движок не тронут")
        a.eval("$.devtools.timeScale(1)")
        type_and_run(a, doc, "goto-node #enemy0")
        check(a.eval("$.devtools.panel().selector") == "#enemy0",
              "goto-node выбрал узел в инспекторе F2")
        type_and_run(a, doc, "goto-node #nope")
        check(a.eval("$.devtools.consoleLast().ok") is False, "несуществующий узел — ошибка команды")
        type_and_run(a, doc, "errors")
        check("ошибок" in a.eval("$.devtools.consoleLast().out"), "команда errors отвечает сводкой")
        type_and_run(a, doc, "watches")
        check("наблюдений нет" in a.eval("$.devtools.consoleLast().out"),
              "команда watches честно говорит, что наблюдений нет")
        type_and_run(a, doc, "dump")
        check("отчёт собран" in a.eval("$.devtools.consoleLast().out"), "команда dump собирает отчёт")
        type_and_run(a, doc, "no-such-command")
        check(a.eval("$.devtools.consoleLast().ok") is False
              and "неизвестная команда" in a.eval("$.devtools.consoleLast().out"),
              "неизвестная команда объяснена")

        hist = a.eval("$.devtools.consoleHistory()")
        check(len(hist) >= 8 and hist[-1] == "no-such-command", "история команд копится (%s)" % len(hist))
        log_before = len(a.eval("$.devtools.consoleLog()"))
        click(a, doc, "rt-console-h-0")
        check(len(a.eval("$.devtools.consoleLog()")) > log_before,
              "клик по строке истории повторил команду")
        # Панель показывает «>» похожим знаком (RmlUi setText разбирает < >),
        # поэтому сравниваем с той же заменой.
        expected_log = "\n".join(a.eval("$.devtools.consoleLog()")).replace(">", "\u203a").replace("<", "\u2039")
        check(ui(a, doc, "rt-console-log") == expected_log,
              "лог в панели = данным consoleLog()")
        click(a, doc, "rt-console-clear")
        check(a.eval("$.devtools.consoleLog()") == [] and "Консоль пуста" in ui(a, doc, "rt-console-log"),
              "кнопка «Очистить лог» очистила и панель")

        # --- §33 FRAME STEPPING ------------------------------------------------
        click(a, doc, "rt-tab-step")
        check(a.eval("$.devtools.tabName()") == "step", "клик открыл вкладку ШАГ")
        a.step(4)
        step = a.eval("$.devtools.timeStep()")
        check(step["paused"] is False and abs(step["scale"] - 1) < 1e-9,
              "исходное состояние: без паузы, масштаб 1")
        click(a, doc, "rt-step-pause")
        check(a.eval("$.time.isPaused()") is True, "кнопка «Пауза» остановила время")
        check("пауза: да" in ui(a, doc, "rt-step-state"), "пауза видна в состоянии панели")

        # Метрика шага — ИГРОВОЕ время: номер кадра растёт и на паузе (кадры
        # рисуются всегда), а $.time.now() стоит, пока время остановлено.
        time_before = a.eval("$.time.now()")
        a.step(10)
        check(abs(a.eval("$.time.now()") - time_before) < 1e-9, "на паузе игровое время стоит")
        click(a, doc, "rt-step-frame")
        a.step(6)
        advanced = a.eval("$.time.now()") - time_before
        check(0.005 < advanced < 0.2,
              "шаг кадра продвинул игровое время на ~кадр (%.4f с)" % advanced)
        check(a.eval("$.time.isPaused()") is True, "после шага пауза вернулась сама")
        time_after_step = a.eval("$.time.now()")
        a.step(10)
        check(abs(a.eval("$.time.now()") - time_after_step) < 1e-9,
              "после шага время снова стоит")
        check(a.eval("$('#hero').pos().x") == 100, "на паузе мир не двигался")

        a.eval("$.devtools.steps(5)")
        a.step(10)
        check(a.eval("$.time.isPaused()") is True, "после серии шагов пауза снова на месте")

        click(a, doc, "rt-step-resume")
        check(a.eval("$.time.isPaused()") is False, "кнопка «Продолжить» сняла паузу")

        click(a, doc, "rt-step-scale-05")
        check(abs(a.eval("$.time.scale()") - 0.5) < 1e-9, "кнопка 0.5× выставила масштаб")
        check("масштаб 0.50" in ui(a, doc, "rt-step-state"), "масштаб виден в панели")
        a.eval("engine.ui.setValue(%s,'rt-step-scale-custom','1.75')" % doc)
        click(a, doc, "rt-step-scale-apply")
        check(abs(a.eval("$.time.scale()") - 1.75) < 1e-9, "свой масштаб 1.75 из поля")
        a.eval("engine.ui.setValue(%s,'rt-step-scale-custom','abc')" % doc)
        click(a, doc, "rt-step-scale-apply")
        check(abs(a.eval("$.time.scale()") - 1.75) < 1e-9, "невалидный масштаб не применён")

        click(a, doc, "rt-step-hit")
        check(a.eval("$.time.freezeLeft()") > 0, "кнопка Hit-stop заморозила кадры (осталось мс > 0)")
        click(a, doc, "rt-step-slow")
        check(a.eval("$.time.slowCount()") >= 1, "кнопка замедления включила slow-motion")
        click(a, doc, "rt-step-reset")
        check(abs(a.eval("$.time.scale()") - 1) < 1e-9 and a.eval("$.time.isPaused()") is False
              and a.eval("$.time.freezeLeft()") == 0,
              "кнопка «Сбросить время» вернула масштаб 1, сняла паузу и hit-stop")
        check("Шага физики отдельно нет" in ui(a, doc, "rt-step-notes"),
              "панель честно объясняет, почему шага физики нет отдельно")

        a.eval("$.devtools.closeRuntime()")
        a.step(3)
        check(a.eval("$('#hero').pos().x") == 100, "игра продолжает работать")

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
