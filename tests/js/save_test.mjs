// ===========================================================================
// Юнит-тесты сохранений ($.save) без движка (qjs + tests/js/_harness.mjs).
//
// Проверяем то, что можно проверить без сборки: слоты и пути, канонический вид
// снимка, строки JSON, версии и миграции старых сохранений, метаданные слотов,
// а затем — работу самого $.save поверх настоящих $.store и $.prefab с
// файловой системой в памяти.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/save_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node } from '../../src/highlevel/core.js';
import { installStore } from '../../src/highlevel/store.js';
import { installPrefab } from '../../src/highlevel/prefab.js';
import {
    installSave, normalizeSlot, normalizeDir, slotFileName, slotPath, slotFromFile,
    compareSlots, sortSlots, makeSave, wireSave, serializeSave, migrateSave, parseSaveJson,
    namespacesOf, NAMESPACES,

    flattenNodes, saveInfo, SAVE_FORMAT, SAVE_VERSION,
} from '../../src/highlevel/save.js';

// destroy() рассылает событие 'remove' через глобальный $. В харнессе $ нет —
// подставляем заглушку (так же поступает tests/js/pool_test.mjs).
ctx.$ = function () { return { nodes: [] }; };
ctx.$._dispatchGlobal = () => {};

// --- Файловая система в памяти: $.fs из store.js ходит в engine.fs ----------
const files = new Map();

function resetFiles() { files.clear(); }

engine.fs = {
    readText: (path) => (files.has(path) ? files.get(path) : undefined),
    write: (path, text) => { files.set(path, text); return true; },
    exists: (path) => files.has(path),
    remove: (path) => files.delete(path),
    list: (dir) => [...files.keys()]
        .filter((path) => path.indexOf(dir + '/') === 0)
        .map((path) => path.slice(dir.length + 1)),
};

// --- Подсистемы -------------------------------------------------------------
const $ = {};
installStore($);
// api.js отдаёт подсистемы наружу сам; в тесте связываем их руками.
$.fs = ctx.fs;
$.store = ctx.store;
installPrefab($);
installSave($);

function resetWorld() {
    for (const node of ctx.nodes.slice()) {
        if (!node.removed && !node.parent_node) node.destroy();
    }
    for (const [id, node] of [...ctx.byId.entries()]) if (node.removed) ctx.byId.delete(id);
    ctx.nodes.length = 0;
}

function fresh() {
    resetWorld();
    resetFiles();
    $.store.clear();
    $.save.slot(1).dir('saves').stopAutosave();
    // Разделы, фабрики и content-версии живут вне $.store: сбрасываем и их,
    // иначе тесты влияли бы друг на друга.
    $.save.restartRun({ profile: true, presentation: true });
    $.save.clearBehaviors();
    const c = $.save.contents();
    for (const name of Object.keys(c.versions)) $.save.content(name, null);
    for (const name of Object.keys(c.hashes)) $.save.content(name, null);
}

// ---------------------------------------------------------------------------
// Слоты и пути
// ---------------------------------------------------------------------------

test('слоты: число, имя файла и произвольное имя → одно каноническое', () => {
    eq(normalizeSlot(2), '2');
    eq(normalizeSlot('slot-2.json'), '2');
    eq(normalizeSlot('slot_2'), '2');
    eq(normalizeSlot('quick'), 'quick');
    eq(normalizeSlot('boss room'), 'boss_room');
    eq(normalizeSlot(''), '1', 'пустой слот — значение по умолчанию');
    eq(normalizeSlot(undefined), '1');
    eq(normalizeSlot(NaN), '1');
    eq(slotFileName(3), 'slot-3.json');
    eq(slotPath('saves', 3), 'saves/slot-3.json');
    eq(slotPath('build/test/', 'quick'), 'build/test/slot-quick.json');
    eq(normalizeDir(''), 'saves', 'пустой каталог приводится к saves');
    eq(normalizeDir('build\\saves\\'), 'build/saves');
    eq(slotFromFile('slot-7.json'), '7');
    eq(slotFromFile('saves/slot-boss.json'), 'boss');
    eq(slotFromFile('notes.txt'), null, 'чужие файлы слотом не считаются');
    eq(slotFromFile('slot-7.txt'), null);
    eq(slotFromFile('slot-.json'), null, 'пустое имя слотом не считается');
});

test('сортировка слотов: числа по возрастанию, потом имена', () => {
    const list = [{ slot: 'boss' }, { slot: '10' }, { slot: '2' }, { slot: 'auto' }];
    eq(sortSlots(list).map((s) => s.slot).join(','), '2,10,auto,boss');
    truthy(compareSlots('9', '10') < 0, 'числа сравниваются как числа');
    truthy(compareSlots('auto', 'boss') < 0);
});

