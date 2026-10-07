#!/usr/bin/env python3
# ===========================================================================
# Наследование от родителя: visible, alpha и относительная глубина.
#
# Закрывает пункт §11 «осталось незакрытым»: z_as_relative и наследование
# visible/modulate родителем.
#
# ЧТО БЫЛО НЕ ТАК: дети в `$` — отдельные узлы плоского реестра, поэтому
# скрытый контейнер НЕ скрывал содержимое, а прозрачность родителя на детей не
# влияла: гасишь панель — надписи остаются. Проверяем это ПО ПИКСЕЛЯМ.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_inherit_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
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


def green_energy(path):
    """Суммарная яркость зелёного: полупрозрачный ребёнок даёт МЕНЬШЕ.

    Считать точки бесполезно: порог по цвету проходят и тусклые пиксели,
    поэтому «тусклее» надо мерить яркостью.
    """
    w, h, bpp, px = decode(path)
    total = 0
    for y in range(0, h, 2):
        row = px[y]
        for x in range(0, w, 2):
            r, g, b = row[x * bpp:x * bpp + 3]
            if g > r + 20 and g > b + 20:
                total += g
    return total


def green_pixels(path):
    """Сколько зелёных точек на экране (ребёнок нарисован зелёным)."""
    w, h, bpp, px = decode(path)
    n = 0
    for y in range(0, h, 2):
        row = px[y]
        for x in range(0, w, 2):
            r, g, b = row[x * bpp:x * bpp + 3]
            if g > 120 and g > r + 40 and g > b + 40:
                n += 1
    return n


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("typeof $.gfx.effectiveAlpha") == "function",
              "$.gfx.effectiveAlpha есть")

        # Родитель без своей картинки, ребёнок — зелёный квадрат.
        a.eval("""
            $.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);
            $.camera.at(0,0);
            $('<node>', { id: 'box', w: 10, h: 10 }).at(-500, -500)
                .appendTo($.world);
            $('<enemy>', { id: 'kid', w: 300, h: 300 }).at(0, 0)
                .color('#00ff00').appendTo($('#box'));
        """)
        a.step(3)
        a.cmd("screenshot", path="/tmp/inh_on.png")
        base = green_pixels("/tmp/inh_on.png")
        print("  ребёнок виден: точек %d" % base)
        check(base > 100, "ребёнок рисуется сам по себе")

        # --- скрываем РОДИТЕЛЯ: ребёнок должен исчезнуть ---
        a.eval("$('#box').hide()")
        a.step(3)
        a.cmd("screenshot", path="/tmp/inh_hidden.png")
        hidden = green_pixels("/tmp/inh_hidden.png")
        print("  после hide(parent): точек %d" % hidden)
        check(hidden == 0, "скрытый родитель СКРЫВАЕТ ребёнка (было: не скрывал)")
        check(a.eval("$('#kid').effectivelyVisible()") is False,
              "effectivelyVisible учитывает родителя")

        # --- показываем и гасим родителя: ребёнок становится тусклее ---
        a.eval("$('#box').show().alpha(0.5); $('#kid').alpha(1)")
        a.step(3)
        a.cmd("screenshot", path="/tmp/inh_half.png")
        half = green_pixels("/tmp/inh_half.png")
        half_energy = green_energy("/tmp/inh_half.png")
        base_energy = green_energy("/tmp/inh_on.png")
        print("  alpha(parent)=0.5: точек %d, яркость %d (было %d)"
              % (half, half_energy, base_energy))
        check(a.eval("$('#kid').effectiveAlpha()") == 0.5, "effectiveAlpha = 0.5")
        check(half > 0, "полупрозрачный родитель не убирает ребёнка совсем")
        check(half_energy < base_energy * 0.75,
              "и делает его тусклее (яркость %d < %d)" % (half_energy, base_energy))

        # --- нулевая прозрачность родителя = невидимость ---
        a.eval("$('#box').alpha(0)")
        a.step(3)
        a.cmd("screenshot", path="/tmp/inh_zero.png")
        zero = green_pixels("/tmp/inh_zero.png")
        print("  alpha(parent)=0: точек %d" % zero)
        check(zero == 0, "нулевая прозрачность родителя скрывает ребёнка")

        # --- произведение прозрачностей ---
        a.eval("$('#box').alpha(0.5); $('#kid').alpha(0.5)")
        check(a.eval("$('#kid').effectiveAlpha()") == 0.25,
              "0.5 × 0.5 = 0.25 (произведение по цепочке)")

        # --- относительная глубина ---
        check(a.eval("typeof $('#kid').depthRelative") == "function",
              ".depthRelative() есть у узла")
        a.eval("$('#kid').depthRelative(true)")
        check(a.eval("$('#kid').isDepthRelative()") is True, "флаг выставился")
        a.eval("""
            $('#box').nodes[0].depth = 10;
            $('#kid').nodes[0].depth = 5;
        """)
        d_kid = a.eval("$('#kid').effectiveDepth()")
        d_box = a.eval("$('#box').effectiveDepth()")
        print("  глубины: ребёнок %s, родитель %s" % (d_kid, d_box))
        check(d_kid == 15, "относительная глубина ребёнка = 10 + 5")
        check(d_box == 10, "родитель остался абсолютным")

        # Абсолютная по умолчанию: флаг снят — глубина своя.
        a.eval("$('#kid').depthRelative(false)")
        check(a.eval("$('#kid').effectiveDepth()") == 5,
              "без флага глубина абсолютная")

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
