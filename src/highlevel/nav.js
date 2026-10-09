// ===========================================================================
// Навигация и поиск пути: $.nav — A* по сетке, навмеш, сглаживание, агент.
//
// Модуль закрывает пару Godot 4 (AStarGrid2D + NavigationRegion2D/Navigation
// Agent2D). Два источника пути:
//   * клеточная сетка — $.nav.grid(), препятствия задаются вручную
//     (setBlocked/blockAt) либо автоматически по узлам мира (buildFromWalls);
//   * навмеш — $.nav.mesh(), прямоугольная декомпозиция свободного
//     пространства (НЕ триангуляция), путь по графу прямоугольников через
//     порталы и сглаживание воронкой.
//
// Ключевое разделение (см. docs/highlevel/_CONTRACT.md §4):
//   * astar / smoothPath / lineOfSight / decomposeRects / buildPortalGraph /
//     funnel — чистая математика над массивами, её гоняет qjs-харнесс без
//     движка;
//   * сетка, навмеш, $.nav.path/.meshPath и агент — обвязка над ctx/engine,
//     вся работа с движком спрятана внутрь функций.
//
// Стиль и набор методов — как в world.js: объект-пространство имён,
// цепочные методы узла через def()/defGet().
// ===========================================================================

import { engine } from './native.js';
import { ctx, def, defGet, query, nodeBounds, wrapOne } from './core.js';

// ---------------------------------------------------------------------------
// Состояние подсистемы
// ---------------------------------------------------------------------------

const state = {
    grids: [],          // все сетки, созданные $.nav.grid(), в порядке создания
    default_grid: null, // сетка по умолчанию для $.nav.path без opts.grid
    meshes: [],         // все навмеши, созданные $.nav.mesh(), в порядке создания
    default_mesh: null, // навмеш для агента/$.nav.meshPath, если не задан opts.mesh
};

// Активные агенты. Массив нужен для обхода в tickNav, Map — для мгновенного
// поиска состояния узла в методах .navPath()/.isNavigating(). Один узел —
// не более одного агента.
const agents = [];
const agent_index = new Map();

const HEURISTICS = { manhattan: true, euclidean: true, octile: true };

// ---------------------------------------------------------------------------
// Чистая математика: эвристика, куча, A*
// ---------------------------------------------------------------------------

/**
 * Эвристика в клетках. manhattan допустима только без диагоналей, иначе она
 * завышает оценку и A* теряет оптимальность; вызывающий сам выбирает имя.
 */
export function heuristicValue(name, dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    switch (name) {
    case 'euclidean':
        return Math.sqrt(ax * ax + ay * ay);
    case 'octile':
        // Точная оценка для 8 направлений: прямые + диагонали.
        return (ax + ay) + (Math.SQRT2 - 2) * Math.min(ax, ay);
    case 'manhattan':
    default:
        return ax + ay;
    }
}

/** Двоичная куча минимума (lazy delete: дубликаты отсекает closed-набор). */
class MinHeap {
    constructor() {
        this.keys = [];
        this.vals = [];
    }

    get size() { return this.keys.length; }

    push(key, val) {
        const k = this.keys;
        const v = this.vals;
        k.push(key);
        v.push(val);
        let i = k.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (k[p] <= k[i]) break;
            this.swap(i, p);
            i = p;
        }
    }

    pop() {
        const k = this.keys;
        const v = this.vals;
        if (k.length === 0) return undefined;
        const top = v[0];
        const lastK = k.pop();
        const lastV = v.pop();
        if (k.length > 0) {
            k[0] = lastK;
            v[0] = lastV;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;
                if (l < k.length && k[l] < k[m]) m = l;
                if (r < k.length && k[r] < k[m]) m = r;
                if (m === i) break;
                this.swap(i, m);
                i = m;
            }
        }
        return top;
    }

    swap(a, b) {
        const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
        const v = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = v;
    }
}

function readCell(c) {
    if (!c) return null;
    if (Array.isArray(c)) return { cx: Number(c[0]) | 0, cy: Number(c[1]) | 0 };
    if (typeof c === 'object') {
        const cx = c.cx !== undefined ? c.cx : c.x;
        const cy = c.cy !== undefined ? c.cy : c.y;
        if (cx === undefined || cy === undefined) return null;
        return { cx: Number(cx) | 0, cy: Number(cy) | 0 };
    }
    return null;
}

function specBlocked(spec, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= spec.cols || cy >= spec.rows) return true;
    const b = spec.blocked;
    if (!b) return false;
    if (typeof b === 'function') return !!b(cx, cy);
    return !!b[cy * spec.cols + cx];
}

function specWeight(spec, cx, cy) {
    const w = spec.weights;
    if (w === undefined || w === null) return 1;
    let v;
    if (typeof w === 'function') v = w(cx, cy);
    else if (typeof w === 'number') v = w;
    else v = w[cy * spec.cols + cx];
    v = Number(v);
    // 0, NaN и отрицательный вес означают «клетка непроходима»: так игра может
    // рисовать зоны стоимости, не трогая массив blocked.
    return v > 0 ? v : 0;
}

function reconstructPath(cameFrom, cols, idx) {
    const cells = [];
    let guard = 0;
    while (idx !== -1 && guard++ <= cameFrom.length) {
        const cx = idx % cols;
        cells.push({ cx, cy: (idx - cx) / cols });
        idx = cameFrom[idx];
    }
    cells.reverse();
    return cells;
}

/**
 * A* по сетке. Чистая функция: `blocked` — массив/Uint8Array длины
 * cols*rows (истина = стена) или функция (cx, cy) ⇒ bool; `weights` —
 * массив/число/функция добавочной стоимости (0 — непроходимо).
 *
 * `start`/`goal` — клетки: { cx, cy }, { x, y } или [cx, cy]. Возвращает
 * массив клеток от старта до цели включительно либо null.
 *
 * Дополнительные поля spec:
 *   * `partial`/`allowPartial` — если цель недостижима или превышен
 *     `maxIterations`, вернуть путь до ближайшей по эвристике клетки;
 *   * `maxIterations` — предохранитель от долгого поиска.
 *
 * Диагонали не срезают углы: шаг по диагонали разрешён, только если обе
 * смежные ортогональные клетки свободны (иначе агент «протискивался» бы
 * между двумя стенами).
 */
export function astar(spec, start, goal) {
    if (!spec) return null;
    const cols = Number(spec.cols) | 0;
    const rows = Number(spec.rows) | 0;
    if (cols <= 0 || rows <= 0) return null;
    const diagonal = spec.diagonal !== false;
    const hname = HEURISTICS[spec.heuristic] ? spec.heuristic : 'manhattan';
    const partial = !!(spec.partial || spec.allowPartial);
    const maxIterations = Number(spec.maxIterations) > 0 ? Number(spec.maxIterations) : cols * rows;

    const s = readCell(start);
    const g = readCell(goal);
    if (!s || !g) return null;
    if (specBlocked(spec, s.cx, s.cy)) return null;
    if (!partial && specBlocked(spec, g.cx, g.cy)) return null;

    const startIdx = s.cy * cols + s.cx;
    const goalIdx = g.cy * cols + g.cx;
    if (startIdx === goalIdx) return [{ cx: s.cx, cy: s.cy }];

    const total = cols * rows;
    const gScore = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = new MinHeap();

    gScore[startIdx] = 0;
    open.push(heuristicValue(hname, g.cx - s.cx, g.cy - s.cy), startIdx);

    // Для allowPartial запоминаем ближайшую к цели достигнутую клетку.
    let bestIdx = startIdx;
    let bestH = heuristicValue(hname, g.cx - s.cx, g.cy - s.cy);
    let iterations = 0;
    let reached = false;

    while (open.size > 0) {
        const idx = open.pop();
        if (closed[idx]) continue;
        closed[idx] = 1;
        if (++iterations > maxIterations) break;
        if (idx === goalIdx) { reached = true; break; }

        const cx = idx % cols;
        const cy = (idx - cx) / cols;
        const h = heuristicValue(hname, g.cx - cx, g.cy - cy);
        if (h < bestH) { bestH = h; bestIdx = idx; }

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const diag = dx !== 0 && dy !== 0;
                if (diag && !diagonal) continue;
                const nx = cx + dx;
                const ny = cy + dy;
                if (specBlocked(spec, nx, ny)) continue;
                if (diag && (specBlocked(spec, cx + dx, cy) || specBlocked(spec, cx, cy + dy))) continue;
                const w = specWeight(spec, nx, ny);
                if (w <= 0) continue;
                const nIdx = ny * cols + nx;
                if (closed[nIdx]) continue;
                const step = diag ? Math.SQRT2 : 1;
                const ng = gScore[idx] + step * w;
                if (ng < gScore[nIdx]) {
                    gScore[nIdx] = ng;
                    cameFrom[nIdx] = idx;
                    open.push(ng + heuristicValue(hname, g.cx - nx, g.cy - ny), nIdx);
                }
            }
        }
    }

    if (!reached && !partial) return null;
    const endIdx = reached ? goalIdx : bestIdx;
    return reconstructPath(cameFrom, cols, endIdx);
}

