#!/usr/bin/env python3
# ===========================================================================
# Тест кривых в движке: реестр имён, градиенты и совместная работа с твинами.
#
# Что проверяется:
#   * $.curve.use('easeOut') отдаёт функцию, и твин принимает её как ease;
#   * градиент собирается из строки со стрелками;
#   * именованные кривые регистрируются и находятся.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_curve_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=os.path.join("tests", "fixtures", "text"), seed=5) as a:
        check(a.eval("typeof $.curve") == "object", "$.curve доступна игре")
        check(a.eval("$.curve.names().length") >= 10, "встроенных кривых не меньше десяти")

        mid = a.eval("$.curve.use('easeOut')(0.5)")
        check(0.5 < mid < 1.0, f"easeOut(0.5) = {mid:.3f} — быстрее линейной")

        check(a.eval("typeof $.curve.define('test_pop', [0, 1.3, 1])") == "object"
              or a.eval("$.curve.get('test_pop') !== null"),
              "именованная кривая регистрируется")
        check(a.eval("$.curve.get('test_pop')(0.5)") > 1.0, "кривая с выбросом даёт >1")

        grad = a.eval("JSON.stringify($.curve.gradient('#000000 → #ffffff').at(0.5))")
        check("128" in grad, f"середина градиента — серый: {grad}")

        # Твин принимает кривую как ease: считаем, что значение доехало.
        moved = a.eval("""(function(){
            const n = $('<rect>', { id: 'cv', w: 10, h: 10 }).at(0, 0).appendTo($.world);
            n.tween({ x: 100 }, 0.2, { ease: $.curve.use('easeInOut') });
            return 1;
        })()""")
        check(moved == 1, "твин принял кривую без ошибки")
        a.step(20)
        check(a.eval("$('#cv').pos().x") > 90, "после твина узел доехал до цели")

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
