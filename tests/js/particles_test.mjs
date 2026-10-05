// ===========================================================================
// Юнит-тесты CPU-частиц без движка (qjs + tests/js/_harness.mjs).
//
// Проверяем чистую математику (рампы, шаг, спавн, детерминизм) и работу
// эмиттера как узла <particles>: залпы, one_shot, лимит пула, local/global и
// методы обёртки.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/particles_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrapOne, makeRandom } from '../../src/highlevel/core.js';
import {
    installParticles, tickParticles, buildParams, buildRamp,
    spawnParticle, stepParticle, sampleRamp,
} from '../../src/highlevel/particles.js';

// Устанавливаем подсистему один раз: она регистрирует $.particles, методы
// обёртки и патч Node.set для сырых параметров <particles>.
const $stub = {};
installParticles($stub);

/** Свежий мир на каждый тест — tickParticles обходит ctx.nodes. */
function freshWorld(...nodes) {
    ctx.nodes.length = 0;
    for (const n of nodes) ctx.nodes.push(n);
    return nodes.map((n) => wrapOne(n));
}

// ---------------------------------------------------------------------------
// Рампы
// ---------------------------------------------------------------------------

test('sampleRamp: линейная интерполяция и обрезка по краям', () => {
    const ramp = [{ t: 0, value: 0 }, { t: 1, value: 10 }];
    near(sampleRamp(ramp, 0.0), 0);
    near(sampleRamp(ramp, 0.5), 5);
    near(sampleRamp(ramp, 1.0), 10);
    near(sampleRamp(ramp, -3), 0, 1e-9, 'до первого стопа — первое значение');
    near(sampleRamp(ramp, 7), 10, 1e-9, 'после последнего — последнее значение');
});

test('sampleRamp: середина между стопами, а не между краями', () => {
    const ramp = [{ t: 0, value: 0 }, { t: 0.25, value: 10 }, { t: 1, value: 10 }];
    near(sampleRamp(ramp, 0.125), 5);
    near(sampleRamp(ramp, 0.5), 10);
});

test('sampleRamp: цвет интерполируется по каналам', () => {
    const mid = sampleRamp([{ t: 0, color: '#000000' }, { t: 1, color: '#ffffff' }], 0.5);
    eq(mid, engine.rgba(128, 128, 128, 255));
});

test('sampleRamp: альфа-рампа читает поле alpha', () => {
    const ramp = [{ t: 0, alpha: 1 }, { t: 1, alpha: 0 }];
    near(sampleRamp(ramp, 0.25), 0.75);
});

test('buildRamp: сортирует стопы и хранит признак цвета', () => {
    const ramp = buildRamp([{ t: 1, value: 5 }, { t: 0, value: 1 }], 'value');
    eq(ramp[0].t, 0);
    eq(ramp[1].t, 1);
    falsy(ramp.color, 'скалярная рампа не помечена как цветная');
    const color = buildRamp([{ t: 0, color: '#fff' }], 'color');
    truthy(color.color, 'цветная рампа помечена');
    eq(buildRamp([], 'value'), null);
});

// ---------------------------------------------------------------------------
// Разбор параметров
// ---------------------------------------------------------------------------

test('buildParams: диапазоны, гравитация, режим по умолчанию', () => {
    const p = buildParams({
        amount: 10, lifetime: [100, 200], speed: [50, 150],
        gravity: [0, 400], size: [2, 6], seed: 5,
    });
    eq(p.amount, 10);
    near(p.life_min, 0.1);
    near(p.life_max, 0.2);
    near(p.speed_min, 50);
    near(p.speed_max, 150);
    eq(p.gravity.y, 400);
    eq(p.gravity.x, 0);
    eq(p.local, true, 'local включён по умолчанию');
});

test('buildParams: число вместо диапазона и max_particles', () => {
    const p = buildParams({ speed: 120, size: 4, gravity: 300, max_particles: 7, amount: 100 });
    near(p.speed_min, 120);
    near(p.speed_max, 120);
    near(p.size_min, 4);
    eq(p.gravity.y, 300);
    eq(p.max_particles, 7);
    eq(p.amount, 7, 'amount подрезан потолком пула');
});

test('buildParams: global выключает local, rate из interval', () => {
    const p = buildParams({ global: true, interval: 50 });
    eq(p.local, false);
    near(p.rate, 20);
});

test('buildParams: end_size по умолчанию наследует size', () => {
    const p = buildParams({ size: 6 });
    falsy(p.has_end_size);
    const q = spawnParticle(p, makeRandom(1));
    near(q.size, 6);
    near(q.end_size, 6, 1e-9, 'без end_size размер не меняется');
});

// ---------------------------------------------------------------------------
// Спавн и шаг
// ---------------------------------------------------------------------------

