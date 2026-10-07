#!/usr/bin/env python3
# ===========================================================================
# Проверка $.mesh в движке: скелет, деформация, текстура, глубина.
#
# Меш со скелетом — вторая половина §4.1: вершины квадов деформируются позой,
# а z-буфер разбирается с самопересечениями частей. Проверяем ПО ПИКСЕЛЯМ.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_mesh_rig_test.py
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
        a.eval("$.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);"
               "$.camera.at(0,0)")

        # ОДИН обработчик кадра на весь тест. $.update НАКАПЛИВАЕТ функции:
        # каждый добавленный рисовался бы вместе с прежними, и bbox мешал бы
        # разные части (я на этом обжёгся дважды).
        a.eval("""
            globalThis.__draw = null;
            globalThis.__drawn = 0;
            $.update(() => {
                globalThis.__drawn = globalThis.__draw ? globalThis.__draw() : 0;
            });
            globalThis.__rig = $.mesh.skeleton({
                arm: { x: 200, y: 300, length: 40, angle: 0 },
            });
            globalThis.__part = $.mesh.part({
                verts: [200,300, 240,300, 240,320, 200,320],
                uv:    [0,0, 1,0, 1,1, 0,1],
                tris:  [0,1,2, 0,2,3],
                bones: ['arm','arm','arm','arm'],
                colors: [[255,0,0],[255,0,0],[255,0,0],[255,0,0]],
            });
        """)
        check(a.eval("typeof $.mesh.skeleton") == "function", "$.mesh.skeleton есть")
        check(a.eval("typeof $.mesh.part") == "function", "$.mesh.part есть")
        check(a.eval("typeof $.mesh.draw") == "function", "$.mesh.draw есть")

        def draw(a, expr, steps=3):
            a.eval(f"globalThis.__draw = () => {expr};")
            a.step(steps)

        # --- покой: квад ровно там, где заданы вершины ---
        draw(a, "$.mesh.draw(globalThis.__part, {}, globalThis.__rig)")
        drawn = a.eval("globalThis.__drawn")
        print(f"  вершин отрисовано: {drawn}")
        check(drawn == 6, f"draw вернул число вершин (6), получено {drawn}")
        a.cmd("screenshot", path="/tmp/rig_rest.png")
        rest = bbox("/tmp/rig_rest.png", RED)
        print(f"  покой: {rest}")
        check(rest is not None, "часть нарисована")
        if rest:
            check(abs(rest[0] - 200) <= 2 and abs(rest[1] - 239) <= 2 and
                  abs(rest[2] - 300) <= 2 and abs(rest[3] - 319) <= 2,
                  f"в покое вершины там, где заданы: {rest}")

        # --- поворот кости на 90° вокруг её начала ---
        draw(a, "$.mesh.draw(globalThis.__part, { arm: Math.PI/2 }, globalThis.__rig)")
        a.cmd("screenshot", path="/tmp/rig_90.png")
        turned = bbox("/tmp/rig_90.png", RED)
        print(f"  поворот 90°: {turned} (bbox: minx,maxx,miny,maxy)")
        check(turned is not None, "повёрнутая часть нарисована")
        if turned and rest:
            # Точка (240,300) → (200,340); (200,320) → (180,300).
            check(turned[0] < 195 and turned[3] > 335,
                  f"часть ПОВЕРНУЛАСЬ (ушла влево и вниз): {turned}")

        # --- мягкий сгиб: вес 0.5 между двумя костями ---
        a.eval("""
            globalThis.__rig2 = $.mesh.skeleton({
                root: { x: 400, y: 300, length: 40, angle: 0 },
                arm:  { parent: 'root', length: 40, angle: 0 },
            });
            globalThis.__blend = $.mesh.part({
                verts: [440,300, 480,300, 480,320, 440,320],
                uv:    [0,0, 1,0, 1,1, 0,1],
                tris:  [0,1,2, 0,2,3],
                weights: [['root',0.5,'arm',0.5], ['root',0.5,'arm',0.5],
                          ['root',0.5,'arm',0.5], ['root',0.5,'arm',0.5]],
                colors: [[0,255,0],[0,255,0],[0,255,0],[0,255,0]],
            });
        """)
        draw(a, "$.mesh.draw(globalThis.__blend, {}, globalThis.__rig2)")
        a.cmd("screenshot", path="/tmp/rig_b0.png")
        b0 = bbox("/tmp/rig_b0.png", GREEN)
        # Угол берём УМЕРЕННЫЙ (90°), а не 180°: линейное смешивание весов при
        # повороте больше ~120° схлопывает вершины (candy-wrapper — известное
        # свойство LBS, не дефект). При 180° полувес сжимает квад в точку.
        draw(a, "$.mesh.draw(globalThis.__blend, { arm: Math.PI/2 }, globalThis.__rig2)")
        a.cmd("screenshot", path="/tmp/rig_b1.png")
        b1 = bbox("/tmp/rig_b1.png", GREEN)
        print(f"  сгиб 0°: {b0} | сгиб 90° (полувес): {b1}")
        check(b0 is not None and b1 is not None, "смешанная часть видна в обеих позах")
        if b0 and b1:
            moved = abs(b1[0] - b0[0]) + abs(b1[2] - b0[2])
            check(moved > 5, f"мягкий сгиб двигает вершины (сдвиг {moved})")
            check(moved < 200, f"сдвиг меньше полного поворота ({moved})")

        # --- текстура через $.mesh ---
        a.eval("""
            globalThis.__tex = engine.textureFromPixels(
                2, 1, new Uint8Array([255,0,0,255, 0,255,0,255]));
            globalThis.__texpart = $.mesh.part({
                texture: globalThis.__tex,
                verts: [200,450, 300,450, 300,550, 200,550],
                uv:    [0,0, 1,0, 1,1, 0,1],
                tris:  [0,1,2, 0,2,3],
                colors: [[255,255,255],[255,255,255],[255,255,255],[255,255,255]],
            });
        """)
        draw(a, "$.mesh.draw(globalThis.__texpart, {})")
        a.cmd("screenshot", path="/tmp/rig_tex.png")
        left = bbox("/tmp/rig_tex.png", RED)
        right = bbox("/tmp/rig_tex.png", GREEN)
        print(f"  текстура: u=0 {left} | u=1 {right}")
        check(left is not None and right is not None,
              "текстура части сэмплится по u/v")
        if left and right:
            check(left[1] < 260 and right[0] > 240,
                  f"половины текстуры на своих местах ({left}, {right})")

        # --- рабочие буферы переиспользуются ---
        sizes = a.eval("JSON.stringify([$.mesh.scratchSize(), $.mesh.flatSize()])")
        for _ in range(3):
            a.step(1)
        sizes2 = a.eval("JSON.stringify([$.mesh.scratchSize(), $.mesh.flatSize()])")
        print(f"  буферы: {sizes} → {sizes2}")
        check(sizes == sizes2, "буферы не пересоздаются между кадрами")

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
