// ===========================================================================
// Хост студий данных (docs/SDK.md §8): одна RmlUi-страница `data_studio.rml`
// и общая механика — файл, undo/redo, сохранение, проверка, горячие клавиши,
// мышь над окном просмотра и кадровые хуки. Конкретная студия (Tilemap,
// Particle, Collision, Parallax, Font, Audio, Input) описывается объектом
// `def` и подмешивает только то, что отличает её редактор.
//
// `def` (всё необязательно, кроме id/title/kind):
//   id, title, kind            — идентификатор, заголовок, формат (sdk/lib/kinds/*.js)
//   leftTitle                  — заголовок левого списка
//   left(host) / tools(host) / right(host)   → RML-фрагмент региона
//   onLeft/onTool/onRight/onOverlay(host, key)  — клики по элементам с data-key
//   mount(host) / unmount(host)              — создать / убрать узлы предпросмотра
//   tick(host)                 — каждый кадр: мышь (host.ptr), рисование $.gfx.draw
//   hud(host)                  — строка состояния в окне просмотра
//   changed(host)              — после любой правки модели (undo/redo тоже)
//   api(host)                  — дополнительные методы для агента и тестов
//   snapshot(host)             — дополнительные поля снимка агента
//
// Кнопка человека и вызов агента — одна операция (`host.run`, `host.save`, …).
// Предпросмотр делает настоящий рантайм (`$`): студия не рисует вторую копию.
// ===========================================================================

import { openDataSession, createDataFile } from './data_session.js';
import { escapeHtml, joinPath, dirOf, summarize } from './model.js';
import * as views from './views.js';

const DOC = 'sdk/ui/data_studio.rml';
const hosts = new WeakMap();

export function getHost(app) {
    if (!hosts.has(app)) hosts.set(app, createHost(app));
    return hosts.get(app);
}

/** Точка входа студии: sdk/tools/<entry>.js → `open(app, args)`. */
export async function openStudio(app, def, args) {
    return getHost(app).open(def, args || {});
}

