#!/usr/bin/env python3
# ===========================================================================
# Тест камеры Re2D (`$.camera.kind(Re2D)`) в движке — фаза 3 docs/RE2D.md.
#
# 1. Положение и углы: слежение мгновенное, info() отдаёт факты в градусах.
# 2. Проекция: `worldToScreen` совпадает с независимой формулой (матрицы
#    поворота на Python), а `screenToWorld` возвращает исходную точку пола.
# 3. Взгляд мышью: сдвиг мыши за кадр поворачивает камеру; pitch зажат.
# 4. Запись/воспроизведение: сдвиг мыши попадает в `--record` (поля dx/dy) и
#    возвращается из `--replay` — камера приходит в те же углы.
# 5. 2D не тронут: после kind(null) камера и узлы ведут себя как раньше.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_camera_re2d_test.py
# ===========================================================================

import json
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "camera_re2d")
FAILURES = []
W, H = 800, 600


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def reference(view, pt):
    """Проекция через матрицы поворота, независимо от C и JS кода движка."""
    x, y, eye, yaw, pitch, fov = view
    d = (pt[0] - x, pt[1] - y, pt[2] - eye)
    fwd = (math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch))
    right = (-math.sin(yaw), math.cos(yaw), 0.0)
    up = (-math.sin(pitch) * math.cos(yaw), -math.sin(pitch) * math.sin(yaw), math.cos(pitch))
    dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    depth = dot(d, fwd)
    if depth < 4.0:
        return None
    f = (H / 2) / math.tan(fov / 2)
    return (W / 2 + dot(d, right) * f / depth, H / 2 - dot(d, up) * f / depth)


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        # --- 1. Положение и факты ----------------------------------------------
        info = a.eval("$.camera.info()")
        check(info["kind"] == "re2d", "камера Re2D (kind = %s)" % info["kind"])
        check(abs(info["x"] - 640) < 1e-6 and abs(info["y"] - 640) < 1e-6, "глаза на теле героя (%s, %s)" % (info["x"], info["y"]))
        check(info["eye"] == 48 and abs(info["fov"] - 70) < 1e-6, "eye и fov как заданы")
        check(info["mouseLook"] is True and abs(info["sensitivity"] - 0.01) < 1e-9, "взгляд мышью включён")
        state = a.state()
        check(state.get("view", {}).get("kind") == "re2d", "info() виден агенту через expose")

        # --- 2. Проекция против независимой формулы ----------------------------
        a.eval("$.camera.yaw(35).pitch(-12).eye(60).fov(80)")
        a.step(1)
        view = (640, 640, 60, math.radians(35), math.radians(-12), math.radians(80))
        for label, pt, sel in (("друг", (740, 640, 0), "#friend"), ("точка", (900, 700, 20), None)):
            if sel:
                got = a.eval("(() => { const p = $.camera.worldToScreen('%s'); return [p.x, p.y, p.visible]; })()" % sel)
            else:
                got = a.eval("(() => { const p = $.camera.worldToScreen({ x: %r, y: %r, z: %r }); return [p.x, p.y, p.visible]; })()" % pt)
            ref = reference(view, pt)
            check(ref is not None and got[2] is True, "%s: видна" % label)
            if ref and got[2]:
                err = max(abs(got[0] - ref[0]), abs(got[1] - ref[1]))
                check(err < 0.2, "%s: worldToScreen совпал с формулой (расхождение %.3f px)" % (label, err))
        behind = a.eval("(() => { const p = $.camera.worldToScreen({ x: 300, y: 300 }); return p.visible; })()")
        check(behind is False, "точка позади камеры помечена visible = false")

        # screenToWorld: пиксель, в который проецируется точка пола, возвращает эту точку.
        floor_pt = (760.0, 690.0)
        scr = a.eval("(() => { const p = $.camera.worldToScreen({ x: %r, y: %r }); return [p.x, p.y]; })()" % floor_pt)
        back = a.eval("(() => { const w = $.camera.screenToWorld({ x: %r, y: %r }); return w ? [w.x, w.y] : null; })()" % tuple(scr))
        check(back is not None and abs(back[0] - floor_pt[0]) < 0.5 and abs(back[1] - floor_pt[1]) < 0.5,
              "screenToWorld(worldToScreen(p)) = p (%s)" % (back,))
        sky = a.eval("$.camera.screenToWorld({ x: 400, y: 2 }) === null")
        check(sky is True or sky is False, "screenToWorld терпит луч выше горизонта")

        # --- 3. Взгляд мышью ---------------------------------------------------
        a.eval("$.camera.yaw(0).pitch(0)")
        a.step(1)
        a.mouse_move(dx=50, dy=-20)
        a.step(1)
        info = a.eval("$.camera.info()")
        check(abs(info["yaw"] - math.degrees(0.5)) < 0.05, "сдвиг мыши +50 px → yaw %.2f° (ждали %.2f°)" % (info["yaw"], math.degrees(0.5)))
        check(abs(info["pitch"] - math.degrees(0.2)) < 0.05, "сдвиг мыши -20 px → pitch %.2f° вверх" % info["pitch"])
        a.mouse_move(dx=0, dy=100000)
        a.step(1)
        check(abs(a.eval("$.camera.info().pitch") + 85) < 1e-6, "взгляд вниз упирается в -85°")
        a.eval("$.camera.pitch(0)")
        a.step(2)
        check(abs(a.eval("$.camera.info().yaw") - math.degrees(0.5)) < 0.05, "без мыши камера стоит")

        # --- 5. 2D не тронут ---------------------------------------------------
        a.eval("$.camera.kind(null).unfollow().at(100, 100)")
        a.step(2)
        p2d = a.eval("(() => { const p = $.camera.worldToScreen({ x: 150, y: 120 }); return [p.x, p.y, 'visible' in p]; })()")
        check(p2d[2] is False and abs(p2d[0] - (W / 2 + 50)) < 1e-3 and abs(p2d[1] - (H / 2 + 20)) < 1e-3,
              "2D: worldToScreen прежней формы и прежних чисел (%s)" % (p2d,))
        a.eval("$.camera.kind(Re2D)")

    # --- 4. Запись и воспроизведение сдвига мыши -----------------------------
    deltas = [(10, 0), (25, -4), (0, 0), (-7, 12), (40, 3), (5, -30), (0, 0), (15, 15)]

    def run(extra):
        with Agent(game=GAME, seed=9, fixed_dt=1.0 / 60.0, extra_args=extra) as b:
            b.step(1)
            for dx, dy in deltas:
                if "--record" in extra:
                    b.mouse_move(dx=dx, dy=dy)
                b.step(1)
            return b.eval("(() => { const i = $.camera.info(); return [i.yaw, i.pitch]; })()")

    with tempfile.TemporaryDirectory(prefix="r2d-look-") as tmp:
        path = os.path.join(tmp, "look.r2replay")
        recorded = run(["--record", path])
        lines = open(path, encoding="utf-8").read().splitlines()
        with_dx = [json.loads(ln) for ln in lines[1:] if '"dx"' in ln]
        check(len(with_dx) >= 5, "в записи есть кадры с dx/dy (%d)" % len(with_dx))
        check(all(("keys" in f and "wheel" in f) for f in with_dx), "прежние поля кадра на месте")
        check(any(abs(f["dx"]) == 25 for f in with_dx), "значения сдвига записаны как были")
        check(abs(recorded[0]) > 1.0, "во время записи камера повернулась (yaw %.2f°)" % recorded[0])

        replayed = run(["--replay", path])
        check(abs(replayed[0] - recorded[0]) < 1e-6 and abs(replayed[1] - recorded[1]) < 1e-6,
              "воспроизведение пришло в те же углы: %s против %s" % (replayed, recorded))

    if FAILURES:
        print("\nПровалов: %d" % len(FAILURES))
        for f in FAILURES:
            print(" -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


if __name__ == "__main__":
    main()
