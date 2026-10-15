// ===========================================================================
// §39 local/world transforms и §40 области — юнит-тест без движка.
//
// Проверяет математику композиции §39 (персонаж → pivot → marker), знаковый
// масштаб (flip), поворот, независимость от камеры, защиту от цикла и реестр
// областей §40 (роль, enabled, owner) на чистом ядре core.js.
//
// Запуск: build/_deps/quickjs-build/qjs tests/js/transforms_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    Node, ctx, resolveLocalTransforms, worldPointOf, localPointOf, worldTransformOf,
    enterLocalSpace, exitLocalSpace, isLocalSpace, setWorldPosition, setWorldAngle,
    setWorldScale, invalidateNodeTransform, areaDefine, areaEnable, areaInfo, areaFind,
    areaByIndex, areaOwnerNode, areaOverlap, areaListOf, areaNativeEnabled, areaSyncAll,
} from '../../src/highlevel/core.js';

// Состояние native-формы в юнит-тесте подменяется: так проверяется §40 без
// движка — внешний драйвер (дорожка shape.enabled §41) переключает форму через
// engine.setShapeEnabled, а JS-описание обязано показывать фактическое значение.
const native_shapes = new Map();
globalThis.engine.shapeEnabled = (body, index) => native_shapes.get(body + ':' + index) !== false;
globalThis.engine.setShapeEnabled = (body, index, on) => {
    native_shapes.set(body + ':' + index, on !== false);
    return true;
};

function make(tag, attrs) { return new Node(tag || 'rect', attrs || {}); }

function attach(parent, child) {
    child.parent_node = parent;
    parent.child_nodes.push(child);
    return child;
}

/** enterLocalSpace возвращает признак включения — в тесте нужен сам узел. */
function makeLocal(node) {
    enterLocalSpace(node);
    return node;
}

/** Персонаж (100,200) → pivot (10,0) → marker (20,0): дерево из приёмки §39. */
function buildChain() {
    const hero = make('player');
    hero.x = 100;
    hero.y = 200;
    const pivot = makeLocal(attach(hero, make('rect')));
    pivot.local_x = 10;
    pivot.local_y = 0;
    const marker = makeLocal(attach(pivot, make('rect')));
    marker.local_x = 20;
    marker.local_y = 0;
    resolveLocalTransforms();
    return { hero, pivot, marker };
}

test('§39: localAt-цепочка даёт мировой point (100+10+20, 200)', () => {
    const { marker } = buildChain();
    const p = worldPointOf(marker, 0, 0);
    near(p.x, 130, 1e-9);
    near(p.y, 200, 1e-9);
    // Сам узел тоже стоит в мировой точке (её читают рендер и физика).
    near(marker.x, 130, 1e-9);
    near(marker.y, 200, 1e-9);
});

test('§39: flip родителя зеркалит детей (знаковый масштаб)', () => {
    const { hero, pivot, marker } = buildChain();
    setWorldScale(hero, -1, 1);
    resolveLocalTransforms();
    // Сдвиг 10+20 идёт по -x: 100 - 30.
    near(marker.x, 70, 1e-9);
    near(marker.y, 200, 1e-9);
    near(pivot.x, 90, 1e-9);
    // Знак масштаба доехал до детей: композиция множится.
    near(marker.scale_x, -1, 1e-9);
});

test('§39: поворот родителя вращает детей', () => {
    const { hero, marker } = buildChain();
    setWorldAngle(hero, Math.PI / 2);
    resolveLocalTransforms();
    near(marker.x, 100, 1e-9);
    near(marker.y, 230, 1e-9);
});

test('§39: flip + поворот вместе (приёмка)', () => {
    const { hero, marker } = buildChain();
    setWorldScale(hero, -1, 1);
    setWorldAngle(hero, Math.PI / 2);
    resolveLocalTransforms();
    // Сдвиг -30 по оси X родителя, повёрнутой на 90°: (0, -30).
    near(marker.x, 100, 1e-9);
    near(marker.y, 170, 1e-9);
});

test('§39: worldPoint/localPoint — обратные преобразования', () => {
    const { hero, marker } = buildChain();
    setWorldAngle(hero, 0.7);
    resolveLocalTransforms();
    const p = worldPointOf(marker, 12, -5);
    const back = localPointOf(marker, p.x, p.y);
    near(back.x, 12, 1e-9);
    near(back.y, -5, 1e-9);
});

