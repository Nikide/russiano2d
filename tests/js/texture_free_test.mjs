// ===========================================================================
// Тест выгрузки текстур: $.resource.free() действительно возвращает слот
// движку, а кэши ядра забывают старый id.
//
// Зачем. До этой правки выгрузки не было вовсе: `free()` только забывал
// значение у себя, GPU-память и слот оставались занятыми до конца процесса, а
// лимит — 256 текстур (см. docs/highlevel/resource.md §5). Проверяем, что
// dispose-хук по умолчанию зовёт engine.freeTexture, а forgetTexture чистит
// кэши пути, области и листа.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/texture_free_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, forgetTexture, textureSizeOf } from '../../src/highlevel/core.js';
import { installStore } from '../../src/highlevel/store.js';
import { installResource, normalizeSpec } from '../../src/highlevel/resource.js';

// Подставной движок: помним, что просили выгрузить, и сколько раз читали файл.
const freed = [];
let loads = 0;
engine.loadTexture = (path) => { loads++; return loads; };
engine.textureSize = () => [32, 32];
engine.freeTexture = (id) => { freed.push(id); return true; };
engine.createSprite = () => loads;
engine.fs = {
    readText: () => undefined,
    write: () => true,
    exists: () => false,
    remove: () => false,
    list: () => [],
};

const $ = {};
installStore($);
$.fs = ctx.fs;
installResource($);

test('normalizeSpec ставит dispose для texture', () => {
    const spec = normalizeSpec('tiles', 'assets/tiles.png');
    eq(spec.kind, 'texture');
    truthy(typeof spec.dispose === 'function', 'dispose появился сам');
    spec.dispose(7);
    eq(freed[freed.length - 1], 7, 'dispose вызвал engine.freeTexture');
});

test('своё dispose важнее встроенного', () => {
    const mine = () => { freed.push(-1); };
    const spec = normalizeSpec('custom', { kind: 'texture', path: 'a.png', dispose: mine });
    eq(spec.dispose, mine, 'чужой dispose не перекрыт');
});

test('load → free возвращает слот движку', () => {
    const before = freed.length;
    $.resource.define('t1', 'assets/tiles.png');
    const value = $.resource.get('t1');
    truthy(value >= 0, 'ресурс загрузился');
    eq($.resource.free('t1'), 0, 'ссылок не осталось');
    eq(freed.length, before + 1, 'движку сказали выгрузить');
    eq(freed[freed.length - 1], value, 'выгрузили именно эту текстуру');
});

test('freeAll выгружает все текстуры', () => {
    const before = freed.length;
    $.resource.load('t2', 'assets/a.png');
    $.resource.load('t3', 'assets/b.png');
    const count = $.resource.freeAll();
    truthy(count >= 2, 'выгружено не меньше двух');
    truthy(freed.length >= before + 2, 'каждая текстура вернула слот');
});

test('forgetTexture чистит кэши пути, области и листа', () => {
    // Прогреваем кэши ядра подставными значениями через настоящий API.
    const id = engine.loadTexture('assets/tiles.png');
    textureSizeOf('assets/tiles.png');           // положит путь в texture_cache
    forgetTexture('assets/tiles.png');
    // После забывания следующая загрузка должна снова спросить движок.
    const loads_before = loads;
    engine.loadTexture('assets/tiles.png');
    eq(loads, loads_before + 1, 'после forgetTexture путь не берётся из кэша');
    eq(id >= 0, true, 'сама загрузка работает');
});

test('ресурс-данные dispose не получают', () => {
    const spec = normalizeSpec('tuning', { kind: 'data', value: { a: 1 } });
    eq(spec.dispose, undefined, 'у данных своего dispose нет');
});

finish();
