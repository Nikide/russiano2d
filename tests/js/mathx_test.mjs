// ===========================================================================
// Юнит-тест $.math — чистые функции без движка.
//
//   build/_deps/quickjs-build/qjs tests/js/mathx_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    clamp, lerp, inverseLerp, remap, moveTowards, smoothstep, approach,
    wrap, pingPong, snap, angleDiff, deg, rad, sign, roundTo,
    vec2, vecLength, vecLengthSq, vecNormalize, vecAdd, vecSub, vecScale,
    vecDot, vecDist, vecLerp, vecRotate, vecFromAngle, vecAngle,
    rect, rectContains, rectOverlap, rectIntersect, rectCenter, rectGrow,
    installMath,
} from '../../src/highlevel/mathx.js';

const PI = Math.PI;

// --- Числа -----------------------------------------------------------------

test('clamp ограничивает значение с двух сторон', () => {
    eq(clamp(5, 0, 10), 5);
    eq(clamp(-1, 0, 10), 0);
    eq(clamp(11, 0, 10), 10);
});

test('clamp терпит перепутанные границы', () => {
    eq(clamp(5, 10, 0), 5);
    eq(clamp(-3, 10, 0), 0);
});

test('lerp и inverseLerp согласованы', () => {
    eq(lerp(10, 20, 0), 10);
    eq(lerp(10, 20, 1), 20);
    eq(lerp(10, 20, 0.5), 15);
    near(inverseLerp(10, 20, 15), 0.5);
});

test('inverseLerp с нулевым диапазоном не делит на ноль', () => {
    eq(inverseLerp(7, 7, 7), 0);
    truthy(isFinite(inverseLerp(7, 7, 100)));
});

test('remap пересчитывает диапазон', () => {
    eq(remap(5, 0, 10, 0, 100), 50);
    eq(remap(0, 0, 100, 0, 1), 0);
    near(remap(25, 0, 100, 0, 1), 0.25);
});

test('moveTowards идёт к цели, но не перелетает', () => {
    eq(moveTowards(0, 10, 3), 3);
    eq(moveTowards(0, 10, 100), 10);
    eq(moveTowards(10, 0, 3), 7);
    eq(moveTowards(5, 5, 3), 5);
});

test('smoothstep: нули на краях, 0.5 в середине, 1 за правым краем', () => {
    eq(smoothstep(0, 1, -5), 0);
    near(smoothstep(0, 1, 0.5), 0.5);
    eq(smoothstep(0, 1, 5), 1);
    truthy(smoothstep(0, 1, 0.25) < 0.25, 'S-кривая отстаёт на первой половине');
});

test('smoothstep с совпавшими границами — ступенька', () => {
    eq(smoothstep(2, 2, 1), 0);
    eq(smoothstep(2, 2, 2), 1);
    eq(smoothstep(2, 2, 3), 1);
});

test('approach сглаживает и не перелетает цель', () => {
    const one = approach(0, 100, 10, 1 / 60);
    truthy(one > 0 && one < 100, 'за один кадр значение сдвинулось к цели');
    let v = 0;
    for (let i = 0; i < 600; i++) v = approach(v, 100, 10, 1 / 60);
    truthy(v <= 100, 'перелёта нет');
    near(v, 100, 0.01);
});

test('approach при dt = 0 и rate = 0 ничего не меняет', () => {
    eq(approach(3, 100, 10, 0), 3);
    eq(approach(3, 100, 0, 1 / 60), 3);
});

test('wrap заворачивает в [min, max), включая отрицательные', () => {
    eq(wrap(3, 0, 10), 3);
    eq(wrap(12, 0, 10), 2);
    eq(wrap(-1, 0, 10), 9);
    near(wrap(-0.25, 0, 1), 0.75);
    near(wrap(-PI / 2, 0, PI * 2), PI * 1.5);
});

test('wrap с вырожденным диапазоном отдаёт min', () => {
    eq(wrap(5, 3, 3), 3);
    eq(wrap(5, 3, 2), 3);
});

test('pingPong ходит туда-обратно', () => {
    eq(pingPong(0, 2), 0);
    eq(pingPong(1, 2), 1);
    eq(pingPong(2, 2), 2);
    eq(pingPong(3, 2), 1);
    eq(pingPong(4, 2), 0);
    eq(pingPong(5, 2), 1);
});

test('snap притягивает к шагу, нулевой шаг ничего не портит', () => {
    eq(snap(37, 16), 32);
    eq(snap(40, 16), 48, 'ровно половина шага округляется вверх, как Math.round');
    eq(snap(-37, 16), -32);
    eq(snap(5, 0), 5);
    eq(snap(5, -2), 5);
});

