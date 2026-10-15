// ===========================================================================
// Юнит-тесты хит-фидбека ($.hits / $.hitFx).
//
// Проверяем композицию: одна строка `$.hitFx` обязана выдать ровно те
// эффекты, что заказаны пресетом и опциями, — искры в точке контакта,
// вспышку узла и экрана, тряску, hit-stop, отдачу и squash, — а squash
// обязан вернуть исходный масштаб, а не накапливать деформацию.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/hit_fx_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrapOne } from '../../src/highlevel/core.js';
import {
    installHits, tickHits, mergeSpec, resolvePoint, resolveNode, hitDirection,
    squashFactors, squashEnvelope, resetHits, hitsState, payloadOf, unwrapNode,
} from '../../src/highlevel/hits.js';

// --- Записывающие моки движка и подсистем ---------------------------------

const log = { freeze: [], slow: [], shake: [], screen: [], flash: [], sound: [], impulses: [] };
let burst = 0;
let burst_point = null;

ctx.camera = { shake(a, ms) { log.shake.push([a, ms]); } };
ctx.time = {
    delta: () => game_dt,
    freeze(ms) { log.freeze.push(ms); },
    slow(ms, scale) { log.slow.push([ms, scale]); },
};
ctx.fx = { flash(color, opts) { log.screen.push([color, opts && opts.ms]); } };
ctx.sound = { play(name) { log.sound.push(name); } };
engine.applyImpulse = (body, x, y) => { log.impulses.push([body, x, y]); return true; };

let game_dt = 1 / 60;

// Мок `$`: частицы и мир. Считаем залпы, а не устройство particles.js —
// его собственные тесты лежат в particles_test.mjs.
const emitter = {
    at(x, y) { burst_point = { x, y }; return this; },
    appendTo() { return this; },
    params() { return this; },
    restart() { burst++; return this; },
    stop() { return this; },
    clear() { return this; },
    burst() { return this; },
};
const $ = function () { return Object.assign({}, emitter); };
$.particles = { preset: (name, spec) => ({ preset_name: name }) };
$.world = { tag: 'world' };
// Ядро зовёт ctx.$._dispatchGlobal на каждом emit; в юнит-тесте подписки нет.
ctx.$ = { _dispatchGlobal() {} };
installHits($);
ctx.hits = $.hits;

function reset() {
    log.freeze.length = 0; log.slow.length = 0; log.shake.length = 0;
    log.screen.length = 0; log.flash.length = 0; log.sound.length = 0;
    log.impulses.length = 0;
    burst = 0; burst_point = null;
    game_dt = 1 / 60;
    resetHits();
    hitsState.plays = 0;
}

// --- Чистая часть ----------------------------------------------------------

test('mergeSpec: умолчания → пресет → опции, вложенно и с null', () => {
    const spec = mergeSpec({ boss: { hitStop: 120, particles: { amount: 40 } } }, 'boss',
                           { shake: 9, particles: { speed: [1, 2] } });
    eq(spec.hitStop, 120, 'пресет перекрыл умолчание');
    eq(spec.shake, 9, 'опции перекрыли пресет');
    eq(spec.particles.amount, 40, 'вложенное поле пресета сохранилось');
    eq(spec.particles.speed[1], 2, 'вложенное поле опций добавилось');
    eq(spec.particles.preset, 'sparks', 'умолчание частиц на месте');
    const off = mergeSpec({ x: { screen: null } }, 'x', null);
    eq(off.screen, null, 'null выключает эффект, а не «нет значения»');
});

test('resolvePoint: событие, узел, обёртка, селектор, точка', () => {
    const node = new Node('sprite', { id: 'hp_victim' });
    node.x = 7; node.y = 8;
    eq(resolvePoint({ x: 1, y: 2 }).x, 1, 'событие с точкой');
    eq(resolvePoint(node).y, 8, 'узел');
    eq(resolvePoint('#hp_victim').x, 7, 'селектор');
    eq(resolvePoint({ nodes: [node] }).x, 7, 'обёртка');
    eq(resolvePoint(() => ({ x: 3, y: 4 })).x, 3, 'функция');
});

