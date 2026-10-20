// ===========================================================================
// Операторы запросов обёртки: limit / nearest / inside / visibleFrom.
//
// Проверяем именно то, что обещает документация (docs/highlevel/core.md):
//
//   * limit режет выборку детерминированно, n<=0 — пусто;
//   * nearest — ОДИН ближайший по квадрату расстояния, tie-break по порядку
//     РЕЕСТРА, а не по порядку выборки; без цели берёт якорь последнего
//     .within(...), иначе возвращает ту же выборку и пишет одно предупреждение;
//   * inside понимает имя области, прямоугольник, селектор/узел/обёртку и
//     фильтрует по ЦЕНТРУ узла; выключенная область не возвращает никого;
//   * visibleFrom спрашивает физический луч (engine.raycast), а не пиксели;
//     заслон невидим, сенсоры луч не останавливают, без backend — пусто и
//     честная диагностика (никакой поддельной видимости).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/query_ops_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import {
    ctx, Node, Wrapper, wrap, touchRegistry, areaDefine,
} from '../../src/highlevel/core.js';
import { setEngineForTests } from '../../src/highlevel/native.js';

// Node.emit() (destroy → 'remove') рассылает глобальные подписки через ctx.$.
ctx.$ = { _dispatchGlobal() {} };

function clearWorld() {
    for (const node of ctx.nodes.slice()) node.destroy();
    ctx.nodes.length = 0;
    ctx.byId.clear();
    ctx.byBody.clear();
    touchRegistry();
}

function node(id, x, y, tag) {
    return new Node(tag || 'rect', { id, x, y, w: 20, h: 20 });
}

function ids(wrapper) {
    const out = [];
    for (const n of wrapper.nodes) out.push(n.id);
    return out.join(',');
}

// --- limit -----------------------------------------------------------------

test('limit(n): первые n в порядке выборки; n<=0/NaN — пусто; хвост не трогается', () => {
    clearWorld();
    const a = node('a', 0, 0), b = node('b', 10, 0), c = node('c', 20, 0);
    const all = wrap([a, b, c]);
    truthy(all.limit(2) instanceof Wrapper, 'возвращает обёртку');
    eq(ids(all.limit(2)), 'a,b');
    eq(ids(all.limit(1)), 'a');
    eq(ids(all.limit(3)), 'a,b,c');
    eq(ids(all.limit(99)), 'a,b,c', 'больше длины — вся выборка');
    eq(all.limit(0).length, 0);
    eq(all.limit(-5).length, 0);
    eq(all.limit(NaN).length, 0, 'NaN — пусто, а не «все»');
    eq(ids(all.limit(2)), 'a,b', 'повтор детерминирован');
    eq(ids(all), 'a,b,c', 'исходная выборка не изменилась');
});

// --- nearest ---------------------------------------------------------------

test('nearest(цель): один ближайший по центру', () => {
    clearWorld();
    const a = node('a', 10, 0), b = node('b', 30, 0), c = node('c', 50, 0);
    const near = wrap([c, b, a]).nearest({ x: 0, y: 0 });
    eq(near.length, 1, 'ровно один узел');
    eq(near.get(0), a);
    eq(wrap([a, b, c]).nearest('#b').get(0), b, 'селектор цели');
});

test('nearest: равные расстояния разрешает порядок РЕЕСТРА, а не выборки', () => {
    clearWorld();
    const first = node('first', -10, 0);
    const second = node('second', 10, 0);
    // Выборка нарочно в обратном порядке: tie-break обязан взять реестр.
    eq(ids(wrap([second, first]).nearest({ x: 0, y: 0 })), 'first');
    eq(ids(wrap([first, second]).nearest({ x: 0, y: 0 })), 'first');
});

test('nearest(): цель — якорь последнего .within(...)', () => {
    clearWorld();
    const player = node('player', 0, 0);
    const near = node('near', 100, 0);
    const far = node('far', 500, 0);
    const in_radius = wrap([far, near]).within('#player', 1000);
    eq(in_radius.length, 2, 'within нашёл обоих (узлы без тела — по координатам)');
    const nearest = in_radius.nearest();
    eq(nearest.length, 1);
    eq(nearest.get(0), near, 'считает от игрока, а не от первого узла выборки');
    // Якорь переживает промежуточный limit: это узкая операция над той же цепочкой.
    eq(wrap([far, near]).within('#player', 1000).limit(2).nearest().get(0), near);
});

