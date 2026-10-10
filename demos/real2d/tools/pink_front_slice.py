#!/usr/bin/env python3
# ===========================================================================
# Вертикальный срез: фронтальная колонка pink → контейнер .r2d4 → движок.
#
# Зачем: проверить весь тракт на новом персонаже (авторинг → bake → runtime →
# кадр), прежде чем размечать 12 колонок. Это ровно «постепенные этапы», которые
# контракт §7 разрешает.
#
# Разметка ЗДЕСЬ ЯВНАЯ (спека §12: anchors — входные данные). Рамка деталей:
#  * лист головы — габарит содержимого (слои не выровнены по клетке);
#  * лист лица — НОМИНАЛЬНАЯ КЛЕТКА целиком, потому что клетка содержит сборку
#    «глаз+бровь+веко» и отделять их автоматически нельзя (см. PINK_PIPELINE §5).
# Пропорции посадки — измеренные по target'у: линия глаз 0.64 H_h, глаза
# 0.50 W_h, рот 0.87 H_h, нос 0.78 H_h, силуэт волос 1.60 W_h.
# ===========================================================================

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
sys.path.insert(0, str(HERE))
from pink_author import (FACE_ROWS, HEAD_ROWS, cell_blob,  # noqa: E402
                         cell_clip, cell_content, cell_largest, load_sheet)

OUT_AUTHORING = DEMO / "authoring" / "pink.front.authoring.json"
ATLAS = DEMO / "authoring" / "pink_front_atlas.png"
CANVAS = 512
HEAD_UNIT_PX = 240.0
HEAD_TOP_Y = 40.0
COLUMN = 0                      # фронт (yaw 0)
YAW_KEYS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

# --- явная разметка ---------------------------------------------------------
# rect: "content" — габарит содержимого слоя, "cell" — номинальная клетка.
# anchor: точка внутри патча, которая садится в target.
# target: (x в W_h от центра, y в H_h от верха черепа). size/span — как в pink_author.
PARTS = [
    # слой          лист   ряд  rect      anchor        target(W_h,H_h)  span    size  depth  mirror
    ("hair_back",   "head", 1, "content", "top_center", (0.00, -0.02), "width", 1.44, 0.20, False),
    ("head",        "head", 0, "content", "top_center", (0.00, 0.00), "unit", 1.00, 0.40, False),  # кожа
    ("hair_left",   "head", 2, "content", "top_center", (-0.56, 0.22), "height", 0.52, 0.44, False),
    ("hair_right",  "head", 3, "content", "top_center", (0.56, 0.22), "height", 0.52, 0.44, False),
    ("mouth",       "face", 5, "largest", "center", (0.00, 0.87), "width", 0.26, 0.56, False),
    ("nose",        "face", 4, "largest", "center", (0.00, 0.78), "height", 0.10, 0.58, False),
    ("eye_r",       "face", 1, "largest", "center", (-0.26, 0.62), "width", 0.34, 0.62, False),
    ("eye_l",       "face", 1, "largest", "center", (0.26, 0.62), "width", 0.34, 0.62, True),
    ("iris_r",      "face", 2, "largest", "center", (-0.26, 0.63), "width", 0.17, 0.64, False),
    ("iris_l",      "face", 2, "largest", "center", (0.26, 0.63), "width", 0.17, 0.64, True),
    ("brows_r",     "face", 3, "largest", "center", (-0.26, 0.48), "width", 0.40, 0.66, False),
    ("brows_l",     "face", 3, "largest", "center", (0.26, 0.48), "width", 0.40, 0.66, True),
    ("fringe",      "head", 4, "content", "bottom_center", (0.00, 0.62), "width", 1.04, 0.50, False),
    ("cat_clip",    "head", 5, "content", "center", (-0.32, 0.06), "width", 0.20, 0.60, False),
]


# Словарь групп рантайма: src/real2d4.c group_from_name().
GROUP_OF = {
    "head": "face", "hair_back": "hair_back", "hair_left": "lock", "hair_right": "lock",
    "fringe": "bangs", "cat_clip": "lock",
    "eye_l": "eye", "eye_r": "eye", "iris_r": "eye", "iris_l": "eye",
    "brows_r": "eyelid", "brows_l": "eyelid", "nose": "nose", "mouth": "mouth",
    # Тело и одежда. Группа 0 («face») копит покрытие СУММОЙ, поэтому детали,
    # которые перекрываются между собой, обязаны иметь разные ненулевые группы.
    "torso": "hair_back", "hips": "lock", "legs": "lock",
    "arm_l": "lock", "arm_r": "lock", "hand_l": "eye", "hand_r": "eye",
    "blouse": "bangs", "skirt": "nose", "belt": "mouth",
    "boot_l": "eye", "boot_r": "eye",
}


