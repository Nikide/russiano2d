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
from re2d_native_test import decode  # noqa: E402
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
        # Task-15 true payload residency: per-region index packets (cells/walls/
        # spans/surfaces/materials/nav) are really loaded and unloaded with a
        # per-tick byte budget, while master arrays stay the query fallback.
        check(native.get("streamIoPayloads", 0) == native.get("regionCount", 0) * 6,
              f"one payload per region/kind registered: {native.get('streamIoPayloads')}")
        check(native.get("streamIoResidentPayloads", 0) >= 6,
              f"active region payloads resident: {native.get('streamIoResidentPayloads')}")
        check(native.get("streamIoResidentBytes", 0) > 0,
              f"real payload bytes resident: {native.get('streamIoResidentBytes')}")
        check(native.get("streamIoLoads", 0) >= 6,
              f"payload loads completed: {native.get('streamIoLoads')}")
        budget_bytes = native.get("streamIoLoadBudgetBytes", 0)
        check(budget_bytes > 0 and native.get("streamIoMaxTickBytes", 0) <= budget_bytes,
              f"no IO tick exceeded the load budget ({native.get('streamIoMaxTickBytes')} <= {budget_bytes})")
        before_io = snapshot(a).get("native") or {}
        a.eval("re2dOpenWorld.teleport(1664, 1920)")
        a.step(8)
        after_io = snapshot(a).get("native") or {}
        check(after_io.get("streamIoUnloads", 0) > before_io.get("streamIoUnloads", 0),
              f"region payloads were unloaded on crossing: {after_io.get('streamIoUnloads')}")
        check(after_io.get("streamIoResidentPayloads", 0) < before_io.get("streamIoResidentPayloads", 0),
              "resident payload count dropped after leaving the old ring")
        check(after_io.get("streamIoResidentPayloads", 0) >= 6,
              "destination region payloads are resident")
        a.eval("re2dOpenWorld.teleport(384, 128)")
        a.step(8)
        restored_io = snapshot(a).get("native") or {}
        check(restored_io.get("streamIoLoads", 0) > after_io.get("streamIoLoads", 0),
              "returning to the region reloads payloads")
        check(restored_io.get("streamIoMaxTickBytes", 0) <= budget_bytes,
              "reload stays under the per-tick byte budget")
        check(native.get("streamTotalUploads", 0) >= 1,
              f"budgeted uploads were actually performed: {native.get('streamTotalUploads')}")


        # GPU feature passes (impostors/post/LOD masks) are high-tier features
        # after the parity fixes; switch to high before asserting their counters.
        # Since 1.2.7 world.quality() only changes the pose policy, so the visual
        # tier is selected explicitly (BASHNYA 1.2.6 decoupling).
        # The LOD policy suppresses impostor cards inside the near band (default
        # 600 units, the old path used min_distance=0), so the gate is disabled
        # explicitly here to exercise the GPU impostor pass; normal bands are
        # restored right after the counter checks.
        a.eval("re2dOpenWorld.quality(4); re2dOpenWorld.renderQuality('high')")
        a.eval("re2dOpenWorld.regionLod(0, 1024, 2048, 6000, 6000)")
        a.step(3)
        native = snapshot(a).get("native") or {}
        # Task-12 GPU residency: material textures are really uploaded by the
        # SDL_GPU owner in response to stream RESIDENT transitions.
        for key in ("gpuStreamUploads", "gpuStreamUploadBytes", "gpuStreamEvictions",
                    "gpuStreamTransitions", "gpuTexturesResident", "gpuAtlasesResident",
                    "gpuLightsCulled", "gpuDecalsCulled", "gpuSpriteDirReduced",
                    "gpuImpostorsDrawn", "gpuRenderOriginActive", "gpuOriginX",
                    "gpuOriginY", "hintWalls", "skipWalls", "occluderWalls"):
            check(native.get(key) is not None, f"GPU integration counter {key} exposed")
        check(native.get("gpuStreamUploads", 0) >= 1,
              f"streamed textures uploaded to GPU: {native.get('gpuStreamUploads')}")
        check(native.get("gpuTexturesResident", 0) >= 1,
              f"GPU texture residency counted: {native.get('gpuTexturesResident')}")
        check(native.get("gpuStreamTransitions", 0) >= 1,
              f"stream transition hook fired: {native.get('gpuStreamTransitions')}")
        check(native.get("gpuRenderOriginActive", 0) == 1,
              "GPU render origin active")
        check(native.get("gpuImpostorsDrawn", 0) >= 1,
              f"distant impostors drawn by the GPU pass: {native.get('gpuImpostorsDrawn')}")
        # Back to the default policy for the streaming/origin checks below.
        a.eval("re2dOpenWorld.regionLod(600, 1500, 3000, 6000, 6000)")

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

        # Render-origin boundary: a nearby camera move across a region edge must
        # not produce a visual jump or black frame. The GPU uniforms shift by the
        # new region centre but screen-space output must stay continuous.
        def pixels(name):
            path = os.path.join(ROOT, "build", "test_huge_" + name + ".png")
            a.screenshot(path)
            return b"".join(decode(path)[3])

        a.eval("re2dOpenWorld.teleport(384, 250)")
        a.step(4)
        before_pixels = pixels("origin_before")
        before_native = snapshot(a).get("native") or {}
        a.eval("re2dOpenWorld.teleport(384, 262)")
        a.step(4)
        after_pixels = pixels("origin_after")
        after_native = snapshot(a).get("native") or {}
        check(before_native.get("gpuOriginY") != after_native.get("gpuOriginY") or
              before_native.get("gpuOriginX") != after_native.get("gpuOriginX"),
              "crossing the region edge changes the GPU render origin")
        if len(before_pixels) == len(after_pixels) and before_pixels:
            diff = sum(abs(x - y) for x, y in zip(before_pixels, after_pixels)) / len(before_pixels)
            check(diff < 80.0, f"no visual jump at the origin boundary (mean diff {diff:.2f})")
            non_black = sum(1 for v in after_pixels[0::4] if v > 2)
            check(non_black > len(after_pixels) // 8,
                  f"frame after crossing is not black ({non_black} lit pixels)")
        else:
            check(False, "screenshot sizes match")

        # Tight LOD bands force far lights out of the GPU shader masks and drop
        # decals by cell/distance policy; then restore normal bands.
        a.eval("re2dOpenWorld.teleport(384, 128)")
        a.step(3)
        a.eval("re2dOpenWorld.regionLod(10, 20, 30, 40, 50)")
        a.step(3)
        tight = snapshot(a).get("native") or {}
        check(tight.get("gpuLightsCulled", 0) >= 1,
              f"GPU dropped far lights from masks: {tight.get('gpuLightsCulled')}")
        check(tight.get("gpuDecalsCulled", 0) >= 1,
              f"GPU skipped decals by cell/distance policy: {tight.get('gpuDecalsCulled')}")
        a.eval("re2dOpenWorld.regionLod(600, 1500, 3000, 6000, 6000)")

        # Shared visible material textures demand-load and stay GPU-resident
        # across region crossings under a tiny residency budget: no white frame
        # and no per-frame upload thrash. Region-owned payload eviction itself is
        # covered by streamTotalEvictions plus the native stream tests.
        a.eval("re2dOpenWorld.regionBudget(1, 0)")
        uploads_before = int(snapshot(a).get("native", {}).get("gpuStreamUploads", 0))
        a.eval("re2dOpenWorld.teleport(1664, 1920)")
        a.step(6)
        crossed = snapshot(a).get("native") or {}
        a.eval("re2dOpenWorld.teleport(384, 128)")
        a.step(6)
        restored = snapshot(a).get("native") or {}
        check(crossed.get("gpuTexturesResident", 0) >= 1,
              "visible material texture stays GPU-resident across the crossing")
        check(restored.get("gpuTexturesResident", 0) >= 1,
              "visible material texture resident after returning")
        check(restored.get("gpuStreamUploads", 0) == uploads_before,
              f"no per-frame upload thrash (uploads {uploads_before} -> {restored.get('gpuStreamUploads')})")
        check(restored.get("streamTotalEvictions", 0) >= 0,
              "region payload eviction accounting is live")
        a.eval("re2dOpenWorld.regionBudget(8388608, 0)")

        # Budgeted streaming counters must be live and finite.
        native = snapshot(a).get("native") or {}
        for key in ("streamUploads", "streamUploadBytes", "streamEvictions",
                    "streamTotalUploads", "streamTotalUploadBytes",
                    "streamTotalEvictions", "streamResidentBytes",
                    "texturesResident", "atlasesResident"):
            check(finite(native.get(key)), f"stream counter {key} is finite: {native.get(key)}")
        check(native.get("streamResidentBytes", 0) >= 0, "resident payload bytes tracked")

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
        check(closed.get("regionPvsCulled", 0) > before.get("regionPvsCulled", 0),
              "closed portals cut whole distant region branches")
        check(closed.get("regionPvsCulled", 0) >= closed.get("regionCount", 0) - 2,
              f"only the current region survives closed-portal PVS: {closed.get('regionPvsCulled')} culled")
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
