#!/usr/bin/env python3
# ===========================================================================
# Пример §31-2 Спецификации: «Melee/contact» (demos/melee).
#
# Проверяется ПОВЕДЕНИЕ, а не наличие методов: удар только в окне анимации,
# один gameplay-hit при нескольких hurtbox, вторая атака бьёт снова, отражение
# меняет владельца/команду, отдача двигает тело и не проходит сквозь стену,
# смерть ровно один раз, а presentation ($.hitFx) не влияет на урон.
#
# Запуск:
#   python3 tests/agent/melee_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/melee_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("demos", "melee")
FAILURES = []
FLOOR_REST_Y = 538          # центр тела на полу (верх пола 560, высота 44)
GRUNT_X = 460


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_of(a):
    return [line.strip() for line in a.stderr_text().splitlines()
            if "$: ошибка" in line or "[error]" in line]


def place(a, sel, x, y):
    a.eval("void $('%s').at(%f, %f).velocity(0, 0)" % (sel, x, y))


def counters(a):
    return (a.eval("$.store.get('hits')") or 0,
            a.eval("$.store.get('damage')") or 0,
            a.eval("$.store.get('deaths')") or 0,
            a.eval("$.store.get('feedbackPlays')") or 0)


def attack(a, frames=45):
    """Один удар: Space, затем прокрутка клипа до конца."""
    a.key("Space", "tap")
    a.step(frames)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(30)

        # --- Сцена и окно анимации -------------------------------------------
        check(a.eval("$.scene.current()") == "melee", "сцена примера открылась")
        check(a.eval("$('#hero').length") == 1, "герой создан")
        check(a.eval("$('#grunt').areas().length") == 3, "у цели несколько hurtbox")
        markers = a.eval("$.anim.markers('slash').map(m => m.window + '/' + m.windowPhase).join(',')")
        check(markers == "attack/open,attack/close",
              "клип объявляет окно удара маркерами (%s)" % markers)
        check(a.eval("$.anim.player('hero').window('attack')") is False,
              "до удара окно закрыто")
        check(a.eval("$('#hero').areaOn('blade')") is False, "hitbox выключен вне окна")
        check(counters(a)[:3] == (0, 0, 0), "счётчики пусты: %s" % (counters(a)[:3],))

        # --- Вне окна урона нет ----------------------------------------------
        place(a, "#hero", 400, 500)
        place(a, "#grunt", GRUNT_X, FLOOR_REST_Y)
        a.step(20)
        hp0 = a.eval("$('#grunt').hp()")
        a.key("Space", "tap")
        a.step(3)   # 50 мс < 120 мс — окно ещё закрыто
        check(a.eval("$.anim.player('hero').window('attack')") is False,
              "клип идёт, но окно ещё закрыто")
        check(a.eval("$('#grunt').hp()") == hp0, "вне окна урона нет")
        check(a.eval("$.store.get('hits')") == 0, "вне окна попаданий нет")

        # --- В окне: один удар на несколько hurtbox ---------------------------
        hit_frame = None
        for i in range(26):
            a.step(1)
            if a.eval("$.store.get('hits')") > 0:
                hit_frame = i
                break
        check(hit_frame is not None, "в окне удар засчитан")
        check(a.eval("$.anim.player('hero').window('attack')") is True,
              "попадание случилось внутри окна")
        hits, damage, deaths, _ = counters(a)
        check(hits == 1, "три hurtbox цели дали ОДИН gameplay-hit (%d)" % hits)
        check(damage == 25, "урон применён один раз (25): %d" % damage)
        check(a.eval("$('#grunt').hp()") == hp0 - 25,
              "здоровье уменьшилось ровно на удар (%s)" % a.eval("$('#grunt').hp()"))

        # Остаток окна не добавляет попаданий (дедупликация по владельцу).
        a.step(20)
        check(a.eval("$.store.get('hits')") == 1, "внутри окна удар не повторяется")

        # --- Новая атака бьёт снова ------------------------------------------
        a.step(10)
        place(a, "#grunt", GRUNT_X, FLOOR_REST_Y)
        place(a, "#hero", 400, 500)
        a.step(12)
        attack(a)
        hits2, damage2, _, _ = counters(a)
        check(hits2 == 2 and damage2 == 50,
              "вторая атака поражает снова (hits %d, урон %d)" % (hits2, damage2))

        # --- Отдача: тело двигается и не проходит сквозь стену ---------------
        place(a, "#hero", 880, 500)
        place(a, "#brute", 940, FLOOR_REST_Y)
        a.step(20)
        bx0 = a.eval("$('#brute').pos().x")
        attack(a)
        bx1 = a.eval("$('#brute').pos().x")
        check(a.eval("$('#brute').hp()") == 95, "brute получил удар")
        check(bx1 > bx0 + 5, "отдача сдвинула тело (%.0f → %.0f)" % (bx0, bx1))
        check(bx1 + 16 <= 969, "тело не прошло сквозь колонну (x=%.0f)" % bx1)

        # --- Снаряд без щита бьёт героя --------------------------------------
        place(a, "#hero", 400, 500)
        a.step(10)
        hero_hp0 = a.eval("$('#hero').hp()")
        a.key("J", "tap")
        a.step(80)
        check(a.eval("$('#hero').hp()") == hero_hp0 - 18,
              "снаряд без щита наносит урон (%s)" % a.eval("$('#hero').hp()"))
        check(a.eval("$('#shot').length") == 0, "попавший снаряд убран")

        # --- Отражение: новая identity, владелец и команда --------------------
        a.eval("$('#hero').hp(100)")
        a.eval("$('#shooter').hp(60)")
        a.eval("$.store.set('reflected', 0)")
        place(a, "#hero", 400, 500)
        a.keys(["Left Shift"])
        a.step(3)
        check(a.eval("$('#hero').areaOn('guard')") is True, "Shift поднимает щит")
        a.key("J", "tap")
        reflected = None
        for _ in range(80):
            a.step(1)
            if (a.eval("$.store.get('reflected')") or 0) > 0:
                reflected = a.eval("$.store.get('reflect')")
                break
        check(reflected is not None, "снаряд отражён щитом")
        if reflected:
            check(reflected.get("reflected") is True, "отражение помечено reflected")
            check(reflected.get("id") != reflected.get("from"),
                  "отражение — новая attack identity (%s → %s)"
                  % (reflected.get("from"), reflected.get("id")))
            check(reflected.get("owner_id") == a.eval("$('#hero').nid()"),
                  "владелец отражённой атаки — герой (%s)" % reflected.get("owner_id"))
            check(reflected.get("team") == 1, "команда отражённой атаки — 1")
        shot_vx = a.eval("$('#shot').velocity().x")
        check(shot_vx is not None and shot_vx < 0,
              "снаряд полетел обратно (vx=%.0f)" % (shot_vx or 0))

        shooter_hp = a.eval("$('#shooter').hp()")
        hits_before, damage_before, _, _ = counters(a)
        for _ in range(120):
            a.step(1)
            if a.eval("$('#shooter').hp()") < shooter_hp:
                break
        a.keys([])
        check(a.eval("$('#shooter').hp()") == 33,
              "отражённый снаряд бьёт стрелка (60 → %s, ×1.5 от 18 = 27)"
              % a.eval("$('#shooter').hp()"))
        check(a.eval("$('#hero').hp()") == 100, "со щитом герой не пострадал")

        # Отражённая атака обычна по форме: её попадание приходит событием
        # `damage` и попадает в счётчики БЕЗ ручной правки объекта атаки.
        hits_after, damage_after, _, _ = counters(a)
        check(hits_after == hits_before + 1,
              "событие damage от отражённой атаки дошло (hits %d → %d)"
              % (hits_before, hits_after))
        check(damage_after - damage_before == 27,
              "урон отражённой атаки посчитан (%d)" % (damage_after - damage_before))
        reflect_log = a.eval("$.combat.attacks().filter(x => x.reflected).map(x => x.hits)")
        check(reflect_log == [1],
              "журнал hits отражённой атаки ведёт движок (%s)" % reflect_log)
        check(a.eval("$.combat.attacks().length") >= 1,
              "$.combat.attacks() не падает и видит атаки")

        # --- Presentation не влияет на урон и hits ----------------------------
        place(a, "#brute", 940, FLOOR_REST_Y)
        place(a, "#hero", 880, 500)
        a.eval("$('#brute').hp(120)")
        a.step(20)
        h_before, d_before, _, plays_before = counters(a)
        attack(a)
        h_fx, d_fx, _, plays_fx = counters(a)
        check(plays_fx > plays_before, "презентация сыграла (hit-stop/тряска/вспышка)")
        check(d_fx - d_before == 25, "урон с фидбеком: %d" % (d_fx - d_before))

        a.eval("$.store.set('feedback', false)")
        place(a, "#brute", 940, FLOOR_REST_Y)
        place(a, "#hero", 880, 500)
        a.eval("$('#brute').hp(120)")
        a.step(20)
        h_before2, d_before2, _, plays_before2 = counters(a)
        attack(a)
        h_off, d_off, _, plays_off = counters(a)
        check(d_off - d_before2 == 25, "урон без фидбека тот же: %d" % (d_off - d_before2))
        check(h_off - h_before2 == 1, "hits без фидбека тот же (+%d)" % (h_off - h_before2))
        check(plays_off == plays_before2, "без фидбека $.hitFx не вызывался")
        a.eval("$.store.set('feedback', true)")

        # --- Смерть ровно один раз --------------------------------------------
        a.eval("$('#grunt').hp(100)")
        for _ in range(5):
            place(a, "#grunt", GRUNT_X, FLOOR_REST_Y)
            place(a, "#hero", 400, 500)
            a.step(12)
            attack(a)
        deaths = a.eval("$.store.get('deaths')")
        check(a.eval("$('#grunt').hp()") == 0, "цель убита")
        check(deaths == 1, "смерть засчитана ровно один раз (%d)" % deaths)
        check(a.eval("$.store.get('damage')") >= 100, "урон накопился (%s)" % a.eval("$.store.get('damage')"))

        errors = errors_of(a)
        check(not errors, "в примере нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
