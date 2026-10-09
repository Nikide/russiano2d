// ===========================================================================
// Юнит-тест чистой логики SDK-приложения (sdk/lib/model.js, sdk/lib/views.js)
// без движка. Запуск: build/_deps/quickjs-build/qjs tests/js/sdk_app_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import * as m from '../../sdk/lib/model.js';
import * as v from '../../sdk/lib/views.js';

test('escapeHtml экранирует разметку и кавычки', () => {
    eq(m.escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    eq(m.escapeHtml(null), '');
    eq(m.escapeHtml(5), '5');
});

test('пути: нормализация, склейка, абсолютные', () => {
    eq(m.normalizeDir('  demos/  '), 'demos');
    eq(m.normalizeDir('a\\b\\'), 'a/b');
    eq(m.normalizeDir('/'), '/');
    eq(m.joinPath('a/', '/b'), 'a/b');
    eq(m.joinPath('', 'b'), 'b');
    truthy(m.isAbsolutePath('/x'));
    truthy(m.isAbsolutePath('C:\\x'));
    falsy(m.isAbsolutePath('x/y'));
    eq(m.absolutePath('/repo/', 'demos'), '/repo/demos');
    eq(m.absolutePath('/repo', '/abs/p'), '/abs/p');
    eq(m.absolutePath('/repo', '  '), '');
});

test('pushRecent: свежие первыми, без повторов, не больше max', () => {
    eq(m.pushRecent(['a', 'b'], 'b').join(','), 'b,a');
    eq(m.pushRecent(['a', 'b', 'c'], 'd', 3).join(','), 'd,a,b');
    eq(m.pushRecent(null, 'x').join(','), 'x');
});

const ENTRIES = [
    { path: 'assets/hero.character.json', type: 're2dsprite.character', size: 10, tool: 'x' },
    { path: 'assets/a.png', type: 'image', size: 2048 },
    { path: 'ui/Menu.rml', type: 'rmlui.document', size: 5 },
    { path: 'assets/b.png', type: 'image', size: 1 },
];

test('filterAssets: подстрока без регистра и тип', () => {
    eq(m.filterAssets(ENTRIES, 'MENU').length, 1);
    eq(m.filterAssets(ENTRIES, '', 'image').length, 2);
    eq(m.filterAssets(ENTRIES, 'assets', 'image').length, 2);
    eq(m.filterAssets(ENTRIES, 'zzz').length, 0);
    eq(m.filterAssets(ENTRIES, '').length, 4);
    eq(m.filterAssets(null, '').length, 0);
});

test('countTypes считает типы', () => {
    const c = m.countTypes(ENTRIES);
    eq(c.image, 2);
    eq(c['rmlui.document'], 1);
});

test('formatUpdated читает ISO 8601 и не прячет мусор', () => {
    eq(m.formatUpdated('2026-10-08T18:00:00+03:00'), '08.10.2026 18:00 (+03:00)');
    eq(m.formatUpdated('2026-10-08T18:00:00Z'), '08.10.2026 18:00 (UTC)');
    eq(m.formatUpdated('вчера'), 'вчера');
    eq(m.formatUpdated(''), '—');
});

test('findTool ищет по id, потом по entry', () => {
    const tools = [{ id: 'a', entry: 'x' }, { id: 'b', entry: 'a' }];
    eq(m.findTool(tools, 'a').id, 'a');
    eq(m.findTool(tools, 'x').id, 'a');
    eq(m.findTool(tools, 'nope'), null);
});

test('summarize и formatSize', () => {
    const s = m.summarize([{ severity: 'error' }, { severity: 'fatal' }, { severity: 'warning' }, { severity: 'info' }]);
    eq(s.errors, 2); eq(s.warnings, 1); eq(s.infos, 1);
    eq(m.formatSize(512), '512 Б');
    eq(m.formatSize(2048), '2.0 КБ');
    eq(m.formatSize(3 * 1024 * 1024), '3.0 МБ');
    eq(m.dirOf('a/b/c.png'), 'a/b');
    eq(m.dirOf('c.png'), '');
});

test('assetTypeLabel: известные и неизвестные типы', () => {
    eq(m.assetTypeLabel('image'), 'картинка');
    eq(m.assetTypeLabel('xyz'), 'xyz');
});

test('toolCards: невалидная запись остаётся видимой и без кнопки', () => {
    const tools = [
        { id: 'ok', name: 'Ок', description: 'd', last_updated: '2026-10-08T18:00:00Z', entry: 'e', valid: true },
        { id: 'bad', name: 'Плохой <b>', description: 'd', last_updated: 'вчера', entry: 'e', valid: false },
    ];
    const html = v.toolCards(tools, { bad: [{ code: 'SDK_REGISTRY_DATE', message: 'плохая дата' }] });
    truthy(html.includes('Ок'));
    truthy(html.includes('invalid'), 'плохая карточка помечена');
    truthy(html.includes('SDK_REGISTRY_DATE'), 'причина показана');
    truthy(html.includes('Плохой &lt;b&gt;'), 'имя экранировано');
    eq(html.split('<button').length - 1, 1, 'кнопка только у валидной записи');
    truthy(v.toolCards([], {}).includes('Реестр пуст'));
});

test('assetRows: выбранная строка, инструмент, обрезка длинного списка', () => {
    const html = v.assetRows(ENTRIES, 'assets/a.png');
    truthy(html.includes('row sel'), 'выбранная строка');
    truthy(html.includes('» x'), 'инструмент показан («→» нет в шрифте интерфейса, поэтому «»»)');
    const many = [];
    for (let i = 0; i < 350; i++) many.push({ path: 'f' + i + '.png', type: 'image', size: 1 });
    truthy(v.assetRows(many, null).includes('Показано 300 из 350'));
});

test('diagRows: severity, код, экранирование', () => {
    const html = v.diagRows([{ severity: 'warning', code: 'A', asset: 'x<y', message: 'm & n' }]);
    truthy(html.includes('diag-warn'));
    truthy(html.includes('WARNING'));
    truthy(html.includes('x&lt;y'));
    truthy(html.includes('m &amp; n'));
    truthy(v.diagRows([]).includes('Диагностик нет'));
});

test('projectPanel и typeFilters', () => {
    truthy(v.projectPanel(null).includes('Проект не открыт'));
    const p = v.projectPanel({ dir: 'd', title: 'T', width: 640, height: 360, hasMain: true, hasManifest: false });
    truthy(p.includes('640×360'));
    truthy(p.includes('есть'));
    const chips = v.typeFilters({ image: 5, script: 1 }, 'image');
    truthy(chips.includes('chip on'));
    truthy(chips.includes('картинка 5'));
});

finish();
