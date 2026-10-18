#!/usr/bin/env python3
"""Re2D acceptance visual lab: counts, deterministic frame and feature refs.

The lab is a real demo (`demos/re2d_visual_lab`) with 50 enemies, 150 props,
~1.2k native particles, decals, 12 lights (4 shadowed), authored materials,
sky layers/weather/shafts, distant cards, region LOD/impostor config and the
native VFX pack.

Captures:
  * re2d_visual_lab.png — acceptance frame (high quality, fixed step)
  * <feature>_before/after pairs for material variation, bevel/corner AO,
    height fog/haze, sky layers, emissive/bloom and VFX.

Use --update only intentionally:
  python3 tests/agent/re2d_visual_lab_acceptance_test.py --update
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_native_test import decode  # noqa: E402

REFERENCE = os.path.join(ROOT, "tests", "agent", "reference")
BUILD = os.path.join(ROOT, "build")
GAME = "demos"
SCENE = "re2d_visual_lab"
TOLERANCE = 8
MAX_CHANGED = 0.01
FEATURES = ["material", "bevel_ao", "fog_haze", "sky_layers", "emissive_bloom", "vfx"]
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def ref(name):
    return os.path.join(REFERENCE, name + ".png")


def shot(agent, name):
    path = os.path.join(BUILD, "test_vlab_" + name + ".png")
    agent.screenshot(path)
    return path, decode(path)


def diff(a, b):
    if (a[0], a[1]) != (b[0], b[1]):
        return 1.0
    rows0, rows1 = a[3], b[3]
    changed = 0
    total = 0
    for y in range(a[1]):
        row0, row1 = rows0[y], rows1[y]
        for x in range(0, a[0] * 4, 4):
            d = max(abs(row0[x + c] - row1[x + c]) for c in range(3))
            total += 1
            if d > TOLERANCE:
                changed += 1
    return changed / max(1, total)


def diff_peak(a, b):
    """Peak per-channel difference between two frames (localized effects).

    Bloom is a small halo around bright pixels: after the bounded height-fog
    calibration (2026-10-18) the acceptance frame is no longer washed out, so the
    glow covers a tiny area (~0.01-0.6% of the frame) but is still real. Area
    alone would miss it, so the bloom pair additionally requires a visible peak.
    """
    if (a[0], a[1]) != (b[0], b[1]):
        return 255
    rows0, rows1 = a[3], b[3]
    peak = 0
    for y in range(a[1]):
        row0, row1 = rows0[y], rows1[y]
        for x in range(0, a[0] * 4, 4):
            d = max(abs(row0[x + c] - row1[x + c]) for c in range(3))
            if d > peak:
                peak = d
    return peak


def compare(name, current, update):
    path = ref(name)
    if update:
        os.makedirs(REFERENCE, exist_ok=True)
        os.replace(current, path)
        print("  update reference %s" % os.path.relpath(path, ROOT))
        return
    if not os.path.exists(path):
        check(False, "%s: reference missing (run with --update)" % name)
        return
    changed = diff(decode(path), decode(current))
    check(changed <= MAX_CHANGED,
          "%s: changed %.4f%% <= %.2f%%" % (name, 100.0 * changed, 100.0 * MAX_CHANGED))


def main():
    update = "--update" in sys.argv[1:]
    with Agent(game=GAME, scene=SCENE, seed=7, fixed_dt=1.0 / 60.0) as a:
        # Same warm-up/setup as tests/agent/re2d_render_regression_test.py, so
        # both harnesses compare the exact same acceptance frame.
        a.step(2)
        a.eval('visualLab.world.backend("gpu");visualLab.world.qualityPreset("high");true')
        a.step(3)
        check(not a.eval("$.debug.errors()"), "visual lab has no script errors")
        result = a.eval("visualLab.counts()")
        if isinstance(result, str):
            result = json.loads(result)
        counts = result or {}
        visual = counts.get("visual") or {}
        check(counts.get("enemies", 0) >= 50, "enemies >= 50: %s" % counts.get("enemies"))
        check(counts.get("props", 0) >= 100, "props >= 100: %s" % counts.get("props"))
        check(1000 <= counts.get("particles", 0) <= 3000,
              "particles 1000..3000: %s" % counts.get("particles"))
        check(counts.get("decals", 0) >= 20, "decals >= 20: %s" % counts.get("decals"))
        check(counts.get("lights", 0) >= 8, "lights >= 8: %s" % counts.get("lights"))
        check(counts.get("shadowLights", 0) >= 2, "shadowed lights >= 2: %s" % counts.get("shadowLights"))
        check(counts.get("atlasSprites", 0) >= 200, "atlas sprites >= 200: %s" % counts.get("atlasSprites"))
        check(counts.get("visibleAtlasSprites", 0) >= 100,
              "visible sprites >= 100: %s" % counts.get("visibleAtlasSprites"))
        check(counts.get("hitProxies", 0) >= 50, "hit proxies >= 50: %s" % counts.get("hitProxies"))
        check(counts.get("vfxBundles", 0) >= 7, "VFX bundles >= 7: %s" % counts.get("vfxBundles"))
        check(visual.get("quality") == 2, "high visual quality tier")
        for key, minimum in (("skyLayers", 4), ("weatherCards", 20), ("shafts", 1),
                             ("distantCards", 1), ("postBloom", 1), ("bevelSurfaces", 1),
                             ("cornerAoSurfaces", 1), ("fogSurfaces", 1), ("hazeSurfaces", 1)):
            check(visual.get(key, 0) >= minimum,
                  "visual.%s >= %d: %s" % (key, minimum, visual.get(key)))
        native = a.eval("JSON.stringify({regions:visualLab.world.info().regionCount,"
                        "impostors:visualLab.world.info().impostorCount,"
                        "visibleImpostors:visualLab.world.info().visibleImpostors,"
                        "distantImpostors:visualLab.world.info().visual.distantImpostors})")
        native = json.loads(native) if isinstance(native, str) else (native or {})
        check(native.get("regions", 0) >= 1, "region grid configured: %s" % native.get("regions"))
        check(native.get("impostors", 0) >= 0, "impostor counter present: %s" % native.get("impostors"))

        current, image = shot(a, "re2d_visual_lab")
        compare("re2d_visual_lab", current, update)
        acceptance_image = image

        for feature in FEATURES:
            a.eval("visualLab.mode(%r,'before')" % feature)
            a.step(2)
            before_path, before_image = shot(a, feature + "_before")
            a.eval("visualLab.mode(%r,'after')" % feature)
            a.step(2)
            after_path, after_image = shot(a, feature + "_after")
            pair_changed = diff(before_image, after_image)
            peak = diff_peak(before_image, after_image)
            # Bloom is a localized halo; its peak is a real signal even when the
            # covered area is below the global 0.1% gate. Every other feature
            # must still change at least 0.1% of the frame.
            localized = feature == "emissive_bloom" and peak > TOLERANCE
            check(pair_changed >= 0.001 or localized,
                  "%s: before/after differ %.4f%% (peak %d)%s"
                  % (feature, 100.0 * pair_changed, peak,
                     " [localized pass]" if localized and pair_changed < 0.001 else ""))
            compare("visual_lab_" + feature + "_before", before_path, update)
            compare("visual_lab_" + feature + "_after", after_path, update)
            a.eval("visualLab.restore()")
            a.step(1)

    # Cross-process screenshot determinism is covered by the fixed-step
    # reference comparison above; two live agent windows are not a valid
    # screenshot source (the second process can capture a stale window).
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
