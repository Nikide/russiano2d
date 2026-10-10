#!/usr/bin/env python3
# ===========================================================================
# Сборка превью из послойных шитов pink_v4 — ИНСТРУМЕНТ АВТОРИНГА, не рантайм.
#
# Зачем: прежде чем писать соответствия (cage/UV/anchors) в контейнер, нужно
# глазами проверить, что слои одного шита действительно выровнены в общей
# рамке клетки, а кросс-шитовые слои (лицо поверх головы, одежда поверх тела)
# садятся туда, куда задумано. Финальные кадры всё равно считает движок
# (src/real2d4.c); этот скрипт ничего не выдаёт за runtime.
#
# Запуск:
#   python3 demos/real2d/tools/pink_preview.py --col 0 --out /tmp/col0.png
#   python3 demos/real2d/tools/pink_preview.py --strip --out /tmp/strip.png
# ===========================================================================

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ASSETS = DEMO / "pink_v4" / "assets"

# Ряды шитов по контракту (pink_v4/AUTHORING_CONTRACT.md §3).
HEAD_ROWS = ["head", "hair_back", "hair_left", "hair_right", "fringe", "cat_clip"]
FACE_ROWS = ["eye_l", "eye_r", "iris", "brows", "nose", "mouth"]
BODY_ROWS = ["torso", "arm_l", "arm_r", "hand_l", "hand_r", "legs"]
CLOTH_ROWS = ["blouse", "skirt", "belt", "boot_l", "boot_r"]

# Порядок наложения внутри головы: от дальних к ближним.
HEAD_ORDER = ["hair_back", "head", "hair_left", "hair_right", "fringe", "cat_clip"]

YAW_KEYS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]


def load_sheet(name, cols=12, rows=6):
    path = ASSETS / f"{name}.png"
    image = Image.open(path).convert("RGBA")
    rgba = np.asarray(image).astype(np.float32) / 255.0
    h, w = rgba.shape[:2]
    cells = []
    for r in range(rows):
        row = []
        for c in range(cols):
            x0, y0 = int(round(c * w / cols)), int(round(r * h / rows))
            x1, y1 = int(round((c + 1) * w / cols)), int(round((r + 1) * h / rows))
            row.append((x0, y0, rgba[y0:y1, x0:x1]))
        cells.append(row)
    return cells


def paste_over(canvas, patch, dx, dy):
    """Накладывает RGBA-патч на канвас (straight alpha, over) со сдвигом."""
    ph, pw = patch.shape[:2]
    ch, cw = canvas.shape[:2]
    x0, y0 = int(round(dx)), int(round(dy))
    sx0, sy0 = max(0, -x0), max(0, -y0)
    dx0, dy0 = max(0, x0), max(0, y0)
    w = min(pw - sx0, cw - dx0)
    h = min(ph - sy0, ch - dy0)
    if w <= 0 or h <= 0:
        return
    src = patch[sy0:sy0 + h, sx0:sx0 + w]
    dst = canvas[dy0:dy0 + h, dx0:dx0 + w]
    sa = src[:, :, 3:4]
    dst[:, :, :3] = src[:, :, :3] * sa + dst[:, :, :3] * (1.0 - sa)
    dst[:, :, 3:4] = sa + dst[:, :, 3:4] * (1.0 - sa)


def composite_head_column(head, col, size=(512, 512), scale=1.0):
    canvas = np.zeros((size[1], size[0], 4), dtype=np.float32)
    for name in HEAD_ORDER:
        row = HEAD_ROWS.index(name)
        x0, y0, patch = head[row][col]
        # Рамка клетки — общая для всех рядов шита, поэтому сдвиг не нужен:
        # сохраняем место клетки внутри канваса.
        paste_over(canvas, patch, x0 * scale, y0 * scale)
    return canvas


def main():
    parser = argparse.ArgumentParser(description="Превью сборки слоёв pink_v4")
    parser.add_argument("--col", type=int, default=0)
    parser.add_argument("--strip", action="store_true", help="все 12 колонок в полосу")
    parser.add_argument("--out", type=Path, default=Path("/tmp/pink_preview.png"))
    args = parser.parse_args()

    head = load_sheet("pink_head_hair_yaw_layers_v1")
    cols = range(12) if args.strip else [args.col]
    frames = []
    for col in cols:
        canvas = composite_head_column(head, col)
        rgba = (np.clip(canvas, 0, 1) * 255).astype(np.uint8)
        frames.append(Image.fromarray(rgba, "RGBA"))
    if args.strip:
        w, h = frames[0].size
        sheet = Image.new("RGBA", (w // 2 * len(frames), h // 2), (14, 20, 32, 255))
        for i, frame in enumerate(frames):
            sheet.paste(frame.resize((w // 2, h // 2)), (i * (w // 2), 0))
        sheet = sheet.convert("RGB")
    else:
        rgb = np.zeros((frames[0].height, frames[0].width, 3), dtype=np.uint8)
        rgb[:, :] = (14, 20, 32)
        frame = frames[0]
        alpha = np.asarray(frame)[:, :, 3:4].astype(np.float32) / 255.0
        rgb_arr = np.asarray(frame)[:, :, :3].astype(np.float32)
        composite = rgb_arr * alpha + rgb.astype(np.float32) * (1 - alpha)
        sheet = Image.fromarray(composite.astype(np.uint8), "RGB")
    sheet.save(args.out)
    print(f"готово: {args.out} ({sheet.size}), колонок: {len(frames)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
