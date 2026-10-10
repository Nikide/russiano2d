#!/usr/bin/env python3
# ===========================================================================
# Авторинг розоволосой героини (pink_v4) — ИНСТРУМЕНТ АВТОРИНГА.
#
# Что выяснено измерением (inspect_sheet.py + превью):
#   * шиты послойные: 12 колонок = 12 yaw-ключей, ряды = семантические слои;
#   * слои НЕ выровнены по клетке: каждый ряд нарисован по центру своей клетки,
#     содержимое вылезает за границы. Значит, рамку слоя задаёт авторинг, а не
#     номер клетки. Здесь эта рамка вычисляется из измерений + авторских правил.
#
# Выход: dems/real2d/authoring/pink.authoring.json — патчи (лист, ряд, колонка,
# rect, якорь, посадка в единицах H), годные для bake в .r2d4, и превью-полоса
# для глазной проверки. Финальные кадры считает движок, не этот скрипт.
# ===========================================================================

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ASSETS = DEMO / "pink_v4" / "assets"
OUT = DEMO / "authoring" / "pink.authoring.json"

YAW_KEYS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

HEAD_ROWS = ["head", "hair_back", "hair_left", "hair_right", "fringe", "cat_clip"]
FACE_ROWS = ["eye_l", "eye_r", "iris", "brows", "nose", "mouth"]
BODY_ROWS = ["torso", "arm_l", "arm_r", "hand_l", "hand_r", "legs"]
CLOTH_ROWS = ["blouse", "skirt", "belt", "boot_l", "boot_r"]

CANVAS = 512
# Единица H — высота головы. Канвас держит голову и шею: тело подключается
# отдельной стадией (там своя рамка), поэтому здесь голова занимает верх.
HEAD_UNIT_PX = 240.0
HEAD_TOP_Y = 40.0

# --- авторские правила посадки слоёв (в единицах H, начало — верх черепа) ----
# Значения выведены из замысла (шапка волос по черепу, чёлка по лбу, заколка
# на чёлке) и уточняются по превью. Это данные автора, а не вывод из картинки.
# Правила посадки слоёв. mode:
#   "unit"  — масштаб как у головы той же колонки (лист один, масштаб общий);
#   "width" — ширина слоя приводится к size в единицах H (лист лица свой масштаб);
#   "height"— высота слоя приводится к size в единицах H.
# Размеры и позиции — в долях ИЗМЕРЕННОЙ головы колонки (W_h — ширина головы,
# H_h — высота). Спека §10 требует нормировать лицевые landmarks по head width.
# target_x в единицах W_h (0 — центр головы), target_y в единицах H_h (0 — верх
# черепа). "span" — по какой оси мерить масштаб слоя.
# Числа ниже — ИЗМЕРЕННЫЕ по крупному фронтальному виду target'а (сетка 10 %,
# см. authoring/pink.target_landmarks.png): линия глаз 0.64 высоты головы,
# расстояние между глазами 0.50 ширины черепа, силуэт волос 1.60 ширины черепа,
# рот 0.87. Это авторские landmarks (§10/§12), а не «красивые константы».
PLACE = {
    "head":       {"anchor": "top_center", "target": (0.00, 0.00), "size": None},
    "hair_back":  {"anchor": "top_center", "target": (0.00, -0.06), "span": "width", "size": 1.60},
    "hair_left":  {"anchor": "top_center", "target": (-0.42, 0.16), "span": "height", "size": 0.70},
    "hair_right": {"anchor": "top_center", "target": (0.42, 0.16), "span": "height", "size": 0.70},
    "fringe":     {"anchor": "top_center", "target": (0.00, -0.05), "span": "width", "size": 1.45},
    "cat_clip":   {"anchor": "center",     "target": (-0.32, 0.06), "span": "width", "size": 0.20},
    "eye_l":      {"anchor": "center", "target": (0.25, 0.64), "span": "width", "size": 0.32},
    "eye_r":      {"anchor": "center", "target": (-0.25, 0.64), "span": "width", "size": 0.32},
    "iris":       {"anchor": "center", "target": (0.25, 0.64), "span": "width", "size": 0.16},
    "brows":      {"anchor": "center", "target": (0.00, 0.52), "span": "width", "size": 0.55},
    "nose":       {"anchor": "center", "target": (0.00, 0.78), "span": "height", "size": 0.10},
    "mouth":      {"anchor": "center", "target": (0.00, 0.87), "span": "width", "size": 0.26},
}

