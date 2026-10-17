#!/usr/bin/env python3
# ===========================================================================
# P2 sky portal: authored portal becomes a window to the panorama sky.
# Visibility stops at the far cell; the opening shows the sky background.
# Проверяем, что это реальный кадр, а не только флаг в API.
#
# Запуск: python3 tests/agent/re2d_sky_portal_test.py
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


def magenta(path):
    image = Image.open(path).convert("RGB")
    total = 0
    for y in range(0, image.size[1], 2):
        for x in range(0, image.size[0], 2):
            r, g, b = image.getpixel((x, y))
            if r > 150 and b > 100 and g < 100:
                total += 1
    return total


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with Agent(game=GAME, scene=SCENE, seed=5) as a:
        if skip_without_re2d(a):
            return 0
        a.step(8)
        off_shot = a.screenshot(os.path.join(SHOTS, "re2d_sky_portal_off.png"))
        off = magenta(off_shot)
        assert_state = a.state().get("re2dSkyLab") or {}
        check(assert_state.get("sky") is False and assert_state.get("cells") == 2
              and assert_state.get("portals") == 1,
              f"sky portal выключен, мир из 2 cells/1 portal: {assert_state}")

        result = a.eval("JSON.stringify(re2dSky.set(true))")
        check(result is not None and '"sky":true' in result, f"re2dSky.set(true): {result}")
        a.step(4)
        on_shot = a.screenshot(os.path.join(SHOTS, "re2d_sky_portal_on.png"))
        on = magenta(on_shot)
        check(on > 2000, f"проём показывает панорамное небо ({on} magenta px)")
        check(on > off * 10, f"sky-on радикально отличается от обычного вида (on={on}, off={off})")

        state_on = a.state().get("re2dSkyLab") or {}
        check(state_on.get("sky") is True, f"native флаг портала выставлен: {state_on}")

        a.eval("re2dSky.set(false)")
        a.step(3)
        back = magenta(a.screenshot(os.path.join(SHOTS, "re2d_sky_portal_back.png")))
        check(back < on // 10, f"выключение возвращает обычный вид (back={back}, on={on})")

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
