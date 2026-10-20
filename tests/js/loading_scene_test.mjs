// ===========================================================================
// Юнит-тесты асинхронной загрузки сцены как job ($.scene.job) и стандартного
// входа $.loading.scene — без движка (qjs + tests/js/_harness.mjs).
//
// Проверяем контракт задания (§45 / FINAL ENGINE PASS):
//   * state/ratio/fraction/completed/total/current/error/done/cancel + on/off;
//   * события progress (каждый кадр), done, error, cancel, activated;
//   * активация ОТДЕЛЬНА от приобретения: done — ресурсы и шаги готовы,
//     activated — мир уже сменился;
//   * отмена не оставляет половины мира, повторные job не копят подписки/узлы;
//   * закешированные/preloaded ассеты посчитаны в total/completed;
//   * $.loading.scene показывает экран (встроенный или свой .rml/.rcss) и
//     возвращает job; экран гасится по activated, а не по done.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/loading_scene_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node } from '../../src/highlevel/core.js';
import { installScene } from '../../src/highlevel/scene.js';
import { createLoading } from '../../src/highlevel/loading.js';
import { engine } from '../../src/highlevel/native.js';

// --- Макет узла интерфейса (встроенный экран загрузки) ----------------------
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
    };
}

// --- Кадровые заглушки -------------------------------------------------------
const env = (() => {
    const ui = { children: [] };
    const hooks = [];
    const logs = [];
    const requests = [];
    // ctx.log пишет в engine.log — перехватываем журнал, чтобы проверять
    // предупреждения экрана (в харнессе engine.log — no-op).
    engine.log = (message) => logs.push(String(message));
    const $ = (tag, attrs) => makeNode(tag, attrs);
    $.ui = ui;
    $.window = { size: () => ({ w: 800, h: 600 }) };
    $.update = (fn) => { hooks.push(fn); };
    $.tick = () => { for (const fn of hooks.slice()) fn(); };
    $.hookCount = () => hooks.length;
    $._dispatchGlobal = () => {};
    $.debug = { reportError: (where, error, opts) => logs.push('debug:' + (opts && opts.code)) };
    return { $, ui, hooks, logs, requests };
})();
const $ = env.$;

// Заглушки, которые трогает clearWorld()/doSwitch() при смене сцены.
ctx.$ = $;
ctx.byId = new Map();
ctx.timers = [];
ctx.animations = [];
ctx.time = { cancelAll() {}, resume() {}, pause() {}, isPaused: () => false };
ctx.world = { clearBounds() {}, resume() {}, timeScale() {} };

const scene = installScene($);
$.scene = scene;
const loading = createLoading(ctx);
ctx.loading = loading;
$.loading = loading;

// --- Управляемая задача ($.task.chunked) ------------------------------------
function makeTask() {
    const tasks = [];
    const task = {
        tasks,
        chunked(spec) {
            const t = {
                abort_called: false,
                spec,
                index: 0,
                total: Math.max(1, Math.floor(spec.total || 1)),
                aborted: false,
                done_called: false,
                progress() { return Math.min(1, this.index / this.total); },
                tick() {
                    if (this.done_called || this.aborted) return;
                    if (this.index < this.total) {
                        try { spec.step(this.index, this.total); }
                        catch (e) { this.aborted = true; }
                        this.index++;
                    }
                    if (this.index >= this.total) {
                        this.done_called = true;
                        if (typeof spec.done === 'function') spec.done(this.aborted);
                    }
                },
                abort() {
                    if (this.done_called) return false;
                    this.aborted = true;
                    this.abort_called = true;
                    this.done_called = true;
                    return true;
                },
            };
            tasks.push(t);
            // Как $.task: задача принадлежит области загрузчика и отменяется
            // при её закрытии (иначе отмена job оставляла бы шаги в работе).
            if (spec.scope && typeof spec.scope.own === 'function') {
                spec.scope.own('task', t, () => t.abort(), spec);
            }
            return t;
        },
        tick() { for (const t of tasks.slice()) t.tick(); },
        running() { return tasks.filter((t) => !t.done_called).length; },
    };
    return task;
}
const task = makeTask();
ctx.task = task;

