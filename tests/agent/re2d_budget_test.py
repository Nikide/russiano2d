#!/usr/bin/env python3
"""Renderer budgets + static batching counters (roadmap 123-125, 127).

Measures the shipped acceptance labs against the documented orientation
budgets and verifies that material/light batching stays batched:
  * regions active <= 9, preload <= 25 on the open-world lab;
  * visible sprites 100..300 (bench actors_100);
  * particles 1000..3000 (bench particles_2000);
  * decals 64..256 (renderer lab, 64 real decals);
  * relevant lights 8..16 and shadowed lights 2..6;
  * gpuMaterialBatches <= gpuDraws and span draws do not exceed visible surfaces.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

FAILED = []
DEMOS = "demos"


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def info(a):
    return json.loads(a.eval("JSON.stringify(world.info())") or "{}")


def budget(a, info_obj=None):
    if info_obj is None:
        return json.loads(a.eval("JSON.stringify(world.debug.budget())") or "{}")
    return json.loads(a.eval("JSON.stringify(world.debug.budget(%s))" % json.dumps(info_obj)) or "{}")


def row(report, metric):
    for item in report.get("rows", []):
        if item.get("metric") == metric:
            return item
    return {}


def main():
    # --- bench lab: sprites + particles ------------------------------------
    with Agent(game=DEMOS, scene="re2d_bench_lab", seed=7, fixed_dt=1.0 / 60.0) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        a.eval("re2dBench.apply('actors_100')")
        a.step(3)
        sprites = json.loads(a.eval("JSON.stringify(re2dBench.snapshot())"))
        check(100 <= sprites.get("actors", 0) <= 300,
              "visible sprites in budget 100..300: %s" % sprites.get("actors"))
        a.eval("re2dBench.apply('particles_2000')")
        a.step(3)
        part = json.loads(a.eval("JSON.stringify(re2dBench.snapshot())"))
        check(1000 <= part.get("particles", 0) <= 3000,
              "particles in budget 1000..3000: %s" % part.get("particles"))
        check(not a.eval("$.debug.errors()"), "bench lab has no script errors")

    # --- renderer lab: decals, lights, shadow lights, batching ------------
    with Agent(game=os.path.join("demos", "re2d_world_renderer_lab"),
               seed=7, fixed_dt=1.0 / 60.0) as a:
        if skip_without_re2d(a):
            return 0
        a.step(3)
        a.eval('world.backend("gpu");world.qualityPreset("high")')
        a.step(2)
        base = info(a)
        check(base.get("gpuDraws", 0) > 0, "renderer produces GPU draws: %s" % base.get("gpuDraws"))
        check(base.get("gpuMaterialBatches", 0) > 0,
              "material batches counted: %s" % base.get("gpuMaterialBatches"))
        check(base.get("gpuMaterialBatches", 0) <= base.get("gpuDraws", 0),
              "material batches do not exceed draws (%s <= %s)" %
              (base.get("gpuMaterialBatches"), base.get("gpuDraws")))
        check(base.get("gpuDrawsSpan", 0) > 0 and
              base.get("gpuDrawsSpan", 0) <= max(1, base.get("visibleSurfaces", 0)),
              "span draws stay batched: %s span draws / %s surfaces" %
              (base.get("gpuDrawsSpan"), base.get("visibleSurfaces")))
        check(base.get("visibleSurfaces", 0) > 0, "surfaces are visible")

        # 64 real decals (below the 128 native pool cap; budget 64..256).
        make_decals = ("for(let i=0;i<64;i++){try{world.decal({surface:i%world.info().surfaces,"
                       "material:'brick',u:(i%8)/8,v:Math.floor(i/8)/8,width:12,height:12,life:30})}"
                       "catch(e){}};world.info().decals")
        decals = a.eval(make_decals)
        check(64 <= (decals or 0) <= 256, "decals in budget 64..256: %s" % decals)
        report = budget(a)
        drow = row(report, "decals")
        check(drow.get("pass") is True and drow.get("status") in ("ok", "under"),
              "debug budget reports decals within ceiling: %s" % drow)

        # 10 extra relevant lights (2 authored shadow lights stay 2..6).
        a.eval("for(let i=0;i<10;i++)world.light({x:280+i*8,y:0,h:80,radius:160,intensity:1.1,"
               "color:'#ffccaa',shadow:false});"
               "for(let i=0;i<4;i++)world.light({x:300+i*12,y:0,h:64+i*18,radius:200,intensity:1.2,"
               "color:'#ffffff',shadow:true});true")
        a.step(2)
        lit = info(a)
        relevant = lit.get("lightsAfterCull", lit.get("lights", 0))
        check(8 <= relevant <= 16, "relevant lights in budget 8..16: %s" % relevant)
        check(2 <= lit.get("shadowedLights", 0) <= 6,
              "shadowed lights in budget 2..6: %s" % lit.get("shadowedLights"))
        report = budget(a)
        check(row(report, "lightsRelevant").get("pass") is True,
              "debug budget: relevant lights within ceiling")
        check(row(report, "shadowedLights").get("pass") is True,
              "debug budget: shadowed lights within ceiling")

        # Batching is stable across an unchanged frame.
        before = info(a)
        a.step(1)
        after = info(a)
        check(before.get("gpuDraws") == after.get("gpuDraws"),
              "draw count stable for an unchanged view: %s -> %s" %
              (before.get("gpuDraws"), after.get("gpuDraws")))
        check(after.get("gpuMaterialBatches", 0) <= after.get("gpuDraws", 0),
              "batching invariants hold after a frame")
        check(not a.eval("$.debug.errors()"), "renderer lab has no script errors")

    # --- open-world lab: regions ------------------------------------------
    with Agent(game=DEMOS, scene="re2d_openworld_lab", seed=7, fixed_dt=1.0 / 60.0) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        a.eval("globalThis.world=$.re2dWorld.load('re2d_openworld_lab/openworld.re2dworld').backend('gpu');"
               "globalThis.regView={x:160,y:160,h:96,yaw:0.6,pitch:0,fov:1.15,near:4};"
               "world.camera(regView);"
               "$.update(()=>{world.camera(regView);world.render(regView,640,360);});true")
        a.step(4)
        region = info(a)
        active = region.get("regionActive", 0)
        preload = region.get("regionPreload", 0)
        check(0 < active <= 9, "active regions <= 9 on open-world lab: %s" % active)
        check(0 < preload <= 25, "preload regions <= 25 on open-world lab: %s" % preload)
        report = budget(a)
        check(row(report, "regionsActive").get("pass") is True,
              "debug budget: active regions within ceiling")
        check(row(report, "regionsPreload").get("pass") is True,
              "debug budget: preload regions within ceiling")
        views = json.loads(a.eval("JSON.stringify(world.debug.views())"))
        features = json.loads(a.eval("JSON.stringify(world.debug.features())"))
        check("final" in views and "overdraw" in views, "native debug view enum surfaced")
        check(any(f.get("name") == "regions" for f in features),
              "counter-only region debug feature surfaced")
        check(not a.eval("$.debug.errors()"), "open-world lab has no script errors")

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
