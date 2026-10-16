// ===========================================================================
// Реплеи: запись ввода и воспроизведение — $.replay
//
// Зачем в движке: детерминизм уже есть (`--seed` + `--fixed-dt` + свои
// генераторы из `$.random`), но записать и проиграть сессию было нечем.
// Реплей превращает баг-репорт в одну строку данных, а регресс-тест — в
// «проиграй запись и проверь, что мир пришёл туда же».
//
//   $.replay.start();                        // начали запись
//   $.update(() => $.replay.record($.input.state()));   // каждый кадр
//   $.replay.stop();                          // записали
//   const text = $.replay.toText();           // сохранили в файл
//
//   $.replay.fromText(text);                  // загрузили
//   $.replay.play();                          // проигрываем
//   $.update(() => $.input.apply($.replay.tick()));     // ввод из записи
//
// §26: заголовок записи — это паспорт прогона. В нём engine/build ID,
// content-версии, schema, seed и streams RNG, fixed step и версия input
// mapping. Ввод пишется на уровне разрешённых actions (raw — дополнительно,
// для диагностики). Проверки state hashes выполняются в заданных simulation
// ticks, а расхождение отдаётся структурой: первый расходящийся tick, поля и
// IDs, версии. Hash не включает настенные часы, GPU-ресурсы и
// presentation-only значения, а потребление presentation-потока RNG на
// расхождение не влияет.
//
// ЧЕСТНО О ГРАНИЦАХ: реплей воспроизводит РОВНО то, что игра записала в
// `record()`. Если состояние зависит от чего-то, что не в записи (настенные
// часы, сеть, положение мыши), воспроизведение разойдётся — движок об этом
// предупреждает структурой divergence(), а не молчит.
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';
import { hashCells, PRESENTATION_STREAMS } from './random.js';

/** Предел записи: 10 минут при 60 к/с. Дальше предупреждаем и останавливаемся. */
export const MAX_FRAMES = 36000;
/** Предел размера одного кадра ввода: защита от записи всего мира в реплей. */
export const MAX_FRAME_BYTES = 4096;
/** Схема и версия формата записи (§26). */
export const REPLAY_SCHEMA = 'r2d.replay';
export const REPLAY_VERSION = 2;
/** Сколько checkpoints state hash хранится в записи (первое расхождение — важнее). */
export const MAX_CHECKPOINTS = 1024;
/** Сколько полей показывает divergence report. */
export const MAX_DIVERGENCE_FIELDS = 24;

/** Потоки RNG, которые НЕ влияют на gameplay-расхождение (§26).
 *  Список живёт рядом с самим генератором (random.js): его читают и реплей,
 *  и сейв, а две копии списка разошлись бы. */
export { PRESENTATION_STREAMS };

function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function num(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    return isFinite(n) ? n : fallback;
}

/**
 * Канонический заголовок записи: поля всегда на месте, порядок фиксирован.
 * Заголовок — паспорт прогона, поэтому его читает и человек, и CI.
 */
export function normalizeReplayHead(raw) {
    const src = plainObject(raw) ? raw : {};
    const input = plainObject(src.input) ? src.input : {};
    const engineId = plainObject(src.engine) ? src.engine : {};
    // Поля игры (уровень, сложность, любые скалярные метки) сохраняем как
    // есть: заголовок — паспорт прогона, и игра вправе положить туда своё.
    const out = {};
    for (const key of Object.keys(src)) {
        const value = src[key];
        if (value === null || typeof value === 'number' || typeof value === 'string'
            || typeof value === 'boolean') out[key] = value;
    }
    out.schema = REPLAY_SCHEMA;
    out.version = REPLAY_VERSION;
    out.engine = {
        version: engineId.version === undefined ? null : String(engineId.version),
        build: engineId.build === undefined ? null : String(engineId.build),
    };
    out.content = plainObject(src.content) ? src.content : {};
    out.seed = num(src.seed, 0);
    out.dt = num(src.dt, 0);
    out.frame = Math.floor(num(src.frame, 0));
    out.streams = plainObject(src.streams) ? src.streams : null;
    out.input = {
        mapping: input.mapping === undefined ? null : String(input.mapping),
        actions: Array.isArray(input.actions) ? input.actions.map(String) : null,
    };
    return out;
}

