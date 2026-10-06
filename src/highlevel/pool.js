// ===========================================================================
// Пул объектов: переиспользование узлов для пуль, частиц, врагов.
//
// Зачем: выстрел каждые 100 мс за минуту боя — это 600 новых узлов и 600 тел
// Box2D, которые потом надо собрать сборщиком мусора. Пул создаёт узел один
// раз, а дальше выдаёт и принимает его обратно.
//
// Освобождённый узел НЕ уничтожается: он убирается из реестра мира
// (ctx.nodes), теряет физическое тело (Box2D) и ждёт в списке свободных
// следующего spawn(). Из-за этого его не видит отрисовка, не находит
// селектор и не считает $.world.count() — узел как бы вышел из мира.
//
// Контракт модуля: installPool($) и tickPool(dt).
// Чистые части (normalizePoolSpec, collectCounters) экспортируются наружу —
// их гоняет qjs-харнесс без движка.
// ===========================================================================

import { ctx, Node, TAGS, wrap, wrapOne, def } from './core.js';

// Ключи spec, которые описывают сам пул, а не атрибуты узла.
const POOL_KEYS = new Set([
    'name', 'tag', 'max', 'initial', 'prewarm', 'parent', 'onAcquire', 'onRelease',
]);

const DEFAULT_TAG = 'rect';
const DEFAULT_MAX = 128;

// Имя → внутреннее состояние пула; узел → его пул (для метода .release()).
const pools = new Map();
const node_pool = new WeakMap();

// ---------------------------------------------------------------------------
// Разбор спецификации (чистая функция)
// ---------------------------------------------------------------------------

function clampInt(value, min, max, fallback) {
    const v = Number(value);
    if (!Number.isFinite(v)) return fallback;
    const i = Math.floor(v);
    return i < min ? min : (i > max ? max : i);
}

/**
 * Сырой spec → нормализованное описание пула. Всё, что не является настройкой
 * пула (max, initial, callbacks…), считается атрибутами узла: например
 * `{ name: 'bullets', tag: 'bullet', speed: 400, color: '#fc0' }`.
 */
export function normalizePoolSpec(spec) {
    const s = spec || {};
    const attrs = {};
    for (const key of Object.keys(s)) {
        if (!POOL_KEYS.has(key)) attrs[key] = s[key];
    }
    const max = clampInt(s.max, 1, 1000000, DEFAULT_MAX);
    const initial = clampInt(s.initial !== undefined ? s.initial : s.prewarm, 0, max, 0);
    return {
        name: s.name !== undefined ? String(s.name) : '',
        tag: s.tag !== undefined ? String(s.tag) : DEFAULT_TAG,
        max,
        initial,
        parent: s.parent,
        onAcquire: typeof s.onAcquire === 'function' ? s.onAcquire : null,
        onRelease: typeof s.onRelease === 'function' ? s.onRelease : null,
        attrs,
    };
}

// ---------------------------------------------------------------------------
// Внутреннее состояние пула
// ---------------------------------------------------------------------------

function makePoolState(spec) {
    const st = {
        spec,
        free: [],       // готовые узлы, ждущие spawn
        active: [],     // выданные узлы, в порядке выдачи
        created: 0,     // сколько узлов всего создано (растёт до max)
        spawned: 0,
        released: 0,
        skipped: 0,     // spawn не нашёл места
        baseline: null, // снимок исходного состояния узла
        body_kind: TAGS[spec.tag] ? (TAGS[spec.tag].body || null) : null,
        pool: null,
    };

    st.pool = {
        name: spec.name,
        tag: spec.tag,
        max: spec.max,
        get created() { return st.created; },
        get active() { return st.active.length; },
        get free() { return st.free.length; },
        get spawned() { return st.spawned; },
        get released() { return st.released; },
        get skipped() { return st.skipped; },

        /** Выдать узел; opts — атрибуты поверх шаблона пула (в т. ч. x, y). */
        spawn(opts) { return spawnFrom(st, opts); },
        /** Вернуть узел в пул; false — узел не из этого пула или уже свободен. */
        release(node) { return releaseOne(st, asNode(node)); },
        /** Вернуть все выданные узлы; возвращает их число. */
        releaseAll() { return releaseAllFrom(st); },
        /** Уничтожить все узлы пула (сам пул остаётся зарегистрированным). */
        clear() { destroyPoolNodes(st); return st.pool; },
        /** Обёртка со всеми выданными узлами. */
        nodes() { return wrap(st.active.slice()); },
        stats() { return poolStats(st); },
    };
    return st;
}

