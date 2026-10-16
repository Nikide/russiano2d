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

// --- §17 PERF, §20 ENTITY, §21 picking: контракт без GUI -------------------

test('PERF без движка отдаёт N/A, а не выдуманные числа', () => {
    const $ = createApi();
    const perf = $.devtools.perf();
    eq(perf.rows.length, 25, 'все метрики §17.1 на месте');
    eq(perf.summary.fps, null, 'FPS без движка неизвестен');
    eq(perf.summary.batches, null, 'батчи без движка неизвестны');
    eq(perf.summary.timers, null, 'таймеры неизвестны и на движке — тут N/A');
    truthy(perf.text.summary.indexOf('N/A') >= 0, 'в тексте сводки честное N/A');
    eq(perf.graph.bars.length, 0, 'замеров нет — столбцов нет');
    eq(perf.graph.stats.current, null, 'перцентили без замеров — null');
    truthy(perf.graph.source.length > 0, 'источник графика назван');
});

test('дерево профиля без замеров не придумывает зоны', () => {
    const $ = createApi();
    const tree = $.devtools.tree();
    eq(tree.profiler_on, false, 'профайлер подсистем выключен');
    eq(tree.native_rows, 0, 'нативных зон нет — движка нет');
    truthy(tree.text.left.indexOf('Профайлер') >= 0 || tree.text.left.indexOf('профайлер') >= 0,
           'в тексте сказано, почему метрик нет');
    eq($.devtools.watches().length, 0, 'наблюдений нет');
});

test('вкладки и секции: известные имена принимаются, чужие — нет', () => {
    const $ = createApi();
    eq($.devtools.tabName(), 'perf', 'по умолчанию PERF');
    eq($.devtools.tab('diag'), true, 'diag — известная вкладка');
    eq($.devtools.tabName(), 'diag', 'вкладка переключилась без GUI');
    eq($.devtools.tab('nope'), false, 'чужое имя отклонено');
    eq($.devtools.sectionName(), 'identity', 'по умолчанию Identity');
    eq($.devtools.section('physics'), true, 'physics — известная секция');
    eq($.devtools.section('nope'), false, 'чужое имя секции отклонено');
});

test('поиск, фильтры и копирование работают без GUI', () => {
    const $ = createApi();
    $('<rect>', { id: 'hero', class: 'player', x: 1, y: 2, state: 'idle' });
    $.devtools.search('#hero');
    const list = $.devtools.list();
    eq(list.length, 1, 'поиск селектором нашёл узел');
    eq(list[0].selector, '#hero', 'в списке — селектор узла');
    eq(list[0].state, 'idle', 'state узла виден');
    eq(list[0].active, true, 'узел активен');
    $.devtools.search('');
    eq($.devtools.filter('visible', true), true, 'фильтр включается');
    eq($.devtools.filters().visible, true, 'состояние фильтра видно');

    $.devtools.selectBy('#hero');
    const info = $.devtools.inspect();
    eq(info.found, true, 'инспектор нашёл узел');
    eq(info.sections.identity.rows[0][0], 'selector', 'Identity начинается с селектора');
    eq($.devtools.copySelector(), true, 'Copy selector');
    eq($.devtools.lastCopied().text, '#hero', 'селектор записан как скопированный');
    $.devtools.copyJs();
    eq($.devtools.lastCopied().text, "$('#hero')", 'Copy JS даёт выражение $()');
    eq($.devtools.pickMode(true), true, 'режим Pick entity включается');
    eq($.devtools.pickOn(), true, 'состояние режима видно');
    eq($.devtools.pickMode(false), false, 'и выключается');
    eq($.devtools.picked(), null, 'без клика выбора нет');
});

test('HITCH без движка честно говорит, что захватов нет', () => {
    const $ = createApi();
    const h = $.devtools.hitch();
    eq(h.available, false, 'без движка данных нет');
    eq(h.count, 0, 'захватов нет');
    eq(h.rows.length, 0, 'строк нет');
    eq(h.capture, null, 'выбранного захвата нет');
    truthy(h.text.detail.indexOf('Захватов нет') >= 0, 'честный текст вместо нулей');
    truthy(h.text.threshold.indexOf('N/A') >= 0, 'порог без движка — N/A');
    eq($.devtools.hitchThreshold(25), null, 'порог без движка не выставляется');
    eq($.devtools.hitchThreshold(), null, 'и не читается');
    eq($.devtools.hitchSelect(0), false, 'выбор захвата без движка — false');
    eq($.devtools.hitchClear(), false, 'очистка без движка — false');
});

finish();
