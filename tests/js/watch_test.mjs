// ===========================================================================
// Юнит-тест реактивных запросов $.watch (ROADMAP, фаза 7) — без движка.
//
// Тик вызывается вручную, поэтому тест детерминирован: никаких кадров и
// таймеров, только «состав выборки изменился → пришли события».
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/watch_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { tickWatch } from '../../src/highlevel/watch.js';

test('вход не срабатывает для тех, кто уже подходил при подписке', () => {
    const $ = createApi();
    $.watch.clear();
    const entered = [];
    const w = $.watch('.scout', (n) => entered.push(n.attr('id')));

    $('<rect>', { id: 'a', class: 'scout' });
    tickWatch();
    eq(entered.length, 0, 'первый тик молчит');
    eq(w.size(), 1, 'но узел уже под наблюдением');

    $('<rect>', { id: 'b', class: 'scout' });
    tickWatch();
    eq(entered.join(','), 'b', 'сработал только новый');

    w.stop();
    eq($.watch.count(), 0, 'наблюдение остановлено');
});

test('immediate даёт вход для текущего состава', () => {
    const $ = createApi();
    $.watch.clear();
    const entered = [];
    $('<rect>', { id: 'c', class: 'scout2' });
    $.watch('.scout2', { onEnter: (n) => entered.push(n.attr('id')), immediate: true });
    tickWatch();
    eq(entered.join(','), 'c', 'вход сразу');
    $.watch.clear();
});

test('выход по смене класса и по удалению', () => {
    const $ = createApi();
    $.watch.clear();
    const left = [];
    const w = $.watch('.guard', { onEnter: () => {}, onLeave: (n) => left.push(n.attr('id')) });

    $('<rect>', { id: 'g1', class: 'guard' });
    $('<rect>', { id: 'g2', class: 'guard' });
    tickWatch();
    eq(w.size(), 2, 'двое под наблюдением');

    $('#g1').removeClass('guard');
    tickWatch();
    eq(left.join(','), 'g1', 'выход по смене класса');
    eq(w.size(), 1, 'остался один');

    $('#g2').remove();
    tickWatch();
    eq(left.join(','), 'g1,g2', 'выход по удалению');
    eq(w.size(), 0, 'выборка пуста');
    $.watch.clear();
});

test('пересозданный узел — новое вхождение (сравнение по uid)', () => {
    const $ = createApi();
    $.watch.clear();
    const entered = [];
    const w = $.watch('.coin', (n) => entered.push(n.attr('id')));
    $('<rect>', { id: 'c1', class: 'coin' });
    tickWatch();
    $('#c1').remove();
    tickWatch();
    $('<rect>', { id: 'c1', class: 'coin' });
    tickWatch();
    eq(entered.join(','), 'c1', 'вход нового узла с тем же id');
    eq(w.size(), 1, 'в выборке снова один');
    $.watch.clear();
});

test('$.watch.list и count отражают состояние', () => {
    const $ = createApi();
    $.watch.clear();
    $.watch('.x1', () => {});
    $.watch('.x2', () => {});
    eq($.watch.count(), 2, 'два наблюдения');
    const list = $.watch.list();
    eq(list.length, 2, 'list отдаёт оба');
    truthy(typeof list[0].sel === 'string' && typeof list[0].id === 'number', 'в списке есть sel и id');
    $.watch.clear();
    eq($.watch.count(), 0, 'clear снимает всё');
});

finish();
