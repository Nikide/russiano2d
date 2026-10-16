// ===========================================================================
// TileMap: <tilemap> — тайловая карта в духе TileMapLayer + TileSet из Godot 4.
//
// Зачем отдельный модуль: у карты 200×200 общий прямоугольник узла совпадает с
// её габаритом, и рисовать все 40 000 тайлов нельзя. Поэтому модуль:
//   * сам считает видимый диапазон по камере и рисует только его;
//   * хранит данные слоёв в Int32Array (плоско, без объектов на тайл);
//   * склеивает непроходимые тайлы в горизонтальные полосы и заводит на полосу
//     одно статическое тело — сотни тел вместо одной карты Box2D «не ест».
//
// Система координат: x/y узла — центр карты, тайл (0,0) — её левый верхний
// угол. Так карта ведёт себя как любой другой узел: .at() ставит центр.
//
// Чистые помощники (маска автотайла, террейны, видимые тайлы для Y-sort,
// разбор ASCII, полосы коллизий, перевод координат) экспортированы наружу:
// их проверяет qjs-харнесс без движка.
// ===========================================================================

import { engine } from './native.js';
import { ctx, Wrapper, TAGS, wrapOne, query, def, defGet, withAlpha, fxRandom,
         nodesByTag } from './core.js';
import { registerNodeRenderer, nativeTiles, blendIndex } from './render.js';
import { cameraTransform } from './camera.js';

// ---------------------------------------------------------------------------
// Соседи и битовые маски
//
// bit16  (4 направления): N=1, E=2, S=4, W=8 — 16 вариантов, тайл = base+маска.
// blob47 (8 направлений): N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128.
//   Диагональ влияет на форму только тогда, когда есть оба смежных
//   ортогональных соседа (внутренний угол). Это даёт ровно 47 различимых
//   конфигураций — классический «blob»-набор.
// ---------------------------------------------------------------------------

export const NEIGHBOURS16 = [
    { bit: 1, dx: 0, dy: -1 },   // N
    { bit: 2, dx: 1, dy: 0 },    // E
    { bit: 4, dx: 0, dy: 1 },    // S
    { bit: 8, dx: -1, dy: 0 },   // W
];

export const NEIGHBOURS47 = [
    { bit: 1, dx: 0, dy: -1 },    // N
    { bit: 2, dx: 1, dy: -1 },    // NE
    { bit: 4, dx: 1, dy: 0 },     // E
    { bit: 8, dx: 1, dy: 1 },     // SE
    { bit: 16, dx: 0, dy: 1 },    // S
    { bit: 32, dx: -1, dy: 1 },   // SW
    { bit: 64, dx: -1, dy: 0 },   // W
    { bit: 128, dx: -1, dy: -1 }, // NW
];

// Ключи, по которым fromASCII отличает opts от легенды символов.
const OPTION_KEYS = ['src', 'tile', 'cols', 'rows', 'data', 'solid', 'layers',
                     'mapW', 'mapH', 'id', 'depth', 'legend', 'x', 'y', 'visible', 'class',
                     'terrains', 'ysort', 'tiles', 'sources', 'origin', 'pad', 'padTile',
                     'limitPolicy', 'agentSize', 'agentRadius'];

/**
 * Маска соседей вокруг тайла (tx, ty). Чистая функция: isSolid(nx, ny) решает,
 * считается ли сосед непроходимым. border — «за границей карты всё сплошное»
 * (удобно для стен по краю уровня).
 *
 * opts: { mode: 'bit16' | 'blob47', border, cols, rows }.
 */
export function autotileMask(isSolid, tx, ty, opts) {
    const o = opts || {};
    const dirs = o.mode === 'blob47' ? NEIGHBOURS47 : NEIGHBOURS16;
    const border = !!o.border;
    const cols = o.cols | 0;
    const rows = o.rows | 0;
    let mask = 0;
    for (const d of dirs) {
        const nx = tx + d.dx;
        const ny = ty + d.dy;
        const outside = nx < 0 || ny < 0 || nx >= cols || ny >= rows;
        const solid = outside ? border : !!isSolid(nx, ny);
        if (solid) mask |= d.bit;
    }
    return mask;
}

/** Канонический ключ формы для blob47: края + только «подкреплённые» углы. */
function blobKey(mask) {
    const N = mask & 1, NE = mask & 2, E = mask & 4, SE = mask & 8;
    const S = mask & 16, SW = mask & 32, W = mask & 64, NW = mask & 128;
    const edge = (N ? 1 : 0) | (E ? 2 : 0) | (S ? 4 : 0) | (W ? 8 : 0);
    const cNE = (N && E && NE) ? 16 : 0;
    const cSE = (E && S && SE) ? 32 : 0;
    const cSW = (S && W && SW) ? 64 : 0;
    const cNW = (W && N && NW) ? 128 : 0;
    return edge | cNE | cSE | cSW | cNW;
}

// Таблица 256 → 0..46 строится детерминированно: идём по маскам от 0 к 255 и
// выдаём номер новой встреченной формы. Порядок фиксирован навсегда, поэтому
// тайлсет, собранный под этот порядок, не «поедет» между запусками.
const BLOB47 = (() => {
    const map = new Int32Array(256);
    const layout = [];
    const seen = new Map();
    for (let mask = 0; mask < 256; mask++) {
        const key = blobKey(mask);
        if (!seen.has(key)) { seen.set(key, layout.length); layout.push(key); }
        map[mask] = seen.get(key);
    }
    return { map, layout };
})();

/** Номер тайла (0..46) в раскладке blob47 для 8-битной маски соседей. */
export function blob47Index(mask) { return BLOB47.map[mask & 255]; }

/** Раскладка 47 форм: BLOB47_LAYOUT[i] — канонический ключ тайла с номером i. */
export const BLOB47_LAYOUT = BLOB47.layout;

/** Итоговый визуальный тайл по маске. base — id первого тайла набора. */
export function autotileTile(mask, opts) {
    const o = opts || {};
    const base = o.base === undefined ? 1 : o.base | 0;
    if (o.mode === 'blob47') return base + blob47Index(mask);
    return base + (mask & 0x0f);
}

// ---------------------------------------------------------------------------
// Террейны (terrain sets)
//
// Идея взята из terrain sets Godot: у набора есть правила связности (кто
// считается «своим» для соседа) и таблица переходов «маска → тайл». Маска
// считается теми же bit16/blob47, что и в автотайле, поэтому террейны — это
// надстройка над существующим автотайлом, а не второй алгоритм.
//
// Таблица переходов — обычный объект. Ключ для bit16 — сама маска 0..15,
// для blob47 — канонический ключ формы (см. terrainKey). Если ключа нет,
// берётся тайл из общей раскладки: base + номер формы. Так набор можно
// задавать частично: «особые» переходы перечислить, остальное — по сетке.
// ---------------------------------------------------------------------------

/**
 * Канонический ключ маски для таблицы переходов: bit16 — маска 0..15,
 * blob47 — ключ формы (256 масок сворачиваются в 47 ключей).
 */
export function terrainKey(mask, mode) {
    return mode === 'blob47' ? blobKey(mask & 255) : (mask & 0x0f);
}

/**
 * Приводит описание террейна к единому виду. Не мутирует вход: набор можно
 * безопасно хранить в данных карты и отдавать наружу.
 *   { name, mode, base, border, solid, transitions }
 */
export function normalizeTerrain(spec) {
    const s = spec || {};
    const src = s.transitions || s.tiles || {};
    const transitions = {};
    for (const key of Object.keys(src)) {
        transitions[key] = src[key] | 0;
    }
    return {
        name: s.name === undefined ? 'default' : String(s.name),
        mode: s.mode === 'blob47' ? 'blob47' : 'bit16',
        base: s.base === undefined ? 1 : s.base | 0,
        border: !!s.border,
        // solid не задан — «своим» считается любой непустой тайл; это же
        // значение по умолчанию и у обычного автотайла.
        solid: s.solid === undefined ? true : s.solid,
        transitions,
    };
}

/**
 * Тайл террейна по маске соседей. set — нормализованный или «сырой» набор;
 * ключ таблицы переходов важнее общей раскладки.
 */
export function terrainTile(mask, set) {
    const s = set || {};
    const mode = s.mode === 'blob47' ? 'blob47' : 'bit16';
    const table = s.transitions || s.tiles;
    if (table) {
        const key = terrainKey(mask, mode);
        if (table[key] !== undefined) return table[key] | 0;
    }
    const base = s.base === undefined ? 1 : s.base | 0;
    return base + (mode === 'blob47' ? blob47Index(mask) : (mask & 0x0f));
}

// ---------------------------------------------------------------------------
// Дескриптор тайла: visual region, локальная геометрия коллизии, маски, occluder
//
// Клетка — не всегда весь тайл: у тонкой платформы картинка 32×32, а тело —
// полоса внизу клетки. Поэтому у тайлсета может быть таблица `tiles`:
// id → дескриптор с visual region/source, локальной геометрией коллизии,
// масками и геометрией occluder (см. docs/highlevel/tilemap.md §13).
//
// Локальная система координат — ЦЕНТР клетки, пиксели, Y вниз. Поэтому
// «visual 32×32, physical rect [-16,8]..[16,16]» — это полоса 32×8 в нижней
// части клетки, а верхние 24 px клетки свободны для тела и луча.
//
// Полная клетка (`shape: 'full'`, по умолчанию) остаётся быстрым случаем: она
// сливается тем же жадным алгоритмом, что и раньше (solidRects). Частичная
// геометрия сливается только тогда, когда объединение соседних одинаковых
// прямоугольников ТОЧНО равно прямоугольнику: иначе в мире появилась бы
// невидимая коллизия (непрозрачная картинка ≠ непроходимый тайл).
// ---------------------------------------------------------------------------

/** Допуск сравнения геометрии: размеры в пикселях, значения — обычно целые. */
const GEOM_EPS = 1e-6;

/** Прямоугольник [x0,y0,x1,y1] из описания или null. */
function toRect(spec) {
    if (!spec) return null;
    if (Array.isArray(spec)) {
        if (spec.length < 4) return null;
        const r = [Number(spec[0]), Number(spec[1]), Number(spec[2]), Number(spec[3])];
        for (const v of r) if (!isFinite(v)) return null;
        return r;
    }
    if (typeof spec !== 'object') return null;
    if (spec.rect !== undefined) return toRect(spec.rect);
    if (spec.x0 !== undefined || spec.y0 !== undefined) {
        const r = [Number(spec.x0), Number(spec.y0), Number(spec.x1), Number(spec.y1)];
        for (const v of r) if (!isFinite(v)) return null;
        return r;
    }
    const w = Number(spec.w), h = Number(spec.h);
    if (!isFinite(w) || !isFinite(h)) return null;
    if (spec.cx !== undefined || spec.cy !== undefined) {
        const cx = Number(spec.cx) || 0, cy = Number(spec.cy) || 0;
        return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
    }
    const x = Number(spec.x) || 0, y = Number(spec.y) || 0;
    return [x, y, x + w, y + h];
}

/** Список прямоугольников из описания (одна форма или массив форм). */
function toRects(spec) {
    if (spec === undefined || spec === null || spec === false) return null;
    if (Array.isArray(spec) && spec.length > 0 && Array.isArray(spec[0])) {
        const out = [];
        for (const item of spec) {
            const r = toRect(item);
            if (r) out.push(r);
        }
        return out.length ? out : null;
    }
    if (Array.isArray(spec) && spec.length === 4 && typeof spec[0] === 'number') {
        const r = toRect(spec);
        return r ? [r] : null;
    }
    if (typeof spec === 'object' && Array.isArray(spec.rects)) return toRects(spec.rects);
    const r = toRect(spec);
    return r ? [r] : null;
}

/** Полная клетка как форма: локальный прямоугольник от -t/2 до +t/2. */
function fullShape(tile) {
    const h = tile / 2;
    return { full: true, rects: [[-h, -h, h, h]] };
}

/** Форма из описания: 'full' | 'none' | rect | rects | {…}. null — формы нет. */
function normalizeShape(spec, tile) {
    if (spec === 'none' || spec === false || spec === null) return null;
    if (spec === undefined || spec === true || spec === 'full') return fullShape(tile);
    const rects = toRects(spec);
    if (!rects || !rects.length) return null;
    const h = tile / 2;
    const full = rects.length === 1 && Math.abs(rects[0][0] + h) < GEOM_EPS
        && Math.abs(rects[0][1] + h) < GEOM_EPS
        && Math.abs(rects[0][2] - h) < GEOM_EPS
        && Math.abs(rects[0][3] - h) < GEOM_EPS;
    return { full, rects };
}

/** Visual region: [tx,ty,w,h] | [source,tx,ty,w,h] | { source, tx, ty, w, h }. */
function normalizeVisual(spec) {
    if (!spec) return null;
    let source = 0, tx = 0, ty = 0, w = 0, h = 0;
    if (Array.isArray(spec)) {
        if (spec.length === 4) { tx = spec[0] | 0; ty = spec[1] | 0; w = spec[2] | 0; h = spec[3] | 0; }
        else if (spec.length >= 5) { source = spec[0] | 0; tx = spec[1] | 0; ty = spec[2] | 0; w = spec[3] | 0; h = spec[4] | 0; }
        else return null;
    } else if (typeof spec === 'object') {
        const region = Array.isArray(spec.region) ? spec.region : null;
        source = (spec.source === undefined ? (spec.atlas === undefined ? 0 : spec.atlas) : spec.source) | 0;
        if (region) { tx = region[0] | 0; ty = region[1] | 0; w = region[2] | 0; h = region[3] | 0; }
        else {
            tx = (spec.tx === undefined ? spec.x : spec.tx) | 0;
            ty = (spec.ty === undefined ? spec.y : spec.ty) | 0;
            w = spec.w | 0;
            h = spec.h | 0;
        }
    } else return null;
    if (!(w > 0) || !(h > 0)) return null;
    return { source: source < 0 ? 0 : source, tx, ty, w, h };
}

/** Маски/флаги тела. null — «как у всех» (умолчания движка). */
function normalizeFilter(raw) {
    let out = null;
    for (const key of ['layerBits', 'mask', 'group', 'oneWay', 'oneWayAngle', 'sensor']) {
        if (raw[key] === undefined || raw[key] === null) continue;
        if (!out) out = {};
        if (key === 'oneWay' || key === 'sensor') out[key] = !!raw[key];
        else out[key] = Number(raw[key]) || 0;
    }
    return out;
}

/**
 * Приводит дескриптор тайла к единому виду. Чистая функция: ни узлов, ни
 * движка — её проверяет qjs-харнесс.
 *
 * Вход — короткая форма `[x0,y0,x1,y1]` (геометрия) или объект:
 *   { solid, shape, visual, occluder, layerBits, mask, group, oneWay, sensor, tags }
 * Выход — `{ solid, shape: { full, rects }, visual, occluder, filter, tags, key }`,
 * где `key` — сигнатура «геометрия + маски», по ней идёт слияние: сливаются
 * только действительно эквивалентные соприкасающиеся формы.
 */
export function normalizeTileDef(spec, tile) {
    const t = tile > 0 ? tile : 32;
    let raw = spec;
    if (Array.isArray(spec) && spec.length === 4 && typeof spec[0] === 'number') raw = { shape: spec };
    if (raw === undefined || raw === null) raw = {};
    if (typeof raw !== 'object') raw = {};

    const shapeDeclared = raw.shape !== undefined;
    let shape = normalizeShape(shapeDeclared ? raw.shape : 'full', t);
    const solidFlag = raw.solid;
    const solid = solidFlag === undefined ? (shape !== null) : !!solidFlag;
    if (solid && !shape) shape = fullShape(t);
    if (!solid) shape = null;

    const visual = normalizeVisual(raw.visual);
    let occluder = null;
    if (raw.occluder === undefined) {
        // По умолчанию occluder повторяет геометрию коллизии: «картинка» и
        // «свет» не должны расходиться с физикой (§42).
        occluder = shape ? { rects: shape.rects } : null;
    } else if (raw.occluder !== false && raw.occluder !== null && raw.occluder !== 'none') {
        if (raw.occluder === true || raw.occluder === 'shape' || raw.occluder === 'collision') {
            occluder = shape ? { rects: shape.rects } : null;
        } else if (raw.occluder === 'visual') {
            occluder = visual ? { rects: [[-visual.w / 2, -visual.h / 2, visual.w / 2, visual.h / 2]] } : null;
        } else {
            const rects = toRects(raw.occluder);
            occluder = rects && rects.length ? { rects } : null;
        }
    }

    const filter = normalizeFilter(raw);
    const key = (shape ? (shape.full ? 'F' : 'R' + shape.rects.map((r) => r.join(',')).join(';')) : 'N')
        + '|' + (filter ? JSON.stringify(filter) : '')
        + '|' + (raw.tags === undefined ? '' : JSON.stringify(raw.tags));

    return {
        solid,
        shape,
        visual,
        occluder,
        filter,
        tags: raw.tags === undefined ? null : raw.tags,
        key,
    };
}

/** Максимальный «выход» локальной геометрии за клетку, в клетках. */
function shapePad(defs, tile) {
    if (!defs) return 0;
    const h = tile / 2;
    let pad = 0;
    for (const id of Object.keys(defs)) {
        const shape = defs[id].shape;
        if (!shape) continue;
        for (const r of shape.rects) {
            pad = Math.max(pad, h - r[0], r[2] - h, h - r[1], r[3] - h, 0);
        }
    }
    return Math.ceil(pad / tile - GEOM_EPS);
}

/**
 * Тела коллизии по дескрипторам клеток.
 *
 * `cellAt(tx, ty)` возвращает дескриптор (normalizeTileDef) или null; координаты
 * клеток — буферные (0..cols-1), без логического origin. Результат — список
 * прямоугольников в ПИКСЕЛЯХ относительно левого верхнего угла буфера:
 *   { lx, ly, w, h, def, tx, ty, nx, ny }
 *
 * Слияние: клетки с одинаковой сигнатурой (`def.key`). Полная клетка
 * сливается как раньше (вправо, потом вниз). Частичная форма сливается по оси
 * только если её размер по этой оси равен тайлу: тогда соседние копии
 * соприкасаются, и объединение ТОЧНО равно прямоугольнику. Иначе каждая форма
 * остаётся собой — расширять тело до размера клетки нельзя.
 *
 * `opts.merge === false` — без слияния (по телу на форму в клетке).
 * Чистая функция: проверяется qjs-харнессом.
 */