/**
 * Убирает лишние узлы: если отрезок между двумя точками пути свободен,
 * промежуточные точки не нужны. `blockedFn(x1, y1, x2, y2)` — проверка
 * отрезка (истина = есть препятствие). Функция чистая и не знает о сетке.
 *
 * Жадный проход: для текущей точки ищем самую дальнюю видимую и прыгаем к
 * ней. Коллинеарные точки исчезают автоматически.
 */
export function smoothPath(points, blockedFn) {
    if (!points || points.length === 0) return [];
    if (points.length <= 2) return points.slice();
    const blocked = typeof blockedFn === 'function' ? blockedFn : () => false;
    const out = [points[0]];
    const n = points.length;
    let i = 0;
    while (i < n - 1) {
        let j = n - 1;
        while (j > i + 1 && blocked(points[i].x, points[i].y, points[j].x, points[j].y)) j--;
        out.push(points[j]);
        i = j;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Навигационный меш: прямоугольная декомпозиция, порталы, воронка
//
// ВАЖНО: это НЕ триангуляция (ни Делоне, ни Эрце). Свободное пространство
// режется на прямоугольники «жадным» проходом по клеткам. Такая декомпозиция
// проста, детерминирована и не даёт вырожденных треугольников, но прямоуголь-
// ников получается больше, чем треугольников при триангуляции, а «диагональные»
// коридоры описываются ступеньками. Для 2D-игр это приемлемо: граф маленький,
// путь всё равно сглаживается воронкой. Подробнее — docs/highlevel/nav.md.
// ---------------------------------------------------------------------------

/**
 * Жадная декомпозиция свободного пространства на прямоугольники.
 *
 * `blocked` — массив/Uint8Array длины `cols*rows` (истина = стена) или функция
 * `(cx, cy) ⇒ bool`. За границей области — всегда стена. Возвращает массив
 * прямоугольников `{ cx, cy, w, h }` в клетках; прямоугольники не пересекаются
 * и в сумме покрывают ровно свободные клетки.
 *
 * Алгоритм: идём по строкам, для каждой ещё не занятой свободной клетки
 * растягиваем прямоугольник вправо до первой стены/занятой клетки, затем вниз,
 * пока вся его ширина свободна. Это O(cols*rows) с небольшим множителем.
 */
export function decomposeRects(blocked, cols, rows) {
    const C = Number(cols) | 0;
    const R = Number(rows) | 0;
    const out = [];
    if (C <= 0 || R <= 0) return out;

    const wall = (cx, cy) => {
        if (cx < 0 || cy < 0 || cx >= C || cy >= R) return true;
        if (typeof blocked === 'function') return !!blocked(cx, cy);
        return !!blocked[cy * C + cx];
    };

    const used = new Uint8Array(C * R);
    for (let cy = 0; cy < R; cy++) {
        for (let cx = 0; cx < C; cx++) {
            if (used[cy * C + cx] || wall(cx, cy)) continue;
            // Ширина: тянем вправо, пока клетки свободны и не заняты.
            let w = 1;
            while (cx + w < C && !used[cy * C + cx + w] && !wall(cx + w, cy)) w++;
            // Высота: очередная строка годится, только если вся полоса шириной w
            // свободна и не занята — иначе прямоугольник перестал бы быть прямо-
            // угольником.
            let h = 1;
            while (cy + h < R) {
                let ok = true;
                for (let x = cx; x < cx + w; x++) {
                    if (used[(cy + h) * C + x] || wall(x, cy + h)) { ok = false; break; }
                }
                if (!ok) break;
                h++;
            }
            for (let yy = cy; yy < cy + h; yy++) {
                for (let xx = cx; xx < cx + w; xx++) used[yy * C + xx] = 1;
            }
            out.push({ cx, cy, w, h });
        }
    }
    return out;
}

/**
 * Граф смежности прямоугольников и порталы между ними.
 *
 * `rects` — прямоугольники в клетках `{ cx, cy, w, h }` (как у decomposeRects).
 * Два прямоугольника считаются соседями, если у них есть общая сторона
 * ненулевой длины (касание углом не считается). Порталом называется этот общий
 * отрезок: через него агент переходит из одного прямоугольника в другой.
 *
 * Возвращает `{ portals, adjacency }`:
 *   * `portals[i] = { index, a, b, x0, y0, x1, y1 }` — отрезок в тех же единицах,
 *     что и `rects` (у нас — клетки); `a`/`b` — индексы прямоугольников;
 *   * `adjacency[i] = [{ index, portal }, …]` — соседи прямоугольника i, где
 *     `index` — индекс соседа, `portal` — индекс портала в `portals`.
 *
 * Перебор пар O(rects²): прямоугольников после декомпозиции немного, а
 * построение делается один раз по вызову, а не в кадре.
 */
export function buildPortalGraph(rects) {
    const list = Array.isArray(rects) ? rects : [];
    const portals = [];
    const adjacency = list.map(() => []);
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const ax0 = a.cx, ay0 = a.cy, ax1 = a.cx + a.w, ay1 = a.cy + a.h;
        for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            const bx0 = b.cx, by0 = b.cy, bx1 = b.cx + b.w, by1 = b.cy + b.h;
            let seg = null;
            if (ax1 === bx0 || bx1 === ax0) {
                // Общая вертикальная сторона: берём пересечение по y.
                const y0 = Math.max(ay0, by0);
                const y1 = Math.min(ay1, by1);
                if (y1 > y0) seg = { x0: ax1 === bx0 ? ax1 : ax0, y0, x1: ax1 === bx0 ? ax1 : ax0, y1 };
            } else if (ay1 === by0 || by1 === ay0) {
                // Общая горизонтальная сторона: пересечение по x.
                const x0 = Math.max(ax0, bx0);
                const x1 = Math.min(ax1, bx1);
                if (x1 > x0) seg = { x0, y0: ay1 === by0 ? ay1 : ay0, x1, y1: ay1 === by0 ? ay1 : ay0 };
            }
            if (!seg) continue;
            const idx = portals.length;
            portals.push({ index: idx, a: i, b: j, x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1 });
            adjacency[i].push({ index: j, portal: idx });
            adjacency[j].push({ index: i, portal: idx });
        }
    }
    return { portals, adjacency };
}

