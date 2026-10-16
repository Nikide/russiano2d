#!/usr/bin/env python3
# ===========================================================================
# §37. Lighting debugger: отладочный оверлей света.
#
# Проверяется на реальном движке (фикстура tests/fixtures/light: три источника,
# один из них с тенями) и на пикселях кадра:
#   * по умолчанию оверлей ВЫКЛЮЧЕН: $.debug.draw.* не зовётся, кадр не меняется;
#   * оверлей рисует по одной окружности радиуса и одной точке центра на
#     КАЖДЫЙ нарисованный источник из engine.devtools.lights() — число и
#     координаты сверяются с этим списком, а экранные точки — с
#     $.camera.worldToScreen();
#   * нижняя граница теней (отрезки реестра) совпадает с $.gfx.light.count();
#   * слои/маски и признак деградации берутся из $.gfx.light.maskPath() и
#     $.gfx.light.qualityReport(), а не выдумываются;
#   * при выключенном свете оверлея нет (источников ноль — окружностей ноль);
#   * выключение возвращает РОВНО прежний кадр.
#
# Запуск после сборки:
#   python3 tests/agent/light_debug_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/light_debug_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "light")
FAILURES = []

PATCH = """
(() => {
  globalThis.__lgdbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };
  for (const k of Object.keys(globalThis.__lgdbg)) {
    const orig = $.debug.draw[k];
    $.debug.draw[k] = (...args) => {
      if (k === 'rect') globalThis.__lgdbg.rect.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'line') globalThis.__lgdbg.line.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'circle' || k === 'ring') globalThis.__lgdbg[k].push([args[0].x, args[0].y, args[1]]);
      else if (k === 'text') globalThis.__lgdbg.text.push(String(args[0]));
      return orig(...args);
    };
  }
  return true;
})()
"""

RESET = ("globalThis.__lgdbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };"
         " true")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def calls(a):
    return json.loads(a.eval("JSON.stringify(globalThis.__lgdbg)"))


def image(path):
    return Image.open(path).convert("RGB")


def same_pixels(path_a, path_b):
    ia, ib = image(path_a), image(path_b)
    if ia.size != ib.size:
        return ia.size[0] * ia.size[1]
    pa, pb = ia.load(), ib.load()
    diff = 0
    for y in range(ia.size[1]):
        for x in range(ia.size[0]):
            if pa[x, y] != pb[x, y]:
                diff += 1
    return diff


