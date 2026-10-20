// ===========================================================================
// World Editor: сессия файла и нативный backend.
//
// Единственный путь правок — r2d world-edit (та же команда у GUI, CLI и
// агента): пишем текущую модель во временный вход, получаем канонический файл
// через --out и перечитываем его. Геометрия, convexity, clip, vertex и CSG
// живут только в native; JS не валидирует .re2dmap.
//
// Проверка/компиляция — world info/compile; preview — настоящий runtime
// $.re2dWorld.fromJSON из скомпилированного .re2dworld.
// ===========================================================================

import { createHistory } from '../history.js';
import { joinPath } from '../model.js';
import { createMap, clone, replaceContents, serialize } from './model.js';

function sectionForOp(op) {
    if (!op) return null;
    if (op.indexOf('brush.') === 0) return 'brushes';
    if (op.indexOf('entity.') === 0) return 'entities';
    if (op.indexOf('path.') === 0) return 'paths';
    if (op.indexOf('visgroup.') === 0) return 'visgroups';
    if (op.indexOf('face.') === 0) return 'brushes';
    if (op.indexOf('world.') === 0) return 'world';
    return null;
}

function normalizeDiagnostics(json, fallbackCode, fallbackMessage) {
    const out = [];
    const list = json && Array.isArray(json.diagnostics) ? json.diagnostics : [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        out.push({
            code: String(raw.code || fallbackCode || 'SDK_WORLD_EDIT'),
            severity: String(raw.severity || 'error'),
            asset: raw.asset || null,
            location: raw.location || null,
            message: String(raw.message || fallbackMessage || ''),
            details: raw.details || null,
        });
    }
    if (!out.length && json && json.ok !== true) {
        out.push({
            code: String((json && json.code) || fallbackCode || 'SDK_WORLD_EDIT'),
            severity: 'error',
            asset: null,
            location: null,
            message: String((json && (json.error || json.message)) || fallbackMessage || 'backend вернул ошибку'),
            details: null,
        });
    }
    return out;
}

function hasErrors(diagnostics) {
    return (diagnostics || []).some((d) => d.severity === 'error' || d.severity === 'fatal');
}

/** Мост не дал JSON: показываем структурную диагностику с хвостом вывода. */
function backendDiagnostic(res, code) {
    const raw = res && res.raw ? res.raw : null;
    const output = raw && raw.output ? String(raw.output).trim() : '';
    return {
        code: 'SDK_BACKEND_NO_JSON',
        severity: 'error',
        asset: null,
        location: null,
        message: (code ? code + ': ' : '') + 'бэкенд не вернул JSON' + (output ? ' — ' + output.slice(0, 240) : ''),
        details: raw ? { exitCode: raw.exitCode, output: output.slice(0, 400) } : null,
    };
}

let sessionCounter = 0;

