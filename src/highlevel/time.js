// ===========================================================================
// Время: $.time — дельта, пауза, масштаб, отложенные вызовы, hit-stop.
//
// Всё игровое время идёт отсюда: твины, $.time.wait(), периодические вызовы и
// обновление камеры тикают в одном месте. Пауза останавливает их все сразу.
//
// Здесь же живёт «ощущение удара» по времени:
//   * $.time.freeze(ms) / $.time.hitStop(ms) — заморозка игрового времени:
//     логика, твины, анимации и таймеры стоят, кадр рисуется;
//   * $.time.slow(ms, scale) — плавное замедление времени (bullet time);
//   * $.time.frozen() — признак, по которому игра решает, идти ли её логике.
//
// Заморозка — это масштаб времени 0 на `ms` МИЛЛИСЕКУНД ВРЕМЕНИ КАДРА
// (`engine.dt`), а не настенных часов. При `--fixed-dt` время кадра постоянно,
// поэтому одна и та же последовательность событий при одном зерне даёт один и
// тот же мир: реплей воспроизводится. Масштаб, выставленный игрой через
// `$.time.scale()`, при заморозке НЕ затирается: он вернётся как был.
//
// Физику шагает C по аккумулятору `app->dt * app->time_scale` (src/main.c) —
// до апдейта скрипта. Тот же множитель отдаёт ему этот модуль
// (`engine.setTimeScale`), поэтому заморозка и замедление останавливают мир
// целиком: и логику кадра, и тела Box2D. Сборка без C-гейта (старый бинарник)
// останавливает только логику — мост в этом случае молча выключается.
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';
import { tickTweens, tickTimers, tickEffects, wait, tickTweenObjects } from './tween.js';
import { tickCameraAnimations } from './camera.js';
import { tickInput } from './input.js';
import { processingAllows } from './triggers.js';

// ---------------------------------------------------------------------------
// Шаг симуляции (§44)
// ---------------------------------------------------------------------------
//
// R2D_FIXED_DT и лимит подшагов живут в C (src/main.c). JS не видит
// аккумулятор физики, поэтому ведёт свой по тем же правилам и с тем же шагом:
// gameplay-тик отделён от кадра отрисовки и не зависит от render FPS.
//
// В `--fixed-dt` арифметика совпадает с C кадр в кадр (dt — то же число, шаг
// тот же). В свободном режиме аккумулятор C считается во float, а здесь — в
// double, поэтому на длинной дистанции возможен сдвиг на один тик.
// Шаг — та же float-константа, что R2D_FIXED_DT в C, а произведение
// `dt × множитель` округляется до float: в C оно считается во float, и без
// этого округления счётчик тиков мог разойтись с шагами физики на кадр
// (проверено при 144 «кадрах» на секунду: 59 против 60).
const SIM_DT = Math.fround(1 / 60);
const SIM_MAX_STEPS = 5;

const state = {
    scale: 1,
    paused: false,
    scaled_time: 0,
    intervals: [],
    next_id: 1,
    // --- Заморозка (hit-stop / freeze frames) ------------------------------
    freeze_ms: 0,          // осталось миллисекунд времени кадра
    freeze_id: 0,          // id последнего запроса (для cancel)
    next_freeze_id: 1,
    // --- Замедление (slow-motion) ------------------------------------------
    slow: [],              // { id, left, total, scale, in_frac, out_frac }
    next_slow_id: 1,
    frame_frozen: false,   // был ли заморожен ТЕКУЩИЙ кадр (для delta() после тика)
    // Последний множитель, отданный шагу физики (C): пишем только изменения.
    physics_pushed: 1,
    // --- Симуляционное время (§44) -----------------------------------------
    sim: {
        tick: 0,           // номер последнего шага симуляции (с 0)
        acc: 0,            // аккумулятор — зеркало аккумулятора C (main.c)
        c_scale: 1,        // множитель, с которым C шагнул ЭТОТ кадр
        subs: [],          // подписки $.time.onTick
        timers: [],        // afterTicks/everyTicks
        durations: [],     // жизни, измеряемые тиками
        marks: new Map(),  // именованные метки (state-local tick counter)
    },
};

