// ===========================================================================
// Отладка: $.debug и $.console.
//
//   $.debug.on();                        // показать оверлей движка (F1)
//   $.debug.draw.rect(10, 10, 40, 40, 'red');
//   $.debug.watch('hp', () => $('#hero').hp());
//   $.console.register('spawn', (args) => $('<enemy>').at(args[0], args[1]));
//   $.console.run('spawn 100 200');
// ===========================================================================

import { engine } from './native.js';
import { ctx, query, wrap, nativeNodes } from './core.js';
import { collectCounters } from './pool.js';

const watches = [];
const timers = new Map();
const commands = new Map();

// ---------------------------------------------------------------------------
// §29 RESOURCE: бюджеты разработчика.
//
// Ни один источник здесь не новый: текстуры — engine.textureList(), звук —
// $.sound.busy()/engine.audio.count(), шрифты — engine.fontList()/fontStats(),
// RmlUi — engine.limits(), узлы/тела/частицы — $.debug.counters(), кэш ассетов —
// $.resource.stats(), JS-куча — $.debug.memory(). Задача модуля — свести их в
// одну таблицу и честно назвать основу каждого числа.
//
// Замер — только по явному вызову $.debug.resources() или обновлению вкладки
// MEM. Пока DevTools закрыт, цена нулевая: нет ни таймера, ни опроса.
// ---------------------------------------------------------------------------

/** Ключи бюджетов. Псевдонимы ниже — чтобы игра не угадывала имена. */
const RESOURCE_KEYS = ['textures', 'audio', 'fonts', 'ui', 'entities', 'physics',
                       'particles', 'assets', 'js_heap'];
const RESOURCE_ALIASES = {
    nodes: 'entities', entities: 'entities',
    bodies: 'physics', physics: 'physics',
    documents: 'ui', ui: 'ui',
    cached: 'assets', resources: 'assets', assets: 'assets',
    sounds: 'audio', audio: 'audio',
    textures: 'textures', fonts: 'fonts', particles: 'particles',
    js_heap: 'js_heap', heap: 'js_heap',
};
const RESOURCE_TOP = 5;

/** Пики по ключам: { count, bytes, frame } — только по явным замерам. */
const resource_peaks = new Map();
/** Бюджеты: ключ → { bytes, count }. */
const resource_budgets = new Map();
/** Какие превышения уже предупреждены: ключ:count / ключ:bytes. */
const resource_warned = new Set();

function numOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function bytesText(bytes) {
    if (!Number.isFinite(bytes)) return 'N/A';
    if (bytes >= 1024 * 1024) return (Math.round((bytes / (1024 * 1024)) * 100) / 100) + ' МиБ';
    if (bytes >= 1024) return (Math.round((bytes / 1024) * 100) / 100) + ' КиБ';
    return bytes + ' Б';
}

function formatCount(value) {
    return Number.isFinite(value) ? String(value) : 'N/A';
}

function formatValue(item) {
    const count = item.count === null ? 'N/A' : formatCount(item.count);
    const bytes = item.bytes === null ? 'N/A' : bytesText(item.bytes);
    const limit = item.limit === null ? '' : ' из ' + item.limit;
    return count + limit + '; ' + bytes;
}

function itemOf(key, label, count, bytes, basis, source, note) {
    return {
        key, label,
        count: numOrNull(count),
        bytes: numOrNull(bytes),
        basis: basis,
        limit: null,
        limit_bytes: null,
        peak: { count: null, bytes: null, frame: null },
        biggest: null,
        source: source,
        note: note || '',
        top: [],
        extra: null,
    };
}

function pushTop(list, item) {
    if (!list.length) return;
    item.top = list.slice(0, RESOURCE_TOP);
    item.biggest = item.top[0] || null;
}

function engineLimits() {
    if (!engine || typeof engine.limits !== 'function') return {};
    const limits = engine.limits();
    return (limits && typeof limits === 'object') ? limits : {};
}

