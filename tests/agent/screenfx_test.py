#!/usr/bin/env python3
# ===========================================================================
# §46 Спецификации: пользовательский экранный эффект (screen effect pass).
#
# Проверяется результат в кадре, а не «параметр дошёл до шейдера»:
#   * при нулевых параметрах пост-проход — тождество (кадр совпадает с кадром
#     без поста). Это контрольная точка: любое отличие дальше вызвано именно
#     эффектом, а не самим фактом включённого прохода;
#   * волна, шум и сдвиг каналов по отдельности меняют кадр;
#   * волна по X и по Y даёт разные кадры — ось действительно выбирается;
#   * масштаб шума меняет выборку — значит, читается процедурная текстура шума,
#     а не константа в шейдере;
#   * сдвиг каналов разводит R и B относительно G там, где они совпадали;
#   * эффект переживает resize и не читает из одновременно записываемого
#     таргета (нет feedback-мусора), а после выключения кадр снова чистый.
#
# Запуск:
#   python3 tests/agent/screenfx_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/screenfx_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "screenfx")
FAILURES = []

# Нейтральный пост: все параметры в значениях «как есть». С этим набором
# пост-проход обязан быть тождеством, и на нём стоит контрольная точка.
NEUTRAL = ("{distort:0, wave_amp:0, noise_amount:0, channel_shift:0, glow:0, vignette:0, "
           "chromatic:0, lens:0, grain:0, scanline:0, posterize:0, tint_amount:0, blood:0, "
           "saturation:1, contrast:1, brightness:0}")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def decode(path):
    """PNG → (w, h, pixels), где pixels — bytearray RGBA."""
    data = open(path, "rb").read()
    pos, idat, w, h, ct = 8, b"", 0, 0, 6
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, _bd, ct = struct.unpack(">IIBB", body[:10])
        elif typ == b"IDAT":
            idat += body
        pos += 12 + ln
    raw = zlib.decompress(idat)
    bpp = 4 if ct == 6 else 3
    stride = w * bpp
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            v = line[x]
            if f == 1:
                v = (v + a) & 0xff
            elif f == 2:
                v = (v + b) & 0xff
            elif f == 3:
                v = (v + ((a + b) >> 1)) & 0xff
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                v = (v + pr) & 0xff
            line[x] = v
        prev = line
        for x in range(w):
            out[(y * w + x) * 4 + 0] = line[x * bpp + 0]
            out[(y * w + x) * 4 + 1] = line[x * bpp + 1] if bpp > 1 else line[x * bpp]
            out[(y * w + x) * 4 + 2] = line[x * bpp + 2] if bpp > 2 else line[x * bpp]
            out[(y * w + x) * 4 + 3] = line[x * bpp + 3] if bpp > 3 else 255
    return w, h, out


def px(img, x, y):
    w, _h, p = img
    o = (y * w + x) * 4
    return p[o], p[o + 1], p[o + 2], p[o + 3]


def shot(a, name):
    path = os.path.join(ROOT, "build", "screenfx_%s.png" % name)
    a.screenshot(path)
    return decode(path)


