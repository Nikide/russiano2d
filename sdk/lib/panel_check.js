// ===========================================================================
// §29: общая панель проверки для студий SDK.
//
// Зачем отдельный модуль. Панель не имеет права на свою логику проверок:
// «Проверить» в любой студии вызывает ТОТ ЖЕ нативный backend, что CLI
// (`app.backend(['validate', path])`), и показывает ровно его структурные
// диагностики (code/severity/location/message) — без подмены и без второго
// набора defaults. Здесь живёт только то, что общее у всех панелей:
//
//   * вызов валидации по списку путей и сводка (errors/warnings/codes);
//   * preview-ссылка на runtime: путь файла — и есть идентичность, поэтому
//     `lastPreview` всегда равен `lastValidated` (те же файлы, без базы проекта);
//   * отчёт (import report) по данным инструмента — числа и предупреждения,
//     которые человек читает рядом с диагностиками;
//   * снимок для агента: какие пути проверялись и что показал preview.
//
// Отчёт — чистые данные: считаются из документа и диагностик, ничего не
// проверяют заново (валидатор один — нативный).
// ===========================================================================

import { summarize } from '../../editor/lib/shared/model.js';

const ERROR = 'error';

/** Коды диагностик в порядке появления (для сравнения GUI ↔ CLI). */
export function codesOf(list) {
    return (list || []).map((d) => d && d.code).filter(Boolean);
}

