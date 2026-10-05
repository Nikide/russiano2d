// ===========================================================================
// Юнит-тесты окна (qjs + tests/js/_harness.mjs).
//
// Регрессия: в fire() стоял вызов несуществующего api.ctx.reportError(err, …).
// Собственный catch падал с TypeError, и исключение из обработчика
// $.window.on() уходило наверх — в кадровый цикл движка, который его не ловит.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/window_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';
import { installWindow, tickWindow } from '../../src/highlevel/window.js';

let size = [800, 600];
const logs = [];

engine.window = {
    size: () => size.slice(),
    pixelSize: () => size.slice(),
    focused: () => true, visible: () => true, fullscreen: () => false,
    resizable: () => true, vsync: () => true, cursor: () => 'normal',
    title: () => 'тест',
    setTitle() {}, setSize() {}, setFullscreen() {}, setResizable() {}, setVsync() {},
    setCursor() {}, move() {}, center() {}, minimize() {}, maximize() {}, restore() {},
    show() {}, hide() {}, focus() {}, position: () => [0, 0],
};
engine.log = (message) => logs.push(String(message));

const $ = {};
$.ctx = ctx;          // как в installApi: window.js смотрит api.ctx
const windowApi = installWindow($);

test('resize вызывает подписчика ровно один раз на изменение', () => {
    let calls = 0;
    windowApi.on('resize', () => { calls++; });
    size = [900, 600];
    tickWindow();
    tickWindow();
    eq(calls, 1, 'повторный tick без изменения размера ничего не шлёт');

    size = [900, 700];
    tickWindow();
    eq(calls, 2, 'новое изменение — новый вызов');
});

test('исключение в обработчике окна не валит кадр', () => {
    windowApi.on('resize', () => { throw new Error('boom'); });
    logs.length = 0;
    size = [1000, 700];
    let threw = false;
    try { tickWindow(); } catch (e) { threw = true; }
    falsy(threw, 'tickWindow не пробросил исключение наружу');
    truthy(logs.some((l) => l.includes('boom')), 'ошибка попала в лог');
});

test('с ctx.reportError ошибка уходит в него с правильным порядком аргументов', () => {
    let where = null, err = null;
    ctx.reportError = (w, e) => { where = w; err = e; };
    size = [1100, 700];
    tickWindow();
    truthy(where && where.includes("$.window.on('resize')"), 'первым идёт место: ' + where);
    truthy(err instanceof Error && err.message === 'boom', 'вторым — сама ошибка');
    delete ctx.reportError;
});

test('off() отписывает обработчик', () => {
    let calls = 0;
    const fn = () => { calls++; };
    windowApi.off('focus');
    windowApi.on('focus', fn);
    size = [1100, 800];
    tickWindow();
    windowApi.off('focus', fn);
    tickWindow();
    eq(calls, 0, 'после off() уведомлений нет');
});

finish();
