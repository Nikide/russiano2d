#!/usr/bin/env python3
# ===========================================================================
# Тест слоёв и масок коллизий: .layerBits() / .mask() / .collidesWith(),
# фильтры запросов (raycast / bodyAt / bodiesIn), группы Box2D и сохранение
# фильтра в prefab.
#
# До этого теста .mask()/.layerBits()/.collidesWith() были заглушками:
# возвращали обёртку и ничего не делали (docs/HIGH_LEVEL_API.md §28).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_collision_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "collision")

ALL_LAYERS = 4294967295   # 0xffffffff: маска «все слои» по умолчанию


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def statement(a, code):
    """Выполнить код как операторы: агент не умеет отдавать обёртку в JSON."""
    return a.eval("(function(){%s; return 0;})()" % code)


def distance(a, first, second):
    return a.eval(
        "(function(){const p=$('#%s').pos(), q=$('#%s').pos();"
        "return Math.hypot(p.x-q.x, p.y-q.y);})()" % (first, second)
    )


def filter_of(a, selector):
    value = a.eval("engine.getBodyFilter($('%s').get(0).body)" % selector)
    return value if isinstance(value, dict) else {}


def main():
    with Agent(game=GAME, seed=11) as a:
        # --- Значения по умолчанию и поля узла --------------------------------
        check(a.eval("typeof $('#wall1').mask") == "function", ".mask() существует")
        check(a.eval("typeof $('#wall1').layerBits") == "function", ".layerBits() существует")
        check(a.eval("typeof $('#wall1').collidesWith") == "function",
              ".collidesWith() существует")
        check(a.eval("$('#wall1').layerBits()") == 1, "по умолчанию тело в слое 1")
        check(a.eval("$('#wall1').mask()") == ALL_LAYERS, "по умолчанию маска — все слои")
        check(a.eval("$('#wall4').layerBits()") == 4, "фикстура положила стену в слой 4")

        f = filter_of(a, "#wall4")
        check(f.get("layerBits") == 4 and f.get("group") == 0,
              "фильтр доехал до тела Box2D: %s" % f)

        # --- Смена фильтра у живого тела --------------------------------------
        statement(a, "$('#wall1').mask(4)")
        check(filter_of(a, "#wall1").get("mask") == 4,
              ".mask(4) меняет фильтр живого тела")
        check(a.eval("$('#wall1').mask()") == 4, ".mask() читает новое значение")
        check(a.eval("$('#wall1').attr('mask')") == 4, "и видно через .attr('mask')")

        statement(a, "$('#wall1').mask($('#wall4'))")
        check(a.eval("$('#wall1').mask()") == 4, ".mask(узел) берёт слои узла")

        statement(a, "$('#wall1').layerBits(2)")
        check(filter_of(a, "#wall1").get("layerBits") == 2, ".layerBits(2) меняет слой тела")
        statement(a, "$('#wall1').layerBits(1).mask(%d)" % ALL_LAYERS)
        check(a.eval("$('#wall1').mask()") == ALL_LAYERS, "маску можно вернуть целиком")

        # --- Луч: маска решает, какие слои он видит ---------------------------
        body4 = a.eval("$('#wall4').get(0).body")
        body1 = a.eval("$('#wall1').get(0).body")
        check(body4 >= 0 and body1 >= 0, "у стен есть тела")

        hit = a.eval("$.world.raycast({x:100,y:200},{x:600,y:200})")
        check(isinstance(hit, dict) and hit.get("body") == body4,
              "без маски луч бьёт в первую стену (слой 4)")
        hit = a.eval("$.world.raycast({x:100,y:200},{x:600,y:200},{mask:4})")
        check(isinstance(hit, dict) and hit.get("body") == body4, "маска 4 видит стену слоя 4")
        hit = a.eval("$.world.raycast({x:100,y:200},{x:600,y:200},{mask:1})")
        check(isinstance(hit, dict) and hit.get("body") == body1,
              "маска 1 пропускает стену слоя 4 и находит стену слоя 1")
        hit = a.eval("$.world.raycast({x:100,y:200},{x:600,y:200},{mask:2})")
        check(hit is None, "маска 2 не видит ни одной из стен")
        check(a.eval("$.world.lineOfSight({x:100,y:200},{x:600,y:200},{mask:2})") is True,
              "lineOfSight с маской 2 считает путь свободным")
        check(a.eval("$.world.raycastAll({x:100,y:200},{x:600,y:200},{mask:4}).length") == 1,
              "raycastAll с маской 4 находит одну стену")

        # --- Запросы точки и прямоугольника -----------------------------------
        check(a.eval("$.world.bodyAt(300,200).length") == 1, "bodyAt видит слой 4 без маски")
        check(a.eval("$.world.bodyAt(300,200,{mask:4}).length") == 1, "bodyAt с маской 4 видит")
        check(a.eval("$.world.bodyAt(300,200,{mask:1}).length") == 0,
              "bodyAt с маской 1 не видит")
        check(a.eval("$.world.bodiesIn(350,200,400,200,{mask:4}).length") == 1,
              "bodiesIn с маской 4 находит стену слоя 4")
        check(a.eval("$.world.bodiesIn(350,200,400,200,{mask:1}).length") == 1,
              "bodiesIn с маской 1 находит стену слоя 1")
        check(a.eval("$.world.bodiesIn(350,200,400,200,{mask:2}).length") == 0,
              "bodiesIn с маской 2 не находит ничего")

        # --- Свип формы: объём видит то, чего не видит луч ---------------------
        # Проём 20 px (y 190..210): луч по центру проходит, объём толще 20 px —
        # нет. Раньше такого запроса в движке не было вовсе.
        check(a.eval("typeof $.world.castShape") == "function", "$.world.castShape есть")
        check(a.eval("typeof $('#wall1').sweepTo") == "function", ".sweepTo() есть")

        hit = a.eval("$.world.raycast({x:600,y:200},{x:740,y:200})")
        check(hit is None, "луч проходит в проём 20 px")
        hit = a.eval("$.world.castShape({x:600,y:200},{x:740,y:200})")
        hit_x = 600 + hit.get("fraction", 0) * 140 if isinstance(hit, dict) else -1
        check(isinstance(hit, dict) and 655 < hit_x < 675,
              "объём 32×32 упирается в стенку проёма (x=%.0f, ждём ~664)" % hit_x)
        gap_bodies = [a.eval("$('#gapTop').get(0).body"), a.eval("$('#gapBottom').get(0).body")]
        check(isinstance(hit, dict) and hit.get("body") in gap_bodies,
              "свип остановился на стенке проёма")
        check(isinstance(hit, dict) and hit.get("distance", 0) > 0,
              "distance считается до точки касания")

        check(a.eval("$.world.castShape({x:600,y:200},{x:740,y:200},{w:16,h:16})") is None,
              "объём 16×16 в тот же проём проходит")
        hit = a.eval("$.world.castShape({x:600,y:200},{x:740,y:200},{radius:12})")
        check(hit is not None, "круг радиусом 12 в проём не проходит")
        check(a.eval("$.world.castShape({x:600,y:200},{x:740,y:200},{capsule:[6,0]})") is None,
              "капсула радиусом 6 в проём проходит")

        # Маска: тонкая стена на слое 4 стоит за проёмом.
        hit = a.eval("$.world.castShape({x:600,y:200},{x:800,y:200},{w:16,h:16,mask:4})")
        check(isinstance(hit, dict) and hit.get("body") == a.eval("$('#thin4').get(0).body"),
              "свип с маской 4 находит стену слоя 4")
        check(a.eval("$.world.castShape({x:600,y:200},{x:800,y:200},{w:16,h:16,mask:1})") is None,
              "свип с маской 1 её не видит — проём свободен")

        # Игнор: своё тело свип пропускает.
        statement(a, """
            $('<rect>', { id: 'sweeper', x: 600, y: 200, layerBits: 2, mask: %d })
                .size(32, 32).body('dynamic').appendTo($.world);
        """ % ALL_LAYERS)
        check(a.eval("$('#sweeper').sweepTo({x:740,y:200})") is not None,
              ".sweepTo() видит препятствие своим хитбоксом")
        check(a.eval("$('#sweeper').sweepTo({x:740,y:200},{w:16,h:16})") is None,
              "явная форма в .sweepTo() перебивает хитбокс узла")
        check(a.eval("$('#sweeper').sweepTo({x:740,y:200},{ignore:'#sweeper'})") is not None,
              "ignore не мешает найти чужое препятствие")

        # --- .collidesWith(): проверка и правка маски -------------------------
        statement(a, "$('#wall1').mask(%d).layerBits(1)" % ALL_LAYERS)
        statement(a, "$('#wall4').mask(4).layerBits(4)")
        check(a.eval("$('#wall4').collidesWith('#wall1')") is False,
              "слои 4 и 1 не пересекаются по маскам")
        statement(a, "$('#wall4').collidesWith('#wall1', true)")
        check(a.eval("$('#wall4').collidesWith('#wall1')") is True,
              "collidesWith(цель, true) добавляет слои цели в маску")
        check(a.eval("$('#wall4').mask()") == 5, "маска стала 4|1 = 5")
        statement(a, "$('#wall4').collidesWith('#wall1', false)")
        check(a.eval("$('#wall4').collidesWith('#wall1')") is False,
              "collidesWith(цель, false) убирает слои")
        check(a.eval("$('#wall4').mask()") == 4, "маска вернулась к 4")

        # --- Динамические тела: кто с кем сталкивается ------------------------
        # Пары стоят в 4 пикселях друг от друга: если Box2D их не разводит,
        # расстояние не меняется; если разводит — растёт.
        statement(a, """
            globalThis.mk = (id, x, y, opts) => $('<rect>', {
                id: id, x: x, y: y,
                layerBits: opts.layer, mask: opts.mask, group: opts.group || 0,
            }).size(40, 40).body('dynamic').appendTo($.world);
            globalThis.mk('c1', 1000, 100, { layer: 2, mask: 2 });
            globalThis.mk('c2', 1004, 100, { layer: 2, mask: 2 });
            globalThis.mk('n1', 1100, 100, { layer: 2, mask: 4 });
            globalThis.mk('n2', 1104, 100, { layer: 2, mask: 4 });
            globalThis.mk('g1', 1200, 100, { layer: 2, mask: 0, group: 7 });
            globalThis.mk('g2', 1204, 100, { layer: 2, mask: 0, group: 7 });
            globalThis.mk('h1', 1000, 300, { layer: 2, mask: %d, group: -7 });
            globalThis.mk('h2', 1004, 300, { layer: 2, mask: %d, group: -7 });
            globalThis.mk('z1', 1100, 300, { layer: 2, mask: 0 });
            globalThis.mk('z2', 1104, 300, { layer: 2, mask: 0 });
        """ % (ALL_LAYERS, ALL_LAYERS))

        pairs = [("c1", "c2"), ("n1", "n2"), ("g1", "g2"), ("h1", "h2"), ("z1", "z2")]
        before = {p: distance(a, p[0], p[1]) for p in pairs}
        a.step(60)
        after = {p: distance(a, p[0], p[1]) for p in pairs}

        check(after["c1", "c2"] > before["c1", "c2"] + 20,
              "тела с взаимными масками разъезжаются (%.1f → %.1f)"
              % (before["c1", "c2"], after["c1", "c2"]))
        check(after["n1", "n2"] == before["n1", "n2"],
              "пересечение масок пусто — тела остаются на месте (%.1f)"
              % after["n1", "n2"])
        check(after["g1", "g2"] > before["g1", "g2"] + 20,
              "положительная группа сильнее маски 0 (%.1f → %.1f)"
              % (before["g1", "g2"], after["g1", "g2"]))
        check(after["h1", "h2"] == before["h1", "h2"],
              "отрицательная группа запрещает столкновение (%.1f)" % after["h1", "h2"])
        check(after["z1", "z2"] == before["z1", "z2"],
              "маска 0 — «ни с кем» (%.1f)" % after["z1", "z2"])

        # --- Фильтр переживает пересоздание тела и prefab ---------------------
        statement(a, "$('#z1').size(80, 80)")
        check(filter_of(a, "#z1").get("mask") == 0,
              "пересоздание тела из-за .size() не теряет маску")

        statement(a, "$('#wall4').mask(4).layerBits(4)")
        statement(a, "globalThis.__saved = $.prefab.save($('#wall4'))")
        dump = a.eval("JSON.stringify(globalThis.__saved)")
        check('"layerBits":4' in dump and '"collisionMask":4' in dump,
              "prefab сохраняет слой и маску: %s" % dump[:200])
        statement(a, "$('#wall4').remove()")
        statement(a, "globalThis.__copy = $.prefab.load(globalThis.__saved)")
        check(a.eval("globalThis.__copy.nodes[0].layer_bits") == 4,
              "загруженная копия получила слой 4")
        check(a.eval("globalThis.__copy.nodes[0].collision_mask") == 4,
              "загруженная копия получила маску 4")
        check(a.eval("engine.getBodyFilter(globalThis.__copy.nodes[0].body).mask") == 4,
              "и фильтр доехал до её тела Box2D")

    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
