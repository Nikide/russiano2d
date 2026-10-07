#!/usr/bin/env python3
# ===========================================================================
# Проверка меша псевдо-3D: engine.submitMesh и z-буфер.
#
# ИСТОРИЯ ДЕФЕКТА (чтобы не вернуть). Отрисовка меша «отключена защитой» —
# якобы SDL_DrawGPUIndexedPrimitives роняет Metal. Пробы ничего не доказывали:
# в r2d_render_draw_mesh стоял ранний return ДО кода отрисовки, поэтому все
# комбинации вели себя одинаково. Настоящая причина: в draw_mesh не вызывался
# SDL_BindGPUIndexBuffer. Меш рисуется ПЕРВЫМ в проходе сцены, а индексный
# буфер биндят участки спрайтов — то есть ПОЗЖЕ. Draw уходил с непривязанным
# индексным буфером, и Metal падал с SIGSEGV.
#
# Тест проверяет ПО ПИКСЕЛЯМ: меш рисуется там, где заданы вершины; z-буфер
# реально отсекает дальний треугольник независимо от порядка отрисовки.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_mesh_test.py
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


RED = lambda c: c[0] > 120 and c[1] < 110 and c[2] < 110
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


def quad_uv(x0, y0, x1, y1, z):
    """Тот же квадрат, но цвет вершин белый — чтобы была видна ТЕКСТУРА."""
    return quad(x0, y0, x1, y1, z, 255, 255, 255)


# Квадрат из двух треугольников: (x0,y0)-(x1,y1), цвет r/g/b, глубина z.
def quad(x0, y0, x1, y1, z, r, g, b):
    def v(x, y, u, vv):
        return f"{x},{y},{z}, {u},{vv}, {r},{g},{b}"
    return ", ".join([
        v(x0, y0, 0, 0), v(x1, y0, 1, 0), v(x0, y1, 0, 1),
        v(x1, y0, 1, 0), v(x1, y1, 1, 1), v(x0, y1, 0, 1),
    ])


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.eval("$.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);"
               "$.camera.at(0,0)")
        # ОДИН обработчик на весь тест: $.update накапливает функции, и каждый
        # новый кадр рисовал бы все меши сразу — более поздний перекрыл бы
        # предыдущий (на этом я и обжёгся).
        a.eval("""
            globalThis.__mesh = null;
            globalThis.__tex = -1;
            $.update(() => {
                const m = globalThis.__mesh;
                if (!m) return;
                // count считаем САМИ: второй аргумент `undefined` движок
                // читает как 0, и меш молча не рисуется.
                const n = Math.floor(m.length / 8);
                engine.submitMesh(m, n, globalThis.__tex);
            });
        """)

        def draw(a, verts, tex=-1, steps=3):
            a.eval(f"globalThis.__mesh = new Float32Array([{verts}]);"
                   f"globalThis.__tex = {tex};")
            a.step(steps)

        # --- меш рисуется там, где заданы вершины ---
        draw(a, quad(100, 100, 300, 300, 0.5, 255, 0, 0))
        info = a.eval("JSON.stringify(engine.depthInfo())")
        print(f"  depthInfo: {info[:110]}")
        check('"blocked":0' in info, "меш НЕ отключён защитой")
        check('"meshFrames"' in info, "проход отрисовки меша выполняется")
        a.cmd("screenshot", path="/tmp/mesh_one.png")
        got = bbox("/tmp/mesh_one.png", RED)
        print(f"  красный квадрат: {got}")
        check(got is not None, "меш нарисован")
        if got:
            check(abs(got[0] - 100) <= 2 and abs(got[1] - 299) <= 3 and
                  abs(got[2] - 100) <= 2 and abs(got[3] - 299) <= 3,
                  f"меш ровно там, где заданы вершины: {got}")

        # --- z-буфер: ближний ПЕРВЫМ, дальний ВТОРЫМ ---
        draw(a, quad(100, 100, 300, 300, 0.2, 255, 0, 0) + ", " +
                 quad(100, 100, 300, 300, 0.8, 0, 255, 0))
        a.cmd("screenshot", path="/tmp/mesh_z.png")
        red = bbox("/tmp/mesh_z.png", RED)
        green = bbox("/tmp/mesh_z.png", GREEN)
        print(f"  ближний красный (первым): {red} | дальний зелёный (вторым): {green}")
        check(red is not None, "ближний треугольник виден")
        check(green is None, "дальний ОТСЕЧЁН z-буфером, хотя нарисован позже")

        # --- обратный порядок: результат тот же ---
        draw(a, quad(100, 100, 300, 300, 0.8, 0, 255, 0) + ", " +
                 quad(100, 100, 300, 300, 0.2, 255, 0, 0))
        a.cmd("screenshot", path="/tmp/mesh_z2.png")
        red2 = bbox("/tmp/mesh_z2.png", RED)
        green2 = bbox("/tmp/mesh_z2.png", GREEN)
        print(f"  дальний первым: зелёный {green2} | ближний вторым: красный {red2}")
        check(red2 is not None and green2 is None,
              "порядок отрисовки не важен: z решает")

        # --- текстура и UV ---
        # Раньше меш всегда биндил БЕЛУЮ текстуру, и u/v были мертвы:
        # текстурированный псевдо-3D был невозможен.
        a.eval("globalThis.__texid = engine.textureFromPixels("
               "2, 1, new Uint8Array([255,0,0,255, 0,255,0,255]));")
        tex = a.eval("globalThis.__texid")
        print(f"  текстура: id {tex} (2x1: красный | зелёный)")
        check(tex >= 0, "textureFromPixels отдал id текстуры")
        draw(a, quad_uv(100, 100, 300, 300, 0.5), tex)
        a.cmd("screenshot", path="/tmp/mesh_tex.png")
        left = bbox("/tmp/mesh_tex.png", RED)
        right = bbox("/tmp/mesh_tex.png", GREEN)
        print(f"  u=0 (красный): {left} | u=1 (зелёный): {right}")
        check(left is not None and right is not None,
              "текстура сэмплится по u/v, а не белой")
        if left and right:
            check(left[1] <= 205, f"u=0 слева: первая половина текстуры ({left})")
            check(right[0] >= 195, f"u=1 справа: вторая половина ({right})")

        # --- стресс: 100 треугольников ---
        verts = []
        for i in range(100):
            x = (i % 10) * 40 + 20
            y = (i // 10) * 40 + 20
            z = 0.1 + (i % 7) * 0.1
            verts.append(f"{x},{y},{z}, 0,0, 255,0,0")
            verts.append(f"{x+32},{y},{z}, 1,0, 255,0,0")
            verts.append(f"{x},{y+32},{z}, 0,1, 255,0,0")
        draw(a, ", ".join(verts), -1, steps=10)
        stress = a.eval("JSON.stringify(engine.depthInfo())")
        print(f"  стресс: {stress[:90]}")
        check('"pending":0' in stress, "100 треугольников без падения")

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
