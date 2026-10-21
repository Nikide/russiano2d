// ===========================================================================
// Re2DSprite — студия Editor для *.character.json (docs/RE2DSPRITE_JSON.md).
//
// Превью — настоящий runtime: узел $.re2dSprite.from во вьюпорте, поза,
// клипы, слои, эмоции, варианты, экипировка по сокетам и видимость частей —
// публичные методы .re2d*. Своего синтеза и второй модели здесь нет.
//
// Правится описание (style, projection, defaults, параметры equipment) с
// историей на вкладку. Пока есть несохранённые правки, превью строится из
// временного черновика рядом с файлом (пути описания считаются от его
// каталога), и рантайм сразу проверяет описание: если он его отклоняет,
// Save блокируется с диагностикой.
// ===========================================================================

import { createHistory } from '../lib/shared/history.js';
import { studioDoc, esc, diag, mousePx, inside, uiScale, screenCamera } from '../lib/studio_kit.js';

export const meta = { id: 're2dsprite', title: 'Re2DSprite', icon: 'accessibility_new', match: (p) => /\.character\.json$/i.test(p) };

const PROJECTION = [['rs-f-raster', 'raster'], ['rs-f-detail', 'detail'], ['rs-f-body', 'bodyScale'], ['rs-f-portrait', 'portraitScale']];
const CUSTOM = '(своё)';
let previewCounter = 0;

/** Имя эмоции, совпадающей с defaults.expression; CUSTOM — своё сочетание; '' — нет. */
function expressionName(j) {
    const e = j && j.defaults && j.defaults.expression;
    if (e === undefined || e === null) return '';
    const key = JSON.stringify(e);
    return Object.keys(j.emotions || {}).find((n) => JSON.stringify(j.emotions[n]) === key) || CUSTOM;
}

