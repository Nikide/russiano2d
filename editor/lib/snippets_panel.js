// ===========================================================================
// Панель «Кирпичики» (docs/SNIPPETS.md): каталог пакетов, подключение к объекту
// графа, Inspector полей и генерация generated/snippets.
//
// Все операции — команды того же r2d (`r2d snippet …`): панель не проверяет
// и не пишет project.json сама, а показывает ответ backend с кодами SNIP*.
// Здесь только отрисовка RmlUi и разбор значений полей формы.
// ===========================================================================

import { escapeRml as esc } from './highlight.js';

const YES = 'да';
const NO = 'нет';
const ASSET_EXT = {
    image: ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.qoi'],
    audio: ['.wav', '.ogg', '.mp3', '.flac'],
    animation: ['.atlas.json', '.anim.json', '.png'],
    data: ['.json', '.csv', '.txt'],
    rml: ['.rml'],
};

/** Значение поля формы → JSON-текст для `r2d snippet set` или null (пусто). */
export function fieldToJson(field, raw, rawY) {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    switch (field.type) {
        case 'number': case 'int': return text === '' ? null : (Number.isFinite(Number(text)) ? String(Number(text)) : JSON.stringify(text));
        case 'bool': return text === '' ? null : (text === YES ? 'true' : 'false');
        case 'vec2': {
            const y = rawY === null || rawY === undefined ? '' : String(rawY).trim();
            if (text === '' && y === '') return null;
            const part = (v) => v === '' ? 0 : Number.isFinite(Number(v)) ? Number(v) : v;
            return JSON.stringify([part(text), part(y)]);
        }
        case 'list': {
            if (text === '') return null;
            if (text.startsWith('[')) { try { return JSON.stringify(JSON.parse(text)); } catch (_) { return JSON.stringify(text); } }
            return JSON.stringify(text.split(',').map((x) => x.trim()).filter(Boolean));
        }
        default: return text === '' ? null : JSON.stringify(text);
    }
}

/** Текущее значение (или default) для показа в поле. */
export function displayValue(field, values) {
    const v = values && Object.prototype.hasOwnProperty.call(values, field.id) ? values[field.id] : field.default;
    if (v === undefined || v === null) return '';
    if (field.type === 'bool') return v ? YES : NO;
    if (field.type === 'list') return Array.isArray(v) ? JSON.stringify(v) : '';
    return String(v);
}

/** Файлы проекта, подходящие под assetKind поля. */
export function assetChoices(entries, kind) {
    const exts = ASSET_EXT[kind] || [];
    return (entries || []).map((e) => e.path).filter((p) => exts.some((x) => p.toLowerCase().endsWith(x))).sort();
}

