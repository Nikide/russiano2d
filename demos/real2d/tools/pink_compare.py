#!/usr/bin/env python3
# ===========================================================================
# Сравнение кадра движка с рефом: силуэт, IoU, картинка рядом.
#
# Спека §17: «картинка похожа» не является доказательством, но и не отменяет
# глазной проверки. Здесь считаются обе вещи: метрика силуэта (IoU) и
# контактный лист «движок | реф» для визуального контроля. Реф — reference-only,
# в runtime он не попадает; это сравнение, а не источник пикселей.
#
# Запуск:
#   python3 demos/real2d/tools/pink_compare.py --shot /tmp/shot.png --yaw 0
# ===========================================================================

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
TARGET = DEMO / "pink_v4" / "assets" / "pink_full_character_target_yaw_pitch_v1.png"
LANDMARKS = DEMO / "authoring" / "pink.target_landmarks.json"
BACKGROUND = (14, 20, 32)


def figure_mask(rgb, tolerance=26):
    diff = np.abs(rgb.astype(int) - np.array(BACKGROUND)).max(axis=2)
    return diff > tolerance


def crop_to_mask(rgb, mask, pad=6):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None, None
    x0, x1 = max(0, xs.min() - pad), min(rgb.shape[1], xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(rgb.shape[0], ys.max() + 1 + pad)
    return rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]


def main():
    parser = argparse.ArgumentParser(description="Сравнение кадра движка с рефом")
    parser.add_argument("--shot", type=Path, required=True, help="скриншот движка")
    parser.add_argument("--yaw", type=int, default=0)
    parser.add_argument("--out", type=Path, default=Path("/tmp/pink_compare.png"))
    parser.add_argument("--size", type=int, default=320, help="высота сравнения")
    parser.add_argument("--crop", type=str, default="",
                        help="область спрайта в скриншоте: x0,y0,x1,y1 (иначе ищем по фону)")
    args = parser.parse_args()

    shot = np.asarray(Image.open(args.shot).convert("RGB"))
    if args.crop:
        x0, y0, x1, y1 = (int(v) for v in args.crop.split(","))
        shot = shot[y0:y1, x0:x1]
    engine = crop_to_mask(shot, figure_mask(shot))
    if engine[0] is None:
        print("на кадре нет персонажа (всё совпало с фоном)")
        return 1

    landmarks = json.loads(LANDMARKS.read_text(encoding="utf-8"))
    entry = next((f for f in landmarks["figures"] if f["yaw"] == args.yaw), None)
    if entry is None:
        print(f"нет рефа для yaw {args.yaw}")
        return 1
    target_image = Image.open(TARGET).convert("RGB")
    x0, y0, x1, y1 = entry["figure_bbox"]
    reference = np.asarray(target_image.crop((x0, y0, x1, y1)))
    ref_mask = np.ones(reference.shape[:2], dtype=bool)
    value = reference.astype(int).mean(axis=2)
    ref_mask = (value < 225)

    def normalize(rgb, mask, size):
        height = size
        width = max(1, int(round(rgb.shape[1] * size / rgb.shape[0])))
        image = Image.fromarray(rgb).resize((width, height), Image.LANCZOS)
        m = Image.fromarray((mask * 255).astype(np.uint8)).resize((width, height), Image.NEAREST)
        return np.asarray(image), np.asarray(m) > 127

    e_rgb, e_mask = normalize(engine[0], engine[1], args.size)
    r_rgb, r_mask = normalize(reference, ref_mask, args.size)
    # Общий холст: обе маски в одной рамке, по центру по x.
    width = max(e_rgb.shape[1], r_rgb.shape[1])

    def place(mask, canvas_width):
        out = np.zeros((args.size, canvas_width), dtype=bool)
        offset = (canvas_width - mask.shape[1]) // 2
        out[:, offset:offset + mask.shape[1]] = mask
        return out

    e_full, r_full = place(e_mask, width), place(r_mask, width)
    inter = np.logical_and(e_full, r_full).sum()
    union = np.logical_or(e_full, r_full).sum()
    iou = inter / union if union else 0.0
    print(f"IoU силуэта (движок vs реф, yaw {args.yaw}): {iou:.3f}")
    print(f"  кадр: {engine[0].shape[1]}×{engine[0].shape[0]}, реф: {reference.shape[1]}×{reference.shape[0]}")

    canvas = Image.new("RGB", (width * 2 + 12, args.size), (10, 14, 22))
    canvas.paste(Image.fromarray(e_rgb), (0, 0))
    canvas.paste(Image.fromarray(r_rgb), (width + 12, 0))
    canvas.save(args.out)
    print(f"сравнение: {args.out} (слева движок, справа реф)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
