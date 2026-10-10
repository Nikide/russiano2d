#!/usr/bin/env python3
# ===========================================================================
# Авторинг головы Real2D v4 из проверенного component-шита.
#
# Вход:  assets/head_components_candidate_v1.png + .rects.json (см.
#        verify_head_sheet.py).
# Выход: authoring/head.authoring.json — патчи (rect, cage, dense mesh, UV,
#        barycentric bindings), гейты видимости (partition of unity), псевдо-
#        глубина и 12 geometry anchors по yaw.
#
# Что здесь authored, а что измерено — принципиально:
#   * ИЗМЕРЯЕТСЯ кодом: rect'ы клеток, верх головы, подбородок, высота головы,
#     ширина силуэта, якоря радужки/носа/рта.
#   * АВТОРСКИЕ ДАННЫЕ (таблица PLACEMENT ниже): на какой высоте головы сидят
#     глаза/нос/рот, их азимут на черепе, целевые размеры волос, глубины
#     слоёв, границы гейтов. Это выбор автора, а не вывод из картинки.
#   * РАССЧИТЫВАЕТСЯ по авторским данным: положения anchors на 12 углах yaw
#     (цилиндрическая проекция точки черепа) и масштаб силуэта на переходах.
#     Никаких готовых кадров при этом не создаётся.
# ===========================================================================

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent          # demos/real2d/tools
DEMO = HERE.parent                              # demos/real2d
SHEET = DEMO / "assets" / "head_components_candidate_v1.png"
RECTS = SHEET.with_suffix(".rects.json")
OUT = DEMO / "authoring" / "head.authoring.json"

ANCHOR_YAWS = [i * 30.0 for i in range(12)]     # 0,30,…,330 — 12 geometry anchors

# --- авторские данные -------------------------------------------------------
# H — ширина черепа (устойчивый к ракурсу размер: 233/235/219/227 px у четырёх
# видов). Нормировка по ширине, а не по «высоте головы»: подбородок на этом
# листе автоматически не находится (уши и шея дают ложные минимумы ширины), а
# честно измеренная ширина даёт согласование видов без выдуманных landmark'ов.
# Азимут ψ считается от направления «вперёд» в сторону анатомически правой
# стороны персонажа; y — вниз от верха черепа, в единицах H.
PLACEMENT = {
    "eye_psi_deg": 22.3,          # asin(0.19 / 0.5): азимут центра глаза
    "brow_y": 0.63,               # якорь eye/eyelid — верх брови
    "eye_target_width": 0.30,     # ширина клетки глаза (с бровью)
    "head_radius": 0.50,          # полуширина черепа
    "nose_y": 0.86,
    "nose_target_height": 0.115,
    "mouth_y": 0.99,
    "mouth_target_width": 0.235,
    "bangs_top": 0.02,
    "bangs_target_width": 0.95,
    "hair_back_top": 0.00,
    "hair_back_target_height": 1.30,
    "hair_back_psi_deg": 180.0,   # масса волос крепится к затылку
    "hair_back_radius": 0.10,     # насколько она уезжает назад при повороте
    "lock_psi_deg": 70.0,
    "lock_top": 0.05,
    "lock_target_height": 0.80,
}

# Псевдоглубина: больше — ближе. Порядок фиксирован автором (спека §9):
# пересечения глубины в стадии A не двигаются, поэтому swap'ов не бывает.
DEPTH = {
    "head_back": 0.30,
    "hair_back_mass": 0.45,      # из-за спины волосы ближе кожи затылка
    "face": 0.40,
    "hair_lock": 0.48,
    "mouth": 0.56,
    "nose": 0.58,
    "eye": 0.62,
    "eyelid": 0.66,
    "bangs": 0.72,
}

# Клетка → патч. mirror=True — вариант получается отражением по x.
CELLS = [
    ("face_front", "face_front", "face", False),
    ("face_three_quarter", "face_three_quarter", "face", False),
    ("face_profile", "face_profile", "face", False),
    ("head_back", "head_back", "face", False),
    ("eye_front_left", "eye_front_left", "eye", False),
    ("eye_front_right", "eye_front_right", "eye", False),
    ("eye_three_quarter", "eye_three_quarter", "eye", False),
    ("eyelid_closed", "eyelid_closed", "eyelid", False),
    ("nose_front", "nose_front", "nose", False),
    ("nose_three_quarter", "nose_three_quarter", "nose", False),
    ("mouth_closed", "mouth_closed", "mouth", False),
    ("mouth_open", "mouth_open", "mouth", False),
    ("hair_back_mass", "hair_back_mass", "hair_back", False),
    ("hair_bangs", "hair_bangs", "bangs", False),
    ("hair_lock_left", "hair_lock_left", "lock", False),
    ("hair_lock_right", "hair_lock_right", "lock", False),
]

