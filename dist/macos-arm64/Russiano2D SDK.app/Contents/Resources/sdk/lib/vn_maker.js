// ===========================================================================
// Visual Novel Maker — редактор story/*.scene поверх существующего narrative
// runtime. Не второй интерпретатор: источник — обычный .scene, семантика —
// $.story / r2d-sdk story validate.
// ===========================================================================
import { escapeHtml } from './model.js';

let singleton;
export const standalone = true;

export async function open(app, args) {
    if (!singleton) singleton = create(app);
    return singleton.open(args || {});
}

function create(app) {
    const $ = app.$, doc = $.ui.doc('sdk/ui/vn_maker.rml');
    const s = {
        active: false, scenePath: '', source: '', lines: [], sel: -1,
        dirty: false, mode: 'commands', scenes: [], speakers: [], validation: null,
        preview: false, previewLine: -1, status: '', search: '',
        undo: [], redo: [], speakersPath: '', speakersJson: '', speakersData: { speakers: {} }, charSel: '',
        assets: [], pickTarget: '', searchHits: [], closeWarned: false, themes: [], themeSel: '', dragFrom: -1,
    };

    const dir = () => {
        const d = s.scenePath ? s.scenePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '') : 'story';
        return d || 'story';
    };
    const nameOf = (p) => p.split('/').pop();

    // --- source model -------------------------------------------------------
    function setSource(text, path) {
        s.source = String(text == null ? '' : text);
        s.lines = s.source.split('\n');
        if (s.lines.length && s.lines[s.lines.length - 1] === '') s.lines.pop();
        if (path != null) s.scenePath = path;
        s.sel = -1;
        s.dirty = false;
        s.validation = null;
        s.undo = []; s.redo = [];
        renderAll();
    }

    function blankLine(i) {
        const t = (s.lines[i] || '').trim();
        return !t || t.startsWith('#');
    }

    function parseLine(line) {
        const raw = line;
        const t = line.trim();
        if (!t) return { kind: 'raw', raw, text: '' };
        if (t.startsWith('#')) return { kind: 'comment', raw, text: t.slice(1).trim() };
        if (t.startsWith('@')) return { kind: 'directive', raw, text: t };
        if (t.startsWith('~')) return { kind: 'narration', raw, text: t.slice(1).trim() };
        if (t.startsWith(':')) return { kind: 'label', raw, text: t.slice(1).trim() };
        if (t.startsWith('-')) {
            const m = /^-\s*(.*?)(?:\s*->\s*(\S+))?\s*$/.exec(t);
            return { kind: 'choice', raw, text: m ? m[1] : t.slice(1).trim(), goto: m && m[2] ? m[2] : '' };
        }
        const say = /^([^:()]+?)(?:\s*\(([^)]*)\))?\s*:\s*(.*)$/.exec(t);
        if (say) return { kind: 'say', raw, speaker: say[1].trim(), expr: (say[2] || '').trim(), text: say[3] };
        const word = (t.split(/\s+/)[0] || '').toLowerCase();
        const known = ['set','if','goto','wait','end','camera','move','face','anim','ai','image','fade','sound','music','objective','bubble'];
        if (known.includes(word)) return { kind: word === 'set' || word === 'if' || word === 'goto' ? 'flow' : word, raw, text: t };
        return { kind: 'raw', raw, text: t };
    }

    function commands() {
        const out = [];
        s.lines.forEach((line, i) => {
            if (blankLine(i)) return;
            const c = parseLine(line);
            c.index = i;
            out.push(c);
        });
        return out;
    }

    const visible = () => commands();

    function renderLine(c) {
        switch (c.kind) {
            case 'say': return c.speaker + (c.expr ? ' (' + c.expr + ')' : '') + ': ' + (c.text || '');
            case 'narration': return '~ ' + (c.text || '');
            case 'label': return ':' + (c.text || '').replace(/^:/, '');
            case 'choice': return '- ' + (c.text || '') + (c.goto ? ' -> ' + c.goto : '');
            default: return c.raw || c.text || '';
        }
    }

    function patchSource() {
        s.source = s.lines.join('\n');
        s.dirty = true; s.closeWarned = false;
        renderAll();
    }

    function snapshot() { return { source: s.source, scenePath: s.scenePath }; }
    function record() { s.undo.push(snapshot()); if (s.undo.length > 80) s.undo.shift(); s.redo = []; }
    function restore(st) { s.source = st.source; s.scenePath = st.scenePath; s.lines = s.source.split('\n'); if (s.lines.length && s.lines[s.lines.length-1] === '') s.lines.pop(); s.dirty = true; renderAll(); }
    function undo() { if (!s.undo.length) return false; s.redo.push(snapshot()); restore(s.undo.pop()); return true; }
    function redo() { if (!s.redo.length) return false; s.undo.push(snapshot()); restore(s.redo.pop()); return true; }

    // --- files --------------------------------------------------------------
    function listDir(path) {
        try { return $.fs.list(path) || []; } catch (_) { return []; }
    }
    function collectScenes(root, out) {
        out = out || [];
        for (const name of listDir(root)) {
            if (!name || name === '.' || name === '..') continue;
            const p = root + '/' + name;
            if (/\.scene$/i.test(name)) out.push(p);
            else if (!/\.[a-z0-9]+$/i.test(name)) collectScenes(p, out);
        }
        return out;
    }
    function readText(path) { try { return $.fs.readText(path); } catch (_) { return null; } }
    function writeText(path, text) { try { return $.fs.write(path, text) !== false; } catch (_) { return false; } }

    function loadScenes() {
        s.scenes = collectScenes('story');
        if (!s.scenes.length) s.scenes = collectScenes('game/story');
        s.scenePath = s.scenePath || s.scenes[0] || '';
        if (s.scenePath) {
            const t = readText(s.scenePath);
            if (t != null) { s.source = t; s.lines = t.split('\n'); if (s.lines[s.lines.length-1] === '') s.lines.pop(); }
        }
        s.speakersPath = readText('story/speakers.json') != null ? 'story/speakers.json' : (readText('game/story/speakers.json') != null ? 'game/story/speakers.json' : 'story/speakers.json');
        s.speakersJson = readText(s.speakersPath) || '{\n  "speakers": {}\n}\n';
        const sp = s.speakersJson;
        s.speakers = [];
        s.speakersData = { speakers: {} };
        if (sp) { try { const j = JSON.parse(sp); s.speakersData = j; for (const k of Object.keys(j.speakers || {})) s.speakers.push(k); } catch (_) {} }
        renderAll();
    }

    // --- rendering ----------------------------------------------------------
    function renderScenes() {
        if (!s.scenes.length) { doc.html('vnm-scenes', '<div class="hint">Нет story/*.scene. Создайте новый.</div>'); return; }
        doc.html('vnm-scenes', s.scenes.map((p) => '<div class="vnm-item' + (p === s.scenePath ? ' active' : '') + '" data-key="' + escapeHtml(p) + '">' + escapeHtml(p.replace(/^story\//, '')) + '</div>').join(''));
    }
    function renderLabels() {
        const labels = visible().filter((c) => c.kind === 'label');
        doc.html('vnm-labels', labels.length ? labels.map((c) => '<div class="vnm-item" data-label="' + escapeHtml(c.text) + '">:' + escapeHtml(c.text) + '</div>').join('') : '<div class="hint">Меток нет.</div>');
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
        if (!writeText(s.themeRcssPath, text)) { s.status = 'не удалось записать ' + s.themeRcssPath; renderAll(); return false; }
        s.themeRcss = text; s.status = 'тема сохранена'; renderAll(); return true;
    }
    async function validateTheme() {
        if (!s.themeSel) { s.status = 'тема не выбрана'; renderAll(); return false; }
        try { const r = await app.backend(['dialog', 'validate', s.themeSel], 'VN theme'); s.themeReport = r.json || {}; }
        catch (e) { s.themeReport = { diagnostics: [{ severity: 'error', message: e.message }] }; }
        const d = (s.themeReport.diagnostics || []);
        doc.text('vnm-theme-info', d.length ? ('ошибок: ' + d.length + ' — ' + d[0].message) : 'тема валидна');
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
                c.kind === 'choice' ? escapeHtml(c.text || '') + (c.goto ? ' → ' + escapeHtml(c.goto) : '') :
                escapeHtml(c.kind === 'raw' ? c.raw : (c.text || ''));
            return '<div class="vnm-cmd' + (i === s.sel ? ' active' : '') + '" data-key="' + i + '">' +
                '<div class="vnm-head">' + escapeHtml(String(c.kind).toUpperCase()) +
                (c.speaker ? ' · ' + escapeHtml(c.speaker) : '') + (c.expr ? ' [' + escapeHtml(c.expr) + ']' : '') +
                (c.goto && c.kind !== 'choice' ? ' → ' + escapeHtml(c.goto) : '') + '</div>' +
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
    }
    function renderDiag() {
        const d = s.validation;
        const list = d ? (d.diagnostics || d.errors || []) : [];
        doc.html('vnm-diag', list.length ? list.map((x) => '<div class="diag">' + escapeHtml(String(x.severity || 'error')) + ': ' + escapeHtml(String(x.message || x.code || x)) + '</div>').join('') : '<div class="hint">Проверка не запускалась.</div>');
    }
    function renderAll() {
        if (!s.active) return;
        renderScenes(); renderLabels(); renderSpeakers(); renderCommands(); renderInspector(); renderDiag(); renderThemes(); renderEnv();
        doc.text('vnm-scene-name', s.scenePath || '—');
        doc.text('vnm-state', s.dirty ? 'не сохранено' : (s.status || ''));
        doc.text('vnm-search', s.search || '');
        doc.style('vnm-commands', 'display', s.mode === 'commands' ? 'block' : 'none');
        doc.style('vnm-source', 'display', s.mode === 'source' ? 'block' : 'none');
        if (s.mode === 'source') doc.setValue('vnm-source', s.source);
    }

    // --- operations ---------------------------------------------------------
    function select(i) { s.sel = Number(i); renderCommands(); renderInspector(); return s.sel; }
    function openScene(path) {
        const t = readText(path);
        if (t == null) { s.status = 'нет файла ' + path; renderAll(); return false; }
        setSource(t, path); doc.setValue('vnm-source', s.source); return true;
    }
    function newScene(path) {
        path = path || ('story/' + (nameOf(s.scenePath || 'story/new.scene') === 'new.scene' ? 'new.scene' : 'new.scene'));
        const text = '# Новая сцена\n~ Начало.\n\n:start\nNarrator: Привет.\n- Да -> yes\n- Нет -> no\n\n:yes\n~ Конец.\nend\n\n:no\n~ Конец.\nend\n';
        if (readText(path) != null) { s.status = 'файл уже существует: ' + path; renderAll(); return false; }
        if (writeText(path, text)) { s.scenes = collectScenes('story'); setSource(text, path); return true; }
        s.status = 'не удалось создать ' + path; renderAll(); return false;
    }
    function save() {
        if (!s.scenePath) return false;
        if (s.mode === 'source') { s.source = String(doc.value('vnm-source') || ''); s.lines = s.source.split('\n'); }
        if (!writeText(s.scenePath, s.source)) { s.status = 'ошибка записи'; renderAll(); return false; }
        s.dirty = false; s.status = 'сохранено'; renderAll(); return true;
    }
    function currentCommand() { return visible()[s.sel]; }
    function applyInspector() {
        const c = currentCommand(); if (!c) return false;
        record();
        const kind = String(doc.value('vnm-f-kind') || c.kind).trim();
        let line;
        if (kind === 'say') line = String(doc.value('vnm-f-speaker') || '').trim() + (String(doc.value('vnm-f-expr') || '').trim() ? ' (' + String(doc.value('vnm-f-expr')).trim() + ')' : '') + ': ' + String(doc.value('vnm-f-text') || '');
        else if (kind === 'narration') line = '~ ' + String(doc.value('vnm-f-text') || '');
        else if (kind === 'label') line = ':' + String(doc.value('vnm-f-text') || '');
        else if (kind === 'choice') line = '- ' + String(doc.value('vnm-f-text') || '') + (String(doc.value('vnm-f-goto') || '').trim() ? ' -> ' + String(doc.value('vnm-f-goto')).trim() : '');
        else line = String(doc.value('vnm-f-raw') || doc.value('vnm-f-text') || c.raw || '');
        s.lines[c.index] = line; patchSource(); renderInspector(); return true;
    }
    function insert(kind) {
        const templates = { say: 'Narrator: Текст', narration: '~ Текст', choice: '- Да -> yes', label: ':label', flow: 'goto label', image: 'image art/bg.png 0.4', sound: 'sound sfx/click.ogg', wait: 'wait 1.0', raw: '# комментарий' };
        const line = templates[kind] || templates.raw;
        record();
        const list = visible(); const c = list[s.sel];
        const at = c ? c.index + 1 : s.lines.length;
        s.lines.splice(at, 0, line); s.sel = list.length ? s.sel + 1 : 0; patchSource(); return true;
    }
    function del() { const c = currentCommand(); if (!c) return false; record(); s.lines.splice(c.index, 1); if (s.sel >= visible().length) s.sel = visible().length - 1; patchSource(); return true; }
    function move(delta) { const list = visible(); const c = list[s.sel]; const o = list[s.sel + delta]; if (!c || !o) return false; record(); const t = s.lines[c.index]; s.lines[c.index] = s.lines[o.index]; s.lines[o.index] = t; s.sel += delta; patchSource(); return true; }
    function duplicate() { const c = currentCommand(); if (!c) return false; record(); s.lines.splice(c.index + 1, 0, s.lines[c.index]); s.sel += 1; patchSource(); return true; }

    async function validate() {
        const target = dir();
        try { const r = await app.backend(['story', 'validate', target], 'VN validate'); s.validation = r.json || { diagnostics: [] }; }
        catch (e) { s.validation = { diagnostics: [{ severity: 'error', message: e.message }] }; }
        s.status = 'проверено'; renderDiag(); return s.validation;
    }

    function previewSource(from) {
        if (s.dirty) save();
        const c = currentCommand();
        let text = s.source;
        if (from) { const at = c ? c.index : 0; text = '@free\n' + s.lines.slice(at).join('\n'); }
        try { $.story.play({ text }, { free: true }); s.preview = true; s.previewLine = c ? c.index : -1; return true; }
        catch (e) { s.status = 'preview: ' + e.message; renderAll(); return false; }
    }
    function stopPreview() { try { $.story.stop(); } catch (_) {} s.preview = false; return true; }

    function search(q) {
        s.search = String(q || '').toLowerCase();
        const hits = [];
        if (s.search) for (const path of s.scenes) {
            const text = readText(path); if (text == null) continue;
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
        if (!writeText(s.speakersPath, s.speakersJson)) { s.status = 'не удалось записать ' + s.speakersPath; renderAll(); return false; }
        s.speakers = Object.keys(old); s.status = 'персонаж сохранён'; renderAll(); return true;
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
        doc.setValue(target, path); s.status = 'выбран ' + path; renderAll(); return true;
    }

    function saveSpeakers() {
        const text = String(doc.value('vnm-speakers-json') || '');
        try { JSON.parse(text); } catch (e) { s.status = 'speakers.json: ' + e.message; renderAll(); return false; }
        if (!writeText(s.speakersPath, text)) { s.status = 'не удалось записать ' + s.speakersPath; renderAll(); return false; }
        s.speakersJson = text;
        try { const j = JSON.parse(text); s.speakers = Object.keys(j.speakers || {}); } catch (_) {}
        s.status = 'персонажи сохранены'; renderAll(); return true;
    }

    function openOpts(args) {
        s.active = true; if (app.doc) app.doc.hide(); doc.show();
        if (args && args.asset) s.scenePath = String(args.asset);
        loadScenes();
        if (s.scenePath && !s.source) openScene(s.scenePath);
        return panel;
    }
    function close() { if (s.dirty && !s.closeWarned) { s.closeWarned = true; s.status = 'не сохранено: нажмите «К SDK» ещё раз'; renderAll(); return false; } s.active = false; doc.hide(); app.closeTool(); return true; }

    doc.on('vnm-back', 'click', close);
    doc.on('vnm-save', 'click', save);
    doc.on('vnm-undo', 'click', undo);
    doc.on('vnm-redo', 'click', redo);
    doc.on('vnm-speakers-save', 'click', saveSpeakers);
    doc.on('vnm-speakers', 'click', (id, ev, key) => { if (key) selectSpeaker(key); });
    doc.on('vnm-ch-save', 'click', saveCharacter);
    doc.on('vnm-pick-asset', 'click', () => { s.pickTarget = 'asset'; findAssets(); });
    doc.on('vnm-pick-voice', 'click', () => { s.pickTarget = 'voice'; findAssets(); });
    doc.on('vnm-asset-find', 'click', () => findAssets());
    doc.on('vnm-themes', 'click', (id, ev, key) => { if (key) selectTheme(key); });
    doc.on('vnm-theme-open', 'click', () => { if (s.themeSel) app.openTool('rmlui-studio', { asset: s.themeSel }); });
    doc.on('vnm-theme-validate', 'click', validateTheme);
    doc.on('vnm-theme-save', 'click', saveTheme);
    doc.on('vnm-graph', 'click', () => { s.mode = s.mode === 'graph' ? 'commands' : 'graph'; renderAll(); });
    doc.on('vnm-validate', 'click', validate);
    doc.on('vnm-play', 'click', () => previewSource(false));
    doc.on('vnm-from', 'click', () => previewSource(true));
    doc.on('vnm-stop', 'click', stopPreview);
    doc.on('vnm-source', 'click', () => { s.mode = s.mode === 'source' ? 'commands' : 'source'; renderAll(); });
    doc.on('vnm-add', 'click', () => insert('say'));
    doc.on('vnm-del', 'click', del);
    doc.on('vnm-up', 'click', () => move(-1));
    doc.on('vnm-down', 'click', () => move(1));
    doc.on('vnm-dup', 'click', duplicate);
    doc.on('vnm-apply', 'click', applyInspector);
    doc.on('vnm-new', 'click', () => newScene(String(doc.value('vnm-new-path') || 'story/new.scene')));
    doc.on('vnm-find', 'click', () => search(doc.value('vnm-search')));
    doc.on('vnm-scenes', 'click', (id, ev, key) => { if (key) { if (s.dirty && !save()) return; openScene(key); } });
    doc.on('vnm-labels', 'click', (id, ev, key) => { const list = visible(); const i = list.findIndex((c) => c.kind === 'label' && c.text === key); if (i >= 0) select(i); });
    doc.on('vnm-commands', 'click', (id, ev, key) => select(key));
    doc.on('vnm-results', 'click', (id, ev, key) => {
        const h = s.searchHits[Number(key)]; if (!h) return;
        openScene(h.path);
        const list = visible(); const i = list.findIndex((c) => c.index === h.idx); if (i >= 0) select(i);
    });
    doc.on('vnm-source', 'change', () => {
        const next = String(doc.value('vnm-source') || '');
        if (next === s.source) return;
        s.undo.push({ source: s.source, scenePath: s.scenePath }); if (s.undo.length > 80) s.undo.shift(); s.redo = [];
        s.source = next; s.lines = next.split('\n'); s.dirty = true; s.closeWarned = false;
    });

    function drag() {
        if (!s.active || s.mode !== 'commands') return;
        const m = $.input.mouse(); const down = $.input.mouseDown('left');
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
                record();
                const fromLine = list[from].index, toLine = list[to].index;
                const line = s.lines.splice(fromLine, 1)[0];
                s.lines.splice(toLine, 0, line);
                s.sel = to; patchSource();
            }
        }
    }

    function keys() {
        if (!s.active) return;
        const mod = $.input.ctrlDown() || $.input.down('cmd');
        if (!mod) return;
        if ($.input.pressed('s')) save();
        else if ($.input.pressed('z')) { if ($.input.shiftDown()) redo(); else undo(); }
        else if ($.input.pressed('f')) { s.status = 'поиск: ' + (s.search || ''); renderAll(); }
    }
    $.update(() => { keys(); drag(); });

    const panel = {
        state: s, open: openOpts, close,
        setSource, openScene, newScene, save, validate, select, undo, redo, saveSpeakers,
        insert, update: applyInspector, delete: del, move, duplicate,
        listScenes: () => s.scenes.slice(), listLabels: () => visible().filter((c) => c.kind === 'label').map((c) => c.text),
        search, playScene: () => previewSource(false), playFromHere: () => previewSource(true), stopPreview,
        listSpeakers: () => s.speakers.slice(), selectSpeaker, saveCharacter, findAssets, pickAsset, listThemes: () => s.themes.slice(), snapshot() { return { active: s.active, scene: s.scenePath, dirty: s.dirty, selectedCommand: s.sel, commandCount: visible().length, previewRunning: s.preview, previewIndex: s.previewLine, validation: s.validation }; },
    };
    app.studios['vn-maker'] = panel;
    return panel;
}
