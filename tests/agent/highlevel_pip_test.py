#!/usr/bin/env python3
# ===========================================================================
# Проверка PIP-камеры и миникарты: $.camera.pip / minimap / pipClear.
#
# ИСТОРИЯ (важно для того, кто будет это ломать). PIP дважды снимали из API,
# потому что он рисовал не туда. Причина оказалась в regionCamera: сдвиг от
# центра кадра к центру региона ПРИБАВЛЯЛСЯ к позиции камеры, а надо вычитать —
# спрайт уезжал на (region.x − region.w/2, region.y − region.h/2). Плюс
# setView брал `cam.w` (это регион) как размер КАДРА и делил его на два.
#
# Тест проверяет ПО ПИКСЕЛЯМ, что PIP попадает в свой прямоугольник с точностью
# до пикселя, и что это не ломает главную камеру.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_pip_test.py
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


RED = lambda c: c[0] > 140 and c[1] < 110
GREEN = lambda c: c[1] > 140 and c[0] < 110


def bbox(path, pred):
    w, h, bpp, px = decode(path)
    pts = [(x, y) for y in range(h) for x in range(w)
           if pred(px[y][x * bpp:x * bpp + 3])]
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), max(xs), min(ys), max(ys))


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # Главная камера смотрит на зелёный узел; красный — далеко.
        a.eval("""
            $.world.gravity(0,0).color('#101820').bounds(0,0,20000,4000);
            $('<enemy>', { id: 'hero', w: 200, h: 200 }).at(300, 200)
                .color('#00ff00').appendTo($.world);
            $('<enemy>', { id: 'far', w: 200, h: 200 }).at(3300, 200)
                .color('#ff0000').appendTo($.world);
            $.camera.at(300, 200);
        """)
        a.step(2)
        a.cmd("screenshot", path="/tmp/pip_before.png")
        before = bbox("/tmp/pip_before.png", RED)
        check(before is None, "до PIP красного узла на экране нет")

        # --- PIP ---------------------------------------------------------
        # Регион 4:3. Зум региона считается как W/w, поэтому 400x300 даёт зум 2,
        # а узел 200 px превращается в 400 px и виден целиком.
        a.eval("$.camera.pip({ x: 400, y: 300, w: 400, h: 300 }, { at: '#far' })")
        a.step(2)
        info = a.eval("JSON.stringify($.camera.pipInfo())")
        print(f"  pipInfo: {info}")
        check('"w":400' in info and '"x":400' in info, "pipInfo отдаёт прямоугольник")
        check('"at":"#far"' in info, "pipInfo помнит, за кем следит")

        a.cmd("screenshot", path="/tmp/pip_on.png")
        got = bbox("/tmp/pip_on.png", RED)
        print(f"  красный bbox при PIP: {got}")
        check(got is not None, "PIP нарисовал вторую камеру")
        if got:
            # Узел 200 px при зуме 2 → 400 px, центр региона (600, 450) →
            # 400..800 x 250..650; низ обрезан краем кадра (600).
            exp = (400, 799, 250, 599)
            check(abs(got[0] - exp[0]) <= 2 and abs(got[1] - exp[1]) <= 2 and
                  abs(got[2] - exp[2]) <= 2 and abs(got[3] - exp[3]) <= 2,
                  f"PIP нарисован ровно в своём прямоугольнике: {got} (ждали {exp})")

        # Главная камера не сдвинулась: зелёный виден в левой половине.
        green = bbox("/tmp/pip_on.png", GREEN)
        print(f"  зелёный bbox при PIP: {green}")
        check(green is not None, "главная камера продолжает рисовать")
        if green:
            check(green[0] < 400,
                  f"зелёный (главная камера) остался в левой части ({green})")

        # --- снятие PIP ---
        check(a.eval("$.camera.pipClear()") is True, "pipClear убрал PIP")
        a.step(2)
        a.cmd("screenshot", path="/tmp/pip_off.png")
        after = bbox("/tmp/pip_off.png", RED)
        check(after is None, "после pipClear вторая камера не рисуется")
        check(a.eval("$.camera.camCount()") == 1, "осталась одна камера")
        check(a.eval("$.camera.pipInfo()") is None, "pipInfo после снятия — null")

        # --- миникарта ---
        a.eval("$.camera.minimap({ x: 560, y: 30, w: 200, h: 150 }, { at: '#hero', zoom: 0.5 })")
        a.step(2)
        m = a.eval("JSON.stringify($.camera.pipInfo())")
        print(f"  minimap: {m}")
        check('"zoom":0.5' in m, "minimap задаёт обзорный зум")
        check('"at":"#hero"' in m, "minimap следит за узлом")
        a.cmd("screenshot", path="/tmp/pip_mini.png")
        g = bbox("/tmp/pip_mini.png", GREEN)
        print(f"  зелёный bbox при миникарте: {g}")
        check(g is not None, "миникарта нарисовала узел из второй камеры")

        a.eval("$.camera.pipClear()")

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
