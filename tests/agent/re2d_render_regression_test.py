#!/usr/bin/env python3
"""Render regression harness for the Re2D acceptance labs.

Captures deterministic GPU frames on a fixed step, compares them to reference
PNGs with a tolerance (not byte equality), and fails on silent visual drift.
The same run also refreshes the references with `--update`:

    python3 tests/agent/re2d_render_regression_test.py --update

Cases:
  * visual_lab — demos/re2d_visual_lab (falls back to demos/re2d_world_renderer_lab
    while the visual lab task is still landing; the fallback is explicit in the
    log, never hidden);
  * vfx_lab — demos/re2d_vfx_lab with real FX bundles spawned.
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

REFERENCE = os.path.join(ROOT, "tests", "agent", "reference")
FAILED = []
TOLERANCE = 8          # per-channel difference treated as "same pixel"
MAX_CHANGED = 0.01     # fraction of pixels allowed to differ
MAX_MEAN = 1.0         # mean absolute channel delta


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def reference_path(name):
    return os.path.join(REFERENCE, name + ".png")


def capture(name, game, scene, setup, steps):
    out = os.path.join(ROOT, "build", "test_regression_" + name + ".png")
    with Agent(game=game, scene=scene, seed=7, fixed_dt=1.0 / 60.0) as a:
        if skip_without_re2d(a):
            return None, None
        a.step(2)
        if setup:
            result = a.eval(setup)
            if result is False:
                check(False, "%s: setup returned false" % name)
        a.step(steps)
        check(not a.eval("$.debug.errors()"), "%s: no script errors before capture" % name)
        a.screenshot(out)
    return out, decode(out)


def compare(name, shot, update):
    if shot is None:
        return
    path = reference_path(name)
    if update:
        os.makedirs(REFERENCE, exist_ok=True)
        os.replace(shot, path)
        print("  update reference %s" % os.path.relpath(path, ROOT))
        return
    if not os.path.exists(path):
        check(False, "%s: reference %s missing (run with --update)" %
              (name, os.path.relpath(path, ROOT)))
        return
    w0, h0, bpp0, rows0 = decode(path)
    w1, h1, bpp1, rows1 = decode(shot)
    check((w0, h0) == (w1, h1), "%s: frame size matches reference %sx%s" % (name, w0, h0))
    if (w0, h0) != (w1, h1):
        return
    total = 0
    changed = 0
    delta_sum = 0
    max_delta = 0
    for y in range(h0):
        a_row, b_row = rows0[y], rows1[y]
        for x in range(0, w0 * 4, 4):
            d = 0
            for c in range(3):
                v = abs(a_row[x + c] - b_row[x + c])
                d = max(d, v)
                delta_sum += v
            total += 1
            max_delta = max(max_delta, d)
            if d > TOLERANCE:
                changed += 1
    frac = changed / max(1, total)
    mean = delta_sum / max(1, total * 3)
    check(frac <= MAX_CHANGED,
          "%s: changed pixels %.4f%% <= %.2f%% (max channel delta %d)" %
          (name, 100.0 * frac, 100.0 * MAX_CHANGED, max_delta))
    check(mean <= MAX_MEAN, "%s: mean channel delta %.4f <= %.2f" % (name, mean, MAX_MEAN))


def vfx_setup():
    categories = {
        "combat": ["muzzle_flash", "hit_spark"],
        "fire": ["fire_small", "heat_distortion"],
        "magic": ["boss_aura", "portal"],
    }
    js = []
    for category, names in categories.items():
        for name in names:
            path = os.path.join(ROOT, "assets", "vfx", category, name + ".json")
            with open(path, "r", encoding="utf-8") as handle:
                js.append("vfxLab.world.vfx.define(%s,%s);" %
                          (json.dumps(name), json.dumps(handle.read())))
    js.append('vfxLab.world.backend("gpu");')
    js.append('vfxLab.world.vfx.spawn("muzzle_flash",{x:150,y:20,h:60});')
    js.append('vfxLab.world.vfx.spawn("fire_small",{x:150,y:20,h:60});')
    js.append('vfxLab.world.vfx.spawn("boss_aura",{x:150,y:20,h:70});')
    js.append('vfxLab.world.vfx.spawn("portal",{x:150,y:20,h:60});')
    js.append("true")
    return "".join(js)


def main():
    update = "--update" in sys.argv[1:]
    print("== visual lab")
    visual_game = "demos/re2d_visual_lab"
    if not os.path.isdir(os.path.join(ROOT, visual_game)):
        visual_game = "demos/re2d_world_renderer_lab"
        print("  note: demos/re2d_visual_lab missing; using renderer lab fallback")
    shot, _ = capture("re2d_visual_lab", visual_game, None,
                      'world.backend("gpu");world.qualityPreset("high");true', 3)
    compare("re2d_visual_lab", shot, update)

    print("== vfx lab")
    shot, _ = capture("re2d_vfx_lab", "demos/re2d_vfx_lab", None, vfx_setup(), 4)
    compare("re2d_vfx_lab", shot, update)

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
