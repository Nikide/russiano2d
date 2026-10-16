// ===========================================================================
// Реестр ресурсов: $.resource — ленивая загрузка по имени, кэш и счётчик ссылок.
//
// Зачем отдельный модуль: узлы и звуки ссылаются на файлы по пути, и один и
// тот же путь грузится то тут, то там. $.resource даёт ресурсам имена:
//
//   $.resource.load('tiles', 'assets/tiles.png');   // текстура, ссылок 1
//   const tex = $.resource.get('tiles');            // тот же id, без загрузки
//   $.resource.free('tiles');                       // ссылок 0 → выгрузка
//
//   $.resource.define('shot', { kind: 'sound', path: 'sfx/shot.wav' }); // лениво
//   $.resource.get('shot');      // загрузится здесь и только здесь
//
// Ядро реестра (нормализация описания, ленивая загрузка, кэш, счётчик ссылок,
// выгрузка) — чистые функции createRegistry()/ensureLoaded()/acquireEntry()/
// releaseEntry() без единого обращения к engine: их проверяет qjs-харнесс
// (tests/js/resource_test.mjs). К engine прикасается только загрузчик
// loadByKind() внутри installResource().
//
// Виды ресурсов:
//   texture — id текстуры (engine.loadTexture);
//   sprite  — id спрайта: весь кадр (общий кэш ядра) или вырезанный кусок;
//   sheet   — массив кадров листа (как .frames({ src, cols, rows, cw, ch }));
//   sound   — id звука (engine.audio.load);
//   json    — разобранный объект через $.fs.readJSON;
//   text    — строка через $.fs.readText;
//   data    — значение из кода (value) или фабрика (build) — без движка и файлов.
// ===========================================================================

import { engine } from './native.js';
import { ctx, resolveSprite, sheetFrames, forgetTexture } from './core.js';
import { makeCurve, makeGradient } from './curve.js';

export const RESOURCE_KINDS = ['texture', 'sprite', 'sheet', 'sound', 'json', 'text', 'data',
                              'curve', 'gradient'];

/**
 * Освободить текстуру (или все текстуры), загруженные из этого пути.
 *
 * Зачем отдельно от реестра: узлы, атласы и листы кадров грузят текстуры по
 * пути напрямую (`engine.loadTexture`), минуя `$.resource`, и раньше освободить
 * их было нечем — потоковая анимация (много крупных кадров по очереди) копила
 * GPU-память. Замер BASHNYA: 64 оверлея 1672×941 = 402 МБ, `free` по пути
 * отвечал «такого ресурса нет».
 *
 * Возврат: `{ ok, busy, users, mb, freed, error }`.
 *   ok: true    — выгружено (сколько МБ вернулось в `freed`);
 *   busy: true  — на текстуру ссылаются живые спрайты: НЕ выгружаем;
 *   error       — текстуры с таким путём нет.
 */
/**
 * Спрайты, которые сейчас держат живые узлы (и кадры атласа, если он подключён).
 * Всё остальное — кэш JS, его погасить можно.
 */
function liveSprites() {
    const live = new Set();
    const nodes = ctx.nodes || [];
    for (let i = 0; i < nodes.length; ++i) {
        const node = nodes[i];
        if (!node || node.removed) continue;
        if (typeof node.sprite === 'number' && node.sprite >= 0) live.add(node.sprite);
    }
    const atlas = ctx.atlas;
    if (atlas && typeof atlas.list === 'function') {
        for (const entry of atlas.list() || []) {
            if (entry && typeof entry.sprite === 'number' && entry.sprite >= 0) live.add(entry.sprite);
            for (const frame of (entry && entry.frames) || []) {
                const id = typeof frame === 'number' ? frame : (frame && frame.sprite);
                if (typeof id === 'number' && id >= 0) live.add(id);
            }
        }
    }
    return live;
}

function freeTextureByPath(path) {
    const name = String(path === undefined || path === null ? '' : path);
    if (!engine || typeof engine.textureList !== 'function' || typeof engine.freeTexture !== 'function') {
        return { ok: false, busy: false, users: 0, mb: 0, freed: 0, error: 'движок не даёт список текстур' };
    }
    // Список может быть не массивом (в юнит-харнессе движок — заглушка):
    // защищаемся, а не падаем «not a function» на ровном месте.
    let list = [];
    try {
        list = engine.textureList() || [];
        if (!Array.isArray(list)) list = [];
    } catch (e) { list = []; }
    const matches = list.filter((t) => t && (t.path === name
        || (name.length > 0 && t.path.endsWith('/' + name))));
    if (!matches.length) {
        return { ok: false, busy: false, users: 0, mb: 0, freed: 0, error: 'текстуры с таким путём нет' };
    }
    // Спрайты бывают двух сортов: те, что держит ЖИВОЙ узел (или атлас), и те,
    // что остались только в кэше JS. Первые трогать нельзя — узел молча остался
    // бы без картинки; вторые можно погасить вместе с текстурой, иначе
    // потоковая анимация не освободит память никогда (кэш держит спрайт по
    // пути даже после удаления узла).
    const live = liveSprites();
    let busy = 0;
    for (const t of matches) {
        if (typeof engine.textureSprites !== 'function') { busy += t.users; continue; }
        const sprites = engine.textureSprites(t.id) || [];
        for (const sprite of sprites) if (live.has(sprite)) busy++;
    }
    if (busy > 0) {
        ctx.log(`$.resource.free("${name}"): текстуру держат живые узлы/атлас (${busy}) — `
                + 'не выгружаю; сначала уберите узлы, которые её используют');
        return { ok: false, busy: true, users: busy, mb: 0, freed: 0,
                 error: `текстура используется (${busy})` };
    }
    let freed = 0;
    for (const t of matches) {
        const mb = (t.bytes || 0) / (1024 * 1024);
        if (engine.freeTexture(t.id)) freed += mb;
    }
    // Кэши JS держат и путь, и спрайты по нему: без сброса повторная загрузка
    // вернула бы мёртвый id.
    forgetTexture(name);
    return { ok: freed > 0, busy: false, users: 0, mb: freed, freed: freed,
             error: freed > 0 ? null : 'движок не выгрузил текстуру' };
}

const IMAGE_EXT = /\.(png|jpg|jpeg|bmp|gif|webp|tga|avif)$/i;
const SOUND_EXT = /\.(wav|ogg|mp3|flac|opus|m4a|aac)$/i;
const JSON_EXT = /\.(json|save)$/i;
const TEXT_EXT = /\.(txt|md|csv|ini|cfg|tsv|log)$/i;

