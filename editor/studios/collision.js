// ===========================================================================
// Collision — студия Editor для `*.collision.json` (формат и applyShape —
// sdk/lib/kinds/collision.js). Фигуры рисуются поверх холста; режим «Физика»
// создаёт настоящие `<wall>/<trigger>/<area>` тем же applyShape, что и игра,
// и бросает шары в Box2D.
//
// Мышь: инструмент «Выбор» — выбрать/тянуть фигуру, ручки размера, вершины
// полигона; инструменты «+ фигура» — клик ставит фигуру в точку. Колесо —
// зум к курсору, СКМ — панорама. Одна протяжка — одна команда Undo.
// ===========================================================================

import * as K from '../../sdk/lib/kinds/collision.js';
import { createWorkspace, button } from '../lib/asset_workspace.js';
import { esc } from '../lib/studio_kit.js';

export const meta = { id: 'collision', title: 'Collision', icon: 'crop_square', match: (p) => /\.collision\.json$/i.test(p) };

const COLORS = { wall: '#ffb03a', trigger: '#4ad991', area: '#6cc7ff' };
const TOOLS = [['select', 'Выбор'], ['box', '+ Прямоуг.'], ['circle', '+ Круг'], ['capsule', '+ Капсула'], ['polygon', '+ Полигон']];
const SNAPS = [8, 16, 0];

/** Ручки выбранной фигуры в мире: 4 угла box, правый край circle, низ/бок capsule. */
export function shapeHandles(s) {
    if (!s) return [];
    const kind = s.shape || 'box';
    if (kind === 'box') return [['nw', -1, -1], ['ne', 1, -1], ['sw', -1, 1], ['se', 1, 1]].map(([handle, sx, sy]) => ({ handle, x: s.x + sx * s.w / 2, y: s.y + sy * s.h / 2 }));
    if (kind === 'circle') return [{ handle: 'r', x: s.x + s.radius, y: s.y }];
    if (kind === 'capsule') return [{ handle: 'cr', x: s.x + s.radius, y: s.y }, { handle: 'ch', x: s.x, y: s.y + s.h / 2 }];
    return [];
}

/** Патч геометрии от ручки: противоположный угол / центр остаются на месте. */
export function resizePatch(s, handle, x, y, step) {
    const snap = (v) => (step > 0 ? Math.round(v / step) * step : v);
    const kind = s.shape || 'box';
    if (kind === 'circle' && handle === 'r') return { radius: Math.max(1, snap(Math.hypot(x - s.x, y - s.y))) };
    if (kind === 'capsule' && handle === 'cr') return { radius: Math.max(1, Math.min(s.h / 2, snap(Math.abs(x - s.x)))) };
    if (kind === 'capsule' && handle === 'ch') return { h: Math.max(s.radius * 2, snap(Math.abs(y - s.y) * 2)) };
    if (kind !== 'box' || !/^[ns][ew]$/.test(handle)) return null;
    const north = handle[0] === 'n', east = handle[1] === 'e';
    const fx = east ? s.x - s.w / 2 : s.x + s.w / 2, fy = north ? s.y + s.h / 2 : s.y - s.h / 2;
    const w = Math.max(2, snap(Math.abs(x - fx))), h = Math.max(2, snap(Math.abs(y - fy)));
    return { x: east ? fx + w / 2 : fx - w / 2, y: north ? fy - h / 2 : fy + h / 2, w, h };
}

const clone = (v) => JSON.parse(JSON.stringify(v));

