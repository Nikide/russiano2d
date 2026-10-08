// ===========================================================================
// Твины и анимации: .moveTo(), .tween(), .fadeTo(), .shake(), .flash().
//
// Всё асинхронно: каждый метод возвращает Promise, который разрешается, когда
// анимация закончилась. Это позволяет писать сценарии линейно:
//
//   await $('#hero').moveTo(400, 200, 600);
//   await $('#hero').fadeTo(0, 300);
//
// Движок твинов — обычный список активных записей; он обновляется раз в кадр
// из $.time, поэтому пауза времени останавливает и анимации.
// ===========================================================================

import { engine } from './native.js';
import { ctx, Node, query, nativeNodes } from './core.js';

// ---------------------------------------------------------------------------
// Функции плавности
// ---------------------------------------------------------------------------

const EASES = {
    linear: (t) => t,
    ease: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeIn: (t) => t * t,
    easeOut: (t) => 1 - (1 - t) * (1 - t),
    easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
    easeInQuart: (t) => t * t * t * t,
    easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
    easeInBack: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
    easeOutBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    easeInOutBack: (t) => (t < 0.5
        ? (Math.pow(2 * t, 2) * (7.189819 * t - 2.5949095)) / 2
        : (Math.pow(2 * t - 2, 2) * (3.5949095 * (t * 2 - 2) + 2.5949095) + 2) / 2),
    easeOutElastic: (t) => (t === 0 ? 0 : t === 1 ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    easeInElastic: (t) => (t === 0 ? 0 : t === 1 ? 1
        : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))),
    easeOutBounce: (t) => {
        const n1 = 7.5625, d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    easeInBounce: (t) => 1 - EASES.easeOutBounce(1 - t),
    easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
    step: (t) => (t < 1 ? 0 : 1),
};

export function easeFunction(ease) {
    if (typeof ease === 'function') return ease;
    if (typeof ease === 'string' && EASES[ease]) return EASES[ease];
    if (ease !== undefined && ease !== null) {
        ctx.log(`$: неизвестная плавность "${ease}" — беру easeInOut`);
    }
    return EASES.easeInOut;
}

export function easeNames() { return Object.keys(EASES); }

// ---------------------------------------------------------------------------
// Переходы и плавности в духе Godot 4 (trans × ease)
//
// У Godot две независимые оси: trans задаёт форму кривой (sine/quad/…), ease —
// куда её приложить (in/out/in_out/out_in). Держим их раздельно, поэтому
// `transitionFunction('quad', 'out')` — это чистая функция без состояния, её
// удобно проверять таблицей значений в qjs.
// ---------------------------------------------------------------------------

// Базовые кривые: все начинаются в 0 и заканчиваются в 1. Это «форма in»;
// out/in_out/out_in получаются зеркалированием, как в Godot.
const TRANSITIONS = {
    linear: (t) => t,
    sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    quad: (t) => t * t,
    cubic: (t) => t * t * t,
    quart: (t) => t * t * t * t,
    quint: (t) => t * t * t * t * t,
    expo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    circ: (t) => 1 - Math.sqrt(1 - t * t),
    elastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1
        : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))),
    back: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
    bounce: (t) => {
        const n1 = 7.5625, d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) { const u = t - 1.5 / d1; return n1 * u * u + 0.75; }
        if (t < 2.5 / d1) { const u = t - 2.25 / d1; return n1 * u * u + 0.9375; }
        const u = t - 2.625 / d1;
        return n1 * u * u + 0.984375;
    },
    // Затухающая пружина. Нормируем на (1 - e^-6), чтобы f(0) = 0 и f(1) = 1
    // строго: иначе «конец» твина на секунду-другую не совпадал бы с целью.
    spring: (t) => (1 - Math.exp(-6 * t) * Math.cos(4 * Math.PI * t)) / (1 - Math.exp(-6)),
};

/** Каноническое имя плавности: inOut/in-out → in_out, outIn → out_in. */
export function normalizeEaseKind(kind) {
    if (kind === undefined || kind === null) return 'in_out';
    switch (kind) {
    case 'inOut': case 'in-out': case 'easeInOut': return 'in_out';
    case 'outIn': case 'out-in': case 'easeOutIn': return 'out_in';
    case 'in': case 'easeIn': return 'in';
    case 'out': case 'easeOut': return 'out';
    default: return kind;
    }
}

/** Имена переходов — для справки и тестов. */
export function transitionNames() { return Object.keys(TRANSITIONS); }

/** Имена плавностей — для справки и тестов. */
export function easeKinds() { return ['in', 'out', 'in_out', 'out_in']; }

/**
 * Чистая функция перехода: (trans, ease) → (t ∈ [0..1]) → [0..1].
 *
 * Границы жёсткие: t <= 0 даёт ровно 0, t >= 1 — ровно 1, что бы ни вытворяла
 * кривая внутри (elastic/back/spring перелетают цель в середине — это норма).
 * Неизвестное имя не роняет игру: пишем в журнал и берём linear/in_out.
 */
