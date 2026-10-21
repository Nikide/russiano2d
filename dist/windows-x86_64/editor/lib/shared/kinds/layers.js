// ===========================================================================
// Формат `*.layers.json` (Parallax Tools): канвас-слои и параллакс `$.layers`.
//
//   const f = $.fs.readJSON('bg.layers.json');
//   for (const l of f.layers) {
//       const layer = $.layers.create(l);                       // name, order, parallax, visible, modulate
//       for (const s of l.sprites || []) $('<sprite>', { src: s.src }).at(s.x, s.y).size(s.w, s.h).appendTo(layer);
//   }
//   if (f.modulate) $.layers.modulate(f.modulate.color, f.modulate.alpha);
//
// См. docs/highlevel/layers.md. Слой не тайлится: нужное число копий спрайта
// записывается явно. Чистая логика без движка.
// ===========================================================================

import { isObj, isStr, isNum, inRange, colorOk, err, warn, checkRoot, duplicateNames } from '../kit.js';

export const ID = 'layers';
export const SUFFIX = '.layers.json';
export const PREFIX = 'SDK_LAYERS';
export const MAX_LAYERS = 32;
export const MAX_SPRITES = 256;

export function create() {
    return {
        version: 1,
        layers: [
            { name: 'far', order: -30, parallax: 0.2, sprites: [] },
            { name: 'near', order: -10, parallax: 0.6, sprites: [] },
        ],
    };
}

export function validate(root) {
    const out = [];
    if (!checkRoot(PREFIX, root, out)) return out;
    if (!Array.isArray(root.layers) || root.layers.length < 1 || root.layers.length > MAX_LAYERS) {
        out.push(err(PREFIX + '_LAYERS', 'layers — массив из 1..' + MAX_LAYERS + ' слоёв', { field: 'layers' }));
        return out;
    }
    root.layers.forEach((l, i) => {
        const loc = { layer: i };
        if (!isObj(l)) { out.push(err(PREFIX + '_LAYER', 'Слой ' + i + ' должен быть объектом', loc)); return; }
        if (!isStr(l.name) || !l.name) out.push(err(PREFIX + '_NAME', 'У слоя ' + i + ' нужен непустой name', loc));
        if (l.order !== undefined && !isNum(l.order)) out.push(err(PREFIX + '_LAYER', 'order слоя ' + i + ' — число', loc));
        if (l.parallax !== undefined && !inRange(l.parallax, 0, 4)) out.push(err(PREFIX + '_PARALLAX', 'parallax слоя ' + i + ' — число 0..4 (0 — прибит к экрану, 1 — как мир)', loc));
        if (l.visible !== undefined && typeof l.visible !== 'boolean') out.push(err(PREFIX + '_LAYER', 'visible слоя ' + i + ' — true/false', loc));
        if (l.modulate !== undefined && !colorOk(l.modulate)) out.push(err(PREFIX + '_COLOR', 'modulate слоя ' + i + ': нераспознанный цвет', loc));
        if (l.sprites !== undefined) {
            if (!Array.isArray(l.sprites) || l.sprites.length > MAX_SPRITES) {
                out.push(err(PREFIX + '_SPRITES', 'sprites слоя ' + i + ' — массив до ' + MAX_SPRITES, loc));
            } else {
                l.sprites.forEach((s, si) => {
                    const sl = { layer: i, sprite: si };
                    if (!isObj(s) || !isStr(s.src) || !s.src) out.push(err(PREFIX + '_SPRITE', 'Спрайт ' + si + ' слоя ' + i + ': нужен src', sl));
                    else if (!isNum(s.x) || !isNum(s.y)) out.push(err(PREFIX + '_SPRITE', 'Спрайт ' + si + ' слоя ' + i + ': x и y — числа', sl));
                    else if ((s.w !== undefined && !inRange(s.w, 0.01, 1e6)) || (s.h !== undefined && !inRange(s.h, 0.01, 1e6))) {
                        out.push(err(PREFIX + '_SPRITE', 'Спрайт ' + si + ' слоя ' + i + ': w и h — числа > 0', sl));
                    }
                });
            }
        }
        if (l.parallax === undefined) out.push(warn(PREFIX + '_NO_PARALLAX', 'У слоя ' + i + ' нет parallax: он будет двигаться вместе с миром', loc));
    });
    if (root.modulate !== undefined) {
        const m = root.modulate;
        if (!isObj(m) || !colorOk(m.color) || (m.alpha !== undefined && !inRange(m.alpha, 0, 1))) {
            out.push(err(PREFIX + '_MODULATE', 'modulate: { color, alpha?: 0..1 }', { field: 'modulate' }));
        }
    }
    out.push(...duplicateNames(PREFIX, root.layers, 'Слой'));
    return out;
}

export function summary(root) {
    const l = Array.isArray(root && root.layers) ? root.layers : [];
    return 'слоёв ' + l.length + ' · спрайтов ' + l.reduce((n, x) => n + (Array.isArray(x.sprites) ? x.sprites.length : 0), 0);
}
export function snippet(rel) {
    return "const f = $.fs.readJSON('" + rel + "'); for (const l of f.layers) { const L = $.layers.create(l); for (const s of l.sprites || []) $('<sprite>', { src: s.src }).at(s.x, s.y).size(s.w, s.h).appendTo(L); }";
}

export function newLayer(root, name) {
    const order = root.layers.reduce((m, l) => Math.max(m, isNum(l.order) ? l.order : 0), -40) + 10;
    root.layers.push({ name: name || 'layer' + root.layers.length, order, parallax: 0.5, sprites: [] });
    return root.layers.length - 1;
}