// ---------------------------------------------------------------------------
// Формат снимка и строки JSON
// ---------------------------------------------------------------------------

test('makeSave: поля в одном порядке, функции и циклы срезаны', () => {
    const cyclic = { name: 'x' };
    cyclic.self = cyclic;
    const payload = makeSave({
        saved_at: 1234.9, saved_frame: 7, time: 1.5, scene: 'level1',
        store: { kills: 3, onHit: () => 1, cyclic },
        world: [{ tag: 'rect', children: [{ tag: 'rect' }] }],
        speeds: [[1, 2], null],
        meta: { level: 'level1' },
    });
    eq(Object.keys(payload).join(','),
       'format,version,saved_at,saved_frame,time,scene,namespaces,store,world,speeds,node_state,content,meta');
    eq(payload.format, SAVE_FORMAT);
    eq(payload.version, SAVE_VERSION);
    eq(payload.saved_at, 1234, 'время сохранения — целые миллисекунды');
    eq(payload.saved_frame, 7);
    eq(payload.scene, 'level1');
    eq(payload.store.kills, 3);
    falsy('onHit' in payload.store, 'функции в данные не попадают');
    eq(payload.store.cyclic.self, undefined, 'цикл разорван');
    eq(payload.world.length, 1);
    eq(payload.speeds.length, 2);
    eq(payload.meta.level, 'level1');
    eq(makeSave(null).store && Object.keys(makeSave(null).store).length, 0);
    eq(makeSave(null).world, null);
    // §14: плоские поля — зеркала разделов, а не второй набор данных.
    eq(payload.namespaces.run.data.kills, 3, 'данные $.store лежат в разделе run');
    eq(payload.namespaces.room.world, payload.world, 'мир — раздел room');
    eq(payload.namespaces.room.speeds, payload.speeds, 'скорости — раздел room');
    eq(Object.keys(payload.namespaces.profile.data).length, 0);
    eq(Object.keys(payload.namespaces.presentation.data).length, 0);
});

test('wireSave: в файле разделы без плоских зеркал, round-trip стабилен', () => {
    const text = serializeSave({
        store: { hp: 5 },
        world: [{ tag: 'rect', nid: 'n5', id: 'hero' }],
        node_state: { n5: { v: [1, 0] } },
    });
    const file = JSON.parse(text);
    eq(Object.keys(file).join(','), 'format,version,saved_at,saved_frame,time,scene,namespaces',
       'в файле нет дублирующих store/world/speeds');
    eq(file.namespaces.run.data.hp, 5);
    eq(file.namespaces.room.world[0].nid, 'n5');
    eq(file.namespaces.room.nodes.n5.v[0], 1, 'состояние по nid лежит в разделе room');

    const parsed = parseSaveJson(text);
    eq(parsed.ok, true);
    // Мигрированный вид отдаёт и разделы, и зеркала для старого кода.
    eq(parsed.data.store.hp, 5);
    eq(parsed.data.world[0].id, 'hero');
    eq(parsed.data.node_state.n5.v[0], 1, 'зеркало node_state на месте');
    eq(serializeSave(parsed.data) === text, true, 'save → load → save даёт тот же JSON');
    eq(JSON.stringify(wireSave(makeSave({ store: { a: 1 } })).namespaces.run.data), '{"a":1}');
});

test('namespacesOf: плоский слот версии 2 приезжает в run/room, явные разделы важнее', () => {
    const ns = namespacesOf({ store: { a: 1 }, world: [{ tag: 'rect' }], speeds: [[0, 0]] });
    eq(ns.run.data.a, 1, 'store версии 2 — это run');
    eq(ns.room.world.length, 1, 'world версии 2 — это room');
    eq(ns.room.speeds.length, 1);

    const explicit = namespacesOf({
        namespaces: { run: { data: { from: 'ns' } }, room: { nodes: { n1: { v: [0, 0] } } } },
        store: { from: 'flat' },
        node_state: { broken: {} },
    });
    eq(explicit.run.data.from, 'ns', 'явный раздел важнее плоского зеркала');
    eq(explicit.room.nodes.n1.v[0], 0);
    eq(explicit.room.nodes.broken, undefined, 'чужое зеркало node_state не подмешивается');
});

