// ===========================================================================
// Audio Tools — шины, звуки и зоны акустики `$.audio` (формат `*.audio.json`,
// sdk/lib/kinds/audio.js). Прослушивание — настоящий звуковой слой движка:
// шины создаёт `$.audio.bus`, звуки играет `$.audio.play`, зоны — `$.audio.zone`.
// Имена в рантайме SDK получают префикс «sdkpv-», чтобы не пересекаться с игрой.
// ===========================================================================

import { openStudio } from '../lib/studio_host.js';
import * as K from '../lib/kinds/audio.js';
import { escapeHtml, joinPath } from '../lib/model.js';
import { button, fieldRow, pairRow, parseNum, isObj } from '../lib/kit.js';
import { projectRoot } from './tilemap-studio.js';

export const standalone = true;

const PV = 'sdkpv-';
const abs = (h, p) => (/^([A-Za-z]:[\\/]|\/)/.test(p) ? p : joinPath(projectRoot(h.app, h.session.path), p));
const pv = (n) => (n === 'master' || n === undefined ? n : PV + n);

/** Выбор — строка «bus:имя», «snd:имя» или «zone:индекс». */
function sel(h) {
    const k = h.ext.selKey;
    if (!k) return null;
    const i = k.indexOf(':');
    return { type: k.slice(0, i), id: k.slice(i + 1) };
}

function mount(h) {
    unmount(h);
    const $ = h.$, e = h.ext, m = h.model;
    e.created = []; e.zones = [];
    const buses = isObj(m.buses) ? m.buses : {};
    for (const name of Object.keys(buses)) {
        try {
            const b = JSON.parse(JSON.stringify(buses[name]));
            if (b.parent && b.parent !== 'master') b.parent = pv(b.parent);
            $.audio.bus(pv(name), b);
            e.created.push(pv(name));
        } catch (err) { h.note('error', 'SDK_AUDIO_RUNTIME', 'Шина «' + name + '»: ' + (err && err.message ? err.message : err)); }
    }
    for (const z of m.zones || []) {
        try { $.audio.zone(PV + z.name, { rect: z.rect, height: z.height, material: z.material }); e.zones.push(PV + z.name); } catch (err) { /* зона без рантайма — диагностика ниже */ }
    }
}

function unmount(h) {
    const $ = h.$, e = h.ext;
    for (const handle of Object.values(e.handles || {})) { try { handle.stop(50); } catch (err) { /* уже остановлен */ } }
    e.handles = {};
    for (const n of e.created || []) $.audio.remove(n);
    e.created = [];
}

function mixerHtml(h) {
    const m = h.model, buses = isObj(m.buses) ? m.buses : {};
    const s = sel(h);
    let html = '<div class="mixer"><h4>МИКШЕР — шины</h4>';
    const children = (parent) => Object.keys(buses).filter((n) => (buses[n].parent || 'master') === parent);
    const row = (name, depth) => {
        const b = buses[name], g = K.gain(buses, name);
        return '<div class="mx-row' + (s && s.type === 'bus' && s.id === name ? ' sel' : '') + '" data-key="bus:' + escapeHtml(name) + '"><span class="mx-name" style="padding-left:' + depth * 14 + 'px">' + escapeHtml(name) +
            '</span><span class="mx-meter"><span class="mx-fill" style="width:' + Math.round(Math.min(1, g) * 100) + '%"></span></span><span class="mx-val">' + g.toFixed(2) + '</span>' +
            (b.muted ? '<span class="mx-tag">mute</span>' : '') + (b.solo ? '<span class="mx-tag">solo</span>' : '') + (b.effect && b.effect !== 'none' ? '<span class="mx-tag">' + escapeHtml(b.effect) + '</span>' : '') + '</div>' +
            children(name).map((c) => row(c, depth + 1)).join('');
    };
    const roots = children('master').concat(Object.keys(buses).filter((n) => !isObj(buses[buses[n].parent]) && (buses[n].parent || 'master') !== 'master'));
    html += roots.length ? roots.map((n) => row(n, 0)).join('') : '<p class="empty">Шин нет: «+ Шина».</p>';
    html += '<h4>ЗВУКИ</h4>';
    const sounds = isObj(m.sounds) ? m.sounds : {};
    html += Object.keys(sounds).length ? Object.keys(sounds).map((n) => {
        const x = sounds[n], playing = h.ext.handles && h.ext.handles[n];
        return '<div class="mx-row' + (s && s.type === 'snd' && s.id === n ? ' sel' : '') + '" data-key="snd:' + escapeHtml(n) + '"><span class="mx-name">' + escapeHtml(n) + '</span><span class="mx-val">' +
            escapeHtml((x.path || '').split('/').pop()) + (x.bus ? ' » ' + escapeHtml(x.bus) : '') + '</span><span class="mx-play" data-key="play:' + escapeHtml(n) + '">' + (playing ? 'ещё раз' : 'играть') + '</span></div>';
    }).join('') : '<p class="empty">Звуков нет: «+ Звук».</p>';
    html += '</div>';
    return html;
}

