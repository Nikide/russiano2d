#!/usr/bin/env python3
# ===========================================================================
# §6.3. Склоны: спуск, переход slope→flat, парковка на краю склона и нормаль
# опоры.
#
# Фикстура: tests/fixtures/physics_slopes/main.js — два одинаковых склона 30°,
# каждый без ступеньки продолжается ровной плитой (верх плиты — продолжение
# верхней грани склона).
#
# Проверяется:
#   * спуск: тело не отрывается от поверхности и не проваливается сквозь неё;
#   * переход slope→flat: опора не теряется ни на одном кадре;
#   * парковка: игрок на склоне и на самой его кромке не сползает безгранично
#     и не проваливается; ящик без управления тоже стоит;
#   * нормаль опоры: ground() отдаёт угол и вектор нормали склона.
#
# Углы/скорость: 30° — предел, на котором Box2D уверенно держит тело; при
# 45°+ начинается проскальзывание по кромке, и это уже не про контракт опоры.
#
# Запуск:
#   python3 tests/agent/highlevel_physics_slopes_test.py
# ===========================================================================

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "physics_slopes")

#: Полуразмеры игрока фикстуры (26x30) — по ним считается нижний левый угол.
PLAYER_HALF_W, PLAYER_HALF_H = 13.0, 15.0


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def surface_y(geom, x):
    """Аналитическая верхняя грань склона: прямая от topStart с углом deg."""
    return geom["topStartY"] + (x - geom["topStartX"]) * math.tan(math.radians(geom["deg"]))


def residual(geom, x, y, half_w=PLAYER_HALF_W, half_h=PLAYER_HALF_H):
    """Насколько нижний левый угол тела выше плоскости склона (0 — лежит).

    Тело не поворачивается (fixedRotation), поэтому на наклонной опоре оно
    касается её именно нижним левым углом, а не всей нижней гранью.
    """
    return (y + half_h) - surface_y(geom, x - half_w)


def place_on_slope(a, sel, x, lift=22.0):
    """Поставить узел на склон лучом сверху (как highlevel_controls_test.py).

    Узел ставится вдоль нормали поверхности: тест не подбирает координаты
    «на глаз», а берёт их у самого склона.
    """
    return a.eval("""(() => {
        const hit = $.world.raycast({ x: %f, y: -400 }, { x: %f, y: 1200 },
                                    { ignore: ['#%s'] });
        if (!hit) return null;
        const n = hit.normal;
        $('#%s').at(hit.point.x + n.x * %f, hit.point.y + n.y * %f).velocity(0, 0);
        return { x: hit.point.x, y: hit.point.y, nx: n.x, ny: n.y };
    })()""" % (x, x, sel, sel, lift, lift))