function num(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    return isFinite(n) ? n : fallback;
}

function int(value, fallback) {
    const n = num(value, fallback);
    return Math.floor(n);
}

function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeName(name) {
    const key = name === undefined || name === null ? '' : String(name).trim();
    return key;
}

// ---------------------------------------------------------------------------
// Описания ресурсов (чистые функции)
// ---------------------------------------------------------------------------

/** Вид ресурса по расширению: неизвестное считаем картинкой. */
export function inferKind(path) {
    const text = path === undefined || path === null ? '' : String(path);
    if (SOUND_EXT.test(text)) return 'sound';
    if (JSON_EXT.test(text)) return 'json';
    if (TEXT_EXT.test(text)) return 'text';
    if (IMAGE_EXT.test(text)) return 'texture';
    return 'texture';
}

/** Строка для сообщений об ошибке: «texture assets/tiles.png». */
export function describeSpec(spec) {
    if (!spec) return '';
    const where = spec.path || spec.src;
    return where ? `${spec.kind} ${where}` : String(spec.kind || '?');
}

/**
 * Описание ресурса → нормализованный вид или null, если описание пустое.
 * Принимает строку-путь и объект { kind, path, ... }:
 *   'assets/hero.png'                          → texture
 *   { kind: 'sheet', src, cols, rows, cw, ch } → лист кадров
 *   { kind: 'sprite', src, x, y, w, h }        → вырезанный кадр
 *   { kind: 'data', value } / { build() }      → значение из кода
 */
export function normalizeSpec(name, spec) {
    const key = normalizeName(name);
    if (key === '') return null;

    if (typeof spec === 'string') {
        if (spec.trim() === '') return null;
        // Строка — это тоже полноценное описание: вид выводится из расширения,
        // и dispose для текстуры ставится так же, как для объекта.
        return withDefaultDispose({ name: key, kind: inferKind(spec), path: spec, src: spec });
    }
    if (!plainObject(spec)) return null;

    const source = spec.path !== undefined ? spec.path : spec.src;
    const kind = typeof spec.kind === 'string' ? spec.kind.trim().toLowerCase() : inferKind(source);
    if (!RESOURCE_KINDS.includes(kind)) return null;
    // Кривые и градиенты задаются ДАННЫМИ, а не файлом — как `data`, им путь
    // не нужен. Раньше они молча отбрасывались: define возвращал null, а get
    // потом отдавал null без внятной причины.
    const data_like = kind === 'data' || kind === 'curve' || kind === 'gradient';
    if (!data_like && (source === undefined || source === null || String(source).trim() === '')) return null;

    const out = { name: key, kind };
    if (source !== undefined && source !== null) {
        out.path = String(source);
        out.src = String(source);
    }
    if (kind === 'sheet') {
        out.cols = Math.max(1, int(spec.cols, 1));
        out.rows = Math.max(1, int(spec.rows, 1));
        out.cw = Math.max(0, int(spec.cw, 0));
        out.ch = Math.max(0, int(spec.ch, 0));
    }
    if (kind === 'sprite') {
        if (spec.texture !== undefined) out.texture = int(spec.texture, -1);
        out.x = int(spec.x, 0);
        out.y = int(spec.y, 0);
        out.w = int(spec.w, 0);
        out.h = int(spec.h, 0);
        out.crop = spec.x !== undefined || spec.y !== undefined
            || spec.w !== undefined || spec.h !== undefined;
    }
    if (kind === 'json' && spec.fallback !== undefined) out.fallback = spec.fallback;
    if (kind === 'data') {
        if (spec.value !== undefined) out.value = spec.value;
        if (typeof spec.build === 'function') out.build = spec.build;
    }
    if (kind === 'curve') {
        if (spec.points !== undefined) out.points = spec.points;
        if (spec.values !== undefined) out.values = spec.values;
        if (spec.value !== undefined) out.value = spec.value;
        if (spec.mode !== undefined) out.mode = String(spec.mode);
    }
    if (kind === 'gradient') {
        if (spec.stops !== undefined) out.stops = spec.stops;
        if (spec.colors !== undefined) out.colors = spec.colors;
        if (spec.mode !== undefined) out.mode = String(spec.mode);
    }
    if (typeof spec.dispose === 'function') out.dispose = spec.dispose;
    return withDefaultDispose(out);
}

/**
 * Выгрузка по умолчанию: текстура возвращает слот движку.
 *
 * Без этого free() только забывал значение у себя, а GPU-память и слот
 * оставались занятыми до конца процесса (лимит — 256 текстур). Заодно просим
 * ядро забыть кэш пути: в C слот переиспользуется, и старый id стал бы чужой
 * текстурой (см. docs/highlevel/resource.md §5).
 */
function withDefaultDispose(spec) {
    if (!spec || spec.dispose || spec.kind !== 'texture') return spec;
    if (typeof engine === 'undefined' || !engine || typeof engine.freeTexture !== 'function') return spec;
    const path = spec.path || '';
    spec.dispose = (value) => {
        if (value >= 0) engine.freeTexture(value);
        if (path) forgetTexture(path);
    };
    return spec;
}

/** Ключ описания: по нему видно, то же самое описали повторно или другое. */
export function specKey(spec) {
    if (!spec) return '';
    return [
        spec.kind, spec.path || '',
        spec.cols || 0, spec.rows || 0, spec.cw || 0, spec.ch || 0,
        spec.texture === undefined ? '' : spec.texture,
        spec.x || 0, spec.y || 0, spec.w || 0, spec.h || 0,
        spec.value === undefined ? '' : 'value',
        spec.build === undefined ? '' : 'build',
        // У кривых и градиентов значение задаётся ДАННЫМИ, а не путём: без них
        // две разные кривые с одинаковым видом считались бы одним ресурсом.
        spec.points === undefined ? '' : 'p' + JSON.stringify(spec.points),
        spec.values === undefined ? '' : 'v' + JSON.stringify(spec.values),
        spec.stops === undefined ? '' : 's' + JSON.stringify(spec.stops),
        spec.colors === undefined ? '' : 'c' + JSON.stringify(spec.colors),
        spec.mode || '',
    ].join('|');
}

