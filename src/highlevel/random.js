// ===========================================================================
// Случайность: $.random — детерминированный ГПСЧ с зерном, шум и потоки.
//
// База — makeRandom() из ядра (mulberry32): он уже даёт next/range/int/pick/
// chance и используется демками через $.random. Здесь к нему добавлены
// удобства (shuffle, gaussian, weighted), шум значений, именованные потоки и
// снимок состояния, а сам генератор остаётся тем же — иначе поехали бы
// последовательности в существующих играх и в --fixed-dt.
//
//   $.random.seed(7);
//   $.random.int(1, 6);            // кубик, 1..6 включительно
//   $.random.weighted([{ value: 'меч', weight: 1 }, { value: 'мусор', weight: 9 }]);
//   $.random.noise1D(x / 64);      // гладкий рельеф: зерно сессии (--seed)
//   $.random.simplex2D(x / 32, y / 32, { seed: 7 });   // симплекс-шум §43
//
// Детерминизм: одна и та же последовательность вызовов после seed(n) даёт
// одну и ту же последовательность чисел — на этом стоят юнит-тесты и прогон
// с фиксированным шагом.
//
// ЗЕРНО ШУМА (C1 отчёта BASHNYA). `noise1D/noise2D/simplex2D/noise` — чистые
// функции координаты, но зерно по умолчанию берут у СВОЕГО генератора: у
// `$.random` это зерно сессии (`--seed` либо `$.random.seed(n)`), у потока —
// зерно потока. Явно переданное зерно (`noise2D(x, y, 42)`,
// `simplex2D(x, y, { seed: 7 })`) побеждает всегда. До этого правки дефолт был
// жёстким нулём, и смена `--seed` не меняла карту шума — «другой детерминизм»,
// на который и пожаловалась внешняя команда.
//
// Что добавлено по §26/§43 (не меняя существующие последовательности):
//   * state()/restore() — снимок состояния ГПСЧ с version/algorithm ID;
//   * stream('gameplay'|'generation'|'presentation') — изолированные потоки;
//   * simplex2D()/noise() — именованный алгоритм шума с seed/frequency/version;
//   * hashCells() — стабильный hash сетки для validation (§24).
// ===========================================================================

import { engine } from './native.js';
import { ctx, makeRandom, fxReseed } from './core.js';
import { lerp } from './mathx.js';

/** Зерно по умолчанию — то же, что подставляет api.js без --seed. */
const DEFAULT_SEED = 12345;

/** Алгоритм генератора в снимке состояния (§26). Без новой версии не меняется. */
export const RNG_ALGORITHM = 'mulberry32';

/** Версия формата снимка состояния генератора (§26). */
export const STATE_VERSION = 1;

/** Именованные потоки, для которых введён stream(): изоляция потребления. */
export const STREAM_NAMES = ['gameplay', 'generation', 'presentation'];

/**
 * Потоки, влияющие только на картинку: частицы, тряска камеры, декоративный
 * шум. Их состояние не входит ни в сейв (§10: presentation-only random не
 * сохраняется), ни в сравнение расхождения реплея (§26): иначе загрузка слота
 * откатывала бы косметику к моменту сохранения, а шум частиц выглядел бы
 * расхождением gameplay.
 */
export const PRESENTATION_STREAMS = ['presentation'];

// ---------------------------------------------------------------------------
// Состояние ядра
// ---------------------------------------------------------------------------

/**
 * Один шаг mulberry32 по «сырому» состоянию — в точности переход ядра
 * (makeRandom в core.js): `s += 0x6d2b79f5; t = f(s)`.
 *
 * Нужен там, где состояние обязано быть точным, а seed() ядра подменяет
 * зерно 0 константой 0x9e3779b9: восстановление снимка со state = 0 и
 * построение таблицы перестановок симплекс-шума. Совпадение с ядром
 * зафиксировано тестом (tests/js/simplex_noise_test.mjs).
 */
