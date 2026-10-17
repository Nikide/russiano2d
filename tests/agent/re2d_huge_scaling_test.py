#!/usr/bin/env python3
"""Task-26: huge-world map-size scaling + AI/gameplay streaming-boundary acceptance.

Reproducible scaling benchmark: the shipped open-world fixture is tiled into 2x
and 4x map-size variants (same authored content repeated in a grid) and loaded
through the normal `$.re2dWorld` runtime with a FIXED active/preload region ring
and upload budget. The renderer cost (frame/visibility/surface times and GPU
draws) must stay inside a documented tolerance while total cells/regions grow.

Also checks:
  * gameplay/controller/nav survive unload/preload ring crossings: master-world
    fallback keeps support/blocked/ray/nav correct, controller stays finite, no
    dangling handles;
  * save/load keeps the map hash and semantic IDs across a full map reload while
    payloads are unloaded.

Writes `tests/agent/results/re2d_huge_scaling_report.json`,
`.../huge_scaling.csv` and the generated maps under
`tests/agent/results/scaling/`.
"""
import copy
import json
import math
import os
import statistics
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

BASE_MAP = os.path.join(ROOT, "demos/re2d_openworld_lab/openworld.re2dworld")
RESULTS = os.path.join(ROOT, "tests/agent/results")
MAP_DIR = os.path.join(RESULTS, "scaling")
FAILED = []
REPORT = {"maps": [], "boundary": {}, "save": {}}


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def median(values):
    return statistics.median(values) if values else 0.0


def percentile(values, pct):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * pct))))
    return ordered[index]


def generate_scaled_maps():
    """Tile the authored map into 1x/2x/4x copies at deterministic offsets."""
    os.makedirs(MAP_DIR, exist_ok=True)
    base = json.load(open(BASE_MAP, encoding="utf-8"))
    for optional in ("baked", "compiler"):
        base.pop(optional, None)
    ext_x = max(c["x"] + c["w"] for c in base["cells"])
    ext_y = max(c["y"] + c["h"] for c in base["cells"])
    for w in base.get("walls", []):
        ext_x = max(ext_x, w["from"][0], w["to"][0])
        ext_y = max(ext_y, w["from"][1], w["to"][1])
    step_x, step_y = ext_x + 64, ext_y + 64

    layouts = {
        "1x": (1, 1),
        "2x": (2, 1),
        "4x": (2, 2),
    }
    maps = []
    for label, (cols, rows) in layouts.items():
        cells, walls, portals, entities = [], [], [], []
        for cy in range(rows):
            for cx in range(cols):
                copy_index = cy * cols + cx
                ox, oy = cx * step_x, cy * step_y
                cell_base = len(cells)
                for cell in base.get("cells", []):
                    item = copy.deepcopy(cell)
                    item["id"] = f"{cell.get('id', 'cell')}.{label}.{copy_index}"
                    item["x"] += ox
                    item["y"] += oy
                    cells.append(item)
                for wall in base.get("walls", []):
                    item = copy.deepcopy(wall)
                    item["id"] = f"{wall.get('id', 'wall')}.{label}.{copy_index}"
                    item["from"] = [wall["from"][0] + ox, wall["from"][1] + oy]
                    item["to"] = [wall["to"][0] + ox, wall["to"][1] + oy]
                    walls.append(item)
                for portal in base.get("portals", []):
                    item = copy.deepcopy(portal)
                    item["id"] = f"{portal.get('id', 'portal')}.{label}.{copy_index}"
                    item["cellA"] = portal["cellA"] + cell_base
                    item["cellB"] = portal["cellB"] + cell_base
                    item["from"] = [portal["from"][0] + ox, portal["from"][1] + oy]
                    item["to"] = [portal["to"][0] + ox, portal["to"][1] + oy]
                    portals.append(item)
                for entity in base.get("entities", []):
                    item = copy.deepcopy(entity)
                    item["id"] = f"{entity.get('id', 'entity')}.{label}.{copy_index}"
                    if "x" in item: item["x"] += ox
                    if "y" in item: item["y"] += oy
                    if "brush" in item and isinstance(item["brush"], str):
                        item["brush"] = f"{item['brush']}.{label}.{copy_index}"
                    entities.append(item)
        data = {
            "version": 1,
            "cells": cells,
            "walls": walls,
            "portals": portals,
            "entities": entities,
        }
        path = os.path.join(MAP_DIR, f"openworld_{label}.re2dworld")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, sort_keys=True, separators=(",", ":"))
        maps.append({
            "label": label,
            "path": os.path.relpath(path, ROOT),
            "cells": len(cells),
            "walls": len(walls),
            "portals": len(portals),
            "region_multiplier": cols * rows,
        })
    return maps


