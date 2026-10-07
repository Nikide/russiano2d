#!/usr/bin/env python3
# ===========================================================================
# Проверка CCD (быстрые пули): $.world.bullet / engine.setBullet.
#
# ИСТОРИЯ. Раньше вывод был «флаг доходит до Box2D, но туннелирование
# воспроизвести не удалось: нужен тест с более тонкой стеной и подшагом мельче
# 1/60». Проверено ТОЧНО и с правильными границами мира:
#
#   * туннелирование не воспроизводится НИ с CCD, ни без него — вплоть до
#     максимальной скорости, которую допускает движок;
#   * причина: Box2D v3 решает высокоскоростные контакты спекулятивно, поэтому
#     даже 2-пиксельная стена при 63 px за шаг ловит тело;
#   * «более тонкая стена и более мелкий шаг» НЕ помогут: при `--fixed-dt`
#     подшаг и так 1/60, а предел скорости задан `maximumLinearSpeed = 120`
#     метров в секунду (~3840 px/с при 32 px/м) — быстрее тело в этом движке
#     разогнать нельзя, и именно поэтому «предельные скорости» в старом тесте
#     на самом деле были обычными.
#
# Значит CCD — это страховка на будущее (если поднять предел скорости), а не
# наблюдаемый эффект. Тест проверяет то, что проверяемо: флаг доходит до Box2D,
# и пуля НЕ пролетает сквозь стену на пределе скорости.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_ccd_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []

# Предел движка: maximumLinearSpeed = 120 м/с, 32 px в метре → ~3840 px/с.
MAX_SPEED = 3800


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shoot(a, bullet, wall_w, speed, frames=90):
    """Стреляем слева направо в тонкую стену; возвращаем итоговый x."""
    a.eval("$.world.gravity(0, 0).bounds(0, 0, 20000, 20000)")
    a.eval(f"$('<wall>', {{ id: 'w', w: {wall_w}, h: 400 }}).at(2000, 300)"
           ".body('static').appendTo($.world)")
    a.eval(f"$('<enemy>', {{ id: 'b', w: 8, h: 8 }}).at(100, 300).body('dynamic')"
           f".gravity(false).bullet({str(bullet).lower()}).appendTo($.world)")
    a.step(1)
    bid = a.eval("$('#b').nodes[0].body")
    a.eval(f"engine.setVelocity({bid}, {speed}, 0)")
    for _ in range(frames):
        a.step(1)
    x = a.eval("$('#b').pos().x")
    a.eval("$('#b').remove(); $('#w').remove()")
    return x


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # --- флаг доходит до Box2D ---
        a.eval("$.world.gravity(0, 0).bounds(0, 0, 20000, 20000)")
        a.eval("$('<enemy>', { id: 'p', w: 8, h: 8 }).at(100, 300).body('dynamic')"
               ".gravity(false).bullet(true).appendTo($.world)")
        a.step(1)
        bid = a.eval("$('#p').nodes[0].body")
        check(a.eval(f"engine.isBullet({bid})") is True,
              "engine.setBullet доходит до Box2D")
        check(a.eval("$.world.isBullet('#p')") is True,
              "$.world.isBullet читает флаг обратно")
        check(a.eval("$.world.bullet('#p', false)") is False,
              "флаг можно снять")
        a.eval("$('#p').remove()")

        # --- пуля не пролетает сквозь ТОНКУЮ стену на пределе скорости ---
        stopped = []
        for wall in (2, 8):
            for bullet in (True, False):
                x = shoot(a, bullet, wall, MAX_SPEED)
                stopped.append((wall, bullet, x))
                ccd = "с CCD " if bullet else "без CCD"
                print(f"  стена {wall}px, {MAX_SPEED} px/с ({MAX_SPEED/60:.0f} px/шаг), {ccd}: x = {x:.1f}")
                check(x < 2000, f"пуля остановлена стеной {wall}px ({ccd}): x = {x:.1f}")

        # Тонкая стена (2 px) не должна отличаться от толстой по факту удара.
        thin = [x for (w, _, x) in stopped if w == 2]
        check(all(x > 1900 for x in thin),
              f"и тело ДОЛЕТЕЛО до тонкой стены, а не встало раньше: {thin}")

        # --- медленная пуля для контроля ---
        slow = shoot(a, True, 8, 1200)
        print(f"  контроль: 1200 px/с → x = {slow:.1f}")
        check(slow < 2000, "и на обычной скорости стена держит")

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
