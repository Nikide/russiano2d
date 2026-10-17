// ===========================================================================
// Юнит-тесты экранного viewmodel-хелпера (src/highlevel/re2d_viewmodel.js).
//
// Движок не нужен: помощник двигает обычный узел через `.at/.size/.frame`,
// поэтому проверяется весь контракт без нативного ядра — клипы и маркеры,
// отдача, bob по скорости, sway по мыши, затухания, детерминизм и отказ
// неверных опций. `engine.re2d` ставится минимальной заглушкой только чтобы
// createApi() установил RE2D-семейство (как tests/js/re2d_test.mjs).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/re2d_viewmodel_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createApi } from '../../src/highlevel/api.js';
import { installRe2dViewmodel } from '../../src/highlevel/re2d_viewmodel.js';

engine.re2d = { view: () => true };
const $ = createApi();

// Узел, у которого помощник видит только три метода и поля базовой раскладки.
function fakeNode(x = 100, y = 200, w = 80, h = 60) {
    const node = {
        x, y, w, h, frameValue: -1,
        atCalls: 0, sizeCalls: 0, frameCalls: 0,
        get(index) { return index === 0 ? node : undefined; },
        at(nx, ny) { node.x = nx; node.y = ny; node.atCalls++; return node; },
        size(nw, nh) { node.w = nw; node.h = nh; node.sizeCalls++; return node; },
        frame(index) { node.frameValue = index; node.frameCalls++; return node; },
    };
    return node;
}

function options(extra = {}) {
    return {
        clips: {
            idle: { frames: [0], ms: 100, loop: true },
            fire: { frames: [1, 2, 3, 0], ms: [25, 30, 25, 20], loop: false, events: { 1: 'fire' } },
        },
        ...extra,
    };
}

function make(extra = {}) {
    const node = extra.node || fakeNode();
    const vm = $.re2dViewmodel(options({ node }));
    return { node, vm };
}

function throws(kind, fn, message) {
    let caught = null;
    try { fn(); } catch (error) { caught = error; }
    truthy(caught, message + ' — ожидалось исключение');
    truthy(caught instanceof kind, message + ' — ожидался ' + kind.name + ', получено ' + caught);
}

test('стартовый idle: раскладка из node.get(0), кадр 0 и чистое состояние', () => {
    const { node, vm } = make();
    eq(node.x + ',' + node.y + ',' + node.w + ',' + node.h, '100,200,80,60', 'базовая раскладка из узла');
    eq(node.frameValue, 0, 'кадр idle применён сразу');
    const state = vm.state();
    eq(state.clip, 'idle', 'клип по умолчанию — idle');
    eq(state.frame, 0, 'логический кадр 0');
    falsy(state.ended, 'idle не закончен');
    eq(state.recoil, 0, 'отдачи нет');
    eq(state.bob, 0, 'bob в покое');
    eq(state.sway.x + ',' + state.sway.y, '0,0', 'sway в покое');
    eq(state.shake, 0, 'тряски нет');
});

test('fire: кадры идут по своим ms, маркер срабатывает ровно один раз', () => {
    const { node, vm } = make();
    const fired = [], ends = [];
    vm.on('fire', () => fired.push(vm.state().frame));
    vm.on('end', () => ends.push(vm.state().frame));
    vm.play('fire');
    eq(node.frameValue, 1, 'play сразу ставит первый кадр клипа');

    vm.update(0.026);                       // 26 мс > 25 мс кадра 0
    eq(vm.state().frame, 1, 'перешли на кадр 1');
    eq(node.frameValue, 2, 'узлу отдан frames[1]');
    eq(fired.length, 1, 'маркер frame 1 сработал один раз');
    eq(fired[0], 1, 'маркер видит новый логический кадр');

    vm.update(0.028);                       // 1 + 28 = 29 мс < 30 — кадр тот же
    eq(vm.state().frame, 1, 'внутри кадра 1');
    eq(fired.length, 1, 'повторного маркера нет');

    vm.update(0.001);                       // 30 мс — ровно длительность
    eq(vm.state().frame, 2, 'перешли на кадр 2');
    eq(node.frameValue, 3, 'frames[2]');

    vm.update(0.025);
    eq(node.frameValue, 0, 'frames[3]');
    vm.update(0.020);                       // последний кадр доигран
    truthy(vm.state().ended, 'нецикличный клип закончился');
    eq(node.frameValue, 0, 'последний кадр остался на узле');
    eq(ends.length, 1, 'end сработал один раз');
    vm.update(0.5);
    eq(ends.length, 1, 'после конца end не повторяется');
});

