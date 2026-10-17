#!/usr/bin/env python3
"""R-03 GPU VFX pass: cards, trails and distortion cards render through the
native world renderer, with exact draw attribution.

Spawns real FX bundles from assets/vfx on the existing renderer lab world,
captures GPU frames before/after, and checks per-frame native counters.
"""
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


def bundle(name, category):
    path = os.path.join(ROOT, "assets", "vfx", category, name + ".json")
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def pixels(a, name):
    path = os.path.join(ROOT, "build", "test_vfx_" + name + ".png")
    a.screenshot(path)
    return b"".join(decode(path)[3])


def main():
    with Agent(game=GAME, seed=7) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        a.eval('world.backend("gpu")')
        base = pixels(a, "base")

        for name, category in [("muzzle_flash", "combat"),
                               ("heat_distortion", "fire"),
                               ("boss_aura", "magic")]:
            a.eval("world.vfx.define(%r, %r)" % (name, bundle(name, category)))

        a.eval('world.vfx.spawn("muzzle_flash", {x:150, y:20, h:60});'
               'world.vfx.spawn("heat_distortion", {x:150, y:20, h:60})')
        a.step(2)
        fx = a.eval('JSON.stringify(world.vfx.info())') or "{}"
        info = a.eval('JSON.stringify(world.info())') or "{}"
        import json
        fx = json.loads(fx)
        info = json.loads(info)
        visual = info.get("visual") or {}
        check(fx.get("cards", 0) >= 1, "native VFX pool owns a card")
        check(info.get("gpuDrawsVfx", 0) >= 1,
              "GPU VFX pass emits at least one draw: %s" % info.get("gpuDrawsVfx"))
        check(visual.get("vfxCards", 0) >= 1 and visual.get("vfxCardDraws", 0) >= 1,
              "per-feature VFX card counters: %s" % visual.get("vfxCardDraws"))
        check(fx.get("distortionCards", 0) >= 1 and visual.get("vfxDistortion", 0) >= 1,
              "distortion card is counted: %s" % fx.get("distortionCards"))
        shot = pixels(a, "cards")
        check(shot != base, "VFX cards change actual pixels")
        check(not a.eval("$.debug.errors()"), "no script errors after card spawn")

        a.eval('world.vfx.spawn("boss_aura", {x:150, y:20, h:70})')
        a.step(6)
        fx = json.loads(a.eval('JSON.stringify(world.vfx.info())') or "{}")
        info = json.loads(a.eval('JSON.stringify(world.info())') or "{}")
        visual = info.get("visual") or {}
        check(fx.get("trails", 0) >= 1, "native trail emitter is live")
        check(visual.get("vfxTrails", 0) >= 1 and visual.get("vfxTrailDraws", 0) >= 1,
              "GPU trail pass draws segments: %s" % visual.get("vfxTrailDraws"))
        trails = pixels(a, "trails")
        check(trails != shot, "VFX trail changes actual pixels")

        attribution = (info.get("gpuDrawsBase", 0) + info.get("gpuDrawsSpan", 0) +
                       info.get("gpuDrawsActor", 0) + info.get("gpuDrawsOther", 0) +
                       info.get("gpuDrawsGround", 0) + info.get("gpuDrawsVfx", 0))
        check(attribution == info.get("gpuDraws"),
              "draw attribution stays exact: %s vs %s" % (attribution, info.get("gpuDraws")))
        check(not a.eval("$.debug.errors()"), "no script errors after trail spawn")

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
