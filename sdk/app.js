// ===========================================================================
// SDK как приложение R2D: состояние, операции и связка с интерфейсом RmlUi.
//
// Принцип «человек и агент — равные клиенты» (docs/SDK.md §5): каждая кнопка
// вызывает операцию `app.<имя>()`, и ровно те же операции доступны агенту
// через `eval` (`$.sdkApp.openProject('demos')`) и через снимок состояния
// `state.sdk` (`$.agent.expose`). Тяжёлая работа — только в нативном `r2d-sdk`
// через мост `$.sdk`; здесь нет ни разбора форматов, ни второй реализации
// проверок.
// ===========================================================================

import {
    escapeHtml, normalizeDir, absolutePath, joinPath, pushRecent, filterAssets, countTypes,
    findTool, summarize,
} from './lib/model.js';
import * as views from './lib/views.js';
import * as atlasModel from './lib/atlas_model.js';

const DOC = 'sdk/ui/shell.rml';
const STATE_FILE = 'sdk/state.local.json';
const REGISTRY_FILE = 'sdk_tools.json';
const SDK_VERSION = '0.1.0';
const MAX_DOC_CHARS = 60000;
const MAX_LOG_CHARS = 12000;

const DOCS = [
    { path: 'docs/SDK.md', title: 'SDK: архитектура и инструменты' },
    { path: 'Следующая цель SDK AGENT.md', title: 'Спецификация SDK (AGENTS)' },
    { path: 'SDK_AUDIT.md', title: 'Аудит репозитория' },
    { path: 'SDK_HANDOFF.md', title: 'Handoff между сессиями' },
    { path: 'docs/AGENT_API.md', title: 'Агентский протокол движка' },
    { path: 'docs/HIGH_LEVEL_API.md', title: 'Справочник API $' },
];

// Экраны, которые живут внутри оболочки и не требуют отдельного модуля.
const INTERNAL_ENTRIES = { launcher: 'projects', 'asset-browser': 'assets', diagnostics: 'diag' };

