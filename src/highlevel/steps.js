// ===========================================================================
// Шаги и реплики NPC — $.steps и $.barks
//
// Порт из audm-neko (game/sound/footsteps.gd, sound_bank_v2.gd).
//
// ШАГИ. Звук шага зависит от материала под ногами, а частота — от пройденного
// пути, а не от таймера: иначе на быстром шаге слышна «пулемётная» дробь.
// Шаг играется раз в `stride` пикселей пути (у бега шаг длиннее), тише при
// приседе, а приземление — по скорости падения.
//
//   $.steps.material({ wood: ['step/wood_0.wav', 'step/wood_1.wav'],
//                      concrete: ['step/con_0.wav'] });
//   $.steps.tick('#hero', { onFloor: true, speed: 140, landed: 220 }, dt);
//
// РЕПЛИКИ. Строка выбирается по СИТУАЦИИ (idle, see_enemy, hurt, kill, panic),
// ПСИХОТИПУ (реплика может быть только для «параноика») и уровню ебанутости:
// у безумца даже на посту проскакивает бред. Недавние реплики не повторяются,
// чтобы NPC не бормотал одно и то же.
//
//   $.barks.define({ idle: [{ t: 'Тихо…', types: ['параноик'] }], hurt: [{ t: 'Ай!' }] });
//   $.barks.pick('idle', { type: 'параноик', madness: 0.7 });   // строка или ''
//
// Оба модуля чистые там, где это важно: выбор файла и выбор реплики — функции
// без движка, их проверяет юнит-тест (tests/js/steps_test.mjs).
// ===========================================================================

import { ctx, query, fxRandom } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: шаги
// ---------------------------------------------------------------------------

/** Шаг на столько пикселей пути (у бега шаг длиннее). */
export const STRIDE = 78.0;
export const RUN_STRIDE = 96.0;
/** Медленнее — не шаги, а переминание. */
export const MIN_SPEED = 40.0;
/** Быстрее — бег. */
export const RUN_SPEED = 260.0;

/**
 * Накопить путь и решить, пора ли шагнуть. Мутирует `state.acc`.
 * Возвращает `{ step, run, acc }`.
 */
export function advanceStride(state, speed, dt) {
    const st = state || { acc: 0 };
    const v = Math.abs(Number(speed) || 0);
    if (v < MIN_SPEED) {
        st.acc = 0;
        return { step: false, run: false, acc: 0 };
    }
    const run = v > RUN_SPEED;
    const stride = run ? RUN_STRIDE : STRIDE;
    st.acc = (Number(st.acc) || 0) + v * (Number(dt) || 0);
    if (st.acc >= stride) {
        st.acc -= stride;
        return { step: true, run, acc: st.acc };
    }
    return { step: false, run, acc: st.acc };
}

/** Громкость шага в долях: бег громче, присед почти беззвучен. */
export function stepVolume(run, crouching) {
    let db = run ? -14.0 : -19.0;
    if (crouching) db -= 12.0;
    // Децибелы в множитель: -19 дБ ≈ 0.11, -14 ≈ 0.2, присед ≈ 0.03.
    return Math.pow(10, db / 20);
}

/** Громкость приземления по скорости падения: мягко…жёстко. */
export function landVolume(fallSpeed) {
    const k = Math.max(0.3, Math.min(1, (Number(fallSpeed) || 0) / 900));
    const db = -20 + 14 * k;   // -20 дБ … -6 дБ
    return Math.pow(10, db / 20);
}

// ---------------------------------------------------------------------------
// Чистая часть: реплики
// ---------------------------------------------------------------------------

/** Подходит ли реплика по психотипу и уровню безумия. */
export function barkFits(line, psychotype, madness) {
    if (!line) return false;
    const types = Array.isArray(line.types) ? line.types : [];
    if (types.length && !types.includes(String(psychotype || ''))) return false;
    const low = Number(line.madness_min === undefined ? 0 : line.madness_min);
    const high = Number(line.madness_max === undefined ? 1 : line.madness_max);
    const level = Number(madness) || 0;
    return level >= low && level <= high;
}

