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
import { publicApiSymbols, javascriptSymbolAt, javascriptDocumentSymbols, nodeApiPathAt } from './lib/api_language.js';
import { languageOf, escapeRml } from './lib/highlight.js';
import { fuzzyFilter } from './lib/fuzzy.js';
import { createStudioHost, studioFor, studioById, studiosFor } from './lib/studios.js';
import { pickProjectFile } from './lib/studio_kit.js';
import { createExtensionHost } from './lib/shared/extensions.js';
import { createGraphPanel } from './lib/graph_panel.js';
import { normalizeGraph, describe as describeGraph } from './lib/shared/graph_model.js';

const DOC = 'ui/editor.rml';
const STATE_FILE = 'state.local.json';
const TEXT_EXT = ['.js', '.mjs', '.json', '.rml', '.rcss', '.css', '.md', '.txt', '.scene', '.glsl',
                  '.frag', '.vert', '.xml', '.csv', '.tsv', '.html', '.re2dmap', '.ini', '.yml', '.yaml'];
const SEARCH_EXT = new Set(TEXT_EXT);
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
const MAX_LOG = 20000;
const MAX_OUTPUT_ENTRIES = 500;
const MAX_OUTPUT_ENTRY = 64 * 1024;
let jsonDraftSequence = 0;

const esc = escapeRml;
const ext = (p) => { const m = /(\.[^./]+)$/.exec(String(p).toLowerCase()); return m ? m[1] : ''; };
const baseName = (p) => String(p).split('/').pop();
const dirName = (p) => { const i = String(p).lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };

export function createEditor($) {
    const doc = $.ui.doc(DOC);
    const code = createCodeView($, doc, publicApiSymbols($));
    let extensionHost = null;
    const icon = (name) => $.ui.icon(name) || '';
    const studios = createStudioHost($, {
        log: (t) => log(t), setStatus: (t, k) => setStatus(t, k),
        run: (opts) => run(opts), stop: () => stop(),
        projectRoot: () => (s.project ? s.project.abs : ''),
        fullPreview: (tab) => enterFullPreview(tab),
        graphInfo: () => graphInfo(), reindex: () => reindex(), migrate: () => migrateProject(), projectChanged: () => refreshProjectJson(),
        openWith: (path, id) => openFile(rel(String(path)), 0, 0, id),
        // Студия Editor сообщила о правке/проверке: вкладка, Problems, статус.
        changed: (tab) => {
            const dirty = !!(tab.inst && tab.inst.dirty && tab.inst.dirty());
            if (dirty !== tab.dirty) { tab.dirty = dirty; renderTabs(); }
            renderBottom(); renderStatus();
        },
        // Набор текста (поле RmlUi, палитра, поиск) — горячие клавиши студий молчат.
        typing: () => $.ui.typing() || !!s.palette || s.focus === 'find' || s.focus === 'search',
        get extensions() { return extensionHost; },
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
        projectDiags: [], extensionDiags: [], agentDiags: [], agentReport: null, closeRequest: null, fileConflict: null,
        bottom: 'problems', bottomCollapsed: false, sidebarHidden: false,
        side: 'project',
        focus: 'none',          // 'code' | 'palette' | 'find' | 'search' | 'none'
        palette: null,          // { mode, items, list, sel, query }
        run: null,              // { handle, running, exit, output, polledAt }
        output: '', outputEntries: [], outputFilter: 'all', consoleLog: '',
        status: '', statusKind: '',
        recent: [], templates: [],
        busy: 0,
        lastTreeHtml: '',
        searchQuery: '', searchResults: [], searchTruncated: false,
        searchDraft: '', searchDelay: 0,
        graphNorm: null, graphStale: false, graphSelected: null, indexing: false, indexAgain: false,
    };

    // --- граф проекта (docs/PROJECT_JSON.md): панель под кодом ------------------------------
    const graphPanel = createGraphPanel($, doc, {
        graph: () => s.graphNorm,
        state: () => ({
            stale: s.graphStale,
            unsaved: s.tabs.some((t) => t.model && t.model.dirty && t.lang === 'js'),
            legacy: !!(s.project && s.project.meta && !s.project.meta.v2),
        }),
        openSource: (file, line) => { openFile(file, line, 1); focusCode(); },
        select: (key) => { s.graphSelected = key; s.inspectorDirty = true; },
        reindex: () => reindex(),
        migrate: () => migrateProject(),
        layout: () => renderLayout(),
    });

    // --- состояние на диске ---------------------------------------------------

    function loadState() {
        const st = $.fs.readJSON(STATE_FILE, null);
        if (st && Array.isArray(st.recent)) s.recent = st.recent.filter((r) => r && r.abs);
    }
    function saveState() {
        $.fs.writeJSON(STATE_FILE, { version: 1, recent: s.recent.slice(0, 12) });
    }

    extensionHost = createExtensionHost({
        $,
        addDiagnostic(severity, code, message, extra) {
            const d = normalizeDiag(Object.assign({ severity, code, message }, extra || {}, { asset: null }));
            d.extension = extra && extra.asset ? String(extra.asset) : '';
            s.extensionDiags.push(d);
            renderBottom(); renderStatus();
            return d;
        },
    });

    function log(text) {
        s.consoleLog += text + '\n';
        if (s.consoleLog.length > MAX_LOG) s.consoleLog = s.consoleLog.slice(-MAX_LOG);
        if (s.bottom === 'console') renderBottom();
    }
    function appendOutput(source, text) {
        let value = String(text === undefined || text === null ? '' : text);
        if (!value) return;
        if (value.length > MAX_OUTPUT_ENTRY)
            value = value.slice(0, MAX_OUTPUT_ENTRY / 2) + '\n… output truncated …\n' + value.slice(-MAX_OUTPUT_ENTRY / 2);
        s.outputEntries.push({ time: new Date().toISOString(), source: source || 'editor', text: value });
        if (s.outputEntries.length > MAX_OUTPUT_ENTRIES)
            s.outputEntries.splice(0, s.outputEntries.length - MAX_OUTPUT_ENTRIES);
        s.output = tail((s.output || '') + value + (value.endsWith('\n') ? '' : '\n'));
        if (s.bottom === 'output') renderBottom();
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
            const source = args[0] === 'build' ? 'build' : 'editor';
            const buildDetail = args[0] === 'build' && res.json && typeof res.json.outputTail === 'string'
                ? res.json.outputTail + ((res.json.diagnostics || []).length
                    ? '\nДиагностики:\n' + JSON.stringify(res.json.diagnostics, null, 2) : '') : '';
            const resultText = buildDetail || res.output || res.error || (res.json ? JSON.stringify(res.json, null, 2) : 'готово');
            appendOutput(source, '$ r2d ' + args.join(' ') + '\n' + resultText);
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

    // Иконка шаблона: по id, иначе общая.
    const TEMPLATE_ICONS = { blank: 'description' };

    // Короткий путь для показа: от каталога запуска или с «~».
    function shortPath(abs) {
        const base = String($.fs.basePath() || '').replace(/\/+$/, '');
        if (base && abs.startsWith(base + '/')) return abs.slice(base.length + 1);
        const home = /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(abs);
        return home ? '~' + abs.slice(home[1].length) : abs;
    }
    const parentOf = (abs) => abs.replace(/\/[^/]*$/, '') || '/';

    // Имя папки из названия проекта: пробелы → «-», без служебных символов.
    function slugOf(name) {
        return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^0-9a-zа-яё_\-]/gi, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }

    function recentInfo(r) {
        const json = $.fs.readJSON(r.abs + '/project.json', null);
        let title = (json && projectMeta(json, r.abs).title) || r.title || baseName(r.abs);
        if (/\{\{.*\}\}/.test(title)) title = baseName(r.abs);   // шаблон, открытый как проект
        return { abs: r.abs, title, missing: !json, v2: !!(json && json.schema_version === 2) };
    }

    function showPM(error) {
        doc.cls('pm', 'hidden', false);
        doc.cls('app', 'hidden', true);
        doc.html('pm-logo', icon('rocket_launch'));
        showPMError(error);
        doc.text('pm-new-error', '');
        renderRecent();
        if (!s.pmNew) {
            s.pmNew = { template: 'blank' };
            // Новые проекты по умолчанию находятся в пользовательских документах,
            // независимо от каталога запуска бинарника/приложения.
            s.pmNew.dir = String($.fs.documentsPath() || $.fs.basePath() || '').replace(/[\\/]+$/, '');
        }
        renderTemplates();
        renderDest();
        if (!s.templates.length) loadTemplates();
    }

    function renderRecent() {
        const list = s.recent.map(recentInfo);
        list.sort((x, y) => (x.missing ? 1 : 0) - (y.missing ? 1 : 0));
        doc.text('pm-recent-count', list.length ? String(list.length) : '');
        doc.cls('pm-recent-count', 'hidden', !list.length);
        doc.html('pm-recent', list.length ? list.map((r, i) =>
            '<div class="pm-row' + (r.missing ? ' missing' : '') + '" data-key="' + (r.missing ? '' : 'open:' + esc(r.abs)) + '">' +
            '<span class="pm-ico">' + icon(r.missing ? 'folder_off' : 'folder') + '</span>' +
            '<div class="pm-info"><span class="pm-title">' + esc(r.title) + '</span><span class="pm-path">' + esc(shortPath(r.abs)) + '</span></div>' +
            (r.missing ? '<span class="pm-badge warn">папка не найдена</span>' : r.v2 ? '<span class="pm-badge">v2</span>' : '') +
            '<span class="pm-x" id="pm-rm-' + i + '" data-key="rm:' + esc(r.abs) + '">' + icon('close') + '</span></div>').join('')
            : '<span class="empty">Здесь появятся проекты, которые вы открывали. Создайте новый справа или откройте папку ниже.</span>');
    }

    async function loadTemplates() {
        const res = await tool(['templates']);
        s.templates = res.json && Array.isArray(res.json.templates) ? res.json.templates : [];
        if (s.pmNew && !s.templates.some((t) => t.id === s.pmNew.template) && s.templates.length) s.pmNew.template = s.templates[0].id;
        renderTemplates();
    }
    function renderTemplates() {
        const sel = s.pmNew && s.pmNew.template;
        doc.html('pm-templates', s.templates.length ? s.templates.map((t) =>
            '<div id="pm-template-' + esc(t.id) + '" class="pm-tpl' + (t.id === sel ? ' selected' : '') + '" data-key="' + esc(t.id) + '">' +
            '<span class="pm-ico">' + icon(TEMPLATE_ICONS[t.id] || 'folder_special') + '</span>' +
            '<div class="pm-info"><span class="pm-tpl-name">' + esc(t.name || t.id) + '</span>' +
            '<span class="pm-tpl-desc">' + esc(t.description || '') + '</span></div></div>').join('')
            : '<span class="empty">Шаблоны загружаются…</span>');
    }

    // Итоговый путь нового проекта: <где создать>/<папка из названия>.
    function newProjectDest() {
        const dir = s.pmNew ? s.pmNew.dir : '';
        const slug = slugOf(doc.value('pm-new-name'));
        return { dir, slug, dest: dir && slug ? dir + '/' + slug : '' };
    }
    function renderDest() {
        if (s.pmNew) doc.text('pm-new-dir', esc(shortPath(s.pmNew.dir || '') || 'не выбрана'));
        const d = newProjectDest();
        let text = '', bad = true;
        if (!d.slug) text = 'Введите название проекта.';
        else if (!d.dir) text = 'Укажите папку, в которой создать проект.';
        else if ($.fs.exists(d.dest)) text = 'Папка ' + shortPath(d.dest) + ' уже существует — выберите другое название.';
        else { text = 'Будет создана папка: ' + shortPath(d.dest); bad = false; }
        doc.text('pm-dest', esc(text));
        doc.cls('pm-dest', 'bad', bad);
        return !bad;
    }

    async function createProject() {
        doc.text('pm-new-error', '');
        if (!renderDest()) return;
        const { dest } = newProjectDest();
        const name = String(doc.value('pm-new-name') || '').trim();
        const res = await tool(['new', s.pmNew.template, dest, '--name', name]);
        if (!res.ok) {
            const d = res.json && res.json.diagnostics && res.json.diagnostics[0];
            doc.text('pm-new-error', esc(d ? d.code + ': ' + d.message : (res.error || 'не удалось создать проект')));
            return;
        }
        await openProject(dest);
    }

    // Окна ОС: открыть проект (папку с project.json) и выбрать место нового.
    async function askFolder(title, path) {
        try { return await $.fs.pickFolder({ title, path }); }
        catch (e) { showPMError(e.message || String(e)); return null; }
    }
    function showPMError(text) { s.pmError = text || ''; doc.text('pm-error', esc(s.pmError)); }
    async function openProjectDialog() {
        const start = s.project ? parentOf(s.project.abs) : (s.recent[0] ? parentOf(s.recent[0].abs) : String($.fs.basePath() || ''));
        const dir = await askFolder('Открыть проект: папка с project.json', start);
        if (!dir) return false;
        if (!$.fs.exists(dir + '/project.json')) {
            if (s.project) setStatus('В «' + dir + '» нет project.json', 'err');
            else showPMError('В папке «' + shortPath(dir) + '» нет project.json. Выберите папку проекта или создайте новый справа.');
            return false;
        }
        return openProject(dir);
    }
    async function pickNewProjectDir() {
        const dir = await askFolder('Где создать проект', s.pmNew && s.pmNew.dir);
        if (!dir || !s.pmNew) return;
        s.pmNew.dir = dir;
        renderDest();
    }

    function forgetRecent(abs) {
        s.recent = s.recent.filter((r) => r.abs !== abs);
        saveState();
        renderRecent();
    }

    // --- проект и дерево --------------------------------------------------------

    // Настройки project.json (docs/PROJECT_JSON.md): schema_version 2 — project.*/runtime.*,
    // иначе минимальный плоский манифест. Сцены берутся из графа, а не угадываются.
    function projectMeta(json, abs) {
        const j = json && typeof json === 'object' ? json : {};
        const v2 = j.schema_version === 2;
        const rt = v2 && j.runtime && typeof j.runtime === 'object' ? j.runtime : {};
        const win = rt.window && typeof rt.window === 'object' ? rt.window : {};
        const pj = v2 && j.project && typeof j.project === 'object' ? j.project : {};
        return {
            v2,
            title: v2 ? (win.title || pj.name || baseName(abs || '')) : (j.title || baseName(abs || '')),
            version: v2 ? (pj.version || '') : (j.version || ''),
            width: v2 ? win.width : j.width, height: v2 ? win.height : j.height,
            entry: typeof rt.entry === 'string' && rt.entry ? rt.entry : 'main.js',
            start: typeof rt.start_scene === 'string' && rt.start_scene ? rt.start_scene : null,
        };
    }

    function manifest() {
        const m = (s.project && s.project.meta) || projectMeta({}, '');
        const scenes = s.graphNorm ? s.graphNorm.scenes.map((e) => e.name) : [];
        return { v2: m.v2, entry: m.entry, start: m.start, scenes };
    }

    function graphInfo() {
        const g = s.graphNorm;
        return {
            has: !!g, status: g ? g.status : null, stale: s.graphStale,
            scenes: g ? g.scenes.map((e) => e.name) : [], objects: g ? g.objects.length : 0,
            edges: g ? g.edges.length : 0, sources: g ? g.sources.length : 0, diagnostics: g ? g.diagnostics : [],
        };
    }

    // Перечитывает project.json: настройки проекта, граф и открытые вкладки Project Settings.
    function refreshProjectJson() {
        if (!s.project) return;
        const json = $.fs.readJSON(full('project.json'), null);
        if (!json) return;
        s.project.json = json;
        s.project.meta = projectMeta(json, s.project.abs);
        Object.assign(s.project, { title: s.project.meta.title, version: s.project.meta.version, width: s.project.meta.width, height: s.project.meta.height });
        s.graphNorm = normalizeGraph(json.editor && json.editor.graph);
        doc.html('tb-project', esc(s.project.title) + ' ' + icon('expand_more'));
        doc.text('st-project', esc(s.project.title));
        renderAll();
    }

    // Нельзя затирать несохранённые пользовательские правки project.json (docs/PROJECT_JSON.md §5.2).
    function manifestDirty() {
        const t = s.tabs.find((x) => x.path === 'project.json');
        return !!(t && (t.model ? t.model.dirty : studios.dirty(t)));
    }

    // После записи project.json самим Editor вкладки с этим файлом подтягивают новую версию.
    function syncManifestTabs() {
        const text = $.fs.readText(full('project.json'));
        for (const t of s.tabs) {
            if (t.path !== 'project.json') continue;
            if (t.model && !t.model.dirty && typeof text === 'string') { t.model.setText(text); t.diskText = text; }
            else if (t.kind === 'studio' && t.inst && t.inst.reload) t.inst.reload();
        }
    }

    // Пересборка editor.graph из JS: после Save кода, по команде, из панели и Project Settings.
    async function reindex() {
        if (!s.project) return false;
        if (!s.project.meta.v2) { setStatus('граф хранится в project.json со schema_version 2', 'err'); return false; }
        if (s.indexing) { s.indexAgain = true; return false; }
        if (manifestDirty()) { setStatus('граф не обновлён: сначала сохраните project.json', 'err'); return false; }
        s.indexing = true;
        try {
            const res = await tool(['project-index', s.project.abs, '--write']);
            const j = res.json || {};
            if (!j.ok) {
                const d = (j.diagnostics || [])[0] || {};
                setStatus('граф не обновлён: ' + (d.message || res.error || 'ошибка индексатора'), 'err');
                return false;
            }
            s.graphStale = false;
            if (j.written) { syncManifestTabs(); refreshProjectJson(); }
            else renderAll();
            setStatus(j.written ? 'граф проекта обновлён (' + j.entities + ' сущностей, ' + j.edges + ' связей)' : 'граф проекта актуален', 'ok');
            return true;
        } finally {
            s.indexing = false;
            if (s.indexAgain) { s.indexAgain = false; reindex(); }
        }
    }

    // Только проверка: не пишет project.json, помечает граф устаревшим.
    async function checkIndex() {
        if (!s.project || !s.project.meta.v2) return;
        const res = await tool(['project-index', s.project.abs, '--check']);
        s.graphStale = !!(res.json && res.json.ok !== false && res.json.changed);
        graphPanel.head();
    }

    function graphVisible() {
        const t = activeTab();
        return !!(s.project && !s.fullPreview && t && (t.kind === 'code' || (t.kind === 'studio' && t.studio.id === 'project')));
    }

    async function openProject(input) {
        const abs = absPath(input);
        if (!abs) { showPM('Выберите папку проекта.'); return false; }
        const json = $.fs.readJSON(abs + '/project.json', null);
        if (!json) { showPM('В «' + abs + '» нет project.json (или он не читается).'); return false; }
        closeAllTabs(true);
        const meta = projectMeta(json, abs);
        s.project = { abs, title: meta.title, version: meta.version, width: meta.width, height: meta.height, json, meta };
        s.graphNorm = normalizeGraph(json.editor && json.editor.graph);
        s.graphStale = false; s.graphSelected = null;
        graphPanel.setView('overview', null, true);
        s.recent = [{ abs, title: s.project.title }].concat(s.recent.filter((r) => r.abs !== abs));
        saveState();
        doc.cls('pm', 'hidden', true);
        doc.cls('app', 'hidden', false);
        doc.html('tb-project', esc(s.project.title) + ' ' + icon('expand_more'));
        doc.text('st-project', esc(s.project.title));
        $.window.title(s.project.title + ' — Russiano2D Editor');
        await refreshTree();
        const extResult = await tool(['extension', 'list', '--project', abs]);
        s.extensionDiags = extResult.json && Array.isArray(extResult.json.diagnostics)
            ? extResult.json.diagnostics.map((d) => {
                const n = normalizeDiag(Object.assign({}, d, { asset: null }));
                n.extension = d.asset || '';
                return n;
            }) : [];
        await extensionHost.apply(extResult.json && Array.isArray(extResult.json.extensions) ? extResult.json.extensions : []);
        const entryName = manifest().entry;
        const entry = $.fs.exists(abs + '/' + entryName) ? entryName : null;
        if (entry) openFile(entry);
        renderAll();
        setStatus('проект открыт: ' + abs, 'ok');
        checkIndex();
        return true;
    }

    async function refreshTree() {
        if (!s.project) return;
        const res = await tool(['assets', s.project.abs]);
        s.entries = res.json && Array.isArray(res.json.entries) ? res.json.entries : [];
        if (res.json && res.json.truncated) log('Дерево проекта обрезано backend\'ом (truncated).');
        renderTree();
        checkIndex();
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
        if (s.side === 'search') { renderSearchResults(); return; }
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

    function searchProject(query) {
        const q = String(query || '').trim();
        s.searchQuery = q;
        s.searchDraft = q;
        s.searchDelay = 0;
        s.searchResults = [];
        s.searchTruncated = false;
        if (q.length < 2 || !s.project) { renderSearchResults(); return []; }
        const needle = q.toLocaleLowerCase();
        const maxBytes = 32 * 1024 * 1024;
        let scannedBytes = 0;
        const entries = s.entries.filter((e) => SEARCH_EXT.has(ext(e.path)) &&
            !(e.path === 'node_modules' || e.path.startsWith('node_modules/')) &&
            !(e.path === 'build' || e.path.startsWith('build/')) &&
            !(e.path === 'dist' || e.path.startsWith('dist/')) &&
            !(Number(e.size) > 1024 * 1024));
        for (const entry of entries) {
            const size = Number(entry.size) || 0;
            if (scannedBytes + size > maxBytes) { s.searchTruncated = true; break; }
            scannedBytes += size;
            let source;
            try { source = $.fs.readText(full(entry.path)); } catch (_) { continue; }
            if (typeof source !== 'string') continue;
            const lines = source.split(/\r?\n/);
            for (let i = 0; i < lines.length && s.searchResults.length < 200; i++) {
                if (lines[i].toLocaleLowerCase().includes(needle)) {
                    s.searchResults.push({ path: entry.path, line: i + 1, text: lines[i].trim().slice(0, 220) });
                }
            }
            if (s.searchResults.length >= 200) { s.searchTruncated = true; break; }
        }
        renderSearchResults();
        return s.searchResults;
    }

    function renderSearchResults() {
        if (s.searchQuery.trim().length < 2) {
            doc.html('side-body', '<span class="empty">Введите не менее двух символов для поиска по файлам проекта.</span>');
            return;
        }
        const rows = s.searchResults.map((r, i) => '<div id="search-result-' + i + '" class="search-result" data-key="search:' + i + '">' +
            '<div class="search-result-head">' + esc(r.path) + '<span>:' + r.line + '</span></div>' +
            '<div class="search-result-text">' + esc(r.text) + '</div></div>');
        const notice = s.searchTruncated ? '<div class="search-limit">Выдача ограничена: достигнут лимит размера или 200 совпадений.</div>' : '';
        doc.html('side-body', (rows.length ? rows.join('') : '<span class="empty">Совпадений нет</span>') + notice);
    }

    function openSearchResult(index) {
        const result = s.searchResults[index];
        if (!result) return false;
        openFile(result.path, result.line, 1);
        focusCode();
        return true;
    }

    function showProjectSearch(initialQuery) {
        if (!s.project) return openPalette('files');
        s.side = 'search';
        s.sidebarHidden = false;
        s.focus = 'search';
        if (initialQuery !== undefined) {
            doc.setValue('search-input', String(initialQuery));
            s.searchDraft = String(initialQuery);
            searchProject(initialQuery);
        }
        renderSearchResults();
        renderLayout();
        doc.focus('search-input');
    }

    function findWordInProject() {
        const t = activeTab();
        if (!t || !t.model) return false;
        const selected = String(t.model.selectedText() || '').trim();
        let word = /^[\w$Ѐ-ӿ]+$/.test(selected) ? selected : '';
        if (!word) {
            const p = t.model.caret, line = t.model.lines[p.line] || '';
            const re = /[\w$Ѐ-ӿ]+/g;
            let match;
            while ((match = re.exec(line))) {
                const end = match.index + match[0].length;
                if (match.index <= p.col && p.col <= end) { word = match[0]; break; }
            }
        }
        if (word.length < 2) { setStatus('поставьте каретку на слово длиной от двух символов', 'err'); return false; }
        showProjectSearch(word);
        return true;
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
                tab.diskText = text;
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
            else if (kind === 'code' && tab.lang === 'json') validateJsonText(tab);
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

    function renderCloseConfirm() {
        const tab = s.closeRequest && s.tabs.find((t) => t.id === s.closeRequest);
        doc.cls('close-confirm', 'hidden', !tab);
        if (tab) doc.text('close-confirm-path', tab.path);
    }

    function renderFileConflict() {
        const conflict = s.fileConflict;
        const tab = conflict && s.tabs.find((t) => t.id === conflict.tabId);
        doc.cls('file-conflict', 'hidden', !tab);
        if (!tab) return;
        const exists = typeof conflict.diskText === 'string';
        doc.html('file-conflict-message', exists
            ? 'Файл <span class="close-path">' + esc(tab.path) + '</span> изменился на диске после открытия. Выберите, какую версию оставить.'
            : 'Файл <span class="close-path">' + esc(tab.path) + '</span> удалён или недоступен на диске. Загрузить его версию нельзя.');
        doc.cls('file-conflict-reload', 'hidden', !exists);
        doc.text('file-conflict-overwrite', exists ? 'Записать версию Editor' : 'Создать файл из версии Editor');
    }

    function cancelFileConflict() {
        s.fileConflict = null;
        renderAll();
        const tab = activeTab();
        if (tab && tab.model) focusCode();
    }

    async function reloadFileConflict() {
        const conflict = s.fileConflict;
        const tab = conflict && s.tabs.find((t) => t.id === conflict.tabId);
        if (!tab || typeof conflict.diskText !== 'string') return false;
        tab.model.setText(conflict.diskText);
        tab.diskText = conflict.diskText;
        s.fileConflict = null;
        if (s.closeRequest === tab.id) s.closeRequest = null;
        renderAll();
        if (tab.lang === 'js') await lintFile(tab);
        else if (tab.lang === 'json') await validateJsonText(tab);
        setStatus('загружена внешняя версия: ' + tab.path, 'ok');
        return true;
    }

    async function overwriteFileConflict() {
        const conflict = s.fileConflict;
        const tab = conflict && s.tabs.find((t) => t.id === conflict.tabId);
        if (!tab || !(await save(tab, { overwrite: true }))) return false;
        const closeAfterSave = s.closeRequest === tab.id;
        s.fileConflict = null;
        if (closeAfterSave) s.closeRequest = null;
        renderAll();
        if (closeAfterSave) closeTab(tab.id, true);
        else focusCode();
        return true;
    }

    function cancelCloseConfirm() {
        s.closeRequest = null;
        renderCloseConfirm();
        const tab = activeTab();
        if (tab && tab.model) focusCode();
    }

    async function saveCloseConfirm() {
        const id = s.closeRequest;
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab) { cancelCloseConfirm(); return false; }
        if (!(await save(tab))) return false;
        s.closeRequest = null;
        return closeTab(id, true);
    }

    function discardCloseConfirm() {
        const id = s.closeRequest;
        s.closeRequest = null;
        return id ? closeTab(id, true) : false;
    }

    function closeTab(id, force) {
        const i = s.tabs.findIndex((t) => t.id === id);
        if (i < 0) return true;
        const tab = s.tabs[i];
        const isDirty = tab.model ? tab.model.dirty : tab.kind === 'studio' ? studios.dirty(tab) : tab.dirty;
        if (isDirty && !force) {
            s.closeRequest = id;
            renderCloseConfirm();
            doc.focus('close-confirm-save');
            setStatus('«' + tab.path + '» содержит несохранённые изменения', 'err');
            return false;
        }
        if (s.closeRequest === id) s.closeRequest = null;
        if (s.fileConflict && s.fileConflict.tabId === id) s.fileConflict = null;
        if (tab.kind === 'studio') studios.close(tab);
        s.tabs.splice(i, 1);
        s.history = s.history.filter((h) => h !== id);
        s.histAt = Math.min(s.histAt, s.history.length - 1);
        if (s.active === id) {
            const next = s.history[s.histAt] || (s.tabs[i] || s.tabs[i - 1] || {}).id || null;
            s.active = null;
            if (next) activate(next, false); else renderAll();
        } else renderAll();
        return true;
    }

    function closeAllTabs(force) {
        for (const t of s.tabs.slice()) closeTab(t.id, force);
        s.tabs = []; s.active = null; s.history = []; s.histAt = -1; s.diags.clear(); s.projectDiags = []; s.extensionDiags = []; s.agentDiags = []; s.agentReport = null; s.closeRequest = null; s.fileConflict = null;
    }

    function navigate(delta) {
        const at = s.histAt + delta;
        if (at < 0 || at >= s.history.length) return;
        s.histAt = at;
        activate(s.history[at], false);
    }

    async function save(tab, options) {
        tab=tab||activeTab();
        if(!tab)return false;
        if(tab.kind==='studio') {
            if(!tab.api){setStatus('студия ещё не открыта: '+tab.path,'err');return false;}
            const ok=await studios.save(tab);
            setStatus(ok?'сохранено: '+tab.path:'не сохранено: '+tab.path,ok?'ok':'err');renderAll();return !!ok;
        }
        if(!tab.model)return false;
        if (!(options && options.overwrite)) {
            const diskText = $.fs.readText(full(tab.path));
            if (diskText !== tab.diskText) {
                s.fileConflict = { tabId: tab.id, diskText: typeof diskText === 'string' ? diskText : null };
                renderAll();
                doc.focus('file-conflict-overwrite');
                setStatus('файл изменён вне Editor: выберите версию для ' + tab.path, 'err');
                return false;
            }
        }
        if(!tab.model.dirty && !(options && options.overwrite))return true;
        const text = tab.model.text();
        const ok=$.fs.write(full(tab.path),text);
        if(!ok){setStatus('не удалось записать '+tab.path,'err');return false;}
        tab.diskText = text;
        tab.model.markSaved();
        if(tab.lang==='js')await lintFile(tab);
        else if(tab.lang==='json')await validateJsonText(tab);
        if(tab.path==='project.json')refreshProjectJson();
        renderAll();
        if(tab.lang==='js'&&s.project.meta.v2)reindex();
        return true;
    }
    async function saveAll() {
        let saved=0;const failed=[];
        for(const t of s.tabs.slice())if((t.model&&t.model.dirty)||(t.kind==='studio'&&studios.dirty(t))) {
            if(await save(t))saved++;else failed.push(t);
        }
        if(failed.length) {
            const paths=failed.map((t)=>t.path);
            appendOutput('editor','Save All: не сохранены документы: '+paths.join(', '));
            setStatus('Save All: сохранено '+saved+' · ошибок '+failed.length+': '+paths.join(', '),'err');
            const firstStudio=failed.find((t)=>t.kind==='studio');
            if(firstStudio&&s.active!==firstStudio.id)activate(firstStudio.id,false);
            return false;
        }
        setStatus('сохранено: '+saved,'ok');return true;
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

    // Generic JSON text tabs use the existing native validator on a temporary
    // buffer copy. Specialized asset studios keep their richer validators.
    async function validateJsonText(tab) {
        if (!tab || !tab.model || tab.lang !== 'json' || !s.tabs.includes(tab)) return false;
        const request = (tab.jsonValidationRequest || 0) + 1;
        tab.jsonValidationRequest = request;
        tab.jsonValidationPending = 0;
        const source = tab.model.text();
        const directory = full(tab.path).replace(/[^/]*$/, '');
        let draft = null;
        try {
            for (let attempt = 0; attempt < 32; attempt++) {
                const candidate = directory + '.r2d-editor-json-' + (++jsonDraftSequence) + '.json';
                if (!$.fs.exists(candidate)) { draft = candidate; break; }
            }
            if (!draft) throw Object.assign(new Error('Не удалось подобрать свободное имя для временного JSON'), { code: 'SDK_TEMP_FILE_COLLISION' });
            if ($.fs.write(draft, source) === false) throw Object.assign(new Error('Не удалось записать временный JSON'), { code: 'SDK_WRITE_FAILED' });
            const res = await tool(['validate', draft, '--type', 'json']);
            if (request !== tab.jsonValidationRequest || !s.tabs.includes(tab) || tab.model.text() !== source) return false;
            const list = res.json && Array.isArray(res.json.diagnostics)
                ? res.json.diagnostics.map(normalizeDiag).map((d) => Object.assign(d, { file: tab.path }))
                : [normalizeDiag({ code: 'SDK_BACKEND_NO_JSON', severity: 'error', message: 'Native JSON validate не вернул JSON' })];
            s.diags.set(tab.path, list);
            if (activeTab() === tab) code.setDiagnostics(list);
            renderBottom(); renderStatus();
            return !list.some((d) => d.severity === 'error');
        } catch (e) {
            if (request !== tab.jsonValidationRequest || !s.tabs.includes(tab)) return false;
            const list = [normalizeDiag({ code: e.code || 'SDK_JSON_VALIDATE', severity: 'error', message: e.message || String(e) })];
            list[0].file = tab.path;
            s.diags.set(tab.path, list);
            if (activeTab() === tab) code.setDiagnostics(list);
            renderBottom(); renderStatus();
            return false;
        } finally { if (draft) $.fs.remove(draft); }
    }

    async function validateProject() {
        if (!s.project) return;
        setStatus('проверка проекта…', '');
        const res = await tool(['validate', s.project.abs]);
        s.projectDiags = res.json ? (res.json.diagnostics || []).map(normalizeDiag) : [];
        for (const tab of s.tabs) {
            if (tab.lang === 'js') await lintFile(tab);
            else if (tab.kind === 'code' && tab.lang === 'json') await validateJsonText(tab);
        }
        s.bottom = 'problems'; s.bottomCollapsed = false;
        renderBottom();
        const errors = allProblems().filter((d) => d.severity === 'error').length;
        setStatus(errors ? 'проверка: ошибок ' + errors : 'проверка: ошибок нет', errors ? 'err' : 'ok');
    }

    // Run the existing native agent protocol for the selected .agent.json file.
    // The runtime and r2d agent command remain the source of test behavior/results.
    async function runAgentSession(path) {
        if (!s.project) return null;
        const tab = activeTab();
        const session = rel(String(path || (tab && tab.path) || ''));
        if (!session.endsWith('.agent.json') || !s.entries.some((e) => e.path === session)) {
            setStatus('откройте файл сессии *.agent.json', 'err');
            return null;
        }
        if (!(await saveAll())) {
            appendOutput('editor', 'Agent session отменена: не удалось сохранить все документы.');
            setStatus('тесты остановлены: не все файлы сохранены', 'err');
            return null;
        }
        setStatus('agent session: ' + session + '…', '');
        const res = await tool(['agent', full(session)]);
        const report = res.json && typeof res.json === 'object' ? res.json : null;
        s.agentReport = { session, report };
        s.agentDiags = report && Array.isArray(report.diagnostics)
            ? report.diagnostics.map((d) => {
                const n = normalizeDiag(d);
                n.file = d.asset ? rel(String(d.asset)) : session;
                return n;
            }) : [];
        if (report && typeof report.ok === 'boolean') {
            const failed = Math.max(0, Number(report.failed) || 0);
            appendOutput('editor', 'Agent session ' + (report.ok ? 'завершена' : 'завершена с отказами') +
                ': ответов ' + (Number(report.completed) || 0) + ', неуспешных запросов ' + failed + '.');
            setStatus(report.ok ? 'agent session пройдена: ' + session :
                'agent session: неуспешных запросов ' + failed + ' (подробности в Output)', report.ok ? 'ok' : 'err');
        } else {
            appendOutput('editor', 'Agent session не вернула структурированный отчёт; причина не определена.');
            setStatus('нет структурированного отчёта agent session (см. Output)', 'err');
        }
        s.bottom = report && report.diagnostics && report.diagnostics.length ? 'problems' : 'output';
        s.bottomCollapsed = false;
        renderAll();
        return report;
    }

    // project.json без schema_version → schema_version 2 через native `r2d migrate-project --write`,
    // затем индекс графа и проверка проекта. Односторонний переход, без скрытой перезаписи.
    async function migrateProject() {
        if (!s.project) return;
        if (manifestDirty()) { setStatus('сначала сохраните project.json', 'err'); return; }
        const res = await tool(['migrate-project', s.project.abs, '--write']);
        const j = res.json || {};
        if (!j.ok) { setStatus('migrate-project: ' + (((j.diagnostics || [])[0] || {}).message || res.error || 'ошибка'), 'err'); return; }
        if (!j.changed) { setStatus('project.json уже со schema_version 2', 'ok'); return; }
        const json = $.fs.readJSON(full('project.json'), null);
        if (json) { s.project.json = json; s.project.meta = projectMeta(json, s.project.abs); }
        for (const t of s.tabs.slice()) if (t.path === 'project.json') closeTab(t.id, true);
        await reindex();
        refreshProjectJson();
        openFile('project.json');
        setStatus('project.json переведён на schema_version 2', 'ok');
        await validateProject();
        renderAll();
    }

    function allProblems() {
        const out = s.projectDiags.concat(s.extensionDiags, s.agentDiags);
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

    async function run(opts) {
        if (!s.project) return null;
        // Run uses the same saved project state as Build. Wait for native studio
        // writes as well as code buffers before starting the runtime.
        if (!(await saveAll())) {
            appendOutput('run', 'Run отменён: не удалось сохранить все документы.');
            setStatus('запуск остановлен: не все файлы сохранены', 'err');
            return null;
        }
        if (s.run && s.run.running) stop();
        const args = ['--game', s.project.abs];
        if (opts && opts.scene) args.push('--scene', String(opts.scene));
        if (opts && opts.frames) args.push('--frames', String(opts.frames));
        if (opts && opts.headless) args.push('--headless');
        const handle = $.sdk.launch(args);
        appendOutput('run', '$ r2d ' + args.join(' '));
        s.run = { handle, running: true, stopRequested: false, exit: null, polledAt: 0, outputLength: 0 };
        handle.done.then((r) => {
            if (!s.run || s.run.handle !== handle) return;
            const output = String(r.output || '');
            if (output.length > s.run.outputLength) {
                appendOutput('run', output.slice(s.run.outputLength));
                s.run.outputLength = output.length;
            }
            s.run.running = false;
            s.run.exit = r.exitCode;
            if (s.run.stopRequested) {
                appendOutput('run', 'Игра остановлена.');
                setStatus('игра остановлена', 'ok');
            } else {
                appendOutput('run', 'Процесс завершился с кодом ' + r.exitCode + '.');
                setStatus('игра завершилась: код ' + r.exitCode, r.exitCode === 0 ? 'ok' : 'err');
            }
            renderAll();
        });
        s.bottom = 'output'; s.bottomCollapsed = false;
        setStatus('запуск: r2d --game ' + s.project.abs, 'ok');
        renderAll();
        return s.run;
    }

    function stop() {
        if (s.run && s.run.running) {
            s.run.stopRequested = true;
            appendOutput('run', 'Запрошена остановка игры.');
            s.run.handle.kill(); setStatus('остановка игры…', '');
        }
    }

    function tail(text) { return text.length > MAX_LOG ? text.slice(-MAX_LOG) : text; }

    async function buildToDialog() {
        if (!s.project) return;
        let dir = null;
        try { dir = await $.fs.pickFolder({ title: 'Куда собрать игру', path: s.project.abs }); }
        catch (e) { setStatus(e.message || String(e), 'err'); return; }
        if (dir) await buildPackage(dir);
    }
    // Любой файл проекта через окно ОС; файл вне проекта — понятный отказ.
    async function openFileDialog() {
        if (!s.project) return;
        const r = await pickProjectFile($, s.project.abs, { title: 'Открыть файл проекта' });
        if (r.error) { setStatus(r.error, 'err'); return; }
        if (r.rel) openFile(r.rel);
    }

    async function buildPackage(outDir) {
        if (!s.project) return;
        if (!(await saveAll())) { setStatus('сборка остановлена: не все файлы сохранены', 'err'); return; }
        const name = (s.project.title || 'game').replace(/[^\wЀ-ӿ.-]+/g, '_');
        const out = (outDir || s.project.abs + '/dist') + '/' + name;
        setStatus('сборка: validate → build…', '');
        const v = await tool(['validate', s.project.abs]);
        s.projectDiags = v.json ? (v.json.diagnostics || []).map(normalizeDiag) : [];
        if (v.json && v.json.errors) {
            appendOutput('build', 'Сборка остановлена: validate обнаружил ' + v.json.errors + ' ошибок.');
            s.bottom = 'problems'; renderBottom(); setStatus('сборка остановлена: проект с ошибками', 'err'); return;
        }
        const res = await tool(['build', s.project.abs, '--out', out]);
        appendOutput('build', res.ok ? 'Пакет создан: ' + out : 'Сборка завершилась ошибкой: ' + (res.error || 'см. диагностику выше'));
        s.bottom = 'output'; s.bottomCollapsed = false;
        renderBottom();
        setStatus(res.ok ? 'собрано: ' + out : 'сборка не удалась (см. Output)', res.ok ? 'ok' : 'err');
    }

    // --- палитра ----------------------------------------------------------------

    const COMMANDS = [
        { id: 'quickOpen', label: 'Перейти к файлу…', keys: 'Cmd/Ctrl+P', run: () => openPalette('files') },
        { id: 'symbols', label: 'Перейти к символу в файле…', keys: 'Cmd/Ctrl+Shift+O', run: () => openPalette('symbols') },
        { id: 'save', label: 'Файл: сохранить', keys: 'Cmd/Ctrl+S', run: () => save() },
        { id: 'saveAll', label: 'Файл: сохранить все', keys: 'Cmd/Ctrl+Shift+S', run: () => saveAll() },
        { id: 'close', label: 'Файл: закрыть вкладку', keys: 'Cmd/Ctrl+W', run: () => s.active && closeTab(s.active) },
        { id: 'find', label: 'Правка: найти в файле', keys: 'Cmd/Ctrl+F', run: () => openFind() },
        { id: 'find-word-project', label: 'Поиск: найти слово под кареткой в проекте', keys: 'Shift+F12', run: () => findWordInProject() },
        { id: 'gotoLine', label: 'Правка: перейти к строке…', keys: 'Cmd/Ctrl+G', run: () => openPalette('line') },
        { id: 'undo', label: 'Правка: отменить', keys: 'Cmd/Ctrl+Z', run: () => { const t = activeTab(); if (t && t.inst) studios.undo(t); else if (t && t.model && t.model.undo()) changed(); } },
        { id: 'redo', label: 'Правка: повторить', keys: 'Cmd/Ctrl+Shift+Z', run: () => { const t = activeTab(); if (t && t.inst) studios.redo(t); else if (t && t.model && t.model.redo()) changed(); } },
        { id: 'run', label: 'Запуск: запустить игру', keys: 'F5', run: () => run() },
        { id: 'stop', label: 'Запуск: остановить', keys: 'Shift+F5', run: () => stop() },
        { id: 'validate', label: 'Проект: проверить (r2d validate)', keys: '', run: () => validateProject() },
        { id: 'agent-session', label: 'Тесты: выполнить активную .agent.json сессию', keys: '', run: () => runAgentSession() },
        { id: 'migrate-project', label: 'Проект: перейти на schema_version 2', keys: '', run: () => migrateProject() },
        { id: 'reindex', label: 'Проект: перестроить связи проекта (граф)', keys: '', run: () => reindex() },
        { id: 'graph', label: 'Вид: панель графа проекта', keys: '', run: () => { graphPanel.setCollapsed(!graphPanel.state.collapsed); } },
        { id: 'build', label: 'Проект: собрать игру (validate → build)', keys: 'Cmd/Ctrl+Shift+B', run: () => buildPackage() },
        { id: 'refresh', label: 'Проект: обновить дерево файлов', keys: '', run: () => refreshTree() },
        { id: 'projects', label: 'Проект: открыть другой (Project Manager)', keys: '', run: () => { closeAllTabs(true); s.project = null; showPM(); } },
        { id: 'open-folder', label: 'Проект: открыть папку…', keys: '', run: () => openProjectDialog() },
        { id: 'open-file', label: 'Файл: открыть с диска…', keys: '', run: () => openFileDialog() },
        { id: 'build-to', label: 'Проект: собрать в папку…', keys: '', run: () => buildToDialog() },
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
            : mode === 'symbols' ? (() => {
                const t = activeTab();
                return t && t.model && t.lang === 'js'
                    ? javascriptDocumentSymbols(t.model.lines).map((symbol) => ({ label: symbol.label, detail: symbol.detail, symbol }))
                    : [];
            })()
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
        else if (r.item.symbol) { const t = activeTab(); if (t && t.model) { t.model.goto(r.item.symbol.line + 1, r.item.symbol.col + 1); code.ensureCaretVisible(); focusCode(); } }
        else if (typeof r.item.line === 'number') { const t = activeTab(); if (t && t.model) { t.model.goto(r.item.line, 1); code.ensureCaretVisible(); focusCode(); } }
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
            const dirty = t.model ? t.model.dirty : t.kind === 'studio' ? studios.dirty(t) : !!t.dirty;
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

    // Resolve the dotted expression beneath the caret to a public `$` API path.
    function apiPathAt(lines, caret) {
        const line = lines && lines[caret.line];
        if (typeof line !== 'string') return '';
        const candidates = [];
        const re = /(?:\$|[A-Za-z_$Ѐ-ӿ][\w$Ѐ-ӿ]*)(?:\s*\.\s*[A-Za-z_$Ѐ-ӿ][\w$Ѐ-ӿ]*)*/g;
        let match;
        while ((match = re.exec(line))) {
            const start = match.index, end = start + match[0].length;
            if (start <= caret.col && caret.col <= end || start <= caret.col - 1 && caret.col - 1 < end) {
                const path = match[0].replace(/\s+/g, '');
                if (path.startsWith('$.')) candidates.push(path);
            }
        }
        return candidates.sort((a, b) => b.length - a.length)[0] || '';
    }

    function renderInspector() {
        if (!s.project) return;
        const t = activeTab();
        let html = '<span class="insp-path">' + esc(t ? 'PROJECT / ' + t.path : 'PROJECT') + '</span><div class="insp-sec">';
        if (!t) {
            const p = s.project;
            html += inspectorField('Название', p.title) + inspectorField('Версия', p.version || '—') +
                inspectorField('Окно', (p.width || 1280) + ' × ' + (p.height || 720)) +
                inspectorField('Точка входа', manifest().entry, 'open:' + manifest().entry) +
                inspectorField('Манифест', 'project.json' + (manifest().v2 ? ' (schema 2)' : ''), 'open:project.json') +
                inspectorField('Файлов', String(s.entries.length));
            const m = manifest();
            html += '</div><div class="insp-sec"><span class="insp-label">Сцены</span>';
            if (m.scenes.length) {
                for (const name of m.scenes)
                    html += '<div class="tree-row" data-key="scene:' + esc(name) + '" style="padding-left: 4px;"><span class="tree-ico studio">' + icon('play_arrow') + '</span>' + esc(name) + (name === m.start ? '<span class="muted"> · старт</span>' : '') + '</div>';
                html += '<span class="insp-note">Клик — запустить игру с этой сценой (--scene). Список — из графа проекта.</span>';
            } else {
                html += '<span class="insp-note">' + (m.v2 ? 'В графе проекта сцен нет: добавьте $.scene.add(…) и сохраните код.' : 'Граф сцен строится для project.json со schema_version 2 (команда «Проект: перейти на schema_version 2»).') + '</span>';
            }
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
        if (s.graphSelected && s.graphNorm && graphVisible()) {
            const rows = describeGraph(s.graphNorm, s.graphSelected);
            if (rows.length) {
                html += '<div class="insp-sec"><span class="insp-label">Граф проекта</span>' +
                    rows.map((r) => inspectorField(r[0], r[1], r[2] ? 'gsrc:' + r[2].file + ':' + r[2].line : null)).join('') +
                    '<span class="insp-note">Граф только для чтения: связи берутся из editor.graph.</span></div>';
            }
        }
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
            const filters = [['all', 'Все'], ['run', 'Run'], ['build', 'Build'], ['editor', 'Editor']];
            const buttons = filters.map(([id, label]) => '<button id="output-filter-' + id + '" class="out-filter' + (s.outputFilter === id ? ' on' : '') + '" data-key="output-filter:' + id + '">' + label + '</button>').join('');
            const visible = s.outputEntries.filter((entry) => s.outputFilter === 'all' || entry.source === s.outputFilter);
            const sourceLabel = (source) => source === 'run' ? 'Run' : source === 'build' ? 'Build' : 'Editor';
            const rows = visible.map((entry) => '<div class="out-row"><span class="out-time">' + esc(entry.time.slice(11, 19)) +
                '</span><span class="out-source">' + sourceLabel(entry.source) + '</span><span class="out-text">' + esc(entry.text) + '</span></div>').join('');
            doc.html('bottom-body', '<div class="out-toolbar">' + buttons + '</div>' +
                (rows ? '<div class="out-log">' + rows + '</div>' : '<span class="empty">' +
                    (s.outputEntries.length ? 'Нет записей для выбранного фильтра.' : 'Вывод игры и команд r2d появится после запуска или проверки.') + '</span>'));
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
        doc.text('side-title', s.side === 'search' ? 'Поиск по проекту' : 'Проект');
        doc.cls('side-search', 'hidden', s.side !== 'search');
        doc.cls('bottom', 'collapsed', s.bottomCollapsed);
        // Граф проекта: под кодом и Project Settings; на весь центр — по кнопке «развернуть».
        const gv = graphVisible(), gp = graphPanel.state;
        doc.cls('gp', 'hidden', !gv);
        doc.cls('center', 'gp-full', gv && gp.full);
        if (gv) doc.style('gp', 'height', (gp.collapsed ? 40 : graphPanel.height()) + 'px');
        if (t && t.kind === 'studio' && t.api && !s.palette) studios.show(t, !(gv && gp.full));
        for (const r of ['project', 'search', 'run', 'tools']) doc.cls('rail-' + r, 'on', s.side === r && !s.sidebarHidden);
        code.invalidate();
    }

    function renderAll() {
        renderTabs(); renderHost(); renderInspector(); renderBottom(); renderStatus(); renderTree(); renderLayout(); renderCloseConfirm(); renderFileConflict();
        if (graphVisible()) graphPanel.render(true);
    }

    function changed() {
        const tab = activeTab();
        if (tab && tab.kind === 'code' && tab.lang === 'json') tab.jsonValidationPending = 0.35;
        code.ensureCaretVisible();
        renderTabs(); renderStatus();
        s.inspectorDirty = true;
        if (graphVisible()) graphPanel.head();
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
        doc.html('tb-search', icon('search') + ' &#160;Поиск по проекту');
        doc.html('tb-run', icon('play_arrow') + ' Run');
        doc.html('tb-stop', icon('stop') + ' Stop');
        doc.text('rail-project', icon('description'));
        doc.text('rail-search', icon('search'));
        doc.text('rail-run', icon('play_circle'));
        doc.text('rail-tools', icon('widgets'));
        doc.text('find-prev', icon('arrow_upward'));
        doc.text('find-next', icon('arrow_downward'));
        doc.text('find-close', icon('close'));

        doc.on('pm-open', 'click', () => openProjectDialog());
        doc.on('pm-new-browse', 'click', () => pickNewProjectDir());
        doc.on('pm-recent', 'click', (id, ev, key) => {
            if (!key) return;
            if (key.startsWith('rm:')) forgetRecent(key.slice(3));
            else if (key.startsWith('open:')) openProject(key.slice(5));
        });
        doc.on('pm-templates', 'click', (id, ev, key) => { if (key && s.pmNew) { s.pmNew.template = key; renderTemplates(); } });
        doc.on('pm-new-name', 'change', () => renderDest());
        doc.on('pm-create', 'click', () => createProject());
        doc.on('close-confirm-save', 'click', () => saveCloseConfirm());
        doc.on('close-confirm-discard', 'click', () => discardCloseConfirm());
        doc.on('close-confirm-cancel', 'click', () => cancelCloseConfirm());
        doc.on('file-conflict-overwrite', 'click', () => overwriteFileConflict());
        doc.on('file-conflict-reload', 'click', () => reloadFileConflict());
        doc.on('file-conflict-cancel', 'click', () => cancelFileConflict());

        doc.on('tb-search', 'click', showProjectSearch);
        doc.on('tb-run', 'click', () => run());
        doc.on('tb-stop', 'click', () => stop());
        doc.on('tb-back', 'click', () => navigate(-1));
        doc.on('tb-fwd', 'click', () => navigate(1));
        doc.on('tb-project', 'click', () => openPalette('commands'));

        doc.on('rail-project', 'click', () => { s.side = 'project'; s.sidebarHidden = !s.sidebarHidden; s.lastTreeHtml = ''; renderTree(); renderLayout(); });
        doc.on('rail-search', 'click', showProjectSearch);
        doc.on('search-input', 'change', () => searchProject(doc.value('search-input')));
        doc.on('rail-run', 'click', () => run());
        doc.on('rail-tools', 'click', () => openPalette('commands'));

        doc.on('side-body', 'click', (id, ev, key) => {
            if (!key) return;
            if (key.startsWith('search:')) {
                openSearchResult(parseInt(key.slice(7), 10));
            } else if (key.startsWith('d:')) {
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
        doc.on('code', 'mousedown', (id, ev, key) => {
            if (key && key.startsWith('completion:')) { focusCode(); return; }
            if (key && key.startsWith('fold:')) { focusCode(); return; }
            if (s.focus === 'find' || s.focus === 'palette') { doc.focus('find-input', false); }
            focusCode();
            code.mouseDown();
        });
        doc.on('code-gutter', 'click', (id, ev, key) => {
            if (key && key.startsWith('fold:')) code.toggleFoldAt(parseInt(key.slice(5), 10));
        });
        doc.on('code-completion', 'click', (id, ev, key) => {
            if (key && key.startsWith('completion:')) code.chooseCompletion(parseInt(key.slice(11), 10));
        });
        doc.on('find-prev', 'click', () => findStep(true));
        doc.on('find-next', 'click', () => findStep(false));
        doc.on('find-close', 'click', () => closeFind());
        doc.on('find-input', 'focus', () => { s.focus = 'find'; });

        doc.on('insp-body', 'click', (id, ev, key) => {
            if (!key) return;
            if (key.startsWith('open:')) { openFile(key.slice(5)); focusCode(); }
            else if (key.startsWith('gsrc:')) {
                const m = /^gsrc:(.*):(\d+)$/.exec(key);
                if (m) { openFile(m[1], parseInt(m[2], 10), 1); focusCode(); }
            }
            else if (key.startsWith('scene:')) run({ scene: key.slice(6) });
            else if (key.startsWith('line:')) { const t = activeTab(); if (t && t.model) { t.model.goto(parseInt(key.slice(5), 10), 1); code.ensureCaretVisible(); focusCode(); } }
        });

        for (const b of ['problems', 'output', 'console']) doc.on('bt-' + b, 'click', () => { s.bottom = b; s.bottomCollapsed = false; renderBottom(); renderLayout(); });
        doc.on('bt-toggle', 'click', () => { s.bottomCollapsed = !s.bottomCollapsed; renderBottom(); renderLayout(); });
        doc.on('bottom-body', 'click', (id, ev, key) => {
            if (s.bottom === 'output' && key && key.startsWith('output-filter:')) {
                s.outputFilter = key.slice('output-filter:'.length);
                renderBottom();
                return;
            }
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
        code.state.onCaret = () => { renderStatus(); renderInspector(); };
        code.state.onHover = (pos) => {
            const t = activeTab();
            const literalPath = pos && t && t.model && t.lang === 'js'
                ? apiPathAt(t.model.lines, pos) : '';
            const path = literalPath || (pos && t && t.model && t.lang === 'js'
                ? nodeApiPathAt(t.model.lines, pos) : '');
            const apiMeta = path && typeof $.__r2dApiDoc === 'function' ? $.__r2dApiDoc(path) : null;
            const builtin = !apiMeta && pos && t && t.model && t.lang === 'js'
                ? javascriptSymbolAt(t.model.lines, pos) : null;
            const meta = apiMeta || (builtin && builtin.metadata) || null;
            const next = apiMeta ? path : builtin ? builtin.path : '';
            code.state.hoverApiPath = next;
            code.setHoverHelp(next, meta);
        };
    }

    // --- кадр: горячие клавиши и опрос ------------------------------------------------

    function primary() { return $.input.down('cmd') || $.input.down('rcmd') || $.input.ctrlDown(); }

    function shortcuts() {
        const mod = primary(), shift = $.input.shiftDown();
        if (s.fileConflict) {
            if ($.input.pressed('escape')) cancelFileConflict();
            else if ($.input.pressed('enter')) overwriteFileConflict();
            return;
        }
        if (s.closeRequest) {
            if ($.input.pressed('escape')) cancelCloseConfirm();
            else if ($.input.pressed('enter')) saveCloseConfirm();
            return;
        }
        if ($.input.pressed('escape')) {
            if (s.palette) { closePalette(); return; }
            if (s.focus === 'find') { closeFind(); return; }
            if (s.focus === 'search') { s.side = 'project'; s.focus = 'none'; renderLayout(); return; }
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
        if (shift && !$.ui.typing() && s.focus === 'code' && $.input.pressed('f12')) findWordInProject();
        if (!mod || !s.project) return;
        if ($.input.pressed('p')) openPalette(shift ? 'commands' : 'files');
        if (shift && $.input.pressed('o')) openPalette('symbols');
        if (shift && $.input.pressed('f')) showProjectSearch();
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
        if (s.focus === 'search') {
            const query = String(doc.value('search-input') || '');
            if (query !== s.searchDraft) { s.searchDraft = query; s.searchDelay = 0.25; }
            if (s.searchDelay > 0) {
                s.searchDelay -= dt;
                if (s.searchDelay <= 0) searchProject(query);
            }
        }
        const t = activeTab();
        if (t && t.jsonValidationPending > 0) {
            t.jsonValidationPending -= dt;
            if (t.jsonValidationPending <= 0) validateJsonText(t);
        }
        if (t && t.model) {
            code.update(dt, s.focus === 'code', {
                find: openFind,
                gotoLine: () => openPalette('line'),
            });
        }
        if (t && t.kind === 'studio' && t.api && !s.palette) studios.place(t, doc.rect('host'));
        if (t && t.inst && !s.palette) studios.update(t, dt);
        if (graphVisible() && !s.palette) graphPanel.update(dt);
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
                if (p && typeof p.output === 'string' && p.output.length > s.run.outputLength) {
                    appendOutput('run', p.output.slice(s.run.outputLength));
                    s.run.outputLength = p.output.length;
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
        searchProject, openSearchResult, showProjectSearch, runAgentSession,
        manifest, migrateProject, reindex, checkIndex, graphInfo, refreshProjectJson, graph: graphPanel, showPM, createProject, openProjectDialog, pickNewProjectDir, openFileDialog,
        openPalette, closePalette, activeTab, closeTab, code, studios, extensions: extensionHost,
        openWith: (path, id) => openFile(rel(String(path)), 0, 0, id),
    };
}
