#!/usr/bin/env python3
# ===========================================================================
# §6.3. Стоящий на склоне актёр не сползает — и управление от этого не страдает.
#
# Замер ДО правки (applyControls переписывал горизонтальную скорость нулём):
#   * трение по умолчанию (0.2 < tan 30° = 0.577): 10.998 px за каждые 120
#     кадров, одинаково в каждом следующем окне — 54.99 px за 600 кадров;
#   * трение 1.0: 1.014 px за 120 кадров.
# Сползание ограничено сверху g·dt: шаг физики идёт ДО апдейта скрипта, и
# гравитация за шаг успевает разогнать тело вдоль склона; тело из-за
# постоянного «обнуления» не засыпает, и трение его не держит.
#
# Здесь проверяется:
#   * сползание стоящего актёра на склоне 30° — не больше 1 px за 120 кадров
#     (после правки измерено 0.000 px) и не больше 2 px за 600 кадров — то есть
#     «не сползает бесконечно»;
#   * то же для трения 1.0 и для тела на кромке склона;
#   * опора не теряется ни на кадре;
#   * удержание не запирает управление: после стоянки актёр идёт вверх и вниз
#     по склону;
#   * ЧИСЛА управления до/после: разгон, торможение, воздушный контроль,
#     высота прыжка и jump-cut, перенос движущейся платформой, coyote-фора,
#     спрыгивание с односторонней платформы.
#
# Запуск (после сборки):
#   python3 tests/agent/slope_hold_test.py
# ===========================================================================

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
SLOPES = os.path.join("tests", "fixtures", "physics_slopes")
CONTROLS = os.path.join("tests", "fixtures", "controls_plat")

HALF_W, HALF_H = 13.0, 15.0

#: Порог сползания за окно 120 кадров. После правки измерено 0.000 px; порог
#: 1 px — запас на шум машины, а не «сколько получилось».
DRIFT_MAX = 1.0
#: Порог за длинное окно 600 кадров: сползание не должно накапливаться.
DRIFT_TOTAL_MAX = 2.0


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:140])
        return default


def xy(a, sel):
    p = ev(a, "$('#%s').pos()" % sel, None)
    return (p["x"], p["y"]) if p else (float("nan"), float("nan"))


def place_on_slope(a, sel, x, lift=22.0):
    """Поставить узел на склон лучом сверху (геометрия — у самой фикстуры)."""
    return ev(a, """(() => {
        const hit = $.world.raycast({ x: %f, y: -400 }, { x: %f, y: 1200 }, { ignore: ['#%s'] });
        if (!hit) return null;
        const n = hit.normal;
        $('#%s').at(hit.point.x + n.x * %f, hit.point.y + n.y * %f).velocity(0, 0);
        return { x: hit.point.x, y: hit.point.y };
    })()""" % (x, x, sel, sel, lift, lift))


def slope_windows(a, sel, windows=5, frames=120):
    """Сдвиг тела по окнам кадров: список |Δ| за каждое окно."""
    out = []
    x0, y0 = xy(a, sel)
    for _ in range(windows):
        a.step(frames)
        x1, y1 = xy(a, sel)
        out.append(math.hypot(x1 - x0, y1 - y0))
        x0, y0 = x1, y1
    return out


