// ===========================================================================
// Юнит-тест DevTools без GUI (ROADMAP, фаза 8).
//
// Панель — RmlUi-документ, и без графики её не открыть (в юнит-тесте движка
// нет). Здесь проверяется то, что обязано работать всегда: машиночитаемое
// состояние панели (`panel()`), выбор сущности по селектору и селектор для
// копирования. Это же и есть контракт DevTools: факты, а не картинка.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/devtools_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';

test('$.devtools установлен и открывается без GUI честно', () => {
    const $ = createApi();
    truthy(typeof $.devtools === 'function' || typeof $.devtools === 'object', '$.devtools есть');
    truthy(typeof $.devtools.open === 'function', 'open() есть');
    eq($.devtools.isOpen(), false, 'сначала закрыт');
});

test('panel() отдаёт только факты', () => {
    const $ = createApi();
    const p = $.devtools.panel();
    eq(p.open, false, 'закрыта');
    eq(p.rows, 0, 'строк нет');
    truthy(typeof p.entities === 'number', 'entities — число');
    eq(p.selector, null, 'селектор пуст');
});

test('selectBy выбирает сущность и отдаёт селектор для копирования', () => {
    const $ = createApi();
    const node = $('#probe');            // обёртка создаётся ниже — см. шаг 1
    $('<rect>', { id: 'probe', class: 'thing', x: 5, y: 6 });
    const uid = $('#probe').get(0).uid;

    eq($.devtools.selectBy('#probe'), '#probe', 'селектор по id');
    eq($.devtools.panel().selector, '#probe', 'panel() видит выбор');
    eq($.devtools.panel().selected, uid, 'выбран uid узла');

    $('<rect>', { class: 'thing2' });
    eq($.devtools.selectBy('.thing2'), '.thing2', 'без id — по классу');
    eq($.devtools.panel().selected === uid, false, 'выбран уже другой узел');
    eq($.devtools.selectBy('#nope'), null, 'несуществующий селектор — null');
    truthy(node, 'обёртка жива');
});

finish();
