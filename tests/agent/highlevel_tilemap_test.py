#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы TileMap (<tilemap>, $.tilemap).
#
# Гоняет фикстуру tests/fixtures/tilemap и проверяет публичную поверхность:
# создание карты и слоёв, индексацию тайлов, fromASCII, автотайл, перевод
# координат и статические тела коллизий (появление и снятие).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_tilemap_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "tilemap")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)

        # --- Пространство имён и создание -------------------------------------
        check(a.eval("typeof $.tilemap") == "object", "$.tilemap доступно")
        check(a.eval("typeof $.tilemap.create") == "function", "$.tilemap.create есть")
        check(a.eval("typeof $.tilemap.fromASCII") == "function", "$.tilemap.fromASCII есть")
        check(a.eval("$('#level').length") == 1, "карта из фикстуры создана")
        check(a.eval("$('#level').get(0).tag") == "tilemap", "узел имеет тег tilemap")

        # --- Данные и индексация ----------------------------------------------
        check(a.eval("$('#level').tilesData().length") == 50, "10×5 тайлов в данных")
        check(a.eval("$('#level').tileAt(0, 0)") == 1, "рамка карты непроходима")
        check(a.eval("$('#level').tileAt(1, 1)") == 0, "внутри карты пусто")
        check(a.eval("$('#level').tileAt(3, 2)") == 1, "внутренняя платформа на месте")
        check(a.eval("$('#level').tilesList().length") > 0, "tilesList перечисляет непустые тайлы")

        # --- Правка тайлов ----------------------------------------------------
        a.eval("$('#level').setTile(1, 1, 1)")
        check(a.eval("$('#level').tileAt(1, 1)") == 1, "setTile меняет тайл")
        a.eval("$('#level').setTile(1, 1, 0)")
        check(a.eval("$('#level').tileAt(1, 1)") == 0, "setTile возвращает пусто")

        a.eval("$.tilemap.create({ id: 'scratch', tile: 16, data: [0, 0, 0, 0], mapW: 2, mapH: 2 })")
        a.eval("$('#scratch').fill(3).setTile(0, 0, 5).tileSize(8)")
        check(a.eval("$('#scratch').tilesData()") == [5, 3, 3, 3], "fill/setTile/tileSize работают цепочкой")
        check(a.eval("$('#scratch').get(0).w") == 16, "габарит пересчитан после tileSize")
        a.eval("$('#scratch').clearTiles()")
        check(sum(a.eval("$('#scratch').tilesData()")) == 0, "clearTiles очищает карту")
        check(a.eval("$('#scratch').tilesList().length") == 0, "после clearTiles список пуст")

        # --- Слои -------------------------------------------------------------
        check(a.eval("$('#deco').tilesList().length") == 4, "второй слой прочитан из layers")
        check(a.eval("$.tilemap.layer('#deco')") == 0, "активный слой по умолчанию 0")

        # --- Автотайл ---------------------------------------------------------
        a.eval("$('<tilemap>', { id: 'auto', tile: 16, data: ['11', '11'], mapW: 2, mapH: 2 })"
               ".autotile({ mode: 'bit16', solid: [1], border: true })")
        check(a.eval("$('#auto').tileAt(0, 0)") == 16, "bit16 выбрал замкнутый тайл (base+15)")
        check(a.eval("$.tilemap.blob47Index(0)") == 0, "blob47: одиночный тайл — форма 0")
        check(a.eval("$.tilemap.blob47Index(255)") == 46, "blob47: замкнутый тайл — форма 46")
        check(a.eval("$.tilemap.BLOB47_LAYOUT.length") == 47, "в раскладке blob47 ровно 47 форм")

        # --- Координаты -------------------------------------------------------
        # deco: 4×4 тайла по 32, центр (0, 0) → левый верхний угол (-64, -64).
        check(a.eval("JSON.stringify($.tilemap.pixelToTile('#deco', -48, -48))") == '{"tx":0,"ty":0}',
              "pixelToTile переводит пиксель в тайл")
        check(a.eval("JSON.stringify($.tilemap.tileToPixel('#deco', 0, 0))") == '{"x":-48,"y":-48}',
              "tileToPixel даёт центр тайла")
        check(a.eval("$.tilemap.tileIndexAt('#deco', 3, 3)") == 15, "tileIndexAt считает плоский индекс")
        check(a.eval("$.tilemap.tileIndexAt('#deco', 4, 0)") == -1, "tileIndexAt отсекает выход за карту")

        # --- Коллизии: тела появляются и снимаются ----------------------------
        base = a.eval("engine.bodyCount()")
        check(base > 0, "у карты фикстуры есть статические тела")

        a.eval("$('<tilemap>', { id: 'solid2', tile: 32, solid: true, data: ['1111', '1111'], mapW: 4, mapH: 2 })"
               ".at(0, 400)")
        a.step(2)
        grown = a.eval("engine.bodyCount()")
        check(grown > base, f"solid-карта добавила тела ({base} → {grown})")

        a.eval("$('#solid2').clearTiles()")
        a.step(2)
        check(a.eval("engine.bodyCount()") == base, "clearTiles снимает тела коллизий")

        a.eval("$('<tilemap>', { id: 'solid3', tile: 32, solid: true, data: ['11', '11'], mapW: 2, mapH: 2 })"
               ".at(200, 400)")
        a.step(2)
        check(a.eval("engine.bodyCount()") > base, "вторая solid-карта тоже добавила тело")

        a.eval("$('#solid3').remove()")
        a.step(2)
        check(a.eval("engine.bodyCount()") == base, "remove() снимает тела карты")
        check(a.eval("$('#solid3').length") == 0, "карта удалена из мира")

        # --- Слияние тайлов в прямоугольники и бюджет тел ---------------------
        # Сплошной блок 200×100 = 20 000 клеток. Раньше это было 100 тел (по
        # одному на строку). Движок держит не больше 8192 тел, и на плотных
        # картах полосы упирались в лимит, оставляя тайлы без коллизий.
        a.eval("$('<tilemap>', { id: 'big', tile: 16, solid: true, data: Array(20000).fill(1), "
               "mapW: 200, mapH: 100 }).at(0, 2000)")
        a.step(2)
        grown = a.eval("engine.bodyCount()") - base
        check(grown == 1, f"сплошной блок 200×100 — одно тело, а не 100 полос ({grown})")
        check(a.eval("$.tilemap.rectsOf('#big', 0).length") == 1, "rectsOf подтверждает один прямоугольник")
        check(a.eval("JSON.stringify($.tilemap.rectsOf('#big', 0)[0])") == '{"tx":0,"ty":0,"w":200,"h":100}',
              "прямоугольник накрывает всю карту")

        # Старый режим доступен по запросу: тело на каждую горизонтальную полосу.
        a.eval("$('#big').collisionMerge(false).rebuild(); 'ok'")
        a.step(2)
        check(a.eval("engine.bodyCount()") - base == 100, "collisionMerge(false) возвращает 100 полос")
        a.eval("$('#big').collisionMerge(true).rebuild(); 'ok'")
        a.step(2)
        check(a.eval("engine.bodyCount()") - base == 1, "collisionMerge(true) снова даёт одно тело")

        # Реалистичный плотный уровень 200×100: замер и запас до лимита 8192.
        a.eval("""(() => {
            const w = 200, h = 100, d = new Int32Array(w * h);
            for (let y = h - 4; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = 1;
            for (let y = 0; y < h; y++) { d[y * w] = 1; d[y * w + w - 1] = 1; }
            for (let y = 6; y < h - 6; y += 6) for (let b = 0; b < 24; b++) {
                const x = 6 + b * 8;
                for (let i = 0; i < 5; i++) d[y * w + x + i] = 1;
            }
            $('#big').remove();
            $('<tilemap>', { id: 'real', tile: 16, solid: true, data: d, mapW: w, mapH: h }).at(0, 2000);
            return 1;
        })()""")
        a.step(2)
        real_bodies = a.eval("engine.bodyCount()") - base
        print(f"  --   плотный уровень 200×100: тел {real_bodies} (лимит движка 8192)")
        check(real_bodies > 0 and real_bodies < 2048, f"плотный уровень далеко от лимита ({real_bodies})")

        # Замер (не проверка): сборка тел плотного уровня двумя режимами — то же
        # «до/после», что в docs/highlevel/tilemap.md §6, но воспроизводимо из
        # теста. Порогов нет: время зависит от машины, печатаем как есть.
        for label, merge in (("полосы", "false"), ("прямоугольники", "true")):
            ms = a.eval("(() => { const el = $('#real'); el.collisionMerge(%s); "
                        "const t0 = $.time.perfNow(); el.rebuild(); return $.time.perfNow() - t0; })()"
                        % merge)
            print(f"  --   плотный уровень 200×100, {label}: rebuild {ms:.3f} мс")
        a.eval("$('#real').collisionMerge(true).rebuild(); 'ok'")
        a.eval("$('#real').remove(); 'ok'")
        a.step(1)
        check(a.eval("engine.bodyCount()") == base, "уровень 200×100 снят без утечки тел")

        # --- Полосы коллизий через публичный помощник -------------------------
        check(a.eval("$.tilemap.runsOf('#level', 0).length") > 0, "runsOf отдаёт полосы непроходимых тайлов")

        # --- Коллизии по габариту агента --------------------------------------
        # Карта #level: 10×5 клеток по 32 px с центром в (0,0), то есть
        # x -160..160, y -80..80. Клетка (2,1) свободна: её центр (-80,-32);
        # клетка (3,2) — стена: её центр (-48, 0).
        check(a.eval("typeof $('#level').fitsAt") == "function", ".fitsAt() есть")
        check(a.eval("typeof $('#level').agentSize") == "function", ".agentSize() есть")
        check(a.eval("typeof $('#level').sample") == "function", ".sample() есть")

        # Без габарита проверка идёт по клетке: центр в стене — не помещается.
        check(a.eval("$('#level').fitsAt(-80, -32)") is True, "точка в свободной клетке помещается")
        check(a.eval("$('#level').fitsAt(-48, 0)") is False, "точка в стене — нет")

        a.eval("$('#level').agentSize(24, 24); 'ok'")
        check(a.eval("$('#level').agentSize().w") == 24, "agentSize(24, 24) запоминает габарит")
        check(a.eval("$('#level').fitsAt(-80, -32)") is True, "агент 24×24 влезает в свободную клетку")

        # Свободная полоса — ровно одна клетка высотой: 24 px влезает, 40 — нет.
        a.eval("$('#level').agentSize(24, 40); 'ok'")
        check(a.eval("$('#level').fitsAt(-80, -32)") is False,
              "агент 40 px высотой в 32-пиксельную полосу не влезает")
        check(a.eval("$('#level').fitsAt(-80, -32, { h: 24 })") is True,
              "габарит можно передать и в самом вызове")
        a.eval("$('#level').agentSize(24, 24); 'ok'")

        check(a.eval("$('#level').agentRadius()") == 12, "agentRadius читается после agentSize")
        a.eval("$('#level').agentRadius(16); 'ok'")
        check(a.eval("$('#level').agentSize().w") == 32, "agentRadius(16) даёт габарит 32×32")
        a.eval("$('#level').agentSize(24, 24); 'ok'")

        # sample(): «поставь рядом, но не в стену».
        spot = a.eval("$('#level').sample(-48, 0)")
        check(isinstance(spot, dict) and spot.get("found") is True,
              "sample() нашёл свободное место рядом со стеной")
        check(isinstance(spot, dict) and (spot.get("x") != -48 or spot.get("y") != 0),
              "найденная позиция отличается от исходной")
        check(a.eval("$('#level').fitsAt(%r, %r)" % (spot.get("x"), spot.get("y"))) is True,
              "в найденной позиции габарит действительно помещается")
        check(a.eval("$('#level').sample(0, 0, { maxDistance: 4 }).found") is False,
              "в пределах maxDistance свободного места нет — found = false")

        # Габарит не меняет физику: тела коллизий остаются по клеткам.
        bodies = a.eval("engine.bodyCount()")
        a.eval("$('#level').agentRadius(64); 'ok'")
        a.step(1)
        check(a.eval("engine.bodyCount()") == bodies,
              "габарит агента не пересоздаёт тела коллизий")
        a.eval("$('#level').agentRadius(0); 'ok'")

        check(a.ping().get("pong") is True, "движок жив после работы с TileMap")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