def frame(a, sel):
    """Кадр по узлу: позиция, опора, угол поверхности и её узел."""
    return a.eval("""(() => {
        const n = $('#%s'), g = n.ground();
        return {
            x: n.pos().x, y: n.pos().y,
            floor: n.onFloor() === true,
            attr: n.get(0).attrs.on_ground === true,
            slope: g ? g.slopeDegrees : null,
            support: g && g.node ? g.node.get(0).id : null,
        };
    })()""" % sel)


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(5)
        geom = a.eval("$.store.get('slopeGeom')")
        check(isinstance(geom, dict) and abs(geom["a"]["deg"] - 30) < 0.001,
              f"фикстура сообщает угол склона ({geom['a']['deg']}°)")

        # =====================================================================
        # 1. Спуск 30° и переход slope→flat.
        # =====================================================================
        spot = place_on_slope(a, "walker", geom["a"]["topStartX"] + 70)
        check(spot is not None and abs(spot["ny"] + math.cos(math.radians(30))) < 0.01,
              f"луч нашёл верхнюю грань склона (нормаль {spot['nx']:.2f}/{spot['ny']:.2f})")
        a.step(90)   # приземление и успокоение
        start = frame(a, "walker")
        check(start["floor"] is True and start["support"] == "slope-a",
              f"игрок стоит на склоне (опора {start['support']})")

        a.keys(["D"])
        rows = []
        for _ in range(200):
            a.step(1)
            rows.append(frame(a, "walker"))
            # Хватит, когда тело уже 20 кадров идёт по ровной плите.
            if len(rows) >= 20 and all(r["slope"] == 0 and r["floor"] for r in rows[-20:]):
                break
        a.keys([])

        off_ground = [i for i, r in enumerate(rows) if not r["floor"] or not r["attr"]]
        check(not off_ground,
              f"спуск и переход slope→flat без отрыва от земли "
              f"(кадров без опоры: {len(off_ground)})")

        descent = [r for r in rows if r["slope"] and r["slope"] > 5]
        check(len(descent) > 30,
              f"тело действительно ехало по склону ({len(descent)} кадров, "
              f"угол {descent[0]['slope']:.1f}°, если ехало)")
        check(rows[-1]["y"] > rows[0]["y"] + 100,
              f"спуск идёт вниз (y {rows[0]['y']:.0f} → {rows[-1]['y']:.0f})")
        # Первые ~10 кадров разгона мягкие контакты Box2D «просаживают» нижний
        # угол тела в поверхность на ~5 px (коррекция до 0.2 м за шаг) — меряем
        # установившийся спуск, а сам провал ловим по низу тела ниже.
        steady = descent[12:]
        worst = max(abs(residual(geom["a"], r["x"], r["y"])) for r in steady)
        check(worst < 2.0,
              f"на установившемся спуске тело лежит на поверхности "
              f"(макс. отклонение {worst:.2f} px за {len(steady)} кадров)")
        sunk = max((r["y"] + PLAYER_HALF_H) - surface_y(geom["a"], r["x"]) for r in rows)
        check(sunk < -2.0,
              f"низ тела не уходит под плоскость склона ни на кадре "
              f"(ближайшее сближение {-sunk:.1f} px над плоскостью)")

        flat = rows[-20:]
        check(all(r["slope"] == 0 for r in flat) and flat[-1]["support"] == "flat-a",
              f"переход slope→flat закончился ровной опорой ({flat[-1]['support']})")
        rest_err = abs(flat[-1]["y"] - (geom["a"]["flatTopY"] - PLAYER_HALF_H))
        check(rest_err < 2.0,
              f"на плите центр тела на её верхней грани "
              f"(y={flat[-1]['y']:.2f}, ждём {geom['a']['flatTopY'] - PLAYER_HALF_H:.1f} ± 2)")

        # =====================================================================
        # 2. Нормаль опоры склона.
        # =====================================================================
        place_on_slope(a, "parker", geom["b"]["topStartX"] + 170)
        a.step(60)
        g = a.eval("""(() => {
            const n = $('#parker'), g = n.ground();
            return g ? { on: g.on, slope: g.slopeDegrees, nx: g.nx, ny: g.ny,
                         support: g.node ? g.node.get(0).id : null } : null;
        })()""")
        rad = math.radians(30)
        check(isinstance(g, dict) and 25 < g["slope"] < 35,
              f"ground() видит угол склона ({(g or {}).get('slope', -1):.1f}°)")
        check(isinstance(g, dict) and abs(g["nx"] - math.sin(rad)) < 0.02
              and abs(g["ny"] + math.cos(rad)) < 0.02,
              f"нормаль опоры — нормаль склона ({(g or {}).get('nx', 9):.3f}/"
              f"{(g or {}).get('ny', 9):.3f}, ждём {math.sin(rad):.3f}/{-math.cos(rad):.3f})")
        on_slope_attr = a.eval("$('#parker').get(0).attrs.on_slope")
        check(isinstance(on_slope_attr, float) and 25 < on_slope_attr * 180 / math.pi < 35,
              f"атрибут on_slope тоже в градусах склона ({on_slope_attr * 180 / math.pi:.1f}°)")
        check(a.eval("$('#parker').onFloor()") is True,
              "склон 30° без лимита maxSlope считается землёй")

        # =====================================================================
        # 3. Парковка на склоне: безграничного сползания нет.
        # =====================================================================
        # Игрок с трением 1.0 и без ввода обязан стоять. Замер — после
        # успокоения, по 120 кадрам: провала вниз и дрейфа вдоль склона быть
        # не должно (остаточное «ползание» решателя — доли пикселя).
        a.step(60)
        p0 = frame(a, "parker")
        rows_p = []
        for _ in range(120):
            a.step(1)
            rows_p.append(frame(a, "parker"))
        p1 = rows_p[-1]
        drift = math.hypot(p1["x"] - p0["x"], p1["y"] - p0["y"])
        check(all(r["floor"] and r["support"] == "slope-b" for r in rows_p),
              "на склоне опора есть каждый кадр (и это именно склон)")
        check(drift < 4.0,
              f"стоянка на склоне не сползает безгранично "
              f"(сдвиг {drift:.2f} px за 120 кадров, вниз {p1['y'] - p0['y']:+.2f} px)")
        worst_p = max(abs(residual(geom["b"], r["x"], r["y"])) for r in rows_p)
        check(worst_p < 4.0,
              f"стоянка не проваливается сквозь склон (макс. отклонение {worst_p:.2f} px)")

        # =====================================================================
        # 4. Кромка склона: тело свисает с верхнего края, но не падает.
        # =====================================================================
        # Центр на 5 px ниже верхнего угла склона: левые ~8 px тела висят в
        # воздухе (как в §6.2, только опора наклонная).
        corner_x = geom["b"]["topStartX"] + 5
        c_spot = place_on_slope(a, "corner", corner_x)
        check(c_spot is not None, "луч нашёл кромку склона для второго тела")
        a.step(60)
        c0 = frame(a, "corner")
        rows_c = []
        for _ in range(120):
            a.step(1)
            rows_c.append(frame(a, "corner"))
        c1 = rows_c[-1]
        c_drift = math.hypot(c1["x"] - c0["x"], c1["y"] - c0["y"])
        check(all(r["floor"] for r in rows_c),
              "на кромке склона опора не теряется ни на кадре")
        check(c_drift < 4.0,
              f"тело на кромке склона не съезжает вниз "
              f"(сдвиг {c_drift:.2f} px за 120 кадров)")
        c_res = [residual(geom["b"], r["x"], r["y"]) for r in rows_c]
        check(min(c_res) > -4.0,
              f"на кромке тело не проваливается под поверхность "
              f"(мин. отклонение {min(c_res):.2f} px)")

        # =====================================================================
        # 5. Ящик без управления: Box2D усыпляет тело, а не сползает вечно.
        # =====================================================================
        place_on_slope(a, "crate", geom["b"]["topEndX"] - 60)
        a.step(240)
        k0 = frame(a, "crate")
        rows_k = []
        for _ in range(120):
            a.step(1)
            rows_k.append(frame(a, "crate"))
        k1 = rows_k[-1]
        k_drift = math.hypot(k1["x"] - k0["x"], k1["y"] - k0["y"])
        check(all(r["floor"] for r in rows_k),
              "ящик на склоне не теряет опору")
        check(k_drift < 2.0,
              f"ящик с трением 1.0 на склоне стоит, а не сползает "
              f"(сдвиг {k_drift:.3f} px за 120 кадров)")
        k_res = min((r["y"] + 12) - surface_y(geom["b"], r["x"] - 12) for r in rows_k)
        check(k_res > -4.0,
              f"ящик не проваливается сквозь склон (мин. зазор {k_res:.2f} px)")

        if FAILURES:
            print(a.stderr_tail(15))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
