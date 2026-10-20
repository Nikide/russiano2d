// ===========================================================================
// Формат `*.tilemap.json` (Tilemap Studio): параметры тега `<tilemap>` как есть.
//
//   $('<tilemap>', $.fs.readJSON('assets/level.tilemap.json')).at(x, y).appendTo($.world);
//
// Корень — те же `opts`, что принимает `$('<tilemap>', opts)` (docs/highlevel/
// tilemap.md): `src`, `tile`, `cols`, `solid`, `layers[{ data, depth, solid }]`,
// плюс обычные JSON-поля `terrains` и `animations`. Лишние ключи (`version`,
// `name`) рантайм кладёт в attrs и не читает; `terrains`/`animations` он
// применяет сам, а `autotile` — игра: `$('#level').autotile(file.autotile)`.
// Чистая логика без движка.
// ===========================================================================

import { isObj, isStr, isNum, isInt, intIn, clone, err, warn, checkRoot, duplicateNames } from '../kit.js';

export const ID = 'tilemap';
export const SUFFIX = '.tilemap.json';
export const PREFIX = 'SDK_TILEMAP';
export const MAX_LAYERS = 16;
export const MAX_SIDE = 1024;
export const MAX_AREA = 1000000;
export const MAX_ID = 65535;
export const MAX_ANIMS = 64;
export const MAX_ANIM_FRAMES = 16;

const AUTOTILE_MODES = ['bit16', 'blob47', 'terrain'];
const TERRAIN_MODES = ['bit16', 'blob47'];

export function grid(w, h, fill) {
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(new Array(w).fill(fill || 0));
    return rows;
}

export function create(opts) {
    const o = opts || {};
    const w = Math.max(1, Math.min(MAX_SIDE, o.w || 20));
    const h = Math.max(1, Math.min(MAX_SIDE, o.h || 12));
    return {
        version: 1,
        tile: o.tile || 32,
        src: o.src || '',
        cols: o.cols || 8,
        solid: [1],
        layers: [{ name: 'ground', depth: 0, data: grid(w, h, 0) }],
    };
}

function solidOk(v) {
    if (typeof v === 'boolean') return true;
    return Array.isArray(v) && v.every((x) => intIn(x, 1, MAX_ID));
}

/** Ключ таблицы переходов террейна: 0..255 (маска bit16 или форма blob47). */
function maskKeyOk(key) {
    if (!/^\d+$/.test(key)) return false;
    const n = Number(key);
    return Number.isInteger(n) && n >= 0 && n <= 255;
}

/** Набор террейна — обычный JSON: mode/base/border/solid/transitions. */
export function terrainSpecOk(spec) {
    if (!isObj(spec)) return false;
    if (spec.name !== undefined && (!isStr(spec.name) || !spec.name)) return false;
    if (spec.mode !== undefined && TERRAIN_MODES.indexOf(spec.mode) < 0) return false;
    if (spec.base !== undefined && !intIn(spec.base, 1, MAX_ID)) return false;
    if (spec.border !== undefined && typeof spec.border !== 'boolean') return false;
    if (spec.solid !== undefined && !solidOk(spec.solid)) return false;
    const table = spec.transitions !== undefined ? spec.transitions : spec.tiles;
    if (table !== undefined) {
        if (!isObj(table)) return false;
        for (const key of Object.keys(table)) {
            if (!maskKeyOk(key) || !intIn(table[key], 1, MAX_ID)) return false;
        }
    }
    return true;
}

