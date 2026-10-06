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

import { ctx } from './core.js';
import { sanitize } from './prefab.js';

export const SAVE_FORMAT = 'r2d.save';
export const SAVE_VERSION = 2;          // 1 — формат $.store.save(), 2 — слоты
export const DEFAULT_DIR = 'saves';
export const DEFAULT_SLOT = '1';
export const AUTO_SLOT = '0';           // слот автосейва
export const DEFAULT_AUTOSAVE_MS = 60000;

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

/** Двумерный вектор из массива или объекта — тело отдаёт и то и другое. */
function vec2(value) {
    if (Array.isArray(value)) return [num(value[0], 0), num(value[1], 0)];
    if (value && typeof value === 'object') return [num(value.x, 0), num(value.y, 0)];
    return [0, 0];
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
 * Канонический вид сохранения: поля всегда в одном порядке, лишнее срезано.
 * Именно этот объект уходит в файл — save → load → save даёт тот же JSON.
 */
export function makeSave(raw) {
    const src = plainObject(raw) ? raw : {};
    const store = sanitize(plainObject(src.store) ? src.store : {}, new Set());
    const meta = sanitize(plainObject(src.meta) ? src.meta : {}, new Set());
    const world = Array.isArray(src.world) ? sanitize(src.world, new Set()) : null;
    const speeds = Array.isArray(src.speeds) ? sanitize(src.speeds, new Set()) : null;
    const out = {
        format: SAVE_FORMAT,
        version: SAVE_VERSION,
        saved_at: Math.floor(num(src.saved_at, 0)),
        saved_frame: Math.floor(num(src.saved_frame, 0)),
        time: num(src.time, 0),
        scene: src.scene === undefined ? null : src.scene,
        store: store === undefined ? {} : store,
        world: world === undefined ? null : world,
        speeds: speeds === undefined ? null : speeds,
        meta: meta === undefined ? {} : meta,
    };
    if (src.migrated_from !== undefined) out.migrated_from = Math.floor(num(src.migrated_from, 0));
    return out;
}

export function serializeSave(raw) {
    return JSON.stringify(makeSave(raw), null, 2);
}

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

    const structured = raw.format === SAVE_FORMAT || version !== null || Array.isArray(raw.world);
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
        store,
        world,
        speeds: structured ? raw.speeds : null,
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
 * Метаданные слота для list()/info(): то, что нужно меню сохранений, — без
 * самих данных мира (их может быть много).
 */
export function saveInfo(raw, extra) {
    const base = plainObject(extra) ? extra : {};
    const data = migrateSave(raw) || makeSave({});
    const source = plainObject(raw) ? raw : {};
    const version = typeof source.version === 'number' && isFinite(source.version)
        ? Math.floor(source.version) : null;
    const world = Array.isArray(data.world) ? data.world : null;
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
    };

    // $.fs/$.store ставит store.js, $.prefab — prefab.js. Модуль может быть
    // установлен и раньше них, поэтому берём соседей в момент вызова.
    function fs() { return $.fs || ctx.fs || null; }
    function store() { return $.store || ctx.store || null; }
    function prefab() { return $.prefab || ctx.prefab || null; }

    function fail(message) {
        state.last_error = message;
        ctx.log(message);
        return false;
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

    /** Убрать текущий мир перед восстановлением снимка. */
    function clearWorld() {
        let count = 0;
        for (const node of (ctx.nodes || []).slice()) {
            if (node.removed) continue;
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

    // --- Снимок целиком ----------------------------------------------------

    /**
     * Снимок состояния. opts: { world (true), store (true), speeds (true),
     * meta }. store === false — без данных $.store, world === false — без узлов.
     */
    function snapshot(opts) {
        const o = opts || {};
        const payload = makeSave({
            saved_at: Date.now(),
            saved_frame: engine.frame,
            time: engine.time,
            scene: sceneName(),
            store: o.store === false ? {} : storeData(),
            meta: o.meta,
        });
        if (o.world !== false) {
            const roots = rootNodes();
            payload.world = worldData();
            if (payload.world && o.speeds !== false) payload.speeds = speedsOf(roots);
        }
        return payload;
    }

    /**
     * Применить снимок (объект или уже разобранные данные). opts:
     * { store: true | 'merge' | false, world: true|false, clear: true|false,
     *   speeds: true|false }. Возвращает true, если применена хоть одна часть.
     */
    function apply(payload, opts) {
        const o = opts || {};
        const data = migrateSave(payload);
        if (!data) {
            return fail('$.save: не понял сохранение' +
                (plainObject(payload) && payload.version !== undefined
                    ? ` версии ${payload.version} (поддерживается до ${SAVE_VERSION})`
                    : ''));
        }
        let applied = false;
        if (o.store !== false) { applyStore(data.store, o.store); applied = true; }
        if (o.world !== false && Array.isArray(data.world)) {
            applyWorld(data.world, { clear: o.clear, speeds: o.speeds === false ? null : data.speeds });
            applied = true;
        }
        return applied;
    }

    // --- Слоты на диске ----------------------------------------------------

    function payloadOf(slot) {
        const path = slotPath(state.dir, slot);
        const text = readFile(path);
        if (text === null) {
            state.last_error = `$.save: слот "${normalizeSlot(slot)}" не найден (${path})`;
            ctx.log(state.last_error);
            return null;
        }
        const parsed = parseSaveJson(text);
        if (!parsed.ok) {
            state.last_error = `$.save: слот "${normalizeSlot(slot)}" (${path}) — ${parsed.error}`;
            ctx.log(state.last_error);
            return null;
        }
        state.last_error = null;
        return parsed.data;
    }

    function infoOf(slot) {
        const path = slotPath(state.dir, slot);
        const text = readFile(path);
        if (text === null) {
            state.last_error = `$.save: слот "${normalizeSlot(slot)}" не найден (${path})`;
            return null;
        }
        const parsed = parseSaveJson(text);
        if (!parsed.ok) {
            state.last_error = `$.save: слот "${normalizeSlot(slot)}" (${path}) — ${parsed.error}`;
            ctx.log(state.last_error);
            return null;
        }
        state.last_error = null;
        // saveInfo() получает СЫРОЙ объект файла: если отдать мигрированный,
        // слот из старой версии выглядел бы как записанный текущей.
        return saveInfo(parsed.raw, {
            slot: normalizeSlot(slot), path, size: text.length,
        });
    }

    function writeSlot(slot, opts) {
        const path = slotPath(state.dir, slot);
        if (!writeFile(path, serializeSave(snapshot(opts)))) return false;
        state.saves++;
        state.last_error = null;
        return true;
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

        /** Данные слота без применения (объект снимка) или null. */
        read(slot) { return payloadOf(slot === undefined ? state.slot : slot); },

        /** Записать готовый снимок (объект из snapshot()) в слот. */
        write(payload, slot) {
            const target = slot === undefined ? state.slot : normalizeSlot(slot);
            const data = migrateSave(payload);
            if (!data) return fail('$.save: write() ждёт снимок (объект из $.save.snapshot()); строку пишите через import()');
            if (!writeFile(slotPath(state.dir, target), serializeSave(data))) return false;
            state.saves++;
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
                saves: state.saves,
                loads: state.loads,
                autosaves: state.autosaves,
                autosave_ms: state.auto_ms,
                autosave_slot: state.auto_slot,
                last_error: state.last_error,
            };
        },
    };

    $.save = save;
    ctx.save = save;
    return save;
}
