#!/usr/bin/env python3
# ===========================================================================
# task-67 (r2dvfx), милстоун M3: детерминизм по seed и бюджет.
#
# Проверяются числа, а не обещания:
#   * два прогона одного и того же эффекта с ОДНИМ seed дают одинаковые
#     значения (time/progress/hash) и одинаковый кадр;
#   * другой seed даёт другой hash;
#   * эффект идёт игровым dt: пауза его останавливает, resume — продолжает;
#   * общий бюджет частиц/света соблюдается: 100 одновременных эффектов не
#     выбивают потолок, `degraded` это показывает.
#
# Модуль: src/highlevel/vfx.js.
#
# Запуск:
#   python3 tests/agent/vfx_determinism_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "vfx")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:160])
        return default


def decode(path):
    """PNG → (w, h, pixels RGBA)."""
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
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            v = line[x]
            if f == 1:
                v = (v + a) & 0xff
            elif f == 2:
                v = (v + b) & 0xff
            elif f == 3:
                v = (v + ((a + b) >> 1)) & 0xff
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                v = (v + pr) & 0xff
            line[x] = v
        prev = line
        for x in range(w):
            out[(y * w + x) * 4 + 0] = line[x * bpp + 0]
            out[(y * w + x) * 4 + 1] = line[x * bpp + 1] if bpp > 1 else line[x * bpp]
            out[(y * w + x) * 4 + 2] = line[x * bpp + 2] if bpp > 2 else line[x * bpp]
            out[(y * w + x) * 4 + 3] = line[x * bpp + 3] if bpp > 3 else 255
    return w, h, out


def shot(a, name):
    path = os.path.join(ROOT, "build", "vfx_%s.png" % name)
    a.screenshot(path)
    return decode(path)


def different(img_a, img_b, step=2):
    w, h, pa = img_a
    pb = img_b[2]
    n = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            o = (y * w + x) * 4
            if (abs(pa[o] - pb[o]) > 6 or abs(pa[o + 1] - pb[o + 1]) > 6
                    or abs(pa[o + 2] - pb[o + 2]) > 6):
                n += 1
    return n