# Порядок наложения головы: от дальних к ближним (псевдоглубина).
HEAD_DEPTH = {"hair_back": 0.20, "head": 0.40, "hair_left": 0.48, "hair_right": 0.48,
              "fringe": 0.62, "cat_clip": 0.70,
              "eye_l": 0.64, "eye_r": 0.64, "iris": 0.66, "brows": 0.68,
              "nose": 0.58, "mouth": 0.56}


def load_sheet(name, cols=12, rows=6):
    path = ASSETS / f"{name}.png"
    image = Image.open(path).convert("RGBA")
    rgba = np.asarray(image)
    h, w = rgba.shape[:2]
    sheet = {"image": rgba, "w": w, "h": h, "cols": cols, "rows": rows,
             "cell_w": w / cols, "cell_h": h / rows}
    sheet["blobs"] = all_blobs(sheet)
    sheet["layout"] = layout(sheet)
    return sheet


def cell_rect(sheet, row, col):
    cw, ch = sheet["cell_w"], sheet["cell_h"]
    return (int(round(col * cw)), int(round(row * ch)),
            int(round((col + 1) * cw)), int(round((row + 1) * ch)))


def all_blobs(sheet, threshold=8, min_area=40):
    """Связные компоненты всей таблицы: генератор рисует слои крупнее клетки,
    поэтому и колонку, и ряд определяем по центроиду компоненты, а габарит
    берём фактический (он может пересекать границы клеток)."""
    mask = sheet["image"][:, :, 3] >= threshold
    blobs = []
    try:
        from scipy import ndimage
        labels, count = ndimage.label(mask)
        objects = ndimage.find_objects(labels)
        for index, box in enumerate(objects, start=1):
            area = int((labels[box] == index).sum())
            if area < min_area:
                continue
            ys, xs = np.nonzero(labels[box] == index)
            blobs.append({
                "bbox": (int(box[1].start), int(box[0].start), int(box[1].stop), int(box[0].stop)),
                "cx": float(box[1].start + xs.mean()),
                "cy": float(box[0].start + ys.mean()),
                "area": area,
            })
    except ImportError:
        ys, xs = np.nonzero(mask)
        blobs.append({"bbox": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
                      "cx": float(xs.mean()), "cy": float(ys.mean()), "area": int(mask.sum())})
    return blobs


def centers_1d(values, groups, width):
    """Центры колонок (или рядов): если в ряду ровно `groups` компонент — берём
    их напрямую (самый чистый случай), иначе делим диапазон равномерно."""
    if len(values) == groups:
        return sorted(values)
    if len(values) > groups:
        order = sorted(values)
        gaps = sorted(((order[k + 1] - order[k], k) for k in range(len(order) - 1)), reverse=True)
        cuts = sorted(k for _, k in gaps[:groups - 1])
        groups_list, current = [], [order[0]]
        for k, value in enumerate(order[1:], start=1):
            if k - 1 in cuts:
                groups_list.append(current)
                current = []
            current.append(value)
        groups_list.append(current)
        return [sum(g) / len(g) for g in groups_list]
    step = width / groups
    return [step * (k + 0.5) for k in range(groups)]


