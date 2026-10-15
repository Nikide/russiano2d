// ===========================================================================
// Сцены и области владения: $.scene — меню, уровни, пауза, переходы, scope.
//
// Сцена — это описание того, что живёт на экране: функции enter/exit/update.
// Переход отложенный: $.scene.load() только ставит запрос, а реальная смена
// происходит в начале следующего кадра. Так сцену можно менять прямо из
// обработчика клика (или из contact callback), не разрушая объект посреди его
// вызова.
//
// §5: необязательная ОБЛАСТЬ ВЛАДЕНИЯ (scope) связывает уже существующие
// узлы, подписки, ожидания, таймеры, потоки, задачи и удерживаемые ресурсы.
// Это lifecycle-объект, а не новая сущность scene graph и не второй реестр:
//
//   const room = $.scene.scope('room:level1');       // active
//   room.node($('<wall>', ...));                     // владение узлом
//   room.after(500, () => spawnWave());              // таймер области
//   $.signal.on('enemy:died', onDied, { scope: room });
//   $.task.chunked({ total: 400, step: build, scope: room });
//   room.close();                                    // closing → closed
//
// Состояния active → closing → closed. В closing область не принимает новые
// задачи, но ничего не разрушает; реальная отмена и удаление узлов происходит
// в БЕЗОПАСНОЙ ФАЗЕ кадра (tickLifecycle), поэтому close() можно звать из
// contact callback. Узлы, созданные вне области (persistent HUD, глобальные
// настройки), области не принадлежат и переживают restart комнаты; класс
// `scene-persistent` и `attrs.persistent` — явные исключения.
//
// Реестр узлов целиком не очищается: обычный `load()` без опции `scope`
// сохраняет прежнее поведение (clearWorld), а `load(name, { scope: true })`
// снимает только область прошлой сцены.
// ===========================================================================

import { ctx, wrap } from './core.js';
import { resetAcoustics } from './acoustics.js';
import { resetFx } from './fx.js';

const scenes = new Map();
const stack = [];
const state = {
    current: null,
    current_name: '',
    pending: null,
    pending_opts: null,
    transition: null,      // { type, ms, t, phase: 'out'|'in', to, opts }
    transition_type: 'fade',
    transition_ms: 300,
    history: [],
    // §5: генерация переходов. Любой новый load/prepare увеличивает счётчик —
    // завершившийся старый loader видит чужой токен и не публикует мир.
    generation: 0,
    scope_name: null,      // область текущей сцены
    loader_scope: null,    // область активного loadAsync
};

// ---------------------------------------------------------------------------
// §5. Область владения (lifecycle scope)
// ---------------------------------------------------------------------------

const scopes = new Map();     // имя → scope (active или closing)
const closing_scopes = [];    // closing, ждут безопасной фазы
let scope_seq = 0;

const BUCKETS = ['node', 'signal', 'wait', 'timer', 'task', 'flow', 'resource'];

function emptyBuckets() {
    const b = {};
    for (const key of BUCKETS) b[key] = [];
    return b;
}

/**
 * Область владения. Создаётся через `$.scene.scope(name)`; вручную new не
 * нужен. Все ресурсы области отменяются при close, узлы удаляются в
 * безопасной фазе кадра.
 */