function asNode(value) {
    if (value && value.nodes) return value.nodes[0] || null;
    return value || null;
}

function poolStats(st) {
    return {
        name: st.spec.name,
        tag: st.spec.tag,
        max: st.spec.max,
        created: st.created,
        active: st.active.length,
        free: st.free.length,
        spawned: st.spawned,
        released: st.released,
        skipped: st.skipped,
    };
}

// ---------------------------------------------------------------------------
// Узлы
// ---------------------------------------------------------------------------

function newPoolNode(st) {
    const node = new Node(st.spec.tag, Object.assign({}, st.spec.attrs));
    node.visible = false;   // узел ещё не в мире
    node_pool.set(node, st);
    // Конструктор Node регистрирует узел в ctx.nodes; у пула узел попадает
    // в мир только на время между spawn() и release().
    detachNode(node);
    // Конструктор успел создать тело (у <bullet>, <enemy>, <wall> оно есть по
    // тегу). У свободного узла тела быть не должно: иначе предсозданные узлы
    // пула висят в мире в точке (0,0), сталкиваются и тратят физику, хотя их
    // нет ни в ctx.nodes, ни в счётчиках. Тело вернёт restoreBody() на spawn.
    if (node.body >= 0) node.setBody(null);
    if (!st.baseline) {
        st.baseline = {
            x: node.x, y: node.y, color: node.color, layer: node.layer,
            classes: new Set(node.classes),
            tags: new Set(node.tags_extra),
            attrs: Object.assign({}, node.attrs),
        };
    }
    return node;
}

/**
 * Возвращает узел к исходному состоянию (до первого spawn). Нужно, чтобы
 * выданный однажды узел не тащил в следующий spawn чужие координаты, классы
 * и атрибуты.
 */
function resetNode(node, st) {
    const b = st.baseline;
    node.classes = new Set(b.classes);
    node.tags_extra = new Set(b.tags);
    node.attrs = Object.assign({}, b.attrs);
    node.x = b.x;
    node.y = b.y;
    node.angle = 0;
    node.scale_x = 1;
    node.scale_y = 1;
    node.alpha = 1;
    node.color = b.color;
    node.layer = b.layer;
    node.visible = true;
    node.tint = null;
    node.tint_timer = 0;
    node.shake_timer = 0;
    node.velocity_cache = { x: 0, y: 0 };
    node.cur_hp = node.max_hp;
    applyAttrs(node, st.spec.attrs);
}

/** Применяет атрибуты через Node.set(); подписки и иерархия — только при создании. */
function applyAttrs(node, attrs) {
    if (!attrs) return;
    for (const key of Object.keys(attrs)) {
        if (key === 'on' || key === 'parent') continue;
        if (key === 'class') { node.addClass(attrs[key]); continue; }
        if (key === 'tag') { node.addTag(attrs[key]); continue; }
        node.set(key, attrs[key]);
    }
}

function restoreBody(node, st) {
    if (!st.body_kind) return;
    node.body_disabled = false;
    node.body_kind = st.body_kind;
    node.syncBody();
}

function containerOf(parent) {
    if (!parent) return null;
    if (parent === ctx.world) return null;          // мир — это отсутствие родителя
    if (parent.nodes) return parent.nodes[0] || null;
    if (parent.tag) return parent;
    return null;
}

function attachNode(node, st) {
    if (ctx.nodes.indexOf(node) < 0) ctx.nodes.push(node);
    const parent = containerOf(st.spec.parent);
    if (parent) {
        node.parent_node = parent;
        if (parent.child_nodes.indexOf(node) < 0) parent.child_nodes.push(node);
    } else {
        node.parent_node = null;
    }
}

function detachNode(node) {
    const i = ctx.nodes.indexOf(node);
    if (i >= 0) ctx.nodes.splice(i, 1);
    if (node.parent_node && node.parent_node.child_nodes) {
        const j = node.parent_node.child_nodes.indexOf(node);
        if (j >= 0) node.parent_node.child_nodes.splice(j, 1);
    }
    node.parent_node = null;
}

// ---------------------------------------------------------------------------
// spawn / release
// ---------------------------------------------------------------------------

