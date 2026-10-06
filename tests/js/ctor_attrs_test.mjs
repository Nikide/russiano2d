// ===========================================================================
// Регрессия по «граблям» первого игрового проекта.
//
// 1. $('<sprite>', { src }) не грузил текстуру: src оседал в attrs и не
//    доходил до setSprite(), хотя .sprite(src) работал. То же с { frames } —
//    лист молча превращался в обычный атрибут.
// 2. .attr('id') не читал свойства узла: смотрел только в attrs, поэтому
//    .attr('src') работал, а .attr('id')/('hp')/('x') возвращали undefined.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/ctor_attrs_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';

// Полный $ тянет за собой подсистемы: подпираем те, которых нет в моке.
const noop = () => 0;
const stub = (extra) => new Proxy(extra || {}, {
    get(t, k) { return k in t ? t[k] : noop; },
    has() { return true; },
});
engine.window = stub({ size: () => [800, 600], pixelSize: () => [800, 600] });
engine.ui = stub();
engine.fs = stub();
engine.audio = stub();

const loaded = [];
engine.loadTexture = (path) => { loaded.push(path); return 7; };

const { createApi } = await import('../../src/highlevel/api.js');
const $ = createApi();

const SHEET = { src: 'art/sheet.png', cols: 4, rows: 2, cw: 16, ch: 16 };

// --- 1. src в конструкторе ------------------------------------------------

test('$("<sprite>", { src }) грузит текстуру', () => {
    loaded.length = 0;
    const n = $('<sprite>', { src: 'art/hero.png' });
    eq(loaded.join(','), 'art/hero.png', 'текстура запрошена по пути из src');
    eq(n.attr('src'), 'art/hero.png');
});

test('$("<player>", { src }) грузит текстуру', () => {
    loaded.length = 0;
    const n = $('<player>', { src: 'art/p.png' });
    eq(loaded.join(','), 'art/p.png');
    n.remove();
});

test('$("<tilemap>", { src }) не грузит картинку сам — её берёт отрисовщик', () => {
    loaded.length = 0;
    const n = $('<tilemap>', { src: 'tiles.png', tile: 16 });
    eq(loaded.length, 0, 'loadTexture не тронут');
    eq(n.attr('src'), 'tiles.png', 'путь остался в attrs');
    n.remove();
});

test('$("<sprite>", { frames }) включает лист, как .frames()', () => {
    const n = $('<sprite>', { frames: SHEET });
    truthy(n.get(0).frames, 'кадры созданы');
    eq(n.get(0).frames.length, 8, '4 × 2 = 8 кадров');
    eq(n.attr('src'), 'art/sheet.png', 'путь листа виден в attrs');
    n.remove();
});

test('.sprite(path) синхронизирует attrs.src для .region()', () => {
    const n = $('<sprite>').sprite('art/tile.png');
    eq(n.get(0).attrs.src, 'art/tile.png');
    n.remove();
});

// --- 2. .attr читает свойства --------------------------------------------

test('.attr() читает свойства, а не пустой attrs', () => {
    const n = $('<player>', { id: 'hero', x: 100, y: 50, hp: 70, speed: 300 });
    eq(n.attr('id'), 'hero', 'id — свойство, а не атрибут');
    eq(n.attr('x'), 100);
    eq(n.attr('y'), 50);
    eq(n.attr('hp'), 70);
    eq(n.attr('speed'), 300);
    n.remove();
});

test('.attr() читает и настоящие атрибуты, и неизвестные ключи', () => {
    const n = $('<sprite>', { src: 'a.png', custom: 'v' });
    eq(n.attr('src'), 'a.png');
    eq(n.attr('custom'), 'v');
    eq(n.attr('нет-такого'), undefined);
    n.remove();
});

test('.attr(name, value) по-прежнему пишет', () => {
    const n = $('<player>', { id: 'p1' });
    n.attr('hp', 42).attr('team', 3);
    eq(n.attr('hp'), 42);
    eq(n.attr('team'), 3);
    n.remove();
});

test('.attr() без аргумента возвращает свободные атрибуты (совместимость)', () => {
    const n = $('<sprite>', { custom: 1 });
    const all = n.attr();
    eq(all.custom, 1);
    eq(Object.prototype.hasOwnProperty.call(all, 'id'), false, 'свойства не подмешиваются');
    n.remove();
});

test('.attr("class")/("tag") отдают добавленные метки', () => {
    const n = $('<sprite>').addClass('boss').addTag('friendly');
    eq(n.attr('class'), 'boss');
    eq(n.attr('tag'), 'friendly');
    n.remove();
});

test('.tag() добавляет тег, а не класс', () => {
    const n = $('<sprite>').tag('friendly');
    eq(n.attr('tag'), 'friendly');
    falsy(n.get(0).classes.has('friendly'), 'класс не появился');
    n.remove();
});

finish();
