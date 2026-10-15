// Генерация tests/fixtures/generation_noise/reference_samples.json.
//
// Два независимых прохода, один источник правил:
//   1) эталонные samples/сетки симплекс-шума считаются прямо по random.js;
//   2) раздел generation получается ПРОГОНОМ САМОЙ ФИКСТУРЫ
//      (tests/fixtures/generation_noise/main.js) в qjs с моком `$` и
//      синхронным $.task — без движка.
// Агентский тест затем требует от движка те же hash: расхождение значит, что
// встроенная копия JS или правила разошлись.
//
// Обновление фикстуры (из корня репозитория):
//   build/_deps/quickjs-build/qjs tests/fixtures/generation_noise/gen_reference.mjs \
//       > tests/fixtures/generation_noise/reference_samples.json
//
// Перед записью скрипт сверяет legacy_rng_golden.json: если старые
// последовательности $.random/value noise сдвинулись, он падает с кодом 2.

import * as std from 'qjs:std';
import '../../../tests/js/_harness.mjs';
import { installGrid } from '../../../src/highlevel/grid.js';
import { installRandom } from '../../../src/highlevel/random.js';
import {
    makeGenerator, noise1D, noise2D, hash01, createNoise, simplex2D, hashCells,
} from '../../../src/highlevel/random.js';

const DIR = 'tests/fixtures/generation_noise/';

// --- 1. Сверка legacy-эталонов: правка не должна ничего сдвинуть ------------
const legacy = JSON.parse(std.loadFile(DIR + 'legacy_rng_golden.json'));
function gaussianOf(rng) {
    const u1 = 1 - rng.next();
    const u2 = rng.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}
const legacyNow = {
    next_12345: (() => { const r = makeGenerator(12345); return Array.from({ length: 8 }, () => r.next()); })(),
    next_42: (() => { const r = makeGenerator(42); return Array.from({ length: 8 }, () => r.next()); })(),
    int_12345: (() => { const r = makeGenerator(12345); return Array.from({ length: 8 }, () => r.int(1, 6)); })(),
    range_42: (() => { const r = makeGenerator(42); return Array.from({ length: 6 }, () => r.range(-1, 1)); })(),
    gaussian_7: (() => { const r = makeGenerator(7); return Array.from({ length: 4 }, () => gaussianOf(r)); })(),
    shuffle_12345: makeGenerator(12345).shuffle([1, 2, 3, 4, 5, 6, 7, 8]),
    weighted_12345: (() => {
        const r = makeGenerator(12345);
        const list = [{ value: 'a', weight: 1 }, { value: 'b', weight: 2 }, { value: 'c', weight: 3 }];
        return Array.from({ length: 12 }, () => r.weighted(list));
    })(),
    hash01: [-7, 0, 1, 2, 999999].map((n) => hash01(n)),
    noise1D: [0, 0.5, 3.25, -7.5, 100.125].map((x) => noise1D(x)),
    noise1D_seed: [3.25, 3.25].map((x, i) => noise1D(x, 42 + i)),
    noise2D: [[0, 0], [1.5, 1.5], [-3.25, 7.5], [100.125, -0.25]].map(([x, y]) => noise2D(x, y)),
    noise2D_seed42: noise2D(1.5, 1.5, 42),
};
for (const key of Object.keys(legacyNow)) {
    const a = JSON.stringify(legacyNow[key]);
    const b = JSON.stringify(legacy[key]);
    if (a !== b) {
        std.err.puts('legacy-эталон не совпал: ' + key + '\n  было ' + b + '\n  стало ' + a + '\n');
        std.exit(2);
    }
}

// --- 2. Эталонные samples шума ---------------------------------------------
const SEEDS = [0, 7, 12345];
const FREQS = [1, 0.125];
const POINTS = [[0, 0], [1.5, 1.5], [-3.25, 7.5], [100.125, -0.25]];
const samples = [];
for (const seed of SEEDS) {
    for (const frequency of FREQS) {
        for (const [x, y] of POINTS) {
            samples.push({ seed, frequency, x, y, value: simplex2D(x, y, { seed, frequency }) });
        }
    }
}

// Сырой диапазон: sample = 0.5 + 0.5*raw  →  raw = 2*v - 1.
let min = 1;
let max = -1;
let probes = 0;
const probe = createNoise({ algorithm: 'simplex2d', seed: 3, frequency: 1 });
for (let y = -300; y <= 300; y += 0.7) {
    for (let x = -300; x <= 300; x += 0.7) {
        const v = probe.sample2D(x, y);
        probes++;
        if (v < min) min = v;
        if (v > max) max = v;
    }
}

function grid(profile) {
    const cols = 32;
    const rows = 16;
    const cells = [];
    const source = profile.noise
        ? createNoise({ algorithm: 'simplex2d', seed: profile.seed, frequency: profile.frequency })
        : null;
    for (let y = 0; y < rows; y++) {
        const row = [];
        for (let x = 0; x < cols; x++) {
            const value = profile.noise ? source.sample2D(x, y) : 0;
            const solid = profile.noise
                ? (value > profile.threshold ? 1 : 0)
                : ((y % 5 === 0 || x % 11 === 0) ? 1 : 0);
            row.push(solid);
        }
        cells.push(row);
    }
    let solidCount = 0;
    for (const row of cells) for (const cell of row) solidCount += cell;
    return { cols, rows, hash: hashCells(cells), solidCount, cells };
}