export function collisionShapes(cols, rows, tile, cellAt, opts) {
    const c = cols | 0, r = rows | 0;
    const t = tile > 0 ? tile : 32;
    const half = t / 2;              // локальная геометрия считается от центра
    const merge = !(opts && opts.merge === false);
    const out = [];
    if (c <= 0 || r <= 0 || typeof cellAt !== 'function') return out;

    const groups = new Map();
    for (let y = 0; y < r; y++) {
        for (let x = 0; x < c; x++) {
            const def = cellAt(x, y);
            if (!def || !def.shape) continue;
            let g = groups.get(def.key);
            if (!g) { g = { def, mask: new Uint8Array(c * r) }; groups.set(def.key, g); }
            g.mask[y * c + x] = 1;
        }
    }

    for (const g of groups.values()) {
        const rects = g.def.shape.rects;
        const single = rects.length === 1 ? rects[0] : null;
        const sw = single ? single[2] - single[0] : 0;
        const sh = single ? single[3] - single[1] : 0;
        const allowX = merge && !!single && sw >= t - GEOM_EPS;
        const allowY = merge && !!single && sh >= t - GEOM_EPS;
        if (!allowX && !allowY) {
            // Каждая форма — своё тело: объединять нечего (или не с чем).
            for (let y = 0; y < r; y++) {
                for (let x = 0; x < c; x++) {
                    if (!g.mask[y * c + x]) continue;
                    for (const rect of rects) {
                        out.push({
                            lx: x * t + half + rect[0], ly: y * t + half + rect[1],
                            w: rect[2] - rect[0], h: rect[3] - rect[1],
                            def: g.def, tx: x, ty: y, nx: 1, ny: 1,
                        });
                    }
                }
            }
            continue;
        }
        const used = new Uint8Array(c * r);
        for (let y = 0; y < r; y++) {
            for (let x = 0; x < c; x++) {
                const idx = y * c + x;
                if (!g.mask[idx] || used[idx]) continue;
                let nx = 1;
                while (allowX && x + nx < c && g.mask[idx + nx] && !used[idx + nx]) nx++;
                let ny = 1;
                if (allowY) {
                    while (y + ny < r) {
                        const base = (y + ny) * c + x;
                        let full = true;
                        for (let i = 0; i < nx; i++) {
                            if (!g.mask[base + i] || used[base + i]) { full = false; break; }
                        }
                        if (!full) break;
                        ny++;
                    }
                }
                for (let yy = 0; yy < ny; yy++) {
                    const base = (y + yy) * c + x;
                    for (let i = 0; i < nx; i++) used[base + i] = 1;
                }
                out.push({
                    lx: x * t + half + single[0], ly: y * t + half + single[1],
                    w: sw + (nx - 1) * t, h: sh + (ny - 1) * t,
                    def: g.def, tx: x, ty: y, nx, ny,
                });
            }
        }
    }

    // Канонический порядок: сверху вниз, слева направо. Он же был у solidRects —
    // повторная сборка не меняет ни число тел, ни их порядок.
    out.sort((a, b) => (a.ly - b.ly) || (a.lx - b.lx));
    return out;
}

/**
 * Проходит ли прямоугольник (центр x,y, полуразмеры hw,hh) сквозь реальную
 * геометрию слоя. `rectsAt(tx, ty)` — локальные прямоугольники клетки или null.
 * Касание границы не считается пересечением (§6.1).
 *
 * Чистая функция: проверяется qjs-харнессом.
 */
export function shapeBoxBlocked(layer, rectsAt, left, top, x, y, hw, hh) {
    const tile = layer && layer.tile > 0 ? layer.tile : 32;
    const pad = layer && layer.shape_pad ? layer.shape_pad : 0;
    const rx = cellRange(x - hw, x + hw, left, tile);
    const ry = cellRange(y - hh, y + hh, top, tile);
    if (!rx || !ry) return false;
    for (let ty = ry[0] - pad; ty <= ry[1] + pad; ty++) {
        for (let tx = rx[0] - pad; tx <= rx[1] + pad; tx++) {
            const rects = rectsAt(tx, ty);
            if (!rects) continue;
            // Локальная геометрия — от ЦЕНТРА клетки, поэтому +полтайла.
            const bx = left + tx * tile + tile / 2, by = top + ty * tile + tile / 2;
            for (const r of rects) {
                const sx0 = bx + r[0], sy0 = by + r[1];
                const sx1 = bx + r[2], sy1 = by + r[3];
                if (x - hw < sx1 && sx0 < x + hw && y - hh < sy1 && sy0 < y + hh) return true;
            }
        }
    }
    return false;
}

/**
 * Отрезки-препятствия для освещения по РЕАЛЬНОЙ геометрии клеток.
 *
 * Наружу выходят только те рёбра формы, за которыми пусто; ребро, к которому
 * вплотную прижата такая же форма соседней клетки, пропускается. Так у ряда
 * тонких платформ остаются верх, низ и торцы, а не 4 ребра на каждую клетку.
 * `cellAt(tx, ty)` — `{ rects }` (локальные, центр клетки) или null.
 * left/top — мировые координаты левого верхнего угла буфера.
 *
 * Чистая функция: проверяется qjs-харнессом.
 */