export function createSession(app, opts) {
    const $ = app.$;
    const options = opts || {};
    const sessionId = ++sessionCounter;
    const state = {
        path: null,
        map: null,
        history: null,
        busy: false,
        diagnostics: [],
        report: null,
        stats: null,
        world: null,
        node: null,
        previewOut: null,
        seq: 0,
        log: [],
        lastResult: null,
        nativeAvailable: null,
        debugView: 'final',
        gpu: false,
        lighting: true,
    };
    let disposed = false;

    function base() {
        return $.fs.basePath() || '.';
    }

    function tempPath(tag, ext) {
        state.seq++;
        return joinPath(base(), 'build/.we-' + sessionId + '-' + tag + '-' + state.seq + (ext || '.re2dmap'));
    }

    function logLine(text) {
        state.log.push(String(text));
        if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
    }

    function setDiagnostics(list) {
        state.diagnostics = (list || []).map((d) => {
            if (!d.asset || !String(d.asset).includes('/.we-')) return d;
            return Object.assign({}, d, { asset: state.path });
        });
        return state.diagnostics;
    }

    function nativeUnavailable(json) {
        if (!json) return true;
        if (json.code === 'SDK_WORLD_EDIT_UNIMPLEMENTED') return true;
        return (json.diagnostics || []).some((d) => d.code === 'SDK_WORLD_EDIT_UNIMPLEMENTED');
    }

    function parseMapText(text, path) {
        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('корень не объект');
            return createMap(parsed);
        } catch (e) {
            setDiagnostics([{
                code: 'SDK_WORLD_PARSE', severity: 'error', asset: path || state.path, location: null,
                message: 'не удалось разобрать .re2dmap: ' + (e && e.message ? e.message : e), details: null,
            }]);
            return null;
        }
    }

    function preserveEditorSections(next, previous) {
        for (const section of ['paths', 'visgroups']) {
            if (!Array.isArray(next[section]) && previous && Array.isArray(previous[section])) {
                next[section] = clone(previous[section]);
            }
        }
        return next;
    }

    async function open(path) {
        disposePreview();
        state.path = path || joinPath(base(), 'build/new-world.re2dmap');
        state.diagnostics = [];
        state.report = null;
        state.stats = null;
        state.log = [];
        if (path) {
            const text = $.fs.readText(path);
            if (text === null || text === undefined) {
                state.map = createMap(undefined);
                state.history = createHistory(state.map);
                setDiagnostics([{
                    code: 'SDK_WORLD_READ', severity: 'error', asset: path, location: null,
                    message: 'не удалось прочитать ' + path, details: null,
                }]);
                throw new Error('World Editor: не удалось прочитать ' + path);
            }
            const parsed = parseMapText(text, path);
            if (!parsed) throw new Error('World Editor: ' + (state.diagnostics[0] ? state.diagnostics[0].message : 'ошибка разбора'));
            state.map = parsed;
        } else {
            state.map = createMap(undefined);
        }
        state.history = createHistory(state.map);
        logLine('открыт ' + state.path);
        return state.map;
    }

    function newMap(name) {
        disposePreview();
        state.path = joinPath(base(), 'build/new-world.re2dmap');
        state.map = createMap({ name: name || 'Новая карта' });
        state.history = createHistory(state.map);
        state.diagnostics = [];
        state.report = null;
        state.stats = null;
        state.log = ['новая карта: ' + state.path];
        return state.map;
    }

    function idsFromResult(json, before, after) {
        const result = json && json.result;
        if (result && Array.isArray(result.ids)) return result.ids.map((v) => String(v));
        if (result && result.id !== undefined && result.id !== null) return [String(result.id)];
        const section = sectionForOp(json && json.op);
        if (section && section !== 'world' && after) {
            const oldList = Array.isArray(before && before[section]) ? before[section] : [];
            const newList = Array.isArray(after[section]) ? after[section] : [];
            const oldIds = new Set(oldList.map((v) => String(v && v.id)));
            const created = newList.map((v) => String(v && v.id)).filter((id) => !oldIds.has(id));
            if (created.length) return created;
        }
        return [];
    }

    /**
     * Одна нативная операция. options.noHistory — для составных логических
     * правок (bulk), где история пишется один раз в commitBulk.
     */
    async function apply(op, args, applyOptions) {
        const bulk = applyOptions && applyOptions.noHistory;
        if (state.busy) {
            return {
                ok: false, changed: false, ids: [], result: null,
                diagnostics: [{ code: 'SDK_WORLD_EDIT_BUSY', severity: 'warning', asset: state.path, location: null, message: 'операция уже выполняется', details: null }],
            };
        }
        if (!state.map) {
            return {
                ok: false, changed: false, ids: [], result: null,
                diagnostics: [{ code: 'SDK_WORLD_EDIT_NO_MAP', severity: 'error', asset: state.path, location: null, message: 'карта не открыта', details: null }],
            };
        }
        state.busy = true;
        const inPath = tempPath('in', '.re2dmap');
        const outPath = tempPath('out', '.re2dmap');
        const before = clone(state.map);
        try {
            if (!$.fs.write(inPath, serialize(state.map))) {
                const diag = [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: state.path, location: null, message: 'не удалось записать вход world-edit: ' + inPath, details: null }];
                setDiagnostics(diag);
                return { ok: false, changed: false, ids: [], result: null, diagnostics: diag };
            }
            const call = ['world-edit', inPath, '--op', op, '--args', JSON.stringify(args || {}), '--out', outPath];
            const res = await app.backend(call, 'world-edit ' + op);
            const json = res && res.json ? res.json : null;
            if (!json) {
                const diag = [backendDiagnostic(res, 'world-edit ' + op)];
                setDiagnostics(diag);
                logLine(op + ': ошибка моста');
                return { ok: false, changed: false, ids: [], result: null, diagnostics: diag };
            }
            const diags = normalizeDiagnostics(json, 'SDK_WORLD_EDIT', 'world-edit не вернул JSON');
            state.nativeAvailable = !nativeUnavailable(json);
            if (json.ok !== true || hasErrors(diags)) {
                setDiagnostics(diags);
                logLine(op + ': отклонено' + (diags[0] ? ' (' + diags[0].code + ': ' + diags[0].message + ')' : ''));
                return { ok: false, changed: false, ids: [], result: json && json.result ? json.result : null, diagnostics: diags };
            }
            let next = null;
            const text = $.fs.readText(outPath);
            if (text !== null && text !== undefined) next = parseMapText(text, outPath);
            if (!next) {
                const diag = [{
                    code: 'SDK_WORLD_EDIT_NO_OUTPUT', severity: 'error', asset: outPath, location: null,
                    message: 'world-edit вернул ok, но --out не прочитан: ' + outPath, details: null,
                }];
                setDiagnostics(diag);
                return { ok: false, changed: false, ids: [], result: json.result || null, diagnostics: diag };
            }
            preserveEditorSections(next, before);
            const changed = JSON.stringify(next) !== JSON.stringify(state.map);
            const ids = idsFromResult(json, before, next);
            if (changed) {
                if (bulk) {
                    replaceContents(state.map, next);
                } else {
                    // history.run сравнивает JSON до/после; поэтому сначала
                    // откатываем к before, затем пишем одну запись.
                    replaceContents(state.map, before);
                    state.history.run(op, () => { replaceContents(state.map, next); });
                }
            }
            state.lastResult = json.result || null;
            state.report = null;
            setDiagnostics(diags);
            logLine(op + (changed ? ': ok' : ': без изменений'));
            return { ok: true, changed: changed, ids: ids, result: json.result || null, diagnostics: diags };
        } catch (e) {
            const diag = [{
                code: 'SDK_WORLD_EDIT', severity: 'error', asset: state.path, location: null,
                message: e && e.message ? e.message : String(e), details: null,
            }];
            setDiagnostics(diag);
            return { ok: false, changed: false, ids: [], result: null, diagnostics: diag };
        } finally {
            $.fs.remove(inPath);
            $.fs.remove(outPath);
            state.busy = false;
        }
    }

    function beginBulk() {
        return clone(state.map);
    }

    function rollbackBulk(before) {
        if (before) replaceContents(state.map, before);
    }

    /** Одна логическая правка из нескольких нативных операций — одна запись истории. */
    function commitBulk(label, before) {
        const after = clone(state.map);
        if (JSON.stringify(after) === JSON.stringify(before)) return false;
        replaceContents(state.map, before);
        state.history.run(label, () => { replaceContents(state.map, after); });
        state.report = null;
        return true;
    }

    async function save() {
        if (!state.map || !state.path) return { ok: false, diagnostics: state.diagnostics };
        const inPath = tempPath('save', '.re2dmap');
        try {
            if (!$.fs.write(inPath, serialize(state.map))) {
                const diag = [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: state.path, location: null, message: 'не удалось записать черновик сохранения', details: null }];
                setDiagnostics(diag);
                return { ok: false, path: state.path, diagnostics: diag };
            }
            const call = ['world-edit', inPath, '--op', 'noop', '--args', '{}', '--out', state.path];
            const res = await app.backend(call, 'world-edit noop (save)');
            const json = res && res.json ? res.json : null;
            let diags = json ? normalizeDiagnostics(json, 'SDK_WRITE_FAILED', 'не удалось сохранить')
                : [backendDiagnostic(res, 'world-edit noop (save)')];
            if (json && json.ok === true) {
                const text = $.fs.readText(state.path);
                const parsed = text === null || text === undefined ? null : parseMapText(text, state.path);
                if (parsed) {
                    replaceContents(state.map, parsed);
                } else if (!$.fs.write(state.path, serialize(state.map))) {
                    return { ok: false, path: state.path, diagnostics: diags };
                }
                state.history.markSaved();
                setDiagnostics(diags);
                logLine('сохранено: ' + state.path);
                return { ok: true, path: state.path, diagnostics: diags };
            }
            if (!options.strict && nativeUnavailable(json)) {
                // Честный fallback на время, пока native world-edit недоступен:
                // пишем ту же модель и показываем структурное предупреждение.
                if (!$.fs.write(state.path, serialize(state.map))) {
                    return { ok: false, path: state.path, diagnostics: diags };
                }
                state.history.markSaved();
                diags = diags.concat([{
                    code: 'SDK_WORLD_EDIT_UNAVAILABLE', severity: 'warning', asset: state.path, location: null,
                    message: 'native world-edit недоступен: файл записан локальной сериализацией модели', details: null,
                }]);
                setDiagnostics(diags);
                logLine('сохранено без native world-edit: ' + state.path);
                return { ok: true, path: state.path, diagnostics: diags, fallback: true };
            }
            setDiagnostics(diags);
            return { ok: false, path: state.path, diagnostics: diags };
        } finally {
            $.fs.remove(inPath);
        }
    }

    async function validate() {
        if (!state.map) return { ok: false, diagnostics: state.diagnostics, stats: null };
        const draft = tempPath('validate', '.re2dmap');
        try {
            if (!$.fs.write(draft, serialize(state.map))) {
                return { ok: false, diagnostics: [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: state.path, location: null, message: 'не удалось записать черновик проверки', details: null }], stats: null };
            }
            const res = await app.backend(['world', 'info', draft, '--renderer'], 'world info');
            const json = res && res.json ? res.json : null;
            const diags = json ? normalizeDiagnostics(json, 'SDK_WORLD_VALIDATE', 'world info не вернул JSON')
                : [backendDiagnostic(res, 'world info')];
            setDiagnostics(diags);
            state.stats = json && json.stats ? json.stats : null;
            state.report = json;
            const ok = !!json && json.ok === true && !hasErrors(diags);
            logLine('проверка: ' + (ok ? 'ok' : 'ошибки'));
            return { ok: ok, diagnostics: diags, stats: state.stats, json: json };
        } finally {
            $.fs.remove(draft);
        }
    }

    function disposePreview() {
        if (state.world && state.world.dispose) {
            try { state.world.dispose(); } catch (e) { /* уже освобождён */ }
        }
        state.world = null;
        if (state.node) {
            try { state.node.remove(); } catch (e) { /* уже удалён */ }
        }
        state.node = null;
        state.previewOut = null;
    }

    function buildPreview(worldJson) {
        if (disposed) return false;
        let nextWorld = null;
        try {
            nextWorld = $.re2dWorld.fromJSON(JSON.stringify(worldJson)).backend(state.gpu ? 'gpu' : 'cpu');
            nextWorld.debug.view(state.debugView);
            if (!state.lighting) nextWorld.lighting({ enabled: false, dynamic: false, shadows: false });
            // Keep the last valid runtime until the replacement has loaded.
            disposePreview();
            state.world = nextWorld;
            state.node = $('<sprite>', { id: 'we-3d-preview-' + sessionId }).appendTo($.world);
            return true;
        } catch (e) {
            if (nextWorld && nextWorld !== state.world) nextWorld.dispose();
            state.diagnostics = state.diagnostics.concat([{
                code: 'SDK_WORLD_PREVIEW', severity: 'error', asset: state.path, location: null,
                message: 'runtime отклонил компиляцию: ' + (e && e.message ? e.message : e), details: null,
            }]);
            return false;
        }
    }

    async function compile(write) {
        if (!state.map) return { ok: false, diagnostics: state.diagnostics, stats: null, preview: false };
        const draft = tempPath('compile', '.re2dmap');
        const out = String(state.path).replace(/\.re2dmap(?:\.json)?$/i, '') + '.re2dworld';
        try {
            if (!$.fs.write(draft, serialize(state.map))) {
                return { ok: false, diagnostics: [{ code: 'SDK_WRITE_FAILED', severity: 'error', asset: state.path, location: null, message: 'не удалось записать черновик компиляции', details: null }], stats: null, preview: false };
            }
            const call = write === false
                ? ['world', 'info', draft, '--renderer']
                : ['world', 'compile', draft, '--renderer', '--output', out];
            const res = await app.backend(call, write === false ? 'world info' : 'world compile');
            const json = res && res.json ? res.json : null;
            const diags = json ? normalizeDiagnostics(json, 'SDK_WORLD_COMPILE', 'компиляция не вернула JSON')
                : [backendDiagnostic(res, write === false ? 'world info' : 'world compile')];
            setDiagnostics(diags);
            state.stats = json && json.stats ? json.stats : null;
            state.report = json;
            let preview = false;
            if (json && json.ok === true) {
                if (json.world) {
                    preview = buildPreview(json.world);
                } else {
                    const text = $.fs.readText(out);
                    if (text !== null && text !== undefined) {
                        try {
                            const parsed = JSON.parse(text);
                            preview = buildPreview(parsed && parsed.world ? parsed.world : parsed);
                        } catch (e) {
                            state.diagnostics = state.diagnostics.concat([{
                                code: 'SDK_WORLD_PREVIEW', severity: 'error', asset: out, location: null,
                                message: 'скомпилированный .re2dworld не разобран: ' + (e && e.message ? e.message : e), details: null,
                            }]);
                        }
                    }
                }
                if (preview) state.previewOut = out;
                state.debugView = state.debugView || 'final';
            }
            const ok = !!json && json.ok === true && !hasErrors(diags) && preview;
            logLine((write === false ? 'info' : 'compile') + ': ' + (ok ? 'ok' : 'ошибки') + (preview ? ', preview готов' : ''));
            return { ok: ok, diagnostics: state.diagnostics, stats: state.stats, out: out, preview: preview, json: json };
        } finally {
            $.fs.remove(draft);
        }
    }

    function nextDebugView() {
        const views = ['final', 'depth', 'owner', 'light-level', 'normal', 'emissive', 'bsp', 'portals', 'region', 'pvs', 'occluder'];
        const at = views.indexOf(state.debugView);
        state.debugView = views[(at + 1) % views.length];
        if (state.world) state.world.debug.view(state.debugView);
        return state.debugView;
    }

    function toggleBackend() {
        state.gpu = !state.gpu;
        if (state.world) state.world.backend(state.gpu ? 'gpu' : 'cpu');
        return state.gpu ? 'gpu' : 'cpu';
    }

    function toggleLighting() {
        state.lighting = !state.lighting;
        if (state.world) state.world.lighting({ enabled: state.lighting, dynamic: state.lighting, shadows: state.lighting });
        return state.lighting;
    }

    async function buildAndRun() {
        const saved = await save();
        if (!saved.ok) return { ok: false, stage: 'save', diagnostics: saved.diagnostics };
        const checked = await validate();
        if (!checked.ok) return { ok: false, stage: 'validate', diagnostics: checked.diagnostics, stats: checked.stats };
        const compiled = await compile(true);
        if (!compiled.ok) return { ok: false, stage: 'compile', diagnostics: compiled.diagnostics, stats: compiled.stats };
        const run = app.runProject();
        return { ok: !!run, stage: 'run', run: run, diagnostics: compiled.diagnostics, stats: compiled.stats };
    }

    function snapshot() {
        return {
            path: state.path,
            dirty: state.history ? state.history.dirty() : false,
            busy: state.busy,
            preview: !!state.world,
            stats: state.stats,
            lastResult: state.lastResult,
            native: state.nativeAvailable,
            codes: state.diagnostics.map((d) => d.code),
            log: state.log.slice(-40),
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        disposePreview();
    }

    // A pending save must not overwrite newer edits. All I/O operations share
    // the transaction lock already used by apply(), independently per session.
    function exclusive(fn) {
        return async (...args) => {
            if (state.busy || disposed) return { ok: false, diagnostics: [{
                code: 'SDK_WORLD_EDIT_BUSY', severity: 'warning', asset: state.path, location: null,
                message: 'операция уже выполняется или вкладка закрыта', details: null,
            }] };
            state.busy = true;
            try { return await fn(...args); } finally { state.busy = false; }
        };
    }

    return {
        state, base, open, newMap, apply, beginBulk, rollbackBulk, commitBulk,
        save: exclusive(save), validate: exclusive(validate), compile: exclusive(compile),
        buildAndRun: exclusive(buildAndRun), snapshot,
        setDiagnostics, hasErrors, nativeUnavailable,
        nextDebugView, toggleBackend, toggleLighting, disposePreview, dispose,
        sectionForOp,
    };
}
