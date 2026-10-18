#!/usr/bin/env python3
"""Visibility preflight: sweep camera offsets around every portal plane and flag
one-frame cell/surface drops (the "geometry disappears near a cell boundary"
class, GTA2-test 1.2.8).

The world camera is placed at offsets on both sides of each unique portal plane
and rendered through the public `$.re2dWorld` API. A sample is suspicious when
it loses more than `--tolerance-cells` visible cells (or >20% surfaces) compared
with the same point 1-2 units away from the plane — the signature of a portal
window under-approximation. `portalsConservative` is reported too: it counts
portals whose window had to be widened to the full view (edge-on / near-plane
crossing apertures). A large number on an ordinary first-person camera means
the view is unusually grazing and worth a look.

Usage:
  python3 tools/visibility_sweep.py \
      --cwd /path/to/engine-dir --game ../my_game --binary build/russiano2d \
      --world-expr CITY_WORLD --map-expr CITY_MAP_DATA \
      --view '{"h":700,"pitch":-89.99,"yaw":0,"fov":55,"near":1}' \
      --json-out /tmp/visibility_sweep.json

`--map` accepts an authored map JSON file instead of `--map-expr`. `--binary`
defaults to build/russiano2d; `--cwd` to the engine repository root (the game
path is resolved from it).
"""
import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent  # noqa: E402


def plane_key(p):
    a = (round(p["from"][0], 3), round(p["from"][1], 3))
    b = (round(p["to"][0], 3), round(p["to"][1], 3))
    return tuple(sorted((a, b)))


def unique_planes(map_json):
    planes = []
    seen = set()
    for p in map_json.get("portals", []):
        frm, to = p.get("from"), p.get("to")
        if not (isinstance(frm, list) and isinstance(to, list) and len(frm) == 2 and len(to) == 2):
            continue
        key = plane_key(p)
        if key in seen:
            continue
        seen.add(key)
        dx, dy = to[0] - frm[0], to[1] - frm[1]
        length = math.hypot(dx, dy)
        if length < 1e-3:
            continue
        planes.append({"from": frm, "to": to, "length": length,
                       "normal": (-dy / length, dx / length),
                       "tangent": (dx / length, dy / length)})
    return planes


def sample(agent, world_expr, view):
    code = ("(()=>{const w=%s;w.camera(%s);w.render(null,320,180);"
            "const i=w.info();return JSON.stringify({cells:i.visibleCells,"
            "spans:i.visibleSpans,surfaces:i.visibleSurfaces,"
            "conservative:i.portalsConservative,portals:i.portalsTested})})()"
            % (world_expr, json.dumps(view)))
    raw = agent.eval(code)
    return json.loads(raw)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--binary", default=os.path.join(ROOT, "build", "russiano2d"))
    ap.add_argument("--cwd", default=ROOT)
    ap.add_argument("--game", required=True)
    ap.add_argument("--scene", default=None)
    ap.add_argument("--world-expr", default="globalThis.CITY_WORLD")
    ap.add_argument("--map")
    ap.add_argument("--map-expr", default="globalThis.CITY_MAP_DATA")
    ap.add_argument("--view", default='{"h":700,"pitch":-89.99,"yaw":0,"fov":55,"near":1}')
    ap.add_argument("--offsets", default="0.1,0.5,1.0,2.0")
    ap.add_argument("--along", default="0.5")
    ap.add_argument("--max-planes", type=int, default=0)
    ap.add_argument("--tolerance-cells", type=int, default=1)
    ap.add_argument("--tolerance-surface-ratio", type=float, default=0.8)
    ap.add_argument("--json-out")
    args = ap.parse_args()

    view_template = json.loads(args.view)
    offsets = [float(x) for x in args.offsets.split(",") if x.strip()]
    along = [float(x) for x in args.along.split(",") if x.strip()]
    backend = view_template.pop("backend", "gpu")

    with Agent(binary=args.binary, cwd=args.cwd, game=args.game,
               scene=args.scene) as agent:
        agent.step(3)
        if args.map:
            map_json = json.load(open(args.map, encoding="utf-8"))
        else:
            map_json = json.loads(agent.eval("JSON.stringify(%s)" % args.map_expr))
        planes = unique_planes(map_json)
        if args.max_planes:
            planes = planes[:args.max_planes]
        agent.eval("%s.backend(%r);true" % (args.world_expr, backend))

        issues = []
        samples = 0
        max_conservative = 0
        for index, plane in enumerate(planes):
            for frac in along:
                base_x = plane["from"][0] + (plane["to"][0] - plane["from"][0]) * frac
                base_y = plane["from"][1] + (plane["to"][1] - plane["from"][1]) * frac
                rows = []
                for offset in sorted(offsets):
                    for side in (-1.0, 1.0):
                        x = base_x + plane["normal"][0] * offset * side
                        y = base_y + plane["normal"][1] * offset * side
                        view = dict(view_template)
                        view["x"], view["y"] = round(x, 4), round(y, 4)
                        row = sample(agent, args.world_expr, view)
                        samples += 1
                        max_conservative = max(max_conservative, row.get("conservative", 0))
                        rows.append({"offset": offset * side, "x": view["x"], "y": view["y"], **row})
                far = [r for r in rows if abs(r["offset"]) >= 1.0]
                if not far:
                    far = rows
                ref_cells = max(r["cells"] for r in far)
                ref_surfaces = max(r["surfaces"] for r in far)
                for r in rows:
                    if abs(r["offset"]) > 0.5:
                        continue
                    cells_lost = ref_cells - r["cells"]
                    surfaces_lost = ref_surfaces - r["surfaces"]
                    ratio = (r["surfaces"] / ref_surfaces) if ref_surfaces else 1.0
                    if cells_lost > args.tolerance_cells or (
                            ref_surfaces >= 5 and ratio < args.tolerance_surface_ratio):
                        issues.append({
                            "plane": index, "from": plane["from"], "to": plane["to"],
                            "along": frac, "offset": r["offset"], "x": r["x"], "y": r["y"],
                            "cells": r["cells"], "refCells": ref_cells,
                            "surfaces": r["surfaces"], "refSurfaces": ref_surfaces,
                        })
            if (index + 1) % 25 == 0:
                print("  planes %d/%d, samples %d, issues %d"
                      % (index + 1, len(planes), samples, len(issues)), flush=True)

    report = {"binary": args.binary, "game": args.game, "backend": backend,
              "planes": len(planes), "samples": samples,
              "maxConservative": max_conservative,
              "issues": issues}
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=1)
    print("planes=%d samples=%d maxConservative=%d issues=%d"
          % (len(planes), samples, max_conservative, len(issues)))
    for item in issues[:10]:
        print("  DROP plane %(plane)d [%(from)s..%(to)s] along %(along).2f "
              "offset %(offset)+.2f: cells %(cells)d/%(refCells)d "
              "surfaces %(surfaces)d/%(refSurfaces)d" % item)
    if len(issues) > 10:
        print("  ... %d more" % (len(issues) - 10))
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