function safeCall(st, fn, node, opts) {
    try { fn(node, opts); }
    catch (e) { ctx.log(`$: ошибка в обработчике пула "${st.spec.name}": ${e}`); }
}

function spawnFrom(st, opts) {
    let node = st.free.pop();
    if (!node) {
        if (st.created >= st.spec.max) {
            st.skipped++;
            return wrap([]);   // места нет: пустая обёртка не ломает цепочку
        }
        node = newPoolNode(st);
        st.created++;
    }

    resetNode(node, st);
    applyAttrs(node, opts);
    restoreBody(node, st);
    attachNode(node, st);

    st.active.push(node);
    st.spawned++;
    if (st.spec.onAcquire) safeCall(st, st.spec.onAcquire, node, opts);
    return wrapOne(node);
}

function releaseOne(st, node) {
    if (!st || !node) return false;
    const i = st.active.indexOf(node);
    if (i < 0) return false;   // уже свободен либо выдан другим пулом

    if (st.spec.onRelease) safeCall(st, st.spec.onRelease, node, undefined);

    // Узел мог быть уничтожен игрой через .remove(): в пул его возвращать
    // нельзя, иначе следующий spawn выдаст «мёртвый» объект.
    if (node.removed) {
        st.active.splice(i, 1);
        st.created--;
        node_pool.delete(node);
        return true;
    }

    if (node.body >= 0 || node.body_kind) node.setBody(null);
    node.visible = false;
    node.velocity_cache = { x: 0, y: 0 };
    if (node.id !== undefined && ctx.byId.get(node.id) === node) ctx.byId.delete(node.id);
    detachNode(node);

    st.active.splice(i, 1);
    st.free.push(node);
    st.released++;
    return true;
}

function releaseAllFrom(st) {
    let count = 0;
    for (const node of st.active.slice()) if (releaseOne(st, node)) count++;
    return count;
}

function destroyPoolNodes(st) {
    for (const node of st.active.concat(st.free)) {
        node_pool.delete(node);
        node.destroy();
    }
    st.active.length = 0;
    st.free.length = 0;
    st.created = 0;
    st.spawned = 0;
    st.released = 0;
    st.skipped = 0;
}

// ---------------------------------------------------------------------------
// Счётчики подсистем
// ---------------------------------------------------------------------------

/**
 * Снимок счётчиков для $.debug.counters(): сколько узлов, тел, частиц,
 * активных твинов, зон и объектов в пулах. Частицы спрашиваем через их
 * публичный метод .count() — модуль частиц про пул ничего не знает.
 */
export function collectCounters() {
    const counters = {
        nodes: ctx.nodes.length,
        world_nodes: 0,
        ui_nodes: 0,
        bodies: 0,
        particles: 0,
        tweens: ctx.tweens_active ? numOr0(ctx.tweens_active()) : 0,
        zones: 0,
        pools: pools.size,
        pool_created: 0,
        pool_active: 0,
        pool_free: 0,
    };

    for (const node of ctx.nodes) {
        if (node.attrs && node.attrs.ui) counters.ui_nodes++;
        else if (!node.classes.has('world-bound')) counters.world_nodes++;
        if (node.body >= 0) counters.bodies++;
        if (node.tag === 'trigger' || node.tag === 'area') counters.zones++;
    }
    counters.particles = countParticles();

    for (const st of pools.values()) {
        counters.pool_created += st.created;
        counters.pool_active += st.active.length;
        counters.pool_free += st.free.length;
    }
    return counters;
}

