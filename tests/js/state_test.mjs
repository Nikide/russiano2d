// ===========================================================================
// Юнит-тесты машины состояний (src/highlevel/state.js) без движка.
//
// Проверяем граф (нормализация спецификации, поиск перехода, относительные
// цели, составные состояния), порядок enter/exit, guard'ы и can() без
// побочных эффектов, историю, update и привязку к узлу (.fsm/.fsmSend).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/state_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, joined, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne } from '../../src/highlevel/core.js';
import {
    installState, tickState, createMachine, normalizeStateSpec,
    flatStateNames, findTransition, resolveTransitionTarget, descendToLeaf,
    enterExitPlan, pathHas, stateExists,
} from '../../src/highlevel/state.js';

// $.state ставится на пустой объект: логике машины движок не нужен.
const $ = {};
installState($);

// Node.emit рассылает ещё и глобальные подписки через ctx.$.
ctx.$ = { _dispatchGlobal: () => {} };

function cleanWorld() {
    ctx.nodes.length = 0;
    ctx.byId.clear();
    $.state.clear();
}

// ---------------------------------------------------------------------------
// Чистый граф
// ---------------------------------------------------------------------------

test('normalizeStateSpec: initial по умолчанию — первое состояние', () => {
    const conf = normalizeStateSpec({ states: { idle: {}, run: {} } });
    eq(conf.initial, 'idle');
    eq(conf.history, true);
    truthy(conf.historyLimit > 0);
    eq(joined(flatStateNames(conf.states)), 'idle,run');
    eq(normalizeStateSpec({ initial: 'run', states: { idle: {}, run: {} } }).initial, 'run');
    eq(normalizeStateSpec({ history: false, states: { a: {} } }).history, false);
});

test('normalizeStateSpec бракует опечатки с подсказкой', () => {
    let message = '';
    try { normalizeStateSpec({}); } catch (error) { message = error.message; }
    truthy(message.indexOf('нет поля states') >= 0, message);

    message = '';
    try { normalizeStateSpec({ initial: 'летит', states: { idle: {} } }); } catch (error) { message = error.message; }
    truthy(message.indexOf('нет состояния "летит"') >= 0, message);
    truthy(message.indexOf('idle') >= 0, 'в сообщении есть доступные состояния: ' + message);

    message = '';
    try { normalizeStateSpec({ states: { idle: { on: { jump: 'воздух' } } } }); } catch (error) { message = error.message; }
    truthy(message.indexOf('неизвестное состояние "воздух"') >= 0, message);

    message = '';
    try { normalizeStateSpec({ states: { idle: { on: { jump: { target: 'idle', guard: 5 } } } } }); } catch (error) { message = error.message; }
    truthy(message.indexOf('guard') >= 0, message);

    message = '';
    try { normalizeStateSpec({ states: { air: { initial: 'up', states: { down: {} } } } }); } catch (error) { message = error.message; }
    truthy(message.indexOf('нет состояния "up"') >= 0, message);

    message = '';
    try { normalizeStateSpec({ states: { idle: 'стою' } }); } catch (error) { message = error.message; }
    truthy(message.indexOf('должно быть объектом') >= 0, message);
});

test('чистый граф: поиск перехода вверх, относительные цели, план входа/выхода', () => {
    const states = {
        idle: { on: { jump: 'air' } },
        air: {
            initial: 'up',
            states: { up: { on: { land: 'down' } }, down: { on: { land: 'idle' } } },
        },
    };
    eq(findTransition(states, ['idle'], 'jump').source, 'idle');
    eq(findTransition(states, ['air', 'up'], 'stop'), null, 'событие ищется по активному пути');
    eq(findTransition(states, ['air', 'up'], 'land').source, 'air.up');

    // 'down' из 'air.up' — сосед: цель становится 'air.down'.
    eq(joined(resolveTransitionTarget(states, ['air', 'up'], 'down')), 'air,down');
    eq(joined(resolveTransitionTarget(states, ['idle'], 'air')), 'air');
    eq(joined(descendToLeaf(states, ['air'])), 'air,up', 'вход в родителя входит в initial');

    eq(joined(enterExitPlan(['air', 'up'], ['idle']).exit), 'up,air', 'выход — от листа к корню');
    eq(joined(enterExitPlan(['idle'], ['air', 'down']).enter), 'air,down', 'вход — от корня к листу');
    eq(enterExitPlan(['air', 'up'], ['air', 'down']).common, 1, 'общий предок не выходит');

    truthy(pathHas(['air', 'up'], 'air'));
    truthy(pathHas(['air', 'up'], 'air.up'));
    falsy(pathHas(['air', 'up'], 'idle'));
    truthy(stateExists(states, 'air.down'));
    falsy(stateExists(states, 'air.вниз'));

    const wild = findTransition({ a: { on: { '*': 'b' } }, b: {} }, ['a'], 'что угодно');
    truthy(wild.wildcard, 'ловушка *');
    eq(wild.event, 'что угодно');
});

