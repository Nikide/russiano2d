// ===========================================================================
// Юнит-тесты камеры (qjs + tests/js/_harness.mjs).
//
// Регрессия: $.camera.follow(узел) молча ничего не делал — cam.target
// заполнялся только для строки/числа, а объект уходил в никогда не читаемое
// поле follow_target. Камера при этом возвращала себя для цепочки, так что
// ошибка была незаметной.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/camera_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrapOne } from '../../src/highlevel/core.js';
import { installCamera } from '../../src/highlevel/camera.js';

ctx.$ = { _dispatchGlobal: () => {} };
const $ = {};
const camera = installCamera($);

test('follow(узел) ведёт камеру за узлом', () => {
    const hero = new Node('player');
    hero.x = 300;
    hero.y = 200;
    camera.follow(hero, { smooth: 0 });
    camera._tick(1 / 60);
    near(camera.pos().x, 300, 1e-6, 'камера встала по X');
    near(camera.pos().y, 200, 1e-6, 'камера встала по Y');
    truthy(camera.followed() !== null, 'followed() знает узел');

    hero.x = 420;
    camera._tick(1 / 60);
    near(camera.pos().x, 420, 1e-6, 'камера едет за узлом');
    camera.unfollow();
    hero.destroy();
});

test('follow(обёртка) тоже работает', () => {
    const hero = new Node('player');
    hero.x = 50;
    hero.y = 60;
    camera.follow(wrapOne(hero), { smooth: 0 });
    camera._tick(1 / 60);
    near(camera.pos().x, 50, 1e-6, 'обёртка разворачивается в узел');
    camera.unfollow();
    hero.destroy();
});

test('follow(селектор) резолвится лениво — узел может появиться позже', () => {
    camera.follow('#late', { smooth: 0 });
    camera._tick(1 / 60);
    const before = camera.pos().x;

    const late = new Node('player');
    late.id = 'late';
    ctx.byId.set('late', late);
    late.x = 640;
    late.y = 100;
    camera._tick(1 / 60);
    near(camera.pos().x, 640, 1e-6, 'камера нашла узел после его создания');
    truthy(before !== 640, 'до создания узла камера стояла на месте');
    camera.unfollow();
    ctx.byId.delete('late');
    late.destroy();
});

test('unfollow() отпускает узел', () => {
    const hero = new Node('player');
    camera.follow(hero, { smooth: 0 });
    camera.unfollow();
    falsy(camera.followed(), 'followed() пуст');
    hero.destroy();
});

finish();
