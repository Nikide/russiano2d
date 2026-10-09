// ===========================================================================
// Collision / Physics Tools — фигуры коллизий уровня (формат `*.collision.json`,
// sdk/lib/kinds/collision.js): прямоугольники, круги, капсулы, полигоны,
// сенсоры, односторонние платформы, слои и маски.
//
// Это не физика: Box2D остаётся физикой R2D. Режим «Физика» создаёт из файла
// настоящие узлы `<wall>/<trigger>/<area>` тем же `applyShape`, что вызовет игра,
// и роняет на них шар — тела и столкновения считает движок.
// Мышь: ЛКМ — выбрать и двигать (шаг сетки), вершины полигона тянутся, СКМ —
// панорама, колесо — масштаб.
// ===========================================================================

import { openStudio } from '../lib/studio_host.js';
import * as K from '../lib/kinds/collision.js';
import { escapeHtml } from '../lib/model.js';
import { button, fieldRow, pairRow, parseNum } from '../lib/kit.js';

export const standalone = true;

const COLORS = { wall: '#ffb03a', trigger: '#4ad991', area: '#6cc7ff' };
const ADD = [['box', 'Прямоугольник'], ['circle', 'Круг'], ['capsule', 'Капсула'], ['polygon', 'Полигон']];

const cur = (h) => (h.model && h.model.shapes[h.sel] ? h.model.shapes[h.sel] : null);

function view(h) {
    const r = h.rect(), v = h.ext.view;
    return { r, cx: r.x + r.w / 2, cy: r.y + r.h / 2, ...v };
}
const toScreen = (h, x, y) => { const v = view(h); return { x: v.cx + (x - v.x) * v.zoom, y: v.cy + (y - v.y) * v.zoom }; };
const toWorld = (h, sx, sy) => { const v = view(h); return { x: v.x + (sx - v.cx) / v.zoom, y: v.y + (sy - v.cy) / v.zoom }; };
const snap = (h, v) => (h.ext.snap > 0 ? Math.round(v / h.ext.snap) * h.ext.snap : v);

function pointsText(s) { return (s.points || []).reduce((a, v, i) => a + (i % 2 ? ',' + v + ' ' : v), '').trim(); }

function parsePoints(text) {
    const nums = String(text || '').trim().split(/[\s,;]+/).filter(Boolean).map(Number);
    if (nums.length < 6 || nums.length > 16 || nums.length % 2 || nums.some((v) => !Number.isFinite(v))) throw new Error('Полигон: 3..8 вершин, пары чисел «x,y x,y …»');
    return nums;
}

