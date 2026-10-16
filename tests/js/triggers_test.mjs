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
import { ctx, Node, wrapOne as wrapsOne } from '../../src/highlevel/core.js';
import {
    installTriggers, tickTriggers, watchOverlap,
    zoneContains, diffOverlaps, isZoneNode, processingAllows, mergeProcessing,
    expandRect, rectsOverlapAny, activationInside, selectCameras, viewToWorldRect,
} from '../../src/highlevel/triggers.js';

/** Обёртка одного узла (короткое имя — в тесте много вызовов). */
const wraps = { one: wrapsOne };

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
    const push = (type) => (e) => log.push({ type, other: e.data.other.get(0), self: e.data.self.get(0) });
    zone.on('enter', push('enter'));
    zone.on('stay', push('stay'));
    zone.on('leave', push('leave'));
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

// ===========================================================================
// §44: политики обработки узла
// ===========================================================================

test('normalizeProcessing: псевдоним movement, отброс мусора, true/false', () => {
    eq(JSON.stringify($.processing.spec({ movement: false })), '{"update":false}',
       'movement — читаемый псевдоним update');
    eq(JSON.stringify($.processing.spec({ bogus: 1, update: true })), '{"update":true}',
       'неизвестные поля не попадают в политику');
    eq($.processing.spec(true).physics, true, 'true — всё включено');
    const off = $.processing.spec(false);
    eq(off.animation, true, 'false выключает всё, КРОМЕ анимации');
    eq(off.physics, false);
    eq($.processing.spec('нет-такого').update, true, 'неизвестное имя — умолчания');
});

test('mergeProcessing: умолчания → область → узел, узел побеждает', () => {
    const merged = mergeProcessing({ update: false, physics: false }, { physics: true });
    eq(merged.update, false, 'поле слоя области сохранилось');
    eq(merged.physics, true, 'слой узла перекрыл область');
    eq(merged.timers, true, 'незаданное остаётся умолчанием');
});

test('processingAllows: без политики — да, с политикой — по полям', () => {
    clean();
    const enemy = mk('enemy');
    truthy(processingAllows(enemy, 'update'), 'узел без политики обрабатывается');
    truthy(processingAllows(enemy, 'physics'));

    $.processing.set(enemy, { update: false, physics: false });
    falsy(processingAllows(enemy, 'update'), 'кадровая логика выключена');
    falsy(processingAllows(enemy, 'physics'), 'участие в физике выключено');
    truthy(processingAllows(enemy, 'animation'), 'анимация не тронута');
    truthy(processingAllows(enemy, 'timers'), 'таймеры не тронуты');
});

test('наследование политики от области §5 включается явно', () => {
    clean();
    const taken = [];
    const scope = {
        name: 'room:1',
        node(value) { if (value) taken.push(value); return 1; },
        nodes() { return taken; },
    };
    const foe = mk('enemy');
    $.processing.scope(scope, { update: false, timers: false });
    truthy(processingAllows(foe, 'update'), 'вне области узел не затронут');

    scope.node(foe);                      // область взяла узел — наследование включилось
    falsy(processingAllows(foe, 'update'), 'политика области унаследована');
    falsy(processingAllows(foe, 'timers'));
    truthy(processingAllows(foe, 'animation'));

    $.processing.set(foe, { update: true });
    truthy(processingAllows(foe, 'update'), 'своя политика узла перекрыла область');
});

test('методы узла .processing() / .active() / .isActive()', () => {
    clean();
    const node = mk('enemy');
    const w = wraps.one(node);
    eq(w.processing().update, true, 'по умолчанию всё включено');

    w.processing({ update: false });
    falsy(w.processing('update'), 'чтение одного поля');
    falsy(w.isActive(), 'узел неактивен по update');
    truthy(w.processing('animation'), 'анимация продолжает играть');

    w.active(false);
    falsy(w.processing('physics'), '.active(false) выключает и физику');
    truthy(w.processing('animation'), '.active(false) НЕ выключает анимацию');
    eq(w.processing('fixed'), false);
    eq(w.processing('timers'), false);

    w.active(true);
    truthy(w.isActive());
    eq(w.processing('physics'), true);
});