/** Векторное произведение (b−a)×(c−a). Знак — сторона точки c от луча a→b. */
function triArea(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function samePoint(a, b) {
    return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/**
 * Сглаживание пути через порталы (funnel / string pulling).
 *
 * `points` — «сырой» путь (первая точка — старт, последняя — цель; остальное
 * не важно, но обычно это середины порталов). `portals` — упорядоченный по
 * движению массив отрезков `{ x0, y0, x1, y1 }` (в тех же координатах, что и
 * точки). Возвращает натянутый путь: минимум изломов, вершины — только на
 * углах порталов, первый и последний отрезки идут от реальных старта и цели.
 *
 * Реализован алгоритм «простой тупой воронки» (simple stupid funnel): вершина
 * воронки (apex) и её левая/правая границы сужаются при каждом портале; когда
 * границы схлопываются, из воронки выпускается угол. Один линейный проход,
 * O(порталов).
 *
 * Левую и правую вершины портала определяем по направлению движения (через
 * соседние порталы): в экранных координатах (y вниз) знак векторного
 * произведения `dir × (vertex − center) > 0` даёт правую вершину.
 */
export function funnel(points, portals) {
    const list = Array.isArray(points) ? points : [];
    if (list.length === 0) return [];
    const start = list[0];
    const end = list[list.length - 1] || start;
    const raw = Array.isArray(portals) ? portals : [];
    if (raw.length === 0) return list.slice();

    const mids = raw.map((p) => ({ x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 }));
    const ports = raw.map((p, i) => {
        const c = mids[i];
        const prev = i > 0 ? mids[i - 1] : start;
        const next = i < raw.length - 1 ? mids[i + 1] : end;
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        // cross(dir, offset) > 0 — вершина (x0,y0) справа от направления
        // движения в экранных координатах (y вниз).
        const side = dx * (p.y0 - c.y) - dy * (p.x0 - c.x);
        const e0 = { x: p.x0, y: p.y0 };
        const e1 = { x: p.x1, y: p.y1 };
        return side > 0 ? { left: e1, right: e0 } : { left: e0, right: e1 };
    });

    const out = [start];
    let apex = start;
    let left = start;
    let right = start;
    let apexIndex = 0;
    let leftIndex = 0;
    let rightIndex = 0;

    // Последняя итерация — сама цель (вырожденный портал).
    // Предохранитель на случай вырожденной геометрии: перезапусков не больше,
    // чем порталов, каждый сдвигает apex вперёд, поэтому квадрата хватает.
    const maxSteps = (ports.length + 2) * (ports.length + 2) + 16;
    let steps = 0;
    for (let i = 0; i <= ports.length; i++) {
        if (++steps > maxSteps) break;
        const l = i < ports.length ? ports[i].left : end;
        const r = i < ports.length ? ports[i].right : end;

        // Правая граница: если новая вершина не левее текущей — сужаем воронку.
        if (triArea(apex.x, apex.y, right.x, right.y, r.x, r.y) <= 0) {
            if (samePoint(apex, right) || triArea(apex.x, apex.y, left.x, left.y, r.x, r.y) > 0) {
                right = r;
                rightIndex = i;
            } else {
                // Правая граница перешагнула левую: выпускаем левый угол и
                // продолжаем с портала сразу за новым apex.
                out.push(left);
                apex = left;
                apexIndex = leftIndex;
                left = apex;
                right = apex;
                leftIndex = apexIndex;
                rightIndex = apexIndex;
                i = apexIndex;
                continue;
            }
        }

        // Левая граница: симметрично.
        if (triArea(apex.x, apex.y, left.x, left.y, l.x, l.y) >= 0) {
            if (samePoint(apex, left) || triArea(apex.x, apex.y, right.x, right.y, l.x, l.y) < 0) {
                left = l;
                leftIndex = i;
            } else {
                out.push(right);
                apex = right;
                apexIndex = rightIndex;
                left = apex;
                right = apex;
                leftIndex = apexIndex;
                rightIndex = apexIndex;
                i = apexIndex;
                continue;
            }
        }
    }

    if (!samePoint(out[out.length - 1], end)) out.push(end);
    return out;
}

// ---------------------------------------------------------------------------
// Мировые координаты и точки
// ---------------------------------------------------------------------------

function toPoint(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
        const node = query(v)[0];
        return node ? { x: node.x, y: node.y } : null;
    }
    if (typeof v === 'number') return null;
    if (Array.isArray(v)) {
        if (v.length < 2) return null;
        return { x: Number(v[0]) || 0, y: Number(v[1]) || 0 };
    }
    if (v.nodes) {
        const node = v.nodes[0];
        return node ? { x: node.x, y: node.y } : null;
    }
    if (v.self) return toPoint(v.self);
    if (typeof v === 'object') return { x: Number(v.x) || 0, y: Number(v.y) || 0 };
    return null;
}

function isGridLike(g) {
    // Навмеш намеренно не считается сеткой: у него своя логика пути, а форма
    // полей похожа (blocked/cols/rows) — различаем по явному маркеру.
    return !!g && typeof g === 'object' && !g._is_navmesh &&
        !!g.blocked && g.cols > 0 && g.rows > 0;
}

function isMeshLike(m) {
    return !!m && typeof m === 'object' && m._is_navmesh === true && typeof m.path === 'function';
}

/**
 * Маска проходимости с запасом на габарит агента.
 *
 * Клетка считается непроходимой, если квадрат «центр ± radius» задевает
 * препятствие. Именно по этой маске идут A* и сглаживание, когда у агента
 * задан радиус: без неё путь проходит вплотную к стене и тело упирается.
 * Публичные `isBlocked`/`lineOfSight` остаются «сырыми» — они отвечают на
 * вопрос «стена ли клетка», а не «пролезет ли сюда агент».
 *
 * radius <= 0 возвращает исходную маску без копирования.
 */
export function effectiveMask(grid, radius) {
    const r = Number(radius) > 0 ? Number(radius) : 0;
    if (r <= 0) return grid.blocked;

    const hit = grid._mask_cache ? grid._mask_cache.get(r) : null;
    if (hit && hit.version === grid.version) return hit.mask;

    const { cols, rows, cell, x, y } = grid;
    const src = grid.blocked;
    const mask = new Uint8Array(cols * rows);

    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const px = x + (cx + 0.5) * cell;
            const py = y + (cy + 0.5) * cell;
            // Перебираем только те клетки, чей прямоугольник попадает в
            // квадрат тела — иначе на больших картах это O(n²).
            const c0 = Math.max(0, Math.floor((px - r - x) / cell));
            const c1 = Math.min(cols - 1, Math.floor((px + r - x) / cell));
            const r0 = Math.max(0, Math.floor((py - r - y) / cell));
            const r1 = Math.min(rows - 1, Math.floor((py + r - y) / cell));

            let bad = 0;
            for (let yy = r0; yy <= r1 && !bad; yy++) {
                for (let xx = c0; xx <= c1; xx++) {
                    if (!src[yy * cols + xx]) continue;
                    const bx0 = x + xx * cell;
                    const by0 = y + yy * cell;
                    if (px + r > bx0 && px - r < bx0 + cell &&
                        py + r > by0 && py - r < by0 + cell) {
                        bad = 1;
                        break;
                    }
                }
            }
            mask[cy * cols + cx] = bad;
        }
    }

    if (grid._mask_cache) {
        if (grid._mask_cache.size >= 8) grid._mask_cache.clear();
        grid._mask_cache.set(r, { version: grid.version, mask });
    }
    return mask;
}

/** Псевдо-сетка для lineOfSight/smoothPath по готовой маске. */
function maskGrid(grid, mask) {
    return {
        cols: grid.cols,
        rows: grid.rows,
        isBlocked(cx, cy) {
            if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
            return mask[cy * grid.cols + cx] !== 0;
        },
    };
}

// ---------------------------------------------------------------------------
// Сетка
// ---------------------------------------------------------------------------

/**
 * Создаёт сетку навигации. x/y — левый верхний угол в мировых пикселях,
 * w/h — размер; cell — сторона клетки. Сетка хранит только массив
 * препятствий и умеет превращать мир ↔ клетки.
 */
