// ===========================================================================
// Файлы и сохранения: $.fs и $.store.
//
// $.fs   — чтение и запись файлов рядом с игрой (путь от корня запуска).
// $.store — обычный key-value, который умеет сохраняться в JSON на диск.
//
//   $.store.set('highscore', 1200);
//   $.store.save();
//   $.store.get('highscore');   // → 1200
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';
import {
    applySchemaMigrations, normalizeSchemaConfig, schemaOf,
    SAVE_SCHEMA_FUTURE, SAVE_SCHEMA_LEGACY,
} from './save.js';

const state = {
    data: new Map(),
    file: 'save.json',
    auto_save_id: 0,
    dirty: false,
    // Игровая схема файла настроек — тот же контракт, что у $.save.schema.
    schema: null,
    schema_migrations: 0,
    loads: 0,
    saves: 0,
    backups: 0,
    recovered: 0,
    last_failure: null,
};

/** Текущая схема файла настроек (0 — схема не объявлена = legacy). */
export function currentStoreSchema() {
    return state.schema ? state.schema.version : SAVE_SCHEMA_LEGACY;
}

function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Причина последнего отказа файловой операции от движка ('' — не было). */
function lastFsError() {
    return (typeof engine.fs.lastError === 'function' ? engine.fs.lastError() : '') || '';
}

/**
 * Отказ файловой операции: РОВНО ОДНА строка, в которой есть путь и причина
 * (§17, отчёты BASHNYA A5 и C5). Причину называет движок
 * (`engine.fs.lastError()`: read-only/EROFS, EACCES, ENOENT, ENOTEMPTY —
 * с абсолютным путём), а `$` кладёт её и в журнал, и в структурную диагностику
 * `$.debug.errors()` с кодом `R2D_FS_WRITE_FAILED`/`R2D_FS_REMOVE_FAILED`
 * и `recoverable: true`.
 *
 * Строка, а не `new Error(...)`: у ошибки печатался бы ещё и стек, а на
 * обычный «диск только для чтения» стек не нужен — он превратил бы одну
 * строку в пять (условие приёмки: ровно одна строка, и тишина при успехе).
 *
 * Почему это важно: в поставке базовый каталог — каталог бинарника, он бывает
 * только для чтения. Игра при этом «работает», а прогресс не сохраняется, и
 * раньше узнать об этом было неоткуда.
 */
function reportFsFailure($, path, where, code) {
    const from_engine = lastFsError();
    const message = from_engine || `не удалось выполнить ${where} для "${path}": причина не сообщена движком`;
    const opts = {
        code,
        subsystem: 'fs',
        recoverable: true,
        assetPath: String(path),
    };
    if ($ && $.debug && typeof $.debug.reportError === 'function') {
        $.debug.reportError(where, message, opts);
        return message;
    }
    if (ctx.reportError) {
        ctx.reportError(where, message);
        return message;
    }
    ctx.log('$: ' + message);
    return message;
}

function reportWriteFailure($, path, where) {
    return reportFsFailure($, path, where, 'R2D_FS_WRITE_FAILED');
}

function reportRemoveFailure($, path) {
    return reportFsFailure($, path, '$.fs.remove', 'R2D_FS_REMOVE_FAILED');
}

// --- Системные диалоги выбора папки/файла ---------------------------------
//
// Нативный диалог отвечает асинхронно (src/dialog.h): ответы забирает
// tickFsDialogs() в кадровом цикле api.js. Пока ничего не открыто, тик — одно
// сравнение.
const dialogs = new Map();   // id → { resolve, reject, many }

let dialogApi = null;         // $ — ставит installStore

// Отказ открыть окно: одна строка в журнале + $.debug.errors() с кодом.
function dialogFailure($, where, message) {
    const err = new Error(`${where}: ${message}`);
    err.code = 'R2D_FS_DIALOG_FAILED';
    if ($ && $.debug && typeof $.debug.reportError === 'function') {
        $.debug.reportError(where, message, { code: err.code, subsystem: 'fs', recoverable: true });
    } else {
        ctx.log(`$: ${err.message} [${err.code}]`);
    }
    return err;
}

