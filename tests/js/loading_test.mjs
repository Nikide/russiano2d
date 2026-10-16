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
import { installResource, requestIoKind } from '../../src/highlevel/resource.js';
import { ctx } from '../../src/highlevel/core.js';

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

// ---------------------------------------------------------------------------
// §45: полоса по запросу ресурсов и асинхронный request
// ---------------------------------------------------------------------------

/** Управляемый запрос: тест сам решает, какой прогресс и событие отдать. */
function fakeRequest() {
    const listeners = {};
    const req = {
        state: 'loading',
        prog: { state: 'loading', stage: 'io', bytes_done: 0, bytes_total: 100,
                bytes_known: true, jobs_done: 0, jobs_total: 1, estimated: false,
                cancelled: false, failed: false, names: ['a'] },
        progress() { return Object.assign({}, this.prog); },
        done() { return this.state === 'ready' || this.state === 'failed' || this.state === 'cancelled'; },
        error() { return this.state === 'failed' ? { code: 'R2D_LOAD_RESOURCE', message: 'нет файла' } : null; },
        cancel() {
            if (this.done()) return false;
            this.state = 'cancelled';
            this.prog.cancelled = true;
            this.fire('cancelled');
            return true;
        },
        on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); return req; },
        fire(event) { for (const fn of (listeners[event] || []).slice()) fn(req); },
    };
    return req;
}

test('watch: полоса показывает реальные байты и стадию', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    const req = fakeRequest();
    loading.show({ title: 'груз' }).watch(req);
    eq(loading.watched(), req, 'экран знает запрос');
    req.prog.bytes_done = 50;
    req.prog.stage = 'io';
    env.$.tick();
    eq(env.ui.children[2].nodes[0].value, 500, 'полоса по байтам: 50 из 100');
    truthy(env.ui.children[3].nodes[0].text.includes('50 Б'), 'байты в подписи: ' + env.ui.children[3].nodes[0].text);
    truthy(env.ui.children[3].nodes[0].text.includes('чтение'), 'стадия в подписи');
    env.ui.children[3].nodes[0].text.includes('оценочно');
    falsy(env.ui.children[3].nodes[0].text.includes('оценочно'),
          'точная I/O-стадия не помечена оценочной');

    req.prog.bytes_done = 100;
    req.prog.stage = 'apply';
    req.prog.estimated = true;
    req.state = 'ready';
    req.fire('ready');
    truthy(env.ui.children[3].nodes[0].text.includes('оценочно'),
           'стадия применения помечена «оценочно»');
    near(loading.value(), 1, 1e-9, 'готовый запрос — полная полоса');
});

test('watch: отмена видна на экране и зовётся $.loading.cancel()', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    const req = fakeRequest();
    loading.show().watch(req);
    eq(loading.cancel(), true, 'cancel() отменяет запрос');
    eq(req.state, 'cancelled');
    truthy(env.ui.children[3].nodes[0].text.includes('отменено'),
           'подпись говорит об отмене: ' + env.ui.children[3].nodes[0].text);
    eq(loading.cancel(), false, 'повторная отмена — false (запрос уже не активен)');
});

test('watch: неизвестная доля честно идёт по задачам, а не по процентам', () => {
    const env = makeEnv();
    const loading = createLoading(env.ctx);
    const req = fakeRequest();
    req.prog.bytes_known = false;
    req.prog.bytes_total = 0;
    req.prog.jobs_total = 4;
    req.prog.jobs_done = 2;
    req.prog.stage = 'decode';
    req.prog.estimated = true;      // так помечает сам request, когда байтов нет
    loading.show().watch(req);
    eq(env.ui.children[2].nodes[0].value, 500, 'половина задач — половина полосы');
    truthy(env.ui.children[3].nodes[0].text.includes('2 / 4'), 'в подписи задачи');
    truthy(env.ui.children[3].nodes[0].text.includes('оценочно'), 'и пометка оценочности');
});

// ---------------------------------------------------------------------------
// §45: состояние запроса ресурсов (с моком engine.async)
// ---------------------------------------------------------------------------

/** Макет engine.async: задания копятся, тест сам решает, когда они готовы. */
function makeAsyncMock() {
    let next = 1;
    const jobs = new Map();
    const io = {
        cancelled: [],
        polled: 0,
        size(path) { return String(path).includes('missing') ? -1 : 100; },
        read(path) { const id = next++; jobs.set(id, { id, path, kind: 'read' }); return id; },
        image(path) { const id = next++; jobs.set(id, { id, path, kind: 'image' }); return id; },
        cancel(id) { io.cancelled.push(id); const j = jobs.get(id); if (j) j.cancelled = true; return !!j; },
        release(id) { jobs.delete(id); },
        takeText(id) { const j = jobs.get(id); return j && j.text !== undefined ? j.text : null; },
        takeTexture(id) { const j = jobs.get(id); return j && j.ok ? 7 : -1; },
        stats() { return { pending: jobs.size, done: 0, failed: 0, cancelled: 0, bytes: 0, workers: 1 }; },
        poll() {
            const out = [];
            for (const j of jobs.values()) {
                if (!j.ready || j.taken) continue;
                j.taken = true;
                io.polled++;
                out.push({
                    id: j.id, kind: j.kind, ok: !j.cancelled && j.ok !== false,
                    cancelled: !!j.cancelled,
                    path: j.path, size: 100,
                    error: j.error || (j.cancelled ? 'отменено' : null),
                    width: j.kind === 'image' ? 64 : 0, height: j.kind === 'image' ? 32 : 0,
                });
            }
            return out;
        },
        /** «Рабочий поток не смог»: все задания завершаются ошибкой. */
        failAll(message) {
            for (const j of jobs.values()) { j.ready = true; j.ok = false; j.error = message; }
        },
        /** «Рабочий поток доделал»: отметить все задания готовыми. */
        finishAll(text) {
            for (const j of jobs.values()) {
                j.ready = true;
                j.ok = !j.cancelled;
                if (j.kind === 'read') j.text = text === undefined ? '{"ok":true}' : text;
            }
        },
        jobCount() { return jobs.size; },
    };
    return io;
}

