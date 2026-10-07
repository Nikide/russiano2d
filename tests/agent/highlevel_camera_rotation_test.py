#!/usr/bin/env python3
# ===========================================================================
# Проверка поворота камеры: мир вращается, координаты и физика — нет.
#
# Юнит-тесты (tests/js/camera_frame_test.mjs) проверяют матрицу кадра. Здесь —
# то, что видно только в движке: поворот МЕНЯЕТ КАРТИНКУ (по скриншотам), не
# трогает координаты узлов, а $.camera.worldToScreen согласован с отрисовкой.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_camera_rotation_test.py
# ===========================================================================

import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, path):
    a.cmd("screenshot", path=path)
    if not os.path.isfile(path):
        return ""
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:16]


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # Сцена: заметно несимметричная, чтобы поворот было видно.
        a.eval("""
            $.world.gravity(0, 0).color('#101820').bounds(0, 0, 640, 360);
            $('<text>', { id: 'mark', text: 'ВОТ', size: 40 }).at(120, 60).appendTo($.world);
            $.camera.at(320, 180);
        """)
        check(a.eval("$.camera.rotation()") == 0, "по умолчанию поворота нет")
        a.step(2)
        before = shot(a, "/tmp/cam_rot_before.png")

        # Узлы НЕ должны сдвинуться от поворота камеры.
        pos_before = json.loads(a.eval("JSON.stringify($('#mark').pos())"))

        a.eval("$.camera.rotation(Math.PI / 2)")
        a.step(2)
        check(abs(a.eval("$.camera.rotation()") - 1.5707963) < 0.01, "поворот выставлен")
        after = shot(a, "/tmp/cam_rot_after.png")
        print(f"  скриншоты: до {before}, после {after}")
        check(before != "" and after != "", "скриншоты сняты")
        check(before != after, "поворот МЕНЯЕТ картинку (скриншоты разные)")

        pos_after = json.loads(a.eval("JSON.stringify($('#mark').pos())"))
        check(abs(pos_after["x"] - pos_before["x"]) < 0.01 and
              abs(pos_after["y"] - pos_before["y"]) < 0.01,
              f"мировые координаты узла не изменились: {pos_after['x']:.0f},{pos_after['y']:.0f}")

        # worldToScreen согласован с матрицей кадра (та же математика).
        # Окно в фикстуре 800x600, поэтому центр камеры — в (400, 300).
        win = json.loads(a.eval("JSON.stringify({ w: engine.width, h: engine.height })"))
        p = json.loads(a.eval("JSON.stringify($.camera.worldToScreen({ x: 320, y: 180 }))"))
        check(abs(p["x"] - win["w"] / 2) < 0.5 and abs(p["y"] - win["h"] / 2) < 0.5,
              f"центр камеры — в центре окна и при повороте: {p['x']:.0f},{p['y']:.0f}")

        # Точка справа от камеры при повороте на 90° уходит ВНИЗ.
        right = json.loads(a.eval("JSON.stringify($.camera.worldToScreen({ x: 420, y: 180 }))"))
        print(f"  точка справа: экран {right['x']:.0f},{right['y']:.0f} "
              f"(центр окна {win['w']//2},{win['h']//2})")
        check(right["y"] > win["h"] / 2 + 50,
              f"правая точка ушла вниз: y = {right['y']:.0f}")

        # Обратный перевод возвращает исходную точку.
        back = json.loads(a.eval(
            "JSON.stringify($.camera.screenToWorld({ x: 420, y: 180 }))"))
        again = json.loads(a.eval(
            f"JSON.stringify($.camera.worldToScreen({{ x: {back['x']}, y: {back['y']} }}))"))
        check(abs(again["x"] - 420) < 0.5 and abs(again["y"] - 180) < 0.5,
              "screenToWorld и worldToScreen взаимно обратны в движке")

        # Возврат к нулю возвращает исходную картинку.
        a.eval("$.camera.rotation(0)")
        a.step(2)
        back_shot = shot(a, "/tmp/cam_rot_back.png")
        check(back_shot == before, "без поворота картинка снова прежняя")

        # Снимок/восстановление камеры учитывают поворот (нужно катсценам).
        a.eval("$.camera.rotation(0.5)")
        a.step(1)
        a.eval("const saved = $.camera.snapshot(); $.camera.rotation(1.2);")
        a.step(1)
        check(abs(a.eval("$.camera.rotation()") - 1.2) < 0.01, "поворот изменён после снимка")
        a.eval("$.camera.restore(saved)")
        a.step(1)
        check(abs(a.eval("$.camera.rotation()") - 0.5) < 0.01,
              f"restore вернул поворот: {a.eval('$.camera.rotation()'):.2f}")

        # Плавный поворот доезжает до цели.
        a.eval("$.camera.rotation(0); $.camera.rotateTo(1.0, 200)")
        a.step(20)
        check(abs(a.eval("$.camera.rotation()") - 1.0) < 0.05,
              f"rotateTo доехал: {a.eval('$.camera.rotation()'):.2f}")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
