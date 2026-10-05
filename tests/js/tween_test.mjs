// ===========================================================================
// Юнит-тесты Tween-объектов в духе Godot 4 (create_tween / tween_property /
// chain) — без движка, на чистом qjs.
//
// Проверяем то, что легко сломать: кривые переходов, порядок шагов и chain,
// параллельность по умолчанию, delay, from/fromCurrent/asRelative/
// interpolator, loops, speed, kill/stop, finished, порядок callback/method и
// вложенные пути обычного объекта.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/tween_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { Node, ctx, wrapOne } from '../../src/highlevel/core.js';
import {
    installTween, tickTweenObjects, transitionFunction, transitionNames,
    Tween,
} from '../../src/highlevel/tween.js';

// $.tween ставится на пустой объект: логике движок не нужен, время подаём
// прямо в tickTweenObjects(dt, raw).
const $ = {};
installTween($);

// Узлы ядра рассылают события через ctx.$ — в тесте подставляем заглушку.
ctx.$ = { _dispatchGlobal: () => {} };

/** Гасит все твины прошлого теста, чтобы шаги не пересекались. */
function fresh() {
    for (const t of $.tweens()) t.kill();
}

// --- Чистые переходы (trans × ease) -----------------------------------------

test('transitionFunction: границы 0/1 для всех переходов и плавностей', () => {
    for (const trans of transitionNames()) {
        for (const ease of ['in', 'out', 'in_out', 'out_in']) {
            const f = transitionFunction(trans, ease);
            near(f(0), 0, 1e-9, `${trans}/${ease} в нуле`);
            near(f(1), 1, 1e-9, `${trans}/${ease} в единице`);
            near(f(-5), 0, 1e-9, `${trans}/${ease} левее нуля`);
            near(f(5), 1, 1e-9, `${trans}/${ease} правее единицы`);
            truthy(isFinite(f(0.37)), `${trans}/${ease} конечна`);
        }
    }
});

test('transitionFunction: in/out симметричны, in_out и out_in проходят через 0.5', () => {
    for (const trans of transitionNames()) {
        const fin = transitionFunction(trans, 'in');
        const fout = transitionFunction(trans, 'out');
        const fio = transitionFunction(trans, 'in_out');
        const foi = transitionFunction(trans, 'out_in');
        for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
            near(fout(t), 1 - fin(1 - t), 1e-9, `${trans}: out против in`);
        }
        near(fio(0.5), 0.5, 1e-9, `${trans}: in_out(0.5)`);
        near(foi(0.5), 0.5, 1e-9, `${trans}: out_in(0.5)`);
    }
});

test('transitionFunction: quad/cubic/sine дают ожидаемые значения', () => {
    near(transitionFunction('quad', 'in')(0.5), 0.25);
    near(transitionFunction('quad', 'out')(0.5), 0.75);
    near(transitionFunction('quad', 'in_out')(0.25), 0.125);
    near(transitionFunction('quad', 'out_in')(0.25), 0.375);
    near(transitionFunction('cubic', 'in')(0.5), 0.125);
    near(transitionFunction('sine', 'in')(1), 1);
    near(transitionFunction('linear', 'in')(0.5), 0.5);
    near(transitionFunction('linear', 'out')(0.5), 0.5);
});

test('transitionFunction: короткие синонимы inOut/outIn и неизвестные имена', () => {
    near(transitionFunction('quad', 'inOut')(0.25), transitionFunction('quad', 'in_out')(0.25));
    near(transitionFunction('quad', 'outIn')(0.75), transitionFunction('quad', 'out_in')(0.75));
    // Неизвестный переход — linear, но функция всё равно конечна и в границах.
    const f = transitionFunction('нет-такого', 'in');
    near(f(0.5), 0.5);
    near(transitionFunction('linear', 'нет-такой')(0.5), 0.5);
    // Эластика и пружина перелетают цель в середине — это их смысл.
    truthy(transitionFunction('back', 'out')(0.7) > 1);
    truthy(transitionFunction('elastic', 'out')(0.5) > 1);
    truthy(transitionFunction('spring', 'in')(0.7) > 1);
});