function openDialog($, kind, where, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
        if (!engine.fs || typeof engine.fs.dialog !== 'function') {
            reject(dialogFailure($, where, 'системные диалоги недоступны в этой сборке'));
            return;
        }
        const filters = Array.isArray(o.filters) ? o.filters
            .filter((f) => f && typeof f.ext === 'string' && f.ext)
            .map((f) => ({ name: String(f.name || f.ext), ext: f.ext.replace(/[.\s]/g, '').replace(/,/g, ';') })) : [];
        const res = engine.fs.dialog(kind, {
            title: o.title ? String(o.title) : '',
            path: o.path ? String(o.path) : '',
            filters,
            many: !!o.many,
        });
        if (!res || !res.id) {
            reject(dialogFailure($, where, (res && res.error) || 'диалог не открылся'));
            return;
        }
        dialogs.set(res.id, { resolve, reject, many: !!o.many, where });
    });
}

/** Кадровый насос ответов системных диалогов (зовёт api.js). */
export function tickFsDialogs() {
    if (!dialogs.size || !engine.fs || typeof engine.fs.dialogPoll !== 'function') return;
    const done = engine.fs.dialogPoll();
    if (!done || !done.length) return;
    for (const r of done) {
        const d = dialogs.get(r.id);
        if (!d) continue;
        dialogs.delete(r.id);
        if (r.error) { d.reject(dialogFailure(dialogApi, d.where, r.error)); continue; }
        const paths = Array.isArray(r.paths) ? r.paths : [];
        if (!paths.length) d.resolve(null);              // отмена
        else d.resolve(d.many ? paths : paths[0]);
    }
}