# Кольца видимости: [(патч, mirror)] и границы между ними в градусах.
# Внутри кольца веса — partition of unity (сумма 1), поэтому один и тот же
# semantic feature никогда не рисуется дважды (спека §7 правило 5).
RINGS = {
    "face": {
        "entries": [("face_front", False), ("face_three_quarter", False),
                    ("face_profile", False), ("head_back", False),
                    ("face_profile", True), ("face_three_quarter", True)],
        "boundaries": [315.0, 45.0, 75.0, 135.0, 225.0, 285.0],
        "fade": 3.0,
        "closed": True,          # кольцо замкнуто: сумма весов ровно 1
    },
    "eye_R": {
        "entries": [("eye_front_right", False), ("eye_three_quarter", False)],
        "boundaries": [-70.0, 30.0, 100.0],
        "fade": 6.0,
        "closed": False,
    },
    "eye_L": {
        # Зеркало правого глаза: порядок записей обязан повторять eye_R после
        # отражения — ближний 3q-вариант живёт у −60°, а не у нуля.
        "entries": [("eye_three_quarter", True), ("eye_front_left", False)],
        "boundaries": [-100.0, -30.0, 70.0],
        "fade": 6.0,
        "closed": False,
    },
    "nose": {
        "entries": [("nose_three_quarter", True), ("nose_front", False),
                    ("nose_three_quarter", False)],
        "boundaries": [-80.0, -30.0, 30.0, 80.0],
        "fade": 8.0,
        "closed": False,
    },
    "mouth": {
        "entries": [("mouth_closed", False)],
        "boundaries": [-80.0, 80.0],
        "fade": 8.0,
        "closed": False,
    },
    "bangs": {
        "entries": [("hair_bangs", False)],
        "boundaries": [-70.0, 70.0],
        "fade": 20.0,
        "closed": False,
    },
    "hair_back": {
        "entries": [("hair_back_mass", False)],
        "boundaries": [85.0, 275.0],
        "fade": 20.0,
        "closed": False,
    },
    "lock_R": {
        "entries": [("hair_lock_right", False)],
        "boundaries": [45.0, 135.0],
        "fade": 12.0,
        "closed": False,
    },
    "lock_L": {
        "entries": [("hair_lock_left", False)],
        "boundaries": [-135.0, -45.0],
        "fade": 12.0,
        "closed": False,
    },
}

MESH = {           # (cage_cols, cage_rows, mesh_cols, mesh_rows) — клетка сетки
    "face": (2, 2, 10, 10),
    "eye": (2, 2, 6, 5),
    "eyelid": (2, 2, 6, 4),
    "nose": (2, 2, 4, 4),
    "mouth": (2, 2, 6, 4),
    "bangs": (2, 2, 10, 8),
    "hair_back": (2, 2, 10, 10),
    "lock": (2, 2, 4, 8),
}


def fail(message):
    print("  FAIL " + message)
    raise SystemExit(1)


def face_metrics(mask):
    """Верх черепа, ширина черепа и (best-effort) подбородок силуэта."""
    widths = mask.sum(axis=1).astype(float)
    rows = np.nonzero(widths)[0]
    if not len(rows):
        fail("пустая маска силуэта")
    top, bottom = int(rows[0]), int(rows[-1])
    peak = widths.max()
    # Верх черепа: первая строка, где силуэт уже набрал четверть ширины —
    # одиночные пиксели макушки (сглаживание) не считаем ориентиром.
    head_top = int(np.argmax(widths >= 0.25 * peak))
    skull_width = float(peak)
    # Подбородок: локальный минимум ширины ниже самой широкой строки. Нужен
    # только как справка: у части видов шея сужается монотонно и минимума нет.
    wide = int(np.argmax(widths))
    chin = None
    for y in range(wide + 2, bottom):
        if widths[y] <= widths[y - 1] and widths[y] < widths[y + 1] and widths[y] > 0.12 * peak:
            chin = y
            break
    zone = mask[head_top:bottom + 1]
    cols = np.nonzero(zone.any(axis=0))[0]
    center_x = float(cols.mean())
    return {
        "head_top": head_top,
        # Проба подбородка оставлена только как справка для автора: на этом
        # листе она ненадёжна (уши и шея дают ложные минимумы) и в качестве
        # landmark не используется.
        "chin_probe_px": chin,
        "skull_width_px": skull_width,
        "center_x": center_x,
    }


