#!/usr/bin/env python3
"""R-04 full huge world: hierarchical regions/PVS/clusters, budgeted streaming,
LOD counters and distant impostors on the compiled open-world lab.

The lab loads a real `.re2dworld` compiled with --region-size 256. The runtime
must expose region/current/active/preload, cluster PVS edges, occluder-culled
regions, cell rejections, stream upload budget counters, LOD counters and
impostor cards. Crossing several regions must not produce NaNs, errors or stale
handles, and world.regionConfig() must be honored by the runtime.

Run: python3 tests/agent/re2d_huge_world_test.py
"""
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

GAME = "demos"
SCENE = "re2d_openworld_lab"
FAILED = []
METRICS = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def snapshot(a):
    return json.loads(a.eval("JSON.stringify(re2dOpenWorld.snapshot())") or "{}")


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def region_point(slot):
    columns = 8
    size = 256
    col = slot % columns
    row = slot // columns
    return size * col + size // 2, size * row + size // 2


def main():
    with Agent(game=GAME, scene=SCENE, seed=11) as a:
        if skip_without_re2d(a):
            return 0
        a.step(8)
        snap = snapshot(a)
        native = snap.get("native") or {}
        check(bool(snap.get("loaded")), "openworld lab loaded a compiled .re2dworld")
        check(native.get("regionCount", 0) >= 8,
              f"runtime built the region grid: {native.get('regionCount')}")
        check(native.get("regionPvsEdges", 0) > 0,
              f"coarse region PVS edges: {native.get('regionPvsEdges')}")
        check(native.get("regionSizeHint") == 256,
              f"compiler --region-size metadata honored: {native.get('regionSizeHint')}")
        check(native.get("clusterEdges", 0) > 0,
              f"vis cluster PVS edges: {native.get('clusterEdges')}")
        check(native.get("regionActive", 0) >= 1, "active region ring present")
        check(native.get("regionPreload", 0) >= 1, "preload region ring present")

        # Cross several occupied compiler regions, as a streaming boundary test.
        slots = [1, 3, 9, 29, 41, 55, 62]
        visited = []
        for slot in slots:
            x, y = region_point(slot)
            a.eval(f"re2dOpenWorld.teleport({x}, {y})")
            a.step(4)
            snap = snapshot(a)
            native = snap.get("native") or {}
            region = native.get("regionCurrent")
            visited.append(region)
            METRICS.append({
                "slot": slot, "x": x, "y": y, "region": region,
                "active": native.get("regionActive"),
                "culled": native.get("regionCulled"),
                "cellsAllowed": native.get("cellsAllowed"),
                "cellsCulled": native.get("cellsCulled"),
                "impostors": native.get("visibleImpostors"),
                "frameMs": native.get("frameMs"),
            })
            check(isinstance(region, int) and region >= 0,
                  f"slot {slot} resolves to a native region ({region})")
            check(isinstance(native.get("regionCulled"), int) and native["regionCulled"] >= 0,
                  f"slot {slot} reports culled regions")
            check(isinstance(native.get("cellsAllowed"), int) and native["cellsAllowed"] >= 0,
                  f"slot {slot} reports allowed cells")
            origin = native.get("renderOrigin") or {}
            check(finite(origin.get("x")) and finite(origin.get("y")),
                  f"slot {slot} has a region-local render origin")
            check(finite(native.get("frameMs")), f"slot {slot} frame time is finite")
            local = json.loads(a.eval(f"JSON.stringify(re2dOpenWorld.regionLocal({x}, {y}))") or "null")
            check(local is not None and finite(local.get("localX")) and finite(local.get("localY")),
                  f"slot {slot} region-local coordinate conversion")
        check(len(set(visited)) >= 4,
              f"teleporting crosses multiple regions: {visited}")

        # Budgeted streaming counters must be live and finite.
        native = snapshot(a).get("native") or {}
        for key in ("streamUploads", "streamUploadBytes", "streamEvictions",
                    "streamTotalUploads", "streamTotalUploadBytes",
                    "streamTotalEvictions", "streamResidentBytes",
                    "texturesResident", "atlasesResident"):
            check(finite(native.get(key)), f"stream counter {key} is finite: {native.get(key)}")
        check(native.get("streamResidentBytes", 0) >= 0, "resident payload bytes tracked")
        check(native.get("streamTotalUploads", 0) >= 1,
              f"budgeted uploads were actually performed: {native.get('streamTotalUploads')}")

        # LOD wiring counters: sprite/light/particle/decal/audio are computed.
        for key in ("lodHiddenActors", "lodThrottledActors", "lodHiddenAtlas",
                    "lodCulledLights", "lodCulledParticles", "lodCulledDecals",
                    "audioRegionCulled"):
            check(isinstance(native.get(key), int) and native[key] >= 0,
                  f"LOD counter {key} present: {native.get(key)}")

        # Distant impostor cards are renderer-ready data with finite fields.
        impostors = json.loads(a.eval("JSON.stringify(re2dOpenWorld.impostors())") or "[]")
        bad = []
        for card in impostors:
            if not all(finite(card.get(k)) for k in
                       ("region", "x", "y", "localX", "localY", "width",
                        "height", "bottom", "top", "distance")):
                bad.append(card)
                continue
            if not (card["width"] > 0 and card["height"] > 0 and
                    0 <= card["bottom"] < card["top"] and card["distance"] >= 0):
                bad.append(card)
        check(len(bad) == 0, f"impostor cards are valid ({len(impostors)} cards)")
        check(len(impostors) <= 64, "impostor collection respects the visible budget")

        # Door/areaportal changes rebuild the coarse PVS before local BSP.
        before = snapshot(a).get("native") or {}
        check(before.get("regionPvsEdges", 0) > 0, "PVS edges exist before closing portals")
        portals = json.loads(a.eval("JSON.stringify(re2dOpenWorld.setPortalsClosed(true))") or "0")
        a.step(3)
        closed = snapshot(a).get("native") or {}
        check(portals >= 1, f"closed {portals} portals/areaportals")
        check(closed.get("regionPvsEdges", -1) == 0,
              f"closed portals rebuild PVS to self-only: {closed.get('regionPvsEdges')}")
        check(closed.get("regionCulled", 0) >= closed.get("regionCount", 0) - 6,
              "closed portals cut whole distant region branches")
        a.eval("re2dOpenWorld.setPortalsClosed(false)")
        a.step(3)
        reopened = snapshot(a).get("native") or {}
        check(reopened.get("regionPvsEdges", 0) == before.get("regionPvsEdges", -1),
              "reopening portals rebuilds the original PVS")

        # Runtime config is honored without stale handles or errors.
        a.eval("re2dOpenWorld.regionConfig(256, 1, 2, 131072, 2)")
        a.step(3)
        native = snapshot(a).get("native") or {}
        check(native.get("regionSizeHint") == 256, "regionConfig keeps the 256 compiler size")
        check(native.get("regionActive", 0) >= 1, "regionConfig keeps a valid active ring")
        a.eval("re2dOpenWorld.regionConfig(256, 2, 3, 262144, 4)")
        a.step(3)
        native = snapshot(a).get("native") or {}
        check(native.get("regionActive", 0) >= 1, "wider active ring still valid")
        check(native.get("regionCurrent", -1) >= 0, "current region survives config change")

        errors = a.eval("JSON.stringify($.debug.errors())")
        check(errors in ("[]", None), f"no game script errors: {errors}")
        print()
        print("huge-world metrics:")
        for row in METRICS:
            print("  " + json.dumps(row, ensure_ascii=False))
        print("  impostors=%d stream=%s" % (len(impostors), json.dumps({
            k: native.get(k) for k in ("streamUploads", "streamUploadBytes",
                                        "streamEvictions", "streamResidentBytes")
        })))

    print()
    if FAILED:
        print("FAILURES:", len(FAILED))
        for item in FAILED:
            print("  -", item)
        return 1
    print("All huge-world checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
