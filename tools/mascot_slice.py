#!/usr/bin/env python3
"""Нарезка листа маскота «Руси-чан» в атлас для Editor.

    mascot_slice.py assets/mascot/sheet_alpha.png [--out editor/ui] [--debug dir]

Лист — сетка 8x8: либо картинка на тёмном фоне с шахматкой (grabCut), либо уже с прозрачностью
(sheet_alpha.png: границы строк неравномерны, ищутся по проекции альфы). Ряды по порядку:
  idle (стоит), walk (ходьба), run (бег), crab (ползёт «крабиком»), act (работа: ноутбук, ключ, коробка),
  emo (эмоции), fx (идея, карта, галочка, предупреждение…), misc (разное).
Скрипт режет сетку, вырезает фон (grabCut + пиксели, далёкие от цвета фона по краю ячейки),
кладёт кадры в ячейки 156x156 (по центру, ноги внизу) в один PNG-атлас и пишет
mascot.rcss (@spritesheet, имена вида idle_0), mascot.json. Результат детерминирован.
Нужны pillow-совместимый opencv и numpy.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ROWS = ["idle", "walk", "run", "crab", "act", "emo", "fx", "misc"]
CELL = 156
INSET = 4          # отступ от линий сетки


def cut(rgb, box):
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1].copy()
    h, w = crop.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    cv2.setRNGSeed(7)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(crop, mask, (2, 2, w - 4, h - 4), bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    # серые предметы (ноутбук, ключ, коробка): пиксели, далёкие от цвета фона по краю ячейки
    border = np.concatenate([crop[0, :], crop[-1, :], crop[:, 0], crop[:, -1]]).astype(np.float32)
    bg0 = np.median(border, axis=0)
    far = (np.abs(crop.astype(np.float32) - bg0).max(axis=2) > 40).astype(np.uint8) * 255
    far = cv2.morphologyEx(far, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    near = cv2.dilate(alpha, np.ones((9, 9), np.uint8))
    cnt, lab2, st2, _ = cv2.connectedComponentsWithStats(far)
    for i in range(1, cnt):
        comp = lab2 == i
        if st2[i, cv2.CC_STAT_AREA] >= 30 and (near[comp] > 0).any():
            alpha[comp] = 255
    # мелкий мусор (шахматка) убираем; значки рядом с персонажем остаются
    n, lab, stats, _ = cv2.connectedComponentsWithStats(alpha)
    keep = np.zeros_like(alpha)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 14:
            keep[lab == i] = 255
    keep = cv2.erode(keep, np.ones((2, 2), np.uint8))
    keep = cv2.GaussianBlur(keep, (0, 0), 0.8)
    return np.dstack([crop, keep])


def row_bounds(alpha, rows=8):
    """Границы строк неравномерной сетки: минимумы проекции альфы около k*H/rows."""
    h = alpha.shape[0]
    proj = cv2.GaussianBlur((alpha > 60).sum(axis=1).astype(np.float32).reshape(-1, 1), (1, 0), 3).ravel()
    bounds = [0]
    for k in range(1, rows):
        c = int(k * h / rows)
        lo, hi = max(bounds[-1] + 40, c - 48), min(h - 40, c + 48)
        bounds.append(int(lo + np.argmin(proj[lo:hi])))
    bounds.append(h)
    return bounds


def clean_alpha_cell(rgba):
    """Лист уже с альфой: срезаем слабую альфу, чужие обрывки на краях ячейки, фиксируем бахрому."""
    a = rgba[:, :, 3].astype(np.float32)
    a = np.clip((a - 40.0) * (255.0 / 175.0), 0, 255).astype(np.uint8)
    h, w = a.shape
    n, lab, st, _ = cv2.connectedComponentsWithStats((a > 20).astype(np.uint8))
    keep = np.zeros_like(a)
    for i in range(1, n):
        x, y, cw, ch, area = st[i]
        touches_side = x <= 1 or x + cw >= w - 1
        if area >= 400 or (area >= 14 and not touches_side):
            keep[lab == i] = 255
    a = np.where(keep > 0, a, 0).astype(np.uint8)
    a = cv2.erode(a, np.ones((2, 2), np.uint8))
    out = rgba.copy()
    out[:, :, 3] = a
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--out", default="editor/ui")
    ap.add_argument("--debug")
    args = ap.parse_args()
    raw = cv2.imread(args.sheet, cv2.IMREAD_UNCHANGED)
    has_alpha = raw.ndim == 3 and raw.shape[2] == 4 and (raw[:, :, 3] < 5).mean() > 0.2
    rgb = raw[:, :, :3] if raw.ndim == 3 else cv2.cvtColor(raw, cv2.COLOR_GRAY2BGR)
    H, W = rgb.shape[:2]
    cw, ch = W / 8.0, H / 8.0
    rb = row_bounds(raw[:, :, 3]) if has_alpha else [int(r * ch) for r in range(9)]
    frames, anims = [], {}
    for r, row in enumerate(ROWS):
        names = []
        for c in range(8):
            name = f"{row}_{c}"
            if has_alpha:
                cell = raw[rb[r]:rb[r + 1], int(c * cw):int((c + 1) * cw)]
                rgba = clean_alpha_cell(cell)
                ys, xs = np.where(rgba[:, :, 3] > 0)
                if len(ys):
                    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
                frames.append((name, rgba))
            else:
                box = (int(c * cw) + INSET, rb[r] + INSET, int((c + 1) * cw) - INSET, rb[r + 1] - INSET)
                frames.append((name, cut(rgb, box)))
            names.append(name)
        anims[row] = names
    atlas = np.zeros((8 * CELL, 8 * CELL, 4), np.uint8)
    index = {}
    for k, (fname, rgba) in enumerate(frames):
        h, w = rgba.shape[:2]
        s = min(1.0, CELL / max(h, w))
        if s < 1.0:
            rgba = cv2.resize(rgba, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA)
            h, w = rgba.shape[:2]
        cx, cy = (k % 8) * CELL, (k // 8) * CELL
        atlas[cy + CELL - h:cy + CELL, cx + (CELL - w) // 2:cx + (CELL - w) // 2 + w] = rgba
        index[fname] = (cx, cy)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out / "mascot.png"), atlas)
    lines = ["/* Сгенерировано tools/mascot_slice.py — не править руками. */", "@spritesheet mascot {", "    src: mascot.png;", "    resolution: 1x;"]
    for fname, (x, y) in index.items():
        lines.append(f"    {fname}: {x}px {y}px {CELL}px {CELL}px;")
    lines.append("}")
    lines.append("")
    for fname in index:
        lines.append(f".mc-{fname.replace('_', '-')} {{ decorator: image({fname}); }}")
    (out / "mascot.rcss").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "mascot.json").write_text(json.dumps({"cell": CELL, "anims": anims}, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.debug:
        d = Path(args.debug)
        d.mkdir(parents=True, exist_ok=True)
        bg = np.zeros_like(atlas[:, :, :3]); bg[:] = (27, 22, 20)
        a = atlas[:, :, 3:4].astype(np.float32) / 255.0
        comp = (atlas[:, :, :3] * a + bg * (1 - a)).astype(np.uint8)
        for fname, (x, y) in index.items():
            cv2.putText(comp, fname, (x + 3, y + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1)
        cv2.imwrite(str(d / "contact.png"), comp)
    print("кадров:", len(frames), "атлас:", atlas.shape[1], "x", atlas.shape[0])


if __name__ == "__main__":
    main()