def main():
    # =====================================================================
    # 1. Сползание на склоне 30° — главный замер §6.3.
    # =====================================================================
    with Agent(game=SLOPES, seed=11) as a:
        a.step(5)
        geom = ev(a, "$.store.get('slopeGeom')", None)
        check(isinstance(geom, dict), "фикстура отдала геометрию склонов")

        # Три тела на склоне B: трение по умолчанию, трение 1.0 и кромка.
        x_mid = geom["b"]["topStartX"] + 170
        place_on_slope(a, "parker-default", x_mid)
        place_on_slope(a, "parker", geom["b"]["topStartX"] + 60)
        place_on_slope(a, "corner", geom["b"]["topStartX"] + 5)
        a.step(180)   # посадка на склон

        for sel, note in (("parker-default", "трение по умолчанию"),
                          ("parker", "трение 1.0"),
                          ("corner", "на кромке склона")):
            held = ev(a, "$('#%s').onFloor()" % sel)
            # Опора каждый кадр: замер идёт покадрово вместе со сдвигом.
            x0, y0 = xy(a, sel)
            wins, supported = [], True
            for _ in range(5):
                for _ in range(120):
                    a.step(1)
                    if ev(a, "$('#%s').onFloor()" % sel) is not True:
                        supported = False
                x1, y1 = xy(a, sel)
                wins.append(math.hypot(x1 - x0, y1 - y0))
                x0, y0 = x1, y1
            total = sum(wins)
            print("  --   %-16s (%s): окна %s, за 600 кадров %.4f px"
                  % (sel, note, ["%.4f" % v for v in wins], total))
            check(supported, "%s: опора не теряется ни на кадре (%s)" % (sel, note))
            check(max(wins) <= DRIFT_MAX,
                  "%s: сползание за 120 кадров не больше %.1f px (макс. %.4f)"
                  % (sel, DRIFT_MAX, max(wins)))
            check(total <= DRIFT_TOTAL_MAX,
                  "%s: за 600 кадров не больше %.1f px — не «ползёт вечно» (%.4f)"
                  % (sel, DRIFT_TOTAL_MAX, total))
            check(held is True, "%s: тело действительно стояло на склоне" % sel)

        # Удержание не запирает управление: со стоянки актёр идёт вверх и вниз.
        x_rest = xy(a, "parker-default")[0]
        a.keys(["left"])
        a.step(30)
        a.keys([])
        up = xy(a, "parker-default")[0] - x_rest
        a.step(30)
        x_top = xy(a, "parker-default")[0]
        a.keys(["right"])
        a.step(30)
        a.keys([])
        down = xy(a, "parker-default")[0] - x_top
        print("  --   управление со стоянки: за 30 кадров «left» %+.2f px, «right» %+.2f px"
              % (up, down))
        check(up < -20.0, "со стоянки актёр идёт вверх по склону (%+.2f px)" % up)
        check(down > 20.0, "и вниз по склону (%+.2f px)" % down)
        check(a.ping().get("pong") is True, "движок отвечает после замеров склона")

    # =====================================================================
    # 2. Числа управления: то же, что ломало бы «обнуление на склоне».
    # =====================================================================
    with Agent(game=CONTROLS, seed=5) as a:
        a.step(5)

        # --- Разгон и торможение на ровном полу ---------------------------
        ev(a, "$('<player>', { id: 'acc_probe' }).at(6330, 546).size(26, 30)"
               ".health(100).controls({ axis: 'both', accel: 1500, decel: 2000 })"
               ".collision(26, 30).appendTo($.world); 'ok'")
        a.step(40)
        v0 = ev(a, "$('#acc_probe').velocity().x", 0.0)
        x0 = xy(a, "acc_probe")[0]
        a.keys(["d"])
        frames_to_max = -1
        for i in range(60):
            a.step(1)
            if abs(ev(a, "$('#acc_probe').velocity().x", 0.0) - 250) < 1:
                frames_to_max = i + 1
                break
        x1 = xy(a, "acc_probe")[0]
        v_max = ev(a, "$('#acc_probe').velocity().x", 0.0)
        a.keys([])
        x_rel = xy(a, "acc_probe")[0]
        for i in range(60):
            a.step(1)
            if abs(ev(a, "$('#acc_probe').velocity().x", 0.0)) < 1:
                break
        x_stop = xy(a, "acc_probe")[0]
        print("  --   разгон: v0=%.2f → %.2f px/с за %d кадров, путь %.2f px; "
              "торможение %.2f px" % (v0, v_max, frames_to_max, x1 - x0, x_stop - x_rel))
        check(abs(v_max - 250) < 5, "разгон выходит на скорость 250 (%s)" % v_max)
        check(frames_to_max > 0, "разгон занимает измеримое время (%d кадров)" % frames_to_max)
        # Теория: v²/(2·accel) = 250²/3000 ≈ 20.8 px; дискретный шаг даёт меньше.
        check(x1 - x0 > 15, "за разгон тело прошло больше 15 px (%.2f, теория 20.8)"
              % (x1 - x0))
        # Путь торможения с decel=2000: v²/(2a) = 250²/4000 = 15.6 px.
        check(10 < (x_stop - x_rel) < 25,
              "торможение с decel=2000 укладывается в 10..25 px (%.2f, теория 15.6)"
              % (x_stop - x_rel))

        # --- Воздушный контроль -------------------------------------------
        ev(a, "$('#acc_probe').at(6330, 546).velocity(0, 0); 'ok'")
        a.step(20)
        a.keys(["d"])
        a.step(20)                      # разгон на полу
        a.key("Space", "tap")           # прыжок
        air_x0 = None
        air_x1 = None
        for _ in range(60):
            a.step(1)
            on_floor = ev(a, "$('#acc_probe').onFloor()")
            if on_floor is False:
                if air_x0 is None:
                    air_x0 = xy(a, "acc_probe")[0]
                air_x1 = xy(a, "acc_probe")[0]
        a.keys([])
        a.step(20)
        air_move = (air_x1 - air_x0) if (air_x0 is not None and air_x1 is not None) else -1.0
        print("  --   воздушный контроль: в полёте пройдено %+.2f px" % air_move)
        check(air_move > 20, "в воздухе с зажатым «d» тело движется вперёд (%+.2f px)" % air_move)

        # --- Прыжок: полная высота и jump-cut -----------------------------
        ev(a, "$('#tall').at(2300, 700).velocity(0, 0); "
               "$('#cut').at(2700, 700).velocity(0, 0); 'ok'")
        a.step(60)
        base_tall = xy(a, "tall")[1]
        base_cut = xy(a, "cut")[1]
        a.key("Space", "down")
        a.step(4)
        a.key("Space", "up")            # обеим схемам: 'cut' режет, 'tall' держит
        peak_tall = xy(a, "tall")[1]
        peak_cut = xy(a, "cut")[1]
        for _ in range(60):
            a.step(1)
            peak_tall = min(peak_tall, xy(a, "tall")[1])
            peak_cut = min(peak_cut, xy(a, "cut")[1])
        print("  --   прыжок: обычный %.2f px, с jumpCut %.2f px (от земли)"
              % (base_tall - peak_tall, base_cut - peak_cut))
        check(base_tall - peak_tall > 60, "обычный прыжок поднимает выше 60 px (%.2f)"
              % (base_tall - peak_tall))
        check(base_cut - peak_cut < base_tall - peak_tall,
              "jump-cut режет высоту (%.2f < %.2f)"
              % (base_cut - peak_cut, base_tall - peak_tall))

        # --- Перенос движущейся платформой --------------------------------
        # Наездника возвращаем на платформу: общие клавиши предыдущих проверок
        # ('d' входит и в его схему) успевают свести его с неё.
        a.release_all()
        ev(a, "$('#rider').at($('#lift').pos().x, $('#lift').pos().y - 40).velocity(0, 0); 'ok'")
        a.step(30)
        check(ev(a, "$('#rider').onFloor()") is True, "наездник снова стоит на платформе")
        rider0 = xy(a, "rider")
        lift0 = xy(a, "lift")
        a.step(40)
        rider1 = xy(a, "rider")
        lift1 = xy(a, "lift")
        carried = abs(rider1[0] - rider0[0])
        lift_move = abs(lift1[0] - lift0[0])
        print("  --   платформа: %.2f px, наездник %.2f px (разница %.2f)"
              % (lift_move, carried, abs(carried - lift_move)))
        check(lift_move > 40, "платформа действительно ехала (%.2f px)" % lift_move)
        check(abs(carried - lift_move) < 6,
              "платформа переносит наездника (расхождение %.2f px)"
              % abs(carried - lift_move))

        # --- Coyote-фора: прыжок уже после схода с полки -------------------
        # Игрок сбегает с узкой полки вправо; прыжок жмём в воздухе, но в
        # пределах 200 мс форы — он обязан сработать. Игрока возвращаем на
        # полку: предыдущие проверки двигали его теми же клавишами.
        a.release_all()
        ev(a, "$('#coyote').at(330, 440).velocity(0, 0); 'ok'")
        a.step(40)
        check(ev(a, "$('#coyote').onFloor()") is True, "coyote снова на полке")
        # Кадры идём по одному: фора 200 мс (12 кадров) начинается ровно в
        # момент схода с полки, и нажатие должно попасть в неё, а не после.
        a.keys(["d"])
        left_ledge = -1
        for i in range(60):
            a.step(1)
            if ev(a, "$('#coyote').onFloor()") is False:
                left_ledge = i
                break
        y_before = xy(a, "coyote")[1]
        a.key("Space", "tap")
        a.step(1)
        vy_after = ev(a, "$('#coyote').velocity().y", 0.0)
        y_peak = xy(a, "coyote")[1]
        for _ in range(6):
            a.step(1)
            y_peak = min(y_peak, xy(a, "coyote")[1])
        print("  --   coyote: сход с полки на кадре %d, нажатие сразу после; "
              "vy=%+.1f, подъём %+.2f px" % (left_ledge, vy_after, y_before - y_peak))
        check(left_ledge >= 0, "игрок действительно сошёл с полки (кадр %d)" % left_ledge)
        check(vy_after < -50, "прыжок в фору сработал (vy=%+.1f)" % vy_after)
        a.step(60)

        # --- Спрыгивание с односторонней платформы ------------------------
        # Спрыгивающего тоже возвращаем на его платформу: общий Space успел
        # столкнуть его вниз в предыдущих проверках.
        a.release_all()
        ev(a, "$('#dropper').at(3600, 440).velocity(0, 0); 'ok'")
        a.step(40)
        check(ev(a, "$('#dropper').onFloor()") is True, "dropper снова на платформе")
        y_before = xy(a, "dropper")[1]
        a.keys(["S"])
        a.key("Space", "tap")
        a.step(1)
        dropped_flag = ev(a, "engine.oneWayIgnore($('#dropper').get(0).body)")
        a.step(29)
        a.keys([])
        y_after = xy(a, "dropper")[1]
        under = ev(a, "$('#floor-under-drop').pos().y", 0.0)
        print("  --   one-way: y %.1f → %.1f (пол под платформой на %.1f)"
              % (y_before, y_after, under))
        check(dropped_flag is True, "S+Space поднял флаг «игнорировать one-way»")
        check(y_after > y_before + 40, "спрыгивание уводит тело под платформу (%+.1f px)"
              % (y_after - y_before))
        check(y_after < under, "и тело остаётся над полом (%.1f < %.1f)" % (y_after, under))

        check(a.ping().get("pong") is True, "движок отвечает после проверок управления")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
