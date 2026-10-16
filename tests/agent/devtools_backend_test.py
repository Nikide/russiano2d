#!/usr/bin/env python3
# ===========================================================================
# §19/§25/§37: что бэкенд отдаёт инспекторам физики, рендера и света.
#
# Проверяем на живом движке, а не по коду, и только измеримые величины:
#   * engine.devtools.shapes(body) описывает формы тела (геометрия из Box2D) и
#     совпадает с $.debug.anatomy по числу, виду, смещению и сенсорности
#     областей, а размеры основной формы — с size() узла; у несуществующего
#     тела список пуст (никаких «похожих» форм);
#   * engine.renderInfo() отдаёт честные batches/draw_calls/targets/textures/
#     viewport: пакеты считаются по факту отправки (больше нуля при отрисовке
#     спрайтов), draw_calls не меньше числа пакетов и растёт на полноэкранных
#     проходах, список целей содержит только реально существующие цели, и цель
#     сцены активна ровно в кадре с постом;
#   * engine.devtools.lights() перечисляет ровно те источники, что нарисовал
#     JS-путь света ($.gfx.light.stats().lights): позиции/радиус/intensity
#     сверяются с узлами, shadow — с qualityReport(), список живёт один кадр.
#
# Запуск (после сборки):
#   python3 tests/agent/devtools_backend_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/devtools_backend_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME_DIAG = os.path.join("tests", "fixtures", "combat_diag")
GAME_RENDER = os.path.join("tests", "fixtures", "render")
GAME_LIGHT = os.path.join("tests", "fixtures", "light")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def load(a, expr):
    """Значение из JS как объект Python (через JSON, без внешних зависимостей)."""
    return json.loads(a.eval("JSON.stringify(%s)" % expr))


def near(a, b, eps=0.01):
    return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= eps