/**
 * Хэш gameplay-состояния из пар «метка → значение». Метки нужны, чтобы
 * divergence report назвал поля, а не только «не совпало» (§26).
 * `values` — числа/строки в фиксированном порядке.
 */
export function hashOfValues(values) {
    return hashCells(values);
}

/**
 * Заголовок «из будущего» или чужой схемы: запись не грузим, а объясняем.
 * Возвращает null (можно грузить) или текст причины.
 */
export function replayHeadProblem(header) {
    const src = plainObject(header) ? header : {};
    if (src.schema !== undefined && src.schema !== REPLAY_SCHEMA) {
        return `схема записи "${src.schema}" не поддерживается (нужна "${REPLAY_SCHEMA}")`;
    }
    const version = num(src.version, REPLAY_VERSION);
    if (version > REPLAY_VERSION) {
        return `версия записи ${version} новее поддерживаемой (${REPLAY_VERSION})`;
    }
    if (version < 1) return `версия записи ${version} не поддерживается`;
    return null;
}

/**
 * Чистое ядро реплея: запись, воспроизведение, checkpoints state hash и текст.
 *
 * `header` — то, без чего воспроизведение не совпадёт: ID движка, content,
 * schema, зерно, streams RNG, шаг времени и версия input mapping.
 * `hooks` — то, что доступно только в движке: `{ stateSnapshot, log }`.
 */
