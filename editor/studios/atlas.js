// ===========================================================================
// Atlas Studio — *.atlas.json (Aseprite-совместимый формат, который читает
// $.atlas). Два режима одной вкладки и одной истории:
//
//   Sprite     кадры: выбор, рисование, перенос, пивот, длительность, нарезка
//   Animation  теги: диапазон, direction, loop, длительность; проигрывание
//              настоящим путём игры ($.atlas → .frames().animate())
//
// Формат и канонический вывод — sdk/lib/atlas_model.js (сверен байт-в-байт с
// C `atlas-format`), нарезка — нативная `r2d atlas-grid`, проверка — `r2d
// validate`. Картинка — обычный узел <sprite> (nearest, как в игре), рамки и
// пивоты — элементы RmlUi поверх прозрачного холста.
// ===========================================================================

import * as M from '../lib/shared/atlas_model.js';
import { createHistory } from '../lib/shared/history.js';
import { esc, studioDoc, uiScale, mousePx, inside, screenCamera, diag, keys, numberOf, row } from '../lib/studio_kit.js';

export const meta = {
    id: 'atlas',
    title: 'Атлас',
    icon: 'grid_view',
    match: (p) => /\.atlas\.json$/i.test(p),
    // PNG без атласа — режим «создать атлас сеткой».
    also: (p) => /\.(png|jpe?g|webp)$/i.test(p),
};

const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const SPEEDS = [0.25, 0.5, 1, 2];
const DIRS = ['forward', 'reverse', 'pingpong'];
let sheetCounter = 0;