test('serializeSave → parseSaveJson: round-trip без потерь', () => {
    const text = serializeSave({ store: { hp: 5 }, world: [{ tag: 'rect', id: 'hero' }] });
    truthy(typeof text === 'string' && text.indexOf('\n') > 0, 'JSON записан с отступами');
    const parsed = parseSaveJson(text);
    eq(parsed.ok, true);
    eq(parsed.error, null);
    eq(parsed.data.version, SAVE_VERSION);
    eq(parsed.data.store.hp, 5);
    eq(parsed.data.world[0].id, 'hero');
    eq(serializeSave(parsed.data) === text, true, 'save → load → save даёт тот же JSON');
});

test('parseSaveJson: битый JSON, пустая строка и версия «из будущего»', () => {
    const broken = parseSaveJson('{ "store": ');
    eq(broken.ok, false);
    eq(broken.data, null);
    truthy(broken.error.indexOf('битый JSON') === 0, 'понятный текст: ' + broken.error);
    eq(parseSaveJson('').ok, false);
    eq(parseSaveJson('   ').ok, false);
    eq(parseSaveJson(null).error.indexOf('строка') > 0, true);
    eq(parseSaveJson('[1,2]').ok, false, 'массив — не сохранение');
    eq(parseSaveJson(JSON.stringify({ version: 1, data: { a: 1 } })).raw.version, 1,
       'raw хранит исходную версию файла (нужно saveInfo)');
    const future = parseSaveJson(JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION + 5 }));
    eq(future.ok, false);
    truthy(future.error.indexOf('новее') > 0, 'объясняем про версию: ' + future.error);
});

// ---------------------------------------------------------------------------
// Версии и миграции
// ---------------------------------------------------------------------------

test('migrateSave: запись $.store версии 1 становится слотом', () => {
    const data = migrateSave({ version: 1, saved_frame: 42, data: { highscore: 1200 } });
    eq(data.version, SAVE_VERSION);
    eq(data.migrated_from, 1, 'видно, что слот приехал из старого формата');
    eq(data.store.highscore, 1200);
    eq(data.world, null);
    eq(data.saved_frame, 42);
});

test('migrateSave: сцена $.prefab.saveScene становится миром слота', () => {
    const data = migrateSave({ version: 1, name: 'level', nodes: [{ tag: 'rect', id: 'a' }] });
    eq(data.world.length, 1);
    eq(data.world[0].id, 'a');
    eq(Object.keys(data.store).length, 0, 'у сцены нет данных $.store');
    eq(data.migrated_from, 1);
});

test('migrateSave: «сырой» объект — это данные $.store, мусор — null', () => {
    const data = migrateSave({ highscore: 5, inventory: ['меч'] });
    eq(data.store.highscore, 5);
    eq(data.world, null);
    eq(data.migrated_from, undefined);
    eq(migrateSave(null), null);
    eq(migrateSave(['нет']), null);
    eq(migrateSave('нет'), null);
    eq(migrateSave({ version: SAVE_VERSION + 1 }), null, 'версия новее — не грузим');
    eq(migrateSave({ format: SAVE_FORMAT, version: SAVE_VERSION }).migrated_from, undefined);
});

test('flattenNodes: обход узла, детей и массива корней', () => {
    const tree = [
        { tag: 'a', children: [{ tag: 'a1' }, { tag: 'a2', children: [{ tag: 'a2x' }] }] },
        { tag: 'b' },
    ];
    eq(flattenNodes(tree).map((n) => n.tag).join(','), 'a,a1,a2,a2x,b');
    eq(flattenNodes({ tag: 'solo' }).length, 1);
    eq(flattenNodes({ tag: 'solo' }).map((n) => n.tag).join(), 'solo');
    eq(flattenNodes(null).length, 0);
    eq(flattenNodes([null, 5]).length, 0);
});

test('saveInfo: метаданные слота для меню сохранений', () => {
    const info = saveInfo({ version: 1, saved_frame: 9, data: { a: 1, b: 2 } },
                          { slot: 3, path: 'saves/slot-3.json', size: 120 });
    eq(info.ok, true);
    eq(info.slot, '3');
    eq(info.version, 1);
    eq(info.current, SAVE_VERSION);
    eq(info.legacy, true, 'старый формат помечен');
    eq(info.store_keys, 2);
    eq(info.world_nodes, 0);
    eq(info.has_world, false);
    eq(info.size, 120);
    const modern = saveInfo(JSON.parse(serializeSave({ world: [{ tag: 'a', children: [{ tag: 'b' }] }] })),
                            { slot: 1 });
    eq(modern.legacy, false);
    eq(modern.world_nodes, 2, 'узлы мира посчитаны вместе с детьми');
    eq(modern.has_world, true);
});

