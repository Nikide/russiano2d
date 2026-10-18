// ===========================================================================
// roadgraph.js — лёгкий декларативный граф дорог/тротуаров для городской сцены.
//
// Это ДАННЫЕ + чистая геометрия, а не новая навигационная подсистема движка:
//   * дороги — узлы и направленные сегменты с полосами (lanes), oneWay,
//     speedLimit, intersection, parking/spawn points;
//   * пешеходный граф — отдельный лёгкий граф или семплированные
//     sidewalk-зоны (`walk.zones`);
//   * поиск пути по графу — детерминированный Dijkstra (не NavMesh);
//     для перемещения тел в обход геометрии по-прежнему используется
//     существующий `$.nav` (см. lib/ai.js).
//
// Использование в сцене:
//
//   import { createRoadGraph } from './lib/roadgraph.js';
//   const graph = createRoadGraph({
//       nodes: [{ id: 'a', x: 0, y: 0, intersection: true }],
//       roads: [
//           { id: 'main', from: 'a', to: 'b', lanes: 2, oneWay: false,
//             speedLimit: 140, parking: true, spawns: true },
//       ],
//       walk: { zones: [{ x: 0, y: 120, w: 900, h: 64, spacing: 48 }] },
//   });
//   const route = graph.route({ x: 10, y: 0 }, { x: 880, y: 200 });
//   graph.spawnPoints({ kind: 'car', tags: ['road'], near: { x: 400, y: 0 } });
//
// Re2D surface tags (опционально, без жёсткой зависимости):
//   graph.setWorld(world, { h: 0 });            // world.groundAt(x,y,{h})
//   graph.tagsAt(x, y) -> { tags:[...], declared:[...], live:[...], ambiguous }
//   spawnPoints({ kind:'ped', tags:['sidewalk'], excludeTags:['no_spawn'] })
//
// Теги читаются, если у мира есть `groundAt` (P0.1). Если его нет — работают
// только теги, объявленные в данных точек; фильтр по неизвестным тегам точку
// отбрасывает (никакого «наверное, подойдёт»).
//
// Публичного `engine.*` здесь нет, глобальных менеджеров/синглтонов нет:
// граф — обычный объект, его создаёт и тикает сцена.
// ===========================================================================

const DEFAULT_LANE_WIDTH = 32;
const DEFAULT_SPEED_LIMIT = 120;      // px/s — та же размерность, что скорость тел
const DEFAULT_WALK_SPEED = 64;        // px/s
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Мелкая геометрия (чистые функции, их же удобно проверять без движка)
// ---------------------------------------------------------------------------

