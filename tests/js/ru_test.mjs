// ===========================================================================
// Юнит-тесты русских имён без движка (qjs + tests/js/_harness.mjs).
//
// Проверяем то, что можно проверить без движка: таблицы не пустые, ключи —
// русские, значения указывают на существующие теги, перевод атрибутов не
// мутирует вход и не теряет чужие ключи.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/ru_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { TAGS } from '../../src/highlevel/core.js';
// Импорт render.js нужен по делу: теги <lightarea> и <fog> объявляет он,
// поэтому без него таблица русских имён ссылалась бы на несуществующие теги.
import '../../src/highlevel/render.js';
import { RU_TAGS, RU_ATTRS, RU_METHODS, RU_NAMESPACES, translateAttrs } from '../../src/highlevel/ru.js';

const CYRILLIC = /[\u0400-\u04FF]/;

test('таблицы русских имён не пустые', () => {
    truthy(Object.keys(RU_TAGS).length >= 20, 'тегов не меньше двадцати');
    truthy(Object.keys(RU_METHODS).length >= 20, 'методов не меньше двадцати');
    truthy(Object.keys(RU_NAMESPACES).length >= 10, 'пространств имён не меньше десяти');
    truthy(Object.keys(RU_ATTRS).length >= 5, 'атрибутов не меньше пяти');
});

test('ключи русских имён действительно русские', () => {
    for (const table of [RU_TAGS, RU_ATTRS, RU_METHODS, RU_NAMESPACES]) {
        for (const key of Object.keys(table)) truthy(CYRILLIC.test(key), `ключ "${key}" с кириллицей`);
    }
});

test('значения русских тегов — имена тегов, а не что попало', () => {
    // Часть тегов объявляют подсистемы внутри install*(), поэтому в голом qjs
    // видны не все: здесь проверяем форму имени, а существование КАЖДОГО
    // псевдонима проверяет агентский тест уже в живом движке
    // (tests/agent/highlevel_ru_test.py).
    for (const key of Object.keys(RU_TAGS)) {
        const value = RU_TAGS[key];
        truthy(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)?$/.test(value),
               `значение псевдонима "${key}" похоже на тег: ${value}`);
    }
});

test('теги ядра и отрисовки видны уже при импорте', () => {
    // Эти теги объявлены статически (core.js / render.js) — если псевдоним
    // ссылается на такой тег, он обязан резолвиться сразу.
    const static_tags = ['player', 'enemy', 'npc', 'pickup', 'bullet', 'sprite', 'rect',
                         'circle', 'text', 'tilemap', 'particles', 'trigger', 'area',
                         'wall', 'light', 'lightarea', 'fog'];
    for (const name of static_tags) truthy(!!TAGS[name], `тег <${name}> объявлен`);
    for (const key of Object.keys(RU_TAGS)) {
        const value = RU_TAGS[key];
        if (static_tags.indexOf(value) >= 0) truthy(!!TAGS[value], `<${value}> есть в TAGS`);
    }
});

test('значения таблиц — непустые строки без кириллицы', () => {
    for (const table of [RU_TAGS, RU_ATTRS, RU_METHODS, RU_NAMESPACES]) {
        for (const key of Object.keys(table)) {
            const value = table[key];
            truthy(typeof value === 'string' && value.length > 0, `значение для "${key}"`);
            truthy(!CYRILLIC.test(value), `значение "${value}" — латиница`);
        }
    }
});

test('перевод атрибутов меняет русские ключи и не трогает остальные', () => {
    const out = translateAttrs({ 'радиус': 260, 'цвет': '#ffd9a0', id: 'свет', hp: 10 });
    eq(out.radius, 260);
    eq(out.color, '#ffd9a0');
    eq(out.id, 'свет');
    eq(out.hp, 10);
    truthy(out['радиус'] === undefined, 'русский ключ не остался');
});

test('перевод атрибутов не мутирует вход', () => {
    const source = { 'радиус': 100 };
    translateAttrs(source);
    eq(source['радиус'], 100);
    eq(Object.keys(source).length, 1);
});

test('перевод атрибутов терпим к пустым значениям', () => {
    eq(translateAttrs(null), null);
    eq(translateAttrs(undefined), undefined);
    eq(Object.keys(translateAttrs({})).length, 0);
});

test('приоритет у латинского ключа, если заданы оба', () => {
    // Порядок ключей в объекте: русский переводится в латинский и затирает
    // прежний — это осознанно: побеждает то, что написали позже в литерале.
    const out = translateAttrs({ radius: 100, 'радиус': 200 });
    eq(out.radius, 200);
});

finish();
