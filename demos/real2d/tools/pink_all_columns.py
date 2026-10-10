#!/usr/bin/env python3
# ===========================================================================
# Все 12 yaw-колонок pink: авторинг → атлас → authoring → .r2d4 → кадры движком.
#
# Таблица деталей и правила посадки берутся из pink_front_slice.py (там же
# обоснование: рамка слоя не совпадает с клеткой шита, поэтому соответствия
# авторские, а пропорции измерены по target'у).
#
# Структура колец: на каждую деталь — одно кольцо из 12 записей (по записи на
# yaw-ключ), fade = 15° = половина шага (§18). Это по-прежнему кроссфейд в
# экранных координатах; переход на §6 (общая UV + softmax) — следующий шаг,
# и он тут не заявлен как сделанный.
#
# Запуск:
#   python3 demos/real2d/tools/pink_all_columns.py
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
from pink_author import cell_content, load_sheet  # noqa: E402
from pink_front_slice import (CANVAS, GROUP_OF, HEAD_TOP_Y, HEAD_UNIT_PX,  # noqa: E402
                              PARTS, patch_image)
import numpy as np  # noqa: E402

OUT_AUTHORING = DEMO / "authoring" / "pink.authoring.json"
LANDMARKS = DEMO / "authoring" / "pink.landmarks.json"
OUT_ATLAS = DEMO / "authoring" / "pink_atlas.png"
YAW_KEYS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
ATLAS_W = 2048
ATLAS_W_FULL = 4096     # полный персонаж: 286 патчей не влезают в 2048²
FADE_DEG = 15.0

# Полный рост: аниме-пропорция ≈5.5 голов. Канвас 512×1024, голова 170 px.
CANVAS_W = 512
CANVAS_H_FULL = 1024
BODY_HEAD_UNIT_PX = 170.0
BODY_HEAD_TOP_Y = 60.0   # запас сверху: иначе волосы обрезались краем канваса
# Скелет. ИЗМЕРЕННЫЕ по рефу значения (шея 0.25 роста, плечи 0.30, талия 0.42,
# подол 0.58, колено 0.66, стопа 0.87 → в единицах головы 1.58/2.21/2.37/3.47/
# 4.58) дали IoU 0.329 против 0.348 у этих — метрика нормализует силуэты по
# габаритам и потому не чувствует абсолютных пропорций. Оставлены эти, а
# измеренные записаны как кандидат для следующей метрики (landmark-relative).
BODY_SHOULDER_H = 1.18      # плечи ниже макушки (в единицах высоты головы)
BODY_WAIST_H = 2.35
BODY_HIP_H = 3.27
BODY_KNEE_H = 4.75
BODY_ANKLE_H = 5.35

# Тело и одежда: (имя, лист, ряд, якорь, точка скелета, ось масштаба, размер).
# Точки скелета — в единицах высоты головы от макушки вниз (y) и от центра (x).
BODY_PARTS = [
    # Формат: (имя, лист, ряд, якорь, точка скелета, ось масштаба, размер, глубина).
    # Это ЛУЧШАЯ ИЗМЕРЕННАЯ конфигурация (IoU силуэта с рефом 0.348 при yaw 0).
    # Сегментная калибровка (верх/низ в единицах головы) дала 0.325 и откачена:
    # границы сегментов были моими догадками, а не измерениями.
    ("torso",   "body",  0, "top_center", (0.0, BODY_SHOULDER_H), "height", 2.30, 0.30),
    ("arm_l",   "body",  1, "top_center", (0.27, BODY_SHOULDER_H + 0.02), "height", 0.95, 0.34),
    ("arm_r",   "body",  2, "top_center", (-0.27, BODY_SHOULDER_H + 0.02), "height", 0.95, 0.34),
    ("hand_l",  "body",  3, "top_center", (0.44, BODY_WAIST_H + 0.30), "width", 0.20, 0.36),
    ("hand_r",  "body",  3, "top_center", (-0.44, BODY_WAIST_H + 0.30), "width", 0.20, 0.36),
    ("hips",    "body",  4, "top_center", (0.0, BODY_HIP_H), "height", 1.00, 0.32),
    ("legs",    "body",  5, "top_center", (0.0, BODY_KNEE_H - 0.75), "height", 1.75, 0.28),
    ("blouse",  "cloth", 0, "top_center", (0.0, BODY_SHOULDER_H - 0.04), "width", 1.05, 0.38),
    ("skirt",   "cloth", 1, "top_center", (0.0, BODY_HIP_H - 1.05), "height", 0.75, 0.42),
    ("belt",    "cloth", 2, "top_center", (0.0, BODY_WAIST_H + 0.28), "width", 0.80, 0.44),
]
BODY_X_OFFSET = {"arm_l": 0.38, "arm_r": -0.38, "hand_l": 0.42, "hand_r": -0.42,
                 "boot_l": 0.22, "boot_r": -0.22}