const dirOf = (p) => String(p).replace(/\/[^/]*$/, '');
function resolve(base, rel) {
    if (!rel) return '';
    if (/^([A-Za-z]:[\\/]|\/)/.test(rel)) return rel;
    const out = [];
    for (const part of (dirOf(base) + '/' + rel).split('/')) {
        if (part === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop();
        else if (part !== '.') out.push(part);
    }
    return out.join('/');
}

export function create(host) {
    const $ = host.$;
    const doc = studioDoc($, 'atlas');
    const key = keys($, host);
    const s = {
        path: '', imageAbs: '', tex: null, model: null, history: null,
        create: null,                  // PNG без атласа: { imageAbs }
        busy: false, closed: false,
        mode: 'sprite', tool: 'select', grid: true,
        sel: -1, tag: -1,
        view: { cx: 0, cy: 0, px: 0, py: 0, zoom: 1 }, needFit: true,
        press: null, pan: null,
        node: null, anim: null, sheetName: null, speed: 2, playing: true,
        diags: [], status: '', error: '', conflict: null,
        draftId: ++sheetCounter,
    };

    // --- файл -----------------------------------------------------------------

    function measure() {
        s.imageAbs = resolve(s.path, s.model.image);
        const size = s.imageAbs ? $.gfx.textureSize(s.imageAbs) : null;
        s.tex = size && size[0] > 0 ? { w: size[0], h: size[1] } : null;
        if (s.tex && (!s.model.size || s.model.size.w !== s.tex.w || s.model.size.h !== s.tex.h)) s.model.size = { w: s.tex.w, h: s.tex.h };
    }

    async function open(abs) {
        s.error = '';
        s.conflict = null;
        if (/\.(png|jpe?g|webp)$/i.test(abs)) {
            const sibling = abs.replace(/\.[^./]+$/, '.atlas.json');
            if ($.fs.exists(sibling)) return open(sibling);
            s.create = { imageAbs: abs };
            s.path = sibling;
            const size = $.gfx.textureSize(abs);
            s.tex = size && size[0] > 0 ? { w: size[0], h: size[1] } : null;
            s.imageAbs = abs;
            s.model = M.newAtlasDoc(abs.split('/').pop(), s.tex);
            s.history = createHistory(s.model);
            note('PNG без атласа: задайте сетку справа и нажмите «Нарезать»');
            renderAll();
            return;
        }
        const json = $.fs.readJSON(abs, null);
        if (!json) throw new Error('не удалось прочитать ' + abs + ' (нет файла или некорректный JSON)');
        s.path = abs;
        s.source = $.fs.readText(abs);
        s.create = null;
        s.model = M.parseAtlasDoc(json);
        s.history = createHistory(s.model);
        measure();
        s.history.markSaved();           // размер картинки дописан — это не правка автора
        s.sel = s.model.frames.length ? 0 : -1;
        s.tag = s.model.tags.length ? 0 : -1;
        s.needFit = true;
        if (!s.tex) s.error = 'картинка атласа не найдена: ' + (s.model.image || '(meta.image пуст)');
        renderAll();
    }

    function edit(label, fn) {
        if (s.busy || s.closed) return undefined;
        try {
            const r = s.history.run(label, fn);
            s.error = '';
            afterEdit(label);
            return r;
        } catch (e) {
            s.error = e.message || String(e);
            renderTop();
            return undefined;
        }
    }

    function afterEdit(label) {
        if (label) note(label);
        if (s.sel >= s.model.frames.length) s.sel = s.model.frames.length - 1;
        if (s.tag >= s.model.tags.length) s.tag = s.model.tags.length - 1;
        if (s.mode === 'animation') restartPreview();
        renderAll();
        host.changed();
    }

    async function save(options) {
        options = options || {};
        if (!s.model || s.create || s.busy || s.closed) return false;
        // Нетронутый файл не переписываем: канонический вывод мог бы изменить
        // форматирование чужого файла без единой правки автора.
        if (!s.history.dirty()) { note('изменений нет'); return true; }
        s.busy = true;
        try {
            const disk = $.fs.readText(s.path);
            const expected = options.overwrite ? options.expectedDisk : s.source;
            if (disk !== expected) return setConflict(disk, 'Файл изменён извне: выберите версию для ' + s.path);
            if (!await validate(true, true) || s.closed) return false;
            const current = $.fs.readText(s.path);
            if (current !== expected) return setConflict(current, 'Файл снова изменён извне: проверьте новую версию ' + s.path);
            const text = M.serializeAtlas(s.model);
            if ($.fs.write(s.path, text) === false) { s.diags = [diag('SDK_WRITE_FAILED', 'error', 'не удалось записать ' + s.path, { asset: s.path })]; host.changed(); return false; }
            s.source = text;
            s.conflict = null;
            s.history.markSaved();
            note('сохранено');
            host.changed();
            return true;
        } finally { s.busy = false; }
    }

    function setConflict(disk, message) {
        s.conflict = { disk: typeof disk === 'string' ? disk : null };
        s.diags = [diag('EDITOR_WRITE_CONFLICT', 'error', message, { asset: s.path })];
        renderAll(); host.changed(); return false;
    }

    function resolveConflict(choice) {
        if (!s.conflict || s.closed || s.busy) return false;
        if (choice === 'cancel') { s.conflict = null; s.diags = s.diags.filter((d) => d.code !== 'EDITOR_WRITE_CONFLICT'); renderAll(); host.changed(); return true; }
        const conflict = s.conflict;
        if (choice === 'reload') {
            const current = $.fs.readText(s.path);
            if (current !== conflict.disk) return setConflict(current, 'Файл снова изменён извне: проверьте новую версию ' + s.path);
            if (typeof conflict.disk !== 'string') { s.error = 'Файл удалён извне; перезапись подтвердит его создание заново'; renderTop(); return false; }
            let model;
            try { model = M.parseAtlasDoc(JSON.parse(conflict.disk)); } catch (e) { s.error = 'Внешний файл нельзя открыть как атлас: ' + (e.message || String(e)); renderTop(); return false; }
            s.source = conflict.disk; s.model = model; s.conflict = null;
            measure(); s.history = createHistory(s.model); s.history.markSaved();
            s.sel = s.model.frames.length ? 0 : -1; s.tag = s.model.tags.length ? 0 : -1; s.needFit = true;
            if (s.mode === 'animation') restartPreview();
            s.diags = []; s.error = ''; renderAll(); host.changed(); return true;
        }
        if (choice === 'overwrite') {
            if ($.fs.readText(s.path) !== conflict.disk) return setConflict($.fs.readText(s.path), 'Файл снова изменён извне: проверьте новую версию ' + s.path);
            return save({ overwrite: true, expectedDisk: conflict.disk });
        }
        return false;
    }

    // Проверка: сохранённый файл — им самим; несохранённое состояние — черновиком рядом.
    async function validate(draft, fromSave) {
        if (s.closed || (s.busy && !fromSave)) return false;
        const ownsLock = !fromSave;
        if (ownsLock) s.busy = true;
        let target = s.path;
        try {
            if (draft && s.history.dirty()) {
                target = dirOf(s.path) + '/.r2d-draft-' + s.draftId + '.atlas.json';
                if ($.fs.write(target, M.serializeAtlas(s.model)) === false) return false;
            }
            const r = await host.backend(['validate', target]);
            if (s.closed) return false;
            s.diags = ((r.json && r.json.diagnostics) || []).map((d) => Object.assign({}, d, { asset: d.asset === target ? s.path : d.asset }));
            note(s.diags.length ? 'проверка: сообщений ' + s.diags.length : 'проверка: ошибок нет');
            host.changed();
            renderRight();
            return !!(r.json && r.json.ok);
        } catch (e) {
            if (!s.closed) { s.diags = [diag('EDITOR_ATLAS_VALIDATE', 'error', e.message || String(e), { asset: s.path })]; host.changed(); renderRight(); }
            return false;
        } finally { if (target !== s.path) $.fs.remove(target); if (ownsLock) s.busy = false; }
    }

    // Нарезка сеткой — нативная atlas-grid во временный файл, затем одна правка
    // (undo вернёт прежние кадры). Для PNG без атласа — создаёт файл атласа.
    async function slice() {
        if (s.busy || s.closed) return false;
        s.busy = true;
        let cleanup = '';
        try {
        const p = s.create ? 'at-c-' : 'at-g-';
        const cols = numberOf(doc, p + 'cols'), rows = numberOf(doc, p + 'rows');
        const cw = s.create ? null : numberOf(doc, 'at-g-cw'), ch = s.create ? null : numberOf(doc, 'at-g-ch');
        const dur = numberOf(doc, 'at-g-dur') || 100;
        const prefix = String(doc.value('at-g-prefix') || '').trim() || (s.imageAbs.split('/').pop().replace(/\.[^.]+$/, ''));
        const out = s.create ? s.path : dirOf(s.path) + '/.r2d-draft-grid-' + s.draftId + '.atlas.json';
        cleanup = out;
        const args = ['atlas-grid', s.imageAbs, '--out', out, '--prefix', prefix, '--duration', String(dur)];
        if (cw && ch) args.push('--cell', cw + 'x' + ch);
        else if (cols && rows) args.push('--cols', String(cols), '--rows', String(rows));
        else { s.error = 'нарезка: задайте колонки и строки либо размер ячейки'; renderTop(); return; }
        const r = await host.backend(args);
        if (s.closed) return false;
        if (!r.json || !r.json.ok) {
            s.error = 'нарезка: ' + (((r.json && r.json.diagnostics) || []).map((d) => d.message).join('; ') || 'backend не ответил');
            renderTop();
            return;
        }
        if (s.create) { await open(s.path); cleanup = ''; host.changed(); return true; }
        const grid = M.parseAtlasDoc($.fs.readJSON(out, null));
        cleanup = '';
        $.fs.remove(out);
        s.busy = false;
        edit('нарезка сеткой: ' + grid.frames.length + ' кадров', (d) => { d.frames = grid.frames; d.tags = []; d.slices = []; });
        s.sel = s.model.frames.length ? 0 : -1;
        s.needFit = true;
        return true;
        } finally { if (cleanup) $.fs.remove(cleanup); s.busy = false; }
    }

    // --- вид --------------------------------------------------------------------

    function canvas() { return doc.rect('at-canvas') || { x: 0, y: 0, w: 0, h: 0 }; }

    function fit() {
        const r = canvas();
        if (!s.tex || r.w <= 0) return;
        s.view.cx = r.x + r.w / 2; s.view.cy = r.y + r.h / 2;
        s.view.zoom = M.fitZoom(s.tex.w, s.tex.h, Math.max(1, r.w - 40), Math.max(1, r.h - 40));
        s.view.px = s.tex.w / 2; s.view.py = s.tex.h / 2;
        s.needFit = false;
    }

    function zoomBy(dir, anchor) {
        const i = ZOOMS.findIndex((z) => z >= s.view.zoom - 1e-6);
        const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
        if (anchor) {
            const t = M.screenToTex(s.view, anchor.x, anchor.y);
            s.view.zoom = next;
            s.view.px = t.x - (anchor.x - s.view.cx) / next;
            s.view.py = t.y - (anchor.y - s.view.cy) / next;
        } else s.view.zoom = next;
    }

    function ensureNode() {
        if (s.node && s.node.attr('src') === s.imageAbs) return;
        if (s.node) s.node.remove();
        s.node = s.imageAbs && s.tex ? $('<sprite>', { id: 'editor-atlas-' + host.id, src: s.imageAbs }).appendTo($.world) : null;
    }

    function drawSprite() {
        ensureNode();
        if (!s.node) return;
        const k = uiScale($), r = canvas();
        s.view.cx = r.x + r.w / 2; s.view.cy = r.y + r.h / 2;
        const c = M.texToScreen(s.view, s.tex.w / 2, s.tex.h / 2);
        s.node.visible(s.mode === 'sprite').at(c.x / k, c.y / k).size(s.tex.w * s.view.zoom / k, s.tex.h * s.view.zoom / k);
        // Сетка пикселей при крупном масштабе — линии кадра, обрезанные холстом.
        if (s.grid && s.mode === 'sprite' && s.view.zoom >= 8) {
            const a = M.texToScreen(s.view, 0, 0), b = M.texToScreen(s.view, s.tex.w, s.tex.h);
            const x0 = Math.max(r.x, a.x), x1 = Math.min(r.x + r.w, b.x), y0 = Math.max(r.y, a.y), y1 = Math.min(r.y + r.h, b.y);
            const t0 = M.screenToTex(s.view, x0, y0), t1 = M.screenToTex(s.view, x1, y1);
            for (let x = Math.ceil(t0.x); x <= t1.x; x++) { const sx = M.texToScreen(s.view, x, 0).x / k; $.gfx.draw.line(sx, y0 / k, sx, y1 / k, 'rgba(255,255,255,0.12)', 1); }
            for (let y = Math.ceil(t0.y); y <= t1.y; y++) { const sy = M.texToScreen(s.view, 0, y).y / k; $.gfx.draw.line(x0 / k, sy, x1 / k, sy, 'rgba(255,255,255,0.12)', 1); }
        }
    }

    function renderOverlay() {
        if (s.mode !== 'sprite' || !s.tex) { doc.html('at-overlay', ''); return; }
        const r = canvas(), z = s.view.zoom;
        let html = '';
        s.model.frames.forEach((f, i) => {
            const a = M.texToScreen(s.view, f.x, f.y), w = f.w * z, h = f.h * z;
            if (a.x > r.x + r.w || a.y > r.y + r.h || a.x + w < r.x || a.y + h < r.y) return;
            html += '<div class="at-fr' + (i === s.sel ? ' sel' : '') + '" style="left: ' + Math.round(a.x - r.x) + 'px; top: ' + Math.round(a.y - r.y) +
                'px; width: ' + Math.max(1, Math.round(w)) + 'px; height: ' + Math.max(1, Math.round(h)) + 'px;">' +
                (w > 48 && h > 18 ? '<span class="at-fr-n">' + i + '</span>' : '') + '</div>';
            if (f.pivot && (i === s.sel || z >= 4)) {
                const p = M.texToScreen(s.view, f.x + f.pivot.x, f.y + f.pivot.y);
                html += '<div class="at-pivot' + (i === s.sel ? ' sel' : '') + '" style="left: ' + Math.round(p.x - r.x - 5) + 'px; top: ' + Math.round(p.y - r.y - 5) + 'px;"></div>';
            }
        });
        if (s.press && s.press.kind === 'draw' && s.press.moved) {
            const t = M.screenToTex(s.view, s.press.x1, s.press.y1);
            const rect = M.clampRect(M.rectFromPoints(s.press.tx0, s.press.ty0, t.x, t.y), s.tex.w, s.tex.h);
            const a = M.texToScreen(s.view, rect.x, rect.y);
            html += '<div class="at-drag" style="left: ' + Math.round(a.x - r.x) + 'px; top: ' + Math.round(a.y - r.y) + 'px; width: ' +
                Math.max(1, Math.round(rect.w * z)) + 'px; height: ' + Math.max(1, Math.round(rect.h * z)) + 'px;"></div>';
        }
        doc.html('at-overlay', html);
    }

    // --- превью анимации (путь игры) ----------------------------------------------

    function stopPreview() {
        if (s.anim) { s.anim.remove(); s.anim = null; }
        if (s.sheetName) { $.atlas.unload(s.sheetName); s.sheetName = null; }
    }

    function restartPreview() {
        stopPreview();
        const tag = s.model.tags[s.tag];
        if (!tag || !s.tex) return;
        // Тот же текст, что запишет «Сохранить», разбирает настоящий $.atlas.
        s.sheetName = 'editor-atlas-preview-' + (++sheetCounter);
        const sheet = $.atlas.load(s.sheetName, { data: JSON.parse(M.serializeAtlas(s.model)), path: s.path });
        const sprites = sheet ? sheet.tagSprites(tag.name) : [];
        const play = M.tagPlayback(s.model, tag.name);
        if (!sprites.length || !play) return;
        s.anim = $('<sprite>', { id: 'editor-atlas-anim-' + host.id }).appendTo($.world);
        s.anim.frames(sprites).frame(0).animate({ from: 0, to: sprites.length - 1, speed: play.fps * SPEEDS[s.speed], loop: play.loop });
        if (!s.playing) s.anim.playing(false);
        s.animFrames = play.frames;
    }

    function drawAnim() {
        if (!s.anim) return;
        const r = canvas(), k = uiScale($), tag = s.model.tags[s.tag];
        const f = s.model.frames[tag ? tag.from : 0] || { w: 32, h: 32 };
        const z = M.fitZoom(f.w, f.h, Math.max(1, r.w - 60), Math.max(1, r.h - 60));
        s.anim.at((r.x + r.w / 2) / k, (r.y + r.h / 2) / k).size(f.w * z / k, f.h * z / k);
        const idx = s.anim.get(0).frame_index | 0;
        if (idx !== s.animIdx) { s.animIdx = idx; renderStrip(); }
    }

    // --- ввод -------------------------------------------------------------------

    function canvasDown() {
        if (s.mode !== 'sprite' || !s.tex) return;
        const p = mousePx($), t = M.screenToTex(s.view, p.x, p.y);
        if (s.tool === 'pivot') {
            if (s.sel >= 0) {
                const f = s.model.frames[s.sel];
                edit('пивот кадра ' + f.name, (d) => M.setPivot(d, s.sel, { x: Math.round(t.x - f.x), y: Math.round(t.y - f.y) }));
            }
            return;
        }
        const hit = M.frameAt(s.model, t.x, t.y);
        if (hit >= 0 && hit === s.sel) {
            const f = s.model.frames[hit];
            s.press = { kind: 'move', tx0: t.x, ty0: t.y, fx: f.x, fy: f.y, moved: false, x1: p.x, y1: p.y };
        } else if (hit >= 0) {
            select(hit);
        } else {
            s.press = { kind: 'draw', tx0: t.x, ty0: t.y, moved: false, x1: p.x, y1: p.y };
        }
    }

    function tickPress() {
        if (!s.press) return;
        const p = mousePx($);
        if ($.input.mouseDown('left')) {
            if (Math.abs(p.x - s.press.x1) + Math.abs(p.y - s.press.y1) > 2) s.press.moved = true;
            s.press.x1 = p.x; s.press.y1 = p.y;
            if (s.press.kind === 'move' && s.press.moved) {
                // Перенос — превью без истории; в историю — один шаг на отпускании.
                const t = M.screenToTex(s.view, p.x, p.y), f = s.model.frames[s.sel];
                f.x = Math.max(0, Math.min(s.tex.w - f.w, Math.round(s.press.fx + t.x - s.press.tx0)));
                f.y = Math.max(0, Math.min(s.tex.h - f.h, Math.round(s.press.fy + t.y - s.press.ty0)));
                renderRight();
            }
            return;
        }
        const press = s.press;
        s.press = null;
        if (press.kind === 'move' && press.moved) {
            const f = s.model.frames[s.sel], to = { x: f.x, y: f.y, w: f.w, h: f.h };
            f.x = press.fx; f.y = press.fy;
            edit('перенос кадра ' + f.name, (d) => M.setRect(d, s.sel, to));
        } else if (press.kind === 'draw' && press.moved) {
            const t = M.screenToTex(s.view, press.x1, press.y1);
            const rect = M.clampRect(M.rectFromPoints(press.tx0, press.ty0, t.x, t.y), s.tex.w, s.tex.h);
            if (rect.w >= 1 && rect.h >= 1) {
                const i = edit('новый кадр', (d) => M.addFrame(d, rect));
                if (i !== undefined) select(i);
            }
        } else if (press.kind === 'draw') select(-1);
    }

    function tickPanZoom() {
        const p = mousePx($), r = canvas();
        if (!s.pan && inside(p, r) && ($.input.mousePressed('right') || $.input.mousePressed('middle'))) s.pan = { x: p.x, y: p.y };
        if (s.pan) {
            if ($.input.mouseDown('right') || $.input.mouseDown('middle')) {
                s.view.px -= (p.x - s.pan.x) / s.view.zoom; s.view.py -= (p.y - s.pan.y) / s.view.zoom;
                s.pan = { x: p.x, y: p.y };
            } else s.pan = null;
        }
        const w = $.input.wheel();
        if (w && w.y && inside(p, r) && s.mode === 'sprite') zoomBy(w.y > 0 ? 1 : -1, p);
    }

    function tickKeys() {
        if (key.pressed('tab')) setMode(s.mode === 'sprite' ? 'animation' : 'sprite');
        if (s.mode !== 'sprite') { if (key.pressed('space')) setPlaying(!s.playing); return; }
        if (key.pressed('f')) fit();
        if (key.pressed('g')) { s.grid = !s.grid; renderTop(); }
        if (key.pressed('p')) setTool(s.tool === 'pivot' ? 'select' : 'pivot');
        if (s.sel < 0) return;
        if (key.pressed('delete') || key.pressed('backspace')) { const n = s.model.frames[s.sel].name; edit('удалён кадр ' + n, (d) => M.removeFrame(d, s.sel)); return; }
        const step = key.shift() ? 8 : 1;
        let dx = 0, dy = 0;
        if (key.pressed('left')) dx = -step; if (key.pressed('right')) dx = step;
        if (key.pressed('up')) dy = -step; if (key.pressed('down')) dy = step;
        if (dx || dy) {
            const f = s.model.frames[s.sel];
            edit('сдвиг кадра ' + f.name, (d) => M.setRect(d, s.sel, { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h }));
        }
    }

    // --- операции -----------------------------------------------------------------

    function select(i) { s.sel = i; renderLeft(); renderRight(); renderOverlay(); }
    function selectTag(i) { s.tag = i; if (s.mode === 'animation') restartPreview(); renderAll(); }
    function setTool(t) { s.tool = t; renderTop(); }
    function setMode(mode) {
        s.mode = mode;
        if (s.node) s.node.visible(mode === 'sprite');
        if (mode === 'animation') { if (s.tag < 0 && s.model.tags.length) s.tag = 0; restartPreview(); } else stopPreview();
        renderAll();
    }
    function setPlaying(on) { s.playing = !!on; if (s.anim) s.anim.playing(s.playing); renderStrip(); }
    function step(dir) {
        if (!s.anim || !s.animFrames) return;
        setPlaying(false);
        const n = s.animFrames.length, idx = ((s.anim.get(0).frame_index | 0) + dir + n) % n;
        s.anim.frame(idx);
        renderStrip();
    }
    function setSpeed(i) {
        s.speed = Math.max(0, Math.min(SPEEDS.length - 1, i));
        if (s.mode === 'animation') restartPreview();
        renderStrip();
    }

    function applyFrame() {
        const i = s.sel;
        if (i < 0) return;
        const name = String(doc.value('at-f-name') || '').trim();
        const r = { x: numberOf(doc, 'at-f-x'), y: numberOf(doc, 'at-f-y'), w: numberOf(doc, 'at-f-w'), h: numberOf(doc, 'at-f-h') };
        const px = numberOf(doc, 'at-f-px'), py = numberOf(doc, 'at-f-py'), dur = numberOf(doc, 'at-f-dur');
        edit('кадр ' + name, (d) => {
            if (name !== d.frames[i].name) M.renameFrame(d, i, name);
            M.setRect(d, i, r);
            M.setPivot(d, i, px === null && py === null ? null : { x: px || 0, y: py || 0 });
            M.setDuration(d, i, dur);
        });
    }

    function applyTag() {
        const i = s.tag;
        const patch = {
            name: String(doc.value('at-t-name') || '').trim(),
            from: numberOf(doc, 'at-t-from'), to: numberOf(doc, 'at-t-to'),
            direction: String(doc.value('at-t-dir') || 'forward'),
            loop: String(doc.value('at-t-loop') || 'loop') === 'loop',
        };
        const dur = numberOf(doc, 'at-t-dur');
        if (i < 0) {
            const n = edit('новый тег ' + patch.name, (d) => M.addTag(d, patch));
            if (n !== undefined) s.tag = n;
        } else {
            edit('тег ' + patch.name, (d) => { M.updateTag(d, i, patch); if (dur !== null) M.setTagDuration(d, i, dur); });
        }
        if (s.mode === 'animation') restartPreview();
    }

    function newTag() {
        const from = Math.max(0, s.sel), to = from;
        const base = 'anim';
        let n = 1;
        while (s.model.tags.some((t) => t.name === base + n)) n++;
        const i = edit('новый тег', (d) => M.addTag(d, { name: base + n, from, to }));
        if (i !== undefined) selectTag(i);
    }

    function applyCustom() {
        const k = String(doc.value('at-m-key') || '').trim(), v = String(doc.value('at-m-val') || '');
        edit('метаданные ' + k, (d) => M.setCustom(d, k, v));
    }

    // --- отрисовка ------------------------------------------------------------------

    function note(text) { s.status = text; renderTop(); }

    function renderTop() {
        doc.cls('at-mode-sprite', 'on', s.mode === 'sprite');
        doc.cls('at-mode-anim', 'on', s.mode === 'animation');
        doc.cls('at-tool-select', 'on', s.tool === 'select');
        doc.cls('at-tool-pivot', 'on', s.tool === 'pivot');
        doc.cls('at-grid', 'on', s.grid);
        doc.cls('at-sprite-tools', 'st-hidden', s.mode !== 'sprite');
        doc.text('at-zoom', '×' + (s.view.zoom >= 1 ? s.view.zoom : s.view.zoom.toFixed(3).replace(/0+$/, '')));
        doc.text('at-status', esc(s.error || s.status || ''));
        doc.cls('at-status', 'err', !!s.error);
        doc.cls('at-status', 'ok', !s.error);
        doc.text('at-dirty', s.history && s.history.dirty() ? 'не сохранено' : '');
        doc.text('at-hud', esc(s.mode === 'sprite'
            ? (s.tex ? s.tex.w + '×' + s.tex.h + ' · ЛКМ по пустому — новый кадр, по выбранному — перенос · ПКМ/СКМ — панорама · колесо — масштаб · стрелки — сдвиг (Shift ×8) · Del — удалить · P — пивот · F — вписать · Tab — анимация'
                : 'картинка атласа не найдена')
            : 'Space — пауза · Tab — кадры'));
    }

    function renderLeft() {
        const d = s.model;
        doc.html('at-frames', d.frames.length ? d.frames.map((f, i) => row(i, '<span class="at-idx">' + i + '</span>' + esc(f.name) +
            '<span class="st-sub">' + f.w + '×' + f.h + (f.duration ? ' · ' + f.duration + 'мс' : '') + (f.pivot ? ' · ◦' : '') + '</span>', i === s.sel ? 'sel' : '')).join('')
            : '<span class="st-empty">Кадров нет: протяните мышью по картинке или нарежьте сеткой.</span>');
        const directionName = (direction) => direction === 'forward' ? 'вперёд' : direction === 'reverse' ? 'назад' : direction === 'pingpong' ? 'туда и обратно' : direction;
        doc.html('at-tags', d.tags.length ? d.tags.map((t, i) => row(i, esc(t.name) + '<span class="st-sub">' + t.from + '–' + t.to + ' · ' + directionName(t.direction) + (t.loop === false ? ' · один раз' : '') + '</span>', i === s.tag ? 'sel' : '')).join('')
            : '<span class="st-empty">Тегов нет.</span>');
        doc.text('at-count', d.frames.length + ' кадров · ' + d.tags.length + ' тегов');
    }

    function renderRight() {
        const d = s.model, f = d.frames[s.sel];
        doc.cls('at-frame', 'st-hidden', !f);
        doc.cls('at-frame-empty', 'st-hidden', !!f);
        if (f) {
            doc.text('at-f-title', 'Кадр ' + s.sel);
            doc.setValue('at-f-name', f.name);
            doc.setValue('at-f-x', String(f.x)); doc.setValue('at-f-y', String(f.y));
            doc.setValue('at-f-w', String(f.w)); doc.setValue('at-f-h', String(f.h));
            doc.setValue('at-f-px', f.pivot ? String(f.pivot.x) : ''); doc.setValue('at-f-py', f.pivot ? String(f.pivot.y) : '');
            doc.setValue('at-f-dur', f.duration === null || f.duration === undefined ? '' : String(f.duration));
        }
        const t = d.tags[s.tag];
        doc.text('at-t-title', t ? 'Тег ' + t.name : 'Новый тег');
        doc.setValue('at-t-name', t ? t.name : '');
        doc.setValue('at-t-from', t ? String(t.from) : String(Math.max(0, s.sel)));
        doc.setValue('at-t-to', t ? String(t.to) : String(Math.max(0, s.sel)));
        doc.setValue('at-t-dir', t ? t.direction : 'forward');
        doc.setValue('at-t-loop', t && t.loop === false ? 'once' : 'loop');
        doc.setValue('at-t-dur', t && d.frames[t.from] && d.frames[t.from].duration ? String(d.frames[t.from].duration) : '');
        doc.cls('at-t-delete', 'st-hidden', !t);
        doc.html('at-custom', d.custom && Object.keys(d.custom).length ? Object.keys(d.custom).map((k) => row(k, esc(k) + '<span class="st-sub">' + esc(d.custom[k]) + '</span>')).join('')
            : '<span class="st-empty">нет</span>');
        doc.html('at-diags', s.diags.length ? s.diags.map((x) => '<span class="st-diag ' + esc(x.severity) + '">' + esc(x.code) + ': ' + esc(x.message) + '</span>').join('')
            : '<span class="st-empty">' + (s.history ? 'нет сообщений (проверка — кнопка «Проверить»)' : '') + '</span>');
        doc.cls('at-create', 'st-hidden', !s.create);
        doc.cls('at-edit', 'st-hidden', !!s.create);
    }

    function renderStrip() {
        doc.cls('at-strip', 'st-hidden', s.mode !== 'animation');
        if (s.mode !== 'animation') return;
        const t = s.model.tags[s.tag];
        if (!t) { doc.html('at-thumbs', '<span class="st-empty">Выберите или создайте тег слева.</span>'); return; }
        const frames = s.model.frames.slice(t.from, t.to + 1);
        const order = t.direction === 'reverse' ? frames.slice().reverse() : frames;
        const cur = s.anim ? (s.anim.get(0).frame_index | 0) : -1;
        doc.html('at-thumbs', order.map((f, i) => {
            const z = Math.min(56 / f.w, 56 / f.h);
            return '<div class="at-thumb' + (i === cur ? ' on' : '') + '" data-key="' + i + '"><img src="' + esc(s.imageAbs) + '" rect="' + f.x + ' ' + f.y + ' ' + f.w + ' ' + f.h +
                '" style="width: ' + Math.max(1, Math.round(f.w * z)) + 'px; height: ' + Math.max(1, Math.round(f.h * z)) + 'px;"/><span class="at-thumb-n">' + esc(f.duration || 100) + 'мс</span></div>';
        }).join(''));
        doc.text('at-play', s.playing ? 'Пауза' : 'Пуск');
        for (let i = 0; i < SPEEDS.length; i++) doc.cls('at-speed-' + i, 'on', i === s.speed);
        const play = M.tagPlayback(s.model, t.name);
        doc.text('at-anim-info', play ? 'кадр ' + (cur + 1) + '/' + order.length + ' · ' + play.interval + ' мс/кадр (по первому кадру, как в игре) · ' + (play.loop ? 'повторять' : 'один раз') + (t.direction === 'pingpong' ? ' · в $.atlas режим «туда и обратно» работает как «вперёд»' : '') : '');
    }

    function renderConflict() {
        if (!s.conflict) { doc.cls('at-conflict', 'st-hidden', true); doc.html('at-conflict', ''); return; }
        doc.cls('at-conflict', 'st-hidden', false);
        const missing = s.conflict.disk === null;
        doc.html('at-conflict', '<div class="at-conflict-shade"></div><div class="at-conflict-card"><span class="st-title">Атлас изменён вне редактора</span><span class="st-note">Перезагрузка заменит несохранённые правки. Перезапись сохранит текущую версию поверх файла.</span><span class="at-conflict-path">' + esc(s.path) + (missing ? '<br/>Файл удалён' : '') + '</span><div class="st-btns">' + (missing ? '' : '<button class="st-btn" data-key="reload">Перезагрузить</button>') + '<button class="st-btn primary" data-key="overwrite">Перезаписать</button><button class="st-btn" data-key="cancel">Отмена</button></div></div>');
    }
    function renderAll() { if (!s.model) return; renderTop(); renderLeft(); renderRight(); renderStrip(); renderOverlay(); renderConflict(); }

    // --- события ---------------------------------------------------------------------

    doc.on('at-validate', 'click', () => validate(true));
    doc.on('at-conflict', 'click', (_id, _ev, choice) => { if (choice === 'reload' || choice === 'overwrite' || choice === 'cancel') resolveConflict(choice); });
    doc.on('at-mode-sprite', 'click', () => setMode('sprite'));
    doc.on('at-mode-anim', 'click', () => setMode('animation'));
    doc.on('at-tool-select', 'click', () => setTool('select'));
    doc.on('at-tool-pivot', 'click', () => setTool('pivot'));
    doc.on('at-grid', 'click', () => { s.grid = !s.grid; renderTop(); });
    doc.on('at-zoom-out', 'click', () => { zoomBy(-1); renderTop(); });
    doc.on('at-zoom-in', 'click', () => { zoomBy(1); renderTop(); });
    doc.on('at-fit', 'click', () => { fit(); renderTop(); });
    doc.on('at-canvas', 'mousedown', canvasDown);
    doc.on('at-frames', 'click', (id, ev, k) => { if (k !== null && k !== '') select(Number(k)); });
    doc.on('at-tags', 'click', (id, ev, k) => { if (k !== null && k !== '') selectTag(Number(k)); });
    doc.on('at-f-apply', 'click', applyFrame);
    doc.on('at-f-nopivot', 'click', () => { if (s.sel >= 0) edit('пивот снят', (d) => M.setPivot(d, s.sel, null)); });
    doc.on('at-f-delete', 'click', () => { if (s.sel >= 0) edit('удалён кадр', (d) => M.removeFrame(d, s.sel)); });
    doc.on('at-f-up', 'click', () => { if (s.sel > 0) { const i = s.sel; edit('кадр выше', (d) => M.moveFrame(d, i, i - 1)); s.sel = i - 1; renderAll(); } });
    doc.on('at-f-down', 'click', () => { if (s.sel >= 0 && s.sel < s.model.frames.length - 1) { const i = s.sel; edit('кадр ниже', (d) => M.moveFrame(d, i, i + 1)); s.sel = i + 1; renderAll(); } });
    doc.on('at-t-apply', 'click', applyTag);
    doc.on('at-t-new', 'click', newTag);
    doc.on('at-t-delete', 'click', () => { if (s.tag >= 0) { const i = s.tag; edit('удалён тег', (d) => M.removeTag(d, i)); } });
    doc.on('at-m-apply', 'click', applyCustom);
    doc.on('at-custom', 'click', (id, ev, k) => { if (k) { doc.setValue('at-m-key', k); doc.setValue('at-m-val', String(s.model.custom[k])); } });
    doc.on('at-g-slice', 'click', slice);
    doc.on('at-g-slice2', 'click', slice);
    doc.on('at-play', 'click', () => setPlaying(!s.playing));
    doc.on('at-prev', 'click', () => step(-1));
    doc.on('at-next', 'click', () => step(1));
    for (let i = 0; i < SPEEDS.length; i++) doc.on('at-speed-' + i, 'click', () => setSpeed(i));
    doc.on('at-thumbs', 'click', (id, ev, k) => { if (k !== null && k !== '' && s.anim) { setPlaying(false); s.anim.frame(Number(k)); renderStrip(); } });
    doc.on('at-spritemesh', 'click', () => host.openWith(s.path, 'sprite-mesh-studio'));

    // --- контракт студии -----------------------------------------------------------------

    return {
        doc,
        open,
        update(dt) {
            if (!s.model) return;
            if (s.needFit && canvas().w > 0) fit();
            tickPanZoom();
            tickPress();
            tickKeys();
            if (s.mode === 'sprite') { drawSprite(); renderOverlay(); }
            else drawAnim();
            renderTop();
            void dt;
        },
        layout() { s.needFit = true; },
        onActive(on) {
            screenCamera($);
            if (s.node) s.node.visible(on && s.mode === 'sprite');
            if (s.anim) s.anim.visible(on);
        },
        save,
        undo() { if (s.busy || s.closed) return false; const l = s.history && s.history.undo(); if (l) { afterEdit('отменено: ' + l); } return !!l; },
        redo() { if (s.busy || s.closed) return false; const l = s.history && s.history.redo(); if (l) { afterEdit('повторено: ' + l); } return !!l; },
        dirty() { return !!(s.history && !s.create && s.history.dirty()); },
        diagnostics() {
            const out = s.diags.slice();
            if (s.error) out.push(diag('R2D_ATLAS_EDIT', 'error', s.error, { asset: s.path }));
            return out;
        },
        snapshot() {
            return { file: s.path, mode: s.mode, tool: s.tool, frames: s.model ? s.model.frames.length : 0,
                     tags: s.model ? s.model.tags.map((t) => t.name) : [], selected: s.sel, tag: s.tag,
                     zoom: s.view.zoom, dirty: !!(s.history && s.history.dirty()), playing: s.playing, create: !!s.create };
        },
        commands() {
            return [
                { label: 'Атлас: режим кадров', run: () => setMode('sprite') },
                { label: 'Атлас: режим анимации', run: () => setMode('animation') },
                { label: 'Атлас: проверить черновик (r2d validate)', run: () => validate(true) },
                { label: 'Атлас: вписать картинку', run: () => fit() },
            ];
        },
        // Операции для агента и тестов — те же, что у кнопок.
        ops: { select, selectTag, setMode, setTool, applyFrame, applyTag, newTag, slice, validate, fit, edit, resolveConflict, model: () => s.model, M },
        close() { s.closed = true; stopPreview(); if (s.node) s.node.remove(); s.node = null; doc.unload(); },
    };
}
