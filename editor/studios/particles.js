// ===========================================================================
// Particles — студия Editor для `*.particles.json` (формат и чистые операции —
// sdk/lib/kinds/particles.js). Предпросмотр — настоящий узел `<particles>` с
// теми же opts, что получит игра; пресеты отдаёт сам `$.particles.preset`.
//
// Раскладка рабочей области ассета: слева разделы параметров и пресеты,
// по центру живой эмиттер (тянуть мышью), снизу — редактор рамп
// color/alpha/size, сверху — транспорт (перезапуск, залп, эмиссия, повтор).
// ===========================================================================

import * as K from '../../sdk/lib/kinds/particles.js';
import { createWorkspace, button } from '../lib/asset_workspace.js';
import { esc, mousePx, inside, FILTERS } from '../lib/studio_kit.js';

export const meta = { id: 'particles', title: 'Particles', icon: 'auto_awesome', match: (p) => /\.particles\.json$/i.test(p) };

const SECTIONS = [
    { id: 'emit', label: 'Эмиссия', fields: [
        { key: 'amount', label: 'amount', number: true, int: true, optional: true },
        { key: 'lifetime', label: 'lifetime, мс', pair: 'range', optional: true },
        { key: 'rate', label: 'rate', number: true, optional: true },
        { key: 'max_particles', label: 'max', number: true, int: true, optional: true },
        { key: 'one_shot', label: 'one_shot', bool: true, options: ['true', 'false'], optional: true },
        { key: 'emitting', label: 'emitting', bool: true, options: ['true', 'false'], optional: true },
    ] },
    { id: 'motion', label: 'Движение', fields: [
        { key: 'speed', label: 'speed', pair: 'range', optional: true },
        { key: 'direction', label: 'direction°', number: true, optional: true },
        { key: 'spread', label: 'spread°', number: true, optional: true },
        { key: 'gravity', label: 'gravity x, y', pair: 'vec', optional: true },
        { key: 'damping', label: 'damping', number: true, optional: true },
        { key: 'angle', label: 'angle', pair: 'range', optional: true },
        { key: 'angular_velocity', label: 'вращение', pair: 'range', optional: true },
        { key: 'local', label: 'local', bool: true, options: ['true', 'false'], optional: true },
    ] },
    { id: 'look', label: 'Вид', fields: [
        { key: 'size', label: 'size', pair: 'range', optional: true },
        { key: 'end_size', label: 'end_size', pair: 'range', optional: true },
        { key: 'color', label: 'color', optional: true },
        { key: 'end_color', label: 'end_color', optional: true },
        { key: 'src', label: 'текстура', optional: true, file: { filters: FILTERS.image } },
        { key: 'blend', label: 'blend', options: K.BLENDS, optional: true },
        { key: 'layer', label: 'layer', optional: true },
        { key: 'depth', label: 'depth', number: true, optional: true },
    ] },
    { id: 'zone', label: 'Зона и зерно', fields: [
        { key: 'emit_zone', label: 'зона', options: K.ZONES, optional: true },
        { key: 'emit_zone_w', label: 'ширина', number: true, optional: true },
        { key: 'emit_zone_h', label: 'высота', number: true, optional: true },
        { key: 'emit_zone_radius', label: 'радиус', number: true, optional: true },
        { key: 'seed', label: 'seed', number: true, int: true, optional: true },
        { key: 'name', label: 'name', optional: true },
    ] },
];

const PRESET_HINT = { explosion: 'разовый взрыв', smoke: 'дым', sparks: 'искры', fire: 'пламя', rain: 'дождь', dust: 'пыль' };
const RAMPS = [['color', 'Цвет'], ['alpha', 'Альфа'], ['size', 'Размер']];
const PAD = 10;
const isAbs = (p) => /^([A-Za-z]:[\\/]|\/)/.test(p);
const px = (v) => Math.round(v * 10) / 10;

