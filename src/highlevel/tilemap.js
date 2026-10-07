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

import { ctx, Wrapper, TAGS, wrapOne, query, def, defGet, withAlpha, fxRandom,
         nodesByTag } from './core.js';
import { registerNodeRenderer } from './render.js';
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
                     'terrains', 'ysort'];

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
// Коллизии: склейка тайлов в горизонтальные полосы
// ---------------------------------------------------------------------------

/**
 * Полосы непроходимых тайлов. Склеиваем только по горизонтали: длинные
 * ровные платформы — типичный случай, а вертикальная склейка дала бы тела
 * высотой в пол-карты, что для Box2D хуже сотни узких тел.
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

// ---------------------------------------------------------------------------
// Координаты
// ---------------------------------------------------------------------------

/** Геометрия карты: { x, y, tile, cols, rows }. Всё в мировых пикселях/тайлах. */
export function pixelToTile(geom, x, y) {
    const g = geom || {};
    const tile = g.tile || 32;
    const left = (g.x || 0) - ((g.cols || 0) * tile) / 2;
    const top = (g.y || 0) - ((g.rows || 0) * tile) / 2;
    return { tx: Math.floor((x - left) / tile), ty: Math.floor((y - top) / tile) };
}

/** Центр тайла (tx, ty) в мировых координатах. */
export function tileToPixel(geom, tx, ty) {
    const g = geom || {};
    const tile = g.tile || 32;
    const left = (g.x || 0) - ((g.cols || 0) * tile) / 2;
    const top = (g.y || 0) - ((g.rows || 0) * tile) / 2;
    return { x: left + (tx + 0.5) * tile, y: top + (ty + 0.5) * tile };
}

