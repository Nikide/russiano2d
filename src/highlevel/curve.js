// ===========================================================================
// Кривые и градиенты — $.curve
//
// Зачем. В движке не было ни одной общей интерполяции: туда, где нужна была
// плавность (затухание вспышки, разгон камеры, размер частицы по жизни,
// прозрачность шлейфа), каждый модуль писал свою формулу — и все они были
// разными. Здесь одна форма на весь движок:
//
//   const fade = $.curve.easeOut();        // готовая
//   const pop  = $.curve.define('pop', [0, 0.2, 1.1, 1.0], { mode: 'spline' });
//
//   pop(0.5)        // значение в точке 0..1
//   pop.at(0.5)     // то же, с защитой диапазона
//   pop.range(6)    // 6 равномерных сэмплов — для sparkline и буферов
//
// Градиент — та же кривая, но по цвету:
//
//   const fire = $.curve.gradient('#fff2a8 → #ff6b1a → #7a1f00');
//   fire(0.5)       // упакованный RGBA
//   fire.at(0.5)    // [r, g, b, a] числами 0..255
//
// Модуль не касается `engine`: это чистые функции, поэтому их целиком проверяет
// юнит-тест без движка (tests/js/curve_test.mjs). Подсистема лишь даёт имена и
// держит реестр, чтобы кривую можно было положить в `$.resource` или в стиль.
//
// Формы (`mode`):
//   linear   — прямая между точками (по умолчанию);
//   step     — ступенька: значение держится до следующей точки;
//   smooth   — гладкая интерполяция (Catmull-Rom по точкам, без настройки);
//   spline   — то же, но с явными касательными (тангенсы на концах нулевые).
//
// Точки задаются:
//   * списком значений — тогда они идут равномерно по 0..1:
//     [0, 1, 0.2] → точки (0,0), (0.5,1), (1,0.2);
//   * списком пар [x, y] или объектов { x, y } — тогда x задаётся явно.
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть
// ---------------------------------------------------------------------------

