// ===========================================================================
// Модель графа проекта Editor (docs/PROJECT_JSON.md §6).
//
// Чистые функции без движка и RmlUi: читают `editor.graph` из project.json
// (его пишет `r2d project-index`) и строят виды — обзор, область World,
// составная сущность, сцены, ресурсы — с раскладкой карточек и рёбер.
// Модель ничего не вычисляет по коду сама: связи берутся только из manifest,
// а записи с origin "graph" показываются так же, как записи кода.
// Граф read-only: здесь нет операций изменения.
// ===========================================================================

export const CARD = { w: 190, h: 58, gx: 150, gy: 24, top: 34, left: 16 };
const DEFAULT_MAX_NODES = 60;

const baseName = (p) => String(p || '').split('/').pop();

/** `editor.graph` из project.json → индексы для видов; null, если графа нет. */
export function normalizeGraph(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const g = {
        raw,
        format: raw.format || 0,
        status: raw.status || 'current',
        sources: Array.isArray(raw.sources) ? raw.sources : [],
        diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
        areas: new Map(), entities: new Map(), edges: [],
        children: new Map(),    // ключ родителя (сущность или область) → [ключ потомка]
        parentOf: new Map(),    // ключ потомка → ключ родителя
        uses: new Map(),        // ключ владельца → [{ edge, to }]
        usedBy: new Map(),      // ключ ресурса → [ключ владельца]
        problems: [],
    };
    for (const a of Array.isArray(raw.areas) ? raw.areas : []) if (a && a.key) g.areas.set(a.key, a);
    for (const e of Array.isArray(raw.entities) ? raw.entities : []) if (e && e.key) g.entities.set(e.key, e);
    const known = (k) => g.entities.has(k) || g.areas.has(k);
    for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
        if (!e || !e.key) continue;
        if (!known(e.from) || !known(e.to)) { g.problems.push('ребро ' + e.key + ' ссылается на неизвестную запись'); continue; }
        g.edges.push(e);
        if (e.type === 'spatial_parent') {
            if (!g.children.has(e.from)) g.children.set(e.from, []);
            g.children.get(e.from).push(e.to);
            if (!g.parentOf.has(e.to)) g.parentOf.set(e.to, e.from);
        } else if (e.type === 'uses_resource') {
            if (!g.uses.has(e.from)) g.uses.set(e.from, []);
            g.uses.get(e.from).push({ edge: e, to: e.to });
            if (!g.usedBy.has(e.to)) g.usedBy.set(e.to, []);
            g.usedBy.get(e.to).push(e.from);
        }
    }
    const list = (type) => [...g.entities.values()].filter((e) => e.type === type);
    g.scenes = list('scene');
    g.scripts = list('script');
    g.resources = list('resource');
    g.objects = list('object');
    g.worlds = [...g.areas.values()].filter((a) => a.type === 'world');
    return g;
}

// --- карточки -------------------------------------------------------------------

const TAG_ICONS = {
    player: 'directions_run', enemy: 'bug_report', npc: 'face', sprite: 'image', particles: 'auto_awesome',
    light: 'lightbulb', text: 'title', tilemap: 'grid_on', wall: 'crop_square', trigger: 'sensors', area: 'crop_free',
    rect: 'rectangle', circle: 'circle', bullet: 'trending_flat', pickup: 'redeem',
};
const RES_ICONS = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', ogg: 'audiotrack', wav: 'audiotrack', mp3: 'audiotrack',
                    json: 'data_object', rml: 'web', rcss: 'web', ttf: 'text_fields', otf: 'text_fields' };

export function objectLabel(e) {
    return e.public_id ? '<' + e.tag + '> #' + e.public_id : '<' + e.tag + '>';
}

function sourceText(e) {
    return e.source && e.source.file ? baseName(e.source.file) + ':' + (e.source.line || 1) : '';
}

