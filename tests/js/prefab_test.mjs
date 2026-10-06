// ===========================================================================
// Юнит-тесты prefab-системы ($.prefab) без движка.
//
// Проверяем ровно то, что легко сломать и что не видно в интеграционном тесте:
//   * сериализацию узла (нет функций, тело и спрайт — описанием, не id);
//   * идемпотентность save → load → save;
//   * наследование extend + overrides + add;
//   * count и защиту от дубликатов id;
//   * JSON round-trip и клонирование поддерева.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/prefab_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { Node, wrapOne, ctx, packColor } from '../../src/highlevel/core.js';
import {
    installPrefab, tickPrefab, nodeToData, applyData, dataToSpec,
    mergeSpec, applyOverrides, sanitize, prefabOf,
} from '../../src/highlevel/prefab.js';

// $.prefab ставится на пустой объект: чистой логике движок не нужен.
const $ = {};
installPrefab($);

// Node.destroy() рассылает remove через ctx.$; в движке $ уже создан.
ctx.$ = { _dispatchGlobal: () => {} };

function clearWorld() {
    for (const node of ctx.nodes.slice()) node.destroy();
    ctx.byId.clear();
    ctx.byBody.clear();
}

/** Дерево «игрок + шляпа» со всеми видами полей, включая функции в attrs. */
function makeTree() {
    const root = new Node('player', { id: 'root', x: 10, y: 20, class: 'hero elite' });
    root.w = 30;
    root.h = 44;
    root.max_hp = 120;
    root.cur_hp = 90;
    root.team = 3;
    root.addTag('boss');
    root.dataMap().set('score', 7);
    root.dataMap().set('flags', { seen: true, notes: [1, 2, 3] });
    root.color = packColor('#ff0000');
    root.setSprite('art/hero.png');
    root.attrs.script = () => {};        // функции обязаны исчезнуть
    root.dataMap().set('callback', () => {});

    const child = new Node('rect', { class: 'hat' });
    child.x = 0;
    child.y = -20;
    child.w = 20;
    child.h = 10;
    child.parent_node = root;
    root.child_nodes.push(child);
    return root;
}

function hasFunction(value) {
    if (typeof value === 'function') return true;
    if (Array.isArray(value)) return value.some(hasFunction);
    if (value && typeof value === 'object') return Object.keys(value).some((k) => hasFunction(value[k]));
    return false;
}

// --- Чистые помощники ------------------------------------------------------

test('sanitize выбрасывает функции и разрывает циклы', () => {
    const source = { a: () => {}, b: [1, undefined, 2], c: new Set([1, 2]), d: 'ok' };
    source.self = source;
    const clean = sanitize(source, new Set());
    eq(clean.a, undefined);
    eq(clean.self, undefined);
    eq(JSON.stringify(clean.b), '[1,null,2]');
    eq(JSON.stringify(clean.c), '[1,2]');
    eq(clean.d, 'ok');
});

test('sanitize разрывает цикл и в массиве', () => {
    const a = [];
    a.push(a);
    eq(JSON.stringify(sanitize(a, new Set())), '[null]', 'самоссылающийся массив');

    const b = [];
    const c = [b];
    b.push(c);
    eq(JSON.stringify(sanitize(b, new Set())), '[[null]]', 'цикл массив↔массив');

    // Обычный массив без циклов не должен пострадать.
    eq(JSON.stringify(sanitize([1, [2, 3]], new Set())), '[1,[2,3]]');
});

test('applyOverrides понимает size, pos, class и attrs', () => {
    const data = { w: 10, h: 10, x: 0, y: 0, class: 'a', attrs: {} };
    applyOverrides(data, { size: [40, 60], pos: [5, 6], class: 'b c', speed: 300 });
    eq(data.w, 40);
    eq(data.h, 60);
    eq(data.x, 5);
    eq(data.y, 6);
    eq(data.class, 'a b c');
    eq(data.attrs.speed, 300);
});

test('mergeSpec наследует дерево и добавляет узлы', () => {
    const base = { tag: 'player', w: 20, h: 30, hp: 100, children: [{ tag: 'rect', class: 'hat' }] };
    const merged = mergeSpec(base, {
        overrides: { hp: 50, size: [40, 60] },
        add: [{ tag: 'rect', class: 'cape' }],
    });
    eq(merged.w, 40);
    eq(merged.h, 60);
    eq(merged.hp, 50);
    eq(merged.children.length, 2);
    eq(merged.children[1].class, 'cape');
    // База не должна измениться: mergeSpec возвращает копию.
    eq(base.hp, 100);
});

