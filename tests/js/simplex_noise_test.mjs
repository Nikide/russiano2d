// ===========================================================================
// Юнит-тест §43 (seeded simplex noise) и §26-части (состояние и потоки RNG).
//
// Главное доказательство — фикстуры:
//   tests/fixtures/generation_noise/reference_samples.json  — эталонные samples
//       симплекс-шума, hash сеток для двух пороговых профилей и регулярного
//       безшумового профиля, значения fBm;
//   tests/fixtures/generation_noise/legacy_rng_golden.json  — последовательности
//       $.random и value noise, зафиксированные ДО правки: старая случайность
//       не должна сдвинуться ни на одно значение.
//
//   build/_deps/quickjs-build/qjs tests/js/simplex_noise_test.mjs
// ===========================================================================

import * as std from 'qjs:std';
import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { makeRandom } from '../../src/highlevel/core.js';
import {
    makeGenerator, shuffle, gaussian,
    hash01, noise1D, noise2D,
    mulberry32Step, streamSeed, RNG_ALGORITHM, STATE_VERSION, STREAM_NAMES,
    createNoise, simplex2D, hashCells, noiseAlgorithms, noiseAlgorithmInfo,
    validateStateSnapshot,
} from '../../src/highlevel/random.js';

const FIXTURES = 'tests/fixtures/generation_noise/';
const reference = JSON.parse(std.loadFile(FIXTURES + 'reference_samples.json'));
const legacy = JSON.parse(std.loadFile(FIXTURES + 'legacy_rng_golden.json'));

function jsonEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// --- Совместимость: старая случайность и value noise не сдвинулись ----------

test('legacy $.random: последовательности next/int/range/gaussian совпадают с фикстурой', () => {
    const r8 = makeGenerator(12345);
    eq(jsonEqual(Array.from({ length: 8 }, () => r8.next()), legacy.next_12345), true, 'next(12345)');
    const r42 = makeGenerator(42);
    eq(jsonEqual(Array.from({ length: 8 }, () => r42.next()), legacy.next_42), true, 'next(42)');
    const ri = makeGenerator(12345);
    eq(jsonEqual(Array.from({ length: 8 }, () => ri.int(1, 6)), legacy.int_12345), true, 'int(1,6)');
    const rr = makeGenerator(42);
    eq(jsonEqual(Array.from({ length: 6 }, () => rr.range(-1, 1)), legacy.range_42), true, 'range(-1,1)');
    const rg = makeGenerator(7);
    eq(jsonEqual(Array.from({ length: 4 }, () => gaussian(rg)), legacy.gaussian_7), true, 'gaussian');
});

test('legacy $.random: shuffle/weighted и hash01 совпадают с фикстурой', () => {
    eq(jsonEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8], makeGenerator(12345)), legacy.shuffle_12345), true);
    const rw = makeGenerator(12345);
    const list = [{ value: 'a', weight: 1 }, { value: 'b', weight: 2 }, { value: 'c', weight: 3 }];
    eq(jsonEqual(Array.from({ length: 12 }, () => rw.weighted(list)), legacy.weighted_12345), true);
    eq(jsonEqual([-7, 0, 1, 2, 999999].map((n) => hash01(n)), legacy.hash01), true);
});

test('legacy value noise: noise1D/noise2D не изменились', () => {
    eq(jsonEqual([0, 0.5, 3.25, -7.5, 100.125].map((x) => noise1D(x)), legacy.noise1D), true);
    eq(jsonEqual([3.25, 3.25].map((x, i) => noise1D(x, 42 + i)), legacy.noise1D_seed), true);
    eq(jsonEqual([[0, 0], [1.5, 1.5], [-3.25, 7.5], [100.125, -0.25]]
        .map(([x, y]) => noise2D(x, y)), legacy.noise2D), true);
    eq(noise2D(1.5, 1.5, 42), legacy.noise2D_seed42);
});

// --- mulberry32Step: точное совпадение с ядром ------------------------------