test('info/list видят версию файла, а не мигрированную', () => {
    fresh();
    files.set('saves/slot-old.json',
              JSON.stringify({ version: 1, saved_frame: 5, data: { a: 1 } }));
    const info = $.save.info('old');
    eq(info.version, 1, 'версия взята из файла');
    eq(info.legacy, true, 'старый слот помечен');
    eq(info.store_keys, 1, 'данные при этом посчитаны');
    const entry = $.save.list().filter((s) => s.slot === 'old')[0];
    eq(entry.version, 1);
    eq(entry.legacy, true);
    eq($.save.read('old').migrated_from, 1, 'а read() отдаёт уже мигрированные данные');
    files.delete('saves/slot-old.json');
});

// ---------------------------------------------------------------------------
// $.save поверх настоящих $.store и $.prefab
// ---------------------------------------------------------------------------

test('save: слот пишется файлом, list/info/exists его видят', () => {
    fresh();
    $.store.set('highscore', 1200);
    $.save.slot(2);
    eq($.save.path(), 'saves/slot-2.json');
    eq($.save.save(), true);
    eq(files.has('saves/slot-2.json'), true, 'файл слота появился');
    eq($.save.exists(), true);
    eq($.save.exists(3), false);

    const info = $.save.info(2);
    eq(info.slot, '2');
    eq(info.store_keys, 1);
    eq(info.legacy, false);
    truthy(info.size > 0, 'размер слота известен');
    eq($.save.list().map((s) => s.slot).join(','), '2');
    eq($.save.list({ meta: false })[0].ok, undefined, 'без meta список дешёвый');

    const payload = $.save.read(2);
    eq(payload.store.highscore, 1200);
    eq(payload.version, SAVE_VERSION);

    eq($.save.remove(2), true);
    eq($.save.exists(2), false);
    eq($.save.remove(2), false, 'повторное удаление — false');
    eq($.save.info(2), null, 'нет слота — нет метаданных');
    truthy(String($.save.stats().last_error).indexOf('не найден') > 0,
           'в last_error осталось объяснение: ' + $.save.stats().last_error);
    eq($.save.list().length, 0);
});

test('load: данные $.store заменяются, «merge» — дополняются', () => {
    fresh();
    $.store.set('a', 1);
    $.save.slot(1).save();
    $.store.set('a', 99).set('b', 2);
    eq($.save.load(1), true);
    eq($.store.get('a'), 1);
    eq($.store.has('b'), false, 'слот — снимок целиком, лишнее убрано');
    eq($.save.slot(), '1', 'load переключил текущий слот');

    $.save.applyStore({ b: 2 }, 'merge');
    eq($.store.get('b'), 2);
    eq($.store.get('a'), 1, 'merge не стирает остальное');
    eq($.save.stats().loads > 0, true);
});

test('мир: $.prefab.save → слот → позиции, дети и id восстановлены', () => {
    fresh();
    const hero = new Node('rect', { id: 'hero', x: 100, y: 200, w: 20, h: 30 });
    const hat = new Node('rect', { id: 'hat', x: 0, y: -15 });
    hat.parent_node = hero;
    hero.child_nodes.push(hat);
    $.save.slot(1).save();

    hero.x = 999;
    hero.y = 999;
    new Node('rect', { id: 'junk' });      // мусор, которого не было в слоте
    const payload = $.save.read(1);
    eq(payload.world.length, 1, 'в снимке только корневые узлы');
    eq(flattenNodes(payload.world).length, 2, 'ребёнок уехал внутри родителя');

    eq($.save.load(1), true);
    const restored = ctx.byId.get('hero');
    truthy(restored, 'узел с тем же id восстановлен');
    near(restored.x, 100);
    near(restored.y, 200);
    eq(restored.child_nodes.length, 1, 'ребёнок восстановлен');
    truthy(ctx.byId.get('hat'), 'id ребёнка восстановлен');
    eq(ctx.byId.has('junk'), false, 'лишний узел убран (clear по умолчанию)');
    eq(ctx.nodes.filter((n) => !n.parent_node).length, 1);
});

test('applyWorld: clear=false добавляет мир поверх текущего', () => {
    fresh();
    new Node('rect', { id: 'base' });
    $.save.slot(1).save();
    resetWorld();
    new Node('rect', { id: 'extra' });
    const payload = $.save.read(1);
    const added = $.save.applyWorld(payload.world, { clear: false });
    eq(added, 1);
    truthy(ctx.byId.get('base'), 'мир из слота добавлен');
    truthy(ctx.byId.get('extra'), 'старый узел остался');
});

