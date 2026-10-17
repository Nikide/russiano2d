#!/usr/bin/env python3
# ===========================================================================
# D8-I8: события входа/выхода сенсора проверены живым прогоном.
#
# В docs/ENGINE_GAPS было записано «событий сенсора нет, только overlap».
# Факт: Box2D-сенсоры дают begin/end, `$.world.contacts()` помечает их
# `sensor: true`, а узел получает `collide`/`separate` с этим флагом и
# честными `hasNormal/hasPoint = false` (нормали у сенсора нет).
#
# Тест: тело пролетает сквозь сенсор (не отталкивается), при входе приходит
# `collide` (sensor), при выходе — `separate` (sensor).
#
# Запуск: python3 tests/agent/sensor_events_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "sensor_events")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def events(a):
    return a.state().get("sensorEvents") or {}


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(5)
        base = events(a)
        check(base.get("enter", 0) == 0 and base.get("exit", 0) == 0,
              f"до касания событий нет: {base}")

        # Тело едет вправо сквозь сенсор. Сенсор не должен его останавливать.
        a.eval("$('#probe').velocity(600, 0); 'ok'")
        a.step(40)
        mid = events(a)
        x_in = a.eval("$('#probe').get(0).x")
        check(x_in > 400 and x_in < 600,
              f"тело вошло в сенсор и не оттолкнулось (x={x_in})")
        check(mid.get("enter", 0) >= 1,
              f"вход в сенсор: collide с sensor=true = {mid.get('enter')}")
        check(mid.get("sensor_flag", 0) == mid.get("enter", 0),
              f"у всех входов sensor === true: {mid.get('sensor_flag')} из {mid.get('enter')}")
        check(mid.get("normal_null", 0) == mid.get("enter", 0),
              f"нормали нет честно (hasNormal=false, nx=null): {mid.get('normal_null')}")
        check(mid.get("point_null", 0) == mid.get("enter", 0),
              f"точки касания нет честно (hasPoint=false): {mid.get('point_null')}")
        a.step(25)
        x_out = a.eval("$('#probe').get(0).x")
        check(x_out > 620,
              f"тело прошло сквозь сенсор (x={x_out} > правой границы 600)")

        # Возвращаемся назад — выход из сенсора.
        a.eval("$('#probe').velocity(-600, 0); 'ok'")
        a.step(40)
        back = events(a)
        check(back.get("exit", 0) >= 1,
              f"выход из сенсора: separate с sensor=true = {back.get('exit')}")
        check(back.get("separate", 0) >= back.get("exit", 0),
              f"separate не меньше сенсорных выходов: {back.get('separate')} / {back.get('exit')}")
        x_back = a.eval("$('#probe').get(0).x")
        check(x_back < 380, f"тело вышло из зоны обратно (x={x_back} < 400)")

        # Повторный вход — снова события (не «одноразовый» флаг).
        a.eval("$('#probe').velocity(600, 0); 'ok'")
        a.step(40)
        again = events(a)
        check(again.get("enter", 0) > mid.get("enter", 0),
              f"повторный вход снова даёт событие: {mid.get('enter')} → {again.get('enter')}")

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
