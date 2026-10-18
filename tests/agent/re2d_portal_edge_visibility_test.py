#!/usr/bin/env python3
"""Re2D portal-edge visibility: a top-down camera near a cell boundary must not
drop whole cell groups for a frame.

Reproduces the GTA2-test 1.2.8 report through the public `$.re2dWorld.fromJSON`
API: a chain of open cells with tall spans, a nearly vertical camera 0.1..1.5
units from the portal plane. The native portal window used to be near-plane
clipped, so an aperture seen edge-on projected to a truncated screen window and
far cells were culled; visibility popped 12 -> 7 cells on the reporter's map.

Expected after the fix: the same visible cell/surface count at every offset on
both sides of the plane (no multi-cell drop), CPU and GPU agree.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402

FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def world_json(chain=4):
    """Open corridor of `chain` cells, each with a tall free span 0..120."""
    cells = [{"x": i * 100, "y": 0, "w": 100, "h": 100,
              "spans": [{"bottom": 0, "top": 120}]} for i in range(chain)]
    portals = [{"cellA": i, "cellB": i + 1,
                "from": [(i + 1) * 100, 0], "to": [(i + 1) * 100, 100],
                "openings": [{"bottom": 0, "top": 120}]} for i in range(chain - 1)]
    return json.dumps({"version": 1, "cells": cells, "walls": [], "portals": portals})


def sample(agent, backend, x, y):
    agent.eval("(()=>{W.backend(%r);W.camera({x:%r,y:%r,h:60,pitch:-89.99,yaw:0,"
               "fov:55,near:1});W.render(null,320,180);return true})()" % (backend, x, y))
    info = agent.eval("JSON.stringify({cells:W.info().visibleCells,"
                      "spans:W.info().visibleSpans,surfaces:W.info().visibleSurfaces,"
                      "conservative:W.info().portalsConservative})")
    return json.loads(info)


def main():
    with Agent(game="demos", scene="re2d_visual_lab", seed=7, fixed_dt=1.0 / 60.0) as agent:
        agent.step(2)
        agent.eval("(()=>{globalThis.W=$.re2dWorld.fromJSON(%s).backend('gpu');return true})()"
                   % json.dumps(world_json()))
        built = agent.eval("W.info().cells")
        check(built == 4, "synthetic four-cell chain loads (cells=%s)" % built)

        # Camera is 0.2 west of the first portal plane; sweep across the plane
        # and around the second portal plane. Every sample must keep the whole
        # open corridor visible (4 cells / 8 surfaces).
        samples = []
        for backend in ("gpu", "cpu"):
            for x in (99.9, 99.8, 99.5, 99.0, 100.0, 100.1, 100.2, 100.5, 101.0):
                samples.append((backend, x, 50.0, sample(agent, backend, x, 50.0)))
            for y in (49.5, 49.9, 50.0, 50.1, 50.5):
                samples.append((backend, 99.8, y, sample(agent, backend, 99.8, y)))
        baseline = samples[0][3]
        bad = [(b, x, y, r) for (b, x, y, r) in samples
               if (r["cells"], r["surfaces"]) != (baseline["cells"], baseline["surfaces"])]
        check(not bad, "no cell/surface drop near the portal plane (baseline %s, mismatches %d)"
              % (baseline, len(bad)))
        for item in bad[:4]:
            print("    mismatch", item, flush=True)
        check(baseline["cells"] == 4,
              "open corridor keeps all four cells visible (got %s)" % baseline["cells"])
        check(baseline.get("conservative", 0) > 0,
              "edge-on apertures are reported as conservative windows (%s)" % baseline.get("conservative"))
        check(not agent.eval("$.debug.errors()"), "no script errors")

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
