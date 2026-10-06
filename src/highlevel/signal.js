// ===========================================================================
// Сигналы: $.signal — именованные события в духе Godot (on / off / once / emit).
//
// Зачем отдельная шина, когда есть $.on и .on() у узла:
//   * приоритеты — обработчики вызываются в заданном порядке, а не в порядке
//     подписки: системный звук должен отыграть раньше, чем HUD обновится;
//   * отложенная доставка — emit внутри emit не ломает порядок: вложенное
//     событие встаёт в очередь и рассылается только после текущего, поэтому
//     подписчик не видит «полусобытия»;
//   * waitFor() — «дождаться сигнала» без обратного вызова (промис-подобный
//     .then), удобно для сценарных последовательностей;
//   * счётчики подписчиков — для отладки и тестов.
//
// Чистое ядро (шина) экспортируется наружу: createBus/subscribe/emit/… не
// знают ни про движок, ни про ctx — их проверяет qjs без сборки
// (см. _CONTRACT.md §4).
// ===========================================================================

import { ctx } from './core.js';

/** Приоритет по умолчанию: чем больше число, тем раньше вызов. */
export const DEFAULT_PRIORITY = 0;

// ---------------------------------------------------------------------------
// Чистое ядро шины
// ---------------------------------------------------------------------------

/**
 * Пустая шина. Всё состояние — в обычном объекте, поэтому шину можно
 * создавать сколько угодно раз (в тестах — на каждый сценарий).
 */
export function createBus() {
    return {
        subs: new Map(),      // имя → отсортированный список подписок
        waiters: new Map(),   // имя → ожидания $.signal.waitFor
        queue: [],            // отложенные emit'ы (emit внутри emit)
        depth: 0,             // > 0 — идёт доставка
        next_id: 1,
        on_error: null,       // (error, name) => void; в игре пишет в $.log
    };
}

/** Имя сигнала строкой; null/undefined — ошибка вызывающего. */
export function signalName(name) {
    if (name === undefined || name === null || name === '') {
        throw new Error('$.signal: нужно имя сигнала — $.signal.on("enemy:died", (enemy) => …)');
    }
    return String(name);
}

/**
 * Подписка. opts: { priority, once }. Порядок вызова: приоритет по убыванию,
 * внутри одного приоритета — порядок подписки (вставка в нужное место, а не
 * пересортировка всего списка: так порядок не зависит от стабильности sort).
 */
export function subscribe(bus, name, fn, opts) {
    const key = signalName(name);
    if (typeof fn !== 'function') {
        throw new Error(`$.signal: обработчик сигнала "${key}" должен быть функцией — $.signal.on("${key}", (…args) => …)`);
    }
    const o = opts || {};
    const priority = Number(o.priority);
    const sub = {
        id: bus.next_id++,
        name: key,
        fn,
        priority: Number.isFinite(priority) ? priority : DEFAULT_PRIORITY,
        once: !!o.once,
        alive: true,
    };
    let list = bus.subs.get(key);
    if (!list) { list = []; bus.subs.set(key, list); }
    let i = list.length;
    while (i > 0 && list[i - 1].priority < sub.priority) i--;
    list.splice(i, 0, sub);
    return sub;
}

/**
 * Отписка. fnOrSub — функция, id подписки, сама подписка или undefined
 * (тогда снимаются все обработчики имени). Возвращает число снятых.
 */
export function unsubscribe(bus, name, fnOrSub) {
    const key = signalName(name);
    const list = bus.subs.get(key);
    if (!list || !list.length) return 0;
    const match = (sub) => {
        if (fnOrSub === undefined || fnOrSub === null) return true;
        if (typeof fnOrSub === 'function') return sub.fn === fnOrSub;
        if (typeof fnOrSub === 'number') return sub.id === fnOrSub;
        return sub === fnOrSub;
    };
    let removed = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        if (match(list[i])) {
            list[i].alive = false;
            list.splice(i, 1);
            removed++;
        }
    }
    if (!list.length) bus.subs.delete(key);
    return removed;
}

/** Сколько подписчиков у имени; без имени — суммарно по всем именам. */
export function subscriberCount(bus, name) {
    if (name === undefined || name === null) {
        let total = 0;
        for (const list of bus.subs.values()) total += list.length;
        return total;
    }
    const list = bus.subs.get(signalName(name));
    return list ? list.length : 0;
}

/** Подписки имени в порядке вызова (копия — менять список снаружи нельзя). */
export function subscribersOf(bus, name) {
    const list = bus.subs.get(signalName(name));
    return list ? list.slice() : [];
}

/** Имена сигналов, у которых есть подписчики или ожидания. */
export function busNames(bus) {
    const names = [];
    for (const key of bus.subs.keys()) names.push(key);
    for (const key of bus.waiters.keys()) if (names.indexOf(key) < 0) names.push(key);
    return names;
}

