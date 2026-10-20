// ===========================================================================
// World Editor: операции (ops). Каждая кнопка/меню/агент вызывает одну и ту
// же функцию; все правки уходят в native world-edit через session.apply.
//
// Контракт native зафиксирован в docs/WORLD_EDITOR.md и sdk/native/sdk.h:
// brush.set {ids, patch}, brush.clip {id, axis, coordinate, keep},
// face.set {id, face, material, tags}, entity.set {id, fields},
// path.set {id, fields}, world.set {плоские поля}, visgroup.state {id,...}.
// ===========================================================================

import {
    ELEMENT_KINDS, ELEMENT_DEFAULTS, find, clone, brushBox, brushZ, entityPos, pathNodes,
    parseRect, parsePolygon, tagsFromText, parseNumber,
} from './model.js';

function truthy(text) {
    const value = String(text === undefined || text === null ? '' : text).trim().toLowerCase();
    return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

export function createCommands(ctx) {
    const session = ctx.session;
    const selection = ctx.selection;
    const viewports = ctx.viewports;
    const app = ctx.app;
    const ext = ctx.ext;

    function note(severity, code, message, extra) {
        if (ctx.note) ctx.note(severity, code, message, extra);
    }

    function fail(code, message, extra) {
        note('error', code, message, extra);
        return {
            ok: false, changed: false, ids: [],
            diagnostics: [{ code: code, severity: 'error', asset: session.state.path, location: null, message: message, details: extra || null }],
        };
    }

    function map() { return session.state.map; }

    function selectedBrushIds() {
        const sel = selection.snapshot();
        if (sel.kind === 'brush') return sel.ids.slice();
        if (sel.kind === 'face') return sel.ids.map((id) => String(id).split(':')[0]);
        return [];
    }

    async function single(kind, op, args) {
        const r = await session.apply(op, args);
        if (r.ok && kind && r.ids && r.ids.length) selection.set(kind, r.ids);
        if (ctx.changed) ctx.changed(r);
        return r;
    }

    async function bulk(label, tasks) {
        if (!tasks.length) return fail('SDK_WORLD_EDIT_EMPTY', 'Нет объектов для операции');
        const before = session.beginBulk();
        const diagnostics = [];
        const ids = [];
        for (const task of tasks) {
            const r = await session.apply(task.op, task.args, { noHistory: true });
            diagnostics.push.apply(diagnostics, r.diagnostics || []);
            if (!r.ok) {
                session.rollbackBulk(before);
                if (ctx.changed) ctx.changed(r);
                return { ok: false, changed: false, ids: [], diagnostics: diagnostics };
            }
            for (const id of (r.ids || [])) if (!ids.includes(id)) ids.push(id);
        }
        const changed = session.commitBulk(label, before);
        if (ctx.changed) ctx.changed({ ok: true, changed: changed, ids: ids, diagnostics: diagnostics });
        return { ok: true, changed: changed, ids: ids, diagnostics: diagnostics };
    }

    // --- Создание/правка геометрии -------------------------------------------

    async function createBrush(args) {
        return single('brush', 'brush.create', args || {});
    }

    async function deleteSelection() {
        const sel = selection.snapshot();
        if(ELEMENT_KINDS[sel.kind])return bulk('Удалить',sel.ids.map(id=>({op:'element.delete',args:{section:ELEMENT_KINDS[sel.kind],id}})));
        if (sel.kind === 'none') return fail('SDK_WORLD_EDIT_NO_SELECTION', 'Сначала выберите объект');
        if (sel.kind === 'brush' || sel.kind === 'face') {
            return single(null, 'brush.delete', { ids: selectedBrushIds() });
        }
        if (sel.kind === 'entity') return single(null, 'entity.delete', { ids: sel.ids });
        if (sel.kind === 'path') {
            return single(null, 'path.delete', { ids: sel.ids });
        }
        if (sel.kind === 'visgroup') {
            return fail('SDK_WORLD_EDIT_VISGROUP_DELETE', 'Удаление visgroup пока не входит в native-контракт');
        }
        return fail('SDK_WORLD_EDIT_NO_SELECTION', 'Нечего удалять');
    }

    async function duplicateSelection() {
        const sel = selection.snapshot();
        const step = viewports.state.gridSize || 16;
        if(ELEMENT_KINDS[sel.kind]) {
            const section=ELEMENT_KINDS[sel.kind],tasks=[];
            for(const id of sel.ids) {
                const value=clone(find(map(),section,id));delete value.id;
                tasks.push({op:'element.create',args:{section,value}});
            }
            return bulk('Дублировать',tasks);
        }
        if (sel.kind === 'brush' || sel.kind === 'face') {
            return single('brush', 'brush.duplicate', { ids: selectedBrushIds(), dx: step, dy: step });
        }
        if (sel.kind === 'entity') {
            const tasks = [];
            for (const id of sel.ids) {
                const entity = find(map(), 'entities', id);
                if (!entity) continue;
                const p = entityPos(entity);
                const fields = clone(entity);
                delete fields.id;
                tasks.push({ op: 'entity.create', args: Object.assign(fields, { x: p.x + step, y: p.y + step }) });
            }
            return bulk('Дублировать сущности', tasks);
        }
        if (sel.kind === 'path') {
            const tasks = [];
            for (const id of sel.ids) {
                const path = find(map(), 'paths', id);
                if (!path) continue;
                const nodes = pathNodes(path).map((node) => ({
                    x: Number(node.x) + step, y: Number(node.y) + step, h: Number(node.h) || 0,
                }));
                const args = { nodes: nodes };
                for (const key of Object.keys(path)) {
                    if (['id', 'nodes'].includes(key)) continue;
                    args[key] = clone(path[key]);
                }
                tasks.push({ op: 'path.create', args: args });
            }
            return bulk('Дублировать пути', tasks);
        }
        return fail('SDK_WORLD_EDIT_DUPLICATE', 'Дублирование поддерживается для brush/entity/path');
    }

    async function moveSelection(dx, dy, dz) {
        const sel = selection.snapshot();
        const ax = Number(dx) || 0, ay = Number(dy) || 0, az = Number(dz) || 0;
        if (!ax && !ay && !az) return { ok: true, changed: false, ids: sel.ids.slice(), diagnostics: [] };
        if(ELEMENT_KINDS[sel.kind])return bulk('Переместить',sel.ids.map(id=>({op:'element.move',args:{section:ELEMENT_KINDS[sel.kind],id,dx:ax,dy:ay,dz:az}})));
        if (sel.kind === 'brush') {
            return single(null, 'brush.move', { ids: sel.ids, dx: ax, dy: ay, dz: az });
        }
        if (sel.kind === 'entity') {
            const tasks = [];
            for (const id of sel.ids) {
                const entity = find(map(), 'entities', id);
                if (!entity) continue;
                const p = entityPos(entity);
                tasks.push({ op: 'entity.set', args: { id: id, fields: { x: p.x + ax, y: p.y + ay, h: p.h + az } } });
            }
            return bulk('Переместить сущности', tasks);
        }
        if (sel.kind === 'path') {
            const tasks = [];
            for (const id of sel.ids) {
                const path = find(map(), 'paths', id);
                if (!path) continue;
                pathNodes(path).forEach((node, index) => {
                    tasks.push({
                        op: 'path.node.move',
                        args: { id: id, index: index, x: (Number(node.x) || 0) + ax, y: (Number(node.y) || 0) + ay, h: (Number(node.h) || 0) + az },
                    });
                });
            }
            return bulk('Переместить путь', tasks);
        }
        return fail('SDK_WORLD_EDIT_MOVE', 'Перемещение поддерживается для brush/entity/path');
    }

    async function resizeSelection(dw, dh, dz) {
        const sel = selection.snapshot();
        if (sel.kind !== 'brush' && sel.kind !== 'face') {
            return fail('SDK_WORLD_EDIT_RESIZE', 'Изменение размера поддерживается для brush');
        }
        const tasks = [];
        for (const id of selectedBrushIds()) {
            const brush = find(map(), 'brushes', id);
            if (!brush) continue;
            const box = brushBox(brush);
            if (!box) {
                return fail('SDK_WORLD_EDIT_RESIZE', 'Brush без rect/polygon: изменение размера недоступно');
            }
            if (Array.isArray(brush.polygon) && !Array.isArray(brush.rect)) {
                return fail('SDK_WORLD_EDIT_RESIZE', 'Изменение размера polygon-brush не выполняется в JS: используйте vertex tool');
            }
            const z = brushZ(brush);
            const rect = [box.x, box.y, Math.max(1, box.w + (Number(dw) || 0)), Math.max(1, box.h + (Number(dh) || 0))];
            const patch = { rect: rect };
            const newTop = z.top + (Number(dz) || 0);
            if (Number.isFinite(newTop) && newTop > z.bottom) patch.top = newTop;
            tasks.push({ op: 'brush.set', args: { ids: [id], patch: patch } });
        }
        return bulk('Изменить размер', tasks);
    }

    async function rotateSelection(degrees) {
        const sel = selection.snapshot();
        if (sel.kind !== 'brush' && sel.kind !== 'face') {
            return fail('SDK_WORLD_EDIT_ROTATE', 'Вращение поддерживается для brush');
        }
        const deg = Number(degrees);
        if (!Number.isFinite(deg) || deg % 90 !== 0) {
            return fail('SDK_WORLD_EDIT_ROTATE', 'Вращение: только кратно 90 градусам');
        }
        const turns = ((Math.round(deg / 90) % 4) + 4) % 4;
        const tasks = [];
        for (const id of selectedBrushIds()) {
            const brush = find(map(), 'brushes', id);
            if (!brush) continue;
            const box = brushBox(brush);
            if (!box) continue;
            if (Array.isArray(brush.rect) && box) {
                let rect = brush.rect.slice(0, 4).map(Number);
                for (let i = 0; i < turns; i++) {
                    const cx = rect[0] + rect[2] / 2, cy = rect[1] + rect[3] / 2;
                    const w = rect[2], h = rect[3];
                    rect = [cx - h / 2, cy - w / 2, h, w];
                }
                tasks.push({ op: 'brush.set', args: { ids: [id], patch: { rect: rect } } });
            } else if (Array.isArray(brush.polygon)) {
                const points = brush.polygon.map((p) => [Number(p[0]), Number(p[1])]);
                let cx = 0, cy = 0;
                for (const p of points) { cx += p[0]; cy += p[1]; }
                cx /= points.length; cy /= points.length;
                const angle = turns * Math.PI / 2;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                const next = points.map((p) => {
                    const dx = p[0] - cx, dy = p[1] - cy;
                    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
                });
                tasks.push({ op: 'brush.set', args: { ids: [id], patch: { polygon: next } } });
            }
        }
        return bulk('Повернуть', tasks);
    }

    async function vertexMove(brushId, vertex, x, y) {
        return single(null, 'brush.vertex.move', { id: brushId, vertex: vertex, x: x, y: y });
    }

    async function clip(brushId, axis, coordinate, keep) {
        const id = brushId || selectedBrushIds()[0];
        if (!id) return fail('SDK_WORLD_EDIT_CLIP', 'Выберите brush для clip');
        return single('brush', 'brush.clip', {
            id: id,
            axis: axis === 'y' ? 'y' : 'x',
            coordinate: Number(coordinate) || 0,
            keep: keep === 'front' || keep === 'back' ? keep : 'both',
        });
    }

    async function setFaceMaterial(brushId, face, material) {
        const id = brushId || selectedBrushIds()[0];
        if (!id) return fail('SDK_WORLD_EDIT_FACE', 'Выберите brush/грань');
        const args = { id: id, face: face === 'floor' || face === 'ceiling' ? face : 'side' };
        if (material !== undefined && material !== null && material !== '') args.material = String(material);
        const r = await single('face', 'face.set', args);
        if (r.ok) selection.setFace(id, args.face);
        return r;
    }

    async function setTags(kind, ids, tags, face) {
        // Совместимость с документированным фасадом: setTags(ids, tags)
        // означает brush-теги; setTags(kind, ids, tags[, face]) — явный тип.
        const kinds = ['face', 'brush', 'entity', 'path', 'world'];
        if (!kinds.includes(kind)) {
            const brushIds = kind;
            const brushTags = ids;
            kind = 'brush';
            ids = brushIds;
            tags = brushTags;
            face = undefined;
        }
        const list1 = Array.isArray(ids) ? ids : [ids];
        const tagList = Array.isArray(tags) ? tags : tagsFromText(tags);
        if (kind === 'face') {
            const brushId = String(list1[0] || selectedBrushIds()[0] || '').split(':')[0];
            if (!brushId) return fail('SDK_WORLD_EDIT_TAGS', 'Выберите грань brush');
            const targetFace = face || 'side';
            const args = { id: brushId, face: targetFace };
            if (targetFace === 'ceiling') args.ceilingTags = tagList;
            else args.tags = tagList;
            const r = await single('face', 'face.set', args);
            if (r.ok) selection.setFace(brushId, targetFace);
            return r;
        }
        if (kind === 'brush') {
            return single(null, 'brush.set', { ids: list1, patch: { tags: tagList } });
        }
        if (kind === 'entity') {
            const tasks = list1.map((id) => ({ op: 'entity.set', args: { id: id, fields: { tags: tagList } } }));
            return bulk('Теги сущностей', tasks);
        }
        if (kind === 'path') {
            const tasks = list1.map((id) => ({ op: 'path.set', args: { id: id, fields: { tags: tagList } } }));
            return bulk('Теги путей', tasks);
        }
        if (kind === 'world') return single(null, 'world.set', { tags: tagList });
        return fail('SDK_WORLD_EDIT_TAGS', 'Теги: неизвестный тип ' + kind);
    }

    async function setWorld(fields) {
        return single(null, 'world.set', fields || {});
    }

    // --- Сущности ------------------------------------------------------------

    async function createEntity(def) {
        return single('entity', 'entity.create', def || {});
    }

    // --- Пути ----------------------------------------------------------------

    async function createPath(def) {
        // Фасад принимает и {nodes:[...]}, и массив узлов, и один узел.
        let args = def;
        if (Array.isArray(def)) args = { nodes: def };
        else if (def && typeof def === 'object' && !Array.isArray(def.nodes) &&
            (def.x !== undefined || def.y !== undefined) && def.nodes === undefined) {
            args = { nodes: [def] };
        }
        return single('path', 'path.create', args || {});
    }

    async function addPathNode(pathId, node, index) {
        const id = pathId || selection.first();
        if (!id) return fail('SDK_WORLD_EDIT_PATH', 'Выберите путь');
        const args = { id: id, node: node || { x: 0, y: 0, h: 0 } };
        if (Number.isInteger(index)) args.index = index;
        return single('path', 'path.node.add', args);
    }

    async function movePathNode(pathId, index, x, y, h) {
        const id = pathId || selection.first();
        if (!id) return fail('SDK_WORLD_EDIT_PATH', 'Выберите путь');
        const args = { id: id, index: Number(index) || 0, x: Number(x) || 0, y: Number(y) || 0 };
        if (Number.isFinite(Number(h))) args.h = Number(h);
        return single(null, 'path.node.move', args);
    }

    async function deletePathNode(pathId, index) {
        const id = pathId || selection.first();
        if (!id) return fail('SDK_WORLD_EDIT_PATH', 'Выберите путь');
        return single(null, 'path.node.delete', { id: id, index: Number(index) || 0 });
    }

    async function connectPath(pathId, fromIndex, toIndex, loop) {
        const id = pathId || selection.first();
        const path = find(map(), 'paths', id);
        if (!path) return fail('SDK_WORLD_EDIT_PATH', 'Выберите путь');
        const a = Number(fromIndex), b = Number(toIndex);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
            return fail('SDK_WORLD_EDIT_PATH', 'Соединение: нужны два разных индекса узлов');
        }
        const fields = { connections: clone(Array.isArray(path.connections) ? path.connections : []) };
        const pair = [a, b];
        if (!fields.connections.some((c) => Array.isArray(c) && c[0] === a && c[1] === b)) fields.connections.push(pair);
        if (loop !== undefined) fields.loop = !!loop;
        return single(null, 'path.set', { id: id, fields: fields });
    }

    async function setPathFields(pathId, fields) {
        const id = pathId || selection.first();
        if (!id) return fail('SDK_WORLD_EDIT_PATH', 'Выберите путь');
        return single(null, 'path.set', { id: id, fields: fields || {} });
    }

    // --- VisGroups -----------------------------------------------------------

    async function ensureVisgroup(def) {
        const args = typeof def === 'string' ? { name: def } : Object.assign({}, def || {});
        if (!args.name) args.name = args.id || 'visgroup';
        return single('visgroup', 'visgroup.ensure', args);
    }

    async function setVisgroupState(id, fields) {
        const args = Object.assign({ id: id }, fields || {});
        return single(null, 'visgroup.state', args);
    }

    async function toggleVisgroupHidden(id) {
        const group = find(map(), 'visgroups', id);
        if (!group) return fail('SDK_WORLD_EDIT_VISGROUP', 'VisGroup не найден');
        return setVisgroupState(id, { visible: group.visible === false });
    }

    async function toggleVisgroupLocked(id) {
        const group = find(map(), 'visgroups', id);
        if (!group) return fail('SDK_WORLD_EDIT_VISGROUP', 'VisGroup не найден');
        return setVisgroupState(id, { locked: !group.locked });
    }

    // --- Инспектор (схема → native-поля) -------------------------------------

    async function applyInspector(kind, values) {
        const sel = selection.snapshot();
        const id = sel.ids.length ? String(sel.ids[0]).split(':')[0] : null;
        const v = values || {};
        if(ELEMENT_KINDS[kind]) {
            const section=ELEMENT_KINDS[kind],value=clone(find(map(),section,id)||{});
            try {
                for(const key of Object.keys(v)) {
                    if(typeof value[key]==='object')value[key]=JSON.parse(v[key]);
                    else if(typeof value[key]==='number') {const n=Number(String(v[key]).trim());if(String(v[key]).trim()===''||!Number.isFinite(n))throw new Error(key+': нужно число');value[key]=n;}
                    else if(typeof value[key]==='boolean') {if(!['true','false'].includes(String(v[key])))throw new Error(key+': true/false');value[key]=String(v[key])==='true';}
                    else value[key]=String(v[key]);
                }
            } catch(e) {return fail('SDK_WORLD_EDIT_INSPECTOR',e.message);}
            return single(kind,'element.replace',{section,id,value});
        }
        if (kind === 'brush') {
            const brush = find(map(), 'brushes', id) || {};
            const patch = {};
            if (v.id !== undefined && String(v.id) !== String(brush.id)) patch.id = String(v.id).trim();
            if (v.tool !== undefined) patch.tool = String(v.tool);
            if (v.rect !== undefined && String(v.rect).trim() !== '') {
                const rect = parseRect(v.rect);
                if (!rect) return fail('SDK_WORLD_EDIT_INSPECTOR', 'rect: нужны четыре числа x,y,w,h');
                if (JSON.stringify(rect) !== JSON.stringify(brush.rect)) patch.rect = rect;
            }
            // Пустое поле не означает "стереть geometry": rect и polygon
            // взаимоисключающие в native, поэтому пустое просто не отправляем.
            if (v.polygon !== undefined && String(v.polygon).trim() !== '') {
                const polygon = parsePolygon(v.polygon);
                if (!polygon) return fail('SDK_WORLD_EDIT_INSPECTOR', 'polygon: нужен JSON [[x,y],...]');
                if (JSON.stringify(polygon) !== JSON.stringify(brush.polygon)) patch.polygon = polygon;
            }
            if (v.bottom !== undefined && String(v.bottom).trim() !== '') {
                const n = parseNumber(v.bottom, brush.bottom);
                if (n !== Number(brush.bottom)) patch.bottom = n;
            }
            if (v.top !== undefined && String(v.top).trim() !== '') {
                const n = parseNumber(v.top, brush.top);
                if (n !== Number(brush.top)) patch.top = n;
            }
            for (const key of ['sideColor', 'floorColor', 'ceilingColor', 'visgroup']) {
                if (v[key] !== undefined && String(v[key]) !== String(brush[key] || '')) patch[key] = String(v[key]);
            }
            if (v.tags !== undefined && JSON.stringify(tagsFromText(v.tags)) !== JSON.stringify(brush.tags || [])) {
                patch.tags = tagsFromText(v.tags);
            }
            if (v.ceilingTags !== undefined && JSON.stringify(tagsFromText(v.ceilingTags)) !== JSON.stringify(brush.ceilingTags || [])) {
                patch.ceilingTags = tagsFromText(v.ceilingTags);
            }
            if (v.holes !== undefined && String(v.holes).trim() !== '') {
                try { patch.holes = JSON.parse(String(v.holes)); }
                catch (e) { return fail('SDK_WORLD_EDIT_INSPECTOR', 'holes: некорректный JSON'); }
            }
            if (v.subtract !== undefined && truthy(v.subtract) !== !!brush.subtract) patch.subtract = truthy(v.subtract);
            if (!Object.keys(patch).length) return { ok: true, changed: false, ids: [], diagnostics: [] };
            return single(null, 'brush.set', { ids: [id], patch: patch });
        }
        if (kind === 'face') {
            const face = v.face || sel.face || 'side';
            const args = { id: id, face: face };
            if (v.material !== undefined) args.material = String(v.material);
            if (v.tags !== undefined) {
                if (face === 'ceiling') args.ceilingTags = tagsFromText(v.tags);
                else args.tags = tagsFromText(v.tags);
            }
            const r = await single('face', 'face.set', args);
            if (r.ok) selection.setFace(id, face);
            return r;
        }
        if (kind === 'entity') {
            const entity = find(map(), 'entities', id) || {};
            const fields = {};
            if (v.id !== undefined && String(v.id) !== String(entity.id)) fields.id = String(v.id).trim();
            if (v.kind !== undefined && String(v.kind) !== String(entity.kind || '')) fields.kind = String(v.kind);
            for (const key of ['x', 'y', 'h']) {
                if (v[key] === undefined || String(v[key]).trim() === '') continue;
                const n = parseNumber(v[key], Number(entity[key]) || 0);
                if (n !== (Number(entity[key]) || 0)) fields[key] = n;
            }
            for (const key of ['brush', 'target']) {
                if (v[key] !== undefined && String(v[key]) !== String(entity[key] || '')) fields[key] = String(v[key]);
            }
            if (v.tags !== undefined && JSON.stringify(tagsFromText(v.tags)) !== JSON.stringify(entity.tags || [])) {
                fields.tags = tagsFromText(v.tags);
            }
            if (!Object.keys(fields).length) return { ok: true, changed: false, ids: [], diagnostics: [] };
            return single(null, 'entity.set', { id: id, fields: fields });
        }
        if (kind === 'path') {
            const fields = {};
            if (v.id !== undefined) fields.id = String(v.id).trim();
            if (v.name !== undefined) fields.name = String(v.name);
            if (v.type !== undefined) fields.type = String(v.type);
            if (v.loop !== undefined) fields.loop = truthy(v.loop);
            if (v.oneWay !== undefined) fields.oneWay = truthy(v.oneWay);
            if (v.nodes !== undefined) {
                try { fields.nodes = JSON.parse(String(v.nodes)); }
                catch (e) { return fail('SDK_WORLD_EDIT_INSPECTOR', 'nodes: некорректный JSON'); }
            }
            if (v.metadata !== undefined) {
                if (String(v.metadata).trim() === '') fields.metadata = null;
                else {
                    try { fields.metadata = JSON.parse(String(v.metadata)); }
                    catch (e) { return fail('SDK_WORLD_EDIT_INSPECTOR', 'metadata: некорректный JSON'); }
                }
            }
            return single(null, 'path.set', { id: id, fields: fields });
        }
        if (kind === 'visgroup') {
            const fields = {};
            if (v.name !== undefined) fields.name = String(v.name);
            if (v.visible !== undefined) fields.visible = truthy(v.visible);
            if (v.locked !== undefined) fields.locked = truthy(v.locked);
            return single(null, 'visgroup.state', Object.assign({ id: id }, fields));
        }
        if (kind === 'world') {
            const world = (map() && map().world) || {};
            const fields = {};
            for (const key of ['x', 'y', 'w', 'h', 'bottom', 'top']) {
                if (v[key] === undefined || String(v[key]).trim() === '') continue;
                const n = parseNumber(v[key], Number(world[key]) || 0);
                if (n !== (Number(world[key]) || 0)) fields[key] = n;
            }
            for (const key of ['boundary', 'floorColor', 'ceilingColor', 'sideColor']) {
                if (v[key] !== undefined && String(v[key]) !== String(world[key] || '')) fields[key] = String(v[key]);
            }
            if (v.tags !== undefined && JSON.stringify(tagsFromText(v.tags)) !== JSON.stringify(world.tags || [])) {
                fields.tags = tagsFromText(v.tags);
            }
            if (!Object.keys(fields).length) return { ok: true, changed: false, ids: [], diagnostics: [] };
            return single(null, 'world.set', fields);
        }
        return fail('SDK_WORLD_EDIT_INSPECTOR', 'Инспектор: неизвестный тип ' + kind);
    }

    function setGrid(size) {
        const n = Number(size);
        const allowed = [1, 2, 4, 8, 16, 32, 64, 128, 256];
        if (allowed.includes(n)) viewports.setGridSize(n);
        return viewports.state.gridSize;
    }

    function stepGrid(direction) {
        const allowed = [1, 2, 4, 8, 16, 32, 64, 128, 256];
        let at = allowed.indexOf(viewports.state.gridSize);
        if (at < 0) at = 4;
        at = Math.max(0, Math.min(allowed.length - 1, at + (direction < 0 ? -1 : 1)));
        viewports.setGridSize(allowed[at]);
        return viewports.state.gridSize;
    }

    async function validate() {
        const r = await session.validate();
        // Декларативные validators расширений видны в той же диагностике.
        if (ext && ext.validators) {
            for (const validator of ext.validators()) {
                note(
                    validator.severity || 'info',
                    validator.code || 'SDK_EXTENSION_VALIDATOR',
                    validator.message || validator.label || ('validator: ' + validator.id),
                    { asset: session.state.path }
                );
            }
        }
        return r;
    }

    async function buildAndRun() {
        const r = await session.buildAndRun();
        if (!r.ok) return r;
        // Декларативные buildSteps: command исполняется тем же ops-слоем,
        // шаг без command остаётся метаданными в журнале сборки.
        if (ext && ext.buildSteps) {
            for (const step of ext.buildSteps()) {
                if (step.command) {
                    const done = await runExtensionCommand(step.command, step.args || {});
                    if (!done.ok) return { ok: false, stage: 'extension', diagnostics: done.diagnostics, stats: r.stats };
                } else {
                    session.state.log.push('extension build step: ' + (step.label || step.id));
                }
            }
        }
        return r;
    }

    async function runExtensionCommand(name, extraArgs) {
        const command = ext && ext.findCommand ? ext.findCommand(name) : null;
        if (!command) return fail('SDK_EXTENSION_COMMAND', 'Команда расширения не найдена: ' + name);
        const args = Object.assign({}, command.args || {}, extraArgs || {});
        const op = command.op;
        if (!op) return fail('SDK_EXTENSION_COMMAND', 'Команда расширения без op: ' + name);
        return single(null, op, args);
    }

    function addWorldElement(section,value) {
        const kind=Object.keys(ELEMENT_KINDS).find(k=>ELEMENT_KINDS[k]===section);
        if(!kind)return fail('SDK_WORLD_EDIT_ELEMENT','Неизвестный раздел '+section);
        return single(kind,'element.create',{section,value:clone(value||ELEMENT_DEFAULTS[section])});
    }
    function setWorldElement(section,id,value) {
        const kind=Object.keys(ELEMENT_KINDS).find(k=>ELEMENT_KINDS[k]===section);
        return single(kind,'element.replace',{section,id,value});
    }
    return {
        session, selection, viewports,
        addWorldElement,setWorldElement,
        splitWall:(id)=>single('wall','wall.split',{id:id||selection.first()}),
        joinWalls:(id,other)=>single('wall','wall.join',{id:id||selection.first(),other}),
        createBrush, deleteSelection, duplicateSelection, moveSelection, resizeSelection, rotateSelection,
        vertexMove, clip, setFaceMaterial, setTags, setWorld, createEntity,
        createPath, addPathNode, movePathNode, deletePathNode, connectPath, setPathFields,
        ensureVisgroup, setVisgroupState, toggleVisgroupHidden, toggleVisgroupLocked,
        applyInspector, setGrid, stepGrid, runExtensionCommand,
        save: () => session.save(),
        validate: validate,
        compile: (write) => session.compile(write),
        buildAndRun: buildAndRun,
        open: (path) => session.open(path),
        newMap: (name) => session.newMap(name),
        select: (kind, ids, face) => selection.set(kind, ids, face),
    };
}
