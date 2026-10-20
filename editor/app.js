// ===========================================================================
// Russiano2D Editor — оболочка IDE (docs/EDITOR.md).
//
// Обычный проект R2D: интерфейс — RmlUi (editor/ui), логика — публичный `$`,
// тяжёлые операции — команды того же бинарника r2d через мост $.sdk
// (`r2d assets/lint/validate/build/new/templates`, игра — `r2d --game`).
// Второго линтера, валидатора или формата здесь нет: Editor показывает и
// редактирует обычные файлы проекта.
// ===========================================================================

import { createCodeModel } from './lib/code_model.js';
import { createCodeView } from './lib/code_view.js';
import { languageOf, escapeRml } from './lib/highlight.js';
import { fuzzyFilter } from './lib/fuzzy.js';
import { createStudioHost, studioFor, studioById, studiosFor } from './lib/studios.js';

const DOC = 'ui/editor.rml';
const STATE_FILE = 'state.local.json';
const TEXT_EXT = ['.js', '.mjs', '.json', '.rml', '.rcss', '.css', '.md', '.txt', '.scene', '.glsl',
                  '.frag', '.vert', '.xml', '.csv', '.tsv', '.html', '.re2dmap', '.ini', '.yml', '.yaml'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
const MAX_LOG = 20000;

const esc = escapeRml;
const ext = (p) => { const m = /(\.[^./]+)$/.exec(String(p).toLowerCase()); return m ? m[1] : ''; };
const baseName = (p) => String(p).split('/').pop();
const dirName = (p) => { const i = String(p).lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };

export function createEditor($) {
    const doc = $.ui.doc(DOC);
    const code = createCodeView($, doc);
    const icon = (name) => $.ui.icon(name) || '';
    const studios = createStudioHost($, {
        log: (t) => log(t), setStatus: (t, k) => setStatus(t, k),
        run: (opts) => run(opts), stop: () => stop(),
        projectRoot: () => (s.project ? s.project.abs : ''),
        fullPreview: (tab) => enterFullPreview(tab),
        openWith: (path, id) => openFile(rel(String(path)), 0, 0, id),
        // Студия Editor сообщила о правке/проверке: вкладка, Problems, статус.
        changed: (tab) => {
            const dirty = !!(tab.inst && tab.inst.dirty && tab.inst.dirty());
            if (dirty !== tab.dirty) { tab.dirty = dirty; renderTabs(); }
            renderBottom(); renderStatus();
        },
        // Набор текста (поле RmlUi, палитра, поиск) — горячие клавиши студий молчат.
        typing: () => $.ui.typing() || !!s.palette || s.focus === 'find',
    });

    // Проигрывание студии на весь кадр (VN: $.story рисует под RmlUi):
    // документы Editor скрыты до Esc.
    function enterFullPreview(tab) {
        s.fullPreview = tab;
        doc.hide();
        studios.show(tab, false);
    }
    function leaveFullPreview() {
        const tab = s.fullPreview;
        s.fullPreview = null;
        if (tab && tab.api && tab.api.stopPreview) tab.api.stopPreview();
        doc.show();
        if (tab && s.active === tab.id) { studios.show(tab, true); studios.front(tab); tab.placed = null; }
        setStatus('проигрывание остановлено', '');
    }

    const s = {
        project: null,          // { abs, title, version, width, height, json }
        entries: [],            // r2d assets: [{ path, type, size, tool }]
        expanded: new Set(['']),
        selectedPath: null,
        tabs: [],               // { id, path, kind, model?, scroll?, info? }
        active: null,
        history: [], histAt: -1,
        diags: new Map(),       // путь (относительно проекта) → [diag]
        projectDiags: [],
        bottom: 'problems', bottomCollapsed: false, sidebarHidden: false,
        side: 'project',
        focus: 'none',          // 'code' | 'palette' | 'find' | 'search' | 'none'
        palette: null,          // { mode, items, list, sel, query }
        run: null,              // { handle, running, exit, output, polledAt }
        output: '', consoleLog: '',
        status: '', statusKind: '',
        recent: [], templates: [],
        busy: 0,
        lastTreeHtml: '',
    };

    // --- состояние на диске ---------------------------------------------------

    function loadState() {
        const st = $.fs.readJSON(STATE_FILE, null);
        if (st && Array.isArray(st.recent)) s.recent = st.recent.filter((r) => r && r.abs);
    }
    function saveState() {
        $.fs.writeJSON(STATE_FILE, { version: 1, recent: s.recent.slice(0, 12) });
    }

    function log(text) {
        s.consoleLog += text + '\n';
        if (s.consoleLog.length > MAX_LOG) s.consoleLog = s.consoleLog.slice(-MAX_LOG);
        if (s.bottom === 'console') renderBottom();
    }
    function setStatus(text, kind) {
        s.status = text; s.statusKind = kind || '';
        doc.text('st-msg', esc(text));
        doc.cls('st-msg', 'ok', kind === 'ok');
        doc.cls('st-msg', 'err', kind === 'err');
    }

    async function tool(args) {
        s.busy++;
        try {
            const res = await $.sdk.tool(args);
            if (!res.json) log('r2d ' + args.join(' ') + ' → ' + (res.error || 'нет JSON'));
            return res;
        } finally { s.busy--; }
    }

    // --- пути -----------------------------------------------------------------

    function absPath(input) {
        const p = String(input || '').trim().replace(/\/+$/, '');
        if (!p) return '';
        if (p[0] === '/' || /^[A-Za-z]:[\\/]/.test(p)) return p;
        const base = String($.fs.basePath() || '').replace(/\/+$/, '');
        return base ? base + '/' + p : p;
    }
    const rel = (abs) => s.project && abs.startsWith(s.project.abs + '/') ? abs.slice(s.project.abs.length + 1) : abs;
    const full = (relPath) => s.project.abs + '/' + relPath;

    // --- Project Manager ------------------------------------------------------

    function showPM(error) {
        doc.cls('pm', 'hidden', false);
        doc.cls('app', 'hidden', true);
        doc.text('pm-error', esc(error || ''));
        doc.html('pm-recent', s.recent.length ? s.recent.map((r) =>
            '<div class="pm-row" data-key="' + esc(r.abs) + '"><span class="pm-title">' + esc(r.title || baseName(r.abs)) +
            '</span><span class="pm-path">' + esc(r.abs) + '</span></div>').join('')
            : '<span class="empty">Недавних проектов нет. Укажите путь слева.</span>');
        renderTemplates();
        if (!s.templates.length) loadTemplates();
    }

    async function loadTemplates() {
        const res = await tool(['templates']);
        s.templates = res.json && Array.isArray(res.json.templates) ? res.json.templates : [];
        renderTemplates();
    }
    function renderTemplates() {
        doc.html('pm-templates', s.templates.length ? s.templates.map((t) =>
            '<div class="pm-row" data-key="' + esc(t.id) + '"><span class="pm-title">' + esc(t.name || t.id) +
            '</span><span class="pm-path">' + esc(t.description || '') + '</span></div>').join('')
            : '<span class="empty">Шаблоны загружаются…</span>');
    }

    async function createFromTemplate(id) {
        const dest = absPath(doc.value('pm-new-path'));
        if (!dest) { doc.text('pm-error', 'Укажите каталог нового проекта слева.'); return; }
        const res = await tool(['new', id, dest]);
        if (!res.ok) {
            const d = res.json && res.json.diagnostics && res.json.diagnostics[0];
            doc.text('pm-error', esc(d ? d.code + ': ' + d.message : (res.error || 'не удалось создать проект')));
            return;
        }
        await openProject(dest);
    }

    // --- проект и дерево --------------------------------------------------------

    async function openProject(input) {
        const abs = absPath(input);
        const json = $.fs.readJSON(abs + '/project.json', null);
        if (!json) { showPM('В «' + abs + '» нет project.json (или он не читается).'); return false; }
        closeAllTabs(true);
        s.project = { abs, title: json.title || baseName(abs), version: json.version || '', width: json.width, height: json.height, json };
        s.recent = [{ abs, title: s.project.title }].concat(s.recent.filter((r) => r.abs !== abs));
        saveState();
        doc.cls('pm', 'hidden', true);
        doc.cls('app', 'hidden', false);
        doc.html('tb-project', esc(s.project.title) + ' ' + icon('expand_more'));
        doc.text('st-project', esc(s.project.title));
        $.window.title(s.project.title + ' — Russiano2D Editor');
        await refreshTree();
        const entry = $.fs.exists(abs + '/main.js') ? 'main.js' : null;
        if (entry) openFile(entry);
        renderAll();
        setStatus('проект открыт: ' + abs, 'ok');
        return true;
    }

    async function refreshTree() {
        if (!s.project) return;
        const res = await tool(['assets', s.project.abs]);
        s.entries = res.json && Array.isArray(res.json.entries) ? res.json.entries : [];
        if (res.json && res.json.truncated) log('Дерево проекта обрезано backend\'ом (truncated).');
        renderTree();
    }

    function buildTree() {
        const root = { name: '', path: '', dirs: new Map(), files: [] };
        for (const e of s.entries) {
            const parts = e.path.split('/');
            let node = root;
            for (let i = 0; i < parts.length - 1; i++) {
                const path = parts.slice(0, i + 1).join('/');
                if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], path, dirs: new Map(), files: [] });
                node = node.dirs.get(parts[i]);
            }
            node.files.push(e);
        }
        return root;
    }

    function fileIcon(e) {
        const x = ext(e.path);
        if (x === '.js' || x === '.mjs') return ['javascript', 'js'];
        if (x === '.json') return [e.tool ? 'extension' : 'data_object', e.tool ? 'studio' : 'json'];
        if (IMAGE_EXT.includes(x)) return ['image', 'img'];
        if (x === '.rml' || x === '.rcss') return ['web', ''];
        if (x === '.re2dmap') return ['map', 'studio'];
        if (x === '.ogg' || x === '.wav' || x === '.mp3') return ['audiotrack', ''];
        if (x === '.ttf' || x === '.otf') return ['text_fields', ''];
        return ['description', ''];
    }

    function renderTree() {
        if (!s.project) return;
        const rows = [];
        const openPaths = new Set(s.tabs.map((t) => t.path));
        const walk = (node, depth) => {
            const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
            for (const d of dirs) {
                const open = s.expanded.has(d.path);
                rows.push('<div class="tree-row" data-key="d:' + esc(d.path) + '" style="padding-left: ' + (8 + depth * 14) + 'px;">' +
                    '<span class="tree-ico folder">' + icon(open ? 'expand_more' : 'chevron_right') + '</span>' +
                    '<span class="tree-ico folder">' + icon(open ? 'folder_open' : 'folder') + '</span>' + esc(d.name) + '</div>');
                if (open) walk(d, depth + 1);
            }
            const files = node.files.slice().sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)));
            for (const f of files) {
                const [ic, cls] = fileIcon(f);
                const sel = f.path === s.selectedPath ? ' sel' : openPaths.has(f.path) ? ' open-file' : '';
                rows.push('<div class="tree-row' + sel + '" data-key="f:' + esc(f.path) + '" style="padding-left: ' + (26 + depth * 14) + 'px;">' +
                    '<span class="tree-ico ' + cls + '">' + icon(ic) + '</span>' + esc(baseName(f.path)) + '</div>');
            }
        };
        const tree = buildTree();
        rows.push('<div class="tree-row" data-key="d:" style="padding-left: 8px;"><span class="tree-ico folder">' +
            icon(s.expanded.has('') ? 'expand_more' : 'chevron_right') + '</span><span class="tree-ico folder">' + icon('folder') +
            '</span>' + esc(s.project.title) + '</div>');
        if (s.expanded.has('')) walk(tree, 1);
        const html = rows.join('');
        if (html !== s.lastTreeHtml) { s.lastTreeHtml = html; doc.html('side-body', html); }
    }

    // --- вкладки --------------------------------------------------------------

    function kindOf(path) {
        if (studioFor(path)) return 'studio';
        const x = ext(path);
        if (IMAGE_EXT.includes(x)) return 'image';
        if (TEXT_EXT.includes(x)) return 'code';
        return 'info';
    }

    // as: 'code' — текстом; id студии — в этой студии; иначе — по типу файла.
    function openFile(relPath, line, col, as) {
        if (!s.project) return null;
        let tab = s.tabs.find((t) => t.path === relPath);
        if (tab && as) {
            const resolved = as === 'code' ? null : studioById(as);
            const want = resolved ? resolved.id : as;
            const have = tab.kind === 'studio' ? tab.studio.id : tab.kind;
            if (want !== have) { closeTab(tab.id); if (s.tabs.includes(tab)) return tab; tab = null; }
        }
        if (!tab) {
            const asStudio = as && as !== 'code' ? studioById(as) : null;
            const kind = as === 'code' ? 'code' : asStudio ? 'studio' : kindOf(relPath);
            tab = { id: relPath, path: relPath, kind, scrollTop: 0 };
            if (kind === 'code') {
                const text = $.fs.readText(full(relPath));
                if (text === null || text === undefined) { setStatus('не удалось прочитать ' + relPath, 'err'); return null; }
                tab.model = createCodeModel(text);
                tab.lang = languageOf(relPath);
            }
            if (kind === 'studio') {
                const studio = asStudio || studioFor(relPath);
                tab.studio = studio;
                tab.abs = full(relPath);
                tab.loading = true;
                studios.open(tab).then(() => {
                    if (!s.tabs.includes(tab)) return;
                    tab.loading = false;
                    if (tab.problemTarget && tab.inst && tab.inst.navigateDiagnostic) { tab.inst.navigateDiagnostic(tab.problemTarget); tab.problemTarget = null; }
                    if (s.active === tab.id) { studios.setActive(tab, true); tab.placed = null; }
                    renderAll();
                }).catch((e) => {
                    tab.loading = false;
                    tab.error = e && e.message ? e.message : String(e);
                    log('студия ' + studio.id + ': ' + tab.error);
                    renderAll();
                });
            }
            s.tabs.push(tab);
            if (kind === 'code' && tab.lang === 'js') lintFile(tab);
        }
        activate(tab.id, true);
        if (line && tab.model) {
            tab.model.goto(line, col);
            code.ensureCaretVisible();
            focusCode();
        }
        return tab;
    }

    function activeTab() { return s.tabs.find((t) => t.id === s.active) || null; }

    function activate(id, pushHistory) {
        const prev = activeTab();
        if (prev && prev.model) prev.scrollTop = code.state.scrollTop;
        if (prev && prev.kind === 'studio' && prev.id !== id) studios.setActive(prev, false);
        s.active = id;
        const tab = activeTab();
        if (tab && tab.kind === 'studio' && tab.api) { studios.setActive(tab, true); tab.placed = null; s.focus = 'studio'; }
        s.selectedPath = tab ? tab.path : null;
        if (pushHistory && tab) {
            s.history = s.history.slice(0, s.histAt + 1).filter((h) => h !== id);
            s.history.push(id);
            s.histAt = s.history.length - 1;
        }
        if (tab && tab.model) {
            code.setModel(tab.model, tab.lang);
            code.state.scrollTop = tab.scrollTop || 0;
            code.setDiagnostics(s.diags.get(tab.path) || []);
            code.setFind('');
        }
        renderAll();
    }

    function closeTab(id, force) {
        const i = s.tabs.findIndex((t) => t.id === id);
        if (i < 0) return;
        const tab = s.tabs[i];
        if ((tab.model ? tab.model.dirty : tab.dirty) && !force) {
            // Потеря правок — единственный случай подтверждения (ТЗ).
            if (tab.confirmClose !== true) {
                tab.confirmClose = true;
                setStatus('«' + tab.path + '» не сохранён: Cmd/Ctrl+S — сохранить, повторное закрытие — выбросить правки', 'err');
                return;
            }
        }
        if (tab.kind === 'studio') studios.close(tab);
        s.tabs.splice(i, 1);
        s.history = s.history.filter((h) => h !== id);
        s.histAt = Math.min(s.histAt, s.history.length - 1);
        if (s.active === id) {
            const next = s.history[s.histAt] || (s.tabs[i] || s.tabs[i - 1] || {}).id || null;
            s.active = null;
            if (next) activate(next, false); else renderAll();
        } else renderAll();
    }

    function closeAllTabs(force) {
        for (const t of s.tabs.slice()) closeTab(t.id, force);
        s.tabs = []; s.active = null; s.history = []; s.histAt = -1; s.diags.clear(); s.projectDiags = [];
    }

    function navigate(delta) {
        const at = s.histAt + delta;
        if (at < 0 || at >= s.history.length) return;
        s.histAt = at;
        activate(s.history[at], false);
    }

    async function save(tab) {
        tab=tab||activeTab();
        if(!tab)return false;
        if(tab.kind==='studio') {
            if(!tab.api){setStatus('студия ещё не открыта: '+tab.path,'err');return false;}
            const ok=await studios.save(tab);
            if(ok)tab.confirmClose=false;
            setStatus(ok?'сохранено: '+tab.path:'не сохранено: '+tab.path,ok?'ok':'err');renderAll();return !!ok;
        }
        if(!tab.model)return false;
        if(!tab.model.dirty)return true;
        const ok=$.fs.write(full(tab.path),tab.model.text());
        if(!ok){setStatus('не удалось записать '+tab.path,'err');return false;}
        tab.model.markSaved();tab.confirmClose=false;
        if(tab.lang==='js')await lintFile(tab);
        if(tab.path==='project.json') {
            const json=$.fs.readJSON(full('project.json'),null);
            if(json)Object.assign(s.project,{title:json.title||s.project.title,version:json.version||'',width:json.width,height:json.height,json});
        }
        renderAll();return true;
    }
    async function saveAll() {
        let saved=0,failed=0;
        for(const t of s.tabs.slice())if((t.model&&t.model.dirty)||(t.kind==='studio'&&studios.dirty(t))) {
            if(await save(t))saved++;else failed++;
        }
        setStatus('сохранено: '+saved+(failed?' · ошибок: '+failed:''),failed?'err':'ok');return failed===0;
    }

    // --- диагностика ----------------------------------------------------------

    function normalizeDiag(d) {
        const asset = d.asset ? rel(String(d.asset)) : '';
        return { code: d.code || '', severity: d.severity === 'fatal' ? 'error' : (d.severity || 'info'), message: d.message || '',
                 file: asset, line: d.location && d.location.line ? d.location.line : 0, col: d.location && d.location.column ? d.location.column : 0 };
    }

    async function lintFile(tab) {
        // Линтер читает файл с диска: несохранённый буфер не проверяем, чтобы
        // Problems не показывали строки, которых в редакторе уже нет.
        if (!tab || tab.model.dirty) return;
        const res = await tool(['lint', full(tab.path)]);
        if (!res.json) return;
        const list = (res.json.diagnostics || []).map(normalizeDiag).map((d) => Object.assign(d, { file: tab.path }));
        s.diags.set(tab.path, list);
        if (activeTab() === tab) code.setDiagnostics(list);
        renderBottom();
        renderStatus();
    }

    async function validateProject() {
        if (!s.project) return;
        setStatus('проверка проекта…', '');
        const res = await tool(['validate', s.project.abs]);
        s.projectDiags = res.json ? (res.json.diagnostics || []).map(normalizeDiag) : [];
        for (const tab of s.tabs) if (tab.lang === 'js') await lintFile(tab);
        s.bottom = 'problems'; s.bottomCollapsed = false;
        renderBottom();
        const errors = allProblems().filter((d) => d.severity === 'error').length;
        setStatus(errors ? 'проверка: ошибок ' + errors : 'проверка: ошибок нет', errors ? 'err' : 'ok');
    }

    function allProblems() {
        const out = s.projectDiags.slice();
        for (const list of s.diags.values()) out.push(...list);
        for (const t of s.tabs) if (t.kind === 'studio') {
            for (const d of studios.diagnostics(t)) {
                const n = normalizeDiag(d);
                if (!n.file || n.file.startsWith('/')) n.file = t.path;   // вне проекта или без файла — к вкладке
                n.source = d;
                out.push(n);
            }
        }
        // Validate проекта и lint файла могут сообщить одно и то же: убираем дубли.
        const seen = new Set();
        return out.filter((d) => { const k = d.code + d.file + d.line + d.col + d.message; if (seen.has(k)) return false; seen.add(k); return true; });
    }

    // --- запуск ---------------------------------------------------------------

    function run(opts) {
        if (!s.project) return null;
        if (s.run && s.run.running) stop();
        const dirty = s.tabs.filter((t) => t.model && t.model.dirty);
        for (const t of dirty) save(t);
        s.output = '';
        const args = ['--game', s.project.abs];
        if (opts && opts.scene) args.push('--scene', String(opts.scene));
        if (opts && opts.frames) args.push('--frames', String(opts.frames));
        if (opts && opts.headless) args.push('--headless');
        const handle = $.sdk.launch(args);
        s.run = { handle, running: true, exit: null, polledAt: 0 };
        handle.done.then((r) => {
            if (!s.run || s.run.handle !== handle) return;
            s.run.running = false;
            s.run.exit = r.exitCode;
            if (r.output) s.output = tail(r.output);
            setStatus('игра завершилась: код ' + r.exitCode, r.exitCode === 0 ? 'ok' : 'err');
            renderAll();
        });
        s.bottom = 'output'; s.bottomCollapsed = false;
        setStatus('запуск: r2d --game ' + s.project.abs, 'ok');
        renderAll();
        return s.run;
    }

    function stop() {
        if (s.run && s.run.running) { s.run.handle.kill(); setStatus('игра остановлена', ''); }
    }

    function tail(text) { return text.length > MAX_LOG ? text.slice(-MAX_LOG) : text; }

    async function buildPackage() {
        if (!s.project) return;
        if (!(await saveAll())) { setStatus('сборка остановлена: не все файлы сохранены', 'err'); return; }
        const name = (s.project.title || 'game').replace(/[^\wЀ-ӿ.-]+/g, '_');
        const out = s.project.abs + '/dist/' + name;
        setStatus('сборка: validate → build…', '');
        const v = await tool(['validate', s.project.abs]);
        s.projectDiags = v.json ? (v.json.diagnostics || []).map(normalizeDiag) : [];
        if (v.json && v.json.errors) { s.bottom = 'problems'; renderBottom(); setStatus('сборка остановлена: проект с ошибками', 'err'); return; }
        const res = await tool(['build', s.project.abs, '--out', out]);
        s.output = (res.output || '') + '\n';
        s.bottom = 'output'; s.bottomCollapsed = false;
        renderBottom();
        setStatus(res.ok ? 'собрано: ' + out : 'сборка не удалась (см. Output)', res.ok ? 'ok' : 'err');
    }

    // --- палитра ----------------------------------------------------------------

    const COMMANDS = [
        { id: 'quickOpen', label: 'Перейти к файлу…', keys: 'Cmd/Ctrl+P', run: () => openPalette('files') },
        { id: 'save', label: 'Файл: сохранить', keys: 'Cmd/Ctrl+S', run: () => save() },
        { id: 'saveAll', label: 'Файл: сохранить все', keys: 'Cmd/Ctrl+Shift+S', run: () => saveAll() },
        { id: 'close', label: 'Файл: закрыть вкладку', keys: 'Cmd/Ctrl+W', run: () => s.active && closeTab(s.active) },
        { id: 'find', label: 'Правка: найти в файле', keys: 'Cmd/Ctrl+F', run: () => openFind() },
        { id: 'gotoLine', label: 'Правка: перейти к строке…', keys: 'Cmd/Ctrl+G', run: () => openPalette('line') },
        { id: 'undo', label: 'Правка: отменить', keys: 'Cmd/Ctrl+Z', run: () => { const t = activeTab(); if (t && t.inst) studios.undo(t); else if (t && t.model && t.model.undo()) changed(); } },
        { id: 'redo', label: 'Правка: повторить', keys: 'Cmd/Ctrl+Shift+Z', run: () => { const t = activeTab(); if (t && t.inst) studios.redo(t); else if (t && t.model && t.model.redo()) changed(); } },
        { id: 'run', label: 'Запуск: запустить игру', keys: 'F5', run: () => run() },
        { id: 'stop', label: 'Запуск: остановить', keys: 'Shift+F5', run: () => stop() },
        { id: 'validate', label: 'Проект: проверить (r2d validate)', keys: '', run: () => validateProject() },
        { id: 'build', label: 'Проект: собрать игру (validate → build)', keys: 'Cmd/Ctrl+Shift+B', run: () => buildPackage() },
        { id: 'refresh', label: 'Проект: обновить дерево файлов', keys: '', run: () => refreshTree() },
        { id: 'projects', label: 'Проект: открыть другой (Project Manager)', keys: '', run: () => { closeAllTabs(true); s.project = null; showPM(); } },
        { id: 'sidebar', label: 'Вид: боковая панель', keys: 'Cmd/Ctrl+B', run: () => { s.sidebarHidden = !s.sidebarHidden; renderLayout(); } },
        { id: 'panel', label: 'Вид: нижняя панель', keys: 'Cmd/Ctrl+J', run: () => { s.bottomCollapsed = !s.bottomCollapsed; renderLayout(); } },
        { id: 'problems', label: 'Вид: Problems', keys: '', run: () => { s.bottom = 'problems'; s.bottomCollapsed = false; renderAll(); } },
        { id: 'output', label: 'Вид: Output', keys: '', run: () => { s.bottom = 'output'; s.bottomCollapsed = false; renderAll(); } },
    ];

    // «Открыть как…» для файла активной вкладки: текст и все студии его типа.
    function openAsCommands() {
        const t = activeTab();
        if (!t) return [];
        const out = studios.commands(t).map((c) => ({ label: c.label, detail: '', cmd: c }));
        if (t.kind !== 'code' && TEXT_EXT.includes(ext(t.path))) out.push({ label: 'Открыть как: текст — ' + baseName(t.path), detail: '', cmd: { run: () => openFile(t.path, 0, 0, 'code') } });
        for (const st of studiosFor(t.path)) {
            if (t.kind === 'studio' && t.studio.id === st.id) continue;
            out.push({ label: 'Открыть как: ' + st.title + ' — ' + baseName(t.path), detail: '', cmd: { run: () => openFile(t.path, 0, 0, st.id) } });
        }
        return out;
    }

    function openPalette(mode) {
        const items = mode === 'commands'
            ? openAsCommands().concat(COMMANDS.map((c) => ({ label: c.label, detail: c.keys, cmd: c })))
            : mode === 'line' ? []
            : s.entries.map((e) => ({ label: e.path, detail: e.type, path: e.path }));
        s.palette = { mode, items, list: [], sel: 0, query: null };
        doc.setValue('palette-input', mode === 'commands' ? '>' : mode === 'line' ? ':' : '');
        doc.cls('palette', 'hidden', false);
        doc.front();                         // палитра — над встроенной студией
        doc.focus('palette-input');
        s.focus = 'palette';
        filterPalette();
    }

    function closePalette() {
        s.palette = null;
        doc.cls('palette', 'hidden', true);
        doc.focus('palette-input', false);
        const t = activeTab();
        if (t && t.kind === 'studio') studios.front(t);
        s.focus = t && t.model ? 'code' : t && t.kind === 'studio' ? 'studio' : 'none';
    }

    function filterPalette() {
        const p = s.palette;
        if (!p) return;
        let q = String(doc.value('palette-input') || '');
        if (q === p.query) return;
        p.query = q;
        // Префиксы как в VS Code: «>» — команды, «:» — строка.
        if (q.startsWith('>') && p.mode !== 'commands') { s.palette.mode = 'commands'; p.items = openAsCommands().concat(COMMANDS.map((c) => ({ label: c.label, detail: c.keys, cmd: c }))); }
        if (p.mode === 'commands') q = q.replace(/^>\s*/, '');
        if (q.startsWith(':') || p.mode === 'line') {
            p.mode = 'line';
            const n = parseInt(q.replace(/^:/, ''), 10);
            const t = activeTab();
            p.list = t && t.model && n > 0 ? [{ item: { label: 'Перейти к строке ' + n, line: n }, match: { hits: [] } }]
                : [{ item: { label: t && t.model ? 'Номер строки (1–' + t.model.lineCount() + ')' : 'Нет открытого файла' }, match: { hits: [] } }];
        } else {
            p.list = fuzzyFilter(q, p.items, (it) => it.label, 60);
        }
        p.sel = 0;
        renderPalette();
    }

    function renderPalette() {
        const p = s.palette;
        if (!p) return;
        doc.html('palette-list', p.list.length ? p.list.map((r, i) => {
            const label = r.item.label;
            const hits = new Set(r.match.hits || []);
            let text = '';
            for (let k = 0; k < label.length; k++) text += hits.has(k) ? '<span class="pal-hit">' + esc(label[k]) + '</span>' : esc(label[k]);
            return '<div class="pal-row' + (i === p.sel ? ' sel' : '') + '" data-key="' + i + '"><span class="pal-label">' + text +
                '</span><span class="pal-detail">' + esc(r.item.detail || '') + '</span></div>';
        }).join('') : '<span class="empty">Ничего не найдено</span>');
    }

    function acceptPalette(index) {
        const p = s.palette;
        if (!p) return;
        const r = p.list[index === undefined ? p.sel : index];
        closePalette();
        if (!r) return;
        if (r.item.cmd) r.item.cmd.run();
        else if (r.item.path) openFile(r.item.path);
        else if (r.item.line) { const t = activeTab(); if (t && t.model) { t.model.goto(r.item.line, 1); code.ensureCaretVisible(); focusCode(); } }
    }

    // --- поиск в файле ------------------------------------------------------------

    function openFind() {
        const t = activeTab();
        if (!t || !t.model) return;
        const sel = t.model.selectedText();
        if (sel && !/\n/.test(sel)) doc.setValue('find-input', sel);
        doc.cls('findbar', 'hidden', false);
        doc.focus('find-input');
        s.focus = 'find';
        s.findQuery = null;
    }
    function closeFind() {
        doc.cls('findbar', 'hidden', true);
        doc.focus('find-input', false);
        code.setFind('');
        focusCode();
    }
    function findStep(backwards) {
        const t = activeTab();
        if (!t || !t.model) return;
        const q = String(doc.value('find-input') || '');
        const r = t.model.findNext(q, backwards);
        doc.text('find-count', r ? (r.index + 1) + ' из ' + r.total : 'нет');
        code.ensureCaretVisible();
    }

    // --- отрисовка ------------------------------------------------------------------

    function renderTabs() {
        doc.html('tabs', s.tabs.map((t) => {
            const [ic, cls] = fileIcon({ path: t.path, tool: null });
            const dirty = t.model ? t.model.dirty : !!t.dirty;
            return '<span class="tab' + (t.id === s.active ? ' on' : '') + '" data-key="t:' + esc(t.id) + '">' +
                '<span class="tab-ico tree-ico ' + cls + '">' + icon(ic) + '</span>' + esc(baseName(t.path)) +
                '<span class="tab-x' + (dirty ? ' tab-dirty' : '') + '" data-key="x:' + esc(t.id) + '">' + icon(dirty ? 'circle' : 'close') + '</span></span>';
        }).join(''));
    }

    function renderHost() {
        const t = activeTab();
        doc.cls('welcome', 'hidden', !!t);
        doc.cls('code', 'hidden', !(t && t.model));
        doc.cls('pane', 'hidden', !(t && !t.model && (t.kind !== 'studio' || !t.api)));
        if (t && t.kind === 'studio') {
            if (!t.api) doc.html('pane', '<span class="info-line">' + (t.error ? 'Студия не открылась: ' + esc(t.error) : 'Открываю ' + esc(t.studio.title) + '…') + '</span>');
            return;
        }
        if (!t) {
            doc.html('welcome', '<h1>' + esc(s.project ? s.project.title : 'Russiano2D Editor') + '</h1>' +
                'Откройте файл в дереве проекта слева.' +
                '<span class="keys"><span class="kbd">Cmd/Ctrl+P</span> перейти к файлу &#160; <span class="kbd">Cmd/Ctrl+Shift+P</span> команды &#160; <span class="kbd">F5</span> запуск</span>');
            return;
        }
        if (t.model) { code.invalidate(); return; }
        const entry = s.entries.find((e) => e.path === t.path) || {};
        if (t.kind === 'image') {
            const size = $.gfx.textureSize(full(t.path)) || [0, 0];
            doc.html('pane', '<div class="img-view"><img src="' + esc(full(t.path)) + '" style="width: ' + (size[0] * 2) + 'px; height: ' + (size[1] * 2) + 'px;"/></div>' +
                '<span class="info-line">' + esc(t.path) + ' · ' + size[0] + '×' + size[1] + ' px · масштаб 2×</span>');
        } else {
            doc.html('pane', '<span class="info-line">' + esc(t.path) + '</span><span class="info-line">Тип: ' + esc(entry.type || '?') +
                ' · ' + (entry.size || 0) + ' байт</span><span class="info-line">Текстовый редактор для этого типа не открывается. ' +
                (entry.tool ? 'Специализированная студия «' + esc(entry.tool) + '» в Editor ещё не встроена.' : 'Редактора для этого типа нет.') + '</span>');
        }
    }

    function inspectorField(label, value, action) {
        return '<span class="insp-label">' + esc(label) + '</span>' +
            (action ? '<div class="insp-row"><span class="insp-value">' + esc(value) + '</span><span class="btn" data-key="' + esc(action) + '" style="margin-left: 0px;">Open</span></div>'
                : '<span class="insp-value">' + esc(value) + '</span>');
    }

    function renderInspector() {
        if (!s.project) return;
        const t = activeTab();
        let html = '<span class="insp-path">' + esc(t ? 'PROJECT / ' + t.path : 'PROJECT') + '</span><div class="insp-sec">';
        if (!t) {
            const p = s.project;
            html += inspectorField('Название', p.title) + inspectorField('Версия', p.version || '—') +
                inspectorField('Окно', (p.width || 1280) + ' × ' + (p.height || 720)) +
                inspectorField('Точка входа', 'main.js', 'open:main.js') +
                inspectorField('Манифест', 'project.json', 'open:project.json') +
                inspectorField('Файлов', String(s.entries.length));
        } else if (t.model) {
            const m = t.model, c = m.caret, list = s.diags.get(t.path) || [];
            html += inspectorField('Файл', t.path) + inspectorField('Язык', t.lang) +
                inspectorField('Строк', String(m.lineCount())) +
                inspectorField('Состояние', m.dirty ? 'изменён, не сохранён' : 'сохранён') +
                inspectorField('Проблемы', list.length ? list.filter((d) => d.severity === 'error').length + ' ошибок, ' + list.filter((d) => d.severity !== 'error').length + ' прочих' : 'нет');
            // Навигация по коду: сцены, зарегистрированные этим файлом ($.scene.add),
            // и узлы с id. Это поиск по тексту, а не модель сцены.
            const scenes = [], ids = [];
            m.lines.forEach((line, i) => {
                const sc = /\$\.scene\.add\(\s*['"]([^'"]+)['"]/.exec(line);
                if (sc) scenes.push({ name: sc[1], line: i + 1 });
                const id = /\bid\s*:\s*['"]([^'"]+)['"]/.exec(line);
                if (id && ids.length < 20) ids.push({ name: '#' + id[1], line: i + 1 });
            });
            if (scenes.length || ids.length) {
                html += '</div><div class="insp-sec"><span class="insp-label">В этом файле</span>';
                for (const x of scenes) html += '<div class="tree-row" data-key="line:' + x.line + '" style="padding-left: 4px;"><span class="tree-ico studio">' + icon('movie') + '</span>сцена ' + esc(x.name) + '<span class="muted"> · стр. ' + x.line + '</span></div>';
                for (const x of ids) html += '<div class="tree-row" data-key="line:' + x.line + '" style="padding-left: 4px;"><span class="tree-ico js">' + icon('tag') + '</span>' + esc(x.name) + '<span class="muted"> · стр. ' + x.line + '</span></div>';
                html += '<span class="insp-note">Найдено по тексту файла: $.scene.add(…) и id: …</span>';
            }
            void c;
        } else if (t.kind === 'studio') {
            html += inspectorField('Файл', t.path) + inspectorField('Студия', t.studio.title);
            for (const [label, value] of studios.summary(t)) html += inspectorField(label, value);
        } else {
            const entry = s.entries.find((e) => e.path === t.path) || {};
            html += inspectorField('Файл', t.path) + inspectorField('Тип', entry.type || '?') + inspectorField('Размер', (entry.size || 0) + ' байт') +
                (entry.tool ? inspectorField('Студия', entry.tool + ' (ещё не встроена)') : '');
        }
        html += '</div>';
        doc.html('insp-body', html);
    }

    function renderBottom() {
        const problems = allProblems();
        const errors = problems.filter((d) => d.severity === 'error').length;
        doc.text('prob-badge', String(problems.length));
        doc.cls('prob-badge', 'zero', problems.length === 0);
        for (const b of ['problems', 'output', 'console']) doc.cls('bt-' + b, 'on', s.bottom === b);
        doc.text('bt-toggle', icon(s.bottomCollapsed ? 'expand_less' : 'expand_more'));
        if (s.bottom === 'problems') {
            doc.html('bottom-body', problems.length
                ? '<div class="prob-head"><span class="c-type">Тип</span><span class="c-code">Код</span><span class="c-msg">Сообщение</span><span class="c-file">Файл</span><span class="c-num">Стр.</span><span class="c-num">Кол.</span></div>' +
                  problems.map((d, i) => '<div class="prob" data-key="' + i + '"><span class="c-type sev-' + d.severity + '">' +
                    icon(d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info') + '</span><span class="c-code">' + esc(d.code) +
                    '</span><span class="c-msg">' + esc(d.message) + '</span><span class="c-file">' + esc(d.file || '—') + '</span><span class="c-num">' +
                    (d.line || '') + '</span><span class="c-num">' + (d.col || '') + '</span></div>').join('')
                : '<span class="empty">Проблем нет. Проверка: сохранение .js (r2d lint) и команда «Проект: проверить».</span>');
            s.problemList = problems;
        } else if (s.bottom === 'output') {
            doc.html('bottom-body', s.output ? '<div class="log">' + esc(s.output) + '</div>' : '<span class="empty">Вывод игры появится после запуска (F5).</span>');
        } else {
            doc.html('bottom-body', s.consoleLog ? '<div class="log">' + esc(s.consoleLog) + '</div>' : '<span class="empty">Журнал Editor пуст.</span>');
        }
        void errors;
    }

    function renderStatus() {
        const t = activeTab();
        doc.text('st-dirty', t && t.model ? (t.model.dirty ? icon('circle') + ' не сохранён' : icon('check') + ' сохранён') : '');
        doc.text('st-runtime', s.run && s.run.running ? icon('play_arrow') + ' игра запущена' : s.run ? icon('stop') + ' игра остановлена' + (s.run.exit !== null ? ' (код ' + s.run.exit + ')' : '') : icon('radio_button_unchecked') + ' игра не запущена');
        if (t && t.model) {
            const c = t.model.caret, sel = t.model.selectedText();
            doc.text('st-pos', 'Стр. ' + (c.line + 1) + ', кол. ' + (c.col + 1) + (sel ? ' (выделено ' + sel.length + ')' : ''));
            doc.text('st-lang', t.lang === 'js' ? 'JavaScript' : t.lang.toUpperCase());
        } else { doc.text('st-pos', ''); doc.text('st-lang', ''); }
        doc.cls('tb-run', 'running', !!(s.run && s.run.running));
        doc.cls('tb-stop', 'disabled', !(s.run && s.run.running));
        doc.cls('tb-back', 'disabled', s.histAt <= 0);
        doc.cls('tb-fwd', 'disabled', s.histAt >= s.history.length - 1);
    }

    function renderLayout() {
        // Студия (Hammer) несёт свой инспектор и дерево объектов: инспектор
        // Editor уступает ей место, центр прозрачен для runtime-кадра.
        const t = activeTab(), studioOn = !!(t && t.kind === 'studio');
        doc.cls('inspector', 'hidden', studioOn);
        doc.cls('center', 'studio-on', studioOn && !!t.api);
        doc.cls('sidebar', 'hidden', s.sidebarHidden);
        doc.cls('bottom', 'collapsed', s.bottomCollapsed);
        for (const r of ['project', 'search', 'run', 'tools']) doc.cls('rail-' + r, 'on', s.side === r && !s.sidebarHidden);
        code.invalidate();
    }

    function renderAll() {
        renderTabs(); renderHost(); renderInspector(); renderBottom(); renderStatus(); renderTree(); renderLayout();
    }

    function changed() {
        code.ensureCaretVisible();
        renderTabs(); renderStatus();
        s.inspectorDirty = true;
    }

    function focusCode() {
        const t = activeTab();
        if (!t || !t.model) return;
        s.focus = 'code';
        code.invalidate();
    }

    // --- события RmlUi -------------------------------------------------------------

    function bind() {
        doc.text('tb-back', icon('arrow_back'));
        doc.text('tb-fwd', icon('arrow_forward'));
        doc.html('tb-search', icon('search') + ' &#160;Поиск файлов и команд');
        doc.html('tb-run', icon('play_arrow') + ' Run');
        doc.html('tb-stop', icon('stop') + ' Stop');
        doc.text('rail-project', icon('description'));
        doc.text('rail-search', icon('search'));
        doc.text('rail-run', icon('play_circle'));
        doc.text('rail-tools', icon('widgets'));
        doc.text('find-prev', icon('arrow_upward'));
        doc.text('find-next', icon('arrow_downward'));
        doc.text('find-close', icon('close'));

        doc.on('pm-open', 'click', () => openProject(doc.value('pm-path')));
        doc.on('pm-recent', 'click', (id, ev, key) => { if (key) openProject(key); });
        doc.on('pm-templates', 'click', (id, ev, key) => { if (key) createFromTemplate(key); });

        doc.on('tb-search', 'click', () => openPalette('files'));
        doc.on('tb-run', 'click', () => run());
        doc.on('tb-stop', 'click', () => stop());
        doc.on('tb-back', 'click', () => navigate(-1));
        doc.on('tb-fwd', 'click', () => navigate(1));
        doc.on('tb-project', 'click', () => openPalette('commands'));

        doc.on('rail-project', 'click', () => { s.sidebarHidden = !s.sidebarHidden; renderLayout(); });
        doc.on('rail-search', 'click', () => openPalette('files'));
        doc.on('rail-run', 'click', () => run());
        doc.on('rail-tools', 'click', () => openPalette('commands'));

        doc.on('side-body', 'click', (id, ev, key) => {
            if (!key) return;
            if (key.startsWith('d:')) {
                const p = key.slice(2);
                if (s.expanded.has(p)) s.expanded.delete(p); else s.expanded.add(p);
                renderTree();
            } else if (key.startsWith('f:')) {
                openFile(key.slice(2));
                focusCode();
            }
        });
        doc.on('tabs', 'click', (id, ev, key) => {
            if (!key) return;
            if (key.startsWith('x:')) closeTab(key.slice(2));
            else if (key.startsWith('t:')) { activate(key.slice(2), true); focusCode(); }
        });
        doc.on('code', 'mousedown', () => {
            if (s.focus === 'find' || s.focus === 'palette') { doc.focus('find-input', false); }
            focusCode();
            code.mouseDown();
        });
        doc.on('find-prev', 'click', () => findStep(true));
        doc.on('find-next', 'click', () => findStep(false));
        doc.on('find-close', 'click', () => closeFind());
        doc.on('find-input', 'focus', () => { s.focus = 'find'; });

        doc.on('insp-body', 'click', (id, ev, key) => {
            if (!key) return;
            if (key.startsWith('open:')) { openFile(key.slice(5)); focusCode(); }
            else if (key.startsWith('line:')) { const t = activeTab(); if (t && t.model) { t.model.goto(parseInt(key.slice(5), 10), 1); code.ensureCaretVisible(); focusCode(); } }
        });

        for (const b of ['problems', 'output', 'console']) doc.on('bt-' + b, 'click', () => { s.bottom = b; s.bottomCollapsed = false; renderBottom(); renderLayout(); });
        doc.on('bt-toggle', 'click', () => { s.bottomCollapsed = !s.bottomCollapsed; renderBottom(); renderLayout(); });
        doc.on('bottom-body', 'click', (id, ev, key) => {
            if (s.bottom !== 'problems' || key === null || key === undefined || !s.problemList) return;
            const d = s.problemList[parseInt(key, 10)];
            if (d && d.file && s.entries.some((e) => e.path === d.file)) {
                const tab = openFile(d.file, d.line || 1, d.col || 1);
                if (tab && d.source) {
                    if (tab.inst && tab.inst.navigateDiagnostic) tab.inst.navigateDiagnostic(d.source);
                    else tab.problemTarget = d.source;
                }
            }
        });
        doc.on('palette-list', 'click', (id, ev, key) => { if (key !== null && key !== undefined) acceptPalette(parseInt(key, 10)); });

        code.state.onChange = () => changed();
        code.state.onCaret = () => { renderStatus(); };
    }

    // --- кадр: горячие клавиши и опрос ------------------------------------------------

    function primary() { return $.input.down('cmd') || $.input.down('rcmd') || $.input.ctrlDown(); }

    function shortcuts() {
        const mod = primary(), shift = $.input.shiftDown();
        if ($.input.pressed('escape')) {
            if (s.palette) { closePalette(); return; }
            if (s.focus === 'find') { closeFind(); return; }
        }
        if (s.palette) {
            if ($.input.pressed('down')) { s.palette.sel = Math.min(s.palette.list.length - 1, s.palette.sel + 1); renderPalette(); }
            if ($.input.pressed('up')) { s.palette.sel = Math.max(0, s.palette.sel - 1); renderPalette(); }
            if ($.input.pressed('enter')) { acceptPalette(); return; }
        }
        if (s.focus === 'find') {
            if ($.input.pressed('enter')) findStep(shift);
            const q = String(doc.value('find-input') || '');
            if (q !== s.findQuery) { s.findQuery = q; const n = code.setFind(q); doc.text('find-count', q ? n + ' совп.' : ''); }
        }
        const at = activeTab();
        const own = at && at.kind === 'studio' && !s.palette ? (at.studio.ownKeys || []) : [];
        if ($.input.pressed('f5') && !own.includes('f5')) { if (shift) stop(); else run(); }
        if (!mod || !s.project) return;
        if ($.input.pressed('p')) openPalette(shift ? 'commands' : 'files');
        if ($.input.pressed('s') && !own.includes('s')) { if (shift) saveAll(); else save(); }
        // История студии Editor ведёт Editor (в полях ввода — их собственная правка текста).
        if (at && at.inst && !$.ui.typing() && !s.palette) {
            if ($.input.pressed('z')) { if (shift) studios.redo(at); else studios.undo(at); }
            if ($.input.pressed('y')) studios.redo(at);
        }
        if ($.input.pressed('w')) { if (s.active) closeTab(s.active); }
        if ($.input.pressed('b')) { if (shift) buildPackage(); else { s.sidebarHidden = !s.sidebarHidden; renderLayout(); } }
        if ($.input.pressed('j')) { s.bottomCollapsed = !s.bottomCollapsed; renderBottom(); renderLayout(); }
    }

    let pollT = 0;
    function update(dt) {
        if (!s.project) return;
        if (s.fullPreview) {
            $.gfx.text('Esc — вернуться в Editor', 16, 12, { size: 14, color: '#ffffffb0' });
            const api = s.fullPreview.api;
            if (!api || $.input.rawPressed('escape') || (api.previewRunning && !api.previewRunning())) leaveFullPreview();
            return;
        }
        shortcuts();
        if (s.palette) filterPalette();
        const t = activeTab();
        if (t && t.model) {
            code.update(dt, s.focus === 'code', {
                find: openFind,
                gotoLine: () => openPalette('line'),
            });
        }
        if (t && t.kind === 'studio' && t.api && !s.palette) studios.place(t, doc.rect('host'));
        if (t && t.inst && !s.palette) studios.update(t, dt);
        if (s.inspectorDirty) { s.inspectorDirty = false; renderInspector(); }
        pollT += dt;
        if (pollT > 0.3) {
            pollT = 0;
            for (const st of s.tabs) {
                if (st.kind !== 'studio') continue;
                const snap = studios.snapshot(st);
                const dirty = st.studio.trackDirty === false ? false : !!(snap && snap.dirty);
                const key = snap ? JSON.stringify([snap.dirty, snap.tool, snap.selection, snap.map, snap.diagnostics]) : '';
                if (dirty !== st.dirty || key !== st.snapKey) {
                    st.dirty = dirty; st.snapKey = key;
                    renderTabs(); renderBottom();
                    if (st === t) renderInspector();
                }
            }
            if (s.run && s.run.running) {
                const p = s.run.handle.peek();
                if (p && typeof p.output === 'string' && p.output.length !== (s.output || '').length) {
                    s.output = tail(p.output);
                    if (s.bottom === 'output') renderBottom();
                }
            }
            renderStatus();
        }
    }

    // --- старт ------------------------------------------------------------------------

    async function start(projectArg) {
        bind();
        loadState();
        if (!$.sdk.available()) log('Мост инструментов выключен: нужен "toolHost": true в editor/project.json');
        if (projectArg) {
            const ok = await openProject(projectArg);
            if (!ok) return;
        } else {
            showPM();
        }
    }

    doc.show();
    return {
        state: s, start, update, openProject, openFile, save, saveAll, run, stop, validateProject, buildPackage,
        openPalette, closePalette, activeTab, closeTab, code, studios,
        openWith: (path, id) => openFile(rel(String(path)), 0, 0, id),
    };
}
