#!/usr/bin/env python3
# ===========================================================================
# Пример §31-1 Спецификации: «Platform foundations» (demos/foundations).
#
# Проверяется законченный сценарий, а не наличие методов: край платформы,
# склон, односторонние платформы и спрыгивание, перенос движущейся платформой,
# зоны камеры и чтение геймпада тем же API, что клавиатура.
#
# Запуск:
#   python3 tests/agent/foundations_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/foundations_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("demos", "foundations")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_of(a):
    return [line.strip() for line in a.stderr_text().splitlines()
            if "$: ошибка" in line or "[error]" in line]


def settle(a, frames=40):
    a.step(frames)


def place(a, x, y):
    """Поставить игрока в точку: тело синхронизируется на следующем кадре."""
    a.eval("void $('#hero').at(%f, %f).velocity(0, 0)" % (x, y))


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(20)
        check(a.eval("$.scene.current()") == "foundations", "сцена примера открылась")
        check(a.eval("$('#hero').length") == 1, "игрок создан")
        # Склон — полигонный треугольник (наклонная поверхность), а не лестница
        # из боксов: уступ в 4 px уже останавливает тело с трением.
        check(a.eval("$('.slope').length") >= 2, "склоны собраны (%s)" % a.eval("$('.slope').length"))
        check(a.eval("$('.slope').shape()") == "polygon", "склон — полигонная форма")
        check(a.eval("$('.oneway').length") >= 10, "односторонние платформы есть (%s)" % a.eval("$('.oneway').length"))
        check(a.eval("$('.mover').length") == 1, "движущаяся платформа есть")

        # --- Земля, ходьба, прыжок -------------------------------------------
        a.step(30)
        check(a.eval("$('#hero').onFloor()") is True, "игрок стоит на земле")
        x0 = a.eval("$('#hero').pos().x")
        a.keys(["D"]); a.step(30); a.keys([])
        x1 = a.eval("$('#hero').pos().x")
        check(x1 > x0 + 10, "игрок идёт вправо (%.0f → %.0f)" % (x0, x1))

        y0 = a.eval("$('#hero').pos().y")
        a.key("Space", "tap")
        top = y0
        for _ in range(14):
            a.step(1)
            top = min(top, a.eval("$('#hero').pos().y"))
        check(top < y0 - 4, "прыжок поднимает игрока (%.0f → %.0f)" % (y0, top))
        settle(a, 30)

        # --- Склон: подъём без застреваний -----------------------------------
        # Ставим игрока к подножию склона (клетка 7, нижний ряд) и идём вправо:
        # высота должна расти, а горизонтальная скорость — не падать до нуля
        # дольше одного кадра (иначе это застревание на ступени).
        # Клетка 7 — начало склона (/ занимает клетки 7..10, поднимаясь вправо).
        place(a, 5 * 32 + 16, 15 * 32)
        settle(a, 20)
        base_y = a.eval("$('#hero').pos().y")
        a.keys(["D"])
        stalled = 0
        heights = []
        for _ in range(70):
            a.step(1)
            pos = a.eval("$('#hero').pos()")
            heights.append(pos["y"])
            if abs(a.eval("$('#hero').velocity().x")) < 4:
                stalled += 1
        a.keys([])
        climbed = base_y - min(heights)
        check(climbed > 24, "игрок поднялся по склону (%.0f px)" % climbed)
        check(stalled <= 2, "на склоне не застревает (кадров без движения: %d)" % stalled)

        # --- Односторонняя платформа: держит сверху --------------------------
        # Платформа в клетке (14..19, 5) — падаем на неё сверху.
        a.eval("(() => { const n = $('.oneway').get(0); void $('#hero').at(n.x, n.y - 110).velocity(0, 0); })()")
        settle(a, 45)
        on_floor = a.eval("$('#hero').onFloor()")
        y_top = a.eval("$('#hero').pos().y")
        check(on_floor is True, "игрок стоит на односторонней платформе")

        # --- ... и пропускает снизу ------------------------------------------
        # Платформа ниже: её y — это центр тонкой плиты (h = 12), поэтому
        # ставим игрока прямо под ней и толкаем вверх. Односторонняя
        # поверхность не должна его останавливать.
        base = a.eval("(() => { const n = $('.oneway').get(0); return n.y + n.h / 2; })()")
        a.eval("(() => { const n = $('.oneway').get(0); void $('#hero').at(n.x, n.y + 20).velocity(0, -560); })()")
        a.step(2)
        highest = a.eval("$('#hero').pos().y")
        for _ in range(12):
            a.step(1)
            highest = min(highest, a.eval("$('#hero').pos().y"))
        check(highest < base, "игрок поднимается сквозь платформу снизу (минимум y=%.0f, низ плиты y=%.0f)"
              % (highest, base))
        settle(a, 50)

        # --- Спрыгивание вниз по S+Space -------------------------------------
        a.eval("(() => { const n = $('.oneway').get(0); void $('#hero').at(n.x, n.y - 110).velocity(0, 0); })()")
        settle(a, 45)
        check(a.eval("$('#hero').onFloor()") is True, "игрок снова на платформе")
        y_before_drop = a.eval("$('#hero').pos().y")
        a.keys(["S"]); a.key("Space", "tap"); a.step(2); a.keys([])
        settle(a, 30)
        y_after_drop = a.eval("$('#hero').pos().y")
        check(y_after_drop > y_before_drop + 4,
              "S+Space спрыгивает вниз (%.0f → %.0f)" % (y_before_drop, y_after_drop))

        # --- Перенос движущейся платформой ------------------------------------
        a.eval("(() => { const m = $('.mover').get(0); void $('#hero').at(m.x, m.y - 90).velocity(0, 0); })()")
        settle(a, 45)
        riding = a.eval("$('#hero').onFloor()")
        check(riding is True, "игрок стоит на движущейся платформе")
        hero_x0 = a.eval("$('#hero').pos().x")
        plat_x0 = a.eval("$('.mover').pos().x")
        a.step(40)
        hero_dx = a.eval("$('#hero').pos().x") - hero_x0
        plat_dx = a.eval("$('.mover').pos().x") - plat_x0
        check(abs(plat_dx) > 8, "платформа действительно двигалась (%.0f px)" % plat_dx)
        check(abs(hero_dx - plat_dx) < abs(plat_dx) * 0.35 + 6,
              "игрока несёт вместе с платформой (игрок %.0f, платформа %.0f)" % (hero_dx, plat_dx))

        # --- Зоны камеры ------------------------------------------------------
        # Зона entry: игрок слева; зона high: игрок у правого края.
        place(a, 96, 401)
        settle(a, 30)
        zone_entry = a.eval("$('#hud-zone').text()")
        zoom_entry = a.eval("$.camera.zoom()")
        limits_entry = a.eval("$.camera.limits()")
        place(a, 1250, 96)
        settle(a, 20)
        zone_high = a.eval("$('#hud-zone').text()")
        zoom_high = a.eval("$.camera.zoom()")
        limits_high = a.eval("$.camera.limits()")
        check(zone_entry == "Зона камеры: entry", "слева активна зона entry (%s)" % zone_entry)
        check(zone_high == "Зона камеры: high", "справа активна зона high (%s)" % zone_high)
        check(abs(zoom_entry - zoom_high) > 0.01,
              "зона меняет зум (%.2f → %.2f)" % (zoom_entry, zoom_high))
        check(limits_entry != limits_high, "зона меняет границы кадра")

        # --- Геймпад читается тем же API --------------------------------------
        check(a.eval("typeof $.input.padCount") == "function", "$.input.padCount() доступен")
        check(a.eval("typeof $.input.vec") == "function", "$.input.vec() — общий путь ввода")
        check(a.eval("$('#hud-pad').text().indexOf('Геймпадов')") == 0,
              "HUD показывает состояние геймпада: %s" % a.eval("$('#hud-pad').text()"))

        errors = errors_of(a)
        check(not errors, "в примере нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
