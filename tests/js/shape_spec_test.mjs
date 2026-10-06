// ===========================================================================
// Юнит-тест разбора описания формы для свипа ($.world.castShape / .sweepTo).
//
// Сам свип считает Box2D — его проверяет агентский тест; здесь под проверкой
// чистая функция shapeSpec(): какие размеры уедут в движок для каждой записи
// формы. Ошибка тут тихо превращала бы «круг радиусом 12» в прямоугольник
// 32×32, и свип врал бы о проёмах.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/shape_spec_test.mjs
// ===========================================================================

import { test, eq, near, finish } from './_harness.mjs';
import { shapeSpec } from '../../src/highlevel/world.js';

test('без описания — прямоугольник 32×32', () => {
    const s = shapeSpec();
    eq(s.shape, 'box');
    near(s.half_w, 16);
    near(s.half_h, 16);
    eq(s.radius, 0);
});

test('w/h задают прямоугольник, halfW/halfH — напрямую', () => {
    let s = shapeSpec({ w: 24, h: 40 });
    eq(s.shape, 'box');
    near(s.half_w, 12);
    near(s.half_h, 20);

    s = shapeSpec({ halfW: 8, halfH: 8 });
    near(s.half_w, 8);
    near(s.half_h, 8);
});

test('radius без shape — это круг, а не прямоугольник', () => {
    const s = shapeSpec({ radius: 12 });
    eq(s.shape, 'circle');
    near(s.radius, 12);
    near(s.half_w, 12);
    near(s.half_h, 12);
});

test('капсула: [радиус, половина отрезка]', () => {
    const s = shapeSpec({ capsule: [10, 20] });
    eq(s.shape, 'capsule');
    near(s.radius, 10);
    near(s.half_h, 20);
});

test('капсула числом: радиус, отрезок берётся из h', () => {
    const s = shapeSpec({ capsule: 6, h: 30 });
    eq(s.shape, 'capsule');
    near(s.radius, 6);
    near(s.half_h, 15);
});

test('shape строкой главнее догадок', () => {
    const s = shapeSpec({ shape: 'circle', halfW: 40, halfH: 40 });
    eq(s.shape, 'circle');
    near(s.radius, 40, 1e-9, 'радиус круга берётся из полуразмера');
});

test('нули и мусор не превращаются в NaN', () => {
    const s = shapeSpec({ w: 0, h: 0, radius: 0 });
    eq(s.shape, 'box');
    near(s.half_w, 0);
    near(s.half_h, 0);

    const bad = shapeSpec({ w: 'широкий', radius: null });
    eq(bad.shape, 'box');
    near(bad.half_w, 16);

    const circle = shapeSpec({ shape: 'circle', radius: -5 });
    near(circle.radius, 16, 1e-9, 'отрицательный радиус — умолчание');
});

finish();
