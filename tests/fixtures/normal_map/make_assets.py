#!/usr/bin/env python3
# ===========================================================================
# Ассеты фикстуры §20.2: выпуклый спрайт, его normal-карта, плоская нормаль и
# атлас с trimmed-кадром.
#
# Зачем генерировать: приёмка §20.2 требует ИЗОБРАЖЕНИЙ и чисел. Выпуклый
# спрайт — радиальный градиент (освещённая сфера), normal-карта — та же сфера
# как нормали, trimmed-кадр — кадр с обрезанными прозрачными полями
# (Aseprite trim: spriteSourceSize/sourceSize).
#
# Запуск: python3 tests/fixtures/normal_map/make_assets.py
# ===========================================================================

import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
SIZE = 64


def png_chunk(kind, payload):
    return (struct.pack(">I", len(payload)) + kind + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))


def write_png(path, pixels, w, h, alpha=False):
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for px in row:
            raw += bytes(px)
    ctype = 6 if alpha else 2
    data = (b"\x89PNG\r\n\x1a\n"
            + png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
            + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + png_chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(data)


def sphere():
    """Выпуклый спрайт: радиальное затенение от верхнего левого края."""
    cx = cy = (SIZE - 1) / 2.0
    radius = SIZE / 2.0
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            dx = (x - cx) / radius
            dy = (y - cy) / radius
            d2 = dx * dx + dy * dy
            if d2 > 1.0:
                row.append((10, 12, 18))
                continue
            # Псевдо-нормаль сферы: z = sqrt(1 - d²), свет сверху-слева.
            nz = (1.0 - d2) ** 0.5
            lambert = max(0.0, (-dx * 0.6) + (-dy * 0.6) + nz * 0.52)
            level = int(30 + 190 * lambert)
            row.append((min(255, level), min(255, level), min(255, level)))
        out.append(row)
    return out


def normal_map():
    """Normal-карта той же сферы: RGB = (nx, ny, nz) в 0..255."""
    cx = cy = (SIZE - 1) / 2.0
    radius = SIZE / 2.0
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            dx = (x - cx) / radius
            dy = (y - cy) / radius
            d2 = dx * dx + dy * dy
            if d2 > 1.0:
                row.append((128, 128, 255))
                continue
            nz = (1.0 - d2) ** 0.5
            row.append((int((dx * 0.5 + 0.5) * 255),
                        int((dy * 0.5 + 0.5) * 255),
                        int((nz * 0.5 + 0.5) * 255)))
        out.append(row)
    return out


def flat_normal_map():
    return [[(128, 128, 255)] * SIZE for _ in range(SIZE)]


def trim_atlas():
    """Атлас из одного кадра 16×16, но с trim: видимая часть 8×8 в центре."""
    src_w = src_h = 16
    trimmed = 8
    ox = (src_w - trimmed) // 2
    oy = (src_h - trimmed) // 2
    # Вся картинка — 16×16 с меткой в видимой части; кадр объявлен trimmed.
    pixels = []
    for y in range(src_h):
        row = []
        for x in range(src_h):
            inside = ox <= x < ox + trimmed and oy <= y < oy + trimmed
            row.append((200, 90, 40) if inside else (0, 0, 0))
        pixels.append(row)
    write_png(os.path.join(ASSETS, "trim.png"), pixels, src_w, src_h)

    # Кадр без trim — та же видимая часть (8×8 в центре), но объявленная как
    # обычный кадр: картинка обязана совпасть с trimmed-кадром пиксель в пиксель.
    full = {
        "meta": {"image": "trim.png", "size": {"w": src_w, "h": src_h}},
        "frames": {"full": {"frame": {"x": ox, "y": oy, "w": trimmed, "h": trimmed}}},
        "tags": {"all": ["full"]},
    }
    trimmed_data = {
        "meta": {"image": "trim.png", "size": {"w": src_w, "h": src_h}},
        "frames": {"trim": {
            "frame": {"x": ox, "y": oy, "w": trimmed, "h": trimmed},
            "trimmed": True,
            "spriteSourceSize": {"x": ox, "y": oy, "w": trimmed, "h": trimmed},
            "sourceSize": {"w": src_w, "h": src_h},
        }},
        "tags": {"all": ["trim"]},
    }
    with open(os.path.join(ASSETS, "trim.json"), "w", encoding="utf-8") as handle:
        json.dump(trimmed_data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    with open(os.path.join(ASSETS, "full.json"), "w", encoding="utf-8") as handle:
        json.dump(full, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main():
    os.makedirs(ASSETS, exist_ok=True)
    write_png(os.path.join(ASSETS, "convex.png"), sphere(), SIZE, SIZE)
    write_png(os.path.join(ASSETS, "convex_n.png"), normal_map(), SIZE, SIZE)
    write_png(os.path.join(ASSETS, "flat_n.png"), flat_normal_map(), SIZE, SIZE)
    trim_atlas()
    print("ассеты §20.2: convex.png, convex_n.png, flat_n.png, trim.png/json, full.json")


if __name__ == "__main__":
    main()