function createScope(name, opts) {
    const o = opts || {};
    const scope = {
        name: String(name),
        _state: 'active',
        _items: emptyBuckets(),
        _close_fns: [],
        _closed_fns: [],
        _tags: o.tags ? [].concat(o.tags).map(String) : [],
        owner: o.owner === undefined ? null : o.owner,

        state() { return scope._state; },
        active() { return scope._state === 'active'; },
        closing() { return scope._state === 'closing'; },
        closed() { return scope._state === 'closed'; },

        /**
         * Взять ресурс под владение. `cancel(reason)` вызывается при закрытии;
         * для узла достаточно `scope.node(n)`.
         * Возвращает false, если область уже не active — ресурс при этом
         * сразу отменяется, чтобы не остался забытым.
         */
        own(kind, item, cancel, spec) {
            const bucket = scope._items[kind];
            if (!bucket) {
                if (typeof cancel === 'function') cancel('неизвестный вид владения');
                return false;
            }
            if (scope._state !== 'active') {
                if (typeof cancel === 'function') {
                    try { cancel(`scope "${scope.name}" закрыт`); } catch (e) { /* уже освобождён */ }
                }
                ctx.log(`$.scene.scope("${scope.name}"): ресурс ${kind} не принят — область ${scope._state}`);
                return false;
            }
            bucket.push({ item, cancel, spec: spec || null });
            return true;
        },

        /** Взять узел (или обёртку) под владение: удалится при закрытии. */
        node(value) {
            const list = value && value.nodes ? value.nodes : (value ? [value] : []);
            let taken = 0;
            for (const node of list) {
                if (!node || node.removed) continue;
                if (node.classes && node.classes.has('scene-persistent')) continue;
                if (node.attrs && node.attrs.persistent === true) continue;
                if (scope.own('node', node, () => { if (!node.removed) node.destroy(); })) taken++;
            }
            return taken;
        },

        /** Вернуть ресурс владельцу (область его больше не трогает). */
        keep(value) {
            let released = 0;
            for (const key of BUCKETS) {
                const bucket = scope._items[key];
                for (let i = bucket.length - 1; i >= 0; i--) {
                    if (bucket[i].item === value) { bucket.splice(i, 1); released++; }
                }
            }
            return released;
        },

        /** Scoped-таймер: как $.time.after, но отменяется с областью. */
        after(ms, fn) {
            if (scope._state !== 'active') {
                ctx.log(`$.scene.scope("${scope.name}"): after() после закрытия игнорирован`);
                return null;
            }
            if (!ctx.time || typeof ctx.time.after !== 'function') return null;
            const id = ctx.time.after(ms, fn);
            scope.own('timer', id, () => ctx.time.cancel(id));
            return id;
        },

        /** Scoped-периодический таймер: как $.time.every. */
        every(ms, fn) {
            if (scope._state !== 'active') {
                ctx.log(`$.scene.scope("${scope.name}"): every() после закрытия игнорирован`);
                return null;
            }
            if (!ctx.time || typeof ctx.time.every !== 'function') return null;
            const id = ctx.time.every(ms, fn);
            scope.own('timer', id, () => ctx.time.cancel(id));
            return id;
        },

        /** Подписка на закрытие (до отмены ресурсов). */
        onClose(fn) {
            if (typeof fn === 'function') scope._close_fns.push(fn);
            return scope;
        },

        /** Подписка на фактическое закрытие (после отмены ресурсов). */
        onClosed(fn) {
            if (typeof fn === 'function') scope._closed_fns.push(fn);
            return scope;
        },

        /** Сколько ресурсов каждого вида под владением (для тестов и отладки). */
        counts() {
            const out = { name: scope.name, state: scope._state };
            for (const key of BUCKETS) {
                let live = 0;
                for (const entry of scope._items[key]) if (!isDead(key, entry.item)) live++;
                out[key === 'signal' ? 'subs' : (key === 'wait' ? 'waits' : key + 's')] = live;
            }
            return out;
        },

        /** Живые узлы области. */
        nodes() {
            const out = [];
            for (const entry of scope._items.node) if (!isDead('node', entry.item)) out.push(entry.item);
            return out;
        },

        /** Начать закрытие. Реальная отмена — в безопасной фазе кадра. */
        close(opts) {
            if (scope._state !== 'active') return false;
            scope._state = 'closing';
            const o = opts || {};
            for (const fn of scope._close_fns.splice(0)) {
                try { fn(scope, o.reason); } catch (e) { ctx.log(`$: ошибка в scope.onClose: ${e}`); }
            }
            traceScope('scope:closing', scope, o.reason);
            if (o.immediate === true) finalizeScope(scope, o.reason);
            else closing_scopes.push(scope);
            return true;
        },

        /** Закрыть немедленно (смена сцены, тесты, teardown). */
        dispose(reason) { return scope.close({ immediate: true, reason }); },
    };
    return scope;
}

function isDead(kind, item) {
    if (item === undefined || item === null) return true;
    if (kind === 'node') return item.removed === true;
    if (kind === 'signal') return item.alive === false;
    if (kind === 'wait') return item.settled === true;
    if (kind === 'task') return item.done_called === true;
    if (kind === 'flow') return item.state !== 'pending';
    return false;
}

