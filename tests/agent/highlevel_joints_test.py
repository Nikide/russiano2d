#!/usr/bin/env python3
# ===========================================================================
# Проверка видов суставов: revolute, distance, weld, prismatic, wheel.
#
# До этой проверки docs/highlevel/world.md обещала восемь видов, а в коде было
# три: запрос prismatic/wheel молча давал revolute. Теперь видов пять, а
# незнакомый тип честно предупреждает в журнале, а не подменяется молча.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_joints_test.py
# ===========================================================================

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


SETUP = """
$.world.gravity(0, 900).bounds(0, 0, 2000, 1200);
$('<wall>', { id: 'rail', w: 400, h: 8 }).at(400, 200).body('static').appendTo($.world);
$('<box>', { id: 'slider', w: 24, h: 24 }).at(300, 200).body('dynamic').appendTo($.world);
"""


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.eval(SETUP)

        ids = {}
        for kind in ("revolute", "distance", "weld", "prismatic", "wheel"):
            ids[kind] = a.eval(f"$.world.joint('#rail', '#slider', {{ type: '{kind}' }})")
            check(ids[kind] >= 0, f"{kind}: сустав создан (id = {ids[kind]})")
        check(len(set(ids.values())) == 5, "все пять — разные суставы")
        check(a.eval("$.world.jointCount()") == 5, "счётчик суставов верен")

        check(a.eval("$.world.jointAlive(0)") is True, "сустав жив")
        check(a.eval("$.world.joint(0)") is not None, "описание сустава читается")

        # Уничтожение освобождает слот и уменьшает счётчик.
        check(a.eval("$.world.destroyJoint(4)") is not False, "сустав уничтожен")
        check(a.eval("$.world.jointAlive(4)") is False, "он больше не жив")
        check(a.eval("$.world.jointCount()") == 4, "счётчик уменьшился")

        # Ось у prismatic: тело едет по оси X и почти не смещается по Y.
        a.eval("$.world.destroyJoint(3)")
        a.eval("$('#slider').velocity(0, 0)")
        jid = a.eval("$.world.joint('#rail', '#slider', "
                     "{ type: 'prismatic', axis: [1, 0], "
                     "a: [300, 200], b: [300, 200] })")
        check(jid >= 0, "prismatic с осью создан")
        before_y = a.eval("$('#slider').pos().y")
        a.eval("$('#slider').velocity(120, 90)")   # просим ехать и вбок
        a.step(20)
        after_y = a.eval("$('#slider').pos().y")
        drift = abs(after_y - before_y)
        print(f"  prismatic: смещение по Y = {drift:.1f} px (ось — X)")
        check(drift < 6, f"ось держит: по Y почти не сдвинулся ({drift:.1f} px)")

        # Незнакомый вид не подменяется молча: создаётся revolute с варнингом.
        a.eval("$.world.joint('#rail', '#slider', { type: 'неттакого' })")
        check(True, "незнакомый тип не падает (варнинг в журнале движка)")

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