function textureResource(limits) {
    const raw = (engine && typeof engine.textureList === 'function') ? engine.textureList() : null;
    const available = Array.isArray(raw);
    const list = available ? raw.slice() : [];
    const mapped = list.map((t) => {
        const w = numOrNull(t && t.w !== undefined ? t.w : t && t.width);
        const h = numOrNull(t && t.h !== undefined ? t.h : t && t.height);
        const bytes = numOrNull(t && t.bytes) !== null ? numOrNull(t.bytes)
            : (w !== null && h !== null ? w * h * 4 : null);
        return { id: t && t.id, name: String(t && (t.path || t.name) || ''), w, h,
                 users: numOrNull(t && t.users), bytes };
    }).sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    let bytes = 0;
    for (const t of mapped) if (t.bytes !== null) bytes += t.bytes;
    // Нет источника — count/bytes null, basis unknown: 0 текстур и «нет данных»
    // это разные факты. Пустой массив — измеренный ноль.
    const item = itemOf('textures', 'текстуры', available ? mapped.length : null,
                        available ? bytes : null,
                        available ? 'cpu-side-only' : 'unknown', 'engine.textureList()',
                        available
                            ? 'RGBA w×h×4 — это CPU-оценка размера пикселей; память GPU движок в байтах не отдаёт'
                            : 'engine.textureList() недоступен в этой сборке');
    item.limit = numOrNull(limits.textures_max);
    item.extra = { top_n: RESOURCE_TOP, available };
    pushTop(mapped.map((t) => ({ name: t.name || ('#' + t.id), bytes: t.bytes,
                                 detail: (t.w === null || t.h === null) ? '' : t.w + '×' + t.h,
                                 users: t.users })), item);
    return item;
}

function audioResource() {
    const sound = ctx.$ && ctx.$.sound;
    const busy = (sound && typeof sound.busy === 'function') ? sound.busy() : null;
    let sounds = null;
    if (engine && engine.audio && typeof engine.audio.count === 'function') {
        sounds = numOrNull(engine.audio.count());
    }
    const item = itemOf('audio', 'звук', sounds, null, 'unknown',
                        '$.sound.busy() / engine.audio.count()',
                        'декодированные сэмплы и память микшера в байтах движок не отдаёт');
    item.limit = busy ? numOrNull(busy.total) : null;
    item.extra = busy ? { active: numOrNull(busy.active), free: numOrNull(busy.free),
                          total: numOrNull(busy.total) } : null;
    return item;
}

function fontsResource() {
    const raw = (engine && typeof engine.fontList === 'function') ? engine.fontList() : null;
    const available = Array.isArray(raw);
    const list = available ? raw : [];
    const stats = (engine && typeof engine.fontStats === 'function') ? engine.fontStats() : null;
    const aw = numOrNull(stats && stats.atlas_w);
    const ah = numOrNull(stats && stats.atlas_h);
    const bytes = (aw !== null && ah !== null && aw > 0 && ah > 0) ? aw * ah * 4 : null;
    const item = itemOf('fonts', 'шрифты', available ? list.length : null, bytes,
                        bytes === null ? 'unknown' : 'estimated',
                        'engine.fontList() / engine.fontStats()',
                        'байты атласа = atlas_w×atlas_h×4 (оценка по площади атласа, не замер GPU)');
    item.extra = stats ? { glyphs: numOrNull(stats.glyphs), atlas_w: aw, atlas_h: ah,
                           drawn: numOrNull(stats.drawn) } : null;
    if (bytes !== null) item.biggest = { name: 'атлас шрифтов', bytes, detail: aw + '×' + ah, users: null };
    return item;
}

function uiResource(limits) {
    const item = itemOf('ui', 'RmlUi-документы', null, null, 'unknown',
                        'engine.limits().documents_max',
                        'движок отдаёт только потолок документов; счётчика живых документов в JS нет');
    item.limit = numOrNull(limits.documents_max);
    return item;
}

function entitiesResource(counters) {
    const item = itemOf('entities', 'узлы / сущности', counters.nodes, null, 'exact',
                        '$.debug.counters()',
                        'байты узлов в JS-куче считаются отдельной строкой js_heap');
    item.extra = { world_nodes: numOrNull(counters.world_nodes), ui_nodes: numOrNull(counters.ui_nodes) };
    return item;
}

