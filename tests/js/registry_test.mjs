// ===========================================================================
// Юнит-тесты индекса реестра (ядро `$`, docs/HIGH_LEVEL_API_PERF.md §5, P2).
//
// Индекс — один проход по ctx.nodes на версию реестра вместо N проходов
// подсистем. Проверяем то, на что опираются подсистемы:
//
//   * byTag/byClass и срезы по признакам (ui/tr/controls/anim/clip/parallax/
//     zones) совпадают с честным проходом по ctx.nodes;
//   * срезы — снимки: узел, созданный во время обхода среза, не ломает обход;
//   * удалённые (в том числе внутри $.batch) узлы в индекс не попадают;
//   * структурные селекторы идут по индексу, а зависимые от изменяемого поля
//     (`:alive`, `[hp<5]`) по-прежнему считаются по узлам, а не по кэшу;
//   * query() отдаёт копию: правка результата не портит индекс.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/registry_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import {
    ctx, Node, query, touchRegistry, registryVersion,
    nodesByTag, nodesByClass, nodesWithFacet, facetCount, liveNodes,
    beginBatch, endBatch, dropFromRegistry,
} from '../../src/highlevel/core.js';

function clearNodes() {
    ctx.nodes.length = 0;
    ctx.byId.clear();
    touchRegistry();
}

/** Честный проход: с чем обязан совпадать индекс. */
function scan(pred) {
    let count = 0;
    for (let i = 0; i < ctx.nodes.length; i++) {
        const node = ctx.nodes[i];
        if (!node.removed && pred(node)) count++;
    }
    return count;
}

// api.js в qjs не поднимается, а destroy() шлёт событие 'remove' через него.
ctx.$ = { _dispatchGlobal() {} };

test('индекс: byTag и byClass совпадают с проходом по реестру', () => {
    clearNodes();
    const a = new Node('enemy', { id: 'a', class: 'mob alive' });
    const b = new Node('enemy', { id: 'b', class: 'mob' });
    new Node('wall', { id: 'c' });

    eq(nodesByTag('enemy').length, 2);
    eq(nodesByTag('enemy').length, scan((n) => n.tag === 'enemy'));
    eq(nodesByTag('wall').length, 1);
    eq(nodesByTag('nope').length, 0, 'неизвестный тег — пустой срез, а не undefined');

    eq(nodesByClass('mob').length, 2);
    eq(nodesByClass('mob').length, scan((n) => n.classes.has('mob')));
    eq(nodesByClass('alive').length, 1);
    eq(nodesByClass('nope').length, 0);

    // Классы меняются на ходу — индекс обязан это увидеть (версия реестра).
    b.addClass('alive');
    eq(nodesByClass('alive').length, 2);
    a.removeClass('mob');
    eq(nodesByClass('mob').length, 1);
});

test('индекс: срезы по признакам совпадают с проходом по реестру', () => {
    clearNodes();
    const ui = new Node('rect', { id: 'ui1', ui: true });
    const tr = new Node('rect', { id: 'tr1', tr: 'menu.play' });
    const ctrl = new Node('player', { id: 'hero', controls: 'wasd' });
    const anim = new Node('rect', { id: 'an1' });
    anim.anim = { playing: true };
    touchRegistry();
    const clip = new Node('rect', { id: 'cl1' });
    clip.__clip = {};
    touchRegistry();
    const parallax = new Node('rect', { id: 'p1' });
    parallax.parallax_factor = 0.3;
    touchRegistry();
    const zone_tag = new Node('trigger', { id: 'z1' });
    const zone_class = new Node('rect', { id: 'z2', class: 'trigger' });
    const zone_attr = new Node('rect', { id: 'z3', trigger: true });
    // Зона по тегу И по классу сразу: в счётчике она обязана быть один раз.
    new Node('trigger', { id: 'z4', class: 'trigger' });
    new Node('rect', { id: 'plain' });

    eq(facetCount('ui'), 1);
    eq(facetCount('ui'), scan((n) => !!n.attrs.ui));
    eq(facetCount('tr'), 1);
    eq(facetCount('tr'), scan((n) => n.attrs.tr !== undefined));
    eq(facetCount('controls'), 1);
    eq(facetCount('controls'), scan((n) => !!n.attrs.controls));
    eq(facetCount('anim'), 1);
    eq(facetCount('anim'), scan((n) => !!n.anim));
    eq(facetCount('clip'), 1);
    eq(facetCount('clip'), scan((n) => !!n.__clip));
    eq(facetCount('parallax'), 1);
    eq(facetCount('parallax'), scan((n) => n.parallax_factor !== undefined && n.parallax_factor !== null));
    eq(facetCount('zones'), 4, 'зона — тег, класс или attrs.trigger (без двойного счёта)');
    eq(facetCount('zones'), scan((n) =>
        n.tag === 'trigger' || (n.classes && n.classes.has('trigger')) || n.attrs.trigger === true));

    eq(nodesWithFacet('ui')[0], ui);
    eq(nodesWithFacet('tr')[0], tr);
    eq(nodesWithFacet('controls')[0], ctrl);
    eq(nodesWithFacet('zones').length, 4);
    eq(facetCount('нет-такого'), 0, 'неизвестный признак — 0, а не падение');
});

