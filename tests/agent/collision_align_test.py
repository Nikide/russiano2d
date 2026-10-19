#!/usr/bin/env python3
# ===========================================================================
# Collision vs sprite alignment (controller center ↔ rendered atlas sprite).
#
# The GTA-city report "collision sits upward from the visible body" came from
# F6 markers, not from the controller. This test pins the actual contract:
#
#   * the flat-atlas billboard is SCREEN-BOTTOM-anchored: it is blitted from
#     the projected (x,y,bottom) point with `top = p[1] - sh`, so a pivot-centre
#     sprite of size W renders its visible centre at node.x + W/2;
#   * the game's `node.x = controller.x - W/2` therefore puts the rendered
#     sprite centre exactly on the controller's projected ground point;
#   * omitting that half-width compensation moves the sprite by W/2 = 56 world
#     units (≈ 43 px at the fixture camera) — this test asserts that too, so a
#     "stale offset" cleanup cannot silently break the visual.
#
# Fixture: tests/fixtures/collision_align (compiled one-room map, no HUD, no
# second render path). Run:
#   python3 tests/agent/collision_align_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent            # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

GAME = "tests/fixtures/collision_align"
SHOTS = os.path.join(ROOT, "build", "shots")
FAILED = []
#: Alignment tolerance in window pixels. Sub-pixel differences come only from
#: pixel centroid quantisation and the 3-unit feet offset of the game's depth.
TOLERANCE_PX = 3.0
#: Authored half of the 112-unit hero sprite: the compensation under test.
HALF_WIDTH = 56.0


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def shot(a, name):
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, name)
    a.screenshot(path)
    return path


def magenta_centroid(path):
    """Mean position of the opaque probe pixels (the only magenta in frame)."""
    img = Image.open(path).convert("RGB")
    pixels = img.load()
    width, height = img.size
    sx = sy = count = 0
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if r > 100 and b > 100 and g < 60 and abs(r - b) < 40:
                sx += x
                sy += y
                count += 1
    if not count:
        return None, 0
    return (sx / count, sy / count), count


def controller_screen(a):
    """Exact engine projection of the controller's ground point, window px."""
    return json.loads(a.eval("""
        (function () {
            const v = ALIGN.view;
            engine.re2d.view(v.x, v.y, v.h, v.yaw * Math.PI / 180,
                             v.pitch * Math.PI / 180, v.fov * Math.PI / 180, v.near, 0);
            const st = ALIGN.state;
            const inF = new Float32Array([st.x, st.y, st.feet]);
            const outF = new Float32Array(4);
            engine.re2d.project(inF, outF);
            return JSON.stringify([outF[0], outF[1], outF[3]]);
        })()
    """))


def state(a):
    return json.loads(a.eval("JSON.stringify(ALIGN.state)"))


def settle(a, frames=3):
    a.step(frames)


def drive(a, dx, dy, frames):
    a.eval(f"ALIGN.reset(); ALIGN.wish.x={dx}; ALIGN.wish.y={dy}")
    settle(a)
    a.step(frames)


