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
                portalOpen: [], portalFraction: [], moverBlock: [], automap: [], particles: [], save: [], secret: [], breakable: [], terrain: [] };

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
    moverBlock: (token, flag) => calls.moverBlock.push([token, flag]),
    automapLines: (states) => { calls.automap.push(['lines', states]); return [{ x1: 0, y1: 0, x2: 10, y2: 0, state: 1, kind: 0, index: 0 }]; },
    automapProject: (...args) => { calls.automap.push(['project', args]); return { x: 5, y: 6 }; },
    lightCreate: (...args) => { calls.particles.push(['light', args]); return 3; },
    lightInfo: () => ({ x: 0, y: 0, h: 0, radius: 200, intensity: 1, r: 1, g: 1, b: 1, shadow: false,
                        remaining: 0, flickerMin: 0, flickerMax: 1, flickerRate: 1, flickerSeed: 0 }),
    lightUpdate: () => {}, lightVisual: () => {}, lightRemove: () => {},
    particlesBurst: (proto, count, seed) => { calls.particles.push(['burst', Array.from(proto), count, seed]); return count; },
    particlesContinuous: (proto, rate, dt, seed) => { calls.particles.push(['continuous', rate, dt, seed]); return 3; },
    particlesInfo: () => ({ alive: 4, capacity: 2048, overflow: 0, drawn: 4 }),
    particlesClear: () => calls.particles.push(['clear']),
    saveMapHash: () => '0123456789abcdef',
    saveStateJSON: () => '{"format":"re2d-save","version":1,"spans":[],"portals":[],"movers":[],"triggers":[]}',
    loadStateJSON: (text) => { calls.save.push(text); return true; },
    secretCreate: (...args) => { calls.secret.push(['create', args]); return 5; },
    secretRemove: (token) => calls.secret.push(['remove', token]),
    secretInfo: (token) => ({ found: 1, foundCount: 1 }),
    secretTick: (dt, x, y, feet) => { calls.secret.push(['tick', dt, x, y, feet]); return [5]; },
    breakableCreate: (...args) => { calls.breakable.push(['create', args]); return 6; },
    breakableRemove: (token) => calls.breakable.push(['remove', token]),
    breakableDamage: (token, damage) => { calls.breakable.push(['damage', token, damage]); return damage >= 100 ? 1 : 0; },
    breakableInfo: () => ({ hp: 0, variant: 0, portal: 2, broken: 1 }),
    surfaceTerrain: (index, name) => { calls.terrain.push(['set', index, name]); return 0; },
    surfaceTerrainInfo: (index) => ({ kind: 0, name: 'stone' }),
    surfaceConveyor: (index, vx, vy, accel, affects) => calls.terrain.push(['conv', index, vx, vy, accel, affects]),
    surfaceConveyorInfo: (index) => ({ vx: 10, vy: 0, accel: 600, affectsProjectiles: 0 }),
    terrainAt: (x, y, h) => ({ kind: 0, name: 'stone', surface: 3, moveScale: 1, frictionScale: 1, damagePerSecond: 0 }),
    conveyorAt: (x, y, h) => ({ vx: 10, vy: 0, accel: 600, affectsProjectiles: 0 }),
    metadata: () => ({ id: 'map', title: 'Map', spawnCount: 1 }),
    spawns: () => [{ id: 'player.start', type: 0, typeName: 'player', x: 1, y: 2, h: 0, facing: 0 }],
    spawn: (id) => (id === 'player.start' ? { id: 'player.start', typeName: 'player' } : null),
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
    lift.blocking(true);
    eq(JSON.stringify(calls.moverIntent.slice(-3)), '[[7,0],[7,1],[7,2]]');
    eq(JSON.stringify(calls.moverBlock[calls.moverBlock.length - 1]), '[7,1]');
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

test('world.automapLines/automapProject и metadata/spawns доступны из $', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const lines = world.automapLines([1, 0]);
    eq(lines.length, 1);
    eq(lines[0].kind, 0);
    eq(JSON.stringify(calls.automap[0][1]), '[1,0]');
    eq(world.automapProject({ cx: 10, cy: 20, scale: 2, rotation: 0 }, 3, 4).x, 5);
    const meta = world.metadata();
    eq(meta.id, 'map');
    eq(world.spawns()[0].id, 'player.start');
    eq(world.spawn('player.start').typeName, 'player');
    eq(world.spawn('nope'), null);
    world.dispose();
});