function traceScope(kind, scope, reason) {
    const trace = ctx.$ && ctx.$.trace;
    if (trace && typeof trace.note === 'function') {
        trace.note(kind, null, { scope: scope.name, state: scope._state, reason: reason || null });
    }
}

/** Отмена всех ресурсов области. Вызывается ТОЛЬКО из безопасной фазы. */
function finalizeScope(scope, reason) {
    if (!scope || scope._state === 'closed') return false;
    const why = reason === undefined || reason === null ? `scope "${scope.name}" закрыт` : reason;

    // Порядок важен: сначала ожидания и подписки (обработчик не должен увидеть
    // удалённый узел), затем таймеры/задачи/потоки, в конце — узлы.
    for (const entry of scope._items.wait.splice(0)) {
        try { entry.cancel(why); } catch (e) { /* ожидание уже снято */ }
    }
    for (const entry of scope._items.signal.splice(0)) {
        try { entry.cancel(why); } catch (e) { /* подписка уже снята */ }
    }
    for (const entry of scope._items.timer.splice(0)) {
        try { entry.cancel(why); } catch (e) { /* таймер уже сработал */ }
    }
    for (const entry of scope._items.task.splice(0)) {
        try { entry.cancel(why); } catch (e) { /* задача уже завершена */ }
    }
    for (const entry of scope._items.flow.splice(0)) {
        try { entry.cancel(why); } catch (e) { /* поток уже завершён */ }
    }
    for (const entry of scope._items.resource.splice(0)) {
        try { entry.cancel(why); } catch (e) { /* ресурс уже освобождён */ }
    }
    for (const entry of scope._items.node.splice(0)) {
        const node = entry.item;
        if (!node || node.removed) continue;
        if (node.classes && node.classes.has('scene-persistent')) continue;
        if (node.attrs && node.attrs.persistent === true) continue;
        try { node.destroy(); } catch (e) { ctx.log(`$: ошибка удаления узла области "${scope.name}": ${e}`); }
    }

    scope._state = 'closed';
    if (scopes.get(scope.name) === scope) scopes.delete(scope.name);
    if (ctx.scope_current === scope) ctx.scope_current = null;
    if (state.scope_name === scope.name) state.scope_name = null;
    if (state.loader_scope === scope) state.loader_scope = null;
    traceScope('scope:closed', scope, reason);
    for (const fn of scope._closed_fns.splice(0)) {
        try { fn(scope); } catch (e) { ctx.log(`$: ошибка в scope.onClosed: ${e}`); }
    }
    return true;
}

/**
 * Кадровый шаг lifecycle (§5). Вызывается из api.js после контактов и
 * отложенных изменений: именно здесь закрываются области, поэтому close()
 * безопасен внутри contact callback.
 */
export function tickLifecycle(dt) {
    void dt;
    if (closing_scopes.length === 0) return 0;
    const list = closing_scopes.splice(0);
    let closed = 0;
    for (const scope of list) if (finalizeScope(scope)) closed++;
    return closed;
}

/** Область по имени (без создания) или null. */
export function getScope(name) {
    return scopes.get(String(name)) || null;
}

/** Область по имени; нет активной — создать. */
export function ensureScope(name, opts) {
    const key = String(name);
    const found = scopes.get(key);
    if (found && found._state === 'active') return found;
    const scope = createScope(key, opts);
    scopes.set(key, scope);
    traceScope('scope:open', scope, null);
    return scope;
}

/** Узел создаётся: привязать к явному attrs.scope или текущему контексту. */
export function scopeTrackNode(node) {
    if (!node || node.removed) return null;
    if (node.classes && node.classes.has('scene-persistent')) return null;
    if (node.attrs && node.attrs.persistent === true) return null;
    const want = node.attrs ? node.attrs.scope : undefined;
    let scope = null;
    if (want !== undefined && want !== null && want !== false) {
        scope = ensureScope(want, {});
    } else {
        const current = ctx.scope_current;
        scope = current && typeof current.own === 'function' ? current : null;
    }
    if (!scope) return null;
    scope.node(node);
    return scope;
}

/** Новое имя области загрузчика: несколько подряд не конфликтуют. */
function nextScopeName(prefix, name) {
    scope_seq++;
    return `${prefix}:${name}:${scope_seq}`;
}

// ---------------------------------------------------------------------------
// Установка подсистемы
// ---------------------------------------------------------------------------