def feather_edges(array, width=2):
    """Растушёвка альфы у границы кропа: у генератора детали обрезаны
    прямоугольником, и на кадре видны жёсткие швы (дефект в реестре).
    Линейный спад альфы по 2 px гасит шов, не трогая interior."""
    a = np.asarray(array).astype(np.float32)
    h, w = a.shape[:2]
    ramp = np.ones((h, w), dtype=np.float32)
    for k in range(width):
        f = (k + 1) / (width + 1)
        ramp[k, :] = np.minimum(ramp[k, :], f)
        ramp[h - 1 - k, :] = np.minimum(ramp[h - 1 - k, :], f)
        ramp[:, k] = np.minimum(ramp[:, k], f)
        ramp[:, w - 1 - k] = np.minimum(ramp[:, w - 1 - k], f)
    a[:, :, 3] *= ramp
    return np.clip(a, 0, 255).astype(np.uint8)


def patch_image(sheet, row, column, mode):
    if mode == "blob":
        cell = cell_blob(sheet, row, column)
        if not cell:
            return None
        x0, y0, x1, y1 = cell["rect"]
        return sheet["image"][y0:y1, x0:x1], [x0, y0, x1, y1]
    if mode == "clip":
        cell = cell_clip(sheet, row, column)
        if not cell:
            return None
        x0, y0, x1, y1 = cell["rect"]
        return feather_edges(sheet["image"][y0:y1, x0:x1]), [x0, y0, x1, y1]
    if mode in ("content", "largest"):
        cell = cell_largest(sheet, row, column) if mode == "largest" else cell_content(sheet, row, column)
        if not cell:
            return None
        rect = cell["rect"]
    else:
        x0 = int(round(column * sheet["cell_w"]))
        y0 = int(round(row * sheet["cell_h"]))
        rect = [x0, y0, int(round((column + 1) * sheet["cell_w"])), int(round((row + 1) * sheet["cell_h"]))]
    x0, y0, x1, y1 = rect
    crop = sheet["image"][y0:y1, x0:x1]
    return feather_edges(crop), rect