// --- Управляемый запрос ресурсов ($.resource.request) -----------------------
function fakeRequest(names) {
    const listeners = {};
    const req = {
        state_: 'loading',
        error_: null,
        prog: {
            state: 'loading', stage: 'io',
            bytes_done: 0, bytes_total: 200, bytes_known: true,
            jobs_done: 0, jobs_total: names.length || 2, estimated: false,
            cancelled: false, failed: false, names: names.slice(),
        },
        progress() { return Object.assign({}, this.prog); },
        state() { return this.state_; },
        done() { return this.state_ === 'ready' || this.state_ === 'failed' || this.state_ === 'cancelled'; },
        ok() { return this.state_ === 'ready'; },
        error() { return this.error_; },
        cancel() {
            if (this.done()) return false;
            this.state_ = 'cancelled';
            this.prog.cancelled = true;
            this.fire('cancelled');
            return true;
        },
        on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); return req; },
        fire(event) { for (const fn of (listeners[event] || []).slice()) fn(req); },
        finish() {
            this.state_ = 'ready';
            this.prog.state = 'ready';
            this.prog.stage = 'done';
            this.prog.bytes_done = this.prog.bytes_total;
            this.prog.jobs_done = this.prog.jobs_total;
            this.fire('ready');
        },
        fail(message) {
            this.state_ = 'failed';
            this.error_ = { code: 'R2D_LOAD_RESOURCE', message, path: 'assets/missing.png', stage: 'io' };
            this.fire('failed');
        },
    };
    return req;
}
$.resource = {
    request(specs) {
        const names = (specs || []).map((s, i) => (s && s.name) || ('r' + i));
        const req = fakeRequest(names);
        env.requests.push(req);
        return req;
    },
};

// --- Сцены ------------------------------------------------------------------
let entered = 0;
const created = [];
scene.add('menu', { enter() { entered++; } });
scene.add('level', {
    enter() {
        entered++;
        created.push(new Node('rect', { id: 'level-node' }));
    },
});

/** Один кадр: задачи → кадровые хуки ($.update/насос job) → сцена. */
function frame(dt) {
    task.tick();
    $.tick();
    scene._tick(dt === undefined ? 1 / 60 : dt);
}

/** Довести переходы/активацию до конца (до 40 кадров). */
function settle(limit) {
    const n = limit === undefined ? 40 : limit;
    for (let i = 0; i < n; i++) frame(0.4);
}

function resetWorld() {
    for (const node of ctx.nodes.slice()) if (!node.removed && !node.parent_node) node.destroy();
    for (const [id, node] of [...ctx.byId.entries()]) if (node.removed) ctx.byId.delete(id);
    ctx.nodes.length = 0;
}

function fresh() {
    loading.hide();
    const st = scene._state;
    st.transition = null;
    st.phase = null;
    st.pending = null;
    st.pending_opts = null;
    st.load = null;
    st.deferred = null;
    st.current = null;
    st.current_name = '';
    st.progress = { total: 0, done: 0, ratio: 0, label: '' };
    resetWorld();
    entered = 0;
    created.length = 0;
    env.logs.length = 0;
    env.requests.length = 0;
    task.tasks.length = 0;
}

/** Поставить стартовую сцену и мир. */
function startMenu() {
    scene.load('menu', { transition: 'none' });
    frame(0);
    eq(scene.current(), 'menu');
}

// ---------------------------------------------------------------------------
// $.scene.job: API и прогресс
// ---------------------------------------------------------------------------

