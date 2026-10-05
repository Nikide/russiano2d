// ===========================================================================
// Юнит-тесты подсистемы зон-триггеров (triggers.js) без движка.
//
// Проверяем ровно то, что легко сломать: чистую геометрию (zoneContains),
// дифф множеств (diffOverlaps) и жизненный цикл enter/leave: вход, повторный
// кадр без события, выход, повторный вход и исчезновение цели. Плюс реестр
// наблюдателей .overlaps() и пространство имён $.triggers.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/triggers_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node } from '../../src/highlevel/core.js';
import {
    installTriggers, tickTriggers, watchOverlap,
    zoneContains, diffOverlaps, isZoneNode,
} from '../../src/highlevel/triggers.js';

// $.triggers ставится на пустой объект: логике подсистемы движок не нужен.
const $ = {};
installTriggers($);

// Node.emit() рассылает ещё и глобальные подписки через ctx.$; в движке он уже
// есть, в юнит-тесте подставляем заглушку.
ctx.$ = { _dispatchGlobal: () => {} };

const DT = 1 / 60;

/** Чистый мир перед каждым тестом: узлы уникальны, истории не путаются. */
function clean() {
    ctx.nodes.length = 0;
    ctx.byId.clear();
    ctx.byBody.clear();
}

function mk(tag, attrs) { return new Node(tag, attrs || {}); }

/** Пишет события зоны в массив: { type, other, self }. */
function eventsOf(zone) {
    const log = [];
    zone.on('enter', (e) => log.push({ type: 'enter', other: e.data.other.get(0), self: e.data.self.get(0) }));
    zone.on('leave', (e) => log.push({ type: 'leave', other: e.data.other.get(0), self: e.data.self.get(0) }));
    return log;
}

/** Узел-цель с «телом»: тела в юнит-тесте не нужны, важен только признак. */
function bodyNode(attrs) {
    const node = mk('rect', attrs || {});
    node.body = 1;
    return node;
}

// --- Чистые функции ---------------------------------------------------------

test('zoneContains видит пересечение прямоугольников и не считает касание', () => {
    const zone = { x: 0, y: 0, w: 100, h: 100 };
    truthy(zoneContains(zone, { x: 0, y: 0, w: 10, h: 10 }), 'центр внутри');
    truthy(zoneContains(zone, { x: 45, y: 0, w: 10, h: 10 }), 'частичное перекрытие');
    falsy(zoneContains(zone, { x: 100, y: 0, w: 10, h: 10 }), 'касание краем — не вход');
    falsy(zoneContains(zone, { x: 300, y: 0, w: 10, h: 10 }), 'далеко');
    falsy(zoneContains(null, { x: 0, y: 0 }), 'нет зоны — нет пересечения');
});

test('zoneContains учитывает хитбокс и масштаб узла', () => {
    const zone = { x: 0, y: 0, w: 100, h: 100 };
    const wide = mk('rect', { x: 60, y: 0, w: 10, h: 10, collision: 40 });
    truthy(zoneContains(zone, wide), 'хитбокс 40 шире картинки 10');
    const scaled = mk('rect', { x: 60, y: 0, w: 10, h: 10 });
    scaled.scale_x = 4;
    truthy(zoneContains(zone, scaled), 'масштаб 4 расширяет прямоугольник');
    const thin = mk('rect', { x: 60, y: 0, w: 10, h: 10 });
    falsy(zoneContains(zone, thin), 'без хитбокса и масштаба — мимо');
});

test('diffOverlaps считает вошедших и вышедших', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    const d = diffOverlaps(new Set([a, b]), new Set([b, c]));
    eq(d.entered.length, 1);
    eq(d.entered[0], c);
    eq(d.left.length, 1);
    eq(d.left[0], a);

    const empty = diffOverlaps(new Set(), new Set([a]));
    eq(empty.entered.length, 1);
    eq(empty.left.length, 0, 'первый кадр: выходить некому');

    const arrays = diffOverlaps([a], [a, b]);
    eq(arrays.entered.length, 1);
    eq(arrays.entered[0], b);
});