test('индекс: срезы — снимки, узел в кадре не ломает обход', () => {
    clearNodes();
    new Node('enemy', { id: 'a' });
    const snapshot = nodesWithFacet('zones');
    const enemy_snapshot = nodesByTag('enemy');

    const z = new Node('trigger', { id: 'z' });
    new Node('enemy', { id: 'b' });

    eq(snapshot.length, 0, 'старый срез не меняется');
    eq(enemy_snapshot.length, 1, 'старый срез не меняется');
    eq(nodesByTag('enemy').length, 2, 'новый запрос видит новый узел');
    eq(nodesWithFacet('zones')[0], z);
});

test('индекс: удалённые узлы в срезы не попадают', () => {
    clearNodes();
    const a = new Node('enemy', { id: 'a' });
    const b = new Node('enemy', { id: 'b' });
    eq(nodesByTag('enemy').length, 2);
    eq(liveNodes().length, 2);

    a.destroy();
    eq(a.removed, true);
    eq(nodesByTag('enemy').length, 1);
    eq(liveNodes().length, 1);

    // Внутри пакета узел помечен removed, но уборка реестра отложена —
    // индекс обязан не отдавать его уже сейчас.
    beginBatch();
    b.destroy();
    eq(b.removed, true);
    eq(b._drop_queued, true, 'уборка отложена до конца пакета');
    eq(nodesByTag('enemy').length, 0);
    eq(liveNodes().length, 0);
    endBatch();
    eq(ctx.nodes.length, 0);
});

test('query: структурный селектор берётся из индекса', () => {
    clearNodes();
    new Node('enemy', { id: 'a', class: 'mob alive' });
    new Node('enemy', { id: 'b', class: 'mob' });
    new Node('wall', { id: 'c' });

    eq(query('.mob').length, 2);
    eq(query('enemy').length, 2);
    eq(query('enemy.mob').length, 2);
    eq(query('.mob.alive').length, 1);
    eq(query('*').length, 3);
    eq(query('.nope').length, 0);
    eq(query('#a')[0].id, 'a', 'id-путь не сломан');
});

test('query: якорь ускоряет условия, но не кэширует изменяемые поля', () => {
    clearNodes();
    new Node('enemy', { id: 'a', class: 'mob', hp: 10 });
    new Node('enemy', { id: 'b', class: 'mob', hp: 1 });

    // Условие по атрибуту: кандидаты — срез класса, решение — предикат.
    eq(query('.mob[hp<5]').length, 1);
    eq(query('.mob:alive').length, 2);

    // cur_hp меняется без изменения реестра: результат обязан пересчитаться.
    const first = query('.mob')[0];
    first.cur_hp = 0;
    eq(query('.mob:alive').length, 1, ':alive не кэшируется');
    eq(query('.mob[hp<5]:alive').length, 1);
    eq(query('.mob').length, 2, 'структурный селектор по-прежнему видит оба узла');
});

test('query: результат — копия, правка не портит индекс', () => {
    clearNodes();
    new Node('enemy', { id: 'a', class: 'mob' });
    const list = query('.mob');
    list.length = 0;
    eq(query('.mob').length, 1, 'индекс не пострадал от правки результата');
    eq(nodesByClass('mob').length, 1);
});

test('индекс: версия реестра растёт на изменение состава', () => {
    clearNodes();
    const before = registryVersion();
    const node = new Node('rect', { id: 'x' });
    truthy(registryVersion() > before, 'создание узла меняет версию');
    const mid = registryVersion();
    node.addClass('tagged');
    truthy(registryVersion() > mid, 'смена классов меняет версию');
    const late = registryVersion();
    dropFromRegistry(node);
    truthy(registryVersion() > late, 'удаление меняет версию');
    falsy(liveNodes().length);
});

finish();