test('$.processing.define/set/get/allow/stats', () => {
    clean();
    $.processing.define('sleeping', { update: false, fixed: false });
    truthy($.processing.presets().indexOf('sleeping') >= 0, 'имя объявлено');
    const node = mk('enemy');
    eq($.processing.set(node, 'sleeping'), 1, 'политика задана по имени');
    falsy($.processing.allow(node, 'update'));
    truthy($.processing.allow(node, 'animation'));
    truthy($.processing.stats().nodes >= 1, 'узел в статистике');
});

// ===========================================================================
// §44: visibility/activation
// ===========================================================================

test('геометрия активации: поле, пересечение, hysteresis', () => {
    const view = [{ x0: 0, y0: 0, x1: 100, y1: 100 }];
    const grown = expandRect(view[0], 10);
    eq(grown.x0, -10);
    eq(grown.x1, 110);
    truthy(rectsOverlapAny({ x0: 90, y0: 90, x1: 110, y1: 110 }, view), 'пересекаются');
    falsy(rectsOverlapAny({ x0: 120, y0: 0, x1: 140, y1: 20 }, view), 'далеко — нет');

    // Hysteresis: вход по margin, выход — по margin + hysteresis (он больше).
    const near = { x0: 105, y0: 40, x1: 115, y1: 60 };
    truthy(activationInside(near, view, false, 20, 40), 'вошли по входному порогу');
    truthy(activationInside(near, view, true, 20, 40), 'внутри держим по выходному порогу');
    falsy(activationInside(near, view, false, 5, 10), 'с малым входным порогом не вошли');
    falsy(activationInside(near, view, true, 20, 5), 'за выходным порогом — вышли');
});

test('выбор камер: any/main/имя/индекс и мировой прямоугольник вида', () => {
    const views = [{ name: 'main' }, { name: 'p2' }, { name: 'p3' }];
    eq(selectCameras(views, 'any').length, 3);
    eq(selectCameras(views, 'main')[0].name, 'main');
    eq(selectCameras(views, 'p2')[0].name, 'p2');
    eq(selectCameras(views, 2)[0].name, 'p3');
    eq(selectCameras(views, ['p3', 'p2']).length, 2);

    const rect = viewToWorldRect(
        { name: 'p2', x: 100, y: 50, zoom: 2, rect: { x: 0, y: 0, w: 800, h: 600 } }, 800, 600);
    eq(rect.x0, -100);
    eq(rect.x1, 300);
    eq(rect.name, 'p2');
});

test('watch: enter/exit по видимой области, margin, once, исчезновение', () => {
    clean();
    ctx.camera = { views: () => [{ name: 'main', x: 400, y: 300, zoom: 1, rect: { x: 0, y: 0, w: 800, h: 600 } }] };
    const node = bodyNode({ x: 100, y: 100, w: 10, h: 10 });
    const seen = [];
    node.on('screen:enter', () => seen.push('enter'));
    node.on('screen:exit', () => seen.push('exit'));

    const handle = $.activation.watch(node, { margin: 0 });
    tickTriggers(DT);
    eq(seen.join(','), 'enter', 'внутри кадра — вход');

    tickTriggers(DT);
    eq(seen.join(','), 'enter', 'повторный кадр не дублирует событие');

    node.x = 5000;
    tickTriggers(DT);
    eq(seen.join(','), 'enter,exit', 'выход за пределы');

    node.x = 100;
    tickTriggers(DT);
    eq(seen.join(','), 'enter,exit,enter', 'возврат снова даёт вход');

    truthy(handle.inside(node), 'ручка знает состояние');
    handle.stop();
    node.x = 5000;
    tickTriggers(DT);
    eq(seen.length, 3, 'после stop() событий нет');
    $.activation.clear();
});

