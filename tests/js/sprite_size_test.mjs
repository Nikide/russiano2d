// ===========================================================================
// Юнит-тесты размера спрайта (qjs + tests/js/_harness.mjs).
//
// Регрессия: spriteSize() возвращал [0,0] всегда, поэтому .sprite('hero.png')
// на узле <sprite> (ширина по умолчанию 32) не подхватывал размер картинки —
// узел оставался 32×32, и документированный рецепт
// $('<sprite>', { sprite: 'sky.png' }) рисовал крошечный квадрат.
//
// Движок не умеет спросить размер уже созданного спрайта, поэтому кадры
// запоминают свой размер в момент создания; здесь это и проверяется.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/sprite_size_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { Node, resolveSprite, resolveSheet, spriteSize, ctx } from '../../src/highlevel/core.js';

// Мок графики: три текстуры с разными размерами, спрайты получают растущие id.
const TEX = { 'hero.png': 1, 'sky.png': 2, 'coin.png': 3 };
const TEX_SIZE = { 1: [128, 64], 2: [1024, 256], 3: [16, 16] };
let next_sprite = 100;

ctx.$ = function () { return { nodes: [] }; };   // emit() зовёт глобальные подписки

engine.loadTexture = (path) => (TEX[path] === undefined ? -1 : TEX[path]);
engine.textureSize = (tex) => TEX_SIZE[tex] || [0, 0];
engine.createSprite = () => next_sprite++;

test('spriteSize знает размер картинки, созданной по пути', () => {
    const id = resolveSprite('hero.png');
    truthy(id > 0, 'спрайт создан');
    eq(spriteSize(id).join('x'), '128x64', 'размер взят у текстуры');
});

test('spriteSize знает размер вырезанного кадра', () => {
    const id = resolveSprite([2, 10, 20, 32, 48]);
    eq(spriteSize(id).join('x'), '32x48', 'размер кадра из аргументов');
});

test('spriteSize берёт текстуру, если w/h не заданы (0 = весь кадр)', () => {
    const id = resolveSprite([2, 0, 0, 0, 0]);
    eq(spriteSize(id).join('x'), '1024x256', '0 означает «вся текстура»');
});

test('spriteSize знает размер кадра листа', () => {
    const id = resolveSheet({ src: 'coin.png', cols: 4, rows: 2, cw: 16, ch: 16 });
    eq(spriteSize(id).join('x'), '16x16', 'кадр листа 16×16');
});

test('spriteSize для неизвестного id — нули, а не исключение', () => {
    eq(spriteSize(-1).join('x'), '0x0');
    eq(spriteSize(999999).join('x'), '0x0');
});

test('.sprite() подхватывает размер картинки у <sprite> с шириной по умолчанию', () => {
    const node = new Node('sprite');
    eq(node.w, 32, 'до спрайта ширина по умолчанию');
    node.set('sprite', 'sky.png');
    eq(node.w, 1024, 'ширина стала шириной картинки');
    eq(node.h, 256, 'высота стала высотой картинки');
});

test('.sprite() не трогает размер, выставленный явно', () => {
    const node = new Node('sprite');
    node.set('w', 40);
    node.set('h', 40);
    node.set('sprite', 'hero.png');
    eq(node.w, 40, 'явная ширина сохранилась');
    eq(node.h, 40, 'явная высота сохранилась');
});

finish();