export function create(host) {
    const $ = host.$;
    const doc = studioDoc($, 're2dsprite');
    const tag = 'editor-re2d-' + (++previewCounter);
    const s = {
        path: '', dir: '', json: null, source: '', history: null, node: null, items: new Map(), clips: {},
        yaw: 30, pitch: 0, style: 'anime', motion: '', playing: true, layers: new Set(), emotion: '', variants: {},
        hidden: new Set(), turntable: false, drag: null, scrub: false, eq: '', active: false, closed: false,
        runtimeError: '', diags: [], status: '', placed: '', draftSeq: 0, needsBuild: false,
    };

    const dirty = () => !!s.history && s.history.dirty();
    const status = (text, kind) => { s.status = text; doc.text('rs-status', esc(text)); doc.cls('rs-status', 'err', kind === 'err'); doc.cls('rs-status', 'ok', kind !== 'err'); };
    const changed = () => { renderAll(); host.changed(); };

    // --- описание и клипы ---------------------------------------------------------
    function readClips() {
        s.clips = {};
        const a = s.json && s.json.animations;
        let data = null;
        if (typeof a === 'string') data = $.fs.readJSON(s.dir + a, null);
        else if (a && typeof a === 'object') data = a;
        for (const [name, clip] of Object.entries((data && data.clips) || {})) {
            s.clips[name] = { duration: Number(clip.duration) || 1, loop: clip.loop !== false };
        }
    }

    function edit(label, fn) {
        if (!s.history) return false;
        try { s.history.run(label, () => fn(s.json)); }
        catch (e) { s.diags = [diag('R2D_RE2DSPRITE_EDIT', 'error', e.message || e, { asset: s.path })]; changed(); return false; }
        s.needsBuild = true;
        changed();
        return true;
    }

    // --- превью ----------------------------------------------------------------------
    function dropNode() {
        for (const item of s.items.values()) { try { item.re2dDetach(); item.remove(); } catch (_) { /* уже удалён */ } }
        s.items.clear();
        if (s.node) { try { s.node.remove(); } catch (_) { /* уже удалён */ } }
        s.node = null;
    }

    // Чистое описание — из файла; несохранённое — из черновика рядом с ним.
    function build() {
        s.needsBuild = false;
        const equipped = [...s.items.keys()];
        dropNode();
        let source = s.path, draft = null;
        if (dirty()) {
            draft = s.dir + '.r2d-editor-' + tag + '-' + (++s.draftSeq) + '.character.json';
            if ($.fs.write(draft, JSON.stringify(s.json, null, 2) + '\n') === false) { s.runtimeError = 'не удалось записать черновик превью'; renderAll(); return false; }
            source = draft;
        }
        try {
            s.node = $.re2dSprite.from(source, { id: tag });
            s.runtimeError = '';
        } catch (e) {
            s.node = null;
            s.runtimeError = e && e.message ? e.message : String(e);
        } finally {
            if (draft) $.fs.remove(draft);
        }
        readClips();
        if (s.node) restoreRuntime(equipped);
        s.placed = '';
        renderAll(); host.changed();
        return !!s.node;
    }

    // Состояние превью (поза, клип, слои, эмоция, варианты, экипировка, части) переживает пересборку.
    function restoreRuntime(equipped) {
        const n = s.node;
        const safe = (fn) => { try { fn(); } catch (e) { s.runtimeError = e.message || String(e); } };
        if (!s.active) n.hide();
        safe(() => n.re2dStyle(s.style));
        if (!s.clips[s.motion]) s.motion = (s.json.defaults && s.json.defaults.motion) || Object.keys(s.clips)[0] || '';
        if (s.motion) safe(() => n.re2dMotion(s.motion, s.playing ? 1 : 0));
        for (const l of [...s.layers]) { if (s.clips[l]) safe(() => n.re2dLayer(l, true, 1)); else s.layers.delete(l); }
        if (s.emotion && (s.json.emotions || {})[s.emotion]) safe(() => n.re2dEmotion(s.emotion)); else s.emotion = '';
        for (const [g, k] of Object.entries(s.variants)) safe(() => n.re2dVariant(g, k));
        for (const key of equipped) if ((s.json.equipment || {})[key]) attach(key);
        applyHidden();
        pose();
    }

    function attach(key) {
        try {
            const item = $.re2dSprite.equip(s.node, key, { id: tag + '-item-' + key });
            item.re2dStyle(s.style);
            if (!s.active) item.hide();
            s.items.set(key, item);
        } catch (e) { s.runtimeError = e.message || String(e); }
    }
    function applyHidden() {
        const parts = ((s.json.rig || {}).parts || []).map((p) => p.id);
        try { s.node.re2dVisibleParts(s.hidden.size ? parts.filter((p) => !s.hidden.has(p)) : null); } catch (e) { s.runtimeError = e.message; }
    }

    function place() {
        if (!s.node) return;
        const r = doc.layoutRect('rs-view');
        if (!r || r.w <= 0) return;
        const k = uiScale($), key = [r.x, r.y, r.w, r.h, k].join(',');
        if (key === s.placed) return;
        s.placed = key;
        const side = Math.max(32, Math.min(r.w, r.h) / k * 0.92);
        s.node.at((r.x + r.w / 2) / k, (r.y + r.h / 2) / k).size(side, side);
    }
    function pose() {
        if (s.node) { try { s.node.re2dPose(s.yaw, s.pitch); } catch (e) { s.runtimeError = e.message || String(e); } }
        doc.text('rs-pose', 'yaw ' + Math.round(s.yaw) + '° · pitch ' + Math.round(s.pitch) + '°');
    }

    // --- действия превью (не правят файл) -----------------------------------------
    function play(name) {
        if (!s.node || !s.clips[name]) return false;
        s.motion = name; s.playing = true;
        s.node.re2dMotion(name, 1);
        renderAnim();
        return true;
    }
    function pause(on) {
        if (!s.node || !s.motion) return;
        s.playing = !on;
        s.node.re2dMotion(s.motion, s.playing ? 1 : 0);
        renderAnim();
    }
    function seek(fraction) {
        const clip = s.clips[s.motion];
        if (s.node && clip) s.node.re2dSeek(Math.max(0, Math.min(1, fraction)) * clip.duration);
    }
    function layer(name) {
        if (!s.node || !s.clips[name]) return;
        const on = !s.layers.has(name);
        if (on) s.layers.add(name); else s.layers.delete(name);
        s.node.re2dLayer(name, on, 1);
        renderAnim();
    }
    function emotion(name) {
        if (!s.node) return;
        try { s.node.re2dEmotion(name); s.emotion = name; } catch (e) { s.runtimeError = e.message; }
        renderLeft();
    }
    function variant(group, key) {
        if (!s.node) return;
        try { s.node.re2dVariant(group, key); s.variants[group] = key; } catch (e) { s.runtimeError = e.message; }
        renderLeft();
    }
    function equip(key) {
        if (!s.node) return;
        const eq = (s.json.equipment || {})[key] || {};
        s.eq = key;
        if (s.items.has(key)) {
            const item = s.items.get(key);
            try { item.re2dDetach(); item.remove(); } catch (_) { /* уже удалён */ }
            s.items.delete(key);
            if (eq.pose && s.layers.has(eq.pose)) layer(eq.pose);
        } else {
            attach(key);
            // Клип удержания equip не включает сам (RE2DSPRITE_JSON.md).
            if (eq.pose && s.clips[eq.pose] && !s.layers.has(eq.pose)) layer(eq.pose);
        }
        renderAll();
    }
    function togglePart(id) {
        if (!s.node) return;
        if (s.hidden.has(id)) s.hidden.delete(id); else s.hidden.add(id);
        applyHidden();
        renderRight();
    }
    function setStyle(style) {
        if (style !== 'anime' && style !== 'pixel') return;
        s.style = style;
        if (s.node) { try { s.node.re2dStyle(style); for (const item of s.items.values()) item.re2dStyle(style); } catch (e) { s.runtimeError = e.message; } }
        renderTop();
    }

    // --- правки описания -------------------------------------------------------------
    function applyFields() {
        const proj = {};
        for (const [id, key] of PROJECTION) {
            const raw = String(doc.value(id) || '').trim();
            if (raw === '') continue;
            const v = Number(raw);
            if (!Number.isFinite(v)) { s.diags = [diag('R2D_RE2DSPRITE_FIELD', 'error', key + ': нужно число', { asset: s.path })]; changed(); return false; }
            proj[key] = v;
        }
        const style = String(doc.value('rs-f-style') || ''), motion = String(doc.value('rs-f-motion') || ''), expression = String(doc.value('rs-f-expression') || '');
        const next = JSON.parse(JSON.stringify(s.json));
        if (style) next.style = style; else delete next.style;
        const p = Object.assign({}, next.projection || {});
        for (const [, key] of PROJECTION) { if (proj[key] === undefined) delete p[key]; else p[key] = proj[key]; }
        if (Object.keys(p).length) next.projection = p; else delete next.projection;
        const d = Object.assign({}, next.defaults || {});
        if (motion) d.motion = motion; else delete d.motion;
        // expression — объект селекторов: имя эмоции разворачивается в копию emotions[имя].
        if (expression === CUSTOM) { /* своё выражение файла не трогаем */ }
        else if (expression) d.expression = JSON.parse(JSON.stringify((next.emotions || {})[expression]));
        else delete d.expression;
        if (Object.keys(d).length) next.defaults = d; else delete next.defaults;
        if (JSON.stringify(next) === JSON.stringify(s.json)) { status('без изменений'); return false; }
        s.diags = [];
        return edit('Описание', (m) => { for (const k of Object.keys(m)) delete m[k]; Object.assign(m, next); });
    }
    function applyEquipment() {
        const key = s.eq, eq = (s.json.equipment || {})[key];
        if (!eq) return false;
        const patch = { socket: String(doc.value('rs-e-socket') || ''), pose: String(doc.value('rs-e-pose') || '') };
        for (const f of ['offset', 'rotation', 'scale']) {
            const raw = String(doc.value('rs-e-' + f) || '').trim();
            if (raw === '') { patch[f] = undefined; continue; }
            try { patch[f] = JSON.parse(raw); } catch (_) { s.diags = [diag('R2D_RE2DSPRITE_FIELD', 'error', f + ': JSON (число или массив)', { asset: s.path })]; changed(); return false; }
        }
        if (!patch.socket) { s.diags = [diag('R2D_RE2DSPRITE_FIELD', 'error', 'у экипировки нужен socket', { asset: s.path })]; changed(); return false; }
        s.diags = [];
        return edit('Экипировка «' + key + '»', (m) => {
            const t = m.equipment[key];
            for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '') delete t[k]; else t[k] = v; }
        });
    }
    function makeDefault() {
        if (!s.motion && !s.emotion) return false;
        return edit('Умолчания превью', (m) => {
            m.defaults = Object.assign({}, m.defaults || {});
            if (s.motion) m.defaults.motion = s.motion;
            if (s.emotion && (m.emotions || {})[s.emotion]) m.defaults.expression = JSON.parse(JSON.stringify(m.emotions[s.emotion]));
        });
    }

    async function save() {
        if (!s.history || s.closed) return false;
        if (!dirty()) return true;
        if (s.needsBuild) build();
        if (!s.node) {
            s.diags = [diag('R2D_RE2DSPRITE_RUNTIME', 'error', 'Save заблокирован: рантайм отклонил описание — ' + s.runtimeError, { asset: s.path })];
            changed();
            return false;
        }
        if ($.fs.readText(s.path) !== s.source) {
            s.diags = [diag('EDITOR_WRITE_CONFLICT', 'error', 'Файл изменён извне: переоткройте ' + s.path, { asset: s.path })];
            changed();
            return false;
        }
        const text = JSON.stringify(s.json, null, 2) + '\n';
        if ($.fs.write(s.path, text) === false) { s.diags = [diag('SDK_WRITE_FAILED', 'error', 'Не удалось записать ' + s.path, { asset: s.path })]; changed(); return false; }
        s.source = text;
        s.history.markSaved();
        s.diags = [];
        build();               // превью — снова из сохранённого файла
        status('сохранено');
        return true;
    }

    function reload() {
        // Анимации и PNG перечитываются заново; несохранённое описание остаётся в истории.
        build();
        status(s.node ? 'перечитано с диска' : 'ошибка рантайма', s.node ? '' : 'err');
    }

    // --- отрисовка ----------------------------------------------------------------------
    function renderTop() {
        doc.cls('rs-style-anime', 'on', s.style === 'anime');
        doc.cls('rs-style-pixel', 'on', s.style === 'pixel');
        doc.cls('rs-turntable', 'on', s.turntable);
        doc.text('rs-dirty', dirty() ? 'не сохранено' : '');
        if (s.runtimeError) status('ошибка рантайма', 'err');
    }
    const btn = (key, label, on) => '<button class="st-btn' + (on ? ' on' : '') + '" data-key="' + esc(key) + '">' + esc(label) + '</button>';
    function renderAnim() {
        const names = Object.keys(s.clips);
        doc.html('rs-clips', names.length ? names.map((n) => '<div class="st-row' + (n === s.motion ? ' sel' : '') + '" data-key="' + esc(n) + '">' + esc(n) +
            '<span class="st-sub">' + s.clips[n].duration.toFixed(2) + ' c' + (s.clips[n].loop ? ' · loop' : '') + '</span></div>').join('') : '<span class="st-empty">В описании нет клипов.</span>');
        doc.html('rs-layers', names.map((n) => btn(n, n, s.layers.has(n))).join(''));
        doc.text('rs-playpause', s.playing ? 'Pause' : 'Play');
    }
    function renderLeft() {
        const j = s.json || {};
        doc.html('rs-emotions', Object.keys(j.emotions || {}).map((n) => btn(n, n, n === s.emotion)).join('') || '<span class="st-empty">нет</span>');
        const groups = Object.entries(j.variants || {});
        doc.html('rs-variants', groups.length ? groups.map(([g, keys]) => '<div class="rs-group"><span class="st-label">' + esc(g) + '</span><div class="rs-wrap">' +
            Object.keys(keys).map((k) => btn(g + '\u0001' + k, k, s.variants[g] === k)).join('') + '</div></div>').join('') : '<span class="st-empty">нет</span>');
        const eq = Object.keys(j.equipment || {});
        doc.html('rs-equipment', eq.length ? eq.map((n) => '<div class="st-row' + (n === s.eq ? ' sel' : '') + '" data-key="' + esc(n) + '">' + (s.items.has(n) ? '[x] ' : '[ ] ') + esc(n) +
            '<span class="st-sub">' + esc((j.equipment[n] || {}).socket || '') + '</span></div>').join('') : '<span class="st-empty">нет</span>');
    }
    function options(id, list, value) {
        doc.html(id, ['<option value="">—</option>'].concat(list.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>')).join(''));
        doc.setValue(id, value || '');
    }
    function renderRight() {
        const j = s.json || {}, rig = j.rig || {}, proj = j.projection || {}, d = j.defaults || {};
        doc.setValue('rs-f-style', j.style || '');
        for (const [id, key] of PROJECTION) doc.setValue(id, proj[key] === undefined ? '' : String(proj[key]));
        options('rs-f-motion', Object.keys(s.clips), d.motion);
        const named = expressionName(j);
        options('rs-f-expression', Object.keys(j.emotions || {}).concat(named === CUSTOM ? [CUSTOM] : []), named);
        const eq = (j.equipment || {})[s.eq];
        doc.cls('rs-eq-panel', 'st-hidden', !eq);
        if (eq) {
            doc.text('rs-eq-title', 'Экипировка «' + s.eq + '»');
            options('rs-e-socket', (rig.sockets || []).map((k) => k.name), eq.socket);
            options('rs-e-pose', Object.keys(s.clips), eq.pose);
            for (const f of ['offset', 'rotation', 'scale']) doc.setValue('rs-e-' + f, eq[f] === undefined ? '' : JSON.stringify(eq[f]));
        }
        const info = s.node ? $.re2dSprite.info(s.node) : null;
        const fact = (l, v) => '<div class="rs-fact"><label>' + esc(l) + '</label><span>' + esc(v) + '</span></div>';
        doc.html('rs-source', fact('Описание', s.path.split('/').pop()) + fact('Atlas', j.atlas || '—') +
            fact('Анимации', typeof j.animations === 'string' ? j.animations : j.animations ? 'встроены' : '—') +
            fact('Версия PNG', info ? String(info.version) : '—') + fact('Кадр', info ? info.width + '×' + info.height : '—') +
            fact('Кости / части', (rig.bones || []).length + ' / ' + (rig.parts || []).length));
        doc.html('rs-parts', (rig.parts || []).map((p) => '<div class="st-row' + (s.hidden.has(p.id) ? ' off' : '') + '" data-key="' + p.id + '">' + (s.hidden.has(p.id) ? '[ ] ' : '[x] ') + '#' + p.id +
            '<span class="st-sub">' + esc(p.bone) + (p.selector ? ' · ' + esc(p.selector) : '') + '</span></div>').join('') || '<span class="st-empty">нет</span>');
        const byName = new Map((rig.bones || []).map((x) => [x.name, x]));
        const depth = (b) => { let n = 0, cur = b; while (cur && cur.parent && n < 16) { n++; cur = byName.get(cur.parent); } return n; };
        doc.html('rs-bones', (rig.bones || []).map((b) => '<div class="st-row" style="padding-left:' + (8 + depth(b) * 12) + 'px;">' + esc(b.name) + '</div>').join('') || '<span class="st-empty">нет</span>');
        doc.html('rs-sockets', (rig.sockets || []).map((k) => '<div class="st-row">' + esc(k.name) + '<span class="st-sub">' + esc(k.bone) + '</span></div>').join('') || '<span class="st-empty">нет</span>');
        doc.html('rs-diags', diagnostics().map((x) => '<span class="st-diag ' + esc(x.severity) + '">' + esc(x.code + ': ' + x.message) + '</span>').join('') || '<span class="st-empty">Проблем нет.</span>');
    }
    function renderAll() { renderTop(); renderAnim(); renderLeft(); renderRight(); pose(); }

    function diagnostics() {
        const out = s.diags.slice();
        if (s.runtimeError) out.push(diag('R2D_RE2DSPRITE_RUNTIME', 'error', s.runtimeError, { asset: s.path }));
        return out;
    }

    // --- события -------------------------------------------------------------------------
    doc.on('rs-apply', 'click', applyFields);
    doc.on('rs-e-apply', 'click', applyEquipment);
    doc.on('rs-default', 'click', makeDefault);
    doc.on('rs-reload', 'click', reload);
    doc.on('rs-style-anime', 'click', () => setStyle('anime'));
    doc.on('rs-style-pixel', 'click', () => setStyle('pixel'));
    doc.on('rs-turntable', 'click', () => { s.turntable = !s.turntable; renderTop(); });
    doc.on('rs-front', 'click', () => { s.yaw = 0; s.pitch = 0; pose(); });
    doc.on('rs-three', 'click', () => { s.yaw = 30; s.pitch = 8; pose(); });
    doc.on('rs-side', 'click', () => { s.yaw = 90; s.pitch = 0; pose(); });
    doc.on('rs-back', 'click', () => { s.yaw = 180; s.pitch = 0; pose(); });
    doc.on('rs-playpause', 'click', () => pause(s.playing));
    doc.on('rs-clips', 'click', (_id, _ev, key) => { if (key) play(key); });
    doc.on('rs-layers', 'click', (_id, _ev, key) => { if (key) layer(key); });
    doc.on('rs-emotions', 'click', (_id, _ev, key) => { if (key) emotion(key); });
    doc.on('rs-variants', 'click', (_id, _ev, key) => { if (key) { const [g, k] = key.split('\u0001'); variant(g, k); } });
    doc.on('rs-equipment', 'click', (_id, _ev, key) => { if (key) equip(key); });
    doc.on('rs-parts', 'click', (_id, _ev, key) => { if (key) togglePart(Number(key)); });

    function update(dt) {
        if (s.closed || !s.active) return;
        screenCamera($);
        if (s.needsBuild) build();
        if (!s.node) return;
        place();
        const m = mousePx($), pressed = $.input.mousePressed('left'), down = $.input.mouseDown('left');
        const view = doc.layoutRect('rs-view'), line = doc.layoutRect('rs-timeline');
        if (pressed && !host.typing()) {
            if (inside(m, line)) s.scrub = true;
            else if (inside(m, view)) { s.drag = { x: m.x, y: m.y }; s.turntable = false; renderTop(); }
        }
        if (s.scrub) { if (down && line && line.w > 0) seek((m.x - line.x) / line.w); else s.scrub = false; }
        if (s.drag) {
            if (down) {
                const k = uiScale($);
                s.yaw = ((s.yaw + (m.x - s.drag.x) / k * 0.6 + 540) % 360) - 180;
                s.pitch = Math.max(-75, Math.min(75, s.pitch - (m.y - s.drag.y) / k * 0.4));
                s.drag = { x: m.x, y: m.y };
                pose();
            } else s.drag = null;
        }
        if (s.turntable) { s.yaw = ((s.yaw + 40 * dt + 540) % 360) - 180; pose(); }
        const clip = s.clips[s.motion];
        if (clip) {
            const info = $.re2dSprite.info(s.node);
            const t = info && Number.isFinite(info.animationTime) ? info.animationTime : 0;
            const f = clip.duration > 0 ? (clip.loop ? (t % clip.duration) / clip.duration : Math.min(1, t / clip.duration)) : 0;
            doc.style('rs-playhead', 'width', (f * 100).toFixed(2) + '%');
            doc.text('rs-time', t.toFixed(2) + ' / ' + clip.duration.toFixed(2) + ' c');
        }
    }

    function showNodes(on) {
        if (s.node) { if (on) s.node.show(); else s.node.hide(); }
        for (const item of s.items.values()) { if (on) item.show(); else item.hide(); }
    }

    return {
        doc, state: s,
        async open(path) {
            s.path = path;
            s.dir = path.replace(/[^/]*$/, '');
            const text = $.fs.readText(path);
            if (text === null || text === undefined) throw new Error('не удалось прочитать ' + path);
            s.json = JSON.parse(text);
            s.source = text;
            s.history = createHistory(s.json);
            s.style = s.json.style === 'pixel' ? 'pixel' : 'anime';
            s.motion = (s.json.defaults && s.json.defaults.motion) || '';
            s.emotion = expressionName(s.json) === CUSTOM ? '' : expressionName(s.json);
            build();
            status(s.node ? 'загружено' : 'ошибка рантайма', s.node ? '' : 'err');
        },
        update,
        layout() { s.placed = ''; },
        onActive(on) { s.active = !!on; s.drag = null; s.scrub = false; if (on) { screenCamera($); s.placed = ''; } showNodes(!!on); },
        save,
        undo() { if (!s.history || !s.history.undo()) return false; s.needsBuild = true; changed(); return true; },
        redo() { if (!s.history || !s.history.redo()) return false; s.needsBuild = true; changed(); return true; },
        dirty,
        diagnostics,
        snapshot() {
            return { asset: s.path, dirty: dirty(), style: s.style, motion: s.motion, playing: s.playing, layers: [...s.layers], yaw: s.yaw, pitch: s.pitch,
                equipped: [...s.items.keys()], hiddenParts: [...s.hidden], clips: Object.keys(s.clips), emotion: s.emotion, node: !!s.node, error: s.runtimeError };
        },
        commands: () => [{ label: 'Re2DSprite: перечитать с диска', run: reload }, { label: 'Re2DSprite: сделать текущий клип умолчанием', run: makeDefault }],
        ops: { play, pause, seek, layer, emotion, variant, equip, togglePart, setStyle, applyFields, applyEquipment, makeDefault, reload,
            setPose(yaw, pitch) { s.yaw = yaw; if (pitch !== undefined) s.pitch = pitch; pose(); }, select(key) { s.eq = key; renderAll(); } },
        close() { s.closed = true; s.active = false; dropNode(); doc.unload(); },
    };
}
