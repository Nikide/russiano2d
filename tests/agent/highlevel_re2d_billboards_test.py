#!/usr/bin/env python3
# ===========================================================================
# Тест билбордов Re2D и маскотов Re2DSprite в движке — фаза 5 docs/RE2D.md.
#
# 1. Поза: yaw/pitch Re2DSprite у каждого NPC совпадают с независимым
#    расчётом (угол персонажа в системе камеры, квантование 3°).
# 2. Обход кругом: поза меняется плавно, шагами квантования.
# 3. Положение: основание билборда стоит в точке пола, куда проецируется
#    (x, y), картинка не уходит ниже пола и выше своей высоты.
# 4. Порядок: ближний рисуется поверх дальнего; затухание в тумане.
# 5. Лицом/спиной: кадры с angle = 0 и π различаются.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_re2d_billboards_test.py
# ===========================================================================

import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "re2d_mascots")
FAILURES = []
W, H = 800, 600
STEP = 3.0     # $.re2d.poseStep по умолчанию


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


def shot(a, name):
    path = "/tmp/re2d_bb_%s.png" % name
    a.cmd("screenshot", path=path)
    w, h, bpp, rows = decode(path)
    return lambda x, y: tuple(rows[y][x * bpp:x * bpp + 3]), rows, bpp