export function transitionFunction(trans, ease) {
    let base = TRANSITIONS[trans];
    if (typeof trans === 'function') base = trans;
    if (!base) {
        if (trans !== undefined && trans !== null && trans !== 'linear') {
            ctx.log(`$: неизвестный переход "${trans}" — беру linear`);
        }
        base = TRANSITIONS.linear;
    }
    const kind = normalizeEaseKind(ease);
    return (t) => {
        if (!(t > 0)) return 0;
        if (t >= 1) return 1;
        switch (kind) {
        case 'in': return base(t);
        case 'out': return 1 - base(1 - t);
        case 'out_in':
            return t < 0.5 ? (1 - base(1 - 2 * t)) / 2 : (1 + base(2 * t - 1)) / 2;
        case 'in_out':
        default:
            return t < 0.5 ? base(2 * t) / 2 : 1 - base(2 - 2 * t) / 2;
        }
    };
}

// ---------------------------------------------------------------------------
// Свойства узла, которые умеет анимировать твинер
// ---------------------------------------------------------------------------

function readProp(node, key) {
    switch (key) {
    case 'x': return node.x;
    case 'y': return node.y;
    case 'alpha': case 'opacity': return node.alpha;
    case 'angle': return node.angle;
    case 'scale': return node.scale_x;
    case 'scaleX': return node.scale_x;
    case 'scaleY': return node.scale_y;
    case 'w': case 'width': return node.w;
    case 'h': case 'height': return node.h;
    case 'value': return node.value;
    default: {
        const v = node.attrs[key];
        return typeof v === 'number' ? v : 0;
    }
    }
}

function writeProp(node, key, value) {
    switch (key) {
    case 'x': node.moveToX(value); return;
    case 'y': node.moveToY(value); return;
    case 'alpha': case 'opacity': node.alpha = value; return;
    case 'angle': node.angle = value; return;
    case 'scale': node.scale_x = node.scale_y = value; return;
    case 'scaleX': node.scale_x = value; return;
    case 'scaleY': node.scale_y = value; return;
    case 'w': case 'width': node.w = value; return;
    case 'h': case 'height': node.h = value; return;
    case 'value': node.value = value; return;
    default: node.attrs[key] = value; return;
    }
}

// ---------------------------------------------------------------------------
// Активные твины
// ---------------------------------------------------------------------------

const active = [];
let paused_all = false;

// --- Нативная лента (src/nodes.c) -------------------------------------------
//
// Числовой твин свойства узла со встроенной плавностью целиком считает C:
// состояние, плавность и запись в узел. Здесь — только Promise по id.
// Своя функция плавности и запись в attrs остаются в JS-ленте `active`.
// Номера свойств и плавностей совпадают с enum/switch в src/nodes.c.
const NATIVE_PROPS = {
    x: 0, y: 1, alpha: 2, opacity: 2, angle: 3, scale: 4, scaleX: 5, scaleY: 6,
    w: 7, width: 7, h: 8, height: 8, value: 9,
};
const NATIVE_EASES = {
    linear: 0, ease: 1, easeIn: 2, easeOut: 3, easeInOut: 4, easeInCubic: 5,
    easeOutCubic: 6, easeInOutCubic: 7, easeInQuad: 8, easeOutQuad: 9, easeInQuart: 10,
    easeOutQuart: 11, easeInBack: 12, easeOutBack: 13, easeInOutBack: 14,
    easeOutElastic: 15, easeInElastic: 16, easeOutBounce: 17, easeInBounce: 18,
    easeInSine: 19, easeOutSine: 20, step: 21,
};
const native_resolvers = new Map();   // id → { node, resolve }

/**
 * Лента для уже созданных нативных твинов. Переключатель
 * $.debug.nativePasses(false) решает только, куда пойдут НОВЫЕ твины, —
 * начатые в C должны доиграть, а не замереть.
 */
function tweenLane() {
    const n = engine && engine.nodes;
    return n && typeof n === 'object' && typeof n.tweenStep === 'function' ? n : null;
}

/** Номер встроенной плавности для C или -1 (своя функция, неизвестное имя). */
function nativeEase(ease) {
    if (ease === undefined || ease === null) return NATIVE_EASES.easeInOut;
    if (typeof ease !== 'string') return -1;
    const id = NATIVE_EASES[ease];
    return id === undefined ? -1 : id;
}

function resolveNative(ids) {
    for (let i = 0; i < ids.length; i++) {
        const entry = native_resolvers.get(ids[i]);
        if (entry === undefined) continue;
        native_resolvers.delete(ids[i]);
        entry.resolve(entry.node);
    }
}

