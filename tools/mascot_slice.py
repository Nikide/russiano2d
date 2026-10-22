#!/usr/bin/env python3
"""Нарезка листа маскота «Руси-чан» в атлас для Editor.

    mascot_slice.py assets/mascot/sheet.png [--out editor/ui] [--debug dir]

Лист — сгенерированная картинка (1536x1024) с рядами кадров на размытом фоне. Скрипт:
  1. находит кадры в каждом ряду по проекции «переднего плана» (насыщенные/тёмные/светлые
     пиксели против серо-зелёного фона);
  2. вырезает фон grabCut'ом и сглаживает альфу;
  3. кладёт кадры в ячейки 144x144 (по центру, ноги внизу) в один PNG-атлас;
  4. пишет mascot.rcss (@spritesheet с именами кадров) и mascot.json (ряды → кадры).
Результат детерминирован (grabCut с фиксированным seed). Нужны pillow, opencv, numpy.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

CELL = 144
# (имя ряда, y0, y1, префикс кадров). Границы подобраны по листу; число кадров находится само.
ROWS = [
    ("idle", 95, 230, "idle"), ("walk", 255, 390, "walk"), ("run", 400, 520, "run"),
    ("crab", 545, 665, "crab"), ("act", 680, 810, "act"), ("emo", 835, 920, "emo"),
    ("ico", 948, 1012, "ico"),
]
X0, X1 = 15, 1130


def find_runs(rgb, y0, y1, min_w):
    hsv = cv2.cvtColor(rgb[y0:y1, X0:X1], cv2.COLOR_BGR2HSV)
    mask = ((hsv[:, :, 1] > 110) | (hsv[:, :, 2] < 45) | (hsv[:, :, 2] > 200)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    on = mask.sum(axis=0) > 3
    runs, start = [], None
    for x, v in enumerate(on):
        if v and start is None:
            start = x
        if not v and start is not None:
            if x - start >= min_w:
                runs.append((start + X0, x + X0))
            start = None
    if start is not None and len(on) - start >= min_w:
        runs.append((start + X0, len(on) + X0))
    return runs


def cut(rgb, box):
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1].copy()
    h, w = crop.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    cv2.setRNGSeed(7)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(crop, mask, (3, 3, w - 6, h - 6), bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    # второй проход: серые предметы (ноутбук, ключ) — пиксели, далёкие от цвета фона по краю кадра,
    # если они касаются найденного силуэта
    border = np.concatenate([crop[0, :], crop[-1, :], crop[:, 0], crop[:, -1]]).astype(np.float32)
    bg0 = np.median(border, axis=0)
    far = (np.abs(crop.astype(np.float32) - bg0).max(axis=2) > 46).astype(np.uint8) * 255
    far = cv2.morphologyEx(far, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    near = cv2.dilate(alpha, np.ones((9, 9), np.uint8))
    cnt, lab2, st2, _ = cv2.connectedComponentsWithStats(far)
    for i in range(1, cnt):
        comp = lab2 == i
        if st2[i, cv2.CC_STAT_AREA] >= 30 and (near[comp] > 0).any():
            alpha[comp] = 255
    # оставляем крупнейшую связную область и мелкие рядом лежащие (искры, «!», сердечки)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(alpha)
    keep = np.zeros_like(alpha)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 14:
            keep[lab == i] = 255
    keep = cv2.erode(keep, np.ones((2, 2), np.uint8))
    keep = cv2.GaussianBlur(keep, (0, 0), 0.8)
    return np.dstack([crop, keep])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--out", default="editor/ui")
    ap.add_argument("--debug")
    args = ap.parse_args()
    rgb = cv2.imread(args.sheet, cv2.IMREAD_COLOR)
    frames = []   # (имя, rgba)
    anims = {}
    for name, y0, y1, prefix in ROWS:
        runs = find_runs(rgb, y0, y1, 22 if name != "ico" else 14)
        names = []
        for i, (a, b) in enumerate(runs):
            box = (max(0, a - 6), max(0, y0 - 4), min(rgb.shape[1], b + 6), min(rgb.shape[0], y1 + 4))
            frames.append((f"{prefix}_{i}", cut(rgb, box)))
            names.append(f"{prefix}_{i}")
        anims[name] = names
    cols = 10
    rows_n = (len(frames) + cols - 1) // cols
    atlas = np.zeros((rows_n * CELL, cols * CELL, 4), np.uint8)
    index = {}
    for k, (fname, rgba) in enumerate(frames):
        h, w = rgba.shape[:2]
        s = min(1.0, (CELL - 4) / max(h, w))
        if s < 1.0:
            rgba = cv2.resize(rgba, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA)
            h, w = rgba.shape[:2]
        cx, cy = (k % cols) * CELL, (k // cols) * CELL
        ox, oy = cx + (CELL - w) // 2, cy + CELL - h - 2
        atlas[oy:oy + h, ox:ox + w] = rgba
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
        bg = np.zeros_like(atlas[:, :, :3]); bg[:] = (27, 22, 20)   # цвет панели Editor (BGR)
        a = atlas[:, :, 3:4].astype(np.float32) / 255.0
        comp = (atlas[:, :, :3] * a + bg * (1 - a)).astype(np.uint8)
        for fname, (x, y) in index.items():
            cv2.putText(comp, fname, (x + 3, y + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1)
        cv2.imwrite(str(d / "contact.png"), comp)
    print({k: len(v) for k, v in anims.items()}, "кадров:", len(frames), "атлас:", atlas.shape[1], "x", atlas.shape[0])


if __name__ == "__main__":
    main()
