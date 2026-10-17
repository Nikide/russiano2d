#!/usr/bin/env python3
# ===========================================================================
# I1/Д13: позиция игры и смещение отрисовки разведены.
#
# До правки активный параллакс писал node.x/y: `pos()` уезжал от камеры,
# игровое `.at()` приходилось «перезакреплять», а геймплей читал экранную
# координату. Теперь:
#   * node.x/y — позиция игры: камера её НЕ меняет, `.pos()` стабилен;
#   * смещение отрисовки = `(cam − cam_ref) × (1 − f)` и лежит в draw_off;
#   * `$.layers.offset(node)` отдаёт это смещение (проверяемый контракт);
#   * нарисованное место = pos + off: пикинг мышью попадает именно туда,
#     а в старую (игровую) точку — нет;
#   * `.parallax(null)` обнуляет смещение и не сдвигает позицию игры.
#
# Фикстура tests/fixtures/layers: #star0 — ребёнок слоя с parallax 0.5.
# Запуск: python3 tests/agent/layers_parallax_i1_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "layers")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(2)
        a.eval("$.camera.at(0, 0)")
        a.step(2)
        # Экран: центр = (engine.width/2, engine.height/2) = (400, 300).
        w = a.eval("engine.width")
        h = a.eval("engine.height")
        cx, cy = w / 2, h / 2

        pos0 = a.eval("$('#star0').pos().x")
        off0 = a.eval("$.layers.offset('#star0').x")
        check(abs(pos0 - 60) < 2 and abs(off0) < 1e-6,
              f"камера 0: pos={pos0:.0f}, offset={off0:.0f}")

        a.eval("$.camera.at(200, 0)")
        a.step(2)
        pos1 = a.eval("$('#star0').pos().x")
        off1 = a.eval("$.layers.offset('#star0').x")
        check(abs(pos1 - pos0) < 2,
              f"камера 200: позиция игры не уехала ({pos0:.0f} → {pos1:.0f})")
        check(abs(off1 - 100) < 2,
              f"камера 200: смещение отрисовки = 100 при f=0.5 ({off1:.1f})")
        check(abs(pos1 + off1 - 160) < 2,
              f"нарисованное место = 160 ({pos1 + off1:.1f})")

        # Пикинг: нарисованная позиция → попадание, позиция игры → промах.
        # star0: w=h=12, значит допуск ±6 вокруг нарисованной точки.
        sx = pos1 + off1 - 200 + cx
        sy = a.eval("$('#star0').pos().y") - 0 + cy
        a.mouse_move(x=sx, y=sy)
        a.step(3)
        check(a.eval("$('#star0').attr('picked')") is True,
              f"пикинг попадает в нарисованную точку ({sx:.0f},{sy:.0f})")
        gx = pos1 - 200 + cx
        a.mouse_move(x=gx, y=sy)
        a.step(3)
        check(a.eval("$('#star0').attr('picked')") is False,
              f"пикинг НЕ попадает в позицию игры ({gx:.0f},{sy:.0f})")

        # Игровое .at() не «съедается» и не двигает нарисованное больше чем на
        # сам сдвиг: после телепорта смещение начинается с нуля.
        a.eval("(() => { $('#star0').at(260, 80); })()")
        a.step(2)
        check(abs(a.eval("$('#star0').pos().x") - 260) < 2,
              "после .at(260) позиция игры = 260")
        check(abs(a.eval("$.layers.offset('#star0').x")) < 2,
              "после .at() смещение обнулилось (якорь камеры переехал)")

        # Снятие параллакса: позиция та же, смещение 0, нарисованное = позиция.
        a.eval("(() => { $('#star0').parallax(null); })()")
        a.step(2)
        check(abs(a.eval("$('#star0').pos().x") - 260) < 2,
              "parallax(null): позиция игры не изменилась")
        check(abs(a.eval("$.layers.offset('#star0').x")) < 1e-6,
              "parallax(null): смещение отрисовки = 0")

        errors = a.eval("JSON.stringify($.debug.errors())")
        check(errors in ("[]", "null"), f"ошибок игрового кода нет: {errors[:200]}")

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
