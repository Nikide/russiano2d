#!/usr/bin/env python3
# ===========================================================================
# BASHNYA E5 и E7: занятость клетки по всем слоям коллизий и порядок слоёв карты.
#
# E5. `solidAt(tx, ty)` БЕЗ номера слоя отвечал только за АКТИВНЫЙ слой, а
# активным мог оказаться фон (`solid: false`) — тогда «просто solidAt» давал
# карту, где свободно ВСЁ. Теперь без слоя это «занято ли чем-нибудь из слоёв
# коллизий» (тот же контракт, что у `fitsAt`), а конкретный слой по-прежнему
# спрашивается явно. Тест написан так, что на старом коде падает.
#
# E7. Декор нельзя положить МЕЖДУ слоями одной карты: узлы мира сортируются по
# (layer, depth, y), а карта — один узел, внутри которого свои слои. Тест
# фиксирует фактический порядок числом (цвет пикселя) и проверяет рецепт
# «две карты + декор между ними», который задокументирован в tilemap.md.
#
# Запуск после сборки:
#   python3 tests/agent/tilemap_layers_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

HELLO = os.path.join("tests", "fixtures", "hello")
TILEMAP = os.path.join("tests", "fixtures", "tilemap")
FAILURES = []

#: Мир фикстуры tilemap: камера в (0,0), экран 800x600 — мир равен экрану.
BLUE = (0, 0, 255)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def pixel(a, path, wx, wy):
    """Цвет пикселя по МИРОВЫМ координатам (камера фикстуры стоит в 0,0)."""
    image = Image.open(a.screenshot(path)).convert("RGB")
    return image.getpixel((int(400 + wx), int(300 + wy)))


def run_e5():
    print("--- E5: занятость клетки без слоя (tests/fixtures/hello) ---")
    with Agent(game=HELLO, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        # Слои: 0 — фон без коллизий (активный по умолчанию), 1 — коллизии.
        a.eval("""(function(){
          const tm = $.tilemap.create({ id: 'lv', src: null, tile: 32, cols: 4, rows: 2, layers: [
            { data: ['0000', '0000'], solid: false, depth: -10 },
            { data: ['0110', '0110'], solid: true, depth: 0 }
          ] });
          tm.at(0, 0);
        })()""")
        a.step(2)

        check(a.eval("$.tilemap.layer('#lv')") == 0,
              "активный слой по умолчанию — фон без коллизий (слой 0)")
        check(a.eval("$.tilemap.solidAt('#lv', 1, 0)") is True,
              "solidAt без слоя видит коллизию слоя 1 (было false)")
        check(a.eval("$.tilemap.solidAt('#lv', 0, 0)") is False,
              "пустая во всех слоях клетка остаётся свободной")
        check(a.eval("$.tilemap.solidAt('#lv', 1, 0, 0)") is False,
              "явный слой 0 (фон) по-прежнему отвечает false")
        check(a.eval("$.tilemap.solidAt('#lv', 1, 0, 1)") is True,
              "явный слой 1 отвечает true")

        check(a.eval("$.tilemap.cellQuery('#lv')(1, 0)") is True,
              "cellQuery без слоя видит коллизию (для $.grid/$.nav)")
        check(a.eval("$.tilemap.cellQuery('#lv', 0)(1, 0)") is False,
              "cellQuery по слою 0 отвечает про фон")
        check(a.eval("$.tilemap.cellQuery('#lv', 1)(1, 0)") is True,
              "cellQuery по слою 1 отвечает про коллизии")

        check(a.eval("$('#lv').solidAt(1, 0)") is True,
              "метод узла .solidAt(1,0) отвечает так же (без слоя)")

        # Смена активного слоя не меняет ответ «занято ли чем-нибудь»: раньше
        # именно она и переворачивала модель проходимости.
        a.eval("$.tilemap.layer('#lv', 1)")
        check(a.eval("$.tilemap.solidAt('#lv', 1, 0)") is True,
              "после смены активного слоя ответ прежний")
        a.eval("$.tilemap.layer('#lv', 0)")

        # Обратная совместимость: карта с ОДНИМ слоем коллизий отвечает как
        # раньше, и явный слой тоже.
        a.eval("""(function(){
          $.tilemap.create({ id: 'one', src: null, tile: 32, cols: 2, rows: 1,
            solid: true, data: ['10'] }).at(200, 0);
        })()""")
        a.step(2)
        check(a.eval("$.tilemap.solidAt('#one', 0, 0)") is True
              and a.eval("$.tilemap.solidAt('#one', 1, 0)") is False,
              "однослойная карта отвечает как раньше (10 → занято, свободно)")
        check(a.eval("$.tilemap.cellQuery('#one')(0, 0)") is True,
              "cellQuery однослойной карты не изменился")

        # Несолидные слои без коллизий вообще не учитываются.
        a.eval("""(function(){
          $.tilemap.create({ id: 'deco', src: null, tile: 32, cols: 2, rows: 1,
            layers: [{ data: ['11'], solid: false }] }).at(400, 0);
        })()""")
        a.step(2)
        check(a.eval("$.tilemap.solidAt('#deco', 0, 0)") is False,
              "слой без коллизий не делает клетку занятой")


def run_e7():
    print("--- E7: декор между слоями карты (tests/fixtures/tilemap) ---")
    with Agent(game=TILEMAP, seed=11, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)

        # Фактический порядок: карта — ОДИН узел, её слои сортируются внутри.
        # Декор с depth -5 оказывается за ВСЕЙ картой и не виден.
        a.eval("""(function(){
          $.tilemap.create({ id: 'e7', src: 'assets/atlas.png', tile: 32, cols: 2, rows: 1, depth: 0,
            layers: [ { data: ['10'], solid: false, depth: -10 },
                      { data: ['01'], solid: false, depth: 10 } ] }).at(16, 0);
        })()""")
        a.eval("$('<rect>', { id: 'decor' }).at(0, 0).size(32, 32)"
               ".color('#0000ff').depth(-5).appendTo($.world)")
        a.step(3)
        behind = pixel(a, os.path.join(ROOT, "build", "e7_one_map.png"), 0, 0)
        check(behind != BLUE,
              "декор под ОДНОЙ картой не виден: пиксель клетки %s (тайл карты), а не синий"
              % (behind,))

        # Рецепт из tilemap.md: карту делим на две — фон ниже декора, верх выше.
        a.eval("$('#e7').remove()")
        a.eval("""(function(){
          $.tilemap.create({ id: 'e7_back', src: 'assets/atlas.png', tile: 32, cols: 2, rows: 1, depth: -20,
            layers: [ { data: ['10'], solid: false, depth: 0 } ] }).at(16, 0);
          $.tilemap.create({ id: 'e7_top', src: 'assets/atlas.png', tile: 32, cols: 2, rows: 1, depth: 20,
            layers: [ { data: ['01'], solid: false, depth: 0 } ] }).at(16, 0);
        })()""")
        a.step(3)
        between = pixel(a, os.path.join(ROOT, "build", "e7_two_maps.png"), 0, 0)
        top_cell = pixel(a, os.path.join(ROOT, "build", "e7_two_maps.png"), 32, 0)
        check(between == BLUE,
              "с двумя картами декор виден между слоями: пиксель %s" % (between,))
        check(top_cell != BLUE,
              "верхняя карта по-прежнему рисуется поверх декора: %s" % (top_cell,))


def main():
    run_e5()
    run_e7()

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки E5/E7 пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
