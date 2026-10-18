#!/usr/bin/env python3
"""GTA-like sandbox: end-to-end city (Re2D tags/top-down/vehicles/peds/mission) + plain 2D.

Covers the roadmap acceptance pieces that are wiring, not library unit tests:
  * city scene loads, Re2D surface tags are readable via world.groundAt;
  * pedestrians spawn and are visible, car can be entered/driven/exited;
  * hitscan damages a pedestrian through the combat lib (damage payload + death);
  * delivery mission pickup -> dropoff completes;
  * plain 2D scene loads and the car drives (same vehicle/character libs, no Re2D);
  * both scenes render deterministic fixed-dt frames.
"""
import hashlib
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402

GAME = os.path.join(ROOT, "demos", "re2d_gta_sandbox")
OUT = os.path.join(ROOT, "build", "re2d_gta_sandbox")
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def city(seed=7):
    return Agent(cwd=ROOT, game=GAME, scene="re2d_gta_sandbox_city", seed=seed, fixed_dt=1.0 / 60.0)


def test_city():
    with city() as a:
        a.step(30)
        check(a.state().get("scene") == "re2d_gta_sandbox_city", "city scene entered")
        check(a.eval("JSON.stringify($.debug.errors())") == "[]", "city scene has no script errors")
        road = a.eval("JSON.stringify(SANDBOX.world.groundAt(7.5*96, 6.5*96, {h:0}))")
        sidewalk = a.eval("JSON.stringify(SANDBOX.world.groundAt(6.5*96, 5.5*96, {h:0}))")
        check('"road"' in road and '"driveable"' in road, "road span exposes surface tags via groundAt: " + road[:120])
        check('"sidewalk"' in sidewalk and '"walkable"' in sidewalk, "sidewalk tags via groundAt: " + sidewalk[:120])
        check(int(a.eval("SANDBOX.population.count()")) >= 1, "population spawned pedestrians")
        check(int(a.eval("SANDBOX.world.info().visibleAtlasSprites")) > 0, "atlas sprites visible")

        # Roof fade (P2): per-surface alpha from the engine, driven by the demo.
        roofs = int(a.eval("SANDBOX.roofs.length"))
        check(roofs > 0, "city exposes %d roof surfaces for fade" % roofs)
        a.eval("$('#player').at(SANDBOX.roofs[0].x, SANDBOX.roofs[0].y)")
        a.step(35)
        alpha = float(a.eval("Math.min(...SANDBOX.roofs.map(r=>SANDBOX.world.surface(r.index).fade()))"))
        check(0.0 <= alpha < 0.5, "roof fades under the player (min alpha %.2f)" % alpha)
        a.eval("$('#player').at(6*96+48, 5*96+48)")
        a.step(20)

        # Runtime surface tags survive a world save/load (re2d-save v2).
        saved = a.eval("""
        (()=>{const g=SANDBOX.world.groundAt(7.5*96,6.5*96,{h:0});
          globalThis.TAG_SURFACE=g.surface;
          SANDBOX.world.surface(g.surface).tag('runtime_marker',true);
          const snap=SANDBOX.world.saveState();
          SANDBOX.world.surface(g.surface).tag('runtime_marker',false);
          globalThis.TAG_SNAP=snap;
          return JSON.stringify({had:SANDBOX.world.surface(g.surface).hasTag('runtime_marker')});})()
        """)
        check('"had":false' in saved, "runtime tag removed before load")
        a.eval("SANDBOX.world.loadState(TAG_SNAP); true")
        check(a.eval("SANDBOX.world.surface(TAG_SURFACE).hasTag('runtime_marker')") is True,
              "runtime surface tag restored by loadStateJSON")

        # Enter the car (it is parked next to the player start), drive, exit.
        a.eval("$('#player').at($('#city-car').get(0).x + 40, $('#city-car').get(0).y)")
        a.key("E", "tap")
        a.step(3)
        car0 = a.eval("JSON.stringify($('#city-car').pos())")
        a.keys(["W"])
        a.step(50)
        a.keys([])
        car1 = a.eval("JSON.stringify($('#city-car').pos())")
        speed = float(a.eval("SANDBOX.car.state().speed || 0"))
        check(car0 != car1 and speed > 20, "car entered and driven: %s -> %s, speed %.1f" % (car0, car1, speed))
        a.key("E", "tap")
        a.step(3)

        # Hitscan a spawned pedestrian at a known spot: damage payload + death event.
        setup = """
        (()=>{const n=SANDBOX.spawnPed({x:800,y:500});
          n.get(0).max_hp=30;n.get(0).cur_hp=30;
          globalThis.TARGET=n.get(0);globalThis.DAMAGE_HITS=0;globalThis.DEATHS=0;
          $.on('damage',e=>{if(e.data&&e.data.subject===TARGET)DAMAGE_HITS++;});
          $.on('death',e=>{const d=e.data&&e.data.node?e.data.node:e.data;if(d===TARGET)DEATHS++;});
          return true})()
        """
        a.eval(setup)
        a.eval("$('#player').at(720, 500)")
        a.step(2)
        result = a.eval("JSON.stringify(SANDBOX.combat.hitscan({from:{x:720,y:500},to:{x:820,y:500},mask:2,wallMask:8,damage:20,type:'pistol',source:null}))")
        a.step(2)
        check('"hit":true' in result, "hitscan hit the pedestrian: " + result[:160])
        check(int(a.eval("DAMAGE_HITS")) >= 1, "damage event delivered (%s)" % a.eval("DAMAGE_HITS"))
        a.eval("SANDBOX.combat.hitscan({from:{x:720,y:500},to:{x:820,y:500},mask:2,wallMask:8,damage:40,type:'pistol',source:null})")
        a.step(2)
        check(int(a.eval("TARGET.cur_hp")) == 0, "second hit kills the target (hp %s)" % a.eval("TARGET.cur_hp"))

        # Mission pickup -> dropoff (teleport the player to the dropoff zone).
        state = a.eval("JSON.stringify(SANDBOX.missions.state('delivery'))")
        check('"status":"active"' in state and '"parcel":true' in state, "mission picked up: " + state[:180])
        a.eval("$('#player').at(9*96+50, 8*96+70)")
        a.step(4)
        state = a.eval("JSON.stringify(SANDBOX.missions.state('delivery'))")
        check('"status":"done"' in state, "mission completed at dropoff: " + state[:180])

    # Deterministic fixed-dt city frame.
    shots = []
    for i in range(2):
        with city() as a:
            a.step(40)
            path = os.path.join(OUT, "city_%d.png" % i)
            a.screenshot(path)
            shots.append(sha(path))
    check(shots[0] == shots[1], "city frame deterministic across two runs (sha %s…)" % shots[0][:12])


