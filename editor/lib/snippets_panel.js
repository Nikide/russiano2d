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
            return '[' + (Number(text) || 0) + ', ' + (Number(y) || 0) + ']';
        }
        case 'list': return text === '' ? null : JSON.stringify(text.split(',').map((x) => x.trim()).filter(Boolean));
        default: return text === '' ? null : JSON.stringify(text);
    }
}

/** Текущее значение (или default) для показа в поле. */
export function displayValue(field, values) {
    const v = values && Object.prototype.hasOwnProperty.call(values, field.id) ? values[field.id] : field.default;
    if (v === undefined || v === null) return '';
    if (field.type === 'bool') return v ? YES : NO;
    if (field.type === 'list') return Array.isArray(v) ? v.join(', ') : '';
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

    async function run(args, okText, after) {
        if (st.busy) return false;
        if (host.manifestDirty()) { host.setStatus('сначала сохраните project.json: Кирпичики пишут его сами', 'err'); return false; }
        st.busy = true;
        try {
            const res = await host.tool(args);
            const ok = report(res, okText);
            if (res.json && res.json.written) host.projectChanged();
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
    async function createEntity(id, tag) {
        id = String(id || '').trim(); tag = String(tag || '').trim() || id;
        if (!id) { host.setStatus('укажите id объекта', 'err'); return false; }
        const ok = await run(['snippet', 'entity', host.root(), '--id', id, '--tag', tag, '--x', '200', '--y', '200', '--w', '32', '--h', '32'],
            'объект #' + id + ' создан', (j) => { if (j.written) { st.owner = 'object:' + id; st.open = null; } });
        return ok;
    }

    /** Автор пакета: каркас пакета проекта и переход к его исходнику. */
    async function createPackage(id, title) {
        id = String(id || '').trim();
        if (!id) { host.setStatus('укажите id пакета (например game.spin)', 'err'); return false; }
        const ok = await run(['snippet', 'new', host.root(), id, '--title', String(title || '').trim() || id], 'пакет проекта ' + id + ' создан');
        if (ok) { await load(true); host.filesChanged(); host.openFile('snippets/' + id + '/src/behavior.js'); }
        return ok;
    }

    async function generate(overwrite) {
        const args = ['snippet', 'generate', host.root(), '--write'];
        if (overwrite) args.push('--overwrite');
        await run(args, 'generated/snippets обновлён', (j) => { st.gen = j; if (j.written) host.filesChanged(); });
    }

    async function preview() {
        const res = await host.tool(['snippet', 'generate', host.root()]);
        st.gen = res.json || null;
        report(res, st.gen && st.gen.stale ? 'есть изменения для генерации' : 'generated/snippets актуален');
        render();
    }

    /** Поле формы поменялось: отправить изменённые значения открытого экземпляра. */
    async function change() {
        const inst = (section().instances || []).find((x) => x.id === st.open);
        const p = inst && pkg(inst.package);
        if (!p) return;
        const pairs = [];
        for (const f of p.fields || []) {
            const base = displayValue(f, inst.values || {});
            const raw = doc.value('sn-f-' + f.id);
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
                else for (const f of p.fields || []) html += fieldHtml(f, inst);
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
        html += '<span class="sn-h">Код · владелец: ' + (codeOwned ? 'ручной JS (code-authored)' : 'генератор') + '</span><div class="sn-row">' +
            (codeOwned ? '' : '<button class="st-btn primary" data-key="sn:generate">Сгенерировать</button>') +
            '<button class="st-btn" data-key="sn:preview">Проверить</button>' +
            '<button class="st-btn" data-key="sn:own:' + (codeOwned ? 'generator' : 'code') + '">' + (codeOwned ? 'Вернуть генератору' : 'В ручное владение') + '</button>' +
            '<button class="st-btn" data-key="sn:rollback">Откатить project.json</button></div>';
        if (st.gen) {
            for (const f of st.gen.files || []) {
                html += '<div class="tree-row" data-key="sn:file:' + esc(f.path) + '" style="padding-left: 4px;"><span class="sn-st ' + esc(f.status) + '">' + esc(f.status) + '</span>' + esc(f.path) +
                    '<span class="muted"> · ' + (f.owner === 'code' ? 'ручной' : 'генератор') + '</span></div>';
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
        const q = lower(st.query);
        const list = st.catalog.filter((p) => p.valid && (!q || lower(p.id + ' ' + p.title + ' ' + p.description + ' ' + p.category + ' ' + (p.tags || []).join(' ')).includes(q)));
        html += '<span class="sn-h">Свой пакет</span><div class="sn-row"><input id="sn-pkg-id" class="st-in sn-half" type="text" value=""/>' +
            '<input id="sn-pkg-title" class="st-in sn-half" type="text" value=""/><button class="st-btn" data-key="sn:package">Создать пакет (id, название)</button></div>';
        html += '<span class="sn-h">Каталог (' + list.length + ' из ' + st.catalog.length + ')</span>' +
            '<input id="sn-query" class="st-in" type="text" value="' + esc(st.query) + '"/>';
        let cat = '';
        for (const p of list.slice().sort((a, b) => (a.category + a.title).localeCompare(b.category + b.title))) {
            if (p.category !== cat) { cat = p.category; html += '<span class="sn-cat">' + esc(cat) + '</span>'; }
            html += '<div class="sn-pkg" data-key="sn:add:' + esc(p.id) + '"><span class="tree-ico studio">' + icon(p.kind === 'kit' ? 'inventory_2' : 'extension') + '</span>' +
                esc(p.title) + (p.scope === 'project' ? '<span class="muted"> · проект</span>' : '') +
                '<span class="sn-desc">' + esc(p.description) + '</span></div>';
        }
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
        else if (op === 'own') { await run(['snippet', 'own', host.root(), arg], arg === 'code' ? 'generated/snippets передан в ручное владение' : 'generated/snippets возвращён генератору'); await preview(); }
        else if (op === 'rollback') await run(['snippet', 'rollback', host.root()], 'project.json откатан к предыдущей записи', (j) => { if (j.rolled_back) host.projectChanged(); });
        else if (op === 'file') host.openFile(arg);
        else if (op === 'entity') await createEntity(doc.value('sn-new-id'), doc.value('sn-new-tag'));
        else if (op === 'package') await createPackage(doc.value('sn-pkg-id'), doc.value('sn-pkg-title'));
    }

    async function changed(target) {
        // RmlUi шлёт change и при пересоздании поля (doc.html): реагируем только на новое значение.
        if (target === 'sn-owner') {
            const v = doc.value('sn-owner') || 'project';
            if (v !== st.owner) { st.owner = v; st.open = null; render(); }
            return;
        }
        if (target === 'sn-query') {
            const q = String(doc.value('sn-query') || '');
            if (q !== st.query) { st.query = q; render(); }
            return;
        }
        if (target && String(target).startsWith('sn-f-')) await change();
    }

    /** change из RmlUi: события пересоздания полей отбрасываются. */
    function domChanged(target) {
        if (st.tick - st.renderedAt < 3) return;
        changed(target);
    }

    return {
        state: st, load, render, click, changed, domChanged, generate, add, createEntity, createPackage,
        reset() { st.loaded = false; st.catalog = []; st.owner = null; st.open = null; st.gen = null; st.diags = []; },
    };
}
