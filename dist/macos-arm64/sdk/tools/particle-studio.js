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

// --- Граф рамп: тот же формат color_ramp/alpha_ramp/size_ramp -------------------
const GRAPH_PAD = 8;
const RAMP_KINDS = [['color', 'цвет'], ['alpha', 'альфа'], ['size', 'размер']];
const RAMP_INPUT = { color: 'pe-cramp', alpha: 'pe-aramp', size: 'pe-sramp' };

const rampKind = (h) => (K.RAMP_FIELDS[h.ext.ramp] ? h.ext.ramp : 'color');
const rampIn = (h, kind) => (h.model && h.model[K.RAMP_FIELDS[kind]]) || [];

/** Точка графа (окно) по t и значению; для color значение не нужно — середина полосы. */
export function graphBoxPoint(box, kind, t, value, range) {
    const x0 = box.x + GRAPH_PAD, x1 = box.x + box.w - GRAPH_PAD;
    const y0 = box.y + GRAPH_PAD, y1 = box.y + box.h - GRAPH_PAD;
    const tt = Math.max(0, Math.min(1, Number(t)));
    if (kind === 'color') return { x: x0 + tt * (x1 - x0), y: (y0 + y1) / 2 };
    const v = Math.max(range[0], Math.min(range[1], Number(value)));
    const span = range[1] - range[0];
    return { x: x0 + tt * (x1 - x0), y: span > 0 ? y1 - (v - range[0]) / span * (y1 - y0) : y1 };
}

/** Обратно: t по x в окне графа. */
export function graphBoxT(box, x) {
    const x0 = box.x + GRAPH_PAD, x1 = box.x + box.w - GRAPH_PAD;
    return Math.max(0, Math.min(1, x1 > x0 ? (x - x0) / (x1 - x0) : 0));
}

/** Обратно: значение по y в окне графа (color → null). */
export function graphBoxValue(box, kind, y, range) {
    if (kind === 'color') return null;
    const y0 = box.y + GRAPH_PAD, y1 = box.y + box.h - GRAPH_PAD;
    const f = Math.max(0, Math.min(1, y1 > y0 ? (y1 - y) / (y1 - y0) : 0));
    return range[0] + f * (range[1] - range[0]);
}

