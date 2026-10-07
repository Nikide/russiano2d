#!/usr/bin/env python3
# ===========================================================================
# Мипмапы текстур: engine.loadTexture(path, { mipmaps: true }).
#
# Зачем: TASKS §12.4 числил «фильтрация/мипмапы» незакрытым — была только
# фильтрация (nearest/linear). Без мипмапов УМЕНЬШЕННЫЙ спрайт мерцает:
# сэмплер берёт одну точку из большой картинки.
#
# Две ошибки SDL, которые этот тест поймал (обе — ассерты, то есть в сборке с
# отключёнными ассертами это были бы чёрные текстуры):
#   1. «Cannot generate mipmaps for texture with num_levels <= 1» —
#      текстура создавалась с одним уровнем;
#   2. «must be created with SAMPLER and COLOR_TARGET usage flags» —
#      SDL строит уровни, РИСУЯ их, поэтому нужен COLOR_TARGET.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_mipmap_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
# Путь считается от КОРНЯ репозитория, а не от каталога игры: проверено —
# 'assets/tiles.png' резолвится в /<repo>/assets/tiles.png и не находится.
TEX = "tests/fixtures/text/assets/tiles.png"
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def decode(path):
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
    out, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out.append(bytes(line))
        prev = line
    return w, h, bpp, out


def count_visible(path):
    """Сколько точек отличается от чёрного фона (выборка через 2)."""
    w, h, bpp, px = decode(path)
    n = 0
    for y in range(0, h, 2):
        row = px[y]
        for x in range(0, w, 2):
            r, g, b = row[x * bpp:x * bpp + 3]
            if r > 20 or g > 20 or b > 20:
                n += 1
    return n


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("typeof engine.loadTexture") == "function", "loadTexture есть")

        # --- мипмап-текстура создаётся ---
        mid = a.eval("engine.loadTexture('%s', { mipmaps: true })" % TEX)
        print("  id текстуры с мипмапами: %s" % mid)
        check(isinstance(mid, int) and mid >= 0, "текстура с мипмапами загрузилась")

        # --- кэш по пути: повторная загрузка даёт тот же слот ---
        same = a.eval("engine.loadTexture('%s')" % TEX)
        print("  тот же путь без опций: %s" % same)
        check(same == mid, "кэш по пути: повторный load возвращает тот же слот")

        # --- спрайт из мипмап-текстуры рисуется ---
        a.eval("""
            $.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);
            $.camera.at(0,0);
            $('<enemy>', { id: 'big', w: 400, h: 400 }).at(0, 0)
                .sprite(engine.createSprite(%d, 0, 0, 32, 32))
                .appendTo($.world);
        """ % mid)
        a.step(3)
        a.cmd("screenshot", path="/tmp/mip_native.png")
        native = count_visible("/tmp/mip_native.png")
        print("  спрайт в натуральную величину: точек %d" % native)
        check(native > 100, "мипмап-текстура рисуется в натуральную величину")

        # --- и УМЕНЬШЕННЫЙ: ради этого мипмапы и нужны ---
        # Узел создаём СРАЗУ маленьким: смена w/h на лету рендер не уменьшает.
        a.eval("$('#big').hide();")
        a.eval("$('<enemy>', { id: 'small', w: 8, h: 8 }).at(-100, -100)"
               "    .sprite(engine.createSprite(%d, 0, 0, 32, 32)).appendTo($.world);" % mid)
        a.step(3)
        a.cmd("screenshot", path="/tmp/mip_small.png")
        small = count_visible("/tmp/mip_small.png")
        print("  уменьшенный до 8x8: точек %d" % small)
        check(small > 0, "уменьшенный спрайт с мипмапами рисуется")
        # Сравниваем с натуральной величиной: узел 8x8 должен дать заметно
        # меньше точек, чем 400x400. Абсолютное число зависит от масштаба
        # окна, поэтому проверка относительная.
        check(small < native / 4, "спрайт действительно уменьшен (%d против %d)" % (small, native))

        # --- обычная загрузка без мипмапов не сломана ---
        check(a.eval("engine.loadTexture('%s')" % TEX) == mid, "повторная загрузка стабильна")
        check(a.eval("typeof engine.textureFromPixels") == "function",
              "textureFromPixels (процедурный арт) не затронут")

        # --- ресурс с mipmaps: true ---
        a.eval("""
            $.resource.define('mipped', { kind: 'texture', path: '%s', mipmaps: true });
        """ % TEX)
        got = a.eval("$.resource.get('mipped')")
        print("  ресурс с mipmaps: %s" % got)
        check(isinstance(got, int) and got >= 0, "$.resource грузит текстуру с мипмапами")

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
