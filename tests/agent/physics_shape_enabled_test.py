#!/usr/bin/env python3
# ===========================================================================
# I17 (BASHNYA): «выключить коллайдер, оставив тело» — $.physics.shapeEnabled.
#
# Разбор: «выключить ТЕЛО» в движке уже есть — `$('#x').processing({physics:false})`
# (= `engine.setBodyEnabled`): замер — узел замирает (y 301.6), `bodyEnabled=false`,
# луч проходит сквозь. А `sensor(true)` и `mask(0)` — ДРУГИЕ инструменты: тело
# продолжает падать (569.1 и 595.8). Пробел был в паре «выключить КОЛЛАЙДЕР, но
# оставить тело»: она жила только на C-уровне (`engine.setShapeEnabled`), и её
# использовал один `$.anim`.
#
# Теперь есть `$.physics.shapeEnabled(what, index = 0, on?)` и
# `$.physics.shapeCount(what)`. Тест падает на старом коде (имён нет) и
# фиксирует числа: форма выключена → герой проваливается (390 → 541),
# `bodyEnabled` остаётся true, включение возвращает опору.
#
# Запуск после сборки:
#   python3 tests/agent/physics_shape_enabled_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
FAILURES = []
SETUP = """
(function(){
  if ($('#plat')) $('#plat').remove();
  $('#hero').at(100, 300).velocity(0, 0);
  $('<rect>', { id: 'plat', body: 'static' }).at(100, 420).size(200, 20).appendTo($.world);
})()
"""


def safe(a, code):
    try:
        return a.eval(code)
    except Exception as exc:      # noqa: BLE001 — на старом коде имён нет
        return "ERR: %s" % exc


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run(a):
    a.eval(SETUP)
    a.step(40)
    rest = a.eval("$('#hero').y")
    check(380 < rest < 400, "герой стоит на платформе: y=%.1f" % rest)

    check(safe(a, "$.physics.shapeCount('#hero')") == 1,
          "shapeCount('#hero') = %s" % (safe(a, "$.physics.shapeCount('#hero')"),))
    check(safe(a, "$.physics.shapeEnabled('#hero', 0)") is True,
          "shapeEnabled — геттер: форма включена")
    check(safe(a, "$.physics.shapeEnabled('#hero', 0)") == a.eval("engine.shapeEnabled($('#hero').get(0).body, 0)"),
          "геттер совпадает с C-уровнем (engine.shapeEnabled)")

    check(safe(a, "$.physics.shapeEnabled('#hero', 0, false)") is True,
          "выключение формы вернуло true")
    check(safe(a, "$.physics.shapeEnabled('#hero', 0)") is False, "форма выключена")
    check(a.eval("engine.bodyEnabled($('#hero').get(0).body)") is True,
          "ТЕЛО осталось включённым (bodyEnabled=true) — это и есть разница с processing")
    a.step(40)
    fell = a.eval("$('#hero').y")
    check(fell > 500, "сквозь выключенный коллайдер герой провалился: y=%.1f (было %.1f)"
          % (fell, rest))

    check(safe(a, "$.physics.shapeEnabled('#hero', 0, true)") is True,
          "включение формы вернуло true")
    check(safe(a, "$.physics.shapeEnabled('#hero', 0)") is True, "форма снова включена")
    check(safe(a, "$.physics.shapeEnabled('#hero', 5, false)") is False,
          "индекс вне диапазона — false (форма не тронута)")
    check(safe(a, "$.physics.shapeEnabled('#нет-такого', 0)") is False,
          "промах селектора — false (и сообщение в журнале по общему правилу)")

    # Сравнение инструментов: §44 выключает ТЕЛО — в падении оно замирает
    # (у выключенной формы тело продолжало бы падать, как в проверке выше).
    a.eval("if ($('#plat')) $('#plat').remove(); $('#hero').at(100, 100).velocity(0, 0)")
    a.eval("$('#hero').processing({ physics: true })")
    a.step(10)
    y_fall = a.eval("$('#hero').y")
    a.eval("$('#hero').processing({ physics: false })")
    a.step(2)                     # политику применяет тик ПОСЛЕ шага физики (§44)
    y_stop = a.eval("$('#hero').y")
    a.step(20)
    y_stop2 = a.eval("$('#hero').y")
    check(y_fall > 110 and abs(y_stop2 - y_stop) < 1 and (y_stop2 - y_fall) < 10,
          "processing({physics:false}) в падении: тело замерло (y %.1f → %.1f, через 20 кадров %.1f)"
          % (y_fall, y_stop, y_stop2))
    check(a.eval("engine.bodyEnabled($('#hero').get(0).body)") is False, "bodyEnabled=false")
    a.eval("$('#hero').processing({ physics: true })")


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        try:
            run(a)
        except Exception as exc:      # noqa: BLE001 — на старом коде тест не должен падать стеком
            check(False, "выполнение прервано: %s" % exc)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки формы-коллайдера пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
