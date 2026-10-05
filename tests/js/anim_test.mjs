// ===========================================================================
// Юнит-тесты подсистемы анимации ($.anim) без движка.
//
// Проверяем ровно то, что легко сломать: интерполяцию ключей, плавности,
// режимы once/loop/pingpong, события в процентах клипа, скорость, цепочные
// методы узла и переходы машины состояний по условию и по событию.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/anim_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { Node, wrapOne, ctx } from '../../src/highlevel/core.js';
import {
    installAnim, tickAnim,
    chooseEase, sampleKeys, clipPhase, eventsBetween, evalClip,
    normalizeKeys, normalizeClip, animEases,
} from '../../src/highlevel/anim.js';

// $.anim ставится на пустой объект: подсистеме для логики движок не нужен.
const $ = {};
installAnim($);

// Node.emit() в ядре рассылает ещё и глобальные подписки через ctx.$;
// в реальном движке $ уже создан, в юнит-тесте подставляем заглушку.
ctx.$ = { _dispatchGlobal: () => {} };

/** Свежий узел под тест: свои клипы и своя обёртка. */
function makeNode(tag, attrs) {
    const node = new Node(tag || 'rect', attrs || {});
    return { node, w: wrapOne(node) };
}

// --- Чистые функции ---------------------------------------------------------

test('sampleKeys линейно интерполирует между ключами', () => {
    const keys = normalizeKeys([{ t: 0, v: 0 }, { t: 1, v: 100 }]);
    near(sampleKeys(keys, 0), 0);
    near(sampleKeys(keys, 0.5), 50);
    near(sampleKeys(keys, 1), 100);
});

test('sampleKeys зажимает t за границами диапазона', () => {
    const keys = normalizeKeys([{ t: 0.25, v: 10 }, { t: 0.75, v: 20 }]);
    near(sampleKeys(keys, -3), 10);
    near(sampleKeys(keys, 9), 20);
    near(sampleKeys(keys, 0.5), 15);
});

test('sampleKeys учитывает промежуточные ключи', () => {
    const keys = normalizeKeys([{ t: 0, v: 0 }, { t: 0.5, v: 100 }, { t: 1, v: 0 }]);
    near(sampleKeys(keys, 0.25), 50);
    near(sampleKeys(keys, 0.75), 50);
    near(sampleKeys(keys, 0.5), 100);
});

test('sampleKeys понимает короткие имена плавностей (quadIn/quadOut)', () => {
    const quadIn = normalizeKeys([{ t: 0, v: 0 }, { t: 1, v: 100, ease: 'quadIn' }]);
    near(sampleKeys(quadIn, 0.5), 25);
    const quadOut = normalizeKeys([{ t: 0, v: 0 }, { t: 1, v: 100, ease: 'quadOut' }]);
    near(sampleKeys(quadOut, 0.5), 75);
    near(chooseEase('quadIn')(0.5), 0.25);
    near(chooseEase('linear')(0.5), 0.5);
});

test('sampleKeys берёт ease с левого ключа, если у правого его нет', () => {
    const keys = normalizeKeys([{ t: 0, v: 0, ease: 'quadIn' }, { t: 1, v: 100 }]);
    near(sampleKeys(keys, 0.5), 25);
});

test('animEases содержит и короткие, и длинные имена', () => {
    const names = animEases();
    truthy(names.indexOf('quadIn') >= 0, 'нет quadIn');
    truthy(names.indexOf('easeInQuad') >= 0, 'нет easeInQuad');
    truthy(names.indexOf('linear') >= 0, 'нет linear');
});

// --- Фаза и режимы ----------------------------------------------------------

test('clipPhase: once упирается в 1, loop повторяется, pingpong ходит туда-обратно', () => {
    near(clipPhase(0.25, 'once'), 0.25);
    eq(clipPhase(1.5, 'once'), 1);
    near(clipPhase(1.25, 'loop'), 0.25);
    near(clipPhase(3.75, 'loop'), 0.75);
    near(clipPhase(0.5, 'pingpong'), 0.5);
    near(clipPhase(1.5, 'pingpong'), 0.5);
    near(clipPhase(2, 'pingpong'), 0);
    near(clipPhase(2.25, 'pingpong'), 0.25);
});

test('eventsBetween находит событие в интервале и повторяет его каждый цикл', () => {
    const events = [{ at: 0.5, name: 'hit' }];
    eq(eventsBetween(events, 0.4, 0.6).length, 1);
    eq(eventsBetween(events, 0.6, 0.9).length, 0);
    eq(eventsBetween(events, 0.9, 1.6).length, 1);
    eq(eventsBetween(events, 1.6, 2.4).length, 0);
});

test('evalClip считает прогресс, конец и значения свойств', () => {
    const clip = normalizeClip('probe', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ prop: 'x', keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }] }],
    });
    const state = evalClip(clip, 500);
    near(state.phase, 0.5);
    falsy(state.done);
    near(state.values.x, 5);

    const once = normalizeClip('once-probe', {
        duration: 1000,
        tracks: [{ prop: 'y', keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }] }],
    });
    const finished = evalClip(once, 1500);
    truthy(finished.done);
    eq(finished.phase, 1);
    near(finished.values.y, 10);
});