test('play перезапускает клип с первого кадра', () => {
    const { node, vm } = make();
    let fired = 0;
    vm.on('fire', () => fired++);
    vm.play('fire');
    vm.update(0.03);                        // 30 мс: кадр 0 (25) + 5 мс кадра 1
    eq(vm.state().frame, 1, 'дошли до кадра 1');
    eq(fired, 1, 'маркер один');
    vm.play('fire');
    eq(vm.state().frame, 0, 'логический кадр сброшен');
    falsy(vm.state().ended, 'ended сброшен');
    eq(node.frameValue, 1, 'первый кадр клипа снова на узле');
    vm.update(0.026);
    eq(vm.state().frame, 1, 'после рестарта кадр 1 снова достигнут');
    eq(fired, 2, 'маркер сработал у нового проигрывания');
});

test('отдача затухает до нуля и возвращает узел на место', () => {
    const { node, vm } = make();
    vm.recoil(1);
    near(vm.state().recoil, 1, 1e-12, 'импульс = 1');
    vm.update(0.05);
    truthy(vm.state().recoil > 0 && vm.state().recoil < 1, 'после кадра отдача меньше импульса');
    truthy(node.y > 200, 'отдача сдвигает узел вниз (back > up)');
    for (let i = 0; i < 100; i++) vm.update(0.05);   // 5 секунд
    eq(vm.state().recoil, 0, 'отдача обнулилась');
    near(node.y, 200, 1e-9, 'узел вернулся в базовую точку');
    near(node.x, 100, 1e-9, 'x не уехал');
});

test('bob растёт от скорости и возвращается в покой', () => {
    const { node, vm } = make();
    vm.speed(400);
    for (let i = 0; i < 40; i++) vm.update(0.05);    // 2 секунды
    truthy(vm.state().bob > 2.9 && vm.state().bob <= 3 + 1e-9, 'амплитуда вышла на bob.amp: ' + vm.state().bob);
    eq(vm.speed(), 400, 'speed() без аргумента — геттер');
    vm.speed(0);
    for (let i = 0; i < 40; i++) vm.update(0.05);
    truthy(vm.state().bob < 1e-6, 'на нуле скорости bob сел в ноль: ' + vm.state().bob);
    near(node.y, 200, 1e-9, 'узел вернулся в покой');
});

test('sway идёт за дельтой мыши и успокаивается', () => {
    const { vm } = make();
    vm.look(10, -5);
    for (let i = 0; i < 10; i++) vm.update(0.016);
    truthy(Math.abs(vm.state().sway.x) > 0.5, 'sway сдвинулся по x: ' + vm.state().sway.x);
    truthy(Math.abs(vm.state().sway.y) > 0.2, 'sway сдвинулся по y: ' + vm.state().sway.y);
    for (let i = 0; i < 400; i++) vm.update(0.05);   // 20 секунд
    eq(vm.state().sway.x + ',' + vm.state().sway.y, '0,0', 'sway успокоился точно в ноль');
});

