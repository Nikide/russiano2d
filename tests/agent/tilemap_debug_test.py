#!/usr/bin/env python3
# ===========================================================================
# §35. TileMap debugger: отладочный оверлей карты.
#
# Проверяется на реальном движке (фикстура tests/fixtures/tilemap) и на
# пикселях кадра:
#   * по умолчанию оверлей ВЫКЛЮЧЕН: $.debug.draw.* не зовётся, кадр не меняется;
#   * включение рисует сетку клеток и подсветку твёрдых клеток — это видно на
#     скриншоте;
#   * твёрдые клетки оверлея совпадают с $.tilemap.solidAt() и
#     $.tilemap.cellQuery() (в обе стороны: лишних и пропущенных нет);
#   * клетка под курсором совпадает с $.tilemap.pixelToTile()/tileIndexAt();
#   * режим «только коллизии» рисует меньше и без сетки;
#   * предел клеток (cap) честно помечается в фактах;
#   * выключение возвращает РОВНО прежний кадр.
#
# Запуск после сборки:
#   python3 tests/agent/tilemap_debug_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/tilemap_debug_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "tilemap")
FAILURES = []

PATCH = """
(() => {
  globalThis.__tmdbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };
  for (const k of Object.keys(globalThis.__tmdbg)) {
    const orig = $.debug.draw[k];
    $.debug.draw[k] = (...args) => {
      if (k === 'rect') globalThis.__tmdbg.rect.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'line') globalThis.__tmdbg.line.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'circle' || k === 'ring') globalThis.__tmdbg[k].push([args[0].x, args[0].y, args[1]]);
      else if (k === 'text') globalThis.__tmdbg.text.push(String(args[0]));
      return orig(...args);
    };
  }
  return true;
})()
"""

RESET = ("globalThis.__tmdbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };"
         " true")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def calls(a):
    return json.loads(a.eval("JSON.stringify(globalThis.__tmdbg)"))


def image(path):
    return Image.open(path).convert("RGB")


def same_pixels(path_a, path_b):
    ia, ib = image(path_a), image(path_b)
    if ia.size != ib.size:
        return ia.size[0] * ia.size[1]
    pa, pb = ia.load(), ib.load()
    diff = 0
    for y in range(ia.size[1]):
        for x in range(ia.size[0]):
            if pa[x, y] != pb[x, y]:
                diff += 1
    return diff