test('resolveNode: по умолчанию цель — узел события (self)', () => {
    const self = new Node('sprite', { id: 'hp_self' });
    const other = new Node('sprite', { id: 'hp_other' });
    eq(resolveNode({ self, other }, undefined), self, 'self — по умолчанию');
    eq(resolveNode({ self, other }, 'other'), other, 'other — по явной просьбе');
    // Обработчик движка получает обёртку события: данные лежат в event.data,
    // а на котором узле сработало — в event.self.
    const event = { self: wrapOne(self), data: { x: 1, y: 2, self: wrapOne(self), other: wrapOne(other) } };
    eq(payloadOf(event).x, 1, 'payload из event.data');
    eq(resolveNode(event, 'self'), self, 'self события — узел-эмиттер');
    eq(resolveNode(event, 'other'), other, 'other события — второй участник');
    eq(resolvePoint(event).y, 2, 'точка из event.data');
    eq(unwrapNode(wrapOne(other)), other, 'обёртка разворачивается в узел');
});

test('hitDirection: от источника к цели, затем нормаль, затем запасное', () => {
    const a = new Node('sprite', {}); a.x = 0; a.y = 0;
    const b = new Node('sprite', {}); b.x = 10; b.y = 0;
    const dir = hitDirection({ self: b, other: a }, b);
    near(dir.x, 1, 1e-9, 'отдача от источника');
    near(dir.y, 0, 1e-9);
    const normal = hitDirection({ nx: 0, ny: -3 }, null);
    near(normal.y, -1, 1e-9, 'нормаль нормируется');
    const fallback = hitDirection(null, null);
    eq(fallback.y, -1, 'запасное — вверх');
});

test('squashFactors/squashEnvelope: сжатие по удару и возврат в ноль', () => {
    const h = squashFactors(0.3, true, 0.5);
    near(h.x, 0.7, 1e-9, 'по удару сжатие');
    near(h.y, 1.15, 1e-9, 'поперёк растяжение');
    const v = squashFactors(0.3, false, 0.5);
    near(v.y, 0.7, 1e-9, 'вертикальный удар сжимает по Y');
    near(squashEnvelope(0), 0, 1e-9);
    near(squashEnvelope(0.5), 1, 1e-9);
    near(squashEnvelope(1), 0, 1e-9);
});

// --- Композиция ------------------------------------------------------------

test('$.hitFx по событию: искры, вспышка, тряска, hit-stop, отдача', () => {
    reset();
    const victim = new Node('sprite', { id: 'fx_victim' });
    victim.x = 0; victim.y = 0;
    const source = new Node('sprite', { id: 'fx_source' });
    source.x = -50; source.y = 0;
    const result = $.hitFx({ x: 0, y: 0, self: victim, other: source },
                           { preset: 'crit', sound: 'crit' });
    eq(result.target, victim, 'фидбек достался узлу события');
    eq(burst, 1, 'залп частиц ровно один');
    eq(burst_point.x, 0, 'частицы в точке контакта');
    truthy(victim.tint_timer > 0, 'вспышка узла: таймер тона взведён');
    truthy(victim.tint !== null, 'вспышка узла: цвет подменён');
    eq(log.screen.length, 1, 'вспышка экрана из пресета crit');
    eq(log.shake.length, 1, 'тряска камеры');
    eq(log.shake[0][0], 7, 'амплитуда из пресета');
    eq(log.freeze[0], 110, 'hit-stop из пресета');
    truthy(log.impulses.length + hitsState.tweens.length >= 1,
           'отдача сработала: импульс телу или сдвиг узлу');
    eq(log.sound[0], 'crit', 'звук играется, когда игра его назвала');
});

