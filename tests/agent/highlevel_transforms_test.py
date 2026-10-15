#!/usr/bin/env python3
# ===========================================================================
# §39 функциональные 2D local/world transforms и §40 независимые sensors.
#
# Приёмка §39: персонаж (100,200) → pivot (10,0) → child marker (20,0) даёт
# верный мировой point до и после flip и поворота; camera zoom/rotation этот
# point не меняет; старый проект с world-space children выглядит как раньше;
# локальный ребёнок едет за физическим родителем; C- и JS-проходы совпадают.
#
# Приёмка §40: movement capsule, contact circle и weapon rect одного владельца
# работают независимо; выключение sword sensor не отключает движение; форма
# пересобирается (пересоздание тела) без потери области; цель, уже стоящая
# внутри при открытии окна, находится через areaOverlap; дедупликация попаданий
# по окну атаки пересборкой формы не сбрасывается; после destroy/re-enable нет
# stale-попаданий.
#
# Запуск после сборки:
#   python3 tools/run_tests.py highlevel_transforms_test
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def near(a, b, eps=1e-6):
    return abs(a - b) <= eps


def point(value):
    """(x, y) из ответа агента: словарь, список или None."""
    if value is None:
        return (None, None)
    if isinstance(value, dict):
        return (value.get("x"), value.get("y"))
    return (value[0], value[1])