/** Запись реестра: значение появляется только после успешной загрузки. */
export function makeEntry(spec) {
    return {
        name: spec.name,
        spec,
        value: null,
        refs: 0,
        state: 'defined',      // defined | ready | failed
        error: null,
        loads: 0,
        fails: 0,
        at: 0,
        // §27: ВЕРСИЯ опубликованного значения. Игра ссылается на ресурс по
        // имени и версии, а не по native-handle; версия растёт только когда
        // значение действительно опубликовано заново (reload/setValue).
        version: 0,
    };
}

/** Понятный текст ошибки: что, откуда и почему не вышло. */
export function errorText(entry, reason) {
    const where = describeSpec(entry && entry.spec);
    const name = entry ? entry.name : '?';
    return `$.resource: не удалось загрузить "${name}"${where ? ' (' + where + ')' : ''} — ${reason || 'неизвестная причина'}`;
}

// ---------------------------------------------------------------------------
// Ядро реестра: ленивая загрузка, кэш, счётчик ссылок (чистые функции)
// ---------------------------------------------------------------------------

/**
 * Загрузить значение, если его ещё нет. Повторный вызов на готовой записи
 * НЕ перезагружает: в этом весь смысл кэша по имени. Упавшая загрузка
 * оставляет запись в состоянии failed — следующая попытка пробует снова
 * (файл могли доложить на диск).
 *
 * loader — функция (spec, name) → { ok, value } | { ok: false, error }.
 */
export function ensureLoaded(entry, loader, now) {
    if (!entry) return { ok: false, value: null, error: 'нет записи ресурса', loaded: false };
    if (entry.state === 'ready') {
        return { ok: true, value: entry.value, error: null, loaded: false };
    }
    entry.state = 'loading';
    let result = null;
    try {
        result = loader(entry.spec, entry.name);
    } catch (e) {
        result = { ok: false, error: 'исключение при загрузке: ' + (e && e.message ? e.message : e) };
    }
    if (result && result.ok) {
        entry.value = result.value;
        entry.state = 'ready';
        entry.error = null;
        entry.loads++;
        entry.version++;
        entry.at = num(now, 0);
        return { ok: true, value: entry.value, error: null, loaded: true, version: entry.version };
    }
    entry.value = null;
    entry.state = 'failed';
    entry.fails++;
    entry.error = errorText(entry, result && result.error);
    return { ok: false, value: null, error: entry.error, loaded: false };
}

/** Взять ресурс: загрузить при необходимости и добавить ссылку. */
export function acquireEntry(entry, loader, now) {
    const res = ensureLoaded(entry, loader, now);
    if (res.ok) entry.refs++;
    return { ok: res.ok, value: res.value, error: res.error, refs: entry.refs, loaded: res.loaded };
}

/**
 * Отпустить ссылку. Когда ссылок не осталось, значение выгружается:
 * вызывается spec.dispose(value) (если он есть) — например чтобы вернуть
 * движку или закрыть файл.
 */
export function releaseEntry(entry, onError) {
    if (!entry) return { ok: false, refs: 0, unloaded: false };
    if (entry.refs > 0) entry.refs--;
    if (entry.refs === 0 && entry.state === 'ready') {
        unloadEntry(entry, onError);
        return { ok: true, refs: 0, unloaded: true };
    }
    return { ok: true, refs: entry.refs, unloaded: false };
}

/** Выгрузить значение, не трогая описание: ссылки сбрасываются в ноль. */
export function unloadEntry(entry, onError) {
    if (!entry) return false;
    const had = entry.state === 'ready' || entry.value !== null;
    const dispose = entry.spec && typeof entry.spec.dispose === 'function' ? entry.spec.dispose : null;
    if (dispose && had) {
        try {
            dispose(entry.value, entry.spec);
        } catch (e) {
            if (typeof onError === 'function') {
                onError(`$.resource: dispose("${entry.name}") — ${e && e.message ? e.message : e}`);
            }
        }
    }
    entry.value = null;
    entry.state = 'defined';
    entry.refs = 0;
    return had;
}

/**
 * Чистое ядро $.resource: Map описаний + loader. Ни движка, ни $ — поэтому
 * всё поведение (ленивость, кэш, ссылки, выгрузка, ошибки) проверяется
 * юнит-тестом, а installResource() остаётся тонкой обёрткой.
 */
