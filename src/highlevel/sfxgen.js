// ===========================================================================
// $.sfxgen — процедурные звуковые эффекты: описание → дескриптор → синтез → WAV.
//
// Ядро синтеза — C (src/sfxgen.c, алгоритм sfxr, параметры как у rFXGen); здесь только API:
//   $.sfxgen.preset('coin', { seed: 3 })          // дескриптор из пресета
//   $.sfxgen.describe('короткий высокий прыжок')  // слова → { preset, params }
//   $.sfxgen.render(params, 'assets/sfx/jump.wav') // записать WAV
//   $.sfxgen.play('coin')                          // сгенерировать (кэш) и сыграть
//   $.sfxgen.bank('step', ['jump', { preset: 'blip', seed: 2 }])   // банк вариантов для $.sfx.play
//
// Генерация детерминирована: один дескриптор — один и тот же WAV, поэтому результат кэшируется по
// содержимому дескриптора (каталог `$.sfxgen.cacheDir()`, по умолчанию `sfxgen_cache`).
// Модуль импортируется без движка: обращений к engine на верхнем уровне нет.
// ===========================================================================

import { engine } from './native.js';

/** Имена полей дескриптора (порядок — как в справке). */
export const FIELDS = [
    'attack', 'sustain', 'punch', 'decay', 'freq', 'minFreq', 'slide', 'deltaSlide', 'vibratoDepth', 'vibratoSpeed',
    'changeAmount', 'changeSpeed', 'duty', 'dutySweep', 'repeat', 'phaserOffset', 'phaserSweep',
    'lpf', 'lpfSweep', 'lpfResonance', 'hpf', 'hpfSweep', 'volume',
];
export const WAVES = ['square', 'saw', 'sine', 'noise'];

function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

