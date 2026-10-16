#!/usr/bin/env python3
# ===========================================================================
# Пример §31-5 Спецификации: «Lit sprites» (demos/litsprites).
#
# Проверяется ЧИСЛАМИ из скриншота: яркость в тени ниже, чем на свету; маска
# препятствий не пускает чужой слой; динамический occluder роняет яркость, а
# после ухода и после `.hide()` возвращает; неосвещённый узел не гаснет в
# темноте; UI не темнеет вместе с миром; перевёрнутый кадр атласа даёт ожидаемые
# пиксели и не протекает на соседа; материал с normal-картой и без неё совпадают
# (`perPixelNormal === false` — зафиксированное ограничение §20.2).
#
# Камера примера стоит в центре кадра с зумом 1, поэтому МИРОВЫЕ координаты
# совпадают с экранными и яркость читается прямо из PNG.
#
# Запуск:
#   python3 tests/agent/litsprites_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/litsprites_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("demos", "litsprites")
FAILURES = []

# Точки замера (мир == экран).
TARGET_A = (320, 300)        # в луче лампы A, за препятствием маски 1
TARGET_B = (960, 300)        # в луче лампы B, за препятствием маски 2
TARGET_FREE = (320, 460)     # в луче лампы A, но вне тени
FLOOR = (640, 660)
SIGN = (640, 560)
HUD = (480, 30)              # пустая часть HUD-панели (текст левее)
PLAIN = (300, 140)           # кадр `half`: слева зелёный, справа красный
FLIPX = (400, 140)
FLIPY = (500, 140)
NEIGHBOR = (600, 140)        # кадр `blue` — сосед `half` в атласе
MAT_NORMAL = (320, 480)
MAT_FLAT = (420, 480)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


# --- Чтение PNG без зависимостей (тот же приём, что в highlevel_light_limits) --

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


def luma(image, lx, ly, half=6):
    width, height, channels, data = image
    total = 0
    count = 0
    for y in range(max(0, ly - half), min(height, ly + half)):
        row = y * width
        for x in range(max(0, lx - half), min(width, lx + half)):
            o = (row + x) * channels
            total += data[o] + data[o + 1] + data[o + 2]
            count += 3
    return total / float(max(1, count))


def pixel(image, x, y):
    width, height, channels, data = image
    o = (y * width + x) * channels
    return data[o], data[o + 1], data[o + 2]


def is_red(c):
    return c[0] > 40 and c[0] - c[1] > 18 and c[0] - c[2] > 18


def is_green(c):
    return c[1] > 35 and c[1] - c[0] > 18


def is_blue(c):
    return c[2] > 30 and c[2] - c[0] > 18


