#!/usr/bin/env python3
# ===========================================================================
# Координаты отладочных примитивов: код и docs обязаны совпадать.
#
# Контракт (docs/highlevel/fx.md):
#   * $.fx.*            — МИРОВЫЕ координаты (движок переводит сам);
#   * $.gfx.draw.*      — координаты ОКНА (сырые примитивы поверх кадра);
#   * $.debug.draw.*    — МИРОВЫЕ (принимает узлы и селекторы, поэтому обязан
#                         липнуть к объектам; мир→экран переводит сам).
#
# Проверка пиксельная: камера сдвинута, рисуем один и тот же прямоугольник
# 20..60 в мире и смотрим, где он оказался. Раньше $.debug.draw.* рисовал в
# координатах окна, и при сдвинутой камере линия между узлами уезжала ровно на
# смещение камеры (нашлось при работе над picking в DevTools).
#
# Запуск (после сборки движка):
#   python3 tests/agent/debug_draw_coords_test.py
# ===========================================================================

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
sys.path.insert(0, HERE)

from agent_client import Agent                       # noqa: E402
from light_receiver_mask_test import read_png        # noqa: E402

FAILURES = []
# Фикстура без ограничений мира: камеру можно ставить точно, без зажима
# границами (из-за него проверка «сдвинули камеру» измеряла не то).
GAME = os.path.join("tests", "fixtures", "trace")
CAM = (100, 50)
BOX = (20, 20, 60, 60)     # мировой прямоугольник
SHOTS = tempfile.mkdtemp(prefix="r2d-draw-coords-")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def red_box(path):
    """Габариты красных пикселей: (x0, y0, x1, y1) или None."""
    width, height, channels, data = read_png(path)
    xs, ys = [], []
    for y in range(height):
        for x in range(width):
            o = (y * width + x) * channels
            if data[o] > 180 and data[o + 1] < 90 and data[o + 2] < 90:
                xs.append(x)
                ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def draw_every_frame(a, code):
    """Рисуем из таймера: очередь примитивов чистится каждый кадр."""
    a.eval("$.time.cancelAll(); $.time.every(16, () => { %s }); 'ok'" % code)
    a.step(3)


def shot(a, name, code):
    a.eval("$.time.cancelAll(); 'ok'")
    a.eval("$.time.every(16, () => { %s }); 'ok'" % code)
    a.step(3)
    return red_box(a.screenshot(os.path.join(SHOTS, name)))


def main():
    with Agent(game=GAME, seed=4, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        # --- 1. $.gfx.draw.* — координаты ОКНА -------------------------------
        # Контракт: сырые примитивы поверх кадра, камера на них не влияет.
        # Проверяем сдвигом камеры: пиксели обязаны остаться на месте.
        a.eval("$.camera.at(100, 50).zoom(1); 'ok'")
        a.step(2)
        first = shot(a, "gfx_a.png", "$.gfx.draw.rect(20, 20, 40, 40, '#ff0000');")
        a.eval("$.camera.at(260, 190).zoom(1); 'ok'")
        a.step(2)
        second = shot(a, "gfx_b.png", "$.gfx.draw.rect(20, 20, 40, 40, '#ff0000');")
        print("  --   $.gfx.draw.rect при камере (100,50): %s, при (260,190): %s" % (first, second))
        check(first is not None and second is not None, "$.gfx.draw.rect что-то нарисовал")
        if first and second:
            check(abs(first[0] - 20) <= 2 and abs(first[1] - 20) <= 2,
                  "$.gfx.draw.* рисует в координатах ОКНА (ждали 20,20, вышло %d,%d)"
                  % (first[0], first[1]))
            check(first == second,
                  "сдвиг камеры на $.gfx.draw.* не влияет (%s == %s)" % (first, second))

        # --- 2. $.debug.draw.* — МИРОВЫЕ координаты ---------------------------
        # Контракт: отладка принимает узлы и селекторы, поэтому липнет к миру.
        # Проверяем тем же сдвигом: пиксели обязаны уехать на минус смещение.
        a.eval("$.camera.at(100, 50).zoom(1); 'ok'")
        a.step(2)
        world_a = shot(a, "world_a.png",
                       "$.debug.draw.rect([20, 20], [60, 60], '#ff0000');")
        a.eval("$.camera.at(260, 190).zoom(1); 'ok'")
        a.step(2)
        world_b = shot(a, "world_b.png",
                       "$.debug.draw.rect([20, 20], [60, 60], '#ff0000');")
        print("  --   $.debug.draw.rect при камере (100,50): %s, при (260,190): %s"
              % (world_a, world_b))
        check(world_a is not None and world_b is not None, "$.debug.draw.rect что-то нарисовал")
        if world_a and world_b:
            dx, dy = world_b[0] - world_a[0], world_b[1] - world_a[1]
            check(dx == -160 and dy == -140,
                  "мировой примитив уезжает на минус смещение камеры "
                  "(ждали -160,-140, вышло %d,%d)" % (dx, dy))
            check(abs(world_a[0] - 20) > 50,
                  "и это НЕ координаты окна (иначе проверка ничего не значит)")

        # --- 3. Отладочная рамка липнет к узлу --------------------------------
        a.eval("$.camera.at(100, 50).zoom(1);"
               " $('<rect>', { id: 'target' }).at(300, 200).size(40, 40)"
               "   .appendTo($.world); 'ok'")
        a.step(3)
        node_a = shot(a, "node_a.png",
                      "$.debug.draw.rect('#target', [340, 240], '#ff0000');")
        a.eval("$('#target').at(360, 260); 'ok'")
        a.step(3)
        node_b = shot(a, "node_b.png",
                      "$.debug.draw.rect('#target', [400, 300], '#ff0000');")
        print("  --   рамка узла: узел (300,200) → %s, узел (360,260) → %s" % (node_a, node_b))
        check(node_a is not None and node_b is not None, "рамка вокруг узла нарисована")
        if node_a and node_b:
            check(node_b[0] - node_a[0] == 60 and node_b[1] - node_a[1] == 60,
                  "рамка едет вместе с узлом на его смещение в мире "
                  "(ждали 60,60, вышло %d,%d)" % (node_b[0] - node_a[0], node_b[1] - node_a[1]))

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