/** Стабильный хеш строки (FNV-1a), 8 hex — имя файла в кэше. */
export function hashText(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** Каноническая запись дескриптора: фиксированный порядок полей — одинаковый хеш для одинаковых звуков. */
export function canonical(params) {
    const out = [String(params.wave), params.seed >>> 0];
    for (const key of FIELDS) out.push(Math.round((Number(params[key]) || 0) * 1e5) / 1e5);
    return JSON.stringify(out);
}

/** Проверка и очистка переопределений: неизвестные поля — ошибка, а не молчание. */
export function checkOverrides(over, where) {
    if (!over) return {};
    const out = {};
    for (const key of Object.keys(over)) {
        if (key === 'wave') {
            if (!WAVES.includes(over.wave) && !(Number.isInteger(over.wave) && over.wave >= 0 && over.wave <= 3)) {
                fail('R2D_SFXGEN_BAD_FIELD', `${where}: wave — ${WAVES.join(', ')}`);
            }
        } else if (key !== 'seed' && !FIELDS.includes(key)) {
            fail('R2D_SFXGEN_BAD_FIELD', `${where}: нет поля «${key}» (есть: wave, ${FIELDS.join(', ')}, seed)`);
        } else if (typeof over[key] !== 'number' || Number.isNaN(over[key])) {
            fail('R2D_SFXGEN_BAD_FIELD', `${where}: поле «${key}» — число`);
        }
        out[key] = over[key];
    }
    return out;
}

/** Подсистема `$.sfxgen`. `getNative` подменяется в юнит-тестах. */
export function createSfxgen(api, getNative) {
    let cache = 'sfxgen_cache';
    const native = () => {
        const n = getNative();
        if (!n) fail('R2D_SFXGEN_UNAVAILABLE', '$.sfxgen: движок собран без синтезатора звуков (engine.sfxgen нет)');
        return n;
    };

    /** Строка (пресет или слова) | объект ({ preset|text, seed, ...поля } или готовый дескриптор) → дескриптор. */
    function resolve(spec, seed) {
        const n = native();
        if (typeof spec === 'string') {
            const byName = n.preset(spec, seed || 1);
            if (byName) return byName;
            const byText = n.text(spec, seed || 1);
            if (byText) return byText.params;
            fail('R2D_SFXGEN_UNKNOWN', `$.sfxgen: «${spec}» — не пресет (${n.presets().join(', ')}) и не описание звука; назовите тип: монета, выстрел, взрыв, бонус, удар, прыжок, клик`);
        }
        if (!spec || typeof spec !== 'object') fail('R2D_SFXGEN_UNKNOWN', '$.sfxgen: нужен пресет, описание словами или объект-дескриптор');
        const { preset, text, ...rest } = spec;
        const over = checkOverrides(rest, '$.sfxgen');
        let base;
        if (preset !== undefined) {
            base = n.preset(String(preset), over.seed || seed || 1);
            if (!base) fail('R2D_SFXGEN_UNKNOWN', `$.sfxgen: нет пресета «${preset}» (есть: ${n.presets().join(', ')})`);
        } else if (text !== undefined) {
            const t = n.text(String(text), over.seed || seed || 1);
            if (!t) fail('R2D_SFXGEN_UNKNOWN', `$.sfxgen: не понял описание «${text}»`);
            base = t.params;
        } else {
            base = n.defaults();
        }
        return Object.assign(base, over);
    }

    const sfxgen = {
        /** Имена пресетов. */
        presets() { return native().presets(); },
        /** Дескриптор по умолчанию. */
        defaults() { return native().defaults(); },
        /** Дескриптор из пресета: `preset('coin', { seed: 3, decay: 0.2 })`. */
        preset(name, opts) {
            const over = checkOverrides(opts, '$.sfxgen.preset');
            const base = native().preset(String(name), over.seed || 1);
            if (!base) fail('R2D_SFXGEN_UNKNOWN', `$.sfxgen.preset: нет «${name}» (есть: ${native().presets().join(', ')})`);
            return Object.assign(base, over);
        },
        /** Слова → `{ preset, params }` или `null`, если тип звука не опознан. */
        describe(text, seed) { return native().text(String(text), seed || 1); },
        /** Лёгкая вариация дескриптора. */
        mutate(params, seed, amount) { return native().mutate(params, seed || 1, amount === undefined ? 0.1 : amount); },
        /** Дескриптор из чего угодно (строка, объект). */
        resolve(spec, seed) { return resolve(spec, seed); },
        /** Посчитать звук; с `path` — записать WAV. → { samples, seconds, peak, rms, clipped, pitchHz, path? }. */
        render(spec, path) { return native().render(resolve(spec), path); },
        /** Каталог кэша сгенерированных файлов. */
        cacheDir(dir) {
            if (dir !== undefined) cache = String(dir).replace(/\/+$/, '') || 'sfxgen_cache';
            return cache;
        },
        /** Сгенерировать WAV в кэш (если ещё нет) → путь файла. */
        make(spec, seed) {
            const params = resolve(spec, seed);
            const path = `${cache}/sfx_${hashText(canonical(params))}.wav`;
            if (!(api.fs && api.fs.exists(path))) native().render(params, path);
            return path;
        },
        /** Сгенерировать и сыграть: `play('coin', { volume: 0.8 })`. */
        play(spec, opts) {
            const path = sfxgen.make(spec, opts && opts.seed);
            return api.sound.play(path, opts);
        },
        /** Банк вариантов для `$.sfx.play(name)`: `bank('step', ['blip', { preset: 'blip', seed: 2 }])`. */
        bank(name, specs) {
            if (!Array.isArray(specs) || !specs.length) fail('R2D_SFXGEN_UNKNOWN', '$.sfxgen.bank: нужен непустой список описаний звуков');
            const files = specs.map((s, i) => sfxgen.make(s, typeof s === 'string' ? i + 1 : undefined));
            return api.sfx.bank(name, files);
        },
    };
    return sfxgen;
}

/** Установка `$.sfxgen`. */
export function installSfxgen($) {
    $.sfxgen = createSfxgen($, () => (engine && engine.sfxgen) || null);
}
