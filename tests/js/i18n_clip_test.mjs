// ===========================================================================
// Юнит-тесты клипов (вариантов) перевода: src/highlevel/i18n.js.
//
// Клип — это список вариантов одного ключа: короткая подпись на кнопке и
// длинная фраза в диалоге, три варианта приветствия NPC, разные реплики для
// озвучки. Проверяем выбор варианта по номеру и по зерну, стабильность зерна и
// что клипы не сломали плюрализацию (у неё тоже массив).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/i18n_clip_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { clipIndex, clipsOf, pluralIndex, format } from '../../src/highlevel/i18n.js';

test('clipIndex: номер варианта берётся как есть', () => {
    eq(clipIndex(0, 3), 0, 'первый');
    eq(clipIndex(1, 3), 1, 'второй');
    eq(clipIndex(2, 3), 2, 'третий');
    eq(clipIndex(5, 3), 2, 'номер за пределами даёт последний');
    eq(clipIndex(0, 1), 0, 'единственный вариант всегда первый');
});

test('clipIndex: зерно стабильно и не соседствует', () => {
    const first = clipIndex(7, 3);
    eq(clipIndex(7, 3), first, 'одно зерно — один вариант');
    eq(clipIndex(7.9, 3), clipIndex(7, 3), 'дробное зерно — то же, что целое');
    // Числа 0..n-1 — это НОМЕР варианта (см. первый тест), поэтому зерно
    // проверяем на больших значениях: там работает перемешивание, и все
    // варианты должны быть достижимы.
    const picks = [];
    for (let seed = 100; seed < 130; ++seed) picks.push(clipIndex(seed, 3));
    const distinct = new Set(picks).size;
    eq(distinct, 3, `все три варианта достижимы (получили ${distinct})`);
    // И зерно не «идёт по кругу»: у соседних зёрен варианты разные.
    let same_neighbours = 0;
    for (let i = 1; i < picks.length; ++i) if (picks[i] === picks[i - 1]) same_neighbours++;
    truthy(same_neighbours < picks.length - 1,
           `соседние зёрна дают разные варианты (совпало ${same_neighbours} из ${picks.length - 1})`);
});

test('clipIndex: мусор не ломает выбор', () => {
    eq(clipIndex(undefined, 3), 0, 'пусто — первый');
    eq(clipIndex('чушь', 3), 0, 'строка — первый');
    eq(clipIndex(-5, 3), clipIndex(-5, 3), 'отрицательное зерно стабильно');
    eq(clipIndex(3, 0), 0, 'ноль вариантов — ноль');
});

test('clipsOf: массив, объект с clip и не-клипы', () => {
    eq(clipsOf(['a', 'b']).length, 2, 'массив — клипы');
    eq(clipsOf({ clip: ['a', 'b'] }).length, 2, 'объект с clip — клипы');
    eq(clipsOf([]), null, 'пустой массив — не клипы');
    eq(clipsOf({ plural: ['a'] }), null, 'только формы — не клипы');
    eq(clipsOf('строка'), null, 'строка — не клипы');
    eq(clipsOf(null), null, 'null — не клипы');
});

test('плюрализация по-прежнему работает (клипы её не сломали)', () => {
    eq(pluralIndex(1, 'ru'), 0, 'одна штука');
    eq(pluralIndex(3, 'ru'), 1, 'три штуки');
    eq(pluralIndex(11, 'ru'), 2, 'одиннадцать штук');
    eq(pluralIndex(1, 'en'), 0, 'английский: одна');
    eq(pluralIndex(2, 'en'), 1, 'английский: много');
    eq(format('{a}+{b}', { a: 1, b: 2 }), '1+2', 'подстановка как была');
});

finish();
