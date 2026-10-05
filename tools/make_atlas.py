#!/usr/bin/env python3
"""Генерация спрайтового атласа для демо-игры russiano2d.

Рисует простой пиксель-арт 32x32 и упаковывает его в горизонтальную полосу
assets/atlas.png. Используется только для демо/тестов: настоящие игры кладут
свой атлас в assets/ и описывают спрайты через engine.createSprite().

    python3 tools/make_atlas.py
"""

from __future__ import annotations

import os
import struct
import zlib

TILE = 32
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")


# --- Мини-растр -----------------------------------------------------------------

class Canvas:
    def __init__(self, w: int, h: int) -> None:
        self.w = w
        self.h = h
        self.px = [[(0, 0, 0, 0)] * w for _ in range(h)]

    def rect(self, x: int, y: int, w: int, h: int, c: tuple[int, int, int, int]) -> None:
        for yy in range(max(0, y), min(self.h, y + h)):
            for xx in range(max(0, x), min(self.w, x + w)):
                self.px[yy][xx] = c

    def border(self, x: int, y: int, w: int, h: int, c: tuple[int, int, int, int]) -> None:
        self.rect(x, y, w, 1, c)
        self.rect(x, y + h - 1, w, 1, c)
        self.rect(x, y, 1, h, c)
        self.rect(x + w - 1, y, 1, h, c)

    def disc(self, cx: float, cy: float, r: float, c: tuple[int, int, int, int]) -> None:
        for yy in range(self.h):
            for xx in range(self.w):
                if (xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= r * r:
                    self.px[yy][xx] = c


# --- Спрайты --------------------------------------------------------------------

def make_player() -> Canvas:
    c = Canvas(TILE, TILE)
    body = (86, 196, 110, 255)
    dark = (38, 110, 62, 255)
    eye = (24, 30, 38, 255)
    c.rect(6, 4, 20, 24, body)
    c.border(6, 4, 20, 24, dark)
    c.rect(10, 10, 4, 5, eye)     # глаза
    c.rect(18, 10, 4, 5, eye)
    c.rect(9, 22, 14, 2, dark)    # «рот»
    return c


def make_brick() -> Canvas:
    c = Canvas(TILE, TILE)
    base = (150, 96, 68, 255)
    line = (94, 58, 40, 255)
    c.rect(0, 0, TILE, TILE, base)
    for y in range(0, TILE, 8):
        c.rect(0, y, TILE, 1, line)
    for y in range(0, TILE, 16):
        c.rect(15, y + 1, 1, 7, line)
        c.rect(31, y + 9, 1, 7, line)
    c.border(0, 0, TILE, TILE, line)
    return c


def make_crate() -> Canvas:
    c = Canvas(TILE, TILE)
    base = (206, 150, 74, 255)
    line = (128, 84, 30, 255)
    light = (232, 184, 112, 255)
    c.rect(1, 1, TILE - 2, TILE - 2, base)
    c.border(1, 1, TILE - 2, TILE - 2, line)
    # Внутренняя рамка и крестовина — ящик должен быть сплошным.
    c.border(5, 5, TILE - 10, TILE - 10, light)
    c.rect(14, 5, 4, TILE - 10, line)
    c.rect(5, 14, TILE - 10, 4, line)
    return c


def make_coin() -> Canvas:
    c = Canvas(TILE, TILE)
    gold = (240, 200, 72, 255)
    dark = (176, 132, 30, 255)
    light = (255, 236, 150, 255)
    c.disc(16, 16, 11, dark)
    c.disc(16, 16, 9, gold)
    c.rect(13, 10, 5, 12, light)
    return c


# --- PNG ------------------------------------------------------------------------

def write_png(path: str, canvas: Canvas) -> None:
    raw = bytearray()
    for row in canvas.px:
        raw.append(0)  # filter type 0
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", canvas.w, canvas.h, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main() -> None:
    os.makedirs(ASSETS, exist_ok=True)

    sprites = [("player", make_player()), ("brick", make_brick()),
               ("crate", make_crate()), ("coin", make_coin())]

    atlas = Canvas(TILE * len(sprites), TILE)
    for i, (_name, sprite) in enumerate(sprites):
        for y in range(TILE):
            for x in range(TILE):
                atlas.px[y][i * TILE + x] = sprite.px[y][x]

    out = os.path.join(ASSETS, "atlas.png")
    write_png(out, atlas)
    print(f"записан {out} ({atlas.w}x{atlas.h})")
    for i, (name, _s) in enumerate(sprites):
        print(f"  [{i}] {name}: src=({i * TILE}, 0, {TILE}, {TILE})")


if __name__ == "__main__":
    main()
