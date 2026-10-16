#!/usr/bin/env python3
# ===========================================================================
# A1 (отчёт внешней команды, docs/EXTERNAL_FEEDBACK.md): `.x`/`.y` обёртки.
#
# Было: `typeof $('#hero').x === 'undefined'`, а `$('#hero').x = 500` молча
# вешало на обёртку обычное JS-свойство и узел не двигал — ни ошибки, ни
# строки в журнале, а `undefined` в арифметике давал NaN. На этих граблях
# стоял и пример самого движка (game/level.js: сравнение hero.x/spike.x всегда
# давало одно направление, а «поправка» позиции платформы через node.x = … не
# поправляла ничего).
#
# Проверяется:
#   * чтение `.x/.y/.w/.h` — числа и совпадают с `.pos()`/`.size()`;
#   * запись двигает узел (позиция И тело физики) — проверка телом: луч
#     `$.world.raycast` попадает в тело на новом месте, а на старом пусто;
#   * запись на выборке двигает ВСЕ узлы, а не первый;
#   * камера-follow видит новое место цели;
#   * `.w`/`.h` меняют размер и тело (`syncBodySize`);
#   * мусор (`NaN`, `Infinity`, строка) не уезжает в позицию: число остаётся
#     конечным, а в журнале ровно одна строка на имя поля;
#   * присваивание НЕИЗВЕСТНОГО свойства не проходит молча (строгий режим):
#     свойства на обёртке не появляется;
#   * пустая выборка отдаёт число 0, как `.pos()` — не undefined.
#
# Запуск (после сборки):
#   python3 tests/agent/node_xy_accessors_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:140])
        return default