test('isZoneNode распознаёт тег, класс и attrs.trigger', () => {
    clean();
    truthy(isZoneNode(mk('trigger', {})), 'тег trigger');
    truthy(isZoneNode(mk('rect', { trigger: true })), 'attrs.trigger === true');
    truthy(isZoneNode(mk('rect', { class: 'trigger' })), 'класс trigger');
    falsy(isZoneNode(mk('rect', {})), 'обычный узел — не зона');
    falsy(isZoneNode(null), 'null — не зона');
});

// --- Жизненный цикл enter / leave -------------------------------------------

test('вход шлёт enter один раз, повторный кадр молчит', () => {
    clean();
    const zone = mk('trigger', { x: 0, y: 0, w: 100, h: 100 });
    const target = bodyNode({ x: 0, y: 0, w: 20, h: 20 });
    const log = eventsOf(zone);

    tickTriggers(DT);
    eq(log.length, 1, 'ровно одно событие');
    eq(log[0].type, 'enter');
    eq(log[0].other, target, 'в data.other — вошедший узел');
    eq(log[0].self, zone, 'в data.self — сама зона');

    tickTriggers(DT);
    tickTriggers(DT);
    eq(log.length, 1, 'пока пересечение не прервано, enter не повторяется');
});

test('выход шлёт leave, повторный вход — снова enter', () => {
    clean();
    const zone = mk('trigger', { x: 0, y: 0, w: 100, h: 100 });
    const target = bodyNode({ x: 0, y: 0, w: 20, h: 20 });
    const log = eventsOf(zone);

    tickTriggers(DT);
    target.x = 500;
    tickTriggers(DT);
    eq(log.length, 2);
    eq(log[1].type, 'leave');
    eq(log[1].other, target);

    target.x = 0;
    tickTriggers(DT);
    eq(log.length, 3);
    eq(log[2].type, 'enter');
});

test('исчезнувшая цель считается вышедшей: leave с removed-узлом', () => {
    clean();
    const zone = mk('trigger', { x: 0, y: 0, w: 100, h: 100 });
    const target = bodyNode({ x: 0, y: 0, w: 20, h: 20 });
    const log = eventsOf(zone);

    tickTriggers(DT);
    eq(log.length, 1);
    target.destroy();
    tickTriggers(DT);
    eq(log.length, 2, 'об удалении цели зона узнаёт');
    eq(log[1].type, 'leave');
    eq(log[1].other, target);
    truthy(log[1].other.removed, 'в data.other лежит уже удалённый узел');
    tickTriggers(DT);
    eq(log.length, 2, 'повторного leave нет');
});

test('скрытая зона не шлёт enter и завершает прошлые пересечения', () => {
    clean();
    const zone = mk('trigger', { x: 0, y: 0, w: 100, h: 100 });
    bodyNode({ x: 0, y: 0, w: 20, h: 20 });
    const log = eventsOf(zone);

    zone.visible = false;
    tickTriggers(DT);
    eq(log.length, 0, 'невидимая зона игнорируется');

    zone.visible = true;
    tickTriggers(DT);
    eq(log.length, 1);
    eq(log[0].type, 'enter');

    zone.visible = false;
    tickTriggers(DT);
    eq(log.length, 2, 'скрытие зоны — это выход');
    eq(log[1].type, 'leave');
});

// --- Отбор целей ------------------------------------------------------------

test('по умолчанию целью считается только узел с телом', () => {
    clean();
    const zone = mk('trigger', { x: 0, y: 0, w: 100, h: 100 });
    mk('rect', { x: 0, y: 0, w: 20, h: 20 });          // без тела
    const log = eventsOf(zone);
    tickTriggers(DT);
    eq(log.length, 0, 'узел без тела не входит в зону');

    const fighter = bodyNode({ x: 0, y: 0, w: 20, h: 20 });
    tickTriggers(DT);
    eq(log.length, 1);
    eq(log[0].other, fighter);
});

test('attrs.detect сужает цели: без тела, но по классу', () => {
    clean();
    const zone = mk('trigger', { x: 0, y: 0, w: 100, h: 100 });
    zone.attrs.detect = '.marker';
    const fighter = bodyNode({ x: 0, y: 0, w: 20, h: 20 });
    const marker = mk('rect', { x: 500, y: 0, w: 20, h: 20, class: 'marker' });
    const log = eventsOf(zone);

    tickTriggers(DT);
    eq(log.length, 0, 'тело без класса .marker не считается');

    marker.x = 0;
    tickTriggers(DT);
    eq(log.length, 1);
    eq(log[0].other, marker, 'маркер без тела пойман по селектору');

    fighter.x = 500;
    tickTriggers(DT);
    eq(log.length, 1, 'уход не совпавшего узла ничего не меняет');
});