// --- Свойства обычного объекта ----------------------------------------------

test('property двигает числовое поле объекта и доезжает до цели', () => {
    fresh();
    const o = { x: 100 };
    const t = $.tween(o);
    t.property('x', 0, 1);
    tickTweenObjects(0.5, 0.5);
    near(o.x, 50, 1e-6);
    tickTweenObjects(0.5, 0.5);
    near(o.x, 0, 1e-6);
    falsy(t.isRunning());
});

test('вложенный путь a.b пишется и создаёт промежуточные объекты', () => {
    fresh();
    const o = { a: { b: 0 } };
    const t = $.tweenOf(o);
    t.property('a.b', 10, 1);
    tickTweenObjects(1, 1);
    eq(o.a.b, 10);

    fresh();
    const empty = {};
    $.tweenOf(empty).property('nested.deep.value', 3, 0);
    eq(empty.nested.deep.value, 3);
});

test('нулевая длительность первого шага применяется сразу, без кадра', () => {
    fresh();
    const o = { x: 0, y: 0 };
    const t = $.tween(o);
    t.property('x', 7, 0);
    t.property('y', 9, 0);
    eq(o.x, 7);
    eq(o.y, 9);
    // Завершение всё равно приходит на первом тике (успеть подписаться).
    let finished = 0;
    t.on('finished', () => { finished++; });
    tickTweenObjects(1 / 60, 1 / 60);
    eq(finished, 1);
});

test('delay откладывает даже мгновенный (нулевой) tweener', () => {
    fresh();
    const o = { x: 0 };
    $.tweenOf(o).property('x', 10, 0).delay(1);
    eq(o.x, 0, 'до задержки значение не меняется');

    tickTweenObjects(0.5, 0.5);
    eq(o.x, 0, 'через половину задержки всё ещё ноль');

    tickTweenObjects(0.6, 0.6);
    eq(o.x, 10, 'после задержки мгновенное значение применено');
});

// --- Порядок шагов, chain, параллельность -----------------------------------

test('твинеры подряд идут параллельно, chain начинает новый шаг', () => {
    fresh();
    const o = { x: 0, y: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    t.property('y', 10, 1);          // тот же шаг — параллельно
    t.chain().property('x', 20, 1);  // следующий шаг
    tickTweenObjects(1, 1);
    near(o.x, 10, 1e-6);
    near(o.y, 10, 1e-6);
    tickTweenObjects(1, 1);
    near(o.x, 20, 1e-6);
    near(o.y, 10, 1e-6, 'y во втором шаге не трогаем');
});

test('шаг завершается, когда завершились все его твинеры (учитывая delay)', () => {
    fresh();
    const o = { x: 0, y: 0 };
    const t = $.tween(o);
    t.property('x', 100, 1);
    t.property('y', 100, 1).delay(0.5);   // шаг длится 1.5 с
    t.chain().property('x', 0, 0.5);
    tickTweenObjects(1.2, 1.2);
    near(o.x, 100, 1e-6);
    near(o.y, 70, 1e-6);                   // y стартовал с задержкой 0.5 с
    tickTweenObjects(1.0, 1.0);            // 1.2 + 1.0 = 2.2 > 1.5 + 0.5
    near(o.x, 0, 1e-6);
    near(o.y, 100, 1e-6);
});

test('parallel() отменяет только что созданный пустой шаг chain()', () => {
    fresh();
    const o = { x: 0, y: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    t.chain().parallel().property('y', 10, 1);
    tickTweenObjects(1, 1);
    near(o.x, 10, 1e-6);
    near(o.y, 10, 1e-6, 'y должен идти параллельно x');
    eq(t._steps.length, 1);
});

test('delay задерживает старт свойства', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1).delay(0.5);
    tickTweenObjects(0.25, 0.25);
    eq(o.x, 0);
    tickTweenObjects(0.25, 0.25);   // ровно начало
    eq(o.x, 0);
    tickTweenObjects(0.5, 0.5);     // половина пути
    near(o.x, 5, 1e-6);
    tickTweenObjects(0.5, 0.5);
    near(o.x, 10, 1e-6);
});