test('spawnParticle: скорость в диапазоне и направление', () => {
    const p = buildParams({ speed: [100, 200], direction: 0, spread: 0, lifetime: 500, size: 4 });
    const q = spawnParticle(p, makeRandom(1));
    truthy(q.vx >= 100 && q.vx <= 200, 'скорость попала в диапазон');
    near(q.vy, 0, 1e-9);
    near(q.life, 0.5);
    near(q.age, 0);
    falsy(q.dead);
});

test('spawnParticle: один seed — одна последовательность', () => {
    const p = buildParams({ speed: [50, 250], spread: 360, lifetime: [100, 900], size: [2, 9], seed: 11 });
    const a = spawnParticle(p, makeRandom(11));
    const b = spawnParticle(p, makeRandom(11));
    eq(a.x, b.x); eq(a.y, b.y);
    eq(a.vx, b.vx); eq(a.vy, b.vy);
    eq(a.life, b.life); eq(a.size, b.size);
});

test('stepParticle: гравитация растит vy и тянет вниз', () => {
    const p = buildParams({ lifetime: 5000, speed: 0, gravity: [0, 100] });
    const q = spawnParticle(p, makeRandom(3));
    const vy0 = q.vy;
    stepParticle(q, 0.1, p);
    truthy(q.vy > vy0, 'vy вырос');
    truthy(q.y > 0, 'частица опустилась по Y');
});

test('stepParticle: пуля исчезает по времени жизни', () => {
    const p = buildParams({ lifetime: 100, speed: 10, gravity: 0 });
    const q = spawnParticle(p, makeRandom(4));
    let steps = 0;
    while (!q.dead && steps < 1000) { stepParticle(q, 0.016, p); steps++; }
    truthy(q.dead, 'частица помечена мёртвой');
    truthy(q.age >= 0.1, 'возраст дошёл до времени жизни');
});

test('stepParticle: damping гасит скорость', () => {
    const p = buildParams({ lifetime: 5000, speed: 100, gravity: 0, damping: 3 });
    const q = spawnParticle(p, makeRandom(6));
    const v0 = Math.hypot(q.vx, q.vy);
    stepParticle(q, 0.1, p);
    truthy(Math.hypot(q.vx, q.vy) < v0, 'скорость упала');
});

// ---------------------------------------------------------------------------
// Эмиттер: залпы, жизнь, лимиты
// ---------------------------------------------------------------------------

test('one_shot выдаёт ровно amount и не повторяет', () => {
    const n = new Node('particles', {
        one_shot: true, amount: 12, lifetime: 5000, speed: 0, max_particles: 64, seed: 1,
    });
    const [w] = freshWorld(n);
    tickParticles(1 / 60);
    eq(w.count(), 12);
    tickParticles(1 / 60);
    eq(w.count(), 12, 'повторного залпа нет');
});

test('burst выдаёт ровно n частиц', () => {
    const n = new Node('particles', {
        emitting: false, amount: 3, lifetime: 5000, speed: 0, max_particles: 32, seed: 2,
    });
    const [w] = freshWorld(n);
    w.burst(7);
    eq(w.count(), 7);
});

test('эмиттер соблюдает max_particles', () => {
    const n = new Node('particles', {
        amount: 100, max_particles: 5, lifetime: 5000, rate: 10000, speed: 0, seed: 3,
    });
    const [w] = freshWorld(n);
    tickParticles(1 / 60);
    eq(w.count(), 5);
    for (let i = 0; i < 10; i++) tickParticles(1 / 60);
    truthy(w.count() <= 5, 'пул не переполняется');
});

test('частицы исчезают после остановки эмиссии', () => {
    const n = new Node('particles', {
        amount: 4, lifetime: 100, rate: 1000, speed: 10, max_particles: 16, seed: 4,
    });
    const [w] = freshWorld(n);
    tickParticles(0.016);
    truthy(w.count() > 0, 'эмиссия началась');
    w.stop();
    eq(w.isEmitting(), false);
    for (let i = 0; i < 20; i++) tickParticles(0.016);
    eq(w.count(), 0, 'все частицы дожили свой срок и исчезли');
});

test('детерминизм: два эмиттера с одним seed совпадают', () => {
    const spec = {
        amount: 8, lifetime: [500, 500], speed: [50, 50], spread: 360,
        gravity: [0, 100], rate: 480, seed: 42, max_particles: 32,
    };
    const a = new Node('particles', spec);
    const b = new Node('particles', spec);
    const [wa, wb] = freshWorld(a, b);
    tickParticles(1 / 60);
    eq(wa.count(), wb.count());
    truthy(wa.count() > 0);
    for (let i = 0; i < wa.count(); i++) {
        const pa = wa.particleAt(i), pb = wb.particleAt(i);
        eq(pa.x, pb.x); eq(pa.y, pb.y);
        eq(pa.vx, pb.vx); eq(pa.vy, pb.vy);
    }
    tickParticles(1 / 60);
    const pa = wa.particleAt(0), pb = wb.particleAt(0);
    eq(pa.x, pb.x); eq(pa.y, pb.y);
});

