#!/usr/bin/env python3
# ===========================================================================
# Генератор атласа для примера §31-5 «Lit sprites».
#
# Зачем генератор, а не готовый PNG: кадры должны быть ОДНОЗНАЧНО проверяемыми
# по пикселям (левая половина зелёная, правая красная, метка в углу), а сосед —
# заведомо другого цвета. Тогда «перевернулось» и «протекло на соседа» видно
# числом из скриншота, а не на глаз.
#
# Раскладка: 4 кадра 16×16, padding 2, extrusion 1 (запас для мипмапов, §22).
# Кадр 1 — сплошной синий: именно его цвет искал бы тест при протечке.
#
# Запуск: python3 demos/litsprites/make_atlas.py
# ===========================================================================

import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")

FRAME = 16
PAD = 2
EXTRUDE = 1
COUNT = 4
STEP = FRAME + 2 * PAD
W = STEP * COUNT
H = FRAME + 2 * PAD


def png_chunk(kind, payload):
    return (struct.pack(">I", len(payload)) + kind + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))


def write_png(path, pixels, w, h):
    """pixels: список строк по w RGB-кортежей."""
    raw = bytearray()
    for row in pixels:
        raw.append(0)                      # фильтр none
        for (r, g, b) in row:
            raw += bytes((r, g, b))
    data = (b"\x89PNG\r\n\x1a\n"
            + png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + png_chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(data)


GREEN = (40, 200, 80)
RED = (220, 60, 50)
BLUE = (40, 90, 220)
YELLOW = (230, 200, 60)
CYAN = (60, 210, 210)
MAGENTA = (210, 70, 200)
WHITE = (245, 245, 245)


def frame_pixels(index):
    """Кадр 16×16. Кадры 0 и 3 асимметричны — на них проверяется flip."""
    out = []
    for y in range(FRAME):
        row = []
        for x in range(FRAME):
            if index == 0:
                # Левая половина зелёная, правая красная, в углу — белая метка.
                c = GREEN if x < FRAME // 2 else RED
                if x < 3 and y < 3:
                    c = WHITE
            elif index == 1:
                c = BLUE
            elif index == 2:
                c = YELLOW
            else:
                c = CYAN if (x // 4 + y // 4) % 2 == 0 else MAGENTA
            row.append(c)
        out.append(row)
    return out


def main():
    os.makedirs(ASSETS, exist_ok=True)
    canvas = [[(0, 0, 0)] * W for _ in range(H)]

    frames = {}
    names = ["half", "blue", "yellow", "checker"]
    for i, name in enumerate(names):
        x0 = PAD + i * STEP
        y0 = PAD
        pix = frame_pixels(i)
        for y in range(FRAME):
            for x in range(FRAME):
                canvas[y0 + y][x0 + x] = pix[y][x]
        # Extrusion: край кадра продолжается наружу на 1 px — запас против
        # протечки при фильтрации/мипмапах (§22).
        for y in range(FRAME):
            canvas[y0 + y][x0 - 1] = pix[y][0]
            canvas[y0 + y][x0 + FRAME] = pix[y][FRAME - 1]
        for x in range(-EXTRUDE, FRAME + EXTRUDE):
            canvas[y0 - 1][x0 + x] = canvas[y0][x0 + max(0, min(FRAME - 1, x))]
            canvas[y0 + FRAME][x0 + x] = canvas[y0 + FRAME - 1][x0 + max(0, min(FRAME - 1, x))]
        frames[name] = {"frame": {"x": x0, "y": y0, "w": FRAME, "h": FRAME}}

    write_png(os.path.join(ASSETS, "atlas.png"), canvas, W, H)

    data = {
        "meta": {
            "image": "atlas.png",
            "size": {"w": W, "h": H},
            "padding": PAD,
            "extrusion": EXTRUDE,
        },
        "frames": frames,
        "tags": {"all": names},
    }
    with open(os.path.join(ASSETS, "atlas.json"), "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    # Normal-карта: плоская нейтраль (128, 128, 255) с лёгким рельефом в центре.
    # Движок сохраняет её как ДАННЫЕ материала и не считает по ней попиксельный
    # свет (§20.2) — пример показывает ровно это: материал с normal-картой и
    # материал без неё дают одинаковую картинку, `perPixelNormal === false`.
    normal = []
    for y in range(8):
        row = []
        for x in range(8):
            if 2 <= x < 6 and 2 <= y < 6:
                row.append((128, 96, 255))
            else:
                row.append((128, 128, 255))
            # FLAT: нейтральная норма в sRGB-байтах — (128,128,255).
        normal.append(row)
    write_png(os.path.join(ASSETS, "normal.png"), normal, 8, 8)
    print("атлас: %dx%d, кадры %s; normal.png 8x8" % (W, H, ", ".join(names)))


if __name__ == "__main__":
    main()
