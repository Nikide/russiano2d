// ===========================================================================
// Юнит-тест §15 без движка (qjs): контексты ввода, потребление, виртуальный
// ввод и захват «нажми клавишу».
//
// Зачем отдельный тест, если есть агентский: фронт нажатия живёт ровно один
// кадр, а агентский протокол вставляет свои кадры между командой и чтением.
// Здесь мы управляем кадром сами, поэтому поведение детерминировано.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/input_contexts_test.mjs
// ===========================================================================

// ВАЖНО: input.js читает движок через модульный `engine` из native.js. Статический
// импорт выполнился бы ДО настройки мока, и `engine.keyPressed` остался бы
// no-op из харнесса (возвращает 0). Поэтому модуль ввода импортируется
// динамически — после подмены методов.
import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';

const store_data = new Map();
const store = {
    set(key, value) { store_data.set(key, value); return store; },
    get(key, fallback) { return store_data.has(key) ? store_data.get(key) : fallback; },
    save() { return true; },
};
ctx.store = store;
ctx.$ = { store };

// --- Поддельный движок: кадр, удержанные клавиши и фронты -------------------
let frame = 0;
const held = new Set();
let pressed_codes = [];
let released_codes = [];

engine.frame = 0;
engine.keysPressed = () => pressed_codes.slice();
engine.keysReleased = () => released_codes.slice();
engine.keyDown = (code) => held.has(code);
// Фронты: движок держит их ОДИН кадр. Мок повторяет это: true во время
// tickInput и false сразу после — иначе тест проверял бы состояние, которого
// у настоящего движка нет (нашлось отладкой этого теста).
let edge_codes = [];
engine.keyPressed = (code) => edge_codes.includes(code);
engine.keyReleased = (code) => edge_codes.includes(code);
// scancode() приводим к регистронезависимому виду: input.js передаёт имена в
// том виде, как их вернул ALIASES ('Space'), а тест может спросить 'space'.
const CODES = { space: 44, return: 40, j: 38, escape: 41, f5: 70 };
engine.scancode = (name) => CODES[String(name).toLowerCase()] || 0;
engine.padDown = () => false;
engine.padAxis = () => 0;
engine.padConnected = () => false;
engine.mouseDown = () => false;
engine.mousePressed = () => false;
engine.keyName = (code) => String(code);

const { installInput, tickInput } = await import('../../src/highlevel/input.js');
const input = installInput({ store });

// Санити-проверка мока: если подмена не сработала, тест должен падать здесь,
// а не «где-то в контекстах».
if (engine.keyPressed(1) !== false) throw new Error('мок engine.keyPressed не установлен');

/**
 * Новый кадр: агент «нажимает» клавиши, затем идёт кадр движка.
 *
 * `probe` вызывается ВНУТРИ кадра: фронт нажатия живёт ровно один кадр, и
 * проверять его после tickInput так же неверно, как проверять «нажато» через
 * кадр после отпускания. Возвращает результат probe.
 */
function frameWith(down = [], press = [], probe) {
    frame++;
    engine.frame = frame;
    held.clear();
    for (const c of down) held.add(c);
    pressed_codes = press.slice();
    released_codes = press.slice();   // tap: нажатие и отпускание в одном кадре
    edge_codes = press.slice();
    tickInput();                      // внутри кадра фронты видны
    const result = probe ? probe() : undefined;
    edge_codes = [];                  // после кадра — уже нет
    pressed_codes = [];
    released_codes = [];
    return result;
}

// --- Контексты и приоритеты -------------------------------------------------

input.bind('confirm', ['space', 'enter']);
input.bind('attack', ['j']);

input.context('menu', { priority: 20, binds: { confirm: ['space'] } });
input.context('gameplay', { priority: 0, active: true, binds: { confirm: ['space'] } });

test('контекст: действие достаётся приоритетному контексту', () => {
    input.context('menu').active(true);
    const seen = frameWith([44], [44], () => ({
        confirm: input.pressed('confirm'), attack: input.pressed('attack'),
    }));
    truthy(seen.confirm, 'confirm виден');
    falsy(seen.attack, 'attack не подменяется confirm');
    input.context('menu').active(false);
});