test('mulberry32Step побитово повторяет переход makeRandom ядра', () => {
    for (const seed of [1, 42, 12345, 0xffffffff, 0x9e3779b9]) {
        const core = makeRandom(seed);
        let state = seed >>> 0;
        for (let i = 0; i < 1000; i++) {
            const step = mulberry32Step(state);
            state = step.state;
            eq(step.value, core.next(), 'seed ' + seed + ', шаг ' + i);
        }
    }
});

// --- Метаданные алгоритма ---------------------------------------------------

test('algorithms(): value2d и simplex2d с версией 1 и диапазоном [0,1]', () => {
    const list = noiseAlgorithms();
    const names = list.map((a) => a.name).sort().join(',');
    eq(names, 'simplex2d,value2d');
    for (const info of list) {
        eq(info.version, 1, info.name + ': версия');
        eq(info.range[0], 0, info.name + ': нижняя граница');
        eq(info.range[1], 1, info.name + ': верхняя граница');
        truthy(typeof info.seedMapping === 'string' && info.seedMapping.length > 0,
            info.name + ': seed mapping описан');
        truthy(typeof info.family === 'string' && info.family.length > 0,
            info.name + ': семейство описано');
    }
    eq(noiseAlgorithmInfo('simplex2d').version, 1);
    eq(noiseAlgorithmInfo('нет-такого'), null);
});

// --- Эталонные samples ------------------------------------------------------

test('эталонные samples симплекс-шума совпадают с фикстурой', () => {
    eq(reference.samples.length > 0, true, 'фикстура не пуста');
    for (const s of reference.samples) {
        const value = simplex2D(s.x, s.y, { seed: s.seed, frequency: s.frequency });
        near(value, s.value, 1e-12,
            'simplex2D(' + s.x + ',' + s.y + ', seed=' + s.seed + ', f=' + s.frequency + ')');
    }
});

test('симплекс-шум — чистая функция координаты и параметров', () => {
    const a = simplex2D(12.5, -3.25, { seed: 7, frequency: 0.5 });
    const rng = makeGenerator(999);
    for (let i = 0; i < 500; i++) rng.next();
    rng.seed(1);
    eq(simplex2D(12.5, -3.25, { seed: 7, frequency: 0.5 }), a,
        'состояние $.random не влияет на шум');
    eq(simplex2D(12.5, -3.25, { seed: 7, frequency: 0.5 }), a, 'повторный вызов');
});

