#!/usr/bin/env python3
# ===========================================================================
# DevTools, вкладка PERF (docs/PRODUCTION_POLISH.md §17): сводка кадра,
# честность N/A, график с перцентилями, иерархический профиль, вкладки.
#
# Проверяется на реальном движке и в двух плоскостях:
#   * данные — $.devtools.perf()/tree()/watches() (то, что читают инструменты);
#   * панель RmlUi — engine.ui.getText/rect и пиксели скриншота (то, что
#     видит человек), чтобы «видно в UI» было проверено тестом, а не на глаз.
#
# Отдельно проверяется честность: неизмеримое значение показывается как N/A
# (§17.1), а источник графика и перцентилей назван так, как он есть в рантайме
# (engine.profile().history/.stats или свои замеры $.debug.stats()).
#
# Запуск после сборки:
#   python3 tests/agent/devtools_perf_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []

# Все метрики сводки §17.1 — ровно этот набор обязан быть в панели.
SUMMARY_KEYS = [
    "fps", "frame_ms", "simulation_ms", "render_ms", "gpu_ms", "physics_ms",
    "js_ms", "animation_ms", "ui_ms", "audio_ms", "contacts", "draw_calls",
    "batches", "sprites", "particles", "lights", "shadow_lights", "bodies",
    "shapes", "nodes", "timers", "tweens", "audio_voices", "textures",
    "render_targets",
]

# Цвета столбцов графика: класс в данных → пиксель в кадре.
BAR_COLORS = {"": (74, 154, 212), "over": (212, 162, 74), "peak": (212, 90, 74)}

