// ===========================================================================
// Юнит-тест TileMap: Y-sort и террейны (qjs, без движка).
//
// Проверяет:
//   * сбор видимых тайлов с их мировой Y (отсечение по камере сохранено);
//   * чередование тайлов и «сущностей» по Y через полосовой flush;
//   * работу хуков $.gfx._ysortFlush / _ysortFlushEnd (интеграция с render.js);
//   * террейны: маска → тайл, переходы, сохранение/загрузка набора.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/tilemap_ysort_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, joined, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import { installGfx } from '../../src/highlevel/render.js';
import { installWorld } from '../../src/highlevel/world.js';
import {
    installTilemap, tickTilemap,
    mergeTilesByY, terrainKey, terrainTile, normalizeTerrain,
} from '../../src/highlevel/tilemap.js';

// Минимальный $: создание узлов по '<тег>' и поиск по селектору.
function makeDollar() {
    return function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
}

const $ = makeDollar();
installWorld($);
installGfx($);
$.gfx = ctx.gfx;
installTilemap($);

// Камера 800×600 в начале координат — те же значения, что у мока engine.
const CAM = { x: 0, y: 0, zoom: 1, w: 800, h: 600, shake_x: 0, shake_y: 0 };
const worldY = (screenY) => screenY - CAM.h / 2;

// ---------------------------------------------------------------------------
// Чистое слияние списков
// ---------------------------------------------------------------------------

test('mergeTilesByY сливает упорядоченные по Y списки слоёв', () => {
    const a = [{ y: 0 }, { y: 2 }];
    const b = [{ y: 1 }, { y: 3 }];
    eq(joined(mergeTilesByY([a, b]).map((t) => t.y)), '0,1,2,3');
    eq(mergeTilesByY([a]).length, 2);
    eq(mergeTilesByY([]).length, 0);
    eq(mergeTilesByY([[], [] ]).length, 0);
});

// ---------------------------------------------------------------------------
// Видимые тайлы и отсечение
// ---------------------------------------------------------------------------

test('visibleTiles отдаёт только видимые тайлы, отсортированные по Y', () => {
    const m = $.tilemap.create({
        id: 'vis', src: 'assets/atlas.png', tile: 32, cols: 8,
        data: new Array(1600).fill(1), mapW: 40, mapH: 40,
    });
    const list = $.tilemap.visibleTiles(m, CAM);
    truthy(list.length > 0, 'видимые тайлы есть');
    truthy(list.length < 1600, 'карта не рисуется целиком: ' + list.length);
    for (let i = 1; i < list.length; i++) {
        truthy(list[i].y >= list[i - 1].y, 'Y не убывает на позиции ' + i);
    }
    // Тайл несёт и мировые координаты, и мировые размеры.
    eq(list[0].w, 32);
    eq(list[0].h, 32);
    // Первый видимый тайл — у верхнего края вьюпорта, а не у края карты.
    truthy(list[0].y >= CAM.y - CAM.h / 2 - 32 && list[0].y <= CAM.y - CAM.h / 2 + 32,
        'первый видимый тайл у верхнего края экрана: ' + list[0].y);
    eq($.tilemap.visibleTiles('#vis', CAM).length, list.length);
    eq($.tilemap.visibleTiles(m, CAM, { layerIndex: 5 }).length, 0, 'нет такого слоя');
});

test('visibleRange уважает масштаб узла и пустые слои', () => {
    const layer = { tile: 32, w: 4, h: 4, data: new Int32Array(16).fill(1) };
    const geom = { x: 0, y: 0, w: 128, h: 128, scale_x: 2, scale_y: 2 };
    const r = $.tilemap.visibleRange(layer, geom, CAM);
    // Карта 256×256 в мире, камера 800×600 — видна целиком.
    eq(JSON.stringify(r), JSON.stringify({ x0: 0, y0: 0, x1: 3, y1: 3 }));
    const none = $.tilemap.visibleRange({ tile: 32, w: 0, h: 0 }, geom, CAM);
    truthy(none.x1 < none.x0, 'пустой слой вне диапазона');
});

// ---------------------------------------------------------------------------
// Y-sort: полосы и чередование с сущностями
// ---------------------------------------------------------------------------

/** Рекордер порядка: пишем мировую Y каждого нарисованного спрайта. */
function makeRecorder() {
    const order = [];
    $.gfx = { push: { sprite: (sprite, x, y) => order.push(worldY(y)) } };
    return order;
}

