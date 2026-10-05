#!/usr/bin/env python3
# ===========================================================================
# Тест навигационного меша $.nav.mesh.
#
# Проверяет прямоугольную декомпозицию свободного пространства, порталы,
# путь по графу с сглаживанием воронкой, запас на габарит агента
# (agentRadius), движение агента по навмешу и частичный путь (allowPartial).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_navmesh_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "navmesh")

# Клетки проходов в стене-перегородке (колонка 10): их закрываем, чтобы
# разорвать связность навмеша, и снова открываем после проверки.
PASS_CELLS = "[[10,0],[10,1],[10,2],[10,12],[10,13],[10,14]]"
BLOCK_PASSES = (
    "(() => { const m = globalThis.__mesh;"
    f" {PASS_CELLS}.forEach((c) => m.setBlocked(c[0], c[1], true)); }})()"
)
FREE_PASSES = (
    "(() => { const m = globalThis.__mesh;"
    f" {PASS_CELLS}.forEach((c) => m.setBlocked(c[0], c[1], false)); }})()"
)

# Каждый отрезок пути: обе точки внутри области и не в клетке-стене.
PATH_OK = (
    "(() => { const m = globalThis.__mesh;"
    " const p = $.nav.meshPath({x:100,y:160},{x:520,y:160});"
    " if (!p || p.length < 2) return false;"
    " return p.every((q) => {"
    "   const c = m.worldToCell(q.x, q.y);"
    "   return !m.isBlocked(c.cx, c.cy); }); })()"
)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        # --- Пространство имён и построение навмеша ------------------------
        check(a.eval("typeof $.nav") == "object", "$.nav доступно")
        check(a.eval("typeof $.nav.mesh") == "function", "$.nav.mesh есть")
        check(a.eval("typeof $.nav.meshPath") == "function", "$.nav.meshPath есть")
        check(a.eval("typeof $.nav.useMesh") == "function", "$.nav.useMesh есть")
        check(a.eval("$.nav.meshes().length") == 1, "$.nav.meshes() возвращает созданные навмеши")
        check(a.eval("globalThis.__mesh.cols") == 20, "навмеш 20 колонок")
        check(a.eval("globalThis.__mesh.rows") == 15, "навмеш 15 рядов")

        # --- Декомпозиция и порталы ---------------------------------------
        check(a.eval("globalThis.__mesh.rects().length") > 1,
              "стена дробит поле на несколько прямоугольников")
        check(a.eval("globalThis.__mesh.portals().length") > 0,
              "соседние прямоугольники связаны порталами")
        rect_ok = a.eval(
            "(() => { const r = globalThis.__mesh.rects();"
            " return r.every((q) => q.x1 > q.x0 && q.y1 > q.y0 && typeof q.index === 'number'); })()"
        )
        check(rect_ok is True, "у каждого прямоугольника есть габарит и индекс")
        portal_ok = a.eval(
            "(() => { const p = globalThis.__mesh.portals();"
            " return p.every((q) => typeof q.a === 'number' && typeof q.b === 'number'); })()"
        )
        check(portal_ok is True, "у каждого портала есть пара прямоугольников")

        # --- Проходимость точки -------------------------------------------
        check(a.eval("globalThis.__mesh.contains(100,160)") is True,
              "старт лежит в проходимом прямоугольнике")
        check(a.eval("globalThis.__mesh.contains(336,176)") is False,
              "центр стены не входит в навмеш")
        check(a.eval("globalThis.__mesh.rectAt(100,160).index") >= 0,
              "rectAt() возвращает прямоугольник под точкой")
        check(a.eval("globalThis.__mesh.rectAt(336,176)") is None,
              "rectAt() для стены возвращает null")

        # --- Путь по навмешу ----------------------------------------------
        check(a.eval("typeof $.nav.decomposeRects") == "function",
              "$.nav.decomposeRects экспортирован")
        check(a.eval("typeof $.nav.buildPortalGraph") == "function",
              "$.nav.buildPortalGraph экспортирован")
        check(a.eval("typeof $.nav.funnel") == "function", "$.nav.funnel экспортирован")
        check(a.eval("$.nav.decomposeRects(new Uint8Array(9), 3, 3).length") == 1,
              "чистая декомпозиция пустого поля — один прямоугольник")

        check(a.eval("$.nav.meshPath({x:100,y:160},{x:520,y:160})[0]") == {"x": 100, "y": 160},
              "путь начинается ровно в старте")
        last = a.eval("$.nav.meshPath({x:100,y:160},{x:520,y:160}).slice(-1)[0]")
        check(last == {"x": 520, "y": 160}, "путь заканчивается ровно в цели")
        check(a.eval("$.nav.meshPath({x:100,y:160},{x:520,y:160}).length") > 2,
              "обход стены не сводится к одному отрезку")
        check(a.eval(PATH_OK) is True, "путь не проходит сквозь стену")

        # --- Недостижимая цель и allowPartial -----------------------------
        a.eval(BLOCK_PASSES)
        check(a.eval("$.nav.meshPath({x:100,y:160},{x:520,y:160})") is None,
              "через разорванный навмеш пути нет")
        partial = a.eval(
            "$.nav.meshPathOn(globalThis.__mesh,{x:100,y:160},{x:520,y:160},{allowPartial:true})"
        )
        check(isinstance(partial, list) and len(partial) >= 2,
              "allowPartial возвращает путь до ближайшего прямоугольника")
        if isinstance(partial, list) and partial:
            check(partial[-1]["x"] < 320, "частичный путь упирается в стену со своей стороны")
            check(partial[0] == {"x": 100, "y": 160}, "частичный путь начинается в старте")
        a.eval(FREE_PASSES)
        check(a.eval("$.nav.meshPath({x:100,y:160},{x:520,y:160})") is not None,
              "после восстановления проходов путь снова находится")

        # --- Агент идёт по навмешу по умолчанию ---------------------------
        a.eval("globalThis.__arrived = 0; globalThis.__blocked = 0")
        a.eval("$('#hero').on('arrive', () => { globalThis.__arrived++; })")
        a.eval("$('#hero').on('blocked', () => { globalThis.__blocked++; })")
        # mesh не передан: должен взяться навмеш из $.nav.useMesh.
        a.eval("$('#hero').navigateTo('#goal', { speed: 320, repathEvery: 200 })")
        check(a.eval("$('#hero').isNavigating()") is True, "агент начал движение по навмешу")
        check(a.eval("$('#hero').navPath().length") >= 2, "navPath() содержит маршрут")

        a.step(300)
        check(a.eval("globalThis.__arrived") >= 1, "событие arrive сработало")
        check(a.eval("$('#hero').isNavigating()") is False, "после прибытия агент не активен")
        pos = a.eval("$('#hero').pos()")
        check(abs(pos["x"] - 520) < 14 and abs(pos["y"] - 160) < 14,
              f"агент дошёл до цели по навмешу ({pos['x']:.0f}, {pos['y']:.0f})")

        # --- Явный opts.mesh вместо useMesh -------------------------------
        a.eval("globalThis.__arrived = 0")
        a.eval("$('#hero').navigateTo({x:100,y:160},"
               " { speed: 260, mesh: globalThis.__mesh, stopDistance: 8 })")
        check(a.eval("$('#hero').isNavigating()") is True,
              "navigateTo({ mesh }) принимает навмеш явно")
        a.step(300)
        check(a.eval("globalThis.__arrived") >= 1, "агент вернулся по явному навмешу")

        # --- Служебное -----------------------------------------------------
        a.eval("$.nav.clear()")
        check(a.eval("$.nav.meshes().length") == 0, "$.nav.clear() убирает навмеши")
        check(a.eval("$.nav.meshPath({x:0,y:0},{x:100,y:100})") is None,
              "без навмеша путь не строится (а не падает)")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
