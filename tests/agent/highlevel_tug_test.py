#!/usr/bin/env python3
# ===========================================================================
# Проверка перетаскивания ($.world.tug) и ЗАМЕНЫ границ мира ($.world.bounds).
#
# Разбирались, почему перетаскивание обрывалось на середине. Причина оказалась
# НЕ в перетаскивании: `$.world.bounds()` каждый раз ДОБАВЛЯЛ четыре стены, а
# прежние оставались на месте. Второй bounds() (другая сцена, другой тест)
# оставлял невидимые стены от первого, и тела упирались в воздух.
#
# Здесь проверяется и то, и другое: границы заменяются, а тело доезжает до
# цели в обе стороны.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_tug_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def bounds_count(a):
    return a.eval("$('.world-bound').length")


def drag(a, start, target, frames=200):
    a.eval("$.world.gravity(0, 0).bounds(0, 0, 4000, 2000)")
    a.eval(f"$('<enemy>', {{ id: 'g', w: 24, h: 24 }}).at({start}, 300)"
           ".body('dynamic').gravity(false).appendTo($.world)")
    a.step(1)
    for _ in range(frames):
        a.eval(f"$.world.tug('#g', {target}, 300)")
        a.step(1)
        if abs(a.eval("$('#g').pos().x") - target) <= 2:
            break
    x = a.eval("$('#g').pos().x")
    a.eval("$('#g').remove()")
    return x


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # --- границы заменяются, а не накапливаются ---
        a.eval("$.world.bounds(0, 0, 640, 360)")
        a.step(1)
        first = bounds_count(a)
        check(first == 4, f"одна граница — 4 стены (получили {first})")

        a.eval("$.world.bounds(0, 0, 4000, 2000)")
        a.step(1)
        second = bounds_count(a)
        check(second == 4,
              f"ВТОРАЯ граница ЗАМЕНИЛА первую, а не добавилась (было {second})")

        a.eval("$.world.clearBounds()")
        a.step(1)
        check(bounds_count(a) == 0, "clearBounds убирает все стены границ")

        # --- перетаскивание в обе стороны ---
        right = drag(a, 300, 700)
        print(f"  300 → 700: доехало до {right:.1f}")
        check(abs(right - 700) <= 2, f"тело доехало вправо (x = {right:.1f})")

        left = drag(a, 700, 300)
        print(f"  700 → 300: доехало до {left:.1f}")
        check(abs(left - 300) <= 2, f"тело доехало влево (x = {left:.1f})")

        far = drag(a, 1000, 1500)
        print(f"  1000 → 1500: доехало до {far:.1f}")
        check(abs(far - 1500) <= 2, f"тело доехало на дистанции (x = {far:.1f})")

        # --- столкновение перебивает тягу ---
        a.eval("$.world.gravity(0, 0).bounds(0, 0, 4000, 2000)")
        a.eval("$('<enemy>', { id: 'b', w: 24, h: 24 }).at(300, 300)"
               ".body('dynamic').gravity(false).appendTo($.world)")
        a.eval("$('<wall>', { id: 'w', w: 40, h: 200 }).at(600, 300)"
               ".body('static').appendTo($.world)")
        a.step(1)
        for _ in range(200):
            a.eval("$.world.tug('#b', 900, 300)")
            a.step(1)
        blocked = a.eval("$('#b').pos().x")
        print(f"  со стеной на 580-620: тело остановилось на {blocked:.1f}")
        check(blocked < 585, f"стена перебила тягу (x = {blocked:.1f})")
        check(blocked > 500, "и тело ДОЕХАЛО до стены, а не застряло в начале")

        # --- спящее тело всё равно тянется ---
        # Box2D засыпает неподвижные тела, а setVelocity спящее тело не двигает:
        # сеттер обязан его будить.
        a.eval("$('<enemy>', { id: 's', w: 24, h: 24 }).at(200, 300)"
               ".body('dynamic').gravity(false).appendTo($.world)")
        a.step(120)                      # даём заснуть (ничего не делаем)
        bid = a.eval("$('#s').nodes[0].body")
        was_asleep = not a.eval(f"engine.isAwake({bid})")
        before = a.eval("$('#s').pos().x")
        for _ in range(60):
            a.eval("$.world.tug('#s', 500, 300)")
            a.step(1)
        after = a.eval("$('#s').pos().x")
        print(f"  спящее тело (спало: {was_asleep}): {before:.0f} → {after:.0f}")
        check(after > before + 100, f"спящее тело поехало за тягой (+{after - before:.0f} px)")

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
