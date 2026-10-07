// ===========================================================================
// Юнит-тесты анимации тайлов (src/highlevel/tilemap.js): нормализация
// спецификации и расчёт кадра по времени.
//
// Проверяем то, что легко сломать: fps против interval, границы цикла,
// детерминированный «random» и ограничение по ids.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/tile_anim_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { normalizeTilesetAnim, tilesetFrame } from '../../src/highlevel/tilemap.js';

test('normalizeTilesetAnim: fps переводится в интервал', () => {
    const a = normalizeTilesetAnim({ frames: 4, fps: 10 });
    eq(a.frames, 4);
    eq(a.interval, 100);
    eq(a.ids, null);
    eq(a.random, false);
});

test('normalizeTilesetAnim: interval и ms работают напрямую', () => {
    eq(normalizeTilesetAnim({ frames: 2, interval: 120 }).interval, 120);
    eq(normalizeTilesetAnim({ frames: 2, ms: 250 }).interval, 250);
    eq(normalizeTilesetAnim({ frames: 2 }).interval, 200, 'значение по умолчанию');
});

test('normalizeTilesetAnim: ids принимает число и массив', () => {
    eq(JSON.stringify(normalizeTilesetAnim({ frames: 2, ids: 7 }).ids), '[7]');
    eq(JSON.stringify(normalizeTilesetAnim({ frames: 2, ids: [3, 5] }).ids), '[3,5]');
});

test('normalizeTilesetAnim: пустое и frames<1 поднимаются до единицы', () => {
    eq(normalizeTilesetAnim(null), null);
    eq(normalizeTilesetAnim({ frames: 0 }).frames, 1);
    truthy(normalizeTilesetAnim({ frames: 2, interval: 0 }).interval >= 1);
});

test('tilesetFrame: кадр идёт по времени и цикл замыкается', () => {
    eq(tilesetFrame(0, 100, 4, false, 0), 0);
    eq(tilesetFrame(150, 100, 4, false, 0), 1);
    eq(tilesetFrame(450, 100, 4, false, 0), 4 % 4);
    eq(tilesetFrame(500, 100, 4, false, 0), 1, 'после полного круга');
    eq(tilesetFrame(1000, 100, 3, false, 0), 1);
});

test('tilesetFrame: один кадр и нулевой интервал — всегда 0', () => {
    eq(tilesetFrame(999999, 100, 1, false, 0), 0);
    eq(tilesetFrame(123, 0, 4, false, 0), 0);
});

test('tilesetFrame: random детерминирован для одного зерна', () => {
    const a = tilesetFrame(1000, 100, 4, true, 7);
    const b = tilesetFrame(1000, 100, 4, true, 7);
    eq(a, b, 'одно зерно — один кадр');
    truthy(a >= 0 && a < 4);
    const c = tilesetFrame(1000, 100, 4, true, 8);
    truthy(c >= 0 && c < 4, 'другое зерно тоже в диапазоне');
});

test('tilesetFrame: отрицательное время не ломает индекс', () => {
    const v = tilesetFrame(-250, 100, 4, false, 0);
    truthy(v >= 0, `кадр ${v} не отрицательный`);
});

finish();
