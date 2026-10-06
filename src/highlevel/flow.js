// ===========================================================================
// Потоки и таймеры: $.flow — последовательности, параллельность, задержки.
//
// Всё расписание живёт на игровом времени: tickFlow() берёт шаг из
// $.time.delta(), поэтому пауза и $.time.scale останавливают и ускоряют
// потоки вместе с игрой. Date.now() и setTimeout здесь не используются — при
// --fixed-dt прогон детерминирован: одни и те же кадры дают один и тот же
// порядок вызовов.
//
//   $.flow.series([
//       0.2,                                  // подождать 200 мс
//       () => $.sound.play('step'),           // шаг
//       () => $.flow.parallel([               // шаг, который ждёт параллель
//           $.flow.delay(300),
//           () => door.open(),
//       ]),
//   ]).then(() => $.log('вошли'));
//
// Чем это отличается от $.time.after/every и $.sequence:
//   * хендл потока можно отменить целиком (вместе с вложенными шагами),
//     а не по одному таймеру;
//   * then() возвращает НОВЫЙ хендл, поэтому цепочки собираются как обычные
//     промисы, но выполняются в кадре, а не в микротасках;
//   * шаги не «слипаются» в один кадр: следующая ступень серии стартует не
//     раньше следующего tickFlow().
//
// Чистое ядро — планировщик (createScheduler/advanceScheduler/…) — ничего не
// знает про ctx и движок, его проверяет qjs без сборки (_CONTRACT.md §4).
// ===========================================================================

import { ctx } from './core.js';

/** Сколько задач разрешено выполнить за один шаг — защита от period = 0. */
const MAX_FIRINGS_PER_ADVANCE = 10000;

/** Сколько завершённых хендлов копить до чистки (нужны только для cancelAll). */
const LIVE_FLOW_LIMIT = 256;

// ---------------------------------------------------------------------------
// Чистый планировщик
// ---------------------------------------------------------------------------

/**
 * Расписание. Время — в миллисекундах, накопленное advanceScheduler;
 * никаких обращений к системным часам.
 */
export function createScheduler() {
    return {
        tasks: [],
        now: 0,
        seq: 0,
        next_id: 1,
        on_error: null,   // (error, task) => void
    };
}

/**
 * Ставит задачу: fn сработает, когда накопится delayMs. periodMs > 0 делает
 * задачу периодической (fn будет зваться каждые periodMs, «догоняя» время,
 * если кадр оказался длиннее периода).
 */
export function scheduleAfter(sched, delayMs, fn, periodMs) {
    if (typeof fn !== 'function') {
        throw new Error('$.flow: задача должна быть функцией — scheduleAfter(sched, ms, () => …)');
    }
    const delay = Number(delayMs);
    const period = Number(periodMs);
    const task = {
        id: sched.next_id++,
        seq: sched.seq++,
        at: sched.now + (Number.isFinite(delay) && delay > 0 ? delay : 0),
        period: Number.isFinite(period) && period > 0 ? period : 0,
        fn,
        alive: true,
    };
    sched.tasks.push(task);
    return task;
}

/** Снимает задачу; false — если она уже сработала или снята. */
export function cancelTask(sched, task) {
    if (!task || !task.alive) return false;
    task.alive = false;
    return true;
}

/** Снимает все задачи, возвращает число снятых. */
export function cancelAllTasks(sched) {
    let cancelled = 0;
    for (const task of sched.tasks) if (task.alive) { task.alive = false; cancelled++; }
    sched.tasks.length = 0;
    return cancelled;
}

/** Сколько живых задач в расписании. */
export function schedulerSize(sched) {
    let alive = 0;
    for (const task of sched.tasks) if (task.alive) alive++;
    return alive;
}

/**
 * Продвигает время на ms и выполняет созревшие задачи.
 *
 * Порядок детерминирован: сначала по сроку (at), при равных сроках — по
 * порядку постановки (seq). Задачи, поставленные ВНУТРИ этого шага (например,
 * следующая ступень серии), сработают не раньше следующего вызова — иначе
 * бесконечный repeat() зациклил бы кадр.
 */
