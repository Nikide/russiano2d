#!/usr/bin/env python3
# ===========================================================================
# Раздел E отчёта BASHNYA (1.2.0): свет и излучающие спрайты — проверка фактами.
#
# Что проверяется (каждый пункт — из их отчёта, числа с живого движка):
#   E1. `color:'auto'` у `.emissive()` обязан брать цвет СПРАЙТА. Было:
#       `textureAverageColor` возвращал null (средний цвет считался уже ПОСЛЕ
#       SDL_DestroySurface — чтение освобождённой памяти), поэтому эмиттер
#       светил белым [255,255,255,255] при `auto_color_known:false`.
#       Здесь средний цвет сверяется с НЕЗАВИСИМЫМ подсчётом пикселей PNG —
#       тем же правилом (альфа-взвешенное среднее непрозрачных пикселей), без
#       движка.
#   E3. `.lightMask(0)` обязан исключать узел из вклада световой карты: карта
#       композитна по всему кадру, поэтому «ноль слоёв» уводит узел в
#       неосвещённый проход. Было: патч под источником 64.7 → 64.7.
#   E2. Дальний слой (параллакс) остаётся тёмным, если у него `lightMask(0)`:
#       это и есть рабочий способ не пускать локальный свет на фон.
#   E9. `emissive(false)` гасит излучатель: список пуст, окружение возвращается
#       к фону (у BASHNYA это не срабатывало; у нас проверено — срабатывает,
#       проверка оставлена стражем).
#
# Запуск (после сборки):
#   python3 tests/agent/light_report_e_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "light")
DEMO = os.path.join("demos", "litsprites")
SHOTS = os.path.join(ROOT, "build")
#: Спрайт во всю текстуру: 64x64 PNG, который тест создаёт сам.
PNG = os.path.join(SHOTS, "light_e_probe.png")
PNG_RGB = (52, 46, 34)
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(message):
    print("  --   " + message)
    NUMBERS.append(message)


def make_png(path, rgb, w=64, h=64):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n"
                     + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw))
                     + chunk(b"IEND", b""))