export function createSnippetsPanel($, doc, host) {
    const icon = (name) => $.ui.icon(name) || '';
    const st = {
        catalog: [], loaded: false, query: '', owner: null, open: null,
        section: null, diags: [], gen: null, busy: false, tick: 0, renderedAt: -10,
        author: false, diff: null, updates: null, category: '', undo: [], redo: [], snap: 0,
    };
    // Кадры: change от только что пересозданных полей (doc.html) приходит в
    // ближайшие кадры и не является правкой пользователя.
    $.update(() => { st.tick++; });

    const pkg = (id) => st.catalog.find((p) => p.id === id) || null;
    const lower = (x) => String(x || '').toLowerCase();

    function objects() {
        const json = host.projectJson();
        const g = json && json.editor && json.editor.graph;
        const list = (g && Array.isArray(g.entities) ? g.entities : []).filter((e) => e.type === 'object' && e.public_id);
        return [{ key: 'project', label: 'Проект целиком' }].concat(list.map((e) => ({ key: e.key, label: '#' + e.public_id + (e.tag ? ' · ' + e.tag : '') })));
    }

    function section() {
        const json = host.projectJson();
        return (json && json.editor && json.editor.snippets) || { instances: [], sets: [] };
    }

    async function load(force) {
        if (st.loaded && !force) return;
        const res = await host.tool(['snippet', 'catalog', '--project', host.root(), '--fields']);
        st.catalog = res.json && Array.isArray(res.json.packages) ? res.json.packages : [];
        st.loaded = true;
        if (!st.owner) {
            const objs = objects();
            st.owner = objs.length > 1 ? objs[1].key : 'project';
        }
        render();
    }

    function report(res, okText) {
        const j = res.json || {};
        st.diags = (j.diagnostics || []).filter((d) => d.severity !== 'info');
        if (j.ok) host.setStatus(okText, 'ok');
        else host.setStatus('Кирпичики: ' + ((st.diags[0] && (st.diags[0].code + ' — ' + st.diags[0].message)) || res.error || 'ошибка'), 'err');
        return !!j.ok;
    }

    // Отмена/повтор: снимок editor.snippets до правки → .r2d/snippets-undo/*.json;
    // откат — тем же backend (r2d snippet restore), а не правкой файла из UI.
    const MUTATING = new Set(['add', 'set', 'remove', 'entity', 'own', 'update', 'new']);
    function snapshot() {
        const path = host.root() + '/.r2d/snippets-undo/' + (st.snap++) + '.json';
        $.fs.writeJSON(path, JSON.parse(JSON.stringify(section())));
        return path;
    }
    async function restoreFrom(path, okText) {
        const res = await host.tool(['snippet', 'restore', host.root(), '--from', path]);
        const ok = report(res, okText);
        if (res.json && res.json.written) host.projectChanged();
        return ok;
    }
    async function undo() {
        if (st.busy || !st.undo.length) return false;
        st.busy = true;
        try { const cur = snapshot(); const prev = st.undo.pop(); if (await restoreFrom(prev, 'отменено')) st.redo.push(cur); else st.undo.push(prev); }
        finally { st.busy = false; render(); }
        return true;
    }
    async function redo() {
        if (st.busy || !st.redo.length) return false;
        st.busy = true;
        try { const cur = snapshot(); const next = st.redo.pop(); if (await restoreFrom(next, 'повторено')) st.undo.push(cur); else st.redo.push(next); }
        finally { st.busy = false; render(); }
        return true;
    }

    async function run(args, okText, after) {
        if (st.busy) return false;
        if (host.manifestDirty()) { host.setStatus('сначала сохраните project.json: Кирпичики пишут его сами', 'err'); return false; }
        st.busy = true;
        try {
            const before = MUTATING.has(args[1]) && args[1] !== 'new' ? snapshot() : null;
            const res = await host.tool(args);
            if (before && res.json && res.json.written) { st.undo.push(before); if (st.undo.length > 50) st.undo.shift(); st.redo = []; }
            const ok = report(res, okText);
            if (res.json && res.json.written) { host.projectChanged(); if (MUTATING.has(args[1])) { st.gen = null; st.diff = null; } }
            if (after) after(res.json || {});
            return ok;
        } finally { st.busy = false; render(); }
    }

    const add = (id) => run(['snippet', 'add', host.root(), id, '--owner', st.owner], 'подключено: ' + id,
        (j) => { if (j.added && j.added.length) st.open = j.added[j.added.length - 1]; });
    const remove = (iid) => run(['snippet', 'remove', host.root(), iid], 'удалено: ' + iid);
    const toggle = (inst) => run(['snippet', 'set', host.root(), inst.id, inst.disabled ? 'disabled=' : 'disabled=true'],
        inst.disabled ? 'включено: ' + inst.id : 'отключено: ' + inst.id);

    /** Новый объект из Editor: editor.graph (origin: graph); узел создаёт generated JS. */
    async function createEntity(id, tag, opts) {
        id = String(id || '').trim(); tag = String(tag || '').trim() || id;
        if (!id) { host.setStatus('укажите id объекта', 'err'); return false; }
        const o = Object.assign({ x: 200, y: 200, w: 32, h: 32, body: 'dynamic' }, opts || {});
        const ok = await run(['snippet', 'entity', host.root(), '--id', id, '--tag', tag, '--x', String(o.x), '--y', String(o.y), '--w', String(o.w), '--h', String(o.h), '--body', o.body],
            'объект #' + id + ' создан', (j) => { if (j.written) { st.owner = 'object:' + id; st.open = null; } });
        return ok;
    }

    /** Автор пакета: каркас пакета проекта и переход к его исходнику. */
    async function createPackage(id, title, kind = 'behavior', deps = '') {
        id = String(id || '').trim();
        if (!id) { host.setStatus('укажите id пакета (например game.spin)', 'err'); return false; }
        const args = ['snippet', 'new', host.root(), id, '--title', String(title || '').trim() || id, '--kind', kind];
        if (kind === 'kit') args.push('--deps', String(deps || '').split(',').map((x) => x.trim()).filter(Boolean).join(','));
        const ok = await run(args, 'пакет проекта ' + id + ' создан');
        if (ok) { await load(true); host.filesChanged(); host.openFile('snippets/' + id + (kind === 'kit' ? '/snippet.json' : '/src/behavior.js'));  }
        return ok;
    }

    async function generate(overwrite) {
        const args = ['snippet', 'generate', host.root(), '--write'];
        if (overwrite) args.push('--overwrite');
        await run(args, 'generated/snippets обновлён', (j) => { st.gen = j; if (j.written) host.filesChanged(); });
    }

    async function preview() {
        const res = await host.tool(['snippet', 'generate', host.root(), '--print']);
        st.gen = res.json || null;
        st.diff = null;
        for (const f of (st.gen && st.gen.files) || []) f.before = $.fs.readText(host.root() + '/' + f.path) || '';
        report(res, st.gen && st.gen.stale ? 'есть изменения для генерации' : 'generated/snippets актуален');
        render();
    }

    async function checkUpdates() {
        const res = await host.tool(['snippet', 'update', host.root(), '--dry-run']);
        st.updates = res.json || null;
        report(res, 'проверка обновлений завершена');
        render();
    }

    /** Поле формы поменялось: отправить изменённые значения открытого экземпляра. */
    async function change(target) {
        const inst = (section().instances || []).find((x) => x.id === st.open);
        const p = inst && pkg(inst.package);
        if (!p) return;
        const pairs = [];
        for (const f of p.fields || []) {
            if (target !== 'sn-f-' + f.id && target !== 'sn-f-' + f.id + '-y') continue;
            const base = displayValue(f, inst.values || {});
            const raw = doc.value('sn-f-' + f.id);
            if (f.type === 'bool' && raw === '' && !Object.prototype.hasOwnProperty.call(inst.values || {}, f.id)) continue;
            if (raw === null || raw === undefined) continue; // скрытое visibleIf поле не изменялось
            const rawY = f.type === 'vec2' ? doc.value('sn-f-' + f.id + '-y') : null;
            const now = f.type === 'vec2' ? String(raw || '') + ',' + String(rawY || '') : String(raw === null || raw === undefined ? '' : raw).trim();
            const was = f.type === 'vec2' ? (Array.isArray((inst.values || {})[f.id] ?? f.default) ? ((inst.values || {})[f.id] ?? f.default).join(',') : ',') : base;
            if (now === was) continue;
            const json = fieldToJson(f, raw, rawY);
            pairs.push(f.id + '=' + (json === null ? '' : json));
        }
        if (pairs.length) await run(['snippet', 'set', host.root(), inst.id].concat(pairs), 'сохранено: ' + pairs.map((x) => x.split('=')[0]).join(', '));
    }

    // --- отрисовка ---------------------------------------------------------------

    // Выбранная опция — атрибутом selected: setValue у <select> до готовности
    // опций роняет RmlUi WidgetDropDown (SIGSEGV в GetSelection).
    const opt = (value, text, cur) => '<option value="' + esc(value) + '"' + (String(value) === String(cur) ? ' selected="selected"' : '') + '>' + esc(text) + '</option>';

    function fieldHtml(f, inst) {
        const id = 'sn-f-' + f.id;
        const cur = displayValue(f, inst.values || {});
        const label = esc(f.label || f.id) + (f.required ? ' *' : '') + (f.unit ? ' <span class="muted">' + esc(f.unit) + '</span>' : '');
        let input;
        if (f.type === 'bool') {
            const b = (inst.values || {})[f.id] === undefined ? '' : cur;
            input = '<select id="' + id + '" class="st-in">' + opt('', '(по умолчанию)', b) + opt(YES, YES, b) + opt(NO, NO, b) + '</select>';
        } else if (f.type === 'enum') {
            input = '<select id="' + id + '" class="st-in">' + (f.options || []).map((o) => {
                const v = typeof o === 'string' ? o : o.value;
                const t = typeof o === 'string' ? o : (o.label || o.value);
                return opt(v, t, cur);
            }).join('') + '</select>';
        } else if (f.type === 'asset') {
            const files = assetChoices(host.entries(), f.assetKind);
            const list = cur && !files.includes(cur) ? [cur].concat(files) : files;
            input = '<select id="' + id + '" class="st-in">' + opt('', '(не выбран)', cur) + list.map((p) => opt(p, p, cur)).join('') + '</select>';
        } else if (f.type === 'vec2') {
            const v = (inst.values || {})[f.id] ?? f.default;
            const arr = Array.isArray(v) ? v : ['', ''];
            input = '<input id="' + id + '" class="st-in sn-half" type="text" value="' + esc(String(arr[0])) + '"/>' +
                '<input id="' + id + '-y" class="st-in sn-half" type="text" value="' + esc(String(arr[1])) + '"/>';
        } else {
            // Значение — атрибутом: setValue сразу после doc.html теряется (элемент ещё не создан).
            input = '<input id="' + id + '" class="st-in" type="text" value="' + esc(cur) + '"/>';
        }
        const errs = st.diags.filter((d) => d.location && d.location.field === f.id && d.location.package === inst.package);
        return '<div class="sn-field"><label>' + label + '</label>' + input +
            (f.hint ? '<span class="sn-hint">' + esc(f.hint) + '</span>' : '') +
            (f.min !== undefined || f.max !== undefined ? '<span class="sn-hint">' + esc((f.min ?? '…') + ' … ' + (f.max ?? '…')) + '</span>' : '') +
            errs.map((d) => '<span class="sn-err">' + esc(d.code + ' · ' + d.message) + '</span>').join('') + '</div>';
    }

    function filtered() {
        const q = lower(st.query);
        return st.catalog.filter((p) => p.valid && (!st.category || p.category === st.category) && (!q || lower(p.id + ' ' + p.title + ' ' + p.description + ' ' + p.category + ' ' + (p.tags || []).join(' ')).includes(q)));
    }

    function catalogHtml(list) {
        let result = '';
        let cat = '';
        for (const p of list.slice().sort((a, b) => (a.category + a.title).localeCompare(b.category + b.title))) {
            if (p.category !== cat) { cat = p.category; result += '<span class="sn-cat">' + esc(cat) + '</span>'; }
            result += '<div class="sn-pkg" data-key="sn:add:' + esc(p.id) + '"><span class="tree-ico studio">' + icon(p.kind === 'kit' ? 'inventory_2' : 'extension') + '</span>' +
                esc(p.title) + (p.scope === 'project' ? '<span class="muted"> · проект</span>' : '') +
                '<span class="sn-desc">' + esc(p.description) + '</span></div>';
        }
        return result;
    }

    function renderResults() {
        const list = filtered();
        doc.text('sn-count', 'Каталог (' + list.length + ' из ' + st.catalog.length + ')');
        doc.html('sn-results', catalogHtml(list));
    }

    function render() {
        if (!host.active()) return;
        if (!st.loaded) { doc.html('side-body', '<div class="sn-note">Загрузка каталога…</div>'); return; }
        if (!host.v2()) {
            doc.html('side-body', '<div class="sn-note">Кирпичики хранятся в project.json со schema_version 2 (команда «Проект: перейти на schema_version 2»).</div>');
            return;
        }
        const sec = section();
        const objs = objects();
        let html = '<div class="sn-owner"><span class="sn-h">Объект</span><select id="sn-owner" class="st-in">' +
            objs.map((o) => opt(o.key, o.label, st.owner)).join('') + '</select></div>';
        html += '<div class="sn-row"><input id="sn-new-id" class="st-in sn-half" type="text" value=""/><input id="sn-new-tag" class="st-in sn-half" type="text" value=""/>' +
            '<button class="st-btn" data-key="sn:entity">Новый объект (id, тег)</button></div>';
        if (objs.length === 1) html += '<div class="sn-note">В графе нет объектов с id. Создайте узел с id в коде ($(\'&lt;hero&gt;\', { id: \'hero\' })) и сохраните файл.</div>';

        // Подключённые к выбранному объекту.
        const mine = (sec.instances || []).filter((x) => x.owner === st.owner);
        html += '<span class="sn-h">Подключено (' + mine.length + ')</span>';
        for (const inst of mine) {
            const p = pkg(inst.package);
            const open = st.open === inst.id;
            html += '<div class="sn-inst' + (open ? ' open' : '') + (inst.disabled ? ' off' : '') + '" data-key="sn:open:' + esc(inst.id) + '">' +
                '<span class="tree-ico studio">' + icon(open ? 'expand_more' : 'chevron_right') + '</span>' +
                esc(p ? p.title : inst.package) + '<span class="muted"> · ' + esc(inst.package + '@' + inst.version) + (inst.slot ? ' · ' + esc(inst.slot) : '') + '</span></div>';
            if (open) {
                html += '<div class="sn-form">';
                if (!p) html += '<span class="sn-err">SNIP141 · пакета нет в каталоге: экземпляр остаётся pinned</span>';
                else {
                    if ((p.slots || []).length) html += '<label>Слот</label><select id="sn-slot" class="st-in">' + (p.slots || []).map((slot) => opt(slot.id, slot.id + ' (ёмкость ' + slot.capacity + ')', inst.slot)).join('') + '</select>';
                    let group = '';
                    for (const f of p.fields || []) {
                        const condition = f.visibleIf;
                        if (condition) {
                            const other = (p.fields || []).find((x) => x.id === condition.field);
                            const value = Object.prototype.hasOwnProperty.call(inst.values || {}, condition.field) ? inst.values[condition.field] : other && other.default;
                            if (value !== condition.equals) continue;
                        }
                        if (f.group && f.group !== group) { group = f.group; html += '<span class="sn-h">' + esc(group) + '</span>'; }
                        html += fieldHtml(f, inst);
                    }
                    html += '<span class="sn-hint">Состав: ' + esc((p.dependencies || []).map((d) => typeof d === 'string' ? d : d.id).join(', ') || 'без зависимостей') + '</span>';
                }
                html += '<div class="sn-row"><button class="st-btn" data-key="sn:toggle:' + esc(inst.id) + '">' + (inst.disabled ? 'Включить' : 'Отключить') + '</button>' +
                    '<button class="st-btn" data-key="sn:remove:' + esc(inst.id) + '">Удалить</button></div></div>';
            }
        }
        const sets = (sec.sets || []).filter((x) => x.owner === st.owner);
        for (const s of sets)
            html += '<div class="sn-set">' + icon('inventory_2') + ' ' + esc(s.package) + '<span class="muted"> · ' + (s.members || []).length + ' шт.</span>' +
                '<button class="st-btn sn-mini" data-key="sn:remove:' + esc(s.id) + '">Удалить набор</button></div>';

        // Генерация.
        const codeOwned = ((sec.generation || {}).ownership) === 'code';
        html += '<div class="sn-row"><button class="st-btn" data-key="sn:undo">Отменить (' + st.undo.length + ')</button>' +
            '<button class="st-btn" data-key="sn:redo">Повторить (' + st.redo.length + ')</button></div>';
        html += '<span class="sn-h">Код · владелец: ' + (codeOwned ? 'ручной JS (code-authored)' : 'генератор') + '</span><div class="sn-row">' +
            (codeOwned ? '' : '<button class="st-btn primary" data-key="sn:preview">Просмотр изменений</button>') +
            ((!codeOwned && st.gen && st.gen.ok && st.gen.stale) ? '<button class="st-btn primary" data-key="sn:generate">Применить генерацию</button>' : '') +
            '<button class="st-btn" data-key="sn:own:' + (codeOwned ? 'generator' : 'code') + '">' + (codeOwned ? 'Вернуть генератору' : 'В ручное владение') + '</button>' +
            '<button class="st-btn" data-key="sn:rollback">Откатить project.json</button>' +
            '<button class="st-btn" data-key="sn:updates">Проверить обновления</button></div>';
        if (st.updates) {
            const changes = st.updates.changes || [];
            html += '<span class="sn-h">Обновления: ' + changes.length + '</span>';
            for (const c of changes) html += '<div class="sn-note">' + esc(c.instance + ': ' + c.from + ' → ' + c.to) +
                '<span class="sn-hint">' + esc((c.steps || []).join(', ')) + '</span>' +
                ((c.dropped_fields || []).length ? '<span class="sn-err">Удалённые поля: ' + esc(c.dropped_fields.join(', ')) + '</span>' : '') + '</div>';
            if (st.updates.ok && changes.length) html += '<button class="st-btn" data-key="sn:update">Применить обновления</button>';
        }
        if (st.gen) {
            for (const f of st.gen.files || []) {
                html += '<div class="tree-row" data-key="sn:diff:' + esc(f.path) + '" style="padding-left: 4px;"><span class="sn-st ' + esc(f.status) + '">' + esc(f.status) + '</span>' + esc(f.path) +
                    '<span class="muted"> · ' + (f.owner === 'code' ? 'ручной' : 'генератор') + '</span></div>';
            }
            const diff = (st.gen.files || []).find((f) => f.path === st.diff);
            if (diff) {
                html += '<span class="sn-h">' + esc(diff.path) + '</span><button class="st-btn" data-key="sn:file:' + esc(diff.path) + '">Открыть исходник</button>';
                if (diff.text !== undefined) html += '<span class="sn-hint">До</span><pre class="sn-diff">' + esc(diff.before || '') + '</pre><span class="sn-hint">После</span><pre class="sn-diff">' + esc(diff.text) + '</pre>';
                else html += '<span class="sn-hint">Нажмите «Просмотр изменений», чтобы увидеть исходник до применения.</span>';
            }
            if (st.gen.entry_link && !st.gen.entry_link.present)
                html += '<span class="sn-hint">В ' + esc(st.gen.entry) + ' будет добавлена строка подключения generated/snippets.</span>';
            if ((st.gen.files || []).some((f) => f.status === 'conflict'))
                html += '<span class="sn-err">Файл generated изменён вручную. «Применить поверх» сохранит ручную версию рядом (.r2d-user).</span>' +
                    '<button class="st-btn" data-key="sn:overwrite">Применить поверх</button>';
        }
        const other = st.diags.filter((d) => !(d.location && d.location.field && (sec.instances || []).some((i) => i.id === st.open && i.package === d.location.package)));
        for (const d of other.slice(0, 6)) html += '<span class="sn-err">' + esc(d.code + ' · ' + d.message) + '</span>';

        // Каталог.
        const list = filtered();
        const cats = [...new Set(st.catalog.filter((p) => p.valid).map((p) => p.category))].sort((a, b) => a.localeCompare(b));
        html += '<button class="st-btn" data-key="sn:author">' + (st.author ? 'Скрыть форму пакета' : 'Создать свой пакет…') + '</button>';
        if (st.author) html += '<span class="sn-h">Свой пакет</span><div class="sn-row"><input id="sn-pkg-id" class="st-in sn-half" type="text" value=""/>' +
            '<input id="sn-pkg-title" class="st-in sn-half" type="text" value=""/><select id="sn-pkg-kind" class="st-in"><option value="behavior">Поведение</option><option value="kit">Набор (kit)</option></select><input id="sn-pkg-deps" class="st-in" type="text" value=""/><span class="sn-hint">Состав набора: ID пакетов через запятую</span><button class="st-btn" data-key="sn:package">Создать пакет (id, название)</button></div>';
        html += '<span id="sn-count" class="sn-h">Каталог (' + list.length + ' из ' + st.catalog.length + ')</span>' +
            '<input id="sn-query" class="st-in" type="text" value="' + esc(st.query) + '"/>' +
            '<select id="sn-cat" class="st-in">' + opt('', 'Все категории (' + cats.length + ')', st.category) + cats.map((c) => opt(c, c, st.category)).join('') + '</select>';
        html += '<div id="sn-results">' + catalogHtml(list) + '</div>';
        doc.html('side-body', html);
        st.renderedAt = st.tick;
    }

    // --- события (делегирование от side-body, см. app.js) ----------------------------

    async function click(key) {
        const i = key.indexOf(':');
        const op = i < 0 ? key : key.slice(0, i), arg = i < 0 ? '' : key.slice(i + 1);
        const inst = (section().instances || []).find((x) => x.id === arg);
        if (op === 'open') { st.open = st.open === arg ? null : arg; render(); }
        else if (op === 'add') await add(arg);
        else if (op === 'remove') await remove(arg);
        else if (op === 'toggle' && inst) await toggle(inst);
        else if (op === 'generate') await generate(false);
        else if (op === 'overwrite') await generate(true);
        else if (op === 'preview') await preview();
        else if (op === 'updates') await checkUpdates();
        else if (op === 'update') { const ok = await run(['snippet', 'update', host.root()], 'пакеты обновлены'); if (ok) { st.updates = null; await load(true); } }
        else if (op === 'undo') await undo();
        else if (op === 'redo') await redo();
        else if (op === 'own') { await run(['snippet', 'own', host.root(), arg], arg === 'code' ? 'generated/snippets передан в ручное владение' : 'generated/snippets возвращён генератору'); await preview(); }
        else if (op === 'rollback') await run(['snippet', 'rollback', host.root()], 'project.json откатан к предыдущей записи', (j) => { if (j.rolled_back) host.projectChanged(); });
        else if (op === 'diff') { st.diff = st.diff === arg ? null : arg; render(); }
        else if (op === 'file') host.openFile(arg);
        else if (op === 'author') { st.author = !st.author; render(); }
        else if (op === 'entity') await createEntity(doc.value('sn-new-id'), doc.value('sn-new-tag'));
        else if (op === 'package') await createPackage(doc.value('sn-pkg-id'), doc.value('sn-pkg-title'), doc.value('sn-pkg-kind') || 'behavior', doc.value('sn-pkg-deps'));
    }

    async function changed(target) {
        // RmlUi шлёт change и при пересоздании поля (doc.html): реагируем только на новое значение.
        if (target === 'sn-owner') {
            const v = doc.value('sn-owner') || 'project';
            if (v !== st.owner) { st.owner = v; st.open = null; render(); }
            return;
        }
        if (target === 'sn-cat') {
            const c = String(doc.value('sn-cat') || '');
            if (c !== st.category) { st.category = c; renderResults(); }
            return;
        }
        if (target === 'sn-query') {
            const q = String(doc.value('sn-query') || '');
            if (q !== st.query) { st.query = q; renderResults(); }
            return;
        }
        if (target === 'sn-slot' && st.open) { const slot = doc.value('sn-slot'); const inst = (section().instances || []).find((x) => x.id === st.open); if (!inst || (inst.slot || '') === (slot || '')) return; await run(['snippet', 'set', host.root(), st.open, 'slot=' + (slot ? JSON.stringify(slot) : '')], 'слот сохранён'); return; }
        if (target && String(target).startsWith('sn-f-')) await change(target);
    }

    /** change из RmlUi: события пересоздания полей отбрасываются. */
    function domChanged(target) {
        if (st.tick - st.renderedAt < 3) return;
        changed(target);
    }

    return {
        state: st, load, render, click, changed, domChanged, generate, add, createEntity, createPackage, undo, redo,
        reset() { st.loaded = false; st.catalog = []; st.owner = null; st.open = null; st.gen = null; st.diff = null; st.updates = null; st.diags = []; st.undo = []; st.redo = []; st.category = ''; },
    };
}
