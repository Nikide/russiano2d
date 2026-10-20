// ===========================================================================
// Чтение журнала `$.trace`: категории, filter/read и export.
//
// Это расширение существующего кольца (api.js), не новая подсистема. Проверяем
// чистые части без движка:
//
//   * kind → category: combat/contact/audio/input/scene/signal/devtools/other,
//     включая подсемейства `signal:<имя>`, `sensor:*`, `devtools:*`;
//   * filter: category/kind/from/to/since/limit, порядок старый→новый,
//     limit — ПОСЛЕДНИЕ N; неизвестная категория — пусто и одна диагностика;
//   * selector — через `$`: source/target и стабильные id в data;
//   * export: json ровно {kind,frame,source,target,data}, text —
//     'frame <frame> <#id|nid|-> <kind> <payload>', без записи файлов;
//   * wiring в createApi: note → filter/read/categories/export, clear —
//     пустые результаты, как и opt-in журнал по умолчанию.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/trace_filter_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import {
    traceCategoryOf, filterTraceEntries, formatTraceEntries,
} from '../../src/highlevel/api.js';
import { ctx, Node, touchRegistry } from '../../src/highlevel/core.js';

// Node.destroy() шлёт 'remove' через ctx.$; в тесте глобальные подписки не нужны.
ctx.$ = { _dispatchGlobal() {} };

function clearWorld() {
    for (const node of ctx.nodes.slice()) node.destroy();
    ctx.nodes.length = 0;
    ctx.byId.clear();
    ctx.byBody.clear();
    touchRegistry();
}

function entry(n, kind, frame, source, target, data) {
    return {
        n, kind, frame,
        source: source === undefined ? null : source,
        target: target === undefined ? null : target,
        data: data === undefined ? null : data,
    };
}

// Журнал для чистых проверок: пять записей, frame 10..50, n 1..5.
const LIST = [
    entry(1, 'attack', 10, 'n1', 'n2', { attack: 1, weapon: 'ak' }),
    entry(2, 'collide', 20, 'n1', 'n3', { sensor: false }),
    entry(3, 'audio', 30, 'n2', null, { action: 'play', name: 'hit' }),
    entry(4, 'input', 40, null, null, { action: 'press', code: 32 }),
    entry(5, 'signal:door', 50, 'n4', null, { action: 'open' }),
];

test('traceCategoryOf: существующие виды → категории, неизвестные → other', () => {
    eq(traceCategoryOf('attack'), 'combat');
    eq(traceCategoryOf('damage'), 'combat');
    eq(traceCategoryOf('death'), 'combat');
    eq(traceCategoryOf('hit'), 'combat');
    eq(traceCategoryOf('combat:filter'), 'combat');
    eq(traceCategoryOf('collide'), 'contact');
    eq(traceCategoryOf('separate'), 'contact');
    eq(traceCategoryOf('stay'), 'contact');
    eq(traceCategoryOf('sensor:enter'), 'contact');
    eq(traceCategoryOf('audio'), 'audio');
    eq(traceCategoryOf('input'), 'input');
    eq(traceCategoryOf('scene'), 'scene');
    eq(traceCategoryOf('signal:door'), 'signal');
    eq(traceCategoryOf('devtools:edit'), 'devtools');
    eq(traceCategoryOf('weapon.fire'), 'other', 'вид игры не теряется');
    eq(traceCategoryOf(undefined), 'other');
});

test('filter: category и точный kind', () => {
    eq(filterTraceEntries(LIST, { category: 'combat' }).map((e) => e.n).join(','), '1');
    eq(filterTraceEntries(LIST, { category: 'contact' }).map((e) => e.n).join(','), '2');
    eq(filterTraceEntries(LIST, { category: 'signal' }).map((e) => e.n).join(','), '5');
    eq(filterTraceEntries(LIST, { kind: 'audio' }).map((e) => e.n).join(','), '3');
    eq(filterTraceEntries(LIST, { kind: 'attack' }).map((e) => e.n).join(','), '1');
    eq(filterTraceEntries(LIST, { kind: 'signal:door' }).map((e) => e.n).join(','), '5');
    eq(filterTraceEntries(LIST, {}).length, 5, 'без opts — весь журнал');
});

test('filter: from/to — кадры включительно', () => {
    eq(filterTraceEntries(LIST, { from: 20 }).map((e) => e.n).join(','), '2,3,4,5');
    eq(filterTraceEntries(LIST, { to: 20 }).map((e) => e.n).join(','), '1,2');
    eq(filterTraceEntries(LIST, { from: 20, to: 40 }).map((e) => e.n).join(','), '2,3,4');
    eq(filterTraceEntries(LIST, { from: 20, to: 20 }).map((e) => e.n).join(','), '2');
    eq(filterTraceEntries(LIST, { from: 999 }).length, 0);
});

test('filter: since — строго после n (курсор агента)', () => {
    eq(filterTraceEntries(LIST, { since: 3 }).map((e) => e.n).join(','), '4,5');
    eq(filterTraceEntries(LIST, { since: 5 }).length, 0);
    eq(filterTraceEntries(LIST, { since: 0 }).length, 5);
});