/** Индекс точки под курсором (окно графа), иначе -1. */
export function graphPointAt(ramp, kind, box, range, x, y, tol) {
    let best = -1, dist = Infinity;
    (ramp || []).forEach((p, i) => {
        const q = graphBoxPoint(box, kind, p.t, K.stopValue(p, kind), range);
        const d = Math.hypot(q.x - x, q.y - y);
        if (d <= tol && d < dist) { best = i; dist = d; }
    });
    return best;
}

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
            '<h4>ГРАФ РАМП</h4><div class="field-row">' + RAMP_KINDS.map(([k, t]) => button('ramp:kind:' + k, t, 'small' + (rampKind(h) === k ? ' on' : ''))).join('') + '</div>' +
            '<div id="pp-graph" style="position:relative;height:110px;margin:6px 0px;background-color:#0a0d13;border-width:1px;border-color:#232b3d;border-radius:8px;overflow:hidden;"></div>' +
            '<div class="field-row">' + button('ramp:add', '+ Точка', 'small') + button('ramp:del', '− Точка', 'small') + '</div>' +
            '<div class="hint">Точки тянутся мышью; клик по графику добавляет точку. Числовые поля выше остаются запасным путём.</div>' +
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
        else if (key.startsWith('ramp:kind:')) a.curveKind(key.slice(10));
        else if (key === 'ramp:add') a.curveAdd(rampKind(h));
        else if (key === 'ramp:del') a.curveRemove(rampKind(h), h.ext.rampSel);
        else if (key.startsWith('blend:')) a.set({ blend: key.slice(6) });
        else if (key.startsWith('zone:')) a.set({ emit_zone: key.slice(5) });
    },

    mount(h) {
        if (!K.RAMP_FIELDS[h.ext.ramp]) h.ext.ramp = 'color';
        if (h.ext.rampSel === undefined) h.ext.rampSel = -1;
        h.ext.rampDrag = null; h.ext.graphSig = '';
        h.ext.emitting = true; h.ext.loop = true; mount(h);
    },
    unmount(h) { unmount(h); h.doc.html('ds-overlay', ''); h.ext.graphSig = ''; h.ext.rampDrag = null; },
    changed(h) { mount(h); },

    tick(h) {
        curveInput(h);
        paintGraph(h);
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

// --- Граф рамп: отрисовка (RmlUi-элементы) и мышь ---------------------------------
const px = (v) => Math.round(v * 10) / 10;

function paintGraph(h) {
    if (!h.model) return false;
    const box = h.doc.layoutRect('pp-graph');
    if (!box || !(box.w > 0) || !(box.h > 0)) return false;
    const kind = rampKind(h);
    const ramp = rampIn(h, kind);
    const sel = h.ext.rampSel;
    const sig = kind + '|' + JSON.stringify(ramp) + '|' + sel + '|' + Math.round(box.w) + 'x' + Math.round(box.h);
    if (h.ext.graphSig === sig) return true;
    const range = K.rampRange(ramp, kind);
    const at = (q) => 'left:' + px(q.x - box.x) + 'px;top:' + px(q.y - box.y) + 'px;';
    let out = '';
    if (kind === 'color') {
        // Полоса цветов: сегмент от точки до следующей, последний — до t=1.
        let prev = 0;
        ramp.forEach((p, i) => {
            const t = Math.max(prev, Math.min(1, Number(p.t)));
            const next = i < ramp.length - 1 ? Math.max(t, Math.min(1, Number(ramp[i + 1].t))) : 1;
            const left = GRAPH_PAD + (box.w - 2 * GRAPH_PAD) * prev;
            const w = Math.max(0, (box.w - 2 * GRAPH_PAD) * (next - prev));
            out += '<div style="position:absolute;left:' + px(left) + 'px;top:' + px(box.h / 2 - 9) +
                'px;width:' + px(w) + 'px;height:18px;background-color:' + escapeHtml(p.color || '#ffffff') + ';"></div>';
            prev = next;
        });
        if (!ramp.length) out += '<div style="position:absolute;left:' + GRAPH_PAD + 'px;top:' + px(box.h / 2 - 9) + 'px;width:' + px(box.w - 2 * GRAPH_PAD) + 'px;height:18px;background-color:#1a2030;"></div>';
    } else {
        for (const f of [0, 0.5, 1]) {
            const y = box.y + GRAPH_PAD + (box.h - 2 * GRAPH_PAD) * f;
            out += '<div style="position:absolute;left:' + GRAPH_PAD + 'px;top:' + px(y - box.y) + 'px;width:' + px(box.w - 2 * GRAPH_PAD) + 'px;height:1px;background-color:#1f2740;"></div>';
        }
        const steps = Math.max(2, Math.round((box.w - 2 * GRAPH_PAD) / 6));
        let prev = null;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const q = graphBoxPoint(box, kind, t, K.sampleRamp(ramp, kind, t), range);
            if (prev) {
                const dx = q.x - prev.x, dy = q.y - prev.y, len = Math.hypot(dx, dy);
                const ang = Math.atan2(dy, dx) * 180 / Math.PI;
                out += '<div style="position:absolute;left:' + px(prev.x - box.x) + 'px;top:' + px(prev.y - box.y) + 'px;width:' + px(len) +
                    'px;height:2px;background-color:#6cc7ff;transform-origin:left center;transform:rotate(' + px(ang) + 'deg);"></div>';
            }
            prev = q;
        }
        out += '<div style="position:absolute;left:4px;top:2px;color:#7b87a0;font-size:10px;">' + escapeHtml(range[1]) + '</div>' +
            '<div style="position:absolute;left:4px;top:' + px(box.h - 16) + 'px;color:#7b87a0;font-size:10px;">' + escapeHtml(range[0]) + '</div>';
    }
    ramp.forEach((p, i) => {
        const q = graphBoxPoint(box, kind, p.t, K.stopValue(p, kind), range);
        const size = i === sel ? 12 : 9;
        out += '<div style="position:absolute;' + at(q) + 'margin-left:' + px(-size / 2) + 'px;margin-top:' + px(-size / 2) +
            'px;width:' + size + 'px;height:' + size + 'px;background-color:' + (i === sel ? '#ff5a3c' : '#ffb03a') +
            ';border-width:1px;border-color:#ffffff;border-radius:' + px(size / 2) + 'px;"></div>';
    });
    out += '<div style="position:absolute;left:' + px(box.w - 26) + 'px;top:' + px(box.h - 16) + 'px;color:#7b87a0;font-size:10px;">t 1</div>';
    h.doc.html('pp-graph', out);
    h.ext.graphSig = sig;
    return true;
}