# ---------------------------------------------------------------------------
# §19: формы тела для Physics Debugger
# ---------------------------------------------------------------------------
def run_shapes():
    with Agent(game=GAME_DIAG, seed=11, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        check(a.eval("typeof engine.devtools") == "object"
              and a.eval("typeof engine.devtools.shapes") == "function",
              "engine.devtools.shapes зарегистрирован движком")

        anatomy = load(a, "$.debug.anatomy('#hero')")
        check(anatomy.get("found") is True and anatomy.get("body"),
              "анатомия героя доступна и у него есть тело")
        body = anatomy["body"]["id"]

        shapes = load(a, "engine.devtools.shapes(%d)" % body)
        check(len(shapes) == 1 + len(anatomy["areas"]),
              "shapes() вернул все формы тела: %d (основная + %d областей)"
              % (len(shapes), len(anatomy["areas"])))

        by_index = {}
        for s in shapes:
            by_index[s["index"]] = s
        check(sorted(by_index) == list(range(len(shapes))),
              "индексы форм идут подряд от нуля: %s" % sorted(by_index))

        mismatch = []
        for area in anatomy["areas"]:
            s = by_index.get(area["index"])
            if s is None:
                mismatch.append("%s: формы нет" % area["name"])
                continue
            if s["kind"] != area["shape"]:
                mismatch.append("%s: вид %s != %s" % (area["name"], s["kind"], area["shape"]))
            if not near(s["x"], area["x"]) or not near(s["y"], area["y"]):
                mismatch.append("%s: смещение (%s,%s) != (%s,%s)"
                                % (area["name"], s["x"], s["y"], area["x"], area["y"]))
            if s["sensor"] != (area["sensor"] is True):
                mismatch.append("%s: sensor=%s" % (area["name"], s["sensor"]))
            if s["enabled"] != (area["enabled"] is not False):
                mismatch.append("%s: enabled=%s" % (area["name"], s["enabled"]))
        check(not mismatch, "каждая область совпала с native-формой (%s)" % (mismatch or "все"))

        # Основная форма: размеры обязаны совпасть с size() узла — это факт
        # геометрии из Box2D, а не пересказ описания.
        main = by_index.get(0)
        size = anatomy["size"]
        check(main is not None and main["kind"] == "box",
              "основная форма тела — прямоугольник (%s)" % ((main or {}).get("kind"),))
        check(main and near(main["halfW"], size["w"] / 2.0) and near(main["halfH"], size["h"] / 2.0),
              "полуразмеры основной формы совпали с size(): %sx%s при узле %sx%s"
              % (main and main["halfW"], main and main["halfH"], size["w"], size["h"]))
        check(main and main["sensor"] is False and main["enabled"] is True
              and main["oneWay"] is False and main["pointCount"] == 0,
              "состояние основной формы честное: sensor=%s enabled=%s oneWay=%s точек=%s"
              % (main and main["sensor"], main and main["enabled"],
                 main and main["oneWay"], main and main["pointCount"]))
        check(main and main["layer"] == 1 and main["mask"] == 0xFFFFFFFF and main["group"] == 0,
              "фильтр основной формы — умолчания движка: layer=%s mask=%s group=%s"
              % (main and main["layer"], main and main["mask"], main and main["group"]))

        sensors = [s for s in shapes if s["index"] > 0 and s["sensor"]]
        check(len(sensors) == len(anatomy["areas"]),
              "все области-роли помечены сенсорами: %d из %d"
              % (len(sensors), len(anatomy["areas"])))

        # Никаких выдуманных форм у несуществующего тела.
        check(a.eval("engine.devtools.shapes(-1).length") == 0,
              "у несуществующего тела форма не выдумывается")
        check(a.eval("engine.devtools.shapes(%d).length" % (body + 5000)) == 0,
              "у чужого body id список форм пуст")


# ---------------------------------------------------------------------------
# §25: честные счётчики кадра для Render Inspector
# ---------------------------------------------------------------------------
def run_render_info():
    with Agent(game=GAME_RENDER, seed=7, fixed_dt=1.0 / 60.0) as a:
        # Пост выключаем явно: дальше он включается отдельным шагом, и разница
        # в счётчиках объясняется только им, а не настройками фикстуры.
        a.eval("$.gfx.post({ on: false }); 'ok'")
        a.step(3)

        info = a.eval("engine.renderInfo()")
        check(isinstance(info, dict), "renderInfo() отвечает объектом")

        batches = info.get("batches")
        draws = info.get("draw_calls")
        check(isinstance(batches, int) and batches > 0,
              "batches > 0 при отрисовке спрайтов: %s" % batches)
        check(isinstance(draws, int) and draws >= (batches or 0),
              "draw_calls не меньше числа пакетов: %s >= %s" % (draws, batches))
        check(info.get("draws") == draws,
              "старое поле draws осталось тем же числом (совместимость): %s" % info.get("draws"))
        check(a.eval("$.gfx.stats().sprites") > 0,
              "спрайты в кадре действительно есть: %s" % a.eval("$.gfx.stats().sprites"))

        tex = info.get("textures") or {}
        check(isinstance(tex.get("count"), int) and tex["count"] > 0
              and isinstance(tex.get("max"), int) and 0 < tex["count"] <= tex["max"],
              "текстуры: живых %s из %s" % (tex.get("count"), tex.get("max")))
        check(isinstance(tex.get("pixels"), (int, float)) and tex["pixels"] > 0,
              "суммарный размер текстур в пикселях измерен: %s" % tex.get("pixels"))

        vp = info.get("viewport") or {}
        check(isinstance(vp.get("w"), int) and vp["w"] > 0
              and isinstance(vp.get("h"), int) and vp["h"] > 0,
              "viewport сообщает размер кадра: %sx%s" % (vp.get("w"), vp.get("h")))
        check(isinstance(vp.get("snap"), bool), "viewport.snap — булево (%s)" % vp.get("snap"))
        check(vp.get("bound") == -1, "кадр идёт в swapchain, viewport не связан (%s)" % vp.get("bound"))

        targets = info.get("targets")
        check(isinstance(targets, list), "targets — список")
        targets = targets or []
        bad = [t for t in targets
               if not isinstance(t, dict) or not {"name", "w", "h", "active"} <= set(t)
               or not isinstance(t["w"], int) or t["w"] <= 0
               or not isinstance(t["h"], int) or t["h"] <= 0
               or not isinstance(t["active"], bool)]
        check(not bad, "у каждой цели имя, размер и признак участия (%s)" % (bad or "все"))
        check(not any(t["name"] == "scene" and t["active"] for t in targets),
              "без поста цель сцены не активна: %s" % sorted(t["name"] for t in targets))
        check(draws == batches,
              "без поста полноэкранных проходов нет: draw_calls %s == batches %s" % (draws, batches))

        # Пост создаёт offscreen-цель сцены: она обязана появиться и быть активной.
        a.eval("$.gfx.post({ glow: 1.0 }); 'ok'")
        a.step(2)
        info2 = a.eval("engine.renderInfo()")
        names = {t["name"]: t for t in (info2.get("targets") or [])}
        check("scene" in names, "с постом появилась цель сцены: %s" % sorted(names))
        check(names.get("scene", {}).get("active") is True,
              "цель сцены активна в кадре с постом")
        check(names.get("scene", {}).get("w") == info2.get("scene_w")
              and names.get("scene", {}).get("h") == info2.get("scene_h"),
              "размер цели сцены совпал со scene_w/scene_h: %sx%s"
              % (names.get("scene", {}).get("w"), names.get("scene", {}).get("h")))
        check(info2.get("draw_calls", 0) > info2.get("batches", 0),
              "с постом draw_calls больше числа пакетов (полноэкранные проходы): %s > %s"
              % (info2.get("draw_calls"), info2.get("batches")))
        check(isinstance(info2.get("batches"), int) and info2["batches"] > 0,
              "пакеты считаются и в кадре с постом: %s" % info2.get("batches"))


# ---------------------------------------------------------------------------
# §37: список источников света для Lighting Debugger
# ---------------------------------------------------------------------------
def run_lights():
    with Agent(game=GAME_LIGHT, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        stats = a.eval("$.gfx.light.stats()")
        quality = a.eval("$.gfx.light.quality()")
        report = a.eval("$.gfx.light.qualityReport()")
        lights = load(a, "engine.devtools.lights()")

        check(isinstance(quality, dict)
              and {"maxShadowLights", "maxRays", "maxSegments"} <= set(quality),
              "quality() отдаёт лимиты панели: %s" % sorted(quality or {}))
        check(isinstance(stats, dict)
              and {"lights", "shadowLights", "degradedRays", "degradedSegments"} <= set(stats),
              "stats() отдаёт источники и деградацию")
        check(isinstance(report, dict) and isinstance(report.get("quality"), dict),
              "qualityReport() называет текущий профиль")

        drawn = stats.get("lights") if isinstance(stats, dict) else None
        check(isinstance(drawn, int) and drawn == 3,
              "в кадре фикстуры три источника ($.gfx.light.stats()): %s" % drawn)
        check(isinstance(lights, list) and len(lights) == drawn,
              "lights() перечисляет ровно нарисованные источники: %d из %s"
              % (len(lights) if isinstance(lights, list) else -1, drawn))
        check(a.eval("engine.devtools.lightsDropped()") == 0,
              "список источников полный (ничего не потеряно)")

        # Позиция, радиус и интенсивность сверяются с самими узлами: список
        # обязан описывать источники, а не «сколько-то источников».
        compared = []
        for node_id in ("lamp", "area", "torch"):
            node = load(a, "(() => { const n = $('#%s').get(0);"
                           " return { x: n.x, y: n.y, radius: n.radius,"
                           " intensity: n.intensity }; })()" % node_id)
            hit = [l for l in lights if near(l["x"], node["x"]) and near(l["y"], node["y"])]
            if len(hit) != 1:
                compared.append("%s: записей %d" % (node_id, len(hit)))
                continue
            l = hit[0]
            if not (near(l["radius"], node["radius"]) and near(l["intensity"], node["intensity"])):
                compared.append("%s: radius %s != %s или intensity %s != %s"
                                % (node_id, l["radius"], node["radius"],
                                   l["intensity"], node["intensity"]))
        check(not compared, "источники совпали с узлами по позиции/радиусу/intensity (%s)"
              % (compared or "все три"))

        shadow_lights = stats.get("shadowLights") if isinstance(stats, dict) else None
        shadow_rows = [l for l in lights if l["shadow"] is True]
        check(len(shadow_rows) == shadow_lights,
              "shadow в списке совпал с qualityReport(): %d из %s"
              % (len(shadow_rows), shadow_lights))
        check(len(shadow_rows) == 1,
              "тени объявлены ровно у одного источника фикстуры (<lightarea>)")

        layer_default = a.eval("$.gfx.light.layer()")
        check(all(l["layer"] == layer_default for l in lights),
              "слой источника — объявленный по умолчанию (%s)" % layer_default)
        check([l["index"] for l in lights] == list(range(len(lights))),
              "индексы источников идут подряд: %s" % [l["index"] for l in lights])

        # Список — за кадр: он не копит источники между кадрами.
        a.step(4)
        again = load(a, "engine.devtools.lights()")
        check(len(again) == drawn, "список не копится между кадрами: %d" % len(again))


def main():
    print("--- §19 физика: формы тела (tests/fixtures/combat_diag) ---")
    run_shapes()
    print("--- §25 рендер: счётчики кадра (tests/fixtures/render) ---")
    run_render_info()
    print("--- §37 свет: список источников (tests/fixtures/light) ---")
    run_lights()

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
