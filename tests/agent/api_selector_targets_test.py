#!/usr/bin/env python3
# ===========================================================================
# Цель-селектор у методов привязки: документированная форма РАБОТАЕТ, промах
# СЛЫШЕН.
#
# Повод (task-46, найдено на task-44): `$('<sprite>').appendTo('#hero')` —
# ровно эта форма стоит в docs/HIGH_LEVEL_API.md:656 — молча ни к чему не
# прикреплял узел: `resolveContainer()` принимал только узел/обёртку, а строку
# превращал в `null`. Узел оставался без родителя, ошибки не было.
#
# Тест падает на старом коде на строковой форме и на промахе селектора.
# Сообщения проверяются перехватом `$.ctx.log` (подменяется на время вызова),
# а не по stderr: так проверка детерминированная и не зависит от канала логов.
#
# Запуск после сборки:
#   python3 tests/agent/api_selector_targets_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
FAILURES = []

#: Перехват журнала: возвращает список сообщений, попавших в `ctx.log`.
CAPTURE = """
(function (fn) {
    const ctx = $.ctx;
    const real = ctx.log;
    const seen = [];
    ctx.log = function (msg) { seen.push(String(msg)); };
    try { fn(); } finally { ctx.log = real; }
    return seen;
})
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def safe(a, code):
    """eval, который не роняет тест: на старом коде часть вызовов бросает."""
    try:
        return a.eval(code)
    except Exception as exc:      # noqa: BLE001 — нужен именно текст ошибки
        return "ERR: %s" % exc


def logs(a, code):
    """Выполнить код с перехватом журнала и вернуть список сообщений."""
    return a.eval("(%s)(function () { %s })" % (CAPTURE, code))


def run(a):
    # --- 1. Документированная форма: appendTo со СТРОКОЙ-селектором ---------
    a.eval("$('<rect>', { id: 'p1' }).at(10, 10).size(4, 4).color('#fff').appendTo('#hero')")
    a.step(1)
    check(a.eval("$('#hero').children().length") == 1,
          "appendTo('#hero') прикрепил узел: детей %s (ждали 1)"
          % a.eval("$('#hero').children().length"))
    check(a.eval("$('#p1').parent().nodes.length") == 1,
          "у прикреплённого узла есть родитель: %s (ждали 1)"
          % a.eval("$('#p1').parent().nodes.length"))

    # --- 2. Обёртка работает как раньше -------------------------------------
    a.eval("$('<rect>', { id: 'p2' }).at(10, 10).size(4, 4).color('#fff').appendTo($('#hero'))")
    a.step(1)
    check(a.eval("$('#hero').children().length") == 2,
          "appendTo($('#hero')) по-прежнему работает: детей %s (ждали 2)"
          % a.eval("$('#hero').children().length"))

    # --- 3. prependTo — та же дорога ----------------------------------------
    a.eval("$('<rect>', { id: 'p3' }).at(10, 10).size(4, 4).color('#fff').prependTo('#hero')")
    a.step(1)
    check(a.eval("$('#hero').children().length") == 3,
          "prependTo('#hero') прикрепил узел: детей %s (ждали 3)"
          % a.eval("$('#hero').children().length"))

    # --- 4. Промах селектора: НЕ тишина -------------------------------------
    before = a.eval("$.world.all().length")
    msgs = logs(a, "$('<rect>', { id: 'p4' }).at(10, 10).size(4, 4).appendTo('#нет-такого')")
    a.step(1)
    check(any("нет-такого" in m for m in msgs),
          "appendTo с промахом пишет в журнал: %s" % (msgs,))
    check(a.eval("$('#p4').parent().nodes.length") == 0,
          "промах ничего не прикрепляет (узел остаётся у мира)")
    check(a.eval("$.world.all().length") == before + 1,
          "узел не потерялся: узлов мира %s (было %s)"
          % (a.eval("$.world.all().length"), before))

    # --- 5. Несколько совпадений: берём первый, но говорим об этом ----------
    msgs = logs(a, "$('<rect>', { id: 'p5' }).at(10, 10).size(4, 4).appendTo('.goblin')")
    a.step(1)
    check(a.eval("$('#p5').parent().nodes.length") == 1,
          "appendTo('.goblin') прикрепил узел к первому совпадению")
    check(a.eval("$('.goblin').get(0) === $('#p5').parent().get(0)"),
          "именно к ПЕРВОМУ совпадению")
    check(any("селектор" in m and "goblin" in m for m in msgs),
          "о неоднозначном селекторе сказано в журнале: %s" % (msgs,))

    # --- 6. $('<node>').append('#selector') — тоже цель по селектору --------
    a.eval("$('<rect>', { id: 'holder' }).at(0, 0).size(8, 8).appendTo($.world)")
    a.eval("$('#holder').append('#p1')")
    a.step(1)
    check(a.eval("$('#holder').children().length") == 1,
          "append('#p1') переносит найденный узел: детей %s (ждали 1)"
          % a.eval("$('#holder').children().length"))
    msgs = logs(a, "$('#holder').append('#нет-такого')")
    check(any("нет-такого" in m for m in msgs),
          "append с промахом пишет в журнал: %s" % (msgs,))
    msgs = logs(a, "$('#holder').append(42)")
    check(len(msgs) > 0, "append(42) не молчит: %s" % (msgs,))

    # --- 7. Цели-точки: lookAt/distanceTo с промахом ------------------------
    msgs = logs(a, "$('#hero').lookAt('#нет-такого')")
    check(any("нет-такого" in m for m in msgs),
          "lookAt с промахом пишет в журнал: %s" % (msgs,))
    msgs = logs(a, "$('#hero').distanceTo('#нет-такого')")
    check(any("нет-такого" in m for m in msgs),
          "distanceTo с промахом пишет в журнал: %s" % (msgs,))
    a.eval("$('#hero').lookAt('.goblin')")
    a.step(1)
    check(logs(a, "$('#hero').lookAt('.goblin')") == [],
          "рабочий селектор не пишет ничего лишнего")

    # --- 8. Маска по селектору: промах не должен молча обнулять маску -------
    mask_before = a.eval("$('#hero').mask()")
    msgs = logs(a, "$('#hero').mask('#нет-такого')")
    mask_after = a.eval("$('#hero').mask()")
    check(any("нет-такого" in m for m in msgs),
          "mask с промахом пишет в журнал: %s" % (msgs,))
    check(mask_after == mask_before,
          "промах не меняет маску: было %s, стало %s" % (mask_before, mask_after))
    a.eval("$('#hero').mask('.goblin')")
    check(a.eval("$('#hero').mask()") != mask_before,
          "рабочий селектор маску меняет")


def run_doc_examples(a):
    """Примеры docs/HIGH_LEVEL_API.md с селекторами — каждый выполняется.

    Проверяем не «текст совпадает», а факт: вызов с селектором находит узел
    (в журнале нет «ни к чему не подошёл») и возвращает то, что обещано в
    комментарии примера.
    """
    print("--- примеры docs/HIGH_LEVEL_API.md (строки 21, 246–263, 417–438, 656, 1456) ---")
    a.eval("""(function(){
        $('<rect>', { id: 'wall' }).at(300, 300).size(40, 40).color('#666').appendTo($.world);
        $('<rect>', { id: 'lava' }).at(340, 300).size(40, 40).color('#f30').appendTo($.world);
        $('<enemy>', { id: 'enemy' }).at(500, 300).size(28, 40).health(10).appendTo($.world);
    })()""")
    a.step(2)

    cases = [
        # (пример из доки, ожидаемый тип результата)
        ("$('#enemy').distanceTo('#hero')", "number"),
        ("$('#enemy').directionTo('#hero')", "object"),
        ("$('#enemy').angleTo('#hero')", "number"),
        ("$('#enemy').rayTo('#hero')", "object"),
        ("$('#enemy').sweepTo('#hero')", "object"),
        ("$('#enemy').collidesWith('#wall')", "boolean"),
        ("$('#enemy').collidesWith('#lava', false) === $('#enemy')", "boolean"),
    ]
    for code, want in cases:
        msgs = logs(a, "$('#enemy').moveTowards('#hero', 120);")
        got = a.eval("typeof (%s)" % code)
        check(got == want, "пример %s → %s" % (code, got))
        check(not any("не подошёл" in m for m in msgs),
              "moveTowards('#hero', 120) без промаха: %s" % (msgs,))

    msgs = logs(a, "$('#enemy').moveTo('#hero', 120); $('#enemy').lookAt('#hero');")
    check(not any("не подошёл" in m for m in msgs),
          "moveTo('#hero', speed) и lookAt('#hero') без промаха: %s" % (msgs,))

    msgs = logs(a, "$('.goblin').each((i, e) => { if (e.distanceTo('#hero') < 900) e.moveTowards('#hero', 120); });")
    check(not any("не подошёл" in m for m in msgs),
          "пример со строки 21 (each + distanceTo + moveTowards) без промаха: %s" % (msgs,))

    # Пример строки 656 — та самая форма, ради которой задача: узел становится
    # ребёнком найденного узла (проверяем на <rect>: <sprite> требует src).
    a.eval("$('<rect>', { id: 'doc_child' }).at(5, 5).size(3, 3).appendTo('#enemy')")
    a.step(1)
    check(a.eval("$('#doc_child').parent().get(0) === $('#enemy').get(0)") is True,
          "HIGH_LEVEL_API.md:656 — appendTo('#hero') прикрепляет к найденному узлу")

    # `{ parent: '#hero' }` в атрибутах идёт той же дорогой (core.js).
    created = safe(a, "$('<rect>', { id: 'attr_child', parent: '#enemy' }).at(6, 6).size(3, 3)")
    a.step(1)
    parent_ok = safe(a, "$('#attr_child').parent().get(0) === $('#enemy').get(0)")
    check(parent_ok is True,
          "атрибут { parent: '#enemy' } прикрепляет к найденному узлу (%s, создание: %s)"
          % (parent_ok, created))


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run(a)
        run_doc_examples(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки целей-селекторов пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
