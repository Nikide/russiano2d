// ===========================================================================
// Sprite Studio — редактор атласа спрайтов (docs/SDK.md §7).
//
// Редактирует обычный файл `*.atlas.json` (Aseprite-совместимый формат,
// который читает `$.atlas`): кадры, пивоты, длительности, метаданные.
// Это не редактор сцены — он правит конкретный тип данных.
//
// Картинка рисуется настоящим рендерером движка (`$.gfx.draw.sprite`, nearest,
// как в игре), а рамки кадров, пивоты и подписи — элементы RmlUi поверх неё.
// Любая правка — команда с undo/redo; на диск пишет только «Сохранить».
// Человек и агент вызывают одни и те же методы (`app.studios.sprite.*`).
// ===========================================================================

import * as M from '../lib/atlas_model.js';
import { openAtlasSession, createAtlasFromImage } from '../lib/atlas_session.js';
import { escapeHtml, dirOf, joinPath } from '../lib/model.js';
import * as views from '../lib/views.js';

const DOC = 'sdk/ui/sprite_studio.rml';
const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

let singleton = null;

/** Точка входа инструмента: sdk_tools.json → entry «sprite-studio». */
export async function open(app, args) {
    if (!singleton) singleton = createStudio(app);
    return singleton.openAsset(args.assetAbs || args.asset || null);
}