/** Точка из [x, y] или { x, y }; иначе — понятная ошибка. */
export function asPoint(value, where = 'point') {
    if (Array.isArray(value) && value.length >= 2) {
        const x = Number(value[0]), y = Number(value[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } else if (value && typeof value === 'object') {
        const x = Number(value.x), y = Number(value.y);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    throw new TypeError(`roadgraph: ${where} должен быть точкой {x,y} или [x,y]`);
}

export function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Ближайшая точка на отрезке: { t, x, y, distance }. */
export function pointSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 <= EPS ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = ax + dx * t, y = ay + dy * t;
    return { t, x, y, distance: Math.hypot(px - x, py - y) };
}

/** Пересечение двух отрезков: { x, y, t, u } (t/u — доли) или null. */
export function segmentCross(a0, a1, b0, b1) {
    const rx = a1.x - a0.x, ry = a1.y - a0.y;
    const sx = b1.x - b0.x, sy = b1.y - b0.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const qx = b0.x - a0.x, qy = b0.y - a0.y;
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * ry - qy * rx) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { x: a0.x + rx * t, y: a0.y + ry * t, t, u };
}

/** Правая нормаль направления (для полос/парковки). */
function rightNormal(dx, dy, len) {
    const n = len || Math.hypot(dx, dy) || 1;
    return { x: -dy / n, y: dx / n };
}

// ---------------------------------------------------------------------------
// Lane geometry
// ---------------------------------------------------------------------------

/**
 * Центр полосы сегмента: { offset, dir, lane }.
 *
 * oneWay — полосы раскладываются симметрично по ширине, все едут вперёд.
 * Двусторонняя — первая половина полос вперёд (справа от оси), вторая назад
 * (слева; направление движения противоположное). Узкая двусторонняя дорога
 * с одной полосой делит осевую: смещение 0, направление вперёд.
 */
export function laneCenter(segment, lane) {
    const lanes = Math.max(1, Math.trunc(Number(segment.lanes) || 1));
    const lw = Number(segment.laneWidth) || DEFAULT_LANE_WIDTH;
    const i = Math.max(0, Math.min(lanes - 1, Math.trunc(Number(lane) || 0)));
    const forward = { x: segment.dx, y: segment.dy };
    if (segment.oneWay) {
        return { offset: ((i + 0.5) - lanes / 2) * lw, dir: forward, lane: i };
    }
    const half = Math.floor(lanes / 2);
    if (half === 0) return { offset: 0, dir: forward, lane: i };
    if (i < half) return { offset: (i + 0.5) * lw, dir: forward, lane: i };
    return { offset: -((i - half) + 0.5) * lw, dir: { x: -forward.x, y: -forward.y }, lane: i };
}

/** Точка на сегменте по доле t (0..1) со смещением offset (вправо от оси). */
export function pointOnSegment(segment, t, offset = 0) {
    const k = Math.max(0, Math.min(1, Number(t) || 0));
    return {
        x: segment.ax + (segment.bx - segment.ax) * k + segment.nx * offset,
        y: segment.ay + (segment.by - segment.ay) * k + segment.ny * offset,
    };
}

// ---------------------------------------------------------------------------
// Построение графа
// ---------------------------------------------------------------------------

class Graph {
    constructor(options = {}) {
        this.opts = options;
        this.nodes = new Map();       // id -> node
        this.roads = new Map();       // id -> road
        this.segments = [];           // плоский список сегментов
        this.edgeSeq = 0;
        this.walk = {
            nodes: new Map(),         // id -> { id, x, y, kind:'walk', tags, edges }
            edges: [],                // { a, b, length }
            zones: [],                // исходные зоны (справочно)
        };
        this.world = options.world || null;
        this.surfaceHeight = options.h === undefined ? undefined : Number(options.h);
        this._seq = 0;
    }

    // --- узлы ---------------------------------------------------------

    addNode(spec) {
        if (!spec || typeof spec !== 'object') throw new TypeError('roadgraph.addNode: нужен объект узла');
        const id = spec.id === undefined ? `node:${this._seq++}` : String(spec.id);
        if (!id) throw new TypeError('roadgraph.addNode: пустой id');
        if (this.nodes.has(id)) throw new Error(`roadgraph.addNode: узел "${id}" уже есть`);
        const p = asPoint(spec, `узел "${id}"`);
        const node = {
            id, x: p.x, y: p.y,
            intersection: !!spec.intersection,
            tags: Array.isArray(spec.tags) ? spec.tags.map(String) : [],
            edges: [],
            seq: this._seq++,
        };
        this.nodes.set(id, node);
        return node;
    }

    // --- дороги -------------------------------------------------------

    /**
     * Дорога: `{ id, points|from/to, lanes, laneWidth, oneWay, speedLimit,
     *            width, parking, spawns, tags }`.
     * `points` — массив [x,y]/{x,y}/{x,y,node}; промежуточным точкам
     * создаются узлы `<roadId>#<i>`, если `node` не задан.
     */
    addRoad(spec) {
        if (!spec || typeof spec !== 'object') throw new TypeError('roadgraph.addRoad: нужна конфигурация дороги');
        const id = spec.id === undefined ? `road:${this._seq++}` : String(spec.id);
        if (!id) throw new TypeError('roadgraph.addRoad: пустой id');
        if (this.roads.has(id)) throw new Error(`roadgraph.addRoad: дорога "${id}" уже есть`);

        const laneWidth = Number(spec.laneWidth ?? spec.laneOffset) > 0
            ? Number(spec.laneWidth ?? spec.laneOffset) : DEFAULT_LANE_WIDTH;
        const oneWay = spec.oneWay === true;
        // lanes не обязательны: карта может задать только laneOffset/width.
        // Число полос по умолчанию — 2 (по одной в каждую сторону); ширина
        // известна — выводим из неё.
        const explicitLanes = Math.trunc(Number(spec.lanes) || 0);
        const lanes = explicitLanes > 0 ? explicitLanes
            : (Number(spec.width) > 0 ? Math.max(1, Math.round(Number(spec.width) / laneWidth)) : 2);
        const speedLimit = Number(spec.speedLimit) > 0 ? Number(spec.speedLimit) : DEFAULT_SPEED_LIMIT;
        const width = Number(spec.width) > 0 ? Number(spec.width) : lanes * laneWidth;

        const nodeIds = [];
        let points = null;
        if (Array.isArray(spec.points) && spec.points.length >= 2) {
            points = spec.points.map((p, i) => asPoint(p, `дорога "${id}", точка ${i}`));
            for (let i = 0; i < points.length; i++) {
                const p = spec.points[i];
                let nodeId = p && typeof p === 'object' && !Array.isArray(p) && p.node !== undefined
                    ? String(p.node) : null;
                if (nodeId === null) {
                    nodeId = `${id}#${i}`;
                    this.addNode({ id: nodeId, x: points[i].x, y: points[i].y });
                } else if (!this.nodes.has(nodeId)) {
                    this.addNode({ id: nodeId, x: points[i].x, y: points[i].y });
                }
                nodeIds.push(nodeId);
            }
        } else if (spec.from !== undefined && spec.to !== undefined) {
            const endpoint = (value, which) => {
                if (typeof value === 'string') {
                    const node = this.nodes.get(value);
                    if (!node) throw new Error(`roadgraph.addRoad: "${id}" ссылается на несуществующий узел "${value}" (${which})`);
                    return value;
                }
                const p = asPoint(value, `дорога "${id}", ${which}`);
                const nodeId = `${id}#${which}`;
                if (!this.nodes.has(nodeId)) this.addNode({ id: nodeId, x: p.x, y: p.y });
                return nodeId;
            };
            nodeIds.push(endpoint(spec.from, 'from'));
            if (Array.isArray(spec.via)) {
                for (let i = 0; i < spec.via.length; i++) {
                    const p = asPoint(spec.via[i], `дорога "${id}", via ${i}`);
                    let nodeId = null;
                    const raw = spec.via[i];
                    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.node !== undefined) {
                        nodeId = String(raw.node);
                        if (!this.nodes.has(nodeId)) this.addNode({ id: nodeId, x: p.x, y: p.y });
                    } else {
                        nodeId = `${id}#via${i}`;
                        this.addNode({ id: nodeId, x: p.x, y: p.y });
                    }
                    nodeIds.push(nodeId);
                }
            }
            nodeIds.push(endpoint(spec.to, 'to'));
        } else {
            throw new TypeError(`roadgraph.addRoad: "${id}" нужны points или from/to`);
        }

        const road = {
            id, nodeIds,
            points: nodeIds.map((nodeId) => {
                const n = this.nodes.get(nodeId);
                return { x: n.x, y: n.y, node: nodeId };
            }),
            lanes, laneWidth, width, oneWay, speedLimit,
            tags: Array.isArray(spec.tags) ? spec.tags.map(String) : [],
            parking: [],
            spawns: [],
            seq: this._seq++,
        };

        // Сегменты и направленные рёбра.
        for (let i = 0; i + 1 < nodeIds.length; i++) {
            const a = this.nodes.get(nodeIds[i]);
            const b = this.nodes.get(nodeIds[i + 1]);
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy);
            if (len <= EPS) throw new RangeError(`roadgraph.addRoad: "${id}" — нулевой сегмент ${i}`);
            const n = rightNormal(dx, dy, len);
            const segment = {
                roadId: id, index: i,
                a: a.id, b: b.id,
                ax: a.x, ay: a.y, bx: b.x, by: b.y,
                dx: dx / len, dy: dy / len,
                nx: n.x, ny: n.y,
                length: len,
                lanes, laneWidth, oneWay, speedLimit,
                seq: this._seq++,
            };
            this.segments.push(segment);
            this._addEdge(a, b, segment, true);
            if (!oneWay) this._addEdge(b, a, segment, false);
        }
        this.roads.set(id, road);

        // Парковка/спавны: явные списки или автогенерация по сегментам.
        this._buildParking(road, spec);
        this._buildSpawns(road, spec);
        return road;
    }

    _addEdge(from, to, segment, forward) {
        from.edges.push({
            to: to.id,
            roadId: segment.roadId,
            segment,
            forward,
            length: segment.length,
            speedLimit: segment.speedLimit,
            seq: this.edgeSeq++,
        });
    }

    _buildParking(road, spec) {
        const out = [];
        const list = Array.isArray(spec.parking) ? spec.parking : null;
        if (list) {
            for (let i = 0; i < list.length; i++) {
                const raw = list[i] || {};
                const p = asPoint(raw, `дорога "${road.id}", parking ${i}`);
                out.push({ id: raw.id === undefined ? `${road.id}:park${i}` : String(raw.id),
                           x: p.x, y: p.y, angle: Number(raw.angle) || 0, kind: 'car', tags: ['parking'],
                           road: road.id, lane: Number(raw.lane) || 0 });
            }
        } else if (spec.parking === true) {
            const spacing = Number(spec.parkingSpacing) > 0 ? Number(spec.parkingSpacing) : 72;
            const offset = Number(spec.parkingOffset) > 0 ? Number(spec.parkingOffset) : road.width / 2 + 12;
            for (const segment of this.segments.filter((s) => s.roadId === road.id)) {
                const n = Math.max(1, Math.floor(segment.length / spacing));
                for (let k = 0; k < n; k++) {
                    const t = (k + 0.5) / n;
                    for (const side of [-1, 1]) {
                        const p = pointOnSegment(segment, t, offset * side);
                        out.push({ id: `${road.id}:park:${segment.index}:${k}:${side}`,
                                   x: p.x, y: p.y,
                                   angle: Math.atan2(segment.dy, segment.dx) + (side < 0 ? Math.PI : 0),
                                   kind: 'car', tags: ['parking'], road: road.id, lane: 0 });
                    }
                }
            }
        }
        road.parking = out;
    }

    _buildSpawns(road, spec) {
        const out = [];
        const list = Array.isArray(spec.spawns) ? spec.spawns : null;
        if (list) {
            for (let i = 0; i < list.length; i++) {
                const raw = list[i] || {};
                const p = asPoint(raw, `дорога "${road.id}", spawn ${i}`);
                out.push({ id: raw.id === undefined ? `${road.id}:spawn${i}` : String(raw.id),
                           x: p.x, y: p.y, angle: Number(raw.angle) || 0,
                           kind: raw.kind === 'ped' ? 'ped' : 'car',
                           lane: Number(raw.lane) || 0,
                           tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
                           road: road.id, source: 'road' });
            }
        } else if (spec.spawns === true || spec.autoSpawns === true) {
            for (const segment of this.segments.filter((s) => s.roadId === road.id)) {
                for (let lane = 0; lane < Math.max(1, road.lanes); lane++) {
                    const lc = laneCenter(segment, lane);
                    const p = pointOnSegment(segment, 0.5, lc.offset);
                    out.push({ id: `${road.id}:spawn:${segment.index}:${lane}`,
                               x: p.x, y: p.y,
                               angle: Math.atan2(lc.dir.y, lc.dir.x),
                               kind: 'car', lane,
                               tags: road.tags.slice(), road: road.id, source: 'road' });
                }
            }
        }
        road.spawns = out;
    }

    // --- пешеходная часть --------------------------------------------

    addWalkNode(spec) {
        const id = spec.id === undefined ? `walk:${this._seq++}` : String(spec.id);
        if (this.walk.nodes.has(id)) throw new Error(`roadgraph.addWalkNode: узел "${id}" уже есть`);
        const p = asPoint(spec, `пешеходный узел "${id}"`);
        const node = { id, x: p.x, y: p.y, kind: 'walk', edges: [],
                       tags: Array.isArray(spec.tags) ? spec.tags.map(String) : ['sidewalk'],
                       seq: this._seq++ };
        this.walk.nodes.set(id, node);
        return node;
    }

    addWalkEdge(aId, bId) {
        const a = this.walk.nodes.get(String(aId));
        const b = this.walk.nodes.get(String(bId));
        if (!a || !b) throw new Error(`roadgraph.addWalkEdge: нет узла "${!a ? aId : bId}"`);
        const length = distance(a, b);
        if (length <= EPS) return null;
        const edge = { a: a.id, b: b.id, length, seq: this._seq++ };
        this.walk.edges.push(edge);
        a.edges.push({ to: b.id, length, edge });
        b.edges.push({ to: a.id, length, edge });
        return edge;
    }

    /** Семплировать прямоугольную sidewalk-зону сеткой с 4-соседями. */
    addWalkZone(zone) {
        const spec = zone || {};
        const id = spec.id === undefined ? `walkzone:${this._seq++}` : String(spec.id);
        const x0 = Number(spec.x) || 0, y0 = Number(spec.y) || 0;
        const w = Number(spec.w) > 0 ? Number(spec.w) : 64;
        const h = Number(spec.h) > 0 ? Number(spec.h) : 64;
        const spacing = Number(spec.spacing) > 0 ? Number(spec.spacing) : 48;
        const tags = Array.isArray(spec.tags) ? spec.tags.map(String) : ['sidewalk'];
        const cols = Math.max(1, Math.ceil(w / spacing));
        const rows = Math.max(1, Math.ceil(h / spacing));
        const grid = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const nodeId = `${id}:${r}:${c}`;
                this.addWalkNode({ id: nodeId,
                                   x: x0 + (c + 0.5) * (w / cols),
                                   y: y0 + (r + 0.5) * (h / rows), tags });
                row.push(nodeId);
            }
            grid.push(row);
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (c + 1 < cols) this.addWalkEdge(grid[r][c], grid[r][c + 1]);
                if (r + 1 < rows) this.addWalkEdge(grid[r][c], grid[r + 1][c]);
            }
        }
        this.walk.zones.push({ id, x: x0, y: y0, w, h, spacing, tags, cols, rows });
        return this.walk.zones[this.walk.zones.length - 1];
    }

    // --- загрузка данных ---------------------------------------------

    load(data) {
        if (!data || typeof data !== 'object') throw new TypeError('roadgraph.load: нужен объект данных');
        for (const n of data.nodes || []) this.addNode(n);

        // Дороги копируются: autoIntersections вставляет общие узлы на
        // геометрических пересечениях, не меняя данные карты вызывающего.
        const roadsData = (data.roads || []).map((r) => ({ ...r, points: Array.isArray(r.points) ? r.points.slice() : r.points }));
        if (data.autoIntersections !== false) this._insertIntersections(roadsData);
        for (const r of roadsData) {
            if (r.kind !== undefined && r.kind !== 'road') continue;
            this.addRoad(r);
        }

        // Пешеходные маршруты: объект {nodes,edges,zones} или массив
        // полилиний вида [{ id, points:[[x,y],…] }] (citymap).
        const walkSources = [];
        if (data.walk && typeof data.walk === 'object' && !Array.isArray(data.walk)) walkSources.push(data.walk);
        if (Array.isArray(data.walk)) walkSources.push({ routes: data.walk });
        for (const walk of walkSources) {
            for (const n of walk.nodes || []) this.addWalkNode(n);
            for (const e of walk.edges || []) {
                if (Array.isArray(e)) this.addWalkEdge(e[0], e[1]);
                else this.addWalkEdge(e.a, e.b);
            }
            for (const z of walk.zones || walk.sidewalkZones || []) this.addWalkZone(z);
            for (const route of walk.routes || walk.paths || []) {
                const points = (route.points || []).map((p, i) => asPoint(p, `пешеходный маршрут ${route.id || '?'}, точка ${i}`));
                if (points.length < 2) continue;
                const ids = points.map((p, i) => {
                    const id = `${route.id || 'walk'}#${i}`;
                    this.addWalkNode({ id, x: p.x, y: p.y, tags: route.tags || ['sidewalk'] });
                    return id;
                });
                for (let i = 0; i + 1 < ids.length; i++) this.addWalkEdge(ids[i], ids[i + 1]);
            }
        }
        for (const n of data.walkNodes || []) this.addWalkNode(n);
        for (const e of data.walkEdges || []) {
            if (Array.isArray(e)) this.addWalkEdge(e[0], e[1]);
            else this.addWalkEdge(e.a, e.b);
        }
        for (const z of data.walkZones || []) this.addWalkZone(z);

        // Точки уровня карты (citymap: spawns/parking рядом с roads).
        this._globalSpawns = [];
        for (const raw of data.spawns || []) this._globalSpawns.push(this._normalizeSpawn(raw, 'map'));
        this._globalParking = [];
        for (const raw of data.parking || []) {
            const p = asPoint(raw, 'parking');
            this._globalParking.push({ id: raw.id === undefined ? `park${this._seq++}` : String(raw.id),
                x: p.x, y: p.y, angle: Number(raw.angle) || 0, kind: 'car', tags: ['parking'],
                road: raw.road || null, lane: Number(raw.lane) || 0, source: 'parking' });
        }

        markIntersections(this);
        return this;
    }

    _normalizeSpawn(raw, source) {
        const p = asPoint(raw, 'spawn');
        let kind = raw.kind;
        if (kind === 'pedestrian' || kind === 'ped') kind = 'ped';
        else if (kind === 'vehicle' || kind === 'car' || kind === undefined) {
            const tags = (raw.tags || []).map(String);
            kind = (!raw.kind && tags.indexOf('sidewalk') >= 0) ? 'ped' : 'car';
        }
        return {
            id: raw.id === undefined ? `${source}:spawn:${this._seq++}` : String(raw.id),
            x: p.x, y: p.y, angle: Number(raw.angle) || 0,
            kind, lane: Number(raw.lane) || 0,
            tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
            road: raw.road || null, source,
        };
    }

    /**
     * Вставить общие узлы на геометрических пересечениях дорог из `points`.
     * Это нужно картам-крестам, где дороги описаны двумя полилиниями и не
     * имеют общего author-узла: иначе route() не умеет поворачивать.
     * `from/to`-дороги уже делят узлы — их не трогаем.
     */
    _insertIntersections(roadsData) {
        const lineRoads = roadsData.filter((r) => Array.isArray(r.points) && r.points.length >= 2);
        if (lineRoads.length < 2) return;
        const splits = new Map();   // road -> [{ seg, t, x, y, key }]
        const pairKey = (a, b, x, y) => {
            const ids = [String(a.id), String(b.id)].sort();
            return `ix:${ids[0]}|${ids[1]}@${x.toFixed(3)},${y.toFixed(3)}`;
        };
        for (let i = 0; i < lineRoads.length; i++) {
            for (let j = i + 1; j < lineRoads.length; j++) {
                const A = lineRoads[i], B = lineRoads[j];
                const pa = A.points.map((p) => asPoint(p, `дорога "${A.id}"`));
                const pb = B.points.map((p) => asPoint(p, `дорога "${B.id}"`));
                for (let a = 0; a + 1 < pa.length; a++) {
                    for (let b = 0; b + 1 < pb.length; b++) {
                        const hit = segmentCross(pa[a], pa[a + 1], pb[b], pb[b + 1]);
                        if (!hit || hit.t <= 1e-6 || hit.t >= 1 - 1e-6 || hit.u <= 1e-6 || hit.u >= 1 - 1e-6) continue;
                        const key = pairKey(A, B, hit.x, hit.y);
                        if (!splits.has(A)) splits.set(A, []);
                        if (!splits.has(B)) splits.set(B, []);
                        splits.get(A).push({ road: A, seg: a, t: hit.t, x: hit.x, y: hit.y, key });
                        splits.get(B).push({ road: B, seg: b, t: hit.u, x: hit.x, y: hit.y, key });
                    }
                }
            }
        }
        for (const [road, list] of splits) {
            if (!list.length) continue;
            const pts = road.points.map((p, i) => {
                const q = asPoint(p, `дорога "${road.id}"`);
                return { x: q.x, y: q.y, node: p && p.node };
            });
            list.sort((a, b) => (a.seg - b.seg) || (a.t - b.t));
            const out = [];
            let insertIndex = 0;
            for (let i = 0; i < pts.length; i++) {
                out.push(pts[i]);
                while (insertIndex < list.length && list[insertIndex].seg === i) {
                    const sp = list[insertIndex++];
                    const prev = out[out.length - 1];
                    if (Math.hypot(sp.x - prev.x, sp.y - prev.y) > 1e-6) {
                        out.push({ x: sp.x, y: sp.y, node: sp.key });
                    } else {
                        prev.node = sp.key;   // пересечение ровно в вершине
                    }
                }
            }
            road.points = out;
        }
    }

    // --- поверхностные теги ------------------------------------------

    /** Подключить Re2D-мир: теги берутся из world.groundAt(x,y,{h}). */
    setWorld(world, opts = {}) {
        this.world = world || null;
        if (opts && opts.h !== undefined) this.surfaceHeight = Number(opts.h);
        return this;
    }

    /**
     * Теги под точкой: объявленные в данных + «живые» из surface tags.
     * groundAt без h на многоэтажной XY бросает RangeError — это не повод
     * падать: теги считаются неизвестными, `ambiguous: true`.
     */
    tagsAt(x, y, opts = {}) {
        const point = typeof x === 'object' ? asPoint(x, 'tagsAt') : asPoint({ x, y }, 'tagsAt');
        const h = opts.h !== undefined ? Number(opts.h) : this.surfaceHeight;
        const live = [];
        let ambiguous = false, error = null, surface = null;
        const world = opts.world || this.world;
        if (world && typeof world.groundAt === 'function') {
            try {
                const args = h === undefined ? { } : { h };
                const ground = world.groundAt(point.x, point.y, args);
                if (ground) {
                    surface = ground;
                    for (const tag of ground.tags || []) live.push(String(tag));
                }
            } catch (e) {
                ambiguous = true;
                error = e && e.message ? e.message : String(e);
            }
        }
        const declared = [];
        const extra = opts.tags || null;   // теги, объявленные точкой спавна
        if (Array.isArray(extra)) for (const tag of extra) declared.push(String(tag));
        const seen = new Set();
        const tags = [];
        for (const tag of declared.concat(live)) {
            if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
        }
        return { x: point.x, y: point.y, tags, declared, live, ambiguous, error, surface };
    }

    /** Есть ли все `required`; нет ли ни одного из `excluded`. */
    static tagsMatch(tags, required, excluded) {
        const have = new Set((tags || []).map(String));
        for (const tag of required || []) if (!have.has(String(tag))) return false;
        for (const tag of excluded || []) if (have.has(String(tag))) return false;
        return true;
    }

    // --- запросы ------------------------------------------------------

    node(id) { return this.nodes.get(String(id)) || null; }
    road(id) { return this.roads.get(String(id)) || null; }
    nodesList() { return Array.from(this.nodes.values()); }
    roadsList() { return Array.from(this.roads.values()); }
    walkNodesList() { return Array.from(this.walk.nodes.values()); }

    /** Ближайшая дорога/сегмент к точке. */
    nearestRoad(x, y, opts = {}) {
        const p = typeof x === 'object' ? asPoint(x, 'nearestRoad') : asPoint({ x, y }, 'nearestRoad');
        const maxDistance = opts.maxDistance === undefined ? Infinity : Number(opts.maxDistance);
        let best = null;
        for (const segment of this.segments) {
            const q = pointSegment(p.x, p.y, segment.ax, segment.ay, segment.bx, segment.by);
            if (q.distance > maxDistance) continue;
            const candidate = {
                road: this.roads.get(segment.roadId),
                roadId: segment.roadId,
                segment,
                x: q.x, y: q.y, t: q.t, distance: q.distance,
                angle: Math.atan2(segment.dy, segment.dx),
                speedLimit: segment.speedLimit,
                oneWay: segment.oneWay,
                lanes: segment.lanes,
                seq: segment.seq,
            };
            if (!best || candidate.distance < best.distance - EPS ||
                (Math.abs(candidate.distance - best.distance) <= EPS && candidate.seq < best.seq)) {
                best = candidate;
            }
        }
        if (best) {
            const lc = laneCenter(best.segment, opts.lane || 0);
            best.lane = lc.lane;
            best.laneOffset = lc.offset;
            best.lanePoint = pointOnSegment(best.segment, best.t, lc.offset);
            best.direction = lc.dir;
        }
        return best;
    }

    /** Ближайший узел дорожного графа. */
    nearestNode(x, y, opts = {}) {
        const p = typeof x === 'object' ? asPoint(x, 'nearestNode') : asPoint({ x, y }, 'nearestNode');
        let best = null;
        for (const node of this.nodes.values()) {
            const d = distance(p, node);
            if (opts.maxDistance !== undefined && d > Number(opts.maxDistance)) continue;
            if (!best || d < best.distance - EPS ||
                (Math.abs(d - best.distance) <= EPS && node.seq < best.node.seq)) {
                best = { node, distance: d };
            }
        }
        return best;
    }

    /** Ближайший узел пешеходного графа. */
    nearestWalkNode(x, y, opts = {}) {
        const p = typeof x === 'object' ? asPoint(x, 'nearestWalkNode') : asPoint({ x, y }, 'nearestWalkNode');
        let best = null;
        for (const node of this.walk.nodes.values()) {
            const d = distance(p, node);
            if (opts.maxDistance !== undefined && d > Number(opts.maxDistance)) continue;
            if (!best || d < best.distance - EPS ||
                (Math.abs(d - best.distance) <= EPS && node.seq < best.node.seq)) {
                best = { node, distance: d };
            }
        }
        return best;
    }

    // --- маршрут ------------------------------------------------------

    /**
     * Маршрут по дорожному (kind:'road') или пешеходному (kind:'walk') графу.
     * `from`/`to` — id узла или точка (точка притягивается к ближайшему узлу;
     * при `exact: true` — по умолчанию — сама точка остаётся концом маршрута).
     *
     * → { kind, nodes:[id], points:[{x,y}], legs:[{roadId,speedLimit,length,
     *      oneWay}], length, duration, from, to } или null.
     */
    route(from, to, opts = {}) {
        const kind = opts.kind === 'walk' ? 'walk' : 'road';
        const exact = opts.exact !== false;
        const walkSpeed = Number(opts.walkSpeed) > 0 ? Number(opts.walkSpeed) : DEFAULT_WALK_SPEED;

        const resolve = (value, which) => {
            if (typeof value === 'string') {
                const map = kind === 'walk' ? this.walk.nodes : this.nodes;
                const node = map.get(value);
                if (!node) throw new Error(`roadgraph.route: ${which} "${value}" не найден в ${kind}-графе`);
                return { node, point: { x: node.x, y: node.y }, exact: false };
            }
            const p = asPoint(value, `roadgraph.route ${which}`);
            if (kind === 'walk') {
                const near = this.nearestWalkNode(p);
                if (!near) throw new Error('roadgraph.route: пешеходный граф пуст');
                return { node: near.node, point: p, exact };
            }
            const near = this.nearestNode(p, { maxDistance: opts.maxDistance });
            if (!near) throw new Error('roadgraph.route: дорожный граф пуст');
            return { node: near.node, point: p, exact, snap: near };
        };

        const start = resolve(from, 'from');
        const goal = resolve(to, 'to');

        // Dijkstra по направленным рёбрам (road) или неориентированным (walk).
        const dist = new Map(), prev = new Map(), done = new Set();
        dist.set(start.node.id, 0);
        const queue = [{ id: start.node.id, dist: 0, seq: start.node.seq }];
        while (queue.length) {
            let ai = 0;
            for (let i = 1; i < queue.length; i++) {
                const a = queue[i], b = queue[ai];
                if (a.dist < b.dist - EPS || (Math.abs(a.dist - b.dist) <= EPS && a.seq < b.seq)) ai = i;
            }
            const cur = queue.splice(ai, 1)[0];
            if (done.has(cur.id)) continue;
            done.add(cur.id);
            if (cur.id === goal.node.id) break;
            const node = kind === 'walk' ? this.walk.nodes.get(cur.id) : this.nodes.get(cur.id);
            for (const edge of node.edges) {
                const nd = cur.dist + edge.length;
                const old = dist.get(edge.to);
                if (old === undefined || nd < old - EPS) {
                    dist.set(edge.to, nd);
                    prev.set(edge.to, { from: cur.id, edge });
                    const next = kind === 'walk' ? this.walk.nodes.get(edge.to) : this.nodes.get(edge.to);
                    queue.push({ id: edge.to, dist: nd, seq: next ? next.seq : 0 });
                }
            }
        }
        if (!dist.has(goal.node.id)) return null;

        // Восстанавливаем цепочку узлов от цели к старту.
        const chain = [];
        let at = goal.node.id;
        let guard = 0;
        while (at !== start.node.id) {
            chain.push(at);
            const step = prev.get(at);
            if (!step) return null;
            at = step.from;
            if (++guard > this.nodes.size + this.walk.nodes.size + 4) return null;
        }
        chain.push(start.node.id);
        chain.reverse();

        const legs = [];
        for (let i = 1; i < chain.length; i++) {
            const step = prev.get(chain[i]);
            const edge = step && step.edge;
            if (!edge) continue;
            const segment = edge.segment || null;
            legs.push({ roadId: kind === 'walk' ? null : (segment ? segment.roadId : edge.roadId),
                        speedLimit: kind === 'walk' ? walkSpeed : (edge.speedLimit || DEFAULT_SPEED_LIMIT),
                        length: edge.length,
                        oneWay: segment ? !!segment.oneWay : false });
        }

        const points = [];
        const pushPoint = (p) => {
            const last = points[points.length - 1];
            if (!last || distance(last, p) > 1e-6) points.push({ x: p.x, y: p.y });
        };
        if (exact) pushPoint(start.point);
        for (const id of chain) {
            const node = kind === 'walk' ? this.walk.nodes.get(id) : this.nodes.get(id);
            pushPoint(node);
        }
        if (exact) pushPoint(goal.point);
        if (points.length === 1) pushPoint({ x: goal.point.x, y: goal.point.y });

        let length = 0, duration = 0;
        for (const leg of legs) {
            length += leg.length;
            duration += leg.length / leg.speedLimit;
        }
        const headSpeed = kind === 'walk' ? walkSpeed
            : (start.node.edges[0]?.speedLimit || DEFAULT_SPEED_LIMIT);
        const tailSpeed = kind === 'walk' ? walkSpeed
            : (goal.node.edges[0]?.speedLimit || DEFAULT_SPEED_LIMIT);
        const startNode = kind === 'walk' ? this.walk.nodes.get(start.node.id) : this.nodes.get(start.node.id);
        const goalNode = kind === 'walk' ? this.walk.nodes.get(goal.node.id) : this.nodes.get(goal.node.id);
        const head = distance(points[0], startNode);
        const tail = distance(goalNode, points[points.length - 1]);
        // Точные «хвосты» до/от точки не входят в legs — добавим их в длину
        // и время (скорость ограничения ближайшего ребра).
        if (head > 1e-6) { length += head; duration += head / headSpeed; }
        if (tail > 1e-6) { length += tail; duration += tail / tailSpeed; }
        return { kind, nodes: chain, points, legs, length, duration, from: points[0], to: points[points.length - 1] };
    }

    /**
     * Путь вдоль одной дороги: `{ road, start=0, end=1, lane=0,
     * direction=1, step=32 }` → точки с шагом не больше step.
     * `direction:-1` — против направления дороги (для oneWay это осознанный
     * обход правила; проверка oneWay остаётся на вызывающем).
     */
    pathAlong(roadId, opts = {}) {
        const road = this.road(roadId);
        if (!road) throw new Error(`roadgraph.pathAlong: нет дороги "${roadId}"`);
        const start = Math.max(0, Math.min(1, opts.start === undefined ? 0 : Number(opts.start)));
        const end = Math.max(0, Math.min(1, opts.end === undefined ? 1 : Number(opts.end)));
        const lane = Math.max(0, Math.trunc(Number(opts.lane) || 0));
        const step = Number(opts.step) > 0 ? Number(opts.step) : 32;
        const direction = opts.direction === -1 ? -1 : 1;
        const segs = this.segments.filter((s) => s.roadId === road.id);
        const total = segs.reduce((sum, s) => sum + s.length, 0);
        if (total <= EPS) return [];
        const out = [];
        const walk = (t) => {
            let dist = t * total;
            for (const segment of segs) {
                if (dist <= segment.length + EPS || segment === segs[segs.length - 1]) {
                    const k = segment.length <= EPS ? 0 : Math.min(1, dist / segment.length);
                    const lc = laneCenter(segment, lane);
                    const p = pointOnSegment(segment, k, lc.offset);
                    out.push({ x: p.x, y: p.y, roadId: road.id, t, segment: segment.index });
                    return;
                }
                dist -= segment.length;
            }
        };
        const samples = Math.max(1, Math.ceil(Math.abs(end - start) * total / step));
        for (let i = 0; i <= samples; i++) walk(start + (end - start) * (i / samples));
        if (direction === -1) out.reverse();
        return out;
    }

    // --- точки спавна -------------------------------------------------

    /**
     * Точки спавна с фильтрацией:
     * `{ kind:'car'|'ped'|'any', tags, excludeTags, near, maxDistance,
     *    minDistance, limit, world, h }`.
     *
     * Источники: явные spawns дорог (kind car/ped), автопарковка (car),
     * пешеходные узлы (ped). Теги: объявленные + поверхностные (если есть
     * `world.groundAt`); `no_spawn` исключается по умолчанию.
     */
    spawnPoints(opts = {}) {
        const kind = opts.kind === 'ped' ? 'ped' : (opts.kind === 'car' ? 'car' : 'any');
        const near = opts.near === undefined ? null : asPoint(opts.near, 'spawnPoints.near');
        const maxDistance = opts.maxDistance === undefined ? Infinity : Number(opts.maxDistance);
        const minDistance = opts.minDistance === undefined ? 0 : Number(opts.minDistance);
        const required = (opts.tags || []).map(String);
        const excluded = (opts.excludeTags || ['no_spawn']).map(String);
        const limit = opts.limit === undefined ? Infinity : Math.max(0, Math.trunc(Number(opts.limit)));
        const world = opts.world || this.world;
        const h = opts.h !== undefined ? opts.h : this.surfaceHeight;

        const pool = [];
        const push = (p) => {
            if (!p) return;
            if (kind !== 'any' && p.kind !== kind) return;
            if (near) {
                const d = distance(near, p);
                if (d > maxDistance || d < minDistance) return;
            }
            const tagInfo = this.tagsAt(p.x, p.y, { tags: p.tags, world, h });
            if (!Graph.tagsMatch(tagInfo.tags, required, excluded)) return;
            pool.push({ ...p, tags: tagInfo.tags, declaredTags: tagInfo.declared,
                        liveTags: tagInfo.live, ambiguous: tagInfo.ambiguous });
        };
        for (const road of this.roads.values()) {
            for (const p of road.spawns) push({ ...p, road: road.id });
        }
        for (const road of this.roads.values()) {
            for (const p of road.parking) push({ ...p, road: road.id, source: 'parking' });
        }
        for (const p of this._globalSpawns || []) push({ ...p });
        for (const p of this._globalParking || []) push({ ...p });
        for (const node of this.walk.nodes.values()) {
            push({ id: node.id, x: node.x, y: node.y, angle: 0, kind: 'ped', lane: 0,
                   tags: node.tags.slice(), road: null, source: 'walk' });
        }
        pool.sort((a, b) => (a.road === b.road ? 0 : String(a.road).localeCompare(String(b.road))) ||
                            String(a.id).localeCompare(String(b.id)));
        return limit === Infinity ? pool : pool.slice(0, limit);
    }

    /** Точки пешеходного графа (для population и debug-оверлея). */
    walkPoints() {
        return this.walkNodesList().map((n) => ({ id: n.id, x: n.x, y: n.y, kind: 'ped',
                                                  tags: n.tags.slice() }));
    }

    // --- отладка ------------------------------------------------------

    /** Линии полос/дорог для debug-оверлея (мировые координаты). */
    debugLines() {
        const lines = [];
        for (const segment of this.segments) {
            for (let lane = 0; lane < segment.lanes; lane++) {
                const lc = laneCenter(segment, lane);
                const a = pointOnSegment(segment, 0, lc.offset);
                const b = pointOnSegment(segment, 1, lc.offset);
                lines.push({ kind: 'lane', roadId: segment.roadId, lane,
                             oneWay: segment.oneWay, dir: lc.dir,
                             x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                             speedLimit: segment.speedLimit });
            }
        }
        return lines;
    }

    info() {
        return {
            nodes: this.nodes.size,
            roads: this.roads.size,
            segments: this.segments.length,
            walkNodes: this.walk.nodes.size,
            walkEdges: this.walk.edges.length,
            walkZones: this.walk.zones.length,
            parking: Array.from(this.roads.values()).reduce((n, r) => n + r.parking.length, 0),
            spawns: Array.from(this.roads.values()).reduce((n, r) => n + r.spawns.length, 0),
            intersections: Array.from(this.nodes.values()).filter((n) => n.intersection).length,
            mapSpawns: (this._globalSpawns || []).length,
            mapParking: (this._globalParking || []).length,
            surfaceWorld: !!this.world,
            surfaceHeight: this.surfaceHeight === undefined ? null : this.surfaceHeight,
        };
    }
}

/** Создать граф и загрузить данные. */
export function createRoadGraph(data, opts = {}) {
    const graph = new Graph(opts || {});
    if (data) graph.load(data);
    return graph;
}

/** Загрузить данные из объекта или JSON-строки. */
export function loadRoadGraph(source, opts = {}) {
    if (typeof source === 'string') {
        let data;
        try { data = JSON.parse(source); }
        catch (e) { throw new SyntaxError('roadgraph.loadRoadGraph: битый JSON — ' + e.message); }
        return createRoadGraph(data, opts);
    }
    return createRoadGraph(source, opts);
}

/** Отметить пересечения по степеням узлов (после загрузки всех дорог). */
export function markIntersections(graph) {
    let n = 0;
    for (const node of graph.nodes.values()) {
        if (node.intersection) continue;
        if (node.edges.length > 2) { node.intersection = true; n++; }
    }
    return n;
}
