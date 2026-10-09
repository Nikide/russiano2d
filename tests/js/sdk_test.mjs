// ===========================================================================
// Юнит-тест $.sdk без движка: разбор вывода CLI, коды ошибок запуска и
// очередь процессов через подменённый бэкенд.
//
// Запуск: build/_deps/quickjs-build/qjs tests/js/sdk_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { describeStartError, extractJson, makeResult, installSdk, tickSdk } from '../../src/highlevel/sdk.js';

const $ = {};
installSdk($);

test('extractJson берёт последнюю JSON-строку среди логов', () => {
    const out = '[r2d] лог\n{"ok":false}\nшум\n{"ok":true,"n":3}\n';
    eq(extractJson(out).n, 3);
    eq(extractJson('{"a":1}').a, 1);
    eq(extractJson(''), null);
    eq(extractJson('не json'), null);
    eq(extractJson('{битый'), null);
});

test('describeStartError даёт подсказку для каждого кода', () => {
    for (const code of [-1, -2, -3, -4, -5]) truthy(describeStartError(code).length > 10, 'код ' + code);
    truthy(describeStartError(-1).includes('toolHost'), 'подсказка про toolHost');
    truthy(describeStartError(-99).includes('-99'));
});

test('makeResult: ok только при коде 0 и json.ok !== false', () => {
    eq(makeResult('tool', { exitCode: 0, output: '{"ok":true}' }).ok, true);
    eq(makeResult('tool', { exitCode: 0, output: '{"ok":false}' }).ok, false);
    eq(makeResult('tool', { exitCode: 1, output: '{"ok":true}' }).ok, false);
    const noJson = makeResult('tool', { exitCode: 0, output: 'мусор' });
    eq(noJson.ok, false);
    truthy(noJson.error, 'нет JSON — ошибка');
    eq(makeResult('engine', { exitCode: 0, output: 'лог' }).ok, true);
    eq(makeResult('engine', { exitCode: 0, output: '' }, 'таймаут').ok, false);
});

// --- Очередь через подменённый бэкенд ---------------------------------------
const calls = { started: [], killed: [], released: [] };
let next_id = 0;
const jobs = new Map();
const fake = {
    on: true,
    available() { return this.on; },
    start(kind, args) {
        const id = next_id++;
        calls.started.push({ kind, args });
        jobs.set(id, { running: true, exitCode: null, output: '', truncated: false, killed: false });
        return id;
    },
    poll(id) { return jobs.get(id) || null; },
    kill(id) { calls.killed.push(id); const j = jobs.get(id); if (j) { j.running = false; j.exitCode = -9; j.killed = true; } return true; },
    release(id) { calls.released.push(id); jobs.delete(id); },
    paths() { return { tool: '/x/r2d-sdk', toolFound: true, engine: '/x/russiano2d', exeDir: '/x/' }; },
};
$.sdk._setBackend(fake);

const captured = {};
test('tool() ставит процесс и не разрешается, пока он идёт', () => {
    truthy($.sdk.available());
    $.sdk.tool(['validate', 'a.json']).then((r) => { captured.tool = r; });
    eq(calls.started.length, 1);
    eq(calls.started[0].kind, 'tool');
    eq(calls.started[0].args.join(' '), 'validate a.json');
    eq($.sdk.active(), 1);
    tickSdk(1 / 60);
    eq($.sdk.active(), 1, 'процесс ещё идёт');
});

test('launch() отдаёт id и kill()', () => {
    const g = $.sdk.launch(['--game', 'demos']);
    eq(g.id, 1);
    g.done.then((r) => { captured.game = r; });
    eq(calls.started[1].kind, 'engine');
    g.kill();
    eq(calls.killed.join(','), '1');
});

test('таймаут убивает процесс и завершает Promise ошибкой', () => {
    $.sdk.tool(['slow'], { timeout: 100 }).then((r) => { captured.slow = r; });
    for (let i = 0; i < 10; i++) tickSdk(1 / 60);
    truthy(calls.killed.includes(2), 'процесс убит по таймауту');
    falsy($.sdk.active() > 1 && jobs.has(2), 'запись удалена');
});

// Завершаем первый процесс.
jobs.get(0).running = false;
jobs.get(0).exitCode = 0;
jobs.get(0).output = '{"ok":true,"diagnostics":[]}\n';
tickSdk(1 / 60);
tickSdk(1 / 60);
await null; await null; await null;

test('результаты дошли до Promise', () => {
    truthy(captured.tool, 'tool разрешился');
    eq(captured.tool.ok, true);
    eq(captured.tool.json.diagnostics.length, 0);
    truthy(captured.game, 'launch завершён');
    eq(captured.game.killed, true);
    eq(captured.game.ok, false);
    truthy(captured.slow, 'slow завершён');
    truthy(captured.slow.error.includes('таймаут'));
    truthy(calls.released.includes(0), 'процесс освобождён');
});

test('выключенный мост отклоняет вызовы с подсказкой', () => {
    fake.on = false;
    falsy($.sdk.available());
    let err = null;
    try { $.sdk.launch(['x']); } catch (e) { err = e; }
    truthy(err && err.message.includes('toolHost'), 'launch бросает с подсказкой');
    $.sdk.tool(['x']).then(() => { captured.bad = 'resolved'; }, (e) => { captured.bad = e.message; });
});
await null; await null;
test('tool() при выключенном мосте — отклонённый Promise', () => {
    truthy(String(captured.bad).includes('toolHost'), String(captured.bad));
});

test('аргументы не массив — отклонение', () => {
    fake.on = true;
    $.sdk.tool('validate a.json').then(() => { captured.badArgs = 'resolved'; }, (e) => { captured.badArgs = e.message; });
});
await null; await null;
test('нестроковые аргументы отклонены', () => {
    truthy(String(captured.badArgs).includes('массивом строк'), String(captured.badArgs));
});

test('paths() идёт через бэкенд', () => {
    eq($.sdk.paths().toolFound, true);
});

finish();
