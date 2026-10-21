// ===========================================================================
// RmlUi — студия Editor для `.rml` и `.rcss`.
//
// Документ и подключённые к нему стили правятся как один документ вкладки с
// общей историей ({ rml, sheets }). Файлы остаются обычным текстом: правки
// дерева меняют только нужный фрагмент (sdk/lib/rml_model.js).
//
// Предпросмотр — настоящий RmlUi: черновики `.r2d-editor-rmlui-<n>-*` пишутся
// рядом с файлами (ссылки на стили перенаправлены на черновики стилей),
// документ грузится через `$.ui.doc` и прижимается к окну просмотра. Клик в
// превью выбирает элемент по его настоящей геометрии (layoutRect).
// Save: живые ошибки разметки блокируют запись; затем пишутся документ и
// стили, и каждый файл проверяется `r2d validate`.
// ===========================================================================

import * as M from '../lib/shared/rml_model.js';
import { createHistory } from '../lib/shared/history.js';
import { studioDoc, esc, diag, mousePx, inside } from '../lib/studio_kit.js';

export const meta = { id: 'rmlui', title: 'Интерфейс RmlUi', icon: 'web', match: (p) => /\.(rml|rcss)$/i.test(p) };

const BODY_ID = 'r2d-pv-root';
const ROOTS = new Set(['rml', 'head', 'body']);
let tabCounter = 0;

