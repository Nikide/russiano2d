// ===========================================================================
// Банки звуков — $.sound.bank
//
// Порт из audm-neko (game/sound/sound_bank.gd, sound_bank_v2.gd, footsteps.gd).
// В оригинале звук почти никогда не был одним файлом: у шага шесть вариаций,
// у удара — несколько, и один и тот же файл подряд слышится как «щёлк-щёлк»
// одинаковых щелчков. Банк решает три задачи:
//
//   * ВАРИАЦИИ: выбрать один из файлов, не повторяя предыдущий;
//   * ЖИВОСТЬ: сдвинуть высоту и громкость на несколько процентов;
//   * ТЕМП: не играть чаще, чем раз в `interval` секунд.
//
//   $.sound.bank('step.concrete', ['steps/concrete_0.wav', 'steps/concrete_1.wav', …]);
//   $.sound.playBank('step.concrete', { pitch: 0.06, volume: 0.1 });
//
//   $.sound.bank('hit', {
//       files: ['sfx/hit_a.wav', 'sfx/hit_b.wav'],
//       volume: [0.8, 1.0],      // диапазон громкости
//       pitch: 0.08,             // ±8% высоты
//       interval: 0.04,          // не чаще 25 раз в секунду
//       avoids: 2,               // не повторять два последних файла
//   });
//
// Банк — тонкая обёртка: он не грузит звук сам, а зовёт `$.sound.play`, поэтому
// приглушение, панорама и каналы остаются общими. Чистая часть (выбор файла)
// проверяется юнит-тестом без движка.
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть
// ---------------------------------------------------------------------------

/** Список файлов из описания банка: массив, строка или `{ files }`. */
export function bankFiles(spec) {
    if (Array.isArray(spec)) return spec.map(String);
    if (typeof spec === 'string') return [spec];
    if (spec && Array.isArray(spec.files)) return spec.files.map(String);
    if (spec && typeof spec.files === 'string') return [spec.files];
    return [];
}

/**
 * Выбор файла банка: не повторяет последние `avoids`, уважает вес.
 * `history` — массив уже сыгранных имён (последнее в конце), он же мутируется.
 */
export function pickBankFile(files, history, avoids, rng) {
    if (!Array.isArray(files) || files.length === 0) return null;
    const avoid = Math.max(0, Math.min(Number(avoids) || 0, files.length - 1));
    let pool = files;
    if (avoid > 0 && files.length > 1) {
        const recent = history.slice(-avoid);
        const filtered = files.filter((f) => !recent.includes(f));
        if (filtered.length) pool = filtered;
    }
    let chosen;
    if (typeof rng === 'function') {
        chosen = pool[Math.floor(rng() * pool.length) % pool.length];
    } else {
        // Без генератора выбор ДЕТЕРМИНИРОВАН: функция чистая, и «случайный по
        // умолчанию» означал бы, что один и тот же вызов даёт разные
        // результаты — тест такого не проверит, а реплей разойдётся.
        chosen = pool[history ? history.length % pool.length : 0];
    }
    if (history) {
        history.push(chosen);
        const keep = Math.max(1, avoid) + 1;
        while (history.length > keep) history.shift();
    }
    return chosen;
}

/** Громкость банка: число, диапазон `[min, max]` или одна пара. */
export function bankVolume(spec, rng) {
    const raw = spec && spec.volume;
    // Без генератора берём НИЖНЮЮ границу диапазона: воспроизводимо и
    // предсказуемо. Нужен разброс — передайте fxRandom.
    const random = typeof rng === 'function' ? rng : () => 0;
    if (Array.isArray(raw)) {
        const lo = Number(raw[0]);
        const hi = Number(raw[1] === undefined ? raw[0] : raw[1]);
        if (!Number.isFinite(lo)) return 1;
        return Number.isFinite(hi) && hi !== lo ? lo + (hi - lo) * random() : lo;
    }
    if (typeof raw === 'number') return raw;
    return 1;
}

/**
 * Высота банка: `pitch` — доля разброса (0.06 = ±6%), либо диапазон.
 * Возвращает множитель: 1.0 — без сдвига.
 */
