#!/usr/bin/env python3
"""Нарезка листа маскота «Руси-чан» в атлас для Editor.

    mascot_slice.py [assets/mascot/sheet_v2.png] [--out editor/ui] [--debug dir]

Лист (sheet_v2.png) — 20 столбцов x 11 строк кадров на прозрачном фоне; в последней строке
мелкие значки (хвост, головы, череп, «?», «!», сердце, лампочка, ключ, ноутбук, коробка…),
расставленные не по сетке, поэтому они режутся по связным областям. Строки листа:
  0  стоит лицом, поворот, спиной         1  ходьба, ходьба спиной
  2  бег (с линиями скорости), «!»         3  покачивания, ноутбук, лампочка, коробка, присела
  4  эмоции: сердце, ноты, световые мечи    5  ключ, ноты, «?», ноутбук на полу
  6  ждёт, «?», капля, планшет              7  «!», ноты, мечи, коробка, каштан
  8  разное, летающая тарелка (8.19)        9  «?», серая тень, вихрь (9.15), спит на подушке (9.16)
  10 значки
Каждый кадр кладётся в ячейку 64x64 БЕЗ масштабирования (в интерфейсе маскот те же 64 px —
пиксель в пиксель): ноги на общей линии строки, центр по центру ячейки. Кадр режется по
связным областям (спрайт целиком, вместе с эффектом рядом), а не по линиям сетки: так не
отрезаются ноты, лампочки и широкие позы. Имена кадров — r<строка>_<столбец> (r4_3);
в RmlUi это класс .mc-r4-3. Результат детерминирован. Нужны opencv и numpy.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

COLS = 20
ROWS = 11
CELL = 64
BODY_MIN = 220          # площадь, с которой область считается телом спрайта, а не эффектом
ALPHA_MIN = 40          # слабее — бахрома/шум, считаем фоном


def bands(proj, gap=0):
    out, start = [], None
    for i, v in enumerate(proj):
        if v > gap and start is None:
            start = i
        elif v <= gap and start is not None:
            out.append([start, i - 1])
            start = None
    if start is not None:
        out.append([start, len(proj) - 1])
    return out


def row_bands(alpha):
    """Полосы строк: промежутки без пикселей; слитую полосу (две строки) режем по минимуму проекции."""
    proj = (alpha > 0).sum(axis=1)
    found = bands(proj)
    out = []
    for lo, hi in found:
        if len(out) + 1 + sum(1 for b in found if b[0] > lo) < ROWS and hi - lo > 80:
            mid = (lo + hi) // 2
            cut = mid - 12 + int(np.argmin(proj[mid - 12:mid + 12]))
            out += [[lo, cut - 1], [cut, hi]]
        else:
            out.append([lo, hi])
    if len(out) != ROWS:
        raise SystemExit(f"ожидалось {ROWS} строк кадров, найдено {len(out)}: {out}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet", nargs="?", default="assets/mascot/sheet_v2.png")
    ap.add_argument("--out", default="editor/ui")
    ap.add_argument("--debug")
    args = ap.parse_args()
    raw = cv2.imread(args.sheet, cv2.IMREAD_UNCHANGED)
    if raw is None or raw.ndim != 3 or raw.shape[2] != 4:
        raise SystemExit("нужен PNG/WebP с альфа-каналом (прозрачный фон)")
    H, W = raw.shape[:2]
    # слабую альфу срезаем: на листе она даёт шлейф у краёв кадров
    a = raw[:, :, 3].astype(np.float32)
    a = np.clip((a - ALPHA_MIN) * (255.0 / (255 - ALPHA_MIN)), 0, 255).astype(np.uint8)
    sheet = raw.copy()
    sheet[:, :, 3] = a
    rb = row_bands(a)
    pitch = W / COLS
    atlas = np.zeros((ROWS * CELL, COLS * CELL, 4), np.uint8)
    names = []
    for r, (y0, y1) in enumerate(rb):
        band = sheet[y0:y1 + 1]
        mask = (band[:, :, 3] > 0).astype(np.uint8)
        n, lab, st, cen = cv2.connectedComponentsWithStats(mask, connectivity=8)
        owner = np.full(mask.shape, -1, np.int32)        # номер ячейки каждого пикселя
        body = np.zeros(mask.shape, bool)                # пиксели «тела» (по ним центрируем кадр)
        if r == ROWS - 1:
            # значки: по порядку слева направо, каждый в своей ячейке
            order = sorted((i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= 12), key=lambda i: cen[i][0])
            if len(order) != COLS:
                raise SystemExit(f"в строке значков найдено {len(order)} вместо {COLS}")
            for c, i in enumerate(order):
                owner[lab == i] = c
                body[lab == i] = True
        else:
            # Кадры идут слева направо, но НЕ по равномерной сетке (шаг 40–46 px, у строк разный сдвиг,
            # и кадров в строке бывает меньше COLS). Тело спрайта — крупная связная область; слитые
            # соседи (касание, шлейф) шире одного спрайта и делятся по ширине. Мелкие области
            # (ноты, искры, лампочки) прикрепляются к ближайшему по x телу.
            cells = []                                    # [x_центр, пиксели-тело]
            for i in range(1, n):
                if st[i, cv2.CC_STAT_AREA] < BODY_MIN:
                    continue
                comp = lab == i
                w = int(st[i, cv2.CC_STAT_WIDTH])
                x0 = int(st[i, cv2.CC_STAT_LEFT])
                parts = 1 if w <= CELL - 6 else max(2, int(round(w / pitch)))
                for k in range(parts):
                    lo, hi = x0 + w * k // parts, x0 + w * (k + 1) // parts
                    sub = comp.copy()
                    sub[:, :lo] = False
                    sub[:, hi:] = False
                    if sub.any():
                        cells.append([(lo + hi) / 2.0, sub])
            cells.sort(key=lambda t: t[0])
            if len(cells) > COLS:
                raise SystemExit(f"строка {r}: {len(cells)} кадров, а в атласе {COLS} столбцов")
            for c, (_, sub) in enumerate(cells):
                owner[sub] = c
                body[sub] = True
            centers = np.array([t[0] for t in cells])
            for i in range(1, n):
                if st[i, cv2.CC_STAT_AREA] >= BODY_MIN or st[i, cv2.CC_STAT_AREA] < 6:
                    continue
                j = int(np.argmin(np.abs(centers - cen[i][0])))
                if abs(centers[j] - cen[i][0]) <= CELL * 0.75:
                    owner[(lab == i) & (owner < 0)] = j
            print(f"строка {r}: кадров {len(cells)}")
        for c in range(COLS):
            name = f"r{r}_{c}"
            ys, xs = np.where(owner == c)
            if not len(ys):
                continue                                   # в строке меньше кадров, чем столбцов
            names.append(name)
            bx = np.nonzero(((owner == c) & body).any(axis=0))[0]
            cx = int((bx.min() + bx.max() + 1) // 2)       # центр тела
            # ноги — на линии строки: нижняя граница полосы кладётся на последнюю строку ячейки
            dx = xs - cx + CELL // 2
            dy = CELL - 1 - (y1 - (ys + y0))
            ok = (dx >= 0) & (dx < CELL) & (dy >= 0) & (dy < CELL)
            if not ok.all():
                print(f"{name}: за пределами ячейки {int((~ok).sum())} px (отсечены)")
            atlas[r * CELL + dy[ok], c * CELL + dx[ok]] = band[ys[ok], xs[ok]]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out / "mascot.png"), atlas)
    lines = ["/* Сгенерировано tools/mascot_slice.py — не править руками. */", "@spritesheet mascot {", "    src: mascot.png;", "    resolution: 1x;"]
    for name in names:
        r, c = (int(v) for v in name[1:].split("_"))
        lines.append(f"    {name}: {c * CELL}px {r * CELL}px {CELL}px {CELL}px;")
    lines.append("}")
    lines.append("")
    for name in names:
        lines.append(f".mc-{name.replace('_', '-')} {{ decorator: image({name}); }}")
    (out / "mascot.rcss").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "mascot.json").write_text(json.dumps({"cell": CELL, "cols": COLS, "rows": ROWS, "frames": names}, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.debug:
        d = Path(args.debug)
        d.mkdir(parents=True, exist_ok=True)
        S = 2
        big = cv2.resize(atlas, None, fx=S, fy=S, interpolation=cv2.INTER_NEAREST)
        al = big[:, :, 3:4].astype(np.float32) / 255.0
        bg = np.full(big[:, :, :3].shape, (40, 34, 30), np.float32)
        comp = (big[:, :, :3] * al + bg * (1 - al)).astype(np.uint8)
        for name in names:
            r, c = (int(v) for v in name[1:].split("_"))
            cv2.putText(comp, name[1:].replace("_", "."), (c * CELL * S + 2, r * CELL * S + 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 220, 255), 1)
        cv2.imwrite(str(d / "contact.png"), comp)
    print("кадров:", len(names), "атлас:", atlas.shape[1], "x", atlas.shape[0])


if __name__ == "__main__":
    main()
