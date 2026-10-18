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

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';

const calls = { atlasAdd: [], atlasRemove: [], actorAdd: [], actorRemove: [],
                hitAdd: [], hitRemove: [], trace: [], traceAll: [], dispose: 0,
                moverCreate: [], moverIntent: [], moverRemove: [], moverInfo: [],
                triggerCreate: [], triggerRemove: [], triggerTick: [], triggerUse: [], triggerShoot: [],
                find: [], controllerCreate: [], controllerInit: [], controllerMove: [], controllerRemove: [],
                portalOpen: [], portalFraction: [], moverBlock: [], automap: [], particles: [], save: [], secret: [], breakable: [], terrain: [], material: [], post: [], polywall: [],
                renderQuality: [], atmosphere: [], camera: [] };

const native = {
    info: () => ({ poseBudget: 1, poseStep: 3, visual: { quality: 0 } }),
    quality: () => {},
    // Visual tier / atmosphere since 1.2.7: world.quality() no longer sets the
    // tier, the wrapper calls these explicit native controls instead.
    renderQuality: (...args) => { calls.renderQuality.push(args); return args.length ? args[0] : 0; },
    camera: (...args) => { calls.camera.push(args); },
    atmosphere: (...args) => {
        calls.atmosphere.push(args);
        return { heightDensity: 0.02, baseHeight: 100, falloff: 2, hazeStrength: 0.1,
                 hazeColor: 0x302010, skyLayers: false, sunDisc: false };
    },
    atlasAdd: (...args) => calls.atlasAdd.push(args),
    atlasRemove: (node) => calls.atlasRemove.push(node),
    actorAdd: (node) => calls.actorAdd.push(node),
    actorRemove: (node) => calls.actorRemove.push(node),
    hitAdd: (...args) => calls.hitAdd.push(args),
    hitZones: (node, zones) => calls.hitAdd.push(['zones', Array.from(zones)]),
    hitRemove: (node) => calls.hitRemove.push(node),
    trace: (...args) => {
        calls.trace.push(args);
        return { type: 2, fraction: 0.5, proxy: 0, node: 0, x: 1, y: 2, h: 3,
                 surface: -1, span: 1, normalX: 0, normalY: -1, zone: 1, zoneMultiplier: 2.5 };
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
    postSet: (...args) => calls.post.push(['set', args]),
    postEnable: (id, on) => calls.post.push(['enable', id, on]),
    postProfile: (name) => calls.post.push(['profile', name]),
    postStep: (dt) => calls.post.push(['step', dt]),
    postReset: () => calls.post.push(['reset']),
    postEval: () => ({ colorScale: [1.1, 0.9, 1], colorAdd: [0, 0, 0], tint: [1, 0.9, 0.8, 0.2],
                       vignette: 0.4, flash: 0.5, pixelSize: 1, chroma: 0.001, bloom: 0.3 }),
    surfaceMaterialName: (index) => 'brick',
    spanAudioZone: () => {}, spanAudioZoneInfo: () => ({ preset: 1, name: 'hall' }),
    conveyorApply: (surface, vx, vy, dt) => ({ vx: vx + 10 * dt, vy }),
    audioZoneAt: (x, y, h) => ({ preset: 1, name: 'hall', span: 2 }),
    audioBudget: (n) => n,
    audioState: () => ({ ready: true, active: 3, virtual: 2, budget: 8 }),
    navNodes: () => [{ x: 1, y: 2, span: 0, radius: 14 }],
    portalMirror: (i, on) => calls.material.push(['mirror', i, on]),
    portalMirrorGet: () => true,
    polywallAdd: (walls, x, y, angle, speed) => { calls.polywall.push(['add', Array.from(walls), x, y, angle, speed]); return 7; },
    polywallInfo: (token) => ({ angle: 0.5, speed: 1.5 }),
    polywallSpeed: (token, speed) => calls.polywall.push(['speed', token, speed]),
    polywallRemove: (token) => calls.polywall.push(['remove', token]),
    spanLight: () => ({ level: 1, r: 1, g: 1, b: 1, fogDensity: 0.002, fogStart: 100, fogR: 0.1, fogG: 0.2, fogB: 0.3 }),
    spanHeight: () => {}, spanSky: () => {},
    spanAt: () => 2,
    skyAnim: (...args) => calls.material.push(['skyAnim', args]),
    skyAnimInfo: () => ({ active: 1, yaw: 0.5, phase: 1, tinted: 1 }),
    materialIndex: (name) => { calls.material.push(['index', name]); return name === 'brick' ? 2 : null; },
    materialAnimSet: (...args) => { calls.material.push(['set', args]); },
    materialAnimInfo: (index) => { calls.material.push(['info', index]); return { frame: 1, emissive: 1.1, uOffset: 0.25, vOffset: 0 }; },
    materialAnimRemove: (index) => calls.material.push(['remove', index]),
    saveMapHash: () => '0123456789abcdef',
    saveStateJSON: () => '{"format":"re2d-save","version":1,"spans":[],"portals":[],"movers":[],"triggers":[]}',
    loadStateJSON: (text) => { calls.save.push(text); return true; },
    secretCreate: (...args) => { calls.secret.push(['create', args]); return 5; },
    secretRemove: (token) => calls.secret.push(['remove', token]),
    secretInfo: (token) => ({ found: 1, foundCount: 1 }),
    secretRestore: (token, found, count) => calls.secret.push(['restore', token, found, count]),
    secretTick: (dt, x, y, feet) => { calls.secret.push(['tick', dt, x, y, feet]); return [5]; },
    breakableCreate: (...args) => { calls.breakable.push(['create', args]); return 6; },
    breakableRemove: (token) => calls.breakable.push(['remove', token]),
    breakableDamage: (token, damage) => { calls.breakable.push(['damage', token, damage]); return damage >= 100 ? 1 : 0; },
    breakableInfo: () => ({ hp: 0, variant: 0, portal: 2, broken: 1 }),
    breakableRestore: (token, hp, broken) => calls.breakable.push(['restore', token, hp, broken]),
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
    eq(a.length, 17); eq(a[14], 0); eq(a[15], 0); eq(a[16], 0);
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
    eq(hit.zone, 1); eq(hit.zoneMultiplier, 2.5);
    world.dispose();
});

