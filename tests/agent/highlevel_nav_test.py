#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы навигации $.nav.
#
# Проверяет сетку, A* в мировых координатах, автоматическую сборку
# препятствий из стен, прямую видимость, движение агента до цели, событие
# blocked и частичный путь (allowPartial).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_nav_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "nav")

# Клетки проходов в стене-перегородке (колонка 10): их закрываем, чтобы
# сделать цель недостижимой, и снова открываем после проверки.
PASS_CELLS = "[[10,0],[10,1],[10,2],[10,12],[10,13],[10,14]]"
BLOCK_PASSES = (
    "(() => { const g = globalThis.__grid;"
    f" {PASS_CELLS}.forEach((c) => g.setBlocked(c[0], c[1], true)); }})()"
)
FREE_PASSES = (
    "(() => { const g = globalThis.__grid;"
    f" {PASS_CELLS}.forEach((c) => g.setBlocked(c[0], c[1], false)); }})()"
)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        # --- Пространство имён и сетка ------------------------------------
        check(a.eval("typeof $.nav") == "object", "$.nav доступно")
        check(a.eval("typeof $.nav.grid") == "function", "$.nav.grid есть")
        check(a.eval("globalThis.__grid.cols") == 20, "сетка 20 колонок")
        check(a.eval("globalThis.__grid.rows") == 15, "сетка 15 рядов")
        check(a.eval("$.nav.grids().length") == 1, "$.nav.grids() возвращает созданные сетки")

        # --- Сборка препятствий из стен -----------------------------------
        check(a.eval("globalThis.__grid.isBlocked(10, 5)") is True,
              "buildFromWalls пометил клетку стены")
        check(a.eval("globalThis.__grid.isBlocked(10, 1)") is False,
              "проход сверху остался свободным")
        check(a.eval("globalThis.__grid.isBlocked(3, 5)") is False,
              "клетка слева от стены свободна")
        # Ручная правка клетки и её отмена.
        check(a.eval("globalThis.__grid.setBlocked(3, 4, true).isBlocked(3, 4)") is True,
              "setBlocked закрывает клетку")
        a.eval("globalThis.__grid.setBlocked(3, 4, false)")

        # --- Прямая видимость ---------------------------------------------
        check(a.eval("$.nav.lineOfSight({x:100,y:160},{x:520,y:160}, globalThis.__grid)") is False,
              "lineOfSight не видит сквозь стену")
        check(a.eval("$.nav.lineOfSight({x:100,y:80},{x:520,y:80}, globalThis.__grid)") is True,
              "lineOfSight видит через проход сверху")

        # --- Путь и обход стены -------------------------------------------
        check(a.eval("typeof $.nav.astar") == "function", "$.nav.astar экспортирован")
        check(a.eval("typeof $.nav.smoothPath") == "function", "$.nav.smoothPath экспортирован")
        check(a.eval("$.nav.astar({cols:3,rows:3},{cx:0,cy:0},{cx:2,cy:0}).length") == 3,
              "чистый astar доступен из игры")

        path_ok = a.eval(
            "(() => { const g = globalThis.__grid;"
            " const p = $.nav.path({x:100,y:160},{x:520,y:160});"
            " if (!p || p.length < 2) return false;"
            " return p.every((q) => { const c = g.worldToCell(q.x, q.y);"
            " return !g.isBlocked(c.cx, c.cy); }); })()"
        )
        check(path_ok is True, "путь существует и не проходит сквозь стену")
        check(a.eval("$.nav.path({x:100,y:160},{x:520,y:160})[0]") == {"x": 100, "y": 160},
              "путь начинается ровно в стартовой точке")
        last = a.eval("$.nav.path({x:100,y:160},{x:520,y:160}).slice(-1)[0]")
        check(last == {"x": 520, "y": 160}, "путь заканчивается ровно в цели")
        check(a.eval("$.nav.path({x:100,y:160},{x:520,y:160}).length") > 2,
              "обход стены не сводится к одному отрезку")

        # --- Недостижимая цель и allowPartial -----------------------------
        a.eval(BLOCK_PASSES)
        check(a.eval("$.nav.path({x:100,y:160},{x:520,y:160})") is None,
              "через сплошную стену пути нет")
        partial = a.eval(
            "$.nav.pathOn(globalThis.__grid,{x:100,y:160},{x:520,y:160},{allowPartial:true})"
        )
        check(isinstance(partial, list) and len(partial) >= 2,
              "allowPartial возвращает путь к ближайшей клетке")
        if isinstance(partial, list) and partial:
            check(partial[-1]["x"] < 320, "частичный путь упирается в стену со своей стороны")
            check(partial[0] == {"x": 100, "y": 160}, "частичный путь начинается в старте")
        check(a.eval("$.nav.pathOn(globalThis.__grid,{x:100,y:160},{x:520,y:160},{allowPartial:true})"
                     ".every((q) => !globalThis.__grid.isBlocked("
                     "globalThis.__grid.worldToCell(q.x,q.y).cx,"
                     "globalThis.__grid.worldToCell(q.x,q.y).cy))") is True,
              "частичный путь тоже не пересекает стены")
        a.eval(FREE_PASSES)
        check(a.eval("$.nav.path({x:100,y:160},{x:520,y:160})") is not None,
              "после открытия проходов путь снова находится")

        # --- Агент: движение до цели и событие arrive ---------------------
        a.eval("globalThis.__arrived = 0; globalThis.__blocked = 0")
        a.eval("$('#hero').on('arrive', () => { globalThis.__arrived++; })")
        a.eval("$('#hero').on('blocked', () => { globalThis.__blocked++; })")
        a.eval("$('#hero').navigateTo('#goal',"
               " { speed: 320, grid: globalThis.__grid, repathEvery: 200 })")
        check(a.eval("$('#hero').isNavigating()") is True, "агент начал навигацию")
        check(a.eval("$('#hero').navTarget()") == {"x": 520, "y": 160},
              "navTarget() отдаёт цель (узел по селектору)")
        check(a.eval("$('#hero').navPath().length") >= 2, "navPath() содержит маршрут")

        a.step(300)
        check(a.eval("globalThis.__arrived") >= 1, "событие arrive сработало")
        check(a.eval("$('#hero').isNavigating()") is False, "после прибытия агент не активен")
        pos = a.eval("$('#hero').pos()")
        check(abs(pos["x"] - 520) < 14 and abs(pos["y"] - 160) < 14,
              f"агент дошёл до цели ({pos['x']:.0f}, {pos['y']:.0f})")
        check(a.eval("$('#hero').navPath()") == [], "у прибывшего агента пустой маршрут")

        # --- stopNav останавливает движение --------------------------------
        a.eval("$('#hero').navigateTo({x:100,y:160},{ speed:220, grid: globalThis.__grid })")
        a.step(30)
        check(a.eval("$('#hero').isNavigating()") is True, "агент идёт к числовой цели")
        a.eval("$('#hero').stopNav()")
        check(a.eval("$('#hero').isNavigating()") is False, "stopNav() останавливает агента")
        x_before = a.eval("$('#hero').pos().x")
        a.step(20)
        x_after = a.eval("$('#hero').pos().x")
        check(abs(x_after - x_before) < 1, "после stopNav() узел не движется")

        # --- Событие blocked при недостижимой цели -------------------------
        a.eval(BLOCK_PASSES)
        a.eval("globalThis.__blocked = 0")
        a.eval("$('#hero').navigateTo({x:100,y:160},{ speed:220, grid: globalThis.__grid })")
        check(a.eval("globalThis.__blocked") >= 1, "событие blocked при недостижимой цели")
        check(a.eval("$('#hero').isNavigating()") is False,
              "после blocked агент не остаётся активным")

        # --- Агент с allowPartial доходит до стены -------------------------
        a.eval("globalThis.__arrived = 0")
        a.eval("$('#hero').navigateTo({x:100,y:160},"
               " { speed:260, grid: globalThis.__grid, allowPartial: true, stopDistance: 10 })")
        check(a.eval("$('#hero').isNavigating()") is True, "агент пошёл по частичному пути")
        a.step(250)
        check(a.eval("globalThis.__arrived") >= 1, "частичный путь тоже завершается arrive")
        x_end = a.eval("$('#hero').pos().x")
        # Стена занимает x = 320..352. К этому моменту герой уже побывал
        # справа от неё (первый заход дошёл до цели), поэтому частичный путь
        # подводит его к стене с той стороны, с которой он стоит: центр тела
        # останавливается в соседней клетке, не заходя в стену.
        near_wall = (280 <= x_end <= 320) or (352 <= x_end <= 430)
        check(near_wall, f"агент остановился у стены (x={x_end:.0f})")
        a.eval(FREE_PASSES)

        # --- Служебное -----------------------------------------------------
        a.eval("$.nav.clear()")
        check(a.eval("$.nav.grids().length") == 0, "$.nav.clear() убирает сетки")
        check(a.eval("$.nav.path({x:0,y:0},{x:100,y:100})") is None,
              "без сетки путь не строится (а не падает)")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
