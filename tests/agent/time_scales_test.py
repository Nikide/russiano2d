#!/usr/bin/env python3
# ===========================================================================
# §50: три шкалы времени и семь значений масштаба.
#
# Контракт (docs/highlevel/time.md §1.1, src/highlevel/time.js):
#
#   * simulation   — фиксированный шаг игры: tick(), simTime(), simDt().
#                    Масштабируется timeScale, стоит на паузе и в hit-stop.
#   * presentation — реальное время кадра: presentationDelta()/rawDelta(),
#                    presentationTime(). НЕ масштабируется и продолжает идти
#                    при scale(0), паузе и заморозке: на нём живут интерфейс,
#                    VFX, тряска камеры и DevTools.
#   * real         — часы движка: realNow() (секунды с запуска), perfNow()
#                    (монотонные миллисекунды), frame(), fps().
#   * gameplay     — delta()/now(): presentation, умноженное на scale и
#                    остановленное паузой/заморозкой.
#
# Проверяется на живом движке: падение тела Box2D на каждом значении
# масштаба, поведение интерфейса и DevTools при scale(0), отсутствие NaN в
# позициях и в множителе шага физики.
#
# Запуск (после сборки):
#   python3 tests/agent/time_scales_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    """eval, переживающий исключение в движке: проверка станет FAIL, а не падением."""
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:140])
        return default


def finite(value):
    """Конечное число? NaN, ±Infinity и не-числа (в т.ч. null из JSON) — нет."""
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and value == value and abs(value) != float("inf"))


def clock_read(a):
    """Снимок всех четырёх шкал времени."""
    return {
        "delta": ev(a, "$.time.delta()", float("nan")),
        "now": ev(a, "$.time.now()", float("nan")),
        "tick": ev(a, "$.time.tick()", -1),
        "sim": ev(a, "$.time.simTime()", float("nan")),
        "raw": ev(a, "$.time.rawDelta()", float("nan")),
        "pres_delta": ev(a, "$.time.presentationDelta()", float("nan")),
        "pres": ev(a, "$.time.presentationTime()", float("nan")),
        "real": ev(a, "$.time.realNow()", float("nan")),
        "frame": ev(a, "$.time.frame()", -1),
        "scale": ev(a, "$.time.scale()", float("nan")),
        "phys": ev(a, "$.time.physicsScale()", float("nan")),
        "c_scale": ev(a, "engine.timeScale()", float("nan")),
    }


