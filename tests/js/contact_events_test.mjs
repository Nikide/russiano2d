// ===========================================================================
// События контакта и сенсоров (`$.on('collide' | 'sensor:enter' …)`).
//
// dispatchContacts() переводит begin/end/hit/stay из `engine.contacts()` в
// события узлов. Здесь проверяется то, что легко сломать и что нельзя
// увидеть без живого Box2D:
//
//   * sensor:enter/sensor:leave приходят ОДИН раз на begin/end и обеим
//     сторонам, вместе с обычными collide/separate (совместимость);
//   * payload — тот же view, что у collide, плюс sensor:true; point/normal
//     честно null, когда backend их не дал;
//   * удаление узла/мира прямо в обработчике не роняет рассылку и не шлёт
//     событие мёртвому узлу;
//   * устаревшее поколение тела (genA/genB) не достаётся новому владельцу;
//   * выключенная форма не оставляет «залипших» событий: нет контакта в
//     `engine.contacts()` — нет вызовов.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/contact_events_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { setEngineForTests } from '../../src/highlevel/native.js';
import { dispatchContacts } from '../../src/highlevel/api.js';
import { ctx, Node, touchRegistry, areaDefine } from '../../src/highlevel/core.js';

// Node.emit() рассылает глобальные подписки через ctx.$; в тесте они не нужны.
ctx.$ = { _dispatchGlobal() {} };

let queue = [];
let generation = 1;
let contacts_calls = 0;

const fake = {
    whiteSprite: 0,
    WHITE: 0xffffffff,
    rgba: () => 0,
    log: () => {},
    contacts: () => { contacts_calls++; return queue; },
    bodyGeneration: () => generation,
    // Узлы с телом, которым назначили body руками, при destroy() зовут это.
    destroyBody: () => {},
    setVelocity: () => {},
};
setEngineForTests(fake);

function clearWorld() {
    queue = [];
    generation = 1;
    for (const node of ctx.nodes.slice()) node.destroy();
    ctx.nodes.length = 0;
    ctx.byId.clear();
    ctx.byBody.clear();
    touchRegistry();
}

/** Узел без нативного тела: тело и byBody ставим руками — контактам этого хватает. */
function bodyNode(id, body) {
    const node = new Node('rect', { id });
    node.body = body;
    ctx.byBody.set(body, node);
    return node;
}

function contact(over) {
    return Object.assign({
        a: 0, b: 0, kind: 'begin', sensor: false,
        hasPoint: false, hasNormal: false,
        shapeA: 0, shapeB: 0,
        x: 0, y: 0, nx: 0, ny: 0, speed: 0,
    }, over);
}

function rec(node, name, out) {
    node.on(name, (e) => out.push({ node: node.id, name, data: e.data }));
}

test('sensor:enter — один раз на begin, обеим сторонам, после collide', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    const events = [];
    rec(a, 'collide', events);
    rec(a, 'sensor:enter', events);
    rec(b, 'collide', events);
    rec(b, 'sensor:enter', events);

    queue = [contact({ a: 10, b: 11, kind: 'begin', sensor: true })];
    dispatchContacts();
    eq(events.length, 4, 'по два события каждой стороне');
    eq(events.map((e) => e.node + ':' + e.name).join(','),
       'a:collide,a:sensor:enter,b:collide,b:sensor:enter',
       'порядок: обычное событие, затем сенсорное');

    // Повторный dispatch без нового begin ничего не повторяет: состояние
    // контакта держит Box2D, а не JS.
    queue = [];
    dispatchContacts();
    eq(events.length, 4, 'begin не рассылается дважды');
});

test('sensor:leave — один раз на end; payload сенсора: sensor:true, point/normal null', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    const events = [];
    rec(a, 'sensor:enter', events);
    rec(a, 'sensor:leave', events);
    rec(b, 'sensor:enter', events);
    rec(b, 'sensor:leave', events);

    queue = [contact({ a: 10, b: 11, kind: 'begin', sensor: true })];
    dispatchContacts();
    queue = [contact({ a: 10, b: 11, kind: 'end', sensor: true })];
    dispatchContacts();

    // begin рассылается целиком (A, B), затем отдельным dispatch — end (A, B).
    eq(events.map((e) => e.name).join(','), 'sensor:enter,sensor:enter,sensor:leave,sensor:leave');
    const enter = events[0].data;
    eq(enter.sensor, true, 'sensor:true');
    eq(enter.self.get(0).id, 'a', 'self — участник (обёртка)');
    eq(enter.other.get(0).id, 'b', 'other — второй участник (обёртка)');
    eq(enter.x, null, 'точки нет — null, а не 0');
    eq(enter.y, null);
    eq(enter.nx, null, 'нормали нет — null, а не нулевой вектор');
    eq(enter.ny, null);
    eq(enter.hasPoint, false);
    eq(enter.hasNormal, false);
    truthy(typeof enter.source === 'string' && enter.source.length > 0, 'устойчивый nid участника');
    truthy(typeof enter.target === 'string' && enter.target.length > 0 && enter.target !== enter.source, 'nid второго участника');
    const leave_a = events.find((e) => e.node === 'a' && e.name === 'sensor:leave');
    truthy(leave_a, 'leave для A есть');
    eq(leave_a.data.self.get(0).id, 'a', 'leave знает себя');
    eq(leave_a.data.other.get(0).id, 'b', 'leave знает другого');
});

