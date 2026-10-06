// ===========================================================================
// Юнит-тесты потоков и таймеров (src/highlevel/flow.js) без движка.
//
// Главное здесь — детерминированность: расписание живёт на игровом времени,
// поэтому шаги проверяются пошагово через tickFlowMs(ms) без ожиданий и
// Date.now(). Проверяем порядок задач, «не слипание» шагов в один кадр,
// отмену вложенных потоков, цепочки then, повторы, провал шага и то, что
// tickFlow берёт время из $.time (пауза останавливает потоки).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/flow_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, joined, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';
import {
    installFlow, tickFlow, tickFlowMs, createScheduler, scheduleAfter,
    advanceScheduler, cancelTask, cancelAllTasks, schedulerSize,
    isFlowHandle,
} from '../../src/highlevel/flow.js';

// $.flow ставится на пустой объект: расписанию движок не нужен.
const $ = {};
installFlow($);

/** Чистое расписание перед каждым тестом: задачи и хендлы не текут между ними. */
function fresh() {
    $.flow.cancelAll();
}

// ---------------------------------------------------------------------------
// Чистый планировщик
// ---------------------------------------------------------------------------

test('планировщик: сроки соблюдаются, при равных — порядок постановки', () => {
    const s = createScheduler();
    const order = [];
    scheduleAfter(s, 30, () => order.push('c'));
    scheduleAfter(s, 10, () => order.push('a'));
    scheduleAfter(s, 10, () => order.push('b'));
    eq(advanceScheduler(s, 5), 0, 'до срока ничего не сработало');
    eq(s.now, 5, 'время копится только через advanceScheduler');
    eq(advanceScheduler(s, 5), 2, 'ровно к сроку — обе задачи');
    eq(joined(order), 'a,b');
    eq(advanceScheduler(s, 20), 1);
    eq(joined(order), 'a,b,c');
    eq(schedulerSize(s), 0, 'разовые задачи уходят из расписания');
});

test('периодическая задача догоняет время и снимается cancelTask', () => {
    const s = createScheduler();
    let ticks = 0;
    const task = scheduleAfter(s, 100, () => { ticks++; }, 100);
    advanceScheduler(s, 250);
    eq(ticks, 2, 'на 250 мс период 100 даёт два срабатывания');
    eq(schedulerSize(s), 1, 'периодическая задача остаётся живой');
    truthy(cancelTask(s, task));
    advanceScheduler(s, 100);
    eq(ticks, 2);
    falsy(cancelTask(s, task), 'повторная отмена — false');
    eq(cancelAllTasks(s), 0, 'снимать больше нечего');
});

test('задача, поставленная внутри шага, срабатывает не раньше следующего', () => {
    const s = createScheduler();
    const order = [];
    scheduleAfter(s, 0, () => {
        order.push('first');
        scheduleAfter(s, 0, () => order.push('second'));
    });
    eq(advanceScheduler(s, 0), 1, 'за нулевой шаг — ровно одна задача');
    eq(joined(order), 'first');
    eq(advanceScheduler(s, 0), 1);
    eq(joined(order), 'first,second');
});

test('ошибка в задаче уходит в on_error и не срывает остальные', () => {
    const s = createScheduler();
    const errors = [];
    s.on_error = (error) => errors.push(error.message);
    const fired = [];
    scheduleAfter(s, 1, () => { throw new Error('бум'); });
    scheduleAfter(s, 1, () => fired.push('после'));
    eq(advanceScheduler(s, 1), 2);
    eq(joined(fired), 'после');
    eq(joined(errors), 'бум');
});

test('scheduleAfter требует функцию — иначе понятная ошибка', () => {
    const s = createScheduler();
    let message = '';
    try { scheduleAfter(s, 10, 'не функция'); } catch (error) { message = error.message; }
    truthy(message.indexOf('задача должна быть функцией') >= 0, message);
});

// ---------------------------------------------------------------------------
// Задержки и последовательности
// ---------------------------------------------------------------------------

test('$.flow.delay: хендл завершается ровно к сроку, delay(0) — сразу', () => {
    fresh();
    const h = $.flow.delay(100);
    truthy(isFlowHandle(h));
    truthy(h.isPending());
    tickFlowMs(99);
    truthy(h.isPending(), 'на 99 мс ещё ждём');
    tickFlowMs(1);
    truthy(h.isDone());
    eq(h.value, 100);
    const zero = $.flow.delay(0);
    truthy(zero.isDone(), 'delay(0) завершается сразу');
    falsy(zero.isPending());
});

