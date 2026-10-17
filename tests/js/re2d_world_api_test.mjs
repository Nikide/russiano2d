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
                hitAdd: [], hitRemove: [], trace: [], traceAll: [], dispose: 0,
                moverCreate: [], moverIntent: [], moverRemove: [], moverInfo: [],
                triggerCreate: [], triggerRemove: [], triggerTick: [], triggerUse: [], triggerShoot: [],
                find: [], controllerCreate: [], controllerInit: [], controllerMove: [], controllerRemove: [],
                portalOpen: [], portalFraction: [] };

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
    moverCreate: (...args) => { calls.moverCreate.push(args); return 7; },
    moverIntent: (token, action) => calls.moverIntent.push([token, action]),
    moverRemove: (token) => calls.moverRemove.push(token),
    moverInfo: (token) => { calls.moverInfo.push(token); return { position: 12, fraction: 0.25 }; },
    triggerCreate: (...args) => { calls.triggerCreate.push(args); return 11; },
    triggerRemove: (token) => calls.triggerRemove.push(token),
    triggerTick: (...args) => { calls.triggerTick.push(args); return [11]; },
    triggerUse: (...args) => { calls.triggerUse.push(args); return [11]; },
    triggerShoot: (...args) => { calls.triggerShoot.push(args); return [11]; },
    findCell: (name) => { calls.find.push(['cell', name]); return name === 'room' ? 0 : null; },
    findWall: (name) => { calls.find.push(['wall', name]); return name === 'north' ? 2 : null; },
    findSpan: (name) => { calls.find.push(['span', name]); return name === 'hall.lower' ? 0 : null; },
    findPortal: (name) => { calls.find.push(['portal', name]); return name === 'gate' ? 1 : null; },
    findSurface: (name) => { calls.find.push(['surface', name]); return name === 'north' ? 3 : null; },
    surface: (index) => ({ kind: 0, primitive: index, cell: 0, span: 0 }),
    controllerCreate: (...args) => { calls.controllerCreate.push(args); return 21; },
    controllerInit: (...args) => { calls.controllerInit.push(args); return { x: args[1], y: args[2], feet: args[3], vx: 0, vy: 0, vz: 0, span: 0, ceiling: 320, grounded: true }; },
    controllerMove: (...args) => { calls.controllerMove.push(args); return { x: args[1], y: args[2] - 1, feet: args[3], vx: 0, vy: -230, vz: 0, span: 0, ceiling: 320, grounded: true }; },
    controllerRemove: (token) => calls.controllerRemove.push(token),
    portalClosed: () => {},
    portalOpen: (index, fraction) => calls.portalOpen.push([index, fraction]),
    portalFraction: (index) => { calls.portalFraction.push(index); return 0.5; },
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

test('world.mover уходит в нативный timeline и управляется интентами', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const lift = world.mover({ type: 'lift', span: 2, from: 0, to: 96, speed: 240, wait: 0.5, autoReturn: true });
    const args = calls.moverCreate[0];
    eq(args[0], 1); eq(args[1], 2); eq(args[2], -1);
    eq(args[3], 0); eq(args[4], 96); eq(args[5], 240); eq(args[6], 0.5); eq(args[7], 1);
    lift.open().close().toggle();
    eq(JSON.stringify(calls.moverIntent.slice(-3)), '[[7,0],[7,1],[7,2]]');
    eq(lift.info().position, 12);
    lift.remove();
    eq(calls.moverRemove[calls.moverRemove.length - 1], 7);
    throws(RangeError, () => world.mover({ span: 1, portal: 0, from: 0, to: 1 }), 'mover: span и portal вместе');
    throws(RangeError, () => world.mover({ from: 0, to: 1 }), 'mover: нужен span или portal');
    throws(RangeError, () => world.mover({ span: 1, from: 0, to: 1, speed: 0 }), 'mover: speed > 0');
    throws(RangeError, () => world.mover({ type: 'elevator', span: 1, from: 0, to: 1 }), 'mover: неизвестный тип');
    world.dispose();
});

test('world.trigger: once/cooldown уходят в C, события возвращаются в $.on', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const seen = [];
    world.onTrigger('gate.open', event => seen.push(event.target));
    const gate = world.trigger({ type: 'use', id: 'gate.open', target: 'gate.main',
        x: 10, y: 20, radius: 32, bottom: 0, top: 96, once: true, cooldown: 1.5 });
    const args = calls.triggerCreate[0];
    eq(args[0], 1); eq(args[1], 'gate.open'); eq(args[2], 'gate.main');
    eq(args[3], 10); eq(args[4], 20); eq(args[5], 32); eq(args[6], 0); eq(args[7], 96);
    eq(args[8], 1); eq(args[9], 1.5);
    eq(JSON.stringify(world.triggerUse({ x: 10, y: 20, h: 48 })), '["gate.open"]');
    eq(seen.length, 1); eq(seen[0], 'gate.main');
    eq(JSON.stringify(world.triggerTick(1 / 60, { x: 10, y: 20, feet: 0 })), '["gate.open"]');
    eq(seen.length, 2);
    eq(JSON.stringify(world.triggerShoot({ x: 10, y: 20, h: 48, radius: 2 })), '["gate.open"]');
    eq(calls.triggerShoot[calls.triggerShoot.length - 1][3], 2);
    gate.remove();
    eq(calls.triggerRemove[calls.triggerRemove.length - 1], 11);
    throws(TypeError, () => world.trigger({ type: 'enter' }), 'trigger: нужен id');
    throws(RangeError, () => world.trigger({ id: 'x', radius: 0 }), 'trigger: radius > 0');
    world.dispose();
});

test('semantic find_* отдаёт authored ID -> runtime handle', () => {
    const world = $.re2dWorld.fromJSON('{}');
    eq(world.findCell('room'), 0);
    eq(world.findCell('missing'), null);
    eq(world.findWall('north'), 2);
    eq(world.findSpan('hall.lower'), 0);
    eq(world.findPortal('gate'), 1);
    const surface = world.findSurface('north');
    eq(surface.kind, 0);
    eq(surface.primitive, 3);
    world.dispose();
});

test('world.controller создаёт native config и двигает состояние', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const ctrl = world.controller({ radius: 14, height: 56, step: 9, slopeLimit: 50 });
    const args = calls.controllerCreate[0];
    eq(args.length, 12);
    eq(args[0], 14); eq(args[1], 56); eq(args[2], 48); eq(args[3], 9); eq(args[4], 50);
    ctrl.place(100, 200, 0);
    eq(JSON.stringify(calls.controllerInit[0]), '[21,100,200,0]');
    const moved = ctrl.move({ dx: 0, dy: -1, dt: 1 / 60, jump: false });
    eq(moved.y, 199);
    eq(ctrl.state().grid ?? ctrl.state().grounded, true);
    ctrl.remove();
    eq(calls.controllerRemove[calls.controllerRemove.length - 1], 21);
    throws(RangeError, () => world.controller({ radius: 0 }), 'controller radius > 0');
    throws(RangeError, () => world.controller({ slopeLimit: 90 }), 'controller slopeLimit 0..89');
    world.dispose();
});

test('world.portalOpen задаёт smooth fraction, portalClosed остаётся бинарным', () => {
    const world = $.re2dWorld.fromJSON('{}');
    world.portalOpen(3, 0.25);
    eq(JSON.stringify(calls.portalOpen[calls.portalOpen.length - 1]), '[3,0.25]');
    eq(world.portalFraction(3), 0.5);
    world.portalClosed(3, true);
    world.dispose();
});

finish();