/** Описание карточки сущности для показа: заголовок, подпись, имя иконки, вид. */
export function cardOf(g, key) {
    const e = g.entities.get(key);
    if (e) {
        if (e.type === 'object') {
            const kids = (g.children.get(key) || []).length;
            return { id: key, kind: 'object', title: objectLabel(e), icon: TAG_ICONS[e.tag] || 'deployed_code',
                     sub: sourceText(e) + (e.dynamic ? ' · в цикле' : ''), entity: key, dynamic: !!e.dynamic,
                     open: kids ? 'children:' + key : null, kids };
        }
        if (e.type === 'scene') return { id: key, kind: 'scene', title: e.name, icon: 'movie', sub: "$.scene.add('" + e.name + "')", entity: key, open: null };
        if (e.type === 'script') return { id: key, kind: 'script', title: baseName(e.path), icon: 'javascript', sub: e.entry ? 'Точка входа' : e.path, entity: key, open: null };
        if (e.type === 'resource') {
            const x = (/\.([^./]+)$/.exec(e.path) || [])[1] || '';
            return { id: key, kind: 'resource', title: baseName(e.path), icon: RES_ICONS[x.toLowerCase()] || 'description',
                     sub: e.path + (e.missing ? ' · файла нет' : ''), entity: key, missing: !!e.missing, open: null };
        }
    }
    const a = g.areas.get(key);
    if (a) {
        if (a.type === 'world') {
            const n = objectsIn(g, key).length;
            return { id: key, kind: 'world', title: a.label || 'World', icon: 'public', sub: (a.runtime_root || '$.world') + ' · ' + n + ' ' + plural(n), entity: null, open: key, area: key };
        }
        if (a.type === 'entity') return Object.assign(cardOf(g, a.entity) || { id: key, title: a.label, kind: 'object', icon: 'deployed_code', sub: '' }, { id: key });
        return { id: key, kind: 'project', title: a.label || 'Проект', icon: 'folder', sub: '', entity: null, open: null };
    }
    return null;
}

function plural(n) {
    const m = n % 100, d = n % 10;
    if (m >= 11 && m <= 14) return 'объектов';
    return d === 1 ? 'объект' : d >= 2 && d <= 4 ? 'объекта' : 'объектов';
}

export function objectsIn(g, areaKey) {
    return g.objects.filter((o) => o.area === areaKey).map((o) => o.key);
}

// --- раскладка --------------------------------------------------------------------

function place(nodes) {
    let w = 0, h = 0;
    for (const n of nodes) {
        n.w = CARD.w; n.h = CARD.h;
        n.x = CARD.left + n.col * (CARD.w + CARD.gx);
        n.y = CARD.top + n.row * (CARD.h + CARD.gy);
        w = Math.max(w, n.x + n.w); h = Math.max(h, n.y + n.h);
    }
    return { w: w + CARD.left, h: h + CARD.left };
}

function column(view, items, col, labelText) {
    items.forEach((card, row) => view.nodes.push(Object.assign({ col, row }, card)));
    view.labels.push({ col, text: labelText + ' (' + items.length + ')' });
}

function edgeLabel(e) {
    if (e.type === 'scene_registration') return '$.scene.add';
    if (e.type === 'uses_resource') return '.' + (e.evidence && e.evidence.api || 'sprite') + '(…)';
    if (e.type === 'spatial_parent') return '.' + (e.evidence && e.evidence.api || 'appendTo') + '(…)';
    return e.type;
}

function finish(view) {
    view.bounds = place(view.nodes);
    for (const l of view.labels) { l.x = CARD.left + l.col * (CARD.w + CARD.gx); l.y = 8; }
    const have = new Set(view.nodes.map((n) => n.id));
    view.edges = view.edges.filter((e) => have.has(e.from) && have.has(e.to));
    return view;
}

const newView = (title, crumbs) => ({ title, crumbs, nodes: [], edges: [], labels: [], bounds: { w: 0, h: 0 } });

