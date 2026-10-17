#!/usr/bin/env python3
# ===========================================================================
# P4 debug overlay: automap skeleton + semantic points + boss hit-zone markers
# через world.debug.draw. Проверяем, что данные непустые и слой реально
# меняет кадр, а выключение возвращает чистую сцену.
#
# Запуск: python3 tests/agent/re2d_debug_overlay_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_debug_lab"
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
        a.step(10)
        on_shot = a.screenshot(os.path.join(SHOTS, "re2d_debug_overlay_on.png"))
        state = a.state().get("re2dDebugLab") or {}
        check(state.get("enabled") is True and state.get("lines", 0) > 0 and state.get("points", 0) >= 2,
              f"debug overlay отдаёт линии/точки: {state}")

        a.eval("re2dDebugLab.toggle(false)")
        a.step(3)
        off_shot = a.screenshot(os.path.join(SHOTS, "re2d_debug_overlay_off.png"))
        diff = changed(on_shot, off_shot)
        check(diff > 500, f"overlay реально меняет кадр ({diff} изменённых px)")
        check((a.state().get("re2dDebugLab") or {}).get("enabled") is False, "overlay выключается")

        a.eval("re2dDebugLab.toggle(true)")
        a.step(2)
        again = a.screenshot(os.path.join(SHOTS, "re2d_debug_overlay_on2.png"))
        check(changed(on_shot, again) < 5000, f"overlay детерминированно возвращается ({changed(on_shot, again)} px)")

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
