#!/usr/bin/env python3
# ===========================================================================
# Тест физики: формы тел (круг/капсула), односторонние платформы, события
# контакта (collide/separate/hit) и суставы (revolute/distance).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_physics_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "physics_ext")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=13) as a:
        # --- Формы тел --------------------------------------------------------
        check(a.eval("$('#ball').shape()") == "circle", "круг получил форму 'circle'")
        check(a.eval("$('#ball').get(0).body >= 0") is True, "у круга есть тело Box2D")
        check(a.eval("$('#capsule').shape()") == "capsule", "капсула получила форму 'capsule'")
        check(a.eval("$('#capsule').get(0).body >= 0") is True, "у капсулы есть тело")

        # --- Полёт и приземление ---------------------------------------------
        start_y = a.eval("$('#ball').pos().y")
        a.step(120)
        rest_y = a.eval("$('#ball').pos().y")
        check(start_y < rest_y, f"круг падает вниз ({start_y:.0f} → {rest_y:.0f})")
        # Земля: центр 400, высота 32 → верх на 384; радиус круга 12.
        check(abs(rest_y - 372) < 6, f"круг лежит на земле (y={rest_y:.1f}, ждём ~372)")

        # --- События контакта --------------------------------------------------
        landed = a.eval("$.store.get('landed')")
        check(landed is not None and landed >= 1, f"событие collide пришло ({landed})")
        check(a.eval("$('#ball').contacts()") is True, "у динамического тела контакты включены")
        hit_speed = a.eval("$.store.get('hitSpeed')")
        check(hit_speed is not None and hit_speed > 0,
              f"событие hit принесло скорость сближения ({hit_speed})")
        check(a.eval("$.world.contacts().length") >= 0, "$.world.contacts() доступен")

        # --- Односторонняя платформа ------------------------------------------
        check(a.eval("$('#oneway').oneWay()") is True, "платформа помечена односторонней")
        check(a.eval("$.store.get('throughUp')") is True,
              "мяч прошёл сквозь платформу снизу вверх")
        jumper_y = a.eval("$('#jumper').pos().y")
        # Платформа: центр 600, высота 20 → верх на 590; радиус мяча 10.
        check(abs(jumper_y - 580) < 8,
              f"мяч лёг СВЕРХУ платформы (y={jumper_y:.1f}, ждём ~580)")

        # --- Суставы -----------------------------------------------------------
        joint_id = a.eval("$.store.get('jointId')")
        check(joint_id is not None and joint_id >= 0, f"шарнир создан (id={joint_id})")
        check(a.eval("$.world.jointCount()") >= 2, "в мире два сустава")
        check(a.eval(f"$.world.jointAlive({joint_id})") is True, "шарнир жив")
        check(a.eval("$.store.get('distJoint')") >= 0, "дистанционный сустав создан")

        # Маятник висит ниже точки крепления.
        pend_y = a.eval("$('#pendulum').pos().y")
        check(pend_y > 240, f"маятник висит ниже якоря (y={pend_y:.1f})")
        check(abs(a.eval("$('#pendulum').pos().x") - 1200) < 40,
              "маятник не улетел по горизонтали")

        # Дистанционный сустав держит стержень: расстояние между телами
        # остаётся близким к исходным 120 px.
        dist = a.eval("(() => { const p = $('#bar1').pos(), q = $('#bar2').pos();"
                      " return Math.hypot(p.x - q.x, p.y - q.y); })()")
        check(60 < dist < 200, f"дистанционный сустав держит стержень ({dist:.0f} px)")

        # --- Уничтожение сустава ----------------------------------------------
        a.eval(f"$.world.destroyJoint({joint_id})")
        check(a.eval(f"$.world.jointAlive({joint_id})") is False, "сустав уничтожен")

        # --- Луч и сенсоры -----------------------------------------------------
        # Сенсор не должен останавливать луч (иначе зона-триггер блокирует
        # линию видимости и проверку «стою на земле»).
        check(a.eval("$.store.get('sensorBlocksRay')") is False,
              "сенсор не останавливает луч")
        check(a.eval("$.store.get('rayHitIsWall')") is True,
              "луч упирается в настоящую стену за сенсором")

        # --- Движок жив --------------------------------------------------------
        a.step(30)
        check(a.eval("engine.frame > 0") is True, "движок продолжает работать")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