/** Число в диапазоне lo..hi. */
function clamp01(t) {
    const v = Number(t);
    if (!Number.isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/**
 * Точки кривой в едином виде: [{ x, y }] с неубывающим x.
 * Принимает список значений, пар `[x, y]` или объектов `{x, y}`.
 */
export function normalizePoints(values, opts) {
    const list = Array.isArray(values) ? values : [];
    const out = [];
    const explicit = list.length > 0 && (Array.isArray(list[0]) || (list[0] && typeof list[0] === 'object'));

    if (explicit) {
        for (const entry of list) {
            let x = 0;
            let y = 0;
            if (Array.isArray(entry)) { x = Number(entry[0]); y = Number(entry[1]); }
            else if (entry && typeof entry === 'object') { x = Number(entry.x); y = Number(entry.y); }
            else { x = out.length ? out[out.length - 1].x : 0; y = Number(entry); }
            if (!Number.isFinite(x)) x = out.length ? out[out.length - 1].x : 0;
            if (!Number.isFinite(y)) y = 0;
            out.push({ x, y });
        }
    } else {
        const count = list.length;
        for (let i = 0; i < count; ++i) {
            const y = Number(list[i]);
            out.push({ x: count <= 1 ? 0 : i / (count - 1), y: Number.isFinite(y) ? y : 0 });
        }
    }

    out.sort((a, b) => a.x - b.x);
    if (out.length === 0) {
        const fallback = opts && Number.isFinite(Number(opts.value)) ? Number(opts.value) : 0;
        out.push({ x: 0, y: fallback });
    }
    return out;
}

/**
 * Значение кривой: линейная интерполяция по точкам.
 * За пределами диапазона — значения крайних точек.
 */
export function sampleLinear(points, t) {
    if (!points || points.length === 0) return 0;
    if (points.length === 1) return points[0].y;
    const x = Number(t) || 0;
    if (x <= points[0].x) return points[0].y;
    const last = points[points.length - 1];
    if (x >= last.x) return last.y;
    for (let i = 1; i < points.length; ++i) {
        const b = points[i];
        if (x > b.x) continue;
        const a = points[i - 1];
        const span = b.x - a.x;
        if (span <= 0) return b.y;
        return a.y + (b.y - a.y) * ((x - a.x) / span);
    }
    return last.y;
}

/** Ступенька: значение держится до следующей точки. */
export function sampleStep(points, t) {
    if (!points || points.length === 0) return 0;
    const x = Number(t) || 0;
    let value = points[0].y;
    for (const p of points) {
        if (p.x > x) break;
        value = p.y;
    }
    return value;
}

/**
 * Гладкая интерполяция: Catmull-Rom между точками, крайние точки как
 * воображаемые соседи (поэтому кривая не «дёргается» на концах).
 */
export function sampleSpline(points, t) {
    if (!points || points.length === 0) return 0;
    if (points.length < 3) return sampleLinear(points, t);
    const x = Number(t) || 0;
    if (x <= points[0].x) return points[0].y;
    const last = points[points.length - 1];
    if (x >= last.x) return last.y;

    let i = 1;
    while (i < points.length && points[i].x <= x) i++;
    const p1 = points[i - 1];
    const p2 = points[i];
    const p0 = points[i - 2] || p1;
    const p3 = points[i + 1] || p2;
    const span = p2.x - p1.x;
    const u = span <= 0 ? 0 : (x - p1.x) / span;
    const u2 = u * u;
    const u3 = u2 * u;
    // Catmull-Rom: результат зависит только от значений, x-координаты влияют
    // через параметр u, поэтому «неровные» по x точки остаются плавными.
    return 0.5 * ((2 * p1.y)
        + (-p0.y + p2.y) * u
        + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2
        + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3);
}

/** Цвет в [r, g, b, a] (0..255) из '#rgb', '#rrggbb', '#rrggbbaa' или числа. */
export function colorToBytes(color) {
    if (typeof color === 'number' && Number.isFinite(color)) {
        const v = color >>> 0;
        return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
    }
    const text = String(color === undefined || color === null ? '' : color).trim();
    if (text === '' || text === 'none' || text === 'transparent') return [0, 0, 0, 0];
    if (text[0] === '#') {
        const hex = text.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
            return [r, g, b, a];
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
            return [r, g, b, a];
        }
    }
    if (text.startsWith('rgb')) {
        const nums = text.replace(/[^0-9.,]+/g, ' ').trim().split(/[\s,]+/).map(Number);
        if (nums.length >= 3) {
            const a = nums.length >= 4 ? Math.round(nums[3] * (nums[3] <= 1 ? 255 : 1)) : 255;
            return [nums[0] | 0, nums[1] | 0, nums[2] | 0, a | 0];
        }
    }
    // Именованные цвета, которые знает движок, отдаёт ctx.color; здесь — белый.
    return [255, 255, 255, 255];
}

/** Упаковка [r,g,b,a] в RGBA-число движка (как engine.rgba). */
export function packColorBytes(bytes) {
    const r = bytes[0] & 0xff;
    const g = bytes[1] & 0xff;
    const b = bytes[2] & 0xff;
    const a = bytes[3] & 0xff;
    return (((a << 24) | (b << 16) | (g << 8) | r) >>> 0);
}

// ---------------------------------------------------------------------------
// Объекты
// ---------------------------------------------------------------------------

const SAMPLE_MODES = ['linear', 'step', 'smooth', 'spline'];

function samplerFor(mode) {
    if (mode === 'step') return sampleStep;
    if (mode === 'smooth' || mode === 'spline') return sampleSpline;
    return sampleLinear;
}

/** Кривая значений: функция t → y плюс полезные методы. */
export function makeCurve(values, opts) {
    const spec = opts || {};
    const mode = SAMPLE_MODES.includes(spec.mode) ? spec.mode : 'linear';
    const points = normalizePoints(values, spec);
    const sample = samplerFor(mode);

    const curve = function (t) { return sample(points, t); };
    curve.mode = mode;
    curve.points = () => points.map((p) => ({ x: p.x, y: p.y }));
    /** Значение с зажимом t в 0..1. */
    curve.at = (t) => sample(points, clamp01(t));
    /** Сэмплы по равномерной сетке — для отрисовки или буфера. */
    curve.range = (count) => {
        const n = Math.max(2, Math.floor(count) || 2);
        const out = new Array(n);
        for (let i = 0; i < n; ++i) out[i] = sample(points, i / (n - 1));
        return out;
    };
    /** Сложить с другой кривой или числом: (a(t) + b(t)). */
    curve.plus = (other) => {
        const other_sample = typeof other === 'function' ? other : () => (Number(other) || 0);
        // Точки обеих кривых: в каждой считаем сумму, чтобы форма не терялась.
        const xs = [...new Set([...points.map((p) => p.x), 0, 1])].sort((a, b) => a - b);
        const merged = xs.map((x) => ({ x, y: sample(points, x) + Number(other_sample(x)) || 0 }));
        return makeCurve(merged, { mode });
    };
    return curve;
}

/** Градиент: точки цвета, интерполяция покомпонентно (не в sRGB — так честнее). */
export function makeGradient(stops, opts) {
    const spec = opts || {};
    const mode = SAMPLE_MODES.includes(spec.mode) ? spec.mode : 'linear';
    const list = [];
    // Принимаем и массив стопов, и одну строку со стрелками.
    const given = Array.isArray(stops) ? stops : (stops === undefined || stops === null ? [] : [stops]);

    // Строка вида '#fff → #f60 → #7a1f00' разбирается на стопы. Стрелку можно
    // писать как '→', '->' или '=>' — набор символов в редакторе бывает разный.
    const arrowText = given.length === 1 && typeof given[0] === 'string'
        ? given[0] : null;
    if (arrowText && /→|->|=>/.test(arrowText)) {
        const parts = arrowText.split(/→|->|=>/).map((s) => s.trim()).filter(Boolean);
        for (let i = 0; i < parts.length; ++i) {
            list.push({ x: parts.length <= 1 ? 0 : i / (parts.length - 1), color: colorToBytes(parts[i]) });
        }
    } else {
        const normalize = (entry, index, count) => {
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                return { x: Number(entry.at !== undefined ? entry.at : entry.x), color: colorToBytes(entry.color) };
            }
            if (Array.isArray(entry)) {
                return { x: Number(entry[0]), color: colorToBytes(entry[1]) };
            }
            return { x: count <= 1 ? 0 : index / (count - 1), color: colorToBytes(entry) };
        };
        for (let i = 0; i < given.length; ++i) list.push(normalize(given[i], i, given.length));
    }

    if (list.length === 0) list.push({ x: 0, color: [255, 255, 255, 255] });
    // Устойчивая сортировка: при равных x порядок стопов сохраняется, иначе
    // последний стоп мог «уехать» в середину.
    list.sort((a, b) => a.x - b.x);

    // Каждая компонента — своя кривая значений: так один код обслуживает и
    // линейный, и ступенчатый, и гладкий режим.
    const channels = [0, 1, 2, 3].map((c) => makeCurve(
        list.map((s) => ({ x: s.x, y: s.color[c] })), { mode }));

    const gradient = function (t) {
        const bytes = channels.map((ch) => Math.max(0, Math.min(255, Math.round(ch(t)))));
        return packColorBytes(bytes);
    };
    gradient.mode = mode;
    gradient.at = (t) => channels.map((ch) => Math.max(0, Math.min(255, Math.round(ch(clamp01(t))))));
    gradient.range = (count) => {
        const n = Math.max(2, Math.floor(count) || 2);
        const out = new Array(n);
        for (let i = 0; i < n; ++i) out[i] = gradient(i / (n - 1));
        return out;
    };
    gradient.stops = () => list.map((s) => ({ x: s.x, color: s.color.slice() }));
    return gradient;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

/** Готовые кривые по имени: монотонно 0→1 разными формами. */
function builtin(name) {
    switch (name) {
        case 'linear': return makeCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
        case 'easeIn': return makeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.16 }, { x: 1, y: 1 }], { mode: 'smooth' });
        case 'easeOut': return makeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.84 }, { x: 1, y: 1 }], { mode: 'smooth' });
        case 'easeInOut': return makeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }], { mode: 'smooth' });
        case 'pop': return makeCurve([0, 1.15, 1], { mode: 'smooth' });
        case 'bounce': return makeCurve([0, 1, 0.72, 1, 0.9, 1]);
        case 'pulse': return makeCurve([0, 1, 0]);
        case 'spike': return makeCurve([0, 0, 1, 0, 0]);
        case 'fadeOut': return makeCurve([{ x: 0, y: 1 }, { x: 1, y: 0 }], { mode: 'smooth' });
        case 'fadeIn': return makeCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }], { mode: 'smooth' });
        default: return null;
    }
}