/**
 * Выбор реплики: из подходящих предпочитает «свои» для психотипа (в 70%
 * случаев), недавние не повторяет. `recent` мутируется, хранит последние
 * `keep` строк.
 */
export function pickBark(lines, opts) {
    const spec = opts || {};
    const pool = Array.isArray(lines) ? lines : [];
    const recent = spec.recent || [];
    const keep = Math.max(1, Number(spec.keep) || 24);
    // Без своего генератора — fxRandom: он сеется движком (--seed), поэтому
    // шаги воспроизводимы в реплее. Math.random() ломал и реплей, и
    // разбор баг-репорта.
    const random = typeof spec.rng === 'function' ? spec.rng : fxRandom;
    const fits = [];
    const own = [];
    for (const line of pool) {
        if (!barkFits(line, spec.psychotype, spec.madness)) continue;
        const text = String(line.t === undefined ? '' : line.t);
        if (!text || recent.includes(text)) continue;
        fits.push(text);
        const types = Array.isArray(line.types) ? line.types : [];
        if (types.includes(String(spec.psychotype || ''))) own.push(text);
    }
    if (!fits.length) return '';
    const from = own.length && random() < 0.7 ? own : fits;
    const chosen = from[Math.floor(random() * from.length) % from.length];
    if (spec.recent) {
        recent.push(chosen);
        while (recent.length > keep) recent.shift();
    }
    return chosen;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installSteps($) {
    const materials = new Map();   // материал → описание банка
    const strideState = new WeakMap();
    let fallback = 'concrete';
    const alias = { brick: 'concrete' };

    function sound() { return ($ && $.sound) || null; }

    const steps = {
        /**
         * Описать материалы: `{ wood: [...файлы], concrete: { files, pitch } }`.
         * Материал без своих звуков играет как `concrete`.
         */
        material(spec) {
            if (!spec || typeof spec !== 'object') return steps;
            for (const name of Object.keys(spec)) {
                const key = String(name);
                const files = Array.isArray(spec[name]) ? spec[name]
                    : (spec[name] && spec[name].files) || [];
                if (!files.length) continue;
                materials.set(key, Array.isArray(spec[name])
                    ? { files }
                    : Object.assign({ pitch: 0.06, avoids: 2 }, spec[name]));
            }
            return steps;
        },

        /** Материал по умолчанию (когда пол неизвестен). */
        fallback(name) {
            if (name === undefined) return fallback;
            fallback = String(name);
            return steps;
        },

        /** Какой материал звучит для имени (с учётом псевдонимов). */
        resolveMaterial(name) {
            const key = alias[String(name)] || String(name || '');
            return materials.has(key) ? key : (materials.has(fallback) ? fallback : null);
        },

        /** Есть ли звуки для материала. */
        hasMaterial(name) { return steps.resolveMaterial(name) !== null; },

        /** Имена описанных материалов. */
        materials() { return [...materials.keys()]; },

        /** Сыграть шаг: выбирает материал и файл, разбрасывает высоту. */
        play(what, opts) {
            const o = opts || {};
            const key = steps.resolveMaterial(o.material === undefined ? fallback : o.material);
            if (!key) return null;
            const spec = materials.get(key);
            const player = sound();
            if (!player) return null;
            const volume = (o.volume === undefined ? 1 : Number(o.volume)) * stepVolume(!!o.run, !!o.crouching);
            const pitch = (o.pitch === undefined ? 1 : Number(o.pitch))
                * (1 + (fxRandom() * 2 - 1) * (Number(spec.pitch) || 0));
            return player.play(spec.files[Math.floor(fxRandom() * spec.files.length) % spec.files.length],
                               { volume, pitch });
        },

        /** Приземление: свой набор файлов `land_<материал>_N`. */
        land(material, fallSpeed) {
            const key = steps.resolveMaterial(material);
            if (!key) return null;
            const spec = materials.get(key);
            const player = sound();
            if (!player) return null;
            // Файлы приземления описываются тем же материалом с суффиксом.
            const files = (spec.land && spec.land.length) ? spec.land : spec.files;
            const file = files[Math.floor(fxRandom() * files.length) % files.length];
            return player.play(file, {
                volume: landVolume(fallSpeed),
                pitch: 1 + (fxRandom() * 2 - 1) * 0.05,
            });
        },

        /**
         * Один тик шагов: считает путь и играет шаг, когда пора.
         * `what` — узел, обёртка или селектор; `state` — `{ onFloor, speed, landed }`.
         */
        tick(what, state, dt) {
            const node = resolveNode(what);
            if (!node) return false;
            const st = state || {};
            if (st.landed > 0) steps.land(st.material, st.landed);
            if (!st.onFloor) return false;
            let acc = strideState.get(node) || { acc: 0 };
            const result = advanceStride(acc, st.speed, dt);
            strideState.set(node, acc);
            if (!result.step) return false;
            steps.play(node, {
                material: st.material,
                run: result.run,
                crouching: st.crouching,
                volume: st.volume,
            });
            return true;
        },

        /** Забыть накопленный путь узла (телепорт, посадка в машину). */
        reset(what) {
            const node = resolveNode(what);
            if (node) strideState.set(node, { acc: 0 });
            return steps;
        },
    };

    $.steps = steps;
    ctx.steps = steps;
    return steps;
}

export function installBarks($) {
    const sets = new Map();        // набор → строки
    const recent = new Map();      // набор → последние строки
    let current = 'default';

    const barks = {
        /**
         * Описать набор реплик: `$.barks.define({ idle: [...], hurt: [...] })`
         * или `$.barks.define('guard', { idle: [...] })`.
         */
        define(nameOrLines, maybeLines) {
            const name = maybeLines === undefined ? current : String(nameOrLines);
            const lines = maybeLines === undefined ? nameOrLines : maybeLines;
            if (!lines || typeof lines !== 'object') {
                ctx.log('$.barks.define: нужен объект «ситуация → строки»');
                return null;
            }
            const clean = {};
            for (const sit of Object.keys(lines)) {
                const list = Array.isArray(lines[sit]) ? lines[sit] : [lines[sit]];
                clean[String(sit)] = list.map((line) => (typeof line === 'string' ? { t: line } : line));
            }
            sets.set(name, clean);
            if (maybeLines === undefined) current = name;
            return name;
        },

        /** Набор по умолчанию (если не назван). */
        use(name) {
            if (name === undefined) return current;
            current = String(name);
            return barks;
        },

        /** Загрузить наборы из JSON: `{ situations: {...} }` или сразу карта. */
        load(data, setName) {
            if (!data || typeof data !== 'object') return 0;
            const lines = data.situations || data.lines || data;
            return barks.define(setName === undefined ? current : setName, lines) ? 1 : 0;
        },

        /**
         * Реплика для ситуации: `$.barks.pick('idle', { type, madness, set })`.
         * Возвращает строку или '' (нечего сказать).
         */
        pick(situation, opts) {
            const spec = opts || {};
            const name = spec.set === undefined ? current : String(spec.set);
            const set = sets.get(name);
            if (!set) return '';
            const pool = set[String(situation)] || [];
            if (!recent.has(name)) recent.set(name, []);
            return pickBark(pool, {
                psychotype: spec.type,
                madness: spec.madness,
                recent: recent.get(name),
                keep: spec.keep,
                rng: spec.rng,
            });
        },

        /** Все ситуации набора. */
        situations(setName) {
            const set = sets.get(setName === undefined ? current : String(setName));
            return set ? Object.keys(set) : [];
        },

        /** Имена наборов. */
        names() { return [...sets.keys()]; },

        /** Сбросить память о недавних репликах (новый разговор, смена сцены). */
        reset(setName) {
            if (setName === undefined) recent.clear();
            else recent.delete(String(setName));
            return barks;
        },

        /** Сколько строк в ситуации. */
        count(situation, setName) {
            const set = sets.get(setName === undefined ? current : String(setName));
            return set && set[String(situation)] ? set[String(situation)].length : 0;
        },
    };

    $.barks = barks;
    ctx.barks = barks;
    return barks;
}

/** Узел по имени, обёртке или селектору. */
function resolveNode(what) {
    if (!what) return null;
    if (typeof what === 'string') return query(what)[0] || null;
    if (what.nodes) return what.nodes[0] || null;
    const node = what.node || what;
    return node && node.tag ? node : null;
}
