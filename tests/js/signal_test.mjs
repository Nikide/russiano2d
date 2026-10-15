// ===========================================================================
// Юнит-тесты сигналов (src/highlevel/signal.js) без движка.
//
// Проверяем то, что легко сломать и трудно заметить: порядок по приоритетам,
// отложенную доставку (emit внутри emit), снятие/добавление подписок прямо во
// время рассылки, once, ошибки в обработчиках, счётчики и waitFor.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/signal_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, joined, finish } from './_harness.mjs';
import { ctx, Node } from '../../src/highlevel/core.js';
import {
    createBus, subscribe, unsubscribe, emit, clearBus, subscriberCount,
    subscribersOf, busNames, waitFor, waiterCount, pendingEmits,
} from '../../src/highlevel/signal.js';
import { installSignal } from '../../src/highlevel/signal.js';

// ---------------------------------------------------------------------------
// Чистая шина
// ---------------------------------------------------------------------------

test('emit передаёт аргументы всем подписчикам и возвращает их число', () => {
    const bus = createBus();
    const got = [];
    subscribe(bus, 'enemy:died', (who, score) => got.push(`${who}:${score}`));
    subscribe(bus, 'enemy:died', () => got.push('второй'));
    eq(emit(bus, 'enemy:died', ['goblin', 10]), 2);
    eq(joined(got, '|'), 'goblin:10|второй');
    eq(emit(bus, 'никого'), 0, 'у события без подписчиков вызовов нет');
});

test('приоритет: больше число — раньше вызов, равные — по порядку подписки', () => {
    const bus = createBus();
    const order = [];
    subscribe(bus, 'x', () => order.push('low'), { priority: -5 });
    subscribe(bus, 'x', () => order.push('a'));
    subscribe(bus, 'x', () => order.push('b'));
    subscribe(bus, 'x', () => order.push('high'), { priority: 100 });
    subscribe(bus, 'x', () => order.push('mid'), { priority: 10 });
    emit(bus, 'x', []);
    eq(joined(order), 'high,mid,a,b,low');
});

test('emit внутри emit не вклинивается: вложенное событие идёт после текущего', () => {
    const bus = createBus();
    const order = [];
    let queued = -1;
    subscribe(bus, 'outer', () => {
        order.push('outer:1');
        queued = emit(bus, 'inner', ['i']);
        order.push('outer:2');
    });
    subscribe(bus, 'inner', (tag) => order.push('inner:' + tag));
    emit(bus, 'outer', []);
    eq(joined(order, '|'), 'outer:1|outer:2|inner:i');
    eq(queued, 0, 'вложенный emit только ставится в очередь');
    eq(pendingEmits(bus), 0, 'после рассылки очередь пуста');
});

test('вложенные emit разбираются очередью FIFO, а не в порядке вложенности', () => {
    const bus = createBus();
    const order = [];
    subscribe(bus, 'a', () => { order.push('a'); emit(bus, 'c', []); });
    subscribe(bus, 'b', () => { order.push('b'); emit(bus, 'd', []); });
    subscribe(bus, 'c', () => order.push('c'));
    subscribe(bus, 'd', () => order.push('d'));
    emit(bus, 'a', []);
    emit(bus, 'b', []);
    eq(joined(order), 'a,c,b,d');
});

test('once снимается до вызова: emit из обработчика не вызывает его дважды', () => {
    const bus = createBus();
    let calls = 0;
    subscribe(bus, 'ping', () => { calls++; if (calls < 3) emit(bus, 'ping', []); }, { once: true });
    emit(bus, 'ping', []);
    eq(calls, 1);
    eq(subscriberCount(bus, 'ping'), 0);
});

test('отписка во время рассылки: снятый обработчик не вызывается', () => {
    const bus = createBus();
    const called = [];
    const second = () => called.push('second');
    subscribe(bus, 'x', () => { called.push('first'); unsubscribe(bus, 'x', second); });
    subscribe(bus, 'x', second);
    emit(bus, 'x', []);
    eq(joined(called), 'first');
});

test('подписка во время рассылки получает только следующее событие', () => {
    const bus = createBus();
    const called = [];
    subscribe(bus, 'x', () => { called.push('old'); subscribe(bus, 'x', () => called.push('new')); });
    emit(bus, 'x', []);
    eq(joined(called), 'old', 'новый подписчик не участвует в текущей рассылке');
    emit(bus, 'x', []);
    eq(joined(called, '|'), 'old|old|new');
});

test('ошибка в обработчике не рвёт рассылку и уходит в on_error', () => {
    const bus = createBus();
    const errors = [];
    bus.on_error = (error, name) => errors.push(`${name}:${error.message}`);
    const called = [];
    subscribe(bus, 'x', () => { throw new Error('бум'); });
    subscribe(bus, 'x', () => called.push('после'));
    eq(emit(bus, 'x', []), 2, 'оба обработчика считаются вызванными');
    eq(joined(called), 'после');
    eq(joined(errors), 'x:бум');
});