export function makeGrid(opts) {
    const o = opts || {};
    const cell = Number(o.cell) > 0 ? Number(o.cell) : 32;
    const x = Number(o.x) || 0;
    const y = Number(o.y) || 0;
    const w = Number(o.w) || 0;
    const h = Number(o.h) || 0;
    if (w <= 0 || h <= 0) return null;
    const cols = Math.max(1, Math.ceil(w / cell));
    const rows = Math.max(1, Math.ceil(h / cell));
    const blocked = new Uint8Array(cols * rows);

    const grid = {
        x, y, w, h, cell, cols, rows,
        diagonal: o.diagonal !== false,
        heuristic: HEURISTICS[o.heuristic] ? o.heuristic : 'manhattan',
        weights: o.weights || null,
        blocked,
        // Запас на габарит агента. Клетка считается проходимой, только если
        // тело такого радиуса из её центра не задевает препятствие. Без
        // этого путь идёт вплотную к стене, и агент в неё упирается.
        agentRadius: Number(o.agentRadius) > 0 ? Number(o.agentRadius) : 0,
        version: 0,        // растёт при любом изменении препятствий
        _cell_cache: new Map(),   // кэш клеточных путей A*
        _mask_cache: new Map(),   // кэш масок с запасом на радиус
        _build: null,      // последние параметры buildFromWalls

        /** Клетка под мировой точкой (может быть за границей сетки). */
        worldToCell(wx, wy) {
            return {
                cx: Math.floor((Number(wx) - x) / cell),
                cy: Math.floor((Number(wy) - y) / cell),
            };
        },

        /** Центр клетки в мировых координатах. */
        cellCenter(cx, cy) {
            return { x: x + (cx + 0.5) * cell, y: y + (cy + 0.5) * cell };
        },

        inBounds(cx, cy) {
            return cx >= 0 && cy >= 0 && cx < cols && cy < rows;
        },

        /** Стена ли клетка. За границей сетки — всегда стена. */
        isBlocked(cx, cy) {
            if (!grid.inBounds(cx, cy)) return true;
            return blocked[cy * cols + cx] !== 0;
        },

        setBlocked(cx, cy, value) {
            const v = value === false ? 0 : 1;
            if (!grid.inBounds(cx, cy)) return grid;
            const i = cy * cols + cx;
            if (blocked[i] !== v) {
                blocked[i] = v;
                grid.version++;
                grid._cell_cache.clear();
                grid._mask_cache.clear();
            }
            return grid;
        },

        /** Закрыть клетку под мировой точкой. */
        blockAt(wx, wy) {
            const c = grid.worldToCell(wx, wy);
            return grid.setBlocked(c.cx, c.cy, true);
        },

        /** Открыть клетку под мировой точкой. */
        freeAt(wx, wy) {
            const c = grid.worldToCell(wx, wy);
            return grid.setBlocked(c.cx, c.cy, false);
        },

        /** Снять все препятствия. */
        clear() {
            blocked.fill(0);
            grid.version++;
            grid._cell_cache.clear();
            grid._mask_cache.clear();
            return grid;
        },

        /**
         * Ближайшая свободная клетка к (cx, cy) поиском по кольцам.
         * Нужна, когда агент упёрся в стену вплотную: без этого он бы
         * навсегда остался «в блоке» и путь не строился.
         *
         * mask — необязательная маска с запасом на радиус агента: искать
         * надо по ней, иначе старт окажется «проходимым» для точки, но не
         * для тела.
         */
        nearestFreeCell(cx, cy, maxRadius, mask) {
            const m = mask || blocked;
            const isBad = (ix, iy) => !grid.inBounds(ix, iy) || m[iy * cols + ix] !== 0;
            if (!isBad(cx, cy)) return { cx, cy };
            const R = Number(maxRadius) > 0 ? Number(maxRadius) : 8;
            for (let r = 1; r <= R; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (!isBad(nx, ny)) {
                            return { cx: nx, cy: ny };
                        }
                    }
                }
            }
            return null;
        },

        /** Пометки из узлов мира — см. buildFromWalls. */
        buildFromWalls(buildOpts) {
            const b = buildOpts || {};
            const tags = b.tags === undefined ? ['wall'] : b.tags;
            // agentRadius — запас на габарит агента: без него путь идёт
            // вплотную к стене и тело упирается (см. effectiveMask).
            if (b.agentRadius !== undefined) {
                grid.agentRadius = Number(b.agentRadius) > 0 ? Number(b.agentRadius) : 0;
                grid._mask_cache.clear();
            }
            grid._build = {
                tags: Array.isArray(tags) ? tags.slice() : [tags],
                inset: Number(b.inset) || 0,
                agentRadius: grid.agentRadius,
            };
            return rebuildFromWalls(grid);
        },

        /** Задать запас на габарит агента в пикселях (0 — точечный поиск). */
        inflate(radius) {
            grid.agentRadius = Number(radius) > 0 ? Number(radius) : 0;
            grid._mask_cache.clear();
            grid.version++;
            grid._cell_cache.clear();
            return grid;
        },

        /** Повторить последнюю buildFromWalls (или просто сбросить кэш). */
        rebuild() {
            if (grid._build) return rebuildFromWalls(grid);
            grid.version++;
            grid._cell_cache.clear();
            grid._mask_cache.clear();
            return grid;
        },

        /** Прямая видимость по клеткам — чистая проверка, без физики. */
        lineOfSight(from, to) { return lineOfSight(from, to, grid); },

        /** Путь по этой сетке в мировых точках. */
        path(from, to, pathOpts) { return pathOnGrid(grid, from, to, pathOpts || {}); },
    };

    return grid;
}

/** Пересборка препятствий: теги + статические тела, попавшие в сетку. */
function rebuildFromWalls(grid) {
    const o = grid._build || { tags: ['wall'], inset: 0 };
    grid.blocked.fill(0);
    const seen = new Set();

    // 1. Узлы по тегам/классам — включая те, у кого нет физического тела.
    for (const sel of o.tags) {
        if (typeof sel !== 'string') continue;
        for (const node of query(sel)) markNodeInto(grid, node, o.inset, seen);
    }

    // 2. Дополнительно — все статические тела в габарите сетки. Так
    //    препятствием становится стена без тега <wall>, а не только она.
    if (ctx.world && typeof ctx.world.bodiesIn === 'function') {
        const found = ctx.world.bodiesIn(grid.x + grid.w / 2, grid.y + grid.h / 2, grid.w, grid.h);
        for (const node of found.toArray()) {
            if (node.attrs.ui) continue;
            if (node.body_kind !== 'static' && node.body_kind !== 'kinematic' && node.tag !== 'wall') continue;
            markNodeInto(grid, node, o.inset, seen);
        }
    }

    grid.version++;
    grid._cell_cache.clear();
    return grid;
}

function markNodeInto(grid, node, inset, seen) {
    if (!node || seen.has(node) || node.attrs.ui) return;
    seen.add(node);
    const b = nodeBounds(node);
    const x0 = b.x0 + inset;
    const y0 = b.y0 + inset;
    const x1 = b.x1 - inset;
    const y1 = b.y1 - inset;
    if (x0 > x1 || y0 > y1) {
        // Препятствие тоньше inset — хотя бы его центр остаётся стеной.
        const c = grid.worldToCell(node.x, node.y);
        if (grid.inBounds(c.cx, c.cy)) grid.blocked[c.cy * grid.cols + c.cx] = 1;
        return;
    }
    const c0 = grid.worldToCell(x0, y0);
    const c1 = grid.worldToCell(x1 - 1e-4, y1 - 1e-4);
    markRectInto(grid, c0, c1);
}

function markRectInto(grid, c0, c1) {
    const x0 = Math.max(0, Math.min(c0.cx, c1.cx));
    const x1 = Math.min(grid.cols - 1, Math.max(c0.cx, c1.cx));
    const y0 = Math.max(0, Math.min(c0.cy, c1.cy));
    const y1 = Math.min(grid.rows - 1, Math.max(c0.cy, c1.cy));
    for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) grid.blocked[cy * grid.cols + cx] = 1;
    }
}

// ---------------------------------------------------------------------------
// Навмеш
// ---------------------------------------------------------------------------

/** Прямоугольник из клеток в мировые координаты (x/y — центр). */
function cellRectToWorld(g, r, index) {
    const x0 = g.x + r.cx * g.cell;
    const y0 = g.y + r.cy * g.cell;
    const x1 = g.x + (r.cx + r.w) * g.cell;
    const y1 = g.y + (r.cy + r.h) * g.cell;
    return {
        index,
        cx: r.cx, cy: r.cy, cw: r.w, ch: r.h,
        x0, y0, x1, y1,
        x: (x0 + x1) / 2, y: (y0 + y1) / 2,
        w: x1 - x0, h: y1 - y0,
    };
}

/** Порталы из клеток в мировые координаты. */
function cellPortalToWorld(g, p) {
    return {
        index: p.index, a: p.a, b: p.b,
        x0: g.x + p.x0 * g.cell,
        y0: g.y + p.y0 * g.cell,
        x1: g.x + p.x1 * g.cell,
        y1: g.y + p.y1 * g.cell,
    };
}

/**
 * Декомпозиция навмеша под конкретный радиус агента с кэшем.
 *
 * Радиус входит в ключ кэша: одна и та же геометрия может использоваться и
 * точечным поиском (radius = 0), и телом ненулевого габарита. Кэш маленький
 * (как у масок сетки) — пересчёт дешевле, чем неограниченный рост.
 */
