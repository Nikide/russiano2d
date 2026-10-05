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

import { ctx } from './core.js';

const state = {
    data: new Map(),
    file: 'save.json',
    auto_save_id: 0,
    dirty: false,
};

export function installStore($) {
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
            if (!ok) ctx.log(`$: не удалось записать "${path}"`);
            return ok;
        },

        writeJSON(path, value) { return fs.write(path, JSON.stringify(value, null, 2)); },

        exists(path) { return engine.fs.exists(path); },

        /** Список файлов в каталоге (пути, отсортированы). */
        list(dir) { return engine.fs.list(dir); },

        remove(path) { return engine.fs.remove(path); },

        /** Абсолютный путь к чему угодно внутри каталога игры — для логов. */
        basePath() { return engine.basePath || ''; },
    };

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

        /** Записать на диск. */
        save(path) {
            const target = path || state.file;
            const payload = { version: 1, saved_frame: engine.frame, data: Object.fromEntries(state.data) };
            const ok = fs.writeJSON(target, payload);
            if (ok) state.dirty = false;
            return ok;
        },

        /** Прочитать с диска. Возвращает true, если файл был. */
        load(path) {
            const target = path || state.file;
            const json = fs.readJSON(target, null);
            if (!json || typeof json !== 'object') return false;
            state.data.clear();
            const data = json.data || json;   // поддержка «сырого» JSON
            for (const k of Object.keys(data)) state.data.set(k, data[k]);
            state.dirty = false;
            return true;
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