export function createRegistry(loader, opts) {
    const options = opts || {};
    const log = typeof options.log === 'function' ? options.log : () => 0;
    const now = typeof options.now === 'function' ? options.now : () => 0;
    const entries = new Map();
    const load = typeof loader === 'function' ? loader : () => ({ ok: false, error: 'загрузчик не задан' });

    function warn(message) { log('$.resource: ' + message); }

    function entryOf(name) {
        return entries.get(normalizeName(name)) || null;
    }

    const registry = {
        entries,

        /** Описать ресурс, не загружая его. Повторное описание не перезаписывает. */
        define(name, spec) {
            const norm = normalizeSpec(name, spec);
            if (!norm) {
                warn(`define("${name}"): нужен путь-строка или объект { kind, path }`);
                return null;
            }
            const existing = entries.get(norm.name);
            if (existing) {
                if (specKey(existing.spec) !== specKey(norm)) {
                    warn(`"${norm.name}" уже описан как ${describeSpec(existing.spec)} — ` +
                         'оставляю первое описание (кэш по имени)');
                }
                return existing;
            }
            const entry = makeEntry(norm);
            entries.set(norm.name, entry);
            return entry;
        },

        has(name) { return entries.has(normalizeName(name)); },
        names() { return [...entries.keys()]; },
        spec(name) { const e = entryOf(name); return e ? e.spec : null; },
        error(name) { const e = entryOf(name); return e ? e.error : null; },

        /**
         * §45: положить уже загруженное значение (асинхронный путь). Запись
         * становится ready без повторного вызова загрузчика — иначе async
         * результат был бы загружен второй раз синхронно.
         */
        setValue(name, value) {
            const entry = entryOf(name);
            if (!entry) return false;
            entry.value = value;
            entry.state = 'ready';
            entry.error = null;
            entry.loads++;
            entry.version++;
            return true;
        },

        /** §45: отметить запись неудачной (асинхронный путь). */
        setFailure(name, message) {
            const entry = entryOf(name);
            if (!entry) return false;
            entry.state = 'failed';
            entry.error = message;
            entry.fails++;
            return true;
        },

        /** Взять ресурс по имени: при необходимости описать и загрузить. */
        acquire(name, spec) {
            const key = normalizeName(name);
            let entry = entries.get(key);
            if (!entry && spec !== undefined && spec !== null) entry = registry.define(key, spec);
            if (!entry) {
                const message = `$.resource: "${key}" не описан — укажите путь: ` +
                                `$.resource.load('${key}', 'assets/...')`;
                log(message);
                return { ok: false, value: null, error: message, refs: 0, loaded: false };
            }
            const res = acquireEntry(entry, load, now());
            if (!res.ok) log(res.error);
            return res;
        },

        /** Посмотреть значение без ссылки: загрузит лениво, но не удержит. */
        peek(name) {
            const entry = entryOf(name);
            if (!entry) {
                const message = `$.resource: "${normalizeName(name)}" не зарегистрирован ` +
                                '(сначала define/load с путём)';
                log(message);
                return { ok: false, value: null, error: message, loaded: false };
            }
            const res = ensureLoaded(entry, load, now());
            if (!res.ok) log(res.error);
            return res;
        },

        /** Форсированная перезагрузка: кэш не спасает (хот-релоад ассетов). */
        reload(name) {
            const entry = entryOf(name);
            if (!entry) {
                warn(`reload("${name}"): ресурс не зарегистрирован`);
                return { ok: false, value: null, error: null, loaded: false };
            }
            const refs = entry.refs;
            unloadEntry(entry, warn);
            entry.refs = refs;
            const res = ensureLoaded(entry, load, now());
            if (!res.ok) log(res.error);
            return res;
        },

        /** Отпустить ссылку; на нуле ссылок ресурс выгружается. */
        free(name) {
            const entry = entryOf(name);
            if (!entry) {
                warn(`free("${name}"): такого ресурса нет`);
                return { ok: false, refs: 0, unloaded: false };
            }
            if (entry.refs <= 0) {
                warn(`free("${name}"): ссылок уже нет — вызовите столько раз, сколько load()`);
            }
            return releaseEntry(entry, warn);
        },

        /** Отпустить все ссылки всех ресурсов (описания остаются). */
        freeAll() {
            let unloaded = 0;
            for (const entry of entries.values()) {
                if (unloadEntry(entry, warn)) unloaded++;
            }
            return unloaded;
        },

        /** Забыть ресурс вместе со значением. */
        remove(name) {
            const key = normalizeName(name);
            const entry = entries.get(key);
            if (!entry) return false;
            if (entry.refs > 0) warn(`remove("${key}"): ресурс ещё используется (ссылок ${entry.refs})`);
            unloadEntry(entry, warn);
            entries.delete(key);
            return true;
        },

        /** Забыть все ресурсы. Возвращает число забытых описаний. */
        clear() {
            const count = entries.size;
            for (const entry of entries.values()) unloadEntry(entry, warn);
            entries.clear();
            return count;
        },

        /** Прогреть кэш: загрузить все описанные (или перечисленные) ресурсы. */
        preload(names) {
            const list = Array.isArray(names) && names.length
                ? names.map(normalizeName)
                : [...entries.keys()];
            let loaded = 0;
            let failed = 0;
            for (const name of list) {
                const entry = entries.get(name);
                if (!entry) {
                    failed++;
                    warn(`preload("${name}"): ресурс не зарегистрирован`);
                    continue;
                }
                const res = ensureLoaded(entry, load, now());
                if (res.ok) loaded++;
                else { failed++; log(res.error); }
            }
            return { loaded, failed, total: list.length };
        },

        /** Список записей без значений — годится в JSON и в отладочный вывод. */
        list() {
            return [...entries.values()].map((entry) => ({
                name: entry.name,
                kind: entry.spec.kind,
                path: entry.spec.path || null,
                state: entry.state,
                refs: entry.refs,
                loads: entry.loads,
                fails: entry.fails,
                version: entry.version,
                error: entry.error,
            }));
        },

        /** Сводка по реестру — для меню загрузки и $.debug. */
        stats() {
            const kinds = {};
            let ready = 0;
            let defined = 0;
            let failed = 0;
            let refs = 0;
            let loads = 0;
            let fails = 0;
            for (const entry of entries.values()) {
                kinds[entry.spec.kind] = (kinds[entry.spec.kind] || 0) + 1;
                refs += entry.refs;
                loads += entry.loads;
                fails += entry.fails;
                if (entry.state === 'ready') ready++;
                else if (entry.state === 'failed') failed++;
                else defined++;
            }
            return { total: entries.size, ready, defined, failed, refs, loads, fails, kinds };
        },
    };

    return registry;
}

// ---------------------------------------------------------------------------
// Загрузка значений: единственное место, где модуль касается движка и файлов
// ---------------------------------------------------------------------------

function fsOf($) {
    return $.fs || ctx.fs || null;
}

function ok(value) { return { ok: true, value }; }
function fail(error) { return { ok: false, error }; }

function loadByKind(spec, $) {
    switch (spec.kind) {
        case 'data': return loadData(spec);
        case 'texture': return loadTexture(spec);
        case 'sprite': return loadSprite(spec);
        case 'sheet': return loadSheet(spec);
        case 'sound': return loadSound(spec);
        case 'json': return loadJson($, spec);
        case 'text': return loadText($, spec);
        case 'curve': return loadCurve(spec);
        case 'gradient': return loadGradient(spec);
        default: return fail(`неизвестный вид ресурса "${spec.kind}"`);
    }
}

/**
 * Кривая как ресурс: `{ kind: 'curve', points: [...], mode: 'linear' }`.
 *
 * Кривая — такая же ценность, как текстура: её описывают в манифесте один раз,
 * а берут по имени (`$.resource.get('damage')`). Данные, а не файл: кривые
 * задают прямо в коде.
 */
function loadCurve(spec) {
    const values = spec.points !== undefined ? spec.points : spec.values;
    if (values === undefined) {
        return fail('для кривой нужны points (или values): массив чисел либо точек {x, y}');
    }
    return ok(makeCurve(values, spec));
}

/** Градиент как ресурс: `{ kind: 'gradient', stops: [...] }`. */
function loadGradient(spec) {
    const stops = spec.stops !== undefined ? spec.stops : spec.colors;
    if (stops === undefined) {
        return fail('для градиента нужны stops (или colors): массив цветов либо стопов {at, color}');
    }
    return ok(makeGradient(stops, spec));
}

function loadData(spec) {
    if (typeof spec.build === 'function') return ok(spec.build(spec));
    if (spec.value === undefined) return fail('для ресурса-данных нужен value или build()');
    return ok(spec.value);
}