function curveInput(h) {
    if (!h.model) return;
    const box = h.doc.layoutRect('pp-graph');
    if (!box || !(box.w > 0) || !(box.h > 0)) return;
    const $ = h.$, m = $.input.mouse();
    const inside = m.x >= box.x && m.x <= box.x + box.w && m.y >= box.y && m.y <= box.y + box.h;
    const down = $.input.mouseDown('left');
    if ($.input.mousePressed('left') && inside) {
        const kind = rampKind(h);
        const ramp = rampIn(h, kind);
        const range = K.rampRange(ramp, kind);
        const hit = graphPointAt(ramp, kind, box, range, m.x, m.y, 10);
        if (hit >= 0) {
            h.ext.rampSel = hit;
            h.ext.rampDrag = { kind, field: K.RAMP_FIELDS[kind], index: hit, start: JSON.parse(JSON.stringify(ramp)), moved: false, x: m.x, y: m.y };
            h.ext.graphSig = '';
            paintGraph(h);
        } else {
            api(h).curveAdd(kind, graphBoxT(box, m.x), graphBoxValue(box, kind, m.y, range));
        }
    }
    const d = h.ext.rampDrag;
    if (!d) return;
    if (down) {
        // Клик без движения не должен создавать шаг undo и сдвигать точку пинселем.
        if (!d.moved && Math.abs(m.x - d.x) < 2 && Math.abs(m.y - d.y) < 2) return;
        const range = K.rampRange(d.start, d.kind);
        const next = K.moveRampPoint(d.start, d.kind, d.index, graphBoxT(box, m.x), graphBoxValue(box, d.kind, m.y, range));
        if (next) {
            K.setRamp(h.model, d.field, next);
            h.doc.setValue(RAMP_INPUT[d.kind], K.rampText(next, d.kind));
            h.ext.rampSel = d.index; h.ext.graphSig = '';
            paintGraph(h);
            d.moved = true;
        }
    } else {
        h.ext.rampDrag = null;
        if (d.moved) {
            const final = JSON.parse(JSON.stringify(h.model[d.field] || []));
            K.setRamp(h.model, d.field, d.start);
            h.run('точка рампы', (mm) => K.setRamp(mm, d.field, final));
        } else paintGraph(h);
    }
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
        /** Выбранная рампа графа: color | alpha | size. */
        curveKind(kind) {
            if (!K.RAMP_FIELDS[kind]) return false;
            h.ext.ramp = kind; h.ext.rampSel = -1; h.ext.rampDrag = null; h.ext.graphSig = '';
            h.renderAll();
            return true;
        },
        curveSelect(kind, i) {
            if (!K.RAMP_FIELDS[kind]) return -1;
            h.ext.ramp = kind;
            h.ext.rampSel = i >= 0 && i < rampIn(h, kind).length ? i : -1;
            h.ext.graphSig = '';
            paintGraph(h);
            return h.ext.rampSel;
        },
        /** Добавить точку графика. Та же операция у кнопки «+ Точка», клика по графику и агента. */
        curveAdd(kind, t, value) {
            const field = K.RAMP_FIELDS[kind];
            if (!field) return -1;
            const ramp = rampIn(h, kind);
            const at = t === undefined ? (ramp.length ? Math.min(1, (ramp[ramp.length - 1].t + 1) / 2) : 0.5) : t;
            const r = K.addRampPoint(ramp, kind, at, value === undefined ? K.rampDefaultValue(kind) : value);
            if (!r) { h.note('warning', 'SDK_PARTICLES_RAMP', 'В рампе уже 32 точки'); return -1; }
            h.ext.ramp = kind; h.ext.rampSel = r.index; h.ext.rampDrag = null; h.ext.graphSig = '';
            return h.run('точка рампы', (m) => K.setRamp(m, field, r.points)) === null ? -1 : r.index;
        },
        /** Удалить точку графика (последнюю не удаляем — так же, как проверяет validate). */
        curveRemove(kind, i) {
            const field = K.RAMP_FIELDS[kind];
            if (!field) return false;
            const index = i === undefined ? h.ext.rampSel : i;
            const next = K.removeRampPoint(rampIn(h, kind), index);
            if (!next) { h.note('warning', 'SDK_PARTICLES_RAMP', 'У рампы должна остаться хотя бы одна точка'); return false; }
            h.ext.ramp = kind; h.ext.rampSel = next.length ? Math.min(Math.max(0, index), next.length - 1) : -1; h.ext.graphSig = '';
            return h.run('точка рампы', (m) => K.setRamp(m, field, next)) !== null;
        },
        curveMove(kind, i, t, value) {
            const field = K.RAMP_FIELDS[kind];
            if (!field) return false;
            const next = K.moveRampPoint(rampIn(h, kind), kind, i, t, value);
            if (!next) return false;
            h.ext.ramp = kind; h.ext.rampSel = i; h.ext.graphSig = '';
            return h.run('точка рампы', (m) => K.setRamp(m, field, next)) !== null;
        },
        /** Копия рампы для отчёта/теста (не ссылка на модель). */
        ramp(kind) { return JSON.parse(JSON.stringify(rampIn(h, kind || rampKind(h)))); },

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
