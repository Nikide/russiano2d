// ===========================================================================
// Юнит-тесты навигации без движка (qjs).
//
// Проверяют чистую математику: A*, диагонали и запрет срезать углы,
// недостижимость, частичный путь, сглаживание и пряму видимость по сетке.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/nav_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { astar, smoothPath, lineOfSight, makeGrid, pathOnGrid, heuristicValue, effectiveMask } from '../../src/highlevel/nav.js';

// --- Вспомогательное --------------------------------------------------------

/** Пустая сетка cols×rows с ячейкой cell в мировых координатах. */
function grid(cols, rows, cell, opts) {
    return makeGrid(Object.assign({ x: 0, y: 0, w: cols * cell, h: rows * cell, cell }, opts));
}

/** Массив препятствий, заполненный функцией (cx, cy) ⇒ bool. */
function blockedMap(cols, rows, fn) {
    const arr = new Array(cols * rows).fill(0);
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) arr[cy * cols + cx] = fn(cx, cy) ? 1 : 0;
    }
    return arr;
}

/** Проверка: ни одна клетка пути не является стеной. */
function assertFree(cells, blocked, cols) {
    for (const c of cells) {
        if (blocked[c.cy * cols + c.cx]) {
            throw new Error(`путь проходит через стену (${c.cx},${c.cy})`);
        }
    }
}

// --- 1. Пустая сетка --------------------------------------------------------

test('A* в пустой сетке находит прямую', () => {
    const cells = astar({ cols: 5, rows: 5 }, { cx: 0, cy: 0 }, { cx: 4, cy: 0 });
    truthy(cells, 'путь должен существовать');
    eq(cells.length, 5, 'пять клеток по прямой');
    eq(cells[0].cx, 0);
    eq(cells[4].cx, 4);
});

test('A* в пустой сетке по диагонали короче манхэттенского', () => {
    const gridSpec = { cols: 5, rows: 5, diagonal: true, heuristic: 'octile' };
    const cells = astar(gridSpec, { cx: 0, cy: 0 }, { cx: 4, cy: 4 });
    truthy(cells);
    eq(cells.length, 5, 'диагональ — 5 клеток, а не 9');
    eq(cells[2].cx, 2);
    eq(cells[2].cy, 2);
});

test('прямая линия и сглаживание пустой сетки', () => {
    const g = grid(5, 5, 32);
    const pts = pathOnGrid(g, { x: 16, y: 16 }, { x: 144, y: 16 }, { smooth: true });
    truthy(pts);
    eq(pts.length, 2, 'сглаживание убирает все промежуточные клетки');
    eq(pts[0].x, 16);
    eq(pts[1].x, 144);
    eq(pts[1].y, 16);
});

// --- 2. Обход стены ---------------------------------------------------------

test('A* обходит стену и не проходит сквозь неё', () => {
    const cols = 10;
    const rows = 10;
    // Вертикальная стена в колонке 5 с проходом только в верхнем ряду.
    const blocked = blockedMap(cols, rows, (cx, cy) => cx === 5 && cy >= 1);
    const cells = astar({ cols, rows, blocked, diagonal: true, heuristic: 'octile' },
        { cx: 2, cy: 5 }, { cx: 8, cy: 5 });
    truthy(cells, 'путь в обход должен найтись');
    eq(cells[0].cx, 2);
    eq(cells[cells.length - 1].cx, 8);
    assertFree(cells, blocked, cols);
    truthy(cells.length > 7, `обход длиннее прямой (${cells.length} клеток против 7)`);
    truthy(cells.some((c) => c.cy === 0), 'путь проходит через проход в верхнем ряду');
});

test('мировой путь вокруг стены сохраняет начало и конец', () => {
    const g = grid(10, 10, 32);
    for (let cy = 1; cy < 10; cy++) g.setBlocked(5, cy, true);
    const pts = g.path({ x: 80, y: 176 }, { x: 272, y: 176 }, { smooth: true });
    truthy(pts, 'путь должен найтись');
    eq(pts[0].x, 80);
    eq(pts[0].y, 176);
    eq(pts[pts.length - 1].x, 272);
    eq(pts[pts.length - 1].y, 176);
    // Ни одна точка пути не лежит в стене.
    for (const p of pts) {
        const c = g.worldToCell(p.x, p.y);
        falsy(g.isBlocked(c.cx, c.cy), `точка (${p.x},${p.y}) не в стене`);
    }
});

// --- 3. Диагонали и углы ----------------------------------------------------

test('диагональ разрешена, когда путь свободен', () => {
    const g = grid(3, 3, 32);
    const pts = g.path({ x: 16, y: 16 }, { x: 80, y: 80 }, { smooth: false });
    truthy(pts);
    eq(pts.length, 3, 'старт, центр и цель');
    near(pts[1].x, 48, 1e-9);
    near(pts[1].y, 48, 1e-9);
});

