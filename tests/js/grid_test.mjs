// ===========================================================================
// Юнит-тест $.grid — сеточные помощники поверх обычных данных.
//
//   build/_deps/quickjs-build/qjs tests/js/grid_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    makeGrid, toCell, toWorld, cellRect, bounds, inBounds,
    at, set, fill, clear, count, rect, bresenham, line, flood,
    forEach, neighbors, installGrid,
} from '../../src/highlevel/grid.js';

// --- Создание и координаты -------------------------------------------------

test('makeGrid по клеткам заполняет поля и данные', () => {
    const g = makeGrid({ x: 5, y: 7, cell: 16, cols: 4, rows: 3, fill: 9 });
    eq(g.x, 5);
    eq(g.y, 7);
    eq(g.cell, 16);
    eq(g.cols, 4);
    eq(g.rows, 3);
    eq(g.data.length, 12);
    eq(g.data[0], 9);
    eq(g.fill, 9);
    eq(g.version, 0);
});

test('makeGrid по мировым размерам считает клетки вверх', () => {
    const g = makeGrid({ x: 0, y: 0, cell: 16, w: 100, h: 50 });
    eq(g.cols, 7, '100 / 16 округляется вверх');
    eq(g.rows, 4);
});

test('makeGrid без размеров возвращает null, а не сетку 0×0', () => {
    eq(makeGrid({ cell: 16 }), null);
    eq(makeGrid(), null);
    eq(makeGrid({ cols: 4 }), null);
});

test('makeGrid: мусор в cell заменяется на 32, fill по умолчанию 0', () => {
    const g = makeGrid({ cell: 0, cols: 2, rows: 2 });
    eq(g.cell, 32);
    eq(g.data[3], 0);
});

test('toCell и toWorld — взаимно обратные для центра клетки', () => {
    const g = makeGrid({ x: 10, y: 20, cell: 16, cols: 5, rows: 5 });
    eq(toCell(g, 10, 20).cx, 0, 'левый верхний угол — клетка 0');
    eq(toCell(g, 26, 20).cx, 1);
    eq(toCell(g, 9, 20).cx, -1, 'точка левее сетки даёт отрицательную клетку');
    const w = toWorld(g, 0, 0);
    near(w.x, 18);
    near(w.y, 28);
    const c = toCell(g, w.x, w.y);
    eq(c.cx, 0);
    eq(c.cy, 0);
});

test('cellRect и bounds описывают клетку и всю сетку в мире', () => {
    const g = makeGrid({ x: 10, y: 20, cell: 16, cols: 5, rows: 4 });
    const r = cellRect(g, 1, 2);
    eq(r.x, 26);
    eq(r.y, 52);
    eq(r.w, 16);
    eq(r.h, 16);
    const b = bounds(g);
    eq(b.x, 10);
    eq(b.y, 20);
    eq(b.w, 80);
    eq(b.h, 64);
});

test('inBounds проверяет обе границы', () => {
    const g = makeGrid({ cell: 16, cols: 4, rows: 3 });
    truthy(inBounds(g, 0, 0));
    truthy(inBounds(g, 3, 2));
    falsy(inBounds(g, 4, 2));
    falsy(inBounds(g, 3, 3));
    falsy(inBounds(g, -1, 0));
});

// --- Чтение и запись -------------------------------------------------------

test('at и set: значение, замена и fallback за границей', () => {
    const g = makeGrid({ cell: 8, cols: 3, rows: 3, fill: 0 });
    eq(at(g, 1, 1), 0);
    set(g, 1, 1, 'стена');
    eq(at(g, 1, 1), 'стена');
    eq(at(g, -1, 0), undefined, 'за границей — undefined');
    eq(at(g, -1, 0, 'пусто'), 'пусто', 'fallback работает');
});

test('set за границей молча игнорируется и не трогает version', () => {
    const g = makeGrid({ cell: 8, cols: 2, rows: 2 });
    set(g, 5, 5, 1);
    eq(g.data.join(','), '0,0,0,0');
    set(g, 0, 0, 1);
    eq(g.version, 1, 'успешная запись поднимает version');
    set(g, 0, 0, 1);
    eq(g.version, 1, 'запись того же значения version не меняет');
});

test('fill, clear и count', () => {
    const g = makeGrid({ cell: 8, cols: 3, rows: 3, fill: 0 });
    set(g, 0, 0, 7);
    eq(count(g, 7), 1);
    fill(g, 7);
    eq(count(g, 7), 9);
    clear(g);
    eq(count(g, 0), 9, 'clear возвращает значение по умолчанию');
    clear(g, 2);
    eq(count(g, 2), 9, 'clear(value) заливает указанным');
});

test('rect заливает прямоугольник клеток и обрезается по границе', () => {
    const g = makeGrid({ cell: 8, cols: 5, rows: 5, fill: 0 });
    rect(g, 1, 1, 3, 2, 1);
    eq(count(g, 1), 6);
    eq(at(g, 3, 2), 1, 'правый нижний угол залит');
    eq(at(g, 4, 4), 0);
    const h = makeGrid({ cell: 8, cols: 5, rows: 5, fill: 0 });
    rect(h, 3, 3, 5, 5, 2);
    eq(count(h, 2), 4, 'прямоугольник за границей обрезан');
});

