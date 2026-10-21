// ===========================================================================
// Формат `*.collision.json` (Collision Tools): фигуры коллизий уровня.
//
//   for (const s of $.fs.readJSON('level.collision.json').shapes) {
//       applyShape($('<' + (s.tag || 'wall') + '>').at(s.x, s.y), s).appendTo($.world);
//   }
//
// `applyShape` — функция ниже (≈10 строк): её же вызывает предпросмотр SDK,
// поэтому тела в студии — настоящие `<wall>/<trigger>/<area>` и Box2D игры.
// Фигуры — центр (x, y) в мировых пикселях; box: w×h, circle: radius,
// capsule: radius + h (высота), polygon: points в локальных пикселях (≤ 8, выпуклый).
// Чистая логика без движка.
// ===========================================================================

import { isObj, isStr, isNum, isInt, intIn, inRange, err, warn, checkRoot, duplicateNames } from '../kit.js';

export const ID = 'collision';
export const SUFFIX = '.collision.json';
export const PREFIX = 'SDK_COLLISION';
export const TAGS = ['wall', 'trigger', 'area'];
export const KINDS = ['box', 'circle', 'capsule', 'polygon'];
export const MAX_SHAPES = 4096;

export function create() {
    return { version: 1, shapes: [{ name: 'floor', tag: 'wall', shape: 'box', x: 400, y: 560, w: 800, h: 40 }] };
}

export function newShape(kind, x, y) {
    switch (kind) {
        case 'circle': return { tag: 'wall', shape: 'circle', x, y, radius: 24 };
        case 'capsule': return { tag: 'wall', shape: 'capsule', x, y, radius: 14, h: 56 };
        case 'polygon': return { tag: 'wall', shape: 'polygon', x, y, points: [-30, 20, 30, 20, 0, -30] };
        default: return { tag: 'wall', shape: 'box', x, y, w: 64, h: 32 };
    }
}

/** Выпуклость полигона: все повороты в одну сторону (коллинеарные допустимы). */
export function isConvex(points) {
    const n = points.length / 2;
    let sign = 0;
    for (let i = 0; i < n; i++) {
        const ax = points[i * 2], ay = points[i * 2 + 1];
        const bx = points[((i + 1) % n) * 2], by = points[((i + 1) % n) * 2 + 1];
        const cx = points[((i + 2) % n) * 2], cy = points[((i + 2) % n) * 2 + 1];
        const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        if (cross !== 0) {
            const s = cross > 0 ? 1 : -1;
            if (sign && s !== sign) return false;
            sign = s;
        }
    }
    return true;
}