export function createStudio(app) {
    const $ = app.$;
    const doc = $.ui.doc(DOC);
    const s = {
        active: false,
        session: null,
        createFor: null,         // картинка без атласа: режим «создать»
        imageAbs: '',
        tex: null,               // { w, h } — размер картинки
        node: null,              // узел рантайма с картинкой (обычный <sprite>)
        view: { cx: 0, cy: 0, px: 0, py: 0, zoom: 1 },
        sel: -1,
        tool: 'select',          // 'select' | 'pivot'
        grid: true,
        press: null,             // состояние нажатой левой кнопки
        pan: false,
        status: '',
        dirtyView: true,
        mouse: { x: 0, y: 0, tx: 0, ty: 0 },
    };
    let wired = false;

    // --- Вспомогательное --------------------------------------------------------
    const D = () => (s.session ? s.session.doc : null);

    function note(severity, code, message, extra) {
        const d = Object.assign({ code, severity, asset: s.session ? s.session.path : null, location: null, message, details: null }, extra || {});
        const list = (s.session ? s.session.diagnostics : []).concat([d]);
        if (s.session) s.session.diagnostics = list;
        renderDiag(list);
        return d;
    }

    function slotRect() {
        return doc.rect('ss-view') || { x: 0, y: 0, w: 0, h: 0 };
    }

    function layout() {
        const r = slotRect();
        s.view.cx = r.x + r.w / 2;
        s.view.cy = r.y + r.h / 2;
        return r;
    }

    function fit() {
        const r = layout();
        if (!s.tex) return;
        s.view.zoom = M.fitZoom(s.tex.w, s.tex.h, Math.max(1, r.w - 40), Math.max(1, r.h - 40));
        s.view.px = s.tex.w / 2;
        s.view.py = s.tex.h / 2;
        s.dirtyView = true;
    }

    function setZoom(zoom, anchor) {
        const z = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], zoom));
        if (anchor) {
            // Точка под курсором остаётся на месте.
            const before = M.screenToTex(s.view, anchor.x, anchor.y);
            s.view.zoom = z;
            s.view.px = before.x - (anchor.x - s.view.cx) / z;
            s.view.py = before.y - (anchor.y - s.view.cy) / z;
        } else {
            s.view.zoom = z;
        }
        s.dirtyView = true;
        return z;
    }

    function stepZoom(dir, anchor) {
        const cur = s.view.zoom;
        let idx = ZOOMS.findIndex((z) => z >= cur - 1e-9);
        if (idx < 0) idx = ZOOMS.length - 1;
        if (dir > 0) idx = Math.min(ZOOMS.length - 1, ZOOMS[idx] > cur + 1e-9 ? idx : idx + 1);
        else idx = Math.max(0, idx - 1);
        return setZoom(ZOOMS[idx], anchor);
    }

    // --- Команды правки (undo/redo) ----------------------------------------------
    function run(label, fn) {
        if (!s.session) return null;
        try {
            const result = s.session.history.run(label, fn);
            s.dirtyView = true;
            renderAll();
            return result;
        } catch (e) {
            note('error', 'SDK_EDIT_REJECTED', e && e.message ? e.message : String(e));
            setStatus('правка отклонена: ' + (e && e.message ? e.message : e), true);
            return null;
        }
    }

    function setStatus(text, fail) {
        s.status = text;
        app.setStatus(text, fail ? 'fail' : '');
        if (doc) doc.text('ss-hud', escapeHtml(hudText()));
    }

    const ops = {
        addFrame(rect, name) { return run('кадр', (d) => { const i = M.addFrame(d, rect, name); s.sel = i; return i; }); },
        removeFrame(i) { return run('удаление кадра', (d) => { M.removeFrame(d, i); s.sel = Math.min(s.sel, d.frames.length - 1); }); },
        renameFrame(i, name) { return run('имя кадра', (d) => M.renameFrame(d, i, name)); },
        setRect(i, rect) { return run('рамка кадра', (d) => M.setRect(d, i, rect)); },
        setPivot(i, pivot) { return run('пивот', (d) => M.setPivot(d, i, pivot)); },
        setDuration(i, ms) { return run('длительность', (d) => M.setDuration(d, i, ms)); },
        moveFrame(from, to) { return run('порядок кадров', (d) => M.moveFrame(d, from, to)); },
        setCustom(key, value) { return run('метаданные', (d) => M.setCustom(d, key, value)); },
        // Все поля формы одной командой: одна правка — один шаг undo.
        applyFields(i, f) {
            return run('кадр «' + (D() && D().frames[i] ? D().frames[i].name : i) + '»', (d) => {
                if (f.name !== undefined && f.name !== d.frames[i].name) M.renameFrame(d, i, f.name);
                if (f.rect) M.setRect(d, i, f.rect);
                if (f.pivot !== undefined) M.setPivot(d, i, f.pivot);
                if (f.duration !== undefined) M.setDuration(d, i, f.duration);
            });
        },
        undo() { const l = s.session && s.session.history.undo(); if (l) { s.dirtyView = true; renderAll(); } return l; },
        redo() { const l = s.session && s.session.history.redo(); if (l) { s.dirtyView = true; renderAll(); } return l; },
    };

    // --- Открытие и сохранение ------------------------------------------------------
    async function openAsset(abs) {
        if (!abs) throw new Error('Sprite Studio: выберите *.atlas.json или картинку в Asset Browser');
        s.createFor = null;
        s.session = null;
        s.sel = -1;
        if (abs.endsWith('.atlas.json')) {
            s.session = openAtlasSession(app, abs);
            s.imageAbs = s.session.imageAbs;
            s.tex = s.session.tex;
        } else {
            // Картинка: если рядом уже есть атлас — открываем его, иначе режим «создать».
            const guess = joinPath(dirOf(abs), abs.split('/').pop().replace(/\.[^.]+$/, '') + '.atlas.json');
            if ($.fs.exists(guess)) {
                s.session = openAtlasSession(app, guess);
                s.imageAbs = s.session.imageAbs;
                s.tex = s.session.tex;
            } else {
                s.createFor = abs;
                s.imageAbs = abs;
                const size = $.gfx.textureSize(abs);
                s.tex = size && size[0] > 0 ? { w: size[0], h: size[1] } : null;
                if (!s.tex) throw new Error('не удалось прочитать картинку ' + abs);
            }
        }
        show();
        return { id: 'sprite-studio', studio: api };
    }

    /**
     * Картинка рисуется обычным узлом `<sprite>` — тем же путём, что и в игре
     * (nearest-фильтр, батч кадра). Камера стоит в центре окна, поэтому
     * мировые координаты узла равны экранным.
     */
    function ensureNode() {
        if (s.node && s.node.__path === s.imageAbs) return;
        killNode();
        if (!s.imageAbs || !s.tex) return;
        const w = $('<sprite>', { id: 'sdk-sprite-tex', src: s.imageAbs }).appendTo($.world);
        s.node = w.get(0);
        s.node.__path = s.imageAbs;
    }

    function killNode() {
        if (s.node) { $(s.node).remove(); s.node = null; }
    }

    function syncNode() {
        ensureNode();
        if (!s.node || !s.tex) return;
        const z = s.view.zoom;
        const c = M.texToScreen(s.view, s.tex.w / 2, s.tex.h / 2);
        $(s.node).at(c.x, c.y).size(s.tex.w * z, s.tex.h * z);
    }

    function show() {
        s.active = true;
        if (app.doc) app.doc.hide();
        doc.show();
        wire();
        $.gfx.color('#0e1420');
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);
        app.setStatus('Sprite Studio: ' + (s.session ? s.session.path.split('/').pop() : s.createFor.split('/').pop()), '');
        // Размер окна просмотра известен только после первой раскладки RmlUi.
        s.dirtyView = true;
        s.needFit = true;
        renderAll();
    }

    function close() {
        s.active = false;
        killNode();
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
    }

    async function save() {
        if (!s.session) return { ok: false, diagnostics: [] };
        s.session.measure();
        setStatus('сохраняю…', false);
        const r = await s.session.save();
        renderAll();
        setStatus(r.ok ? 'сохранено: ' + s.session.path.split('/').pop() : 'сохранено, но есть ошибки проверки', !r.ok);
        return r;
    }

    async function validate() {
        if (!s.session) return { ok: false, diagnostics: [] };
        const r = await s.session.validateDraft();
        renderDiag(r.diagnostics);
        setStatus(r.ok ? 'проверка: ошибок нет' : 'проверка: есть ошибки', !r.ok);
        return r;
    }

    async function makeAtlas() {
        if (!s.createFor) return { ok: false, diagnostics: [] };
        const cols = parseInt(doc.value('g-cols'), 10);
        const rows = parseInt(doc.value('g-rows'), 10);
        const duration = parseInt(doc.value('g-dur'), 10) || 100;
        const r = await createAtlasFromImage(app, s.createFor, { cols, rows, duration });
        if (!r.ok) {
            renderDiag(r.diagnostics);
            setStatus('не удалось создать атлас', true);
            return r;
        }
        s.session = r.session;
        s.createFor = null;
        s.imageAbs = r.session.imageAbs;
        s.tex = r.session.tex;
        s.sel = 0;
        s.needFit = true;
        renderAll();
        setStatus('атлас создан: ' + r.session.path.split('/').pop(), false);
        return r;
    }

    // --- Выбор и поля ------------------------------------------------------------------
    function select(i) {
        const d = D();
        s.sel = d && i >= 0 && i < d.frames.length ? i : -1;
        s.dirtyView = true;
        renderAll();
        return s.sel;
    }

    function readFields() {
        const num = (id) => {
            const v = String(doc.value(id) || '').trim().replace(',', '.');
            return v === '' ? null : Number(v);
        };
        const px = num('f-px'), py = num('f-py');
        return {
            name: String(doc.value('f-name') || '').trim(),
            rect: { x: num('f-x'), y: num('f-y'), w: num('f-w'), h: num('f-h') },
            pivot: px === null && py === null ? null : { x: px === null ? 0 : px, y: py === null ? 0 : py },
            duration: num('f-dur'),
        };
    }

    function applyFromForm() {
        if (s.sel < 0 || !D()) return null;
        const f = readFields();
        if (f.duration === null) delete f.duration;
        return ops.applyFields(s.sel, f);
    }

    // --- Отрисовка интерфейса ---------------------------------------------------------------
    function hudText() {
        const d = D();
        const parts = [];
        if (s.tex) parts.push(s.tex.w + '×' + s.tex.h);
        parts.push('×' + (Math.round(s.view.zoom * 100) / 100));
        parts.push('(' + Math.floor(s.mouse.tx) + ', ' + Math.floor(s.mouse.ty) + ')');
        if (d && s.sel >= 0 && d.frames[s.sel]) parts.push(d.frames[s.sel].name);
        parts.push(s.tool === 'pivot' ? 'пивот: щёлкните по кадру' : 'кадр: тяните мышью');
        return parts.join(' · ');
    }

    function renderTop() {
        const dirty = s.session && s.session.history.dirty();
        doc.text('ss-file', escapeHtml(s.session ? s.session.path : (s.createFor || '—')));
        doc.text('ss-dirty', dirty ? '● есть несохранённые правки' : '');
        const h = s.session ? s.session.history : null;
        doc.cls('ss-undo', 'off', !(h && h.canUndo()));
        doc.cls('ss-redo', 'off', !(h && h.canRedo()));
        doc.cls('ss-tool-select', 'on', s.tool === 'select');
        doc.cls('ss-tool-pivot', 'on', s.tool === 'pivot');
        doc.cls('ss-grid', 'on', s.grid);
        doc.style('ss-create', 'display', s.createFor ? 'block' : 'none');
        doc.style('ss-edit', 'display', s.session ? 'block' : 'none');
    }

    function renderFrames() {
        const d = D();
        if (!d) { doc.html('ss-frames', '<p class="empty">Атласа нет: создайте его сеткой справа.</p>'); return; }
        if (d.frames.length === 0) { doc.html('ss-frames', '<p class="empty">Кадров нет: обведите мышью область на картинке.</p>'); return; }
        let html = '';
        d.frames.forEach((f, i) => {
            const tags = d.tags.filter((t) => i >= t.from && i <= t.to).map((t) => t.name).join(', ');
            html += '<div id="fr-' + i + '" class="row' + (i === s.sel ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + i + ' · ' + escapeHtml(f.name) +
                '</span><span class="row-dir">' + f.w + '×' + f.h + (f.pivot ? ' · пивот' : '') + (tags ? ' · ' + escapeHtml(tags) : '') + '</span></div>';
        });
        doc.html('ss-frames', html);
    }

    function renderFields() {
        const d = D();
        const f = d && s.sel >= 0 ? d.frames[s.sel] : null;
        const set = (id, v) => doc.setValue(id, v === null || v === undefined ? '' : String(v));
        set('f-name', f ? f.name : '');
        set('f-x', f ? f.x : ''); set('f-y', f ? f.y : '');
        set('f-w', f ? f.w : ''); set('f-h', f ? f.h : '');
        set('f-px', f && f.pivot ? f.pivot.x : ''); set('f-py', f && f.pivot ? f.pivot.y : '');
        set('f-dur', f ? f.duration : '');
    }

    function renderMeta() {
        const d = D();
        const keys = d && d.custom && typeof d.custom === 'object' ? Object.keys(d.custom) : [];
        doc.html('ss-meta', keys.length ? keys.map((k) => '<div class="row" data-key="' + escapeHtml(k) + '"><span class="row-name">' +
            escapeHtml(k) + '</span><span class="row-dir">' + escapeHtml(d.custom[k]) + '</span></div>').join('') : '<p class="empty">Метаданных нет.</p>');
    }

    function renderInfo() {
        const d = D();
        doc.text('ss-image-info', escapeHtml(s.tex ? 'Картинка ' + (d ? d.image : s.imageAbs.split('/').pop()) + ' · ' + s.tex.w + '×' + s.tex.h +
            (d ? ' · кадров ' + d.frames.length + ' · тегов ' + d.tags.length : '') : 'картинка не загружена'));
    }

    function renderDiag(list) {
        doc.html('ss-diag', views.diagRows(list || (s.session ? s.session.diagnostics : [])));
    }

    function renderOverlay() {
        const d = D();
        if (!s.tex) { doc.html('ss-overlay', ''); return; }
        const r = layout();
        const z = s.view.zoom;
        const ox = r.x, oy = r.y;
        let html = '';
        if (d) {
            d.frames.forEach((f, i) => {
                const a = M.texToScreen(s.view, f.x, f.y);
                const w = f.w * z, h = f.h * z;
                if (a.x > r.x + r.w || a.y > r.y + r.h || a.x + w < r.x || a.y + h < r.y) return;
                html += '<div class="fr' + (i === s.sel ? ' sel' : '') + '" style="left:' + Math.round(a.x - ox) + 'px;top:' + Math.round(a.y - oy) +
                    'px;width:' + Math.max(1, Math.round(w)) + 'px;height:' + Math.max(1, Math.round(h)) + 'px;">' +
                    (w > 44 && z >= 2 ? '<span class="fr-label">' + escapeHtml(f.name) + '</span>' : '') + '</div>';
                if (f.pivot && i === s.sel || (f.pivot && z >= 4)) {
                    const p = M.texToScreen(s.view, f.x + f.pivot.x, f.y + f.pivot.y);
                    html += '<div class="pivot" style="left:' + Math.round(p.x - ox - 5) + 'px;top:' + Math.round(p.y - oy - 5) + 'px;"></div>';
                }
            });
        }
        if (s.press && s.press.dragging) {
            const rect = dragRect();
            const a = M.texToScreen(s.view, rect.x, rect.y);
            html += '<div class="drag" style="left:' + Math.round(a.x - ox) + 'px;top:' + Math.round(a.y - oy) + 'px;width:' +
                Math.max(1, Math.round(rect.w * z)) + 'px;height:' + Math.max(1, Math.round(rect.h * z)) + 'px;"></div>';
        }
        doc.html('ss-overlay', html);
    }

    function renderAll() {
        // Выделение не должно переживать кадр, которого больше нет (после undo).
        const frames = D() ? D().frames.length : 0;
        if (s.sel >= frames) s.sel = frames - 1;
        renderTop();
        renderFrames();
        renderFields();
        renderMeta();
        renderInfo();
        renderDiag();
        renderOverlay();
        doc.text('ss-hud', escapeHtml(hudText()));
    }

    // --- Мышь (опрос через публичный $.input) -----------------------------------------------------
    function dragRect() {
        const p = s.press;
        return M.clampRect(M.rectFromPoints(p.tx, p.ty, s.mouse.tx, s.mouse.ty), s.tex.w, s.tex.h);
    }

    function pointer() {
        if (!s.active || !s.tex) return;
        const r = layout();
        const m = $.input.mouse();
        const inside = m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;
        const t = M.screenToTex(s.view, m.x, m.y);
        const moved = m.x !== s.mouse.x || m.y !== s.mouse.y;
        s.mouse = { x: m.x, y: m.y, tx: t.x, ty: t.y };

        const wheel = $.input.wheel().y;
        if (inside && wheel !== 0) { stepZoom(wheel > 0 ? 1 : -1, { x: m.x, y: m.y }); renderOverlay(); }

        // Панорама: правая или средняя кнопка.
        const panning = inside && ($.input.mouseDown('right') || $.input.mouseDown('middle'));
        if (panning) {
            const dlt = $.input.mouseDelta();
            if (dlt.x || dlt.y) {
                s.view.px -= dlt.x / s.view.zoom;
                s.view.py -= dlt.y / s.view.zoom;
                s.dirtyView = true;
            }
        }

        if (inside && $.input.mousePressed('left')) {
            s.press = { sx: m.x, sy: m.y, tx: t.x, ty: t.y, dragging: false };
        }
        if (s.press) {
            if (!s.press.dragging && Math.hypot(m.x - s.press.sx, m.y - s.press.sy) > 4) s.press.dragging = s.tool === 'select';
            if (s.press.dragging && moved) renderOverlay();
            if (!$.input.mouseDown('left')) {
                const press = s.press;
                s.press = null;
                if (press.dragging) {
                    const rect = M.clampRect(M.rectFromPoints(press.tx, press.ty, s.mouse.tx, s.mouse.ty), s.tex.w, s.tex.h);
                    if (rect.w >= 1 && rect.h >= 1 && D()) ops.addFrame(rect);
                    else renderOverlay();
                } else if (D()) {
                    clickAt(press.tx, press.ty);
                }
            }
        }
        if (moved || s.dirtyView) {
            if (s.dirtyView) { renderOverlay(); s.dirtyView = false; }
            doc.text('ss-hud', escapeHtml(hudText()));
        }
    }

    /** Щелчок без перетаскивания: выбрать кадр или (в режиме пивота) поставить пивот. */
    function clickAt(tx, ty) {
        const d = D();
        if (s.tool === 'pivot' && s.sel >= 0) {
            const f = d.frames[s.sel];
            const lx = Math.round((tx - f.x) * 2) / 2;
            const ly = Math.round((ty - f.y) * 2) / 2;
            ops.setPivot(s.sel, { x: lx, y: ly });
            return;
        }
        select(M.frameAt(d, tx, ty));
    }

    // --- Кадр: картинка — узел рантайма, сетка пикселей — $.gfx.draw -----------------------------------------
    function drawFrame() {
        if (!s.active) return;
        if (s.needFit && s.tex) {
            const r = slotRect();
            if (r.w > 0) { fit(); s.needFit = false; renderAll(); }
        }
        if (!s.tex) return;
        syncNode();
        const z = s.view.zoom;
        if (s.grid && z >= 8) {
            const r = slotRect();
            const x0 = Math.max(0, Math.floor(M.screenToTex(s.view, r.x, r.y).x));
            const x1 = Math.min(s.tex.w, Math.ceil(M.screenToTex(s.view, r.x + r.w, r.y).x));
            const y0 = Math.max(0, Math.floor(M.screenToTex(s.view, r.x, r.y).y));
            const y1 = Math.min(s.tex.h, Math.ceil(M.screenToTex(s.view, r.x, r.y + r.h).y));
            const top = Math.max(r.y, M.texToScreen(s.view, 0, y0).y);
            const bottom = Math.min(r.y + r.h, M.texToScreen(s.view, 0, y1).y);
            const left = Math.max(r.x, M.texToScreen(s.view, x0, 0).x);
            const right = Math.min(r.x + r.w, M.texToScreen(s.view, x1, 0).x);
            for (let x = x0; x <= x1; x++) {
                const sx = M.texToScreen(s.view, x, 0).x;
                $.gfx.draw.line(sx, top, sx, bottom, 'rgba(255,255,255,0.16)', 1);
            }
            for (let y = y0; y <= y1; y++) {
                const sy = M.texToScreen(s.view, 0, y).y;
                $.gfx.draw.line(left, sy, right, sy, 'rgba(255,255,255,0.16)', 1);
            }
        }
    }

    function keys() {
        if (!s.active || !D()) return;
        const mod = $.input.ctrlDown();
        if (mod && $.input.pressed('z')) {
            if ($.input.shiftDown()) ops.redo();
            else ops.undo();
        } else if (mod && $.input.pressed('y')) {
            ops.redo();
        } else if (mod && $.input.pressed('s')) {
            save();
        }
        // Alt+стрелки двигают кадр: просто стрелки принадлежат полям ввода.
        if (s.sel >= 0 && $.input.altDown()) {
            const step = $.input.shiftDown() ? 8 : 1;
            const f = D().frames[s.sel];
            let dx = 0, dy = 0;
            if ($.input.pressed('left')) dx = -step;
            if ($.input.pressed('right')) dx = step;
            if ($.input.pressed('up')) dy = -step;
            if ($.input.pressed('down')) dy = step;
            if (dx || dy) ops.setRect(s.sel, { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h });
        }
    }

    // --- Подписки интерфейса -------------------------------------------------------------------------------
    function wire() {
        if (wired) return;
        wired = true;
        doc.on('ss-back', 'click', () => close());
        doc.on('ss-save', 'click', () => save());
        doc.on('ss-undo', 'click', () => ops.undo());
        doc.on('ss-redo', 'click', () => ops.redo());
        doc.on('ss-validate', 'click', () => validate());
        doc.on('ss-tool-select', 'click', () => setTool('select'));
        doc.on('ss-tool-pivot', 'click', () => setTool('pivot'));
        doc.on('ss-zoom-in', 'click', () => { stepZoom(1); renderOverlay(); });
        doc.on('ss-zoom-out', 'click', () => { stepZoom(-1); renderOverlay(); });
        doc.on('ss-fit', 'click', () => { fit(); renderOverlay(); });
        doc.on('ss-grid', 'click', () => { s.grid = !s.grid; renderTop(); });
        doc.on('ss-to-anim', 'click', () => toAnimation());
        doc.on('ss-frames', 'click', (id, ev, key) => { if (key !== '') select(parseInt(key, 10)); });
        doc.on('ss-apply', 'click', () => applyFromForm());
        doc.on('ss-pivot-clear', 'click', () => { if (s.sel >= 0) ops.setPivot(s.sel, null); });
        doc.on('ss-delete', 'click', () => { if (s.sel >= 0) ops.removeFrame(s.sel); });
        doc.on('ss-make-atlas', 'click', () => makeAtlas());
        doc.on('ss-meta', 'click', (id, ev, key) => {
            if (key === '') return;
            doc.setValue('m-key', key);
            doc.setValue('m-val', D() && D().custom ? D().custom[key] : '');
        });
        doc.on('ss-meta-set', 'click', () => ops.setCustom(doc.value('m-key'), doc.value('m-val')));
    }

    function setTool(tool) {
        s.tool = tool === 'pivot' ? 'pivot' : 'select';
        renderTop();
        doc.text('ss-hud', escapeHtml(hudText()));
        return s.tool;
    }

    async function toAnimation() {
        if (!s.session) { note('warning', 'SDK_NO_ATLAS', 'Сначала создайте атлас'); return null; }
        doc.hide();
        s.active = false;
        return app.openTool('animation-studio', { assetAbs: s.session.path });
    }

    // Возврат из Animation Studio: студия снова показывает свой документ.
    function resume() {
        if (s.session) { show(); }
    }

    // --- Публичный объект (агент и тесты вызывают то же, что кнопки) --------------------------------------------
    const api = {
        state: s,
        ops,
        openAsset, close, save, validate, makeAtlas,
        select, setTool, setZoom, stepZoom, fit, toAnimation, resume,
        applyFromForm,
        clickAt,
        get session() { return s.session; },
        snapshot() {
            const d = D();
            return {
                active: s.active,
                file: s.session ? s.session.path : null,
                createFor: s.createFor,
                frames: d ? d.frames.length : 0,
                tags: d ? d.tags.length : 0,
                selected: s.sel,
                tool: s.tool,
                zoom: s.view.zoom,
                dirty: s.session ? s.session.history.dirty() : false,
                canUndo: s.session ? s.session.history.canUndo() : false,
                canRedo: s.session ? s.session.history.canRedo() : false,
                size: s.tex,
            };
        },
        layout, renderAll,
    };

    app.studios = app.studios || {};
    app.studios.sprite = api;
    $.update(() => { pointer(); keys(); drawFrame(); });
    return api;
}
