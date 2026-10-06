// ===========================================================================
// Юнит-тесты пула объектов без движка (qjs + tests/js/_harness.mjs).
//
// Проверяем переиспользование узлов, лимит роста, release/releaseAll/clear,
// сброс состояния между spawn, работу с телом, настройки onAcquire/onRelease
// и счётчики подсистем для $.debug.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/pool_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, packColor } from '../../src/highlevel/core.js';
import { installPool, tickPool, collectCounters, normalizePoolSpec } from '../../src/highlevel/pool.js';
import { installDebug } from '../../src/highlevel/debug.js';

// Подсистемы ставятся один раз: installPool регистрирует $.pool и метод
// обёртки .release(), installDebug — $.debug для проверки счётчиков.
const $stub = {};
installPool($stub);
installDebug($stub);

// Уничтожение узла рассылает событие 'remove' через ctx.$. В харнессе $
// нет — подставляем заглушку, чтобы clear() был проверяем.
ctx.$ = function () { return { nodes: [] }; };
ctx.$._dispatchGlobal = () => {};

function resetWorld() { ctx.nodes.length = 0; }
function clearPools() { $stub.pool.clear(); resetWorld(); }

// ---------------------------------------------------------------------------
// Разбор спецификации
// ---------------------------------------------------------------------------

test('normalizePoolSpec: отделяет настройки пула от атрибутов узла', () => {
    const fn = () => {};
    const s = normalizePoolSpec({
        name: 'bullets', tag: 'bullet', max: 10, initial: 2,
        onAcquire: fn, speed: 500, color: '#ffcc00',
    });
    eq(s.name, 'bullets');
    eq(s.tag, 'bullet');
    eq(s.max, 10);
    eq(s.initial, 2);
    eq(s.onAcquire, fn);
    eq(s.attrs.speed, 500);
    eq(s.attrs.color, '#ffcc00');
    falsy('name' in s.attrs, 'имя пула не утекло в атрибуты узла');
    falsy('max' in s.attrs);
});

test('normalizePoolSpec: значения по умолчанию и обрезка initial по max', () => {
    const s = normalizePoolSpec({ name: 'x' });
    eq(s.tag, 'rect');
    truthy(s.max > 0);
    eq(s.initial, 0);
    eq(normalizePoolSpec({ name: 'x', max: 3, initial: 99 }).initial, 3);
    eq(normalizePoolSpec({ name: 'x', max: 3, prewarm: 2 }).initial, 2, 'prewarm — алиас initial');
});

// ---------------------------------------------------------------------------
// Регистрация
// ---------------------------------------------------------------------------

test('create/get/has: пул регистрируется и отдаёт дескриптор', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'bullets', tag: 'bullet', max: 4 });
    truthy(p);
    eq($stub.pool.get('bullets'), p, 'get возвращает тот же дескриптор');
    eq($stub.pool.has('bullets'), true);
    eq(p.max, 4);
    eq(p.created, 0);
    eq(p.active, 0);
    eq($stub.pool.get('нет-такого'), null);
    eq($stub.pool.has('нет-такого'), false);
});

test('create: без имени и с неизвестным тегом не падает', () => {
    clearPools();
    eq($stub.pool.create({ tag: 'bullet' }), null);
    eq($stub.pool.create({ name: 'x', tag: 'нет-такого' }), null);
    eq($stub.pool.stats().pools, 0, 'неудачные create не регистрируются');
});

test('create: повторное имя возвращает существующий пул', () => {
    clearPools();
    const a = $stub.pool.create({ name: 'b', tag: 'rect', max: 2 });
    const b = $stub.pool.create({ name: 'b', tag: 'circle', max: 9 });
    eq(a, b);
    eq(a.tag, 'rect', 'первое описание не перезаписано');
});

// ---------------------------------------------------------------------------
// Переиспользование
// ---------------------------------------------------------------------------

test('spawn: узел входит в мир, release убирает его из мира', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 2 });
    const w = p.spawn({ id: 'b1' });
    eq(w.nodes.length, 1);
    const node = w.nodes[0];
    eq(node.tag, 'rect');
    truthy(ctx.nodes.indexOf(node) >= 0, 'выданный узел зарегистрирован в мире');
    truthy(node.visible, 'выданный узел видим');
    eq(p.active, 1);
    eq(p.free, 0);
    eq(p.created, 1);
    eq($stub.pool.stats().active, 1);

    eq(p.release(node), true);
    eq(p.active, 0);
    eq(p.free, 1);
    falsy(node.visible, 'освобождённый узел невидим');
    eq(ctx.nodes.indexOf(node), -1, 'освобождённый узел убран из мира');
    eq($stub.pool.get('b').release(node), false, 'повторное освобождение игнорируется');
});

test('release переиспользует объект узла: новых аллокаций нет', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 2 });
    const first = p.spawn({ x: 3 }).nodes[0];
    p.release(first);
    const again = p.spawn({ x: 50, y: 60 }).nodes[0];
    eq(again, first, 'вернулся тот же объект Node');
    eq(p.created, 1, 'второй узел не создавался');
    near(again.x, 50);
    near(again.y, 60);
});