/** Одна запись анимации: { tile, frames: [id…], fps?, interval?, random?, offset?, layer? }. */
export function animationSpecOk(spec) {
    if (!isObj(spec)) return false;
    if (!intIn(spec.tile, 1, MAX_ID)) return false;
    const frames = spec.frames;
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > MAX_ANIM_FRAMES) return false;
    if (!frames.every((id) => intIn(id, 1, MAX_ID))) return false;
    if (spec.fps !== undefined && (!isNum(spec.fps) || !(spec.fps > 0) || spec.fps > 1000)) return false;
    for (const key of ['interval', 'ms']) {
        if (spec[key] !== undefined && (!isNum(spec[key]) || spec[key] < 1 || spec[key] > 60000)) return false;
    }
    if (spec.random !== undefined && typeof spec.random !== 'boolean') return false;
    if (spec.offset !== undefined && !isNum(spec.offset)) return false;
    if (spec.layer !== undefined && !intIn(spec.layer, 0, MAX_LAYERS - 1)) return false;
    return true;
}

export function validate(root) {
    const out = [];
    if (!checkRoot(PREFIX, root, out)) return out;
    if (!intIn(root.tile, 1, 512)) out.push(err(PREFIX + '_FIELD', 'tile — целое 1..512 (размер тайла в пикселях)', { field: 'tile' }));
    if (root.src !== undefined && !isStr(root.src)) out.push(err(PREFIX + '_FIELD', 'src должен быть строкой', { field: 'src' }));
    else if (!root.src) out.push(warn(PREFIX + '_NO_SRC', 'Тайлсет (src) не задан: карту нечем рисовать', { field: 'src' }));
    if (root.cols !== undefined && !intIn(root.cols, 1, 1024)) out.push(err(PREFIX + '_FIELD', 'cols — целое 1..1024', { field: 'cols' }));
    if (root.solid !== undefined && !solidOk(root.solid)) out.push(err(PREFIX + '_FIELD', 'solid — true/false или массив id 1..65535', { field: 'solid' }));
    if (root.autotile !== undefined) {
        const a = root.autotile;
        if (!isObj(a)) {
            out.push(err(PREFIX + '_AUTOTILE', 'autotile: { mode: "bit16" | "blob47" | "terrain", terrain?, base? }', { field: 'autotile' }));
        } else {
            if (a.mode !== undefined && AUTOTILE_MODES.indexOf(a.mode) < 0) {
                out.push(err(PREFIX + '_AUTOTILE', 'autotile.mode — "bit16", "blob47" или "terrain"', { field: 'autotile' }));
            } else if (a.mode === 'terrain' && (!isStr(a.terrain) || !a.terrain)) {
                out.push(err(PREFIX + '_AUTOTILE', 'autotile с mode: "terrain" требует имя набора: terrain: "grass"', { field: 'autotile' }));
            } else if (a.terrain !== undefined && (!isStr(a.terrain) || !a.terrain)) {
                out.push(err(PREFIX + '_AUTOTILE', 'autotile.terrain — непустое имя набора', { field: 'autotile' }));
            } else if (a.base !== undefined && !intIn(a.base, 1, MAX_ID)) {
                out.push(err(PREFIX + '_AUTOTILE', 'autotile.base — целое 1..' + MAX_ID, { field: 'autotile' }));
            }
        }
    }
    if (root.terrains !== undefined) {
        const sets = root.terrains;
        if (!isObj(sets)) {
            out.push(err(PREFIX + '_TERRAIN', 'terrains — объект «имя набора → описание»', { field: 'terrains' }));
        } else {
            for (const name of Object.keys(sets)) {
                if (!name) {
                    out.push(err(PREFIX + '_TERRAIN', 'Имя набора террейна не может быть пустым', { field: 'terrains' }));
                    continue;
                }
                if (!terrainSpecOk(sets[name])) {
                    out.push(err(PREFIX + '_TERRAIN', 'Набор террейна «' + name + '»: { mode: "bit16" | "blob47", base?: 1..' +
                        MAX_ID + ', border?: bool, solid?: bool | id[], transitions?: { маска 0..255: тайл 1..' + MAX_ID + ' } }',
                        { name, field: 'terrains' }));
                }
            }
        }
    }
    if (root.animations !== undefined) {
        const list = root.animations;
        if (!Array.isArray(list)) {
            out.push(err(PREFIX + '_ANIM', 'animations — массив { tile, frames: [id…], fps | interval, random?, offset?, layer? }', { field: 'animations' }));
        } else if (list.length > MAX_ANIMS) {
            out.push(err(PREFIX + '_ANIM', 'animations — не больше ' + MAX_ANIMS + ' записей', { field: 'animations' }));
        } else {
            list.forEach((spec, i) => {
                if (!animationSpecOk(spec)) {
                    out.push(err(PREFIX + '_ANIM', 'animations[' + i + ']: { tile: 1..' + MAX_ID + ', frames: массив 1..' +
                        MAX_ANIM_FRAMES + ' id 1..' + MAX_ID + ', fps?: > 0 ≤ 1000, interval?: 1..60000 мс, random?: bool }',
                        { index: i }));
                }
            });
        }
    }
    if (!Array.isArray(root.layers) || root.layers.length < 1 || root.layers.length > MAX_LAYERS) {
        out.push(err(PREFIX + '_LAYERS', 'layers — массив из 1..' + MAX_LAYERS + ' слоёв', { field: 'layers' }));
        return out;
    }
    root.layers.forEach((layer, li) => {
        const loc = { layer: li };
        if (!isObj(layer)) { out.push(err(PREFIX + '_LAYER', 'Слой ' + li + ' должен быть объектом', loc)); return; }
        if (layer.name !== undefined && !isStr(layer.name)) out.push(err(PREFIX + '_LAYER', 'name слоя — строка', { layer: li, field: 'name' }));
        if (layer.depth !== undefined && !isNum(layer.depth)) out.push(err(PREFIX + '_LAYER', 'depth слоя — число', { layer: li, field: 'depth' }));
        if (layer.solid !== undefined && !solidOk(layer.solid)) out.push(err(PREFIX + '_LAYER', 'solid слоя — bool или массив id', { layer: li, field: 'solid' }));
        const data = layer.data;
        if (!Array.isArray(data) || data.length < 1 || data.length > MAX_SIDE || !data.every((r) => Array.isArray(r) && r.length >= 1 && r.length <= MAX_SIDE)) {
            out.push(err(PREFIX + '_DATA', 'data слоя ' + li + ' — массив строк-массивов размером 1..' + MAX_SIDE, { layer: li, field: 'data' }));
            return;
        }
        const w = data[0].length;
        if (data.some((r) => r.length !== w)) {
            out.push(err(PREFIX + '_SHAPE', 'Строки слоя ' + li + ' разной длины: ожидалось ' + w, { layer: li }));
            return;
        }
        if (w * data.length > MAX_AREA) {
            out.push(err(PREFIX + '_SIZE', 'Слой ' + li + ' больше ' + MAX_AREA + ' тайлов', { layer: li }));
            return;
        }
        let bad = 0, first = null, any = false;
        for (let y = 0; y < data.length; y++) {
            for (let x = 0; x < w; x++) {
                const id = data[y][x];
                if (!intIn(id, 0, MAX_ID)) { if (!bad++) first = { layer: li, x, y }; } else if (id > 0) any = true;
            }
        }
        if (bad) out.push(err(PREFIX + '_TILE_ID', 'Слой ' + li + ': ' + bad + ' тайл(ов) вне 0..' + MAX_ID + ' (первый — ' + first.x + ', ' + first.y + ')', first));
        else if (!any) out.push(warn(PREFIX + '_EMPTY_LAYER', 'Слой ' + li + ' пуст: все тайлы 0', loc));
    });
    out.push(...duplicateNames(PREFIX, root.layers, 'Слой'));
    return out;
}

