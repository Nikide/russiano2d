#!/usr/bin/env python3
# ===========================================================================
# §6.4. Односторонние платформы: провал сквозь платформу, приземление на
# нижнюю, повторное включение коллизии и ходьба по платформе.
#
# Фикстура: tests/fixtures/physics_oneway/main.js — две односторонние
# платформы друг под другом (верх 390 и 630) и боковые ограничители.
#
# Сценарий:
#   1. тело стоит на ВЕРХНЕЙ платформе;
#   2. .dropThrough() — падает сквозь неё и приземляется на НИЖНЮЮ
#      (onFloor()/on_ground, y на верхней грани нижней платформы);
#   3. повторное включение коллизии проверяется делом: тело запускается снизу
#      вверх сквозь верхнюю платформу и снова встаёт на неё — значит one-way
#      снова работает как пол;
#   4. 40 кадров ходьбы по платформе: |Δy| ≤ 2 px, опора не теряется ни кадра.
#
# Проход снизу, приземление сверху и S+Space уже покрыты
# foundations_test.py и highlevel_controls_test.py — здесь только цикл
# «провал → возврат на платформу».
#
# Запуск:
#   python3 tests/agent/highlevel_physics_oneway_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "physics_oneway")

#: Верхние грани платформ фикстуры; полувысота тела 15 px.
UPPER_TOP, LOWER_TOP = 390.0, 630.0
HALF_H = 15.0


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sample(a, sel="#dropper"):
    """Позиция, опора и узел опоры за текущий кадр."""
    return a.eval("""(() => {
        const n = $('#%s'), g = n.ground();
        return {
            x: n.pos().x, y: n.pos().y,
            floor: n.onFloor() === true,
            attr: n.get(0).attrs.on_ground === true,
            support: g && g.node ? g.node.get(0).id : null,
        };
    })()""" % sel.lstrip("#"))


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(40)
        top = sample(a)
        check(top["floor"] and top["attr"] and top["support"] == "upper",
              f"тело стоит на верхней односторонней платформе (опора {top['support']})")
        check(abs(top["y"] - (UPPER_TOP - HALF_H)) < 2,
              f"центр тела на верхней грани (y={top['y']:.1f}, "
              f"ждём {UPPER_TOP - HALF_H:.0f} ± 2)")
        check(a.eval("engine.oneWayIgnore($('#dropper').get(0).body)") is False,
              "до провала тело не игнорирует односторонние платформы")

        # =====================================================================
        # 1. .dropThrough(): падение сквозь верхнюю платформу.
        # =====================================================================
        a.eval("$('#dropper').dropThrough()")
        fall = []
        for _ in range(60):
            a.step(1)
            fall.append(sample(a))
            if fall[-1]["floor"] and fall[-1]["y"] > LOWER_TOP - 60:
                break

        check(a.eval("$.store.get('throughUpper')") is True,
              "тело прошло НИЖЕ верхней платформы (флаг throughUpper)")
        lowest = max(s["y"] for s in fall)
        check(lowest > UPPER_TOP + 20,
              f"провал не остановился на верхней платформе "
              f"(максимум y={lowest:.0f}, верх платформы {UPPER_TOP:.0f})")
        check(all(fall[i + 1]["y"] >= fall[i]["y"] - 0.5 for i in range(len(fall) - 1)),
              "падение идёт вниз без отскоков вверх")

        # =====================================================================
        # 2. Приземление на нижнюю платформу: опора вернулась.
        # =====================================================================
        landed = sample(a)
        check(landed["floor"] and landed["attr"] and landed["support"] == "lower",
              f"тело снова на платформе (опора {landed['support']}, "
              f"onFloor={landed['floor']}, on_ground={landed['attr']})")
        check(abs(landed["y"] - (LOWER_TOP - HALF_H)) < 3,
              f"центр тела на верхней грани нижней платформы "
              f"(y={landed['y']:.1f}, ждём {LOWER_TOP - HALF_H:.0f} ± 3)")
        check(a.eval("engine.oneWayIgnore($('#dropper').get(0).body)") is False,
              "после провала игнор односторонних платформ снят (коллизия включена)")

        # =====================================================================
        # 3. Повторное включение коллизии: снизу вверх сквозь верхнюю
        #    платформу — и снова встать на неё сверху.
        # =====================================================================
        # Скорость задаём напрямую (как foundations_test.py): прыжка с нижней
        # платформы на верхнюю (240 px) силой 640 не хватило бы.
        # Полёт длится ~62 кадра (подъём 0.64 с + падение), поэтому шагаем
        # фиксированные 80 кадров и смотрим конечное состояние: пока центр тела
        # проходит сквозь платформу, ground() на пару кадров видит её сверху —
        # это не приземление, а мгновенное перекрытие.
        a.eval("$('#dropper').velocity(0, -1150)")
        apex = landed["y"]
        for _ in range(80):
            a.step(1)
            apex = min(apex, sample(a)["y"])

        check(apex < UPPER_TOP - HALF_H - 10,
              f"тело поднялось выше верхней платформы (апекс y={apex:.0f}, "
              f"верх платформы {UPPER_TOP:.0f}) — односторонняя поверхность "
              f"пропустила его снизу")
        back = sample(a)
        check(back["floor"] and back["attr"] and back["support"] == "upper",
              f"тело снова стоит на верхней платформе (опора {back['support']}) — "
              f"коллизия включилась обратно")
        check(abs(back["y"] - (UPPER_TOP - HALF_H)) < 3,
              f"центр тела на верхней грани (y={back['y']:.1f}, "
              f"ждём {UPPER_TOP - HALF_H:.0f} ± 3)")
        check(a.eval("engine.oneWayIgnore($('#dropper').get(0).body)") is False,
              "игнор односторонних платформ снова снят — платформа держит сверху")

        # =====================================================================
        # 4. Ходьба по платформе: тело не проваливается и не теряет опору.
        # =====================================================================
        y0 = back["y"]
        x0 = back["x"]
        walk = []
        a.keys(["D"])
        for _ in range(40):
            a.step(1)
            walk.append(sample(a))
        a.keys([])

        dy = max(abs(s["y"] - y0) for s in walk)
        airborne = [i for i, s in enumerate(walk) if not s["floor"] or not s["attr"]]
        check(dy <= 2.0,
              f"ходьба по платформе без просадки: |Δy| ≤ 2 px (макс. {dy:.2f} px)")
        check(not airborne,
              f"опора не теряется ни на одном из 40 кадров ходьбы "
              f"(кадров без опоры: {len(airborne)})")
        check(walk[-1]["x"] - x0 > 40,
              f"тело действительно шло по платформе "
              f"(x {x0:.0f} → {walk[-1]['x']:.0f})")
        check(all(s["support"] == "upper" for s in walk),
              "всё время ходьбы опора — верхняя платформа")

        if FAILURES:
            print(a.stderr_tail(15))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