const DEF = {
    id: 'collision-tools',
    title: 'Collision / Physics Tools',
    leftTitle: 'ФИГУРЫ',
    kind: K,

    count(h) { return h.model.shapes.length; },

    left(h) {
        if (!h.model.shapes.length) return '<p class="empty">Фигур нет: добавьте кнопками сверху.</p>';
        return '<div class="list grow">' + h.model.shapes.map((s, i) =>
            '<div class="row' + (i === h.sel ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + escapeHtml(s.name || s.shape + ' ' + i) +
            '</span><span class="row-dir">' + (s.tag || 'wall') + ' · ' + (s.shape || 'box') + (s.sensor ? ' · sensor' : '') + (s.oneWay ? ' · oneWay' : '') + '</span></div>').join('') + '</div>';
    },

    tools(h) {
        return ADD.map(([k, t]) => button('add:' + k, '+ ' + t, '')).join('') + button('dup', 'Дублировать', '') + button('del', 'Удалить', 'danger') +
            button('phys', h.ext.phys ? 'Физика: идёт' : 'Физика', h.ext.phys ? 'on' : '') + button('ball', 'Бросить шар', '') + button('fit', 'Вписать', '') +
            button('snap', 'Шаг ' + h.ext.snap, '');
    },

    right(h) {
        const s = cur(h);
        let html = '<h4>ФИГУРА</h4>';
        if (!s) return html + '<p class="empty">Выберите фигуру.</p>';
        const kind = s.shape || 'box';
        html += fieldRow({ id: 'co-name', label: 'Имя', value: s.name || '' }) +
            '<div class="field-row">' + K.TAGS.map((t) => button('tag:' + t, t, 'small' + ((s.tag || 'wall') === t ? ' on' : ''))).join('') + '</div>' +
            pairRow('Центр x, y', 'co-x', s.x, 'co-y', s.y);
        if (kind === 'box') html += pairRow('Ширина, высота', 'co-w', s.w, 'co-h', s.h);
        if (kind === 'circle') html += fieldRow({ id: 'co-r', label: 'Радиус', value: s.radius });
        if (kind === 'capsule') html += pairRow('Радиус, высота', 'co-r', s.radius, 'co-h', s.h);
        if (kind === 'polygon') html += fieldRow({ id: 'co-pts', label: 'Вершины', value: pointsText(s), hint: 'локальные «x,y x,y …», 3..8, выпуклый' }) +
            '<div class="field-row">' + button('addv', '+ Вершина', 'small') + button('delv', '− Вершина', 'small') + '</div>';
        html += '<div class="field-row">' + button('flag:sensor', 'sensor', 'small' + (s.sensor ? ' on' : '')) + button('flag:oneWay', 'oneWay', 'small' + (s.oneWay ? ' on' : '')) + '</div>' +
            fieldRow({ id: 'co-angle', label: 'oneWay угол', value: s.oneWayAngle === undefined ? '' : s.oneWayAngle, hint: 'радианы; пусто — вверх' }) +
            pairRow('layerBits, mask', 'co-bits', s.layerBits === undefined ? '' : s.layerBits, 'co-mask', s.mask === undefined ? '' : s.mask) +
            '<div class="field-row"><button class="btn small primary" data-key="apply">Применить</button></div>' +
            '<h4>ИСПОЛЬЗОВАНИЕ В ИГРЕ</h4><div class="log">' + escapeHtml(K.snippet(h.session.path.split('/').pop())) + '</div>' +
            '<div class="log">' + escapeHtml(K.applyShape.toString()) + '</div>';
        return html;
    },

    onLeft(h, key) { h.select(parseInt(key, 10)); },

    onTool(h, key) {
        const a = api(h);
        if (key.startsWith('add:')) a.addShape(key.slice(4));
        else if (key === 'dup') a.duplicate(h.sel);
        else if (key === 'del') a.removeShape(h.sel);
        else if (key === 'phys') a.physics(!h.ext.phys);
        else if (key === 'ball') a.dropBall();
        else if (key === 'fit') a.fit();
        else if (key === 'snap') { h.ext.snap = h.ext.snap === 8 ? 16 : h.ext.snap === 16 ? 0 : 8; h.renderAll(); }
    },

    onRight(h, key) {
        const a = api(h);
        if (key === 'apply') a.applyForm();
        else if (key.startsWith('tag:')) a.setShape(h.sel, { tag: key.slice(4) });
        else if (key.startsWith('flag:')) { const f = key.slice(5), s = cur(h); a.setShape(h.sel, { [f]: s[f] ? null : true }); }
        else if (key === 'addv') a.addVertex(h.sel);
        else if (key === 'delv') a.removeVertex(h.sel, (cur(h).points.length / 2) - 1);
    },

    mount(h) {
        Object.assign(h.ext, { view: { x: 480, y: 300, zoom: 1 }, snap: 8, phys: false, nodes: [], balls: [], drag: null, needFit: true, hover: -1 });
    },
    unmount(h) { api(h).physics(false); h.doc.html('ds-overlay', ''); },

    changed(h) { if (h.ext.phys) { api(h).physics(false); api(h).physics(true); } },

    tick(h) { frame(h); },

    hud(h) {
        const s = cur(h), m = toWorld(h, h.ptr.x, h.ptr.y);
        return (s ? (s.name || s.shape) + ' · ' : '') + 'мир (' + Math.round(m.x) + ', ' + Math.round(m.y) + ') · ×' + (Math.round(h.ext.view.zoom * 100) / 100) + (h.ext.phys ? ' · физика' : '');
    },

    snapshot(h) {
        return { shapes: h.model ? h.model.shapes.length : 0, selected: h.sel, physics: !!h.ext.phys, bodies: h.ext.nodes.length, balls: h.ext.balls.length, zoom: h.ext.view ? h.ext.view.zoom : 1 };
    },
    api(h) { return api(h); },
};

// --- Кадр: мышь, рисование фигур ------------------------------------------------------------------------------------------
function frame(h) {
    const $ = h.$, p = h.ptr, e = h.ext;
    if (!h.model) return;
    if (e.needFit && h.rect().w > 0) { api(h).fit(); e.needFit = false; }
    const v = e.view;

    if (p.inside && p.wheel !== 0) {
        const before = toWorld(h, p.x, p.y);
        v.zoom = Math.max(0.1, Math.min(8, v.zoom * (p.wheel > 0 ? 1.15 : 1 / 1.15)));
        const vv = view(h);
        v.x = before.x - (p.x - vv.cx) / v.zoom;
        v.y = before.y - (p.y - vv.cy) / v.zoom;
    }
    if (p.middle && (p.dx || p.dy)) { v.x -= p.dx / v.zoom; v.y -= p.dy / v.zoom; }

    const w = toWorld(h, p.x, p.y);
    if (p.pressed) {
        // Вершина выбранного полигона важнее тела фигуры.
        const s = cur(h);
        let vi = -1;
        if (s && (s.shape === 'polygon')) {
            for (let i = 0; i < s.points.length; i += 2) {
                const q = toScreen(h, s.x + s.points[i], s.y + s.points[i + 1]);
                if (Math.hypot(q.x - p.x, q.y - p.y) <= 9) { vi = i / 2; break; }
            }
        }
        if (vi >= 0) e.drag = { mode: 'vertex', vi, start: JSON.parse(JSON.stringify(s)) };
        else {
            let hit = -1;
            for (let i = h.model.shapes.length - 1; i >= 0; i--) if (K.hit(h.model.shapes[i], w.x, w.y)) { hit = i; break; }
            if (hit >= 0) {
                if (hit !== h.sel) h.select(hit);
                const sh = h.model.shapes[hit];
                e.drag = { mode: 'move', ox: w.x - sh.x, oy: w.y - sh.y, moved: false, start: JSON.parse(JSON.stringify(sh)) };
            } else { e.drag = null; }
        }
    }
    if (p.down && e.drag) {
        const s = cur(h);
        if (s) {
            if (e.drag.mode === 'move') {
                const nx = snap(h, w.x - e.drag.ox), ny = snap(h, w.y - e.drag.oy);
                if (nx !== s.x || ny !== s.y) { s.x = nx; s.y = ny; e.drag.moved = true; }
            } else if (e.drag.mode === 'vertex') {
                s.points[e.drag.vi * 2] = snap(h, w.x - s.x);
                s.points[e.drag.vi * 2 + 1] = snap(h, w.y - s.y);
                e.drag.moved = true;
            }
        }
    }
    if (p.released && e.drag) {
        const d = e.drag; e.drag = null;
        if (d.moved) {
            // Сначала вернуть прежнее состояние, затем применить итог одной командой (один шаг undo).
            const s = cur(h);
            const end = JSON.parse(JSON.stringify(s));
            Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, d.start);
            h.run(d.mode === 'move' ? 'перемещение' : 'вершина', (m) => { Object.keys(m.shapes[h.sel]).forEach((k) => delete m.shapes[h.sel][k]); Object.assign(m.shapes[h.sel], end); });
        }
    }
    e.hover = -1;
    if (p.inside) for (let i = h.model.shapes.length - 1; i >= 0; i--) if (K.hit(h.model.shapes[i], w.x, w.y)) { e.hover = i; break; }

    // Камера рантайма совпадает с видом студии: настоящие узлы физики лежат там же, где рамки.
    const win = $.gfx.size(), r = view(h);
    $.camera.at(v.x + (win.w / 2 - r.cx) / v.zoom, v.y + (win.h / 2 - r.cy) / v.zoom).zoom(v.zoom);

    drawShapes(h);
    if ($.time.frame() % 6 === 0) h.hud();
}

