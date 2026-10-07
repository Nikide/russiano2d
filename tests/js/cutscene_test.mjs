// ===========================================================================
// Юнит-тесты ядра катсцен (src/highlevel/cutscene.js) без движка.
//
// Проверяем разбор сценария: нормализация шагов (ms/wait), длительность,
// разбор точек, флаг skip. Сам режиссёр (ввод, узлы, камера) проверяется в
// движке — tests/agent/highlevel_cutscene_test.py.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/cutscene_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { normalizeSteps, stepsDuration, pointOf } from '../../src/highlevel/cutscene.js';

test('normalizeSteps: ms и wait дают длительность', () => {
    const steps = normalizeSteps([
        { take: 'input' },              // мгновенный
        { wait: 300 },
        { camera: { at: [1, 2] }, ms: 600 },
        { wait: 100, ms: 50 },          // берём большее
    ]);
    eq(steps.length, 4, 'все шаги на месте');
    eq(steps[0].ms, 0, 'мгновенный шаг без времени');
    eq(steps[1].ms, 300, 'wait задаёт длительность');
    eq(steps[2].ms, 600, 'ms задаёт длительность');
    eq(steps[3].ms, 100, 'wait важнее меньшего ms');
});

test('normalizeSteps: мусор в ms не ломает шаг', () => {
    const steps = normalizeSteps([
        { ms: 'чушь' }, { ms: -50 }, { ms: NaN }, { wait: 'ещё чушь' },
    ]);
    eq(steps.map((s) => s.ms).join(','), '0,0,0,0', 'нечисла становятся нулём');
    eq(normalizeSteps(null).length, 0, 'null — пусто');
    eq(normalizeSteps([null, 'строка', 5]).length, 0, 'не-объекты пропускаются');
});

test('normalizeSteps: skip только по явному true', () => {
    const steps = normalizeSteps([{ skip: true }, { skip: 1 }, { skip: 'да' }, {}]);
    eq(steps[0].skip, true, 'явное true');
    eq(steps[1].skip, false, 'единица — не true');
    eq(steps[2].skip, false, 'строка — не true');
    eq(steps[3].skip, false, 'по умолчанию false');
});

test('normalizeSteps не меняет исходные шаги', () => {
    const source = [{ wait: 100 }];
    const out = normalizeSteps(source);
    eq(source[0].ms, undefined, 'исходный шаг не тронут');
    eq(out[0].ms, 100, 'а копия нормализована');
    out[0].ms = 999;
    eq(source[0].ms, undefined, 'и это именно копия');
});

test('stepsDuration: сумма только длинных шагов', () => {
    eq(stepsDuration([{ wait: 100 }, { take: 1 }, { wait: 250 }]), 350);
    eq(stepsDuration([]), 0);
    eq(stepsDuration(null), 0);
});

test('pointOf: массив, объект, узел и мусор', () => {
    eq(JSON.stringify(pointOf([10, 20])), '{"x":10,"y":20}', 'пара чисел');
    eq(JSON.stringify(pointOf({ x: 5, y: 6 })), '{"x":5,"y":6}', 'объект');
    eq(JSON.stringify(pointOf({ tag: 'npc', x: 7, y: 8 })), '{"x":7,"y":8}', 'узел');
    eq(pointOf(null), null, 'пусто');
    eq(pointOf('строка'), null, 'строка — не точка');
});

test('pointOf: нечисла становятся нулём', () => {
    eq(JSON.stringify(pointOf(['а', undefined])), '{"x":0,"y":0}');
});

finish();
