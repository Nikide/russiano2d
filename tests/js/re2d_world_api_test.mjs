// ===========================================================================
// `$.re2dWorld` high-level API: flat atlas world sprites + unified trace.
//
// Нативное ядро подменяется записывающей заглушкой, поэтому проверяется ровно
// JS-контракт публичного API: какие аргументы уходят в C, какие ошибки
// отклоняются до C, как результат trace снова превращается в узел `$`.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/re2d_world_api_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';

const calls = { atlasAdd: [], atlasRemove: [], actorAdd: [], actorRemove: [],
                hitAdd: [], hitRemove: [], trace: [], traceAll: [], dispose: 0 };

const native = {
    info: () => ({ poseBudget: 1, poseStep: 3 }),
    quality: () => {},
    atlasAdd: (...args) => calls.atlasAdd.push(args),
    atlasRemove: (node) => calls.atlasRemove.push(node),
    actorAdd: (node) => calls.actorAdd.push(node),
    actorRemove: (node) => calls.actorRemove.push(node),
    hitAdd: (...args) => calls.hitAdd.push(args),
    hitRemove: (node) => calls.hitRemove.push(node),
    trace: (...args) => {
        calls.trace.push(args);
        return { type: 2, fraction: 0.5, proxy: 0, node: 0, x: 1, y: 2, h: 3,
                 surface: -1, span: 1, normalX: 0, normalY: -1 };
    },
    traceAll: (...args) => {
        calls.traceAll.push(args);
        return [
            { type: 1, fraction: 0.25, proxy: -1, node: -1, x: 0, y: 0, h: 0,
              surface: 2, span: 0, normalX: 0, normalY: 1 },
            { type: 2, fraction: 0.75, proxy: 0, node: 0, x: 1, y: 2, h: 3,
              surface: -1, span: 1, normalX: 0, normalY: -1 },
        ];
    },
    dispose: () => { calls.dispose++; },
};

engine.re2d = {
    view: () => true,
    worldLoad: () => native,
};

const $ = createApi();

function spawn(id) {
    return $('<sprite>', { id }).at(10, 20).depth(5).size(40, 100).angle(0);
}

function throws(kind, fn, message) {
    let caught = null;
    try { fn(); } catch (error) { caught = error; }
    truthy(caught, message + ' — ожидалось исключение');
    truthy(caught instanceof kind, message + ' — ожидался ' + kind.name + ', получено ' + caught);
}

test('$.re2dWorld и $.re2dEnabled доступны как публичный вход', () => {
    eq(typeof $.re2dWorld.load, 'function');
    eq(typeof $.re2dWorld.fromJSON, 'function');
    eq($.re2dEnabled, true);
});

test('world.sprite уходит в нативный atlasAdd с нормализованными аргументами', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const node = spawn('imp');
    const returned = world.sprite(node, {
        atlas: 'enemies/imp.png', columns: 5, rows: 8, directions: 5, mirror: true,
        cell: { w: 198, h: 198 }, pivot: 'feet', width: 150, height: 150,
    });
    eq(returned, world);
    const a = calls.atlasAdd[0];
    eq(a[0], node.get ? node.get(0) : node);
    eq(a[1], 'enemies/imp.png');
    eq(a[2], 5); eq(a[3], 8); eq(a[4], 5); eq(a[5], 1);
    eq(a[6], 198); eq(a[7], 198); eq(a[8], 1); eq(a[9], 0.5); eq(a[10], 1);
    eq(a[11], 150); eq(a[12], 150); eq(a[13], 0);
    world.dispose();
});

test('world.sprite: defaults берутся из узла и pivot center', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const node = spawn('big');
    world.sprite(node, { atlas: 'a.png', cell: { w: 64, h: 64 }, pivot: 'center' });
    const a = calls.atlasAdd[calls.atlasAdd.length - 1];
    eq(a[2], 1); eq(a[3], 1); eq(a[4], 1); eq(a[5], 0);          // 1 направление, без mirror
    eq(a[8], 0); eq(a[9], 0.5); eq(a[10], 0.5);                  // center pivot
    eq(a[11], 40); eq(a[12], 100);                               // размер узла
    world.dispose();
});

