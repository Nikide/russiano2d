// ===========================================================================
// World Editor: четыре вьюпорта (Top/XY, Front/XZ, Side/YZ, 3D).
//
// Здесь только ортопроекция, панорама/зум, сетка и разметка RmlUi (divы с
// абсолютными координатами). Никакого второго рендерера: 3D-панель показывает
// настоящий runtime world через $.re2dWorld.fromJSON + renderToSprite
// (как Re2D World Studio), а ортопанели рисуют те же данные модели.
// ===========================================================================

import { escapeHtml } from '../model.js';
import { ELEMENT_KINDS, entityPos, pathNodes, displayItems } from './model.js';

export const VIEW_DEFS = [
    { id: 'top', title: 'Top / XY', plane: 'xy' },
    { id: 'front', title: 'Front / XZ', plane: 'xz' },
    { id: 'side', title: 'Side / YZ', plane: 'yz' },
    { id: '3d', title: '3D', plane: '3d' },
];

function axis(plane) {
    if (plane === 'xz') return { u: 'x', v: 'z', sign: -1 };
    if (plane === 'yz') return { u: 'y', v: 'z', sign: -1 };
    return { u: 'x', v: 'y', sign: 1 };
}

export function createViewports(gridSize) {
    const views = VIEW_DEFS.map((def) => ({
        id: def.id,
        title: def.title,
        plane: def.plane,
        panX: 0,
        panY: 0,
        zoom: 1,
        width: 0,
        height: 0,
        rect: { x: 0, y: 0, w: 0, h: 0 },
    }));
    const state = {
        active: 'top',
        maximized: null,
        grid: true,
        gridSize: gridSize || 16,
        snap: true,
    };

    const byId = (id) => views.find((v) => v.id === id) || null;

    function setSize(id, width, height, rect) {
        const view = byId(id);
        if (!view) return;
        view.width = Math.max(0, Number(width) || 0);
        view.height = Math.max(0, Number(height) || 0);
        if (rect) view.rect = rect;
    }

    function activate(id) {
        if (byId(id)) state.active = id;
        return state.active;
    }

    function maximize(id) {
        state.maximized = (id && byId(id)) ? id : null;
        return state.maximized;
    }

    function restore() {
        state.maximized = null;
        return state.maximized;
    }

    function setGrid(on) {
        state.grid = !!on;
        return state.grid;
    }

    function setGridSize(size) {
        const n = Number(size);
        if (Number.isFinite(n) && n > 0) state.gridSize = n;
        return state.gridSize;
    }

    function snapValue(value) {
        if (!state.snap) return value;
        const step = state.gridSize;
        return Math.round(Number(value) / step) * step;
    }

    function snapPoint(x, y) {
        const u = snapValue(x), v = snapValue(y);
        return { u: u, v: v, x: u, y: v };
    }

    // --- Ортопроекция --------------------------------------------------------

    function projectPoint(view, wx, wy, wz) {
        const ax = axis(view.plane);
        const u = ax.u === 'x' ? wx : wy;
        const v = ax.v === 'z' ? wz : wy;
        return {
            x: view.width / 2 + (u - view.panX) * view.zoom,
            y: view.height / 2 + ax.sign * (v - view.panY) * view.zoom,
        };
    }

    function unproject(view, sx, sy) {
        const ax = axis(view.plane);
        const u = view.panX + (sx - view.width / 2) / view.zoom;
        const v = view.panY + ax.sign * (sy - view.height / 2) / view.zoom;
        if (view.plane === 'xy') return { u: u, v: v, x: u, y: v, z: 0 };
        if (view.plane === 'xz') return { u: u, v: v, x: u, y: 0, z: v };
        return { u: u, v: v, x: 0, y: u, z: v };
    }

    /** Экранный прямоугольник объекта в координатах вьюпорта. */
    function projectBox(view, box) {
        if (!box) return null;
        if (view.plane === '3d') return null;
        if (view.plane === 'xy') {
            const a = projectPoint(view, box.x, box.y, 0);
            const b = projectPoint(view, box.x + box.w, box.y + box.h, 0);
            return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
        }
        const ax = axis(view.plane);
        const u0 = ax.u === 'x' ? box.x : box.y;
        const u1 = u0 + (ax.u === 'x' ? box.w : box.h);
        const bottom = Number.isFinite(box.bottom) ? box.bottom : 0;
        const top = Number.isFinite(box.top) && box.top > bottom ? box.top : bottom + 4;
        const a = projectPoint(view, ax.u === 'x' ? u0 : ax.u === 'y' ? u0 : 0, ax.u === 'y' ? u0 : 0, bottom);
        const b = projectPoint(view, ax.u === 'x' ? u1 : 0, ax.u === 'y' ? u1 : 0, top);
        return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    }

    function zoomAt(id, factor, lx, ly) {
        const view = byId(id);
        if (!view || view.plane === '3d') return view;
        const before = unproject(view, lx, ly);
        const next = Math.max(0.02, Math.min(20, view.zoom * factor));
        if (next === view.zoom) return view;
        view.zoom = next;
        const after = unproject(view, lx, ly);
        view.panX += before.u - after.u;
        view.panY += before.v - after.v;
        return view;
    }

    function panBy(id, dx, dy) {
        const view = byId(id);
        if (!view || view.plane === '3d') return view;
        const ax = axis(view.plane);
        view.panX -= dx / view.zoom;
        view.panY -= ax.sign * dy / view.zoom;
        return view;
    }

    function center(id, x, y, z, zoom) {
        const view = byId(id);
        if (!view || view.plane === '3d') return view;
        if (view.plane === 'xy') { view.panX = x; view.panY = y; }
        else if (view.plane === 'xz') { view.panX = x; view.panY = z; }
        else { view.panX = y; view.panY = z; }
        if (zoom) view.zoom = Math.max(0.02, Math.min(20, zoom));
        return view;
    }

    /** Показать bbox целиком во всех ортопанелях (Focus / Fit). */
    function focus(bounds) {
        if (!bounds) return;
        const cx = bounds.x + bounds.w / 2;
        const cy = bounds.y + bounds.h / 2;
        const cz = (bounds.bottom || 0) + ((bounds.top || 0) - (bounds.bottom || 0)) / 2;
        for (const view of views) {
            if (view.plane === '3d' || view.width < 2 || view.height < 2) continue;
            const spanU = (view.plane === 'yz') ? bounds.h : bounds.w;
            const spanV = (view.plane === 'xy') ? bounds.h : Math.max(1, (bounds.top || 0) - (bounds.bottom || 0));
            const fit = Math.min((view.width - 70) / Math.max(1, spanU), (view.height - 70) / Math.max(1, spanV));
            center(view.id, cx, cy, cz, Math.max(0.02, Math.min(20, fit)));
        }
    }

    function focusSelection(selection, map) {
        if (!selection || selection.kind === 'none') return false;
        if (selection.kind === 'world') return false;
        const item = displayItems(map).find((v) => v.kind === selection.kind && selection.ids.includes(v.id));
        if (!item) return false;
        const box = item.box || { x: 0, y: 0, w: 64, h: 64 };
        focus({
            x: box.x, y: box.y, w: Math.max(1, box.w), h: Math.max(1, box.h),
            bottom: item.bottom || 0, top: Math.max(item.top || 0, (item.bottom || 0) + 1),
        });
        return true;
    }

    // --- Разметка -------------------------------------------------------------

    function gridLines(view) {
        if (!state.grid || view.plane === '3d' || view.width < 2 || view.height < 2) return '';
        let step = state.gridSize * Math.max(1, Math.round(1));
        while (step * view.zoom < 9) step *= 2;
        if (step * view.zoom > 400) step = Math.max(1, step / 4);
        const ax = axis(view.plane);
        const halfU = view.width / 2 / view.zoom;
        const halfV = view.height / 2 / view.zoom;
        const u0 = view.panX - halfU, u1 = view.panX + halfU;
        const v0 = view.panY - halfV, v1 = view.panY + halfV;
        const parts = [];
        let count = 0;
        const startU = Math.floor(u0 / step) * step;
        for (let u = startU; u <= u1 && count < 200; u += step, count++) {
            const sx = projectPoint(view, ax.u === 'x' ? u : 0, ax.u === 'y' ? u : 0, 0).x;
            if (sx < 0 || sx > view.width) continue;
            parts.push('<div class="we-grid-line v" style="left:' + sx.toFixed(1) + 'px;top:0px;width:1px;height:100%;"></div>');
        }
        count = 0;
        const startV = Math.floor(v0 / step) * step;
        for (let v = startV; v <= v1 && count < 200; v += step, count++) {
            const sy = projectPoint(view, ax.v === 'z' ? 0 : 0, ax.v === 'y' ? v : 0, ax.v === 'z' ? v : 0).y;
            if (sy < 0 || sy > view.height) continue;
            parts.push('<div class="we-grid-line h" style="left:0px;top:' + sy.toFixed(1) + 'px;width:100%;height:1px;"></div>');
        }
        return parts.join('');
    }

    // RmlUi не гарантирует clip абсолютных потомков, поэтому координаты
    // разметки обрезаем по размеру панели (это только отображение).
    function rectDiv(view, cls, x, y, w, h, extra, key, label) {
        const x0 = Math.max(0, x), y0 = Math.max(0, y);
        const x1 = Math.min(view.width, x + w), y1 = Math.min(view.height, y + h);
        if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return '';
        return '<div class="we-shape ' + cls + '" data-key="' + escapeHtml(key) + '" style="left:' + x0.toFixed(1) +
            'px;top:' + y0.toFixed(1) + 'px;width:' + (x1 - x0).toFixed(1) + 'px;height:' + (y1 - y0).toFixed(1) +
            'px;' + (extra || '') + '">' + (label ? escapeHtml(label) : '') + '</div>';
    }

    // Обрезка линии по панели нужна только для показа authoring-координат.
    function lineDiv(view, a, b, color, selected, key, label) {
        const dx=b.x-a.x,dy=b.y-a.y;
        let lo=0,hi=1;
        for(const [p,q] of [[-dx,a.x],[dx,view.width-a.x],[-dy,a.y],[dy,view.height-a.y]]) {
            if(p===0){if(q<0)return '';continue;}
            const t=q/p;
            if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
            if(lo>hi)return '';
        }
        const x=a.x+lo*dx,y=a.y+lo*dy,length=(hi-lo)*Math.hypot(dx,dy);
        return '<div class="we-shape'+(selected?' we-sel':'')+'" data-key="'+escapeHtml(key)+'" style="left:'+x+'px;top:'+y+
            'px;width:'+Math.max(2,length)+'px;height:3px;background-color:'+escapeHtml(color)+
            ';transform-origin:0px 0px;transform:rotate('+Math.atan2(dy,dx)+'rad);">'+escapeHtml(label)+'</div>';
    }

    function buildOverlay(view, ctx) {
        if (view.plane === '3d' || view.width < 2 || view.height < 2) return '';
        const map = ctx.map, selection = ctx.selection || { kind: 'none', ids: [] };
        const parts = [gridLines(view)];

        // Конверт мира.
        if (map && map.world) {
            const w = map.world;
            const box = projectBox(view, {
                x: Number(w.x) || 0, y: Number(w.y) || 0,
                w: Number(w.w) || 0, h: Number(w.h) || 0,
                bottom: Number(w.bottom) || 0, top: Number(w.top) || 0,
            });
            if (box) parts.push(rectDiv(view, 'we-world', box.x, box.y, box.w, box.h, '', 'world', ''));
        }

        for (const item of displayItems(map)) {
            if (item.kind === 'brush') {
                const brush = item.data;
                const box = projectBox(view, {
                    x: item.box ? item.box.x : 0, y: item.box ? item.box.y : 0,
                    w: item.box ? item.box.w : 0, h: item.box ? item.box.h : 0,
                    bottom: item.bottom, top: item.top,
                });
                if (!box) continue;
                const selected = selection.kind === 'brush' && selection.ids.includes(item.id);
                const color = brush.sideColor || '#7faaca';
                parts.push(rectDiv(view, 'we-brush' + (selected ? ' we-sel' : '') + (brush.tool && brush.tool !== 'solid' ? ' we-tool-' + brush.tool : ''),
                    box.x, box.y, box.w, box.h,
                    'border-color:' + escapeHtml(color) + ';background-color:' + escapeHtml(color) + '33;',
                    'brush:' + item.id, item.id));
            } else if(ELEMENT_KINDS[item.kind]) {
                const box=projectBox(view,{...item.box,bottom:item.bottom,top:item.top});
                if(!box)continue;
                const selected=selection.kind===item.kind&&selection.ids.includes(item.id);
                const color=item.data.color||(item.kind==='cell'?'#81b7e3':item.kind==='portal'?'#83dba4':item.kind==='light'?'#ffd06a':'#c19aff');
                if(view.plane==='xy' && (item.kind==='wall'||item.kind==='portal') && Array.isArray(item.data.from)&&Array.isArray(item.data.to)) {
                    const a=projectPoint(view,item.data.from[0],item.data.from[1],0),b=projectPoint(view,item.data.to[0],item.data.to[1],0);
                    parts.push(lineDiv(view,a,b,color,selected,item.kind+':'+item.id,item.id));
                    continue;
                }
                parts.push(rectDiv(view,'we-brush'+(selected?' we-sel':''),box.x,box.y,Math.max(3,box.w),Math.max(3,box.h),
                    'border-color:'+escapeHtml(color)+';background-color:'+escapeHtml(color)+'22;',item.kind+':'+item.id,item.id));
            } else if (item.kind === 'entity') {
                const p = entityPos(item.data);
                const box = projectBox(view, { x: p.x - 6, y: p.y - 6, w: 12, h: 12, bottom: p.h, top: p.h + 4 });
                if (!box) continue;
                const selected = selection.kind === 'entity' && selection.ids.includes(item.id);
                parts.push(rectDiv(view, 'we-entity' + (selected ? ' we-sel' : ''), box.x, box.y, box.w, box.h, '', 'entity:' + item.id, item.id));
            } else if (item.kind === 'path') {
                const nodes = pathNodes(item.data);
                for (let i = 0; i < nodes.length; i++) {
                    const a = nodes[i];
                    const pa = projectPoint(view, Number(a.x) || 0, Number(a.y) || 0, Number(a.h) || 0);
                    const selected = selection.kind === 'path' && selection.ids.includes(item.id);
                    parts.push(rectDiv(view, 'we-path-node' + (selected ? ' we-sel' : ''),
                        pa.x - 4, pa.y - 4, 8, 8, '', 'path:' + item.id + ':' + i, String(i + 1)));
                    if (i + 1 < nodes.length) {
                        const b = nodes[i + 1];
                        const pb = projectPoint(view, Number(b.x) || 0, Number(b.y) || 0, Number(b.h) || 0);
                        const dx = pb.x - pa.x, dy = pb.y - pa.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        parts.push(rectDiv(view, 'we-path-seg', pa.x, pa.y, len, 2,
                            'transform-origin:0px 0px;transform:rotate(' + Math.atan2(dy, dx) + 'rad);background-color:#83dba4;',
                            'path:' + item.id, ''));
                    }
                }
            }
        }
        if (ctx.dragRect) {
            const r = ctx.dragRect;
            parts.push('<div class="we-drag-rect" style="left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px;"></div>');
        }
        return parts.join('');
    }

    return {
        state, views, byId, setSize, activate, maximize, restore, setGrid, setGridSize, snapValue, snapPoint,
        projectPoint, unproject, projectBox, zoomAt, panBy, center, focus, focusSelection, buildOverlay, gridLines,
    };
}
