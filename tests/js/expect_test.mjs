// ===========================================================================
// Юнит-тест $.expect(...) — утверждения в понятиях мира (ROADMAP, фаза 6).
//
// Проверяется без движка: createApi() поднимает $, узлы создаются в общем
// реестре, а утверждения идут через $.test.* — тот же счётчик, что у движка.
// Здесь важно, что провал приходит не только текстом, но и структурной
// деталью (subject/expected/actual): падающий тест обязан оставлять
// разбираемый артефакт, а не «FAIL где-то там».
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/expect_test.mjs
// ===========================================================================

import { test, eq, truthy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';

test('$.expect установлен и вызывается', () => {
    const $ = createApi();
    truthy(typeof $.expect === 'function', '$.expect — функция');
});

test('утверждения проходят на живом узле', () => {
    const $ = createApi();
    $.test.reset();
    $('<rect>', { id: 'probe', x: 10, y: 20, w: 4, h: 4, hp: 7 });
    $('#probe').attr('state', 'idle');

    truthy($.expect('#probe').exists(), 'существует');
    truthy($.expect('#probe').count(1), 'один узел');
    truthy($.expect('#probe').hp(7), 'hp = 7');
    truthy($.expect('#probe').prop('x', 10), 'x = 10');
    truthy($.expect('#probe').state('idle'), 'state = idle');
    truthy($.expect('#probe').positionNear(10, 20, 0.01), 'позиция (10, 20)');
    eq($.test.results().failed, 0, 'провалов нет');
    eq($.test.results().total, 6, 'шесть проверок посчитаны');
});

test('провал даёт структурную деталь, а не только текст', () => {
    const $ = createApi();
    $.test.reset();
    $('<rect>', { id: 'probe2', x: 1, y: 2 });

    eq($.expect('#probe2').count(3), false, 'count(3) на одном узле — провал');
    eq($.expect('#probe2').prop('x', 99), false, 'x = 99 — провал');

    const r = $.test.results();
    eq(r.failed, 2, 'два провала');
    eq(r.details.length, 2, 'две детали');
    eq(r.details[0].subject, '#probe2', 'субъект в детали');
    eq(r.details[0].expected, 3, 'ожидание в детали');
    eq(r.details[0].actual, 1, 'факт в детали');
    eq(r.details[1].prop, 'x', 'имя свойства в детали');
    truthy(r.failures.length === 2 && typeof r.failures[0] === 'string', 'строки провалов сохранены');
});

test('пустая выборка не бросает, а падает проверкой', () => {
    const $ = createApi();
    $.test.reset();
    eq($.expect('#nope').exists(), false, 'exists() → false');
    eq($.expect('#nope').hp(1), false, 'hp() без узла → false');
    eq($.expect('#nope').state('x'), false, 'state() без узла → false');
    eq($.test.results().failed, 3, 'три провала, исключений нет');
});

test('обёртка, узел и массив узлов принимаются как субъект', () => {
    const $ = createApi();
    $.test.reset();
    const node = $('<rect>', { id: 'probe3' });
    truthy($.expect($('#probe3')).exists(), 'обёртка');
    truthy($.expect(node).exists(), 'узел');
    truthy($.expect('#probe3').exists(), 'селектор');
    eq($.test.results().failed, 0, 'провалов нет');
});

finish();