test('world.hit zones: head/body bands уходят в native hitZones', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const boss = spawn('boss');
    world.hit(boss, { radius: 60, height: 180, category: 'enemy', zones: [
        { from: 0, to: .45, multiplier: 1 }, { from: .45, to: .8, multiplier: 2 },
        { from: .8, to: 1, multiplier: 4 }] });
    const zonesCall = calls.hitAdd.find(r => r[0] === 'zones');
    eq(zonesCall[1].length, 9);
    near(zonesCall[1][3], .45, 1e-5); near(zonesCall[1][6], .8, 1e-5); eq(zonesCall[1][8], 4);
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
    eq(save.secrets.length, 0);
    eq(save.breakables.length, 0);
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

test('saveState переносит secrets/breakables и loadState их восстанавливает', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const secret = world.secret({ id: 'secret.a', x: 1, y: 1, top: 32, once: true });
    const crate = world.breakable({ id: 'crate.a', hp: 100, x: 1, y: 1, top: 32 });
    const save = world.saveState();
    eq(save.secrets.length, 1); eq(save.secrets[0].id, 'secret.a');
    eq(save.breakables.length, 1); eq(save.breakables[0].id, 'crate.a');
    eq(world.loadState(save), true);
    eq(calls.secret.filter(r => r[0] === 'restore').length, 1);
    eq(calls.breakable.filter(r => r[0] === 'restore').length, 1);
    secret.remove(); crate.remove();
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

test('world.materialAnim применяет scroll/pulse к существующему материалу', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const anim = world.materialAnim('brick', { frames: 4, fps: 8, scrollU: 0.25, pulseHz: 2, pulseAmount: 0.4, seed: 3 });
    eq(anim.index, 2);
    eq(calls.material[0][0], 'index');
    const set = calls.material.find(r => r[0] === 'set')[1];
    eq(set[0], 2); eq(set[1], 4); eq(set[2], 8); eq(set[5], 0.25);
    eq(anim.info().uOffset, 0.25);
    anim.remove();
    eq(calls.material[calls.material.length - 1][0], 'remove');
    throws(RangeError, () => world.materialAnim('missing'), 'неизвестный материал');
    world.dispose();
});

test('world.volume box: четыре constrained parts без mesh API', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const node = spawn('crate');
    const before = calls.atlasAdd.length;
    const volume = world.volume(node, { mode: 'box', width: 100, depth: 60, height: 80,
        cell: { w: 64, h: 64 }, faces: { front: 'f.png', back: 'b.png', left: 'l.png', right: 'r.png' } });
    eq(volume.parts.length, 4);
    eq(calls.atlasAdd.length - before, 4);
    const front = calls.atlasAdd[before];
    eq(front[1], 'f.png');
    eq(front[15], 30);          // offsetY = depth/2
    eq(calls.atlasAdd[before + 2][14], -50); // left offsetX = -width/2
    volume.remove();
    throws(TypeError, () => world.volume(node, { mode: 'cross' }), 'cross нужен atlas');
    world.dispose();
});

