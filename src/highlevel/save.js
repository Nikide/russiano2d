// ===========================================================================
// Сохранения игры: $.save — слоты, версии, миграции, автосейв и строки JSON.
//
// $.store хранит key-value и умеет писать ОДИН файл, $.prefab описывает узлы,
// $.fs читает и пишет файлы. $.save собирает из них слоты: снимок состояния
// (данные $.store + мир, описанный $.prefab) кладётся в saves/slot-N.json
// вместе с версией формата. Ничего своего про узлы и про key-value модуль не
// изобретает — иначе сохранение перестало бы понимать $.store и prefab-сцены.
//
//   $.save.slot(2).save();          // записать в saves/slot-2.json
//   $.save.slot(2).load();          // вернуть мир и данные
//   const text = $.save.export();   // та же запись строкой: $.http, буфер, тесты
//   $.save.import(text);
//
// Правила формата:
//   1) версия обязательна, старые версии доезжают через migrateSave();
//   2) наружу — только JSON-совместимые данные (функции и циклы срезает
//      sanitize() из prefab.js);
//   3) слот — это имя файла: slot-<имя>.json; слотов может быть сколько угодно.
//
// Чистые функции (слоты, версии, миграции, метаданные) экспортируются наружу:
// их проверяет qjs-харнесс без движка (tests/js/save_test.mjs). К engine
// модуль обращается только внутри installSave().
// ===========================================================================

import { engine } from './native.js';
import { ctx, assignNid } from './core.js';
import { sanitize } from './prefab.js';
import { PRESENTATION_STREAMS } from './random.js';

export const SAVE_FORMAT = 'r2d.save';
export const SAVE_VERSION = 3;          // 1 — $.store.save(), 2 — слоты, 3 — namespaces (§14)
export const DEFAULT_DIR = 'saves';
export const DEFAULT_SLOT = '1';
export const AUTO_SLOT = '0';           // слот автосейва
export const DEFAULT_AUTOSAVE_MS = 60000;

/**
 * Namespace-политика одного сохранения (§14): это ОДИН формат с четырьмя
 * разделами, а не четыре системы.
 *
 *   profile      — настройки, которые не сбрасываются при restart run:
 *                  input, audio, язык, доступность;
 *   run          — состояние прохождения: счётчики, флаги, статистика;
 *   room         — мир комнаты: узлы ($.prefab), скорости, состояние по nid;
 *   presentation — косметика кадра: включён ли оверлей, фильтры, палитра.
 *
 * Файл слота хранит разделы в `namespaces`; плоские поля `store`/`world`/
 * `speeds`/`node_state` остаются в объекте-снимке как зеркала для кода,
 * который читал их раньше (§3 «совместимость»). В ФАЙЛ зеркала не пишутся.
 */
export const NAMESPACES = ['profile', 'run', 'room', 'presentation'];
export const DEFAULT_NAMESPACE = 'run';

/** Политика расхождения content-версий при restore. */
export const CONTENT_STRICT = 'strict';
export const CONTENT_WARN = 'warn';
export const CONTENT_IGNORE = 'ignore';

// ---------------------------------------------------------------------------
// Слоты и пути (чистые функции)
// ---------------------------------------------------------------------------

function num(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    return isFinite(n) ? n : fallback;
}

function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Копия объекта без функций и циклов — используется для разделов слота. */
function sanitizeObject(value) {
    const out = sanitize(plainObject(value) ? value : {}, new Set());
    return out === undefined ? {} : out;
}

/** Двумерный вектор из массива или объекта — тело отдаёт и то и другое. */
function vec2(value) {
    if (Array.isArray(value)) return [num(value[0], 0), num(value[1], 0)];
    if (value && typeof value === 'object') return [num(value.x, 0), num(value.y, 0)];
    return [0, 0];
}

/** Пустой канонический набор разделов. */
function emptyNamespaces() {
    return {
        profile: { data: {} },
        run: { data: {} },
        room: { data: {}, world: null, speeds: null, nodes: {} },
        presentation: { data: {} },
    };
}

/**
 * Разделы из объекта, который может быть как каноническим (`namespaces`), так
 * и плоским (`store`/`world`/`speeds`/`node_state`). Плоская форма — это
 * слоты версии 2: они приезжают в `run`/`room`, потому что другого места у них
 * не было. Приоритет у явного `namespaces`: именно он лежит в файле.
 */
export function namespacesOf(raw) {
    const src = plainObject(raw) ? raw : {};
    const nsIn = plainObject(src.namespaces) ? src.namespaces : null;
    const ns = emptyNamespaces();

    const runIn = nsIn && plainObject(nsIn.run) ? nsIn.run : null;
    const roomIn = nsIn && plainObject(nsIn.room) ? nsIn.room : null;
    const profileIn = nsIn && plainObject(nsIn.profile) ? nsIn.profile : null;
    const presentIn = nsIn && plainObject(nsIn.presentation) ? nsIn.presentation : null;

    ns.run.data = sanitizeObject(runIn && runIn.data !== undefined ? runIn.data
                                 : (plainObject(src.store) ? src.store
                                 : (plainObject(src.data) ? src.data : {})));
    ns.profile.data = sanitizeObject(profileIn && profileIn.data !== undefined ? profileIn.data : {});
    ns.presentation.data = sanitizeObject(presentIn && presentIn.data !== undefined ? presentIn.data : {});
    // Состояние RNG живёт в разделе run: оно продолжает последовательность
    // прохождения, а не настройки игрока (§26).
    if (runIn && plainObject(runIn.rng)) ns.run.rng = sanitizeObject(runIn.rng);
    if (roomIn && plainObject(roomIn.data)) ns.room.data = sanitizeObject(roomIn.data);

    const world = roomIn && Array.isArray(roomIn.world) ? roomIn.world
                : (Array.isArray(src.world) ? src.world : (Array.isArray(src.nodes) ? src.nodes : null));
    ns.room.world = world ? sanitize(world, new Set()) : null;

    const speeds = roomIn && Array.isArray(roomIn.speeds) ? roomIn.speeds
                 : (Array.isArray(src.speeds) ? src.speeds : null);
    ns.room.speeds = speeds ? sanitize(speeds, new Set()) : null;

    const nodes = roomIn && plainObject(roomIn.nodes) ? roomIn.nodes
                : (plainObject(src.node_state) ? src.node_state : {});
    ns.room.nodes = sanitizeObject(nodes);
    return ns;
}

/**
 * Канонический вид сохранения: поля всегда в одном порядке, лишнее срезано.
 * Именно этот объект уходит и в файл (через wireSave), и в игру.
 *
 * Плоские `store`/`world`/`speeds`/`node_state` — зеркала разделов: код,
 * который читал их до появления namespaces, продолжает работать.
 */
export function makeSave(raw) {
    const src = plainObject(raw) ? raw : {};
    const ns = namespacesOf(src);
    const out = {
        format: SAVE_FORMAT,
        version: SAVE_VERSION,
        saved_at: Math.floor(num(src.saved_at, 0)),
        saved_frame: Math.floor(num(src.saved_frame, 0)),
        time: num(src.time, 0),
        scene: src.scene === undefined ? null : src.scene,
        namespaces: ns,
        store: ns.run.data,
        world: ns.room.world,
        speeds: ns.room.speeds,
        node_state: ns.room.nodes,
        content: sanitizeObject(src.content),
        meta: sanitizeObject(src.meta),
    };
    if (src.migrated_from !== undefined) out.migrated_from = Math.floor(num(src.migrated_from, 0));
    return out;
}

/**
 * То, что реально уходит в файл: разделы без плоских зеркал (иначе мир лежал
 * бы в слоте дважды). `makeSave(wireSave(x))` даёт тот же объект, поэтому
 * save → load → save по-прежнему стабилен.
 */
export function wireSave(raw) {
    const data = makeSave(raw);
    const out = {
        format: data.format,
        version: data.version,
        saved_at: data.saved_at,
        saved_frame: data.saved_frame,
        time: data.time,
        scene: data.scene,
        namespaces: data.namespaces,
    };
    if (Object.keys(data.content).length) out.content = data.content;
    if (Object.keys(data.meta).length) out.meta = data.meta;
    if (data.migrated_from !== undefined) out.migrated_from = data.migrated_from;
    return out;
}

export function serializeSave(raw) {
    return JSON.stringify(wireSave(raw), null, 2);
}

/**
 * Слот → каноническое имя. Принимает число (2), строку ('2'), имя файла
 * ('slot-2.json') и произвольное имя ('quick'). Символы, из которых нельзя
 * собрать имя файла, заменяются на '_'.
 */
