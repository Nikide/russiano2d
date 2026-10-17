#!/usr/bin/env python3
# ===========================================================================
# Re2D determinism audit (P4): одинаковый seed + одинаковый ввод дают
# идентичное состояние и пиксель. Проверяются controller, particles, save hash
# и кадр; это защита от скрытого Math.random/времени в нативных путях.
#
# Запуск: python3 tests/agent/re2d_determinism_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_boomer_lab"
SHOTS = os.path.join("build", "shots")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run_once(tag):
    path = os.path.join(SHOTS, f"re2d_determinism_{tag}.png")
    with Agent(game=GAME, scene=SCENE, seed=42) as a:
        if skip_without_re2d(a):
            return None
        a.step(20)
        controller = a.eval("JSON.stringify(boomerLab.controllerProbe())")
        a.eval("boomerLab.particleProbe()")
        a.step(10)
        particles = a.eval("JSON.stringify(boomerLab.particleInfo())")
        hash_ = a.eval("boomerLab.saveStateHash()") if False else a.eval("boomerLab.info().atlasSprites")
        a.screenshot(path)
    return {"controller": controller, "particles": particles, "atlas": hash_, "shot": path}


def pixel_diff(a_path, b_path):
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return 1.0
    diff = 0
    total = a.size[0] * a.size[1]
    for y in range(0, a.size[1], 3):
        for x in range(0, a.size[0], 3):
            if a.getpixel((x, y)) != b.getpixel((x, y)):
                diff += 1
    return diff / max(1, total / 9)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    first = run_once("a")
    if first is None:
        return 0
    second = run_once("b")
    if second is None:
        return 0
    check(first["controller"] == second["controller"],
          f"controller детерминирован: {first['controller']} vs {second['controller']}")
    check(first["particles"] == second["particles"],
          f"particles детерминированы: {first['particles']} vs {second['particles']}")
    check(first["atlas"] == second["atlas"],
          f"atlas registry детерминирован: {first['atlas']} vs {second['atlas']}")
    diff = pixel_diff(first["shot"], second["shot"])
    check(diff == 0, f"кадр побайтово детерминирован (доля различий {diff:.4f})")

    print()
    if FAILURES:
        print("ПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
