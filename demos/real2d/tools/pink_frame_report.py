#!/usr/bin/env python3
# ===========================================================================
# Кадровый отчёт: скриншоты движка с подписью применённых ФУНКЦИЙ.
#
# Правило: каждый кадр сопровождается списком функций, которые его построили,
# со ссылкой на параграф документа (FORMULAS.md / REAL2D_V4_SPEC.md). Подпись
# печатается на самом изображении, чтобы кадр нельзя было предъявить без
# объяснения, какой математикой он получен.
#
# Что подписывается:
#   §3 FORMULAS  q(θ,u,s) = μ + B·a(θ,u,s)          — манифолд (SVD якорей)
#   §4 FORMULAS  F_k(θ), T_l(u), T_{l+1}=2uT_l−T_{l−1} — базис Фурье×Чебышёв
#   §2 SPEC      v=(cosθ,sinθ,u)                     — параметризация вида
#   §7 FORMULAS  v_i=1−S((|Δ|−half)/fade), S(t)=3t²−2t³ — видимость/переход
#   §8 FORMULAS  p=Σλ_a V_ta, uv=Σβ_a uv_a, A/A0 ≥ 0.05 — barycentric warp
#   §9 FORMULAS  C_out=C_front+(1−α_front)C_back      — premultiplied over
#   §6 FORMULAS  w_j=softmax(κ(cosΔθ−1)+logρ)         — НЕ применён (честно)
#
# Запуск:
#   python3 demos/real2d/tools/pink_frame_report.py --angles 0,30,90,180 --out /tmp/report.png
# ===========================================================================

import argparse
import json
import math
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ROOT = DEMO.parent.parent
sys.path.insert(0, str(ROOT / "tools"))

FRAME_W, FRAME_H = 260, 300      # плитка кадра
CAP_H = 110                      # полоса подписи

# Функции, применённые к кадру, с указанием файла и параграфа.
APPLIED = [
    ("SPEC §2", "v=(cosθ,sinθ,u)"),
    ("FORMULAS §3", "q(θ)=μ+B·a(θ)"),
    ("FORMULAS §4", "F_k(θ)·T_l(u), K=3"),
    ("FORMULAS §7", "v_i=1−S((|Δ|−half)/fade)"),
    ("FORMULAS §8", "p=Σλ_a V_ta; A/A0≥0.05"),
    ("FORMULAS §9", "C_out=C_front+(1−α_front)C_back"),
]
NOT_APPLIED = [
    ("FORMULAS §6", "w_j=softmax — НЕ применён"),
    ("FORMULAS §9", "d_i=Σc·F_k·T_l — глубина константами"),
]


def build(angles, container, out, crop=(560, 200, 1040, 680)):
    from agent_client import Agent

    tiles = []
    with Agent(game="demos/real2d", seed=7) as a:
        a.eval("(() => { real2dDemo.head().real2dSrc(%s); return 1; })()" % json.dumps(container))
        for yaw in angles:
            a.eval("(() => { real2dDemo.setYaw(%f); return 1; })()" % math.radians(yaw))
            a.step(3)
            shot = f"/tmp/_frame_{int(round(yaw)):03d}.png"
            a.screenshot(shot)
            info = json.loads(a.eval("JSON.stringify(real2dDemo.info())"))
            tiles.append({"yaw": yaw, "path": shot,
                          "patches": info["patches_drawn"],
                          "tris": info["triangles_drawn"],
                          "ms": round(info["ms"]["raster"], 1),
                          "error": info["last_error"]})

    cols = 4
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * FRAME_W, rows * (FRAME_H + CAP_H)), (12, 16, 26))
    draw = ImageDraw.Draw(sheet)
    for index, tile in enumerate(tiles):
        frame = Image.open(tile["path"]).convert("RGB").crop(crop).resize((FRAME_W, FRAME_H), Image.LANCZOS)
        px, py = (index % cols) * FRAME_W, (index // cols) * (FRAME_H + CAP_H)
        sheet.paste(frame, (px, py))
        y = py + FRAME_H
        draw.rectangle([px, y, px + FRAME_W - 1, y + CAP_H - 1], fill=(18, 24, 36))
        draw.text((px + 6, y + 4), f"yaw {tile['yaw']:g}° · кадр движка · {tile['patches']} патчей / "
                                   f"{tile['tris']} треуг. / {tile['ms']} мс", fill=(150, 220, 255))
        line_y = y + 18
        for where, formula in APPLIED:
            draw.text((px + 6, line_y), f"{where}  {formula}", fill=(120, 240, 180))
            line_y += 11
        for where, formula in NOT_APPLIED:
            draw.text((px + 6, line_y), f"{where}  {formula}", fill=(250, 180, 120))
            line_y += 11
    sheet.save(out)
    return tiles, sheet.size


def main():
    parser = argparse.ArgumentParser(description="Кадровый отчёт с подписью функций")
    parser.add_argument("--angles", type=str, default="0,30,60,90,150,180,240,300")
    parser.add_argument("--container", type=Path,
                        default=DEMO / "assets" / "pink_v4.r2d4")
    parser.add_argument("--out", type=Path, default=Path("/tmp/pink_function_report.png"))
    args = parser.parse_args()

    angles = [float(x) for x in args.angles.split(",") if x != ""]
    tiles, size = build(angles, str(args.container), args.out)
    print(f"кадров: {len(tiles)} → {args.out} {size}")
    for tile in tiles:
        print(f"  yaw {tile['yaw']:>5}: {tile['patches']:>3} патчей, {tile['tris']:>4} треуг., "
              f"{tile['ms']:>5} мс, ошибка {tile['error']!r}")
    print("\nПрименённые функции:")
    for where, formula in APPLIED:
        print(f"  {where}: {formula}")
    print("Не применены (честно):")
    for where, formula in NOT_APPLIED:
        print(f"  {where}: {formula}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