/** Запускает твин свойств. Возвращает Promise, разрешающийся по завершении. */
export function tweenProps(node, spec, ms, ease) {
    const keys = Object.keys(spec);
    if (keys.length === 0) return Promise.resolve(node);
    const from = {}, to = {};
    for (const key of keys) {
        from[key] = readProp(node, key);
        let target = spec[key];
        // Поддержка относительных значений: '+10' / '-2'.
        if (typeof target === 'string' && /^[+-]/.test(target)) target = from[key] + parseFloat(target);
        to[key] = target;
    }
    if (!(ms > 0)) {
        for (const key of keys) writeProp(node, key, to[key]);
        return Promise.resolve(node);
    }
    const native = nativeNodes();
    const ease_id = native ? nativeEase(ease) : -1;
    if (ease_id >= 0 && keys.length <= 8 && keys.every((k) => NATIVE_PROPS[k] !== undefined)) {
        const props = keys.map((k) => NATIVE_PROPS[k]);
        const a = keys.map((k) => from[k]);
        const b = keys.map((k) => to[k]);
        return new Promise((resolve) => {
            const id = native.tweenAdd(node, props, a, b, ms, ease_id);
            native_resolvers.set(id, { node, resolve });
        });
    }
    return new Promise((resolve) => {
        active.push({
            node, keys, from, to, ms, t: 0,
            ease: easeFunction(ease),
            paused: false,
            resolve,
        });
    });
}

/** Пауза/остановка твинов конкретного узла. */
export function clearNodeTweens(node, resolveThem) {
    const native = native_resolvers.size ? tweenLane() : null;
    if (native) {
        const ids = native.tweenClear(node);
        if (ids) {
            if (resolveThem) resolveNative(ids);
            else for (let i = 0; i < ids.length; i++) native_resolvers.delete(ids[i]);
        }
    }
    for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].node === node) {
            const tw = active[i];
            active.splice(i, 1);
            if (resolveThem) tw.resolve(node);
        }
    }
}

export function pauseNodeTweens(node, paused) {
    if (native_resolvers.size) {
        const native = tweenLane();
        if (native) native.tweenPause(node || null, paused);
    }
    for (const tw of active) if (!node || tw.node === node) tw.paused = paused;
}

export function pauseAll(paused) { paused_all = paused; }
export function activeTweenCount() { return active.length + native_resolvers.size; }

/** Тик твинов. Вызывается из $.time каждый кадр. */
export function tickTweens(dt) {
    if (paused_all) return;
    const ms = dt * 1000;
    // Нативная лента — первой; при одновременных твинах одного свойства из
    // двух лент последней пишет JS-лента (своя плавность, attrs).
    if (native_resolvers.size) {
        const native = tweenLane();
        if (native) {
            const done = native.tweenStep(ms);
            if (done) resolveNative(done);
        }
    }
    if (active.length === 0) return;
    for (let i = active.length - 1; i >= 0; i--) {
        const tw = active[i];
        if (tw.paused) continue;
        tw.t += ms;
        const p = Math.min(1, tw.t / tw.ms);
        const e = tw.ease(p);
        for (const key of tw.keys) {
            writeProp(tw.node, key, tw.from[key] + (tw.to[key] - tw.from[key]) * e);
        }
        if (p >= 1) {
            active.splice(i, 1);
            tw.resolve(tw.node);
        }
    }
}

// ---------------------------------------------------------------------------
// Эффекты на узле (живут в самом узле, применяются при отрисовке)
// ---------------------------------------------------------------------------

// Сколько узлов живёт с активным эффектом (тряска, вспышка, кадры
// неуязвимости). Точное значение пересчитывается в конце каждого прохода
// tickEffects — так счётчик самолечится, а setter'ы лишь поднимают флаг
// входа. Без него подсистема обходила весь реестр каждый кадр впустую
// (docs/HIGH_LEVEL_API_PERF.md §3.3).
let fx_live = 0;

/** Сообщить, что у узла появился активный эффект (см. shakeNode/flashNode). */
export function noteEffect(node) {
    node._fx = true;
    fx_live++;
}

/** Тряска: смещает картинку узла, не трогая его координаты. */
export function shakeNode(node, intensity, ms) {
    node.shake_amount = intensity;
    node.shake_timer = Math.max(node.shake_timer, ms / 1000);
    node.shake_total = node.shake_timer;
    if (ms > 0) noteEffect(node);
}

/** Вспышка цвета: временная подмена тона. */
export function flashNode(node, color, ms) {
    node.tint = color;
    node.tint_timer = ms / 1000;
    if (ms > 0) noteEffect(node);
}

export function tickEffects(dt) {
    if (fx_live === 0) return;
    const nodes = ctx.nodes;
    const native = nativeNodes();
    if (native) { fx_live = native.tickEffects(nodes, dt); return; }
    let live = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.shake_timer > 0) {
            node.shake_timer -= dt;
            if (node.shake_timer <= 0) { node.shake_timer = 0; node.shake_amount = 0; }
        }
        if (node.tint_timer > 0) {
            node.tint_timer -= dt;
            if (node.tint_timer <= 0) { node.tint_timer = 0; node.tint = null; }
        }
        if (node.iframes > 0) node.iframes -= dt;
        if (node.shake_timer > 0 || node.tint_timer > 0 || node.iframes > 0) live++;
        else if (node._fx === true) node._fx = false;
    }
    // Пересчёт по факту: счётчик не может «залипнуть» из-за удалённых узлов,
    // узлов в пуле или эффектов, поставленных мимо setter'ов.
    fx_live = live;
}