export function advanceScheduler(sched, ms) {
    const step = Number(ms);
    // Нулевой шаг допустим и нужен: он «проявляет» задачи, поставленные ровно
    // на текущее время (delay(0) и следующая ступень серии).
    if (!Number.isFinite(step) || step < 0) return 0;
    sched.now += step;
    const cutoff = sched.seq;
    let fired = 0;

    for (;;) {
        let best = null;
        for (const task of sched.tasks) {
            if (!task.alive || task.seq >= cutoff) continue;
            if (task.at > sched.now) continue;
            if (!best || task.at < best.at || (task.at === best.at && task.seq < best.seq)) best = task;
        }
        if (!best) break;

        if (best.period > 0) best.at += best.period;
        else best.alive = false;

        try {
            best.fn(sched.now);
        } catch (error) {
            reportTaskError(sched, error, best);
        }
        fired++;
        if (fired >= MAX_FIRINGS_PER_ADVANCE) {
            reportTaskError(sched, new Error(`за один шаг сработало ${fired} задач — проверьте period`), best);
            break;
        }
    }

    pruneTasks(sched);
    return fired;
}

function pruneTasks(sched) {
    for (let i = sched.tasks.length - 1; i >= 0; i--) {
        if (!sched.tasks[i].alive) sched.tasks.splice(i, 1);
    }
}

function reportTaskError(sched, error, task) {
    if (typeof sched.on_error !== 'function') return;
    try {
        sched.on_error(error, task);
    } catch (ignored) {
        // ошибка в обработчике ошибок не должна останавливать расписание
    }
}

// ---------------------------------------------------------------------------
// Хендлы потоков
// ---------------------------------------------------------------------------

// Планировщик игры: все $.flow.* и tickFlow работают с ним.
const sched = createScheduler();
const live_flows = [];

/** Хендл потока (то, что возвращают series/parallel/delay/after/repeat). */
export function isFlowHandle(value) {
    return !!(value && typeof value === 'object' && value.__flow === true && typeof value.cancel === 'function');
}

function reportFlowError(error) {
    try {
        ctx.log(`$.flow: ${error}`);
    } catch (ignored) {
        // вне движка логировать некуда — работа продолжается
    }
}

function makeHandle(kind) {
    const handle = {
        __flow: true,
        kind,
        state: 'pending',      // pending | done | failed | cancelled
        value: undefined,
        error: null,
        children: [],          // вложенные шаги-хендлы: отмена родителя отменяет их
        tasks: [],             // задачи планировщика, поставленные этим хендлом
        upstream: null,        // звено цепочки, из которого вырос этот хендл
        sched,
        _watchers: [],
        _handled: false,
    };
    handle.then = (onOk, onErr) => chainHandle(handle, onOk, onErr);
    handle.catch = (onErr) => chainHandle(handle, undefined, onErr);
    handle.cancel = (reason) => cancelFlow(handle, reason);
    handle.done = () => handle.state !== 'pending';
    handle.isDone = () => handle.state === 'done';
    handle.isFailed = () => handle.state === 'failed';
    handle.isCancelled = () => handle.state === 'cancelled';
    handle.isPending = () => handle.state === 'pending';
    // Хендлы ссылаются друг на друга (children ↔ upstream), поэтому без toJSON
    // JSON.stringify на них падал бы — а через агент и $.store это реальный путь.
    handle.toJSON = () => ({ kind: handle.kind, state: handle.state });

    if (live_flows.length > LIVE_FLOW_LIMIT) {
        for (let i = live_flows.length - 1; i >= 0; i--) {
            if (live_flows[i].state !== 'pending') live_flows.splice(i, 1);
        }
    }
    live_flows.push(handle);
    return handle;
}

function notifyHandle(handle) {
    const watchers = handle._watchers.splice(0);
    for (const fn of watchers) fn(handle.state, handle.value, handle.error);
}

function watchHandle(handle, fn) {
    if (handle.state === 'pending') handle._watchers.push(fn);
    else fn(handle.state, handle.value, handle.error);
}

