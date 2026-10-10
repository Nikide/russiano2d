#!/usr/bin/env python3
# ===========================================================================
# Landmark-метрика пропорций: сравнение кадра движка с рефом по положениям
# скелетных ориентиров как ДОЛЕЙ РОСТА.
#
# Зачем: глобальный IoU силуэта нормирует каждый силуэт по его габариту и потому
# не чувствует пропорций (проверено: скелет по измеренным landmark'ам дал
# 0.329 против 0.348 у прежнего — разница в шуме формы). Здесь сравниваются
# именно пропорции: где по высоте находятся шея, плечи, талия, юбка, колено и
# щиколотка.
#
# Запуск:
#   python3 demos/real2d/tools/pink_metric.py --shot /tmp/frame.png --crop 600,70,1000,870
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


def silhouette(rgb, background):
    value = rgb.astype(int).mean(axis=2)
    sat = rgb.astype(int).max(axis=2) - rgb.astype(int).min(axis=2)
    if background is None:
        return (value < 225) | (sat > 25)
    return np.abs(rgb.astype(int) - np.array(background)).max(axis=2) > 30


def color_bands(rgb, mask):
    """Полосы по цвету: блуза (светлая), юбка (клетка/тёмная), чулки/боты (тёмные).

    Ширина силуэта для ориентиров ненадёжна: у рефа волосы ШИРЕ плеч, и
    «максимум ширины в верхней трети» ловил волосы (0.135), а не плечи.
    Цветовые полосы от этого не зависят.
    """
    px = rgb.astype(int)
    r, g, b = px[:, :, 0], px[:, :, 1], px[:, :, 2]
    value = (r + g + b) / 3.0
    inside = mask
    # Блуза — ТЁПЛЫЙ белый (кремовый) И широкая строка: без обоих условий
    # в полосу попадали блики обуви и светлые крапины волос (полоса тянулась
    # до 1.0 роста — это был артефакт правила, а не фигура).
    white = inside & (r > 225) & (g > 215) & (b > 195) & (r >= b) & (np.abs(r - b) < 55)
    dark = inside & (value < 110)
    rows = np.nonzero(inside.any(axis=1))[0]
    top, bottom = int(rows.min()), int(rows.max())
    height = max(1, bottom - top)

    def extent(selection, fraction=0.22):
        counts = selection.sum(axis=1)
        # Строка считается «полосой», только если белого в ней реально много
        # (блуза широкая), а не пара крапин.
        threshold = max(3, int(fraction * (mask.sum(axis=1).max() or 1)))
        found = np.nonzero(counts >= threshold)[0]
        if not found.size:
            return None
        return (float((found.min() - top) / height), float((found.max() - top) / height))

    return {"height": height,
            "blouse": extent(white),
            "dark_lower": extent(dark[top + int(0.35 * height):, :]) if height else None}


def landmarks_of(widths, top, bottom):
    """Ориентиры по профилю ширины, все — в долях роста."""
    height = bottom - top
    w = widths.astype(float)

    def rel(y):
        return float((y - top) / height)

    # Плечи: максимум ширины в верхней трети (там блуза с рукавами).
    shoulder_band = w[top:top + int(0.32 * height)]
    shoulder = top + int(np.argmax(shoulder_band)) if shoulder_band.size else top
    # Шея: минимум между 0.15 роста и плечами (там тонкая шея).
    neck_band = w[top + int(0.15 * height):shoulder + 1]
    neck = top + int(0.15 * height) + int(np.argmin(neck_band)) if neck_band.size else top
    # Юбка: самый широкий участок в анатомическом окне 0.35..0.72 роста —
    # без окна «самый широкий внизу» ловит боты, а не юбку (проверено: 0.98).
    lo = top + int(0.35 * height)
    hi = top + int(0.72 * height)
    skirt_band = w[lo:hi]
    skirt = lo + int(np.argmax(skirt_band)) if skirt_band.size else shoulder
    # Талия: минимум ширины МЕЖДУ плечами и началом юбки. Прежнее правило
    # («минимум до 0.6 роста») на рефе попадало в шею — сравнение было смещено.
    waist_band = w[shoulder:skirt] if skirt > shoulder + 2 else w[shoulder:shoulder + 1]
    waist = shoulder + int(np.argmin(waist_band)) if waist_band.size else shoulder
    # Подол: где ширина падает ниже 55 % ширины юбки.
    hem = skirt
    for y in range(skirt, bottom):
        if w[y] < 0.55 * w[skirt]:
            hem = y
            break
    knee = top + int(0.66 * height)
    ankle = top + int(0.87 * height)
    return {"neck": rel(neck), "shoulder": rel(shoulder), "waist": rel(waist),
            "skirt": rel(skirt), "hem": rel(hem)}


def main():
    parser = argparse.ArgumentParser(description="Landmark-метрика пропорций")
    parser.add_argument("--shot", type=Path, required=True)
    parser.add_argument("--crop", type=str, default="", help="x0,y0,x1,y1 области спрайта")
    parser.add_argument("--background", type=str, default="14,20,32")
    args = parser.parse_args()

    shot = np.asarray(Image.open(args.shot).convert("RGB"))
    if args.crop:
        x0, y0, x1, y1 = (int(v) for v in args.crop.split(","))
        shot = shot[y0:y1, x0:x1]
    engine_mask = silhouette(shot, [int(v) for v in args.background.split(",")])

    landmarks = json.loads(LANDMARKS.read_text(encoding="utf-8"))
    figure = next(f for f in landmarks["figures"] if f["yaw"] == 0)
    target = np.asarray(Image.open(TARGET).convert("RGB").crop(tuple(figure["figure_bbox"])))
    ref_mask = silhouette(target, None)

    # Прямая метрика без хрупких ориентиров: нормируем оба силуэта по высоте и
    # сравниваем ПРОФИЛЬ ШИРИНЫ по строкам. Никаких правил «где плечо» — только
    # форма: RMS разницы профилей и самая расходящаяся зона.
    def profile(mask, bands=64):
        widths = mask.sum(axis=1)
        found = np.nonzero(widths > 2)[0]
        if not found.size:
            return None, None
        top, bottom = int(found.min()), int(found.max())
        cut = widths[top:bottom + 1].astype(float)
        peak = max(1.0, cut.max())
        cut = cut / peak
        idx = np.linspace(0, len(cut) - 1, bands).astype(int)
        return cut[idx], (bottom - top)

    engine_profile, engine_h = profile(engine_mask)
    ref_profile, ref_h = profile(ref_mask)
    if engine_profile is None or ref_profile is None:
        print("силуэт не найден")
        return 1
    diff = engine_profile - ref_profile
    rms = float(np.sqrt((diff ** 2).mean()))
    worst = int(np.argmax(np.abs(diff)))
    print(f"{'зона роста':<12} {'движок':>8} {'реф':>8} {'Δ':>8}")
    for k in range(0, 64, 8):
        print(f"{k/64:<12.2f} {engine_profile[k]:>8.3f} {ref_profile[k]:>8.3f} {diff[k]:>+8.3f}")
    print(f"\nRMS профиля ширины: {rms:.4f} (0 = идеально)")
    print(f"худшая зона: {worst/64:.2f} роста, |Δ|={abs(diff[worst]):.3f} "
          f"(движок {engine_profile[worst]:.3f}, реф {ref_profile[worst]:.3f})")
    print(f"рост: движок {engine_h} px, реф {ref_h} px")
    return 0


if __name__ == "__main__":
    sys.exit(main())
