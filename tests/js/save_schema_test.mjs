// ===========================================================================
// Юнит-тесты игровой схемы сохранений ($.save.schema) и настроек
// ($.store.schema) без движка (qjs + tests/js/_harness.mjs).
//
// Проверяем ровно контракт схемы:
//   * legacy-файл без поля "schema" — схема 0, цепочка migrate[0], migrate[1]…;
//   * старый файл доезжает до текущей схемы по шагам, на копии, с сохранением
//     неизвестных полей;
//   * схема из будущего — структурный отказ R2D_SAVE_SCHEMA_FUTURE, файл цел и
//     не перезаписывается;
//   * defaults — глубоко и не разрушая; validate — структурный отказ;
//   * настройки: backup последнего корректного файла и восстановление из него
//     при повреждении/будущей схеме, без «тихого сброса».
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/save_schema_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node } from '../../src/highlevel/core.js';
import { installStore } from '../../src/highlevel/store.js';
import { installPrefab } from '../../src/highlevel/prefab.js';
import {
    installSave, applySchemaMigrations, deepDefaults, deepCopy, saveExtras, schemaOf,
    normalizeSchemaConfig, parseSaveJson, serializeSave, SAVE_FORMAT, SAVE_VERSION,
    SAVE_SCHEMA_LEGACY, SAVE_SCHEMA_FUTURE, SAVE_SCHEMA_MIGRATION,
    SAVE_SCHEMA_DEFAULTS, SAVE_SCHEMA_INVALID,
} from '../../src/highlevel/save.js';

// destroy() рассылает событие 'remove' через глобальный $. В харнессе $ нет —
// подставляем заглушку (как tests/js/save_test.mjs).
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
$.fs = ctx.fs;
$.store = ctx.store;
installPrefab($);
installSave($);

function fresh() {
    for (const node of ctx.nodes.slice()) {
        if (!node.removed && !node.parent_node) node.destroy();
    }
    for (const [id, node] of [...ctx.byId.entries()]) if (node.removed) ctx.byId.delete(id);
    ctx.nodes.length = 0;
    resetFiles();
    $.store.clear();
    $.store.file('save.json');
    $.store.schema(null);
    $.save.slot(1).dir('saves').stopAutosave();
    $.save.schema(null);
    $.save.restartRun({ profile: true, presentation: true });
    $.save.clearBehaviors();
}

/** Файл слота с документом указанной схемы (или без поля "schema"). */
function putSlot(doc, slot) {
    files.set('saves/slot-' + (slot === undefined ? 1 : slot) + '.json', JSON.stringify(doc));
    return 'saves/slot-' + (slot === undefined ? 1 : slot) + '.json';
}

function runSlot(namespaces, schema, slot) {
    const doc = { format: SAVE_FORMAT, version: SAVE_VERSION, namespaces: namespaces || {} };
    if (schema !== undefined && schema !== null) doc.schema = schema;
    return putSlot(doc, slot);
}

// ---------------------------------------------------------------------------
// Чистые функции схемы
// ---------------------------------------------------------------------------

test('deepCopy: объекты и массивы копируются, примитивы — как есть', () => {
    const source = { a: 1, nested: { b: [1, { c: 2 }] } };
    const copy = deepCopy(source);
    eq(copy.a, 1);
    copy.nested.b[1].c = 9;
    eq(source.nested.b[1].c, 2, 'копия не делит вложенные объекты');
    eq(deepCopy(5), 5);
    eq(deepCopy(null), null);
});

test('deepDefaults: глубоко, не разрушая; существующее (включая falsy) не перезаписывается', () => {
    const doc = {
        a: 1, zero: 0, off: false, empty: '',
        nested: { keep: 5, add: { x: 1 } },
        list: [1],
    };
    deepDefaults(doc, {
        a: 9, zero: 9, off: true, empty: 'x', added: 2,
        nested: { keep: 1, add: { y: 2 }, deep: 3 },
        list: [7, 8],
        obj: { k: 'v' },
    });
    eq(doc.a, 1, 'существующее значение не перезаписано');
    eq(doc.zero, 0, 'ноль — существующее значение');
    eq(doc.off, false);
    eq(doc.empty, '');
    eq(doc.added, 2, 'пропущенное поле добавлено');
    eq(doc.nested.keep, 5);
    eq(doc.nested.add.x, 1);
    eq(doc.nested.add.y, 2, 'вложенный объект дополнен');
    eq(doc.nested.deep, 3);
    eq(doc.list.join(','), '1', 'массив по умолчанию не перезаписывает существующий');
    eq(doc.obj.k, 'v');
});

