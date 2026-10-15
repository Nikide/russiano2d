// ===========================================================================
// Юнит-тесты времени удара ($.time.freeze / $.time.hitStop / $.time.slow).
//
// Проверяем ровно то, из-за чего hit-stop обычно и ломается: заморозка живёт
// по времени КАДРА (а не игровому dt, которое при заморозке равно нулю),
// длится заказанное число кадров, не складывается при вложенных вызовах,
// отпускается сама и не затирает $.time.scale() игры.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/time_freeze_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';
import {
    installTime, tickTime, freezeDuration, slowEnvelope, combineSlow,
} from '../../src/highlevel/time.js';

// Камера и ввод — часть кадрового тика времени; без движка их надо подставить.
ctx.camera = { _tick() {} };

// Мост к шагу физики: в движке C это engine.setTimeScale (src/script.c),
// в тесте — запись вызовов. Проверка `typeof` тут бесполезна: харнесс отдаёт
// noop на любое имя, поэтому пишем настоящую функцию.
const physics = { calls: [] };
engine.setTimeScale = function (value) { physics.calls.push(value); };

const $ = {};
const time = installTime($);
ctx.time = time;

const FRAME = engine.dt;                 // 1/60 c
const FRAME_MS = FRAME * 1000;

/** Чистое состояние между проверками: заморозка, замедления, таймеры. */
function reset() {
    time.unfreeze();
    time.resume();
    time.scale(1);
    time._state.slow.length = 0;
    time._state.frame_frozen = false;
    physics.calls.length = 0;
}

/** Один кадр: тик времени + дельта, которую видит игра. */
function frame() {
    tickTime();
    return time.delta();
}

// --- Чистая арифметика -----------------------------------------------------

test('freezeDuration: миллисекунды, но не меньше кадра', () => {
    near(freezeDuration(70, 1 / 60), 70, 1e-9);
    near(freezeDuration(0, 1 / 60), FRAME_MS, 1e-9, 'ноль превращается в один кадр');
    near(freezeDuration(-5, 1 / 60), FRAME_MS, 1e-9, 'отрицательное — тоже один кадр');
    near(freezeDuration('нет', 0.02), 20, 1e-9, 'мусор — один кадр по dt');
});

test('slowEnvelope: вход и выход сглажены, середина полная', () => {
    eq(slowEnvelope(0, 0.2, 0.3), 0, 'на старте сила нулевая');
    near(slowEnvelope(0.5, 0.2, 0.3), 1, 1e-9, 'в середине полная');
    eq(slowEnvelope(1, 0.2, 0.3), 0, 'в конце снова ноль');
    eq(slowEnvelope(0.5, 0, 0), 1, 'без сглаживания — сразу полная');
});

test('combineSlow: побеждает сильнейшее замедление', () => {
    eq(combineSlow([], 1), 1, 'пусто — время идёт как шло');
    const slow = [
        { left: 50, total: 100, scale: 0.5, in_frac: 0, out_frac: 0 },
        { left: 50, total: 100, scale: 0.2, in_frac: 0, out_frac: 0 },
    ];
    near(combineSlow(slow, 1), 0.2, 1e-9);
});

// --- Заморозка -------------------------------------------------------------

test('freeze(50) держит игровую дельту нулевой ровно 3 кадра', () => {
    reset();
    time.freeze(50);
    truthy(time.frozen(), 'заморозка взведена сразу же');
    eq(frame(), 0, 'кадр удара уже заморожен');
    eq(frame(), 0, 'второй кадр');
    eq(frame(), 0, 'третий кадр — последний замороженный (50 мс при 16.7 мс/кадр)');
    near(frame(), FRAME, 1e-9, 'четвёртый кадр — время пошло');
    falsy(time.frozen(), 'заморозка отпустила себя сама');
});

test('на заморозке игровое время и таймеры стоят', () => {
    reset();
    let ticks = 0;
    time.every(5, () => { ticks++; });
    const before = time.now();
    time.freeze(100);
    frame();
    frame();
    eq(ticks, 0, 'периодический вызов не сработал');
    near(time.now(), before, 1e-12, 'игровое время не сдвинулось');
    // 100 мс при 16.7 мс на кадр — шесть замороженных кадров; седьмой отпускает.
    while (time.frozen()) frame();
    frame();
    truthy(ticks > 0, 'после заморозки таймеры ожили');
});