function createHost(app) {
    const $ = app.$;
    const doc = $.ui.doc(DOC);
    const s = {
        def: null,
        session: null,
        active: false,
        sel: -1,
        ext: {},                 // состояние конкретной студии
        status: '',
        wired: false,
    };
    // Мышь над окном просмотра: считывается один раз за кадр.
    const ptr = { x: 0, y: 0, inside: false, down: false, pressed: false, released: false, right: false, middle: false, dx: 0, dy: 0, wheel: 0 };
    let facade = null;

    // --- Помощники ------------------------------------------------------------------------
    const model = () => (s.session ? s.session.doc : null);
    const rect = () => doc.rect('ds-view') || { x: 0, y: 0, w: 0, h: 0 };

    function setStatus(text, fail) {
        s.status = text;
        app.setStatus(text, fail ? 'fail' : '');
        if (s.active) hud();
    }

    function note(severity, code, message, extra) {
        const d = Object.assign({ code, severity, asset: s.session ? s.session.path : null, location: null, message, details: null }, extra || {});
        if (s.session) s.session.native = (s.session.native || []).concat([d]);
        renderDiag([d].concat(s.session ? s.session.diagnostics : []));
        return d;
    }

    function allDiagnostics() {
        if (!s.session) return [];
        // Нативный результат (если он есть) точнее живого: показываем его, а живые правила
        // дополняют только тем, чего нативная проверка не сообщила.
        const nat = s.session.native;
        const live = s.session.diagnostics;
        if (!nat) return live;
        const seen = new Set(nat.map((d) => d.code + JSON.stringify(d.location)));
        return nat.concat(live.filter((d) => !seen.has(d.code + JSON.stringify(d.location))));
    }

    // --- Правки: одна команда — один шаг undo --------------------------------------------------------
    function run(label, fn) {
        if (!s.session) return null;
        try {
            const result = s.session.history.run(label, fn);
            s.session.native = null;
            s.session.live();
            changed();
            return result;
        } catch (e) {
            const message = e && e.message ? e.message : String(e);
            note('error', 'SDK_EDIT_REJECTED', message);
            setStatus('правка отклонена: ' + message, true);
            return null;
        }
    }

    function undo() {
        const label = s.session && s.session.history.undo();
        if (label) { s.session.native = null; s.session.live(); changed(); }
        return label;
    }

    function redo() {
        const label = s.session && s.session.history.redo();
        if (label) { s.session.native = null; s.session.live(); changed(); }
        return label;
    }

    function changed() {
        if (s.session) s.session.onRecovery = changed;
        clampSelection();
        if (s.def && s.def.changed) s.def.changed(api);
        renderAll();
    }

    function clampSelection() {
        const n = s.def && s.def.count ? s.def.count(api) : -1;
        if (n >= 0 && s.sel >= n) s.sel = n - 1;
    }

    function select(i) {
        s.sel = i;
        if (s.def && s.def.selected) s.def.selected(api, i);
        renderAll();
        return s.sel;
    }

    // --- Файл -------------------------------------------------------------------------------------------
    function defaultPath() {
        const proj = app.state.project;
        const ext = s.def.kind.SUFFIX;
        return joinPath(proj ? proj.abs : ($.fs.basePath() || '.'), 'assets/new' + ext);
    }

    function bindSession(session) {
        if (s.session && s.def.unmount) s.def.unmount(api);
        s.session = session;
        s.sel = session ? 0 : -1;
        s.ext = {};
        if (session && s.def.mount) s.def.mount(api);
        if (session) {
            doc.setValue('ds-path', session.path);
            setStatus(s.def.title + ': ' + session.path.split('/').pop(), false);
        }
        clampSelection();
        renderAll();
    }

    async function openFile(abs) {
        if (!abs) throw new Error(s.def.title + ': выберите файл ' + s.def.kind.SUFFIX + ' в Asset Browser или укажите путь справа');
        bindSession(openDataSession(app, s.def.kind, abs));
        return api;
    }

    function createFile(abs, opts) {
        const r = createDataFile(app, s.def.kind, abs, opts);
        if (!r.ok) {
            const list = [r.error];
            if (s.session) s.session.native = (s.session.native || []).concat(list);
            renderDiag(list.concat(s.session ? s.session.diagnostics : []));
            setStatus(r.error.message, true);
            return null;
        }
        bindSession(r.session);
        return api;
    }

    async function open(def, args) {
        if (s.active && s.def && s.def !== def && s.session && s.def.unmount) s.def.unmount(api);
        s.def = def;
        s.session = null;
        s.ext = {};
        s.sel = -1;
        s.active = true;
        facade = null;
        wire();
        if (app.doc) app.doc.hide();
        doc.show();
        doc.text('ds-title', escapeHtml(def.title));
        doc.text('ds-left-title', escapeHtml(def.leftTitle || 'СПИСОК'));
        doc.setValue('ds-path', defaultPath());
        $.gfx.color('#0b0e14');
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);
        app.setStatus(def.title, '');
        const asset = args.assetAbs || null;
        if (asset && asset.toLowerCase().endsWith(def.kind.SUFFIX)) await openFile(asset);
        else renderAll();
        // Каждая студия видна агенту под своим id: снимок активен только у открытой.
        const view = Object.create(api, {
            ops: { get() { return def.api ? def.api(api) : {}; } },
            snapshot: { value() { return s.def === def ? api.snapshot() : { active: false, kind: def.id }; } },
        });
        app.studios[def.id] = view;
        return { id: def.id, studio: view };
    }

    function close() {
        if (s.session && s.def && s.def.unmount) s.def.unmount(api);
        s.active = false;
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
    }

    async function save() {
        if (!s.session) return { ok: false, diagnostics: [] };
        setStatus('сохраняю…', false);
        const r = await s.session.save();
        renderAll();
        const errs = summarize(r.diagnostics).errors;
        setStatus(r.ok ? 'сохранено: ' + s.session.path.split('/').pop() : 'сохранено, но проверка нашла ошибок: ' + errs, !r.ok);
        return r;
    }

    async function validate() {
        if (!s.session) return { ok: false, diagnostics: [] };
        const r = await s.session.validateDraft();
        renderAll();
        setStatus(r.ok ? 'проверка: ошибок нет' : 'проверка: есть ошибки', !r.ok);
        return r;
    }

    // --- Отрисовка интерфейса --------------------------------------------------------------------------------
    function renderDiag(list) {
        doc.html('ds-diag', views.diagRows(list || allDiagnostics()));
    }

    function hud() {
        const text = s.def && s.def.hud && s.session ? s.def.hud(api) : (s.status || '—');
        doc.text('ds-hud', escapeHtml(text));
    }

    function renderTop() {
        const dirty = s.session && s.session.history.dirty();
        doc.text('ds-file', escapeHtml(s.session ? s.session.path : 'файл не открыт'));
        doc.text('ds-dirty', dirty ? '• есть несохранённые правки' : '');
        const h = s.session ? s.session.history : null;
        doc.cls('ds-undo', 'off', !(h && h.canUndo()));
        doc.cls('ds-redo', 'off', !(h && h.canRedo()));
        doc.text('ds-summary', escapeHtml(s.session ? s.def.kind.summary(s.session.doc) : 'Откройте файл или создайте новый: имя оканчивается на ' + s.def.kind.SUFFIX));
    }

    function renderAll() {
        if (!s.active || !s.def) return;
        renderTop();
        const d = s.def;
        const has = !!s.session;
        doc.html('ds-tools', has && d.tools ? d.tools(api) : '');
        doc.style('ds-tools', 'display', has && d.tools ? 'block' : 'none');
        doc.html('ds-left', has && d.left ? d.left(api) : '<p class="empty">Файл не открыт.</p>');
        doc.html('ds-right', has && d.right ? d.right(api) : '');
        renderDiag();
        hud();
    }

    function renderRight() {
        if (s.active && s.def && s.session && s.def.right) doc.html('ds-right', s.def.right(api));
    }

    // --- Мышь и клавиатура (опрос через публичный $.input) ----------------------------------------------------
    function pointer() {
        const r = rect();
        const m = $.input.mouse();
        ptr.inside = m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;
        ptr.dx = m.x - ptr.x;
        ptr.dy = m.y - ptr.y;
        ptr.x = m.x;
        ptr.y = m.y;
        const down = $.input.mouseDown('left');
        ptr.pressed = ptr.inside && $.input.mousePressed('left');
        ptr.released = ptr.down && !down;
        ptr.down = down;
        ptr.right = ptr.inside && $.input.mouseDown('right');
        ptr.middle = ptr.inside && $.input.mouseDown('middle');
        ptr.wheel = ptr.inside ? $.input.wheel().y : 0;
        ptr.rect = r;
    }

    function keys() {
        if (!s.session) return;
        const mod = $.input.ctrlDown() || $.input.down('cmd');   // Ctrl или Cmd (macOS)
        if (mod && $.input.pressed('z')) {
            if ($.input.shiftDown()) redo(); else undo();
        } else if (mod && $.input.pressed('y')) {
            redo();
        } else if (mod && $.input.pressed('s')) {
            save();
        }
    }

    function wire() {
        if (s.wired) return;
        s.wired = true;
        doc.on('ds-back', 'click', () => close());
        doc.on('ds-save', 'click', () => save());
        doc.on('ds-undo', 'click', () => undo());
        doc.on('ds-redo', 'click', () => redo());
        doc.on('ds-validate', 'click', () => validate());
        doc.on('ds-open', 'click', () => {
            const p = String(doc.value('ds-path') || '').trim();
            openFile(p).catch((e) => note('error', 'SDK_OPEN_FAILED', e && e.message ? e.message : String(e)));
        });
        doc.on('ds-create', 'click', () => createFile(String(doc.value('ds-path') || '').trim()));
        doc.on('ds-tools', 'click', (id, ev, key) => { if (key && s.def && s.def.onTool) s.def.onTool(api, key); });
        doc.on('ds-left', 'click', (id, ev, key) => { if (key !== '' && key !== undefined && s.def && s.def.onLeft) s.def.onLeft(api, key); });
        doc.on('ds-right', 'click', (id, ev, key) => { if (key && s.def && s.def.onRight) s.def.onRight(api, key); });
        doc.on('ds-overlay', 'click', (id, ev, key) => { if (key && s.def && s.def.onOverlay) s.def.onOverlay(api, key); });
    }

    $.update(() => {
        if (!s.active || !s.def) return;
        pointer();
        keys();
        if (s.session && s.def.tick) s.def.tick(api);
    });

    // --- Публичный объект: человек и агент вызывают одно и то же ---------------------------------------------------
    const api = {
        $, app, doc, state: s, ptr,
        get model() { return model(); },
        get session() { return s.session; },
        get sel() { return s.sel; },
        set sel(i) { s.sel = i; },
        get ext() { return s.ext; },
        get def() { return s.def; },
        rect, run, undo, redo, select, save, validate, close, open,
        openFile, createFile, setStatus, note, renderAll, renderRight, renderDiag, hud, changed,
        diagnostics: allDiagnostics,
        snapshot() {
            const sess = s.session;
            const diags = allDiagnostics();
            const sum = summarize(diags);
            const base = {
                active: s.active,
                kind: s.def ? s.def.id : null,
                file: sess ? sess.path : null,
                selected: s.sel,
                dirty: sess ? sess.history.dirty() : false,
                canUndo: sess ? sess.history.canUndo() : false,
                canRedo: sess ? sess.history.canRedo() : false,
                summary: sess ? s.def.kind.summary(sess.doc) : null,
                errors: sum.errors,
                warnings: sum.warnings,
                codes: diags.map((d) => d.code),
            };
            return Object.assign(base, s.def && s.def.snapshot ? s.def.snapshot(api) : {});
        },
    };
    Object.defineProperty(api, 'ops', { get() { return s.def && s.def.api ? s.def.api(api) : {}; } });
    return api;
}