test('world.sprite отклоняет недопустимую конфигурацию до нативного вызова', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const node = spawn('bad');
    const before = calls.atlasAdd.length;
    throws(TypeError, () => world.sprite(node, { cell: { w: 64, h: 64 } }), 'нет atlas');
    throws(RangeError, () => world.sprite(node, { atlas: 'a.png', cell: { w: 0, h: 64 } }), 'cell 0');
    throws(RangeError, () => world.sprite(node, { atlas: 'a.png', cell: { w: 64, h: 64 }, pivot: 'neck' }), 'неизвестный pivot');
    throws(RangeError, () => world.sprite(node, { atlas: 'a.png', cell: { w: 64, h: 64 }, blend: 'glow' }), 'неизвестный blend');
    throws(RangeError, () => world.sprite(node, { atlas: 'a.png', cell: { w: 64, h: 64 }, directions: 32 }), 'слишком много направлений');
    eq(calls.atlasAdd.length, before, 'нативный вызов не случился');
    world.dispose();
});

test('world.hit регистрирует прокси и world.remove снимает оба registry', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const enemy = spawn('enemy');
    const crate = spawn('crate');
    world.hit(enemy, { radius: 20, height: 100, category: 'enemy' });
    world.hit(crate, { category: 'breakable', height: 50 });
    const first = calls.hitAdd[0], second = calls.hitAdd[1];
    eq(first[0], enemy.get ? enemy.get(0) : enemy); eq(first[1], 20); eq(first[2], 0); eq(first[3], 100); eq(first[4], 1);
    eq(second[1], 24); eq(second[4], 2);
    world.remove(enemy);
    const raw = enemy.get ? enemy.get(0) : enemy;
    eq(calls.hitRemove[calls.hitRemove.length - 1], raw);
    eq(calls.atlasRemove[calls.atlasRemove.length - 1], raw);
    eq(calls.actorRemove[calls.actorRemove.length - 1], raw);
    world.dispose();
});

test('world.trace передаёт mask/ignore и возвращает узел вместо индекса', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const enemy = spawn('enemy');
    world.hit(enemy, { category: 'enemy' });
    const hit = world.trace({
        from: { x: 0, y: 0, h: 10 }, to: { x: 100, y: 0, h: 10 },
        mask: ['enemy'], ignore: enemy,
    });
    const args = calls.trace[calls.trace.length - 1];
    eq(args[0], 0); eq(args[1], 0); eq(args[2], 10);
    eq(args[3], 100); eq(args[4], 0); eq(args[5], 10);
    eq(args[6], 2);                       // mask: enemy
    eq(args[7], 0);                       // ignore: индекс зарегистрированного узла
    eq(hit.type, 2);
    eq(hit.node, enemy.get(0));
    eq(hit.proxy, 0);
    world.dispose();
});

test('world.traceAll возвращает отсортированный список и мапит узлы', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const enemy = spawn('enemy');
    world.hit(enemy, { category: 'enemy' });
    const hits = world.traceAll({
        from: { x: 0, y: 0, h: 10 }, to: { x: 0, y: 100, h: 10 },
    });
    eq(hits.length, 2);
    eq(hits[0].type, 1);
    eq(hits[0].node, null);
    eq(hits[1].type, 2);
    eq(hits[1].node, enemy.get(0));
    const args = calls.traceAll[calls.traceAll.length - 1];
    eq(args[6], 7);                       // по умолчанию world|enemy|breakable
    eq(args[7], -1);                      // ничего не игнорируем
    world.dispose();
});

test('world.trace отклоняет пустые/нечисловые точки и неизвестные маски', () => {
    const world = $.re2dWorld.fromJSON('{}');
    throws(TypeError, () => world.trace({ to: { x: 1, y: 2 } }), 'нет from');
    throws(RangeError, () => world.trace({ from: { x: NaN, y: 0 }, to: { x: 1, y: 1 } }), 'NaN');
    throws(RangeError, () => world.trace({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, mask: ['players'] }), 'неизвестная маска');
    throws(TypeError, () => world.trace({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, mask: 'enemy' }), 'mask не массив');
    world.dispose();
});

finish();
