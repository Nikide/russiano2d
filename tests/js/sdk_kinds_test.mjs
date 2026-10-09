// Чистая логика студий данных: sdk/lib/kit.js и sdk/lib/kinds/*.js. Запуск: qjs -m tests/js/sdk_kinds_test.mjs
import { KINDS, kindForPath } from '../../sdk/lib/kinds/index.js';
import * as K from '../../sdk/lib/kit.js';
import * as TM from '../../sdk/lib/kinds/tilemap.js';
import * as PT from '../../sdk/lib/kinds/particles.js';
import * as CO from '../../sdk/lib/kinds/collision.js';
import * as FO from '../../sdk/lib/kinds/fonts.js';
import * as AU from '../../sdk/lib/kinds/audio.js';
import * as IN from '../../sdk/lib/kinds/input.js';
import * as LA from '../../sdk/lib/kinds/layers.js';
import * as views from '../../sdk/lib/views.js';

let fails = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const codes = (d) => d.map((x) => x.severity + ':' + x.code).sort();

// --- Общее: форматы и сопоставление по имени файла -------------------------------------------------------------
check(Object.keys(KINDS).length === 7, 'семь форматов студий данных');
check(kindForPath('a/b/level.tilemap.json') === TM && kindForPath('x.PARTICLES.JSON') === PT && kindForPath('x.json') === null, 'kindForPath по суффиксу без учёта регистра');
for (const id of Object.keys(KINDS)) {
    const k = KINDS[id];
    const d = k.create();
    check(k.validate(d).every((x) => x.severity !== 'error'), id + ': create() не содержит ошибок');
    check(JSON.stringify(k.validate(JSON.parse(JSON.stringify(d)))) === JSON.stringify(k.validate(d)), id + ': проверка не зависит от identity объекта');
    check(typeof k.summary(d) === 'string' && k.snippet('x' + k.SUFFIX).includes('x' + k.SUFFIX), id + ': summary и snippet');
    check(codes(k.validate([])).join() === 'error:' + k.PREFIX + '_ROOT', id + ': корень-массив — ROOT');
    check(codes(k.validate({})).includes('error:' + k.PREFIX + '_VERSION'), id + ': без version — VERSION');
}

// --- kit: цвета, числа, канонический JSON ---------------------------------------------------------------------
check(['#fff', '#ffffff80', 'rgba(1,2,3,0.5)', 'rgb(1, 2, 3)', 'Red', 'transparent'].every(K.colorOk) && !['#ff', '#gggggg', 'x', '', 5, 'rgba(1,2)'].some(K.colorOk), 'colorOk: допустимые и недопустимые цвета');
check(K.colorNormalize('#F0A') === '#ff00aa' && K.colorNormalize('red') === 'red', 'colorNormalize');
check(K.parseNum(' 1,5 ') === 1.5 && K.parseNum('') === null && Number.isNaN(K.parseNum('abc')) && K.parseNum('-.5') === -0.5, 'parseNum: запятая, пусто, мусор');
check(JSON.stringify(K.parseRange('1', '2')) === '[1,2]' && K.parseRange('5', '') === 5 && K.parseRange('3', '1')[0] === 1 && K.parseRange('', '') === null && Number.isNaN(K.parseRange('a', '1')), 'parseRange');
const canon = K.canonicalJson({ version: 1, layers: [{ name: 'a', data: [[1, 2], [3, 4]] }], k: [1, 2, 3], o: {} });
check(canon.includes('"k": [1, 2, 3]') && canon.includes('[1, 2],') && JSON.parse(canon).layers[0].data[1][1] === 4 && canon.endsWith('\n'), 'канонический JSON: массивы скаляров в строку, валидный JSON');
check(K.canonicalJson(JSON.parse(canon)) === canon, 'канонический JSON идемпотентен (git diff стабилен)');

