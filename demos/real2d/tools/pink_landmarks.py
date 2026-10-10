#!/usr/bin/env python3
# ===========================================================================
# Landmarks внутри изолированных компонент (шаг B аудита автора спецификации).
#
# Почему так: искать landmarks по всей таблице бесполезно (проверено — маски
# цвета путают волосы, кожу и фон). Но кропы уже изолированы, поэтому каждую
# деталь можно измерить на её собственном изображении:
#   * голова  → верх черепа, ширина по вискам, подбородок, уши;
#   * глаз    → линия века (тёмные пиксели) = внутренний/внешний угол;
#   * радужка → красная маска = центр и радиус;
#   * бровь/нос/рот → тёмная линия = центр и габарит.
# Результат — authoring/pink.landmarks.json + overlay для глазной проверки.
#
# Запуск:
#   python3 demos/real2d/tools/pink_landmarks.py
# ===========================================================================

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
sys.path.insert(0, str(HERE))
from pink_author import cell_largest, load_sheet  # noqa: E402

YAW_KEYS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
OUT = DEMO / "authoring" / "pink.landmarks.json"
OVERLAY = DEMO / "authoring" / "pink.landmarks.png"

FEATURES = {
    "eye_l": ("face", 1, "mirror"),     # в ряду 0 шита только линия века
    "eye_r": ("face", 1, None),
    "iris_r": ("face", 2, None),
    "brows_r": ("face", 3, None),
    "brows_l": ("face", 3, "mirror"),
    "nose": ("face", 4, None),
    "mouth": ("face", 5, None),
}


def crop_of(sheet, row, column, mirror=False):
    cell = cell_largest(sheet, row, column)
    if not cell:
        return None
    x0, y0, x1, y1 = cell["rect"]
    image = Image.fromarray(sheet["image"][y0:y1, x0:x1], "RGBA")
    if mirror:
        image = image.transpose(Image.FLIP_LEFT_RIGHT)
    return image


def mask_stats(rgba, predicate, min_area=6):
    mask = predicate(rgba)
    if mask.sum() < min_area:
        return None
    ys, xs = np.nonzero(mask)
    return {"bbox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
            "center": [round(float(xs.mean()), 2), round(float(ys.mean()), 2)],
            "area": int(mask.sum())}


def dark(rgba):
    r, g, b, a = rgba[:, :, 0].astype(int), rgba[:, :, 1].astype(int), rgba[:, :, 2].astype(int), rgba[:, :, 3]
    value = (r + g + b) / 3.0
    return (a > 32) & (value < 120)


def light(rgba):
    r, g, b, a = rgba[:, :, 0].astype(int), rgba[:, :, 1].astype(int), rgba[:, :, 2].astype(int), rgba[:, :, 3]
    value = (r + g + b) / 3.0
    return (a > 200) & (value > 200)


def reddish(rgba):
    r, g, b, a = rgba[:, :, 0].astype(int), rgba[:, :, 1].astype(int), rgba[:, :, 2].astype(int), rgba[:, :, 3]
    return (a > 128) & (r > g + 25) & (r > 60)


def skin_head(rgba):
    r, g, b, a = rgba[:, :, 0].astype(int), rgba[:, :, 1].astype(int), rgba[:, :, 2].astype(int), rgba[:, :, 3]
    return (a > 128) & (r > 190) & (r > b + 12) & (g > b) & (r - g < 60) & (r - g > 4)