const profileA = { noise: true, seed: 7, frequency: 0.25, threshold: 0.5 };
const profileB = { noise: true, seed: 7, frequency: 0.25, threshold: 0.42 };
const regular = { noise: false, seed: 7, frequency: 1, threshold: 0 };
const gridA = grid(profileA);
const gridB = grid(profileB);
const gridRegular = grid(regular);

const fbmSource = createNoise({ algorithm: 'simplex2d', seed: 7, frequency: 0.125 });
const fbm = POINTS.map(([x, y]) => ({ x, y, octaves: 4, value: fbmSource.fbm2D(x, y, { octaves: 4 }) }));

// --- 3. Прогон фикстуры генерации с моком `$` -------------------------------
function runFixture() {
    const gridApi = installGrid({ log: () => {} });
    const randomApi = installRandom({ log: () => {} });
    const chain = () => {
        const api = {
            at: () => api, size: () => api, color: () => api, appendTo: () => api,
        };
        return api;
    };
    const world = {
        gravity: () => world, color: () => world, bounds: () => world,
    };
    const $ = () => chain();
    $.world = world;
    $.grid = gridApi;
    $.random = randomApi;
    $.task = {
        chunked(spec) {
            let aborted = false;
            const task = { abort() { aborted = true; } };
            for (let i = 0; !aborted && i < spec.total; i++) spec.step(i, spec.total);
            if (spec.done) spec.done(aborted);
            return task;
        },
    };
    $.ready = (fn) => { fn(); };
    globalThis.$ = $;

    const source = std.loadFile(DIR + 'main.js');
    (0, eval)(source);

    const out = {};
    for (const name of ['A', 'B', 'regular', 'broken']) {
        const started = $.gen.build(name, { budget: 4 });
        if (!started) {
            std.err.puts('фикстура не запустила профиль ' + name + '\n');
            std.exit(3);
        }
        const report = $.gen.report;
        const validation = report.validation || {};
        out[name] = {
            status: $.gen.status,
            ready: $.gen.ready,
            hash: $.gen.hash,
            cells: $.gen.cells ? $.gen.cells.length : null,
            platforms: validation.platforms === undefined ? null : validation.platforms,
            longest: validation.longest === undefined ? null : validation.longest,
            freeFraction: validation.freeFraction === undefined ? null : validation.freeFraction,
            freeSquares: validation.freeSquares === undefined ? null : validation.freeSquares,
            spawn: $.gen.spawn,
            exit: $.gen.exit,
            attempts: report.attempts.length,
            attemptSeeds: report.attempts.map((a) => a.derivedSeed),
            reasons: validation.reasons || [],
        };
    }
    return out;
}

const generation = runFixture();
for (const name of ['A', 'B', 'regular']) {
    if (generation[name].status !== 'published' || !generation[name].hash) {
        std.err.puts('профиль ' + name + ' не опубликован: ' + JSON.stringify(generation[name]) + '\n');
        std.exit(4);
    }
}
if (generation.broken.status !== 'rejected' || generation.broken.hash !== null) {
    std.err.puts('невалидный профиль не отклонён: ' + JSON.stringify(generation.broken) + '\n');
    std.exit(5);
}
if (generation.A.hash === generation.B.hash) {
    std.err.puts('пороговые профили дали один hash\n');
    std.exit(6);
}
const regularRun1 = runFixture();
if (regularRun1.regular.hash !== generation.regular.hash) {
    std.err.puts('регулярный профиль зависит от прогона\n');
    std.exit(7);
}

const out = {
    comment: 'Эталонные samples симплекс-шума и hash сеток §43 + прогон фикстуры генерации §24. ' +
        'Обновление: build/_deps/quickjs-build/qjs tests/fixtures/generation_noise/gen_reference.mjs.',
    algorithm: {
        name: 'simplex2d',
        version: 1,
        family: 'simplex noise 2D (Перлин—Густавсон, вариант r2d)',
        seedMapping: 'seed >>> 0; таблица перестановок 256 из mulberry32(seed ^ 0x9e3779b9)',
        normalization: 'value = clamp01(0.5 + 0.5 * raw), raw = 70 * сумма вкладов трёх углов в [-1, 1]',
        range: [0, 1],
        frequency: 'координаты умножаются на frequency до сэмплирования',
        gradient: 'классический grad3 Перлина, спроецированный в 2D (12 направлений)',
    },
    samples,
    measuredRaw: { min: 2 * min - 1, max: 2 * max - 1, probes },
    grids: {
        A: { profile: profileA, cols: gridA.cols, rows: gridA.rows, hash: gridA.hash, solidCount: gridA.solidCount, cells: gridA.cells },
        B: { profile: profileB, cols: gridB.cols, rows: gridB.rows, hash: gridB.hash, solidCount: gridB.solidCount, cells: gridB.cells },
        regular: { profile: regular, cols: gridRegular.cols, rows: gridRegular.rows, hash: gridRegular.hash, solidCount: gridRegular.solidCount, cells: gridRegular.cells },
    },
    fbm: { octaves: 4, lacunarity: 2, gain: 0.5, values: fbm },
    generation: {
        fixture: 'tests/fixtures/generation_noise/main.js',
        how: 'прогон фикстуры в qjs с моком $ и синхронным $.task; движок обязан дать те же hash',
        profiles: generation,
    },
};

print(JSON.stringify(out, null, 2));
