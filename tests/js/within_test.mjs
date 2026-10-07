// ===========================================================================
// Юнит-тест чистой части `$().within(...)` — без движка.
//
// Сама фильтрация вынесена в `withinRadius()`: она не трогает реестр и не
// обращается к engine, поэтому проверяется за секунды под qjs. Главное, что
// здесь фиксируется: узлы С ТЕЛОМ проверяются по нативному списку id, узлы БЕЗ
// тела — по координатам (иначе спрайты и зоны молча выпадали бы из выборки).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/within_test.mjs
// ===========================================================================

import { test, eq, finish } from './_harness.mjs';
import { withinRadius } from '../../src/highlevel/core.js';

/** Узел-заглушка: тело -1 значит «тела нет». */
const node = (x, y, body = -1) => ({ x, y, body });

test('центр в радиусе: граница включается', () => {
    const nodes = [node(0, 0), node(30, 40), node(100, 0)];
    eq(withinRadius(nodes, 0, 0, 50).length, 2, '0 и ровно 50 попадают');
    eq(withinRadius(nodes, 0, 0, 49.99).length, 1, '49.99 — уже нет');
});

test('радиус 0 и отрицательный дают пустую выборку, а не исключение', () => {
    const nodes = [node(0, 0)];
    eq(withinRadius(nodes, 0, 0, 0).length, 0);
    eq(withinRadius(nodes, 0, 0, -10).length, 0);
    eq(withinRadius(nodes, 0, 0, 'нет').length, 0);
});

test('узлы с телом проверяются по нативному списку id, а не по координатам', () => {
    // Узел с телом ВНУТРИ радиуса, но тела нет в нативном ответе — исключён:
    // решает broadphase, а не координата узла.
    const inside = node(10, 0, 7);
    const outside = node(1000, 0, 8);
    const list = withinRadius([inside, outside], 0, 0, 50, [8]);
    eq(list.length, 1, 'остался только узел с телом 8');
    eq(list[0], outside, 'и это именно он');
});

test('узлы без тела считаются по координатам даже при нативном списке', () => {
    const plain = node(10, 0);
    const list = withinRadius([plain, node(500, 0)], 0, 0, 50, []);
    eq(list.length, 1, 'спрайт без тела не теряется');
    eq(list[0], plain);
});

test('пустой нативный ответ — это «нет тел», а не «нет запроса»', () => {
    const body_node = node(1, 0, 3);
    eq(withinRadius([body_node], 0, 0, 50, []).length, 0, 'тело не подтверждено broadphase');
    eq(withinRadius([body_node], 0, 0, 50, null).length, 1, 'без нативного ответа — по координатам');
});

test('порядок выборки сохраняется', () => {
    const nodes = [node(30, 0), node(10, 0), node(20, 0)];
    const list = withinRadius(nodes, 0, 0, 50);
    eq(list.map((n) => n.x).join(','), '30,10,20', 'порядок реестра не переставляется');
});

finish();
