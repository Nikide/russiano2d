#!/usr/bin/env python3
# ===========================================================================
# Разметочный лист: клетки слоёв с процентной сеткой (ИНСТРУМЕНТ АВТОРИНГА).
#
# Спека §12: точные художественные anchors — входные данные, их надо разметить
# и проверить. Автоматические измерения на генеративной графике ненадёжны
# (см. PINK_PIPELINE.md §5), поэтому landmarks читаются по сетке глазами и
# записываются в authoring/pink.landmarks.json.
#
# Запуск:
#   python3 demos/real2d/tools/pink_gridview.py --column 0 --out /tmp/layers0.png
# ===========================================================================

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from pink_author import FACE_ROWS, HEAD_ROWS, cell_content, load_sheet  # noqa: E402

TILE = 300          # размер плитки на экране
PAD = 22            # место под подпись


def tile(sheet, row, column, name):
    cell = cell_content(sheet, row, column)
    if not cell:
        return None
    x0, y0, x1, y1 = cell["rect"]
    crop = sheet["image"][y0:y1, x0:x1]
    image = Image.fromarray(crop, "RGBA")
    scale = TILE / max(image.width, image.height)
    image = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (TILE, TILE + PAD), (18, 24, 36))
    # клетка по центру, фон тёмный: видно фактические границы габарита
    canvas.paste(image, ((TILE - image.width) // 2, (TILE - image.height) // 2), image)
    draw = ImageDraw.Draw(canvas)
    for i in range(1, 10):
        x = int(TILE * i / 10)
        draw.line([(x, 0), (x, TILE)], fill=(0, 140, 220), width=1)
        draw.line([(0, int(TILE * i / 10)), (TILE, int(TILE * i / 10))], fill=(220, 180, 0), width=1)
    for i in (25, 50, 75):
        x, y = int(TILE * i / 100), int(TILE * i / 100)
        draw.line([(x, 0), (x, TILE)], fill=(255, 255, 255), width=1)
        draw.line([(0, y), (TILE, y)], fill=(255, 255, 255), width=1)
    draw.rectangle([0, TILE, TILE, TILE + PAD], fill=(10, 14, 22))
    draw.text((4, TILE + 4), f"{name}  {image.width}x{image.height} ({x1-x0}x{y1-y0}px)", fill=(220, 235, 255))
    return canvas


def main():
    parser = argparse.ArgumentParser(description="Разметочный лист слоёв")
    parser.add_argument("--column", type=int, default=0)
    parser.add_argument("--out", type=Path, default=Path("/tmp/pink_layers.png"))
    args = parser.parse_args()

    head = load_sheet("pink_head_hair_yaw_layers_v1")
    face = load_sheet("pink_face_yaw_layers_v1")
    items = []
    for name in HEAD_ROWS:
        items.append((name, tile(head, HEAD_ROWS.index(name), args.column, name)))
    for name in FACE_ROWS:
        items.append((name, tile(face, FACE_ROWS.index(name), args.column, name)))
    items = [(n, t) for n, t in items if t]
    cols = 4
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * TILE, rows * (TILE + PAD)), (14, 20, 32))
    for index, (_, image) in enumerate(items):
        sheet.paste(image, ((index % cols) * TILE, (index // cols) * (TILE + PAD)))
    sheet.save(args.out)
    print(f"слоёв: {len(items)} → {args.out} ({sheet.size}); колонка {args.column}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