def point_cell(a, tm, tx, ty):
    """Экранная точка центра клетки (tx, ty) карты."""
    return a.eval("(() => { const p = $.tilemap.tileToPixel(%r, %d, %d);"
                  " return $.camera.worldToScreen(p); })()" % (tm, tx, ty))


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=11, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(4)
        a.eval(PATCH)

        # --- по умолчанию выключен --------------------------------------------
        facts = a.eval("$.tilemap.debug()")
        check(facts["on"] is False, "оверлей карты по умолчанию выключен")
        check(facts["drawn"] is None, "у выключенного оверлея нет фактов кадра")
        a.eval(RESET)
        a.step(3)
        idle = calls(a)
        check(sum(len(idle[k]) for k in idle) == 0,
              "без оверлея $.debug.draw.* не зовётся: %s" % {k: len(v) for k, v in idle.items()})

        base_a = a.screenshot(os.path.join(shots, "tilemap_debug_off_a.png"))
        a.step(3)
        base_b = a.screenshot(os.path.join(shots, "tilemap_debug_off_b.png"))
        stable = same_pixels(base_a, base_b)
        check(stable == 0, "кадр фикстуры без оверлея стабилен (%d пикселей различия)" % stable)

        # --- включаем на клетку (3, 2) — она твёрдая ('1..111...1') -----------
        solid_cell = a.eval("$.tilemap.solidAt('#level', 3, 2)")
        check(solid_cell is True, "клетка (3,2) карты #level занята (solidAt)")
        screen = point_cell(a, "#level", 3, 2)
        a.mouse_move(x=screen["x"], y=screen["y"])
        a.step(1)

        a.eval(RESET)
        facts = a.eval("$.tilemap.debug({ on: true, map: '#level' })")
        a.step(1)

        check(facts["on"] is True and facts["mode"] == "all", "оверлей включён в режиме «всё»")
        check(facts["map"] == "level", "карта выбрана по id: %s" % facts["map"])
        check(facts["layer"] == 0, "активный слой карты — 0")
        check(facts["tile"] == 32 and facts["origin"] == {"x": 0, "y": 0},
              "геометрия карты в фактах: tile=%s origin=%s" % (facts["tile"], facts["origin"]))

        drawn = a.eval("$.tilemap.debug()")["drawn"]
        check(drawn["range"] == {"x0": 0, "y0": 0, "x1": 9, "y1": 4},
              "диапазон клеток — вся карта 10x5: %s" % drawn["range"])
        check(drawn["cells"] == 50, "сетка покрывает 50 клеток: %s" % drawn["cells"])
        check(drawn["capped"] is False, "карта целиком влезла в предел клеток")

        # Твёрдые клетки оверлея == правда карты. Сверка в ОБЕ стороны: и
        # лишняя клетка, и пропущенная — это ошибка.
        verdict = a.eval("""
        (() => {
          const f = $.tilemap.debug().drawn;
          const seen = new Set(f.solidCells.map((c) => c[0] + ':' + c[1]));
          for (const [tx, ty] of f.solidCells) {
            if ($.tilemap.solidAt('#level', tx, ty) !== true) return 'solidAt(' + tx + ',' + ty + ') != true';
            if ($.tilemap.cellQuery('#level')(tx, ty) !== true) return 'cellQuery(' + tx + ',' + ty + ') != true';
          }
          let extra = 0, missing = 0;
          for (let ty = f.range.y0; ty <= f.range.y1; ty++) {
            for (let tx = f.range.x0; tx <= f.range.x1; tx++) {
              const solid = $.tilemap.solidAt('#level', tx, ty) === true;
              const listed = seen.has(tx + ':' + ty);
              if (listed && !solid) extra++;
              if (solid && !listed) missing++;
            }
          }
          if (extra || missing) return 'extra=' + extra + ' missing=' + missing;
          return 'ok:' + f.solidCells.length;
        })()
        """)
        check(verdict == "ok:29", "подсветка твёрдых клеток совпала с solidAt/cellQuery (%s)"
              % verdict)
        check(drawn["solids"] == 29, "в кадре подсвечено 29 твёрдых клеток: %s" % drawn["solids"])

        # Нарисовано именно то, что описано: 17 линий сетки (11 + 6) и заливка
        # на каждую твёрдую клетку. Плюс одна заливка — подсветка клетки под
        # курсором (её видно в cursor ниже).
        recorded = calls(a)
        check(len(recorded["line"]) == 17,
              "сетка нарисована линиями: 17 (11 вертикалей + 6 горизонталей), а не %d"
              % len(recorded["line"]))
        cursor_rects = 1 if a.eval("$.tilemap.debug().drawn.cursor.inMap") else 0
        check(len(recorded["rect"]) == 29 + cursor_rects,
              "твёрдые клетки залиты прямоугольниками: %s (29 + подсветка курсора)"
              % len(recorded["rect"]))

        # --- клетка под курсором ----------------------------------------------
        cursor = drawn["cursor"]
        check(cursor and cursor["tx"] == 3 and cursor["ty"] == 2,
              "курсор в клетке (3,2): %s" % cursor)
        index = a.eval("$.tilemap.tileIndexAt('#level', 3, 2)")
        check(cursor["index"] == index == 23, "индекс клетки совпал с tileIndexAt: %s" % index)
        check(cursor["occupied"] is True and a.eval("$.tilemap.cellQuery('#level')(3, 2)") is True,
              "занятость под курсором совпала с cellQuery")
        check(cursor["id"] == a.eval("$('#level').get(0).attrs.data[23]"),
              "id тайла под курсором — из данных карты: %s" % cursor["id"])
        check(any("клетка 3,2" in t for t in recorded["text"]),
              "координаты клетки под курсором подписаны: %s" % recorded["text"][:2])

        # Свободная клетка (2,2): занятость обязана быть false, а не «как сосед».
        screen = point_cell(a, "#level", 2, 2)
        a.mouse_move(x=screen["x"], y=screen["y"])
        a.step(1)
        free = a.eval("$.tilemap.debug().drawn.cursor")
        check(free["tx"] == 2 and free["ty"] == 2, "курсор перешёл в клетку (2,2): %s" % free)
        check(free["occupied"] is False
              and a.eval("$.tilemap.cellQuery('#level')(2, 2)") is False,
              "свободная клетка не подсвечена как занятая")

        # --- кадр действительно изменился --------------------------------------
        on_shot = a.screenshot(os.path.join(shots, "tilemap_debug_on.png"))
        diff_on = same_pixels(base_a, on_shot)
        check(diff_on > 0, "включённый оверлей видно на кадре (%d пикселей)" % diff_on)

        # --- режим «только коллизии» -------------------------------------------
        a.eval("$.tilemap.debug({ mode: 'collision' })")
        a.eval(RESET)
        a.step(1)
        collision = a.eval("$.tilemap.debug().drawn")
        check(collision["cells"] == 29, "в режиме коллизий остались только занятые клетки: %s"
              % collision["cells"])
        check(collision["solids"] == 29, "все они подсвечены")
        recorded = calls(a)
        check(len(recorded["line"]) == 0, "сетка в режиме коллизий не рисуется")
        cursor_rects = 1 if collision["cursor"] and collision["cursor"]["inMap"] else 0
        check(len(recorded["rect"]) == 29 + cursor_rects,
              "заливок ровно по числу занятых клеток (+курсор): %s" % len(recorded["rect"]))

        # --- предел клеток честно помечается -----------------------------------
        a.eval("$.tilemap.debug({ mode: 'all', cap: 10 })")
        a.eval(RESET)
        a.step(1)
        capped = a.eval("$.tilemap.debug().drawn")
        check(capped["capped"] is True, "при cap=10 карта помечена как обрезанная")
        check(capped["cells"] == 10, "нарисовано ровно cap клеток: %s" % capped["cells"])
        cursor_rects = 1 if capped["cursor"] and capped["cursor"]["inMap"] else 0
        check(len(calls(a)["rect"]) == 10 + cursor_rects,
              "заливок тоже 10 (+курсор), а не вся карта")

        # --- вторая карта выбирается по селектору ------------------------------
        a.eval("$.tilemap.debug({ cap: 4096, map: '#deco' })")
        a.eval(RESET)
        a.step(1)
        deco = a.eval("$.tilemap.debug()")
        check(deco["map"] == "deco", "оверлей переключился на карту #deco")
        check(deco["cols"] == 4 and deco["rows"] == 4, "геометрия #deco: %sx%s"
              % (deco["cols"], deco["rows"]))
        check(deco["drawn"]["cells"] == 16, "клеток #deco 16: %s" % deco["drawn"]["cells"])
        check(deco["drawn"]["solids"] == 0,
              "у несолидной карты #deco занятых клеток нет: %s" % deco["drawn"]["solids"])
        check(any("#deco" in t for t in calls(a)["text"]),
              "подпись называет выбранную карту")

        # --- выключение возвращает прежний кадр --------------------------------
        a.eval("$.tilemap.debug({ map: '#level' })")
        a.eval(RESET)
        a.eval("$.tilemap.debug(false)")
        a.step(3)
        off_shot = a.screenshot(os.path.join(shots, "tilemap_debug_off_again.png"))
        check(same_pixels(base_a, off_shot) == 0, "выключение убрало оверлей (кадр совпал)")
        after = calls(a)
        check(sum(len(after[k]) for k in after) == 0, "после выключения примитивов нет")
        check(a.eval("$.tilemap.debug().on") is False, "факты подтверждают выключение")
        check(a.eval("$.tilemap.debug().drawn") is None, "фактов кадра у выключенного нет")

        # --- неизвестный режим не подменяет текущий ----------------------------
        a.eval("$.tilemap.debug({ mode: 'collision' })")
        a.eval("$.tilemap.debug({ mode: 'чепуха' })")
        check(a.eval("$.tilemap.debug().mode") == "collision",
              "неизвестный режим не изменён и не выдуман")
        check(a.eval("$.tilemap.debug(false)")["on"] is False, "выключение возвращает факты")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки §35 (tilemap debugger) пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
