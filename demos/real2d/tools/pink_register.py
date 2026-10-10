#!/usr/bin/env python3
# ===========================================================================
# Регистрация слоёв pink_v4 по энергии Baker'а (SPEC §11, не подбор на глаз).
#
# Идея: у нас есть собранный target (reference-only, supervision) и послойные
# шиты. Посадку каждого слоя ищем оптимизацией:
#
#   E = w_sil·(1 − IoU(S_composite, S_target)) + w_col·mean|RGB−RGB*| + w_reg·||Δp||²
#
# Слои добавляются в порядке псевдоглубины; для каждого перебирается сетка
# (dx, dy, scale) сначала грубо, затем локально. Это E_anchor/E_silhouette из
# §11 в виде детерминированного поиска: никаких «красивых констант» и никаких
# готовых кадров в runtime — target остаётся только в authoring.
#
# Запуск:
#   python3 demos/real2d/tools/pink_register.py --columns 0,3,6 --out /tmp/reg
# ===========================================================================

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
sys.path.insert(0, str(HERE))
from pink_author import (ASSETS, HEAD_ROWS, FACE_ROWS, YAW_KEYS,  # noqa: E402
                         cell_content, load_sheet)

TARGET = DEMO / "pink_v4" / "assets" / "pink_full_character_target_yaw_pitch_v1.png"
LANDMARKS = DEMO / "authoring" / "pink.target_landmarks.json"
OUT = DEMO / "authoring" / "pink.registration.json"

# Порядок отрисовки головы (псевдоглубина §9) и признак «слой из листа головы».
DEPTH = [("hair_back", 0.20), ("head", 0.40), ("hair_left", 0.48), ("hair_right", 0.48),
         ("mouth", 0.56), ("nose", 0.58), ("eye_l", 0.62), ("eye_r", 0.62),
         ("iris", 0.64), ("brows", 0.66), ("fringe", 0.70), ("cat_clip", 0.72)]

GRID = 128          # рабочий размер регистрации (в пикселях по высоте фигуры)
W_SIL, W_COL, W_REG = 1.0, 0.6, 0.02


def prepare_target(column, landmarks):
    """Собранный вид колонки: RGBA фигуры, приведённый к рабочей сетке."""
    figure = [f for f in landmarks["figures"] if f["index"] == column][0]
    fx0, fy0, fx1, fy1 = figure["figure_bbox"]
    image = Image.open(TARGET).convert("RGB")
    height = GRID
    width = max(1, int(round((fx1 - fx0) * GRID / (fy1 - fy0))))
    crop = image.crop((fx0, fy0, fx1, fy1)).resize((width, height), Image.LANCZOS)
    rgb = np.asarray(crop).astype(np.float32) / 255.0
    # Фон target'а светлый нейтральный — это не часть персонажа.
    value = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    fg = (value < 0.88) | (sat > 0.10)
    rgba = np.dstack([rgb, fg.astype(np.float32)])
    return rgba, fg, width


def layer_stack(head, face, column):
    """Слои колонки в рабочем разрешении: (имя, RGBA) по глубине."""
    out = []
    for name, depth in DEPTH:
        in_head = name in HEAD_ROWS
        sheet = head if in_head else face
        row = (HEAD_ROWS if in_head else FACE_ROWS).index(name)
        cell = cell_content(sheet, row, column)
        if not cell:
            continue
        x0, y0, x1, y1 = cell["rect"]
        crop = sheet["image"][y0:y1, x0:x1].astype(np.float32) / 255.0
        out.append({"name": name, "depth": depth, "rgba": crop,
                    "rect": [x0, y0, x1, y1], "sheet": "head" if in_head else "face"})
    return out


def paste(canvas, patch, dx, dy, scale):
    """Накладывает слой (premultiplied over) с масштабом и сдвигом."""
    ph, pw = patch.shape[:2]
    nw, nh = max(1, int(round(pw * scale))), max(1, int(round(ph * scale)))
    resized = np.asarray(Image.fromarray((patch * 255).astype(np.uint8), "RGBA")
                         .resize((nw, nh), Image.LANCZOS)).astype(np.float32) / 255.0
    ch, cw = canvas.shape[:2]
    x0, y0 = int(round(dx)), int(round(dy))
    sx0, sy0 = max(0, -x0), max(0, -y0)
    tx0, ty0 = max(0, x0), max(0, y0)
    w = min(nw - sx0, cw - tx0)
    h = min(nh - sy0, ch - ty0)
    if w <= 0 or h <= 0:
        return
    src = resized[sy0:sy0 + h, sx0:sx0 + w]
    dst = canvas[ty0:ty0 + h, tx0:tx0 + w]
    sa = src[:, :, 3:4]
    dst[:, :, :3] = src[:, :, :3] * sa + dst[:, :, :3] * (1 - sa)
    dst[:, :, 3:4] = sa + dst[:, :, 3:4] * (1 - sa)