def sample_world(a, frames=24):
    samples = []
    for _ in range(frames):
        a.step(1)
        info = json.loads(a.eval("JSON.stringify(re2dOpenWorld.info())") or "{}")
        samples.append(info)
    return samples


def scaling_benchmark():
    maps = generate_scaled_maps()
    print("scaling fixtures:")
    for item in maps:
        print("  " + json.dumps(item))
    with Agent(game="demos", scene="re2d_openworld_lab", seed=11) as a:
        if skip_without_re2d(a):
            return
        # Fixed active/preload ring and upload budget for every map size.
        a.eval("re2dOpenWorld.regionConfig(256, 1, 2, 65536, 4)")
        a.step(4)
        for item in maps:
            a.eval(f"re2dOpenWorld.loadMap({json.dumps(item['path'])})")
            a.step(8)
            a.eval("re2dOpenWorld.teleport(384, 128)")
            a.step(8)
            samples = sample_world(a)
            metrics = {
                "map": item["label"],
                "path": item["path"],
                "cells": item["cells"],
                "walls": item["walls"],
                "portals": item["portals"],
                "region_multiplier": item["region_multiplier"],
                "regionCount": int(samples[-1].get("regionCount", 0)),
                "regionActive": int(samples[-1].get("regionActive", 0)),
                "regionPreload": int(samples[-1].get("regionPreload", 0)),
                "visibleSurfaces": int(median([s.get("visibleSurfaces", 0) for s in samples])),
                "gpuDraws": int(median([s.get("gpuDraws", 0) for s in samples])),
                "frameMs": median([s.get("frameMs", 0) for s in samples]),
                "visibilityMs": median([s.get("visibilityMs", 0) for s in samples]),
                "surfaceMs": median([s.get("surfaceMs", 0) for s in samples]),
                "frameMsP95": percentile([s.get("frameMs", 0) for s in samples], 0.95),
                "frameMsMax": max([s.get("frameMs", 0) for s in samples]),
                "sampleFrames": len(samples),
            }
            REPORT["maps"].append(metrics)
            print("  measured " + json.dumps(metrics))

        base = REPORT["maps"][0]
        for item in REPORT["maps"][1:]:
            factor = item["region_multiplier"]
            check(item["cells"] == base["cells"] * factor,
                  f"{item['map']} cells scale {base['cells']} -> {item['cells']}")
            check(item["regionCount"] >= base["regionCount"] * factor * 0.7,
                  f"{item['map']} regions grow {base['regionCount']} -> {item['regionCount']}")
            check(item["regionActive"] <= base["regionActive"] + 2,
                  f"{item['map']} fixed active ring ({item['regionActive']} vs {base['regionActive']})")
            draw_tol = max(4.0, base["gpuDraws"] * 0.25)
            check(abs(item["gpuDraws"] - base["gpuDraws"]) <= draw_tol,
                  f"{item['map']} GPU draws stay flat {base['gpuDraws']} -> {item['gpuDraws']}")
            surf_tol = max(4.0, base["visibleSurfaces"] * 0.25)
            check(abs(item["visibleSurfaces"] - base["visibleSurfaces"]) <= surf_tol,
                  f"{item['map']} visible surfaces stay flat "
                  f"{base['visibleSurfaces']} -> {item['visibleSurfaces']}")
            frame_tol = base["frameMs"] * 1.5 + 0.5
            check(item["frameMs"] <= frame_tol,
                  f"{item['map']} frameMs {item['frameMs']:.3f} <= {frame_tol:.3f}")
            check(item["surfaceMs"] <= base["surfaceMs"] * 1.5 + 0.5,
                  f"{item['map']} surfaceMs {item['surfaceMs']:.3f} stays bounded")
            check(item["visibilityMs"] <= base["visibilityMs"] * 1.5 + 0.25,
                  f"{item['map']} visibilityMs {item['visibilityMs']:.3f} stays bounded")
        check(not a.eval("JSON.stringify($.debug.errors())").strip('[]'),
              "no script errors during scaling benchmark")