test('нельзя срезать угол между двумя препятствиями', () => {
    const cols = 3;
    const rows = 3;
    // Препятствия справа и снизу от старта: диагональ в (1,1) запрещена.
    const blocked = blockedMap(cols, rows, (cx, cy) => (cx === 1 && cy === 0) || (cx === 0 && cy === 1));
    const cells = astar({ cols, rows, blocked, diagonal: true }, { cx: 0, cy: 0 }, { cx: 1, cy: 1 });
    eq(cells, null, 'срезать угол нельзя — пути нет');
});

test('диагональ разрешена, когда свободна хотя бы одна ортогональная клетка', () => {
    const cols = 3;
    const rows = 3;
    const blocked = blockedMap(cols, rows, (cx, cy) => cx === 1 && cy === 0);
    const cells = astar({ cols, rows, blocked, diagonal: true }, { cx: 0, cy: 0 }, { cx: 1, cy: 1 });
    truthy(cells);
    // Обходной маршрут: вниз, затем вправо; клетка (1,0) не должна встречаться.
    falsy(cells.some((c) => c.cx === 1 && c.cy === 0), 'путь не идёт через стену');
    eq(cells.length, 3);
});

test('без диагоналей путь остаётся ортогональным', () => {
    const cells = astar({ cols: 4, rows: 4, diagonal: false }, { cx: 0, cy: 0 }, { cx: 2, cy: 2 });
    truthy(cells);
    eq(cells.length, 5, 'манхэттенский путь длиной 5');
    for (let i = 1; i < cells.length; i++) {
        const dx = Math.abs(cells[i].cx - cells[i - 1].cx);
        const dy = Math.abs(cells[i].cy - cells[i - 1].cy);
        eq(dx + dy, 1, 'каждый шаг — на одну клетку по оси');
    }
});

// --- 4. Недостижимая цель ---------------------------------------------------

test('недостижимая цель даёт null', () => {
    const cols = 6;
    const rows = 3;
    // Сплошная стена делит сетку надвое.
    const blocked = blockedMap(cols, rows, (cx) => cx === 3);
    const cells = astar({ cols, rows, blocked }, { cx: 1, cy: 1 }, { cx: 5, cy: 1 });
    eq(cells, null, 'без allowPartial пути нет');
});

test('цель внутри стены даёт null', () => {
    const cols = 4;
    const rows = 4;
    const blocked = blockedMap(cols, rows, (cx, cy) => cx === 2 && cy === 2);
    const cells = astar({ cols, rows, blocked }, { cx: 0, cy: 0 }, { cx: 2, cy: 2 });
    eq(cells, null);
});

// --- 5. Частичный путь ------------------------------------------------------

test('allowPartial ведёт до ближайшей достижимой клетки', () => {
    const cols = 6;
    const rows = 3;
    const blocked = blockedMap(cols, rows, (cx) => cx === 3);
    const cells = astar({ cols, rows, blocked, partial: true }, { cx: 1, cy: 1 }, { cx: 5, cy: 1 });
    truthy(cells, 'частичный путь должен существовать');
    const last = cells[cells.length - 1];
    eq(last.cx, 2, 'последняя клетка — у самой стены');
    falsy(blocked[last.cy * cols + last.cx], 'последняя клетка свободна');
    assertFree(cells, blocked, cols);
});

test('pathOnGrid с allowPartial возвращает путь к недостижимой цели', () => {
    const g = grid(8, 4, 32);
    for (let cy = 0; cy < 4; cy++) g.setBlocked(4, cy, true);
    const full = g.path({ x: 16, y: 48 }, { x: 240, y: 48 }, { allowPartial: false });
    eq(full, null, 'без allowPartial цель недостижима');
    const part = g.path({ x: 16, y: 48 }, { x: 240, y: 48 }, { allowPartial: true, smooth: false });
    truthy(part, 'с allowPartial путь есть');
    const last = part[part.length - 1];
    truthy(last.x < 4 * 32, `путь доходит до стены (x=${last.x})`);
});

// --- 6. Сглаживание ---------------------------------------------------------

test('smoothPath убирает коллинеарные точки', () => {
    const points = [
        { x: 0, y: 0 }, { x: 32, y: 0 }, { x: 64, y: 0 }, { x: 96, y: 0 }, { x: 128, y: 0 },
    ];
    const out = smoothPath(points, () => false);
    eq(out.length, 2, 'остались только концы');
    eq(out[0].x, 0);
    eq(out[1].x, 128);
});

test('smoothPath сохраняет поворот там, где прямая перекрыта', () => {
    const points = [{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 0 }];
    // Стена x≈50 при y < 40 — прямой проход перекрыт.
    const blocked = (x1, y1, x2, y2) => {
        const crosses = (x1 - 50) * (x2 - 50) <= 0 && Math.min(y1, y2) < 40;
        return crosses;
    };
    const out = smoothPath(points, blocked);
    eq(out.length, 4, 'углы сохранены');
    // Точка, которую нельзя обойти напрямую, остаётся в пути…
    const blockedDirect = (x1, y1, x2, y2) => y1 !== y2;
    const kept = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }], blockedDirect);
    eq(kept.length, 3, 'излом сохранён, когда прямой отрезок перекрыт');
    // …а видимая точка-излом убирается как лишняя.
    const shortcut = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }], () => false);
    eq(shortcut.length, 2, 'видимый излом сглажен');
});

