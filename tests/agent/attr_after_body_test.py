#!/usr/bin/env python3
# ===========================================================================
# §6.6 плана дополировки: смена трения/плотности/упругости после создания тела
# должна быть видна, а не молча пропадать.
#
# Box2D читает эти числа один раз — при создании тела. Раньше `.attr('friction')`
# после появления тела не делал НИЧЕГО и об этом никто не узнавал: игра считала,
# что поменяла трение. Теперь расхождение попадает в диагностику с кодом
# R2D_ATTR_AFTER_BODY, а значение остаётся в attrs (его прочитает пересоздание).
#
# Проверяется:
#   * до тела — тишина (обычный путь: значение задано перед appendTo);
#   * после тела — ровно одна запись с кодом, узлом и значением;
#   * повторная установка того же значения записи не плодит;
#   * значение действительно осталось в attrs — диагностика не врёт.
#
# Запуск (после сборки движка):
#   python3 tests/agent/attr_after_body_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "physics_edge")
CODE = "R2D_ATTR_AFTER_BODY"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def entries(a, code=None):
    data = a.eval("$.debug.errors()") or []
    if code is None:
        return data
    return [e for e in data if e.get("code") == code]


def clear(a):
    a.eval("$.debug.clearErrors(); 'ok'")


def main():
    with Agent(game=GAME, seed=3) as a:
        a.step(3)

        # --- 1. До тела: значение задано до appendTo — диагностики нет --------
        clear(a)
        a.eval("""
          $('<player>', { id: 'pre', friction: 0.77 }).at(120, 120).size(20, 20)
              .health(10).collision(20, 20).appendTo($.world);
          'ok'
        """)
        a.step(2)
        check(not entries(a, CODE),
              "до создания тела диагностики нет (%d записей)" % len(entries(a, CODE)))
        check(a.eval("$('#pre').attr('friction')") == 0.77,
              "значение сохранено в attrs: %s" % a.eval("$('#pre').attr('friction')"))
        check(a.eval("$('#pre').get(0).body >= 0") is True, "у узла есть тело")

        # --- 2. После тела: ровно одна запись с кодом -------------------------
        clear(a)
        a.eval("$('#pre').attr('friction', 0.11); 'ok'")
        a.step(2)
        after = entries(a, CODE)
        check(len(after) == 1, "смена трения после тела даёт ровно одну запись: %d" % len(after))
        if after:
            entry = after[0]
            check(entry.get("subsystem") == "physics",
                  "запись отнесена к физике: %s" % entry.get("subsystem"))
            check((entry.get("data") or {}).get("attr") == "friction",
                  "в записи назван атрибут: %s" % entry.get("data"))
            check((entry.get("data") or {}).get("value") == 0.11,
                  "в записи названо значение: %s" % (entry.get("data") or {}).get("value"))
            check(entry.get("nodeId") == a.eval("$('#pre').attr('id')"),
                  "в записи назван узел: %s" % entry.get("nodeId"))
            check(entry.get("recoverable") is True, "запись помечена восстановимой")

        # --- 3. То же значение повторно: новых записей нет --------------------
        clear(a)
        a.eval("$('#pre').attr('friction', 0.11); $('#pre').attr('friction', 0.11); 'ok'")
        a.step(2)
        check(not entries(a, CODE),
              "повтор того же значения не плодит записей (%d)" % len(entries(a, CODE)))

        # --- 4. Плотность и упругость ведут себя так же -----------------------
        clear(a)
        a.eval("$('#pre').attr('density', 3); $('#pre').attr('restitution', 0.4); 'ok'")
        a.step(2)
        both = entries(a, CODE)
        attrs = sorted((e.get("data") or {}).get("attr") for e in both)
        check(attrs == ["density", "restitution"],
              "плотность и упругость тоже попадают в диагностику: %s" % attrs)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