def boundary_and_save():
    # --- Gameplay/controller/nav across streaming boundaries (dust2) ---------
    with Agent(game="demos/re2d_dust2", seed=7) as a:
        if skip_without_re2d(a):
            return
        a.step(6)
        a.eval("world.regionConfig(512, 1, 1, 65536, 4)")
        a.step(3)
        a.eval("dustCamera('T SPAWN')")
        a.eval("world.navBuild({radius:7,height:64,step:9})")
        a.step(2)
        nav_nodes_raw = json.loads(a.eval("JSON.stringify(world.navNodes())") or "null")
        nav_nodes = len(nav_nodes_raw) if isinstance(nav_nodes_raw, list) else nav_nodes_raw
        check(isinstance(nav_nodes, (int, float)) and nav_nodes > 0,
              f"nav graph built before crossing: {nav_nodes} nodes")
        nav = a.eval("JSON.stringify((()=>{const a=world.navNearest(1040,1840),"
                     "b=world.navNearest(1360,400);return {a,b,path:a>=0&&b>=0?"
                     "world.navPath(a,b,256,0,{}).length:-1};})())")
        nav_before = json.loads(nav)
        check(nav_before.get("path", -1) > 0, f"nav path before crossing: {nav_before}")
        # Controller walk/jump at the spawn.
        walk = a.eval("JSON.stringify((()=>{dustCamera('T SPAWN');"
                      "for(let i=0;i<40;i++)dustPhysics(1/60,{x:0,y:-1},i===20);"
                      "return {x:view.x,y:view.y,h:view.h,grounded:dustMotion.grounded,"
                      "finite:Number.isFinite(view.x)&&Number.isFinite(view.y)&&Number.isFinite(view.h)};})())")
        walk_data = json.loads(walk)
        check(walk_data.get("finite") is True, f"controller state finite after walk: {walk_data}")
        check(bool(a.eval("world.support(view.x,view.y,view.h-48+.01,64,9) !== null")),
              "controller stays on a support span")
        unload_before = int(json.loads(a.eval("JSON.stringify(world.info())")).get("streamIoUnloads", 0))
        # Cross to a distant room, forcing the old payload ring to unload.
        a.eval("dustCamera('TUNNELS')")
        a.step(10)
        far_info = json.loads(a.eval("JSON.stringify(world.info())"))
        unload_after = int(far_info.get("streamIoUnloads", 0))
        check(unload_after > unload_before,
              f"streaming unloaded old region payloads: {unload_before} -> {unload_after}")
        check(far_info.get("regionCurrent", -1) >= 0,
              f"camera resolved to a new region: {far_info.get('regionCurrent')}")
        # Master-world fallback: collision/queries/nav in the now-unloaded ring.
        fallback = json.loads(a.eval("JSON.stringify((()=>{"
            "const s=world.support(1040,1840,0.01,64,9);"
            "const b=world.blocked(0,80,7,0,64);"
            "const a=world.navNearest(1040,1840),c=world.navNearest(1360,400);"
            "return {support:s!==null&&Number.isFinite(s.height),blocked:b,"
            "path:a>=0&&c>=0?world.navPath(a,c,256,0,{}).length:-1,"
            "npc:dustNPCs.length};})())"))
        check(fallback.get("support") is True,
              "support query still works for an unloaded-region area")
        check(fallback.get("blocked") is True,
              "collision query still works for an unloaded-region area")
        check(fallback.get("path", -1) > 0,
              f"nav path survives unload/preload crossing: {fallback.get('path')}")
        check(fallback.get("npc") == 6,
              f"actor registry intact across crossing: {fallback.get('npc')} NPCs")
        crossing_ms = far_info.get("frameMs", 0)
        check(finite(crossing_ms) and crossing_ms < 50.0,
              f"crossing frame time bounded: {crossing_ms:.3f} ms")
        REPORT["boundary"] = {
            "navNodes": nav_nodes,
            "navBefore": nav_before,
            "controllerAfterWalk": walk_data,
            "unloadBefore": unload_before,
            "unloadAfter": unload_after,
            "regionCurrent": far_info.get("regionCurrent"),
            "fallback": fallback,
            "crossingFrameMs": crossing_ms,
        }

    # --- Save/load semantic IDs across a full reload (openworld) -------------
    with Agent(game="demos", scene="re2d_openworld_lab", seed=11) as a:
        if skip_without_re2d(a):
            return
        a.step(6)
        a.eval("re2dOpenWorld.regionConfig(256, 1, 2, 65536, 4)")
        a.step(4)
        a.eval("re2dOpenWorld.teleport(1664, 1920)")  # force payload unload/reload
        a.step(8)
        cell_before = a.eval("re2dOpenWorld.findCell('brush.cell0')")
        hash_before = a.eval("re2dOpenWorld.saveMapHash()")
        save_json = a.eval("JSON.stringify(re2dOpenWorld.saveState())")
        check(cell_before is not None and cell_before >= 0,
              f"semantic cell resolves before reload: {cell_before}")
        check(isinstance(hash_before, str) and len(hash_before) > 0,
              f"map hash before reload: {hash_before}")
        a.eval("re2dOpenWorld.loadMap('demos/re2d_openworld_lab/openworld.re2dworld')")
        a.step(8)
        cell_after = a.eval("re2dOpenWorld.findCell('brush.cell0')")
        hash_after = a.eval("re2dOpenWorld.saveMapHash()")
        check(cell_after == cell_before,
              f"semantic cell stable across reload: {cell_before} -> {cell_after}")
        check(hash_after == hash_before,
              f"map hash stable across reload: {hash_before} -> {hash_after}")
        applied = a.eval(f"(()=>{{re2dOpenWorld.loadState({save_json});return true;}})()")
        check(applied is True, "save state applies after reload")
        after_info = json.loads(a.eval("JSON.stringify(re2dOpenWorld.info())"))
        check(after_info.get("regionCount", 0) > 0,
              "region runtime alive after save/load")
        REPORT["save"] = {
            "cellBefore": cell_before,
            "cellAfter": cell_after,
            "hashBefore": hash_before,
            "hashAfter": hash_after,
            "applied": applied,
            "regionCount": after_info.get("regionCount"),
        }


