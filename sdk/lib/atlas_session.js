// ===========================================================================
// Сессия редактирования атласа: общая для Sprite Studio и Animation Studio.
//
// Одна сессия на файл: переключение между студиями не теряет несохранённые
// правки и историю undo/redo. Чтение и запись — обычные файлы через `$.fs`;
// проверка — нативный `r2d-sdk validate` (один код для GUI, CLI и агента);
// просмотр — настоящий `$.atlas`, тот самый загрузчик, которым пользуется игра.
// ===========================================================================

import { parseAtlasDoc, serializeAtlas, createHistory, newAtlasDoc } from './atlas_model.js';
import { joinPath, dirOf, normalizeDir } from './model.js';

let reloadCounter = 0;

function resolveImage(jsonAbs, image) {
    if (!image) return '';
    if (/^([A-Za-z]:[\\/]|\/)/.test(image)) return image;
    const dir = dirOf(jsonAbs);
    // «../» в пути картинки сворачиваем: движок и stb открывают и так, но
    // нормализованный путь читаемее в статусе и диагностике.
    const parts = (dir ? dir + '/' + image : image).split('/');
    const out = [];
    for (const part of parts) {
        if (part === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop();
        else if (part !== '.') out.push(part);
    }
    return out.join('/');
}

/**
 * Открыть (или вернуть уже открытую) сессию для `*.atlas.json`.
 * Бросает Error с понятным текстом, если файл не читается или не атлас.
 */
export function openAtlasSession(app, jsonAbs) {
    const $ = app.$;
    const path = normalizeDir(jsonAbs);
    app.atlasSessions = app.atlasSessions || new Map();
    if (app.atlasSessions.has(path)) return app.atlasSessions.get(path);

    const json = $.fs.readJSON(path, null);
    if (!json) throw new Error('не удалось прочитать ' + path + ' (нет файла или некорректный JSON)');
    const doc = parseAtlasDoc(json);
    return registerSession(app, path, doc);
}

function registerSession(app, path, doc) {
    const $ = app.$;
    const session = {
        path,
        doc,
        history: createHistory(doc),
        imageAbs: resolveImage(path, doc.image),
        tex: null,
        sheetName: null,
        diagnostics: [],
        lastSavedText: null,

        /** Размер картинки через рантайм ($.gfx.textureSize грузит текстуру, как игра). */
        measure() {
            session.imageAbs = resolveImage(path, doc.image);
            const size = session.imageAbs ? $.gfx.textureSize(session.imageAbs) : [0, 0];
            session.tex = size && size[0] > 0 ? { w: size[0], h: size[1] } : null;
            if (session.tex && (!doc.size || doc.size.w !== session.tex.w || doc.size.h !== session.tex.h)) {
                doc.size = { w: session.tex.w, h: session.tex.h };
            }
            return session.tex;
        },

        text() { return serializeAtlas(doc); },

        /** Записать файл. Возвращает { ok, diagnostics } — проверка уже сохранённого файла нативным бэкендом. */
        async save() {
            const text = session.text();
            if (!$.fs.write(path, text)) {
                const d = [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: path, location: null, message: 'Не удалось записать ' + path, details: null }];
                session.diagnostics = d;
                return { ok: false, diagnostics: d };
            }
            session.lastSavedText = text;
            session.history.markSaved();
            const result = await session.validateFile();
            session.reloadSheet();
            return result;
        },

        /** Проверка файла на диске бэкендом r2d-sdk. */
        async validateFile() {
            const r = await app.backend(['validate', path], 'проверяю ' + path.split('/').pop());
            const diags = r.json && r.json.diagnostics ? r.json.diagnostics : session.diagnostics;
            session.diagnostics = diags;
            return { ok: !!(r.json && r.json.ok), diagnostics: diags };
        },

        /**
         * Проверка текущего (возможно несохранённого) состояния: пишем временный
         * файл рядом, проверяем тем же валидатором и удаляем.
         */
        async validateDraft() {
            const tmp = joinPath(dirOf(path), '.r2d-sdk-draft.atlas.json');
            if (!$.fs.write(tmp, session.text())) {
                const d = [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: tmp, location: null, message: 'Не удалось записать черновик ' + tmp, details: null }];
                session.diagnostics = d;
                return { ok: false, diagnostics: d };
            }
            const r = await app.backend(['validate', tmp], 'проверяю черновик');
            $.fs.remove(tmp);
            const diags = (r.json && r.json.diagnostics ? r.json.diagnostics : []).map((d) =>
                Object.assign({}, d, { asset: d.asset === tmp ? path : d.asset }));
            session.diagnostics = diags;
            return { ok: !!(r.json && r.json.ok), diagnostics: diags };
        },

        /** Перечитать атлас настоящим `$.atlas`, как это делает игра при старте или hot reload. */
        reloadSheet() {
            if (session.sheetName) $.atlas.unload(session.sheetName);
            session.sheetName = 'sdk-' + (++reloadCounter);
            session.sheet = $.atlas.load(session.sheetName, path);
            return session.sheet;
        },

        /**
         * Лист для просмотра текущего (даже несохранённого) состояния: тот же
         * сериализованный текст разбирает настоящий `$.atlas` — так студия видит
         * ровно то, что увидит игра, если сохранить сейчас.
         */
        previewSheet() {
            if (session.sheetName) $.atlas.unload(session.sheetName);
            session.sheetName = 'sdk-' + (++reloadCounter);
            session.sheet = $.atlas.load(session.sheetName, { data: JSON.parse(session.text()), path });
            return session.sheet;
        },

        sheetSprites(tag) {
            return session.sheet ? session.sheet.tagSprites(tag) : [];
        },

        close() {
            if (session.sheetName) $.atlas.unload(session.sheetName);
            app.atlasSessions.delete(path);
        },
    };
    session.measure();
    app.atlasSessions.set(path, session);
    return session;
}

/**
 * Создать атлас из картинки сеткой нативным `atlas-grid` и открыть сессию.
 * Одна реализация нарезки — в C, поэтому GUI и CLI дают одинаковый файл.
 */
export async function createAtlasFromImage(app, imageAbs, opts) {
    const base = imageAbs.split('/').pop().replace(/\.[^.]+$/, '');
    const out = opts.out || joinPath(dirOf(imageAbs), base + '.atlas.json');
    const args = ['atlas-grid', imageAbs, '--out', out, '--prefix', opts.prefix || base, '--duration', String(opts.duration || 100)];
    if (opts.cell) args.push('--cell', opts.cell);
    else args.push('--cols', String(opts.cols), '--rows', String(opts.rows));
    if (opts.tags) args.push('--tags', opts.tags);
    const r = await app.backend(args, 'нарезаю ' + base);
    if (!r.json || !r.json.ok) return { ok: false, diagnostics: r.json ? r.json.diagnostics : [], session: null };
    if (app.atlasSessions && app.atlasSessions.has(out)) app.atlasSessions.get(out).close();
    const session = openAtlasSession(app, out);
    return { ok: true, diagnostics: r.json.diagnostics || [], session };
}

/** Пустой атлас для картинки без кадров (рисуем кадры руками). */
export function blankSession(app, jsonAbs, image, size) {
    const doc = newAtlasDoc(image, size);
    return registerSession(app, normalizeDir(jsonAbs), doc);
}