function physicsResource(counters, limits) {
    const item = itemOf('physics', 'физические тела', counters.bodies, null, 'exact',
                        '$.debug.counters() / engine.bodyCount()', 'байты Box2D движок не отдаёт');
    item.limit = numOrNull(limits.bodies_max);
    item.extra = { joints: numOrNull(limits.joints), joints_max: numOrNull(limits.joints_max),
                   body_count: (engine && typeof engine.bodyCount === 'function') ? numOrNull(engine.bodyCount()) : null };
    return item;
}

function particlesResource(counters) {
    return itemOf('particles', 'частицы', counters.particles, null, 'exact',
                  '$.debug.counters()', 'байты частиц движок не отдаёт');
}

function assetsResource() {
    const r = ctx.$ && ctx.$.resource;
    if (!r || typeof r.stats !== 'function') {
        return itemOf('assets', 'кэш ассетов', null, null, 'unknown', '$.resource.stats()',
                      '$.resource не установлен в этой сборке');
    }
    let stats = null;
    try { stats = r.stats(); } catch (e) { stats = null; }
    const item = itemOf('assets', 'кэш ассетов', stats && stats.total, null, 'unknown',
                        '$.resource.stats()', 'реестр ресурсов считает записи, но не байты');
    item.extra = stats ? { ready: numOrNull(stats.ready), defined: numOrNull(stats.defined),
                           failed: numOrNull(stats.failed), requests: numOrNull(stats.requests) } : null;
    return item;
}

function jsHeapResource() {
    const mem = (ctx.debug && typeof ctx.debug.memory === 'function') ? ctx.debug.memory() : null;
    const bytes = mem ? numOrNull(mem.bytes) : null;
    const item = itemOf('js_heap', 'JS-куча (QuickJS)', mem && numOrNull(mem.objects), bytes,
                        bytes === null ? 'unknown' : 'exact', '$.debug.memory()',
                        'точный отчёт JS_ComputeMemoryUsage; это не GPU-память');
    item.extra = mem ? { used: numOrNull(mem.used), arrays: numOrNull(mem.arrays),
                          strings: numOrNull(mem.strings), atoms: numOrNull(mem.atoms) } : null;
    return item;
}

function updatePeak(item, frame) {
    let peak = resource_peaks.get(item.key);
    if (!peak) { peak = { count: null, bytes: null, frame: null }; resource_peaks.set(item.key, peak); }
    if (item.count !== null && (peak.count === null || item.count > peak.count)) {
        peak.count = item.count;
        peak.frame = frame;
    }
    if (item.bytes !== null && (peak.bytes === null || item.bytes > peak.bytes)) {
        peak.bytes = item.bytes;
        peak.frame = frame;
    }
    item.peak = { count: peak.count, bytes: peak.bytes, frame: peak.frame };
}

function budgetViolation(item) {
    const b = resource_budgets.get(item.key);
    if (!b) return null;
    const out = [];
    if (b.count !== undefined && b.count !== null && item.count !== null && item.count > b.count) {
        out.push({ kind: 'count', limit: b.count, actual: item.count });
    }
    if (b.bytes !== undefined && b.bytes !== null && item.bytes !== null && item.bytes > b.bytes) {
        out.push({ kind: 'bytes', limit: b.bytes, actual: item.bytes });
    }
    return out.length ? out : null;
}

function warnBudget($, item, violation) {
    const warnings = [];
    for (const v of violation) {
        const tag = item.key + ':' + v.kind;
        if (resource_warned.has(tag)) continue;
        resource_warned.add(tag);
        const actual = v.kind === 'bytes' ? bytesText(v.actual) : String(v.actual);
        const limit = v.kind === 'bytes' ? bytesText(v.limit) : String(v.limit);
        const message = 'ресурс "' + item.key + '" (' + item.label + ') превысил бюджет '
            + v.kind + ': ' + actual + ' > ' + limit;
        if ($ && $.debug && typeof $.debug.reportError === 'function') {
            $.debug.reportError('resources.budget', new Error(message), {
                code: 'R2D_RESOURCE_BUDGET',
                subsystem: 'resources',
                recoverable: true,
                data: { key: item.key, kind: v.kind, limit: v.limit, actual: v.actual, basis: item.basis },
            });
        } else {
            ctx.log('$: ' + message);
        }
        warnings.push({ key: item.key, kind: v.kind, limit: v.limit, actual: v.actual,
                        basis: item.basis, message });
    }
    return warnings;
}