export function create(host) {
    const $ = host.$;
    const list = (w) => (Array.isArray(w.data.shapes) ? w.data.shapes : []);
    const cur = (w) => list(w)[w.selected] || null;
    const snapV = (w, v) => (w.ext.snap > 0 ? Math.round(v / w.ext.snap) * w.ext.snap : v);

    // Вид: центр мира (vx, vy) в центре холста, zoom. Всё в логических точках окна.
    function view(w) {
        const r = w.rect();
        return r ? { r, cx: r.x + r.w / 2, cy: r.y + r.h / 2, x: w.ext.vx, y: w.ext.vy, z: w.ext.zoom } : null;
    }
    const toScreen = (v, x, y) => ({ x: v.cx + (x - v.x) * v.z, y: v.cy + (y - v.y) * v.z });
    const toWorld = (v, sx, sy) => ({ x: v.x + (sx - v.cx) / v.z, y: v.y + (sy - v.cy) / v.z });

    function fit(w) {
        const r = w.rect(), shapes = list(w);
        if (!r || r.w <= 0) return;
        if (!shapes.length) { Object.assign(w.ext, { vx: 0, vy: 0, zoom: 1 }); return; }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of shapes) { const b = K.bounds(s); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
        const z = Math.max(0.05, Math.min(4, Math.min((r.w - 80) / Math.max(1, x1 - x0), (r.h - 80) / Math.max(1, y1 - y0))));
        Object.assign(w.ext, { vx: (x0 + x1) / 2, vy: (y0 + y1) / 2, zoom: z });
    }

    function shapeFields(w) {
        const s = cur(w);
        if (!s) return [];
        const kind = s.shape || 'box';
        const f = [{ key: 'name', label: 'Имя', optional: true }, { key: 'tag', label: 'Тег', options: K.TAGS, optional: true },
            { key: 'x', label: 'Центр x', number: true }, { key: 'y', label: 'Центр y', number: true }];
        if (kind === 'box') f.push({ key: 'w', label: 'Ширина', number: true }, { key: 'h', label: 'Высота', number: true });
        if (kind === 'circle') f.push({ key: 'radius', label: 'Радиус', number: true });
        if (kind === 'capsule') f.push({ key: 'radius', label: 'Радиус', number: true }, { key: 'h', label: 'Высота', number: true });
        if (kind === 'polygon') f.push({ key: 'points', label: 'Вершины', json: true });
        f.push({ key: 'sensor', label: 'sensor', bool: true, options: ['true', 'false'], optional: true },
            { key: 'oneWay', label: 'oneWay', bool: true, options: ['true', 'false'], optional: true },
            { key: 'oneWayAngle', label: 'oneWay угол', number: true, optional: true },
            { key: 'layerBits', label: 'layerBits', number: true, int: true, optional: true },
            { key: 'mask', label: 'mask', number: true, int: true, optional: true });
        return f;
    }

    function addShape(w, kind, x, y) {
        if (K.KINDS.indexOf(kind) < 0) return -1;
        let index = -1;
        w.edit('Фигура ' + kind, (m) => { m.shapes = m.shapes || []; m.shapes.push(K.newShape(kind, snapV(w, x), snapV(w, y))); index = m.shapes.length - 1; });
        if (index >= 0) w.select(index);
        return index;
    }
    function removeShape(w, i) {
        if (!list(w)[i]) return false;
        return w.edit('Удалить фигуру', (m) => { m.shapes.splice(i, 1); });
    }
    function duplicate(w, i) {
        const src = list(w)[i];
        if (!src) return -1;
        let index = -1;
        w.edit('Копия фигуры', (m) => {
            const c = clone(src); c.x += 16; c.y += 16; if (c.name) c.name += '_copy';
            m.shapes.push(c); index = m.shapes.length - 1;
        });
        if (index >= 0) w.select(index);
        return index;
    }
    function vertex(w, add) {
        const s = cur(w);
        if (!s || s.shape !== 'polygon') throw new Error('Вершины есть только у полигона');
        if (add && s.points.length >= 16) throw new Error('У полигона не больше 8 вершин');
        if (!add && s.points.length <= 6) throw new Error('У полигона не меньше 3 вершин');
        return w.edit(add ? 'Добавить вершину' : 'Удалить вершину', (m) => {
            const p = m.shapes[w.selected].points, n = p.length / 2;
            if (add) p.push(Math.round((p[(n - 1) * 2] + p[0]) / 2), Math.round((p[(n - 1) * 2 + 1] + p[1]) / 2));
            else p.splice(-2, 2);
        });
    }

    // --- Физика: тела создаёт preview(), поэтому каждая правка пересобирает их.
    function physics(w, on) {
        const e = w.ext;
        if (!!on === e.phys) return e.phys;
        e.phys = !!on;
        if (on) { e.savedGravity = $.world.gravity(); $.world.gravity(0, 1200); }
        else restoreGravity(w);
        w.rebuild(); w.render();
        return e.phys;
    }
    function restoreGravity(w) {
        const g = w.ext.savedGravity;
        if (g) { $.world.gravity(g.x, g.y); w.ext.savedGravity = null; }
    }
    // Шар ставится в очередь: тела физики пересобираются в начале кадра (preview),
    // и шар, созданный раньше, ушёл бы вместе с ними.
    function dropBall(w, x, y) {
        if (!w.ext.phys) physics(w, true);
        w.ext.queue.push({ x: x === undefined ? w.ext.vx : x, y: y === undefined ? w.ext.vy - 200 : y });
        return true;
    }
    function spawnBalls(w) {
        for (const q of w.ext.queue.splice(0)) {
            const ball = $('<npc>').at(q.x, q.y).size(20, 20).collisionCircle(10).appendTo($.world);
            ball.visible(false);
            w.ext.balls.push(ball); w.nodes.push(ball);
        }
    }

    // --- Мышь по холсту ---------------------------------------------------------
    function pointer(w, v) {
        const e = w.ext, p = w.point();
        if (!p) return null;
        const m = $.input.mouse(), world = toWorld(v, m.x, m.y);
        if (p.inside && !host.typing()) {
            const wheel = $.input.wheel().y;
            if (wheel) {
                e.zoom = Math.max(0.05, Math.min(16, e.zoom * (wheel > 0 ? 1.15 : 1 / 1.15)));
                e.vx = world.x - (m.x - v.cx) / e.zoom; e.vy = world.y - (m.y - v.cy) / e.zoom;
                e.userView = true;
            }
            if ($.input.mouseDown('middle') && e.last) { e.vx -= (m.x - e.last.x) / e.zoom; e.vy -= (m.y - e.last.y) / e.zoom; e.userView = true; }
        }
        e.last = m;
        const pressed = $.input.mousePressed('left'), down = $.input.mouseDown('left');
        if (pressed && p.inside && !host.typing() && !w.file.state.busy) press(w, v, m, world);
        if (e.drag && down) dragTo(w, world);
        if (e.drag && !down) release(w);
        e.hover = -1;
        if (p.inside) for (let i = list(w).length - 1; i >= 0; i--) if (K.hit(list(w)[i], world.x, world.y)) { e.hover = i; break; }
        e.mouseWorld = world;
        return world;
    }

    function press(w, v, m, world) {
        const e = w.ext;
        if (e.tool !== 'select') { addShape(w, e.tool, world.x, world.y); e.tool = 'select'; w.render(); return; }
        const s = cur(w);
        if (s && s.shape === 'polygon') {
            for (let i = 0; i < s.points.length; i += 2) {
                const q = toScreen(v, s.x + s.points[i], s.y + s.points[i + 1]);
                if (Math.hypot(q.x - m.x, q.y - m.y) <= 8) { e.drag = { mode: 'vertex', vi: i / 2, start: clone(s), moved: false }; return; }
            }
        }
        if (s) for (const q of shapeHandles(s)) {
            const c = toScreen(v, q.x, q.y);
            if (Math.hypot(c.x - m.x, c.y - m.y) <= 8) { e.drag = { mode: 'resize', handle: q.handle, start: clone(s), moved: false }; return; }
        }
        let hit = -1;
        for (let i = list(w).length - 1; i >= 0; i--) if (K.hit(list(w)[i], world.x, world.y)) { hit = i; break; }
        if (hit < 0) return;
        if (hit !== w.selected) w.select(hit);
        const sh = w.data.shapes[hit];
        e.drag = { mode: 'move', ox: world.x - sh.x, oy: world.y - sh.y, start: clone(sh), moved: false };
    }

    // Во время протяжки правим модель без истории; на отпускании — одна команда.
    function dragTo(w, world) {
        const d = w.ext.drag, s = cur(w);
        if (!s) { w.ext.drag = null; return; }
        if (d.mode === 'move') {
            const nx = snapV(w, world.x - d.ox), ny = snapV(w, world.y - d.oy);
            if (nx !== s.x || ny !== s.y) { s.x = nx; s.y = ny; d.moved = true; }
        } else if (d.mode === 'vertex') {
            s.points[d.vi * 2] = snapV(w, world.x - s.x); s.points[d.vi * 2 + 1] = snapV(w, world.y - s.y); d.moved = true;
        } else {
            const patch = resizePatch(s, d.handle, world.x, world.y, w.ext.snap);
            if (patch) { Object.assign(s, patch); d.moved = true; }
        }
    }

    function release(w) {
        const d = w.ext.drag;
        w.ext.drag = null;
        if (!d || !d.moved) return;
        const i = w.selected, end = clone(w.data.shapes[i]);
        w.data.shapes[i] = d.start;
        w.edit(d.mode === 'move' ? 'Перемещение' : d.mode === 'vertex' ? 'Вершина' : 'Размер', (m) => { m.shapes[i] = end; });
    }

    // --- Отрисовка ------------------------------------------------------------
    function draw(w, v) {
        const e = w.ext, r = v.r, line = (a, b, c, wd) => $.gfx.draw.line(a.x, a.y, b.x, b.y, c, wd);
        const clipX = (x) => Math.max(r.x, Math.min(r.x + r.w, x)), clipY = (y) => Math.max(r.y, Math.min(r.y + r.h, y));
        const step = (e.snap || 8) * 4;
        if (v.z * step >= 12) {
            const a = toWorld(v, r.x, r.y), b = toWorld(v, r.x + r.w, r.y + r.h);
            for (let x = Math.ceil(a.x / step) * step; x <= b.x; x += step) { const sx = toScreen(v, x, 0).x; $.gfx.draw.line(sx, r.y, sx, r.y + r.h, x === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)', 1); }
            for (let y = Math.ceil(a.y / step) * step; y <= b.y; y += step) { const sy = toScreen(v, 0, y).y; $.gfx.draw.line(r.x, sy, r.x + r.w, sy, y === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)', 1); }
        }
        const visible = (b) => { const a = toScreen(v, b.x0, b.y0), c = toScreen(v, b.x1, b.y1); return c.x >= r.x && a.x <= r.x + r.w && c.y >= r.y && a.y <= r.y + r.h; };
        list(w).forEach((s, i) => {
            if (!visible(K.bounds(s))) return;
            const sel = i === w.selected, hot = i === e.hover;
            const color = sel ? '#ff5a3c' : hot ? '#ffffff' : (COLORS[s.tag || 'wall'] || '#ffb03a');
            const wd = sel ? 2 : 1, kind = s.shape || 'box';
            if (kind === 'box') {
                const a = toScreen(v, s.x - s.w / 2, s.y - s.h / 2), b = toScreen(v, s.x + s.w / 2, s.y + s.h / 2);
                const x0 = clipX(a.x), y0 = clipY(a.y), x1 = clipX(b.x), y1 = clipY(b.y);
                if (!s.sensor && x1 > x0 && y1 > y0) $.gfx.draw.rect(x0, y0, x1 - x0, y1 - y0, 'rgba(255,176,58,0.12)');
                const pts = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }].map((q) => ({ x: clipX(q.x), y: clipY(q.y) }));
                for (let k = 0; k < 4; k++) line(pts[k], pts[(k + 1) % 4], color, wd);
            } else if (kind === 'circle') {
                const c = toScreen(v, s.x, s.y);
                $.gfx.draw.ring(c.x, c.y, s.radius * v.z, color, wd);
            } else if (kind === 'capsule') {
                const t = toScreen(v, s.x, s.y - s.h / 2 + s.radius), b = toScreen(v, s.x, s.y + s.h / 2 - s.radius), rr = s.radius * v.z;
                $.gfx.draw.ring(t.x, t.y, rr, color, wd); $.gfx.draw.ring(b.x, b.y, rr, color, wd);
                line({ x: t.x - rr, y: t.y }, { x: b.x - rr, y: b.y }, color, wd); line({ x: t.x + rr, y: t.y }, { x: b.x + rr, y: b.y }, color, wd);
            } else if (Array.isArray(s.points)) {
                const pts = [];
                for (let k = 0; k < s.points.length; k += 2) pts.push(toScreen(v, s.x + s.points[k], s.y + s.points[k + 1]));
                for (let k = 0; k < pts.length; k++) line(pts[k], pts[(k + 1) % pts.length], color, wd);
                if (sel) for (const q of pts) $.gfx.draw.rect(q.x - 4, q.y - 4, 8, 8, '#ff5a3c');
            }
            if (sel) for (const q of shapeHandles(s)) {
                const c = toScreen(v, q.x, q.y);
                $.gfx.draw.rect(c.x - 4, c.y - 4, 8, 8, '#ffffff'); $.gfx.draw.rect(c.x - 3, c.y - 3, 6, 6, '#ff5a3c');
            }
            if (s.oneWay) { const b = K.bounds(s), c = toScreen(v, (b.x0 + b.x1) / 2, b.y0); $.gfx.draw.arrow(c.x, c.y + 12, c.x, c.y - 4, '#4ad991'); }
        });
        for (const ball of e.balls) {
            const q = ball.pos(), c = toScreen(v, q.x, q.y);
            if (c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h) $.gfx.draw.ring(c.x, c.y, 10 * v.z, '#ffffff', 2);
        }
    }

    const def = {
        kind: K, title: 'Collision', listTitle: 'Фигуры',
        init(w) {
            Object.assign(w.ext, { vx: 0, vy: 0, zoom: 1, tool: 'select', snap: 8, phys: false, balls: [], queue: [], drag: null, hover: -1, userView: false, rectKey: '' });
        },
        items: (w) => list(w).map((s, i) => ({ label: s.name || (s.shape || 'box') + ' ' + i, detail: (s.tag || 'wall') + ' · ' + (s.shape || 'box') + (s.sensor ? ' · sensor' : '') + (s.oneWay ? ' · oneWay' : '') })),
        target: cur,
        fields: shapeFields,
        tools: (w) => TOOLS.map(([id, label]) => button('tool:' + id, label, w.ext.tool === id)).join('') +
            button('snap', w.ext.snap ? 'Шаг ' + w.ext.snap : 'Без шага') + button('fit', 'Вписать') +
            button('phys', w.ext.phys ? 'Физика: идёт' : 'Физика', w.ext.phys) + button('ball', 'Бросить шар'),
        actions: (w) => button('dup', 'Дублировать') + button('del', 'Удалить') +
            (cur(w) && cur(w).shape === 'polygon' ? button('vertex:add', '+ Вершина') + button('vertex:del', '- Вершина') : ''),
        library(w) {
            const file = String(w.file.state.path).split('/').pop();
            return '<span class="st-h">Теги</span>' + K.TAGS.map((t) => '<div class="st-row"><span style="color:' + COLORS[t] + ';">' + t + '</span><span class="st-sub">' +
                { wall: 'твёрдое тело', trigger: 'событие входа', area: 'зона' }[t] + '</span></div>').join('') +
                '<span class="st-h">В игре</span><div class="pt-code">' + esc(K.snippet(file)) + '</div>';
        },
        action(w, key) {
            if (key.startsWith('tool:')) { w.ext.tool = key.slice(5); w.render(); }
            else if (key === 'snap') { w.ext.snap = SNAPS[(SNAPS.indexOf(w.ext.snap) + 1) % SNAPS.length]; w.render(); }
            else if (key === 'fit') { fit(w); w.ext.userView = false; }
            else if (key === 'phys') physics(w, !w.ext.phys);
            else if (key === 'ball') dropBall(w);
            else if (key === 'dup') duplicate(w, w.selected);
            else if (key === 'del') removeShape(w, w.selected);
            else if (key === 'vertex:add') vertex(w, true);
            else if (key === 'vertex:del') vertex(w, false);
        },
        // Предпросмотр — только в режиме физики: настоящие тела игры, невидимые (рисуем контуры сами).
        preview(w) {
            w.ext.balls = [];
            if (!w.ext.phys) return;
            for (const s of list(w)) {
                const node = K.applyShape($('<' + (s.tag || 'wall') + '>').at(s.x, s.y), s).appendTo($.world);
                node.visible(false);
                w.nodes.push(node);
            }
        },
        release(w) { w.ext.balls = []; },
        deactivate(w) { w.ext.drag = null; w.ext.queue = []; if (w.ext.phys) { w.ext.phys = false; restoreGravity(w); } },
        update(w) {
            const e = w.ext, r = w.rect();
            if (!r) return;
            const rk = Math.round(r.w) + 'x' + Math.round(r.h);
            if (rk !== e.rectKey) { e.rectKey = rk; if (!e.userView) fit(w); }
            if (e.phys) spawnBalls(w);
            const v = view(w);
            pointer(w, v);
            draw(w, view(w));
        },
        hud(w) {
            const s = cur(w), m = w.ext.mouseWorld;
            return K.summary(w.data) + (s ? ' · ' + (s.name || s.shape || 'box') : '') + (m ? ' · мир (' + Math.round(m.x) + ', ' + Math.round(m.y) + ')' : '') +
                ' · ×' + w.ext.zoom.toFixed(2) + (w.ext.phys ? ' · физика, шаров ' + w.ext.balls.length : '') + ' · колесо — зум, СКМ — панорама';
        },
        ops: (w) => ({
            addShape: (kind, x, y) => addShape(w, kind, x === undefined ? w.ext.vx : x, y === undefined ? w.ext.vy : y),
            removeShape: (i) => removeShape(w, i),
            duplicate: (i) => duplicate(w, i),
            setShape: (i, patch) => w.edit('Фигура', (m) => { const s = m.shapes[i]; if (!s) throw new Error('Нет фигуры ' + i); for (const k of Object.keys(patch)) { if (patch[k] === null) delete s[k]; else s[k] = patch[k]; } }),
            screenOf(x, y) { const v = view(w); return v ? toScreen(v, x, y) : null; },
            physics: (on) => physics(w, on),
            dropBall: (x, y) => dropBall(w, x, y),
            ballPos: (i) => (w.ext.balls[i] ? w.ext.balls[i].pos() : null),
            bodies: () => w.nodes.length - w.ext.balls.length,
            fit: () => { fit(w); w.ext.userView = false; return w.ext.zoom; },
        }),
        snapshot: (w) => ({ shapes: list(w).length, physics: w.ext.phys, balls: w.ext.balls.length, zoom: w.ext.zoom, tool: w.ext.tool }),
    };
    return createWorkspace(host, def);
}
