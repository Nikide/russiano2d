#!/usr/bin/env python3
# ===========================================================================
# Тест §44 (P0-23) через агентский интерфейс: политики обработки узла,
# visibility/activation и симуляционные тики.
#
# Проверяется ровно приёмка §44, числами:
#   * inactive-враг не получает movement-обновлений (контроллер перестаёт
#     писать скорость), его sensor включается ОТДЕЛЬНОЙ операцией;
#   * .active(false) останавливает тело, но не скрывает узел: кадры идут;
#   * death-таймер освобождает объект по заявленным часам (тикам);
#   * animation completion доигрывает, когда остановлена только movement-логика;
#   * снаряд живёт одинаковое simulation time при 30/60/144 render FPS
#     (разное число кадров до одного и того же 120-го тика, одна позиция);
#   * объект не зависает навсегда из-за смешения visibility и processing;
#   * hit-stop/пауза (§6) останавливают тики — второго механизма времени нет.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_activation_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "activation")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sim_run(fixed_dt, target_tick=120):
    """Прогон до `target_tick`-го шага симуляции: сколько кадров понадобилось."""
    with Agent(game=GAME, seed=11, fixed_dt=fixed_dt) as s:
        frames = 0
        while s.eval("$.time.tick()") < target_tick and frames < 3000:
            s.step(1)
            frames += 1
        return {
            "fps": round(1.0 / fixed_dt),
            "frames": frames,
            "tick": s.eval("$.time.tick()"),
            "born": s.eval("$.store.get('probeBorn')"),
            "x": round(s.eval("$('#probe').pos().x"), 6),
            "probe_gone": s.eval("$.store.get('probeGone')"),
        }


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(3)

        # --- API на месте ------------------------------------------------------
        check(a.eval("typeof $.processing") == "object", "$.processing поставлен")
        check(a.eval("typeof $.activation") == "object", "$.activation поставлен")
        check(a.eval("typeof $('#foe').processing") == "function",
              "метод узла .processing() объявлен")
        check(a.eval("typeof $('#foe').active") == "function",
              "метод узла .active() объявлен")
        check(a.eval("typeof $.time.tick") == "function", "$.time.tick() есть")
        check(a.eval("typeof $.time.onTick") == "function", "$.time.onTick() есть")
        check(a.eval("typeof $.time.afterTicks") == "function", "$.time.afterTicks() есть")
        check(a.eval("typeof $.time.duration") == "function", "$.time.duration() есть")

        # --- Объект не зависает: скрытый узел под auto-политикой --------------
        check(a.eval("$.processing.allow('#sleeper', 'update')") is False,
              "скрытый узел выключен auto-политикой (§44)")
        check(a.eval("$('#sleeper').isVisible()") is True,
              "auto НЕ скрывает узел (inactive ≠ hidden)")
        check(a.eval("$('#sleeper').processing('animation')") is True,
              "анимация у скрытого узла не выключена")

        # --- §44(1): inactive-враг не получает movement-обновлений ------------
        a.eval("$('#foe').velocity(60, 0); true")
        a.step(2)
        v_on = a.eval("$('#foe').velocity().x")
        check(abs(v_on) < 1e-6,
              "при update:true контроллер переписывает скорость каждый кадр (vx=%.4f)" % v_on)

        a.eval("$('#foe').processing({ update: false }); $('#foe').velocity(60, 0); true")
        a.step(5)
        v_off = a.eval("$('#foe').velocity().x")
        check(abs(v_off - 60.0) < 1.0,
              "при update:false узел не получает movement-обновлений (vx=%.4f)" % v_off)
        check(a.eval("$('#foe').processing('update')") is False, "политика update выключена")
        check(a.eval("$('#foe').processing('animation')") is True,
              "политика animation при этом не тронута")

        # --- §44(1): sensor включается ОТДЕЛЬНОЙ операцией --------------------
        check(a.eval("$('#foe').areaOn('sense')") is False, "sensor выключен на старте")
        check(a.eval("$('#foe').areaOverlap('sense').length") == 0,
              "выключенный sensor никого не находит")
        a.eval("$('#foe').areaOn('sense', true); true")
        a.step(2)
        found = a.eval("$('#foe').areaOverlap('sense').length")
        check(found > 0, "включённый sensor находит цель (%d)" % found)
        check(a.eval("$('#foe').processing('update')") is False,
              "включение sensor не включило обработку — операции разные")
        a.eval("$('#foe').areaOn('sense', false); true")
        a.step(2)
        check(a.eval("$('#foe').areaOverlap('sense').length") == 0,
              "выключение sensor не выключило обработку")

        # --- §44(4): animation completion при остановленной movement-логике ---
        for _ in range(60):
            a.step(1)
            if a.eval("$.store.get('animEnds')") == 1:
                break
        check(a.eval("$.store.get('animEnds')") == 1,
              "клип кадров доиграл при update:false (animEnds=%s)"
              % a.eval("$.store.get('animEnds')"))
        check(a.eval("$('#foe').get(0).frame_index") == 3, "кадр дошёл до последнего")
        check(a.eval("$('#foe').processing('update')") is False,
              "movement-логика всё это время оставалась выключенной")

        # --- §44(1): .active(false) — тело стоит, кадры идут, визуал цел -------
        a.eval("$('<bullet>', { id: 'frozen' }).at(300, 300).size(8, 8)"
               ".velocity(120, 0).appendTo($.world); true")
        a.step(5)
        x0 = a.eval("$('#frozen').pos().x")
        f0 = a.eval("$.time.frame()")
        check(x0 > 300.5, "тело двигалось до выключения (x=%.3f)" % x0)

        a.eval("$('#frozen').active(false); true")
        check(a.eval("$('#frozen').processing('physics')") is False,
              ".active(false) выключает участие в физике")
        # Политику применяет кадровый тик ПОСЛЕ шага физики, поэтому кадр
        # перехода тело ещё шагает — дальше стоит.
        a.step(1)
        x1 = a.eval("$('#frozen').pos().x")
        f1 = a.eval("$.time.frame()")
        a.step(10)
        x2 = a.eval("$('#frozen').pos().x")
        f2 = a.eval("$.time.frame()")
        check(abs(x2 - x1) < 0.001,
              "physics:false — тело стоит на месте (x %.3f → %.3f)" % (x1, x2))
        check(f2 - f1 == 10, "при этом кадры идут (frame %d → %d)" % (f1, f2))
        check(a.eval("$('#frozen').isVisible()") is True, "визуал не тронут: inactive ≠ hidden")

        # Box2D при выключении тела обнуляет скорость (это не сон): после
        # включения тело снова участвует, но начинает с нулевой скорости.
        a.eval("$('#frozen').active(true); true")
        a.step(2)                       # кадр применения политики + запас
        x3 = a.eval("$('#frozen').pos().x")
        a.eval("$('#frozen').velocity(120, 0); true")
        a.step(3)
        check(a.eval("$('#frozen').pos().x") > x3 + 0.01,
              "после active(true) тело снова участвует в физике (x=%.3f)"
              % a.eval("$('#frozen').pos().x"))

        # --- §44(3): death-таймер освобождает объект по заявленным часам ------
        a.eval("$('<enemy>', { id: 'doomed2' }).at(900, 500).size(28, 40).appendTo($.world);"
               "$.time.afterTicks(30, () => { const n = $('#doomed2'); if (n.length) n.remove(); },"
               " { node: $('#doomed2').get(0) }); true")
        born = a.eval("$.time.tick()")
        while a.eval("$.time.tick()") < born + 29:
            a.step(1)
        check(a.eval("$('#doomed2').length") == 1,
              "на 29-м тике объект жив (родился %d, сейчас %d)" % (born, a.eval("$.time.tick()")))
        while a.eval("$.time.tick()") < born + 30:
            a.step(1)
        gone_tick = a.eval("$.time.tick()")
        check(a.eval("$('#doomed2').length") == 0,
              "на 30-м тике таймер освободил объект (born=%d, gone=%d)" % (born, gone_tick))
        check(gone_tick - born == 30, "освобождение ровно через 30 тиков")

        # --- Уборка области не зависит от политики узла -----------------------
        check(a.eval("$('#sleeper').length") == 0,
              "scope-таймер освободил выключенный узел (зависания нет)")

        # --- §6/§44: hit-stop останавливает тики, второго механизма нет -------
        a.eval("$.time.freeze(200); true")
        a.step(1)
        tick_frozen = a.eval("$.time.tick()")
        a.step(5)
        check(a.eval("$.time.tick()") == tick_frozen,
              "на заморозке hit-stop шаги симуляции стоят (tick=%d)" % tick_frozen)
        check(a.eval("$.time.frame()") > 0, "кадры отрисовки при этом идут")
        a.eval("$.time.unfreeze(); true")
        a.step(2)
        check(a.eval("$.time.tick()") > tick_frozen, "после unfreeze тики пошли снова")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "в кадре нет ошибок игрового кода: %s" % errors[:2])

    # --- §44: одинаковое simulation time при 30/60/144 render FPS -------------
    runs = [sim_run(1.0 / 30), sim_run(1.0 / 60), sim_run(1.0 / 144)]
    # Тело рождается на разном тике (ready идёт после шага симуляции кадра) —
    # поэтому состояние сравнивается относительно рождения: одинаковое ЧИСЛО
    # шагов симуляции даёт одинаковую позицию при любом render FPS.
    for r in runs:
        steps = r["tick"] - r["born"]
        print("       FPS~%d: кадров %d, тиков %d, рождение %d, шагов тела %d, x=%.3f, проба ушла через %d тиков"
              % (r["fps"], r["frames"], r["tick"], r["born"], steps, r["x"], r["probe_gone"] - r["born"]))
    check(all(r["tick"] == 120 for r in runs),
          "во всех прогонах ровно 120 шагов симуляции: %s" % [r["tick"] for r in runs])
    ok_pos = all(abs(r["x"] - (200.0 + (r["tick"] - r["born"]) * 2.0)) < 1e-6 for r in runs)
    check(ok_pos,
          "позиция = 200 + шаги × 2 px при любом FPS: %s" % [r["x"] for r in runs])
    check(runs[0]["frames"] < runs[1]["frames"] < runs[2]["frames"],
          "кадров до того же тика разное число: %s" % [r["frames"] for r in runs])
    check(all(r["probe_gone"] - r["born"] == 45 for r in runs),
          "жизнь снаряда — ровно 45 тиков при любом render FPS: %s"
          % [r["probe_gone"] - r["born"] for r in runs])
    check(all(r["frames"] != r["tick"] for r in runs),
          "$.time.tick() — не номер кадра: %s" % [[r["frames"], r["tick"]] for r in runs])

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