def place_hero(a):
    """Поставить героя в воздух и обнулить скорость: чистое падение."""
    ev(a, "$.time.scale(1); $('#hero').at(300, 100); $('#hero').velocity(0, 0); 'ok'")
    a.step(2)
    return ev(a, "$('#hero').pos().y", 0.0)


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)

        # --- 1. Шкалы и их геттеры -------------------------------------------
        check(ev(a, "typeof $.time.delta") == "function", "$.time.delta() есть")
        check(ev(a, "typeof $.time.now") == "function", "$.time.now() есть")
        check(ev(a, "typeof $.time.simTime") == "function", "$.time.simTime() есть")
        check(ev(a, "typeof $.time.simDt") == "function", "$.time.simDt() есть")
        check(ev(a, "typeof $.time.rawDelta") == "function", "$.time.rawDelta() есть")
        check(ev(a, "typeof $.time.presentationDelta") == "function",
              "у презентационного времени свой геттер presentationDelta()")
        check(ev(a, "typeof $.time.presentationTime") == "function",
              "у презентационного времени свой геттер presentationTime()")
        check(ev(a, "typeof $.time.realNow") == "function", "$.time.realNow() есть")
        check(ev(a, "typeof $.time.perfNow") == "function", "$.time.perfNow() есть")
        check(ev(a, "typeof $.time.physicsScale") == "function", "$.time.physicsScale() есть")

        # --- 2. Все четыре шкалы идут на масштабе 1 ---------------------------
        before = clock_read(a)
        a.step(30)
        after = clock_read(a)
        frame_dt = after["raw"]
        check(abs(frame_dt - 1 / 60) < 1e-4,
              "в --fixed-dt время кадра постоянно (%.9f)" % frame_dt)
        check(abs((after["now"] - before["now"]) - 30 * frame_dt) < 1e-3,
              "now() копит игровое время: +%.6f за 30 кадров" % (after["now"] - before["now"]))
        check(abs((after["pres"] - before["pres"]) - 30 * frame_dt) < 1e-3,
              "presentationTime() копит время кадра: +%.6f" % (after["pres"] - before["pres"]))
        check(abs((after["real"] - before["real"]) - 30 * frame_dt) < 1e-3,
              "realNow() идёт часами движка: +%.6f" % (after["real"] - before["real"]))
        check(abs((after["sim"] - before["sim"]) - 30 * frame_dt) < 0.02,
              "simTime() = tick × simDt: +%.6f" % (after["sim"] - before["sim"]))
        check(after["tick"] > before["tick"] > 0, "шаги симуляции идут (tick %d → %d)"
              % (before["tick"], after["tick"]))
        check(abs(after["delta"] - frame_dt) < 1e-6,
              "delta() на масштабе 1 равен времени кадра")
        check(abs(after["pres_delta"] - frame_dt) < 1e-6,
              "presentationDelta() равен времени кадра")
        check(after["sim"] == ev(a, "$.time.tick() * $.time.simDt()"),
              "simTime() согласован с tick() и simDt()")

        # --- 3. Падение тела: масштаб 1 быстрее, 0.5 медленнее, 0 — стоит -----
        def fall(frames, scale=1):
            """Падение за `frames` кадров при масштабе `scale` (NaN — сломалось).

            Порядок важен: сначала чистая остановка (она же сбрасывает масштаб
            в 1), потом масштаб — иначе сброс затёр бы измеряемый режим.
            """
            y0 = place_hero(a)
            ev(a, "$.time.scale(%s)" % scale)
            a.step(frames)
            y1 = ev(a, "$('#hero').pos().y", None)
            return (y1 - y0) if finite(y1) else float("nan")

        fall_full = fall(30, 1)
        fall_half = fall(30, 0.5)
        fall_zero = fall(30, 0)
        print("  --   падение за 30 кадров: scale 1 → %.3f px, 0.5 → %.3f px, 0 → %.3f px"
              % (fall_full, fall_half, fall_zero))
        check(finite(fall_full) and fall_full > 0, "на масштабе 1 тело падает")
        check(finite(fall_half) and 0 < fall_half < fall_full,
              "на масштабе 0.5 тело падает медленнее")
        check(finite(fall_zero) and fall_zero == 0,
              "на масштабе 0 тело не двигается ни на пиксель")

        # --- 4. scale(0): симуляция стоит, презентация и интерфейс живут ------
        ev(a, "$.time.scale(0); $('#hero').velocity(0, 0); 'ok'")
        a.step(2)
        froze = clock_read(a)
        pos_frozen = ev(a, "$('#hero').pos()")
        ev(a, "$.store.set('timeClicks', 0); "
               "if (!$('#time_btn').length) { $('<ui.button>', { id: 'time_btn' })"
               ".at(300, 200).size(160, 44).text('ok').appendTo($.ui)"
               ".on('click', () => $.store.set('timeClicks', $.store.get('timeClicks') + 1)); } "
               "if (!$('#sim_particles').length) { $('<particles>', { id: 'sim_particles',"
               " amount: 4, lifetime: 4000, speed: [80, 80], direction: 0, spread: 0,"
               " seed: 21, max_particles: 8, emitting: false, burst: [4] }).at(0, 0)"
               ".appendTo($.world); } "
               "if (!$('#pres_particles').length) { $('<particles>', { id: 'pres_particles',"
               " clock: 'presentation', amount: 4, lifetime: 4000, speed: [80, 80],"
               " direction: 0, spread: 0, seed: 22, max_particles: 8, emitting: false,"
               " burst: [4] }).at(0, 200).appendTo($.world); } 'ok'")
        ev(a, "$('#sim_particles').burst(4); $('#pres_particles').burst(4);"
               " $.fx.flash('#ffffff', 600); 'ok'")
        a.step(2)
        started = clock_read(a)
        flash0 = ev(a, "$.fx.flashLeft()", -1)
        part_x = ("(function(){var p=$('#%s').particleAt(0); return p ? p.x : null;})()")
        sim0 = ev(a, part_x % "sim_particles", float("nan"))
        pres0 = ev(a, part_x % "pres_particles", float("nan"))
        a.mouse_move(x=300, y=200)
        a.mouse(button=1, action="click")
        a.step(30)
        ended = clock_read(a)
        flash1 = ev(a, "$.fx.flashLeft()", -1)
        sim1 = ev(a, part_x % "sim_particles", float("nan"))
        pres1 = ev(a, part_x % "pres_particles", float("nan"))
        pos_after = ev(a, "$('#hero').pos()")

        check(ended["delta"] == 0 and started["delta"] == 0,
              "при scale(0) delta() = 0")
        check(ended["now"] == started["now"], "при scale(0) now() не растёт")
        check(ended["tick"] - started["tick"] <= 1,
              "при scale(0) шаги симуляции стоят (%d → %d, лаг границы кадра ≤ 1)"
              % (started["tick"], ended["tick"]))
        check(ended["pres"] > started["pres"] and ended["pres_delta"] > 0,
              "при scale(0) презентационное время идёт: +%.6f" % (ended["pres"] - started["pres"]))
        check(ended["real"] > started["real"], "при scale(0) realNow() идёт")
        check(ended["frame"] > started["frame"], "при scale(0) кадры рисуются")
        check(pos_frozen == pos_after,
              "при scale(0) тело Box2D стоит: %s" % (pos_after,))
        check(ev(a, "$.store.get('timeClicks')") == 1,
              "при scale(0) клик по кнопке интерфейса доходит до обработчика")
        check(flash1 < flash0, "при scale(0) вспышка экрана гаснет (%.0f → %.0f мс)"
              % (flash0, flash1))
        check(sim1 == sim0,
              "при scale(0) частицы с clock 'simulation' стоят вместе с миром (%.2f → %.2f)"
              % (sim0, sim1))
        check(pres1 > pres0 + 10,
              "при scale(0) частицы с clock 'presentation' живут дальше (%.2f → %.2f)"
              % (pres0, pres1))

        # --- 5. Возврат масштаба: игра продолжается ---------------------------
        ev(a, "$.time.scale(1)")
        a.step(2)
        res = clock_read(a)
        ev(a, "$('#hero').velocity(0, 0)")
        y0 = ev(a, "$('#hero').pos().y", 0.0)
        a.step(20)
        check(ev(a, "$('#hero').pos().y", y0) > y0, "после scale(1) тело снова падает")
        check(res["delta"] > 0 and res["phys"] == 1 and res["c_scale"] == 1,
              "после scale(1) множитель физики вернулся к 1")

        # --- 6. Таблица значений масштаба -------------------------------------
        # Проверяем не «как получится», а контракт: неотрицательное конечное
        # число — как задано, отрицательное и NaN — полный стоп (0), бесконечность
        # — потолок, и НИ ОДНО значение не даёт NaN/Infinity в позициях.
        table = [
            ("0", "0", 0.0),
            ("0.1", "0.1", 0.1),
            ("0.5", "0.5", 0.5),
            ("1", "1", 1.0),
            ("-1", "0", 0.0),
            ("NaN", "0", 0.0),
            ("Infinity", None, None),
        ]
        for raw, want, _num in table:
            ev(a, "$.time.scale(%s)" % raw)
            a.step(3)
            got_scale = ev(a, "$.time.scale()", None)
            got_delta = ev(a, "$.time.delta()", None)
            got_phys = ev(a, "$.time.physicsScale()", None)
            c_scale = ev(a, "engine.timeScale()", None)
            now_ok = ev(a, "Number.isFinite($.time.now())", False)
            body = ev(a, "$('#hero').pos()", None)
            body_ok = (isinstance(body, dict)
                       and all(finite(body[k]) for k in ("x", "y")))
            if want is None:
                # Бесконечность: контракт — конечный потолок, а не бесконечность.
                check(finite(got_scale) and got_scale > 1,
                      "scale(Infinity) даёт конечный потолок (%s)" % (got_scale,))
            else:
                check(finite(got_scale) and abs(got_scale - float(want)) < 1e-9,
                      "scale(%s) читается как %s (%s)" % (raw, want, got_scale))
            check(finite(got_delta) and got_delta >= 0,
                  "scale(%s): delta() — конечное неотрицательное число (%s)" % (raw, got_delta))
            check(finite(got_phys),
                  "scale(%s): множитель физики конечен (%s)" % (raw, got_phys))
            check(finite(c_scale) and finite(got_phys) and abs(c_scale - got_phys) < 1e-6,
                  "scale(%s): C видит тот же множитель (%s == %s)" % (raw, c_scale, got_phys))
            check(now_ok is True, "scale(%s): now() конечен" % raw)
            check(bool(body_ok), "scale(%s): позиция тела без NaN/Infinity (%s)" % (raw, body))

        # --- 7. NaN не утекает в позиции при движении -------------------------
        # Не просто «число конечное», а «мир продолжает считать»: после каждого
        # значения ставим масштаб 1 и проверяем, что тело снова падает.
        for raw in ("-1", "NaN", "Infinity"):
            ev(a, "$.time.scale(%s); $('#hero').at(300, 100); $('#hero').velocity(0, 0); 'ok'"
               % raw)
            a.step(5)
            ev(a, "$.time.scale(1)")
            a.step(1)
            y_a = ev(a, "$('#hero').pos().y", None)
            a.step(15)
            y_b = ev(a, "$('#hero').pos().y", None)
            check(finite(y_a) and finite(y_b) and y_b > y_a,
                  "после scale(%s) мир снова считает: %s → %s" % (raw, y_a, y_b))

        # --- 8. Пауза и заморозка отделены от презентации ---------------------
        ev(a, "$.time.scale(1); $('#hero').at(300, 100); $('#hero').velocity(0, 0); 'ok'")
        a.step(2)
        p0 = clock_read(a)
        ev(a, "$.time.pause()")
        a.step(10)
        p1 = clock_read(a)
        check(p1["delta"] == 0 and p1["now"] == p0["now"], "pause() останавливает игровое время")
        check(p1["pres"] > p0["pres"], "pause() не останавливает презентационное время")
        ev(a, "$.time.resume()")
        a.step(2)
        check(ev(a, "$.time.delta()") > 0, "resume() возвращает игровое время")

        # --- 9. Движок жив -----------------------------------------------------
        check(a.ping().get("pong") is True, "движок отвечает после смены масштабов")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
