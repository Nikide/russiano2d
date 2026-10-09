// ===========================================================================
// Сессия редактирования файла студии данных (tilemap, particles, collision,
// layers, fonts, audio, input). Одна сессия на файл: переключение студий не
// теряет правки и историю. Чтение и запись — обычные файлы через `$.fs`;
// «живая» проверка — чистая функция формата, «Проверить» — нативный
// `r2d-sdk validate` (один код для GUI, CLI и агента).
// ===========================================================================

import { createHistory } from './history.js';
import { canonicalJson, isObj } from './kit.js';
import { joinPath, dirOf, normalizeDir } from './model.js';

function tag(list, asset) {
    return list.map((d) => Object.assign({}, d, { asset: d.asset || asset }));
}

export function openDataSession(app, kind, abs) {
    const $ = app.$;
    const path = normalizeDir(abs);
    app.dataSessions = app.dataSessions || new Map();
    if (app.dataSessions.has(path)) return app.dataSessions.get(path);

    const json = $.fs.readJSON(path, null);
    if (!isObj(json)) throw new Error('не удалось прочитать ' + path + ' (нет файла, некорректный JSON или корень не объект)');
    return register(app, kind, path, json);
}

function register(app, kind, path, doc) {
    const $ = app.$;
    app.dataSessions = app.dataSessions || new Map();
    const session = {
        path,
        kind,
        doc,
        history: createHistory(doc),
        diagnostics: [],
        native: null,

        text() { return canonicalJson(doc); },

        /** Живая проверка по правилам формата (те же, что в нативном валидаторе). */
        live() {
            session.diagnostics = tag(kind.validate(doc), path);
            return session.diagnostics;
        },

        async save() {
            if (!$.fs.write(path, session.text())) {
                session.native = [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: path, location: null, message: 'Не удалось записать ' + path, details: null }];
                return { ok: false, diagnostics: session.native };
            }
            session.history.markSaved();
            return session.validateFile();
        },

        async validateFile() {
            const r = await app.backend(['validate', path], 'проверяю ' + path.split('/').pop());
            session.native = r.json && r.json.diagnostics ? r.json.diagnostics : [];
            return { ok: !!(r.json && r.json.ok), diagnostics: session.native };
        },

        /** Проверка несохранённого состояния: черновик рядом с файлом, тем же валидатором, и удаление. */
        async validateDraft() {
            const tmp = joinPath(dirOf(path), '.r2d-sdk-draft' + kind.SUFFIX);
            if (!$.fs.write(tmp, session.text())) {
                session.native = [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: tmp, location: null, message: 'Не удалось записать черновик ' + tmp, details: null }];
                return { ok: false, diagnostics: session.native };
            }
            const r = await app.backend(['validate', tmp], 'проверяю черновик');
            $.fs.remove(tmp);
            session.native = (r.json && r.json.diagnostics ? r.json.diagnostics : []).map((d) =>
                Object.assign({}, d, { asset: d.asset === tmp ? path : d.asset }));
            return { ok: !!(r.json && r.json.ok), diagnostics: session.native };
        },

        close() { app.dataSessions.delete(path); },
    };
    session.live();
    app.dataSessions.set(path, session);
    return session;
}

/**
 * Создать новый файл формата и открыть сессию. Существующий файл не
 * перезаписывается никогда: возвращается ошибка SDK_FILE_EXISTS.
 */
export function createDataFile(app, kind, abs, opts) {
    const $ = app.$;
    const path = normalizeDir(abs);
    if (!path.toLowerCase().endsWith(kind.SUFFIX)) {
        return { ok: false, error: { code: 'SDK_FILE_SUFFIX', severity: 'error', asset: path, location: null, message: 'Имя файла должно оканчиваться на ' + kind.SUFFIX, details: null } };
    }
    if ($.fs.exists(path)) {
        return { ok: false, error: { code: 'SDK_FILE_EXISTS', severity: 'error', asset: path, location: null, message: 'Файл уже существует: SDK ничего не перезаписывает — откройте его или выберите другое имя', details: null } };
    }
    const doc = kind.create(opts || {});
    if (!$.fs.write(path, canonicalJson(doc))) {
        return { ok: false, error: { code: 'SDK_WRITE_FAILED', severity: 'error', asset: path, location: null, message: 'Не удалось записать ' + path, details: null } };
    }
    return { ok: true, session: register(app, kind, path, JSON.parse(JSON.stringify(doc))) };
}