def layout(sheet):
    """Слои по клеткам: центры колонок и рядов берём из фактического
    расположения, границы — середина между центрами. Слипшиеся компоненты
    (генератор рисует слои крупнее клетки) режутся по этим границам."""
    blobs = sheet["blobs"]
    if not blobs:
        return {}
    # Колонки: ряд с наибольшим числом компонент, но не больше 12.
    per_row = {}
    rows_est = centers_1d([b["cy"] for b in blobs], sheet["rows"], sheet["h"])
    for blob in blobs:
        row = min(range(len(rows_est)), key=lambda i: abs(rows_est[i] - blob["cy"]))
        per_row.setdefault(row, []).append(blob["cx"])
    best = max(per_row.items(), key=lambda kv: min(len(kv[1]), sheet["cols"]))
    col_centers = centers_1d(best[1], sheet["cols"], sheet["w"])
    col_centers = sorted(col_centers)
    row_centers = sorted(rows_est)

    def bounds(centers, limit):
        edges = [0.0]
        for k in range(len(centers) - 1):
            edges.append((centers[k] + centers[k + 1]) / 2.0)
        edges.append(float(limit))
        return edges

    col_edges = bounds(col_centers, sheet["w"])
    row_edges = bounds(row_centers, sheet["h"])
    cells = {}
    for blob in blobs:
        x0b, y0b, x1b, y1b = blob["bbox"]
        # Компонента может накрывать несколько колонок (генератор рисует слои
        # крупнее клетки): режем её по границам всех накрытых клеток.
        cols = [c for c in range(len(col_centers))
                if col_edges[c] < x1b and col_edges[c + 1] > x0b]
        # По вертикали НЕ режем: ряды — разные семантические слои, и высокий
        # слой (чёлка, масса волос) иначе попадёт в соседний ряд. Ряд выбираем
        # по центроиде компоненты.
        nearest_row = min(range(len(row_centers)), key=lambda r: abs(row_centers[r] - blob["cy"]))
        rows_hit = [nearest_row]
        for row in rows_hit:
            for col in cols:
                x0 = max(int(col_edges[col]), x0b)
                x1 = min(int(col_edges[col + 1]), x1b)
                y0 = max(int(row_edges[row]), y0b)
                y1 = min(int(row_edges[row + 1]), y1b)
                if x1 - x0 < 8 or y1 - y0 < 8:
                    continue
                cell = cells.setdefault((row, col), {"x0": 10 ** 9, "y0": 10 ** 9, "x1": 0, "y1": 0,
                                                     "area": 0, "parts": 0})
                cell["x0"] = min(cell["x0"], x0)
                cell["y0"] = min(cell["y0"], y0)
                cell["x1"] = max(cell["x1"], x1)
                cell["y1"] = max(cell["y1"], y1)
                cell["area"] += blob["area"] // max(1, len(cols) * len(rows_hit))
                cell["parts"] += 1
    out = {}
    for key, cell in cells.items():
        x0, y0 = int(cell["x0"]), int(cell["y0"])
        x1, y1 = int(cell["x1"]), int(cell["y1"])
        out[key] = {"rect": [x0, y0, x1, y1], "area": cell["area"], "parts": cell["parts"],
                    "coverage": round(cell["area"] / float(max(1, (x1 - x0) * (y1 - y0))), 4)}
    sheet["col_centers"] = col_centers
    sheet["row_centers"] = row_centers
    return out


SOLID_ALPHA = 48    # порог «плотной» альфы: у шитов огромные бледные ореолы
                    # (alpha 1..15 — четверть клетки), и по ним кроп берёт
                    # дымку, из-за которой, например, чёлка «не доходит» до
                    # бровей, а на лбу остаётся светлая полоса.


def cell_clip(sheet, row, col, threshold=48, pad=4, min_area=120):
    """Габарит содержимого ВНУТРИ номинальной клетки.

    Для листов тела и одежды сетка регулярная (проверено контактными листами),
    и глобальная кластеризация компонент её ломает: ряд «бёдра» давал 1 колонку
    из 12, ряд «боты» — 2 из 12. Здесь клетка берётся как есть, а внутри неё
    ищется плотная альфа — этого достаточно, потому что деталь нарисована по
    центру своей клетки.
    """
    x0, y0 = int(round(col * sheet["cell_w"])), int(round(row * sheet["cell_h"]))
    x1 = int(round((col + 1) * sheet["cell_w"]))
    y1 = int(round((row + 1) * sheet["cell_h"]))
    reg = sheet["image"][y0:y1, x0:x1, 3] >= threshold
    if int(reg.sum()) < min_area:
        return None
    ys, xs = np.nonzero(reg)
    rx0 = max(0, x0 + int(xs.min()) - pad)
    ry0 = max(0, y0 + int(ys.min()) - pad)
    rx1 = min(sheet["w"], x0 + int(xs.max()) + 1 + pad)
    ry1 = min(sheet["h"], y0 + int(ys.max()) + 1 + pad)
    return {"rect": [rx0, ry0, rx1, ry1], "area": int(reg.sum()), "parts": 1,
            "coverage": round(float(reg.sum()) / float(max(1, (rx1 - rx0) * (ry1 - ry0))), 4)}


