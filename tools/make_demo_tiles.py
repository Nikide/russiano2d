#!/usr/bin/env python3
# ===========================================================================
# Тайлсет для демо «Типичная ночь в Мытищинском лесу»: пол, стена и потрескавшийся пол.
#
# Рисуем сами, а не берём готовый набор: нужны ровно три тайла 32×32 в одном
# ряду (id 0 — пол, 1 — стена, 2 — пол с трещинами), совпадающие по стилю с
# остальной графикой демо. Детерминированно: одинаковый файл при каждом запуске.
#
# Использование:
#   python3 tools/make_demo_tiles.py
# ===========================================================================

import os
import random

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "demos", "assets", "tiles", "witch_dungeon_32.png")

TILE = 32
FLOOR_BASE = (42, 47, 58)
FLOOR_SEAM = (32, 36, 45)
WALL_BASE = (74, 82, 100)
WALL_MORTAR = (36, 40, 50)
WALL_LIGHT = (96, 106, 128)


def tile_floor(rng, cracked):
    img = Image.new("RGB", (TILE, TILE), FLOOR_BASE)
    d = ImageDraw.Draw(img)

    # Плитка: светлее в центре, тёмный шов по краю.
    for i in range(TILE):
        for j in range(TILE):
            if i == 0 or j == 0 or i == TILE - 1 or j == TILE - 1:
                img.putpixel((i, j), FLOOR_SEAM)

    for _ in range(26):
        x = rng.randrange(1, TILE - 1)
        y = rng.randrange(1, TILE - 1)
        shade = rng.choice([(48, 54, 66), (36, 40, 50), (52, 58, 72)])
        img.putpixel((x, y), shade)

    if cracked:
        x, y = rng.randrange(6, 20), rng.randrange(4, 12)
        for _ in range(14):
            img.putpixel((x, y), FLOOR_SEAM)
            x += rng.choice([-1, 0, 1])
            y += rng.choice([0, 1])
            x = max(1, min(TILE - 2, x))
            y = max(1, min(TILE - 2, y))
    return img


def tile_wall(rng):
    img = Image.new("RGB", (TILE, TILE), WALL_BASE)
    d = ImageDraw.Draw(img)

    # Кирпич: два ряда по два кирпича, швы тёмные, верхняя кромка светлая.
    d.rectangle([0, 0, TILE - 1, TILE - 1], outline=WALL_MORTAR)
    d.rectangle([0, TILE // 2 - 1, TILE - 1, TILE // 2], fill=WALL_MORTAR)
    d.rectangle([TILE // 2 - 1, 0, TILE // 2, TILE // 2 - 1], fill=WALL_MORTAR)
    d.rectangle([TILE // 4 - 1, TILE // 2 + 1, TILE // 4, TILE - 1], fill=WALL_MORTAR)
    d.rectangle([3 * TILE // 4 - 1, TILE // 2 + 1, 3 * TILE // 4, TILE - 1], fill=WALL_MORTAR)
    d.rectangle([0, 0, TILE - 1, 1], fill=WALL_LIGHT)

    for _ in range(30):
        x = rng.randrange(1, TILE - 1)
        y = rng.randrange(2, TILE - 1)
        img.putpixel((x, y), rng.choice([(66, 74, 92), (84, 92, 112)]))
    return img


def main():
    rng = random.Random(20261005)
    sheet = Image.new("RGB", (TILE * 3, TILE), FLOOR_BASE)
    sheet.paste(tile_floor(rng, False), (0, 0))
    sheet.paste(tile_wall(rng), (TILE, 0))
    sheet.paste(tile_floor(rng, True), (TILE * 2, 0))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print("записан %s (%dx%d, тайлы: пол, стена, пол с трещинами)"
          % (OUT, sheet.width, sheet.height))


if __name__ == "__main__":
    main()