export function validate(root) {
    const out = [];
    if (!checkRoot(PREFIX, root, out)) return out;
    if (!Array.isArray(root.shapes) || root.shapes.length > MAX_SHAPES) {
        out.push(err(PREFIX + '_SHAPES', 'shapes — массив до ' + MAX_SHAPES + ' фигур', { field: 'shapes' }));
        return out;
    }
    root.shapes.forEach((s, i) => {
        const loc = { shape: i };
        if (!isObj(s)) { out.push(err(PREFIX + '_SHAPE', 'Фигура ' + i + ' должна быть объектом', loc)); return; }
        if (s.name !== undefined && !isStr(s.name)) out.push(err(PREFIX + '_SHAPE', 'name фигуры ' + i + ' — строка', loc));
        if (s.tag !== undefined && TAGS.indexOf(s.tag) < 0) out.push(err(PREFIX + '_TAG', 'tag фигуры ' + i + ': ' + TAGS.join(' | '), loc));
        const kind = s.shape === undefined ? 'box' : s.shape;
        if (KINDS.indexOf(kind) < 0) { out.push(err(PREFIX + '_KIND', 'shape фигуры ' + i + ': ' + KINDS.join(' | '), loc)); return; }
        if (!isNum(s.x) || !isNum(s.y)) out.push(err(PREFIX + '_GEOMETRY', 'Фигура ' + i + ': x и y — числа', loc));
        if (kind === 'box' && !(inRange(s.w, 0.01, 1e6) && inRange(s.h, 0.01, 1e6))) out.push(err(PREFIX + '_GEOMETRY', 'Фигура ' + i + ': box требует w > 0 и h > 0', loc));
        if (kind === 'circle' && !inRange(s.radius, 0.01, 1e6)) out.push(err(PREFIX + '_GEOMETRY', 'Фигура ' + i + ': circle требует radius > 0', loc));
        if (kind === 'capsule' && !(inRange(s.radius, 0.01, 1e6) && inRange(s.h, 0.01, 1e6))) out.push(err(PREFIX + '_GEOMETRY', 'Фигура ' + i + ': capsule требует radius > 0 и h > 0', loc));
        if (kind === 'polygon') {
            const p = s.points;
            if (!Array.isArray(p) || p.length < 6 || p.length > 16 || p.length % 2 !== 0 || !p.every(isNum)) {
                out.push(err(PREFIX + '_POLYGON_POINTS', 'Фигура ' + i + ': points — 3..8 вершин [x0, y0, …] в локальных пикселях', loc));
            } else if (!isConvex(p)) {
                out.push(warn(PREFIX + '_POLYGON_CONCAVE', 'Фигура ' + i + ': полигон невыпуклый — Box2D возьмёт его выпуклую оболочку', loc));
            }
        }
        for (const f of ['oneWay', 'sensor']) if (s[f] !== undefined && typeof s[f] !== 'boolean') out.push(err(PREFIX + '_FLAG', 'Фигура ' + i + ': ' + f + ' — true/false', loc));
        if (s.oneWayAngle !== undefined && !isNum(s.oneWayAngle)) out.push(err(PREFIX + '_FLAG', 'Фигура ' + i + ': oneWayAngle — число (радианы)', loc));
        for (const f of ['layerBits', 'mask']) if (s[f] !== undefined && !intIn(s[f], 0, 4294967295)) out.push(err(PREFIX + '_BITS', 'Фигура ' + i + ': ' + f + ' — целое 0..4294967295', loc));
    });
    out.push(...duplicateNames(PREFIX, root.shapes, 'Фигура'));
    return out;
}

export function summary(root) {
    const n = Array.isArray(root && root.shapes) ? root.shapes.length : 0;
    return 'фигур ' + n;
}

export function snippet(rel) {
    return "for (const s of $.fs.readJSON('" + rel + "').shapes) applyShape($('<' + (s.tag || 'wall') + '>').at(s.x, s.y), s).appendTo($.world);";
}

/**
 * Применяет описание фигуры к уже созданному узлу тем же порядком вызовов,
 * что и игра (`applyShape(node, shape)`). `node` — обёртка `$`.
 */
export function applyShape(node, s) {
    const kind = s.shape || 'box';
    if (kind === 'box') node.size(s.w, s.h);
    else if (kind === 'circle') node.size(s.radius * 2, s.radius * 2).collisionCircle(s.radius);
    else if (kind === 'capsule') node.size(s.radius * 2, s.h).shape('capsule', s.radius);
    else node.size(32, 32).shape('polygon', s.points);
    if (s.oneWay) node.oneWay(true, s.oneWayAngle);
    if (s.sensor) node.sensor(true);
    if (s.layerBits !== undefined) node.layerBits(s.layerBits);
    if (s.mask !== undefined) node.mask(s.mask);
    return node;
}

/** Габарит фигуры в мире: { x0, y0, x1, y1 } — для выделения и рамки. */
export function bounds(s) {
    const kind = s.shape || 'box';
    if (kind === 'circle') return { x0: s.x - s.radius, y0: s.y - s.radius, x1: s.x + s.radius, y1: s.y + s.radius };
    if (kind === 'capsule') return { x0: s.x - s.radius, y0: s.y - s.h / 2, x1: s.x + s.radius, y1: s.y + s.h / 2 };
    if (kind === 'polygon' && Array.isArray(s.points)) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < s.points.length; i += 2) {
            x0 = Math.min(x0, s.points[i]); x1 = Math.max(x1, s.points[i]);
            y0 = Math.min(y0, s.points[i + 1]); y1 = Math.max(y1, s.points[i + 1]);
        }
        return { x0: s.x + x0, y0: s.y + y0, x1: s.x + x1, y1: s.y + y1 };
    }
    return { x0: s.x - s.w / 2, y0: s.y - s.h / 2, x1: s.x + s.w / 2, y1: s.y + s.h / 2 };
}

export function hit(s, px, py) {
    const b = bounds(s);
    return px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1;
}
