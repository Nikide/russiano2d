#!/usr/bin/env python3
# ===========================================================================
# Тест утилитных подсистем: $.math, $.random, $.grid, $.csv.
#
# Проверяет, что пространства имён собраны в движке, что чистые функции дают
# ожидаемые значения, что сетка живёт в мировых координатах, заливка не
# протекает сквозь стены, а ГПСЧ после seed(n) повторяет последовательность.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_utility_test.py
# ===========================================================================

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "utility")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        # --- $.math: пространство имён ------------------------------------
        check(a.eval("typeof $.math") == "object", "$.math доступно")
        check(a.eval("typeof $.math.clamp") == "function", "$.math.clamp есть")
        check(a.eval("globalThis.__clamped") == 10, "clamp(15, 0, 10) → 10")
        check(a.eval("globalThis.__lerped") == 25, "lerp(0, 100, 0.25) → 25")
        check(a.eval("globalThis.__vec_len") == 5, "vecLength(vec2(3, 4)) → 5")
        check(abs(a.eval("globalThis.__angle") + math.pi / 2) < 1e-9,
              "angleDiff(0, 1.5π) → -π/2 (короткий путь)")
        check(a.eval("globalThis.__rect_hit") is True,
              "rectOverlap находит пересечение прямоугольников")
        check(a.eval("$.math.rectIntersect($.math.rect(0,0,10,10),"
                     " $.math.rect(20,20,5,5))") is None,
              "rectIntersect далёких прямоугольников → null")
        check(a.eval("$.math.moveTowards(0, 10, 3)") == 3,
              "moveTowards не перелетает цель")
        check(a.eval("$.math.wrap(-1, 0, 10)") == 9, "wrap заворачивает отрицательные")
        check(a.eval("$.math.snap(37, 16)") == 32, "snap притягивает к шагу")
        check(abs(a.eval("$.math.remap(50, 0, 100, 0, 1)") - 0.5) < 1e-9,
              "remap пересчитывает диапазон")
        check(a.eval("$.math.vecNormalize($.math.vec2(0, 0))") == {"x": 0, "y": 0},
              "нормализация нулевого вектора не даёт NaN")
        check(a.eval("$.math.approach(0, 100, 10, $.time.delta())") > 0,
              "approach работает с $.time.delta() движка")

        # --- $.random: детерминизм ----------------------------------------
        check(a.eval("typeof $.random") == "object", "$.random доступно")
        check(a.eval("globalThis.__seq1") == a.eval("globalThis.__seq2"),
              "после seed(4242) последовательность повторяется")
        check(a.eval("globalThis.__seed_now") == 4242, "seed() возвращает текущее зерно")
        check(a.eval("(() => { $.random.seed(4242); return globalThis.__roll(); })()")
              == a.eval("globalThis.__seq1"),
              "тот же seed в новом вызове даёт ту же серию")
        check(a.eval("(() => { const x = []; $.random.seed(1);"
                     " for (let i = 0; i < 3; i++) x.push($.random.int(0, 9));"
                     " $.random.seed(1); const y = [];"
                     " for (let i = 0; i < 3; i++) y.push($.random.int(0, 9));"
                     " return x.join(',') === y.join(','); })()") is True,
              "int(a, b) включительно и воспроизводим")
        check(a.eval("(() => { const v = $.random.next();"
                     " return v >= 0 && v < 1; })()") is True,
              "next() лежит в [0, 1)")
        check(a.eval("(() => { const src = [1,2,3,4,5,6];"
                     " const out = $.random.shuffle(src);"
                     " return out.slice().sort((x, y) => x - y).join(',') + '|' + src.join(',');"
                     "})()") == "1,2,3,4,5,6|1,2,3,4,5,6",
              "shuffle переставляет копию, не трогая исходный массив")
        check(a.eval("$.random.weighted([{value:'a',weight:1},{value:'b',weight:0}])") == "a",
              "weighted игнорирует нулевой вес")
        check(a.eval("$.random.pick([]) === undefined") is True, "pick пустого списка — undefined")
        check(a.eval("(() => { const v = $.random.gaussian();"
                     " return typeof v === 'number' && isFinite(v); })()") is True,
              "gaussian() возвращает конечное число")
        check(a.eval("globalThis.__noise_a") == a.eval("globalThis.__noise_b"),
              "noise1D — чистая функция координаты")
        check(0 <= a.eval("globalThis.__noise_a") < 1, "noise1D лежит в [0, 1)")
        check(a.eval("$.random.noise2D(3.5, 7.25)") == a.eval("$.random.noise2D(3.5, 7.25)"),
              "noise2D детерминирован")
        check(0 <= a.eval("$.random.noise2D(3.5, 7.25)") < 1, "noise2D лежит в [0, 1)")

        # --- $.grid: данные и координаты ----------------------------------
        check(a.eval("typeof $.grid") == "object", "$.grid доступно")
        check(a.eval("globalThis.__walls") == 12, "rect залил 12 клеток стены")
        check(a.eval("globalThis.__rays") == 20, "line провёл 20 клеток луча")
        check(a.eval("globalThis.__flood") == 268, "flood залил все свободные клетки")
        check(a.eval("globalThis.__water") == a.eval("globalThis.__flood"),
              "число залитых клеток совпадает с count")
        check(a.eval("globalThis.__zeros") == 0, "свободных клеток не осталось")
        check(a.eval("$.grid.at(globalThis.__grid, 10, 10)") == "water",
              "flood поставил значение в стартовую клетку")
        check(a.eval("$.grid.count(globalThis.__grid, 'wall')") == 12,
              "заливка не затёрла стены")
        check(a.eval("$.grid.inBounds(globalThis.__grid, 19, 14)") is True,
              "правый нижний угол внутри сетки")
        check(a.eval("$.grid.inBounds(globalThis.__grid, 20, 14)") is False,
              "клетка за правой границей — снаружи")
        check(a.eval("$.grid.at(globalThis.__grid, -1, 0, 'edge')") == "edge",
              "at за границей отдаёт fallback")
        check(a.eval("globalThis.__cell_of_marker") == {"cx": 5, "cy": 5},
              "toWorld → toCell возвращают ту же клетку")
        check(a.eval("$('#marker').pos()") == {"x": 88, "y": 88},
              "узел стоит в центре клетки (5, 5)")
        check(a.eval("$.grid.bounds(globalThis.__grid)") == {"x": 0, "y": 0, "w": 320, "h": 240},
              "bounds сетки — 320×240 мировых пикселей")
        check(a.eval("globalThis.__flood4") == 1,
              "4-связная заливка не протекает сквозь диагональную стену")
        check(a.eval("globalThis.__flood8") == 7,
              "заливка с diagonal: true протекает по диагонали")
        check(a.eval("$.grid.count(globalThis.__small, 'x')") == 2,
              "заливка не тронула клетки-стены")
        check(a.eval("$.grid.neighbors(globalThis.__grid, 5, 5, true).length") == 8,
              "neighbors по диагонали — 8 соседей")
        check(a.eval("$.grid.neighbors(globalThis.__grid, 5, 5).length") == 4,
              "neighbors по сторонам — 4 соседа")
        check(a.eval("$.grid.bresenham(0, 0, 3, 3).length") == 4,
              "Брезенхэм отдаёт 4 клетки на диагонали")
        check(a.eval("(() => { const g = $.grid.make({ cell: 8, cols: 2, rows: 2 });"
                     " const before = g.version;"
                     " $.grid.set(g, 9, 9, 'z');"
                     " return $.grid.make({}) === null && g.version === before; })()") is True,
              "set за границей не меняет сетку, make без размеров → null")
        check(a.eval("(() => { let n = 0;"
                     " $.grid.forEach(globalThis.__grid, () => n++);"
                     " return n; })()") == 300,
              "forEach обходит все 300 клеток")

        # --- $.csv: разбор, сборка, JSON ----------------------------------
        check(a.eval("typeof $.csv") == "object", "$.csv доступно")
        check(a.eval("globalThis.__table[0].name") == "sword"
              and a.eval("globalThis.__table[1].damage") == "5,5",
              "parseTable берёт ключи из заголовка, кавычки сохраняют запятую")
        check(a.eval("globalThis.__csv_rows[0][1]") == "b,c",
              "parse не делит поле с запятой внутри кавычек")
        check(a.eval("globalThis.__csv_round[0]") == ["a,b", 'c"d'],
              "stringify → parse сохраняет разделитель и кавычку")
        check(a.eval("globalThis.__tsv") == "a\tb", "TSV собирается с табуляцией")
        check(a.eval("$.csv.parse('\"one\\ntwo\",x')[0][0]") == "one\ntwo",
              "перевод строки внутри кавычек остаётся в поле")
        check(a.eval("$.csv.parse('')") == [] and a.eval("$.csv.parseTable('')") == [],
              "пустой CSV даёт пустой результат, а не падение")
        check(a.eval("$.csv.stringify([])") == "", "stringify пустого списка — пустая строка")
        check(a.eval("globalThis.__json_ok") == {"hp": 7}, "jsonParse разбирает корректный JSON")
        check(a.eval("globalThis.__json_bad") == "fallback",
              "jsonParse на битом тексте отдаёт запасное значение")
        check(a.eval("$.csv.jsonStringify(undefined)") is None,
              "jsonStringify(undefined) → null, а не исключение")
        check("\n" in a.eval("$.csv.jsonStringify({a: 1}, true)"),
              "jsonStringify с pretty добавляет отступы")

        # --- Соседи по движку: ничего не сломано ---------------------------
        check(a.eval("typeof $.nav") == "object" and a.eval("typeof $.fs") == "object",
              "$.nav и $.fs на месте (утилиты их не подменяют)")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
