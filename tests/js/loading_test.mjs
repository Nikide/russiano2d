// ===========================================================================
// Юнит-тесты экрана загрузки (src/highlevel/loading.js) без движка.
//
// Экран собирается из ui-узлов, поэтому подставляем простой макет `$`:
// проверяем, что узлы создаются и удаляются, полоса и подпись обновляются,
// прогресс ограничен 0..1, а список шагов выполняется по одному за кадр.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/loading_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { createLoading } from '../../src/highlevel/loading.js';

/** Макет узла: помним атрибуты, родителя и живым/удалённым. */
function makeNode(tag, attrs) {
    return {
        tag,
        attrs: Object.assign({}, attrs || {}),
        nodes: [Object.assign({}, attrs || {})],
        parent: null,
        removed: false,
        at(x, y) { this.attrs.x = x; this.attrs.y = y; return this; },
        size(w, h) { this.attrs.w = w; this.attrs.h = h; return this; },
        appendTo(parent) { this.parent = parent; parent.children.push(this); return this; },
        remove() {
            this.removed = true;
            if (this.parent && this.parent.children) {
                const at = this.parent.children.indexOf(this);
                if (at >= 0) this.parent.children.splice(at, 1);
            }
            return this;
        },
        set(values) { Object.assign(this.attrs, values); return this; },
    };
}

/** Макет API: ui-слой, окно, $.update с ручным тиком. */
function makeEnv() {
    const ui = { children: [] };
    const hooks = [];
    const logs = [];
    const $ = (tag, attrs) => makeNode(tag, attrs);
    $.ui = ui;
    $.window = { size: () => ({ w: 800, h: 600 }) };
    // Как в движке: $.update НЕ отдаёт функцию снятия.
    $.update = (fn) => { hooks.push(fn); };
    $.tick = () => { for (const fn of hooks.slice()) fn(); };
    $.hookCount = () => hooks.length;
    const ctx = { $, ui, log: (m) => logs.push(String(m)), logs };
    return { $, ctx, ui, logs };
}

test('show: создаёт экран и не мешает вводу (живёт в ui)', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    falsy(loading.visible(), 'до show экрана нет');
    loading.show({ title: 'Готовим лес…', hint: 'пара секунд' });
    truthy(loading.visible(), 'экран показан');
    eq(env.ui.children.length, 5, 'фон, заголовок, полоса, подпись, подсказка');
    eq(env.ui.children[0].tag, '<ui.panel>', 'первый — фон');
    eq(env.ui.children[1].attrs.text, 'Готовим лес…', 'заголовок из opts');
    eq(env.ui.children[4].attrs.text, 'пара секунд', 'подсказка из opts');
    eq(env.ui.children[1].attrs.x, 400, 'по центру окна по X');
    eq(env.ui.children[1].attrs.y, 260, 'заголовок выше центра');
    eq(env.ui.children[2].attrs.w, 460, 'ширина полосы');
});

test('show: повторный вызов перерисовывает, а не плодит узлы', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show({ title: 'первый' });
    loading.show({ title: 'второй' });
    eq(env.ui.children.length, 5, 'узлов столько же');
    eq(env.ui.children[1].attrs.text, 'второй', 'заголовок обновился');
});

test('progress: полоса и подпись, ограничение 0..1', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show();
    eq(loading.value(), 0, 'старт с нуля');
    loading.progress(0.4, 'деревья');
    near(loading.value(), 0.4, 1e-9);
    eq(env.ui.children[2].nodes[0].value, 400, 'полоса в тысячных');
    eq(env.ui.children[2].nodes[0].max_value, 1000);
    eq(env.ui.children[3].nodes[0].text, '40% · деревья', 'подпись с шагом');
    loading.progress(1.5);
    eq(loading.value(), 1, 'выше единицы обрезается');
    eq(env.ui.children[3].nodes[0].text, '100%');
    loading.progress(-3);
    eq(loading.value(), 0, 'ниже нуля обрезается');
});

test('progress: без show ничего не делает', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.progress(0.5);
    eq(loading.value(), 0, 'экран не показан — прогресс не идёт');
    falsy(loading.visible());
});

test('title и label меняются на ходу', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show({ title: 'старт', hint: 'ждём' });
    loading.title('лес');
    loading.label('враги');
    eq(env.ui.children[1].nodes[0].text, 'лес', 'заголовок');
    eq(env.ui.children[4].nodes[0].text, 'враги', 'подпись');
    loading.label('');
    eq(env.ui.children[4].nodes[0].text, '', 'пустая подпись допустима');
});

test('hide: узлы удалены, экран больше не виден', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show();
    const nodes = env.ui.children.slice();
    loading.hide();
    falsy(loading.visible());
    truthy(nodes.every((n) => n.removed), 'все узлы помечены удалёнными');
    eq(env.ui.children.length, 0, 'у слоя пусто');
    loading.progress(0.5);
    eq(loading.value(), 0, 'после hide прогресс не идёт');
});

test('run: шаги выполняются по одному за кадр', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show();
    const done = [];
    let calls = 0;
    loading.run([
        { label: 'лес', work: () => { done.push('лес'); calls++; } },
        { label: 'враги', work: () => { done.push('враги'); calls++; } },
    ], () => done.push('финиш'));
    eq(calls, 0, 'до кадра ничего не сделано');
    env.$.tick();
    eq(calls, 1, 'за кадр — один шаг');
    eq(done.join(','), 'лес', 'первый шаг');
    env.$.tick();
    eq(calls, 2, 'второй шаг');
    env.$.tick();
    eq(done.join(','), 'лес,враги,финиш', 'после шагов вызывается done');
    // Движок снять хук не умеет, поэтому проверяем, что шаги больше не идут.
    const before = done.length;
    env.$.tick();
    env.$.tick();
    eq(done.length, before, 'после финиша шаги не повторяются');
    eq(calls, 2, 'и работы больше нет');
});

test('run: ошибка шага не роняет список', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show();
    const done = [];
    loading.run([
        { label: 'плохой', work: () => { throw new Error('бум'); } },
        { label: 'хороший', work: () => done.push('ок') },
    ], () => done.push('финиш'));
    env.$.tick();
    env.$.tick();
    env.$.tick();
    eq(done.join(','), 'ок,финиш', 'после ошибки шаги продолжились');
    truthy(env.logs.some((m) => m.includes('бум')), 'ошибка попала в журнал');
});

test('run: шаги-функции и пустой список', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show();
    const done = [];
    loading.run([() => done.push('раз')], () => done.push('финиш'));
    env.$.tick();
    env.$.tick();
    eq(done.join(','), 'раз,финиш');
    loading.run(null, () => done.push('пусто'));
    env.$.tick();
    eq(done.join(','), 'раз,финиш,пусто', 'пустой список сразу завершается');
});

test('run: два финиша не наступают от повторных кадров', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    loading.show();
    let finished = 0;
    loading.run([{ label: 'один', work: () => {} }], () => finished++);
    for (let i = 0; i < 10; ++i) env.$.tick();
    eq(finished, 1, 'done вызван ровно один раз');
    near(loading.value(), 1, 1e-9, 'прогресс дошёл до конца');
});

test('без $.update: шаги не выполняются, но экран живёт', () => {
    const env = makeEnv();
    delete env.$.update;
    const loading = createLoading(env.ctx);
    loading.show({ title: 'без хука' });
    truthy(loading.visible());
    loading.run([{ label: 'шаг', work: () => {} }]);
    truthy(env.logs.some((m) => m.includes('нет $.update')), 'сказали в журнал');
});

finish();