// --- Геометрия графа рампы (пиксели RmlUi, box — layoutRect графа) ------------
function graphPoint(box, kind, t, value, range) {
    const x0 = box.x + PAD, x1 = box.x + box.w - PAD, y0 = box.y + PAD, y1 = box.y + box.h - PAD;
    const tt = Math.max(0, Math.min(1, Number(t)));
    if (kind === 'color') return { x: x0 + tt * (x1 - x0), y: (y0 + y1) / 2 };
    const v = Math.max(range[0], Math.min(range[1], Number(value))), span = range[1] - range[0];
    return { x: x0 + tt * (x1 - x0), y: span > 0 ? y1 - (v - range[0]) / span * (y1 - y0) : y1 };
}
function graphT(box, x) {
    const x0 = box.x + PAD, x1 = box.x + box.w - PAD;
    return Math.max(0, Math.min(1, x1 > x0 ? (x - x0) / (x1 - x0) : 0));
}
function graphValue(box, kind, y, range) {
    if (kind === 'color') return undefined;
    const y0 = box.y + PAD, y1 = box.y + box.h - PAD;
    const f = Math.max(0, Math.min(1, y1 > y0 ? (y1 - y) / (y1 - y0) : 0));
    return range[0] + f * (range[1] - range[0]);
}
function graphHit(ramp, kind, box, range, x, y, tol) {
    let best = -1, dist = Infinity;
    (ramp || []).forEach((p, i) => {
        const q = graphPoint(box, kind, p.t, K.stopValue(p, kind), range);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d <= tol && d < dist) { best = i; dist = d; }
    });
    return best;
}

// Цвет рампы в t — как рантайм: линейно по каналам RGBA между соседними стопами.
// Именованные цвета не разбираем: берём ближайший стоп как есть.
function parseColor(c) {
    const s = String(c || '').trim();
    let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
    if (m) {
        let h = m[1];
        if (h.length <= 4) h = h.split('').map((ch) => ch + ch).join('');
        if (h.length === 6) h += 'ff';
        return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(s);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 255 : Math.round(+m[4] * 255)] : null;
}
function sampleColor(list, t) {
    const pts = list.slice().sort((p, q) => p.t - q.t), col = (p) => K.stopValue(p, 'color');
    if (t <= pts[0].t) return col(pts[0]);
    const last = pts[pts.length - 1];
    if (t >= last.t) return col(last);
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (t > b.t) continue;
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0, ca = parseColor(col(a)), cb = parseColor(col(b));
        if (!ca || !cb) return k < 0.5 ? col(a) : col(b);
        const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * k));
        return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');   // RmlUi: #rrggbbaa
    }
    return col(last);
}