export function shapeOccluders(cols, rows, tile, cellAt, left, top) {
    const c = cols | 0, r = rows | 0;
    const t = tile > 0 ? tile : 32;
    const h = t / 2;
    const out = [];
    if (c <= 0 || r <= 0 || typeof cellAt !== 'function') return out;
    const ox = left || 0, oy = top || 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= c || y >= r) ? null : cellAt(x, y);
    // Ребро может закрыть только соседняя клетка, и только если ребро формы
    // лежит РОВНО на общей границе клеток: форма, «утопленная» внутрь клетки
    // (полоса тонкой платформы), соседом не перекрывается — её ребро видно.
    // У соседа при этом должна быть форма, прижатая к той же границе и
    // накрывающая ребро целиком.
    const hidden = (list, which, rect) => {
        if (!list || !list.rects) return false;
        for (const n of list.rects) {
            if (which === 'top') {
                if (Math.abs(rect[1] + h) < GEOM_EPS && Math.abs(n[3] - h) < GEOM_EPS
                    && n[0] <= rect[0] + GEOM_EPS && n[2] >= rect[2] - GEOM_EPS) return true;
            } else if (which === 'bottom') {
                if (Math.abs(rect[3] - h) < GEOM_EPS && Math.abs(n[1] + h) < GEOM_EPS
                    && n[0] <= rect[0] + GEOM_EPS && n[2] >= rect[2] - GEOM_EPS) return true;
            } else if (which === 'left') {
                if (Math.abs(rect[0] + h) < GEOM_EPS && Math.abs(n[2] - h) < GEOM_EPS
                    && n[1] <= rect[1] + GEOM_EPS && n[3] >= rect[3] - GEOM_EPS) return true;
            } else if (Math.abs(rect[2] - h) < GEOM_EPS && Math.abs(n[0] + h) < GEOM_EPS
                       && n[1] <= rect[1] + GEOM_EPS && n[3] >= rect[3] - GEOM_EPS) return true;
        }
        return false;
    };
    for (let ty = 0; ty < r; ty++) {
        for (let tx = 0; tx < c; tx++) {
            const cell = cellAt(tx, ty);
            if (!cell || !cell.rects) continue;
            const bx = ox + tx * t + h, by = oy + ty * t + h;
            for (const rect of cell.rects) {
                const x0 = bx + rect[0], y0 = by + rect[1], x1 = bx + rect[2], y1 = by + rect[3];
                if (!hidden(at(tx, ty - 1), 'top', rect)) out.push(x0, y0, x1, y0);
                if (!hidden(at(tx, ty + 1), 'bottom', rect)) out.push(x0, y1, x1, y1);
                if (!hidden(at(tx - 1, ty), 'left', rect)) out.push(x0, y0, x0, y1);
                if (!hidden(at(tx + 1, ty), 'right', rect)) out.push(x1, y0, x1, y1);
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Данные карты
// ---------------------------------------------------------------------------

/** Символ → id тайла. Легенда важнее цифр: '#': 1 перекрывает '1' → 1. */
function charTileId(ch, legend) {
    if (ch === undefined || ch === '\r' || ch === '\n') return 0;
    if (legend && legend[ch] !== undefined) return legend[ch] | 0;
    if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
    return 0;
}

/**
 * Массив строк + легенда → плоские данные. Пустые строки допустимы: короткая
 * строка дополняется нулями до самой длинной.
 * opts: { w } — принудительная ширина (если строки разной длины).
 */
export function asciiToData(rows, legend, opts) {
    const o = opts || {};
    const list = Array.isArray(rows) ? rows.map((r) => String(r)) : String(rows).split(/\r?\n/);
    const h = list.length;
    let w = o.w | 0;
    if (!w) for (const row of list) w = Math.max(w, row.length);
    const out = new Int32Array(w * h);
    for (let y = 0; y < h; y++) {
        const row = list[y];
        for (let x = 0; x < w; x++) out[y * w + x] = charTileId(row[x], legend);
    }
    return { data: out, w, h };
}

function toInt32(source) {
    const out = new Int32Array(source ? source.length : 0);
    if (source) for (let i = 0; i < source.length; i++) out[i] = source[i] | 0;
    return out;
}

// ---------------------------------------------------------------------------
// Логические координаты: origin и padding
//
// Генератору нужны клетки левее/выше нуля («граница x=-1») и рамка за основной
// областью. Второй, разреженной карты для этого не нужно: данные остаются
// finite array, а за координаты отвечают два поля:
//   * `origin: [ox, oy]` — ЛОГИЧЕСКИЕ координаты клетки data[0];
//   * `pad: n | [l,t,r,b]` — сколько клеток буфера добавить по сторонам
//     (`padTile` — чем заполнить). origin сдвигается на -l/-t, поэтому основная
//     область сохраняет свои логические координаты, а новые клетки создаются
//     ВНУТРИ буфера — писать за его границы не нужно.
// ---------------------------------------------------------------------------

/** padding из описания: число или [left, top, right, bottom]. */
export function normalizePad(spec) {
    if (spec === undefined || spec === null || spec === false) return [0, 0, 0, 0];
    if (typeof spec === 'number') {
        const n = Math.max(0, Math.floor(spec) || 0);
        return [n, n, n, n];
    }
    if (Array.isArray(spec)) {
        return [0, 1, 2, 3].map((i) => {
            const v = Number(spec[i]);
            return isFinite(v) && v > 0 ? Math.floor(v) : 0;
        });
    }
    if (typeof spec === 'object') {
        return ['left', 'top', 'right', 'bottom'].map((k) => {
            const v = Number(spec[k]);
            return isFinite(v) && v > 0 ? Math.floor(v) : 0;
        });
    }
    return [0, 0, 0, 0];
}

/** Заполнение padding: число (все стороны) или [l,t,r,b] id. */
function padTilesOf(spec) {
    if (spec === undefined || spec === null) return [0, 0, 0, 0];
    if (Array.isArray(spec)) return [0, 1, 2, 3].map((i) => Number(spec[i]) | 0);
    const v = Number(spec) | 0;
    return [v, v, v, v];
}

/** Расширяет данные буфером padding. Возвращает { data, w, h, pad }. */
export function applyPadding(norm, pad, padTile) {
    const [l, top, r, bottom] = pad;
    if (!(l || top || r || bottom)) return { data: norm.data, w: norm.w, h: norm.h, pad };
    const w = norm.w + l + r;
    const h = norm.h + top + bottom;
    const out = new Int32Array(w * h);
    if (padTile) {
        const ids = padTilesOf(padTile);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const side = y < top ? 1 : (y >= top + norm.h ? 3 : (x < l ? 0 : (x >= l + norm.w ? 2 : -1)));
                out[y * w + x] = side < 0 ? 0 : ids[side];
            }
        }
    }
    for (let y = 0; y < norm.h; y++) {
        const from = y * norm.w;
        out.set(norm.data.subarray(from, from + norm.w), (y + top) * w + l);
    }
    return { data: out, w, h, pad };
}

function isTypedArray(value) {
    return !!value && typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function'
        && ArrayBuffer.isView(value) && typeof value.length === 'number';
}

/**
 * Приводит `data` к { data: Int32Array, w, h }. Понимает:
 *   * плоский массив чисел (нужен opts.w — ширина карты в тайлах);
 *   * массив строк (ASCII, символы → id, при opts.legend — по легенде);
 *   * массив массивов (строки карты);
 *   * Int32Array;
 *   * строку с переводами строк.
 */
export function normalizeTileData(data, opts) {
    const o = opts || {};
    if (data && typeof data === 'object' && data.data !== undefined && data.w !== undefined) {
        return { data: toInt32(data.data), w: data.w | 0, h: data.h | 0 };
    }
    if (typeof data === 'string') return asciiToData(data.split(/\r?\n/), o.legend, o);

    // Типизированный массив — уже готовые плоские данные (частый случай после
    // fromASCII или ручного Int32Array). Array.isArray его не видит.
    if (isTypedArray(data)) {
        const n = data.length;
        let tw = (o.w || o.mapW || 0) | 0;
        let th = (o.h || o.mapH || 0) | 0;
        if (!tw && th > 0 && n % th === 0) tw = n / th;
        if (!tw) tw = n;
        if (!th) th = Math.max(1, Math.ceil(n / tw));
        return { data: toInt32(data), w: tw, h: th };
    }

    if (!Array.isArray(data) || data.length === 0) return { data: new Int32Array(0), w: 0, h: 0 };

    if (typeof data[0] === 'string') return asciiToData(data, o.legend, o);

    if (Array.isArray(data[0])) {
        const h = data.length;
        let w = o.w | 0;
        if (!w) for (const row of data) w = Math.max(w, row.length);
        const out = new Int32Array(w * h);
        for (let y = 0; y < h; y++) {
            const row = data[y];
            for (let x = 0; x < w; x++) out[y * w + x] = row[x] === undefined ? 0 : row[x] | 0;
        }
        return { data: out, w, h };
    }

    const n = data.length;
    let w = (o.w || o.mapW || 0) | 0;
    let h = (o.h || o.mapH || 0) | 0;
    if (!w && h > 0 && n % h === 0) w = n / h;
    if (!w) w = n;                       // без ширины считаем данные одной строкой
    if (!h) h = Math.max(1, Math.ceil(n / w));
    const out = new Int32Array(w * h);
    for (let i = 0; i < n && i < out.length; i++) out[i] = data[i] | 0;
    return { data: out, w, h };
}

// ---------------------------------------------------------------------------
// Коллизии: склейка тайлов в прямоугольники
//
// Движок держит не больше R2D_MAX_BODIES (8192) тел одновременно, и при
// переполнении r2d_physics_create просто возвращает -1. Карта 200×100 в
// плотном узоре просит до 10 000 полос — часть тайлов осталась бы БЕЗ
// коллизий, а игрок проваливался бы в «невидимые дыры» (это и был баг:
// checkerboard 200×100 давал 8192 тела из 10000 полос).
//
// Поэтому тела строятся не по горизонтальным полосам, а по прямоугольникам:
// соседние одинаково непроходимые строки склеиваются в один прямоугольник.
// Сплошной блок 200×10 — это одно тело вместо десяти, а число тел на карте
// перестаёт зависеть от её высоты. Геометрия при этом не меняется: объединение
// тех же клеток, только крупнее формы.
// ---------------------------------------------------------------------------

/**
 * Полосы непроходимых тайлов. Горизонтальная склейка как была — годится для
 * отчётов и ручных проверок («сколько полос в слое»). Тела коллизий строятся
 * по `solidRects`.
 * Результат: [{ tx, ty, len }] — начало полосы и длина в тайлах.
 */
export function solidRuns(cols, rows, isSolid) {
    const out = [];
    for (let y = 0; y < rows; y++) {
        let run = -1;
        for (let x = 0; x <= cols; x++) {
            const solid = x < cols && !!isSolid(x, y);
            if (solid && run < 0) run = x;
            else if (!solid && run >= 0) { out.push({ tx: run, ty: y, len: x - run }); run = -1; }
        }
    }
    return out;
}

/**
 * Прямоугольники непроходимых тайлов — жадное слияние «сначала вправо, потом
 * вниз». Обход детерминирован (слева направо, сверху вниз), поэтому одна и та
 * же карта всегда даёт один и тот же список тел.
 *
 * Результат: [{ tx, ty, w, h }] — левый верхний тайл и размеры в тайлах.
 * Покрытие точное: каждая непроходимая клетка попадает ровно в один
 * прямоугольник, ни одна проходимая — ни в один.
 *
 * Чистая функция: ни узлов, ни движка — проверяется qjs-харнессом.
 */
export function solidRects(cols, rows, isSolid) {
    const c = cols | 0, r = rows | 0;
    const out = [];
    if (c <= 0 || r <= 0 || typeof isSolid !== 'function') return out;
    const used = new Uint8Array(c * r);
    for (let y = 0; y < r; y++) {
        for (let x = 0; x < c; x++) {
            const idx = y * c + x;
            if (used[idx] || !isSolid(x, y)) continue;
            // Вправо — пока клетки свободны и непроходимы.
            let w = 1;
            while (x + w < c && !used[idx + w] && isSolid(x + w, y)) w++;
            // Вниз — пока вся строка такой же ширины свободна и непроходима.
            let h = 1;
            while (y + h < r) {
                const base = (y + h) * c + x;
                let full = true;
                for (let i = 0; i < w; i++) {
                    if (used[base + i] || !isSolid(x + i, y + h)) { full = false; break; }
                }
                if (!full) break;
                h++;
            }
            for (let yy = 0; yy < h; yy++) {
                const base = (y + yy) * c + x;
                for (let i = 0; i < w; i++) used[base + i] = 1;
            }
            out.push({ tx: x, ty: y, w, h });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Координаты
//
// Геометрия: { x, y, tile, cols, rows [, origin_x, origin_y, scale_x, scale_y] }.
// x/y — центр карты в мире, cols/rows — размер БУФЕРА в клетках, origin —
// логические координаты клетки data[0] (см. §про padding), scale — масштаб
// узла. world↔cell учитывают всё это: без origin и масштаба формулы прежние.
// ---------------------------------------------------------------------------

/** Масштаб геометрии по оси; 0 и мусор читаются как 1. */
function geomScale(g, axis) {
    const v = axis ? g.scale_y : g.scale_x;
    return typeof v === 'number' && isFinite(v) && v !== 0 ? v : 1;
}

/** Логические координаты клетки data[0]. */
function geomOrigin(g, axis) {
    const v = axis ? g.origin_y : g.origin_x;
    return typeof v === 'number' && isFinite(v) ? Math.round(v) : 0;
}

function geomPixelSize(g, axis) {
    const tile = g.tile || 32;
    const cols = axis ? (g.rows | 0) : (g.cols | 0);
    return cols * tile * Math.abs(geomScale(g, axis));
}

/** Мировые координаты левого верхнего угла буфера. */
function geomLeft(g) { return (g.x || 0) - geomPixelSize(g, 0) / 2; }
function geomTop(g) { return (g.y || 0) - geomPixelSize(g, 1) / 2; }

/** Пиксель → логические координаты клетки. */
export function pixelToTile(geom, x, y) {
    const g = geom || {};
    const tile = g.tile || 32;
    const tw = tile * Math.abs(geomScale(g, 0));
    const th = tile * Math.abs(geomScale(g, 1));
    return {
        tx: Math.floor(((x - geomLeft(g)) / tw)) + geomOrigin(g, 0),
        ty: Math.floor(((y - geomTop(g)) / th)) + geomOrigin(g, 1),
    };
}

/** Центр клетки (логические tx/ty) в мировых координатах. */
export function tileToPixel(geom, tx, ty) {
    const g = geom || {};
    const tile = g.tile || 32;
    const tw = tile * geomScale(g, 0);
    const th = tile * geomScale(g, 1);
    return {
        x: geomLeft(g) + (tx - geomOrigin(g, 0) + 0.5) * tw,
        y: geomTop(g) + (ty - geomOrigin(g, 1) + 0.5) * th,
    };
}

/** Плоский индекс клетки по ЛОГИЧЕСКИМ координатам или -1, если она вне буфера. */
export function tileIndexAt(geom, tx, ty) {
    const g = geom || {};
    const cols = g.cols | 0;
    const rows = g.rows | 0;
    const bx = tx - geomOrigin(g, 0);
    const by = ty - geomOrigin(g, 1);
    if (bx < 0 || by < 0 || bx >= cols || by >= rows) return -1;
    return by * cols + bx;
}

// ---------------------------------------------------------------------------
// Видимые тайлы и Y-sort
//
// Проблема: карта — один узел, а значит в общем списке узлов она занимает одну
// позицию по Y. Для «игрок между тайлами» карте нужно уметь отдавать свои
// тайлы по отдельности вместе с их мировой Y. Тогда сортировка мира по Y
// (`$.world.sort('y')`) может честно чередовать сущности и тайлы.
//
// Здесь только арифметика: какой диапазон тайлов виден камере и в каком
// порядке они идут по Y. Рисование — отдельно (render.js вызывает
// `$.gfx.push`), поэтому функции проверяются qjs-тестом без движка.
//
// Стоимость сбора — O(видимых тайлов), сортировки — слияние уже
// упорядоченных по строкам слоёв, то есть тоже O(видимых тайлов × слоёв) без
// полной сортировки: у слоя тайлы и так идут строками сверху вниз.
// ---------------------------------------------------------------------------

/**
 * Диапазон видимых тайлов слоя в тайловых координатах. geom — поля узла
 * { x, y, w, h, scale_x, scale_y }; cam — { x, y, zoom, w, h, shake_x, shake_y }.
 * Возвращает { x0, y0, x1, y1 } включительно; x1 < x0 — слой вне экрана.
 */
export function visibleRange(layer, geom, cam) {
    const g = geom || {};
    const c = cam || {};
    const tile = layer && layer.tile ? layer.tile : 32;
    const sx = g.scale_x === undefined ? 1 : g.scale_x;
    const sy = g.scale_y === undefined ? 1 : g.scale_y;
    const tw = tile * Math.abs(sx);
    const th = tile * Math.abs(sy);
    const cols = layer ? layer.w : 0;
    const rows = layer ? layer.h : 0;
    if (!(tw > 0) || !(th > 0) || cols <= 0 || rows <= 0) {
        return { x0: 1, y0: 1, x1: 0, y1: 0 };
    }
    const zoom = c.zoom > 0 ? c.zoom : 1;
    const left = (g.x || 0) - ((g.w || 0) * sx) / 2;
    const top = (g.y || 0) - ((g.h || 0) * sy) / 2;
    const hw = ((c.w || 0) / 2 + (c.shake_x || 0)) / zoom;
    const hh = ((c.h || 0) / 2 + (c.shake_y || 0)) / zoom;
    const x0 = Math.max(0, Math.floor(((c.x || 0) - hw - left) / tw));
    const y0 = Math.max(0, Math.floor(((c.y || 0) - hh - top) / th));
    const x1 = Math.min(cols - 1, Math.ceil(((c.x || 0) + hw - left) / tw));
    const y1 = Math.min(rows - 1, Math.ceil(((c.y || 0) + hh - top) / th));
    return { x0, y0, x1, y1 };
}

/**
 * Сливает списки тайлов, уже отсортированные по Y, в один. Полная сортировка
 * не нужна: у каждого слоя строки идут сверху вниз, поэтому его список
 * упорядочен. Число слоёв мало (обычно 1–3), поэтому слияние линейно.
 */
export function mergeTilesByY(lists) {
    const src = (lists || []).filter((list) => list && list.length);
    if (!src.length) return [];
    if (src.length === 1) return src[0];
    const out = [];
    const idx = new Array(src.length).fill(0);
    let total = 0;
    for (const list of src) total += list.length;
    while (out.length < total) {
        let best = -1;
        for (let i = 0; i < src.length; i++) {
            if (idx[i] >= src[i].length) continue;
            if (best < 0 || src[i][idx[i]].y < src[best][idx[best]].y) best = i;
        }
        out.push(src[best][idx[best]++]);
    }
    return out;
}

/**
 * Видимые тайлы карты, отсортированные по мировой Y (по возрастанию).
 * Элемент: { tx, ty, id, li, layer, x, y, w, h } — x/y центр тайла в мире,
 * w/h его размер в мире (с учётом масштаба узла). Это и есть «список тайлов с
 * их Y», по которому внешний код чередует тайлы и сущности.
 * opts.layerIndex — ограничить одним слоем.
 */
export function collectVisibleTiles(state, cam, opts) {
    const o = opts || {};
    if (!state || !state.layers || !state.node) return [];
    const node = state.node;
    const geom = {
        x: node.x, y: node.y, w: node.w, h: node.h,
        scale_x: node.scale_x, scale_y: node.scale_y,
    };
    const sx = geom.scale_x === undefined ? 1 : geom.scale_x;
    const sy = geom.scale_y === undefined ? 1 : geom.scale_y;
    const lists = [];
    for (let li = 0; li < state.layers.length; li++) {
        if (o.layerIndex !== undefined && o.layerIndex !== li) continue;
        const layer = state.layers[li];
        const range = visibleRange(layer, geom, cam);
        if (range.x1 < range.x0 || range.y1 < range.y0) continue;
        const tw = layer.tile * Math.abs(sx);
        const th = layer.tile * Math.abs(sy);
        const left = geom.x - (geom.w * sx) / 2;
        const top = geom.y - (geom.h * sy) / 2;
        const ox = layer.origin_x | 0, oy = layer.origin_y | 0;
        const list = [];
        for (let ty = range.y0; ty <= range.y1; ty++) {
            const base = ty * layer.w;
            const y = top + (ty + 0.5) * th;
            for (let tx = range.x0; tx <= range.x1; tx++) {
                const id = layer.data[base + tx];
                if (id <= 0) continue;                 // id 0 и <0 — пусто
                // Мировая позиция считается по индексу буфера, а наружу идут
                // ЛОГИЧЕСКИЕ координаты клетки (origin учитывается).
                let vw = tw, vh = th;
                if (layer.custom_visual && layer.visuals) {
                    const v = layer.visuals[id - 1];
                    if (v) { vw = v.w * Math.abs(sx); vh = v.h * Math.abs(sy); }
                }
                list.push({
                    tx: tx + ox, ty: ty + oy, id, li, layer: li,
                    x: left + (tx + 0.5) * tw, y, w: vw, h: vh,
                });
            }
        }
        lists.push(list);
    }
    return mergeTilesByY(lists);
}

// ---------------------------------------------------------------------------
// Состояние узла
// ---------------------------------------------------------------------------

const STATES = new Map();      // узел → состояние карты
const SHEET_CACHE = new Map(); // 'src|tile|cols' → { frames, tex, cols, rows }

function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function stateOf(node) { return STATES.get(node) || null; }

function activeLayer(tm, layerIndex) {
    const index = layerIndex === undefined ? tm.active : layerIndex;
    return tm.layers[index] || null;
}

/** Чистая геометрия слоя: буфер + логический origin (для tileIndexAt и др.). */
function layerGeom(layer) {
    return {
        cols: layer.w, rows: layer.h, tile: layer.tile,
        origin_x: layer.origin_x | 0, origin_y: layer.origin_y | 0,
    };
}

function addLayer(tm, spec, base) {
    const d = spec || {};
    const a = base || {};
    const tile = num(d.tile, num(a.tile, 32));
    const norm = normalizeTileData(d.data, {
        w: d.mapW || d.w,
        h: d.mapH || d.h,
        legend: d.legend || a.legend,
    });
    // Логические координаты и рамка за основной областью (§14 доки).
    const pad = normalizePad(d.pad !== undefined ? d.pad : a.pad);
    const padded = applyPadding(norm, pad, d.padTile !== undefined ? d.padTile : a.padTile);
    const origin = d.origin !== undefined ? d.origin : a.origin;
    const ox = (Array.isArray(origin) ? Number(origin[0]) : (origin && origin.x)) || 0;
    const oy = (Array.isArray(origin) ? Number(origin[1]) : (origin && origin.y)) || 0;
    // Источники тайлсета: `src` — первый, `sources` добавляются после него.
    const list = [];
    const src0 = d.src || a.src;
    if (src0) list.push(src0);
    const extra = d.sources !== undefined ? d.sources : a.sources;
    if (Array.isArray(extra)) for (const s of extra) if (s && list.indexOf(s) < 0) list.push(s);
    else if (typeof extra === 'string' && list.indexOf(extra) < 0) list.push(extra);
    // Таблица дескрипторов: id → normalizTileDef. Ключи — id тайла; с автотайлом
    // «форма» берётся из layer.source, а visual — из layer.data (см. solidPredicate).
    const table = d.tiles !== undefined ? d.tiles : a.tiles;
    let defs = null;
    if (table && typeof table === 'object') {
        defs = Object.create(null);
        for (const key of Object.keys(table)) {
            const id = Number(key);
            if (!isFinite(id)) continue;
            defs[id | 0] = normalizeTileDef(table[key], tile);
        }
        if (!Object.keys(defs).length) defs = null;
    }
    const layer = {
        data: padded.data,
        w: padded.w,
        h: padded.h,
        origin_x: Math.round(isFinite(ox) ? ox : 0) - pad[0],
        origin_y: Math.round(isFinite(oy) ? oy : 0) - pad[1],
        pad,
        source: null,            // данные до автотайла (форма, а не картинка)
        tile,
        src: list[0] || null,
        sources: list,
        cols: num(d.cols, num(a.cols, 0)),
        rows: num(d.rows, num(a.rows, 0)),
        // Помним, заданы ли cols/rows явно: layerFrames() пишет в те же поля
        // вычисленные значения, и без этого флага .tileSize() после первого
        // рендера принимал бы их за override и резал лист по старому тайлу.
        explicit_cols: num(d.cols, num(a.cols, 0)) > 0,
        explicit_rows: num(d.rows, num(a.rows, 0)) > 0,
        solid: d.solid === undefined ? false : d.solid,
        // Явно ли задан solid: с таблицей `tiles` участие слоя в коллизиях
        // решают дескрипторы, а не умолчание `solid: false`.
        solid_set: d.solid !== undefined,
        defs,
        has_solid_defs: !!defs && Object.keys(defs).some((id) => defs[id].solid),
        shape_pad: shapePad(defs, tile),
        // Слияние тайлов коллизий в прямоугольники (см. solidRects). Выключено
        // только у тех, кто явно просит прежние полосы: mergeCollisions: false.
        merge: d.mergeCollisions === undefined ? (a.mergeCollisions === undefined ? true : !!a.mergeCollisions)
                                               : !!d.mergeCollisions,
        depth: num(d.depth, 0),
        autotile: null,
        frames: null,
        tex: -1,
        visuals: null,           // каноническая таблица visual ID (см. visualOf)
        custom_visual: false,    // regions не совпадают с клеткой листа
        bodies: [],
        result: null,            // результат последней сборки тел (см. collisionResult)
        // Анимация тайлов: { ids, tiles, interval, time, frame, random, offset }
        anim: null,
    };
    tm.layers.push(layer);
    return layer;
}

/**
 * Ленивая инициализация карты по атрибутам узла. Вызывается из методов,
 * отрисовщика и tick — так $('<tilemap>', {...}) работает без отдельного
 * «создать», а на верхнем уровне модуля нет ни одного обращения к engine.
 */
function ensureTilemap(node) {
    let tm = STATES.get(node);
    if (tm) return tm;
    const a = node.attrs || {};
    tm = {
        node, layers: [], active: 0, dirty: true, dirty_cells: 0,
        // Y-sort: по умолчанию выключен, чтобы поведение старых игр не менялось.
        ysort: !!a.ysort,
        ysortFrame: -1,      // кадр, для которого собран видимый список
        ysortTiles: null,    // видимые тайлы, отсортированные по Y
        ysortCursor: 0,      // сколько из них уже нарисовано в этом кадре
        ysortHookFrame: -1,  // кадр, в котором сработал хук рендера (см. ниже)
        terrains: Object.create(null),   // имя → нормализованный набор
        // Габарит агента для проверок «пролезу ли»: 0 — как раньше, по клетке.
        agent_w: agentSizeOf(a, 0),
        agent_h: agentSizeOf(a, 1),
        // Политика при исчерпании лимита тел движка: 'fail' (по умолчанию,
        // §3.1 п.12: карта без обязательной коллизии не публикуется) либо
        // 'partial' (прежнее поведение с предупреждением).
        limitPolicy: a.limitPolicy === 'partial' ? 'partial' : 'fail',
        tile_occluders: !!a.tileOccluders,   // карта владеет реестром света
        light_owned: false,
        // Результат последней сборки тел: { ok, error, planned, created, … }.
        result: { ok: true, error: null, policy: 'fail', planned: 0, created: 0, missing: 0, layers: [] },
    };
    STATES.set(node, tm);

    const defs = (Array.isArray(a.layers) && a.layers.length)
        ? a.layers
        : [{ data: a.data, src: a.src, tile: a.tile, cols: a.cols, rows: a.rows,
             solid: a.solid, depth: a.depth, legend: a.legend, mapW: a.mapW, mapH: a.mapH,
             tiles: a.tiles, sources: a.sources, origin: a.origin, pad: a.pad,
             padTile: a.padTile, mergeCollisions: a.mergeCollisions }];
    for (const d of defs) addLayer(tm, d, a);

    // Наборы террейнов приходят из данных карты: их можно сохранить как JSON
    // и загрузить обратно (см. .terrainData() и $.tilemap.loadTerrains).
    if (a.terrains && typeof a.terrains === 'object') {
        for (const name of Object.keys(a.terrains)) {
            const spec = Object.assign({ name }, a.terrains[name]);
            tm.terrains[name] = normalizeTerrain(spec);
        }
    }

    syncNodeSize(tm);
    if (typeof node.on === 'function') node.on('remove', () => releaseTilemap(node));
    return tm;
}

/** Габарит узла = объединение пиксельных размеров слоёв. */
function syncNodeSize(tm) {
    let pw = 0, ph = 0;
    for (const layer of tm.layers) {
        pw = Math.max(pw, layer.w * layer.tile);
        ph = Math.max(ph, layer.h * layer.tile);
    }
    if (pw > 0) tm.node.w = pw;
    if (ph > 0) tm.node.h = ph;
}

/**
 * Кадры тайлсета слоя: [тайл id 1, тайл id 2, …]. Кэш общий на все карты.
 *
 * Старый путь (один `src`, без таблицы `tiles`) не меняется: сетка режется по
 * тайлу, cols/rows вычисляются из текстуры. Если заданы `sources` или `tiles`,
 * собирается КАНОНИЧЕСКАЯ таблица visual ID: id → { source, tx, ty, w, h }, и
 * спрайт каждого id берётся из своего источника/региона. Наружу отдаются
 * логические id (см. $.tilemap.visualOf), а не handles текстур.
 */
function layerFrames(layer) {
    if (layer.frames) return layer.frames;
    if (!layer.src) return null;
    if ((!layer.sources || layer.sources.length <= 1) && !layer.defs) return layerFramesLegacy(layer);
    return layerFramesVisual(layer);
}

/** Старый путь: один лист, ровная сетка tile × tile. */
function layerFramesLegacy(layer) {
    const key = `${layer.src}|${layer.tile}|${layer.cols | 0}`;
    if (SHEET_CACHE.has(key)) {
        const cached = SHEET_CACHE.get(key);
        layer.frames = cached.frames;
        layer.tex = cached.tex;
        layer.cols = cached.cols;
        layer.rows = cached.rows;
        return cached.frames;
    }
    const tex = engine.loadTexture(layer.src);
    if (!(tex >= 0)) {
        // Запоминаем неудачу: иначе битый путь дёргал бы загрузчик каждый кадр.
        SHEET_CACHE.set(key, { frames: null, tex: -1, cols: 0, rows: 0 });
        layer.frames = [];
        return null;
    }
    const size = engine.textureSize(tex) || [0, 0];
    const cols = (layer.cols | 0) > 0 ? layer.cols | 0 : Math.max(1, Math.floor((size[0] || 0) / layer.tile));
    const rows = (layer.rows | 0) > 0 ? layer.rows | 0 : Math.max(1, Math.floor((size[1] || 0) / layer.tile));
    const frames = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            frames.push(engine.createSprite(tex, c * layer.tile, r * layer.tile, layer.tile, layer.tile));
        }
    }
    const entry = { frames, tex, cols, rows };
    SHEET_CACHE.set(key, entry);
    layer.frames = frames;
    layer.tex = tex;
    layer.cols = cols;
    layer.rows = rows;
    return frames;
}

/**
 * Путь с дескрипторами: спрайт id берётся из visual region своего источника.
 * `layer.visuals[id-1]` — каноническая запись { id, source, tx, ty, w, h } или
 * null; она же отдаётся через $.tilemap.visualOf/visualTable.
 */
function layerFramesVisual(layer) {
    const sources = layer.sources && layer.sources.length ? layer.sources : (layer.src ? [layer.src] : []);
    const texs = [];
    for (const path of sources) {
        const tex = engine.loadTexture(path);
        texs.push(tex >= 0 ? tex : -1);
    }
    layer.tex = texs.length ? texs[0] : -1;
    if (!(texs[0] >= 0)) {
        layer.frames = [];
        return null;
    }
    const size = engine.textureSize(texs[0]) || [0, 0];
    const cols = (layer.cols | 0) > 0 ? layer.cols | 0 : Math.max(1, Math.floor((size[0] || 0) / layer.tile));
    const rows = (layer.rows | 0) > 0 ? layer.rows | 0 : Math.max(1, Math.floor((size[1] || 0) / layer.tile));
    layer.cols = cols;
    layer.rows = rows;
    const sheetCells = cols * rows;
    let maxId = sheetCells;
    if (layer.defs) {
        for (const key of Object.keys(layer.defs)) maxId = Math.max(maxId, Number(key) | 0);
    }
    const frames = [];
    const visuals = [];
    let custom = false;
    for (let id = 1; id <= maxId; id++) {
        const def = layer.defs ? layer.defs[id] : null;
        const v = def && def.visual ? def.visual : null;
        if (v) {
            const tex = texs[v.source] !== undefined ? texs[v.source] : -1;
            const entry = { id, source: v.source, tx: v.tx, ty: v.ty, w: v.w, h: v.h };
            visuals.push(entry);
            if (tex >= 0) frames.push(engine.createSprite(tex, v.tx, v.ty, v.w, v.h));
            else frames.push(-1);
            if (v.source !== 0 || v.w !== layer.tile || v.h !== layer.tile) custom = true;
            continue;
        }
        visuals.push(null);
        if (id > sheetCells) { frames.push(-1); continue; }
        const c = (id - 1) % cols, r = Math.floor((id - 1) / cols);
        frames.push(engine.createSprite(texs[0], c * layer.tile, r * layer.tile, layer.tile, layer.tile));
    }
    layer.frames = frames;
    layer.visuals = visuals;
    layer.custom_visual = custom;
    return frames;
}

// ---------------------------------------------------------------------------
// Анимация тайлов
// ---------------------------------------------------------------------------

/**
 * Нормализует спецификацию анимации: разные имена полей и формы входа.
 * `tiles` — сколько КАДРОВ занимает один анимированный тайл в листе, то есть
 * как резать текстуру по строкам. `ids` — какие id анимировать (по умолчанию
 * все, чей кадр существует).
 */
export function normalizeTilesetAnim(spec) {
    if (!spec) return null;
    const frames = Math.max(1, Math.floor(num(spec.frames, 1)));
    const fps = num(spec.fps, 0);
    const interval = num(spec.interval, fps > 0 ? 1000 / fps : num(spec.ms, 200));
    const ids = spec.ids === undefined
        ? null
        : (Array.isArray(spec.ids) ? spec.ids.map((v) => Number(v) | 0) : [Number(spec.ids) | 0]);
    return {
        frames,
        interval: Math.max(1, interval),
        ids,
        random: !!spec.random,
        offset: num(spec.offset, 0),
    };
}

/** Индекс кадра анимации слоя: из времени и интервала (чистая функция). */
export function tilesetFrame(time, interval, frames, random, seed) {
    if (frames <= 1 || interval <= 0) return 0;
    if (random) {
        // Детерминированно от времени и зерна тайла: соседние тайлы «дышат»
        // вразнобой, но картинка воспроизводима при --fixed-dt.
        const n = Math.floor((time + (seed || 0) * interval) / interval);
        return ((n % frames) + frames) % frames;
    }
    // Остаток приводим к неотрицательному: время бывает отрицательным (сдвиг
    // фазы `offset`), а индекс кадра вне 0..frames-1 — это неверный спрайт.
    const step = Math.floor(time / interval);
    return ((step % frames) + frames) % frames;
}

/**
 * Раскладка кадров анимации: для каждого кадра `[тайл id 1 … id N]` добавляет
 * следующие `frames` строк листа. Кадр `f` тайла с id `i` — это элемент
 * `i - 1 + f * row_len`, где `row_len` — число тайлов в исходной строке.
 */
function layerAnimFrames(layer) {
    const anim = layer.anim;
    if (!anim) return null;
    if (anim.sprites) return anim.sprites;
    const base = layer.frames || layerFrames(layer);
    if (!base || !base.length) return null;
    const rowLen = Math.max(1, layer.cols | 0);
    const sprites = new Array(rowLen * anim.frames);
    for (let i = 0; i < rowLen; ++i) {
        for (let f = 0; f < anim.frames; ++f) {
            const src = base[i + f * rowLen];
            sprites[i + f * rowLen] = src === undefined ? (base[i] === undefined ? -1 : base[i]) : src;
        }
    }
    anim.sprites = sprites;
    anim.row_len = rowLen;
    return sprites;
}

/** Спрайт тайла с учётом анимации; -1 — рисовать нечего. */
function animatedTileSprite(layer, id, time) {
    const base = layerFrames(layer);
    if (!base || !base.length) return -1;
    const anim = layer.anim;
    if (!anim || id <= 0 || id > (base.length | 0)) return spriteOr(base, id);
    if (anim.ids && anim.ids.indexOf(id) < 0) return spriteOr(base, id);
    const sprites = layerAnimFrames(layer);
    if (!sprites) return spriteOr(base, id);
    const frame = tilesetFrame(time + anim.offset, anim.interval, anim.frames,
                               anim.random, anim.random ? (id * 2654435761) % 1000 : 0);
    const index = (id - 1) + frame * (anim.row_len || 1);
    const sprite = sprites[index];
    return sprite === undefined || sprite < 0 ? spriteOr(base, id) : sprite;
}

function spriteOr(base, id) {
    const sprite = base[id - 1];
    return sprite === undefined ? -1 : sprite;
}

/** Продвигает время анимации всех слоёв карты. */
function tickTileAnimations(tm, dt) {
    for (let i = 0; i < tm.layers.length; ++i) {
        const layer = tm.layers[i];
        if (!layer || !layer.anim) continue;
        layer.anim.time += dt;
    }
}

/** Предикат «тайл непроходим» для слоя. solid: true | число | массив | функция. */
function solidPredicate(layer) {
    // Автотайл подменяет визуальные id: форму берём из исходных данных.
    const data = layer.source || layer.data;
    const spec = layer.solid;
    const w = layer.w;
    if (typeof spec === 'function') return (x, y) => !!spec(x, y, data[y * w + x]);
    if (Array.isArray(spec)) {
        const set = new Set(spec);
        return (x, y) => set.has(data[y * w + x]);
    }
    return (x, y) => data[y * w + x] > 0;
}

// ---------------------------------------------------------------------------
// Занятость клетки и реальная геометрия — разные вещи
//
// Клетка может быть «занята» частично: тело занимает полосу внизу, а верх
// клетки проходим. Поэтому у карты два разных ответа:
//   * `solidAt(tx, ty)` — занята ли клетка вообще (сетка, навигация, occluder);
//   * `shapeAt(tx, ty)` — реальная локальная геометрия (физика, fitsAt, луч).
// Без таблицы `tiles` они совпадают: клетка и есть тело.
// ---------------------------------------------------------------------------

/** Полная клетка как дескриптор — для id без записи в таблице `tiles`. */
function layerFullDef(layer) {
    if (!layer.full_def || layer.full_def_tile !== layer.tile) {
        layer.full_def = normalizeTileDef('full', layer.tile);
        layer.full_def_tile = layer.tile;
    }
    return layer.full_def;
}

/** Участвует ли слой в коллизиях: явный solid важнее дескрипторов. */
function layerSolidOn(layer) {
    if (layer.solid_set) return !!layer.solid;
    return !!layer.has_solid_defs;
}

/**
 * Дескриптор клетки буфера (0..cols-1). Форма берётся из `layer.source`
 * (данные до автотайла), поэтому .setTile()/.autotile() её не подменяют.
 * Дескриптор из таблицы `tiles` важнее слоевого `solid`; для id без
 * дескриптора работает прежний предикат слоя.
 */
function cellDef(layer, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= layer.w || ty >= layer.h) return null;
    const idx = ty * layer.w + tx;
    const id = (layer.source || layer.data)[idx];
    const def = layer.defs ? layer.defs[id | 0] : null;
    if (def) return def.solid ? def : null;
    if (!layer.defs) {
        // Legacy-слой без таблицы `tiles`: клетка и есть тело, а форму задаёт
        // слоевой предикат `solid`. Здесь возвращался null, и `solidAt` для
        // карты с `solid: true` отвечал false ВСЕГДА — при том что тела для тех
        // же клеток физика строила (occupiedPredicate спрашивает тот же
        // предикат). Один контракт вместо двух: solidAt обязан совпадать с
        // тем, из чего собраны тела.
        if (!layerSolidOn(layer)) return null;
        return fallbackSolidPred(layer)(tx, ty) ? layerFullDef(layer) : null;
    }
    return fallbackSolidPred(layer)(tx, ty) ? layerFullDef(layer) : null;
}

/** cellDef по ЛОГИЧЕСКИМ координатам (origin учитывается). */
function logicalDef(layer, tx, ty) {
    return cellDef(layer, tx - (layer.origin_x | 0), ty - (layer.origin_y | 0));
}

/** Локальные прямоугольники коллизии клетки или null. */
function shapeRectsAt(layer, tx, ty) {
    const def = cellDef(layer, tx, ty);
    return def && def.shape ? def.shape.rects : null;
}

/**
 * Слоевой предикат для id без дескриптора. Кэшируется: в плотной карте его
 * спрашивают десятки тысяч раз, а замыкание на `data` при этом одно и то же.
 * Кэш сбрасывается, когда меняются данные автотайла или сам `solid`.
 */
function fallbackSolidPred(layer) {
    if (!layer._fb || layer._fb_src !== layer.source || layer._fb_solid !== layer.solid) {
        layer._fb = solidPredicate(layer);
        layer._fb_src = layer.source;
        layer._fb_solid = layer.solid;
    }
    return layer._fb;
}

/** Предикат «клетка занята» — для слоёв с дескрипторами, иначе прежний solid. */
function occupiedPredicate(layer) {
    if (!layer.defs) return fallbackSolidPred(layer);
    if (!layer._occ_pred) layer._occ_pred = (x, y) => !!cellDef(layer, x, y);
    return layer._occ_pred;
}

/** Публичная копия дескриптора: наружу не отдаём внутренние ссылки. */
function defCopy(def) {
    return {
        solid: def.solid,
        shape: def.shape ? { full: !!def.shape.full, rects: def.shape.rects.map((r) => r.slice()) } : null,
        visual: def.visual ? Object.assign({}, def.visual) : null,
        occluder: def.occluder ? { rects: def.occluder.rects.map((r) => r.slice()) } : null,
        filter: def.filter ? Object.assign({}, def.filter) : null,
        tags: def.tags,
    };
}

/** Локальные прямоугольники occluder'а клетки или null. */
function occluderRectsAt(layer, tx, ty) {
    if (!layer.defs) {
        // Старый слой: препятствие — вся непроходимая клетка.
        const solid = layer.solid_set ? !!layer.solid : true;
        if (!solid) return null;
        const idx = (ty >= 0 && ty < layer.h && tx >= 0 && tx < layer.w) ? ty * layer.w + tx : -1;
        if (idx < 0 || !solidPredicate(layer)(tx, ty)) return null;
        const h = layer.tile / 2;
        return [[-h, -h, h, h]];
    }
    const def = cellDef(layer, tx, ty);
    return def && def.occluder ? def.occluder.rects : null;
}

// ---------------------------------------------------------------------------
// Габарит агента: коллизии «по объёму», а не по клетке
//
// Сетка тайлов помечает клетки, а не объём, поэтому вопрос «пролезу ли я сюда
// телом 28×40» клетка не решает — нужен размер агента. $.nav это умеет для
// путей (agentRadius), а у самой карты проверки по габариту не было.
// ---------------------------------------------------------------------------

/**
 * Индексы клеток сетки с шагом `tile` и началом `origin`, которые пересекает
 * отрезок `[lo, hi]`. Касание границы клеткой не считается: тело, стоящее
 * ровно на стыке, соседнюю клетку не задевает. Для точки ровно на границе
 * берётся клетка справа/снизу — иначе вырожденный габарит не попал бы никуда.
 *
 * Индексы — буферные (data[0] — клетка 0), логический origin учитывает
 * вызывающий код. Чистая функция — её проверяет qjs-харнесс без движка.
 */
export function cellRange(lo, hi, origin, tile) {
    if (!(tile > 0)) return null;
    const min = Math.floor((lo - origin) / tile);
    let max = Math.ceil((hi - origin) / tile) - 1;
    if (max < min) max = min;
    return [min, max];
}

/**
 * Пересекает ли прямоугольник агента (центр x, y, полуразмеры hw/hh)
 * непроходимые клетки слоя. isSolid(tx, ty) — предикат слоя, left/top —
 * мировые координаты левого верхнего угла карты.
 *
 * Чистая функция: ни узлов, ни движка — проверяется qjs-харнессом.
 */
export function boxBlocked(layer, isSolid, left, top, x, y, hw, hh) {
    const rx = cellRange(x - hw, x + hw, left, layer.tile);
    const ry = cellRange(y - hh, y + hh, top, layer.tile);
    if (!rx || !ry) return false;
    for (let ty = ry[0]; ty <= ry[1]; ty++) {
        for (let tx = rx[0]; tx <= rx[1]; tx++) {
            if (isSolid(tx, ty)) return true;
        }
    }
    return false;
}

/** Габарит агента из атрибутов карты: agentSize (число или [w, h]) | agentRadius. */
function agentSizeOf(attrs, axis) {
    const size = attrs.agentSize;
    if (Array.isArray(size)) return Math.max(0, num(size[axis], 0));
    if (size !== undefined && size !== null) return Math.max(0, num(size, 0));
    return Math.max(0, num(attrs.agentRadius, 0) * 2);
}

/** Полуразмеры габарита агента: opts → настройки карты → ноль. */
function agentFootprint(tm, opts) {    const o = opts || {};
    if (o.radius !== undefined) {
        const r = Math.max(0, num(o.radius, 0));
        return { hw: r, hh: r };
    }
    if (o.w !== undefined || o.h !== undefined) {
        return { hw: Math.max(0, num(o.w, tm.agent_w) / 2),
                 hh: Math.max(0, num(o.h, tm.agent_h) / 2) };
    }
    if (o.halfW !== undefined || o.halfH !== undefined) {
        return { hw: Math.max(0, num(o.halfW, tm.agent_w / 2)),
                 hh: Math.max(0, num(o.halfH, tm.agent_h / 2)) };
    }
    return { hw: tm.agent_w / 2, hh: tm.agent_h / 2 };
}

/** Габарит агента против РЕАЛЬНОЙ геометрии слоя (клетка — только если full). */
function layerBlocked(layer, left, top, x, y, hw, hh) {
    if (!layer.defs) {
        // Старые карты: клетка = тело, прежний путь (то же поведение).
        return boxBlocked(layer, solidPredicate(layer), left, top, x, y, hw, hh);
    }
    return shapeBoxBlocked(layer, (tx, ty) => shapeRectsAt(layer, tx, ty), left, top, x, y, hw, hh);
}

/** Влезает ли габарит агента в позицию (x, y), не задевая твёрдые тайлы. */
function fitsAt(tm, x, y, foot) {
    const node = tm.node;
    const left = node.x - node.w / 2;
    const top = node.y - node.h / 2;
    for (const layer of tm.layers) {
        if (!layerSolidOn(layer)) continue;
        if (layerBlocked(layer, left, top, x, y, foot.hw, foot.hh)) return false;
    }
    return true;
}

function releaseLayerBodies(layer) {
    for (const id of layer.bodies) {
        if (ctx.byBody) ctx.byBody.delete(id);
        engine.destroyBody(id);
    }
    layer.bodies.length = 0;
    if (layer.body_keys) layer.body_keys.length = 0;
}

/**
 * §23: инкрементальная синхронизация тел слоя.
 *
 * Раньше любая правка клетки сбрасывала ВСЕ тела карты и создавала их заново
 * (`releaseLayerBodies` + полный проход). Теперь тела сопоставляются по
 * ГЕОМЕТРИИ: неизменившиеся переиспользуются, уничтожаются только исчезнувшие
 * формы, создаются только новые. Для правки одной клетки это 1–3 тела вместо
 * всей карты, а число пересобранных видно в `resultOf()` (`created`,
 * `destroyed`, `reused`, `rebuilt`).
 *
 * Лимит тел проверяется ДО создания (fail-closed) — как и раньше; при отказе
 * вызывающий снимает созданное (`finishLimit`).
 */
function syncLayerBodies(layer, plan, left, top, node) {
    const keys = layer.body_keys || (layer.body_keys = []);
    const bodies = layer.bodies;
    const old_by_key = new Map();
    for (let i = 0; i < keys.length; i++) old_by_key.set(keys[i], bodies[i]);

    const next_keys = [];
    const next_bodies = [];
    let reused = 0;
    let created = 0;
    let destroyed = 0;
    let dropped = 0;

    for (const shape of plan) {
        const def = shape.def;
        const desc = {
            x: left + shape.lx + shape.w / 2,
            y: top + shape.ly + shape.h / 2,
            halfW: shape.w / 2,
            halfH: shape.h / 2,
            angle: 0,
            type: engine.STATIC,
            friction: 0.4,
            restitution: 0.0,
            fixedRotation: true,
        };
        if (def && def.filter) {
            if (def.filter.layerBits !== undefined) desc.layerBits = def.filter.layerBits;
            if (def.filter.mask !== undefined) desc.mask = def.filter.mask;
            if (def.filter.group !== undefined) desc.group = def.filter.group;
            if (def.filter.oneWay) desc.oneWay = true;
            if (def.filter.oneWayAngle !== undefined) desc.oneWayAngle = def.filter.oneWayAngle;
            if (def.filter.sensor) desc.sensor = true;
        }
        // Ключ включает всё, что влияет на тело: геометрию, позицию и фильтр.
        const key = bodyKey(desc);
        const existing = old_by_key.get(key);
        if (existing !== undefined) {
            old_by_key.delete(key);
            next_keys.push(key);
            next_bodies.push(existing);
            reused++;
            continue;
        }
        // Мок движка (qjs) возвращает неотрицательное число-заглушку, а
        // настоящий createBody — id тела. Отрицательный id = «не вышло».
        const id = engine.createBody(desc);
        if (typeof id === 'number' && id >= 0) {
            next_keys.push(key);
            next_bodies.push(id);
            created++;
            if (ctx.byBody) ctx.byBody.set(id, node);
        } else {
            dropped = plan.length - next_bodies.length;
            break;
        }
    }

    // Всё, что осталось в old_by_key, исчезло из новой версии данных.
    for (const stale of old_by_key.values()) {
        if (ctx.byBody) ctx.byBody.delete(stale);
        engine.destroyBody(stale);
        destroyed++;
    }

    layer.bodies = next_bodies;
    layer.body_keys = next_keys;
    return { created, reused, destroyed, dropped, total: plan.length };
}

/**
 * §23: отметить клетку как изменённую. `dirty_cells` — сколько клеток ждёт
 * пересборки с прошлого прохода (-1 — «вся карта», например после clearTiles).
 */
function markDirtyCell(tm, tx, ty) {
    if (tm.dirty_cells === -1) return;
    tm.dirty_cells = (tm.dirty_cells | 0) + 1;
}

/** Ключ формы тела: по нему тело переиспользуется между пересборками. */
function bodyKey(desc) {
    return [
        desc.shape === undefined ? 0 : desc.shape,
        Math.round(desc.x * 1000) / 1000, Math.round(desc.y * 1000) / 1000,
        Math.round(desc.halfW * 1000) / 1000, Math.round(desc.halfH * 1000) / 1000,
        desc.angle || 0,
        desc.layerBits === undefined ? '' : desc.layerBits,
        desc.mask === undefined ? '' : desc.mask,
        desc.group === undefined ? '' : desc.group,
        desc.oneWay ? 1 : 0, desc.sensor ? 1 : 0,
        desc.radius === undefined ? '' : desc.radius,
    ].join('|');
}

function releaseTilemap(node) {
    const tm = STATES.get(node);
    if (!tm) return;
    for (const layer of tm.layers) releaseLayerBodies(layer);
    releaseTileOccluders(tm);
    STATES.delete(node);
}

/** Потолок тел движка: 0 — неизвестен. `engine.limits()` читается один раз. */
let LIMITS_BODY_CAP = -1;
function bodyCap() {
    // Прямая настройка (тесты, моки, будущие движки) всегда свежая.
    const direct = num(engine.bodies_max, 0);
    if (direct > 0) return direct;
    if (LIMITS_BODY_CAP < 0 && typeof engine.limits === 'function') {
        const limits = engine.limits();
        LIMITS_BODY_CAP = limits ? num(limits.bodies_max, 0) : 0;
    }
    return LIMITS_BODY_CAP > 0 ? LIMITS_BODY_CAP : 0;
}

/** Сколько тел ещё влезет; -1 — лимит неизвестен (qjs-мок, старый движок). */
function bodyBudget() {
    const max = bodyCap();
    if (!(max > 0)) return -1;
    const used = typeof engine.bodyCount === 'function' ? num(engine.bodyCount(), 0) : 0;
    return Math.max(0, max - used);
}

/** План тел слоя: { shapes, legacy } — единый путь описания и создания. */
function layerPlan(layer) {
    if (!layerSolidOn(layer)) return [];
    const merge = layer.merge !== false;
    if (!layer.defs) {
        // Прежний путь без изменений: полосы либо прямоугольники.
        const rects = merge
            ? solidRects(layer.w, layer.h, solidPredicate(layer))
                  .map((r) => ({ tx: r.tx, ty: r.ty, nx: r.w, ny: r.h, def: null }))
            : solidRuns(layer.w, layer.h, solidPredicate(layer))
                  .map((r) => ({ tx: r.tx, ty: r.ty, nx: r.len, ny: 1, def: null }));
        return rects.map((r) => ({
            lx: r.tx * layer.tile, ly: r.ty * layer.tile,
            w: r.nx * layer.tile, h: r.ny * layer.tile,
            def: r.def, tx: r.tx, ty: r.ty, nx: r.nx, ny: r.ny,
        }));
    }
    return collisionShapes(layer.w, layer.h, layer.tile,
                           (tx, ty) => cellDef(layer, tx, ty), { merge });
}

/**
 * Создаёт статические тела под непроходимые прямоугольники всех слоёв.
 *
 * Лимит тел движка (R2D_MAX_BODIES = 8192) — это НЕ предупреждение, а отказ
 * (§3.1 п.12, §23): с политикой `limitPolicy: 'fail'` (по умолчанию) частичная
 * коллизия не публикуется — уже созданные тела карты снимаются, а игра
 * получает структурированный результат (см. .collisionResult()). Прежнее
 * поведение «оставить что успело создаться и написать в лог» доступно явно:
 * `.collisionLimit('partial')`.
 */
function buildCollisions(tm) {
    const node = tm.node;
    const left = node.x - node.w / 2;
    const top = node.y - node.h / 2;
    const policy = tm.limitPolicy;
    const plans = [];
    let planned = 0;
    let layersOn = 0;
    for (let li = 0; li < tm.layers.length; li++) {
        const layer = tm.layers[li];
        // Тела НЕ снимаем здесь: их синхронизирует syncLayerBodies по геометрии
        // (§23) — неизменившиеся переиспользуются, снимаются только исчезнувшие.
        layer.result = { ok: true, error: null, policy, planned: 0, created: 0, missing: 0,
                         reused: 0, destroyed: 0 };
        if (!layerSolidOn(layer)) { plans.push(null); continue; }
        const plan = layerPlan(layer);
        layer.result.planned = plan.length;
        plans.push(plan);
        planned += plan.length;
        layersOn++;
    }
    const result = {
        ok: true, error: null, policy, planned: 0, created: 0, missing: 0, attempted: 0, layers: [],
        // §23: сколько клеток изменилось с прошлой сборки (-1 — вся карта) и
        // сколько тел реально пересобрано (создано + снято).
        dirty_cells: tm.dirty_cells === undefined ? 0 : tm.dirty_cells,
        reused: 0, destroyed: 0, rebuilt: 0,
    };
    tm.result = result;
    if (!layersOn && planned === 0) {
        result.reused = 0; result.destroyed = 0; result.rebuilt = 0;
        result.layers = tm.layers.map((l) => l.result);
        return;
    }

    // Предварительная проверка есть только у политики 'fail': 'partial' —
    // прежнее поведение «пробуем создавать, пока движок даёт тела».
    const budget = bodyBudget();
    if (policy !== 'partial' && budget >= 0 && planned > budget) {
        // Лимит известен заранее: ни одного тела не создаём.
        result.planned = planned;
        result.missing = planned;
        for (const layer of tm.layers) {
            if (!layer.result) continue;
            layer.result.ok = false;
            layer.result.error = 'body-limit';
            layer.result.created = 0;
            layer.result.missing = layer.result.planned;
        }
        finishLimit(tm, planned, result);
        return;
    }

    let created = 0;
    let reused = 0;
    let destroyed = 0;
    for (let li = 0; li < tm.layers.length; li++) {
        const plan = plans[li];
        const layer = tm.layers[li];
        if (!plan) continue;
        const sync = syncLayerBodies(layer, plan, left, top, node);
        created += sync.created;
        reused += sync.reused;
        destroyed += sync.destroyed;
        layer.result.planned = plan.length;
        layer.result.created = sync.created;
        layer.result.reused = sync.reused;
        layer.result.destroyed = sync.destroyed;
        layer.result.missing = sync.dropped;
        if (sync.dropped > 0) { layer.result.ok = false; layer.result.error = 'body-limit'; }
    }
    result.planned = planned;
    result.created = created;
    result.reused = reused;
    result.destroyed = destroyed;
    // «Пересобрано» — тел, которых коснулась эта пересборка (создано + снято);
    // неизменившиеся переиспользованы и в это число не входят.
    result.rebuilt = created + destroyed;
    result.attempted = created;
    result.layers = tm.layers.map((l) => l.result);
    if (created + reused < planned) {
        // Неполная коллизия — это отказ в ЛЮБОЙ политике (§3.1 п.12): политика
        // решает только, снимать ли уже созданное ('fail') или оставить и
        // предупредить ('partial', прежнее поведение).
        result.missing = planned - created;
        result.ok = false;
        result.error = 'body-limit';
        if (policy === 'partial') warnBodyLimit(planned, created, false);
        else finishLimit(tm, planned, result);
        return;
    }
    applyTileOccluders(tm);
}

/** Отказ при лимите: снять уже созданные тела карты, отдать failed result. */
function finishLimit(tm, planned, result) {
    const attempted = result.created | 0;
    for (const layer of tm.layers) releaseLayerBodies(layer);
    for (const layer of tm.layers) {
        if (!layer.result) continue;
        layer.result.ok = false;
        layer.result.error = 'body-limit';
        layer.result.created = 0;
        layer.result.missing = layer.result.planned;
    }
    result.ok = false;
    result.error = 'body-limit';
    result.created = 0;
    result.missing = planned;
    result.attempted = attempted;
    result.layers = tm.layers.map((l) => l.result);
    warnBodyLimit(planned, attempted, true);
    applyTileOccluders(tm);
}

/** Сообщение о лимите. При отказе («fail») оно дополнено явно. */
function warnBodyLimit(planned, created, rejected) {
    const dropped = planned - created;
    ctx.log(`$.tilemap: лимит тел движка — создано ${created} `
          + `прямоугольников из ${planned}, ${dropped} без коллизий `
          + '(разрежьте карту на несколько <tilemap> или упростите узор)'
          + (rejected ? '; коллизия отклонена (limitPolicy: fail) — см. .collisionResult()' : ''));
}

// ---------------------------------------------------------------------------
// Тайловые occluders: препятствия света по реальной форме тайла
//
// У освещения (render.js) уже есть реестр отрезков; тайлмап отдаёт туда рёбра
// настоящих форм — тонкая платформа даёт полосу внизу клетки, а не весь
// квадрат. По умолчанию карта реестром не владеет: отрезки берут явно
// ($.tilemap.occludersOf) либо включают владение методом .tileOccluders(true)
// (тогда реестр ЗАМЕНЯЕТСЯ на отрезки этой карты при каждой пересборке —
// реестр света в движке один, см. docs/highlevel/tilemap.md §15).
// ---------------------------------------------------------------------------

/** Отрезки препятствий карты (или слоя) в мировых координатах. */
function tileLightSegments(tm, layerIndex) {
    const node = tm.node;
    const left = node.x - node.w / 2;
    const top = node.y - node.h / 2;
    const out = [];
    const indices = layerIndex === undefined ? tm.layers.map((_, i) => i) : [layerIndex];
    for (const li of indices) {
        const layer = tm.layers[li];
        if (!layer) continue;
        const segs = shapeOccluders(layer.w, layer.h, layer.tile, (tx, ty) => {
            const rects = occluderRectsAt(layer, tx, ty);
            return rects ? { rects } : null;
        }, left, top);
        for (const v of segs) out.push(v);
    }
    return out;
}

/** Публикация препятствий карты в реестр света (если карта им владеет). */
function applyTileOccluders(tm) {
    if (!tm.tile_occluders) return 0;
    const gfx = ctx.gfx;
    if (!gfx || !gfx.light || typeof gfx.light.occluders !== 'function') return 0;
    const segs = tileLightSegments(tm);
    tm.light_owned = true;
    return gfx.light.occluders(segs);
}

/** Снятие препятствий карты из реестра света при выключении/удалении. */
function releaseTileOccluders(tm) {
    if (!tm.light_owned) return false;
    tm.light_owned = false;
    const gfx = ctx.gfx;
    if (gfx && gfx.light && typeof gfx.light.clearOccluders === 'function') {
        gfx.light.clearOccluders();
    }
    return true;
}

/** Набор проходимости для автотайла: функция | массив id | «любой непустой». */
function autotileSolid(spec, data, w) {
    if (typeof spec === 'function') return (x, y) => !!spec(x, y, data[y * w + x]);
    if (Array.isArray(spec)) {
        const set = new Set(spec);
        return (x, y) => set.has(data[y * w + x]);
    }
    return (x, y) => data[y * w + x] > 0;
}

/** Пересчитывает визуальные id слоя по маске соседей из исходных данных. */
function runAutotile(layer) {
    const cfg = layer.autotile;
    if (!cfg) return;
    const src = layer.source || layer.data;
    const isSolid = autotileSolid(cfg.solid, src, layer.w);
    const maskOpts = { mode: cfg.mode, border: cfg.border, cols: layer.w, rows: layer.h };
    for (let y = 0; y < layer.h; y++) {
        const row = y * layer.w;
        for (let x = 0; x < layer.w; x++) {
            const idx = row + x;
            if (src[idx] <= 0) { layer.data[idx] = 0; continue; }
            // Террейн перерисовывает только «свои» тайлы (по solid): чужие
            // непустые тайлы должны остаться такими, какими их поставили.
            if (cfg.terrain && !isSolid(x, y)) { layer.data[idx] = src[idx]; continue; }
            const mask = autotileMask(isSolid, x, y, maskOpts);
            // У террейна своя таблица переходов, у обычного автотайла — net-раскладка.
            layer.data[idx] = cfg.terrain
                ? terrainTile(mask, cfg.terrain)
                : autotileTile(mask, { mode: cfg.mode, base: cfg.base });
        }
    }
}

/** Пересобирает производные данные: автотайл, габарит, тела коллизий. */
function rebuildTilemap(tm) {
    for (const layer of tm.layers) if (layer.autotile) runAutotile(layer);
    syncNodeSize(tm);
    buildCollisions(tm);          // читает tm.dirty_cells (сколько клеток изменилось)
    // §23: правки клеток должны быть видны данным узла — иначе $.prefab/$.save
    // сохранили бы ПЕРВОНАЧАЛЬНЫЙ массив, а не то, что показывает карта.
    // Один Array.from на пачку правок (а не на каждую клетку).
    if (tm.attrs_dirty) {
        const node = tm.node;
        if (node && node.attrs && tm.layers.length === 1) {
            node.attrs.data = Array.from(tm.layers[0].data);
        }
        tm.attrs_dirty = false;
    }
    tm.dirty = false;
    tm.dirty_cells = 0;           // следующий проход копит заново
}

// ---------------------------------------------------------------------------
// Отрисовка Y-полос
//
// Как это работает без правок render.js:
//   * при включённом Y-sort карта не рисует себя целиком, а держит в
//     tm.ysortTiles видимые тайлы, отсортированные по мировой Y, и курсор
//     tm.ysortCursor;
//   * `flushTilesUpTo(cam, worldY)` дорисовывает все тайлы с Y <= worldY.
//     Тот, кто рисует сущность, вызывает её перед своим спрайтом — тогда
//     тайлы и сущности чередуются по Y;
//   * после всех узлов кадра остаток добивает `flushTiles(cam)`.
//
// Рисование за кадр ограничено: список видимых тайлов собирается один раз
// (O(видимых тайлов)), дальше каждый вызов только двигает курсор. Полной
// сортировки нет — сливаются упорядоченные по строкам списки слоёв.
//
// Точки подключения к render.js — две (их добавляет интегратор, см.
// docs/highlevel/tilemap.md): `ctx.gfx._ysortFlush(cam, node.y)` перед
// отрисовкой узла и `ctx.gfx._ysortFlushEnd(cam)` после всех узлов. Пока их
// никто не зовёт, карта в режиме Y-sort честно рисует себя сама (тайлы по Y),
// а чередование с сущностями доступно только тем, кто зовёт flush вручную.
// ---------------------------------------------------------------------------

/** Собирает (один раз за кадр) видимые тайлы карты, отсортированные по Y. */
function ysortTilesFor(tm, cam) {
    if (tm.ysortFrame === engine.frame && tm.ysortTiles) return tm.ysortTiles;
    tm.ysortFrame = engine.frame;
    tm.ysortTiles = collectVisibleTiles(tm, cam);
    tm.ysortCursor = 0;
    return tm.ysortTiles;
}

/** Мировые координаты тайла → экранные, как в общем отрисовщике узлов. */
function tileScreenPoint(tm, cam, tile) {
    const node = tm.node;
    const zoom = cam && cam.zoom > 0 ? cam.zoom : 1;
    const cw = cam && cam.w ? cam.w : (engine.width || 0);
    const ch = cam && cam.h ? cam.h : (engine.height || 0);
    let sx = (tile.x - (cam ? cam.x : 0)) * zoom + cw / 2 + (cam ? cam.shake_x || 0 : 0);
    let sy = (tile.y - (cam ? cam.y : 0)) * zoom + ch / 2 + (cam ? cam.shake_y || 0 : 0);
    if (node.shake_timer > 0) {
        const p = node.shake_total > 0 ? node.shake_timer / node.shake_total : 1;
        const amp = node.shake_amount * p;
        sx += (fxRandom() * 2 - 1) * amp;
        sy += (fxRandom() * 2 - 1) * amp;
    }
    return { x: sx, y: sy, zoom };
}

/** Рисует один тайл. false — рисовать нечего (нет кадров/спрайта). */
function drawYsortTile($, tm, tile, cam) {
    const layer = tm.layers[tile.li];
    if (!layer) return false;
    const frames = layerFrames(layer);
    if (!frames || !frames.length) return false;
    const sprite = layer.anim ? animatedTileSprite(layer, tile.id, layer.anim.time)
                              : frames[tile.id - 1];
    if (sprite === undefined || sprite < 0) return false;
    const p = tileScreenPoint(tm, cam, tile);
    const node = tm.node;
    const color = node.alpha < 1 ? withAlpha(node.color, node.alpha) : node.color;
    $.gfx.push.sprite(sprite, p.x, p.y, tile.w * p.zoom, tile.h * p.zoom, 0, color,
                      node.blend_mode);
    return true;
}

/** Дорисовывает видимые тайлы карты с мировой Y не больше worldY. */
function flushTilesUpTo($, tm, cam, worldY) {
    if (!tm.ysort || !tm.layers.length) return 0;
    const tiles = ysortTilesFor(tm, cam);
    let drawn = 0;
    while (tm.ysortCursor < tiles.length && tiles[tm.ysortCursor].y <= worldY) {
        const tile = tiles[tm.ysortCursor++];
        if (drawYsortTile($, tm, tile, cam)) drawn++;
    }
    return drawn;
}

/** Дорисовывает остаток тайлов всех карт в режиме Y-sort (конец кадра). */
function flushAllTiles($, cam, worldY) {
    let drawn = 0;
    for (const [, tm] of STATES) {
        if (!tm.ysort) continue;
        drawn += flushTilesUpTo($, tm, cam, worldY);
    }
    return drawn;
}

/** Принимает состояние, узел, обёртку или селектор — всегда даёт состояние. */
function resolveTm(tm) {
    if (!tm) return null;
    if (tm.layers && tm.node) return tm;
    if (tm instanceof Wrapper) return tm.nodes[0] ? ensureTilemap(tm.nodes[0]) : null;
    if (typeof tm === 'string') {
        const node = query(tm)[0];
        return node ? ensureTilemap(node) : null;
    }
    if (tm.tag) return ensureTilemap(tm);
    return null;
}

function geomOf(tm, layerIndex) {
    const st = resolveTm(tm);
    if (!st) return { x: 0, y: 0, tile: 32, cols: 0, rows: 0, origin_x: 0, origin_y: 0 };
    const layer = activeLayer(st, layerIndex) || st.layers[0];
    return {
        x: st.node.x,
        y: st.node.y,
        tile: layer ? layer.tile : 32,
        cols: layer ? layer.w : 0,
        rows: layer ? layer.h : 0,
        // Логические координаты клетки data[0] и масштаб узла: без них
        // world↔cell разошлись бы у карт с padding и .scale().
        origin_x: layer ? (layer.origin_x | 0) : 0,
        origin_y: layer ? (layer.origin_y | 0) : 0,
        scale_x: st.node.scale_x,
        scale_y: st.node.scale_y,
    };
}

/** Принимает и карту, и уже готовую геометрию — так помощники универсальны. */
function looksLikeTm(value) {
    if (!value || typeof value !== 'object') return false;
    if (value.layers && value.node) return true;   // состояние карты
    if (value instanceof Wrapper) return true;
    if (value.tag) return true;                    // узел
    return false;
}

function asGeom(tm, layerIndex) {
    if (tm && typeof tm === 'object' && !looksLikeTm(tm)) return tm;  // готовая геометрия
    return geomOf(tm, layerIndex);
}

/** Набор террейна по имени; объект-описание регистрируется на месте. */
function terrainOf(tm, nameOrSpec) {
    if (nameOrSpec && typeof nameOrSpec === 'object') {
        const set = normalizeTerrain(nameOrSpec);
        tm.terrains[set.name] = set;
        return set;
    }
    if (typeof nameOrSpec === 'string') return tm.terrains[nameOrSpec] || null;
    return null;
}

/** Камера для публичных помощников: переданная или текущая. */
function resolveCam(cam) {
    return cam || cameraTransform();
}

// ---------------------------------------------------------------------------
// §35. Отладочный оверлей TileMap.
//
// Что показывает: сетку логических клеток, твёрдые клетки (клеточная
// занятость — тот же предикат, что у solidAt), частичные формы, occluder'ы и
// координаты клетки под курсором. Рисуется поверх кадра через $.debug.draw.*
// в МИРОВЫХ координатах: тайлмап-рендер не дублируется, тайлы не
// перерисовываются — только геометрия сетки и подсветка.
//
// По умолчанию всё выключено: у выключенного оверлея нулевая цена, и кадр он
// не меняет. Значения берутся только из самой карты: чего карта не знает —
// не рисуется (нет клетки под курсором — нет подписи).
// ---------------------------------------------------------------------------
const TM_DEBUG_FLAGS = ['grid', 'solid', 'partial', 'occluders', 'cursor', 'text'];
const TM_DEBUG_MODES = ['all', 'collision'];

const tm_debug = {
    on: false,
    map: null,          // узел/обёртка/селектор; null — активная карта (первая)
    mode: 'all',        // 'all' — вся сетка, 'collision' — только занятые клетки
    grid: true,
    solid: true,
    partial: false,     // клетки с неполной формой (тонкие платформы)
    occluders: false,   // клетки-препятствия света
    cursor: true,
    text: true,
    cap: 4096,          // предел клеток в кадре: карта 200×200 иначе съест кадр
    last: null,         // факты последнего нарисованного кадра
};

const TM_DEBUG_COLORS = {
    grid: '#4a6b8a',
    solid: '#ff5a4a',
    partial: '#ffb020',
    occluder: '#b07cff',
    cursor: '#8fd1ff',
    text: '#d8e2ee',
};

/** Примитивы оверлея: только $.debug.draw (мировые координаты). */
function tilemapDebugDraw() {
    const d = ctx && ctx.debug;
    return d && d.draw ? d.draw : null;
}

/** Карта, за которой следит оверлей: выбранная или первая живая. */
function tilemapDebugState() {
    if (tm_debug.map !== null && tm_debug.map !== undefined) return resolveTm(tm_debug.map);
    for (const [node, tm] of STATES) {
        if (!node.removed && node.in_registry) return tm;
    }
    return null;
}

/** Ярлык карты для фактов: id узла, иначе nid. */
function tilemapDebugLabel(st) {
    if (!st || !st.node) return null;
    const id = st.node.id;
    return id === undefined || id === null ? 'nid' + st.node.nid : String(id);
}

/** Прямоугольник клетки в мировых координатах (не путать с локальными rects). */
function tilemapCellRect(geom, tx, ty) {
    const c = tileToPixel(geom, tx, ty);
    const tw = (geom.tile || 32) * Math.abs(geomScale(geom, 0));
    const th = (geom.tile || 32) * Math.abs(geomScale(geom, 1));
    return { x: c.x - tw / 2, y: c.y - th / 2, w: tw, h: th };
}

/** Клетка под курсором мыши: экран → мир → клетка (или null). */
function tilemapDebugCursor(geom) {
    const input = ctx && ctx.input;
    if (!input || typeof input.mouse !== 'function') return null;
    const m = input.mouse();
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return null;
    const camera = ctx.camera;
    let world = null;
    if (camera && typeof camera.screenToWorld === 'function') world = camera.screenToWorld(m);
    if (!world || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return null;
    const cell = pixelToTile(geom, world.x, world.y);
    const index = tileIndexAt(geom, cell.tx, cell.ty);
    return {
        tx: cell.tx, ty: cell.ty,
        screen: { x: m.x, y: m.y },
        world: { x: world.x, y: world.y },
        index,
        inMap: index >= 0,
    };
}

/** Пустые факты кадра: оверлею нечего рисовать, и он это честно сообщает. */
function tilemapDebugEmpty(reason) {
    return {
        map: null, layer: null, mode: tm_debug.mode, reason,
        cells: 0, solids: 0, partial: 0, occluders: 0, capped: false,
        range: null, cursor: null, solidCells: [],
        primitives: { rects: 0, lines: 0, texts: 0 },
    };
}

/**
 * Кадр оверлея TileMap. Вызывается из tickTilemap — то есть в фазе
 * обновления, до сборки батча: $.debug.draw кладёт примитивы в очередь
 * текущего кадра, и они попадают в тот же кадр, что увидит игрок.
 *
 * Рисуется только ВИДИМАЯ часть карты (тот же visibleRange, что у рендера) и
 * не больше `cap` клеток: иначе карта 200×200 выдала бы 40 000 прямоугольников
 * в кадр. Если предел сработал — это видно в фактах (`capped: true`), а не
 * замалчивается.
 */
function drawTilemapDebug() {
    const d = tilemapDebugDraw();
    if (!d) { tm_debug.last = tilemapDebugEmpty('no_debug_draw'); return; }
    const st = tilemapDebugState();
    if (!st) { tm_debug.last = tilemapDebugEmpty('no_map'); return; }
    const layer = activeLayer(st);
    if (!layer) { tm_debug.last = tilemapDebugEmpty('no_layer'); return; }

    const geom = geomOf(st);
    const ox = layer.origin_x | 0, oy = layer.origin_y | 0;
    const node = st.node;
    const cam = cameraTransform();
    const vis = visibleRange(layer, {
        x: node.x, y: node.y, w: node.w, h: node.h,
        scale_x: node.scale_x, scale_y: node.scale_y,
    }, cam);

    const marks = tilemapDebugEmpty(null);
    marks.map = tilemapDebugLabel(st);
    marks.layer = st.active;
    marks.range = { x0: vis.x0 + ox, y0: vis.y0 + oy, x1: vis.x1 + ox, y1: vis.y1 + oy };
    if (vis.x1 < vis.x0 || vis.y1 < vis.y0) { tm_debug.last = marks; return; }

    const rect = (r, color) => {
        d.rect({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, color);
        marks.primitives.rects++;
    };

    // --- сетка логических клеток ------------------------------------------
    // Рисуем линии по границам ВИДИМОГО диапазона: (cols+1) + (rows+1) линий
    // вместо четырёх на клетку.
    if (tm_debug.mode === 'all' && tm_debug.grid) {
        const first = tilemapCellRect(geom, vis.x0 + ox, vis.y0 + oy);
        const last = tilemapCellRect(geom, vis.x1 + ox, vis.y1 + oy);
        const left = first.x, top = first.y;
        const right = last.x + last.w, bottom = last.y + last.h;
        for (let i = 0; i <= (vis.x1 - vis.x0) + 1; i++) {
            const x = left + i * first.w;
            d.line({ x, y: top }, { x, y: bottom }, TM_DEBUG_COLORS.grid, 1);
            marks.primitives.lines++;
        }
        for (let j = 0; j <= (vis.y1 - vis.y0) + 1; j++) {
            const y = top + j * first.h;
            d.line({ x: left, y }, { x: right, y }, TM_DEBUG_COLORS.grid, 1);
            marks.primitives.lines++;
        }
    }

    // --- клетки -------------------------------------------------------------
    for (let by = vis.y0; by <= vis.y1; by++) {
        for (let bx = vis.x0; bx <= vis.x1; bx++) {
            if (marks.cells >= tm_debug.cap) { marks.capped = true; break; }
            const tx = bx + ox, ty = by + oy;
            // Тот же предикат, что у solidAt(): клеточная занятость, а не форма.
            const occupied = !!cellDef(layer, bx, by);
            if (tm_debug.mode === 'collision' && !occupied) continue;
            marks.cells++;
            const r = tilemapCellRect(geom, tx, ty);
            if (tm_debug.solid && occupied) {
                rect(r, TM_DEBUG_COLORS.solid + '66');
                marks.solids++;
                if (marks.solidCells.length < tm_debug.cap) marks.solidCells.push([tx, ty]);
            }
            if (tm_debug.partial) {
                const def = cellDef(layer, bx, by);
                if (def && def.shape && !def.shape.full) {
                    rect({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 },
                         TM_DEBUG_COLORS.partial + '80');
                    marks.partial++;
                }
            }
            if (tm_debug.occluders && occluderRectsAt(layer, bx, by)) {
                rect({ x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 },
                     TM_DEBUG_COLORS.occluder + '99');
                marks.occluders++;
            }
        }
        if (marks.capped) break;
    }

    // --- клетка под курсором ------------------------------------------------
    if (tm_debug.cursor) {
        const c = tilemapDebugCursor(geom);
        if (c && c.inMap) {
            const r = tilemapCellRect(geom, c.tx, c.ty);
            rect(r, TM_DEBUG_COLORS.cursor + '40');
            const def = cellDef(layer, c.tx - ox, c.ty - oy);
            marks.cursor = {
                tx: c.tx, ty: c.ty,
                screen: c.screen, world: c.world,
                index: c.index,
                inMap: true,
                occupied: !!def,
                id: (layer.data[c.index] | 0),
            };
            if (tm_debug.text) {
                const label = `клетка ${c.tx},${c.ty}  idx ${c.index}  id ${marks.cursor.id}  `
                    + (marks.cursor.occupied ? 'занята' : 'свободна');
                d.text(label, { x: r.x, y: r.y - 4 }, TM_DEBUG_COLORS.text, 13);
                marks.primitives.texts++;
            }
        } else if (c) {
            // Курсор вне карты: координаты известны, занятости нет — показываем
            // только то, что известно, и не выдумываем клетку.
            marks.cursor = {
                tx: c.tx, ty: c.ty, screen: c.screen, world: c.world,
                index: -1, inMap: false, occupied: null, id: null,
            };
            if (tm_debug.text) {
                d.text(`вне карты  ${c.tx},${c.ty}`,
                       { x: c.world.x, y: c.world.y }, TM_DEBUG_COLORS.text, 13);
                marks.primitives.texts++;
            }
        }
    }

    // --- строка состояния оверлея ------------------------------------------
    if (tm_debug.text) {
        const geom_label = `#${marks.map}  слой ${st.active}  режим ${tm_debug.mode}`
            + `  клетка ${geom.tile}px  origin ${ox},${oy}`
            + `  видно ${(vis.x1 - vis.x0) + 1}x${(vis.y1 - vis.y0) + 1}`
            + (marks.capped ? '  (обрезано cap)' : '');
        const anchor = tilemapCellRect(geom, marks.range.x0, marks.range.y0);
        d.text(geom_label, { x: anchor.x + 2, y: anchor.y - 6 }, TM_DEBUG_COLORS.text, 13);
        marks.primitives.texts++;
    }

    tm_debug.last = marks;
}

/** Факты оверлея: то же, что нарисовано, плюс состояние переключателей. */
function tilemapDebugFacts() {
    const st = tilemapDebugState();
    let map = null, layer = null, geom = null;
    if (st) {
        const l = activeLayer(st);
        map = tilemapDebugLabel(st);
        layer = st.active;
        geom = geomOf(st);
    }
    const last = tm_debug.last;
    return {
        on: tm_debug.on,
        mode: tm_debug.mode,
        flags: TM_DEBUG_FLAGS.reduce((acc, key) => { acc[key] = tm_debug[key]; return acc; }, {}),
        map,
        layer,
        tile: geom ? geom.tile : null,
        origin: geom ? { x: geom.origin_x | 0, y: geom.origin_y | 0 } : null,
        cols: geom ? geom.cols : null,
        rows: geom ? geom.rows : null,
        cap: tm_debug.cap,
        // Факты кадра: null — оверлей выключен и кадр не менялся.
        drawn: last ? {
            reason: last.reason,
            range: last.range,
            cells: last.cells,
            solids: last.solids,
            partial: last.partial,
            occluders: last.occluders,
            capped: last.capped,
            solidCells: last.solidCells.map((c) => [c[0], c[1]]),
            cursor: last.cursor,
            primitives: last.primitives,
        } : null,
    };
}

export function installTilemap($) {
    // Дополняем объявление тега, не трогая поля из core.js (body, w, h, src, tile):
    // Node читает TAGS в конструкторе, и без этих ключей собственные атрибуты
    // карты неотличимы от опечатки.
    TAGS.tilemap = Object.assign({}, TAGS.tilemap, {
        cols: 0, rows: 0, data: null, solid: false, layers: null, legend: null, mapW: 0, mapH: 0,
        terrains: null, ysort: false, mergeCollisions: true, agentSize: 0, agentRadius: 0,
        tiles: null, sources: null, origin: null, pad: null, padTile: null,
        limitPolicy: null, tileOccluders: false,
    });

    // --- Методы узла ------------------------------------------------------

    def('setTile', function (x, y, id, layerIndex) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            const layer = activeLayer(tm, layerIndex);
            if (!layer) continue;
            const idx = tileIndexAt(layerGeom(layer), x, y);
            if (idx < 0) continue;
            layer.data[idx] = id | 0;
            if (layer.source) layer.source[idx] = id | 0;
            tm.dirty = true;
            tm.attrs_dirty = true;
            markDirtyCell(tm, x, y);
        }
        return this;
    });

    /**
     * Анимация тайлов: `.tileset({ frames, fps | interval, ids?, random?, offset? })`.
     *
     * `frames` — сколько КАДРОВ занимает один анимированный тайл в листе
     * (кадры идут строками: кадр 0 — первая строка, кадр 1 — вторая). `fps`
     * или `interval` (мс) задаёт темп, `ids` ограничивает набор тайлов
     * (по умолчанию — все, у кого кадр существует), `random` разводит
     * соседние тайлы по фазе. `.tileset(null)` — выключить.
     *
     *   $('#water').tileset({ frames: 4, fps: 6 });          // вода
     *   $('#torch').tileset({ frames: 3, interval: 120, ids: [12, 13] });
     *
     * Время анимации идёт от `tickTilemap` (игровое время), поэтому пауза
     * `$.time.pause()` её останавливает, а `--fixed-dt` делает воспроизводимой.
     */
    def('tileset', function (spec, layerIndex) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            const layer = activeLayer(tm, layerIndex);
            if (!layer) continue;
            if (!spec) { layer.anim = null; continue; }
            const anim = normalizeTilesetAnim(spec);
            if (!anim) { layer.anim = null; continue; }
            anim.time = 0;
            anim.sprites = null;
            layer.anim = anim;
        }
        return this;
    });

    defGet('tileAnimation', function (node, layerIndex) {
        const tm = ensureTilemap(node);
        const layer = activeLayer(tm, layerIndex);
        if (!layer || !layer.anim) return null;
        return {
            frames: layer.anim.frames,
            interval: layer.anim.interval,
            ids: layer.anim.ids ? layer.anim.ids.slice() : null,
            random: !!layer.anim.random,
            time: layer.anim.time,
        };
    }, null);

    defGet('tileAt', function (node, x, y, layerIndex) {
        const tm = ensureTilemap(node);
        const layer = activeLayer(tm, layerIndex);
        if (!layer) return 0;
        const idx = tileIndexAt(layerGeom(layer), x, y);
        return idx < 0 ? 0 : layer.data[idx];
    }, 0);

    def('fill', function (id, layerIndex) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            const layer = activeLayer(tm, layerIndex);
            if (!layer) continue;
            layer.data.fill(id | 0);
            if (layer.source) layer.source.fill(id | 0);
            tm.dirty = true;
        }
        return this;
    });

    // Без аргумента чистим все слои: «очистить карту» — обычное ожидание, и
    // именно на него завязано снятие тел коллизий.
    def('clearTiles', function (layerIndex) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            const list = layerIndex === undefined ? tm.layers : [activeLayer(tm, layerIndex)];
            for (const layer of list) {
                if (!layer) continue;
                layer.data.fill(0);
                if (layer.source) layer.source.fill(0);
                releaseLayerBodies(layer);
            }
            tm.dirty = true;
            tm.attrs_dirty = true;
            tm.dirty_cells = -1;   // -1 — «вся карта», точное число неизвестно
        }
        return this;
    });

    def('tileSize', function (n) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            for (const layer of tm.layers) {
                layer.tile = n;
                layer.frames = null;
                layer.visuals = null;
                layer.custom_visual = false;
                layer.shape_pad = shapePad(layer.defs, n);
                // Сбрасываем только ВЫЧИСЛЕННЫЕ cols/rows: явно заданные
                // остаются, а иначе после первого рендера лист резался бы по
                // старому размеру тайла (см. explicit_cols в addLayer).
                if (!layer.explicit_cols) layer.cols = 0;
                if (!layer.explicit_rows) layer.rows = 0;
            }
            syncNodeSize(tm);
            tm.dirty = true;
        }
        return this;
    });

    def('autotile', function (opts) {
        const o = opts || {};
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            const layer = activeLayer(tm, o.layerIndex);
            if (!layer) continue;
            // Террейн — тот же автотайл, но с таблицей переходов. Набор берём
            // по имени (из данных карты) или регистрируем прямо из описания.
            let terrain = null;
            if (o.mode === 'terrain' || o.terrain !== undefined) {
                terrain = terrainOf(tm, o.terrain === undefined ? o.mode : o.terrain);
                if (!terrain) {
                    ctx.log(`$.tilemap: террейн «${o.terrain || o.mode}» не найден — `
                        + 'задайте его через $.tilemap.terrain() или opts.terrains');
                    continue;
                }
            }
            // Первый вызов запоминает исходную форму: повторный autotile()
            // идемпотентен и не «съедает» картинку, наложенную на данные.
            if (!layer.source) layer.source = layer.data.slice();
            layer.autotile = {
                mode: terrain ? terrain.mode : (o.mode === 'blob47' ? 'blob47' : 'bit16'),
                solid: terrain ? terrain.solid : o.solid,
                border: terrain ? terrain.border : !!o.border,
                base: terrain ? terrain.base : o.base,
                terrain,
            };
            runAutotile(layer);
            syncNodeSize(tm);
            tm.dirty = true;
        }
        return this;
    });

    // Режим Y-sort: карта перестаёт рисоваться одной пачкой и отдаёт видимые
    // тайлы по Y (см. $.tilemap.flushTilesUpTo/flushTiles и docs).
    def('ysort', function (on) {
        const value = on !== false;
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            tm.ysort = value;
            tm.ysortFrame = -1;
            tm.ysortTiles = null;
            tm.ysortCursor = 0;
        }
        return this;
    });

    defGet('terrainData', function (node, name) {
        const tm = ensureTilemap(node);
        const out = {};
        const names = name === undefined ? Object.keys(tm.terrains) : [name];
        for (const key of names) {
            const set = tm.terrains[key];
            if (!set) continue;
            const transitions = {};
            for (const k of Object.keys(set.transitions)) transitions[k] = set.transitions[k];
            out[key] = {
                name: set.name,
                mode: set.mode,
                base: set.base,
                border: set.border,
                // Функцию-предикат в JSON не сохранить — отдаём null и
                // предупреждаем об этом в документации.
                solid: typeof set.solid === 'function'
                    ? null
                    : (Array.isArray(set.solid) ? set.solid.slice() : set.solid),
                transitions,
            };
        }
        return out;
    }, {});

    def('collisions', function (on) {
        const value = on === undefined ? true : on;
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            for (const layer of tm.layers) layer.solid = value;
            tm.dirty = true;
        }
        return this;
    });

    /**
     * Слияние тайлов коллизий в прямоугольники: `.collisionMerge(on)`.
     *
     * Включено по умолчанию: сплошной блок 200×10 — одно тело вместо десяти,
     * и карта 200×100 не упирается в лимит тел движка (8192), из-за которого
     * часть тайлов оставалась без коллизий. `.collisionMerge(false)` возвращает
     * прежнее поведение «одно тело на горизонтальную полосу» — для игр, которым
     * важно число/границы тел. Без аргумента — геттер (true/false).
     */
    def('collisionMerge', function (on) {
        if (on === undefined && this.nodes.length) {
            const tm = ensureTilemap(this.nodes[0]);
            return tm.layers.length ? tm.layers[0].merge !== false : true;
        }
        const value = on !== false;
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            for (const layer of tm.layers) layer.merge = value;
            tm.dirty = true;
        }
        return this;
    });

    /**
     * Политика при исчерпании лимита тел движка: `.collisionLimit('fail')`
     * (по умолчанию — коллизия отклоняется целиком, failed result) или
     * `.collisionLimit('partial')` (прежнее поведение: что успело — то и
     * осталось, плюс предупреждение). Без аргумента — геттер.
     */
    def('collisionLimit', function (policy) {
        if (policy === undefined && this.nodes.length) {
            return ensureTilemap(this.nodes[0]).limitPolicy;
        }
        const value = policy === 'partial' ? 'partial' : 'fail';
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            tm.limitPolicy = value;
            tm.dirty = true;
        }
        return this;
    });

    /**
     * Результат последней сборки тел: `{ ok, error, planned, created, missing,
     * policy, layers }`. `ok: false, error: 'body-limit'` — карта НЕ получила
     * обязательную коллизию (см. .collisionLimit и §3.1 п.12 спецификации).
     */
    defGet('collisionResult', function (node) {
        const tm = ensureTilemap(node);
        const r = tm.result || { ok: true, error: null };
        return {
            ok: r.ok !== false,
            error: r.error === undefined ? null : r.error,
            policy: r.policy,
            planned: r.planned | 0,
            created: r.created | 0,
            missing: r.missing | 0,
            attempted: r.attempted | 0,
            layers: (r.layers || []).map((l) => ({
                ok: l.ok !== false,
                error: l.error === undefined ? null : l.error,
                planned: l.planned | 0,
                created: l.created | 0,
                missing: l.missing | 0,
            })),
        };
    }, { ok: true, error: null, policy: 'fail', planned: 0, created: 0, missing: 0, attempted: 0, layers: [] });

    /**
     * Занята ли клетка коллизией (логические координаты). Это КЛЕТОЧНАЯ
     * занятость: у частичной формы она true, даже если верх клетки проходим.
     * Геометрию смотрите в .shapeAt().
     */
    defGet('solidAt', function (node, tx, ty, layerIndex) {
        const tm = ensureTilemap(node);
        const layer = activeLayer(tm, layerIndex);
        if (!layer) return false;
        return !!logicalDef(layer, tx | 0, ty | 0);
    }, false);

    /**
     * Реальная геометрия клетки: `null`, если коллизии нет, иначе
     * `{ id, full, rects: [[x0,y0,x1,y1], …] }` — локальные пиксели от центра
     * клетки. Именно эту форму видят физика, .fitsAt() и луч.
     */
    defGet('shapeAt', function (node, tx, ty, layerIndex) {
        const tm = ensureTilemap(node);
        const layer = activeLayer(tm, layerIndex);
        if (!layer) return null;
        const bx = (tx | 0) - (layer.origin_x | 0);
        const by = (ty | 0) - (layer.origin_y | 0);
        const def = cellDef(layer, bx, by);
        if (!def || !def.shape) return null;
        const data = layer.source || layer.data;
        return {
            id: data[by * layer.w + bx] | 0,
            full: !!def.shape.full,
            rects: def.shape.rects.map((r) => r.slice()),
        };
    }, null);

    /**
     * Владеть ли реестром препятствий света этой картой: `.tileOccluders(true)`
     * публикует рёбра РЕАЛЬНЫХ форм тайлов (partial shapes — частичные).
     * Реестр света в движке один, поэтому при включении он заменяется
     * отрезками карты при каждой пересборке (см. docs/highlevel/tilemap.md §15).
     */
    def('tileOccluders', function (on) {
        if (on === undefined && this.nodes.length) {
            return ensureTilemap(this.nodes[0]).tile_occluders;
        }
        const value = on !== false;
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            tm.tile_occluders = value;
            if (!value) releaseTileOccluders(tm);
            tm.dirty = true;
        }
        return this;
    });

    /**
     * Габарит агента для проверок «пролезу ли»: `.agentRadius(r)` (круг) или
     * `.agentSize(w, h)`. Ноль (по умолчанию) — проверка по клетке, как раньше.
     */
    def('agentRadius', function (value) {
        if (value === undefined && this.nodes.length) {
            return ensureTilemap(this.nodes[0]).agent_w / 2;
        }
        const r = Math.max(0, num(value, 0));
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            tm.agent_w = r * 2;
            tm.agent_h = r * 2;
        }
        return this;
    });

    def('agentSize', function (w, h) {
        if (w === undefined && this.nodes.length) {
            const tm = ensureTilemap(this.nodes[0]);
            return { w: tm.agent_w, h: tm.agent_h };
        }
        const aw = Math.max(0, num(w, 0));
        const ah = h === undefined ? aw : Math.max(0, num(h, 0));
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            tm.agent_w = aw;
            tm.agent_h = ah;
        }
        return this;
    });

    /**
     * Влезает ли габарит агента в позицию (x, y), не задевая непроходимые
     * тайлы. Размер берётся из `.agentSize()`/`.agentRadius()`, а его можно
     * перебить в opts (`radius`, `w`/`h`, `halfW`/`halfH`).
     */
    defGet('fitsAt', function (node, x, y, opts) {
        const tm = ensureTilemap(node);
        return fitsAt(tm, num(x, node.x), num(y, node.y), agentFootprint(tm, opts));
    }, false);

    /**
     * Ближайшая позиция, где габарит агента помещается: ищет кольцами от
     * (x, y) до `opts.maxDistance` с шагом `opts.step`. Нужна телепортам и
     * спавнам: «поставь рядом, но не в стену». Детерминирована.
     */
    defGet('sample', function (node, x, y, opts) {
        const tm = ensureTilemap(node);
        const o = opts || {};
        const px = num(x, node.x);
        const py = num(y, node.y);
        const foot = agentFootprint(tm, o);
        if (fitsAt(tm, px, py, foot)) return { x: px, y: py, found: true, distance: 0 };

        const maxDist = Math.max(0, num(o.maxDistance, 64));
        const base = Math.max(4, Math.min(foot.hw, foot.hh) || 8);
        const step = Math.max(1, num(o.step, base));
        for (let r = step; r <= maxDist + 1e-9; r += step) {
            const n = Math.max(8, Math.round((2 * Math.PI * r) / step));
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                const cx = px + Math.cos(a) * r;
                const cy = py + Math.sin(a) * r;
                if (fitsAt(tm, cx, cy, foot)) return { x: cx, y: cy, found: true, distance: r };
            }
        }
        return { x: px, y: py, found: false, distance: 0 };
    }, { x: 0, y: 0, found: false, distance: 0 });

    def('rebuild', function () {
        for (const node of this.nodes) rebuildTilemap(ensureTilemap(node));
        return this;
    });

    defGet('tilesData', function (node, layerIndex) {
        const tm = ensureTilemap(node);
        const layer = activeLayer(tm, layerIndex);
        return layer ? Array.from(layer.data) : [];
    }, []);

    defGet('tilesList', function (node, layerIndex) {
        const tm = ensureTilemap(node);
        const out = [];
        const indices = layerIndex === undefined
            ? tm.layers.map((_, i) => i)
            : [layerIndex];
        for (const li of indices) {
            const layer = tm.layers[li];
            if (!layer) continue;
            // Наружу — ЛОГИЧЕСКИЕ координаты (origin/padding), как у tileAt.
            const ox = layer.origin_x | 0, oy = layer.origin_y | 0;
            for (let y = 0; y < layer.h; y++) {
                const row = y * layer.w;
                for (let x = 0; x < layer.w; x++) {
                    const id = layer.data[row + x];
                    if (id > 0) out.push({ x: x + ox, y: y + oy, id, layer: li });
                }
            }
        }
        return out;
    }, []);

    // .layer() занят ядром (порядок отрисовки), поэтому активный слой карты
    // выбирается отдельным именем. Все методы принимают и номер слоя явно.
    def('tileLayer', function (index) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            if (tm.layers[index]) tm.active = index;
            else ctx.log(`$.tilemap: нет слоя ${index} (у карты ${tm.layers.length} слоёв)`);
        }
        return this;
    });

    // --- Отрисовка --------------------------------------------------------

    const tile_params = new Float64Array(13);
    registerNodeRenderer('tilemap', (node, t, cam) => {
        const tm = stateOf(node) || ensureTilemap(node);
        if (!tm.layers.length) return;

        // Y-sort: карта рисует себя полосами по Y, а не одной пачкой. Если
        // хук рендера в этом кадре уже дорисовал полосы до сущностей, здесь
        // рисовать нечего (остаток добьёт flushTiles в конце кадра).
        if (tm.ysort) {
            if (tm.ysortHookFrame !== engine.frame) flushTilesUpTo($, tm, cam, Infinity);
            return;
        }

        const color = node.alpha < 1 ? withAlpha(node.color, node.alpha) : node.color;

        // t — прямоугольник узла на экране (центр + размеры с учётом зума);
        // углы берём по модулю: отрицательный масштаб карте не нужен.
        const bw = Math.abs(t.w), bh = Math.abs(t.h);
        const ox = t.x - bw / 2, oy = t.y - bh / 2;
        const cam_w = cam && cam.w ? cam.w : 0;
        const cam_h = cam && cam.h ? cam.h : 0;

        const layers = tm.layers.slice().sort((a, b) => a.depth - b.depth);
        for (const layer of layers) {
            const frames = layerFrames(layer);
            if (!frames || !frames.length) continue;
            const tile_w = node.w > 0 ? layer.tile * (bw / node.w) : layer.tile;
            const tile_h = node.h > 0 ? layer.tile * (bh / node.h) : layer.tile;
            if (!(tile_w > 0) || !(tile_h > 0)) continue;

            // Отсечение: рисуем только пересечение карты с экраном. Иначе
            // карта 200×200 выдала бы 40 000 спрайтов в кадр.
            const x0 = Math.max(0, Math.floor((0 - ox) / tile_w));
            const y0 = Math.max(0, Math.floor((0 - oy) / tile_h));
            const x1 = Math.min(layer.w - 1, Math.ceil((cam_w - ox) / tile_w));
            const y1 = Math.min(layer.h - 1, Math.ceil((cam_h - oy) / tile_h));
            // Статичный слой — нативным ядром (src/nodes.c): видимые клетки
            // пишутся в батч без push.sprite на каждую. Анимированный слой
            // выбирает кадр в JS (animatedTileSprite) — прежним путём. Слой с
            // visual region другого размера/источника идёт JS-путём: у него
            // спрайты не одной сетки, и батч по клеткам не подходит.
            if (!layer.anim && !layer.custom_visual) {
                const G = tile_params;
                G[0] = x0; G[1] = y0; G[2] = x1; G[3] = y1; G[4] = layer.w;
                G[5] = ox; G[6] = oy; G[7] = tile_w; G[8] = tile_h;
                G[9] = color; G[10] = blendIndex(node.blend_mode);
                if (nativeTiles(layer.data, frames, G)) continue;
            }
            for (let ty = y0; ty <= y1; ty++) {
                const row = ty * layer.w;
                const sy = oy + (ty + 0.5) * tile_h;
                for (let tx = x0; tx <= x1; tx++) {
                    const id = layer.data[row + tx];
                    if (id <= 0) continue;                 // id 0 и <0 — пусто
                    const sprite = layer.anim
                        ? animatedTileSprite(layer, id, layer.anim.time)
                        : frames[id - 1];
                    if (sprite === undefined || sprite < 0) continue;
                    let dw = tile_w, dh = tile_h;
                    if (layer.custom_visual && layer.visuals) {
                        const v = layer.visuals[id - 1];
                        if (v && node.w > 0 && node.h > 0) {
                            dw = v.w * (bw / node.w);
                            dh = v.h * (bh / node.h);
                        }
                    }
                    $.gfx.push.sprite(sprite, ox + (tx + 0.5) * tile_w, sy, dw, dh, 0, color,
                                      node.blend_mode);
                }
            }
        }
    });

    // --- Пространство имён ------------------------------------------------

    $.tilemap = {
        /** $.tilemap.create({ src, tile, cols, data, solid }) → обёртка узла. */
        create(opts) {
            const w = $('<tilemap>', opts || {});
            // Габарит и слои готовим сразу: иначе .size() до первого кадра
            // вернул бы 0, а карта ещё не знала бы своих размеров.
            if (w.nodes[0]) ensureTilemap(w.nodes[0]);
            return w;
        },

        /** $.tilemap.fromASCII(['##','..'], { '#': 1, '.': 0 }, { src, tile }) */
        fromASCII(rows, legend, opts) {
            let map = legend;
            let options = opts;
            // fromASCII(rows, opts): вторым аргументом может быть сам opts.
            // Легенду от опций отличаем по известным ключам карты.
            if (options === undefined && legend && typeof legend === 'object'
                && !Array.isArray(legend) && OPTION_KEYS.some((k) => legend[k] !== undefined)) {
                options = legend;
                map = null;
            }
            const norm = asciiToData(rows, map, {});
            const o = Object.assign({}, options || {}, { data: norm.data, mapW: norm.w, mapH: norm.h });
            const w = $('<tilemap>', o);
            if (w.nodes[0]) ensureTilemap(w.nodes[0]);
            return w;
        },

        /**
         * §35. Отладочный оверлей TileMap: сетка клеток, подсветка твёрдых
         * клеток (та же клеточная занятость, что у `solidAt`), частичные
         * формы, occluder'ы и координаты клетки под курсором. По умолчанию
         * ВЫКЛЮЧЕН и кадр не меняет.
         *
         * ```js
         * $.tilemap.debug(true);                          // вся сетка + твёрдые
         * $.tilemap.debug({ map: '#level', mode: 'collision' });  // только коллизии
         * $.tilemap.debug({ partial: true, occluders: true });
         * $.tilemap.debug(false);                         // выключить
         * const facts = $.tilemap.debug();                // что нарисовано
         * ```
         *
         * Примитивы рисуются через `$.debug.draw.*` в мировых координатах —
         * тайлмап-рендер при этом не дублируется. В фактах — только то, что
         * карта знает: нет клетки под курсором — `cursor: null`.
         */
        debug(opts) {
            if (opts === undefined) return tilemapDebugFacts();
            if (opts === false || opts === null) {
                tm_debug.on = false;
                tm_debug.last = null;
                return tilemapDebugFacts();
            }
            if (opts === true) {
                tm_debug.on = true;
                return tilemapDebugFacts();
            }
            if (typeof opts === 'object') {
                if (opts.on !== undefined) tm_debug.on = opts.on !== false;
                if (opts.map !== undefined) {
                    tm_debug.map = opts.map === null ? null : opts.map;
                    if (tm_debug.map !== null && !resolveTm(tm_debug.map)) {
                        ctx.log('$.tilemap.debug: карта не найдена — оверлей покажет активную');
                    }
                }
                if (opts.mode !== undefined) {
                    const mode = String(opts.mode);
                    if (TM_DEBUG_MODES.indexOf(mode) >= 0) tm_debug.mode = mode;
                    else ctx.log(`$.tilemap.debug: режим "${mode}" неизвестен; `
                        + `доступны: ${TM_DEBUG_MODES.join(', ')} — режим не изменён`);
                }
                for (const key of TM_DEBUG_FLAGS) {
                    if (opts[key] !== undefined) tm_debug[key] = opts[key] !== false;
                }
                if (opts.cap !== undefined) {
                    const cap = Math.round(Number(opts.cap));
                    if (Number.isFinite(cap) && cap > 0) tm_debug.cap = cap;
                    else ctx.log('$.tilemap.debug: cap — положительное число');
                }
                if (!tm_debug.on) tm_debug.last = null;
                return tilemapDebugFacts();
            }
            ctx.log('$.tilemap.debug: ожидается true/false или { on, map, mode, grid, solid, '
                + 'partial, occluders, cursor, text, cap }');
            return tilemapDebugFacts();
        },

        /** Активный слой карты: $.tilemap.layer('#map', 1). */
        layer(tm, index) {            const st = resolveTm(tm);
            if (!st) return null;
            if (index === undefined) return st.active;
            if (st.layers[index]) st.active = index;
            else ctx.log(`$.tilemap: нет слоя ${index} (у карты ${st.layers.length} слоёв)`);
            return st.active;
        },

        // Помощники координат принимают и карту (узел/обёртку/селектор), и
        // готовую геометрию { x, y, tile, cols, rows }.
        pixelToTile(tm, x, y) { return pixelToTile(asGeom(tm), x, y); },
        tileToPixel(tm, tx, ty) { return tileToPixel(asGeom(tm), tx, ty); },
        tileIndexAt(tm, tx, ty, layerIndex) { return tileIndexAt(asGeom(tm, layerIndex), tx, ty); },
        geometry(tm, layerIndex) { return asGeom(tm, layerIndex); },

        /** Полосы непроходимых тайлов слоя — то, что уходит в физику. */
        runsOf(tm, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return [];
            const layer = activeLayer(st, layerIndex);
            if (!layer) return [];
            return solidRuns(layer.w, layer.h, occupiedPredicate(layer));
        },

        /**
         * Прямоугольники непроходимых КЛЕТОК слоя (с учётом `.collisionMerge()`).
         * Это клеточная занятость: у частичной формы (тонкая платформа) клетка
         * показана целиком. Точная геометрия тел — в `$.tilemap.shapesOf()`.
         */
        rectsOf(tm, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return [];
            const layer = activeLayer(st, layerIndex);
            if (!layer) return [];
            if (layer.merge === false) {
                return solidRuns(layer.w, layer.h, occupiedPredicate(layer))
                    .map((run) => ({ tx: run.tx, ty: run.ty, w: run.len, h: 1 }));
            }
            return solidRects(layer.w, layer.h, occupiedPredicate(layer));
        },

        /**
         * Точный план тел слоя — ровно то, что уходит в `engine.createBody`:
         * `[{ tx, ty, nx, ny, lx, ly, w, h, full }]`, где tx/ty — логическая
         * клетка-якорь, nx/ny — сколько клеток слито, lx/ly/w/h — прямоугольник
         * в пикселях от левого верхнего угла буфера (до масштаба узла),
         * `full` — покрывает ли форма клетку целиком.
         */
        shapesOf(tm, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return [];
            const layer = activeLayer(st, layerIndex);
            if (!layer) return [];
            const ox = layer.origin_x | 0, oy = layer.origin_y | 0;
            return layerPlan(layer).map((s) => ({
                tx: s.tx + ox, ty: s.ty + oy, nx: s.nx, ny: s.ny,
                lx: s.lx, ly: s.ly, w: s.w, h: s.h,
                // Без дескриптора тело — всегда полная клетка (прежний путь).
                full: s.def ? !!(s.def.shape && s.def.shape.full) : true,
            }));
        },

        /** Результат сборки тел карты (или слоя): см. `.collisionResult()`. */
        resultOf(tm, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return null;
            if (layerIndex !== undefined) {
                const layer = activeLayer(st, layerIndex);
                if (!layer || !layer.result) return null;
                return Object.assign({}, layer.result);
            }
            const r = st.result || { ok: true, error: null };
            return {
                ok: r.ok !== false,
                error: r.error === undefined ? null : r.error,
                policy: r.policy,
                planned: r.planned | 0,
                created: r.created | 0,
                // §23: сколько тел переиспользовано и снято — по ним видно, что
                // правка одной клетки не пересобирает всю карту.
                reused: r.reused | 0,
                destroyed: r.destroyed | 0,
                rebuilt: r.rebuilt === undefined ? (r.created | 0) : (r.rebuilt | 0),
                dirty_cells: r.dirty_cells === undefined ? 0 : (r.dirty_cells | 0),
                missing: r.missing | 0,
                attempted: r.attempted | 0,
                layers: (r.layers || []).map((l) => Object.assign({}, l)),
            };
        },

        /** Занята ли клетка коллизией (логические координаты). */
        solidAt(tm, tx, ty, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return false;
            const layer = activeLayer(st, layerIndex);
            return layer ? !!logicalDef(layer, tx | 0, ty | 0) : false;
        },

        /**
         * Реальная геометрия клетки (локальные прямоугольники от её центра)
         * или null. Клеточная занятость — `solidAt`, она не то же самое.
         */
        shapeAt(tm, tx, ty, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return null;
            const layer = activeLayer(st, layerIndex);
            if (!layer) return null;
            const bx = (tx | 0) - (layer.origin_x | 0);
            const by = (ty | 0) - (layer.origin_y | 0);
            const def = cellDef(layer, bx, by);
            if (!def || !def.shape) return null;
            const data = layer.source || layer.data;
            return {
                id: data[by * layer.w + bx] | 0,
                full: !!def.shape.full,
                rects: def.shape.rects.map((r) => r.slice()),
            };
        },

        /**
         * Предикат «клетка занята» для `$.grid`/`$.nav`: сетка у них клеточная,
         * поэтому ответ тоже клеточный. Точную форму проверяет `.fitsAt()`.
         */
        cellQuery(tm, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return () => false;
            const layer = activeLayer(st, layerIndex);
            if (!layer) return () => false;
            const ox = layer.origin_x | 0, oy = layer.origin_y | 0;
            const pred = occupiedPredicate(layer);
            return (tx, ty) => !!pred((tx | 0) - ox, (ty | 0) - oy);
        },

        /** Дескриптор тайла id: visual region, форма, маски, occluder, tags. */
        tileDef(tm, id, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return null;
            const layer = activeLayer(st, layerIndex);
            if (!layer || !layer.defs) return null;
            const def = layer.defs[id | 0];
            if (!def) return null;
            return defCopy(def);
        },

        /**
         * Каноническая запись visual ID: `{ id, source, tx, ty, w, h }`.
         * `source` — индекс в списке источников слоя (`src` + `sources`), а не
         * handle текстуры: сырой ресурсный ID наружу не выходит.
         */
        visualOf(tm, id, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return null;
            const layer = activeLayer(st, layerIndex);
            if (!layer) return null;
            layerFrames(layer);
            const v = layer.visuals ? layer.visuals[(id | 0) - 1] : null;
            return v ? Object.assign({}, v) : null;
        },

        /** Таблица visual ID слоя (в порядке id): записи или null. */
        visualTable(tm, layerIndex) {
            const st = resolveTm(tm);
            if (!st) return [];
            const layer = activeLayer(st, layerIndex);
            if (!layer) return [];
            layerFrames(layer);
            if (!layer.visuals) {
                // Старый слой: сетка листа, id = номер клетки.
                const out = [];
                const cells = (layer.cols | 0) * (layer.rows | 0);
                for (let id = 1; id <= cells; id++) {
                    out.push({
                        id, source: 0,
                        tx: ((id - 1) % layer.cols) * layer.tile,
                        ty: Math.floor((id - 1) / layer.cols) * layer.tile,
                        w: layer.tile, h: layer.tile,
                    });
                }
                return out;
            }
            return layer.visuals.map((v) => (v ? Object.assign({}, v) : null));
        },

        /**
         * Отрезки препятствий света по реальной форме тайлов, мировые
         * координаты: плоский `[x1,y1,x2,y2, …]`. Их можно отдать в
         * `$.gfx.light.occluders(...)` или включить владение методом
         * `.tileOccluders(true)`.
         */
        occludersOf(tm, layerIndex) {
            const st = resolveTm(tm);
            return st ? tileLightSegments(st, layerIndex) : [];
        },

        /** Габарит агента против реальной геометрии: как `.fitsAt()` узла. */
        fitsAt(tm, x, y, opts) {
            const st = resolveTm(tm);
            if (!st) return false;
            return fitsAt(st, num(x, st.node.x), num(y, st.node.y), agentFootprint(st, opts));
        },

        numbers() { return STATES.size; },

        // --- Y-sort ---------------------------------------------------------

        /** Включить/выключить Y-sort карты из пространства имён. */
        ysort(tm, on) {
            const st = resolveTm(tm);
            if (!st) return null;
            st.ysort = on !== false;
            st.ysortFrame = -1;
            st.ysortTiles = null;
            st.ysortCursor = 0;
            return st.ysort;
        },

        /**
         * Видимые тайлы карты, отсортированные по мировой Y. Это «список
         * тайлов с их Y» для честного чередования с сущностями.
         * cam можно не передавать — возьмётся текущая камера.
         */
        visibleTiles(tm, cam, opts) {
            const st = resolveTm(tm);
            return st ? collectVisibleTiles(st, resolveCam(cam), opts) : [];
        },

        /**
         * Дорисовывает тайлы карты (режим Y-sort) с Y <= worldY. Вызывайте
         * перед спрайтом сущности, стоящей на этом Y, — тайлы окажутся под
         * ней; после сущности — над ней.
         */
        flushTilesUpTo(tm, cam, worldY) {
            const st = resolveTm(tm);
            return st ? flushTilesUpTo($, st, resolveCam(cam), worldY) : 0;
        },

        /** Дорисовывает остаток тайлов всех карт с Y-sort (конец кадра). */
        flushTiles(cam) { return flushAllTiles($, resolveCam(cam), Infinity); },

        /** Сброс курсора полос — нужен тестам и ручному управлению кадром. */
        ysortReset(tm) {
            const st = resolveTm(tm);
            if (!st) return false;
            st.ysortFrame = -1;
            st.ysortTiles = null;
            st.ysortCursor = 0;
            st.ysortHookFrame = -1;
            return true;
        },

        // --- Террейны -------------------------------------------------------

        /**
         * $.tilemap.terrain(tm, spec) — задать набор террейна;
         * $.tilemap.terrain(tm, 'grass') — получить его.
         */
        terrain(tm, spec) {
            const st = resolveTm(tm);
            if (!st) return null;
            if (typeof spec === 'string' || spec === undefined) {
                return spec === undefined ? Object.keys(st.terrains) : (st.terrains[spec] || null);
            }
            return terrainOf(st, spec);
        },

        /** Загрузка набора(ов) террейнов из сохранённых данных карты. */
        loadTerrains(tm, data) {
            const st = resolveTm(tm);
            if (!st) return 0;
            let count = 0;
            for (const name of Object.keys(data || {})) {
                const spec = Object.assign({ name }, data[name]);
                st.terrains[name] = normalizeTerrain(spec);
                count++;
            }
            return count;
        },

        terrainKey,
        terrainTile,
        normalizeTerrain,
        collectVisibleTiles,
        mergeTilesByY,
        visibleRange,

        // Чистые помощники (те же функции экспортированы модулем для qjs).
        autotileMask,
        autotileTile,
        blob47Index,
        BLOB47_LAYOUT,
        asciiToData,
        normalizeTileData,
        solidRuns,
        solidRects,
        collisionShapes,
        shapeBoxBlocked,
        shapeOccluders,
        normalizeTileDef,
        applyPadding,
        normalizePad,
        purePixelToTile: pixelToTile,
        pureTileToPixel: tileToPixel,
        pureTileIndexAt: tileIndexAt,
    };

    // Точки подключения Y-sort к общему рендеру. render.js может вызвать их в
    // цикле отрисовки (см. docs/highlevel/tilemap.md): перед каждым узлом —
    // `_ysortFlush(cam, node.y)`, после всех узлов — `_ysortFlushEnd(cam)`.
    // Если движок их не зовёт, карта рисует себя сама, и ничего не ломается.
    // ctx.tilemap дублирует пространство имён: render.js видит ctx, а не $.
    if (!ctx.tilemap) ctx.tilemap = $.tilemap;
    const gfx = $.gfx || ctx.gfx;
    if (gfx) {
        gfx._ysortFlush = (cam, worldY) => {
            for (const [, tm] of STATES) {
                if (tm.ysort) tm.ysortHookFrame = engine.frame;
            }
            return flushAllTiles($, cam, worldY === undefined ? Infinity : worldY);
        };
        gfx._ysortFlushEnd = (cam) => flushAllTiles($, cam, Infinity);
        // Есть ли карта с Y-sort: без неё хук перед каждым узлом не нужен, и
        // render.js рисует мир нативным проходом (src/nodes.c).
        gfx._ysortActive = () => {
            for (const [, tm] of STATES) if (tm.ysort) return true;
            return false;
        };
    }

    return $;
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