test('schemaOf / saveExtras: legacy без поля, данные игры отделены от формата', () => {
    eq(schemaOf({}), null, 'поля нет — legacy');
    eq(schemaOf({ schema: 3.7 }), 3);
    eq(schemaOf({ schema: '3' }), null, 'строка — не номер схемы');
    eq(schemaOf([]), null);

    const extras = saveExtras({
        format: 'x', version: 3, schema: 1, saved_at: 0, namespaces: {},
        mod_state: { waves: 2 }, onTick: () => 1,
        cyc: (() => { const c = { n: 1 }; c.self = c; return c; })(),
    });
    eq(extras.mod_state.waves, 2, 'неизвестное поле игры сохранено');
    eq('format' in extras, false, 'поля формата — не данные игры');
    eq('onTick' in extras, false, 'в функции в документ не попадают');
    eq(extras.cyc.self, undefined, 'цикл разорван');
});

test('normalizeSchemaConfig: кривая конфигурация не молчит', () => {
    const warned = [];
    const cfg = normalizeSchemaConfig({
        version: -1,
        migrate: { x: () => {}, 1: 'нет' },
        defaults: 5,
        validate: 7,
    }, (message) => warned.push(message));
    truthy(cfg, 'конфигурация всё равно вернулась');
    eq(cfg.version, 0, 'version < 0 приводится к 0');
    truthy(cfg.errors.length >= 4, 'ошибки собраны: ' + cfg.errors.join(' | '));
    eq(normalizeSchemaConfig(null), null, 'null выключает схему');
});

test('applySchemaMigrations: миграции на копии, вход не меняется, неизвестное живёт', () => {
    const raw = { schema: 1, namespaces: { run: { data: { a: 1 } } }, game: { x: 1 } };
    const snapshot = JSON.stringify(raw);
    const result = applySchemaMigrations(raw, {
        version: 2,
        migrate: {
            1: (doc) => {
                doc.namespaces.run.data.b = doc.namespaces.run.data.a + 1;
                doc.game.x = 2;
                return doc;
            },
        },
        defaults: { namespaces: { run: { data: { gold: 0 } } } },
        validate: () => true,
    });
    eq(result.ok, true);
    eq(result.applied.length, 1);
    eq(JSON.stringify(raw), snapshot, 'входной документ не изменён (миграции на глубокой копии)');
    eq(result.data.namespaces.run.data.b, 2);
    eq(result.data.game.x, 2, 'неизвестное поле игры пережило миграцию');
    eq(result.data.namespaces.run.data.gold, 0);
    eq(result.data.schema, 2, 'документ помечен текущей схемой');
    eq(result.current, 2);

    const future = applySchemaMigrations({ schema: 5 }, { version: 2 });
    eq(future.ok, false);
    eq(future.code, SAVE_SCHEMA_FUTURE);
    eq(future.stage, 'schema');
    eq(future.schema, 5);
});

test('applySchemaMigrations: legacy без migrate[0] считается текущим', () => {
    const result = applySchemaMigrations({ namespaces: { run: { data: {} } } }, {
        version: 2,
        migrate: { 2: () => ({}) },
        defaults: { namespaces: { run: { data: { gold: 0 } } } },
    });
    eq(result.ok, true);
    eq(result.from, 2, 'без migrate[0] документ — текущей схемы');
    eq(result.applied.length, 0);
    eq(result.data.namespaces.run.data.gold, 0, 'defaults при этом применяются');
});

// ---------------------------------------------------------------------------
// $.save: legacy → текущая схема
// ---------------------------------------------------------------------------

test('legacy-слот без "schema" идёт migrate[0] → migrate[1], по одному шагу', () => {
    fresh();
    const calls = [];
    $.save.schema({
        version: 2,
        migrate: {
            0: (doc) => { calls.push('0→1'); doc.namespaces.run.data.step1 = true; return doc; },
            1: (doc) => {
                calls.push('1→2');
                doc.namespaces.run.data.step2 = doc.schema === 1;
                return doc;
            },
        },
    });
    runSlot({ run: { data: { gold: 5 } } }, null);
    const before = $.save.stats().schema_migrations;
    eq($.save.load(1), true);
    eq(calls.join(','), '0→1,1→2', 'шаги строго по порядку и без пропусков');
    eq($.store.get('gold'), 5, 'данные игры не потеряны');
    eq($.store.get('step1'), true);
    eq($.store.get('step2'), true, 'следующая миграция видит уже новую схему');
    eq($.save.stats().schema_migrations - before, 1);
});