def energy(canvas, target_rgb, target_mask):
    """E_silhouette + E_anchor (цвет) по §11."""
    mask = canvas[:, :, 3] > 0.5
    inter = np.logical_and(mask, target_mask).sum()
    union = np.logical_or(mask, target_mask).sum()
    iou = inter / union if union else 0.0
    both = mask | target_mask
    if both.any():
        diff = np.abs(canvas[:, :, :3] - target_rgb).mean(axis=2)
        color = float(diff[both].mean())
    else:
        color = 1.0
    return W_SIL * (1.0 - iou) + W_COL * color, iou, color


def initial_guess(name, layer, head_box, width, height):
    """Стартовая посадка: слой по центру головы (без «красивых» констант)."""
    return (width / 2.0, height * 0.02, 1.0)


def register_column(column, landmarks, head, face, verbose=True):
    target_rgba, target_mask, width = prepare_target(column, landmarks)
    target_rgb = target_rgba[:, :, :3]
    height = target_rgba.shape[0]
    layers = layer_stack(head, face, column)
    canvas = np.zeros((height, width, 4), dtype=np.float32)
    placements = []
    total, iou, color = energy(canvas, target_rgb, target_mask)
    for layer in layers:
        patch = layer["rgba"]
        ph, pw = patch.shape[:2]
        best = None
        # Координаты центра слоя сеткой: сначала грубо, потом локально.
        scales = [0.6, 0.8, 1.0, 1.25, 1.5, 1.9]
        if layer["name"] in ("head",):
            scales = [0.9, 1.0, 1.1, 1.25]
        for scale in scales:
            nw, nh = pw * scale, ph * scale
            for cx in np.linspace(0.15, 0.85, 15) * width:
                for cy in np.linspace(-0.05, 0.45, 13) * height:
                    trial = canvas.copy()
                    paste(trial, patch, cx - nw / 2.0, cy - nh / 2.0, scale)
                    value, trial_iou, trial_color = energy(trial, target_rgb, target_mask)
                    if best is None or value < best[0]:
                        best = (value, trial_iou, trial_color, cx, cy, scale)
        for step in (0.03, 0.012, 0.005):
            cx, cy, scale = best[3], best[4], best[5]
            for dx in (-step * width, 0, step * width):
                for dy in (-step * height, 0, step * height):
                    for ds in (0.94, 1.0, 1.06):
                        s = scale * ds
                        nw, nh = pw * s, ph * s
                        trial = canvas.copy()
                        paste(trial, patch, cx + dx - nw / 2.0, cy + dy - nh / 2.0, s)
                        value, trial_iou, trial_color = energy(trial, target_rgb, target_mask)
                        if value < best[0]:
                            best = (value, trial_iou, trial_color, cx + dx, cy + dy, s)
        value, trial_iou, trial_color, cx, cy, scale = best
        improved = value < total - 1e-6
        if improved:
            paste(canvas, patch, cx - pw * scale / 2.0, cy - ph * scale / 2.0, scale)
            total, iou, color = value, trial_iou, trial_color
        placements.append({"part": layer["name"], "depth": layer["depth"],
                           "scale": round(float(scale), 6),
                           "center_h": [round(float(cx / width), 5), round(float(cy / height), 5)],
                           "sheet": layer["sheet"], "rect": layer["rect"],
                           "applied": bool(improved),
                           "iou": round(float(trial_iou), 5), "color": round(float(trial_color), 5)})
        if verbose:
            print(f"    {layer['name']:11} scale={scale:.3f} центр=({cx/width:.3f},{cy/height:.3f}) "
                  f"IoU={trial_iou:.3f} цвет={trial_color:.3f} {'принят' if improved else 'отклонён'}")
    return canvas, placements, {"iou": round(float(iou), 5), "color": round(float(color), 5)}


def main():
    parser = argparse.ArgumentParser(description="Регистрация слоёв pink по энергии Baker'а")
    parser.add_argument("--columns", type=str, default="0,3,6")
    parser.add_argument("--out", type=Path, default=Path("/tmp/pink_reg"))
    args = parser.parse_args()

    landmarks = json.loads(LANDMARKS.read_text(encoding="utf-8"))
    head = load_sheet("pink_head_hair_yaw_layers_v1")
    face = load_sheet("pink_face_yaw_layers_v1")
    columns = [int(c) for c in args.columns.split(",") if c != ""]
    args.out.mkdir(parents=True, exist_ok=True)

    report = {"format": "real2d-pink-registration", "version": 1,
              "energy": {"w_silhouette": W_SIL, "w_color": W_COL, "w_reg": W_REG},
              "columns": []}
    for column in columns:
        print(f"колонка {column} (yaw {YAW_KEYS[column]}°)")
        canvas, placements, metrics = register_column(column, landmarks, head, face)
        report["columns"].append({"column": column, "yaw": YAW_KEYS[column],
                                  "placements": placements, "metrics": metrics})
        rgba = (np.clip(canvas, 0, 1) * 255).astype(np.uint8)
        Image.fromarray(rgba, "RGBA").save(args.out / f"column_{column:02d}.png")
        print(f"  итог: IoU={metrics['iou']}, цвет={metrics['color']}")
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"записано: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
