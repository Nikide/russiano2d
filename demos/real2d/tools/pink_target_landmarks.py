#!/usr/bin/env python3
# ===========================================================================
# Измерение landmarks по СОБРАННОМУ target-turnaround'у (pink_v4).
#
# Зачем: послойные шиты не дают общей рамки (каждый ряд нарисован по центру
# своей клетки), поэтому геометрические якоря §4/§12 спецификации измеряются по
# собранным видам target'а. Target — reference-only: в runtime не попадает и
# служит только supervision (SPEC §11 E_anchor, §12).
#
# Выход: authoring/pink.target_landmarks.json + overlay для глазной проверки.
#
# Запуск:
#   python3 demos/real2d/tools/pink_target_landmarks.py
# ===========================================================================

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
TARGET = DEMO / "pink_v4" / "assets" / "pink_full_character_target_yaw_pitch_v1.png"
OUT = DEMO / "authoring" / "pink.target_landmarks.json"
OVERLAY = DEMO / "authoring" / "pink.target_landmarks.png"
YAW_KEYS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]


def background_mask(rgb):
    """Фон target'а — светлый нейтральный. Всё, что от него отличается, — фигура."""
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    value = (r + g + b) / 3.0
    sat = np.max(rgb, axis=2).astype(int) - np.min(rgb, axis=2).astype(int)
    return (value < 225) | (sat > 25)


def masks(rgb):
    r, g, b = rgb[:, :, 0].astype(int), rgb[:, :, 1].astype(int), rgb[:, :, 2].astype(int)
    hair = (r > 150) & (r > g + 25) & (b > g)  # розовый
    skin = (r > 180) & (r > b + 15) & (g > b) & (r - g < 60)  # светлая кожа
    eye = (r > 90) & (r > g + 40) & (r > b + 30) & (g < 140)  # красно-розовая радужка
    return {"hair": hair, "skin": skin, "eye": eye}


def blobs(mask, min_area=12):
    try:
        from scipy import ndimage
    except ImportError:
        return []
    labels, count = ndimage.label(mask)
    objects = ndimage.find_objects(labels)
    out = []
    for index, box in enumerate(objects, start=1):
        area = int((labels[box] == index).sum())
        if area < min_area:
            continue
        ys, xs = np.nonzero(labels[box] == index)
        out.append({"bbox": [int(box[1].start), int(box[0].start), int(box[1].stop), int(box[0].stop)],
                    "area": area,
                    "center": [float(box[1].start + xs.mean()), float(box[0].start + ys.mean())]})
    return sorted(out, key=lambda item: -item["area"])


def head_rows_report(fg, m, bands, w, h):
    """Landmarks по крупным головным видам target'а (второй ряд).

    Именно они дают пропорции для посадки слоёв (§10: лицевые landmarks
    нормировать по ширине головы W_h): отношение ширины волос к голове, верх
    волос относительно верха черепа, линия глаз по высоте головы.
    """
    out = []
    if len(bands) < 2:
        return out
    y0, y1 = bands[1]
    heads = [b for b in blobs(fg[y0:y1], min_area=2000)]
    heads = sorted(heads, key=lambda b: b["bbox"][0])
    print(f"головных видов во втором ряду: {len(heads)}")
    for index, box in enumerate(heads):
        bx0, by0, bx1, by1 = box["bbox"]
        sl = (slice(y0 + by0, y0 + by1), slice(bx0, bx1))
        hair = m["hair"][sl]
        skin = m["skin"][sl]
        eye = m["eye"][sl]
        def bbox(mask, min_area=40):
            found = blobs(mask, min_area)
            if not found:
                return None
            return [min(b["bbox"][0] for b in found), min(b["bbox"][1] for b in found),
                    max(b["bbox"][2] for b in found), max(b["bbox"][3] for b in found)]
        hb, sb = bbox(hair), bbox(skin)
        if not sb:
            continue
        head_h = sb[3] - sb[2 - 1] if False else sb[3] - sb[1]
        head_w = sb[2] - sb[0]
        entry = {
            "index": index,
            "bbox": [bx0, y0 + by0, bx1, y0 + by1],
            "skin_bbox": None if sb is None else [sb[0], sb[1], sb[2], sb[3]],
            "hair_bbox": None if hb is None else [hb[0], hb[1], hb[2], hb[3]],
            "head_h": head_h, "head_w": head_w,
            "hair_w_over_head_w": None if not hb else round((hb[2] - hb[0]) / head_w, 4),
            "hair_top_over_head_h": None if not hb else round((hb[1] - sb[1]) / head_h, 4),
            "hair_bottom_over_head_h": None if not hb else round((hb[3] - sb[1]) / head_h, 4),
        }
        eye_blobs = blobs(eye, 6)
        eye_blobs = [e for e in eye_blobs if head_h * 0.02 < (e["bbox"][3] - e["bbox"][1]) < head_h * 0.35]
        entry["eyes"] = [{"center_rel": [round((e["center"][0] - sb[0]) / head_w, 4),
                                         round((e["center"][1] - sb[1]) / head_h, 4)],
                          "area": e["area"]} for e in eye_blobs[:2]]
        out.append(entry)
        print(f"  вид {index}: голова {head_w}×{head_h}px, волосы/голова={entry['hair_w_over_head_w']}, "
              f"верх волос {entry['hair_top_over_head_h']}, низ волос {entry['hair_bottom_over_head_h']}, "
              f"глаз {len(entry['eyes'])}")
        for e in entry["eyes"][:2]:
            print(f"      глаз центр (W_h, H_h) = {e['center_rel']}")
    return out