test('filter: limit — ПОСЛЕДНИЕ N, порядок старый→новый; мусор — пусто', () => {
    eq(filterTraceEntries(LIST, { limit: 2 }).map((e) => e.n).join(','), '4,5');
    eq(filterTraceEntries(LIST, { limit: 99 }).length, 5);
    eq(filterTraceEntries(LIST, { limit: 0 }).length, 0);
    eq(filterTraceEntries(LIST, { limit: -1 }).length, 0);
    eq(filterTraceEntries(LIST, { limit: NaN }).length, 0);
    // Фильтр применяется ДО лимита: последние 2 из combat/contact.
    eq(filterTraceEntries(LIST, { category: 'contact', limit: 1 }).map((e) => e.n).join(','), '2');
});

test('filter: неизвестная категория — пусто и одна диагностика', () => {
    const logs = [];
    const saved = ctx.log;
    ctx.log = (msg) => logs.push(String(msg));
    try {
        eq(filterTraceEntries(LIST, { category: 'нет-такой' }).length, 0);
        eq(filterTraceEntries(LIST, { category: 'нет-такой' }).length, 0);
        eq(logs.filter((m) => m.indexOf('неизвестная категория') >= 0).length, 1,
           'повтор не заливает журнал');
    } finally {
        ctx.log = saved;
    }
});

test('filter: selector через $ — source/target и id в data', () => {
    clearWorld();
    const hero = new Node('rect', { id: 'hero' });
    const enemy = new Node('rect', { id: 'enemy' });
    const list = [
        entry(1, 'attack', 10, hero.nid, enemy.nid, { attack: 1 }),
        entry(2, 'audio', 20, enemy.nid, null, { action: 'play' }),
        entry(3, 'scene', 30, null, null, { node: hero.nid }),
        entry(4, 'input', 40, null, null, { code: 32 }),
    ];
    eq(filterTraceEntries(list, { selector: '#hero' }).map((e) => e.n).join(','), '1,3',
       'source и data.node');
    eq(filterTraceEntries(list, { selector: '#enemy' }).map((e) => e.n).join(','), '1,2',
       'target и source');
    eq(filterTraceEntries(list, { selector: '#нет' }).length, 0, 'пустой селектор — пусто');
    // Селектор и категория складываются.
    eq(filterTraceEntries(list, { selector: '#enemy', category: 'audio' }).map((e) => e.n).join(','), '2');
});

test('export json: ровно {kind,frame,source,target,data}, таблица строкой', () => {
    const json = formatTraceEntries(LIST, { format: 'json' });
    const rows = JSON.parse(json);
    eq(rows.length, 5);
    eq(Object.keys(rows[0]).join(','), 'kind,frame,source,target,data');
    eq(rows[0].kind, 'attack');
    eq(rows[0].frame, 10);
    eq(rows[0].source, 'n1');
    eq(rows[0].target, 'n2');
    eq(rows[0].data.weapon, 'ak');
    eq(formatTraceEntries([], {}), '[]', 'пустой журнал — пустой JSON-массив');
});

test('export text: frame <frame> <label> <kind> <payload>, без файлов', () => {
    const text = formatTraceEntries(LIST, { format: 'text' }, (nid) => '#' + nid);
    const lines = text.split('\n');
    eq(lines.length, 5);
    eq(lines[0], 'frame 10 #n1 attack ak', 'payload — name/weapon/action, иначе JSON');
    eq(lines[2], 'frame 30 #n2 audio hit');
    eq(lines[3], 'frame 40 - input press', 'без source/target — прочерк');
    eq(formatTraceEntries([], { format: 'text' }), '');
    eq(formatTraceEntries([LIST[3]], { format: 'text' }), 'frame 40 - input press');
});

test('createApi: note → filter/read/categories/export; clear — всё пусто', () => {
    const $ = createApi();
    clearWorld();
    $.trace.clear();
    $.trace.on(true);

    const probe = $('<rect>', { id: 'probe' });
    $.trace.note('audio', probe.get(0), { action: 'play', name: 'hit' });
    $.trace.note('attack', null, { attack: 7, weapon: 'ak' });
    $.trace.note('weapon.fire', probe.get(0), { weapon: 'ak' });

    eq($.trace.categories().join(','), 'audio,combat,other', 'present, по алфавиту');
    eq($.trace.filter({ category: 'combat' }).length, 1);
    eq($.trace.filter({ kind: 'weapon.fire' }).length, 1);
    eq($.trace.read({ selector: '#probe' }).length, 2, 'audio + weapon.fire');
    eq($.trace.read({ selector: '#probe', limit: 1 }).length, 1);
    eq($.trace.export({ format: 'json' }), JSON.stringify(
        $.trace.filter({}).map((e) => ({
            kind: e.kind, frame: e.frame, source: e.source, target: e.target, data: e.data,
        }))), 'export json = фильтр без полей n');
    truthy($.trace.export({ format: 'text' }).split('\n')[0].indexOf('frame ') === 0);

    $.trace.on(false);
    $.trace.clear();
    eq($.trace.filter({}).length, 0, 'clear() — пусто');
    eq($.trace.read({}).length, 0);
    eq($.trace.categories().length, 0);
    eq($.trace.export({}), '[]');
    eq($.trace.export({ format: 'text' }), '');
});

finish();
