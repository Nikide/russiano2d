// ===========================================================================
// Re2DSprite Studio — вкладка Editor для *.character.json (docs/RE2DSPRITE_JSON.md).
//
// Превью — настоящий runtime: узел $.re2dSprite.from(описание) во вьюпорте,
// поза/клипы/слои/варианты/экипировка/видимость частей — публичные методы
// .re2d*. Своего синтеза, разбора PNG или второй модели здесь нет. Правится
// только описание персонажа (style, projection, defaults.motion), запись — тот
// же character.json, после неё — .re2dReload().
// ===========================================================================

const DOC = 'ui/re2dsprite.rml';
let current = null;

export const standalone = false;

export async function open(app, args) {
    if (!current) current = create(app);
    return current.open(args.assetAbs || args.asset);
}

const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function create(app) {
    const $ = app.$;
    const doc = $.ui.doc(DOC);
    const s = {
        active: false, path: '', text: '', json: null, node: null, items: new Map(),
        yaw: 30, pitch: 0, style: 'anime', motion: '', speed: 1, playing: true,
        layers: new Set(), turntable: false, clips: {}, error: '', dirty: false,
        hidden: new Set(), drag: null, emotion: '', variants: {}, status: '',
        placed: '',
    };

    const dirOf = (p) => p.replace(/[^/]*$/, '');
    function note(text) { s.status = text; doc.text('rs-status', esc(text)); }
    function fail(message) { s.error = String(message); note('ошибка: ' + s.error); renderAll(); }

    // --- загрузка -------------------------------------------------------------

    function readClips() {
        s.clips = {};
        const a = s.json && s.json.animations;
        let data = null;
        if (typeof a === 'string') data = $.fs.readJSON(dirOf(s.path) + a, null);
        else if (a && typeof a === 'object') data = a;
        for (const [name, clip] of Object.entries((data && data.clips) || {})) {
            s.clips[name] = { duration: Number(clip.duration) || 1, loop: clip.loop !== false, skin: !!clip.skin };
        }
    }

    function dropNode() {
        for (const item of s.items.values()) { try { item.re2dDetach(); item.remove(); } catch (e) { /* уже удалён */ } }
        s.items.clear();
        if (s.node) { try { s.node.remove(); } catch (e) { /* уже удалён */ } }
        s.node = null;
    }

    function load(path) {
        s.path = path;
        s.error = '';
        s.text = $.fs.readText(path);
        if (s.text === null || s.text === undefined) { fail('не удалось прочитать ' + path); return false; }
        try { s.json = JSON.parse(s.text); } catch (e) { fail('character.json не разбирается: ' + e.message); return false; }
        readClips();
        dropNode();
        try {
            // Путь абсолютный: пути внутри описания считаются от его каталога.
            s.node = $.re2dSprite.from(path, { id: 'editor-re2dsprite-preview' });
        } catch (e) { fail(e && e.message ? e.message : String(e)); return false; }
        s.style = s.json.style || 'anime';
        s.motion = (s.json.defaults && s.json.defaults.motion) || Object.keys(s.clips)[0] || '';
        s.layers.clear(); s.hidden.clear(); s.variants = {}; s.emotion = '';
        s.dirty = false;
        try {
            s.node.re2dStyle(s.style);
            if (s.motion) s.node.re2dMotion(s.motion, s.speed);
        } catch (e) { s.error = e.message || String(e); }
        s.placed = '';
        note('загружено: ' + path.split('/').pop());
        return true;
    }

    // --- вьюпорт ------------------------------------------------------------------

    function scale() { const px = $.window.pixels(), pt = $.window.size(); return pt && pt.w ? px.w / pt.w : 1; }

    function place() {
        if (!s.node) return;
        const r = doc.rect('rs-view');
        if (!r || r.w <= 0) return;
        const k = scale();
        const key = [r.x, r.y, r.w, r.h, k].join(',');
        if (key === s.placed) return;
        s.placed = key;
        // Камера Editor: мир = экран (как у Hammer), поэтому узел ставится в
        // центр вьюпорта в логических точках.
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);
        const side = Math.max(32, Math.min(r.w, r.h) / k * 0.92);
        s.node.at((r.x + r.w / 2) / k, (r.y + r.h / 2) / k).size(side, side);
    }

    function pose() {
        if (!s.node) return;
        try { s.node.re2dPose(s.yaw, s.pitch); } catch (e) { s.error = e.message || String(e); }
        doc.text('rs-pose', 'yaw ' + Math.round(s.yaw) + '° · pitch ' + Math.round(s.pitch) + '°');
    }

    // --- действия -------------------------------------------------------------------

    function play(name) {
        if (!s.node || !s.clips[name]) return false;
        s.motion = name; s.playing = true;
        s.node.re2dMotion(name, s.speed);
        renderAnim();
        return true;
    }
    function pause(on) {
        if (!s.node || !s.motion) return;
        s.playing = !on;
        s.node.re2dMotion(s.motion, s.playing ? s.speed : 0);
        renderAnim();
    }
    function seek(fraction) {
        const clip = s.clips[s.motion];
        if (!s.node || !clip) return;
        s.node.re2dSeek(Math.max(0, Math.min(1, fraction)) * clip.duration);
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
        try { s.node.re2dEmotion(name); s.emotion = name; } catch (e) { s.error = e.message; }
        renderSide();
    }
    function variant(group, key) {
        if (!s.node) return;
        try { s.node.re2dVariant(group, key); s.variants[group] = key; } catch (e) { s.error = e.message; }
        renderSide();
    }
    function equip(key) {
        if (!s.node) return;
        const eq = (s.json.equipment || {})[key] || {};
        if (s.items.has(key)) {
            const item = s.items.get(key);
            try { item.re2dDetach(); item.remove(); } catch (e) { /* уже удалён */ }
            s.items.delete(key);
            if (eq.pose && s.layers.has(eq.pose)) layer(eq.pose);
        } else {
            try {
                const item = $.re2dSprite.equip(s.node, key, { id: 'editor-re2dsprite-item-' + key });
                item.re2dStyle(s.style);
                s.items.set(key, item);
                // Клип удержания equip не включает сам (RE2DSPRITE_JSON.md).
                if (eq.pose && !s.layers.has(eq.pose)) layer(eq.pose);
            } catch (e) { s.error = e.message || String(e); }
        }
        renderSide();
    }
    function togglePart(id) {
        if (!s.node) return;
        if (s.hidden.has(id)) s.hidden.delete(id); else s.hidden.add(id);
        const parts = ((s.json.rig || {}).parts || []).map((p) => p.id);
        try { s.node.re2dVisibleParts(s.hidden.size ? parts.filter((p) => !s.hidden.has(p)) : null); } catch (e) { s.error = e.message; }
        renderSide();
    }
    function setStyle(style) {
        if (!s.node || (style !== 'anime' && style !== 'pixel')) return;
        s.style = style;
        try { s.node.re2dStyle(style); for (const item of s.items.values()) item.re2dStyle(style); } catch (e) { s.error = e.message; }
        renderTop();
    }

    // Применить поля инспектора к описанию (в памяти; запись — save()).
    function applyFields() {
        if (!s.json) return false;
        const num = (id) => { const v = Number(doc.value(id)); return Number.isFinite(v) ? v : null; };
        const next = JSON.parse(JSON.stringify(s.json));
        next.style = String(doc.value('rs-f-style') || s.json.style || 'anime');
        const proj = Object.assign({}, next.projection || {});
        for (const [id, key] of [['rs-f-raster', 'raster'], ['rs-f-body', 'bodyScale'], ['rs-f-portrait', 'portraitScale'], ['rs-f-detail', 'detail']]) {
            const raw = String(doc.value(id) || '').trim();
            if (raw === '') delete proj[key];
            else { const v = num(id); if (v === null) { fail('поле ' + key + ': нужно число'); return false; } proj[key] = v; }
        }
        if (Object.keys(proj).length) next.projection = proj; else delete next.projection;
        const motion = String(doc.value('rs-f-motion') || '').trim();
        next.defaults = Object.assign({}, next.defaults || {});
        if (motion) next.defaults.motion = motion; else delete next.defaults.motion;
        if (JSON.stringify(next) === JSON.stringify(s.json)) { note('без изменений'); return false; }
        s.json = next; s.dirty = true;
        note('изменено — Save запишет character.json');
        renderAll();
        return true;
    }

    function save() {
        if (!s.json) return false;
        if (doc.value('rs-f-style') !== null) applyFields();
        if (!s.dirty) { note('нечего сохранять'); return false; }
        if ($.fs.write(s.path, JSON.stringify(s.json, null, 2) + '\n') === false) { fail('не удалось записать ' + s.path); return false; }
        s.dirty = false;
        try { s.node.re2dReload(); s.error = ''; } catch (e) { s.error = 'reload: ' + (e.message || e); }
        readClips();
        note('сохранено и перезагружено');
        renderAll();
        return true;
    }

    function reload() {
        if (!s.node) return load(s.path);
        try { s.node.re2dReload(); s.error = ''; note('перезагружено с диска'); } catch (e) { fail('reload: ' + (e.message || e)); }
        readClips();
        renderAll();
        return true;
    }

    // --- отрисовка ------------------------------------------------------------------

    function renderTop() {
        doc.cls('rs-style-anime', 'on', s.style === 'anime');
        doc.cls('rs-style-pixel', 'on', s.style === 'pixel');
        doc.cls('rs-turntable', 'on', s.turntable);
        doc.text('rs-dirty', s.dirty ? 'не сохранено' : '');
        doc.text('rs-status', esc(s.error ? 'ошибка: ' + s.error : s.status));
        doc.cls('rs-status', 'fail', !!s.error);
    }

    function renderAnim() {
        const names = Object.keys(s.clips);
        doc.html('rs-clips', names.length ? names.map((n) => '<button class="hm-btn' + (n === s.motion ? ' on' : '') + '" data-key="' + esc(n) + '">' + esc(n) + '</button>').join('')
            : '<span class="hm-label">в описании нет клипов</span>');
        doc.html('rs-layers', names.map((n) => '<button class="hm-btn rs-layer' + (s.layers.has(n) ? ' on' : '') + '" data-key="' + esc(n) + '">' + esc(n) + '</button>').join(''));
        doc.text('rs-playpause', s.playing ? 'Pause' : 'Play');
    }

    function list(id, items, render) {
        doc.html(id, items.length ? items.map(render).join('') : '<span class="hm-label">нет</span>');
    }

    function renderSide() {
        const j = s.json || {}, rig = j.rig || {};
        let info = s.node ? $.re2dSprite.info(s.node) : null;
        doc.html('rs-source',
            row('Описание', s.path.split('/').pop()) + row('Atlas', j.atlas || '—') +
            row('Анимации', typeof j.animations === 'string' ? j.animations : j.animations ? 'встроены' : '—') +
            row('Версия PNG', info ? String(info.version) : '—') +
            row('Кадр', info ? info.width + '×' + info.height : '—') +
            row('Кости / части', (rig.bones || []).length + ' / ' + (rig.parts || []).length));
        list('rs-emotions', Object.keys(j.emotions || {}), (n) => '<button class="hm-btn' + (n === s.emotion ? ' on' : '') + '" data-key="' + esc(n) + '">' + esc(n) + '</button>');
        const groups = Object.entries(j.variants || {});
        doc.html('rs-variants', groups.length ? groups.map(([g, keys]) => '<div class="rs-group"><span class="hm-label">' + esc(g) + '</span>' +
            Object.keys(keys).map((k) => '<button class="hm-btn' + (s.variants[g] === k ? ' on' : '') + '" data-key="' + esc(g + '\u0001' + k) + '">' + esc(k) + '</button>').join('') + '</div>').join('')
            : '<span class="hm-label">нет вариантов</span>');
        list('rs-equipment', Object.keys(j.equipment || {}), (n) => '<button class="hm-btn' + (s.items.has(n) ? ' on' : '') + '" data-key="' + esc(n) + '" title="сокет ' + esc((j.equipment[n] || {}).socket || '') + '">' + esc(n) + '</button>');
        list('rs-parts', (rig.parts || []), (p) => '<div class="rs-row' + (s.hidden.has(p.id) ? ' off' : '') + '" data-key="' + p.id + '">' +
            '<span class="rs-eye">' + ($.ui.icon(s.hidden.has(p.id) ? 'visibility_off' : 'visibility') || '') + '</span>#' + p.id + ' <span class="hm-label">' + esc(p.bone) + (p.selector ? ' · ' + esc(p.selector) : '') + '</span></div>');
        const depth = (b) => { let d = 0, cur = b; const byName = new Map((rig.bones || []).map((x) => [x.name, x])); while (cur && cur.parent && d < 16) { d++; cur = byName.get(cur.parent); } return d; };
        list('rs-bones', (rig.bones || []), (b) => '<div class="rs-row" style="padding-left: ' + (4 + depth(b) * 12) + 'px;">' + esc(b.name) + '</div>');
        list('rs-sockets', (rig.sockets || []), (k) => '<div class="rs-row">' + esc(k.name) + ' <span class="hm-label">' + esc(k.bone) + '</span></div>');
        // Поля описания
        const proj = j.projection || {};
        doc.setValue('rs-f-style', j.style || 'anime');
        doc.setValue('rs-f-raster', proj.raster !== undefined ? String(proj.raster) : '');
        doc.setValue('rs-f-body', proj.bodyScale !== undefined ? String(proj.bodyScale) : '');
        doc.setValue('rs-f-portrait', proj.portraitScale !== undefined ? String(proj.portraitScale) : '');
        doc.setValue('rs-f-detail', proj.detail !== undefined ? String(proj.detail) : '');
        doc.setValue('rs-f-motion', (j.defaults && j.defaults.motion) || '');
        void info;
    }

    function row(label, value) { return '<div class="hm-field"><label>' + esc(label) + '</label><span class="rs-val">' + esc(value) + '</span></div>'; }

    function renderAll() { renderTop(); renderAnim(); renderSide(); pose(); }

    // --- события --------------------------------------------------------------------

    function wire() {
        doc.on('rs-save', 'click', save);
        doc.on('rs-reload', 'click', reload);
        doc.on('rs-apply', 'click', applyFields);
        doc.on('rs-style-anime', 'click', () => setStyle('anime'));
        doc.on('rs-style-pixel', 'click', () => setStyle('pixel'));
        doc.on('rs-turntable', 'click', () => { s.turntable = !s.turntable; renderTop(); });
        doc.on('rs-front', 'click', () => { s.yaw = 0; s.pitch = 0; pose(); });
        doc.on('rs-side', 'click', () => { s.yaw = 90; s.pitch = 0; pose(); });
        doc.on('rs-back', 'click', () => { s.yaw = 180; s.pitch = 0; pose(); });
        doc.on('rs-three', 'click', () => { s.yaw = 30; s.pitch = 8; pose(); });
        doc.on('rs-playpause', 'click', () => pause(s.playing));
        doc.on('rs-clips', 'click', (id, ev, key) => { if (key) play(key); });
        doc.on('rs-layers', 'click', (id, ev, key) => { if (key) layer(key); });
        doc.on('rs-emotions', 'click', (id, ev, key) => { if (key) emotion(key); });
        doc.on('rs-variants', 'click', (id, ev, key) => { if (key) { const [g, k] = key.split('\u0001'); variant(g, k); } });
        doc.on('rs-equipment', 'click', (id, ev, key) => { if (key) equip(key); });
        doc.on('rs-parts', 'click', (id, ev, key) => { if (key) togglePart(Number(key)); });
        doc.on('rs-timeline', 'mousedown', () => {
            const r = doc.rect('rs-timeline'), m = $.input.mouse(), k = scale();
            if (r && r.w > 0) seek((m.x * k - r.x) / r.w);
        });
        doc.on('rs-view', 'mousedown', () => { const m = $.input.mouse(); s.drag = { x: m.x, y: m.y }; s.turntable = false; renderTop(); });
    }

    // --- кадр -------------------------------------------------------------------------

    $.update((dt) => {
        if (!s.active || !s.node) return;
        place();
        if (s.drag) {
            const m = $.input.mouse();
            if ($.input.mouseDown('left')) {
                s.yaw = ((s.yaw + (m.x - s.drag.x) * 0.6 + 540) % 360) - 180;
                s.pitch = Math.max(-75, Math.min(75, s.pitch - (m.y - s.drag.y) * 0.4));
                s.drag = { x: m.x, y: m.y };
                pose();
            } else s.drag = null;
        }
        if (s.turntable) { s.yaw = ((s.yaw + 40 * dt + 540) % 360) - 180; pose(); }
        // Таймлайн: время основного клипа из info().
        const clip = s.clips[s.motion];
        if (clip) {
            const info = $.re2dSprite.info(s.node);
            const t = info && Number.isFinite(info.animationTime) ? info.animationTime : 0;
            const f = clip.duration > 0 ? (clip.loop ? (t % clip.duration) / clip.duration : Math.min(1, t / clip.duration)) : 0;
            doc.style('rs-playhead', 'width', (f * 100).toFixed(2) + '%');
            doc.text('rs-time', t.toFixed(2) + ' / ' + clip.duration.toFixed(2) + ' c');
        }
        if ($.input.ctrlDown() || $.input.down('cmd')) { if ($.input.pressed('s')) save(); }
    });

    wire();

    const api = {
        state: s,
        async open(path) {
            if (!path) throw new Error('Re2DSprite: нужен *.character.json');
            s.active = true;
            doc.show();
            if (path !== s.path || !s.node) load(path);
            renderAll();
            return { id: 're2dsprite-studio', studio: api };
        },
        render() { s.placed = ''; if (s.node) s.node.show(); renderAll(); },
        close() { s.active = false; dropNode(); doc.hide(); s.path = ''; return true; },
        // Хук Editor: вкладка ушла/вернулась — узел превью живёт в мире,
        // поэтому скрывается вместе с документом.
        onActive(on) { if (s.node) { if (on) { s.node.show(); s.placed = ''; } else s.node.hide(); } },
        play, seek, layer, emotion, variant, equip, togglePart, setStyle, applyFields, save, reload,
        setPose(yaw, pitch) { s.yaw = yaw; s.pitch = pitch === undefined ? s.pitch : pitch; pose(); },
        snapshot() {
            return { asset: s.path, dirty: s.dirty, style: s.style, motion: s.motion, playing: s.playing,
                     layers: [...s.layers], yaw: s.yaw, pitch: s.pitch, equipped: [...s.items.keys()],
                     hiddenParts: [...s.hidden], clips: Object.keys(s.clips), error: s.error };
        },
        diagnostics() { return s.error ? [{ code: 'R2D_RE2DSPRITE', severity: 'error', asset: s.path, location: null, message: s.error }] : []; },
    };
    return api;
}