test('normalizeClip отвергает клип без duration и с плохим loop', () => {
    let threw = false;
    try { normalizeClip('bad', { tracks: [] }); } catch (e) { threw = true; }
    truthy(threw, 'клип без duration должен падать');

    threw = false;
    try { normalizeClip('bad', { duration: 100, loop: 'backwards' }); } catch (e) { threw = true; }
    truthy(threw, 'неизвестный loop должен падать');
});

// --- Воспроизведение на узле ------------------------------------------------

test('playClip применяет нулевой кадр и продвигается по tickAnim', () => {
    $.anim.define('move', {
        duration: 1000,
        tracks: [{ prop: 'x', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }],
    });
    const { node, w } = makeNode('rect');
    w.playClip('move');
    truthy(w.isPlayingClip());
    eq(node.x, 0);
    tickAnim(0.5);
    near(node.x, 50, 0.001);
    near(w.clipProgress(), 0.5, 0.001);
    near(w.clipTime(), 500, 0.001);
    w.stopClip();
    falsy(w.isPlayingClip());
});

test('playClip без restart не сбрасывает уже играющий клип', () => {
    $.anim.define('cont', {
        duration: 1000,
        tracks: [{ prop: 'y', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }],
    });
    const { node, w } = makeNode('rect');
    w.playClip('cont');
    tickAnim(0.25);
    near(node.y, 25, 0.001);
    w.playClip('cont');
    near(node.y, 25, 0.001);

    w.playClip('cont', { restart: true });
    near(node.y, 0, 0.001);
    w.stopClip();
});

test('once завершается, шлёт clipEnd и дёргает onEnd', () => {
    $.anim.define('fade', {
        duration: 100,
        loop: 'once',
        tracks: [{ prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] }],
    });
    const { node, w } = makeNode('sprite');
    let ended = 0;
    let callback = 0;
    node.on('clipEnd', () => { ended++; });
    w.playClip('fade', { onEnd: () => { callback++; } });

    tickAnim(0.05);
    near(node.alpha, 0.5, 0.001);
    eq(ended, 0);
    tickAnim(0.06);
    eq(ended, 1);
    eq(callback, 1);
    falsy(w.isPlayingClip());
    near(node.alpha, 0, 1e-9);
    near(w.clipProgress(), 1);
});

test('loop повторяется, удерживая узел играющим', () => {
    $.anim.define('spin', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ prop: 'angle', keys: [{ t: 0, v: 0 }, { t: 1, v: 6 }] }],
    });
    const { node, w } = makeNode('rect');
    w.playClip('spin');
    tickAnim(1.25);
    near(node.angle, 1.5, 0.001);
    truthy(w.isPlayingClip());
    w.stopClip();
});

test('pingpong идёт вперёд и обратно', () => {
    $.anim.define('pulse', {
        duration: 1000,
        loop: 'pingpong',
        tracks: [{ prop: 'scale_x', keys: [{ t: 0, v: 1 }, { t: 1, v: 2 }] }],
    });
    const { node, w } = makeNode('rect');
    w.playClip('pulse');
    tickAnim(0.5);
    near(node.scale_x, 1.5, 0.001);
    tickAnim(1.0);              // u = 1.5 → фаза 0.5 на обратном ходу
    near(node.scale_x, 1.5, 0.001);
    tickAnim(0.5);              // u = 2.0 → фаза 0
    near(node.scale_x, 1, 0.001);
    w.stopClip();
});

test('pauseClip/resumeClip останавливают и продолжают время', () => {
    $.anim.define('pause-probe', {
        duration: 1000,
        tracks: [{ prop: 'x', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }],
    });
    const { node, w } = makeNode('rect');
    w.playClip('pause-probe');
    tickAnim(0.25);
    w.pauseClip();
    tickAnim(0.5);
    near(node.x, 25, 0.001);
    truthy(w.isPlayingClip());
    w.resumeClip();
    tickAnim(0.25);
    near(node.x, 50, 0.001);
    w.stopClip();
});

test('clipSpeed ускоряет и замедляет клип', () => {
    $.anim.define('fast', {
        duration: 1000,
        tracks: [{ prop: 'y', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }],
    });
    const { node, w } = makeNode('rect');
    w.playClip('fast');
    w.clipSpeed(2);
    eq(w.clipSpeed(), 2);
    tickAnim(0.25);              // 500 мс клипа при скорости 2
    near(node.y, 50, 0.001);
    w.stopClip();
});

test('события клипа приходят в процентах и рассылаются как key', () => {
    $.anim.define('hit', {
        duration: 1000,
        tracks: [],
        events: [{ at: 0.5, name: 'impact', data: { power: 7 } }],
    });
    const { node, w } = makeNode('rect');
    const keys = [];
    const named = [];
    node.on('key', (e) => keys.push(e.data));
    node.on('impact', (e) => named.push(e.data));
    w.playClip('hit');
    tickAnim(0.4);
    eq(keys.length, 0);
    tickAnim(0.2);
    eq(keys.length, 1);
    eq(keys[0].name, 'impact');
    eq(keys[0].data.power, 7);
    near(keys[0].at, 0.5, 1e-9);
    eq(named.length, 1);
    w.stopClip();
});