def cell_blob(sheet, row, col, pad=6, min_area=120):
    """Компоненты, чей центроид попадает в НОМИНАЛЬНУЮ клетку, объединённые
    габаритом. Так содержимое не режется границей клетки (у блузы рукава
    выходят за неё, и режим clip давал «плиту» с рублеными краями)."""
    x0, y0 = int(round(col * sheet["cell_w"])), int(round(row * sheet["cell_h"]))
    x1 = int(round((col + 1) * sheet["cell_w"]))
    y1 = int(round((row + 1) * sheet["cell_h"]))
    mine = [b for b in sheet["blobs"] if x0 <= b["cx"] < x1 and y0 <= b["cy"] < y1]
    if not mine or sum(b["area"] for b in mine) < min_area:
        return None
    rx0 = max(0, min(b["bbox"][0] for b in mine) - pad)
    ry0 = max(0, min(b["bbox"][1] for b in mine) - pad)
    rx1 = min(sheet["w"], max(b["bbox"][2] for b in mine) + pad)
    ry1 = min(sheet["h"], max(b["bbox"][3] for b in mine) + pad)
    area = sum(b["area"] for b in mine)
    return {"rect": [rx0, ry0, rx1, ry1], "area": area, "parts": len(mine),
            "coverage": round(area / float(max(1, (rx1 - rx0) * (ry1 - ry0))), 4)}


def solid_rect(sheet, rect, pad=4):
    """Сужаем прямоугольник до пикселей с плотной альфой."""
    x0, y0, x1, y1 = rect
    reg = sheet["image"][y0:y1, x0:x1, 3] >= SOLID_ALPHA
    if not reg.any():
        return rect
    ys, xs = np.nonzero(reg)
    return [max(0, int(x0 + xs.min()) - pad), max(0, int(y0 + ys.min()) - pad),
            min(sheet["w"], int(x0 + xs.max()) + 1 + pad), min(sheet["h"], int(y0 + ys.max()) + 1 + pad)]


def cell_content(sheet, row, col, pad=0):
    return sheet["layout"].get((row, col))


