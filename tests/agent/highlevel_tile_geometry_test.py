#!/usr/bin/env python3
# ===========================================================================
# Приёмка §42: частичная коллизия тайла и логические координаты.
#
# Гоняет фикстуру tests/fixtures/tile_geometry и проверяет по РЕАЛЬНОМУ
# движку то, что qjs-тест проверяет по данным:
#   * персонаж стоит на фактической верхней границе тонкой платформы;
#   * луч и fitsAt не видят заполненной пустой части клетки;
#   * клетка x=-1 и нижняя рамка создаются внутри буфера;
#   * visual/collision/occlusion адресуют одну клетку, повторная сборка не
#     меняет её положение;
#   * политика 'fail' отвергает план сверх текущей ёмкости тел до создания,
#     а 'partial' не отказывает: реестр тел растёт и создаёт весь план
#     (§3.1 п.12, §23 — реестр тел динамический).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_tile_geometry_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "tile_geometry")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def near(a, b, eps, message):
    check(abs(a - b) <= eps, "%s (%s ≈ %s)" % (message, a, b))


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(3)

        # --- Поверхность и данные ---------------------------------------------
        check(a.eval("typeof $.tilemap.shapesOf") == "function", "$.tilemap.shapesOf есть")
        check(a.eval("typeof $('#geom').shapeAt") == "function", ".shapeAt() есть")
        check(a.eval("typeof $('#geom').solidAt") == "function", ".solidAt() есть")
        check(a.eval("typeof $('#geom').collisionResult") == "function", ".collisionResult() есть")
        check(a.eval("$('#geom').tileAt(1, 1)") == 7, "тонкая платформа стоит в клетке (1,1)")
        check(a.eval("$('#geom').tileAt(0, 2)") == 1, "земля стоит в клетке (0,2)")

        # --- Реальная геометрия против клеточной занятости ---------------------
        shape = a.eval("$('#geom').shapeAt(1, 1)")
        check(isinstance(shape, dict) and shape.get("full") is False, "форма клетки — частичная")
        check(shape.get("rects") == [[-16, 8, 16, 16]],
              "локальная геометрия — полоса [-16,8]..[16,16]")
        check(a.eval("$('#geom').solidAt(1, 1)") is True, "клетка занята (клеточная занятость)")
        check(a.eval("$('#geom').solidAt(2, 0)") is False, "пустая клетка не занята")
        check(a.eval("$('#geom').shapeAt(2, 0)") is None, "и геометрии у неё нет")

        td = a.eval("$.tilemap.tileDef('#geom', 7)")
        check(isinstance(td, dict) and td["shape"]["rects"] == [[-16, 8, 16, 16]],
              "дескриптор тайла 7 читается через $.tilemap.tileDef")

        # Тела: полоса платформы 32×8 внизу клетки + земля 2×1 клетки.
        shapes = a.eval("$.tilemap.shapesOf('#geom')")
        check(isinstance(shapes, list) and len(shapes) == 2, "два тела: платформа и земля")
        plat = shapes[0]
        check([plat["lx"], plat["ly"], plat["w"], plat["h"]] == [32, 56, 32, 8],
              "тело платформы — полоса 32×8 внизу клетки, а не клетка 32×32: %s" % (plat,))
        check(plat["full"] is False, "у полосы full = false")
        ground = shapes[1]
        check([ground["lx"], ground["ly"], ground["w"], ground["h"]] == [0, 64, 64, 32],
              "земля — два слитых полных тайла: %s" % (ground,))
        check(ground["full"] is True, "у земли full = true")
        # cellRange-путь: клеточная занятость остаётся клеточной (совместимость).
        rects = a.eval("$.tilemap.rectsOf('#geom')")
        check(rects == [{"tx": 1, "ty": 1, "w": 1, "h": 2}, {"tx": 0, "ty": 2, "w": 1, "h": 1}],
              "rectsOf остаётся клеточным (занятость (1,1)+(1,2) слита): %s" % (rects,))
        res = a.eval("$('#geom').collisionResult()")
        check(res["ok"] is True and res["planned"] == 2 and res["created"] == 2,
              "сборка успешна: %s" % (res,))

        # --- fitsAt: пустая часть клетки проходима ----------------------------
        # Карта 4×3 по 32, центр (0,0): left=-64, top=-48. Клетка (1,1) — x
        # -32..0, y -16..16; полоса — её нижние 8 px, то есть y 8..16.
        a.eval("$('#geom').agentSize(16, 16); 'ok'")
        check(a.eval("$('#geom').fitsAt(-16, -20)") is True,
              "габарит 16×16 в пустой верхней части клетки помещается")
        check(a.eval("$('#geom').fitsAt(-16, 12)") is False,
              "там, где полоса, габарит не помещается")
        spot = a.eval("$('#geom').sample(-16, 12)")
        check(isinstance(spot, dict) and spot.get("found") is True
              and a.eval("$('#geom').fitsAt(%r, %r)" % (spot["x"], spot["y"])) is True,
              "sample() находит место по реальной форме")
        check(a.eval("$.tilemap.cellQuery('#geom')(1, 1)") is True,
              "cellQuery отвечает про клетку (для $.grid/$.nav)")
        check(a.eval("$.tilemap.cellQuery('#geom')(2, 0)") is False,
              "cellQuery не считает пустую клетку занятой")

        # --- Луч видит реальную форму ----------------------------------------
        down = a.eval("(() => { const h = $.world.raycast({x:-16,y:-40},{x:-16,y:40});"
                      " return h ? {hit:true, y:h.point.y, x:h.point.x} : {hit:false}; })()")
        check(down.get("hit") is True, "луч вниз попадает в платформу")
        near(down.get("y", 0), 8.0, 0.5, "точка попадания — верх полосы, а не клетки")

        upper = a.eval("(() => { const h = $.world.raycast({x:-80,y:0},{x:80,y:0});"
                       " return h ? {hit:true, x:h.point.x, y:h.point.y} : {hit:false}; })()")
        check(upper.get("hit") is False,
              "горизонтальный луч в пустой части клетки (y=0) не видит препятствия: %s" % (upper,))

        lower = a.eval("(() => { const h = $.world.raycast({x:-80,y:12},{x:80,y:12});"
                       " return h ? {hit:true, x:h.point.x} : {hit:false}; })()")
        check(lower.get("hit") is True and abs(lower.get("x", 0) + 32) < 0.5,
              "луч внутри полосы (y=12) упирается в её левый торец x=-32: %s" % (lower,))

        # Полная клетка земли по-прежнему непроходима целиком.
        check(a.eval("$('#geom').fitsAt(-48, 32)") is False, "полная клетка земли блокирует")

        # --- Персонаж стоит на фактической верхней границе полосы -------------
        a.step(120)
        import json
        hero = json.loads(a.eval("JSON.stringify({x: $('#hero').get(0).x, y: $('#hero').get(0).y})"))
        near(hero["y"], -4.0, 1.5, "персонаж 24×24 стоит на верхней границе полосы (y = 8 - 12)")
        check(hero["y"] < 0, "персонаж НЕ провалился сквозь полосу")
        check(hero["x"] > -33 and hero["x"] < 1, "персонаж остался над платформой")

        # --- Occluders повторяют partial shapes --------------------------------
        segs = a.eval("$.tilemap.occludersOf('#geom')")
        check(isinstance(segs, list) and len(segs) % 4 == 0, "occludersOf отдаёт отрезки")
        seg_list = [segs[i:i + 4] for i in range(0, len(segs), 4)]
        check([-32, 8, 0, 8] in seg_list,
              "верх препятствия — на верхней границе полосы (y=8), а не клетки (y=-16)")
        check([-32, 16, 0, 16] not in seg_list,
              "низ полосы скрыт землёй под ней — внутреннее ребро не дублируется")
        check([-64, 16, -32, 16] in seg_list, "верх земли виден там, где над ней пусто")
        check(len(seg_list) == 8,
              "платформа, стоящая на земле: 3 ребра + 5 рёбер земли = 8 отрезков: %d" % len(seg_list))

        # Реестр света: карта может владеть им сама (.tileOccluders(true)).
        check(a.eval("typeof $('#geom').tileOccluders") == "function", ".tileOccluders() есть")
        check(a.eval("$('#geom').tileOccluders(true); 'ok'") == "ok", "владение реестром включается")
        a.step(2)
        check(a.eval("$.gfx.light.count()") == len(seg_list),
              "в реестре света ровно отрезки карты: %s" % a.eval("$.gfx.light.count()"))
        check(a.eval("$('#geom').tileOccluders(false); 'ok'") == "ok", "владение выключается")
        a.step(2)
        check(a.eval("$.gfx.light.count()") == 0, "выключение очищает реестр")

        # --- Логические координаты: x=-1 и нижняя рамка внутри буфера ----------
        check(a.eval("$.tilemap.geometry('#pad').origin_x") == -1, "origin сдвинут padding'ом")
        check(a.eval("$.tilemap.geometry('#pad').origin_y") == -1,
              "origin_y сдвинут padding'ом сверху")
        check(a.eval("$.tilemap.geometry('#pad').cols") == 4, "буфер 4×4 клетки")
        check(a.eval("$.tilemap.geometry('#pad').rows") == 4, "буфер 4×4 клетки по Y")
        check(a.eval("$.tilemap.tileIndexAt('#pad', -1, -1)") == 0, "клетка (-1,-1) — первый элемент буфера")
        check(a.eval("$.tilemap.tileIndexAt('#pad', -2, -1)") == -1, "клетка (-2,-1) уже вне буфера")
        check(a.eval("JSON.stringify($.tilemap.tileToPixel('#pad', -1, -1))") == '{"x":-48,"y":552}',
              "world↔cell: центр клетки (-1,-1) в мире")

        base = a.eval("engine.bodyCount()")
        check(a.eval("$('#pad').setTile(-1, 1, 1).rebuild(); $('#pad').tileAt(-1, 1)") == 1,
              "в клетку x=-1 можно поставить тайл (она внутри буфера)")
        a.step(2)
        after = a.eval("engine.bodyCount()")
        check(after == base + 1, "тайл x=-1 дал ровно одно тело (%d → %d)" % (base, after))
        check(a.eval("$('#pad').setTile(-2, 1, 1).rebuild(); $('#pad').tileAt(-2, 1)") == 0,
              "запись за буфер (x=-2) отклоняется, а не портит память")
        a.step(2)
        check(a.eval("engine.bodyCount()") == after, "запись за буфер не создала тело")

        # --- Повторная сборка не меняет положение -----------------------------
        before_shapes = a.eval("JSON.stringify($.tilemap.shapesOf('#pad'))")
        before_bodies = a.eval("engine.bodyCount()")
        a.eval("$('#pad').rebuild(); 'ok'")
        a.step(2)
        check(a.eval("JSON.stringify($.tilemap.shapesOf('#pad'))") == before_shapes,
              "повторная сборка даёт ту же геометрию")
        check(a.eval("engine.bodyCount()") == before_bodies, "и то же число тел")
        check(a.eval("$('#pad').tileAt(-1, 1)") == 1, "тайл на месте после повторной сборки")

        # --- Лимит тел: failed result вместо молчаливой дырки ------------------
        base = a.eval("engine.bodyCount()")
        limits = a.eval("engine.limits()")
        print("  --   лимит тел движка: %s (занято %s)" % (limits.get("bodies_max"), limits.get("bodies")))
        a.eval("""(() => {
            const w = 200, h = 100, d = new Int32Array(w * h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = ((x + y) & 1) ? 1 : 0;
            $('<tilemap>', { id: 'over', tile: 16, solid: true, data: d, mapW: w, mapH: h })
                .at(0, 5000);
            return 1;
        })()""")
        a.step(2)
        over = a.eval("$('#over').collisionResult()")
        print("  --   шахматка 200×100 без слияния: план %s, создано %s, ошибка %s"
              % (over.get("planned"), over.get("created"), over.get("error")))
        check(over["ok"] is False and over["error"] == "body-limit",
              "превышение лимита — failed result, а не предупреждение: %s" % (over,))
        check(over["attempted"] == 0, "политика fail не создаёт ни одного тела")
        check(a.eval("engine.bodyCount()") == base,
              "карта не оставила частичную коллизию (тел как было: %d)" % (base,))
        check(a.eval("$('#over').collisionMerge(false).collisionLimit('partial')") is not None,
              "policy partial включается явно")
        a.eval("$('#over').collisionMerge(false).rebuild(); 'ok'")
        a.step(2)
        over2 = a.eval("$('#over').collisionResult()")
        partial_bodies = a.eval("engine.bodyCount()") - base
        print("  --   та же карта, limitPolicy partial: создано %s, тел %d"
              % (over2.get("created"), partial_bodies))
        check(over2["ok"] is True and over2["error"] is None,
              "partial завершается ok: реестр тел растёт, а не отказывает")
        check(over2["created"] == over2["planned"],
              "partial создаёт весь план (created == planned: %s == %s)"
              % (over2.get("created"), over2.get("planned")))
        check(partial_bodies == over2["planned"],
              "и все тела в мире (тел %d, план %s)"
              % (partial_bodies, over2.get("planned")))
        a.eval("$('#over').remove(); 'ok'")
        a.step(2)
        check(a.eval("engine.bodyCount()") == base, "карта снята без утечки тел")

        # --- Замер: плотная карта 200×100 (числа, не «стало лучше») -----------
        a.eval("""(() => {
            const w = 200, h = 100, d = new Int32Array(w * h);
            for (let y = h - 4; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = 1;
            for (let y = 0; y < h; y++) { d[y * w] = 1; d[y * w + w - 1] = 1; }
            for (let y = 6; y < h - 6; y += 6) for (let b = 0; b < 24; b++) {
                const x = 6 + b * 8;
                for (let i = 0; i < 5; i++) d[y * w + x + i] = 1;
            }
            $('<tilemap>', { id: 'dense', tile: 16, solid: true, data: d, mapW: w, mapH: h }).at(0, 9000);
            return 1;
        })()""")
        a.step(2)
        dense_bodies = a.eval("engine.bodyCount()") - base
        print("  --   плотный уровень 200×100 (без дескрипторов): тел %d" % dense_bodies)
        check(0 < dense_bodies < 2048, "плотный уровень далеко от лимита (%d)" % dense_bodies)
        for label, merge in (("полосы", "false"), ("прямоугольники", "true")):
            ms = a.eval("(() => { const el = $('#dense'); el.collisionMerge(%s); "
                        "const t0 = $.time.perfNow(); el.rebuild(); return $.time.perfNow() - t0; })()" % merge)
            print("  --   плотный уровень 200×100, %s: rebuild %.3f мс" % (label, ms))
        # Тот же уровень, но каждое тело описано дескриптором полной клетки.
        a.eval("""(() => {
            const w = 200, h = 100, d = new Int32Array(w * h);
            for (let y = h - 4; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = 1;
            for (let y = 0; y < h; y++) { d[y * w] = 1; d[y * w + w - 1] = 1; }
            for (let y = 6; y < h - 6; y += 6) for (let b = 0; b < 24; b++) {
                const x = 6 + b * 8;
                for (let i = 0; i < 5; i++) d[y * w + x + i] = 1;
            }
            $('<tilemap>', { id: 'dense2', tile: 16, solid: true, data: d, mapW: w, mapH: h,
                             tiles: { 1: { shape: 'full' } } }).at(0, 9000);
            return 1;
        })()""")
        a.step(2)
        dense2_bodies = a.eval("engine.bodyCount()") - base - dense_bodies
        ms2 = a.eval("(() => { const el = $('#dense2'); const t0 = $.time.perfNow(); "
                     "el.rebuild(); return $.time.perfNow() - t0; })()")
        print("  --   тот же уровень с дескриптором full: тел %d, rebuild %.3f мс"
              % (dense2_bodies, ms2))
        check(dense2_bodies == dense_bodies,
              "дескриптор full даёт столько же тел, сколько прежний путь (%d vs %d)"
              % (dense2_bodies, dense_bodies))
        a.eval("$('#dense').remove(); $('#dense2').remove(); 'ok'")
        a.step(2)
        check(a.eval("engine.bodyCount()") == base, "замерные карты сняты без утечки тел")

        check(a.ping().get("pong") is True, "движок жив после проверок §42")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