function loadTexture(spec) {
    if (typeof engine.loadTexture !== 'function') return fail('движок не умеет loadTexture');
    // `mipmaps: true` в описании ресурса: уровни для УМЕНЬШЕННЫХ спрайтов,
    // иначе они мерцают. Обычным текстурам это не нужно.
    const id = engine.loadTexture(spec.path, spec.mipmaps === true
        ? { mipmaps: true } : undefined);
    if (!(id >= 0)) return fail(`текстура "${spec.path}" не загрузилась — файл на месте?`);
    return ok(id);
}

function loadSprite(spec) {
    // Кадр из уже загруженной текстуры: id пришёл из кода, а не из пути.
    if (spec.texture !== undefined && spec.texture >= 0) {
        if (typeof engine.createSprite !== 'function') return fail('движок не умеет createSprite');
        const cut = engine.createSprite(spec.texture, spec.x, spec.y, spec.w, spec.h);
        if (!(cut >= 0)) return fail(`не удалось вырезать кадр из текстуры ${spec.texture}`);
        return ok(cut);
    }
    if (!spec.path) return fail('нужен path к картинке или texture с координатами кадра');
    if (spec.crop) {
        if (typeof engine.loadTexture !== 'function' || typeof engine.createSprite !== 'function') {
            return fail('движок не умеет loadTexture/createSprite');
        }
        const tex = engine.loadTexture(spec.path);
        if (!(tex >= 0)) return fail(`картинка "${spec.path}" не загрузилась — файл на месте?`);
        const cut = engine.createSprite(tex, spec.x, spec.y, spec.w, spec.h);
        if (!(cut >= 0)) return fail(`не удалось вырезать кадр из "${spec.path}"`);
        return ok(cut);
    }
    // Без обрезки — общий кэш ядра: это ровно тот же спрайт, что у .sprite(path).
    const id = resolveSprite(spec.path);
    if (!(id >= 0)) return fail(`спрайт "${spec.path}" не получился — файл на месте?`);
    return ok(id);
}

function loadSheet(spec) {
    const sheet = { src: spec.path, cols: spec.cols, rows: spec.rows, cw: spec.cw, ch: spec.ch };
    resolveSprite(sheet);
    const frames = sheetFrames(sheet);
    if (!frames || frames.length === 0) {
        return fail(`лист "${spec.path}" не нарезался (cols×rows = ${spec.cols}×${spec.rows})`);
    }
    return ok(frames);
}

function loadSound(spec) {
    const audio = engine.audio;
    if (!audio || typeof audio.load !== 'function') return fail('движок без звука (engine.audio)');
    const id = audio.load(spec.path);
    if (!(id >= 0)) return fail(`звук "${spec.path}" не загрузился — файл на месте?`);
    return ok(id);
}

function loadJson($, spec) {
    const f = fsOf($);
    if (!f || typeof f.readJSON !== 'function') return fail('нет $.fs — нечем читать файлы (модуль store.js)');
    if (typeof f.exists === 'function' && !f.exists(spec.path)) return fail(`файл "${spec.path}" не найден`);
    const value = f.readJSON(spec.path, spec.fallback);
    if (value === null || value === undefined) return fail(`JSON "${spec.path}" не разобрался`);
    return ok(value);
}

function loadText($, spec) {
    const f = fsOf($);
    if (!f || typeof f.readText !== 'function') return fail('нет $.fs — нечем читать файлы (модуль store.js)');
    const text = f.readText(spec.path);
    if (text === null || text === undefined) return fail(`файл "${spec.path}" не найден`);
    return ok(typeof text === 'string' ? text : String(text));
}

// ---------------------------------------------------------------------------
// Установка: $.resource
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §45: асинхронный resource request
//
// Что это: один запрос на список ресурсов со состояниями
// queued → loading → decoded → uploading → ready | failed | cancelled и
// progress в известных единицах (байты и задачи). I/O и декодирование идут в
// рабочем потоке ядра (engine.async), а применение результата — здесь, на
// главном потоке, в безопасной фазе кадра (логика, до begin_frame): только тут
// создаётся GPU-текстура и ставятся значения в реестр.
//
// Если ядро собрано без engine.async (или это qjs-харнесс), запрос честно
// идёт синхронным путём: состояния те же, но один ресурс за кадр, чтобы не
// блокировать кадр целиком. `estimated` в прогрессе говорит, что доля стадии
// оценочная, а не измеренная в байтах.
// ---------------------------------------------------------------------------

/** Вид I/O для спецификации: 'image' | 'read' | 'none'. */
export function requestIoKind(spec) {
    if (!spec || !spec.path) return 'none';
    switch (spec.kind) {
        case 'texture': return 'image';
        // Лист и кадр режутся из уже загруженной текстуры: декодировать надо
        // один раз — картинку.
        case 'sheet': return 'image';
        case 'sprite': return spec.crop || spec.texture !== undefined ? 'none' : 'image';
        case 'sound': return 'read';      // декодирование аудио — на главном потоке
        case 'json':
        case 'text': return 'read';
        default: return 'none';           // data/curve/gradient — не файл
    }
}