function clearUnderBudget(item) {
    const b = resource_budgets.get(item.key);
    if (!b) return;
    for (const kind of ['count', 'bytes']) {
        const limit = b[kind];
        const actual = item[kind];
        if (limit === undefined || limit === null || actual === null || actual <= limit) {
            resource_warned.delete(item.key + ':' + kind);
        }
    }
}

function budgetSnapshot() {
    const out = {};
    for (const [key, value] of resource_budgets) out[key] = { bytes: value.bytes, count: value.count };
    return out;
}

function parseBudgetValue(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) return null;
        return { bytes: value, count: null };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const out = { bytes: null, count: null };
    let any = false;
    for (const kind of ['bytes', 'count']) {
        if (value[kind] === undefined || value[kind] === null) continue;
        const n = Number(value[kind]);
        if (!Number.isFinite(n) || n < 0) return null;
        out[kind] = n;
        any = true;
    }
    return any ? out : null;
}

function setBudgets(spec) {
    const invalid = [];
    const unknown = [];
    let changed = 0;
    for (const raw_key of Object.keys(spec || {})) {
        const key = RESOURCE_ALIASES[raw_key] || null;
        if (!key) { unknown.push(raw_key); continue; }
        const value = spec[raw_key];
        if (value === null || value === false) {
            resource_budgets.delete(key);
            for (const tag of [...resource_warned]) if (tag.indexOf(key + ':') === 0) resource_warned.delete(tag);
            changed++;
            continue;
        }
        const parsed = parseBudgetValue(value);
        if (!parsed) { invalid.push(raw_key); continue; }
        resource_budgets.set(key, parsed);
        for (const tag of [...resource_warned]) if (tag.indexOf(key + ':') === 0) resource_warned.delete(tag);
        changed++;
    }
    const error = (invalid.length || unknown.length)
        ? 'бюджеты: неизвестные ключи ' + unknown.join(', ')
          + (invalid.length ? '; неверные значения ' + invalid.join(', ') : '')
        : null;
    return { ok: error === null, changed, invalid, unknown,
             budgets: budgetSnapshot(), keys: RESOURCE_KEYS.slice(), error };
}

function sampleResources($) {
    const limits = engineLimits();
    const counters = collectCounters();
    const frame = numOrNull(engine && engine.frame);
    const items = [
        textureResource(limits),
        audioResource(),
        fontsResource(),
        uiResource(limits),
        entitiesResource(counters),
        physicsResource(counters, limits),
        particlesResource(counters),
        assetsResource(),
        jsHeapResource(),
    ];
    const warnings = [];
    for (const item of items) {
        updatePeak(item, frame);
        clearUnderBudget(item);
        const violation = budgetViolation(item);
        if (violation) warnings.push(...warnBudget($, item, violation));
    }
    let measured = 0;
    let unknown_bytes = 0;
    const by_basis = {};
    for (const item of items) {
        by_basis[item.basis] = (by_basis[item.basis] || 0) + 1;
        if (item.bytes !== null) measured += item.bytes;
        else unknown_bytes++;
    }
    const lines = items.map((item) => {
        const peak = item.peak.count === null && item.peak.bytes === null
            ? 'пик N/A'
            : 'пик ' + formatCount(item.peak.count)
              + (item.peak.bytes === null ? '' : ' / ' + bytesText(item.peak.bytes));
        const biggest = item.biggest
            ? '; крупнейший: ' + item.biggest.name
              + (item.biggest.detail ? ' ' + item.biggest.detail : '')
              + (item.biggest.bytes === null ? '' : ' ' + bytesText(item.biggest.bytes))
            : '';
        return item.label + ': ' + formatValue(item) + ' [' + item.basis + '] (' + peak + ')' + biggest;
    });
    const text = 'Ресурсы (кадр ' + formatCount(frame) + '):\n' + lines.join('\n')
        + '\nизмерено байт: ' + bytesText(measured)
        + '; без байтовой оценки: ' + unknown_bytes + ' из ' + items.length;
    return {
        ok: true,
        frame,
        items,
        totals: { measured_bytes: measured, unknown_bytes, by_basis,
                  count: items.reduce((n, it) => n + (it.count === null ? 0 : it.count), 0) },
        budgets: budgetSnapshot(),
        warnings,
        text,
    };
}