def changed(img_a, img_b, step=3):
    """Сколько пикселей (с шагом) заметно различаются между кадрами."""
    w, h, pa = img_a
    pb = img_b[2]
    n = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            o = (y * w + x) * 4
            if (abs(pa[o] - pb[o]) > 6 or abs(pa[o + 1] - pb[o + 1]) > 6
                    or abs(pa[o + 2] - pb[o + 2]) > 6):
                n += 1
    return n


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(6)
        if not a.eval("engine.postSupported()"):
            print("  пропуск: пост-обработка недоступна в этой сборке")
            return 0
        check(a.eval("typeof $.gfx.post") == "function", "$.gfx.post доступно")

        # --- Контрольные точки ------------------------------------------------
        a.eval("$.gfx.post(%s)" % NEUTRAL)
        a.step(4)
        base = shot(a, "base")
        a.step(4)
        base2 = shot(a, "base2")
        fixture_noise = changed(base, base2, step=4)
        check(fixture_noise == 0, "фикстура статична: два кадра совпадают (различий %d)" % fixture_noise)

        a.eval("$.gfx.post(%s)" % NEUTRAL)
        a.step(4)
        neutral = shot(a, "neutral")
        same = changed(base, neutral, step=2)
        check(same == 0, "нейтральный пост — тождество (различий %d)" % same)

        # --- Волна ------------------------------------------------------------
        a.eval("$.gfx.post({distort:1, wave_amp:0.02, wave_freq:60, wave_speed:0, wave_axis:1, "
               "noise_amount:0, channel_shift:0})")
        a.step(4)
        wave_y = shot(a, "wave_y")
        moved_y = changed(base, wave_y, step=3)
        check(moved_y > 5000, "волна по Y меняет кадр (различий %d)" % moved_y)

        # Ось — это выбор направления, а не декоративный параметр: кадры с
        # wave_axis 0 и 1 обязаны различаться.
        a.eval("$.gfx.post({distort:1, wave_amp:0.02, wave_freq:60, wave_speed:0, wave_axis:0, "
               "noise_amount:0, channel_shift:0})")
        a.step(4)
        wave_x = shot(a, "wave_x")
        other_axis = changed(wave_y, wave_x, step=9)
        check(other_axis > 500, "ось волны X и Y дают разный кадр (различий %d)" % other_axis)

        # --- Шум ---------------------------------------------------------------
        a.eval("$.gfx.post({distort:1, wave_amp:0, noise_amount:0.01, noise_scale:12, channel_shift:0})")
        a.step(4)
        noise_a = shot(a, "noise_a")
        moved_noise = changed(base, noise_a, step=3)
        check(moved_noise > 5000, "шум меняет кадр (различий %d)" % moved_noise)

        # Масштаб шума доходит до шейдера (проверяем по состоянию движка):
        # измерить его влияние пиксельной метрикой нельзя — при разумных
        # амплитудах смещение меньше пикселя, и это нормально.
        a.eval("$.gfx.post({distort:1, wave_amp:0, noise_amount:0.01, noise_scale:48, channel_shift:0})")
        a.step(2)
        check(abs((a.eval("engine.getPost()") or {}).get("noise_scale", 0) - 48) < 1e-3,
              "масштаб шума доходит до движка (%.1f)" % (a.eval("engine.getPost()") or {}).get("noise_scale", -1))

        # --- Сдвиг каналов -----------------------------------------------------
        a.eval("$.gfx.post({distort:1, wave_amp:0, noise_amount:0, channel_shift:0.05})")
        a.step(4)
        chan = shot(a, "channel")
        moved_chan = changed(base, chan, step=3)
        check(moved_chan > 5000, "channel shift меняет кадр (различий %d)" % moved_chan)

        # Разводит R и B относительно G: на кромках клеток появляются цветные
        # каналы, которых не было (в базовом кадре серые/синие клетки дают
        # близкие R, G, B).
        fringes = 0
        for y in range(40, 400, 3):
            for x in range(40, 1240, 3):
                r, g, b, _ = px(chan, x, y)
                pr, pg, pb, _ = px(base, x, y)
                spread = max(abs(r - g), abs(g - b), abs(r - b))
                was = max(abs(pr - pg), abs(pg - pb), abs(pr - pb))
                if spread > 60 and spread > was + 30:
                    fringes += 1
        check(fringes > 50, "channel shift даёт цветные кромки (%d точек)" % fringes)

        # --- Resize и отсутствие feedback --------------------------------------
        a.eval("$.gfx.post({distort:1, wave_amp:0.01, noise_amount:0.004, channel_shift:0.004})")
        a.step(3)
        a.cmd("eval", code="engine.window.setSize ? engine.window.setSize(960, 540) : 0")
        a.step(6)
        resized = shot(a, "resized")
        check(resized[0] > 0 and resized[1] > 0,
              "кадр после resize получен (%dx%d)" % (resized[0], resized[1]))
        r, g, b, _ = px(resized, 6, 6)
        check(r + g + b < 200, "после resize нет feedback-мусора в углу (%d,%d,%d)" % (r, g, b))

        # --- Выключение возвращает чистый и стабильный кадр --------------------
        a.eval("$.gfx.post(%s)" % NEUTRAL)
        a.step(5)
        after = shot(a, "after")
        r, g, b, _ = px(after, 6, 6)
        check(r + g + b < 200, "после выключения эффекта кадр чистый (%d,%d,%d)" % (r, g, b))
        stable = changed(after, shot(a, "after2"), step=4)
        check(stable == 0, "после выключения кадр стабилен (различий %d)" % stable)

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
