// ===========================================================================
// Юнит-тесты сцен (qjs + tests/js/_harness.mjs).
//
// Регрессия: при завершении фазы out перехода $.scene._tick() перезаписывал
// pending_opts значением { transition: 'none' }, и опция keepUI из load()
// терялась — интерфейс сносился вместе с миром. С мгновенной сменой
// ({ transition: 'none' }) баг не проявлялся: он зависел от перехода.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/scene_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node } from '../../src/highlevel/core.js';
import { installScene } from '../../src/highlevel/scene.js';

// clearWorld() трогает эти подсистемы — подставляем минимальные заглушки.
ctx.$ = { _dispatchGlobal: () => {} };
ctx.byId = new Map();
ctx.timers = [];
ctx.animations = [];
ctx.time = { cancelAll() {}, resume() {} };
ctx.world = { clearBounds() {}, resume() {}, timeScale() {} };

const $ = {};
const scene = installScene($);
scene.add('a', { enter() {} });
scene.add('b', { enter() {} });

const INSTANT = { transition: 'none' };

test('keepUI переживает переход с затемнением', () => {
    scene.load('a', INSTANT);
    scene._tick(0);                       // мгновенная смена сцены
    eq(scene.current(), 'a');

    const ui = new Node('ui.panel');
    scene.load('b', { keepUI: true });    // переход по умолчанию (300 мс)
    scene._tick(0.4);                     // фаза out завершилась

    eq(scene.current(), 'b', 'сцена сменилась');
    falsy(ui.removed, 'ui-узел остался жив');
    ui.destroy();
});

test('без keepUI интерфейс сносится вместе со сценой', () => {
    const ui = new Node('ui.panel');
    scene.load('a', INSTANT);
    scene._tick(0.4);
    eq(scene.current(), 'a');
    truthy(ui.removed, 'ui-узел уничтожен');
});

test('обычные узлы уничтожаются при смене сцены', () => {
    const sprite = new Node('sprite');
    scene.load('b', INSTANT);
    scene._tick(0);
    truthy(sprite.removed, 'игровой узел снесён');
});

test('scene-persistent узлы переживают смену сцены', () => {
    const hero = new Node('sprite');
    hero.addClass('scene-persistent');
    scene.load('a', INSTANT);
    scene._tick(0);
    falsy(hero.removed, 'persistent-узел остался');
    hero.destroy();
});

finish();
