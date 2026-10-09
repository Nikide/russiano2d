// ===========================================================================
// Animation Studio — редактор спрайтовых анимаций (docs/SDK.md §8).
//
// Анимация = тег атласа (`meta.frameTags`): диапазон кадров, направление,
// цикл, длительность. Это ровно то, что игра читает через `$.atlas`
// (`tagSprites`, `tagInterval`) и играет обычным `.frames().animate()`.
// Отдельного формата нет, события клипа здесь НЕ редактируются: спрайтовая
// анимация рантайма их не поддерживает (события есть у `$.anim`/`$.anim.player`).
//
// Просмотр — настоящий рантайм: атлас разбирает `$.atlas` из того же текста,
// что будет записан, узел с `.frames().animate()` крутит кадры обычным
// кадровым шагом движка, а студия лишь рисует текущий кадр в окне просмотра.
// ===========================================================================

import * as M from '../lib/atlas_model.js';
import { openAtlasSession } from '../lib/atlas_session.js';
import { escapeHtml } from '../lib/model.js';
import * as views from '../lib/views.js';

const DOC = 'sdk/ui/animation_studio.rml';
const SPEEDS = [0.25, 0.5, 1, 2, 4];

let singleton = null;

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
        tag: -1,           // выбранный тег (индекс)
        playing: true,
        speedIndex: 2,
        node: null,        // узел рантайма, который играет анимацию
        frames: [],        // id спрайтов тега в порядке проигрывания
        names: [],
        dirtyPreview: true,
    };
    let wired = false;

    const D = () => (s.session ? s.session.doc : null);

    function slotRect() { return doc.rect('an-view') || { x: 0, y: 0, w: 0, h: 0 }; }

    function note(severity, code, message) {
        const d = { code, severity, asset: s.session ? s.session.path : null, location: null, message, details: null };
        const list = (s.session ? s.session.diagnostics : []).concat([d]);
        if (s.session) s.session.diagnostics = list;
        doc.html('an-diag', views.diagRows(list));
        return d;
    }

    function run(label, fn) {
        if (!s.session) return null;
        try {
            const result = s.session.history.run(label, fn);
            s.dirtyPreview = true;
            renderAll();
            return result;
        } catch (e) {
            note('error', 'SDK_EDIT_REJECTED', e && e.message ? e.message : String(e));
            app.setStatus('правка отклонена: ' + (e && e.message ? e.message : e), 'fail');
            return null;
        }
    }

    const ops = {
        addTag(tag) {
            return run('тег', (d) => { const i = M.addTag(d, tag); s.tag = i; return i; });
        },
        updateTag(i, patch) { return run('тег', (d) => M.updateTag(d, i, patch)); },
        removeTag(i) { return run('удаление тега', (d) => { M.removeTag(d, i); s.tag = Math.min(s.tag, d.tags.length - 1); }); },
        // Поля тега и длительность — одна команда.
        applyFields(i, f) {
            return run('тег «' + (D() && D().tags[i] ? D().tags[i].name : i) + '»', (d) => {
                M.updateTag(d, i, f.tag);
                if (f.duration !== undefined && f.duration !== null) M.setTagDuration(d, i, f.duration);
            });
        },
        setDuration(i, ms) { return run('длительность тега', (d) => M.setTagDuration(d, i, ms)); },
        undo() { const l = s.session && s.session.history.undo(); if (l) { s.dirtyPreview = true; renderAll(); } return l; },
        redo() { const l = s.session && s.session.history.redo(); if (l) { s.dirtyPreview = true; renderAll(); } return l; },
    };

    // --- Открытие -----------------------------------------------------------------------
    async function openAsset(abs) {
        if (!abs || !abs.endsWith('.atlas.json')) {
            throw new Error('Animation Studio: выберите файл *.atlas.json (атлас с кадрами создаёт Sprite Studio)');
        }
        s.session = openAtlasSession(app, abs);
        s.tag = s.session.doc.tags.length ? 0 : -1;
        s.playing = true;
        s.active = true;
        if (app.doc) app.doc.hide();
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);
        const sprite = app.studios && app.studios.sprite;
        if (sprite) {
            // Sprite Studio ждёт возврата: его документ скрываем, правки живут в общей сессии.
            sprite.state.active = false;
            $.ui.doc('sdk/ui/sprite_studio.rml').hide();
        }
        doc.show();
        wire();
        app.setStatus('Animation Studio: ' + abs.split('/').pop(), '');
        s.dirtyPreview = true;
        renderAll();
        return { id: 'animation-studio', studio: api };
    }

    function close() {
        s.active = false;
        killNode();
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
    }

    async function toSprite() {
        s.active = false;
        killNode();
        doc.hide();
        const sprite = app.studios && app.studios.sprite;
        if (sprite && s.session) {
            sprite.resume();
            return sprite;
        }
        return app.openTool('sprite-studio', { assetAbs: s.session ? s.session.path : null });
    }

    async function save() {
        if (!s.session) return { ok: false, diagnostics: [] };
        const r = await s.session.save();
        s.dirtyPreview = true;
        renderAll();
        app.setStatus(r.ok ? 'сохранено: ' + s.session.path.split('/').pop() : 'сохранено, но есть ошибки проверки', r.ok ? '' : 'fail');
        return r;
    }

    async function validate() {
        if (!s.session) return { ok: false, diagnostics: [] };
        const r = await s.session.validateDraft();
        doc.html('an-diag', views.diagRows(r.diagnostics));
        app.setStatus(r.ok ? 'проверка: ошибок нет' : 'проверка: есть ошибки', r.ok ? '' : 'fail');
        return r;
    }

    // --- Выбор тега и просмотр -----------------------------------------------------------------
    function selectTag(i) {
        const d = D();
        s.tag = d && i >= 0 && i < d.tags.length ? i : -1;
        s.dirtyPreview = true;
        renderAll();
        return s.tag;
    }

    function killNode() {
        if (s.node) { $(s.node).remove(); s.node = null; }
    }

    /** Пересобрать узел просмотра из ТЕКУЩЕЙ модели через настоящий $.atlas. */
    function rebuildPreview() {
        killNode();
        s.frames = [];
        s.names = [];
        const d = D();
        if (!d || s.tag < 0 || !d.tags[s.tag]) return;
        let sheet = null;
        try {
            sheet = s.session.previewSheet();
        } catch (e) {
            note('error', 'SDK_PREVIEW', 'Рантайм не смог разобрать атлас: ' + (e && e.message ? e.message : e));
            return;
        }
        if (!sheet) {
            note('error', 'SDK_PREVIEW', 'Рантайм не смог загрузить атлас (картинка или кадры недоступны)');
            return;
        }
        const tag = d.tags[s.tag];
        s.frames = sheet.tagSprites(tag.name);
        s.names = sheet.tag(tag.name);
        if (!s.frames.length) return;
        const playback = M.tagPlayback(d, tag.name);
        const node = $('<sprite>', { id: 'sdk-anim-preview' }).appendTo($.world);
        node.frames(s.frames).frame(0).animate({
            from: 0, to: s.frames.length - 1, speed: playback.fps * SPEEDS[s.speedIndex], loop: playback.loop,
        });
        if (!s.playing) node.playing(false);
        s.node = node.get(0);
    }

    function currentIndex() {
        return s.node && s.node.frame_index !== undefined ? s.node.frame_index : 0;
    }

    function setSpeed(i) {
        s.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
        const d = D();
        if (s.node && d && d.tags[s.tag]) {
            const p = M.tagPlayback(d, d.tags[s.tag].name);
            s.node.anim.speed = p.fps * SPEEDS[s.speedIndex];
        }
        renderControls();
        return SPEEDS[s.speedIndex];
    }

    function setPlaying(on) {
        s.playing = !!on;
        if (s.node && s.node.anim) {
            s.node.anim.playing = s.playing;
            if (s.playing && !s.node.anim.loop && Math.floor(s.node.anim.t) >= s.frames.length) s.node.anim.t = 0;
        }
        renderControls();
        return s.playing;
    }

    function stepFrame() {
        if (!s.node || !s.node.anim || !s.frames.length) return currentIndex();
        setPlaying(false);
        s.node.anim.t = Math.floor(s.node.anim.t) + 1;
        const i = s.node.anim.from + (Math.floor(s.node.anim.t) % s.frames.length);
        s.node.sprite = s.node.frames[i];
        s.node.frame_index = i;
        return i;
    }

    // --- Отрисовка интерфейса --------------------------------------------------------------------
    function renderControls() {
        doc.text('an-play', s.playing ? 'Пауза' : 'Играть');
        doc.cls('an-play', 'on', s.playing);
        for (let i = 0; i < SPEEDS.length; i++) doc.cls('an-sp-' + i, 'on', i === s.speedIndex);
    }

    function renderTags() {
        const d = D();
        if (!d || d.tags.length === 0) { doc.html('an-tags', '<p class="empty">Анимаций нет. «Новая» создаёт тег из выбранных кадров.</p>'); return; }
        doc.html('an-tags', d.tags.map((t, i) =>
            '<div id="tg-' + i + '" class="row' + (i === s.tag ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + escapeHtml(t.name) +
            '</span><span class="row-dir">' + t.from + '–' + t.to + ' · ' + (t.direction || 'forward') + (t.loop === false ? ' · без цикла' : '') +
            '</span></div>').join(''));
    }

    function renderFields() {
        const d = D();
        const t = d && s.tag >= 0 ? d.tags[s.tag] : null;
        const set = (id, v) => doc.setValue(id, v === null || v === undefined ? '' : String(v));
        set('t-name', t ? t.name : '');
        set('t-from', t ? t.from : ''); set('t-to', t ? t.to : '');
        const first = t ? d.frames[t.from] : null;
        set('t-dur', first && first.duration ? first.duration : '');
        const dir = t ? (t.direction || 'forward') : 'forward';
        for (const name of ['forward', 'reverse', 'pingpong']) doc.cls('t-dir-' + name, 'on', name === dir);
        doc.cls('t-loop', 'on', !t || t.loop !== false);
        s.dirChoice = dir;
        s.loopChoice = !t || t.loop !== false;
    }

    function renderStrip() {
        const d = D();
        const t = d && s.tag >= 0 ? d.tags[s.tag] : null;
        if (!t) { doc.html('an-strip', '<p class="empty">Выберите тег.</p>'); return; }
        const cur = currentIndex();
        let html = '';
        for (let i = t.from; i <= t.to; i++) {
            const f = d.frames[i];
            html += '<span class="strip-cell' + (i - t.from === cur ? ' cur' : '') + '">' + escapeHtml(f.name) + ' · ' + (f.duration || '—') + '</span>';
        }
        doc.html('an-strip', html);
    }

    function renderTop() {
        const dirty = s.session && s.session.history.dirty();
        doc.text('an-file', escapeHtml(s.session ? s.session.path : '—'));
        doc.text('an-dirty', dirty ? '• есть несохранённые правки' : '');
        const h = s.session ? s.session.history : null;
        doc.cls('an-undo', 'off', !(h && h.canUndo()));
        doc.cls('an-redo', 'off', !(h && h.canRedo()));
    }

    function hudText() {
        const d = D();
        const t = d && s.tag >= 0 ? d.tags[s.tag] : null;
        if (!t) return 'тег не выбран';
        const p = M.tagPlayback(d, t.name);
        return t.name + ' · кадр ' + (currentIndex() + 1) + '/' + s.frames.length + ' · ' + (Math.round(p.fps * 10) / 10) + ' к/с ×' + SPEEDS[s.speedIndex] +
            (t.direction === 'pingpong' ? ' · pingpong: рантайм-атлас играет вперёд' : '');
    }

    function renderAll() {
        renderTop();
        renderTags();
        renderFields();
        renderControls();
        renderStrip();
        doc.html('an-diag', views.diagRows(s.session ? s.session.diagnostics : []));
        doc.text('an-hud', escapeHtml(hudText()));
    }

    // --- Кадр: сам узел рантайма стоит в окне просмотра ----------------------------------------------
    let lastIndex = -1;
    function drawFrame() {
        if (!s.active) return;
        if (s.dirtyPreview) { s.dirtyPreview = false; rebuildPreview(); renderAll(); }
        if (!s.node || !s.frames.length) return;
        const idx = currentIndex();
        if (idx !== lastIndex) { lastIndex = idx; renderStrip(); doc.text('an-hud', escapeHtml(hudText())); }
        const r = slotRect();
        const d = D();
        const info = d ? d.frames[d.tags[s.tag].from + idx] : null;
        if (!info) return;
        const k = Math.max(1, Math.min(16, Math.floor(Math.min((r.w - 40) / info.w, (r.h - 40) / info.h))));
        const w = info.w * k, h = info.h * k;
        const x = r.x + r.w / 2, y = r.y + r.h / 2;
        // Узел — обычный <sprite>: размер и место задаём ему, кадр меняет сам движок.
        $(s.node).at(x, y).size(w, h);
        const x0 = x - w / 2, y0 = y - h / 2;
        $.gfx.draw.rect(x0 - 1, y0 - 1, w + 2, 1, 'rgba(127,209,255,0.5)');
        $.gfx.draw.rect(x0 - 1, y0 + h, w + 2, 1, 'rgba(127,209,255,0.5)');
        $.gfx.draw.rect(x0 - 1, y0, 1, h, 'rgba(127,209,255,0.5)');
        $.gfx.draw.rect(x0 + w, y0, 1, h, 'rgba(127,209,255,0.5)');
        if (info.pivot) {
            const px = x0 + info.pivot.x * k, py = y0 + info.pivot.y * k;
            $.gfx.draw.line(px - 6, py, px + 6, py, '#ff6b9d', 1);
            $.gfx.draw.line(px, py - 6, px, py + 6, '#ff6b9d', 1);
        }
    }

    // --- Подписки ------------------------------------------------------------------------------------
    function applyForm() {
        const d = D();
        if (!d || s.tag < 0) return null;
        const num = (id) => { const v = String(doc.value(id) || '').trim(); return v === '' ? null : Number(v); };
        return ops.applyFields(s.tag, {
            tag: { name: String(doc.value('t-name') || '').trim(), from: num('t-from'), to: num('t-to'), direction: s.dirChoice, loop: s.loopChoice },
            duration: num('t-dur'),
        });
    }

    function newTag() {
        const d = D();
        if (!d || d.frames.length === 0) { note('warning', 'SDK_NO_FRAMES', 'Сначала добавьте кадры в Sprite Studio'); return null; }
        const spriteStudio = app.studios && app.studios.sprite;
        const sel = spriteStudio ? spriteStudio.state.sel : -1;
        const from = sel >= 0 && sel < d.frames.length ? sel : 0;
        let n = d.tags.length + 1;
        let name = 'anim' + n;
        while (d.tags.some((t) => t.name === name)) name = 'anim' + (++n);
        return ops.addTag({ name, from, to: Math.min(d.frames.length - 1, from + 3), direction: 'forward', loop: true });
    }

    function wire() {
        if (wired) return;
        wired = true;
        doc.on('an-back', 'click', () => close());
        doc.on('an-save', 'click', () => save());
        doc.on('an-undo', 'click', () => ops.undo());
        doc.on('an-redo', 'click', () => ops.redo());
        doc.on('an-validate', 'click', () => validate());
        doc.on('an-to-sprite', 'click', () => toSprite());
        doc.on('an-tags', 'click', (id, ev, key) => { if (key !== '') selectTag(parseInt(key, 10)); });
        doc.on('an-add-tag', 'click', () => newTag());
        doc.on('an-del-tag', 'click', () => { if (s.tag >= 0) ops.removeTag(s.tag); });
        doc.on('an-play', 'click', () => setPlaying(!s.playing));
        doc.on('an-step', 'click', () => stepFrame());
        for (let i = 0; i < SPEEDS.length; i++) doc.on('an-sp-' + i, 'click', () => setSpeed(i));
        for (const name of ['forward', 'reverse', 'pingpong']) {
            doc.on('t-dir-' + name, 'click', () => {
                s.dirChoice = name;
                for (const n of ['forward', 'reverse', 'pingpong']) doc.cls('t-dir-' + n, 'on', n === name);
            });
        }
        doc.on('t-loop', 'click', () => { s.loopChoice = !s.loopChoice; doc.cls('t-loop', 'on', s.loopChoice); });
        doc.on('an-apply', 'click', () => applyForm());
    }

    const api = {
        state: s,
        ops,
        openAsset, close, save, validate, toSprite,
        selectTag, setSpeed, setPlaying, stepFrame, applyForm, newTag,
        currentIndex,
        get session() { return s.session; },
        snapshot() {
            const d = D();
            return {
                active: s.active,
                file: s.session ? s.session.path : null,
                tags: d ? d.tags.map((t) => t.name) : [],
                tag: s.tag,
                playing: s.playing,
                speed: SPEEDS[s.speedIndex],
                frameIndex: currentIndex(),
                frames: s.frames.length,
                names: s.names,
                dirty: s.session ? s.session.history.dirty() : false,
            };
        },
        renderAll,
    };

    app.studios = app.studios || {};
    app.studios.animation = api;
    $.update(() => { drawFrame(); });
    return api;
}