// --- tilemap ---------------------------------------------------------------------------------------------------------------
const tm = TM.create({ w: 5, h: 4, tile: 16, src: 'a.png' });
check(TM.size(tm.layers[0]).w === 5 && TM.size(tm.layers[0]).h === 4, 'tilemap: размер слоя');
const L0 = tm.layers[0];
check(TM.setTile(L0, 1, 1, 7) === true && TM.setTile(L0, 1, 1, 7) === false && TM.setTile(L0, 99, 1, 7) === false, 'setTile: изменение, то же значение, вне карты');
let thrown = false; try { TM.setTile(L0, 0, 0, -1); } catch (e) { thrown = true; }
check(thrown, 'setTile: id вне диапазона отвергается');
check(TM.fillRect(L0, 0, 0, 4, 0, 2) === 5 && L0.data[0].every((v) => v === 2), 'fillRect: строка целиком');
check(TM.floodFill(L0, 2, 3, 9) === 5 * 4 - 5 - 1 && L0.data[1][1] === 7 || TM.floodFill(L0, 2, 3, 9) === 0, 'floodFill: связная область (7 и 2 — барьеры)');
const tm2 = TM.create({ w: 3, h: 3 });
TM.fillRect(tm2.layers[0], 0, 0, 2, 2, 1);
TM.setTile(tm2.layers[0], 1, 1, 0);
check(TM.floodFill(tm2.layers[0], 1, 1, 5) === 1, 'floodFill: одна дырка внутри рамки');
TM.resize(L0, 7, 2);
check(TM.size(L0).w === 7 && TM.size(L0).h === 2 && L0.data[0][4] === 2, 'resize: данные сохраняются, края достраиваются нулями');
check((() => { try { TM.resize(L0, 0, 5); } catch (e) { return true; } return false; })(), 'resize: ноль отвергается');
const idx = TM.addLayer(tm, 'deco');
check(idx === 1 && tm.layers[1].depth > tm.layers[0].depth, 'addLayer: новый слой выше по depth');
TM.moveLayer(tm, 1, 0);
check(tm.layers[0].name === 'deco', 'moveLayer');
TM.removeLayer(tm, 0);
check((() => { try { TM.removeLayer(tm, 0); } catch (e) { return true; } return false; })(), 'removeLayer: последний слой не удаляется');
check(TM.tilesetCapacity({ tile: 16, cols: 16 }, 256, 144) === 144 && TM.maxUsedId(tm2) === 5, 'tilesetCapacity и maxUsedId');
const bad = TM.create(); bad.layers[0].data[0][0] = 1.5; bad.layers[0].data[1] = [1]; bad.tile = 0;
check(codes(TM.validate(bad)).includes('error:SDK_TILEMAP_SHAPE') && codes(TM.validate(bad)).includes('error:SDK_TILEMAP_FIELD'), 'tilemap: неровные строки и tile=0');

// --- particles -----------------------------------------------------------------------------------------------------------------
check(PT.stopValue({ t: 0, value: 0.5 }, 'alpha') === 0.5 && PT.stopValue({ t: 0, alpha: 0.2 }, 'alpha') === 0.2 && PT.stopValue({ t: 0, color: 'red', value: 'blue' }, 'color') === 'red', 'stopValue: как читает рантайм');
check(PT.rampText([{ t: 0, color: '#fff' }, { t: 1, color: '#f00' }], 'color') === '0:#fff 1:#f00', 'rampText');
check(JSON.stringify(PT.parseRampText('0:1 0.5:0.3', 'alpha')) === '[{"t":0,"alpha":1},{"t":0.5,"alpha":0.3}]' && PT.parseRampText('x', 'alpha') === null && PT.parseRampText('0:a', 'alpha') === null, 'parseRampText');
check(codes(PT.validate({ version: 1, color_ramp: [{ t: 0.5, color: '#fff' }, { t: 0.2, color: '#fff' }] })).join() === 'error:SDK_PARTICLES_RAMP', 'рампа должна идти по возрастанию t');
check(codes(PT.validate({ version: 1, lifetime: [900, 400] })).join() === 'error:SDK_PARTICLES_RANGE', 'диапазон min ≤ max');
check(codes(PT.validate({ version: 1, wibble: 1 })).join() === 'warning:SDK_PARTICLES_UNKNOWN_FIELD', 'неизвестное поле — предупреждение (уйдёт в attrs)');
check(!('name' in PT.emitterOpts({ version: 1, name: 'x', amount: 3 })) && PT.emitterOpts({ version: 1, name: 'x', amount: 3 }).amount === 3, 'emitterOpts убирает служебные version и name');