function ensureDecomp(mesh, radius) {
    const r = Number(radius) > 0 ? Number(radius) : 0;
    const g = mesh._grid;
    const ver = g.version;
    const hit = mesh._decomp_cache.get(r);
    if (hit && hit.version === ver) return hit;

    const mask = effectiveMask(g, r);
    const cells = decomposeRects(mask, g.cols, g.rows);
    const graph = buildPortalGraph(cells);
    const decomp = {
        version: ver,
        radius: r,
        mask,
        cells,
        graph,
        rects: cells.map((rc, i) => cellRectToWorld(g, rc, i)),
        portals: graph.portals.map((p) => cellPortalToWorld(g, p)),
    };
    if (mesh._decomp_cache.size >= 4) mesh._decomp_cache.clear();
    mesh._decomp_cache.set(r, decomp);
    return decomp;
}

/** Индекс прямоугольника, содержащего точку (полуоткрытые границы), или -1. */
function rectIndexAtPoint(rects, x, y) {
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return i;
    }
    return -1;
}

/** Ближайший прямоугольник к точке (0, если точка внутри) или -1. */
function nearestRect(rects, x, y) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const dx = x < r.x0 ? r.x0 - x : (x > r.x1 ? x - r.x1 : 0);
        const dy = y < r.y0 ? r.y0 - y : (y > r.y1 ? y - r.y1 : 0);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/** Ближайшая точка прямоугольника к (x, y); точка внутри не сдвигается. */
function clampToRect(r, x, y) {
    const e = 1e-4;
    return {
        x: Math.min(Math.max(x, r.x0 + e), r.x1 - e),
        y: Math.min(Math.max(y, r.y0 + e), r.y1 - e),
    };
}

/**
 * A* по графу прямоугольников. Стоимость шага — расстояние между центрами
 * соседей, эвристика — расстояние до центра цели. O(прямоугольников·log).
 * При `allowPartial` и недостижимой цели отдаёт цепочку до ближайшего по
 * эвристике прямоугольника (аналог allowPartial у сетки).
 */
function rectSearch(decomp, sIdx, gIdx, allowPartial) {
    const rects = decomp.rects;
    const n = rects.length;
    const goal = rects[gIdx];
    const h = (i) => Math.hypot(rects[i].x - goal.x, rects[i].y - goal.y);

    const gScore = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new MinHeap();

    gScore[sIdx] = 0;
    open.push(h(sIdx), sIdx);
    let reached = false;
    let best = sIdx;
    let bestH = h(sIdx);

    while (open.size > 0) {
        const cur = open.pop();
        if (closed[cur]) continue;
        closed[cur] = 1;
        if (cur === gIdx) { reached = true; break; }
        const hc = h(cur);
        if (hc < bestH) { bestH = hc; best = cur; }

        for (const nb of decomp.graph.adjacency[cur]) {
            if (closed[nb.index]) continue;
            const step = Math.hypot(rects[cur].x - rects[nb.index].x, rects[cur].y - rects[nb.index].y) || 1e-6;
            const ng = gScore[cur] + step;
            if (ng < gScore[nb.index]) {
                gScore[nb.index] = ng;
                came[nb.index] = cur;
                open.push(ng + h(nb.index), nb.index);
            }
        }
    }

    if (!reached && !allowPartial) return null;
    const end = reached ? gIdx : best;
    const chain = [];
    let cur = end;
    let guard = 0;
    while (cur !== -1 && guard++ <= n) { chain.push(cur); cur = came[cur]; }
    chain.reverse();
    return chain;
}

/** Основная работа meshPath: цепочка прямоугольников + воронка. */
function computeMeshPath(mesh, decomp, a, b, o) {
    const sIdx = rectIndexAtPoint(decomp.rects, a.x, a.y);
    const gIdx = rectIndexAtPoint(decomp.rects, b.x, b.y);
    // Точка вне прямоугольников (стоит в стене или за областью) — притягиваем
    // к ближайшему: иначе старт/цель неоткуда взять, как nearestFreeCell у сетки.
    const sPick = sIdx >= 0 ? sIdx : nearestRect(decomp.rects, a.x, a.y);
    const gPick = gIdx >= 0 ? gIdx : nearestRect(decomp.rects, b.x, b.y);
    if (sPick < 0 || gPick < 0) return null;

    const anchorA = sIdx >= 0 ? { x: a.x, y: a.y } : clampToRect(decomp.rects[sPick], a.x, a.y);
    const anchorB = gIdx >= 0 ? { x: b.x, y: b.y } : clampToRect(decomp.rects[gPick], b.x, b.y);
    if (sPick === gPick) return [anchorA, anchorB];

    const chain = rectSearch(decomp, sPick, gPick, !!o.allowPartial);
    if (!chain || chain.length === 0) return null;
    const reached = chain[chain.length - 1] === gPick;
    if (chain.length === 1) {
        // Цель недостижима, но allowPartial разрешил остановиться: путь
        // заканчивается ближайшей к цели точкой единственного прямоугольника.
        if (reached) return [anchorA, anchorB];
        return [anchorA, clampToRect(decomp.rects[chain[0]], b.x, b.y)];
    }

    const segs = [];
    for (let k = 0; k + 1 < chain.length; k++) {
        let pidx = -1;
        for (const nb of decomp.graph.adjacency[chain[k]]) {
            if (nb.index === chain[k + 1]) { pidx = nb.portal; break; }
        }
        if (pidx >= 0) segs.push(decomp.portals[pidx]);
    }

    // Если цель недостижима (allowPartial), путь заканчивается в последнем
    // достижимом прямоугольнике — ближайшей к цели его точкой.
    const endPoint = reached ? anchorB : clampToRect(decomp.rects[chain[chain.length - 1]], b.x, b.y);

    const raw = [anchorA];
    for (const s of segs) raw.push({ x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 });
    raw.push(endPoint);

    // Воронку применяем только на полном пути: у частичного конец лежит вне
    // коридора, и натяжение могло бы увести маршрут в стену.
    if (reached && o.smooth !== false && segs.length > 0) {
        const out = funnel(raw, segs);
        if (out.length >= 2) {
            out[0] = { x: anchorA.x, y: anchorA.y };
            out[out.length - 1] = { x: anchorB.x, y: anchorB.y };
            return out;
        }
    }
    return raw;
}

/**
 * Путь по навмешу в мировых точках. Первая точка — ровно `from`, последняя —
 * ровно `to` (если цель достижима и обе точки вне стен). При `opts.smooth ===
 * false` возвращается ломаная через середины порталов. `opts.radius` задаёт
 * габарит агента (по умолчанию `mesh.agentRadius`); под каждый радиус
 * декомпозиция строится один раз и кэшируется.
 */
export function pathOnMesh(mesh, from, to, opts) {
    if (!isMeshLike(mesh)) return null;
    const o = opts || {};
    const a = toPoint(from);
    const b = toPoint(to);
    if (!a || !b) return null;

    const radius = o.radius !== undefined && o.radius !== null
        ? Number(o.radius)
        : (Number(mesh.agentRadius) || 0);
    const decomp = ensureDecomp(mesh, radius);
    if (decomp.rects.length === 0) return null;

    const key = `${Math.round(a.x * 100)},${Math.round(a.y * 100)}|` +
        `${Math.round(b.x * 100)},${Math.round(b.y * 100)}|` +
        `${mesh._grid.version}|r${radius}|s${o.smooth === false ? 0 : 1}|p${o.allowPartial ? 1 : 0}`;
    if (mesh._path_cache.has(key)) return mesh._path_cache.get(key);

    const result = computeMeshPath(mesh, decomp, a, b, o);
    if (mesh._path_cache.size >= 64) mesh._path_cache.clear();
    mesh._path_cache.set(key, result);
    return result;
}

/**
 * Создаёт навмеш: область x/y/w/h (как у сетки) с клеточной маской препятствий.
 * Сам по себе пустой; заполняется `buildFromWalls` (из узлов мира) или вручную
 * `blockAt`/`setBlocked`. Декомпозиция на прямоугольники строится лениво — при
 * первом обращении, а не в конструкторе: построение не должно попадать в кадр.
 */