test('spawn сбрасывает состояние предыдущего использования', () => {
    clearPools();
    const p = $stub.pool.create({
        name: 'b', tag: 'rect', max: 1, color: '#ff0000', w: 4, h: 4,
    });
    const node = p.spawn({ x: 10, y: 20 }).nodes[0];
    node.alpha = 0.1;
    node.classes.add('burn');
    node.attrs.custom = 777;
    p.release(node);
    p.spawn();

    eq(node.x, 0, 'координаты вернулись к шаблону');
    eq(node.y, 0);
    eq(node.alpha, 1);
    eq(node.w, 4, 'размер из шаблона восстановлен');
    eq(node.color, packColor('#ff0000'), 'цвет из шаблона восстановлен');
    falsy(node.classes.has('burn'), 'чужие классы сняты');
    eq(node.attrs.custom, undefined, 'чужие атрибуты сняты');
});

// ---------------------------------------------------------------------------
// Лимит роста
// ---------------------------------------------------------------------------

test('spawn соблюдает max и не создаёт лишних узлов', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 2 });
    p.spawn();
    p.spawn();
    const over = p.spawn();
    eq(over.nodes.length, 0, 'сверх лимита — пустая обёртка');
    eq(p.created, 2);
    eq(p.active, 2);
    eq(p.stats().skipped, 1);
    eq(p.skipped, 1, 'геттер skipped у дескриптора');
    eq(p.spawned, 2, 'геттер spawned считает успешные выдачи');
    eq(p.released, 0);

    p.releaseAll();
    eq(p.released, 2, 'геттер released считает возвраты');
    eq(p.spawn().nodes.length, 1, 'место освободилось');
    eq(p.created, 2, 'новый узел не создавался');
});

test('initial предсоздаёт узлы, не выводя их в мир', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 3, initial: 3 });
    eq(p.created, 3);
    eq(p.free, 3);
    eq(p.active, 0);
    eq(ctx.nodes.length, 0, 'предсозданные узлы не в мире');
    const w = p.spawn();
    eq(w.nodes.length, 1);
    eq(p.free, 2);
    eq(p.created, 3);
});

// ---------------------------------------------------------------------------
// releaseAll / .release() / clear
// ---------------------------------------------------------------------------

test('releaseAll и метод узла .release()', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 4 });
    p.spawn();
    p.spawn();
    p.spawn();
    eq(p.active, 3);
    eq(p.releaseAll(), 3);
    eq(p.active, 0);
    eq(p.free, 3);

    const w = p.spawn();
    w.release();
    eq(p.active, 0, 'метод обёртки .release() вернул узел');
    eq(p.free, 3);
});

test('releaseAll без имени проходит по всем пулам', () => {
    clearPools();
    $stub.pool.create({ name: 'a', tag: 'rect', max: 2 }).spawn();
    $stub.pool.create({ name: 'b', tag: 'rect', max: 2 }).spawn();
    eq($stub.pool.releaseAll(), 2);
    eq($stub.pool.stats().active, 0);
    eq($stub.pool.stats().free, 2);
});

test('clear уничтожает узлы и снимает пул с учёта', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 4 });
    const node = p.spawn().nodes[0];
    p.spawn();
    $stub.pool.clear('b');
    eq($stub.pool.get('b'), null);
    truthy(node.removed, 'узлы уничтожены, а не спрятаны');
    eq(p.active, 0);

    truthy($stub.pool.create({ name: 'b', tag: 'rect', max: 1 }), 'имя свободно для нового пула');
    $stub.pool.clear();
    eq($stub.pool.stats().pools, 0, 'clear без имени снимает все пулы');
});

test('clear у дескриптора сохраняет пул для дальнейшей работы', () => {
    clearPools();
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 2, initial: 2 });
    p.spawn();
    p.clear();
    eq(p.created, 0);
    eq(p.free, 0);
    eq($stub.pool.has('b'), true, 'пул остался зарегистрированным');
    eq(p.spawn().nodes.length, 1, 'после clear пул снова выдаёт узлы');
});

// ---------------------------------------------------------------------------
// Обработчики и поведение узла
// ---------------------------------------------------------------------------

test('onAcquire/onRelease получают узел и opts', () => {
    clearPools();
    const seen = [];
    $stub.pool.create({
        name: 'b', tag: 'rect', max: 2,
        onAcquire: (node, opts) => seen.push(['a', node.tag, opts ? opts.x : -1]),
        onRelease: (node) => seen.push(['r', node.x]),
    });
    const p = $stub.pool.get('b');
    p.spawn({ x: 7 });
    p.releaseAll();
    eq(seen.length, 2);
    eq(seen[0][0], 'a');
    eq(seen[0][1], 'rect');
    near(seen[0][2], 7);
    eq(seen[1][0], 'r');
    near(seen[1][1], 7, 1e-9, 'onRelease видит последние координаты');
});

