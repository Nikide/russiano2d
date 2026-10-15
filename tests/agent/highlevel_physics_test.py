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
        check(isinstance(a.eval("$.world.contacts()"), list), "$.world.contacts() доступен")

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
        check(a.eval("$.store.get('rayNearestIsFirst')") is True,
              "без ignore луч попадает в ближайшую стену")
        check(a.eval("$.store.get('rayIgnoreSkipsFirst')") is True,
              "ignore пропускает первую стену и находит вторую")
        check(a.eval("$.store.get('rayIgnoreAllNull')") is True,
              "ignore всех стен даёт null, а не исключение")

        # --- §7. Устойчивые контакты и формы -----------------------------------
        # Вырожденный контур: тела НЕТ, и это видно машине, а не только в логе.
        bad = a.eval("""(() => {
            const n = $('<rect>', { id: '__bad' }).at(2500, 300).size(40, 40)
                .body('dynamic').appendTo($.world);
            n.shape('polygon', [0, 0, 0, 0, 0, 0]);
            const body = n.get(0).body;
            n.remove();
            return body;
        })()""")
        check(bad == -1, "вырожденный полигон: тело не создано (без подмены прямоугольником)")
        errs = a.eval("$.physics.errors()")
        check(isinstance(errs, dict) and any(e.get("code") == "shape_invalid" for e in errs.get("errors", [])),
              "ошибка формы видна машине через $.physics.errors()")

        # Сенсор: контактной нормали у него НЕТ — нулевой вектор не выдумываем.
        a.eval("""(() => {
            $.store.set('sensorSeen', null);
            const z = $('<rect>', { id: '__sens' }).at(2600, 500).size(80, 80)
                .body('static').appendTo($.world);
            z.sensor(true).contacts(true);
            z.on('collide', (e) => {
                if (!$.store.get('sensorSeen')) {
                    $.store.set('sensorSeen', { hasNormal: e.data.hasNormal, nx: e.data.nx,
                                                sensor: e.data.sensor });
                }
            });
            $('<circle>', { id: '__sball' }).at(2600, 250).size(16, 16)
                .collisionCircle(8).body('dynamic').velocity(0, 400).appendTo($.world);
            return true;
        })()""")
        a.step(40)
        seen = a.eval("$.store.get('sensorSeen')")
        check(seen is not None and seen.get("hasNormal") is False
              and seen.get("nx") is None and seen.get("sensor") is True,
              f"сенсор: контакт без выдуманной нормали ({seen})")

        # Фаза stay — opt-in и приходит, пока касание продолжается.
        a.eval("""(() => {
            $.store.set('stays', 0);
            $('<wall>', { id: '__stay-g' }).at(2900, 700).size(200, 32).appendTo($.world);
            const b = $('<circle>', { id: '__stay-b' }).at(2900, 600).size(16, 16)
                .collisionCircle(8).body('dynamic').velocity(0, 300).appendTo($.world);
            b.contacts(true, { stay: true });
            b.on('stay', () => $.store.set('stays', ($.store.get('stays') || 0) + 1));
            return true;
        })()""")
        a.step(60)
        stays = a.eval("$.store.get('stays')") or 0
        check(stays >= 5, f"stay-события идут, пока тело касается ({stays})")

        # Поколение тела: id переиспользуется, но события не путаются.
        gen = a.eval("""(() => {
            const b1 = engine.createBody({ x: -900, y: -900, halfW: 8, halfH: 8, type: engine.DYNAMIC });
            const g1 = engine.bodyGeneration(b1);
            engine.destroyBody(b1);
            const b2 = engine.createBody({ x: -900, y: -900, halfW: 8, halfH: 8, type: engine.DYNAMIC });
            const g2 = engine.bodyGeneration(b2);
            engine.destroyBody(b2);
            return { g1: g1, g2: g2 };
        })()""")
        check(gen.get("g2") > gen.get("g1"),
              f"поколение тела растёт при переиспользовании id ({gen})")

        # --- Движок жив --------------------------------------------------------
        a.step(30)
        check(a.eval("engine.frame > 0") is True, "движок продолжает работать")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