// --- Сериализация ----------------------------------------------------------

test('nodeToData не содержит функций и ссылок на живые объекты', () => {
    clearWorld();
    const data = nodeToData(makeTree());
    falsy(hasFunction(data), 'в данных не должно быть функций');
    eq(data.data.callback, undefined);
    eq(data.attrs.script, undefined);
    // Обычный JSON.stringify не должен ничего терять/падать.
    truthy(JSON.stringify(data).length > 0);
});

test('тело сохраняется описанием, спрайт — путём, а не числовым id', () => {
    clearWorld();
    const node = new Node('player', { x: 3, y: 4 });
    node.setSprite('art/hero.png');
    const data = nodeToData(node);
    eq(data.body, 'dynamic');
    eq(typeof data.body, 'string');
    eq(data.sprite, 'art/hero.png');
    const text = JSON.stringify(data);
    truthy(text.indexOf('"body":0') === -1, 'числовой id тела не попал в JSON');
    truthy(text.indexOf('"sprite":0') === -1, 'числовой id спрайта не попал в JSON');
});

test('лист-спецификация спрайта сохраняется как объект', () => {
    clearWorld();
    const node = new Node('sprite', { x: 0, y: 0 });
    node.setSprite({ src: 'atlas.png', cols: 4, rows: 2, cw: 16, ch: 16 });
    const data = nodeToData(node);
    eq(data.sprite.src, 'atlas.png');
    eq(data.sprite.cols, 4);
    eq(data.sprite.rows, 2);
    eq(data.sprite.cw, 16);
    eq(data.sprite.ch, 16);
});

test('save → load → save идемпотентен', () => {
    clearWorld();
    const first = nodeToData(makeTree());
    clearWorld();
    const loaded = applyData(dataToSpec(first), null);
    truthy(loaded, 'узел восстановлен');
    const second = nodeToData(loaded);
    eq(JSON.stringify(second), JSON.stringify(first), 'данные совпадают побайтово');
});

test('выключенное тело (false) так же переживает round-trip', () => {
    clearWorld();
    const node = new Node('player', { x: 0, y: 0 });
    node.setBody(null);
    const data = nodeToData(node);
    eq(data.body, false);
    clearWorld();
    const loaded = applyData(data, null);
    eq(nodeToData(loaded).body, false);
});

// --- Реестр, наследование, инстанцирование --------------------------------

test('register/get/has/list/remove/clear работают', () => {
    clearWorld();
    $.prefab.clear();
    $.prefab.register('one', { tag: 'rect', w: 1, h: 1 });
    truthy($.prefab.has('one'));
    truthy($.prefab.list().includes('one'));
    eq($.prefab.get('one').w, 1);
    eq($.prefab.get('missing'), null);
    $.prefab.remove('one');
    falsy($.prefab.has('one'));
    $.prefab.register('two', { tag: 'rect' });
    $.prefab.clear();
    eq($.prefab.list().length, 0);
});

test('extend + overrides даёт унаследованный prefab', () => {
    clearWorld();
    $.prefab.clear();
    $.prefab.register('base', {
        tag: 'player', w: 20, h: 30, x: 0, y: 0, hp: 100, maxHp: 100,
        class: 'base',
        children: [{ tag: 'rect', class: 'hat', w: 4, h: 4 }],
    });
    $.prefab.register('child', {
        extend: 'base',
        overrides: { hp: 50, size: [40, 60], speed: 400 },
        add: [{ tag: 'rect', class: 'cape', w: 8, h: 8 }],
    });
    const spec = $.prefab.get('child');
    eq(spec.w, 40);
    eq(spec.h, 60);
    eq(spec.hp, 50);
    eq(spec.children.length, 2);
    eq(spec.children[0].class, 'hat');
    eq(spec.children[1].class, 'cape');
    eq(spec.attrs.speed, 400);
});

test('count создаёт ровно n копий с разными uid', () => {
    clearWorld();
    $.prefab.clear();
    $.prefab.register('coin', { tag: 'rect', w: 5, h: 5, x: 0, y: 0 });
    const many = $.prefab.instantiate('coin', { count: 3, x: 5, y: 6 });
    eq(many.length, 3);
    truthy(many.get(0).uid !== many.get(1).uid);
    truthy(many.get(1).uid !== many.get(2).uid);
    eq(many.get(2).x, 5);
    eq(many.get(2).y, 6);
});