test('job: handle с state/progress/ratio/fraction/completed/total/current и on/off', () => {
    fresh();
    startMenu();
    const job = scene.job('level', {
        steps: [{ label: 'сборка', total: 3, work: () => {} }],
    });
    truthy(job, 'job вернулся');
    eq(job.name, 'level');
    eq(job.state, 'loading');
    eq(job.acquired, false);
    eq(job.done(), false);
    eq(typeof job.on, 'function');
    eq(typeof job.off, 'function');
    eq(typeof job.emit, 'function');
    eq(typeof job.cancel, 'function');
    eq(job.progress().ratio, 0);
    eq(job.progress().fraction, 0);
    eq(job.total(), 3, 'total — единицы работы шага');
    eq(job.completed(), 0);
    eq(job.stage(), 'сборка', 'стадия — подпись текущего шага');
    eq(job.current(), 'сборка');
    eq(scene.pending(), job, 'pending() отдаёт тот же job');

    const seen = [];
    job.on('progress', (p) => seen.push(p.ratio));
    frame();
    near(job.progress().ratio, 1 / 3, 1e-9, 'после кадра — треть работы');
    near(job.completed(), 1, 1e-9);
    eq(job.ratio(), job.progress().ratio);
    truthy(seen.length >= 1, 'событие progress пришло каждый кадр');
    truthy(seen[seen.length - 1] > 0, 'доля растёт');
    eq(job.progress().jobs_total, 3, 'сырые поля шагов сохранены (совместимость)');
});

test('job: done — приобретение, activated — публикация мира (раздельно)', () => {
    fresh();
    startMenu();
    const order = [];
    const job = scene.job('level', {
        steps: [{ label: 'сборка', total: 2, work: () => {} }],
    });
    job.on('done', () => order.push('done'));
    job.on('activated', () => order.push('activated'));

    for (let i = 0; i < 3; i++) frame();
    eq(job.state, 'ready', 'приобретение завершено');
    eq(job.acquired, true);
    eq(order.join(','), 'done', 'done прозвучал, активации ещё не было');
    eq(job.activated(), false, 'мир ещё не сменился');
    eq(scene.current(), 'menu', 'текущая сцена прежняя: активация отдельна');

    frame(0.4);      // машина сцен публикует мир
    eq(scene.current(), 'level', 'мир сменился');
    frame();         // насос job замечает активацию
    eq(job.activated(), true);
    eq(order.join(','), 'done,activated', 'порядок событий: приобретение → активация');
    eq(loading.visible(), false, 'экран не при делах: job его не показывал');
});

test('job: отмена до активации не публикует мир и не оставляет узлов', () => {
    fresh();
    startMenu();
    const before_nodes = scene.counts().nodes;
    const job = scene.job('level', {
        steps: [{ label: 'сборка', total: 50, work: () => {} }],
    });
    const events = [];
    job.on('cancel', () => events.push('cancel'));
    frame();
    near(job.progress().ratio, 1 / 50, 1e-9, 'загрузка успела начаться');
    eq(job.cancel('передумали'), true);
    eq(job.state, 'cancelled');
    eq(job.done(), true);
    eq(events.join(','), 'cancel');
    eq(job.cancel('ещё раз'), false, 'повторная отмена — false');

    for (let i = 0; i < 20; i++) frame(0.4);
    eq(scene.current(), 'menu', 'отменённая сцена не появилась');
    eq(entered, 1, 'enter отменённой сцены не вызывался (был только menu)');
    eq(scene.counts().nodes, before_nodes, 'узлов не прибавилось — половины мира нет');
    eq(task.running(), 0, 'задачи отменённого job сняты');
});

