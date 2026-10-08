#!/usr/bin/env python3
# ===========================================================================
# Тест мира-коробки Re2D (`$.re2d.room`) в движке — фаза 4 docs/RE2D.md.
#
# Проверяется по пикселям и по числам:
#   * пол, потолок и стены стоят там, где их ставит перспектива (границы
#     по строкам считаются независимо, формулой, а не копией кода движка);
#   * поворот камеры показывает другие стены; пол и потолок двусторонние;
#   * внешняя сторона плит не рисуется (отбраковка по обходу);
#   * игрок упирается в стену как в обычную 2D-стену (Box2D);
#   * под 2D-камерой тот же мир — план этажа: потолок скрыт, пол виден;
#   * кадр детерминирован, текстуры стен действительно накладываются.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_re2d_room_test.py
# ===========================================================================

import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "re2d_room")
FAILURES = []
W, H = 800, 600
WALL, FLOOR, CEIL = (192, 64, 64), (48, 80, 192), (64, 160, 64)


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


class Shot:
    def __init__(self, path):
        self.w, self.h, self.bpp, self.rows = decode(path)

    def px(self, x, y):
        return tuple(self.rows[y][x * self.bpp:x * self.bpp + 3])

    def near(self, x, y, color, tol=4):
        p = self.px(x, y)
        return all(abs(p[i] - color[i]) <= tol for i in range(3))

    def column_changes(self, x):
        """Строки, на которых цвет в колонке x меняется (границы поверхностей)."""
        cuts, prev = [], self.px(x, 0)
        for y in range(1, self.h):
            cur = self.px(x, y)
            if max(abs(cur[i] - prev[i]) for i in range(3)) > 24:
                cuts.append(y)
            prev = cur
        return cuts


def shot(a, name):
    path = "/tmp/re2d_room_%s.png" % name
    a.cmd("screenshot", path=path)
    return Shot(path)


