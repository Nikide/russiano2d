#!/usr/bin/env python3
# ===========================================================================
# Ассеты леса для демо «Ведьма» из CC0-паков Kenney.
#
# Источники лежат рядом и не правятся:
#   * kenney_rpg_sheet.png     — RPG pack (трава, деревья, кусты), CC0;
#   * kenney_urban_packed.png  — RPG Urban pack (фонари), CC0.
#
# Скрипт вырезает нужное и собирает то, что грузит движок:
#   * demos/assets/tiles/forest_32.png — 3 тайла 32×32: трава, трава-вариант,
#     тропа (исходники 16×16, увеличены ×2 — движок работает в 32-пиксельной
#     сетке);
#   * demos/assets/art/forest/tree_*.png, bush_*.png, lamp.png — отдельные
#     спрайты 1:1 (они и так крупные).
#
# Использование:
#   python3 tools/make_forest_assets.py
# ===========================================================================

import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "demos", "assets", "art", "forest")
TILE_OUT = os.path.join(ROOT, "demos", "assets", "tiles", "forest_32.png")

# Прямоугольники (x0, y0, x1, y1) взяты из листов по их содержимому.
OBJECTS = {
    "tree_green": (0, 644, 64, 767),
    "tree_orange": (128, 644, 192, 767),
    "tree_teal": (256, 644, 320, 767),
    "tree_small_green": (70, 668, 121, 767),
    "tree_small_orange": (198, 668, 249, 767),
    "bush_green": (6, 596, 57, 639),
    "bush_orange": (134, 596, 185, 639),
    "bush_teal": (262, 596, 313, 639),
}
LAMP = (4, 97, 26, 139)          # столб с фонарём из urban-пака

# Кусочки земли: берём 16×16 из центра заливок, чтобы не поймать край.
GRASS = (48, 48, 64, 64)
# Вариант травы не вырезаем из другого места листа (там легко поймать dirt-
# пятно), а затемняем базовую траву: получается та же трава, но чуть темнее.
GRASS_DARKEN = 0.93
DIRT = (360, 56, 376, 72)

# Тайлы автотайла тропы: движок нумерует их как base + маска (N=1, E=2, S=4, W=8),
# поэтому генерируем ровно 16 тайлов «тропа с травой по краям».
PATH_BASE = 4
PATH_BAND = 7


def path_tile(mask, dirt, grass, rng, tile):
    """Тайл тропы: трава нашита на те края, где сосед — не тропа."""
    img = dirt.copy()
    px = img.load()
    gx = grass.load()

    def grass_pixel(x, y):
        return gx[x % grass.width, y % grass.height]

    if not (mask & 1):        # N — трава сверху
        for x in range(tile):
            h = PATH_BAND + rng.randint(-2, 2)
            for y in range(max(1, h)):
                px[x, y] = grass_pixel(x, y + tile - h)
    if not (mask & 4):        # S
        for x in range(tile):
            h = PATH_BAND + rng.randint(-2, 2)
            for y in range(max(1, h)):
                px[x, tile - 1 - y] = grass_pixel(x, tile - h + y)
    if not (mask & 8):        # W
        for y in range(tile):
            w = PATH_BAND + rng.randint(-2, 2)
            for x in range(max(1, w)):
                px[x, y] = grass_pixel(x + tile - w, y)
    if not (mask & 2):        # E
        for y in range(tile):
            w = PATH_BAND + rng.randint(-2, 2)
            for x in range(max(1, w)):
                px[tile - 1 - x, y] = grass_pixel(tile - w + x, y)
    return img


def main():
    rpg = Image.open(os.path.join(SRC, "kenney_rpg_sheet.png")).convert("RGBA")
    urban = Image.open(os.path.join(SRC, "kenney_urban_packed.png")).convert("RGBA")

    # --- Тайлы земли ---------------------------------------------------------
    scale = 2
    tile = 16 * scale
    grass = rpg.crop(GRASS).resize((tile, tile), Image.NEAREST)
    grass_alt = grass.point(lambda v: int(v * GRASS_DARKEN))
    dirt = rpg.crop(DIRT).resize((tile, tile), Image.NEAREST)

    # В движке id тайла 1 — это ПЕРВАЯ клетка листа (frames[id - 1]), поэтому
    # лист начинается сразу с травы: 1 — трава, 2 — тёмная трава, 3 — тропа,
    # 4..19 — тайлы автотайла тропы.
    cells = 3 + 16
    sheet = Image.new("RGBA", (tile * cells, tile), (0, 0, 0, 0))
    sheet.alpha_composite(grass, (0, 0))
    sheet.alpha_composite(grass_alt, (tile, 0))
    sheet.alpha_composite(dirt, (tile * 2, 0))

    rng = random.Random(20261006)
    for mask in range(16):
        part = path_tile(mask, dirt, grass, rng, tile)
        sheet.alpha_composite(part, (tile * (PATH_BASE - 1 + mask), 0))

    os.makedirs(os.path.dirname(TILE_OUT), exist_ok=True)
    sheet.save(TILE_OUT)
    print("тайлы: %s (%dx%d), автотайл тропы — id %d..%d"
          % (TILE_OUT, sheet.width, sheet.height, PATH_BASE, PATH_BASE + 15))

    # --- Объекты -------------------------------------------------------------
    for name, rect in OBJECTS.items():
        part = rpg.crop(rect)
        path = os.path.join(SRC, name + ".png")
        part.save(path)
        print("объект: %s %dx%d" % (path, part.width, part.height))

    lamp = urban.crop(LAMP)
    lamp_path = os.path.join(SRC, "lamp.png")
    lamp.save(lamp_path)
    print("фонарь: %s %dx%d" % (lamp_path, lamp.width, lamp.height))


if __name__ == "__main__":
    main()