def expected_pose(cam, node, size_h, depth=0.0):
    """Независимый расчёт позы: угол персонажа в системе камеры, градусы, с квантованием."""
    dx, dy = node[0] - cam[0], node[1] - cam[1]
    dist = math.hypot(dx, dy)
    fwd = (dx / dist, dy / dist)
    right = (-fwd[1], fwd[0])
    face = (math.cos(node[2]), math.sin(node[2]))
    # лицо персонажа в системе зрителя: x — вправо, z — к зрителю
    vx = face[0] * right[0] + face[1] * right[1]
    vz = -(face[0] * fwd[0] + face[1] * fwd[1])
    yaw = math.degrees(math.atan2(vx, vz))
    pitch = math.degrees(math.atan2(depth + size_h / 2 - cam[2], dist))
    q = lambda v: round(v / STEP) * STEP
    return q(yaw), q(pitch)


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0, start_timeout=120, timeout=120) as a:
        a.step(5)
        check(a.eval("$.re2d.info().billboards") >= 3, "три маскота нарисованы как билборды (%s)" % a.eval("$.re2d.info().billboards"))

        # --- 1. Поза совпадает с независимым расчётом ---------------------------
        cam = a.eval("(() => { const i = $.camera.info(); return [i.x, i.y, i.eye]; })()")
        for nid in ("maid", "swim", "police"):
            n = a.eval("(() => { const n = $('#%s').get(0); return [n.x, n.y, n.angle, n.h]; })()" % nid)
            exp = expected_pose(cam, n, n[3])
            got = a.eval("(() => { const i = $.re2dSprite.info('#%s'); return [i.yaw, i.pitch]; })()" % nid)
            check(angle_diff(got[0], exp[0]) <= STEP and abs(got[1] - exp[1]) <= STEP,
                  "%s: поза yaw %.0f° pitch %.0f° (ждали %.0f° и %.0f°)" % (nid, got[0], got[1], exp[0], exp[1]))

        # --- 2. Обход кругом: поза меняется плавно ------------------------------
        a.eval("$.camera.unfollow().eye(48)")
        seen = []
        for k in range(24):
            ang = math.radians(15 * k)
            x, y = 640 + 300 * math.cos(ang), 380 + 300 * math.sin(ang)
            a.eval("$.camera.at(%r, %r).yaw(%r)" % (x, y, math.degrees(math.atan2(380 - y, 640 - x))))
            a.step(2)
            seen.append(a.eval("$.re2dSprite.info('#swim').yaw"))
        jumps = [angle_diff(seen[i + 1], seen[i]) for i in range(len(seen) - 1)]
        check(max(jumps) <= 20, "обход по кругу: yaw меняется шагами ≤ 20° на 15° обхода (max %.0f°)" % max(jumps))
        check(angle_diff(seen[12], seen[0]) > 120, "…и за полкруга персонаж повернулся на большой угол (%.0f° против %.0f°)" % (seen[12], seen[0]))

        # --- 3. Основание билборда стоит в точке пола --------------------------
        a.eval("$.camera.at(640, 900).yaw(-90)")
        a.step(3)
        base = a.eval("(() => { const p = $.camera.worldToScreen('#swim'); return [p.x, p.y, p.scale]; })()")
        sh = 150 * base[2]
        pix, rows, bpp = shot(a, "base")
        room = {pix(5, 5), pix(400, 300), pix(400, 580)}      # цвета потолка, стены и пола
        def is_char(c):
            return all(sum(abs(c[i] - r[i]) for i in range(3)) > 60 for r in room)
        xs = range(int(base[0] - sh * 0.3), int(base[0] + sh * 0.3))
        ys = [y for y in range(0, H) if any(is_char(pix(x, y)) for x in xs)]
        check(len(ys) > 10, "персонаж виден в окне вокруг точки основания")
        if ys:
            check(max(ys) <= base[1] + 2, "картинка не уходит ниже точки на полу: низ %d, основание %.1f" % (max(ys), base[1]))
            check(min(ys) >= base[1] - sh - 2, "и не выше своей высоты: верх %d, ждали ≥ %.1f" % (min(ys), base[1] - sh))
            check(max(ys) >= base[1] - 0.2 * sh, "ноги стоят у основания (низ %d, основание %.1f)" % (max(ys), base[1]))

        # --- 4. Порядок и туман -------------------------------------------------
        a.eval("$('#maid').at(640, 250); $('#police').at(640, 600); $('#swim').at(300, 300)")
        a.eval("""(() => {
            globalThis.__log = [];
            const orig = $.gfx.push.sprite;
            globalThis.__origPush = orig;
            $.gfx.push.sprite = function (sprite, x, y, w, h, angle, color, blend) {
                globalThis.__log.push([sprite, Math.round(w), color >>> 0]);
                return orig.apply(this, arguments);
            };
            $.camera.fog(900, 0.2);
        })()""")
        a.step(2)
        log = a.eval("globalThis.__log.slice(-3)")
        sprites = {nid: a.eval("$('#%s').get(0).rot_sprite.sprite" % nid) for nid in ("maid", "police")}
        order = [e[0] for e in log if e[0] in sprites.values()]
        check(order.index(sprites["maid"]) < order.index(sprites["police"]),
              "дальняя (maid) рисуется раньше ближней (police): порядок %s" % order)
        widths = {e[0]: e[1] for e in log}
        colors = {e[0]: e[2] for e in log}
        check(widths[sprites["police"]] > widths[sprites["maid"]], "ближняя крупнее дальней (%s против %s px)" % (widths[sprites["police"]], widths[sprites["maid"]]))
        far_r, near_r = colors[sprites["maid"]] & 255, colors[sprites["police"]] & 255
        check(far_r < near_r, "в тумане дальняя темнее ближней (r %d против %d)" % (far_r, near_r))
        check((colors[sprites["maid"]] >> 24) == 255, "альфа осталась непрозрачной")
        a.eval("$.gfx.push.sprite = globalThis.__origPush; $.camera.fog(0)")

        # --- 5. Лицом и спиной --------------------------------------------------
        a.eval("$('#maid').remove(); $('#police').remove(); $('#swim').at(640, 512).size(300, 300)")
        a.eval("$.camera.at(900, 512).yaw(180).eye(120)")
        a.eval("$('#swim').get(0).angle = 0")
        a.step(3)
        pf, rows_f, bpp_f = shot(a, "front")
        a.eval("$('#swim').get(0).angle = Math.PI")
        a.step(3)
        pb, rows_b, bpp_b = shot(a, "back")
        different = sum(1 for y in range(0, H, 3) for x in range(0, W, 3) if pf(x, y) != pb(x, y))
        check(different > 300, "лицом и спиной кадры различаются (%d точек)" % different)
        a.eval("$('#swim').get(0).angle = 0")
        a.step(3)
        info = a.eval("(() => { const i = $.re2dSprite.info('#swim'); return [i.yaw, i.pitch]; })()")
        check(angle_diff(info[0], 0) <= STEP, "лицом к камере: yaw ≈ 0 (%.0f°)" % info[0])

        # --- 6. 2D-камера: тот же узел рисуется обычным 2D-путём ----------------
        a.eval("$.camera.kind(null).unfollow().at(640, 512).zoom(1)")
        a.step(3)
        check(a.eval("$.gfx.stats().sprites") >= 1, "под 2D-камерой маскот рисуется как 2D-спрайт")

    if FAILURES:
        print("\nПровалов: %d" % len(FAILURES))
        for f in FAILURES:
            print(" -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


if __name__ == "__main__":
    main()
