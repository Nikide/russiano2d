// ===========================================================================
// Particle Studio — параметры эмиттера `$.particles` (формат `*.particles.json`,
// sdk/lib/kinds/particles.js). Не отдельный рендерер частиц: предпросмотр —
// настоящий узел `<particles>` с теми же `opts`, что получит игра
// (`$('<particles>', $.fs.readJSON(файл))`). Пресеты берёт сам `$.particles`.
// ===========================================================================

import { openStudio } from '../lib/studio_host.js';
import * as K from '../lib/kinds/particles.js';
import { escapeHtml, joinPath, dirOf } from '../lib/model.js';
import { button, fieldRow, pairRow, parseNum, parseRange, parseBool } from '../lib/kit.js';
import { projectRoot } from './tilemap-studio.js';

export const standalone = true;

const fmt = (v) => (v === undefined ? '' : Array.isArray(v) ? v.join(', ') : v);
const lo = (v) => (Array.isArray(v) ? v[0] : v);
const hi = (v) => (Array.isArray(v) ? v[1] : v);

function emitterOpts(h) {
    const o = K.emitterOpts(h.model);
    for (const k of ['src', 'texture']) {
        if (typeof o[k] === 'string' && o[k] && !/^([A-Za-z]:[\\/]|\/)/.test(o[k])) o[k] = joinPath(projectRoot(h.app, h.session.path), o[k]);
    }
    return o;
}

function mount(h) {
    unmount(h);
    const r = h.rect();
    try {
        h.ext.node = h.$('<particles>', emitterOpts(h)).at(r.x + r.w / 2, r.y + r.h / 2).appendTo(h.$.world);
    } catch (e) {
        h.ext.node = null;
        h.note('error', 'SDK_PARTICLES_RUNTIME', 'Рантайм отклонил параметры эмиттера: ' + (e && e.message ? e.message : e));
    }
    h.ext.age = 0;
}

function unmount(h) {
    if (h.ext.node) { h.ext.node.remove(); h.ext.node = null; }
}

