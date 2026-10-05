// ===========================================================================
// Юнит-тесты подсистемы слоёв ($.layers) без движка.
//
// Проверяем то, что легко сломать и что нельзя увидеть в интеграционном
// тесте: формулу параллакса, доминирование слоя в ключе сортировки,
// перезакрепление якоря после ручного сдвига узла и распространение порядка
// слоя на потомков (в том числе после смены порядка).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/layers_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { Node, wrapOne, ctx } from '../../src/highlevel/core.js';
import { installCamera } from '../../src/highlevel/camera.js';
import {
    installLayers, tickLayers, parallaxOffset, layerSortKey,
} from '../../src/highlevel/layers.js';

// $.layers ставится на пустой объект: логике подсистемы движок не нужен.
const $ = {};
installLayers($);
// Камера нужна как источник cam.x/cam.y для параллакса. В api.js ссылку
// $.camera выставляет установщик — в юнит-тесте делаем это руками.
installCamera($);
$.camera = ctx.camera;
// Node.emit() в ядре рассылает глобальные подписки через ctx.$ — заглушка.
ctx.$ = { _dispatchGlobal: () => {} };

/** Свежий узел под тест. */
function makeNode(tag, attrs) {
    return new Node(tag || 'rect', attrs || {});
}

/** Присоединяет узел к контейнеру в обход api.js (там этого нет в юнит-тесте). */
function attach(child, parent) {
    child.parent_node = parent;
    parent.child_nodes.push(child);
    return child;
}

// --- Чистые функции ---------------------------------------------------------

test('parallaxOffset: f=0 приколот к экрану, f=1 как мир, f=0.5 вдвое медленнее', () => {
    near(parallaxOffset(10, 100, 0), 110, 1e-9);
    near(parallaxOffset(10, 100, 1), 10, 1e-9);
    near(parallaxOffset(10, 100, 0.5), 60, 1e-9);
    near(parallaxOffset(-5, 40, 0.25), 25, 1e-9);
});

test('parallaxOffset терпит нечисловые аргументы', () => {
    eq(parallaxOffset(undefined, 100, 0.5), 50);
    eq(parallaxOffset(10, NaN, 0.5), 10);
    eq(parallaxOffset(10, 100, undefined), 110);
    eq(parallaxOffset(10, 100, 2), -90);
});

test('layerSortKey: слой важнее глубины, глубина — тайбрейк', () => {
    truthy(layerSortKey(0, 100) < layerSortKey(1, -100), 'слой должен доминировать');
    truthy(layerSortKey(2, 1) < layerSortKey(2, 5), 'внутри слоя решает глубина');
    truthy(layerSortKey(2, 5) < layerSortKey(3, 0), 'следующий слой выше');
    eq(layerSortKey(3, -4), 3 * 1e6 - 4);
    eq(layerSortKey({ layer: 5, depth: 7 }), 5 * 1e6 + 7);
    eq(layerSortKey(7, undefined), 7 * 1e6);
});

// --- Тег и реестр -----------------------------------------------------------

test('create создаёт <layer> с именем, порядком и адресуемой обёрткой', () => {
    const w = $.layers.create({ name: 'probe', order: 5 });
    eq(w.length, 1);
    eq(w.get(0).tag, 'layer');
    eq(w.get(0).layer, 5);
    truthy($.layers.has('probe'));
    eq($.layers.get('probe').length, 1);
    eq($.layers.get('probe').get(0), w.get(0));
    eq($.layers.of(w), 'probe');
    $.layers.remove('probe');
    falsy($.layers.has('probe'));
});

