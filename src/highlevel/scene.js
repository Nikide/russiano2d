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
    // Переход: { type, ms, t, phase: 'out'|'load'|'in', to }.
    // 'load' — экран загрузки между затемнением и входом (task-65 A1).
    transition: null,
    transition_type: 'fade',
    transition_ms: 300,
    history: [],
    // §5: генерация переходов. Любой новый load/prepare увеличивает счётчик —
    // завершившийся старый loader видит чужой токен и не публикует мир.
    generation: 0,
    scope_name: null,      // область текущей сцены
    loader_scope: null,    // область активного loadAsync
    async_handle: null,    // §45: handle последнего loadAsync (для cancel/pending)
    // --- task-65: одна точка входа и наблюдаемый переход -------------------
    from_name: '',         // сцена, из которой переходим
    to_name: '',           // сцена, в которую переходим
    to_opts: null,         // нормализованные опции перехода
    phase: null,           // null | 'out' | 'load' | 'in'
    deferred: null,        // запрос до регистрации сцены
    prepared: new Map(),   // имя сцены → handle успешного prepare (для promote)
    loading_cfg: {         // настройки экрана загрузки ($.scene.loading)
        rml: null, theme: null, min_ms: 0, timeout_ms: 0, style: null,
    },
    load: null,            // активная загрузка: { handle, started, screen, ready, ... }
    progress: { total: 0, done: 0, ratio: 0, label: '' },
    // Состояние, которое надо вернуть после экрана загрузки.
    restore: null,         // { time_paused, sound_muted, world_frozen }
};

// ---------------------------------------------------------------------------
// §5. Область владения (lifecycle scope)
// ---------------------------------------------------------------------------

const scopes = new Map();     // имя → scope (active или closing)
const closing_scopes = [];    // closing, ждут безопасной фазы
let scope_seq = 0;