test('скорость тела переживает сохранение', () => {
    fresh();
    const saved_create = engine.createBody;
    const saved_get = engine.getVelocity;
    const saved_set = engine.setVelocity;
    const seen = [];
    engine.createBody = () => 77;
    // Живой движок отдаёт скорость тела; у только что созданного она нулевая.
    engine.getVelocity = (body) => (body === 77 ? [120, -30] : [0, 0]);
    engine.setVelocity = (body, vx, vy) => seen.push([body, vx, vy]);
    try {
        const bullet = new Node('bullet', { id: 'b1', x: 5, y: 6 });
        truthy(bullet.body >= 0, 'тело создано');
        const payload = $.save.snapshot();
        truthy(Array.isArray(payload.speeds), 'скорости попали в снимок');
        eq(payload.speeds.length, 1);

        resetWorld();
        engine.createBody = () => 88;
        eq($.save.apply(payload, { store: false }), true);
        // Конструктор узла сам зовёт setVelocity(0,0) — ищем именно нашу скорость.
        const applied = seen.filter((v) => v[1] === 120 && v[2] === -30);
        eq(applied.length, 1, 'скорость применена к новому телу');
        eq(applied[0][0], 88);
    } finally {
        engine.createBody = saved_create;
        engine.getVelocity = saved_get;
        engine.setVelocity = saved_set;
    }
});

test('export/import: строка JSON вместо файла', () => {
    fresh();
    $.store.set('hp', 42);
    const hero = new Node('rect', { id: 'hero', x: 10, y: 20 });
    const text = $.save.export();
    truthy(text.indexOf('"format": "r2d.save"') > 0, 'формат виден в строке');
    truthy(files.size === 0, 'export на диск не пишет');

    hero.x = 777;
    $.store.set('hp', 1);
    eq($.save.import(text), true);
    eq($.store.get('hp'), 42);
    near(ctx.byId.get('hero').x, 10);

    eq($.save.import('{ сломано'), false);
    truthy(String($.save.stats().last_error).indexOf('битый JSON') > 0);
    eq($.save.import(JSON.stringify({ version: SAVE_VERSION + 3 })), false);
});

test('снимок по частям: { store: false } и { world: false }', () => {
    fresh();
    $.store.set('gold', 7);
    new Node('rect', { id: 'hero', x: 1, y: 2 });
    const noStore = $.save.snapshot({ store: false });
    eq(Object.keys(noStore.store).length, 0, 'без данных $.store');
    eq(noStore.world.length, 1, 'мир на месте');
    const noWorld = $.save.snapshot({ world: false });
    eq(noWorld.world, null, 'без мира');
    eq(noWorld.store.gold, 7, 'данные $.store на месте');

    resetWorld();
    $.store.clear();
    eq($.save.import(serializeSave(noStore), { world: false }), true);
    eq($.store.get('gold'), undefined, 'store: false в снимке — данные не вернулись');
    eq(ctx.nodes.length, 0, 'мир не трогали');
});

test('counter: счётчик в $.store растёт и уезжает в слот', () => {
    fresh();
    eq($.save.counter('kills'), 0);
    eq($.save.counter('kills', 1), 1);
    eq($.save.counter('kills', 2), 3);
    eq($.store.get('kills'), 3);
    eq($.save.counter('kills', -1), 2);
    $.save.slot(5).save();
    $.store.set('kills', 0);
    $.save.load(5);
    eq($.save.counter('kills'), 2);
});

test('autosave: таймер $.time пишет в служебный слот 0', () => {
    fresh();
    const time = {
        fns: [],
        cancelled: 0,
        every(ms, fn) { this.fns.push({ ms, fn }); return this.fns.length; },
        cancel() { this.cancelled++; },
    };
    const saved_time = ctx.time;
    ctx.time = time;
    try {
        $.save.slot('boss');
        const id = $.save.autosave(100);
        eq(id, 1);
        eq($.save.stats().autosave_ms, 100);
        eq($.save.stats().autosave_slot, '0');
        eq(time.fns[0].ms, 100);
        time.fns[0].fn();
        eq($.save.exists(0), true, 'автосейв записал слот 0');
        eq($.save.slot(), 'boss', 'текущий слот не переключился');
        eq($.save.stats().autosaves, 1);
        $.save.stopAutosave();
        eq(time.cancelled, 1);
        eq($.save.stats().autosave_ms, 0);
    } finally {
        ctx.time = saved_time;
    }
});

