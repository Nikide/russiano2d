#!/usr/bin/env python3
# ===========================================================================
# §6.2. Актёр стоит краем коллайдера на платформе.
#
# 25 % ширины тела (6.5 px из 26) свисают за правую кромку платформы. 120
# кадров подряд проверяется: опора есть каждый кадр (onFloor() и on_ground),
# нет дрожания (|Δx| < 1 px), нет проваливания (|Δy| < 0.5 px) и нет
# чередования floor/no-floor.
#
# Центр тела при таком свесе остаётся над платформой, поэтому однолучевая
# проверка «стою ли на земле» врёт на кромке — опора ищется по ширине тела
# (api.js, probeGround), и тест это фиксирует.
#
# Фикстура: tests/fixtures/physics_edge/main.js.
#
# Запуск:
#   python3 tests/agent/highlevel_physics_edge_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "physics_edge")

#: Платформа фикстуры: x 400..600, верх y = 384.
LEDGE_RIGHT = 600.0
LEDGE_TOP = 384.0


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def sample(a, sel):
    """Один кадр: позиция, опора, признак земли и узел опоры."""
    return a.eval("""(() => {
        const n = $('%s'), g = n.ground();
        return {
            x: n.pos().x, y: n.pos().y,
            floor: n.onFloor() === true,
            attr: n.get(0).attrs.on_ground === true,
            support: g && g.node ? g.node.get(0).id : null,
        };
    })()""" % sel)


def main():
    with Agent(game=GAME, seed=11) as a:
        # Падение на платформу и успокоение: измеряем уже стоящее тело.
        a.step(30)
        first = sample(a, "#edge")
        check(first["floor"] is True, "игрок стоит на платформе перед замером")

        # Предпосылка теста: за кромкой свисает примерно четверть ширины.
        half_w = a.eval("$('#edge').size().w / 2")
        edge_right = first["x"] + half_w
        overhang = edge_right - LEDGE_RIGHT
        check(3 < overhang < 10,
              f"за кромкой свисает {overhang:.1f} px из {half_w * 2:.0f} "
              f"(≈25 %, правый край тела на x={edge_right:.1f})")

        samples = []
        for _ in range(120):
            a.step(1)
            samples.append(sample(a, "#edge"))

        # --- Опора каждый кадр, без мерцания ---------------------------------
        no_floor = [i for i, s in enumerate(samples) if not s["floor"]]
        no_attr = [i for i, s in enumerate(samples) if not s["attr"]]
        check(not no_floor,
              f"onFloor() истинно все 120 кадров (без опоры: {len(no_floor)} кадров)")
        check(not no_attr,
              f"on_ground истинно все 120 кадров (без опоры: {len(no_attr)} кадров)")
        flicker = sum(1 for i in range(1, len(samples))
                      if samples[i]["floor"] != samples[i - 1]["floor"])
        check(flicker == 0,
              f"чередования floor/no-floor нет (переходов: {flicker})")

        # Опора — именно платформа, а не соседняя геометрия.
        supports = {s["support"] for s in samples}
        check(supports == {"ledge"},
              f"опора — платформа, а не пустота ({sorted(str(s) for s in supports)})")

        # --- Нет дрожания и проваливания -------------------------------------
        xs = [s["x"] for s in samples]
        ys = [s["y"] for s in samples]
        drift_x = max(xs) - min(xs)
        drift_y = max(ys) - min(ys)
        step_x = max(abs(xs[i] - xs[i - 1]) for i in range(1, len(xs)))
        step_y = max(abs(ys[i] - ys[i - 1]) for i in range(1, len(ys)))
        check(drift_x < 1.0 and step_x < 1.0,
              f"нет бокового дрожания/импульса: размах Δx {drift_x:.4f} px, "
              f"макс. шаг {step_x:.4f} px (ждём < 1 px)")
        check(drift_y < 0.5 and step_y < 0.5,
              f"нет проваливания и подпрыгивания: размах Δy {drift_y:.4f} px, "
              f"макс. шаг {step_y:.4f} px (ждём < 0.5 px)")

        # Тело стоит на верхней грани платформы (полувысота 15 px), а не утонуло.
        rest_err = abs(ys[-1] - (LEDGE_TOP - 15.0))
        check(rest_err < 1.0,
              f"центр тела на высоте опоры (y={ys[-1]:.2f}, ждём {LEDGE_TOP - 15:.0f} ± 1)")

        if FAILURES:
            print(a.stderr_tail(15))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
