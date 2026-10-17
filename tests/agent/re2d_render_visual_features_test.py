#!/usr/bin/env python3
"""R-01/R-02 renderer visual features: quality tiers actually change the GPU
frame and the per-feature counters in world.info().

The renderer lab is rendered on the GPU at low and high quality. High enables
sprite grounding, edge treatment, surface variation/AO, height fog/haze, sky
layers/celestial and liquid surface shading.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_native_test import decode  # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

GAME = "demos/re2d_world_renderer_lab"
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def pixels(a, name):
    path = os.path.join(ROOT, "build", "test_visual_" + name + ".png")
    a.screenshot(path)
    return b"".join(decode(path)[3])


def info(a):
    return json.loads(a.eval("JSON.stringify(world.info())") or "{}")


def main():
    with Agent(game=GAME, seed=7) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        a.eval('world.backend("gpu");world.qualityPreset("low");'
               'world.sky({texture:"demos/re2d_world_renderer_lab/floor.png",color:"#88bbee"});'
               'for(let i=0;i<world.info().surfaces;i++){try{world.surface(i).terrain("water")}catch(e){}}')
        a.step(2)
        low = pixels(a, "low")
        low_info = info(a)
        low_visual = low_info.get("visual") or {}
        check(low_visual.get("quality") == 0, "low quality tier selected")
        check(low_visual.get("contactShadows", 0) >= 1, "low keeps P0 contact grounding")

        a.eval('world.qualityPreset("high")')
        a.step(3)
        high = pixels(a, "high")
        high_info = info(a)
        visual = high_info.get("visual") or {}
        check(visual.get("quality") == 2, "high quality tier selected")
        for key in ("contactShadows", "footAo", "floorTint", "edgeActors",
                    "outlineActors", "variedSurfaces", "macroSurfaces",
                    "bevelSurfaces", "cornerAoSurfaces", "fogSurfaces",
                    "hazeSurfaces", "liquidSurfaces", "skyLayers",
                    "celestialDiscs", "skyDraws"):
            check(visual.get(key, 0) >= 1, "feature counter %s > 0: %s" % (key, visual.get(key)))
        diff = sum(1 for x, y in zip(low, high) if abs(x - y) > 3)
        check(diff / max(1, len(low)) > 0.01,
              "high quality changes actual pixels: %.2f%%" % (100.0 * diff / max(1, len(low))))
        check(not a.eval("$.debug.errors()"), "no script errors in either tier")

        # Grounding must be present on both CPU and GPU reference backends.
        a.eval('world.qualityPreset("low");world.backend("cpu")')
        a.step(1)
        cpu_info = info(a)
        check((cpu_info.get("visual") or {}).get("contactShadows", 0) >= 1,
              "CPU reference also draws contact grounding")
        a.eval('world.backend("gpu")')
        a.step(1)

    print()
    if FAILED:
        print("ПРОВАЛОВ:", len(FAILED))
        for item in FAILED:
            print("  -", item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