export function installScene($) {
    // Точки, которыми пользуются мои подсистемы (signal/flow/task) и api.js:
    // текущий контекст, поиск области и трекинг созданных узлов.
    ctx.scope_current = null;
    ctx.scopeGet = (name) => getScope(name);
    ctx.scopeEnsure = (name, opts) => ensureScope(name, opts);
    ctx.scopeTrack = scopeTrackNode;

    const scene = {
        /**
         * Регистрирует сцену.
         *   $.scene.add('menu', { enter($) {}, exit() {}, update(dt) {} });
         *   $.scene.add('level1', ($) => { ... построить мир ... });
         */
        add(name, definition) {
            // Отложенный запрос (см. load): как только сцена появилась —
            // выполняем его.
            if (state.deferred && state.deferred.name === name) {
                const req = state.deferred;
                state.deferred = null;
                scenes.set(name, definition);
                return scene.load(req.name, req.opts);
            }
            scenes.set(name, definition);
            return scene;
        },

        remove(name) { scenes.delete(name); return scene; },
        has(name) { return scenes.has(name); },
        names() { return [...scenes.keys()]; },
        /** Имя текущей сцены или null, если сцена ещё не выбрана. */
        current() { return state.current_name || null; },

        // --- §5: области владения ------------------------------------------

        /**
         * Область владения. Формы вызова:
         *   $.scene.scope('room:1')            → объект области (создаёт);
         *   $.scene.scope('room:1', () => …)   → выполнить код в контексте:
         *                                        созданные узлы/подписки/задачи
         *                                        принадлежат области.
         */
        scope(name, fnOrOpts, opts) {
            if (typeof fnOrOpts === 'function') return scene.inScope(name, fnOrOpts, opts);
            return ensureScope(name, fnOrOpts || {});
        },

        /** Выполнить fn в контексте области; возвращает результат fn. */
        inScope(name, fn, opts) {
            const scope = ensureScope(name, opts || {});
            if (scope.state() !== 'active') {
                ctx.log(`$.scene.inScope: область "${scope.name}" уже ${scope.state()}`);
                return undefined;
            }
            return withScope(scope, fn);
        },

        /** Активные/закрывающиеся области. */
        scopes() { return Array.from(scopes.keys()); },

        /** Область по имени или null (без создания). */
        scopeOf(name) { return getScope(name); },

        /** Начать закрытие области; реальная отмена — в безопасной фазе. */
        closeScope(name, opts) {
            const scope = getScope(name);
            if (!scope) return false;
            return scope.close(opts || {});
        },

        /**
         * Счётчики мира для приёмки §5: живые узлы/тела/подписки/таймеры/
         * задачи/потоки. `scopes` — активные области.
         */
        counts() {
            let nodes = 0;
            let bodies = 0;
            for (const node of ctx.nodes) {
                if (node.removed) continue;
                nodes++;
                if (node.body !== undefined && node.body !== null && node.body >= 0) bodies++;
            }
            const time = ctx.time;
            const timers = time && time._state && Array.isArray(time._state.intervals)
                ? time._state.intervals.length : 0;
            return {
                nodes,
                bodies,
                subs: $.signal ? $.signal.count() : 0,
                waits: $.signal ? $.signal.waiters() : 0,
                timers,
                tasks: ctx.task && typeof ctx.task.running === 'function' ? ctx.task.running() : 0,
                flows: ctx.$ && ctx.$.flow ? ctx.$.flow.active() : 0,
                scopes: scopes.size,
            };
        },

        /**
         * Подготовить новую сцену, не трогая текущую (§5).
         *
         * Вызывает необязательный `definition.prepare($, scope)` во временной
         * области. Ошибка подготовки закрывает временную область, помечает
         * handle.ok = false и оставляет предыдущую сцену пригодной к работе.
         * Успех — `$.scene.commit(handle)`.
         */
        prepare(name, opts) {
            const o = opts || {};
            state.generation++;
            if (state.loader_scope) {
                // Отмена задач загрузчика должна быть немедленной: иначе он
                // успеет доработать кадр и опубликовать свой мир.
                state.loader_scope.close({ immediate: true, reason: 'новая подготовка сцены' });
                state.loader_scope = null;
            }
            const handle = { name: String(name), ok: true, error: null, scope: null, stage: null };
            if (!scenes.has(name)) {
                // Сцена может быть зарегистрирована позже: готовим запрос.
                handle.ok = false;
                handle.error = new Error(`$.scene.prepare: сцена "${name}" не зарегистрирована`);
                return handle;
            }
            const definition = scenes.get(name);
            const stage_name = o.scope ? String(o.scope) : nextScopeName('stage', name);
            const scope = ensureScope(stage_name, {});
            handle.scope = scope;
            handle.stage = stage_name;
            if (definition && typeof definition.prepare === 'function') {
                try {
                    const result = withScope(scope, () => definition.prepare(ctx.$, scope));
                    if (result && result.ok === false) {
                        handle.ok = false;
                        handle.error = result.error || new Error('prepare вернул ok: false');
                    }
                } catch (error) {
                    // Ошибка подготовки не должна трогать текущую сцену:
                    // временная область закрывается, мир остаётся прежним.
                    handle.ok = false;
                    handle.error = error;
                    ctx.log(`$.scene.prepare("${name}"): ${error}`);
                }
            }
            if (!handle.ok) {
                scope.close({ immediate: true, reason: 'prepare не удался' });
                handle.scope = null;
            }
            return handle;
        },

        /**
         * Зафиксировать подготовленную сцену: временная область становится
         * областью текущей сцены, прежняя закрывается, затем вызывается
         * `enter`. Возвращает `$`.
         */
        commit(handle, opts) {
            if (!handle || handle.ok !== true || !handle.scope) {
                ctx.log('$.scene.commit: нужен успешный handle из $.scene.prepare');
                return scene;
            }
            if (handle.scope.state() !== 'active') {
                ctx.log(`$.scene.commit: область "${handle.scope.name}" уже ${handle.scope.state()}`);
                return scene;
            }
            const o = opts || {};
            state.generation++;
            pendingSwitch(handle.name, Object.assign({}, o, {
                scope: handle.scope.name,
                staged: true,
            }));
            return scene;
        },

        /** Отказаться от подготовленной сцены: временная область закрывается. */
        discard(handle) {
            if (!handle || !handle.scope) return false;
            const ok = handle.scope.close({ immediate: true, reason: 'prepare отменён' });
            handle.scope = null;
            handle.ok = false;
            return ok;
        },

        /** Перейти на сцену. opts: { transition, ms, keepUI, scope } */
        load(name, opts) {
            const o = Object.assign({}, opts || {});
            // scope: true — своя область на каждый переход (restart не должен
            // переиспользовать закрытую область и копить узлы).
            if (o.scope === true) o.scope = nextScopeName('scene', name);
            // Новый переход отменяет старую подготовку и старый loader:
            // сгенерированный им мир не будет опубликован (§5).
            state.generation++;
            if (state.loader_scope) {
                state.loader_scope.close({ immediate: true, reason: 'новый переход' });
                state.loader_scope = null;
            }
            if (!scenes.has(name)) {
                // Сцена может быть ещё не зарегистрирована: модули грузятся
                // асинхронно, а --scene или стартовый load приходят раньше.
                // Держим запрос до регистрации, иначе переход молча терялся.
                state.deferred = { name, opts: o };
                return scene;
            }
            // ms: 0 — это «без перехода», а не «взять длительность по
            // умолчанию»: раньше ноль был falsy и тихо превращался в 300 мс,
            // хотя игрок просил мгновенную смену.
            const ms = o.ms === undefined ? state.transition_ms : o.ms;
            if (o.transition === 'none' || ms <= 0) {
                pendingSwitch(name, o);
                return scene;
            }
            pendingSwitch(name, o);
            state.transition = {
                type: o.transition || state.transition_type,
                ms,
                t: 0,
                phase: 'out',
                to: name,
            };
            return scene;
        },

        /**
         * Переход с загрузкой: показывает экран, выполняет шаги кусками по
         * кадрам и только потом уходит в сцену. Экран остаётся живым, ввод не
         * блокируется до последнего кадра.
         *
         *   $.scene.loadAsync('level2', {
         *       label: 'Уровень 2',
         *       steps: [
         *           { label: 'лес', work: (i) => plant(i), total: 900 },
         *           { label: 'враги', work: () => spawnHorde() },
         *       ],
         *   });
         *
         * `steps` — массив шагов: у каждого либо `work` c `total` (кусками),
         * либо простая функция (один вызов за кадр). Шаги принадлежат области
         * загрузчика: новый `load` её закрывает, и старый loader молча
         * останавливается, не публикуя мир.
         */
        loadAsync(name, opts) {
            const o = Object.assign({ transition: 'fade' }, opts || {});
            const steps = Array.isArray(o.steps) ? o.steps.slice() : [];
            const task = ctx.task;
            if (!task || !steps.length) return scene.load(name, o);

            const token = ++state.generation;
            const loader = ensureScope(nextScopeName('loader', name), {});
            state.loader_scope = loader;
            const loading = ctx.loading;

            const finished = () => {
                if (state.generation !== token) return;      // переход уже другой
                if (state.loader_scope === loader) state.loader_scope = null;
                loader.close({ immediate: true, reason: 'загрузка завершена' });
                if (loading && typeof loading.hide === 'function') loading.hide();
                scene.load(name, o);
            };

            const runStep = (index) => {
                if (state.generation !== token) return;      // отменённая генерация
                if (index >= steps.length) { finished(); return; }
                const step = steps[index] || {};
                const label = step.label || `шаг ${index + 1} из ${steps.length}`;
                const next = () => runStep(index + 1);
                if (typeof step.work === 'function' && step.total > 0) {
                    task.chunked({
                        total: step.total,
                        budget: step.budget,
                        label,
                        scope: loader,
                        step: (i, n) => step.work(i, n),
                        done: next,
                    });
                    return;
                }
                // Простой шаг: работа и сразу следующий — прогноз кадра делает
                // планировщик, поэтому даже один вызов не «съедает» переход.
                task.chunked({
                    total: 1,
                    budget: step.budget,
                    label,
                    scope: loader,
                    step: () => { if (typeof step.work === 'function') step.work(); },
                    done: next,
                });
            };

            runStep(0);
            return scene;
        },

        /** Перезапустить текущую сцену (удобно для «ещё раз»). */
        restart() {
            // У сцены с областью владения restart — новый проход: прежняя
            // область закрывается, persistent-узлы остаются.
            return scene.load(state.current_name, state.scope_name ? { scope: true } : undefined);
        },

        /** Положить сцену поверх: пауза, инвентарь. */
        push(name, opts) {
            if (state.current_name) stack.push(state.current_name);
            return scene.load(name, opts);
        },

        /** Вернуться к сцене из стека. */
        pop(opts) {
            const prev = stack.pop();
            if (!prev) { ctx.log('$: стек сцен пуст — pop() игнорируется'); return scene; }
            const o = opts || {};
            return scene.load(prev, o);
        },

        stack() { return stack.slice(); },

        /** Правила перехода по умолчанию. */
        transition(type, ms) {
            state.transition_type = type === undefined ? 'fade' : type;
            if (ms !== undefined) state.transition_ms = ms;
            return scene;
        },

        /** Идёт ли переход прямо сейчас. */
        busy() { return state.transition !== null; },

        /** Загрузка данных до входа (заглушка-заготовка для стриминга). */
        preload(list) {
            for (const item of [].concat(list)) {
                if (typeof item === 'string' && ctx.sound) ctx.sound.preload([item]);
            }
            return scene;
        },

        _tick(dt) {
            if (state.transition) {
                const tr = state.transition;
                tr.t += dt * 1000;
                if (tr.phase === 'out' && tr.t >= tr.ms) {
                    tr.phase = 'in';
                    tr.t = 0;
                    state.pending = tr.to;
                    // Опции load() нельзя терять: иначе keepUI пропадал бы при
                    // переходе с анимацией и интерфейс сносило бы вместе с миром.
                    state.pending_opts = Object.assign({}, state.pending_opts, { transition: 'none' });
                } else if (tr.phase === 'in' && tr.t >= tr.ms) {
                    state.transition = null;
                }
            }
            doSwitch();
        },

        /** Внутреннее: рисует затемнение перехода. */
        _transitionAlpha() {
            const tr = state.transition;
            if (!tr) return 0;
            const p = Math.min(1, tr.t / tr.ms);
            return tr.phase === 'out' ? p : 1 - p;
        },
        _transitionInfo() { return state.transition; },

        _state: state,
    };

    ctx.scene = scene;
    return scene;
}