def finite(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and value == value and abs(value) != float("inf"))


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)

        # --- 1. Чтение: числа и согласие с .pos()/.size() ---------------------
        check(ev(a, "typeof $('#hero').x") == "number", "чтение .x даёт число, а не undefined")
        check(ev(a, "typeof $('#hero').y") == "number", "чтение .y даёт число")
        check(ev(a, "typeof $('#hero').w") == "number", "чтение .w даёт число")
        check(ev(a, "typeof $('#hero').h") == "number", "чтение .h даёт число")
        check(ev(a, "$('#hero').x") == ev(a, "$('#hero').pos().x")
              and ev(a, "$('#hero').y") == ev(a, "$('#hero').pos().y"),
              "чтение .x/.y совпадает с .pos()")
        check(ev(a, "$('#hero').w") == ev(a, "$('#hero').size().w")
              and ev(a, "$('#hero').h") == ev(a, "$('#hero').size().h"),
              "чтение .w/.h совпадает с .size()")
        # Пустая выборка: число 0, как у .pos() по умолчанию (не undefined).
        check(ev(a, "$('#nope').x") == 0 and ev(a, "$('#nope').y") == 0,
              "пустая выборка отдаёт 0, а не undefined (%s)" % ev(a, "$('#nope').x"))

        # --- 2. Запись .x/.y двигает узел И тело ------------------------------
        # Позиция читается СРАЗУ после записи (запись синхронна): шаг физики
        # сдвинул бы свободно падающее тело и замаскировал точность.
        ev(a, "$('#hero').at(200, 300).velocity(0, 0)")
        a.step(2)
        before = ev(a, "$('#hero').pos()")
        ev(a, "$('#hero').x = 500")
        pos = ev(a, "$('#hero').pos()")
        check(finite(pos["x"]) and abs(pos["x"] - 500) < 1e-4,
              "запись .x двигает узел (%.3f)" % pos["x"])
        check(abs(pos["y"] - before["y"]) < 1e-9,
              "запись .x не трогает y (%.3f → %.3f)" % (before["y"], pos["y"]))
        # Тело физики, а не только поле узла: луч в мире попадает на новое место.
        # Допуск 1.5 px: у полигона Box2D есть собственный радиус (~0.3 px).
        hit = ev(a, "$.world.raycast({x: 440, y: %f}, {x: 520, y: %f})" % (pos["y"], pos["y"]))
        check(isinstance(hit, dict) and abs(hit["point"]["x"] - (500 - 13)) < 1.5,
              "тело физики тоже на новом месте (левая грань %s ≈ 487)"
              % (round(hit["point"]["x"], 2) if isinstance(hit, dict) else None))
        miss = ev(a, "$.world.raycast({x: 140, y: %f}, {x: 200, y: %f})" % (pos["y"], pos["y"]))
        check(miss is None, "на старом месте (x≈200) тела больше нет")
        a.step(2)
        check(abs(ev(a, "$('#hero').pos().x") - 500) < 2.0,
              "после шага физики узел остался на новом месте (%s)"
              % ev(a, "$('#hero').pos().x"))

        before = ev(a, "$('#hero').pos()")
        ev(a, "$('#hero').y = 120")
        pos = ev(a, "$('#hero').pos()")
        check(finite(pos["y"]) and abs(pos["y"] - 120) < 1e-4,
              "запись .y двигает узел (%.3f)" % pos["y"])
        check(abs(pos["x"] - before["x"]) < 1e-9,
              "запись .y не трогает x (%.3f → %.3f)" % (before["x"], pos["x"]))

        # --- 3. Запись на выборке двигает ВСЕ узлы ----------------------------
        ev(a, "$('#hero').at(200, 300)")
        a.step(2)
        moved = ev(a, "(function(){var g = $('.goblin'); g.x = 700;"
                      " return [g.eq(0).pos().x, g.eq(1).pos().x, g.eq(2).pos().x,"
                      " g.eq(1).y !== g.eq(0).y]; })()")
        check(isinstance(moved, list) and all(abs(v - 700) < 1e-4 for v in moved[:3]),
              "запись .x на выборке двигает каждый узел (%s)" % (moved[:3],))
        check(bool(moved and moved[3]) is True,
              "у каждого узла сохранился свой y (запись только по оси x)")

        # --- 4. Камера-follow видит новое место -------------------------------
        ev(a, "$.camera.at(0, 0).follow('#hero', { smooth: 0 })")
        a.step(2)
        ev(a, "$('#hero').x = 900")
        a.step(3)
        cam = ev(a, "$.camera.x()")
        check(finite(cam) and abs(cam - 900) < 1.0,
              "камера со слежением переехала за узлом (%.2f)" % cam)
        ev(a, "$.camera.unfollow()")

        # --- 5. .w/.h: размер и тело ------------------------------------------
        ev(a, "$('#hero').at(400, 300).velocity(0, 0).w = 80")
        y_hero = ev(a, "$('#hero').pos().y")
        check(abs(ev(a, "$('#hero').size().w") - 80) < 1e-4,
              "запись .w меняет размер (%s)" % ev(a, "$('#hero').size().w"))
        hit = ev(a, "$.world.raycast({x: 330, y: %f}, {x: 420, y: %f})" % (y_hero, y_hero))
        check(isinstance(hit, dict) and abs(hit["point"]["x"] - (400 - 40)) < 1.0,
              "тело пересобрано под новый размер (левая грань %s ≈ 360)"
              % (round(hit["point"]["x"], 2) if isinstance(hit, dict) else None))
        ev(a, "$('#hero').w = 26")
        hit2 = ev(a, "$.world.raycast({x: 330, y: %f}, {x: 420, y: %f})" % (y_hero, y_hero))
        check(abs(ev(a, "$('#hero').size().w") - 26) < 1e-4, "размер возвращается обратно")
        check(isinstance(hit2, dict) and abs(hit2["point"]["x"] - (400 - 13)) < 1.0,
              "и тело снова узкое (левая грань %s ≈ 387)"
              % (round(hit2["point"]["x"], 2) if isinstance(hit2, dict) else None))

        # --- 6. Мусор не уезжает в позицию ------------------------------------
        # Запись синхронна, поэтому сравнение идёт без шага физики: иначе
        # свободно падающее тело сдвинулось бы само и замаскировало результат.
        before = ev(a, "$('#hero').pos()")
        for bad in ("NaN", "Infinity", "-Infinity", "'строка'", "undefined", "null",
                    "''", "true", "[]", "({})"):
            ev(a, "$('#hero').x = %s" % bad)
        after = ev(a, "$('#hero').pos()")
        check(finite(after["x"]) and after["x"] == before["x"] and after["y"] == before["y"],
              "нечисловая запись .x не меняет позицию (%s → %s)" % (before, after))
        check(finite(ev(a, "$('#hero').x")), "чтение .x остаётся числом (%s)" % ev(a, "$('#hero').x"))
        # Числовая строка — это число (поле ввода в интерфейсе).
        ev(a, "$('#hero').x = '250'")
        check(abs(ev(a, "$('#hero').pos().x") - 250) < 1e-4,
              "числовая строка принимается ('250' → %s)" % ev(a, "$('#hero').pos().x"))
        warned = [l for l in a.stderr_text().splitlines() if "не число" in l]
        check(len(warned) == 1,
              "о нечисловой записи ровно одна строка на имя поля (%d)" % len(warned))
        if warned:
            print("  --   журнал: %s" % warned[0].strip())

        # --- 7. Неизвестное свойство не пропадает молча -----------------------
        # Игровые модули — ES-модули, то есть строгий режим: там присваивание
        # нового свойства нерасширяемой обёртке бросает TypeError. Проверяем ту
        # же семантику строгой функцией (eval сам по себе нестрогий).
        threw = False
        message = ""
        try:
            a.eval("(function () { 'use strict'; $('#hero').noSuchProp = 5; })()")
        except AgentError as exc:
            threw = True
            message = str(exc)
        still = ev(a, "typeof $('#hero').noSuchProp")
        check(still == "undefined", "неизвестное свойство не появилось на обёртке (%s)" % still)
        check(threw, "в строгом режиме (как в игре) запись неизвестного свойства — ошибка")
        # QuickJS в тексте ошибки имя свойства не повторяет (сообщение —
        # «object is not extensible»), но ошибка приходит ИЗ строки кода с
        # присваиванием: молчания нет, и это главное требование A1.
        check(not threw or "not extensible" in message,
              "ошибка движка — от нерасширяемой обёртки (%s)" % message.splitlines()[0][:100])
        # Нестрогий код (eval агента) не бросает, но и свойства не создаёт.
        ev(a, "$('#hero').anotherUnknown = 7")
        check(ev(a, "typeof $('#hero').anotherUnknown") == "undefined",
              "в нестрогом коде свойство тоже не создаётся — мёртвого поля нет")

        # --- 8. Методы прототипа не затёрты аксессорами -----------------------
        check(ev(a, "typeof $('#hero').angle") == "function"
              and ev(a, "typeof $('#hero').scale") == "function"
              and ev(a, "typeof $('#hero').size") == "function",
              ".angle()/.scale()/.size() остались методами")
        check(ev(a, "(function(){ var w = $('#hero'); return w.angle(0.25) === w; })()") is True,
              "цепочка .angle(rad) работает как раньше")
        ev(a, "$('#hero').angle(0)")

        check(a.ping().get("pong") is True, "движок отвечает после проверок аксессоров")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