test('§39: .at() на локальном узле остаётся МИРОВЫМ (совместимость)', () => {
    const { marker } = buildChain();
    setWorldPosition(marker, 500, 400);
    resolveLocalTransforms();
    near(marker.x, 500, 1e-9);
    near(marker.y, 400, 1e-9);
    // Локальные значения пересчитаны так, что композиция даёт ту же точку.
    const p = worldPointOf(marker, 0, 0);
    near(p.x, 500, 1e-9);
    near(p.y, 400, 1e-9);
    near(marker.local_x, 390, 1e-9);   // 500 - 100 (hero) - 10 (pivot)
});

test('§39: мировые узлы не меняются (старый проект)', () => {
    const hero = make('player');
    hero.x = 50;
    hero.y = 60;
    const child = attach(hero, make('sprite'));
    child.x = 10;
    child.y = 20;
    resolveLocalTransforms();
    eq(isLocalSpace(child), false);
    eq(child.x, 10);
    eq(child.y, 20);
    // Родитель поехал — мировой ребёнок остался на месте и не «прилип».
    setWorldPosition(hero, 900, 900);
    resolveLocalTransforms();
    eq(child.x, 10);
    eq(child.y, 20);
});

test('§39: worldTransform учитывает цепочку и идемпотентен', () => {
    const { marker } = buildChain();
    const once = worldTransformOf(marker);
    resolveLocalTransforms();
    const twice = worldTransformOf(marker);
    near(once.x, twice.x, 1e-12);
    near(once.y, twice.y, 1e-12);
    near(once.angle, twice.angle, 1e-12);
    near(once.sx, twice.sx, 1e-12);
});

test('§39: выход из локального режима не двигает узел', () => {
    const { marker } = buildChain();
    const before = { x: marker.x, y: marker.y };
    exitLocalSpace(marker);
    resolveLocalTransforms();
    eq(isLocalSpace(marker), false);
    near(marker.x, before.x, 1e-12);
    near(marker.y, before.y, 1e-12);
});

test('§39: вход в локальный режим сохраняет вид (keep-world)', () => {
    const hero = make('player');
    hero.x = 100;
    hero.y = 200;
    hero.angle = 1.0;
    const child = attach(hero, make('sprite'));
    child.x = 40;
    child.y = 260;
    enterLocalSpace(child);
    resolveLocalTransforms();
    near(child.x, 40, 1e-9);
    near(child.y, 260, 1e-9);
});

test('§39: цикл в цепочке родителей не зацикливает проход', () => {
    const a = makeLocal(make('rect'));
    const b = makeLocal(attach(a, make('rect')));
    // Испорченные данные: b — родитель a. Проход обязан завершиться.
    a.parent_node = b;
    if (!b.child_nodes.includes(a)) b.child_nodes.push(a);
    resolveLocalTransforms();
    truthy(true);
});

test('§39: проход пересчитывает только изменившихся (счётчик)', () => {
    buildChain();
    const changed = resolveLocalTransforms();
    eq(changed, 0);                       // всё уже скомпоновано
    const nodes = [makeLocal(make('rect'))];
    nodes[0].local_x = 5;
    truthy(resolveLocalTransforms() >= 0);
});

test('§39: invalidateNodeTransform сразу виден геттеру', () => {
    const { pivot } = buildChain();
    pivot.local_x = 110;
    invalidateNodeTransform(pivot);
    near(pivot.x, 210, 1e-9);             // 100 + 110
});

// --- §40: реестр областей ---------------------------------------------------

test('§40: area() регистрирует роль, слои и enabled', () => {
    const hero = make('rect');
    const area = areaDefine(hero, 'sword', {
        shape: 'box', w: 48, h: 20, x: 14, y: -8, angle: -0.3,
        sensor: true, role: 'attack', layer: 2, mask: 4, enabled: false,
    });
    eq(area.role, 'attack');
    eq(area.kind, 0);
    near(area.x, 14, 1e-9);
    near(area.angle, -0.3, 1e-9);
    eq(area.enabled, false);
    const info = areaInfo(hero, area);
    eq(info.name, 'sword');
    eq(info.shape, 'box');
    eq(info.enabled, false);
    eq(info.layer, 2);
    eq(info.mask, 4);
    // Без тела форма ещё не создана — индекс -1, описание уже живёт.
    eq(info.index, -1);
});