export function createApp($) {
    const state = {
        view: 'projects',
        project: null,            // { dir, abs, title, version, width, height, hasMain, hasManifest }
        recent: [],
        found: [],
        foundRoot: '',
        registry: { loaded: false, path: '', ok: false, tools: [], diagnostics: [] },
        assets: { loaded: false, entries: [], count: 0, truncated: false },
        filter: '',
        typeFilter: '',
        selected: null,
        diagnostics: [],
        diagnosticsSource: '',
        run: null,                // { handle, running, exitCode, output }
        busy: 0,
        status: 'готов',
        docPath: null,
        templates: { loaded: false, list: [], root: '' },
        templateSelected: null,
        engines: { loaded: false, list: [], selected: null },
        tool: null,               // открытый инструмент: { entry, id }
        log: [],
    };
    let doc = null;
    const toolModules = new Map();

    // --- Пути ----------------------------------------------------------------
    const base = () => $.fs.basePath() || '';
    const registryPath = () => absolutePath(base(), REGISTRY_FILE);

    // --- Диагностика и статус ---------------------------------------------------
    function setStatus(text, kind) {
        state.status = text;
        if (!doc) return;
        doc.text('status', escapeHtml(text));
        doc.cls('status', 'busy', kind === 'busy').cls('status', 'fail', kind === 'fail').cls('status', 'ok', kind !== 'busy' && kind !== 'fail');
    }

    function setDiagnostics(source, list) {
        state.diagnostics = Array.isArray(list) ? list : [];
        state.diagnosticsSource = source;
        renderDiagnostics();
    }

    function addDiagnostic(severity, code, message, extra) {
        const d = Object.assign({ code, severity, asset: null, location: null, message, details: null }, extra || {});
        state.diagnostics.push(d);
        renderDiagnostics();
        return d;
    }

    // --- Вызов бэкенда -----------------------------------------------------------
    // Любой сбой моста или CLI превращается в структурную диагностику: пустого
    // «ничего не произошло» в интерфейсе быть не должно.
    async function backend(args, label) {
        state.busy++;
        setStatus(label || ('r2d-sdk ' + args[0]), 'busy');
        try {
            const res = await $.sdk.tool(args);
            const json = res.json;
            if (!json) {
                setDiagnostics(label || args[0], [{
                    code: 'SDK_BACKEND_NO_JSON', severity: 'error', asset: null, location: null,
                    message: res.error || 'бэкенд не вернул JSON', details: { exitCode: res.exitCode, output: res.output.slice(0, 400) },
                }]);
            }
            return { ok: res.ok, json, raw: res };
        } catch (e) {
            const message = e && e.message ? e.message : String(e);
            setDiagnostics(label || args[0], [{ code: 'SDK_BRIDGE', severity: 'error', asset: null, location: null, message, details: null }]);
            return { ok: false, json: null, raw: null };
        } finally {
            state.busy--;
        }
    }

    function finishStatus(ok, okText, failText) {
        setStatus(ok ? okText : failText, ok ? '' : 'fail');
    }

    // --- Реестр инструментов ----------------------------------------------------
    async function loadRegistry(pathOverride) {
        const path = pathOverride ? absolutePath(base(), pathOverride) : registryPath();
        const r = await backend(['tools', '--registry', path], 'чтение sdk_tools.json');
        const json = r.json;
        if (json) {
            state.registry = {
                loaded: true, path, ok: !!json.ok,
                tools: (json.tools || []).map((t, i) => Object.assign({ index: i }, t)),
                diagnostics: json.diagnostics || [],
            };
            setDiagnostics('sdk_tools.json', json.diagnostics || []);
        }
        finishStatus(!!(json && json.ok), 'реестр: ' + (state.registry.tools.length) + ' инструментов', 'ошибки в реестре инструментов');
        renderTools();
        return state.registry;
    }

    // Диагностики реестра по записям: location.id или location.index.
    function diagsByTool() {
        const map = {};
        for (const d of state.registry.diagnostics) {
            const loc = d.location;
            if (!loc) continue;
            const key = loc.id || ('#' + loc.index);
            (map[key] = map[key] || []).push(d);
        }
        return map;
    }

    // --- Проекты ---------------------------------------------------------------
    async function openProject(dirText) {
        const dir = normalizeDir(dirText);
        if (!dir) {
            addDiagnostic('error', 'SDK_USAGE', 'Укажите каталог проекта');
            return null;
        }
        const abs = absolutePath(base(), dir);
        const r = await backend(['project', abs], 'открываю проект ' + dir);
        const json = r.json;
        if (!json || json.ok === false) {
            if (json) setDiagnostics('project', json.diagnostics || []);
            finishStatus(false, '', 'проект не открыт: ' + dir);
            return null;
        }
        setDiagnostics('project', json.diagnostics || []);
        state.project = {
            dir, abs, title: json.title, version: json.version, width: json.width, height: json.height,
            hasMain: json.hasMain, hasManifest: json.hasManifest,
        };
        state.recent = pushRecent(state.recent, dir);
        saveState();
        state.assets = { loaded: false, entries: [], count: 0, truncated: false };
        state.selected = null;
        renderProject();
        await refreshAssets();
        finishStatus(true, 'проект открыт: ' + (json.title || dir), '');
        return state.project;
    }

    async function findProjects(rootText) {
        const root = normalizeDir(rootText) || base() || '.';
        const abs = absolutePath(base(), root);
        const r = await backend(['projects', abs], 'поиск проектов в ' + root);
        const json = r.json;
        state.found = json && json.projects ? json.projects : [];
        state.foundRoot = abs;
        renderProject();
        finishStatus(!!(json && json.ok), 'найдено проектов: ' + state.found.length, 'поиск не удался');
        return state.found;
    }

    // --- Ассеты ----------------------------------------------------------------
    async function refreshAssets() {
        if (!state.project) {
            addDiagnostic('warning', 'SDK_NO_PROJECT', 'Сначала откройте проект');
            return null;
        }
        const r = await backend(['assets', state.project.abs, '--registry', registryPath()], 'сканирую ассеты');
        const json = r.json;
        if (json) {
            state.assets = {
                loaded: true, entries: json.entries || [], count: json.count || 0, truncated: !!json.truncated,
            };
            if (json.diagnostics && json.diagnostics.length) setDiagnostics('assets', json.diagnostics);
        }
        finishStatus(!!(json && json.ok), 'ассетов: ' + state.assets.count, 'не удалось прочитать ассеты');
        renderAssets();
        return state.assets;
    }

    function setFilter(query, type) {
        if (query !== undefined) state.filter = String(query || '');
        if (type !== undefined) state.typeFilter = String(type || '');
        renderAssets();
        return visibleAssets().length;
    }

    function visibleAssets() {
        return filterAssets(state.assets.entries, state.filter, state.typeFilter);
    }

    function selectAsset(path) {
        state.selected = path || null;
        renderAssets();
        return state.selected;
    }

    async function validateAsset(path) {
        const target = path || state.selected;
        if (!state.project || !target) {
            addDiagnostic('warning', 'SDK_NO_ASSET', 'Выберите файл в Asset Browser');
            return null;
        }
        const r = await backend(['validate', joinPath(state.project.abs, target)], 'проверяю ' + target);
        if (r.json) setDiagnostics('validate ' + target, r.json.diagnostics || []);
        const sum = summarize(state.diagnostics);
        finishStatus(!!(r.json && r.json.ok), 'проверка: ошибок ' + sum.errors + ', предупреждений ' + sum.warnings, 'проверка: есть ошибки');
        return r.json;
    }

    async function validateProject() {
        if (!state.project) {
            addDiagnostic('warning', 'SDK_NO_PROJECT', 'Сначала откройте проект');
            return null;
        }
        const r = await backend(['validate', joinPath(state.project.abs, 'project.json')], 'проверяю project.json');
        if (r.json) setDiagnostics('validate project.json', r.json.diagnostics || []);
        finishStatus(!!(r.json && r.json.ok), 'project.json в порядке', 'project.json: есть ошибки');
        return r.json;
    }

    // --- Инструменты -----------------------------------------------------------
    async function openTool(key, args) {
        const tool = findTool(state.registry.tools, key);
        if (!tool) {
            addDiagnostic('error', 'SDK_TOOL_NOT_FOUND', 'Инструмент «' + key + '» не найден в sdk_tools.json');
            return null;
        }
        if (!tool.valid) {
            addDiagnostic('error', 'SDK_TOOL_INVALID', 'Запись инструмента «' + tool.id + '» некорректна: см. диагностику реестра');
            return null;
        }
        if (INTERNAL_ENTRIES[tool.entry]) {
            const view = INTERNAL_ENTRIES[tool.entry];
            if (view === 'diag') return { id: tool.id, entry: tool.entry };
            showView(view);
            return { id: tool.id, entry: tool.entry };
        }
        // Без явного файла инструмент получает выбранный в Asset Browser ассет.
        const toolArgs = Object.assign({}, args || {});
        if (!toolArgs.assetAbs && state.project && state.selected) {
            toolArgs.asset = state.selected;
            toolArgs.assetAbs = joinPath(state.project.abs, state.selected);
        }
        // Экран инструмента — модуль sdk/tools/<entry>.js с экспортом open(app, args).
        try {
            let mod = toolModules.get(tool.entry);
            if (!mod) {
                mod = await import('./tools/' + tool.entry + '.js');
                toolModules.set(tool.entry, mod);
            }
            // Студия, которой нужен файл, без файла не открывается «в никуда»: ведём в Asset Browser
            // с фильтром по её файлам. Студии с `export const standalone = true` создают файл сами.
            if (!toolArgs.assetAbs && !mod.standalone && tool.assets && tool.assets.length) {
                return pickAssetFor(tool);
            }
            const session = await mod.open(app, Object.assign({ tool }, toolArgs));
            state.tool = { id: tool.id, entry: tool.entry };
            setStatus('открыт инструмент: ' + tool.name, '');
            return session || state.tool;
        } catch (e) {
            addDiagnostic('error', 'SDK_TOOL_SCREEN', 'Экран инструмента «' + tool.id + '» не открылся: ' +
                (e && e.message ? e.message : e), { details: { entry: tool.entry, stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : null } });
            return null;
        }
    }

    /** Ведёт в Asset Browser: показать только файлы инструмента и объяснить, что выбрать. */
    function pickAssetFor(tool) {
        const patterns = tool.assets || [];
        if (!state.project) {
            addDiagnostic('warning', 'SDK_NO_PROJECT', 'Для «' + tool.name + '» нужен файл: сначала откройте проект');
            showView('projects');
            return { id: tool.id, needsAsset: true, patterns };
        }
        showView('assets');
        setFilter(String(patterns[0] || '').replace(/^\*+/, ''), '');
        addDiagnostic('info', 'SDK_PICK_ASSET', 'Выберите файл (' + patterns.join(', ') + ') и нажмите «Открыть в инструменте»', { asset: tool.id });
        setStatus('выберите файл для «' + tool.name + '»', '');
        return { id: tool.id, needsAsset: true, patterns };
    }

    function closeTool() {
        state.tool = null;
        if (doc) doc.show();
        setStatus('готов', '');
    }

    async function openAsset(path) {
        const target = path || state.selected;
        const entry = state.assets.entries.find((e) => e.path === target);
        if (!entry) {
            addDiagnostic('warning', 'SDK_NO_ASSET', 'Выберите файл в Asset Browser');
            return null;
        }
        if (!entry.tool) {
            addDiagnostic('info', 'SDK_NO_TOOL_FOR_ASSET', 'Для типа «' + entry.type + '» нет инструмента в sdk_tools.json', { asset: entry.path });
            return null;
        }
        return openTool(entry.tool, { asset: entry.path, assetAbs: joinPath(state.project.abs, entry.path) });
    }

    // --- Запуск и сборка -------------------------------------------------------
    // opts (для агента и CI): { headless, frames, scene } — те же флаги движка.
    function runProject(opts) {
        if (!state.project) {
            addDiagnostic('warning', 'SDK_NO_PROJECT', 'Сначала откройте проект');
            return null;
        }
        if (state.run && state.run.running) {
            addDiagnostic('warning', 'SDK_ALREADY_RUNNING', 'Игра уже запущена');
            return state.run;
        }
        try {
            const args = ['--game', state.project.abs];
            if (opts && opts.scene) args.push('--scene', String(opts.scene));
            if (opts && opts.frames) args.push('--frames', String(opts.frames));
            if (opts && opts.headless) args.push('--headless');
            if (opts && opts.stats) args.push('--stats');
            const handle = $.sdk.launch(args);
            state.run = { handle, running: true, exitCode: null, output: '' };
            handle.done.then((r) => {
                state.run.running = false;
                state.run.exitCode = r.exitCode;
                state.run.output = r.output;
                state.run.killed = r.killed;
                renderRun();
                setStatus(r.killed ? 'игра остановлена' : 'игра завершена, код ' + r.exitCode, r.ok || r.killed ? '' : 'fail');
            });
            setStatus('игра запущена', 'busy');
        } catch (e) {
            addDiagnostic('error', 'SDK_BRIDGE', e && e.message ? e.message : String(e));
        }
        renderRun();
        return state.run;
    }

    function stopProject() {
        if (!state.run || !state.run.running) {
            addDiagnostic('info', 'SDK_NOT_RUNNING', 'Игра не запущена');
            return false;
        }
        return state.run.handle.kill();
    }

    async function buildProject(outText, opts) {
        if (!state.project) {
            addDiagnostic('warning', 'SDK_NO_PROJECT', 'Сначала откройте проект');
            return null;
        }
        const out = absolutePath(base(), normalizeDir(outText || 'build/game'));
        const args = ['build', state.project.abs, '--out', out];
        if (opts && opts.encrypt === false) args.push('--no-encrypt');
        const r = await backend(args, 'сборка в ' + out);
        if (r.json) {
            setDiagnostics('build', r.json.diagnostics || []);
            state.log = String(r.json.outputTail || '').split(/\r?\n/).slice(-80);
        }
        finishStatus(!!(r.json && r.json.ok), 'сборка готова: ' + out, 'сборка не удалась');
        renderRun();
        return r.json;
    }

    // --- Шаблоны проектов (нативные `templates` и `new`) --------------------------------------
    async function loadTemplates() {
        const r = await backend(['templates', '--root', absolutePath(base(), 'sdk/templates')], 'читаю шаблоны');
        const json = r.json;
        state.templates = { loaded: !!json, list: json && json.templates ? json.templates : [], root: json && json.root ? json.root : '' };
        if (json && json.diagnostics && json.diagnostics.length) setDiagnostics('templates', json.diagnostics);
        finishStatus(!!(json && json.ok), 'шаблонов: ' + state.templates.list.length, 'не удалось прочитать шаблоны');
        renderTemplates();
        return state.templates;
    }

    function selectTemplate(id) {
        state.templateSelected = state.templates.list.some((t) => t.id === id) ? id : null;
        renderTemplates();
        return state.templateSelected;
    }

    async function createFromTemplate(destText) {
        const dest = normalizeDir(destText);
        if (!state.templateSelected) {
            addDiagnostic('warning', 'SDK_NO_TEMPLATE', 'Сначала выберите шаблон');
            return null;
        }
        if (!dest) {
            addDiagnostic('error', 'SDK_USAGE', 'Укажите каталог нового проекта');
            return null;
        }
        const abs = absolutePath(base(), dest);
        const r = await backend(['new', state.templateSelected, abs, '--root', absolutePath(base(), 'sdk/templates')], 'создаю проект ' + dest);
        if (r.json) setDiagnostics('new', r.json.diagnostics || []);
        finishStatus(!!(r.json && r.json.ok), 'проект создан: ' + dest, 'проект не создан');
        if (r.json && r.json.ok) await openProject(dest);
        return r.json;
    }

    // --- Сборки движка (нативный `engines`) -------------------------------------------------------
    async function loadEngines() {
        const r = await backend(['engines'], 'ищу сборки движка');
        const json = r.json;
        state.engines = { loaded: !!json, list: json && json.engines ? json.engines : [], selected: json ? json.selected : null };
        if (json && json.diagnostics && json.diagnostics.length) setDiagnostics('engines', json.diagnostics);
        finishStatus(!!(json && json.ok), 'сборок движка: ' + state.engines.list.length, 'движок не найден');
        renderEngines();
        return state.engines;
    }

    // Отладка = запуск со статистикой кадра (`--stats`): тот же движок, те же флаги.
    function debugProject(opts) {
        return runProject(Object.assign({ stats: true }, opts || {}));
    }

    // Пакет без шифрования — обычный читаемый файл (`build --no-encrypt`).
    async function packageProject(outText) {
        return buildProject(outText, { encrypt: false });
    }

    // --- Документация -----------------------------------------------------------
    function showDoc(path) {
        const text = $.fs.readText(path);
        state.docPath = path;
        if (text === null || text === undefined) {
            addDiagnostic('error', 'SDK_DOC_MISSING', 'Документ не найден: ' + path, { asset: path });
            if (doc) doc.text('doc-text', '');
            return null;
        }
        if (doc) doc.text('doc-text', escapeHtml(text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + '\n…' : text));
        renderDocs();
        return text.length;
    }

    // --- Навигация -------------------------------------------------------------
    const VIEWS = ['projects', 'assets', 'tools', 'templates', 'run', 'engines', 'docs'];
    function showView(name) {
        if (!VIEWS.includes(name)) return false;
        state.view = name;
        if (name === 'templates' && !state.templates.loaded) loadTemplates();
        if (name === 'engines' && !state.engines.loaded) loadEngines();
        if (name === 'docs' && !state.docPath) showDoc(DOCS[0].path);
        if (doc) {
            for (const v of VIEWS) {
                doc.cls('view-' + v, 'hidden', v !== name);
                doc.cls('nav-' + v, 'on', v === name);
            }
        }
        return true;
    }

    // --- Сохранение настроек --------------------------------------------------
    function loadState() {
        const saved = $.fs.readJSON(STATE_FILE, null);
        if (saved && Array.isArray(saved.recent)) state.recent = saved.recent.filter((s) => typeof s === 'string').slice(0, 8);
    }
    function saveState() {
        $.fs.writeJSON(STATE_FILE, { recent: state.recent });
    }

    // --- Отрисовка ----------------------------------------------------------------
    function renderProject() {
        if (!doc) return;
        doc.html('project-info', views.projectPanel(state.project));
        doc.html('recent-list', views.pathRows(state.recent, 'Недавних проектов нет.'));
        doc.html('found-list', views.pathRows(state.found, 'Нажмите «Найти проекты».'));
        doc.text('project-badge', escapeHtml(state.project ? state.project.title || state.project.dir : 'проект не открыт'));
        if (state.project) doc.setValue('project-path', state.project.dir);
    }

    function renderAssets() {
        if (!doc) return;
        const list = visibleAssets();
        doc.html('asset-list', state.assets.loaded ? views.assetRows(list, state.selected) :
            '<p class="empty">Откройте проект, чтобы увидеть его файлы.</p>');
        doc.html('type-chips', views.typeFilters(countTypes(state.assets.entries), state.typeFilter));
        doc.text('asset-selected', escapeHtml(state.selected || 'файл не выбран'));
    }

    function renderTools() {
        if (!doc) return;
        doc.html('tool-list', state.registry.loaded
            ? views.toolCards(state.registry.tools, diagsByTool())
            : '<p class="empty">Реестр ещё не прочитан.</p>');
    }

    function renderTemplates() {
        if (!doc) return;
        doc.html('template-list', state.templates.loaded
            ? views.templateCards(state.templates.list, state.templateSelected)
            : '<p class="empty">Шаблоны ещё не прочитаны.</p>');
        doc.text('template-selected', escapeHtml(state.templateSelected ? 'шаблон: ' + state.templateSelected : 'шаблон не выбран'));
    }

    function renderEngines() {
        if (!doc) return;
        doc.html('engine-list', state.engines.loaded ? views.engineCards(state.engines.list) : '<p class="empty">Сборки ещё не искали.</p>');
    }

    function renderDiagnostics() {
        if (!doc) return;
        const sum = summarize(state.diagnostics);
        doc.html('diag-list', views.diagRows(state.diagnostics));
        doc.text('diag-counts', 'ошибок ' + sum.errors + ' · предупреждений ' + sum.warnings +
            (state.diagnosticsSource ? ' · ' + escapeHtml(state.diagnosticsSource) : ''));
    }

    function renderRun() {
        if (!doc) return;
        const run = state.run;
        let text = 'процессов нет';
        if (run) text = run.running ? 'игра запущена…' : 'игра завершена, код ' + run.exitCode;
        doc.text('run-status', escapeHtml(text));
        const output = run ? run.output : state.log.join('\n');
        doc.text('run-log', escapeHtml(String(output || '').slice(-MAX_LOG_CHARS)));
    }

    function renderDocs() {
        if (doc) doc.html('doc-list', views.docRows(DOCS, state.docPath));
    }

    function renderAll() {
        renderProject();
        renderAssets();
        renderTools();
        renderTemplates();
        renderEngines();
        renderDiagnostics();
        renderRun();
        renderDocs();
    }

    // --- Подписки интерфейса -----------------------------------------------------
    function wire() {
        const nav = {
            'nav-projects': 'projects', 'nav-assets': 'assets', 'nav-tools': 'tools', 'nav-templates': 'templates',
            'nav-run': 'run', 'nav-engines': 'engines', 'nav-docs': 'docs',
        };
        for (const id of Object.keys(nav)) doc.on(id, 'click', () => showView(nav[id]));

        doc.on('btn-open-project', 'click', () => openProject(doc.value('project-path')));
        doc.on('btn-find-projects', 'click', () => findProjects(doc.value('project-path')));
        doc.on('recent-list', 'click', (id, ev, key) => { if (key) openProject(key); });
        doc.on('found-list', 'click', (id, ev, key) => { if (key) openProject(joinPath(state.foundRoot, key)); });

        doc.on('btn-asset-filter', 'click', () => setFilter(doc.value('asset-filter')));
        doc.on('btn-assets-refresh', 'click', () => refreshAssets());
        doc.on('asset-list', 'click', (id, ev, key) => { if (key) selectAsset(key); });
        doc.on('type-chips', 'click', (id, ev, key) => setFilter(undefined, key));
        doc.on('btn-asset-open', 'click', () => openAsset());
        doc.on('btn-asset-validate', 'click', () => validateAsset());

        doc.on('tool-list', 'click', (id, ev, key) => { if (key) openTool(key); });
        doc.on('btn-tools-reload', 'click', () => loadRegistry());

        doc.on('template-list', 'click', (id, ev, key) => { if (key) selectTemplate(key); });
        doc.on('btn-template-create', 'click', () => createFromTemplate(doc.value('template-dest')));
        doc.on('btn-engines-refresh', 'click', () => loadEngines());
        doc.on('btn-debug', 'click', () => debugProject());
        doc.on('btn-package', 'click', () => packageProject(doc.value('build-out')));

        doc.on('btn-run', 'click', () => runProject());
        doc.on('btn-stop', 'click', () => stopProject());
        doc.on('btn-validate-project', 'click', () => validateProject());
        doc.on('btn-build', 'click', () => buildProject(doc.value('build-out')));

        doc.on('doc-list', 'click', (id, ev, key) => { if (key) showDoc(key); });
        doc.on('btn-diag-clear', 'click', () => setDiagnostics('', []));
    }

    // --- Снимок для агента ---------------------------------------------------------
    function snapshot() {
        const sum = summarize(state.diagnostics);
        return {
            version: SDK_VERSION,
            view: state.view,
            status: state.status,
            busy: state.busy,
            bridge: $.sdk.available(),
            project: state.project ? { dir: state.project.dir, title: state.project.title, hasMain: state.project.hasMain } : null,
            registry: {
                loaded: state.registry.loaded, ok: state.registry.ok,
                tools: state.registry.tools.map((t) => ({ id: t.id, entry: t.entry, valid: t.valid })),
            },
            assets: { loaded: state.assets.loaded, count: state.assets.count, visible: visibleAssets().length, selected: state.selected },
            diagnostics: { errors: sum.errors, warnings: sum.warnings, infos: sum.infos, source: state.diagnosticsSource,
                           codes: state.diagnostics.map((d) => d.code) },
            run: state.run ? { running: state.run.running, exitCode: state.run.exitCode } : null,
            tool: state.tool,
            templates: { loaded: state.templates.loaded, count: state.templates.list.length, selected: state.templateSelected },
            engines: { loaded: state.engines.loaded, count: state.engines.list.length, selected: state.engines.selected },
            // Снимок каждой открытой студии: список заполняют сами студии (app.studios[id]).
            studios: studioSnapshots(),
        };
    }

    function studioSnapshots() {
        // Прежние ключи остаются в снимке (null, пока студия не открыта): тесты и агенты на них опираются.
        const out = { sprite: null, animation: null, re2d: null, automation: null, world: null, baker: null };
        for (const key of Object.keys(app.studios || {})) {
            const st = app.studios[key];
            out[key] = st && st.snapshot ? st.snapshot() : null;
        }
        return out;
    }

    // --- Публичный объект приложения ---------------------------------------------------
    const app = {
        $, state,
        loadRegistry, openProject, findProjects, refreshAssets, setFilter, selectAsset,
        validateAsset, validateProject, openTool, closeTool, openAsset,
        runProject, stopProject, buildProject, debugProject, packageProject, showDoc, showView, snapshot,
        loadTemplates, selectTemplate, createFromTemplate, loadEngines,
        setStatus, setDiagnostics, addDiagnostic, backend,
        visibleAssets,
        atlasModel,                       // чистая модель атласа: агент правит данные теми же функциями, что студия
        studios: {},
        atlasSessions: new Map(),
        get doc() { return doc; },
        renderAll,
    };

    loadState();
    doc = $.ui.doc(DOC);
    doc.show();
    wire();
    doc.text('sdk-version', SDK_VERSION);
    showView('projects');
    renderAll();
    $.sdkApp = app;
    if ($.agent && $.agent.expose) $.agent.expose('sdk', snapshot);

    // Живой вывод запущенной игры.
    $.update(() => {
        const run = state.run;
        if (!run || !run.running || $.time.frame() % 20 !== 0) return;
        const peek = run.handle.peek();
        if (peek) {
            run.output = peek.output;
            renderRun();
        }
    });

    loadRegistry();
    return app;
}