function drawShapes(h) {
    const $ = h.$, e = h.ext, v = e.view;
    const r = h.rect();
    if (e.snap > 0 && v.zoom * e.snap >= 5) {
        const a = toWorld(h, r.x, r.y), b = toWorld(h, r.x + r.w, r.y + r.h);
        const step = e.snap * 4;
        for (let x = Math.ceil(a.x / step) * step; x <= b.x; x += step) { const s = toScreen(h, x, 0).x; $.gfx.draw.line(s, r.y, s, r.y + r.h, 'rgba(255,255,255,0.06)', 1); }
        for (let y = Math.ceil(a.y / step) * step; y <= b.y; y += step) { const s = toScreen(h, 0, y).y; $.gfx.draw.line(r.x, s, r.x + r.w, s, 'rgba(255,255,255,0.06)', 1); }
    }
    h.model.shapes.forEach((s, i) => {
        const sel = i === h.sel, hot = i === e.hover;
        const color = sel ? '#ff5a3c' : hot ? '#ffffff' : (COLORS[s.tag || 'wall'] || '#ffb03a');
        const width = sel ? 2 : 1;
        const kind = s.shape || 'box';
        if (kind === 'box') {
            const a = toScreen(h, s.x - s.w / 2, s.y - s.h / 2), b = toScreen(h, s.x + s.w / 2, s.y + s.h / 2);
            if (!s.sensor) $.gfx.draw.rect(a.x, a.y, b.x - a.x, b.y - a.y, 'rgba(255,176,58,0.14)');
            outline(h, [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]], color, width);
        } else if (kind === 'circle') {
            const c = toScreen(h, s.x, s.y);
            $.gfx.draw.ring(c.x, c.y, s.radius * v.zoom, color, width);
        } else if (kind === 'capsule') {
            const t = toScreen(h, s.x, s.y - s.h / 2 + s.radius), b = toScreen(h, s.x, s.y + s.h / 2 - s.radius);
            $.gfx.draw.ring(t.x, t.y, s.radius * v.zoom, color, width);
            $.gfx.draw.ring(b.x, b.y, s.radius * v.zoom, color, width);
            const l = toScreen(h, s.x - s.radius, 0).x, rr = toScreen(h, s.x + s.radius, 0).x;
            $.gfx.draw.line(l, t.y, l, b.y, color, width);
            $.gfx.draw.line(rr, t.y, rr, b.y, color, width);
        } else if (kind === 'polygon' && Array.isArray(s.points)) {
            const pts = [];
            for (let k = 0; k < s.points.length; k += 2) { const q = toScreen(h, s.x + s.points[k], s.y + s.points[k + 1]); pts.push([q.x, q.y]); }
            outline(h, pts, color, width);
            if (sel) for (const q of pts) $.gfx.draw.rect(q[0] - 4, q[1] - 4, 8, 8, '#ff5a3c');
        }
        if (s.oneWay) {
            const b = K.bounds(s), c = toScreen(h, (b.x0 + b.x1) / 2, b.y0);
            $.gfx.draw.arrow(c.x, c.y + 12, c.x, c.y - 4, '#4ad991');
        }
    });
    for (const ball of e.balls) {
        const q = ball.pos();
        const c = toScreen(h, q.x, q.y);
        $.gfx.draw.ring(c.x, c.y, 10 * v.zoom, '#ffffff', 2);
    }
}

