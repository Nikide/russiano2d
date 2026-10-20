// ===========================================================================
// $.debug.resources()/budget(): бюджеты ресурсов из существующих источников.
//
// Проверяется главное обещание: числа берутся только из того, что движок уже
// отдаёт, а где байтов нет — basis 'unknown' и bytes: null, а не выдумка.
// Плюс: топ по убыванию, пик между замерами, предупреждение о бюджете — один
// раз на ключ/вид, сброс при возврате в бюджет.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/resources_test.mjs
// ===========================================================================

import './_harness.mjs';
import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { engine } from '../../src/highlevel/native.js';

engine.frame = 10;
engine.bodyCount = () => 4;
engine.nodes = { memory: () => ({ bytes: 123456, used: 120000, objects: 7, arrays: 3, strings: 9, atoms: 5 }) };
engine.fontList = () => ['Open Sans', 'Mono'];
engine.fontStats = () => ({ glyphs: 42, atlas_w: 512, atlas_h: 256, drawn: 100 });
engine.audio = { count: () => 3, channelCount: () => 16, activeChannels: () => 2 };
engine.limits = () => ({ textures: 2, textures_max: 256, bodies: 4, bodies_max: 1024,
                          joints: 0, joints_max: 256, documents_max: 64 });
const textures = [];
engine.textureList = () => textures.slice();

const $ = createApi();
$('<rect>', { id: 'n1' });
$('<rect>', { id: 'n2' });
$('<player>', { id: 'p1' });

// Предупреждения пишем в массив: тест проверяет структуру, а не stderr.
const reports = [];
$.debug.reportError = (where, error, opts) => {
    reports.push({ where, message: error && error.message ? error.message : String(error), opts });
    return error;
};

function clearBudgets() {
    const b = $.debug.budget();
    const patch = {};
    for (const key of Object.keys(b.budgets)) patch[key] = null;
    $.debug.budget(patch);
}

test('resources(): честные basis для каждого источника', () => {
    textures.length = 0;
    textures.push({ id: 1, path: 'a.png', w: 100, h: 50, users: 2, bytes: 100 * 50 * 4 });
    textures.push({ id: 2, path: 'b.png', w: 10, h: 10, users: 1, bytes: 400 });
    const r = $.debug.resources();
    eq(r.ok, true, 'замер удался');
    const by = {};
    for (const item of r.items) by[item.key] = item;

    eq(by.textures.count, 2, 'текстур 2');
    eq(by.textures.bytes, 20000 + 400, 'байты суммированы');
    eq(by.textures.basis, 'cpu-side-only', 'GPU не измерен — CPU-оценка');
    eq(by.textures.limit, 256, 'потолок из engine.limits()');
    truthy(by.textures.biggest && by.textures.biggest.name === 'a.png', 'крупнейшая — a.png');
    eq(by.textures.top.length, 2, 'топ отдан');
    eq(by.textures.peak.bytes, 20400, 'пик записан');

    eq(by.audio.count, 3, 'звуков 3 (engine.audio.count)');
    eq(by.audio.bytes, null, 'байтов звука нет');
    eq(by.audio.basis, 'unknown', 'звук — unknown');
    eq(by.audio.limit, 16, 'потолок каналов');
    eq(by.audio.extra.active, 2, 'активных каналов 2');

    eq(by.fonts.count, 2, 'шрифтов 2');
    eq(by.fonts.bytes, 512 * 256 * 4, 'байты атласа = w×h×4');
    eq(by.fonts.basis, 'estimated', 'атлас — оценка');
    eq(by.fonts.extra.glyphs, 42, 'глифы из fontStats');

    eq(by.ui.count, null, 'живых RmlUi-документов JS не видит');
    eq(by.ui.bytes, null, 'байтов UI нет');
    eq(by.ui.basis, 'unknown', 'UI — unknown');
    eq(by.ui.limit, 64, 'потолок документов');

    eq(by.entities.count, $.debug.counters().nodes, 'узлы — из counters');
    eq(by.entities.basis, 'exact', 'узлы точны');
    eq(by.physics.count, $.debug.counters().bodies, 'тела — из counters');
    eq(by.physics.limit, 1024, 'лимит тел');
    eq(by.particles.basis, 'exact', 'частицы точны');
    eq(by.assets.basis, 'unknown', 'кэш ассетов не считает байты');
    eq(by.js_heap.bytes, 123456, 'JS-куча — точные байты');
    eq(by.js_heap.basis, 'exact', 'JS-куча exact');
    truthy(r.text.indexOf('[unknown]') >= 0, 'текст помечает unknown');
});

test('resources(): топ по убыванию байтов и лимит top', () => {
    textures.length = 0;
    for (let i = 1; i <= 7; i++) {
        textures.push({ id: i, path: 't' + i + '.png', w: i * 10, h: i * 10, users: 1, bytes: i * 1000 });
    }
    const item = $.debug.resources().items.find((x) => x.key === 'textures');
    eq(item.top.length, 5, 'top N = 5');
    eq(item.top[0].name, 't7.png', 'крупнейшая первой');
    for (let i = 1; i < item.top.length; i++) {
        truthy(item.top[i - 1].bytes >= item.top[i].bytes, 'порядок по убыванию');
    }
    const one = $.debug.resources({ top: 1 }).items.find((x) => x.key === 'textures');
    eq(one.top.length, 1, 'top: 1 уважается');
});

