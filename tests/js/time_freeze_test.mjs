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
import { ctx, Node } from '../../src/highlevel/core.js';
import {
    installTime, tickTime, freezeDuration, slowEnvelope, combineSlow,
} from '../../src/highlevel/time.js';
import { installTriggers } from '../../src/highlevel/triggers.js';

// Камера и ввод — часть кадрового тика времени; без движка их надо подставить.
ctx.camera = { _tick() {} };

// Мост к шагу физики: в движке C это engine.setTimeScale (src/script.c),
// в тесте — запись вызовов. Проверка `typeof` тут бесполезна: харнесс отдаёт
// noop на любое имя, поэтому пишем настоящую функцию.
const physics = { calls: [] };
engine.setTimeScale = function (value) { physics.calls.push(value); };

const $ = {};
const time = installTime($);
// §44: политики обработки живут в triggers.js; time.js спрашивает их у узла.
installTriggers($);
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
    // Симуляционные подписки/таймеры/метки — тоже между тестами.
    const sim = time._state.sim;
    sim.subs.length = 0;
    sim.timers.length = 0;
    sim.durations.length = 0;
    sim.marks.clear();
    sim.tick = 0;
    sim.acc = 0;
    sim.c_scale = 1;
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

// --- §44: симуляционные тики отдельно от кадров отрисовки -------------------

test('тик симуляции не зависит от render FPS: 30 и 60 кадров дают одно и то же', () => {
    reset();
    // Как в движке: app->dt хранится во float, поэтому и здесь fround.
    const run = (fps, frames) => {
        reset();
        engine.dt = Math.fround(1 / fps);
        for (let i = 0; i < frames; i++) tickTime();
        return time.tick();
    };
    const at30 = run(30, 60);          // 2 симулированные секунды
    const at60 = run(60, 120);
    eq(at30, 120, '30 «кадров» в секунду: 120 тиков за 2 с');
    eq(at60, 120, '60 «кадров» в секунду: те же 120 тиков');
    near(time.simDt(), 1 / 60, 1e-9, 'шаг симуляции — 1/60 с');
    engine.dt = Math.fround(1 / 60);
});

test('$.time.tick() — не $.time.frame(): счётчики считают разное', () => {
    reset();
    engine.dt = Math.fround(1 / 30);
    for (let i = 0; i < 10; i++) tickTime();
    eq(time.tick(), 20, '10 кадров по 1/30 с — 20 шагов симуляции');
    engine.dt = Math.fround(1 / 60);
});

test('onTick: подписка на каждый шаг, политика fixed её останавливает', () => {
    reset();
    engine.dt = Math.fround(1 / 60);
    const seen = [];
    time.onTick((tick) => seen.push(tick));
    for (let i = 0; i < 3; i++) tickTime();
    eq(seen.join(','), '1,2,3', 'подписка зовётся на каждом шаге');

    const enemy = new Node('enemy', {});
    let owned = 0;
    time.onTick(() => { owned++; }, { node: enemy });
    for (let i = 0; i < 2; i++) tickTime();
    eq(owned, 2, 'подписка владельца работает, пока он активен');
    $.processing.set(enemy, { fixed: false });
    for (let i = 0; i < 3; i++) tickTime();
    eq(owned, 2, 'у выключенного владельца фиксированный шаг стоит');
    $.processing.set(enemy, { fixed: true });
    tickTime();
    eq(owned, 3, 'после включения снова вызывается');
});

test('everyTicks / afterTicks: «каждые N тиков» и «через N тиков»', () => {
    reset();
    engine.dt = Math.fround(1 / 60);
    let every = 0;
    const handle = time.everyTicks(10, () => { every++; });
    for (let i = 0; i < 25; i++) tickTime();
    eq(every, 2, 'два раза за 25 тиков при N = 10');
    eq(handle.fired(), 2);
    handle.cancel();
    for (let i = 0; i < 25; i++) tickTime();
    eq(every, 2, 'после cancel() не вызывается');

    let after = 0;
    const once = time.afterTicks(10, () => { after++; });
    for (let i = 0; i < 9; i++) tickTime();
    eq(after, 0, 'до срока не сработал');
    tickTime();
    eq(after, 1, 'на десятом тике сработал');
    for (let i = 0; i < 5; i++) tickTime();
    eq(after, 1, 'однократный больше не срабатывает');
    eq(once.fired(), 1);
});

test('everyTicks с from: zero — явная семантика глобального tick modulo', () => {
    reset();
    engine.dt = Math.fround(1 / 60);
    const fired = [];
    time.everyTicks(4, (tick) => fired.push(tick), { from: 'zero' });
    for (let i = 0; i < 12; i++) tickTime();
    eq(fired.join(','), '4,8,12', 'срабатывает на тиках, кратных N');
});

test('duration: жизнь в тиках и отметки состояния', () => {
    reset();
    engine.dt = Math.fround(1 / 60);
    const life = time.duration(30);
    let ended_at = -1;
    life.onEnd(() => { ended_at = time.tick(); });
    for (let i = 0; i < 29; i++) tickTime();
    falsy(life.expired(), 'до срока жива');
    eq(life.left(), 1);
    tickTime();
    truthy(life.expired(), 'истекла ровно на 30-м тике');
    eq(ended_at, 30);
    eq(life.elapsed(), 30);
    life.reset(5);
    falsy(life.expired(), 'reset() оживил');
    for (let i = 0; i < 5; i++) tickTime();
    truthy(life.expired(), 'истекла снова');

    time.mark('shot');
    for (let i = 0; i < 7; i++) tickTime();
    eq(time.since('shot'), 7, 'локальный счётчик тиков от метки');
    eq(time.since('нет-такой'), 0, 'без метки — ноль');
});

test('заморозка и пауза останавливают шаги симуляции', () => {
    reset();
    engine.dt = Math.fround(1 / 60);
    for (let i = 0; i < 3; i++) tickTime();
    const before = time.tick();
    time.freeze(100);
    // Кадр, в котором заморозку запросили, ещё шагает: физика C уже сделала
    // свой шаг до апдейта скрипта, и множитель применяется со следующего кадра.
    tickTime();
    truthy(time.tick() === before || time.tick() === before + 1,
           'кадр запроса заморозки мог шагнуть один раз');
    const at_freeze = time.tick();
    for (let i = 0; i < 4; i++) tickTime();
    eq(time.tick(), at_freeze, 'на заморозке тиков нет (шаг физики стоит)');
    while (time.frozen()) tickTime();
    tickTime();
    truthy(time.tick() > before, 'после заморозки шаги снова идут');

    time.pause();
    tickTime();                          // кадр запроса: физика C уже шагнула
    const mark = time.tick();
    for (let i = 0; i < 4; i++) tickTime();
    eq(time.tick(), mark, 'на паузе тиков нет');
    time.resume();
});

test('таймер с владельцем стоит, пока у узла выключена политика timers', () => {
    reset();
    engine.dt = Math.fround(1 / 60);
    const node = new Node('enemy', {});
    let fired = 0;
    time.after(50, () => { fired++; }, { node });
    $.processing.set(node, { timers: false });
    for (let i = 0; i < 10; i++) tickTime();
    eq(fired, 0, 'владелец выключен — таймер не истекает');
    $.processing.set(node, { timers: true });
    for (let i = 0; i < 10; i++) tickTime();
    eq(fired, 1, 'после включения таймер дошёл до конца');
});

finish();
