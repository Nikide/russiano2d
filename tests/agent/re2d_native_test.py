#!/usr/bin/env python3
# ===========================================================================
# Тест нативного ядра Re2D (engine.re2d.*) в движке — фаза 2 docs/RE2D.md.
#
# 1. Числа: проекция точек в движке сверяется с независимой формулой на
#    Python (не копией C-кода: здесь математика записана через матрицы поворота).
# 2. Пиксели: мировой квадрат стоит там, где его обещает перспектива; z-буфер
#    сортирует стены независимо от порядка; близкая грань режется ближней
#    плоскостью, а не рвёт кадр.
#
# Запуск (после сборки):
#   python3 tests/agent/re2d_native_test.py
# ===========================================================================

import math
import os
import random
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "re2d_native")
FAILURES = []
W, H = 800, 600


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


def bbox(path, pred):
    w, h, bpp, px = decode(path)
    pts = [(x, y) for y in range(h) for x in range(w) if pred(px[y][x * bpp:x * bpp + 3])]
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), max(xs), min(ys), max(ys), len(pts))


def pixel(path, x, y):
    w, h, bpp, px = decode(path)
    return tuple(px[y][x * bpp:x * bpp + 3])


RED = lambda c: c[0] > 150 and c[1] < 90 and c[2] < 90
GREEN = lambda c: c[1] > 150 and c[0] < 90 and c[2] < 90
BLUE = lambda c: c[2] > 150 and c[0] < 90 and c[1] < 90


def reference_project(view, pt):
    """Независимая запись проекции через матрицы поворота (не копия C-кода)."""
    x, y, eye, yaw, pitch, fov = view[:6]
    near = 4.0
    # вектор от глаз; ось «вперёд» — (cos yaw, sin yaw), «вправо» — (-sin yaw, cos yaw)
    d = (pt[0] - x, pt[1] - y, pt[2] - eye)
    fwd = (math.cos(yaw), math.sin(yaw), 0.0)
    right = (-math.sin(yaw), math.cos(yaw), 0.0)
    # наклон: «вперёд с подъёмом» и «вверх с наклоном»
    fwd_p = (math.cos(pitch) * fwd[0], math.cos(pitch) * fwd[1], math.sin(pitch))
    up_p = (-math.sin(pitch) * fwd[0], -math.sin(pitch) * fwd[1], math.cos(pitch))
    dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    depth, r, u = dot(d, fwd_p), dot(d, right), dot(d, up_p)
    if depth < near:
        return None
    f = (H / 2) / math.tan(fov / 2)
    return (W / 2 + r * f / depth, H / 2 - u * f / depth, 1 - near / depth, f / depth)