/** Плоский индекс тайла или -1, если он вне карты. */
export function tileIndexAt(geom, tx, ty) {
    const g = geom || {};
    const cols = g.cols | 0;
    const rows = g.rows | 0;
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return -1;
    return ty * cols + tx;
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
        const list = [];
        for (let ty = range.y0; ty <= range.y1; ty++) {
            const base = ty * layer.w;
            const y = top + (ty + 0.5) * th;
            for (let tx = range.x0; tx <= range.x1; tx++) {
                const id = layer.data[base + tx];
                if (id <= 0) continue;                 // id 0 и <0 — пусто
                list.push({
                    tx, ty, id, li, layer: li,
                    x: left + (tx + 0.5) * tw, y, w: tw, h: th,
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

function addLayer(tm, spec, base) {
    const d = spec || {};
    const a = base || {};
    const tile = num(d.tile, num(a.tile, 32));
    const norm = normalizeTileData(d.data, {
        w: d.mapW || d.w,
        h: d.mapH || d.h,
        legend: d.legend || a.legend,
    });
    const layer = {
        data: norm.data,
        w: norm.w,
        h: norm.h,
        source: null,            // данные до автотайла (форма, а не картинка)
        tile,
        src: d.src || a.src || null,
        cols: num(d.cols, num(a.cols, 0)),
        rows: num(d.rows, num(a.rows, 0)),
        // Помним, заданы ли cols/rows явно: layerFrames() пишет в те же поля
        // вычисленные значения, и без этого флага .tileSize() после первого
        // рендера принимал бы их за override и резал лист по старому тайлу.
        explicit_cols: num(d.cols, num(a.cols, 0)) > 0,
        explicit_rows: num(d.rows, num(a.rows, 0)) > 0,
        solid: d.solid === undefined ? false : d.solid,
        depth: num(d.depth, 0),
        autotile: null,
        frames: null,
        tex: -1,
        bodies: [],
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
        node, layers: [], active: 0, dirty: true,
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
    };
    STATES.set(node, tm);

    const defs = (Array.isArray(a.layers) && a.layers.length)
        ? a.layers
        : [{ data: a.data, src: a.src, tile: a.tile, cols: a.cols, rows: a.rows,
             solid: a.solid, depth: a.depth, legend: a.legend, mapW: a.mapW, mapH: a.mapH }];
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

/** Кадры тайлсета слоя: [тайл id 1, тайл id 2, …]. Кэш общий на все карты. */
function layerFrames(layer) {
    if (layer.frames) return layer.frames;
    if (!layer.src) return null;
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
 * Чистая функция — её проверяет qjs-харнесс без движка.
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

/** Влезает ли габарит агента в позицию (x, y), не задевая твёрдые тайлы. */
function fitsAt(tm, x, y, foot) {
    const node = tm.node;
    const left = node.x - node.w / 2;
    const top = node.y - node.h / 2;
    for (const layer of tm.layers) {
        if (!layer.solid) continue;
        if (boxBlocked(layer, solidPredicate(layer), left, top, x, y, foot.hw, foot.hh)) {
            return false;
        }
    }
    return true;
}

function releaseLayerBodies(layer) {
    for (const id of layer.bodies) {
        if (ctx.byBody) ctx.byBody.delete(id);
        engine.destroyBody(id);
    }
    layer.bodies.length = 0;
}

function releaseTilemap(node) {
    const tm = STATES.get(node);
    if (!tm) return;
    for (const layer of tm.layers) releaseLayerBodies(layer);
    STATES.delete(node);
}

/** Создаёт статические тела под непроходимые полосы всех слоёв. */
function buildCollisions(tm) {
    const node = tm.node;
    const left = node.x - node.w / 2;
    const top = node.y - node.h / 2;
    for (const layer of tm.layers) {
        releaseLayerBodies(layer);
        if (!layer.solid) continue;
        const runs = solidRuns(layer.w, layer.h, solidPredicate(layer));
        for (const run of runs) {
            const w = run.len * layer.tile;
            const h = layer.tile;
            const id = engine.createBody({
                x: left + run.tx * layer.tile + w / 2,
                y: top + run.ty * layer.tile + h / 2,
                halfW: w / 2,
                halfH: h / 2,
                angle: 0,
                type: engine.STATIC,
                friction: 0.4,
                restitution: 0.0,
                fixedRotation: true,
            });
            // Мок движка (qjs) возвращает неотрицательное число-заглушку, а
            // настоящий createBody — id тела. Отрицательный id = «не вышло».
            if (typeof id === 'number' && id >= 0) {
                layer.bodies.push(id);
                if (ctx.byBody) ctx.byBody.set(id, node);
            }
        }
    }
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
    buildCollisions(tm);
    tm.dirty = false;
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
    const sprite = frames[tile.id - 1];
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
    if (!st) return { x: 0, y: 0, tile: 32, cols: 0, rows: 0 };
    const layer = activeLayer(st, layerIndex) || st.layers[0];
    return {
        x: st.node.x,
        y: st.node.y,
        tile: layer ? layer.tile : 32,
        cols: layer ? layer.w : 0,
        rows: layer ? layer.h : 0,
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
// Установка
// ---------------------------------------------------------------------------

export function installTilemap($) {
    // Дополняем объявление тега, не трогая поля из core.js (body, w, h, src, tile):
    // Node читает TAGS в конструкторе, и без этих ключей собственные атрибуты
    // карты неотличимы от опечатки.
    TAGS.tilemap = Object.assign({}, TAGS.tilemap, {
        cols: 0, rows: 0, data: null, solid: false, layers: null, legend: null, mapW: 0, mapH: 0,
        terrains: null, ysort: false,
    });

    // --- Методы узла ------------------------------------------------------

    def('setTile', function (x, y, id, layerIndex) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            const layer = activeLayer(tm, layerIndex);
            if (!layer) continue;
            const idx = tileIndexAt({ cols: layer.w, rows: layer.h }, x, y);
            if (idx < 0) continue;
            layer.data[idx] = id | 0;
            if (layer.source) layer.source[idx] = id | 0;
            tm.dirty = true;
        }
        return this;
    });

    defGet('tileAt', function (node, x, y, layerIndex) {
        const tm = ensureTilemap(node);
        const layer = activeLayer(tm, layerIndex);
        if (!layer) return 0;
        const idx = tileIndexAt({ cols: layer.w, rows: layer.h }, x, y);
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
        }
        return this;
    });

    def('tileSize', function (n) {
        for (const node of this.nodes) {
            const tm = ensureTilemap(node);
            for (const layer of tm.layers) {
                layer.tile = n;
                layer.frames = null;
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
            for (let y = 0; y < layer.h; y++) {
                const row = y * layer.w;
                for (let x = 0; x < layer.w; x++) {
                    const id = layer.data[row + x];
                    if (id > 0) out.push({ x, y, id, layer: li });
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
            for (let ty = y0; ty <= y1; ty++) {
                const row = ty * layer.w;
                const sy = oy + (ty + 0.5) * tile_h;
                for (let tx = x0; tx <= x1; tx++) {
                    const id = layer.data[row + tx];
                    if (id <= 0) continue;                 // id 0 и <0 — пусто
                    const sprite = frames[id - 1];
                    if (sprite === undefined || sprite < 0) continue;
                    $.gfx.push.sprite(sprite, ox + (tx + 0.5) * tile_w, sy, tile_w, tile_h, 0, color,
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

        /** Активный слой карты: $.tilemap.layer('#map', 1). */
        layer(tm, index) {
            const st = resolveTm(tm);
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
            return solidRuns(layer.w, layer.h, solidPredicate(layer));
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
    void dt;
    // Срез по тегу из индекса реестра: и счёт, и обход — без полного прохода
    // (§5, P2 отчёта). Живые состояния держим отдельно: карта, удалённая до
    // первого tick, обязана освободить ресурсы.
    const maps = nodesByTag('tilemap');
    if (maps.length === 0 && STATES.size === 0) return;

    const stale = [];
    for (let i = 0; i < maps.length; i++) ensureTilemap(maps[i]);
    for (const [node, tm] of STATES) {
        if (node.removed || !node.in_registry) { stale.push(node); continue; }
        if (tm.dirty) rebuildTilemap(tm);
    }
    // Узлы, удалённые до первого tick, снимаем здесь (destroy() не всегда
    // успевает вызвать слушателя, если карта ещё ни разу не строилась).
    for (const node of stale) releaseTilemap(node);
}

export { STATES as tilemapStates, layerFrames as tilemapLayerFrames };