test('interval — просто пауза между шагами сценария', () => {
    fresh();
    const logs = [];
    const oldLog = ctx.log;
    ctx.log = (message) => { logs.push(String(message)); };
    try {
        const log = [];
        const t = $.tweenOf({});
        t.interval(1);
        t.chain().callback(() => log.push('after'));
        tickTweenObjects(0.9, 0.9);
        eq(log.length, 0);
        tickTweenObjects(0.2, 0.2);
        eq(log.length, 1);
    } finally {
        ctx.log = oldLog;
    }
    eq(logs.length, 0, 'interval не должен ничего писать в журнал');
});

// --- from / fromCurrent / asRelative / interpolator -------------------------

test('from задаёт начальное значение, fromCurrent берёт текущее', () => {
    fresh();
    const o = { x: 100 };
    const t = $.tween(o);
    t.property('x', 0, 1).from(20);
    tickTweenObjects(0.5, 0.5);
    near(o.x, 10, 1e-6);      // 20 → 0 на половине
    tickTweenObjects(0.5, 0.5);
    near(o.x, 0, 1e-6);

    fresh();
    const p = { x: 80 };
    $.tween(p).property('x', 0, 1);
    tickTweenObjects(0.5, 0.5);
    near(p.x, 40, 1e-6);      // от текущего 80
});

test('asRelative считает to как приращение к началу', () => {
    fresh();
    const o = { x: 100 };
    const t = $.tween(o);
    t.property('x', 50, 1).asRelative();
    tickTweenObjects(1, 1);
    near(o.x, 150, 1e-6);
});

test('asRelative работает вместе с from', () => {
    fresh();
    const o = { x: 100 };
    const t = $.tween(o);
    t.property('x', 10, 1).from(0).asRelative();
    tickTweenObjects(1, 1);
    near(o.x, 10, 1e-6);
});

test('interpolator полностью подменяет вычисление значения', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 100, 1).interpolator(() => 42);
    tickTweenObjects(0.5, 0.5);
    eq(o.x, 42);
    tickTweenObjects(0.5, 0.5);
    eq(o.x, 42);
});

test('interpolator получает прогресс уже с плавностью', () => {
    fresh();
    let seen = -1;
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 100, 1).trans('quad').ease('in').interpolator((from, to, k) => {
        seen = k;
        return from + (to - from) * k;
    });
    tickTweenObjects(0.5, 0.5);
    near(seen, 0.25, 1e-9);   // quad in от 0.5
    near(o.x, 25, 1e-6);
});

test('trans/ease на самом Tween — значения по умолчанию для последующих', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.trans('quad').ease('in');
    t.property('x', 100, 1);
    tickTweenObjects(0.5, 0.5);
    near(o.x, 25, 1e-6);
});

// --- loops ------------------------------------------------------------------

test('loops(3) повторяет сценарий, шлёт loop и один finished', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    t.loops(3);
    let loops = 0, steps = 0, finished = 0;
    t.on('loop', () => { loops++; });
    t.on('step', () => { steps++; });
    t.on('finished', () => { finished++; });

    tickTweenObjects(1, 1);
    eq(loops, 1);
    near(o.x, 0, 1e-6, 'второй проход начался с начала');
    tickTweenObjects(1, 1);
    eq(loops, 2);
    tickTweenObjects(1, 1);
    eq(loops, 2, 'на последнем проходе loop уже не шлётся');
    eq(finished, 1);
    eq(steps, 3);
    near(o.x, 10, 1e-6);
    falsy(t.isRunning());
});

test('loops(-1) крутится бесконечно: loop есть, finished никогда', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    t.loops(-1);
    let loops = 0, finished = 0;
    t.on('loop', () => { loops++; });
    t.on('finished', () => { finished++; });
    for (let i = 0; i < 5; i++) tickTweenObjects(1, 1);
    eq(loops, 5);
    eq(finished, 0);
    truthy(t.isRunning());
    t.kill();
});

// --- speed, progress, time --------------------------------------------------