function makeResourceEnv(opts) {
    const o = opts || {};
    const env = makeEnv();
    const $ = env.$;
    $.fs = {
        readText: (path) => (String(path).includes('missing') ? null
            : (String(path).endsWith('.json') ? '{"sync":1}' : 'текст')),
        readJSON: (path, fallback) => (String(path).includes('missing')
            ? (fallback === undefined ? null : fallback) : { sync: 1 }),
        exists: (path) => !String(path).includes('missing'),
    };
    const errors = [];
    $.debug = { reportError: (where, err, o2) => errors.push({ where, code: o2 && o2.code, message: err.message }) };
    $._hooks = [];
    $.update = (fn) => { $._hooks.push(fn); };
    // installResource берёт ctx из core.js: хук $.update ставится через него.
    ctx.$ = $;
    if (o.async !== false) engine.async = makeAsyncMock();
    else delete engine.async;
    installResource($);
    return { env, $, errors, io: engine.async };
}

test('requestIoKind: что читать с диска, что декодировать, что не файл', () => {
    eq(requestIoKind({ kind: 'texture', path: 'a.png' }), 'image');
    eq(requestIoKind({ kind: 'sheet', path: 'a.png' }), 'image');
    eq(requestIoKind({ kind: 'sprite', path: 'a.png' }), 'image');
    eq(requestIoKind({ kind: 'sprite', path: 'a.png', crop: true }), 'none');
    eq(requestIoKind({ kind: 'sound', path: 'a.ogg' }), 'read');
    eq(requestIoKind({ kind: 'json', path: 'a.json' }), 'read');
    eq(requestIoKind({ kind: 'data', value: 1 }), 'none');
    eq(requestIoKind({ kind: 'texture' }), 'none');
});

test('request: queued → loading → ready, байты точные, значения в реестре', () => {
    const { $, io } = makeResourceEnv();
    const req = $.resource.request([
        { name: 'tex', kind: 'texture', path: 'a.png' },
        { name: 'cfg', kind: 'json', path: 'a.json' },
    ]);
    eq(req.state(), 'loading', 'I/O сразу в работе');
    const p0 = req.progress();
    eq(p0.bytes_total, 200, 'знаменатель — сумма размеров файлов');
    eq(p0.bytes_known, true);
    eq(p0.estimated, false, 'I/O-стадия точная');
    eq(p0.stage, 'io');
    eq(io.jobCount(), 2, 'два задания у ядра');

    io.finishAll();                  // «рабочий поток доделал»
    $._hooks[0]();                   // кадр: poll + применение (бюджет 2)
    eq(req.state(), 'ready', 'запрос готов за один кадр с бюджетом 2');
    const p1 = req.progress();
    eq(p1.bytes_done, 200, 'байты сошлись');
    eq(p1.jobs_done, 2);
    eq(req.value('tex'), 7, 'текстура из ядра');
    eq(JSON.stringify(req.value('cfg')), '{"ok":true}', 'JSON разобран');
    eq($.resource.get('tex'), 7, 'значение попало в реестр');
    eq($.resource.stats().workers, 1, 'stats знает про рабочий поток');
});

test('request: неверный путь → failed и структурная ошибка', () => {
    const { $, errors, io } = makeResourceEnv();
    const req = $.resource.request([{ name: 'bad', kind: 'texture', path: 'missing.png' }]);
    eq(req.state(), 'loading', 'сначала ждём результат ядра');
    // Ядро не смогло прочитать файл — результат приходит ошибкой.
    io.failAll('файл "missing.png" не найден');
    $._hooks[0]();
    eq(req.state(), 'failed', 'запрос упал');
    const err = req.error();
    eq(err.code, 'R2D_LOAD_RESOURCE', 'код ошибки структурный');
    truthy(err.message.includes('missing.png'), 'в причине назван путь: ' + err.message);
    truthy(errors.length >= 1, '$.debug.reportError вызван');
    eq(errors[0].code, 'R2D_LOAD_RESOURCE');
});

test('request: отмена освобождает задания и не применяет поздний результат', () => {
    const { $, io } = makeResourceEnv();
    const req = $.resource.request([{ name: 'tex', kind: 'texture', path: 'a.png' }]);
    eq(req.cancel(), true, 'отмена принята');
    eq(req.state(), 'cancelled');
    eq(io.cancelled.length, 1, 'задание отменено у ядра');
    eq($.resource.info('tex').state !== 'ready', true, 'в реестре нет готового значения');
    io.finishAll();
    $._hooks[0]();
    eq(req.state(), 'cancelled', 'поздний результат проигнорирован');
    eq(req.cancel(), false, 'повторная отмена — false');
});

test('request: без engine.async работает синхронный путь, доля помечена оценочной', () => {
    const { $ } = makeResourceEnv({ async: false });
    const req = $.resource.request([{ name: 'cfg', kind: 'json', path: 'a.json' }]);
    eq(req.state(), 'ready', 'синхронный путь завершается сразу');
    eq(JSON.stringify(req.value('cfg')), '{"sync":1}');
    const p = req.progress();
    eq(p.estimated, true, 'синхронный путь помечен оценочным (I/O не фоновый)');
    eq(p.bytes_known, true, 'размер файла известен и здесь (читает $.fs)');
    eq(p.bytes_total, 10, 'знаменатель — длина прочитанного текста');
});

finish();