/**
 * Учесть эффекты узла, вернувшегося в реестр из пула: пока узел был снаружи,
 * tickEffects его не видел и не мог списать счётчик.
 */
export function noteNodeEffects(node) {
    if (node.shake_timer > 0 || node.tint_timer > 0 || node.iframes > 0) noteEffect(node);
}

/** Последовательность: массив функций, возвращающих Promise, или задержек. */
export async function sequence(steps) {
    for (const step of steps) {
        if (typeof step === 'function') await step();
        else if (typeof step === 'number') await wait(step);
        else if (step && typeof step.then === 'function') await step;
    }
}

/** Ожидание в миллисекундах внутри игрового времени (уважает паузу). */
export function wait(ms) {
    return new Promise((resolve) => {
        const timer = { left: ms, resolve };
        ctx.timers.push(timer);
    });
}

/** Тик таймеров $.time.wait / $.time.after / $.time.every. */
export function tickTimers(dt) {
    const ms = dt * 1000;
    for (let i = ctx.timers.length - 1; i >= 0; i--) {
        const t = ctx.timers[i];
        t.left -= ms;
        if (t.left <= 0) {
            ctx.timers.splice(i, 1);
            t.resolve();
        }
    }
}

// ---------------------------------------------------------------------------
// Tween-объекты в духе Godot 4 (create_tween / tween_property / chain)
//
// Отличие от твинов выше: это не Promise на один переход, а объект-сценарий
// с шагами, цепочками, циклами, скоростью и событиями. Старый API
// (.tween(), .moveTo(), $.sequence) остаётся и работает как раньше.
//
//   const t = $.tween($('#hero'));
//   t.property('x', 400, 0.6).trans('quad').ease('out');
//   t.property('alpha', 0.2, 0.6).delay(0.1);
//   t.chain().property('y', 120, 0.4);
//   t.loops(2).on('finished', () => $.log('готово'));
//   await t.finished();
//
// Контракт для реализации:
//   installTween($)            — вешает $.tween(target?) и $.tweenOf(object)
//   tickTweenObjects(dt, raw)  — шаг всех активных Tween'ов; dt уже с учётом
//                                паузы и $.time.scale, raw — реальный кадр
//                                (нужен для ignoreTimeScale)
// ---------------------------------------------------------------------------

// --- Цели и свойства -------------------------------------------------------

/**
 * Приводит цель твина к одному объекту: узел, обёртка (первый узел), селектор
 * или произвольный объект. Пустая обёртка/селектор дают null — твин создаётся,
 * но property() напишет в журнал, что цели нет.
 */
export function resolveTweenTarget(target) {
    if (target === undefined || target === null) return null;
    if (typeof target === 'string') {
        const found = query(target);
        return found.length ? found[0] : null;
    }
    if (target && Array.isArray(target.nodes)) return target.nodes[0] || null;
    return target;
}

/** Число по вложенному пути 'a.b.c'; отсутствие/не-число читается как 0. */
export function getPathValue(object, path) {
    if (!object) return 0;
    const parts = String(path).split('.');
    let cur = object;
    for (let i = 0; i < parts.length - 1 && cur != null; i++) cur = cur[parts[i]];
    const value = cur == null ? undefined : cur[parts[parts.length - 1]];
    return typeof value === 'number' && isFinite(value) ? value : 0;
}

/** Пишет число по вложенному пути, создавая недостающие объекты. */
export function setPathValue(object, path, value) {
    if (!object) return;
    const parts = String(path).split('.');
    let cur = object;
    for (let i = 0; i < parts.length - 1; i++) {
        let next = cur[parts[i]];
        if (next === null || typeof next !== 'object') { next = {}; cur[parts[i]] = next; }
        cur = next;
    }
    cur[parts[parts.length - 1]] = value;
}

/** Чтение свойства цели: узел — через readProp, объект — по пути. */
function readTarget(target, prop) {
    if (!target) return 0;
    if (target instanceof Node && String(prop).indexOf('.') < 0) return readProp(target, prop);
    return getPathValue(target, prop);
}

/** Запись свойства цели: узел — через writeProp (с переносом тела), объект — по пути. */
function writeTarget(target, prop, value) {
    if (!target) return;
    if (target instanceof Node && String(prop).indexOf('.') < 0) { writeProp(target, prop, value); return; }
    setPathValue(target, prop, value);
}

/** Узел исчез из мира или убит (max_hp > 0 и hp кончились)? */
function targetDead(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.removed === true) return true;
    if (typeof node.max_hp === 'number' && node.max_hp > 0 && node.cur_hp <= 0) return true;
    return false;
}

// --- Твинер (один шаг сценария) -------------------------------------------

