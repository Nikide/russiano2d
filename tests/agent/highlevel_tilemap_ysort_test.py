#!/usr/bin/env python3
# ===========================================================================
# Тест Y-sort и террейнов TileMap (<tilemap>, $.tilemap).
#
# Гоняет фикстуру tests/fixtures/tilemap_ysort и проверяет:
#   * видимые тайлы с мировой Y (отсечение по камере и порядок по Y);
#   * полосовую отрисовку Y-sort (flushTilesUpTo/flushTiles/ysortReset);
#   * террейны: autotile mode terrain, таблица переходов, save/load набора;
#   * что старое API карты (.setTile/.tileAt/.tilesData) не сломалось.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_tilemap_ysort_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "tilemap_ysort")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(3)

        # --- Публичная поверхность --------------------------------------------
        check(a.eval("typeof $.tilemap") == "object", "$.tilemap доступно")
        check(a.eval("typeof $.tilemap.visibleTiles") == "function", "$.tilemap.visibleTiles есть")
        check(a.eval("typeof $.tilemap.flushTilesUpTo") == "function", "$.tilemap.flushTilesUpTo есть")
        check(a.eval("typeof $.tilemap.flushTiles") == "function", "$.tilemap.flushTiles есть")
        check(a.eval("typeof $.tilemap.terrain") == "function", "$.tilemap.terrain есть")
        check(a.eval("typeof $.tilemap.loadTerrains") == "function", "$.tilemap.loadTerrains есть")
        check(a.eval("typeof $.tilemap.terrainTile") == "function", "$.tilemap.terrainTile есть")
        check(a.eval("typeof $('#level').ysort") == "function", "у узла есть .ysort()")
        check(a.eval("typeof $('#level').terrainData") == "function", "у узла есть .terrainData()")

        # --- Видимые тайлы: отсечение и порядок по Y --------------------------
        total = a.eval("$('#level').tilesData().length")
        check(total == 960, "карта фикстуры 40×24 тайла")
        visible = a.eval("$.tilemap.visibleTiles('#level').length")
        check(visible > 0, "видимые тайлы есть")
        check(visible < total, f"карта отсекается по камере ({visible} < {total})")
        check(a.eval(
            "(function(){var l=$.tilemap.visibleTiles('#level');"
            "for(var i=1;i<l.length;i++){if(l[i].y<l[i-1].y)return false;}"
            "return true;})()") is True, "видимые тайлы идут по возрастанию Y")
        check(a.eval("$.tilemap.visibleTiles('#level')[0].w") == 32, "тайл несёт мировой размер")

        # --- Y-sort: режим и полосы -------------------------------------------
        check(a.eval("$.tilemap.ysort('#level', true)") is True, "Y-sort включён через пространство имён")
        check(a.eval("(function(){var w=$('#level');return w.ysort()===w;})()") is True,
              ".ysort() возвращает обёртку")
        flushed = a.eval(
            "(function(){$.tilemap.ysortReset('#level');"
            "var a=$.tilemap.flushTilesUpTo('#level', null, 0);"
            "var b=$.tilemap.flushTiles();"
            "var c=$.tilemap.flushTiles();"
            "return [a, b, c];})()")
        check(isinstance(flushed, list) and len(flushed) == 3, f"flush вернул числа ({flushed})")
        check(flushed[0] >= 0 and flushed[1] >= 0 and flushed[2] == 0,
              "flushTilesUpTo/flushTiles отдают счётчики, повтор пуст")
        check(a.eval("$.tilemap.ysortReset('#level')") is True, "ysortReset сбрасывает курсор")

        # --- Террейны: применение и переход -----------------------------------
        check(a.eval("$('#level').tileAt(20, 12)") == 2, "камень до автотайла — id 2")
        a.eval("$('#level').autotile({ mode: 'terrain', terrain: 'grass' })")
        check(a.eval("$('#level').tileAt(20, 12)") == 20, "одиночный камень получил переход 20")
        check(a.eval("$('#level').tileAt(0, 0)") == 1, "чужой тайл (рамка) не перерисован")
        check(a.eval("$('#level').tileAt(5, 5)") == 0, "пусто осталось пустым")
        check(a.eval("$.tilemap.terrainTile(0, $.tilemap.terrain('#level', 'grass'))") == 20,
              "terrainTile по маске даёт переход")

        # --- Сохранение/загрузка набора ---------------------------------------
        saved = a.eval("JSON.stringify($('#level').terrainData())")
        check('"grass"' in saved, "terrainData содержит набор grass")
        a.eval("$.tilemap.create({ id: 'level2', tile: 32, cols: 8, "
               "data: new Array(960).fill(0), mapW: 40, mapH: 24 })")
        loaded = a.eval("$.tilemap.loadTerrains('#level2', $('#level').terrainData())")
        check(loaded == 1, "loadTerrains загрузил один набор")
        check(a.eval("$.tilemap.terrain('#level2', 'grass').mode") == "bit16", "режим набора сохранён")
        check(a.eval("$.tilemap.terrain('#level2', 'grass').transitions[0]") == 20, "переход сохранён")

        # --- Старое API карты не сломано --------------------------------------
        a.eval("$.tilemap.create({ id: 'old', tile: 16, data: [0, 0, 0, 0], mapW: 2, mapH: 2 })")
        a.eval("$('#old').fill(3).setTile(0, 0, 5)")
        check(a.eval("$('#old').tilesData()") == [5, 3, 3, 3], "fill/setTile работают как раньше")
        a.eval("$('#old').clearTiles()")
        check(sum(a.eval("$('#old').tilesData()")) == 0, "clearTiles работает как раньше")

        check(a.ping().get("pong") is True, "движок жив после работы с Y-sort и террейнами")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