test('схема old→current: цепочка, defaults (глубоко) и validate', () => {
    fresh();
    let validated = 0;
    $.save.schema({
        version: 3,
        migrate: {
            1: (doc) => { doc.namespaces.run.data.hp = 100; return doc; },
            2: (doc) => {
                doc.namespaces.run.data.mana = doc.namespaces.run.data.hp + 10;
                return doc;
            },
        },
        defaults: { namespaces: { run: { data: { gold: 0, nested: { a: 1, b: 2 } } } } },
        validate: (doc) => {
            validated++;
            return doc.namespaces.run.data.gold >= 0;
        },
    });
    runSlot({ run: { data: { gold: 7, nested: { a: 5 } } } }, 1);
    eq($.save.load(1), true);
    eq($.store.get('hp'), 100, 'миграция 1→2 применилась');
    eq($.store.get('mana'), 110, 'миграция 2→3 увидела результат прошлой');
    eq($.store.get('gold'), 7, 'defaults не перезаписали существующее');
    eq($.store.get('nested').a, 5);
    eq($.store.get('nested').b, 2, 'вложенный default добавлен');
    eq(validated, 1, 'validate вызван ровно один раз');
});

test('defaults функцией получают документ после миграций', () => {
    fresh();
    $.save.schema({
        version: 1,
        migrate: { 0: (doc) => { doc.namespaces.run.data.level = 2; return doc; } },
        defaults: (doc) => ({
            namespaces: { run: { data: { level_name: 'level-' + doc.namespaces.run.data.level } } },
        }),
    });
    runSlot({ run: { data: {} } }, null);
    eq($.save.load(1), true);
    eq($.store.get('level'), 2);
    eq($.store.get('level_name'), 'level-2', 'defaults увидели результат миграции');
});

test('legacy «сырые» данные $.store: схема не становится данными прохождения', () => {
    fresh();
    $.save.schema({
        version: 1,
        migrate: { 0: (doc) => { doc.gold = (doc.gold || 0) + 1; return doc; } },
        defaults: { hp: 100 },
    });
    files.set('saves/slot-1.json', JSON.stringify({ gold: 5 }));
    eq($.save.load(1), true);
    eq($.store.get('gold'), 6, 'миграция работает по объекту данных');
    eq($.store.get('hp'), 100, 'defaults дополнили данные');
    eq($.store.get('schema'), undefined, 'служебная схема не стала данными игры');
    const payload = $.save.read(1);
    eq(payload.extra, undefined, 'у «сырых» данных нет отдельных extras');
    eq($.store.get('format'), undefined);
});

// ---------------------------------------------------------------------------
// $.save: отказы схемы
// ---------------------------------------------------------------------------

test('схема из будущего: R2D_SAVE_SCHEMA_FUTURE, файл цел, слот не перезаписывается', () => {
    fresh();
    $.save.schema({ version: 2, migrate: { 1: (doc) => doc } });
    $.store.set('gold', 1);
    const text = runSlot({ run: { data: { gold: 9 } } }, 9);
    const original = files.get(text);

    eq($.save.load(1), false, 'load отказан');
    const failure = $.save.lastFailure();
    eq(failure.ok, false);
    eq(failure.code, SAVE_SCHEMA_FUTURE);
    eq(failure.stage, 'schema');
    eq(failure.version, null);
    eq(failure.details.schema, 9);
    eq(failure.details.current, 2);
    eq(files.get(text), original, 'файл не тронут');
    eq($.store.get('gold'), 1, 'текущие данные не тронуты отказом');
    eq($.save.read(1), null, 'read отказан');
    eq($.save.info(1), null, 'info отказан');

    eq($.save.save(1), false, 'запись в слот будущей схемы отклонена');
    eq(files.get(text), original, 'слот не перезаписан');
    eq($.save.lastFailure().code, SAVE_SCHEMA_FUTURE);
    eq($.save.lastFailure().stage, 'future');
    truthy($.save.stats().rejected_future >= 1);
});