test('nearest(): без цели и без якоря — та же выборка и одно предупреждение', () => {
    clearWorld();
    const a = node('a', 10, 0), b = node('b', 20, 0);
    const logs = [];
    const saved = ctx.log;
    ctx.log = (msg) => logs.push(String(msg));
    try {
        const all = wrap([a, b]);
        const same = all.nearest();
        eq(same, all, 'возвращается та же обёртка');
        eq(logs.filter((m) => m.indexOf('.nearest()') >= 0).length, 1, 'одно предупреждение');
        all.nearest();
        eq(logs.filter((m) => m.indexOf('.nearest()') >= 0).length, 1, 'повтор не заливает лог');
    } finally {
        ctx.log = saved;
    }
    eq(wrap([a, b]).nearest('#нет-такого').length, 0, 'явная ненайденная цель — пусто');
});

// --- inside ----------------------------------------------------------------

test('inside({x,y,w,h}): центр, границы включаются, порядок сохраняется', () => {
    clearWorld();
    const in1 = node('in1', 10, 10);
    const edge = node('edge', 50, 50);
    const out = node('out', 100, 10);
    eq(ids(wrap([in1, out, edge]).inside({ x: 0, y: 0, w: 50, h: 50 })), 'in1,edge');
    eq(ids(wrap([in1, out, edge]).inside({ x: 50, y: 50, w: -50, h: -50 })), 'in1,edge',
       'отрицательные w/h нормализуются');
    eq(ids(wrap([in1]).inside({ x0: 0, y0: 0, x1: 20, y1: 20 })), 'in1',
       'готовые границы x0/y0/x1/y1');
});

test('inside(селектор | узел | обёртка): границы nodeBounds', () => {
    clearWorld();
    const zone = new Node('trigger', { id: 'zone', x: 100, y: 100, w: 200, h: 100 });
    const in1 = node('in1', 10, 100);
    const out = node('out', 10, 10);
    eq(ids(wrap([in1, out]).inside('#zone')), 'in1', 'селектор');
    eq(ids(wrap([in1, out]).inside(zone)), 'in1', 'сырой узел');
    eq(ids(wrap([in1, out]).inside(wrap([zone]))), 'in1', 'обёртка');
});

test('inside(имя области): геометрия тела, выключенная область — пусто', () => {
    clearWorld();
    const owner = node('owner', 0, 0);
    const area = areaDefine(owner, 'sense', {
        shape: 'box', w: 100, h: 50, x: 50, y: 0, sensor: true,
    });
    const in1 = node('in1', 50, 0);
    const edge = node('edge', 100, 25);
    const out = node('out', 160, 0);
    eq(ids(wrap([in1, out, edge]).inside('sense')), 'in1,edge');

    // Смещение области — в локальном пространстве ТЕЛА: повернули владельца на
    // 90° — область 'sense' (смещение x=50) ушла в мировую точку (0, 50).
    owner.angle = Math.PI / 2;
    const rotated = node('rotated', 0, 55);
    eq(ids(wrap([rotated]).inside('sense')), 'rotated', 'смещение области поворачивается с телом');
    owner.angle = 0;
    area.enabled = false;
    eq(wrap([in1, edge]).inside('sense').length, 0, 'выключенная форма не участвует');
});

test('inside(неизвестное): пусто и одна диагностика на аргумент', () => {
    clearWorld();
    const a = node('a', 0, 0);
    const logs = [];
    const saved = ctx.log;
    ctx.log = (msg) => logs.push(String(msg));
    try {
        eq(wrap([a]).inside('нет-такой-области').length, 0);
        eq(wrap([a]).inside('нет-такой-области').length, 0);
        eq(logs.filter((m) => m.indexOf('.inside(') >= 0).length, 1, 'одна строка, не на каждый вызов');
    } finally {
        ctx.log = saved;
    }
});