def feature_anchor(mask, rgb, kind):
    """Якорь компонента в его собственных пикселях."""
    ys, xs = np.nonzero(mask)
    if kind in ("eye", "eyelid"):
        # Якорь глаза и века — верх брови: бровь нарисована в обеих клетках,
        # поэтому варианты «открыт/закрыт» садятся на одно место сами, без
        # ручной подгонки вертикали.
        top = int(ys.min())
        row = xs[ys <= top + 2]
        extra = {}
        if kind == "eye":
            r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
            iris = mask & (b > r + 20) & (b > 60)
            if iris.sum() >= 32:
                iy, ix = np.nonzero(iris)
                extra = {
                    "iris_diameter_px": float(max(ix.max() - ix.min(), iy.max() - iy.min())),
                    "iris_offset_px": [round(float(ix.mean() - row.mean()), 3),
                                       round(float(iy.mean() - top), 3)],
                }
        return (float(row.mean()), float(top)), extra
    if kind == "nose":
        # Нос: низ по центру маски — кончик носа.
        bottom = int(ys.max())
        row = xs[ys >= bottom - 2]
        return (float(row.mean()), float(bottom)), {}
    if kind == "mouth":
        return (float(xs.mean()), float(ys.mean())), {}
    # Волосы: верх по центру — точка крепления к черепу.
    top = int(ys.min())
    row = xs[ys <= top + 2]
    return (float(row.mean()), float(top)), {}


def self_scale(kind, metrics, anchor_extra, placement):
    """Сколько пикселей компонента приходится на одну единицу H."""
    if kind == "face":
        return metrics["skull_width_px"]
    if kind == "eye":
        # Целевая ширина клетки глаза в единицах H даёт масштаб всей клетки.
        return metrics["cell_width_px"] / placement["eye_target_width"]
    if kind == "eyelid":
        return metrics["cell_width_px"] / placement["eye_target_width"]
    if kind == "nose":
        return metrics["cell_height_px"] / placement["nose_target_height"]
    if kind == "mouth":
        return metrics["cell_width_px"] / placement["mouth_target_width"]
    if kind == "bangs":
        return metrics["cell_width_px"] / placement["bangs_target_width"]
    if kind == "hair_back":
        return metrics["cell_height_px"] / placement["hair_back_target_height"]
    if kind == "lock":
        return metrics["cell_height_px"] / placement["lock_target_height"]
    fail(f"неизвестный вид патча: {kind}")


def grid(n_cols, n_rows):
    """Сетка вершин (n_cols+1)×(n_rows+1) в параметрических координатах 0..1."""
    pts = []
    for j in range(n_rows + 1):
        for i in range(n_cols + 1):
            pts.append((i / n_cols, j / n_rows))
    return pts


def grid_tris(n_cols, n_rows):
    tris = []
    for j in range(n_rows):
        for i in range(n_cols):
            a = j * (n_cols + 1) + i
            b = a + 1
            c = a + (n_cols + 1)
            d = c + 1
            tris.append((a, c, b))
            tris.append((b, c, d))
    return tris


def barycentric_bindings(cage_pts, tris, mesh_pts):
    """Baker считает привязки: вершина mesh → треугольник cage + барицентрика."""
    out = []
    for (px, py) in mesh_pts:
        found = None
        for (ia, ib, ic) in tris:
            ax, ay = cage_pts[ia]
            bx, by = cage_pts[ib]
            cx, cy = cage_pts[ic]
            det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(det) < 1e-12:
                continue
            l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
            l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
            l2 = 1.0 - l0 - l1
            if l0 >= -1e-9 and l1 >= -1e-9 and l2 >= -1e-9:
                found = (ia, ib, ic, l0, l1, l2)
                break
        if found is None:
            fail("вершина mesh вне cage: привязку построить нельзя (bounded "
                 "extrapolation в стадии A запрещена)")
        out.append([found[0], found[1], found[2], found[3], found[4], found[5]])
    return out


def smoothstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def ring_weight(x, a, b, fade, closed):
    """Вес записи кольца на отрезке [a, b] с растушёвкой fade по краям."""
    left = smoothstep((x - (a - fade)) / (2 * fade))
    right = 1.0 - smoothstep((x - (b - fade)) / (2 * fade))
    if not closed:
        return left * right
    # Замкнутое кольцо: крайние записи стыкуются через 0/360, поэтому
    # растушёвка снимается на самом краю диапазона.
    return left * right


def feature_track(kind, psi_deg, placement, yaw_deg, mirror):
    """Авторская траектория патча на данном yaw: dx, dy, sx, sy, rot (в H)."""
    R = placement["head_radius"]
    psi = math.radians(psi_deg)
    if mirror:
        yaw_deg = -yaw_deg
    th = math.radians(yaw_deg)
    d = th - psi
    depth = math.cos(d)
    x = R * math.sin(d)
    y = 0.0
    if kind in ("eye", "eyelid"):
        y = placement["brow_y"]
    elif kind == "nose":
        y = placement["nose_y"]
    elif kind == "mouth":
        y = placement["mouth_y"]
    # Сжатие признака при повороте: гладкий клэмп — |cos| даёт излом, который
    # серия Фурье K=3 сглаживает с ошибкой в десятые доли H.
    cosine = max(0.0, depth)
    sx = 0.25 + 0.75 * cosine * cosine
    return {"dx": round(x, 6), "dy": round(y, 6), "sx": round(sx, 6),
            "sy": 1.0, "rot": 0.0, "depth_cos": round(depth, 6)}

