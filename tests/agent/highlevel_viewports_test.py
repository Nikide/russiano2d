#!/usr/bin/env python3
# ===========================================================================
# Проверка мультикамерности: сплитскрин ($.camera.split/add/at/region/views).
#
# Мультикамерность в движке рисуется БЕЗ сциссора и без отдельных целей: регион
# экрана выражается ПРОЕКЦИЕЙ — камера с зумом `k` и центром `c` занимает
# прямоугольник шириной `W/k` вокруг `c`. Поэтому вторая камера — это просто
# пересчитанные x, y и zoom, а не второй проход с текстурой.
#
# Тест проверяет картинку ПО ПИКСЕЛЯМ: два узла разного цвета видны только из
# своих камер и попадают каждый в свой регион.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_viewports_test.py
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
    """PNG → (w, h, bpp, строки пикселей). Без внешних библиотек."""
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


def spots(img, test, step=4):
    w, h, bpp, px = img
    return [(x, y) for y in range(0, h, step) for x in range(0, w, step)
            if test(px[y][x * bpp:x * bpp + 3])]


GREEN = lambda c: c[1] > 140 and c[0] < 110
RED = lambda c: c[0] > 140 and c[1] < 110


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # --- регионы: чистая функция раскладки через поведение ---
        a.eval("""
            $.world.gravity(0,0).color('#101820').bounds(0,0,20000,4000);
            $('<enemy>', { id: 'l', w: 200, h: 200 }).at(300, 200)
                .color('#00ff00').appendTo($.world);
            $('<enemy>', { id: 'r', w: 200, h: 200 }).at(3300, 200)
                .color('#ff0000').appendTo($.world);
            $.camera.at(300, 200);
        """)
        a.step(2)
        check(a.eval("$.camera.camCount()") == 1, "по умолчанию одна камера")

        a.cmd("screenshot", path="/tmp/vp_one.png")
        one = decode("/tmp/vp_one.png")
        g1, r1 = spots(one, GREEN), spots(one, RED)
        print(f"  одна камера: зелёных {len(g1)}, красных {len(r1)}")
        check(len(g1) > 100, "из главной камеры зелёный узел виден")
        check(not r1, "красный узел из главной камеры НЕ виден (он далеко)")

        # --- сплитскрин: вторая камера смотрит на красный узел ---
        a.eval("$.camera.split(2); $.camera.viewAt('p2', 3300, 200)")
        a.step(2)
        check(a.eval("$.camera.camCount()") == 2, "split(2) даёт две камеры")
        views = a.eval("JSON.stringify($.camera.views())")
        print(f"  раскладка: {views}")
        check('"w":400' in views, "каждая камера получила половину окна (400 px)")

        a.cmd("screenshot", path="/tmp/vp_two.png")
        two = decode("/tmp/vp_two.png")
        g2, r2 = spots(two, GREEN), spots(two, RED)
        print(f"  две камеры: зелёных {len(g2)}, красных {len(r2)}")
        check(len(g2) > 100, "зелёный узел виден из первой камеры")
        check(len(r2) > 100, "красный узел виден из ВТОРОЙ камеры (это и есть сплитскрин)")
        # ГЛАВНАЯ камера смотрит на красный узел (регион — левая половина),
        # ВТОРАЯ (p2) смотрит на зелёный (регион — правая). Так как сциссора
        # нет, вторая камера рисуется ПОВЕРХ, и её спрайт 200 px при зуме 2
        # (400 px) накрывает правую половину целиком: от главной видно только
        # её часть слева от x = 400. Это ожидаемое поведение, а не дефект.
        rxs, gxs = [p[0] for p in r2], [p[0] for p in g2]
        rys = [p[1] for p in r2]
        print(f"  красный bbox x {min(rxs)}..{max(rxs)}, y {min(rys)}..{max(rys)}")
        print(f"  зелёный bbox x {min(gxs)}..{max(gxs)}")
        # Красный узел: центр региона (600, 300), размер 200*2 = 400.
        check(min(rxs) <= 405 and max(rxs) >= 795,
              f"вторая камера заполняет СВОЙ регион (x {min(rxs)}..{max(rxs)})")
        check(abs((min(rys) + max(rys)) // 2 - 300) <= 3,
              f"центр по y в центре региона ({(min(rys)+max(rys))//2})")
        check(max(gxs) <= 400,
              f"главная камера видна только в СВОЁМ регионе (до x = {max(gxs)})")
        # Зелёный узёл 200 px виден лишь слева от границы региона (400):
        # остальное накрыто второй камерой. Значит ширина видимой части ~200.
        check(len(g2) > 500 and len(r2) > 5000,
              f"обе камеры нарисовали свою сцену (красных {len(r2)}, зелёных {len(g2)})")

        # --- вторая камера не переехала при движении главной ---
        a.eval("$.camera.at(400, 200)")
        a.step(1)
        before = a.eval("JSON.stringify($.camera.viewAt('p2'))")
        a.eval("$.camera.at(500, 200)")
        a.step(1)
        after = a.eval("JSON.stringify($.camera.viewAt('p2'))")
        check(before == after, "камеры независимы: главная двигается, вторая стоит")

        # --- явный регион и зум ---
        a.eval("$.camera.region('p2', { x: 0, y: 0, w: 200, h: 300 })")
        rect = a.eval("JSON.stringify($.camera.region('p2'))")
        check('"w":200' in rect, f"регион задаётся явно: {rect}")
        check(a.eval("$.camera.viewZoom('p2', 3)") == 3, "зум второй камеры задаётся")
        check(a.eval("$.camera.viewZoom('p2')") == 3, "и читается обратно")

        # --- split(4) и возврат к одной ---
        a.eval("$.camera.split(4)")
        a.step(1)
        check(a.eval("$.camera.camCount()") == 4, "split(4) даёт четыре камеры")
        check(len(a.eval("JSON.stringify($.camera.views())")) > 100, "views() знает все четыре")
        a.eval("$.camera.split(1)")
        a.step(1)
        check(a.eval("$.camera.camCount()") == 1, "split(1) возвращает одну камеру")
        check(a.eval("$.camera.list()") == "[]" or a.eval("$.camera.list().length") == 0,
              "после split(1) вторичных камер не осталось")

        # --- картинка одиночной камеры не испортилась ---
        a.eval("$.camera.at(300, 200)")
        a.step(2)
        a.cmd("screenshot", path="/tmp/vp_back.png")
        back = decode("/tmp/vp_back.png")
        g3, r3 = spots(back, GREEN), spots(back, RED)
        check(len(g3) > 100 and not r3,
              f"после возврата к одной камере картинка как была (зелёных {len(g3)}, красных {len(r3)})")

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