test('краевые случаи: нет слота, битый файл, версия из будущего', () => {
    fresh();
    eq($.save.load(99), false);
    eq($.save.info(99), null);
    eq($.save.remove(99), false);
    eq($.save.read(99), null);

    files.set('saves/slot-8.json', '{ это не json');
    const broken = $.save.list().filter((s) => s.slot === '8')[0];
    truthy(broken, 'битый слот виден в списке');
    eq(broken.ok, false);
    truthy(String(broken.error).indexOf('битый JSON') === 0, broken.error);
    eq($.save.read(8), null);
    files.delete('saves/slot-8.json');

    files.set('saves/slot-9.json', JSON.stringify({ format: SAVE_FORMAT, version: 99, store: {} }));
    eq($.save.read(9), null);
    eq($.save.info(9), null);
    truthy(String($.save.stats().last_error).indexOf('новее') > 0);
    files.delete('saves/slot-9.json');

    files.set('saves/notes.txt', 'чужой файл');
    eq($.save.list().length, 0, 'чужие файлы каталога игнорируются');
    eq($.save.list({ dir: 'нет-такого' }).length, 0, 'пустой каталог — пустой список');
});

test('без $.fs модуль не падает, а объясняет, чего не хватает', () => {
    fresh();
    const saved_fs = $.fs;
    const saved_ctx_fs = ctx.fs;
    $.fs = null;
    ctx.fs = null;
    try {
        eq($.save.save(), false);
        truthy(String($.save.stats().last_error).indexOf('$.fs') > 0,
               'подсказка про store.js: ' + $.save.stats().last_error);
        eq($.save.exists(), false);
        eq($.save.list().length, 0);
        eq($.save.load(), false);
    } finally {
        $.fs = saved_fs;
        ctx.fs = saved_ctx_fs;
    }
    eq($.save.save(), true, 'после возврата $.fs сохранение снова работает');
});

test('личный каталог слотов: dir() не даёт затирать слоты друг друга', () => {
    fresh();
    $.store.set('level', 'forest');
    $.save.dir('build/test_saves').slot('quick').save();
    eq(files.has('build/test_saves/slot-quick.json'), true);
    eq($.save.list()[0].path, 'build/test_saves/slot-quick.json');
    eq($.save.dir(), 'build/test_saves');
    $.save.dir('saves').slot(1);
    eq($.save.exists(), false, 'в saves этого слота нет');
    eq($.save.load('quick'), false, 'слот ищется в текущем каталоге');
    $.save.dir('build/test_saves');
    eq($.save.load('quick'), true);
    eq($.store.get('level'), 'forest');
});

// ---------------------------------------------------------------------------
// §14: разделы, фабрики поведения, транзакционный restore, протокол диска
// ---------------------------------------------------------------------------

test('namespaces: profile переживает restartRun, run и room сбрасываются', () => {
    fresh();
    $.save.ns('profile').set('lang', 'ru');
    $.save.ns('profile').set('volume', 0.5);
    $.save.ns('presentation').set('overlay', false);
    $.save.ns('run').set('coins', 7);
    $.save.ns('room').set('roomKey', 1);
    new Node('rect', { id: 'hero' });
    eq($.save.ns(), 'room', 'ns() переключает текущий раздел');
    eq($.save.get('roomKey'), 1, 'get() читает текущий раздел');
    eq($.save.ns('profile').get('lang'), 'ru');
    eq($.save.nsData('run').coins, 7, 'nsData отдаёт весь раздел');

    $.save.restartRun();
    eq($.save.ns('run').get('coins'), undefined, 'run сброшен перезапуском');
    eq($.save.ns('room').get('roomKey'), undefined, 'room сброшен');
    eq($.save.ns('profile').get('lang'), 'ru', 'настройки профиля остались');
    eq($.save.ns('profile').get('volume'), 0.5);
    eq($.save.ns('presentation').get('overlay'), false, 'косметика осталась');
    eq(ctx.nodes.filter((n) => !n.removed && !n.parent_node).length, 0, 'мир сброшен');
    eq(NAMESPACES.join(','), 'profile,run,room,presentation');
});

test('снимок делит разделы, и они переживают слот и restore', () => {
    fresh();
    $.save.ns('profile').set('lang', 'ru');
    $.save.ns('presentation').set('fps', true);
    $.save.ns('run').set('coins', 3);
    new Node('rect', { id: 'hero', x: 10, y: 20 });
    eq($.save.slot(1).save(), true);

    const file = JSON.parse(files.get('saves/slot-1.json'));
    eq(file.version, SAVE_VERSION, 'файл в текущей версии');
    eq(file.namespaces.profile.data.lang, 'ru');
    eq(file.namespaces.presentation.data.fps, true);
    eq(file.namespaces.run.data.coins, 3);
    eq(file.namespaces.room.world.length, 1);
    eq(file.store, undefined, 'плоских зеркал в файле нет');

    $.save.profile().clear();
    $.save.ns('run').set('coins', 99);
    eq($.save.load(1), true);
    eq($.save.ns('profile').get('lang'), 'ru', 'раздел профиля вернулся');
    eq($.save.ns('run').get('coins'), 3, 'раздел прохождения вернулся');
    eq($.save.ns('presentation').get('fps'), true);
    eq(ctx.byId.get('hero').x, 10);

    const info = $.save.info(1);
    eq(info.namespaces.join(','), 'profile,run,room,presentation', 'info перечисляет непустые разделы');
    eq(info.node_state, 0, 'состояния по nid в этом слоте нет');
});