test('watch: once срабатывает один раз при первом входе', () => {
    clean();
    ctx.camera = { views: () => [{ name: 'main', x: 400, y: 300, zoom: 1, rect: { x: 0, y: 0, w: 800, h: 600 } }] };
    const node = bodyNode({ x: 100, y: 100, w: 10, h: 10 });
    let enters = 0;
    node.on('screen:enter', () => enters++);
    $.activation.watch(node, { once: true });
    tickTriggers(DT);
    node.x = 5000; tickTriggers(DT);
    node.x = 100; tickTriggers(DT);
    eq(enters, 1, 'once = один вход за всё время');
    eq($.activation.stats().watchers, 0, 'наблюдатель снят после первого входа');
});

test('watch: margin и hysteresis удерживают узел в активной зоне', () => {
    clean();
    ctx.camera = { views: () => [{ name: 'main', x: 400, y: 300, zoom: 1, rect: { x: 0, y: 0, w: 800, h: 600 } }] };
    // Видимая область x 0..800, margin 0, hysteresis 50: вход при пересечении
    // с кадром, выход — только когда узел ушёл дальше 850.
    const node = bodyNode({ x: 100, y: 300, w: 10, h: 10 });
    let enters = 0;
    let exits = 0;
    node.on('screen:enter', () => enters++);
    node.on('screen:exit', () => exits++);
    $.activation.watch(node, { margin: 0, hysteresis: 50 });
    tickTriggers(DT);
    eq(enters, 1, 'в кадре — вход');
    node.x = 840;                       // край узла 835: ещё в полосе 800..850
    tickTriggers(DT);
    eq(exits, 0, 'внутри полосы hysteresis выхода нет');
    node.x = 880;                       // край узла 875: дальше полосы
    tickTriggers(DT);
    eq(exits, 1, 'ушли за полосу — выход');
    $.activation.clear();
});

test('watch: регион вместо камеры и $.activation.visible', () => {
    clean();
    ctx.camera = { views: () => [{ name: 'main', x: 400, y: 300, zoom: 1, rect: { x: 0, y: 0, w: 800, h: 600 } }] };
    const node = bodyNode({ x: 0, y: 0, w: 10, h: 10 });
    const seen = [];
    node.on('region:enter', () => seen.push('in'));
    node.on('region:exit', () => seen.push('out'));
    const region = { x: 300, y: 300, w: 100, h: 100 };
    $.activation.watch(node, { region });
    tickTriggers(DT);
    eq(seen.length, 0, 'узел вне региона');
    node.x = 300;
    node.y = 300;
    tickTriggers(DT);
    eq(seen.join(','), 'in', 'вошли в регион');
    truthy($.activation.visible(node, { region }), 'visible() видит узел');
    $.activation.clear();
});

test('$.activation.auto: обработка включается по видимости и не скрывает узел', () => {
    clean();
    ctx.camera = { views: () => [{ name: 'main', x: 400, y: 300, zoom: 1, rect: { x: 0, y: 0, w: 800, h: 600 } }] };
    const node = bodyNode({ x: 5000, y: 100, w: 10, h: 10 });
    node.visible = true;
    const w = wraps.one(node);
    $.activation.auto(node);
    falsy(w.processing('update'), 'вне кадра обработка выключена сразу');
    eq(node.visible, true, 'визуал не тронут (inactive ≠ hidden)');
    truthy(w.processing('animation'), 'анимация не выключена');
    node.x = 100;
    tickTriggers(DT);
    truthy(w.processing('update'), 'вошли в кадр — обработка включилась');
    node.x = 5000;
    tickTriggers(DT);
    falsy(w.processing('update'), 'вышли — выключилась снова');
    $.activation.clear();
});

// ===========================================================================
// §11: enter/stay/exit, once и cooldown у зон
// ===========================================================================

