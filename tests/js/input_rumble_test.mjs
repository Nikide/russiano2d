// ===========================================================================
// Юнит-тест виброотклика без движка (qjs): приведение аргумента
// $.input.rumble(...) к силам моторов.
//
// Сам SDL_RumbleGamepad проверяется только на живом геймпаде, поэтому здесь
// под проверкой ровно то, что можно проверить без железа: разбор аргумента,
// псевдонимы моторов, зажим значений и «стоп».
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/input_rumble_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { normalizeRumble } from '../../src/highlevel/input.js';

test('без аргумента — короткий импульс обеими силами', () => {
    const r = normalizeRumble();
    near(r.weak, 0.5);
    near(r.strong, 0.5);
    eq(r.duration, 250);
    eq(r.triggers, null);
});

test('0 и false — остановка вибрации', () => {
    for (const value of [0, false]) {
        const r = normalizeRumble(value);
        eq(r.weak, 0);
        eq(r.strong, 0);
        eq(r.duration, 0);
    }
});

test('число задаёт обе силы', () => {
    const r = normalizeRumble(0.75);
    near(r.weak, 0.75);
    near(r.strong, 0.75);
    eq(r.duration, 250);
});

test('weak/strong и псевдонимы high/low', () => {
    let r = normalizeRumble({ weak: 0.3, strong: 0.8, duration: 400 });
    near(r.weak, 0.3);
    near(r.strong, 0.8);
    eq(r.duration, 400);

    r = normalizeRumble({ high: 0.2, low: 0.9 });
    near(r.weak, 0.2);
    near(r.strong, 0.9);
});

test('силы зажимаются в 0..1, длительность — в разумные рамки', () => {
    let r = normalizeRumble({ weak: -1, strong: 5 });
    eq(r.weak, 0);
    eq(r.strong, 1);

    eq(normalizeRumble({ duration: -5 }).duration, 250, 'отрицательная — умолчание');
    eq(normalizeRumble({ duration: 999999 }).duration, 60000, 'слишком длинная — обрезана');
    eq(normalizeRumble({ duration: 0 }).duration, 0, 'ноль остаётся нулём');
    eq(normalizeRumble({ duration: 12.6 }).duration, 13, 'дробные миллисекунды округляются');
});

test('курки: triggers из двух значений, тоже с зажимом', () => {
    const r = normalizeRumble({ triggers: [0.5, 2] });
    eq(r.triggers.length, 2);
    near(r.triggers[0], 0.5);
    eq(r.triggers[1], 1);

    eq(normalizeRumble({}).triggers, null);
    eq(normalizeRumble({ triggers: 'оба' }).triggers, null, 'не массив — игнорируем');
});

test('пустой объект — умолчания, а не нули', () => {
    const r = normalizeRumble({});
    near(r.weak, 0.5);
    near(r.strong, 0.5);
    eq(r.duration, 250);
});

finish();
