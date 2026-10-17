#!/usr/bin/env python3
"""Static batching data path: counters and GPU contract on the renderer lab.

The CPU data path must build deterministic groups/instances each frame, expose
them through world.batchInfo() and world.info().visual, and advertise the packed
SSBO contract. No GPU submission is required or asserted here.
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
    with Agent(game=GAME, seed=11) as a:
        if skip_without_re2d(a):
            return 0
        a.step(3)
        b = batch(a)
        visual = info(a).get("visual") or {}
        check(b.get("instances", 0) > 0, "batch instances > 0: %s" % b.get("instances"))
        check(b.get("groups", 0) > 0, "batch groups > 0: %s" % b.get("groups"))
        check(b.get("savedBinds", -1) == b.get("instances", 0) - b.get("groups", 0),
              "saved binds = instances - groups")
        check(b.get("instanceBytes") == 32, "instance packed as 32 bytes")
        check(b.get("groupBytes") == 24, "group packed as 24 bytes")
        check("std430" in str(b.get("layout", "")), "layout contract present")
        check("SSBO" in str(b.get("contract", "")), "GPU contract present")
        check(b.get("overflow", 1) == 0, "batch buffers sized without overflow")
        check(visual.get("staticBatchInstances") == b.get("instances"),
              "world.info visual matches batchInfo instances")
        check(visual.get("staticBatchGroups") == b.get("groups"),
              "world.info visual matches batchInfo groups")
        check(visual.get("staticBatchSavedBinds") == b.get("savedBinds"),
              "world.info visual matches saved binds")

        # The plan is rebuilt from the same camera: counters stay stable.
        a.step(1)
        again = batch(a)
        check(again.get("instances") == b.get("instances"),
              "instance count stable across frames with the same camera")
        check(again.get("groups") == b.get("groups"),
              "group count stable across frames with the same camera")

        golden = {"groups": again.get("groups"), "instances": again.get("instances"),
                  "savedBinds": again.get("savedBinds")}
        a.eval('world.backend("gpu")')
        a.step(2)
        gpu = batch(a)
        check(gpu.get("instances") == golden["instances"] and gpu.get("groups") == golden["groups"],
              "batch plan independent of renderer backend (no GPU submission change)")

    if FAILED:
        print("ПРОВАЛЕНО %d" % len(FAILED))
        for item in FAILED:
            print("  - " + item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