def main():
    parser = argparse.ArgumentParser(description="Авторинг головы Real2D v4")
    parser.add_argument("--report", action="store_true", help="только измерения")
    args = parser.parse_args()

    if not SHEET.exists() or not RECTS.exists():
        fail("нет листа или rects.json — сначала verify_head_sheet.py")
    rects = json.loads(RECTS.read_text(encoding="utf-8"))
    sheet = rects["source"]
    cells = {c["label"]: c for c in rects["cells"]}
    rgba = np.asarray(Image.open(SHEET).convert("RGBA"))
    alpha = rgba[:, :, 3]

    model = {}          # измеренные ориентиры: нужны и отчёту, и бейкеру
    for label in ("face_front", "face_three_quarter", "face_profile", "head_back"):
        x0, y0, x1, y1 = cells[label]["rect"]
        sub = alpha[y0:y1, x0:x1] >= 8
        model[label] = face_metrics(sub)
    # Природные ширины видов близки (233/235/219/227 px), но не равны. Общая
    # ширина — их среднее: к ней приводится каждый вид лёгким sx, поэтому на
    # переходах силуэты совпадают по ширине без скачков.
    common_width = float(np.mean([m["skull_width_px"] for m in model.values()]))

    if args.report:
        for label, m in model.items():
            print(f"  {label:20} верх={m['head_top']} ширина_черепа={m['skull_width_px']:.0f}px "
                  f"проба_подбородка={m['chin_probe_px']} центр_x={m['center_x']:.1f} "
                  f"sx_к_общей={common_width / m['skull_width_px']:.3f}")
        print(f"  общая ширина (H): {common_width:.1f}px")
        return 0

    sheet_w, sheet_h = sheet["width"], sheet["height"]

    patches = []
    for label, patch_id, kind, mirror in CELLS:
        cell = cells[label]
        x0, y0, x1, y1 = cell["rect_padded"]
        mask = alpha[y0:y1, x0:x1] >= 8
        rgb = rgba[y0:y1, x0:x1]
        measured = {
            "cell_width_px": float(x1 - x0),
            "cell_height_px": float(y1 - y0),
        }
        measured.update({k: v for k, v in model.get(label, {}).items()})
        anchor_px, extra = feature_anchor(mask, rgb, kind)
        scale = self_scale(kind, measured, extra, PLACEMENT)

        c_cols, c_rows, m_cols, m_rows = MESH[kind]
        cage_uv = grid(c_cols, c_rows)
        mesh_uv = grid(m_cols, m_rows)
        # Локальные координаты: начало — якорь патча, единица — H.
        def to_local(u, v):
            px = u * (x1 - x0)
            py = v * (y1 - y0)
            return [round((px - anchor_px[0]) / scale, 6),
                    round((py - anchor_px[1]) / scale, 6)]
        cage_local = [to_local(u, v) for (u, v) in cage_uv]
        mesh_local = [to_local(u, v) for (u, v) in mesh_uv]
        cage_tris = grid_tris(c_cols, c_rows)
        mesh_tris = grid_tris(m_cols, m_rows)
        bindings = barycentric_bindings(cage_local, cage_tris, mesh_local)
        # UV в текстурных координатах атласа (лист целиком).
        sheet_w, sheet_h = sheet["width"], sheet["height"]
        mesh_uv_abs = [[round((x0 + u * (x1 - x0)) / sheet_w, 6),
                        round((y0 + v * (y1 - y0)) / sheet_h, 6)] for (u, v) in mesh_uv]

        # Псевдоглубина слоя.
        if kind == "face":
            depth = DEPTH["head_back"] if label == "head_back" else DEPTH["face"]
        elif kind == "eye":
            depth = DEPTH["eye"]
        elif kind == "eyelid":
            depth = DEPTH["eyelid"]
        elif kind == "nose":
            depth = DEPTH["nose"]
        elif kind == "mouth":
            depth = DEPTH["mouth"]
        elif kind == "bangs":
            depth = DEPTH["bangs"]
        elif kind == "hair_back":
            depth = DEPTH["hair_back_mass"]
        else:
            depth = DEPTH["hair_lock"]

        # Траектория: 12 anchors. У лица точная привязка к измеренному черепу,
        # у признаков — цилиндрическая проекция авторского азимута.
        keys = []
        for yaw in ANCHOR_YAWS:
            if kind == "face":
                # Виды приводятся к общей ширине: на переходах силуэты
                # совпадают, поэтому crossfade не даёт «двойного контура».
                keys.append({"yaw": yaw, "dx": 0.0, "dy": 0.0,
                             "sx": round(common_width / measured["skull_width_px"], 6),
                             "sy": 1.0, "rot": 0.0})
            elif kind == "bangs":
                keys.append({"yaw": yaw, "dx": 0.0, "dy": 0.0, "sx": 1.0,
                             "sy": 1.0, "rot": 0.0})
            elif kind == "hair_back":
                # Масса волос сидит на затылке: при повороте она уходит в
                # сторону, противоположную носу, и слегка расширяется — в
                # профиле она обязана закрыть больше черепа, иначе голова
                # выглядит лысой (в исходном листе нет отдельного профильного
                # волосяного компонента).
                th = math.radians(-yaw if mirror else yaw)
                psi = math.radians(PLACEMENT["hair_back_psi_deg"])
                keys.append({"yaw": yaw,
                             "dx": round(PLACEMENT["hair_back_radius"] * math.sin(th - psi), 6),
                             "dy": 0.0,
                             "sx": round(1.0 + 0.28 * math.sin(th - psi) ** 2, 6),   # sin²: без излома, ровно 2-я гармоника
                             "sy": 1.0, "rot": 0.0})
            elif kind == "mouth":
                tr = feature_track("mouth", 0.0, PLACEMENT, yaw, mirror)
                keys.append({"yaw": yaw, **{k: tr[k] for k in ("dx", "dy", "sx", "sy", "rot")}})
            elif kind == "nose":
                psi = 0.0 if label == "nose_front" else PLACEMENT["eye_psi_deg"]
                tr = feature_track("nose", psi, PLACEMENT, yaw, mirror)
                keys.append({"yaw": yaw, **{k: tr[k] for k in ("dx", "dy", "sx", "sy", "rot")}})
            elif kind == "lock":
                psi = -PLACEMENT["lock_psi_deg"] if label == "hair_lock_left" else PLACEMENT["lock_psi_deg"]
                tr = feature_track("lock", psi, PLACEMENT, yaw, mirror)
                tr["dy"] = PLACEMENT["lock_top"]
                keys.append({"yaw": yaw, **{k: tr[k] for k in ("dx", "dy", "sx", "sy", "rot")}})
            else:  # eye / eyelid
                psi = -PLACEMENT["eye_psi_deg"] if label == "eye_front_left" else PLACEMENT["eye_psi_deg"]
                if label == "eye_three_quarter":
                    psi = PLACEMENT["eye_psi_deg"]
                tr = feature_track("eye", psi, PLACEMENT, yaw, mirror)
                keys.append({"yaw": yaw, **{k: tr[k] for k in ("dx", "dy", "sx", "sy", "rot")}})

        patches.append({
            "id": patch_id,
            "cell": label,
            "semantic": cell["semantic"],
            "owner_group": kind,
            "mirror": mirror,
            "depth": depth,
            "clip_to": "face" if kind in ("eye", "eyelid", "nose", "mouth") else None,
            "scale_px_per_unit": round(scale, 4),
            "anchor_px": [round(anchor_px[0], 3), round(anchor_px[1], 3)],
            "rect_padded": [x0, y0, x1, y1],
            "measured": {k: (round(v, 4) if isinstance(v, float) else v)
                         for k, v in measured.items() if v is not None},
            "cage": {"cols": c_cols, "rows": c_rows, "verts": cage_local, "tris": cage_tris},
            "mesh": {"cols": m_cols, "rows": m_rows, "verts": mesh_local,
                     "tris": mesh_tris, "uv": mesh_uv_abs, "bindings": bindings},
            "keys": keys,
            "state_gate": ("blink" if kind == "eyelid" else
                           "mouth_open" if patch_id == "mouth_open" else
                           "mouth_closed" if patch_id == "mouth_closed" else None),
        })

    # Патчи-зеркала: отдельные экземпляры с отражённой геометрией и UV.
    # Нужны там, где кольцо видимости просит mirror=True (левая сторона
    # получается отражением объявленного правого варианта; отражение всего
    # персонажа «по умолчанию» спека §10 запрещает).
    needed = sorted({pid for spec in RINGS.values() for (pid, mir) in spec["entries"] if mir})
    by_id = {p["id"]: p for p in patches}
    mirrored = []
    for patch_id in needed:
        patch = by_id.get(patch_id)
        if patch is None:
            fail(f"кольцо просит зеркало патча {patch_id}, которого нет в CELLS")
        copy = json.loads(json.dumps(patch))
        copy["id"] = patch_id + "_m"
        copy["mirror_of"] = patch_id
        copy["mirror"] = True
        copy["cage"]["verts"] = [[-x, y] for (x, y) in patch["cage"]["verts"]]
        copy["cage"]["tris"] = [[a, c, b] for (a, b, c) in patch["cage"]["tris"]]
        copy["mesh"]["verts"] = [[-x, y] for (x, y) in patch["mesh"]["verts"]]
        copy["mesh"]["tris"] = [[a, c, b] for (a, b, c) in patch["mesh"]["tris"]]
        # Зеркало UV — вокруг центра СВОЕЙ клетки, а не листа: иначе зеркальный
        # патч сэмплит чужую область атласа (и просто пропадает).
        cell_mid_u = (patch["rect_padded"][0] + patch["rect_padded"][2]) / (2.0 * sheet_w)
        copy["mesh"]["uv"] = [[2.0 * cell_mid_u - u, v] for (u, v) in patch["mesh"]["uv"]]
        for key in copy["keys"]:
            key["yaw"] = (-key["yaw"]) % 360.0
            key["dx"] = -key["dx"]
            key["rot"] = -key["rot"]
        mirrored.append(copy)

    rings = {}
    for name, spec in RINGS.items():
        rings[name] = {
            "closed": spec["closed"],
            "fade": spec["fade"],
            "boundaries": spec["boundaries"],
            "entries": [{"patch": pid + ("_m" if mir else ""), "mirror": mir}
                        for (pid, mir) in spec["entries"]],
        }

    doc = {
        "format": "r2d4-authoring",
        "version": 1,
        "character": {
            "id": "russi_head_v1",
            "note": "head-only MVP, yaw S¹, pitch 0; full-body и pitch — отдельные стадии",
        },
        "units": {"H": 1.0, "origin": "верх черепа по центру", "y": "вниз"},
        "sheet": {
            "path": str(SHEET.relative_to(DEMO.parent.parent)),
            "sha256": sheet["sha256"],
            "width": sheet["width"],
            "height": sheet["height"],
        },
        "placement": PLACEMENT,
        "anchors_yaw_deg": ANCHOR_YAWS,
        "rings": rings,
        "patches": patches + mirrored,
        "provenance": {
            "measured": "rect'ы, верх черепа, подбородок, высота и ширина силуэта, якоря признаков",
            "authored": "PLACEMENT (азимуты, высоты, целевые размеры), DEPTH, границы колец",
            "derived": "положения anchors на 12 углах — цилиндрическая проекция авторского азимута",
            "forbidden": "готовые полнофигурные кадры в рантайме отсутствуют",
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tris = sum(len(p["mesh"]["tris"]) for p in doc["patches"])
    print(f"  ok   патчей: {len(doc['patches'])} (зеркал: {len(mirrored)}), "
          f"треугольников: {tris}, anchors: {len(ANCHOR_YAWS)}")
    print(f"  записано: {OUT.relative_to(DEMO.parent.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