/** Успешное завершение хендла. Повторный вызов ничего не делает. */
export function settleHandle(handle, value) {
    if (!handle || handle.state !== 'pending') return false;
    handle.state = 'done';
    handle.value = value;
    notifyHandle(handle);
    return true;
}

/** Провал хендла. Необработанная ошибка (без catch/then с onErr) уходит в лог. */
export function failHandle(handle, error) {
    if (!handle || handle.state !== 'pending') return false;
    handle.state = 'failed';
    handle.error = error instanceof Error ? error : new Error(String(error));
    if (!handle._handled && handle._watchers.length === 0) reportFlowError(handle.error);
    notifyHandle(handle);
    return true;
}

/**
 * Отмена. Отменяет хендл, всё, что он запустил (children), и всю цепочку
 * then() до самого начала (upstream) — отменить «хвост» цепочки, оставив
 * работать её начало, почти никогда не нужно.
 */
export function cancelFlow(handle, reason) {
    if (!handle || handle.state !== 'pending') return false;
    handle.state = 'cancelled';
    handle.error = reason instanceof Error
        ? reason
        : new Error(reason === undefined ? '$.flow: отменено' : String(reason));
    if (handle.upstream) cancelFlow(handle.upstream, handle.error);
    for (const child of handle.children.slice()) cancelFlow(child, handle.error);
    for (const task of handle.tasks) cancelTask(handle.sched, task);
    handle.tasks.length = 0;
    notifyHandle(handle);
    return true;
}

/** Сколько потоков сейчас в работе (для отладки и тестов). */
export function activeFlowCount() {
    let pending = 0;
    for (const handle of live_flows) if (handle.state === 'pending') pending++;
    return pending;
}

function adoptChild(owner, child) {
    if (owner) owner.children.push(child);
    return child;
}

/** Следующая ступень — отдельной задачей: шаги не слипаются в один кадр. */
function planNext(handle, fn) {
    const task = scheduleAfter(handle.sched, 0, () => {
        if (handle.state !== 'pending') return;
        fn();
    });
    handle.tasks.push(task);
}

/**
 * Приводит результат шага к ожиданию:
 *   число         — задержка в мс;
 *   flow-хендл    — ждём его (и отменяем вместе с родителем);
 *   Promise       — ждём (завершится в микротаске, вне кадра);
 *   прочее        — шаг завершён сразу, значение уходит в value.
 */
function waitForResult(result, owner, onDone, onFail) {
    if (result === undefined || result === null) { onDone(undefined); return; }
    if (isFlowHandle(result)) {
        adoptChild(owner, result);
        watchHandle(result, (state, value, error) => {
            if (state === 'done') onDone(value);
            else onFail(error || new Error('$.flow: шаг отменён'));
        });
        return;
    }
    if (typeof result === 'number' && Number.isFinite(result)) {
        const wait = adoptChild(owner, flowDelay(result));
        watchHandle(wait, (state) => {
            if (state === 'done') onDone(undefined);
            else onFail(wait.error);
        });
        return;
    }
    if (typeof result.then === 'function') {
        const child = adoptChild(owner, makeHandle('promise'));
        Promise.resolve(result).then(
            (value) => settleHandle(child, value),
            (error) => failHandle(child, error),
        );
        watchHandle(child, (state, value, error) => {
            if (state === 'done') onDone(value);
            else onFail(error);
        });
        return;
    }
    onDone(result);
}

/** Один шаг потока: число (мс), функция, хендл или Promise. */
function runStep(step, index, owner, onDone, onFail) {
    if (typeof step === 'number') { waitForResult(step, owner, onDone, onFail); return; }
    if (typeof step === 'function') {
        let result;
        try {
            result = step(index, owner);
        } catch (error) {
            onFail(error);
            return;
        }
        waitForResult(result, owner, onDone, onFail);
        return;
    }
    if (isFlowHandle(step) || (step && typeof step.then === 'function') || step === undefined || step === null || step === false) {
        waitForResult(step, owner, onDone, onFail);
        return;
    }
    onFail(new Error(`$.flow: шаг должен быть числом (мс), функцией или flow-хендлом — получено ${typeof step}`));
}

