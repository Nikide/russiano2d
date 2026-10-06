// ===========================================================================
// Юнит-тест локализации без движка (qjs).
//
// Проверяет чистые помощники (format/pluralIndex/lookup), работу словарей и
// переключение языка, плюральные формы, предупреждение о пропавшем ключе
// (ровно один раз) и автоподстановку текста в узлы с attrs.tr через tickI18n.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/i18n_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, touchRegistry } from '../../src/highlevel/core.js';
import { format, pluralIndex, lookup, installI18n, tickI18n } from '../../src/highlevel/i18n.js';

// $.store подменяем простым словарём: i18n пишет язык и читает его при старте.
const store_data = new Map();
const store = {
    set(key, value) { store_data.set(key, value); return store; },
    get(key, fallback) { return store_data.has(key) ? store_data.get(key) : fallback; },
    save() { return true; },
};

ctx.store = store;
const $ = { store };
const i18n = installI18n($);

// --- Чистые функции ---------------------------------------------------------

test('format подставляет {name} и оставляет чужие скобки как есть', () => {
    eq(format('Привет, {name}!', { name: 'Аня' }), 'Привет, Аня!');
    eq(format('{a}+{b}', { a: 1, b: 2 }), '1+2');
    eq(format('{a} {b}', { a: 1 }), '1 {b}');
    eq(format('{n} штук', { n: 0 }), '0 штук');
    eq(format('без параметров'), 'без параметров');
    eq(format(null), '');
});

test('pluralIndex: русские правила 1 / 2-4 / 5+ и 11-14', () => {
    eq(pluralIndex(1, 'ru'), 0);
    eq(pluralIndex(21, 'ru'), 0);
    eq(pluralIndex(101, 'ru'), 0);
    eq(pluralIndex(2, 'ru'), 1);
    eq(pluralIndex(4, 'ru'), 1);
    eq(pluralIndex(22, 'ru'), 1);
    eq(pluralIndex(0, 'ru'), 2);
    eq(pluralIndex(5, 'ru'), 2);
    eq(pluralIndex(11, 'ru'), 2);
    eq(pluralIndex(12, 'ru'), 2);
    eq(pluralIndex(14, 'ru'), 2);
    eq(pluralIndex(25, 'ru'), 2);
    eq(pluralIndex(112, 'ru'), 2);
});

test('pluralIndex: английский и регистр/диалект языка', () => {
    eq(pluralIndex(1, 'en'), 0);
    eq(pluralIndex(2, 'en'), 1);
    eq(pluralIndex(0, 'en'), 1);
    eq(pluralIndex(1, 'en-US'), 0);
    eq(pluralIndex(3, 'RU'), 1);
});

test('lookup ищет по одному словарю и по цепочке', () => {
    eq(lookup({ a: 1 }, 'a'), 1);
    eq(lookup([{ a: 1 }, { a: 2 }], 'a'), 1);
    eq(lookup([{}, { a: 2 }], 'a'), 2);
    eq(lookup({ a: ['x', 'y'] }, 'a')[1], 'y');
    eq(lookup({ a: 1 }, 'b'), undefined);
    eq(lookup(null, 'a'), undefined);
});

// --- Словари, язык, перевод --------------------------------------------------

test('add/lang/tr: словарь, текущий язык, перевод ключа', () => {
    i18n.add('ru', { 'menu.play': 'Играть', 'kills': ['{n} штука', '{n} штуки', '{n} штук'] });
    i18n.add('en', { 'menu.play': 'Play', 'kills': ['{n} item', '{n} items'] });
    eq(i18n.lang(), 'ru');
    eq($.tr('menu.play'), 'Играть');
    eq(i18n.lang('en'), i18n);
    eq($.tr('menu.play'), 'Play');
    i18n.lang('ru');
});

test('пропавший ключ: возвращается ключ/fallback и одно предупреждение', () => {
    const logs = [];
    const saved_log = ctx.log;
    ctx.log = (message) => logs.push(String(message));
    eq($.tr('нет.ключа'), 'нет.ключа');
    eq($.tr('нет.ключа'), 'нет.ключа');
    eq($.tr('нет.ключа', {}, 'запас'), 'запас');
    ctx.log = saved_log;
    eq(logs.filter((m) => m.includes('нет.ключа')).length, 1);
});

test('tr подставляет параметры, plural выбирает форму', () => {
    eq($.tr('kills', { n: 5 }), '5 штука');           // без числа — первая форма
    eq($.i18n.plural('kills', 1), '1 штука');
    eq($.i18n.plural('kills', 3), '3 штуки');
    eq($.i18n.plural('kills', 5), '5 штук');
    eq($.i18n.plural('kills', 11), '11 штук');
    eq($.i18n.plural('kills', 21), '21 штука');
    i18n.lang('en');
    eq($.i18n.plural('kills', 1), '1 item');
    eq($.i18n.plural('kills', 4), '4 items');
    i18n.lang('ru');
});

test('lang/has/langs и сохранение языка в $.store', () => {
    truthy(i18n.has('menu.play'));
    falsy(i18n.has('совсем.нет'));
    eq(i18n.langs().join(','), 'en,ru');
    i18n.lang('en');
    eq(i18n.lang(), 'en');
    eq(store.get('i18n.lang'), 'en');
    i18n.lang('ru');
    eq(store.get('i18n.lang'), 'ru');
});

test('запасной язык: неизвестный текущий падает на fallback', () => {
    i18n.lang('fr');                       // словаря fr нет
    eq(i18n.lang(), 'fr');
    eq($.tr('menu.play'), 'Играть');       // сработал запасной ru
    i18n.lang('ru');
});

// --- Автоподстановка в узлы --------------------------------------------------

test('auto: tickI18n переводит узлы с attrs.tr при смене языка', () => {
    // Узлы здесь — заглушки без Node: реестр об их появлении не знает, поэтому
    // отмечаем его вручную. Настоящий узел делает это в конструкторе, а
    // tickI18n читает срез узлов с attrs.tr из индекса реестра (P2).
    const title = { attrs: { tr: 'menu.play' }, text: 'Текст' };
    ctx.nodes.push(title);
    touchRegistry();
    i18n.lang('ru');
    i18n.auto(true);
    tickI18n();
    eq(title.text, 'Играть');

    i18n.lang('en');
    tickI18n();
    eq(title.text, 'Play');

    // Новый узел подхватывается на следующем кадре.
    const late = { attrs: { tr: 'menu.play' }, text: '' };
    ctx.nodes.push(late);
    touchRegistry();
    tickI18n();
    eq(late.text, 'Play');

    // { tr: { key, n } } — плюральная форма.
    const counter = { attrs: { tr: { key: 'kills', n: 3 } }, text: '' };
    ctx.nodes.push(counter);
    touchRegistry();
    tickI18n();
    eq(counter.text, '3 items');

    i18n.auto(false);
    i18n.lang('ru');
    tickI18n();
    eq(counter.text, '3 items');           // auto выключен — текст не трогаем
});

finish();
