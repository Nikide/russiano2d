#!/usr/bin/env python3
# ===========================================================================
# DevTools §26/§29: вкладки RENDER и ASSETS — то, что видно, равно данным.
#
# RENDER: счётчики engine.renderInfo() (батчи, draw calls, цели, текстуры,
# viewport) и список живых текстур. ASSETS: таблица наблюдаемых ассетов
# ($.reload.list()) с типами, версиями, зависимостями и последней загрузкой.
#
# Запуск после сборки:
#   python3 tests/agent/devtools_render_test.py
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
    """Тот же показ угловых скобок, что делает панель (RmlUi setText)."""
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

        # --- §26 RENDER --------------------------------------------------------
        click(a, doc, "rt-tab-render")
        check(a.eval("$.devtools.tabName()") == "render", "клик открыл вкладку RENDER")
        a.step(5)
        r = a.eval("$.devtools.render()")
        info = a.eval("engine.renderInfo()")
        check(r["info"] and r["info"]["batches"] == info["batches"],
              "батчи = engine.renderInfo().batches (%s)" % info["batches"])
        check(r["info"]["draw_calls"] == info["draw_calls"],
              "draw calls = engine.renderInfo().draw_calls (%s)" % info["draw_calls"])
        check(len(r["targets"]) == len(info["targets"]) and
              r["targets"][0]["name"] == info["targets"][0]["name"],
              "цели рендера перечислены как в движке (%s)" % [t["name"] for t in r["targets"]])
        check(r["viewport"] and r["viewport"]["w"] == info["viewport"]["w"],
              "viewport взят из renderInfo (%s×%s)" % (r["viewport"]["w"], r["viewport"]["h"]))
        check(len(r["textures"]) == a.eval("$.debug.textures().length"),
              "список текстур = живые GPU-текстуры (%s)" % len(r["textures"]))
        ui_info = ui(a, doc, "rt-render-info")
        check("батчей %s" % info["batches"] in ui_info and
              "draw calls %s" % info["draw_calls"] in ui_info,
              "счётчики видны в панели")
        ui_targets = ui(a, doc, "rt-render-targets")
        check(info["targets"][0]["name"] in ui_targets and
              "%d×%d" % (info["targets"][0]["w"], info["targets"][0]["h"]) in ui_targets,
              "цель с размерами видна в панели")
        ui_tex = ui(a, doc, "rt-render-textures")
        check(ui_tex.startswith("живых текстур %d" % len(r["textures"])),
              "строка текстур в панели = данным")
        check(safe(r["text"]["info"]) == ui_info and safe(r["text"]["targets"]) == ui_targets
              and safe(r["text"]["textures"]) == ui_tex,
              "все три блока RENDER в панели = данным render()")

        # --- §29 ASSETS --------------------------------------------------------
        click(a, doc, "rt-tab-assets")
        check(a.eval("$.devtools.tabName()") == "assets", "клик открыл вкладку ASSETS")
        a.eval("$.reload.watch('src/door.js', { kind: 'json', path: 'src/door.js' })")
        a.eval("$.reload.watch('atlas/hero', { kind: 'json', path: 'atlas/hero.json', deps: ['src/door.js'] })")
        a.step(5)
        assets = a.eval("$.devtools.assetsTab()")
        live = a.eval("$.reload.list()")
        check(len(assets["list"]) == len(live) == 2,
              "таблица ассетов = $.reload.list() (%s записей)" % len(live))
        by_name = {x["name"]: x for x in assets["list"]}
        check(by_name["src/door.js"]["kind"] == "json" and by_name["src/door.js"]["status"] == "registered",
              "тип и состояние ассета показаны верно (json/registered)")
        check(by_name["atlas/hero"]["deps"] == 1, "зависимости ассета посчитаны (1)")
        check(by_name["src/door.js"]["size"] == "—",
              "размер неизвестен — честное «—», а не выдуманное число")
        ui_table = ui(a, doc, "rt-assets-table")
        check(assets["text"]["table"] == ui_table, "таблица в панели = данным assetsTab()")
        check("src/door.js" in ui_table and "json" in ui_table and "registered" in ui_table,
              "строка ассета видна в панели")
        check("Наблюдаемых ассетов нет" not in ui_table, "при наличии ассетов нет пустой заглушки")
        check(assets["stats"]["watched"] == 2,
              "статистика $.reload видит обе записи (watched=%s)" % assets["stats"]["watched"])
        check(a.eval("$.devtools.assets()") is not None,
              "старый API assets() (§27) продолжает работать")

        # Пустой случай честен: снимаем наблюдение — панель говорит прямо.
        a.eval("$.reload.unwatch('src/door.js'); $.reload.unwatch('atlas/hero')")
        a.step(4)
        empty = a.eval("$.devtools.assetsTab()")
        check(empty["list"] == [] and "Наблюдаемых ассетов нет" in empty["text"]["table"],
              "без ассетов панель честно говорит, что наблюдать нечего")

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