test('off снимает по функции и по id, clear — всех', () => {
    const bus = createBus();
    const a = () => {};
    const b = () => {};
    const id = subscribe(bus, 'x', a).id;
    subscribe(bus, 'x', b);
    eq(unsubscribe(bus, 'x', a), 1, 'снятие по функции');
    eq(unsubscribe(bus, 'x', id), 0, 'id снятой подписки уже ничего не снимает');
    eq(subscriberCount(bus, 'x'), 1);
    eq(clearBus(bus), 1, 'clear без имени снимает всех');
    eq(subscriberCount(bus), 0);
    falsy(busNames(bus).length, 'имён не осталось');
});

test('count/has/names/list показывают подписчиков и их приоритеты', () => {
    const bus = createBus();
    eq(subscriberCount(bus, 'nobody'), 0);
    subscribe(bus, 'a', () => {}, { priority: 3 });
    subscribe(bus, 'b', () => {}, { once: true });
    eq(subscriberCount(bus), 2, 'count() без имени — всего');
    truthy(busNames(bus).indexOf('a') >= 0, 'имя попало в список');
    const list = subscribersOf(bus, 'a');
    eq(list.length, 1);
    eq(list[0].priority, 3);
    truthy(list[0].once === false);
});

test('ошибки вызова объясняют, что делать: пустое имя и не-функция', () => {
    const bus = createBus();
    let message = '';
    try { subscribe(bus, '', () => {}); } catch (error) { message = error.message; }
    truthy(message.indexOf('нужно имя сигнала') >= 0, message);
    message = '';
    try { subscribe(bus, 'x', 42); } catch (error) { message = error.message; }
    truthy(message.indexOf('должен быть функцией') >= 0, message);
});

// ---------------------------------------------------------------------------
// Ожидание сигнала
// ---------------------------------------------------------------------------

test('waitFor: ожидание получает аргументы, then после срабатывания — синхронный', () => {
    const bus = createBus();
    const waiter = waitFor(bus, 'door:open');
    falsy(waiter.done());
    eq(waiterCount(bus, 'door:open'), 1);
    eq(emit(bus, 'door:open', ['ключ', 2]), 0, 'ожидание не считается подписчиком');
    truthy(waiter.done());
    eq(waiterCount(bus, 'door:open'), 0, 'ожидание снято после сигнала');
    const seen = [];
    waiter.then((what, count) => seen.push(`${what}:${count}`));
    eq(joined(seen), 'ключ:2');
    const args = waiter.value();
    eq(args.length, 2, 'value() отдаёт массив аргументов сигнала');
    eq(args[0], 'ключ');
    eq(args[1], 2);
});

test('waitFor: cancel снимает ожидание, и сигнал его больше не будит', () => {
    const bus = createBus();
    const waiter = waitFor(bus, 'x');
    truthy(waiter.cancel('передумал'));
    truthy(waiter.done());
    truthy(waiter.cancelled);
    eq(waiterCount(bus, 'x'), 0);
    eq(emit(bus, 'x', [1]), 0);
    falsy(waiter.cancel(), 'повторная отмена — false');
});

// ---------------------------------------------------------------------------
// $.signal
// ---------------------------------------------------------------------------

test('$.signal: on/emit/off/count/has/names/list', () => {
    const $s = {};
    installSignal($s);
    const got = [];
    const id = $s.signal.on('hero:jump', (height) => got.push(height));
    eq($s.signal.count('hero:jump'), 1);
    truthy($s.signal.has('hero:jump'));
    eq($s.signal.emit('hero:jump', 3), 1);
    eq(joined(got), '3');
    eq($s.signal.list('hero:jump')[0].id, id);
    eq($s.signal.off('hero:jump', id), 1);
    falsy($s.signal.has('hero:jump'));
    eq($s.signal.names().length, 0);
});

test('$.signal.once и $.signal.clear работают на уровне $', () => {
    const $s = {};
    installSignal($s);
    let calls = 0;
    $s.signal.once('boot', () => { calls++; });
    $s.signal.emit('boot');
    $s.signal.emit('boot');
    eq(calls, 1);
    $s.signal.on('a', () => {});
    $s.signal.on('b', () => {});
    eq($s.signal.count(), 2);
    eq($s.signal.clear(), 2);
    eq($s.signal.count(), 0);
});

test('$.signal.waitFor с timeout отменяется по игровому таймеру', () => {
    const $s = {};
    installSignal($s);
    let fire = null;
    let cancelled_id = null;
    ctx.time = {
        after(ms, fn) { fire = fn; return 77; },
        cancel(id) { cancelled_id = id; },
    };
    try {
        const waiter = $s.signal.waitFor('boss:died', { timeout: 500 });
        truthy(typeof fire === 'function', 'таймаут поставлен в $.time');
        fire();
        truthy(waiter.done());
        truthy(waiter.cancelled);
        eq(cancelled_id, 77, 'таймер снят после отмены ожидания');
    } finally {
        ctx.time = null;
    }
});

// ---------------------------------------------------------------------------
// §13: lifecycle scope, production-события, изоляция node events
// ---------------------------------------------------------------------------