def main():
    parser = argparse.ArgumentParser(description="Landmarks по target-turnaround'у")
    parser.add_argument("--target", type=Path, default=TARGET)
    args = parser.parse_args()

    image = Image.open(args.target).convert("RGB")
    rgb = np.asarray(image)
    h, w = rgb.shape[:2]
    fg = background_mask(rgb)
    m = masks(rgb)

    # Верхний ряд — 12 собранных фигур. Фигуры могут касаться друг друга,
    # поэтому режем по номинальным колонкам и берём габарит внутри каждой:
    # номер колонки — это метка автора, а не измерение.
    # Три полосы target'а (12 фигур, 6 голов, 3 позы) разделены пустыми
    # промежутками: ищем две самые широкие пустые зоны по профилю занятости.
    profile = fg.sum(axis=1)
    occupied = profile > max(20, int(profile.max() * 0.01))
    gaps = []
    y = 0
    while y < h:
        if not occupied[y]:
            start = y
            while y < h and not occupied[y]:
                y += 1
            if start > 0:
                gaps.append((y - start, start, y))
        y += 1
    gaps.sort(reverse=True)
    cuts = sorted([(start, end) for _, start, end in gaps[:2]])
    bands = []
    previous = 0
    for start, end in cuts:
        bands.append((previous, start))
        previous = end
    bands.append((previous, h))
    print(f"полосы: {bands}")
    row_top, row_bottom = 0, (cuts[0][0] - 1 if cuts else h - 1)
    print(f"полосы target'а: разрывы {cuts}")
    print(f"верхний ряд фигур: y {row_top}..{row_bottom}")
    figures = []
    for col in range(12):
        cx0, cx1 = int(round(col * w / 12)), int(round((col + 1) * w / 12))
        band = fg[row_top:row_bottom + 1, cx0:cx1]
        if not band.any():
            continue
        ys, xs = np.nonzero(band)
        figures.append({"bbox": [int(cx0 + xs.min()), int(row_top + ys.min()),
                                 int(cx0 + xs.max()) + 1, int(row_top + ys.max()) + 1],
                        "area": int(band.sum()), "center": [float(cx0 + xs.mean()), float(row_top + ys.mean())]})
    print(f"фигур в верхнем ряду: {len(figures)} (ожидалось 12)")

    report = {"format": "real2d-pink-target-landmarks", "version": 1,
              "source": str(args.target.relative_to(DEMO.parent.parent)),
              "size": [w, h], "yaw_keys": YAW_KEYS, "figures": []}

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for index, figure in enumerate(figures):
        fx0, fy0, fx1, fy1 = figure["bbox"]
        height = fy1 - fy0                      # рост персонажа = H в пикселях
        # Полоса головы: верхние 30 % фигуры (у головы есть волосы и кожа).
        head_y1 = fy0 + int(height * 0.30)
        head_slice = (slice(fy0, head_y1), slice(fx0, fx1))
        hair_all = m["hair"][head_slice]
        skin_all = m["skin"][head_slice]
        eyes_all = m["eye"][head_slice]

        def bbox_of(mask, min_area):
            found = [b for b in blobs(mask, min_area)]
            if not found:
                return None
            x0 = min(b["bbox"][0] for b in found)
            y0 = min(b["bbox"][1] for b in found)
            x1 = max(b["bbox"][2] for b in found)
            y1 = max(b["bbox"][3] for b in found)
            return [int(x0 + fx0), int(y0 + fy0), int(x1 + fx0), int(y1 + fy0)]

        hair_box = bbox_of(hair_all, 60)
        skin_box = bbox_of(skin_all, 60)
        # Границы головы: верх — самая высокая точка кожи/волос, подбородок —
        # низ кожи в полосе головы, ширина — размах кожи по самой широкой строке.
        head_box = None
        if hair_box or skin_box:
            boxes = [b for b in (hair_box, skin_box) if b]
            hx0 = min(b[0] for b in boxes)
            hy0 = min(b[1] for b in boxes)
            hx1 = max(b[2] for b in boxes)
            hy1 = max(b[3] for b in boxes)
            head_box = [hx0, hy0, hx1, hy1]
        chin_y, head_width = None, None
        if skin_box:
            sx0, sy0, sx1, sy1 = skin_box
            rows = skin_all.sum(axis=1)
            if rows.any():
                widest = int(np.argmax(rows))
                cols = np.nonzero(skin_all[widest])[0]
                head_width = int(cols.max() - cols.min() + 1)
            chin_y = sy1
        # Глаза: красная радужка внутри области кожи, размер меньше четверти
        # ширины головы, не дальше подбородка.
        eye_list = []
        for blob in blobs(eyes_all, 6):
            bx0, by0, bx1, by1 = blob["bbox"]
            width = bx1 - bx0
            if head_width and width > head_width * 0.5:
                continue
            if chin_y and (by0 + fy0) > chin_y:
                continue
            if skin_box and not (sx0 <= (bx0 + bx1) / 2 <= sx1):
                continue
            eye_list.append({"bbox": [bx0 + fx0, by0 + fy0, bx1 + fx0, by1 + fy0],
                             "center_h": [round((blob["center"][0] + fx0 - (fx0 + fx1) / 2) / height, 5),
                                          round((blob["center"][1] + fy0 - fy0) / height, 5)],
                             "area": blob["area"]})

        def in_h(value, origin):
            return None if value is None else round((value - origin) / height, 5)

        entry = {
            "index": index,
            "yaw": YAW_KEYS[index] if index < len(YAW_KEYS) else None,
            "figure_bbox": [fx0, fy0, fx1, fy1],
            "figure_height_px": height,
            "figure_center_x": round((fx0 + fx1) / 2.0, 2),
            "head_bbox": head_box,
            "head_top_h": in_h(head_box[1] if head_box else None, fy0),
            "chin_h": in_h(chin_y, fy0),
            "head_width_h": None if head_width is None else round(head_width / height, 5),
            "hair_bbox": hair_box,
            "hair_top_h": in_h(hair_box[1] if hair_box else None, fy0),
            "hair_bottom_h": in_h(hair_box[3] if hair_box else None, fy0),
            "skin_bbox": skin_box,
            "eyes": eye_list,
        }
        report["figures"].append(entry)

        draw.rectangle([fx0, fy0, fx1 - 1, fy1 - 1], outline=(60, 130, 255), width=1)
        for box, color in ((hair_box, (255, 160, 40)), (skin_box, (40, 200, 120)), (head_box, (255, 255, 0))):
            if box:
                draw.rectangle([box[0], box[1], box[2] - 1, box[3] - 1], outline=color, width=2)
        for eye in eye_list:
            bx0, by0, bx1, by1 = eye["bbox"]
            draw.rectangle([bx0, by0, bx1 - 1, by1 - 1], outline=(255, 60, 60), width=2)

        print(f"  yaw={entry['yaw']:>3}: рост={height}px, голова {entry['head_width_h']}H, "
              f"верх={entry['head_top_h']}, подбородок={entry['chin_h']}, "
              f"волосы {entry['hair_top_h']}..{entry['hair_bottom_h']}, глаз={len(eye_list)}")

    report["head_views"] = head_rows_report(fg, m, bands, w, h)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    overlay.save(OVERLAY)
    print(f"записано: {OUT}")
    print(f"overlay: {OVERLAY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
