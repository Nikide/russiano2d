#!/usr/bin/env python3
"""BASHNYA 1.2.6 request: pose budget, visual tier and atmosphere are independent.

Before this change `world.quality({poseBudget:4,...})` switched the whole
renderer to HIGH (fog/sky layers) as a side effect of the pose budget. The
renderer lab checks the new contract:

  * default world keeps the legacy low visual tier + 1 pose/frame policy;
  * world.quality({poseBudget}) changes only the pose policy, never the tier;
  * world.renderQuality(name) explicitly selects low|medium|high|ultra;
  * world.atmosphere({...}) changes only the provided fields, returns applied
    values and cannot change the visual tier;
  * qualityPreset still changes the visual tier (full preset path);
  * bad input fails with typed RangeError/TypeError, not a silent fallback.
"""
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


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def info(a):
    return json.loads(a.eval("JSON.stringify(world.info())") or "{}")


def visual_quality(a):
    return (info(a).get("visual") or {}).get("quality")


def pixels(a, name):
    path = os.path.join(ROOT, "build", "test_quality_" + name + ".png")
    a.screenshot(path)
    return b"".join(decode(path)[3])


def caught(a, expression):
    """Run expression, return 'Name: message' for a throw, 'no-error' otherwise."""
    return a.eval("(()=>{try{%s;return 'no-error';}catch(e){return e.name+': '+e.message;}})()" % expression)


