#!/usr/bin/env python3
# ===========================================================================
# Встроенное управление платформера: coyote time, jump buffer, переменная
# высота прыжка (jump cut), запрет повторного прыжка при зажатой кнопке,
# спрыгивание с односторонней платформы (S/↓+Space и .dropThrough()) и перенос
# игрока движущейся кинематической платформой.
#
# Фикстура: tests/fixtures/controls_plat/main.js. Полки разнесены по уровню,
# так что каждый узел проверяется независимо, а клавиши — общие (как в игре).
#
# Запуск:
#   python3 tests/agent/highlevel_controls_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "controls_plat")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def pos_y(a, sel):
    return a.eval(f"$('{sel}').pos().y")


def main():
    with Agent(game=GAME, seed=5) as a:
        # =====================================================================
        # 1. Jump buffer: нажатие в воздухе за пару кадров до земли.
        # =====================================================================
        # 'buffer' и 'nobuffer' падают с одной высоты и синхронны: нажатие
        # делаем, когда оба ещё в воздухе (порог выше места приземления).
        a.step(2)
        for _ in range(200):
            a.step(1)
            if pos_y(a, "#buffer") > 600:
                break
        y_tap = pos_y(a, "#buffer")
        y_shadow = pos_y(a, "#nobuffer")
        check(abs(y_tap - y_shadow) < 2, f"падение синхронно ({y_tap:.0f} / {y_shadow:.0f})")

        a.key("Space", "tap")
        a.step(10)
        y_buf = pos_y(a, "#buffer")
        y_nobuf = pos_y(a, "#nobuffer")
        check(y_buf < 640, f"буфер прыжка: нажатие в воздухе сработало при landing (y={y_buf:.0f})")
        check(y_nobuf > 660, f"без буфера нажатие в воздухе потеряно (y={y_nobuf:.0f})")

        # =====================================================================
        # 2. Переменная высота прыжка и сила из .attr('jumpForce').
        # =====================================================================
        a.release_all()
        a.step(60)
        check(a.eval("$('#tall').onFloor()") is True, "tall стоит на земле")
        rest_tall = pos_y(a, "#tall")
        rest_cut = pos_y(a, "#cut")

        a.key("Space", "tap")
        min_tall, min_cut = rest_tall, rest_cut
        for _ in range(30):
            a.step(1)
            y_t = pos_y(a, "#tall")
            y_c = pos_y(a, "#cut")
            if y_t < min_tall:
                min_tall = y_t
            if y_c < min_cut:
                min_cut = y_c
        rise_tall = rest_tall - min_tall
        rise_cut = rest_cut - min_cut
        # При jumpForce = 900 и g = 1800 полный прыжок поднимает на 225 px.
        check(rise_tall > 150,
              f"jumpForce из .attr() работает: подъём {rise_tall:.0f} px (ждали > 150)")
        check(rise_cut < 60, f"jumpCut обрезает прыжок по отпусканию: {rise_cut:.0f} px")
        check(rise_tall - rise_cut > 100,
              f"высота прыжка переменная ({rise_tall:.0f} против {rise_cut:.0f})")

        # =====================================================================
        # 3. Запрет повторного прыжка при зажатой кнопке.
        # =====================================================================
        a.release_all()
        a.step(60)
        check(a.eval("$('#hold').onFloor()") is True, "hold стоит на земле")
        jumps0 = a.eval("$.store.get('jumps')") or 0
        a.keys(["Space"])          # держим кнопку: одно нажатие, прыжок один
        a.step(80)
        a.release_all()
        a.step(10)
        jumps1 = a.eval("$.store.get('jumps')") or 0
        check(jumps1 - jumps0 == 1,
              f"зажатая кнопка даёт ровно один прыжок ({jumps1 - jumps0})")
        check(a.eval("$('#hold').onFloor()") is True, "hold вернулся на землю")

        # =====================================================================
        # 4. Спрыгивание с односторонней платформы.
        # =====================================================================
        a.step(10)
        y_drop0 = pos_y(a, "#dropper")
        check(a.eval("$('#dropper').onFloor()") is True,
              f"dropper стоит на односторонней платформе (y={y_drop0:.0f})")

        a.keys(["S"])
        a.key("Space", "tap")
        a.step(1)
        flag = a.eval("engine.oneWayIgnore($('#dropper').get(0).body)")
        check(flag is True, "флаг «игнорировать one-way» поднят")
        a.step(24)
        a.release_all()
        y_drop1 = pos_y(a, "#dropper")
        check(y_drop1 > y_drop0 + 40,
              f"S+Space проваливает сквозь платформу ({y_drop0:.0f} → {y_drop1:.0f})")
        check(a.eval("engine.oneWayIgnore($('#dropper').get(0).body)") is False,
              "флаг «игнорировать one-way» снят после провала")
        a.step(60)
        check(a.eval("$('#dropper').onFloor()") is True, "dropper приземлился на нижний пол")
        y_floor = pos_y(a, "#dropper")
        check(840 < y_floor < 900, f"dropper ниже платформы (y={y_floor:.0f}, ждём ~869)")

        # Явный вызов метода: платформа не отвечает на клавиши (dropThrough: false).
        y_man0 = pos_y(a, "#manual")
        check(a.eval("$('#manual').onFloor()") is True,
              f"manual стоит на односторонней платформе (y={y_man0:.0f})")
        a.eval("$('#manual').dropThrough()")
        a.step(30)
        y_man1 = pos_y(a, "#manual")
        check(y_man1 > y_man0 + 40,
              f".dropThrough() проваливает сквозь платформу ({y_man0:.0f} → {y_man1:.0f})")

        # =====================================================================
        # 5. Перенос движущейся платформой.
        # =====================================================================
        # Трение платформы 0.02: без переноса игрок сдвинулся бы на единицы
        # пикселей, с переносом — вместе с платформой.
        a.release_all()
        a.step(20)
        check(a.eval("$('#rider').onFloor()") is True, "rider стоит на платформе")
        lift0 = a.eval("$('#lift').pos()")
        rider0 = a.eval("$('#rider').pos()")
        a.step(40)
        lift1 = a.eval("$('#lift').pos()")
        rider1 = a.eval("$('#rider').pos()")
        dl = lift1["x"] - lift0["x"]
        dr = rider1["x"] - rider0["x"]
        check(abs(dl) > 30, f"платформа действительно едет ({dl:.0f} px за 40 кадров)")
        check(abs(dr - dl) < 25,
              f"rider переносится платформой (игрок {dr:.0f} px, платформа {dl:.0f} px)")
        # Игрок не «утонул» в платформе: центр ниже её верха на полсуммы высот.
        gap = rider1["y"] - (lift1["y"] - 10)
        check(abs(gap + 15) < 8, f"rider стоит на поверхности, а не внутри (зазор {gap:.0f})")

        # =====================================================================
        # 6. Coyote time.
        # =====================================================================
        def walk_off(a, sel, key, limit=120):
            """Идти в сторону, пока onFloor не станет ложным, и дождаться
            настоящего падения (луч пропадает на кадр раньше, чем тело
            реально теряет опору)."""
            a.keys([key])
            for _ in range(limit):
                a.step(1)
                if a.eval(f"$('{sel}').onFloor()") is False:
                    break
            else:
                return False
            for _ in range(8):
                if a.eval(f"$('{sel}').velocity().y") > 30:
                    return True
                a.step(1)
            return a.eval(f"$('{sel}').velocity().y") > 30

        a.release_all()
        a.step(10)
        check(a.eval("$('#coyote').onFloor()") is True, "coyote стоит на полке")
        check(walk_off(a, "#coyote", "D"), "coyote сошёл с полки и падает")
        a.key("Space", "tap")
        a.step(1)
        vy = a.eval("$('#coyote').velocity().y")
        check(vy < -200, f"coyote: прыжок после схода с платформы (vy={vy:.0f})")

        # Контроль: та же ситуация без coyote — прыжка нет.
        a.release_all()
        a.step(60)
        check(a.eval("$('#nocoyote').onFloor()") is True, "nocoyote стоит на полке")
        check(walk_off(a, "#nocoyote", "A"), "nocoyote сошёл с полки и падает")
        a.key("Space", "tap")
        a.step(1)
        vy2 = a.eval("$('#nocoyote').velocity().y")
        check(vy2 > 0, f"без coyote прыжок в воздухе не срабатывает (vy={vy2:.0f})")

        # =====================================================================
        # Движок жив.
        # =====================================================================
        # 7. §8: контракт опоры — данные, скорость опоры, склон, потолок,
        #    внешняя скорость (урон/отдача не стираются управлением).
        # =====================================================================
        a.release_all()
        a.step(90)   # все прыжки от общих Space из прошлых секций должны завершиться

        g = a.eval("$('#ext').ground()")
        check(isinstance(g, dict) and g.get("on") is True, "ground() отдаёт данные опоры")
        check(isinstance(g, dict) and abs(g.get("slope", 1)) < 0.01,
              f"ровная земля: slope ≈ 0 (получено {(g or {}).get('slopeDegrees', -1):.1f}°)")
        check(isinstance(g, dict) and abs(g.get("vx", 9)) < 1 and abs(g.get("vy", 9)) < 1,
              "неподвижная опора: её скорость 0")
        check(isinstance(g, dict) and g.get("node") is not None, "у опоры есть узел")

        gv = a.eval("Math.abs($('#rider').ground().vx)")
        check(gv is not None and gv > 50,
              f"движущаяся опора сообщает свою скорость ({gv:.0f} px/с)")

        # Кладём узлы точно на 30° склон (лучом, а не «на глаз»): гравитация у
        # них выключена, поэтому положение детерминировано, а проверяется
        # контракт опоры и лимит угла поверхности.
        placed = a.eval("""(() => {
            const put = (nodeSel, slopeSel) => {
                const s = $('#' + slopeSel).get(0);
                // Луч идёт по центру склона; самого ставящего узла в нём быть не
                // должно, иначе он найдёт собственное тело.
                const hit = $.world.raycast({ x: s.x, y: s.y - 200 }, { x: s.x, y: s.y + 200 },
                                            { ignore: ['#' + nodeSel] });
                if (!hit) return false;
                const n = hit.normal, k = 16;
                // Нормаль луча смотрит НАРУЖУ поверхности — узел ставим вдоль неё.
                $('#' + nodeSel).at(hit.point.x + n.x * k, hit.point.y + n.y * k);
                return true;
            };
            return put('slope-plain', 'slope-a') && put('slope-limit', 'slope-b');
        })()""")
        check(placed is True, "узлы поставлены на 30° склон")
        a.step(3)
        sg = a.eval("$('#slope-plain').ground()")
        check(isinstance(sg, dict) and 25 < sg.get("slopeDegrees", 0) < 35,
              f"ground() видит угол склона ({(sg or {}).get('slopeDegrees', -1):.1f}°)")
        check(a.eval("$('#slope-plain').get(0).attrs.on_ground") is True,
              "без лимита склон — земля")
        check(a.eval("$('#slope-limit').get(0).attrs.on_ground") is False,
              "maxSlope 10°: склон не считается землёй (не прыгнуть)")

        check(a.eval("$('#ceil').onCeiling()") is True, "onCeiling(): потолок найден")
        check(a.eval("$('#tall').onCeiling()") is False, "onCeiling(): открытый верх — false")

        # Внешняя скорость: узел едет без ввода, затем останавливается — и
        # управление её не стирает в следующем тике.
        a.step(30)
        ext0 = a.eval("$('#ext').pos().x")
        a.eval("$('#ext').externalVelocity(300, 0, 250)")
        a.step(10)
        ext1 = a.eval("$('#ext').pos().x")
        check(ext1 - ext0 > 15, f"externalVelocity двигает узел без ввода ({ext1 - ext0:.0f} px)")
        check(a.eval("$('#ext').externalVelocity()") is not None, "канал внешней скорости читается")
        a.step(45)
        ext2 = a.eval("$('#ext').pos().x")
        check(abs(ext2 - ext1) < 8, f"внешняя скорость затухает и отпускает ({ext2 - ext1:.0f} px)")

        # =====================================================================
        a.release_all()
        a.step(10)
        check(a.eval("engine.frame > 0") is True, "движок продолжает работать")

        if FAILURES:
            print(a.stderr_tail(15))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