test('flushTilesUpTo чередует тайлы и сущности по Y', () => {
    const order = makeRecorder();
    const m = $.tilemap.create({
        id: 'band', src: 'assets/atlas.png', tile: 32, cols: 8,
        data: new Array(400).fill(1), mapW: 20, mapH: 20, ysort: true,
    });
    $.tilemap.ysortReset(m);

    const rows = [];
    for (const entityY of [-100, 0, 100, 200]) {
        $.tilemap.flushTilesUpTo(m, CAM, entityY);
        order.push(null);            // здесь рисовалась бы сущность на entityY
        rows.push({ entityY, index: order.length - 1 });
    }
    $.tilemap.flushTiles(CAM);       // остаток — тайлы ниже всех сущностей

    // Каждый тайл нарисован ровно один раз (курсор, без повторов).
    eq(order.filter((v) => v !== null).length, 400, 'все видимые тайлы по одному разу');

    for (const row of rows) {
        for (let i = 0; i < row.index; i++) {
            if (order[i] === null) continue;
            truthy(order[i] <= row.entityY, `тайл до сущности ${row.entityY} не выше неё`);
        }
        for (let i = row.index + 1; i < order.length; i++) {
            if (order[i] === null) continue;
            truthy(order[i] > row.entityY, `тайл после сущности ${row.entityY} ниже неё`);
        }
    }
    // Порядок самих тайлов тоже по Y.
    const tiles = order.filter((v) => v !== null);
    for (let i = 1; i < tiles.length; i++) truthy(tiles[i] >= tiles[i - 1], 'тайлы по Y');
});

test('хуки _ysortFlush/_ysortFlushEnd дают тот же порядок', () => {
    truthy(typeof ctx.gfx._ysortFlush === 'function', 'хук начала есть');
    truthy(typeof ctx.gfx._ysortFlushEnd === 'function', 'хук конца есть');

    const order = makeRecorder();
    const m = $.tilemap.create({
        id: 'hooks', src: 'assets/atlas.png', tile: 32, cols: 8,
        data: new Array(400).fill(1), mapW: 20, mapH: 20, ysort: true,
    });
    $.tilemap.ysortReset(m);

    const rows = [];
    for (const entityY of [-50, 50, 150]) {
        ctx.gfx._ysortFlush(CAM, entityY);
        order.push(null);
        rows.push({ entityY, index: order.length - 1 });
    }
    ctx.gfx._ysortFlushEnd(CAM);

    eq(order.filter((v) => v !== null).length, 400);
    for (const row of rows) {
        for (let i = 0; i < row.index; i++) {
            if (order[i] === null) continue;
            truthy(order[i] <= row.entityY, 'тайл до сущности по Y');
        }
        for (let i = row.index + 1; i < order.length; i++) {
            if (order[i] === null) continue;
            truthy(order[i] > row.entityY, 'тайл после сущности по Y');
        }
    }
    // После конца кадра добивать нечего — курсор на месте.
    eq(ctx.gfx._ysortFlushEnd(CAM), 0, 'повторный flush ничего не рисует');
});

test('рендер Y-sort без хука рисует тайлы сам, по Y', () => {
    ctx.nodes.length = 0;             // изолируем сцену
    const order = makeRecorder();
    $.tilemap.create({
        id: 'fallback', src: 'assets/atlas.png', tile: 32, cols: 8,
        data: new Array(400).fill(1), mapW: 20, mapH: 20, ysort: true,
    });
    ctx.gfx._render();
    truthy(order.length > 0, 'тайлы нарисованы');
    for (let i = 1; i < order.length; i++) truthy(order[i] >= order[i - 1], 'Y не убывает');
});

test('.ysort и $.tilemap.ysort переключают режим', () => {
    const m = $.tilemap.create({ id: 'toggle', tile: 32, data: [1], mapW: 1, mapH: 1 });
    eq($.tilemap.ysort(m), true);
    eq(m.ysort(false), m, 'метод узла цепочный');
    eq($.tilemap.ysort(m, false), false);
    $.tilemap.ysortReset(m);
});

// ---------------------------------------------------------------------------
// Террейны
// ---------------------------------------------------------------------------