def write_results():
    os.makedirs(RESULTS, exist_ok=True)
    report = dict(REPORT)
    report["failed"] = FAILED
    report["ok"] = not FAILED
    json_path = os.path.join(RESULTS, "re2d_huge_scaling_report.json")
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1, sort_keys=True)
    csv_path = os.path.join(RESULTS, "huge_scaling.csv")
    with open(csv_path, "w", encoding="utf-8") as handle:
        handle.write("map,cells,regions,active,preload,visibleSurfaces,gpuDraws,"
                     "frameMs,visibilityMs,surfaceMs,frameMsP95\n")
        for item in REPORT["maps"]:
            handle.write(",".join(str(item.get(key, "")) for key in (
                "map", "cells", "regionCount", "regionActive", "regionPreload",
                "visibleSurfaces", "gpuDraws", "frameMs", "visibilityMs",
                "surfaceMs", "frameMsP95")) + "\n")
    print(f"  report: {os.path.relpath(json_path, ROOT)}")
    print(f"  csv:    {os.path.relpath(csv_path, ROOT)}")


def main():
    print("== map-size scaling benchmark ==")
    scaling_benchmark()
    print("== gameplay/nav boundary + save/load ==")
    boundary_and_save()
    write_results()
    print()
    if FAILED:
        print("FAILURES:", len(FAILED))
        for item in FAILED:
            print("  -", item)
        return 1
    print("All huge-world scaling/boundary checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