def test_plain():
    with Agent(cwd=ROOT, game=GAME, scene="re2d_gta_sandbox_plain", seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(20)
        check(a.state().get("scene") == "re2d_gta_sandbox_plain", "plain 2D scene entered")
        check(a.eval("JSON.stringify($.debug.errors())") == "[]", "plain scene has no script errors")
        p0 = a.eval("JSON.stringify($('#plain-hero').pos())")
        a.keys(["D"])
        a.step(30)
        a.keys([])
        p1 = a.eval("JSON.stringify($('#plain-hero').pos())")
        check(p0 != p1, "plain hero walks: %s -> %s" % (p0, p1))
        a.eval("$('#plain-hero').at($('#plain-car').get(0).x + 40, $('#plain-car').get(0).y)")
        a.key("E", "tap")
        a.step(3)
        a.keys(["W"])
        a.step(40)
        a.keys([])
        car = a.eval("JSON.stringify($('#plain-car').pos())")
        moved = a.eval("JSON.stringify((()=>{const c=$('#plain-car').get(0);return {x:c.x,y:c.y};})())")
        check(moved != '{"x":860,"y":500}', "plain car drives: " + moved)
        path = os.path.join(OUT, "plain.png")
        a.screenshot(path)
        check(os.path.getsize(path) > 1000, "plain scene renders a frame")


def main():
    os.makedirs(OUT, exist_ok=True)
    test_city()
    test_plain()
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
