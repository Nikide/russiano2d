#!/usr/bin/env python3
# ===========================================================================
# P2 mirror portal: scissored reflected-world pass. Main visibility не уходит
# в дальнюю cell, а portal-окно заполняется отражённой сценой.
#
# Запуск: python3 tests/agent/re2d_mirror_portal_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_sky_lab"
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
        a.step(8)
        off_shot = a.screenshot(os.path.join(SHOTS, "re2d_mirror_off.png"))
        state = a.state().get("re2dSkyLab") or {}
        check(state.get("mirror") is False and state.get("cells") == 2,
              f"mirror выключен, мир 2 cells/1 portal: {state}")

        result = a.eval("JSON.stringify(re2dSky.mirror(true))")
        check(result is not None and '"mirror":true' in result, f"re2dSky.mirror(true): {result}")
        a.step(4)
        on_shot = a.screenshot(os.path.join(SHOTS, "re2d_mirror_on.png"))
        state_on = a.state().get("re2dSkyLab") or {}
        check(state_on.get("mirror") is True, f"native mirror flag: {state_on}")
        diff = changed(off_shot, on_shot)
        check(diff > 2000, f"mirror pass меняет кадр ({diff} изменённых px)")

        a.eval("re2dSky.mirror(false)")
        a.step(3)
        back = changed(off_shot, a.screenshot(os.path.join(SHOTS, "re2d_mirror_back.png")))
        check(back < 2000, f"выключение возвращает обычный вид ({back} px)")
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