export function makeMesh(opts) {
    const o = opts || {};
    const g = makeGrid({ x: o.x, y: o.y, w: o.w, h: o.h, cell: o.cell });
    if (!g) return null;

    const mesh = {
        _is_navmesh: true,
        _grid: g,
        x: g.x, y: g.y, w: g.w, h: g.h, cell: g.cell,
        // Поля-геттеры: снаружи навмеш выглядит как сетка (cols/rows/blocked),
        // но isGridLike его не путает с ней из-за _is_navmesh.
        get cols() { return g.cols; },
        get rows() { return g.rows; },
        get blocked() { return g.blocked; },
        get version() { return g.version; },

        // Запас на габарит агента: декомпозиция режется по раздутой маске,
        // иначе путь идёт вплотную к стене и тело упирается.
        agentRadius: Number(o.agentRadius) > 0 ? Number(o.agentRadius) : 0,
        _decomp_cache: new Map(),
        _path_cache: new Map(),

        worldToCell(wx, wy) { return g.worldToCell(wx, wy); },
        cellCenter(cx, cy) { return g.cellCenter(cx, cy); },
        inBounds(cx, cy) { return g.inBounds(cx, cy); },
        isBlocked(cx, cy) { return g.isBlocked(cx, cy); },
        nearestFreeCell(cx, cy, maxRadius, mask) { return g.nearestFreeCell(cx, cy, maxRadius, mask); },
        lineOfSight(from, to) { return lineOfSight(from, to, g); },

        setBlocked(cx, cy, value) { g.setBlocked(cx, cy, value); mesh._invalidate(); return mesh; },
        blockAt(wx, wy) { g.blockAt(wx, wy); mesh._invalidate(); return mesh; },
        freeAt(wx, wy) { g.freeAt(wx, wy); mesh._invalidate(); return mesh; },

        /** Сбросить кэши декомпозиции и путей (версия препятствий растёт сама). */
        _invalidate() { mesh._decomp_cache.clear(); mesh._path_cache.clear(); },

        buildFromWalls(buildOpts) {
            const b = buildOpts || {};
            if (b.agentRadius !== undefined) {
                mesh.agentRadius = Number(b.agentRadius) > 0 ? Number(b.agentRadius) : 0;
            }
            g.buildFromWalls(b);
            mesh._invalidate();
            return mesh;
        },

        rebuild() { g.rebuild(); mesh._invalidate(); return mesh; },

        inflate(radius) {
            mesh.agentRadius = Number(radius) > 0 ? Number(radius) : 0;
            g.agentRadius = mesh.agentRadius;
            mesh._invalidate();
            return mesh;
        },

        /** Снять все препятствия и сбросить декомпозицию. */
        clear() { g.clear(); mesh._invalidate(); return mesh; },

        /** Прямоугольники декомпозиции в мировых координатах (x/y — центр). */
        rects() { return ensureDecomp(mesh, mesh.agentRadius).rects.slice(); },

        /** Порталы между прямоугольниками в мировых координатах. */
        portals() { return ensureDecomp(mesh, mesh.agentRadius).portals.slice(); },

        /** Прямоугольник под мировой точкой или null. */
        rectAt(wx, wy) {
            const d = ensureDecomp(mesh, mesh.agentRadius);
            const i = rectIndexAtPoint(d.rects, Number(wx), Number(wy));
            return i >= 0 ? d.rects[i] : null;
        },

        /** Проходима ли точка (лежит ли в каком-нибудь прямоугольнике). */
        contains(wx, wy) { return !!mesh.rectAt(wx, wy); },

        /** Путь по этому навмешу в мировых точках. */
        path(from, to, pathOpts) { return pathOnMesh(mesh, from, to, pathOpts || {}); },
    };

    return mesh;
}

// ---------------------------------------------------------------------------
// Прямая видимость (supercover-обход клеток)
// ---------------------------------------------------------------------------

/**
 * Свободен ли отрезок от from до to по сетке. Чистая функция: стартовая
 * клетка не считается (агент может стоять вплотную к стене), конечная —
 * считается. Выход за границы сетки — препятствие. Пересечение ровно через
 * угол проверяет обе ортогональные клетки, поэтому «протиснуться» между
 * двумя диагональными стенами нельзя.
 */