/** Обзор: скрипты → сцены → World → ресурсы. */
export function overviewView(g) {
    const v = newView('Проект', [{ label: 'Проект', view: 'overview' }]);
    column(v, g.scripts.map((e) => cardOf(g, e.key)), 0, 'Скрипты');
    column(v, g.scenes.map((e) => cardOf(g, e.key)), 1, 'Сцены');
    column(v, g.worlds.map((a) => cardOf(g, a.key)), 2, 'World');
    column(v, g.resources.map((e) => cardOf(g, e.key)), 3, 'Ресурсы');
    for (const e of g.edges) if (e.type === 'scene_registration') v.edges.push({ id: e.key, from: e.from, to: e.to, label: edgeLabel(e), type: e.type });
    for (const a of g.worlds) if (a.scene) v.edges.push({ id: 'derived:' + a.key, from: a.scene, to: a.key, label: '.world', type: 'scene_world', derived: true });
    // Ресурсы объектов мира, агрегированно: одна связь World → ресурс.
    const seen = new Map();
    for (const o of g.objects) for (const u of g.uses.get(o.key) || []) {
        const id = o.area + '>' + u.to;
        if (!seen.has(id)) { seen.set(id, { id: 'derived:' + id, from: o.area, to: u.to, label: edgeLabel(u.edge), type: 'uses_resource', derived: true, n: 0 }); }
        seen.get(id).n++;
    }
    for (const e of seen.values()) { if (e.n > 1) e.label += ' ×' + e.n; v.edges.push(e); }
    return finish(v);
}

/** Сцены: скрипты, регистрирующие сцены, и их World. */
export function scenesView(g) {
    const v = newView('Сцены', [{ label: 'Проект', view: 'overview' }, { label: 'Сцены', view: 'scenes' }]);
    column(v, g.scripts.filter((s) => g.edges.some((e) => e.type === 'scene_registration' && e.from === s.key)).map((e) => cardOf(g, e.key)), 0, 'Скрипты');
    column(v, g.scenes.map((e) => cardOf(g, e.key)), 1, 'Сцены');
    column(v, g.worlds.map((a) => cardOf(g, a.key)), 2, 'World');
    for (const e of g.edges) if (e.type === 'scene_registration') v.edges.push({ id: e.key, from: e.from, to: e.to, label: edgeLabel(e), type: e.type });
    for (const a of g.worlds) if (a.scene) v.edges.push({ id: 'derived:' + a.key, from: a.scene, to: a.key, label: '.world', type: 'scene_world', derived: true });
    return finish(v);
}

/** Ресурсы: кто какой ресурс использует. */
export function resourcesView(g) {
    const v = newView('Ресурсы', [{ label: 'Проект', view: 'overview' }, { label: 'Ресурсы', view: 'resources' }]);
    const owners = [];
    for (const r of g.resources) for (const k of g.usedBy.get(r.key) || []) if (!owners.includes(k)) owners.push(k);
    column(v, owners.map((k) => cardOf(g, k)), 0, 'Объекты');
    column(v, g.resources.map((e) => cardOf(g, e.key)), 1, 'Ресурсы');
    for (const e of g.edges) if (e.type === 'uses_resource') v.edges.push({ id: e.key, from: e.from, to: e.to, label: edgeLabel(e), type: e.type });
    return finish(v);
}

/** Цепочка «хлебных крошек» для области: Проект → Сцена → World → сущность … */
export function crumbsOf(g, areaKey) {
    const crumbs = [{ label: 'Проект', view: 'overview' }];
    const chain = [];
    let key = areaKey;
    for (let guard = 0; key && guard < 64; guard++) {
        const a = g.areas.get(key);
        if (!a) break;
        chain.unshift(a);
        if (a.type === 'entity') key = a.parent;
        else break;
    }
    const world = chain[0];
    if (world && world.type === 'world' && world.scene) {
        const sc = g.entities.get(world.scene);
        if (sc) crumbs.push({ label: 'Сцена ' + sc.name, view: 'scenes', select: world.scene });
    }
    for (const a of chain) crumbs.push({ label: a.type === 'world' ? (a.label || 'World') : a.label, view: 'area', area: a.key });
    return crumbs;
}