test('$.flow.series: шаги по очереди, число — задержка, следующий шаг в новом кадре', () => {
    fresh();
    const order = [];
    const h = $.flow.series([
        () => { order.push('a'); return 'итог-a'; },
        () => { order.push('b'); },
        50,
        () => { order.push('c'); return 7; },
    ]);
    eq(joined(order), 'a', 'первый шаг стартует сразу');
    tickFlowMs(0);
    eq(joined(order), 'a,b', 'следующий шаг — в следующем кадре, а не в том же');
    tickFlowMs(0);
    tickFlowMs(49);
    eq(joined(order), 'a,b', 'задержка 50 мс ещё не прошла');
    tickFlowMs(1);
    tickFlowMs(0);
    eq(joined(order), 'a,b,c');
    tickFlowMs(7);
    truthy(h.isDone(), 'число 7, возвращённое шагом, — это пауза 7 мс');
    eq(joined(h.value), 'итог-a', 'в value попадают только нечисловые результаты');
});

test('пустая серия завершается сразу — цепочка then не ждёт кадра', () => {
    fresh();
    let got = null;
    const h = $.flow.series([]).then((values) => { got = values.length; });
    eq(got, 0);
    truthy(h.isDone());
});

test('отмена родителя отменяет вложенный поток', () => {
    fresh();
    const log = [];
    let inner = null;
    const outer = $.flow.series([
        () => { log.push('outer-1'); },
        () => {
            inner = $.flow.series([
                () => { log.push('inner-1'); },
                $.flow.delay(100),
                () => { log.push('inner-2'); },
            ]);
            return inner;
        },
        () => { log.push('outer-2'); },
    ]);
    eq(joined(log), 'outer-1');
    tickFlowMs(0);
    eq(joined(log), 'outer-1,inner-1');
    tickFlowMs(50);
    truthy(inner.isPending());
    truthy(outer.isCancelled() === false);
    outer.cancel();
    truthy(inner.isCancelled(), 'вложенный поток отменён вместе с родителем');
    tickFlowMs(500);
    eq(joined(log), 'outer-1,inner-1', 'после отмены шаги не выполняются');
    truthy(outer.isCancelled());
});

// ---------------------------------------------------------------------------
// Параллельность и повторы
// ---------------------------------------------------------------------------

test('$.flow.parallel: все ветки стартуют сразу, значения — в порядке шагов', () => {
    fresh();
    const h = $.flow.parallel([
        () => 'A',
        $.flow.delay(100).then(() => 'B'),
        $.flow.delay(50).then(() => 'C'),
    ]);
    tickFlowMs(50);
    falsy(h.isDone(), 'ветка 100 мс ещё идёт');
    tickFlowMs(50);
    truthy(h.isDone(), 'хендл ждёт последнюю ветку');
    eq(joined(h.value), 'A,B,C', 'значения в порядке шагов, а не завершения');
});

test('провал ветки parallel отменяет остальные и виден в catch', () => {
    fresh();
    let message = '';
    const sibling = $.flow.delay(200);
    const h = $.flow.parallel([
        () => { throw new Error('ветка упала'); },
        sibling,
    ]).catch((error) => { message = error.message; });
    eq(message, 'ветка упала');
    truthy(sibling.isCancelled(), 'не стартовавшая ветка-хендл снята');
    truthy(h.isDone(), 'catch вернул завершённый хендл');
    tickFlowMs(500);
    eq(message, 'ветка упала', 'отменённая ветка ничего не добавила');
});

test('$.flow.repeat: повторы, пауза между ними и мгновенный repeat(0)', () => {
    fresh();
    const seen = [];
    const h = $.flow.repeat(3, (i) => { seen.push(i); return 10; });
    eq(joined(seen), '0', 'первый повтор сразу');
    let guard = 0;
    while (!h.isDone() && guard++ < 20) {
        tickFlowMs(10);   // пауза 10 мс, которую вернул обработчик
        tickFlowMs(0);    // следующая итерация — в новом кадре
    }
    eq(joined(seen), '0,1,2');
    eq(h.value, 3, 'value повторного потока — число выполненных итераций');

    fresh();
    let calls = 0;
    const zero = $.flow.repeat(0, () => { calls++; });
    truthy(zero.isDone());
    eq(calls, 0, 'repeat(0) не зовёт обработчик');
});

test('$.flow.repeat с отрицательным числом идёт до отмены', () => {
    fresh();
    let calls = 0;
    const h = $.flow.repeat(-1, () => { calls++; });
    eq(calls, 1, 'первая итерация — сразу');
    for (let i = 0; i < 4; i++) tickFlowMs(0);
    eq(calls, 5, 'каждая следующая итерация — отдельный кадр (без зацикливания)');
    truthy(h.isPending());
    h.cancel();
    for (let i = 0; i < 5; i++) tickFlowMs(0);
    eq(calls, 5, 'после отмены итераций нет');
});

// ---------------------------------------------------------------------------
// after, then, cancelAll
// ---------------------------------------------------------------------------

