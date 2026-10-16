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

import { test, eq, truthy, falsy, joined, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import { installGfx } from '../../src/highlevel/render.js';
import {
    installTilemap, tickTilemap,
    autotileMask, autotileTile, blob47Index, BLOB47_LAYOUT,
    NEIGHBOURS47, asciiToData, normalizeTileData, solidRuns, solidRects,
    pixelToTile, tileToPixel, tileIndexAt,
    normalizeTileDef, collisionShapes, shapeBoxBlocked, shapeOccluders,
    applyPadding, normalizePad,
    tilemapStates, tilemapLayerFrames,
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

test('solidRects склеивает тайлы в прямоугольники: покрытие точное, порядок детерминирован', () => {
    const cols = 6, rows = 4;
    const solid = (x, y) => (y < 2 && x < 3) || (y === 3 && x === 5);   // блок 3×2 + одиночка
    const rects = solidRects(cols, rows, solid);
    eq(rects.length, 2, 'блок и одиночка — два прямоугольника');
    eq(JSON.stringify(rects[0]), JSON.stringify({ tx: 0, ty: 0, w: 3, h: 2 }));
    eq(JSON.stringify(rects[1]), JSON.stringify({ tx: 5, ty: 3, w: 1, h: 1 }));

    // Ни одна проходимая клетка не накрыта, ни одна непроходимая не пропущена.
    const cover = new Int32Array(cols * rows);
    for (const r of rects) {
        for (let y = r.ty; y < r.ty + r.h; y++) {
            for (let x = r.tx; x < r.tx + r.w; x++) cover[y * cols + x]++;
        }
    }
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) eq(cover[y * cols + x], solid(x, y) ? 1 : 0, `клетка ${x},${y}`);
    }
});

test('solidRects: сплошной блок — одно тело, шахматка не сливается', () => {
    const ground = solidRects(200, 10, () => true);
    eq(ground.length, 1, 'блок 200×10 — один прямоугольник вместо 10 полос');
    eq(JSON.stringify(ground[0]), JSON.stringify({ tx: 0, ty: 0, w: 200, h: 10 }));

    const checker = solidRects(4, 4, (x, y) => ((x + y) & 1) === 1);
    eq(checker.length, 8, 'шахматка 4×4 — 8 одиночных клеток');
    truthy(checker.every((r) => r.w === 1 && r.h === 1), 'слияния нет');

    const column = solidRects(2, 4, (x) => x === 0);
    eq(column.length, 1, 'вертикальная стена 1×4 — одно тело');
    eq(solidRects(0, 5, () => true).length, 0, 'пустая сетка — пусто');
    eq(solidRects(3, 3, () => false).length, 0, 'нет непроходимых — пусто');
});

