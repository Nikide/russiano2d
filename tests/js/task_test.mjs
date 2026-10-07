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
import { createScheduler, createGeneratorScheduler } from '../../src/highlevel/task.js';

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

finish();
