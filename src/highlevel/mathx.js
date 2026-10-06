// ===========================================================================
// Математика: $.math — чистые функции, которых не хватает каждой игре.
//
// Здесь нет ни одного обращения к движку: всё это чистые функции, поэтому
// модуль целиком проверяется через qjs без сборки (tests/js/mathx_test.mjs).
//
//   $.math.clamp(hp, 0, maxHp);
//   $.math.approach(cam.x, target.x, 8, dt);        // сглаживание без рывков
//   $.math.vecNormalize($.math.vecSub(b, a));       // направление от a к b
//
// Соглашения:
//   * углы — в радианах, положительное направление — по часовой стрелке на
//     экране (ось Y смотрит вниз, как во всём движке);
//   * функции не меняют переданные объекты, а возвращают новые — иначе
//     случайная правка вектора ломала бы чужое состояние;
//   * порядок аргументов у отрезков и диапазонов — «откуда, куда», у
//     интерполяций — «a, b, t».
// ===========================================================================

import { ctx } from './core.js';

const PI = Math.PI;
const TAU = PI * 2;

// ---------------------------------------------------------------------------
// Числа
// ---------------------------------------------------------------------------

/** Ограничить значение диапазоном [lo, hi]. Перепутанные границы меняются местами. */
export function clamp(value, lo, hi) {
    let a = lo;
    let b = hi;
    if (a > b) { const t = a; a = b; b = t; }
    if (value < a) return a;
    if (value > b) return b;
    return value;
}

/** Линейная интерполяция: t = 0 → a, t = 1 → b. t вне [0,1] тоже работает (экстраполяция). */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Обратная интерполяция: какая доля пути от a к b пройдена значением v.
 * Нулевой диапазон (a === b) не делится на ноль, а даёт 0.
 */
export function inverseLerp(a, b, v) {
    if (a === b) return 0;
    return (v - a) / (b - a);
}

/** Пересчёт значения из одного диапазона в другой: remap(hp, 0, 100, 0, 1). */
export function remap(v, inMin, inMax, outMin, outMax) {
    return lerp(outMin, outMax, inverseLerp(inMin, inMax, v));
}

/** Шаг к цели не больше maxDelta (в единицах значения). Перелёт невозможен. */
export function moveTowards(current, target, maxDelta) {
    const step = Math.abs(Number(maxDelta) || 0);
    const d = target - current;
    if (Math.abs(d) <= step) return target;
    return current + (d < 0 ? -step : step);
}

/** Плавная ступенька: 0 при x <= edge0, 1 при x >= edge1, S-кривая между ними. */
export function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Экспоненциальное приближение к цели, независимое от частоты кадров.
 * rate — «жёсткость» (1/сек): больше — быстрее. При dt = 0 значение не меняется.
 */
export function approach(current, target, rate, dt) {
    const r = Number(rate);
    const step = Number(dt);
    if (!(r > 0) || !(step > 0)) return current;
    return target + (current - target) * Math.exp(-r * step);
}

/** Завернуть значение в диапазон [min, max) — как угол в 0..2π. */
export function wrap(value, min, max) {
    const span = max - min;
    if (!(span > 0)) return min;
    let t = (value - min) % span;
    if (t < 0) t += span;
    return min + t;
}

/** «Туда-обратно»: 0 → len → 0 → len… Период — 2*len. */
export function pingPong(value, length) {
    const len = Number(length);
    if (!(len > 0)) return 0;
    const t = wrap(value, 0, len * 2);
    return t <= len ? t : len * 2 - t;
}

/** Притянуть к сетке с шагом step: snap(37, 16) → 32. Шаг <= 0 — значение без изменений. */
export function snap(value, step) {
    const s = Number(step);
    if (!(s > 0)) return value;
    return Math.round(value / s) * s;
}

/**
 * Кратчайшая разница углов «от from к to» в диапазоне [-π, π].
 * Ровно π даёт -π: +π и -π — один и тот же поворот, выбираем соглашение.
 */
export function angleDiff(from, to) {
    let d = (to - from) % TAU;
    if (d > PI) d -= TAU;
    if (d < -PI) d += TAU;
    return d;
}

/** Радианы → градусы. */
export function deg(radians) {
    return radians * 180 / PI;
}

/** Градусы → радианы. */
export function rad(degrees) {
    return degrees * PI / 180;
}

/** Знак числа: -1, 0 или 1 (у NaN — 0). */
export function sign(value) {
    if (value > 0) return 1;
    if (value < 0) return -1;
    return 0;
}