test('speed ускоряет твин, time и progress растут', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 100, 2);
    eq(t.speed(), 1);
    t.speed(2);
    eq(t.speed(), 2);
    tickTweenObjects(0.5, 0.5);          // при скорости 2 это 1 с из 2
    near(o.x, 50, 1e-6);
    near(t.progress(), 0.5, 1e-9);
    eq(t.time(), 1);                     // time() — время сценария с учётом speed
    tickTweenObjects(0.5, 0.5);
    near(o.x, 100, 1e-6);
    near(t.progress(), 1, 1e-9);
});

// --- kill / stop / play -----------------------------------------------------

test('kill делает твин недействительным и НЕ разрешает finished', async () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    let resolved = false;
    t.finished().then(() => { resolved = true; });
    t.kill();
    eq(t.isValid(), false);
    eq(t.isRunning(), false);
    tickTweenObjects(2, 2);
    await null;
    eq(resolved, false, 'после kill finished не приходит');
    falsy(o.x >= 10, 'значение не обязано доехать');
});

test('stop замораживает твин, play продолжает с того же места', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    tickTweenObjects(0.5, 0.5);
    near(o.x, 5, 1e-6);
    t.stop();
    falsy(t.isRunning());
    tickTweenObjects(1, 1);
    near(o.x, 5, 1e-6, 'на stop время не идёт');
    t.play();
    truthy(t.isRunning());
    tickTweenObjects(0.5, 0.5);
    near(o.x, 10, 1e-6);
});

test('pause замораживает, isPaused сообщает состояние', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    t.pause();
    truthy(t.isPaused());
    falsy(t.isRunning());
    tickTweenObjects(1, 1);
    eq(o.x, 0);
    t.play();
    tickTweenObjects(1, 1);
    near(o.x, 10, 1e-6);
});

// --- callback / method ------------------------------------------------------

test('callback и method срабатывают в порядке шагов', () => {
    fresh();
    const log = [];
    const t = $.tweenOf({});
    t.callback(() => log.push('first'));
    t.method((v) => log.push('m' + Math.round(v)), 0, 10, 1);
    t.chain().callback(() => log.push('last'));
    tickTweenObjects(0.5, 0.5);   // промежуточное значение method видно покадрово
    tickTweenObjects(0.5, 0.5);
    eq(log[0], 'first');
    eq(log[log.length - 1], 'last');
    truthy(log.indexOf('m5') > 0, 'method получил промежуточное значение');
    truthy(log.indexOf('m10') > 0, 'method получил конечное значение');
    truthy(log.indexOf('last') > log.indexOf('m10'), 'callback второго шага — после method');
});

test('method вызывает fn(value, t) и t — прогресс с плавностью', () => {
    fresh();
    let lastT = -1;
    const t = $.tweenOf({});
    t.method((v, k) => { lastT = k; }, 0, 10, 1);
    tickTweenObjects(0.5, 0.5);
    near(lastT, 0.5, 1e-9);
});

test('method с fn(value) без второго аргумента не падает', () => {
    fresh();
    let seen = null;
    const t = $.tweenOf({});
    t.method((v) => { seen = v; }, 0, 4, 1);
    tickTweenObjects(1, 1);
    near(seen, 4, 1e-6);
});

test('callback с delay не срабатывает раньше времени', () => {
    fresh();
    let fired = 0;
    const t = $.tweenOf({});
    t.callback(() => { fired++; }).delaySeconds(1);
    tickTweenObjects(0.5, 0.5);
    eq(fired, 0);
    tickTweenObjects(0.5, 0.5);
    eq(fired, 1);
});

// --- цели-узлы --------------------------------------------------------------

test('целью может быть узел: x, alpha, scale, value и произвольный атрибут', () => {
    fresh();
    const node = new Node('rect', { id: 'twin-target' });
    node.x = 0;
    const t = $.tween(node);
    t.property('x', 100, 1);
    t.property('alpha', 0, 1);
    t.property('scale', 2, 1);
    t.property('value', 5, 1);
    t.property('custom', 7, 1);
    tickTweenObjects(1, 1);
    near(node.x, 100, 1e-6);
    near(node.alpha, 0, 1e-6);
    near(node.scale_x, 2, 1e-6);
    near(node.scale_y, 2, 1e-6);
    near(node.value, 5, 1e-6);
    near(node.attrs.custom, 7, 1e-6);
});