test('симплекс-шум укладывается в [0, 1]', () => {
    let min = 1;
    let max = 0;
    for (let y = -40; y <= 40; y += 0.37) {
        for (let x = -40; x <= 40; x += 0.37) {
            const v = simplex2D(x, y, { seed: 7, frequency: 1 });
            truthy(Number.isFinite(v), 'конечное значение');
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    truthy(min >= 0 && max <= 1, 'диапазон: [' + min + ', ' + max + ']');
    truthy(reference.measuredRaw.min >= -1 && reference.measuredRaw.max <= 1,
        'сырой диапазон внутри [-1, 1]');
    truthy(reference.measuredRaw.probes > 100000, 'фикстура замеряла диапазон массово');
});

test('seed и frequency меняют значение предсказуемо', () => {
    truthy(simplex2D(3.5, 4.5, { seed: 1 }) !== simplex2D(3.5, 4.5, { seed: 2 }),
        'разные seed — разная таблица перестановок');
    const nod = createNoise({ algorithm: 'simplex2d', seed: 7, frequency: 0.25 });
    near(nod.sample2D(16, 8), simplex2D(4, 2, { seed: 7, frequency: 1 }), 1e-12,
        'frequency умножает координаты');
    near(createNoise({ algorithm: 'simplex2d', seed: 7, frequency: 2 }).sample2D(2, 3),
        simplex2D(4, 6, { seed: 7, frequency: 1 }), 1e-12, 'frequency = 2');
    near(nod.sample1D(16), nod.sample2D(16, 0), 1e-12, 'sample1D — срез y=0');
    const seeded = createNoise({ algorithm: 'value2d', seed: 42, frequency: 1 });
    near(seeded.sample2D(2.5, -3.5), noise2D(2.5, -3.5, 42), 1e-12,
        'алгоритм value2d совпадает с legacy noise2D');
});

test('неизвестные алгоритм/версия/frequency отклоняются с понятной ошибкой', () => {
    const cases = [
        () => createNoise({ algorithm: 'нет-такого' }),
        () => createNoise({ algorithm: 'simplex2d', version: 2 }),
        () => createNoise({ algorithm: 'simplex2d', frequency: 0 }),
        () => createNoise({ algorithm: 'simplex2d', frequency: -1 }),
        () => createNoise({ algorithm: 'simplex2d', frequency: Infinity }),
        () => simplex2D(0, 0, { algorithm: 'value2d' }),
    ];
    for (const fn of cases) {
        let message = '';
        try { fn(); } catch (error) { message = String(error && error.message); }
        truthy(message.indexOf('$.random') === 0, 'ожидалась ошибка $.random, получено: ' + message);
    }
});

// --- Сеточный hash (§43/§24) ------------------------------------------------

test('hash сетки совпадает с фикстурой для пороговых и регулярного профилей', () => {
    for (const key of ['A', 'B', 'regular']) {
        const expected = reference.grids[key];
        const cells = [];
        const source = expected.profile.noise
            ? createNoise({
                algorithm: 'simplex2d',
                seed: expected.profile.seed,
                frequency: expected.profile.frequency,
            })
            : null;
        let solid = 0;
        for (let y = 0; y < expected.rows; y++) {
            const row = [];
            for (let x = 0; x < expected.cols; x++) {
                const solidCell = source
                    ? (source.sample2D(x, y) > expected.profile.threshold ? 1 : 0)
                    : ((y % 5 === 0 || x % 11 === 0) ? 1 : 0);
                row.push(solidCell);
                solid += solidCell;
            }
            cells.push(row);
        }
        eq(jsonEqual(cells, expected.cells), true, key + ': клетки');
        eq(solid, expected.solidCount, key + ': число твёрдых клеток');
        eq(hashCells(cells), expected.hash, key + ': hash');
    }
    truthy(reference.grids.A.hash !== reference.grids.B.hash, 'пороговые профили различаются');
    truthy(reference.grids.A.hash !== reference.grids.regular.hash, 'безшумовой профиль отличается');
});

test('hashCells: стабильность, чувствительность к порядку и типам', () => {
    const grid = [[1, 0], [0, 1]];
    eq(hashCells(grid), hashCells([[1, 0], [0, 1]]), 'тот же вход — тот же hash');
    truthy(hashCells(grid) !== hashCells([[0, 1], [1, 0]]), 'порядок важен');
    eq(typeof hashCells(grid), 'string');
    eq(hashCells(grid).length, 8, '8 hex-символов');
    truthy(hashCells([1, 2]) !== hashCells([12]), 'разделитель не даёт склеек');
    truthy(hashCells([true, false]) !== hashCells([1, 0]), 'булевы не равны числам');
    truthy(hashCells([1]) !== hashCells(['1']), 'число и строка не равны');
    truthy(hashCells(['a', 'b']) !== hashCells(['ab']), 'строки разделены');
    eq(hashCells([]), hashCells([]), 'пустой вход стабилен');
});

// --- fBm (optional) ---------------------------------------------------------

test('fbm2D совпадает с фикстурой и остаётся в [0, 1]', () => {
    const source = createNoise({ algorithm: 'simplex2d', seed: 7, frequency: 0.125 });
    for (const entry of reference.fbm.values) {
        near(source.fbm2D(entry.x, entry.y, { octaves: entry.octaves }), entry.value, 1e-12,
            'fbm(' + entry.x + ',' + entry.y + ')');
    }
    near(source.fbm2D(3, 4, { octaves: 1 }), source.sample2D(3, 4), 1e-12,
        'одна октава = обычный sample2D');
    for (let i = 0; i < 200; i++) {
        const v = source.fbm2D(i * 1.7, -i * 0.9, { octaves: 6 });
        truthy(v >= 0 && v <= 1, 'fbm вне [0,1]: ' + v);
    }
    eq(source.fbm2D(5, 6, { octaves: 4 }), source.fbm2D(5, 6, { octaves: 4 }), 'детерминизм');
    let bad = '';
    try { source.fbm2D(0, 0, { gain: 0 }); } catch (error) { bad = String(error.message); }
    truthy(bad.indexOf('gain') >= 0, 'gain <= 0 отклоняется');
    bad = '';
    try { source.fbm2D(0, 0, { lacunarity: 0.5 }); } catch (error) { bad = String(error.message); }
    truthy(bad.indexOf('lacunarity') >= 0, 'lacunarity < 1 отклоняется');
});

// --- §26: именованные потоки ------------------------------------------------

test('потоки изолированы: presentation не меняет generation и default', () => {
    const a = makeGenerator(7);
    const genA = a.stream('generation');
    const firstA = [genA.next(), genA.next(), genA.next()];
    const defaultA = [a.next(), a.next()];

    const b = makeGenerator(7);
    const presB = b.stream('presentation');
    for (let i = 0; i < 1000; i++) presB.next();
    const genB = b.stream('generation');
    const firstB = [genB.next(), genB.next(), genB.next()];
    const defaultB = [b.next(), b.next()];

    eq(jsonEqual(firstA, firstB), true, 'generation не съеден косметикой');
    eq(jsonEqual(defaultA, defaultB), true, 'default не съеден косметикой');
    truthy(jsonEqual(firstA, defaultA) === false, 'поток и default — разные последовательности');

    const c = makeGenerator(7);
    const gameplay = c.stream('gameplay');
    const gameplayHead = [gameplay.next(), gameplay.next()];
    const d = makeGenerator(7);
    const gameplayAgain = d.stream('gameplay');
    eq(jsonEqual([gameplayAgain.next(), gameplayAgain.next()], gameplayHead), true,
        'gameplay детерминирован от seed');
    truthy(streamSeed(7, 'gameplay') !== streamSeed(7, 'generation'),
        'generation и gameplay — разные потоки');
    truthy(c.stream('presentation').next() !== c.stream('gameplay').next(),
        'разные имена — разные потоки');
    eq(c.streamNames().sort().join(','), 'gameplay,presentation', 'созданы ровно два потока');
});

test('streamSeed: имя и базовое зерно определяют поток', () => {
    eq(streamSeed(7, 'gameplay'), streamSeed(7, 'gameplay'));
    truthy(streamSeed(7, 'gameplay') !== streamSeed(8, 'gameplay'), 'зерно влияет');
    truthy(streamSeed(7, 'gameplay') !== streamSeed(7, 'presentation'), 'имя влияет');
    const a = makeGenerator(streamSeed(7, 'gameplay'));
    const b = makeGenerator(7).stream('gameplay');
    eq(jsonEqual([a.next(), a.next(), a.next()], [b.next(), b.next(), b.next()]), true,
        'поток — это генератор с зерном streamSeed');
});

test('seed(n) разворачивает и default, и уже созданные потоки', () => {
    const rng = makeGenerator(7);
    const gen = rng.stream('generation');
    const head = [gen.next(), gen.next()];
    gen.next();                                   // «середина сессии»
    const defaultHead = [rng.next(), rng.next()];

    rng.seed(7);
    eq(jsonEqual([gen.next(), gen.next()], head), true, 'поток вернулся к началу seed(7)');
    eq(jsonEqual([rng.next(), rng.next()], defaultHead), true, 'default вернулся к началу');

    rng.seed(9);
    truthy(jsonEqual([gen.next(), gen.next()], head) === false, 'другое зерно — другой поток');
    eq(rng.seed(), 9, 'seed() возвращает текущее зерно');
    eq(rng.streamNames().join(','), 'generation', 'поток не потерялся');
});

test('STREAM_NAMES перечисляет штатные потоки', () => {
    eq(STREAM_NAMES.join(','), 'gameplay,generation,presentation');
});

// --- §26: снимок состояния --------------------------------------------------

test('state/restore продолжают последовательность с середины (default)', () => {
    const a = makeGenerator(4242);
    for (let i = 0; i < 37; i++) a.next();
    const snapshot = a.state();
    eq(snapshot.version, STATE_VERSION);
    eq(snapshot.algorithm, RNG_ALGORITHM);
    const expected = [a.next(), a.next(), a.next(), a.next(), a.next()];

    const b = makeGenerator(1);
    for (let i = 0; i < 5; i++) b.next();
    b.restore(JSON.parse(JSON.stringify(snapshot)));
    eq(jsonEqual([b.next(), b.next(), b.next(), b.next(), b.next()], expected), true,
        'после restore последовательность продолжается, а не начинается заново');

    const c = makeGenerator(4242);
    const same = [c.next(), c.next(), c.next(), c.next(), c.next()];
    truthy(jsonEqual(same, expected) === false, 'снимок — это середина, а не начало');
});

test('state/restore восстанавливает и потоки (JSON round-trip)', () => {
    const a = makeGenerator(2024);
    a.next();
    const gen = a.stream('generation');
    const pres = a.stream('presentation');
    for (let i = 0; i < 11; i++) gen.next();
    for (let i = 0; i < 3; i++) pres.next();
    const snapshot = JSON.parse(JSON.stringify(a.state()));
    eq(snapshot.streams.generation.value >= 0, true, 'состояние потока в снимке');
    const expected = {
        next: [a.next(), a.next()],
        gen: [gen.next(), gen.next()],
        pres: [pres.next(), pres.next()],
    };

    const b = makeGenerator(9);
    b.restore(snapshot);
    eq(jsonEqual([b.next(), b.next()], expected.next), true, 'default продолжен');
    eq(jsonEqual([b.stream('generation').next(), b.stream('generation').next()], expected.gen), true,
        'поток generation продолжен');
    eq(jsonEqual([b.stream('presentation').next(), b.stream('presentation').next()], expected.pres), true,
        'поток presentation продолжен');
});

test('восстановление состояния 0 (seed ядра подменяет ноль) продолжает поток точно', () => {
    const rng = makeGenerator(5);
    rng.restore({ version: STATE_VERSION, algorithm: RNG_ALGORITHM, seed: 0, value: 0 });
    let state = 0;
    for (let i = 0; i < 50; i++) {
        const step = mulberry32Step(state);
        state = step.state;
        eq(rng.next(), step.value, 'шаг ' + i);
    }
    const snapshot = rng.state();
    eq(snapshot.value, state, 'снимок показывает точное состояние');
});

test('испорченный или чужой снимок отклоняется понятной ошибкой', () => {
    const bad = [
        null,
        'строка',
        [],
        { version: 2, algorithm: RNG_ALGORITHM, seed: 1, value: 1 },
        { version: STATE_VERSION, algorithm: 'xorshift', seed: 1, value: 1 },
        { version: STATE_VERSION, algorithm: RNG_ALGORITHM, seed: -1, value: 1 },
        { version: STATE_VERSION, algorithm: RNG_ALGORITHM, seed: 1, value: 1.5 },
        { version: STATE_VERSION, algorithm: RNG_ALGORITHM, seed: 1, value: 1, streams: [] },
        { version: STATE_VERSION, algorithm: RNG_ALGORITHM, seed: 1, value: 1, streams: { a: { seed: 1 } } },
    ];
    for (const snapshot of bad) {
        const reason = validateStateSnapshot(snapshot);
        truthy(typeof reason === 'string' && reason.length > 0,
            'validateState должен назвать причину для ' + JSON.stringify(snapshot));
        let thrown = '';
        try { makeGenerator(1).restore(snapshot); } catch (error) { thrown = String(error.message); }
        truthy(thrown.indexOf('$.random.restore:') === 0, 'restore бросает: ' + thrown);
    }
    const good = { version: STATE_VERSION, algorithm: RNG_ALGORITHM, seed: 7, value: 7 };
    eq(validateStateSnapshot(good), true, 'корректный снимок принимается');
    falsy(validateStateSnapshot({ ...good, streams: {} }) !== true, 'пустые потоки — тоже валидны');
});

finish();