export function installResource($) {
    const registry = createRegistry((spec) => loadByKind(spec, $), { log: (m) => ctx.log(m) });

    // --- §45: очередь запросов ----------------------------------------------
    // Проверяем именно возможность (как гейтинг RE2D): в харнессе engine —
    // Proxy, который на неизвестное имя отдаёт noop-функцию, и проверка
    // «engine.async истинно» приняла бы мок за настоящий загрузчик.
    const async_io = () => {
        if (typeof engine === 'undefined' || !engine || !engine.async) return null;
        const io = engine.async;
        return (typeof io.read === 'function' && typeof io.poll === 'function') ? io : null;
    };
    const active_requests = new Set();
    const by_job = new Map();          // id задания ядра → { req, item }
    let request_seq = 0;
    let hook_installed = false;
    // Бюджет применения на кадр: тяжёлые применения (GPU upload, decode звука)
    // ограничены, чтобы анимация экрана загрузки не вставала.
    const APPLY_BUDGET = 2;

    function dbgReport(where, message, opts) {
        const o = opts || {};
        if ($.debug && typeof $.debug.reportError === 'function') {
            $.debug.reportError(where, new Error(message), {
                fatal: false,
                code: o.code || 'R2D_LOAD_RESOURCE',
                assetPath: o.assetPath === undefined ? null : o.assetPath,
            });
        }
        ctx.log('$.resource.request: ' + message);
    }

    function requestProgress(req) {
        const io_stage = req.state === 'queued' ? 'queued'
            : (req.state === 'loading' ? 'io'
            : (req.state === 'decoded' ? 'decode'
            : (req.state === 'uploading' ? 'apply' : 'done')));
        // Оценочной доля становится там, где она не в байтах: применение
        // (GPU upload/parse/decode звука), синхронный путь без engine.async и
        // случай, когда размеры файлов неизвестны вовсе.
        const estimated = req.sync_fallback || req.state === 'uploading' || !(req.bytes_total > 0);
        return {
            state: req.state,
            stage: io_stage,
            bytes_done: req.bytes_done,
            bytes_total: req.bytes_total,
            bytes_known: req.bytes_total > 0,
            jobs_done: req.jobs_done,
            jobs_total: req.jobs_total,
            estimated,
            cancelled: req.state === 'cancelled',
            failed: req.state === 'failed',
            names: req.items.map((it) => it.name),
        };
    }

    function fire(req, event) {
        const list = req.listeners[event];
        if (!list) return;
        for (const fn of list.slice()) {
            try { fn(req); } catch (e) { ctx.log(`$: ошибка в $.resource.request.on(${event}): ${e}`); }
        }
    }

    function finishRequest(req, state) {
        if (req.state === state) return;
        req.state = state;
        active_requests.delete(req);
        fire(req, state === 'ready' ? 'ready' : (state === 'failed' ? 'failed' : 'cancelled'));
        fire(req, 'done');
    }

    /** Освободить всё, что запрос успел взять: отмена не должна течь. */
    function releaseRequest(req) {
        const io = async_io();
        for (const item of req.items) {
            if (item.job !== null && item.job !== undefined) {
                if (io && typeof io.cancel === 'function') io.cancel(item.job);
                if (io && typeof io.release === 'function') io.release(item.job);
                by_job.delete(item.job);
                item.job = null;
            }
            if (item.acquired && registry.has(item.name)) registry.free(item.name);
            if (item.entry && item.entry.refs > 0) {
                while (item.entry.refs > 0) registry.free(item.name);
            }
        }
    }

    function failRequest(req, message, item) {
        if (req.state === 'failed' || req.state === 'cancelled') return;
        req.failed = {
            code: 'R2D_LOAD_RESOURCE',
            message,
            name: item ? item.name : null,
            path: item && item.spec ? item.spec.path || null : null,
            stage: req.state,
        };
        releaseRequest(req);
        finishRequest(req, 'failed');
        dbgReport('$.resource.request', message, {
            code: 'R2D_LOAD_RESOURCE',
            assetPath: req.failed.path,
        });
    }

    /** Обновить состояние по фактам: I/O закончилось → decoded; всё → ready. */
    function refreshState(req) {
        if (req.state === 'failed' || req.state === 'cancelled') return;
        const pending_io = req.items.some((it) => it.io && !it.io_done);
        const pending_apply = req.items.some((it) => !it.applied);
        if (pending_io) { if (req.state !== 'loading') req.state = 'loading'; return; }
        if (pending_apply) { req.state = req.applying ? 'uploading' : 'decoded'; return; }
        finishRequest(req, 'ready');
    }

    /** Применить один готовый ресурс (главный поток, безопасная фаза). */
    function applyItem(req, item) {
        const spec = item.spec;
        const io = async_io();
        try {
            if (item.value !== undefined) { item.applied = true; }
            else if (item.io === 'read' && io) {
                const text = io.takeText(item.job);
                if (text === null || text === undefined) throw new Error(`"${spec.path}" не прочитался`);
                if (spec.kind === 'json') {
                    let parsed = null;
                    try { parsed = JSON.parse(text); } catch (e) {
                        throw new Error(`JSON "${spec.path}" не разобрался: ${e}`);
                    }
                    item.value = parsed;
                } else {
                    item.value = typeof text === 'string' ? text : String(text);
                }
            } else if (item.io === 'image' && io) {
                const tex = io.takeTexture(item.job);
                if (!(tex >= 0)) throw new Error(`текстура "${spec.path}" не создалась`);
                item.value = finishImageValue(spec, tex, item);
            } else {
                // Синхронный путь (нет engine.async): обычный загрузчик.
                const res = loadByKind(spec, $);
                if (!res.ok) throw new Error(res.error || `"${spec.path}" не загрузился`);
                item.value = res.value;
            }
        } catch (e) {
            const message = (e && e.message) ? e.message : String(e);
            item.applied = true;
            item.ok = false;
            registry.setFailure(item.name, message);
            failRequest(req, `ресурс "${item.name}" (${spec.path || spec.kind}): ${message}`, item);
            return false;
        }
        item.applied = true;
        item.ok = true;
        item.io_done = true;
        registry.setValue(item.name, item.value);
        req.jobs_done++;
        if (!item.counted_bytes) {
            item.counted_bytes = true;
            req.bytes_done += item.bytes || 0;
        }
        return true;
    }

    /** Довести картинку до значения ресурса (лист/кадр/текстура). */
    function finishImageValue(spec, tex, item) {
        if (spec.kind === 'texture') return tex;
        if (spec.kind === 'sheet') {
            const sheet = { src: spec.path, cols: spec.cols, rows: spec.rows, cw: spec.cw, ch: spec.ch };
            const frames = sheetFrames(sheet);
            if (!frames || !frames.length) {
                throw new Error(`лист "${spec.path}" не нарезался (cols×rows = ${spec.cols}×${spec.rows})`);
            }
            return frames;
        }
        if (spec.kind === 'sprite') {
            if (spec.crop) {
                const cut = engine.createSprite(tex, spec.x, spec.y, spec.w, spec.h);
                if (!(cut >= 0)) throw new Error(`не удалось вырезать кадр из "${spec.path}"`);
                return cut;
            }
            const id = resolveSprite(spec.path);
            if (!(id >= 0)) throw new Error(`спрайт "${spec.path}" не получился`);
            return id;
        }
        return tex;
    }

    /** Забрать результат задания ядра и подготовить применение. */
    function routeResult(res) {
        const link = by_job.get(res.id);
        if (!link) {
            const io = async_io();
            if (io && typeof io.release === 'function') io.release(res.id);
            return;
        }
        by_job.delete(res.id);
        const { req, item } = link;
        item.io_done = true;
        item.bytes = res.size || item.bytes || 0;
        if (res.cancelled) { item.released = true; return; }
        if (!res.ok) {
            failRequest(req, res.error || `"${res.path}" не прочитался`, item);
            return;
        }
        item.io_ok = true;
        item.res = res;
        refreshState(req);
    }

    function stepRequest(req, budget) {
        if (req.state === 'ready' || req.state === 'failed' || req.state === 'cancelled') return;
        // 1. Задания, которые ещё не поставлены ядру.
        const io = async_io();
        for (const item of req.items) {
            if (item.job !== null || item.applied || item.released) continue;
            if (item.io === 'none') { applyItem(req, item); continue; }
            if (!io) {
                // Синхронный путь: по одному ресурсу за кадр.
                if (budget.apply <= 0) break;
                budget.apply--;
                applyItem(req, item);
                continue;
            }
            const id = (item.io === 'image') ? io.image(item.spec.path) : io.read(item.spec.path);
            if (!(id >= 0)) {
                failRequest(req, `не удалось поставить чтение "${item.spec.path}"`, item);
                return;
            }
            item.job = id;
            by_job.set(id, { req, item });
        }
        // 2. Применяем готовые (в пределах бюджета кадра).
        let applied = 0;
        for (const item of req.items) {
            if (item.applied || item.released) continue;
            if (!item.io_done) continue;
            if (!item.res && item.io !== 'none' && io) continue;   // ждём poll
            if (applied >= budget.apply) break;                    // бюджет кадра
            applied++;
            req.applying = true;
            applyItem(req, item);
            if (req.state === 'failed') return;
        }
        budget.apply -= applied;
        req.applying = false;
        refreshState(req);
    }

    /**
     * Хук кадра: забрать результаты ядра и продвинуть все активные запросы.
     * Ставится лениво при первом запросе (логика кадра — безопасная фаза для
     * GPU upload и установки значений).
     */
    function tickRequests() {
        const io = async_io();
        if (io && typeof io.poll === 'function') {
            const done = io.poll();
            if (done && done.length) for (const res of done) routeResult(res);
        }
        if (!active_requests.size) return;
        const budget = { apply: APPLY_BUDGET };
        for (const req of Array.from(active_requests)) {
            stepRequest(req, budget);
            if (budget.apply <= 0) break;
        }
    }

    function installHook() {
        if (hook_installed) return true;
        const api = ctx.$;
        if (!api || typeof api.update !== 'function') return false;
        api.update(tickRequests);
        hook_installed = true;
        return true;
    }

    /**
     * Создать запрос. `list` — спецификации (как в define/acquire), имена или
     * готовый массив `{ name, ...spec }`. opts: { sync } — не использовать
     * рабочий поток даже если он есть (тесты, детерминизм).
     */
    function createRequest(list, opts) {
        const o = opts || {};
        const items = [];
        for (const raw of (Array.isArray(list) ? list : [list])) {
            if (!raw) continue;
            let name = null;
            let spec = raw;
            if (typeof raw === 'string') {
                if (registry.has(raw)) {
                    spec = registry.spec(raw);
                    name = raw;
                } else {
                    spec = raw;
                    name = raw;
                }
            } else if (raw.name !== undefined) {
                name = String(raw.name);
            }
            const norm = normalizeSpec(name === null ? (spec.path || spec.src) : name, spec);
            if (!norm) {
                ctx.log(`$.resource.request: пропущена запись без имени и пути: ${JSON.stringify(spec)}`);
                continue;
            }
            const entry = registry.define(norm.name, norm);
            items.push({
                name: norm.name, spec: norm, entry,
                io: requestIoKind(norm), job: null, applied: false, io_done: requestIoKind(norm) === 'none',
                ok: false, value: undefined, bytes: 0, counted_bytes: false,
            });
        }
        const req = {
            id: ++request_seq, items, state: 'queued', applying: false,
            failed: null, listeners: {}, sync_fallback: !async_io() || o.sync === true,
            bytes_total: 0, bytes_done: 0, jobs_total: items.length, jobs_done: 0,
            created_frame: (typeof engine !== 'undefined' && engine) ? engine.frame : 0,
        };
        // Точный знаменатель progress: размеры файлов известны заранее (stat),
        // поэтому байты — измеренные, а не «примерно 40%».
        const io = async_io();
        for (const item of items) {
            if (!item.spec.path) continue;
            let size = 0;
            if (io && typeof io.size === 'function') size = Number(io.size(item.spec.path)) || 0;
            if (!(size > 0) && $.fs && typeof $.fs.readText === 'function' && item.io === 'read') {
                const text = $.fs.readText(item.spec.path);
                size = text ? String(text).length : 0;
            }
            item.bytes_total = Math.max(0, size);
            req.bytes_total += item.bytes_total;
        }
        if (o.sync === true && io) req.sync_fallback = true;
        installHook();
        active_requests.add(req);
        stepRequest(req, { apply: APPLY_BUDGET });
        return req;
    }

    /** Публичный handle запроса — структура, а не текст (§8). */
    function requestHandle(req) {
        const handle = {
            id: req.id,
            state() { return req.state; },
            progress() { return requestProgress(req); },
            done() { return req.state === 'ready' || req.state === 'failed' || req.state === 'cancelled'; },
            ok() { return req.state === 'ready'; },
            cancelled() { return req.state === 'cancelled'; },
            error() { return req.failed; },
            names() { return req.items.map((it) => it.name); },
            results() {
                const out = {};
                for (const item of req.items) if (item.ok) out[item.name] = item.value;
                return out;
            },
            value(name) {
                const item = req.items.find((it) => it.name === String(name));
                return item && item.ok ? item.value : null;
            },
            cancel() {
                if (req.state === 'ready' || req.state === 'failed' || req.state === 'cancelled') return false;
                // releaseRequest сам снимает задания у ядра — второй раз не зовём.
                releaseRequest(req);
                finishRequest(req, 'cancelled');
                return true;
            },
            on(event, fn) {
                if (typeof fn !== 'function') return handle;
                const key = String(event);
                (req.listeners[key] = req.listeners[key] || []).push(fn);
                if ((key === 'ready' && req.state === 'ready')
                    || (key === 'failed' && req.state === 'failed')
                    || (key === 'cancelled' && req.state === 'cancelled')) {
                    try { fn(handle); } catch (e) { ctx.log(`$: ошибка в обработчике request: ${e}`); }
                }
                return handle;
            },
            then(resolve, reject) {
                return new Promise((res, rej) => {
                    handle.on('ready', () => res(handle));
                    handle.on('failed', () => rej(new Error(req.failed ? req.failed.message : 'загрузка не удалась')));
                    handle.on('cancelled', () => res(handle));
                }).then(resolve, reject);
            },
            _raw: req,
        };
        return handle;
    }

    /** Описание + то, что интересно игре: размер текстуры, число кадров. */
    function infoOf(entry) {
        if (!entry) return null;
        const out = {
            name: entry.name,
            kind: entry.spec.kind,
            path: entry.spec.path || null,
            state: entry.state,
            refs: entry.refs,
            loads: entry.loads,
            fails: entry.fails,
            version: entry.version,
            error: entry.error,
        };
        if (entry.state === 'ready') {
            if (entry.spec.kind === 'texture' && typeof engine.textureSize === 'function') {
                const size = engine.textureSize(entry.value);
                if (size && size.length >= 2) { out.width = size[0]; out.height = size[1]; }
            }
            if (entry.spec.kind === 'sheet') {
                out.frames = Array.isArray(entry.value) ? entry.value.length : 0;
            }
            if (entry.spec.kind === 'sound' && engine.audio && typeof engine.audio.duration === 'function') {
                out.duration = engine.audio.duration(entry.value);
            }
        }
        return out;
    }

    const resource = {
        /** Описать ресурс заранее (загрузка — потом, при get/load/preload). */
        define(name, spec) {
            const entry = registry.define(name, spec);
            return entry ? infoOf(entry) : null;
        },

        /**
         * Взять ресурс: `load('tiles', 'assets/tiles.png')` описывает и грузит,
         * `load('tiles')` — грузит уже описанный. Повторный вызов не
         * перезагружает, а добавляет ссылку. Возвращает значение или null.
         */
        load(name, spec) {
            const res = registry.acquire(name, spec);
            return res.ok ? res.value : null;
        },

        /** Значение по имени (ленивая загрузка). Ссылку НЕ добавляет. */
        get(name, fallback) {
            const res = registry.peek(name);
            if (!res.ok) return fallback === undefined ? null : fallback;
            return res.value;
        },

        /** Перезагрузить с диска, даже если значение уже в кэше. */
        reload(name) {
            const res = registry.reload(name);
            return res.ok ? res.value : null;
        },

        /** Отпустить ссылку. Возвращает остаток ссылок (0 — ресурс выгружен). */
        free(name) {
            const res = registry.free(name);
            if (res.ok) return res.refs;
            // Не именованный ресурс? Тогда это может быть ПУТЬ текстуры,
            // загруженной спрайтом (узлом, атласом, листом кадров) — именно так
            // грузится потоковая анимация оверлеев. Такую текстуру тоже
            // освобождаем, но ТОЛЬКО если на неё не ссылается ни один живой
            // спрайт: иначе r2d_texture_free погасил бы спрайты, и узел молча
            // остался бы без картинки.
            const byPath = freeTextureByPath(name);
            if (byPath.ok || byPath.busy) return byPath.ok ? 0 : -1;
            return -1;
        },

        /**
         * Сколько памяти занимают живые текстуры и кто их держит:
         * `[{ id, path, w, h, users, mb }]`. `users` — живые спрайты; пока их
         * больше нуля, текстура не выгружается.
         */
        textures() {
            if (!engine || typeof engine.textureList !== 'function') return [];
            return engine.textureList().map((t) => ({
                id: t.id,
                path: t.path,
                w: t.w,
                h: t.h,
                users: t.users,
                mb: Math.round((t.bytes / (1024 * 1024)) * 1000) / 1000,
            }));
        },

        /**
         * Освободить текстуру по пути (то же, что `free`, но с отчётом):
         * `{ ok, busy, users, mb, error }`. Текстура, которую держит живой
         * спрайт, НЕ выгружается — вернётся `busy: true` и число `users`.
         */
        freeTexture(path) { return freeTextureByPath(path); },

        /** Отпустить все ссылки: число выгруженных ресурсов. */
        freeAll() { return registry.freeAll(); },

        /** Прогреть кэш: без аргумента — все описанные ресурсы. */
        preload(names) { return registry.preload(names); },

        /**
         * §45: асинхронный запрос списка ресурсов. Возвращает handle:
         * `state()`, `progress()`, `cancel()`, `on('ready'|'failed'|'cancelled')`,
         * `results()`, `value(name)`, `error()`.
         *
         *   const req = $.resource.request(['assets/tiles.png', { name: 'lv', path: 'levels/1.json' }]);
         *   req.progress();   // { bytes_done, bytes_total, stage, estimated, cancelled }
         */
        request(list, opts) { return requestHandle(createRequest(list, opts)); },

        /** Активные запросы (копия handles) — для отладки и экранов загрузки. */
        requests() {
            return Array.from(active_requests).map((req) => requestHandle(req));
        },

        /** Отменить все активные запросы; возвращает число отменённых. */
        cancelAll() {
            let n = 0;
            for (const req of Array.from(active_requests)) {
                if (requestHandle(req).cancel()) n++;
            }
            return n;
        },

        has(name) { return registry.has(name); },
        names() { return registry.names(); },
        list() { return registry.list(); },
        stats() {
            const base = registry.stats();
            base.requests = active_requests.size;
            const io = async_io();
            base.async = io && typeof io.stats === 'function' ? io.stats() : null;
            base.workers = base.async && base.async.workers !== undefined ? base.async.workers : 0;
            return base;
        },
        info(name) { return infoOf(registry.entries.get(String(name).trim()) || null); },
        error(name) { return registry.error(name); },

        /**
         * §27: опубликовать НОВУЮ ВЕРСИЮ уже загруженного ресурса, не выгружая
         * его. Нужен хот-релоаду: текстура обновляется на месте (id тот же,
         * содержимое новое), и версия ресурса обязана это показать, иначе игра
         * читает по имени устаревшую версию. `value` не задан — значение
         * остаётся прежним (handle не менялся).
         */
        publish(name, value) {
            const key = String(name).trim();
            const entry = registry.entries.get(key);
            if (!entry) return null;
            if (value !== undefined) registry.setValue(key, value);
            else {
                entry.state = 'ready';
                entry.error = null;
                entry.version++;
            }
            return infoOf(entry);
        },

        /** Забыть ресурс вместе со значением. */
        remove(name) { return registry.remove(name); },
        clear() { return registry.clear(); },
    };

    $.resource = resource;
    ctx.resource = resource;
    return resource;
}
