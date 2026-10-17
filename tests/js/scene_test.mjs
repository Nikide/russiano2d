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
import { installScene, tickLifecycle } from '../../src/highlevel/scene.js';

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

test('load(name, { ms: 0 }) переключает мгновенно', () => {
    scene.load('b', { ms: 0 });
    scene._tick(0);                 // перехода ждать не нужно
    eq(scene.current(), 'b');
    falsy(scene.busy(), 'перехода нет');
});

// --- §5: области владения (scope) -------------------------------------------

/** Узел, созданный «в игре»: api.js зовёт ctx.scopeTrack после new Node. */
function spawn(tag, scope) {
    const prev = ctx.scope_current;
    if (scope) ctx.scope_current = scope;
    const node = new Node(tag || 'rect');
    ctx.scopeTrack(node);
    ctx.scope_current = prev;
    return node;
}

/** Довести переходы и безопасную фазу до конца, чтобы тесты не влияли друг на друга. */
function settle() {
    scene._state.transition = null;
    scene._tick(0);
    tickLifecycle(0);
}

function liveTag(tag) {
    let count = 0;
    for (const node of ctx.nodes) if (!node.removed && node.tag === tag) count++;
    return count;
}

test('scope: active → closing → closed, узлы удаляются в безопасной фазе', () => {
    const room = scene.scope('room:states');
    eq(room.state(), 'active');
    const a = spawn('sprite', room);
    const b = spawn('sprite', room);
    eq(room.counts().nodes, 2, 'два узла под владением');

    room.close();
    eq(room.state(), 'closing', 'close переводит в closing');
    falsy(a.removed, 'в closing узлы ещё живы (безопасная фаза не наступила)');
    eq(tickLifecycle(0), 1, 'безопасная фаза закрыла область');
    eq(room.state(), 'closed');
    truthy(a.removed, 'узел a удалён');
    truthy(b.removed, 'узел b удалён');
    eq(scene.scopeOf('room:states'), null, 'закрытая область убрана из реестра');
});

test('scope: closing запрещает новые ресурсы и узлы', () => {
    const room = scene.scope('room:closing');
    room.close();
    const late = spawn('sprite', room);
    truthy(late.removed, 'узел не принят и сразу освобождён — не остался забытым');
    eq(room.counts().nodes, 0, 'область не считает его своим');
    tickLifecycle(0);
});

test('scope: узлы вне области и persistent переживают закрытие', () => {
    const hud = new Node('ui.panel');
    hud.addClass('scene-persistent');
    ctx.scopeTrack(hud);                     // класс — явное исключение
    const keeper = new Node('sprite');
    keeper.attrs.persistent = true;
    ctx.scopeTrack(keeper);
    const room = scene.scope('room:persistent');
    const owned = spawn('rect', room);
    room.close({ immediate: true });
    falsy(hud.removed, 'scene-persistent HUD пережил область');
    falsy(keeper.removed, 'attrs.persistent пережил область');
    truthy(owned.removed, 'обычный узел области удалён');
    hud.destroy();
    keeper.destroy();
});

test('scope: контекст $.scene.scope(name, fn) привязывает созданное', () => {
    const room = scene.scope('room:context');
    const made = scene.scope('room:context', () => spawn('rect'));
    eq(room.counts().nodes, 1, 'узел из контекста принадлежит области');
    truthy(made !== undefined);
    room.close({ immediate: true });
    truthy(made.removed);
});

test('scoped load: enter получает область, старые узлы уходят, HUD остаётся', () => {
    const hud = new Node('ui.panel');
    hud.attrs.persistent = true;
    scene.add('room', {
        enter($, scope) {
            truthy(scope && scope.name.indexOf('scene:room') === 0, 'enter получил область');
            spawn('rect');
        },
    });
    settle();
    scene.load('room', { transition: 'none', scope: true });
    settle();
    eq(scene.current(), 'room');
    const first_scope = scene._state.scope_name;
    truthy(first_scope !== null, 'у сцены есть область');

    scene.restart();
    settle();
    truthy(scene._state.scope_name !== first_scope, 'restart создал новую область');
    eq(liveTag('rect'), 1, 'уцелел ровно один мир комнаты, а не два');
    falsy(hud.removed, 'persistent HUD пережил restart');
    hud.destroy();
});

