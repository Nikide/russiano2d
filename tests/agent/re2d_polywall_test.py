#!/usr/bin/env python3
# ===========================================================================
# P3 rotating polywall: authored wall вращается вокруг XY-пивота; тот же
# сегмент видят trace и рендер (координаты мутируются в world.walls).
#
# Запуск: python3 tests/agent/re2d_polywall_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_polywall_lab"
SHOTS = os.path.join("build", "shots")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def changed(a_path, b_path):
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return 10 ** 9
    total = 0
    for y in range(0, a.size[1], 2):
        for x in range(0, a.size[0], 2):
            if a.getpixel((x, y)) != b.getpixel((x, y)):
                total += 1
    return total


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with Agent(game=GAME, scene=SCENE, seed=5) as a:
        if skip_without_re2d(a):
            return 0
        a.step(3)
        a.eval("re2dPolywall.pause()")
        a.step(1)
        start = a.state().get("re2dPolywallLab") or {}
        a.screenshot(os.path.join(SHOTS, "re2d_polywall_a.png"))
        check(start.get("speed") == 0 and start.get("hit"), f"polywall создан и trace видит стену: {start}")

        a.eval("re2dPolywall.resume(1.5)")
        a.step(40)
        a.eval("re2dPolywall.pause()")
        a.step(1)
        end = a.state().get("re2dPolywallLab") or {}
        a.screenshot(os.path.join(SHOTS, "re2d_polywall_b.png"))
        check(end.get("angle", 0) > start.get("angle", 0) + 0.3,
              f"стена реально повернулась: {start.get('angle')} -> {end.get('angle')}")
        changed_hit = (end.get("hit") is None
                       or abs(end["hit"]["fraction"] - start["hit"]["fraction"]) > 0.01)
        check(changed_hit, f"trace видит повёрнутый сегмент (или промах): {start.get('hit')} -> {end.get('hit')}")
        diff = changed(os.path.join(SHOTS, "re2d_polywall_a.png"), os.path.join(SHOTS, "re2d_polywall_b.png"))
        check(diff > 200, f"поворот виден в кадре ({diff} изменённых px)")

        check("[]" == a.eval("JSON.stringify($.debug.errors())"),
              f"ошибок игрового кода нет: {a.eval('JSON.stringify($.debug.errors())')}")

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