/**
 * Один твинер: property / method / callback / interval. Модификаторы
 * (.from/.asRelative/.delay/.trans/.ease/.interpolator) — тут, а .chain()/.loops()
 * — на самом Tween, как в Godot: после настройки твинера вы продолжаете
 * работать с переменной tween'а.
 */
class Tweener {
    constructor(kind, seconds) {
        this.kind = kind;
        this.prop = null;
        this.to = 0;
        this.fn = null;
        this.duration = Math.max(0, Number(seconds) || 0);
        this.delay_time = 0;
        this.relative = false;
        this.trans_name = null;
        this.ease_kind = null;
        this.interp = null;
        this.from_value = undefined;
        // Состояние выполнения.
        this.started = false;
        this.done = false;
        this.fired = false;
        this._prepared = false;
        this._origin = undefined;
        this.from_cache = 0;
        this.to_cache = 0;
        this.ease_fn = null;
        this._tween = null;
    }

    _touch() {
        // Мгновенный твинер уже записал значение при создании; модификатор,
        // вызванный следом (.from, .asRelative…), должен переиграть запись —
        // иначе .from(10) на нулевой длительности молча терялся бы.
        if (this._tween) this._tween._applyInstant(this);
        return this;
    }

    /** Явное начальное значение (по умолчанию — текущее в момент старта). */
    from(value) { this.from_value = Number(value); return this._touch(); }
    /** Начать от текущего значения (снимается в момент старта шага). */
    fromCurrent() { this.from_value = undefined; return this._touch(); }
    /** `to` — приращение к начальному значению, а не абсолютная цель. */
    asRelative() { this.relative = true; return this._touch(); }
    /** Задержка перед началом этого твинера, секунды. */
    delay(seconds) {
        this.delay_time = Math.max(0, Number(seconds) || 0);
        // Мгновенный property-твинер применяется прямо в _add(), то есть до
        // этого вызова. Если задержку задали после, откатываем значение и
        // отдаём твинер обычному тику — иначе .delay(1) молча терялся.
        // delay(0) ничего не откладывает, поэтому поведение не меняем.
        if (this.delay_time > 0 && this._instant && this._tween) this._tween._rearmInstant(this);
        return this;
    }
    /** Переход именно для этого твинера (иначе — общий у Tween). */
    trans(name) { this.trans_name = name; return this._touch(); }
    /** Плавность именно для этого твинера (in/out/in_out/out_in). */
    ease(kind) { this.ease_kind = kind; return this._touch(); }
    /** Своя интерполяция: fn(from, to, t) → значение. t — уже с плавностью. */
    interpolator(fn) { this.interp = typeof fn === 'function' ? fn : null; return this._touch(); }
}

// Алиас под старое имя: `.delaySeconds(sec)`.
Tweener.prototype.delaySeconds = function (seconds) { return this.delay(seconds); };

// --- Tween ------------------------------------------------------------------

const active_tweens = [];

/**
 * Tween-сценарий в духе Godot 4.
 *
 * Твинеры, добавленные подряд, идут ПАРАЛЛЕЛЬНО (один «шаг»); `chain()`
 * начинает новый шаг, который стартует после завершения предыдущего.
 * `loops(n)` повторяет весь сценарий, `finished` приходит один раз в конце
 * (при loops(-1) — никогда, только `loop`).
 */
export class Tween {
    constructor(target) {
        this.target = target;            // null | Node | произвольный объект
        this._steps = [];
        this._current = null;
        this._step = 0;
        this._step_time = 0;
        this._loop = 0;
        this._loops = 1;
        this._speed = 1;
        this._elapsed = 0;
        this._valid = true;
        this._finished = false;
        this._paused = false;
        this._running = true;
        this._ignore_scale = false;
        this._bound = null;
        this._listeners = new Map();
        this._finished_promise = null;
        this._finished_resolve = null;
        this._default_trans = 'linear';
        this._default_ease = 'in_out';
        this._beginStep();
        active_tweens.push(this);
    }

    // --- шаги ---------------------------------------------------------------

    _beginStep() {
        this._current = [];
        this._steps.push(this._current);
        return this._current;
    }

    _add(tweener) {
        if (!this._current) this._beginStep();
        tweener._tween = this;
        this._current.push(tweener);
        // Нулевая длительность в первом шаге — значение ставится сразу, без
        // ожидания кадра (совместимость со старым tweenProps(ms = 0)).
        // method сюда не входит: его нельзя «откатить», если .delay() зададут
        // после, поэтому он всегда идёт через обычный тик.
        if (this._valid && !this._finished && this._steps.length === 1 && tweener.duration <= 0
            && tweener.delay_time <= 0 && tweener.kind === 'property') {
            this._applyInstant(tweener);
        }
        return tweener;
    }