test('неверные опции отклоняются TypeError/RangeError', () => {
    throws(TypeError, () => $.re2dViewmodel(), 'нет опций');
    throws(TypeError, () => $.re2dViewmodel({ clips: { idle: { frames: [0], ms: 100 } } }), 'нет node');
    throws(TypeError, () => $.re2dViewmodel({ node: {}, clips: { idle: { frames: [0], ms: 100 } } }), 'у узла нет at/size/frame');
    throws(RangeError, () => $.re2dViewmodel({ node: fakeNode(), clips: {} }), 'пустой clips');
    throws(RangeError, () => $.re2dViewmodel({ node: fakeNode(), clips: { idle: { frames: [], ms: 100 } } }), 'пустые frames');
    throws(RangeError, () => $.re2dViewmodel({ node: fakeNode(), clips: { idle: { frames: [0], ms: [] } } }), 'ms не той длины');
    throws(RangeError, () => $.re2dViewmodel({ node: fakeNode(), base: { x: 0, y: 0, w: 10, h: 10 }, clips: { idle: { frames: [0], ms: 100, events: { 3: 'fire' } } } }), 'маркер вне кадров');
    throws(TypeError, () => $.re2dViewmodel({ node: fakeNode(), base: { x: NaN, y: 0, w: 10, h: 10 }, clips: { idle: { frames: [0], ms: 100 } } }), 'нечисловой base.x');
    throws(RangeError, () => $.re2dViewmodel({ node: fakeNode(), recoil: { back: -1 }, clips: { idle: { frames: [0], ms: 100 } } }), 'отрицательная отдача');
    const { vm } = make();
    throws(RangeError, () => vm.play('missing'), 'неизвестный клип');
    throws(TypeError, () => vm.look(NaN, 0), 'нечисловая дельта мыши');
    throws(RangeError, () => vm.recoil(-1), 'отрицательный импульс');
});

test('update(0) и отрицательный dt — честный no-op', () => {
    const { node, vm } = make();
    const before = node.atCalls + ',' + node.sizeCalls + ',' + node.frameCalls;
    const state = JSON.stringify(vm.state());
    vm.update(0);
    vm.update(-1);
    eq(node.atCalls + ',' + node.sizeCalls + ',' + node.frameCalls, before, 'ни одного вызова узла');
    eq(JSON.stringify(vm.state()), state, 'состояние не изменилось');
});

test('детерминизм: одинаковый ввод даёт одинаковые состояния и позы', () => {
    function run() {
        const { node, vm } = make();
        vm.play('fire').recoil(1).shake(2).look(5, -3).speed(230);
        const out = [];
        for (let i = 0; i < 60; i++) {
            vm.update(0.016);
            const s = vm.state();
            out.push([s.clip, s.frame, s.ended, s.recoil, s.bob, s.sway.x, s.sway.y, s.shake,
                node.x, node.y, node.frameValue].join(','));
        }
        return out.join(';');
    }
    eq(run(), run(), 'два независимых прогона совпали');
});

test('камера-чувства: чистая арифметика $.re2dFeel без владения камерой', () => {
    const r = $.re2dFeel.recoil(1);
    eq(r.back + ',' + r.up, '8,6', 'импульс отдачи по умолчанию');
    near($.re2dFeel.shake(2), 12, 1e-12, 'shake × amp');
    near($.re2dFeel.fov(0.5), 3, 1e-12, 'fov kick × сила');
    near($.re2dFeel.decay(1, 14, 0), 1, 1e-12, 'dt=0 — без затухания');
    truthy($.re2dFeel.decay(1, 14, 1) === $.re2dFeel.decay(1, 14, 0.25), 'dt зажат в 0.25');
    truthy($.re2dFeel.decay(1, 14, 0.25) < 0.05, 'заметное затухание за 0.25 с');
});

test('модуль ставится без engine: только $ и три метода узла', () => {
    const fake$ = {};
    installRe2dViewmodel(fake$);
    truthy(typeof fake$.re2dViewmodel === 'function', '$.re2dViewmodel установлен');
    truthy(fake$.re2dFeel && typeof fake$.re2dFeel.shake === 'function', '$.re2dFeel установлен');
    const node = fakeNode(10, 20, 30, 40);
    const vm = fake$.re2dViewmodel({ node, clips: { idle: { frames: [0], ms: 100, loop: true } } });
    eq(node.x + ',' + node.y + ',' + node.w + ',' + node.h + ',' + node.frameValue, '10,20,30,40,0', 'узел двигается без движка');
    eq(vm.state().clip, 'idle', 'состояние доступно');
});

finish();
