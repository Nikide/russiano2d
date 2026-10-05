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

        # --- Полосы коллизий через публичный помощник -------------------------
        check(a.eval("$.tilemap.runsOf('#level', 0).length") > 0, "runsOf отдаёт полосы непроходимых тайлов")

        check(a.ping().get("pong") is True, "движок жив после работы с TileMap")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