export function installDebug($) {
    const debug = {
        overlay: false,

        /** Показать/скрыть отладочный оверлей движка (то же, что F1). */
        on() {
            debug.overlay = ctx.devtools ? ctx.devtools.openRuntime() : false;
            return debug;
        },
        off() {
            debug.overlay = false;
            if (ctx.devtools) ctx.devtools.closeRuntime();
            return debug;
        },
        toggle() { return debug.isOn() ? debug.off() : debug.on(); },
        isOn() { return ctx.devtools ? ctx.devtools.runtimePanel().open : debug.overlay; },

        /** Метаданные живых GPU-текстур: тот же список, который видит DevTools. */
        textures() { return typeof engine.debugTextures === 'function' ? engine.debugTextures() : []; },

        /** Сводка по кадру: FPS, спрайты, узлы, тела, звук. */
        stats() {
            const gfx = ctx.gfx ? ctx.gfx.stats() : { sprites: 0, triangles: 0, texts: 0 };
            return {
                fps: Math.round(engine.fps * 10) / 10,
                frame_ms: Math.round(engine.dt * 10000) / 10,
                sprites: gfx.sprites,
                triangles: gfx.triangles,
                texts: gfx.texts,
                nodes: ctx.nodes.length,
                ui_nodes: ctx.nodes.filter((n) => n.attrs.ui).length,
                bodies: engine.bodyCount(),
                tweens: ctx.tweens_active ? ctx.tweens_active() : 0,
                sounds: ctx.sound ? ctx.sound.activeChannels() : 0,
                frame: engine.frame,
                counters: debug.counters(),
            };
        },

        /**
         * Счётчики подсистем: узлы, тела, частицы, активные твины, зоны и
         * объекты пулов. Обновляются в tickPool(), но при запросе считаются
         * заново — так значение верно и до первого кадра.
         */
        counters() { return collectCounters(); },

        /**
         * Занятость таблиц движка и их потолки: текстуры, спрайты, тела,
         * суставы, пользовательские шейдеры, эффекты узлов, вьюпорты, запросы,
         * события контакта, очередь текста, обработчики UI, документы RmlUi.
         *
         * Зачем: половина лимитов нигде не была видна, а поведение при
         * достижении разное — от «вернётся -1» до молчаливой потери события.
         * Читайте перед загрузкой уровня: `$.debug.limits().textures`.
         */
        limits() {
            return typeof engine.limits === 'function'
                ? engine.limits()
                : { textures: 0, textures_max: 256 };
        },

        /**
         * Одна таблица ресурсов из существующих источников: текстуры, звук,
         * шрифты, RmlUi-документы, узлы, тела, частицы, кэш ассетов, JS-куча.
         *
         * У каждого пункта есть `count`, `bytes` (или null), `basis`
         * ('exact' | 'estimated' | 'cpu-side-only' | 'unknown'), `limit`,
         * `peak`, `biggest` и `source`. Выдуманных байтов нет: где движок
         * память не отдаёт, `bytes: null` и `basis: 'unknown'`.
         *
         * Вызывайте явно: пока DevTools закрыт, опроса и таймеров нет.
         *
         * ```js
         * const r = $.debug.resources();
         * r.items.find((x) => x.key === 'textures').top;   // топ по байтам
         * ```
         */
        resources(opts) {
            const out = sampleResources($);
            const top = opts && Number(opts.top);
            if (Number.isFinite(top) && top > 0) {
                for (const item of out.items) {
                    if (item.top.length > top) {
                        item.top = item.top.slice(0, top);
                        item.biggest = item.top[0] || null;
                    }
                }
            }
            return out;
        },

        /**
         * Бюджеты разработчика. Без аргумента — текущие; с объектом — выставить.
         *
         * ```js
         * $.debug.budget({ textures: { bytes: 64 * 1024 * 1024, count: 64 },
         *                  entities: { count: 500 }, audio: 32 });
         * ```
         *
         * Число — это бюджет байтов. `null` / `false` снимают бюджет.
         * Превышение даёт ОДНО структурное предупреждение
         * (`R2D_RESOURCE_BUDGET` через `$.debug.reportError`) на ключ и вид
         * бюджета; пока значение снова не войдёт в бюджет, повторного нет.
         */
        budget(spec) {
            if (spec === undefined) {
                return { ok: true, budgets: budgetSnapshot(), keys: RESOURCE_KEYS.slice(), error: null };
            }
            if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
                return { ok: false, budgets: budgetSnapshot(), keys: RESOURCE_KEYS.slice(),
                         changed: 0, invalid: [], unknown: [],
                         error: '$.debug.budget: нужен объект вида { textures: { bytes, count } }' };
            }
            return setBudgets(spec);
        },

        /** Сбросить накопленные пики ресурсов (сами замеры не трогает). */
        resourcesResetPeaks() {
            resource_peaks.clear();
            return true;
        },

        /**
         * Примитивы поверх кадра. Принимают точки, узлы и селекторы:
         *   $.debug.draw.line('#hero', '#exit', 'yellow');
         *
         * Координаты — МИРОВЫЕ: `$.gfx.draw.*` рисует в координатах окна
         * (см. docs/highlevel/fx.md), а отладка обязана липнуть к объектам,
         * поэтому мир→экран переводим здесь. Раньше перевода не было, и при
         * сдвинутой камере линия между узлами уезжала ровно на её смещение —
         * поймано пиксельной проверкой в devtools (§21).
         */
        draw: {
            line(a, b, color, width) {
                const p = toScreen(point(a)), q = toScreen(point(b));
                ctx.gfx.draw.line(p.x, p.y, q.x, q.y, color, width);
            },
            rect(a, b, color) {
                const p = toScreen(point(a)), q = toScreen(point(b));
                ctx.gfx.draw.rect(Math.min(p.x, q.x), Math.min(p.y, q.y),
                                  Math.abs(q.x - p.x), Math.abs(q.y - p.y), color);
            },
            circle(a, r, color) {
                const p = toScreen(point(a));
                ctx.gfx.draw.circle(p.x, p.y, r, color);
            },
            ring(a, r, color, width) {
                const p = toScreen(point(a));
                ctx.gfx.draw.ring(p.x, p.y, r, color, width);
            },
            text(text, a, color, size) {
                const p = toScreen(point(a));
                ctx.gfx.draw.text(text, p.x, p.y, color, size);
            },
            arrow(a, b, color) {
                const p = toScreen(point(a)), q = toScreen(point(b));
                ctx.gfx.draw.arrow(p.x, p.y, q.x, q.y, color);
            },
        },

        /**
         * Значение на экране. Принимает функцию или готовое число.
         *   $.debug.watch('hp', () => $('#hero').hp());
         */
        watch(name, value) {
            watches.push({ name, value });
            return debug;
        },
        unwatch(name) {
            const i = watches.findIndex((w) => w.name === name);
            if (i >= 0) watches.splice(i, 1);
            return debug;
        },
        watches() { return watches.map((w) => ({ name: w.name, value: evalWatch(w) })); },

        /**
         * Снимок профайлера движка: время по зонам кадра (JS-логика, сборка
         * батча, физика, ожидание swapchain, загрузка VB/IB, draw-команды,
         * интерфейс), среднее и пик за последние 120 кадров.
         *
         * ```js
         * const p = $.debug.profile();
         * for (const z of p.zones) if (z.ms > 0.5) $.log(`${z.name}: ${z.ms.toFixed(2)} мс`);
         * ```
         */
        profile() {
            return typeof engine.profile === 'function' ? engine.profile() : null;
        },

        /** Сбросить накопленную статистику профайлера движка. */
        profileReset() {
            if (typeof engine.profileReset === 'function') engine.profileReset();
        },

        /**
         * Диагностика последнего нативного запроса — `$('.enemy').within(...)`,
         * который идёт через `engine.queryCircle`.
         *
         * ```js
         * $('.enemy').within('#hero', 500);
         * $.debug.queryStats();   // { calls, candidates, results, ms, cap, truncated }
         * ```
         *
         * `candidates` — сколько тел дал broadphase Box2D, `results` — сколько
         * прошло отсев по расстоянию, `ms` — время последнего вызова, `cap` —
         * предел (256), `truncated` — упёрлись ли в предел. Только факты.
         */
        queryStats() {
            return typeof engine.queryStats === 'function' ? engine.queryStats() : null;
        },

        /** Включить/выключить профайлер движка; без аргумента — состояние. */
        profiling(on) {
            return typeof engine.profileEnabled === 'function' ? engine.profileEnabled(on) : false;
        },

        /** Профайлер по кадрам: меряет время между start и end. */
        /**
         * Нативные проходы кадра (src/nodes.c): синк физики, события мира,
         * наведение, сортировка и сборка батча. `false` возвращает прежний
         * JS-путь — для сверки картинки и поиска расхождений. Без аргумента —
         * работают ли они сейчас.
         */
        /**
         * Факты о JS-куче (QuickJS JS_ComputeMemoryUsage): `{ bytes, used,
         * objects, arrays, strings, atoms, shapes, native_tweens }`. Без
         * движка — null. Нужен, чтобы отличать утечку от шума замера.
         */
        /**
         * Факты рендера кадра: `{ info, depth }` — engine.renderInfo()
         * (пост-обработка, bloom, проходы) и engine.depthInfo() (меш и
         * z-буфер). Без движка — null.
         */
        render() {
            if (!engine || typeof engine.renderInfo !== 'function') return null;
            return {
                info: engine.renderInfo(),
                depth: typeof engine.depthInfo === 'function' ? engine.depthInfo() : null,
            };
        },

        memory() {
            const n = engine && engine.nodes;
            return n && typeof n === 'object' && typeof n.memory === 'function' ? n.memory() : null;
        },

        nativePasses(flag) {
            if (flag === undefined) return nativeNodes() !== null;
            ctx.native_off = !flag;
            return debug;
        },

        profiler: {
            /**
             * Покадровый профайлер подсистем включён? По умолчанию выключен:
             * 24 метки за кадр — это 24 вызова engine.now() и 24 поиска в Map
             * по строке, то есть плата в каждом кадре релизной игры ни за что
             * (docs/HIGH_LEVEL_API_PERF.md §3.7).
             */
            enabled: false,
            /** Текущее время для замеров: монотонные мс от движка. */
            /**
             * Миллисекунды. В движке это монотонные engine.now(); в хосте и
             * тестах его заглушка возвращает ноль, поэтому тогда берём время
             * кадра — иначе замеры внутри кадра выходили нулевыми.
             */
            now() {
                if (typeof engine.now === 'function') {
                    const v = engine.now();
                    if (typeof v === 'number' && v > 0) return v;
                }
                return (engine.time || 0) * 1000;
            },
            /**
             * Включить/выключить покадровый профайлер подсистем; без аргумента
             * просто включает. Возвращает сам profiler — для цепочек.
             *
             *   $.debug.profiler.on(true);   // начать мерить подсистемы кадра
             *   …игра…
             *   $.debug.profiler.report();   // { 'слои': { avg_ms, … }, … }
             */
            on(flag) {
                debug.profiler.enabled = flag === undefined ? true : !!flag;
                if (!debug.profiler.enabled) timers.clear();
                return debug.profiler;
            },
            /** Включён ли покадровый профайлер. */
            isOn() { return debug.profiler.enabled; },
            start(name) {
                // Раньше запись создавалась заново на каждом start(), а start()
                // зовут каждый кадр — total/calls/max обнулялись, и report()
                // показывал только последний кадр. Теперь статистика копится,
                // а сбрасывает её только reset().
                const existing = timers.get(name);
                if (existing) {
                    existing.at = debug.profiler.now();
                    return;
                }
                timers.set(name, { at: debug.profiler.now(), total: 0, calls: 0, max: 0 });
            },
            end(name) {
                const t = timers.get(name);
                if (!t) return;
                const dt = debug.profiler.now() - t.at;
                t.total += dt;
                t.calls++;
                t.max = Math.max(t.max, dt);
            },
            /** Записать готовое измерение (когда время считает сам вызов). */
            record(name, ms) {
                const t = timers.get(name) || { at: debug.profiler.now(), total: 0, calls: 0, max: 0 };
                timers.set(name, t);
                t.total += ms;
                t.calls++;
                t.max = Math.max(t.max, ms);
            },
            report() {
                const out = {};
                for (const [name, t] of timers) {
                    out[name] = {
                        calls: t.calls,
                        avg_ms: t.calls ? Math.round((t.total / t.calls) * 100) / 100 : 0,
                        max_ms: Math.round(t.max * 100) / 100,
                    };
                }
                return out;
            },
            reset() { timers.clear(); return debug; },
        },

        /** Внутреннее: рисует список watch поверх кадра. */
        _render() {
            if (watches.length === 0) return;
            if (!debug.isOn()) return;
            let y = 90;
            ctx.gfx.text('— наблюдение ($.debug.watch) —', 12, y - 22, { size: 15, color: '#8fd1ff' });
            for (const w of watches) {
                ctx.gfx.text(`${w.name}: ${evalWatch(w)}`, 12, y, { size: 15, color: '#d8e2ee' });
                y += 18;
            }
        },
    };

    // --- Консоль -------------------------------------------------------------

    const console_api = {
        /** register('spawn', (args) => ...) — args всегда массив строк. */
        register(name, fn, help) {
            commands.set(name, { fn, help: help || '' });
            return console_api;
        },
        unregister(name) { commands.delete(name); return console_api; },
        list() { return [...commands.keys()].sort(); },
        help(name) {
            const c = commands.get(name);
            return c ? c.help : null;
        },

        /** Выполнить строку: 'spawn 100 200'. Числа приводятся к number. */
        run(line) {
            const parts = String(line).trim().split(/\s+/);
            const name = parts.shift();
            const cmd = commands.get(name);
            if (!cmd) { ctx.log(`$: неизвестная команда консоли "${name}"`); return false; }
            const args = parts.map((p) => (/^-?\d+(\.\d+)?$/.test(p) ? parseFloat(p) : p));
            try { cmd.fn(args); return true; }
            catch (e) { ctx.log(`$: ошибка в команде "${name}": ${e}`); return false; }
        },

        /** Показать/скрыть отладочный оверлей (там же журнал и консоль движка). */
        toggle() { return debug.toggle(); },
    };

    ctx.debug = debug;
    ctx.console = console_api;
    return { debug, console: console_api };
}

function evalWatch(w) {
    try { return typeof w.value === 'function' ? w.value() : w.value; }
    catch (e) { return `ошибка: ${e}`; }
}

/**
 * Мир → экран для отладочных примитивов. Камера может отсутствовать (тесты без
 * мира) — тогда координаты остаются как есть, а не превращаются в NaN.
 */
function toScreen(p) {
    const cam = ctx.camera;
    if (!cam || typeof cam.worldToScreen !== 'function') return p;
    const s = cam.worldToScreen(p);
    return (s && typeof s.x === 'number') ? s : p;
}

function point(what) {
    if (typeof what === 'string') {
        const n = query(what)[0];
        return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    }
    if (typeof what === 'object' && what && what.tag) return { x: what.x, y: what.y };
    if (typeof what === 'object' && what && what.nodes) {
        const n = what.nodes[0];
        return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    }
    if (Array.isArray(what)) return { x: what[0], y: what[1] };
    return { x: (what && what.x) || 0, y: (what && what.y) || 0 };
}