def cell_largest(sheet, row, col, pad=4):
    """Габарит КРУПНЕЙШЕЙ компоненты клетки: у листа лица объединение
    компонент захватывает кожу соседних деталей (глаз выходит 119×150 вместо
    самого глаза), поэтому для черт лица нужна одна компонента."""
    mine = [b for b in sheet["blobs"]
            if min(sheet["cols"] - 1, max(0, int(b["cx"] // sheet["cell_w"]))) == col
            and min(sheet["rows"] - 1, max(0, int(b["cy"] // sheet["cell_h"]))) == row]
    if not mine:
        return None
    best = max(mine, key=lambda b: b["area"])
    x0 = max(0, best["bbox"][0] - pad)
    y0 = max(0, best["bbox"][1] - pad)
    x1 = min(sheet["w"], best["bbox"][2] + pad)
    y1 = min(sheet["h"], best["bbox"][3] + pad)
    x0, y0, x1, y1 = solid_rect(sheet, [x0, y0, x1, y1])
    return {"rect": [x0, y0, x1, y1], "area": best["area"], "parts": 1,
            "coverage": round(best["area"] / float(max(1, (x1 - x0) * (y1 - y0))), 4)}


def anchor_point(rect, kind):
    """Точка привязки ВНУТРИ прямоугольника патча (0,0 — его левый верх)."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    if kind == "top_center":
        return w / 2.0, 0.0
    if kind == "center":
        return w / 2.0, h / 2.0
    if kind == "top_outer":
        return 0.0, 0.0
    if kind == "bottom_center":
        return w / 2.0, float(h)
    return w / 2.0, h / 2.0


def build_head_patches(head, face, report):
    """Патчи головы: 12 колонок × слои. Рамка — верх черепа по центру."""
    patches = []
    for col in range(12):
        head_cell = cell_content(head, HEAD_ROWS.index("head"), col)
        if not head_cell:
            report.append(f"колонка {col}: пустая клетка головы")
            continue
        hx0, hy0, hx1, hy1 = head_cell["rect"]
        head_h = hy1 - hy0
        head_mask = head["image"][hy0:hy1, hx0:hx1, 3] >= 8
        head_cols = np.nonzero(head_mask.any(axis=0))[0]
        widths = head_mask.sum(axis=1).astype(float)
        head_w_px = float(widths.max()) if widths.size else float(hx1 - hx0)
        # Подбородок: ниже самой широкой строки ширина падает, затем растёт
        # (шея). Первый локальный минимум — подбородок.
        wide = int(np.argmax(widths))
        chin = None
        for y in range(wide + 2, len(widths) - 1):
            if widths[y] <= widths[y - 1] and widths[y] < widths[y + 1] and widths[y] > 0.15 * head_w_px:
                chin = y
                break
        # ВНИМАНИЕ: автоопределение подбородка на этих клетках ненадёжно
        # (локальный минимум ширины ловится на ухе или пряди), поэтому высота
        # головы берётся по габариту клетки. Точный подбородок обязан быть
        # размечен автором — см. PINK_PIPELINE.md §5.
        chin = None
        head_h_px = float(hy1 - hy0)
        unit = HEAD_UNIT_PX / head_h          # px исходника → px канваса
        # Верх черепа по центру: точка (0,0) в единицах H.
        head_top = ((hx0 + hx1) / 2.0, hy0)

        for name in HEAD_ROWS + FACE_ROWS:
            in_head = name in HEAD_ROWS
            sheet, row = (head, HEAD_ROWS.index(name)) if in_head else (face, FACE_ROWS.index(name))
            cell = cell_content(sheet, row, col)
            if not cell:
                continue
            bx0, by0, bx1, by1 = cell["rect"]
            src_w, src_h = bx1 - bx0, by1 - by0
            rule = PLACE[name]
            head_w = head_w_px                     # измеренная ширина головы, px
            head_h = head_h_px                     # макушка → подбородок, px
            if name == "head":
                scale = HEAD_UNIT_PX / head_h
            elif rule["span"] == "width":
                scale = (rule["size"] * head_w) / src_w
            else:
                scale = (rule["size"] * head_h) / src_h
            ax, ay = anchor_point(cell["rect"], rule["anchor"])
            tx, ty = rule["target"]
            # Цель: x — в единицах ширины головы, y — от верха черепа в H_h.
            px = CANVAS / 2.0 + tx * head_w * (HEAD_UNIT_PX / head_h) / (HEAD_UNIT_PX / head_h) * (head_w / head_w) * head_w * 0 + \
                 tx * head_w * (1.0) + CANVAS / 2.0 - CANVAS / 2.0
            px = CANVAS / 2.0 + tx * head_w
            py = HEAD_TOP_Y + ty * head_h
            offset = (px - ax * scale, py - ay * scale)
            # Геометрический якорь (§3–§4 FORMULAS): посадка слоя в единицах H
            # относительно верха черепа. Это данные для фита q(θ)=μ+B·a(θ).
            anchor_dx = (px - CANVAS / 2.0) / HEAD_UNIT_PX
            anchor_dy = (py - HEAD_TOP_Y) / HEAD_UNIT_PX
            patches.append({
                "id": f"{name}_{col:02d}",
                "anchor_h": [round(anchor_dx, 6), round(anchor_dy, 6)],
                "anchor_px": [round(px, 3), round(py, 3)],
                "part": name,
                "row": row,
                "col": col,
                "yaw": YAW_KEYS[col],
                "sheet": "pink_head_hair_yaw_layers_v1" if name in HEAD_ROWS else "pink_face_yaw_layers_v1",
                "rect": cell["rect"],
                "scale": round(scale, 6),
                "offset": [round(offset[0], 3), round(offset[1], 3)],
                "size": [round(src_w * scale, 3), round(src_h * scale, 3)],
                "depth": HEAD_DEPTH[name],
                "owner_group": "face" if name in ("head",) else ("features" if name in FACE_ROWS else "hair"),
            })
    return patches


def preview(patches, head, face, col, out):
    canvas = np.zeros((CANVAS, CANVAS, 4), dtype=np.float32)
    ordered = sorted([p for p in patches if p["col"] == col], key=lambda p: p["depth"])
    for patch in ordered:
        sheet = head if patch["sheet"].startswith("pink_head") else face
        x0, y0, x1, y1 = patch["rect"]
        crop = sheet["image"][y0:y1, x0:x1].astype(np.float32) / 255.0
        scale = patch["scale"]
        w = max(1, int(round((x1 - x0) * scale)))
        h = max(1, int(round((y1 - y0) * scale)))
        resized = np.asarray(Image.fromarray((crop * 255).astype(np.uint8), "RGBA").resize((w, h), Image.LANCZOS)).astype(np.float32) / 255.0
        ox, oy = int(round(patch["offset"][0])), int(round(patch["offset"][1]))
        canvas = paste_over(canvas, resized, ox, oy)
    rgb = (np.clip(canvas[:, :, :3], 0, 1) * 255).astype(np.uint8)
    alpha = canvas[:, :, 3:4]
    bg = np.zeros_like(rgb, dtype=np.float32)
    bg[:, :] = (14, 20, 32)
    out_arr = (rgb.astype(np.float32) * alpha + bg * (1 - alpha)).astype(np.uint8)
    # уменьшим для просмотра
    Image.fromarray(out_arr, "RGB").resize((CANVAS // 2, CANVAS // 2), Image.LANCZOS).save(out)


def paste_over(canvas, patch, dx, dy):
    ph, pw = patch.shape[:2]
    ch, cw = canvas.shape[:2]
    sx0, sy0 = max(0, -dx), max(0, -dy)
    x0, y0 = max(0, dx), max(0, dy)
    w = min(pw - sx0, cw - x0)
    h = min(ph - sy0, ch - y0)
    if w <= 0 or h <= 0:
        return canvas
    src = patch[sy0:sy0 + h, sx0:sx0 + w]
    dst = canvas[y0:y0 + h, x0:x0 + w]
    sa = src[:, :, 3:4]
    dst[:, :, :3] = src[:, :, :3] * sa + dst[:, :, :3] * (1.0 - sa)
    dst[:, :, 3:4] = sa + dst[:, :, 3:4] * (1.0 - sa)
    return canvas


def main():
    parser = argparse.ArgumentParser(description="Авторинг розоволосой героини")
    parser.add_argument("--preview-col", type=int, default=0)
    parser.add_argument("--out", type=Path, default=Path("/tmp/pink_head_col.png"))
    args = parser.parse_args()

    head = load_sheet("pink_head_hair_yaw_layers_v1")
    face = load_sheet("pink_face_yaw_layers_v1")
    report = []
    patches = build_head_patches(head, face, report)
    print(f"патчей головы: {len(patches)} (колонок: {len({p['col'] for p in patches})})")
    for line in report:
        print("  !", line)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"format": "real2d-pink-authoring", "version": 1,
                               "canvas": CANVAS, "head_unit_px": HEAD_UNIT_PX,
                               "head_top_y": HEAD_TOP_Y, "yaw_keys": YAW_KEYS,
                               "patches": patches,
                               "notes": "рамка слоя авторится: ряды шита не выровнены по клетке"},
                              ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"записано: {OUT}")
    preview(patches, head, face, args.preview_col, args.out)
    print(f"превью колонки {args.preview_col}: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
