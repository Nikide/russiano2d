#!/usr/bin/env python3
"""Re2D top-down (GTA2-style) camera: mode, projection, stable frame.

The world camera already supported orthographic projection and a steep pitch;
this test pins the new `mode:'topdown'` convenience and proves the rendered
frame actually differs from the first-person view, is not empty, and is stable
between frames. The visual lab sets its own camera every frame, so the test
replaces `world.camera` with a fixed view (the same technique the BASHNYA
repros use) — it does not edit demo/game sources.
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_native_test import decode  # noqa: E402

OUT = os.path.join(ROOT, "build", "re2d_topdown")
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def diff(a, b, tolerance=8):
    if (a[0], a[1]) != (b[0], b[1]):
        return 1.0
    rows0, rows1 = a[3], b[3]
    changed = 0
    total = 0
    for y in range(a[1]):
        row0, row1 = rows0[y], rows1[y]
        for x in range(0, a[0] * 4, 4):
            if max(abs(row0[x + c] - row1[x + c]) for c in range(3)) > tolerance:
                changed += 1
            total += 1
    return changed / max(1, total)


def mean_luma(img):
    rows, w, h = img[3], img[0], img[1]
    total = 0
    count = 0
    for y in range(h):
        row = rows[y]
        for x in range(0, w * 4, 4):
            total += (row[x] + row[x + 1] + row[x + 2]) / 3.0
            count += 1
    return total / max(1, count)


def shot(agent, name):
    path = os.path.join(OUT, name + ".png")
    agent.screenshot(path)
    return path, decode(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    with Agent(game="demos", scene="re2d_visual_lab", seed=7, fixed_dt=1.0 / 60.0) as agent:
        agent.step(3)
        agent.eval('visualLab.world.backend("gpu");visualLab.world.qualityPreset("high");true')
        agent.step(2)
        agent.eval("visualLab.world.atmosphere({heightDensity:0,hazeStrength:0});true")
        agent.step(2)
        _, perspective = shot(agent, "perspective")

        # Force a fixed bird's-eye view: the lab otherwise rewrites the camera
        # every frame. ceil-and-roof geometry must not produce NaN/black frames.
        agent.eval("""(()=>{const w=visualLab.world;w.__cam=w.camera;
            w.camera=()=>w.__cam({mode:'topdown',x:800,y:900,h:600,yaw:-90,orthoHeight:1200,near:1});return true})()""")
        agent.step(2)
        _, topdown = shot(agent, "topdown")
        agent.step(2)
        _, topdown_again = shot(agent, "topdown_again")

        info = agent.eval("JSON.stringify({cells:visualLab.world.info().visibleCells,"
                          "surfaces:visualLab.world.info().visibleSurfaces,"
                          "draws:visualLab.world.info().gpuDraws})")
        print("  info", info, flush=True)
        check(mean_luma(topdown) > 2.0, "topdown frame is not black")
        check(diff(topdown, perspective) > 0.02,
              "topdown frame differs from perspective view (%.2f%%)" % (100 * diff(topdown, perspective)))
        check(diff(topdown, topdown_again) < 0.001,
              "topdown frame is stable between frames (%.4f%%)" % (100 * diff(topdown, topdown_again)))
        check(not agent.eval("$.debug.errors()"), "no script errors")

        # Restore the real wrapper before negative and perspective checks.
        agent.eval("visualLab.world.camera=visualLab.world.__cam;delete visualLab.world.__cam;true")

        # Invalid modes are rejected before the native call.
        for bad in ("{mode:'iso'}", "{projection:'fisheye'}"):
            thrown = agent.eval("(()=>{try{visualLab.world.camera(%s);return 'no'}catch(e){return e.name}})()" % bad)
            check(thrown == "RangeError", "world.camera(%s) -> RangeError (got %s)" % (bad, thrown))
        # Going back to perspective keeps the legacy defaults.
        agent.eval("visualLab.world.camera({x:800,y:900,h:76,yaw:-90,pitch:0,fov:72,near:4});true")
        agent.step(2)
        _, back = shot(agent, "perspective_restored")
        check(diff(back, perspective) < 0.02,
              "perspective camera restored (%.4f%%)" % (100 * diff(back, perspective)))

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
