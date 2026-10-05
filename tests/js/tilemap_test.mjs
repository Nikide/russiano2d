// ===========================================================================
// Юнит-тест TileMap без движка (qjs).
//
// Проверяет чистую логику: разбор данных, маски автотайла (4 и 8 направлений),
// склейку коллизий в полосы, перевод координат — и то, что методы узла
// <.setTile()/…> действительно работают через мок engine.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/tilemap_test.mjs
// ===========================================================================

import { test, eq, truthy, joined, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import { installGfx } from '../../src/highlevel/render.js';
import {
    installTilemap, tickTilemap,
    autotileMask, autotileTile, blob47Index, BLOB47_LAYOUT,
    NEIGHBOURS47, asciiToData, normalizeTileData, solidRuns,
    pixelToTile, tileToPixel, tileIndexAt,
} from '../../src/highlevel/tilemap.js';

// Минимальный $: умеет только создавать узлы по '<тег>' и искать по селектору.
function makeDollar() {
    return function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
}

const $ = makeDollar();
installTilemap($);

// --- Данные ----------------------------------------------------------------

test('ASCII → плоские данные (легенда)', () => {
    const d = asciiToData(['.#.', '###'], { '#': 1, '.': 0 });
    eq(d.w, 3);
    eq(d.h, 2);
    eq(joined(d.data), '0,1,0,1,1,1');
});

test('ASCII: короткая строка дополняется нулями', () => {
    const d = asciiToData(['##', '#'], { '#': 2, '.': 0 });
    eq(d.w, 2);
    eq(joined(d.data), '2,2,2,0');
});

test('normalizeTileData понимает плоский массив, строки и вложенные массивы', () => {
    const flat = normalizeTileData([1, 2, 3, 4], { w: 2 });
    eq(flat.w, 2);
    eq(flat.h, 2);
    eq(joined(flat.data), '1,2,3,4');

    const rows = normalizeTileData([1, 2, 3, 4, 5, 6], { mapW: 3 });
    eq(rows.w, 3);
    eq(rows.h, 2);

    const nested = normalizeTileData([[1, 2], [3, 4]]);
    eq(nested.w, 2);
    eq(joined(nested.data), '1,2,3,4');

    const text = normalizeTileData('12\n34');
    eq(joined(text.data), '1,2,3,4');
});

// --- Создание и методы узла ------------------------------------------------

test('$.tilemap.create создаёт узел <tilemap> и читает данные', () => {
    const m = $.tilemap.create({ id: 'm1', src: 'assets/atlas.png', tile: 16, cols: 4, data: [1, 1, 0, 1], mapW: 4 });
    eq(m.length, 1);
    eq(m.get(0).tag, 'tilemap');
    eq(joined(m.tilesData()), '1,1,0,1');
    eq(m.get(0).w, 64);                       // 4 тайла × 16
});

test('$.tilemap.fromASCII переводит символы по легенде', () => {
    const a = $.tilemap.fromASCII(['##.', '..#'], { '#': 2, '.': 0 }, { id: 'm2', tile: 8 });
    eq(joined(a.tilesData()), '2,2,0,0,0,2');
    eq(a.tileAt(2, 1), 2);
    eq(a.tileAt(0, 1), 0);
    eq(a.get(0).w, 24);
});

test('setTile / tileAt / fill / tilesList / clearTiles — цепочные', () => {
    const t = $('<tilemap>', { id: 't1', tile: 10, data: [0, 0, 0, 0], mapW: 2, mapH: 2 });
    eq(t.tileAt(0, 0), 0);
    eq(t.setTile(1, 0, 5), t, 'setTile возвращает обёртку');
    eq(t.tileAt(1, 0), 5);
    eq(t.tileAt(5, 5), 0, 'вне карты — пусто');

    t.fill(3);
    eq(joined(t.tilesData()), '3,3,3,3');
    eq(t.tilesList().length, 4);
    eq(JSON.stringify(t.tilesList()[0]), JSON.stringify({ x: 0, y: 0, id: 3, layer: 0 }));

    t.tileSize(16);
    eq(t.get(0).w, 32);
    eq(t.tileAt(1, 1), 3, 'данные после смены размера целы');

    t.clearTiles();
    eq(joined(t.tilesData()), '0,0,0,0');
    eq(t.tilesList().length, 0);
});

test('.autotile рисует все 16 вариантов bit16 и не выходит за тайлсет', () => {
    const t = $('<tilemap>', { tile: 16, data: ['11', '11'], mapW: 2, mapH: 2 });
    t.autotile({ mode: 'bit16', solid: [1], border: true });
    // Все соседи сплошные (в том числе за границей) → маска 15 → тайл base+15.
    eq(joined(t.tilesData()), '16,16,16,16');
});

test('tickTilemap не бросает на живых узлах', () => {
    const t = $.tilemap.create({ tile: 16, solid: true, data: [1, 1, 0, 1], mapW: 2, mapH: 2 });
    tickTilemap(1 / 60);
    eq(t.tileAt(0, 0), 1);
});

// --- Маски автотайла -------------------------------------------------------

const grid8 = (cells) => {
    const set = new Set(cells);
    return (x, y) => set.has(y * 8 + x);
};
const cell = (dx, dy) => (1 + dy) * 8 + (1 + dx);

test('bit16: каждое из 4 направлений даёт свой бит', () => {
    const opts = { mode: 'bit16', cols: 8, rows: 8 };
    eq(autotileMask(grid8([cell(0, -1)]), 1, 1, opts), 1, 'N');
    eq(autotileMask(grid8([cell(1, 0)]), 1, 1, opts), 2, 'E');
    eq(autotileMask(grid8([cell(0, 1)]), 1, 1, opts), 4, 'S');
    eq(autotileMask(grid8([cell(-1, 0)]), 1, 1, opts), 8, 'W');
    eq(autotileMask(grid8([cell(0, -1), cell(1, 0), cell(0, 1), cell(-1, 0)]), 1, 1, opts), 15);
});

test('bit16: все 16 комбинаций', () => {
    const opts = { mode: 'bit16', cols: 8, rows: 8 };
    const dirs = [
        { bit: 1, dx: 0, dy: -1 }, { bit: 2, dx: 1, dy: 0 },
        { bit: 4, dx: 0, dy: 1 }, { bit: 8, dx: -1, dy: 0 },
    ];
    for (let mask = 0; mask < 16; mask++) {
        const cells = dirs.filter((d) => mask & d.bit).map((d) => cell(d.dx, d.dy));
        eq(autotileMask(grid8(cells), 1, 1, opts), mask, 'маска ' + mask);
    }
});

test('blob47: каждое из 8 направлений даёт свой бит', () => {
    const opts = { mode: 'blob47', cols: 8, rows: 8 };
    for (const d of NEIGHBOURS47) {
        const got = autotileMask(grid8([cell(d.dx, d.dy)]), 1, 1, opts);
        eq(got, d.bit, 'бит ' + d.bit);
    }
});

test('blob47: 256 масок сворачиваются ровно в 47 форм', () => {
    const opts = { mode: 'blob47', cols: 8, rows: 8 };
    const ids = new Set();
    for (let mask = 0; mask < 256; mask++) {
        const solid = grid8(NEIGHBOURS47.filter((d) => mask & d.bit).map((d) => cell(d.dx, d.dy)));
        eq(autotileMask(solid, 1, 1, opts), mask, 'маска ' + mask);
        const id = blob47Index(mask);
        truthy(id >= 0 && id <= 46, 'идентификатор в 0..46: ' + id);
        ids.add(id);
    }
    eq(ids.size, 47);
    eq(BLOB47_LAYOUT.length, 47);
    eq(blob47Index(0), 0, 'одиночный тайл — форма 0');
    eq(blob47Index(255), 46, 'замкнутый тайл — последняя форма');
});

test('autotileTile учитывает base', () => {
    eq(autotileTile(15, { mode: 'bit16' }), 16);
    eq(autotileTile(15, { mode: 'bit16', base: 5 }), 20);
    eq(autotileTile(255, { mode: 'blob47' }), 47);
});

test('граница карты считается сплошной при border', () => {
    const opts = { mode: 'bit16', cols: 2, rows: 2, border: true };
    eq(autotileMask(() => false, 0, 0, opts), 1 | 8, 'угол: N и W за границей');
    eq(autotileMask(() => false, 0, 0, { mode: 'bit16', cols: 2, rows: 2 }), 0);
});

// --- Коллизии --------------------------------------------------------------

test('solidRuns склеивает соседние тайлы в горизонтальные полосы', () => {
    const solid = (x, y) => (y === 0 && x >= 1 && x <= 3) || (y === 1 && x === 2);
    const runs = solidRuns(5, 3, solid);
    eq(runs.length, 2);
    eq(JSON.stringify(runs[0]), JSON.stringify({ tx: 1, ty: 0, len: 3 }));
    eq(JSON.stringify(runs[1]), JSON.stringify({ tx: 2, ty: 1, len: 1 }));
    eq(solidRuns(3, 3, () => false).length, 0);
});

test('$.tilemap.runsOf читает проходимость слоя', () => {
    const c = $.tilemap.create({ tile: 16, solid: true, data: [1, 1, 1, 0, 1, 1, 0, 0, 1], mapW: 3, mapH: 3 });
    const runs = $.tilemap.runsOf(c, 0);
    eq(runs.length, 3);
    eq(JSON.stringify(runs[0]), JSON.stringify({ tx: 0, ty: 0, len: 3 }));
    eq(JSON.stringify(runs[1]), JSON.stringify({ tx: 1, ty: 1, len: 2 }));
    eq(JSON.stringify(runs[2]), JSON.stringify({ tx: 2, ty: 2, len: 1 }));
});

// --- Координаты ------------------------------------------------------------

test('pixelToTile / tileToPixel / tileIndexAt — чистые', () => {
    const geom = { x: 300, y: 200, tile: 32, cols: 5, rows: 4 };
    eq(JSON.stringify(pixelToTile(geom, 220, 136)), JSON.stringify({ tx: 0, ty: 0 }));
    eq(JSON.stringify(tileToPixel(geom, 0, 0)), JSON.stringify({ x: 236, y: 152 }));
    eq(JSON.stringify(pixelToTile(geom, 236, 152)), JSON.stringify({ tx: 0, ty: 0 }));
    const p = tileToPixel(geom, 4, 3);
    eq(JSON.stringify(pixelToTile(geom, p.x, p.y)), JSON.stringify({ tx: 4, ty: 3 }));
    eq(tileIndexAt(geom, 4, 3), 19);
    eq(tileIndexAt(geom, -1, 0), -1);
    eq(tileIndexAt(geom, 5, 0), -1);
});

test('$.tilemap.pixelToTile/tileToPixel работают по узлу', () => {
    const g = $.tilemap.create({ tile: 32, data: new Array(16).fill(1), mapW: 4, mapH: 4 });
    g.get(0).x = 300;
    g.get(0).y = 300;
    // left = 300 - 64 = 236, центр (0,0) = 236 + 16 = 252.
    eq(JSON.stringify($.tilemap.tileToPixel(g, 0, 0)), JSON.stringify({ x: 252, y: 252 }));
    eq(JSON.stringify($.tilemap.pixelToTile(g, 252, 252)), JSON.stringify({ tx: 0, ty: 0 }));
    eq($.tilemap.tileIndexAt(g, 3, 3), 15);
    eq($.tilemap.tileIndexAt(g, 4, 0), -1);
    // Готовая геометрия тоже принимается — помощник остаётся чистым.
    eq($.tilemap.tileIndexAt({ tile: 32, cols: 4, rows: 4, x: 0, y: 0 }, 3, 3), 15);
});

// --- Отрисовка -------------------------------------------------------------

test('отрисовка отсекает тайлы по камере', () => {
    installGfx($);
    $.gfx = ctx.gfx;
    $.tilemap.create({ id: 'big', tile: 32, data: new Array(10000).fill(1), mapW: 100, mapH: 100 });
    ctx.gfx._render();
    const stats = ctx.gfx.push.stats();
    truthy(stats.sprites > 0, 'тайлы видимого диапазона нарисованы');
    truthy(stats.sprites < 2000, 'карта 100×100 не рисуется целиком: ' + stats.sprites);
});

finish();