test('пресет hit не заливает экран и не выдумывает звук', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_quiet' });
    node.x = 0; node.y = 0;
    $.hits.play(node);
    eq(log.screen.length, 0, 'вспышки экрана в базовом ударе нет');
    eq(log.sound.length, 0, 'имя звука пресет не угадывает — его задаёт игра');
    eq(log.shake.length, 1, 'тряска есть');
    eq(log.freeze[0], 60, 'микро-стоп есть');
    eq(burst, 1, 'искры есть');
});

test('опции перекрывают пресет по каждому эффекту и выключаются null', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_tune' });
    node.x = 0; node.y = 0;
    $.hits.play(node, {
        preset: 'crit', shake: 0, screen: null, flash: null,
        hitStop: 25, knockback: 0, squash: 0, sound: '',
    });
    eq(log.shake.length, 0, 'тряска выключена');
    eq(log.screen.length, 0, 'экранная вспышка выключена');
    eq(node.tint_timer, 0, 'вспышка узла выключена');
    eq(log.freeze[0], 25, 'hit-stop перекрыт');
    eq(log.impulses.length, 0, 'отдача выключена');
    eq(hitsState.tweens.length, 0, 'squash выключен — таймлайнов нет');
});

test('slow заменяет hit-stop, когда заказан', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_slow' });
    node.x = 0; node.y = 0;
    $.hits.play(node, { hitStop: 80, slow: 300, slowScale: 0.2, squash: 0 });
    eq(log.freeze.length, 0, 'полной заморозки нет');
    eq(log.slow[0][0], 300, 'замедление на 300 мс');
    eq(log.slow[0][1], 0.2, 'до 0.2 скорости');
});

// --- Squash и отдача -------------------------------------------------------

test('squash возвращает исходный масштаб и не накапливается', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_squash' });
    node.scale_x = 2; node.scale_y = 2;
    node.x = 0; node.y = 0;
    $.hits.squash(node, { amount: 0.5, ms: 100, dir: { x: 1, y: 0 } });
    eq(hitsState.tweens.length, 1, 'таймлайн заведён');
    tickHits(1 / 60);
    truthy(node.scale_x < 2, `по удару сжало: ${node.scale_x}`);
    truthy(node.scale_y > 2, `поперёк растянуло: ${node.scale_y}`);
    for (let i = 0; i < 20; i++) tickHits(1 / 60);
    eq(node.scale_x, 2, 'вернулся ровно исходный масштаб X');
    eq(node.scale_y, 2, 'вернулся ровно исходный масштаб Y');
    eq(hitsState.tweens.length, 0, 'таймлайн закрыт');
    // Второй удар подряд не должен «съесть» базу.
    $.hits.squash(node, { amount: 0.5, ms: 100 });
    for (let i = 0; i < 20; i++) tickHits(1 / 60);
    eq(node.scale_x, 2, 'после второго удара масштаб тот же');
});

test('squash стоит на заморозке времени вместе с миром', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_frozen_squash' });
    node.x = 0; node.y = 0;
    $.hits.squash(node, { amount: 0.4, ms: 100, dir: { x: 1, y: 0 } });
    game_dt = 0;                    // так выглядит кадр при $.time.freeze()
    for (let i = 0; i < 5; i++) tickHits(1 / 60);
    eq(node.scale_x, 1, 'на заморозке деформация не идёт');
    game_dt = 1 / 60;
    tickHits(1 / 60);
    truthy(node.scale_x < 1, 'после заморозки деформация пошла');
});