export function summary(root) {
    const l = root && Array.isArray(root.layers) ? root.layers : [];
    const first = l[0] && Array.isArray(l[0].data) ? l[0].data : [];
    const terrains = root && isObj(root.terrains) ? Object.keys(root.terrains).length : 0;
    const anims = root && Array.isArray(root.animations) ? root.animations.length : 0;
    return 'слоёв ' + l.length + ' · ' + (first[0] ? first[0].length : 0) + '×' + first.length + ' тайлов · тайл ' + (root && root.tile) +
        (terrains ? ' · террейнов ' + terrains : '') + (anims ? ' · анимаций ' + anims : '');
}

export function snippet(rel) {
    return "$('<tilemap>', $.fs.readJSON('" + rel + "')).at(0, 0).appendTo($.world);";
}

// --- Правка (все функции меняют документ на месте; бросают Error с понятным текстом) ---
export function size(layer) { return { w: layer.data[0].length, h: layer.data.length }; }

export function inBounds(layer, x, y) { return y >= 0 && y < layer.data.length && x >= 0 && x < layer.data[0].length; }

export function setTile(layer, x, y, id) {
    if (!inBounds(layer, x, y)) return false;
    if (!intIn(id, 0, MAX_ID)) throw new Error('id тайла — целое 0..' + MAX_ID);
    if (layer.data[y][x] === id) return false;
    layer.data[y][x] = id;
    return true;
}