test('целью может быть селектор и обёртка', () => {
    fresh();
    const node = new Node('rect', { id: 'selector-target' });
    node.x = 0;
    const t = $.tween('#selector-target');
    t.property('x', 30, 1);
    tickTweenObjects(1, 1);
    near(node.x, 30, 1e-6);

    fresh();
    const other = new Node('rect', { id: 'wrapper-target' });
    other.y = 0;
    $.tween(wrapOne(other)).property('y', 40, 1);
    tickTweenObjects(1, 1);
    near(other.y, 40, 1e-6);
});

test('bind убивает твин, когда узел удалён или убит', () => {
    fresh();
    const node = new Node('rect', { id: 'bound-target' });
    node.max_hp = 10;
    node.cur_hp = 10;
    const t = $.tween(node);
    t.property('x', 50, 5);
    t.bind(node);
    node.cur_hp = 0;                       // .kill() у узла
    tickTweenObjects(1 / 60, 1 / 60);
    falsy(t.isValid());
    falsy(t.isRunning());
});

test('твин на удалённом узле снимается сам', () => {
    fresh();
    const node = new Node('rect', { id: 'removed-target' });
    const t = $.tween(node);
    t.property('x', 50, 5);
    node.removed = true;
    tickTweenObjects(1 / 60, 1 / 60);
    falsy(t.isValid());
});

// --- ignoreTimeScale, реестр, ошибки ---------------------------------------

test('ignoreTimeScale(true) идёт по реальному кадру, когда игровое время стоит', () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 100, 1).trans('linear');
    t.ignoreTimeScale(true);
    // dt = 0 (пауза времени), но raw = 0.5 — твин обязан продвинуться.
    tickTweenObjects(0, 0.5);
    near(o.x, 50, 1e-6);
});

test('$.tween.active() и $.tweens() видят живые твины', () => {
    fresh();
    const before = $.tween.active();
    const t = $.tweenOf({ x: 0 });
    t.property('x', 1, 1);
    eq($.tween.active(), before + 1);
    truthy($.tweens().indexOf(t) >= 0);
    t.kill();
    tickTweenObjects(1 / 60, 1 / 60);
    eq($.tween.active(), before);
});

test('ошибка в callback/method/interpolator ловится и уходит в ctx.log', () => {
    fresh();
    const logs = [];
    const oldLog = ctx.log;
    ctx.log = (message) => { logs.push(String(message)); };
    try {
        const o = { x: 0 };
        const t = $.tween(o);
        t.property('x', 1, 1).interpolator(() => { throw new Error('бум-interp'); });
        t.callback(() => { throw new Error('бум-callback'); });
        t.method(() => { throw new Error('бум-method'); }, 0, 1, 1);
        tickTweenObjects(1, 1);
    } finally {
        ctx.log = oldLog;
    }
    truthy(logs.some((m) => m.indexOf('interpolator') >= 0), 'interpolator залогирован');
    truthy(logs.some((m) => m.indexOf('callback') >= 0), 'callback залогирован');
    truthy(logs.some((m) => m.indexOf('method') >= 0), 'method залогирован');
    truthy(logs.every((m) => m.indexOf('$:') === 0), 'стиль сообщений "$: …"');
});

// --- finished() как Promise -------------------------------------------------

test('finished() разрешается по завершении', async () => {
    fresh();
    const o = { x: 0 };
    const t = $.tween(o);
    t.property('x', 10, 1);
    let resolved = false;
    t.finished().then(() => { resolved = true; });
    tickTweenObjects(1, 1);
    await null;
    await null;
    truthy(resolved, 'Promise finished() должен разрешиться');
});

test('finished() на уже завершённом твине разрешается сразу', async () => {
    fresh();
    const t = $.tweenOf({ x: 0 });
    t.property('x', 1, 1);
    tickTweenObjects(1, 1);
    const value = await t.finished();
    eq(value, t);
});

finish();
