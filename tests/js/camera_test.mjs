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

// --- Платформерное слежение: deadzone, limits, lookahead -------------------

function resetCamera() {
    camera.unfollow();
    camera.limits(null);
    camera.deadzone(false);
    camera.lookahead(0);
    camera.zoom(1);
    camera.at(0, 0);
}

test('deadzone: цель внутри зоны не двигает камеру, за зоной — двигает до края', () => {
    resetCamera();
    const hero = new Node('player');
    hero.x = 400; hero.y = 300;
    camera.at(400, 300);
    camera.follow(hero, { smooth: 0, deadzone: [100, 60] });

    camera._tick(1 / 60);
    hero.x = 430;                       // внутри половины зоны (50)
    camera._tick(1 / 60);
    near(camera.pos().x, 400, 1e-6, 'камера стоит, пока цель в зоне');

    hero.x = 500;                       // 100 > 50 — цель вышла из зоны
    camera._tick(1 / 60);
    near(camera.pos().x, 450, 1e-6, 'камера встала на краю зоны');

    hero.y = 400;                       // 100 > 30 по вертикали
    camera._tick(1 / 60);
    near(camera.pos().y, 370, 1e-6, 'и по вертикали тоже');
    camera.unfollow();
    hero.destroy();
});

test('follow({ deadzone }) принимает число и массив — раньше опция молча терялась', () => {
    resetCamera();
    const hero = new Node('player');
    hero.x = 0; hero.y = 0;
    camera.follow(hero, { smooth: 0, deadzone: 64 });
    eq(JSON.stringify(camera.deadzone()), JSON.stringify({ w: 64, h: 64 }), 'число — квадрат');
    camera.follow(hero, { deadzone: [40, 24] });
    eq(JSON.stringify(camera.deadzone()), JSON.stringify({ w: 40, h: 24 }), 'массив — как есть');
    camera.follow(hero, { deadzone: false });
    eq(camera.deadzone(), null, 'false выключает');
    camera.unfollow();
    hero.destroy();
});

test('deadzone и smooth работают вместе: камера подтягивается к краю зоны, а не прыгает', () => {
    resetCamera();
    const hero = new Node('player');
    hero.x = 0; hero.y = 0;
    camera.at(0, 0);
    camera.follow(hero, { smooth: 0.12, deadzone: 40 });

    hero.x = 100;                       // далеко за половиной зоны (20)
    camera._tick(1 / 60);
    const first = camera.pos().x;
    truthy(first > 0 && first < 80, 'первый кадр — плавное движение, а не прыжок: ' + first);

    for (let i = 0; i < 120; i++) camera._tick(1 / 60);
    near(camera.pos().x, 80, 0.5, 'равновесие: цель на краю зоны, а не в центре кадра');
    camera.unfollow();
    hero.destroy();
});

test('limits: камера не выезжает за границы; геттер и зум учитываются', () => {
    resetCamera();
    const l = camera.limits(0, 0, 1000, 500);
    eq(l, camera, 'сеттер возвращает камеру');
    eq(JSON.stringify(camera.limits()), JSON.stringify({ x: 0, y: 0, w: 1000, h: 500 }), 'геттер');

    camera.at(0, 0);                    // окно 800×600, зум 1 → половина 400×300
    eq(JSON.stringify(camera.pos()), JSON.stringify({ x: 400, y: 250 }), 'прижат к левому верхнему углу');
    camera.at(9999, 9999);
    eq(JSON.stringify(camera.pos()), JSON.stringify({ x: 600, y: 250 }), 'прижат к правому краю');

    camera.zoom(2);                     // половина 200×150
    camera.at(9999, 9999);
    eq(JSON.stringify(camera.pos()), JSON.stringify({ x: 800, y: 350 }), 'зум расширил доступный диапазон');
    camera.limits(null);
    eq(camera.limits(), null, 'limits(null) снимает границы');
});