export function bankPitch(spec, rng) {
    const raw = spec && spec.pitch;
    const random = typeof rng === 'function' ? rng : () => 0;
    if (Array.isArray(raw)) {
        const lo = Number(raw[0]);
        const hi = Number(raw[1] === undefined ? raw[0] : raw[1]);
        if (!Number.isFinite(lo)) return 1;
        return lo + ((Number.isFinite(hi) ? hi : lo) - lo) * random();
    }
    const spread = Number(raw);
    if (!Number.isFinite(spread) || spread === 0) return 1;
    return 1 + (random() * 2 - 1) * spread;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installSoundBank($) {
    const banks = new Map();   // имя → { spec, files, history, last }

    function sound() {
        return ($ && $.sound) || ctx.sound || null;
    }

    function now() {
        if (ctx.time && typeof ctx.time.now === 'function') return ctx.time.now();
        return typeof engine.time === 'number' ? engine.time : 0;
    }

    const bank = {
        /** Описать банк: имя и список файлов (или объект с настройками). */
        define(name, filesOrSpec) {
            const key = String(name);
            const spec = Array.isArray(filesOrSpec) || typeof filesOrSpec === 'string'
                ? { files: filesOrSpec }
                : (filesOrSpec || {});
            const files = bankFiles(spec);
            if (!files.length) {
                ctx.log(`$.sound.bank("${key}"): нужен список файлов`);
                return null;
            }
            banks.set(key, { spec, files, history: [], last: -Infinity });
            return key;
        },

        /** Есть ли банк. */
        has(name) { return banks.has(String(name)); },

        /** Имена банков. */
        names() { return [...banks.keys()]; },

        /** Файлы банка (или пустой массив). */
        files(name) {
            const entry = banks.get(String(name));
            return entry ? entry.files.slice() : [];
        },

        /** Забыть банк. */
        remove(name) { return banks.delete(String(name)); },

        /**
         * Сыграть из банка: выбирает файл, разбрасывает высоту и громкость,
         * соблюдает интервал. Возвращает имя файла или null (если не сыграно).
         */
        play(name, opts) {
            const key = String(name);
            const entry = banks.get(key);
            if (!entry) {
                ctx.log(`$.sound.bank: нет банка "${key}"`);
                return null;
            }
            const o = opts || {};
            const time = now();
            const interval = Number(o.interval === undefined ? entry.spec.interval : o.interval) || 0;
            if (interval > 0 && time - entry.last < interval) return null;
            const file = pickBankFile(entry.files, entry.history, entry.spec.avoids, o.rng);
            if (!file) return null;
            entry.last = time;

            const volume = bankVolume(entry.spec, o.rng) * (o.volume === undefined ? 1 : Number(o.volume));
            const pitch = bankPitch(entry.spec, o.rng) * (o.pitch === undefined ? 1 : Number(o.pitch));
            const player = sound();
            if (!player || typeof player.play !== 'function') return file;
            const channel = player.play(file, Object.assign({}, o, { volume, pitch }));
            if (o.onPlayed && typeof o.onPlayed === 'function') o.onPlayed(file, channel);
            return file;
        },

        /** Последний сыгранный файл банка (для отладки). */
        lastPlayed(name) {
            const entry = banks.get(String(name));
            return entry && entry.history.length ? entry.history[entry.history.length - 1] : null;
        },

        /** Сбросить историю повторов (например, после смены сцены). */
        reset(name) {
            if (name === undefined) {
                for (const entry of banks.values()) { entry.history.length = 0; entry.last = -Infinity; }
                return bank;
            }
            const entry = banks.get(String(name));
            if (entry) { entry.history.length = 0; entry.last = -Infinity; }
            return bank;
        },

        /** Загрузить пачку банков из объекта: `{ 'step.wood': [...] }`. */
        load(data) {
            if (!data || typeof data !== 'object') return 0;
            const source = data.banks && typeof data.banks === 'object' ? data.banks : data;
            let count = 0;
            for (const name of Object.keys(source)) {
                if (bank.define(name, source[name])) count++;
            }
            return count;
        },
    };

    // Публичные части живут в $.sound: банк — его расширение, не отдельная
    // подсистема (звук один, и настройки у него общие).
    const target = ($ && $.sound) || null;
    if (target) {
        // `$.sound.banks` уже занято списком обычных звуков? Нет — там его нет;
        // но имена банков и звуков лучше не путать, поэтому отдельные методы:
        //   $.sound.defineBank('step.wood', [...]) / $.sound.playBank('step.wood')
        target.defineBank = (name, files) => bank.define(name, files);
        target.playBank = (name, opts) => bank.play(name, opts);
        target.bankNames = () => bank.names();
        target.bankFiles = (name) => bank.files(name);
        target.bank = bank;
    }
    ctx.soundBank = bank;
    return bank;
}
