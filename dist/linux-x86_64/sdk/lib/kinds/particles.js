// ===========================================================================
// Формат `*.particles.json` (Particle Studio): параметры эмиттера как есть.
//
//   $('<particles>', $.fs.readJSON('fx/fire.particles.json')).at(x, y).appendTo($.world);
//
// Корень — те же `opts`, что принимает `$('<particles>', opts)`
// (docs/highlevel/particles.md §2). Предпросмотр в SDK создаёт настоящий узел
// `<particles>` с этими же параметрами. Чистая логика без движка.
// ===========================================================================

import { isObj, isStr, isNum, intIn, inRange, colorOk, err, warn, checkRoot } from '../kit.js';

export const ID = 'particles';
export const SUFFIX = '.particles.json';
export const PREFIX = 'SDK_PARTICLES';

export const BLENDS = ['alpha', 'add', 'multiply', 'none'];
export const ZONES = ['point', 'rect', 'circle'];

const BOOLS = ['emitting', 'local', 'global', 'one_shot'];
const KNOWN = ['version', 'name', 'emitting', 'amount', 'max_particles', 'rate', 'interval', 'lifetime', 'speed', 'direction',
    'spread', 'gravity', 'angle', 'angular_velocity', 'size', 'end_size', 'size_ramp', 'color', 'end_color', 'color_ramp',
    'alpha_ramp', 'damping', 'texture', 'src', 'local', 'global', 'one_shot', 'burst', 'emit_zone', 'emit_zone_w',
    'emit_zone_h', 'emit_zone_radius', 'seed', 'layer', 'depth', 'blend', 'on_death', 'onDeath', 'sub'];
export const PRESETS = ['explosion', 'smoke', 'sparks', 'fire', 'rain', 'dust'];

export function create() {
    return {
        version: 1, name: 'fire', amount: 32, lifetime: [400, 900], speed: [20, 70], direction: -90, spread: 26,
        gravity: [0, -45], size: [12, 22], end_size: 2,
        color_ramp: [{ t: 0, color: '#fff6c2' }, { t: 0.4, color: '#ff9b1e' }, { t: 1, color: '#c81900' }],
        alpha_ramp: [{ t: 0, alpha: 1 }, { t: 1, alpha: 0 }], blend: 'add', seed: 7,
    };
}

// Диапазон: число или [min, max]; lo — нижняя граница, strict — min > lo, иначе min >= lo.
function rangeOk(v, lo, strict) {
    const good = (x) => isNum(x) && (strict ? x > lo : x >= lo);
    if (isNum(v)) return good(v);
    return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && good(v[0]) && v[0] <= v[1];
}

// Значение стопа рампы так же, как читает рантайм (particles.js stopValue/buildRamp): для цвета —
// color, затем value; для прозрачности и размера — value, затем alpha/size.
export function stopValue(stop, key) {
    if (key === 'color') return stop.color !== undefined ? stop.color : stop.value;
    return stop.value !== undefined ? stop.value : stop[key];
}

function rampOk(v, key) {
    if (!Array.isArray(v) || v.length < 1 || v.length > 32) return false;
    let prev = -1;
    for (const k of v) {
        if (!isObj(k) || !inRange(k.t, 0, 1) || k.t < prev) return false;
        prev = k.t;
        const val = stopValue(k, key);
        if (key === 'color' && !colorOk(val)) return false;
        if (key === 'alpha' && !inRange(val, 0, 1)) return false;
        if (key === 'size' && !(isNum(val) && val >= 0)) return false;
    }
    return true;
}

function vecOk(v) {
    if (isNum(v)) return true;
    if (Array.isArray(v)) return v.length === 2 && isNum(v[0]) && isNum(v[1]);
    return isObj(v) && isNum(v.x) && isNum(v.y);
}

