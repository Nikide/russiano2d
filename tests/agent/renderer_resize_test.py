#!/usr/bin/env python3
# ===========================================================================
# §40: смена размера кадра (renderer resize).
#
# Тест последовательно меняет размер окна 640x480 → 320x240 → 800x600 →
# 1024x768 → 640x480 и после каждой смены проверяет на живом движке:
#   * `$.window.size()`/`pixels()` и `renderInfo().viewport` совпадают с новым
#     размером (viewport — значение из C, а не из JS-состояния);
#   * кадр не пустой: скриншот нужного размера, средняя яркость выше нуля,
#     маркер в центре — цвета, которые отдаёт фикстура;
#   * worldToScreen следует за размером: точка камеры даёт центр кадра, проба
#     (+100 по X) — (w/2+100, h/2), и нарисованный пиксель совпадает с этой
#     координатой;
#   * камера не уезжает: позиция/зум те же, что до смены размера;
#   * счётчики не растут: число живых текстур и состав списка целей те же, а
#     сами цели (z-буфер, цель сцены, буферы свечения) пересозданы под НОВЫЙ
#     размер, а не остались от прежнего (stale target handles).
#
# Две фазы, потому что пост-обработка меняет цвета кадра (свечение поднимает
# яркость): точные цвета проверяются с выключенным постом, а пересоздание
# offscreen-целей — с включённым. Смешивать это в одной фазе значило бы
# сравнивать цвет с числом, которое шейдер поста уже изменил.
#
# Скриншоты пишутся во временный каталог (не в корень репозитория).
#
# Запуск (после сборки):
#   python3 tests/agent/renderer_resize_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/renderer_resize_test.py
# ===========================================================================

import os
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "resize")

# Начальный размер фикстуры и последовательность смен (в конце — возврат).
START = (640, 480)
SIZES = [(320, 240), (800, 600), (1024, 768), START]
# С включённым постом достаточно двух смен: проверяются цели, а не картинка.
SIZES_POST = [(320, 240), (800, 600)]

# Средняя яркость кадра «не чёрный»: фон мира #14202c даёт ~31, чёрный кадр — 0.
MIN_MEAN_LUMA = 8.0
# Допуск на пиксель при сравнении цвета в точке замера (UNORM8 + округление).
COLOR_TOLERANCE = 6

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


