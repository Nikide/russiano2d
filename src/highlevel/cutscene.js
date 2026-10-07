// ===========================================================================
// Катсцены внутри игры — $.cutscene
//
// Зачем отдельная подсистема: `$.timeline` — это «новелла», она владеет
// полноэкранной сценой (свои locations, cast, фон) и потому запустить её
// посреди уровня нельзя. Здесь — ДИРИЖЁР: он играет сценарий в ТЕКУЩЕЙ сцене,
// забирает управление у игрока, ведёт любые узлы мира, двигает камеру и
// возвращает всё как было. Мир при этом не перезагружается.
//
//   $.cutscene.define('bridge', [
//       { take: 'input' },                                  // ввод забран
//       { letterbox: 0.12 },                                // полосы
//       { camera: { at: [1200, 400], zoom: 1.4, ms: 600 } },
//       { walk: '#npc', to: [900, 400], speed: 90 },
//       { say: 'Мост не выдержит!', who: 'npc' },           // панель $.dialog
//       { face: ['#npc', '#hero'] },
//       { sfx: 'crash.ogg' }, { shake: 12, ms: 400 },
//       { do: ($) => $('#bridge').shader('dissolve') },
//       { wait: 400 },
//       { give: 'input' },
//       { letterbox: 0 },
//       { camera: 'restore', ms: 400 },
//   ]);
//
//   $.cutscene.play('bridge');
//   $.cutscene.skip();          // пропускает шаги с skip: true
//   $.cutscene.blocking();      // true, пока ввод забран — для своего ИИ
//
// Модель поведения взята из audm-neko (`game/story/story_runner.gd`): лок
// управления, letterbox и ведение актёров; код переписан на `$`.
// ===========================================================================

import { ctx, query, wrapOne } from './core.js';

/** Шаги сценария, которые «доигрываются» своим окончанием. */
const TIMED = ['wait', 'camera', 'walk', 'say', 'fade', 'flash', 'shake'];

/**
 * Чистое ядро сценария: разбор списка шагов без движка.
 * Возвращает массив шагов с нормализованным `ms` (0 — мгновенный) и `skip`.
 */
export function normalizeSteps(steps) {
    const out = [];
    for (const raw of steps || []) {
        if (!raw || typeof raw !== 'object') continue;
        const step = Object.assign({}, raw);
        // Длительность: явная `ms` важнее, `wait` — это и есть длительность.
        let ms = Number(step.ms);
        if (!Number.isFinite(ms) || ms < 0) ms = 0;
        if (step.wait !== undefined) {
            const w = Number(step.wait);
            if (Number.isFinite(w) && w >= 0) ms = Math.max(ms, w);
        }
        step.ms = ms;
        step.skip = step.skip === true;
        out.push(step);
    }
    return out;
}

/** Сколько всего миллисекунд займёт сценарий (мгновенные шаги не считаем). */
export function stepsDuration(steps) {
    return normalizeSteps(steps).reduce((sum, s) => sum + s.ms, 0);
}

/** Разбор целевой точки: `[x, y]`, `{x, y}` или узел. */
export function pointOf(value) {
    if (!value) return null;
    if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0 };
    if (value.tag) return { x: value.x, y: value.y };
    if (value.x !== undefined) return { x: Number(value.x) || 0, y: Number(value.y) || 0 };
    return null;
}

/** Шаг времени с приостановкой, если сценарий «держится» (пауза). */
function stepMs(step, dtMs) {
    if (step.paused) return 0;
    return dtMs;
}