test('событие at: 0 срабатывает сразу при playClip', () => {
    $.anim.define('boot', {
        duration: 1000,
        tracks: [],
        events: [{ at: 0, name: 'booted' }],
    });
    const { node, w } = makeNode('rect');
    let fired = 0;
    node.on('booted', () => { fired++; });
    w.playClip('boot');
    eq(fired, 1);
    w.stopClip();
});

test('дорожка fn получает узел и прогресс', () => {
    let seen = -1;
    $.anim.define('fnclip', {
        duration: 1000,
        tracks: [{ fn: (node, k) => { seen = k; } }],
    });
    const { w } = makeNode('rect');
    w.playClip('fnclip');
    tickAnim(0.25);
    near(seen, 0.25, 0.001);
    w.stopClip();
});

test('дорожка anim выбирает кадр спрайт-листа по прогрессу', () => {
    $.anim.define('sheet', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ anim: true }],
    });
    const { node, w } = makeNode('sprite');
    node.frames = [10, 11, 12, 13];
    w.playClip('sheet');
    eq(node.sprite, 10);
    tickAnim(0.5);
    eq(node.sprite, 12);
    w.stopClip();
});

test('неизвестный клип не роняет вызов и не включает воспроизведение', () => {
    const { w } = makeNode('rect');
    w.playClip('нет-такого');
    falsy(w.isPlayingClip());
});

// --- Машина состояний -------------------------------------------------------

test('stateMachine стартует с initial и переходит по when', () => {
    $.anim.define('idle-clip', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1, v: 1 }] }],
    });
    $.anim.define('walk-clip', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ prop: 'alpha', keys: [{ t: 0, v: 0.5 }, { t: 1, v: 0.5 }] }],
    });
    const { node, w } = makeNode('rect');
    node.attrs.moving = false;
    const entered = [];
    const exited = [];
    node.on('stateEnter', (e) => entered.push(e.data.state));
    node.on('stateExit', (e) => exited.push(e.data.state));

    w.stateMachine({
        initial: 'idle',
        states: { idle: { clip: 'idle-clip' }, walk: { clip: 'walk-clip' } },
        transitions: [{ from: 'idle', to: 'walk', when: (n) => n.attrs.moving === true }],
    });
    eq(w.state(), 'idle');
    eq(entered.length, 1);
    eq(entered[0], 'idle');
    eq(w.states().length, 2);

    node.attrs.moving = true;
    tickAnim(0.1);
    eq(w.state(), 'walk');
    eq(exited[0], 'idle');
    eq(entered[1], 'walk');
    tickAnim(0.1);
    truthy(w.stateTime() > 0, 'время состояния должно идти');

    w.toState('idle');
    eq(w.state(), 'idle');
    eq(entered.length, 3);
});

test('stateMachine переходит по событию on', () => {
    const { node, w } = makeNode('rect');
    w.stateMachine({
        initial: 'a',
        states: { a: { clip: 'idle-clip' }, b: { clip: 'walk-clip' } },
        transitions: [{ from: 'a', to: 'b', on: 'hurt' }],
    });
    eq(w.state(), 'a');
    node.emit('hurt', {});
    tickAnim(1 / 60);
    eq(w.state(), 'b');
});

test('состояние с next уходит дальше, когда клип доиграл', () => {
    $.anim.define('short-clip', {
        duration: 100,
        loop: 'once',
        tracks: [{ prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] }],
    });
    $.anim.define('long-clip', {
        duration: 100,
        loop: 'loop',
        tracks: [{ prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1, v: 1 }] }],
    });
    const { w } = makeNode('rect');
    w.stateMachine({
        initial: 'one',
        states: { one: { clip: 'short-clip', next: 'two' }, two: { clip: 'long-clip' } },
    });
    eq(w.state(), 'one');
    tickAnim(0.2);
    eq(w.state(), 'two');
});

test('toState без машины не падает', () => {
    const { w } = makeNode('rect');
    w.toState('куда-то');
    eq(w.state(), null);
});

// --- Реестр клипов ----------------------------------------------------------

test('реестр $.anim: define/get/has/list/remove/clear', () => {
    $.anim.define('registry-probe', { duration: 100, tracks: [] });
    truthy($.anim.has('registry-probe'));
    eq($.anim.get('registry-probe').duration, 100);
    truthy($.anim.list().indexOf('registry-probe') >= 0);
    eq($.anim.get('registry-missing'), null);
    truthy($.anim.remove('registry-probe'));
    falsy($.anim.has('registry-probe'));

    // ctx.nodes жив, значит подсистема действительно работала с миром.
    truthy(ctx.nodes.length > 0);
});

finish();