export function create(host) {
    const $ = host.$;
    const ramp = (w, kind) => (w.data[K.RAMP_FIELDS[kind || w.ext.ramp]] || []);
    const node = (w) => w.ext.node || null;

    function emitterOpts(w) {
        const o = K.emitterOpts(w.data);
        for (const k of ['src', 'texture']) if (typeof o[k] === 'string' && o[k] && !isAbs(o[k])) o[k] = w.path(o[k]);
        if (w.ext.emitting === false) o.emitting = false;
        return o;
    }

    // --- Рампы: одна правка — один шаг Undo ------------------------------------
    function setRamp(w, kind, points, label) {
        return w.edit(label || 'Рампа', (m) => K.setRamp(m, K.RAMP_FIELDS[kind], points));
    }
    function addPoint(w, kind, t, value) {
        const list = ramp(w, kind);
        const at = t === undefined ? (list.length ? Math.min(1, (list[list.length - 1].t + 1) / 2) : 0.5) : t;
        const r = K.addRampPoint(list, kind, at, value === undefined ? K.rampDefaultValue(kind) : value);
        if (!r) { w.fail('SDK_PARTICLES_RAMP', 'В рампе уже 32 точки'); return -1; }
        w.ext.ramp = kind; w.ext.rampSel = r.index;
        return setRamp(w, kind, r.points, 'Точка рампы') ? r.index : -1;
    }
    function removePoint(w, kind, index) {
        const i = index === undefined ? w.ext.rampSel : index;
        const next = K.removeRampPoint(ramp(w, kind), i);
        if (!next) { w.fail('SDK_PARTICLES_RAMP', 'У рампы должна остаться хотя бы одна точка'); return false; }
        w.ext.rampSel = next.length ? Math.min(Math.max(0, i), next.length - 1) : -1;
        return setRamp(w, kind, next, 'Удалить точку');
    }
    function movePoint(w, kind, index, t, value) {
        const next = K.moveRampPoint(ramp(w, kind), kind, index, t, value);
        if (!next) return false;
        w.ext.rampSel = index;
        return setRamp(w, kind, next, 'Точка рампы');
    }

    // --- Нижняя панель: граф рампы и поля выбранной точки ----------------------
    function bottom(w) {
        const kind = w.ext.ramp, list = ramp(w), sel = list[w.ext.rampSel];
        let html = '<div class="pt-ramps"><div class="st-bar">' + RAMPS.map(([k, t]) => button('ramp:' + k, t + (w.data[K.RAMP_FIELDS[k]] ? '' : ' (нет)'), k === kind)).join('') +
            '<span class="st-sep"></span>' + button('point:add', '+ Точка') + button('point:del', 'Удалить точку');
        if (!list.length) html += '<span class="st-label">рампы нет — клик по графу создаст её</span>';
        else html += button('ramp:clear', 'Убрать рампу');
        if (sel) {
            html += '<span class="st-sep"></span><span class="st-label">t</span><input id="pt-p-t" class="st-in pt-small" type="text" value="' + esc(sel.t) + '"/>' +
                '<span class="st-label">' + (kind === 'color' ? 'цвет' : 'значение') + '</span><input id="pt-p-v" class="st-in pt-small" type="text" value="' + esc(K.stopValue(sel, kind)) + '"/>' +
                button('point:apply', 'OK');
        }
        return html + '</div><div id="pt-graph" class="pt-graph"></div></div>';
    }

    function paintGraph(w) {
        const box = w.doc.layoutRect('pt-graph');
        if (!box || !(box.w > 0) || !(box.h > 0)) return;
        const kind = w.ext.ramp, list = ramp(w), sel = w.ext.rampSel;
        const sig = kind + '|' + JSON.stringify(list) + '|' + sel + '|' + Math.round(box.w) + 'x' + Math.round(box.h);
        if (w.ext.graphSig === sig) return;
        w.ext.graphSig = sig;
        const range = K.rampRange(list, kind);
        const abs = (x, y, wd, ht, style) => '<div style="position:absolute;left:' + px(x) + 'px;top:' + px(y) + 'px;width:' + px(wd) + 'px;height:' + px(ht) + 'px;' + style + '"></div>';
        let out = '';
        if (kind === 'color') {
            // Полоса: каждый стоп красит отрезок до следующего, как рантайм между стопами.
            const steps = Math.max(8, Math.round((box.w - 2 * PAD) / 6));
            for (let i = 0; i < steps; i++) {
                const t = (i + 0.5) / steps, c = list.length ? sampleColor(list, t) : '#1a2030';
                out += abs(PAD + (box.w - 2 * PAD) * i / steps, box.h / 2 - 12, (box.w - 2 * PAD) / steps + 0.5, 24, 'background-color:' + esc(c) + ';');
            }
        } else {
            for (const f of [0, 0.5, 1]) out += abs(PAD, PAD + (box.h - 2 * PAD) * f, box.w - 2 * PAD, 1, 'background-color:#262d3d;');
            if (list.length) {
                const steps = Math.max(2, Math.round((box.w - 2 * PAD) / 6));
                let prev = null;
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps, q = graphPoint(box, kind, t, K.sampleRamp(list, kind, t), range);
                    if (prev) {
                        const dx = q.x - prev.x, dy = q.y - prev.y;
                        out += '<div style="position:absolute;left:' + px(prev.x - box.x) + 'px;top:' + px(prev.y - box.y) + 'px;width:' + px(Math.hypot(dx, dy)) +
                            'px;height:2px;background-color:#6cc7ff;transform-origin:left center;transform:rotate(' + px(Math.atan2(dy, dx) * 180 / Math.PI) + 'deg);"></div>';
                    }
                    prev = q;
                }
            }
            out += '<div class="pt-axis" style="left:4px;top:2px;">' + esc(px(range[1])) + '</div><div class="pt-axis" style="left:4px;top:' + px(box.h - 16) + 'px;">' + esc(px(range[0])) + '</div>';
        }
        list.forEach((p, i) => {
            const q = graphPoint(box, kind, p.t, K.stopValue(p, kind), range), size = i === sel ? 13 : 10;
            out += abs(q.x - box.x - size / 2, q.y - box.y - size / 2, size, size,
                'background-color:' + (kind === 'color' ? esc(K.stopValue(p, kind)) : i === sel ? '#ff5a3c' : '#ffb03a') + ';border-width:' + (i === sel ? 2 : 1) + 'px;border-color:#ffffff;border-radius:' + px(size / 2) + 'px;');
        });
        out += '<div class="pt-axis" style="left:' + px(box.w - 30) + 'px;top:' + px(box.h - 16) + 'px;">t 1</div>';
        w.doc.html('pt-graph', out);
    }

    // Мышь по графу: клик по точке — выбрать/тянуть, по пустому месту — добавить.
    function graphInput(w) {
        const box = w.doc.layoutRect('pt-graph');
        if (!box || !(box.w > 0)) return;
        const m = mousePx($), down = $.input.mouseDown('left'), e = w.ext;
        if ($.input.mousePressed('left') && inside(m, box) && !host.typing()) {
            const list = ramp(w), range = K.rampRange(list, e.ramp);
            const hit = graphHit(list, e.ramp, box, range, m.x, m.y, 12);
            if (hit >= 0) { e.rampSel = hit; e.drag = { kind: e.ramp, index: hit, start: JSON.parse(JSON.stringify(list)), range, x: m.x, y: m.y, moved: false }; w.render(); }
            else addPoint(w, e.ramp, graphT(box, m.x), graphValue(box, e.ramp, m.y, range));
            return;
        }
        const d = e.drag;
        if (!d) return;
        if (down) {
            if (!d.moved && Math.abs(m.x - d.x) < 3 && Math.abs(m.y - d.y) < 3) return;
            const next = K.moveRampPoint(d.start, d.kind, d.index, graphT(box, m.x), graphValue(box, d.kind, m.y, d.range));
            // Во время протяжки правим модель без истории; на отпускании — одна команда.
            if (next) { K.setRamp(w.data, K.RAMP_FIELDS[d.kind], next); d.moved = true; e.graphSig = ''; paintGraph(w); }
            return;
        }
        e.drag = null;
        if (d.moved) {
            const final = JSON.parse(JSON.stringify(w.data[K.RAMP_FIELDS[d.kind]]));
            K.setRamp(w.data, K.RAMP_FIELDS[d.kind], d.start);
            setRamp(w, d.kind, final, 'Точка рампы');
        }
    }

    // Эмиттер в центре холста плюс смещение, которое человек задал протяжкой.
    function emitterAt(w) {
        const r = w.rect();
        return r ? { x: r.x + r.w / 2 + w.ext.offX, y: r.y + r.h / 2 + w.ext.offY } : null;
    }

    function applyPreset(w, name) {
        if (K.PRESETS.indexOf(name) < 0) return false;
        const spec = $.particles.preset(name);
        return w.edit('Пресет ' + name, (m) => {
            const keep = { version: 1, name: m.name || name };
            for (const k of Object.keys(m)) delete m[k];
            Object.assign(m, keep, JSON.parse(JSON.stringify(spec)));
        });
    }

    const def = {
        kind: K, title: 'Particles', listTitle: 'Параметры',
        init(w) {
            Object.assign(w.ext, { ramp: 'color', rampSel: -1, drag: null, graphSig: '', emitting: true, loop: true, offX: 0, offY: 0, age: 0, moving: false });
            w.doc.cls('aw-bottom', 'pt-bottom', true);
        },
        items: () => SECTIONS.map((s) => ({ label: s.label, detail: s.fields.length + ' полей' })),
        target: (w) => w.data,
        fields: (w) => SECTIONS[w.selected].fields,
        tools: (w) => button('restart', 'Перезапуск') + button('burst', 'Залп 40') + button('emit', 'Эмиссия', w.ext.emitting) +
            button('loop', 'Повтор', w.ext.loop) + button('center', 'В центр'),
        actions: () => button('reset', 'Сбросить к умолчанию'),
        library(w) {
            const file = String(w.file.state.path).split('/').pop();
            return '<span class="st-h">Пресеты $.particles</span>' +
                K.PRESETS.map((p) => '<div class="st-row" data-key="preset:' + p + '">' + esc(p) + '<span class="st-sub">' + esc(PRESET_HINT[p] || '') + '</span></div>').join('') +
                '<span class="st-note">Пресет заменяет параметры (Cmd/Ctrl+Z вернёт прежние).</span>' +
                '<span class="st-h">В игре</span><div class="pt-code">' + esc(K.snippet(file)) + '</div>';
        },
        bottom,
        selected(w) { w.ext.graphSig = ''; },
        action(w, key) {
            const e = w.ext, n = node(w);
            if (key.startsWith('preset:')) applyPreset(w, key.slice(7));
            else if (key === 'reset') w.edit('Сброс', (m) => { for (const k of Object.keys(m)) delete m[k]; Object.assign(m, K.create()); });
            else if (key === 'restart') { if (n) n.restart(); e.age = 0; }
            else if (key === 'burst') { if (n) n.burst(40); }
            else if (key === 'emit') { e.emitting = !e.emitting; if (n) n.emitting(e.emitting); w.render(); }
            else if (key === 'loop') { e.loop = !e.loop; w.render(); }
            else if (key === 'center') { e.offX = 0; e.offY = 0; }
            else if (key.startsWith('ramp:') && key !== 'ramp:clear') { e.ramp = key.slice(5); e.rampSel = -1; e.drag = null; w.render(); }
            else if (key === 'ramp:clear') w.edit('Убрать рампу', (m) => { delete m[K.RAMP_FIELDS[e.ramp]]; });
            else if (key === 'point:add') addPoint(w, e.ramp);
            else if (key === 'point:del') removePoint(w, e.ramp);
            else if (key === 'point:apply') {
                const t = Number(String(w.doc.value('pt-p-t')).trim()), raw = String(w.doc.value('pt-p-v')).trim();
                const value = e.ramp === 'color' ? raw : Number(raw);
                if (!Number.isFinite(t) || (e.ramp !== 'color' && !Number.isFinite(value))) throw new Error('Точка рампы: t и значение — числа');
                movePoint(w, e.ramp, e.rampSel, t, value);
            }
        },
        preview(w) {
            const at = emitterAt(w);
            try {
                w.ext.node = $('<particles>', emitterOpts(w)).at(at ? at.x : 0, at ? at.y : 0).appendTo($.world);
                w.nodes.push(w.ext.node);
            } catch (err) {
                w.ext.node = null;
                w.fail('SDK_PARTICLES_RUNTIME', 'Рантайм отклонил параметры эмиттера: ' + (err && err.message ? err.message : err));
            }
            w.ext.age = 0;
        },
        release(w) { w.ext.node = null; },
        deactivate(w) { w.ext.drag = null; w.ext.moving = false; },
        update(w, dt) {
            const e = w.ext, n = node(w), p = w.point();
            graphInput(w);
            paintGraph(w);
            // Протяжка в холсте двигает эмиттер (смещение от центра холста).
            if (p && p.inside && $.input.mousePressed('left') && !host.typing()) e.moving = true;
            if (!$.input.mouseDown('left')) e.moving = false;
            if (e.moving && p) { e.offX = p.x - p.r.w / 2; e.offY = p.y - p.r.h / 2; }
            const at = emitterAt(w);
            if (n && at) n.at(at.x, at.y);
            e.age += dt || 0;
            if (n && e.loop && e.age > 2.2 && n.count() === 0) { n.restart(); e.age = 0; }
            if (at && p) {
                const c = 'rgba(255,255,255,0.25)';
                $.gfx.draw.line(at.x - 8, at.y, at.x + 8, at.y, c, 1);
                $.gfx.draw.line(at.x, at.y - 8, at.x, at.y + 8, c, 1);
            }
        },
        hud: (w) => K.summary(w.data) + ' · частиц ' + (node(w) ? node(w).count() : 0) + ' · тяните в окне — сдвинуть эмиттер',
        ops: (w) => ({
            preset: (name) => applyPreset(w, name),
            set: (patch) => w.edit('Параметры', (m) => { for (const k of Object.keys(patch)) { if (patch[k] === null) delete m[k]; else m[k] = JSON.parse(JSON.stringify(patch[k])); } }),
            rampKind: (kind) => { if (!K.RAMP_FIELDS[kind]) return false; w.ext.ramp = kind; w.ext.rampSel = -1; w.render(); return true; },
            addPoint: (kind, t, value) => addPoint(w, kind, t, value),
            removePoint: (kind, i) => removePoint(w, kind, i),
            movePoint: (kind, i, t, value) => movePoint(w, kind, i, t, value),
            ramp: (kind) => JSON.parse(JSON.stringify(ramp(w, kind))),
            graphPoint(kind, i) {
                const box = w.doc.layoutRect('pt-graph'), list = ramp(w, kind);
                return box && list[i] ? graphPoint(box, kind, list[i].t, K.stopValue(list[i], kind), K.rampRange(list, kind)) : null;
            },
            count: () => (node(w) ? node(w).count() : 0),
            emitter: () => emitterAt(w),
        }),
        snapshot: (w) => ({ node: !!node(w), count: node(w) ? node(w).count() : 0, emitting: w.ext.emitting, loop: w.ext.loop, ramp: w.ext.ramp }),
    };
    return createWorkspace(host, def);
}