def near(a, b, tol=0.5):
    return abs(a - b) <= tol


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(4)
        a.eval(PATCH)

        # --- по умолчанию выключен --------------------------------------------
        facts = a.eval("$.gfx.light.debug()")
        check(facts["on"] is False, "оверлей света по умолчанию выключен")
        check(facts["drawn"] is None, "у выключенного оверлея нет фактов кадра")
        check(a.eval("$.gfx.light.debugOn()") is False, "debugOn() подтверждает выключение")
        a.eval(RESET)
        a.step(3)
        idle = calls(a)
        check(sum(len(idle[k]) for k in idle) == 0,
              "без оверлея $.debug.draw.* не зовётся: %s" % {k: len(v) for k, v in idle.items()})

        base_a = a.screenshot(os.path.join(shots, "light_debug_off_a.png"))
        a.step(3)
        base_b = a.screenshot(os.path.join(shots, "light_debug_off_b.png"))
        stable = same_pixels(base_a, base_b)
        check(stable == 0, "кадр фикстуры без оверлея стабилен (%d пикселей различия)" % stable)

        # --- включение ---------------------------------------------------------
        lights = a.eval("engine.devtools.lights()")
        check(isinstance(lights, list) and len(lights) == 3,
              "в фикстуре три нарисованных источника: %s" % len(lights or []))
        a.eval(RESET)
        a.eval("$.gfx.light.debug(true)")
        a.step(2)
        check(a.eval("$.gfx.light.debugOn()") is True,
              "прежний вид debug(true)/debugOn() сохранён")

        facts = a.eval("$.gfx.light.debug()")
        drawn = facts["drawn"]
        check(facts["on"] is True and facts["sources"] == len(lights),
              "факты видят столько же источников, сколько нарисовано: %s" % facts["sources"])
        check(len(drawn["rings"]) == len(lights),
              "окружностей радиуса ровно по числу нарисованных источников: %d"
              % len(drawn["rings"]))
        check(drawn["primitives"]["rings"] == len(lights)
              and drawn["primitives"]["circles"] == len(lights),
              "в кадр выпущено по кольцу и точке на источник: %s"
              % drawn["primitives"])

        # Числа оверлея == список источников кадра (позиция, радиус, интенсивность,
        # слой и итоговый флаг теней).
        mismatch = []
        for ring, light in zip(drawn["rings"], lights):
            if ring["index"] != light["index"]:
                mismatch.append("index %s!=%s" % (ring["index"], light["index"]))
            if not (near(ring["x"], light["x"], 1e-4) and near(ring["y"], light["y"], 1e-4)):
                mismatch.append("позиция источника %d" % light["index"])
            if not near(ring["radius"], light["radius"], 1e-4):
                mismatch.append("радиус источника %d" % light["index"])
            if not near(ring["intensity"], light["intensity"], 1e-4):
                mismatch.append("интенсивность источника %d" % light["index"])
            if ring["shadow"] != light["shadow"]:
                mismatch.append("флаг теней источника %d" % light["index"])
            if ring["layer"] != light["layer"]:
                mismatch.append("слой источника %d" % light["index"])
        check(not mismatch, "окружности совпали с engine.devtools.lights() (%s)"
              % (mismatch or "все три"))

        # Экранные точки — те же, что даёт $.camera.worldToScreen для этих центров:
        # оверлей обязан липнуть к источникам, а не «примерно туда же».
        screen_mismatch = []
        for ring in drawn["rings"]:
            expect = a.eval("$.camera.worldToScreen({ x: %r, y: %r })"
                            % (ring["x"], ring["y"]))
            if not (near(ring["screen"]["x"], expect["x"]) and near(ring["screen"]["y"], expect["y"])):
                screen_mismatch.append("источник %d: %s != %s"
                                       % (ring["index"], ring["screen"], expect))
        check(not screen_mismatch, "экранные центры оверлея совпали с worldToScreen (%s)"
              % (screen_mismatch or "все три"))
        check(all(near(r["r_px"], r["radius"] * a.eval("$.camera.zoom()"), 1e-6)
                  for r in drawn["rings"]),
              "радиус окружности на экране = радиус мира × зум")

        # Границы теней: отрезки реестра препятствий.
        occluders = a.eval("$.gfx.light.count()")
        check(occluders > 0 and facts["occluders"] == occluders,
              "число отрезков-препятствий совпало с $.gfx.light.count(): %s" % occluders)
        check(drawn["occluders"] == occluders,
              "столько же отрезков нарисовано: %s" % drawn["occluders"])

        # Слои/маски и деградация — из настоящего API, а не из догадки.
        check(facts["maskPath"] == a.eval("$.gfx.light.maskPath()"),
              "путь масок в фактах — из $.gfx.light.maskPath()")
        check(facts["layerDefault"] == a.eval("$.gfx.light.layer()"),
              "слой по умолчанию — из $.gfx.light.layer()")
        report = a.eval("$.gfx.light.qualityReport()")
        check(facts["degradation"]["culledLights"] == report["culledLights"]
              and facts["degradation"]["degradedRays"] == report["degradedRays"]
              and facts["degradation"]["degradedSegments"] == report["degradedSegments"],
              "признак деградации — из qualityReport()")
        check(facts["quality"]["maxShadowLights"] == report["quality"]["maxShadowLights"]
              and facts["quality"]["maxRays"] == report["quality"]["maxRays"],
              "лимиты качества в фактах — настоящие")
        check(drawn["labels"] == len(lights),
              "подпись (радиус/интенсивность/слой) на каждый источник: %s" % drawn["labels"])
        check(any("r=" in t and "L=0x" in t for t in calls(a)["text"]),
              "подписи источников несут радиус и слой: %s" % calls(a)["text"][:2])

        # --- кадр действительно изменился --------------------------------------
        on_shot = a.screenshot(os.path.join(shots, "light_debug_on.png"))
        diff_on = same_pixels(base_a, on_shot)
        check(diff_on > 0, "включённый оверлей видно на кадре (%d пикселей)" % diff_on)

        # --- выключение возвращает прежний кадр --------------------------------
        a.eval(RESET)
        a.eval("$.gfx.light.debug(false)")
        a.step(3)
        off_shot = a.screenshot(os.path.join(shots, "light_debug_off_again.png"))
        check(same_pixels(base_a, off_shot) == 0, "выключение убрало оверлей (кадр совпал)")
        after = calls(a)
        check(sum(len(after[k]) for k in after) == 0, "после выключения примитивов нет")
        check(a.eval("$.gfx.light.debug().drawn") is None, "фактов кадра у выключенного нет")

        # --- при выключенном свете оверлея нет --------------------------------
        a.eval("$('#lamp').alpha(0); $('#area').alpha(0); $('#torch').alpha(0)")
        a.step(2)
        check(a.eval("engine.devtools.lights().length") == 0,
              "погашенные источники не публикуются в кадре")
        a.eval(RESET)
        a.eval("$.gfx.light.debug({ on: true })")
        a.step(1)
        dark = a.eval("$.gfx.light.debug()")
        check(dark["drawn"]["rings"] == [],
              "окружностей нет: %s" % dark["drawn"]["rings"])
        check(dark["drawn"]["sources"] == 0, "источников на оверлее ноль, а не «сколько-то»")
        check(len(calls(a)["ring"]) == 0, "кольца не выпускаются при погашенном свете")
        check(dark["sourcesAvailable"] is True,
              "список источников доступен — ноль это факт, а не отсутствие данных")

        a.eval("$('#lamp').alpha(1); $('#area').alpha(1); $('#torch').alpha(1)")
        a.eval(RESET)
        a.step(1)
        check(len(calls(a)["ring"]) == 3, "после возврата света снова три окружности: %s"
              % len(calls(a)["ring"]))

        # --- частичное выключение: только источники -----------------------------
        a.eval(RESET)
        a.eval("$.gfx.light.debug({ occluders: false })")
        a.step(1)
        only_sources = calls(a)
        check(len(only_sources["ring"]) == 3 and len(only_sources["line"]) == 6,
              "без отрезков остаются только кольца и крестики центров: %s/%s"
              % (len(only_sources["ring"]), len(only_sources["line"])))
        a.eval(RESET)
        a.eval("$.gfx.light.debug({ occluders: true, sources: false })")
        a.step(1)
        only_occluders = calls(a)
        check(len(only_occluders["ring"]) == 0 and len(only_occluders["line"]) == a.eval("$.gfx.light.count()"),
              "без источников остаются только отрезки теней: %s" % len(only_occluders["line"]))
        a.eval("$.gfx.light.debug(false)")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки §37 (lighting debugger) пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