export function mulberry32Step(state) {
    const s = (state + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return { state: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** 32-битное целое без знака? (значения снимка приходят из JSON.) */
function isUint32(value) {
    return Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

/** Короткое описание значения для сообщения об ошибке. */
function describe(value) {
    if (value === undefined) return 'undefined';
    try {
        const text = JSON.stringify(value);
        return text === undefined ? String(value) : text;
    } catch (error) {
        return String(value);
    }
}

// ---------------------------------------------------------------------------
// Генератор
// ---------------------------------------------------------------------------

/**
 * Расширенный генератор с зерном. Возвращает объект с методами next/range/
 * int/pick/chance/shuffle/gaussian/weighted/noise1D/noise2D, шумом
 * simplex2D/noise, потоками stream и снимком state/restore.
 *
 * Зерно 0 ядро подменяет константой 0x9e3779b9 (см. makeRandom в core.js):
 * это по-прежнему детерминированно, но если нужен именно «нулевой» отсчёт —
 * берите seed(1).
 */
export function makeGenerator(seed) {
    return buildGenerator(seed, true).rng;
}

/**
 * Внутренняя сборка. `allowStreams = false` — поток не создаёт вложенных
 * потоков (иначе состояние расползалось бы по дереву), но умеет state/restore.
 * Возвращает `{ rng, reseed }`: reseed нужен родителю, чтобы seed(n) заново
 * разворачивал все потоки из нового базового зерна.
 */
function buildGenerator(seedInput, allowStreams) {
    const initial = seedInput === undefined ? DEFAULT_SEED : seedInput;
    const base = makeRandom(initial);
    let current = Number(initial) >>> 0;
    let state = current || 0x9e3779b9;
    let emulated = false;

    const rawNext = base.next;
    const rawSeed = base.seed;

    // Состояние ядра наружу не отдаётся, поэтому ведём его сами: переход
    // mulberry32 аддитивный (s += const), значит достаточно перехватить next().
    // Значения берутся у ядра — последовательность не дублируется и не
    // меняется ни на одно значение. Переустановка зерна идёт через rawSeed
    // (reseed/applyState), минуя перехватчик: состояние там задаётся явно.
    base.next = function () {
        if (emulated) {
            const step = mulberry32Step(state);
            state = step.state;
            return step.value;
        }
        state = (state + 0x6d2b79f5) >>> 0;
        return rawNext.call(base);
    };

    const streams = new Map();   // имя → { rng, reseed }

    /** Поставить новое зерно, не трогая потоки. */
    function reseed(value) {
        current = Number(value) >>> 0;
        state = current || 0x9e3779b9;
        emulated = false;
        rawSeed.call(base, current);
    }

    /** Восстановить точное состояние из снимка. */
    function applyState(snapshotSeed, snapshotValue) {
        current = Number(snapshotSeed) >>> 0;
        if (snapshotValue === 0) {
            // seed(0) ядра даёт 0x9e3779b9, поэтому нулевое состояние
            // продолжаем собственным шагом — побитово тем же самым.
            emulated = true;
            state = 0;
        } else {
            emulated = false;
            state = snapshotValue;
            rawSeed.call(base, snapshotValue);
        }
    }

    /** Снимок состояния (§26): version/algorithm ID + точное состояние. */
    function stateSnapshot() {
        const snapshot = {
            version: STATE_VERSION,
            algorithm: RNG_ALGORITHM,
            seed: current,
            value: state,
        };
        if (allowStreams && streams.size > 0) {
            const out = {};
            for (const name of Array.from(streams.keys()).sort()) {
                const sub = streams.get(name).rng.state();
                out[name] = { seed: sub.seed, value: sub.value };
            }
            snapshot.streams = out;
        }
        return snapshot;
    }

    /**
     * Создать (или взять) именованный поток, изолированный от default.
     *
     * `opts.independent: true` — поток, который `seed(n)` родителя НЕ
     * переразворачивает: один раз получив зерно (из `opts.seed` или выведенное
     * из текущего базового), он дальше живёт своей жизнью. Нужен там, где
     * смена зерна сессии не должна менять уже идущую партию (сетевой матч,
     * косметика записи, побочный генератор плагина).
     */
    function stream(name, opts) {
        const key = String(name === undefined || name === null ? '' : name);
        if (key === '') throw new Error('$.random.stream: нужно имя потока');
        const o = opts && typeof opts === 'object' ? opts : {};
        const independent = o.independent === true;
        let sub = streams.get(key);
        if (!sub) {
            const explicit = o.seed === undefined || o.seed === null ? null : (Number(o.seed) >>> 0);
            const child = buildGenerator(explicit === null ? streamSeed(current, key) : explicit, false);
            sub = { rng: child.rng, reseed: child.reseed, independent };
            streams.set(key, sub);
        }
        return sub.rng;
    }

    const rng = {
        /** Текущее зерно. С аргументом — перезапустить последовательность. */
        seed(value) {
            if (value === undefined) return current;
            reseed(value);
            // Зерно задаёт всю сессию: уже созданные потоки разворачиваются
            // заново из нового базового зерна, а не продолжают старую.
            // Исключение — независимые потоки (`stream(name, {independent:true})`):
            // их зерно выдано один раз, и чужой seed() его не трогает.
            for (const [name, sub] of streams) {
                if (sub.independent) continue;
                sub.reseed(streamSeed(current, name));
            }
            return rng;
        },

        /** Следующее число в [0, 1). */
        next() { return base.next(); },

        /** Число в [a, b) — b почти никогда не выпадает. */
        range(a, b) { return base.range(a, b); },

        /** Целое в [a, b] — границы включительно. */
        int(a, b) { return base.int(a, b); },

        /** Случайный элемент списка; пустой список → undefined. */
        pick(list) {
            if (!Array.isArray(list) || list.length === 0) return undefined;
            return list[rng.int(0, list.length - 1)];
        },

        /** true с вероятностью p (0..1). */
        chance(p) { return rng.next() < (Number(p) || 0); },

        /** Копия списка в случайном порядке (исходный не меняется). */
        shuffle(list) { return shuffle(list, rng); },

        /** Нормальное распределение: среднее 0, отклонение 1. */
        gaussian() { return gaussian(rng); },

        /** Выбор с весами (см. weightedPick). */
        weighted(list) { return weightedPick(list, rng); },

        /**
         * Значение-шум 1D в [0, 1] — от координаты, а не от состояния ГПСЧ.
         * Без аргумента зерно берётся у этого генератора (у `$.random` —
         * зерно сессии), явно переданное побеждает.
         */
        noise1D(x, noiseSeed) {
            return noise1D(x, noiseSeed === undefined || noiseSeed === null ? current : noiseSeed);
        },

        /** Значение-шум 2D в [0, 1] — годится для рельефа и биомов. */
        noise2D(x, y, noiseSeed) {
            return noise2D(x, y, noiseSeed === undefined || noiseSeed === null ? current : noiseSeed);
        },

        /** Симплекс-шум 2D в [0, 1], именованный алгоритм §43. */
        simplex2D(x, y, opts) { return simplex2D(x, y, withNoiseSeed(opts, current)); },

        /** Источник шума с параметрами: noise({ algorithm, seed, frequency }). */
        noise(opts) { return createNoise(withNoiseSeed(opts, current)); },

        /** Список именованных алгоритмов шума с метаданными. */
        algorithms() { return noiseAlgorithms(); },

        /** Стабильный hash сетки/списка значений — для validation (§24). */
        hashCells(values) { return hashCells(values); },

        /** Снимок состояния ГПСЧ (§26) — для save/replay. */
        state() { return stateSnapshot(); },

        /** Проверка снимка без исключения: true либо текст причины. */
        validateState(snapshot) { return validateStateSnapshot(snapshot); },

        /** Восстановить состояние; несовместимый снимок → понятная ошибка. */
        restore(snapshot) {
            const reason = validateStateSnapshot(snapshot);
            if (reason !== true) throw new Error('$.random.restore: ' + reason);
            applyState(snapshot.seed, snapshot.value);
            if (allowStreams && snapshot.streams) {
                for (const name of Object.keys(snapshot.streams).sort()) {
                    const sub = snapshot.streams[name];
                    stream(name).restore({
                        version: STATE_VERSION,
                        algorithm: RNG_ALGORITHM,
                        seed: sub.seed,
                        value: sub.value,
                    });
                }
            }
            return rng;
        },
    };

    if (allowStreams) {
        rng.stream = stream;
        rng.streamNames = function () { return Array.from(streams.keys()); };
    }

    return { rng, reseed };
}

/**
 * Проверка снимка состояния (§26): версия, алгоритм и 32-битные поля.
 * Возвращает `true` либо текст причины — save/replay может показать его
 * игроку, не ловя исключение.
 */
export function validateStateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return 'снимок должен быть объектом';
    }
    if (snapshot.version !== STATE_VERSION) {
        return 'версия снимка ' + describe(snapshot.version) +
            ' не поддерживается (нужна ' + STATE_VERSION + ')';
    }
    if (snapshot.algorithm !== RNG_ALGORITHM) {
        return 'алгоритм ' + describe(snapshot.algorithm) +
            ' не совпадает с "' + RNG_ALGORITHM + '"';
    }
    if (!isUint32(snapshot.seed)) return 'поле seed должно быть 32-битным целым без знака';
    if (!isUint32(snapshot.value)) return 'поле value должно быть 32-битным целым без знака';
    if (snapshot.streams !== undefined) {
        if (!snapshot.streams || typeof snapshot.streams !== 'object' || Array.isArray(snapshot.streams)) {
            return 'поле streams должно быть объектом';
        }
        for (const name of Object.keys(snapshot.streams)) {
            const sub = snapshot.streams[name];
            if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
                return 'поток "' + name + '": должен быть объектом';
            }
            if (!isUint32(sub.seed)) return 'поток "' + name + '": seed не 32-битное целое';
            if (!isUint32(sub.value)) return 'поток "' + name + '": value не 32-битное целое';
        }
    }
    return true;
}

/**
 * Зерно именованного потока: FNV-1a по имени, смешанный с базовым зерном.
 * Пара (зерно, имя) даёт один и тот же поток на любой машине; смена базового
 * зерна переносит все потоки на новые последовательности.
 */
export function streamSeed(baseSeed, name) {
    const text = String(name === undefined || name === null ? '' : name);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (((Number(baseSeed) || 0) >>> 0) ^ h ^ 0x9e3779b9) >>> 0;
}

/**
 * Опции шума с зерном по умолчанию: подставляем зерно генератора ТОЛЬКО когда
 * своего зерна нет — явное (в том числе 0) всегда побеждает.
 */
function withNoiseSeed(opts, seed) {
    if (opts && typeof opts === 'object') {
        if (opts.seed !== undefined && opts.seed !== null) return opts;
        return Object.assign({}, opts, { seed });
    }
    return { seed };
}

/** Список Фишера—Йетса на переданном генераторе. Возвращает новый массив. */
export function shuffle(list, rng) {
    const out = Array.isArray(list) ? list.slice() : Array.from(list || []);
    for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
    }
    return out;
}

