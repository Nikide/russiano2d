// ===========================================================================
// Юнит-тест $.random — детерминированный ГПСЧ с зерном.
//
// Главное, что здесь проверяется: одна и та же последовательность вызовов
// после seed(n) даёт одни и те же числа (иначе ломаются тесты и --fixed-dt).
//
//   build/_deps/quickjs-build/qjs tests/js/random_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    makeGenerator, shuffle, gaussian, weightedPick, hash01, noise1D, noise2D,
    installRandom,
} from '../../src/highlevel/random.js';

/** Первые n чисел последовательности — для сравнения «один seed → одна серия». */
function series(rng, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rng.next());
    return out.join(',');
}

// --- Детерминизм -----------------------------------------------------------

test('один seed даёт одну и ту же последовательность', () => {
    eq(series(makeGenerator(42), 6), series(makeGenerator(42), 6));
    eq(series(makeGenerator(1), 4), series(makeGenerator(1), 4));
});

test('разные seedы дают разные последовательности', () => {
    truthy(series(makeGenerator(1), 6) !== series(makeGenerator(2), 6));
});

test('seed(n) перезапускает последовательность с начала', () => {
    const rng = makeGenerator(7);
    const first = series(rng, 5);
    series(rng, 13);                      // «прокрутили» состояние
    rng.seed(7);
    eq(series(rng, 5), first);
});

test('seed() без аргумента возвращает текущее зерно', () => {
    const rng = makeGenerator(99);
    eq(rng.seed(), 99);
    rng.seed(3);
    eq(rng.seed(), 3);
    truthy(rng.seed(4) === rng, 'seed(n) возвращает генератор для цепочки');
});

test('next() всегда в [0, 1)', () => {
    const rng = makeGenerator(2024);
    for (let i = 0; i < 2000; i++) {
        const v = rng.next();
        truthy(v >= 0 && v < 1, 'next() вне диапазона: ' + v);
    }
});

test('range(a, b) не выходит за границы, в том числе при a > b', () => {
    const rng = makeGenerator(5);
    for (let i = 0; i < 500; i++) {
        const v = rng.range(-10, 10);
        truthy(v >= -10 && v < 10, 'range() вне диапазона: ' + v);
    }
    for (let i = 0; i < 200; i++) {
        const v = rng.range(10, -10);
        truthy(v <= 10 && v > -10, 'range() с перевёрнутыми границами: ' + v);
    }
});

test('int(a, b) включает обе границы', () => {
    const rng = makeGenerator(11);
    let min = 99;
    let max = -99;
    for (let i = 0; i < 3000; i++) {
        const v = rng.int(1, 6);
        truthy(Number.isInteger(v), 'int() вернул не целое: ' + v);
        if (v < min) min = v;
        if (v > max) max = v;
    }
    eq(min, 1);
    eq(max, 6);
});

test('int(a, a) — нулевой диапазон, всегда a', () => {
    const rng = makeGenerator(3);
    eq(rng.int(4, 4), 4);
    eq(rng.int(0, 0), 0);
});

test('pick берёт элемент из списка, пустой список — undefined', () => {
    const rng = makeGenerator(17);
    const list = ['a', 'b', 'c'];
    const seen = {};
    for (let i = 0; i < 300; i++) seen[rng.pick(list)] = true;
    eq(Object.keys(seen).sort().join(','), 'a,b,c');
    eq(rng.pick([]), undefined);
});

test('chance(0) никогда не срабатывает, chance(1) — всегда', () => {
    const rng = makeGenerator(23);
    for (let i = 0; i < 300; i++) {
        falsy(rng.chance(0));
        truthy(rng.chance(1));
    }
});

// --- shuffle / gaussian / weighted ----------------------------------------

test('shuffle переставляет элементы, не теряя и не добавляя их', () => {
    const rng = makeGenerator(31);
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(src, rng);
    eq(out.length, src.length);
    eq(out.slice().sort((a, b) => a - b).join(','), '1,2,3,4,5,6,7,8');
    eq(src.join(','), '1,2,3,4,5,6,7,8', 'исходный массив не изменён');
});

test('shuffle детерминирован при одном seed', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], makeGenerator(123));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], makeGenerator(123));
    eq(a.join(','), b.join(','));
    truthy(a.join(',') !== '1,2,3,4,5,6,7,8,9,10', 'порядок действительно перемешан');
});

test('gaussian: среднее около нуля, отклонение около единицы', () => {
    const rng = makeGenerator(777);
    let sum = 0;
    let sum2 = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
        const v = gaussian(rng);
        truthy(isFinite(v), 'gaussian() вернул не число: ' + v);
        sum += v;
        sum2 += v * v;
    }
    const mean = sum / n;
    const std = Math.sqrt(sum2 / n - mean * mean);
    truthy(Math.abs(mean) < 0.15, 'среднее уехало: ' + mean);
    truthy(std > 0.8 && std < 1.2, 'отклонение не похоже на 1: ' + std);
});

