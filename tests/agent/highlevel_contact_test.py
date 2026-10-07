#!/usr/bin/env python3
# ===========================================================================
# Проверка контактов: импульс, число точек и «касаются ли сейчас».
#
# Чего не хватало (TASKS §1.3): события begin/end/hit говорят, что СТОЛКНУЛОСЬ,
# но НЕ дают импульса — солвер считает его после события. Поэтому «сила удара»
# (по ней считают урон) была недостижима, как и вопрос «касаются ли эти двое
# прямо сейчас».
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_contact_test.py
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


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        for name in ("touching", "contactBetween", "contactsOf"):
            check(a.eval(f"typeof engine.{name}") == "function",
                  f"engine.{name} есть")

        a.eval("""
            $.world.gravity(0, 1200).bounds(0, 0, 4000, 2000);
            $('<wall>', { id: 'floor', w: 400, h: 40 }).at(300, 500)
                .appendTo($.world);
            $('<enemy>', { id: 'box', w: 40, h: 40 }).at(300, 300)
                .body('dynamic').appendTo($.world);
            $('<enemy>', { id: 'high', w: 40, h: 40 }).at(1200, 300)
                .body('dynamic').appendTo($.world);
        """)

        # Пока не упала — контакта нет.
        a.step(2)
        check(a.eval("$.world.touching('#box', '#floor')") is False,
              "в полёте контакта нет")
        check(a.eval("$.world.contactBetween('#box', '#floor')") is None,
              "contactBetween без контакта — null")
        check(a.eval("$.world.contactImpulse('#box', '#floor')") == 0,
              "contactImpulse без контакта — 0")

        # Падаем на пол.
        for _ in range(90):
            a.step(1)
        check(a.eval("$.world.touching('#box', '#floor')") is True,
              "на полу тела касаются")

        c = a.eval("JSON.stringify($.world.contactBetween('#box', '#floor'))")
        print(f"  контакт: {c}")
        check('"impulse"' in c, "импульс читается")
        check('"points"' in c, "число точек читается")
        check('"nx"' in c and '"ny"' in c, "нормаль читается")

        impulse = a.eval("$.world.contactImpulse('#box', '#floor')")
        points = a.eval("$.world.contactBetween('#box', '#floor').points")
        ny = a.eval("$.world.contactBetween('#box', '#floor').ny")
        print(f"  импульс {impulse:.4f}, точек {points}, ny {ny:.2f}")
        check(impulse > 0, f"импульс покоя положителен ({impulse:.4f})")
        check(points >= 1, f"точек контакта не меньше одной ({points})")
        # Коробка лежит НА полу: нормаль указывает вверх (в Box2D Y вверх).
        check(abs(ny) > 0.9, f"нормаль вертикальна ({ny:.2f})")

        # Сосед далеко — контакта с ним нет.
        check(a.eval("$.world.touching('#high', '#floor')") is False,
              "далёкий узел не касается пола")
        check(a.eval("$.world.contactBetween('#high', '#floor')") is None,
              "у далёкого узла контакта нет")

        # contactsOf перечисляет, с кем узел касается.
        list_json = a.eval("JSON.stringify($.world.contactsOf('#box'))")
        print(f"  contactsOf(box): {list_json}")
        check(list_json.startswith("[{"), "contactsOf отдаёт список")
        check('"other"' in list_json and '"impulse"' in list_json,
              "в списке есть тело и импульс")

        # ИМПУЛЬС УДАРА БОЛЬШЕ ИМПУЛЬСА ПОКОЯ: сбрасываем коробку с высоты и
        # смотрим максимум за падение — это и есть «сила удара» для урона.
        #
        # ВАЖНО: импульс удара читается на кадре СТОЛКНОВЕНИЯ, а `touching` в
        # этот момент ещё false (манифолд появляется на следующем шаге). Поэтому
        # пик ищем по ВСЕМ кадрам, а не только когда касание уже есть.
        a.eval("$('#box').at(300, 200); engine.setVelocity($('#box').nodes[0].body, 0, 0)")
        a.step(2)
        peak = 0.0
        for _ in range(90):
            a.step(1)
            v = a.eval("$.world.contactImpulse('#box', '#floor')")
            if v > peak:
                peak = v
        print(f"  пик импульса при падении: {peak:.4f} (покой {impulse:.4f})")
        check(peak > impulse, f"удар сильнее покоя ({peak:.4f} > {impulse:.4f})")

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