test('job: ошибка ресурсов — error-событие и структурная причина', () => {
    fresh();
    startMenu();
    const job = scene.job('level', { resources: ['assets/missing.png'] });
    const errors = [];
    job.on('error', (e) => errors.push(e));
    eq(job.state, 'loading');
    env.requests[0].fail('файл "assets/missing.png" не найден');
    eq(job.state, 'failed');
    eq(errors.length, 1, 'событие error пришло один раз');
    eq(errors[0].code, 'R2D_LOAD_RESOURCE');
    truthy(String(errors[0].message).indexOf('missing.png') > 0, errors[0].message);
    truthy(job.done(), 'упавший job завершён');
    eq(job.cancel(), false, 'упавший job не отменяется');
    for (let i = 0; i < 10; i++) frame(0.4);
    eq(scene.current(), 'menu', 'мир сцены из упавшей загрузки не опубликован');
});

test('job: поздняя подписка на done/error срабатывает сразу', () => {
    fresh();
    startMenu();
    const job = scene.job('level', { steps: [{ label: 'раз', total: 1, work: () => {} }] });
    for (let i = 0; i < 3; i++) frame();
    eq(job.state, 'ready');
    let done = 0;
    job.on('done', () => done++);
    eq(done, 1, 'подписка после завершения получила done');
    frame();
    frame();
    eq(done, 1, 'и повторно не срабатывает');
});

// ---------------------------------------------------------------------------
// Повторные job и закешированные ресурсы
// ---------------------------------------------------------------------------

test('job: повторные загрузки не копят мир/узлы/подписки', () => {
    fresh();
    startMenu();
    const marker = scene.counts().nodes;
    for (let i = 0; i < 12; i++) {
        const job = scene.job('level', {
            steps: [{ label: 'уровень ' + i, total: 2, work: () => {} }],
        });
        let done = 0;
        job.on('done', () => done++);
        for (let f = 0; f < 4; f++) frame(0.4);
        eq(job.state, 'ready', 'job ' + i + ' завершён');
        eq(done, 1, 'job ' + i + ': done ровно один раз');
        eq(scene.pending() === job, true, 'pending() — последний job');
    }
    eq(scene.current(), 'level');
    eq(scene.counts().nodes, marker + 1, 'живой мир ровно один, а не 12');
    eq(scene.counts().scopes, 0, 'лишних областей загрузчика не осталось');
    const last = scene.pending();
    const seen = [];
    last.on('progress', (p) => seen.push(p.ratio));
    for (let f = 0; f < 5; f++) frame();
    eq(seen.length, 0, 'завершённый job больше не рассылает progress');
});

test('job: закешированные/preloaded ресурсы посчитаны в total/completed', () => {
    fresh();
    startMenu();
    const req = fakeRequest(['cached-a', 'cached-b', 'cached-c']);
    req.prog.jobs_total = 3;
    req.prog.jobs_done = 3;
    req.prog.bytes_known = false;
    req.prog.bytes_total = 0;
    req.state_ = 'ready';          // «всё уже в памяти»
    const job = scene.job('level', { resources: req });
    truthy(job, 'job вернулся');
    eq(job.state, 'ready', 'готовый запрос завершает приобретение сразу');
    eq(job.total(), 3, 'total — все три закешированных ресурса');
    eq(job.completed(), 3, 'completed — все три');
    near(job.progress().ratio, 1, 1e-9);
    eq(job.progress().jobs_total, 3, 'счётчики запроса не затёрты нулём шагов');
    frame(0.4);
    frame();
    eq(scene.current(), 'level', 'сцена активировалась после готового запроса');
});

test('job: без steps/resources — нечего грузить, но job и активация есть', () => {
    fresh();
    startMenu();
    const job = scene.job('level');
    truthy(job, 'job вернулся и без работы');
    eq(job.state, 'ready');
    eq(job.done(), true);
    eq(job.cancel(), false);
    near(job.ratio(), 1, 1e-9);
    let activated = 0;
    job.on('activated', () => activated++);
    frame(0.4);
    frame();
    eq(scene.current(), 'level', 'сцена переключилась');
    eq(activated, 1, 'активация сообщена');
});

// ---------------------------------------------------------------------------
// $.loading.scene: стандартный вход с экраном
// ---------------------------------------------------------------------------