test('weighted возвращает только значения из списка', () => {
    const rng = makeGenerator(41);
    const list = [{ value: 'меч', weight: 1 }, { value: 'щит', weight: 2 }];
    for (let i = 0; i < 300; i++) {
        const v = rng.weighted(list);
        truthy(v === 'меч' || v === 'щит', 'чужое значение: ' + v);
    }
});

test('weighted учитывает веса', () => {
    const rng = makeGenerator(43);
    const list = [{ value: 'редкий', weight: 1 }, { value: 'частый', weight: 9 }];
    let rare = 0;
    for (let i = 0; i < 2000; i++) if (rng.weighted(list) === 'редкий') rare++;
    truthy(rare > 100 && rare < 400, 'доля редкого предмета не похожа на 10%: ' + rare);
});

test('weighted понимает пары, короткую запись и обычные значения', () => {
    const rng = makeGenerator(47);
    const pairs = [['a', 3], ['b', 1]];
    const short = [{ v: 'a', w: 3 }, { v: 'b', w: 1 }];
    const plain = ['a', 'b'];
    const seen = {};
    for (let i = 0; i < 400; i++) {
        seen[weightedPick(pairs, rng)] = true;
        seen[weightedPick(short, rng)] = true;
        seen[weightedPick(plain, rng)] = true;
    }
    eq(Object.keys(seen).sort().join(','), 'a,b');
});

test('weighted с нулевыми весами не делит на ноль и даёт равномерный выбор', () => {
    const rng = makeGenerator(53);
    const seen = {};
    for (let i = 0; i < 200; i++) {
        const v = rng.weighted([{ value: 'a', weight: 0 }, { value: 'b', weight: -5 }]);
        truthy(v === 'a' || v === 'b', 'чужое значение: ' + v);
        seen[v] = true;
    }
    eq(Object.keys(seen).sort().join(','), 'a,b');
    eq(rng.weighted([]), undefined, 'пустой список — undefined');
});

// --- Шум -------------------------------------------------------------------

test('hash01 — детерминированный хеш в [0, 1)', () => {
    eq(hash01(12345), hash01(12345));
    truthy(hash01(1) !== hash01(2), 'соседние ключи не должны совпадать');
    for (const n of [-7, 0, 1, 999999]) {
        const v = hash01(n);
        truthy(v >= 0 && v < 1, 'hash01 вне диапазона: ' + v);
    }
});

test('noise1D: диапазон, повторяемость и гладкость', () => {
    for (let i = 0; i < 200; i++) {
        const v = noise1D(i * 0.37);
        truthy(v >= 0 && v < 1, 'noise1D вне диапазона: ' + v);
    }
    eq(noise1D(3.25), noise1D(3.25));
    const d = Math.abs(noise1D(5.0) - noise1D(5.01));
    truthy(d < 0.1, 'шум рвётся на мелком шаге: ' + d);
    truthy(noise1D(5) !== noise1D(5.5), 'шум не меняется между узлами решётки');
});

test('noise1D не зависит от состояния $.random', () => {
    const rng = makeGenerator(1);
    const before = noise1D(12.5);
    for (let i = 0; i < 100; i++) rng.next();
    rng.seed(999);
    eq(noise1D(12.5), before, 'шум — чистая функция координаты, а не ГПСЧ');
});

test('noise2D: диапазон, повторяемость и отличие точек', () => {
    for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 20; x++) {
            const v = noise2D(x * 0.5, y * 0.5);
            truthy(v >= 0 && v < 1, 'noise2D вне диапазона: ' + v);
        }
    }
    eq(noise2D(2.5, -3.5), noise2D(2.5, -3.5));
    truthy(noise2D(0, 0) !== noise2D(0, 5), 'разные точки — разные значения');
    const near1 = Math.abs(noise2D(4, 4) - noise2D(4.01, 4));
    truthy(near1 < 0.1, 'шум рвётся на мелком шаге: ' + near1);
    eq(noise2D(1.5, 1.5, 42), noise2D(1.5, 1.5, 42), 'смещение решётки детерминировано');
    truthy(noise2D(1.5, 1.5, 42) !== noise2D(1.5, 1.5, 43), 'разные seedы — разные решётки');
});

// --- Установка -------------------------------------------------------------

test('installRandom берёт зерно из engine.seed и даёт прежние методы', () => {
    const $ = {};
    const random = installRandom($);
    truthy($.random === random, '$.random установлено');
    eq($.random.seed(), engine.seed, 'зерно совпадает с engine.seed');
    truthy(typeof $.random.range === 'function');
    truthy(typeof $.random.int === 'function');
    truthy(typeof $.random.pick === 'function');
    truthy(typeof $.random.chance === 'function');
    truthy(typeof $.random.shuffle === 'function');
    truthy(typeof $.random.gaussian === 'function');
    truthy(typeof $.random.weighted === 'function');
    truthy(typeof $.random.noise1D === 'function');
    truthy(typeof $.random.noise2D === 'function');
});

test('два независимых $.random-генератора не влияют друг на друга', () => {
    const a = makeGenerator(1000);
    const b = makeGenerator(1000);
    a.next();
    a.next();
    near(b.next(), makeGenerator(1000).next());
});

finish();
