#!/usr/bin/env python3
"""Рисует текстуры стен для демо 2.5D-рейкастера.

Зачем отдельный файл: в рейкастере каждая колонка экрана — это полоса
текстуры шириной в один тексель. Если взять тайл 16x16 и растянуть его на всю
высоту стены, тексель займёт десятки пикселей экрана и стена превратится в
несколько огромных блоков. Текстуры 64x64 дают вчетверо больше деталей при
той же геометрии и читаются как настоящая кладка.

    python3 tools/make_wall_textures.py

Кладёт результат в demos/assets/tiles/:
    wall_brick.png, wall_stone.png, wall_metal.png
"""

from __future__ import annotations

import os
import struct
import zlib

SIZE = 64
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "demos", "assets", "tiles")


class Canvas:
    def __init__(self, w: int, h: int) -> None:
        self.w = w
        self.h = h
        self.px = [[(0, 0, 0, 0)] * w for _ in range(h)]

    def rect(self, x: int, y: int, w: int, h: int, c: tuple[int, int, int, int]) -> None:
        for yy in range(max(0, y), min(self.h, y + h)):
            for xx in range(max(0, x), min(self.w, x + w)):
                self.px[yy][xx] = c


def wall_brick() -> Canvas:
    c = Canvas(SIZE, SIZE)
    mortar = (52, 38, 34, 255)
    base = (128, 72, 58, 255)
    light = (156, 96, 78, 255)
    dark = (96, 52, 42, 255)
    c.rect(0, 0, SIZE, SIZE, mortar)

    row_h = 16
    for row in range(SIZE // row_h):
        offset = (row % 2) * 16
        for col in range(-1, SIZE // 32 + 1):
            x = col * 32 + offset
            y = row * row_h
            c.rect(x + 1, y + 1, 30, row_h - 2, base)
            c.rect(x + 1, y + 1, 30, 2, light)      # блик сверху
            c.rect(x + 1, y + row_h - 3, 30, 2, dark)  # тень снизу
    return c


def wall_stone() -> Canvas:
    c = Canvas(SIZE, SIZE)
    gap = (40, 42, 50, 255)
    base = (98, 102, 112, 255)
    light = (130, 135, 146, 255)
    dark = (72, 75, 84, 255)
    c.rect(0, 0, SIZE, SIZE, gap)

    for row in range(4):
        y = row * 16
        offset = (row % 2) * 13
        for col in range(-1, 4):
            x = col * 26 + offset
            c.rect(x + 2, y + 2, 22, 12, base)
            c.rect(x + 2, y + 2, 22, 2, light)
            c.rect(x + 2, y + 12, 22, 2, dark)
    return c


def wall_metal() -> Canvas:
    c = Canvas(SIZE, SIZE)
    base = (74, 86, 100, 255)
    light = (108, 124, 142, 255)
    dark = (44, 52, 62, 255)
    rivet = (156, 172, 190, 255)
    c.rect(0, 0, SIZE, SIZE, base)
    c.rect(0, 0, SIZE, 3, light)
    c.rect(0, 30, SIZE, 4, dark)
    c.rect(0, 31, SIZE, 1, light)
    c.rect(0, SIZE - 4, SIZE, 4, dark)
    for x in (6, SIZE - 10):
        for y in (10, 44):
            c.rect(x, y, 4, 4, rivet)
            c.rect(x, y + 3, 4, 1, dark)
    return c


def write_png(path: str, canvas: Canvas) -> None:
    raw = bytearray()
    for row in canvas.px:
        raw.append(0)  # filter type 0
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", canvas.w, canvas.h, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) +
           chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    textures = [("wall_brick", wall_brick()), ("wall_stone", wall_stone()),
                ("wall_metal", wall_metal())]

    for name, canvas in textures:
        path = os.path.join(OUT, name + ".png")
        write_png(path, canvas)
        print(f"  {path} ({canvas.w}x{canvas.h})")

    print(f"готово: {len(textures)} текстур, клетка {SIZE}x{SIZE}")


if __name__ == "__main__":
    main()