test('loading.scene: встроенный экран по умолчанию, job возвращается, экран гаснет по activated', () => {
    fresh();
    startMenu();
    const job = loading.scene('level', {
        title: 'Готовим уровень…',
        steps: [{ label: 'сборка', total: 3, work: () => {} }],
    });
    truthy(job, 'loading.scene вернул job');
    eq(loading.job(), job);
    truthy(loading.visible(), 'экран показан по умолчанию');
    eq(env.ui.children.length, 5, 'встроенный экран: фон, заголовок, полоса, подпись, подсказка');
    eq(env.ui.children[1].attrs.text, 'Готовим уровень…');
    frame();
    truthy(loading.value() > 0, 'экран получает прогресс job');
    truthy(loading.value() < 1, 'и не врёт про 100% заранее');
    eq(job.state, 'loading');

    for (let i = 0; i < 6; i++) frame(0.4);
    eq(scene.current(), 'level', 'сцена загрузилась');
    falsy(loading.visible(), 'экран погашен по activated, а не по done');
    eq(env.ui.children.length, 0, 'узлы экрана убраны');
    eq(loading.job(), null, 'экран отпустил job');
});

test('loading.scene: отмена отменяет job и убирает экран, мир прежний', () => {
    fresh();
    startMenu();
    const job = loading.scene('level', {
        steps: [{ label: 'сборка', total: 30, work: () => {} }],
    });
    frame();
    truthy(loading.visible());
    eq(loading.cancel('кнопка отмены'), true);
    eq(job.state, 'cancelled');
    falsy(loading.visible(), 'экран убран по событию cancel');
    for (let i = 0; i < 10; i++) frame(0.4);
    eq(scene.current(), 'menu', 'отменённая сцена не появилась');
    eq(loading.job(), null);
});

test('loading.scene: screen:false — экран не показывается, job живёт', () => {
    fresh();
    startMenu();
    const job = loading.scene('level', {
        screen: false,
        steps: [{ label: 'сборка', total: 1, work: () => {} }],
    });
    truthy(job);
    falsy(loading.visible(), 'своего экрана нет');
    eq(env.ui.children.length, 0);
    for (let i = 0; i < 4; i++) frame(0.4);
    eq(scene.current(), 'level');
});

// ---------------------------------------------------------------------------
// Свой RmlUi-экран: $.loading.show({rml}) / $.loading.rml()
// ---------------------------------------------------------------------------

/** Документ-обёртка, какую отдаёт $.ui.doc: наличие элемента — content() !== null. */
function makeFakeDoc(path, elements) {
    const view = { shown: false, hidden: 0, text: {}, attr: {} };
    const doc = {
        id: 7,
        path,
        view,
        show() { view.shown = true; return this; },
        hide() { view.shown = false; view.hidden++; return this; },
        text(element, value) { view.text[element] = String(value); return this; },
        attr(element, name, value) {
            (view.attr[element] = view.attr[element] || {})[name] = String(value);
            return this;
        },
        content(element) {
            return Object.prototype.hasOwnProperty.call(elements, element)
                ? (view.text[element] === undefined ? '' : view.text[element]) : null;
        },
    };
    return doc;
}

function useUiDoc(elements) {
    // Документы кэшируются по пути, как в $.ui.doc: обёртка одна на файл.
    const cache = new Map();
    let last_path = null;
    $.ui.doc = (path) => {
        last_path = path;
        if (!cache.has(path)) cache.set(path, makeFakeDoc(path, elements));
        return cache.get(path);
    };
    $.ui.docPath = () => last_path;
}