/** Выполнить fn, сделав область текущей; восстановить прежний контекст. */
function withScope(scope, fn) {
    const prev = ctx.scope_current;
    ctx.scope_current = scope;
    try {
        return typeof fn === 'function' ? fn(scope, ctx.$) : undefined;
    } finally {
        ctx.scope_current = prev;
    }
}

function pendingSwitch(name, opts) {
    state.pending = name;
    state.pending_opts = opts || {};
}

function doSwitch() {
    if (state.pending === null) return;
    if (state.transition && state.transition.phase === 'out') return;

    const name = state.pending;
    const opts = state.pending_opts || {};
    state.pending = null;
    state.pending_opts = null;
    if (name === null) return;

    const scoped = !!opts.scope;
    const prev = state.current;
    if (prev && typeof prev.exit === 'function') {
        try { prev.exit(ctx.$); } catch (e) { ctx.log(`$: ошибка в exit сцены "${state.current_name}": ${e}`); }
    }

    if (scoped) {
        // Новая область уже готова (prepare+commit) или создаётся здесь.
        const scope = ensureScope(opts.scope === true ? `scene:${name}` : opts.scope, {});
        // Прежняя область сцены закрывается ПОСЛЕ подготовки новой: ошибка
        // подготовки не должна оставить игру без мира.
        if (state.scope_name && state.scope_name !== scope.name) {
            const old = getScope(state.scope_name);
            if (old) old.close({ reason: `переход на сцену "${name}"` });
        }
        state.scope_name = scope.name;
        state.current_name = name;
        state.history.push(name);
        const definition = scenes.get(name);
        state.current = typeof definition === 'object' ? definition : { enter: definition };
        if (typeof state.current.enter === 'function') {
            withScope(scope, () => {
                try { state.current.enter(ctx.$, scope); }
                catch (e) { ctx.log(`$: ошибка в enter сцены "${name}": ${e}`); }
            });
        }
        ctx.$._dispatchGlobal(null, 'scene:enter', { name, scope: scope.name });
        // Закрытые области финализируются в безопасной фазе (tickLifecycle).
        return;
    }

    // Прежний режим (без scope): мир чистится целиком. Если у прошлой сцены
    // была область владения, её ресурсы (задачи/подписки/таймеры) закрываются
    // здесь же, иначе они остались бы жить при снесённых узлах.
    if (state.scope_name) {
        const old = getScope(state.scope_name);
        if (old) old.close({ reason: `переход на сцену "${name}"` });
        state.scope_name = null;
    }
    clearWorld(opts);

    state.current_name = name;
    state.history.push(name);
    const definition = scenes.get(name);
    state.current = typeof definition === 'object' ? definition : { enter: definition };

    if (typeof state.current.enter === 'function') {
        try { state.current.enter(ctx.$); }
        catch (e) { ctx.log(`$: ошибка в enter сцены "${name}": ${e}`); }
    }
    ctx.$._dispatchGlobal(null, 'scene:enter', { name });
}

function clearWorld(opts) {
    const keep_ui = opts && opts.keepUI;
    for (const node of ctx.nodes.slice()) {
        if (keep_ui && node.attrs.ui) continue;
        if (node.classes.has('scene-persistent')) continue;
        node.destroy();
    }
    if (ctx.byId) {
        for (const [id, node] of [...ctx.byId.entries()]) if (node.removed) ctx.byId.delete(id);
    }
    ctx.timers.length = 0;
    ctx.animations.length = 0;
    // Зоны, слушатель и живые источники принадлежат сцене: без сброса комната
    // прошлого уровня звучала бы в следующем.
    resetAcoustics();
    // Ленты, молнии и поля сил — тоже сцена: иначе эффект смерти остался бы
    // висеть на экране следующего уровня.
    resetFx();
    if (ctx.time) { ctx.time.cancelAll(); ctx.time.resume(); }
    if (ctx.world) {
        ctx.world.clearBounds();
        // Гравитация и масштаб времени — глобальные: сцена, которая их
        // выключила и не вернула, иначе испортила бы следующую сцену.
        ctx.world.resume();
        ctx.world.timeScale(1);
    }
}

export function currentScene() { return state.current; }