// ---------------------------------------------------------------------------
// Чистая арифметика заморозки: её проверяет юнит-тест
// ---------------------------------------------------------------------------

/**
 * Длительность заморозки в миллисекундах времени кадра. Минимум один кадр:
 * заморозка на «ноль кадров» — это не заморозка, а потерянный вызов.
 */
export function freezeDuration(ms, frame_dt) {
    const frame_ms = Number(frame_dt) > 0 ? Number(frame_dt) * 1000 : 1000 / 60;
    const wanted = Number(ms);
    if (!Number.isFinite(wanted) || wanted <= 0) return frame_ms;
    return Math.max(wanted, frame_ms);
}

/**
 * Огибающая замедления: 0 — вне окна, 1 — полная сила. Вход и выход
 * сглаживаются долями `in_frac`/`out_frac` длительности, чтобы время не
 * «щёлкало» на старте и на финише.
 */
export function slowEnvelope(progress, in_frac, out_frac) {
    const p = progress < 0 ? 0 : (progress > 1 ? 1 : progress);
    const a = Math.max(0, Math.min(0.5, Number(in_frac) || 0));
    const b = Math.max(0, Math.min(0.5, Number(out_frac) || 0));
    let e = 1;
    if (a > 0 && p < a) e = Math.min(e, p / a);
    if (b > 0 && p > 1 - b) e = Math.min(e, (1 - p) / b);
    return e < 0 ? 0 : e;
}

/** Итоговый множитель активных замедлений: сильнейшее побеждает. */
export function combineSlow(list, base) {
    let k = 1;
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const total = s.total > 0 ? s.total : 1;
        const progress = 1 - Math.max(0, s.left) / total;
        const e = slowEnvelope(progress, s.in_frac, s.out_frac);
        const f = 1 - (1 - s.scale) * e;
        if (f < k) k = f;
    }
    return k * (base === undefined ? 1 : base);
}

// ---------------------------------------------------------------------------
// Мост к шагу физики (C)
// ---------------------------------------------------------------------------
//
// Физику шагает C по аккумулятору `app->dt * app->time_scale` (src/main.c,
// R2DApp.time_scale) ДО апдейта скрипта. Множитель выставляет этот модуль —
// единственный владелец игрового времени, поэтому hit-stop, замедление и
// масштаб времени действуют на мир целиком, а не только на логику кадра:
//
//   множитель = $.time.scale() × замедление, при заморозке и паузе — 0.
//
// Отдельного «пиннинга тел» нет и не нужно: тело просто перестаёт шагать.
// Если сборка старая и `engine.setTimeScale` в ней нет (build-2d до
// пересборки), мост молча выключается: логика кадра всё равно встанет, а
// тела поедут — это видно в docs/highlevel/time.md как ограничение сборки.

/** Есть ли в сборке C-гейт шага физики. */
function hasPhysicsGate() {
    return typeof engine.setTimeScale === 'function';
}

/** Множитель шага физики из состояния времени. */
function physicsScaleValue() {
    if (state.paused || isFrozen()) return 0;
    return state.scale * combineSlow(state.slow, 1);
}

/**
 * Отдать множитель в C. Пишем только при изменении: вызов на кадр не нужен,
 * а `engine.setTimeScale` делает clamp отрицательных и NaN на своей стороне.
 */
function pushPhysicsScale() {
    const value = physicsScaleValue();
    if (value === state.physics_pushed) return;
    state.physics_pushed = value;
    if (hasPhysicsGate()) engine.setTimeScale(value);
}

// ---------------------------------------------------------------------------
// Шаги симуляции: счётчик, подписки, таймеры и жизни в тиках
// ---------------------------------------------------------------------------

/** Разрешён ли владельцу фиксированный шаг (политика §44). */
function ownerAllows(node, kind) {
    return !node || processingAllows(node, kind);
}

