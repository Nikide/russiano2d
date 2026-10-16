#!/usr/bin/env python3
# ===========================================================================
# DevTools §28: вкладка EVENTS — таймлайн $.trace.
#
# Проверяется на живом движке: записи журнала показываются в панели теми же
# строками, что отдаёт $.devtools.events(); фильтр по kind, пауза (снимок не
# меняется), очистка, счётчик вытесненных записей и связь с $.trace.hit(id)
# для боевой записи.
#
# Запуск после сборки:
#   python3 tests/agent/devtools_events_test.py
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
        click(a, doc, "rt-tab-events")
        check(a.eval("$.devtools.tabName()") == "events", "клик открыл вкладку EVENTS")
        a.step(5)

        # --- журнал выключен — панель говорит прямо ---------------------------
        off = a.eval("$.devtools.events()")
        check(off["on"] is False and "Журнал выключен" in off["text"]["list"],
              "выключенный журнал показан честно, а не пустым списком")

        # --- записи = $.trace.list() ------------------------------------------
        a.eval("$.trace.on(true)")
        a.eval("$.trace.note('phase', $('#hero').get(0), { step: 1 })")
        a.eval("$.trace.note('phase', $('#enemy0').get(0), { step: 2 })")
        a.eval("$.trace.note('custom', null, { note: 'ok' })")
        a.step(5)
        ev = a.eval("$.devtools.events()")
        live = a.eval("$.trace.list()")
        check(ev["on"] is True and ev["count"] == len(live) == 3,
              "в панели столько записей, сколько в $.trace (%s)" % ev["count"])
        check(ev["rows"][0]["n"] == live[-1]["n"],
              "записи идут свежими сверху (#%s)" % ev["rows"][0]["n"])
        check("phase" in ev["rows"][1]["kind"], "kind записи показан")
        check("n1" in ev["text"]["list"] or "n2" in ev["text"]["list"],
              "источник записи показан логическим nid")
        ui_list = ui(a, doc, "rt-events-list")
        check(safe(ev["text"]["list"]) == ui_list, "таймлайн в панели = данным events()")
        check("потеряно переполнением" in ev["text"]["detail"], "счётчик потерь показан")

        # --- фильтр по kind ----------------------------------------------------
        a.eval("$.devtools.eventsFilter('phase')")
        a.step(4)
        filtered = a.eval("$.devtools.events()")
        check(filtered["filter"] == "phase" and filtered["count"] == 3 and len(filtered["rows"]) == 2,
              "фильтр оставил две записи phase из трёх")
        check(all("phase" in r["kind"] for r in filtered["rows"]), "в списке только phase")
        check(safe(filtered["text"]["list"]) == ui(a, doc, "rt-events-list"),
              "отфильтрованный список в панели = данным")
        a.eval("$.devtools.eventsFilter('')")

        # --- пауза: снимок не меняется ----------------------------------------
        a.eval("$.devtools.eventsPause(true)")
        a.step(4)
        paused_before = a.eval("$.devtools.events()")["text"]["list"]
        a.eval("$.trace.note('while-paused', null, { n: 1 })")
        a.step(5)
        paused_after = a.eval("$.devtools.events()")
        check(paused_after["paused"] is True and paused_after["count"] == 4
              and len(paused_after["rows"]) == 3,
              "журнал растёт (%s), а панель показывает замороженный снимок (%s строк)"
              % (paused_after["count"], len(paused_after["rows"])))
        check(paused_after["text"]["list"] == paused_before,
              "на паузе список в панели не меняется")
        a.eval("$.devtools.eventsPause(false)")
        a.step(4)
        check("while-paused" in a.eval("$.devtools.events()")["text"]["list"],
              "после снятия паузы новая запись появилась")

        # --- вытеснение кольца -------------------------------------------------
        a.eval("$.trace.clear()")
        a.eval("(() => { for (let i = 0; i < 300; i++) $.trace.note('bulk', null, { i }); return true; })()")
        a.step(5)
        bulk = a.eval("$.devtools.events()")
        check(bulk["count"] == a.eval("$.trace.limit") and bulk["dropped"] > 0,
              "кольцо ограничено, вытесненные посчитаны (%s записей, потеряно %s)"
              % (bulk["count"], bulk["dropped"]))
        check("%s" % bulk["dropped"] in bulk["text"]["detail"],
              "число вытесненных видно в панели")

        # --- связь с $.trace.hit(id) ------------------------------------------
        a.eval("$.trace.clear()")
        a.eval("$.trace.note('hit', $('#hero').get(0), { attack: 7 })")
        a.step(5)
        hit = a.eval("$.devtools.events()")
        check(hit["hit"] and hit["hit"]["id"] == 7, "боевая запись связана с hit id 7")
        check("цепочка hit #7" in hit["text"]["detail"],
              "панель показывает цепочку hit (found=%s)" % hit["hit"]["chain"]["found"])
        check(hit["hit"]["chain"]["found"] is True and len(hit["hit"]["chain"]["steps"]) >= 1,
              "цепочка собрана из самого журнала (%s шагов)"
              % len(hit["hit"]["chain"]["steps"]))
        click(a, doc, "rt-events-hit")
        a.step(4)
        check("цепочка hit #7" in ui(a, doc, "rt-events-detail"),
              "кнопка «Цепочка hit» показывает связь в панели")

        # --- очистка -----------------------------------------------------------
        click(a, doc, "rt-events-clear")
        a.step(4)
        cleared = a.eval("$.devtools.events()")
        check(cleared["count"] == 0 and "Записей нет." in cleared["text"]["list"],
              "кнопка «Очистить» очистила журнал, панель говорит «Записей нет.»")

        a.eval("$.trace.on(false); $.devtools.closeRuntime()")
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
