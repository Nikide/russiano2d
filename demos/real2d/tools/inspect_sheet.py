#!/usr/bin/env python3
# ===========================================================================
# Инспекция послойного шита: сетка, клетки, фактическое содержимое.
#
# Контракт (pink_v4/AUTHORING_CONTRACT.md §4) требует для каждого source image
# реальные размеры, alpha, effective cell bounds и review status — то есть
# проверку, а не предположение «12 колонок = 12 yaw». Этот скрипт измеряет
# сетку и клетки и рисует превью с разметкой, чтобы решение об авторинге
# принимал глаз по факту, а не по обещанию генератора.
#
# Запуск:
#   python3 demos/real2d/tools/inspect_sheet.py --sheet <png> [--cols 12] [--rows 6]
#   python3 demos/real2d/tools/inspect_sheet.py --auto <png> [...]
# ===========================================================================

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent


def cell_stats(alpha, x0, y0, x1, y1, threshold=8):
    sub = alpha[y0:y1, x0:x1] >= threshold
    if not sub.any():
        return None
    ys, xs = np.nonzero(sub)
    return {
        "bbox": [int(x0 + xs.min()), int(y0 + ys.min()), int(x0 + xs.max()) + 1, int(y0 + ys.max()) + 1],
        "coverage": round(float(sub.mean()), 4),
        "area": int(sub.sum()),
    }


def main():
    parser = argparse.ArgumentParser(description="Инспекция послойного шита")
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--cols", type=int, default=12)
    parser.add_argument("--rows", type=int, default=6)
    parser.add_argument("--out", type=Path, default=None, help="превью с разметкой")
    parser.add_argument("--json", type=Path, default=None, help="отчёт по клеткам")
    args = parser.parse_args()

    sheet = args.sheet if args.sheet.is_absolute() else (Path.cwd() / args.sheet)
    image = Image.open(sheet).convert("RGBA")
    rgba = np.asarray(image)
    alpha = rgba[:, :, 3]
    w, h = image.size
    cw, ch = w / args.cols, h / args.rows

    print(f"— {sheet.name}: {w}×{h}, сетка {args.cols}×{args.rows}, клетка {cw:.1f}×{ch:.1f} "
          f"({'целочисленная' if cw == int(cw) and ch == int(ch) else 'НЕ целочисленная'})")
    solid = float((alpha >= 250).mean())
    soft = float(((alpha > 8) & (alpha < 250)).mean())
    print(f"  alpha≥250: {solid:.3f}, 8<alpha<250: {soft:.3f}, прозрачно: {1 - solid - soft:.3f}")

    report = {"sheet": str(sheet.relative_to(DEMO.parent.parent)), "size": [w, h],
              "grid": {"cols": args.cols, "rows": args.rows, "cell_w": cw, "cell_h": ch,
                       "integral": cw == int(cw) and ch == int(ch)},
              "rows": []}
    for r in range(args.rows):
        row = []
        for c in range(args.cols):
            x0, y0 = int(round(c * cw)), int(round(r * ch))
            x1, y1 = int(round((c + 1) * cw)), int(round((r + 1) * ch))
            stats = cell_stats(alpha, x0, y0, x1, y1)
            row.append(stats)
        report["rows"].append(row)
        filled = sum(1 for cell in row if cell)
        print(f"  строка {r}: непустых клеток {filled}/{args.cols}")

    # Превью с сеткой: синие линии — границы клеток, красные рамки — bbox содержимого.
    preview = image.copy()
    draw = ImageDraw.Draw(preview)
    for c in range(1, args.cols):
        draw.line([(c * cw, 0), (c * cw, h)], fill=(60, 130, 255, 255), width=2)
    for r in range(1, args.rows):
        draw.line([(0, r * ch), (w, r * ch)], fill=(60, 130, 255, 255), width=2)
    for r, row in enumerate(report["rows"]):
        for c, cell in enumerate(row):
            if not cell:
                continue
            bx0, by0, bx1, by1 = cell["bbox"]
            draw.rectangle([bx0, by0, bx1 - 1, by1 - 1], outline=(255, 70, 70, 255), width=2)
    scale = min(1.0, 1600.0 / w)
    if scale < 1.0:
        preview = preview.resize((int(w * scale), int(h * scale)))
    out = args.out or (DEMO / "authoring" / f"preview_{sheet.stem}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    preview.convert("RGB").save(out)
    print(f"  превью: {out}")

    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  отчёт: {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