const DEF = {
    id: 'audio-tools',
    title: 'Audio Tools',
    leftTitle: 'ЗОНЫ АКУСТИКИ',
    kind: K,

    left(h) {
        const zones = h.model.zones || [];
        const s = sel(h);
        return zones.length ? '<div class="list grow">' + zones.map((z, i) =>
            '<div class="row' + (s && s.type === 'zone' && s.id === String(i) ? ' sel' : '') + '" data-key="zone:' + i + '"><span class="row-name">' + escapeHtml(z.name || 'зона ' + i) +
            '</span><span class="row-dir">' + escapeHtml((z.material || '—') + ' · ' + (z.height || '—') + ' м') + '</span></div>').join('') + '</div>'
            : '<p class="empty">Зон нет: «+ Зона».</p>';
    },

    tools(h) {
        return button('addbus', '+ Шина', '') + button('addsnd', '+ Звук', '') + button('addzone', '+ Зона', '') + button('del', 'Удалить', 'danger') +
            button('stop', 'Остановить всё', '');
    },

    right(h) {
        const s = sel(h), m = h.model;
        let html = '<h4>ВЫБРАНО</h4>';
        if (!s) return html + '<p class="empty">Выберите шину, звук или зону.</p>';
        if (s.type === 'bus') {
            const b = (m.buses || {})[s.id];
            if (!b) return html + '<p class="empty">Шины нет.</p>';
            html += fieldRow({ id: 'au-name', label: 'Имя', value: s.id }) +
                pairRow('volume, parent', 'au-vol', b.volume === undefined ? '' : b.volume, 'au-parent', b.parent || '') +
                '<div class="field-row">' + button('flag:muted', 'mute', 'small' + (b.muted ? ' on' : '')) + button('flag:solo', 'solo', 'small' + (b.solo ? ' on' : '')) + '</div>' +
                '<div class="field-row" style="flex-wrap: wrap">' + K.EFFECTS.map((f) => button('fx:' + f, f, 'small' + ((b.effect || 'none') === f ? ' on' : ''))).join('') + '</div>' +
                fieldRow({ id: 'au-fxp', label: 'effectParams', value: b.effectParams ? JSON.stringify(b.effectParams) : '', hint: 'JSON-объект, например {"cutoff":800}' }) +
                '<div class="field-row"><button class="btn small primary" data-key="apply">Применить</button></div>';
        } else if (s.type === 'snd') {
            const x = (m.sounds || {})[s.id];
            if (!x) return html + '<p class="empty">Звука нет.</p>';
            html += fieldRow({ id: 'au-name', label: 'Имя', value: s.id }) + fieldRow({ id: 'au-path', label: 'path', value: x.path || '', hint: 'файл .ogg/.wav/.mp3 от корня проекта' }) +
                fieldRow({ id: 'au-bus', label: 'bus', value: x.bus || '' }) + pairRow('volume, pitch', 'au-svol', x.volume === undefined ? '' : x.volume, 'au-pitch', x.pitch === undefined ? '' : x.pitch) +
                '<div class="field-row">' + button('flag:loop', 'loop', 'small' + (x.loop ? ' on' : '')) + '<button class="btn small primary" data-key="apply">Применить</button>' + button('play:' + s.id, 'Играть', 'small') + '</div>';
        } else {
            const z = (m.zones || [])[parseInt(s.id, 10)];
            if (!z) return html + '<p class="empty">Зоны нет.</p>';
            html += fieldRow({ id: 'au-name', label: 'Имя', value: z.name || '' }) + pairRow('x, y', 'au-zx', z.rect[0], 'au-zy', z.rect[1]) + pairRow('w, h', 'au-zw', z.rect[2], 'au-zh', z.rect[3]) +
                pairRow('height м, материал', 'au-zheight', z.height === undefined ? '' : z.height, 'au-zmat', z.material || '') +
                '<div class="field-row"><button class="btn small primary" data-key="apply">Применить</button></div>';
        }
        html += '<h4>ИСПОЛЬЗОВАНИЕ В ИГРЕ</h4><div class="log">' + escapeHtml(K.snippet(h.session.path.split('/').pop())) + '</div>';
        return html;
    },

    onLeft(h, key) { selectKey(h, String(key)); },
    onOverlay(h, key) {
        key = String(key);
        if (key.startsWith('play:')) api(h).play(key.slice(5));
        else selectKey(h, key);
    },

    onTool(h, key) {
        const a = api(h);
        if (key === 'addbus') a.addBus();
        else if (key === 'addsnd') a.addSound();
        else if (key === 'addzone') a.addZone();
        else if (key === 'del') a.removeSelected();
        else if (key === 'stop') a.stopAll();
    },

    onRight(h, key) {
        const a = api(h), s = sel(h);
        if (key === 'apply') a.applyForm();
        else if (key.startsWith('flag:') && s) {
            const f = key.slice(5), src = s.type === 'bus' ? h.model.buses[s.id] : h.model.sounds[s.id];
            if (s.type === 'bus') a.setBus(s.id, { [f]: src[f] ? null : true }); else a.setSound(s.id, { [f]: src[f] ? null : true });
        } else if (key.startsWith('fx:') && s) a.setBus(s.id, { effect: key.slice(3) === 'none' ? null : key.slice(3) });
        else if (key.startsWith('play:')) a.play(key.slice(5));
    },

    mount(h) {
        h.ext.handles = {};
        const first = Object.keys(h.model.buses || {})[0];
        h.ext.selKey = first ? 'bus:' + first : null;
        mount(h);
        h.doc.html('ds-overlay', mixerHtml(h));
    },
    unmount(h) { unmount(h); h.doc.html('ds-overlay', ''); },
    changed(h) { mount(h); h.doc.html('ds-overlay', mixerHtml(h)); },

    tick(h) {
        const e = h.ext;
        // Зоны акустики — прямоугольники карты мира; рисуем их в окне просмотра (план сверху).
        const r = h.rect();
        const zones = h.model.zones || [];
        if (!zones.length) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const z of zones) { x0 = Math.min(x0, z.rect[0]); y0 = Math.min(y0, z.rect[1]); x1 = Math.max(x1, z.rect[0] + z.rect[2]); y1 = Math.max(y1, z.rect[1] + z.rect[3]); }
        const k = Math.min(0.9, (r.w - 40) / Math.max(1, x1 - x0), 150 / Math.max(1, y1 - y0));
        const ox = r.x + 20 - x0 * k, oy = r.y + r.h - 170 - y0 * k;
        const s = sel(h);
        zones.forEach((z, i) => {
            const on = s && s.type === 'zone' && s.id === String(i);
            const a = ox + z.rect[0] * k, b = oy + z.rect[1] * k, w = z.rect[2] * k, hh = z.rect[3] * k;
            h.$.gfx.draw.rect(a, b, w, hh, on ? 'rgba(255,90,60,0.22)' : 'rgba(108,199,255,0.16)');
            for (const [x1_, y1_, x2_, y2_] of [[a, b, a + w, b], [a + w, b, a + w, b + hh], [a + w, b + hh, a, b + hh], [a, b + hh, a, b]]) h.$.gfx.draw.line(x1_, y1_, x2_, y2_, on ? '#ff5a3c' : '#6cc7ff', 1);
        });
    },

    hud(h) { return 'шин ' + Object.keys(h.model.buses || {}).length + ' · играет ' + Object.keys(h.ext.handles || {}).length; },

    snapshot(h) {
        return { buses: isObj(h.model && h.model.buses) ? Object.keys(h.model.buses).length : 0, sounds: isObj(h.model && h.model.sounds) ? Object.keys(h.model.sounds).length : 0,
            zones: h.model && h.model.zones ? h.model.zones.length : 0, selected: h.ext.selKey, runtimeBuses: (h.ext.created || []).length, playing: Object.keys(h.ext.handles || {}).length };
    },
    api(h) { return api(h); },
};