// --- collision --------------------------------------------------------------------------------------------------------------------
check(CO.isConvex([0, 0, 10, 0, 10, 10, 0, 10]) && !CO.isConvex([0, 0, 10, 0, 5, 2, 10, 10, 0, 10]), 'isConvex: квадрат — да, «стрела» — нет');
check(codes(CO.validate({ version: 1, shapes: [{ shape: 'polygon', x: 0, y: 0, points: [0, 0, 10, 0, 5, 2, 10, 10, 0, 10] }] })).join() === 'warning:SDK_COLLISION_POLYGON_CONCAVE', 'невыпуклый полигон — предупреждение');
check(CO.hit({ shape: 'box', x: 10, y: 10, w: 4, h: 4 }, 11, 9) && !CO.hit({ shape: 'circle', x: 0, y: 0, radius: 2 }, 5, 5) && CO.bounds({ shape: 'capsule', x: 0, y: 0, radius: 2, h: 10 }).y1 === 5, 'hit и bounds');
const calls = [];
const node = new Proxy({}, { get: (_, k) => (...a) => { calls.push([k, ...a]); return node; } });
CO.applyShape(node, { shape: 'capsule', x: 0, y: 0, radius: 5, h: 20, oneWay: true, sensor: true, layerBits: 2, mask: 3 });
check(calls.map((c) => c[0]).join() === 'size,shape,oneWay,sensor,layerBits,mask' && calls[1][2] === 5, 'applyShape: порядок вызовов $ и радиус капсулы');

// --- fonts / audio / input / layers -------------------------------------------------------------------------------------------
const fo = FO.create();
check(FO.resolve(fo.styles, 'title').size === 40 && FO.resolve(fo.styles, 'title').align === 'left' && FO.resolve(fo.styles, 'hud').color === '#ffffff', 'fonts.resolve: default → base → стиль');
check(JSON.stringify(FO.chain({ a: { base: 'b' }, b: { base: 'a' } }, 'a')) === '["a","b"]', 'fonts.chain обрывает цикл');
check(codes(FO.validate({ version: 1, styles: { a: { base: 'b' }, b: { base: 'a' } } })).filter((c) => c.endsWith('CYCLE')).length === 2, 'цикл наследования найден у обоих стилей');
const au = AU.create();
check(Math.abs(AU.gain(au.buses, 'ui') - 0.5) < 1e-9 && AU.gain(au.buses, 'нет') === 1, 'audio.gain: произведение по цепочке родителей');
check(codes(AU.validate({ version: 1, buses: { a: { parent: 'b' }, b: { parent: 'a' } } })).filter((c) => c.endsWith('CYCLE')).length === 2, 'цикл родителей шин');
check(IN.keyKnown('Space') && IN.keyKnown('F12') && IN.keyKnown('gamepad.a') && !IN.keyKnown('F25') && !IN.keyKnown('щ'), 'input.keyKnown');
check(codes(IN.validate({ version: 1, actions: { a: ['w'], b: ['W'] } })).join() === 'warning:SDK_INPUT_CONFLICT', 'одна клавиша у двух действий — предупреждение');
const la = LA.create();
check(LA.newLayer(la) === 2 && la.layers[2].order > la.layers[1].order, 'layers.newLayer: порядок выше последнего');

// --- views: каталог по категориям, шаблоны, движки ---------------------------------------------------------------------------------------
const tools = [
    { id: 'a', name: 'A', description: 'x', entry: 'a', last_updated: '2026-10-09T12:00:00+03:00', category: 'classic-2d', valid: true, assets: ['*.x'] },
    { id: 'b', name: 'B', description: 'y', entry: 'b', last_updated: '2026-10-09T12:00:00+03:00', category: 'shell', valid: true },
    { id: 'c', name: 'C', description: 'z', entry: 'c', last_updated: '2026-10-09T12:00:00+03:00', category: 'brand-new', valid: true },
];
const html = views.toolCards(tools, {});
check(html.indexOf('ОБОЛОЧКА') < html.indexOf('КЛАССИЧЕСКИЙ 2D') && html.includes('BRAND-NEW') && html.includes('id="tool-a"') && html.includes('id="tool-open-a"'), 'toolCards: группы по category, неизвестная категория видна, у карточек и кнопок есть id');
check(views.templateCards([{ id: 'blank', name: 'Пустой', description: '', category: '', files: 3, bytes: 590 }], 'blank').includes('Выбран'), 'templateCards: выбранный шаблон отмечен');
check(views.engineCards([{ label: 'dist/x', path: '/p', size: 2048, mtime: 0, selected: true }]).includes('используется') && views.engineCards([]).includes('Движок не найден'), 'engineCards');

console.log(fails ? 'ПРОВАЛОВ: ' + fails : 'Все проверки пройдены');
if (fails) throw new Error('fail');