test('angleDiff выбирает короткий путь', () => {
    near(angleDiff(0, PI / 2), PI / 2);
    near(angleDiff(0, PI * 1.5), -PI / 2);
    near(angleDiff(PI / 2, 0), -PI / 2);
    near(angleDiff(0.1, 0.1 + PI * 2), 0, 1e-9);
});

test('deg и rad обратимы', () => {
    near(deg(PI), 180);
    near(rad(180), PI);
    near(deg(rad(37)), 37);
});

test('sign различает знаки', () => {
    eq(sign(3), 1);
    eq(sign(-3), -1);
    eq(sign(0), 0);
});

test('roundTo округляет и в дробную, и в целую сторону', () => {
    near(roundTo(1.2345, 2), 1.23);
    near(roundTo(1.2355, 2), 1.24);
    eq(roundTo(1.6), 2);
    eq(roundTo(1234, -2), 1200);
});

// --- Векторы ---------------------------------------------------------------

test('vec2, длина и нормализация', () => {
    const v = vec2(3, 4);
    eq(v.x, 3);
    eq(v.y, 4);
    eq(vecLength(v), 5);
    eq(vecLengthSq(v), 25);
    near(vecLength(vecNormalize(v)), 1);
    near(vecNormalize(v).x, 0.6);
});

test('нормализация нулевого вектора не даёт NaN', () => {
    const n = vecNormalize(vec2(0, 0));
    eq(n.x, 0);
    eq(n.y, 0);
});

test('поворот вектора: 90° и полный оборот', () => {
    const r = vecRotate(vec2(1, 0), PI / 2);
    near(r.x, 0, 1e-9);
    near(r.y, 1, 1e-9);
    const full = vecRotate(vec2(3, -2), PI * 2);
    near(full.x, 3, 1e-9);
    near(full.y, -2, 1e-9);
});

test('арифметика векторов, скалярное произведение и расстояние', () => {
    const a = vec2(1, 2);
    const b = vec2(4, 6);
    eq(vecAdd(a, b).x, 5);
    eq(vecSub(b, a).y, 4);
    eq(vecScale(a, 3).x, 3);
    eq(vecDot(a, b), 16);
    eq(vecDist(a, b), 5);
    near(vecLerp(a, b, 0.5).x, 2.5);
});

test('vecFromAngle и vecAngle — взаимно обратные', () => {
    const v = vecFromAngle(PI / 3, 2);
    near(vecLength(v), 2);
    near(vecAngle(v), PI / 3);
    eq(vecFromAngle(0).x, 1);
    eq(vecFromAngle(0).y, 0);
});

test('операции с векторами не меняют исходные объекты', () => {
    const a = vec2(1, 2);
    vecAdd(a, vec2(10, 10));
    vecRotate(a, 1);
    vecNormalize(a);
    eq(a.x, 1);
    eq(a.y, 2);
});

// --- Прямоугольники --------------------------------------------------------

test('rect и rectContains: границы включительно', () => {
    const r = rect(10, 20, 30, 40);
    truthy(rectContains(r, { x: 10, y: 20 }), 'левый верхний угол внутри');
    truthy(rectContains(r, 40, 60), 'правый нижний угол внутри — форма (r, x, y)');
    falsy(rectContains(r, 40.5, 30), 'чуть правее — уже нет');
    falsy(rectContains(r, { x: 9, y: 30 }));
});

test('rectOverlap и rectIntersect', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 10, 10);
    const c = rect(20, 20, 5, 5);
    truthy(rectOverlap(a, b));
    falsy(rectOverlap(a, c));
    eq(rectIntersect(a, c), null, 'у далёких прямоугольников пересечения нет');
    const x = rectIntersect(a, b);
    eq(x.x, 5);
    eq(x.y, 5);
    eq(x.w, 5);
    eq(x.h, 5);
});

test('касание краями — не пересечение', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(10, 0, 10, 10);
    falsy(rectOverlap(a, b));
    eq(rectIntersect(a, b), null);
});

test('rectCenter и rectGrow', () => {
    const c = rectCenter(rect(10, 20, 30, 40));
    eq(c.x, 25);
    eq(c.y, 40);
    const g = rectGrow(rect(0, 0, 10, 10), 2);
    eq(g.x, -2);
    eq(g.w, 14);
    const s = rectGrow(rect(0, 0, 10, 10), -2);
    eq(s.x, 2);
    eq(s.w, 6);
});

// --- Установка -------------------------------------------------------------

test('installMath кладёт те же чистые функции в $.math', () => {
    const $ = {};
    const math = installMath($);
    truthy($.math === math, '$.math установлено');
    eq($.math.clamp(-5, 0, 1), 0);
    truthy($.math.lerp === lerp, 'под пространством имён та же функция, без копии');
    truthy($.math.vecNormalize === vecNormalize);
    truthy($.math.rectIntersect === rectIntersect);
    eq($.math.vecLength($.math.vec2(6, 8)), 10);
});

finish();