test('$.capabilities.re2d — честная матрица возможностей', () => {
    const caps = $.capabilities.re2d;
    truthy(caps && caps.worldGpu === true && caps.worldCpu === true);
    eq(caps.mirrorPortal, true);
    eq(caps.skyPortal, true);
    eq(caps.maxLights, 128);
    eq(caps.maxWorldSprites, 4096);
    truthy(caps.particles === true && caps.nav === true && caps.saveState === true && caps.polygonCells === true);
});

test('world.post: профиль, set/enable и mapping в $.gfx.post', () => {
    const world = $.re2dWorld.fromJSON('{}');
    world.post.profile('damage').set('vignette', { strength: 0.5 }).enable('flash', true);
    eq(calls.post[0][0], 'profile'); eq(calls.post[0][1], 'damage');
    eq(calls.post[1][0], 'set'); eq(calls.post[1][1][0], 1); eq(calls.post[1][1][1], 0.5);
    eq(calls.post[2][0], 'enable'); eq(calls.post[2][1], 2);
    const u = world.post.update(1 / 60);
    eq(calls.post[calls.post.length - 1][0], 'step');
    eq(u.vignette, 0.4); eq(u.flash, 0.5); eq(u.bloom, 0.3);
    world.post.reset();
    eq(calls.post[calls.post.length - 1][0], 'reset');
    throws(RangeError, () => world.post.set('unknown'), 'неизвестный эффект');
    world.dispose();
});

test('world.skyAnim и fogZone/fogAt доступны', () => {
    const world = $.re2dWorld.fromJSON('{}');
    world.skyAnim({ yawSpeed: 0.2, pulseHz: 1.5, pulseAmount: 0.3, color: '#ff8040' });
    const call = calls.material[calls.material.length - 1];
    eq(call[0], 'skyAnim');
    eq(call[1][0], 0.2); eq(call[1][1], 1.5); eq(call[1][2], 0.3);
    eq(world.skyAnimInfo().active, 1);
    world.fogZone({ span: 2, density: 0.01, start: 40, color: '#204060' });
    const fog = world.fogAt(1, 2, 3);
    eq(fog.span, 2); eq(fog.density, 0.002); eq(fog.start, 100);
    world.dispose();
});