export function normalizeSlot(slot) {
    if (slot === undefined || slot === null || slot === '') return DEFAULT_SLOT;
    if (typeof slot === 'number') return isFinite(slot) ? String(Math.floor(slot)) : DEFAULT_SLOT;
    const text = String(slot).trim();
    if (text === '') return DEFAULT_SLOT;
    const match = /^(?:slot[-_])?(.+?)(?:\.json)?$/i.exec(text);
    const name = (match ? match[1] : text).replace(/[^0-9A-Za-z._-]+/g, '_');
    return name === '' ? DEFAULT_SLOT : name;
}

/** Каталог слотов: пустая строка и './' приводятся к значению по умолчанию. */
export function normalizeDir(dir) {
    if (dir === undefined || dir === null) return DEFAULT_DIR;
    const text = String(dir).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return text === '' ? DEFAULT_DIR : text;
}

export function slotFileName(slot) {
    return 'slot-' + normalizeSlot(slot) + '.json';
}

export function slotPath(dir, slot) {
    return normalizeDir(dir) + '/' + slotFileName(slot);
}

/** Имя файла слота → слот; null для чужих файлов в каталоге. */
export function slotFromFile(file) {
    const base = String(file === undefined || file === null ? '' : file).split('/').pop();
    const match = /^slot-(.+)\.json$/i.exec(base);
    return match && match[1] ? match[1] : null;
}

/** Числовые слоты идут первыми и по возрастанию, именованные — по алфавиту. */
export function compareSlots(a, b) {
    const an = /^\d+$/.test(a);
    const bn = /^\d+$/.test(b);
    if (an && bn) return Number(a) - Number(b);
    if (an !== bn) return an ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
}

export function sortSlots(list) {
    return list.slice().sort((x, y) => compareSlots(normalizeSlot(x.slot), normalizeSlot(y.slot)));
}

// ---------------------------------------------------------------------------
// Формат, версии, миграции (чистые функции)
// ---------------------------------------------------------------------------

/**
 * Что угодно → сохранение текущей версии. Понимает:
 *   * наш формат (format === 'r2d.save') любой поддерживаемой версии;
 *   * запись $.store: { version: 1, saved_frame, data: {...} };
 *   * сцену $.prefab.saveScene(): { version: 1, name, nodes: [...] };
 *   * «сырой» объект данных ($.store.load понимает такой же).
 * null — это не сохранение вовсе или версия новее нашей.
 *
 * Зарезервированные поля: format, version, store, world, speeds, meta,
 * saved_at, saved_frame, time, scene. Если их нет, объект считается данными
 * $.store целиком.
 */
export function migrateSave(raw) {
    if (!plainObject(raw)) return null;
    const version = typeof raw.version === 'number' && isFinite(raw.version)
        ? Math.floor(raw.version) : null;
    if (version !== null && (version < 0 || version > SAVE_VERSION)) return null;

    const structured = raw.format === SAVE_FORMAT || version !== null || Array.isArray(raw.world)
        || plainObject(raw.namespaces);
    const store = structured
        ? (plainObject(raw.store) ? raw.store : (plainObject(raw.data) ? raw.data : {}))
        : raw;
    const world = structured
        ? (Array.isArray(raw.world) ? raw.world : (Array.isArray(raw.nodes) ? raw.nodes : null))
        : null;

    const out = makeSave({
        saved_at: raw.saved_at,
        saved_frame: raw.saved_frame === undefined ? raw.frame : raw.saved_frame,
        time: raw.time,
        scene: raw.scene,
        // Явные разделы (версия 3) приоритетнее плоских полей: в файле лежит
        // именно `namespaces`, а `store`/`world` — зеркала для старого кода.
        namespaces: plainObject(raw.namespaces) ? raw.namespaces : undefined,
        store,
        world,
        speeds: structured ? raw.speeds : null,
        node_state: structured ? raw.node_state : null,
        content: structured ? raw.content : null,
        meta: raw.meta,
    });
    // Пометка «это старый формат»: игра может показать её в меню или
    // перезаписать слот уже в новой версии.
    if (version !== null && version < SAVE_VERSION) out.migrated_from = version;
    return out;
}

/**
 * Строка JSON → сохранение. Битый JSON и версия «из будущего» — это ошибка с
 * понятным текстом, а не исключение: строку приносят из $.http, из буфера
 * обмена и из файла, и ронять из-за неё кадр нельзя.
 */
export function parseSaveJson(text) {
    if (typeof text !== 'string') {
        return { ok: false, data: null, raw: null, error: 'нужна строка JSON (её отдаёт $.save.export())' };
    }
    const trimmed = text.trim();
    if (trimmed === '') return { ok: false, data: null, raw: null, error: 'пустая строка' };
    let raw = null;
    try {
        raw = JSON.parse(trimmed);
    } catch (e) {
        return { ok: false, data: null, raw: null, error: 'битый JSON: ' + (e && e.message ? e.message : e) };
    }
    if (!plainObject(raw)) {
        return { ok: false, data: null, raw: null, error: 'в сохранении ожидался объект JSON' };
    }
    const data = migrateSave(raw);
    if (!data) {
        return {
            ok: false, data: null, raw,
            error: 'версия сохранения ' + raw.version + ' новее поддерживаемой (' + SAVE_VERSION + ')',
        };
    }
    // raw нужен отдельно: saveInfo() должен видеть исходную версию файла,
    // иначе старый слот выглядел бы как только что записанный.
    return { ok: true, data, raw, error: null };
}

/** Глубина-первый обход данных узлов — в том же порядке, что и nodeToData(). */
export function flattenNodes(data) {
    const out = [];
    const walk = (item) => {
        if (!item || typeof item !== 'object') return;
        if (Array.isArray(item)) { for (const one of item) walk(one); return; }
        out.push(item);
        if (Array.isArray(item.children)) for (const child of item.children) walk(child);
    };
    walk(data);
    return out;
}

/**
 * Узлы данных мира по стабильному nid: `nid → данные узла`. Нужно restore'у:
 * состояние сопоставляется по ID, а не по порядку обхода дерева (§14).
 * Узлы без nid (старые данные) в карту не попадают — их не с чем сопоставить.
 */
export function nodesWithNid(data) {
    const out = new Map();
    for (const node of flattenNodes(data)) {
        if (node.nid === undefined || node.nid === null || String(node.nid) === '') continue;
        out.set(String(node.nid), node);
    }
    return out;
}

/** Сколько записей состояния по nid в снимке. */
function nodeStateCount(data) {
    const ns = plainObject(data && data.namespaces) ? data.namespaces : null;
    const room = ns && plainObject(ns.room) ? ns.room : null;
    const nodes = room && plainObject(room.nodes) ? room.nodes : {};
    return Object.keys(nodes).length;
}

/**
 * Метаданные слота для list()/info(): то, что нужно меню сохранений, — без
 * самих данных мира (их может быть много). Плюс факты о разделах (§14): какие
 * namespaces в слоте непусты и есть ли состояние по nid.
 */
export function saveInfo(raw, extra) {
    const base = plainObject(extra) ? extra : {};
    const data = migrateSave(raw) || makeSave({});
    const source = plainObject(raw) ? raw : {};
    const version = typeof source.version === 'number' && isFinite(source.version)
        ? Math.floor(source.version) : null;
    const world = Array.isArray(data.world) ? data.world : null;
    const ns = plainObject(data.namespaces) ? data.namespaces : emptyNamespaces();
    const filled = [];
    for (const name of NAMESPACES) {
        const part = ns[name] || {};
        const keys = Object.keys(part.data || {}).length;
        const extra_bits = (Array.isArray(part.world) ? 1 : 0) + (Array.isArray(part.speeds) ? 1 : 0)
                         + (plainObject(part.nodes) && Object.keys(part.nodes).length ? 1 : 0);
        if (keys > 0 || extra_bits > 0) filled.push(name);
    }
    return {
        ok: true,
        slot: base.slot === undefined ? null : normalizeSlot(base.slot),
        path: base.path === undefined ? null : base.path,
        file: base.file === undefined ? null : base.file,
        size: base.size === undefined ? null : base.size,
        format: data.format,
        version: version === null ? SAVE_VERSION : version,
        current: SAVE_VERSION,
        legacy: version !== null && version < SAVE_VERSION,
        saved_at: data.saved_at,
        saved_frame: data.saved_frame,
        time: data.time,
        scene: data.scene,
        store_keys: Object.keys(data.store || {}).length,
        world_nodes: world ? flattenNodes(world).length : 0,
        has_world: !!world,
        has_speeds: Array.isArray(data.speeds),
        namespaces: filled,
        node_state: nodeStateCount(data),
        content: plainObject(data.content) ? data.content : {},
        meta: data.meta || {},
    };
}

// ---------------------------------------------------------------------------
// Установка: $.save
// ---------------------------------------------------------------------------