test('отдача телу — импульс, узлу без тела — сдвиг с затуханием', () => {
    reset();
    const body_node = new Node('sprite', { id: 'fx_body' });
    body_node.body = 3;
    body_node.x = 0; body_node.y = 0;
    $.hits.knockback(body_node, { force: 200, dir: { x: 1, y: 0 } });
    eq(log.impulses.length, 1, 'импульс ушёл в Box2D');
    eq(log.impulses[0][0], 3, 'в нужное тело');
    near(log.impulses[0][1], 200, 1e-9, 'по направлению удара');
    near(log.impulses[0][2], 0, 1e-9);
    eq(hitsState.tweens.length, 0, 'для тела таймлайн не нужен');

    const free = new Node('sprite', { id: 'fx_free' });
    free.x = 0; free.y = 0; free.body = -1;
    $.hits.knockback(free, { force: 200, dir: { x: 1, y: 0 } });
    for (let i = 0; i < 20; i++) tickHits(1 / 60);
    near(free.x, 12, 1e-6, 'сдвиг = force * 0.06 по направлению');
    near(free.y, 0, 1e-9);
});

test('cooldown гасит повторный фидбек по той же цели', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_cool' });
    node.x = 0; node.y = 0;
    engine.time = 10;
    $.hits.play(node, { cooldown: 100, squash: 0 });
    eq(burst, 1, 'первый удар прошёл');
    engine.time = 10.02;
    const skipped = $.hits.play(node, { cooldown: 100, squash: 0 });
    truthy(skipped.skipped, 'второй удар в окне cooldown пропущен');
    eq(burst, 1, 'и частиц не добавил');
    engine.time = 10.2;
    $.hits.play(node, { cooldown: 100, squash: 0 });
    eq(burst, 2, 'после окна удар снова играет');
});

// --- Подписка и методы узла ------------------------------------------------

test('$.hits.on подписывает узел и играет по событию hit', () => {
    reset();
    const enemy = new Node('enemy', { id: 'fx_sub' });
    enemy.addClass('mob');
    enemy.x = 0; enemy.y = 0;
    const count = $.hits.on('#fx_sub', { hitStop: 33, squash: 0, knockback: 0 });
    eq(count, 1, 'подписан один узел');
    enemy.emit('hit', { x: 4, y: 5, self: enemy, other: null });
    eq(log.freeze[0], 33, 'фидбек сыграл по событию');
    eq(burst, 1, 'частицы в точке из события');
});

test('методы узла .squash() и .knockback() возвращают цепочку', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_chain' });
    node.x = 0; node.y = 0;
    const wrapper = wrapOne(node);
    truthy(typeof wrapper.squash === 'function', '.squash() объявлен на обёртке');
    truthy(typeof wrapper.knockback === 'function', '.knockback() объявлен на обёртке');
    const back = wrapper.squash({ amount: 0.3, ms: 50 });
    eq(back, wrapper, 'метод возвращает ту же обёртку — цепочка не рвётся');
    eq(hitsState.tweens.length, 1, 'squash поставился');
    wrapper.knockback({ force: 120, dir: { x: 1, y: 0 } });
    eq(hitsState.tweens.length, 2, 'отдача без тела добавила сдвиг');
});

test('$.hits.preset добавляет свой пресет', () => {
    reset();
    $.hits.preset('punch', { hitStop: 20, shake: 1, squash: 0.1 });
    const names = $.hits.presets();
    truthy(names.indexOf('punch') >= 0, 'пресет появился в списке');
    const node = new Node('sprite', { id: 'fx_punch' });
    node.x = 0; node.y = 0;
    $.hits.play(node, 'punch');
    eq(log.freeze[0], 20, 'свой пресет дошёл до дела');
    eq(log.shake[0][0], 1);
});

test('отчёт play сериализуется: в spec нет узла (нет циклической ссылки)', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_json' });
    node.x = 0; node.y = 0;
    const result = $.hits.play(node, { squash: 0, screen: null });
    const text = JSON.stringify(result.spec);   // упал бы на цикле узел → ребёнок
    truthy(text.indexOf('child_nodes') < 0, 'spec без узла');
    eq(result.spec.target, 'self', 'адрес записан ролью');
    eq(result.target, node, 'а сам узел — в target');
});

finish();