def main():
    fixture = os.path.join("tests", "fixtures", "transforms")
    with Agent(game=fixture, seed=5) as a:
        a.step(2)

        # --- §39: композиция по цепочке ------------------------------------
        x, y = point(a.eval("$('#marker').worldPoint(0,0)"))
        check(near(x, 130) and near(y, 200),
              f"§39 hero(100,200)+pivot(10,0)+marker(20,0) → world point (130,200), получено ({x},{y})")

        x, y = point(a.eval("$('#muzzle').worldPoint(0,0)"))
        check(near(x, 130) and near(y, 200),
              f"§39 оружие (10,0) + дуло (20,0) совпадает с маркером, получено ({x},{y})")

        # --- §39: flip ------------------------------------------------------
        x, y = point(a.eval("$('#hero').flip(true); $('#marker').worldPoint(0,0)"))
        check(near(x, 70) and near(y, 200),
              f"§39 после flip знаковый сдвиг -30 → (70,200), получено ({x},{y})")
        x, y = point(a.eval("$('#pivot').worldPoint(0,0)"))
        check(near(x, 90) and near(y, 200),
              f"§39 pivot после flip → (90,200), получено ({x},{y})")

        # --- §39: поворот ---------------------------------------------------
        x, y = point(a.eval("$('#hero').flip(false).angle(Math.PI/2); $('#marker').worldPoint(0,0)"))
        check(near(x, 100) and near(y, 230),
              f"§39 поворот на 90° → (100,230), получено ({x},{y})")

        x, y = point(a.eval("$('#hero').flip(true).angle(Math.PI/2); $('#marker').worldPoint(0,0)"))
        check(near(x, 100) and near(y, 170),
              f"§39 flip + поворот вместе → (100,170), получено ({x},{y})")
        mx, my = point(a.eval("$('#muzzle').worldPoint(0,0)"))
        check(near(mx, x) and near(my, y),
              f"§39 оружие и hitbox-маркер совпадают после flip+rotation: ({mx},{my})")

        a.eval("$('#hero').flip(false).angle(0)")
        x, y = point(a.eval("$('#marker').worldPoint(0,0)"))
        check(near(x, 130) and near(y, 200), "§39 возврат к исходному виду → (130,200)")

        # --- §39: камера не участвует в world point -------------------------
        x, y = point(a.eval("$.camera.zoom(2.5).rotation(0.6); $('#marker').worldPoint(0,0)"))
        check(near(x, 130) and near(y, 200),
              f"§39 camera zoom/rotation не меняет world point, получено ({x},{y})")
        gx, gy = point(a.eval("$('#marker').globalPos()"))
        check(not (near(gx, 130) and near(gy, 200)),
              f"§39 .globalPos() остаётся экранным (камерным): ({gx},{gy})")
        a.eval("$.camera.zoom(1).rotation(0)")

        # --- §39: world-space children (совместимость) ----------------------
        a.eval("$('#hero').at(700, 700)")
        x, y = point(a.eval("$('#ws_child').pos()"))
        check(near(x, 500) and near(y, 500),
              f"§39 world-space ребёнок не тянется родителем: ({x},{y})")
        x, y = point(a.eval("$('#marker').worldPoint(0,0)"))
        check(near(x, 730) and near(y, 700),
              f"§39 локальный ребёнок поехал с родителем: ({x},{y})")
        a.eval("$('#hero').at(100, 200)")

        # --- §39: .at() на локальном узле остаётся мировым -------------------
        x, y = point(a.eval("$('#marker').at(500, 400); $('#marker').worldPoint(0,0)"))
        check(near(x, 500) and near(y, 400),
              f"§39 .at() у локального узла задаёт мировую точку: ({x},{y})")
        a.eval("$('#marker').localAt(20, 0)")

        # --- §39: локальный ребёнок следует за физическим родителем ---------
        # Прогон движения — в стороне от статичной цели, чтобы её не толкать.
        a.eval("$('#fighter').at(400, 600)")
        a.eval("$('<rect>', {id:'rig'}).size(4,4).appendTo($('#fighter'))"
               ".transformSpace('local').localAt(20, 0)")
        a.step(1)
        f0 = point(a.eval("$('#fighter').pos()"))
        r0 = point(a.eval("$('#rig').pos()"))
        a.eval("$('#fighter').velocity(120, 0)")
        a.step(30)
        f1 = point(a.eval("$('#fighter').pos()"))
        r1 = point(a.eval("$('#rig').pos()"))
        check(f1[0] - f0[0] > 10, f"§39 тело реально сдвинулось физикой: {f1[0] - f0[0]:.1f} px")
        check(near(r1[0] - f1[0], 20, 0.5) and near(r1[1] - f1[1], 0, 0.5),
              f"§39 локальный ребёнок едет за телом с тем же смещением 20 px "
              f"({r1[0] - f1[0]:.3f})")
        a.eval("$('#fighter').velocity(0, 0).at(400, 300)")
        a.step(2)

        # --- §39: нативный проход и JS-резерв дают одно и то же -------------
        a.eval("$('#hero').flip(true).angle(0.4)")
        a.eval("$.debug.nativePasses(true)")
        a.step(1)
        nat = point(a.eval("$('#marker').worldPoint(0,0)"))
        a.eval("$.debug.nativePasses(false)")
        a.step(1)
        js = point(a.eval("$('#marker').worldPoint(0,0)"))
        check(near(nat[0], js[0], 1e-6) and near(nat[1], js[1], 1e-6),
              f"§39 C-проход и JS-проход совпадают: C({nat[0]:.6f},{nat[1]:.6f}) "
              f"JS({js[0]:.6f},{js[1]:.6f})")
        a.eval("$.debug.nativePasses(true)")
        a.eval("$('#hero').flip(false).angle(0)")

        # --- §39: внешняя запись мирового трансформа -------------------------
        # Нативный твин пишет x/y/angle напрямую, мимо JS-сеттеров: проход
        # принимает такую запись как МИРОВУЮ и пересчитывает её в локальные
        # поля — иначе локальный узел молча вернулся бы назад.
        a.eval("$('#marker').localAt(20, 0).localAngle(0)")
        a.step(1)
        a.eval("$('#marker').tween({ x: 300, y: 200 }, 200)")
        a.step(25)
        wx, wy = point(a.eval("$('#marker').worldPoint(0,0)"))
        local = a.eval("$('#marker').localAt()")
        check(near(wx, 300, 1e-3) and near(wy, 200, 1e-3),
              f"§39 нативный твин мирового x/y доводит локальный узел: ({wx},{wy})")
        check(near(local["x"], 190, 1e-3),
              f"§39 внешняя запись пересчитана в локальные координаты: local_x={local['x']}")
        a.eval("$('#marker').localAt(20, 0).localAngle(0)")
        a.step(1)

        # --- §39+§40: дочерний сенсор следует flip/повороту родителя ---------
        # У узла с телом точка приходит через физику (пиксели ↔ метры float32),
        # поэтому допуск здесь — 1e-3 px, а не машинная точность.
        x, y = point(a.eval("$('#sword_sensor').worldPoint(0,0)"))
        check(near(x, 120, 1e-3) and near(y, 200, 1e-3),
              f"§40 child sensor при hero(100,200) и localAt(20,0) → (120,200), получено ({x},{y})")
        sx, sy = point(a.eval("$('#sword_sensor').pos()"))
        check(near(sx, 120, 1e-3) and near(sy, 200, 1e-3),
              f"§39 тело child sensor стоит в мировой точке: ({sx},{sy})")
        check(a.eval("$.world.bodyAt(120, 200).toArray().length") >= 1,
              "§39+§40 тело сенсора действительно в мировой точке (запрос физики)")
        x, y = point(a.eval("$('#hero').flip(true); $('#sword_sensor').worldPoint(0,0)"))
        check(near(x, 80, 1e-3) and near(y, 200, 1e-3),
              f"§40 flip родителя зеркалит child sensor → (80,200), получено ({x},{y})")
        check(a.eval("$.world.bodyAt(80, 200).toArray().length") >= 1,
              "§39+§40 после flip тело сенсора переставлено физикой")
        x, y = point(a.eval("$('#hero').flip(false).angle(Math.PI/2);"
                            "$('#sword_sensor').worldPoint(0,0)"))
        check(near(x, 100, 1e-3) and near(y, 220, 1e-3),
              f"§40 поворот родителя вращает child sensor → (100,220), получено ({x},{y})")
        a.eval("$('#hero').angle(0)")

        # --- §40: независимые области одного владельца ----------------------
        areas = a.eval("$('#fighter').areas()")
        names = sorted([area["name"] for area in areas])
        check(names == ["bump", "contact", "sword"],
              f"§40 у владельца три независимые области: {names}")
        check(a.eval("$('#fighter').shape()") == "capsule",
              "§40 движение — основная капсула тела (.shape('capsule'))")
        roles = {area["name"]: area["role"] for area in areas}
        check(roles.get("sword") == "attack" and roles.get("contact") == "contact",
              f"§40 у областей свои роли: {roles}")

        check(a.eval("$('#fighter').areaOn('sword')") is False,
              "§40 sword sensor по умолчанию выключен (окно закрыто)")
        check(a.eval("$('#fighter').areaOverlap('sword').length") == 0,
              "§40 выключенная область никого не находит")
        check(a.eval("$('#fighter').areaOverlap('contact').length") == 0,
              "§40 контактный круг не находит цель вне своего радиуса")

        # --- §40: выключение оружия не отключает движение -------------------
        a.eval("$('#fighter').at(400, 600)")
        a.step(2)
        before = point(a.eval("$('#fighter').pos()"))[0]
        a.eval("$('#fighter').velocity(120, 0)")
        a.step(20)
        after = point(a.eval("$('#fighter').pos()"))[0]
        check(after - before > 10,
              f"§40 при выключенном sword движение работает: +{after - before:.1f} px")
        a.eval("$('#fighter').velocity(0, 0).at(400, 300)")
        a.step(2)

        # --- §40: окно атаки находит цель, уже стоящую внутри ---------------
        first = a.eval("$.attack.open(); $('#fighter').areaOn('sword', true);"
                       "$.attack.sweep('#fighter','sword')")
        check(len(first) == 1,
              f"§40 цель, уже стоящая внутри, найдена при открытии окна без движения: {first}")
        again = a.eval("$.attack.sweep('#fighter','sword')")
        check(again == [],
              f"§40 дедупликация по окну атаки: повторный sweep пуст {again}")

        # --- §40: пересоздание native-формы не сбрасывает дедупликацию -------
        index_before = a.eval("$('#fighter').area('sword').index")
        enabled_before = a.eval("$('#fighter').areaOn('sword')")
        a.eval("$('#fighter').size(30, 42)")     # setBody → формы уничтожены и собраны заново
        a.step(2)
        index_after = a.eval("$('#fighter').area('sword').index")
        check(index_after >= 1 and a.eval("$('#fighter').areaOn('sword')") == enabled_before,
              f"§40 после пересоздания тела область жива: индекс {index_before}→{index_after}, "
              f"enabled={enabled_before}")
        check(a.eval("$('#fighter').areaOverlap('sword').length") == 1,
              "§40 пересозданная форма по-прежнему накрывает цель")
        check(a.eval("$.attack.sweep('#fighter','sword')") == [],
              "§40 пересборка native-формы НЕ сбрасывает дедупликацию окна")

        # --- §40: новое окно находит цель снова ------------------------------
        fresh = a.eval("$.attack.open(); $.attack.sweep('#fighter','sword')")
        check(len(fresh) == 1, f"§40 новое окно атаки снова находит цель: {fresh}")

        # --- §40: .hide(), сон тела и .contacts(false) — не выключение формы -
        check(a.eval("$('#fighter').hide(); $('#fighter').areaOn('sword')") is True,
              "§40 .hide() не выключает область")
        check(a.eval("$('#fighter').areaOverlap('sword').length") == 1,
              "§40 скрытый узел продолжает находить цель областью")
        check(a.eval("$('#fighter').show(); $('#fighter').sleeping(true);"
                     "$('#fighter').areaOn('sword')") is True,
              "§40 сон тела не выключает область")
        check(a.eval("$('#fighter').sleeping(false); $('#fighter').contacts(false);"
                     "$('#fighter').areaOn('sword')") is True,
              "§40 .contacts(false) не выключает область")

        # --- §40: выключение области исключает её из запросов ---------------
        a.eval("$('#fighter').areaOn('sword', false)")
        check(a.eval("$('#fighter').areaOverlap('sword').length") == 0,
              "§40 выключенная область исключена из запросов, владелец жив")
        check(a.eval("$('#fighter').area('sword').index") >= 1,
              "§40 выключенная область остаётся у тела (не удалена)")

        # --- §40: destroy/re-enable без stale-попаданий ---------------------
        a.eval("$.attack.reset()")
        a.eval("$('#dummy').remove()")
        a.eval("$('#fighter').areaOn('sword', true)")
        a.eval("$.attack.open()")
        stale = a.eval("$.attack.sweep('#fighter','sword')")
        check(stale == [], f"§40 после удаления цели нет stale-попаданий: {stale}")
        check(a.eval("$.attack.log().length") == 0,
              f"§40 журнал попаданий чист: {a.eval('$.attack.log()')}")
        # Новая цель в той же области находится после повторного включения.
        a.eval("$('<enemy>', {id:'dummy2'}).at(456, 300).size(24, 24)"
               ".gravity(false).appendTo($.world)")
        a.step(2)
        renewed = a.eval("$.attack.open(); $.attack.sweep('#fighter','sword')")
        check(len(renewed) == 1,
              f"§40 после destroy/re-enable новая цель находится: {renewed}")

        # --- §40: область не меняет массу владельца --------------------------
        # Внутреннее представление (compound shape) не должно менять gameplay:
        # добавленная область не пересчитывает массу и инерцию тела.
        a.eval("$('<wall>', {id:'m1'}).at(200, 600).size(40, 40).body('dynamic')"
               ".gravity(false).appendTo($.world)")
        m0 = a.eval("$('#m1').mass()")
        a.eval("$('#m1').area('extra', { shape:'box', w:40, h:40, x:60, sensor:true })")
        m1 = a.eval("$('#m1').mass()")
        check(abs(m0 - m1) < 1e-6,
              f"§40 добавленная область не меняет массу тела: {m0} → {m1}")

        # --- §40: внешний драйвер (дорожка shape.enabled §41) и JS-описание ---
        # Адаптер анимационной дорожки переключает native-форму напрямую:
        # engine.setShapeEnabled(body, index, flag), не трогая JS-дескриптор.
        # Источник истины — нативный фильтр: .areas() и .areaOverlap() обязаны
        # показывать именно его, иначе игра читает неправду.
        a.eval("$('#fighter').at(400, 300).velocity(0, 0)")
        a.step(2)
        a.eval("$.attack.open(); $('#fighter').areaOn('sword', true)")
        a.step(1)
        check(a.eval("$('#fighter').areaOverlap('sword').length") == 1,
              "§40 перед внешним переключением цель внутри области")
        a.eval("engine.setShapeEnabled($('#fighter').nodes[0].body,"
               "$('#fighter').area('sword').index, false)")
        check(a.eval("engine.shapeEnabled($('#fighter').nodes[0].body,"
                     "$('#fighter').area('sword').index)") is False,
              "§40 внешний драйвер выключил native-форму")
        check(a.eval("$('#fighter').areas().filter(a => a.name === 'sword')[0].enabled") is False,
              "§40 .areas() показывает фактическое native-состояние (не старое JS)")
        check(a.eval("$('#fighter').areaOn('sword')") is False,
              "§40 .areaOn() читает native-состояние")
        check(a.eval("$('#fighter').areaOverlap('sword').length") == 0,
              "§40 выключенная внешним драйвером область никого не находит")
        a.eval("engine.setShapeEnabled($('#fighter').nodes[0].body,"
               "$('#fighter').area('sword').index, true, 1, 4294967295, 0)")
        check(a.eval("$('#fighter').areaOverlap('sword').length") == 1,
              "§40 после внешнего включения цель снова находится (состояние не залипло)")
        check(a.eval("$('#fighter').areas().filter(a => a.name === 'sword')[0].enabled") is True,
              "§40 .areas() не залипает на выключенном состоянии")
        check(a.eval("$('#fighter').areaOn('sword', false) &&"
                     "!engine.shapeEnabled($('#fighter').nodes[0].body,"
                     "$('#fighter').area('sword').index)"),
              "§40 .areaOn(false) переключает и native-форму")
        check(a.eval("$('#fighter').areaOn('sword', true) &&"
                     "engine.shapeEnabled($('#fighter').nodes[0].body,"
                     "$('#fighter').area('sword').index)"),
              "§40 .areaOn(true) переключает и native-форму обратно")

        # --- §40: destroy/re-enable без stale callbacks (события формы) ------
        # Не-сенсорная область bump касается статичной стойки: в событии должны
        # прийти имя области и логический владелец, а после удаления стойки —
        # ни одного нового события.
        a.eval("$('#fighter').at(400, 300)")
        a.eval("$('#fighter').velocity(0, 0)")
        a.eval("$('<wall>', {id:'post'}).at(430, 300).size(12, 12).appendTo($.world)")
        a.eval("$.bump.length = 0")
        a.step(3)
        events = a.eval("$.bump.slice()")
        check(len(events) >= 1 and events[0]["area"] == "bump",
              f"§40 контакт области несёт имя области и владельца: {events[:1]}")
        owner_nid = a.eval("$('#fighter').nid()")
        post_nid = a.eval("$('#post').nid()")
        check(all(e["owner"] == owner_nid for e in events),
              "§40 в событии логический владелец отделён от формы")
        check(all(e["other"] == post_nid for e in events),
              "§40 в событии есть цель контакта")
        a.eval("$('#post').remove()")
        a.eval("$.bump.length = 0")
        a.step(5)
        stale_events = a.eval("$.bump.slice()")
        check(stale_events == [], f"§40 после remove нет stale callbacks: {stale_events}")
        a.eval("$('#fighter').at(400, 300)")
        a.eval("$('<wall>', {id:'post2'}).at(430, 300).size(12, 12).appendTo($.world)")
        a.eval("$.bump.length = 0")
        a.step(3)
        renewed_events = a.eval("$.bump.slice()")
        check(any(e["area"] == "bump" for e in renewed_events),
              f"§40 после re-enable область снова присылает контакты: {renewed_events[:2]}")

        # --- §40: оборона: движение всё ещё работает -------------------------
        a.eval("$('#fighter').at(400, 600)")
        a.step(2)
        before = point(a.eval("$('#fighter').pos()"))[0]
        a.eval("$('#fighter').velocity(150, 0)")
        a.step(20)
        check(point(a.eval("$('#fighter').pos()"))[0] - before > 10,
              "§40 движение не зависит от состояния sword-области (re-enable)")

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