function normalizeSteps(steps) {
    if (steps === undefined || steps === null) return [];
    return Array.isArray(steps) ? steps.slice() : [steps];
}

// ---------------------------------------------------------------------------
// Виды потоков
// ---------------------------------------------------------------------------

/** Задержка в мс игрового времени. delay(0) завершается сразу. */
export function flowDelay(ms) {
    const handle = makeHandle('delay');
    const wait = Number(ms);
    if (!Number.isFinite(wait) || wait <= 0) {
        settleHandle(handle, 0);
        return handle;
    }
    const task = scheduleAfter(sched, wait, () => settleHandle(handle, wait));
    handle.tasks.push(task);
    return handle;
}

/** Последовательность: шаги выполняются по очереди, следующий — в новом кадре. */
export function flowSeries(steps, owner) {
    const handle = adoptChild(owner, makeHandle('series'));
    const list = normalizeSteps(steps);
    if (!list.length) { settleHandle(handle, []); return handle; }
    const values = [];
    let index = 0;
    const step = () => {
        if (handle.state !== 'pending') return;
        if (index >= list.length) { settleHandle(handle, values); return; }
        const at = index++;
        runStep(list[at], at, handle, (value) => {
            if (value !== undefined) values.push(value);
            // Последний шаг завершает серию сразу; остальные — в следующем кадре,
            // чтобы длинная серия не выполнялась одним куском.
            if (index >= list.length) { settleHandle(handle, values); return; }
            planNext(handle, step);
        }, (error) => failHandle(handle, error));
    };
    step();
    return handle;
}

/** Параллельность: все шаги стартуют сразу, хендл завершается последним. */
export function flowParallel(steps, owner) {
    const handle = adoptChild(owner, makeHandle('parallel'));
    const list = normalizeSteps(steps);
    if (!list.length) { settleHandle(handle, []); return handle; }
    const values = new Array(list.length);
    let left = list.length;
    list.forEach((step, index) => {
        // После провала ветки остальные не запускаем: работа, которую никто
        // не ждёт, — это забытые таймеры и звуки, которые доиграют без сцены.
        if (handle.state !== 'pending') return;
        runStep(step, index, handle, (value) => {
            if (handle.state !== 'pending') return;
            values[index] = value;
            if (--left === 0) settleHandle(handle, values);
        }, (error) => {
            if (handle.state !== 'pending') return;
            failHandle(handle, error);
            // Ветки, которые ещё не стартовали, тоже принадлежат parallel:
            // если это готовые хендлы — снимаем их, чтобы не текли.
            for (const item of list) if (isFlowHandle(item)) cancelFlow(item, error);
            for (const child of handle.children.slice()) cancelFlow(child, error);
        });
    });
    return handle;
}

/** Повторы: repeat(3, (i) => …). times < 0 — бесконечно (до отмены). */
export function flowRepeat(times, fn, owner) {
    if (typeof fn !== 'function') {
        throw new Error('$.flow.repeat: нужен обработчик — $.flow.repeat(3, (i) => …); отрицательное число повторов = бесконечно');
    }
    const handle = adoptChild(owner, makeHandle('repeat'));
    const total = Number(times);
    const infinite = !Number.isFinite(total) || total < 0;
    const limit = infinite ? Infinity : Math.floor(total);
    if (!infinite && limit <= 0) { settleHandle(handle, 0); return handle; }

    let index = 0;
    const step = () => {
        if (handle.state !== 'pending') return;
        if (index >= limit) { settleHandle(handle, index); return; }
        const at = index++;
        runStep(fn, at, handle, () => {
            if (index >= limit) { settleHandle(handle, index); return; }
            planNext(handle, step);
        }, (error) => failHandle(handle, error));
    };
    step();
    return handle;
}