export function createReplay(header, hooks) {
    const h = hooks || {};
    let head = normalizeReplayHead(header);
    const frames = [];              // [{ f, d, a }] — по возрастанию номера кадра
    let mode = 'idle';              // idle | recording | playing
    let cursor = 0;                 // сколько кадров уже проиграно
    let dropped = 0;                // сколько кадров не записали (переполнение/размер)
    let unknown_actions = 0;        // сколько действий не из разрешённого списка
    let lastFrame = -1;

    // Checkpoints: на заданных ticks пишем hash и компактный снимок полей.
    let check_every = 0;
    let check_max = MAX_CHECKPOINTS;
    let check_truncated = false;
    const checks = [];              // [{ tick, hash, l: [labels], v: [values] }]
    let divergence = null;          // первое расхождение при проигрывании

    function log(message) {
        if (typeof h.log === 'function') h.log(message);
        else ctx.log(message);
    }

    function dataOf(value) {
        if (value === undefined || value === null) return null;
        if (typeof value === 'string') return value;
        try {
            const text = JSON.stringify(value);
            if (text && text.length > MAX_FRAME_BYTES) return null;   // слишком жирно
            return text;
        } catch (e) {
            return null;                 // циклический объект — записать нельзя
        }
    }

    /**
     * Кадр ввода → запись. Если объявлены разрешённые actions (§26), кадр
     * хранится как `{ a: [...] }`, а незнакомые действия отсекаются со
     * счётчиком: запись не должна ломаться от одного нового действия.
     * Возвращает `{ d, a }` — сериализованные данные и список действий.
     */
    function normalizeFrame(value) {
        const allowed = head.input && Array.isArray(head.input.actions) ? head.input.actions : null;
        if (allowed && Array.isArray(value)) {
            const actions = [];
            for (const name of value) {
                if (allowed.indexOf(String(name)) >= 0) actions.push(String(name));
                else unknown_actions++;
            }
            return { d: dataOf({ a: actions }), a: actions };
        }
        if (allowed && plainObject(value) && Array.isArray(value.actions)) {
            const actions = [];
            for (const name of value.actions) {
                if (allowed.indexOf(String(name)) >= 0) actions.push(String(name));
                else unknown_actions++;
            }
            const payload = { a: actions };
            if (value.raw !== undefined) payload.r = value.raw;
            return { d: dataOf(payload), a: actions };
        }
        return { d: dataOf(value), a: null };
    }

    /**
     * Кадр в том виде, в каком его увидит `apply`: и при записи, и при
     * проигрывании форма одна. Для режима actions — `{ actions, raw }`.
     */
    function forApply(value) {
        const allowed = head.input && Array.isArray(head.input.actions) ? head.input.actions : null;
        if (allowed) {
            if (Array.isArray(value)) return { actions: value.map(String), raw: null };
            if (plainObject(value) && Array.isArray(value.actions)) {
                return { actions: value.actions.map(String), raw: value.raw === undefined ? null : value.raw };
            }
        }
        if (plainObject(value) && Array.isArray(value.a)) {
            // Разобранный кадр записи (проигрывание): та же форма, что при записи.
            return { actions: value.a.slice(), raw: value.r === undefined ? null : value.r };
        }
        return value;
    }

    function push(value, f) {
        const norm = normalizeFrame(value);
        // Пустой кадр тоже надо записать: пропуск сломает соответствие
        // «кадр записи ↔ кадр проигрывания».
        frames.push({ f, d: norm.d, a: norm.a });
        lastFrame = f;
        return true;
    }

    /** Снять checkpoint на этом tick (если политика задана). */
    function noteState(tick) {
        if (!(check_every > 0) || typeof h.stateSnapshot !== 'function') return null;
        const t = Math.floor(num(tick, lastFrame));
        if (t % check_every !== 0) return null;
        if (checks.length >= check_max) { check_truncated = true; return null; }
        const snap = h.stateSnapshot();
        if (!snap || !Array.isArray(snap.values)) return null;
        const entry = {
            tick: t,
            hash: hashOfValues(snap.values),
            l: Array.isArray(snap.labels) ? snap.labels.slice() : [],
            v: snap.values.slice(),
        };
        checks.push(entry);
        return entry;
    }

    /** Сравнить текущее состояние с записанным на этом tick. */
    function verifyAt(tick) {
        if (divergence) return divergence;              // первое расхождение важнее
        if (!checks.length || typeof h.stateSnapshot !== 'function') return null;
        const t = Math.floor(num(tick, lastFrame));
        let rec = null;
        for (const c of checks) if (c.tick === t) { rec = c; break; }
        if (!rec) return null;
        const snap = h.stateSnapshot();
        if (!snap || !Array.isArray(snap.values)) return null;
        const actual = hashOfValues(snap.values);
        if (actual === rec.hash) return { ok: true, tick: t, hash: actual };
        const fields = [];
        const ids = [];
        const actualMap = new Map();
        for (let i = 0; i < snap.values.length; i++) {
            const label = Array.isArray(snap.labels) ? snap.labels[i] : ('#' + i);
            actualMap.set(String(label), snap.values[i]);
        }
        for (let i = 0; i < rec.l.length; i++) {
            const label = String(rec.l[i]);
            const want = rec.v[i];
            const got = actualMap.get(label);
            actualMap.delete(label);          // одинаковые поля не «лишние»
            if (got === undefined || got !== want) {
                if (fields.length >= MAX_DIVERGENCE_FIELDS) continue;
                fields.push({ field: label, expected: want, actual: got === undefined ? null : got });
                const id = label.split('.')[0];
                if (ids.indexOf(id) < 0) ids.push(id);
            }
        }
        if (fields.length < MAX_DIVERGENCE_FIELDS) {
            for (const [label, got] of actualMap) {
                fields.push({ field: label, expected: null, actual: got });
                const id = label.split('.')[0];
                if (ids.indexOf(id) < 0) ids.push(id);
                if (fields.length >= MAX_DIVERGENCE_FIELDS) break;
            }
        }
        divergence = {
            ok: false,
            tick: t,
            expected: rec.hash,
            actual,
            fields,
            ids,
            versions: {
                schema: REPLAY_SCHEMA,
                replay: REPLAY_VERSION,
                engine: head.engine,
                rng: head.streams ? { algorithm: head.streams.algorithm, version: head.streams.version } : null,
            },
            content: head.content,
        };
        return divergence;
    }

    const replay = {
        /** Начать запись: старый реплей стирается. */
        start(extra) {
            head = normalizeReplayHead(Object.assign({}, header || {}, extra || {}));
            frames.length = 0;
            checks.length = 0;
            check_truncated = false;
            divergence = null;
            unknown_actions = 0;
            dropped = 0;
            cursor = 0;
            lastFrame = -1;
            mode = 'recording';
            return replay;
        },

        /** Остановить запись или воспроизведение. */
        stop() {
            if (mode === 'recording') {
                head.frames = frames.length;
                head.checkpoints = { every: check_every, count: checks.length, truncated: check_truncated };
            }
            mode = 'idle';
            return replay;
        },

        /**
         * Записать ввод кадра. `frame` по умолчанию — номер кадра движка
         * (`engine.frame`), но его можно задать явно (тесты, свои часы).
         */
        record(value, frame, tick) {
            if (mode !== 'recording') return false;
            const f = Math.floor(Number(frame !== undefined ? frame
                                                          : (ctx.engineFrame ? ctx.engineFrame() : 0)) || 0);
            if (frames.length >= MAX_FRAMES) {
                dropped++;
                if (dropped === 1) log('$.replay: запись достигла предела ' + MAX_FRAMES + ' кадров');
                return false;
            }
            const ok = push(value, f);
            noteState(tick === undefined ? f : tick);
            return ok;
        },

        /**
         * Записать кадр, минуя проверку режима. Внутреннее: публичный
         * `record` — это «запись из коробки» с обвязкой (см. installReplay), и
         * если бы хук звал его, он бы принял сборщик ввода за ввод.
         */
        _push(value, frame, tick) {
            if (mode !== 'recording') return false;
            const f = Math.floor(Number(frame) || 0);
            if (frames.length >= MAX_FRAMES) { dropped++; return false; }
            const ok = push(value, f);
            // Checkpoint считается по УСЛОВНОМУ tick (номер кадра от начала
            // записи): в новом процессе номер кадра снова с нуля, и проверка
            // обязана совпасть с той же точкой прогона.
            noteState(tick === undefined ? f : tick);
            return ok;
        },

        /** Загрузить реплей из структуры (или текста). */
        load(data) {
            let obj = data;
            if (typeof data === 'string') {
                try { obj = JSON.parse(data); } catch (e) {
                    log('$.replay.load: не разобрал JSON — ' + e);
                    return false;
                }
            }
            if (!obj || !Array.isArray(obj.frames)) {
                log('$.replay.load: нужен объект с полем frames');
                return false;
            }
            const problem = replayHeadProblem(obj.header);
            if (problem) {
                log('$.replay.load: ' + problem);
                return false;
            }
            head = normalizeReplayHead(obj.header);
            frames.length = 0;
            for (const item of obj.frames) {
                if (Array.isArray(item)) {
                    frames.push({ f: item[0] | 0, d: item[1] === undefined ? null : item[1], a: null });
                } else {
                    const d = item.d === undefined ? null : item.d;
                    let a = null;
                    if (d && typeof d === 'string' && d[0] === '{') {
                        try { const parsed = JSON.parse(d); if (parsed && Array.isArray(parsed.a)) a = parsed.a; }
                        catch (e) { a = null; }
                    }
                    frames.push({ f: item.f | 0, d, a });
                }
            }
            checks.length = 0;
            for (const c of (Array.isArray(obj.checks) ? obj.checks : [])) {
                if (!c || c.tick === undefined) continue;
                checks.push({
                    tick: Math.floor(num(c.tick, 0)),
                    hash: c.hash,
                    l: Array.isArray(c.l) ? c.l.slice() : [],
                    v: Array.isArray(c.v) ? c.v.slice() : [],
                });
            }
            check_every = head.checkpoints && head.checkpoints.every ? head.checkpoints.every : 0;
            check_truncated = !!(head.checkpoints && head.checkpoints.truncated);
            divergence = null;
            dropped = 0;
            unknown_actions = 0;
            cursor = 0;
            replay._index = null;
            mode = 'idle';
            return true;
        },

        /** Начать воспроизведение. `from` — кадр, с которого начать. */
        play(from) {
            cursor = Math.max(0, Math.floor(Number(from) || 0));
            mode = frames.length ? 'playing' : 'idle';
            return replay;
        },

        /**
         * Кадр воспроизведения: вернуть ввод текущего кадра и перейти к
         * следующему. Возвращает `null`, когда запись кончилась (или разбор
         * уже закончен — тогда режим снимается сам).
         */
        tick() {
            if (mode !== 'playing') return null;
            if (cursor >= frames.length) {
                mode = 'idle';
                if (typeof replay.onEnd === 'function') replay.onEnd();
                return null;
            }
            const item = frames[cursor++];
            if (cursor >= frames.length) {
                // Последний кадр отдаём и сразу закрываем режим.
                queueMicrotask(() => {
                    if (mode === 'playing' && cursor >= frames.length) {
                        mode = 'idle';
                        if (typeof replay.onEnd === 'function') replay.onEnd();
                    }
                });
            }
            return item.d === null ? null : item.d;
        },

        /** Пропустить `count` кадров (перемотка вперёд без проигрывания). */
        skip(count) {
            cursor = Math.min(frames.length, cursor + Math.max(0, Math.floor(Number(count) || 0)));
            return cursor;
        },

        /**
         * Политика проверки state hash: `checkpoints({ every: 60 })` — сверять
         * состояние каждые 60 simulation ticks. `stateSnapshot` приходит из
         * installReplay (движок) или задаётся игрой.
         */
        checkpoints(opts) {
            const o = plainObject(opts) ? opts : {};
            check_every = Math.max(0, Math.floor(num(o.every, 0)));
            check_max = Math.max(1, Math.floor(num(o.max, MAX_CHECKPOINTS)));
            if (o.snapshot !== undefined) replay.stateProvider(o.snapshot);
            return replay;
        },

        /** Провайдер состояния: `() => ({ labels, values })`. */
        stateProvider(fn) {
            h.stateSnapshot = typeof fn === 'function' ? fn : null;
            return replay;
        },

        /** Проверить состояние на текущем (или заданном) tick. */
        verifyState(tick) { return verifyAt(tick); },

        /**
         * Кадр в форме, которую получает `apply` (одна и та же при записи и
         * проигрывании): для режима actions — `{ actions, raw }`.
         */
        forApply(value) { return forApply(value); },

        /** Первое расхождение при проигрывании или null. */
        divergence() { return divergence; },

        /** Записанные checkpoints (копия: tick и hash). */
        checkpointsList() { return checks.map((c) => ({ tick: c.tick, hash: c.hash })); },

        /** Checkpoint целиком, с метками и значениями — для тестов и отладки. */
        checkpointAt(tick) {
            const t = Math.floor(Number(tick) || 0);
            for (const c of checks) {
                if (c.tick === t) return { tick: c.tick, hash: c.hash, labels: c.l.slice(), values: c.v.slice() };
            }
            return null;
        },

        /** Сколько действий не прошло по списку разрешённых. */
        unknownActions() { return unknown_actions; },

        /** Текущий режим: 'idle' | 'recording' | 'playing'. */
        mode() { return mode; },
        isRecording() { return mode === 'recording'; },
        isPlaying() { return mode === 'playing'; },

        /** Сколько кадров в записи. */
        length() { return frames.length; },
        /** Сколько кадров проиграно (курсор). */
        position() { return cursor; },
        /** Сколько кадров не записались (переполнение или слишком большой ввод). */
        dropped() { return dropped; },
        /** Заголовок записи: паспорт прогона (§26). */
        header() { return JSON.parse(JSON.stringify(head)); },

        /** Кадр по индексу записи: `{ f, d, a }` (или null). */
        at(index) {
            const i = Math.floor(Number(index) || 0);
            return i >= 0 && i < frames.length
                ? { f: frames[i].f, d: frames[i].d, a: frames[i].a } : null;
        },

        /** Кадры (копия) — для своих форматов и проверок. */
        frames() { return frames.map((x) => ({ f: x.f, d: x.d, a: x.a })); },

        /** Текст для файла: компактный JSON с заголовком и checkpoints. */
        toText() {
            const headOut = Object.assign({}, head, { frames: frames.length,
                checkpoints: { every: check_every, count: checks.length, truncated: check_truncated } });
            return JSON.stringify({
                header: headOut,
                frames: frames.map((x) => [x.f, x.d]),
                checks: checks.map((c) => ({ tick: c.tick, hash: c.hash, l: c.l, v: c.v })),
            });
        },

        /** Сколько байт займёт текст (прикидка для сохранения). */
        size() { return replay.toText().length; },

        clear() {
            frames.length = 0;
            checks.length = 0;
            cursor = 0;
            dropped = 0;
            unknown_actions = 0;
            divergence = null;
            mode = 'idle';
            replay._index = null;
            return replay;
        },
    };
    return replay;
}

