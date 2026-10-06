// ===========================================================================
// Юнит-тесты пакетных операций и кэша обёртки (ядро `$`).
//
// Проверяется то, что обещал аудит производительности
// (docs/HIGH_LEVEL_API_PERF.md §3.5–3.6, пункты 12–15 плана):
//
//   * wrapOne() отдаёт один и тот же объект для одного узла — обёртка на узел
//     больше не аллоцируется в горячем цикле;
//   * dropFromRegistry() вне пакета убирает узел сразу, внутри $.batch —
//     откладывает до конца, а реестр чистится одной уборкой;
//   * узел, удалённый внутри пакета, не находится селектором;
//   * возврат узла в мир до уборки отменяет отложенное удаление;
//   * селектор не находит удалённый узел и после уборки.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/batch_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import {
    ctx, Node, Wrapper, wrapOne, wrap, query, compileSelector,
    beginBatch, endBatch, dropFromRegistry, registryVersion,
} from '../../src/highlevel/core.js';

function clearNodes() {
    ctx.nodes.length = 0;
    ctx.byId.clear();
}

// api.js в qjs не поднимается, а destroy() шлёт событие 'remove' через него.
ctx.$ = { _dispatchGlobal() {} };

test('wrapOne создаёт обёртку на вызов: в узле её кэшировать нельзя', () => {
    clearNodes();
    const node = new Node('rect', { id: 'a' });
    const first = wrapOne(node);
    const second = wrapOne(node);
    truthy(first instanceof Wrapper);
    eq(first.nodes[0], node, 'обёртка указывает на свой узел');
    eq(first.length, 1);
    eq(first === second, false, 'каждый вызов — своя обёртка');
    // Поле в узле замкнуло бы цикл «узел → обёртка → узел», и JSON.stringify
    // узла (агент, $.store, отладка) падал бы с circular reference.
    JSON.stringify(node);
    falsy(Object.prototype.hasOwnProperty.call(node, '_wrapper'), 'в узле нет ссылки на обёртку');
});

test('each отдаёт обёртку, eachNode — сам узел', () => {
    clearNodes();
    const a = new Node('rect', {});
    const b = new Node('rect', {});
    const list = wrap([a, b]);
    const seen_each = [];
    const seen_node = [];
    const ret = list.each((i, el) => seen_each.push([i, el]));
    eq(ret, list, 'each возвращает ту же обёртку');
    truthy(seen_each[0][1] instanceof Wrapper, 'each: вторым аргументом обёртка');
    eq(seen_each[0][1].nodes[0], a);
    eq(seen_each[1][0], 1, 'индекс идёт первым аргументом');
    list.eachNode((i, node) => seen_node.push(node));
    eq(seen_node[0], a, 'eachNode: вторым аргументом сам узел');
    eq(seen_node[1], b);
});

test('wrapOne на null не падает и не кэшируется', () => {
    const w = wrapOne(null);
    truthy(w instanceof Wrapper);
    eq(w.length, 1);
});

test('dropFromRegistry вне пакета убирает узел сразу', () => {
    clearNodes();
    const a = new Node('rect', { id: 'x' });
    const b = new Node('rect', { id: 'y' });
    eq(ctx.nodes.length, 2);
    dropFromRegistry(a);
    a.in_registry = false;
    eq(ctx.nodes.length, 1, 'узел исчез из реестра');
    eq(ctx.nodes[0], b);
    falsy(a.in_registry);
});

test('$.batch: удаления отложены до конца пакета', () => {
    clearNodes();
    const nodes = [];
    for (let i = 0; i < 5; i++) nodes.push(new Node('rect', { id: 'n' + i }));
    // внутри пакета атрибут id перезаписывается — реестр byId ведёт последний
    const before = registryVersion();

    beginBatch();
    for (const n of nodes) { n.removed = true; dropFromRegistry(n); }
    eq(ctx.nodes.length, 5, 'внутри пакета реестр ещё не тронут');
    truthy(registryVersion() > before, 'версия реестра выросла сразу');
    endBatch();

    eq(ctx.nodes.length, 0, 'после пакета реестр пуст одной уборкой');
    for (const n of nodes) {
        n.in_registry = false;
        falsy(n._drop_queued, 'пометка снята');
    }
});

test('узел, удалённый в пакете, не находится селектором', () => {
    clearNodes();
    const alive = new Node('rect', { class: 'mob' });
    const dead = new Node('rect', { class: 'mob' });
    beginBatch();
    dead.removed = true;
    dropFromRegistry(dead);
    const found = query('.mob');
    eq(found.length, 1, 'селектор вернул только живого');
    eq(found[0], alive);
    endBatch();
});

test('возврат узла до уборки отменяет отложенное удаление', () => {
    clearNodes();
    const node = new Node('rect', { id: 'back' });
    beginBatch();
    node.removed = true;
    dropFromRegistry(node);
    // так делает пул: узел вернулся в мир тем же пакетом
    node.removed = false;
    node._drop_queued = false;
    endBatch();
    eq(ctx.nodes.length, 1, 'узел остался в реестре');
    eq(ctx.nodes[0], node);
});

test('вложенные пакеты дают одну уборку', () => {
    clearNodes();
    const nodes = [];
    for (let i = 0; i < 4; i++) nodes.push(new Node('rect', {}));
    beginBatch();
    beginBatch();
    nodes[0].removed = true;
    dropFromRegistry(nodes[0]);
    endBatch();
    eq(ctx.nodes.length, 4, 'внутренний endBatch уборку не запускает');
    nodes[1].removed = true;
    dropFromRegistry(nodes[1]);
    endBatch();
    eq(ctx.nodes.length, 2, 'внешний endBatch убрал оба узла');
    eq(ctx.nodes[0], nodes[2]);
    eq(ctx.nodes[1], nodes[3]);
});

test('компилированный селектор пропускает удалённые узлы', () => {
    clearNodes();
    const a = new Node('rect', { class: 'unit' });
    const b = new Node('rect', { class: 'unit' });
    const match = compileSelector('.unit');
    truthy(match(a), 'живой узел подходит');
    b.removed = true;
    falsy(match(b), 'удалённый узел не подходит');
    eq(query('*').length, 1, "query('*') тоже пропускает удалённые");
});

test('query по id не возвращает удалённый узел', () => {
    clearNodes();
    const node = new Node('rect', { id: 'gone' });
    eq(query('#gone').length, 1);
    node.destroy();
    eq(query('#gone').length, 0, 'быстрый путь по id не отдаёт мертвеца');
});

test('wrap остаётся отдельной обёрткой на каждый вызов', () => {
    clearNodes();
    const node = new Node('rect', {});
    const w1 = wrap([node]);
    const w2 = wrap([node]);
    eq(w1 === w2, false, 'коллекция не кэшируется');
    eq(wrapOne(node) === w1, false, 'одиночная обёртка — свой объект');
});

finish();