// ---------------------------------------------------------------------------
// local / global и методы узла
// ---------------------------------------------------------------------------

test('local хранит смещение относительно узла, global — мировые координаты', () => {
    const l = new Node('particles', {
        amount: 1, burst: [1], lifetime: 5000, speed: 0,
        emitting: false, local: true, seed: 5,
    });
    const g = new Node('particles', {
        amount: 1, burst: [1], lifetime: 5000, speed: 0,
        emitting: false, global: true, seed: 5,
    });
    l.x = 100; l.y = 200;
    g.x = 100; g.y = 200;
    const [wl, wg] = freshWorld(l, g);
    tickParticles(1 / 60);
    const pl = wl.particleAt(0);
    const pg = wg.particleAt(0);
    near(pl.x, 0, 1e-6, 'локальная частица — смещение от узла');
    near(pl.y, 0, 1e-6);
    near(pg.x, 100, 1e-6, 'глобальная частица — мировая координата');
    near(pg.y, 200, 1e-6);
});

test('методы start/stop/emitting/isEmitting/clear/particleAt', () => {
    const n = new Node('particles', {
        amount: 20, max_particles: 50, rate: 1000, lifetime: 5000, speed: 0, seed: 9,
    });
    const [w] = freshWorld(n);
    eq(w.isEmitting(), true, 'по умолчанию эмиссия включена');
    w.stop();
    eq(w.isEmitting(), false);
    w.start();
    eq(w.isEmitting(), true);
    w.emitting(false);
    eq(w.emitting(), false, 'геттер .emitting()');
    w.emitting(true);
    tickParticles(1 / 60);
    truthy(w.count() > 0, 'после старта частицы появились');
    w.clear();
    eq(w.count(), 0);
    eq(w.particleAt(0), null, 'particleAt вне пула — null');
    eq(w.particleAt(-1), null);
});

test('params частично обновляет эмиттер, не трогая живых', () => {
    const n = new Node('particles', {
        amount: 20, max_particles: 50, rate: 1000, lifetime: 5000, speed: [50, 60], seed: 10,
    });
    const [w] = freshWorld(n);
    tickParticles(1 / 60);
    const alive = w.count();
    w.params({ amount: 5, speed: [10, 20] });
    const p = w.params();
    eq(p.amount, 5);
    near(p.speed_min, 10);
    near(p.speed_max, 20);
    eq(w.count(), alive, 'живые частицы не тронуты');
});

test('restart/reset возвращают эмиттер в исходное состояние', () => {
    const n = new Node('particles', {
        one_shot: true, amount: 6, lifetime: 5000, speed: 0, max_particles: 32, seed: 12,
    });
    const [w] = freshWorld(n);
    tickParticles(1 / 60);
    eq(w.count(), 6);
    w.restart();
    eq(w.count(), 0, 'restart очищает пул');
    tickParticles(1 / 60);
    eq(w.count(), 6, 'restart снова даёт залп one_shot');
});

// ---------------------------------------------------------------------------
// Пресеты и создание
// ---------------------------------------------------------------------------

test('$.particles.presets() знает встроенные пресеты', () => {
    const names = $stub.particles.presets();
    for (const want of ['explosion', 'smoke', 'sparks', 'fire', 'rain', 'dust']) {
        truthy(names.indexOf(want) >= 0, 'нет пресета ' + want);
    }
});

test('$.particles.preset() отдаёт копию, перекрываемую spec', () => {
    const base = $stub.particles.preset('fire');
    eq(base.amount, 32);
    const custom = $stub.particles.preset('fire', { amount: 3 });
    eq(custom.amount, 3);
    custom.color_ramp[0].color = '#123456';
    eq($stub.particles.preset('fire').color_ramp[0].color, '#fff6c2', 'пресет не портится копией');
});

test('$.particles.preset() про неизвестное имя не падает', () => {
    const spec = $stub.particles.preset('нет-такого', { amount: 2 });
    eq(spec.amount, 2);
    eq($stub.particles.preset('нет-такого').constructor, Object);
});

test('$.particles.create() создаёт узел <particles>', () => {
    ctx.nodes.length = 0;
    const w = $stub.particles.create({ amount: 3, seed: 1 });
    eq(w.nodes.length, 1);
    eq(w.nodes[0].tag, 'particles');
});

test('конструктор $("<particles>", …) принимает массивы параметров', () => {
    const n = new Node('particles', { speed: [30, 90], size: [4, 8], gravity: [0, 50] });
    const [w] = freshWorld(n);
    const p = w.params();
    near(p.speed_min, 30, 1e-9, 'диапазон speed не превратился в NaN');
    near(p.speed_max, 90);
    near(p.size_min, 4);
    eq(p.gravity.y, 50);
});

finish();