def row_of(depth, up, fov_deg):
    """Строка экрана для точки на глубине depth и высоте up над глазами (pitch 0)."""
    f = (H / 2) / math.tan(math.radians(fov_deg) / 2)
    return H / 2 - up * f / depth


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        # --- Взгляд на север: красная стена, пол внизу, потолок вверху ---------
        s = shot(a, "north")
        check(s.near(400, 300, WALL), "центр кадра — красная стена %s" % (s.px(400, 300),))
        check(s.near(400, 590, FLOOR), "низ кадра — синий пол %s" % (s.px(400, 590),))
        check(s.near(400, 10, CEIL), "верх кадра — зелёный потолок %s" % (s.px(400, 10),))

        cuts = s.column_changes(400)
        base = row_of(800, -48, 70)      # основание северной стены: z = 0, глаза на 48
        top = row_of(800, 256 - 48, 70)  # верх стены: z = 256
        check(len(cuts) == 2, "в колонке две границы: потолок|стена и стена|пол (%s)" % cuts)
        if len(cuts) == 2:
            check(abs(cuts[0] - top) <= 2, "верх стены на строке %.1f (ждали %.1f)" % (cuts[0], top))
            check(abs(cuts[1] - base) <= 2, "основание стены на строке %.1f (ждали %.1f)" % (cuts[1], base))

        # --- Поворот: восточная стена ближе, её основание ниже ------------------
        a.eval("$.camera.yaw(0)")
        a.step(2)
        s = shot(a, "east")
        cuts = s.column_changes(400)
        base_e = row_of(1024 - 512, -48, 70)
        top_e = row_of(1024 - 512, 256 - 48, 70)
        check(len(cuts) == 2 and abs(cuts[0] - top_e) <= 2 and abs(cuts[1] - base_e) <= 2,
              "восток: границы %s (ждали %.1f и %.1f)" % (cuts, top_e, base_e))

        # --- Взгляд вверх/вниз: настоящий наклон меняет горизонт ----------------
        a.eval("$.camera.yaw(-90).pitch(30)")
        a.step(2)
        s_up = shot(a, "up")
        check(s_up.near(400, 580, WALL) or s_up.near(400, 580, FLOOR),
              "взгляд вверх: пол ушёл к нижнему краю или за него")
        check(s_up.near(400, 300, CEIL) or s_up.near(400, 300, WALL), "взгляд вверх: в центре выше горизонта")
        cuts_up = s_up.column_changes(400)
        f = (H / 2) / math.tan(math.radians(35))
        # при pitch 30° основание стены: depth = 800*cos30 - (-48)*... считаем полной формулой
        p = math.radians(30)
        def screen_y(dist, z):
            up = z - 48
            depth = dist * math.cos(p) + up * math.sin(p)
            upv = up * math.cos(p) - dist * math.sin(p)
            return H / 2 - upv * f / depth
        exp_base, exp_top = screen_y(800, 0), screen_y(800, 256)
        check(any(abs(c - exp_base) <= 2 for c in cuts_up) or exp_base > H,
              "наклон 30°: основание стены на строке %.1f (границы %s)" % (exp_base, cuts_up))
        a.eval("$.camera.pitch(0)")

        # --- Внешняя сторона плит не рисуется ----------------------------------
        a.eval("$.camera.unfollow().at(512, -400).yaw(90)")
        a.step(2)
        info = a.eval("engine.re2d.info()")
        st = info["stats"]
        check(st["culled"] > 0, "снаружи внешние грани плит отбракованы (culled = %s)" % st["culled"])
        s_out = shot(a, "outside")
        check(s_out.near(400, 300, WALL) or s_out.near(400, 300, CEIL) or s_out.near(400, 300, FLOOR),
              "снаружи кадр не пустой: видна внутренность через отбракованную плиту")
        a.eval("$.camera.follow('#hero').yaw(-90)")
        a.step(2)

        # --- Игрок упирается в стену (Box2D, как в 2D) --------------------------
        a.eval("$('#hero').velocity(0, -500)")
        a.step(150)                      # 750 px пути хватило бы пройти насквозь, если бы стены не было
        y = a.eval("$('#hero').pos().y")
        check(8 < y < 24, "игрок упёрся в северную стену (полразмера тела 14), y = %.1f" % y)
        a.eval("$('#hero').velocity(0, 0)")

        # --- Детерминизм кадра --------------------------------------------------
        a.eval("$('#hero').at(512, 800)")
        a.eval("$.camera.yaw(-90).pitch(0)")
        a.step(2)
        s1 = shot(a, "det1")
        s2 = shot(a, "det2")
        check(s1.rows == s2.rows, "два скриншота одного состояния побайтово совпали")

        # --- 2D-камера: тот же мир — план этажа ---------------------------------
        a.eval("$.camera.kind(null).unfollow().at(512, 512).zoom(0.5)")
        a.step(2)
        s2d = shot(a, "plan")
        check(s2d.near(400, 300, FLOOR), "план этажа: в центре пол, потолок скрыт %s" % (s2d.px(400, 300),))
        a.eval("$.camera.kind(Re2D).zoom(1).follow('#hero')")
        a.step(2)

        # --- Текстуры накладываются, а не заливают плоским цветом ---------------
        a.eval("""(() => {
            $('.re2d-room').remove();
            $.re2d.room({ x: 0, y: 0, w: 1024, h: 1024, height: 256,
                          wall: 'demos/assets/tiles/wall_brick.png',
                          floor: 'demos/assets/tiles/wall_stone.png', ceiling: false });
            $.camera.yaw(-90);
            return 1;
        })()""")
        a.step(3)
        sizes = a.eval("$('wall').toArray().map(w => [Math.round(w.w), Math.round(w.h)]).sort().join(';')")
        check(sizes == "1088,32;1088,32;32,1024;32,1024",
              "спрайт не подменил размеры плит (тонкие плиты остались тонкими): %s" % sizes)
        s_tex = shot(a, "textured")
        _w, _h, _bpp, _rows = decode("demos/assets/tiles/wall_brick.png")
        palette = {tuple(r[x * _bpp:x * _bpp + 3]) for r in _rows for x in range(_w)}
        patch = {s_tex.px(x, y) for x in range(300, 500, 2) for y in range(200, 320, 2)}
        found = palette & patch
        check(len(found) >= 3, "на стене видно %d из %d цветов кирпичной текстуры" % (len(found), len(palette)))
        check(not s_tex.near(400, 260, WALL, 30), "стена не залита плоским цветом комнаты")
        side = {s_tex.px(x, y) for x in range(8, 60, 2) for y in range(230, 300, 2)}
        check(len(palette & side) >= 2, "слева от дальней стены видна боковая стена с кирпичом (%d цветов текстуры)" % len(palette & side))
        info = a.eval("$.re2d.info()")
        check(any(b["texture"] >= 0 for b in info["buckets"]), "в вёдрах кадра есть текстурное ведро")

    if FAILURES:
        print("\nПровалов: %d" % len(FAILURES))
        for f in FAILURES:
            print(" -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


if __name__ == "__main__":
    main()