function numOr0(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function countParticles() {
    // ctx.$ появляется только в собранном движке; в qjs-харнессе его нет.
    if (!ctx.$ || !ctx.$._wrapper) return 0;
    const proto = ctx.$._wrapper.prototype;
    if (!proto || typeof proto.count !== 'function') return 0;
    let total = 0;
    for (const node of ctx.nodes) {
        if (node.tag !== 'particles') continue;
        try { total += numOr0(proto.count.call(wrapOne(node))); }
        catch (e) { /* чужая подсистема не должна ронять счётчики */ }
    }
    return total;
}

// ---------------------------------------------------------------------------
// Публичное API
// ---------------------------------------------------------------------------

function allStats() {
    const out = {
        pools: pools.size,
        created: 0, active: 0, free: 0,
        spawned: 0, released: 0, skipped: 0,
        names: [],
        by_name: {},
    };
    for (const [name, st] of pools) {
        const s = poolStats(st);
        out.by_name[name] = s;
        out.names.push(name);
        out.created += s.created;
        out.active += s.active;
        out.free += s.free;
        out.spawned += s.spawned;
        out.released += s.released;
        out.skipped += s.skipped;
    }
    return out;
}

let release_patched = false;

function patchNodeRelease() {
    if (release_patched) return;
    release_patched = true;
    def('release', function () {
        for (const node of this.nodes) {
            const st = node_pool.get(node);
            if (!st) {
                ctx.log('$: .release() принимает только узлы, выданные $.pool.spawn()');
                continue;
            }
            releaseOne(st, node);
        }
        return this;
    });
}

export function installPool($) {
    patchNodeRelease();

    const api = {
        /**
         * Зарегистрировать пул: `$.pool.create({ name: 'bullets', tag: 'bullet',
         * max: 64, speed: 500 })`. Возвращает дескриптор пула или null.
         */
        create(spec) {
            const norm = normalizePoolSpec(spec);
            if (!norm.name) {
                ctx.log('$.pool.create: нужен name — имя пула, например { name: "bullets", tag: "bullet" }');
                return null;
            }
            if (!TAGS[norm.tag]) {
                ctx.log(`$.pool.create: неизвестный тег <${norm.tag}> — возьмите существующий, например <rect> или <bullet>`);
                return null;
            }
            if (pools.has(norm.name)) {
                ctx.log(`$.pool.create: пул "${norm.name}" уже есть — возвращаю существующий`);
                return pools.get(norm.name).pool;
            }
            const st = makePoolState(norm);
            pools.set(norm.name, st);
            // Предсоздание: узлы уже лежат в пуле, первый выстрел не аллоцирует.
            for (let i = 0; i < norm.initial; i++) {
                st.free.push(newPoolNode(st));
                st.created++;
            }
            return st.pool;
        },

        /** Дескриптор пула по имени или null. */
        get(name) {
            const st = pools.get(String(name));
            return st ? st.pool : null;
        },

        /** Есть ли такой пул. */
        has(name) { return pools.has(String(name)); },

        /** Выдать узел из пула: $.pool.spawn('bullets', { x, y }). */
        spawn(name, opts) {
            const st = pools.get(String(name));
            if (!st) {
                ctx.log(`$.pool.spawn: неизвестный пул "${name}" — сначала $.pool.create()`);
                return wrap([]);
            }
            return spawnFrom(st, opts);
        },

        /** Вернуть узел (или обёртку) в его пул. */
        release(node) {
            const raw = asNode(node);
            const st = raw ? node_pool.get(raw) : null;
            if (!st) {
                ctx.log('$.pool.release: узел не из пула — подходит только узел, выданный $.pool.spawn()');
                return false;
            }
            return releaseOne(st, raw);
        },

        /** Вернуть все выданные узлы пула (или всех пулов без имени). */
        releaseAll(name) {
            if (name === undefined) {
                let total = 0;
                for (const st of pools.values()) total += releaseAllFrom(st);
                return total;
            }
            const st = pools.get(String(name));
            return st ? releaseAllFrom(st) : 0;
        },

        /** Сводка по пулам: и общая, и по каждому имени (by_name). */
        stats() { return allStats(); },

        /**
         * Уничтожить пул(ы) вместе с узлами. Без имени — все пулы.
         * Узел, уничтоженный здесь, в отличие от release(), уже не вернуть.
         */
        clear(name) {
            if (name === undefined) {
                for (const st of [...pools.values()]) {
                    destroyPoolNodes(st);
                    pools.delete(st.spec.name);
                }
                return api;
            }
            const key = String(name);
            const st = pools.get(key);
            if (!st) { ctx.log(`$.pool.clear: неизвестный пул "${name}"`); return api; }
            destroyPoolNodes(st);
            pools.delete(key);
            return api;
        },
    };

    // Кадровый шаг пула. Документация звала его `$.pool.tickPool()`, но функция
    // жила только экспортом модуля — из игры её было не достать.
    api.tick = tickPool;
    api.tickPool = tickPool;

    $.pool = api;
    ctx.pool = api;
    return $;
}

/** Кадровый шаг: пулу симуляция не нужна, но счётчики обновляются здесь. */
export function tickPool(dt) {
    void dt;
    ctx.counters = collectCounters();
}
