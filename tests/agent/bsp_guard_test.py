#!/usr/bin/env python3
# ===========================================================================
# D2 (прототип гейта примеров из доки) нашёл реальный дефект: `$.world.bsp.order`
# до `build()` ронял движок SIGSEGV (-11) — нативный обход дерева не проверял,
# что дерева нет. Здесь — регрессия: пустой порядок и честный журнал вместо
# падения, и нормальный обход после build().
#
# Запуск: python3 tests/agent/bsp_guard_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "docs_examples")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=1) as a:
        a.step(2)

        # --- до build(): путь не падает ------------------------------------
        state = json.loads(a.eval(
            "JSON.stringify({ ready: $.world.bsp.ready(), count: $.world.bsp.count(),"
            " order: $.world.bsp.order({x:0,y:0}), indices: $.world.bsp.indices({x:0,y:0}) })"))
        check(state["ready"] is False and state["count"] == 0,
              f"дерева нет: ready={state['ready']} count={state['count']}")
        check(state["order"] == [], f"order до build() — пустой порядок: {state['order']}")
        check(state["indices"] == [], f"indices до build() — пустой список: {state['indices']}")

        # --- после build(): обход работает ---------------------------------
        built = a.eval("$.world.bsp.build([[0,0,100,0],[0,100,100,100],[100,0,100,100]])")
        check(built is True, f"build() трёх отрезков: {built}")
        check(a.eval("$.world.bsp.ready()") is True, "ready() после build()")
        count = a.eval("$.world.bsp.count()")
        check(count >= 3, f"count() видит отрезки: {count}")

        order = a.eval("JSON.stringify($.world.bsp.order({x:50,y:50}))")
        entries = json.loads(order)
        check(len(entries) == 3, f"order() вернул все отрезки: {len(entries)}")
        check(all(e and "x1" in e and "index" in e for e in entries),
              f"order() отдаёт объекты index/x1/y1/x2/y2: {entries[:2]}")
        near = a.eval("JSON.stringify($.world.bsp.order({x:50,y:50}, { near: true }))")
        check(json.loads(near) != entries, "opts.near меняет порядок")

        seg = a.eval("JSON.stringify($.world.bsp.segment(0))")
        check(json.loads(seg) is not None, f"segment(0): {seg}")
        check(a.eval("$.world.bsp.segment(99)") is None, "segment(99) — null, а не падение")

        a.eval("$.world.bsp.clear(); 'ok'")
        check(a.eval("$.world.bsp.ready()") is False, "clear() освободил дерево")
        check(a.eval("$.world.bsp.order({x:0,y:0})") == [], "после clear() order снова пуст")

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