test('normalizeTerrain / terrainKey / terrainTile — чистые', () => {
    const base = normalizeTerrain({
        name: 'grass', mode: 'blob47', base: 5,
        transitions: { [terrainKey(0, 'blob47')]: 40 },
    });
    eq(base.name, 'grass');
    eq(base.mode, 'blob47');
    eq(base.base, 5);
    eq(base.solid, true, 'по умолчанию «свой» — любой непустой');
    eq(terrainTile(0, base), 40, 'явный переход важнее раскладки');
    eq(terrainTile(255, base), 5 + 46, 'без перехода — base + номер формы');
    eq(terrainKey(0, 'bit16'), 0);
    eq(terrainKey(5, 'bit16'), 5, 'для bit16 ключ — сама маска');
    const b16 = normalizeTerrain({ mode: 'bit16', transitions: { 15: 77 } });
    eq(terrainTile(15, b16), 77);
    eq(normalizeTerrain({}).mode, 'bit16');
});

test('.autotile({ mode: "terrain" }) выбирает тайл по маске переходов', () => {
    const t = $.tilemap.create({
        id: 'terr', tile: 16, data: ['000', '010', '000'], mapW: 3, mapH: 3,
        terrains: {
            grass: { mode: 'blob47', base: 1, transitions: { [terrainKey(0, 'blob47')]: 9 } },
        },
    });
    t.autotile({ mode: 'terrain', terrain: 'grass' });
    eq(t.tileAt(1, 1), 9, 'одиночный тайл — форма 0 → переход');
    eq(t.tileAt(0, 0), 0, 'пусто остаётся пустым');
});

test('террейн без переходов падает на общую раскладку blob47', () => {
    const t = $.tilemap.create({ id: 'terr47', tile: 16, data: ['111', '111', '111'], mapW: 3, mapH: 3 });
    t.autotile({ mode: 'terrain', terrain: { name: 'plain', mode: 'blob47' } });
    // У центрального тайла все 8 соседей сплошные → форма 46 → base 1 + 46.
    eq(t.tileAt(1, 1), 47);
});

test('террейн не трогает непустые тайлы вне набора', () => {
    const t = $.tilemap.create({
        id: 'terr-mix', tile: 16, data: ['2..', '...', '..1'], mapW: 3, mapH: 3,
        terrains: { grass: { mode: 'bit16', solid: [2], transitions: { 0: 20 } } },
    });
    t.autotile({ mode: 'terrain', terrain: 'grass' });
    eq(t.tileAt(0, 0), 20, '«свой» тайл перерисован по переходу');
    eq(t.tileAt(2, 2), 1, 'чужой тайл остался как был');
    eq(t.tileAt(1, 1), 0, 'пусто осталось пустым');
});

test('terrainData/loadTerrains сохраняют и восстанавливают набор', () => {
    const src = $.tilemap.create({
        id: 'save', tile: 16, data: ['000', '010', '000'], mapW: 3, mapH: 3,
        terrains: {
            grass: {
                mode: 'blob47', base: 3, border: true,
                transitions: { [terrainKey(0, 'blob47')]: 12 }, solid: [1],
            },
        },
    });
    const data = src.terrainData();
    eq(data.grass.mode, 'blob47');
    eq(data.grass.base, 3);
    eq(data.grass.border, true);
    eq(joined(data.grass.solid), '1');
    eq(data.grass.transitions[terrainKey(0, 'blob47')], 12);

    const dst = $.tilemap.create({ id: 'load', tile: 16, data: ['000', '010', '000'], mapW: 3, mapH: 3 });
    eq($.tilemap.loadTerrains(dst, data), 1, 'набор загружен');
    dst.autotile({ mode: 'terrain', terrain: 'grass' });
    eq(dst.tileAt(1, 1), 12, 'после загрузки переход тот же');
    eq($.tilemap.terrain(dst, 'grass').base, 3, 'набор доступен по имени');
    eq($.tilemap.terrain(dst, 'nope'), null);
});

test('terrains из атрибутов карты доступны до autotile', () => {
    const t = $.tilemap.create({
        id: 'attr', tile: 16, data: [1], mapW: 1, mapH: 1,
        terrains: { rock: { mode: 'bit16', base: 20 } },
    });
    const set = $.tilemap.terrain(t, 'rock');
    eq(set.mode, 'bit16');
    eq($.tilemap.terrain(t).length, 1);
});

test('tickTilemap не ломает карту в режиме Y-sort', () => {
    const t = $.tilemap.create({
        id: 'tick', src: 'assets/atlas.png', tile: 16, cols: 4, solid: true,
        data: [1, 1, 0, 1], mapW: 2, mapH: 2, ysort: true,
    });
    tickTilemap(1 / 60);
    eq(t.tileAt(0, 0), 1);
    falsy(t.get(0).removed);
});

finish();