test('миграция: пропуск шага и исключение — структурный R2D_SAVE_SCHEMA_MIGRATION', () => {
    fresh();
    $.save.schema({ version: 3, migrate: { 1: (doc) => doc } });
    runSlot({ run: { data: {} } }, 1);
    eq($.save.load(1), false);
    eq($.save.lastFailure().code, SAVE_SCHEMA_MIGRATION);
    eq($.save.lastFailure().stage, 'migration');
    truthy(String($.save.lastFailure().message).indexOf('2 → 3') > 0,
        'в причине назван пропущенный шаг: ' + $.save.lastFailure().message);

    fresh();
    $.save.schema({ version: 2, migrate: { 1: () => { throw new Error('бум в миграции'); } } });
    runSlot({ run: { data: {} } }, 1);
    eq($.save.load(1), false);
    eq($.save.lastFailure().code, SAVE_SCHEMA_MIGRATION);
    truthy(String($.save.lastFailure().message).indexOf('бум в миграции') > 0,
        'причина исключения названа: ' + $.save.lastFailure().message);
});

test('validate: false / строка / {ok:false} — R2D_SAVE_SCHEMA_INVALID, файл цел', () => {
    const cases = [
        { validate: () => false, code: SAVE_SCHEMA_INVALID },
        { validate: () => 'золото отрицательное', code: SAVE_SCHEMA_INVALID, text: 'золото отрицательное' },
        { validate: () => ({ ok: false, code: 'GAME_BAD_SAVE', message: 'нет героя' }), code: 'GAME_BAD_SAVE' },
        { validate: () => { throw new Error('валидатор упал'); }, code: SAVE_SCHEMA_INVALID },
    ];
    for (const item of cases) {
        fresh();
        $.save.schema({ version: 1, validate: item.validate });
        const path = runSlot({ run: { data: { gold: -1 } } }, 1);
        const original = files.get(path);
        eq($.save.load(1), false, 'load отказан');
        eq($.save.lastFailure().code, item.code, 'код отказа: ' + item.code);
        eq($.save.lastFailure().stage, 'validate');
        eq(files.get(path), original, 'файл не тронут');
        if (item.text) {
            truthy(String($.save.lastFailure().message).indexOf(item.text) >= 0,
                'текст отказа: ' + $.save.lastFailure().message);
        }
    }
});

test('validate: true/undefined проходят, defaults с ошибкой — R2D_SAVE_SCHEMA_DEFAULTS', () => {
    fresh();
    $.save.schema({ version: 1, validate: () => true });
    runSlot({ run: { data: { gold: 1 } } }, 1);
    eq($.save.load(1), true);
    eq($.store.get('gold'), 1);

    fresh();
    $.save.schema({ version: 1, defaults: () => 'не объект' });
    runSlot({ run: { data: {} } }, 1);
    eq($.save.load(1), false);
    eq($.save.lastFailure().code, SAVE_SCHEMA_DEFAULTS);
    eq($.save.lastFailure().stage, 'defaults');
});

test('legacy без migrate[0] считается текущим: defaults, без миграций', () => {
    fresh();
    $.save.schema({
        version: 2,
        migrate: { 2: () => ({}) },
        defaults: { namespaces: { run: { data: { gold: 0 } } } },
    });
    runSlot({ run: { data: {} } }, null);
    const before = $.save.stats().schema_migrations;
    eq($.save.load(1), true);
    eq($.store.get('gold'), 0);
    eq($.save.stats().schema_migrations - before, 0, 'миграций не было');
});

// ---------------------------------------------------------------------------
// $.save: неизвестные поля и запись схемы
// ---------------------------------------------------------------------------

test('неизвестные поля документа переживают load → read → write', () => {
    fresh();
    $.save.schema({ version: 1 });
    const text = JSON.stringify({
        format: SAVE_FORMAT, version: SAVE_VERSION, schema: 1,
        mod_state: { waves: 3 }, custom_flag: true,
        namespaces: { run: { data: { gold: 4 } } },
    });
    files.set('saves/slot-1.json', text);
    const payload = $.save.read(1);
    eq(payload.extra.mod_state.waves, 3, 'неизвестное поле вернулось в снимок');
    eq(payload.extra.custom_flag, true);

    eq($.save.write(payload, 2), true);
    const file = JSON.parse(files.get('saves/slot-2.json'));
    eq(file.mod_state.waves, 3, 'неизвестное поле записано обратно');
    eq(file.custom_flag, true);
    eq(file.schema, 1, 'в файл пишется текущая схема');
    eq($.save.read(2).extra.custom_flag, true, 'и снова читается');
});