# Снимок данных и того, что реально лежит в документе RmlUi: боксы столбцов
# графика читаются подряд, пока элемент существует и разложен.
SNAPSHOT_JS = """
(function () {
    const p = $.devtools.perf();
    const d = $.devtools.runtimePanel().doc;
    const rects = [];
    for (let i = 0; i < 64; i++) {
        const r = engine.ui.rect(d, 'rt-graph-bar-' + i);
        if (!r || !(r.w > 0)) break;
        rects.push(r);
    }
    return JSON.stringify({
        perf: p,
        render: engine.renderInfo(),
        rects: rects,
        text: {
            summary: engine.ui.getText(d, 'rt-perf-summary'),
            stats: engine.ui.getText(d, 'rt-perf-stats')
        }
    });
})()
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def click(a, doc, element_id):
    """Настоящий клик мышью по элементу RmlUi (не программный click())."""
    r = a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(3)


def text(a, doc, element_id):
    return a.eval("engine.ui.getText(%s,%r)" % (doc, element_id))


def rect(a, doc, element_id):
    return a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))


def pairs(ui_text):
    """«label: value | label: value» построчно → [(label, value)]."""
    out = []
    for line in ui_text.split("\n"):
        for item in line.split(" | "):
            if not item.strip():
                continue
            label, _, value = item.partition(": ")
            out.append((label.strip(), value.strip()))
    return out


def colored_pixels(image, box, colors):
    """Сколько пикселей в прямоугольнике совпало с цветами столбцов графика."""
    x, y, w, h = int(box["x"]), int(box["y"]), int(box["w"]), int(box["h"])
    count = 0
    for px in range(max(0, x), min(image.width, x + w)):
        for py in range(max(0, y), min(image.height, y + h)):
            pixel = image.getpixel((px, py))
            for want in colors:
                if all(abs(pixel[i] - want[i]) <= 12 for i in range(3)):
                    count += 1
                    break
    return count


def main():
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        # --- открытие панели и вкладки ----------------------------------------
        check(a.eval("$.devtools.openRuntime()") is True, "панель F1 открылась документом RmlUi")
        p = a.eval("$.devtools.runtimePanel()")
        doc = p["doc"]
        check(doc >= 0, "документ RmlUi создан: id=%s" % doc)
        check(p["tab"] == "perf", "по умолчанию открыта вкладка PERF")
        check(a.eval("$.devtools.tab('nope')") is False, "неизвестное имя вкладки отклонено")
        check(a.eval("$.devtools.tab('perf')") is True, "tab('perf') возвращает на PERF")
        a.step(14)      # накопить окно профиля: графику и перцентилям нужны кадры

        # Отрисовать график по текущим данным и дать RmlUi разложить столбцы:
        # сразу после setHtml боксы ещё нулевые (раскладка идёт в конце кадра).
        a.eval("$.devtools.refreshRuntime(true)")
        a.step(2)
        shot = a.screenshot(os.path.join(ROOT, "build", "devtools_perf_tab.png"))
        snap = json.loads(a.eval(SNAPSHOT_JS))
        perf, info, rects = snap["perf"], snap["render"], snap["rects"]
        rows = {r["key"]: r for r in perf["rows"]}

        # --- §17.1: сводка кадра и честность N/A -------------------------------
        check(set(rows) == set(SUMMARY_KEYS),
              "в сводке ровно %d метрик §17.1" % len(SUMMARY_KEYS))
        check(rows["fps"]["measured"] and rows["fps"]["value"] > 0,
              "FPS измерен: %s" % rows["fps"]["value"])
        check(rows["frame_ms"]["measured"] and abs(rows["frame_ms"]["value"] - 1000.0 / 60.0) < 1.5,
              "frame time ≈ 16.7 мс: %s" % rows["frame_ms"]["value"])
        check(rows["bodies"]["value"] == a.eval("engine.bodyCount()"),
              "тел столько же, сколько engine.bodyCount()")
        check(rows["nodes"]["value"] == len(a.eval("$.agent.nodes('*')")),
              "узлов столько же, сколько видит агент")
        check(rows["textures"]["value"] == info["textures"]["count"],
              "текстур = engine.renderInfo().textures.count: %s" % rows["textures"]["value"])
        check(rows["draw_calls"]["value"] == info["draw_calls"],
              "draw calls = engine.renderInfo().draw_calls: %s" % rows["draw_calls"]["value"])
        check(rows["batches"]["value"] == info["batches"],
              "батчи = engine.renderInfo().batches: %s" % rows["batches"]["value"])
        check(rows["render_targets"]["value"] == len(info["targets"]),
              "render targets = engine.renderInfo().targets: %s" % rows["render_targets"]["value"])
        shapes_expected = a.eval(
            "(() => { const seen = new Set(); let sum = 0;"
            " for (const n of $.agent.nodes('*')) {"
            "   if (!(n.body >= 0) || seen.has(n.body)) continue;"
            "   seen.add(n.body); sum += engine.devtools.shapes(n.body).length; }"
            " return sum; })()")
        check(rows["shapes"]["value"] == shapes_expected,
              "форм столько же, сколько даёт Σ engine.devtools.shapes(тело): %s" % shapes_expected)
        check(rows["physics_ms"]["measured"], "физика измерена движком (engine.profile().rows)")

        # Таймеры: публичный счётчик $.time.timers() (after/every/waits).
        timers = a.eval("$.time.timers()")
        check(rows["timers"]["measured"] and rows["timers"]["value"] == timers["total"],
              "таймеров = $.time.timers().total (%s: after %s, every %s, waits %s)"
              % (timers["total"], timers["after"], timers["every"], timers["waits"]))

        # GPU — только по факту замера.
        gpu_available = a.eval("engine.profile().gpu_available")
        if gpu_available:
            check(rows["gpu_ms"]["measured"] and rows["gpu_ms"]["value"] >= 0,
                  "GPU измерен (gpu_available=true): %s мс" % rows["gpu_ms"]["value"])
        else:
            check(rows["gpu_ms"]["value"] is None, "GPU — N/A: замера нет (gpu_available=false)")

        # --- сводка в панели = данные ------------------------------------------
        ui_summary = snap["text"]["summary"]
        ui_pairs = pairs(ui_summary)
        check([l for l, _ in ui_pairs] == [r["label"] for r in perf["rows"]],
              "в панели те же метрики и в том же порядке, что в perf()")
        na_ui = {l for l, v in ui_pairs if v == "N/A"}
        na_data = {r["label"] for r in perf["rows"] if not r["measured"]}
        check(na_ui == na_data, "N/A ровно там, где значение не измерено (%d строк)" % len(na_data))

        # --- §17.2: график кадра и перцентили ---------------------------------
        graph = perf["graph"]
        has_history = a.eval("Array.isArray((engine.profile()||{}).history)")
        if has_history:
            check(graph["source"] == "engine.profile().history",
                  "источник графика — engine.profile().history (он есть в рантайме)")
            check(graph["stats_source"] == "engine.profile().stats",
                  "перцентили — engine.profile().stats (он есть в рантайме)")
        else:
            check("$.debug.stats()" in graph["source"],
                  "history нет — график честно помечен своими замерами $.debug.stats()")
        check(graph["samples"] > 0, "замеры кадра накоплены: %s" % graph["samples"])
        bars = graph["bars"]
        check(0 < len(bars) <= 48, "столбцов графика: %s" % len(bars))
        st = graph["stats"]
        check(st["min"] <= st["mean"] <= st["max"], "min ≤ mean ≤ max")
        check(st["p50"] <= st["p95"] <= st["p99"] <= st["max"], "перцентили упорядочены")
        check(st["min"] <= st["current"] <= st["max"], "текущий кадр внутри окна")
        check("p95" in perf["text"]["stats"] and "p99" in perf["text"]["stats"],
              "в тексте перцентилей есть p95/p99")
        check(snap["text"]["stats"].startswith("текущий "), "перцентили видны в панели")

        # Картинка = данные: высота каждого нарисованного столбца совпадает с
        # perf().graph.bars. Панель обновляется 10 Гц, поэтому нарисованных
        # столбцов не больше, чем замеров в данных (последние ещё не отрисованы).
        check(0 < len(rects) <= len(bars),
              "столбцов в панели %d, замеров в данных %d" % (len(rects), len(bars)))
        bad = [(i, rects[i]["h"], bars[i]["h"]) for i in range(len(rects))
               if abs(rects[i]["h"] - bars[i]["h"]) > 1]
        check(not bad, "высота столбцов графика = данные (расхождения: %s)" % (bad[:3] or "нет"))

        # Цвет столбца — тоже из данных (класс столбца: обычный / выше бюджета).
        image = Image.open(shot).convert("RGB")
        color_ok = 0
        probes = min(len(rects), 6)
        for i in range(probes):
            r = rects[i]
            pixel = image.getpixel((int(r["x"] + r["w"] / 2), int(r["y"] + r["h"] / 2)))
            want = BAR_COLORS[bars[i]["cls"]]
            if all(abs(pixel[c] - want[c]) <= 12 for c in range(3)):
                color_ok += 1
        check(color_ok == probes, "цвет столбцов графика совпадает с данными (%d из %d)"
              % (color_ok, probes))

        # --- переключение вкладок: класс hidden через setClass ------------------
        graph_rect = rect(a, doc, "rt-perf-graph")
        visible_pixels = colored_pixels(image, graph_rect, BAR_COLORS.values())
        check(visible_pixels > 0, "на вкладке PERF график виден (%d пикселей)" % visible_pixels)
        click(a, doc, "rt-tab-diag")
        check(a.eval("$.devtools.tabName()") == "diag", "клик по кнопке переключил вкладку на ДИАГНОСТИКА")
        check(text(a, doc, "rt-stats").strip() != "", "содержимое ДИАГНОСТИКИ заполнено")
        a.step(4)
        shot2 = a.screenshot(os.path.join(ROOT, "build", "devtools_perf_tab_diag.png"))
        hidden_pixels = colored_pixels(Image.open(shot2).convert("RGB"), graph_rect, BAR_COLORS.values())
        check(hidden_pixels == 0,
              "на вкладке ДИАГНОСТИКА графика не видно — вкладка действительно скрыта")
        click(a, doc, "rt-tab-perf")
        check(a.eval("$.devtools.tabName()") == "perf", "клик по PERF вернул вкладку")

        # --- §17.3–17.4: иерархический профиль ---------------------------------
        check(a.eval("$.debug.profiler.isOn()") is False, "профайлер подсистем по умолчанию выключен")
        tree = json.loads(a.eval("JSON.stringify($.devtools.tree())"))
        check(tree["profiler_on"] is False, "дерево честно говорит, что меток подсистем нет")
        check(tree["native_rows"] > 0, "нативные зоны engine.profile().rows в дереве: %s" % tree["native_rows"])
        sim_native = [r["name"] for r in tree["groups"]["simulation"]]
        check("JS: логика" in sim_native and "физика (Box2D)" in sim_native,
              "нативные CPU-зоны попали в Simulation")
        check(any(r["name"].startswith("GPU") for r in tree["groups"]["gpu"]), "GPU-зона в дереве")
        check("профайлер подсистем выключен" in tree["text"]["left"],
              "в панели сказано, почему меток нет")

        click(a, doc, "rt-perf-profiler")
        a.step(14)
        tree2 = json.loads(a.eval("JSON.stringify($.devtools.tree())"))
        check(tree2["profiler_on"] is True, "кнопка «Профайлер подсистем» включила замеры")
        names = {g: [r["name"] for r in tree2["groups"][g]] for g in tree2["groups"]}
        check("логика игры" in names["simulation"], "метка «логика игры» — в Simulation")
        check("анимация" in names["presentation"] and "интерфейс" in names["presentation"],
              "метки анимации и интерфейса — в Presentation")
        check("шины звука" in names["audio"], "метки звуковых шин — в Audio")
        check(all(r["ms"] is not None for r in tree2["groups"]["simulation"]),
              "у зон Simulation есть измеренные значения")

        # §17.4: пользовательские зоны ($.debug.profiler.*) вместе с движковыми.
        a.eval("$.update(() => { $.debug.profiler.start('AI'); $.debug.profiler.end('AI'); })")
        a.step(14)
        tree3 = json.loads(a.eval("JSON.stringify($.devtools.tree())"))
        user_names = [r["name"] for r in tree3["groups"]["user"]]
        check("AI" in user_names, "пользовательская зона AI показана отдельной группой")
        check("AI" in tree3["text"]["right"], "пользовательская зона AI видна в панели")
        left_ui = text(a, doc, "rt-tree-left")
        right_ui = text(a, doc, "rt-tree-right")
        shown = left_ui + "\n" + right_ui
        missing = [r["name"] for g in tree3["groups"].values() for r in g if r["name"] not in shown]
        check(not missing, "все строки дерева видны в панели (нет: %s)" % (missing or "—"))
        check("Simulation" in left_ui and "Presentation" in right_ui,
              "группы дерева подписаны")
        click(a, doc, "rt-tab-tree")
        check(a.eval("$.devtools.tabName()") == "tree", "вкладка ПРОФИЛЬ открывается кликом")

        # --- §17.5: наблюдения (previous/delta/min/max/порог) -------------------
        click(a, doc, "rt-tab-watch")
        check(a.eval("$.devtools.tabName()") == "watch", "вкладка НАБЛЮДЕНИЯ открывается кликом")
        a.eval("$.debug.watch('hp', () => $('#hero').hp())")
        a.eval("$.debug.watch('tick', () => $.time.frame())")
        a.step(14)
        watches = {w["name"]: w for w in a.eval("$.devtools.watches()")}
        check("hp" in watches and "tick" in watches, "наблюдения показаны")
        check(watches["hp"]["min"] == 100 and watches["hp"]["max"] == 100,
              "min/max наблюдения считаются по замерам")
        check(watches["tick"]["previous"] is not None and watches["tick"]["delta"] > 0,
              "previous и delta считаются (кадры растут: Δ=%s)" % watches["tick"]["delta"])
        a.eval("engine.ui.setValue(%s,'rt-watch-th','hp=50')" % doc)
        click(a, doc, "rt-watch-apply")
        watches = {w["name"]: w for w in a.eval("$.devtools.watches()")}
        check(watches["hp"]["threshold"] == 50 and watches["hp"]["threshold_hit"] is True,
              "порог из панели применён и превышение видно")
        check("ПРЕВЫШЕН" in text(a, doc, "rt-watches"), "превышение порога видно в панели")
        click(a, doc, "rt-watch-reset")
        check(a.eval("$.devtools.watches()")[0]["min"] is not None,
              "сброс мин/макс не ломает наблюдения")

        # --- панель закрыта: движок продолжает работать ------------------------
        a.eval("$.debug.profiler.on(false)")
        check(a.eval("$.devtools.closeRuntime()") is True, "панель F1 закрылась")
        a.step(3)
        check(a.eval("$.debug.isOn()") is False, "диагностика закрыта")
        check(a.eval("$('#hero').pos().x") == 100, "игра продолжает работать")
        check(a.eval("engine.bodyCount()") == 4, "тела на месте")

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