def is_white(c):
    return min(c) > 40


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(20)
        check(a.eval("$.scene.current()") == "litsprites", "сцена примера открылась")

        def shot(name):
            path = os.path.join(shots, name)
            a.screenshot(path)
            return read_png(path)

        # --- API примера на месте -------------------------------------------
        check(a.eval("$('#lamp_a').length") == 1 and a.eval("$('#lamp_b').length") == 1,
              "два источника света в сцене")
        stats = a.eval("$.gfx.light.stats()")
        check(stats.get("shadowLights") == 2, "оба источника считают тени: %s" % stats.get("shadowLights"))
        check(a.eval("$('#lamp_a').occluderMask()") == 1
              and a.eval("$('#lamp_b').occluderMask()") == 2,
              "у источников разные маски препятствий")
        check(a.eval("$.gfx.light.dynamicCount()") >= 4,
              "динамический occluder даёт отрезки (%s)" % a.eval("$.gfx.light.dynamicCount()"))
        pages = a.eval("$.atlas.get('flip').pages()")
        check(isinstance(pages, list) and pages[0].get("mipmaps") is True,
              "атлас с padding/extrusion загружен с мипмапами")
        info = a.eval("$.atlas.get('flip').info('half')")
        check(info.get("x") == 2 and info.get("w") == 16,
              "кадр вырезан с учётом padding: %s" % info)
        mat = a.eval("$.gfx.material('stone')")
        check(mat.get("normal") is not None and mat.get("perPixelNormal") is False,
              "материал с normal-картой: данные есть, попиксельного света нет (%s)"
              % mat.get("perPixelNormal"))
        check(a.eval("$.gfx.flatNormal()") == [0.5, 0.5, 1], "flat normal — нейтраль (0.5, 0.5, 1)")

        # Камера зафиксирована: мир == экран.
        a.eval("$.store.set('crateMove', false); 'ok'")
        a.step(3)

        # --- Маска препятствий: своя тень, чужая — свет ----------------------
        # Маска 1 совпадает с препятствием A → цель A в тени.
        a.eval("$('#lamp_a').occluderMask(1); 'ok'")
        a.step(3)
        img = shot("litsprites_mask_own.png")
        shadow = luma(img, *TARGET_A, half=8)
        free = luma(img, *TARGET_FREE, half=8)
        # Маска 2 не совпадает с препятствием A → источник его не видит.
        a.eval("$('#lamp_a').occluderMask(2); 'ok'")
        a.step(3)
        img = shot("litsprites_mask_other.png")
        lit = luma(img, *TARGET_A, half=8)
        print("  --   маска: в тени=%.1f, на свету=%.1f, вне тени=%.1f" % (shadow, lit, free))
        check(shadow < lit * 0.6, "цель в тени темнее освещённой (%.1f < %.1f)" % (shadow, lit))
        check(lit > shadow + 20, "чужая маска пропускает свет (прирост %.1f)" % (lit - shadow))
        check(free > shadow * 2, "замер в тени — именно тень, а не выключенный свет (%.1f)" % free)
        a.eval("$('#lamp_a').occluderMask(1); 'ok'")

        # --- Динамический occluder: роняет и возвращает свет ------------------
        a.eval("$.gfx.light.occluders([]); $('#lamp_b').occluderMask(0); 'ok'")
        a.eval("void $('#crate').at(1020, 300)")
        a.step(3)
        img = shot("litsprites_crate_between.png")
        between = luma(img, *TARGET_B, half=8)
        a.eval("void $('#crate').at(1020, 120)")
        a.step(3)
        img = shot("litsprites_crate_away.png")
        away = luma(img, *TARGET_B, half=8)
        # Скрытый узел препятствием не считается (§20): ставим обратно и гасим.
        a.eval("void $('#crate').at(1020, 300)")
        a.step(3)
        a.eval("$('#crate').hide(); 'ok'")
        a.step(3)
        img = shot("litsprites_crate_hidden.png")
        hidden = luma(img, *TARGET_B, half=8)
        print("  --   occluder: между=%.1f, ушёл=%.1f, скрыт=%.1f" % (between, away, hidden))
        check(between < away * 0.7, "occluder роняет яркость цели (%.1f < %.1f)" % (between, away))
        check(away > between + 15, "после ухода occluder свет вернулся (+%.1f)" % (away - between))
        check(hidden > between * 1.5, "скрытый узел света не заслоняет (%.1f против %.1f)"
              % (hidden, between))
        a.eval("$('#crate').show(); void $('#crate').at(1020, 200); 'ok'")
        a.eval("$.gfx.light.occluders([{ x: 260, y: 220, w: 32, h: 160, mask: 1 },"
               " { x: 1020, y: 220, w: 32, h: 160, mask: 2 }]); 'ok'")
        a.eval("$('#lamp_b').occluderMask(2); 'ok'")

        # --- Свет и темнота не трогают UI и `.lit(false)` ---------------------
        a.eval("$.gfx.light.ambient({ level: 0.15, color: '#05070d' }); 'ok'")
        a.step(3)
        img = shot("litsprites_ambient_on.png")
        hud_light = luma(img, *HUD, half=4)
        sign_light = luma(img, *SIGN, half=4)
        floor_light = luma(img, *FLOOR, half=6)
        a.eval("$.gfx.light.ambient({ level: 0.95, color: '#05070d' }); 'ok'")
        a.step(3)
        img = shot("litsprites_ambient_dark.png")
        hud_dark = luma(img, *HUD, half=4)
        sign_dark = luma(img, *SIGN, half=4)
        floor_dark = luma(img, *FLOOR, half=6)
        print("  --   ambient: hud %.1f→%.1f, sign %.1f→%.1f, floor %.1f→%.1f"
              % (hud_light, hud_dark, sign_light, sign_dark, floor_light, floor_dark))
        check(abs(hud_dark - hud_light) < 1.5,
              "HUD не темнеет вместе с миром (%.1f → %.1f)" % (hud_light, hud_dark))
        check(abs(sign_dark - sign_light) < 1.5,
              "узел .lit(false) не гаснет (%.1f → %.1f)" % (sign_light, sign_dark))
        check(floor_dark < floor_light - 20,
              "мир под темнотой гаснет (%.1f → %.1f)" % (floor_light, floor_dark))
        a.eval("$.gfx.light.ambient({ level: 0.55, color: '#05070d' }); 'ok'")
        a.step(3)

        # --- Normal/flat: материал с normal-картой и без неё совпадают --------
        img = shot("litsprites_materials.png")
        norm = luma(img, *MAT_NORMAL, half=10)
        flat = luma(img, *MAT_FLAT, half=10)
        print("  --   материал: с normal=%.1f, без=%.1f" % (norm, flat))
        check(abs(norm - flat) < 6,
              "normal-карта не меняет картинку без попиксельного света (%.1f ≈ %.1f)" % (norm, flat))

        # --- Атлас: отражение по X/Y и отсутствие протечки --------------------
        # Кадр `half`: левая половина зелёная, правая красная, метка в левом
        # верхнем углу. Спрайт 64×64, поэтому углы читаются однозначно.
        def corners(x):
            return (pixel(img, x - 24, 116), pixel(img, x + 24, 116),
                    pixel(img, x - 24, 164), pixel(img, x + 24, 164))

        tl, tr, bl, br = corners(PLAIN[0])
        check(is_white(tl) and is_red(tr) and is_green(bl) and is_red(br),
              "кадр как есть: метка слева сверху, половины не сдвинуты (%s %s %s %s)"
              % (tl, tr, bl, br))
        tl, tr, bl, br = corners(FLIPX[0])
        check(is_red(tl) and is_white(tr) and is_red(bl) and is_green(br),
              "flip X зеркалит кадр (%s %s %s %s)" % (tl, tr, bl, br))
        tl, tr, bl, br = corners(FLIPY[0])
        check(is_green(tl) and is_red(tr) and is_white(bl) and is_red(br),
              "flip Y зеркалит кадр (%s %s %s %s)" % (tl, tr, bl, br))

        edge = pixel(img, PLAIN[0] + 30, PLAIN[1])       # правый край кадра
        neighbor = pixel(img, *NEIGHBOR)                 # цвет соседнего кадра
        print("  --   атлас: край=%s, сосед=%s" % (edge, neighbor))
        check(is_red(edge) and not is_blue(edge),
              "правый край кадра не протёк соседом (%s)" % (edge,))
        check(is_blue(neighbor), "соседний кадр действительно синий (%s)" % (neighbor,))

        errors = [line for line in a.stderr_text().splitlines()
                  if "$: ошибка" in line or "[error]" in line]
        check(not errors, "в примере нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
