// ===========================================================================
// Именованные слои коллизий: $.collision.define('walls', 0x1) и маски по именам.
//
// Зачем: Box2D понимает только биты (`layerBits`/`mask`), а в игре удобнее
// писать «стены и враги», а не `0x1 | 0x2`. Подсистема даёт имена битам и
// умеет собирать из имён выражения для уже существующих методов узла
// (`.layerBits()`, `.mask()`, `.collidesWith()`) — сами методы ядра не
// меняются.
//
//   $.collision.define('walls',   0x1);       // имя → бит
//   $.collision.define('enemies', 0x2);
//   $.collision.define('player',  0x4, { all: ['walls', 'enemies'] });  // своя маска
//
//   $('<wall>').layerBits('walls');
//   $('#hero').mask($.collision.mask('walls|enemies'));   // число для ядра
//   $('#hero').maskBy('walls|enemies');                // то же методом узла
//   $('#hero').maskBy('!enemies');                     // убрать слой из маски
//
//   $.collision.names();          // ['enemies', 'player', 'walls']
//   $.collision.bits('walls');    // 1
//   $.collision.has('walls');
//   $.collision.list();           // [{ name, bit, mask }]
//
// Значения хранятся в $.store под ключом collision.layers, поэтому переживают
// смену сцены и hot reload. Определение тем же именем перезаписывает бит.
//
// Чистые функции (parseLayerExpression/normalizeLayers) экспортируются — их
// проверяет qjs-харнесс без движка (§4 контракта).
// ===========================================================================

import { ctx, def, query } from './core.js';

/** Ключ в $.store, под которым лежит реестр слоёв. */
export const LAYERS_KEY = 'collision.layers';

/** Максимальный бит: у Box2D 16 категорий, дальше маски не имеют смысла. */
export const MAX_LAYER_BIT = 15;

// ---------------------------------------------------------------------------
// Чистая часть
// ---------------------------------------------------------------------------

/** Нормализует реестр из любого источника в { name: { bit, mask } }. */
export function normalizeLayers(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const name of Object.keys(raw)) {
        const entry = raw[name];
        const bit = typeof entry === 'number' ? entry : (entry && Number(entry.bit));
        if (!Number.isFinite(bit)) continue;
        const mask = entry && typeof entry === 'object' && entry.mask !== undefined
            ? Number(entry.mask) >>> 0
            : undefined;
        const clean = String(name).trim();
        if (!clean) continue;
        out[clean] = { bit: bit >>> 0, mask };
    }
    return out;
}

/** Бит по имени: число, имя реестра или набор имён через `|`. */
export function layerBitOf(registry, name) {
    if (typeof name === 'number') return name >>> 0;
    const text = String(name).trim();
    if (!text) return 0;
    if (/^0x[0-9a-f]+$/i.test(text) || /^\d+$/.test(text)) return Number(text) >>> 0;
    let bits = 0;
    for (const part of text.split('|')) {
        const key = part.trim();
        if (!key) continue;
        const entry = registry[key];
        if (!entry) return 0;
        bits |= entry.bit;
    }
    return bits >>> 0;
}

/**
 * Выражение маски: `'walls|enemies'` — эти слои, `'!enemies'` — убрать слой,
 * `'all'` — все известные слои, `'none'` — ноль. Ведущий `!` применяется к
 * базе: по умолчанию это `all` (маска «со всеми, кроме перечисленных»), поэтому
 * `'!enemies'` читается как «со всеми, кроме врагов».
 */
