#!/usr/bin/env python3
# ===========================================================================
# P1 polygon cells: authored rectilinear polygon -> compile-time rect tiling ->
# runtime XY cells/portals/walls. Slanted edges are rejected with a diagnostic
# (no silent AABB fallback).
#
# Запуск: python3 tests/agent/re2d_polygon_cells_test.py
# ===========================================================================

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

SDK = os.environ.get("R2D_BINARY", "build/r2d")
L_MAP = "tests/fixtures/sdk/world/polygon_l.re2dmap"
SLANT_MAP = "tests/fixtures/sdk/world/polygon_slanted.re2dmap"
OUT = os.path.join("build", "test_polygon_l.re2dworld")
OUT_SLANT = os.path.join("build", "test_polygon_slanted.re2dworld")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    os.makedirs("build", exist_ok=True)
    r = subprocess.run([SDK, "world-compile", L_MAP, "--renderer", "--output", OUT],
                       capture_output=True, text=True)
    check(r.returncode == 0, f"L-полигон компилируется: rc={r.returncode} {r.stderr[-200:]}")
    compiled = json.load(open(OUT))
    cells = compiled.get("cells", [])
    check(len(cells) == 3, f"L-полигон ректиленейрно тайлится в {len(cells)} cells")
    check(all(c["id"].startswith("lroom") for c in cells), f"tile ids: {[c['id'] for c in cells]}")
    check(len(compiled.get("walls", [])) == 8, f"граничные стены: {len(compiled.get('walls', []))}")
    check(len(compiled.get("portals", [])) == 2, f"внутренние порталы: {len(compiled.get('portals', []))}")
    check(compiled.get("baked", {}).get("version", 0) >= 3, "baked payload собран")

    r = subprocess.run([SDK, "world-compile", SLANT_MAP, "--renderer", "--output", OUT_SLANT],
                       capture_output=True, text=True)
    combined = (r.stdout or "") + (r.stderr or "")
    check(r.returncode != 0 and "SDK_WORLD_POLYGON" in combined and "slanted" in combined,
          "slanted polygon отклонён с SDK_WORLD_POLYGON (без AABB fallback)")

    with Agent(game="demos", scene="re2d_boomer_lab", seed=5) as a:
        if skip_without_re2d(a):
            return 0
        a.step(5)
        code = ("(function(){try{var text=$.fs.readText('" + os.path.abspath(OUT) + "');"
                "var w=$.re2dWorld.fromJSON(text);var i=w.info();"
                "var inside=w.support(150,50,0,40,8);var notch=w.support(150,150,0,40,8);"
                "var blocked=w.blocked(150,150,4,0,40);"
                "var seam=w.support(120,50,0,40,8);"
                "w.dispose();return JSON.stringify({cells:i.cells,portals:i.portals,"
                "inside:inside&&inside.height,notch:notch,blocked:blocked,seam:seam&&seam.height});}"
                "catch(e){return 'ERR '+e}})()")
        state = a.eval(code)
        print("  runtime:", state)
        data = json.loads(state) if state and state.startswith("{") else {}
        check(data.get("cells") == 3 and data.get("portals") == 2,
              f"runtime загружает polygon world: {data}")
        check(data.get("inside") == 0 and data.get("seam") == 0, "пол внутри тайлов доступен")
        check(data.get("notch") is None,
              f"вырез L-полигона — void без floor/support (граничные стены рисуются): {data}")

    print()
    if FAILURES:
        print("ПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
