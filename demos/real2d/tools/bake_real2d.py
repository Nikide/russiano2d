#!/usr/bin/env python3
# ===========================================================================
# Baker Real2D v4 (стадия A).
#
# Вход:  authoring/head.authoring.json (author_head.py) + лист PNG.
# Выход: assets/head_real2d_v4.r2d4  — контейнер (ZIP store-only, фиксированные
#        timestamp'ы: одинаковый вход → одинаковые байты) и рядом
#        head_real2d_v4.bake.json — тот же отчёт, что внутри контейнера.
#
# Модель: q(θ) = μ + B·a(θ), a_n(θ) = Σ_k c_nk F_k(θ), F = [1, cos θ, sin θ,
# cos 2θ, sin 2θ, cos 3θ, sin 3θ] — спека §4–5, K=3, L=0. D — параметры патчей
# (dx, dy, sx, sy, rot), а не сырые вершины cage: chart'ы имеют разную
# топологию, и складывать несопоставимые индексы спека §4 запрещает.
#
# Baker ничего не дорисовывает: атлас копируется из авторского листа как есть,
# texels не меняются, полнофигурных кадров не создаётся.
# ===========================================================================

import argparse
import hashlib
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent          # demos/real2d/tools
DEMO = HERE.parent
AUTHORING = DEMO / "authoring" / "head.authoring.json"
DEFAULT_OUT = DEMO / "assets" / "head_real2d_v4.r2d4"

CANVAS = 512
# Сколько пикселей канваса приходится на единицу H и где её начало. Значения
# можно переопределить в authoring (doc["placement"]): у разных персонажей
# единица H разная, и baker не должен навязывать свою.
UNIT_PX = 380.0
CANVAS_W = CANVAS
CANVAS_H = CANVAS
ORIGIN = [CANVAS * 0.5, 72.0]   # верх черепа по центру
YAW_K = 3
PITCH_L = 0
TARGET_VARIANCE = 0.995
MAX_RANK = 8
MAX_ANCHOR_ERROR = 0.02   # допуск реконструкции anchors по параметрам патчей (в H)
REG_LAMBDA = 1e-6        # частотно-взвешенная регуляризация (§5)
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def fail(message):
    print("  FAIL " + message)
    raise SystemExit(1)


def fourier(theta, K):
    """F(θ) = [1, cos θ, sin θ, …, cos Kθ, sin Kθ]."""
    row = [1.0]
    for k in range(1, K + 1):
        row.append(math.cos(k * theta))
        row.append(math.sin(k * theta))
    return row


def feature_count(K, L):
    return (2 * K + 1) * (L + 1)


