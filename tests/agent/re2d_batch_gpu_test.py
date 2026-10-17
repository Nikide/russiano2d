#!/usr/bin/env python3
"""Static batching GPU submission: one draw per group, instanced SSBO, fallback.

Checks that the GPU path actually reduces draw calls versus the per-surface
fallback on the renderer lab, keeps logical surface attribution, and that
`world.batchGpu(false)` restores the fallback without changing the world data.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

GAME = "demos/re2d_world_renderer_lab"
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def batch(a):
    return json.loads(a.eval("JSON.stringify(world.batchInfo())") or "{}")


def info(a):
    return json.loads(a.eval("JSON.stringify(world.info())") or "{}")


def main():
    with Agent(game=GAME, seed=13) as a:
        if skip_without_re2d(a):
            return 0
        a.eval('world.backend("gpu");world.qualityPreset("medium");world.batchGpu(true)')
        a.step(3)
        on = batch(a)
        visual = info(a).get("visual") or {}
        check(on.get("gpuEnabled") == 1, "GPU batching enabled")
        check(on.get("gpuBatched") == 1, "GPU batched submission active")
        draws = on.get("gpuDraws", 0)
        logical = on.get("gpuLogicalDraws", 0)
        check(draws > 0, "group draws submitted: %s" % draws)
        check(logical > draws, "draw reduction: %s logical -> %s group draws" % (logical, draws))
        check(on.get("gpuSavedDraws", 0) == logical - draws, "saved draws counter matches")
        check(on.get("gpuInstances", 0) == logical, "every logical draw is an instance")
        check(visual.get("gpuBatchDraws") == draws, "world.info mirrors group draws")
        check(visual.get("gpuBatchInstances") == on.get("gpuInstances"), "world.info mirrors instances")
        # Logical attribution (base/span) is preserved even though GPU draws are batched.
        draws_info = info(a)
        check(draws_info.get("gpuDrawsBase", 0) + draws_info.get("gpuDrawsSpan", 0) == logical,
              "base/span attribution preserved: %s + %s == %s" %
              (draws_info.get("gpuDrawsBase"), draws_info.get("gpuDrawsSpan"), logical))

        # Fallback must switch off batching without losing the plan/counters.
        a.eval('world.batchGpu(false)')
        a.step(2)
        off = batch(a)
        check(off.get("gpuEnabled") == 0, "GPU batching disabled via API")
        check(off.get("gpuBatched") == 0, "fallback path reports no group draws")
        check(info(a).get("gpuDrawsBase", 0) + info(a).get("gpuDrawsSpan", 0) > 0,
              "fallback draws surfaces per-surface")
        a.eval('world.batchGpu(true)')
        a.step(2)
        back = batch(a)
        check(back.get("gpuBatched") == 1 and back.get("gpuDraws", 0) > 0,
              "batching can be re-enabled at runtime")

    if FAILED:
        print("ПРОВАЛЕНО %d" % len(FAILED))
        for item in FAILED:
            print("  - " + item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