/**
 * Округлить до digits знаков после запятой. Отрицательные digits округляют
 * до десятков и сотен: roundTo(1234, -2) → 1200.
 */
export function roundTo(value, digits) {
    const d = digits === undefined ? 0 : Math.trunc(Number(digits) || 0);
    const m = Math.pow(10, d);
    if (!isFinite(m) || m === 0) return value;
    return Math.round(value * m) / m;
}

// ---------------------------------------------------------------------------
// Векторы
//
// Вектор — обычный объект { x, y }: его можно положить в JSON, сравнить
// глазами в консоли и передать в любой метод узла. Методов у него нет
// намеренно — иначе векторы перестали бы быть «просто данными».
// ---------------------------------------------------------------------------

/** Вектор из двух чисел: vec2(3, 4). */
export function vec2(x, y) {
    return { x: Number(x) || 0, y: Number(y) || 0 };
}

/** Длина вектора. */
export function vecLength(v) {
    return Math.hypot(v.x, v.y);
}

/** Квадрат длины — дешевле, когда нужно только сравнить расстояния. */
export function vecLengthSq(v) {
    return v.x * v.x + v.y * v.y;
}

/** Единичный вектор. Нулевой вектор остаётся нулевым (направления нет). */
export function vecNormalize(v) {
    const len = Math.hypot(v.x, v.y);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
}

/** Сложение векторов. */
export function vecAdd(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}

/** Разность a - b (обычно: «направление от b к a»). */
export function vecSub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}

/** Умножение вектора на число. */
export function vecScale(v, s) {
    return { x: v.x * s, y: v.y * s };
}

/** Скалярное произведение: > 0 — векторы смотрят в одну сторону. */
export function vecDot(a, b) {
    return a.x * b.x + a.y * b.y;
}

/** Расстояние между точками. */
export function vecDist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Линейная интерполяция между векторами. */
export function vecLerp(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Поворот вектора на угол (радианы). На экране с осью Y вниз — по часовой стрелке. */
export function vecRotate(v, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Вектор из угла: vecFromAngle(0) → { x: 1, y: 0 }. Длина по умолчанию — 1. */
export function vecFromAngle(angle, length) {
    const len = length === undefined ? 1 : Number(length) || 0;
    return { x: Math.cos(angle) * len, y: Math.sin(angle) * len };
}

/** Угол вектора: atan2(y, x) в диапазоне [-π, π]. */
export function vecAngle(v) {
    return Math.atan2(v.y, v.x);
}

// ---------------------------------------------------------------------------
// Прямоугольники
//
// Прямоугольник — { x, y, w, h }, где x/y — левый верхний угол (та же система,
// что у $.grid и $.nav). Ширина и высота должны быть неотрицательными.
// ---------------------------------------------------------------------------

/** Прямоугольник по левому верхнему углу и размерам. */
export function rect(x, y, w, h) {
    return { x: Number(x) || 0, y: Number(y) || 0, w: Number(w) || 0, h: Number(h) || 0 };
}

/** Точка внутри прямоугольника. Границы включительно. */
export function rectContains(r, a, b) {
    const p = b === undefined ? a : { x: a, y: b };
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Пересекаются ли прямоугольники. Касание краями пересечением не считается. */
export function rectOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Пересечение прямоугольников или null, если его нет. */
export function rectIntersect(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= x || bottom <= y) return null;
    return { x, y, w: right - x, h: bottom - y };
}

/** Центр прямоугольника. */
export function rectCenter(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Расширить прямоугольник на amount со всех сторон (amount < 0 — сжать). */
export function rectGrow(r, amount) {
    const a = Number(amount) || 0;
    return { x: r.x - a, y: r.y - a, w: r.w + a * 2, h: r.h + a * 2 };
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

/**
 * Подключить $.math. Побочных эффектов нет: под пространством имён лежат те же
 * чистые функции, что экспортирует модуль.
 */
export function installMath($) {
    const math = {
        clamp,
        lerp,
        inverseLerp,
        remap,
        moveTowards,
        smoothstep,
        approach,
        wrap,
        pingPong,
        snap,
        angleDiff,
        deg,
        rad,
        sign,
        roundTo,

        vec2,
        vecLength,
        vecLengthSq,
        vecNormalize,
        vecAdd,
        vecSub,
        vecScale,
        vecDot,
        vecDist,
        vecLerp,
        vecRotate,
        vecFromAngle,
        vecAngle,

        rect,
        rectContains,
        rectOverlap,
        rectIntersect,
        rectCenter,
        rectGrow,
    };

    $.math = math;
    ctx.math = math;
    return math;
}