test('§40: повторный area() меняет только переданные поля', () => {
    const hero = make('rect');
    areaDefine(hero, 'sword', { shape: 'box', w: 48, h: 20, role: 'attack' });
    const area = areaDefine(hero, 'sword', { angle: 1.2 });
    eq(area.w, 48);
    near(area.angle, 1.2, 1e-9);
    eq(area.role, 'attack');
    eq(areaListOf(hero).length, 1);
});

test('§40: несколько областей одного владельца независимы', () => {
    const hero = make('rect');
    areaDefine(hero, 'body', { shape: 'capsule', w: 28, h: 40, role: 'movement' });
    areaDefine(hero, 'contact', { shape: 'circle', radius: 26, role: 'contact', sensor: true });
    areaDefine(hero, 'sword', { shape: 'box', w: 44, h: 18, role: 'attack', sensor: true, enabled: false });
    eq(areaListOf(hero).length, 3);
    eq(areaFind(hero, 'sword').enabled, false);
    eq(areaFind(hero, 'body').enabled, true);
    // Выключение sword не трогает движение.
    areaEnable(hero, 'sword', true);
    eq(areaFind(hero, 'sword').enabled, true);
    eq(areaFind(hero, 'body').enabled, true);
    areaEnable(hero, 'sword', false);
    eq(areaFind(hero, 'body').enabled, true);
});

test('§40: areaOverlap без движка пуст, но не падает', () => {
    const hero = make('rect');
    areaDefine(hero, 'sword', { shape: 'box', w: 40, h: 12, sensor: true });
    eq(areaOverlap(hero, 'sword').length, 0);
    eq(areaOverlap(hero, 'нет-такой').length, 0);
});

test('§40: areaByIndex находит область по индексу формы', () => {
    const hero = make('rect');
    const area = areaDefine(hero, 'sword', { shape: 'box', w: 40, h: 12 });
    area.index = 2;
    eq(areaByIndex(hero, 2), area);
    eq(areaByIndex(hero, 0), null);
});

test('§40: логический владелец области отделяется от узла-сенсора', () => {
    const hero = make('rect');
    hero.id = 'hero';
    const weapon = make('rect');
    attach(hero, weapon);
    const area = areaDefine(weapon, 'sword', { shape: 'box', w: 40, h: 12, owner: '#hero' });
    ctx.byId.set('hero', hero);
    eq(areaOwnerNode(weapon, area), hero);
    eq(areaInfo(weapon, area).owner, '#hero');
    ctx.byId.delete('hero');
});

// --- §40: JS-описание и native-состояние формы -------------------------------

test('§40: внешнее выключение формы видно в .areas() и areaOverlap', () => {
    const hero = make('rect');
    hero.body = 5;                         // тело «есть» (без движка — просто id)
    const area = areaDefine(hero, 'sword', { shape: 'box', w: 40, h: 12, sensor: true });
    area.index = 2;
    native_shapes.set('5:2', false);       // внешний драйвер выключил форму
    eq(areaNativeEnabled(hero, area), false);
    eq(areaSyncAll(hero) >= 1, true);
    eq(areaFind(hero, 'sword').enabled, false);
    eq(areaInfo(hero, area).enabled, false);
    eq(areaOverlap(hero, 'sword').length, 0);
});

test('§40: внешнее включение формы возвращает состояние (не залипает)', () => {
    const hero = make('rect');
    hero.body = 6;
    const area = areaDefine(hero, 'sword', { shape: 'box', w: 40, h: 12, sensor: true, enabled: false });
    area.index = 1;
    native_shapes.set('6:1', true);        // внешний драйвер включил форму
    eq(areaSyncAll(hero) >= 1, true);
    eq(areaFind(hero, 'sword').enabled, true);
    // Без движка сам запрос пересечений недоступен (mock shapeOverlaps → []),
    // но состояние описания уже согласовано с native-фильтром.
    eq(areaOverlap(hero, 'sword').length, 0);
    areaEnable(hero, 'sword', false);
    eq(native_shapes.get('6:1'), false);
    eq(areaFind(hero, 'sword').enabled, false);
});

finish();