const DEF = {
    id: 'particle-studio',
    title: 'Particle Studio',
    leftTitle: 'ПРЕСЕТЫ',
    kind: K,

    left(h) {
        return '<div class="list grow">' + K.PRESETS.map((p) =>
            '<div class="row" data-key="' + p + '"><span class="row-name">' + p + '</span><span class="row-dir">' + presetHint(p) + '</span></div>').join('') + '</div>' +
            '<div class="hint">Клик заменяет параметры копией пресета $.particles (undo вернёт прежние).</div>';
    },

    tools(h) {
        return button('restart', 'Перезапуск', '') + button('burst', 'Залп 40', '') + button('emit', h.ext.emitting === false ? 'Эмиссия выкл' : 'Эмиссия', h.ext.emitting === false ? '' : 'on') +
            button('loop', 'Повтор', h.ext.loop ? 'on' : '') + button('center', 'Центр', '');
    },

    right(h) {
        const m = h.model;
        const zone = typeof m.emit_zone === 'string' ? m.emit_zone : (m.emit_zone && m.emit_zone.shape) || '';
        const g = m.gravity;
        const gx = Array.isArray(g) ? g[0] : (g && typeof g === 'object' ? g.x : 0);
        const gy = Array.isArray(g) ? g[1] : (g && typeof g === 'object' ? g.y : g);
        let html = '<div class="field-row"><button class="btn small primary" data-key="apply">Применить</button><button class="btn small" data-key="defaults">Сбросить всё</button></div>' +
            '<h4>ЭМИССИЯ</h4>' + fieldRow({ id: 'pe-amount', label: 'amount', value: fmt(m.amount) }) +
            pairRow('lifetime мс', 'pe-life0', lo(m.lifetime), 'pe-life1', hi(m.lifetime)) +
            fieldRow({ id: 'pe-rate', label: 'rate', value: fmt(m.rate) }) + fieldRow({ id: 'pe-max', label: 'max', value: fmt(m.max_particles) }) +
            fieldRow({ id: 'pe-oneshot', label: 'one_shot', value: m.one_shot ? 'да' : '' }) +
            '<h4>ДВИЖЕНИЕ</h4>' + pairRow('speed', 'pe-speed0', lo(m.speed), 'pe-speed1', hi(m.speed)) +
            fieldRow({ id: 'pe-dir', label: 'direction°', value: fmt(m.direction) }) + fieldRow({ id: 'pe-spread', label: 'spread°', value: fmt(m.spread) }) +
            pairRow('gravity x, y', 'pe-gx', gx === 0 && gy === 0 ? '' : gx, 'pe-gy', gy === undefined || (gx === 0 && gy === 0) ? '' : gy) +
            fieldRow({ id: 'pe-damp', label: 'damping', value: fmt(m.damping) }) +
            '<h4>ВИД</h4>' + pairRow('size', 'pe-size0', lo(m.size), 'pe-size1', hi(m.size)) + fieldRow({ id: 'pe-endsize', label: 'end_size', value: fmt(m.end_size) }) +
            fieldRow({ id: 'pe-color', label: 'color', value: fmt(m.color) }) + fieldRow({ id: 'pe-endcolor', label: 'end_color', value: fmt(m.end_color) }) +
            fieldRow({ id: 'pe-tex', label: 'src', value: fmt(m.src) }) +
            '<div class="field-row">' + ['alpha', 'add', 'multiply', 'none'].map((b) => button('blend:' + b, b, 'small' + (m.blend === b ? ' on' : ''))).join('') + '</div>' +
            '<h4>РАМПЫ</h4>' + fieldRow({ id: 'pe-cramp', label: 'color_ramp', value: K.rampText(m.color_ramp, 'color'), hint: 't:цвет через пробел: 0:#fff 0.5:#f90 1:#c00' }) +
            fieldRow({ id: 'pe-aramp', label: 'alpha_ramp', value: K.rampText(m.alpha_ramp, 'alpha'), hint: '0:1 0.7:0.6 1:0' }) +
            fieldRow({ id: 'pe-sramp', label: 'size_ramp', value: K.rampText(m.size_ramp, 'size'), hint: '0:4 1:20 (перекрывает size / end_size)' }) +
            '<h4>ЗОНА И ЗЕРНО</h4><div class="field-row">' + ['point', 'rect', 'circle'].map((z) => button('zone:' + z, z, 'small' + (zone === z ? ' on' : ''))).join('') + '</div>' +
            pairRow('зона w, h', 'pe-zw', fmt(m.emit_zone_w), 'pe-zh', fmt(m.emit_zone_h)) + fieldRow({ id: 'pe-zr', label: 'радиус', value: fmt(m.emit_zone_radius) }) +
            fieldRow({ id: 'pe-seed', label: 'seed', value: fmt(m.seed) }) + fieldRow({ id: 'pe-name', label: 'name', value: fmt(m.name) });
        html += '<h4>ИСПОЛЬЗОВАНИЕ В ИГРЕ</h4><div class="log">' + escapeHtml(K.snippet(h.session.path.split('/').pop())) + '</div>';
        return html;
    },

    onLeft(h, key) { api(h).applyPreset(key); },

    onTool(h, key) {
        const a = api(h);
        if (key === 'restart') a.restart();
        else if (key === 'burst') a.burst(40);
        else if (key === 'emit') a.emitting(h.ext.emitting === false);
        else if (key === 'loop') { h.ext.loop = !h.ext.loop; h.renderAll(); }
        else if (key === 'center') { a.center(); }
    },

    onRight(h, key) {
        const a = api(h);
        if (key === 'apply') a.applyForm();
        else if (key === 'defaults') a.reset();
        else if (key.startsWith('blend:')) a.set({ blend: key.slice(6) });
        else if (key.startsWith('zone:')) a.set({ emit_zone: key.slice(5) });
    },

    mount(h) { h.ext.emitting = true; h.ext.loop = true; mount(h); },
    unmount(h) { unmount(h); h.doc.html('ds-overlay', ''); },
    changed(h) { mount(h); },

    tick(h) {
        const n = h.ext.node;
        if (!n) return;
        const r = h.rect();
        n.at(r.x + r.w / 2 + (h.ext.offX || 0), r.y + r.h / 2 + (h.ext.offY || 0));
        // Узел «следует» за точкой: перетаскивание мышью по окну просмотра.
        if (h.ptr.inside && h.ptr.down) { h.ext.offX = h.ptr.x - (r.x + r.w / 2); h.ext.offY = h.ptr.y - (r.y + r.h / 2); }
        h.ext.age += h.$.time.delta();
        if (h.ext.loop && h.ext.age > 2.2 && n.count() === 0) { n.restart(); h.ext.age = 0; }
        if (h.$.time.frame() % 6 === 0) h.hud();
    },

    hud(h) {
        const n = h.ext.node;
        return n ? 'частиц ' + n.count() + ' · тяните мышью, чтобы сдвинуть эмиттер' : 'эмиттер не создан: см. диагностику';
    },

    snapshot(h) { return { node: !!h.ext.node, count: h.ext.node ? h.ext.node.count() : 0, emitting: h.ext.emitting, loop: !!h.ext.loop }; },
    api(h) { return api(h); },
};

function presetHint(p) {
    return { explosion: 'разовый взрыв', smoke: 'дым', sparks: 'искры', fire: 'пламя', rain: 'дождь', dust: 'пыль' }[p] || '';
}