test('instantiate с занятым id не ломает оригинал', () => {
    clearWorld();
    $.prefab.clear();
    const original = new Node('player', { id: 'hero' });
    $.prefab.register('withId', nodeToData(original));
    const copy = $.prefab.instantiate('withId', { id: 'hero' });
    eq(copy.get(0).id, 'hero2');
    truthy(ctx.byId.get('hero') === original, 'оригинал остался под своим id');
    eq(copy.prefab(), 'withId');
});

test('load вешает узел на переданного родителя', () => {
    clearWorld();
    const parent = new Node('rect', { x: 0, y: 0 });
    const data = nodeToData(new Node('rect', { x: 5, y: 5 }));
    const loaded = $.prefab.load(data, parent);
    eq(loaded.get(0).parent_node, parent);
    eq(parent.child_nodes.length, 1);
});

// --- Клонирование и JSON ---------------------------------------------------

test('clone сохраняет иерархию и не дублирует id', () => {
    clearWorld();
    const root = new Node('player', { id: 'orig', x: 1, y: 2 });
    const a = new Node('rect', { class: 'a', id: 'gun' });
    const b = new Node('rect', { class: 'b' });
    a.parent_node = root; root.child_nodes.push(a);
    b.parent_node = root; root.child_nodes.push(b);

    const cloned = $.prefab.clone(root);
    eq(cloned.length, 1);
    const copy = cloned.get(0);
    eq(copy.child_nodes.length, 2);
    eq(copy.child_nodes[0].classes.has('a'), true);
    eq(copy.child_nodes[1].classes.has('b'), true);
    truthy(copy.id !== 'orig');
    eq(ctx.byId.get('orig'), root);
    eq(ctx.byId.get('gun'), a, 'id ребёнка-оригинала не перехвачен');
    truthy(copy.child_nodes[0].id !== 'gun', 'id ребёнка клона уникален');

    const viaMethod = wrapOne(root).clone();
    eq(viaMethod.length, 1);
    truthy(viaMethod.get(0).id !== copy.id);
    eq(wrapOne(root).prefabClone().length, 1);
});

test('методы узла toData/savePrefab/prefab работают', () => {
    clearWorld();
    $.prefab.clear();
    $.prefab.register('named', { tag: 'rect', x: 0, y: 0 });
    const inst = $.prefab.instantiate('named', { x: 1, y: 1 });
    eq(inst.prefab(), 'named');
    eq(prefabOf(inst.get(0)), 'named');
    const data = inst.toData();
    eq(data.tag, 'rect');
    inst.savePrefab('fromNode');
    truthy($.prefab.has('fromNode'));
});

test('toJSON/fromJSON переживают round-trip', () => {
    clearWorld();
    const data = nodeToData(makeTree());
    const text = $.prefab.toJSON(data);
    const back = $.prefab.fromJSON(text);
    eq(JSON.stringify(back), JSON.stringify(data));
    eq($.prefab.fromJSON('{ это не json'), null);
});

test('save группы и instantiate по массиву корней', () => {
    clearWorld();
    const a = new Node('rect', { x: 0, y: 0 });
    const b = new Node('rect', { x: 10, y: 0 });
    const group = $.prefab.save([a, b]);
    eq(Array.isArray(group), true);
    const made = $.prefab.instantiate(group, { x: 100, y: 100 });
    eq(made.length, 2);
    eq(made.get(0).x, 100);
    eq(made.get(1).x, 10);
});

test('register/instantiate/load принимают живой узел', () => {
    clearWorld();
    $.prefab.clear();
    const node = new Node('enemy', { id: 'proto', x: 7, y: 8 });
    $.prefab.register('fromNode', node);
    const made = $.prefab.instantiate(node, { x: 1, y: 2 });
    eq(made.length, 1);
    eq(made.get(0).tag, 'enemy');
    eq(made.get(0).x, 1);
    const loaded = $.prefab.load(node);
    eq(loaded.length, 1);
    eq(loaded.get(0).tag, 'enemy');
});

test('tickPrefab безопасен и ничего не портит', () => {
    tickPrefab(1 / 60);
    eq(typeof tickPrefab, 'function');
});

finish();