test('обычный (не сенсорный) контакт не получает sensor-событий', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    const events = [];
    rec(a, 'collide', events);
    rec(a, 'sensor:enter', events);
    rec(b, 'collide', events);
    rec(b, 'sensor:enter', events);

    queue = [contact({ a: 10, b: 11, kind: 'begin', sensor: false, hasPoint: true, hasNormal: true,
                       x: 5, y: 6, nx: 0, ny: 1 })];
    dispatchContacts();
    eq(events.length, 2, 'только collide');
    eq(events[0].data.sensor, false);
    eq(events[0].data.x, 5, 'точка обычного контакта сохраняется');
    eq(events[0].data.hasNormal, true);
});

test('раскладка области: areaA/roleA/ownerA и selfArea/selfShape в сенсорном событии', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    const area = areaDefine(a, 'sense', { shape: 'box', w: 40, h: 20, sensor: true, role: 'trigger' });
    area.index = 0;   // без нативного addShape индекс назначаем сами
    const events = [];
    rec(b, 'sensor:enter', events);

    queue = [contact({ a: 10, b: 11, kind: 'begin', sensor: true, shapeA: 0, shapeB: 0 })];
    dispatchContacts();
    eq(events.length, 1);
    const d = events[0].data;
    eq(d.areaA, 'sense', 'имя области стороны A');
    eq(d.roleA, 'trigger', 'роль области');
    eq(d.ownerA.get(0).id, 'a', 'логический владелец области (обёртка)');
    eq(d.areaB, null, 'у B области нет');
    eq(d.otherArea, 'sense', 'otherArea у B — область A');
    eq(d.selfArea, null, 'selfArea у B — своя (нет)');
    eq(d.selfShape, 0);
    eq(d.otherShape, 0);
});

test('удаление второго участника в обработчике: мёртвому событие не шлётся', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    let b_sensor = 0;
    a.on('sensor:enter', () => b.destroy());
    b.on('sensor:enter', () => { b_sensor++; });

    queue = [contact({ a: 10, b: 11, kind: 'begin', sensor: true })];
    dispatchContacts();   // не должно бросить
    truthy(b.removed, 'B удалён');
    eq(b_sensor, 0, 'удалённый B не получил sensor:enter');
    falsy(ctx.byBody.has(11), 'byBody очищен destroy()');
});

test('уничтожение всего мира в обработчике безопасно; оставшиеся контакты пропускаются', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    const c = bodyNode('c', 12);
    const d = bodyNode('d', 13);
    let destroyed = false;
    let later = 0;
    a.on('collide', () => { destroyed = true; for (const n of ctx.nodes.slice()) n.destroy(); });
    c.on('collide', () => { later++; });

    queue = [
        contact({ a: 10, b: 11, kind: 'begin', sensor: true }),
        contact({ a: 12, b: 13, kind: 'begin', sensor: true }),
    ];
    dispatchContacts();
    truthy(destroyed, 'обработчик сработал');
    truthy(a.removed && b.removed && c.removed && d.removed, 'мир уничтожен');
    eq(later, 0, 'второй контакт не дошёл до удалённых');
    eq(ctx.byBody.size, 0);
});

test('устаревшее поколение тела (gen) не отдаётся новому владельцу', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    let a_events = 0;
    let b_events = 0;
    a.on('collide', () => { a_events++; });
    b.on('collide', () => { b_events++; });
    generation = 2;
    queue = [contact({ a: 10, b: 11, kind: 'begin', sensor: true, genA: 1, genB: 2 })];
    dispatchContacts();
    eq(a_events, 0, 'A с чужим поколением пропущен');
    eq(b_events, 1, 'B с верным поколением получил событие');
});

test('выключенная форма не даёт «залипших» событий: нет контакта — нет вызова', () => {
    clearWorld();
    const a = bodyNode('a', 10);
    const b = bodyNode('b', 11);
    let n = 0;
    a.on('collide', () => n++);
    a.on('sensor:enter', () => n++);

    queue = [contact({ a: 10, b: 11, kind: 'begin', sensor: true })];
    dispatchContacts();
    eq(n, 2, 'begin обработан');

    // Нативная форма выключена: Box2D больше не рапортует этот контакт.
    queue = [];
    const before = contacts_calls;
    dispatchContacts();
    dispatchContacts();
    truthy(contacts_calls > before, 'engine.contacts() вызывался');
    eq(n, 2, 'новых событий нет');
    truthy(ctx.byBody.has(11), 'B остаётся в byBody, если его не удаляли');
});

finish();
