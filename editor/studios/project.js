// ===========================================================================
// Project Settings — студия Editor для project.json (docs/PROJECT_JSON.md §6.1).
//
// Форма правит только поддержанные настройки (project.*, runtime.*) и пишет их
// native `r2d project-set`: порядок, неизвестные поля и editor.graph остаются
// как были. Вкладка «JSON» — тот же файл текстом. Граф проекта здесь только
// показывается (статус, источники, диагностика) и перестраивается командой;
// сами связи читает панель графа.
// ===========================================================================

import { studioDoc, esc, diag, pickProjectFile } from '../lib/studio_kit.js';

export const meta = { id: 'project', title: 'Project Settings', icon: 'tune', match: (p) => p === 'project.json', also: (p) => p === 'project.json' };

// Поля формы: путь в project.json, значение по умолчанию (показывается, но не пишется без правки).
const FIELDS = [
    { sec: 'Проект', path: 'project.name', id: 'name', label: 'Название', def: '' },
    { path: 'project.version', id: 'version', label: 'Версия', def: '' },
    { sec: 'Запуск', path: 'runtime.entry', id: 'entry', label: 'Точка входа (JS)', def: 'main.js', file: true },
    { path: 'runtime.start_scene', id: 'start', label: 'Стартовая сцена', def: '', scene: true },
    { sec: 'Окно', path: 'runtime.window.title', id: 'wtitle', label: 'Заголовок окна', def: '', hint: 'по умолчанию — название проекта' },
    { path: 'runtime.window.width', id: 'width', label: 'Ширина, px', def: 1280, number: true },
    { path: 'runtime.window.height', id: 'height', label: 'Высота, px', def: 720, number: true },
    { path: 'runtime.window.fullscreen', id: 'fullscreen', label: 'Полный экран', def: false, bool: true },
];

const pick = (json, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), json);
const YES = 'да', NO = 'нет';

