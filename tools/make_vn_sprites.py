#!/usr/bin/env python3
"""Подготовить спрайты героини для демо-новеллы (`demos/russi_vn`).

На вход — PNG-позы персонажа, на выходе — те же позы с прозрачным фоном,
обрезанные по ОБЩЕЙ рамке, чтобы смена позы в игре не двигала персонажа ни на
пиксель.

Что делает по шагам:

1. **Фон.** Если у исходника уже есть альфа-канал (обычный случай: генератор
   отдаёт PNG с прозрачным фоном) — он берётся как есть, только подчищаются
   почти невидимые пиксели (alpha < 8 → 0). Если альфы нет — фон вырезается:
   кандидат в фон это «почти белый и почти серый» пиксель, из кандидатов
   берётся только связная область, касающаяся края (заливка от угла), поэтому
   белая рубашка и белые чулки персонажа остаются на месте — их отделяет контур.
2. **Кайма.** Полупрозрачные пиксели по краю — это смесь персонажа с белым
   фоном; при ``--defringe`` (по умолчанию включено) белый из них вычитается,
   иначе на тёмной локации вокруг персонажа светится ореол.
3. **Общая рамка.** Считаются рамки непрозрачных пикселей у всех поз, берётся
   их объединение плюс отступ — и все позы режутся по одной и той же рамке.
   Именно поэтому позы взаимозаменяемы: у файлов одинаковая ширина и высота,
   а персонаж стоит в одной и той же точке кадра.
4. **Уменьшение.** Итоговые файлы масштабируются до ``--height`` (по умолчанию
   1152 px) — этого хватает и на экран 720p, и на наезд камеры, а весит втрое
   меньше исходников.

Запуск::

    python3 tools/make_vn_sprites.py --src build/vn_src --out demos/assets/art/vn/russi
    python3 tools/make_vn_sprites.py --src build/vn_src --preview build/vn_src/preview.png

Исходники инструмент не изменяет: он только читает ``--src``.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover - сообщение важнее трейсбека
    print("нужен Pillow: python3 -m pip install pillow", file=sys.stderr)
    raise SystemExit(2)

# Позы, которые ждёт демо. Файл называется <pose>.png (russi_neutral.png …).
POSES = ["neutral", "happy", "blush", "shy", "angry", "jealous", "caring"]

# Порог «почти белого» фона. Ниже 235 начинают выгрызаться светлые блики на
# чулках и рубашке, выше 245 — остаётся сероватая кайма от сжатия.
WHITE_MIN = 235
WHITE_SPREAD = 10

# Отступ вокруг общей рамки, px (в исходном масштабе).
PAD = 8


def cut_out(image: Image.Image, defringe: bool = True) -> Image.Image:
    """Вернуть RGBA-картинку с прозрачным фоном.

    Альфа исходника — истина в последней инстанции: если она есть, фон уже
    вырезан генератором, и повторное вырезание только испортило бы белые
    детали одежды.
    """
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")

    if alpha.getextrema()[0] < 250:          # альфа есть — доверяем ей
        cleaned = alpha.point(lambda v: 0 if v < 8 else v)
    else:                                     # сплошной фон — вырезаем
        cleaned = mask_from_white(rgba)

    if defringe:
        rgba = remove_white_fringe(rgba, cleaned)
    rgba.putalpha(cleaned)
    return rgba


def mask_from_white(image: Image.Image) -> Image.Image:
    """Маска непрозрачного: фон — связная «почти белая» область от края."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()

    mask = Image.new("L", (width, height), 0)
    out = mask.load()
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if min(r, g, b) >= WHITE_MIN and (max(r, g, b) - min(r, g, b)) <= WHITE_SPREAD:
                out[x, y] = 255

    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        if out[seed[0], seed[1]] == 255:
            ImageDraw.floodfill(mask, seed, 128, thresh=0)

    bg = mask.point(lambda v: 255 if v == 128 else 0)
    # Эрозия на 1 px убирает белую кайму по контуру, размытие смягчает ступеньку.
    fg = bg.point(lambda v: 0 if v else 255).filter(ImageFilter.MinFilter(3))
    return fg.filter(ImageFilter.GaussianBlur(0.6))


def remove_white_fringe(image: Image.Image, alpha: Image.Image) -> Image.Image:
    """Убрать белый фон из полупрозрачных пикселей края.

    Край персонажа — это смесь ``c*a + white*(1-a)``. Обратно цвет считается
    как ``(c - white*(1-a)) / a``: без этого на тёмной локации вокруг Руси-тян
    светилась бы белая кромка. Яркость зажимается в 0..255, так что вычитание
    не может «сжечь» пиксель в отрицательное значение.
    """
    width, height = image.size
    src = image.load()
    mask = alpha.load()
    for y in range(height):
        for x in range(width):
            a = mask[x, y]
            if a == 0 or a == 255:
                continue
            cover = a / 255.0
            r, g, b, _ = src[x, y]
            src[x, y] = (
                max(0, min(255, int(round((r - 255 * (1 - cover)) / cover)))),
                max(0, min(255, int(round((g - 255 * (1 - cover)) / cover)))),
                max(0, min(255, int(round((b - 255 * (1 - cover)) / cover)))),
                a,
            )
    return image


