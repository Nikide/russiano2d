#!/usr/bin/env python3
"""Готовит компактные ассеты для демо из исходных листов 1536x2304.

Исходники лежат вне репозитория (по умолчанию — каталог из R2D_SOURCE_ART).
Скрипт уменьшает их и раскладывает в demos/assets/art/, потому что класть в git
две сотни мегабайт PNG нельзя.

    python3 tools/make_demo_assets.py [каталог-с-исходниками]

Раскладка на выходе:

    demos/assets/art/characters/<имя>.png    анимационный лист 8x9 (клетка 48x64)
    demos/assets/art/weapons/<имя>.png       листы оружия от первого лица
    demos/assets/art/portraits/<имя>.png     одиночные крупные рендеры
    demos/assets/art/posters/menu.png        постер для меню
    demos/assets/art/manifest.json           размеры, сетки и имена

Листы устроены одинаково (проверено нарезкой):
    столбцы 0..7 — фазы анимации, строки 0..8 — состояния;
    ряд 4 — выстрел со вспышкой, ряд 8 — смерть.
"""

from __future__ import annotations

import json
import os
import sys

from PIL import Image

DEFAULT_SOURCE = "/Users/nikitademcev/Documents/22/outputs"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "demos", "assets", "art")

GRID_COLS = 8
GRID_ROWS = 9
SHEET_CELL_W = 48          # итоговый размер клетки
SHEET_CELL_H = 64
PORTRAIT_MAX = 512
POSTER_SIZE = (1280, 720)

# Что считаем оружием от первого лица.
WEAPON_MARKERS = ("doom_sheet", "first_person", "arsenal", "fists")
# Листы-«портреты» (HUD) нарезаются так же, как персонажи: это та же сетка 8x9.
CHARACTER_MARKERS = ("8x9", "sprite_sheet", "sprite_sheets", "portrait_sheet")


def slug(name: str) -> str:
    base = os.path.splitext(name)[0]
    return base


def classify(filename: str) -> str:
    low = filename.lower()
    if "main_menu_poster" in low:
        return "poster"
    if any(m in low for m in WEAPON_MARKERS):
        return "weapon"
    if any(m in low for m in CHARACTER_MARKERS):
        return "character"
    return "portrait"


def save_sheet(src_path: str, dst_path: str, cols: int, rows: int) -> dict:
    im = Image.open(src_path).convert("RGBA")
    w, h = im.size
    target = (SHEET_CELL_W * cols, SHEET_CELL_H * rows)
    im = im.resize(target, Image.LANCZOS)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    im.save(dst_path, optimize=True)
    return {
        "file": os.path.relpath(dst_path, OUT).replace(os.sep, "/"),
        "width": target[0],
        "height": target[1],
        "grid": {"cols": cols, "rows": rows,
                 "cell_w": SHEET_CELL_W, "cell_h": SHEET_CELL_H},
        "source_size": [w, h],
    }


def save_image(src_path: str, dst_path: str, max_side: int | None = None,
               exact: tuple[int, int] | None = None) -> dict:
    im = Image.open(src_path).convert("RGBA")
    w, h = im.size
    if exact is not None:
        im = im.resize(exact, Image.LANCZOS)
    elif max_side is not None and max(w, h) > max_side:
        scale = max_side / float(max(w, h))
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    im.save(dst_path, optimize=True)
    return {
        "file": os.path.relpath(dst_path, OUT).replace(os.sep, "/"),
        "width": im.width,
        "height": im.height,
        "source_size": [w, h],
    }


def main() -> int:
    source = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("R2D_SOURCE_ART", DEFAULT_SOURCE)

    if not os.path.isdir(source):
        print(f"нет каталога с исходниками: {source}", file=sys.stderr)
        return 1

    names = sorted(f for f in os.listdir(source) if f.lower().endswith(".png"))
    if not names:
        print(f"в {source} нет PNG", file=sys.stderr)
        return 1

    # В исходниках лежат почти одинаковые варианты одного листа: base, _clean,
    # _final. Держим только один — иначе репозиторий пухнет втрое.
    present = set(names)
    deduped: list[str] = []
    for name in names:
        stem = os.path.splitext(name)[0]
        for suffix in ("_clean", "_final"):
            if stem.endswith(suffix):
                plain = stem[: -len(suffix)] + ".png"
                if plain in present:
                    break
        else:
            deduped.append(name)
    skipped = len(names) - len(deduped)
    names = deduped

    manifest: dict[str, list] = {"characters": [], "weapons": [], "portraits": [], "posters": []}
    total_bytes = 0

    for name in names:
        src = os.path.join(source, name)
        kind = classify(name)
        base = slug(name)

        try:
            if kind == "poster":
                info = save_image(src, os.path.join(OUT, "posters", "menu.png"), exact=POSTER_SIZE)
                manifest["posters"].append({"name": "menu", **info})
                continue

            if kind in ("character", "weapon"):
                folder = "characters" if kind == "character" else "weapons"
                info = save_sheet(src, os.path.join(OUT, folder, base + ".png"),
                                  GRID_COLS, GRID_ROWS)
                manifest[folder].append({"name": base, **info})
            else:
                info = save_image(src, os.path.join(OUT, "portraits", base + ".png"),
                                  max_side=PORTRAIT_MAX)
                manifest["portraits"].append({"name": base, **info})
        except Exception as exc:  # noqa: BLE001
            print(f"  пропущен {name}: {exc}", file=sys.stderr)

    # Пояснения к анимационному листу — чтобы демо не хардкодили магию.
    manifest["sheet_layout"] = {
        "cols": GRID_COLS,
        "rows": GRID_ROWS,
        "cell_w": SHEET_CELL_W,
        "cell_h": SHEET_CELL_H,
        "notes": "столбцы — фазы анимации; ряд 4 — выстрел со вспышкой; ряд 8 — смерть",
    }
    manifest["source"] = source

    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    for root, _dirs, files in os.walk(OUT):
        for f in files:
            total_bytes += os.path.getsize(os.path.join(root, f))

    print(f"записано в {OUT}")
    print(f"  персонажей: {len(manifest['characters'])}")
    print(f"  оружия:     {len(manifest['weapons'])}")
    print(f"  портретов:  {len(manifest['portraits'])}")
    print(f"  постеров:   {len(manifest['posters'])}")
    print(f"  всего на диске: {total_bytes / 1024 / 1024:.1f} МБ")
    print(f"  манифест: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