def main():
    with Agent(game=GAME, seed=7) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)

        # --- 1. Legacy defaults are unchanged: LOW tier, pose 1/3 -----------
        base = info(a)
        check((base.get("visual") or {}).get("quality") == 0,
              "default visual tier is LOW (legacy parity)")
        check(base.get("poseBudget") == 1 and abs(base.get("poseStep") - 3) < 1e-6,
              "default pose policy is 1 pose/frame, 3 deg")

        # Legacy default frame parity: the creation default must equal an
        # explicit LOW selection (same native preset call). The lab animates, so
        # the check compares against one-frame temporal noise and uses HIGH as
        # a negative control: LOW must stay within noise, HIGH must change
        # clearly more pixels.
        default_pixels = pixels(a, "default")
        a.step(1)
        next_pixels = pixels(a, "default_next")
        a.eval("world.renderQuality('low')")
        a.step(1)
        low_pixels = pixels(a, "explicit_low")
        a.eval("world.renderQuality('high')")
        a.step(1)
        high_pixels = pixels(a, "tier_high")

        def mean_diff(x, y):
            n = min(len(x), len(y))
            return sum(abs(x[i] - y[i]) for i in range(n)) / max(1, n)

        noise = mean_diff(default_pixels, next_pixels)
        low_diff = mean_diff(default_pixels, low_pixels)
        high_diff = mean_diff(low_pixels, high_pixels)
        check(low_diff <= max(noise * 8.0, 0.002),
              "explicit LOW reproduces the default frame within temporal noise "
              "(low %.5f vs noise %.5f)" % (low_diff, noise))
        check(high_diff > max(0.004, low_diff * 4.0),
              "HIGH is a real visual change, so the parity check is sensitive "
              "(high %.5f vs low %.5f)" % (high_diff, low_diff))
        a.eval("world.renderQuality('low')")
        a.step(1)

        # --- 2. Pose budget alone must not move the visual tier -------------
        a.eval("world.quality({poseBudget:4,poseStep:3})")
        a.step(1)
        posed = info(a)
        check(posed.get("poseBudget") == 4, "world.quality sets poseBudget")
        check(posed.get("poseStep") == 3, "world.quality sets poseStep")
        check((posed.get("visual") or {}).get("quality") == 0,
              "poseBudget=4 alone keeps LOW visual tier (was HIGH regression)")
        a.eval("world.quality({poseBudget:2,poseStep:5})")
        a.step(1)
        check(visual_quality(a) == 0, "poseBudget=2 alone keeps LOW visual tier")

        # --- 3. Explicit tier control ---------------------------------------
        for name, tier in (("medium", 1), ("high", 2), ("ultra", 3), ("low", 0)):
            applied = a.eval("world.renderQuality('%s')" % name)
            a.step(1)
            check(applied == name, "renderQuality('%s') returns applied name: %r" % (name, applied))
            check(visual_quality(a) == tier,
                  "renderQuality('%s') selects tier %d: %s" % (name, tier, visual_quality(a)))
        check(a.eval("world.renderQuality()") == "low",
              "renderQuality() getter returns current tier")

        # --- 4. Atmosphere is additive and independent ----------------------
        applied = a.eval("JSON.stringify(world.atmosphere({heightDensity:0.02,baseHeight:100,"
                         "falloff:2,hazeStrength:0.1,skyLayers:false,sunDisc:false,"
                         "hazeColor:'#102030'}))")
        atm = json.loads(applied or "{}")
        check(abs(atm.get("heightDensity", -1) - 0.02) < 1e-6, "atmosphere heightDensity applied")
        check(abs(atm.get("baseHeight", -1) - 100) < 1e-6, "atmosphere baseHeight applied")
        check(abs(atm.get("falloff", -1) - 2) < 1e-6, "atmosphere falloff applied")
        check(abs(atm.get("hazeStrength", -1) - 0.1) < 1e-6, "atmosphere hazeStrength applied")
        check(atm.get("hazeColor") == "#102030", "atmosphere hazeColor applied: %r" % atm.get("hazeColor"))
        check(atm.get("skyLayers") is False and atm.get("sunDisc") is False,
              "atmosphere skyLayers/sunDisc applied")
        check(visual_quality(a) == 0, "atmosphere does not change the visual tier")

        # Only provided fields change: hazeStrength alone keeps the rest.
        partial = json.loads(a.eval("JSON.stringify(world.atmosphere({hazeStrength:0.2}))") or "{}")
        check(abs(partial.get("hazeStrength", -1) - 0.2) < 1e-6, "partial atmosphere hazeStrength applied")
        check(abs(partial.get("heightDensity", -1) - 0.02) < 1e-6 and
              abs(partial.get("baseHeight", -1) - 100) < 1e-6 and
              abs(partial.get("falloff", -1) - 2) < 1e-6,
              "partial atmosphere keeps heightDensity/baseHeight/falloff")
        check(partial.get("hazeColor") == "#102030" and partial.get("skyLayers") is False,
              "partial atmosphere keeps hazeColor/skyLayers")
        check(visual_quality(a) == 0, "partial atmosphere keeps the LOW visual tier")

        current = json.loads(a.eval("JSON.stringify(world.atmosphere())") or "{}")
        check(current == partial, "atmosphere() getter returns applied values")

        a.eval("world.renderQuality('high')")
        a.step(1)
        check(visual_quality(a) == 2, "atmosphere state does not pin the tier")
        a.eval("world.renderQuality('low')")

        # hazeColor:null restores the automatic sky-derived tint. Tiers reset
        # atmosphere overrides, so set the fields again after renderQuality.
        a.eval("world.atmosphere({heightDensity:0.02,hazeStrength:0.1,hazeColor:'#102030'})")
        auto = json.loads(a.eval("JSON.stringify(world.atmosphere({hazeColor:null}))") or "{}")
        check(auto.get("hazeColor") is None, "atmosphere hazeColor:null resets to auto")
        check(abs(auto.get("heightDensity", -1) - 0.02) < 1e-6,
              "hazeColor:null keeps other atmosphere fields")

        # --- 5. qualityPreset still changes the visual tier -----------------
        a.eval("world.qualityPreset('high')")
        a.step(1)
        high = info(a)
        check((high.get("visual") or {}).get("quality") == 2, "qualityPreset('high') selects HIGH tier")
        check(high.get("poseBudget") == 4, "qualityPreset('high') sets pose budget")
        a.eval("world.qualityPreset('low')")
        a.step(1)
        low = info(a)
        check((low.get("visual") or {}).get("quality") == 0, "qualityPreset('low') selects LOW tier")
        check(low.get("poseBudget") == 1, "qualityPreset('low') sets pose budget")

        # --- 6. Typed validation errors, stable text pattern ----------------
        errors = [
            ("world.renderQuality('bogus')",
             "RangeError: Re2D World: renderQuality must be low|medium|high|ultra"),
            ("world.atmosphere({heightDensity:2})",
             "RangeError: Re2D World: atmosphere heightDensity must be 0..1"),
            ("world.atmosphere({baseHeight:NaN})",
             "TypeError: Re2D World: atmosphere baseHeight must be a number"),
            ("world.atmosphere({skyLayers:1})",
             "TypeError: Re2D World: atmosphere skyLayers must be boolean"),
            ("world.atmosphere({unknownField:1})",
             'TypeError: Re2D World: atmosphere unknown option "unknownField"'),
            ("world.atmosphere({hazeColor:{}})",
             "TypeError: Re2D World: atmosphere hazeColor must be a colour or null"),
            ("world.atmosphere(null)",
             "TypeError: Re2D World: atmosphere expects an options object"),
        ]
        for expression, expected in errors:
            got = caught(a, expression)
            check(got == expected, "%s -> %r (got %r)" % (expression, expected, got))

        # Failed calls must not have changed anything.
        check(visual_quality(a) == 0, "validation failures left the visual tier at LOW")
        before_errors = json.loads(a.eval("JSON.stringify(world.atmosphere())") or "{}")
        for expression, _ in errors:
            caught(a, expression)
        after = json.loads(a.eval("JSON.stringify(world.atmosphere())") or "{}")
        check(after == before_errors, "validation failures left atmosphere unchanged")

        check(not a.eval("$.debug.errors()"), "no script errors during the quality API exercise")

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
