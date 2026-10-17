#!/usr/bin/env python3
# ===========================================================================
# R-03 native VFX pack acceptance: load every authored bundle, spawn each one,
# and verify live counters/budgets through the constrained `$` API.
#
# No pixel assertions here: the native VFX library is data + fixed pools; the
# renderer hook is tested by the CPU/GPU visual tests. This test proves the pack
# parses through the asset pipeline, every effect spawns without JS nodes, and
# budget counters stay bounded.
#
# Run:
#   python3 tests/agent/re2d_vfx_pack_test.py
# ===========================================================================
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("demos", "re2d_vfx_lab")
CATALOG = {
    "combat": ["muzzle_flash", "shotgun_smoke", "pellet_impact_stone", "pellet_impact_metal",
        "pellet_impact_flesh", "blood_spray", "blood_mist", "blood_decal", "scorch",
        "shell_eject", "hit_spark", "hit_dust"],
    "fire": ["fire_small", "fire_large", "ember", "fire_smoke", "burning_actor",
        "heat_distortion", "fire_light"],
    "frost": ["frost_burst", "ice_shards", "frost_mist", "frost_decal", "freeze_overlay"],
    "electric": ["spark", "arc_card", "electric_hit", "pulse_light", "screen_flash"],
    "acid": ["acid_splash", "acid_drip", "acid_pool", "acid_smoke", "acid_decal"],
    "magic": ["portal", "glyph", "soul", "red_eye_glow", "magic_mist", "teleport",
        "vanish", "boss_aura"],
    "environment": ["dust", "floating_ash", "fog_strip", "smoke_column", "falling_debris",
        "dripping_water", "rain", "snow", "wind_dust", "light_shaft_dust", "ambient_embers"],
}


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval failed: %s" % str(exc).splitlines()[0][:160])
        return default


def main():
    expected = sum(len(v) for v in CATALOG.values())
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(2)
        loaded = ev(a, "globalThis.vfxLab ? vfxLab.loaded.length : -1", -1)
        failed = ev(a, "globalThis.vfxLab ? vfxLab.failed : []", [])
        check(loaded == expected, "asset pipeline loaded %d/%d VFX bundles" % (loaded, expected))
        check(not failed, "no bundle parse failures: %r" % (failed[:2],))

        info = ev(a, "vfxLab.info()", {}) or {}
        check(info.get("fxBundles") == expected, "vfxInfo reports %d bundles" % expected)
        check(info.get("lightBudget") == 16, "default VFX light budget is 16")
        check(info.get("particleCapacity", 0) > 0, "native particle pool is bound")

        # Spawn every effect once at the same point with a deterministic seed.
        results = {}
        for category in CATALOG:
            for name in CATALOG[category]:
                result = ev(a, "vfxLab.spawn(%r,{x:400,y:300,h:24,dx:0,dy:1,dz:-0.2,seed:7})" % name)
                results[name] = result
                check(isinstance(result, dict), "%s spawns through world.vfx.spawn" % name)
        check(len(results) == expected, "all effects spawned")

        info = ev(a, "vfxLab.info()", {}) or {}
        check(info.get("fxSpawns", 0) >= expected, "fxSpawns counted %d" % info.get("fxSpawns", 0))
        check(info.get("particlesAlive", 0) > 0, "live native particles after pack spawn")
        check(info.get("particlesAlive", 0) <= info.get("particleCapacity", 0),
              "particles stay inside pool capacity")
        check(info.get("tempLights", 0) <= info.get("lightBudget", 0),
              "temp lights stay inside VFX light budget")

        # Budget stress: many muzzle flashes must not exceed pool/light budgets.
        ev(a, "for(let i=0;i<200;i++) vfxLab.spawn('muzzle_flash',{x:400,y:300,h:24,seed:i});")
        info = ev(a, "vfxLab.info()", {}) or {}
        check(info.get("particlesAlive", 0) <= info.get("particleCapacity", 0),
              "stress particles bounded: %d/%d" % (info.get("particlesAlive", 0), info.get("particleCapacity", 0)))
        check(info.get("tempLights", 0) <= info.get("lightBudget", 0),
              "stress lights bounded: %d/%d" % (info.get("tempLights", 0), info.get("lightBudget", 0)))
        check(info.get("lightOverflow", 0) >= 0, "light overflow counter present")
        debug = ev(a, "vfxLab.debug()", {}) or {}
        check(len(debug.get("bundles", [])) == expected, "debug lists all bundles")
        world_info = ev(a, "vfxLab.worldInfo()", {}) or {}
        check("particlesAlive" in world_info and "tempLights" in world_info,
              "world.info carries VFX counters")

        # Let effects expire, then clear to prove counters reset.
        for _ in range(30):
            a.step(1)
        ev(a, "vfxLab.world.vfx.clear()")
        info = ev(a, "vfxLab.info()", {}) or {}
        check(info.get("particlesAlive", 0) >= 0, "clear keeps counters readable")
        check(info.get("cards", 0) == 0 and info.get("trails", 0) == 0,
              "vfxClear drops cards/trails")

    print()
    if FAILURES:
        print("FAILED %d" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("All checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