/**
 * Сравнить две записи: совпадают ли кадры (для проверки «реплей воспроизвёлся»).
 * Возвращает `{ same, count, first }` — номер первого расхождения или -1.
 */
export function compareReplays(a, b) {
    const fa = a && typeof a.frames === 'function' ? a.frames() : [];
    const fb = b && typeof b.frames === 'function' ? b.frames() : [];
    const count = Math.min(fa.length, fb.length);
    for (let i = 0; i < count; ++i) {
        if (fa[i].f !== fb[i].f || fa[i].d !== fb[i].d) return { same: false, count, first: i };
    }
    return { same: fa.length === fb.length, count, first: fa.length === fb.length ? -1 : count };
}

/**
 * Снимок gameplay-состояния для state hash (§26). В hash попадает только то,
 * что влияет на симуляцию:
 *   * номер simulation tick и игровое время;
 *   * состояние RNG без presentation-потоков;
 *   * узлы по стабильному nid: позиция, скорость, угол, есть ли тело.
 * НЕ попадают: настенные часы, GPU-ресурсы, alpha/color/visible/blend, id
 * спрайтов — всё presentation-only.
 */
export function gameplaySnapshot(opts) {
    const o = opts || {};
    // В hash НЕ входят абсолютные tick и игровое время: в новом прогоне они
    // свои, а gameplay-факт — состояние мира и RNG. Номер расходящегося tick
    // хранит сам replay (checkpoint), а не hash (§26).
    const labels = ['rng.seed', 'rng.value'];
    const values = [0, 0];
    const rng = (opts && o.rng) || null;
    if (rng) {
        values[0] = num(rng.seed, 0);
        values[1] = num(rng.value, 0);
        const streams = plainObject(rng.streams) ? rng.streams : {};
        for (const name of Object.keys(streams).sort()) {
            if (PRESENTATION_STREAMS.indexOf(name) >= 0) continue;   // косметика не влияет
            const sub = streams[name] || {};
            labels.push('rng.' + name + '.seed');
            values.push(num(sub.seed, 0));
            labels.push('rng.' + name + '.value');
            values.push(num(sub.value, 0));
        }
    }
    const nodes = (ctx.nodes || []).filter((n) => n && !n.removed && !(n.attrs && n.attrs.ui));
    nodes.sort((a, b) => (String(a.nid) < String(b.nid) ? -1 : (String(a.nid) > String(b.nid) ? 1 : 0)));
    for (const node of nodes) {
        const nid = String(node.nid);
        labels.push(nid + '.x'); values.push(Math.round(num(node.x, 0) * 1000));
        labels.push(nid + '.y'); values.push(Math.round(num(node.y, 0) * 1000));
        labels.push(nid + '.a'); values.push(Math.round(num(node.angle, 0) * 1000));
        let vx = 0, vy = 0;
        if (node.body >= 0 && typeof engine.getVelocity === 'function') {
            const v = engine.getVelocity(node.body) || [0, 0];
            vx = num(v[0], 0); vy = num(v[1], 0);
        }
        labels.push(nid + '.vx'); values.push(Math.round(vx));
        labels.push(nid + '.vy'); values.push(Math.round(vy));
        labels.push(nid + '.body'); values.push(node.body >= 0 ? 1 : 0);
    }
    return { labels, values };
}

