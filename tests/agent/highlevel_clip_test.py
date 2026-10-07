#!/usr/bin/env python3
# ===========================================================================
# Проверка обрезки (scissor): $.gfx.clip / clipOff / clipRect и .clip() у узла.
#
# Зачем: в движке не было НИ ОДНОЙ обрезки (grep scissor/clipRect = 0), из-за
# чего не работали прокрутка списка, портрет в рамке и миникарта. Теперь
# обрезка есть, действует на КОМАНДУ (а не на кадр), поэтому разные узлы одного
# кадра обрезаются по-разному.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_clip_test.py
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


RED = lambda c: c[0] > 120 and c[1] < 110
GREEN = lambda c: c[1] > 140 and c[0] < 110


def bbox(path, pred):
    w, h, bpp, px = decode(path)
    pts = [(x, y) for y in range(h) for x in range(w)
           if pred(px[y][x * bpp:x * bpp + 3])]
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), max(xs), min(ys), max(ys), len(pts))


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("typeof engine.setClip") == "function", "engine.setClip есть")
        check(a.eval("typeof engine.clearClip") == "function", "engine.clearClip есть")
        check(a.eval("typeof $.gfx.clip") == "function", "$.gfx.clip есть")

        # Большой красный узел: на экране 550..850 x 450..750 (обрезан краем).
        a.eval("""
            $.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);
            $.camera.at(0,0);
            $('<enemy>', { id: 'big', w: 300, h: 300 }).at(300, 300)
                .color('#ff0000').appendTo($.world);
        """)
        a.step(3)
        a.cmd("screenshot", path="/tmp/clip_none.png")
        none = bbox("/tmp/clip_none.png", RED)
        print(f"  без обрезки: {none}")
        check(none is not None and none[0] <= 552, "без обрезки виден весь узел")

        # --- обрезка через $.gfx.clip из $.render ---
        # Клип ставится в $.render: он идёт ДО _render, поэтому сброс обрезок
        # перенесён в начало кадра (в _render он стирал бы клип).
        a.eval("""
            globalThis.__on = true;
            $.render(() => { if (globalThis.__on) $.gfx.clip(600, 500, 100, 80); });
        """)
        a.step(3)
        a.cmd("screenshot", path="/tmp/clip_on.png")
        on = bbox("/tmp/clip_on.png", RED)
        print(f"  клип 600,500,100,80: {on}")
        check(on is not None, "обрезанный узел виден")
        if on:
            check(abs(on[0] - 600) <= 2 and abs(on[1] - 699) <= 2 and
                  abs(on[2] - 500) <= 2 and abs(on[3] - 579) <= 2,
                  f"обрезка ровно по прямоугольнику: {on} (ждали 600..699 x 500..579)")

        # --- снятие обрезки ---
        a.eval("globalThis.__on = false; $.gfx.clipOff(); globalThis.__rect = $.gfx.clipRect();")
        a.step(3)
        a.cmd("screenshot", path="/tmp/clip_off.png")
        off = bbox("/tmp/clip_off.png", RED)
        print(f"  после снятия: {off} | clipRect = {a.eval('JSON.stringify(globalThis.__rect)')}")
        check(a.eval("globalThis.__rect") is None, "clipRect после снятия — null")
        check(off is not None and off[0] <= 552, "после снятия узел снова виден целиком")

        # --- обрезка ОДНОГО узла не трогает соседа ---
        a.eval("""
            $('#big') && $('#big').remove();
            $.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);
            $.camera.at(0,0);
            $('<enemy>', { id: 'c', w: 300, h: 300 }).at(300, 300)
                .color('#ff0000').clip({ x: 600, y: 500, w: 100, h: 100 })
                .appendTo($.world);
            $('<enemy>', { id: 'f', w: 100, h: 100 }).at(100, 100)
                .color('#00ff00').appendTo($.world);
        """)
        a.step(3)
        a.cmd("screenshot", path="/tmp/clip_node.png")
        c = bbox("/tmp/clip_node.png", RED)
        f = bbox("/tmp/clip_node.png", GREEN)
        print(f"  узел с обрезкой: {c} | сосед без: {f}")
        check(c is not None and abs(c[0] - 600) <= 2 and abs(c[1] - 699) <= 2,
              f"узел обрезан по своему прямоугольнику ({c})")
        check(f is not None and abs(f[0] - 450) <= 2 and abs(f[1] - 549) <= 2,
              f"сосед НЕ обрезан: обрезка не растеклась ({f})")

        # --- разные узлы одного кадра обрезаются по-разному ---
        a.eval("""
            ['#c', '#f'].forEach((s) => { const n = $(s); if (n.length) n.remove(); });
            $.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);
            $.camera.at(0,0);
            // Камера в (0,0), поэтому узел (0,0) — на экране (400,300),
            // узел (200,0) — на (600,300). Клипы ставим по этим местам.
            $('<enemy>', { id: 'a', w: 200, h: 200 }).at(0, 0)
                .color('#ff0000').clip({ x: 400, y: 300, w: 60, h: 60 })
                .appendTo($.world);
            $('<enemy>', { id: 'b', w: 200, h: 200 }).at(200, 0)
                .color('#00ff00').clip({ x: 600, y: 300, w: 60, h: 60 })
                .appendTo($.world);
        """)
        a.step(3)
        a.cmd("screenshot", path="/tmp/clip_two.png")
        ra = bbox("/tmp/clip_two.png", RED)
        gb = bbox("/tmp/clip_two.png", GREEN)
        print(f"  два узла, два клипа: красный {ra} | зелёный {gb}")
        check(ra is not None and abs(ra[0] - 400) <= 2 and abs(ra[3] - 359) <= 2,
              f"первый узел обрезан своим прямоугольником ({ra})")
        check(gb is not None and abs(gb[0] - 600) <= 2 and abs(gb[3] - 359) <= 2,
              f"второй узел — своим ({gb})")

        # --- обрезка нулевого размера = снятие, без ошибок ---
        a.eval("$.gfx.clip(10, 10, 0, 0); globalThis.__zero = $.gfx.clipRect();")
        a.step(2)
        check(a.eval("globalThis.__zero") is None, "нулевой прямоугольник снимает обрезку")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