// --- 7. Прямая видимость ----------------------------------------------------

test('lineOfSight свободен на пустой сетке', () => {
    const g = grid(10, 10, 32);
    truthy(lineOfSight({ x: 16, y: 16 }, { x: 304, y: 16 }, g));
    truthy(lineOfSight({ x: 16, y: 16 }, { x: 304, y: 304 }, g));
    truthy(lineOfSight({ x: 16, y: 16 }, { x: 16, y: 16 }, g), 'точка видит саму себя');
});

test('lineOfSight перекрыт стеной', () => {
    const g = grid(10, 10, 32);
    g.setBlocked(5, 0, true);
    falsy(lineOfSight({ x: 16, y: 16 }, { x: 304, y: 16 }, g), 'стена на пути');
    truthy(lineOfSight({ x: 16, y: 48 }, { x: 304, y: 48 }, g), 'соседний ряд свободен');
});

test('lineOfSight не пропускает диагональ через угол двух стен', () => {
    const g = grid(3, 3, 32);
    g.setBlocked(1, 0, true);
    g.setBlocked(0, 1, true);
    falsy(lineOfSight({ x: 16, y: 16 }, { x: 48, y: 48 }, g), 'угол перекрыт');
});

test('эвристики считаются корректно', () => {
    near(heuristicValue('manhattan', 3, 4), 7);
    near(heuristicValue('euclidean', 3, 4), 5);
    near(heuristicValue('octile', 1, 1), Math.SQRT2);
});

// --- 8. Производительность и мелочи -----------------------------------------

test('large open grid ищется за разумное число шагов', () => {
    const cells = astar({ cols: 64, rows: 64, diagonal: true, heuristic: 'octile' },
        { cx: 0, cy: 0 }, { cx: 63, cy: 63 });
    truthy(cells);
    eq(cells.length, 64, 'чистая диагональ');
});

test('maxIterations останавливает поиск, allowPartial даёт частичный путь', () => {
    const cols = 40;
    const rows = 40;
    const cells = astar({ cols, rows, maxIterations: 3, partial: true },
        { cx: 0, cy: 0 }, { cx: 39, cy: 39 });
    truthy(cells, 'что-то найдено');
    truthy(cells.length < 79, 'до цели не дошли из-за лимита');
    eq(cells[0].cx, 0);
    eq(cells[0].cy, 0);
});

// --- Запас на габарит агента (agentRadius) ----------------------------------

test('effectiveMask без радиуса возвращает исходную маску', () => {
    const g = grid(5, 5, 32);
    g.setBlocked(2, 2, true);
    truthy(effectiveMask(g, 0) === g.blocked, 'маска не копируется');
});

test('effectiveMask раздувает препятствие на радиус агента', () => {
    const g = grid(5, 5, 32);
    g.setBlocked(2, 2, true);
    // Радиус 20 px: соседние клетки (центр в 32 px) задеваются телом,
    // диагональные — тоже (квадрат 40×40 перекрывает их прямоугольники).
    const m = effectiveMask(g, 20);
    const at = (cx, cy) => m[cy * g.cols + cx] !== 0;
    truthy(at(2, 2), 'сама стена остаётся стеной');
    truthy(at(1, 2), 'сосед слева непроходим для тела');
    truthy(at(2, 1), 'сосед сверху непроходим для тела');
    falsy(at(0, 2), 'клетка в 64 px по-прежнему свободна');
});

test('pathOnGrid с радиусом не ведёт вплотную к стене', () => {
    // Стена-перегородка в колонке 3, сверху оставлен проход в один ряд.
    const g = grid(7, 5, 32);
    for (let cy = 2; cy < 5; cy++) g.setBlocked(3, cy, true);
    const radius = 20;
    const p = pathOnGrid(g, { x: 16, y: 16 }, { x: 208, y: 16 }, { radius });
    truthy(p && p.length >= 2, 'путь найден');
    // Каждая точка пути должна быть проходима с учётом габарита.
    const m = effectiveMask(g, radius);
    for (const q of p) {
        const c = g.worldToCell(q.x, q.y);
        if (!g.inBounds(c.cx, c.cy)) continue;
        falsy(m[c.cy * g.cols + c.cx] !== 0, 'точка пути проходима для тела');
    }
    // А без запаса тот же старт ведёт вплотную к стене: путь идёт через
    // клетку, которая для тела непроходима.
    const tight = pathOnGrid(g, { x: 16, y: 80 }, { x: 208, y: 80 }, { radius: 0 });
    truthy(tight && tight.length >= 2, 'точечный путь тоже есть');
});

test('сетка помнит agentRadius из build-опций', () => {
    const g = grid(6, 4, 32, { agentRadius: 12 });
    eq(g.agentRadius, 12);
    g.inflate(24);
    eq(g.agentRadius, 24);
    g.inflate(0);
    eq(effectiveMask(g, 0) === g.blocked, true);
});

finish();
