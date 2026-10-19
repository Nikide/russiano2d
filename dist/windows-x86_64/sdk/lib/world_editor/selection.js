// ===========================================================================
// World Editor: выделение (brush/face/vertex/entity/path/visgroup).
//
// Модуль не меняет данные карты и не проверяет геометрию: он только хранит
// набор id и умеет попадать по экранным bbox. Одна и та же модель выделения
// используется деревом объектов, вьюпортами, инспектором, агентом и тестом.
// ===========================================================================

import { KIND_SECTION, find, displayItems } from './model.js';

export function createSelection(mapRef) {
    const state = { kind: 'none', ids: [], face: 'side' };
    const listeners = [];

    function changed() {
        for (const fn of listeners) {
            try { fn(snapshot()); } catch (e) { /* слушатель не должен ломать редактор */ }
        }
    }

    function exists(kind, id) {
        const section = KIND_SECTION[kind];
        if (!section) return false;
        if (kind === 'face') return false;
        return !!find(mapRef(), section, id);
    }

    function set(kind, ids, face) {
        if (!kind || kind === 'none') {
            state.kind = 'none';
            state.ids = [];
        } else {
            const unique = [];
            for (const raw of (Array.isArray(ids) ? ids : [ids])) {
                if (raw === null || raw === undefined) continue;
                const value = String(raw);
                if (!value || unique.includes(value)) continue;
                if (!exists(kind, value)) continue;
                unique.push(value);
            }
            state.kind = unique.length ? kind : 'none';
            state.ids = unique;
        }
        if (face) state.face = face;
        changed();
        return snapshot();
    }

    function toggle(kind, id, face) {
        if (state.kind !== kind) return set(kind, [id], face);
        const value = String(id);
        const next = state.ids.slice();
        const at = next.indexOf(value);
        if (at >= 0) next.splice(at, 1);
        else next.push(value);
        return set(kind, next, face);
    }

    function clear() {
        return set('none', []);
    }

    function selectAll(kind) {
        const section = KIND_SECTION[kind];
        if (!section) return snapshot();
        const items = mapRef()[section] || [];
        return set(kind, items.map((v) => v && v.id));
    }

    function setFace(brushId, face) {
        return set('face', [String(brushId) + ':' + String(face || 'side')], face || 'side');
    }

    function first() {
        return state.ids.length ? state.ids[0] : null;
    }

    function items() {
        if (state.kind === 'none' || state.kind === 'face') return [];
        const section = KIND_SECTION[state.kind];
        const out = [];
        for (const id of state.ids) {
            const value = find(mapRef(), section, id);
            if (value) out.push({ kind: state.kind, id: id, value: value });
        }
        return out;
    }

    function snapshot() {
        return { kind: state.kind, ids: state.ids.slice(), face: state.face };
    }

    function key() {
        return snapshot();
    }

    /** Убрать id, которых больше нет в модели (после undo/delete). */
    function prune() {
        if (state.kind === 'none' || state.kind === 'face') return snapshot();
        return set(state.kind, state.ids);
    }

    function subscribe(fn) {
        listeners.push(fn);
        return () => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        };
    }

    // --- Попадание мышью -----------------------------------------------------

    /**
     * project(box) -> {x,y,w,h} в координатах вьюпорта (передаёт viewport.js).
     * Для brush/entity/path достаточно bbox; face/vertex обрабатывает редактор.
     */
    function pick(project, x, y, kindFilter) {
        const candidates = [];
        for (const item of displayItems(mapRef())) {
            if (kindFilter && kindFilter.length && !kindFilter.includes(item.kind)) continue;
            if (!item.box) continue;
            const box = project(item.box);
            if (!box) continue;
            if (x < box.x || y < box.y || x > box.x + box.w || y > box.y + box.h) continue;
            candidates.push({ kind: item.kind, id: item.id, area: Math.max(1, box.w) * Math.max(1, box.h) });
        }
        candidates.sort((a, b) => a.area - b.area);
        return candidates.length ? candidates[0] : null;
    }

    /** Рамка выделения: возвращает {kind, ids} ближайшего непустого типа. */
    function boxSelect(project, rect) {
        const byKind = { brush: [], entity: [], path: [] };
        for (const item of displayItems(mapRef())) {
            if (!byKind[item.kind] || !item.box) continue;
            const box = project(item.box);
            if (!box) continue;
            const hit = !(box.x + box.w < rect.x || box.x > rect.x + rect.w ||
                box.y + box.h < rect.y || box.y > rect.y + rect.h);
            if (hit) byKind[item.kind].push(item.id);
        }
        for (const kind of ['brush', 'entity', 'path']) {
            if (byKind[kind].length) return { kind: kind, ids: byKind[kind] };
        }
        return { kind: 'none', ids: [] };
    }

    return {
        state,
        set, toggle, clear, selectAll, setFace, first, items, snapshot, key, prune, subscribe, pick, boxSelect,
    };
}