test('attrs.detect понимает массив селекторов', () => {
    clean();
    const zone = mk('trigger', { x: 0, y: 0, w: 100, h: 100 });
    zone.attrs.detect = ['enemy', '.marker'];
    const marker = mk('rect', { x: 0, y: 0, w: 20, h: 20, class: 'marker' });
    const log = eventsOf(zone);
    tickTriggers(DT);
    eq(log.length, 1);
    eq(log[0].other, marker);
});

test('другие зоны не попадают в цели', () => {
    clean();
    const outer = mk('trigger', { x: 0, y: 0, w: 200, h: 200 });
    const inner = mk('trigger', { x: 0, y: 0, w: 50, h: 50 });
    const fighter = bodyNode({ x: 0, y: 0, w: 10, h: 10 });
    const log = eventsOf(outer);

    tickTriggers(DT);
    eq(log.length, 1, 'зона видит только бойца, но не соседнюю зону');
    eq(log[0].other, fighter);
    truthy(inner.__trigPrev instanceof Set, 'внутренняя зона тоже обработана');
});

// --- Наблюдатели .overlaps(sel, cb) -----------------------------------------

test('watchOverlap зовёт cb каждый кадр и переживает потерю цели', () => {
    clean();
    const self = mk('player', { x: 0, y: 0 });
    const near = bodyNode({ x: 0, y: 0, w: 20, h: 20 });
    const far = bodyNode({ x: 900, y: 0, w: 20, h: 20 });
    const calls = [];
    const off = watchOverlap(self, [near, far], (hit, who) => {
        calls.push([hit ? hit.get(0) : null, who.get(0)]);
    });

    tickTriggers(DT);
    eq(calls.length, 1, 'cb зовётся каждый кадр');
    eq(calls[0][0], near, 'первым найден пересекающийся');
    eq(calls[0][1], self, 'второй аргумент — сам узел');

    near.destroy();
    tickTriggers(DT);
    eq(calls.length, 2);
    eq(calls[1][0], null, 'потерянная цель даёт null, а не исключение');

    off();
    tickTriggers(DT);
    eq(calls.length, 2, 'после отписки наблюдатель молчит');
});

// --- Пространство имён $.triggers -------------------------------------------

test('$.triggers: zone/list/clear/inside/count', () => {
    clean();
    const zone = $.triggers.zone({ id: 'shop', x: 50, y: 50, w: 60, h: 60, detect: '.marker' });
    const marker = mk('rect', { x: 50, y: 50, w: 10, h: 10, class: 'marker' });
    const fighter = bodyNode({ x: 50, y: 50, w: 10, h: 10 });

    eq($.triggers.list().length, 1, 'зона зарегистрирована');
    truthy($.triggers.inside(zone, marker), 'inside по обёртке');
    truthy($.triggers.inside('#shop', '.marker'), 'inside по селекторам');
    eq($.triggers.count(zone), 1, 'с detect считаются только маркеры');
    fighter.x = 900;
    eq($.triggers.count(zone), 1);

    $.triggers.clear();
    eq($.triggers.list().length, 0, 'clear убирает все зоны');
});

test('$.triggers.zone дёргает onEnter/onLeave', () => {
    clean();
    let entered = 0;
    let left = 0;
    let other = null;
    $.triggers.zone({
        id: 'gate',
        x: 300,
        y: 300,
        w: 80,
        h: 80,
        onEnter: (who) => { entered++; other = who.get(0); },
        onLeave: () => { left++; },
    });
    const victim = bodyNode({ x: 300, y: 300, w: 10, h: 10 });
    tickTriggers(DT);
    eq(entered, 1);
    eq(other, victim);
    eq(left, 0);

    victim.x = 900;
    tickTriggers(DT);
    eq(left, 1);
    eq(entered, 1, 'повторного входа нет');

    $.triggers.clear();
    eq($.triggers.list().length, 0);
});

finish();
