#!/usr/bin/env python3
# ===========================================================================
# §19 Спецификации: камера, комнаты и арбитраж управления.
#
# Приёмка §19 проверяется поведением, а не наличием методов:
#   * зона — это ДАННЫЕ поверх существующей камеры, а не вторая камера;
#   * конфликт зон решает priority, а не порядок объявления;
#   * аренда (cutscene) перебивает зону и возвращает РОВНО прежнюю конфигурацию;
#   * аренда с временем истекает сама;
#   * вход в зону не оставляет пустой край: границы считаются с зумом;
#   * world↔screen roundtrip и picking совпадают при зуме, повороте и после
#     смены зоны.
#
# Запуск:
#   python3 tests/agent/camera_zones_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/camera_zones_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "camera_zones")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def info(a):
    return json.loads(a.eval("JSON.stringify($.agent.snapshot().camInfo)"))


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(4)

        # --- Зона — это данные ------------------------------------------------
        zone = json.loads(a.eval("JSON.stringify($.camera.zone('well'))"))
        check(zone and zone.get("name") == "well", "зона описывается данными (%s)" % zone)
        check(a.eval("$.camera.zone('well', { priority: 7, zoom: 1.5 })") is True,
              "переопределение зоны возвращает признак, а не камеру")
        a.eval("$.camera.zone('well', { priority: 5, zoom: 1.25, x: 0, y: 700, w: 900, h: 800, follow: '#hero' })")

        # --- Вход в зону применяет зум и границы ------------------------------
        baseline = info(a)
        a.eval("$.camera.enter('well')")
        a.step(3)
        in_zone = info(a)
        check(abs(in_zone["zoom"] - 1.25) < 1e-6,
              "зона применила зум (%.2f → %.2f)" % (baseline["zoom"], in_zone["zoom"]))
        check(in_zone["limits"] and in_zone["limits"]["w"] == 900,
              "зона применила границы (%s)" % (in_zone["limits"],))
        check(in_zone["control"]["active"] and in_zone["control"]["active"]["name"] == "well",
              "управление камерой принадлежит зоне (%s)" % in_zone["control"]["active"])

        # --- Приоритет решает конфликт, а не порядок входа --------------------
        a.eval("$.camera.enter('hall')")     # priority 1, вошла ПОЗЖЕ
        a.step(2)
        after_hall = info(a)
        check(after_hall["control"]["active"]["name"] == "well",
              "зона с большим приоритетом остаётся активной (%s)" % after_hall["control"]["active"]["name"])
        check(abs(after_hall["zoom"] - 1.25) < 1e-6,
              "зум по-прежнему от приоритетной зоны (%.2f)" % after_hall["zoom"])

        # --- Аренда перебивает зону -------------------------------------------
        lease = a.eval("$.camera.lease({ owner: 'cutscene', priority: 50, zoom: 2.0, offset: [0, -30] })")
        a.step(2)
        in_lease = info(a)
        check(abs(in_lease["zoom"] - 2.0) < 1e-6,
              "аренда перебила зону (зум %.2f)" % in_lease["zoom"])
        check(in_lease["control"]["active"]["owner"] == "cutscene",
              "управление у аренды (%s)" % in_lease["control"]["active"])

        # --- Снятие аренды возвращает РОВНО прежнюю конфигурацию --------------
        a.eval("$.camera.release('cutscene')")
        a.step(2)
        back = info(a)
        check(abs(back["zoom"] - 1.25) < 1e-6,
              "после аренды зум вернулся (%.2f)" % back["zoom"])
        check(back["control"]["active"]["name"] == "well",
              "после аренды управление у зоны (%s)" % back["control"]["active"]["name"])

        # --- Аренда со временем истекает сама ---------------------------------
        a.eval("$.camera.lease({ owner: 'death', priority: 40, zoom: 1.7, ms: 150 })")
        a.step(2)
        check(abs(info(a)["zoom"] - 1.7) < 1e-6, "аренда со временем применилась")
        a.step(15)
        check(abs(info(a)["zoom"] - 1.25) < 1e-6,
              "аренда истекла и вернула зону (зум %.2f)" % info(a)["zoom"])
        check(info(a)["control"]["active"]["name"] == "well",
              "после истечения управление снова у зоны")

        # --- Зона, где цель находится сейчас -----------------------------------
        a.eval("$('#hero').at(1500, 1100)")
        a.step(3)
        inside = a.eval("$.camera.enter()")
        a.step(2)
        check(bool(inside), "вход без имени находит зону по позиции цели (%s)" % inside)
        check(info(a)["control"]["active"]["name"] == "hall",
              "найдена горизонтальная комната (%s)" % info(a)["control"]["active"]["name"])
        check(abs(info(a)["zoom"] - 0.8) < 1e-6,
              "зум горизонтальной комнаты (%.2f)" % info(a)["zoom"])

        # --- Выход из зон возвращает исходную камеру ---------------------------
        a.eval("$.camera.release()")     # все аренды и зоны
        a.step(2)
        reset = info(a)
        check(reset["control"]["active"] is None, "после release() управление свободно")
        check(abs(reset["zoom"] - baseline["zoom"]) < 1e-6,
              "зум вернулся к исходному (%.2f)" % reset["zoom"])

        # --- Roundtrip world↔screen при зуме и повороте ------------------------
        a.eval("$.camera.zoom(1.6); $.camera.rotation(0.4); $.camera.at(500, 400)")
        a.step(2)
        rt = a.eval("""(() => {
            const w = { x: 640, y: 360 };
            const s = $.camera.worldToScreen(w);
            const back = $.camera.screenToWorld(s);
            return { dx: Math.abs(back.x - w.x), dy: Math.abs(back.y - w.y) };
        })()""")
        check(rt["dx"] < 1e-6 and rt["dy"] < 1e-6,
              "world↔screen roundtrip при зуме и повороте (dx=%s dy=%s)" % (rt["dx"], rt["dy"]))

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