# ---------------------------------------------------------------------------
# Разбор PNG — тот же, что в tests/agent/light_receiver_mask_test.py.
# ---------------------------------------------------------------------------
def read_png(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG: " + path)
    pos = 8
    width = height = channels = 0
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise ValueError("неподдерживаемый PNG")
            channels = 3 if color_type == 2 else 4
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    offset = 0
    for y in range(height):
        filt = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        if filt == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filt == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filt == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = prev[i]
                upleft = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(up - upleft), abs(left - upleft), abs(left + up - 2 * upleft)
                pred = left if (pa <= pb and pa <= pc) else (up if pb <= pc else upleft)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, bytes(out)


def avg_pixel(image, x, y, half=3):
    width, height, channels, data = image
    x = int(round(x))
    y = int(round(y))
    total = [0, 0, 0]
    count = 0
    for yy in range(max(0, y - half), min(height, y + half + 1)):
        row = yy * width
        for xx in range(max(0, x - half), min(width, x + half + 1)):
            o = (row + xx) * channels
            total[0] += data[o]
            total[1] += data[o + 1]
            total[2] += data[o + 2]
            count += 1
    return tuple(v / float(max(1, count)) for v in total)


def mean_luma(image):
    width, height, channels, data = image
    total = 0
    for i in range(width * height):
        o = i * channels
        total += data[o] + data[o + 1] + data[o + 2]
    return total / float(max(1, width * height * 3))


def near(a, b, eps=COLOR_TOLERANCE):
    return abs(a - b) <= eps


def color_near(got, want, eps=COLOR_TOLERANCE):
    return all(near(got[i], want[i], eps) for i in range(3))


def resize_to(a, w, h):
    """Сменить размер и дождаться, пока движок его увидит (событие — до кадра)."""
    a.eval("$.window.resize(%d, %d); 'ok'" % (w, h))
    for _ in range(12):
        a.step(1)
        if a.eval("$.window.size()") == {"w": w, "h": h}:
            return True
    return False


def target_map(info):
    return {t["name"]: t for t in (info.get("targets") or [])}


def shoot(a, shots, tag):
    path = a.screenshot(os.path.join(shots, "%s.png" % tag))
    return read_png(path), path


def phase_plain(a, shots, anchor):
    """Пост выключен: цвета кадра читаются как есть."""
    print("  --   фаза 1: пост выключен, точные цвета и координаты")
    a.eval("$.gfx.post({ on: false }); 'ok'")
    a.step(3)

    cam = anchor["camera"]
    colors = anchor["colors"]
    info = a.eval("engine.renderInfo()")
    base_targets = sorted(target_map(info))
    base_textures = info["textures"]["count"]
    base_pixels = info["textures"]["pixels"]
    print("  --   база: цели %s, текстур %d (%s px)" % (base_targets, base_textures, base_pixels))

    for (w, h) in SIZES:
        print("  --   меняем размер на %dx%d" % (w, h))
        check(resize_to(a, w, h),
              "%dx%d: движок увидел новый размер (%s)" % (w, h, a.eval("$.window.size()")))
        a.step(2)

        info = a.eval("engine.renderInfo()")
        size = a.eval("$.window.size()")
        pixels = a.eval("$.window.pixels()")
        vp = info.get("viewport") or {}
        check(size == {"w": w, "h": h},
              "%dx%d: $.window.size() совпал (%s)" % (w, h, size))
        check(vp.get("w") == w and vp.get("h") == h,
              "%dx%d: renderInfo().viewport совпал (%sx%s)" % (w, h, vp.get("w"), vp.get("h")))
        check(a.eval("engine.width") == w and a.eval("engine.height") == h,
              "%dx%d: engine.width/height совпали (%sx%s)"
              % (w, h, a.eval("engine.width"), a.eval("engine.height")))

        # --- Кадр не пустой -----------------------------------------------------
        img, path = shoot(a, shots, "plain_%dx%d" % (w, h))
        iw, ih, _, _ = img
        check((iw, ih) == (pixels["w"], pixels["h"]),
              "%dx%d: скриншот размером с буфер кадра (%dx%d)" % (w, h, iw, ih))
        luma = mean_luma(img)
        check(luma >= MIN_MEAN_LUMA,
              "%dx%d: кадр не чёрный (средняя яркость %.1f >= %.1f)" % (w, h, luma, MIN_MEAN_LUMA))

        # Координаты точки замера — в пикселях буфера (HiDPI-безопасно).
        sx = pixels["w"] / float(max(1, w))
        sy = pixels["h"] / float(max(1, h))

        # --- worldToScreen следует за новым размером ----------------------------
        centre = a.eval("$.camera.worldToScreen({ x: %d, y: %d })" % (cam["x"], cam["y"]))
        check(near(centre["x"], w / 2.0) and near(centre["y"], h / 2.0),
              "%dx%d: точка камеры в центре кадра через worldToScreen (%s, %s)"
              % (w, h, centre["x"], centre["y"]))
        probe_screen = a.eval("$('#probe').globalPos()")
        want_px = w / 2.0 + anchor["probe"]["offset"]
        check(near(probe_screen["x"], want_px) and near(probe_screen["y"], h / 2.0),
              "%dx%d: проба (+%d по X) на экране в (%.1f, %.1f), ждали (%.1f, %.1f)"
              % (w, h, anchor["probe"]["offset"], probe_screen["x"], probe_screen["y"],
                 want_px, h / 2.0))

        # --- Нарисованное совпадает с координатами и камерой --------------------
        marker = avg_pixel(img, (w / 2.0) * sx, (h / 2.0) * sy)
        check(color_near(marker, colors["marker"]),
              "%dx%d: маркер в центре кадра (%s ≈ %s)"
              % (w, h, tuple(round(v) for v in marker), colors["marker"]))
        probe = avg_pixel(img, probe_screen["x"] * sx, probe_screen["y"] * sy, half=2)
        check(color_near(probe, colors["probe"]),
              "%dx%d: проба нарисована там, где её считает worldToScreen (%s ≈ %s)"
              % (w, h, tuple(round(v) for v in probe), colors["probe"]))
        corner = avg_pixel(img, 4 * sx, 4 * sy, half=2)
        check(color_near(corner, colors["bg"]),
              "%dx%d: фон мира по углу кадра (%s ≈ %s)"
              % (w, h, tuple(round(v) for v in corner), colors["bg"]))

        # --- Камера не уехала ---------------------------------------------------
        pos = a.eval("$.camera.pos()")
        check(near(pos["x"], cam["x"], 0.001) and near(pos["y"], cam["y"], 0.001)
              and near(a.eval("$.camera.zoom()"), anchor["zoom"], 0.001),
              "%dx%d: камера на месте (%s, %s), зум %s"
              % (w, h, pos["x"], pos["y"], a.eval("$.camera.zoom()")))

        # --- Счётчики не растут, цели — под новый размер ------------------------
        targets = target_map(info)
        check(sorted(targets) == base_targets,
              "%dx%d: состав целей не изменился (%s)" % (w, h, sorted(targets)))
        check(len(targets) <= len(base_targets),
              "%dx%d: целей не больше, чем в базе (%d <= %d)"
              % (w, h, len(targets), len(base_targets)))
        check(targets.get("depth", {}).get("w") == pixels["w"]
              and targets.get("depth", {}).get("h") == pixels["h"],
              "%dx%d: z-буфер пересоздан под новый буфер (%sx%s)"
              % (w, h, targets.get("depth", {}).get("w"), targets.get("depth", {}).get("h")))
        tex = info.get("textures") or {}
        check(tex.get("count") == base_textures,
              "%dx%d: живых текстур столько же (%s == %d)"
              % (w, h, tex.get("count"), base_textures))
        check(tex.get("pixels") == base_pixels,
              "%dx%d: суммарный размер текстур не вырос (%s == %s)"
              % (w, h, tex.get("pixels"), base_pixels))
        print("  --   кадр %s: %dx%d, яркость %.1f" % (os.path.basename(path), iw, ih, luma))


def phase_post(a, shots, anchor):
    """Пост включён: проверяется пересоздание offscreen-целей при смене размера."""
    print("  --   фаза 2: пост включён, пересоздание целей сцены и свечения")
    a.eval("$.gfx.post({ glow: 1.0 }); 'ok'")
    a.step(3)

    info = a.eval("engine.renderInfo()")
    names = sorted(target_map(info))
    base_targets = len(names)
    base_textures = info["textures"]["count"]
    start_size = a.eval("$.window.size()")
    check("scene" in names and "bloom_a" in names and "depth" in names,
          "с постом есть цели сцены, свечения и глубины: %s" % names)
    check(info["scene_w"] == start_size["w"] and info["scene_h"] == start_size["h"],
          "цель сцены совпадает с кадром: %sx%s" % (info["scene_w"], info["scene_h"]))

    for (w, h) in SIZES_POST:
        print("  --   меняем размер на %dx%d (пост)" % (w, h))
        check(resize_to(a, w, h),
              "%dx%d: движок увидел новый размер (%s)" % (w, h, a.eval("$.window.size()")))
        a.step(2)

        info = a.eval("engine.renderInfo()")
        pixels = a.eval("$.window.pixels()")
        vp = info.get("viewport") or {}
        check(vp.get("w") == w and vp.get("h") == h,
              "%dx%d: renderInfo().viewport совпал (%sx%s)" % (w, h, vp.get("w"), vp.get("h")))
        targets = target_map(info)
        check(sorted(targets) == names,
              "%dx%d: состав целей не изменился (%s)" % (w, h, sorted(targets)))
        check(len(targets) <= base_targets,
              "%dx%d: целей не больше, чем в базе (%d <= %d)"
              % (w, h, len(targets), base_targets))
        check(targets.get("scene", {}).get("w") == pixels["w"]
              and targets.get("scene", {}).get("h") == pixels["h"],
              "%dx%d: цель сцены пересоздана под новый буфер (%sx%s)"
              % (w, h, targets.get("scene", {}).get("w"), targets.get("scene", {}).get("h")))
        check(targets.get("depth", {}).get("w") == pixels["w"]
              and targets.get("depth", {}).get("h") == pixels["h"],
              "%dx%d: z-буфер пересоздан под новый буфер (%sx%s)"
              % (w, h, targets.get("depth", {}).get("w"), targets.get("depth", {}).get("h")))
        check(targets.get("bloom_a", {}).get("w") == pixels["w"] // 2
              and targets.get("bloom_a", {}).get("h") == pixels["h"] // 2,
              "%dx%d: буферы свечения пересозданы половинного разрешения (%sx%s)"
              % (w, h, targets.get("bloom_a", {}).get("w"), targets.get("bloom_a", {}).get("h")))
        tex = info.get("textures") or {}
        check(tex.get("count") == base_textures,
              "%dx%d: живых текстур столько же (%s == %d)"
              % (w, h, tex.get("count"), base_textures))
        img, path = shoot(a, shots, "post_%dx%d" % (w, h))
        check((img[0], img[1]) == (pixels["w"], pixels["h"]),
              "%dx%d: скриншот размером с буфер кадра (%dx%d)" % (w, h, img[0], img[1]))
        luma = mean_luma(img)
        check(luma >= MIN_MEAN_LUMA,
              "%dx%d: кадр с постом не чёрный (средняя яркость %.1f)" % (w, h, luma))
        pos = a.eval("$.camera.pos()")
        check(near(pos["x"], anchor["camera"]["x"], 0.001)
              and near(pos["y"], anchor["camera"]["y"], 0.001),
              "%dx%d: камера на месте (%s, %s)" % (w, h, pos["x"], pos["y"]))
        print("  --   кадр %s: %dx%d, яркость %.1f" % (os.path.basename(path), img[0], img[1], luma))


def main():
    shots = tempfile.mkdtemp(prefix="r2d_resize_")
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        anchor = a.eval("$.fixture.anchor()")
        start_size = a.eval("$.window.size()")
        check((start_size["w"], start_size["h"]) == START,
              "фикстура стартует на своём размере %dx%d (получено %sx%s)"
              % (START[0], START[1], start_size["w"], start_size["h"]))

        phase_plain(a, shots, anchor)
        phase_post(a, shots, anchor)

        # --- Возврат к исходному размеру: ресурсы на базовых числах -------------
        check(resize_to(a, START[0], START[1]), "вернулись к исходному размеру %dx%d" % START)
        a.step(2)
        info = a.eval("engine.renderInfo()")
        targets = target_map(info)
        check(targets.get("scene", {}).get("w") == START[0]
              and targets.get("scene", {}).get("h") == START[1],
              "цель сцены снова исходного размера (%sx%s)"
              % (targets.get("scene", {}).get("w"), targets.get("scene", {}).get("h")))
        check(sorted(targets) == sorted(["scene", "bloom_a", "bloom_b", "depth"]),
              "после цикла смен размера состав целей тот же: %s" % sorted(targets))

    print("  --   кадры прогона: %s" % shots)


if __name__ == "__main__":
    main()
    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")
    sys.exit(0)
