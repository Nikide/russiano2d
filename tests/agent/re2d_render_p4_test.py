#!/usr/bin/env python3
"""P4/P5 renderer: sky profiles, distant cards, weather layers and shafts.

High/ultra tiers must actually draw the new procedural cards (counters > 0) and
change real pixels compared to the medium tier. Screenshots are kept in
build/test_visual_p4_*.png for manual inspection; the comparison is tolerance
based (fraction of changed pixels), not a brittle exact image hash.
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


def pixels(a, name):
    path = os.path.join(ROOT, "build", "test_visual_p4_" + name + ".png")
    a.screenshot(path)
    return b"".join(decode(path)[3])


def info(a):
    return json.loads(a.eval("JSON.stringify(world.info())") or "{}")


def changed(a, b):
    return sum(1 for x, y in zip(a, b) if abs(x - y) > 3) / max(1, len(a))


def main():
    with Agent(game=GAME, seed=7) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        a.eval('world.backend("gpu");world.qualityPreset("medium");'
               'world.sky({texture:"demos/re2d_world_renderer_lab/floor.png",color:"#88bbee"})')
        a.step(3)
        medium = pixels(a, "medium")
        medium_visual = (info(a).get("visual") or {})
        check(medium_visual.get("quality") == 1, "medium tier selected")
        check(medium_visual.get("weatherCards", 0) == 0, "medium keeps weather off")

        a.eval('world.qualityPreset("high")')
        a.step(3)
        high = pixels(a, "high")
        high_visual = (info(a).get("visual") or {})
        check(high_visual.get("quality") == 2, "high tier selected")
        check(high_visual.get("weatherCards", 0) > 0,
              "high draws weather cards: %s" % high_visual.get("weatherCards"))
        check(high_visual.get("distantCards", 0) > 0,
              "high draws distant sky cards: %s" % high_visual.get("distantCards"))
        check(high_visual.get("shafts", 0) > 0,
              "high draws light shaft cards: %s" % high_visual.get("shafts"))
        check(changed(medium, high) > 0.004,
              "high weather/distant cards change pixels: %.2f%%" % (100.0 * changed(medium, high)))

        a.eval('world.qualityPreset("low")')
        a.step(3)
        low = pixels(a, "low")
        low_visual = (info(a).get("visual") or {})
        check(low_visual.get("quality") == 0, "low tier selected")
        check(low_visual.get("weatherCards", 0) == 0, "low keeps weather off")
        check(changed(low, high) > 0.004,
              "high P4 cards change pixels vs low: %.2f%%" % (100.0 * changed(low, high)))
        check(not a.eval("$.debug.errors()"), "no script errors across tiers")

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