/** Область: World сцены или составная сущность; `maxNodes` — предел до агрегирования. */
export function areaView(g, areaKey, opts) {
    const area = g.areas.get(areaKey);
    if (!area || (area.type !== 'world' && area.type !== 'entity')) return null;
    const maxNodes = (opts && opts.maxNodes) || DEFAULT_MAX_NODES;
    const rootCard = cardOf(g, areaKey);
    const v = newView(area.label || 'World', crumbsOf(g, areaKey));
    const rootKey = area.type === 'entity' ? area.entity : areaKey;

    const direct = (k) => (g.children.get(k) || []).filter((c) => g.entities.has(c));
    const tops = area.type === 'entity' ? direct(rootKey)
        : objectsIn(g, areaKey).filter((o) => g.parentOf.get(o) === areaKey || !g.parentOf.has(o));
    const count = (k) => 1 + direct(k).reduce((n, c) => n + count(c), 0);
    const total = tops.reduce((n, k) => n + count(k), 0);
    const maxDepth = total > maxNodes ? 1 : 64;

    v.nodes.push(Object.assign({ col: 0, row: 0, root: true }, rootCard, { id: areaKey }));
    let row = 0, deepest = 0;
    const emitted = new Set();
    const walk = (k, depth, parentKey) => {
        if (emitted.has(k)) return;
        emitted.add(k);
        const card = cardOf(g, k);
        const kids = direct(k);
        const collapsed = kids.length && depth >= maxDepth;
        if (collapsed) card.badge = '+' + (count(k) - 1);
        v.nodes.push(Object.assign({ col: depth, row: row++ }, card));
        deepest = Math.max(deepest, depth);
        v.edges.push({ id: 'p:' + parentKey + '>' + k, from: parentKey, to: k, type: 'spatial_parent',
                       label: edgeLabel((g.edges.find((e) => e.type === 'spatial_parent' && e.to === k) || {})) });
        if (!collapsed) for (const c of kids) walk(c, depth + 1, k);
    };
    for (const k of tops) walk(k, 1, areaKey);
    // Корень стоит на уровне первой строки; ресурсы — в последнем столбце.
    const placed = new Map(v.nodes.map((n) => [n.id, n]));
    const resCol = deepest + 1;
    const taken = new Set();
    const resNodes = [];
    for (const n of v.nodes.slice()) {
        if (n.kind !== 'object' && !n.root) continue;
        const ownerKey = n.root ? rootKey : n.id;
        for (const u of g.uses.get(ownerKey) || []) {
            if (!placed.has(u.to)) {
                const card = cardOf(g, u.to);
                let r = n.row;
                while (taken.has(r)) r++;
                taken.add(r);
                const rn = Object.assign({ col: resCol, row: r }, card);
                placed.set(u.to, rn);
                resNodes.push(rn);
            }
            v.edges.push({ id: u.edge.key + '@' + n.id, from: n.id, to: u.to, label: edgeLabel(u.edge), type: 'uses_resource' });
        }
    }
    v.nodes.push(...resNodes);
    v.labels.push({ col: 0, text: area.type === 'world' ? 'World' : 'Сущность' });
    if (deepest >= 1) v.labels.push({ col: 1, text: 'Объекты' });
    if (resNodes.length) v.labels.push({ col: resCol, text: 'Ресурсы (' + resNodes.length + ')' });
    v.collapsed = total > maxNodes;
    return finish(v);
}

