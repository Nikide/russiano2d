#!/usr/bin/env python3
# ===========================================================================
# Проверка исходного component-шита Real2D v4.
#
# Спецификация (demos/real2d/REAL2D_V4_SPEC.md §12, §20) запрещает считать
# сетку точной «по обещанию»: реальный PNG нужно проверить кодом, а rect'ы
# компонентов получить из фактических пикселей. Этот скрипт делает ровно это и
# ничего не придумывает: он не создаёт ассеты и не подменяет отсутствующие
# данные — только измеряет и отказывается работать с непрозрачным фоном.
#
# Запуск:
#   python3 demos/real2d/verify_head_sheet.py
#   python3 demos/real2d/verify_head_sheet.py --sheet demos/real2d/assets/other.png
#
# Результат: отчёт в stdout и <sheet>.rects.json рядом с исходником —
# вход для authoring_manifest.json (rect'ы, площади, метрики содержимого).
# ===========================================================================

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:  # scipy не обязателен: без него работает запасной обход
    from scipy import ndimage as _ndimage
except ImportError:  # pragma: no cover - зависит от окружения
    _ndimage = None

HERE = Path(__file__).resolve().parent
DEFAULT_SHEET = HERE / "assets" / "head_components_candidate_v1.png"
GRID_COLS = 4
GRID_ROWS = 4

# Подписи клеток — авторские метаданные (порядок row-major из
# SPRITESHEET_PROMPT.md). Скрипт их не выводит из картинки: он лишь проверяет,
# что содержимое клетки не противоречит подписи.
LABELS = [
    ("face_front", "лицо: фронт, без черт"),
    ("face_three_quarter", "лицо: три четверти, нос вправо"),
    ("face_profile", "лицо: профиль, нос вправо"),
    ("head_back", "затылок с ушами и шеей"),
    ("eye_front_left", "глаз: фронт, анатомически левый"),
    ("eye_front_right", "глаз: фронт, анатомически правый"),
    ("eye_three_quarter", "глаз: три четверти, ближний"),
    ("eyelid_closed", "закрытое веко + бровь"),
    ("nose_front", "нос: фронт"),
    ("nose_three_quarter", "нос: три четверти"),
    ("mouth_closed", "рот: закрытые губы"),
    ("mouth_open", "рот: открытый, тёмная внутренность"),
    ("hair_back_mass", "волосы: задняя масса"),
    ("hair_bangs", "волосы: чёлка"),
    ("hair_lock_left", "волосы: левая анатомическая прядь"),
    ("hair_lock_right", "волосы: правая анатомическая прядь"),
]

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)
    return condition


def warn(message):
    print("  !    " + message)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def label_components(mask):
    """4-связные компоненты: список (bbox, area, centroid) по убыванию площади."""
    if _ndimage is not None:
        labels, count = _ndimage.label(mask)
        boxes = _ndimage.find_objects(labels)
        out = []
        for index, box in enumerate(boxes, start=1):
            if box is None:
                continue
            area = int((labels[box] == index).sum())
            ys, xs = np.nonzero(labels == index)
            out.append({
                "bbox": (int(box[1].start), int(box[0].start),
                         int(box[1].stop), int(box[0].stop)),
                "area": area,
                "centroid": (float(xs.mean()), float(ys.mean())),
            })
        return sorted(out, key=lambda c: -c["area"])

    # Запасной путь без scipy: обход в ширину по строкам.
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y0 in range(height):
        for x0 in np.nonzero(mask[y0] & ~seen[y0])[0]:
            x0 = int(x0)
            if seen[y0, x0]:
                continue
            stack = [(y0, x0)]
            seen[y0, x0] = True
            minx = maxx = x0
            miny = maxy = y0
            area = 0
            sumx = sumy = 0
            while stack:
                y, x = stack.pop()
                area += 1
                sumx += x
                sumy += y
                minx, maxx = min(minx, x), max(maxx, x)
                miny, maxy = min(miny, y), max(maxy, y)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            out.append({
                "bbox": (minx, miny, maxx + 1, maxy + 1),
                "area": area,
                "centroid": (sumx / area, sumy / area),
            })
    return sorted(out, key=lambda c: -c["area"])


