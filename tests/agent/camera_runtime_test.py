#!/usr/bin/env python3
# ===========================================================================
# §49: регрессии камеры — слежение, сглаживание, мёртвая зона, вынос, границы,
# тряска, зум, потеря и смена цели, смена сцены — и защита от NaN.
#
# Юнит-математика камеры живёт в tests/js/camera_test.mjs; здесь проверяется
# поведение в живом кадре. Отдельная тема §49 — «камера не должна ломаться от
# мусорного ввода»: NaN/Infinity, поданные в at()/zoom()/shake()/limits()/
# follow(), раньше утекали в позицию камеры и в мировые координаты экрана
# (в JSON это видно как null). Теперь у каждого входа есть определённый ответ,
# и он проверяется тут же.
#
# Запуск (после сборки):
#   python3 tests/agent/camera_runtime_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")
GAME_SCENES = os.path.join("tests", "fixtures", "hello")


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


def finite(a, expr):
    """Конечное ли число в движке (NaN/Infinity не доезжают до JSON как числа)."""
    return ev(a, "Number.isFinite(%s)" % expr, False) is True


def cam_finite(a):
    """Позиция, зум и экранная проекция камеры — всё конечное."""
    return (finite(a, "$.camera.x()") and finite(a, "$.camera.y()")
            and finite(a, "$.camera.zoom()")
            and finite(a, "$.camera.worldToScreen({x:400,y:300}).x")
            and finite(a, "$.camera.viewport().w"))


def cam_x(a):
    """x камеры; не-конечное значение (в JSON это null) — NaN для сравнений."""
    v = ev(a, "$.camera.x()", None)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else float("nan")


def target_x(a, sel="#runner"):
    return ev(a, "$('%s').pos().x" % sel, float("nan"))


def build_world(a):
    """Чистый мир фикстуры: две цели, камера в (400, 300)."""
    ev(a, "$('#world').remove(); $('#hud').remove(); $('#go').remove();"
           "$.world.gravity(0, 0).color('#101820').bounds(-100000, 0, 200000, 600);"
           "$('<sprite>', { id: 'runner', w: 16, h: 16 }).at(400, 300).appendTo($.world);"
           "$('<sprite>', { id: 'other', w: 16, h: 16 }).at(900, 300).appendTo($.world);"
           "$.camera.unfollow().limits(null).deadzone(false).lookahead(0)"
           ".at(400, 300).zoom(1); 'ok'")
    a.step(2)