test('файл пишется с текущей схемой; без схемы поля "schema" нет (legacy 0)', () => {
    fresh();
    $.save.slot(1).save();
    let file = JSON.parse(files.get('saves/slot-1.json'));
    eq('schema' in file, false, 'без $.save.schema поле не пишется');
    eq($.save.schema().version, SAVE_SCHEMA_LEGACY);
    eq($.save.stats().schema, SAVE_SCHEMA_LEGACY);

    $.save.schema({ version: 4 });
    $.save.slot(1).save();
    file = JSON.parse(files.get('saves/slot-1.json'));
    eq(file.schema, 4);
    eq($.save.stats().schema, 4);
    const exported = JSON.parse($.save.export());
    eq(exported.schema, 4, 'export() тоже пишет схему');
    eq($.save.schema(null).stats().schema, 0, 'schema(null) выключает схему');
});

test('parseSaveJson: тот же контракт для строк, схема видна в результате', () => {
    fresh();
    const parsed = parseSaveJson(serializeSave({ store: { hp: 5 } }));
    eq(parsed.ok, true);
    eq(parsed.error, null);
    eq(parsed.schema, SAVE_SCHEMA_LEGACY);
    eq(parsed.current, SAVE_SCHEMA_LEGACY);
    eq(parsed.data.store.hp, 5);

    $.save.schema({ version: 2 });
    const text = JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, schema: 9 });
    const future = parseSaveJson(text);
    eq(future.ok, false);
    eq(future.code, SAVE_SCHEMA_FUTURE);
    eq(future.error, 'схема сохранения 9 новее поддерживаемой (2)');
});

// ---------------------------------------------------------------------------
// $.store: схема настроек, backup и восстановление
// ---------------------------------------------------------------------------

test('настройки: legacy-файл мигрирует, defaults применяются, backup снимается', () => {
    fresh();
    $.store.schema({
        version: 2,
        migrate: {
            0: (doc) => { doc.data.volume = doc.data.volume === undefined ? 0.7 : doc.data.volume; return doc; },
            1: (doc) => { doc.data.migrated = true; return doc; },
        },
        defaults: { data: { lang: 'ru' } },
        validate: (doc) => !!doc.data,
    });
    files.set('save.json', JSON.stringify({ version: 1, data: { volume: 0.5 } }));
    eq($.store.load(), true);
    eq($.store.get('volume'), 0.5, 'значение не перезаписано миграцией');
    eq($.store.get('migrated'), true);
    eq($.store.get('lang'), 'ru', 'defaults применены к data');
    eq($.store.stats().schema, 2);

    $.store.set('volume', 0.9);
    eq($.store.save(), true);
    const file = JSON.parse(files.get('save.json'));
    eq(file.schema, 2, 'схема пишется в файл настроек');
    eq(file.data.volume, 0.9);
    eq(files.has('save.json.bak'), true, 'снят backup последней корректной версии');
    eq(JSON.parse(files.get('save.json.bak')).data.volume, 0.5);
});

test('настройки: повреждённый файл — восстановление из backup, без сброса', () => {
    fresh();
    $.store.schema({ version: 1 });
    files.set('save.json.bak', JSON.stringify({ version: 1, schema: 1, data: { a: 5 } }));
    files.set('save.json', '{ это не json');
    const result = $.store.loadResult();
    eq(result.ok, true, result.message || '');
    eq(result.recovered, true);
    eq(result.backup, true);
    eq($.store.get('a'), 5, 'данные взяты из backup');
    eq($.store.stats().recovered >= 1, true);
});

test('настройки: схема из будущего — структурный отказ, данные в памяти целы', () => {
    fresh();
    const saves_before = $.store.stats().saves;
    $.store.schema({ version: 1 });
    $.store.set('a', 1);
    const text = JSON.stringify({ version: 1, schema: 7, data: { a: 9 } });
    files.set('save.json', text);
    eq($.store.load(), false, 'load отказан');
    const failure = $.store.lastFailure();
    eq(failure.ok, false);
    eq(failure.code, SAVE_SCHEMA_FUTURE);
    eq(failure.stage, 'schema');
    eq($.store.get('a'), 1, 'настройки в памяти не сброшены');
    eq(files.get('save.json'), text, 'файл не тронут');

    eq($.store.save(), false, 'запись в файл будущей схемы отклонена');
    eq(files.get('save.json'), text, 'файл по-прежнему не тронут');
    eq($.store.lastFailure().code, SAVE_SCHEMA_FUTURE);
    eq($.store.stats().saves - saves_before, 0, 'записи не было');
});