// --- Линии и заливка -------------------------------------------------------

test('bresenham: диагональ и горизонталь', () => {
    const diag = bresenham(0, 0, 3, 3);
    eq(diag.length, 4);
    eq(diag[0].cx, 0);
    eq(diag[0].cy, 0);
    eq(diag[3].cx, 3);
    eq(diag[3].cy, 3);
    const horiz = bresenham(0, 5, 4, 5);
    eq(horiz.length, 5);
    truthy(horiz.every((p) => p.cy === 5), 'горизонталь не уезжает по Y');
});

test('line проводит линию по сетке, пропуская клетки за границей', () => {
    const g = makeGrid({ cell: 8, cols: 6, rows: 3, fill: 0 });
    line(g, 0, 0, 5, 2, 1);
    eq(count(g, 1), 6);
    eq(at(g, 0, 0), 1);
    eq(at(g, 5, 2), 1);
    const h = makeGrid({ cell: 8, cols: 3, rows: 3, fill: 0 });
    line(h, 0, 1, 99, 1, 1);
    eq(count(h, 1), 3, 'линия за границей не падает, а обрезается');
});

test('flood по 4 сторонам не протекает сквозь диагональную стену', () => {
    const g = makeGrid({ cell: 8, cols: 3, rows: 3, fill: 0 });
    set(g, 1, 0, 9);
    set(g, 0, 1, 9);
    const n = flood(g, 0, 0, 5);
    eq(n, 1, 'в углу залита только стартовая клетка');
    eq(at(g, 1, 0), 9, 'стена не затёрта');
});

test('flood с diagonal: true протекает по диагонали', () => {
    const g = makeGrid({ cell: 8, cols: 3, rows: 3, fill: 0 });
    set(g, 1, 0, 9);
    set(g, 0, 1, 9);
    const n = flood(g, 0, 0, 5, { diagonal: true });
    eq(n, 7, 'залито всё, кроме двух стен');
    eq(at(g, 2, 2), 5);
    eq(count(g, 9), 2);
});

test('flood по одинаковому значению ничего не делает и не зацикливается', () => {
    const g = makeGrid({ cell: 8, cols: 3, rows: 3, fill: 4 });
    eq(flood(g, 1, 1, 4), 0);
    eq(count(g, 4), 9);
});

test('flood: граница, limit и возвращаемое число клеток', () => {
    const g = makeGrid({ cell: 8, cols: 4, rows: 4, fill: 0 });
    eq(flood(g, -1, 0, 1), 0, 'за границей заливки нет');
    const limited = makeGrid({ cell: 8, cols: 4, rows: 4, fill: 0 });
    eq(flood(limited, 0, 0, 1, { limit: 3 }), 3, 'limit ограничивает заливку');
    eq(count(limited, 1), 3);
    const full = makeGrid({ cell: 8, cols: 4, rows: 4, fill: 0 });
    eq(flood(full, 0, 0, 1), 16);
    eq(count(full, 1), 16);
});

// --- Обход -----------------------------------------------------------------

test('forEach обходит все клетки в порядке строк', () => {
    const g = makeGrid({ cell: 8, cols: 2, rows: 2, fill: 0 });
    set(g, 1, 0, 'a');
    const seen = [];
    const n = forEach(g, (value, cx, cy) => seen.push(cx + ':' + cy + '=' + value));
    eq(n, 4);
    eq(seen.join(' '), '0:0=0 1:0=a 0:1=0 1:1=0');
});

test('neighbors: 4 стороны, 8 сторон и поведение на границе', () => {
    const g = makeGrid({ cell: 8, cols: 3, rows: 3, fill: 0 });
    set(g, 1, 0, 'сверху');
    set(g, 1, 1, 'центр');
    const four = neighbors(g, 1, 1);
    eq(four.length, 4);
    eq(four[0].cx, 2);
    eq(four[3].cy, 0);
    eq(four[3].value, 'сверху', 'значение соседа отдаётся вместе с координатами');
    const eight = neighbors(g, 1, 1, true);
    eq(eight.length, 8);
    eq(neighbors(g, 0, 0).length, 2, 'в углу всего два соседа по сторонам');
    eq(neighbors(g, 0, 0, true).length, 3);
});

// --- Установка -------------------------------------------------------------

test('installGrid кладёт те же функции в $.grid', () => {
    const $ = {};
    const grid = installGrid($);
    truthy($.grid === grid, '$.grid установлено');
    truthy($.grid.make === makeGrid, 'под пространством имён та же функция');
    truthy($.grid.flood === flood);
    const g = $.grid.make({ cell: 32, cols: 2, rows: 2, fill: 0 });
    $.grid.line(g, 0, 0, 1, 1, 3);
    eq($.grid.count(g, 3), 2);
    eq($.grid.at(g, 1, 1), 3);
    $.grid.flood(g, 0, 1, 8);
    eq($.grid.count(g, 8), 1);
    eq($.grid.bounds(g).w, 64);
});

finish();
