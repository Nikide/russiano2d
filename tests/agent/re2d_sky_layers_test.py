#!/usr/bin/env python3
"""Per-layer sky textures (GPU-independent half): manifest, per-layer API,
runtime decode/info and transactional missing-asset handling.

The GPU pass is owned by another task; this test asserts the data contract the
renderer consumes (config + decoded RGBA + dimensions) and that missing assets
leave the previous layer intact.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

GAME = "demos/re2d_world_renderer_lab"
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def sky(a):
    return json.loads(a.eval("JSON.stringify(world.info().sky)") or "{}")


def main():
    with Agent(game=GAME, seed=7) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        # 1 layer authored directly; the runtime decodes the PNG immediately.
        check(a.eval('world.skyLayer(0,{id:"solo",texture:"assets/sky/layer_hills.png",'
                     'tint:"#88bbee",parallax:0.1,scroll:0.002,alpha:0.6,offset:0.03,scale:1.4})') is True,
              "skyLayer(0) loads one texture")
        info = sky(a)
        layers = info.get("layers") or []
        check(info.get("count") == 3, "default config still has three layers")
        check(layers[0].get("id") == "solo" and layers[0].get("loaded") is True,
              "layer 0 id/texture loaded")
        check(layers[0].get("width", 0) > 0 and layers[0].get("height", 0) > 0,
              "decoded RGBA dimensions exposed: %sx%s" % (layers[0].get("width"), layers[0].get("height")))
        check(abs(layers[0].get("parallax", 0) - 0.1) < 1e-5, "parallax stored")
        check(layers[0].get("texture", "").endswith("layer_hills.png"), "texture path exposed")

        # Missing asset is rejected without destroying the previous layer.
        before = json.dumps(layers[0])
        check(a.eval('world.skyLayer(0,{texture:"assets/sky/does_not_exist.png"})') is False,
              "missing layer texture is rejected")
        after = sky(a)
        check(json.dumps((after.get("layers") or [{}])[0]) == before,
              "failed load keeps the previous layer intact")
        check(bool(after.get("error")), "error text is exposed: %s" % after.get("error"))

        # Manifest path loads 1..4 layers, weather and celestial paths.
        ok_path = "assets/sky/layers.json"
        check(a.eval('world.skyManifest(%s)' % json.dumps(ok_path)) is True,
              "manifest loads")
        info = sky(a)
        layers = info.get("layers") or []
        check(info.get("count") == 4 and len(layers) == 4, "four manifest layers")
        ids = [l.get("id") for l in layers]
        check(ids == ["far_mountains", "hills", "clouds", "spires"], "layer ids preserved")
        check(all(l.get("loaded") and l.get("width", 0) > 0 and l.get("height", 0) > 0 for l in layers),
              "all layer textures decoded")
        check(abs(layers[2].get("scroll", 0) - 0.004) < 1e-6, "per-layer scroll preserved")
        check(str(info.get("sun", "")).endswith("sun.png"), "sun texture path exposed")
        check(str(info.get("moon", "")).endswith("moon.png"), "moon texture path exposed")
        weather = info.get("weather") or {}
        check(str(weather.get("rain", "")).endswith("weather_rain.png"), "weather texture path exposed")
        check(all(l.get("tint") for l in layers), "per-layer tint exposed")

        # skyLayers() mirrors info.sky.layers and missing manifest is fatal-safe.
        listed = json.loads(a.eval("JSON.stringify(world.skyLayers())") or "[]")
        check(len(listed) == 4 and listed[0].get("id") == "far_mountains", "skyLayers() getter")
        old = json.dumps(sky(a).get("layers"))
        check(a.eval('world.skyManifest("assets/sky/nope.json")') is False,
              "missing manifest rejected")
        check(json.dumps(sky(a).get("layers")) == old, "failed manifest keeps old layers")
        check(not a.eval("$.debug.errors()"), "no script errors")

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