function outline(h, pts, color, width) {
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        h.$.gfx.draw.line(a[0], a[1], b[0], b[1], color, width);
    }
}

// --- Операции -----------------------------------------------------------------------------------------------------------------------
function api(h) {
    const $ = h.$;
    const num = (t) => parseNum(t);
    const pos = (t, label) => { const v = num(t); if (v === null || Number.isNaN(v)) throw new Error(label + ' — число'); return v; };
    const posNum = (t, label) => { const v = pos(t, label); if (!(v > 0)) throw new Error(label + ' — число больше нуля'); return v; };
    return {
        addShape(kind, x, y) {
            const v = h.ext.view;
            const i = h.run('фигура ' + kind, (m) => { m.shapes.push(K.newShape(kind, snap(h, x === undefined ? v.x : x), snap(h, y === undefined ? v.y : y))); return m.shapes.length - 1; });
            if (i !== null) h.select(i);
            return i;
        },
        removeShape(i) { return h.run('удаление фигуры', (m) => { if (!m.shapes[i]) throw new Error('Нет фигуры ' + i); m.shapes.splice(i, 1); }) !== null; },
        duplicate(i) {
            const r = h.run('копия фигуры', (m) => {
                if (!m.shapes[i]) throw new Error('Нет фигуры ' + i);
                const c = JSON.parse(JSON.stringify(m.shapes[i]));
                c.x += 16; c.y += 16; if (c.name) c.name += '_copy';
                m.shapes.push(c);
                return m.shapes.length - 1;
            });
            if (r !== null) h.select(r);
            return r;
        },
        /** Частичная правка фигуры; `null` убирает поле. */
        setShape(i, patch) {
            return h.run('фигура', (m) => {
                const s = m.shapes[i];
                if (!s) throw new Error('Нет фигуры ' + i);
                for (const k of Object.keys(patch)) { if (patch[k] === null) delete s[k]; else s[k] = patch[k]; }
            }) !== null;
        },
        moveShape(i, x, y) { return this.setShape(i, { x, y }); },
        setPoint(i, vi, x, y) {
            return h.run('вершина', (m) => { const s = m.shapes[i]; s.points[vi * 2] = x; s.points[vi * 2 + 1] = y; }) !== null;
        },
        addVertex(i) {
            return h.run('вершина', (m) => {
                const s = m.shapes[i];
                if (!s || s.shape !== 'polygon') throw new Error('Вершины есть только у полигона');
                if (s.points.length >= 16) throw new Error('У полигона не больше 8 вершин');
                const n = s.points.length / 2;
                const ax = s.points[(n - 1) * 2], ay = s.points[(n - 1) * 2 + 1], bx = s.points[0], by = s.points[1];
                s.points.splice(n * 2, 0, Math.round((ax + bx) / 2), Math.round((ay + by) / 2));
            }) !== null;
        },
        removeVertex(i, vi) {
            return h.run('вершина', (m) => {
                const s = m.shapes[i];
                if (!s || s.shape !== 'polygon') throw new Error('Вершины есть только у полигона');
                if (s.points.length <= 6) throw new Error('У полигона не меньше 3 вершин');
                s.points.splice(vi * 2, 2);
            }) !== null;
        },
        applyForm() {
            const s = cur(h);
            if (!s) return false;
            const kind = s.shape || 'box', d = h.doc, v = (id) => d.value(id);
            return h.run('фигура', (m) => {
                const t = m.shapes[h.sel];
                const name = String(v('co-name') || '').trim();
                if (name) t.name = name; else delete t.name;
                t.x = pos(v('co-x'), 'x'); t.y = pos(v('co-y'), 'y');
                if (kind === 'box') { t.w = posNum(v('co-w'), 'Ширина'); t.h = posNum(v('co-h'), 'Высота'); }
                if (kind === 'circle') t.radius = posNum(v('co-r'), 'Радиус');
                if (kind === 'capsule') { t.radius = posNum(v('co-r'), 'Радиус'); t.h = posNum(v('co-h'), 'Высота'); }
                if (kind === 'polygon') t.points = parsePoints(v('co-pts'));
                const ang = num(v('co-angle'));
                if (ang === null) delete t.oneWayAngle; else if (Number.isNaN(ang)) throw new Error('oneWay угол — число'); else t.oneWayAngle = ang;
                for (const [k, id] of [['layerBits', 'co-bits'], ['mask', 'co-mask']]) {
                    const n = num(v(id));
                    if (n === null) delete t[k]; else if (Number.isNaN(n) || n < 0 || Math.floor(n) !== n) throw new Error(k + ' — целое ≥ 0'); else t[k] = n;
                }
            }) !== null;
        },
        fit() {
            const shapes = h.model.shapes;
            const r = h.rect();
            if (!shapes.length || r.w <= 0) { h.ext.view = { x: 480, y: 300, zoom: 1 }; return 1; }
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const s of shapes) { const b = K.bounds(s); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
            const z = Math.max(0.1, Math.min(4, Math.min((r.w - 80) / Math.max(1, x1 - x0), (r.h - 80) / Math.max(1, y1 - y0))));
            h.ext.view = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.floor(z * 100) / 100 };
            return h.ext.view.zoom;
        },
        /** Режим физики: настоящие узлы и тела Box2D из файла, тем же applyShape, что у игры. */
        physics(on) {
            const e = h.ext;
            for (const n of e.nodes) n.remove();
            for (const b of e.balls) b.remove();
            e.nodes = []; e.balls = [];
            if (e.savedGravity && !on) { $.world.gravity(e.savedGravity.x, e.savedGravity.y); e.savedGravity = null; }
            e.phys = !!on;
            if (on) {
                e.savedGravity = e.savedGravity || $.world.gravity();
                $.world.gravity(0, 1200);
                for (const s of h.model.shapes) {
                    const node = K.applyShape($('<' + (s.tag || 'wall') + '>').at(s.x, s.y), s).appendTo($.world);
                    node.visible(false);
                    e.nodes.push(node);
                }
            }
            h.renderAll();
            return e.phys;
        },
        dropBall(x, y) {
            if (!h.ext.phys) this.physics(true);
            const v = h.ext.view;
            const ball = $('<npc>').at(x === undefined ? v.x : x, y === undefined ? v.y - 200 : y).size(20, 20).collisionCircle(10).appendTo($.world);
            ball.visible(false);
            h.ext.balls.push(ball);
            return ball;
        },
        balls: () => h.ext.balls,
        nodes: () => h.ext.nodes,
    };
}

export async function open(app, args) {
    return openStudio(app, DEF, args);
}