// --- visibleFrom -----------------------------------------------------------

function raycastEngine() {
    const calls = [];
    const fake = {
        whiteSprite: 0,
        WHITE: 0xffffffff,
        rgba: () => 0,
        log: () => {},
        destroyBody: () => {},
        calls,
        // Стена body=99 перекрывает всё, что идёт вниз (y2 >= 50).
        hitFn: (x1, y1, x2, y2) => (y2 >= 50 ? { hit: true, body: 99, x: x2, y: y2 } : null),
        raycast(x1, y1, x2, y2, ignore, mask) {
            calls.push({ x1, y1, x2, y2, ignore: Array.from(ignore || []), mask });
            return this.hitFn(x1, y1, x2, y2, ignore, mask);
        },
    };
    return fake;
}

test('visibleFrom: луч от центра цели, заслон скрывает, сенсоры не мешают', () => {
    clearWorld();
    const fake = raycastEngine();
    setEngineForTests(fake);
    const hero = node('hero', 0, 0);
    hero.body = 1;
    ctx.byBody.set(1, hero);
    const visible = node('visible', 100, 0);
    visible.body = 2;
    ctx.byBody.set(2, visible);
    const blocked = node('blocked', 100, 100);
    blocked.body = 3;
    ctx.byBody.set(3, blocked);

    const seen = wrap([hero, visible, blocked]).visibleFrom('#hero');
    eq(ids(seen), 'visible', 'заслонённый узел не виден, цель не в результате');
    const call = fake.calls.find((c) => c.x2 === 100 && c.y2 === 0);
    truthy(call, 'луч до видимого узла был');
    truthy(call.ignore.indexOf(1) >= 0, 'тело цели игнорируется');
    truthy(call.ignore.indexOf(2) >= 0, 'собственное тело узла игнорируется');
    eq(call.mask, 0, 'без mask — все слои');
});

test('visibleFrom: mask и maxDistance уходят в backend/отсев', () => {
    clearWorld();
    const fake = raycastEngine();
    setEngineForTests(fake);
    const hero = node('hero', 0, 0);
    hero.body = 1;
    const near = node('near', 100, 0);
    near.body = 2;
    const far = node('far', 500, 0);
    far.body = 3;

    eq(ids(wrap([near, far]).visibleFrom('#hero', { mask: 0x2 })), 'near,far');
    const call = fake.calls.find((c) => c.x2 === 100);
    eq(call.mask, 2, 'mask передан в engine.raycast');

    fake.calls.length = 0;
    eq(ids(wrap([near, far]).visibleFrom('#hero', { maxDistance: 100 })), 'near');
    eq(fake.calls.filter((c) => c.x2 === 500).length, 0, 'дальний узел даже не спрашивали');
});

test('visibleFrom: цель не найдена — пусто и диагностика', () => {
    clearWorld();
    setEngineForTests(raycastEngine());
    const a = node('a', 10, 10);
    const logs = [];
    const saved = ctx.log;
    ctx.log = (msg) => logs.push(String(msg));
    try {
        eq(wrap([a]).visibleFrom('#нет-цели').length, 0);
        eq(logs.filter((m) => m.indexOf('.visibleFrom()') >= 0).length, 1);
    } finally {
        ctx.log = saved;
    }
});

test('visibleFrom без engine.raycast: пусто и честная диагностика, не «всё видно»', () => {
    clearWorld();
    setEngineForTests({
        whiteSprite: 0, WHITE: 0xffffffff, rgba: () => 0, log: () => {},
        destroyBody: () => {},
    });
    const hero = node('hero', 0, 0);
    const a = node('a', 10, 10);
    const logs = [];
    const saved = ctx.log;
    ctx.log = (msg) => logs.push(String(msg));
    try {
        eq(wrap([a]).visibleFrom('#hero').length, 0, 'без луча видимость не выдумывается');
        eq(wrap([a]).visibleFrom('#hero').length, 0);
        eq(logs.filter((m) => m.indexOf('.visibleFrom()') >= 0).length, 1, 'одна диагностика');
    } finally {
        ctx.log = saved;
    }
});

finish();