export function installCurve($) {
    const named = new Map();

    const curve = {
        /** Создать кривую из значений или точек. */
        make(values, opts) { return makeCurve(values, opts); },

        /** Создать градиент из списка цветов или строки '#a → #b → #c'. */
        gradient(stops, opts) { return makeGradient(stops, opts); },

        /** Объявить именованную кривую (её можно использовать где угодно по имени). */
        define(name, values, opts) {
            const key = String(name || '').trim();
            if (!key) { ctx.log('$.curve.define: нужно имя'); return null; }
            const made = makeCurve(values, opts);
            named.set(key, made);
            return made;
        },

        /** Именованные кривые: заданные плюс встроенные. */
        get(name) {
            const key = String(name || '').trim();
            if (named.has(key)) return named.get(key);
            const preset = builtin(key);
            if (preset) return preset;
            return key ? null : null;
        },

        /** Готовая кривая по имени (сообщает, если имени нет). */
        use(name) {
            const made = curve.get(name);
            if (!made) ctx.log(`$.curve: нет кривой "${name}" — см. $.curve.names()`);
            return made;
        },

        /** Имена: сначала свои, потом встроенные. */
        names() {
            return [...new Set([...named.keys(), 'linear', 'easeIn', 'easeOut',
                'easeInOut', 'pop', 'bounce', 'pulse', 'spike', 'fadeIn', 'fadeOut'])].sort();
        },

        /** Кривая-значение из чего угодно: функция, число или имя. */
        resolve(value, fallback) {
            if (typeof value === 'function') return value;
            if (typeof value === 'string') {
                const made = curve.get(value);
                if (made) return made;
            }
            if (typeof value === 'number') return () => value;
            const base = typeof fallback === 'number' ? fallback : 0;
            return () => base;
        },

        /** Забыть именованную кривую. */
        remove(name) { return named.delete(String(name)); },
        clear() { const n = named.size; named.clear(); return n; },

        // Чистые помощники — доступны и снаружи модуля (для тестов).
        sample: sampleLinear,
        normalizePoints,
        colorToBytes,
        packColorBytes,
    };

    $.curve = curve;
    ctx.curve = curve;
    return curve;
}
