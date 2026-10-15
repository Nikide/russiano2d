#!/usr/bin/env python3
# ===========================================================================
# Слежение камеры платформера в движке: deadzone, lookahead, limits, margin.
#
# Юнит-тесты (tests/js/camera_test.mjs) проверяют математику без движка.
# Здесь — то, что видно только в кадре: настройки из follow() реально доходят
# до камеры и переживают кадровый цикл (раньше `deadzone` в follow() молча
# терялся, а lookahead не существовал вовсе).
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_camera_deadzone_test.py
# ===========================================================================

import json
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


def pos(a):
    return json.loads(a.eval("JSON.stringify($.camera.pos())"))


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.eval("""
            $('#world').remove(); $('#hud').remove(); $('#go').remove();
            $.world.gravity(0, 0).color('#101820').bounds(-100000, 0, 200000, 600);
            $('<sprite>', { id: 'runner', w: 16, h: 16 }).at(400, 300).appendTo($.world);
            $.camera.at(400, 300);
            $.camera.follow('#runner', { smooth: 0, deadzone: [80, 60] });
            globalThis.__dir = 0;   // 0 — стоит, ±1 — едет вправо/влево
            $.update((dt) => { $('#runner').move(240 * dt * globalThis.__dir, 0); });
        """)
        a.step(2)
        check(a.eval("JSON.stringify($.camera.deadzone())") == '{"w":80,"h":60}',
              "follow({ deadzone }) дошёл до камеры")
        check(abs(pos(a)["x"] - 400) < 1e-4, "камера на цели")

        # Цель внутри зоны: камера стоит (половина зоны 40 по X, 30 по Y).
        a.eval("$('#runner').at(430, 325)")
        a.step(2)
        check(abs(pos(a)["x"] - 400) < 1e-4 and abs(pos(a)["y"] - 300) < 1e-4,
              f"цель в мёртвой зоне — камера не двигается ({pos(a)})")

        # Цель вышла из зоны: камера встаёт на её край.
        a.eval("$('#runner').at(500, 300)")
        a.step(2)
        check(abs(pos(a)["x"] - 460) < 1e-4,
              f"за зоной камера встаёт на край (ожидалось 460, получено {pos(a)['x']})")

        # lookahead: движущаяся цель уезжает за камеру вперёд по движению.
        # Мёртвую зону выключаем: внутри неё камера стоит по определению и
        # вынос был бы не виден.
        a.eval("$.camera.deadzone(false).at(500, 300).lookahead(64); globalThis.__dir = 1;")
        a.step(1)                       # кадр смены настроек
        leads = []
        for _ in range(4):
            a.step(1)
            leads.append(a.eval("$.camera.x() - $('#runner').pos().x"))
        growing = all(0 < v < 64 for v in leads) and leads == sorted(leads)
        check(growing, f"вынос растёт постепенно, а не рывком: {[round(v, 2) for v in leads]}")
        a.step(26)
        lead = a.eval("$.camera.x() - $('#runner').pos().x")
        check(50 < lead <= 64, f"камера смотрит вперёд: вынос {lead:.2f} px из 64")

        # Разворот: вынос меняет знак, камера не «улетает».
        a.eval("globalThis.__dir = -1")
        a.step(40)
        lead = a.eval("$.camera.x() - $('#runner').pos().x")
        check(-64 <= lead < -10, f"после разворота вынос с другой стороны: {lead:.2f} px")
        a.eval("globalThis.__dir = 0; $.camera.lookahead(0)")

        # limits: камера не выезжает за границы уровня.
        view = json.loads(a.eval("JSON.stringify($.gfx.size())"))
        a.eval("$.camera.unfollow(); $.camera.at(0, 0); $.camera.limits(0, 0, 1000, %f)" % view["h"])
        a.step(1)
        p = pos(a)
        check(abs(p["x"] - view["w"] / 2) < 1e-4 and abs(p["y"] - view["h"] / 2) < 1e-4,
              f"at(0,0) прижат границами к половине окна ({p})")
        a.eval("$.camera.zoom(2).at(9999, 9999)")
        a.step(1)
        check(a.eval("$.camera.limits()") is not None, "limits() — геттер")
        check(abs(pos(a)["x"] - 800) < 1e-4, f"зум расширил доступный диапазон ({pos(a)})")
        a.eval("$.camera.zoom(1).limits(null)")

        # isOnScreen: запас margin (раньше запас 64 был жёстко зашит).
        a.eval("$.camera.at(400, 300)")
        a.eval("$('#runner').at(840, 300)")
        a.step(1)
        check(a.eval("$.camera.isOnScreen('#runner')") is True, "узел у края виден с запасом 64")
        check(a.eval("$.camera.isOnScreen('#runner', 0)") is False, "без запаса узел уже за кадром")

        check(a.ping().get("pong") is True, "движок жив после работы с камерой")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