export function create(host) {
    const $ = host.$;
    const doc = studioDoc($, 'project');
    const st = { abs: '', text: '', json: null, v2: false, diags: [], busy: false, conflict: false, closed: false, graph: null };

    const root = () => host.root();

    function display(f, json) {
        const raw = pick(json, f.path);
        if (f.bool) return (raw === undefined ? f.def : raw === true) ? YES : NO;
        return raw === undefined ? String(f.def) : String(raw);
    }

    function load() {
        const text = $.fs.readText(st.abs);
        if (text === null || text === undefined) throw new Error('Не удалось прочитать ' + st.abs);
        let json;
        try { json = JSON.parse(text); } catch (e) { json = null; st.diags = [diag('SDK_JSON_SYNTAX', 'error', 'project.json не разобран: ' + (e.message || e), { asset: st.abs })]; }
        st.text = text;
        st.json = json && typeof json === 'object' && !Array.isArray(json) ? json : null;
        st.v2 = !!(st.json && st.json.schema_version === 2);
        st.conflict = false;
    }

    function scenesOf() {
        const g = host.graphInfo ? host.graphInfo() : null;
        return g ? g.scenes : [];
    }

    function renderBody() {
        let html = '';
        if (!st.json) {
            html = '<div class="ps-banner err">project.json не разобран. Откройте вкладку «JSON» и исправьте синтаксис.</div>';
        } else if (!st.v2) {
            html = '<div class="ps-banner">Манифест без <b>schema_version</b>: читается как минимальный (название, размер окна, версия). Граф проекта и визуальные настройки доступны со <b>schema_version 2</b>.</div>' +
                '<button id="ps-migrate" class="st-btn primary">Перейти на schema_version 2</button>' +
                '<span class="ps-h">Текущие значения</span><div class="ps-card">' +
                ['title', 'version', 'width', 'height'].filter((k) => st.json[k] !== undefined).map((k) =>
                    '<span class="ps-line">' + esc(k) + '<span class="muted">' + esc(String(st.json[k])) + '</span></span>').join('') + '</div>';
        } else {
            let first = true;
            for (const f of FIELDS) {
                if (f.sec) html += '<span class="ps-h' + (first ? ' first' : '') + '">' + esc(f.sec) + '</span>';
                first = false;
                let input;
                if (f.bool) input = '<select id="ps-' + f.id + '" class="st-in"><option value="' + NO + '">' + NO + '</option><option value="' + YES + '">' + YES + '</option></select>';
                else if (f.scene) {
                    const names = scenesOf();
                    input = '<select id="ps-' + f.id + '" class="st-in"><option value="">(не задана)</option>' +
                        names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('') + '</select>';
                } else input = '<input id="ps-' + f.id + '" class="st-in" type="text"/>';
                html += '<div class="ps-field"><label>' + esc(f.label) + '</label>' + input +
                    (f.file ? '<button class="st-btn st-browse" data-key="browse:' + f.id + '">…</button>' : '') +
                    (f.hint ? '<span class="ps-def">' + esc(f.hint) + '</span>' : '') + '</div>';
            }
            html += '<span class="ps-note">Пустое поле удаляет настройку из файла; значения по умолчанию в JSON не записываются, пока их не меняют. Неизвестные поля project.json сохраняются.</span>';
            html += '<span class="ps-h">Связи проекта</span><div id="ps-graph"></div>';
        }
        doc.html('ps-body', html);
        if (st.v2) {
            for (const f of FIELDS) {
                let v = display(f, st.json);
                // Стартовая сцена вне списка графа остаётся видимой как есть.
                if (f.scene && v && !scenesOf().includes(v)) {
                    doc.html('ps-' + f.id, '<option value="">(не задана)</option>' + [v].concat(scenesOf()).map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join(''));
                }
                doc.setValue('ps-' + f.id, v);
            }
            renderGraph();
        }
        renderState();
    }

    function renderGraph() {
        const info = host.graphInfo ? host.graphInfo() : null;
        let html;
        if (!info || !info.has) {
            html = '<div class="ps-card"><span class="ps-line">Граф ещё не построен.</span></div><button id="ps-reindex" class="st-btn">Построить связи проекта</button>';
        } else {
            const status = info.stale ? 'устарел' : info.status === 'partial' ? 'частично' : 'актуален';
            html = '<div class="ps-card"><span class="ps-line">Статус: <span class="' + (info.stale || info.status !== 'current' ? 'ps-pill-warn' : 'ps-pill-ok') + '">' + status + '</span>' +
                '<span class="muted">сцен ' + info.scenes.length + ' · объектов ' + info.objects + ' · связей ' + info.edges + ' · файлов ' + info.sources + '</span></span>' +
                (info.diagnostics || []).slice(0, 8).map((d) => '<span class="ps-diag">' + esc(d.code + ' · ' + d.file + ':' + d.line + ' — ' + d.message) + '</span>').join('') +
                '</div><button id="ps-reindex" class="st-btn">Перестроить связи</button>';
        }
        doc.html('ps-graph', html);
    }

    function pending() {
        const out = [];
        if (!st.json || !st.v2) return { pairs: out, error: null };
        for (const f of FIELDS) {
            const text = String(doc.value('ps-' + f.id) === null || doc.value('ps-' + f.id) === undefined ? '' : doc.value('ps-' + f.id)).trim();
            const base = display(f, st.json);
            if (text === base) continue;
            if (text === '') { if (pick(st.json, f.path) !== undefined) out.push(f.path + '='); continue; }
            if (f.number) {
                const n = Number(text);
                if (!Number.isInteger(n) || n < 1 || n > 16384) return { pairs: [], error: f.label + ': целое 1..16384' };
                out.push(f.path + '=' + n);
            } else if (f.bool) out.push(f.path + '=' + (text === YES ? 'true' : 'false'));
            else out.push(f.path + '=' + JSON.stringify(text));
        }
        return { pairs: out, error: null };
    }

    const dirty = () => { const p = pending(); return p.pairs.length > 0; };

    function renderState() {
        const d = dirty();
        doc.text('ps-state', st.conflict ? 'файл изменён извне' : d ? 'не сохранено' : 'сохранено');
        doc.cls('ps-state', 'err', st.conflict);
        doc.cls('ps-state', 'ok', !d && !st.conflict);
        doc.cls('ps-save', 'st-hidden', !st.v2);
        doc.cls('ps-reread', 'st-hidden', !st.conflict);
    }

    async function save() {
        if (st.busy || st.closed) return false;
        if (!st.v2) { st.diags = [diag('R2D207', 'error', 'Сохранение настроек требует schema_version 2', { asset: st.abs })]; host.changed(); return false; }
        const p = pending();
        if (p.error) { st.diags = [diag('EDITOR_PROJECT_FIELD', 'error', p.error, { asset: st.abs })]; renderState(); host.changed(); return false; }
        if (!p.pairs.length) return true;
        const disk = $.fs.readText(st.abs);
        if (disk !== st.text) {
            st.conflict = true;
            st.diags = [diag('EDITOR_WRITE_CONFLICT', 'error', 'project.json изменён вне Editor: нажмите «Перечитать» или сохраните через вкладку JSON', { asset: st.abs })];
            renderState(); host.changed();
            return false;
        }
        st.busy = true;
        try {
            const r = await host.backend(['project-set', root()].concat(p.pairs));
            if (st.closed) return false;
            if (!r.json || !r.json.ok) {
                const ds = r.json && r.json.diagnostics ? r.json.diagnostics : [];
                st.diags = ds.length ? ds.map((d) => Object.assign({}, d, { asset: st.abs })) : [diag('SDK_BACKEND_NO_JSON', 'error', 'project-set не вернул результат', { asset: st.abs })];
                host.changed();
                return false;
            }
            st.diags = [];
            load();
            renderBody();
            if (host.projectChanged) host.projectChanged();
            host.changed();
            return true;
        } finally { st.busy = false; }
    }

    // Файл на диске изменился по инициативе Editor (индекс графа): форма остаётся, база — новая.
    function rebase(discard) {
        if (st.closed) return;
        const keep = !discard && dirty() ? st.v2 && FIELDS.map((f) => [f.id, doc.value('ps-' + f.id)]) : null;
        if (discard) st.diags = [];
        load();
        renderBody();
        if (keep) for (const [id, v] of keep) doc.setValue('ps-' + id, v);
        renderState();
    }

    doc.on('ps-tab-json', 'click', () => host.openWith(st.abs, 'code'));
    doc.on('ps-tab-settings', 'click', () => {});
    doc.on('ps-save', 'click', () => save());
    doc.on('ps-reread', 'click', () => rebase(true));
    doc.on('ps-body', 'click', async (id, ev, key, target) => {
        if (target === 'ps-migrate' && host.migrate) host.migrate();
        else if (target === 'ps-reindex' && host.reindex) { await host.reindex(); rebase(false); }
        else if (key && key.startsWith('browse:')) {
            const f = FIELDS.find((x) => x.id === key.slice(7));
            if (!f) return;
            const r = await pickProjectFile($, root(), { title: 'Выберите файл: ' + f.label, path: root(), filters: [{ name: 'JS', ext: 'js;mjs' }] });
            if (r.error) { st.diags = [diag('EDITOR_ASSET_FILE', 'error', r.error, { asset: st.abs })]; host.changed(); return; }
            if (r.rel) { doc.setValue('ps-' + f.id, r.rel); renderState(); host.changed(); }
        }
    });
    doc.on('ps-body', 'change', () => { renderState(); host.changed(); });

    return {
        doc,
        async open(abs) { st.abs = abs; load(); renderBody(); },
        update() { if (!st.closed) renderState(); },
        layout() {},
        onActive() {},
        async save() { return save(); },
        undo() { return false; }, redo() { return false; },
        dirty,
        reload: () => rebase(false),
        reread: () => rebase(true),
        diagnostics: () => st.diags,
        snapshot: () => ({ dirty: dirty(), v2: st.v2, conflict: st.conflict, values: st.v2 && st.json ? Object.fromEntries(FIELDS.map((f) => [f.path, display(f, st.json)])) : null }),
        // Для агента и тестов: правка поля формы и чтение значений.
        setField(id, value) { doc.setValue('ps-' + id, String(value)); renderState(); host.changed(); },
        fieldValue: (id) => doc.value('ps-' + id),
        close() { st.closed = true; doc.unload(); },
    };
}