def main():
    parser = argparse.ArgumentParser(description="Вертикальный срез pink: фронт → .r2d4")
    parser.add_argument("--out", type=Path, default=DEMO / "assets" / "pink_front_v4.r2d4")
    parser.add_argument("--atlas", type=Path, default=ATLAS)
    args = parser.parse_args()

    head = load_sheet("pink_head_hair_yaw_layers_v1")
    face = load_sheet("pink_face_yaw_layers_v1")
    sheets = {"head": head, "face": face}

    # --- 1. Измеряем голову колонки: масштаб и ширина/высота -----------------
    head_cell = cell_content(head, 0, COLUMN)
    if not head_cell:
        print("нет клетки головы — размечать нечего")
        return 1
    hx0, hy0, hx1, hy1 = head_cell["rect"]
    head_h_px = hy1 - hy0
    head_mask = head["image"][hy0:hy1, hx0:hx1, 3] >= 8
    head_w_px = float(head_mask.sum(axis=1).max())
    unit = HEAD_UNIT_PX / head_h_px
    print(f"голова колонки {COLUMN}: {head_w_px:.0f}×{head_h_px}px, масштаб {unit:.3f}")

    # --- 2. Режем патчи и пакуем атлас --------------------------------------
    patches = []
    tiles = []
    cursor = 4
    row_y = 4
    row_h = 0
    for name, sheet_name, row, mode, anchor, target, span, size, depth, mirror in PARTS:
        got = patch_image(sheets[sheet_name], row, COLUMN, mode)
        if not got:
            print(f"  ! {name}: нет содержимого")
            continue
        crop, rect = got
        image = Image.fromarray(crop, "RGBA")
        if mirror:
            image = image.transpose(Image.FLIP_LEFT_RIGHT)
        if cursor + image.width + 4 > 2040:
            cursor = 4
            row_y += row_h + 4
            row_h = 0
        x, y = cursor, row_y
        cursor += image.width + 4
        row_h = max(row_h, image.height)
        tiles.append((image, x, y))
        patches.append({"name": name, "sheet": sheet_name, "row": row, "mode": mode,
                        "source_rect": rect, "mirror": mirror, "depth": depth,
                        "anchor": anchor, "target": target, "span": span, "size": size,
                        "atlas_rect": [x, y, x + image.width, y + image.height]})
        print(f"  {name:11} {image.width}×{image.height} → атлас [{x},{y}]")

    atlas = Image.new("RGBA", (2048, 2048), (0, 0, 0, 0))
    for image, x, y in tiles:
        atlas.paste(image, (x, y))
    args.atlas.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.atlas)
    atlas_sha = hashlib.sha256(args.atlas.read_bytes()).hexdigest()
    print(f"атлас: {args.atlas} ({len(tiles)} патчей)")

    # --- 3. Собираем authoring в формате baker'а ----------------------------
    authoring = {
        "format": "r2d4-authoring", "version": 1,
        "character": {"id": "pink_front_slice",
                      "note": "вертикальный срез: одна колонка (yaw 0), 12 anchors одинаковы"},
        "units": {"H": 1.0, "origin": "верх черепа по центру", "y": "вниз"},
        "sheet": {"path": str(args.atlas.relative_to(DEMO.parent.parent)),
                  "sha256": atlas_sha, "width": 2048, "height": 2048},
        "placement": {"head_unit_px": HEAD_UNIT_PX, "head_top_y": HEAD_TOP_Y},
        "anchors_yaw_deg": YAW_KEYS,
        "rings": {},
        "patches": [],
    }

    for patch in patches:
        ax0, ay0, ax1, ay1 = patch["atlas_rect"]
        src_w, src_h = ax1 - ax0, ay1 - ay0
        # Локальные координаты — в ЕДИНИЦАХ ГОЛОВЫ (U = высота головы в листе
        # головы). head_unit_px в манифесте переводит их в пиксели канваса.
        # Для слоёв листа лица масштаб задаётся измеренной целью (доля W_h/H_h).
        if patch["name"] == "head":
            source_px_per_unit = float(head_h_px)
        elif patch["span"] == "width":
            target_w_px = patch["size"] * head_w_px          # в пикселях листа головы
            source_px_per_unit = src_w / (target_w_px / head_h_px)
        else:
            target_h_px = patch["size"] * head_h_px
            source_px_per_unit = src_h / (target_h_px / head_h_px)
        anchor = {"top_center": (src_w / 2.0, 0.0),
                  "bottom_center": (src_w / 2.0, src_h),
                  "center": (src_w / 2.0, src_h / 2.0)}[patch["anchor"]]

        cols, rows = 2, 2
        grid = [(i / cols, j / rows) for j in range(rows + 1) for i in range(cols + 1)]
        uv = [[(ax0 + u * src_w) / 2048.0, (ay0 + v * src_h) / 2048.0] for (u, v) in grid]
        # Локальные координаты — в единицах H относительно якоря патча (§8).
        verts = [[(u * src_w - anchor[0]) / source_px_per_unit,
                  (v * src_h - anchor[1]) / source_px_per_unit] for (u, v) in grid]
        tris = []
        for j in range(rows):
            for i in range(cols):
                a = j * (cols + 1) + i
                tris.append([a, a + cols + 1, a + 1])
                tris.append([a + 1, a + cols + 1, a + cols + 2])
        # cage совпадает с mesh: привязка вершины — треугольник, где она вершина,
        # с весом 1 (координаты держим в одной системе, деформации — следующий шаг).
        bindings = []
        for k in range(len(grid)):
            tri = next(t for t in tris if k in t)
            w = [1.0 if t == k else 0.0 for t in tri]
            bindings.append([tri[0], tri[1], tri[2], w[0], w[1], w[2]])

        tx, ty = patch["target"]
        target_x = CANVAS / 2.0 + tx * head_w_px
        target_y = HEAD_TOP_Y + ty * head_h_px
        dx = (target_x - CANVAS / 2.0) / HEAD_UNIT_PX
        dy = (target_y - HEAD_TOP_Y) / HEAD_UNIT_PX
        keys = [{"yaw": y, "dx": round(dx, 6), "dy": round(dy, 6),
                 "sx": 1.0, "sy": 1.0, "rot": 0.0} for y in YAW_KEYS]

        authoring["patches"].append({
            "id": patch["name"],
            "semantic": patch["name"],
            # owner_group — из словаря рантайма (group_from_name): незнакомое
            # имя он трактует как 0 = «группа лица», которая КОПИТСЯ СУММОЙ.
            # Пересекающиеся слои там складываются аддитивно и кадр выгорает,
            # поэтому каждая деталь получает свою группу.
            "owner_group": GROUP_OF[patch["name"]],
            "mirror": patch["mirror"],
            "depth": patch["depth"],
            "clip_to": "face" if patch["name"] in ("eye_l", "eye_r", "iris_r", "iris_l",
                                                  "brows_r", "brows_l", "nose", "mouth") else None,
            "rect_padded": [ax0, ay0, ax1, ay1],
            "scale_px_per_unit": round(source_px_per_unit, 6),
            "anchor_px": [round(anchor[0], 3), round(anchor[1], 3)],
            "cage": {"cols": cols, "rows": rows, "verts": verts, "tris": tris},
            "mesh": {"cols": cols, "rows": rows, "verts": verts, "tris": tris,
                     "uv": uv, "bindings": bindings},
            "keys": keys,
            "state_gate": None,
        })

    # Один патч = одно кольцо (рантайм запрещает патч более чем в одном кольце,
    # SPEC §7 «одна деталь — один owner»). В срезе у кольца одна запись: это
    # вырожденный partition-of-unity, и вес обязан быть 1.0 — соответствующая
    # ветка добавлена в ring_weight() (src/real2d4.c).
    for entry in authoring["patches"]:
        authoring["rings"][entry["id"]] = {
            "closed": True, "fade": 8.0, "boundaries": [0.0],
            "entries": [{"patch": entry["id"], "mirror": False}]}

    OUT_AUTHORING.write_text(json.dumps(authoring, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"authoring: {OUT_AUTHORING}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