test('loading.show({rml}): документ вместо встроенных узлов, полоса и подпись обновляются', () => {
    fresh();
    useUiDoc({ 'loading-bar': '', 'loading-label': '' });
    truthy(loading.show({ rml: 'ui/loading.rml', value: 0 }), 'show вернул $.loading');
    eq($.ui.docPath(), 'ui/loading.rml', 'свой документ — через $.ui.doc');
    truthy(loading.visible());
    eq(env.ui.children.length, 0, 'встроенные узлы не создаются: система одна');
    loading.progress(0.4, 'деревья');
    const doc = $.ui.doc('ui/loading.rml');
    eq(doc.view.attr['loading-bar'].value, '400', 'полоса — атрибут value 0..1000');
    eq(doc.view.text['loading-label'], '40% · деревья', 'подпись — процент и шаг');
    loading.hide();
    eq(doc.view.shown, false, 'hide скрыл документ');
    falsy(loading.visible());
});

test('loading.rml: документ без loading-bar/loading-label — показываем и честно предупреждаем', () => {
    fresh();
    useUiDoc({});
    loading.rml('ui/plain.rml');
    truthy(loading.visible(), 'документ показан');
    loading.progress(0.5, 'шаг');
    eq(loading.value(), 0.5, 'прогресс доступен через API');
    truthy(env.logs.some((m) => String(m).indexOf('нет элементов loading-bar/loading-label') >= 0),
        'одно предупреждение в журнал: ' + env.logs.join(' | '));
    loading.progress(0.7);
    eq(env.logs.filter((m) => String(m).indexOf('нет элементов') >= 0).length, 1,
        'предупреждение не повторяется каждый кадр');
});

test('loading.rml({rcss}): .rcss встраивается существующим loadMarkup', () => {
    fresh();
    const seen = { markup: null, name: null, attrs: {}, texts: {}, unloaded: [] };
    const old_ui = engine.ui;
    engine.ui = {
        loadMarkup(name, markup) { seen.name = name; seen.markup = markup; return 5; },
        show() {}, hide() {},
        unload(id) { seen.unloaded.push(id); },
        setText(id, element, value) { seen.texts[element] = String(value); },
        setAttr(id, element, name, value) { seen.attrs[element] = seen.attrs[element] || {}; seen.attrs[element][name] = String(value); },
        getText(id, element) { return Object.prototype.hasOwnProperty.call({ 'loading-bar': 1, 'loading-label': 1 }, element) ? '' : null; },
    };
    $.fs = {
        readText: (path) => (String(path).endsWith('.rml')
            ? '<rml><head></head><body><div id="loading-bar"/><div id="loading-label"/></body></rml>'
            : ':root { --accent: #5ce1e6; }'),
    };
    try {
        loading.show({ rml: 'ui/loading.rml', rcss: 'ui/loading.rcss' });
        eq(seen.name, 'loading:ui/loading.rml');
        truthy(String(seen.markup).indexOf('<style>:root { --accent: #5ce1e6; }</style>') >= 0,
            'rcss встроен в разметку: ' + seen.markup);
        loading.progress(0.25, 'лес');
        eq(seen.attrs['loading-bar'].value, '250');
        eq(seen.texts['loading-label'], '25% · лес');
        loading.hide();
        eq(seen.unloaded.join(','), '5', 'созданный нами документ выгружен');
    } finally {
        engine.ui = old_ui;
        delete $.fs;
    }
});

test('loading.scene: свой RML по opts.rml вместо встроенного экрана', () => {
    fresh();
    startMenu();
    useUiDoc({ 'loading-bar': '', 'loading-label': '' });
    const job = loading.scene('level', {
        rml: 'ui/loading.rml',
        steps: [{ label: 'сборка', total: 2, work: () => {} }],
    });
    truthy(job);
    eq($.ui.docPath(), 'ui/loading.rml');
    eq(env.ui.children.length, 0, 'встроенный экран не создавался');
    for (let i = 0; i < 6; i++) frame(0.4);
    eq(scene.current(), 'level');
    eq(loading.visible(), false, 'свой экран погашен по activated');
    eq(loading.job(), null);
});

finish();