function fakeScope(name) {
    const items = [];
    const scope = {
        name: name || 'scope',
        _state: 'active',
        state() { return scope._state; },
        own(kind, item, cancel) {
            if (scope._state !== 'active') {
                if (typeof cancel === 'function') cancel('scope закрыт');
                return false;
            }
            items.push({ kind, item, cancel });
            return true;
        },
        count() { return items.length; },
        close(reason) {
            scope._state = 'closing';
            for (const entry of items.splice(0)) entry.cancel(reason);
            scope._state = 'closed';
            return true;
        },
    };
    return scope;
}

test('§13 scope: подписка снимается при закрытии области', () => {
    const $sc = {};
    installSignal($sc);
    const scope = fakeScope('room');
    let calls = 0;
    const id = $sc.signal.on('enemy:died', () => { calls++; }, { scope });
    eq($sc.signal.count('enemy:died'), 1, 'подписка создана');
    eq(scope.count(), 1, 'область владеет подпиской');
    scope.close('restart комнаты');
    eq($sc.signal.count('enemy:died'), 0, 'подписка снята');
    eq($sc.signal.emit('enemy:died'), 0, 'событие больше никого не зовёт');
    eq(calls, 0);
    truthy(id > 0);
});

test('§13 scope: ожидание закрытой области завершается отменой', () => {
    const $sc = {};
    installSignal($sc);
    const scope = fakeScope('room:wait');
    const waiter = $sc.signal.waitFor('boss:died', { scope });
    eq($sc.signal.waiters('boss:died'), 1);
    scope.close('сцена ушла');
    truthy(waiter.done(), 'ожидание завершено');
    truthy(waiter.cancelled, 'завершено именно отменой');
    truthy(/сцена ушла|отменено/.test(String(waiter.error)), String(waiter.error));
    eq($sc.signal.waiters('boss:died'), 0, 'ожидание снято с шины');
});

test('§13 scope: закрывающаяся область не принимает новые подписки', () => {
    const $sc = {};
    installSignal($sc);
    const scope = fakeScope('room:closing');
    scope._state = 'closing';
    let calls = 0;
    const id = $sc.signal.on('x', () => { calls++; }, { scope });
    eq(id, 0, 'подписка не создана');
    eq($sc.signal.count('x'), 0);
    $sc.signal.emit('x');
    eq(calls, 0);
});

test('§13 once остаётся once при вложенном emit', () => {
    const $o = {};
    installSignal($o);
    let calls = 0;
    $o.signal.once('tick', () => { calls++; $o.signal.emit('tick'); });
    eq($o.signal.emit('tick'), 1, 'первый emit вызвал подписчика');
    eq(calls, 1, 'вложенный emit не вызвал once второй раз');
});

test('§13 изменение подписок во время dispatch безопасно', () => {
    const $o = {};
    installSignal($o);
    const order = [];
    const late = () => order.push('late');
    $o.signal.on('go', () => {
        order.push('first');
        $o.signal.on('go', late);      // новый подписчик — только следующие события
        $o.signal.off('go', second);
    });
    const second = () => order.push('second');
    $o.signal.on('go', second);
    $o.signal.emit('go');
    eq(joined(order, ','), 'first', 'снимок рассылки не изменился');
    $o.signal.emit('go');
    truthy(order.indexOf('late') >= 0, 'новый подписчик получил следующий emit');
    eq(order.filter((x) => x === 'second').length, 0, 'отписанный не вызвался');
});

test('§13 node events не пересылаются в $.signal незаметно', () => {
    const $o = {};
    installSignal($o);
    if (!ctx.$ || typeof ctx.$._dispatchGlobal !== 'function') ctx.$ = { _dispatchGlobal: () => {} };
    let signals = 0;
    let node_calls = 0;
    $o.signal.on('boom', () => { signals++; });
    const node = new Node('rect', { id: 'n-isolated' });
    node.on('boom', () => { node_calls++; });
    node.emit('boom', { power: 1 });
    eq(node_calls, 1, 'событие узла дошло до узла');
    eq(signals, 0, 'и НЕ попало в шину сигналов');
    node.destroy();
});

test('§13 production-событие: логические ID, tick и сам payload', () => {
    const $o = {};
    installSignal($o);
    if (!ctx.$ || typeof ctx.$._dispatchGlobal !== 'function') ctx.$ = { _dispatchGlobal: () => {} };
    ctx.time = { frame: () => 42 };
    const node = new Node('rect', { id: 'hero' });
    const ev = $o.signal.event('attack:hit', { power: 5 }, { id: 'e7', source: node, target: '#enemy' });
    eq(ev.id, 'e7');
    eq(ev.name, 'attack:hit');
    eq(ev.tick, 42);
    eq(ev.source, 'hero', 'источник — логический id узла, не native handle');
    eq(ev.target, '#enemy');
    let got = null;
    $o.signal.on('attack:hit', (payload) => { got = payload; });
    eq($o.signal.emitEvent(ev), 1);
    eq(got, ev, 'подписчик получил тот же объект события');
    node.destroy();
    ctx.time = null;
});

finish();