export function lineOfSight(from, to, grid) {
    if (!grid) return false;
    const a = toPoint(from);
    const b = toPoint(to);
    if (!a || !b) return false;
    const cell = Number(grid.cell) > 0 ? Number(grid.cell) : 1;
    const ox = Number(grid.x) || 0;
    const oy = Number(grid.y) || 0;
    const cols = Number(grid.cols) | 0;
    const rows = Number(grid.rows) | 0;
    if (cols <= 0 || rows <= 0) return true;

    const x0 = (a.x - ox) / cell;
    const y0 = (a.y - oy) / cell;
    const x1 = (b.x - ox) / cell;
    const y1 = (b.y - oy) / cell;
    let cx = Math.floor(x0);
    let cy = Math.floor(y0);
    const ex = Math.floor(x1);
    const ey = Math.floor(y1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const invX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const invY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? (cx + 1 - x0) : (x0 - cx)) * invX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? (cy + 1 - y0) : (y0 - cy)) * invY : Infinity;

    const blockedCell = (ccx, ccy) => {
        if (ccx < 0 || ccy < 0 || ccx >= cols || ccy >= rows) return true;
        const bv = grid.blocked;
        if (!bv) return false;
        if (typeof bv === 'function') return !!bv(ccx, ccy);
        return !!bv[ccy * cols + ccx];
    };

    const scx = cx;
    const scy = cy;
    let guard = 0;
    const maxSteps = cols + rows + 4;
    while (guard++ <= maxSteps) {
        if (cx === ex && cy === ey) return true;
        if (tMaxX < tMaxY) {
            cx += stepX;
            tMaxX += invX;
        } else if (tMaxY < tMaxX) {
            cy += stepY;
            tMaxY += invY;
        } else {
            if (blockedCell(cx + stepX, cy) || blockedCell(cx, cy + stepY)) return false;
            cx += stepX;
            cy += stepY;
            tMaxX += invX;
            tMaxY += invY;
        }
        if (cx === scx && cy === scy) continue;
        if (blockedCell(cx, cy)) return false;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Поиск пути
// ---------------------------------------------------------------------------

function cachedAstar(grid, s, goal, o) {
    // Радиус агента входит в ключ: одна и та же сетка может использоваться
    // и точечным поиском, и поиском с габаритом.
    const radius = Number(o.radius) > 0 ? Number(o.radius) : 0;
    const key = s.cx + ',' + s.cy + '|' + goal.cx + ',' + goal.cy + '|' + grid.version +
        '|' + (grid.diagonal ? 1 : 0) + '|' + grid.heuristic + '|' +
        (o.allowPartial ? 1 : 0) + '|' + (o.maxIterations || 0) + '|r' + radius;
    if (grid._cell_cache.has(key)) return grid._cell_cache.get(key);
    const cells = astar({
        cols: grid.cols,
        rows: grid.rows,
        blocked: effectiveMask(grid, radius),
        cell: grid.cell,
        diagonal: grid.diagonal,
        heuristic: grid.heuristic,
        weights: grid.weights,
        partial: o.allowPartial,
        maxIterations: o.maxIterations,
    }, s, goal);
    // Кэш маленький и намеренно грубый: пересчёт хуже, чем редкое вытеснение.
    if (grid._cell_cache.size >= 64) grid._cell_cache.clear();
    grid._cell_cache.set(key, cells);
    return cells;
}

/**
 * Путь по сетке в мировых точках: первая точка — ровно `from`, последняя —
 * ровно `to` (если цель достигнута). `opts.smooth !== false` включает
 * сглаживание, `opts.allowPartial` — путь до ближайшей достижимой клетки,
 * `opts.radius` — запас на габарит агента (по умолчанию `grid.agentRadius`).
 */
export function pathOnGrid(grid, from, to, opts) {
    if (!isGridLike(grid)) return null;
    const o = opts || {};
    const a = toPoint(from);
    const b = toPoint(to);
    if (!a || !b) return null;
    const start = grid.worldToCell(a.x, a.y);
    const goal = grid.worldToCell(b.x, b.y);

    const radius = o.radius !== undefined && o.radius !== null
        ? Number(o.radius)
        : (Number(grid.agentRadius) || 0);
    const mask = effectiveMask(grid, radius);
    const maskBlocked = (cx, cy) => (
        cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows ||
        mask[cy * grid.cols + cx] !== 0
    );

    // Старт в стене: ищем ближайшую свободную клетку, иначе путь не построить.
    let s = start;
    if (maskBlocked(start.cx, start.cy)) {
        const free = grid.nearestFreeCell(start.cx, start.cy, o.startSearch, mask);
        if (!free) return null;
        s = free;
    }

    const cells = cachedAstar(grid, s, goal, o);
    if (!cells || cells.length === 0) return null;
    const last = cells[cells.length - 1];
    const reached = last.cx === goal.cx && last.cy === goal.cy;

    let pts;
    if (cells.length === 1) {
        if (!reached) return null;
        pts = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    } else {
        pts = cells.map((c) => grid.cellCenter(c.cx, c.cy));
        pts[0] = { x: a.x, y: a.y };
        if (reached) pts[pts.length - 1] = { x: b.x, y: b.y };
    }

    if (o.smooth !== false && pts.length > 2) {
        // Сглаживание — по той же маске с запасом: иначе прямая «срежет»
        // угол, который тело агента не пролезет.
        const los_grid = radius > 0 ? maskGrid(grid, mask) : grid;
        pts = smoothPath(pts, (x1, y1, x2, y2) => !lineOfSight({ x: x1, y: y1 }, { x: x2, y: y2 }, los_grid));
    }
    return pts;
}

// ---------------------------------------------------------------------------
// Агент: состояние, движение, события
// ---------------------------------------------------------------------------

function resolveGrid(g) {
    if (isGridLike(g)) return g;
    if (typeof g === 'number' && state.grids[g]) return state.grids[g];
    return state.default_grid;
}

function resolveMesh(m) {
    if (isMeshLike(m)) return m;
    if (typeof m === 'number' && state.meshes[m]) return state.meshes[m];
    return state.default_mesh;
}

/**
 * Источник пути для агента: явный mesh, иначе явная сетка, иначе навмеш по
 * умолчанию ($.nav.useMesh), иначе сетка по умолчанию. Явный аргумент всегда
 * важнее умолчаний, поэтому старые игры с $.nav.grid продолжают работать без
 * изменений, даже если в игре есть навмеш.
 */
function resolveSource(opts) {
    const o = opts || {};
    if (o.mesh !== undefined && o.mesh !== null) {
        const m = resolveMesh(o.mesh);
        if (!m) ctx.log('$.nav.navigateTo: неизвестный навмеш — создайте его через $.nav.mesh({ x, y, w, h, cell })');
        return m;
    }
    if (o.grid !== undefined && o.grid !== null) {
        const g = resolveGrid(o.grid);
        if (!g) ctx.log('$.nav.navigateTo: неизвестная сетка — создайте её через $.nav.grid({ x, y, w, h, cell })');
        return g;
    }
    return state.default_mesh || state.default_grid;
}

/** Считает путь от текущей позиции узла и раскладывает его в состояние. */
function buildPath(st, target) {
    st.target = { x: target.x, y: target.y };
    st.last_goal = { x: target.x, y: target.y };
    st.path = st.source.path({ x: st.node.x, y: st.node.y }, target, {
        smooth: st.opts.smooth,
        allowPartial: st.opts.allowPartial,
        maxIterations: st.opts.maxIterations,
        startSearch: st.opts.startSearch,
        radius: st.opts.radius,
    }) || [];
    st.index = st.path.length > 1 ? 1 : 0;
    return st.path.length > 0;
}

function makeNavEvent(node, name, data) {
    const self = wrapOne(node);
    return {
        self,
        target: self,
        source: self,
        name,
        type: name,
        data: data === undefined ? {} : data,
        dt: ctx.time ? ctx.time.delta() : 1 / 60,
        frame: engine.frame,
        stopped: false,
        stop() { this.stopped = true; },
        preventDefault() {},
    };
}

function safeCall(fn, event) {
    try { fn(event); } catch (e) { ctx.log(`$.nav: ошибка в обработчике "${event.name}": ${e}`); }
}

function normalizeOpts(opts, grid) {
    const o = opts || {};
    const cell = grid ? grid.cell : 32;
    return {
        speed: Number(o.speed) > 0 ? Number(o.speed) : 100,
        grid: o.grid || null,
        stopDistance: o.stopDistance !== undefined ? Math.max(0, Number(o.stopDistance)) : 6,
        smooth: o.smooth !== false,
        repathEvery: o.repathEvery !== undefined ? Math.max(0, Number(o.repathEvery)) : 500,
        allowPartial: !!o.allowPartial,
        repathTolerance: o.repathTolerance !== undefined ? Math.max(0, Number(o.repathTolerance)) : 4,
        waypointRadius: o.waypointRadius !== undefined
            ? Math.max(1, Number(o.waypointRadius))
            : Math.max(4, cell * 0.25),
        avoid: o.avoid || null,
        avoidRadius: o.avoidRadius !== undefined ? Math.max(1, Number(o.avoidRadius)) : 48,
        maxIterations: Number(o.maxIterations) > 0 ? Number(o.maxIterations) : 0,
        startSearch: o.startSearch,
        // Габарит агента для поиска пути: явный radius, иначе запас сетки.
        radius: o.radius !== undefined && o.radius !== null
            ? Math.max(0, Number(o.radius))
            : (grid && Number(grid.agentRadius) > 0 ? Number(grid.agentRadius) : 0),
        onArrive: typeof o.onArrive === 'function' ? o.onArrive : null,
        onBlocked: typeof o.onBlocked === 'function' ? o.onBlocked : null,
    };
}

function resolveTarget(ref) {
    return toPoint(ref);
}

function findAgent(node) {
    return agent_index.get(node) || null;
}

function removeAgent(st) {
    const i = agents.indexOf(st);
    if (i >= 0) agents.splice(i, 1);
    if (agent_index.get(st.node) === st) agent_index.delete(st.node);
}

function arriveAgent(st) {
    const node = st.node;
    if (node.body >= 0) engine.setVelocity(node.body, 0, 0);
    const data = { target: { x: st.target.x, y: st.target.y }, path: st.path.map((p) => ({ x: p.x, y: p.y })) };
    removeAgent(st);
    node.emit('arrive', data);
    if (st.opts.onArrive) safeCall(st.opts.onArrive, makeNavEvent(node, 'arrive', data));
}

function blockAgent(st, reason) {
    const node = st.node;
    const data = { reason, target: { x: st.target.x, y: st.target.y } };
    removeAgent(st);
    node.emit('blocked', data);
    if (st.opts.onBlocked) safeCall(st.opts.onBlocked, makeNavEvent(node, 'blocked', data));
}

/** Мягкое расталкивание: соседи по `avoid` дают боковое смещение. */
function avoidanceOffset(st, node) {
    const av = st.opts.avoid;
    if (!av) return null;
    let list;
    if (av === true) list = ctx.nodes;
    else if (typeof av === 'string') list = query(av);
    else if (av && av.nodes) list = av.nodes;
    else return null;
    const r = st.opts.avoidRadius;
    let ox = 0;
    let oy = 0;
    for (const other of list) {
        if (other === node || other.removed) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const d = Math.hypot(dx, dy);
        if (d > r || d < 1e-3) continue;
        const k = (r - d) / r;
        ox += (dx / d) * k;
        oy += (dy / d) * k;
    }
    if (ox === 0 && oy === 0) return null;
    return { x: ox, y: oy };
}

function stepAgent(st, node, dt) {
    const o = st.opts;
    st.time += dt;

    // Пересчёт пути по таймеру — только если цель действительно сдвинулась,
    // иначе A* крутился бы каждый интервал впустую.
    if (o.repathEvery > 0) {
        st.repath_timer += dt;
        if (st.repath_timer >= o.repathEvery / 1000) {
            st.repath_timer = 0;
            const t = resolveTarget(st.target_ref);
            if (t) {
                const moved = Math.hypot(t.x - st.last_goal.x, t.y - st.last_goal.y);
                if (moved > o.repathTolerance) {
                    if (!buildPath(st, t)) { blockAgent(st, 'путь к цели не найден'); return; }
                }
            }
        }
    }

    const path = st.path;
    if (!path || path.length === 0) { blockAgent(st, 'пустой путь'); return; }

    let idx = Math.min(st.index, path.length - 1);
    let wp = path[idx];
    let dx = wp.x - node.x;
    let dy = wp.y - node.y;
    let d = Math.hypot(dx, dy);

    // Проходим промежуточные точки, до которых уже добрались, за один кадр:
    // иначе на высокой скорости агент «залипал» бы на каждой из них.
    let guard = 0;
    while (idx < path.length - 1 && d <= o.waypointRadius && guard++ < path.length) {
        idx++;
        wp = path[idx];
        dx = wp.x - node.x;
        dy = wp.y - node.y;
        d = Math.hypot(dx, dy);
    }
    st.index = idx;
    if (idx >= path.length - 1 && d <= o.stopDistance) { arriveAgent(st); return; }
    if (d < 1e-6) return;

    let ux = dx / d;
    let uy = dy / d;
    const off = avoidanceOffset(st, node);
    if (off) {
        ux += off.x * 0.6;
        uy += off.y * 0.6;
        const m = Math.hypot(ux, uy) || 1;
        ux /= m;
        uy /= m;
    }

    if (node.body >= 0) {
        engine.setVelocity(node.body, ux * o.speed, uy * o.speed);
    } else {
        // У узла без тела нет инерции: двигаем ровно на шаг кадра.
        const stepLen = Math.min(o.speed * dt, d);
        node.x += ux * stepLen;
        node.y += uy * stepLen;
    }
}

function startAgent(node, target, opts) {
    if (!node) return;
    const ref = target;
    const p = resolveTarget(ref);
    if (!p) {
        ctx.log('$.nav.navigateTo: цель непонятна — нужен узел, id, селектор или { x, y }');
        return;
    }
    const source = resolveSource(opts);
    if (!source) {
        ctx.log('$.nav.navigateTo: нет источника пути — создайте сетку $.nav.grid({ x, y, w, h, cell }) ' +
            'или навмеш $.nav.mesh({ x, y, w, h, cell })');
        return;
    }
    stopAgent(node);
    const st = {
        node,
        target_ref: ref,
        target: { x: p.x, y: p.y },
        source,
        opts: normalizeOpts(opts, source),
        path: [],
        index: 0,
        repath_timer: 0,
        time: 0,
        last_goal: { x: p.x, y: p.y },
    };
    agents.push(st);
    agent_index.set(node, st);
    if (!buildPath(st, p)) {
        blockAgent(st, 'путь к цели не найден');
    }
}

function stopAgent(node) {
    const st = findAgent(node);
    if (!st) return;
    if (st.node.body >= 0) engine.setVelocity(st.node.body, 0, 0);
    removeAgent(st);
}

function forceRepath(node) {
    const st = findAgent(node);
    if (!st) return;
    const t = resolveTarget(st.target_ref) || st.target;
    if (!buildPath(st, t)) blockAgent(st, 'путь к цели не найден');
}

// ---------------------------------------------------------------------------
// Публичные функции подсистемы
// ---------------------------------------------------------------------------

/**
 * Шаг кадра: двигает всех активных агентов. Вызывается из api.js после
 * частиц и до слоёв — поэтому агент успевает поменять скорость до интеграции
 * физики в следующем кадре.
 */
export function tickNav(dt) {
    if (agents.length === 0) return;
    const step = dt > 0 ? dt : (engine.dt || 1 / 60);
    for (let i = agents.length - 1; i >= 0; i--) {
        const st = agents[i];
        const node = st.node;
        if (!node || node.removed || (node.max_hp > 0 && node.cur_hp <= 0)) {
            removeAgent(st);
            continue;
        }
        try {
            stepAgent(st, node, step);
        } catch (e) {
            ctx.log(`$.nav: ошибка агента <${node.tag}>: ${e}`);
            removeAgent(st);
        }
    }
}

export function installNav($) {
    const nav = {
        /**
         * Создать сетку навигации. x/y — левый верхний угол, w/h — размеры в
         * мировых пикселях. Первая созданная сетка становится сеткой по
         * умолчанию для $.nav.path.
         */
        grid(opts) {
            const g = makeGrid(opts);
            if (!g) {
                ctx.log('$.nav.grid: нужны w и h — размеры области в пикселях');
                return null;
            }
            state.grids.push(g);
            if (!state.default_grid) state.default_grid = g;
            return g;
        },

        /** Назначить сетку по умолчанию для $.nav.path без opts.grid. */
        use(grid) {
            const g = resolveGrid(grid);
            if (!g) { ctx.log('$.nav.use: неизвестная сетка'); return nav; }
            state.default_grid = g;
            return nav;
        },

        /** Все созданные сетки (копия массива). */
        grids() { return state.grids.slice(); },

        /** Убрать все сетки и навмеши. */
        clear() {
            state.grids.length = 0;
            state.default_grid = null;
            state.meshes.length = 0;
            state.default_mesh = null;
            return nav;
        },

        /**
         * Создать навмеш — прямоугольную декомпозицию области (не триангуляцию,
         * см. docs/highlevel/nav.md). Как и сетка, сам по себе пуст: заполните
         * его `mesh.buildFromWalls({ tags, agentRadius })` или вручную
         * `mesh.blockAt(...)`. Навмеш по умолчанию не подменяет сетку — для
         * этого вызовите $.nav.useMesh(mesh).
         */
        mesh(opts) {
            const m = makeMesh(opts);
            if (!m) {
                ctx.log('$.nav.mesh: нужны w и h — размеры области в пикселях');
                return null;
            }
            state.meshes.push(m);
            return m;
        },

        /** Назначить навмеш по умолчанию для агента и $.nav.meshPath. */
        useMesh(mesh) {
            const m = resolveMesh(mesh);
            if (!m) { ctx.log('$.nav.useMesh: неизвестный навмеш'); return nav; }
            state.default_mesh = m;
            return nav;
        },

        /** Все созданные навмеши (копия массива). */
        meshes() { return state.meshes.slice(); },

        /** Путь в мировых точках по навмешу по умолчанию (или opts.mesh). */
        meshPath(from, to, opts) {
            const o = opts || {};
            const m = resolveMesh(o.mesh);
            if (!m) {
                ctx.log('$.nav.meshPath: нет навмеша — создайте его через $.nav.mesh({ x, y, w, h, cell })');
                return null;
            }
            return pathOnMesh(m, from, to, o);
        },

        /** Путь по конкретному навмешу. */
        meshPathOn(mesh, from, to, opts) {
            if (!isMeshLike(mesh)) {
                ctx.log('$.nav.meshPathOn: первым аргументом нужен навмеш из $.nav.mesh(...)');
                return null;
            }
            return pathOnMesh(mesh, from, to, opts || {});
        },

        /** Путь в мировых точках по сетке по умолчанию (или opts.grid). */
        path(from, to, opts) {
            const o = opts || {};
            const grid = resolveGrid(o.grid);
            if (!grid) {
                ctx.log('$.nav.path: нет сетки — создайте её через $.nav.grid({ x, y, w, h, cell })');
                return null;
            }
            return pathOnGrid(grid, from, to, o);
        },

        /** Путь по конкретной сетке. */
        pathOn(grid, from, to, opts) {
            if (!isGridLike(grid)) {
                ctx.log('$.nav.pathOn: первым аргументом нужна сетка из $.nav.grid(...)');
                return null;
            }
            return pathOnGrid(grid, from, to, opts || {});
        },

        /** Прямая видимость между точками по сетке (без физики). */
        lineOfSight(from, to, grid) {
            return lineOfSight(from, to, resolveGrid(grid));
        },

        // Чистые функции — наружу, чтобы игру и тесты было не обмануть.
        astar,
        smoothPath,
        decomposeRects,
        buildPortalGraph,
        funnel,

        /** Ручной шаг навигации (обычно не нужен: tickNav зовёт api.js). */
        tick(dt) { tickNav(dt); },
    };

    $.nav = nav;
    ctx.nav = nav;

    // --- Методы узла ------------------------------------------------------
    // Имена не пересекаются со списком занятых имён в _CONTRACT.md §5
    // (moveTo/moveTowards/lookAt/pos/closest и т. п. не трогаем).

    def('navigateTo', function (target, opts) {
        for (const node of this.nodes) startAgent(node, target, opts);
        return this;
    });

    def('stopNav', function () {
        for (const node of this.nodes) stopAgent(node);
        return this;
    });

    /** Принудительно пересчитать путь прямо сейчас. */
    def('repath', function () {
        for (const node of this.nodes) forceRepath(node);
        return this;
    });

    defGet('navPath', (node) => {
        const st = findAgent(node);
        return st ? st.path.map((p) => ({ x: p.x, y: p.y })) : [];
    }, []);

    defGet('navTarget', (node) => {
        const st = findAgent(node);
        return st ? { x: st.target.x, y: st.target.y } : null;
    }, null);

    defGet('isNavigating', (node) => !!findAgent(node), false);

    return nav;
}
