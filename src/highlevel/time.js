// ===========================================================================
// Время: $.time — дельта, пауза, масштаб, отложенные вызовы.
//
// Всё игровое время идёт отсюда: твины, $.time.wait(), периодические вызовы и
// обновление камеры тикают в одном месте. Пауза останавливает их все сразу.
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';
import { tickTweens, tickTimers, tickEffects, wait, tickTweenObjects } from './tween.js';
import { tickCameraAnimations } from './camera.js';
import { tickInput } from './input.js';

const state = {
    scale: 1,
    paused: false,
    scaled_time: 0,
    intervals: [],
    next_id: 1,
};

export function installTime($) {
    const time = {
        /** Дельта кадра в секундах с учётом $.time.scale и паузы. */
        delta() { return state.paused ? 0 : engine.dt * state.scale; },
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

        scale(value) {
            if (value === undefined) return state.scale;
            state.scale = Math.max(0, value);
            return time;
        },

        pause() { state.paused = true; return time; },
        resume() { state.paused = false; return time; },
        toggle() { state.paused = !state.paused; return time; },
        isPaused() { return state.paused; },

        /** Ожидание в миллисекундах игрового времени. */
        wait(ms) { return wait(ms || 0); },

        /** Однократный вызов через ms игрового времени. */
        after(ms, fn) {
            const id = state.next_id++;
            wait(ms).then(() => { if (state.intervals.find((i) => i.id === id)) fn(); });
            state.intervals.push({ id, once: true, fn, ms, left: ms });
            return id;
        },

        /** Периодический вызов. */
        every(ms, fn) {
            const id = state.next_id++;
            state.intervals.push({ id, once: false, fn, ms, left: ms });
            return id;
        },

        cancel(id) {
            const i = state.intervals.findIndex((e) => e.id === id);
            if (i >= 0) state.intervals.splice(i, 1);
            return time;
        },

        cancelAll() { state.intervals.length = 0; return time; },

        /** Идёт ли пауза по любой причине (время или запрос сцены). */
        busy() { return state.paused; },

        _state: state,
    };

    ctx.time = time;
    ctx.timers = [];
    ctx.animations = [];
    return time;
}

/**
 * Единый тик игрового времени. Вызывается $.gfx один раз за кадр после
 * обновления логики и до отрисовки — так анимации успевают примениться к
 * кадру, который вот-вот нарисуется.
 */
export function tickTime() {
    const raw = engine.dt;
    const dt = state.paused ? 0 : raw * state.scale;
    state.scaled_time += dt;

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
        it.left -= dt * 1000;
        if (it.left <= 0) {
            it.left += it.ms;
            if (it.once) state.intervals.splice(i, 1);
            try { it.fn(); } catch (e) { ctx.log(`$: ошибка в $.time.every: ${e}`); }
        }
    }
}