def main():
    with Agent(game=GAME, seed=7) as a:
        if skip_without_re2d(a):
            return 0
        a.step(20)
        check(a.eval("typeof ALIGN === 'object'"), "fixture exposes ALIGN")
        check(a.eval("ALIGN.state !== null"), "native controller placed")

        # 1) Four cardinal directions while moving on open floor.
        #    (+X = screen up, +Y = screen right in this yaw-0 top-down camera.)
        for key, dx, dy in (("W", 1, 0), ("S", -1, 0), ("D", 0, 1), ("A", 0, -1)):
            drive(a, dx, dy, 40)
            st = state(a)
            ctrl = controller_screen(a)
            path = shot(a, f"collision_align_{key}.png")
            centroid, count = magenta_centroid(path)
            speed = (st["vx"] ** 2 + st["vy"] ** 2) ** 0.5
            check(count > 2000, f"{key}: probe sprite rendered ({count} px)")
            check(speed > 50, f"{key}: controller still moving (speed {speed:.1f})")
            if centroid:
                dx_px = centroid[0] - ctrl[0]
                dy_px = centroid[1] - ctrl[1]
                err = (dx_px ** 2 + dy_px ** 2) ** 0.5
                check(err <= TOLERANCE_PX,
                      f"{key}: sprite centre ({centroid[0]:.1f},{centroid[1]:.1f}) "
                      f"on controller ({ctrl[0]:.1f},{ctrl[1]:.1f}), err {err:.2f} px")
            else:
                check(False, f"{key}: probe sprite not found in frame")

        # 2) Wall contact: the controller is stopped by the room wall, the
        #    rendered sprite must stay on the same projected centre.
        drive(a, 1, 0, 260)
        st = state(a)
        contact = a.eval("ALIGN.contact")
        ctrl = controller_screen(a)
        path = shot(a, "collision_align_wall.png")
        centroid, count = magenta_centroid(path)
        check(contact is True, "wall contact detected by the controller")
        check(abs(st["x"] - 1190.0) < 1.0 and abs(st["vx"]) < 1.0,
              f"controller stopped at the wall (x={st['x']:.2f}, vx={st['vx']:.2f})")
        check(count > 2000, f"wall: probe sprite rendered ({count} px)")
        if centroid:
            err = ((centroid[0] - ctrl[0]) ** 2 + (centroid[1] - ctrl[1]) ** 2) ** 0.5
            check(err <= TOLERANCE_PX,
                  f"wall: sprite centre ({centroid[0]:.1f},{centroid[1]:.1f}) "
                  f"on controller ({ctrl[0]:.1f},{ctrl[1]:.1f}), err {err:.2f} px")
        else:
            check(False, "wall: probe sprite not found in frame")

        # 3) Contract proof: without the half-width compensation the rendered
        #    centre shifts by exactly W/2 in world X, i.e. HALF_WIDTH * k px up.
        a.eval("ALIGN.reset(); ALIGN.placement='center'")
        settle(a)
        a.eval("ALIGN.wish.x=0; ALIGN.wish.y=-1")
        a.step(40)
        ctrl = controller_screen(a)
        path = shot(a, "collision_align_no_offset.png")
        centroid, count = magenta_centroid(path)
        check(count > 2000, f"no-offset: probe sprite rendered ({count} px)")
        if centroid:
            shift = ctrl[1] - centroid[1]          # + = sprite above controller
            expected = HALF_WIDTH * ctrl[2]
            check(shift > 25.0,
                  f"no-offset: sprite is {shift:.1f} px above the controller "
                  f"(world-X shift {HALF_WIDTH:.0f} = half width)")
            check(abs(shift - expected) <= 4.0,
                  f"no-offset: measured {shift:.1f} px matches W/2 * k "
                  f"({expected:.1f} px)")
        else:
            check(False, "no-offset: probe sprite not found in frame")

        # 4) Exact diagnostic facility: authored shape + native-footprint overlay.
        a.eval("ALIGN.placement='game'; ALIGN.reset()")
        settle(a)
        shape = json.loads(a.eval("JSON.stringify(ALIGN.ctrl.shape())"))
        check(shape == {"radius": 10, "height": 48, "eye": 40, "step": 8, "slopeLimit": 50}
              or (shape.get("radius") == 10 and shape.get("height") == 48
                  and shape.get("step") == 8 and shape.get("slopeLimit") == 50),
              f"controller.shape() exposes the authored shape: {shape}")

        overlay = json.loads(a.eval("""
            (function () {
                const w = $.window.size();
                const o = ALIGN.world.debug.overlay(ALIGN.view,
                    { width: w.w, height: w.h, controllers: [ALIGN.ctrl] });
                const c = o.controllers[0];
                return JSON.stringify(c ? {
                    count: o.controllers.length, center: c.center, top: c.top,
                    ground: c.ground.length, cross: c.cross.length,
                    radius: c.radius, height: c.height, grounded: c.grounded,
                } : null);
            })()
        """))
        ctrl = controller_screen(a)
        check(overlay is not None and overlay["count"] == 1,
              "debug.overlay returns the exact controller footprint")
        if overlay:
            check(overlay["ground"] >= 30 and overlay["cross"] == 2,
                  f"footprint has a ground circle ({overlay['ground']} pts) and a cross")
            check(abs(overlay["center"]["x"] - ctrl[0]) <= 0.5
                  and abs(overlay["center"]["y"] - ctrl[1]) <= 0.5,
                  f"footprint centre (%.1f,%.1f) = controller projection (%.1f,%.1f)"
                  % (overlay["center"]["x"], overlay["center"]["y"], ctrl[0], ctrl[1]))
            check(overlay["top"] is not None and overlay["radius"] == 10
                  and overlay["height"] == 48 and overlay["grounded"] is True,
                  "footprint carries feet, radius, height and grounded")
            # Drawing the footprint must change the frame (no silent no-op).
            a.eval("ALIGN.overlay = true")
            a.step(2)
            with_overlay = shot(a, "collision_align_overlay.png")
            a.eval("ALIGN.overlay = false")
            a.step(2)
            without = shot(a, "collision_align_no_overlay.png")
            img_a = Image.open(with_overlay).convert("RGB")
            img_b = Image.open(without).convert("RGB")
            from PIL import ImageChops
            gray = ImageChops.difference(img_a, img_b).convert("L")
            diff = sum(gray.histogram()[20:])
            check(diff > 200, f"debug.draw renders the footprint ({diff} changed px)")

        check(not a.eval("$.debug.errors()"), "no script errors")

    print()
    if FAILED:
        print("FAILURES:", len(FAILED))
        for item in FAILED:
            print("  -", item)
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