export function fillRect(layer, x0, y0, x1, y1, id) {
    let n = 0;
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(layer.data.length - 1, Math.max(y0, y1)); y++) {
        for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(layer.data[0].length - 1, Math.max(x0, x1)); x++) {
            if (setTile(layer, x, y, id)) n++;
        }
    }
    return n;
}

/** Заливка связной области (4 соседа). Возвращает число изменённых тайлов. */
export function floodFill(layer, x, y, id) {
    if (!inBounds(layer, x, y)) return 0;
    const from = layer.data[y][x];
    if (from === id) return 0;
    const stack = [[x, y]];
    let n = 0;
    while (stack.length) {
        const [cx, cy] = stack.pop();
        if (!inBounds(layer, cx, cy) || layer.data[cy][cx] !== from) continue;
        layer.data[cy][cx] = id;
        n++;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return n;
}

export function resize(layer, w, h) {
    if (!intIn(w, 1, MAX_SIDE) || !intIn(h, 1, MAX_SIDE) || w * h > MAX_AREA) throw new Error('Размер слоя: 1..' + MAX_SIDE + ' по каждой стороне');
    const next = grid(w, h, 0);
    for (let y = 0; y < Math.min(h, layer.data.length); y++) {
        for (let x = 0; x < Math.min(w, layer.data[0].length); x++) next[y][x] = layer.data[y][x];
    }
    layer.data = next;
}

export function addLayer(root, name) {
    if (root.layers.length >= MAX_LAYERS) throw new Error('Не больше ' + MAX_LAYERS + ' слоёв');
    const base = root.layers[0] ? size(root.layers[0]) : { w: 20, h: 12 };
    const depth = root.layers.reduce((m, l) => Math.max(m, isNum(l.depth) ? l.depth : 0), 0) + 10;
    root.layers.push({ name: name || 'layer' + root.layers.length, depth, data: grid(base.w, base.h, 0) });
    return root.layers.length - 1;
}

export function removeLayer(root, i) {
    if (root.layers.length <= 1) throw new Error('Нужен хотя бы один слой');
    root.layers.splice(i, 1);
}

export function moveLayer(root, i, to) {
    if (to < 0 || to >= root.layers.length || i === to) return;
    const [l] = root.layers.splice(i, 1);
    root.layers.splice(to, 0, l);
}

/** Сколько тайлов помещается в тайлсет по размерам картинки (для предупреждения об id за пределом листа). */
export function tilesetCapacity(root, texW, texH) {
    if (!texW || !texH || !root.tile) return 0;
    const cols = root.cols && root.cols > 0 ? root.cols : Math.floor(texW / root.tile);
    const rows = Math.floor(texH / root.tile);
    return cols * rows;
}

export function maxUsedId(root) {
    let m = 0;
    for (const l of root.layers || []) for (const r of l.data || []) for (const id of r) if (isNum(id) && id > m) m = id;
    return m;
}

export const copy = clone;