/**
 * Нормальное распределение (Бокс—Мюллер). Кэша «второго числа» нет: каждое
 * обращение — ровно два вызова next(), так что последовательность предсказуема.
 */
export function gaussian(rng) {
    const u1 = 1 - rng.next();          // (0, 1]: log(0) не случится
    const u2 = rng.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(Math.PI * 2 * u2);
}

/**
 * Выбор с весами. Форматы элемента:
 *   { value: 'меч', weight: 3 }   — основной;
 *   { v: 'меч', w: 3 }            — короткая запись;
 *   ['меч', 3]                    — пара;
 *   'меч'                         — вес 1 (обычное значение).
 *
 * Веса <= 0 не участвуют; если сумма весов нулевая, выбор равномерный.
 * Для пустого списка — undefined.
 */
export function weightedPick(list, rng) {
    const items = Array.isArray(list) ? list : [];
    if (items.length === 0) return undefined;

    const values = [];
    const thresholds = [];
    let total = 0;

    for (const entry of items) {
        let value = entry;
        let weight = 1;
        if (Array.isArray(entry)) {
            value = entry[0];
            weight = Number(entry[1]);
        } else if (entry !== null && typeof entry === 'object') {
            value = 'value' in entry ? entry.value : entry.v;
            weight = Number('weight' in entry ? entry.weight : entry.w);
        }
        values.push(value);
        if (weight > 0) total += weight;
        thresholds.push(total);
    }

    if (!(total > 0)) return values[rng.int(0, values.length - 1)];

    const r = rng.next() * total;
    for (let i = 0; i < values.length; i++) {
        if (r < thresholds[i]) return values[i];
    }
    return values[values.length - 1];
}

// ---------------------------------------------------------------------------
// Шум значений (value noise, v1 — заморожен, менять последовательности нельзя)
//
// Хеш решётки, а не таблица: результат — чистая функция координаты. Поэтому
// шум не зависит от $.random.seed() и от порядка вызовов: мир, собранный по
// noise2D, одинаков в любой момент времени и на любой машине.
// ---------------------------------------------------------------------------

/** Целочисленный хеш (финализатор murmur3) → [0, 1). */
export function hash01(n) {
    let x = n | 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
}

/** Сглаживание решётки: без него шум выглядит как ступеньки. */
function fade(t) {
    return t * t * (3 - 2 * t);
}

function hash2(ix, iy, seed) {
    return hash01(Math.imul(ix | 0, 0x1f1f1f1f) ^ Math.imul(iy | 0, 0x27d4eb2d) ^ (seed | 0));
}

/** Значение-шум 1D в [0, 1). seed — необязательное смещение решётки. */
export function noise1D(x, seed) {
    const s = (Number(seed) || 0) | 0;
    const v = Number(x) || 0;
    const i = Math.floor(v);
    const t = fade(v - i);
    const a = hash01((i + s) | 0);
    const b = hash01((i + 1 + s) | 0);
    return a + (b - a) * t;
}

