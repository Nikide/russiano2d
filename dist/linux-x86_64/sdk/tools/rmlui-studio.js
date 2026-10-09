// ===========================================================================
// RmlUi Studio — редактор `.rml` и `.rcss` (docs/SDK.md §8): дерево элементов,
// свойства, исходник и RCSS. Файлы остаются обычным текстом: студия меняет
// только тот фрагмент, который правит человек (sdk/lib/rml_model.js).
//
// Предпросмотр — настоящий RmlUi: черновик документа и стилей пишется рядом с
// файлом под именем `.r2d-draft-*`, загружается через `$.ui.doc` и прижимается
// к окну просмотра. Закрытие студии удаляет черновики.
// ===========================================================================

import * as M from '../lib/rml_model.js';
import { createHistory } from '../lib/history.js';
import { escapeHtml, joinPath, dirOf, absolutePath, summarize } from '../lib/model.js';
import * as views from '../lib/views.js';
import { err, warn, parseNum } from '../lib/kit.js';

export const standalone = true;

const DOC = 'sdk/ui/rmlui_studio.rml';
const DRAFT = '.r2d-draft-';
const BODY_ID = 'r2d-pv-root';
const SAMPLE = (href) => '<rml>\n<head>\n    <link type="text/rcss" href="' + href + '"/>\n    <title>Пример</title>\n</head>\n<body>\n' +
    '<div id="sample" class="panel">\n    <h1>Заголовок</h1>\n    <p>Абзац текста.</p>\n    <button id="btn" class="btn">Кнопка</button>\n</div>\n</body>\n</rml>\n';

let singleton = null;

export async function open(app, args) {
    if (!singleton) singleton = create(app);
    return singleton.openAsset(args.assetAbs || null);
}