/** Цепочка: then() возвращает новый хендл, связанный с исходным. */
function chainHandle(handle, onOk, onErr) {
    if (typeof onErr === 'function') handle._handled = true;
    const next = makeHandle(`${handle.kind}.then`);
    next.upstream = handle;
    watchHandle(handle, (state, value, error) => {
        const fn = state === 'done' ? onOk : onErr;
        if (typeof fn !== 'function') {
            // Без обработчика успех и ошибка идут дальше по цепочке.
            if (state === 'done') settleHandle(next, value);
            else if (state === 'failed') failHandle(next, error);
            else cancelFlow(next, error);
            return;
        }
        let result;
        try {
            result = state === 'done' ? fn(value, handle) : fn(error, handle);
        } catch (thrown) {
            failHandle(next, thrown);
            return;
        }
        adoptResult(next, result);
    });
    return next;
}

function adoptResult(handle, result) {
    if (isFlowHandle(result)) {
        adoptChild(handle, result);
        watchHandle(result, (state, value, error) => {
            if (state === 'done') settleHandle(handle, value);
            else if (state === 'failed') failHandle(handle, error);
            else cancelFlow(handle, error);
        });
        return;
    }
    if (result && typeof result.then === 'function') {
        Promise.resolve(result).then(
            (value) => settleHandle(handle, value),
            (error) => failHandle(handle, error),
        );
        return;
    }
    settleHandle(handle, result);
}

// ---------------------------------------------------------------------------
// Кадровый шаг
// ---------------------------------------------------------------------------

/**
 * Шаг в миллисекундах — для юнит-тестов и пошаговых прогонов (--fixed-dt).
 */
export function tickFlowMs(ms) {
    return advanceScheduler(sched, ms);
}

/**
 * Кадровый шаг. Шаг времени берётся из $.time.delta() — поэтому пауза и
 * $.time.scale действуют на потоки сами, и неважно, с каким dt позвал
 * интегратор. Без $.time (юнит-тест) используется dt в секундах.
 */
export function tickFlow(dt) {
    return advanceScheduler(sched, frameDeltaMs(dt));
}

function frameDeltaMs(dt) {
    if (ctx.time && typeof ctx.time.delta === 'function') return ctx.time.delta() * 1000;
    if (typeof dt === 'number' && Number.isFinite(dt)) return Math.max(0, dt) * 1000;
    const raw = typeof engine === 'undefined' ? null : engine.dt;
    return Number.isFinite(raw) ? Math.max(0, raw) * 1000 : 0;
}

// ---------------------------------------------------------------------------
// Установка подсистемы
// ---------------------------------------------------------------------------

/**
 * Ставит $.flow. Расписание общее на игру: $.flow.cancelAll() останавливает
 * всё, что было запущено (удобно в обработчике смены сцены).
 */
export function installFlow($) {
    sched.on_error = (error) => reportFlowError(error);

    $.flow = {
        /** Последовательность шагов; value — массив результатов шагов. */
        series(steps) { return flowSeries(steps); },

        /** Все шаги сразу; value — результаты в порядке шагов. */
        parallel(steps) { return flowParallel(steps); },

        /** Задержка; хендл можно отменить или дополнить через then(). */
        delay(ms) { return flowDelay(ms); },

        /** Однократный вызов через ms — то же, что delay(ms).then(fn). */
        after(ms, fn) {
            const handle = flowDelay(ms);
            return typeof fn === 'function' ? chainHandle(handle, fn, undefined) : handle;
        },

        /** n повторов fn(i); fn может вернуть число мс или хендл для паузы. */
        repeat(times, fn) { return flowRepeat(times, fn); },

        /** Отмена хендла вместе с вложенными шагами и началом цепочки. */
        cancel(handle) { return cancelFlow(handle); },

        /** Отменить всё: и потоки, и отдельные задержки. Возвращает число отмен. */
        cancelAll() {
            let cancelled = 0;
            for (const handle of live_flows.slice()) {
                if (handle.state === 'pending' && cancelFlow(handle, '$.flow.cancelAll()')) cancelled++;
            }
            cancelAllTasks(sched);
            return cancelled;
        },

        /** Сколько потоков в работе. */
        active() { return activeFlowCount(); },

        /** Игровое время расписания в миллисекундах (не Date.now()). */
        now() { return sched.now; },

        /** Планировщик — для отладки и юнит-тестов. */
        scheduler() { return sched; },
    };
    return $;
}
