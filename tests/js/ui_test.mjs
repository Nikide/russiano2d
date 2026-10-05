// ===========================================================================
// Юнит-тесты UI-подсистемы (qjs + tests/js/_harness.mjs).
//
// Регрессия: $.ui.doc(path).unload() снимал документ в движке, но не убирал
// его из кэша модуля — повторный $.ui.doc(path) возвращал обёртку с мёртвым id.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/ui_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { installUi } from '../../src/highlevel/ui.js';

const unloaded = [];
let next_id = 1;

engine.ui = {
    load: () => next_id++,
    unload: (id) => unloaded.push(id),
    show() {}, hide() {}, visible: () => true,
    setText() {}, setHtml() {}, setClass() {}, setProperty() {}, on() {},
    icon: () => '', hasIcon: () => false, iconNames: () => [], iconCount: () => 0,
};

const $ = {};
const ui = installUi($);

test('$.ui.doc кэширует обёртку по пути', () => {
    const first = ui.doc('ui/menu.rml');
    const second = ui.doc('ui/menu.rml');
    eq(first, second, 'тот же объект — иначе слушатели повесились бы дважды');
});

test('unload() убирает документ из кэша', () => {
    const doc = ui.doc('ui/hud.rml');
    doc.unload();
    eq(unloaded.length, 1, 'движку сообщили о выгрузке');
    truthy(ui.doc('ui/hud.rml') !== doc, 'повторный doc создаёт новый документ');
});

test('on() не подписывает одну пару дважды', () => {
    const doc = ui.doc('ui/again.rml');
    let calls = 0;
    const handler = () => { calls++; };
    doc.on('btn', 'click', handler);
    doc.on('btn', 'click', handler);
    eq(doc.listeners().length, 1, 'одна пара элемент+событие');
    doc.on('btn', 'mouseover', handler);
    eq(doc.listeners().length, 2, 'другое событие — отдельная подписка');
});

test('ошибка загрузки документа не роняет API', () => {
    engine.ui.load = () => -1;
    const doc = ui.doc('ui/нет.rml');
    falsy(doc.id >= 0, 'id отрицательный, но обёртка есть');
});

finish();