    /**
     * Возврат мгновенно применённого tweener'а в обычный тик: значение
     * откатывается к исходному, и задержка (.delay), заданная ПОСЛЕ
     * .property(...), снова имеет смысл. Без этого .delay(1) молча терялся,
     * потому что значение уже было записано во время добавления.
     */
    _rearmInstant(tw) {
        if (!tw || !tw._instant) return;
        if (tw.kind === 'property') writeTarget(this.target, tw.prop, tw.from_cache);
        tw._instant = false;
        tw.done = false;
        tw.fired = false;
        tw.started = false;
        this._finished = false;
    }

    _applyInstant(tweener) {
        if (!tweener._tween || !this._valid || this._finished) return;
        if (tweener.kind !== 'property' && tweener.kind !== 'method') return;
        if (tweener.duration > 0) return;          // не мгновенный — сыграет в тике
        if (tweener.delay_time > 0) return;        // ждёт задержки — применит applyStepAt
        if (this._steps.length !== 1) return;      // мгновенно только первый шаг
        prepareTweener(this, tweener, true);
        applyTweenerValue(this, tweener, 1);
        tweener.done = true;
        tweener._instant = true;
    }

    /** Начать новый шаг: следующий твинер пойдёт после завершения текущего. */
    chain() { this._beginStep(); return this; }

    /**
     * Вернуть «всё параллельно». Если chain() только что создал пустой шаг,
     * его убираем — иначе следующее свойство оказалось бы в отдельном шаге и
     * ждало бы предыдущий, хотя игрок явно попросил параллельность.
     */
    parallel() {
        if (this._steps.length > 1 && this._current && this._current.length === 0
            && this._step < this._steps.length - 1) {
            this._steps.pop();
            this._current = this._steps[this._steps.length - 1];
        }
        return this;
    }

    // --- свойства -----------------------------------------------------------

    /** Свойство: property(prop, to, seconds) → PropertyTweener. */
    property(prop, to, seconds) {
        if (!this.target && !this._warned_target) {
            this._warned_target = true;
            ctx.log('$: $.tween(): цель не найдена — property() ничего не запишет; '
                + 'передайте узел, селектор или объект в $.tween(...) или $.tweenOf(...)');
        }
        const tw = new Tweener('property', seconds);
        tw.prop = String(prop);
        tw.to = to;
        tw.trans_name = this._default_trans;
        tw.ease_kind = this._default_ease;
        return this._add(tw);
    }

    /** Пауза: interval(seconds) → IntervalTweener (шаг «ничего не делать»). */
    interval(seconds) {
        return this._add(new Tweener('interval', seconds));
    }

    /** Вызов fn() в момент, когда шаг до него дошёл. */
    callback(fn) {
        const tw = new Tweener('callback', 0);
        tw.fn = fn;
        return this._add(tw);
    }

    /** Вызов fn(value[, t]) с интерполяцией from→to; t — уже с плавностью. */
    method(fn, from, to, seconds) {
        const tw = new Tweener('method', seconds);
        tw.fn = fn;
        tw.from_value = Number(from) || 0;   // у method нет свойства, откуда читать
        tw.to = to;
        tw.trans_name = this._default_trans;
        tw.ease_kind = this._default_ease;
        return this._add(tw);
    }

    /** Переход по умолчанию для следующих твинеров. */
    trans(name) { this._default_trans = name; return this; }
    /** Плавность по умолчанию для следующих твинеров. */
    ease(kind) { this._default_ease = kind; return this; }

    /** Число проходов; n < 0 — бесконечно (finished тогда не придёт). */
    loops(n) {
        if (n === undefined) return this._loops;
        const count = Math.floor(Number(n));
        this._loops = isFinite(count) ? count : 1;
        return this;
    }

    /** Множитель скорости; работает и как геттер без аргумента. */
    speed(scale) {
        if (scale === undefined) return this._speed;
        const value = Number(scale);
        this._speed = isFinite(value) && value > 0 ? value : 1;
        return this;
    }

    /** Сколько игрового времени твин уже прожил, секунды (по всем проходам). */
    time() { return this._elapsed; }

    /** Прогресс текущего прохода [0..1] (при нулевой длине — 1, если конец). */
    progress() {
        const total = totalDuration(this);
        if (!(total > 0)) return this._finished ? 1 : 0;
        let done = 0;
        for (let i = 0; i < this._step && i < this._steps.length; i++) done += stepDuration(this._steps[i]);
        return Math.max(0, Math.min(1, (done + this._step_time) / total));
    }

    // --- управление ---------------------------------------------------------

    pause() { this._paused = true; return this; }
    play() { this._paused = false; this._running = true; return this; }
    /** Остановить, но оставить живым: play() продолжит с того же места. */
    stop() { this._running = false; this._paused = true; return this; }

    /**
     * Убить твин безвозвратно. Как в Godot, `finished` после kill() не
     * приходит: Promise остаётся нерешённым, обработчики не вызываются.
     */
    kill() {
        this._valid = false;
        this._running = false;
        if (this._finished_resolve) { this._finished_resolve = null; }
        return this;
    }