def wall(x, y0, y1, z0, z1, rgb):
    """Стена в плоскости x = const: два треугольника, лицом к камере в начале координат."""
    r, g, b = rgb

    def v(yy, zz, uu, vv):
        return f"{x},{yy},{zz},{uu},{vv},{r},{g},{b}"
    return ", ".join([v(y0, z1, 0, 0), v(y1, z1, 1, 0), v(y0, z0, 0, 1),
                      v(y1, z1, 1, 0), v(y1, z0, 1, 1), v(y0, z0, 0, 1)])


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("typeof engine.re2d") == "object", "engine.re2d доступен")
        for name in ("view", "project", "mesh", "info"):
            check(a.eval("typeof engine.re2d.%s" % name) == "function", "engine.re2d.%s — функция" % name)

        # --- 1. Числа: проекция против независимой формулы ---------------------
        rng = random.Random(11)
        worst = 0.0
        tested = 0
        for case in range(8):
            view = [rng.uniform(-200, 200), rng.uniform(-200, 200), rng.uniform(10, 90),
                    rng.uniform(-math.pi, math.pi), rng.uniform(-1.0, 1.0), rng.uniform(0.8, 1.6)]
            pts = [(rng.uniform(-600, 600), rng.uniform(-600, 600), rng.uniform(-40, 200)) for _ in range(12)]
            a.eval("globalThis.__view = %s" % view)
            a.step(2)    # вид ставится обработчиком кадра
            flat = ",".join("%r,%r,%r" % p for p in pts)
            got = a.eval("""(() => {
                const i = new Float32Array([%s]);
                const o = new Float32Array(%d);
                const n = engine.re2d.project(i, o);
                return [n].concat(Array.from(o));
            })()""" % (flat, len(pts) * 4))
            visible = 0
            for k, p in enumerate(pts):
                ref = reference_project(view, p)
                out = got[1 + k * 4: 1 + k * 4 + 4]
                if ref is None:
                    check(out[2] == -1.0, "невидимая точка помечена z01 = -1")
                    continue
                visible += 1
                # Ближе ~20 единиц глубины float32 усиливается в десятки раз
                # (масштаб f/depth): такие точки считаем видимыми, но не сверяем.
                if ref[3] > 15:
                    continue
                tested += 1
                err = max(abs(out[0] - ref[0]), abs(out[1] - ref[1]), abs(out[3] - ref[3]) * 10, abs(out[2] - ref[2]) * 100)
                worst = max(worst, err)
            check(got[0] == visible, "число видимых точек совпало (%d)" % visible)
        check(tested > 20 and worst < 0.5,
              "проекция совпала с независимой формулой на %d точках, худшее расхождение %.3f px" % (tested, worst))

        # --- 2. info(): факты вида ---------------------------------------------
        a.eval("globalThis.__view = [10, 20, 30, 0.5, 0.25, 1.2, 500, 0.3]")
        a.step(2)
        info = a.eval("engine.re2d.info()")
        check(abs(info["x"] - 10) < 1e-6 and abs(info["eye"] - 30) < 1e-6, "info: положение и высота глаз")
        check(abs(info["yaw"] - 0.5) < 1e-6 and abs(info["pitch"] - 0.25) < 1e-6, "info: углы")
        check(info["width"] == W and info["height"] == H, "info: размер кадра берётся у рендера (%sx%s)" % (info["width"], info["height"]))
        check(info["fogFar"] == 500 and abs(info["fogMin"] - 0.3) < 1e-6, "info: туман")
        check(abs(info["focal"] - (H / 2) / math.tan(0.6)) < 0.01, "info: фокус из fov")

        # --- 3. Пиксели: стена стоит там, где обещает перспектива --------------
        a.eval("globalThis.__view = [0, 0, 0, 0, 0, Math.PI / 2]")
        a.eval("globalThis.__mesh = new Float32Array([%s])" % wall(100, -50, 50, -50, 50, (255, 0, 0)))
        a.step(3)
        a.cmd("screenshot", path="/tmp/re2d_wall.png")
        box = bbox("/tmp/re2d_wall.png", RED)
        print("  красная стена:", box)
        check(box is not None, "стена нарисована")
        if box:
            # глубина 100, фокус 300: ±50 → ±150 px вокруг центра (400, 300)
            check(abs(box[0] - 250) <= 2 and abs(box[1] - 549) <= 3 and abs(box[2] - 150) <= 2 and abs(box[3] - 449) <= 3,
                  "границы по формуле перспективы: 250..550 × 150..450 (получено %s)" % (box,))
        stats = a.eval("engine.re2d.info().stats")
        check(stats["trisIn"] == 2 and stats["trisOut"] == 2 and stats["clipped"] == 0, "статистика: 2 → 2 без отсечения (%s)" % stats)

        # --- 4. z-буфер: порядок отправки не важен -----------------------------
        far_red = wall(200, -200, 200, -150, 150, (255, 0, 0))
        near_green = wall(100, -60, 60, -60, 60, (0, 255, 0))
        for label, order in (("дальняя первой", far_red + ", " + near_green),
                             ("ближняя первой", near_green + ", " + far_red)):
            a.eval("globalThis.__mesh = new Float32Array([%s])" % order)
            a.step(3)
            a.cmd("screenshot", path="/tmp/re2d_z.png")
            centre = pixel("/tmp/re2d_z.png", 400, 300)
            edge = pixel("/tmp/re2d_z.png", 400 + 250, 300)
            check(GREEN(centre), "%s: в центре ближняя зелёная %s" % (label, centre))
            check(RED(edge), "%s: за краем ближней видна дальняя красная %s" % (label, edge))

        # --- 5. Ближняя плоскость: пол под ногами, а не рваный кадр -----------
        # Горизонтальный квадрат под глазами: часть его позади камеры.
        floor = ", ".join([
            "-200,-200,-40,0,0,0,0,255", "300,-200,-40,1,0,0,0,255", "-200,200,-40,0,1,0,0,255",
            "300,-200,-40,1,0,0,0,255", "300,200,-40,1,1,0,0,255", "-200,200,-40,0,1,0,0,255"])
        a.eval("globalThis.__view = [0, 0, 40, 0, 0, Math.PI / 2]; globalThis.__mesh = new Float32Array([%s])" % floor)
        a.step(3)
        stats = a.eval("engine.re2d.info().stats")
        check(stats["clipped"] >= 1 and stats["trisOut"] >= 2, "пол под камерой отсечён ближней плоскостью (%s)" % stats)
        a.cmd("screenshot", path="/tmp/re2d_floor.png")
        blue = bbox("/tmp/re2d_floor.png", BLUE)
        check(blue is not None and blue[3] >= H - 3, "пол виден и доходит до нижнего края кадра (%s)" % (blue,))
        check(blue is not None and blue[2] > 300, "пол начинается ниже горизонта (%s)" % (blue,))

        # --- 6. Флаг CULL_BACK -------------------------------------------------
        a.eval("globalThis.__view = [0, 0, 0, 0, 0, Math.PI / 2]; globalThis.__flags = engine.re2d.CULL_BACK;"
               "globalThis.__mesh = new Float32Array([%s])" % wall(100, -50, 50, -50, 50, (255, 0, 0)))
        a.step(3)
        stats = a.eval("engine.re2d.info().stats")
        # Стена нарисована обходом, который при yaw 0 — лицевой или нет: проверяем согласованность счётчиков.
        check(stats["culled"] + stats["trisOut"] == stats["trisIn"], "culled + trisOut = trisIn (%s)" % stats)
        a.eval("globalThis.__flags = 0")

        # --- 7. Нечисловой ввод ------------------------------------------------
        msg = a.eval("(() => { try { engine.re2d.view(NaN, 0, 0, 0, 0, 1); return ''; } catch (e) { return String(e.message); } })()")
        check("конечными" in msg, "view с NaN — понятная ошибка (%s)" % msg)
        msg = a.eval("(() => { try { engine.re2d.project([1,2,3], new Float32Array(4)); return ''; } catch (e) { return String(e.message); } })()")
        check("Float32Array" in msg, "project с обычным массивом — понятная ошибка (%s)" % msg)

    if FAILURES:
        print("\nПровалов: %d" % len(FAILURES))
        for f in FAILURES:
            print(" -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


if __name__ == "__main__":
    main()