const BUCKETS = ['node', 'signal', 'wait', 'timer', 'task', 'flow', 'resource', 'sound'];

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

        /**
         * Взять канал звука под владение: при закрытии области он глушится
         * (с плавным затуханием, если оно задано). Игра может оставить звук
         * жить дольше области — `$.sound.play(..., { keep: true })`.
         */
        sound(channel, fadeMs) {
            const ch = Number(channel);
            if (!(ch >= 0)) return false;
            const fade = Number(fadeMs) || 0;
            return scope.own('sound', ch, () => {
                // Через ctx.sound: scene.js не тянет нативный слой сам, а
                // модуль звука может быть не установлен (урезанная сборка).
                if (!ctx.sound || typeof ctx.sound.stop !== 'function') return;
                if (typeof ctx.sound.playing === 'function' && !ctx.sound.playing(ch)) return;
                ctx.sound.stop(ch, fade);
            }, { channel: ch });
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
    // Звук глушим ДО узлов: канал ещё держит ссылку на источник-узел.
    for (const entry of scope._items.sound.splice(0)) {
        try { entry.cancel(why); } catch (e) { /* канал уже свободен */ }
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
// task-65. Одна точка входа, наблюдаемый переход и экран загрузки
// ---------------------------------------------------------------------------

/** Отчёт об ошибке сцены: журнал + $.debug.errors(), без «тихого» отказа. */
function reportSceneError(where, error, info) {
    const details = Object.assign({ fatal: false, code: 'R2D_SCENE_LOAD' }, info || {});
    const api = ctx.$;
    const message = error && error.message ? error.message : String(error);
    if (api && api.debug && typeof api.debug.reportError === 'function') {
        try {
            api.debug.reportError(where, new Error(message), details);
        } catch (e) { /* диагностика не должна ломать переход */ }
    }
    ctx.log(`${where}: ${message}`);
    return {
        code: details.code,
        message,
        scene: details.operation === undefined ? null : details.operation,
        stage: details.stage === undefined ? null : details.stage,
    };
}

/**
 * Нормализовать опции смены сцены. Одна форма для `load()` и `change()`:
 * старые вызовы `load(name, {transition:'none', ms:0, keepUI:true, scope:true})`
 * понимаются ровно как раньше.
 */
function normalizeChangeOptions(opts) {
    const o = Object.assign({}, opts || {});
    o.transition = o.transition === undefined ? undefined : String(o.transition);
    o.ms = o.ms === undefined ? undefined : Number(o.ms);
    o.audio_fade = o.audio_fade === undefined ? undefined : Number(o.audio_fade);
    o.keep_light = o.keep_light === true;
    o.keepUI = o.keepUI === true || o.keep_ui === true;
    if (o.scope === true) o.scope = nextScopeName('scene', o.scene === undefined ? (o.name === undefined ? '' : o.name) : o.scene);
    // Экран загрузки включается явно (`loading: true`, `progress: true`) либо
    // сам, когда игра передала шаги/ресурсы/свой RML.
    o.loading = o.loading === true || o.loading === 'auto'
        || o.progress === true || !!o.rml || !!o.theme
        || Array.isArray(o.steps) && o.steps.length > 0 || !!o.resources;
    o.rml = o.rml ? String(o.rml) : null;
    o.theme = o.theme ? String(o.theme) : null;
    o.min_loading_ms = Math.max(0, Number(o.min_loading_ms === undefined ? o.min_ms : o.min_loading_ms) || 0);
    o.timeout_ms = Math.max(0, Number(o.timeout_ms) || 0);
    o.title = o.title === undefined ? null : String(o.title);
    o.hint = o.hint === undefined ? null : String(o.hint);
    o.style = o.style && typeof o.style === 'object' ? o.style : null;
    // Спека перехода: {type:'wipe', dir, soft}, {type:'checker', cols, rows},
    // {type:'shader', name, amount}. Неизвестный тип — назад в fade с ошибкой.
    if (o.dir !== undefined) o.dir = String(o.dir);
    if (o.soft !== undefined) o.soft = Math.max(0, Math.min(0.5, Number(o.soft) || 0));
    if (o.cols !== undefined) o.cols = Math.max(2, Math.min(64, Math.round(Number(o.cols) || 8)));
    if (o.rows !== undefined) o.rows = Math.max(2, Math.min(64, Math.round(Number(o.rows) || 8)));
    if (o.shader !== undefined) o.shader = String(o.shader);
    // Имя перехода берём из `shader`/`name` ТОЛЬКО для типа shader: у
    // `change(name, ...)` поле `name` — имя сцены, и раньше оно попадало в
    // переход как имя эффекта ("b" вместо "wave"), превращая переход в fade.
    if (o.transition === 'shader' && o.shader === undefined && o.name !== undefined) {
        o.shader = String(o.name);
    }
    if (o.amount !== undefined) o.amount = Math.max(0, Math.min(1, Number(o.amount) || 0));
    const TYPES = { fade: 1, wipe: 1, checker: 1, shader: 1, none: 1 };
    if (o.transition !== undefined && !TYPES[o.transition]) {
        reportSceneError('$.scene.change', new Error(
            `неизвестный переход "${o.transition}" (есть fade, wipe, checker, shader, none)`),
            { code: 'R2D_SCENE_TRANSITION_UNKNOWN', stage: 'transition' });
        o.transition = 'fade';
    }
    return o;
}

/**
 * Экран загрузки: встроенная полоса либо свой RmlUi-документ.
 *
 * Свой документ получает данные прогресса через элементы с id:
 *   * `loading_bar`   — атрибут `value` (0..1000, как у `<ui.bar>`);
 *   * `loading_progress` — текст «42%»;
 *   * `loading_label` — подпись текущего шага.
 * Нет элементов — экран честно говорит об этом в журнал и не врёт полосой.
 */
function makeLoadingScreen(o) {
    const cfg = state.loading_cfg;
    const rml = o.rml || cfg.rml;
    const style = Object.assign({}, cfg.style || {}, o.style || {});
    const api = ctx.$;
    let custom = null;
    let warned = false;
    let updater = 0;

    if (rml && api && api.ui && typeof api.ui.doc === 'function') {
        try {
            custom = api.ui.doc(rml);
            if (custom && typeof custom.show === 'function') custom.show();
            else custom = null;
        } catch (e) {
            reportSceneError('$.scene.loading', e, { code: 'R2D_SCENE_LOADING_RML', stage: 'loading' });
            custom = null;
        }
    }
    if (custom) {
        return {
            mode: 'rml',
            rml,
            show() { if (typeof custom.show === 'function') custom.show(); },
            progress(ratio, label) {
                const r = Math.max(0, Math.min(1, Number(ratio) || 0));
                const pct = Math.round(r * 100);
                if (typeof custom.attr === 'function') custom.attr('loading_bar', 'value', String(Math.round(r * 1000)));
                if (typeof custom.text === 'function') {
                    custom.text('loading_progress', pct + '%');
                    custom.text('loading_label', label || '');
                }
                if (!warned && ++updater >= 2 && custom.content
                    && custom.content('loading_progress') === null) {
                    warned = true;
                    ctx.log('$.scene.loading: в документе "' + rml + '" нет элементов '
                            + 'id=loading_progress/loading_bar/loading_label — прогресс не показан');
                }
            },
            hide() {
                if (typeof custom.hide === 'function') custom.hide();
            },
        };
    }

    const loading = ctx.loading;
    if (!loading || typeof loading.show !== 'function') {
        return { mode: 'none', show() {}, progress() {}, hide() {} };
    }
    return {
        mode: 'builtin',
        show() {
            loading.show({
                title: o.title || cfg.title || 'Загрузка…',
                hint: o.hint || cfg.hint || '',
                color: style.color || cfg.color,
                barColor: style.barColor || cfg.barColor,
            });
            loading.progress(0);
        },
        progress(ratio, label) { loading.progress(ratio, label); },
        hide() { loading.hide(); },
    };
}

/** Прогресс загрузчика в общую форму {total, done, ratio, label}. */
function progressSummary(handle, label) {
    let total = 0;
    let done = 0;
    let text = label || '';
    try {
        const p = handle && typeof handle.progress === 'function' ? handle.progress() : null;
        if (p) {
            if (p.bytes_known && p.bytes_total > 0) {
                total = p.bytes_total; done = p.bytes_done;
            } else if (p.jobs_total > 0) {
                total = p.jobs_total; done = p.jobs_done;
            }
            if (!text && p.label) text = String(p.label);
            if (!text && p.stage) text = p.stage === 'io' ? 'чтение'
                : p.stage === 'decode' ? 'декодирование'
                : p.stage === 'apply' ? 'применение' : String(p.stage);
            if (p.cancelled) text = 'отменено';
        }
    } catch (e) { /* прогресс не должен рвать переход */ }
    let ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
    // Ресурсы и шаги — две половины одной загрузки: без весов полоса падала
    // бы с 100% (байты кончились) до 0% (шаги начались).
    try {
        const p = handle && typeof handle.progress === 'function' ? handle.progress() : null;
        if (p && p.bytes_total > 0 && p.jobs_total > 0) {
            const bytes = Math.max(0, Math.min(1, (p.bytes_done || 0) / p.bytes_total));
            const jobs = Math.max(0, Math.min(1, (p.jobs_done || 0) / p.jobs_total));
            ratio = bytes * 0.5 + jobs * 0.5;
            total = p.bytes_total + p.jobs_total;
            done = Math.round(bytes * 0.5 * p.bytes_total + jobs * 0.5 * p.jobs_total);
        }
    } catch (e) { /* прогресс не должен рвать переход */ }
    return { total, done, ratio, label: text };
}

/**
 * Загрузчик: ресурсы ($.resource) и шаги ($.task), публикующие мир только при
 * совпадении generation. Один путь для `loadAsync()` и `change({loading})`.
 * Возвращает handle (`progress/cancel/done`) или null, если работы нет.
 */
function startLoader(name, o, token, hooks) {
    const h = hooks || {};
    const steps = Array.isArray(o.steps) ? o.steps.slice() : [];
    const resources = o.resources;
    const task = ctx.task;
    if (!resources && (!task || !steps.length)) return null;

    const loader = ensureScope(nextScopeName('loader', name), {});
    state.loader_scope = loader;
    const loading = ctx.loading;
    const api = ctx.$;
    // Единицы работы: у шага свой total (или 1). Это и есть «реальные шаги
    // лоадера» для прогресса (task-65 A1), а не таймер.
    const units = steps.map((s) => (s && s.total > 0 ? Math.floor(Number(s.total)) : 1));
    const units_total = units.reduce((sum, n) => sum + n, 0);
    let units_done = 0;
    let current = null;          // задача текущего шага
    let current_label = '';

    const stepProgress = () => {
        if (!current) return 0;
        const value = typeof current.progress === 'function' ? current.progress() : current.progress;
        const p = Number(value);
        return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
    };
    const doneUnits = (index) => units_done + stepProgress() * (units[index] || 1);

    const handle = {
        name: String(name),
        ok: true,
        state: 'loading',
        error: null,
        scope: loader,
        request: null,
        owns_request: false,
        steps_done: 0,
        cancelled: false,
        /** Прогресс ресурсов (или null, если ресурсов нет). */
        progress() {
            const jobs_done = Math.min(units_total, doneUnits(Math.min(this.steps_done, steps.length - 1)));
            if (this.request && typeof this.request.progress === 'function') {
                const p = this.request.progress();
                p.steps_total = units_total;
                p.steps_done = jobs_done;
                p.jobs_total = units_total;
                p.jobs_done = jobs_done;
                if (current_label) p.label = current_label;
                return p;
            }
            return {
                state: this.state, stage: current_label || (steps.length ? 'apply' : 'done'),
                label: current_label,
                bytes_done: 0, bytes_total: 0, bytes_known: false,
                jobs_done, jobs_total: units_total,
                estimated: true, cancelled: this.cancelled,
                failed: this.state === 'failed', names: [],
            };
        },
        errorInfo() { return this.error; },
        done() { return this.state === 'ready' || this.state === 'failed' || this.state === 'cancelled'; },
        /** Отмена: запрос, scope и публикация сцены отменяются. */
        cancel(reason) {
            if (this.done()) return false;
            this.state = 'cancelled';
            this.cancelled = true;
            if (state.generation === token) state.generation++;
            if (this.request && this.owns_request && typeof this.request.cancel === 'function') {
                this.request.cancel();
            }
            if (state.loader_scope === loader) state.loader_scope = null;
            loader.close({ immediate: true, reason: reason || 'загрузка отменена' });
            if (loading && typeof loading.watched === 'function'
                && loading.watched() === this.request) loading.hide();
            if (typeof h.onCancelled === 'function') h.onCancelled(this);
            return true;
        },
    };

    const cleanup = () => {
        if (state.loader_scope === loader) state.loader_scope = null;
        loader.close({ immediate: true, reason: 'загрузка завершена' });
        // Экран загрузки принадлежит сцене, когда h.screen === false: его
        // держит min_loading_ms, и гасить его здесь нельзя (иначе экран
        // пропадает на первом же кадре после готовности ресурсов).
        if (h.screen !== false && loading && typeof loading.hide === 'function') loading.hide();
    };

    const fail = (message, info) => {
        if (handle.done()) return;
        const opts2 = info || {};
        handle.ok = false;
        handle.state = 'failed';
        handle.error = {
            code: opts2.code || 'R2D_SCENE_LOAD',
            message: String(message),
            path: opts2.assetPath === undefined ? null : opts2.assetPath,
            scene: handle.name,
            stage: opts2.stage || null,
        };
        if (state.generation === token) state.generation++;
        cleanup();
        reportSceneError('$.scene.load', new Error(handle.error.message), {
            code: handle.error.code, assetPath: handle.error.path,
            operation: handle.name, stage: handle.error.stage,
        });
        if (typeof h.onFailed === 'function') h.onFailed(handle.error, handle);
    };

    const finished = () => {
        if (state.generation !== token) return;      // переход уже другой
        handle.state = 'ready';
        cleanup();
        if (typeof h.onReady === 'function') h.onReady(handle);
    };

    const runStep = (index) => {
        if (state.generation !== token) return;      // отменённая генерация
        if (index >= steps.length) { finished(); return; }
        const step = steps[index] || {};
        const label = step.label || `шаг ${index + 1} из ${steps.length}`;
        current_label = label;
        const next = () => {
            units_done += units[index] || 1;
            current = null;
            current_label = '';
            handle.steps_done = index + 1;
            runStep(index + 1);
        };
        if (typeof step.work === 'function' && step.total > 0) {
            current = task.chunked({
                total: step.total,
                budget: step.budget,
                label,
                scope: loader,
                // Экран загрузки рисует сцена: иначе $.task.show() перерисовывал
                // бы его на каждом шаге и сбрасывал полосу.
                loading: h.screen !== false,
                step: (i, n) => step.work(i, n),
                done: next,
            });
            return;
        }
        current = task.chunked({
            total: 1,
            budget: step.budget,
            label,
            scope: loader,
            loading: h.screen !== false,
            step: () => { if (typeof step.work === 'function') step.work(); },
            done: next,
        });
    };

    const beginSteps = () => {
        if (state.generation !== token) return;
        if (!steps.length) { finished(); return; }
        runStep(0);
    };

    // Ресурсы: свой запрос или готовый handle от игры.
    if (resources) {
        let req = null;
        if (resources && typeof resources.progress === 'function'
            && typeof resources.on === 'function') {
            req = resources;                       // handle передала игра
        } else if (api && api.resource && typeof api.resource.request === 'function') {
            req = api.resource.request(resources);
            handle.owns_request = true;
        } else {
            fail('нет $.resource — список ресурсов не загрузить', { code: 'R2D_LOAD_RESOURCE' });
            return handle;
        }
        handle.request = req;
        if (h.screen !== false && loading && typeof loading.watch === 'function') {
            loading.watch(req);
        }
        req.on('ready', () => {
            if (state.generation !== token) return;
            if (loading && typeof loading.progress === 'function') loading.progress(1);
            beginSteps();
        });
        req.on('failed', (r) => {
            const info = (r && r.error && r.error()) || null;
            fail(info && info.message ? info.message : 'ресурсы не загрузились',
                 { code: info && info.code ? info.code : 'R2D_LOAD_RESOURCE',
                   assetPath: info ? info.path : null, stage: 'resources' });
        });
        req.on('cancelled', () => {
            if (handle.done()) return;
            handle.state = 'cancelled';
            handle.cancelled = true;
            if (state.generation === token) state.generation++;
            cleanup();
            if (typeof h.onCancelled === 'function') h.onCancelled(handle);
        });
        if (req.done && req.done()) {
            // Уже готовый/упавший запрос: обрабатываем без ожидания.
            if (req.state && req.state() === 'failed') {
                const info = req.error();
                fail(info && info.message ? info.message : 'ресурсы не загрузились',
                     { code: 'R2D_LOAD_RESOURCE', assetPath: info ? info.path : null });
            } else if (req.state && req.state() === 'cancelled') {
                handle.state = 'cancelled';
                handle.cancelled = true;
                if (typeof h.onCancelled === 'function') h.onCancelled(handle);
            } else {
                beginSteps();
            }
        }
    } else {
        beginSteps();
    }
    return handle;
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
            } else if (definition && typeof definition.enter === 'function') {
                // Сцена без отдельного prepare: строим её `enter` заранее, во
                // временной области. Это и есть prefetch (task-65 A0.6):
                // promote() затем публикует мир без повторного построения.
                try {
                    withScope(scope, () => definition.enter(ctx.$, scope));
                    scope._scene_built = true;
                } catch (error) {
                    handle.ok = false;
                    handle.error = error;
                    ctx.log(`$.scene.prepare("${name}") через enter: ${error}`);
                }
            }
            if (!handle.ok) {
                scope.close({ immediate: true, reason: 'prepare не удался' });
                handle.scope = null;
                state.prepared.delete(handle.name);
            } else {
                state.prepared.set(handle.name, handle);
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
            const o = normalizeChangeOptions(Object.assign({}, opts || {}, { scene: handle.name }));
            state.generation++;
            state.prepared.delete(handle.name);
            state.from_name = state.current_name;
            state.to_name = handle.name;
            state.to_opts = Object.assign({}, o, { scope: handle.scope.name, staged: true });
            state.pending = handle.name;
            state.pending_opts = state.to_opts;
            if (ctx.$ && typeof ctx.$._dispatchGlobal === 'function') {
                ctx.$._dispatchGlobal(null, 'scene:before-change', {
                    from: state.from_name, to: handle.name, transition: 'none', ms: 0,
                });
            }
            pendingSwitch(handle.name, state.to_opts);
            return scene;
        },

        /** Отказаться от подготовленной сцены: временная область закрывается. */
        discard(handle) {
            if (!handle || !handle.scope) return false;
            state.prepared.delete(handle.name);
            const ok = handle.scope.close({ immediate: true, reason: 'prepare отменён' });
            handle.scope = null;
            handle.ok = false;
            return ok;
        },

        /**
         * Перейти на сцену. Тонкая обёртка над `change()`: те же опции дают
         * тот же результат (task-65 A0.1), старые вызовы не меняются.
         * opts: { transition, ms, keepUI, scope, audio_fade, keep_light, … }
         */
        load(name, opts) {
            return scene.change(name, opts);
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
        /**
         * §45: асинхронная загрузка сцены с ресурсами и прогрессом.
         *
         *   $.scene.loadAsync('level2', {
         *       resources: ['assets/heavy.png', { name: 'lv', path: 'levels/2.json' }],
         *       title: 'Готовим уровень…',
         *       steps: [{ label: 'сборка', total: 400, work: (i) => build(i) }],
         *   });
         *   $.scene.pending().progress();   // байты и стадия
         *   $.scene.cancelPending();        // отмена: сцена НЕ появится
         *
         * `resources` — список спецификаций (как у $.resource.request) или уже
         * готовый handle запроса. Пока ресурсы не готовы, мир не трогается;
         * инстанциация идёт шагами через $.task (по кадрам), а публикация
         * сцены — только при совпадении generation (отменённый load ничего не
         * публикует).
         */
        loadAsync(name, opts) {
            // §45 путь сохранён: экран загрузки, ресурсы, шаги, отмена.
            // Возврат к одной точке входа (task-65): сама публикация мира идёт
            // через load(), поэтому поведение совместимо со старыми играми.
            const o = normalizeChangeOptions(Object.assign({ transition: 'fade' }, opts || {}));
            const token = ++state.generation;
            const publish = Object.assign({}, o);
            delete publish.steps;
            delete publish.resources;
            delete publish.loading;
            delete publish.progress;
            const handle = startLoader(name, o, token, {
                screen: true,
                onReady: () => {
                    if (state.generation !== token) return;
                    scene.load(name, publish);
                },
            });
            if (!handle) return scene.load(name, o);
            state.async_handle = handle;
            return scene;
        },

        /**
         * task-65. Единственная точка входа смены сцены.
         *
         *   $.scene.change('level2', {
         *       transition: 'fade', ms: 300,      // тип и длительность
         *       audio_fade: 250,                   // затухание звука уходящей сцены
         *       keep_light: false,                 // true — не сбрасывать свет/темноту
         *       loading: true,                     // экран загрузки
         *       steps: [...], resources: [...],    // реальная работа загрузчика
         *       min_loading_ms: 300,               // не мигать экраном
         *       timeout_ms: 15000,                 // вечный экран → честная ошибка
         *   });
         *
         * Старый `load(name, opts)` — тонкая обёртка: одинаковые опции дают
         * одинаковый результат. Рапидные вызовы в одном кадре склеиваются в
         * ОДИН переход на последнюю сцену (затемнение не перезапускается).
         */
        change(name, opts) {
            const key = String(name);
            const o = normalizeChangeOptions(Object.assign({}, opts || {}, { scene: key }));

            // Сцена может быть ещё не зарегистрирована: держим запрос, а не
            // теряем его молча (как и прежний load).
            if (!scenes.has(key)) {
                state.generation++;
                state.deferred = { name: key, opts: o };
                ctx.log(`$.scene.change("${key}"): сцена ещё не зарегистрирована — запрос отложен`);
                return scene;
            }

            // Склейка рапидных запросов: переход уже затемняет кадр (или уже
            // крутит лоадер) — меняем только цель, t не сбрасываем.
            const tr = state.transition;
            if (tr && (tr.phase === 'out' || tr.phase === 'load')) {
                const was_loading = tr.phase === 'load';
                if (was_loading && state.load) {
                    // Старая загрузка не должна опубликовать свой мир и не
                    // должна оставить свой экран.
                    if (state.load.handle && !state.load.handle.done()) {
                        state.load.handle.cancel('запрос заменён новой сценой');
                    }
                    if (state.load.screen) state.load.screen.hide();
                    state.load = null;
                    restoreLoadState();
                }
                state.generation++;
                state.pending = key;
                state.pending_opts = o;
                state.to_name = key;
                state.to_opts = o;
                tr.to = key;
                if (o.transition === 'none' || (o.ms !== undefined && o.ms <= 0)) {
                    // Мгновенная цель во время затемнения: доводим затемнение
                    // до конца и не начинаем второе.
                    tr.ms = Math.max(1, tr.t);
                }
                if (was_loading) {
                    // Экран уже был показан: продолжаем его для новой цели,
                    // если она снова просит загрузку; иначе входим сразу.
                    if (o.loading || o.timeout_ms > 0 || o.min_loading_ms > 0) {
                        startChangeLoad();
                    } else {
                        tr.phase = 'in';
                        tr.t = 0;
                        state.phase = 'in';
                    }
                }
                ctx.log(`$.scene.change("${key}"): склейка с идущим переходом `
                        + `(фаза ${tr.phase}) — один переход`);
                return scene;
            }

            // Вход уже закончился или переход не начат — начинаем новый.
            if (tr) state.transition = null;
            if (state.loader_scope) {
                state.loader_scope.close({ immediate: true, reason: 'новый переход' });
                state.loader_scope = null;
            }
            state.generation++;
            state.from_name = state.current_name;
            state.to_name = key;
            state.to_opts = o;
            state.progress = { total: 0, done: 0, ratio: 0, label: '' };
            state.pending = key;
            state.pending_opts = o;

            const ms = o.ms === undefined ? state.transition_ms : o.ms;
            const type = o.transition === undefined ? state.transition_type : o.transition;
            const instant = o.transition === 'none' || ms <= 0;
            if (ctx.$ && typeof ctx.$._dispatchGlobal === 'function') {
                ctx.$._dispatchGlobal(null, 'scene:before-change', {
                    from: state.from_name, to: key, transition: instant ? 'none' : type,
                    ms: instant ? 0 : ms,
                });
            }
            if (instant) {
                state.transition = null;
                state.phase = null;
                // Без затемнения: либо сразу ставим сцену на границе кадра,
                // либо показываем экран загрузки и ставим её после него.
                if (o.loading || o.timeout_ms > 0 || o.min_loading_ms > 0) beginChange();
                return scene;
            }
            state.transition = {
                type, ms, t: 0, phase: 'out', to: key,
                dir: o.dir, soft: o.soft, cols: o.cols, rows: o.rows,
                shader: o.shader, amount: o.amount,
            };
            state.phase = 'out';
            beginShaderTransition(state.transition);
            return scene;
        },

        /**
         * task-65 A0.3. Факты текущего перехода: `{from,to,phase,t,ratio,
         * pending,prepared}`. Вне перехода `phase:null`, `t:0`.
         * `prepared` — сцены, готовые к мгновенному promote().
         */
        state() {
            const tr = state.transition;
            const p = tr && tr.ms > 0 ? Math.min(1, tr.t / tr.ms) : 0;
            const ratio = state.phase === 'load' ? state.progress.ratio
                : (state.phase === 'in' ? p : (state.phase === 'out' ? p : 0));
            return {
                from: state.from_name || '',
                to: state.to_name || '',
                phase: state.phase,
                t: tr ? tr.t : 0,
                ratio: Math.max(0, Math.min(1, ratio)),
                pending: state.pending,
                prepared: [...state.prepared.keys()],
            };
        },

        /**
         * task-65 A0.6. Подготовить сцену заранее и мгновенно переключиться.
         *
         *   const h = $.scene.prepare('level2');     // мир собран, но не показан
         *   // …игра идёт…
         *   $.scene.promote('level2');                // без экрана загрузки
         *
         * `prepare` для сцены без `definition.prepare` выполняет её `enter` во
         * временной области; `promote` публикует область без повторного
         * построения (флаг `scope._scene_built`).
         */
        promote(name) {
            const key = String(name);
            let handle = state.prepared.get(key) || null;
            if (!handle) {
                handle = scene.prepare(key);
                if (!handle || handle.ok !== true) {
                    const message = handle && handle.error ? handle.error.message
                        : `$.scene.promote: сцена "${key}" не подготовлена`;
                    reportSceneError('$.scene.promote', new Error(message), {
                        code: 'R2D_SCENE_PROMOTE', operation: key,
                    });
                    if (ctx.$ && typeof ctx.$._dispatchGlobal === 'function') {
                        ctx.$._dispatchGlobal(null, 'scene:error', {
                            from: state.current_name, to: key,
                            code: 'R2D_SCENE_PROMOTE', message,
                        });
                    }
                    return scene;
                }
            }
            if (!handle.scope || handle.scope.state() !== 'active') {
                state.prepared.delete(key);
                const message = `$.scene.promote: подготовленная область сцены "${key}" уже `
                    + (handle.scope ? handle.scope.state() : 'закрыта');
                reportSceneError('$.scene.promote', new Error(message), {
                    code: 'R2D_SCENE_PROMOTE', operation: key,
                });
                return scene;
            }
            state.prepared.delete(key);
            state.generation++;
            state.from_name = state.current_name;
            state.to_name = key;
            state.to_opts = { transition: 'none', ms: 0, scope: handle.scope ? handle.scope.name : undefined };
            state.pending = key;
            state.pending_opts = state.to_opts;
            state.transition = null;
            state.phase = null;
            state.progress = { total: 1, done: 1, ratio: 1, label: '' };
            doSwitch();
            return scene;
        },

        /**
         * task-65 A4. Отменить начатый переход и остаться в прежней сцене.
         * Затемнение снимается за остаток времени, loader останавливается,
         * `busy()` гаснет. Возвращает true, если было что отменять.
         */
        cancel(reason) {
            const busy = state.transition !== null || state.load !== null;
            if (!busy) return false;
            if (state.load) {
                if (state.load.handle && !state.load.handle.done()) {
                    state.load.handle.cancel(reason || 'переход отменён');
                }
                if (state.load.screen) state.load.screen.hide();
                state.load = null;
                restoreLoadState();
            }
            const tr = state.transition;
            state.pending = null;
            state.pending_opts = null;
            if (tr && tr.type === 'shader') endShaderTransition(tr);
            if (tr && tr.phase === 'out') {
                // Непрерывно: alpha(t)=t/ms уже набрана, обратный ход идёт с
                // того же значения за оставшееся время.
                tr.phase = 'in';
                tr.t = Math.min(tr.t, tr.ms);
                state.phase = 'in';
            } else {
                state.transition = null;
                state.phase = null;
            }
            state.to_name = state.from_name || state.current_name;
            state.progress = { total: 0, done: 0, ratio: 0, label: '' };
            ctx.log(`$.scene.cancel: переход отменён (${reason || 'без причины'}), `
                    + `остаёмся в "${state.current_name}"`);
            return true;
        },

        /**
         * task-65 A1. Настройки экрана загрузки.
         *
         *   $.scene.loading({
         *       rml: 'ui/loading.rml',        // свой RmlUi-документ
         *       theme: 'ui/loading.rcss',     // стиль (нужен биндинг темы)
         *       min_ms: 300,                  // анти-мигание
         *       timeout_ms: 15000,            // вечный экран → R2D_SCENE_LOAD_TIMEOUT
         *       style: { color: '#e8f0ff', barColor: '#5ce1e6' },
         *   });
         *   $.scene.loading();                // текущие настройки
         */
        loading(opts) {
            if (opts === undefined) return Object.assign({}, state.loading_cfg);
            if (!opts || typeof opts !== 'object') {
                ctx.log('$.scene.loading: ожидается объект настроек');
                return scene;
            }
            if (opts.rml !== undefined) state.loading_cfg.rml = opts.rml ? String(opts.rml) : null;
            if (opts.theme !== undefined) state.loading_cfg.theme = opts.theme ? String(opts.theme) : null;
            if (opts.min_ms !== undefined) state.loading_cfg.min_ms = Math.max(0, Number(opts.min_ms) || 0);
            if (opts.min_loading_ms !== undefined) {
                state.loading_cfg.min_ms = Math.max(0, Number(opts.min_loading_ms) || 0);
            }
            if (opts.timeout_ms !== undefined) {
                state.loading_cfg.timeout_ms = Math.max(0, Number(opts.timeout_ms) || 0);
            }
            if (opts.style !== undefined) {
                state.loading_cfg.style = opts.style && typeof opts.style === 'object'
                    ? Object.assign({}, opts.style) : null;
            }
            return scene;
        },

        /** §45: handle последнего loadAsync (progress/cancel/error) или null. */
        pending() { return state.async_handle; },

        /** §45: отменить активный loadAsync. true — отменён. */
        cancelPending(reason) {
            const handle = state.async_handle;
            if (!handle || handle.done()) return false;
            return handle.cancel(reason);
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

        /**
         * Забыть текущую сцену, не загружая новую.
         *
         * Нужно тому, кто владеет миром сцены снаружи: `$.room.unload()`
         * закрывает комнату и её область, и машина сцен не должна остаться с
         * именем исчезнувшего мира. Иначе `$.scene.current()` обещает комнату,
         * которой уже нет, сейв пишет `scene: 'room:<id>'` для мира без неё, а
         * `$.room.adopt()` на таком снимке падает (R2D_ROOM_ADOPT) — §10 требует,
         * чтобы идентичность сцены/комнаты совпадала с фактическим миром.
         */
        clearCurrent(reason) {
            if (!state.current_name && !state.current) return false;
            const prev = state.current;
            const name = state.current_name;
            if (prev && typeof prev.exit === 'function') {
                try { prev.exit(ctx.$); } catch (e) {
                    ctx.log(`$: ошибка в exit сцены "${name}": ${e}`);
                }
            }
            state.current = null;
            state.current_name = '';
            state.pending = null;
            state.pending_opts = null;
            if (state.scope_name) {
                const scope = getScope(state.scope_name);
                state.scope_name = null;
                if (scope) scope.close({ immediate: true, reason: reason || 'сцена выгружена' });
            }
            return true;
        },

        /** Вернуться к сцене из стека. */
        pop(opts) {
            const prev = stack.pop();
            if (!prev) { ctx.log('$: стек сцен пуст — pop() игнорируется'); return scene; }
            const o = opts || {};
            return scene.load(prev, o);
        },

        /**
         * §10: вернуть ИДЕНТИЧНОСТЬ сцены после восстановления мира из снимка.
         *
         * Мир, пришедший из сейва, — это и есть результат сцены, поэтому её
         * builder (`prepare`/`enter`) НЕ запускается: `load()` поверх
         * восстановленного мира собрал бы второй мир (второй узел карты, второй
         * набор инстансов), то есть снимок перестал бы быть снимком. Восстановить
         * нужно ровно имя: `$.scene.current()` снова называет свой мир, а
         * текущая сцена — снова получает `update` (api.js тикает её каждый кадр).
         *
         * Возвращает структуру: `{ ok, scene, code, message }`. Неизвестная
         * сцена — честный отказ `{ ok: false, code: 'scene_unknown' }`, а не
         * тихая подмена: вызывающий (`$.save.restore`) превращает его в
         * структурированную диагностику R2D_SAVE_SCENE_UNKNOWN.
         */
        adopt(name, opts) {
            const o = opts || {};
            const key = name === undefined || name === null ? '' : String(name);
            if (!key) return { ok: false, scene: key, code: 'scene_empty', message: 'нужно имя сцены' };
            if (!scenes.has(key)) {
                return { ok: false, scene: key, code: 'scene_unknown',
                         message: `сцена "${key}" не зарегистрирована` };
            }
            if (state.current_name === key && state.current) {
                return { ok: true, scene: key, adopted: false, already: true, message: null };
            }
            const definition = scenes.get(key);
            state.current = typeof definition === 'object' ? definition : { enter: definition };
            state.current_name = key;
            // Отложенный переход, затемнение и ждущая регистрации сцена
            // относятся к ПРОШЛОМУ миру: если их не снять, ближайший кадр
            // снесёт восстановленный мир (сейв «загрузился» бы и тут же исчез),
            // а `scene.add` выполнил бы старый запрос. §10: снимок главнее
            // запроса, который был поставлен до него.
            if (o.keepPending !== true) {
                if (state.pending !== null && state.pending !== undefined) {
                    ctx.log(`$: отложенный переход на "${state.pending}" снят — мир заменён снимком`);
                }
                state.pending = null;
                state.pending_opts = null;
                state.transition = null;
                state.deferred = null;
                if (state.load) {
                    if (state.load.handle && !state.load.handle.done()) {
                        state.load.handle.cancel('мир заменён снимком');
                    }
                    if (state.load.screen) state.load.screen.hide();
                    state.load = null;
                    restoreLoadState();
                }
                state.phase = null;
                state.from_name = key;
                state.to_name = key;
                state.progress = { total: 0, done: 0, ratio: 0, label: '' };
            }
            return { ok: true, scene: key, adopted: true, already: false, message: null };
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
            const ms = (Number(dt) || 0) * 1000;
            const tr = state.transition;
            if (tr && tr.type === 'shader') tickShaderTransition(tr);
            if (tr) {
                if (tr.phase === 'out') {
                    tr.t += ms;
                    if (tr.t >= tr.ms) {
                        tr.t = tr.ms;
                        // Затемнение набрано: экран загрузки (если он нужен)
                        // либо сразу вход в новый мир.
                        beginChange();
                    }
                } else if (tr.phase === 'in') {
                    tr.t += ms;
                    if (tr.t >= tr.ms) {
                        endShaderTransition(tr);
                        state.transition = null;
                        state.phase = null;
                    }
                }
            }
            // Экран загрузки живёт отдельно от затемнения: полоса растёт по
            // реальным шагам, min_loading_ms держит экран, timeout_ms рубит
            // вечное ожидание.
            tickLoading(ms);
            doSwitch();
        },

        /** Внутреннее: рисует затемнение перехода. */
        _transitionAlpha() {
            const tr = state.transition;
            if (!tr) return 0;
            // Экран загрузки показывается на ПОЛНОСТЬЮ затемнённом кадре:
            // полоса не должна просвечивать мир прошлой сцены.
            if (tr.phase === 'load') return 1;
            const p = Math.min(1, tr.t / tr.ms);
            return tr.phase === 'out' ? p : 1 - p;
        },
        _transitionInfo() { return state.transition; },

        _state: state,
    };

    ctx.scene = scene;
    return scene;
}

// ---------------------------------------------------------------------------
// task-65. Жизненный цикл перехода: out → (load) → publish → in
// ---------------------------------------------------------------------------

/**
 * task-65 A2: shader-переход через наш пост-проход. Значения пост-эффекта,
 * которые переход трогает, сохраняются и возвращаются после него — игра не
 * должна потерять свои настройки.
 */
const SHADER_KEYS = ['distort', 'chromatic', 'wave_amp', 'wave_freq', 'wave_speed', 'wave_axis'];

function postApi() {
    const gfx = ctx.gfx;
    return gfx && typeof gfx.post === 'function' && (typeof gfx.postSupported !== 'function' || gfx.postSupported())
        ? gfx : null;
}

function beginShaderTransition(tr) {
    if (!tr || tr.type !== 'shader') return;
    const gfx = postApi();
    if (!gfx) {
        ctx.log('$.scene.change: shader-переход недоступен (пост-обработка выключена в сборке) — fade');
        tr.type = 'fade';
        return;
    }
    const now = gfx.post() || {};
    const saved = {};
    for (const key of SHADER_KEYS) if (now[key] !== undefined) saved[key] = now[key];
    tr.shader_saved = saved;
    tr.shader_on = true;
}

function tickShaderTransition(tr) {
    if (!tr || tr.type !== 'shader' || tr.shader_on !== true) return;
    const gfx = postApi();
    if (!gfx) return;
    const p = Math.min(1, tr.ms > 0 ? tr.t / tr.ms : 1);
    const k = tr.phase === 'out' ? p : 1 - p;
    const amount = (tr.amount === undefined ? 1 : tr.amount) * k;
    const name = tr.shader || 'wave';
    const params = { on: true };
    if (name === 'distort' || name === 'wave') {
        params.distort = 1.4 * amount;
        params.wave_amp = 0.05 * amount;
        params.wave_freq = 6;
        params.wave_speed = 9;
    } else if (name === 'chromatic' || name === 'glitch') {
        params.chromatic = 2.2 * amount;
        params.channel_shift = 0.02 * amount;
    } else {
        // Неизвестное имя — честный отказ по факту кадра: это fade.
        tr.type = 'fade';
        endShaderTransition(tr);
        return;
    }
    gfx.post(params);
}

function endShaderTransition(tr) {
    if (!tr || tr.shader_on !== true) return;
    tr.shader_on = false;
    const gfx = postApi();
    if (!gfx) return;
    const restore = Object.assign({}, tr.shader_saved || {});
    for (const key of SHADER_KEYS) if (restore[key] === undefined) restore[key] = 0;
    gfx.post(restore);
}

/** Сброс глобального света/темноты при смене сцены (task-65 A3). */
function resetSceneLight() {
    const gfx = ctx.gfx;
    const light = gfx && gfx.light;
    if (!light) return false;
    if (light.ambient && typeof light.ambient.off === 'function') light.ambient.off();
    if (typeof light.map === 'function') light.map({ on: false });
    if (typeof light.layer === 'function') light.layer(0xFFFFFFFF);
    return true;
}

/** Сброс визуального состояния сцены (fx + свет), с правом отказа. */
function resetSceneState(opts) {
    resetFx();
    if (!(opts && opts.keep_light)) resetSceneLight();
}

/** Поставить мир «на паузу» на время экрана загрузки и заглушить звук. */
function applyLoadState() {
    if (state.restore) return;
    const r = { time_paused: false, sound_muted: false };
    const time = ctx.time;
    if (time) {
        r.time_paused = typeof time.isPaused === 'function' ? time.isPaused() === true : false;
        if (!r.time_paused && typeof time.pause === 'function') time.pause();
    }
    const sound = ctx.sound;
    if (sound && typeof sound.mute === 'function') {
        r.sound_muted = sound.mute() === true;
        if (!r.sound_muted) sound.mute(true);
    }
    state.restore = r;
}

/** Вернуть состояние, снятое для экрана загрузки. */
function restoreLoadState() {
    const r = state.restore;
    if (!r) return;
    state.restore = null;
    const time = ctx.time;
    if (time && !r.time_paused && typeof time.resume === 'function') time.resume();
    const sound = ctx.sound;
    if (sound && typeof sound.mute === 'function' && !r.sound_muted) sound.mute(false);
}

/** Затемнение набрано: показать экран загрузки или сразу войти в мир. */
function beginChange() {
    const o = state.to_opts || {};
    const want_loading = !!(o.loading || o.timeout_ms > 0 || o.min_loading_ms > 0);
    if (want_loading) {
        state.phase = 'load';
        startChangeLoad();
        return;
    }
    if (state.transition) {
        state.transition.phase = 'in';
        state.transition.t = 0;
        state.phase = 'in';
    } else {
        state.phase = null;
    }
    state.pending = state.to_name;
    state.pending_opts = Object.assign({}, o, { transition: 'none' });
}

/** Начать работу загрузчика под уже показанным экраном. */
function startChangeLoad() {
    const o = state.to_opts || {};
    const name = state.to_name;
    const screen = makeLoadingScreen(o);
    screen.show();
    applyLoadState();
    const token = state.generation;
    const load = {
        token, screen, handle: null, ready: false, elapsed: 0, label: '', error: null,
    };
    state.load = load;
    const handle = startLoader(name, o, token, {
        screen: false,
        onReady: () => { load.ready = true; },
        onFailed: (error) => { abortChange(error); },
    });
    if (state.load !== load) return;      // загрузчик упал синхронно
    load.handle = handle;
    state.async_handle = handle;
    if (!handle) load.ready = true;       // работы нет, но экран держим min_ms
}

/** Экран загрузки завершён: публикуем сцену и гаснем. */
function finishChange() {
    const o = state.to_opts || {};
    const load = state.load;
    if (load) {
        if (load.screen) {
            load.screen.progress(1, '');
            load.screen.hide();
        }
        state.load = null;
        restoreLoadState();
    }
    state.progress = { total: 1, done: 1, ratio: 1, label: '' };
    const tr = state.transition;
    if (tr) {
        tr.phase = 'in';
        tr.t = 0;
        state.phase = 'in';
    } else {
        state.phase = null;
    }
    state.pending = state.to_name;
    state.pending_opts = Object.assign({}, o, { transition: 'none' });
    ctx.log(`$.scene.change("${state.to_name}"): загрузка завершена, `
            + `шагов ${state.progress.done}/${state.progress.total}`);
}

/** Отказ загрузки: прежний мир цел, затемнение снято, ошибка слышна. */
function abortChange(error) {
    const load = state.load;
    if (load) {
        if (load.handle && !load.handle.done()) load.handle.cancel('переход отменён');
        if (load.screen) load.screen.hide();
        state.load = null;
    }
    restoreLoadState();
    endShaderTransition(state.transition);
    state.pending = null;
    state.pending_opts = null;
    state.transition = null;
    state.phase = null;
    state.progress = { total: 0, done: 0, ratio: 0, label: '' };
    const to = state.to_name;
    state.to_name = state.current_name;
    const code = error && error.code ? error.code : 'R2D_SCENE_LOAD';
    const message = error && error.message ? error.message : String(error || 'загрузка не удалась');
    reportSceneError('$.scene.change', new Error(message), {
        code, operation: to, stage: error && error.stage ? error.stage : null,
    });
    if (ctx.$ && typeof ctx.$._dispatchGlobal === 'function') {
        ctx.$._dispatchGlobal(null, 'scene:error', {
            from: state.current_name, to, code, message,
        });
    }
}

/** Кадр экрана загрузки: прогресс по реальным шагам, min_ms и timeout. */
function tickLoading(ms) {
    const load = state.load;
    if (!load || state.phase !== 'load') return;
    const o = state.to_opts || {};
    load.elapsed += Math.max(0, Number(ms) || 0);

    if (load.handle && !load.handle.done()) {
        state.progress = progressSummary(load.handle, load.label);
    } else if (load.ready) {
        const prev = state.progress;
        state.progress = {
            total: prev.total, done: prev.total > 0 ? prev.total : 1,
            ratio: 1, label: '',
        };
    }

    if (!load.ready && o.timeout_ms > 0 && load.elapsed >= o.timeout_ms) {
        abortChange({
            code: 'R2D_SCENE_LOAD_TIMEOUT',
            message: `загрузка сцены "${state.to_name}" не уложилась в ${o.timeout_ms} мс`,
            stage: 'loading', scene: state.to_name,
        });
        return;
    }

    const ratio = load.ready ? 1 : state.progress.ratio;
    if (load.screen) load.screen.progress(ratio, load.ready ? '' : state.progress.label);
    if (ctx.$ && typeof ctx.$._dispatchGlobal === 'function') {
        ctx.$._dispatchGlobal(null, 'scene:progress', {
            from: state.from_name, to: state.to_name,
            total: state.progress.total, done: state.progress.done,
            ratio, label: state.progress.label,
        });
    }

    if (load.ready && load.elapsed >= (o.min_loading_ms || 0)) finishChange();
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
    // Во время затемнения и экрана загрузки мир не подменяем: иначе переход
    // публиковал бы сцену до того, как экран показал прогресс.
    if (state.transition && state.transition.phase === 'out') return;
    if (state.phase === 'load') return;

    const name = state.pending;
    const opts = state.pending_opts || {};
    state.pending = null;
    state.pending_opts = null;
    if (name === null) return;

    const from = state.current_name;
    const scoped = !!opts.scope;
    const prev = state.current;
    // Сцена закончилась — её звук гаснет (музыка, play, playAt), с затуханием.
    // Зовём ДО exit(): звук, запущенный в exit(), принадлежит уже новой сцене
    // и не должен гаснуть вместе со старой. `{ keep: true }` переживает переход.
    if (typeof ctx._stopSceneSound === 'function') {
        const stopped = ctx._stopSceneSound(opts.audio_fade);
        if (stopped > 0) {
            ctx.log(`$.scene: смена "${state.current_name}" → "${name}": снято звуков ${stopped}`
                    + ` (затухание ${opts.audio_fade === undefined ? 250 : opts.audio_fade} мс)`);
        }
    }
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
        // Свет и VFX принадлежат сцене и при scoped-переходе чистятся здесь:
        // clearWorld в этом пути не вызывается.
        resetSceneState(opts);
        state.scope_name = scope.name;
        state.current_name = name;
        state.history.push(name);
        const definition = scenes.get(name);
        state.current = typeof definition === 'object' ? definition : { enter: definition };
        // Подготовленная сцена уже построена (prepare/promote): второй прогон
        // `enter` собрал бы второй мир.
        if (typeof state.current.enter === 'function' && scope._scene_built !== true) {
            withScope(scope, () => {
                try { state.current.enter(ctx.$, scope); }
                catch (e) { ctx.log(`$: ошибка в enter сцены "${name}": ${e}`); }
            });
        }
        ctx.$._dispatchGlobal(null, 'scene:enter', { name, scope: scope.name });
        finishSwitch(from, name, opts);
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
    finishSwitch(from, name, opts);
}

/** Общая точка окончания смены: имена, события жизненного цикла. */
function finishSwitch(from, name, opts) {
    state.from_name = name;
    state.to_name = name;
    if (ctx.$ && typeof ctx.$._dispatchGlobal === 'function') {
        ctx.$._dispatchGlobal(null, 'scene:after-change', {
            from, to: name,
            transition: opts && opts.transition ? opts.transition : 'none',
            ms: opts && opts.ms !== undefined ? opts.ms : 0,
        });
    }
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
    // висеть на экране следующего уровня. Свет/темнота — тоже сцена
    // (task-65 A3), если игра не попросила `{ keep_light: true }`.
    resetFx();
    if (!(opts && opts.keep_light)) resetSceneLight();
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

// ---------------------------------------------------------------------------
// §23. Комнаты: открытые данные поверх prefab/scene + транзакция
// ---------------------------------------------------------------------------
//
// Комната — это ОПИСАНИЕ, а не второе дерево узлов: bounds, ссылка на карту,
// инстансы prefab, маркеры (спавн, выходы), exits и connections между
// комнатами. Описание валидируется ЦЕЛИКОМ до создания хоть одного узла, а
// сборка идёт в staging-области §5 (`$.scene.prepare`), поэтому:
//
//   * неудачная загрузка комнаты не меняет текущий мир — staging-область
//     закрывается, созданные в ней узлы уничтожаются;
//   * успешная публикуется одним переходом (`$.scene.commit`): прежняя комната
//     закрывается, новая становится текущей;
//   * `$.scene.current()` возвращает `room:<id>`, поэтому существующие
//     save/restore (§14) сохраняют идентификатор комнаты без отдельного поля.
//
// Идентификаторы инстансов и их детей — из данных (`instance.id`, путь ребёнка),
// а не из счётчика: повторное создание комнаты даёт те же логические ID.

/** Версия схемы данных комнаты. */
export const ROOM_SCHEMA = 1;

/** Код ошибки комнаты: `room_missing_marker` → `R2D_ROOM_MISSING_MARKER`. */
export function roomErrorCode(code) {
    const name = String(code === undefined || code === null || code === '' ? 'failed' : code);
    const upper = name.toUpperCase();
    return upper.indexOf('ROOM_') === 0 ? 'R2D_' + upper : 'R2D_ROOM_' + upper;
}

/** Нормализованное описание комнаты (без обращения к движку). */
export function normalizeRoom(id, data) {
    const d = data && typeof data === 'object' ? data : {};
    const key = d.id === undefined || d.id === null || d.id === '' ? String(id) : String(d.id);
    const out = {
        schema: d.schema === undefined ? ROOM_SCHEMA : d.schema,
        id: key,
        bounds: d.bounds && typeof d.bounds === 'object' ? {
            x: Number(d.bounds.x) || 0,
            y: Number(d.bounds.y) || 0,
            w: Number(d.bounds.w) || 0,
            h: Number(d.bounds.h) || 0,
        } : null,
        tilemap: d.tilemap && typeof d.tilemap === 'object' ? Object.assign({}, d.tilemap) : null,
        instances: Array.isArray(d.instances) ? d.instances.slice() : [],
        markers: d.markers && typeof d.markers === 'object' ? Object.assign({}, d.markers) : {},
        exits: Array.isArray(d.exits) ? d.exits.slice() : [],
        connections: Array.isArray(d.connections) ? d.connections.slice() : [],
        data: d.data && typeof d.data === 'object' ? d.data : {},
    };
    return out;
}

/** Клетки карты из данных: массив или {cols, rows, data}. */
function roomMapCells(map) {
    if (!map) return null;
    if (Array.isArray(map.data)) return map.data;
    return null;
}

/**
 * Проверка описания комнаты ДО сборки: схема, ссылки на prefab, уникальность
 * идентификаторов, маркеры, exits/connections и достижимость целевых комнат.
 *
 * `opts` (всё необязательно): `rooms` — Set/массив известных комнат,
 * `roomData(id)` — данные другой комнаты (для проверки `to_marker`),
 * `prefabs` — Set/массив известных prefab, `exists(path)` — проверка файла.
 *
 * Возвращает `{ ok, errors: [{ code, path, message }], room }`.
 */
export function validateRoom(id, data, opts) {
    const o = opts || {};
    const room = normalizeRoom(id, data);
    const errors = [];
    const warnings = [];
    const soft = new Set(['room_missing_room', 'room_missing_target_marker']);
    // `lazyRooms`: комната определяется раньше соседей — межкомнатные ссылки
    // становятся предупреждениями, а ошибкой остаются на переходе ($.room.goto,
    // $.room.enter), где ссылка действительно используется.
    const bad = (code, path, message) => {
        if (o.lazyRooms && soft.has(code)) warnings.push({ code, path, message });
        else errors.push({ code, path, message });
    };

    if (!data || typeof data !== 'object') {
        bad('room_data', '', 'описание комнаты — не объект');
        return { ok: false, errors, room };
    }
    if (room.schema !== ROOM_SCHEMA) {
        bad('room_schema', 'schema', `версия схемы ${room.schema}, поддерживается ${ROOM_SCHEMA}`);
    }
    if (!room.id) bad('room_id', 'id', 'у комнаты нет идентификатора');

    if (room.bounds) {
        const b = room.bounds;
        if (![b.x, b.y, b.w, b.h].every((n) => Number.isFinite(n)) || b.w <= 0 || b.h <= 0) {
            bad('room_bounds', 'bounds', 'bounds: нужны конечные числа и w/h > 0');
        }
    }

    const known_prefabs = o.prefabs instanceof Set ? o.prefabs
        : new Set(Array.isArray(o.prefabs) ? o.prefabs : []);
    const known_rooms = o.rooms instanceof Set ? o.rooms
        : new Set(Array.isArray(o.rooms) ? o.rooms : []);
    const prefab_exists = (name) => (known_prefabs.size ? known_prefabs.has(name)
        : !!(o.prefabHas && o.prefabHas(name)));
    const room_exists = (name) => (known_rooms.size ? known_rooms.has(name)
        : !!(o.roomHas && o.roomHas(name)));

    // Карта: либо ссылка на файл, либо уже существующий узел, либо inline-данные.
    const map = room.tilemap;
    if (map) {
        const has_existing = map.existing !== undefined && map.existing !== null;
        const has_data = Array.isArray(map.data) || (map.cols && map.rows && Array.isArray(map.data));
        if ((map.keep === true || has_existing) && !has_existing) {
            bad('room_bad_map', 'tilemap.existing', 'keep: true требует existing — селектор готового узла карты');
        } else if (!map.keep && !has_existing && !has_data && !map.path) {
            bad('room_bad_map', 'tilemap', 'нужен path к данным карты, existing (готовый узел) или data[]');
        }
        if (!map.keep && !has_existing && map.path && typeof o.exists === 'function' && !o.exists(map.path)) {
            bad('room_missing_map', 'tilemap.path', `файл карты "${map.path}" не найден`);
        }
        const map_cols = Number(map.cols !== undefined ? map.cols : map.mapW) || 0;
        const map_rows = Number(map.rows !== undefined ? map.rows : map.mapH) || 0;
        if (has_data && map_cols > 0 && map_rows > 0) {
            const cells = roomMapCells(map);
            if (cells && cells.length !== map_cols * map_rows) {
                bad('room_bad_map', 'tilemap.data',
                    `клеток ${cells.length}, ожидалось ${map_cols}×${map_rows} = ${map_cols * map_rows}`);
            }
        }
    }

    const ids = new Set();
    for (let i = 0; i < room.instances.length; i++) {
        const item = room.instances[i] || {};
        const where = `instances[${i}]`;
        if (!item.prefab && !item.data) {
            bad('room_instance', where, 'нужен prefab (имя) или data (инлайн-данные)');
        } else if (item.prefab && !prefab_exists(String(item.prefab))) {
            bad('room_missing_prefab', where + '.prefab', `prefab "${item.prefab}" не зарегистрирован`);
        }
        const inst_id = item.id === undefined || item.id === null || item.id === ''
            ? `${room.id}:${i}` : String(item.id);
        if (ids.has(inst_id)) {
            bad('room_duplicate_instance', where + '.id', `идентификатор "${inst_id}" повторяется`);
        }
        ids.add(inst_id);
        if (item.x !== undefined && !Number.isFinite(Number(item.x))) {
            bad('room_instance', where + '.x', 'x — не число');
        }
        if (item.y !== undefined && !Number.isFinite(Number(item.y))) {
            bad('room_instance', where + '.y', 'y — не число');
        }
        for (const path of Object.keys(item.children || {})) {
            const child_id = inst_id + '/' + path;
            if (ids.has(child_id)) {
                bad('room_duplicate_instance', where + '.children.' + path,
                    `идентификатор ребёнка "${child_id}" повторяется`);
            }
            ids.add(child_id);
        }
    }

    const marker_names = Object.keys(room.markers);
    for (const name of marker_names) {
        const m = room.markers[name] || {};
        if (!Number.isFinite(Number(m.x)) || !Number.isFinite(Number(m.y))) {
            bad('room_bad_marker', `markers.${name}`, 'нужны конечные x и y');
        }
    }

    const exit_ids = new Set();
    for (let i = 0; i < room.exits.length; i++) {
        const exit = room.exits[i] || {};
        const where = `exits[${i}]`;
        const eid = exit.id === undefined || exit.id === null || exit.id === ''
            ? (exit.marker === undefined ? `exit${i}` : String(exit.marker)) : String(exit.id);
        if (exit_ids.has(eid)) bad('room_duplicate_exit', where + '.id', `выход "${eid}" повторяется`);
        exit_ids.add(eid);
        if (exit.marker !== undefined && !marker_names.includes(String(exit.marker))) {
            bad('room_missing_marker', where + '.marker',
                `в комнате "${room.id}" нет маркера "${exit.marker}"`);
        }
        if (exit.to !== undefined && exit.to !== null && exit.to !== '') {
            const target = String(exit.to);
            if (!room_exists(target)) {
                bad('room_missing_room', where + '.to', `комната "${target}" не зарегистрирована`);
            } else if (exit.to_marker !== undefined && typeof o.roomData === 'function') {
                const other = o.roomData(target);
                const other_markers = other ? Object.keys(normalizeRoom(target, other).markers) : [];
                if (!other_markers.includes(String(exit.to_marker))) {
                    bad('room_missing_target_marker', where + '.to_marker',
                        `в комнате "${target}" нет маркера "${exit.to_marker}"`);
                }
            }
        }
    }
    for (let i = 0; i < room.connections.length; i++) {
        const conn = room.connections[i] || {};
        const where = `connections[${i}]`;
        if (conn.from !== undefined && !exit_ids.has(String(conn.from))) {
            bad('room_missing_connection', where + '.from',
                `в комнате "${room.id}" нет выхода "${conn.from}"`);
        }
        if (conn.to !== undefined && conn.to !== null && conn.to !== '' && !room_exists(String(conn.to))) {
            bad('room_missing_room', where + '.to', `комната "${conn.to}" не зарегистрирована`);
        }
    }

    return { ok: errors.length === 0, errors, warnings, room };
}

/**
 * §23: `$.room` — комнаты поверх `$.scene`/`$.prefab`/`$.tilemap`.
 * Ставится ПОСЛЕ этих подсистем (см. api.js): комната не дублирует их данные.
 */
export function installSceneRooms($) {
    const rooms = new Map();          // id → нормализованное описание
    let current = null;               // { id, scope, data, map, markers, exits, generation }
    let generation = 0;

    function report(entry) {
        if ($.debug && typeof $.debug.reportError === 'function') {
            $.debug.reportError('$.room', new Error(entry.message), {
                fatal: false,
                code: roomErrorCode(entry.code),
                data: { room: entry.room || null, path: entry.path || null },
            });
        }
        ctx.log(`$.room: [${entry.code}] ${entry.message}` + (entry.room ? ` (комната "${entry.room}")` : ''));
    }

    function failResult(id, stage, errors) {
        const list = Array.isArray(errors) ? errors : [{ code: 'room_failed', path: '', message: String(errors) }];
        for (const e of list) report({ code: e.code, path: e.path, message: e.message, room: id });
        return { ok: false, id: id === undefined ? null : String(id), stage, errors: list,
                 code: roomErrorCode(list[0] && list[0].code) };
    }

    function prefabNames() {
        try { return $.prefab && typeof $.prefab.list === 'function' ? $.prefab.list() : []; }
        catch (e) { return []; }
    }

    function validate(data, opts) {
        const o = Object.assign({
            prefabs: prefabNames(),
            rooms: [...rooms.keys()],
            roomData: (rid) => (rooms.has(String(rid)) ? rooms.get(String(rid)) : null),
            exists: ($.fs && typeof $.fs.exists === 'function') ? (p) => $.fs.exists(p) : null,
            roomHas: (rid) => rooms.has(String(rid)),
            prefabHas: (name) => !!($.prefab && $.prefab.has && $.prefab.has(String(name))),
        }, opts || {});
        return validateRoom(data && data.id !== undefined ? data.id : '', data, o);
    }

    /** Собрать комнату в staging-области. Публикует только `commit`. */
    function build(id, data, opts) {
        const o = opts || {};
        const source = data !== undefined ? data : rooms.get(String(id));
        const check = validate(source, o.validate);
        if (!check.ok) return failResult(id, 'validate', check.errors);
        const room = check.room;

        const scope_name = o.scope !== undefined ? String(o.scope) : nextScopeName('room', room.id);
        const handle = { ok: true, id: room.id, scope: scope_name, room, stage: 'built', stats: null };
        try {
            const scope = ensureScope(scope_name, {});
            handle.scope_object = scope;
            const built = withScope(scope, () => buildInto($, room, scope, o));
            // Собранное — в handle: `commit` публикует узел карты в текущей
            // комнате, а по нему комната опознаётся после восстановления мира
            // из снимка (§10: `current.map` — живой узел, а не догадка по id).
            handle.map_node = built && built.map ? built.map : null;
            handle.instances = built && Array.isArray(built.instances) ? built.instances : [];
            handle.nodes = built ? Number(built.nodes) || 0 : 0;
            handle.stats = ctx.room_state === undefined ? null : null;
        } catch (e) {
            const scope = getScope(scope_name);
            if (scope) scope.close({ immediate: true, reason: `комната "${room.id}": сборка не удалась` });
            return failResult(room.id, 'build', [{ code: 'room_build', path: '', message: String(e && e.message ? e.message : e) }]);
        }
        return handle;
    }

    /** Публикация: прежняя комната закрывается, новая становится текущей. */
    function commit(handle, opts) {
        if (!handle || handle.ok !== true) return failResult(handle && handle.id, 'commit', [{ code: 'room_handle', path: '', message: 'нужен успешный handle из $.room.build' }]);
        const room = handle.room;
        const scope = getScope(handle.scope);
        if (!scope || scope.state() !== 'active') {
            return failResult(room.id, 'commit', [{ code: 'room_scope', path: '', message: `область "${handle.scope}" уже закрыта` }]);
        }
        generation++;
        current = {
            id: room.id, scope: handle.scope, data: room,
            markers: room.markers, exits: room.exits, connections: room.connections,
            bounds: room.bounds, generation, map: handle.map_node || null,
            instances: handle.instances || [], nodes: handle.nodes || 0,
        };
        ctx.roomState = current;
        // Публикация идёт через машинку сцен: она закрывает ПРЕЖНЮЮ область
        // после готовности новой и ставит `$.scene.current() = "room:<id>"` —
        // это же значение сохраняет §14, поэтому ID комнаты переживает
        // save/restore без отдельного поля.
        if ($.scene && typeof $.scene.load === 'function') {
            const scene_name = 'room:' + room.id;
            if (typeof $.scene.has === 'function' && !$.scene.has(scene_name)) {
                $.scene.add(scene_name, {
                    prepare($_, scope) { buildInto($, room, scope, {}); },
                    enter($_, scope) {
                        if (!scope || scope._room_built !== true) buildInto($, room, scope, {});
                        ctx.roomState = current;
                    },
                });
            }
            const o = opts || {};
            $.scene.load(scene_name, Object.assign({}, o, {
                scope: handle.scope,
                // Комната публикуется на ближайшей границе кадра: переход-затухание
                // здесь был бы лишним (его заказывают явно), а `keepUI` по
                // умолчанию сохраняет HUD и глобальные узлы.
                transition: o.transition === undefined ? 'none' : o.transition,
                ms: o.ms === undefined ? 0 : o.ms,
                keepUI: o.keepUI === undefined ? true : o.keepUI,
            }));
        }
        if (typeof $._dispatchGlobal === 'function') {
            $._dispatchGlobal(null, 'room:enter', { id: room.id, generation });
        }
        if ($.room && typeof $.room._emit === 'function') $.room._emit('enter', { id: room.id, generation });
        return { ok: true, id: room.id, stage: 'committed', generation, scope: handle.scope,
                 nodes: current.nodes, operation: 'room' };
    }

    const api = {
        /** Зарегистрировать описание комнаты (сразу валидируется). */
        define(id, data) {
            const check = validateRoom(id, data, {
                prefabs: prefabNames(), rooms: [...rooms.keys()], lazyRooms: true,
            });
            if (!check.ok) {
                for (const e of check.errors) report({ code: e.code, path: e.path, message: e.message, room: String(id) });
                return null;
            }
            for (const w of check.warnings) {
                ctx.log(`$.room("${id}"): [${w.code}] ${w.message} — проверю на переходе`);
            }
            const room = check.room;
            rooms.set(room.id, Object.assign({}, data, { id: room.id, schema: room.schema }));
            // Комната — та же сцена: save/restore (§14) хранит `$.scene.current()`,
            // поэтому идентификатор комнаты переживает сохранение без нового поля.
            if ($.scene && typeof $.scene.add === 'function') {
                $.scene.add('room:' + room.id, {
                    prepare($_, scope) { buildInto($, room, scope, {}); },
                    enter($_, scope) {
                        if (!scope || scope._room_built !== true) buildInto($, room, scope, {});
                        ctx.roomState = { id: room.id, scope: scope ? scope.name : null,
                                          data: room, markers: room.markers, exits: room.exits,
                                          connections: room.connections, bounds: room.bounds,
                                          generation };
                    },
                });
            }
            return room;
        },
        has(id) { return rooms.has(String(id)); },
        get(id) { return rooms.get(String(id)) || null; },
        list() { return [...rooms.keys()]; },
        remove(id) {
            const key = String(id);
            rooms.delete(key);
            if ($.scene && typeof $.scene.remove === 'function') $.scene.remove('room:' + key);
            return true;
        },

        /** Проверка описания без регистрации: `$.room.validate(data)`. */
        validate(data, opts) { return validate(data, opts); },

        /** Собрать комнату (без публикации). */
        build(id, opts) { return build(id, undefined, opts); },
        commit(handle, opts) { return commit(handle, opts); },
        discard(handle) {
            if (!handle || !handle.scope) return false;
            const scope = getScope(handle.scope);
            if (!scope) return false;
            const ok = scope.close({ immediate: true, reason: 'сборка комнаты отменена' });
            return ok;
        },

        /**
         * Загрузить комнату: валидация → сборка в staging → публикация.
         * Ошибка на любой стадии не меняет текущий мир.
         */
        enter(id, opts) {
            const handle = build(id, undefined, opts);
            if (!handle.ok) return handle;
            const res = commit(handle, opts);
            if (!res.ok) {
                this.discard(handle);
                return res;
            }
            return res;
        },

        current() {
            if (!current) return null;
            const scope = current.scope ? getScope(current.scope) : null;
            if (!scope || scope.state() === 'closed') return Object.assign({}, current, { closed: true });
            return Object.assign({}, current, { closed: false });
        },
        generation() { return generation; },

        /** Маркер комнаты: `$.room.marker('spawn')` или `$.room.marker('level2:spawn')`. */
        marker(name, opts) {
            const key = String(name === undefined ? '' : name);
            const [room_id, marker_name] = key.indexOf(':') > 0 ? key.split(':') : [null, key];
            const target = room_id ? rooms.get(room_id) : (current ? current.data : null);
            if (!target) return failResult(room_id, 'marker', [{ code: 'room_missing_room', path: '', message: `комната "${room_id}" не зарегистрирована` }]);
            const marker = target.markers ? target.markers[marker_name] : null;
            if (!marker) {
                return failResult(target.id, 'marker', [{ code: 'room_missing_marker', path: marker_name, message: `в комнате "${target.id}" нет маркера "${marker_name}"` }]);
            }
            return { ok: true, room: target.id, name: marker_name,
                     x: Number(marker.x) || 0, y: Number(marker.y) || 0,
                     node: (opts && opts.node) || null, data: marker };
        },

        /** Выход комнаты: `$.room.exit('north')` → { to, to_marker, marker }. */
        exit(name) {
            if (!current) return failResult(null, 'exit', [{ code: 'room_none', path: '', message: 'текущей комнаты нет' }]);
            const key = String(name === undefined ? '' : name);
            const exit = (current.exits || []).find((e) => String(e.id) === key || String(e.marker) === key);
            if (!exit) {
                return failResult(current.id, 'exit', [{ code: 'room_missing_exit', path: key, message: `в комнате "${current.id}" нет выхода "${key}"` }]);
            }
            if (exit.to && !rooms.has(String(exit.to))) {
                return failResult(current.id, 'exit', [{ code: 'room_missing_room', path: key, message: `выход "${key}" ведёт в незарегистрированную комнату "${exit.to}"` }]);
            }
            return { ok: true, id: key, to: exit.to === undefined ? null : exit.to,
                     to_marker: exit.to_marker === undefined ? null : exit.to_marker,
                     marker: exit.marker === undefined ? null : exit.marker, data: exit };
        },

        /** Перейти по выходу: несуществующая комната/маркер — ошибка, мир не меняется. */
        goto(name, opts) {
            const exit = this.exit(name);
            if (!exit.ok) return exit;
            if (!exit.to) {
                return failResult(current ? current.id : null, 'goto', [{ code: 'room_no_target', path: String(name), message: `у выхода "${name}" нет цели (to)` }]);
            }
            if (exit.to_marker !== null) {
                const m = this.marker(String(exit.to) + ':' + String(exit.to_marker));
                if (!m.ok) return m;
            }
            return this.enter(exit.to, opts);
        },

        /**
         * §23: вернуть комнату по её узлу карты. Нужно после восстановления
         * мира из снимка (§14): узлы комнаты воссоздаются из данных, а
         * `$.room` должен снова знать, какая это была комната. Владение узлами
         * в этом случае у восстановленного мира, а не у staging-области.
         *
         * `adopt(id)` — вернуть КОНКРЕТНУЮ комнату: снимок (§10) хранит её имя
         * (`scene: 'room:<id>'`), и взять «первую попавшуюся» комнату с узлом
         * карты в мире означало бы молча подменить идентичность, если в
         * восстановленном мире узлов карты несколько.
         */
        adopt(id) {
            const want = id === undefined || id === null ? null : String(id);
            if (want !== null && !rooms.has(want)) {
                return failResult(want, 'adopt', [{ code: 'room_missing_room', path: '',
                    message: `комната "${want}" не зарегистрирована` }]);
            }
            for (const room of rooms.values()) {
                if (want !== null && room.id !== want) continue;
                const map = room.tilemap;
                if (!map) continue;
                const sel = '#map_' + room.id;
                const found = $(sel).toArray ? $(sel).toArray() : [];
                if (!found.length) continue;
                current = {
                    id: room.id, scope: null, data: room, markers: room.markers,
                    exits: room.exits, connections: room.connections, bounds: room.bounds,
                    generation, map: found[0], instances: [], nodes: 0, adopted: true,
                };
                ctx.roomState = current;
                return { ok: true, id: room.id, adopted: true, generation };
            }
            return failResult(want, 'adopt', [{ code: 'room_adopt', path: '',
                message: want === null
                    ? 'в мире нет узла карты ни одной зарегистрированной комнаты'
                    : `в мире нет узла карты комнаты "${want}" (#map_${want})` }]);
        },

        /** Выгрузить текущую комнату (узлы/подписки области закрываются). */
        unload() {
            if (!current) return false;
            const scope = current.scope ? getScope(current.scope) : null;
            const scene_name = 'room:' + current.id;
            current = null;
            ctx.roomState = null;
            // Комната — это сцена ('room:<id>', см. register): если выгрузили её,
            // машина сцен не должна продолжать указывать на несуществующий мир.
            // Иначе `$.scene.current()` обещал комнату, которой уже нет, сейв
            // записывал `scene: 'room:<id>'` для мира без неё, а `$.room.adopt()`
            // на таком снимке падал с R2D_ROOM_ADOPT (§10: идентичность
            // сцены/комнаты должна совпадать с фактическим миром).
            // Комната закрыта, если закрыта её область ИЛИ снята идентичность
            // сцены: закрытие области сцены могло произойти уже внутри
            // clearCurrent, и тогда повторный close вернёт false — это не отказ.
            const cleared = state.current_name === scene_name && $.scene
                && typeof $.scene.clearCurrent === 'function'
                ? $.scene.clearCurrent('комната выгружена') : false;
            if (!scope) return cleared;
            return scope.close({ immediate: true, reason: 'комната выгружена' }) || cleared;
        },

        stats() {
            const cur = this.current();
            return {
                rooms: rooms.size,
                current: cur ? cur.id : null,
                generation,
                closed: cur ? cur.closed === true : true,
                markers: cur && cur.markers ? Object.keys(cur.markers).length : 0,
                exits: cur && cur.exits ? cur.exits.length : 0,
                instances: cur && cur.instances ? cur.instances.length : 0,
                nodes: cur ? cur.nodes | 0 : 0,
            };
        },

        _emit(event, data) {
            const list = api_listeners.get(event);
            if (!list) return;
            for (const fn of list.slice()) {
                try { fn(data); } catch (e) { ctx.log(`$.room: ошибка в обработчике "${event}": ${e}`); }
            }
        },
        on(event, fn) {
            if (typeof fn !== 'function') return false;
            if (!api_listeners.has(event)) api_listeners.set(event, []);
            api_listeners.get(event).push(fn);
            return true;
        },
    };
    const api_listeners = new Map();

    $.room = api;
    ctx.room = api;
    ctx.roomState = null;
    return api;
}

/**
 * Привязать узел к области владения. Узлы, созданные фабрикой `$('<тег>')`,
 * область подхватывает сама (api.js зовёт `ctx.scopeTrack`), а инстансы
 * prefab создаются внутренним конструктором — их владение объявляем явно,
 * иначе смена комнаты оставила бы прежние инстансы жить (§5/§23).
 */
function ownRoomNode(scope, node) {
    if (!scope || !node || typeof scope.node !== 'function') return node;
    scope.node(node);
    return node;
}

/** Сборка комнаты внутри области: карта, инстансы prefab, маркеры. */
function buildInto($, room, scope, opts) {
    const o = opts || {};
    const built = { id: room.id, map: null, instances: [], markers: room.markers, nodes: 0 };

    // 1. Карта комнаты.
    const map = room.tilemap;
    if (map) {
        const selector = map.existing !== undefined && map.existing !== null ? String(map.existing)
            : (map.keep === true ? '#' + String(map.id || 'map') : null);
        if (selector) {
            // Карта уже в мире (общая для нескольких комнат): комната только
            // ссылается на неё, владение остаётся у того, кто её создал.
            const found = $(selector).toArray ? $(selector).toArray() : [];
            built.map = found.length ? found[0] : null;
            if (!built.map) ctx.log(`$.room("${room.id}"): карта "${selector}" не найдена`);
        } else {
            let data = Array.isArray(map.data) ? map.data : null;
            if (!data && map.path && $.fs) {
                const file = $.fs.readJSON(map.path, null);
                if (file && Array.isArray(file.data)) data = file.data;
            }
            const spec = Object.assign({}, map, { id: map.id || 'map' });
            if (data) spec.data = data;
            delete spec.path;
            delete spec.existing;
            delete spec.keep;
            delete spec.at;
            delete spec.x;
            delete spec.y;
            const node = $('<tilemap>', spec);
            if (map.at) node.at(Number(map.at[0]) || 0, Number(map.at[1]) || 0);
            else if (map.x !== undefined || map.y !== undefined) node.at(Number(map.x) || 0, Number(map.y) || 0);
            node.appendTo($.world);
            built.map = node.toArray ? node.toArray()[0] : null;
            ownRoomNode(scope, built.map);
        }
    }

    // 2. Инстансы prefab: id из данных, дети — по пути.
    for (let i = 0; i < room.instances.length; i++) {
        const item = room.instances[i] || {};
        const inst_id = item.id === undefined || item.id === null || item.id === ''
            ? `${room.id}:${i}` : String(item.id);
        let created = null;
        if (item.data) {
            const node = $.prefab.load(item.data, $.world);
            created = node.toArray ? node.toArray()[0] : null;
        } else {
            const wrapper = $.prefab.instantiate(String(item.prefab), {
                id: inst_id,
                x: item.x === undefined ? undefined : Number(item.x),
                y: item.y === undefined ? undefined : Number(item.y),
                overrides: item.overrides,
            });
            created = wrapper.toArray ? wrapper.toArray()[0] : null;
        }
        if (created) {
            forceNodeId(created, inst_id);
            ownRoomNode(scope, created);
            built.instances.push(inst_id);
            built.nodes++;
            // Переопределения детей по пути: id и атрибуты.
            const children = item.children || {};
            for (const path of Object.keys(children)) {
                const node = childByPath(created, path);
                if (!node) {
                    ctx.log(`$.room("${room.id}"): у инстанса "${inst_id}" нет ребёнка "${path}"`);
                    continue;
                }
                applyChildOverrides(node, children[path], inst_id + '/' + path);
            }
            if (item.children_ids !== false && o.stable_child_ids !== false) {
                assignChildIds(created, inst_id);
            }
        }
    }

    // 3. Маркеры: данные есть всегда; узлы — только если в данных `node: true`.
    for (const name of Object.keys(room.markers)) {
        const m = room.markers[name] || {};
        if (m.node !== true) continue;
        const node = $('<rect>', { id: 'marker_' + name })
            .at(Number(m.x) || 0, Number(m.y) || 0)
            .size(Number(m.w) || 8, Number(m.h) || 8)
            .alpha(0);
        node.addClass('room-marker');
        node.attr('marker', name);
        if (m.tag) node.attr('marker_tag', m.tag);
        node.appendTo($.world);
        ownRoomNode(scope, node.toArray ? node.toArray()[0] : node);
        built.nodes++;
    }

    scope._room_built = true;
    scope._room = built;
    return built;
}

/**
 * Поставить узлу логический id из данных комнаты.
 *
 * `$.prefab.instantiate` разводит совпадающие id (freshId → "torch_a2"), когда
 * узел с таким id ещё жив — а при перезагрузке комнаты прежний инстанс жив до
 * конца кадра. Для комнаты важнее стабильный идентификатор из данных: он же
 * уходит в сохранение (§14), поэтому id фиксируем явно (реестр byId — по
 * владельцу, узел прежней комнаты свою запись не затирает).
 */
function forceNodeId(node, id) {
    if (!node || id === undefined || id === null || id === '') return node;
    const key = String(id);
    if (node.id !== undefined && ctx.byId && ctx.byId.get(node.id) === node) ctx.byId.delete(node.id);
    node.id = key;
    if (ctx.byId) ctx.byId.set(key, node);
    return node;
}

/** Ребёнок по пути `a/b/c`: по id, затем по индексу. */
function childByPath(root, path) {
    let node = root;
    for (const part of String(path).split('/')) {
        if (!node) return null;
        const children = node.child_nodes || [];
        let next = children.find((c) => c.id === part);
        if (!next && /^\d+$/.test(part)) next = children[Number(part)];
        node = next || null;
    }
    return node;
}

/** Переопределения ребёнка: id и произвольные атрибуты. */
function applyChildOverrides(node, spec, fallback_id) {
    if (!spec || typeof spec !== 'object') return node;
    for (const key of Object.keys(spec)) {
        if (key === 'id') {
            forceNodeId(node, spec.id);
            continue;
        }
        if (key === 'x' || key === 'y') { node.set(key, Number(spec[key])); continue; }
        node.set(key, spec[key]);
    }
    if (spec.id === undefined && fallback_id && node.id === undefined) node.id = fallback_id;
    return node;
}

/** Стабильные логические id детей: `<инстанс>/<путь>` (§23: не случайные). */
function assignChildIds(root, prefix) {
    const walk = (node, path) => {
        for (let i = 0; i < (node.child_nodes || []).length; i++) {
            const child = node.child_nodes[i];
            const part = child.id !== undefined && child.id !== '' && String(child.id).indexOf(':') < 0
                ? String(child.id) : String(i);
            const full = path === '' ? part : path + '/' + part;
            if (child.id === undefined || child.id === '' || String(child.id).indexOf(':') >= 0) {
                forceNodeId(child, prefix + '/' + full);
            }
            walk(child, full);
        }
    };
    walk(root, '');
    return root;
}