/**
 * Рассылка. args — массив аргументов (обёртка $.signal.emit разворачивает
 * ...args в него). Возвращает число вызванных подписчиков; 0, если доставка
 * отложена (emit пришёл во время другой рассылки) — это не ошибка.
 *
 * Гарантии порядка:
 *   * обработчики одного сигнала идут по приоритету, затем по подписке;
 *   * emit, вызванный из обработчика, не вклинивается в текущую рассылку,
 *     а встаёт в очередь и рассылается после неё (FIFO);
 *   * подписка/отписка во время рассылки не меняет уже собранный список:
 *     отписавшийся до своей очереди обработчик всё равно не вызывается,
 *     а новый подписчик получит только следующие события.
 */
export function emit(bus, name, args) {
    const key = signalName(name);
    const list = args === undefined ? [] : args;
    if (bus.depth > 0) {
        bus.queue.push({ name: key, args: list });
        return 0;
    }
    bus.depth = 1;
    let delivered = 0;
    try {
        delivered += deliver(bus, key, list);
        while (bus.queue.length) {
            const item = bus.queue.shift();
            delivered += deliver(bus, item.name, item.args);
        }
    } finally {
        bus.depth = 0;
    }
    return delivered;
}

/** Сколько emit'ов стоит в очереди (видно из обработчика, если он любопытный). */
export function pendingEmits(bus) { return bus.queue.length; }

/** Снятие подписок: с именем — только его, без имени — все. */
export function clearBus(bus, name) {
    if (name === undefined || name === null) {
        let removed = 0;
        for (const key of Array.from(bus.subs.keys())) removed += unsubscribe(bus, key);
        return removed;
    }
    return unsubscribe(bus, signalName(name));
}

function deliver(bus, name, args) {
    const list = bus.subs.get(name);
    let delivered = 0;
    if (list && list.length) {
        // Снимок: обработчик может подписаться или отписаться прямо во время
        // рассылки — текущий проход от этого не меняется.
        const snapshot = list.slice();
        for (const sub of snapshot) {
            if (!sub.alive) continue;
            // once снимаем ДО вызова: повторный emit изнутри обработчика
            // не должен вызвать его второй раз.
            if (sub.once) unsubscribe(bus, name, sub);
            try {
                sub.fn(...args);
            } catch (error) {
                reportBusError(bus, error, name);
            }
            delivered++;
        }
    }
    resolveWaiters(bus, name, args);
    return delivered;
}

function reportBusError(bus, error, name) {
    if (typeof bus.on_error !== 'function') return;
    try {
        bus.on_error(error, name);
    } catch (ignored) {
        // Ошибка в самом обработчике ошибок не должна рвать рассылку.
    }
}

// ---------------------------------------------------------------------------
// Ожидание сигнала: $.signal.waitFor(name).then(…)
// ---------------------------------------------------------------------------

/**
 * Ожидание сигнала. Возвращает объект-«обещание» с методами:
 *   then(onOk, onErr) — обработчик получает аргументы сигнала;
 *   catch(onErr); cancel(reason); done(); value().
 *
 * Если сигнал уже пришёл, then() вызывает обработчик сразу (синхронно) —
 * так сценарный код не зависит от микротасков. Иначе возвращается настоящее
 * Promise, и await тоже работает.
 */
export function waitFor(bus, name) {
    const key = signalName(name);
    const waiter = makeWaiter(key);
    let list = bus.waiters.get(key);
    if (!list) { list = []; bus.waiters.set(key, list); }
    list.push(waiter);
    waiter._detach = () => {
        const current = bus.waiters.get(key);
        if (!current) return;
        const i = current.indexOf(waiter);
        if (i >= 0) current.splice(i, 1);
        if (!current.length) bus.waiters.delete(key);
    };
    return waiter;
}

/** Сколько ожиданий висит на сигнале (без имени — суммарно). */
export function waiterCount(bus, name) {
    if (name === undefined || name === null) {
        let total = 0;
        for (const list of bus.waiters.values()) total += list.length;
        return total;
    }
    const list = bus.waiters.get(signalName(name));
    return list ? list.length : 0;
}

function makeWaiter(name) {
    const waiter = {
        name,
        settled: false,
        cancelled: false,
        args: null,
        error: null,
        _watchers: [],
        _detach: null,
    };

    waiter.then = (onOk, onErr) => waiterThen(waiter, onOk, onErr);
    waiter.catch = (onErr) => waiterThen(waiter, undefined, onErr);
    waiter.done = () => waiter.settled;
    waiter.value = () => waiter.args;
    waiter.cancel = (reason) => cancelWaiter(waiter, reason);
    return waiter;
}