const dirOf = (p) => { const i = String(p).lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const baseOf = (p) => String(p).split('/').pop();
const join = (d, f) => (d ? d.replace(/\/$/, '') + '/' + f : f);

/** Путь href относительно каталога документа. */
export function resolveRel(dir, href) {
    if (/^([A-Za-z]:[\\/]|\/)/.test(href)) return href;
    const out = [];
    for (const part of (dir ? dir + '/' + href : href).split('/')) {
        if (part === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop();
        else if (part !== '.') out.push(part);
    }
    return out.join('/');
}

/** Элемент под точкой: самый глубокий с id, у которого настоящая геометрия содержит точку. */
export function pickNodeIndex(nodes, x, y, layoutRect) {
    let best = -1, bestDepth = -1;
    for (const n of nodes || []) {
        const id = M.attr(n, 'id');
        if (!id) continue;
        let r = null;
        try { r = layoutRect(id); } catch (_) { r = null; }
        if (!r || !(r.w > 0) || !(r.h > 0)) continue;
        if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
        if (n.depth >= bestDepth) { best = n.index; bestDepth = n.depth; }
    }
    return best;
}

const SAMPLE = (href) => '<rml>\n<head>\n    <link type="text/rcss" href="' + href + '"/>\n    <title>Пример</title>\n</head>\n<body>\n' +
    '<div id="sample" class="panel">\n    <h1 id="title">Заголовок</h1>\n    <p id="text">Абзац текста.</p>\n    <button id="btn" class="btn">Кнопка</button>\n</div>\n</body>\n</rml>\n';

// Конец элемента вместе с закрывающим тегом.
function closeEnd(text, n) {
    if (n.selfClosing || n.closeStart < 0) return n.end;
    const e = text.indexOf('>', n.closeStart);
    return e < 0 ? text.length : e + 1;
}

export function create(host) {
    const $ = host.$;
    const doc = studioDoc($, 'rmlui');
    const prefix = '.r2d-editor-rmlui-' + (++tabCounter) + '-';
    const s = {
        path: '', virtual: false, model: { rml: '', sheets: {} }, sheets: [], activeSheet: 0, parsed: M.parse(''), sel: -1,
        history: null, disk: {}, preview: null, bodyId: '', drafts: new Set(), live: [], native: [], status: '',
        needsPreview: false, placed: '', active: false, closed: false, busy: false, conflict: null,
    };

    const dirty = () => !!s.history && s.history.dirty();
    const node = () => (s.sel >= 0 ? s.parsed.nodes[s.sel] || null : null);
    const status = (text, bad) => { s.status = text; doc.text('rm-status', esc(text)); doc.cls('rm-status', 'err', !!bad); doc.cls('rm-status', 'ok', !bad); };
    const files = () => (s.virtual ? [] : [s.path]).concat(s.sheets.map((x) => x.path));
    const draftOf = (p) => join(dirOf(p), prefix + baseOf(p));
    const draftHref = (href) => { const i = href.lastIndexOf('/'); return (i < 0 ? '' : href.slice(0, i + 1)) + prefix + href.slice(i + 1); };

    // --- модель -----------------------------------------------------------------------------
    function reparse() {
        s.parsed = M.parse(s.model.rml);
        if (s.sel >= s.parsed.nodes.length) s.sel = s.parsed.nodes.length - 1;
        const live = M.checkRml(s.model.rml).map((d) => Object.assign({}, d, { asset: s.path }));
        for (const sh of s.sheets) for (const d of M.checkRcss(s.model.sheets[sh.path])) live.push(Object.assign({}, d, { asset: sh.path }));
        for (const sh of s.sheets) if (sh.missing && !s.model.sheets[sh.path]) live.push(diag('SDK_RML_SHEET_MISSING', 'warning', 'Файл стилей «' + sh.href + '» не найден: будет создан при сохранении', { asset: sh.path }));
        s.live = live;
    }

    // Стили документа — по его ссылкам; новые ссылки подхватываются при правке исходника.
    function syncSheets() {
        const dir = dirOf(s.path);
        for (const l of M.links(s.parsed)) {
            const p = resolveRel(dir, l.href);
            if (s.sheets.some((x) => x.path === p)) continue;
            const text = $.fs.readText(p);
            const missing = text === null || text === undefined;
            if (s.model.sheets[p] === undefined) s.model.sheets[p] = missing ? '' : text;
            if (s.disk[p] === undefined) s.disk[p] = missing ? null : text;
            s.sheets.push({ path: p, href: l.href, missing });
        }
    }

    function edit(label, fn) {
        if (!s.history) return false;
        try { s.history.run(label, () => fn(s.model)); }
        catch (e) { s.native = [diag('EDITOR_RMLUI_EDIT', 'error', e.message || e, { asset: s.path })]; changed(); return false; }
        s.native = [];
        afterChange();
        return true;
    }
    function afterChange() { reparse(); syncSheets(); s.needsPreview = true; changed(); }
    function changed() { renderAll(); host.changed(); }

    // --- предпросмотр ------------------------------------------------------------------------
    function unloadPreview() {
        if (s.preview) { try { s.preview.unload(); } catch (_) { /* уже выгружен */ } s.preview = null; }
        s.bodyId = '';
    }
    function write(path, text) {
        if ($.fs.write(path, text) === false) return false;
        s.drafts.add(path);
        return true;
    }
    function rebuildPreview() {
        s.needsPreview = false;
        const errs = s.live.filter((d) => d.severity === 'error');
        if (errs.length) { status('превью не обновлено: ' + errs[0].message, true); return false; }
        const map = {};
        for (const sh of s.sheets) {
            if (!write(draftOf(sh.path), s.model.sheets[sh.path])) { status('не удалось записать черновик стиля', true); return false; }
            map[sh.href] = draftHref(sh.href);
        }
        const body = M.withBodyId(M.retargetLinks(s.model.rml, map), BODY_ID);
        const dr = draftOf(s.path);
        if (!write(dr, body.text)) { status('не удалось записать черновик ' + dr, true); return false; }
        unloadPreview();
        try { s.preview = $.ui.doc(dr); } catch (e) { status('RmlUi не загрузил документ: ' + (e.message || e), true); return false; }
        s.bodyId = body.id;
        if (s.active) s.preview.show(); else s.preview.hide();
        s.placed = '';
        place();
        status('превью · ' + s.parsed.nodes.length + ' элементов');
        return true;
    }
    function place() {
        if (!s.preview || !s.bodyId) return;
        // Preview is a separate top-level RmlUi document. Positioning only its
        // body leaves the document viewport full-screen, so absolute children
        // escape the editor panel. Place the whole document into the panel:
        // this also clips its content at the viewport edges.
        const r = doc.rect('rm-view');
        if (!r || r.w <= 0) return;
        const key = [r.x, r.y, r.w, r.h].join(',');
        if (key === s.placed) return;
        s.placed = key;
        s.preview.place({ x: Math.round(r.x + 1), y: Math.round(r.y + 1),
            w: Math.max(0, Math.round(r.w - 2)), h: Math.max(0, Math.round(r.h - 2)) });
    }

    // --- операции (их же вызывают агенты) ----------------------------------------------------------
    const at = (m, index) => { const n = M.parse(m.rml).nodes[index]; if (!n) throw new Error('Нет элемента ' + index); return n; };
    const ops = {
        select(i) { s.sel = i >= 0 && i < s.parsed.nodes.length ? i : -1; renderTree(); renderProps(); return s.sel; },
        selectId(id) { return ops.select(s.parsed.nodes.findIndex((n) => M.attr(n, 'id') === id)); },
        setSource(text) { return edit('Исходник', (m) => { m.rml = String(text); }); },
        setAttrs(index, patch) { return edit('Атрибуты', (m) => { m.rml = M.setAttrs(m.rml, at(m, index), patch); }); },
        setText(index, value) { return edit('Текст', (m) => { m.rml = M.setInnerText(m.rml, at(m, index), String(value)); }); },
        addChild(index, tag) {
            return edit('Новый элемент', (m) => {
                const n = at(m, index);
                if (n.selfClosing) throw new Error('У самозакрывающегося элемента нет содержимого');
                const t = /^[a-z][a-z0-9-]*$/i.test(tag || '') ? tag : 'div';
                m.rml = m.rml.slice(0, n.innerEnd) + '<' + t + '></' + t + '>\n' + m.rml.slice(n.innerEnd);
            });
        },
        duplicate(index) {
            return edit('Копия элемента', (m) => {
                const n = at(m, index);
                if (ROOTS.has(n.tag)) throw new Error('Корневые разделы не дублируются');
                const e = closeEnd(m.rml, n);
                m.rml = m.rml.slice(0, e) + '\n' + m.rml.slice(n.start, e) + m.rml.slice(e);
            });
        },
        remove(index) {
            const ok = edit('Удаление элемента', (m) => {
                const n = at(m, index);
                if (ROOTS.has(n.tag)) throw new Error('Корневые разделы не удаляются');
                m.rml = m.rml.slice(0, n.start) + m.rml.slice(closeEnd(m.rml, n));
            });
            if (ok) ops.select(Math.min(index, s.parsed.nodes.length - 1));
            return ok;
        },
        move(index, dir) {
            let moved = -1;
            const ok = edit('Порядок элементов', (m) => {
                const n = at(m, index);
                const sib = n.parent.children, i = sib.indexOf(n), to = i + (dir < 0 ? -1 : 1);
                if (to < 0 || to >= sib.length) throw new Error('Дальше двигать некуда');
                const a = dir < 0 ? sib[to] : n, b = dir < 0 ? n : sib[to];
                const ea = closeEnd(m.rml, a), eb = closeEnd(m.rml, b);
                m.rml = m.rml.slice(0, a.start) + m.rml.slice(b.start, eb) + m.rml.slice(ea, b.start) + m.rml.slice(a.start, ea) + m.rml.slice(eb);
                moved = dir < 0 ? a.start : a.start + (eb - b.start) + (b.start - ea);
            });
            if (ok) ops.select(s.parsed.nodes.findIndex((x) => x.start === moved));
            return ok;
        },
        setSheet(i, text) {
            const sh = s.sheets[i];
            if (!sh) { s.native = [diag('EDITOR_RMLUI_EDIT', 'error', 'Нет стиля ' + i, { asset: s.path })]; changed(); return false; }
            return edit('RCSS ' + baseOf(sh.path), (m) => { m.sheets[sh.path] = String(text); });
        },
        selectSheet(i) { s.activeSheet = Math.max(0, Math.min(s.sheets.length - 1, i)); renderSheets(); return s.activeSheet; },
        /** Поля инспектора → одна команда истории. */
        applyProps() {
            const n = node();
            if (!n) return false;
            const patch = { id: doc.value('rm-p-id') || null, class: doc.value('rm-p-class') || null };
            for (const a of n.attrs) if (a.name !== 'id' && a.name !== 'class') patch[a.name] = null;
            for (const line of String(doc.value('rm-p-attrs') || '').split('\n')) {
                const t = line.trim();
                if (!t) continue;
                const i = t.indexOf('=');
                if (i < 0) patch[t] = ''; else patch[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
            }
            const index = s.sel, text = M.isLeaf(n) ? String(doc.value('rm-p-text') || '') : null;
            return edit('Элемент ' + M.label(n), (m) => {
                let cur = M.parse(m.rml).nodes[index];
                if (text !== null && text !== M.innerText(m.rml, cur)) { m.rml = M.setInnerText(m.rml, cur, text); cur = M.parse(m.rml).nodes[index]; }
                m.rml = M.setAttrs(m.rml, cur, patch);
            });
        },
        pickAt(x, y) {
            if (!s.preview) return -1;
            const i = pickNodeIndex(s.parsed.nodes, x, y, (id) => s.preview.layoutRect(id));
            if (i >= 0) ops.select(i);
            return i;
        },
        refresh: rebuildPreview,
        validate,
        report() {
            const nodes = s.parsed.nodes;
            return { elements: nodes.length, ids: nodes.filter((n) => M.attr(n, 'id')).length, sheets: s.sheets.map((x) => x.path), preview: !!s.preview, draft: s.preview ? draftOf(s.path) : null };
        },
    };

    // --- проверка и сохранение ------------------------------------------------------------------
    async function validateFiles(list, toReal) {
        const out = [];
        let ok = true;
        for (const f of list) {
            const r = await host.backend(['validate', f]);
            if (s.closed) return { ok: false, diagnostics: [] };
            if (!r.json) { ok = false; out.push(diag('SDK_BACKEND_NO_JSON', 'error', 'validate не вернул JSON для ' + f, { asset: toReal(f) })); continue; }
            if (!(r.ok && r.json.ok)) ok = false;
            for (const d of r.json.diagnostics || []) out.push(Object.assign({}, d, { asset: toReal(d.asset || f) }));
        }
        return { ok, diagnostics: out };
    }
    // Черновики проверяются до записи: ошибки видны, файлы не тронуты.
    async function validate() {
        if (s.busy || s.closed) return false;
        s.busy = true;
        try {
            if (!rebuildPreview()) { s.native = s.live.filter((d) => d.severity === 'error'); changed(); return false; }
            const back = new Map(files().map((f) => [draftOf(f), f]));
            const res = await validateFiles([...back.keys()].filter((f) => !s.virtual || f !== draftOf(s.path)), (a) => back.get(a) || a);
            s.native = res.diagnostics;
            status(res.ok ? 'проверка пройдена' : 'проверка нашла ошибки', !res.ok);
            changed();
            return res.ok;
        } finally { s.busy = false; }
    }
    async function save(options) {
        options = options || {};
        if (!s.history || s.closed || s.busy) return false;
        if (!dirty()) return true;
        const errs = s.live.filter((d) => d.severity === 'error');
        if (errs.length) { s.native = errs; status('Сохранение отменено: ' + errs[0].message, true); changed(); return false; }
        const expected = options.overwrite ? (options.expected || {}) : {};
        const expectedDisk = (f) => Object.prototype.hasOwnProperty.call(expected, f) ? expected[f] : s.disk[f];
        const detectConflicts = () => {
            const found = {};
            for (const f of files()) {
                const disk = $.fs.readText(f);
                if (disk !== expectedDisk(f)) found[f] = typeof disk === 'string' ? disk : null;
            }
            return found;
        };
        let conflicts = detectConflicts();
        if (Object.keys(conflicts).length) {
            s.conflict = conflicts;
            s.native = Object.keys(conflicts).map((f) => diag('EDITOR_WRITE_CONFLICT', 'error', 'Файл изменён извне: выберите версию для ' + f, { asset: f }));
            changed(); return false;
        }
        // Проверяем все связанные файлы на drafts до записи какого-либо оригинала.
        if (!await validate() || s.closed) return false;
        // Внешний редактор мог изменить файл, пока шла native-валидация.
        conflicts = detectConflicts();
        if (Object.keys(conflicts).length) {
            s.conflict = conflicts;
            s.native = Object.keys(conflicts).map((f) => diag('EDITOR_WRITE_CONFLICT', 'error', 'Файл изменён извне: выберите версию для ' + f, { asset: f }));
            changed(); return false;
        }
        for (const f of files()) {
            const disk = $.fs.readText(f);
            if (disk !== expectedDisk(f)) {
                s.conflict = { [f]: typeof disk === 'string' ? disk : null };
                s.native = [diag('EDITOR_WRITE_CONFLICT', 'error', 'Файл снова изменён извне: проверьте новую версию ' + f, { asset: f })]; changed(); return false;
            }
        }
        const texts = new Map(files().map((f) => [f, f === s.path ? s.model.rml : s.model.sheets[f]]));
        const before = new Map(files().map((f) => [f, $.fs.readText(f)]));
        const written = [];
        for (const [f, text] of texts) {
            if (before.get(f) === text) continue;
            if ($.fs.readText(f) !== expectedDisk(f)) {
                s.conflict = { [f]: typeof $.fs.readText(f) === 'string' ? $.fs.readText(f) : null };
                s.native = [diag('EDITOR_WRITE_CONFLICT', 'error', 'Файл снова изменён извне: проверьте новую версию ' + f, { asset: f })];
                break;
            }
            if ($.fs.write(f, text) === false) {
                s.native = [diag('SDK_WRITE_FAILED', 'error', 'Не удалось записать ' + f, { asset: f })];
                break;
            }
            written.push(f);
        }
        if (written.length !== [...texts].filter(([f, text]) => before.get(f) !== text).length) {
            let rollbackFailed = '';
            for (const f of written.reverse()) {
                const old = before.get(f);
                const restored = old === null || old === undefined ? $.fs.remove(f) !== false : $.fs.write(f, old) !== false;
                if (!restored) rollbackFailed = f;
            }
            if (rollbackFailed) s.native = [diag('EDITOR_WRITE_ROLLBACK', 'error', 'Сохранение прервано; не удалось восстановить ' + rollbackFailed, { asset: rollbackFailed })];
            changed(); return false;
        }
        for (const [f, text] of texts) s.disk[f] = text;
        for (const sh of s.sheets) sh.missing = false;
        s.history.markSaved();
        s.conflict = null;
        s.native = [];
        reparse();
        status('сохранено');
        changed();
        return true;
    }

    function renderConflict() {
        const c = s.conflict;
        if (!c) { doc.cls('rm-conflict', 'st-hidden', true); doc.html('rm-conflict', ''); return; }
        const paths = Object.keys(c), missing = paths.includes(s.path) && c[s.path] === null;
        doc.cls('rm-conflict', 'st-hidden', false);
        doc.html('rm-conflict', '<div class="rm-conflict-shade"></div><div class="rm-conflict-card"><span class="rm-conflict-title">Документ или стиль изменён вне редактора</span><span class="rm-conflict-message">Перезагрузка заменит все несохранённые правки документа и связанных стилей. Перезапись сохранит текущую версию поверх перечисленных файлов.</span><span class="rm-conflict-path">'+paths.map(esc).join('<br/>')+(paths.some((f)=>c[f]===null)?'<br/>Файл удалён':'')+'</span><div class="rm-conflict-actions">'+
            (missing?'':'<button id="rm-conflict-reload" class="st-btn" data-key="reload">Перезагрузить</button>')+
            '<button id="rm-conflict-overwrite" class="st-btn primary" data-key="overwrite">Перезаписать</button><button id="rm-conflict-cancel" class="st-btn" data-key="cancel">Отмена</button></div></div>');
    }
    function resolveConflict(choice) {
        if (!s.conflict || s.busy || s.closed) return false;
        if (choice === 'cancel') {
            s.conflict = null;
            s.native = s.native.filter((d) => d.code !== 'EDITOR_WRITE_CONFLICT');
            changed(); return true;
        }
        const conflict = s.conflict;
        if (choice === 'reload') {
            for (const [f, expected] of Object.entries(conflict)) {
                const current = $.fs.readText(f);
                if (current !== expected) {
                    s.conflict[f] = typeof current === 'string' ? current : null;
                    s.native = [diag('EDITOR_WRITE_CONFLICT', 'error', 'Файл снова изменён извне: проверьте новую версию ' + f, { asset: f })];
                    changed(); return false;
                }
            }
            const activePath = s.sheets[s.activeSheet] && s.sheets[s.activeSheet].path;
            const rml = s.virtual ? s.model.rml : $.fs.readText(s.path);
            if (typeof rml !== 'string') return false;
            s.model = { rml, sheets: {} };
            s.parsed = M.parse(rml); s.sheets = []; s.disk = {};
            if (!s.virtual) s.disk[s.path] = rml;
            syncSheets(); s.activeSheet = Math.max(0, s.sheets.findIndex((sh) => sh.path === activePath));
            s.history = createHistory(s.model); s.conflict = null; s.native = [];
            s.sel = s.parsed.nodes.findIndex((n) => n.tag === 'body'); s.needsPreview = true; reparse(); changed();
            status('загружена внешняя версия'); return true;
        }
        if (choice === 'overwrite') return save({ overwrite: true, expected: conflict });
        return false;
    }

    // --- отрисовка ----------------------------------------------------------------------------------
    function renderTop() {
        doc.text('rm-file', esc(baseOf(s.path) + (s.virtual ? ' (пример разметки — не сохраняется)' : '') + (s.sheets.length ? ' + ' + s.sheets.length + ' стил.' : '')));
        doc.text('rm-dirty', dirty() ? 'не сохранено' : '');
    }
    function renderTree() {
        let html = '';
        for (const n of M.flatten(s.parsed)) {
            const id = M.attr(n, 'id'), cls = M.attr(n, 'class');
            const txt = M.isLeaf(n) ? String(M.innerText(s.model.rml, n) || '').trim().slice(0, 24) : '';
            html += '<div class="st-row rm-node' + (n.index === s.sel ? ' sel' : '') + '" data-key="' + n.index + '" style="padding-left:' + (8 + n.depth * 12) + 'px;">' +
                '<span class="rm-tag">' + esc(n.tag) + '</span>' + (id ? '<span class="rm-id">#' + esc(id) + '</span>' : '') +
                (cls ? '<span class="rm-cls">.' + esc(String(cls).trim().split(/\s+/).join('.')) + '</span>' : '') +
                (txt ? '<span class="rm-txt">' + esc(txt) + '</span>' : '') + '</div>';
        }
        doc.html('rm-tree', html || '<span class="st-empty">Элементов нет.</span>');
    }
    function renderProps() {
        const n = node();
        if (!n) { doc.html('rm-props', '<span class="st-title">Элемент</span><span class="st-empty">Выберите элемент в дереве или кликните по нему в превью.</span>'); return; }
        const others = n.attrs.filter((a) => a.name !== 'id' && a.name !== 'class').map((a) => a.name + (a.bare ? '' : '=' + a.value)).join('\n');
        const f = (id, label, v) => '<div class="st-field"><label>' + label + '</label><input id="' + id + '" class="st-in" type="text" value="' + esc(v) + '"/></div>';
        let html = '<span class="st-title">' + esc(M.label(n)) + '</span>' + f('rm-p-id', 'id', M.attr(n, 'id') || '') + f('rm-p-class', 'class', M.attr(n, 'class') || '');
        if (M.isLeaf(n)) html += f('rm-p-text', 'текст', M.innerText(s.model.rml, n) || '');
        html += '<span class="st-note">Остальные атрибуты: строка «имя=значение».</span><textarea id="rm-p-attrs" class="st-area" style="height:52px;">' + esc(others) + '</textarea>' +
            '<button class="st-btn primary wide" data-key="apply">Применить</button><div class="st-btns">' +
            ['add:+ div', 'dup:Копия', 'up:Выше', 'down:Ниже', 'del:Удалить'].map((x) => { const [k, l] = x.split(':'); return '<button class="st-btn" data-key="' + k + '">' + l + '</button>'; }).join('') + '</div>';
        doc.html('rm-props', html);
    }
    function renderSheets() {
        doc.html('rm-sheets', s.sheets.length ? s.sheets.map((sh, i) => '<button class="st-btn' + (i === s.activeSheet ? ' on' : '') + '" data-key="' + i + '">' + esc(baseOf(sh.path)) + (sh.missing ? ' (нет)' : '') + '</button>').join('')
            : '<span class="st-empty">Документ не подключает стилей.</span>');
        const sh = s.sheets[s.activeSheet];
        doc.setValue('rm-rcss', sh ? s.model.sheets[sh.path] : '');
        doc.cls('rm-rcss', 'st-hidden', !sh);
        doc.cls('rm-rcss-apply', 'st-hidden', !sh);
    }
    function diagnostics() {
        const seen = new Set(), out = [];
        for (const d of s.native.concat(s.live)) { const k = d.code + '|' + d.asset + '|' + d.message; if (!seen.has(k)) { seen.add(k); out.push(d); } }
        return out;
    }
    function renderDiag() {
        doc.html('rm-diag', diagnostics().map((x) => '<span class="st-diag ' + esc(x.severity) + '">' + esc(x.code + ': ' + x.message) + '</span>').join('') || '<span class="st-empty">Проблем нет.</span>');
    }
    function renderAll() {
        if (s.closed) return;
        renderTop(); renderTree(); renderProps(); renderSheets(); renderDiag();
        doc.setValue('rm-src', s.model.rml);
        renderConflict();
    }

    const guard = (fn) => (...a) => { try { return fn(...a); } catch (e) { status(e.message || String(e), true); return false; } };
    doc.on('rm-tree', 'click', (_id, _ev, key) => { if (key !== undefined && key !== '') ops.select(Number(key)); });
    doc.on('rm-props', 'click', guard((_id, _ev, key) => {
        const i = s.sel;
        if (key === 'apply') ops.applyProps();
        else if (key === 'add') { if (ops.addChild(i, 'div')) { const kids = s.parsed.nodes[i].children; ops.select(kids[kids.length - 1].index); } }
        else if (key === 'dup') ops.duplicate(i);
        else if (key === 'up') ops.move(i, -1);
        else if (key === 'down') ops.move(i, 1);
        else if (key === 'del') ops.remove(i);
    }));
    doc.on('rm-sheets', 'click', (_id, _ev, key) => { if (key !== undefined && key !== '') ops.selectSheet(Number(key)); });
    doc.on('rm-src-apply', 'click', () => ops.setSource(doc.value('rm-src') || ''));
    doc.on('rm-rcss-apply', 'click', () => ops.setSheet(s.activeSheet, doc.value('rm-rcss') || ''));
    doc.on('rm-refresh', 'click', () => rebuildPreview());
    doc.on('rm-validate', 'click', () => { validate(); });
    doc.on('rm-conflict', 'click', (_id, _ev, key) => { if (key === 'reload' || key === 'overwrite' || key === 'cancel') resolveConflict(key); });

    function update() {
        if (s.closed || !s.active) return;
        if (s.needsPreview) rebuildPreview();
        place();
        if ($.input.mousePressed('left') && !host.typing()) {
            const m = mousePx($);
            if (inside(m, doc.layoutRect('rm-view'))) ops.pickAt(m.x, m.y);
        }
    }

    function disposeDrafts() {
        unloadPreview();
        for (const f of s.drafts) $.fs.remove(f);
        s.drafts.clear();
    }

    return {
        doc, state: s,
        async open(path) {
            if (!/\.(rml|rcss)$/i.test(path)) throw new Error('RmlUi: нужен файл .rml или .rcss');
            let rmlPath = path, rml = null;
            if (/\.rcss$/i.test(path)) {
                // Стиль открывается вместе с документом своего каталога, который его подключает.
                const dir = dirOf(path);
                for (const f of ($.fs.list(dir) || []).filter((x) => /\.rml$/i.test(x) && !x.startsWith('.r2d-')).sort()) {
                    const t = $.fs.readText(join(dir, f));
                    if (t && M.links(M.parse(t)).some((l) => resolveRel(dir, l.href) === path)) { rmlPath = join(dir, f); rml = t; break; }
                }
                if (rml === null) { rml = SAMPLE(baseOf(path)); s.virtual = true; rmlPath = path.replace(/\.rcss$/i, '.rml'); }
            } else {
                rml = $.fs.readText(path);
                if (rml === null || rml === undefined) throw new Error('не удалось прочитать ' + path);
            }
            s.path = rmlPath;
            s.model = { rml, sheets: {} };
            s.conflict = null;
            if (!s.virtual) s.disk[rmlPath] = rml;
            s.parsed = M.parse(rml);
            syncSheets();
            s.activeSheet = Math.max(0, s.sheets.findIndex((x) => x.path === path));
            s.history = createHistory(s.model);
            reparse();
            s.sel = s.parsed.nodes.findIndex((n) => n.tag === 'body');
            s.native = [];
            s.needsPreview = true;
            renderAll();
            status('открыто');
        },
        update,
        layout() { s.placed = ''; },
        onActive(on) {
            s.active = !!on;
            s.placed = '';
            if (s.preview) { if (on) s.preview.show(); else s.preview.hide(); }
        },
        save,
        undo() { if (!s.history || !s.history.undo()) return false; s.native = []; afterChange(); return true; },
        redo() { if (!s.history || !s.history.redo()) return false; s.native = []; afterChange(); return true; },
        dirty,
        diagnostics,
        snapshot() {
            const n = node();
            return { asset: s.path, virtual: s.virtual, dirty: dirty(), elements: s.parsed.nodes.length, selected: n ? M.label(n) : null, sel: s.sel,
                sheets: s.sheets.map((x) => x.path), activeSheet: s.activeSheet, preview: !!s.preview, bodyId: s.bodyId, status: s.status, problems: diagnostics().length };
        },
        commands: () => [{ label: 'RmlUi: обновить предпросмотр', run: rebuildPreview }, { label: 'RmlUi: проверить (r2d validate)', run: validate }],
        ops: Object.assign({}, ops, { resolveConflict }),
        close() { s.closed = true; s.active = false; disposeDrafts(); doc.unload(); },
    };
}
