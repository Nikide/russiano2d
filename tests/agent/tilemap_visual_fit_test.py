#!/usr/bin/env python3
# ===========================================================================
# BASHNYA E4 (= их A9): масштаб `visual` у тайлмапа.
#
# Было: регион `visual` рисовался 1:1 в МИРОВЫХ пикселях — размер региона в
# текстуре не связан с `tile`, поэтому HD-лист (256×256 на клетку 64) занимал
# четыре клетки, и в игре арт приходилось уменьшать заранее.
#
# Стало: `fit: 'cell'` растягивает регион В КЛЕТКУ (`tile × tile`), `scale: k`
# — множитель размера региона. Умолчание (ни `fit`, ни `scale`) — прежнее
# поведение 1:1, совместимость проверяется здесь же.
#
# Замер — числом: ширина нарисованного пятна в пикселях кадра по строке через
# центр клетки. Регион берём однородный и непрозрачный (16×16, цвет
# `(150, 96, 68)` в `assets/atlas.png`), чтобы ширина считалась однозначно.
#
# Запуск после сборки:
#   python3 tests/agent/tilemap_visual_fit_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "tilemap")
FAILURES = []

REGION = "{ x: 32, y: 0, w: 16, h: 16%s }"      # непрозрачный однородный блок
BACKGROUND = (16, 24, 32)                        # $.world.color('#101820') фикстуры
FAR_X, FAR_Y = 900, 500                          # в стороне от карт фикстуры, внутри bounds


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def patch_width(a, name):
    """Ширина нарисованного региона по строке через центр клетки, в пикселях.

    Считаем пиксели, отличные от фона мира: карта стоит в стороне от карт
    фикстуры (камера в (900, 500)), поэтому в этой строке рисуется только она.
    Точный цвет региона сравнивать нельзя — узел карты может быть подкрашен
    (на живом кадре выходит (94, 58, 40) вместо (150, 96, 68)).
    """
    image = Image.open(a.screenshot(os.path.join(ROOT, "build", "visual_%s.png" % name))).convert("RGB")
    row = int(300)
    width = 0
    for x in range(int(400) - 80, int(400) + 81):
        if image.getpixel((x, row)) != BACKGROUND:
            width += 1
    return width


def run(a):
    a.eval("$.camera.at(%d, %d)" % (FAR_X, FAR_Y))
    a.step(2)

    # Каждую карту мерим отдельно: регионы разного размера в одной точке
    # перекрывали бы друг друга и портили подсчёт ширины.
    def measure(name, spec, depth):
        a.eval("""$.tilemap.create({ id: '%s', src: 'assets/atlas.png', tile: 64, cols: 1, rows: 1, data: ['1'],
            depth: %d, tiles: { 1: { visual: %s } } }).at(%d, %d)"""
               % (name, depth, spec, FAR_X, FAR_Y))
        a.step(3)
        width = patch_width(a, name)
        a.eval("$('#%s').remove()" % name)
        a.step(2)
        return width

    # --- умолчание: регион 1:1 (прежнее поведение) --------------------------
    default_width = measure("v_default", REGION % "", -30)
    check(default_width == 16,
          "без fit/scale регион рисуется 1:1: ширина %d px (ждали 16)" % default_width)

    # --- fit: 'cell': регион растянут в клетку ------------------------------
    fit_width = measure("v_fit", REGION % ", fit: 'cell'", -20)
    check(fit_width == 64,
          "fit:'cell' растягивает регион в клетку 64: ширина %d px (ждали 64)" % fit_width)

    # --- scale: 2: множитель размера региона --------------------------------
    scale_width = measure("v_scale", REGION % ", scale: 2", -10)
    check(scale_width == 32,
          "scale:2 удваивает регион: ширина %d px (ждали 32)" % scale_width)

    # --- fit + scale: fit главнее (растяжение в клетку) ---------------------
    both_width = measure("v_both", REGION % ", fit: 'cell', scale: 2", 0)
    check(both_width == 64,
          "fit:'cell' + scale:2 даёт клетку: ширина %d px (ждали 64)" % both_width)

    # --- учёт в visibleTiles: тот же размер, что и в отрисовке --------------
    cam = "{ x: %d, y: %d, w: 800, h: 600, zoom: 1 }" % (FAR_X, FAR_Y)
    a.eval("""$.tilemap.create({ id: 'v_tiles', src: 'assets/atlas.png', tile: 64, cols: 1, rows: 1, data: ['1'],
        depth: -5, tiles: { 1: { visual: %s } } }).at(%d, %d)"""
           % (REGION % ", fit: 'cell'", FAR_X, FAR_Y))
    a.step(3)
    fit_w = a.eval("(function(){ const t = $.tilemap.visibleTiles('#v_tiles', %s)[0];"
                   " return t ? t.w : null; })()" % cam)
    check(fit_w == 64, "visibleTiles для fit:'cell' отдаёт клетку: %s" % (fit_w,))
    a.eval("$('#v_tiles').remove()")
    a.step(2)

    a.eval("""$.tilemap.create({ id: 'v_tiles2', src: 'assets/atlas.png', tile: 64, cols: 1, rows: 1, data: ['1'],
        depth: -5, tiles: { 1: { visual: %s } } }).at(%d, %d)"""
           % (REGION % "", FAR_X, FAR_Y))
    a.step(3)
    def_w = a.eval("(function(){ const t = $.tilemap.visibleTiles('#v_tiles2', %s)[0];"
                   " return t ? t.w : null; })()" % cam)
    check(def_w == 16, "visibleTiles без fit отдаёт размер региона: %s" % (def_w,))

    # --- запись в visualOf/visualTable несёт fit/scale ----------------------
    fit_rec = a.eval("$.tilemap.visualOf('#v_tiles2', 1)")
    check(fit_rec.get("fit") is None and fit_rec.get("scale") == 1,
          "visualOf без fit/scale отдаёт умолчания: %s" % (fit_rec,))
    a.eval("$('#v_tiles2').remove()")
    a.step(2)
    a.eval("""$.tilemap.create({ id: 'v_rec', src: 'assets/atlas.png', tile: 64, cols: 1, rows: 1, data: ['1'],
        depth: -5, tiles: { 1: { visual: %s } } }).at(%d, %d)"""
           % (REGION % ", fit: 'cell', scale: 3", FAR_X, FAR_Y))
    a.step(2)
    rec = a.eval("$.tilemap.visualOf('#v_rec', 1)")
    check(rec.get("fit") == "cell" and rec.get("scale") == 3 and rec.get("w") == 16,
          "visualOf несёт fit/scale и исходный регион: %s" % (rec,))


def main():
    with Agent(game=GAME, seed=11, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки масштаба visual (E4) пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