test('scope: 100 scoped restart не растят живые узлы', () => {
    scene.add('loop-room', {
        enter() { for (let i = 0; i < 8; i++) spawn('rect'); },
    });
    scene.load('loop-room', { transition: 'none', scope: true });
    settle();
    const before = scene.counts().nodes;
    const scope_before = scene._state.scope_name;
    for (let i = 0; i < 100; i++) {
        scene.restart();
        settle();
    }
    const after = scene.counts().nodes;
    eq(after, before, `число живых узлов не выросло (${before} → ${after})`);
    eq(liveTag('rect'), 8, 'мир комнаты ровно один');
    eq(scene.counts().scopes, 1, 'осталась одна активная область');
    truthy(scene._state.scope_name !== scope_before);
});

test('prepare/commit: ошибка подготовки не ломает текущую сцену', () => {
    settle();
    scene.add('good', { enter() {} });
    scene.load('good', { transition: 'none' });
    settle();
    eq(scene.current(), 'good');
    const rects_before = liveTag('rect');

    scene.add('bad', {
        prepare() { spawn('rect'); throw new Error('нет ассета'); },
        enter() { spawn('rect'); },
    });
    const handle = scene.prepare('bad');
    falsy(handle.ok, 'prepare помечен неудачным');
    eq(scene.current(), 'good', 'текущая сцена осталась текущей');
    eq(scene.scopeOf(handle.stage), null, 'временная область закрыта');
    eq(liveTag('rect'), rects_before, 'мир неудачной подготовки не опубликован');

    scene.add('next', { prepare() { spawn('rect'); }, enter() {} });
    const ok = scene.prepare('next');
    truthy(ok.ok, 'prepare успешен');
    scene.commit(ok);
    settle();
    eq(scene.current(), 'next');
    eq(liveTag('rect'), rects_before + 1, 'опубликован мир подготовленной сцены');
});

test('prepare/discard: отменённая подготовка не публикует мир', () => {
    const rects_before = liveTag('rect');
    scene.add('cancelled', { prepare() { spawn('rect'); }, enter() {} });
    const handle = scene.prepare('cancelled');
    truthy(handle.ok);
    scene.discard(handle);
    settle();
    falsy(scene.current() === 'cancelled', 'сцена не стала текущей');
    eq(liveTag('rect'), rects_before, 'мир отменённой подготовки убран');
});

test('scope: after/every отменяются при закрытии области', () => {
    const cancelled = [];
    ctx.time = {
        after(ms, fn) { return 5; },
        every(ms, fn) { return 6; },
        cancel(id) { cancelled.push(id); },
        cancelAll() {}, resume() {},
    };
    const room = scene.scope('room:timers');
    room.after(100, () => {});
    room.every(50, () => {});
    eq(room.counts().timers, 2);
    room.close({ immediate: true });
    eq(cancelled.join(','), '5,6', 'оба таймера сняты');
    ctx.time = { cancelAll() {}, resume() {} };
});

test('generation: новый load отменяет область старого loader', () => {
    settle();
    const loader = scene.scope('loader:old');
    scene._state.loader_scope = loader;
    scene.add('one', { enter() {} });
    scene.load('one', { transition: 'none' });
    settle();
    eq(loader.state(), 'closed', 'область старого загрузчика закрыта новым load');
    eq(scene._state.loader_scope, null, 'ссылка на старый loader снята');
});

test('ошибка enter видна в status и диагностике', () => {
    settle();
    const reports = [];
    ctx.$.debug = { reportError: (where, error, details) => reports.push({ where, error, details }) };
    scene.add('broken', { enter() { throw new Error('REPRO_ENTER'); } });
    scene.load('broken', { transition: 'none' });
    settle();
    const st = scene.status();
    eq(st.name, 'broken');
    eq(st.ok, false, 'вход помечен неуспешным');
    eq(st.error.code, 'R2D_SCENE_ENTER');
    eq(st.error.message, 'REPRO_ENTER');
    eq(st.error.operation, 'enter');
    truthy(reports.length > 0, 'reportError вызван');
    eq(reports[reports.length - 1].details.code, 'R2D_SCENE_ENTER');
    delete ctx.$.debug;
});

finish();