function waiterThen(waiter, onOk, onErr) {
    const run = () => {
        const fn = waiter.cancelled ? onErr : onOk;
        if (typeof fn !== 'function') {
            // Без обработчика: успех отдаёт массив аргументов, отмена — исключение
            // (как у обычного Promise: необработанный reject виден вызывающему).
            if (waiter.cancelled) throw waiter.error;
            return waiter.args;
        }
        return waiter.cancelled ? fn(waiter.error, waiter) : fn(...(waiter.args || []));
    };
    if (waiter.settled) {
        try {
            return Promise.resolve(run());
        } catch (error) {
            return Promise.reject(error);
        }
    }
    return new Promise((resolve, reject) => {
        waiter._watchers.push(() => {
            try { resolve(run()); } catch (error) { reject(error); }
        });
    });
}

function cancelWaiter(waiter, reason) {
    if (waiter.settled) return false;
    waiter.settled = true;
    waiter.cancelled = true;
    waiter.error = reason instanceof Error
        ? reason
        : new Error(reason === undefined ? `$.signal.waitFor("${waiter.name}"): ожидание отменено` : String(reason));
    if (typeof waiter._detach === 'function') waiter._detach();
    notifyWaiter(waiter);
    return true;
}

function resolveWaiters(bus, name, args) {
    const list = bus.waiters.get(name);
    if (!list || !list.length) return 0;
    const ready = list.filter((w) => !w.settled);
    bus.waiters.delete(name);
    for (const waiter of ready) {
        waiter.settled = true;
        waiter.args = args.slice();
        waiter._detach = null;
        notifyWaiter(waiter);
    }
    return ready.length;
}

function notifyWaiter(waiter) {
    const watchers = waiter._watchers.splice(0);
    for (const fn of watchers) fn();
}

// ---------------------------------------------------------------------------
// Установка подсистемы
// ---------------------------------------------------------------------------

/**
 * Ставит $.signal. Шина — модульная: сигналы переживают смену сцены, поэтому
 * чистить её нужно самому ($.signal.clear() в обработчике смены сцены, если
 * подписки принадлежали старой сцене).
 */
export function installSignal($) {
    const bus = createBus();
    bus.on_error = (error, name) => {
        ctx.log(`$.signal: ошибка в обработчике "${name}": ${error}`);
    };

    $.signal = {
        /** Подписка: fn(...args). opts: { priority, once }. Возвращает id. */
        on(name, fn, opts) { return subscribe(bus, name, fn, opts).id; },

        /** Подписка на одно срабатывание. */
        once(name, fn, opts) {
            const o = opts ? Object.assign({}, opts) : {};
            o.once = true;
            return subscribe(bus, name, fn, o).id;
        },

        /** Отписка: fn, id или ничего (снять всех). Возвращает число снятых. */
        off(name, fnOrId) { return unsubscribe(bus, name, fnOrId); },

        /** Рассылка: $.signal.emit('enemy:died', enemy, 10). Возвращает число вызовов. */
        emit(name, ...args) { return emit(bus, name, args); },

        /** Снять подписки имени; без имени — все. */
        clear(name) { return clearBus(bus, name); },

        /** Счётчик подписчиков: count('x') или count() — всего. */
        count(name) { return subscriberCount(bus, name); },

        /** Есть ли живые подписчики (удобно не собирать тяжёлые данные зря). */
        has(name) { return subscriberCount(bus, name) > 0; },

        /** Имена сигналов с подписчиками или ожиданиями. */
        names() { return busNames(bus); },

        /** Описание подписок имени — для отладки и тестов. */
        list(name) {
            return subscribersOf(bus, name).map((sub) => ({ id: sub.id, priority: sub.priority, once: sub.once }));
        },

        /**
         * Ожидание сигнала: const [enemy] = await $.signal.waitFor('enemy:died').
         * opts.timeout (мс игрового времени) отменяет ожидание с ошибкой.
         */
        waitFor(name, opts) {
            const waiter = waitFor(bus, name);
            const timeout = opts ? Number(opts.timeout) : 0;
            if (timeout > 0) {
                if (ctx.time && typeof ctx.time.after === 'function') {
                    const id = ctx.time.after(timeout, () => {
                        waiter.cancel(new Error(`$.signal.waitFor("${name}"): истёк таймаут ${timeout} мс`));
                    });
                    waiter.then(() => ctx.time.cancel(id), () => ctx.time.cancel(id));
                } else {
                    ctx.log('$.signal.waitFor: timeout требует $.time — жду без ограничения времени');
                }
            }
            return waiter;
        },

        /** Сколько ожиданий висит на сигнале. */
        waiters(name) { return waiterCount(bus, name); },

        /** Сама шина — для отладки и юнит-тестов. */
        bus() { return bus; },
    };
    return $;
}