test('world.particles описывает прототип и зовёт нативный пул', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const spawned = world.particles.burst({ x: 1, y: 2, h: 3, count: 5, life: 2, size: 10,
        color: '#ff0000', blend: 'additive', mode: 'billboard', seed: 7 });
    eq(spawned, 5);
    const call = calls.particles[calls.particles.length - 1];
    eq(call[0], 'burst');
    eq(call[1].length, 25);
    eq(call[1][0], 1); eq(call[1][2], 3); eq(call[1][6], 2); eq(call[1][7], 10);
    eq(call[1][11], 1); eq(call[1][12], 0); eq(call[1][13], 0);
    eq(call[1][23], 2); eq(call[1][24], 1);
    eq(call[2], 5); eq(call[3], 7);
    eq(world.particles.continuous({ rate: 20 }, 1 / 60), 3);
    eq(world.particles.info().alive, 4);
    world.particles.clear();
    eq(JSON.stringify(calls.particles[calls.particles.length - 1]), '["clear"]');
    world.dispose();
});

test('world.fxSpawn собирает bundle: particles + light + optional decal/sound', () => {
    const world = $.re2dWorld.fromJSON('{}');
    world.fxDefine('test.fire', {
        particles: [{ count: 3, life: 1, size: 4, color: '#ff0000', blend: 'additive' },
                    { count: 2, life: 2, size: 2, color: '#00ff00' }],
        light: { radius: 120, intensity: 3, color: '#ff8040', life: 0.1, shadow: true },
        decal: { width: 8, height: 8 },
        shake: 0.4,
    });
    const spawned = world.fxSpawn('test.fire', { x: 10, y: 20, h: 30, dx: 1, dy: 0, dz: 0 });
    eq(spawned.particles, 5);
    eq(spawned.light, true);
    eq(spawned.shake, 0.4);
    eq(spawned.decal, false); // trace mock returns null
    const records = calls.particles.filter(r => r[0] === 'burst');
    eq(records[records.length - 2][2], 3);
    eq(records[records.length - 1][2], 2);
    throws(RangeError, () => world.fxSpawn('missing.bundle'), 'неизвестный bundle');
    world.dispose();
});

test('world.saveState/loadState: версия, map hash и native snapshot', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const save = world.saveState();
    eq(save.format, 're2d-world-save');
    eq(save.map.hash, '0123456789abcdef');
    eq(save.state.format, 're2d-save');
    eq(world.loadState(save), true);
    eq(calls.save.length, 1);
    throws(TypeError, () => world.loadState({ format: 'other' }), 'чужой формат');
    throws(RangeError, () => world.loadState({ ...save, map: { hash: 'deadbeef' } }), 'hash mismatch');
    world.dispose();
});

test('world.secret/breakable: события в $.on', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const found = [], broken = [];
    world.onSecret(event => found.push(event.secret));
    world.onBreakable(event => broken.push([event.breakable, event.portal]));
    const secret = world.secret({ id: 'secret.tower', x: 1, y: 2, radius: 8, top: 64, once: true });
    eq(JSON.stringify(world.secretsTick(1 / 60, { x: 1, y: 2, feet: 0 })), '["secret.tower"]');
    eq(found.length, 1);
    eq(secret.info().found, 1);
    secret.remove();
    const crate = world.breakable({ id: 'crate.a', hp: 100, variant: 2, portal: 3, x: 1, y: 1, top: 40 });
    eq(crate.hit(100), true);
    eq(broken.length, 1); eq(broken[0][0], 'crate.a'); eq(broken[0][1], 3);
    eq(crate.info().broken, 1);
    crate.remove();
    world.dispose();
});

test('surface.terrain/conveyor и terrainAt/conveyorAt доступны', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const surface = world.surface(0);
    surface.terrain('water').conveyor({ vx: 10, vy: 0, accel: 600, affectsProjectiles: true });
    eq(JSON.stringify(calls.terrain[0]), '["set",0,"water"]');
    eq(JSON.stringify(calls.terrain[1]), '["conv",0,10,0,600,1]');
    eq(surface.terrainInfo().name, 'stone');
    eq(surface.conveyorInfo().vx, 10);
    eq(world.terrainAt(1, 2, 3).name, 'stone');
    eq(world.conveyorAt(1, 2, 3).accel, 600);
    world.dispose();
});

finish();