def main():
    with Agent(game=GAME, seed=5) as a:
        a.step(3)
        build_world(a)

        # --- 1. Слежение и сглаживание ---------------------------------------
        check(ev(a, "$.camera.followed()") is None, "без follow() цели нет")
        ev(a, "$.camera.follow('#runner', { smooth: 0 })")
        ev(a, "$('#runner').at(600, 300)")
        a.step(1)
        check(abs(cam_x(a) - 600) < 1e-4, "smooth=0 — мгновенное слежение (%s)" % cam_x(a))

        # smooth в (0,1): камера подходит монотонно и НЕ проскакивает цель.
        ev(a, "$.camera.at(400, 300).follow('#runner', { smooth: 0.12 });"
               "$('#runner').at(700, 300); 'ok'")
        trace = []
        for _ in range(30):
            a.step(1)
            trace.append(cam_x(a))
        over = max(trace) > 700 + 1e-6
        converges = abs(trace[-1] - 700) < 1.0
        monotone = all(trace[i] >= trace[i - 1] - 1e-6 for i in range(1, len(trace)))
        print("  --   smooth 0.12: %s → %.3f" % ([round(v, 1) for v in trace[:4]], trace[-1]))
        check(converges and not over and monotone,
              "smooth 0.12 подходит к цели без проскока (последняя %.3f)" % trace[-1])

        # smooth=1 — «не двигается»; больше 1 и Infinity — тот же предел,
        # а не расходящаяся камера (раньше уезжала в минус на тысячи пикселей).
        for bad in ("1", "2", "Infinity"):
            ev(a, "$.camera.at(400, 300).follow('#runner', { smooth: %s });"
                   "$('#runner').at(700, 300); 'ok'" % bad)
            xs = []
            for _ in range(8):
                a.step(1)
                xs.append(cam_x(a))
            finite_xs = [v for v in xs if v == v]
            drift = max((abs(v - 400) for v in finite_xs), default=float("inf"))
            check(len(finite_xs) == len(xs) and drift < 1e-3,
                  "smooth=%s держит камеру на месте (макс. уход %s)" % (bad, drift))

        # smooth=NaN — определённый ответ (мгновенное слежение), без NaN.
        ev(a, "$.camera.at(400, 300).follow('#runner', { smooth: NaN });"
               "$('#runner').at(700, 300); 'ok'")
        a.step(2)
        s = ev(a, "$.camera._state.smooth", None)
        check(cam_finite(a) and s is not None and 0 <= s <= 1,
              "smooth=NaN приводится к доле в [0,1] (%s)" % s)
        check(abs(cam_x(a) - 700) < 1e-3,
              "smooth=NaN ведёт себя как мгновенное слежение (%s)" % cam_x(a))

        # --- 2. Мёртвая зона вместе со сглаживанием ---------------------------
        ev(a, "$.camera.at(400, 300).follow('#runner', { smooth: 0.2, deadzone: [80, 60] });"
               "$('#runner').at(430, 320); 'ok'")
        a.step(6)
        check(abs(cam_x(a) - 400) < 0.5, "внутри мёртвой зоны камера стоит (%s)" % cam_x(a))
        ev(a, "$('#runner').at(520, 300)")
        a.step(30)
        check(abs(cam_x(a) - 480) < 1.0,
              "за мёртвой зоной камера идёт к краю зоны (%s)" % cam_x(a))

        # --- 3. Потеря цели, смена цели ---------------------------------------
        ev(a, "$.camera.deadzone(false).at(400, 300).follow('#runner', { smooth: 0 });"
               "$('#runner').at(650, 300); 'ok'")
        a.step(2)
        before = cam_x(a)
        ev(a, "$('#runner').remove(); 'ok'")
        a.step(5)
        check(ev(a, "$.camera.followed()") is None, "после удаления цели followed() пуст")
        check(abs(cam_x(a) - before) < 1e-3 and cam_finite(a),
              "без цели камера стоит на месте (%s → %s)" % (before, cam_x(a)))

        # Цель вернулась: камера снова следит и не «прыгает» из прошлой позиции.
        ev(a, "$('<sprite>', { id: 'runner', w: 16, h: 16 }).at(500, 300).appendTo($.world); 'ok'")
        a.step(2)
        back = cam_x(a)
        check(abs(back - 500) < 1e-3 and cam_finite(a),
              "вернувшаяся цель подхватывается без телепорта (%s)" % back)

        # Смена цели: следим за новой, вынос от прошлой цели не тянется.
        ev(a, "$.camera.deadzone(false).lookahead(64).follow('#runner', { smooth: 0 })")
        ev(a, "$.camera.follow('#other', { smooth: 0 })")
        a.step(2)
        check(ev(a, "$.camera.followed()") is not None, "смена цели: followed() не пуст")
        check(abs(cam_x(a) - target_x(a, "#other")) < 1e-3,
              "камера перешла на новую цель (%s)" % cam_x(a))
        check(abs(ev(a, "$.camera._state.lead_x", 99)) < 1e-9,
              "вынос сброшен при смене цели")

        # --- 4. Границы (limits) ----------------------------------------------
        ev(a, "$.camera.unfollow().limits(0, 0, 1000, 600).zoom(1).at(-500, -500)")
        a.step(2)
        check(abs(cam_x(a) - 400) < 1e-3,
              "камера зажата в границах: половина кадра 800/2 (%s)" % cam_x(a))
        ev(a, "$.camera.zoom(4).at(-500, -500)")
        a.step(2)
        check(abs(cam_x(a) - 100) < 1e-3,
              "зум 4 расширяет запас границ: половина кадра 800/(2·4) (%s)" % cam_x(a))
        ev(a, "$.camera.zoom(1).limits(null).at(0, 0)")
        a.step(2)
        check(abs(cam_x(a)) < 1e-3, "limits(null) снимает границы (%s)" % cam_x(a))

        # --- 5. Тряска ---------------------------------------------------------
        ev(a, "$.camera.at(400, 300)")
        a.step(2)
        pos_before = ev(a, "JSON.stringify($.camera.pos())")
        ev(a, "$.camera.shake(8, 300)")
        amps = []
        for _ in range(18):
            a.step(1)
            amps.append(ev(a, "$.camera._state.shake_x", float("nan")))
        a.step(4)
        check(any(v != 0 for v in amps), "тряска даёт ненулевой сдвиг кадра")
        check(max(abs(v) for v in amps) <= 8.0 + 1e-6,
              "сдвиг тряски не превышает амплитуду (%.3f)" % max(abs(v) for v in amps))
        check(ev(a, "$.camera._state.shake_x") == 0 and ev(a, "$.camera._state.shake_y") == 0,
              "тряска кончается ровно нулём")
        check(ev(a, "JSON.stringify($.camera.pos())") == pos_before,
              "тряска не двигает позицию камеры")

        ev(a, "$.camera.shake(8, 300)")
        a.step(2)
        ev(a, "$.camera.shake(0, 0)")
        a.step(1)
        check(ev(a, "$.camera._state.shake_x") == 0 and ev(a, "$.camera._state.shake_amp") == 0,
              "shake(0, 0) немедленно гасит тряску")

        # Мусорная амплитуда: NaN и отрицательная — это «стоп», а не NaN в кадре.
        ev(a, "$.camera.shake(NaN, 200)")
        a.step(3)
        check(ev(a, "$.camera._state.shake_x") == 0 and cam_finite(a),
              "shake(NaN) не даёт NaN: сдвиг %s" % ev(a, "$.camera._state.shake_x"))
        ev(a, "$.camera.shake(-5, 200)")
        a.step(3)
        check(ev(a, "$.camera._state.shake_x") == 0 and cam_finite(a),
              "отрицательная амплитуда не трясёт")

        # --- 6. Зум: мусор не ломает проекцию ---------------------------------
        ev(a, "$.camera.zoom(0)")
        check(abs(ev(a, "$.camera.zoom()", 0) - 0.01) < 1e-9, "zoom(0) зажимается в 0.01")
        ev(a, "$.camera.zoom(-5)")
        check(abs(ev(a, "$.camera.zoom()", 0) - 0.01) < 1e-9, "zoom(-5) зажимается в 0.01")
        for bad in ("NaN", "'abc'", "Infinity"):
            ev(a, "$.camera.zoom(1).zoom(%s)" % bad)
            a.step(1)
            z = ev(a, "$.camera.zoom()", None)
            check(finite(a, "$.camera.zoom()") and z is not None and z >= 0.01 and cam_finite(a),
                  "zoom(%s) не ломает камеру (зум %s)" % (bad, z))
        ev(a, "$.camera.zoom(1)")

        # --- 7. Мусорные координаты и параметры -------------------------------
        ev(a, "$.camera.at(400, 300)")
        ev(a, "$.camera.at(NaN, NaN)")
        a.step(1)
        check(finite(a, "$.camera.x()") and finite(a, "$.camera.y()"),
              "at(NaN, NaN) не уносит камеру в NaN (%s, %s)"
              % (ev(a, "$.camera.x()"), ev(a, "$.camera.y()")))
        ev(a, "$.camera.at(400, 300)")
        ev(a, "$.camera.limits(NaN, 0, NaN, 600)")
        a.step(1)
        check(finite(a, "$.camera.x()") and finite(a, "$.camera.y()"),
              "limits с NaN не уносит камеру в NaN (%s)" % ev(a, "$.camera.x()"))
        ev(a, "$.camera.limits(null).at(400, 300)")
        ev(a, "$.camera.panTo(NaN, NaN, 0)")
        a.step(1)
        check(finite(a, "$.camera.x()") and finite(a, "$.camera.y()"),
              "panTo(NaN, NaN) не уносит камеру в NaN (%s)" % ev(a, "$.camera.x()"))
        ev(a, "$.camera.at(400, 300).follow('#runner', { smooth: 0, offset: [NaN, NaN] }); 'ok'")
        a.step(2)
        check(finite(a, "$.camera.x()") and finite(a, "$.camera.y()"),
              "offset с NaN не уносит камеру в NaN (%s)" % ev(a, "$.camera.x()"))
        ev(a, "$.camera.unfollow().at(400, 300).zoom(1).limits(null).lookahead(0)")
        a.step(1)
        check(cam_finite(a), "после мусорных вводов камера считается: %s"
              % ev(a, "JSON.stringify($.camera.pos())"))

        # --- 8. Экран ↔ мир: согласованность с зумом и поворотом --------------
        ev(a, "$.camera.at(400, 300).zoom(1.5).rotation(0.4)")
        a.step(2)
        p = ev(a, "$.camera.worldToScreen({ x: 550, y: 260 })")
        back = ev(a, "$.camera.screenToWorld({ x: %s, y: %s })" % (p["x"], p["y"])) if p else None
        check(bool(back) and abs(back["x"] - 550) < 0.01 and abs(back["y"] - 260) < 0.01,
              "worldToScreen/screenToWorld — обратные друг другу (%s)" % (back,))
        # Ожидание считаем по формуле самой камеры (та же математика, но
        # здесь, в тесте): сдвиг × зум, поворот на 0.4 рад, центр кадра.
        import math
        c, s = math.cos(0.4), math.sin(0.4)
        dx, dy = (550 - 400) * 1.5, (260 - 300) * 1.5
        want_x = dx * c - dy * s + ev(a, "engine.width") / 2
        want_y = dx * s + dy * c + ev(a, "engine.height") / 2
        check(p is not None and abs(p["x"] - want_x) < 1.0 and abs(p["y"] - want_y) < 1.0,
              "проекция учитывает зум и поворот: (%.2f, %.2f) ≈ (%.2f, %.2f)"
              % (p["x"] if p else -1, p["y"] if p else -1, want_x, want_y))
        ev(a, "$.camera.rotation(0).zoom(1)")

        # --- 9. Мультикамерность: регион по умолчанию и мусор в регионе -------
        # `$.camera.add('p2')` без региона обязан занимать весь кадр: раньше
        # regionCamera читала r.w у null и роняла каждый кадр отрисовки.
        check(ev(a, "$.camera.add('p2')") == "p2", "вторичная камера добавляется без региона")
        a.step(2)
        view = ev(a, "$.camera.views()", [])
        second = [v for v in (view or []) if v.get("name") == "p2"]
        check(len(second) == 1 and cam_finite(a),
              "views() описывает камеру без региона (%s)" % (second[:1],))
        check(bool(second) and second[0]["rect"] and second[0]["rect"]["w"] > 0
              and abs(second[0]["zoom"] - 1) < 1e-9,
              "регион по умолчанию — весь кадр, зум 1 (%s)" % (second[0] if second else None,))
        check(a.ping().get("pong") is True, "кадр со вторичной камерой не падает")

        ev(a, "$.camera.region('p2', { x: 0, y: 0, w: 400, h: 300 })")
        a.step(2)
        view = [v for v in (ev(a, "$.camera.views()", []) or []) if v.get("name") == "p2"]
        check(bool(view) and abs(view[0]["zoom"] - 2) < 1e-9,
              "регион половины окна даёт зум 2 (%s)" % (view[0]["zoom"] if view else None))
        ev(a, "$.camera.region('p2', { x: NaN, y: 0, w: NaN, h: 300 })")
        a.step(2)
        check(cam_finite(a), "NaN в регионе не уносит камеру в NaN")
        check(ev(a, "$.camera.remove('p2')") is True, "вторичная камера снимается")
        a.step(2)
        check(ev(a, "$.camera.camCount()") == 1 and cam_finite(a), "осталась главная камера")

    # --- 10. Смена сцены: цель исчезает и появляется снова --------------------
    with Agent(game=GAME_SCENES, seed=7) as a:
        a.step(3)
        ev(a, "$.camera.follow('#hero', { smooth: 0 })")
        a.step(2)
        check(ev(a, "$.camera.followed()") is not None, "в первой сцене цель найдена")
        hero_x = ev(a, "$('#hero').pos().x", float("nan"))
        check(abs(cam_x(a) - hero_x) < 1.0, "камера на герое (%s ≈ %s)" % (cam_x(a), hero_x))

        ev(a, "$.scene.load('second', { transition: 'none' })")
        a.step(3)
        after = cam_x(a)
        check(ev(a, "$('#hero').length") == 0, "в новой сцене героя нет")
        check(ev(a, "$.camera.followed()") is None, "после смены сцены followed() пуст")
        check(finite(a, "$.camera.x()") and abs(after - hero_x) < 40,
              "камера осталась на месте, а не улетела (%s)" % after)

        ev(a, "$('<player>', { id: 'hero' }).at(1000, 200).appendTo($.world); 'ok'")
        a.step(3)
        check(abs(cam_x(a) - 1000) < 5 and cam_finite(a),
              "герой новой сцены подхвачен тем же селектором (%s)" % cam_x(a))

        # --- 10. Живость ----------------------------------------------------
        check(a.ping().get("pong") is True, "движок отвечает после регрессий камеры")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
