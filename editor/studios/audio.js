// ===========================================================================
// Audio — студия Editor для `*.audio.json` (формат и gain — sdk/lib/kinds/audio.js).
//
// Центр — микшер: полоса на каждую шину с живой громкостью рантайма
// ($.audio.gain учитывает родителей, mute и solo), −/+ громкости, M/S и эффект;
// под ним — карта зон акустики (перетаскивание и угол-ручка размера).
// Снизу — транспорт звуков через настоящий `$.audio.play` в шину файла.
// Шины превью — под префиксом вкладки, чтобы не трогать шины Editor и игры.
// ===========================================================================

import * as K from '../lib/shared/kinds/audio.js';
import { createWorkspace, button } from '../lib/asset_workspace.js';
import { esc, FILTERS, pickProjectFile } from '../lib/studio_kit.js';

export const meta = { id: 'audio', title: 'Audio', icon: 'graphic_eq', match: (p) => /\.audio\.json$/i.test(p) };

const AUDIO_FILE = /\.(ogg|wav|mp3|flac)$/i;
const NAME_RE = /^[A-Za-z0-9_\-]{1,48}$/;
const MIXER_H = 230;   // высота микшера над картой зон, логические точки
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const FX_FIELDS = {
    lowpass: [{ key: 'freq', label: 'Срез, Гц', min: 0.1, default: 1200 }],
    highpass: [{ key: 'freq', label: 'Срез, Гц', min: 0.1, default: 200 }],
    echo: [{ key: 'delay', label: 'Задержка, мс', min: 0.1, default: 250 }, { key: 'feedback', label: 'Повтор 0..0.9', min: 0, max: 0.9, default: 0.35 }],
    tremolo: [{ key: 'rate', label: 'Частота, Гц', min: 0.01, max: 40, default: 5 }, { key: 'depth', label: 'Глубина 0..1', min: 0, max: 1, default: 0.5 }],
    bitcrush: [{ key: 'bits', label: 'Битность 1..16', int: true, min: 1, max: 16, default: 6 }, { key: 'downsample', label: 'Шаг 1..64', int: true, min: 1, max: 64, default: 1 }],
    ringmod: [{ key: 'freq', label: 'Частота, Гц', min: 0.5, max: 8000, default: 220 }, { key: 'mix', label: 'Смешивание 0..1', min: 0, max: 1, default: 1 }],
    reverb: [{ key: 'send', label: 'Посыл 0..1', min: 0, max: 1, default: 0.35 }, { key: 'room', label: 'Размер 0..1', min: 0, max: 1, default: 0.5 }, { key: 'damp', label: 'Демпфирование 0..1', min: 0, max: 1, default: 0.4 }, { key: 'width', label: 'Ширина 0..1', min: 0, max: 1, default: 0.8 }],
};