// ---------------------------------------------------------------------------
// Машина
// ---------------------------------------------------------------------------

test('машина: переход, is/current, неизвестное событие ничего не меняет', () => {
    const m = createMachine({
        initial: 'idle',
        states: { idle: { on: { jump: 'air' } }, air: { on: { land: 'idle' } } },
    });
    eq(m.current(), 'idle');
    truthy(m.is('idle'));
    falsy(m.is('air'));
    truthy(m.send('jump'));
    eq(m.current(), 'air');
    falsy(m.send('jump'), 'в air события jump нет');
    eq(m.current(), 'air', 'неизвестный переход не меняет состояние');
    truthy(m.send('land'));
    eq(m.current(), 'idle');
    eq(joined(m.states()), 'idle,air');
    eq(joined(m.events()), 'jump');
});

test('guard: can() проверяет без побочных эффектов, send() уважает условие', () => {
    let entered = 0;
    let acted = 0;
    const m = createMachine({
        initial: 'idle',
        data: { moving: false },
        states: {
            idle: {
                on: {
                    move: {
                        target: 'run',
                        guard: (mm) => mm.data.moving,
                        action: () => { acted++; },
                    },
                },
            },
            run: { enter: () => { entered++; }, on: { stop: 'idle' } },
        },
    });
    falsy(m.can('move'), 'guard не пропускает');
    falsy(m.send('move'));
    eq(m.current(), 'idle');
    eq(entered, 0);
    eq(acted, 0, 'can() не выполняет action');
    m.data.moving = true;
    truthy(m.can('move'));
    eq(acted, 0, 'can() по-прежнему без побочных эффектов');
    eq(entered, 0, 'can() не входит в состояние');
    truthy(m.send('move'));
    eq(m.current(), 'run');
    eq(entered, 1);
    eq(acted, 1, 'action выполняется до входа в состояние');
});

test('порядок enter/exit и хуки onEnter/onExit', () => {
    const log = [];
    const m = createMachine({
        initial: 'ground',
        states: {
            ground: { enter: () => log.push('ground.enter'), exit: () => log.push('ground.exit') },
            air: {
                initial: 'up',
                enter: () => log.push('air.enter'),
                exit: () => log.push('air.exit'),
                states: {
                    up: { enter: () => log.push('up.enter'), exit: () => log.push('up.exit') },
                    down: { enter: () => log.push('down.enter') },
                },
            },
        },
    });
    eq(joined(log), 'ground.enter', 'стартовое состояние входит сразу');
    // Хуки и имена состояний — всегда полные ('air.up'), как machine.current().
    m.onEnter('air.up', () => log.push('hook:up'));
    m.onEnter('*', (mm, name) => log.push('hook:*:' + name));
    m.onExit('air', () => log.push('hook:exit:air'));

    log.length = 0;
    m.set('air.up');
    eq(joined(log, '|'), 'ground.exit|air.enter|hook:*:air|up.enter|hook:up|hook:*:air.up',
        'вход от корня к листу, хук состояния раньше общего');

    log.length = 0;
    m.set('ground');
    eq(joined(log, '|'), 'up.exit|air.exit|hook:exit:air|ground.enter|hook:*:ground',
        'выход от листа к корню');
});