const numOrDelete = (m, key, text, opts) => {
    const v = parseNum(text);
    if (v === null) { delete m[key]; return; }
    if (Number.isNaN(v) || (opts && opts.int && Math.floor(v) !== v)) throw new Error(key + ': ожидалось ' + (opts && opts.int ? 'целое число' : 'число'));
    m[key] = v;
};

const rangeOrDelete = (m, key, a, b) => {
    const v = parseRange(a, b);
    if (v === null) delete m[key];
    else if (Number.isNaN(v)) throw new Error(key + ': ожидалось число или два числа «от, до»');
    else m[key] = v;
};

const rampOrDelete = (m, key, text, kind) => {
    const t = String(text || '').trim();
    if (!t) { delete m[key]; return; }
    const r = K.parseRampText(t, kind);
    if (!r) throw new Error(key + ': формат «t:значение t:значение», например 0:1 1:0');
    m[key] = r;
};

function api(h) {
    const d = h.doc, v = (id) => d.value(id);
    return {
        /** Частичная правка параметров: `null` убирает поле. Одна правка — один шаг undo. */
        set(patch) {
            return h.run('параметры', (m) => {
                for (const k of Object.keys(patch)) {
                    if (patch[k] === null) delete m[k]; else m[k] = JSON.parse(JSON.stringify(patch[k]));
                }
            }) !== null;
        },
        applyForm() {
            return h.run('параметры', (m) => {
                numOrDelete(m, 'amount', v('pe-amount'), { int: true });
                rangeOrDelete(m, 'lifetime', v('pe-life0'), v('pe-life1'));
                numOrDelete(m, 'rate', v('pe-rate'));
                numOrDelete(m, 'max_particles', v('pe-max'), { int: true });
                if (parseBool(v('pe-oneshot'))) m.one_shot = true; else delete m.one_shot;
                rangeOrDelete(m, 'speed', v('pe-speed0'), v('pe-speed1'));
                numOrDelete(m, 'direction', v('pe-dir'));
                numOrDelete(m, 'spread', v('pe-spread'));
                const gx = parseNum(v('pe-gx')), gy = parseNum(v('pe-gy'));
                if (Number.isNaN(gx) || Number.isNaN(gy)) throw new Error('gravity: два числа x и y');
                if (gx === null && gy === null) delete m.gravity; else m.gravity = [gx === null ? 0 : gx, gy === null ? 0 : gy];
                numOrDelete(m, 'damping', v('pe-damp'));
                rangeOrDelete(m, 'size', v('pe-size0'), v('pe-size1'));
                rangeOrDelete(m, 'end_size', v('pe-endsize'), v('pe-endsize'));
                for (const [k, id] of [['color', 'pe-color'], ['end_color', 'pe-endcolor'], ['src', 'pe-tex'], ['name', 'pe-name']]) {
                    const t = String(v(id) || '').trim();
                    if (t) m[k] = t; else delete m[k];
                }
                rampOrDelete(m, 'color_ramp', v('pe-cramp'), 'color');
                rampOrDelete(m, 'alpha_ramp', v('pe-aramp'), 'alpha');
                rampOrDelete(m, 'size_ramp', v('pe-sramp'), 'size');
                numOrDelete(m, 'emit_zone_w', v('pe-zw'));
                numOrDelete(m, 'emit_zone_h', v('pe-zh'));
                numOrDelete(m, 'emit_zone_radius', v('pe-zr'));
                numOrDelete(m, 'seed', v('pe-seed'), { int: true });
            }) !== null;
        },
        applyPreset(name) {
            if (K.PRESETS.indexOf(name) < 0) return false;
            const spec = h.$.particles.preset(name);
            return h.run('пресет ' + name, (m) => {
                const keep = { version: 1, name: m.name || name };
                for (const k of Object.keys(m)) delete m[k];
                Object.assign(m, keep, JSON.parse(JSON.stringify(spec)));
            }) !== null;
        },
        reset() { return h.run('сброс', (m) => { const f = K.create(); for (const k of Object.keys(m)) delete m[k]; Object.assign(m, f); }) !== null; },
        restart() { if (h.ext.node) { h.ext.node.restart(); h.ext.age = 0; } return !!h.ext.node; },
        burst(n) { if (h.ext.node) h.ext.node.burst(n); return h.ext.node ? h.ext.node.count() : 0; },
        emitting(on) { h.ext.emitting = !!on; if (h.ext.node) h.ext.node.emitting(!!on); h.renderAll(); return h.ext.emitting; },
        center() { h.ext.offX = 0; h.ext.offY = 0; },
        count: () => (h.ext.node ? h.ext.node.count() : 0),
        node: () => h.ext.node,
    };
}

export async function open(app, args) {
    return openStudio(app, DEF, args);
}