function selectKey(h, key) {
    h.ext.selKey = key;
    h.renderAll();
    h.doc.html('ds-overlay', mixerHtml(h));
}

function api(h) {
    const $ = h.$, v = (id) => h.doc.value(id), num = (t) => parseNum(t);
    const uniq = (obj, base) => { let n = base, i = 1; while (obj[n]) n = base + (++i); return n; };
    return {
        addBus(name) {
            const n = uniq(h.model.buses || {}, name || 'bus');
            h.run('шина «' + n + '»', (m) => { m.buses = m.buses || {}; m.buses[n] = { volume: 1 }; });
            selectKey(h, 'bus:' + n);
            return n;
        },
        addSound(name, path) {
            const n = uniq(h.model.sounds || {}, name || 'sound');
            h.run('звук «' + n + '»', (m) => { m.sounds = m.sounds || {}; m.sounds[n] = { path: path || 'assets/hit.ogg' }; });
            selectKey(h, 'snd:' + n);
            return n;
        },
        addZone(name) {
            const i = h.run('зона', (m) => { m.zones = m.zones || []; m.zones.push({ name: name || 'zone' + m.zones.length, rect: [0, 0, 400, 300], height: 3, material: 'concrete' }); return m.zones.length - 1; });
            if (i !== null) selectKey(h, 'zone:' + i);
            return i;
        },
        setBus(name, patch) {
            return h.run('шина «' + name + '»', (m) => {
                const b = (m.buses || {})[name];
                if (!b) throw new Error('Нет шины «' + name + '»');
                for (const k of Object.keys(patch)) { if (patch[k] === null) delete b[k]; else b[k] = patch[k]; }
            }) !== null;
        },
        setSound(name, patch) {
            return h.run('звук «' + name + '»', (m) => {
                const s = (m.sounds || {})[name];
                if (!s) throw new Error('Нет звука «' + name + '»');
                for (const k of Object.keys(patch)) { if (patch[k] === null) delete s[k]; else s[k] = patch[k]; }
            }) !== null;
        },
        setZone(i, patch) {
            return h.run('зона', (m) => {
                const z = (m.zones || [])[i];
                if (!z) throw new Error('Нет зоны ' + i);
                for (const k of Object.keys(patch)) { if (patch[k] === null) delete z[k]; else z[k] = patch[k]; }
            }) !== null;
        },
        renameBus(from, to) {
            return h.run('переименование шины', (m) => {
                if (!m.buses[from]) throw new Error('Нет шины «' + from + '»');
                if (m.buses[to]) throw new Error('Шина «' + to + '» уже есть');
                const out = {};
                for (const k of Object.keys(m.buses)) { const b = m.buses[k]; if (b.parent === from) b.parent = to; out[k === from ? to : k] = b; }
                m.buses = out;
                for (const s of Object.values(m.sounds || {})) if (s.bus === from) s.bus = to;
            }) !== null;
        },
        removeBus(name) {
            return h.run('удаление шины', (m) => {
                const gone = m.buses[name];
                if (!gone) throw new Error('Нет шины «' + name + '»');
                delete m.buses[name];
                // Дети переходят к родителю удалённой шины, звуки теряют привязку: ничего не остаётся «висеть».
                for (const b of Object.values(m.buses)) if (b.parent === name) { if (gone.parent) b.parent = gone.parent; else delete b.parent; }
                for (const s of Object.values(m.sounds || {})) if (s.bus === name) delete s.bus;
            }) !== null;
        },
        removeSound(name) { return h.run('удаление звука', (m) => { if (!(m.sounds || {})[name]) throw new Error('Нет звука «' + name + '»'); delete m.sounds[name]; }) !== null; },
        removeZone(i) { return h.run('удаление зоны', (m) => { if (!(m.zones || [])[i]) throw new Error('Нет зоны ' + i); m.zones.splice(i, 1); }) !== null; },
        removeSelected() {
            const s = sel(h);
            if (!s) return false;
            const ok = s.type === 'bus' ? this.removeBus(s.id) : s.type === 'snd' ? this.removeSound(s.id) : this.removeZone(parseInt(s.id, 10));
            if (ok) { h.ext.selKey = null; h.renderAll(); h.doc.html('ds-overlay', mixerHtml(h)); }
            return ok;
        },
        applyForm() {
            const s = sel(h);
            if (!s) return false;
            const name = String(v('au-name') || '').trim();
            let ok = false;
            if (s.type === 'bus') {
                const vol = num(v('au-vol'));
                let fxp;
                const raw = String(v('au-fxp') || '').trim();
                if (raw) { try { fxp = JSON.parse(raw); } catch (err) { h.note('error', 'SDK_EDIT_REJECTED', 'effectParams — не JSON: ' + err.message); return false; } }
                ok = this.setBus(s.id, { volume: vol === null || Number.isNaN(vol) ? null : vol, parent: String(v('au-parent') || '').trim() || null, effectParams: fxp === undefined ? null : fxp });
                if (ok && name && name !== s.id) { ok = this.renameBus(s.id, name); if (ok) h.ext.selKey = 'bus:' + name; }
            } else if (s.type === 'snd') {
                const vol = num(v('au-svol')), pitch = num(v('au-pitch'));
                ok = this.setSound(s.id, { path: String(v('au-path') || '').trim(), bus: String(v('au-bus') || '').trim() || null,
                    volume: vol === null || Number.isNaN(vol) ? null : vol, pitch: pitch === null || Number.isNaN(pitch) ? null : pitch });
                if (ok && name && name !== s.id) {
                    ok = h.run('переименование звука', (m) => { if (m.sounds[name]) throw new Error('Звук «' + name + '» уже есть'); const out = {}; for (const k of Object.keys(m.sounds)) out[k === s.id ? name : k] = m.sounds[k]; m.sounds = out; }) !== null;
                    if (ok) h.ext.selKey = 'snd:' + name;
                }
            } else {
                const i = parseInt(s.id, 10), n4 = ['au-zx', 'au-zy', 'au-zw', 'au-zh'].map((id) => num(v(id)));
                if (n4.some((x) => x === null || Number.isNaN(x))) { h.note('error', 'SDK_EDIT_REJECTED', 'rect зоны — четыре числа x, y, w, h'); return false; }
                const hh = num(v('au-zheight'));
                ok = this.setZone(i, { name: name || null, rect: n4, height: hh === null || Number.isNaN(hh) ? null : hh, material: String(v('au-zmat') || '').trim() || null });
            }
            if (ok) { h.renderAll(); h.doc.html('ds-overlay', mixerHtml(h)); }
            return ok;
        },
        /** Играет звук настоящим `$.audio.play`; шина — из файла (с префиксом рантайма SDK). */
        play(name) {
            const x = (h.model.sounds || {})[name];
            if (!x) return null;
            const opts = { volume: x.volume === undefined ? 1 : x.volume, loop: !!x.loop };
            if (x.pitch !== undefined) opts.pitch = x.pitch;
            if (x.bus) opts.bus = pv(x.bus);
            const handle = $.audio.play(abs(h, x.path), opts);
            if (handle) { h.ext.handles[name] = handle; h.doc.html('ds-overlay', mixerHtml(h)); }
            else h.note('warning', 'SDK_AUDIO_PLAY', 'Движок не запустил звук «' + name + '» (' + x.path + ')');
            return handle;
        },
        stopAll() {
            for (const handle of Object.values(h.ext.handles || {})) { try { handle.stop(100); } catch (err) { /* уже остановлен */ } }
            h.ext.handles = {};
            h.doc.html('ds-overlay', mixerHtml(h));
            return true;
        },
        gain(name) { return K.gain(h.model.buses || {}, name); },
        runtimeGain(name) { return $.audio.gain(pv(name)); },
        select: (key) => selectKey(h, key),
    };
}

export async function open(app, args) {
    return openStudio(app, DEF, args);
}
