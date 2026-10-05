// ===========================================================================
// Юнит-тест новых возможностей ввода без движка (qjs).
//
// Проверяет мёртвую зону осей (влияние на vec), сохранение/восстановление
// привязок через $.store с отбраковкой испорченных записей, rebind с
// проверками, actions()/describe(). Старое поведение (bind/unbind/bindings)
// тоже под проверкой — чтобы правка не сломала демо.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/input_deadzone_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';
import { installInput } from '../../src/highlevel/input.js';

const store_data = new Map();
const store = {
    set(key, value) { store_data.set(key, value); return store; },
    get(key, fallback) { return store_data.has(key) ? store_data.get(key) : fallback; },
    save() { return true; },
};

ctx.store = store;
ctx.$ = { store };
const $ = { store };
const input = installInput($);

// Аналоговая ось геймпада в headless-прогоне всегда нулевая, поэтому
// подменяем источник: так мёртвая зона проверяется детерминированно.
let pad_value = 0.5;
engine.padAxis = () => pad_value;

test('deadzone: значение по умолчанию, сеттер-цепочка и ограничение 0..1', () => {
    eq(input.deadzone(), 0.2);
    eq(input.deadzone(0.3), input);
    eq(input.deadzone(), 0.3);
    input.deadzone(5);
    eq(input.deadzone(), 1);
    input.deadzone(-1);
    eq(input.deadzone(), 1);          // некорректное значение не применяется
    input.deadzone(0.2);
});

test('deadzone управляет аналоговым вкладом в vec()', () => {
    input.deadzone(0);
    let v = input.vec('wasd');
    eq(v.x, 0.5);
    eq(v.y, 0.5);

    input.deadzone(0.9);
    v = input.vec('wasd');
    eq(v.x, 0);
    eq(v.y, 0);

    // Ровно на границе мёртвая зона ещё не гасит ось.
    input.deadzone(0.5);
    v = input.vec('wasd');
    eq(v.x, 0.5);
    input.deadzone(0.2);
});

test('axis остаётся -1..1 и без клавиш даёт ноль', () => {
    eq(input.axis('a', 'd'), 0);
    eq(input.axis('левая', 'правая'), 0);
});

test('bind/unbind/bindings работают как раньше', () => {
    input.bind('jump', ['space']);
    eq(JSON.stringify(input.bindings().jump), '["space"]');
    eq(input.bind('jump', 'x'), input);                 // одиночный ключ тоже допустим
    eq(JSON.stringify(input.bindings().jump), '["x"]');
    input.unbind('jump');
    eq(input.bindings().jump, undefined);
});

test('saveBindings/loadBindings: круг через $.store', () => {
    input.bind('jump', ['space', 'w']);
    input.bind('fire', ['mouse.left']);
    truthy(input.saveBindings());
    truthy(store.get('input.bindings').jump.length === 2);

    input.bind('jump', ['x']);
    truthy(input.loadBindings());
    eq(JSON.stringify(input.bindings().jump), '["space","w"]');
    eq(JSON.stringify(input.bindings().fire), '["mouse.left"]');
});

test('loadBindings пропускает записи не из массивов строк', () => {
    input.bind('jump', ['x']);
    store.set('input.bindings', {
        jump: 'space',        // строка вместо массива — пропустить
        fire: [1, 2],         // числа вместо строк — пропустить
        dash: [],             // пустой список — пропустить
        ok: ['q'],
    });
    truthy(input.loadBindings());
    eq(JSON.stringify(input.bindings().jump), '["x"]');   // не тронуто
    eq(JSON.stringify(input.bindings().fire), '["mouse.left"]');
    eq(input.bindings().dash, undefined);
    eq(JSON.stringify(input.bindings().ok), '["q"]');
});

test('rebind: валидный вызов, пустой список и нестроковый ключ', () => {
    const logs = [];
    const saved_log = ctx.log;
    ctx.log = (message) => logs.push(String(message));

    input.bind('fire', ['mouse.left']);
    input.rebind('fire', ['f']);
    eq(JSON.stringify(input.bindings().fire), '["f"]');

    input.rebind('fire', []);
    eq(JSON.stringify(input.bindings().fire), '["f"]');   // осталось прежним
    input.rebind('fire', [42]);
    eq(JSON.stringify(input.bindings().fire), '["f"]');
    input.rebind('', ['f']);
    input.rebind('новая', ['g']);                         // предупредил, но создал
    ctx.log = saved_log;

    truthy(logs.some((m) => m.includes('хотя бы один ключ')));
    truthy(logs.some((m) => m.includes('должны быть строками')));
    truthy(logs.some((m) => m.includes('не было объявлено')));
    eq(JSON.stringify(input.bindings().новая), '["g"]');
});

test('actions() и describe() дают отладочную сводку', () => {
    truthy(input.actions().includes('fire'));
    const d = input.describe('fire');
    eq(d.action, 'fire');
    eq(JSON.stringify(d.keys), '["f"]');
    falsy(d.down);
    falsy(d.pressed);

    const empty = input.describe('нет.такого');
    eq(empty.keys.length, 0);
    falsy(empty.down);
});

finish();
