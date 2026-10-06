// ===========================================================================
// Сетки: $.grid — помощники поверх обычных данных.
//
// $.nav отвечает за поиск пути по препятствиям; $.grid — за всё остальное, что
// делают с двумерным массивом: «какой тайл под курсором», «залить комнату»,
// «провести линию», «обойти соседей». Сетка здесь — обычный объект с полем
// data (плоский массив), поэтому её можно сохранить в JSON, нарисовать или
// отдать в $.nav.
//
// Система координат задана явно: x/y — левый верхний угол сетки в мировых
// пикселях, cell — сторона клетки. Клетка (0,0) занимает мир
// [x, x+cell) × [y, y+cell), её центр — toWorld().
//
//   const g = $.grid.make({ x: 0, y: 0, cell: 16, cols: 40, rows: 30, fill: 0 });
//   $.grid.line(g, 2, 2, 30, 10, 1);         // Брезенхэм
//   $.grid.flood(g, 10, 10, 2);              // залить комнату
//   $.grid.at(g, ...Object.values($.grid.toCell(g, mouse.x, mouse.y)));
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Создание и координаты
// ---------------------------------------------------------------------------

/**
 * Создать сетку. Размер задаётся либо клетками ({ cols, rows }), либо миром
 * ({ w, h } в пикселях — тогда клетки считаются от cell). Без размеров
 * возвращает null: молча создавать сетку 0×0 опаснее, чем сказать об ошибке.
 */
export function makeGrid(opts) {
    const o = opts || {};
    const cell = Number(o.cell) > 0 ? Number(o.cell) : 32;
    const x = Number(o.x) || 0;
    const y = Number(o.y) || 0;

    let cols = Math.floor(Number(o.cols));
    let rows = Math.floor(Number(o.rows));
    if (!(cols > 0) && Number(o.w) > 0) cols = Math.ceil(Number(o.w) / cell);
    if (!(rows > 0) && Number(o.h) > 0) rows = Math.ceil(Number(o.h) / cell);
    if (!(cols > 0) || !(rows > 0)) return null;

    const fill = o.fill === undefined ? 0 : o.fill;
    return {
        x,
        y,
        cell,
        cols,
        rows,
        fill,
        data: new Array(cols * rows).fill(fill),
        /** Растёт при каждом изменении — удобно для кэшей отрисовки. */
        version: 0,
    };
}

/** Мировая точка → клетка. Клетка может быть за границей — проверяйте inBounds. */
export function toCell(g, wx, wy) {
    return {
        cx: Math.floor((Number(wx) - g.x) / g.cell),
        cy: Math.floor((Number(wy) - g.y) / g.cell),
    };
}

/** Клетка → мировая точка: центр клетки. */
export function toWorld(g, cx, cy) {
    return {
        x: g.x + (cx + 0.5) * g.cell,
        y: g.y + (cy + 0.5) * g.cell,
    };
}

/** Клетка → прямоугольник в мире (левый верхний угол + размер). Для отрисовки. */
export function cellRect(g, cx, cy) {
    return { x: g.x + cx * g.cell, y: g.y + cy * g.cell, w: g.cell, h: g.cell };
}

/** Границы сетки в мировых пикселях: { x, y, w, h }. */
export function bounds(g) {
    return { x: g.x, y: g.y, w: g.cols * g.cell, h: g.rows * g.cell };
}

/** Клетка внутри сетки? */
export function inBounds(g, cx, cy) {
    return cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows;
}

// ---------------------------------------------------------------------------
// Чтение и запись
// ---------------------------------------------------------------------------

/** Значение клетки; за границей — fallback (по умолчанию undefined). */
export function at(g, cx, cy, fallback) {
    if (!inBounds(g, cx, cy)) return fallback;
    return g.data[cy * g.cols + cx];
}

/** Записать значение. За границей — тихо игнорируется, чтобы циклы не падали. */
export function set(g, cx, cy, value) {
    if (!inBounds(g, cx, cy)) return g;
    const i = cy * g.cols + cx;
    if (g.data[i] !== value) {
        g.data[i] = value;
        g.version++;
    }
    return g;
}

/** Залить всю сетку одним значением. */
export function fill(g, value) {
    g.data.fill(value);
    g.version++;
    return g;
}

/** Вернуть сетку к значению по умолчанию (или к указанному). */
export function clear(g, value) {
    return fill(g, value === undefined ? g.fill : value);
}

/** Сколько клеток равны значению. */
export function count(g, value) {
    let n = 0;
    for (let i = 0; i < g.data.length; i++) if (g.data[i] === value) n++;
    return n;
}