test('.collisionMerge() переключает режим тел, rectsOf это показывает', () => {
    const c = $.tilemap.create({ tile: 16, solid: true, data: [1, 1, 1, 1, 1, 1, 1, 1], mapW: 2, mapH: 4 });
    eq(c.collisionMerge(), true, 'по умолчанию слияние включено');
    eq($.tilemap.rectsOf(c, 0).length, 1, 'столбец 2×4 — один прямоугольник');
    eq(c.collisionMerge(false), c, 'сеттер возвращает обёртку');
    eq(c.collisionMerge(), false);
    eq($.tilemap.rectsOf(c, 0).length, 4, 'без слияния — тело на каждую строку');
    eq($.tilemap.runsOf(c, 0).length, 4, 'runsOf не зависит от режима');
    eq(c.collisionMerge(true), c);
    eq($.tilemap.rectsOf(c, 0).length, 1);
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

// --- §42: дескриптор тайла, частичная геометрия, логические координаты ------

const STRIP = [-16, 8, 16, 16];              // visual 32×32, тело — полоса внизу

test('normalizeTileDef: короткая форма rect, full по умолчанию, masks и occluder', () => {
    const full = normalizeTileDef(undefined, 32);
    eq(full.solid, true, 'без описания тайл считается полной клеткой');
    eq(full.shape.full, true);
    eq(joined(full.shape.rects[0]), '-16,-16,16,16');
    eq(full.occluder.rects.length, 1, 'occluder по умолчанию повторяет форму');

    const strip = normalizeTileDef({ shape: STRIP }, 32);
    eq(strip.shape.full, false);
    eq(joined(strip.shape.rects[0]), '-16,8,16,16');
    eq(strip.visual, null);

    const short = normalizeTileDef(STRIP, 32);
    eq(short.shape.full, false, 'короткая форма [x0,y0,x1,y1] — та же геометрия');
    eq(joined(short.shape.rects[0]), '-16,8,16,16');

    const off = normalizeTileDef({ shape: STRIP, solid: false, occluder: false }, 32);
    eq(off.solid, false, 'solid: false выключает коллизию');
    eq(off.shape, null);
    eq(off.occluder, null, 'occluder: false выключает препятствие света');

    const f = normalizeTileDef({ layerBits: 4, mask: 2, oneWay: true, tags: { kind: 'ice' } }, 32);
    eq(f.filter.layerBits, 4);
    eq(f.filter.mask, 2);
    eq(f.filter.oneWay, true);
    eq(f.tags.kind, 'ice');
    truthy(f.key !== normalizeTileDef({}, 32).key, 'маски входят в сигнатуру слияния');
});

test('collisionShapes: полные клетки сливаются ровно как solidRects', () => {
    const cols = 6, rows = 4;
    const solid = (x, y) => (y < 2 && x < 3) || (y === 3 && x === 5);
    const legacy = solidRects(cols, rows, solid);
    const shapes = collisionShapes(cols, rows, 32, (x, y) => (solid(x, y) ? normalizeTileDef('full', 32) : null));
    eq(shapes.length, legacy.length, 'то же число тел');
    for (let i = 0; i < legacy.length; i++) {
        eq(shapes[i].lx, legacy[i].tx * 32, 'lx совпадает с полосой ' + i);
        eq(shapes[i].ly, legacy[i].ty * 32, 'ly совпадает с полосой ' + i);
        eq(shapes[i].w, legacy[i].w * 32);
        eq(shapes[i].h, legacy[i].h * 32);
    }
});

test('collisionShapes: полоса тонкой платформы сливается по длине, но не в клетку', () => {
    const stripAt = (x, y) => normalizeTileDef({ shape: STRIP }, 32);
    const row = collisionShapes(3, 1, 32, stripAt);
    eq(row.length, 1, 'ряд одинаковых полос — одно тело');
    eq(row[0].lx, 0, 'левая граница первой клетки');
    eq(row[0].ly, 24, 'полоса внизу клетки: 32/2 + 8');
    eq(row[0].w, 96, 'ширина трёх клеток');
    eq(row[0].h, 8, 'высота полосы, а не клетки');
    eq(row[0].ny, 1);
    eq(row[0].nx, 3);

    // Форма уже клетки по X (16 < 32): соседние копии не соприкасаются —
    // объединение не равно прямоугольнику, слияния быть не должно.
    const narrow = collisionShapes(3, 1, 32, () => normalizeTileDef({ shape: [-8, 8, 8, 16] }, 32));
    eq(narrow.length, 3, 'узкая форма не сливается в широкий прямоугольник');
    truthy(narrow.every((s) => s.w === 16), 'ширина каждой формы сохранена');

    // Форма на всю высоту клетки по Y — столбик сливается по вертикали.
    const column = collisionShapes(1, 3, 32, () => normalizeTileDef({ shape: [-8, -16, 8, 16] }, 32));
    eq(column.length, 1, 'вертикальный столбик — одно тело');
    eq(column[0].h, 96);
    eq(column[0].w, 16);

    // Разные формы не сливаются, даже если соприкасаются.
    const mixed = collisionShapes(2, 1, 32, (x) => normalizeTileDef(
        { shape: x === 0 ? [-16, 8, 16, 16] : [-16, 4, 16, 12] }, 32));
    eq(mixed.length, 2, 'разная геометрия — разные тела');
});

test('collisionShapes: merge false и несколько форм в клетке', () => {
    const stripAt = () => normalizeTileDef({ shape: STRIP }, 32);
    eq(collisionShapes(3, 1, 32, stripAt, { merge: false }).length, 3, 'без слияния — тело на клетку');

    const two = collisionShapes(1, 1, 32, () => normalizeTileDef(
        { shape: [[-16, -16, 16, -8], [-16, 8, 16, 16]] }, 32));
    eq(two.length, 2, 'две формы в клетке — два тела');
    eq(two[0].ly, 0, 'верхняя форма: 16 - 16');
    eq(two[1].ly, 24, 'нижняя форма: 16 + 8');
});

test('shapeBoxBlocked: верх тонкой платформы проходим, полоса — нет', () => {
    const layer = { tile: 32, shape_pad: 0 };
    const rectsAt = () => [[-16, 8, 16, 16]];
    // left/top — углы буфера; клетка (0,0) занимает -32..0 по обеим осям.
    falsy(shapeBoxBlocked(layer, rectsAt, -32, -32, 0, -20, 8, 6),
          'габарит в пустой верхней части клетки проходит');
    truthy(shapeBoxBlocked(layer, rectsAt, -32, -32, 0, -4, 8, 6),
           'габарит, задевший полосу, блокируется');
    falsy(shapeBoxBlocked(layer, rectsAt, -32, -32, 0, -12, 8, 4),
          'касание верхней границы полосы (y=-8) ещё не пересечение');
    falsy(shapeBoxBlocked(layer, rectsAt, -32, -32, 0, -10, 8, 2),
          'касание границы не считается и при меньшем габарите');
});

test('shapeOccluders: рёбра реальных форм, внутренние стыки пропускаются', () => {
    const strip = { rects: [[-16, 8, 16, 16]] };
    const segs = shapeOccluders(3, 1, 32, () => strip, 0, 0);
    // Ряд полос: верх и низ трёх клеток (по 3), торцы первой и последней.
    eq(segs.length / 4, 8, 'внутренние боковые стыки не дублируются');
    eq(joined(segs.slice(0, 4)), '0,24,32,24', 'верх первой полосы на её реальной границе');
    eq(joined(segs.slice(segs.length - 4)), '96,24,96,32', 'торец последней клетки');

    const full = { rects: [[-16, -16, 16, 16]] };
    const block = shapeOccluders(2, 2, 32, () => full, 0, 0);
    eq(block.length / 4, 8, 'сплошной блок 2×2 — только внешний периметр (по 2 ребра на клетку)');
    eq(joined(block.slice(0, 4)), '0,0,32,0', 'верхний левый участок периметра');
    eq(joined(block.slice(4, 8)), '0,0,0,32', 'и левая сторона');

    // Столбик полос не должен «схлопывать» рёбра: полосы не соприкасаются.
    const column = shapeOccluders(1, 2, 32, () => strip, 0, 0);
    eq(column.length / 4, 8, 'у двух полос подряд все рёбра видны');
});

test('applyPadding и normalizePad: рамка за основной областью', () => {
    eq(joined(normalizePad(2)), '2,2,2,2');
    eq(joined(normalizePad([1, 0, 0, 1])), '1,0,0,1');
    eq(joined(normalizePad({ left: 1, bottom: 2 })), '1,0,0,2');
    eq(joined(normalizePad(null)), '0,0,0,0');

    const src = new Int32Array([1, 2, 3, 4]);
    const p = applyPadding({ data: src, w: 2, h: 2 }, [1, 1, 0, 1], 9);
    eq(p.w, 3);
    eq(p.h, 4);
    eq(joined(p.data), '9,9,9,9,1,2,9,3,4,9,9,9', 'основная область на месте, рамка заполнена');
    eq(joined(applyPadding({ data: src, w: 2, h: 2 }, [0, 0, 0, 0], 9).data), '1,2,3,4',
       'без padding данные не копируются');
});

test('$.tilemap: дескриптор задаёт частичную коллизию, видимую и физике, и fitsAt', () => {
    const t = $.tilemap.create({
        id: 'thin', tile: 32, solid: true, data: ['111', '111'], mapW: 3, mapH: 2,
        tiles: { 1: { shape: STRIP } },
    });
    t.agentSize(20, 20);
    tickTilemap(1 / 60);

    const shapes = $.tilemap.shapesOf('#thin');
    eq(shapes.length, 2, 'два ряда полос — два тела');
    eq(shapes[0].ly, 24);
    eq(shapes[0].w, 96);
    eq(shapes[0].full, false);

    // Клеточная занятость и реальная геометрия различаются явно.
    eq(t.solidAt(0, 0), true, 'клетка занята коллизией');
    const shape = t.shapeAt(0, 0);
    eq(shape.full, false, 'но форма — не вся клетка');
    eq(joined(shape.rects[0]), '-16,8,16,16');

    // Верх клетки (пустой) проходит, полоса — нет. Карта 3×2 по 32: left=-48,
    // top=-32; локальный y=-4 — верхняя половина клетки, +12 — полоса.
    truthy(t.fitsAt(-48 + 16, -32 + 12), 'верх пустой части клетки проходим');
    falsy(t.fitsAt(-48 + 16, -32 + 28), 'полоса блокирует');
    truthy($.tilemap.fitsAt('#thin', -48 + 16, -32 + 12), 'то же из пространства имён');

    // rectsOf остаётся клеточным (совместимость), shapesOf — точным.
    eq($.tilemap.rectsOf('#thin', 0).length, 1, 'клеточная занятость сливается в один прямоугольник');
    eq($.tilemap.rectsOf('#thin', 0)[0].h, 2);
    eq($.tilemap.resultOf('#thin').ok, true);

    // Повторная сборка не меняет ни геометрию, ни тела.
    const before = JSON.stringify($.tilemap.shapesOf('#thin'));
    const bodies = tilemapStates.get(t.get(0)).layers[0].bodies.length;
    t.rebuild();
    tickTilemap(1 / 60);
    eq(JSON.stringify($.tilemap.shapesOf('#thin')), before, 'повторная сборка даёт ту же геометрию');
    eq(tilemapStates.get(t.get(0)).layers[0].bodies.length, bodies, 'и то же число тел');

    // sample() ищет место по реальной форме.
    const spot = t.sample(-48 + 16, -32 + 28);
    truthy(spot.found, 'sample нашёл место рядом с полосой');
    truthy(t.fitsAt(spot.x, spot.y), 'найденная точка действительно проходит');
});

test('$.tilemap: occludersOf повторяет partial shapes', () => {
    const t = $.tilemap.create({
        id: 'occ', tile: 32, solid: true, data: ['11'], mapW: 2, mapH: 1,
        tiles: { 1: { shape: STRIP } },
    });
    tickTilemap(1 / 60);
    const segs = $.tilemap.occludersOf('#occ');
    // Карта 2×1 по 32: центр (0,0) → углы (-32,-16). Верх полосы — y = -16+24 = 8.
    eq(segs.length / 4, 6, 'две полосы: верх, низ, два торца');
    eq(joined(segs.slice(0, 4)), '-32,8,0,8', 'верхняя граница полосы, а не клетки');
});

test('$.tilemap: origin и padding дают клетку x=-1 без выхода за буфер', () => {
    const t = $.tilemap.create({
        id: 'pad', tile: 32, solid: true, data: ['11', '11'], mapW: 2, mapH: 2,
        pad: [1, 1, 0, 1], padTile: 1, origin: [0, 0],
    });
    tickTilemap(1 / 60);
    const layer = tilemapStates.get(t.get(0)).layers[0];
    eq(layer.w, 3, 'буфер вырос по X');
    eq(layer.h, 4, 'буфер вырос по Y');
    eq(layer.origin_x, -1, 'origin сдвинут на padding слева');
    eq(layer.origin_y, -1);
    eq(t.tileAt(-1, -1), 1, 'клетка x=-1 внутри буфера');
    eq(t.tileAt(1, 2), 1, 'нижняя рамка тоже внутри');
    eq(t.tileAt(-2, -1), 0, 'за буфером — пусто, а не мусор');
    eq(t.tileAt(2, 3), 0);
    eq($.tilemap.tileIndexAt('#pad', -1, -1), 0);
    eq($.tilemap.tileIndexAt('#pad', -2, -1), -1);
    eq(t.get(0).w, 96, 'габарит узла = буфер');

    // world↔cell: клетка (0,0) — вторая в буфере, её центр в мире (0,-16).
    eq(JSON.stringify($.tilemap.tileToPixel('#pad', 0, 0)), '{"x":0,"y":-16}');
    eq(JSON.stringify($.tilemap.pixelToTile('#pad', 0, -16)), '{"tx":0,"ty":0}');
    eq(JSON.stringify($.tilemap.pixelToTile('#pad', -48 + 16, -64 + 16)), '{"tx":-1,"ty":-1}');

    // Масштаб узла учитывается теми же формулами.
    t.get(0).scale_x = 2;
    t.get(0).scale_y = 2;
    eq(JSON.stringify($.tilemap.tileToPixel('#pad', 0, 0)), '{"x":0,"y":-32}');
    eq(JSON.stringify($.tilemap.pixelToTile('#pad', 0, -32)), '{"tx":0,"ty":0}');

    // Рамка реально уходит в тела: без padding карта была бы проходимой сбоку.
    eq($.tilemap.shapesOf('#pad')[0].tx, -1);
    eq($.tilemap.shapesOf('#pad')[0].ty, -1);
    // Список тайлов тоже в логических координатах.
    const list = t.tilesList();
    eq(list.length, 12, 'весь буфер 3×4 занят');
    truthy(list.some((item) => item.x === -1 && item.y === -1), 'в списке есть клетка (-1,-1)');
    truthy(!list.some((item) => item.x === 2 || item.y === 3), 'клеток за буфером в списке нет');
});

test('$.tilemap: несколько источников и visual region дают каноничные visual ID', () => {
    const saved = { load: engine.loadTexture, size: engine.textureSize, sprite: engine.createSprite };
    const created = [];
    engine.loadTexture = (p) => (p === 'a.png' ? 7 : 9);
    engine.textureSize = (tex) => (tex === 7 ? [64, 64] : [128, 32]);
    engine.createSprite = (tex, x, y, w, h) => { created.push([tex, x, y, w, h]); return 100 + created.length; };
    try {
        installGfx($);
        $.gfx = ctx.gfx;
        const t = $.tilemap.create({
            id: 'vis', tile: 32, src: 'a.png', sources: ['b.png'], data: [1, 2], mapW: 2, mapH: 1,
            tiles: { 2: { visual: { source: 1, tx: 32, ty: 0, w: 32, h: 32 } } },
        });
        tickTilemap(1 / 60);
        ctx.gfx._render();

        const layer = tilemapStates.get(t.get(0)).layers[0];
        eq(layer.sources.length, 2, 'оба источника в списке слоя');
        eq(layer.custom_visual, true, 'визуальный регион не совпал с клеткой листа');
        const v = $.tilemap.visualOf('#vis', 2);
        eq(v.source, 1, 'visual адресует второй источник индексом, а не handle текстуры');
        eq(v.tx, 32);
        eq(v.w, 32);
        eq($.tilemap.visualOf('#vis', 1), null, 'у тайла без visual — обычная клетка листа');
        // Спрайт региона взят из второго источника (tex 9), а не из первого.
        truthy(created.some((c) => c[0] === 9 && c[1] === 32), 'регион вырезан из своего источника');
        eq($.tilemap.visualTable('#vis').length, 4, 'таблица покрывает id листа');
    } finally {
        engine.loadTexture = saved.load;
        engine.textureSize = saved.size;
        engine.createSprite = saved.sprite;
    }
});

test('$.tilemap: лимит тел — failed result и откат, а не молчаливая дырка', () => {
    const saved = { create: engine.createBody, destroy: engine.destroyBody, max: engine.bodies_max };
    const checker = (() => {
        const w = 8, h = 8, d = new Int32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = ((x + y) & 1) ? 1 : 0;
        return d;
    })();
    let created = 0, destroyed = 0;
    engine.createBody = () => { created++; return 200 + created; };
    engine.destroyBody = () => { destroyed++; };
    try {
        // Лимит известен заранее: политика fail не создаёт ни одного тела.
        engine.bodies_max = 3;
        $.tilemap.create({ id: 'lim', tile: 16, solid: true, data: checker, mapW: 8, mapH: 8 });
        tickTilemap(1 / 60);
        const r = $.tilemap.resultOf('#lim');
        eq(r.ok, false, 'карта с неполной коллизией не публикуется');
        eq(r.error, 'body-limit');
        eq(r.planned, 32, 'план тел посчитан');
        eq(r.created, 0, 'ни одного тела не создано');
        eq(r.missing, 32);
        eq(created, 0, 'createBody не вызывался');
        const w = query('#lim')[0];
        eq(w ? wrapOne(w).collisionResult().ok : null, false, 'failed result виден и у узла');

        // partial — прежнее поведение: движок отказывает на 4-м теле.
        created = 0; destroyed = 0;
        engine.createBody = () => (++created > 4 ? -1 : 200 + created);
        $.tilemap.create({ id: 'lim2', tile: 16, solid: true, data: checker, mapW: 8, mapH: 8,
                           limitPolicy: 'partial' });
        tickTilemap(1 / 60);
        const r2 = $.tilemap.resultOf('#lim2');
        eq(r2.ok, false, 'partial тоже сообщает о неполной коллизии');
        eq(r2.error, 'body-limit');
        eq(r2.created, 4);
        eq(r2.missing, 28);
        eq(destroyed, 0, 'partial оставляет созданное');

        // Лимит неизвестен, движок отказывает в процессе: fail снимает всё.
        created = 0; destroyed = 0;
        engine.bodies_max = 0;
        engine.createBody = () => (++created > 5 ? -1 : 200 + created);
        $.tilemap.create({ id: 'lim3', tile: 16, solid: true, data: checker, mapW: 8, mapH: 8 });
        tickTilemap(1 / 60);
        const r3 = $.tilemap.resultOf('#lim3');
        eq(r3.ok, false);
        eq(r3.created, 0, 'частичная коллизия снята');
        eq(r3.attempted, 5, 'сколько успело создаться — видно');
        eq(destroyed, 5, 'все созданные тела уничтожены');
    } finally {
        engine.createBody = saved.create;
        engine.destroyBody = saved.destroy;
        engine.bodies_max = saved.max;
    }
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

test('tileSize сбрасывает вычисленные cols/rows и режет лист заново', () => {
    const saved = { load: engine.loadTexture, size: engine.textureSize, sprite: engine.createSprite };
    engine.loadTexture = () => 7;
    engine.textureSize = () => [128, 64];
    engine.createSprite = () => 100;
    try {
        installGfx($);
        $.gfx = ctx.gfx;

        const t = $.tilemap.create({
            id: 'sheet', src: 'sheet.png', tile: 32, cols: 0, rows: 0,
            data: [1, 2, 3, 4], mapW: 2, mapH: 2,
        });
        const node = t.get(0);
        ctx.gfx._render();                       // первый рендер считает cols/rows
        const layer = tilemapStates.get(node).layers[0];
        eq(layer.cols, 4, 'при тайле 32 колонок 4');
        eq(layer.frames.length, 8, 'кадров 8 (4×2)');

        t.tileSize(16);
        tilemapLayerFrames(layer);
        eq(layer.cols, 8, 'после tileSize(16) колонок 8');
        eq(layer.rows, 4, 'строк 4');
        eq(layer.frames.length, 32, 'кадров 32, а не старые 8');
    } finally {
        engine.loadTexture = saved.load;
        engine.textureSize = saved.size;
        engine.createSprite = saved.sprite;
    }
});

// ---------------------------------------------------------------------------
// §5.1 плана дополировки: solidAt — единый контракт занятости клетки.
//
// Legacy-карта (без таблицы `tiles`) обязана отвечать по слоевому предикату
// `solid`: это ровно тот предикат, из которого физика строит тела
// (occupiedPredicate → fallbackSolidPred). Раньше solidAt для такой карты
// отвечал false ВСЕГДА — сетка, навигация и occluder видели проходимую карту
// там, где стояли тела.
// ---------------------------------------------------------------------------
test('§5.1 solidAt: legacy-карта (solid: true, без таблицы tiles) занята по тайлам', () => {
    const t = $.tilemap.create({
        id: 'legacy', tile: 32, solid: true, data: [1, 0, 0, 2], mapW: 2, mapH: 2,
    });
    tickTilemap(1 / 60);
    truthy(t.solidAt(0, 0), 'тайл 1 — клетка занята');
    falsy(t.solidAt(1, 0), 'пустая клетка не занята');
    falsy(t.solidAt(0, 1), 'пустая клетка не занята');
    truthy(t.solidAt(1, 1), 'тайл 2 — клетка занята');
    falsy(t.solidAt(-1, 0), 'слева за картой — не занята');
    falsy(t.solidAt(2, 0), 'справа за картой — не занята');
    falsy(t.solidAt(0, -1), 'сверху за картой — не занята');
    falsy(t.solidAt(0, 2), 'снизу за картой — не занята');

    // Без таблицы `tiles` клетка и есть тело: solidAt и shapeAt совпадают.
    const shape = t.shapeAt(0, 0);
    truthy(shape && shape.full === true, 'legacy-клетка — полная клетка');
    eq(t.shapeAt(1, 0), null, 'у пустой клетки формы нет');
    eq($.tilemap.shapesOf('#legacy').length, 2, 'тел столько же, сколько занятых клеток');
});

test('§5.1 solidAt: solid: false не делает клетки занятыми', () => {
    const t = $.tilemap.create({
        id: 'nosolid', tile: 32, solid: false, data: [1, 1, 1, 1], mapW: 2, mapH: 2,
    });
    tickTilemap(1 / 60);
    falsy(t.solidAt(0, 0), 'слой явно выключен из коллизий');
    falsy(t.solidAt(1, 1), 'и это не зависит от клетки');
    eq($.tilemap.shapesOf('#nosolid').length, 0, 'и тел у него нет');
});

test('§5.1 solidAt: solid как список id — заняты только перечисленные тайлы', () => {
    const t = $.tilemap.create({
        id: 'ids', tile: 32, solid: [2], data: [1, 2, 3, 0], mapW: 2, mapH: 2,
    });
    tickTilemap(1 / 60);
    falsy(t.solidAt(0, 0), 'тайл 1 не в списке');
    truthy(t.solidAt(1, 0), 'тайл 2 в списке');
    falsy(t.solidAt(0, 1), 'тайл 3 не в списке');
    falsy(t.solidAt(1, 1), 'пустая клетка');
});

// ---------------------------------------------------------------------------
// §5.2 плана: tile → pixel → tile обязан вернуть исходную логическую клетку.
// Проверяются сочетания тайла, origin и клеток, включая отрицательные.
// ---------------------------------------------------------------------------
test('§5.2 tile↔pixel round-trip: тайлы 16/32/128, origin 0 и ≠0, отрицательные клетки', () => {
    const cells = [[0, 0], [1, 1], [2, 2], [-1, 0], [0, -1], [-5, 7]];
    for (const tile of [16, 32, 128]) {
        for (const origin of [[0, 0], [7, -3]]) {
            const geom = { tile, cols: 8, rows: 16, origin_x: origin[0], origin_y: origin[1] };
            for (const [tx, ty] of cells) {
                const p = tileToPixel(geom, tx, ty);
                const back = pixelToTile(geom, p.x, p.y);
                eq(back.tx, tx,
                   `тайл ${tile}, origin ${origin[0]},${origin[1]}: клетка ${tx} вернулась по X`);
                eq(back.ty, ty,
                   `тайл ${tile}, origin ${origin[0]},${origin[1]}: клетка ${ty} вернулась по Y`);
            }
        }
    }
    // Нецентровой пиксель внутри клетки принадлежит той же клетке: иначе
    // round-trip прошёл бы и у сломанного floor().
    for (const tile of [16, 128]) {
        const geom = { tile, cols: 8, rows: 16, origin_x: 3, origin_y: -2 };
        for (const [tx, ty] of cells) {
            const p = tileToPixel(geom, tx, ty);
            const left = pixelToTile(geom, p.x - tile / 2 + 0.5, p.y);
            const top = pixelToTile(geom, p.x, p.y - tile / 2 + 0.5);
            eq(left.tx, tx, `тайл ${tile}: левый край клетки ${tx} принадлежит ей`);
            eq(top.ty, ty, `тайл ${tile}: верхний край клетки ${ty} принадлежит ей`);
        }
    }
});

finish();