/** Подсистема `$.replay`. */
export function installReplay($) {
    // Паспорт сборки. В JS-биндингах движка версии пока нет, поэтому:
    // сначала то, что объявила сама сборка (engine.version/build/buildId),
    // затем — то, что игра положила через $.replay.identity(), иначе null.
    // Запись не выдумывает ID: неизвестное честно помечается null.
    //
    // Объявление стоит ДО первого вызова engineIdentity(): с `const` ниже
    // вызова функция уходила в временную мёртвую зону, и весь высокоуровневый
    // API падал с «$ is not defined» — движок не запускался вообще.
    const identity = { version: null, build: null };

    const replay = createReplay({
        seed: (typeof engine !== 'undefined' && engine && engine.seed) || 0,
        dt: (typeof engine !== 'undefined' && engine && engine.fixedDt) || 0,
        engine: engineIdentity(),
        content: contentTable(),
        streams: rngSnapshot(),
    });

    // Номер кадра движка нужен ядру: без него оно бы зависело от ctx напрямую.
    ctx.engineFrame = () => (typeof engine !== 'undefined' && engine ? engine.frame : 0);

    function engineIdentity() {
        const e = engine || {};
        // Движок отдаёт свою версию биндингом `engine.version` (CMake-версия
        // проекта), поэтому заголовок replay больше не пишет null «потому что
        // версии нет». Игра может уточнить ID через `$.replay.identity({...})`
        // — явное значение важнее автоматического.
        const version = identity.version !== null ? identity.version
            : (e.version !== undefined ? e.version
            : (e.buildId !== undefined ? e.buildId
            : (e.build !== undefined ? e.build : null)));
        const build = identity.build !== null ? identity.build
            : (e.buildId !== undefined ? e.buildId
            : (e.build !== undefined ? e.build : version));
        return { version, build };
    }

    function rngSnapshot() {
        const r = $.random || ctx.random;
        if (!r || typeof r.state !== 'function') return null;
        try { return r.state(); } catch (e) { return null; }
    }

    function contentTable() {
        const save = $.save || ctx.save;
        if (!save || typeof save.contents !== 'function') return {};
        const c = save.contents();
        return Object.assign({}, c.versions, c.hashes);
    }

    // Заголовок обновляем при старте записи: игру интересует состояние ЗАПУСКА.
    const baseStart = replay.start.bind(replay);
    replay.start = (extra) => {
        const o = plainObject(extra) ? extra : {};
        return baseStart(Object.assign({
            seed: (typeof engine !== 'undefined' && engine ? engine.seed : 0),
            dt: (typeof engine !== 'undefined' && engine ? engine.fixedDt : 0),
            engine: engineIdentity(),
            content: contentTable(),
            streams: rngSnapshot(),
        }, o));
    };

    /**
     * Паспорт сборки для заголовка: `$.replay.identity({ version: '0.1.31', build: 'ci-42' })`.
     * Без аргументов — текущий.
     */
    replay.identity = function (value) {
        // Без аргумента отдаём РАЗРЕШЁННЫЙ паспорт: если игра его не задавала,
        // это версия движка из биндинга, а не null (иначе заголовок replay и
        // отчёт писали бы «версии нет», хотя она есть).
        if (value === undefined) return engineIdentity();
        if (plainObject(value)) {
            if (value.version !== undefined) identity.version = String(value.version);
            if (value.build !== undefined) identity.build = String(value.build);
        }
        return replay;
    };

    // Режим разрешённых actions (§26): `$.replay.actions(['left', 'jump'])`.
    const baseHeader = replay.header.bind(replay);
    replay.actions = function (list, mapping) {
        const current = baseHeader().input || {};
        replay._pending_input = {
            mapping: mapping === undefined ? current.mapping : String(mapping),
            actions: Array.isArray(list) ? list.map(String) : null,
        };
        return replay;
    };
    const startWithInput = replay.start;
    replay.start = (extra) => {
        const pending = replay._pending_input;
        const o = Object.assign({}, plainObject(extra) ? extra : {});
        if (pending && o.input === undefined) {
            o.input = { mapping: pending.mapping !== undefined ? pending.mapping : o.input_mapping, actions: pending.actions };
        }
        return startWithInput(o);
    };

    // Провайдер состояния по умолчанию: gameplaySnapshot (движок + RNG).
    replay.stateProvider(() => gameplaySnapshot({ rng: rngSnapshot() }));
    replay.checkpoints({ every: 0 });

    // --- Готовый рекордер -----------------------------------------------------
    //
    // Игра не должна писать обвязку из $.update руками: здесь то же самое, но
    // одним вызовом. Одна и та же пара функций работает и при записи, и при
    // воспроизведении — иначе реплей разойдётся (записали одно, применили
    // другое), и это главная причина, по которой обвязка живёт в движке.

    const basePlay = replay.play.bind(replay);
    const baseStop = replay.stop.bind(replay);
    let active = null;          // 'record' | 'play' | null

    replay.stop = function () {
        active = null;
        return baseStop();
    };

    /**
     * $replay.record(sampler, apply) — запись «из коробки».
     *
     * `sampler()` отдаёт ввод кадра, `apply(input)` его применяет. Одна и та же
     * пара используется и при записи, и при проигрывании (см. play).
     * Если объявлены allowed actions, sampler возвращает массив действий (или
     * `{ actions, raw }`), и запись идёт на уровне actions.
     */
    replay.record = function (sampler, apply) {
        if (typeof sampler !== 'function') {
            ctx.log('$.replay.record: нужна функция-сборщик ввода (sampler)');
            return replay;
        }
        if (!installHook()) return replay;
        replay.stop();
        replay.start();
        active = 'record';
        replay._sampler = sampler;
        replay._apply = apply;
        return replay;
    };

    /**
     * $replay.play(apply) — воспроизведение «из коробки».
     *
     * `apply(input)` получает разобранный ввод кадра; если его не передать,
     * возьмётся тот же `apply`, что был при записи. Ввод из записи подаётся
     * ПЕРЕД вашей игровой логикой — как если бы игрок нажал клавиши.
     */
    replay.play = function (apply) {
        if (typeof apply === 'function') replay._apply = apply;
        if (!installHook()) return replay;
        active = 'play';
        replay.onEnd = replay.onEnd || (() => { active = null; });
        return basePlay();
    };

    /**
     * Проиграть с проверкой: сравнить ввод, который игра выдала бы сейчас, с
     * записанным. Возвращает `{ same, count, first }` — регресс-тест «мир
     * пришёл туда же» без второго процесса.
     */
    replay.verify = function (sampler) {
        if (typeof sampler !== 'function') return { same: true, count: 0, first: -1 };
        const frames = replay.frames();
        for (let i = 0; i < frames.length; ++i) {
            const expected = frames[i].d;
            let actual = null;
            try { actual = JSON.stringify(sampler(i)); } catch (e) { actual = null; }
            if (actual !== expected) return { same: false, count: frames.length, first: i };
        }
        return { same: true, count: frames.length, first: -1 };
    };

    let tick_base = 0;          // номер кадра, с которого идёт текущий прогон

    const hookFn = () => {
        const frame = ctx.engineFrame ? ctx.engineFrame() : 0;
        if (active === 'record' && replay.isRecording()) {
            if (replay.length() === 0) tick_base = frame;      // базовый tick записи
            const input = replay._sampler();
            // apply получает ту же форму, что при проигрывании: для actions —
            // { actions, raw }, а не сырой массив сборщика.
            if (typeof replay._apply === 'function') replay._apply(replay.forApply(input));
            // Пишем ЯДРОМ, а не публичным record: публичный принимает сборщик
            // ввода и, если позвать его отсюда, кадры не запишутся вовсе
            // (именно так и вышло, когда отладка показала «нужна функция»).
            replay._push(input, frame, frame - tick_base);
            return;
        }
        if (active === 'play' && replay.isPlaying()) {
            if (replay.position() === 0) tick_base = frame;    // базовый tick проигрывания
            const value = replay.tick();
            if (value === null) return;
            if (typeof replay._apply === 'function') {
                try {
                    const parsed = JSON.parse(value);
                    replay._apply(replay.forApply(parsed));
                } catch (e) {
                    ctx.log('$.replay: кадр записи не разобрался — ' + e);
                }
            }
            // Проверка state hash — после применения ввода, ровно там же, где
            // запись снимала checkpoint: иначе состояния не совпадут по фазе.
            replay.verifyState(frame - tick_base);
        }
    };

    let hook_installed = false;
    function installHook() {
        if (hook_installed) return true;
        const api = ctx.$;
        if (!api || typeof api.update !== 'function') {
            ctx.log('$.replay: нет $.update — запись и проигрывание невозможны');
            return false;
        }
        api.update(hookFn);
        hook_installed = true;
        return true;
    }

    $.replay = replay;
    return replay;
}