/** Подсистема `$.cutscene`. */
export function installCutscene($, placeBody) {
    const scenes = new Map();
    const state = {
        name: null,
        steps: [],
        index: 0,
        elapsed: 0,
        running: false,
        input_taken: false,
        letterbox: 0,
        camera_saved: null,
        saved_controls: new Map(),   // узел → прежнее attrs.controls
        skipped: false,
    };

    /** Строка состояния для отладки и агентских проверок. */
    function describe() {
        const step = state.steps[state.index];
        return {
            name: state.name,
            running: state.running,
            step: state.index,
            steps: state.steps.length,
            elapsed: Math.round(state.elapsed),
            input_taken: state.input_taken,
            letterbox: state.letterbox,
            waiting: step ? step.ms > 0 : false,
        };
    }

    /** Забрать управление у игрока: запоминаем, какие узлы были управляемы. */
    function takeInput() {
        state.input_taken = true;
        state.saved_controls.clear();
        // Управляемые узлы отдаёт реестр (facet 'controls'): снимаем признак с
        // каждого и помним прежнее значение, чтобы вернуть ровно его.
        const nodes = ctx.nodes || [];
        for (const node of nodes) {
            if (!node || !node.attrs || node.attrs.controls === undefined) continue;
            state.saved_controls.set(node, node.attrs.controls);
            delete node.attrs.controls;
        }
    }

    /** Вернуть управление: восстанавливаем снятые признаки. */
    function giveInput() {
        state.input_taken = false;
        for (const [node, scheme] of state.saved_controls) node.attrs.controls = scheme;
        state.saved_controls.clear();
    }

    /** Применить один шаг. Возвращает `true`, если он начался. */
    function beginStep(step) {
        state.elapsed = 0;

        if (step.take !== undefined && step.take !== false) takeInput();
        if (step.give !== undefined && step.give !== false) giveInput();

        if (step.letterbox !== undefined) {
            const v = Number(step.letterbox);
            state.letterbox = Number.isFinite(v) ? Math.max(0, Math.min(0.5, v)) : 0;
        }

        if (step.camera !== undefined) {
            applyCamera(step.camera, step.ms);
        }

        if (step.walk !== undefined) {
            const node = resolve(step.walk);
            if (node) {
                const to = pointOf(step.to) || pointOf(step.to2) || { x: node.x, y: node.y };
                step._walk = { node, to, speed: Number(step.speed) || 100 };
            }
        }

        if (step.face !== undefined) {
            const pair = Array.isArray(step.face) ? step.face : [step.face, null];
            const a = resolve(pair[0]);
            const b = pair[1] ? resolve(pair[1]) : null;
            if (a) {
                const target = b || a;
                a.flip = target.x < a.x;
                if (b) b.flip = a.x < b.x;
            }
        }

        if (step.say !== undefined) {
            const dialog = $ && $.dialog;
            if (dialog && typeof dialog.show === 'function') {
                try { dialog.show(String(step.say), { name: step.who }); } catch (e) { /* панель не готова */ }
            } else if ($ && $.toast) {
                $.toast(String(step.say));
            }
        }

        if (step.sfx !== undefined) {
            const sound = $ && $.sound;
            if (sound && typeof sound.play === 'function') {
                try { sound.play(String(step.sfx), step.volume !== undefined ? { volume: step.volume } : undefined); }
                catch (e) { ctx.log('$.cutscene: звук не сыграл — ' + e); }
            }
        }

        if (step.shake !== undefined) {
            const amount = Number(step.shake) || 0;
            const ms = step.ms || 400;
            if ($ && $.camera && typeof $.camera.shake === 'function') $.camera.shake(amount, ms / 1000);
        }

        if (step.fade !== undefined) {
            const fx = $ && $.fx;
            if (fx && typeof fx.fade === 'function') {
                try { fx.fade(step.fade, step.ms || 300); } catch (e) { /* нет fx */ }
            }
        }

        if (step.flash !== undefined) {
            const fx = $ && $.fx;
            if (fx && typeof fx.flash === 'function') {
                try { fx.flash(step.flash, step.ms || 200); } catch (e) { /* нет fx */ }
            }
        }

        if (typeof step.do === 'function') {
            try { step.do($); } catch (e) { ctx.log('$.cutscene: шаг do упал — ' + e); }
        }

        return true;
    }

    /** Камера шага: `at`/`zoom` мгновенно или за `ms`; `'restore'` — вернуть. */
    function applyCamera(spec, ms) {
        const camera = $ && $.camera;
        if (!camera) return;
        if (spec === 'restore') {
            if (state.camera_saved && typeof camera.restore === 'function') camera.restore(state.camera_saved);
            return;
        }
        if (typeof spec !== 'object') return;
        // Снимаем слежение на время шага: иначе переезд камеры бессмысленен —
        // кадровый тик камеры каждый кадр тянет её к цели слежения и
        // возвращает назад (нашлось тестом: камера уезжала до 145 и
        // откатывалась к герою). Игра возвращает слежение через
        // `{ camera: 'restore' }` — снимок камеры делается при play().
        if (typeof camera.unfollow === 'function') camera.unfollow();
        const target = pointOf(spec.at);
        const zoom = spec.zoom !== undefined ? Number(spec.zoom) : undefined;
        const duration = Number(spec.ms !== undefined ? spec.ms : ms) || 0;
        if (target) {
            if (duration > 0 && typeof camera.panTo === 'function') camera.panTo(target.x, target.y, duration / 1000);
            else camera.at(target.x, target.y);
        }
        if (zoom !== undefined) {
            if (duration > 0 && typeof camera.zoomTo === 'function') camera.zoomTo(zoom, duration);
            else camera.zoom(zoom);
        }
    }

    function resolve(what) {
        if (!what) return null;
        if (typeof what === 'string') {
            const found = query(what);
            return found && found.length ? found[0] : null;
        }
        if (what.nodes) return what.nodes[0] || null;
        return what.tag ? what : null;
    }

    /** Продолжение плавных шагов (ходьба) — каждый кадр. */
    function continueStep(step, dtMs) {
        if (!step._walk) return;
        const { node, to, speed } = step._walk;
        step._walk.left = step._walk.left === undefined ? step.ms : step._walk.left;
        const dx = to.x - node.x;
        const dy = to.y - node.y;
        const dist = Math.hypot(dx, dy);
        const move = speed * (dtMs / 1000);
        if (dist <= move || dist < 0.5) {
            node.x = to.x;
            node.y = to.y;
            if (node.attrs) node.attrs.on_ground = true;
            step._done = true;
            return;
        }
        node.x += (dx / dist) * move;
        node.y += (dy / dist) * move;
        // Узел с телом надо ДВИГАТЬ в физике: иначе кадровый синк вернёт его
        // обратно, и актёр сдвинется ровно на один кадр (нашлось тестом).
        if (typeof placeBody === 'function') placeBody(node);
    }

    function finish() {
        const name = state.name;
        state.running = false;
        state.steps = [];
        state.index = 0;
        state.letterbox = 0;
        if (state.input_taken) giveInput();
        state.name = null;
        const handlers = listeners.get('end') || [];
        for (const fn of handlers) {
            try { fn(name); } catch (e) { ctx.log('$.cutscene: обработчик конца упал — ' + e); }
        }
    }

    const listeners = new Map();

    const cutscene = {
        /** Описать сценарий. Повторное имя перезаписывает прежний. */
        define(name, steps) {
            scenes.set(String(name), normalizeSteps(steps));
            return cutscene;
        },
        has(name) { return scenes.has(String(name)); },
        names() { return Array.from(scenes.keys()); },
        remove(name) { return scenes.delete(String(name)); },
        /** Сколько миллисекунд займёт сценарий. */
        duration(name) { const s = scenes.get(String(name)); return s ? stepsDuration(s) : 0; },

        /**
         * Играть сценарий в текущей сцене. Второй вызов во время игры
         * останавливает прежний (катсцены не вкладываются).
         */
        play(name, opts) {
            const steps = scenes.get(String(name));
            if (!steps) {
                ctx.log('$.cutscene.play: сценарий "' + name + '" не описан');
                return false;
            }
            if (state.running) cutscene.stop();
            // Снимок камеры — ДО первого шага: иначе вернуть будет нечего.
            state.camera_saved = ($ && $.camera && typeof $.camera.snapshot === 'function')
                ? $.camera.snapshot() : null;
            state.name = String(name);
            state.steps = steps;
            state.index = 0;
            state.elapsed = 0;
            state.running = true;
            state.skipped = false;
            if (opts && opts.take === false) state.input_taken = false;
            beginStep(state.steps[0]);
            return true;
        },

        /**
         * Пропустить катсцену: шаги с `skip: true` (и все мгновенные) переходят
         * без ожидания, шаги с игрой — доигрываются, чтобы мир не дёрнуло.
         */
        skip() {
            state.skipped = true;
            return cutscene;
        },

        /** Остановить: управление и камера возвращаются как были. */
        stop() {
            if (!state.running) return false;
            if (state.input_taken) giveInput();
            if (state.camera_saved && $ && $.camera && typeof $.camera.restore === 'function') {
                $.camera.restore(state.camera_saved);
            }
            finish();
            return true;
        },

        running() { return state.running; },
        /** Идёт ли сценарий с именем `name`. */
        runningName(name) { return state.running && state.name === String(name); },
        /** Ввод забран: своё ИИ и свой ввод должны молчать. */
        blocking() { return state.input_taken; },
        /** Полосы кадра (0 — нет, 0..0.5). */
        letterbox() { return state.letterbox; },

        /** Сколько шагов всего и на каком стоим. */
        progress() {
            return { name: state.name, index: state.index,
                     total: state.steps.length, running: state.running };
        },
        describe,
        on(event, fn) {
            const key = String(event);
            if (!listeners.has(key)) listeners.set(key, []);
            listeners.get(key).push(fn);
            return cutscene;
        },
        off(event, fn) {
            const list = listeners.get(String(event));
            if (!list) return cutscene;
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
            return cutscene;
        },
        state() {
            return { name: state.name, input_taken: state.input_taken, letterbox: state.letterbox,
                     camera_saved: !!state.camera_saved, saved_controls: state.saved_controls.size };
        },
    };

    /** Кадр катсцены: вызывается ДО применения управления игроком. */
    cutscene.tick = function (dt) {
        if (!state.running) return;
        const dtMs = Math.max(0, (Number(dt) || 0) * 1000);
        const step = state.steps[state.index];
        if (!step) { finish(); return; }

        continueStep(step, dtMs);
        state.elapsed += stepMs(step, dtMs);

        // Шаг кончился: время вышло или он завершился сам.
        const timed = step.ms > 0;
        const done_by_time = timed && state.elapsed >= step.ms;
        const done_now = !timed;
        const skipped_away = state.skipped && step.skip;
        if (step._done && timed && state.elapsed < step.ms) return;   // ходьба дошла, но ждём время

        if (!(done_by_time || done_now || skipped_away)) return;
        step._done = false;
        state.index++;
        state.elapsed = 0;
        if (state.index >= state.steps.length) { finish(); return; }
        beginStep(state.steps[state.index]);
    };

    $.cutscene = cutscene;
    // Ввод «забран» виден и из $.input: игры, которые читают ввод напрямую,
    // не должны обходить гейт.
    if ($.input && typeof $.input === 'object') {
        $.input.taken = () => state.input_taken;
    }
    return cutscene;
}

/** Тик катсцены из кадра API (ставится ДО applyControls). */
export function tickCutscene(dt) {
    if (ctx.$ && ctx.$.cutscene && typeof ctx.$.cutscene.tick === 'function') ctx.$.cutscene.tick(dt);
}