    isRunning() { return this._valid && this._running && !this._paused && !this._finished; }
    isValid() { return this._valid; }
    isPaused() { return this._paused; }

    /**
     * Привязать жизнь твина к узлу: узел удалён или убит (max_hp > 0 и hp
     * кончились) — твин убивается на ближайшем тике.
     */
    bind(node) { this._bound = resolveTweenTarget(node); return this; }

    /** true — твин шагает по реальному кадру (raw), игнорируя паузу и scale. */
    ignoreTimeScale(flag) { this._ignore_scale = flag !== false; return this; }

    // --- события ------------------------------------------------------------

    on(name, fn) {
        if (typeof fn !== 'function') return this;
        if (!this._listeners.has(name)) this._listeners.set(name, []);
        this._listeners.get(name).push(fn);
        return this;
    }

    off(name, fn) {
        if (!name) { this._listeners.clear(); return this; }
        if (!fn) { this._listeners.delete(name); return this; }
        const list = this._listeners.get(name);
        if (list) this._listeners.set(name, list.filter((f) => f !== fn));
        return this;
    }

    _emit(name, payload) {
        const list = this._listeners.get(name);
        if (!list || list.length === 0) return;
        const event = payload || {};
        event.tween = this;
        for (const fn of list.slice()) {
            try { fn(event); } catch (e) { ctx.log(`$: ошибка в обработчике Tween "${name}": ${e}`); }
        }
    }

    /** Promise, разрешающийся на finished. После kill() — не разрешается. */
    finished() {
        if (this._finished) return Promise.resolve(this);
        if (!this._finished_promise) {
            this._finished_promise = new Promise((resolve) => { this._finished_resolve = resolve; });
        }
        return this._finished_promise;
    }
}

// --- Выполнение -------------------------------------------------------------

/** Снимает начальное значение твинера и строит функцию плавности. */
function prepareTweener(tween, tw, reapply) {
    if (tw._prepared && !reapply) return;
    if (reapply) tw._prepared = false;
    if (tw.from_value !== undefined) tw.from_cache = tw.from_value;
    else if (tw._origin !== undefined) tw.from_cache = tw._origin;
    else {
        tw.from_cache = readTarget(tween.target, tw.prop);
        tw._origin = tw.from_cache;
    }
    let to = Number(tw.to);
    if (!isFinite(to)) to = tw.from_cache;
    tw.to_cache = tw.relative ? tw.from_cache + to : to;
    tw.ease_fn = transitionFunction(tw.trans_name, tw.ease_kind);
    // Куда писать, решается один раз при старте, а не в каждом кадре:
    // `instanceof Node` и разбор пути 'a.b' стоили заметную долю тика.
    tw._node_prop = tween.target instanceof Node && String(tw.prop).indexOf('.') < 0;
    tw._prepared = true;
    tw.started = true;
}

/** Считает значение и записывает его в цель (property) или отдаёт в fn (method). */
function applyTweenerValue(tween, tw, p) {
    const e = tw.ease_fn ? tw.ease_fn(p) : p;
    let value;
    if (typeof tw.interp === 'function') {
        try { value = tw.interp(tw.from_cache, tw.to_cache, e); }
        catch (err) {
            ctx.log(`$: ошибка в interpolator Tween: ${err}`);
            value = tw.from_cache + (tw.to_cache - tw.from_cache) * e;
        }
    } else {
        value = tw.from_cache + (tw.to_cache - tw.from_cache) * e;
    }
    if (tw.kind === 'property') {
        if (tw._node_prop === true) writeProp(tween.target, tw.prop, value);
        else writeTarget(tween.target, tw.prop, value);
        return;
    }
    if (typeof tw.fn !== 'function') return;
    try { tw.fn(value, e); } catch (err) { ctx.log(`$: ошибка в method Tween: ${err}`); }
}

// Индексные циклы, а не for-of: в QuickJS for-of по массиву заводит объект
// итератора, а эти функции зовутся каждый кадр для каждого твина.
function stepDuration(step) {
    let duration = 0;
    for (let i = 0; i < step.length; i++) {
        const tw = step[i];
        const d = tw.delay_time + tw.duration;
        if (d > duration) duration = d;
    }
    return duration;
}

function totalDuration(tween) {
    let duration = 0;
    const steps = tween._steps;
    for (let i = 0; i < steps.length; i++) duration += stepDuration(steps[i]);
    return duration;
}

/**
 * Применяет все твинеры шага к моменту local (секунды от начала шага).
 * Отдельная функция без состояния — её легко проверять в qjs.
 */
