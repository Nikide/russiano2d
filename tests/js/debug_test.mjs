// ===========================================================================
// Юнит-тесты $.debug и $.console (qjs + tests/js/_harness.mjs).
//
// Регрессия: debug.profiler.start() пересоздавал запись и обнулял
// total/calls/max. start() зовут каждый кадр, поэтому report() показывал
// статистику только последнего кадра вместо накопленной за прогон.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/debug_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node } from '../../src/highlevel/core.js';
import { installDebug } from '../../src/highlevel/debug.js';
import { installPool } from '../../src/highlevel/pool.js';

ctx.$ = { _dispatchGlobal: () => {} };
const $ = {};
const { debug, console: debug_console } = installDebug($);
installPool($);

function frame(time) { engine.time = time; }

test('профайлер накапливает статистику между кадрами', () => {
    debug.profiler.reset();
    for (let i = 0; i < 3; i++) {
        frame(i * 0.1);
        debug.profiler.start('ai');
        frame(i * 0.1 + 0.002);   // ровно 2 мс работы
        debug.profiler.end('ai');
    }
    const r = debug.profiler.report().ai;
    eq(r.calls, 3, 'три вызова');
    near(r.avg_ms, 2, 0.01, 'среднее по трём кадрам');
    near(r.max_ms, 2, 0.01, 'максимум');
});

test('reset() очищает профайлер', () => {
    debug.profiler.reset();
    eq(debug.profiler.report().ai, undefined, 'после reset записи нет');

    debug.profiler.start('x');
    frame(engine.time + 0.001);
    debug.profiler.end('x');
    debug.profiler.start('x');   // новый кадр — статистика не теряется
    frame(engine.time + 0.001);
    debug.profiler.end('x');
    eq(debug.profiler.report().x.calls, 2, 'статистика копится до reset');
});

test('end() без start() ничего не ломает', () => {
    debug.profiler.end('нет-такого');
    truthy(debug.profiler.report() !== undefined);
});

test('watch() и unwatch() работают', () => {
    debug.watch('hp', () => 42);
    const found = debug.watches().find((w) => w.name === 'hp');
    truthy(found && found.value === 42, 'наблюдение читается');
    debug.unwatch('hp');
    falsy(debug.watches().some((w) => w.name === 'hp'), 'после unwatch нет');
});

test('stats() и counters() возвращают числа', () => {
    const s = debug.stats();
    truthy(typeof s.nodes === 'number' && typeof s.bodies === 'number');
    const c = debug.counters();
    truthy(typeof c.nodes === 'number' && typeof c.tweens === 'number');
});

test('$.console.run выполняет зарегистрированную команду', () => {
    let got = null;
    debug_console.register('greet', (args) => { got = args; }, 'приветствие');
    const out = debug_console.run('greet 100 200');
    eq(out, true, 'команда выполнена');
    eq(got.join(','), '100,200', 'аргументы пришли числами');
    debug_console.unregister('greet');
    falsy(debug_console.list().includes('greet'), 'команда снята');
});

test('$.console.run неизвестной команды возвращает false, а не падает', () => {
    eq(debug_console.run('нет-такой-команды'), false);
});

finish();