test('list/order/current отдают слои снизу вверх', () => {
    $.layers.clear();
    $.layers.create({ name: 'low', order: -10 });
    $.layers.create({ name: 'mid', order: 0 });
    $.layers.create({ name: 'high', order: 20 });

    eq($.layers.list().join(','), 'low,mid,high');
    eq($.layers.order('mid'), 0);
    eq($.layers.current(), 'high');
    eq($.layers.order().length, 3);
    eq($.layers.order()[0].name, 'low');

    $.layers.order('low', 30);
    eq($.layers.list().join(','), 'mid,high,low');
    eq($.layers.current(), 'low');

    $.layers.bringToFront('mid');
    eq($.layers.current(), 'mid');
    $.layers.sendToBack('mid');
    eq($.layers.list()[0], 'mid');

    $.layers.clear();
    eq($.layers.list().length, 0);
});

test('show/hide/toggle распространяются на потомков', () => {
    $.layers.clear();
    const layer = $.layers.create({ name: 'vis' }).get(0);
    const child = attach(makeNode('rect'), layer);
    const grand = attach(makeNode('rect'), child);

    eq($.layers.hide('vis'), true);
    falsy(layer.visible);
    falsy(child.visible);
    falsy(grand.visible);

    eq($.layers.toggle('vis'), true);
    truthy(layer.visible);
    truthy(child.visible);
    truthy(grand.visible);

    tickLayers(1 / 60);
    falsy($.layers.hide('нет-такого'));
    $.layers.clear();
});

test('скрытый слой прячет и позже добавленного ребёнка', () => {
    $.layers.clear();
    const layer = $.layers.create({ name: 'late' }).get(0);
    $.layers.hide('late');
    const late_child = attach(makeNode('rect'), layer);
    tickLayers(1 / 60);            // распространение видимости идёт в tick
    falsy(late_child.visible);
    $.layers.clear();
});

// --- Распространение порядка -------------------------------------------------

test('порядок слоя проставляется детям и внукам', () => {
    $.layers.clear();
    const layer = $.layers.create({ name: 'tree', order: 7 }).get(0);
    const child = attach(makeNode('rect'), layer);
    const grand = attach(makeNode('rect'), child);
    const stranger = makeNode('rect');

    tickLayers(1 / 60);
    eq(child.layer, 7);
    eq(grand.layer, 7);
    eq(stranger.layer, 0);

    // Смена порядка переписывает поддерево, не трогая посторонних.
    $.layers.order('tree', 42);
    eq(layer.layer, 42);
    eq(child.layer, 42);
    eq(grand.layer, 42);
    eq(stranger.layer, 0);
    $.layers.clear();
});

test('прямая смена node.layer у слоя считается новым порядком', () => {
    $.layers.clear();
    const layer = $.layers.create({ name: 'direct', order: 4 }).get(0);
    // Аналог цепочного .layer(9) из ядра мимо $.layers.order().
    layer.layer = 9;
    tickLayers(1 / 60);
    eq($.layers.order('direct'), 9);
    $.layers.clear();
});

test('вложенный слой сохраняет свой порядок, его дети — свой', () => {
    $.layers.clear();
    const outer = $.layers.create({ name: 'outer', order: 5 }).get(0);
    const inner = $.layers.create({ name: 'inner', order: 3 }).get(0);
    attach(inner, outer);
    const inner_child = attach(makeNode('rect'), inner);

    tickLayers(1 / 60);
    eq(outer.layer, 5);
    eq(inner.layer, 3);
    eq(inner_child.layer, 3);
    $.layers.clear();
});

// --- Параллакс на узле -------------------------------------------------------

test('parallaxOffset применяется через $.layers.parallax и tickLayers', () => {
    $.camera.at(0, 0);
    const node = makeNode('rect', { x: 0, y: 0 });
    $.layers.parallax(node, 0.5);
    eq($.layers.parallax(node), 0.5);

    tickLayers(1 / 60);
    near(node.x, 0, 1e-6);

    $.camera.at(100, 0);
    tickLayers(1 / 60);
    near(node.x, 50, 1e-6);            // 0 + 100 * (1 - 0.5)
    $.camera.at(200, 0);
    tickLayers(1 / 60);
    near(node.x, 100, 1e-6);
});