function callSub(sub, tick) {
    try { sub.fn(tick, SIM_DT); } catch (e) { ctx.log(`$: ошибка в $.time.onTick: ${e}`); }
}

/** Один шаг симуляции: счётчик и всё, что к нему привязано. */
function runSimTick() {
    const sim = state.sim;
    sim.tick++;
    const tick = sim.tick;

    for (let i = sim.subs.length - 1; i >= 0; i--) {
        const sub = sim.subs[i];
        if (!sub.alive) { sim.subs.splice(i, 1); continue; }
        if (!ownerAllows(sub.node, 'fixed')) continue;
        if (sub.node && sub.node.removed) { sub.alive = false; sim.subs.splice(i, 1); continue; }
        callSub(sub, tick);
    }

    for (let i = sim.timers.length - 1; i >= 0; i--) {
        const timer = sim.timers[i];
        if (!timer.alive) { sim.timers.splice(i, 1); continue; }
        if (!ownerAllows(timer.node, 'fixed')) continue;
        if (timer.node && timer.node.removed) { timer.alive = false; sim.timers.splice(i, 1); continue; }
        if (timer.from_zero) {
            // Явно выбранная семантика: глобальный tick modulo.
            if (tick % timer.n !== 0) continue;
        } else {
            timer.count++;
            if (timer.count < timer.n) continue;
            timer.count = 0;
        }
        timer.fired++;
        if (timer.once) timer.alive = false;
        try { timer.fn(tick, SIM_DT); } catch (e) { ctx.log(`$: ошибка в $.time.everyTicks: ${e}`); }
        if (!timer.alive) sim.timers.splice(i, 1);
    }

    for (let i = sim.durations.length - 1; i >= 0; i--) {
        const dur = sim.durations[i];
        if (!dur.alive) { sim.durations.splice(i, 1); continue; }
        if (dur.owner && !ownerAllows(dur.owner, 'fixed')) continue;
        if (dur.left > 0) dur.left--;
        if (dur.left > 0) continue;
        // Истёкшую жизнь убираем из списка, но ручку не гасим: `.expired()`
        // и `.left()` должны отвечать и после конца.
        sim.durations.splice(i, 1);
        dur.ended = true;
        for (const fn of dur.on_end.splice(0)) {
            try { fn(dur); } catch (e) { ctx.log(`$: ошибка в $.time.duration.onEnd: ${e}`); }
        }
    }
}

/**
 * Продвинуть аккумулятор симуляции ровно по правилам C (src/main.c) и
 * проиграть столько тиков, сколько шагов сделала физика.
 */
