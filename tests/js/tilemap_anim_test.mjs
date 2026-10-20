// ===========================================================================
// Покадровая анимация тайлов в *.tilemap.json: обычный JSON
//   animations: [{ tile, frames: [id…], fps | interval, random?, layer? }]
// Проверяется без движка (qjs): JS-валидатор, нормализация, применение к
// слоям через существующий tickTilemap и выбор кадра в реальном отрисовщике.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/tilemap_anim_test.mjs
// ===========================================================================

import { test, eq, truthy, joined, finish } from './_harness.mjs';
import * as K from '../../sdk/lib/kinds/tilemap.js';
import { ctx, Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import { installGfx } from '../../src/highlevel/render.js';
import {
    installTilemap, tickTilemap, tilemapStates,
    normalizeTileAnimation, applyTileAnimations, tilesetFrame,
} from '../../src/highlevel/tilemap.js';

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
installGfx($);
$.gfx = ctx.gfx;

// --- Рантайм-отрисовка: кадр берётся по игровому времени -----------------------------------------

test('рендер: frames из animations выбираются по времени и детерминированы', () => {
    const saved = { load: engine.loadTexture, size: engine.textureSize, sprite: engine.createSprite };
    engine.loadTexture = () => 7;
    engine.textureSize = () => [64, 64];
    engine.createSprite = (tex, x, y) => 1 + x / 32 + (y / 32) * 2;
    const orig = ctx.gfx.push.sprite;
    const drawn = [];
    try {
        const t = $.tilemap.create({
            id: 'anim-draw', tile: 32, src: 'sheet.png', cols: 2, data: [1], mapW: 1, mapH: 1,
            animations: [{ tile: 1, frames: [2, 3], fps: 10 }],
        });
        const node = t.get(0);
        const tm = tilemapStates.get(node);
        eq(tm.layers[0].anims.byId[1].frames.length, 2, 'анимация применена при создании узла');
        ctx.gfx.push.sprite = function (sprite) { drawn.push(sprite); return orig.apply(this, arguments); };

        ctx.gfx._render();
        eq(drawn.length, 1, 'нарисован ровно один тайл');
        eq(drawn[0], 2, 't=0 → первый кадр (id 2)');

        tickTilemap(0.15);
        drawn.length = 0;
        ctx.gfx._render();
        eq(drawn[0], 3, 't=0.15 при интервале 100 мс → второй кадр (id 3)');

        tickTilemap(0.1);
        drawn.length = 0;
        ctx.gfx._render();
        eq(drawn[0], 2, 't=0.25 → снова первый кадр: цикл детерминирован');
    } finally {
        ctx.gfx.push.sprite = orig;
        engine.loadTexture = saved.load;
        engine.textureSize = saved.size;
        engine.createSprite = saved.sprite;
    }
});

test('рендер .tileset: interval в мс идёт от игрового времени', () => {
    const saved = { load: engine.loadTexture, size: engine.textureSize, sprite: engine.createSprite };
    engine.loadTexture = () => 7;
    engine.textureSize = () => [64, 64];
    engine.createSprite = (tex, x, y) => 1 + x / 32 + (y / 32) * 2;
    const orig = ctx.gfx.push.sprite;
    const drawn = [];
    try {
        const t = $.tilemap.create({ id: 'row-anim', tile: 32, src: 'sheet.png', cols: 2, data: [1], mapW: 1, mapH: 1 });
        t.tileset({ frames: 2, fps: 10 });
        ctx.gfx.push.sprite = function (sprite) { drawn.push(sprite); return orig.apply(this, arguments); };
        ctx.gfx._render();
        eq(drawn[drawn.length - 1], 1, 't=0 → первая строка листа');
        tickTilemap(0.15);
        drawn.length = 0;
        ctx.gfx._render();
        eq(drawn[drawn.length - 1], 3, 't=0.15 при fps 10 → вторая строка листа (100 мс на кадр)');
    } finally {
        ctx.gfx.push.sprite = orig;
        engine.loadTexture = saved.load;
        engine.textureSize = saved.size;
        engine.createSprite = saved.sprite;
    }
});

// --- Чистая нормализация -------------------------------------------------------------------------

test('normalizeTileAnimation: fps → interval, interval важнее fps, значения по умолчанию', () => {
    const a = normalizeTileAnimation({ tile: 5, frames: [6, 7], fps: 8 });
    eq(a.tile, 5);
    eq(joined(a.frames), '6,7');
    eq(a.interval, 125);
    eq(a.random, false);
    eq(a.offset, 0);
    eq(a.layer, -1);

    const b = normalizeTileAnimation({ tile: 5, frames: [6, 7], fps: 8, interval: 50, random: true, offset: 7, layer: 1 });
    eq(b.interval, 50, 'явный interval важнее fps');
    eq(b.random, true);
    eq(b.offset, 7);
    eq(b.layer, 1);

    eq(normalizeTileAnimation({ tile: 5, frames: [6], ms: 300 }).interval, 300);
    for (const bad of [null, {}, { tile: 0, frames: [1] }, { tile: 1, frames: [] }, { tile: 1, frames: [0] },
                       { tile: 1, frames: new Array(17).fill(1) }, { tile: 1, frames: [1], fps: 0 }]) {
        eq(normalizeTileAnimation(bad), null, JSON.stringify(bad));
    }
});

test('применение: по умолчанию на все слои, entry.layer ограничивает один', () => {
    const t = $('<tilemap>', { id: 'anims-layers', tile: 16, layers: [
        { name: 'a', data: [[1]] }, { name: 'b', data: [[1]] },
    ] });
    t.animations([{ tile: 1, frames: [2, 3], layer: 1 }]);
    const tm = tilemapStates.get(t.get(0));
    eq(tm.layers[0].anims, null, 'слой 0 не затронут');
    eq(tm.layers[1].anims.byId[1].frames.length, 2);
    const list = t.tileAnimations();
    eq(list.length, 1);
    eq(list[0].layer, 1);
    eq(list[0].interval, 200, 'по умолчанию 200 мс');

    t.animations([{ tile: 2, frames: [1] }]);
    eq(tm.layers[0].anims.byId[2].tile, 2);
    eq(tm.layers[1].anims.byId[2].tile, 2);
    eq(t.tileAnimations().length, 2, 'без layer — запись в обоих слоях');
    t.animations(null);
    eq(t.tileAnimations().length, 0, 'animations(null) выключает');
});

test('время анимации двигает tickTilemap и видно в геттере', () => {
    const t = $.tilemap.create({ id: 'anim-time', tile: 16, data: [1], mapW: 1, mapH: 1,
        animations: [{ tile: 1, frames: [2, 3], fps: 10 }] });
    const tm = tilemapStates.get(t.get(0));
    tickTilemap(0.25);
    eq(tm.layers[0].anims.time, 0.25);
    eq(t.tileAnimations()[0].fps, 10);
    eq(applyTileAnimations(tm, [{ tile: 1, frames: [2, 3], interval: 50 }]), 1);
    eq(t.tileAnimations()[0].interval, 50);
});

test('время анимации берётся из игрового времени (пауза/масштаб)', () => {
    const saved = ctx.time;
    ctx.time = { delta: () => 0.5 };
    try {
        const t = $.tilemap.create({ id: 'anim-game-time', tile: 16, data: [1], mapW: 1, mapH: 1,
            animations: [{ tile: 1, frames: [2, 3], fps: 10 }] });
        const tm = tilemapStates.get(t.get(0));
        tickTilemap(0.01);
        eq(tm.layers[0].anims.time, 0.5, 'сырой dt кадра не двигает анимацию: только игровое время');
        ctx.time = { delta: () => 0 };
        tickTilemap(0.01);
        eq(tm.layers[0].anims.time, 0.5, 'пауза (delta 0) останавливает анимацию');
    } finally {
        ctx.time = saved;
    }
});

test('tilesetFrame: детерминированный цикл (общая функция с .tileset)', () => {
    eq(tilesetFrame(0, 100, 3), 0);
    eq(tilesetFrame(250, 100, 3), 2);
    eq(tilesetFrame(300, 100, 3), 0);
    eq(tilesetFrame(-50, 100, 3), 2);
});

// --- JS-валидатор формата ------------------------------------------------------------------------

const base = () => ({
    version: 1, tile: 16, src: 'a.png', cols: 4,
    layers: [{ name: 'ground', data: [[1, 2], [0, 1]] }],
});
const codes = (doc) => K.validate(doc).map((d) => d.severity + ':' + d.code).sort();

test('animations: корректная запись проходит, summary её считает', () => {
    const d = base();
    d.animations = [
        { tile: 1, frames: [2, 3], fps: 8 },
        { tile: 4, frames: [5, 6, 7], interval: 120, random: true, offset: 30, layer: 0 },
    ];
    eq(joined(codes(d)), '');
    truthy(K.summary(d).includes('анимаций 2'));
});

test('animations: не массив и перебор записей — ANIM', () => {
    const d = base();
    d.animations = { tile: 1, frames: [2] };
    eq(joined(codes(d)), 'error:SDK_TILEMAP_ANIM');
    d.animations = new Array(65).fill({ tile: 1, frames: [2, 3] });
    eq(joined(codes(d)), 'error:SDK_TILEMAP_ANIM');
    d.animations = [];
    eq(joined(codes(d)), '', 'пустой список — то же, что нет анимаций');
});

test('animations: tile/frames/fps/interval/random/layer проверяются', () => {
    const d = base();
    const bad = [
        null,
        { frames: [2, 3] },
        { tile: 0, frames: [2, 3] },
        { tile: 1 },
        { tile: 1, frames: [] },
        { tile: 1, frames: [0] },
        { tile: 1, frames: new Array(17).fill(1) },
        { tile: 1, frames: [2, 65536] },
        { tile: 1, frames: [2, 3], fps: 0 },
        { tile: 1, frames: [2, 3], fps: 1001 },
        { tile: 1, frames: [2, 3], fps: '8' },
        { tile: 1, frames: [2, 3], interval: 0 },
        { tile: 1, frames: [2, 3], ms: 70000 },
        { tile: 1, frames: [2, 3], random: 1 },
        { tile: 1, frames: [2, 3], offset: '0' },
        { tile: 1, frames: [2, 3], layer: 16 },
    ];
    for (const spec of bad) {
        d.animations = [spec];
        eq(joined(codes(d)), 'error:SDK_TILEMAP_ANIM', JSON.stringify(spec));
    }
});

test('animations: несколько плохих записей — несколько диагностик', () => {
    const d = base();
    d.animations = [{ tile: 0, frames: [1] }, { tile: 1, frames: [0] }, { tile: 2, frames: [3] }];
    eq(joined(codes(d)), 'error:SDK_TILEMAP_ANIM,error:SDK_TILEMAP_ANIM');
});

finish();