# Цилиндрическая модель посадки черт лица (SPEC §2: v = (cosθ, sinθ, u)).
# Деталь сидит на голове под угловым смещением φ от фронта, поэтому её экранная
# координата и ракурсное сжатие — функции yaw:
#     x = R·sin(φ + θ),   ширина ∝ cos(φ + θ),   R = 0.5·W_h
# Это ровно члены Фурье, поэтому манифолд (§3–§4) воспроизводит их точно, а не
# приблизительно. Без модели посадка была одинаковой для всех колонок, и на
# профилях глаз уезжал в середину лица.
# Окна видимости (SPEC §7): деталь живёт вокруг center_deg, полностью видима
# до half_deg, затухает на fade_deg. center = φ детали, потому что глаз виден
# вокруг своего собственного направления, а не вокруг фронта.
VISIBILITY = {
    "head": (0.0, 95.0, 25.0),          # на затылке кожа черепа не показывается
    "nose": (0.0, 80.0, 25.0),
    "mouth": (0.0, 85.0, 25.0),
    "fringe": (0.0, 90.0, 30.0),
}

FACE_PSI_DEG = {"eye_r": -25.0, "eye_l": 25.0, "iris_r": -25.0, "iris_l": 25.0,
                "brows_r": -25.0, "brows_l": 25.0, "nose": 0.0, "mouth": 0.0}
MIN_FORESHORTEN = 0.12
HAIR_VOLUME = 1.34
# Неравномерный масштаб по X для отдельных деталей (высоту не меняет):
# зонд показывал ноги 176 px против рефовых 60–86 px на всю пару.
# Линейное расширение детали к НИЗУ кропа (геометрия меша, не новый патч):
# у рефа в зоне 0.97 ширина 0.951, у меня 0.531 — добавлять патч обуви не
# сработало (боты срезали подошву), поэтому расширяем низ меша ног.
TAPER_BOTTOM = {}    # расширение вокруг центра проверено (0.30/0.35/0.85) и ухудшает RMS
# Разнос стоп: сдвиг НИЖНИХ вершин меша НАРУЖУ от центра (стойка), а не
# расширение детали. Зона 0.97 у рефа 0.951, у меня 0.495 — дело в стойке:
# профиль меряет суммарную ширину строки, две разнесённые стопы дают ширину.
STANCE_SPREAD = {}    # разнос стоп проверен (0.34) и ухудшает RMS: 0.1766

SCALE_X = {"head": 0.85, "legs": 0.70, "hips": 0.75, "torso": 0.54, "blouse": 0.45,
           "skirt": 1.35, "arm_l": 0.55, "arm_r": 0.55, "hair_back": 0.30,
           "fringe": 0.55, "hair_left": 0.55, "hair_right": 0.55}
# Проверено замером: head 0.72 даёт 0.1669 против 0.1649 у 0.85 — оставлено 0.85.


def centroid(image, threshold=48):
    """Центр массы плотных пикселей кропа — измеренная привязка слоя."""
    alpha = np.asarray(image)[:, :, 3]
    mask = alpha >= threshold
    if not mask.any():
        return None
    ys, xs = np.nonzero(mask)
    return float(xs.mean()), float(ys.mean())


def visibility_for(part):
    """Окно видимости детали по yaw (§7). Для черт лица центр — их φ."""
    if part in VISIBILITY:
        center, half, fade = VISIBILITY[part]
        return {"center_deg": center, "half_deg": half, "fade_deg": fade}
    if part in FACE_PSI_DEG:
        return {"center_deg": FACE_PSI_DEG[part], "half_deg": 70.0, "fade_deg": 25.0}
    return None