export function applyStepAt(tween, step, local) {
    for (let i = 0; i < step.length; i++) {
        const tw = step[i];
        const start = tw.delay_time;
        if (local + 1e-12 < start) continue;
        if (!tw.started) {
            if (tw.kind === 'property' || tw.kind === 'method') prepareTweener(tween, tw, false);
            else tw.started = true;
        }
        if (tw.kind === 'callback') {
            if (!tw.fired) {
                tw.fired = true;
                tw.done = true;
                try { tw.fn(); } catch (e) { ctx.log(`$: ошибка в callback Tween: ${e}`); }
            }
            continue;
        }
        if (tw.duration <= 0) {
            if (!tw.done) {
                tw.done = true;
                if (tw.kind === 'property' || tw.kind === 'method') applyTweenerValue(tween, tw, 1);
            }
            continue;
        }
        const p = Math.min(1, (local - start) / tw.duration);
        if (tw.kind === 'interval') {
            // Интервал ничего не пишет и никого не зовёт — он просто тянет шаг.
            if (p >= 1) tw.done = true;
            continue;
        }
        applyTweenerValue(tween, tw, p);
        if (p >= 1) tw.done = true;
    }
}

function completeStep(tween) {
    tween._emit('step', { step: tween._step, loop: tween._loop });
    tween._step += 1;
    tween._step_time = 0;
}

/** Сбрасывает выполнение твинеров перед новым проходом.
 *
 * `_origin` намеренно НЕ чистим: при loops() сценарий должен честно
 * повторяться 0 → 10, а не «стоять» на цели из-за повторного чтения текущего
 * значения. Начало фиксируется один раз при первом старте твинера. */
function resetTweeners(tween) {
    for (const step of tween._steps) {
        for (const tw of step) {
            tw.started = false;
            tw.done = false;
            tw.fired = false;
            tw._prepared = false;
        }
    }
}

function completePass(tween) {
    tween._loop += 1;
    if (tween._loops < 0 || tween._loop < tween._loops) {
        tween._step = 0;
        tween._step_time = 0;
        resetTweeners(tween);
        tween._emit('loop', { loop: tween._loop });
        return;
    }
    tween._finished = true;
    tween._running = false;
    tween._emit('finished', {});
    const resolve = tween._finished_resolve;
    tween._finished_resolve = null;
    if (resolve) resolve(tween);
}

/**
 * Продвигает один Tween на dt секунд, разбирая шаги и проходы. Покадрово
 * вызывается из tickTweenObjects; вынесено отдельно, чтобы юнит-тест мог
 * «прокрутить» ровно один твин, не поднимая список активных.
 */
export function advanceTween(tween, dt) {
    tween._elapsed += dt;
    let remain = dt;
    let guard = 0;
    while (!tween._finished && guard++ < 64) {
        if (tween._step >= tween._steps.length) {
            completePass(tween);
            // Мгновенный сценарий (все шаги нулевые) прокручиваем один проход
            // за тик: иначе loops(-1) без длительностей зациклил бы кадр.
            // Полная длительность нужна только здесь — на конце прохода, а не
            // в каждом кадре каждого твина.
            if (tween._finished || !(totalDuration(tween) > 0)) return;
            continue;
        }
        const step = tween._steps[tween._step];
        const duration = stepDuration(step);
        const need = Math.max(0, duration - tween._step_time);
        if (remain < need - 1e-12) {
            tween._step_time += remain;
            applyStepAt(tween, step, tween._step_time);
            return;
        }
        tween._step_time = duration;
        applyStepAt(tween, step, duration);
        remain -= need;
        completeStep(tween);
    }
}

/** Все живые (не убитые и не завершённые) Tween'ы — для $.tweens(). */
export function activeTweenObjects() {
    return active_tweens.filter((t) => t._valid && !t._finished);
}

/** Реализация $.tween(target?) / $.tweenOf(object) / $.tweens(). */
export function installTween($) {
    const create = (target) => new Tween(resolveTweenTarget(target));
    create.of = (object) => new Tween(object === undefined ? null : object);
    create.active = () => activeTweenObjects().length;
    create.transition = transitionFunction;
    $.tween = create;
    $.tweenOf = (object) => create.of(object);
    $.tweens = () => activeTweenObjects();
    // Счётчик для $.debug.stats()/.counters(): без него они всегда показывали 0.
    ctx.tweens_active = activeTweenCount;
    return $;
}

/**
 * Шаг всех активных Tween'ов. Вызывается из $.time каждый кадр:
 * `dt` — уже с учётом паузы `$.time.pause()` и масштаба `$.time.scale()`,
 * `raw` — реальный кадр (для твинов с ignoreTimeScale(true)).
 */
export function tickTweenObjects(dt, raw) {
    if (active_tweens.length === 0) return;
    for (let i = active_tweens.length - 1; i >= 0; i--) {
        const tween = active_tweens[i];
        if (!tween._valid || tween._finished) { active_tweens.splice(i, 1); continue; }
        if (tween._bound && targetDead(tween._bound)) { tween.kill(); active_tweens.splice(i, 1); continue; }
        if (tween.target instanceof Node && tween.target.removed) { tween.kill(); active_tweens.splice(i, 1); continue; }
        if (tween._paused || !tween._running) continue;
        const step = tween._ignore_scale ? (raw === undefined ? dt : raw) : dt;
        if (!(step > 0)) continue;
        advanceTween(tween, step * tween._speed);
    }
}
