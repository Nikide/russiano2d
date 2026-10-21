// ===========================================================================
// Террейны в *.tilemap.json: обычный JSON + правила проверки и рантайм.
//
// Проверяется без движка (qjs): JS-валидатор набора (sdk/lib/kinds/tilemap.js)
// и то, что <tilemap> применяет набор через существующий autotile-путь
// (src/highlevel/tilemap.js), сохраняя исходную форму слоя.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/tilemap_terrain_test.mjs
// ===========================================================================

import { test, eq, truthy, joined, finish } from './_harness.mjs';
import * as K from '../../editor/lib/shared/kinds/tilemap.js';
import { Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import { installTilemap } from '../../src/highlevel/tilemap.js';

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

const base = () => ({
    version: 1, tile: 16, src: 'a.png', cols: 4, solid: [1],
    layers: [{ name: 'ground', data: [[1, 1], [0, 1]] }],
});

const codes = (doc) => K.validate(doc).map((d) => d.severity + ':' + d.code).sort();

test('террейн в обычном JSON проходит без ошибок', () => {
    const d = base();
    d.terrains = { grass: { mode: 'blob47', base: 1, border: true, solid: [1], transitions: { 0: 33, 255: 40 } } };
    d.autotile = { mode: 'terrain', terrain: 'grass' };
    eq(joined(codes(d)), '');
    eq(K.summary(d).includes('террейнов 1'), true);
});

test('autotile mode: terrain требует имя набора', () => {
    const d = base();
    d.autotile = { mode: 'terrain' };
    eq(joined(codes(d)), 'error:SDK_TILEMAP_AUTOTILE');
    d.autotile = { mode: 'terrain', terrain: '' };
    eq(joined(codes(d)), 'error:SDK_TILEMAP_AUTOTILE');
    d.autotile = { mode: 'terrain', terrain: 'grass' };
    eq(joined(codes(d)), '');
});

test('autotile: неизвестный режим и base вне диапазона — AUTOTILE', () => {
    const d = base();
    d.autotile = { mode: 'hex' };
    eq(joined(codes(d)), 'error:SDK_TILEMAP_AUTOTILE');
    d.autotile = { mode: 'bit16', base: 0 };
    eq(joined(codes(d)), 'error:SDK_TILEMAP_AUTOTILE');
    d.autotile = { mode: 'bit16', base: 1 };
    eq(joined(codes(d)), '');
});

test('terrains: не объект — TERRAIN, пустое имя — TERRAIN', () => {
    const d = base();
    d.terrains = [];
    eq(joined(codes(d)), 'error:SDK_TILEMAP_TERRAIN');
    d.terrains = { '': { mode: 'bit16' } };
    eq(joined(codes(d)), 'error:SDK_TILEMAP_TERRAIN');
});

test('terrains: mode/base/border/solid проверяются как у рантайма', () => {
    const d = base();
    for (const spec of [
        { mode: 'terrain' }, { base: 0 }, { base: 65536 }, { border: 'да' },
        { solid: [0] }, { solid: 'all' },
    ]) {
        d.terrains = { grass: spec };
        eq(joined(codes(d)), 'error:SDK_TILEMAP_TERRAIN', JSON.stringify(spec));
    }
    d.terrains = { grass: { mode: 'bit16', base: 1, border: false, solid: true } };
    eq(joined(codes(d)), '');
});

test('terrains: transitions — ключ 0..255, значение id 1..65535', () => {
    const d = base();
    for (const tr of [{ 256: 1 }, { '-1': 1 }, { '1.5': 1 }, { 0: 0 }, { 0: 65536 }, { ' ': 1 }, [], 'x']) {
        d.terrains = { grass: { transitions: tr } };
        eq(joined(codes(d)), 'error:SDK_TILEMAP_TERRAIN', JSON.stringify(tr));
    }
    d.terrains = { grass: { transitions: { 0: 1, 15: 16, '255': 40 } } };
    eq(joined(codes(d)), '');
    d.terrains = { grass: { tiles: { 3: 9 } } };
    eq(joined(codes(d)), '', 'tiles — псевдоним transitions, как в normalizeTerrain');
});

test('terrains: два плохих набора — две диагностики', () => {
    const d = base();
    d.terrains = { bad1: { mode: 'x' }, bad2: { base: 0 }, good: { base: 2 } };
    eq(joined(codes(d)), 'error:SDK_TILEMAP_TERRAIN,error:SDK_TILEMAP_TERRAIN');
});

test('рантайм: terrain-автотайл перерисовывает «свои» тайлы по маске', () => {
    const t = $.tilemap.create({
        id: 'ter', tile: 16,
        terrains: { grass: { mode: 'bit16', base: 1, solid: [1], transitions: { 12: 40 } } },
        data: [1, 1, 0, 1], mapW: 2, mapH: 2,
    });
    t.autotile({ mode: 'terrain', terrain: 'grass' });
    // маски 2×2 при border:false: (0,0)=E=2, (1,0)=W|S=12, (0,1)=пусто, (1,1)=N=1.
    eq(joined(t.tilesData()), '3,40,0,2');
});

test('рантайм: чужой непустой тайл террейн не трогает', () => {
    const t = $.tilemap.create({
        id: 'ter2', tile: 16,
        terrains: { grass: { mode: 'bit16', base: 1, solid: [1] } },
        data: [1, 2, 0, 2], mapW: 2, mapH: 2,
    });
    t.autotile({ mode: 'terrain', terrain: 'grass' });
    eq(joined(t.tilesData()), '1,2,0,2', 'id 2 не входит в solid и остаётся как был');
    // Исходная форма сохранена: повторный автоподбор идемпотентен.
    t.autotile({ mode: 'terrain', terrain: 'grass' });
    eq(joined(t.tilesData()), '1,2,0,2');
});

test('рантайм: terrainData округляется через JSON и loadTerrains', () => {
    const t = $.tilemap.create({
        id: 'ter3', tile: 16,
        terrains: { grass: { mode: 'blob47', base: 1, border: true, solid: [1], transitions: { 255: 40 } } },
        data: [1], mapW: 1, mapH: 1,
    });
    const saved = JSON.parse(JSON.stringify(t.terrainData()));
    eq(saved.grass.mode, 'blob47');
    eq(saved.grass.border, true);
    eq(saved.grass.solid[0], 1);
    eq(saved.grass.transitions['255'], 40);

    const t2 = $.tilemap.create({ id: 'ter4', tile: 16, data: [1], mapW: 1, mapH: 1 });
    eq($.tilemap.loadTerrains(t2, saved), 1);
    t2.autotile({ mode: 'terrain', terrain: 'grass' });
    eq(t2.tileAt(0, 0), 40, 'blob47: border=true → маска 255 → явный переход 255 → 40');
});

test('рантайм: набор из описания регистрируется прямо в autotile()', () => {
    const t = $.tilemap.create({ id: 'ter5', tile: 16, data: [1, 1], mapW: 2, mapH: 1 });
    t.autotile({ mode: 'terrain', terrain: { name: 'sand', base: 5, solid: [1], transitions: { 2: 99 } } });
    eq(joined(t.tilesData()), '99,13', 'описание зарегистрировано и применено (base 5: 5+8=13)');
    truthy($.tilemap.terrain('#ter5', 'sand'), 'набор виден по имени');
});

finish();