export function create(host) {
    const $ = host.$;
    const buses = (w) => (isObj(w.data.buses) ? w.data.buses : {});
    const sounds = (w) => (isObj(w.data.sounds) ? w.data.sounds : {});
    const zones = (w) => (Array.isArray(w.data.zones) ? w.data.zones : []);
    const pv = (w, n) => (n === 'master' || n === undefined ? n : '__editor_au' + w.doc.id + '_' + n);

    // Плоский список выбора: шины деревом, потом звуки, потом зоны.
    function entries(w) {
        const b = buses(w), out = [];
        const kids = (parent) => Object.keys(b).filter((n) => (b[n].parent || 'master') === parent);
        const walk = (name, depth) => { out.push({ type: 'bus', id: name, depth }); for (const c of kids(name)) walk(c, depth + 1); };
        const roots = kids('master').concat(Object.keys(b).filter((n) => (b[n].parent || 'master') !== 'master' && !isObj(b[b[n].parent])));
        for (const n of roots) walk(n, 0);
        for (const n of Object.keys(sounds(w))) out.push({ type: 'snd', id: n, depth: 0 });
        zones(w).forEach((z, i) => out.push({ type: 'zone', id: i, depth: 0 }));
        return out;
    }
    const sel = (w) => entries(w)[w.selected] || null;
    function selectEntry(w, type, id) {
        const i = entries(w).findIndex((e) => e.type === type && e.id === id);
        if (i >= 0) w.select(i);
    }
    function objOf(w, e) {
        if (!e) return null;
        return e.type === 'bus' ? buses(w)[e.id] : e.type === 'snd' ? sounds(w)[e.id] : zones(w)[e.id];
    }
    const uniq = (obj, base) => { let n = base, i = 1; while (obj[n]) n = base + (++i); return n; };

    function addBus(w, name) {
        const n = uniq(buses(w), name || 'bus');
        w.edit('Шина «' + n + '»', (m) => { m.buses = m.buses || {}; m.buses[n] = { volume: 1 }; });
        selectEntry(w, 'bus', n);
        return n;
    }
    function addSound(w, path, name) {
        const base = name || String(path || 'sound').split('/').pop().replace(AUDIO_FILE, '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 40) || 'sound';
        const n = uniq(sounds(w), base);
        w.edit('Звук «' + n + '»', (m) => { m.sounds = m.sounds || {}; m.sounds[n] = { path: path || 'assets/hit.ogg' }; });
        selectEntry(w, 'snd', n);
        return n;
    }
    function addZone(w) {
        let i = -1;
        w.edit('Зона', (m) => { m.zones = m.zones || []; m.zones.push({ name: 'zone' + m.zones.length, rect: [0, 0, 400, 300], height: 3, material: 'concrete' }); i = m.zones.length - 1; });
        if (i >= 0) selectEntry(w, 'zone', i);
        return i;
    }
    function removeSelected(w) {
        const e = sel(w);
        if (!e) return false;
        return w.edit('Удалить', (m) => {
            if (e.type === 'bus') {
                const gone = m.buses[e.id];
                delete m.buses[e.id];
                for (const b of Object.values(m.buses)) if (b.parent === e.id) { if (gone.parent) b.parent = gone.parent; else delete b.parent; }
                for (const s of Object.values(m.sounds || {})) if (s.bus === e.id) delete s.bus;
            } else if (e.type === 'snd') delete m.sounds[e.id];
            else m.zones.splice(e.id, 1);
        });
    }
    function renameKey(map, from, to) { const out = {}; for (const k of Object.keys(map)) out[k === from ? to : k] = map[k]; return out; }

    function fieldsOf(w) {
        const e = sel(w);
        if (!e) return [];
        if (e.type === 'bus') {
            const bus = buses(w)[e.id], fx = FX_FIELDS[bus && bus.effect];
            return [
                { key: '__name', label: 'Имя' },
                { key: 'volume', label: 'volume 0..1', number: true, optional: true },
                { key: 'parent', label: 'parent', options: ['master'].concat(Object.keys(buses(w)).filter((n) => n !== e.id)), optional: true },
                { key: 'muted', label: 'muted', bool: true, options: ['true', 'false'], optional: true },
                { key: 'solo', label: 'solo', bool: true, options: ['true', 'false'], optional: true },
                { key: 'effect', label: 'effect', options: K.EFFECTS, optional: true },
                ...(fx ? [{ key: 'effectParams', label: 'Параметры ' + bus.effect, group: fx.map((field) => Object.assign({ number: true }, field)) }] : []),
            ];
        }
        if (e.type === 'snd') return [
            { key: '__name', label: 'Имя' },
            { key: 'path', label: 'файл', file: { filters: FILTERS.audio } },
            { key: 'bus', label: 'шина', options: Object.keys(buses(w)), optional: true },
            { key: 'volume', label: 'volume 0..1', number: true, optional: true },
            { key: 'pitch', label: 'pitch', number: true, optional: true },
            { key: 'loop', label: 'loop', bool: true, options: ['true', 'false'], optional: true },
        ];
        return [
            { key: 'name', label: 'Имя' },
            { key: '__xy', label: 'x, y', pair: 'vec' },
            { key: '__wh', label: 'w, h', pair: 'vec' },
            { key: 'height', label: 'высота, м', number: true, optional: true },
            { key: 'material', label: 'материал', optional: true },
        ];
    }

    // --- Рантайм превью ----------------------------------------------------------
    function stopAll(w) {
        for (const h of Object.values(w.ext.handles)) { try { h.stop(50); } catch (_) { /* уже остановлен */ } }
        w.ext.handles = {};
    }
    function play(w, name) {
        const x = sounds(w)[name];
        if (!x) return false;
        const old = w.ext.handles[name];
        if (old) { try { old.stop(0); } catch (_) { /* уже остановлен */ } }
        const opts = { volume: x.volume === undefined ? 1 : x.volume, loop: !!x.loop };
        if (x.pitch !== undefined) opts.pitch = x.pitch;
        if (x.bus && buses(w)[x.bus]) opts.bus = pv(w, x.bus);
        const h = $.audio.play(w.path(x.path), opts);
        if (!h) { w.fail('SDK_AUDIO_PLAY', 'Рантайм не запустил «' + x.path + '»'); return false; }
        w.ext.handles[name] = h;
        w.render();
        return true;
    }
    function stop(w, name) {
        const h = w.ext.handles[name];
        if (h) { try { h.stop(80); } catch (_) { /* уже остановлен */ } delete w.ext.handles[name]; w.render(); }
    }

    // --- Микшер (RmlUi поверх холста) -------------------------------------------
    function mixer(w) {
        const b = buses(w), list = entries(w).filter((e) => e.type === 'bus'), cur = sel(w), k = $.window.pixels().w / $.window.size().w;
        if (!list.length) return '<div class="au-mixer" style="height:' + Math.round(MIXER_H * k) + 'px;"><span class="st-empty">Шин нет — «+ Шина».</span></div>';
        return '<div class="au-mixer" style="height:' + Math.round(MIXER_H * k) + 'px;">' + list.map((e) => {
            const x = b[e.id], g = w.ext.gains[e.id] === undefined ? K.gain(b, e.id) : w.ext.gains[e.id];
            const on = cur && cur.type === 'bus' && cur.id === e.id;
            return '<div class="au-strip' + (on ? ' on' : '') + '" data-key="pick:bus:' + esc(e.id) + '">' +
                '<span class="au-name">' + esc(e.id) + '</span><span class="au-parent">' + esc(x.parent || 'master') + '</span>' +
                '<div class="au-meter"><div class="au-fill" style="height:' + Math.round(Math.max(0, Math.min(1, g)) * 100) + '%;"></div></div>' +
                '<span class="au-val">' + (x.volume === undefined ? 1 : x.volume).toFixed(2) + ' · ' + g.toFixed(2) + '</span>' +
                '<div class="au-row">' + button('vol:-:' + e.id, '-') + button('vol:+:' + e.id, '+') + '</div>' +
                '<div class="au-row">' + button('mute:' + e.id, 'M', !!x.muted) + button('solo:' + e.id, 'S', !!x.solo) + '</div>' +
                '<span class="au-fx">' + esc(x.effect && x.effect !== 'none' ? x.effect : '') + '</span></div>';
        }).join('') + '</div>';
    }

    function bottom(w) {
        const list = Object.keys(sounds(w)), cur = sel(w);
        let html = '<div class="au-bottom"><div class="st-bar"><span class="st-label">Звуки</span>' + button('stopall', 'Остановить всё') + '</div><div class="au-sounds">';
        html += list.length ? list.map((n) => {
            const x = sounds(w)[n], on = cur && cur.type === 'snd' && cur.id === n, h = w.ext.handles[n], playing = !!(h && h.playing && h.playing());
            return '<div class="st-row' + (on ? ' sel' : '') + '" data-key="pick:snd:' + esc(n) + '">' + esc(n) + '<span class="st-sub">' + esc(String(x.path || '').split('/').pop()) + (x.bus ? ' > ' + esc(x.bus) : '') + (x.loop ? ' · loop' : '') + '</span>' +
                '<span class="au-tx">' + button('play:' + n, playing ? 'Ещё раз' : 'Играть', playing) + button('stop:' + n, 'Стоп') + '</span></div>';
        }).join('') : '<span class="st-empty">Звуков нет — «+ Звук» или файл из библиотеки.</span>';
        return html + '</div></div>';
    }

    // --- Зоны: карта под микшером ----------------------------------------------
    function zoneMap(w) {
        const r = w.rect(), list = zones(w);
        if (!r || !list.length) return null;
        const area = { x: r.x + 16, y: r.y + MIXER_H + 10, w: r.w - 32, h: r.h - MIXER_H - 26 };
        if (area.w < 40 || area.h < 40) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const z of list) if (Array.isArray(z.rect)) { x0 = Math.min(x0, z.rect[0]); y0 = Math.min(y0, z.rect[1]); x1 = Math.max(x1, z.rect[0] + z.rect[2]); y1 = Math.max(y1, z.rect[1] + z.rect[3]); }
        if (!Number.isFinite(x0)) return null;
        if (!w.ext.zoneFrame || !w.ext.zoneDrag) w.ext.zoneFrame = { x0, y0, x1, y1 };   // во время протяжки масштаб не прыгает
        const f = w.ext.zoneFrame, k = Math.min(area.w / Math.max(1, f.x1 - f.x0), area.h / Math.max(1, f.y1 - f.y0)) * 0.9;
        return { area, k, ox: area.x + (area.w - (f.x1 - f.x0) * k) / 2 - f.x0 * k, oy: area.y + (area.h - (f.y1 - f.y0) * k) / 2 - f.y0 * k };
    }
    const toMap = (m, x, y) => ({ x: m.ox + x * m.k, y: m.oy + y * m.k });
    const fromMap = (m, x, y) => ({ x: (x - m.ox) / m.k, y: (y - m.oy) / m.k });

    function zonesInput(w) {
        const map = zoneMap(w), e = w.ext;
        if (!map) return;
        const mouse = $.input.mouse(), world = fromMap(map, mouse.x, mouse.y), inArea = mouse.x >= map.area.x && mouse.x <= map.area.x + map.area.w && mouse.y >= map.area.y && mouse.y <= map.area.y + map.area.h;
        if ($.input.mousePressed('left') && inArea && !host.typing() && !w.file.state.busy) {
            const list = zones(w);
            const cur = sel(w), ci = cur && cur.type === 'zone' ? cur.id : -1;
            if (ci >= 0) {
                const z = list[ci], c = toMap(map, z.rect[0] + z.rect[2], z.rect[1] + z.rect[3]);
                if (Math.hypot(c.x - mouse.x, c.y - mouse.y) <= 8) { e.zoneDrag = { i: ci, mode: 'size', start: clone(z.rect), moved: false }; return; }
            }
            for (let i = list.length - 1; i >= 0; i--) {
                const r = list[i].rect;
                if (world.x >= r[0] && world.x <= r[0] + r[2] && world.y >= r[1] && world.y <= r[1] + r[3]) {
                    if (i !== ci) selectEntry(w, 'zone', i);
                    e.zoneDrag = { i, mode: 'move', dx: world.x - r[0], dy: world.y - r[1], start: clone(r), moved: false };
                    return;
                }
            }
        }
        const d = e.zoneDrag;
        if (!d) return;
        const z = zones(w)[d.i];
        if ($.input.mouseDown('left') && z) {
            if (d.mode === 'move') {
                const nx = Math.round(world.x - d.dx), ny = Math.round(world.y - d.dy);
                if (nx !== z.rect[0] || ny !== z.rect[1]) { z.rect[0] = nx; z.rect[1] = ny; d.moved = true; }
            } else {
                const nw = Math.max(1, Math.round(world.x - z.rect[0])), nh = Math.max(1, Math.round(world.y - z.rect[1]));
                if (nw !== z.rect[2] || nh !== z.rect[3]) { z.rect[2] = nw; z.rect[3] = nh; d.moved = true; }
            }
            return;
        }
        e.zoneDrag = null;
        if (d.moved && z) {
            const end = z.rect.slice();
            z.rect = d.start;
            w.edit(d.mode === 'move' ? 'Сдвиг зоны' : 'Размер зоны', (m) => { m.zones[d.i].rect = end; });
        }
    }

    function drawZones(w) {
        const map = zoneMap(w);
        if (!map) return;
        const cur = sel(w), a = map.area;
        $.gfx.draw.line(a.x, a.y - 4, a.x + a.w, a.y - 4, 'rgba(255,255,255,0.08)', 1);
        zones(w).forEach((z, i) => {
            if (!Array.isArray(z.rect)) return;
            const on = cur && cur.type === 'zone' && cur.id === i, p = toMap(map, z.rect[0], z.rect[1]), zw = z.rect[2] * map.k, zh = z.rect[3] * map.k;
            const c = on ? '#ff5a3c' : '#6cc7ff';
            $.gfx.draw.rect(p.x, p.y, zw, zh, on ? 'rgba(255,90,60,0.18)' : 'rgba(108,199,255,0.14)');
            $.gfx.draw.line(p.x, p.y, p.x + zw, p.y, c, 1); $.gfx.draw.line(p.x + zw, p.y, p.x + zw, p.y + zh, c, 1);
            $.gfx.draw.line(p.x + zw, p.y + zh, p.x, p.y + zh, c, 1); $.gfx.draw.line(p.x, p.y + zh, p.x, p.y, c, 1);
            if (on) $.gfx.draw.rect(p.x + zw - 4, p.y + zh - 4, 8, 8, '#ffffff');
        });
    }

    const def = {
        kind: K, title: 'Audio', listTitle: 'Шины · звуки · зоны',
        init(w) {
            Object.assign(w.ext, { handles: {}, created: [], gains: {}, files: null, zoneDrag: null, zoneFrame: null, tick: 0 });
            w.doc.cls('aw-bottom', 'au-bottom-host', true);
            host.backend(['assets', host.root()]).then((r) => {
                const list = r.json && Array.isArray(r.json.entries) ? r.json.entries : [];
                w.ext.files = list.map((x) => x.path).filter((p) => AUDIO_FILE.test(p)).sort();
                w.render();
            }).catch(() => { w.ext.files = []; w.render(); });
        },
        items: (w) => entries(w).map((e) => {
            const o = objOf(w, e) || {};
            if (e.type === 'bus') return { label: '. '.repeat(e.depth) + e.id, detail: 'шина · ' + (o.volume === undefined ? 1 : o.volume) + (o.muted ? ' · mute' : '') + (o.solo ? ' · solo' : '') };
            if (e.type === 'snd') return { label: e.id, detail: 'звук · ' + String(o.path || '').split('/').pop() };
            return { label: o.name || 'зона ' + e.id, detail: 'зона · ' + (o.material || '—') };
        }),
        target: (w) => objOf(w, sel(w)),
        fields: fieldsOf,
        selected(w) {
            const e = sel(w), o = objOf(w, e);
            if (!e || !o) return;
            if (e.type !== 'zone') w.doc.setValue('f-__name', e.id);
            else if (Array.isArray(o.rect)) {
                w.doc.setValue('f-__xy-0', o.rect[0]); w.doc.setValue('f-__xy-1', o.rect[1]);
                w.doc.setValue('f-__wh-0', o.rect[2]); w.doc.setValue('f-__wh-1', o.rect[3]);
            }
        },
        apply(w, m, patch) {
            const e = sel(w);
            if (!e) return;
            if (e.type === 'zone') {
                const z = m.zones[e.id], xy = patch.__xy, wh = patch.__wh;
                delete patch.__xy; delete patch.__wh;
                if (!(wh[0] > 0 && wh[1] > 0)) throw new Error('w и h зоны > 0');
                w.patch(z, patch);
                z.rect = [xy[0], xy[1], wh[0], wh[1]];
                return;
            }
            const to = String(patch.__name || '').trim();
            delete patch.__name;
            if (e.type === 'bus') {
                const effectParams = patch.effectParams;
                delete patch.effectParams;
                if (patch.parent === 'master') delete patch.parent;
                w.patch(m.buses[e.id], patch);
                if (effectParams) {
                    const params = Object.assign({}, m.buses[e.id].effectParams || {});
                    for (const [k, v] of Object.entries(effectParams)) { if (v === undefined) delete params[k]; else params[k] = v; }
                    if (Object.keys(params).length) m.buses[e.id].effectParams = params;
                    else delete m.buses[e.id].effectParams;
                }
                if (to && to !== e.id) {
                    if (!NAME_RE.test(to) || to === 'master') throw new Error('Имя шины: латиница, цифры, «_», «-», не «master»');
                    if (m.buses[to]) throw new Error('Шина «' + to + '» уже есть');
                    for (const b of Object.values(m.buses)) if (b.parent === e.id) b.parent = to;
                    for (const s of Object.values(m.sounds || {})) if (s.bus === e.id) s.bus = to;
                    m.buses = renameKey(m.buses, e.id, to);
                    w.ext.pending = { type: 'bus', id: to };
                }
            } else {
                w.patch(m.sounds[e.id], patch);
                if (to && to !== e.id) {
                    if (!NAME_RE.test(to)) throw new Error('Имя звука: латиница, цифры, «_», «-»');
                    if (m.sounds[to]) throw new Error('Звук «' + to + '» уже есть');
                    m.sounds = renameKey(m.sounds, e.id, to);
                    w.ext.pending = { type: 'snd', id: to };
                }
            }
        },
        tools: () => button('add:bus', '+ Шина') + button('add:snd', '+ Звук') + button('add:zone', '+ Зона') + button('del', 'Удалить'),
        library(w) {
            const e = w.ext;
            let html = '<span class="st-h">Аудиофайлы проекта</span>' + button('snd:pick', '+ Звук из файла…');
            if (e.files === null) html += '<span class="st-note">Читаю r2d assets…</span>';
            else if (!e.files.length) html += '<span class="st-note">В проекте нет .ogg/.wav/.mp3/.flac.</span>';
            else html += e.files.map((p) => '<div class="st-row" data-key="file:' + esc(p) + '">+ ' + esc(p.split('/').pop()) + '<span class="st-sub">' + esc(p) + '</span></div>').join('') +
                '<span class="st-note">Клик — новый звук с этим файлом.</span>';
            return html + '<span class="st-h">В игре</span><div class="pt-code">' + esc(K.snippet(String(w.file.state.path).split('/').pop())) + '</div>';
        },
        content: mixer,
        bottom,
        action(w, key) {
            if (key === 'add:bus') addBus(w);
            else if (key === 'add:snd') addSound(w);
            else if (key === 'add:zone') addZone(w);
            else if (key === 'del') removeSelected(w);
            else if (key === 'stopall') { stopAll(w); w.render(); }
            else if (key.startsWith('file:')) addSound(w, key.slice(5));
            else if (key === 'snd:pick') pickProjectFile(w.$, w.host.root(), { title: 'Выберите звук', filters: FILTERS.audio }).then((r) => {
                if (r.error) w.fail('EDITOR_ASSET_FILE', r.error); else if (r.rel) addSound(w, r.rel);
            });
            else if (key.startsWith('pick:')) { const [, type, ...rest] = key.split(':'); selectEntry(w, type, rest.join(':')); }
            else if (key.startsWith('play:')) play(w, key.slice(5));
            else if (key.startsWith('stop:')) stop(w, key.slice(5));
            else if (key.startsWith('vol:')) {
                const [, dir, ...rest] = key.split(':'), n = rest.join(':'), b = buses(w)[n];
                if (!b) return;
                const v = Math.round(Math.max(0, Math.min(1, (b.volume === undefined ? 1 : b.volume) + (dir === '+' ? 0.05 : -0.05))) * 100) / 100;
                w.edit('Громкость «' + n + '»', (m) => { m.buses[n].volume = v; });
            } else if (key.startsWith('mute:') || key.startsWith('solo:')) {
                const f = key.startsWith('mute:') ? 'muted' : 'solo', n = key.slice(5);
                if (buses(w)[n]) w.edit(f + ' «' + n + '»', (m) => { if (m.buses[n][f]) delete m.buses[n][f]; else m.buses[n][f] = true; });
            }
        },
        // Шины превью — под префиксом вкладки; звуки, что играют, остаются в своих шинах.
        preview(w) {
            const e = w.ext, b = buses(w);
            if (e.pending) { selectEntry(w, e.pending.type, e.pending.id); e.pending = null; }
            for (const n of e.created) $.audio.remove(n);
            e.created = [];
            // Родитель раньше ребёнка: обход дерева из entries.
            for (const en of entries(w).filter((x) => x.type === 'bus')) {
                try {
                    const spec = clone(b[en.id]);
                    if (spec.parent && spec.parent !== 'master') spec.parent = pv(w, spec.parent);
                    $.audio.bus(pv(w, en.id), spec);
                    e.created.push(pv(w, en.id));
                } catch (err) { w.fail('SDK_AUDIO_RUNTIME', 'Шина «' + en.id + '»: ' + (err && err.message ? err.message : err)); }
            }
        },
        release() {},
        deactivate(w) { stopAll(w); w.ext.zoneDrag = null; for (const n of w.ext.created) $.audio.remove(n); w.ext.created = []; },
        update(w) {
            const e = w.ext;
            zonesInput(w);
            drawZones(w);
            // Живые уровни шин (gain рантайма с mute/solo) и состояние звуков — раз в 6 кадров.
            if (++e.tick % 6 === 0) {
                let changed = false;
                for (const n of Object.keys(buses(w))) {
                    const g = e.created.includes(pv(w, n)) ? $.audio.gain(pv(w, n)) : K.gain(buses(w), n);
                    if (Math.abs((e.gains[n] === undefined ? -1 : e.gains[n]) - g) > 1e-4) { e.gains[n] = g; changed = true; }
                }
                for (const [n, h] of Object.entries(e.handles)) if (h.playing && !h.playing()) { delete e.handles[n]; changed = true; }
                if (changed) w.render();
            }
        },
        hud: (w) => K.summary(w.data) + ' · играет ' + Object.keys(w.ext.handles).length + (zones(w).length ? ' · зоны: тяните прямоугольник, угол — размер' : ''),
        ops: (w) => ({
            addBus: (name) => addBus(w, name),
            addSound: (path, name) => addSound(w, path, name),
            addZone: () => addZone(w),
            selectEntry: (type, id) => { selectEntry(w, type, id); return sel(w); },
            play: (name) => play(w, name),
            stop: (name) => stop(w, name),
            gain: (name) => $.audio.gain(pv(w, name)),
            playing: () => Object.keys(w.ext.handles),
            zonePoint: (x, y) => { const m = zoneMap(w); return m ? toMap(m, x, y) : null; },
            files: () => w.ext.files,
        }),
        snapshot: (w) => ({ buses: Object.keys(buses(w)).length, sounds: Object.keys(sounds(w)).length, zones: zones(w).length, runtimeBuses: w.ext.created.length, playing: Object.keys(w.ext.handles).length }),
    };
    const ws = createWorkspace(host, def);
    // Закрытие вкладки: остановить звуки и убрать шины превью, даже если вкладка не активна.
    const close = ws.close;
    ws.close = () => { def.deactivate(ws.state); close(); };
    return ws;
}