export function validate(root) {
    const out = [];
    if (!checkRoot(PREFIX, root, out)) return out;
    const bad = (field, msg, code) => out.push(err(PREFIX + (code || '_FIELD'), msg, { field }));
    for (const key of Object.keys(root)) {
        if (KNOWN.indexOf(key) < 0) out.push(warn(PREFIX + '_UNKNOWN_FIELD', 'Поле «' + key + '» рантайм не читает (уйдёт в attrs узла)', { field: key }));
    }
    for (const b of BOOLS) if (root[b] !== undefined && typeof root[b] !== 'boolean') bad(b, b + ' должно быть true/false');
    if (root.name !== undefined && !isStr(root.name)) bad('name', 'name — строка');
    if (root.amount !== undefined && !intIn(root.amount, 1, 16384)) bad('amount', 'amount — целое 1..16384');
    if (root.max_particles !== undefined && !intIn(root.max_particles, 1, 16384)) bad('max_particles', 'max_particles — целое 1..16384');
    if (root.rate !== undefined && !inRange(root.rate, 0.001, 100000)) bad('rate', 'rate — число 0.001..100000 (частиц в секунду)');
    if (root.interval !== undefined && !inRange(root.interval, 1, 3600000)) bad('interval', 'interval — мс 1..3600000');
    if (root.lifetime !== undefined && !rangeOk(root.lifetime, 0, true)) bad('lifetime', 'lifetime — число > 0 или [min, max] в мс', '_RANGE');
    if (root.speed !== undefined && !rangeOk(root.speed, 0, false)) bad('speed', 'speed — число ≥ 0 или [min, max]', '_RANGE');
    if (root.size !== undefined && !rangeOk(root.size, 0, true)) bad('size', 'size — число > 0 или [min, max]', '_RANGE');
    if (root.end_size !== undefined && !rangeOk(root.end_size, 0, false)) bad('end_size', 'end_size — число ≥ 0 или [min, max]', '_RANGE');
    for (const f of ['angle', 'angular_velocity']) {
        const v = root[f];
        if (v !== undefined && !(isNum(v) || (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] <= v[1]))) bad(f, f + ' — число или [min, max]', '_RANGE');
    }
    if (root.direction !== undefined && !isNum(root.direction)) bad('direction', 'direction — градусы (число)');
    if (root.spread !== undefined && !inRange(root.spread, 0, 360)) bad('spread', 'spread — 0..360 градусов');
    if (root.damping !== undefined && !inRange(root.damping, 0, 1000)) bad('damping', 'damping — 0..1000');
    if (root.gravity !== undefined && !vecOk(root.gravity)) bad('gravity', 'gravity — число, [x, y] или { x, y }');
    for (const f of ['color', 'end_color']) {
        if (root[f] !== undefined && !colorOk(root[f])) bad(f, f + ': нераспознанный цвет «' + root[f] + '»', '_COLOR');
    }
    for (const [f, k] of [['size_ramp', 'size'], ['color_ramp', 'color'], ['alpha_ramp', 'alpha']]) {
        if (root[f] !== undefined && !rampOk(root[f], k)) bad(f, f + ' — массив 1..32 точек { t: 0..1 по возрастанию, ' + k + ' }', '_RAMP');
    }
    if (root.blend !== undefined && BLENDS.indexOf(root.blend) < 0) bad('blend', 'blend: ' + BLENDS.join(' | '));
    if (root.emit_zone !== undefined) {
        const z = root.emit_zone;
        const okShape = (s) => ZONES.indexOf(s) >= 0;
        if (!(isStr(z) ? okShape(z) : (isObj(z) && okShape(z.shape)))) bad('emit_zone', 'emit_zone: point | rect | circle или { shape, w, h, radius }');
    }
    for (const f of ['emit_zone_w', 'emit_zone_h', 'emit_zone_radius']) {
        if (root[f] !== undefined && !inRange(root[f], 0, 100000)) bad(f, f + ' — число 0..100000');
    }
    if (root.burst !== undefined) {
        const b = root.burst;
        if (!(intIn(b, 0, 16384) || (Array.isArray(b) && b.every((x) => intIn(x, 0, 16384))))) bad('burst', 'burst — целое или массив целых 0..16384');
    }
    for (const f of ['on_death', 'onDeath', 'sub']) {
        const v = root[f];
        if (v === undefined) continue;
        if (!isObj(v) || (v.preset !== undefined && PRESETS.indexOf(v.preset) < 0)) bad(f, f + ' — объект суб-эмиттера: { preset: ' + PRESETS.join(' | ') + ', amount?, … }', '_SUBEMITTER');
    }
    if (root.seed !== undefined && !intIn(root.seed, 0, 4294967295)) bad('seed', 'seed — целое 0..4294967295');
    for (const f of ['layer', 'depth']) if (root[f] !== undefined && !isNum(root[f])) bad(f, f + ' — число');
    if (isNum(root.max_particles) && isNum(root.amount) && root.max_particles < root.amount) {
        out.push(warn(PREFIX + '_CAP', 'max_particles меньше amount: часть частиц не появится', { field: 'max_particles' }));
    }
    return out;
}

export function summary(root) {
    return 'amount ' + (root.amount === undefined ? 'по умолчанию' : root.amount) + ' · blend ' + (root.blend || 'по умолчанию');
}
export function snippet(rel) {
    return "$('<particles>', $.fs.readJSON('" + rel + "')).at(x, y).appendTo($.world);";
}

/** Параметры эмиттера для `$('<particles>', …)`: без служебных `version` и `name`. */
export function emitterOpts(root) {
    const o = {};
    for (const k of Object.keys(root)) if (k !== 'version' && k !== 'name') o[k] = root[k];
    return o;
}

// --- Правка: диапазоны и рампы -------------------------------------------------------------
export function setRamp(root, field, points) {
    if (!points || !points.length) { delete root[field]; return; }
    root[field] = points.map((p) => Object.assign({}, p));
}

export function rampText(ramp, key) {
    return (ramp || []).map((p) => p.t + ':' + stopValue(p, key)).join(' ');
}

/** «0:#fff 0.5:#f90 1:#c00» → [{ t, color }]; мусор → null. */
export function parseRampText(text, key) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const part of parts) {
        const i = part.indexOf(':');
        if (i <= 0) return null;
        const t = Number(part.slice(0, i));
        const raw = part.slice(i + 1);
        if (!Number.isFinite(t)) return null;
        if (key === 'color') out.push({ t, color: raw });
        else {
            const v = Number(raw);
            if (!Number.isFinite(v)) return null;
            out.push(key === 'alpha' ? { t, alpha: v } : { t, size: v });
        }
    }
    return out;
}