test('составные состояния: is() видит предка, лист ведёт себя как отдельное состояние', () => {
    const m = createMachine({
        initial: 'idle',
        states: {
            idle: { on: { jump: 'air' } },
            air: { initial: 'up', states: { up: { on: { land: 'down' } }, down: { on: { land: 'idle' } } } },
        },
    });
    truthy(m.send('jump'));
    eq(joined(m.path()), 'air,up');
    eq(m.current(), 'air.up');
    truthy(m.is('air'), 'родитель активен');
    truthy(m.is('air.up'));
    falsy(m.is('air.down'));
    truthy(m.send('land'));
    eq(m.current(), 'air.down', 'относительная цель down разрешилась в air.down');
    truthy(m.send('land'));
    eq(m.current(), 'idle', 'из air.down цель idle абсолютная');
});

test('событие всплывает от листа к родителю', () => {
    const m = createMachine({
        initial: 'air',
        states: {
            air: { initial: 'up', on: { land: 'ground' }, states: { up: {} } },
            ground: { on: { jump: 'air' } },
        },
    });
    eq(m.current(), 'air.up');
    truthy(m.send('land'), 'обработчик родителя сработал из листа');
    eq(m.current(), 'ground');
});

test('ловушка *, динамическая цель и падение guard не роняют машину', () => {
    const m = createMachine({
        initial: 'idle',
        states: {
            idle: {
                on: {
                    go: (mm, data) => (data && data.where) || false,
                    risk: { target: 'run', guard: () => { throw new Error('плохой guard'); } },
                },
            },
            run: { on: { '*': 'idle' } },
        },
    });
    falsy(m.send('go'), 'динамическая цель вернула false — перехода нет');
    eq(m.current(), 'idle');
    truthy(m.send('go', { where: 'run' }));
    eq(m.current(), 'run');
    truthy(m.send('совсем другое событие'), 'ловушка * в run');
    eq(m.current(), 'idle');
    falsy(m.send('risk'), 'guard упал — перехода нет');
    eq(m.current(), 'idle');
});

test('история: history/previous/back и журнал переходов', () => {
    const m = createMachine({
        initial: 'idle',
        states: { idle: { on: { jump: 'air' } }, air: { on: { land: 'idle' } } },
    });
    eq(joined(m.history()), 'idle');
    eq(m.previous(), null, 'до первого перехода предыдущего нет');
    m.send('jump');
    m.send('land');
    eq(joined(m.history()), 'idle,air,idle');
    eq(m.previous(), 'air');
    truthy(m.back());
    eq(m.current(), 'air');
    const journal = m.transitions();
    eq(journal.length, 4, 'журнал включает стартовый вход из null');
    eq(journal[0].from, null);
    eq(journal[0].to, 'idle');
    eq(journal[1].from, 'idle');
    eq(journal[1].to, 'air');
    eq(journal[1].event, 'jump');
    eq(journal[3].event, null, 'back() — переход без события');
});

test('history: false отключает запись истории', () => {
    const m = createMachine({ history: false, initial: 'a', states: { a: { on: { go: 'b' } }, b: {} } });
    m.send('go');
    eq(m.history().length, 0);
    eq(m.previous(), null);
    falsy(m.back());
    eq(m.current(), 'b');
});

test('update зовёт активные состояния от корня к листу, time() считает секунды', () => {
    const log = [];
    const m = createMachine({
        initial: 'air',
        states: {
            air: {
                initial: 'up',
                update: (mm, dt) => log.push('air:' + dt),
                states: { up: { update: (mm, dt) => log.push('up:' + dt) } },
            },
        },
    });
    eq(m.update(0.5), 2);
    eq(joined(log, '|'), 'air:0.5|up:0.5');
    near(m.time(), 0.5);
    near(m.totalTime(), 0.5);
    m.set('air');
    near(m.time(), 0, 1e-9, 'повторный вход в то же состояние сбрасывает время состояния');
    near(m.totalTime(), 0.5, 1e-9);
    let transitions = 0;
    m.onTransition(() => { transitions++; });
    m.set('air');
    eq(transitions, 1, 'onTransition зовётся после перехода');
});

test('set(): самопереход перезапускает состояние, неизвестное имя — ошибка', () => {
    let enters = 0;
    const m = createMachine({ initial: 'idle', states: { idle: { enter: () => { enters++; } } } });
    eq(enters, 1);
    m.set('idle');
    eq(enters, 2, 'повторный вход в то же состояние');
    let message = '';
    try { m.set('летит'); } catch (error) { message = error.message; }
    truthy(message.indexOf('нет состояния "летит"') >= 0, message);
});