/** Куда перейти, чтобы увидеть сущность: { view, area, select }. */
export function locate(g, key, opts) {
    const e = g.entities.get(key);
    if (!e) return g.areas.has(key) ? { view: 'area', area: key, select: key } : null;
    if (e.type === 'object') {
        const maxNodes = (opts && opts.maxNodes) || DEFAULT_MAX_NODES;
        const world = g.areas.get(e.area);
        const worldTotal = objectsIn(g, e.area).length;
        if (!world || worldTotal <= maxNodes) return { view: 'area', area: e.area, select: key };
        // Большой World показывает только верхние уровни: идём к ближайшему предку, который это умеет.
        let parent = g.parentOf.get(key);
        if (parent && g.entities.has(parent)) return { view: 'area', area: 'children:' + parent, select: key };
        return { view: 'area', area: e.area, select: key };
    }
    if (e.type === 'resource') {
        const owner = (g.usedBy.get(key) || [])[0];
        const oe = owner && g.entities.get(owner);
        return oe ? { view: 'area', area: oe.area, select: key } : { view: 'overview', select: key };
    }
    return { view: 'overview', select: key };
}

/** Поиск по тегу, id, имени, пути ресурса и месту в коде. */
export function searchGraph(g, query, limit) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const e of g.entities.values()) {
        const hay = [e.key, e.tag, e.public_id, e.name, e.path, e.source && e.source.file].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
        const c = cardOf(g, e.key);
        out.push({ key: e.key, label: c.title, detail: c.sub, kind: c.kind });
        if (out.length >= (limit || 30)) break;
    }
    return out;
}

/** Строки Inspector для выбранной карточки. */
export function describe(g, key) {
    const e = g.entities.get(key), a = g.areas.get(key);
    if (!e && !a) return [];
    const rows = [];
    const src = e && e.source && e.source.file ? { file: e.source.file, line: e.source.line || 1 } : null;
    if (e && e.type === 'object') {
        const parentKey = g.parentOf.get(key);
        const parent = parentKey && (g.entities.get(parentKey) ? objectLabel(g.entities.get(parentKey)) : g.areas.get(parentKey) && (g.areas.get(parentKey).label || 'World'));
        rows.push(['Тип', '<' + e.tag + '>'], ['ID', e.public_id || '—']);
        if (src) rows.push(['Файл', src.file + ':' + src.line, src]);
        rows.push(['Область', (g.areas.get(e.area) || {}).label || e.area], ['Родитель', parent || '—'],
                  ['Потомков', String((g.children.get(key) || []).length)]);
        const res = (g.uses.get(key) || []).map((u) => (g.entities.get(u.to) || {}).path).filter(Boolean);
        if (res.length) rows.push(['Ресурсы', res.join(', ')]);
        rows.push(['Источник', e.origin || 'code']);
        if (e.dynamic) rows.push(['Создание', 'в цикле: одна запись на место в коде']);
    } else if (e && e.type === 'scene') {
        rows.push(['Сцена', e.name]);
        if (src) rows.push(['Файл', src.file + ':' + src.line, src]);
        const world = [...g.areas.values()].find((x) => x.type === 'world' && x.scene === key);
        rows.push(['World', world ? objectsIn(g, world.key).length + ' ' + plural(objectsIn(g, world.key).length) : 'нет объектов']);
    } else if (e && e.type === 'script') {
        rows.push(['Скрипт', e.path], ['Точка входа', e.entry ? 'да' : 'нет']);
        rows.push(['Файл', e.path + ':1', { file: e.path, line: 1 }]);
    } else if (e && e.type === 'resource') {
        rows.push(['Ресурс', e.path], ['Файл', e.missing ? 'не найден' : 'есть'], ['Используют', String((g.usedBy.get(key) || []).length)]);
    } else if (a) {
        rows.push(['Область', a.label || a.key], ['Тип', a.type]);
        if (a.type === 'world') rows.push(['Корень', a.runtime_root || '$.world'], ['Объектов', String(objectsIn(g, key).length)]);
    }
    return rows;
}

export const STATUS_LABEL = { current: 'актуален', partial: 'частично', stale: 'устарел' };