def main():
    parser = argparse.ArgumentParser(description="Landmarks внутри кропов")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--overlay", type=Path, default=OVERLAY)
    parser.add_argument("--columns", type=int, default=12)
    args = parser.parse_args()

    head = load_sheet("pink_head_hair_yaw_layers_v1")
    face = load_sheet("pink_face_yaw_layers_v1")
    sheets = {"head": head, "face": face}

    report = {"format": "real2d-pink-landmarks", "version": 1,
              "note": "landmarks измерены ВНУТРИ изолированных кропов каждой "
                      "детали; координаты — в пикселях кропа",
              "yaw_keys": YAW_KEYS, "columns": []}
    tiles = []

    for column in range(args.columns):
        head_image = crop_of(head, 0, column)
        if head_image is None:
            continue
        entry = {"column": column, "yaw": YAW_KEYS[column], "head": {}, "features": {}}
        rgba = np.asarray(head_image)
        skin_mask = skin_head(rgba)
        skin = mask_stats(rgba, skin_head, 200)
        # Профиль кожи: на каждой строке — [левая, правая] граница лица или null.
        profile = []
        for row_index in range(rgba.shape[0]):
            cols = np.nonzero(skin_mask[row_index])[0]
            profile.append([int(cols.min()), int(cols.max())] if cols.size else None)
        entry["skin_profile"] = profile
        if skin:
            x0, y0, x1, y1 = skin["bbox"]
            widths = skin_head(rgba)[:, x0:x1].sum(axis=1)
            widest = int(np.argmax(widths))
            cols = np.nonzero(skin_head(rgba)[widest])[0]
            entry["head"] = {
                "top_y": y0, "chin_y": y1, "temple_width": int(cols.max() - cols.min() + 1),
                "temple_y": int(y0 + widest),
                "center_x": round(float((cols.min() + cols.max()) / 2.0), 2),
                "left_x": int(cols.min()), "right_x": int(cols.max()),
                "crop": [head_image.width, head_image.height],
            }
        for name, (sheet_name, row, mirror_flag) in FEATURES.items():
            image = crop_of(sheets[sheet_name], row, column, mirror=mirror_flag == "mirror")
            if image is None:
                continue
            feat = np.asarray(image)
            data = {"crop": [image.width, image.height]}
            if name.startswith("eye"):
                lash = mask_stats(feat, dark, 8)
                sclera = mask_stats(feat, light, 30)
                if lash:
                    data["lash"] = lash
                    # внутренний/внешний угол: extremes линии века по x
                    mask = dark(feat)
                    ys, xs = np.nonzero(mask)
                    data["corners"] = {"outer": [int(xs.min()), int(ys[xs.argmin()])],
                                       "inner": [int(xs.max()), int(ys[xs.argmax()])]}
                if sclera:
                    data["sclera"] = sclera
            elif name.startswith("iris"):
                iris = mask_stats(feat, reddish, 20)
                if iris:
                    data["iris"] = iris
            else:
                line = mask_stats(feat, dark, 8)
                if line:
                    data["line"] = line
            entry["features"][name] = data

        report["columns"].append(entry)
        tiles.append((column, head_image, entry))

    # Overlay: рисуем измеренные точки на кропе головы (и на кропах деталей).
    if tiles:
        tile_w = max(image.width for _, image, _ in tiles)
        tile_h = max(image.height for _, image, _ in tiles)
        sheet = Image.new("RGB", (tile_w * len(tiles), tile_h + 18), (18, 24, 36))
        draw = ImageDraw.Draw(sheet)
        for index, (column, image, entry) in enumerate(tiles):
            px = index * tile_w
            sheet.paste(image, (px + (tile_w - image.width) // 2, 0), image)
            h = entry["head"]
            if h:
                cx = px + (tile_w - image.width) // 2
                draw.line([(cx + h["center_x"], h["top_y"]), (cx + h["center_x"], h["chin_y"])],
                          fill=(255, 220, 0), width=1)
                draw.line([(cx + h["left_x"], h["temple_y"]), (cx + h["right_x"], h["temple_y"])],
                          fill=(0, 200, 255), width=1)
                for point in ((h["left_x"], h["temple_y"]), (h["right_x"], h["temple_y"])):
                    draw.ellipse([cx + point[0] - 2, point[1] - 2, cx + point[0] + 2, point[1] + 2],
                                 fill=(255, 80, 80))
            draw.text((px + 4, tile_h + 3), f"yaw {entry['yaw']}", fill=(200, 225, 255))
        sheet.save(args.overlay)
        print(f"overlay: {args.overlay} ({sheet.size})")

    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"landmarks: {args.out}")
    for entry in report["columns"]:
        h = entry["head"]
        eyes = [k for k in entry["features"] if k.startswith("eye") and entry["features"][k].get("lash")]
        iris = [k for k in entry["features"] if k.startswith("iris") and entry["features"][k].get("iris")]
        if h:
            print(f"  yaw {entry['yaw']:>3}: череп {h['temple_width']}px, подбородок y={h['chin_y']}, "
                  f"висок y={h['temple_y']}, глаза: {len(eyes)}, радужки: {len(iris)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