export function parseLayerExpression(registry, expression, base) {
    if (typeof expression === 'number') return expression >>> 0;
    const text = String(expression === undefined || expression === null ? 'all' : expression).trim();
    if (!text) return base === undefined ? 0xffffffff : base >>> 0;

    const allBits = () => {
        let bits = 0;
        for (const name of Object.keys(registry)) bits |= registry[name].bit;
        return bits >>> 0;
    };

    if (text === 'all' || text === '*') return 0xffffffff;
    if (text === 'none' || text === '0') return 0;

    const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
    const remove = parts.filter((p) => p.startsWith('!'));
    const add = parts.filter((p) => !p.startsWith('!'));

    let bits = base === undefined ? (remove.length ? allBits() : 0) : base >>> 0;
    for (const part of add) {
        if (part === 'all' || part === '*') { bits = 0xffffffff; continue; }
        bits |= layerBitOf(registry, part);
    }
    for (const part of remove) bits &= ~layerBitOf(registry, part.slice(1));
    return bits >>> 0;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

const registry = new Map();   // name → { bit, mask }

function store() { return ctx.store || null; }

function persist() {
    const s = store();
    if (!s || typeof s.set !== 'function') return;
    const raw = {};
    for (const [name, entry] of registry) {
        raw[name] = entry.mask === undefined ? entry.bit : { bit: entry.bit, mask: entry.mask };
    }
    s.set(LAYERS_KEY, raw);
}

function load() {
    registry.clear();
    const s = store();
    if (!s || typeof s.get !== 'function') return;
    const raw = normalizeLayers(s.get(LAYERS_KEY));
    for (const name of Object.keys(raw)) registry.set(name, raw[name]);
}

function asObject() {
    const out = {};
    for (const [name, entry] of registry) out[name] = entry;
    return out;
}

function resolveName(value) {
    if (typeof value === 'string') return value;
    const node = value && value.nodes ? value.nodes[0] : value;
    const name = node && node.attrs && node.attrs.layer;
    return typeof name === 'string' ? name : '';
}

export function installCollisionLayers($) {
    const collision = {
        /** Объявить имя: $.collision.define('walls', 0x1, { all: true }). */
        define(name, bit, opts) {
            const key = String(name || '').trim();
            if (!key) { ctx.log('$.collision.define: нужно имя слоя'); return collision; }
            let value = bit;
            if (typeof value === 'string') value = layerBitOf(asObject(), value);
            if (!Number.isFinite(value) || value <= 0) {
                ctx.log(`$.collision.define("${key}"): нужен бит (1, 2, 4, …), получено ${bit}`);
                return collision;
            }
            if (value > (1 << MAX_LAYER_BIT)) {
                ctx.log(`$.collision.define("${key}"): бит ${value} выше разумного (до ${1 << MAX_LAYER_BIT})`);
                return collision;
            }
            const spec = opts || {};
            let mask;
            if (spec.all === true) mask = 0xffffffff;
            else if (spec.all !== undefined) mask = layerBitOf(asObject(), spec.all);
            else if (spec.mask !== undefined) mask = layerBitOf(asObject(), spec.mask);
            registry.set(key, { bit: value >>> 0, mask });
            persist();
            return collision;
        },

        /** Забыть имя. */
        remove(name) {
            const ok = registry.delete(String(name));
            if (ok) persist();
            return ok;
        },

        /** Очистить реестр. */
        clear() {
            registry.clear();
            persist();
            return collision;
        },

        /** Есть ли имя. */
        has(name) { return registry.has(String(name)); },

        /** Бит по имени (0, если имени нет). */
        bits(name) { return layerBitOf(asObject(), name); },

        /** Число для .mask(): выражение с `|`, `!`, `all`, `none`. */
        mask(expression) { return parseLayerExpression(asObject(), expression); },

        /** Собрать маску из всех слоёв, кроме перечисленных. */
        allExcept(...names) {
            let bits = 0xffffffff;
            for (const name of names) bits &= ~layerBitOf(asObject(), name);
            return bits >>> 0;
        },

        /** Имена по алфавиту. */
        names() { return [...registry.keys()].sort(); },

        /** Реестр целиком: [{ name, bit, mask }]. */
        list() {
            return collision.names().map((name) => ({
                name,
                bit: registry.get(name).bit,
                mask: registry.get(name).mask,
            }));
        },

        /**
         * Применить слой узлу: .layerBits() из имени плюс, если задана, маска
         * (`opts.all`/`opts.mask` или маска из define).
         */
        apply(target, name, opts) {
            const key = String(name || '').trim();
            if (!registry.has(key)) {
                ctx.log(`$.collision.apply: неизвестный слой "${key}" — см. $.collision.names()`);
                return collision;
            }
            const entry = registry.get(key);
            const spec = opts || {};
            const nodes = target && target.nodes ? target.nodes : (typeof target === 'string' ? query(target) : [target]);
            for (const node of nodes) {
                if (!node || !node.set) continue;
                node.set('layerBits', entry.bit);
                node.attrs.layer = key;
                const mask = spec.mask !== undefined ? layerBitOf(asObject(), spec.mask)
                    : (spec.all === true ? 0xffffffff
                       : (spec.all !== undefined ? layerBitOf(asObject(), spec.all) : entry.mask));
                if (mask !== undefined) node.set('mask', mask >>> 0);
            }
            return collision;
        },

        /** Имя слоя узла (если он поставлен через apply). */
        of(target) {
            const node = target && target.nodes ? target.nodes[0] : target;
            const name = node && node.attrs && node.attrs.layer;
            return typeof name === 'string' && registry.has(name) ? name : null;
        },

        /** Бит, ещё не занятый ни одним именем: удобно для define подряд. */
        freeBit() {
            let used = 0;
            for (const entry of registry.values()) used |= entry.bit;
            for (let i = 0; i <= MAX_LAYER_BIT; ++i) {
                const bit = 1 << i;
                if (!(used & bit)) return bit;
            }
            return 0;
        },

        /** Перечитать реестр из $.store (после load/import сохранения). */
        reload() { load(); return collision; },
    };

    // --- методы узла --------------------------------------------------------
    def('maskBy', function (expression) {
        if (expression === undefined) {
            const node = this.nodes[0];
            return node ? node.collision_mask : 0xffffffff;
        }
        const bits = parseLayerExpression(asObject(), expression);
        return this.eachNode((_, node) => { node.set('mask', bits); });
    });

    def('layerName', function (name) {
        if (name === undefined) return collision.of(this.nodes[0]);
        const key = String(name || '').trim();
        if (!registry.has(key)) {
            ctx.log(`$.layerName: неизвестный слой "${key}" — см. $.collision.names()`);
            return this;
        }
        const bit = registry.get(key).bit;
        return this.eachNode((_, node) => {
            node.set('layerBits', bit);
            node.attrs.layer = key;
        });
    });

    // Пространство имён отдельное: $.layers занят канвас-слоями и параллаксом
    // (src/highlevel/layers.js), смешивать их в одном объекте нельзя.
    $.collision = collision;
    ctx.collision = collision;
    load();

    return collision;
}
