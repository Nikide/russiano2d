// VN Studio: one source document per Editor tab, shared story/dialog runtime.
import { escapeHtml } from '../lib/shared/model.js';
import * as M from '../lib/shared/vn_model.js';
import { createHistory } from '../lib/shared/history.js';
import { studioDoc, mousePx, keys as studioKeys, diag, FILTERS, pickProjectFile } from '../lib/studio_kit.js';

export const meta = {
    id: 'narrative', title: 'Истории', icon: 'chat',
    match: (p) => /\.(scene|story)$/i.test(p),
    summary: (s) => s ? [['Состояние', s.dirty ? 'не сохранён' : 'сохранён'], ['Команд', s.commandCount], ['Выбрана', s.selectedCommand + 1], ['Предпросмотр', s.previewRunning ? 'играет' : 'остановлен']] : [],
};

export function create(host) {
    const $ = host.$;
    const doc = host.document || studioDoc($, 'narrative');
    const key = studioKeys($, host);
    const at = (p) => host.root() && p && !/^(\/|[A-Za-z]:[\\/])/.test(p) ? host.root() + '/' + p : p;
    const hasPreview = !host.document;
    const model = { source: '' };
    let history = createHistory(model);
    let closed = false;
    let seq = 0;
    let themeToken = null;
    const speakerPrefix = '__vn_' + doc.id + '_';
    const s = {
        active: false, scenePath: '', lines: [], sel: -1,
        mode: 'commands', scenes: [], speakers: [], validation: null,
        preview: false, previewLine: -1, status: '', search: '',
        speakersPath: '', speakersJson: '', speakersData: { speakers: {} }, charSel: '',
        assets: [], pickTarget: '', searchHits: [], closeWarned: false, themes: [], themeSel: '', dragFrom: -1,
    };

    Object.defineProperty(s, 'source', { get: () => model.source, set: (v) => { model.source = String(v); } });
    Object.defineProperty(s, 'dirty', { get: () => history.dirty() });

    const nameOf = (p) => p.split('/').pop();

    // --- source model -------------------------------------------------------
    function setSource(text, path) {
        model.source = String(text == null ? '' : text);
        if (path != null) s.scenePath = path;
        s.sel = -1; s.validation = null;
        history = createHistory(model);
        syncLines(); renderAll();
    }
    function syncLines() { s.lines = M.lines(s.source).map((r) => r.text); }
    function commandRows() { return M.commands(s.source); }
    const visible = commandRows;
    function afterEdit() {
        syncLines();
        if (s.validation) s.validationStale = s.validatedSource !== s.source;
        s.closeWarned = false;
        renderAll(); if (!closed) host.changed();
    }
    function edit(label, source) {
        if (closed || source === s.source) return false;
        history.run(label, () => { model.source = source; });
        afterEdit(); return true;
    }
    function undo() { const result = history.undo(); if (result) afterEdit(); return !!result; }
    function redo() { const result = history.redo(); if (result) afterEdit(); return !!result; }

    // --- files --------------------------------------------------------------
    function listDir(path) {
        try { return $.fs.list(at(path)) || []; } catch (_) { return []; }
    }
    function collectScenes(root, out) {
        out = out || [];
        for (const name of listDir(root)) {
            if (!name || name === '.' || name === '..') continue;
            const p = root + '/' + name;
            if (/\.(scene|story)$/i.test(name)) out.push(p);
            else if (!/\.[a-z0-9]+$/i.test(name)) collectScenes(p, out);
        }
        return out;
    }
    function readText(path) { try { return $.fs.readText(at(path)); } catch (_) { return null; } }
    function writeText(path, text) { try { return $.fs.write(at(path), text) !== false; } catch (_) { return false; } }

    function loadScenes() {
        s.scenes = collectScenes('story');
        if (!s.scenes.length) s.scenes = collectScenes('game/story');
        s.speakersPath = readText('story/speakers.json') != null ? 'story/speakers.json' : (readText('game/story/speakers.json') != null ? 'game/story/speakers.json' : 'story/speakers.json');
        s.speakersJson = readText(s.speakersPath) || '{"speakers":{}}';
        try { s.speakersData = JSON.parse(s.speakersJson); }
        catch (e) { s.speakersData = { speakers: {} }; fail('SDK_VN_JSON', e.message, at(s.speakersPath)); }
        s.speakers = Object.keys(s.speakersData.speakers || {});
        renderSpeakers(); renderThemes(); renderEnv(); loadI18n();
    }
    function fail(code, message, asset) {
        s.localDiags = [diag(code, 'error', message, { asset: asset || s.scenePath })];
        s.status = message; renderDiag(); host.status(message, 'err'); host.changed();
        return false;
    }
    function publish(text) { s.status = text; host.status(text, ''); renderAll(); host.changed(); }
    function writeResource(path, text, previous) {
        const current = readText(path);
        if (previous !== undefined && current !== previous) return fail('SDK_VN_WRITE_CONFLICT', 'Файл изменён другой вкладкой: ' + path, at(path));
        if (!writeText(path, text)) return fail('SDK_WRITE_FAILED', 'Не удалось записать ' + path, at(path));
        return true;
    }

    // --- rendering ----------------------------------------------------------
    function renderScenes() {
        if (!s.scenes.length) { doc.html('vnm-scenes', '<div class="hint">Нет story/*.scene. Создайте новый.</div>'); return; }
        doc.html('vnm-scenes', s.scenes.map((p) => '<div class="vnm-item' + (at(p) === s.scenePath ? ' active' : '') + '" data-key="' + escapeHtml(p) + '">' + escapeHtml(p.replace(/^story\//, '')) + '</div>').join(''));
    }
    function renderLabels() {
        const labels = visible().filter((c) => c.kind === 'label');
        doc.html('vnm-labels', labels.length ? labels.map((c) => '<div class="vnm-item" data-key="' + escapeHtml(c.text) + '">:' + escapeHtml(c.text) + '</div>').join('') : '<div class="hint">Меток нет.</div>');
    }
    function renderSpeakers() {
        doc.html('vnm-speakers', s.speakers.length ? s.speakers.map((n) => '<div class="vnm-item' + (n === s.charSel ? ' active' : '') + '" data-key="' + escapeHtml(n) + '">' + escapeHtml(n) + '</div>').join('') : '<div class="hint">story/speakers.json не найден.</div>');
        doc.setValue('vnm-speakers-json', s.speakersJson);
        const e = (s.speakersData.speakers || {})[s.charSel] || {};
        doc.setValue('vnm-ch-id', s.charSel || '');
        doc.setValue('vnm-ch-name', e.name || e.displayName || '');
        doc.setValue('vnm-ch-slot', e.slot || e.defaultSlot || '');
        doc.setValue('vnm-ch-blip', e.textBlip || '');
        doc.setValue('vnm-ch-expr', Array.isArray(e.expressions) ? e.expressions.join(', ') : '');
    }
    function selectTheme(path) {
        s.themeSel = path;
        s.themeRcssPath = path.replace(/\.rml$/i, '.rcss');
        s.themeRcss = readText(s.themeRcssPath) || '';
        renderThemes();
    }
    function saveTheme() {
        if (!s.themeRcssPath) { s.status = 'тема не выбрана'; renderAll(); return false; }
        const text = String(doc.value('vnm-theme-rcss') || '');
        if (!writeResource(s.themeRcssPath, text, s.themeRcss)) { s.status = 'не удалось записать ' + s.themeRcssPath; renderAll(); return false; }
        s.themeRcss = text; s.status = 'тема сохранена'; renderAll(); return true;
    }
    async function validateTheme() {
        if (!s.themeSel) { s.status = 'тема не выбрана'; renderAll(); return false; }
        try {
            const r = await host.backend(['dialog', 'validate', at(s.themeSel)]);
            if (closed) return null;
            if (!r.json) return fail('SDK_BACKEND_NO_JSON', 'dialog validate не вернул JSON', at(s.themeSel));
            s.themeReport = r.json;
        } catch (e) { return fail('SDK_VN_VALIDATE', String(e.message || e), at(s.themeSel)); }
        const d = (s.themeReport.diagnostics || []);
        doc.text('vnm-theme-info', d.length ? ('ошибок: ' + d.length + ' — ' + d[0].message) : 'тема валидна');
        host.changed();
        return s.themeReport;
    }

    function renderThemes() {
        s.themes = [];
        for (const f of listDir('ui/dialog')) if (/\.rml$/i.test(f)) s.themes.push('ui/dialog/' + f);
        doc.html('vnm-themes', s.themes.length ? s.themes.map((p) => '<div class="vnm-item' + (p === s.themeSel ? ' active' : '') + '" data-key="' + escapeHtml(p) + '">' + escapeHtml(p) + '</div>').join('') : '<div class="hint">Тем нет.</div>');
        if (s.themeRcssPath) doc.setValue('vnm-theme-rcss', s.themeRcss);
    }

    function renderEnv() {
        const theme = readText('ui/dialog/bashnya.rml') != null ? 'ui/dialog/bashnya.rml' : '—';
        let i18n = 0; for (const f of listDir('i18n')) if (/\.json$/i.test(f)) i18n++;
        doc.text('vnm-env', 'тема: ' + theme + '\ni18n: ' + i18n + ' файлов');
    }
    function renderCommands() {
        const list = visible();
        if (!list.length) { doc.html('vnm-commands', '<div class="hint">Пустая сцена. Добавьте команду.</div>'); return; }
        doc.html('vnm-commands', list.map((c, i) => {
            const body = c.kind === 'say' ? escapeHtml(c.text || '') :
                c.kind === 'choice' ? escapeHtml(c.text || '') + (c.goto ? ' -> ' + escapeHtml(c.goto) : '') :
                escapeHtml(c.kind === 'raw' ? c.raw : (c.text || ''));
            return '<div id="vnm-cmd-' + i + '" class="vnm-cmd' + (i === s.sel ? ' active' : '') + '" data-key="' + i + '">' +
                '<div class="vnm-head">' + escapeHtml(String(c.kind).toUpperCase()) +
                (c.speaker ? ' · ' + escapeHtml(c.speaker) : '') + (c.expr ? ' [' + escapeHtml(c.expr) + ']' : '') +
                (c.goto && c.kind !== 'choice' ? ' -> ' + escapeHtml(c.goto) : '') + '</div>' +
                '<div class="vnm-body">' + body + '</div></div>';
        }).join(''));
    }
    function renderInspector() {
        const list = visible();
        const c = list[s.sel];
        if (!c) { doc.style('vnm-insp-fields', 'display', 'none'); doc.style('vnm-insp-empty', 'display', 'block'); return; }
        doc.style('vnm-insp-fields', 'display', 'block'); doc.style('vnm-insp-empty', 'display', 'none');
        doc.setValue('vnm-f-kind', c.kind); doc.setValue('vnm-f-speaker', c.speaker || '');
        doc.setValue('vnm-f-expr', c.expr || ''); doc.setValue('vnm-f-slot', c.slot || '');
        doc.setValue('vnm-f-text', c.text || ''); doc.setValue('vnm-f-voice', c.voice || '');
        doc.setValue('vnm-f-asset', c.asset || ''); doc.setValue('vnm-f-goto', c.goto || '');
        doc.setValue('vnm-f-raw', c.raw || '');
        doc.text('vnm-command-help', 'Полная строка сохраняет любые команды DSL. Слот и голос задаются в speakers.json; у команды этих полей нет.');
    }
    function renderDiag() {
        if (closed) return;
        const list = diagnostics();
        doc.html('vnm-diag', list.length ? list.map((d, i) => '<div class="diag" data-key="' + i + '">' + escapeHtml((d.code || '') + ': ' + d.message) + '</div>').join('') : '<div class="hint">' + (s.validation ? 'Ошибок нет.' : 'Проверка не запускалась.') + '</div>');
    }
    function renderGraph() {
        doc.style('vnm-graph-view', 'display', s.mode === 'graph' ? 'block' : 'none');
        if (s.mode !== 'graph') return;
        const rows = visible().filter((c) => c.kind === 'label' || c.kind === 'choice' || /^\s*(goto|if)\b/.test(c.raw));
        doc.html('vnm-graph-view', rows.map((c) => '<div class="vnm-item" data-key="' + visible().findIndex((r) => r.index === c.index) + '">' + escapeHtml(c.line + ' · ' + c.raw.trim()) + '</div>').join(''));
    }
    // Предпросмотр выбранной команды из настоящих ассетов проекта: фон —
    // последний `image` до строки, портрет и имя — speakers.json, варианты —
    // соседние `- …` строки. Это композиция кадра, а не второй интерпретатор:
    // проигрывание — $.story (Play).
    function previewModel() {
        const list = visible();
        const c = list[s.sel] || list.find((x) => x.kind === 'say' || x.kind === 'narration') || null;
        if (!c) return null;
        let bg = '';
        for (let i = 0; i <= c.index && i < s.lines.length; i++) {
            const m = /^\s*image\s+(\S+)/.exec(s.lines[i]);
            if (m) bg = m[1] === 'off' ? '' : m[1];
        }
        const sp = c.speaker && s.speakersData && s.speakersData.speakers ? s.speakersData.speakers[c.speaker] : null;
        const portraits = sp && sp.portraits ? sp.portraits : {};
        const portrait = c.kind === 'say' ? (portraits[c.expr] || portraits[Object.keys(portraits)[0]] || '') : '';
        let choices = [];
        const k = list.indexOf(c);
        if (c.kind === 'choice' || (list[k + 1] && list[k + 1].kind === 'choice')) {
            let a = c.kind === 'choice' ? k : k + 1;
            while (a > 0 && list[a - 1].kind === 'choice') a--;
            for (let i = a; i < list.length && list[i].kind === 'choice'; i++) choices.push({ text: list[i].text, goto: list[i].goto, on: list[i] === c });
        }
        let speaker = '', text = '';
        if (c.kind === 'say') { speaker = sp && sp.name ? sp.name : c.speaker; text = c.text; }
        else if (c.kind === 'narration') text = c.text;
        else if (c.kind === 'choice') {
            // Вопрос — ближайшая реплика выше блока выбора.
            for (let i = k; i >= 0; i--) if (list[i].kind === 'say' || list[i].kind === 'narration') { speaker = list[i].kind === 'say' ? ((s.speakersData.speakers || {})[list[i].speaker] || {}).name || list[i].speaker : ''; text = list[i].text; break; }
        } else text = c.raw || c.text || '';
        return { kind: c.kind, bg, portrait, speaker, text, choices };
    }
    function renderPreview() {
        if (!hasPreview) return;
        const p = previewModel();
        if (!p) { doc.html('vnm-preview', '<div class="vp-empty">Выберите реплику — здесь будет кадр.</div>'); return; }
        const img = (path, cls) => path ? '<img class="' + cls + '" src="' + escapeHtml(at(path)) + '"/>' : '';
        doc.html('vnm-preview',
            '<div class="vp-stage">' + (p.bg ? img(p.bg, 'vp-bg') : '<div class="vp-nobg">фон не задан (image …)</div>') +
            img(p.portrait, 'vp-portrait') +
            (p.text || p.choices.length ? '<div class="vp-box">' + (p.speaker ? '<div class="vp-name">' + escapeHtml(p.speaker) + '</div>' : '') +
                '<div class="vp-text">' + escapeHtml(p.text || '') + '</div>' +
                p.choices.map((c) => '<div class="vp-choice' + (c.on ? ' on' : '') + '">' + escapeHtml(c.text) + '</div>').join('') + '</div>' : '') +
            '</div>');
    }
    function renderAll() {
        if (closed || !s.active) return;
        renderScenes(); renderLabels(); renderCommands(); renderInspector(); renderDiag(); renderPreview(); renderGraph();
        doc.text('vnm-scene-name', s.scenePath || '—');
        doc.text('vnm-state', s.dirty ? 'не сохранено' : (s.status || ''));
        doc.cls('vnm-undo', 'off', !history.canUndo());
        doc.cls('vnm-redo', 'off', !history.canRedo());
        doc.style('vnm-commands', 'display', s.mode === 'commands' ? 'block' : 'none');
        doc.style('vnm-source-buffer', 'display', s.mode === 'source' ? 'block' : 'none');
        if (s.mode === 'source' && doc.value('vnm-source-buffer') !== s.source) doc.setValue('vnm-source-buffer', s.source);
        if (!closed) host.changed();
    }

    // --- operations ---------------------------------------------------------
    function select(i) { s.sel = Number(i); renderCommands(); renderInspector(); renderPreview(); return s.sel; }
    function openScene(path) { return host.openWith(at(path), 'narrative'); }
    function newScene(path) {
        path = path || 'story/new.scene';
        if (/^(\/|[A-Za-z]:)/.test(path) || path.split(/[\\/]/).includes('..') || !/\.(scene|story)$/i.test(path)) return fail('SDK_VN_PATH', 'Укажите путь .scene/.story внутри проекта');
        if (readText(path) != null) return fail('SDK_VN_EXISTS', 'Файл уже существует: ' + path);
        const text = '# Новая сцена\n:start\n~ Начало.\nend\n';
        if (!writeResource(path, text)) return false;
        s.scenes.push(path); renderScenes(); host.openWith(at(path), 'narrative'); return true;
    }
    function save() {
        if (closed || !s.scenePath) return false;
        if (!s.dirty) return true;
        if (!writeResource(s.scenePath, s.source, s.savedSource)) return false;
        s.savedSource = s.source; history.markSaved(); publish('сохранено'); return true;
    }
    function currentCommand() { return visible()[s.sel]; }
    function applyInspector() {
        const c = currentCommand(); if (!c) return false;
        const patch = {};
        for (const [name, field] of Object.entries({ kind: 'kind', speaker: 'speaker', expr: 'expr', text: 'text', asset: 'asset', goto: 'goto', raw: 'raw' })) patch[name] = String(doc.value('vnm-f-' + field) || '');
        return edit('инспектор', M.editSource(s.source, 'replace', c.index, M.patchLine(c, patch)));
    }
    function insert(kind) {
        const c = currentCommand(), at = c ? c.index + 1 : M.lines(s.source).length;
        const changed = edit('вставка', M.editSource(s.source, 'insert', at, M.TEMPLATES[kind] || M.TEMPLATES.raw));
        s.sel = visible().findIndex((r) => r.index === at); renderAll(); return changed;
    }
    function del() {
        const c = currentCommand(); if (!c) return false;
        const changed = edit('удаление', M.editSource(s.source, 'delete', c.index));
        s.sel = Math.min(s.sel, visible().length - 1); renderAll(); return changed;
    }
    function move(delta) {
        const list = visible(), c = list[s.sel], other = list[s.sel + delta];
        if (!c || !other) return false;
        const changed = edit('перемещение', M.editSource(s.source, 'move', c.index, other.index));
        s.sel += delta; renderAll(); return changed;
    }
    function duplicate() {
        const c = currentCommand(); if (!c) return false;
        const changed = edit('дубль', M.editSource(s.source, 'insert', c.index + 1, c.raw));
        s.sel++; renderAll(); return changed;
    }

    async function validate() {
        if (s.validating || closed) return null;
        s.validating = true;
        const input = s.source;
        const base = at('build/.r2d-vn-' + doc.id + '-' + (++seq));
        const files = [];
        const stage = (path, text) => { if (!writeText(path, text)) throw new Error('не удалось записать черновик ' + path); files.push(path); };
        const scene = base + '/story/' + nameOf(s.scenePath);
        try {
            stage(scene, input);
            stage(base + '/story/speakers.json', readText(s.speakersPath) || '{"speakers":{}}');
            for (const file of listDir('i18n').filter((f) => /\.json$/i.test(f))) stage(base + '/story/i18n/' + file, readText('i18n/' + file));
            const res = await host.backend(['story', 'validate', base + '/story', '--assets-root', host.root()]);
            if (closed) return null;
            if (!res.json) { fail('SDK_BACKEND_NO_JSON', 'story validate не вернул JSON'); return null; }
            s.validation = Object.assign({}, res.json, { diagnostics: (res.json.diagnostics || []).map((d) => {
                const m = /\bline (\d+)\b/.exec(d.message || '');
                let asset = d.asset ? String(d.asset).replace(/\\/g, '/').replace(/\/+/g, '/') : d.asset;
                if (asset === scene) asset = s.scenePath;
                else if (asset === base + '/story/speakers.json') asset = at(s.speakersPath);
                else if (asset && asset.startsWith(base + '/story/i18n/')) asset = at('i18n/' + nameOf(asset));
                return Object.assign({}, d, { asset, location: d.location || (m ? { line: Number(m[1]) } : null) });
            }) });
            s.validatedSource = input; s.validationStale = input !== s.source;
            s.localDiags = [];
            publish(s.validation.ok ? 'история проверена' : 'в истории есть ошибки');
            return s.validation;
        } catch (e) { fail('SDK_VN_VALIDATE', String(e.message || e)); return null; }
        finally {
            for (const f of files) $.fs.remove(f);
            for (const dir of ['/story/i18n', '/story', '']) $.fs.remove(base + dir);
            s.validating = false;
        }
    }
    function diagnostics() {
        const list = (s.validation ? s.validation.diagnostics || [] : []).concat(s.localDiags || [], s.themeReport ? s.themeReport.diagnostics || [] : []);
        return s.validationStale ? list.concat([diag('SDK_VN_VALIDATION_STALE', 'info', 'Текст изменён после проверки', { asset: s.scenePath })]) : list;
    }
    function navigateDiagnostic(d) {
        if (!d || !d.location || !d.location.line) return false;
        const i = visible().findIndex((c) => c.line >= d.location.line);
        if (i < 0) return false;
        select(i); doc.focus('vnm-cmd-' + i); return true;
    }
    function previewSource(from) {
        if (!s.active || closed || $.story.running()) return false;
        const c = currentCommand();
        let text = s.source;
        const label = '__vn_preview_start';
        if (from && c) text = M.editSource(text, 'insert', c.index, ':' + label);
        // All command semantics remain in the actual runtime parser/executor.
        const script = $.story.parse(text.replace(/^[ \t]*@theme[ \t]+\S+[ \t\r]*$/gm, ''));
        for (const cmd of script.commands) {
            if (['image', 'sound'].includes(cmd.op) && cmd.path !== 'off') cmd.path = at(cmd.path);
            if (cmd.op === 'say' && (s.speakersData.speakers || {})[cmd.who]) {
                const speaker = s.speakersData.speakers[cmd.who];
                const portraits = {};
                for (const [key, path] of Object.entries(speaker.portraits || {})) portraits[key] = at(path);
                const id = speakerPrefix + cmd.who;
                $.dialog.speaker(id, Object.assign({}, speaker, { portraits, voice: speaker.voice ? at(speaker.voice) : undefined, textBlip: speaker.textBlip ? at(speaker.textBlip) : undefined }));
                cmd.who = id;
            }
        }
        const theme = /^\s*@theme\s+(\S+)/m.exec(text);
        if (theme) {
            const path = 'ui/dialog/' + theme[1] + '.rml';
            if (readText(path) != null) {
                $.dialog.themeDefine(speakerPrefix + 'theme', { rml: at(path), rcss: at(path.replace(/\.rml$/, '.rcss')) });
                themeToken = $.dialog.themePush(speakerPrefix + 'theme');
            }
        }
        try {
            const ok = $.story.play(script, { free: true, label: from && c ? label : undefined });
            if (!ok) { if (themeToken) themeToken.release(); themeToken = null; return false; }
            s.preview = true; s.previewLine = c ? c.index : -1;
            if (host.preview) host.preview();
            return true;
        } catch (e) { stopPreview(); return fail('SDK_VN_PREVIEW', String(e.message || e)); }
    }
    function stopPreview() {
        if (s.preview) $.story.stop();
        s.preview = false;
        if (themeToken) themeToken.release(); themeToken = null;
        return true;
    }
    function previewRunning() { return s.preview && $.story.running(); }

    function search(q) {
        s.search = String(q || '').toLowerCase();
        const hits = [];
        if (s.search) for (const path of s.scenes) {
            const text = at(path) === s.scenePath ? s.source : readText(path); if (text == null) continue;
            text.split('\n').forEach((line, idx) => {
                if (line.toLowerCase().includes(s.search)) hits.push({ path, idx, line });
            });
        }
        s.searchHits = hits;
        doc.html('vnm-results', hits.length ? hits.slice(0, 100).map((h, i) => '<div class="vnm-item" data-key="' + i + '">' + escapeHtml(h.path.replace(/^story\//, '')) + ':' + (h.idx + 1) + ' · ' + escapeHtml(h.line.trim()) + '</div>').join('') : '<div class="hint">Ничего.</div>');
        return hits;
    }

    // --- UI wiring ----------------------------------------------------------
    function selectSpeaker(name) {
        s.charSel = String(name || ''); renderSpeakers();
    }
    function saveCharacter() {
        const id = String(doc.value('vnm-ch-id') || '').trim();
        if (!id) { s.status = 'укажите speaker id'; renderAll(); return false; }
        const old = s.speakersData.speakers || {};
        const prev = old[s.charSel] || {};
        const entry = Object.assign({}, prev);
        const name = String(doc.value('vnm-ch-name') || '').trim(); if (name) entry.name = name; else delete entry.name;
        const slot = String(doc.value('vnm-ch-slot') || '').trim(); if (slot) entry.slot = slot; else delete entry.slot;
        const blip = String(doc.value('vnm-ch-blip') || '').trim(); if (blip) entry.textBlip = blip; else delete entry.textBlip;
        const expr = String(doc.value('vnm-ch-expr') || '').split(',').map((x) => x.trim()).filter(Boolean);
        if (expr.length) entry.expressions = expr; else delete entry.expressions;
        if (s.charSel && s.charSel !== id) delete old[s.charSel];
        old[id] = entry; s.speakersData.speakers = old; s.charSel = id;
        s.speakersJson = JSON.stringify(s.speakersData, null, 2) + '\n';
        if (!writeResource(s.speakersPath, s.speakersJson, s.savedSpeakers)) { s.status = 'не удалось записать ' + s.speakersPath; renderAll(); return false; }
        s.savedSpeakers = s.speakersJson; s.speakers = Object.keys(old); renderSpeakers(); s.status = 'персонаж сохранён'; renderAll(); return true;
    }
    function scanAssets(root, out, depth) {
        if (depth > 4) return;
        for (const name of listDir(root)) {
            if (!name || name.startsWith('.') || name === 'build' || name === '__pycache__') continue;
            const p = root + '/' + name;
            if (/\.(png|jpg|jpeg|webp|ogg|wav|mp3|rml|rcss|ttf)$/i.test(name)) out.push(p);
            else if (!/\.[a-z0-9]+$/i.test(name)) scanAssets(p, out, depth + 1);
        }
    }
    function findAssets() {
        const list = []; for (const root of ['assets', 'game/assets', 'demos/assets', 'ui']) scanAssets(root, list, 0);
        const q = String(doc.value('vnm-asset-query') || '').toLowerCase();
        s.assets = list.filter((p) => (!q || p.toLowerCase().includes(q)) && (s.pickTarget === 'voice' ? /\.(ogg|wav|mp3)$/i.test(p) : s.pickTarget ? /\.(png|jpg|jpeg|webp)$/i.test(p) : true)).slice(0, 300);
        doc.html('vnm-assets', s.assets.length ? s.assets.map((p) => '<div class="vnm-item" data-key="' + escapeHtml(p) + '">' + escapeHtml(p) + '</div>').join('') : '<div class="hint">Ничего.</div>');
        return s.assets;
    }
    function pickAsset(path) {
        const target = s.pickTarget === 'voice' ? 'vnm-f-voice' : 'vnm-f-asset';
        doc.setValue(target, path); s.status = 'выбран ' + path; return true;
    }

    function saveSpeakers() {
        const text = String(doc.value('vnm-speakers-json') || '');
        try { JSON.parse(text); } catch (e) { s.status = 'speakers.json: ' + e.message; renderAll(); return false; }
        if (!writeResource(s.speakersPath, text, s.savedSpeakers)) { s.status = 'не удалось записать ' + s.speakersPath; renderAll(); return false; }
        s.speakersJson = text; s.savedSpeakers = text;
        try { const j = JSON.parse(text); s.speakersData = j; s.speakers = Object.keys(j.speakers || {}); renderSpeakers(); } catch (_) {}
        s.status = 'персонажи сохранены'; renderAll(); return true;
    }

    function loadI18n() {
        const files = listDir('i18n').filter((f) => /\.json$/i.test(f));
        doc.html('vnm-i18n', files.map((f) => '<div class="vnm-item" data-key="' + escapeHtml(f) + '">' + escapeHtml(f) + '</div>').join(''));
    }
    function selectI18n(file) {
        s.i18nPath = 'i18n/' + file; s.i18nText = readText(s.i18nPath) || '{}';
        doc.setValue('vnm-i18n-json', s.i18nText);
    }
    function saveI18n() {
        if (!s.i18nPath) return false;
        const text = String(doc.value('vnm-i18n-json') || '');
        try { JSON.parse(text); } catch (e) { return fail('SDK_VN_JSON', e.message, at(s.i18nPath)); }
        if (!writeResource(s.i18nPath, text, s.i18nText)) return false;
        s.i18nText = text; publish('i18n сохранён'); return true;
    }
    function openFile(path) {
        if (!path) { loadScenes(); path = s.scenes[0]; if (!path) { setSource('', ''); return; } }
        const text = readText(path);
        if (text == null) throw new Error('Не удалось прочитать ' + path);
        s.scenePath = path; s.savedSource = text; setSource(text, path);
        loadScenes(); s.savedSpeakers = readText(s.speakersPath);
    }
    function close() { if (closed) return true; closed = true; stopPreview(); s.active = false; doc.unload(); return true; }

    doc.on('vnm-back', 'click', () => { if (host.closeTab) host.closeTab(); });
    doc.on('vnm-save', 'click', save);
    doc.on('vnm-undo', 'click', undo);
    doc.on('vnm-redo', 'click', redo);
    doc.on('vnm-speakers-save', 'click', saveSpeakers);
    doc.on('vnm-speakers', 'click', (id, ev, key) => { if (key) selectSpeaker(key); });
    doc.on('vnm-ch-save', 'click', saveCharacter);
    // «…» у полей ассета/голоса: окно ОС, путь относительно проекта.
    async function browseAsset(target) {
        const cur = String(doc.value(target === 'voice' ? 'vnm-f-voice' : 'vnm-f-asset') || '').trim();
        const r = await pickProjectFile($, host.root(), { title: target === 'voice' ? 'Выберите голос' : 'Выберите картинку',
            filters: target === 'voice' ? FILTERS.audio : FILTERS.image, path: cur ? at(cur) : host.root() });
        if (r.error) { fail('SDK_VN_PATH', r.error); return false; }
        if (!r.rel) return false;
        s.pickTarget = target; pickAsset(r.rel); renderAll(); return true;
    }
    async function browseNewScene() {
        const r = await pickProjectFile($, host.root(), { save: true, title: 'Новая сцена', filters: FILTERS.scene, path: host.root() + '/story/new.scene' });
        if (r.error) { fail('SDK_VN_PATH', r.error); return false; }
        if (!r.rel) return false;
        return newScene(/\.(scene|story)$/i.test(r.rel) ? r.rel : r.rel + '.scene');
    }
    doc.on('vnm-pick-asset', 'click', () => browseAsset('asset'));
    doc.on('vnm-pick-voice', 'click', () => browseAsset('voice'));
    doc.on('vnm-asset-find', 'click', () => findAssets());
    doc.on('vnm-themes', 'click', (id, ev, key) => { if (key) selectTheme(key); });
    doc.on('vnm-theme-open', 'click', () => { if (s.themeSel) host.openWith(at(s.themeSel), 'rmlui-studio'); });
    doc.on('vnm-theme-validate', 'click', validateTheme);
    doc.on('vnm-theme-save', 'click', saveTheme);
    doc.on('vnm-graph', 'click', () => { s.mode = s.mode === 'graph' ? 'commands' : 'graph'; renderAll(); });
    doc.on('vnm-validate', 'click', validate);
    doc.on('vnm-play', 'click', () => previewSource(false));
    doc.on('vnm-from', 'click', () => previewSource(true));
    doc.on('vnm-stop', 'click', stopPreview);
    doc.on('vnm-source-mode', 'click', () => { s.mode = s.mode === 'source' ? 'commands' : 'source'; renderAll(); });
    doc.on('vnm-add', 'click', () => insert('say'));
    doc.on('vnm-del', 'click', del);
    doc.on('vnm-up', 'click', () => move(-1));
    doc.on('vnm-down', 'click', () => move(1));
    doc.on('vnm-dup', 'click', duplicate);
    doc.on('vnm-apply', 'click', applyInspector);
    doc.on('vnm-new', 'click', () => browseNewScene());
    doc.on('vnm-find', 'click', () => search(doc.value('vnm-search')));
    doc.on('vnm-scenes', 'click', (id, ev, key) => { if (key) openScene(key); });
    doc.on('vnm-labels', 'click', (id, ev, key) => { const list = visible(); const i = list.findIndex((c) => c.kind === 'label' && c.text === key); if (i >= 0) select(i); });
    doc.on('vnm-commands', 'click', (id, ev, key) => select(key));
    doc.on('vnm-results', 'click', (id, ev, key) => {
        const h = s.searchHits[Number(key)]; if (!h) return;
        const tab = openScene(h.path);
        if (tab && tab.inst) tab.inst.navigateDiagnostic({ location: { line: h.idx + 1 } });
        else if (tab) tab.problemTarget = { location: { line: h.idx + 1 } };
    });
    function commitSource() { return edit('исходник', String(doc.value('vnm-source-buffer') || '')); }
    doc.on('vnm-source-buffer', 'change', commitSource);
    for (const [id, kind] of Object.entries({ choice: 'choice', jump: 'flow', label: 'label', image: 'image' })) doc.on('vnm-add-' + id, 'click', () => insert(kind));
    doc.on('vnm-graph-view', 'click', (id, ev, index) => { s.mode = 'commands'; select(index); renderAll(); });
    doc.on('vnm-diag', 'click', (id, ev, index) => navigateDiagnostic(diagnostics()[Number(index)]));
    doc.on('vnm-assets', 'click', (id, ev, path) => { if (path) { if (s.pickTarget) pickAsset(path); else host.openWith(at(path), null); } });
    doc.on('vnm-i18n', 'click', (id, ev, file) => { if (file) selectI18n(file); });
    doc.on('vnm-i18n-save', 'click', saveI18n);
    // These fields have no per-command representation in the current DSL.
    for (const field of ['vnm-f-slot', 'vnm-f-voice']) {
        doc.attr(field, 'disabled', 'disabled');
        doc.attr(field, 'title', 'Настройка персонажа в speakers.json, не поле команды .scene');
    }

    function drag() {
        if (!s.active || s.mode !== 'commands') return;
        const m = mousePx($); const down = $.input.mouseDown('left');
        if (down && s.dragFrom < 0) {
            const list = visible();
            for (let i = 0; i < list.length; i++) {
                const r = doc.rect('vnm-cmd-' + i); if (r && m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) { s.dragFrom = i; break; }
            }
        } else if (!down && s.dragFrom >= 0) {
            const from = s.dragFrom; s.dragFrom = -1;
            const list = visible(); let to = -1;
            for (let i = 0; i < list.length; i++) {
                const r = doc.rect('vnm-cmd-' + i); if (r && m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) { to = i; break; }
            }
            if (to >= 0 && to !== from) {
                const fromLine = list[from].index, toLine = list[to].index;
                edit('перемещение', M.editSource(s.source, 'move', fromLine, toLine));
                s.sel = to; renderAll();
            }
        }
    }

    const ops = { select, insert, applyInspector, commitSource, delete: del, move, duplicate, search, validate,
        openScene, newScene, saveSpeakers, selectSpeaker, saveCharacter, findAssets, pickAsset, browseAsset, browseNewScene,
        selectTheme, saveTheme, validateTheme, selectI18n, saveI18n,
        setSource: (text) => edit('исходник', String(text)),
        listCommands: commandRows, playScene: () => previewSource(false), playFromHere: () => previewSource(true) };
    return {
        doc, state: s, ops, open: openFile, close, save, undo, redo,
        dirty: () => s.dirty,
        diagnostics, navigateDiagnostic, preview: previewModel, previewRunning, stopPreview,
        update(dt) {
            if (!s.active || closed) return;
            if (!host.typing()) {
                drag();
                if (key.pressed('delete') || key.pressed('backspace')) del();
            }
            void dt;
        },
        onActive(on) { s.active = !!on; s.dragFrom = -1; if (!on) stopPreview(); else renderAll(); },
        render: renderAll,
        snapshot() { return { active: s.active, scene: s.scenePath, file: s.scenePath, dirty: s.dirty,
            selectedCommand: s.sel, commandCount: visible().length, previewRunning: previewRunning(),
            previewIndex: s.previewLine, validation: s.validation, validationStale: !!s.validationStale }; },
        commands() { return [
            { label: 'Истории: проверить черновик', run: validate },
            { label: 'Истории: проиграть сцену', run: ops.playScene },
            { label: 'Истории: проиграть с выбранной строки', run: ops.playFromHere },
            { label: 'Истории: остановить предпросмотр', run: stopPreview },
        ]; },
    };
}
