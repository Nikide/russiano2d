#!/usr/bin/env python3
"""Собрать локации для демо-новеллы (`demos/russi_vn`).

Стиль новеллы — плоская аниме-графика, и локации должны ей соответствовать:
фотопак с OpenGameArt для этого не годится. Поэтому здесь два источника:

* **готовые CC0-картинки** (аргументы ``--classroom`` и ``--sky``) — интерьер
  класса и небо для заката: их рисовать бессмысленно, а свободные аналоги
  нашлись на OpenGameArt;
* **процедурная графика** — комната, ночная улица, школьный двор и крыша
  (ограждение, силуэт города, вода на крыше): градиенты, силуэты, свечения и
  зерно. Рисуется кодом, значит лицензия на неё — та же CC0, что и на движок,
  и её можно править по вкусу.

Всё рисуется в двойном разрешении и уменьшается фильтром Ланцоша: у Pillow нет
сглаживания краёв, и без этого линии силуэтов выходили бы ступеньками.

Запуск::

    python3 tools/make_vn_backgrounds.py \\
        --classroom demos/assets/art/vn/src/classroom.jpg \\
        --sky demos/assets/art/vn/src/sky_sunset.jpg \\
        --out demos/assets/art/vn/bg \\
        --preview build/vn_src/bg_preview.png

Источники CC0 (OpenGameArt), имена в CREDITS демо-проекта:

* класс — «Classroom 002», https://opengameart.org/content/classroom-002
* небо  — «40 game backgrounds, painted style», https://opengameart.org/content/40-game-backgrounds-1-painted-style-and-photorealistic
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
except ImportError:  # pragma: no cover
    print("нужен Pillow: python3 -m pip install pillow", file=sys.stderr)
    raise SystemExit(2)

# Рендер в 2x и уменьшение — единственный способ получить гладкие края.
SCALE = 2
W, H = 1280, 720
RW, RH = W * SCALE, H * SCALE

SEED = 20261006


def rgba(color, alpha=255):
    if isinstance(color, tuple):
        return (color[0], color[1], color[2], alpha)
    text = color.lstrip('#')
    if len(text) == 3:
        text = ''.join(c * 2 for c in text)
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16), alpha)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    """Смешать два цвета (строки или кортежи) в долях t."""
    a, b = rgba(c1), rgba(c2)
    return tuple(int(round(lerp(a[i], b[i], t))) for i in range(3))


def vgrad(size, top, bottom):
    """Вертикальный градиент."""
    w, h = size
    image = Image.new('RGB', (1, h))
    pixels = image.load()
    for y in range(h):
        pixels[0, y] = mix(top, bottom, y / max(1, h - 1))
    return image.resize((w, h), Image.BILINEAR)


def glow(image, center, radius, color, alpha=180, power=2.0):
    """Мягкое свечение: круг на отдельном слое, размытый и наложенный."""
    layer = Image.new('RGBA', image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    steps = 26
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        a = int(alpha * (1 - t) ** power)
        if a <= 0 or r <= 0:
            continue
        draw.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r],
                     fill=rgba(color, a))
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.06))
    image.alpha_composite(layer) if image.mode == 'RGBA' else image.paste(
        Image.alpha_composite(image.convert('RGBA'), layer).convert('RGB'), (0, 0))
    return image


def blurred_layer(size, draw_fn, blur):
    """Слой с произвольной отрисовкой, размытый на blur пикселей."""
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return layer.filter(ImageFilter.GaussianBlur(blur)) if blur else layer


def over(base, layer):
    return Image.alpha_composite(base, layer)


def grain(image, amount=6):
    """Зерно: убирает «пластиковость» градиентов."""
    if amount <= 0:
        return image
    noise = Image.effect_noise(image.size, amount * 8).convert('L')
    noise = noise.point(lambda v: 128 + (v - 128) * 0.25)
    return Image.blend(image, Image.merge('RGB', (noise, noise, noise)), amount / 100.0)


def vignette(image, strength=0.45, spread=1.15):
    w, h = image.size
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    cx, cy = w / 2, h / 2
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps
        rx, ry = cx * spread * t, cy * spread * t
        draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=int(255 * (1 - t) ** 1.4))
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) * 0.05))
    dark = Image.new('RGB', (w, h), (0, 0, 0))
    return Image.composite(dark, image, mask.point(lambda v: int(v * strength)))


def stars(draw, count, seed, y_max, color='#ffffff'):
    rng = random.Random(seed)
    for _ in range(count):
        x = rng.uniform(0, RW)
        y = rng.uniform(0, y_max)
        r = rng.uniform(1.0, 2.6) * SCALE
        a = rng.randint(90, 220)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=rgba(color, a))


def window_grid(draw, box, cols, rows, seed, warm=0.75, lit=0.55):
    """Сетка светящихся окон — силуэты домов читаются как город, а не как стена."""
    rng = random.Random(seed)
    x0, y0, x1, y1 = box
    pad_x = (x1 - x0) * 0.10
    pad_y = (y1 - y0) * 0.10
    cw = (x1 - x0 - pad_x * 2) / cols
    ch = (y1 - y0 - pad_y * 2) / rows
    for row in range(rows):
        for col in range(cols):
            if rng.random() > lit:
                continue
            wx0 = x0 + pad_x + col * cw + cw * 0.18
            wy0 = y0 + pad_y + row * ch + ch * 0.20
            wx1 = wx0 + cw * 0.64
            wy1 = wy0 + ch * 0.52
            color = mix('#ffd9a0', '#9fd8ff', rng.random() if rng.random() > warm else 0.15)
            draw.rectangle([wx0, wy0, wx1, wy1], fill=rgba(color, rng.randint(150, 255)))


# ---------------------------------------------------------------------------
# Локации
# ---------------------------------------------------------------------------

def bedroom_night():
    """Комната ночью: окно с луной, свет монитора, кровать и полка."""
    rng = random.Random(SEED)
    base = vgrad((RW, RH), '#0a0f22', '#161d38').convert('RGBA')

    # Стена и пол.
    floor_y = int(RH * 0.74)
    draw = ImageDraw.Draw(base)
    draw.rectangle([0, floor_y, RW, RH], fill=rgba('#1b2033', 255))
    draw.rectangle([0, floor_y, RW, floor_y + 4 * SCALE], fill=rgba('#0c1020', 190))

    # Окно: ночное небо, луна, звёзды.
    wx0, wy0 = int(RW * 0.07), int(RH * 0.13)
    wx1, wy1 = int(RW * 0.44), int(RH * 0.62)
    sky = vgrad((wx1 - wx0, wy1 - wy0), '#101a3f', '#243063').convert('RGBA')
    sky_draw = ImageDraw.Draw(sky)
    moon = (int((wx1 - wx0) * 0.68), int((wy1 - wy0) * 0.26))
    sky_draw.ellipse([moon[0] - 26 * SCALE, moon[1] - 26 * SCALE,
                      moon[0] + 26 * SCALE, moon[1] + 26 * SCALE], fill=rgba('#f2f0e0', 255))
    for _ in range(40):
        x, y = rng.uniform(0, wx1 - wx0), rng.uniform(0, (wy1 - wy0) * 0.8)
        r = rng.uniform(1, 2.4) * SCALE
        sky_draw.ellipse([x - r, y - r, x + r, y + r], fill=rgba('#ffffff', rng.randint(80, 200)))
    sky = glow(sky.convert('RGBA'), moon, 150 * SCALE, '#cfd8ff', 90)
    base.paste(sky, (wx0, wy0))

    # Рама окна.
    draw = ImageDraw.Draw(base)
    draw.rectangle([wx0 - 5 * SCALE, wy0 - 5 * SCALE, wx1 + 5 * SCALE, wy1 + 5 * SCALE],
                   outline=rgba('#3b4668', 255), width=6 * SCALE)
    draw.line([(wx0 + (wx1 - wx0) / 2, wy0), (wx0 + (wx1 - wx0) / 2, wy1)],
              fill=rgba('#3b4668', 255), width=5 * SCALE)
    draw.line([(wx0, wy0 + (wy1 - wy0) / 2), (wx1, wy0 + (wy1 - wy0) / 2)],
              fill=rgba('#3b4668', 255), width=5 * SCALE)

    # Лунная дорожка на полу.
    pool = blurred_layer(base.size, lambda d: d.polygon(
        [(wx0, wy1), (wx1, wy1), (wx1 + 90 * SCALE, floor_y + 120 * SCALE), (wx0 - 70 * SCALE, floor_y + 120 * SCALE)],
        fill=rgba('#b9c8ff', 40)), 26 * SCALE)
    base = over(base, pool)

    # Стол, монитор, клавиатура.
    desk_y = int(RH * 0.66)
    draw = ImageDraw.Draw(base)
    draw.rectangle([int(RW * 0.52), desk_y, int(RW * 0.97), desk_y + 16 * SCALE], fill=rgba('#2a3350', 255))
    draw.rectangle([int(RW * 0.55), desk_y + 16 * SCALE, int(RW * 0.57), floor_y], fill=rgba('#222a44', 255))
    draw.rectangle([int(RW * 0.92), desk_y + 16 * SCALE, int(RW * 0.94), floor_y], fill=rgba('#222a44', 255))
    mx0, my0 = int(RW * 0.63), int(RH * 0.40)
    mx1, my1 = int(RW * 0.88), int(RH * 0.66)
    draw.rectangle([mx0, my0, mx1, my1], fill=rgba('#0d1730', 255), outline=rgba('#2d3a5c', 255), width=4 * SCALE)
    base = glow(base, ((mx0 + mx1) / 2, (my0 + my1) / 2), 150 * SCALE, '#4fd2ff', 60)
    screen = blurred_layer(base.size, lambda d: d.rectangle([mx0 + 6 * SCALE, my0 + 6 * SCALE, mx1 - 6 * SCALE, my1 - 8 * SCALE],
                                                            fill=rgba('#2ea8d8', 150)), 3 * SCALE)
    base = over(base, screen)
    draw = ImageDraw.Draw(base)
    for i in range(9):
        y = my0 + 22 * SCALE + i * 14 * SCALE
        if y > my1 - 14 * SCALE:
            break
        width = rng.uniform(0.25, 0.8) * (mx1 - mx0)
        color = '#8ff0d0' if i % 3 else '#ffd9a0'
        draw.rectangle([mx0 + 16 * SCALE, y, mx0 + 16 * SCALE + width, y + 5 * SCALE], fill=rgba(color, 190))
    # Свет монитора на столе и на стене.
    halo = blurred_layer(base.size, lambda d: d.ellipse(
        [mx0 - 260 * SCALE, my0 - 180 * SCALE, mx1 + 260 * SCALE, my1 + 220 * SCALE],
        fill=rgba('#3fb6e8', 46)), 70 * SCALE)
    base = over(base, halo)

    # Кровать слева внизу.
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle([int(-0.04 * RW), int(RH * 0.78), int(RW * 0.42), RH],
                           radius=18 * SCALE, fill=rgba('#2b3350', 255))
    draw.rounded_rectangle([int(RW * 0.01), int(RH * 0.76), int(RW * 0.16), int(RH * 0.86)],
                           radius=14 * SCALE, fill=rgba('#4a5478', 255))
    draw.rounded_rectangle([int(RW * 0.16), int(RH * 0.80), int(RW * 0.44), RH],
                           radius=16 * SCALE, fill=rgba('#3a4467', 255))

    # Полка с книгами и постер.
    draw.rectangle([int(RW * 0.50), int(RH * 0.16), int(RW * 0.72), int(RH * 0.17)],
                   fill=rgba('#39435f', 255))
    x = int(RW * 0.505)
    for i in range(11):
        w = rng.randint(9, 17) * SCALE
        h = rng.randint(34, 56) * SCALE
        color = mix('#7a4a6a', '#3f6f8a', rng.random())
        draw.rectangle([x, int(RH * 0.16) - h, x + w, int(RH * 0.16)], fill=rgba(color, 255))
        x += w + 2 * SCALE
    return grain(vignette(base.convert('RGB'), 0.5), 5)


def city_night():
    """Ночная улица: силуэты домов, неон, фонари и отражения на асфальте."""
    rng = random.Random(SEED + 7)
    base = vgrad((RW, RH), '#05070f', '#1a2140').convert('RGBA')
    draw = ImageDraw.Draw(base)
    stars(draw, 160, SEED + 3, RH * 0.42)
    base = glow(base, (RW * 0.78, RH * 0.16), 120 * SCALE, '#e8ecff', 70)

    road_y = int(RH * 0.78)
    layers = [
        (0.30, '#141a33', 0.60, 12),
        (0.42, '#0f1428', 0.72, 9),
        (0.54, '#0a0e1e', 0.86, 7),
    ]
    for index, (height, color, alpha, cols) in enumerate(layers):
        top = int(RH * (0.74 - height))
        x = -40 * SCALE
        while x < RW:
            w = rng.uniform(90, 220) * SCALE
            h = rng.uniform(0.45, 1.0) * (road_y - top)
            box = (x, road_y - h, x + w, road_y)
            draw.rectangle(box, fill=rgba(color, 255))
            if index >= 1:
                window_grid(draw, box, cols, max(3, int(cols * 0.7)), SEED + index * 11 + int(x))
            x += w + rng.uniform(6, 26) * SCALE
        # Дальние планы светлее — воздушная перспектива.
        haze = blurred_layer(base.size, lambda d: d.rectangle([0, top, RW, road_y], fill=rgba(color, 0)), 0)
        del haze

    # Неон: вывески с свечением.
    neon = [('#ff5fbf', 0.10, 0.20, 0.16, 0.030), ('#4fe3ff', 0.30, 0.34, 0.10, 0.026),
            ('#ffd166', 0.62, 0.24, 0.13, 0.030), ('#7dffb0', 0.80, 0.40, 0.08, 0.022)]
    for color, x, y, w, h in neon:
        box = [x * RW, y * RH, (x + w) * RW, (y + h) * RH]
        base = glow(base, ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2),
                    max(box[2] - box[0], box[3] - box[1]) * 1.6, color, 110)
        draw = ImageDraw.Draw(base)
        draw.rounded_rectangle(box, radius=6 * SCALE, fill=rgba(color, 235))

    # Фонари и дорога.
    draw = ImageDraw.Draw(base)
    draw.rectangle([0, road_y, RW, RH], fill=rgba('#0a0d18', 255))
    draw.line([(0, road_y), (RW, road_y)], fill=rgba('#2a3350', 255), width=3 * SCALE)
    for i, x in enumerate([0.16, 0.46, 0.74]):
        px = x * RW
        draw.rectangle([px - 3 * SCALE, RH * 0.30, px + 3 * SCALE, road_y], fill=rgba('#1b2138', 255))
        draw.rectangle([px - 30 * SCALE, RH * 0.30 - 6 * SCALE, px + 30 * SCALE, RH * 0.30 + 6 * SCALE],
                       fill=rgba('#232b45', 255))
        base = glow(base, (px, RH * 0.30), 190 * SCALE, '#ffd9a0', 95)
    # Отражения: вертикальные размытые полосы под неоном и фонарями.
    refl = blurred_layer(base.size, lambda d: [
        d.rectangle([(x + w / 2) * RW - 22 * SCALE, road_y, (x + w / 2) * RW + 22 * SCALE, RH],
                    fill=rgba(color, 70)) for color, x, y, w, h in neon], 22 * SCALE)
    base = over(base, refl)
    refl2 = blurred_layer(base.size, lambda d: [
        d.rectangle([x * RW - 34 * SCALE, road_y, x * RW + 34 * SCALE, RH], fill=rgba('#ffd9a0', 55))
        for x in (0.16, 0.46, 0.74)], 26 * SCALE)
    base = over(base, refl2)
    # Разметка.
    draw = ImageDraw.Draw(base)
    for i in range(9):
        x0 = i * RW / 9 + 20 * SCALE
        draw.rectangle([x0, RH * 0.90, x0 + 70 * SCALE, RH * 0.915], fill=rgba('#5b6480', 150))
    return grain(vignette(base.convert('RGB'), 0.55), 6)


def schoolyard_day():
    """Двор школы: небо, здание, деревья, забор и трава."""
    rng = random.Random(SEED + 21)
    base = vgrad((RW, RH), '#8fc4ee', '#dceaf6').convert('RGBA')

    # Облака.
    def draw_clouds(d):
        for _ in range(16):
            cx = rng.uniform(-0.05, 1.0) * RW
            cy = rng.uniform(0.03, 0.30) * RH
            cw = rng.uniform(0.10, 0.34) * RW
            chh = rng.uniform(0.04, 0.13) * RH
            d.ellipse([cx, cy, cx + cw, cy + chh], fill=rgba('#ffffff', 150))
            d.ellipse([cx + cw * 0.2, cy - chh * 0.5, cx + cw * 0.8, cy + chh * 0.7],
                      fill=rgba('#ffffff', 130))

    base = over(base, blurred_layer(base.size, draw_clouds, 24 * SCALE))

    ground_y = int(RH * 0.70)
    draw = ImageDraw.Draw(base)

    # Здание школы.
    bx0, bx1 = int(RW * 0.08), int(RW * 0.62)
    by0 = int(RH * 0.28)
    draw.rectangle([bx0, by0, bx1, ground_y], fill=rgba('#e6e2d8', 255))
    draw.rectangle([bx0 - 8 * SCALE, by0 - 14 * SCALE, bx1 + 8 * SCALE, by0],
                   fill=rgba('#b9b3a6', 255))
    window_grid(draw, (bx0 + 20 * SCALE, by0 + 30 * SCALE, bx1 - 20 * SCALE, ground_y - 60 * SCALE),
                6, 3, SEED + 5, warm=1.0, lit=1.0)
    draw.rectangle([int(RW * 0.30), ground_y - 90 * SCALE, int(RW * 0.40), ground_y],
                   fill=rgba('#8d7f6b', 255))

    # Деревья.
    for tx, scale in ((0.70, 1.0), (0.83, 0.8), (0.94, 1.15)):
        x = tx * RW
        draw.rectangle([x - 7 * SCALE * scale, ground_y - 120 * SCALE * scale,
                        x + 7 * SCALE * scale, ground_y], fill=rgba('#6b5138', 255))
        for _ in range(7):
            r = rng.uniform(38, 74) * SCALE * scale
            cx = x + rng.uniform(-40, 40) * SCALE * scale
            cy = ground_y - 150 * SCALE * scale + rng.uniform(-40, 40) * SCALE * scale
            color = mix('#3f7a3a', '#6fae52', rng.random())
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba(color, 255))

    # Земля, дорожка, забор.
    draw.rectangle([0, ground_y, RW, RH], fill=rgba('#6f9b4e', 255))
    draw.rectangle([0, ground_y, RW, ground_y + 8 * SCALE], fill=rgba('#5c8442', 255))
    draw.polygon([(RW * 0.36, ground_y), (RW * 0.62, ground_y), (RW * 0.78, RH), (RW * 0.20, RH)],
                 fill=rgba('#c9c2b0', 255))
    for x in range(0, int(RW), 46 * SCALE):
        draw.rectangle([x, ground_y - 60 * SCALE, x + 6 * SCALE, ground_y], fill=rgba('#cfd3d6', 255))
    draw.rectangle([0, ground_y - 66 * SCALE, RW, ground_y - 58 * SCALE], fill=rgba('#c3c8cc', 255))
    return grain(vignette(base.convert('RGB'), 0.35), 5)


def rooftop_sunset(sky_path):
    """Крыша на закате: CC0-небо + процедурная крыша, ограждение и город вдали."""
    rng = random.Random(SEED + 33)
    sky = Image.open(sky_path).convert('RGB')
    # Кадрируем под 16:9 и прогреваем: закат, а не полдень.
    ratio = W / H
    sw, sh = sky.size
    if sw / sh > ratio:
        new_w = int(sh * ratio)
        sky = sky.crop(((sw - new_w) // 2, 0, (sw - new_w) // 2 + new_w, sh))
    else:
        new_h = int(sw / ratio)
        sky = sky.crop((0, int((sh - new_h) * 0.35), sw, int((sh - new_h) * 0.35) + new_h))
    sky = sky.resize((RW, RH), Image.LANCZOS)
    sky = ImageEnhance.Color(sky).enhance(1.25)
    warm = vgrad((RW, RH), '#ff9a3c', '#ffd9a0').convert('RGBA')
    sky = Image.blend(sky.convert('RGBA'), warm, 0.30)

    base = sky
    base = glow(base, (RW * 0.30, RH * 0.80), 420 * SCALE, '#ffb066', 110)

    # Город вдали.
    draw = ImageDraw.Draw(base)
    horizon = int(RH * 0.76)
    x = -30 * SCALE
    while x < RW:
        w = rng.uniform(50, 130) * SCALE
        h = rng.uniform(30, 110) * SCALE
        draw.rectangle([x, horizon - h, x + w, horizon], fill=rgba('#6b5a76', 210))
        x += w + rng.uniform(4, 18) * SCALE
    far = blurred_layer(base.size, lambda d: d.rectangle([0, 0, RW, RH], fill=rgba('#000000', 0)), 0)
    del far
    base = over(base, blurred_layer(base.size, lambda d: d.rectangle(
        [0, 0, 0, 0], fill=rgba('#000000', 0)), 0))

    # Крыша.
    draw = ImageDraw.Draw(base)
    floor_y = int(RH * 0.78)
    draw.polygon([(0, RH), (RW, RH), (RW, floor_y), (0, floor_y - 10 * SCALE)],
                 fill=rgba('#4a4356', 255))
    draw.polygon([(0, RH), (RW, RH), (RW, floor_y + 40 * SCALE), (0, floor_y + 34 * SCALE)],
                 fill=rgba('#3b3547', 255))

    # Ограждение: стойки, поручни и сетка.
    rail_y0 = int(RH * 0.50)
    rail_y1 = int(RH * 0.60)
    draw.rectangle([0, rail_y1, RW, rail_y1 + 7 * SCALE], fill=rgba('#d9d2c4', 235))
    for x in range(0, int(RW) + 1, 92 * SCALE):
        draw.rectangle([x, rail_y0, x + 7 * SCALE, floor_y + 8 * SCALE], fill=rgba('#cfc7b8', 225))
    for i in range(-int(RH), int(RW), 18 * SCALE):
        draw.line([(i, rail_y0), (i + (floor_y - rail_y0) * 0.5, floor_y)],
                  fill=rgba('#b9b2a4', 70), width=2 * SCALE)
        draw.line([(i, rail_y0), (i - (floor_y - rail_y0) * 0.5, floor_y)],
                  fill=rgba('#b9b2a4', 70), width=2 * SCALE)

    # Бак с водой и труба — чтобы крыша читалась как крыша.
    draw.rectangle([int(RW * 0.78), int(RH * 0.30), int(RW * 0.92), int(RH * 0.52)],
                   fill=rgba('#5c5468', 255))
    draw.polygon([(RW * 0.76, RH * 0.30), (RW * 0.94, RH * 0.30), (RW * 0.90, RH * 0.24), (RW * 0.80, RH * 0.24)],
                 fill=rgba('#6a6178', 255))
    for i in range(4):
        y = RH * 0.34 + i * 24 * SCALE
        draw.line([(RW * 0.78, y), (RW * 0.92, y)], fill=rgba('#4c4557', 255), width=3 * SCALE)
    base = glow(base, (RW * 0.30, RH * 0.80), 220 * SCALE, '#ffcf9a', 60)
    return grain(vignette(base.convert('RGB'), 0.4), 5)


def classroom_day(photo_path):
    """Класс: CC0-фото + передний план из парт и тёплый свет из окон."""
    photo = Image.open(photo_path).convert('RGB')
    ratio = W / H
    sw, sh = photo.size
    if sw / sh > ratio:
        new_w = int(sh * ratio)
        photo = photo.crop(((sw - new_w) // 2, 0, (sw - new_w) // 2 + new_w, sh))
    else:
        new_h = int(sw / ratio)
        photo = photo.crop((0, int((sh - new_h) * 0.25), sw, int((sh - new_h) * 0.25) + new_h))
    base = photo.resize((RW, RH), Image.LANCZOS).convert('RGBA')
    base = ImageEnhance.Color(base).enhance(1.08)

    # Тёплый свет из окон и лёгкая дымка.
    base = over(base, blurred_layer(base.size, lambda d: d.rectangle(
        [0, 0, RW, RH], fill=rgba('#ffe9c4', 26)), 40 * SCALE))

    # Передний план: парты — иначе фото читается как коридор, а не как класс.
    draw = ImageDraw.Draw(base)
    for i, (x, w, h) in enumerate([(-0.02, 0.30, 0.16), (0.30, 0.34, 0.20), (0.68, 0.36, 0.17)]):
        x0 = x * RW
        x1 = (x + w) * RW
        y0 = RH * (1.0 - h)
        draw.rounded_rectangle([x0, y0, x1, RH], radius=14 * SCALE, fill=rgba('#6d5a48', 245))
        draw.rounded_rectangle([x0 + 8 * SCALE, y0 - 16 * SCALE, x1 - 8 * SCALE, y0 + 10 * SCALE],
                               radius=10 * SCALE, fill=rgba('#8a7359', 245))
        shade = blurred_layer(base.size, lambda d: d.rectangle([x0, y0, x1, RH], fill=rgba('#2a1f14', 40)), 12 * SCALE)
        base = over(base, shade)
    return grain(vignette(base.convert('RGB'), 0.35), 4)


LOCATIONS = {
    'bedroom_night': lambda args: bedroom_night(),
    'city_night': lambda args: city_night(),
    'schoolyard_day': lambda args: schoolyard_day(),
    'rooftop_sunset': lambda args: rooftop_sunset(args.sky),
    'classroom_day': lambda args: classroom_day(args.classroom),
}


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', default='demos/assets/art/vn/bg')
    parser.add_argument('--classroom', default='demos/assets/art/vn/src/classroom.jpg')
    parser.add_argument('--sky', default='demos/assets/art/vn/src/sky_sunset.jpg')
    parser.add_argument('--only', default='', help='сделать только эти локации (через запятую)')
    parser.add_argument('--preview', default='', help='собрать контрольный лист по этому пути')
    args = parser.parse_args(argv)

    wanted = [name.strip() for name in args.only.split(',') if name.strip()] or list(LOCATIONS)
    os.makedirs(args.out, exist_ok=True)
    made = []
    for name in wanted:
        builder = LOCATIONS.get(name)
        if not builder:
            print(f'не знаю локацию «{name}»', file=sys.stderr)
            continue
        if name == 'classroom_day' and not os.path.exists(args.classroom):
            print(f'пропускаю class: нет {args.classroom}', file=sys.stderr)
            continue
        if name == 'rooftop_sunset' and not os.path.exists(args.sky):
            print(f'пропускаю roof: нет {args.sky}', file=sys.stderr)
            continue
        image = builder(args).resize((W, H), Image.LANCZOS)
        path = os.path.join(args.out, name + '.png')
        image.save(path, 'PNG', optimize=True)
        made.append((name, image))
        print(f'→ {path} {W}x{H} {os.path.getsize(path) // 1024} КБ')

    if args.preview and made:
        cols = min(3, len(made))
        rows = math.ceil(len(made) / cols)
        cw, ch = 420, 236
        sheet = Image.new('RGB', (cols * cw, rows * ch), (12, 14, 22))
        draw = ImageDraw.Draw(sheet)
        for index, (name, image) in enumerate(made):
            thumb = image.copy()
            thumb.thumbnail((cw - 8, ch - 24))
            x = (index % cols) * cw
            y = (index // cols) * ch
            sheet.paste(thumb, (x + 4, y + 4))
            draw.text((x + 6, y + ch - 18), name, fill=(255, 220, 150))
        os.makedirs(os.path.dirname(os.path.abspath(args.preview)), exist_ok=True)
        sheet.save(args.preview)
        print(f'→ {args.preview} {sheet.size[0]}x{sheet.size[1]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
