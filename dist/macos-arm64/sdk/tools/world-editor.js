// ===========================================================================
// World Editor — универсальный Hammer-like редактор Re2D-мира.
//
// Первоклассный встроенный инструмент SDK (sdk_tools.json: world-editor).
// Рендер/UI — только RmlUi (sdk/ui/world_editor.rml + .rcss), сцена — тот же
// runtime $.re2dWorld (3D-панель), геометрия — только native world-edit.
//
// Публичный фасад: app.studios.world (ключ ровно world). Снимок детерминирован
// и компактен; каждая кнопка/меню вызывает ту же операцию, что агент и CLI.
// ===========================================================================

import { createSession } from '../lib/world_editor/session.js';
import { createSelection } from '../lib/world_editor/selection.js';
import { createViewports } from '../lib/world_editor/viewport.js';
import { createCommands } from '../lib/world_editor/commands.js';
import { createWorldExtensionHost } from '../lib/world_editor/extension_host.js';
import * as M from '../lib/world_editor/model.js';
import { escapeHtml as esc, summarize } from '../lib/model.js';
import * as views from '../lib/views.js';

export const standalone = true;

const TOOLS = ['select', 'block', 'move', 'resize', 'rotate', 'vertex', 'clip', 'face', 'entity', 'path'];
const TOOL_IDS = {
    select: 'we-tool-select', block: 'we-tool-block', move: 'we-tool-move', resize: 'we-tool-resize',
    rotate: 'we-tool-rotate', vertex: 'we-tool-vertex', clip: 'we-tool-clip', face: 'we-tool-face',
    entity: 'we-tool-entity', path: 'we-tool-path',
};
const VIEW_PANES = { top: 'we-pane-top', front: 'we-pane-front', side: 'we-pane-side', '3d': 'we-pane-3d' };
const VIEW_ROWS = { top: 'we-row-a', front: 'we-row-b', side: 'we-row-b', '3d': 'we-row-a' };

let singleton = null;

export async function open(app, args) {
    if (!singleton) singleton = createEditor(app);
    return singleton.open(args || {});
}