test('resources(): пик не теряется на уменьшении; reset сбрасывает', () => {
    $.debug.resourcesResetPeaks();
    textures.length = 0;
    textures.push({ id: 1, path: 'small.png', w: 1, h: 1, users: 1, bytes: 4 });
    let item = $.debug.resources().items.find((x) => x.key === 'textures');
    eq(item.peak.bytes, 4, 'первый пик');

    textures.length = 0;
    textures.push({ id: 2, path: 'big.png', w: 100, h: 100, users: 1, bytes: 40000 });
    item = $.debug.resources().items.find((x) => x.key === 'textures');
    eq(item.peak.bytes, 40000, 'пик вырос');

    textures.length = 0;
    textures.push({ id: 3, path: 'tiny.png', w: 2, h: 2, users: 1, bytes: 16 });
    item = $.debug.resources().items.find((x) => x.key === 'textures');
    eq(item.bytes, 16, 'текущее значение уменьшилось');
    eq(item.peak.bytes, 40000, 'пик остался максимальным');

    $.debug.resourcesResetPeaks();
    item = $.debug.resources().items.find((x) => x.key === 'textures');
    eq(item.peak.bytes, 16, 'после reset пик — текущее');
});

test('budget(): превышение => одно предупреждение на ключ/вид', () => {
    clearBudgets();
    reports.length = 0;
    textures.length = 0;
    textures.push({ id: 1, path: 'big.png', w: 100, h: 100, users: 1, bytes: 40000 });

    const set = $.debug.budget({ textures: { bytes: 1000 } });
    eq(set.ok, true, 'бюджет выставлен');
    eq(set.budgets.textures.bytes, 1000, 'значение сохранено');

    let r = $.debug.resources();
    eq(r.warnings.length, 1, 'первое превышение замечено');
    eq(r.warnings[0].kind, 'bytes', 'вид — bytes');
    eq(reports.length, 1, 'через $.debug.reportError');
    eq(reports[0].opts.code, 'R2D_RESOURCE_BUDGET', 'стабильный код');
    eq(reports[0].opts.data.actual, 40000, 'фактическое значение в данных');

    r = $.debug.resources();
    eq(r.warnings.length, 0, 'повторно не предупреждает');
    eq(reports.length, 1, 'и в журнал не дублирует');

    // Вошли в бюджет — флаг снят; новое превышение снова даёт одно сообщение.
    textures.length = 0;
    textures.push({ id: 1, path: 'ok.png', w: 1, h: 1, users: 1, bytes: 4 });
    $.debug.resources();
    textures.length = 0;
    textures.push({ id: 1, path: 'big2.png', w: 100, h: 100, users: 1, bytes: 40000 });
    r = $.debug.resources();
    eq(r.warnings.length, 1, 'после возврата в бюджет предупреждение снова одно');
    eq(reports.length, 2, 'всего два структурных сообщения');
});

test('budget(): счётчик и байты независимы; null снимает', () => {
    clearBudgets();
    reports.length = 0;
    const set = $.debug.budget({ entities: { count: 1 }, textures: { count: 0, bytes: 100 } });
    eq(set.ok, true, 'оба бюджета');
    const r = $.debug.resources();
    const keys = r.warnings.map((w) => w.key + ':' + w.kind).sort();
    truthy(keys.indexOf('entities:count') >= 0, 'счётчик узлов превышен');
    truthy(keys.indexOf('textures:count') >= 0, 'счётчик текстур превышен');
    truthy(keys.indexOf('textures:bytes') >= 0, 'байты текстур превышены');

    const off = $.debug.budget({ textures: null });
    eq(off.ok, true, 'снятие бюджета');
    eq(off.budgets.textures, undefined, 'бюджета текстур больше нет');
});

test('budget(): мусор отклоняется, а не превращается в ноль', () => {
    const bad = $.debug.budget({ nope: 5 });
    eq(bad.ok, false, 'неизвестный ключ');
    truthy(bad.unknown.indexOf('nope') >= 0, 'ключ назван');
    const neg = $.debug.budget({ textures: { bytes: -1 } });
    eq(neg.ok, false, 'отрицательный бюджет отклонён');
    truthy(neg.invalid.indexOf('textures') >= 0, 'поле названо');
    const junk = $.debug.budget('нет');
    eq(junk.ok, false, 'не объект отклонён');
    const empty = $.debug.budget();
    eq(empty.ok, true, 'чтение бюджета');
    truthy(Array.isArray(empty.keys) && empty.keys.indexOf('textures') >= 0, 'ключи перечислены');
});

test('MEM: $.devtools.memory() отдаёт ту же таблицу ресурсов', () => {
    textures.length = 0;
    textures.push({ id: 1, path: 'mem.png', w: 10, h: 10, users: 1, bytes: 400 });
    const mem = $.devtools.memory();
    truthy(mem.resources && Array.isArray(mem.resources.items), 'resources в memory()');
    const tex = mem.resources.items.find((x) => x.key === 'textures');
    eq(tex.count, 1, 'тот же счётчик текстур');
    truthy(typeof mem.text.resources === 'string' && mem.text.resources.indexOf('текстуры') >= 0,
           'текст MEM называет текстуры');
  });

test('resources(): без источников не выдумывает байты', () => {
    clearBudgets();
    textures.length = 0;
    engine.textureList = () => 0;             // мок без метода — не массив
    engine.fontList = () => 0;
    engine.fontStats = () => 0;
    const r = $.debug.resources();
    const tex = r.items.find((x) => x.key === 'textures');
    eq(tex.count, null, 'нет источника — count null, а не выдуманный 0');
    eq(tex.bytes, null, 'байты null, а не 0 «на всякий случай»');
    eq(tex.basis, 'unknown', 'нет источника — unknown');
    const fonts = r.items.find((x) => x.key === 'fonts');
    eq(fonts.count, null, 'шрифты: источника нет — count null');
    eq(fonts.basis, 'unknown', 'шрифты без статистики — unknown');
    eq(fonts.bytes, null, 'байтов нет');
});

finish();
