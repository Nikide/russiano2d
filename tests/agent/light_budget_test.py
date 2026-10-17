#!/usr/bin/env python3
# ===========================================================================
# Приёмка task-66, часть I11: бюджет и LOD света.
#
# Проверяется числами и пикселями:
#   * $.gfx.light.budget() без аргумента — конфигурация + статистика кадра;
#   * 45 источников в кадре при max:32 → 32 полных + 13 degraded, и это те же
#     числа, что в фактическом мире ($.agent.nodes('light'));
#   * в LOD реально урезаны лучи/кольца/радиус: треугольников меньше, кадр не
#     медленнее (замер $.time.perfNow вокруг $.gfx._render());
#   * priority: 'camera' | 'power' | функция — кто именно остаётся полным;
#   * radiusScale: 0 — вклад источников за лимитом отключён (off), а не «тихо
#     пропал»: счётчики и предупреждение;
#   * существующие quality()/stats()/qualityReport() сохранены, новые поля
#     добавлены рядом; отказ на неизвестный приоритет — структурная ошибка.
#
# Запуск (после сборки движка):
#   python3 tests/agent/light_budget_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "light_budget")
SHOTS = os.path.join(ROOT, "build")
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


def ev(a, code, default=None):
    """eval, который на старом бинарнике не рушит весь тест: красный, а не стек."""
    try:
        return a.eval(code)
    except Exception as exc:                      # noqa: BLE001 — нужен счёт красных
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:120])
        return default


# --- PNG без зависимостей ---------------------------------------------------