export function createEditor(app) {
    const $ = app.$;
    const doc = $.ui.doc('sdk/ui/world_editor.rml');
    const viewports = createViewports(16);
    let session = null;
    const selection = createSelection(() => session.state.map);
    session = createSession(app);
    const ext = createWorldExtensionHost(app);
    const s = {
        active: false,
        tool: 'select',
        tab: 'world',
        filter: '',
        wired: false,
        drag: null,
        wasDown: false,
        diagnostics: [],
        status: 'готов',
        fitted: false,
        lastChange: null,
        clipKeep: 'both',
        face: 'side',
        entityClass: 'base.point',
        lookLast: null,
        previewView: { x: 0, y: 0, eye: 200, yaw: 0, pitch: -15, fov: 70 },
    };
    let commands = null;

    // --- Геометрия RmlUi -----------------------------------------------------

    function geom(id) {
        return doc.rect(id) || doc.layoutRect(id) || { x: 0, y: 0, w: 0, h: 0 };
    }

    // --- Диагностика и статус ------------------------------------------------

    function note(severity, code, message, extra) {
        s.diagnostics.push(Object.assign({
            code: code, severity: severity, asset: session.state.path,
            location: null, message: String(message), details: extra || null,
        }, extra || {}));
        if (s.diagnostics.length > 80) s.diagnostics.splice(0, s.diagnostics.length - 80);
        renderDiag();
        return s.diagnostics[s.diagnostics.length - 1];
    }

    function allDiagnostics() {
        const list = [];
        const seen = new Set();
        for (const d of session.state.diagnostics.concat(s.diagnostics)) {
            const key = String(d.code) + '|' + String(d.message);
            if (seen.has(key)) continue;
            seen.add(key);
            list.push(d);
        }
        return list;
    }

    function setStatus(text, fail) {
        s.status = String(text);
        doc.text('we-status', esc(text));
        doc.cls('we-status', 'ok', !fail);
        doc.cls('we-status', 'fail', !!fail);
        if (app.setStatus) app.setStatus(String(text), fail ? 'fail' : '');
    }

    function renderDiag() {
        doc.html('we-diag', views.diagRows(allDiagnostics()));
    }

    function renderBuildOutput() {
        const text = session.state.log.slice(-60).join('\n');
        doc.text('we-build-output', esc(text || 'журнал пуст'));
    }

    // --- Отрисовка -----------------------------------------------------------

    function activeSelectionKind() {
        const kind = selection.snapshot().kind;
        if (kind === 'face') return 'face';
        if (kind !== 'none') return kind;
        return s.tab;
    }

    function renderTree() {
        const map = session.state.map;
        const filter = String(doc.value('we-filter') || s.filter || '').trim().toLowerCase();
        const sel = selection.snapshot();
        const html = [];
        function row(kind, id, label, extra) {
            const selected = (kind === 'world' && sel.kind === 'none' && s.tab === 'world') ||
                (sel.kind === kind && sel.ids.includes(String(id)));
            const text = String(id);
            if (filter && !(text.toLowerCase().includes(filter) || String(label).toLowerCase().includes(filter))) return;
            html.push('<div class="row' + (selected ? ' sel' : '') + '" data-key="' + esc(kind + ':' + id) + '">' +
                '<span class="row-name">' + esc(label || text) + '</span>' + (extra ? '<span class="row-dir">' + esc(extra) + '</span>' : '') + '</div>');
        }
        html.push('<h4>Мир</h4>');
        const world = map.world || {};
        html.push('<div class="row' + (sel.kind === 'none' && s.tab === 'world' ? ' sel' : '') + '" data-key="world">' +
            '<span class="row-name">World</span><span class="row-dir">' + esc(String(world.w || 0) + 'x' + String(world.h || 0)) + '</span></div>');
        html.push('<h4>Brushes (' + (map.brushes || []).length + ')</h4>');
        for (const brush of (map.brushes || [])) {
            row('brush', brush.id, brush.id, (brush.tool || 'solid') + (brush.visgroup ? ' / ' + brush.visgroup : ''));
        }
        html.push('<h4>Entities (' + (map.entities || []).length + ')</h4>');
        for (const entity of (map.entities || [])) row('entity', entity.id, entity.id, entity.kind || '');
        html.push('<h4>Paths (' + (map.paths || []).length + ')</h4>');
        for (const path of (map.paths || [])) row('path', path.id, path.id, (path.nodes || []).length + ' узлов');
        html.push('<h4>VisGroups (' + (map.visgroups || []).length + ')</h4>');
        for (const group of (map.visgroups || [])) {
            row('visgroup', group.id, group.name || group.id, (group.visible === false ? 'скрыта ' : '') + (group.locked ? 'lock' : ''));
        }
        doc.html('we-tree', html.join(''));
    }

    function renderInspector() {
        const kind = activeSelectionKind();
        const schema = M.inspectorSchema(kind, session.state.map, selection.snapshot());
        const parts = [];
        const values = [];
        for (const field of schema) {
            const id = 'we-prop-' + field.key;
            let control;
            if (field.type === 'select') {
                const options = (field.options || []).map((option) =>
                    '<option value="' + esc(option) + '">' + esc(option) + '</option>').join('');
                control = '<select id="' + id + '" class="field">' + options + '</select>';
            } else if (field.type === 'json') {
                control = '<textarea id="' + id + '" class="area we-json">' + esc(field.value) + '</textarea>';
            } else {
                control = '<input id="' + id + '" class="field" type="text" value="' + esc(field.value) + '"/>';
            }
            parts.push('<div class="field-row"><label class="we-label">' + esc(field.label) + '</label>' + control + '</div>');
            values.push({ id: id, value: field.value === undefined || field.value === null ? '' : String(field.value) });
        }
        const sel = selection.snapshot();
        doc.text('we-selection', esc(sel.kind === 'none' ? ('инспектор: ' + kind) : (sel.kind + ' · ' + sel.ids.join(', '))));
        doc.html('we-inspector', parts.join(''));
        for (const entry of values) {
            try { doc.setValue(entry.id, entry.value); } catch (e) { /* поле могло не создаться */ }
        }
    }

    function renderTools() {
        for (const tool of TOOLS) {
            doc.cls(TOOL_IDS[tool], 'on', s.tool === tool);
        }
        doc.text('we-tool-current', s.tool);
        doc.text('we-grid-value', 'Сетка ' + viewports.state.gridSize);
        doc.cls('we-grid-toggle', 'on', viewports.state.grid);
        const classes = ext.entityDefinitions();
        const ids = classes.map((def) => String(def.id));
        if (!ids.includes(s.entityClass)) s.entityClass = ids.length ? ids[0] : '';
        doc.html('we-entity-class', classes.map((def) =>
            '<option value="' + esc(def.id) + '">' + esc(def.label || def.id) + '</option>').join(''));
        if (s.entityClass) doc.setValue('we-entity-class', s.entityClass);
    }

    function renderExtension() {
        function button(kind, item) {
            return '<button id="we-ext-' + esc(kind) + '-' + esc(item.id) + '" class="btn small" data-key="' +
                esc(kind + ':' + item.id) + '">' + esc(item.label || item.id) + '</button>';
        }
        doc.html('we-ext-toolbar', ext.worldTools().map((item) => button('tool', item)).join(''));
        const menus = ext.menus().concat(ext.toolbar());
        doc.html('we-ext-menu', menus.map((item) => button('menu', item)).join(''));
        const panels = ext.panels().map((item) => {
            const fields = Array.isArray(item.fields) ? item.fields.map((field) =>
                '<span class="we-label">' + esc(field) + '</span><input id="we-ext-field-' + esc(item.id) + '-' + esc(field) +
                '" class="field" type="text" value=""/>').join('') : '';
            return '<div class="we-ext"><div class="hint">' + esc(item.label || item.id) + '</div>' + fields +
                '<button id="we-ext-panel-' + esc(item.id) + '" class="btn small" data-key="' + esc('panel:' + item.id) + '">' +
                esc(item.label || item.id) + '</button></div>';
        }).join('');
        doc.html('we-ext-panels', panels);
    }

    function renderViewports() {
        const map = session.state.map;
        for (const view of viewports.views) {
            if (view.plane === '3d') continue;
            const rect = geom('we-vp-' + view.id);
            viewports.setSize(view.id, rect.w, rect.h, rect);
            const drag = s.drag && s.drag.kind === 'box' ? s.drag.rect : null;
            doc.html('we-overlay-' + view.id, viewports.buildOverlay(view, {
                map: map, selection: selection.snapshot(), tool: s.tool, dragRect: drag,
            }));
        }
        // Первый кадр: панели уже получили размер — подгоняем масштаб/панораму.
        if (!s.fitted && viewports.byId('top').width > 2) {
            viewports.focus(M.mapBounds(map));
            s.fitted = true;
        }
        const hasPreview = !!session.state.world;
        doc.text('we-3d-state', hasPreview ? 'настоящий runtime' : 'скомпилируйте карту');
        doc.text('we-3d-debug', session.state.debugView || 'final');
        doc.text('we-3d-backend', session.state.gpu ? 'GPU' : 'CPU');
        doc.text('we-3d-light', session.state.lighting ? 'Свет вкл' : 'Свет выкл');
    }

    function renderMax() {
        const max = viewports.state.maximized;
        for (const id of Object.keys(VIEW_PANES)) {
            doc.style(VIEW_PANES[id], 'display', max && max !== id ? 'none' : '');
        }
        doc.style('we-row-a', 'display', max && VIEW_ROWS[max] !== 'we-row-a' ? 'none' : 'flex');
        doc.style('we-row-b', 'display', max && VIEW_ROWS[max] !== 'we-row-b' ? 'none' : 'flex');
        doc.cls('we-restore', 'on', !!max);
    }

    function renderTop() {
        doc.text('we-file', esc(session.state.path || 'карта не открыта'));
        doc.setValue('we-path', session.state.path || '');
        doc.text('we-dirty', session.state.history && session.state.history.dirty() ? 'изменено' : '');
        doc.cls('we-undo', 'off', !(session.state.history && session.state.history.canUndo()));
        doc.cls('we-redo', 'off', !(session.state.history && session.state.history.canRedo()));
        doc.text('we-status', esc(s.status));
        doc.cls('we-status', 'fail', /ошиб|отклон|не /.test(esc(s.status)));
        renderBuildOutput();
        renderDiag();
        renderTools();
        renderTree();
        renderInspector();
        renderExtension();
        renderViewports();
        renderMax();
    }

    function render() {
        if (!s.active) return;
        renderTop();
    }

    // --- 3D preview (настоящий runtime) --------------------------------------

    function updatePreview() {
        if (!session.state.world || !session.state.node) return;
        const rect = geom('we-vp-3d');
        if (rect.w < 2 || rect.h < 2) return;
        const bounds = M.mapBounds(session.state.map);
        const view = s.previewView;
        view.x = bounds.x + bounds.w / 2;
        view.y = bounds.y + bounds.h / 2;
        view.eye = Math.max(bounds.top || 0, (bounds.bottom || 0) + 64) + 96;
        try {
            const texture = session.state.world.renderToSprite(view, Math.min(640, Math.round(rect.w)), Math.min(360, Math.round(rect.h)));
            session.state.node.sprite(texture).at(rect.x + rect.w / 2, rect.y + rect.h / 2).size(rect.w, rect.h);
        } catch (e) {
            doc.text('we-3d-state', 'runtime preview: ' + (e && e.message ? e.message : String(e)));
        }
    }

    // --- Выделение -----------------------------------------------------------

    function selectKind(kind, ids, face) {
        s.tab = kind === 'face' ? 'face' : kind;
        if (kind === 'world') {
            selection.clear();
            s.tab = 'world';
        } else {
            selection.set(kind, ids, face);
        }
        render();
        return selection.snapshot();
    }

    function focusSelection() {
        const sel = selection.snapshot();
        if (sel.kind === 'world' || sel.kind === 'none') {
            viewports.focus(M.mapBounds(session.state.map));
        } else {
            viewports.focusSelection(sel, session.state.map);
        }
        renderViewports();
        return true;
    }

    // --- Мышь и инструменты --------------------------------------------------

    function overView(mx, my) {
        for (const view of viewports.views) {
            if (view.plane === '3d') continue;
            const rect = geom('we-vp-' + view.id);
            if (mx >= rect.x && mx < rect.x + rect.w && my >= rect.y && my < rect.y + rect.h) {
                return { view: view, rect: rect, lx: mx - rect.x, ly: my - rect.y };
            }
        }
        return null;
    }

    function projectFor(view) {
        return function (box) { return viewports.projectBox(view, box); };
    }

    function startTool(hit, mx, my) {
        const view = hit.view;
        const point = viewports.unproject(view, hit.lx, hit.ly);
        const snapped = viewports.snapPoint(point.u, point.v);
        const sel = selection.snapshot();
        if (s.tool === 'select') {
            const picked = selection.pick(projectFor(view), hit.lx, hit.ly);
            if (picked) {
                if ($.input.shiftDown()) selection.toggle(picked.kind, picked.id);
                else selectKind(picked.kind, [picked.id]);
            } else {
                s.drag = { kind: 'box', view: view.id, sx: hit.lx, sy: hit.ly, rect: { x: hit.lx, y: hit.ly, w: 0, h: 0 } };
            }
            return true;
        }
        if (s.tool === 'block') {
            s.drag = {
                kind: 'block', view: view.id, startU: snapped.u, startV: snapped.v,
                sx: hit.lx, sy: hit.ly, plane: view.plane,
            };
            return true;
        }
        if (s.tool === 'move' || s.tool === 'resize') {
            if (sel.kind === 'none') {
                const picked = selection.pick(projectFor(view), hit.lx, hit.ly);
                if (picked) selectKind(picked.kind, [picked.id]);
            }
            if (selection.snapshot().kind === 'none') return false;
            s.drag = {
                kind: s.tool, view: view.id, plane: view.plane,
                startU: point.u, startV: point.v,
            };
            return true;
        }
        if (s.tool === 'vertex') {
            if (sel.kind !== 'brush' && sel.kind !== 'face') return false;
            const brush = M.find(session.state.map, 'brushes', String(sel.ids[0]).split(':')[0]);
            if (!brush) return false;
            const vertices = verticesOf(brush);
            let best = null;
            for (let i = 0; i < vertices.length; i++) {
                const screen = viewports.projectPoint(view, vertices[i][0], vertices[i][1], 0);
                const d = Math.hypot(screen.x - hit.lx, screen.y - hit.ly);
                if (!best || d < best.d) best = { i: i, d: d };
            }
            if (!best || best.d > 16) return false;
            s.drag = { kind: 'vertex', view: view.id, brush: brush.id, vertex: best.i };
            return true;
        }
        if (s.tool === 'rotate') {
            const picked = selection.pick(projectFor(view), hit.lx, hit.ly);
            if (picked) selectKind(picked.kind, [picked.id]);
            commands.rotateSelection(90).then(() => { render(); setStatus('поворот: 90', false); });
            return true;
        }
        if (s.tool === 'clip') {
            const picked = selection.pick(projectFor(view), hit.lx, hit.ly, ['brush']);
            if (!picked) return false;
            selectKind('brush', [picked.id]);
            const axis = view.plane === 'yz' ? 'y' : 'x';
            doc.setValue('we-clip-axis', axis);
            doc.setValue('we-clip-coord', String(axis === 'x' ? snapped.u : snapped.v));
            return true;
        }
        if (s.tool === 'face') {
            const picked = selection.pick(projectFor(view), hit.lx, hit.ly, ['brush']);
            if (!picked) return false;
            s.face = 'side';
            selection.setFace(picked.id, s.face);
            s.tab = 'face';
            render();
            return true;
        }
        if (s.tool === 'entity') {
            const args = entityArgsFromToolbar(M.parseNumber(snapped.u, 0), M.parseNumber(snapped.v, 0));
            commands.createEntity(args)
                .then((r) => { if (r.ok) setStatus('сущность создана', false); else setStatus('сущность не создана', true); render(); });
            return true;
        }
        if (s.tool === 'path') {
            const current = selection.snapshot();
            const node = { x: snapped.u, y: snapped.v, h: 0 };
            if (current.kind === 'path' && current.ids.length) {
                commands.addPathNode(current.ids[0], node).then(() => render());
            } else {
                commands.createPath({ type: 'path', nodes: [node] }).then((r) => {
                    if (r.ok) setStatus('путь создан', false);
                    render();
                });
            }
            return true;
        }
        return false;
    }

    function selectedEntityDef() {
        const id = String(doc.value('we-entity-class') || s.entityClass || '');
        return ext.entityDefinitions().find((def) => String(def.id) === id || String(def.class) === id) || null;
    }

    function entityArgsFromToolbar(x, y) {
        const def = selectedEntityDef();
        const kind = String(doc.value('we-entity-kind') || (def && (def.kind || def.class)) || 'point');
        const h = M.parseNumber(doc.value('we-entity-h'), 0);
        const args = { kind: kind, x: x, y: y, h: h };
        if (def && def.defaults && typeof def.defaults === 'object') {
            for (const key of Object.keys(def.defaults)) {
                if (key === 'kind' || key === 'x' || key === 'y' || key === 'h') continue;
                args[key] = def.defaults[key];
            }
        }
        if (def && def.brush && !args.brush) args.brush = '';
        return args;
    }

    function verticesOf(brush) {
        if (Array.isArray(brush.polygon)) return brush.polygon.map((p) => [Number(p[0]), Number(p[1])]);
        const box = M.brushBox(brush);
        if (!box) return [];
        return [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]];
    }

    function finishTool(mx, my) {
        const drag = s.drag;
        s.drag = null;
        if (!drag) return;
        const view = viewports.byId(drag.view);
        if (!view) return;
        const rect = geom('we-vp-' + view.id);
        const lx = mx - rect.x, ly = my - rect.y;
        const grid = viewports.state.gridSize || 16;
        if (drag.kind === 'box') {
            let box = drag.rect;
            if (box.w < 3 && box.h < 3) { renderViewports(); return; }
            const result = selection.boxSelect(projectFor(view), box);
            if (result.kind !== 'none') {
                const sel = selection.snapshot();
                if ($.input.shiftDown() && sel.kind === result.kind) {
                    const merged = sel.ids.slice();
                    for (const id of result.ids) if (!merged.includes(id)) merged.push(id);
                    selectKind(result.kind, merged);
                } else {
                    selectKind(result.kind, result.ids);
                }
            }
            renderViewports();
            return;
        }
        if (drag.kind === 'block') {
            const end = viewports.unproject(view, lx, ly);
            const endU = viewports.snapValue(end.u), endV = viewports.snapValue(end.v);
            const x0 = Math.min(drag.startU, endU), x1 = Math.max(drag.startU, endU);
            const v0 = Math.min(drag.startV, endV), v1 = Math.max(drag.startV, endV);
            let rectArgs;
            if (drag.plane === 'xy') {
                const w = Math.max(grid, x1 - x0), h = Math.max(grid, v1 - v0);
                rectArgs = { rect: [x0, v0, w, h] };
            } else {
                const depth = Math.max(grid, x1 - x0);
                const bottom = Math.min(drag.startV, endV), top = Math.max(drag.startV, endV);
                rectArgs = { rect: [drag.plane === 'yz' ? drag.startU : x0, drag.plane === 'yz' ? x0 : v0, depth, depth], bottom: bottom, top: Math.max(top, bottom + grid) };
            }
            const bottom = M.parseNumber(doc.value('we-bottom'), 0);
            const height = Math.max(1, M.parseNumber(doc.value('we-height'), 128));
            const args = Object.assign({ bottom: bottom, top: bottom + height, tool: 'solid' }, rectArgs);
            commands.createBrush(args).then((r) => {
                if (r.ok) setStatus('brush создан', false);
                else setStatus('brush не создан: native отклонил', true);
                render();
            });
            return;
        }
        if (drag.kind === 'move') {
            const end = viewports.unproject(view, lx, ly);
            const du = Math.round((end.u - drag.startU) / grid) * grid;
            const dv = Math.round((end.v - drag.startV) / grid) * grid;
            if (!du && !dv) return;
            let promise;
            if (drag.plane === 'xy') promise = commands.moveSelection(du, dv, 0);
            else if (drag.plane === 'xz') promise = commands.moveSelection(du, 0, dv);
            else promise = commands.moveSelection(0, du, dv);
            promise.then((r) => { setStatus(r.ok ? 'перемещено' : 'перемещение отклонено', !r.ok); render(); });
            return;
        }
        if (drag.kind === 'resize') {
            const end = viewports.unproject(view, lx, ly);
            const du = Math.round((end.u - drag.startU) / grid) * grid;
            const dv = Math.round((end.v - drag.startV) / grid) * grid;
            if (!du && !dv) return;
            let promise;
            if (drag.plane === 'xy') promise = commands.resizeSelection(du, dv, 0);
            else if (drag.plane === 'xz') promise = commands.resizeSelection(du, 0, dv);
            else promise = commands.resizeSelection(0, du, dv);
            promise.then((r) => { setStatus(r.ok ? 'размер изменён' : 'размер отклонён', !r.ok); render(); });
            return;
        }
        if (drag.kind === 'vertex') {
            const end = viewports.unproject(view, lx, ly);
            commands.vertexMove(drag.brush, drag.vertex, viewports.snapValue(end.u), viewports.snapValue(end.v)).then((r) => {
                setStatus(r.ok ? 'вершина перемещена' : 'вершина отклонена: ' + (r.diagnostics[0] ? r.diagnostics[0].message : ''), !r.ok);
                render();
            });
            return;
        }
    }

    function tickInput() {
        if (!s.active) return;
        const mod = $.input.ctrlDown() || $.input.down('cmd');
        if (mod && $.input.pressed('z')) {
            if ($.input.shiftDown()) { session.state.history.redo(); } else { session.state.history.undo(); }
            selection.prune();
            render();
        } else if (mod && $.input.pressed('y')) {
            session.state.history.redo();
            selection.prune();
            render();
        } else if (mod && $.input.pressed('s')) {
            commands.save().then((r) => { setStatus(r.ok ? 'сохранено' : 'не сохранено', !r.ok); render(); });
        }
        if ($.input.pressed('[')) {
            commands.stepGrid(-1); render();
        }
        if ($.input.pressed(']')) {
            commands.stepGrid(1); render();
        }
        if ($.input.pressed('F5') || $.input.pressed('f5')) buildAndRun();
        if ($.input.pressed('Delete') || $.input.pressed('Backspace')) {
            commands.deleteSelection().then((r) => { setStatus(r.ok ? 'удалено' : 'удаление отклонено', !r.ok); render(); });
        }
        if ($.input.pressed('f')) {
            focusSelection();
        }
    }

    function over3D(mx, my) {
        const r = geom('we-vp-3d');
        return r.w > 1 && r.h > 1 && mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
    }

    function tick3D(m) {
        if (!over3D(m.x, m.y)) { s.lookLast = null; return; }
        const view = s.previewView;
        if ($.input.mouseDown('right')) {
            if (s.lookLast) {
                view.yaw += (m.x - s.lookLast.x) * 0.006;
                view.pitch = Math.max(-89, Math.min(89, view.pitch - (m.y - s.lookLast.y) * 0.006));
            }
            s.lookLast = { x: m.x, y: m.y };
        } else {
            s.lookLast = null;
        }
        const step = Math.max(4, view.eye * 0.03);
        const forwardX = Math.sin(view.yaw), forwardY = -Math.cos(view.yaw);
        if ($.input.down('w')) { view.x += forwardX * step; view.y += forwardY * step; }
        if ($.input.down('s')) { view.x -= forwardX * step; view.y -= forwardY * step; }
        if ($.input.down('a')) { view.x += forwardY * step; view.y -= forwardX * step; }
        if ($.input.down('d')) { view.x -= forwardY * step; view.y += forwardX * step; }
        if ($.input.down('q')) view.eye = Math.max(8, view.eye - step);
        if ($.input.down('e')) view.eye += step;
    }

    function tickMouse() {
        const m = $.input.mouse();
        tick3D(m);
        const hit = overView(m.x, m.y);
        if (hit) {
            const wheel = $.input.wheel().y;
            if (wheel) {
                viewports.zoomAt(hit.view.id, wheel > 0 ? 1.15 : 0.87, hit.lx, hit.ly);
            }
            // Средняя/правая кнопка или Space+ЛКМ — панорама.
            const panPressed = $.input.mousePressed('middle') || $.input.mousePressed('right') ||
                ($.input.down('space') && $.input.mousePressed('left'));
            if (panPressed) s.drag = { kind: 'pan', view: hit.view.id, lastX: m.x, lastY: m.y };
        }
        if (s.drag && s.drag.kind === 'pan') {
            const held = $.input.mouseDown('middle') || $.input.mouseDown('right') || $.input.mouseDown('left');
            if (held) {
                viewports.panBy(s.drag.view, m.x - s.drag.lastX, m.y - s.drag.lastY);
                s.drag.lastX = m.x;
                s.drag.lastY = m.y;
            } else {
                s.drag = null;
            }
        } else if (hit && $.input.mousePressed('left') && !$.input.down('space') &&
            !$.input.mouseDown('middle') && !$.input.mouseDown('right')) {
            startTool(hit, m.x, m.y);
        } else if (s.drag && s.drag.kind === 'box') {
            const rect = geom('we-vp-' + s.drag.view);
            const lx = m.x - rect.x, ly = m.y - rect.y;
            s.drag.rect = {
                x: Math.min(s.drag.sx, lx), y: Math.min(s.drag.sy, ly),
                w: Math.abs(lx - s.drag.sx), h: Math.abs(ly - s.drag.sy),
            };
        }
        const down = $.input.mouseDown('left');
        if (s.wasDown && !down && s.drag && s.drag.kind !== 'pan') finishTool(m.x, m.y);
        s.wasDown = down;
        if (s.drag && s.drag.kind === 'pan' && !$.input.mouseDown('middle') && !$.input.mouseDown('right') && !$.input.mouseDown('left')) {
            s.drag = null;
        }
    }

    // --- Обработчики интерфейса ----------------------------------------------

    function setTool(tool) {
        if (!TOOLS.includes(tool)) return s.tool;
        s.tool = tool;
        renderTools();
        setStatus('инструмент: ' + tool, false);
        return s.tool;
    }

    function readInspector(kind) {
        const schema = M.inspectorSchema(kind, session.state.map, selection.snapshot());
        const values = {};
        for (const field of schema) {
            const value = doc.value('we-prop-' + field.key);
            if (value !== null && value !== undefined) values[field.key] = value;
        }
        return values;
    }

    function applyInspector() {
        const kind = activeSelectionKind();
        commands.applyInspector(kind, readInspector(kind)).then((r) => {
            setStatus(r.ok ? 'инспектор применён' : 'инспектор отклонён', !r.ok);
            render();
        });
    }

    function applyFace() {
        const brushId = selection.snapshot().kind === 'face' ? String(selection.snapshot().ids[0]).split(':')[0] : null;
        if (!brushId) { note('warning', 'SDK_WORLD_EDIT_FACE', 'Сначала выберите грань brush'); render(); return; }
        const face = s.face || 'side';
        const material = doc.value('we-face-material') || '';
        const tags = doc.value('we-face-tags') || '';
        commands.setFaceMaterial(brushId, face, material).then((r) => {
            if (!r.ok) { setStatus('грань отклонена', true); render(); return; }
            commands.setTags('face', [brushId], tags, face).then((r2) => {
                setStatus(r2.ok ? 'грань обновлена' : 'грань отклонена', !r2.ok);
                render();
            });
        });
    }

    function applyClip(keep) {
        s.clipKeep = keep;
        const coord = doc.value('we-clip-coord');
        const axis = String(doc.value('we-clip-axis') || 'x').trim().toLowerCase() === 'y' ? 'y' : 'x';
        commands.clip(null, axis, M.parseNumber(coord, 0), keep).then((r) => {
            setStatus(r.ok ? 'clip: ' + keep : 'clip отклонён', !r.ok);
            render();
        });
    }

    function createEntityFromToolbar() {
        const world = session.state.map.world || M.defaultWorld();
        const active = viewports.byId(viewports.state.active) || viewports.byId('top');
        const point = viewports.unproject(active, active.width / 2, active.height / 2);
        const args = entityArgsFromToolbar(
            viewports.snapValue(Number.isFinite(point.x) && point.x ? point.x : Number(world.x) + Number(world.w) / 2),
            viewports.snapValue(Number.isFinite(point.y) && point.y ? point.y : Number(world.y) + Number(world.h) / 2));
        commands.createEntity(args).then((r) => {
            setStatus(r.ok ? 'сущность создана' : 'сущность отклонена', !r.ok);
            render();
        });
    }

    function createPathFromToolbar() {
        const x = M.parseNumber(doc.value('we-path-x'), 0);
        const y = M.parseNumber(doc.value('we-path-y'), 0);
        commands.createPath({ type: 'path', nodes: [{ x: x, y: y, h: 0 }] }).then((r) => {
            setStatus(r.ok ? 'путь создан' : 'путь отклонён', !r.ok);
            render();
        });
    }

    function addNodeFromToolbar() {
        const x = M.parseNumber(doc.value('we-path-x'), 0);
        const y = M.parseNumber(doc.value('we-path-y'), 0);
        commands.addPathNode(null, { x: x, y: y, h: 0 }).then((r) => {
            setStatus(r.ok ? 'узел добавлен' : 'узел отклонён', !r.ok);
            render();
        });
    }

    function dispatchExtension(key) {
        const parts = String(key).split(':');
        const kind = parts[0], id = parts.slice(1).join(':');
        if (kind === 'tool') {
            const item = ext.worldTools().find((v) => v.id === id);
            if (!item) return;
            if (item.op) {
                session.apply(item.op, item.args || {}).then((r) => {
                    setStatus(r.ok ? 'extension: ' + id : 'extension отклонён', !r.ok);
                    render();
                });
            } else if (item.command) {
                commands.runExtensionCommand(item.command, item.args || {}).then(() => render());
            } else {
                note('info', 'SDK_EXTENSION_TOOL', 'World tool «' + id + '» без op: только объявлен');
                render();
            }
            return;
        }
        if (kind === 'menu' || kind === 'panel') {
            const lists = kind === 'menu' ? ext.menus().concat(ext.toolbar()) : ext.panels();
            const item = lists.find((v) => v.id === id);
            if (!item) return;
            const args = Object.assign({}, item.args || {});
            if (kind === 'panel' && Array.isArray(item.fields)) {
                for (const field of item.fields) {
                    const value = doc.value('we-ext-field-' + id + '-' + field);
                    if (value !== null && value !== undefined) args[field] = value;
                }
            }
            if (item.op) session.apply(item.op, args).then((r) => { setStatus(r.ok ? 'extension: ' + id : 'extension отклонён', !r.ok); render(); });
            else if (item.command) commands.runExtensionCommand(item.command, args).then(() => render());
            else { note('info', 'SDK_EXTENSION_TOOL', 'Contribution «' + id + '» без op/command'); render(); }
        }
    }

    function wire() {
        if (s.wired) return;
        s.wired = true;
        doc.on('we-back', 'click', close);
        doc.on('we-save', 'click', () => commands.save().then((r) => { setStatus(r.ok ? 'сохранено' : 'не сохранено', !r.ok); render(); }));
        doc.on('we-undo', 'click', () => { const label = session.state.history.undo(); selection.prune(); setStatus(label ? 'отменено: ' + label : 'нечего отменять', false); render(); });
        doc.on('we-redo', 'click', () => { const label = session.state.history.redo(); selection.prune(); setStatus(label ? 'повторено: ' + label : 'нечего повторять', false); render(); });
        doc.on('we-new', 'click', () => { session.newMap(); selection.clear(); s.tab = 'world'; s.fitted = false; render(); });
        doc.on('we-open', 'click', () => {
            const path = String(doc.value('we-path') || '').trim();
            if (!path) { note('warning', 'SDK_WORLD_READ', 'Укажите путь .re2dmap'); render(); return; }
            openPath(path);
        });
        doc.on('we-duplicate', 'click', () => commands.duplicateSelection().then((r) => { setStatus(r.ok ? 'дублировано' : 'дублирование отклонено', !r.ok); render(); }));
        doc.on('we-delete', 'click', () => commands.deleteSelection().then((r) => { setStatus(r.ok ? 'удалено' : 'удаление отклонено', !r.ok); render(); }));
        doc.on('we-validate', 'click', () => commands.validate().then((r) => { setStatus(r.ok ? 'проверка: ошибок нет' : 'проверка: есть ошибки', !r.ok); render(); }));
        doc.on('we-compile', 'click', () => commands.compile(true).then((r) => { setStatus(r.ok ? 'компиляция: preview готов' : 'компиляция: ошибки', !r.ok); render(); }));
        doc.on('we-run', 'click', () => { const run = app.runProject(); setStatus(run ? 'игра запущена' : 'игра не запущена', !run); render(); });
        doc.on('we-build-run', 'click', buildAndRun);
        doc.on('we-grid-dec', 'click', () => { commands.stepGrid(-1); render(); });
        doc.on('we-grid-inc', 'click', () => { commands.stepGrid(1); render(); });
        doc.on('we-grid-toggle', 'click', () => { viewports.setGrid(!viewports.state.grid); render(); });
        doc.on('we-focus-selection', 'click', () => { focusSelection(); setStatus('фокус на выделении', false); });
        doc.on('we-restore', 'click', () => { viewports.restore(); renderMax(); });
        doc.on('we-select-world', 'click', () => selectKind('world', []));
        doc.on('we-filter', 'change', () => { s.filter = String(doc.value('we-filter') || ''); renderTree(); });
        for (const tool of TOOLS) doc.on(TOOL_IDS[tool], 'click', () => setTool(tool));
        for (const id of Object.keys(VIEW_PANES)) {
            doc.on('we-pane-max-' + id, 'click', () => {
                viewports.maximize(viewports.state.maximized === id ? null : id);
                renderMax();
            });
        }
        doc.on('we-3d-debug', 'click', () => { session.nextDebugView(); renderViewports(); });
        doc.on('we-3d-backend', 'click', () => { session.toggleBackend(); renderViewports(); });
        doc.on('we-3d-light', 'click', () => { session.toggleLighting(); renderViewports(); });
        doc.on('we-tree', 'click', (id, ev, key) => {
            if (!key) return;
            if (key === 'world') { selectKind('world', []); return; }
            const at = key.indexOf(':');
            if (at < 0) return;
            selectKind(key.slice(0, at), [key.slice(at + 1)]);
        });
        doc.on('we-diag', 'click', (id, ev, key) => {
            const diag = allDiagnostics()[Number(key)];
            if (!diag || !diag.location) return;
            const loc = diag.location;
            const kinds = { brushes: 'brush', entities: 'entity', paths: 'path', visgroups: 'visgroup' };
            if (kinds[loc.section] && Number.isInteger(loc.index)) {
                const section = session.state.map[loc.section] || [];
                const value = section[loc.index];
                if (value) {
                    selectKind(kinds[loc.section], [value.id]);
                    focusSelection();
                }
            }
        });
        doc.on('we-apply', 'click', applyInspector);
        doc.on('we-face-side', 'click', () => { s.face = 'side'; const sel = selection.snapshot(); if (sel.kind === 'face') selection.setFace(String(sel.ids[0]).split(':')[0], 'side'); render(); });
        doc.on('we-face-floor', 'click', () => { s.face = 'floor'; const sel = selection.snapshot(); if (sel.kind === 'face') selection.setFace(String(sel.ids[0]).split(':')[0], 'floor'); render(); });
        doc.on('we-face-ceiling', 'click', () => { s.face = 'ceiling'; const sel = selection.snapshot(); if (sel.kind === 'face') selection.setFace(String(sel.ids[0]).split(':')[0], 'ceiling'); render(); });
        doc.on('we-face-apply', 'click', applyFace);
        doc.on('we-clip-front', 'click', () => applyClip('front'));
        doc.on('we-clip-back', 'click', () => applyClip('back'));
        doc.on('we-clip-both', 'click', () => applyClip('both'));
        doc.on('we-entity-class', 'change', () => {
            s.entityClass = String(doc.value('we-entity-class') || s.entityClass);
            const def = selectedEntityDef();
            if (def) {
                if (def.kind) doc.setValue('we-entity-kind', String(def.kind));
                if (def.defaults && def.defaults.h !== undefined) doc.setValue('we-entity-h', String(def.defaults.h));
            }
        });
        doc.on('we-entity-create', 'click', createEntityFromToolbar);
        doc.on('we-visgroup-create', 'click', () => {
            commands.ensureVisgroup({ name: String(doc.value('we-visgroup-name') || 'group') }).then((r) => {
                setStatus(r.ok ? 'visgroup создан' : 'visgroup отклонён', !r.ok);
                render();
            });
        });
        doc.on('we-visgroup-hide', 'click', () => {
            const sel = selection.snapshot();
            if (sel.kind !== 'visgroup' || !sel.ids.length) { note('warning', 'SDK_WORLD_EDIT_VISGROUP', 'Выберите visgroup'); render(); return; }
            commands.toggleVisgroupHidden(sel.ids[0]).then(() => render());
        });
        doc.on('we-visgroup-lock', 'click', () => {
            const sel = selection.snapshot();
            if (sel.kind !== 'visgroup' || !sel.ids.length) { note('warning', 'SDK_WORLD_EDIT_VISGROUP', 'Выберите visgroup'); render(); return; }
            commands.toggleVisgroupLocked(sel.ids[0]).then(() => render());
        });
        doc.on('we-resize-plus', 'click', () => { const g = viewports.state.gridSize; commands.resizeSelection(g, g, 0).then(() => render()); });
        doc.on('we-resize-minus', 'click', () => { const g = -viewports.state.gridSize; commands.resizeSelection(g, g, 0).then(() => render()); });
        doc.on('we-rotate-90', 'click', () => commands.rotateSelection(90).then(() => render()));
        doc.on('we-rotate--90', 'click', () => commands.rotateSelection(-90).then(() => render()));
        doc.on('we-path-create', 'click', createPathFromToolbar);
        doc.on('we-path-add', 'click', addNodeFromToolbar);
        doc.on('we-path-node-delete', 'click', () => {
            commands.deletePathNode(null, M.parseNumber(doc.value('we-path-node-index'), 0)).then((r) => { setStatus(r.ok ? 'узел удалён' : 'узел не удалён', !r.ok); render(); });
        });
        doc.on('we-path-connect', 'click', () => {
            commands.connectPath(null, M.parseNumber(doc.value('we-path-connect-a'), 0), M.parseNumber(doc.value('we-path-connect-b'), 1)).then((r) => {
                setStatus(r.ok ? 'узлы соединены' : 'соединение отклонено', !r.ok); render();
            });
        });
        doc.on('we-path-loop', 'click', () => {
            commands.setPathFields(null, { loop: true }).then((r) => { setStatus(r.ok ? 'path loop' : 'loop отклонён', !r.ok); render(); });
        });
        doc.on('we-ext-toolbar', 'click', (id, ev, key) => { if (key) dispatchExtension(key); });
        doc.on('we-ext-menu', 'click', (id, ev, key) => { if (key) dispatchExtension(key); });
        doc.on('we-ext-panels', 'click', (id, ev, key) => { if (key) dispatchExtension(key); });
        doc.on('we-inspector', 'change', () => { /* значения читаются в Apply */ });
    }

    // --- Асинхронные команды верхнего уровня ----------------------------------

    function buildAndRun() {
        commands.buildAndRun().then((r) => {
            setStatus(r.ok ? 'Build and Run: игра запущена' : 'Build and Run: этап ' + (r.stage || '?') + ' не прошёл', !r.ok);
            render();
        });
    }

    async function openPath(path) {
        try {
            await session.open(path);
        } catch (e) {
            note('error', 'SDK_WORLD_READ', e && e.message ? e.message : String(e));
        }
        if (app.recovery) app.recovery.watch(session.state.path, session.state.map, session.state.history, render);
        selection.clear();
        s.tab = 'world';
        s.diagnostics = [];
        viewports.focus(M.mapBounds(session.state.map));
        s.fitted = false;
        render();
        return snapshot();
    }

    async function openEditor(args) {
        const path = args.assetAbs || args.asset || null;
        try {
            if (path) await session.open(path);
            else session.newMap();
        } catch (e) {
            note('error', 'SDK_WORLD_READ', e && e.message ? e.message : String(e));
            if (!session.state.map) session.newMap();
        }
        s.active = true;
        s.diagnostics = [];
        selection.clear();
        s.tab = 'world';
        s.tool = 'select';
        if (app.doc) app.doc.hide();
        doc.show();
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);
        if (app.recovery) app.recovery.watch(session.state.path, session.state.map, session.state.history, render);
        viewports.focus(M.mapBounds(session.state.map));
        s.fitted = false;
        wire();
        render();
        app.studios.world = api;
        setStatus('World Editor: ' + session.state.path, false);
        return { id: 'world-editor', world: api };
    }

    function close() {
        s.active = false;
        s.drag = null;
        session.dispose();
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
        return true;
    }

    // --- Публичный фасад -----------------------------------------------------

    function snapshot() {
        const sel = selection.snapshot();
        const diags = allDiagnostics();
        const sum = summarize(diags);
        return {
            active: !!s.active,
            file: session.state.path,
            dirty: session.state.history ? session.state.history.dirty() : false,
            tool: s.tool,
            grid: viewports.state.gridSize,
            selection: { kind: sel.kind, ids: sel.ids.slice() },
            map: {
                brushes: (session.state.map.brushes || []).length,
                entities: (session.state.map.entities || []).length,
                paths: (session.state.map.paths || []).length,
                visgroups: (session.state.map.visgroups || []).length,
            },
            extensions: ext.ids(),
            diagnostics: { errors: sum.errors, warnings: sum.warnings },
        };
    }

    const ops = {
        createBrush: (...args) => commands.createBrush(...args),
        deleteSelection: () => commands.deleteSelection(),
        duplicateSelection: () => commands.duplicateSelection(),
        moveSelection: (...args) => commands.moveSelection(...args),
        resizeSelection: (...args) => commands.resizeSelection(...args),
        setGrid: (size) => { const value = commands.setGrid(size); render(); return value; },
        setFaceMaterial: (...args) => commands.setFaceMaterial(...args),
        setTags: (...args) => commands.setTags(...args),
        createEntity: (...args) => commands.createEntity(...args),
        connectPath: (...args) => commands.connectPath(...args),
        setPathFields: (...args) => commands.setPathFields(...args),
        validate: () => commands.validate(),
        compile: (write) => commands.compile(write),
        buildAndRun: () => commands.buildAndRun(),
        open: (path) => openPath(path),
        save: () => commands.save(),
        setWorld: (...args) => commands.setWorld(...args),
        createPath: (...args) => commands.createPath(...args),
        addPathNode: (...args) => commands.addPathNode(...args),
        movePathNode: (...args) => commands.movePathNode(...args),
        deletePathNode: (...args) => commands.deletePathNode(...args),
        ensureVisgroup: (...args) => commands.ensureVisgroup(...args),
        setVisgroupState: (...args) => commands.setVisgroupState(...args),
        applyInspector: (...args) => commands.applyInspector(...args),
        vertexMove: (...args) => commands.vertexMove(...args),
        clip: (...args) => commands.clip(...args),
        rotateSelection: (...args) => commands.rotateSelection(...args),
        runExtensionCommand: (...args) => commands.runExtensionCommand(...args),
    };

    const api = {
        id: 'world-editor',
        state: s,
        ops: ops,
        get active() { return !!s.active; },
        get session() { return session; },
        get map() { return session.state.map; },
        get selection() { return selection; },
        get viewports() { return viewports; },
        get extensions() { return ext; },
        get commands() { return commands; },
        open: (args) => openEditor(args || {}),
        close: close,
        snapshot: snapshot,
        select: (kind, ids, face) => selectKind(kind, ids, face),
        focusSelection: focusSelection,
        setTool: setTool,
        render: render,
        setStatus: setStatus,
        note: note,
        diagnostics: allDiagnostics,
        createBrush: ops.createBrush,
        deleteSelection: ops.deleteSelection,
        duplicateSelection: ops.duplicateSelection,
        moveSelection: ops.moveSelection,
        resizeSelection: ops.resizeSelection,
        setGrid: ops.setGrid,
        setFaceMaterial: ops.setFaceMaterial,
        setTags: ops.setTags,
        createEntity: ops.createEntity,
        connectPath: ops.connectPath,
        setPathFields: ops.setPathFields,
        validate: ops.validate,
        compile: ops.compile,
        buildAndRun: ops.buildAndRun,
        save: ops.save,
        setWorld: ops.setWorld,
        createPath: ops.createPath,
        addPathNode: ops.addPathNode,
        movePathNode: ops.movePathNode,
        deletePathNode: ops.deletePathNode,
        ensureVisgroup: ops.ensureVisgroup,
        setVisgroupState: ops.setVisgroupState,
        applyInspector: ops.applyInspector,
        vertexMove: ops.vertexMove,
        clip: ops.clip,
        rotateSelection: ops.rotateSelection,
        runExtensionCommand: ops.runExtensionCommand,
    };

    // Capability discovery для агента (§26): доступные операции, их аргументы,
    // entity definitions, расширения и build-возможности — без чтения исходников.
    const OP_SCHEMA = {
        createBrush: { rect: '[x,y,w,h] | polygon: [[x,y],...]', bottom: 'number', top: 'number', tool: 'solid|nodraw|clip|...' },
        deleteSelection: {}, duplicateSelection: { dx: 'number?', dy: 'number?' },
        moveSelection: { dx: 'number', dy: 'number', dz: 'number?' },
        resizeSelection: { dw: 'number', dh: 'number', dz: 'number?' },
        setGrid: { size: 'number (1..256)' },
        setFaceMaterial: { id: 'brush id', face: 'side|floor|ceiling', material: '#rrggbb' },
        setTags: { id: 'brush id', tags: 'string[]', face: 'floor|ceiling?' },
        createEntity: { kind: 'string', x: 'number', y: 'number', h: 'number?', brush: 'brush id?' },
        createPath: { nodes: '[{x,y,h?}]', loop: 'bool?', name: 'string?' },
        addPathNode: { id: 'path id', node: '{x,y,h?}' },
        movePathNode: { id: 'path id', index: 'number', x: 'number', y: 'number', h: 'number?' },
        deletePathNode: { id: 'path id', index: 'number' },
        connectPath: { id: 'path id', a: 'index', b: 'index', loop: 'bool?' },
        setPathFields: { id: 'path id', fields: 'object' },
        ensureVisgroup: { name: 'string' }, setVisgroupState: { id: 'string', visible: 'bool?', locked: 'bool?' },
        setWorld: { x: 'number?', y: 'number?', w: 'number?', h: 'number?', bottom: 'number?', top: 'number?', regionSize: 'int?' },
        vertexMove: { id: 'brush id', vertex: 'index', x: 'number', y: 'number' },
        clip: { id: 'brush id', axis: 'x|y', coordinate: 'number', keep: 'front|back|both' },
        rotateSelection: { degrees: 'number' },
        applyInspector: { kind: 'brush|face|entity|path|world', patch: 'object' },
        validate: {}, compile: { write: 'bool?' }, buildAndRun: {}, save: {}, open: { path: 'string' },
    };
    api.capabilities = () => ({
        editor: 'world-editor',
        file: '*.re2dmap',
        operations: Object.keys(ops).map((name) => ({ name, args: OP_SCHEMA[name] || null })),
        entityDefinitions: ext.entityDefinitions().map((d) => d.id || d.class || ''),
        extensions: ext.ids(),
        build: ['validate', 'compile', 'run', 'buildAndRun'],
        snapshot: 'studios.world.snapshot()',
    });

    commands = createCommands({
        app: app, session: session, selection: selection, viewports: viewports, ext: ext,
        note: note,
        changed: (result) => {
            s.lastChange = result;
            if (s.active) render();
        },
    });

    $.update(() => {
        if (!s.active) return;
        tickInput();
        tickMouse();
        updatePreview();
        renderViewports();
    });

    return api;
}