test('RNG: снимок живёт в разделе run и восстанавливается через $.random', () => {
    fresh();
    let restored = null;
    $.random = {
        state: () => ({ version: 1, algorithm: 'mulberry32', seed: 7, value: 42,
                        streams: { gameplay: { seed: 7, value: 3 } } }),
        validateState: () => true,
        restore: (s) => { restored = s; },
    };
    try {
        new Node('rect', { id: 'hero' });
        const payload = $.save.snapshot();
        eq(payload.namespaces.run.rng.value, 42, 'состояние RNG — в разделе run');
        const file = JSON.parse(serializeSave(payload));
        eq(file.namespaces.run.rng.seed, 7);
        eq(file.namespaces.run.rng.streams.gameplay.value, 3);

        restored = null;
        eq($.save.restore(payload).ok, true);
        truthy(restored && restored.value === 42, 'последовательность продолжилась с нужной точки');
        eq(restored.streams.gameplay.value, 3);
    } finally {
        delete $.random;
    }
});

test('фабрики поведения: состояние по nid пишется и восстанавливается', () => {
    fresh();
    $.save.clearBehaviors();
    let saved = 0, loaded = 0;
    const walker = new Node('rect', { id: 'w1' });
    walker.testHp = 30;
    walker.testCd = 0.5;
    eq($.save.behavior('rect', {
        save(node) {
            if (node.testHp === undefined) return null;
            saved++;
            return { hp: node.testHp, cd: node.testCd };
        },
        load(node, data) {
            loaded++;
            node.testHp = data.hp;
            node.testCd = data.cd;
        },
    }), 1, 'behavior() вернул число фабрик');

    const payload = $.save.snapshot();
    const nid = walker.nid;
    eq(payload.node_state[nid].p.rect.hp, 30, 'состояние узла ключуется по nid');
    eq(payload.namespaces.room.nodes[nid].p.rect.cd, 0.5);
    eq(saved, 1);

    walker.testHp = 1;
    walker.testCd = 9;
    const r = $.save.restore(payload);
    eq(r.ok, true, r.reason || '');
    eq(loaded, 1, 'фабрика восстановила узел ровно один раз');
    eq(r.applied, 1);
    const back = ctx.byId.get('w1');
    eq(back.testHp, 30, 'данные фабрики применились');
    eq(back.testCd, 0.5);
    eq(back.nid, nid, 'nid переживает restore');

    $.save.restore(payload);
    eq(loaded, 2, 'второй restore — снова по одному вызову на узел, а не два');
    $.save.clearBehaviors();
    eq($.save.behaviors().length, 0);
});

test('restore: ошибка до commit не уничтожает рабочее состояние', () => {
    fresh();
    const keep = new Node('rect', { id: 'keep', x: 5, y: 5 });
    const payload = $.save.snapshot();
    const rollbacks_before = $.save.stats().rollbacks;
    payload.namespaces.room.nodes = { n99999: { v: [0, 0] } };

    const before = ctx.nodes.filter((n) => !n.removed).length;
    const r = $.save.restore(payload);
    eq(r.ok, false, 'restore с битым состоянием отклонён');
    eq(r.stage, 'invariants');
    truthy(r.missing.indexOf('n99999') >= 0, 'отчёт назвал потерянный nid: ' + r.missing.join(','));
    eq(ctx.nodes.filter((n) => !n.removed).length, before, 'число узлов не изменилось');
    truthy(ctx.byId.get('keep') === keep, 'старый узел жив и зарегистрирован');
    eq($.save.stats().rollbacks - rollbacks_before, 1, 'откат посчитан');
    const fail = $.save.lastFailure();
    eq(fail.ok, false);
    eq(fail.stage, 'invariants');
    eq(fail.code, 'R2D_SAVE_INVARIANTS');

    // Успешный restore после отката работает и коммитит узлы.
    delete payload.namespaces.room.nodes.n99999;
    payload.namespaces.room.nodes[keep.nid] = { v: [0, 0] };
    const ok = $.save.restore(payload);
    eq(ok.ok, true, ok.reason || '');
    eq(ok.stage, 'commit');
    eq($.save.stats().committed_nodes, 1);
});