def main():
    parser = argparse.ArgumentParser(description="Baker Real2D v4 (стадия A)")
    parser.add_argument("--authoring", type=Path, default=AUTHORING)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.authoring.exists():
        fail(f"нет авторинга: {args.authoring} — сначала author_head.py")
    doc = json.loads(args.authoring.read_text(encoding="utf-8"))
    global UNIT_PX, ORIGIN, CANVAS, CANVAS_W, CANVAS_H
    placement = doc.get("placement", {})
    CANVAS_W = int(placement.get("canvas_w", CANVAS))
    CANVAS_H = int(placement.get("canvas_h", CANVAS))
    if "head_unit_px" in placement:
        UNIT_PX = float(placement["head_unit_px"])
    if "head_top_y" in placement:
        ORIGIN = [CANVAS * 0.5, float(placement["head_top_y"])]
    patches = doc["patches"]
    yaws = doc["anchors_yaw_deg"]
    sheet_path = DEMO.parent.parent / doc["sheet"]["path"]
    if not sheet_path.exists():
        fail(f"нет листа: {sheet_path}")

    # --- 1. Якорная матрица X (J × D) --------------------------------------
    D = len(patches) * 5
    X = np.zeros((len(yaws), D))
    for j, yaw in enumerate(yaws):
        for i, patch in enumerate(patches):
            keys = {round(k["yaw"] % 360.0, 6): k for k in patch["keys"]}
            key = keys.get(round(yaw % 360.0, 6))
            if key is None:
                fail(f"патч {patch['id']} не имеет ключа на yaw={yaw}")
            X[j, i * 5 + 0] = key["dx"]
            X[j, i * 5 + 1] = key["dy"]
            X[j, i * 5 + 2] = key["sx"]
            X[j, i * 5 + 3] = key["sy"]
            X[j, i * 5 + 4] = key["rot"]
    if not np.isfinite(X).all():
        fail("в якорной матрице есть не-конечные значения")

    # --- 2. PCA (спек §4) ---------------------------------------------------
    mu = X.mean(axis=0)
    Xc = X - mu
    U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
    variance = S ** 2
    total = variance.sum()
    max_rank = int(min(MAX_RANK, Xc.shape[0] - 1, Xc.shape[1]))

    # --- 3. Fourier-фит (спек §5) ------------------------------------------
    F = np.array([fourier(math.radians(y), YAW_K) for y in yaws])   # J × Fn
    Fn = F.shape[1]
    if Fn > len(yaws):
        fail(f"базисных функций {Fn} больше, чем anchors {len(yaws)}: фит недоопределён")
    penalty = np.zeros(Fn)
    for k in range(YAW_K + 1):
        weight = float(k) ** 4
        if k == 0:
            penalty[0] = weight
        else:
            penalty[2 * k - 1] = weight
            penalty[2 * k] = weight
    A = np.vstack([F, np.sqrt(REG_LAMBDA) * np.diag(penalty)])

    def decompose(r):
        """Базис ранга r с детерминированным знаком + Fourier-фит латентов."""
        basis = Vt[:r].T                                  # D × r
        latent = Xc @ basis                               # J × r
        # Знак фиксируем детерминированно: максимальная по модулю компонента
        # положительна, иначе разные сборки давали бы разные знаки базиса.
        for n in range(r):
            col = basis[:, n]
            if col[int(np.argmax(np.abs(col)))] < 0:
                basis[:, n] = -col
                latent[:, n] = -latent[:, n]
        Y = np.vstack([latent, np.zeros((Fn, r))])
        coeff, _, fit_rank, _ = np.linalg.lstsq(A, Y, rcond=None)
        recon = mu[None, :] + (F @ coeff) @ basis.T
        return basis, coeff, float(np.abs(recon - X).max()), int(fit_rank)

    # Минимальный r по объяснённой дисперсии, но художественный критерий —
    # ошибка реконструкции anchors (спека §4: «проверять max landmark error»).
    # Нулевая суммарная дисперсия означает, что вариации ракурса в anchors НЕТ:
    # доля удержанной дисперсии тогда не определена, а не «100 %». Ранг формата
    # (заглушка хранения) обязан отличаться от ИЗМЕРЕННОГО ранга — этого требует
    # аудит автора спецификации (§3 handoff).
    total_variance = float(total)
    tolerance = max(1e-9, 1e-6 * float(S[0]) if S.size else 1e-9)
    measured_rank = int(np.count_nonzero(S > tolerance))
    constant_anchors = total_variance <= 1e-12 or measured_rank == 0

    rank = 1
    while rank < max_rank and variance[:rank].sum() / total < TARGET_VARIANCE:
        rank += 1
    rank_floor = rank      # ранг ФОРМАТА: техническая заглушка хранения, не измеренный
    basis, coeff, max_err, fit_rank = decompose(rank)
    while max_err > MAX_ANCHOR_ERROR and rank < max_rank:
        rank += 1
        basis, coeff, max_err, fit_rank = decompose(rank)

    # --- 4. Проверка реконструкции anchors ---------------------------------
    q_rec = mu[None, :] + (F @ coeff) @ basis.T
    err = np.abs(q_rec - X)
    per_param = err.reshape(len(yaws), len(patches), 5)
    worst = int(np.argmax(per_param.max(axis=(0, 2))))
    param_names = ("dx", "dy", "sx", "sy", "rot")
    warnings = []
    if constant_anchors:
        warnings.append("anchors не варьируются по ракурсу: total_variance=0, "
                        "измеренный ранг 0 — view manifold НЕ обучен, это хранилище констант")
    if max_err > 0.05:
        warnings.append(f"реконструкция anchors: max|Δ|={max_err:.4f} у патча "
                        f"{patches[worst]['id']} — фит K={YAW_K} сглаживает авторскую траекторию")
    if max_err > MAX_ANCHOR_ERROR:
        warnings.append(f"ранг упёрся в потолок {max_rank}: max|Δ|={max_err:.4f} > {MAX_ANCHOR_ERROR}")
    if fit_rank < rank:
        warnings.append(f"rank дефицит: {fit_rank} < {rank}")
    top_errors = sorted(
        ({"patch": patches[i]["id"], "param": param_names[p],
          "max_abs": round(float(per_param[:, i, p].max()), 5)}
         for i in range(len(patches)) for p in range(5)),
        key=lambda item: -item["max_abs"])[:5]

    # Кольца видимости: каждой записи — явный отрезок [a, b] по кругу.
    # Соседние записи делят окно перехода, поэтому сумма весов внутри кольца
    # равна 1 (спека §7 правило 5); рантайм считает это той же формулой.
    ring_records = {}
    for name, ring in doc["rings"].items():
        bounds = ring["boundaries"]
        entries = ring["entries"]
        count = len(entries)
        if ring["closed"] and len(bounds) != count:
            fail(f"кольцо {name}: замкнутому кольцу нужно записей == границ")
        if not ring["closed"] and len(bounds) != count + 1:
            fail(f"кольцо {name}: незамкнутому кольцу нужно границ на одну больше")
        spans = []
        for i, entry in enumerate(entries):
            a = bounds[i]
            # Замкнутое кольцо: последняя запись замыкается на первую границу.
            # Первая запись при этом идёт через 0/360 (b < a) — рантайм
            # разворачивает такой отрезок прибавлением 360.
            b = bounds[(i + 1) % len(bounds)] if ring["closed"] else bounds[i + 1]
            spans.append({"patch": entry["patch"], "mirror": entry["mirror"],
                          "a": a, "b": b})
        ring_records[name] = {"closed": ring["closed"], "fade": ring["fade"], "entries": spans}

    # --- 5. Сборка бинарных секций -----------------------------------------
    def pack(fmt, values):
        return np.asarray(values, dtype=fmt).tobytes()

    verts, uvs, tris, bind_tri, bind_w, cage = [], [], [], [], [], []
    patch_records = []
    for patch in patches:
        v_off = len(verts) // 2
        for (x, y) in patch["mesh"]["verts"]:
            verts += [x, y]
        uv_off = len(uvs) // 2
        for (u, v) in patch["mesh"]["uv"]:
            uvs += [u, v]
        t_off = len(tris) // 3
        # Индексы треугольников — ЛОКАЛЬНЫЕ для патча (рантайм берёт вершины
        # со своим vert_offset): так секция читается без вычитаний.
        for (a, b, c) in patch["mesh"]["tris"]:
            tris += [a, b, c]
        b_off = len(bind_tri) // 3   # смещение в записях (3 значения на вершину)
        for (ta, tb, tc, w0, w1, w2) in patch["mesh"]["bindings"]:
            # Индекс cage-треугольника локальный для патча; три индекса вершин
            # cage кладём рядом, чтобы рантайму не нужна вторая таблица.
            bind_tri += [ta, tb, tc]
            bind_w += [w0, w1, w2]
        c_off = len(cage) // 2
        for (x, y) in patch["cage"]["verts"]:
            cage += [x, y]
        patch_records.append({
            "id": patch["id"],
            "semantic": patch["semantic"],
            "owner_group": patch["owner_group"],
            "mirror_of": patch.get("mirror_of"),
            "depth": patch["depth"],
            "clip_to": patch["clip_to"],
            "state_gate": patch["state_gate"],
            "visibility": patch.get("visibility"),
            "clip_rect": patch.get("clip_rect"),
            "rect_padded": patch["rect_padded"],
            "scale_px_per_unit": patch["scale_px_per_unit"],
            "anchor_px": patch["anchor_px"],
            "vert_offset": v_off, "vert_count": len(patch["mesh"]["verts"]),
            "uv_offset": uv_off,
            "tri_offset": t_off, "tri_count": len(patch["mesh"]["tris"]),
            "bind_offset": b_off,
            "cage_offset": c_off, "cage_count": len(patch["cage"]["verts"]),
        })

    # lstsq даёт C формы (features × rank): рантайм ждёт rank-major, поэтому
    # транспонируем ОДИН раз здесь — иначе проверка реконструкции проходит,
    # а читатель получает перемешанные коэффициенты.
    coeff = np.ascontiguousarray(coeff.T)
    manifold = np.concatenate([mu, basis.reshape(-1), coeff.reshape(-1)])
    atlas_bytes = sheet_path.read_bytes()
    atlas_sha = hashlib.sha256(atlas_bytes).hexdigest()

    # --- 6. Манифест --------------------------------------------------------
    manifest = {
        "format": "r2d4",
        "version": 4,
        "generator": "bake_real2d.py (стадия A, head-only)",
        "domain": {
            "yaw": "S1 (полный круг)",
            "pitch_deg": [0, 0],
            "pitch_status": "стадия A: pitch не вход; ±30° — стадия B",
            "states": {"blink": [0, 1], "mouth_open": [0, 1]},
        },
        "canvas": {"width": CANVAS_W, "height": CANVAS_H, "unit_px": UNIT_PX, "origin": ORIGIN},
        "atlas": {
            "path": "atlas/atlas_00.png",
            "width": doc["sheet"]["width"],
            "height": doc["sheet"]["height"],
            "sha256": atlas_sha,
            "storage": "straight-alpha sRGB PNG; рантайм переводит в linear и premultiply",
            "padding_px": 4,
        },
        "manifold": {
            "dim": D, "rank": rank, "yaw_K": YAW_K, "pitch_L": PITCH_L,
            "features": Fn,
            "layout": "mu[dim] | basis[dim*rank] (row-major D×r) | coeff[rank*features] (row-major r×features: coeff[n][k])",
            "param_layout": "на патч: dx, dy, sx, sy, rot",
            "variance_kept": float(variance[:rank].sum() / total),
            "anchor_reconstruction_max_abs": max_err,
        },
        "sections": {
            "verts": {"path": "geometry/verts.f32", "count": len(verts) // 2, "stride": 2},
            "uvs": {"path": "geometry/uvs.f32", "count": len(uvs) // 2, "stride": 2},
            "tris": {"path": "geometry/tris.u32", "count": len(tris) // 3, "stride": 3,
                     "index_space": "local_per_patch"},
            "bind_tri": {"path": "geometry/bind_tri.u32", "count": len(bind_tri) // 3, "stride": 3,
                         "index_space": "patch_cage"},  # индексы вершин cage патча
            "bind_w": {"path": "geometry/bind_w.f32", "count": len(bind_w) // 3, "stride": 3},
            "cage": {"path": "geometry/cage.f32", "count": len(cage) // 2, "stride": 2},
            "manifold": {"path": "geometry/manifold.f32", "count": len(manifold), "stride": 1},
        },
        "patches": patch_records,
        "rings": ring_records,
        "sources": {
            "sheet": doc["sheet"]["path"],
            "sheet_sha256": doc["sheet"]["sha256"],
            "authoring": "authoring/head.authoring.json",
            "authoring_sha256": hashlib.sha256(args.authoring.read_bytes()).hexdigest(),
        },
        "provenance": {
            "runtime_frames": "отсутствуют: кадр собирается из texels атласа",
            "geometry": "Authoring даёт базовый cage и 12 anchors; рантайм вычисляет q(θ) серией Фурье",
            "appearance": "appearance-варианты — отдельные gated charts кольца видимости",
            "baker_does_not": "не дорисовывает текстуры и не меняет texels атласа",
        },
    }

    # --- 7. Контейнер (ZIP store-only, детерминированные timestamp'ы) -------
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.out, "w", compression=zipfile.ZIP_STORED) as zf:
        def put(name, data):
            info = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)

        put("manifest.json", (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        put("atlas/atlas_00.png", atlas_bytes)
        put("geometry/verts.f32", pack("<f4", verts))
        put("geometry/uvs.f32", pack("<f4", uvs))
        put("geometry/tris.u32", pack("<u4", tris))
        put("geometry/bind_tri.u32", pack("<u4", bind_tri))
        put("geometry/bind_w.f32", pack("<f4", bind_w))
        put("geometry/cage.f32", pack("<f4", cage))
        put("geometry/manifold.f32", pack("<f4", manifold))

    report = {
        "ok": True,
        "format": "r2d4",
        "stage": "A (head-only, yaw S1, pitch 0)",
        "container": str(args.out.relative_to(DEMO.parent.parent)),
        "container_sha256": hashlib.sha256(args.out.read_bytes()).hexdigest(),
        "container_bytes": args.out.stat().st_size,
        "source_counts": {
            "patches": len(patches), "mirrored": sum(1 for p in patches if p.get("mirror_of")),
            "triangles": len(tris) // 3, "mesh_vertices": len(verts) // 2,
            "anchors": len(yaws),
        },
        "manifold": manifest["manifold"],
        "atlas": {"sha256": atlas_sha, "bytes": len(atlas_bytes)},
        "gates": {"rings": list(doc["rings"].keys()), "fade_deg": {k: v["fade"] for k, v in doc["rings"].items()}},
        # Статусы раздельно (аудит §3): успешная упаковка НЕ означает
        # корректной геометрии, а корректная геометрия — художественной приёмки.
        "status": {
            "container_valid": True,
            "geometry_fit_valid": bool(not constant_anchors and fit_rank >= rank
                                       and max_err <= MAX_ANCHOR_ERROR),
            "anchor_visual_accepted": False,
            "non_anchor_tests_passed": False,
            "pitch_supported": False,
            "full_body_supported": False,
        },
        "status_notes": {
            "anchor_visual_accepted": "выставляется только после глазной проверки "
                                      "собранных ключевых видов (front/profiles/back)",
            "non_anchor_tests_passed": "выставляется после прогона не-анкорных углов "
                                       "из tests/non_anchor_angles.csv",
            "pitch_supported": "pitch-домен не поддержан: anchors только pitch=0",
            "full_body_supported": "тело/одежда не собраны: стадия C не начата",
        },
        "acceptance_probe": {
            "anchor_reconstruction_max_abs": max_err,
            "anchor_reconstruction_top": top_errors,
            "total_variance": total_variance,
            "measured_rank": measured_rank,
            "format_rank": rank,
            "format_rank_floor_by_variance": rank_floor,
            "retained_variance_ratio": None if constant_anchors else
                                       float(variance[:rank].sum() / total),
            "retained_variance_note": "not_applicable при total_variance=0" if constant_anchors else "",
            "constant_anchors": bool(constant_anchors),
            "singular_values": [round(float(s), 6) for s in S[:max_rank + 1]],
        },
        "warnings": warnings,
    }
    (args.out.with_suffix(".bake.json")).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"  записано: {args.out.relative_to(DEMO.parent.parent)} "
          f"({report['container_bytes']} байт) и {args.out.with_suffix('.bake.json').name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