/**
 * Шаг карты: ленивая инициализация новых узлов и пересборка «грязных»
 * коллизий. Правки данных (.setTile и подобные) только помечают карту, а
 * тела пересоздаются здесь — один раз за кадр, а не на каждый тайл.
 */
export function tickTilemap(dt) {
    // Срез по тегу из индекса реестра: и счёт, и обход — без полного прохода
    // (§5, P2 отчёта). Живые состояния держим отдельно: карта, удалённая до
    // первого tick, обязана освободить ресурсы.
    const maps = nodesByTag('tilemap');
    if (maps.length === 0 && STATES.size === 0) {
        // §35: оверлею нечего показывать — и он это фиксирует, а не рисует
        // «последнее известное».
        if (tm_debug.on) tm_debug.last = tilemapDebugEmpty('no_map');
        return;
    }

    const stale = [];
    for (let i = 0; i < maps.length; i++) ensureTilemap(maps[i]);
    for (const [node, tm] of STATES) {
        if (node.removed || !node.in_registry) { stale.push(node); continue; }
        tickTileAnimations(tm, dt);
        if (tm.dirty) rebuildTilemap(tm);
    }
    // Узлы, удалённые до первого tick, снимаем здесь (destroy() не всегда
    // успевает вызвать слушателя, если карта ещё ни разу не строилась).
    for (const node of stale) releaseTilemap(node);

    // §35: оверлей — последним: он читает уже пересобранное состояние карты.
    if (tm_debug.on) drawTilemapDebug();
    else tm_debug.last = null;
}

export { STATES as tilemapStates, layerFrames as tilemapLayerFrames };
