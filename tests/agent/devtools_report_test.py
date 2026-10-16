#!/usr/bin/env python3
# ===========================================================================
# DevTools §39: вкладка ДИАГ — отчёт об отладке (текст + JSON) и копирование.
#
# Снимок собирается только из существующих подсистем: версия движка, кадр/FPS,
# счётчики, пределы, диагностика ($.debug.report), профиль, рендер, таймеры и
# захваты hitch. Проверяется, что текст в панели равен данным и что кнопки
# копирования кладут в буфер обмена именно текст/JSON отчёта.
#
# Запуск после сборки:
#   python3 tests/agent/devtools_report_test.py
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


def ui(a, doc, element_id):
    raw = a.eval("engine.ui.getText(%s,%r)" % (doc, element_id)) or ""
    return (raw.replace("&quot;", '"').replace("&lt;", "<")
               .replace("&gt;", ">").replace("&amp;", "&"))


def safe(text):
    return text.replace("<", "\u2039").replace(">", "\u203a")


def click(a, doc, element_id):
    r = a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(3)


def main():
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(5)
        check(a.eval("$.devtools.openRuntime()") is True, "панель F1 открылась документом RmlUi")
        doc = a.eval("$.devtools.runtimePanel().doc")
        click(a, doc, "rt-tab-diag")
        check(a.eval("$.devtools.tabName()") == "diag", "клик открыл вкладку ДИАГ")
        a.step(5)

        # --- §39: снимок собран из существующих подсистем ----------------------
        rep = a.eval("$.devtools.report()")
        snap = rep["snapshot"]
        check(snap["version"] == a.eval("engine.version"),
              "версия движка в отчёте (%s)" % snap["version"])
        check(snap["frame"] == a.eval("$.debug.stats().frame"), "номер кадра в отчёте")
        check(abs(snap["fps"] - a.eval("$.debug.stats().fps")) < 1e-9, "FPS в отчёте")
        check(snap["counters"] == a.eval("$.debug.counters()"),
              "счётчики в отчёте = $.debug.counters()")
        check(snap["limits"] == a.eval("$.debug.limits()"),
              "пределы в отчёте = $.debug.limits()")
        check(snap["diagnostics"]["total"] == a.eval("$.debug.report()")["total"],
              "диагностика в отчёте = $.debug.report()")
        check(snap["profile"] and snap["profile"]["frames"] == a.eval("engine.profile().frames"),
              "окно профиля в отчёте")
        check(snap["render"] and snap["render"]["batches"] == a.eval("engine.renderInfo().batches"),
              "рендер-счётчики в отчёте")
        check(snap["timers"] == a.eval("$.time.timers()"), "таймеры в отчёте")

        # --- текст и JSON ------------------------------------------------------
        text = rep["text"]
        check(text.startswith("R2D DevTools report, версия %s" % snap["version"]),
              "текст отчёта начинается с версии")
        check("кадр %s" % snap["frame"] in text and "FPS" in text, "кадр и FPS в тексте")
        check("счётчики:" in text and "пределы:" in text, "счётчики и пределы в тексте")
        check("диагностика:" in text and "журнал" in text, "диагностика в тексте")
        check("профиль:" in text and "рендер:" in text and "таймеры:" in text,
              "профиль, рендер и таймеры в тексте")
        parsed = json.loads(rep["json"])
        check(parsed["version"] == snap["version"] and parsed["counters"] == snap["counters"],
              "JSON отчёта разбирается и совпадает со снимком (%s байт)" % len(rep["json"]))

        # --- панель показывает тот же текст ------------------------------------
        # Отчёт содержит номер кадра, а он меняется каждый кадр: чтобы сравнить
        # «видимое» с данными, обновляем панель и читаем оба значения в ОДНОМ
        # кадре (внутри одного eval).
        same = json.loads(a.eval("""
            (function () {
                $.devtools.refreshRuntime(true);
                const r = $.devtools.report();
                const d = $.devtools.runtimePanel().doc;
                return JSON.stringify({ text: r.text,
                                        ui: engine.ui.getText(d, 'rt-report-text') });
            })()
        """))
        shown = same["ui"]
        check(shown == safe(same["text"]), "текст отчёта в панели = данным report()")
        check(shown.startswith("R2D DevTools report") and "счётчики:" in shown,
              "панель показывает полный отчёт, а не обрывок")

        # --- кнопки копирования ------------------------------------------------
        a.eval("globalThis.__clip = ''; const __set = engine.setClipboard;"
               " engine.setClipboard = (t) => { globalThis.__clip = String(t); return __set(t); };")
        click(a, doc, "rt-report-copy")
        copied = a.eval("globalThis.__clip")
        # Номер кадра между чтениями меняется, поэтому сверяем структуру отчёта,
        # а не байты: та же версия, те же строки, те же счётчики.
        check(copied.split("\n")[0] == text.split("\n")[0]
              and len(copied.split("\n")) == len(text.split("\n"))
              and "счётчики: nodes=" in copied,
              "кнопка «Копировать текст» положила текст отчёта (%s байт, %s строк)"
              % (len(copied), len(copied.split("\n"))))
        check(a.eval("$.devtools.lastCopied()")["what"] == "report-text",
              "факт копирования текста записан")
        click(a, doc, "rt-report-copy-json")
        copied_json = a.eval("globalThis.__clip")
        check(json.loads(copied_json)["version"] == snap["version"],
              "кнопка «Копировать JSON» положила разбираемый JSON (%s байт)" % len(copied_json))
        check(a.eval("$.devtools.lastCopied()")["what"] == "report-json",
              "факт копирования JSON записан")
        check(any("скопирован" in line for line in a.eval("$.devtools.consoleLog()")),
              "копирование отражено в логе консоли")

        # --- отчёт не выдумывает: пустая диагностика так и названа -------------
        check("журнал чист" in text or "журнал не чист" in text,
              "состояние журнала диагностики названо словами")

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