def read_png(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG: " + path)
    pos, idat, width, height, channels = 8, b"", 0, 0, 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, _depth, color = struct.unpack(">IIBB", chunk[:10])
            channels = {0: 1, 2: 3, 4: 2, 6: 4}[color]
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        filt = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if filt == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filt == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filt == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = prev[i]
                upleft = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(up - upleft), abs(left - upleft), abs(left + up - 2 * upleft)
                pred = left if (pa <= pb and pa <= pc) else (up if pb <= pc else upleft)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, bytes(out)


def luma(image, lx, ly, half=6, scale_x=1.0, scale_y=1.0):
    width, height, channels, data = image
    cx = int(round(lx * scale_x))
    cy = int(round(ly * scale_y))
    hx = max(1, int(round(half * scale_x)))
    hy = max(1, int(round(half * scale_y)))
    total = count = 0
    for y in range(max(0, cy - hy), min(height, cy + hy)):
        row = y * width
        for x in range(max(0, cx - hx), min(width, cx + hx)):
            o = (row + x) * channels
            total += data[o] + data[o + 1] + data[o + 2]
            count += 3
    return total / float(max(1, count))


def levels(a):
    """Фактический уровень бюджета у каждого узла <light> (0/1/2, -1 — нет)."""
    return ev(a, """(() => {
        const out = {};
        for (const n of $.agent.nodes('light')) {
            $('#' + n.id).eachNode((_, el) => {
                out[n.id] = el._light_budget ? el._light_budget.level : -1;
            });
        }
        return out;
    })()""", {})


def frame_ms(a, frames=20, repeats=3):
    """Честный замер кадра: perfNow вокруг прямых вызовов $.gfx._render()."""
    best = None
    for _ in range(repeats):
        value = ev(a, "(() => { const t0 = $.time.perfNow();"
                      " for (let i = 0; i < %d; i++) $.gfx._render();"
                      " return ($.time.perfNow() - t0) / %d; })()" % (frames, frames), None)
        if value is None:
            return None
        if best is None or value < best:
            best = value
    return best


def main():
    os.makedirs(SHOTS, exist_ok=True)

    with Agent(game=GAME, seed=9, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        # --- 1. API и умолчания ----------------------------------------------
        check(ev(a, "typeof $.gfx.light.budget") == "function",
              "$.gfx.light.budget() есть")
        base = ev(a, "$.gfx.light.budget()", {})
        check(isinstance(base, dict), "геттер отдаёт объект конфигурации: %s" % (base,))
        check(base.get("max") == 0 and base.get("enabled") is False,
              "по умолчанию бюджет выключен: max=%s enabled=%s"
              % (base.get("max"), base.get("enabled")))
        check(base.get("priority") == "mixed",
              "приоритет по умолчанию — mixed (сила, ослабленная расстоянием): %s"
              % (base.get("priority"),))
        scale = base.get("radiusScale")
        check(isinstance(scale, (int, float)) and 0 < scale <= 1,
              "радиус LOD по умолчанию в (0..1]: %s" % (scale,))
        check(isinstance(base.get("lights"), dict) and isinstance(base.get("emitters"), dict),
              "статистика разделена: lights + emitters")

        # Старое не сломано.
        q = ev(a, "$.gfx.light.quality()", {})
        check(q.get("maxShadowLights") == 32 and q.get("maxRays") == 96
              and q.get("maxSegments") == 4096 and q.get("lightmapScale") == 0.5,
              "quality() не изменился: %s" % (q,))
        stats = ev(a, "$.gfx.light.stats()", {})
        check(all(k in stats for k in ("built", "cached", "lights", "shadowLights",
                                       "culledLights", "emitterDegraded", "lightmap")),
              "stats() сохранил прежние поля")
        check(all(k in stats for k in ("budgetSources", "budgetFull",
                                       "budgetDegraded", "budgetOff")),
              "stats() получил поля бюджета рядом: budgetSources/Full/Degraded/Off")
        report = ev(a, "$.gfx.light.qualityReport()", {})
        check("budget" in report and "degraded" in report,
              "qualityReport() отдаёт budget и degraded")
        check(report.get("degraded") == 0,
              "при выключенном бюджете degraded == 0: %s" % (report.get("degraded"),))

        # --- 2. 45 источников при max:32 -------------------------------------
        ev(a, "budgetScene(45, { radius: 80, segments: 8, rings: 3 })")
        a.step(3)
        nodes = ev(a, "$.agent.nodes('light')", [])
        check(len(nodes) == 45, "в мире действительно 45 источников: %s" % (len(nodes),))
        report_off = ev(a, "$.gfx.light.qualityReport()", {})
        check(report_off.get("lights") == 45,
              "без бюджета нарисованы все 45: %s" % (report_off.get("lights"),))
        tri_off = ev(a, "$.debug.stats().triangles", 0)
        ms_off = frame_ms(a)
        number("бюджет ВЫКЛ: 45 источников, треугольников %s, кадр %.3f мс"
               % (tri_off, ms_off if ms_off is not None else float("nan")))

        ev(a, "$.gfx.light.budget({ max: 32 })")
        a.step(3)
        report = ev(a, "$.gfx.light.qualityReport()", {})
        budget = report.get("budget", {}) if isinstance(report.get("budget"), dict) else {}
        levels_now = levels(a)
        full_ids = [k for k, v in levels_now.items() if v == 0]
        lod_ids = [k for k, v in levels_now.items() if v == 1]
        off_ids = [k for k, v in levels_now.items() if v == 2]
        number("бюджет ВКЛ max=32: %s" % (budget,))
        check(budget.get("max") == 32 and budget.get("enabled") is True,
              "конфигурация применилась: max=32 enabled=true")
        check(budget.get("sources") == 45,
              "источников в кадре 45, как узлов мира: %s" % (budget.get("sources"),))
        check(budget.get("full") == 32,
              "полных источников 32: %s" % (budget.get("full"),))
        check(budget.get("lod") == 13 and budget.get("off") == 0,
              "в LOD ушли 13, отключённых нет: lod=%s off=%s"
              % (budget.get("lod"), budget.get("off")))
        check(budget.get("degraded") == 13 and report.get("degraded") == 13,
              "degraded == 13 и в budget, и в qualityReport: %s / %s"
              % (budget.get("degraded"), report.get("degraded")))
        check(len(full_ids) == 32 and len(lod_ids) == 13 and not off_ids,
              "фактические уровни узлов: full=%d lod=%d off=%d"
              % (len(full_ids), len(lod_ids), len(off_ids)))
        check(report.get("lights") == 45 and len(nodes) == 45,
              "нарисованы все 45 (LOD — не пропажа): lights=%s узлов=%s"
              % (report.get("lights"), len(nodes)))

        # Кто именно полный: ближайшие к камере (priority по умолчанию mixed,
        # сила у всех одинаковая — порядок задаёт расстояние).
        expected = [n["id"] for n in sorted(
            nodes, key=lambda n: ((n["x"] - 400) ** 2 + (n["y"] - 300) ** 2, n["uid"]))[:32]]
        check(set(full_ids) == set(expected),
              "полные — ровно 32 ближайших к камере (совпало %d из 32)"
              % len(set(full_ids) & set(expected)))

        tri_on = ev(a, "$.debug.stats().triangles", 0)
        ms_on = frame_ms(a)
        number("бюджет ВКЛ: треугольников %s (-%s), кадр %.3f мс (было %.3f)"
               % (tri_on, tri_off - tri_on,
                  ms_on if ms_on is not None else float("nan"),
                  ms_off if ms_off is not None else float("nan")))
        check(tri_on < tri_off,
              "LOD реально урезает геометрию: %s < %s" % (tri_on, tri_off))
        check(ms_on is not None and ms_off is not None and ms_on <= ms_off + 0.10,
              "кадр не медленнее: %.3f <= %.3f + 0.10 мс" % (ms_on, ms_off))
        check(ev(a, "$.gfx.light.qualityReport()").get("warned", {}).get("budget") is True,
              "о переходе в LOD есть одно предупреждение (warned.budget)")

        # --- 3. priority: camera / power / функция ---------------------------
        ev(a, "budgetCustom([{ id: 'p_l', x: 150, y: 300, radius: 100, intensity: 1 },"
              " { id: 'p_c', x: 400, y: 300, radius: 100, intensity: 2 },"
              " { id: 'p_r', x: 650, y: 300, radius: 100, intensity: 1 }])")
        ev(a, "$.gfx.light.budget({ max: 1, priority: 'power', radiusScale: 0.5 })")
        a.step(2)
        lv = levels(a)
        check(lv.get("p_c") == 0 and lv.get("p_l") == 1 and lv.get("p_r") == 1,
              "priority='power': полный — самый сильный: %s" % (lv,))

        ev(a, "$.gfx.light.budget({ max: 1, priority: 'camera' })")
        a.step(2)
        lv = levels(a)
        check(lv.get("p_c") == 0 and lv.get("p_l") == 1 and lv.get("p_r") == 1,
              "priority='camera': полный — ближайший к камере: %s" % (lv,))

        ev(a, "$.gfx.light.budget({ max: 1, priority: (node) => node.x })")
        a.step(2)
        lv = levels(a)
        check(lv.get("p_r") == 0 and lv.get("p_l") == 1 and lv.get("p_c") == 1,
              "priority-функция: полный — самый правый (max x): %s" % (lv,))
        cfg = ev(a, "$.gfx.light.budget()", {})
        check(cfg.get("priority") == "function",
              "геттер сообщает, что приоритет задан функцией: %s" % (cfg.get("priority"),))

        # --- 4. LOD виден в кадре: радиус урезан -----------------------------
        ev(a, "$.gfx.light.budget({ max: 1, priority: 'power', radiusScale: 0.5 })")
        a.step(3)
        path = os.path.join(SHOTS, "light_budget_lod.png")
        a.screenshot(path)
        img = read_png(path)
        sx = img[0] / float(ev(a, "engine.width", 800))
        sy = img[1] / float(ev(a, "engine.height", 600))
        center_edge = luma(img, 480, 300, 8, sx, sy)     # 80 px от полного (r=100)
        left_edge = luma(img, 230, 300, 8, sx, sy)       # 80 px от LOD (r=50)
        bg = luma(img, 700, 60, 8, sx, sy)
        number("LOD в кадре: полный@80px=%.1f, LOD@80px=%.1f, фон=%.1f"
               % (center_edge, left_edge, bg))
        check(center_edge > bg + 4,
              "полный источник достаёт до 80 px: %.1f > фон %.1f" % (center_edge, bg))
        check(left_edge < bg + 2,
              "LOD-источник радиус 50 px не достаёт до 80 px: %.1f ≈ фон %.1f"
              % (left_edge, bg))

        # --- 5. radiusScale: 0 — отключение вклада, а не тишина --------------
        ev(a, "$.gfx.light.budget({ max: 1, priority: 'power', radiusScale: 0 })")
        a.step(3)
        report = ev(a, "$.gfx.light.qualityReport()", {})
        budget = report.get("budget", {})
        lv = levels(a)
        check(budget.get("off") == 2 and budget.get("lod") == 0
              and budget.get("degraded") == 2,
              "radiusScale:0 переводит лишние в off: %s" % (budget,))
        check([lv.get("p_l"), lv.get("p_c"), lv.get("p_r")] == [2, 0, 2],
              "уровни: лишние отключены, полный один: %s" % (lv,))
        path = os.path.join(SHOTS, "light_budget_off.png")
        a.screenshot(path)
        img = read_png(path)
        sx = img[0] / float(ev(a, "engine.width", 800))
        sy = img[1] / float(ev(a, "engine.height", 600))
        off_center = luma(img, 150, 300, 8, sx, sy)
        bg = luma(img, 700, 60, 8, sx, sy)
        check(off_center < bg + 2,
              "отключённый источник не светит (%0.1f ≈ фон %0.1f)" % (off_center, bg))

        # --- 5б. Бюджет действует и на emission-спрайты ----------------------
        ev(a, "budgetEmitters(40, { radius: 64, intensity: 1, segments: 6, rings: 1 })")
        ev(a, "$.gfx.light.budget({ max: 32, priority: 'camera', radiusScale: 0.6 })")
        a.step(3)
        report = ev(a, "$.gfx.light.qualityReport()", {})
        budget = report.get("budget", {})
        recs = ev(a, "$.gfx.light.emitters()", [])
        by_budget = {}
        for rec in recs:
            key = rec.get("budget")
            by_budget[key] = by_budget.get(key, 0) + 1
        check(budget.get("emitters", {}).get("sources") == 40
              and budget.get("emitters", {}).get("full") == 32
              and budget.get("emitters", {}).get("lod") == 8,
              "emission-спрайты идут через тот же бюджет: %s"
              % (budget.get("emitters"),))
        check(by_budget.get("full") == 32 and by_budget.get("lod") == 8,
              "записи эмиттеров помечены бюджетом: %s" % (by_budget,))
        check(all(r.get("gives_light") for r in recs),
              "LOD-эмиттеры светят, а не пропадают: %d из %d"
              % (sum(1 for r in recs if r.get("gives_light")), len(recs)))

        ev(a, "$.gfx.light.budget({ max: 32, radiusScale: 0 })")
        a.step(2)
        report = ev(a, "$.gfx.light.qualityReport()", {})
        budget = report.get("budget", {})
        recs = ev(a, "$.gfx.light.emitters()", [])
        off_recs = [r for r in recs if r.get("budget") == "off"]
        check(budget.get("emitters", {}).get("off") == 8
              and len(off_recs) == 8,
              "radiusScale:0 отключает вклад лишних эмиттеров: %s"
              % (budget.get("emitters"),))
        check(all(not r.get("gives_light") for r in off_recs),
              "отключённые не отдают свет: %d"
              % sum(1 for r in off_recs if not r.get("gives_light")))

        # --- 6. Отказы: неизвестный приоритет — структурная ошибка ----------
        ev(a, "$.debug.clearErrors ? $.debug.clearErrors() : 0")
        before = ev(a, "$.gfx.light.budget().priority", None)
        ev(a, "$.gfx.light.budget({ priority: 'bogus' })")
        cfg = ev(a, "$.gfx.light.budget()", {})
        errors = ev(a, "$.debug.errors()", []) or []
        codes = [e.get("code") for e in errors]
        check(cfg.get("priority") == before,
              "неизвестный приоритет не подменил текущий: %s" % (cfg.get("priority"),))
        check("R2D_LIGHT_BUDGET_PRIORITY" in codes,
              "отказ виден машине кодом R2D_LIGHT_BUDGET_PRIORITY: %s" % (codes,))
        texts = " ".join(str(e.get("message", "")) for e in errors)
        check("bogus" in texts,
              "текст отказа называет виновника: %s" % texts[:120])

        ev(a, "$.gfx.light.budget({ max: 'abc' })")
        errors = ev(a, "$.debug.errors()", []) or []
        codes = [e.get("code") for e in errors]
        cfg = ev(a, "$.gfx.light.budget()", {})
        check("R2D_LIGHT_BUDGET_VALUE" in codes and cfg.get("max") == 0,
              "нечисловой max — отказ R2D_LIGHT_BUDGET_VALUE и бюджет выключен: %s"
              % (codes,))

        # --- 7. Выключение бюджета возвращает прежний путь ------------------
        ev(a, "$.gfx.light.budget({ max: 0 })")
        ev(a, "budgetScene(45, { radius: 80, segments: 8, rings: 3 })")
        a.step(3)
        report = ev(a, "$.gfx.light.qualityReport()", {})
        lv = levels(a)
        check(report.get("budget", {}).get("enabled") is False
              and report.get("degraded") == 0,
              "max:0 выключает бюджет: %s" % (report.get("budget"),))
        check(all(v in (0, -1) for v in lv.values()),
              "узлы не тащат LOD из прошлого кадра: %s" % (sorted(set(lv.values())),))

        check(a.ping().get("pong") is True, "движок жив после проверок бюджета")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