/** Прямоугольник клеток: от (cx, cy) размером w×h клеток. */
export function rect(g, cx, cy, w, h, value) {
    const x0 = Math.max(0, cx);
    const y0 = Math.max(0, cy);
    const x1 = Math.min(g.cols, cx + w);
    const y1 = Math.min(g.rows, cy + h);
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) set(g, x, y, value);
    }
    return g;
}

// ---------------------------------------------------------------------------
// Линии и заливка
// ---------------------------------------------------------------------------

/**
 * Клетки отрезка по алгоритму Брезенхэма — чистая функция, без сетки.
 * Координаты округляются: годится и для «линии из клетки в клетку», и для
 * трассировки луча по карте.
 */
export function bresenham(x0, y0, x1, y1) {
    const out = [];
    let x = Math.round(Number(x0) || 0);
    let y = Math.round(Number(y0) || 0);
    const ex = Math.round(Number(x1) || 0);
    const ey = Math.round(Number(y1) || 0);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;

    for (;;) {
        out.push({ cx: x, cy: y });
        if (x === ex && y === ey) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
    }
    return out;
}

/** Провести линию по сетке. Клетки за границей пропускаются. */
export function line(g, x0, y0, x1, y1, value) {
    for (const p of bresenham(x0, y0, x1, y1)) set(g, p.cx, p.cy, value);
    return g;
}

/**
 * Заливка «ведром»: все соседние клетки со значением, как в стартовой,
 * получают value. Возвращает число изменённых клеток.
 *
 * opts.diagonal — заливать и по диагонали (по умолчанию только 4 стороны);
 * opts.limit — предохранитель на размер заливки.
 * Реализация итеративная: заливка большого поля не переполняет стек.
 */
export function flood(g, cx, cy, value, opts) {
    const o = opts || {};
    if (!inBounds(g, cx, cy)) return 0;
    const target = g.data[cy * g.cols + cx];
    if (target === value) return 0;

    const diagonal = !!o.diagonal;
    const limit = Number(o.limit) > 0 ? Math.floor(Number(o.limit)) : g.cols * g.rows;
    const stack = [cx, cy];
    let changed = 0;

    while (stack.length > 0 && changed < limit) {
        const py = stack.pop();
        const px = stack.pop();
        if (!inBounds(g, px, py)) continue;
        const i = py * g.cols + px;
        if (g.data[i] !== target) continue;

        g.data[i] = value;
        changed++;
        stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
        if (diagonal) stack.push(px + 1, py + 1, px - 1, py - 1, px + 1, py - 1, px - 1, py + 1);
    }

    if (changed > 0) g.version++;
    return changed;
}

// ---------------------------------------------------------------------------
// Обход
// ---------------------------------------------------------------------------

/** Пройти по всем клеткам: fn(value, cx, cy). Возвращает число вызовов. */
export function forEach(g, fn) {
    let n = 0;
    for (let cy = 0; cy < g.rows; cy++) {
        for (let cx = 0; cx < g.cols; cx++) {
            fn(g.data[cy * g.cols + cx], cx, cy);
            n++;
        }
    }
    return n;
}

/**
 * Соседи клетки: по умолчанию 4 (вправо, влево, вниз, вверх), с diagonal —
 * ещё 4 по диагонали. За границей сетки соседей нет.
 * Элемент — { cx, cy, value }.
 */
export function neighbors(g, cx, cy, diagonal) {
    const out = [];
    const push = (ix, iy) => {
        if (inBounds(g, ix, iy)) out.push({ cx: ix, cy: iy, value: g.data[iy * g.cols + ix] });
    };
    push(cx + 1, cy);
    push(cx - 1, cy);
    push(cx, cy + 1);
    push(cx, cy - 1);
    if (diagonal) {
        push(cx + 1, cy + 1);
        push(cx - 1, cy + 1);
        push(cx + 1, cy - 1);
        push(cx - 1, cy - 1);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

/**
 * Подключить $.grid. Все методы — те же чистые функции: сетка передаётся
 * первым аргументом, поэтому две сетки в игре не мешают друг другу.
 */
export function installGrid($) {
    const grid = {
        make: makeGrid,
        toCell,
        toWorld,
        cellRect,
        bounds,
        inBounds,
        at,
        set,
        fill,
        clear,
        count,
        rect,
        line,
        bresenham,
        flood,
        forEach,
        neighbors,
    };

    $.grid = grid;
    ctx.grid = grid;
    return grid;
}
