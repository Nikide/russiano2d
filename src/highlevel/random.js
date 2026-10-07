// ===========================================================================
// Случайность: $.random — детерминированный ГПСЧ с зерном + шум.
//
// База — makeRandom() из ядра (mulberry32): он уже даёт next/range/int/pick/
// chance и используется демками через $.random. Здесь к нему добавлены
// удобства (shuffle, gaussian, weighted) и шум значений, а сам генератор
// остаётся тем же — иначе поехали бы последовательности в существующих играх
// и в --fixed-dt.
//
//   $.random.seed(7);
//   $.random.int(1, 6);            // кубик, 1..6 включительно
//   $.random.weighted([{ value: 'меч', weight: 1 }, { value: 'мусор', weight: 9 }]);
//   $.random.noise1D(x / 64);      // гладкий рельеф, не зависит от seed()
//
// Детерминизм: одна и та же последовательность вызовов после seed(n) даёт
// одну и ту же последовательность чисел — на этом стоят юнит-тесты и прогон
// с фиксированным шагом.
// ===========================================================================

import { ctx, makeRandom } from './core.js';
import { lerp } from './mathx.js';

/** Зерно по умолчанию — то же, что подставляет api.js без --seed. */
const DEFAULT_SEED = 12345;

// ---------------------------------------------------------------------------
// Генератор
// ---------------------------------------------------------------------------

/**
 * Расширенный генератор с зерном. Возвращает объект с методами next/range/
 * int/pick/chance/shuffle/gaussian/weighted/seed.
 *
 * Зерно 0 ядро подменяет константой 0x9e3779b9 (см. makeRandom в core.js):
 * это по-прежнему детерминированно, но если нужен именно «нулевой» отсчёт —
 * берите seed(1).
 */
export function makeGenerator(seed) {
    const initial = seed === undefined ? DEFAULT_SEED : seed;
    const base = makeRandom(initial);
    let current = Number(initial) >>> 0;

    const rng = {
        /** Текущее зерно. С аргументом — перезапустить последовательность. */
        seed(value) {
            if (value === undefined) return current;
            current = Number(value) >>> 0;
            base.seed(current);
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

        /** Значение-шум 1D в [0, 1] — от координаты, а не от состояния ГПСЧ. */
        noise1D(x, noiseSeed) { return noise1D(x, noiseSeed); },

        /** Значение-шум 2D в [0, 1] — годится для рельефа и биомов. */
        noise2D(x, y, noiseSeed) { return noise2D(x, y, noiseSeed); },
    };

    return rng;
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
// Шум значений
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
    return random;
}