def content_box(image: Image.Image) -> tuple[int, int, int, int]:
    """Рамка непрозрачных пикселей (alpha > 8)."""
    alpha = image.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    box = alpha.getbbox()
    if box is None:
        raise SystemExit("не нашёл персонажа: картинка целиком прозрачная")
    return box


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", default="build/vn_src",
                        help="каталог с russi_<поза>.png (по умолчанию build/vn_src)")
    parser.add_argument("--out", default="demos/assets/art/vn/russi",
                        help="куда положить готовые спрайты")
    parser.add_argument("--poses", default=",".join(POSES),
                        help="список поз через запятую")
    parser.add_argument("--height", type=int, default=1152,
                        help="высота общего кадра после уменьшения (0 — не уменьшать)")
    parser.add_argument("--pad", type=int, default=PAD, help="отступ вокруг общей рамки")
    parser.add_argument("--no-defringe", dest="defringe", action="store_false",
                        help="не вычитать белый фон из полупрозрачного края")
    parser.set_defaults(defringe=True)
    parser.add_argument("--preview", default="",
                        help="собрать контрольный лист поз по этому пути")
    parser.add_argument("--preview-bg", default="#1a2233",
                        help="цвет фона контрольного листа")
    args = parser.parse_args(argv)

    poses = [p.strip() for p in args.poses.split(",") if p.strip()]
    sources: list[tuple[str, str]] = []
    for pose in poses:
        path = os.path.join(args.src, f"russi_{pose}.png")
        if not os.path.exists(path):
            print(f"пропускаю позу «{pose}»: нет файла {path}", file=sys.stderr)
            continue
        sources.append((pose, path))
    if not sources:
        print(f"в {args.src} не нашлось ни одного russi_<поза>.png", file=sys.stderr)
        return 1

    cut: list[tuple[str, Image.Image, tuple[int, int, int, int]]] = []
    for pose, path in sources:
        image = cut_out(Image.open(path), args.defringe)
        box = content_box(image)
        cut.append((pose, image, box))
        print(f"{pose:8s} {os.path.basename(path):22s} рамка {box}")

    # Общая рамка: объединение рамок всех поз. Позы взаимозаменяемы только
    # тогда, когда кадр у них один и тот же.
    left = min(b[0] for _, _, b in cut)
    top = min(b[1] for _, _, b in cut)
    right = max(b[2] for _, _, b in cut)
    bottom = max(b[3] for _, _, b in cut)
    width, height = cut[0][1].size
    left = max(0, left - args.pad)
    top = max(0, top - args.pad)
    right = min(width, right + args.pad)
    bottom = min(height, bottom + args.pad)
    frame = (left, top, right, bottom)
    print(f"общая рамка {frame} → {right - left}x{bottom - top}")

    scale = 1.0
    if args.height > 0:
        scale = args.height / float(bottom - top)
    out_size = (max(1, round((right - left) * scale)), max(1, round((bottom - top) * scale)))

    os.makedirs(args.out, exist_ok=True)
    manifest = {"poses": {}, "frame": list(frame), "size": list(out_size)}
    for pose, image, _box in cut:
        sprite = image.crop(frame)
        if scale != 1.0:
            sprite = sprite.resize(out_size, Image.LANCZOS)
        out_path = os.path.join(args.out, f"russi_{pose}.png")
        sprite.save(out_path, "PNG", optimize=True)
        manifest["poses"][pose] = os.path.basename(out_path)
        print(f"→ {out_path} {out_size[0]}x{out_size[1]} "
              f"{os.path.getsize(out_path) // 1024} КБ")

    manifest_path = os.path.join(args.out, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    print(f"→ {manifest_path}")

    if args.preview:
        cell_w, cell_h = out_size
        sheet = Image.new("RGBA", (cell_w * len(cut), cell_h), args.preview_bg)
        for index, (pose, image, _box) in enumerate(cut):
            sprite = image.crop(frame)
            if scale != 1.0:
                sprite = sprite.resize(out_size, Image.LANCZOS)
            sheet.alpha_composite(sprite, (index * cell_w, 0))
        os.makedirs(os.path.dirname(os.path.abspath(args.preview)), exist_ok=True)
        sheet.convert("RGB").save(args.preview, "PNG")
        print(f"→ {args.preview} {sheet.size[0]}x{sheet.size[1]} (контрольный лист)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