// ---------------------------------------------------------------------------
// $.state: реестр, узлы, кадровый шаг
// ---------------------------------------------------------------------------

test('$.state: реестр по имени, destroy и clear', () => {
    cleanWorld();
    const m = $.state.create({ name: 'temp', initial: 'a', states: { a: { on: { go: 'b' } }, b: {} } });
    truthy($.state.list().indexOf(m) >= 0);
    truthy($.state.byName('temp') === m);
    truthy(m.destroy());
    falsy(m.send('go'));
    falsy($.state.byName('temp'));
    falsy(m.destroy(), 'повторное уничтожение — false');
});

test('привязка к узлу: .fsm(), $.state.get/send/is/current и tickState', () => {
    cleanWorld();
    const hero = new Node('player', { id: 'hero' });
    const log = [];
    $.state.create({
        name: 'hero',
        initial: 'idle',
        states: { idle: { update: () => log.push('idle.tick'), on: { jump: 'air' } }, air: {} },
    });
    wrapOne(hero).fsm('hero');
    eq(wrapOne(hero).fsm(), 'idle', 'геттер .fsm() отдаёт лист');
    truthy($.state.get(hero) === $.state.byName('hero'));
    truthy($.state.get('#hero') === $.state.byName('hero'), 'селектор тоже работает');
    truthy($.state.is(hero, 'idle'));
    eq($.state.current('#hero'), 'idle');

    tickState(0.25);
    eq(joined(log), 'idle.tick');

    truthy($.state.send('#hero', 'jump'));
    eq($.state.current(hero), 'air');
    tickState(0.25);
    eq(log.length, 1, 'update зовётся только у активных состояний');

    hero.removed = true;
    tickState(0.1);
    falsy(hero.attrs.fsm, 'машина отвязалась от удалённого узла');
});

test('.fsm({ initial, states }) создаёт машину узлу, .fsmSend шлёт событие', () => {
    cleanWorld();
    const a = new Node('rect', { id: 'a' });
    const b = new Node('rect', { id: 'b' });
    const spec = { initial: 'off', states: { off: { on: { toggle: 'on' } }, on: {} } };
    wrapOne(a).fsm(spec);
    wrapOne(b).fsm(spec);
    truthy($.state.get(a) !== $.state.get(b), 'у каждого узла своя машина');
    wrap([a, b]).fsmSend('toggle');
    eq(wrapOne(a).fsm(), 'on');
    eq(wrapOne(b).fsm(), 'on');
    eq($.state.current(a), 'on');
    eq($.state.can(a, 'toggle'), false, 'из on события toggle нет');
    wrapOne(a).fsm(null);
    falsy($.state.get(a), '.fsm(null) отвязывает машину');
    eq($.state.current(b), 'on', 'соседний узел не тронут');
});

test('$.state.set/can/detach/clear управляют машинами', () => {
    cleanWorld();
    const node = new Node('rect', { id: 'npc' });
    const m = $.state.create({ initial: 'a', states: { a: { on: { go: 'b' } }, b: {} }, node });
    eq($.state.current('#npc'), 'a', 'spec.node привязывает сразу');
    truthy($.state.set('#npc', 'b'));
    eq(m.current(), 'b');
    falsy($.state.can('#npc', 'go'), 'из b события go нет');
    $.state.detach('#npc');
    falsy($.state.get(node));
    eq($.state.list().length, 1);
    $.state.clear();
    eq($.state.list().length, 0);
    falsy(m.alive);
});

test('машина без узла (машина игры) тоже тикает в tickState', () => {
    cleanWorld();
    let ticks = 0;
    const m = $.state.create({
        initial: 'play',
        states: { play: { update: () => { ticks++; } } },
    });
    tickState(0.1);
    tickState(0.1);
    eq(ticks, 2);
    near(m.time(), 0.2);
    near(m.totalTime(), 0.2);
});

test('JSON.stringify машины даёт сводку, а не список методов', () => {
    const m = createMachine({ name: 'mm', initial: 'a', states: { a: { on: { go: 'b' } }, b: {} } });
    m.send('go');
    const text = JSON.stringify(m);
    truthy(text.indexOf('"name":"mm"') >= 0, text);
    truthy(text.indexOf('"current":"b"') >= 0, text);
    eq(JSON.parse(text).current, 'b');
});

finish();
