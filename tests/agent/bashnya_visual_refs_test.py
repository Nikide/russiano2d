#!/usr/bin/env python3
"""BASHNYA visual evidence: start bridge, shot and VFX frames.

Uses the BASHNYA bundled runtime and game unchanged:

  BASHNYA_DIR=/Volumes/SSD NVME/BASHNYA
  runtime/russiano2d --game game --scene level1

Frames are deterministic for a fixed step; `--update` refreshes references only
intentionally. BASHNYA sources are never modified.

  python3 tests/agent/bashnya_visual_refs_test.py
  python3 tests/agent/bashnya_visual_refs_test.py --update
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_native_test import decode  # noqa: E402

BASHNYA = os.environ.get("BASHNYA_DIR", "/Volumes/SSD NVME/BASHNYA")
REFERENCE = os.path.join(ROOT, "tests", "agent", "reference", "bashnya")
TOLERANCE = 10
MAX_CHANGED = 0.01
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def compare(name, shot, update):
    path = os.path.join(REFERENCE, name + ".png")
    if update:
        os.makedirs(REFERENCE, exist_ok=True)
        os.replace(shot, path)
        print("  update reference %s" % os.path.relpath(path, ROOT))
        return
    if not os.path.exists(path):
        check(False, "%s: reference missing (run with --update)" % name)
        return
    a, b = decode(path), decode(shot)
    if (a[0], a[1]) != (b[0], b[1]):
        check(False, "%s: size mismatch" % name)
        return
    changed = total = 0
    for y in range(a[1]):
        ra, rb = a[3][y], b[3][y]
        for x in range(0, a[0] * 4, 4):
            total += 1
            if max(abs(ra[x + c] - rb[x + c]) for c in range(3)) > TOLERANCE:
                changed += 1
    frac = changed / max(1, total)
    check(frac <= MAX_CHANGED, "%s: changed %.4f%% <= %.2f%%" % (name, 100 * frac, 100 * MAX_CHANGED))


def main():
    update = "--update" in sys.argv[1:]
    if not os.path.isdir(BASHNYA):
        check(False, "BASHNYA directory missing: %s" % BASHNYA)
        return 1
    binary = os.path.join(BASHNYA, "runtime", "russiano2d")
    check(os.path.isfile(binary), "BASHNYA bundled runtime exists")
    if not os.path.isfile(binary):
        return 1
    shots = os.path.join(ROOT, "build", "bashnya_refs")
    os.makedirs(shots, exist_ok=True)
    manifest = {"game": BASHNYA, "scene": "level1", "seed": 7,
                "fixedDt": 1.0 / 60.0, "camera": "level1 start bridge (unchanged BASHNYA runtime)",
                "frames": {}}
    with Agent(binary=binary, cwd=BASHNYA, game="game", scene="level1",
               seed=7, headless=True, fixed_dt=1.0 / 60.0, start_timeout=180) as a:
        a.step(20)
        check(not a.eval("$.debug.errors()"), "BASHNYA start has no script errors")
        state = a.state().get("bashnya") or {}
        check(state.get("scene") == "level1", "BASHNYA scene is level1")
        start = os.path.join(shots, "start_bridge.png")
        a.screenshot(start)
        manifest["frames"]["start_bridge"] = {"step": 20, "camera": "start bridge"}
        compare("start_bridge", start, update)

        a.eval("bashnya.shoot()")
        a.step(1)
        shot_state = (a.state().get("bashnya") or {})
        check(shot_state.get("shots", 0) >= 1, "BASHNYA shot was fired")
        check(bool(shot_state.get("muzzleVisible")), "BASHNYA muzzle flash visible in shot frame")
        shot = os.path.join(shots, "shot.png")
        a.screenshot(shot)
        manifest["frames"]["shot"] = {"step": 21, "camera": "hip fire", "weapon": "KS-23"}
        compare("shot", shot, update)

        a.step(8)
        vfx = os.path.join(shots, "vfx.png")
        a.screenshot(vfx)
        manifest["frames"]["vfx"] = {"step": 29, "camera": "fire/pump VFX"}
        compare("vfx", vfx, update)
        check(not a.eval("$.debug.errors()"), "BASHNYA capture has no script errors")

    import json
    manifest_path = os.path.join(REFERENCE, "manifest.json")
    if update:
        os.makedirs(REFERENCE, exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=1, ensure_ascii=True)
            handle.write("\n")
        print("  update reference %s" % os.path.relpath(manifest_path, ROOT))

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