test('lookahead: камера смотрит вперёд по движению и сбрасывается на телепорте', () => {
    resetCamera();
    const hero = new Node('player');
    hero.x = 0; hero.y = 0;
    camera.at(0, 0);
    camera.follow(hero, { smooth: 0, lookahead: 64, lookaheadSmooth: 0 });

    camera._tick(1 / 60);               // первый тик: направление неизвестно
    near(camera.pos().x, 0, 1e-6, 'первый тик — без выноса');

    hero.x = 5;                          // 300 px/с вправо
    camera._tick(1 / 60);
    near(camera.pos().x, 69, 1e-6, 'камера впереди цели на lookahead');

    hero.x = 0;                          // разворот
    camera._tick(1 / 60);
    near(camera.pos().x, -64, 1e-6, 'вынос сменил знак');

    hero.x = 1000;                       // телепорт (1000 px за шаг)
    camera._tick(1 / 60);
    near(camera.pos().x, 1000, 1e-6, 'на телепорте вынос сброшен');

    camera.unfollow();
    hero.destroy();
});

test('lookahead сглаживается: вынос растёт постепенно, а не рывком', () => {
    resetCamera();
    const hero = new Node('player');
    hero.x = 0; hero.y = 0;
    camera.at(0, 0);
    camera.follow(hero, { smooth: 0, lookahead: 64, lookaheadSmooth: 0.9 });
    camera._tick(1 / 60);

    hero.x = 4;                          // 240 px/с: движемся, но не летим
    camera._tick(1 / 60);
    const lead1 = camera.lookahead().x > 0 ? camera.pos().x : 0;
    truthy(lead1 > 0 && lead1 < 64, 'после одного кадра вынос меньше максимума: ' + lead1);
    for (let i = 0; i < 60; i++) { hero.x += 4; camera._tick(1 / 60); }
    near(camera.pos().x - hero.x, 64, 0.5, 'через секунду вынос достиг максимума');
    camera.unfollow();
    hero.destroy();
});

test('сглаживание не зависит от частоты кадров (1/60 против 1/120)', () => {
    resetCamera();
    const hero = new Node('player');
    hero.x = 0; hero.y = 0;
    camera.follow(hero, { smooth: 0.1 });
    camera.at(0, 0);
    hero.x = 600;
    for (let i = 0; i < 60; i++) camera._tick(1 / 60);
    const at60 = camera.pos().x;

    camera.at(0, 0);
    for (let i = 0; i < 120; i++) camera._tick(1 / 120);
    const at120 = camera.pos().x;
    near(at60, at120, 1e-6, 'одна секунда при 60 и 120 Гц даёт одно и то же положение');
    camera.unfollow();
    hero.destroy();
});

test('snapshot/restore переносят deadzone и lookahead', () => {
    resetCamera();
    const hero = new Node('player');
    hero.x = 0; hero.y = 0;
    camera.follow(hero, { smooth: 0.3, deadzone: [40, 30], lookahead: 64 });
    const snap = camera.snapshot();

    camera.deadzone(false);
    camera.lookahead(0);
    camera.follow(hero, { smooth: 0 });
    camera.restore(snap);
    eq(JSON.stringify(camera.deadzone()), JSON.stringify({ w: 40, h: 30 }), 'мёртвая зона вернулась');
    eq(camera.lookahead().x, 64, 'вынос вернулся');
    near(camera._state.smooth, 0.3, 1e-9, 'сглаживание вернулось');
    camera.unfollow();
    hero.destroy();
});

test('isOnScreen: запас margin учитывается, точка и узел считаются по-разному', () => {
    resetCamera();
    camera.at(0, 0);                    // окно 800×600, зум 1 → половина 400×300
    const n = new Node('sprite');       // w = 32 по умолчанию
    n.x = 470; n.y = 0;
    truthy(camera.isOnScreen(n), 'узел у края кадра виден с запасом 64');
    falsy(camera.isOnScreen(n, 0), 'без запаса тот же узел вне кадра');
    truthy(camera.isOnScreen({ x: 390, y: 0 }), 'точка в кадре');
    falsy(camera.isOnScreen({ x: 500, y: 0 }), 'точка вне кадра');
    n.destroy();
});

finish();
