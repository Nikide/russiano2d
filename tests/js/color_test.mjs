// ===========================================================================
// Юнит-тесты упаковки цвета (qjs + tests/js/_harness.mjs).
//
// Регрессия: packColor() возвращал число-цвет как есть и молча терял
// необязательный аргумент alpha. Из-за этого .alpha() не действовал на
// ui-узлы (панели, кнопки, картинки): drawUINode передаёт alpha вторым
// аргументом, а node.color — всегда уже упакованное число.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/color_test.mjs
// ===========================================================================

import { test, eq, near, finish } from './_harness.mjs';
import { packColor, withAlpha } from '../../src/highlevel/core.js';

const alphaByte = (packed) => (packed >>> 24) & 0xff;
const RED = engine.rgba(255, 0, 0, 255);

test('строковый цвет упаковывается как раньше', () => {
    eq(packColor('#ff0000'), RED);
    eq(packColor('red'), RED);
});

test('packColor(число) без alpha не меняет цвет', () => {
    eq(packColor(RED), RED);
});

test('packColor(число, alpha) накладывает alpha', () => {
    const half = packColor(RED, 0.5);
    eq(alphaByte(half), 128, 'альфа 0.5 → 128');
    eq(half & 0x00ffffff, RED & 0x00ffffff, 'RGB не тронут');
});

test('packColor(число, alpha) уважает границы 0 и 1', () => {
    eq(alphaByte(packColor(RED, 0)), 0);
    eq(alphaByte(packColor(RED, 1)), 255);
    eq(alphaByte(packColor(RED, 2)), 255, 'больше единицы не переполняет байт');
    eq(alphaByte(packColor(RED, -1)), 0, 'отрицательная не переполняет байт');
});

test('withAlpha не портит RGB и совпадает с packColor', () => {
    eq(withAlpha(RED, 0.25), packColor(RED, 0.25));
    eq(alphaByte(withAlpha(RED, 0.25)), 64);
});

test('packColor(undefined, alpha) — белый с заданной альфой', () => {
    const c = packColor(undefined, 0.5);
    eq(c & 0x00ffffff, 0x00ffffff);
    near(alphaByte(c), 128, 0);
});

finish();

