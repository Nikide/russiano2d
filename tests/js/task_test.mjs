// ===========================================================================
// Юнит-тесты планировщика работы кусками (src/highlevel/task.js) без движка.
//
// Проверяем то, что легко сломать: бюджет кадра, продолжение с того же места,
// завершение, отмена, брошенное исключение и генератор.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/task_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createScheduler, createGeneratorScheduler, installTask, tickTask, runningTasks } from '../../src/highlevel/task.js';

/** Часы, которые двигаются на `step` миллисекунд при каждом обращении. */
function fakeClock(step) {
    let value = 0;
    const now = () => { value += step; return value; };
    now.value = () => value;
    return now;
}

test('createScheduler: делает всю работу за один тик, если бюджет велик', () => {
    const done = [];
    const s = createScheduler((i) => done.push(i), { total: 5, budget: 1000, now: fakeClock(0.1) });
    eq(s.tick(), true, 'тик вернул «закончено»');
    eq(done.join(','), '0,1,2,3,4');
    eq(s.progress(), 1);
    truthy(s.finished);
});

test('createScheduler: уважает бюджет и продолжает с того же места', () => {
    const done = [];
    // Часы растут на 1 мс за обращение: бюджет 4 мс → примерно 4 шага за тик.
    const s = createScheduler((i) => done.push(i), { total: 40, budget: 4, now: fakeClock(1) });
    const first = s.tick();
    eq(first, false, 'за один тик сорок шагов не сделать');
    truthy(done.length >= 1 && done.length < 40, `за тик сделано ${done.length} шагов`);
    const after_first = done.length;
    s.tick();
    truthy(done.length > after_first, 'второй тик продолжил работу');
    eq(done[0], 0);
    eq(done[after_first], after_first, 'никаких пропусков и повторов');
});

test('createScheduler: докручивает до конца за несколько тиков', () => {
    let count = 0;
    const s = createScheduler(() => { count++; }, { total: 7, budget: 1, now: fakeClock(1) });
    let guard = 0;
    while (!s.tick() && guard++ < 100) { /* крутим тики */ }
    eq(count, 7);
    eq(s.progress(), 1);
});

test('createScheduler: прогресс растёт монотонно', () => {
    const s = createScheduler(() => {}, { total: 100, budget: 2, now: fakeClock(1) });
    let last = 0;
    for (let i = 0; i < 10; ++i) {
        s.tick();
        const p = s.progress();
        truthy(p >= last, `прогресс не падает: ${last} → ${p}`);
        last = p;
    }
});

test('createScheduler: исключение в работе отменяет задачу, а не роняет кадр', () => {
    const s = createScheduler((i) => { if (i === 2) throw new Error('бум'); },
                              { total: 10, budget: 1000, now: fakeClock(0.1) });
    const finished = s.tick();
    eq(finished, false, 'задача не считается выполненной');
    truthy(s.aborted, 'задача помечена отменённой');
    eq(s.index, 2, 'успели сделать два шага');
});

test('createScheduler: abort останавливает работу', () => {
    let count = 0;
    const s = createScheduler(() => { count++; }, { total: 10, budget: 1, now: fakeClock(1) });
    s.tick();
    const before = count;
    s.abort();
    s.tick();
    eq(count, before, 'после abort работа не продолжается');
});

test('createScheduler: total=0 сразу закончен', () => {
    const s = createScheduler(() => {}, { total: 0 });
    eq(s.tick(), true);
    eq(s.progress(), 1);
});

test('createScheduler: нулевой и отрицательный бюджет не вешают кадр', () => {
    const s = createScheduler(() => {}, { total: 5, budget: 0, now: fakeClock(1) });
    s.tick();
    truthy(!s.finished || s.index === 5, 'работа либо идёт, либо закончена');
    const neg = createScheduler(() => {}, { total: 5, budget: -10, now: fakeClock(1) });
    neg.tick();
    truthy(true, 'отрицательный бюджет не падает');
});

test('createGeneratorScheduler: генератор решает, когда закончил', () => {
    const seen = [];
    const s = createGeneratorScheduler(function* () {
        for (let i = 0; i < 6; ++i) { seen.push(i); yield; }
    }, { budget: 1000, now: fakeClock(0.1) });
    eq(s.tick(), true, 'генератор дошёл до конца');
    eq(seen.join(','), '0,1,2,3,4,5');
    eq(s.progress(), 1);
});

test('createGeneratorScheduler: уважает бюджет и продолжает', () => {
    const seen = [];
    const s = createGeneratorScheduler(function* () {
        for (let i = 0; i < 50; ++i) { seen.push(i); yield; }
    }, { budget: 2, now: fakeClock(1) });
    s.tick();
    truthy(seen.length > 0 && seen.length < 50, `за тик пройдено ${seen.length} шагов`);
    s.tick();
    truthy(seen.length > 0, 'второй тик продолжил');
    eq(seen[0], 0);
    eq(seen[1], 1, 'порядок сохранён');
});

test('createGeneratorScheduler: abort закрывает генератор', () => {
    let closed = false;
    const s = createGeneratorScheduler(function* () {
        try { while (true) yield; } finally { closed = true; }
    }, { budget: 1, now: fakeClock(1) });
    s.tick();
    s.abort();
    truthy(closed, 'finally генератора выполнился');
    eq(s.tick(), true);
});

// ---------------------------------------------------------------------------
// §5/§13: кадровый насос задач и одноразовый done
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

test('$.task: done вызывается ровно один раз после завершения', () => {
    const $t = {};
    installTask($t);
    let done = 0;
    let aborted = null;
    $t.task.chunked({
        total: 3, budget: 1000, step: () => {},
        done: (ab) => { done++; aborted = ab; },
    });
    eq(runningTasks(), 1, 'задача в работе');
    tickTask(1);
    eq(done, 1, 'done пришёл один раз');
    eq(aborted, false, 'done получил aborted = false');
    tickTask(1);
    tickTask(1);
    tickTask(1);
    eq(done, 1, 'повторные кадры не вызывают done снова');
    eq($t.task.running(), 0, 'задача снята с насоса');
});

test('$.task: abort зовёт done один раз с признаком отмены', () => {
    const $t = {};
    installTask($t);
    let done = 0;
    let aborted = null;
    const job = $t.task.chunked({
        total: 100, budget: 1, step: () => {},
        done: (ab) => { done++; aborted = ab; },
    });
    job.abort();
    eq(done, 1, 'отмена завершила задачу один раз');
    eq(aborted, true, 'признак отмены передан');
    tickTask(1);
    eq(done, 1, 'после отмены done не повторяется');
    eq($t.task.running(), 0);
});

test('$.task: закрытие scope отменяет задачу', () => {
    const $t = {};
    installTask($t);
    const scope = fakeScope('room:task');
    let done = 0;
    $t.task.chunked({ total: 100, budget: 1, scope, step: () => {}, done: () => { done++; } });
    eq(scope.count(), 1, 'задача привязана к области');
    scope.close('restart');
    eq(done, 1, 'scope отменил задачу и позвал done');
    eq($t.task.running(), 0);
    tickTask(1);
    eq(done, 1);
});

test('$.task: list наследует scope и done', () => {
    const $t = {};
    installTask($t);
    const scope = fakeScope('room:list');
    const seen = [];
    let done = 0;
    $t.task.list([10, 20, 30], (x) => { seen.push(x); }, {
        scope, done: () => { done++; }, budget: 1000,
    });
    tickTask(1);
    eq(seen.join(','), '10,20,30');
    eq(done, 1);
    eq(scope.count(), 1);
});

finish();