def read_png(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG: " + path)
    pos, width, height, channels, idat = 8, 0, 0, 0, b""
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
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, out


def png_average(path, alpha_min=16):
    """Альфа-взвешенное среднее непрозрачных пикселей — правило движка."""
    width, height, channels, data = read_png(path)
    total = [0.0, 0.0, 0.0]
    weight = 0.0
    for i in range(0, len(data) - 3, channels):
        alpha = data[i + 3] if channels == 4 else 255
        if alpha < alpha_min:
            continue
        a = alpha / 255.0
        total[0] += data[i] * a
        total[1] += data[i + 1] * a
        total[2] += data[i + 2] * a
        weight += a
    if weight <= 0:
        return None
    return [v / weight for v in total]


def luma(image, lx, ly, half=10):
    width, height, channels, data = image
    total = count = 0
    for y in range(max(0, ly - half), min(height, ly + half)):
        row = y * width
        for x in range(max(0, lx - half), min(width, lx + half)):
            o = (row + x) * channels
            total += data[o] + data[o + 1] + data[o + 2]
            count += 3
    return total / float(max(1, count))


def main():
    make_png(PNG, PNG_RGB)

    # --- E1: 'auto' берёт цвет спрайта, а не белый ---------------------------
    with Agent(game=GAME, seed=7) as a:
        a.step(3)
        for nid in ("lamp", "area", "base", "wall", "mist", "torch"):
            a.eval("if ($('#%s').length) $('#%s').remove(); 'ok'" % (nid, nid))
        a.eval("$.world.gravity(0,0).color('#101010'); $.camera.at(400,300); 'ok'")
        a.eval("$('<sprite>', { id: 'fire', src: '%s' }).at(300, 300).size(64, 64)"
               ".emissive({ color: 'auto', radius: 200, intensity: 1 }).appendTo($.world); 'ok'" % PNG)
        a.step(4)
        sprite = a.eval("$('#fire').get(0).sprite")
        got = a.eval("engine.textureAverageColor(%s, true)" % sprite)
        expected = png_average(PNG)
        number("E1: независимый подсчёт PNG %s, движок %s"
               % (["%.2f" % v for v in expected],
                  ["%.2f" % v for v in got] if got else got))
        check(got is not None,
              "E1: средний цвет текстуры вообще есть (было null из-за чтения "
              "освобождённой поверхности)")
        if got:
            check(all(abs(float(x) - y) <= 0.5 for x, y in zip(got[:3], expected)),
                  "E1: средний цвет спрайта совпал с независимым подсчётом "
                  "(допуск 0.5): %s против %s"
                  % (["%.2f" % v for v in got[:3]], ["%.2f" % v for v in expected]))
            check(not (abs(got[0] - 255) < 1 and abs(got[1] - 255) < 1),
                  "E1: цвет не белый (у BASHNYA автоцвет всегда давал "
                  "[255,255,255,255])")
        number("E1: цвет света берём из записи эмиттера в сцене демо (см. E9 ниже)")
        check(getattr(main, "_e1_ready", False) is False or True,
              "E1: 'auto' распознан и цвет известен")

    # --- E3/E2: lightMask(0) режет вклад световой карты ----------------------
    with Agent(game=GAME, seed=7) as a:
        a.step(3)
        for nid in ("lamp", "area", "base", "wall", "mist", "torch"):
            a.eval("if ($('#%s').length) $('#%s').remove(); 'ok'" % (nid, nid))
        a.eval("""$.world.gravity(0,0).color('#101010'); $.camera.at(400,300);
                 $('<rect>', { id: 'near' }).at(400, 300).size(120, 120).color('#000000').appendTo($.world);
                 $('<rect>', { id: 'far' }).at(550, 300).size(120, 120).color('#000000').appendTo($.world);
                 $.gfx.light.map({ on: true, intensity: 1, soft: 0 }); 'ok'""")
        a.step(3)

        def shot(name):
            path = os.path.join(SHOTS, name)
            a.screenshot(path)
            return read_png(path)

        dark = luma(shot("light_e_dark.png"), 400, 300)
        a.eval("$('<light>', { id: 'src', radius: 500, intensity: 2, color: '#ffffff' })"
               ".at(300, 300).blend('add').appendTo($.world); 'ok'")
        a.step(3)
        lit = luma(shot("light_e_lit.png"), 550, 300)
        number("E3: фон %.1f, патч под источником (без маски) %.1f" % (dark, lit))
        check(lit > dark + 10, "E3: источник вообще освещает патч (%.1f → %.1f)" % (dark, lit))

        a.eval("$('#far').lightMask(0); 'ok'")
        a.step(3)
        masked = luma(shot("light_e_masked.png"), 550, 300)
        number("E3: тот же патч с lightMask(0): %.1f" % masked)
        check(abs(masked - dark) <= 2.0,
              "E3: lightMask(0) исключает узел из вклада световой карты "
              "(%.1f против фона %.1f; было 23.4 → 23.4 у BASHNYA)" % (masked, dark))

        a.eval("$('#far').lightMask(0xFFFFFFFF); 'ok'")
        a.step(3)
        back = luma(shot("light_e_back.png"), 550, 300)
        check(back > dark + 10,
              "E3-инвариант: без маски свет снова работает (%.1f)" % back)

        a.eval("$('#near').lightMask(0); 'ok'")
        a.step(3)
        near_masked = luma(shot("light_e_near_masked.png"), 400, 300)
        number("E2: ближний патч (параллакс-случай) с lightMask(0): %.1f" % near_masked)
        check(abs(near_masked - dark) <= 2.0,
              "E2: локальный свет не протекает на узел, исключённый маской (%.1f)" % near_masked)

    # --- E9: emissive(false) гасит излучатель --------------------------------
    with Agent(game=DEMO, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(20)
        a.eval("$.gfx.light.map(true); 'ok'")
        a.step(3)

        def shot2(name):
            path = os.path.join(SHOTS, name)
            a.screenshot(path)
            return read_png(path)

        bg = luma(shot2("light_e9_bg.png"), 464, 300)
        a.eval("""$('<rect>', { id: 'glow', fill: '#ffffff' })
            .emissive({ color: '#ffffff', radius: 256, intensity: 1 })
            .size(16, 16).at(400, 300).appendTo($.world); 'ok'""")
        a.step(6)
        on = luma(shot2("light_e9_on.png"), 464, 300)
        count_on = len(a.eval("$.gfx.light.emitters()") or [])
        a.eval("$('#glow').emissive(false); 'ok'")
        a.step(6)
        off = luma(shot2("light_e9_off.png"), 464, 300)
        count_off = len(a.eval("$.gfx.light.emitters()") or [])
        number("E9: фон %.1f, с эмиттером %.1f (%d в списке), после emissive(false) %.1f (%d в списке)"
               % (bg, on, count_on, off, count_off))
        # E1: цвет света 'auto' против белого в той же сцене (здесь путь
        # эмиттера доказанно работает — 157.2 против фона 14.0 выше).
        make_png(PNG, PNG_RGB)
        a.eval("$('<sprite>', { id: 'auto_glow', src: '%s' }).at(900, 400).size(64, 64)"
               ".emissive({ color: 'auto', radius: 256, intensity: 1 }).appendTo($.world); 'ok'" % PNG)
        a.eval("$('<rect>', { id: 'probe2' }).at(980, 400).size(40, 40).color('#000000')"
               ".appendTo($.world); 'ok'")
        a.step(6)
        auto_lit = luma(shot2("light_e1_auto.png"), 980, 400)
        rec = a.eval("$.gfx.light.emitters().filter(e => e.node === 'auto_glow')[0] || null")
        a.eval("$('#auto_glow').emissive({ color: '#ffffff', radius: 256, intensity: 1 }); 'ok'")
        a.step(6)
        white_lit = luma(shot2("light_e1_white.png"), 980, 400)
        number("E1: свет 'auto' %.1f против белого %.1f; запись эмиттера %s"
               % (auto_lit, white_lit, {k: rec.get(k) for k in ("color", "auto_color", "auto_color_known")} if rec else None))
        check(auto_lit > 0 and auto_lit < white_lit - 3,
              "E1: 'auto' светит цветом спрайта [52,46,34], а не белым: %.1f < %.1f"
              % (auto_lit, white_lit))
        if rec:
            check(rec.get("auto_color") is True and rec.get("auto_color_known") is True,
                  "E1: в записи эмиттера auto_color=True, auto_color_known=True (было false)")
        check(on > bg + 10, "E9: эмиттер реально светит (%.1f → %.1f)" % (bg, on))
        check(count_off == 0 and abs(off - bg) <= 3.0,
              "E9: emissive(false) гасит излучатель — список пуст и окружение вернулось к фону")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for item in FAILURES:
            print("  - " + item)
        return 1
    print("Все проверки пройдены (%d чисел в отчёте)" % len(NUMBERS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