function resolveRel(dir, href) {
    if (/^([A-Za-z]:[\\/]|\/)/.test(href)) return href;
    const out = [];
    for (const part of (dir + '/' + href).split('/')) {
        if (part === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop();
        else if (part !== '.') out.push(part);
    }
    return out.join('/');
}

function draftOf(path) {
    return joinPath(dirOf(path), DRAFT + path.split('/').pop());
}

function draftHref(href) {
    const i = href.lastIndexOf('/');
    return (i < 0 ? '' : href.slice(0, i + 1)) + DRAFT + href.slice(i + 1);
}

function create(app) {
    const $ = app.$;
    const doc = $.ui.doc(DOC);
    const s = {
        active: false, path: null, virtual: false, model: null, history: null, parsed: null, sel: -1,
        sheets: [], activeSheet: 0, preview: null, drafts: [], diagnostics: [], native: null, wired: false, status: '', previewOk: true,
    };

    const rect = () => doc.rect('rm-view') || { x: 0, y: 0, w: 0, h: 0 };
    const setStatus = (text, fail) => { s.status = text; app.setStatus(text, fail ? 'fail' : ''); doc.text('rm-hud', escapeHtml(text)); };

    // --- Открытие -------------------------------------------------------------------------------------------
    async function openAsset(abs) {
        if (!abs || !/\.(rml|rcss)$/i.test(abs)) throw new Error('RmlUi Studio: выберите файл .rml или .rcss в Asset Browser (или укажите путь справа)');
        dispose();
        let rmlPath = abs, rml = null, virtual = false;
        if (/\.rcss$/i.test(abs)) {
            // Стиль открывается вместе с документом, который его подключает; нет такого — пример разметки.
            const dir = dirOf(abs), name = abs.split('/').pop();
            for (const f of $.fs.list(dir) || []) {
                if (!/\.rml$/i.test(f)) continue;
                const t = $.fs.readText(joinPath(dir, f));
                if (t && M.links(M.parse(t)).some((l) => resolveRel(dir, l.href) === abs)) { rmlPath = joinPath(dir, f); rml = t; break; }
            }
            if (rml === null) { rml = SAMPLE(name); virtual = true; rmlPath = abs.replace(/\.rcss$/i, '.rml'); }
        } else {
            rml = $.fs.readText(abs);
            if (rml === null || rml === undefined) throw new Error('не удалось прочитать ' + abs);
        }
        s.path = rmlPath;
        s.virtual = virtual;
        s.model = { rml, sheets: {} };
        const parsed = M.parse(rml);
        s.sheets = [];
        for (const l of M.links(parsed)) {
            const p = resolveRel(dirOf(rmlPath), l.href);
            if (s.sheets.some((x) => x.path === p)) continue;
            const text = $.fs.readText(p);
            s.model.sheets[p] = text === null || text === undefined ? '' : text;
            s.sheets.push({ path: p, href: l.href, missing: text === null || text === undefined });
        }
        s.activeSheet = Math.max(0, s.sheets.findIndex((x) => x.path === abs));
        s.history = createHistory(s.model);
        if (app.recovery) app.recovery.watch(s.path, s.model, s.history, () => { reparse(); refresh(); renderAll(); });
        s.sel = -1;
        s.active = true;
        wire();
        if (app.doc) app.doc.hide();
        doc.show();
        doc.setValue('rm-path', rmlPath);
        $.gfx.color('#0b0e14');
        reparse();
        select(parsed.nodes.findIndex((n) => n.tag === 'body'));
        await refresh();
        renderAll();
        setStatus('RmlUi Studio: ' + rmlPath.split('/').pop(), false);
        return { id: 'rmlui-studio', studio: api };
    }

    function dispose() {
        unloadPreview();
        for (const f of s.drafts) $.fs.remove(f);
        s.drafts = [];
    }

    function close() {
        dispose();
        s.active = false;
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
    }

    // --- Модель ---------------------------------------------------------------------------------------------------
    function reparse() {
        s.parsed = M.parse(s.model.rml);
        const live = M.checkRml(s.model.rml).map((d) => Object.assign({}, d, { asset: s.path }));
        for (const sh of s.sheets) for (const d of M.checkRcss(s.model.sheets[sh.path])) live.push(Object.assign({}, d, { asset: sh.path }));
        for (const sh of s.sheets) if (sh.missing && s.model.sheets[sh.path] === '') live.push(Object.assign(warn('SDK_RML_SHEET_MISSING', 'Файл стилей «' + sh.href + '» не найден: будет создан при сохранении', null), { asset: sh.path }));
        s.diagnostics = live;
    }

    function run(label, fn) {
        if (!s.history) return null;
        try {
            const r = s.history.run(label, fn);
            s.native = null;
            reparse();
            clampSel();
            refresh();
            renderAll();
            return r === undefined ? true : r;
        } catch (e) {
            const message = e && e.message ? e.message : String(e);
            s.diagnostics = s.diagnostics.concat([Object.assign(err('SDK_EDIT_REJECTED', message), { asset: s.path })]);
            renderDiag();
            setStatus('правка отклонена: ' + message, true);
            return null;
        }
    }

    function clampSel() { if (s.sel >= s.parsed.nodes.length) s.sel = s.parsed.nodes.length - 1; }
    const node = () => (s.sel >= 0 ? s.parsed.nodes[s.sel] : null);

    // --- Предпросмотр: черновики и настоящий документ --------------------------------------------------------------------------
    function unloadPreview() {
        if (s.preview) { try { s.preview.unload(); } catch (e) { /* уже выгружен */ } s.preview = null; }
    }

    async function refresh() {
        const errs = s.parsed.diagnostics;
        s.previewOk = errs.length === 0;
        if (errs.length) { setStatus('предпросмотр не обновлён: ' + errs[0].message, true); return false; }
        // Черновики стилей и документа рядом с оригиналами; документ ссылается на черновики стилей.
        const map = {};
        for (const sh of s.sheets) {
            const dp = draftOf(sh.path);
            $.fs.write(dp, s.model.sheets[sh.path]);
            if (s.drafts.indexOf(dp) < 0) s.drafts.push(dp);
            map[sh.href] = draftHref(sh.href);
        }
        const withBody = M.withBodyId(M.retargetLinks(s.model.rml, map), BODY_ID);
        const dr = draftOf(s.path);
        if (!$.fs.write(dr, withBody.text)) { setStatus('не удалось записать черновик ' + dr, true); return false; }
        if (s.drafts.indexOf(dr) < 0) s.drafts.push(dr);
        unloadPreview();
        s.preview = $.ui.doc(dr);
        s.preview.show();
        s.bodyId = withBody.id;
        placePreview();
        setStatus('предпросмотр обновлён · ' + s.parsed.nodes.length + ' элементов', false);
        return true;
    }

    function placePreview() {
        if (!s.preview || !s.bodyId) return;
        const r = rect();
        const st = (k, v) => s.preview.style(s.bodyId, k, v);
        st('position', 'absolute'); st('left', Math.round(r.x) + 'px'); st('top', Math.round(r.y) + 'px');
        st('width', Math.round(r.w) + 'px'); st('height', Math.round(r.h) + 'px'); st('overflow', 'hidden');
    }

    // --- Интерфейс --------------------------------------------------------------------------------------------------------------------
    function renderTree() {
        const p = s.parsed;
        const body = M.findByTag(p, 'body');
        let html = '';
        for (const n of M.flatten(p)) {
            const id = M.attr(n, 'id'), cls = M.attr(n, 'class');
            const txt = M.isLeaf(n) ? M.innerText(s.model.rml, n).trim().slice(0, 24) : '';
            html += '<div class="node-row' + (n.index === s.sel ? ' sel' : '') + '" data-key="' + n.index + '" style="padding-left:' + (8 + n.depth * 12) + 'px">' +
                '<span class="node-tag">' + escapeHtml(n.tag) + '</span>' + (id ? '<span class="node-id">#' + escapeHtml(id) + '</span>' : '') +
                (cls ? '<span class="node-cls">.' + escapeHtml(String(cls).trim().split(/\s+/).join('.')) + '</span>' : '') +
                (txt ? '<span class="node-txt">' + escapeHtml(txt) + '</span>' : '') + '</div>';
        }
        doc.html('rm-tree', '<div class="list grow">' + (html || '<p class="empty">Элементов нет.</p>') + '</div>');
    }

    function renderProps() {
        const n = node();
        if (!n) { doc.html('rm-props', '<h4>СВОЙСТВА</h4><p class="empty">Выберите элемент в дереве.</p>'); return; }
        const others = n.attrs.filter((a) => a.name !== 'id' && a.name !== 'class').map((a) => a.name + (a.bare ? '' : '=' + a.value)).join('\n');
        const f = (id, label, v) => '<div class="field-row"><label>' + label + '</label><input id="' + id + '" type="text" value="' + escapeHtml(v) + '" class="field"/></div>';
        let html = '<h4>СВОЙСТВА — ' + escapeHtml(M.label(n)) + '</h4>' + f('rp-id', 'id', M.attr(n, 'id') || '') + f('rp-class', 'class', M.attr(n, 'class') || '');
        if (M.isLeaf(n)) html += f('rp-text', 'текст', M.innerText(s.model.rml, n));
        html += '<div class="hint">Остальные атрибуты: одна строка — «имя=значение».</div><textarea id="rp-attrs" class="area" style="height:56px;">' + escapeHtml(others) + '</textarea>' +
            '<div class="field-row"><button class="btn small primary" data-key="apply">Применить</button></div>' +
            '<div class="field-row"><button class="btn small" data-key="addchild">+ div</button><button class="btn small" data-key="dup">Копия</button>' +
            '<button class="btn small" data-key="up">Выше</button><button class="btn small" data-key="down">Ниже</button><button class="btn small danger" data-key="del">Удалить</button></div>';
        doc.html('rm-props', html);
    }

    function renderSheets() {
        doc.html('rm-sheets', s.sheets.length ? s.sheets.map((sh, i) =>
            '<button class="btn small' + (i === s.activeSheet ? ' on' : '') + '" data-key="' + i + '">' + escapeHtml(sh.href.split('/').pop()) + '</button>').join('') : '<span class="sub">у документа нет подключённых стилей</span>');
        const sh = s.sheets[s.activeSheet];
        doc.setValue('rm-rcss', sh ? s.model.sheets[sh.path] : '');
    }

    function renderDiag() {
        const nat = s.native;
        const list = nat ? nat.concat(s.diagnostics.filter((d) => !nat.some((x) => x.code === d.code))) : s.diagnostics;
        doc.html('rm-diag', views.diagRows(list));
    }

    function renderTop() {
        const dirty = s.history && s.history.dirty();
        doc.text('rm-file', escapeHtml((s.path || 'файл не открыт') + (s.virtual ? ' (пример разметки: не сохраняется)' : '')));
        doc.text('rm-dirty', dirty ? '• есть несохранённые правки' : '');
        doc.cls('rm-undo', 'off', !(s.history && s.history.canUndo()));
        doc.cls('rm-redo', 'off', !(s.history && s.history.canRedo()));
    }

    function renderAll() {
        if (!s.active) return;
        renderTop();
        renderTree();
        renderProps();
        renderSheets();
        doc.setValue('rm-src', s.model.rml);
        renderDiag();
    }

    function select(i) {
        s.sel = i >= 0 && i < s.parsed.nodes.length ? i : -1;
        renderTree();
        renderProps();
        return s.sel;
    }

    // --- Операции (кнопка человека и вызов агента — одно и то же) ------------------------------------------------------------------------
    function closeEnd(text, n) {
        if (n.selfClosing || n.closeStart < 0) return n.end;
        const e = text.indexOf('>', n.closeStart);
        return e < 0 ? text.length : e + 1;
    }

    const ops = {
        /** Заменить весь исходник RML. */
        setSource(text) { return run('исходник', (m) => { m.rml = String(text); }); },
        setAttrs(index, patch) {
            return run('атрибуты', (m) => {
                const n = M.parse(m.rml).nodes[index];
                if (!n) throw new Error('Нет элемента ' + index);
                m.rml = M.setAttrs(m.rml, n, patch);
            });
        },
        setText(index, value) {
            return run('текст', (m) => {
                const n = M.parse(m.rml).nodes[index];
                if (!n) throw new Error('Нет элемента ' + index);
                m.rml = M.setInnerText(m.rml, n, value);
            });
        },
        addChild(index, tag) {
            return run('новый элемент', (m) => {
                const n = M.parse(m.rml).nodes[index];
                if (!n) throw new Error('Нет элемента ' + index);
                if (n.selfClosing) throw new Error('У самозакрывающегося элемента нет содержимого');
                const t = tag || 'div';
                m.rml = m.rml.slice(0, n.innerEnd) + '<' + t + '></' + t + '>\n' + m.rml.slice(n.innerEnd);
            });
        },
        duplicate(index) {
            return run('копия элемента', (m) => {
                const n = M.parse(m.rml).nodes[index];
                if (!n) throw new Error('Нет элемента ' + index);
                if (n.tag === 'rml' || n.tag === 'body' || n.tag === 'head') throw new Error('Корневые разделы не дублируются');
                const e = closeEnd(m.rml, n);
                m.rml = m.rml.slice(0, e) + '\n' + m.rml.slice(n.start, e) + m.rml.slice(e);
            });
        },
        remove(index) {
            return run('удаление элемента', (m) => {
                const n = M.parse(m.rml).nodes[index];
                if (!n) throw new Error('Нет элемента ' + index);
                if (n.tag === 'rml' || n.tag === 'body' || n.tag === 'head') throw new Error('Корневые разделы не удаляются');
                m.rml = m.rml.slice(0, n.start) + m.rml.slice(closeEnd(m.rml, n));
            });
        },
        move(index, dir) {
            return run('порядок элементов', (m) => {
                const p = M.parse(m.rml);
                const n = p.nodes[index];
                if (!n) throw new Error('Нет элемента ' + index);
                const sib = n.parent.children, at = sib.indexOf(n), to = at + (dir < 0 ? -1 : 1);
                if (to < 0 || to >= sib.length) return;
                const a = dir < 0 ? sib[to] : n, b = dir < 0 ? n : sib[to];
                const ea = closeEnd(m.rml, a), eb = closeEnd(m.rml, b);
                m.rml = m.rml.slice(0, a.start) + m.rml.slice(b.start, eb) + m.rml.slice(ea, b.start) + m.rml.slice(a.start, ea) + m.rml.slice(eb);
            });
        },
        setSheet(i, text) {
            return run('RCSS', (m) => {
                const sh = s.sheets[i];
                if (!sh) throw new Error('Нет стиля ' + i);
                m.sheets[sh.path] = String(text);
            });
        },
        /** Применить поля панели свойств к выбранному элементу одной командой. */
        applyProps() {
            const n = node();
            if (!n) return null;
            const patch = { id: doc.value('rp-id') || null, class: doc.value('rp-class') || null };
            const old = n.attrs.filter((a) => a.name !== 'id' && a.name !== 'class').map((a) => a.name);
            for (const name of old) patch[name] = null;
            for (const line of String(doc.value('rp-attrs') || '').split('\n')) {
                const t = line.trim();
                if (!t) continue;
                const i = t.indexOf('=');
                if (i < 0) patch[t] = ''; else patch[t.slice(0, i).trim()] = t.slice(i + 1);
            }
            const index = s.sel, text = M.isLeaf(n) ? doc.value('rp-text') : null;
            return run('элемент', (m) => {
                let cur = M.parse(m.rml);
                const hasText = text !== null && text !== undefined && text !== M.innerText(m.rml, cur.nodes[index]);
                if (hasText) { m.rml = M.setInnerText(m.rml, cur.nodes[index], text); cur = M.parse(m.rml); }
                m.rml = M.setAttrs(m.rml, cur.nodes[index], patch);
            });
        },
        selectSheet(i) { s.activeSheet = Math.max(0, Math.min(s.sheets.length - 1, i)); renderSheets(); return s.activeSheet; },
        select,
        undo() { const l = s.history && s.history.undo(); if (l) { s.native = null; reparse(); clampSel(); refresh(); renderAll(); } return l; },
        redo() { const l = s.history && s.history.redo(); if (l) { s.native = null; reparse(); clampSel(); refresh(); renderAll(); } return l; },
        refresh,
    };

    async function save() {
        if (!s.history) return { ok: false, diagnostics: [] };
        if (!s.virtual && !$.fs.write(s.path, s.model.rml)) { setStatus('не удалось записать ' + s.path, true); return { ok: false, diagnostics: [] }; }
        for (const sh of s.sheets) {
            if (!$.fs.write(sh.path, s.model.sheets[sh.path])) { setStatus('не удалось записать ' + sh.path, true); return { ok: false, diagnostics: [] }; }
            sh.missing = false;
        }
        s.history.markSaved();
        const files = (s.virtual ? [] : [s.path]).concat(s.sheets.map((x) => x.path));
        let diags = [], ok = true;
        for (const f of files) {
            const r = await app.backend(['validate', f], 'проверяю ' + f.split('/').pop());
            if (r.json) { diags = diags.concat(r.json.diagnostics || []); if (!r.json.ok) ok = false; }
        }
        s.native = diags;
        renderAll();
        setStatus(ok ? 'сохранено: ' + s.path.split('/').pop() : 'сохранено, но проверка нашла ошибки', !ok);
        return { ok, diagnostics: diags };
    }

    /** Проверка несохранённого состояния нативным валидатором: те же черновики, что видит предпросмотр. */
    async function validate() {
        if (!s.history) return { ok: false, diagnostics: [] };
        const drafts = [{ path: draftOf(s.path), real: s.path, text: s.model.rml }].concat(s.sheets.map((x) => ({ path: draftOf(x.path), real: x.path, text: s.model.sheets[x.path] })));
        let diags = [], ok = true;
        for (const d of drafts) {
            if (!$.fs.write(d.path, d.text)) continue;
            if (s.drafts.indexOf(d.path) < 0) s.drafts.push(d.path);
            const r = await app.backend(['validate', d.path], 'проверяю черновик');
            if (r.json) {
                diags = diags.concat((r.json.diagnostics || []).map((x) => Object.assign({}, x, { asset: x.asset === d.path ? d.real : x.asset })));
                if (!r.json.ok) ok = false;
            }
        }
        s.native = diags;
        renderDiag();
        setStatus(ok ? 'проверка: ошибок нет' : 'проверка: есть ошибки', !ok);
        return { ok, diagnostics: diags };
    }

    function wire() {
        if (s.wired) return;
        s.wired = true;
        doc.on('rm-back', 'click', () => close());
        doc.on('rm-save', 'click', () => save());
        doc.on('rm-undo', 'click', () => ops.undo());
        doc.on('rm-redo', 'click', () => ops.redo());
        doc.on('rm-validate', 'click', () => validate());
        doc.on('rm-refresh', 'click', () => refresh());
        doc.on('rm-open', 'click', () => {
            const p = absolutePath($.fs.basePath(), String(doc.value('rm-path') || '').trim());
            openAsset(p).catch((e) => { s.diagnostics = [Object.assign(err('SDK_OPEN_FAILED', e && e.message ? e.message : String(e)), { asset: p })]; renderDiag(); });
        });
        doc.on('rm-tree', 'click', (id, ev, key) => { if (key !== '' && key !== undefined) select(parseInt(key, 10)); });
        doc.on('rm-sheets', 'click', (id, ev, key) => { if (key !== '' && key !== undefined) ops.selectSheet(parseInt(key, 10)); });
        doc.on('rm-apply-src', 'click', () => ops.setSource(doc.value('rm-src')));
        doc.on('rm-apply-rcss', 'click', () => ops.setSheet(s.activeSheet, doc.value('rm-rcss')));
        doc.on('rm-props', 'click', (id, ev, key) => {
            if (key === 'apply') ops.applyProps();
            else if (key === 'addchild') ops.addChild(s.sel);
            else if (key === 'dup') ops.duplicate(s.sel);
            else if (key === 'del') ops.remove(s.sel);
            else if (key === 'up') ops.move(s.sel, -1);
            else if (key === 'down') ops.move(s.sel, 1);
        });
    }

    function keys() {
        if (!s.active || !s.history) return;
        const mod = $.input.ctrlDown() || $.input.down('cmd');   // Ctrl или Cmd (macOS)
        if (mod && $.input.pressed('z')) { if ($.input.shiftDown()) ops.redo(); else ops.undo(); }
        else if (mod && $.input.pressed('s')) save();
    }

    $.update(() => {
        if (!s.active) return;
        keys();
        // Окно просмотра может менять размер вместе с окном SDK — предпросмотр следует за ним.
        const r = rect();
        const key = [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)].join(',');
        if (key !== s.rectKey) { s.rectKey = key; placePreview(); }
    });

    const api = {
        state: s, ops, openAsset, close, save, validate, refresh,
        get model() { return s.model; },
        snapshot() {
            const sum = summarize(s.diagnostics);
            return {
                active: s.active, file: s.path, virtual: s.virtual, elements: s.parsed ? s.parsed.nodes.length : 0, selected: s.sel,
                selectedLabel: node() ? M.label(node()) : null, sheets: s.sheets.map((x) => x.href), activeSheet: s.activeSheet,
                dirty: s.history ? s.history.dirty() : false, canUndo: s.history ? s.history.canUndo() : false, canRedo: s.history ? s.history.canRedo() : false,
                preview: !!s.preview, previewOk: s.previewOk, errors: sum.errors, warnings: sum.warnings, codes: s.diagnostics.map((d) => d.code),
            };
        },
    };
    app.studios = app.studios || {};
    app.studios['rmlui-studio'] = api;
    return api;
}
