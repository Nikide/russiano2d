// ===========================================================================
// Юнит-тесты именованных слоёв коллизий (src/highlevel/collision.js).
//
// Проверяем то, что легко сломать: разбор имён, выражения масок с `|` и `!`,
// «все кроме», реестр с битами и определение через $.collision.define.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/collision_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import {
    normalizeLayers, layerBitOf, parseLayerExpression, MAX_LAYER_BIT,
} from '../../src/highlevel/collision.js';

const REG = {
    walls: { bit: 0x1 },
    enemies: { bit: 0x2 },
    player: { bit: 0x4 },
    pickups: { bit: 0x8 },
};

test('normalizeLayers принимает числа и объекты, отбрасывает мусор', () => {
    const out = normalizeLayers({ a: 2, b: { bit: 4, mask: 6 }, c: 'нет', d: null, '': 1 });
    eq(out.a.bit, 2);
    eq(out.b.bit, 4);
    eq(out.b.mask, 6);
    eq(Object.prototype.hasOwnProperty.call(out, 'c'), false, 'строка не бит');
    eq(Object.prototype.hasOwnProperty.call(out, 'd'), false, 'null не бит');
    eq(Object.prototype.hasOwnProperty.call(out, ''), false, 'пустое имя не хранится');
});

test('layerBitOf: имя, число, hex и набор через |', () => {
    eq(layerBitOf(REG, 'walls'), 1);
    eq(layerBitOf(REG, 'player'), 4);
    eq(layerBitOf(REG, 'walls|enemies'), 3);
    eq(layerBitOf(REG, 8), 8);
    eq(layerBitOf(REG, '0x8'), 8);
    eq(layerBitOf(REG, 'нет-такого'), 0);
    eq(layerBitOf(REG, ''), 0);
});

test('parseLayerExpression: перечисление, all, none', () => {
    eq(parseLayerExpression(REG, 'walls'), 1);
    eq(parseLayerExpression(REG, 'walls|enemies'), 3);
    eq(parseLayerExpression(REG, 'all'), 0xffffffff);
    eq(parseLayerExpression(REG, '*'), 0xffffffff);
    eq(parseLayerExpression(REG, 'none'), 0);
    eq(parseLayerExpression(REG, 7), 7, 'число проходит насквозь');
});

test('parseLayerExpression: ! исключает слой из всех', () => {
    // База по умолчанию — все известные слои, поэтому «!enemies» читается
    // как «со всеми, кроме врагов».
    eq(parseLayerExpression(REG, '!enemies'), (0x1 | 0x4 | 0x8) >>> 0);
    eq(parseLayerExpression(REG, 'walls|!enemies'), (0x1 | 0x4 | 0x8) >>> 0);
    eq(parseLayerExpression(REG, '!walls|!enemies'), (0x4 | 0x8) >>> 0);
});

test('parseLayerExpression: явная база важнее эвристики', () => {
    eq(parseLayerExpression(REG, '!walls', 0x1 | 0x2), 0x2);
    eq(parseLayerExpression(REG, 'enemies', 0x1), 0x1 | 0x2);
});

test('parseLayerExpression: пустое выражение — маска по умолчанию', () => {
    eq(parseLayerExpression(REG, ''), 0xffffffff);
    eq(parseLayerExpression(REG, undefined), 0xffffffff);
    eq(parseLayerExpression(REG, '', 5), 5);
});

test('MAX_LAYER_BIT оставляет запас под 16 категорий Box2D', () => {
    truthy(MAX_LAYER_BIT >= 15);
    truthy((1 << MAX_LAYER_BIT) <= 0x8000);
});

finish();
