#!/usr/bin/env python3
"""Native debug overlays (region/PVS/cluster/areaportal/occluder/LOD/material/
AO/VFX budget), region stream timings and material inspector."""
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
VIEWS = ["region", "active-region", "pvs", "vis-cluster", "areaportal",
         "occluder", "distant-lod", "sprite-lod", "material-variation",
         "ao-lite", "vfx-budget"]


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def shot(a, name):
    path = os.path.join(ROOT, "build", "test_debug_" + name + ".png")
    a.screenshot(path)
    return b"".join(decode(path)[3])


def changed(a, b):
    return sum(1 for x, y in zip(a, b) if abs(x - y) > 3) / max(1, len(a))


def info(a):
    return json.loads(a.eval("JSON.stringify(world.info())") or "{}")


def main():
    with Agent(game=GAME, seed=7) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        a.eval('world.backend("gpu");world.qualityPreset("high")')
        a.step(2)
        names = json.loads(a.eval("JSON.stringify(world.debug.views())") or "[]")
        for name in VIEWS:
            check(name in names, "debug view registered: " + name)
        check(a.eval('world.debug.supported("region")') is True, "supported(region)")

        a.eval('world.debug.view("final")')
        a.step(1)
        base = shot(a, "final")
        frames = {}
        for name in VIEWS:
            a.eval('world.debug.view(%s)' % json.dumps(name))
            a.step(1)
            frame = shot(a, name.replace("-", "_"))
            frames[name] = frame
            check(changed(base, frame) > 0.0002,
                  "%s overlay changes the frame: %.2f%%" % (name, 100.0 * changed(base, frame)))
        # Distinct overlays with authored data must not be identical. Native
        # debug_views_test covers the synthetic data cases for every view;
        # areaportal/occluder/distant may be empty in this lab.
        for prev, cur in (("region", "active-region"), ("active-region", "pvs"),
                          ("pvs", "vis-cluster"), ("sprite-lod", "material-variation"),
                          ("material-variation", "ao-lite"), ("ao-lite", "vfx-budget")):
            check(changed(frames[prev], frames[cur]) > 0.00001,
                  "%s differs from %s" % (cur, prev))

        d = info(a)
        for key in ("regionStreamMs", "regionStreamIoMs", "regionLoadMs", "regionVisibilityMs"):
            value = d.get(key)
            check(isinstance(value, (int, float)) and value >= 0, "timing field %s: %s" % (key, value))
        check(d.get("regionActive", 0) >= 1 and d.get("regionPreload", 0) >= 0, "region counters present")

        # Material inspector: author a material, inspect by name/index/info.
        a.eval('world.material("dbg",{albedo:"demos/re2d_world_renderer_lab/panel.png",'
               'emissive:"demos/re2d_world_renderer_lab/panel_e.png",strength:1.5});'
               'world.surface(2).material("dbg")')
        m = json.loads(a.eval('JSON.stringify(world.debug.material("dbg"))') or "null")
        check(isinstance(m, dict) and m.get("name") == "dbg", "material inspector by name")
        check(m.get("blend") == 0 and m.get("surfaceCount", 0) >= 1, "material blend/surface count")
        check((m.get("albedo") or {}).get("width", 0) > 0, "material albedo info")
        check(isinstance(m.get("variation"), dict) and "tintR" in m["variation"], "material variation info")
        idx = json.loads(a.eval('JSON.stringify(world.debug.material(world.debug.materials().find(m=>m.name==="dbg").index))') or "null")
        check(isinstance(idx, dict) and idx.get("name") == "dbg", "material inspector by index")
        mats = info(a).get("materialList") or []
        check(any(x.get("name") == "dbg" for x in mats), "info.materials contains authored material")
        check(info(a).get("materialCount", 0) >= 1, "materialCount")

        a.eval('world.debug.view("final")')
        a.step(1)
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