export function installStore($) {
    dialogApi = $;
    const fs = {
        /** Текст файла или null, если файла нет. */
        readText(path) {
            const text = engine.fs.readText(path);
            return text === undefined ? null : text;
        },

        /** JSON-файл или значение по умолчанию (с сообщением об ошибке). */
        readJSON(path, fallback) {
            const text = engine.fs.readText(path);
            if (text === undefined || text === null) return fallback === undefined ? null : fallback;
            try { return JSON.parse(text); }
            catch (e) {
                ctx.log(`$: не смог разобрать JSON "${path}": ${e}`);
                return fallback === undefined ? null : fallback;
            }
        },

        write(path, data) {
            const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            const ok = engine.fs.write(path, text);
            if (!ok) reportWriteFailure($, path, '$.fs.write');
            return ok;
        },

        /**
         * Записать файл, заменив целевой АТОМАРНО: биндинг
         * `engine.fs.writeAtomic` делает временный файл рядом + fsync + rename,
         * поэтому прерванная запись не оставляет половину файла.
         *
         * `data` — строка или JSON (как у write). В старой сборке без биндинга
         * — честный fallback на обычную запись: temp+backup тогда делает
         * вызывающий ($.store.save/$.save), и атомарности НЕТ (см. store.md).
         * Возвращает bool; причина отказа — одна строка с путём и кодом
         * `R2D_FS_WRITE_FAILED` (как у write).
         */
        writeAtomic(path, data) {
            const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            if (engine.fs && typeof engine.fs.writeAtomic === 'function') {
                const ok = engine.fs.writeAtomic(path, text);
                if (!ok) reportWriteFailure($, path, '$.fs.writeAtomic');
                return ok;
            }
            // Старая сборка: биндинга нет — пишем обычной записью. Врать про
            // атомарность нельзя: замена не атомарна, спасает backup/verify.
            return fs.write(path, text);
        },

        writeJSON(path, value) {
            const text = JSON.stringify(value, null, 2);
            const ok = engine.fs.write(path, text);
            if (!ok) reportWriteFailure($, path, '$.fs.writeJSON');
            return ok;
        },

        /** Копия файла побайтно (картинка, звук) → bool; каталоги назначения создаются. Причина отказа — как у write. */
        copy(src, dst) {
            if (typeof engine.fs.copy !== 'function') return false;
            const ok = engine.fs.copy(String(src), String(dst));
            if (!ok) reportWriteFailure($, dst, '$.fs.copy');
            return ok;
        },

        exists(path) { return engine.fs.exists(path); },

        /** Список файлов в каталоге (пути, отсортированы). */
        list(dir) { return engine.fs.list(dir); },

        /**
         * Удалить файл. Идемпотентно: если файла нет — это НЕ отказ, и в журнал
         * ничего не пишется (возврат `false`: на нём держится различение
         * «удалил» и «и так нет», см. `$.save.remove`). Настоящий отказ (нет
         * прав, непустой каталог) виден одной строкой с путём и причиной и
         * записью `R2D_FS_REMOVE_FAILED` в `$.debug.errors()` (отчёт C5).
         */
        remove(path) {
            const ok = engine.fs.remove(path);
            // Причину движок заполняет ТОЛЬКО для настоящего отказа: у
            // отсутствующего файла она пуста, и мы молчим.
            if (!ok && lastFsError()) reportRemoveFailure($, path);
            return ok;
        },

        /** Абсолютный путь к чему угодно внутри каталога игры — для логов. */
        basePath() { return engine.basePath || ''; },

        /** Системный каталог Documents/«Документы» текущего пользователя. */
        documentsPath() { return engine.fs.documentsPath(); },

        /**
         * Системное окно выбора папки. Promise → абсолютный путь или null
         * (пользователь отменил). opts: { title, path } — path: где открыть.
         * Отказ открыть окно — reject с кодом R2D_FS_DIALOG_FAILED.
         *
         *   const dir = await $.fs.pickFolder({ title: 'Папка проекта' });
         */
        pickFolder(opts) { return openDialog($, 'folder', '$.fs.pickFolder', opts); },

        /**
         * Системное окно выбора файла. Promise → путь, массив путей при
         * many: true, или null при отмене. opts: { title, path, many,
         * filters: [{ name: 'Картинки', ext: 'png;jpg' }] }.
         */
        pickFile(opts) { return openDialog($, 'open', '$.fs.pickFile', opts); },

        /**
         * Системное окно «Сохранить как». Promise → выбранный путь или null.
         * Сам файл не пишется: запишите его через $.fs.write. opts — как у pickFile.
         */
        saveFile(opts) { return openDialog($, 'save', '$.fs.saveFile', opts); },
    };

    // --- Файл настроек: схема, backup и восстановление ---------------------
    //
    // Протокол тот же, что у слотов $.save: временный файл → проверка
    // прочитанным → backup последней корректной версии → перезапись →
    // проверка. Atomic replace на этом backend недоступен: в биндингах нет
    // rename (только readText/write/exists/remove/list), поэтому замена не
    // атомарна, а защита — проверка записи и копия .bak.
    const BAK = '.bak';
    const TMP = '.tmp';

    function readText(path) {
        const text = engine.fs.readText(path);
        return text === undefined ? null : text;
    }

    function settingsFile(path) {
        const text = readText(path);
        if (text === null) return { text: null, doc: null, error: null };
        let doc = null;
        try { doc = JSON.parse(text); }
        catch (e) { return { text, doc: null, error: 'битый JSON: ' + (e && e.message ? e.message : e) }; }
        if (!plainObject(doc)) {
            return { text, doc: null, error: 'в файле настроек ожидался объект JSON' };
        }
        return { text, doc, error: null };
    }

    function reportStore(where, message, opts) {
        const o = opts || {};
        if ($ && $.debug && typeof $.debug.reportError === 'function') {
            $.debug.reportError(where, message, {
                code: o.code || null, subsystem: 'store', recoverable: true,
                assetPath: o.path === undefined ? null : o.path,
            });
            return message;
        }
        if (ctx.reportError) { ctx.reportError(where, message); return message; }
        ctx.log('$: ' + message);
        return message;
    }

    /** Запомнить структуру отказа (для stats()/lastFailure()) без дубля в лог. */
    function recordFailure(out) {
        state.last_failure = {
            ok: false, stage: out.stage, code: out.code, message: out.message,
            path: out.path, schema: out.schema, current: out.current,
            backup: out.backup, recovered: out.recovered, file: out.file || 'main',
        };
        return out;
    }

    function storeFailure(out, where) {
        recordFailure(out);
        reportStore(where, out.message, { code: out.code, path: out.path });
        return out;
    }

    /**
     * Чтение настроек: версия/схема, backup при повреждении, восстановление
     * при документе из будущего. Настройки в памяти при отказе НЕ сбрасываются.
     */
    function loadSettings(target) {
        const out = {
            ok: false, stage: 'read', path: target, code: null, message: null,
            backup: false, recovered: false, schema: null,
            current: currentStoreSchema(), file: 'main',
        };
        const main = settingsFile(target);
        let doc = main.doc;
        if (doc === null) {
            const bak = settingsFile(target + BAK);
            if (bak.doc !== null) {
                out.backup = true;
                out.recovered = true;
                out.file = 'backup';
                out.message = main.text === null
                    ? `файла "${target}" нет — взят backup ${target}${BAK}`
                    : `файл "${target}" повреждён (${main.error}) — взят backup`;
                state.recovered++;
                doc = bak.doc;
            } else if (main.text === null) {
                // Не «ещё не сохраняли» — это не отказ и не повод чистить данные.
                out.stage = 'missing';
                out.message = `файл "${target}" не найден`;
                return out;
            } else {
                out.stage = 'read';
                out.code = 'R2D_STORE_READ_FAILED';
                out.message = `не удалось прочитать настройки "${target}": ${main.error}`;
                return storeFailure(out, '$.store.load');
            }
        }
        let applied = applySchemaMigrations(doc, state.schema);
        // Схема из будущего — не сбрасываем настройки, а пробуем backup:
        // он мог быть снят нашей версией и читается нашей схемой.
        if (!applied.ok && applied.code === SAVE_SCHEMA_FUTURE && out.file !== 'backup') {
            const bak = settingsFile(target + BAK);
            if (bak.doc !== null) {
                const retry = applySchemaMigrations(bak.doc, state.schema);
                if (retry.ok) {
                    out.backup = true;
                    out.recovered = true;
                    out.file = 'backup';
                    out.message = `настройки "${target}" записаны схемой ${applied.schema} `
                        + `(поддерживается до ${applied.current}) — взят backup`;
                    state.recovered++;
                    applied = retry;
                }
            }
        }
        if (!applied.ok) {
            out.stage = applied.stage;
            out.code = applied.code;
            out.message = applied.message;
            out.schema = applied.schema;
            return storeFailure(out, '$.store.load');
        }
        const data = plainObject(applied.data.data) ? applied.data.data : applied.data;
        state.data.clear();
        for (const key of Object.keys(data)) state.data.set(key, data[key]);
        state.dirty = false;
        if (applied.applied.length) state.schema_migrations++;
        state.loads++;
        state.last_failure = null;
        out.ok = true;
        out.stage = 'commit';
        out.schema = applied.schema;
        if (out.message) ctx.log('$.store.load: ' + out.message);
        return out;
    }

    /** Запись настроек по протоколу: temp → verify → backup → replace → verify. */
    function saveSettings(target) {
        const out = {
            ok: false, stage: 'write', path: target, code: null, message: null,
            backup: false, temp: false, atomic: false,
            schema: currentStoreSchema(), current: currentStoreSchema(), file: 'main',
        };
        // 0. Файл будущей схемы не затираем — как слот «из будущего».
        const existing = settingsFile(target);
        const existing_schema = existing.doc ? schemaOf(existing.doc) : null;
        if (existing_schema !== null && existing_schema > currentStoreSchema()) {
            out.stage = 'schema';
            out.code = SAVE_SCHEMA_FUTURE;
            out.schema = existing_schema;
            out.message = `настройки "${target}" записаны схемой ${existing_schema} `
                + `(поддерживается до ${currentStoreSchema()}) — не перезаписываю`;
            return storeFailure(out, '$.store.save');
        }
        const payload = { version: 1, saved_frame: engine.frame, data: Object.fromEntries(state.data) };
        if (state.schema) payload.schema = state.schema.version;
        const text = JSON.stringify(payload, null, 2);

        // 1. Временный файл — только когда атомарного биндинга нет. С ним
        // temp-файл не нужен: engine.fs.writeAtomic сам пишет temp рядом и
        // делает rename. Заодно отказ называет ЦЕЛЕВОЙ путь, а не внутренний
        // ".tmp" (игра и диагностика не должны видеть служебное имя).
        const has_atomic = !!(engine.fs && typeof engine.fs.writeAtomic === 'function');
        out.atomic = has_atomic;
        const tmp = target + TMP;
        if (!has_atomic) {
            if (!fs.write(tmp, text)) {
                // Причину уже назвал $.fs.write (R2D_FS_WRITE_FAILED) — не дублируем.
                out.stage = 'temp';
                out.code = 'R2D_STORE_WRITE_FAILED';
                out.message = lastFsError() || `не удалось записать временный файл "${tmp}"`;
                return recordFailure(out);
            }
            if (readText(tmp) !== text) {
                out.stage = 'verify-temp';
                out.code = 'R2D_STORE_VERIFY_FAILED';
                out.message = `временный файл "${tmp}" не совпал с записанным`;
                return storeFailure(out, '$.store.save');
            }
            out.temp = true;
        }

        // 2. Backup последней корректной версии — до перезаписи основной.
        if (existing.doc !== null && existing.text !== null) {
            if (fs.write(target + BAK, existing.text)) {
                out.backup = true;
                state.backups++;
            }
        }

        // 3. Замена целевого файла: атомарно, если сборка знает
        // engine.fs.writeAtomic, иначе обычной записью (протокол temp+backup).
        const replaced = has_atomic ? fs.writeAtomic(target, text) : fs.write(target, text);
        if (!replaced) {
            out.stage = 'replace';
            out.code = 'R2D_STORE_WRITE_FAILED';
            out.message = lastFsError() || `не удалось записать "${target}" — файл оставлен прежним`;
            return recordFailure(out);
        }
        if (readText(target) !== text) {
            out.stage = 'verify';
            out.code = 'R2D_STORE_VERIFY_FAILED';
            const restored = out.backup && fs.writeAtomic(target, existing.text);
            out.message = `файл "${target}" не прошёл проверку после записи`
                + (restored ? ' — восстановлен backup' : '');
            return storeFailure(out, '$.store.save');
        }
        out.ok = true;
        out.stage = 'commit';
        state.saves++;
        state.dirty = false;
        state.last_failure = null;
        return out;
    }

    const store = {
        /** В каком файле хранить (по умолчанию save.json). */
        file(path) {
            if (path === undefined) return state.file;
            state.file = path;
            return store;
        },

        set(key, value) { state.data.set(key, value); state.dirty = true; return store; },
        get(key, fallback) { return state.data.has(key) ? state.data.get(key) : fallback; },
        has(key) { return state.data.has(key); },
        remove(key) { state.data.delete(key); state.dirty = true; return store; },
        clear() { state.data.clear(); state.dirty = true; return store; },
        keys() { return [...state.data.keys()]; },
        all() { return Object.fromEntries(state.data); },
        setAll(obj) { for (const k of Object.keys(obj || {})) state.data.set(k, obj[k]); state.dirty = true; return store; },

        /**
         * Записать на диск. Возвращает bool (совместимость); структуру отказа
         * отдаёт saveResult()/lastFailure().
         */
        save(path) { return saveSettings(path || state.file).ok; },

        /**
         * Прочитать с диска. Возвращает true, если файл прочитан. При
         * повреждении берётся .bak; при схеме из будущего — отказ и
         * НЕтронутые настройки в памяти. Структуру отдаёт loadResult().
         */
        load(path) { return loadSettings(path || state.file).ok; },

        /** Запись с отчётом: `{ ok, stage, code, message, path, backup, temp, schema }`. */
        saveResult(path) { return saveSettings(path || state.file); },

        /** Чтение с отчётом: `{ ok, stage, code, message, path, backup, recovered, schema }`. */
        loadResult(path) { return loadSettings(path || state.file); },

        /** Структура последнего отказа (или null). */
        lastFailure() { return state.last_failure; },

        /**
         * Игровая схема файла настроек — тот же контракт, что $.save.schema:
         *
         *   $.store.schema({
         *       version: 2,
         *       migrate: { 1: (doc) => { doc.data.volume = 0.7; return doc; } },
         *       defaults: { data: { volume: 0.7, lang: 'ru' } },
         *       validate: (doc) => !!doc.data,
         *   });
         *
         * Схема пишется в файл целым полем `schema`; у файлов без него она —
         * legacy 0. Без аргумента — что объявлено; `schema(null)` выключает.
         */
        schema(cfg) {
            if (cfg === undefined) {
                const c = state.schema;
                return {
                    version: c ? c.version : SAVE_SCHEMA_LEGACY,
                    legacy: SAVE_SCHEMA_LEGACY,
                    migrations: c ? Object.keys(c.migrate).map(Number).sort((a, b) => a - b) : [],
                    defaults: !!(c && c.defaults !== null && c.defaults !== undefined),
                    validate: !!(c && typeof c.validate === 'function'),
                    errors: c ? c.errors.slice() : [],
                };
            }
            const normalized = normalizeSchemaConfig(cfg, (message) => {
                ctx.log('$.store.schema: ' + message);
            });
            state.schema = normalized;
            if (normalized) {
                for (const message of normalized.errors) ctx.log('$.store.schema: ' + message);
                state.last_failure = null;
            }
            return store;
        },

        /** Сводка: файл, схема и счётчики протокола записи/чтения. */
        stats() {
            return {
                file: state.file,
                schema: currentStoreSchema(),
                schema_migrations: state.schema_migrations,
                loads: state.loads,
                saves: state.saves,
                backups: state.backups,
                recovered: state.recovered,
                dirty: state.dirty,
                last_failure: state.last_failure,
            };
        },

        /** Автосохранение каждые ms игрового времени. Возвращает id для cancel. */
        autoSave(ms) {
            if (state.auto_save_id) ctx.time.cancel(state.auto_save_id);
            state.auto_save_id = ctx.time.every(ms || 30000, () => {
                if (state.dirty) store.save();
            });
            return state.auto_save_id;
        },

        stopAutoSave() {
            if (state.auto_save_id) ctx.time.cancel(state.auto_save_id);
            state.auto_save_id = 0;
            return store;
        },
    };

    ctx.fs = fs;
    ctx.store = store;
    return { fs, store };
}