test('$.flow.after срабатывает один раз и отменяется', () => {
    fresh();
    let calls = 0;
    const h = $.flow.after(30, () => { calls++; });
    tickFlowMs(29);
    eq(calls, 0);
    tickFlowMs(1);
    eq(calls, 1);
    tickFlowMs(100);
    eq(calls, 1, 'повторных вызовов нет');
    truthy(h.isDone());

    const cancelled = $.flow.after(30, () => { calls++; });
    cancelled.cancel();
    tickFlowMs(100);
    eq(calls, 1, 'отменённый after молчит');
});

test('цепочки then: значение течёт дальше, отмена хвоста отменяет начало', () => {
    fresh();
    const log = [];
    const h = $.flow.delay(10)
        .then((value) => { log.push('первый:' + value); return 5; })
        .then((value) => { log.push('второй:' + value); return 'итог'; });
    tickFlowMs(10);
    eq(joined(log), 'первый:10,второй:5', 'then выполняются в том же кадре, число — значение');
    truthy(h.isDone());
    eq(h.value, 'итог');

    const start = $.flow.delay(100);
    const tail = start.then(() => log.push('не должно быть'));
    tail.cancel();
    truthy(start.isCancelled(), 'отмена хвоста отменяет начало цепочки');
    tickFlowMs(200);
    eq(joined(log), 'первый:10,второй:5');
});

test('$.flow.cancelAll останавливает всё и считает отменённое', () => {
    fresh();
    const log = [];
    const a = $.flow.delay(100).then(() => log.push('a'));
    $.flow.series([10, () => log.push('b')]);
    truthy($.flow.active() >= 2, 'потоки в работе');
    truthy($.flow.cancelAll() >= 2);
    tickFlowMs(1000);
    eq(log.length, 0, 'после cancelAll ничего не выполняется');
    eq($.flow.active(), 0);
    truthy(a.isCancelled());
});

// ---------------------------------------------------------------------------
// Ошибки и игровое время
// ---------------------------------------------------------------------------

test('падение шага переводит хендл в failed и отдаёт ошибку в catch', () => {
    fresh();
    let message = '';
    const handled = $.flow.series([() => { throw new Error('шаг упал'); }])
        .catch((error) => { message = error.message; });
    eq(message, 'шаг упал');
    truthy(handled.isDone());

    fresh();
    const bad = $.flow.series([() => { throw new Error('молча'); }]);
    truthy(bad.isFailed());
    eq(bad.error.message, 'молча');
    const good = $.flow.delay(5);
    tickFlowMs(5);
    truthy(good.isDone(), 'соседний поток не сломался');
});

test('неподходящий шаг — понятная ошибка, а не тихий пропуск', () => {
    fresh();
    const h = $.flow.series([{}]);
    truthy(h.isFailed());
    truthy(h.error.message.indexOf('шаг должен быть числом') >= 0, h.error.message);
    let thrown = '';
    try { $.flow.repeat(2, 'не функция'); } catch (error) { thrown = error.message; }
    truthy(thrown.indexOf('нужен обработчик') >= 0, thrown);
});

test('tickFlow берёт шаг из $.time: пауза останавливает потоки', () => {
    fresh();
    let paused = false;
    ctx.time = { delta: () => (paused ? 0 : 0.05) };
    try {
        const h = $.flow.delay(100);
        tickFlow();
        truthy(h.isPending(), 'один кадр 50 мс — мало');
        tickFlow();
        truthy(h.isDone(), 'два кадра по 50 мс закрывают delay(100)');

        const waiting = $.flow.delay(10);
        paused = true;
        tickFlow();
        tickFlow();
        truthy(waiting.isPending(), 'на паузе поток стоит');
        paused = false;
        tickFlow();
        truthy(waiting.isDone());
    } finally {
        ctx.time = null;
    }
});

test('без $.time tickFlow понимает dt в секундах, время потоков — игровое', () => {
    fresh();
    const t0 = $.flow.now();
    tickFlow(0.25);
    eq($.flow.now() - t0, 250, '250 мс из dt = 0.25 с');
    tickFlowMs(750);
    eq($.flow.now() - t0, 1000);
    const h = $.flow.delay(1);
    tickFlowMs(0);
    truthy(h.isPending(), 'нулевой шаг не двигает время');
    tickFlowMs(1);
    truthy(h.isDone());
});

test('JSON.stringify хендла не падает на ссылках родитель ↔ ребёнок', () => {
    fresh();
    const parent = $.flow.series([() => 10, () => 10]);
    const child = parent.then(() => 1);
    const text = JSON.stringify(parent);
    truthy(text.indexOf('"kind":"series"') >= 0, text);
    eq(JSON.parse(JSON.stringify(child)).state, 'pending');
    parent.cancel();
    truthy(child.isCancelled(), 'отмена родителя добралась и до then-хендла');
});

finish();