test('content-версии: strict отклоняет расхождение до изменений мира', () => {
    fresh();
    new Node('rect', { id: 'hero' });
    $.save.content('level1', { version: 1, hash: 'a1' });
    const payload = $.save.snapshot();
    $.save.content('level1', { version: 2, hash: 'b2' });

    const strict = $.save.restore(payload, { content: 'strict' });
    eq(strict.ok, false);
    eq(strict.stage, 'content');
    truthy(strict.content.length >= 1, 'расхождение content видно в отчёте');
    eq(strict.content[0].name, 'level1');
    eq(ctx.byId.get('hero').removed, false, 'мир не тронут: проверка была до подготовки');

    const warn = $.save.restore(payload, { content: 'warn' });
    eq(warn.ok, true, 'warn-политика применяет снимок');
    truthy(warn.content.length >= 1, 'но расхождение видно в отчёте');

    const ignore = $.save.restore(payload, { content: 'ignore' });
    eq(ignore.ok, true);
    $.save.content('level1', null);
    eq($.save.contents().versions.level1, undefined);
});

test('диск: временный файл, backup и восстановление слота после сбоя', () => {
    fresh();
    const temps_before = $.save.stats().temp_writes;
    const backups_before = $.save.stats().backups;
    $.save.ns('run').set('coins', 1);
    eq($.save.save(1), true);
    eq($.save.stats().temp_writes - temps_before, 1, 'запись идёт через временный файл');
    eq(files.has('saves/slot-1.json.tmp'), true, 'временный файл остался следом протокола');
    eq($.save.stats().backups - backups_before, 0, 'первой записи нечего копировать');

    $.save.ns('run').set('coins', 2);
    eq($.save.save(1), true);
    eq($.save.stats().backups - backups_before, 1, 'вторая запись сняла backup');
    eq(JSON.parse(files.get('saves/slot-1.json.bak')).namespaces.run.data.coins, 1);

    // Прерванная запись: основной файл испорчен, копия целая.
    files.set('saves/slot-1.json', '{ сломано');
    const recovered = $.save.read(1);
    eq(recovered.namespaces.run.data.coins, 1, 'слот взят из backup');
    truthy($.save.stats().recovered >= 1);
    const v = $.save.verify(1);
    eq(v.ok, false);
    eq(v.backup, true, 'verify говорит, что спасает backup');
    eq($.save.recover(1), true, 'recover вылечил основной файл');
    eq($.save.verify(1).ok, true);
    eq($.save.load(1), true, 'и слот снова читается');
});

test('слот из будущего не перезаписывается, а несовпавшая запись откатывается', () => {
    fresh();
    const future = JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION + 5, namespaces: {} });
    files.set('saves/slot-9.json', future);
    eq($.save.save(9), false, 'запись в слот из будущего отклонена');
    eq(files.get('saves/slot-9.json'), future, 'файл не тронут');
    truthy($.save.stats().rejected_future >= 1);
    truthy(String($.save.stats().last_error).indexOf('не перезаписываю') > 0);
    eq($.save.lastFailure().stage, 'future');

    // Запись, которая не совпала с прочитанным, слот не портит.
    fresh();
    $.save.ns('run').set('a', 1);
    eq($.save.save(2), true);
    const good = files.get('saves/slot-2.json');
    const real_write = engine.fs.write;
    engine.fs.write = (path, text) => real_write(path, path.indexOf('.tmp') > 0 ? text + ' ' : text);
    try {
        $.save.ns('run').set('a', 2);
        eq($.save.save(2), false, 'проверка записи поймала расхождение');
        eq(files.get('saves/slot-2.json'), good, 'основной слот остался прежним');
    } finally {
        engine.fs.write = real_write;
    }
});

test('saveInfo видит разделы, состояние по nid и content', () => {
    fresh();
    $.save.clearBehaviors();
    $.save.ns('profile').set('lang', 'ru');
    $.save.content('level1', { version: 3 });
    const hero = new Node('rect', { id: 'hero' });
    const payload = $.save.snapshot();
    payload.namespaces.room.nodes[hero.nid] = { v: [0, 0] };
    payload.content = { versions: { level1: 3 }, hashes: {} };
    const info = saveInfo(payload, { slot: 1 });
    eq(info.namespaces.join(','), 'profile,room', 'непустые разделы перечислены: ' + info.namespaces.join(','));
    eq(info.node_state, 1, 'состояние по nid посчитано');
    eq(info.content.versions.level1, 3, 'content-версия видна в метаданных');
});

finish();
