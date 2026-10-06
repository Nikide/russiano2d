// ===========================================================================
// Сцены: $.scene — меню, уровни, пауза, переходы.
//
// Сцена — это описание того, что живёт на экране: функции enter/exit/update.
// Переход отложенный: $.scene.load() только ставит запрос, а реальная смена
// происходит в начале следующего кадра. Так сцену можно менять прямо из
// обработчика клика, не разрушая объект посреди его вызова.
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
};

export function installScene($) {
    const scene = {
        /**
         * Регистрирует сцену.
         *   $.scene.add('menu', { enter($) {}, exit() {}, update(dt) {} });
         *   $.scene.add('level1', ($) => { ... построить мир ... });
         */
        add(name, definition) {
            scenes.set(name, definition);
            return scene;
        },

        remove(name) { scenes.delete(name); return scene; },
        has(name) { return scenes.has(name); },
        names() { return [...scenes.keys()]; },
        /** Имя текущей сцены или null, если сцена ещё не выбрана. */
        current() { return state.current_name || null; },

        /** Перейти на сцену. opts: { transition, ms, keepUI } */
        load(name, opts) {
            if (!scenes.has(name)) {
                ctx.log(`$: неизвестная сцена "${name}"`);
                return scene;
            }
            const o = opts || {};
            // ms: 0 — это «без перехода», а не «взять длительность по
            // умолчанию»: раньше ноль был falsy и тихо превращался в 300 мс,
            // хотя игрок просил мгновенную смену.
            const ms = o.ms === undefined ? state.transition_ms : o.ms;
            if (o.transition === 'none' || ms <= 0) {
                state.pending = name;
                state.pending_opts = o;
                return scene;
            }
            state.pending = name;
            state.pending_opts = o;
            state.transition = {
                type: o.transition || state.transition_type,
                ms,
                t: 0,
                phase: 'out',
                to: name,
            };
            return scene;
        },

        /** Перезапустить текущую сцену (удобно для «ещё раз»). */
        restart() { return scene.load(state.current_name); },

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

function doSwitch() {
    if (state.pending === null) return;
    if (state.transition && state.transition.phase === 'out') return;

    const name = state.pending;
    const opts = state.pending_opts || {};
    state.pending = null;
    state.pending_opts = null;
    if (name === null) return;

    const prev = state.current;
    if (prev && typeof prev.exit === 'function') {
        try { prev.exit(ctx.$); } catch (e) { ctx.log(`$: ошибка в exit сцены "${state.current_name}": ${e}`); }
    }

    // Мир чистится между сценами: узлы, тела, твины, таймеры.
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