test('stay: событие пока цель внутри, с интервалом по игровым часам', () => {
    clean();
    let now = 0;
    ctx.time = { now: () => now / 1000, tick: () => now, delta: () => 1 / 60 };
    const zone = $.triggers.zone({ x: 0, y: 0, w: 100, h: 100, stay_ms: 100 }).get(0);
    const log = eventsOf(zone);
    const target = bodyNode({ x: 0, y: 0, w: 10, h: 10 });

    tickTriggers(DT);
    eq(log.map((e) => e.type).join(','), 'enter', 'вход сразу, stay ещё не время');
    now = 50;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 0, 'внутри интервала stay молчит');
    now = 100;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 1, 'через интервал пришёл stay');
    now = 200;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 2, 'следующий stay — ещё через интервал');
    target.x = 500;
    tickTriggers(DT);
    eq(log[log.length - 1].type, 'leave', 'выход закрывает stay');
    ctx.time = null;
});

test('stay на паузе молчит: часы зоны — игровое время', () => {
    clean();
    let now = 0;
    let paused = true;
    ctx.time = { now: () => now / 1000, delta: () => (paused ? 0 : 1 / 60) };
    const zone = $.triggers.zone({ x: 0, y: 0, w: 100, h: 100, stay_ms: 10 }).get(0);
    const log = eventsOf(zone);
    bodyNode({ x: 0, y: 0, w: 10, h: 10 });
    tickTriggers(DT);
    // На паузе игровое время не идёт: now не растёт, stay не повторяется.
    for (let i = 0; i < 5; i++) tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 0, 'на паузе stay молчит');
    paused = false;
    now = 20;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 1, 'после паузы stay снова идёт');
    ctx.time = null;
});

test('once: один enter за всё время, reset() перевзводит', () => {
    clean();
    const zone = $.triggers.zone({ x: 0, y: 0, w: 100, h: 100, once: true }).get(0);
    const log = eventsOf(zone);
    const target = bodyNode({ x: 0, y: 0, w: 10, h: 10 });
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'enter').length, 1, 'первый вход сработал');
    target.x = 500;
    tickTriggers(DT);
    target.x = 0;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'enter').length, 1, 'повторный вход once не повторяет');
    eq($.triggers.reset(zone), 1, 'reset вернул зону в работу');
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'enter').length, 2, 'после reset once снова сработал');
});

test('cooldown: вход не чаще окна, без «leave без enter»', () => {
    clean();
    let now = 0;
    ctx.time = { now: () => now / 1000, delta: () => 1 / 60 };
    const zone = $.triggers.zone({ x: 0, y: 0, w: 100, h: 100, cooldown: 200 }).get(0);
    const log = eventsOf(zone);
    const target = bodyNode({ x: 0, y: 0, w: 10, h: 10 });
    tickTriggers(DT);
    eq(log.map((e) => e.type).join(','), 'enter', 'первый вход прошёл');

    target.x = 500;
    tickTriggers(DT);
    eq(log[log.length - 1].type, 'leave', 'обычный выход с leave');
    now = 50;
    target.x = 0;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'enter').length, 1, 'в окне cooldown входа нет');
    target.x = 500;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'leave').length, 1,
       'и выхода нет: обработчик не видит leave без enter');

    now = 300;
    target.x = 0;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'enter').length, 2, 'после окна вход снова возможен');
    ctx.time = null;
});

test('stay с clock: ticks идёт по шагам симуляции, а не по кадрам', () => {
    clean();
    let tick = 0;
    ctx.time = { now: () => 0, tick: () => tick, delta: () => 1 / 60 };
    const zone = $.triggers.zone({ x: 0, y: 0, w: 100, h: 100, clock: 'ticks', stay_ticks: 3 }).get(0);
    const log = eventsOf(zone);
    bodyNode({ x: 0, y: 0, w: 10, h: 10 });

    tick = 0;
    tickTriggers(DT);
    tick = 1;
    tickTriggers(DT);
    tick = 2;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 0, 'три шага — интервал ещё не прошёл');
    tick = 3;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 1, 'на третьем шаге stay пришёл');
    tick = 6;
    tickTriggers(DT);
    eq(log.filter((e) => e.type === 'stay').length, 2, 'следующий — ещё через три шага');
    ctx.time = null;
});

finish();