test('метод узла .parallax(f) ставит и читает коэффициент', () => {
    const node = makeNode('rect', { x: 5, y: 0 });
    const w = wrapOne(node);
    eq(w.parallax(), null);
    w.parallax(0.25);
    eq(w.parallax(), 0.25);
    w.parallax(null);
    eq(w.parallax(), null);
});

test('якорь перезакрепляется после ручного сдвига узла', () => {
    $.camera.at(0, 0);
    const node = makeNode('rect', { x: 0, y: 0 });
    wrapOne(node).parallax(0.5);
    tickLayers(1 / 60);

    $.camera.at(100, 0);
    tickLayers(1 / 60);
    near(node.x, 50, 1e-6);

    // Игра сама двигает узел: якорь должен перезакрепиться за позицией 10.
    node.x = 10;
    tickLayers(1 / 60);
    near(node.x, 10, 1e-6);

    $.camera.at(200, 0);
    tickLayers(1 / 60);
    near(node.x, 60, 1e-6);            // -40 + 200 * 0.5
});

test('f=1 не двигает узел, f=0 ведёт его за камерой один в один', () => {
    $.camera.at(0, 0);
    const world = makeNode('rect', { x: 30, y: 0 });
    const pinned = makeNode('rect', { x: 0, y: 0 });
    $.layers.parallax(world, 1);
    $.layers.parallax(pinned, 0);

    $.camera.at(120, 50);
    tickLayers(1 / 60);
    near(world.x, 30, 1e-6);
    near(pinned.x, 120, 1e-6);         // 0 + cam.x
    near(pinned.y, 50, 1e-6);
});

test('параллакс слоя раздаётся потомкам, у которых своего нет', () => {
    $.layers.clear();
    $.camera.at(0, 0);
    const layer = $.layers.create({ name: 'plx', order: 2, parallax: 0.5 }).get(0);
    const child = attach(makeNode('rect', { x: 0, y: 0 }), layer);
    const own = attach(makeNode('rect', { x: 0, y: 0 }), layer);
    $.layers.parallax(own, 1);

    tickLayers(1 / 60);
    eq(child.parallax_factor, 0.5);
    eq(own.parallax_factor, 1);

    $.camera.at(100, 0);
    tickLayers(1 / 60);
    near(child.x, 50, 1e-6);           // унаследовал 0.5
    near(own.x, 0, 1e-6);              // свой f=1 — стоит на месте
    $.layers.clear();
});

test('узлы с физическим телом параллакс не двигает', () => {
    $.camera.at(0, 0);
    const node = makeNode('rect', { x: 0, y: 0 });
    node.body = 7;                     // имитация тела Box2D
    wrapOne(node).parallax(0.5);
    $.camera.at(100, 0);
    tickLayers(1 / 60);
    near(node.x, 0, 1e-6);             // позицию двигает физика, а не слои
    node.body = -1;
});

// --- Оттенок и затемнение ----------------------------------------------------

test('modulate читается и задаётся, alpha=0 выключает', () => {
    eq($.layers.modulate().alpha, 0);
    $.layers.modulate('#000000', 0.5);
    near($.layers.modulate().alpha, 0.5, 1e-9);
    $.layers.modulate(null);
    eq($.layers.modulate().alpha, 0);
});

test('fade/fadeTo/fadeOut меняют альфу по кадрам', () => {
    $.layers.fade('#000000', 1);
    near($.layers.fade().alpha, 1, 1e-9);

    $.layers.fadeTo('#000000', 0, 100);
    tickLayers(0.05);
    near($.layers.fade().alpha, 0.5, 0.01);
    tickLayers(0.05);
    near($.layers.fade().alpha, 0, 1e-9);

    $.layers.fade('#000000', 0.25);
    $.layers.fadeOut(1000);
    tickLayers(0.5);
    truthy($.layers.fade().alpha > 0.25 && $.layers.fade().alpha < 1);
    $.layers.fade('#000000', 0);
});

finish();