test('настройки: будущая схема, но есть валидный backup — берём backup', () => {
    fresh();
    $.store.schema({ version: 1 });
    files.set('save.json', JSON.stringify({ version: 1, schema: 7, data: { a: 9 } }));
    files.set('save.json.bak', JSON.stringify({ version: 1, schema: 1, data: { a: 3 } }));
    eq($.store.load(), true);
    eq($.store.get('a'), 3);
    eq($.store.loadResult === undefined, false);
    truthy($.store.stats().recovered >= 1);
});

test('настройки: validate отклоняет файл и не сбрасывает память', () => {
    fresh();
    $.store.schema({ version: 1, validate: () => false });
    $.store.set('keep', 'me');
    const text = JSON.stringify({ version: 1, schema: 1, data: { a: 1 } });
    files.set('save.json', text);
    eq($.store.load(), false);
    eq($.store.get('keep'), 'me', 'память цела');
    eq($.store.lastFailure().code, SAVE_SCHEMA_INVALID);
    eq(files.get('save.json'), text);
});

// ---------------------------------------------------------------------------
// Атомарная замена: $.fs.writeAtomic → целевой файл, backup/verify остаются
// ---------------------------------------------------------------------------

test('$.fs.writeAtomic: строка или JSON, атомарный биндинг используется', () => {
    fresh();
    const calls = [];
    const saved = engine.fs.writeAtomic;
    engine.fs.writeAtomic = (path, text) => { calls.push(path); files.set(path, text); return true; };
    try {
        eq($.fs.writeAtomic('a.json', '{"x":1}'), true);
        eq(files.get('a.json'), '{"x":1}', 'строка записана как есть');
        eq($.fs.writeAtomic('b.json', { y: 2 }), true);
        eq(JSON.parse(files.get('b.json')).y, 2, 'объект записан JSON');
        eq(calls.join(','), 'a.json,b.json', 'обе записи прошли через биндинг');
    } finally {
        engine.fs.writeAtomic = saved;
    }
});

test('$.store.save и $.save.save заменяют целевой файл атомарно, backup цел', () => {
    fresh();
    const calls = [];
    const saved = engine.fs.writeAtomic;
    engine.fs.writeAtomic = (path, text) => { calls.push(path); files.set(path, text); return true; };
    try {
        $.store.set('volume', 0.4);
        const result = $.store.saveResult();
        eq(result.ok, true);
        eq(result.atomic, true, 'saveResult знает про атомарную замену');
        truthy(calls.indexOf('save.json') >= 0, 'настройки заменены через writeAtomic: ' + calls.join(','));
        eq(JSON.parse(files.get('save.json')).data.volume, 0.4);

        $.save.slot(1).save();
        truthy(calls.indexOf('saves/slot-1.json') >= 0, 'слот заменён через writeAtomic: ' + calls.join(','));
        $.save.slot(1).set('gold', 3).save();
        eq($.save.stats().atomic, true);
        eq(files.has('saves/slot-1.json.bak'), true, 'backup снят до замены');
        eq(JSON.parse(files.get('saves/slot-1.json')).namespaces.run.data.gold, 3);
    } finally {
        engine.fs.writeAtomic = saved;
    }
});

test('без биндинга writeAtomic — честный fallback на запись, протокол прежний', () => {
    fresh();
    const saved = engine.fs.writeAtomic;
    delete engine.fs.writeAtomic;
    try {
        eq($.fs.writeAtomic('c.json', { z: 3 }), true, 'fallback вернул успех');
        eq(JSON.parse(files.get('c.json')).z, 3, 'файл записан обычной записью');
        $.store.set('a', 1);
        const result = $.store.saveResult();
        eq(result.ok, true, 'настройки пишутся и без биндинга');
        eq(result.atomic, false, 'saveResult честно говорит: не атомарно');
        $.save.slot(1).save();
        eq($.save.stats().atomic, false);
        eq(files.has('saves/slot-1.json.tmp'), true, 'temp-файл протокола на месте');
    } finally {
        engine.fs.writeAtomic = saved;
    }
});

test('настройки: без схемы поведение прежнее, поле schema не пишется', () => {
    fresh();
    $.store.set('highscore', 1200);
    eq($.store.save(), true);
    const file = JSON.parse(files.get('save.json'));
    eq(file.version, 1);
    eq('schema' in file, false);
    eq(file.data.highscore, 1200);
    eq($.store.load(), true);
    eq($.store.get('highscore'), 1200);
    eq($.store.stats().last_failure, null);
    eq($.store.file('settings.json').file(), 'settings.json');
    $.store.file('save.json');
});

finish();