test('вложенная заморозка не складывается: работает самая длинная', () => {
    reset();
    time.freeze(100);
    time.freeze(10, { frames: 1 });
    const left = time.freezeLeft();
    truthy(left > FRAME_MS, `длинная заморозка сохранилась: ${left}`);
    for (let i = 0; i < 5; i++) eq(frame(), 0, 'все ещё заморожено');
    truthy(time.frozen(), '10 мс не перебили 100 мс');
});

test('cancel() снимает заморозку немедленно', () => {
    reset();
    const handle = time.freeze(1000);
    eq(frame(), 0);
    truthy(handle.active(), 'ручка активна');
    handle.cancel();
    falsy(time.frozen());
    near(frame(), FRAME, 1e-9, 'время пошло сразу после cancel');
    falsy(handle.active(), 'ручка больше не активна');
});

test('unfreeze() снимает заморозку и не ломает паузу', () => {
    reset();
    time.freeze(500);
    time.unfreeze();
    falsy(time.frozen());
    time.pause();
    eq(frame(), 0, 'пауза по-прежнему останавливает время');
    time.resume();
    near(frame(), FRAME, 1e-9);
});

test('заморозка не затирает $.time.scale() игры', () => {
    reset();
    time.scale(0.5);
    const handle = time.freeze(50);
    eq(frame(), 0, 'на заморозке ноль');
    frame();
    frame();
    near(frame(), FRAME * 0.5, 1e-9, 'после заморозки масштаб игры вернулся сам');
    eq(time.scale(), 0.5, 'и сам масштаб никто не менял');
    handle.cancel();
});

test('busy() видит заморозку как занятость', () => {
    reset();
    falsy(time.busy());
    time.freeze(50);
    truthy(time.busy(), 'заморозка — это занятость');
    time.unfreeze();
    falsy(time.busy());
});

// --- Замедление ------------------------------------------------------------

test('slow(200, 0.25) замедляет время и возвращает масштаб сам', () => {
    reset();
    time.slow(200, 0.25, { in: 0, out: 0 });
    near(frame(), FRAME * 0.25, 1e-9, 'четверть скорости');
    eq(time.slowCount(), 1, 'замедление живо');
    for (let i = 0; i < 20; i++) frame();
    eq(time.slowCount(), 0, 'замедление кончилось');
    near(frame(), FRAME, 1e-9, 'время снова идёт нормально');
});

test('замедление живёт по времени кадра и переживает нулевой масштаб игры', () => {
    reset();
    time.scale(0);
    time.slow(100, 0.5, { in: 0, out: 0 });
    const left = time._state.slow[0].left;
    for (let i = 0; i < 3; i++) frame();
    truthy(time._state.slow[0].left < left, 'замедление тикает даже при scale(0)');
    time._state.slow.length = 0;
});

// --- Мост к шагу физики ----------------------------------------------------

test('заморозка гасит шаг физики и возвращает прежний масштаб, а не единицу', () => {
    reset();
    time.scale(0.5);
    eq(physics.calls[physics.calls.length - 1], 0.5, 'scale(0.5) ушёл в шаг физики');
    time.freeze(50);
    eq(physics.calls[physics.calls.length - 1], 0, 'на заморозке тела стоят');
    eq(time.physicsScale(), 0, 'множитель физики — ноль');
    time.unfreeze();
    eq(physics.calls[physics.calls.length - 1], 0.5, 'вернулся масштаб игры, не единица');
    eq(time.physicsScale(), 0.5);
});

test('пауза и замедление останавливают шаг физики тем же множителем', () => {
    reset();
    time.pause();
    eq(time.physicsScale(), 0, 'пауза — тела стоят');
    time.resume();
    eq(time.physicsScale(), 1, 'после паузы — снова полный шаг');
    time.slow(200, 0.25, { in: 0, out: 0 });
    near(time.physicsScale(), 0.25, 1e-9, 'замедление — четверть шага');
    time._state.slow.length = 0;
    time._state.frame_frozen = false;
    tickTime();
    eq(time.physicsScale(), 1, 'замедление кончилось — шаг вернулся');
});

test('hitStop — синоним freeze с умолчанием 70 мс', () => {
    reset();
    time.hitStop();
    eq(frame(), 0, 'заморожено');
    truthy(time.freezeLeft() <= 70 + FRAME_MS + 1e-6, `осталось не больше заказанного: ${time.freezeLeft()}`);
});

finish();