function stepSimulation(raw) {
    const sim = state.sim;
    const dt = Number(raw);
    if (!(dt > 0)) {
        sim.c_scale = state.physics_pushed;
        return 0;
    }
    sim.acc += Math.fround(dt * sim.c_scale);
    let steps = 0;
    if (sim.c_scale > 0) {
        while (sim.acc >= SIM_DT && steps < SIM_MAX_STEPS) {
            sim.acc -= SIM_DT;
            steps++;
            runSimTick();
        }
        // Долг после лага не копим — как в main.c.
        if (steps === SIM_MAX_STEPS) sim.acc = 0;
    } else {
        sim.acc = 0;
    }
    // Значение, с которым C шагнёт СЛЕДУЮЩИЙ кадр: свой шаг физики идёт до
    // апдейта скрипта, поэтому множитель применяется со следующего кадра.
    sim.c_scale = state.physics_pushed;
    return steps;
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

export function installTime($) {
    const time = {
        /** Дельта кадра в секундах с учётом $.time.scale, заморозки и паузы. */
        delta() {
            if (state.paused || state.frame_frozen || isFrozen()) return 0;
            return engine.dt * state.scale * combineSlow(state.slow, 1);
        },
        /** Дельта без масштабирования — для интерфейса и эффектов. */
        rawDelta() { return engine.dt; },
        /** Игровое время в секундах (сумма дельт). */
        now() { return state.scaled_time; },
        /** Время с запуска движка. */
        realNow() { return engine.time; },
        /** Монотонные миллисекунды для замеров внутри кадра (realNow идёт шагами кадра). */
        perfNow() { return typeof engine.now === 'function' ? engine.now() : engine.time * 1000; },
        fps() { return engine.fps; },
        frame() { return engine.frame; },

        /**
         * Масштаб игрового времени. Он же — множитель шага физики: `scale(0.5)`
         * замедляет и логику кадра, и мир Box2D, `scale(0)` останавливает оба.
         * `pause()`/`freeze()` не затирают это значение — они лишь обнуляют
         * итоговый множитель на своё время.
         */
        scale(value) {
            if (value === undefined) return state.scale;
            state.scale = Math.max(0, Number(value) || 0);
            pushPhysicsScale();
            return time;
        },

        /**
         * Текущий множитель шага физики, отданный C (`engine.setTimeScale`).
         * Именно его видит симуляция: 0 — тела стоят.
         */
        physicsScale() { return state.physics_pushed; },

        pause() { state.paused = true; pushPhysicsScale(); return time; },
        resume() { state.paused = false; pushPhysicsScale(); return time; },
        toggle() { state.paused = !state.paused; pushPhysicsScale(); return time; },
        isPaused() { return state.paused; },

        // --- Заморозка (hit-stop) ------------------------------------------
        /**
         * Заморозить игровое время на `ms` миллисекунд.
         *
         * Игровая логика, твины, анимации, таймеры и шаг физики стоят; кадр
         * рисуется, VFX, тряска камеры и интерфейс живут на реальном времени.
         * Длительность считается по времени кадра (`engine.dt`), поэтому при
         * `--fixed-dt` она детерминирована. Вложенные вызовы не складываются:
         * работает самая длинная заморозка. Масштаб `$.time.scale()` не
         * затирается — после заморозки время идёт с прежней скоростью.
         *
         * Возвращает ручку: `{ ms, left(), active(), cancel() }`.
         *
         * ```js
         * $('#enemy').on('hit', () => $.time.freeze(70));
         * ```
         */
        freeze(ms, opts) {
            const o = opts || {};
            let millis;
            if (o.frames !== undefined) {
                // Явный заказ в кадрах: нужен тем, кто считает удар в кадрах,
                // и юнит-тестам. Длительность в мс получается из времени кадра.
                const frame_ms = Number(engine.dt) > 0 ? Number(engine.dt) * 1000 : 1000 / 60;
                millis = Math.max(1, Math.floor(Number(o.frames) || 1)) * frame_ms;
            } else {
                millis = freezeDuration(ms === undefined ? 70 : ms, engine.dt);
            }
            const id = state.next_freeze_id++;
            state.freeze_id = id;
            if (millis > state.freeze_ms) state.freeze_ms = millis;
            pushPhysicsScale();
            return freezeHandle(id, state.freeze_ms);
        },

        /** Синоним `freeze()` для читаемости в обработчике удара. */
        hitStop(ms, opts) { return time.freeze(ms === undefined ? 70 : ms, opts); },

        /** Сейчас игровое время заморожено? */
        frozen() { return isFrozen(); },

        /** Сколько миллисекунд времени кадра осталось до конца заморозки. */
        freezeLeft() { return Math.max(0, state.freeze_ms); },

        /** Снять заморозку немедленно (например, при смене сцены). */
        unfreeze() {
            state.freeze_ms = 0;
            pushPhysicsScale();
            return time;
        },

        // --- Замедление (bullet time) --------------------------------------
        /**
         * Плавно замедлить игровое время до `scale` на `ms` миллисекунд
         * времени кадра. Вход и выход сглаживаются; по окончании масштаб
         * возвращается сам. Вложенные замедления не складываются: побеждает
         * сильнейшее, а масштаб `$.time.scale()` они не затирают.
         *
         * Возвращает ручку `{ cancel() }`.
         *
         * ```js
         * $.time.slow(400, 0.25);      // четверть скорости на 0.4 с
         * ```
         */
        slow(ms, factor, opts) {
            const o = opts || {};
            const total = Math.max(1, Number(ms) || 200);
            const wanted = Number(factor);
            const s = {
                id: state.next_slow_id++,
                left: total,
                total,
                scale: Math.max(0, Math.min(1, Number.isFinite(wanted) ? wanted : 0.3)),
                in_frac: o.in === undefined ? 0.2 : Number(o.in),
                out_frac: o.out === undefined ? 0.3 : Number(o.out),
            };
            state.slow.push(s);
            pushPhysicsScale();
            return {
                cancel() {
                    const i = state.slow.indexOf(s);
                    if (i >= 0) state.slow.splice(i, 1);
                    pushPhysicsScale();
                },
            };
        },

        /** Действующий множитель замедления (1 — без замедления) — для отладки. */
        slowScale() { return combineSlow(state.slow, 1); },

        /** Сколько активных замедлений — для отладки и тестов. */
        slowCount() { return state.slow.length; },

        /** Ожидание в миллисекундах игрового времени. */
        wait(ms) { return wait(ms || 0); },

        // --- Симуляционные тики (§44) --------------------------------------
        /**
         * Номер шага симуляции (фиксированный шаг, начинается с 0).
         *
         * Это НЕ номер кадра отрисовки: при `--fixed-dt` счётчик совпадает с
         * фактическими шагами физики Box2D, при 30/60/144 render FPS одно и то
         * же симуляционное время даёт одно и то же число тиков.
         */
        tick() { return state.sim.tick; },

        /** Длительность одного шага симуляции в секундах. */
        simDt() { return SIM_DT; },

        /** Симуляционное время в секундах (tick × simDt). */
        simTime() { return state.sim.tick * SIM_DT; },

        /** Сколько шагов симуляции сделал последний кадр — для отладки. */
        lastSteps() { return state.sim.last_steps || 0; },

        /**
         * Фиксированный шаг: `fn(tick, simDt)` на каждом шаге симуляции.
         * `opts.node` — владелец: пока у узла выключена политика `fixed`,
         * подписка стоит (не «вызывается реже», а именно не вызывается).
         * Возвращает ручку `{ cancel(), active() }`.
         */
        onTick(fn, opts) {
            if (typeof fn !== 'function') return { cancel() {}, active() { return false; } };
            const o = opts || {};
            const sub = { fn, node: o.node || null, alive: true };
            state.sim.subs.push(sub);
            return {
                cancel() { sub.alive = false; },
                active() { return sub.alive; },
            };
        },

        /**
         * «Каждые N шагов симуляции»: `$.time.everyTicks(30, fn)`.
         *
         * По умолчанию отсчёт идёт от подписки; `{ from: 'zero' }` включает
         * явную семантику глобального tick modulo (`tick % N === 0`).
         * `{ node }` — владелец (политика `fixed`), `{ once: true }` — один раз.
         * Возвращает ручку `{ cancel(), fired(), count() }`.
         */
        everyTicks(n, fn, opts) {
            const count = Math.max(1, Math.floor(Number(n) || 1));
            const o = opts || {};
            if (typeof fn !== 'function') return { cancel() {}, fired() { return 0; }, count() { return count; } };
            const timer = {
                fn, n: count, node: o.node || null, alive: true,
                from_zero: o.from === 'zero', count: 0, fired: 0, once: o.once === true,
            };
            state.sim.timers.push(timer);
            return {
                cancel() { timer.alive = false; },
                fired() { return timer.fired; },
                count() { return count; },
            };
        },

        /** «Через N шагов симуляции»: `$.time.afterTicks(120, () => boom())`. */
        afterTicks(n, fn, opts) {
            const ticks = Math.max(1, Math.floor(Number(n) || 1));
            const o = opts || {};
            if (typeof fn !== 'function') return { cancel() {}, left() { return 0; } };
            const timer = {
                fn, n: ticks, node: o.node || null, alive: true,
                from_zero: false, count: 0, fired: 0, once: true,
            };
            state.sim.timers.push(timer);
            return {
                cancel() { timer.alive = false; },
                fired() { return timer.fired; },
                left() { return timer.alive ? Math.max(0, timer.n - timer.count) : 0; },
            };
        },

        /**
         * Жизнь, измеряемая шагами симуляции: `const life = $.time.duration(300)`.
         *
         * `life.expired()` — истекла, `life.left()` — осталось тиков,
         * `life.elapsed()` — прошло, `life.onEnd(fn)` — подписка на конец,
         * `life.reset(ticks?)` — начать заново, `life.cancel()` — снять.
         * `opts.owner` — узел-владелец (политика `fixed`).
         */
        duration(ticks, opts) {
            const o = opts || {};
            const total = Math.max(0, Math.floor(Number(ticks) || 0));
            const dur = {
                total, left: total, owner: o.owner || null, alive: true,
                ended: false, on_end: [],
            };
            if (total > 0) state.sim.durations.push(dur);
            else dur.ended = true;
            return {
                ticks() { return dur.total; },
                left() { return Math.max(0, dur.left); },
                elapsed() { return dur.total - Math.max(0, dur.left); },
                expired() { return dur.ended; },
                onEnd(fn) { if (typeof fn === 'function') { if (dur.ended) fn(dur); else dur.on_end.push(fn); } return this; },
                reset(next) {
                    dur.total = next === undefined ? dur.total : Math.max(0, Math.floor(Number(next) || 0));
                    dur.left = dur.total;
                    dur.ended = dur.total === 0;
                    dur.alive = true;
                    if (dur.total > 0 && state.sim.durations.indexOf(dur) < 0) state.sim.durations.push(dur);
                    return this;
                },
                cancel() { dur.alive = false; dur.ended = true; },
            };
        },

        /**
         * Локальный счётчик тиков: `$.time.mark('shot')` запоминает шаг,
         * `$.time.since('shot')` возвращает, сколько шагов прошло (0 — метки нет).
         * Это state-local счётчик вместо глобального `tick % N`.
         */
        mark(name) {
            state.sim.marks.set(String(name), state.sim.tick);
            return state.sim.tick;
        },

        /** Сколько шагов симуляции прошло с метки `mark(name)`. */
        since(name) {
            const at = state.sim.marks.get(String(name));
            return at === undefined ? 0 : state.sim.tick - at;
        },

        /** Снять метку (или все, если имя не задано). */
        unmark(name) {
            if (name === undefined) state.sim.marks.clear();
            else state.sim.marks.delete(String(name));
            return time;
        },

        /**
         * Однократный вызов через ms игрового времени.
         * `opts.node` (или сам узел третьим аргументом) — владелец: пока у него
         * выключена политика `timers` (§44), таймер стоит и не истекает.
         */
        after(ms, fn, opts) {
            const id = state.next_id++;
            wait(ms).then(() => { if (state.intervals.find((i) => i.id === id)) fn(); });
            state.intervals.push({ id, once: true, fn, ms, left: ms, owner: ownerOf(opts) });
            return id;
        },

        /** Периодический вызов (владелец — `opts.node`, см. after). */
        every(ms, fn, opts) {
            const id = state.next_id++;
            state.intervals.push({ id, once: false, fn, ms, left: ms, owner: ownerOf(opts) });
            return id;
        },

        cancel(id) {
            const i = state.intervals.findIndex((e) => e.id === id);
            if (i >= 0) state.intervals.splice(i, 1);
            return time;
        },

        cancelAll() { state.intervals.length = 0; return time; },

        /** Идёт ли пауза по любой причине (время, заморозка или запрос сцены). */
        busy() { return state.paused || isFrozen() || state.frame_frozen; },

        _state: state,
    };

    ctx.time = time;
    ctx.timers = [];
    ctx.animations = [];
    return time;
}

function isFrozen() {
    return state.freeze_ms > 0;
}

/** Владелец таймера из опций: узел, обёртка или `{ node }`. */
function ownerOf(opts) {
    if (!opts) return null;
    if (opts.nodes && opts.nodes.length) return opts.nodes[0];
    if (opts.body !== undefined || opts.attrs !== undefined) return opts;   // сам узел
    return opts.node || null;
}

function freezeHandle(id, ms) {
    return {
        id,
        ms,
        left() {
            return state.freeze_id === id ? Math.max(0, state.freeze_ms) : 0;
        },
        active() {
            return state.freeze_id === id && isFrozen();
        },
        cancel() {
            if (state.freeze_id !== id) return;
            state.freeze_ms = 0;
            pushPhysicsScale();
        },
    };
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

/**
 * Шаг заморозки: время кадра, а не настенные часы — иначе при масштабе 0
 * игровая дельта равна нулю и заморозка сама себя не отпустила бы. При
 * `--fixed-dt` время кадра постоянно, поэтому отсчёт детерминирован.
 *
 * Счётчик списывается ПОСЛЕ того, как кадр признан замороженным: кадр, на
 * котором заморозка кончается, ещё заморожен — иначе длительность была бы на
 * кадр короче заказанной.
 */
function stepFreeze(raw) {
    if (!isFrozen()) return;
    state.freeze_ms -= raw * 1000;
    if (state.freeze_ms < 0) state.freeze_ms = 0;
    pushPhysicsScale();
}

/** Шаг активных замедлений — по времени кадра. */
function stepSlow(raw) {
    if (state.slow.length === 0) return;
    const ms = raw * 1000;
    for (let i = state.slow.length - 1; i >= 0; i--) {
        const s = state.slow[i];
        s.left -= ms;
        if (s.left <= 0) state.slow.splice(i, 1);
    }
}

/**
 * Единый тик игрового времени. Вызывается $.gfx один раз за кадр после
 * обновления логики и до отрисовки — так анимации успевают примениться к
 * кадру, который вот-вот нарисуется.
 */
export function tickTime() {
    const raw = engine.dt;
    // Заморожен ли ТЕКУЩИЙ кадр — решаем до списания счётчика, а запоминаем
    // до конца кадра: $.time.delta() зовут и подсистемы после этого тика, и
    // ответ у них обязан совпадать с dt, на котором шёл кадр.
    state.frame_frozen = isFrozen();
    stepFreeze(raw);
    stepSlow(raw);
    pushPhysicsScale();
    const dt = (state.paused || state.frame_frozen)
        ? 0 : raw * state.scale * combineSlow(state.slow, 1);
    state.scaled_time += dt;

    // §44: шаги симуляции — по правилам C (main.c), до игровых таймеров кадра.
    // Множитель берётся тот, с которым C шагнул ЭТОТ кадр: свой шаг физики
    // идёт до апдейта скрипта, поэтому новый множитель применится к следующему.
    state.sim.last_steps = stepSimulation(raw);

    tickTimers(dt);
    tickTweens(dt);
    // Tween-объекты: dt — с учётом паузы и масштаба, raw — реальный кадр
    // (нужен тем, кто просил ignoreTimeScale).
    tickTweenObjects(dt, raw);
    tickEffects(raw);            // вспышки и тряска живут в реальном времени
    tickCameraAnimations(raw);
    ctx.camera._tick(raw);
    tickInput();

    for (let i = state.intervals.length - 1; i >= 0; i--) {
        const it = state.intervals[i];
        // §44: таймер с выключенным владельцем стоит — не «идёт медленнее», а
        // именно не истекает, пока политика `timers` не вернётся.
        if (it.owner && !processingAllows(it.owner, 'timers')) continue;
        it.left -= dt * 1000;
        if (it.left <= 0) {
            it.left += it.ms;
            if (it.once) state.intervals.splice(i, 1);
            try { it.fn(); } catch (e) { ctx.log(`$: ошибка в $.time.every: ${e}`); }
        }
    }
}
