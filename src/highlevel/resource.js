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

import { ctx, resolveSprite, sheetFrames } from './core.js';

export const RESOURCE_KINDS = ['texture', 'sprite', 'sheet', 'sound', 'json', 'text', 'data'];

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
        return spec.trim() === '' ? null : { name: key, kind: inferKind(spec), path: spec, src: spec };
    }
    if (!plainObject(spec)) return null;

    const source = spec.path !== undefined ? spec.path : spec.src;
    const kind = typeof spec.kind === 'string' ? spec.kind.trim().toLowerCase() : inferKind(source);
    if (!RESOURCE_KINDS.includes(kind)) return null;
    if (kind !== 'data' && (source === undefined || source === null || String(source).trim() === '')) return null;

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
    if (typeof spec.dispose === 'function') out.dispose = spec.dispose;
    return out;
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
        entry.at = num(now, 0);
        return { ok: true, value: entry.value, error: null, loaded: true };
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
        default: return fail(`неизвестный вид ресурса "${spec.kind}"`);
    }
}

function loadData(spec) {
    if (typeof spec.build === 'function') return ok(spec.build(spec));
    if (spec.value === undefined) return fail('для ресурса-данных нужен value или build()');
    return ok(spec.value);
}

function loadTexture(spec) {
    if (typeof engine.loadTexture !== 'function') return fail('движок не умеет loadTexture');
    const id = engine.loadTexture(spec.path);
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

export function installResource($) {
    const registry = createRegistry((spec) => loadByKind(spec, $), { log: (m) => ctx.log(m) });

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
            return res.ok ? res.refs : -1;
        },

        /** Отпустить все ссылки: число выгруженных ресурсов. */
        freeAll() { return registry.freeAll(); },

        /** Прогреть кэш: без аргумента — все описанные ресурсы. */
        preload(names) { return registry.preload(names); },

        has(name) { return registry.has(name); },
        names() { return registry.names(); },
        list() { return registry.list(); },
        stats() { return registry.stats(); },
        info(name) { return infoOf(registry.entries.get(String(name).trim()) || null); },
        error(name) { return registry.error(name); },

        /** Забыть ресурс вместе со значением. */
        remove(name) { return registry.remove(name); },
        clear() { return registry.clear(); },
    };

    $.resource = resource;
    ctx.resource = resource;
    return resource;
}