def dominant_colors(rgba, mask):
    """Грубая метрика содержимого: доля тёмных и «синих» пикселей."""
    pixels = rgba[mask]
    if not len(pixels):
        return {"dark": 0.0, "blue": 0.0, "skin": 0.0, "opaque": 0.0}
    rgb = pixels[:, :3].astype(np.int32)
    alpha = pixels[:, 3].astype(np.int32)
    value = rgb.max(axis=1)
    dark = float((value < 90).mean())
    blue = float(((rgb[:, 2] > rgb[:, 0] + 20) & (rgb[:, 2] > 60)).mean())
    skin = float(((rgb[:, 0] > 150) & (rgb[:, 0] > rgb[:, 2] + 15) & (value > 120)).mean())
    opaque = float((alpha >= 250).mean())
    return {"dark": round(dark, 4), "blue": round(blue, 4),
            "skin": round(skin, 4), "opaque": round(opaque, 4)}


def audit(sheet_path):
    print(f"— {sheet_path.relative_to(sheet_path.parents[2]) if sheet_path.is_relative_to(sheet_path.parents[2]) else sheet_path} —")
    if not sheet_path.exists():
        check(False, f"файл существует: {sheet_path}")
        return None

    with Image.open(sheet_path) as image:
        mode = image.mode
        size = image.size
        rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)

    height, width = rgba.shape[:2]
    check(mode in ("RGBA", "LA", "P"), f"PNG с альфой (mode={mode})")
    check(size[0] == size[1], f"квадратный лист ({size[0]}×{size[1]})")
    check(size[0] >= 512, f"разрешение достаточно для авторинга ({size[0]} px)")

    alpha = rgba[:, :, 3]
    opaque_background = float((alpha >= 250).mean())
    check(opaque_background < 0.5, f"фон прозрачный (непрозрачных пикселей {opaque_background:.1%})")
    zero = alpha == 0
    bleed = int((rgba[zero][:, :3].any(axis=1)).sum()) if zero.any() else 0
    if bleed:
        warn(f"под alpha=0 есть непрозрачный цвет у {bleed} пикселей — "
             "это допустимо (straight-alpha), но проверить ореолы при авторинге")

    cell_w = width / GRID_COLS
    cell_h = height / GRID_ROWS
    if cell_w != int(cell_w) or cell_h != int(cell_h):
        warn(f"сетка {GRID_COLS}×{GRID_ROWS} не целочисленная: клетка {cell_w}×{cell_h} px — "
             "rect'ы берём из компонентов, а не из деления листа")

    mask = alpha >= 8
    components = label_components(mask)
    components = [c for c in components if c["area"] >= 16]
    # Клетка — это semantic patch, а не обязательно один связный кусок: у глаза
    # бровь и веко нарисованы отдельно, у носа есть отметки ноздрей. Поэтому
    # проверяем «16 непустых клеток», а число островов сообщаем как факт.
    print(f"  ok   связных островов в листе: {len(components)} "
          f"(клетка может состоять из нескольких — это допустимо)")

    # Какая клетка считается «своей» для компонента: по центроиду.
    assigned = {}
    for comp in components:
        (x0, y0, x1, y1) = comp["bbox"]
        cx, cy = comp["centroid"]
        col = min(GRID_COLS - 1, max(0, int(cx // cell_w)))
        row = min(GRID_ROWS - 1, max(0, int(cy // cell_h)))
        comp.update({"cell_row": row, "cell_col": col,
                     "label": LABELS[row * GRID_COLS + col][0],
                     "cell_rect": (int(round(col * cell_w)), int(round(row * cell_h)),
                                   int(round((col + 1) * cell_w)), int(round((row + 1) * cell_h))),
                     "bbox_tight": True})
        assigned.setdefault((row, col), []).append(comp)

    doubles = {cell: len(items) for cell, items in assigned.items() if len(items) > 1}
    if doubles:
        warn(f"клетки из нескольких островов (это нормально для брови/века/ноздрей): {doubles}")
    empty = [LABELS[r * GRID_COLS + c][0]
             for r in range(GRID_ROWS) for c in range(GRID_COLS)
             if (r, c) not in assigned]
    check(not empty, f"все {GRID_COLS * GRID_ROWS} клеток непусты (пусто: {empty})")

    # Настоящая проверка «утечки»: содержимое разных клеток не пересекается.
    unions = {}
    for (row, col), items in assigned.items():
        x0 = min(i["bbox"][0] for i in items)
        y0 = min(i["bbox"][1] for i in items)
        x1 = max(i["bbox"][2] for i in items)
        y1 = max(i["bbox"][3] for i in items)
        unions[(row, col)] = (x0, y0, x1, y1)
    collisions = []
    cells = sorted(unions)
    for i, a in enumerate(cells):
        ax0, ay0, ax1, ay1 = unions[a]
        for b in cells[i + 1:]:
            bx0, by0, bx1, by1 = unions[b]
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                collisions.append((LABELS[a[0] * GRID_COLS + a[1]][0],
                                   LABELS[b[0] * GRID_COLS + b[1]][0]))
    check(not collisions, f"содержимое клеток не пересекается (пересечения: {collisions})")
    for comp in components:
        comp.pop("cell_rect", None)
        comp.pop("cell_overflow_px", None)

    # Клетка = semantic patch. Прямоугольник берём объединением островов и
    # расширяем на технический padding (spec §8: минимум 4 texel).
    PAD = 4
    cell_reports = []
    print("\n  клетка  label                 rect                     площадь  остр.  тёмн.  син.  кожа")
    for (row, col) in sorted(unions):
        items = assigned[(row, col)]
        x0, y0, x1, y1 = unions[(row, col)]
        metrics = dominant_colors(rgba[y0:y1, x0:x1], mask[y0:y1, x0:x1])
        cell_reports.append({
            "label": LABELS[row * GRID_COLS + col][0],
            "semantic": LABELS[row * GRID_COLS + col][1],
            "cell_row": row,
            "cell_col": col,
            "rect": [x0, y0, x1, y1],
            "rect_padded": [max(0, x0 - PAD), max(0, y0 - PAD),
                            min(width, x1 + PAD), min(height, y1 + PAD)],
            "area": int(sum(i["area"] for i in items)),
            "islands": [{"rect": list(i["bbox"]), "area": i["area"],
                         "centroid": [round(i["centroid"][0], 3), round(i["centroid"][1], 3)]}
                        for i in sorted(items, key=lambda i: -i["area"])],
            "metrics": metrics,
        })
        print(f"  ({row},{col})  {cell_reports[-1]['label']:<20} "
              f"[{x0:>4},{y0:>4},{x1:>4},{y1:>4}]  {cell_reports[-1]['area']:>8}  "
              f"{len(items):>5}  {metrics['dark']:.2f}  {metrics['blue']:.2f}  {metrics['skin']:.2f}")

    # Содержимое против подписи: проверяем только то, что измеримо.
    by_label = {c["label"]: c for c in cell_reports}
    for label in ("eye_front_left", "eye_front_right", "eye_three_quarter"):
        eye = by_label.get(label)
        check(eye is not None and eye["metrics"]["blue"] > 0.05,
              f"{label}: в клетке есть синяя радужка (доля {eye['metrics']['blue'] if eye else '-'})")
    for label in ("face_front", "face_three_quarter", "face_profile", "head_back"):
        face = by_label.get(label)
        check(face is not None and face["metrics"]["skin"] > 0.5,
              f"{label}: клетка преимущественно телесная (доля {face['metrics']['skin'] if face else '-'})")
    for label in ("hair_back_mass", "hair_bangs", "hair_lock_left", "hair_lock_right"):
        hair = by_label.get(label)
        check(hair is not None and hair["metrics"]["dark"] > 0.5,
              f"{label}: клетка преимущественно тёмная (доля {hair['metrics']['dark'] if hair else '-'})")
    mouth = by_label.get("mouth_open")
    check(mouth is not None and mouth["metrics"]["dark"] > 0.05,
          f"mouth_open: есть тёмная внутренность (доля {mouth['metrics']['dark'] if mouth else '-'})")

    report = {
        "format": "r2d4-authoring-rects",
        "version": 1,
        "source": {
            "path": str(sheet_path.relative_to(HERE.parents[1])) if sheet_path.is_relative_to(HERE.parents[1]) else str(sheet_path),
            "sha256": sha256_file(sheet_path),
            "width": width,
            "height": height,
            "mode": mode,
        },
        "grid": {"cols": GRID_COLS, "rows": GRID_ROWS,
                 "cell_w": cell_w, "cell_h": cell_h,
                 "integral": cell_w == int(cell_w) and cell_h == int(cell_h)},
        "alpha": {"zero_share": round(float(zero.mean()), 6),
                  "below_8": int((alpha < 8).sum()),
                  "opaque_share": round(opaque_background, 6),
                  "rgb_under_zero": bleed},
        "cells": cell_reports,
    }
    out_path = sheet_path.with_suffix(".rects.json")
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n  записано: {out_path.relative_to(HERE.parents[1])}")
    return report


def main():
    parser = argparse.ArgumentParser(description="Проверка component-шита Real2D v4")
    parser.add_argument("--sheet", type=Path, default=DEFAULT_SHEET)
    args = parser.parse_args()
    report = audit(args.sheet if args.sheet.is_absolute() else (Path.cwd() / args.sheet))
    if report is None:
        return 2
    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