/** Значение-шум 2D в [0, 1). seed — необязательное смещение решётки. */
export function noise2D(x, y, seed) {
    const s = (Number(seed) || 0) | 0;
    const vx = Number(x) || 0;
    const vy = Number(y) || 0;
    const ix = Math.floor(vx);
    const iy = Math.floor(vy);
    const tx = fade(vx - ix);
    const ty = fade(vy - iy);
    const a = hash2(ix, iy, s);
    const b = hash2(ix + 1, iy, s);
    const c = hash2(ix, iy + 1, s);
    const d = hash2(ix + 1, iy + 1, s);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

// ---------------------------------------------------------------------------
// Симплекс-шум (§43)
//
// Это НАШ зафиксированный вариант 2D simplex noise (Перлин—Густавсон) с
// таблицей перестановок из mulberry32, а не побитовое совпадение с
// FastNoiseLite/OpenSimplex: вариант, seed mapping и нормализация описаны ниже
// и закреплены эталонными samples в tests/fixtures/generation_noise.
// ---------------------------------------------------------------------------

/** Метаданные алгоритмов шума: имя, версия, диапазон, seed mapping. */
export const NOISE_ALGORITHMS = [
    {
        name: 'value2d',
        version: 1,
        family: 'value noise (решётка со сглаживанием)',
        range: [0, 1],
        units: 'нормированное значение',
        seedMapping: 'seed | 0 — смещение целочисленной решётки, таблиц нет',
        stability: 'заморожено: noise1D/noise2D v1, значения не меняются',
        sample: 'noise2D(x, y, seed)',
    },
    {
        name: 'simplex2d',
        version: 1,
        family: 'simplex noise 2D (Перлин—Густавсон, вариант r2d)',
        range: [0, 1],
        units: 'нормированное значение',
        seedMapping: 'seed >>> 0; перестановки из mulberry32(seed ^ 0x9e3779b9)',
        stability: 'заморожено v1: эталонные samples и hash в reference_samples.json',
        sample: 'simplex2D(x, y, { seed, frequency }) / noise({ algorithm: "simplex2d", seed, frequency })',
    },
];

/** Копия метаданных алгоритма (или null, если имени нет). */
export function noiseAlgorithmInfo(name) {
    const key = String(name);
    for (const info of NOISE_ALGORITHMS) {
        if (info.name !== key) continue;
        return {
            name: info.name,
            version: info.version,
            family: info.family,
            range: info.range.slice(),
            units: info.units,
            seedMapping: info.seedMapping,
            stability: info.stability,
            sample: info.sample,
        };
    }
    return null;
}

/** Все именованные алгоритмы шума с метаданными. */
export function noiseAlgorithms() {
    return NOISE_ALGORITHMS.map((info) => noiseAlgorithmInfo(info.name));
}

/** Классический grad3 Перлина, спроецированный в 2D: 12 направлений. */
const GRAD2 = new Int8Array([
    1, 1, -1, 1, 1, -1, -1, -1,
    1, 0, -1, 0, 1, 0, -1, 0,
    0, 1, 0, -1, 0, 1, 0, -1,
]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** Кэш таблиц перестановок: при переполнении вытесняется первый вставленный. */
const PERM_CACHE = new Map();
const PERM_CACHE_MAX = 32;

/**
 * Таблица перестановок для seed: 256 значений, перемешанных mulberry32 от
 * `seed ^ 0x9e3779b9`, затем продублированных до 512 (индексация ii+perm[jj]).
 * Нулевое состояние mulberry32 допустимо — шаг считается точно.
 */
function permutationFor(seed) {
    const key = seed >>> 0;
    const cached = PERM_CACHE.get(key);
    if (cached !== undefined) return cached;

    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let state = (key ^ 0x9e3779b9) >>> 0;
    for (let i = 255; i > 0; i--) {
        const step = mulberry32Step(state);
        state = step.state;
        const j = Math.floor(step.value * (i + 1));
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    if (PERM_CACHE.size >= PERM_CACHE_MAX) {
        PERM_CACHE.delete(PERM_CACHE.keys().next().value);
    }
    PERM_CACHE.set(key, perm);
    return perm;
}

/** Сырой simplex 2D в примерно [-1, 1] (множитель 70 — как в классике). */
function simplexRaw(perm, x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    let i1;
    let j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 12;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
        t0 *= t0;
        n += t0 * t0 * (GRAD2[gi0 * 2] * x0 + GRAD2[gi0 * 2 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
        t1 *= t1;
        n += t1 * t1 * (GRAD2[gi1 * 2] * x1 + GRAD2[gi1 * 2 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
        t2 *= t2;
        n += t2 * t2 * (GRAD2[gi2 * 2] * x2 + GRAD2[gi2 * 2 + 1] * y2);
    }
    return 70 * n;
}

/** Нормализация: сырой [-1, 1] → [0, 1] со страховочным клампингом. */
function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function simplex01(perm, x, y) {
    return clamp01(0.5 + 0.5 * simplexRaw(perm, x, y));
}

/**
 * Источник шума: `$.random.noise({ algorithm: 'simplex2d', seed: 7, frequency: 1/32 })`.
 * Возвращает объект с sample2D/sample1D/fbm2D — чистая функция координат,
 * состояние ГПСЧ не потребляет и от task budget не зависит.
 *
 * frequency > 0: координаты умножаются на неё до сэмплирования
 * (`sample2D(x, y)` = шум в точке `(x*frequency, y*frequency)`).
 * Неизвестный алгоритм/версия или неверная frequency → понятная ошибка.
 */
export function createNoise(opts) {
    const spec = opts || {};
    const name = spec.algorithm === undefined ? 'simplex2d' : String(spec.algorithm);
    const info = noiseAlgorithmInfo(name);
    if (!info) throw new Error('$.random.noise: неизвестный алгоритм "' + name + '"');
    const version = spec.version === undefined ? info.version : Number(spec.version);
    if (version !== info.version) {
        throw new Error('$.random.noise: версия ' + describe(version) + ' алгоритма "' + name +
            '" не поддерживается (доступна ' + info.version + ')');
    }
    const seed = (Number(spec.seed) || 0) >>> 0;
    const frequency = spec.frequency === undefined ? 1 : Number(spec.frequency);
    if (!Number.isFinite(frequency) || frequency <= 0) {
        throw new Error('$.random.noise: frequency должна быть конечным числом > 0');
    }

    // seedI — зерно «слоя»: у value noise это смещение решётки, у симплекса —
    // отдельная таблица перестановок (нужна для октав fBm).
    const sampleAt = name === 'simplex2d'
        ? (seedI, px, py) => simplex01(permutationFor(seedI), px, py)
        : (seedI, px, py) => noise2D(px, py, seedI);

    return {
        algorithm: name,
        version,
        seed,
        frequency,
        range: [0, 1],

        /** Значение в [0, 1] в точке (x, y) с учётом frequency. */
        sample2D(x, y) {
            return sampleAt(seed, (Number(x) || 0) * frequency, (Number(y) || 0) * frequency);
        },

        /** Одномерный срез: sample2D(x, 0) с учётом frequency. */
        sample1D(x) {
            return sampleAt(seed, (Number(x) || 0) * frequency, 0);
        },

        /**
         * fBm/октавы — optional: сумма октав с lacunarity/gain, усреднённая по
         * сумме амплитуд, поэтому тоже [0, 1]. Октав 1..8 (по умолчанию 4),
         * зерно октавы i: (seed + i*0x9e3779b1) >>> 0.
         */
        fbm2D(x, y, options) {
            const fbm = options || {};
            let octaves = fbm.octaves === undefined ? 4 : Math.floor(Number(fbm.octaves));
            if (!Number.isFinite(octaves) || octaves < 1) octaves = 1;
            if (octaves > 8) octaves = 8;
            const lacunarity = fbm.lacunarity === undefined ? 2 : Number(fbm.lacunarity);
            const gain = fbm.gain === undefined ? 0.5 : Number(fbm.gain);
            if (!Number.isFinite(lacunarity) || lacunarity < 1) {
                throw new Error('$.random.noise fbm2D: lacunarity должна быть >= 1');
            }
            if (!Number.isFinite(gain) || gain <= 0) {
                throw new Error('$.random.noise fbm2D: gain должна быть > 0');
            }
            const px = Number(x) || 0;
            const py = Number(y) || 0;
            let amp = 1;
            let sum = 0;
            let norm = 0;
            let f = frequency;
            for (let i = 0; i < octaves; i++) {
                const octaveSeed = (seed + i * 0x9e3779b1) >>> 0;
                sum += amp * sampleAt(octaveSeed, px * f, py * f);
                norm += amp;
                amp *= gain;
                f *= lacunarity;
            }
            return norm > 0 ? sum / norm : 0;
        },

        /** Метаданные алгоритма (имя/версия/диапазон/seed mapping). */
        info() { return noiseAlgorithmInfo(name); },
    };
}

/**
 * Удобная точка входа: симплекс-шум 2D в [0, 1].
 * `opts = { seed, frequency, version }`; algorithm — только 'simplex2d'.
 */
export function simplex2D(x, y, opts) {
    const spec = opts || {};
    if (spec.algorithm !== undefined && String(spec.algorithm) !== 'simplex2d') {
        throw new Error('$.random.simplex2D: ожидался алгоритм "simplex2d", получен "' +
            spec.algorithm + '"');
    }
    return createNoise({
        algorithm: 'simplex2d',
        version: spec.version,
        seed: spec.seed,
        frequency: spec.frequency,
    }).sample2D(x, y);
}

// ---------------------------------------------------------------------------
// Hash данных (§24: validation до публикации карты)
// ---------------------------------------------------------------------------

/**
 * Стабильный hash сетки/списка значений: FNV-1a 32 бита, 8 hex-символов.
 * Вложенные массивы обходятся в порядке строк; каждое значение подаётся с
 * префиксом типа (#число, ?bool, "строка, ~null), поэтому 1 и '1' — разные
 * данные. Числа берутся в кратчайшей записи String() (double). Это hash
 * ДАННЫХ, а не криптографический: он нужен, чтобы сравнить две карты на
 * равенство. Значения другого типа приводятся String().
 */
export function hashCells(values) {
    let h = 0x811c9dc5;   // FNV offset basis
    const feed = (text) => {
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        h ^= 0x1f;                       // разделитель значений
        h = Math.imul(h, 0x01000193);
    };
    const walk = (value) => {
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) walk(value[i]);
            return;
        }
        if (typeof value === 'number') {
            if (Number.isNaN(value)) feed('#nan');
            else if (value === Infinity) feed('#inf');
            else if (value === -Infinity) feed('#-inf');
            else feed('#' + String(value));
            return;
        }
        if (typeof value === 'boolean') { feed(value ? '?true' : '?false'); return; }
        if (value === null) { feed('~null'); return; }
        if (value === undefined) { feed('~undefined'); return; }
        feed('"' + String(value));
    };
    walk(values);
    const hex = (h >>> 0).toString(16);
    return '00000000'.slice(hex.length) + hex;
}

// ---------------------------------------------------------------------------
// Комплект шумов: $.noise
//
// Здесь — имена и параметры; сами числа считает FastNoiseLite
// (third_party/fastnoise_lite → src/noise.cpp) через engine.noise.*. Набор:
// OpenSimplex2, OpenSimplex2S, Perlin, Value, ValueCubic, Cellular (Worley) с
// метриками расстояния и типами возврата, фракталы fBm/Ridged/PingPong поверх
// любого источника, domain warp (одна итерация или фрактальный), 2D и 3D.
//
// Правило зерна то же, что у остальных шумов движка: без явного `seed` берётся
// зерно сессии ($.random.seed()), а явно переданное побеждает всегда. Поэтому
// «разный --seed — разный мир» верно и для этого набора.
//
// Два пути вызова:
//   * поштучный — `$.noise.simplex2(x, y, opts)`: удобно для запросов и логики;
//   * массовый — `$.noise.field({ w, h, ... })` / `fieldRGBA(...)`: сетка
//     считается в C одним вызовом. На 65 536 точках это разница в десятки раз,
//     потому что поштучный путь платит за каждый переход JS→C.
// Массовый путь даёт ровно те же числа, что поштучный: и там и там считает одна
// и та же функция апстрима (проверяется тестом на побитовое совпадение).
// ---------------------------------------------------------------------------

/** Источники шума: имя → номер в C-контракте (R2DNoiseSource). */
export const NOISE_SOURCES = {
    simplex2: 0,
    simplex2S: 1,
    perlin: 2,
    value: 3,
    cubic: 4,
    cellular: 5,
};

/** Фрактальные режимы: имя → номер (R2DNoiseFractal). */
export const NOISE_FRACTALS = { none: 0, fbm: 1, ridged: 2, pingpong: 3 };

/** Метрики расстояния cellular (R2DNoiseCellDistance). */
export const NOISE_CELL_DISTANCES = {
    euclidean: 0,
    euclideanSq: 1,
    manhattan: 2,
    hybrid: 3,
};

/** Что возвращает cellular (R2DNoiseCellReturn). */
export const NOISE_CELL_RETURNS = {
    value: 0,
    distance: 1,
    distance2: 2,
    distance2Add: 3,
    distance2Sub: 4,
    distance2Mul: 5,
    distance2Div: 6,
};

/** Типы domain warp (R2DNoiseWarpType). */
export const NOISE_WARP_TYPES = { simplex2: 0, simplex2Reduced: 1, basicGrid: 2 };

/** Фрактал внутри domain warp (R2DNoiseWarpFractal). */
export const NOISE_WARP_FRACTALS = { none: 0, progressive: 1, independent: 2 };

/** Повороты осей для 3D (R2DNoiseRotation3D) — у апстрима их ровно два. */
export const NOISE_ROTATIONS = { none: 0, improveXY: 1, improveXZ: 2 };

function noiseNames(table) {
    return Object.keys(table);
}

/** Значение перечисления: именем или номером. Мусор — ошибка, а не «взяли 0». */
function noiseEnum(table, value, fallback, what) {
    if (value === undefined || value === null) return fallback;
    const names = Object.keys(table);
    if (typeof value === 'number') {
        if (Number.isInteger(value) && value >= 0 && value < names.length) return value;
        throw new Error('$.noise: ' + what + ' = ' + value + ' вне диапазона 0..' +
                        (names.length - 1));
    }
    const key = String(value);
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    throw new Error('$.noise: неизвестное ' + what + ' «' + key + '» (есть: ' +
                    names.join(', ') + ')');
}

function noiseNumber(value, fallback, what, lo, hi) {
    if (value === undefined || value === null) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new Error('$.noise: ' + what + ' должно быть числом, получено ' + value);
    }
    if (number < lo || number > hi) {
        throw new Error('$.noise: ' + what + ' = ' + number + ' вне диапазона ' + lo + '..' + hi);
    }
    return number;
}

function noiseInteger(value, fallback, what, lo, hi) {
    return Math.trunc(noiseNumber(value, fallback, what, lo, hi));
}

/**
 * Нормализовать параметры шума: имена → номера, умолчания → числа.
 *
 * Возвращает { c, names }: `c` — конфигурация ровно в том виде, в каком её
 * ждёт движок (engine.noise.*), `names` — те же значения человекочитаемо (для
 * $.noise.params и отладки). Лишние поля (w/h/x0/step для field) игнорируются:
 * их читает только массовый путь.
 */
export function noiseParams(opts, sessionSeed) {
    const o = opts || {};
    const sourceId = noiseEnum(NOISE_SOURCES, o.source, NOISE_SOURCES.simplex2, 'source');
    const fractalId = noiseEnum(NOISE_FRACTALS, o.fractal, NOISE_FRACTALS.none, 'fractal');
    // Канонические имена — cellularDistance/cellularReturn (как в доке); короткие
    // cellDistance/cellReturn приняты как синонимы, чтобы не спотыкаться о них.
    const cellDistanceId = noiseEnum(NOISE_CELL_DISTANCES,
                                     o.cellularDistance === undefined ? o.cellDistance
                                                                      : o.cellularDistance,
                                     NOISE_CELL_DISTANCES.euclideanSq, 'cellularDistance');
    const cellReturnId = noiseEnum(NOISE_CELL_RETURNS,
                                   o.cellularReturn === undefined ? o.cellReturn
                                                                  : o.cellularReturn,
                                   NOISE_CELL_RETURNS.distance, 'cellularReturn');
    const warpTypeId = noiseEnum(NOISE_WARP_TYPES, o.warpType,
                                 NOISE_WARP_TYPES.simplex2, 'warpType');
    const warpFractalId = noiseEnum(NOISE_WARP_FRACTALS, o.warpFractal,
                                    NOISE_WARP_FRACTALS.none, 'warpFractal');
    const rotationId = noiseEnum(NOISE_ROTATIONS, o.rotation3d, NOISE_ROTATIONS.none,
                                 'rotation3d');

    // У апстрима fractal-режим один на объект: он же включает фрактальный warp.
    // Поэтому «фрактальный шум и фрактальный warp сразу» невозможно — говорим
    // об этом прямо, а не подменяем одно другим молча.
    if (fractalId !== NOISE_FRACTALS.none && warpFractalId !== NOISE_WARP_FRACTALS.none) {
        throw new Error('$.noise: fractal и warpFractal в одном генераторе ' +
                        'несовместимы (у FastNoiseLite один fractal-режим на объект): ' +
                        'нужен либо фрактальный шум, либо фрактальный warp — ' +
                        'создайте два $.noise.create()');
    }

    const seed = (o.seed === undefined || o.seed === null)
        ? (Number(sessionSeed) | 0)
        : (Math.trunc(Number(o.seed)) | 0);

    const sourceName = Object.keys(NOISE_SOURCES).find((k) => NOISE_SOURCES[k] === sourceId);
    const fractalName = Object.keys(NOISE_FRACTALS).find((k) => NOISE_FRACTALS[k] === fractalId);

    const c = {
        source: sourceId,
        seed: seed,
        frequency: noiseNumber(o.frequency, 0.01, 'frequency', 1e-6, 10000),
        fractal: fractalId,
        octaves: noiseInteger(o.octaves, 3, 'octaves', 1, 12),
        lacunarity: noiseNumber(o.lacunarity, 2, 'lacunarity', 1e-6, 100),
        gain: noiseNumber(o.gain, 0.5, 'gain', 0, 1),
        weighted_strength: noiseNumber(o.weightedStrength, 0, 'weightedStrength', 0, 1),
        pingpong_strength: noiseNumber(o.pingPongStrength, 2, 'pingPongStrength', 0, 100),
        cell_distance: cellDistanceId,
        cell_return: cellReturnId,
        cell_jitter: noiseNumber(o.cellJitter === undefined ? o.cellularJitter : o.cellJitter, 1, 'cellJitter', 0, 2),
        warp_type: warpTypeId,
        warp_amp: noiseNumber(o.warpAmp, 1, 'warpAmp', 0, 10000),
        warp_fractal: warpFractalId,
        warp_octaves: noiseInteger(o.warpOctaves, 3, 'warpOctaves', 1, 12),
        warp_lacunarity: noiseNumber(o.warpLacunarity, 2, 'warpLacunarity', 1e-6, 100),
        warp_gain: noiseNumber(o.warpGain, 0.5, 'warpGain', 0, 1),
        rotation3d: rotationId,
    };

    const names = {
        source: sourceName,
        fractal: fractalName,
        cellDistance: Object.keys(NOISE_CELL_DISTANCES)
            .find((k) => NOISE_CELL_DISTANCES[k] === cellDistanceId),
        cellReturn: Object.keys(NOISE_CELL_RETURNS)
            .find((k) => NOISE_CELL_RETURNS[k] === cellReturnId),
        warpType: Object.keys(NOISE_WARP_TYPES).find((k) => NOISE_WARP_TYPES[k] === warpTypeId),
        warpFractal: Object.keys(NOISE_WARP_FRACTALS)
            .find((k) => NOISE_WARP_FRACTALS[k] === warpFractalId),
        rotation3d: Object.keys(NOISE_ROTATIONS).find((k) => NOISE_ROTATIONS[k] === rotationId),
    };
    return { c, names };
}

// Кэш генераторов для поштучных вызовов: ключ — конфигурация целиком, поэтому
// смена зерна сессии или любого параметра даёт другой генератор, а не «старый
// с другими числами». Ограничен, как PERM_CACHE выше: игровой код не должен
// растить память, перебирая параметры в кадре.
const NOISE_CACHE = new Map();
const NOISE_CACHE_MAX = 32;

function noiseFieldGrid(opts, what) {
    const o = opts || {};
    const w = Math.trunc(Number(o.w === undefined ? o.width : o.w));
    const h = Math.trunc(Number(o.h === undefined ? o.height : o.h));
    if (!(w > 0) || !(h > 0)) {
        throw new Error('$.noise.' + what + ': нужны w и h больше нуля (получено ' +
                        o.w + '×' + o.h + ')');
    }
    const step = o.step === undefined ? 1 : Number(o.step);
    return {
        w: w,
        h: h,
        z: o.z === undefined ? 0 : Number(o.z),
        x0: o.x0 === undefined ? 0 : Number(o.x0),
        y0: o.y0 === undefined ? 0 : Number(o.y0),
        sx: o.stepX === undefined ? step : Number(o.stepX),
        sy: o.stepY === undefined ? step : Number(o.stepY),
    };
}

/** Собрать объект-генератор поверх уже нормализованной конфигурации. */
function makeNoiseGenerator(config, names) {
    const native = engine && engine.noise ? engine.noise : null;
    if (native === null) {
        throw new Error('$.noise: движок собран без комплекта шумов (engine.noise нет)');
    }
    const c = config;
    return {
        /** Параметры генератора: имена и числовая конфигурация для движка. */
        params() {
            const out = Object.assign({}, names);
            out.seed = c.seed;
            out.c = Object.assign({}, c);
            return out;
        },
        get2(x, y) { return native.get2(c, x, y); },
        get3(x, y, z) { return native.get3(c, x, y, z); },
        /** Сдвиг точки доменным warp'ом: [x, y] (или [x, y, z]). */
        warp2(x, y) { return native.warp2(c, x, y); },
        warp3(x, y, z) { return native.warp3(c, x, y, z); },
        /** Warp + шум в искажённой точке — то, ради чего warp обычно и берут. */
        warped2(x, y) {
            const warped = native.warp2(c, x, y);
            return native.get2(c, warped[0], warped[1]);
        },
        warped3(x, y, z) {
            const warped = native.warp3(c, x, y, z);
            return native.get3(c, warped[0], warped[1], warped[2]);
        },
        /** Поле w×h, Float32Array построчно. Те же числа, что get2. */
        field(opts) {
            const g = noiseFieldGrid(opts, 'field');
            return native.field(c, g.w, g.h, g.x0, g.y0, g.sx, g.sy);
        },
        /** Слой 3D-поля при фиксированном z. */
        field3(opts) {
            const g = noiseFieldGrid(opts, 'field3');
            return native.field3(c, g.w, g.h, g.z, g.x0, g.y0, g.sx, g.sy);
        },
        /** Сразу пиксели RGBA (серые) — для engine.textureFromPixels. */
        fieldRGBA(opts) {
            const g = noiseFieldGrid(opts, 'fieldRGBA');
            return native.fieldRGBA(c, g.w, g.h, g.x0, g.y0, g.sx, g.sy);
        },
    };
}

function noiseCacheKey(c) {
    let key = '';
    for (const name of Object.keys(c)) key += c[name] + ',';
    return key;
}

/**
 * Создать генератор шума с параметрами (см. $.noise.params).
 * Явный вызов стоит один раз: переиспользуйте генератор в цикле — тогда
 * накладные расходы на разбор параметров платятся однажды.
 */
export function createNoiseGenerator(opts, sessionSeed) {
    const parsed = noiseParams(opts, sessionSeed);
    return makeNoiseGenerator(parsed.c, parsed.names);
}

/** Генератор для поштучного вызова: кэш по конфигурации. */
function cachedNoise(opts, sessionSeed) {
    const parsed = noiseParams(opts, sessionSeed);
    const key = noiseCacheKey(parsed.c);
    const hit = NOISE_CACHE.get(key);
    if (hit) return hit;
    const generator = makeNoiseGenerator(parsed.c, parsed.names);
    if (NOISE_CACHE.size >= NOISE_CACHE_MAX) {
        NOISE_CACHE.delete(NOISE_CACHE.keys().next().value);
    }
    NOISE_CACHE.set(key, generator);
    return generator;
}

/** Одна точка: источник + (необязательно) фрактал. */
function noiseAt(source, fractal, x, y, z, opts, sessionSeed) {
    const options = Object.assign({}, opts);
    // Имя функции уже задаёт источник (simplex2/perlin/...). Если в параметрах
    // передан ДРУГОЙ source, это почти всегда опечатка: молча взять один из
    // двух — значит посчитать не тот шум, о котором просили.
    if (options.source !== undefined &&
        noiseEnum(NOISE_SOURCES, options.source, NOISE_SOURCES[source], 'source') !==
            NOISE_SOURCES[source]) {
        throw new Error('$.noise.' + source + ': source задан и именем функции, и ' +
                        'параметрами — уберите одно из двух');
    }
    if (fractal !== undefined && options.fractal !== undefined &&
        noiseEnum(NOISE_FRACTALS, options.fractal, NOISE_FRACTALS[fractal], 'fractal') !==
            NOISE_FRACTALS[fractal]) {
        throw new Error('$.noise.' + fractal + ': fractal задан и именем функции, и ' +
                        'параметрами — уберите одно из двух');
    }
    options.source = source;
    if (fractal !== undefined) options.fractal = fractal;
    const generator = cachedNoise(options, sessionSeed);
    return z === undefined ? generator.get2(x, y) : generator.get3(x, y, z);
}

/** Собрать $.noise. `sessionSeed()` читает зерно сессии в момент вызова. */
export function makeNoiseApi(sessionSeed) {
    const api = {
        sources() { return noiseNames(NOISE_SOURCES); },
        fractals() { return noiseNames(NOISE_FRACTALS); },
        cellularDistances() { return noiseNames(NOISE_CELL_DISTANCES); },
        cellularReturns() { return noiseNames(NOISE_CELL_RETURNS); },
        warpTypes() { return noiseNames(NOISE_WARP_TYPES); },
        warpFractals() { return noiseNames(NOISE_WARP_FRACTALS); },
        rotations() { return noiseNames(NOISE_ROTATIONS); },
        /** Значения по умолчанию — из C: одна копия умолчаний на движок. */
        defaults() {
            return (engine && engine.noise) ? engine.noise.defaults() : null;
        },
        /** Нормализованные параметры: что именно уйдёт в движок. */
        params(opts) { return noiseParams(opts, sessionSeed()); },
        create(opts) { return createNoiseGenerator(opts, sessionSeed()); },
    };

    // Поштучные обёртки: имя источника (или фрактала) + необязательные opts.
    for (const source of noiseNames(NOISE_SOURCES)) {
        api[source] = (x, y, opts) => noiseAt(source, undefined, x, y, undefined, opts, sessionSeed());
    }
    for (const fractal of ['fbm', 'ridged', 'pingpong']) {
        api[fractal] = (x, y, opts) => noiseAt(NOISE_SOURCES.simplex2, fractal, x, y, undefined, opts, sessionSeed());
    }
    /** 3D-точка: $.noise.point3(x, y, z, opts). */
    api.point3 = (x, y, z, opts) => noiseAt(NOISE_SOURCES.simplex2, undefined, x, y, z, opts, sessionSeed());

    /** Domain warp точки без шума: [x, y]. */
    api.domainWarp = (x, y, opts) => cachedNoise(opts, sessionSeed()).warp2(x, y);
    api.domainWarp3 = (x, y, z, opts) => cachedNoise(opts, sessionSeed()).warp3(x, y, z);
    /** Warp + шум в искажённой точке. */
    api.warped = (x, y, opts) => cachedNoise(opts, sessionSeed()).warped2(x, y);
    api.warped3 = (x, y, z, opts) => cachedNoise(opts, sessionSeed()).warped3(x, y, z);

    /** Поле w×h (Float32Array): один вызов в C на все точки. */
    api.field = (opts) => cachedNoise(opts, sessionSeed()).field(opts);
    api.field3 = (opts) => cachedNoise(opts, sessionSeed()).field3(opts);
    /** Поле сразу пикселями RGBA (Uint8Array) — в engine.textureFromPixels. */
    api.fieldRGBA = (opts) => cachedNoise(opts, sessionSeed()).fieldRGBA(opts);
    return api;
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

/**
 * Подключить $.random. Зерно берётся из engine.seed (его задаёт --seed), а без
 * него — DEFAULT_SEED, как раньше делал api.js.
 */
export function installRandom($) {
    // Без движка — свой постоянный сид: подсистема ставится при создании API, и
    // обращение к engine роняло весь bootstrap.
    const seed = (typeof engine !== 'undefined' && engine && engine.seed !== undefined)
        ? engine.seed : DEFAULT_SEED;
    const random = makeGenerator(seed);
    $.random = random;
    ctx.random = random;
    // Комплект шумов: своё пространство имён, но то же зерно сессии. Читаем его
    // в момент вызова (random.seed()), поэтому $.random.seed(n) влияет и на шум,
    // а явно переданный seed в параметрах побеждает всегда.
    $.noise = makeNoiseApi(() => random.seed());
    // Косметический генератор (тряска, джиттер) засеваем тем же зерном сессии:
    // он остаётся отдельным потоком (§11), но перестаёт быть одинаковым во всех
    // запусках — иначе «разный --seed — разный прогон» неверно для картинки.
    fxReseed(seed);
    return random;
}