test('контекст: выключенный контекст ввод не забирает', () => {
    input.context('menu').active(false);
    truthy(frameWith([44], [44], () => input.pressed('confirm')), 'confirm снова у gameplay');
});

test('потребление: consume глушит действие для остальных', () => {
    input.consume('confirm');
    falsy(frameWith([44], [44], () => input.pressed('confirm')), 'после consume confirm не виден');
    const who = input.consumed();
    eq(who && who.action, 'confirm', 'отмечено, что съедено');
    input.consume();                       // сбросить отметку
    frameWith([], []);
    truthy(frameWith([44], [44], () => input.pressed('confirm')),
           'после сброса отметки confirm снова виден');
});

// --- Виртуальный ввод --------------------------------------------------------

test('виртуальное нажатие: видно ровно один кадр', () => {
    input.synthClear();
    input.synthPress('space');             // заказ на ближайший кадр
    truthy(frameWith([], [], () => input.pressed('confirm')), 'виртуальное нажатие видно в своём кадре');
    frameWith([], []);
    falsy(frameWith([], [], () => input.pressed('confirm')), 'на следующем кадре его уже нет');
});

test('виртуальное удержание: down без фронта и снятие', () => {
    input.synthClear();
    input.synthDown('space');
    const held_probe = frameWith([], [], () => ({ down: input.down('confirm'), pressed: input.pressed('confirm') }));
    truthy(held_probe.down, 'удержание видно');
    falsy(held_probe.pressed, 'удержание не даёт повторного фронта');
    input.synthRelease('space');
    frameWith([], []);
    falsy(frameWith([], [], () => input.down('confirm')), 'после снятия удержания нет');
});

// --- Захват «нажми клавишу» --------------------------------------------------

test('waitForInput: ловит следующее нажатие', () => {
    input.synthClear();
    let got = 'нет';
    const off = input.waitForInput({ timeout: 1000 });
    off.then((k) => { got = k; }).catch(() => { got = 'ошибка'; });
    eq(input.waiters(), 1, 'ожидание висит');
    // Внутри кадра ловим именно нажатие: фронт живёт один кадр.
    frameWith([70], [70]);
    eq(input.waiters(), 0, 'ожиданий не осталось');
});

test('waitForInput: отмена снимает ожидание', () => {
    input.synthClear();
    const off = input.waitForInput();
    off.catch(() => {});          // промис отменяется — гасим, чтобы не было unhandled
    input.cancelWaits('тест');
    eq(input.waiters(), 0, 'ожиданий не осталось');
});

test('waitForInput: таймаут без ввода', () => {
    input.synthClear();
    const off = input.waitForInput({ timeout: 16 });
    off.catch(() => {});          // ожидание обязано завершиться ошибкой таймаута
    eq(input.waiters(), 1, 'ожидание поставлено');
    // 60 кадров по 1/60 — заведомо больше 16 мс таймаута.
    for (let i = 0; i < 60; i++) frameWith([], []);
    eq(input.waiters(), 0, 'по таймауту ожидание снято');
});

// --- Привязки, конфликты, эталон --------------------------------------------

test('конфликты и resetDefaults', () => {
    input.bind('pause', ['escape']);
    input.markDefaults();
    const c = input.conflicts('jump', ['escape']);
    truthy(c.some((row) => row.action === 'pause'), 'конфликт по escape найден');
    input.rebind('pause', ['p']);
    eq(input.bindings().pause.join(','), 'p', 'rebind сработал');
    input.resetDefaults();
    eq(input.bindings().pause.join(','), 'escape', 'resetDefaults вернул эталон');
});

test('оси: порог и гистерезис', () => {
    engine.padAxis = () => 0.45;
    input.axisAction('right', { axis: 'leftx', threshold: 0.4 });
    truthy(input.axisAction('right'), '0.45 выше порога — действие есть');
    engine.padAxis = () => 0.35;
    truthy(input.axisAction('right'), 'между порогом и порогом-гистерезисом держится');
    engine.padAxis = () => 0.2;
    falsy(input.axisAction('right'), 'ниже порога-гистерезиса — отпущено');
    engine.padAxis = () => 0;
});

finish();