SPEC = """
(function(){
    $.vfx.define('vfx.det', {
        duration: 1.5, seed: 'same-seed', budget: { particles: 30, light: 0 },
        layers: [
            { at: 0.0, use: 'particles.burst',
              params: { preset: 'sparks', count: 12, speed: [40, 90],
                        lifetime: [100, 200], max_particles: 24 } },
            { at: 0.0, use: 'fx.pulse',
              params: { radius: 26, ms: 300, color: '#ffd27a' } },
            { at: 0.25, use: 'fx.shockwave',
              params: { radius: 60, ms: 300, color: '#ffffff' } },
        ],
    });
})()
"""


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)
        ev(a, SPEC)
        ev(a, "$.vfx.clear(); $.debug.clearErrors();")

        # --- 1. Один seed → одинаковые значения -------------------------------
        def run(seed_opt=""):
            ev(a, "$.vfx.clear();")
            ev(a, "$.vfx._det = $.vfx.play('vfx.det', { at: [100, 100]%s });" % seed_opt)
            a.step(20)
            return ev(a, "$.vfx._det.query()", {})

        first = run()
        second = run()
        check(first.get("seed") == second.get("seed"),
              "seed один и тот же (%s)" % first.get("seed"))
        check(abs(first.get("time", -1) - second.get("time", -2)) < 1e-9,
              "время совпадает (%.6f vs %.6f)" % (first.get("time", -1),
                                                  second.get("time", -2)))
        check(abs(first.get("progress", -1) - second.get("progress", -2)) < 1e-9,
              "progress совпадает")
        check(first.get("hash") == second.get("hash"),
              "hash значений совпадает (%s vs %s)" % (first.get("hash"),
                                                      second.get("hash")))
        check(first.get("draws") == second.get("draws"),
              "число случайных выборок совпадает (%s)" % first.get("draws"))

        # Кадр: тот же seed → та же картинка (допуск на 0.2 % точек).
        ev(a, "$.vfx.clear(); $.vfx.define('vfx.det.frame', { duration: 2, seed: 11,"
               " budget: { particles: 0, light: 0 },"
               " layers: [{ at: 0, use: 'fx.pulse',"
               " params: { radius: 48, ms: 600, color: '#63d6a0' } }] });")
        ev(a, "$.vfx.clear(); $.vfx.play('vfx.det.frame', { at: [200, 200] });")
        a.step(5)
        img_a = shot(a, "seed_a")
        ev(a, "$.vfx.clear(); $.vfx.play('vfx.det.frame', { at: [200, 200] });")
        a.step(5)
        img_b = shot(a, "seed_b")
        w, h, _ = img_a
        diff = different(img_a, img_b)
        check(diff <= (w * h) // 500,
              "одинаковый seed → одинаковый кадр (различий %d из %d)" % (diff, w * h))

        # --- 2. Другой seed → другой hash -----------------------------------
        third = run(", seed: 'other-seed'")
        check(third.get("seed") == "other-seed", "seed из opts перекрывает спеку")
        check(third.get("hash") != first.get("hash"),
              "другой seed → другой hash (%s vs %s)" % (third.get("hash"),
                                                        first.get("hash")))

        # --- 3. Пауза останавливает эффект, resume продолжает ----------------
        ev(a, "$.vfx.clear(); $.vfx._det = $.vfx.play('vfx.det', { at: [100, 100] });")
        a.step(5)
        t1 = (ev(a, "$.vfx._det.query()", {}) or {}).get("time", -1)
        ev(a, "$.time.pause()")
        a.step(10)
        t2 = (ev(a, "$.vfx._det.query()", {}) or {}).get("time", -2)
        check(abs(t1 - t2) < 1e-9,
              "пауза останавливает эффект (%.4f → %.4f)" % (t1, t2))
        ev(a, "$.time.resume()")
        a.step(5)
        t3 = (ev(a, "$.vfx._det.query()", {}) or {}).get("time", -3)
        check(t3 > t1, "после resume время снова идёт (%.4f → %.4f)" % (t1, t3))

        # --- 4. Бюджет частиц/света ------------------------------------------
        budget = ev(a, "$.vfx.budget()", {})
        check(isinstance(budget, dict) and budget.get("particles", 0) > 0
              and budget.get("light", 0) >= 0,
              "budget() отдаёт потолки: %s" % (budget,))
        ev(a, "$.vfx.budget({ particles: 200, light: 1 }); $.vfx.clear();")

        ev(a, """
            $.vfx.define('vfx.heavy', {
                duration: 5, seed: 'heavy', budget: { particles: 120, light: 1 },
                layers: [
                    { at: 0, use: 'particles.burst',
                      params: { preset: 'sparks', count: 10, max_particles: 20 } },
                    { at: 0, use: 'light.emitter',
                      params: { radius: 80, intensity: 1, color: '#ffcc88' } },
                ],
            });
        """)
        for i in range(5):
            ev(a, "$.vfx.play('vfx.heavy', { at: [%d, 100] });" % (60 + i * 30))
        a.step(1)
        s = ev(a, "$.vfx.stats()", {})
        check(s.get("particles", 9999) <= 200,
              "бюджет частиц соблюдён (%s ≤ 200)" % s.get("particles"))
        check(s.get("lights", 9999) <= 1,
              "бюджет света соблюдён (%s ≤ 1)" % s.get("lights"))
        check(s.get("degraded", 0) >= 1,
              "degraded показывает упор в бюджет (%s)" % s.get("degraded"))
        check(s.get("effects", 0) == 5,
              "все пять эффектов остались живы, деградировали, а не исчезли")

        # 100 одновременных эффектов не выбивают потолок.
        ev(a, "$.vfx.clear(); $.vfx.budget({ particles: 200, light: 1 });")
        ev(a, """
            $.vfx.define('vfx.cheap', {
                duration: 5, seed: 'cheap', budget: { particles: 20, light: 0 },
                layers: [{ at: 0, use: 'fx.flash',
                           params: { color: '#ffffff', ms: 30, alpha: 0.1 } }],
            });
            for (var i = 0; i < 100; i++) $.vfx.play('vfx.cheap', { at: [i, 100] });
        """)
        a.step(1)
        s100 = ev(a, "$.vfx.stats()", {})
        check(s100.get("effects", 0) == 100, "сто эффектов живы (%s)" % s100.get("effects"))
        check(s100.get("particles", 9999) <= 200,
              "сто эффектов не выбили потолок частиц (%s ≤ 200)"
              % s100.get("particles"))
        check(s100.get("degraded", 0) >= 90,
              "degraded честно считает урезанные (%s)" % s100.get("degraded"))

        # Вернуть умолчания и убедиться, что getter это видит.
        ev(a, "$.vfx.budget({ particles: 512, light: 16 });")
        check(ev(a, "$.vfx.budget().particles") == 512,
              "budget() — и сеттер, и геттер")

        check(a.ping().get("pong") is True, "движок отвечает после проверок")
        check(ev(a, "$.debug.report().clean") is True, "журнал чист по неустранимым ошибкам")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