test('world.debug.overlay проецирует automap и semantic точки', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const node = spawn('trig-host');
    world.trigger({ id: 'gate.use', target: 'gate', x: 100, y: 0, radius: 32, top: 64 });
    const overlay = world.debug.overlay({ x: 0, y: 0, h: 48, yaw: 0, pitch: 0, fov: 70, near: 1 }, { width: 320, height: 180 });
    truthy(Array.isArray(overlay.lines));
    truthy(overlay.points.some(p => p.kind === 'trigger' && p.id === 'gate.use'));
    world.dispose();
});

test('world.impactInfo/ricochet отдают material/terrain/thickness', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const impact = world.impactInfo({ from: { x: 0, y: 0, h: 48 }, to: { x: 100, y: 0, h: 48 } });
    eq(impact.type, 2); // mock trace returns sprite
    eq(impact.terrain, null);
    const reflected = world.ricochet({ x: 1, y: -1, h: 0 }, { x: 0, y: 1, h: 0 });
    eq(reflected.x, 1); eq(reflected.y, 1); eq(reflected.h, 0);
    world.dispose();
});

test('span.audioZone и audioZoneAt доступны', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const span = world.span(0);
    span.audioZone('hall');
    eq(span.audioZoneInfo().name, 'hall');
    eq(world.audioZoneAt(1, 2, 3).span, 2);
    eq($.capabilities.re2d.audioZones, true);
    world.dispose();
});

test('world.audio.budget/state отражают voice virtualization', () => {
    const world = $.re2dWorld.fromJSON('{}');
    eq(world.audio.budget(8), 8);
    const st = world.audio.state();
    eq(st.active, 3); eq(st.virtual, 2); eq(st.ready, true);
    world.dispose();
});

test('world.conveyorMotion двигает velocity к скорости конвейера', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const moved = world.conveyorMotion(2, { vx: 0, vy: 0 }, 0.5);
    truthy(moved.vx > 0);
    eq(moved.vy, 0);
    world.dispose();
});

test('world.polywall вращает authored wall и управляется speed/remove', () => {
    const world = $.re2dWorld.fromJSON('{}');
    const group = world.polywall({ walls: [4], pivot: { x: 200, y: 200 }, angle: 0, speed: 1 });
    eq(group.token, 7);
    eq(calls.polywall[0][0], 'add');
    eq(calls.polywall[0][1][0], 4);
    eq(calls.polywall[0][2], 200); eq(calls.polywall[0][3], 200); eq(calls.polywall[0][4], 0); eq(calls.polywall[0][5], 1);
    eq(group.info().angle, 0.5);
    group.speed(2);
    eq(calls.polywall[calls.polywall.length - 1][0], 'speed');
    group.remove();
    eq(calls.polywall[calls.polywall.length - 1][0], 'remove');
    throws(TypeError, () => world.polywall({}), 'нужны walls');
    world.dispose();
});

test('world.mist создаёт медленные translucent particles', () => {
    const world = $.re2dWorld.fromJSON('{}');
    calls.particles.length = 0;
    const emitted = world.mist({ x: 10, y: 20, rate: 12, color: '#cccccc' });
    truthy(emitted >= 0);
    truthy(calls.particles.length > 0);
    world.dispose();
});

test('world.renderQuality: имя -> код tier, геттер и RangeError до нативного вызова', () => {
    const world = $.re2dWorld.fromJSON('{}');
    calls.renderQuality.length = 0;
    eq(world.renderQuality('high'), 'high');
    eq(calls.renderQuality.length, 1);
    eq(calls.renderQuality[0][0], 2);
    eq(world.renderQuality(), 'low'); // мок-геттер возвращает 0
    const before = calls.renderQuality.length;
    throws(RangeError, () => world.renderQuality('bogus'), 'неизвестный tier');
    eq(calls.renderQuality.length, before, 'RangeError отклонён до C');
    world.dispose();
});