export function installSave($) {
    const state = {
        slot: DEFAULT_SLOT,
        dir: DEFAULT_DIR,
        auto_id: 0,
        auto_ms: 0,
        auto_slot: AUTO_SLOT,
        autosaves: 0,
        saves: 0,
        loads: 0,
        last_error: null,
        // §14: namespace-политика. Текущий раздел для $.save.set/get.
        ns: DEFAULT_NAMESPACE,
        // Счётчики протокола — их читают тесты и приёмка (§14/§26).
        temp_writes: 0,        // записей через временный файл
        backups: 0,            // снятых копий последней корректной версии
        recovered: 0,          // восстановлений слота из backup
        rejected_future: 0,    // отказов перезаписать слот из будущего
        rollbacks: 0,          // откатанных restore (ошибка до commit)
        restores: 0,           // успешных транзакционных восстановлений
        committed_nodes: 0,    // узлов в последнем commit
        behavior_loads: 0,     // вызовов фабрик поведения при restore
        last_failure: null,    // структура последнего отказа (для машины)
    };

    // Разделы, у которых нет своего хранилища в $.store: профиль и косметика.
    // `run` живёт в $.store — так игра и раньше хранила прохождение.
    const ns_data = {
        profile: new Map(),
        room: new Map(),
        presentation: new Map(),
    };
    const providers = [];      // зарегистрированные фабрики поведения (§10)
    const manual_state = {};   // nid → данные, привязанные игрой вручную
    let restored_state = {};   // nid → состояние, применённое последним restore
    const content_versions = {};   // имя → версия/хэш контента (для проверки restore)
    const content_hashes = {};

    // $.fs/$.store ставит store.js, $.prefab — prefab.js. Модуль может быть
    // установлен и раньше них, поэтому берём соседей в момент вызова.
    function fs() { return $.fs || ctx.fs || null; }
    function store() { return $.store || ctx.store || null; }
    function prefab() { return $.prefab || ctx.prefab || null; }
    function sceneApi() { return $.scene || ctx.scene || null; }

    function fail(message) {
        state.last_error = message;
        ctx.log(message);
        return false;
    }

    /**
     * Отказ обязательной операции (§17): кроме текста в журнал, структура в
     * `last_failure` и — при `opts.fatal` — запись в $.debug.reportError, по
     * которой агент/CI видит провал, не разбирая строки.
     */
    function failWith(stage, message, opts) {
        const o = opts || {};
        state.last_error = message;
        state.last_failure = {
            ok: false,
            stage,
            code: o.code || ('R2D_SAVE_' + String(stage).toUpperCase()),
            message,
            slot: o.slot === undefined ? null : String(o.slot),
            path: o.path === undefined ? null : o.path,
            version: o.version === undefined ? null : o.version,
            current: SAVE_VERSION,
            details: o.details === undefined ? null : o.details,
        };
        ctx.log(message);
        if (o.fatal === true && $.debug && typeof $.debug.reportError === 'function') {
            $.debug.reportError('$.save.' + stage, new Error(message), {
                fatal: true, code: state.last_failure.code,
                operation: stage, assetPath: o.path === undefined ? null : o.path,
            });
        }
        return false;
    }

    // --- Namespaces (§14) ---------------------------------------------------

    /** Хранилище раздела: run — это $.store, остальные — свои Map. */
    function nsStore(name) {
        if (name === 'run') {
            const s = store();
            if (!s) return null;
            const handle = {
                name: 'run',
                all: () => storeData(),
                keys: () => (typeof s.keys === 'function' ? s.keys() : Object.keys(storeData())),
                get: (k, fallback) => s.get(k, fallback),
                has: (k) => s.has(k),
            };
            // Цепочка: `$.save.profile().set('a', 1).set('b', 2)` — как у `$`.
            handle.set = (k, v) => { s.set(k, v); return handle; };
            handle.remove = (k) => { s.remove(k); return handle; };
            handle.clear = () => { if (typeof s.clear === 'function') s.clear(); return handle; };
            return handle;
        }
        const map = ns_data[name];
        if (!map) return null;
        const handle = {
            name,
            all: () => Object.fromEntries(map),
            keys: () => [...map.keys()],
            get: (k, fallback) => (map.has(String(k)) ? map.get(String(k)) : fallback),
            has: (k) => map.has(String(k)),
        };
        handle.set = (k, v) => { map.set(String(k), v); return handle; };
        handle.remove = (k) => { map.delete(String(k)); return handle; };
        handle.clear = () => { map.clear(); return handle; };
        return handle;
    }

    function allNamespaceData(name) {
        const s = nsStore(name);
        return s ? sanitizeObject(s.all()) : {};
    }

    function loadNamespaceData(name, data) {
        const s = nsStore(name);
        if (!s) return 0;
        s.clear();
        const src = plainObject(data) ? data : {};
        for (const key of Object.keys(src)) s.set(key, src[key]);
        return Object.keys(src).length;
    }

    // --- Фабрики поведения (§10) --------------------------------------------

    /**
     * Зарегистрировать фабрику поведения: как читать и как восстанавливать
     * состояние узла. Логика НЕ сериализуется — она уже есть в коде, снимок
     * хранит только данные (§10).
     *
     *   $.save.behavior('walker', {
     *       save(node) { return { hp: node.hp, state: node.state_name, cd: node.cd }; },
     *       load(node, data, api) { node.hp = data.hp; $.state.send(node, data.state); node.cd = data.cd; },
     *   });
     *
     * match — тег ('walker'), имя класса ('.walker') или функция (node) → bool.
     * Возвращает число зарегистрированных фабрик (для цепочки и тестов).
     */
    function addBehavior(match, provider, name) {
        if (typeof match === 'function') {
            if (!provider || typeof provider.save !== 'function') {
                fail('$.save.behavior: нужен { save(node) } (load необязателен)');
                return 0;
            }
            providers.push({ name: name || ('behavior' + (providers.length + 1)), match, provider });
            return providers.length;
        }
        const selector = String(match === undefined || match === null ? '' : match);
        if (!selector) { fail('$.save.behavior: нужен тег, класс или функция-отбор'); return 0; }
        const cls = selector[0] === '.';
        const bare = cls ? selector.slice(1) : selector.replace(/^<|>$/g, '');
        const matchFn = (node) => (cls
            ? !!(node.classes && node.classes.has(bare))
            : node.tag === bare);
        providers.push({ name: name || selector, match: matchFn, provider: provider || {} });
        return providers.length;
    }

    function behaviorProviders() {
        return providers.map((p) => p.name);
    }

    function providerSave(node) {
        let out = null;
        for (const p of providers) {
            if (!p.match(node)) continue;
            if (!p.provider || typeof p.provider.save !== 'function') continue;
            let data = null;
            try { data = p.provider.save(node); } catch (e) {
                failWith('behavior', `$.save: фабрика "${p.name}" не прочитала узел ${node.nid}: ${e}`, { details: { provider: p.name, nid: node.nid } });
                continue;
            }
            if (data === undefined || data === null) continue;
            out = out || {};
            out[p.name] = sanitizeObject(data);
        }
        return out;
    }

    function providerLoad(node, entry, journal) {
        let applied = 0;
        for (const p of providers) {
            if (!entry || !plainObject(entry.p) || entry.p[p.name] === undefined) continue;
            if (!p.match(node)) continue;
            if (!p.provider || typeof p.provider.load !== 'function') continue;
            try {
                p.provider.load(node, entry.p[p.name], { journal, save });
                applied++;
                state.behavior_loads++;
            } catch (e) {
                failWith('behavior', `$.save: фабрика "${p.name}" не восстановила узел ${node.nid}: ${e}`, { details: { provider: p.name, nid: node.nid } });
            }
        }
        return applied;
    }

    // --- Журнал отката ------------------------------------------------------

    /**
     * Журнал транзакции restore: всё, что фабрика создала во время загрузки,
     * регистрирует здесь свой откат. Ошибка ДО commit вызывает rollback и
     * рабочее состояние остаётся прежним (§14).
     */
    function makeJournal() {
        const cleanups = [];
        let done = false;
        return {
            onRollback(fn) { if (typeof fn === 'function' && !done) cleanups.push(fn); },
            size() { return cleanups.length; },
            rollback() {
                if (done) return 0;
                done = true;
                let ran = 0;
                for (const fn of cleanups.reverse()) {
                    try { fn(); ran++; } catch (e) { ctx.log('$: ошибка в откате restore: ' + e); }
                }
                cleanups.length = 0;
                return ran;
            },
            commit() { done = true; cleanups.length = 0; },
        };
    }

    function readFile(path) {
        const f = fs();
        if (!f || typeof f.readText !== 'function') {
            fail('$.save: нет $.fs — модуль store.js не установлен');
            return null;
        }
        const text = f.readText(path);
        return text === undefined ? null : text;
    }

    function writeFile(path, text) {
        const f = fs();
        if (!f || typeof f.write !== 'function') {
            fail('$.save: нет $.fs — модуль store.js не установлен');
            return false;
        }
        if (!f.write(path, text)) {
            fail(`$.save: не удалось записать "${path}" — проверьте права на каталог`);
            return false;
        }
        return true;
    }

    function sceneName() {
        const scene = ctx.scene;
        if (!scene || typeof scene.current !== 'function') return null;
        return scene.current();
    }

    // --- Части снимка ------------------------------------------------------

    function storeData() {
        const s = store();
        if (!s || typeof s.all !== 'function') return {};
        const all = s.all();
        return plainObject(all) ? all : {};
    }

    /** Данные мира через $.prefab: свой формат узлов модуль не изобретает. */
    function worldData() {
        const p = prefab();
        if (!p || typeof p.save !== 'function') {
            fail('$.save: нет $.prefab — мир не сохранить, в слот уйдут только данные $.store');
            return null;
        }
        const roots = rootNodes();
        if (roots.length === 0) return [];
        const data = p.save(roots);
        if (data === null || data === undefined) return [];
        return Array.isArray(data) ? data : [data];
    }

    function rootNodes() {
        return (ctx.nodes || []).filter((n) => n && !n.removed && !n.parent_node);
    }

    /**
     * Скорости тел в порядке обхода nodeToData(): узел, затем дети. Формат
     * $.prefab скорости не хранит, а «состояние узла» без них неполное:
     * сохранённая в полёте пуля после загрузки должна лететь, а не зависнуть.
     */
    function speedsOf(roots) {
        if (typeof engine.getVelocity !== 'function') return null;
        const out = [];
        let any = false;
        const walk = (node) => {
            let v = [0, 0];
            if (node.body >= 0) { v = vec2(engine.getVelocity(node.body)); any = true; }
            out.push(v);
            for (const child of node.child_nodes || []) walk(child);
        };
        for (const node of roots) walk(node);
        return any ? out : null;
    }

    function applySpeeds(roots, speeds) {
        if (!Array.isArray(speeds) || typeof engine.setVelocity !== 'function') return 0;
        const live = [];
        const walk = (node) => {
            live.push(node);
            for (const child of node.child_nodes || []) walk(child);
        };
        for (const node of roots) walk(node);
        const total = Math.min(live.length, speeds.length);
        let applied = 0;
        for (let i = 0; i < total; i++) {
            const node = live[i];
            const saved = speeds[i];
            if (!saved || node.body < 0) continue;
            const v = vec2(saved);
            engine.setVelocity(node.body, v[0], v[1]);
            node.velocity_cache = { x: v[0], y: v[1] };
            applied++;
        }
        return applied;
    }

    // --- Состояние по nid (§14) --------------------------------------------

    /** Все живые узлы поддерева — тот же порядок, что у speedsOf(). */
    function collectNodes(roots) {
        const out = [];
        const walk = (node) => {
            if (!node || node.removed) return;
            out.push(node);
            for (const child of node.child_nodes || []) walk(child);
        };
        for (const node of roots) walk(node);
        return out;
    }

    /**
     * Состояние узлов по стабильному nid: скорость тела плюс данные
     * зарегистрированных фабрик поведения. Порядок обхода дерева не важен —
     * ключ это `nid`, поэтому восстановление не зависит от того, как узлы
     * легли в дерево (§14).
     */
    function nodeStateOf(roots) {
        const out = {};
        for (const node of collectNodes(roots)) {
            const entry = {};
            if (node.body >= 0 && typeof engine.getVelocity === 'function') {
                entry.v = vec2(engine.getVelocity(node.body));
            }
            const p = providerSave(node);
            if (p) entry.p = p;
            const m = manual_state[String(node.nid)];
            if (m) entry.m = m;
            if (Object.keys(entry).length) out[String(node.nid)] = entry;
        }
        return out;
    }

    /**
     * Применить состояние по nid к восстановленным узлам. Возвращает
     * `{ applied, missing, providers }`: `missing` — nid из снимка, которых в
     * новом мире нет; `providers` — имена фабрик, которых не хватило.
     */
    function applyNodeState(roots, nodeState, journal) {
        const list = collectNodes(roots);
        const by_nid = new Map();
        for (const node of list) by_nid.set(String(node.nid), node);
        let applied = 0;
        const missing = [];
        const used_providers = new Set();
        const missing_providers = new Set();
        const known = new Set(providers.map((p) => p.name));
        for (const nid of Object.keys(nodeState || {})) {
            const node = by_nid.get(nid);
            const entry = nodeState[nid];
            if (!node) { missing.push(nid); continue; }
            if (entry && Array.isArray(entry.v) && node.body >= 0
                && typeof engine.setVelocity === 'function') {
                const v = vec2(entry.v);
                engine.setVelocity(node.body, v[0], v[1]);
                node.velocity_cache = { x: v[0], y: v[1] };
            }
            if (entry && plainObject(entry.p)) {
                for (const name of Object.keys(entry.p)) {
                    used_providers.add(name);
                    // Фабрика, которой в этом запуске нет: узел останется без
                    // своего состояния — это факт, который restore обязан
                    // назвать, а не спрятать.
                    if (!known.has(name)) missing_providers.add(name);
                }
            }
            applied += providerLoad(node, entry, journal);
        }
        return { applied, missing, providers: [...used_providers], missing_providers: [...missing_providers] };
    }

    // --- RNG (§26) ----------------------------------------------------------

    function rngApi() { return $.random || ctx.random || null; }

    /**
     * Снимок RNG для слота/replay: {version, algorithm, seed, value, streams}.
     *
     * Потоки косметики (частицы, тряска камеры, декоративный шум) в слот НЕ
     * попадают: §10 требует не сохранять presentation-only random. Иначе
     * загрузка слота откатывала бы картинку к моменту сохранения — то есть
     * косметика вела бы себя как gameplay-состояние, а шум частиц после
     * загрузки повторялся бы один в один.
     */
    function rngState() {
        const r = rngApi();
        if (!r || typeof r.state !== 'function') return null;
        let snapshot;
        try { snapshot = r.state(); } catch (e) { return null; }
        if (!snapshot || typeof snapshot !== 'object') return snapshot;
        const streams = snapshot.streams;
        if (!streams || typeof streams !== 'object') return snapshot;
        const kept = {};
        let dropped = 0;
        for (const name of Object.keys(streams)) {
            if (PRESENTATION_STREAMS.indexOf(name) >= 0) { dropped++; continue; }
            kept[name] = streams[name];
        }
        if (!dropped) return snapshot;
        const out = Object.assign({}, snapshot);
        if (Object.keys(kept).length) out.streams = kept;
        else delete out.streams;
        return out;
    }

    function rngRestore(snapshot) {
        if (!snapshot) return false;
        const r = rngApi();
        if (!r || typeof r.restore !== 'function') return false;
        if (typeof r.validateState === 'function' && r.validateState(snapshot) !== true) return false;
        try { r.restore(snapshot); return true; } catch (e) {
            ctx.log('$.save: RNG не восстановился — ' + e);
            return false;
        }
    }

    // --- Content versions (§14) --------------------------------------------

    function contentOf() {
        const out = { versions: {}, hashes: {} };
        for (const name of Object.keys(content_versions).sort()) out.versions[name] = content_versions[name];
        for (const name of Object.keys(content_hashes).sort()) out.hashes[name] = content_hashes[name];
        return out;
    }

    /** Расхождения content-версий/хэшей снимка с текущими (для restore). */
    function contentDiff(saved) {
        const src = plainObject(saved) ? saved : {};
        const out = [];
        const check = (kind, table) => {
            const cur = kind === 'versions' ? content_versions : content_hashes;
            for (const name of Object.keys(plainObject(table) ? table : {})) {
                if (cur[name] === undefined) continue;               // игры не объявила — не судим
                if (cur[name] !== table[name]) {
                    out.push({ kind, name, saved: table[name], current: cur[name] });
                }
            }
        };
        check('versions', src.versions);
        check('hashes', src.hashes);
        return out;
    }

    /**
     * Убрать текущий мир. `keep` — множество узлов, которые трогать нельзя
     * (узлы, подготовленные транзакцией restore до commit).
     */
    function clearWorld(keep) {
        let count = 0;
        for (const node of (ctx.nodes || []).slice()) {
            if (node.removed) continue;
            if (keep && keep.has(node)) continue;
            node.destroy();
            count++;
        }
        // destroy() не чистит реестр id — после загрузки старые id должны быть
        // свободны, иначе prefab выдаст новым узлам суффиксы ('hero2').
        if (ctx.byId) {
            for (const [id, node] of [...ctx.byId.entries()]) if (node.removed) ctx.byId.delete(id);
        }
        return count;
    }

    function applyStore(data, mode) {
        const s = store();
        if (!s) return fail('$.save: нет $.store — данные из сохранения не применить');
        if (mode !== 'merge' && typeof s.clear === 'function') s.clear();
        if (data && typeof s.setAll === 'function') s.setAll(data);
        return true;
    }

    /**
     * Восстановить мир из данных $.prefab. opts: { clear (по умолчанию true),
     * speeds }. Возвращает число восстановленных корневых узлов.
     *
     * Это «прямой» путь: сначала чистит мир, потом грузит. Транзакционный
     * restore (с временной областью) — `restoreTransactional`.
     */
    function applyWorld(nodes, opts) {
        const p = prefab();
        if (!p || typeof p.load !== 'function') {
            fail('$.save: нет $.prefab — мир из сохранения не собрать');
            return 0;
        }
        const list = Array.isArray(nodes) ? nodes : (plainObject(nodes) ? [nodes] : []);
        const o = opts || {};
        if (o.clear !== false) clearWorld();
        const wrapper = p.load(list);
        const roots = wrapper && wrapper.nodes ? wrapper.nodes : [];
        applySpeeds(roots, o.speeds);
        if (list.length > 0 && roots.length === 0) {
            fail('$.save: данные мира не разобрались — узлы не созданы');
            return 0;
        }
        state.last_error = null;
        return roots.length;
    }

    // --- Транзакционный restore (§14) ---------------------------------------

    /**
     * Протокол восстановления: прочитать (уже сделан) → проверить schema и
     * content-версии → подготовить мир во временной области → восстановить
     * связи и поведение (по nid, фабриками) → проверить инварианты → commit →
     * освободить старую область.
     *
     * Ошибка ЛЮБОГО шага до commit откатывает только что созданные узлы и
     * оставляет рабочее состояние нетронутым.
     */
    function restoreTransactional(data, opts) {
        const o = opts || {};
        const room = plainObject(data.namespaces) && plainObject(data.namespaces.room)
            ? data.namespaces.room : { world: null, speeds: null, nodes: {} };
        const world = Array.isArray(room.world) ? room.world : null;
        const node_state = plainObject(room.nodes) ? room.nodes : {};
        const result = {
            ok: false, stage: 'read', nodes: 0, applied: 0, missing: [],
            providers: [], missing_providers: [], content: [], rollback_cleanups: 0, reason: null,
        };

        // 0. Обязательные подсистемы: проверяем ДО любых изменений мира.
        if (o.world !== false && world && world.length) {
            const p = prefab();
            if (!p || typeof p.load !== 'function') {
                result.stage = 'resources';
                result.reason = '$.save: нет $.prefab — мир из сохранения не собрать';
                failWith('resources', result.reason, { fatal: o.fatal === true });
                return result;
            }
        }
        if (o.store !== false && !store()) {
            result.stage = 'resources';
            result.reason = '$.save: нет $.store — данные из сохранения не применить';
            failWith('resources', result.reason, { fatal: o.fatal === true });
            return result;
        }

        // 1. content-версии: strict отклоняет, warn сообщает (по умолчанию).
        result.content = contentDiff(data.content);
        const policy = o.content === undefined ? CONTENT_WARN : o.content;
        if (result.content.length && policy === CONTENT_STRICT) {
            result.stage = 'content';
            result.reason = '$.save: content не совпал — ' + result.content
                .map((c) => `${c.kind} "${c.name}": в слоте ${c.saved}, сейчас ${c.current}`).join('; ');
            failWith('content', result.reason, { fatal: o.fatal === true, details: result.content });
            return result;
        }

        // 2. Подготовка во временной области: запоминаем, что было, паркуем
        //    реестр id (иначе prefab выдаст новым узлам суффиксы) и грузим мир.
        const before = new Set((ctx.nodes || []).filter((n) => n && !n.removed));
        const parked_ids = ctx.byId ? new Map(ctx.byId) : null;
        if (parked_ids) {
            for (const [id, node] of parked_ids) {
                if (node && !node.removed && ctx.byId.get(id) === node) ctx.byId.delete(id);
            }
        }
        const journal = makeJournal();
        let staged = [];
        const undoParking = () => {
            if (!parked_ids || !ctx.byId) return;
            for (const [id, node] of parked_ids) if (!node.removed) ctx.byId.set(id, node);
        };

        try {
            if (o.world !== false && world && world.length) {
                const wrapper = prefab().load(world);
                const roots = wrapper && wrapper.nodes ? wrapper.nodes : [];
                result.nodes = roots.length;
            }
            staged = (ctx.nodes || []).filter((n) => n && !n.removed && !before.has(n));
        } catch (e) {
            result.stage = 'prepare';
            result.reason = '$.save: мир не подготовился — ' + e;
            for (const node of staged) node.destroy();
            undoParking();
            journal.rollback();
            state.rollbacks++;
            failWith('prepare', result.reason, { fatal: o.fatal === true });
            return result;
        }

        // 3. Стабильные ID: восстановленные nid не должны столкнуться с теми,
        //    что выдаст счётчик новым узлам. Столкновение лечим переназначением
        //    (сопоставление «снимок → живой узел» сохраняем в remap).
        const remap = reserveNids(staged);

        // 4. Связи и поведение: состояние по nid + фабрики (§10).
        let applied = { applied: 0, missing: [], providers: [], missing_providers: [] };
        let mapped_state = {};
        try {
            mapped_state = remapNodeState(node_state, remap);
            applied = applyNodeState(staged, mapped_state, journal);
        } catch (e) {
            result.stage = 'behavior';
            result.reason = '$.save: поведение не восстановилось — ' + e;
            rollbackStaged(staged, journal, undoParking);
            return result;
        }
        result.applied = applied.applied;
        result.missing = applied.missing;
        result.providers = applied.providers;
        result.missing_providers = applied.missing_providers;

        // Слоты версии 2 хранили скорости позиционно (порядок обхода дерева).
        // Если состояния по nid нет — применяем их как запасной путь.
        if (o.speeds !== false && Array.isArray(room.speeds) && Object.keys(node_state).length === 0) {
            applySpeeds(staged.filter((n) => !n.parent_node), room.speeds);
        }

        // 5. Инварианты: то, что обязано сойтись, иначе лучше не коммитить.
        const problems = [];
        if (o.world !== false && world && world.length && result.nodes === 0) {
            problems.push('данные мира не разобрались — корневых узлов нет');
        }
        if (applied.missing.length) problems.push('нет узлов для nid: ' + applied.missing.slice(0, 8).join(', '));
        const dup = duplicateNids(staged);
        if (dup.length) problems.push('повторяющиеся nid: ' + dup.slice(0, 8).join(', '));
        if (problems.length) {
            result.stage = 'invariants';
            result.reason = '$.save: инварианты restore нарушены — ' + problems.join('; ');
            rollbackStaged(staged, journal, undoParking);
            failWith('invariants', result.reason, { fatal: o.fatal === true, details: problems });
            return result;
        }

        // 6. Commit: старый мир уходит, подготовленный остаётся.
        const kept = new Set(staged);
        clearWorld(kept);
        if (ctx.byId) {
            for (const [id, node] of [...ctx.byId.entries()]) if (node.removed) ctx.byId.delete(id);
        }
        if (o.store !== false) applyStore(data.store, o.store);
        if (o.namespaces !== false) {
            loadNamespaceData('profile', data.namespaces.profile.data);
            loadNamespaceData('presentation', data.namespaces.presentation.data);
            loadNamespaceData('room', data.namespaces.room.data);
        }
        if (o.rng !== false) rngRestore(data.namespaces.run.rng);
        journal.commit();
        restored_state = mapped_state;

        state.restores++;
        state.committed_nodes = staged.length;
        state.last_error = null;
        state.last_failure = null;
        result.ok = true;
        result.stage = 'commit';
        if (result.content.length) {
            // warn-политика: расхождение видно машине, но кадр живёт.
            ctx.log('$.save: content не совпал — ' + result.content
                .map((c) => `${c.kind} "${c.name}": ${c.saved} → ${c.current}`).join('; '));
        }
        return result;
    }

    /** Откат подготовленных узлов и всего, что записал журнал. */
    function rollbackStaged(staged, journal, undoParking) {
        for (const node of staged) {
            if (node && !node.removed) node.destroy();
        }
        const cleanups = journal.rollback();
        if (undoParking) undoParking();
        state.rollbacks++;
        return cleanups;
    }

    /**
     * Зарезервировать nid под восстановленные значения: счётчик nid приватный,
     * и после загрузки старых слотов он может «догнать» уже занятые номера.
     * Тогда часть узлов получает новые nid, а карта сопоставления сохраняет
     * связь «nid в снимке → живой узел».
     */
    function reserveNids(nodes) {
        const remap = new Map();
        if (!nodes.length) return remap;
        const probe = assignNid({});
        const counter = Number(String(probe).replace(/^n/, '')) || 0;
        for (const node of nodes) {
            const current = String(node.nid);
            const n = Number(current.replace(/^n/, '')) || 0;
            if (n < counter) continue;            // номер свободен для будущих узлов
            node.nid = '';
            const fresh = assignNid(node);
            remap.set(current, fresh);
        }
        return remap;
    }

    /** Перенести ключи состояния по nid на переназначенные nid. */
    function remapNodeState(nodeState, remap) {
        if (!nodeState || remap.size === 0) return nodeState || {};
        const out = {};
        const fresh = new Set(remap.values());
        for (const nid of Object.keys(nodeState)) {
            const to = remap.get(nid);
            if (to !== undefined) out[to] = nodeState[nid];
            else if (!fresh.has(nid)) out[nid] = nodeState[nid];
        }
        return out;
    }

    /** nid, которые встретились в подготовленных узлах больше одного раза. */
    function duplicateNids(nodes) {
        const seen = new Set();
        const dup = [];
        for (const node of nodes) {
            const nid = String(node.nid);
            if (seen.has(nid)) { if (dup.indexOf(nid) < 0) dup.push(nid); }
            else seen.add(nid);
        }
        return dup;
    }

    // --- Снимок целиком ----------------------------------------------------

    /**
     * Снимок состояния. opts: { world (true), store (true), speeds (true),
     * meta, namespaces (true), rng (true), nodeState (true) }.
     * `store === false` — без данных раздела run, `world === false` — без узлов.
     */
    function snapshot(opts) {
        const o = opts || {};
        const payload = makeSave({
            saved_at: Date.now(),
            saved_frame: engine.frame,
            time: engine.time,
            scene: sceneName(),
            store: o.store === false ? {} : storeData(),
            content: contentOf(),
            meta: o.meta,
        });
        // Разделы, у которых нет своего хранилища в $.store.
        payload.namespaces.profile = { data: o.namespaces === false ? {} : allNamespaceData('profile') };
        payload.namespaces.presentation = { data: o.namespaces === false ? {} : allNamespaceData('presentation') };
        payload.namespaces.room.data = o.namespaces === false ? {} : allNamespaceData('room');
        if (o.rng !== false) {
            const rng = rngState();
            if (rng) payload.namespaces.run.rng = rng;
        }
        if (o.world !== false) {
            const roots = rootNodes();
            payload.namespaces.room.world = worldData();
            if (payload.namespaces.room.world && o.speeds !== false) {
                payload.namespaces.room.speeds = speedsOf(roots);
            }
            if (o.nodeState !== false) {
                payload.namespaces.room.nodes = nodeStateOf(roots);
            }
        }
        // Зеркала пересобираем из разделов: их читает старый код.
        const mirror = makeSave(payload);
        payload.store = mirror.store;
        payload.world = mirror.world;
        payload.speeds = mirror.speeds;
        payload.node_state = mirror.node_state;
        return payload;
    }

    /**
     * Применить снимок (объект или уже разобранные данные). opts:
     * { store: true | 'merge' | false, world: true|false, clear: true|false,
     *   speeds: true|false, nodes: true|false, rng: true|false,
     *   namespaces: true|false, content: 'strict'|'warn'|'ignore',
     *   transactional: true, fatal: true }.
     *
     * По умолчанию это транзакционный restore (§14). `transactional: false`
     * оставлен для старого поведения «сначала очистить, потом грузить».
     */
    function apply(payload, opts) {
        const o = opts || {};
        const data = migrateSave(payload);
        if (!data) {
            return failWith('schema', '$.save: не понял сохранение' +
                (plainObject(payload) && payload.version !== undefined
                    ? ` версии ${payload.version} (поддерживается до ${SAVE_VERSION})`
                    : ''), { fatal: o.fatal === true, version: plainObject(payload) ? payload.version : null });
        }
        if (o.transactional === false) {
            let applied = false;
            if (o.store !== false) { applyStore(data.store, o.store); applied = true; }
            if (o.world !== false && Array.isArray(data.world)) {
                applyWorld(data.world, { clear: o.clear, speeds: o.speeds === false ? null : data.speeds });
                applied = true;
            }
            return applied;
        }
        return restoreTransactional(data, o).ok;
    }

    // --- Слоты на диске ----------------------------------------------------
    //
    // Протокол записи (§14): временный файл → проверка записи → atomic replace
    // там, где платформа это даёт → backup последней корректной версии →
    // восстановление после сбоя. Проверено на этом backend: `engine.fs` умеет
    // только readText/write/exists/remove/list — rename в биндингах НЕТ,
    // поэтому atomic replace недоступен и crash-safety не обещается: слот
    // защищён копией `.bak` и проверкой чтения после записи (см. save.md).

    const TMP_SUFFIX = '.tmp';
    const BAK_SUFFIX = '.bak';

    /** Файл слота читается и разбирается? Возвращает { text, parsed, raw }. */
    function readSlotFile(path) {
        const text = readFile(path);
        if (text === null) return { text: null, parsed: null, raw: null };
        const parsed = parseSaveJson(text);
        if (!parsed.ok) return { text, parsed, raw: parsed.raw };
        return { text, parsed, raw: parsed.raw };
    }

    /**
     * Чтение слота: основной файл, при повреждении — копия `.bak`. Так
     * прерванная запись не уничтожает последний корректный слот.
     */
    function payloadOf(slot) {
        const name = normalizeSlot(slot);
        const path = slotPath(state.dir, name);
        const main = readSlotFile(path);
        if (main.parsed && main.parsed.ok) {
            state.last_error = null;
            return main.parsed.data;
        }
        if (main.text === null) {
            // Основного файла нет — возможно, осталась только копия.
            const bak = readSlotFile(path + BAK_SUFFIX);
            if (bak.parsed && bak.parsed.ok) {
                state.recovered++;
                state.last_error = `$.save: слот "${name}" восстановлен из копии ${path}${BAK_SUFFIX}`;
                ctx.log(state.last_error);
                return bak.parsed.data;
            }
            failWith('read', `$.save: слот "${name}" не найден (${path})`, { slot: name, path });
            return null;
        }
        const broken = main.parsed ? main.parsed.error : 'файл не читается';
        const bak = readSlotFile(path + BAK_SUFFIX);
        if (bak.parsed && bak.parsed.ok) {
            state.recovered++;
            state.last_error = `$.save: слот "${name}" повреждён (${broken}); взят backup`;
            ctx.log(state.last_error);
            return bak.parsed.data;
        }
        failWith('read', `$.save: слот "${name}" (${path}) — ${broken}`, { slot: name, path });
        return null;
    }

    function infoOf(slot) {
        const name = normalizeSlot(slot);
        const path = slotPath(state.dir, name);
        const main = readSlotFile(path);
        if (!main.parsed || !main.parsed.ok) {
            if (main.text === null) {
                state.last_error = `$.save: слот "${name}" не найден (${path})`;
                return null;
            }
            failWith('info', `$.save: слот "${name}" (${path}) — ${main.parsed.error}`, { slot: name, path });
            return null;
        }
        state.last_error = null;
        // saveInfo() получает СЫРОЙ объект файла: если отдать мигрированный,
        // слот из старой версии выглядел бы как записанный текущей.
        return saveInfo(main.parsed.raw, {
            slot: name, path, size: main.text.length,
        });
    }

    /**
     * Проверка «этот слот нельзя затирать»: в файле версия новее нашей.
     * Слот будущей версии отклоняется БЕЗ перезаписи (§14).
     */
    function futureSlot(path) {
        const cur = readSlotFile(path);
        if (cur.text === null) return null;
        if (cur.parsed && cur.parsed.ok) return null;              // корректный старый/текущий
        const raw = cur.raw;
        if (plainObject(raw) && typeof raw.version === 'number' && isFinite(raw.version)
            && Math.floor(raw.version) > SAVE_VERSION) {
            return Math.floor(raw.version);
        }
        return null;
    }

    /**
     * Запись слота по протоколу §14. `text` уже сериализован вызывающим.
     * Возвращает { ok, stage, temp, backup }.
     */
    function writeSlotText(slot, text, opts) {
        const o = opts || {};
        const name = normalizeSlot(slot);
        const path = slotPath(state.dir, name);
        const out = { ok: false, stage: 'write', temp: false, backup: false, path, slot: name };

        // 0. Слот из будущего не перезаписываем вообще.
        const future = futureSlot(path);
        if (future !== null && o.force !== true) {
            state.rejected_future++;
            out.stage = 'future';
            out.version = future;
            failWith('future', `$.save: слот "${name}" записан версией ${future} `
                + `(поддерживается до ${SAVE_VERSION}) — не перезаписываю`,
                { slot: name, path, version: future, details: { future, current: SAVE_VERSION },
                  fatal: o.fatal === true });
            return out;
        }

        // 1. Временный файл + проверка записи (что реально легло на диск).
        const tmp = path + TMP_SUFFIX;
        if (!writeFile(tmp, text)) {
            out.stage = 'temp';
            // Раньше отказ записи ВРЕМЕННОГО файла возвращался без структуры:
            // `$.save.save({fatal:true})` не оставлял ни last_failure, ни записи
            // в $.debug.errors — провал обязательной операции был виден только
            // строкой в журнале (§14/§17 запрещают такое).
            //
            // Причину берём из нижнего уровня, а не переписываем своей: иначе
            // терялась подсказка «нет $.fs — модуль store.js не установлен»,
            // и по сообщению нельзя было понять, чего именно не хватает.
            const reason = state.last_error && state.last_error.indexOf('нет $.fs') >= 0
                ? ` — ${state.last_error}` : '';
            failWith('temp', `$.save: не удалось записать временный файл "${tmp}"${reason}`,
                { slot: name, path: tmp, fatal: o.fatal === true });
            return out;
        }
        const check = readSlotFile(tmp);
        if (!check.parsed || !check.parsed.ok || check.text !== text) {
            out.stage = 'verify-temp';
            failWith('verify-temp', `$.save: временный файл "${tmp}" не совпал с записанным`,
                { slot: name, path: tmp, fatal: o.fatal === true });
            return out;
        }
        out.temp = true;
        state.temp_writes++;

        // 2. Backup последней корректной версии — до перезаписи основного.
        const existing = readSlotFile(path);
        if (existing.parsed && existing.parsed.ok && existing.text !== null) {
            if (writeFile(path + BAK_SUFFIX, existing.text)) {
                out.backup = true;
                state.backups++;
            }
        }

        // 3. Перезапись основного файла и проверка чтением.
        if (!writeFile(path, text)) {
            // Не смогли — слот остался прежним, временный и копия не мешают.
            out.stage = 'replace';
            failWith('replace', `$.save: не удалось записать "${path}" — слот оставлен прежним`,
                { slot: name, path, fatal: o.fatal === true });
            return out;
        }
        const after = readSlotFile(path);
        if (!after.parsed || !after.parsed.ok || after.text !== text) {
            out.stage = 'verify';
            const restored = out.backup && writeFile(path, existing.text);
            failWith('verify', `$.save: слот "${name}" не прошёл проверку после записи`
                + (restored ? ' — восстановлен backup' : ''),
                { slot: name, path, fatal: o.fatal === true });
            return out;
        }
        out.ok = true;
        out.stage = 'commit';
        state.saves++;
        state.last_error = null;
        return out;
    }

    function writeSlot(slot, opts) {
        const o = opts || {};
        const text = serializeSave(snapshot(o));
        return writeSlotText(slot, text, o).ok;
    }

    /** Аргументы вида (slot, opts) или (opts) — у save/load/export одни и те же. */
    function argsOf(a, b) {
        if (a && typeof a === 'object') return { slot: state.slot, opts: a };
        return { slot: a === undefined || a === null ? state.slot : normalizeSlot(a), opts: b || {} };
    }

    const save = {
        // --- Настройки -----------------------------------------------------
        /** Текущий слот: `slot()` — узнать, `slot(2)` — выбрать. */
        slot(value) {
            if (value === undefined) return state.slot;
            state.slot = normalizeSlot(value);
            return save;
        },

        /** Каталог слотов: `dir()` / `dir('build/saves')`. */
        dir(value) {
            if (value === undefined) return state.dir;
            state.dir = normalizeDir(value);
            return save;
        },

        /** Путь к файлу слота (текущего или указанного). */
        path(slot) {
            return slotPath(state.dir, slot === undefined ? state.slot : slot);
        },

        /** Версия формата, в которой пишет модуль. */
        version() { return SAVE_VERSION; },

        // --- Снимок без диска ----------------------------------------------
        snapshot(opts) { return snapshot(opts); },
        /** Данные $.store снимком (для «сохранить только инвентарь»). */
        storeData() { return storeData(); },
        /** Данные мира снимком (массив узлов) или null без $.prefab. */
        worldData() { return worldData(); },
        apply(payload, opts) { return apply(payload, opts); },
        applyStore(data, mode) { return applyStore(data, mode); },
        applyWorld(nodes, opts) { return applyWorld(nodes, opts); },

        // --- Слоты ---------------------------------------------------------
        /** Записать состояние: `save()`, `save(2)`, `save({ world: false })`. */
        save(slotOrOpts, opts) {
            const a = argsOf(slotOrOpts, opts);
            return writeSlot(a.slot, a.opts);
        },

        /** Прочитать слот и применить его. Текущий слот переключается. */
        load(slotOrOpts, opts) {
            const a = argsOf(slotOrOpts, opts);
            const payload = payloadOf(a.slot);
            if (!payload) return false;
            if (!apply(payload, a.opts)) return false;
            state.slot = a.slot;
            state.loads++;
            return true;
        },

        /**
         * Транзакционное восстановление снимка (§14): возвращает структуру
         * `{ ok, stage, nodes, applied, missing, providers, content, reason }`.
         * Ошибка до commit не трогает рабочее состояние.
         */
        restore(payload, opts) {
            const data = migrateSave(payload);
            if (!data) {
                return {
                    ok: false, stage: 'schema', nodes: 0, applied: 0, missing: [],
                    providers: [], content: [], reason: '$.save.restore: не понял снимок',
                };
            }
            return restoreTransactional(data, opts);
        },

        /** Структура последнего отказа (код, шаг, слот, версия) или null. */
        lastFailure() { return state.last_failure; },

        // --- Namespaces (§14) ----------------------------------------------
        /**
         * Раздел снимка: `ns()` — текущий, `ns('profile')` — выбрать.
         * С `opts.handle === false` (или вторым аргументом) возвращает
         * объект-доступ к разделу: `set/get/has/remove/all/clear/keys`.
         */
        ns(name, opts) {
            if (name === undefined) return state.ns;
            const key = String(name);
            if (NAMESPACES.indexOf(key) < 0) {
                fail(`$.save.ns: неизвестный раздел "${name}" (есть: ${NAMESPACES.join(', ')})`);
                return null;
            }
            state.ns = key;
            if (opts === false) return nsStore(key);
            return save;
        },
        /** Список разделов. */
        namespaces() { return NAMESPACES.slice(); },
        /** Доступ к разделу: `$.save.profile().set('lang', 'ru')`. */
        profile() { return nsStore('profile'); },
        run() { return nsStore('run'); },
        room() { return nsStore('room'); },
        presentation() { return nsStore('presentation'); },
        /** Данные раздела как объект. */
        nsData(name) { return allNamespaceData(name === undefined ? state.ns : String(name)); },

        /**
         * Записать/прочитать значение в текущем разделе (по умолчанию run).
         * `set(key, value)`, `get(key, fallback)`, `has`, `remove`.
         */
        set(key, value) {
            const s = nsStore(state.ns);
            if (!s) return fail(`$.save.set: раздел "${state.ns}" недоступен`);
            s.set(key, value);
            return save;
        },
        get(key, fallback) {
            const s = nsStore(state.ns);
            return s ? s.get(key, fallback) : fallback;
        },
        has(key) {
            const s = nsStore(state.ns);
            return s ? s.has(key) : false;
        },
        unset(key) {
            const s = nsStore(state.ns);
            if (s) s.remove(key);
            return save;
        },

        /**
         * Перезапуск прохождения (§14): сбрасываются run и room, а profile
         * (input/audio/язык) и presentation остаются. RNG разворачивается от
         * зерна прохождения, если оно сохранено в разделе run (`run.seed`).
         */
        restartRun(opts) {
            const o = opts || {};
            const world = o.world !== false;
            if (world) clearWorld();
            loadNamespaceData('run', {});
            loadNamespaceData('room', {});
            if (o.profile === true) loadNamespaceData('profile', {});
            if (o.presentation === true) loadNamespaceData('presentation', {});
            if (o.rng !== false) {
                const r = rngApi();
                const seed = num(save.get('seed', o.seed), NaN);
                if (r && typeof r.seed === 'function' && isFinite(seed)) r.seed(seed);
            }
            state.last_error = null;
            state.last_failure = null;
            return save;
        },

        // --- Поведение (§10) ------------------------------------------------
        /**
         * Регистрация фабрики поведения: логика остаётся в коде, снимок
         * хранит только данные. Возвращает число фабрик.
         */
        behavior(match, provider, name) { return addBehavior(match, provider, name); },
        /** Имена зарегистрированных фабрик. */
        behaviors() { return behaviorProviders(); },
        /** Снять все фабрики (перезагрузка скриптов, тесты). */
        clearBehaviors() { providers.length = 0; return save; },
        /**
         * Состояние узлов снимком по nid: `nodeState()` — весь мир,
         * `nodeState(roots)` — поддерево.
         */
        nodeState(roots) { return nodeStateOf(roots === undefined ? rootNodes() : roots); },
        /**
         * Разовое состояние конкретного узла по nid (без фабрики):
         * `$.save.setNodeState('#hero', { cooldown: 0.4 })`. Попадает в снимок
         * под ключом `m` и возвращается после restore через `getNodeState`.
         */
        setNodeState(selectorOrNode, data) {
            const node = typeof selectorOrNode === 'string'
                ? (ctx.byId ? ctx.byId.get(selectorOrNode.replace(/^#/, '')) : null)
                : (selectorOrNode && selectorOrNode.nodes ? selectorOrNode.nodes[0] : selectorOrNode);
            if (!node) return fail('$.save.setNodeState: узел не найден');
            manual_state[String(node.nid)] = sanitizeObject(data);
            return save;
        },
        /**
         * Состояние узла по nid: сначала то, что применил последний restore
         * (игре его надо разложить по полям), потом — записанное вручную.
         */
        getNodeState(nidOrSelector) {
            const nid = typeof nidOrSelector === 'string' && nidOrSelector[0] !== 'n'
                ? (ctx.byId && ctx.byId.get(nidOrSelector.replace(/^#/, '')) ? String(ctx.byId.get(nidOrSelector.replace(/^#/, '')).nid) : '')
                : String(nidOrSelector);
            return restored_state[nid] || manual_state[nid] || null;
        },

        // --- Content-версии (§14) -------------------------------------------
        /**
         * Объявить версию/хэш контента: `$.save.content('level1', {version: 2, hash: 'ab12'})`.
         * Проверяется при restore: `content: 'strict'` отклоняет расхождение.
         */
        content(name, value) {
            const key = String(name);
            if (value === undefined) {
                return { version: content_versions[key], hash: content_hashes[key] };
            }
            if (plainObject(value)) {
                if (value.version !== undefined) content_versions[key] = value.version;
                if (value.hash !== undefined) content_hashes[key] = String(value.hash);
            } else if (value !== null) {
                content_versions[key] = value;
            } else {
                delete content_versions[key];
                delete content_hashes[key];
            }
            return save;
        },
        /** Объявленные content-версии и хэши. */
        contents() { return contentOf(); },

        /** Данные слота без применения (объект снимка) или null. */
        read(slot) { return payloadOf(slot === undefined ? state.slot : slot); },

        /** Записать готовый снимок (объект из snapshot()) в слот. */
        write(payload, slot, opts) {
            const target = slot === undefined ? state.slot : normalizeSlot(slot);
            if (!migrateSave(payload)) {
                return fail('$.save: write() ждёт снимок (объект из $.save.snapshot()); строку пишите через import()');
            }
            return writeSlotText(target, serializeSave(payload), opts).ok;
        },

        /**
         * Проверить слот, не применяя его: `{ ok, backup, version, error }`.
         * `recover(slot)` — явно вылечить слот из `.bak`.
         */
        verify(slot) {
            const name = normalizeSlot(slot === undefined ? state.slot : slot);
            const path = slotPath(state.dir, name);
            const main = readSlotFile(path);
            if (main.parsed && main.parsed.ok) {
                return { ok: true, slot: name, path, version: main.parsed.data.version, backup: false, error: null };
            }
            const bak = readSlotFile(path + BAK_SUFFIX);
            if (bak.parsed && bak.parsed.ok) {
                return {
                    ok: false, slot: name, path, backup: true,
                    version: bak.parsed.data.version,
                    error: main.text === null ? 'файла нет, есть только backup' : main.parsed.error,
                };
            }
            return {
                ok: false, slot: name, path, backup: false, version: null,
                error: main.text === null ? 'файла нет' : main.parsed.error,
            };
        },

        /** Восстановить слот из `.bak` (если backup корректнее основного файла). */
        recover(slot) {
            const name = normalizeSlot(slot === undefined ? state.slot : slot);
            const path = slotPath(state.dir, name);
            const bak = readSlotFile(path + BAK_SUFFIX);
            if (!bak.parsed || !bak.parsed.ok || bak.text === null) {
                return failWith('recover', `$.save: у слота "${name}" нет корректного backup`, { slot: name, path });
            }
            if (!writeFile(path, bak.text)) return false;
            state.recovered++;
            state.last_error = null;
            return true;
        },

        exists(slot) {
            const f = fs();
            if (!f || typeof f.exists !== 'function') return false;
            return !!f.exists(slotPath(state.dir, slot === undefined ? state.slot : slot));
        },

        /**
         * Список слотов каталога. По умолчанию читает и разбирает каждый файл
         * (нужны версия, время и число узлов для меню сохранений);
         * `list({ meta: false })` — только имена файлов, без чтения.
         */
        list(opts) {
            const o = opts || {};
            const dir = o.dir === undefined ? state.dir : normalizeDir(o.dir);
            const f = fs();
            const names = f && typeof f.list === 'function' ? (f.list(dir) || []) : [];
            const out = [];
            for (const raw of names) {
                const slot = slotFromFile(raw);
                if (slot === null) continue;
                const path = slotPath(dir, slot);
                if (o.meta === false) { out.push({ slot, path, file: String(raw) }); continue; }
                const text = readFile(path);
                if (text === null) {
                    out.push({ slot, path, file: String(raw), ok: false, error: 'файл не читается' });
                    continue;
                }
                const parsed = parseSaveJson(text);
                if (!parsed.ok) {
                    out.push({ slot, path, file: String(raw), size: text.length, ok: false, error: parsed.error });
                    continue;
                }
                out.push(saveInfo(parsed.raw, { slot, path, file: String(raw), size: text.length }));
            }
            return sortSlots(out);
        },

        /** Метаданные одного слота или null. */
        info(slot) { return infoOf(slot === undefined ? state.slot : slot); },

        /** Удалить файл слота. */
        remove(slot) {
            const target = slot === undefined ? state.slot : normalizeSlot(slot);
            const path = slotPath(state.dir, target);
            const f = fs();
            if (!f || typeof f.remove !== 'function') return fail('$.save: нет $.fs — слот не удалить');
            if (!f.remove(path)) {
                state.last_error = `$.save: слот "${target}" не удалён (${path}) — файла нет?`;
                return false;
            }
            // Копия и недописанный временный файл уходят вместе со слотом.
            if (typeof f.remove === 'function') {
                f.remove(path + BAK_SUFFIX);
                f.remove(path + TMP_SUFFIX);
            }
            state.last_error = null;
            return true;
        },

        // --- Строки: $.http, буфер обмена, тесты ---------------------------
        /** Состояние строкой JSON. */
        export(opts) { return serializeSave(snapshot(opts)); },

        /** Применить строку JSON (в том числе чужую, из сети). */
        import(text, opts) {
            const parsed = parseSaveJson(text);
            if (!parsed.ok) {
                return fail(`$.save: import — ${parsed.error}`);
            }
            return apply(parsed.data, opts);
        },

        // --- Автосейв ------------------------------------------------------
        /**
         * Автосейв каждые ms игрового времени (по умолчанию 60000) в слот
         * AUTO_SLOT ('0'), не меняя текущий слот. Возвращает id таймера.
         */
        autosave(ms, slot) {
            save.stopAutosave();
            const every = Math.max(50, Math.floor(num(ms, DEFAULT_AUTOSAVE_MS)));
            const target = slot === undefined || slot === null ? AUTO_SLOT : normalizeSlot(slot);
            const time = ctx.time;
            if (!time || typeof time.every !== 'function') {
                fail('$.save: нет $.time — автосейв недоступен, сохраняйте вручную');
                return 0;
            }
            state.auto_ms = every;
            state.auto_slot = target;
            state.auto_id = time.every(every, () => {
                if (writeSlot(target, { meta: { autosave: true } })) state.autosaves++;
            });
            return state.auto_id;
        },

        stopAutosave() {
            if (state.auto_id && ctx.time && typeof ctx.time.cancel === 'function') {
                ctx.time.cancel(state.auto_id);
            }
            state.auto_id = 0;
            state.auto_ms = 0;
            return save;
        },

        // --- Счётчики ------------------------------------------------------
        /**
         * Счётчик в $.store: `counter('kills')` — прочитать,
         * `counter('kills', 1)` — увеличить и вернуть новое значение.
         * Счётчики уезжают в слот вместе с остальными данными $.store.
         */
        counter(key, delta) {
            const s = store();
            if (!s) return 0;
            const current = num(s.get(key, 0), 0);
            if (delta === undefined) return current;
            const next = current + num(delta, 0);
            s.set(key, next);
            return next;
        },

        /** Сводка модуля — для отладки и тестов. */
        stats() {
            return {
                slot: state.slot,
                dir: state.dir,
                path: slotPath(state.dir, state.slot),
                version: SAVE_VERSION,
                namespace: state.ns,
                saves: state.saves,
                loads: state.loads,
                restores: state.restores,
                rollbacks: state.rollbacks,
                temp_writes: state.temp_writes,
                backups: state.backups,
                recovered: state.recovered,
                rejected_future: state.rejected_future,
                committed_nodes: state.committed_nodes,
                behavior_loads: state.behavior_loads,
                behaviors: providers.map((p) => p.name),
                content: contentOf(),
                autosaves: state.autosaves,
                autosave_ms: state.auto_ms,
                autosave_slot: state.auto_slot,
                last_error: state.last_error,
                last_failure: state.last_failure,
            };
        },
    };

    $.save = save;
    ctx.save = save;
    return save;
}