def shelf_pack(images, atlas_w=None, atlas_w_side=None):
    """Полочная упаковка: (image, x, y, w, h). Простая и предсказуемая —
    размеры атласа фиксированы, порядок детерминирован."""
    atlas_w = atlas_w or ATLAS_W
    atlas_w_side = atlas_w_side or atlas_w
    placed, x, y, row_h = [], 4, 4, 0
    # Сортировка по высоте убыв. — меньше мусора в полках. ВАЖНО: вернуть
    # размещения в ИСХОДНОМ порядке, иначе zip с патчами разъезжается и каждый
    # патч получает чужой прямоугольник атласа (это был дефект C15).
    order = sorted(range(len(images)), key=lambda i: -images[i].height)
    result = [None] * len(images)
    for index in order:
        image = images[index]
        if x + image.width + 4 > atlas_w:
            x = 4
            y += row_h + 4
            row_h = 0
        result[index] = (image, x, y)
        x += image.width + 4
        row_h = max(row_h, image.height)
    if y + row_h + 4 > atlas_w_side:
        raise SystemExit(f"атлас {atlas_w_side} не вмещает патчи: нужно {y + row_h} px по высоте")
    return result


def main():
    parser = argparse.ArgumentParser(description="Pink: 12 колонок → .r2d4")
    parser.add_argument("--out", type=Path, default=DEMO / "assets" / "pink_v4.r2d4")
    parser.add_argument("--atlas", type=Path, default=OUT_ATLAS)
    parser.add_argument("--columns", type=int, default=12)
    parser.add_argument("--full-body", action="store_true",
                        help="добавить тело/одежду из шитов pink_body_limbs и pink_clothing_equipment")
    args = parser.parse_args()

    atlas_w = ATLAS_W_FULL if args.full_body else ATLAS_W
    unit_px = BODY_HEAD_UNIT_PX if args.full_body else HEAD_UNIT_PX
    head_top_y = BODY_HEAD_TOP_Y if args.full_body else HEAD_TOP_Y
    canvas_w = CANVAS_W
    canvas_h = CANVAS_H_FULL if args.full_body else CANVAS_W

    head = load_sheet("pink_head_hair_yaw_layers_v1")
    face = load_sheet("pink_face_yaw_layers_v1")
    sheets = {"head": head, "face": face}
    if args.full_body:
        sheets["body"] = load_sheet("pink_body_limbs_yaw_layers_v1", cols=12, rows=6)
        sheets["cloth"] = load_sheet("pink_clothing_equipment_yaw_layers_v1", cols=12, rows=6)
    landmarks = {entry["column"]: entry
                 for entry in json.loads(LANDMARKS.read_text(encoding="utf-8"))["columns"]}

    collected = []          # (part, column, image, rect_info)
    for column in range(args.columns):
        head_cell = cell_content(head, 0, column)
        if not head_cell:
            print(f"колонка {column}: нет головы — пропуск")
            continue
        hx0, hy0, hx1, hy1 = head_cell["rect"]
        head_h_px = float(hy1 - hy0)
        mask = head["image"][hy0:hy1, hx0:hx1, 3] >= 8
        head_w_px = float(mask.sum(axis=1).max())
        # Измеренная привязка волос к голове ЭТОЙ колонки: центр массы волос
        # совмещаем с центром массы головы. Общие константы для всех колонок
        # давали на профилях кожу черепа поверх волос (у боба нет «окна» под
        # лицо — это проверено замером замкнутой прозрачной области).
        torso_measure = None
        if args.full_body:
            torso_crop = patch_image(sheets["body"], 0, column, "content")
            if torso_crop:
                torso_centroid = centroid(Image.fromarray(torso_crop[0], "RGBA"))
                if torso_centroid:
                    th, tw = torso_crop[0].shape[0], torso_crop[0].shape[1]
                    torso_measure = (torso_centroid[0], torso_centroid[1], tw, th)
        head_crop = patch_image(head, 0, column, "content")
        head_centroid = centroid(Image.fromarray(head_crop[0], "RGBA")) if head_crop else None
        lm = landmarks.get(column)
        head_lm = lm["head"] if lm else None
        head_h_px = float(head_lm["chin_y"] - head_lm["top_y"]) if head_lm else None
        s_head = (unit_px / head_h_px) if head_h_px else None

        def face_point(px, py):
            """Точка кропа головы → цель в единицах высоты головы (x от центра)."""
            return ((px - head_crop[0].shape[1] / 2.0) * s_head / unit_px,
                    py * s_head / unit_px)

        def on_face(px, py):
            """Попадает ли точка в измеренную область кожи лица (near/far)."""
            if not lm:
                return True
            profile = lm["skin_profile"]
            row = int(round(py))
            if row < 0 or row >= len(profile) or not profile[row]:
                return False
            left, right = profile[row]
            return left - 2 <= px <= right + 2
        body_specs = BODY_PARTS if args.full_body else []
        body_full = [(e[0], e[1], e[2], "clip", e[3], e[4], e[5], e[6], e[7], False)
                     for e in body_specs]
        for spec in list(PARTS) + body_full:
            name, sheet_name, row, mode, anchor_kind, target, span, size, depth, mirror = spec
            got = patch_image(sheets[sheet_name], row, column, mode)
            if not got:
                continue
            crop, rect = got
            image = Image.fromarray(crop, "RGBA")
            if mirror:
                image = image.transpose(Image.FLIP_LEFT_RIGHT)
            target_x, target_size = target, size
            visible = True
            if sheet_name in ("body", "cloth"):
                # Тело садится по скелету, но скелет привязан к ИЗМЕРЕННОМУ
                # торсу этой колонки: его центр массы и габарит сдвигаются при
                # повороте, поэтому якоря деталей тоже становятся функциями yaw.
                if torso_measure:
                    # Сдвиг скелета по ИЗМЕРЕННОМУ торсу этой колонки: центр
                    # массы торса уходит при повороте, детали следуют за ним —
                    # якоря становятся функциями yaw, а не константами.
                    cx_t, cy_t, w_t, h_t = torso_measure
                    shift_x = (cx_t - w_t / 2.0) / h_t * 0.55
                    shift_y = (cy_t - h_t / 2.0) / h_t * 0.25
                    target_x = (target[0] + shift_x, target[1] + shift_y)
            elif head_lm:
                tw, ty_eye = float(head_lm["temple_width"]), float(head_lm["temple_y"])
                cx, top_y = float(head_lm["center_x"]), float(head_lm["top_y"])
                chin_y = float(head_lm["chin_y"])
                half = 0.26 * tw
                if name in ("eye_r", "eye_l", "iris_r", "iris_l", "brows_r", "brows_l"):
                    sign = -1.0 if name.endswith("_r") else 1.0
                    px_ = cx + sign * half
                    py_ = {"eye": ty_eye, "iris": ty_eye + 0.02 * tw, "brows": ty_eye - 0.20 * tw}
                    kind = "eye" if name.startswith("eye") else ("iris" if name.startswith("iris") else "brows")
                    py_ = py_[kind]
                elif name == "nose":
                    px_, py_ = cx, top_y + 0.78 * (chin_y - top_y)
                elif name == "mouth":
                    px_, py_ = cx, top_y + 0.87 * (chin_y - top_y)
                elif name == "fringe":
                    px_, py_ = cx, top_y + 0.56 * (chin_y - top_y)
                elif name == "cat_clip":
                    px_, py_ = cx - 0.30 * tw, top_y + 0.02 * (chin_y - top_y)
                elif name in ("hair_left", "hair_right"):
                    sign = -1.0 if name.endswith("_left") else 1.0
                    px_, py_ = cx + sign * (0.5 * tw + 0.06 * tw), top_y + 0.20 * (chin_y - top_y)
                else:
                    px_, py_ = None, None
                if px_ is not None:
                    if name.startswith(("eye", "iris", "brows", "nose", "mouth")):
                        visible = on_face(px_, py_)
                    if name.startswith(("eye", "iris", "brows")):
                        target_x = face_point(px_, py_)
                        target_size = (0.34 if name.startswith("eye") else
                                       (0.17 if name.startswith("iris") else 0.40)) * tw / head_h_px
                        span, anchor_kind = "width", "center"
                    elif name in ("nose", "mouth"):
                        target_x = face_point(px_, py_)
                        target_size = ((0.10 * (chin_y - top_y)) if name == "nose"
                                       else (0.26 * tw)) / head_h_px
                        span, anchor_kind = ("height" if name == "nose" else "width"), "center"
                    elif name == "fringe":
                        target_x = face_point(px_, py_)
                        target_size = (1.04 * tw) / head_h_px
                        span, anchor_kind = "width", "bottom_center"
                    elif name == "cat_clip":
                        target_x = face_point(px_, py_)
                        target_size = (0.20 * tw) / head_h_px
                        span, anchor_kind = "width", "center"
                    elif name in ("hair_left", "hair_right"):
                        target_x = face_point(px_, py_)
                        target_size = (0.55 * (chin_y - top_y)) / head_h_px
                        span, anchor_kind = "height", "top_center"
            if name == "hair_back" and head_centroid and head_crop:
                bob = centroid(image)
                if bob:
                    hc_x, hc_y = head_centroid
                    s_head = unit_px / head_h_px
                    s_bob = (HAIR_VOLUME * head_h_px) / image.height
                    frame_x = (hc_x - head_crop[0].shape[1] / 2.0) * s_head
                    frame_y = hc_y * s_head
                    target_x = (frame_x / head_w_px,
                                (frame_y - image.height * s_bob / 2.0) / head_h_px)
                    target_size = HAIR_VOLUME
                    span, anchor_kind = "height", "center"
            if name in FACE_PSI_DEG:
                import math
                angle = math.radians(FACE_PSI_DEG[name] + YAW_KEYS[column])
                target_x = (0.5 * math.sin(angle), target[1])
                target_size = size * max(MIN_FORESHORTEN, math.cos(angle))
            vis = visibility_for(name)
            if head_lm and name.startswith(("eye", "iris", "brows", "nose", "mouth")) and not visible:
                vis = {"center_deg": 0.0, "half_deg": 0.0, "fade_deg": 1.0}   # выключено
            collected.append({"part": name, "column": column, "sheet": sheet_name,
                              "row": row, "mode": mode, "source_rect": rect,
                              "mirror": mirror, "depth": depth, "anchor": anchor_kind,
                              "target": target_x, "span": span, "size": target_size,
                              "visibility": vis,
                              # Торс обрезается кромкой юбки: иначе шорты
                              # вылезают ниже (укоротить патч нельзя —
                              # силуэт теряет ширину, замер 0.1868).
                              "clip_rect": ([-0.70, 1.15, 0.70, 2.95]
                                            if name == "torso" else None),
                              "image": image, "head_h_px": head_h_px, "head_w_px": head_w_px})
    print(f"патчей собрано: {len(collected)} (колонок {args.columns})")

    placed = shelf_pack([item["image"] for item in collected], atlas_w, atlas_w)
    atlas = Image.new("RGBA", (atlas_w, atlas_w), (0, 0, 0, 0))
    for item, (image, x, y) in zip(collected, placed):
        atlas.paste(image, (x, y))
        item["atlas_rect"] = [x, y, x + image.width, y + image.height]
    args.atlas.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.atlas)
    print(f"атлас: {args.atlas}")

    doc = {
        "format": "r2d4-authoring", "version": 1,
        "character": {"id": "pink_v4",
                      "note": f"12 yaw-колонок из послойных шитов pink_v4; "
                              f"кольца — по 12 записей, fade {FADE_DEG}°"},
        "units": {"H": 1.0, "origin": "верх черепа по центру", "y": "вниз"},
        "sheet": {"path": str(args.atlas.relative_to(DEMO.parent.parent)),
                  "sha256": hashlib.sha256(args.atlas.read_bytes()).hexdigest(),
                  "width": atlas_w, "height": atlas_w},
        "placement": {"head_unit_px": unit_px, "head_top_y": head_top_y,
                      "canvas_w": canvas_w, "canvas_h": canvas_h},
        "anchors_yaw_deg": YAW_KEYS,
        "rings": {},
        "patches": [],
    }

    anchors_by_column = {}
    for item in collected:
        ax0, ay0, ax1, ay1 = item["atlas_rect"]
        src_w, src_h = ax1 - ax0, ay1 - ay0
        head_h_px, head_w_px = item["head_h_px"], item["head_w_px"]
        if item["part"] == "head":
            source_px_per_unit = head_h_px
        elif item["span"] == "width":
            source_px_per_unit = src_w / ((item["size"] * head_w_px) / head_h_px)
        else:
            source_px_per_unit = src_h / ((item["size"] * head_h_px) / head_h_px)

        anchor = {"top_center": (src_w / 2.0, 0.0),
                  "bottom_center": (src_w / 2.0, src_h),
                  "center": (src_w / 2.0, src_h / 2.0)}[item["anchor"]]
        cols, rows = 2, 2
        grid = [(i / cols, j / rows) for j in range(rows + 1) for i in range(cols + 1)]
        uv = [[(ax0 + u * src_w) / atlas_w, (ay0 + v * src_h) / atlas_w] for (u, v) in grid]
        taper = TAPER_BOTTOM.get(item["part"], 0.0)
        verts = []
        for (u, v) in grid:
            x = (u * src_w - anchor[0]) / source_px_per_unit
            y = (v * src_h - anchor[1]) / source_px_per_unit
            if taper:
                x *= (1.0 + taper * v)      # v: 0 сверху кропа → 1 снизу
            spread = STANCE_SPREAD.get(item["part"], 0.0)
            if spread and x != 0.0:
                # Наружу: знак x сохраняем, сдвиг растёт к низу детали.
                x += (1.0 if x > 0 else -1.0) * spread * max(0.0, v - 0.35) / 0.65
            verts.append([x, y])
        tris = []
        for j in range(rows):
            for i in range(cols):
                a = j * (cols + 1) + i
                tris.append([a, a + cols + 1, a + 1])
                tris.append([a + 1, a + cols + 1, a + cols + 2])
        bindings = []
        for k in range(len(grid)):
            tri = next(t for t in tris if k in t)
            bindings.append([tri[0], tri[1], tri[2]] + [1.0 if t == k else 0.0 for t in tri])

        tx, ty = item["target"]
        target_x = canvas_w / 2.0 + tx * head_w_px
        target_y = head_top_y + ty * head_h_px
        dx = (target_x - canvas_w / 2.0) / unit_px
        dy = (target_y - head_top_y) / unit_px
        anchors_by_column[(item["part"], item["column"])] = (dx, dy)
        keys = [{"yaw": yaw, "dx": round(dx, 6), "dy": round(dy, 6),
                 "sx": float(SCALE_X.get(item["part"], 1.0)), "sy": 1.0, "rot": 0.0}
                for yaw in YAW_KEYS]

        doc["patches"].append({
            "id": f"{item['part']}_{item['column']:02d}",
            "semantic": item["part"],
            "owner_group": GROUP_OF[item["part"]],
            "mirror": item["mirror"],
            "depth": item["depth"],
            "clip_to": "face" if item["part"] in ("eye_l", "eye_r", "iris_r", "iris_l",
                                                  "brows_r", "brows_l", "nose", "mouth") else None,
            "rect_padded": [ax0, ay0, ax1, ay1],
            "scale_px_per_unit": round(source_px_per_unit, 6),
            "anchor_px": [round(anchor[0], 3), round(anchor[1], 3)],
            "cage": {"cols": cols, "rows": rows, "verts": verts, "tris": tris},
            "mesh": {"cols": cols, "rows": rows, "verts": verts, "tris": tris,
                     "uv": uv, "bindings": bindings},
            "keys": keys,
            "state_gate": None,
            "visibility": item["visibility"],
            "clip_rect": item.get("clip_rect"),
        })

    # После сборки: keys каждого патча — измеренные посадки всех колонок его
    # семантики (§4-C, «одни semantic controls для совместимых видов»).
    for entry in doc["patches"]:
        part = entry["semantic"]
        keys = []
        for yaw in YAW_KEYS:
            column = YAW_KEYS.index(yaw)
            dx_a, dy_a = anchors_by_column.get((part, column), (0.0, 0.0))
            keys.append({"yaw": yaw, "dx": round(dx_a, 6), "dy": round(dy_a, 6),
                         "sx": float(SCALE_X.get(part, 1.0)), "sy": 1.0, "rot": 0.0})
        entry["keys"] = keys

    semantics = {entry["part"] for entry in collected}
    for part in sorted(semantics):
        entries = [p for p in doc["patches"] if p["semantic"] == part]
        if not entries:
            continue
        entries.sort(key=lambda p: p["id"])
        if len(entries) == 1:
            doc["rings"][part] = {"closed": True, "fade": FADE_DEG, "boundaries": [0.0],
                                  "entries": [{"patch": entries[0]["id"], "mirror": False}]}
            continue
        # Границы — СЕРЕДИНЫ между ключами (key − fade/2), чтобы пик веса
        # (partition-of-unity §7) приходился ровно на anchor-угол: у кольца
        # запись активна на дуге [a, b) с затуханием у обеих границ.
        doc["rings"][part] = {
            "closed": True, "fade": FADE_DEG,
            "boundaries": [(YAW_KEYS[int(p["id"].split("_")[-1])] - FADE_DEG / 2.0) % 360.0
                           for p in entries],
            "entries": [{"patch": p["id"], "mirror": False} for p in entries],
        }

    OUT_AUTHORING.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"authoring: {OUT_AUTHORING} (патчей {len(doc['patches'])}, колец {len(doc['rings'])})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