/** Сводка по диагностикам: числа, коды, источники. */
export function summaryOf(list) {
    const sum = summarize(list || []);
    return {
        errors: sum.errors, warnings: sum.warnings, infos: sum.infos,
        codes: codesOf(list),
        assets: Array.from(new Set((list || []).map((d) => d.asset).filter(Boolean))),
    };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function keys(obj) { return isObj(obj) ? Object.keys(obj) : []; }
function arr(v) { return Array.isArray(v) ? v : []; }

/**
 * Отчёт по данным инструмента. Ключ — id формата (`kind.ID`) или id студии.
 * Числа и короткие предупреждения; ничего не «валидирует» повторно.
 */
export function reportForKind(id, doc, diagnostics, app) {
    const root = isObj(doc) ? doc : {};
    const codes = codesOf(diagnostics);
    const notes = [];
    if (id === 'tilemap') {
        const layers = arr(root.layers);
        const byRole = {};
        let tiles = 0;
        let occlusion = 0;
        for (const layer of layers) {
            const role = String(layer.role || layer.kind || layer.type || 'unknown');
            byRole[role] = (byRole[role] || 0) + 1;
            const rows = arr(layer.data);
            tiles += rows.reduce((n, row) => n + arr(row).length, 0);
            if (layer.occlusion || layer.occluder || role === 'occlusion') occlusion++;
        }
        const width = arr(layers[0] && layers[0].data)[0];
        const size = { w: arr(width).length, h: arr(layers[0] && layers[0].data).length };
        const budget = Number(root.chunk || root.chunk_size || 32) || 32;
        const connections = arr(root.connections || root.rooms || root.doors);
        if (!occlusion) notes.push('нет occlusion-слоя: свет не будет перекрываться тайлами');
        if (!size.w || !size.h) notes.push('у слоя нет данных (data): геометрия не проверена');
        return {
            layers: layers.length, byRole, tiles, occlusionLayers: occlusion,
            grid: size, tile: root.tile === undefined ? null : root.tile,
            chunkBudget: budget,
            chunks: size.w && size.h ? Math.ceil(size.w / budget) * Math.ceil(size.h / budget) : 0,
            connections: connections.length,
            invalidGeometry: codes.filter((c) => c.indexOf('SDK_TILEMAP') === 0 || c.indexOf('SDK_GEOMETRY') === 0).length,
            notes,
        };
    }
    if (id === 'particles') {
        const space = root.space || root.coords || 'world';
        const trails = arr(root.trails).length || (root.trail ? 1 : 0);
        const budget = {
            amount: root.amount === undefined ? null : root.amount,
            max: root.max === undefined ? null : root.max,
            rate: root.rate === undefined ? null : root.rate,
        };
        if (space !== 'world' && space !== 'local') notes.push('space не world/local: clock-политика частиц неоднозначна');
        if (root.seed === undefined) notes.push('нет seed: детерминированный replay не воспроизводится');
        return {
            space, clock: root.clock || 'simulation', trails,
            budget, seed: root.seed === undefined ? null : root.seed,
            oneShot: root.one_shot === true,
            lifetime: root.lifetime === undefined ? null : root.lifetime,
            notes,
        };
    }
    if (id === 'collision') {
        const shapes = arr(root.shapes);
        const roles = {};
        const masks = {};
        let oneWay = 0;
        let footprint = 0;
        for (const sh of shapes) {
            const role = String((sh && (sh.role || sh.name)) || 'unknown');
            roles[role] = (roles[role] || 0) + 1;
            const mask = sh && (sh.mask || sh.layer || sh.category);
            if (mask !== undefined && mask !== null) masks[String(mask)] = (masks[String(mask)] || 0) + 1;
            if (sh && (sh.one_way === true || sh.oneWay === true)) oneWay++;
            footprint += Math.abs(Number(sh && (sh.w || sh.width)) || 0) * Math.abs(Number(sh && (sh.h || sh.height)) || 0);
        }
        if (!shapes.length) notes.push('фигур нет: footprint/support проверять не на чем');
        if (!Object.keys(masks).length) notes.push('у фигур нет mask/layer: слои коллизий не заданы');
        return {
            shapes: shapes.length, roles, masks, oneWay,
            footprintArea: footprint,
            support: shapes.length ? 'по низу фигуры' : 'нет',
            notes,
        };
    }
    if (id === 'layers') {
        const layers = arr(root.layers);
        let sprites = 0;
        let parallax = 0;
        for (const l of layers) {
            sprites += arr(l && l.sprites).length;
            if (l && (l.parallax !== undefined || l.factor !== undefined)) parallax++;
        }
        return { layers: layers.length, sprites, parallaxLayers: parallax,
                 zOrder: layers.map((l) => (l && (l.depth !== undefined ? l.depth : l.z)) || 0), notes };
    }
    if (id === 'fonts') {
        const fonts = arr(root.fonts);
        const styles = keys(root.styles);
        if (!fonts.length) notes.push('шрифтов нет: тексты используют встроенный');
        return { fonts: fonts.length, styles: styles.length, families: fonts.map((f) => (f && (f.family || f.src)) || '—').slice(0, 8), notes };
    }
    if (id === 'audio') {
        const buses = keys(root.buses);
        const sounds = isObj(root.sounds) ? root.sounds : {};
        const routes = {};
        let stems = 0;
        let voices = 0;
        const missing = [];
        for (const name of Object.keys(sounds)) {
            const snd = isObj(sounds[name]) ? sounds[name] : {};
            const bus = String(snd.bus || snd.route || 'sfx');
            routes[bus] = (routes[bus] || 0) + 1;
            if (snd.stem || snd.transport || snd.layer) stems++;
            if (snd.voice || snd.voices || snd.limit) voices++;
            const src = snd.src || snd.path || snd.file;
            if (src && app && app.$ && app.$.fs && app.$.fs.exists && !app.$.fs.exists(src)) missing.push(String(src));
        }
        if (!buses.length) notes.push('шин нет: маршрутизация пойдёт в sfx по умолчанию');
        if (missing.length) notes.push('нет файлов: ' + missing.slice(0, 3).join(', '));
        return { buses: buses.length, sounds: Object.keys(sounds).length, routes, stems, voices, missing, notes };
    }
    if (id === 'input') {
        const actions = isObj(root.actions) ? root.actions : {};
        const contexts = isObj(root.contexts) ? keys(root.contexts) : [];
        const used = {};
        const conflicts = [];
        for (const name of Object.keys(actions)) {
            for (const key of arr(actions[name])) {
                const k = String(key);
                if (used[k] && used[k] !== name) conflicts.push(k + ': ' + used[k] + ' ↔ ' + name);
                else used[k] = name;
            }
        }
        if (!contexts.length) notes.push('контекстов нет: capture и приоритет ввода не описаны');
        if (conflicts.length) notes.push('конфликты клавиш: ' + conflicts.slice(0, 3).join('; '));
        return {
            actions: Object.keys(actions).length, keys: Object.keys(used).length,
            contexts, conflicts, gamepad: root.gamepad === undefined ? null : root.gamepad,
            disconnectTests: arr(root.disconnect_tests || root.gamepad_tests).length,
            notes,
        };
    }
    return { kind: id, notes };
}

/**
 * Панель проверки одной студии.
 *
 * opts: { label, paths(), primary(), report() }
 *   paths()   — что проверять (обычно текущий файл и его зависимости);
 *   primary() — путь, который считается «тем самым» файлом для preview;
 *   report()  — данные отчёта (import report) или null.
 *
 * Возвращает объект с `validate()`, `preview()`, `report()` и `snapshot()`.
 * Проверка всегда идёт через `app.backend`, поэтому коды совпадают с CLI.
 */
export function createPanel(app, opts) {
    const o = opts || {};
    const st = {
        label: o.label || 'инструмент',
        validatedPath: null,
        previewPath: null,
        diagnostics: [],
        summary: summaryOf([]),
        report: null,
        checks: 0,
        lastError: null,
    };

    async function validate(pathsOverride, labelOverride) {
        const list = (pathsOverride && pathsOverride.length ? pathsOverride : (o.paths ? o.paths() : [])).filter(Boolean);
        if (!list.length) {
            st.lastError = 'нет файла для проверки';
            return { ok: false, diagnostics: [], codes: [], path: null, report: st.report };
        }
        let diags = [];
        let ok = true;
        for (const path of list) {
            const r = await app.backend(['validate', path], (labelOverride || 'проверяю ') + path.split('/').pop());
            if (r.json) {
                diags = diags.concat(r.json.diagnostics || []);
                if (!r.json.ok) ok = false;
            } else {
                ok = false;
            }
        }
        st.checks++;
        st.validatedPath = o.primary ? o.primary() : list[0];
        st.diagnostics = diags;
        st.summary = summaryOf(diags);
        st.lastError = null;
        st.report = typeof o.report === 'function' ? o.report() : null;
        app.setDiagnostics(st.label + ' · ' + (st.validatedPath || ''), diags);
        app.setStatus(ok ? 'проверка: ошибок 0' : ('проверка: кодов ' + st.summary.codes.length), ok ? '' : 'fail');
        return { ok, diagnostics: diags, codes: st.summary.codes, path: st.validatedPath, report: st.report };
    }

    /**
     * Preview-ссылка на runtime. Файл не копируется и не ищется в базе проекта:
     * тем же путём его читает и игра, поэтому `previewPath === validatedPath`.
     * `opts.run` позволяет студии дополнительно запустить проект движком.
     */
    function preview() {
        const path = o.primary ? o.primary() : null;
        if (!path) {
            st.lastError = 'нет файла для preview';
            return { ok: false, path: null };
        }
        st.previewPath = path;
        if (o.onPreview) {
            try { o.onPreview(path, st); } catch (e) { st.lastError = e && e.message ? e.message : String(e); }
        }
        app.state.lastPreview = path;
        app.setStatus('preview: ' + path.split('/').pop() + (st.validatedPath && st.validatedPath === path ? ' (тот же файл, что проверялся)' : ''), '');
        return { ok: st.lastError === null, path };
    }

    /** Принять диагностики, полученные студией своим путём (draft/save). */
    function absorb(diagnostics, path) {
        st.diagnostics = diagnostics || [];
        st.summary = summaryOf(st.diagnostics);
        if (path) st.validatedPath = path;
        st.report = typeof o.report === 'function' ? o.report() : null;
        return st.summary;
    }

    function report() {
        st.report = typeof o.report === 'function' ? o.report() : null;
        return st.report;
    }

    function snapshot() {
        const sum = st.summary;
        return {
            label: st.label,
            validatedPath: st.validatedPath,
            previewPath: st.previewPath,
            previewMatchesValidated: !!(st.validatedPath && st.validatedPath === st.previewPath),
            codes: sum.codes,
            errors: sum.errors,
            warnings: sum.warnings,
            checks: st.checks,
            lastError: st.lastError,
            report: st.report,
        };
    }

    return { state: st, validate, preview, absorb, report, snapshot, summaryOf };
}
