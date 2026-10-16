#!/usr/bin/env python3
# ===========================================================================
# DevTools §29: вкладка MEM — ресурсы и память.
#
# Панель показывает $.debug.counters() и $.debug.limits() как есть, дельты к
# базовой линии и рост счётчиков: если счётчик растёт в каждом замере окна —
# это «подозрение на утечку», если замеров мало — панель честно говорит, что
# вывод преждевременен.
#
# Запуск после сборки:
#   python3 tests/agent/devtools_memory_test.py
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
        click(a, doc, "rt-tab-memory")
        check(a.eval("$.devtools.tabName()") == "memory", "клик открыл вкладку MEM")
        a.step(6)

        mem = a.eval("$.devtools.memory()")
        counters = a.eval("$.debug.counters()")
        limits = a.eval("$.debug.limits()")
        check(mem["counters"] == counters, "счётчики = $.debug.counters()")
        check(mem["limits"] == limits, "пределы = $.debug.limits()")
        check("nodes: %d" % counters["nodes"] in mem["text"]["counters"],
              "значение счётчика видно в панели")
        check("textures_max: %s" % limits["textures_max"] in mem["text"]["limits"],
              "предел таблицы текстур виден в панели")
        check(ui(a, doc, "rt-mem-counters").endswith(mem["text"]["counters"].split("\n")[-1]),
              "строка счётчиков в панели = данным")
        check(mem["samples"] >= 2, "окно замеров копится (%s замеров)" % mem["samples"])

        # --- дельта к базовой линии -------------------------------------------
        click(a, doc, "rt-mem-baseline")
        a.step(3)
        base_nodes = a.eval("$.debug.counters().nodes")
        a.eval("(() => { for (let i = 0; i < 3; i++) $('<rect>', { id: 'mem' + i }).at(10 + i, 10).appendTo($.world); return true; })()")
        a.step(4)
        mem = a.eval("$.devtools.memory()")
        check(mem["deltas"]["nodes"] == 3,
              "дельта узлов после сброса базовой линии = +3 (Δ %s)" % mem["deltas"]["nodes"])
        check("nodes: %d (Δ +3)" % (base_nodes + 3) in mem["text"]["counters"],
              "дельта видна в панели")
        check(mem["leaks"] == [], "разовый рост утечкой не считается")

        # --- монотонный рост = подозрение на утечку ---------------------------
        # Рост должен длиться дольше окна замеров (панель обновляется 10 Гц,
        # а замер копится раз в кадр): иначе рост прекратится раньше вывода.
        a.eval("globalThis.__grow = 200;"
               " $.update(() => { if (globalThis.__grow-- > 0) $('<rect>').at(5, 5).appendTo($.world); })")
        a.step(70)
        mem = a.eval("$.devtools.memory()")
        check(mem["samples"] >= 6, "окно замеров заполнилось (%s)" % mem["samples"])
        keys = [l["key"] for l in mem["leaks"]]
        check("nodes" in keys,
              "монотонный рост узлов помечен как подозрение на утечку (%s)" % keys)
        check("растёт последние" in mem["text"]["leaks"],
              "строка о росте видна в панели: %s" % mem["text"]["leaks"].split("\n")[0])
        check(all(l["to"] > l["from"] for l in mem["leaks"]),
              "у каждого подозрения показано «было → стало» по факту")

        # Панель и данные — из одного кадра: принудительное обновление и чтение
        # в одном eval, иначе окно замеров успевает сдвинуться между вызовами.
        snap = json.loads(a.eval("""
            (function () {
                $.devtools.refreshRuntime(true);
                const m = $.devtools.memory();
                const d = $.devtools.runtimePanel().doc;
                return JSON.stringify({ leaks: m.text.leaks, counters: m.text.counters,
                                        ui_leaks: engine.ui.getText(d, 'rt-mem-leaks'),
                                        ui_counters: engine.ui.getText(d, 'rt-mem-counters') });
            })()
        """))
        check(snap["ui_leaks"] == snap["leaks"], "блок роста в панели = данным")
        check(snap["ui_counters"] == snap["counters"], "строка счётчиков в панели = данным")

        # --- стабильные счётчики: ложных подозрений быть не должно -------------
        a.eval("globalThis.__grow = 0")
        a.step(70)      # окно замеров полностью обновляется стабильными числами
        stable = a.eval("$.devtools.memory()")
        check(stable["samples"] >= 6, "окно замеров живёт и на стабильных числах")
        check(stable["leaks"] == [],
              "на стабильных счётчиках подозрений нет (%s)" % [l["key"] for l in stable["leaks"]])
        check("подозрений на утечку нет" in stable["text"]["leaks"],
              "панель честно говорит, что роста нет")
        check(stable["counters"]["nodes"] == a.eval("$.debug.counters().nodes"),
              "счётчики на стабильном окне совпадают с движком")

        # --- сброс базовой линии ----------------------------------------------
        click(a, doc, "rt-mem-baseline")
        a.step(3)
        after = a.eval("$.devtools.memory()")
        check(abs(after["deltas"]["nodes"] or 0) <= 1,
              "после сброса базовая линия обновилась (Δ nodes=%s)" % after["deltas"]["nodes"])
        check("Δ +0" in after["text"]["counters"] or "Δ +1" in after["text"]["counters"],
              "дельта в панели тоже обнулилась")

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