test('ошибка в обработчике пула не роняет spawn', () => {
    clearPools();
    $stub.pool.create({
        name: 'b', tag: 'rect', max: 1,
        onAcquire: () => { throw new Error('специально'); },
    });
    const w = $stub.pool.spawn('b');
    eq(w.nodes.length, 1, 'узел всё равно выдан');
    eq($stub.pool.get('b').active, 1);
});

test('узлы с телом: release выключает тело, spawn включает его обратно', () => {
    clearPools();
    // Тело больше не уничтожается: пул держит его выключенным (b2Body_Disable)
    // и переиспользует — иначе каждый spawn стоил бы destroyBody+createBody
    // (docs/HIGH_LEVEL_API_PERF.md §3.6, пункт 15 плана). Проверяем вызовы.
    const saved_enabled = engine.setBodyEnabled;
    const saved_alive = engine.bodyAlive;
    const enabled = [];
    engine.setBodyEnabled = (body, on) => { enabled.push([body, on]); };
    engine.bodyAlive = () => true;
    try {
        const p = $stub.pool.create({ name: 'b', tag: 'bullet', max: 2 });
        const node = p.spawn({ x: 5, y: 6 }).nodes[0];
        truthy(node.body >= 0, 'тело создано при выдаче');
        const body = node.body;
        enabled.length = 0;

        p.release(node);
        eq(node.body, body, 'тело осталось тем же: переиспользуем');
        truthy(enabled.some(([id, on]) => id === body && on === false),
               'при возврате тело выключено');

        enabled.length = 0;
        p.spawn({ x: 8, y: 9 });
        truthy(enabled.some(([id, on]) => id === body && on === true),
               'при выдаче то же тело включено обратно');
        near(node.x, 8);
        near(node.y, 9);
    } finally {
        engine.setBodyEnabled = saved_enabled;
        engine.bodyAlive = saved_alive;
    }
});

test('spawn/release не падают на неизвестном пуле или чужом узле', () => {
    clearPools();
    eq($stub.pool.spawn('нет').nodes.length, 0);
    eq($stub.pool.release(new Node('rect')), false);
    eq($stub.pool.releaseAll('нет'), 0);
});

// ---------------------------------------------------------------------------
// Счётчики подсистем
// ---------------------------------------------------------------------------

test('tickPool не считает счётчики в кадре, $.debug их отдаёт по запросу', () => {
    clearPools();
    ctx.counters = null;
    const p = $stub.pool.create({ name: 'b', tag: 'rect', max: 4, initial: 1 });
    p.spawn();
    tickPool(1 / 60);

    // Кадровый шаг пула больше не обходит реестр ради счётчиков, которые никто
    // не читает (docs/HIGH_LEVEL_API_PERF.md §3.3): снимок считается по запросу.
    eq(ctx.counters, null, 'tickPool не пишет ctx.counters');
    eq(typeof ctx.debug.counters, 'function');
    const c = ctx.debug.counters();
    eq(c.pools, 1);
    eq(c.pool_created, 1);
    eq(c.pool_active, 1);
    eq(c.pool_free, 0);
    eq(c.nodes, 1, 'в world-реестре только выданный узел');
    truthy(ctx.debug.stats().counters, 'stats() выводит счётчики');
    eq(ctx.debug.stats().counters.pools, 1);
});

test('collectCounters считает тела и зоны', () => {
    clearPools();
    ctx.nodes.push(new Node('wall', {}));
    ctx.nodes.push(new Node('trigger', {}));
    const c = collectCounters();
    truthy(c.bodies >= 1, 'статическое тело посчитано');
    truthy(c.zones >= 1, 'зона <trigger> посчитана');
    truthy(c.world_nodes >= 2);
});

test('свободные (предсозданные) узлы пула держат выключенные тела', () => {
    clearPools();
    const saved_create = engine.createBody;
    const saved_destroy = engine.destroyBody;
    const saved_enabled = engine.setBodyEnabled;
    const saved_alive = engine.bodyAlive;
    let created = 0;
    let destroyed = 0;
    const disabled = [];
    engine.createBody = () => 100 + created++;
    engine.destroyBody = () => { destroyed++; };
    engine.setBodyEnabled = (body, on) => { if (!on) disabled.push(body); };
    engine.bodyAlive = () => true;   // тело выключено, но живо
    try {
        const p = $stub.pool.create({ name: 'bullets', tag: 'bullet', max: 4, initial: 3 });
        eq(created, 3, 'предсоздание создало три тела');
        eq(destroyed, 0, 'тела свободных узлов не уничтожаются, а выключаются');
        eq(disabled.length, 3, 'все три тела выключены');
        eq(p.stats().free, 3, 'узлы лежат в пуле');

        const node = p.spawn().nodes[0];
        eq(created, 3, 'новых тел не появилось');
        truthy(node.body >= 100 && node.body <= 102,
               'на spawn переиспользовано предсозданное тело, а не создано новое');
    } finally {
        engine.createBody = saved_create;
        engine.destroyBody = saved_destroy;
        engine.setBodyEnabled = saved_enabled;
        engine.bodyAlive = saved_alive;
        clearPools();
    }
});

finish();