test('world.atmosphere: только переданные поля, значения и типы', () => {
    const world = $.re2dWorld.fromJSON('{}');
    calls.atmosphere.length = 0;
    const applied = world.atmosphere({ heightDensity: 0.02, baseHeight: 100, falloff: 2,
                                       hazeStrength: 0.1, hazeColor: '#102030',
                                       skyLayers: false, sunDisc: false });
    eq(calls.atmosphere.length, 1);
    const args = calls.atmosphere[0];
    near(args[0], 0.02); near(args[1], 100); near(args[2], 2); near(args[3], 0.1);
    eq(args[4], 0); // skyLayers:false
    eq(args[5], 0); // sunDisc:false
    eq(args[6], 2); // hazeColor задан явно
    near(args[7], 0x10 / 255); near(args[8], 0x20 / 255); near(args[9], 0x30 / 255);
    eq(applied.hazeColor, '#102030');
    eq(applied.skyLayers, false);
    // Частичный вызов: непереданные числовые поля уходят как NaN ("не менять"),
    // а hazeColor:null сбрасывает override в auto (mode 1).
    calls.atmosphere.length = 0;
    world.atmosphere({ hazeColor: null });
    const partial = calls.atmosphere[0];
    truthy(Number.isNaN(partial[0]) && Number.isNaN(partial[1]) && Number.isNaN(partial[2]) && Number.isNaN(partial[3]));
    eq(partial[4], -1); eq(partial[5], -1); eq(partial[6], 1);
    // Ошибки типов/диапазона не доходят до C.
    calls.atmosphere.length = 0;
    throws(RangeError, () => world.atmosphere({ heightDensity: 2 }), 'heightDensity вне 0..1');
    throws(TypeError, () => world.atmosphere({ skyLayers: 1 }), 'skyLayers не boolean');
    throws(TypeError, () => world.atmosphere({ unknownField: 1 }), 'неизвестное поле');
    throws(TypeError, () => world.atmosphere(null), 'опции обязательны');
    eq(calls.atmosphere.length, 0, 'ошибки отклонены до C');
    world.dispose();
});

test('world.camera: topdown mode -> orthographic, straight-down, near=1', () => {
    const world = $.re2dWorld.fromJSON('{}');
    calls.camera.length = 0;
    world.camera({ mode: 'topdown', x: 10, y: 20, h: 500, yaw: 0, orthoHeight: 1500 });
    eq(calls.camera.length, 1);
    const a = calls.camera[0];
    near(a[0], 10); near(a[1], 20); near(a[2], 500); near(a[3], 0);
    near(a[4], (-89.99 * Math.PI) / 180, 1e-5, 'topdown pitch ~ -90°');
    near(a[5], (70 * Math.PI) / 180, 1e-6);
    eq(a[6], 1, 'topdown near plane is 1');
    eq(a[7], 1500, 'orthographic height');
    // Legacy default stays perspective with pitch 0 and near 4.
    world.camera({ x: 1, y: 2, h: 3, pitch: -10 });
    const b = calls.camera[1];
    near(b[4], (-10 * Math.PI) / 180, 1e-6);
    eq(b[6], 4); eq(b[7], 0, 'perspective keeps ortho off');
    // Every field stays overridable; topdown can be used with perspective.
    world.camera({ mode: 'topdown', pitch: -60, projection: 'perspective', near: 3, orthoHeight: 800 });
    const c = calls.camera[2];
    near(c[4], (-60 * Math.PI) / 180, 1e-6);
    eq(c[6], 3); eq(c[7], 0, 'explicit perspective ignores orthoHeight');
    world.camera({ topdown: true });
    eq(calls.camera[3][7], 1200, 'topdown default ortho height');
    const before = calls.camera.length;
    throws(RangeError, () => world.camera({ mode: 'iso' }), 'неизвестный camera mode');
    throws(RangeError, () => world.camera({ projection: 'fisheye' }), 'неизвестная projection');
    eq(calls.camera.length, before, 'RangeError отклонён до C');
    world.dispose();
});

finish();
