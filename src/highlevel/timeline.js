// ===========================================================================
// AnimatedTimelineScene2d — сцена-таймлайн для диалогов и визуальных новелл.
//
// Модуль даёт `$` одну новую сущность: **анимированную таймлайн-сцену 2D** —
// описание того, что происходит на экране, одним массивом «битов» (beats):
//
//   $.timeline.define('russi', {
//       locations: { room: { bg: 'art/room.png', music: 'music/room.ogg' } },
//       cast: { russi: { name: 'Руси-тян', poses: { neutral: 'art/neutral.png' } } },
//       script: [
//           { location: 'room' },
//           { show: 'russi', from: 'left' },
//           { say: 'Бака! Ты не понимаешь, как прекрасен JS.', pose: 'angry' },
//           { shake: 10, ms: 400 },
//           { choose: [
//               { text: 'Согласен', goto: 'love', add: { trust: 1 } },
//               { text: 'Python лучше', goto: 'hate' },
//           ] },
//           { label: 'love' },
//           { ending: { id: 'love', title: 'Хорошая концовка', text: '…' } },
//       ],
//   });
//
//   $.timeline.play('russi');
//
// Что модуль берёт на себя, а что отдаёт другим подсистемам:
//
// | Слой | Кто отвечает |
// |---|---|
// | текст, печатная машинка, выборы, клавиатура | `$.dialog` (таймлайн только листает реплики) |
// | фон и локации | свои узлы-спрайты в мире + перекрёстное затухание |
// | герои, позы, вход/выход, дыхание, акценты | свой «риг» на персонажа + `$.tween` |
// | тряска экрана | `$.camera.shake` |
// | вспышки и затемнения | свои `ui.panel` поверх интерфейса |
// | музыка и звуки | `$.sound` |
// | флаги и концовки | `$.store` |
// | время и паузы | покадровый `tickTimeline(dt)`, как у `$.dialog` |
//
// Почему камера, а не `ui.*`: и фон, и герои живут в мире, а камера приколота
// к центру окна — тогда мировые координаты совпадают с экранными, но тряска
// камеры двигает всю картинку разом. Интерфейс (панель диалога, затемнение)
// остаётся недвижим: текст не должен прыгать.
//
// Таймлайн — не сценарий на рельсах: у битов есть метки, переходы (`goto`),
// условия (`if`) и вложенные ветки, поэтому на нём собираются и линейные
// новеллы, и развилки с концовками. Всё состояние прогона отдаётся наружу
// через `$.timeline.state()` — его видно тестам и агенту.
// ===========================================================================

import { ctx, wrap, wrapOne, query, spriteSize, fxRandom } from './core.js';

// --- Реестр -----------------------------------------------------------------
// Определения (то, что объявила игра) и подписки на события модуля. Прогон
// один на процесс, как и диалог: две новеллы одновременно — это уже не новелла.
const definitions = new Map();
const listeners = new Map();
let api = null;
let run = null;
let ending_view = null;      // карточка концовки: живёт, когда прогон уже завершён
// След последнего прогона: после концовки `state()` обязан рассказать, чем
// всё кончилось, — иначе агенту и тестам нечего читать.
const last_run = { id: null, scene: null, ended: false, ending: null, location: null, beats: 0, ticks: 0, time: 0 };
const runtime = { auto: 0 };

// Длительности по умолчанию, мс.
const DEFAULTS = {
    fade: 450,          // перекрёстное затухание локации
    show: 320,          // выход персонажа на сцену
    hide: 260,
    flash: 220,
    shake: 380,
    ending: 700,
    auto: 1400,         // авто-режим: пауза после допечатанной реплики
};

// Встроенные акценты героя: имя → шаги твина по полям рига.
//   [поле, целевое значение, секунды]
// Поля рига: dx/dy — сдвиг от точки стояния, hop — подскок, scale — масштаб,
// angle — наклон. Акцент не трогает точку стояния: после него герой там же,
// где был, — иначе позы и входы «уезжали» бы после каждого «бака!».
const ACCENTS = {
    pop: [['scale', 1.07, 0.10], ['scale', 1, 0.16], ['dy', -6, 0.10], ['dy', 0, 0.16]],
    bounce: [['hop', 34, 0.12], ['hop', 0, 0.14], ['hop', 20, 0.10], ['hop', 0, 0.13]],
    nod: [['hop', -12, 0.12], ['hop', 0, 0.16]],
    lean: [['dx', 26, 0.18], ['dx', 0, 0.24]],
    away: [['dx', -30, 0.20], ['dx', 0, 0.26]],
    sigh: [['scale', 0.975, 0.30], ['scale', 1, 0.36], ['hop', -4, 0.30], ['hop', 0, 0.36]],
    step: [['dy', -4, 0.10], ['dy', 0, 0.12]],
};

// Дрожь — не твин, а затухающая синусоида: у неё десятки колебаний за секунду,
// и ключами твина её описывать бессмысленно.
const TREMORS = {
    tremble: { ms: 420, amp: 5, angle: 0.012 },
    shiver: { ms: 700, amp: 2.4, angle: 0.006 },
};

// --- Мелкие помощники -------------------------------------------------------

function num(value, fallback) {
    const v = Number(value);
    return Number.isFinite(v) ? v : fallback;
}

function ms(value, fallback) {
    if (value === undefined || value === null || value === true) return fallback;
    if (value === false) return 0;
    const v = Number(value);
    return Number.isFinite(v) ? Math.max(0, v) : fallback;
}

function report(where, error) {
    if (api && api.ctx && typeof api.ctx.reportError === 'function') api.ctx.reportError(where, error);
    else if (ctx && typeof ctx.log === 'function') ctx.log(`${where}: ${error}`);
}

function screenSize() {
    if (api && api.gfx && typeof api.gfx.size === 'function') {
        const size = api.gfx.size();
        if (size && size.w > 0) return size;
    }
    return { w: engine.width || 1280, h: engine.height || 720 };
}

/** Подписки модуля: $.timeline.on('ending', …) — как у $.dialog. */
function emit(name, data) {
    const list = listeners.get(name);
    if (list) {
        for (const fn of list.slice()) {
            try { fn(data); } catch (e) { report(`$.timeline "${name}"`, e); }
        }
    }
    if (api && typeof api._dispatchGlobal === 'function') {
        try { api._dispatchGlobal(null, 'timeline:' + name, data); } catch (e) { report('timeline:emit', e); }
    }
}

/** Значение условия: функция, булево, флаг ('!flag') или сравнение ('trust >= 2'). */
export function conditionValue(cond) {
    if (cond === undefined || cond === null) return true;
    if (typeof cond === 'function') {
        try { return !!cond(api, run && run.control); } catch (e) { report('$.timeline: условие', e); return false; }
    }
    if (typeof cond === 'string') {
        const text = cond.trim();
        if (!text) return false;

        // Сравнение: `trust >= 2`, `route == 'love'`. Пишется прямо в сценарии,
        // поэтому сценаристу не нужен JS — а нам не нужен eval.
        const compare = /^([A-Za-z_][\w.:]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(text);
        if (compare) {
            const left = readFlag(compare[1]);
            let right = compare[3].trim();
            if ((right.startsWith("'") && right.endsWith("'")) ||
                (right.startsWith('"') && right.endsWith('"'))) {
                right = right.slice(1, -1);
            }
            const right_num = Number(right);
            const both_numbers = Number.isFinite(right_num) && Number.isFinite(Number(left));
            const a = both_numbers ? Number(left) : (left === undefined || left === null ? '' : String(left));
            const b = both_numbers ? right_num : right;
            switch (compare[2]) {
            case '>=': return a >= b;
            case '<=': return a <= b;
            case '>': return a > b;
            case '<': return a < b;
            case '==': return a === b;
            case '!=': return a !== b;
            default: return false;
            }
        }

        const negated = text.startsWith('!');
        const key = negated ? text.slice(1).trim() : text;
        const value = readFlag(key);
        return negated ? !value : !!value;
    }
    return !!cond;
}

function readFlag(key) {
    if (!api || !api.store) return undefined;
    if (typeof api.store.get === 'function') return api.store.get(key, undefined);
    return undefined;
}

function writeFlag(key, value) {
    if (!api || !api.store || typeof api.store.set !== 'function') return;
    api.store.set(key, value);
}

function applyFlags(beat, mode) {
    const source = beat[mode];
    if (!source || typeof source !== 'object') return;
    for (const key of Object.keys(source)) {
        const value = source[key];
        if (mode === 'add') writeFlag(key, num(readFlag(key), 0) + num(value, 0));
        else writeFlag(key, value);
    }
}

// ===========================================================================
// Установка подсистемы
// ===========================================================================

export function installTimeline($) {    api = $;

    const timeline = {
        /**
         * Объявить таймлайн-сцену.
         *   $.timeline.define('russi', spec)
         * Возвращает объект управления прогоном (он же — значение `$`),
         * у которого есть `.play()`, `.state()`, `.hero()`.
         */
        define(id, spec) { return defineTimeline(id, spec); },

        has(id) { return definitions.has(String(id)); },
        list() { return [...definitions.keys()].sort(); },
        remove(id) {
            const key = String(id);
            const def = definitions.get(key);
            if (!def) return false;
            if (run && run.def === def) timeline.stop('removed');
            if (api.scene && typeof api.scene.remove === 'function') api.scene.remove(def.scene);
            if (api.dialog && typeof api.dialog.remove === 'function') api.dialog.remove(def.dialog);
            definitions.delete(key);
            return true;
        },

        /**
         * Запустить таймлайн: `$.timeline.play('russi', { at: 'metka' })`.
         * Сцена загрузится сама, если игра сейчас в другой сцене.
         */
        play(id, opts) { return playTimeline(String(id), opts); },

        /** Остановить прогон (диалог закроется, сцена останется жить). */
        stop(reason) { return stopRun(reason || 'manual'); },

        /** Дальше: допечатать реплику или перейти к следующей. */
        next() { return api && api.dialog ? api.dialog.next() : false; },
        skip() { return api && api.dialog ? api.dialog.skip() : false; },
        /** Выбрать вариант по номеру видимого списка. */
        choose(index) { return api && api.dialog ? api.dialog.choose(index) : false; },
        chooseByText(text) { return api && api.dialog ? api.dialog.chooseByText(text) : false; },
        choices() { return api && api.dialog ? api.dialog.choices() : []; },

        /** Прыгнуть на метку — тем же путём, что и бит `goto`. */
        goto(label) { gotoLabel(label); return timeline; },

        /** Сменить локацию вручную (то же, что бит `{ location }`). */
        location(name, opts) { startLocation(Object.assign({ location: name }, opts || {})); return timeline; },

        /** Сменить позу вручную: `$.timeline.pose('russi', 'angry')`. */
        pose(who, name, opts) { poseBeat(Object.assign({ pose: name, who: who }, opts || {})); return timeline; },

        /** Узел персонажа — для своих эффектов и проверок. */
        hero(who) {
            if (!run) return wrap([]);
            const rig = run.rigs.get(who === undefined ? run.def.hero : String(who));
            return rig ? wrapOne(rig.node) : wrap([]);
        },

        /** Авто-режим: мс паузы после реплики; `auto(false)` — выключить. */
        auto(value) {
            if (value === undefined) return runtime.auto;
            if (value === false || value === null) runtime.auto = 0;
            else if (value === true) runtime.auto = DEFAULTS.auto;
            else runtime.auto = Math.max(0, num(value, DEFAULTS.auto));
            if (run) run.auto_timer = 0;
            return runtime.auto;
        },

        /** Скорость печатной машинки (символов в секунду) — как $.dialog.speed. */
        speed(value) { return api && api.dialog ? api.dialog.speed(value) : 0; },

        /**
         * Реплики таймлайна по порядку: `[{ id, speaker, text, choices }]`.
         * id — он же имя файла озвучки (`<dir>/<id>.mp3`), поэтому список
         * заодно служит сценарием записи голоса.
         */
        lines(id) {
            const key = id === undefined || id === null ? (run ? run.def.id : last_run.id) : String(id);
            const def = definitions.get(key);
            if (!def) return [];
            return Object.keys(def.nodes)
                .sort((a, b) => num(a.slice(2), 0) - num(b.slice(2), 0))
                .map((node) => ({
                    id: node,
                    speaker: def.nodes[node].speaker || '',
                    text: def.nodes[node].text || '',
                    choices: Array.isArray(def.nodes[node].choices) ? def.nodes[node].choices.length : 0,
                }));
        },

        /** Снимок прогона: для тестов, отладки и агента. */
        state() { return runState(); },

        running() { return !!run; },
        /** Имя таймлайна: после концовки — имя последнего прогона, а не null. */
        current() { return run ? run.def.id : last_run.id; },
        /** Прогон дошёл до конца (концовка или конец скрипта). */
        ended() { return run ? !!run.ended : !!last_run.ended; },
        definition() { return run ? run.def : null; },

        on(name, fn) {
            const key = String(name);
            if (!listeners.has(key)) listeners.set(key, []);
            listeners.get(key).push(fn);
            return timeline;
        },
        off(name, fn) {
            const key = String(name);
            if (!listeners.has(key)) return timeline;
            if (!fn) listeners.delete(key);
            else listeners.set(key, listeners.get(key).filter((f) => f !== fn));
            return timeline;
        },
        emit(name, data) { emit(String(name), data); return timeline; },
        listenerCount(name) { return (listeners.get(String(name)) || []).length; },
    };

    $.timeline = timeline;

    /**
     * Литеральное имя из задания: `$.animatedTimelineScene2d(spec)` —
     * то же, что `$.timeline.define(spec.id, spec)`. Оставлено как синоним,
     * чтобы тип сцены читался в коде игры буквально.
     */
    $.animatedTimelineScene2d = function (spec) {
        const id = spec && (spec.id || spec.name);
        if (!id) {
            if (ctx && typeof ctx.log === 'function') {
                ctx.log('$.animatedTimelineScene2d: в описании нужен id — { id: "russi", script: [...] }');
            }
            return timeline;
        }
        return defineTimeline(String(id), spec);
    };

    // Реплики новеллы листает сам таймлайн: как только диалог закрылся или
    // игрок выбрал вариант — прогон продолжается. Продолжение откладывается
    // до кадра (см. requestStep): запускать следующий бит прямо из обработчика
    // `$.dialog` нельзя — диалог в этот момент ещё жив и «перезапуск» съел бы
    // только что открытую реплику.
    if ($.dialog && typeof $.dialog.on === 'function') {
        $.dialog.on('choice', (event) => {
            if (!run || !run.wait || run.wait.kind !== 'say') return;
            const beat = run.wait.beat;
            const options = beatChoices(beat) || [];
            const entry = options[event.index] || null;
            run.wait = null;
            if (entry) {
                applyFlags(entry, 'set');
                applyFlags(entry, 'add');
                if (typeof entry.do === 'function') {
                    try { entry.do(api, run.control); } catch (e) { report('$.timeline: выбор do()', e); }
                }
            }
            emit('choice', { beat, index: event.index, text: event.text, entry });
            const target = entry && (entry.goto !== undefined ? entry.goto : entry.to);
            if (target !== undefined && target !== null) gotoLabel(target);
            requestStep();
        });

        const finishSay = () => {
            if (!run || !run.wait || run.wait.kind !== 'say') return;
            run.wait = null;
            requestStep();
        };
        $.dialog.on('end', finishSay);
    }

    return timeline;
}

// ===========================================================================
// Объявление таймлайна
// ===========================================================================

function defineTimeline(id, spec) {
    if (!id) {
        if (ctx && typeof ctx.log === 'function') ctx.log('$.timeline.define: нужно непустое имя, например define("russi", { script: [...] })');
        return api.timeline;
    }
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.script)) {
        if (ctx && typeof ctx.log === 'function') {
            ctx.log(`$.timeline.define("${id}"): нужен массив script — [{ location: 'room' }, { say: '…' }]`);
        }
        return api.timeline;
    }

    const def = normalize(id, spec);
    definitions.set(def.id, def);

    // Реплики становятся обычным диалогом: печатная машинка, страницы,
    // выборы, i18n и клавиатура уже есть в $.dialog, дублировать их здесь
    // значило бы завести вторую правду о тексте.
    if (api.dialog && typeof api.dialog.define === 'function') {
        api.dialog.define(def.dialog, {
            nodes: def.nodes,
            start: def.nodes.start ? 'start' : Object.keys(def.nodes)[0],
            style: def.style,
            speed: def.speed,
        });
    }

    if (api.scene && typeof api.scene.add === 'function') {
        api.scene.add(def.scene, {
            enter($, opts) {
                buildStage(def);
                const pending = def.pending;
                def.pending = null;
                const start_opts = pending && pending.opts ? pending.opts : (opts || {});
                startRun(def, start_opts);
                // Хуки игры: HUD, свои узлы, подписки. Сцена таймлайна одна,
                // и без этих хуков игре пришлось бы регистрировать сцену с тем
                // же именем и затирать staging новеллы.
                if (def.onEnter) callHook('enter', def.onEnter, [api, def]);
            },
            exit() {
                if (def.onExit) callHook('exit', def.onExit, [api, def]);
                teardownStage(def);
                if (run && run.def === def) stopRun('scene');
            },
            update(dt) {
                if (def.onUpdate) callHook('update', def.onUpdate, [dt, api, def]);
            },
        });
    }

    return api.timeline;
}

function normalize(id, spec) {
    const locations = {};
    const raw_locations = spec.locations && typeof spec.locations === 'object' ? spec.locations : {};
    for (const key of Object.keys(raw_locations)) {
        const value = raw_locations[key];
        locations[key] = typeof value === 'string' ? { bg: value } : Object.assign({}, value);
    }

    const cast = {};
    const raw_cast = spec.cast && typeof spec.cast === 'object' ? spec.cast : {};
    for (const key of Object.keys(raw_cast)) {
        const value = raw_cast[key] || {};
        cast[key] = {
            who: key,
            name: value.name !== undefined ? String(value.name) : key,
            poses: value.poses && typeof value.poses === 'object' ? Object.assign({}, value.poses) : {},
            pose: value.pose ? String(value.pose) : null,
            x: num(value.x, 0.5),
            bottom: num(value.bottom, 1.0),        // 1 — низ кадра
            height: num(value.height, 0.92),       // доля высоты окна
            idle: value.idle !== false,
            mirror: value.mirror === true,
            tint: value.tint || null,
            layer: num(value.layer, 10),
        };
    }

    const script = spec.script;
    const nodes = {};
    const node_of = new Map();
    let serial = 0;

    // Проход по скрипту (включая вложенные ветки if) заводит реплики
    // в диалог и запоминает соответствие «бит → реплика».
    const walk = (list) => {
        if (!Array.isArray(list)) return;
        for (const beat of list) {
            if (beat && typeof beat === 'object') {
                const text = beat.choose !== undefined && beat.say === undefined && beat.narrate === undefined
                    ? '' : (beat.say !== undefined ? beat.say : beat.narrate);
                if (beat.say !== undefined || beat.narrate !== undefined || beat.choose !== undefined) {
                    const node_id = 'tl' + (++serial);
                    node_of.set(beat, node_id);
                    const raw_choices = beatChoices(beat);
                    nodes[node_id] = {
                        text: text === undefined ? '' : text,
                        speaker: speakerOf(beat, cast),
                        portrait: beat.portrait,
                        speed: beat.speed,
                        style: beat.style,
                        choices: raw_choices ? raw_choices.map(choiceNode) : undefined,
                        to: null,       // конец реплики = «игрок нажал дальше»
                    };
                }
                if (beat.then) walk(beat.then);
                if (beat.else) walk(beat.else);
            }
        }
    };
    walk(script);
    if (Object.keys(nodes).length === 0) nodes.start = { text: '', to: null };

    const labels = new Map();
    const collect_labels = (list) => {
        if (!Array.isArray(list)) return;
        for (const beat of list) {
            if (beat && typeof beat === 'object') {
                if (typeof beat.label === 'string') labels.set(beat.label, beat);
                if (beat.then) collect_labels(beat.then);
                if (beat.else) collect_labels(beat.else);
            }
        }
    };
    collect_labels(script);

    const cast_keys = Object.keys(cast);
    const hero = spec.hero ? String(spec.hero) : (cast_keys[0] || null);

    return {
        id: String(id),
        scene: spec.scene ? String(spec.scene) : String(id),
        dialog: spec.dialog ? String(spec.dialog) : '__timeline_' + id,
        title: spec.title ? String(spec.title) : String(id),
        backdrop: spec.backdrop || '#070a12',
        locations,
        location: spec.location ? String(spec.location) : Object.keys(locations)[0] || null,
        cast,
        hero,
        script,
        nodes,
        node_of,
        labels,
        speed: spec.speed,
        style: spec.style,
        exitScene: spec.exitScene ? String(spec.exitScene) : null,
        afterEnding: typeof spec.afterEnding === 'function' ? spec.afterEnding : null,
        onBeat: typeof spec.onBeat === 'function' ? spec.onBeat : null,
        dialog_theme: spec.dialogTheme && typeof spec.dialogTheme === 'object' ? spec.dialogTheme : null,
        // Чем рисовать реплику: узлами <ui.*> (по умолчанию) или документом
        // RmlUi. Во втором случае перенос строк, шрифт и рамку делает RmlUi,
        // а $.dialog остаётся мозгом — печатная машинка, выборы, клавиатура.
        dialog_view: normalizeDialogView(spec.dialogView),
        location_card: spec.locationCard !== false,
        // Озвучка реплик: файл на каждую реплику, имя = id её узла (tl12.mp3).
        // Нет файла — реплика просто идёт без голоса.
        voice: normalizeVoice(spec.voice, spec.hero ? String(spec.hero) : Object.keys(cast)[0]),
        onEnter: typeof spec.enter === 'function' ? spec.enter : null,
        onExit: typeof spec.exit === 'function' ? spec.exit : null,
        onUpdate: typeof spec.update === 'function' ? spec.update : null,
        pending: null,
    };
}

/**
 * Описание вида реплики. `dialogView: { kind: 'rml', doc: 'ui/vn-dialog.rml' }`
 * включает отрисовку через RmlUi; всё остальное (id элементов) имеет значения
 * по умолчанию и нужно только для нестандартной разметки.
 */
function normalizeDialogView(spec) {
    if (!spec || typeof spec !== 'object') return null;
    const kind = spec.kind || (spec.doc ? 'rml' : null);
    if (kind !== 'rml' || !spec.doc) return null;
    return {
        kind: 'rml',
        doc: String(spec.doc),
        speaker: spec.speaker ? String(spec.speaker) : 'vn-speaker',
        text: spec.text ? String(spec.text) : 'vn-text',
        choice_prefix: spec.choicePrefix ? String(spec.choicePrefix) : 'vn-choice-',
        choices: num(spec.choices, 6),
        off_class: spec.offClass ? String(spec.offClass) : 'off',
        selected_class: spec.selectedClass ? String(spec.selectedClass) : 'selected',
        handle: null,
        shown: null,
        last_speaker: undefined,
        last_text: undefined,
        last_choices: undefined,
    };
}

/**
 * Озвучка реплик.
 *
 * Раскладка нарочно простая: `<dir>/<id реплики>.<ext>`, где id — тот же, что
 * отдаёт `$.timeline.lines()`. Реплика без файла идёт молча, поэтому озвучку
 * можно дописывать по одной и в любом порядке.
 */
function normalizeVoice(spec, hero) {
    if (!spec) return null;
    const options = typeof spec === 'string' ? { dir: spec } : spec;
    if (!options || !options.dir) return null;
    return {
        dir: String(options.dir).replace(/\/+$/, ''),
        ext: options.ext ? String(options.ext) : 'mp3',
        volume: num(options.volume, 1),
        who: options.who ? String(options.who) : hero,
        channel: null,
    };
}

/** Играет ли сейчас озвучка: по ней авто-режим ждёт конца реплики. */
function voicePlaying(def) {
    const voice = def.voice;
    if (!voice || voice.channel === null || voice.channel < 0) return false;
    if (!api.sound || typeof api.sound.playing !== 'function') return false;
    return !!api.sound.playing(voice.channel);
}

/** Проиграть озвучку реплики, если файл есть. Предыдущий голос обрывается. */
function playVoice(def, who, node_id) {
    const voice = def.voice;
    if (!voice || !node_id) return;
    if (voice.who && who && voice.who !== who) return;
    if (!api.sound || !api.fs || typeof api.fs.exists !== 'function') return;
    const path = voice.dir + '/' + node_id + '.' + voice.ext;
    let exists = false;
    try { exists = api.fs.exists(path); } catch (e) { exists = false; }
    if (!exists) return;
    if (voice.channel !== null && voice.channel >= 0 && typeof api.sound.stop === 'function') {
        api.sound.stop(voice.channel, 60);
    }
    voice.channel = api.sound.play(path, { volume: voice.volume });
    emit('voice', { who, node: node_id, path });
}

function callHook(name, fn, args) {
    try {
        fn.apply(null, args);
    } catch (e) {
        report(`$.timeline: хук ${name}`, e);
    }
}

/**
 * Варианты ответа бита: `{ choose: [...] }` — основная форма,
 * `{ say: '…', choices: [...] }` — короткая запись реплики с выборами.
 * Один доступ на всех: объявление и обработчик выбора обязаны видеть одно и то же.
 */
function beatChoices(beat) {
    if (Array.isArray(beat.choose)) return beat.choose;
    if (Array.isArray(beat.choices)) return beat.choices;
    return null;
}

function speakerOf(beat, cast) {
    if (beat.who !== undefined && cast[beat.who]) return cast[beat.who].name;
    if (beat.speaker !== undefined) return beat.speaker;
    if (beat.narrate !== undefined) return '';
    const first = Object.keys(cast)[0];
    return first ? cast[first].name : '';
}

function choiceNode(entry) {
    return {
        text: entry && entry.text !== undefined ? entry.text : '',
        if: entry ? entry.if !== undefined ? entry.if : entry.when : undefined,
        action: entry ? entry.action : undefined,
        to: null,
    };
}

// ===========================================================================
// Прогон
// ===========================================================================

function startRun(def, opts) {
    stopRun('restart');
    // Карточка концовки — часть прошлого прогона: программный play() обязан
    // её убрать, иначе новый прогон идёт «под» финальным экраном.
    if (def.stage && def.stage.ending) {
        teardownEndingCard(def.stage.ending);
        def.stage.ending = null;
    }
    if (ending_view && ending_view.def === def) ending_view = null;
    const script = def.script;
    const start_at = opts && (opts.at || opts.label);
    let index = 0;
    if (start_at !== undefined && def.labels.has(String(start_at))) {
        index = script.indexOf(def.labels.get(String(start_at)));
        if (index < 0) index = 0;
    }

    run = {
        def,
        control: null,
        frames: [{ list: script, index }],
        wait: null,
        step_pending: true,
        timers: [],
        rigs: new Map(),
        location: null,
        loc_node: null,          // какой из двух фонов сейчас виден
        ending_view: null,
        auto_timer: 0,
        time: 0,
        ticks: 0,
        ended: false,
        ending: null,
        beats: 0,
    };

    buildCast(def);
    run.stage = def.stage;
    if (def.location) startLocation({ location: def.location, fade: 0 });

    emit('start', { id: def.id, scene: def.scene, at: start_at === undefined ? null : start_at });
    run.control = makeControl(def);
    return run.control;
}

function makeControl(def) {
    return {
        id: def.id,
        get location() { return run ? run.location : null; },
        state() { return runState(); },
        goto(label) { gotoLabel(label); return this; },
        next() { return api.timeline.next(); },
        choose(i) { return api.timeline.choose(i); },
        stop() { return stopRun('manual'); },
        hero(who) { return api.timeline.hero(who); },
    };
}

function stopRun(reason) {
    if (!run) return false;
    const def = run.def;
    const timers = run.timers;
    run.timers = [];
    const tweens = run.tween_handles || [];
    run.tween_handles = [];
    for (const handle of tweens) {
        try { if (handle && handle.kill) handle.kill(); } catch (e) { report('$.timeline: kill твина', e); }
    }
    if (timers.length) { /* таймеры живут в tickTimeline, достаточно очистить список */ }

    run.wait = null;
    run.step_pending = false;
    rememberRun(def, run);
    const was_ended = run.ended;
    const ending = run.ending;
    run = null;

    // Диалог закрываем после обнуления run: иначе его же событие 'end'
    // попыталось бы продолжить уже остановленный прогон.
    if (api && api.dialog && api.dialog.isOpen && api.dialog.isOpen()) api.dialog.close();

    if (!was_ended) emit('end', { id: def.id, reason: reason || 'manual', ending: ending });
    return true;
}

function gotoLabel(label) {
    if (!run || label === undefined || label === null) return false;
    const beat = run.def.labels.get(String(label));
    if (!beat) {
        if (ctx && typeof ctx.log === 'function') ctx.log(`$.timeline: метка "${label}" не найдена в "${run.def.id}"`);
        return false;
    }
    // Метка может стоять и внутри ветки `if` — тогда путь к ней собирается
    // из вложенных списков, чтобы после ветки прогон продолжился там же,
    // где продолжался бы без прыжка.
    const path = findPath(run.def.script, beat, []);
    if (!path) {
        if (ctx && typeof ctx.log === 'function') ctx.log(`$.timeline: метка "${label}" есть, но путь к ней не найден`);
        return false;
    }
    run.frames = path;
    run.wait = null;
    requestStep();
    return true;
}

function findPath(list, beat, stack) {
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item === beat) return stack.concat([{ list, index: i }]);
        if (!item || typeof item !== 'object') continue;
        for (const key of ['then', 'else']) {
            if (!Array.isArray(item[key])) continue;
            const found = findPath(item[key], beat, stack.concat([{ list, index: i + 1 }]));
            if (found) return found;
        }
    }
    return null;
}

function requestStep() {
    if (run) run.step_pending = true;
}

/** Запомнить прогон: после концовки `state()` обязан рассказать, чем всё кончилось. */
function rememberRun(def, source) {
    if (!def) return;
    last_run.id = def.id;
    last_run.scene = def.scene;
    last_run.ended = !!source.ended;
    last_run.ending = source.ending ? (source.ending.id || null) : null;
    last_run.location = source.location || null;
    last_run.beats = source.beats || 0;
    last_run.ticks = source.ticks || 0;
    last_run.time = Math.round(source.time || 0);
}

/**
 * Отпустить ожидание и попросить следующий шаг.
 *
 * Именно парой: асинхронный источник (промис твина, событие диалога, дрожь)
 * срабатывает когда угодно, и «просто requestStep» не годится — шаг не
 * начнётся, пока в run.wait висит прежний hold. На этом уже ломался вход
 * героя: бит `{ show }` ждал твин, твин завершался, а прогон стоял.
 */
function releaseWait(kind) {
    if (!run) return;
    if (kind === undefined || (run.wait && run.wait.kind === kind)) run.wait = null;
    requestStep();
}

/** Продолжить прогон через wait: `run.wait.kind` — чего ждём. */
function hold(kind, data) {
    if (!run) return 'stop';
    run.wait = Object.assign({ kind }, data || {});
    return 'hold';
}

function step() {
    if (!run) return;
    let guard = 0;
    while (run && !run.wait) {
        if (++guard > 200000) {                    // защита от зацикливания скрипта
            if (ctx && typeof ctx.log === 'function') ctx.log('$.timeline: скрипт зациклился — прогон остановлен');
            stopRun('loop');
            return;
        }
        const frame = run.frames[run.frames.length - 1];
        if (!frame) { finishRun(); return; }
        if (frame.index >= frame.list.length) { run.frames.pop(); continue; }
        const beat = frame.list[frame.index++];
        run.beats++;
        const action = runBeat(beat);
        if (action === 'hold') return;
        if (action === 'stop') return;
    }
}

function finishRun() {
    if (!run) return;
    const def = run.def;
    run.ended = true;
    rememberRun(def, run);
    const ending = run.ending;
    run = null;                    // конец — значит конец: running() не врёт
    emit('end', { id: def.id, reason: 'end', ending: ending });
    if (api && api.dialog && api.dialog.isOpen && api.dialog.isOpen()) api.dialog.close();
}

// --- Биты -------------------------------------------------------------------

const NEXT = 'next';
const HOLD = 'hold';
const STOP = 'stop';

function runBeat(beat) {
    if (!run) return STOP;

    // Сахар: строка в скрипте — реплика героя по умолчанию. Так линейная
    // новелла читается как сценарий, а не как список объектов.
    if (typeof beat === 'string') return runBeat({ say: beat });
    if (typeof beat === 'function') {
        try { beat(api, run.control); } catch (e) { report('$.timeline: функция-бит', e); }
        return NEXT;
    }
    if (!beat || typeof beat !== 'object') return NEXT;

    if (run.def.onBeat) {
        try { run.def.onBeat(beat, run.control); } catch (e) { report('$.timeline: onBeat', e); }
    }
    emit('beat', { beat, count: run.beats, location: run.location });

    const flow = beat.say !== undefined || beat.narrate !== undefined || beat.choose !== undefined;

    // 1. Состояние и данные — они не занимают времени.
    applyFlags(beat, 'set');
    applyFlags(beat, 'add');

    // 2. Локация, музыка, звук.
    if (beat.location !== undefined) {
        const fade_ms = startLocation(beat);
        if (!flow && beat.wait !== false && fade_ms > 0 && beat.wait !== undefined) {
            return hold('wait', { ms: fade_ms });
        }
    }
    if (beat.music !== undefined) musicBeat(beat);
    if (beat.sfx !== undefined) sfxBeat(beat);

    // 3. Персонажи.
    if (beat.show !== undefined) return showBeat(beat);
    if (beat.hide !== undefined) return hideBeat(beat);
    if (beat.pose !== undefined) poseBeat(beat);
    if (beat.anim !== undefined) return animBeat(beat);

    // 4. Экран.
    if (beat.shake !== undefined) shakeBeat(beat);
    if (beat.flash !== undefined) flashBeat(beat);
    if (beat.fade !== undefined) {
        const fade_ms = fadeBeat(beat);
        if (!flow && fade_ms > 0) return hold('wait', { ms: fade_ms });
    }
    if (beat.zoom !== undefined) zoomBeat(beat);

    // 5. Произвольный код и события.
    if (typeof beat.do === 'function') {
        try { beat.do(api, run.control); } catch (e) { report('$.timeline: do()', e); }
    }
    if (beat.emit !== undefined) emit(String(beat.emit), beat.data || {});

    // 6. Ветвление и переходы.
    if (beat.if !== undefined) {
        const branch = conditionValue(beat.if) ? beat.then : beat.else;
        if (Array.isArray(branch) && branch.length) run.frames.push({ list: branch, index: 0 });
        return NEXT;
    }
    if (beat.goto !== undefined) { gotoLabel(beat.goto); return NEXT; }
    if (beat.ending !== undefined) return endingBeat(beat);

    // 7. Пауза и текст — то, ради чего всё остальное.
    if (beat.wait !== undefined && beat.wait !== false && !flow) return hold('wait', { ms: ms(beat.wait, 400) });
    if (beat.narrate !== undefined) return sayBeat(beat);
    if (beat.say !== undefined) return sayBeat(beat);
    if (beat.choose !== undefined) return sayBeat(beat);

    return NEXT;
}

// --- Текст ------------------------------------------------------------------

function sayBeat(beat) {
    const def = run.def;
    const node_id = def.node_of.get(beat);
    if (!node_id) return NEXT;                    // реплика без текста — не реплика
    if (!api.dialog || !api.dialog.play) return NEXT;

    const who = beat.who !== undefined ? String(beat.who) : def.hero;
    if (beat.pose !== undefined) poseBeat(beat);
    if (who && run.rigs.has(who)) {
        const rig = run.rigs.get(who);
        if (rig && !rig.el.visible) showBeat({ show: who, from: beat.from || 'fade' });
    }

    const opened = api.dialog.play(def.dialog, node_id);
    if (!opened) return NEXT;
    // Тема — украшение: если она не применилась, реплика обязана открыться.
    try { applyDialogTheme(def); } catch (e) { report('$.timeline: тема диалога', e); }
    playVoice(def, who, node_id);
    run.auto_timer = 0;
    emit('say', { who, text: typeof beat.say === 'string' ? beat.say : beat.narrate, node: node_id });
    return hold('say', { beat });
}

/**
 * Тема панели диалога: цвета, а не размеры.
 *
 * Геометрию панель пересчитывает сама каждый кадр (она растёт под число
 * вариантов), поэтому трогать x/y/w/h бессмысленно — а вот цвет фона, имя
 * говорящего и кнопки выбора живут до следующего play().
 */
function applyDialogTheme(def) {
    const theme = def.dialog_theme;
    if (!theme) return;
    // query() отдаёт массив узлов, а не обёртку: get(0) здесь — TypeError.
    const node = (id) => {
        const list = query('#' + id);
        return list && list.length ? list[0] : null;
    };
    const panel = node('__dialog');
    if (panel && theme.panel) panel.color = packColorSafe(theme.panel);
    const speaker = node('__dialog_speaker');
    if (speaker) {
        if (theme.speaker) speaker.color = packColorSafe(theme.speaker);
        if (theme.speakerSize) speaker.size = num(theme.speakerSize, speaker.size);
    }
    for (let i = 0; i < 4; i++) {
        const line = node('__dialog_line' + i);
        if (line && theme.text) line.color = packColorSafe(theme.text);
    }
    for (let i = 0; i < 6; i++) {
        const button = node('__dialog_choice' + i);
        if (!button) continue;
        // Цвет кнопок здесь НЕ ставим: $.dialog перекрашивает их каждый кадр
        // (подсветка выбранного варианта), поэтому их ведёт tickChoiceTheme.
        if (theme.choiceHover) button.hover_color = packColorSafe(theme.choiceHover);
        if (theme.choiceText) button.text_color = packColorSafe(theme.choiceText);
    }
}

/**
 * Панель диалога под крупный текст — каждый кадр, после `$.dialog`.
 *
 * `$.dialog` считает геометрию из своих констант: текстовая часть фиксированной
 * высоты, кнопки выбора стоят сразу под ней. Пока кегль был 20-22 px, это
 * сходилось; на 26 px строка перестаёт помещаться и налезает на кнопки.
 *
 * Тонкость: `updateView()` диалог зовёт не каждый кадр (пока текст печатается —
 * зовёт, после — нет). Поэтому правку нельзя ни накапливать, ни делать один раз
 * за реплику: нужна «родная» геометрия как база. База снимается при смене
 * реплики/страницы/размера окна, а дальше каждый кадр раскладка строится от неё
 * заново — тогда она идемпотентна.
 */
const dialog_layout = { key: null, base: null };

function tickDialogLayout(theme) {
    if (!api.dialog || typeof api.dialog.isOpen !== 'function' || !api.dialog.isOpen()) {
        dialog_layout.key = null;
        return;
    }
    const panel = query('#__dialog')[0];
    if (!panel || !(panel.h > 0)) return;
    const size = screenSize();

    const line_nodes = [];
    for (let i = 0; i < 4; i++) {
        const node = query('#__dialog_line' + i)[0];
        if (node) line_nodes.push(node);
    }
    const button_nodes = [];
    for (let i = 0; i < 6; i++) {
        const node = query('#__dialog_choice' + i)[0];
        if (node) button_nodes.push(node);
    }
    const visible_buttons = button_nodes.filter((b) => b.visible !== false).length;

    const key = [
        api.dialog.node ? String(api.dialog.node()) : '',
        api.dialog.page ? String(api.dialog.page()) : '0',
        size.w, size.h, visible_buttons,
    ].join('|');

    if (dialog_layout.key !== key) {
        dialog_layout.key = key;
        dialog_layout.base = {
            panel: { x: panel.x, y: panel.y, w: panel.w, h: panel.h },
            lines: line_nodes.map((node) => ({ node, x: node.x, y: node.y })),
            buttons: button_nodes.map((node) => ({ node, x: node.x, y: node.y })),
        };
    }
    const base = dialog_layout.base;
    if (!base) return;

    // 1. Возвращаем родную раскладку: диалог мог не пересчитать её в этом кадре.
    for (const item of base.lines) { item.node.x = item.x; item.node.y = item.y; }
    for (const item of base.buttons) { item.node.x = item.x; item.node.y = item.y; }
    panel.x = base.panel.x;
    panel.y = base.panel.y;
    panel.w = base.panel.w;
    panel.h = base.panel.h;

    const top = base.panel.y - base.panel.h / 2;
    const visible_lines = base.lines.filter((item) => item.node.visible !== false);

    // 2. У нарации имени нет — строки поднимаются в освободившуюся полосу.
    const speaker = query('#__dialog_speaker')[0];
    const speaker_hidden = !speaker || speaker.visible === false;
    const lift = (speaker_hidden && visible_lines.length)
        ? Math.round((speaker ? speaker.size : 20) * 1.2)
        : 0;

    // 3. Текстовая часть: от верха панели до первой кнопки выбора.
    const first_button = base.buttons.find((item) => item.node.visible !== false) || null;
    const text_area = first_button
        ? Math.max(0, (first_button.y - first_button.node.h / 2) - 5 - top)
        : base.panel.h;

    const first = visible_lines[0];
    const last = visible_lines[visible_lines.length - 1];
    const line_size = first ? first.node.size : 20;
    const pitch = visible_lines.length > 1
        ? (last.y - first.y) / (visible_lines.length - 1)
        : line_size * 1.35;
    const text_bottom = last ? (last.y - lift + pitch * 0.6 + 8) - top : 0;

    const extra = Math.max(0, Math.ceil(text_bottom - text_area));
    const wanted = Math.max(num(theme.height, 0), base.panel.h + extra);

    // 4. Панель растёт ВВЕРХ: нижняя кромка (и отступ от края экрана) остаётся
    //    на месте, а весь текст уезжает вместе с верхней кромкой — тогда строки
    //    не прилипают к низу окна. Если расти некуда (панель упёрлась в верх
    //    экрана), не поместившееся уходит вниз: кнопки отодвигаются от текста.
    const base_top = base.panel.y - base.panel.h / 2;
    const base_bottom = base.panel.y + base.panel.h / 2;
    const new_top = Math.max(0, base_bottom - wanted);
    const shift = new_top - base_top;
    const push = Math.max(0, extra - (wanted - base.panel.h));

    for (const item of base.lines) item.node.y = item.y + shift - lift;
    for (const item of base.buttons) {
        if (item.node.visible !== false) item.node.y = item.y + shift + push;
    }
    panel.h = wanted;
    panel.y = new_top + wanted / 2;
}

/**
 * Цвета кнопок выбора — каждый кадр.
 *
 * `$.dialog` сам решает, какой вариант подсвечен, и переписывает цвет кнопки
 * в своём `updateView()`. Поэтому тему кнопок надо ставить после него: иначе
 * она живёт ровно один кадр. Дёшево: шесть поисков по id и две упаковки цвета.
 */
function tickChoiceTheme(def) {
    const theme = def.dialog_theme;
    if (!theme) return;
    if (!api.dialog || typeof api.dialog.isOpen !== 'function' || !api.dialog.isOpen()) return;

    if (run.def.dialog_view && run.def.dialog_view.kind === 'rml') {
        tickDialogView(run.def);
        return;
    }
    tickDialogLayout(theme);
    if (theme.choiceTextSize) {
        for (let i = 0; i < 6; i++) {
            const list = query('#__dialog_choice' + i);
            const button = list && list.length ? list[0] : null;
            if (button && button.visible !== false) button.size = num(theme.choiceTextSize, button.size);
        }
    }
    if (!theme.choice) return;
    const focus = typeof api.dialog.choiceFocus === 'function' ? api.dialog.choiceFocus() : -1;
    const base = packColorSafe(theme.choice);
    const hover = packColorSafe(theme.choiceHover || theme.choice);
    for (let i = 0; i < 6; i++) {
        const list = query('#__dialog_choice' + i);
        const node = list && list.length ? list[0] : null;
        if (!node || node.visible === false) continue;
        node.color = i === focus ? hover : base;
    }
}

// --- Локации -----------------------------------------------------------------

function startLocation(beat) {
    if (!run) return 0;
    const def = run.def;
    const name = typeof beat.location === 'string' ? beat.location : (beat.location && (beat.location.name || beat.location.id));
    if (!name) return 0;
    const loc = def.locations[name];
    if (!loc) {
        if (ctx && typeof ctx.log === 'function') ctx.log(`$.timeline: локация "${name}" не объявлена в "${def.id}"`);
        return 0;
    }
    const fade_ms = ms(beat.fade !== undefined ? beat.fade : loc.fade, loc.fade !== undefined ? num(loc.fade, DEFAULTS.fade) : DEFAULTS.fade);
    const stage = run.stage;
    if (!stage) return 0;

    run.location = String(name);
    emit('location', { name: run.location, title: loc.title || '', background: loc.bg || null });

    if (loc.bg && stage.bg_a && stage.bg_b) {
        const front = run.loc_node === 'a' ? stage.bg_b : stage.bg_a;
        const back = run.loc_node === 'a' ? stage.bg_a : stage.bg_b;
        layoutBackground(front, loc.bg);
        front.node.visible(true);
        if (back.node.get(0).visible && fade_ms > 0) {
            tweenRig(front, [['alpha', 1, fade_ms / 1000]], { from: { alpha: 0 } });
            tweenRig(back, [['alpha', 0, fade_ms / 1000]]);
        } else {
            front.alpha = 1;
            front.node.alpha(1);
            back.node.visible(false);
            back.alpha = 0;
        }
        run.loc_node = run.loc_node === 'a' ? 'b' : 'a';
    } else if (loc.bg) {
        // Сцена ещё не построена (например, первый бит до enter): запомним
        // и применим при сборке.
        run.pending_bg = loc.bg;
    }

    if (loc.mood && stage.mood) {
        stage.mood.node.color(packColorSafe(loc.mood.color || '#000000'));
        tweenRig(stage.mood, [['alpha', num(loc.mood.alpha, 0.35), fade_ms / 1000 || 0.2]]);
    } else if (stage.mood && loc.mood === null) {
        tweenRig(stage.mood, [['alpha', 0, 0.3]]);
    }

    if (loc.music !== undefined && api.sound) {
        if (loc.music === null || loc.music === '') {
            if (api.sound.stopMusic) api.sound.stopMusic(fade_ms);
        } else if (api.sound.crossfade) {
            api.sound.crossfade(loc.music, fade_ms);
            if (loc.volume !== undefined && api.sound.musicVolume) api.sound.musicVolume(num(loc.volume, 0.6));
        } else if (api.sound.music) {
            api.sound.music(loc.music, { loop: true, volume: num(loc.volume, 0.6) });
        }
    }

    if (loc.sfx && api.sound && api.sound.play) api.sound.play(loc.sfx, { volume: 0.6 });
    showLocationCard(loc);
    return fade_ms;
}

/** Табличка с названием локации — привычная деталь визуальной новеллы. */
function showLocationCard(loc) {
    if (!run || !run.stage || !run.stage.card || !loc.title) return;
    if (run.def.location_card === false) return;
    const card = run.stage.card;
    card.node.text(String(loc.title));
    card.node.visible(true);
    card.alpha = 1;
    card.node.alpha(0);
    card.alpha = 0;
    const tween = tweenRig(card, [['alpha', 1, 0.25]]);
    run.timers.push({
        left: 1500,
        fn() {
            if (!run || !run.stage || run.stage.card !== card) return;
            tweenRig(card, [['alpha', 0, 0.5]], { onDone: () => { card.node.visible(false); } });
        },
    });
    return tween;
}

// --- Персонажи ---------------------------------------------------------------

function poseBeat(beat) {
    if (!run) return;
    const name = typeof beat.pose === 'string' ? beat.pose : (beat.pose && beat.pose.name);
    if (!name) return;
    const who = beat.who !== undefined ? String(beat.who) : run.def.hero;
    const rig = run.rigs.get(who);
    if (!rig) return;
    const member = run.def.cast[who];
    const path = member && member.poses[name];
    if (!path) {
        if (ctx && typeof ctx.log === 'function') ctx.log(`$.timeline: у "${who}" нет позы "${name}"`);
        return;
    }
    if (rig.pose === name && rig.el.sprite >= 0) return;
    rig.pose = name;
    rig.node.sprite(path);
    fitRig(rig, member);
}

function showBeat(beat) {
    const who = beat.show === true || beat.show === undefined ? run.def.hero : String(beat.show);
    const rig = who ? run.rigs.get(who) : null;
    if (!rig) return NEXT;
    const duration = ms(beat.ms, DEFAULTS.show);
    const from = beat.from || 'fade';
    const size = screenSize();

    rig.node.visible(true);
    if (rig.alpha <= 0 && from !== 'fade') rig.alpha = 0;
    const steps = [['alpha', num(beat.alpha, 1), duration / 1000]];
    if (from === 'left') {
        rig.dx = -size.w * num(beat.offset, 0.7);
        steps.push(['dx', 0, duration / 1000]);
    } else if (from === 'right') {
        rig.dx = size.w * num(beat.offset, 0.7);
        steps.push(['dx', 0, duration / 1000]);
    } else if (from === 'bottom') {
        rig.hop = -size.h * num(beat.offset, 0.5);
        steps.push(['hop', 0, duration / 1000]);
    }
    if (rig.alpha <= 0 && from === 'fade') rig.alpha = 0;
    emit('show', { who, from });
    return waitForTween(tweenRig(rig, steps), { ms: duration });
}

function hideBeat(beat) {
    const who = beat.hide === true || beat.hide === undefined ? run.def.hero : String(beat.hide);
    const rig = who ? run.rigs.get(who) : null;
    if (!rig) return NEXT;
    const duration = ms(beat.ms, DEFAULTS.hide);
    const steps = [['alpha', 0, duration / 1000]];
    if (beat.to === 'left') steps.push(['dx', -screenSize().w * 0.7, duration / 1000]);
    if (beat.to === 'right') steps.push(['dx', screenSize().w * 0.7, duration / 1000]);
    emit('hide', { who });
    return waitForTween(tweenRig(rig, steps, {
        onDone() { rig.node.visible(false); rig.dx = 0; },
    }), { ms: duration });
}

function animBeat(beat) {
    const who = beat.who !== undefined ? String(beat.who) : run.def.hero;
    const rig = who ? run.rigs.get(who) : null;
    if (!rig) return NEXT;
    const name = typeof beat.anim === 'string' ? beat.anim : (beat.anim && beat.anim.name);
    const hold_beat = beat.wait !== false;

    const tremor = TREMORS[name];
    if (tremor) {
        const speed = num(beat.speed, 1);
        rig.tremor = tremor.ms / speed;
        rig.tremor_amp = tremor.amp * num(beat.amp, 1);
        rig.tremor_angle = tremor.angle * num(beat.amp, 1);
        emit('anim', { who, name });
        if (hold_beat) return hold('anim', { rig, ms: rig.tremor });
        return NEXT;
    }

    const accent = ACCENTS[name];
    if (!accent) {
        if (ctx && typeof ctx.log === 'function') ctx.log(`$.timeline: неизвестный акцент "${name}" (есть: ${Object.keys(ACCENTS).concat(Object.keys(TREMORS)).join(', ')})`);
        return NEXT;
    }
    const speed = num(beat.speed, 1);
    const steps = accent.map((s) => [s[0], s[1], s[2] / speed]);
    emit('anim', { who, name });
    const tween = tweenRig(rig, steps, { chain: true });
    if (hold_beat) return waitForTween(tween);
    return NEXT;
}

/** Твин по полям рига: `[['dx', 0, 0.3], ['alpha', 1, 0.3]]`. */
function tweenRig(rig, steps, opts) {
    const options = opts || {};
    if (!api.tweenOf) return null;
    let tween = null;
    try {
        tween = api.tweenOf(rig);
        if (options.chain) {
            steps.forEach((step, index) => {
                if (index > 0) tween.chain();
                tween.property(step[0], step[1], step[2]);
            });
        } else {
            for (const step of steps) tween.property(step[0], step[1], step[2]);
        }
        if (options.from) {
            for (const key of Object.keys(options.from)) rig[key] = options.from[key];
        }
        if (options.onDone) tween.on('finished', options.onDone);
        if (run) {
            run.tween_handles = run.tween_handles || [];
            run.tween_handles.push(tween);
        }
    } catch (e) {
        report('$.timeline: твин рига', e);
    }
    return tween;
}

function waitForTween(tween, info) {
    if (!tween) return NEXT;
    if (!tween.finished) return hold('wait', { ms: (info && info.ms) || 200 });
    // Порядок важен: сначала hold, потом подписка. Твин может завершиться
    // мгновенно (нулевая длительность, уже пройденный путь) — и тогда
    // releaseWait обязан снять уже поставленное ожидание, а не то, которого
    // ещё нет. Ровно на этом стоял бит `{ show }`.
    const action = hold('tween', info || {});
    const done = () => releaseWait('tween');
    tween.finished().then(done).catch(done);
    return action;
}

// --- Экран -------------------------------------------------------------------

function shakeBeat(beat) {
    if (!api.camera || !api.camera.shake) return;
    const power = typeof beat.shake === 'object' && beat.shake !== null
        ? num(beat.shake.power, 8) : num(beat.shake, 8);
    const duration = typeof beat.shake === 'object' && beat.shake !== null
        ? num(beat.shake.ms, DEFAULTS.shake) : num(beat.ms, DEFAULTS.shake);
    if (power <= 0) return;
    api.camera.shake(power, duration);
    emit('shake', { power, ms: duration });
}

function flashBeat(beat) {
    const stage = run && run.stage;
    if (!stage || !stage.flash) return;
    const spec = typeof beat.flash === 'object' && beat.flash !== null ? beat.flash : { color: beat.flash };
    const duration = num(spec.ms, num(beat.ms, DEFAULTS.flash));
    const color = spec.color || '#ffffff';
    const alpha = num(spec.alpha, 0.85);
    const node = stage.flash.node;
    node.color = packColorSafe(color);
    node.visible(true);
    raiseOverlay(stage.flash);
    stage.flash.alpha = alpha;
    node.alpha(alpha);
    tweenRig(stage.flash, [['alpha', 0, Math.max(0.05, duration / 1000)]], {
        onDone() { node.visible(false); },
    });
    emit('flash', { color, ms: duration });
}

/**
 * Затемнение экрана: `{ fade: '#000000cc', ms: 600 }` — уйти в цвет,
 * `{ fade: null, ms: 400 }` или `{ fade: 0 }` — проявиться обратно.
 */
function fadeBeat(beat) {
    const stage = run && run.stage;
    if (!stage || !stage.fade) return 0;
    const spec = beat.fade;
    const duration = num(beat.ms, num(spec && spec.ms, DEFAULTS.fade));
    const overlay = stage.fade;
    raiseOverlay(overlay);
    overlay.node.visible(true);
    if (spec === null || spec === 0 || spec === undefined || spec === 'none') {
        tweenRig(overlay, [['alpha', 0, Math.max(0.05, duration / 1000)]], {
            onDone() { overlay.node.visible(false); },
        });
        return duration;
    }
    const color = typeof spec === 'string' ? spec : (spec.color || '#000000');
    const alpha = typeof spec === 'object' && spec !== null ? num(spec.alpha, 1) : 1;
    overlay.node.color(packColorSafe(color));
    tweenRig(overlay, [['alpha', alpha, Math.max(0.05, duration / 1000)]]);
    emit('fade', { color, alpha, ms: duration });
    return duration;
}

function zoomBeat(beat) {
    if (!api.camera) return;
    const value = typeof beat.zoom === 'object' && beat.zoom !== null ? num(beat.zoom.value, 1) : num(beat.zoom, 1);
    const duration = num(beat.ms, 600);
    if (api.camera.zoomTo) api.camera.zoomTo(value, duration);
    else if (api.camera.zoom) api.camera.zoom(value);
    emit('zoom', { value, ms: duration });
}

function musicBeat(beat) {
    if (!api.sound) return;
    const track = beat.music;
    if (track === null || track === false || track === '') {
        if (api.sound.stopMusic) api.sound.stopMusic(num(beat.ms, 400));
        return;
    }
    const opts = { loop: beat.loop !== false, volume: num(beat.volume, 0.6) };
    if (api.sound.music) api.sound.music(String(track), opts);
}

function sfxBeat(beat) {
    if (!api.sound || !api.sound.play) return;
    const list = Array.isArray(beat.sfx) ? beat.sfx : [beat.sfx];
    for (const item of list) {
        if (!item) continue;
        const path = typeof item === 'string' ? item : item.path;
        const volume = typeof item === 'string' ? num(beat.volume, 0.7) : num(item.volume, 0.7);
        if (path) api.sound.play(path, { volume });
    }
}

// --- Концовка ----------------------------------------------------------------

function endingBeat(beat) {
    const spec = typeof beat.ending === 'string' ? { id: beat.ending } : Object.assign({}, beat.ending);
    const def = run.def;
    run.ended = true;
    run.ending = spec;
    writeFlag('ending:' + spec.id, true);

    const ending = buildEndingCard(def, spec);
    run.ending_view = ending;
    ending_view = { def, view: ending };

    emit('ending', { id: spec.id, title: spec.title || spec.id, spec });
    emit('end', { id: def.id, reason: 'ending', ending: spec });

    // Прогон больше не идёт: биты после концовки не выполняются — иначе
    // «начать заново» пришлось бы объяснять сценарию.
    const stage = run.stage;
    rememberRun(def, run);
    run = null;
    if (api.dialog && api.dialog.isOpen && api.dialog.isOpen()) api.dialog.close();
    if (stage) stage.ending = ending;
    return STOP;
}

function buildEndingCard(def, spec) {
    const $ = api;
    const size = screenSize();
    const tint = spec.mood === 'bad' ? '#120409' : '#0b1020';
    const view = { nodes: [] };

    const backdrop = $('<ui.panel>', { id: '__tl_ending_bg' })
        .at(size.w / 2, size.h / 2).size(size.w, size.h).color(tint).alpha(0).appendTo($.ui);
    view.nodes.push(backdrop);

    const title = $('<ui.label>', { id: '__tl_ending_title', text: spec.title || 'Конец', size: 46,
                                   color: spec.mood === 'bad' ? '#ff8a8a' : '#ffd9e8' })
        .at(size.w / 2, size.h * 0.32).appendTo($.ui);
    title.get(0).attrs.align = 'center';
    view.nodes.push(title);

    if (spec.subtitle) {
        const subtitle = $('<ui.label>', { id: '__tl_ending_sub', text: spec.subtitle, size: 20, color: '#9fb0cc' })
            .at(size.w / 2, size.h * 0.32 + 44).appendTo($.ui);
        subtitle.get(0).attrs.align = 'center';
        view.nodes.push(subtitle);
    }

    const text = String(spec.text || '');
    if (text) {
        const lines = wrapLines(text, 62);
        lines.forEach((line, index) => {
            const label = $('<ui.label>', { id: '__tl_ending_line' + index, text: line, size: 22, color: '#dfe8f6' })
                .at(size.w / 2, size.h * 0.46 + index * 30).appendTo($.ui);
            label.get(0).attrs.align = 'center';
            view.nodes.push(label);
        });
    }

    const unlocked = unlockedEndings(def);
    const hint = $('<ui.label>', {
        id: '__tl_ending_hint', size: 18, color: '#8fa3bf',
        text: `${spec.hint || 'Space / Enter — заново · Esc — выход'}   ·   концовок открыто: ${unlocked}`,
    }).at(size.w / 2, size.h * 0.86).appendTo($.ui);
    hint.get(0).attrs.align = 'center';
    view.nodes.push(hint);

    // Карточка проявляется целиком: узлы интерфейса получают альфу от одного
    // твина, поэтому заголовок, текст и подсказка появляются вместе.
    for (const node of view.nodes) node.get(0).alpha = 0;
    if (api.tweenOf) {
        const fade_in = api.tweenOf({ t: 0 });
        fade_in.method((value) => {
            for (const node of view.nodes) node.get(0).alpha = value;
        }, 0, 1, DEFAULTS.ending / 1000);
    }

    view.handleInput = () => {
        const pressed = api.input && api.input.pressed;
        if (!pressed) return false;
        // Esc — выйти (в меню, если оно задано), Space/Enter — пройти заново.
        if (def.exitScene && pressed('escape')) { api.scene.load(def.exitScene); return true; }
        if (pressed('space') || pressed('enter') || pressed('escape')) {
            if (def.afterEnding) { def.afterEnding(api, spec); return true; }
            teardownEndingCard(view);
            if (ending_view && ending_view.view === view) ending_view = null;
            if (def.stage) def.stage.ending = null;
            buildStage(def);
            startRun(def, {});
            return true;
        }
        return false;
    };
    view.contains = (node) => view.nodes.includes(node);
    return view;
}

function teardownEndingCard(view) {
    if (!view) return;
    for (const node of view.nodes) {
        try { node.remove(); } catch (e) { report('$.timeline: уборка концовки', e); }
    }
    view.nodes.length = 0;
}

function unlockedEndings(def) {
    if (!api.store || typeof api.store.keys !== 'function') return '?';
    const keys = api.store.keys().filter((k) => String(k).startsWith('ending:'));
    return keys.length;
}

/** Перенос длинного текста по словам: у ui.label нет автопереноса. */
function wrapLines(text, width) {
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
        let line = '';
        for (const word of paragraph.split(/\s+/)) {
            if (!word) continue;
            if (line && (line.length + 1 + word.length) > width) { lines.push(line); line = word; }
            else line = line ? line + ' ' + word : word;
        }
        lines.push(line);
    }
    return lines;
}

function packColorSafe(color) {
    if (api && typeof api.color === 'function') return api.color(color);
    return engine.WHITE;
}

// ===========================================================================
// Сцена: фон, герои, оверлеи
// ===========================================================================

function buildStage(def) {
    const $ = api;
    const size = screenSize();
    if (!def.stage) def.stage = {};
    const stage = def.stage;

    // Камера приколота к центру окна: мир = экран, но тряска двигает всё.
    if ($.camera) {
        if ($.camera.unfollow) $.camera.unfollow();
        if ($.camera.limits) $.camera.limits(null, null, null, null);
        if ($.camera.at) $.camera.at(size.w / 2, size.h / 2);
        if ($.camera.zoom) $.camera.zoom(1);
    }
    if ($.world && $.world.color) $.world.color(def.backdrop);

    if (stage.built) { layoutStage(def); return stage; }

    stage.bg_a = makeLayer($, '__tl_bg_a', def, -100);
    stage.bg_b = makeLayer($, '__tl_bg_b', def, -90);
    // Слой 5 — между фоном (-100) и героями (10): оттенок локации красит
    // декорации, но не съедает цвета персонажа.
    stage.mood = { node: $('<rect>', { id: '__tl_mood' }).at(size.w / 2, size.h / 2).size(size.w, size.h)
        .color('#000000').alpha(0).layer(5).appendTo($.world), alpha: 0 };
    stage.card = { node: $('<ui.label>', { id: '__tl_card', text: '', size: 30, color: '#ffe9f2' })
        .at(64, 56).appendTo($.ui), alpha: 0 };
    stage.card.node.get(0).attrs.align = 'left';
    stage.card.node.visible(false);
    stage.fade = makeOverlay($, '__tl_fade', size);
    stage.flash = makeOverlay($, '__tl_flash', size);
    stage.next = { node: $('<ui.label>', { id: '__tl_next', text: '▼', size: 22, color: '#ffd9e8' })
        .at(size.w - 64, size.h - 46).appendTo($.ui), alpha: 0, blink: 0 };
    stage.next.node.visible(false);
    stage.built = true;

    if ($.window && typeof $.window.on === 'function') {
        $.window.on('resize', () => { if (run && run.def === def) layoutStage(def); });
    }
    layoutStage(def);
    return stage;
}

function makeLayer($, id, def, layer) {
    const size = screenSize();
    const node = $('<sprite>', { id })
        .at(size.w / 2, size.h / 2).size(size.w, size.h)
        .alpha(0).layer(layer).appendTo($.world);
    node.visible(false);
    return { node, alpha: 0, path: null };
}

function makeOverlay($, id, size) {
    const node = $('<ui.panel>', { id }).at(size.w / 2, size.h / 2).size(size.w, size.h)
        .color('#000000').alpha(0).appendTo($.ui);
    node.visible(false);
    return { node, alpha: 0 };
}

/**
 * Поднять оверлей над панелью диалога. Интерфейс рисуется в порядке создания
 * узлов, а панель диалога создаётся позже сцены — без переприкрепления
 * затемнение оказалось бы ПОД текстом.
 */
function raiseOverlay(overlay) {
    if (!overlay || !overlay.node || !api.ui) return;
    try { overlay.node.appendTo(api.ui); } catch (e) { report('$.timeline: подъём оверлея', e); }
}

function layoutBackground(layer, path) {
    if (!layer) return;
    if (path && layer.path !== path) {
        layer.node.sprite(path);
        layer.path = path;
    }
    layer.node.visible(true);
}

function layoutStage(def) {
    const stage = def.stage;
    if (!stage || !stage.built) return;
    const size = screenSize();
    for (const key of ['bg_a', 'bg_b']) {
        const layer = stage[key];
        if (!layer) continue;
        layer.node.at(size.w / 2, size.h / 2).size(size.w, size.h);
    }
    if (stage.mood) stage.mood.node.at(size.w / 2, size.h / 2).size(size.w, size.h);
    for (const key of ['fade', 'flash']) {
        const overlay = stage[key];
        if (!overlay) continue;
        overlay.node.at(size.w / 2, size.h / 2).size(size.w, size.h);
    }
    if (stage.next) stage.next.node.at(size.w - 64, size.h - 46);
    if (run) for (const rig of run.rigs.values()) layoutRig(rig);
    if (stage.ending) { /* карточка концовки пересобирается при следующем входе */ }
}

/**
 * Собрать персонажей под новый прогон.
 *
 * Узлы живут на сцене (`stage.rigs`), а не в прогоне: иначе каждый перезапуск
 * новеллы спавнил новую Руси-тян рядом со старой — узлы копились, и на экране
 * оказывалось две героини. Прогон здесь только сбрасывает состояние рига
 * (поза, сдвиги, прозрачность) и забирает себе ссылки на те же узлы.
 */
function buildCast(def) {
    const $ = api;
    const size = screenSize();
    const stage = def.stage || buildStage(def);
    if (!stage.rigs) stage.rigs = new Map();

    for (const key of Object.keys(def.cast)) {
        const member = def.cast[key];
        const poses = Object.keys(member.poses);
        const first = member.pose && member.poses[member.pose] ? member.pose : poses[0];

        let rig = stage.rigs.get(key);
        if (!rig) {
            const node = $('<sprite>', { id: '__tl_hero_' + key })
                .at(size.w * member.x, size.h * member.bottom)
                .layer(member.layer).alpha(0).appendTo($.world);
            node.visible(false);
            if (member.mirror) node.get(0).scale_x = -1;
            rig = {
                who: key, node, el: node.get(0), member,
                x: size.w * member.x,
                bottom: size.h * member.bottom,
                scale: 1, angle: 0, alpha: 0,
                dx: 0, dy: 0, hop: 0,
                // fxRandom, а не Math.random: дыхание и фаза обязаны быть
                // ВОСПРОИЗВОДИМЫМИ при --seed/--fixed-dt, иначе записанный
                // реплей ($.replay) разойдётся на первом же кадре.
                breath: fxRandom() * Math.PI * 2,
                idle: member.idle,
                pose: null, aspect: 0.55,
                base_w: 0, base_h: 0,
                tremor: 0, tremor_amp: 0, tremor_angle: 0,
                phase: fxRandom() * 6.28,
            };
            if (member.tint) node.color(member.tint);
            stage.rigs.set(key, rig);
        }

        // Сброс под новый прогон: герой снова за кадром и в стартовой позе.
        rig.member = member;
        rig.el = rig.node.get(0);
        rig.pose = first || null;
        if (first) rig.node.sprite(member.poses[first]);
        rig.scale = 1;
        rig.angle = 0;
        rig.alpha = 0;
        rig.dx = 0; rig.dy = 0; rig.hop = 0;
        rig.tremor = 0; rig.tremor_amp = 0; rig.tremor_angle = 0;
        rig.idle = member.idle;
        rig.node.visible(false);
        layoutRig(rig);
        fitRig(rig, member);
        run.rigs.set(key, rig);
    }

    // Персонаж пропал из cast (перезагрузка скриптов) — убираем и его узел.
    for (const [key, rig] of [...stage.rigs]) {
        if (def.cast[key]) continue;
        try { rig.node.remove(); } catch (e) { report('$.timeline: уборка героя', e); }
        stage.rigs.delete(key);
    }
    return stage;
}

/** Размер спрайта героя: высота — доля окна, ширина — по пропорциям картинки. */
function fitRig(rig, member) {
    const size = screenSize();
    const height = size.h * num(member.height, 0.92);
    const intrinsic = rig.el.sprite >= 0 ? spriteSize(rig.el.sprite) : null;
    if (intrinsic && intrinsic[1] > 0) rig.aspect = intrinsic[0] / intrinsic[1];
    rig.base_h = height;
    rig.base_w = height * rig.aspect;
}

function layoutRig(rig) {
    const size = screenSize();
    rig.x = size.w * num(rig.member.x, 0.5);
    rig.bottom = size.h * num(rig.member.bottom, 1.0);
    fitRig(rig, rig.member);
}

/** Покадровое применение рига: дыхание, дрожь и акценты в одном месте. */
function applyRig(rig, dt) {
    const node = rig.el;         // поля узла: у обёртки их нет, только методы

    // Дрожь затухает всегда, даже если герой в этот момент скрыт: иначе бит
    // `{ anim: 'tremble' }` на невидимом персонаже подвесил бы прогон.
    let jx = 0, jy = 0, ja = 0;
    if (rig.tremor > 0) {
        rig.tremor = Math.max(0, rig.tremor - dt * 1000);
        const decay = rig.tremor / (TREMORS.tremble.ms || 420);
        jx = Math.sin(rig.phase * 60) * rig.tremor_amp * decay;
        jy = Math.cos(rig.phase * 47) * rig.tremor_amp * 0.5 * decay;
        ja = Math.sin(rig.phase * 53) * rig.tremor_angle * decay;
        if (rig.tremor === 0 && run && run.wait && run.wait.kind === 'anim' && run.wait.rig === rig) {
            releaseWait('anim');
        }
    }

    if (!node.visible && rig.alpha <= 0) return;

    rig.phase += dt * 0.0022;
    const breath = rig.idle ? 1 + Math.sin(rig.phase) * 0.009 : 1;

    const scale_y = rig.scale * breath;
    const scale_x = rig.scale * (2 - breath);
    node.scale_x = rig.member.mirror ? -scale_x : scale_x;
    node.scale_y = scale_y;
    node.alpha = rig.alpha;
    node.angle = rig.angle + ja;
    const height = rig.base_h * scale_y;
    node.w = rig.base_w;
    node.h = rig.base_h;
    node.y = rig.bottom - height / 2 - rig.hop + rig.dy + jy;
    node.x = rig.x + rig.dx + jx;
}

function teardownStage(def) {
    const stage = def.stage;
    if (!stage) return;
    if (stage.ending) teardownEndingCard(stage.ending);
    if (ending_view && ending_view.def === def) ending_view = null;
    if (stage.rigs) {
        for (const rig of stage.rigs.values()) {
            try { rig.node.remove(); } catch (e) { report('$.timeline: уборка героя', e); }
        }
        stage.rigs.clear();
    }
    for (const key of Object.keys(stage)) {
        const item = stage[key];
        if (item && item.node) {
            try { item.node.remove(); } catch (e) { report('$.timeline: уборка сцены', e); }
        }
        if (item && item.nodes) teardownEndingCard(item);
    }
    def.stage = {};
}

// ===========================================================================
// Кадр
// ===========================================================================

export function tickTimeline(dt) {
    // Концовка живёт после остановки прогона: у неё своя реакция на ввод.
    if (!run) {
        if (ending_view && ending_view.view.handleInput) ending_view.view.handleInput();
        return;
    }
    run.time += dt;
    run.ticks++;

    // 1. Таймеры прогона (паузы, табличка локации).
    if (run.timers.length) {
        const fired = [];
        for (const timer of run.timers) {
            timer.left -= dt * 1000;      // dt — секунды, left — миллисекунды
            if (timer.left <= 0) fired.push(timer);
        }
        if (fired.length) {
            run.timers = run.timers.filter((t) => fired.indexOf(t) < 0);
            for (const timer of fired) {
                try { timer.fn(); } catch (e) { report('$.timeline: таймер', e); }
            }
            if (!run) return;
        }
    }

    // 2. Пауза бита `{ wait: 400 }` и `{ fade: … }` — тикает тем же dt, что и
    //    печатная машинка диалога, поэтому пауза и текст идут в ногу.
    if (run.wait && run.wait.kind === 'wait') {
        if (run.wait.left === undefined) run.wait.left = num(run.wait.ms, 200);
        run.wait.left -= dt * 1000;
        if (run.wait.left <= 0) {
            run.wait = null;
            requestStep();
        }
    }

    // 3. Отложенное продолжение: шаг всегда делается в кадре, а не внутри
    //    обработчика диалога (см. installTimeline).
    if (run.step_pending) {
        run.step_pending = false;
        step();
        if (!run) return;
    }

    // 4. Риги: дыхание, дрожь, применение позы к узлу.
    for (const rig of run.rigs.values()) applyRig(rig, dt);

    // 5. Фон, настроение, вспышки и затемнения: твины пишут в объект-обёртку,
    //    а рисуется поле узла — синхронизируем раз в кадр.
    syncStage(run.def.stage);

    // 6. Авто-режим: сам листает реплики, когда игрок не хочет жать пробел.
    if (runtime.auto > 0 && api.dialog && api.dialog.isOpen && api.dialog.isOpen()) {
        const typing = api.dialog.isTyping && api.dialog.isTyping();
        const choices = api.dialog.choices ? api.dialog.choices().length : 0;
        // Авто-режим не перебивает голос: пока реплика звучит, пауза не идёт.
        if (!typing && choices === 0 && run.wait && run.wait.kind === 'say' && !voicePlaying(run.def)) {
            run.auto_timer += dt * 1000;
            if (run.auto_timer >= runtime.auto) {
                run.auto_timer = 0;
                api.dialog.next();
            }
        }
    }

    // 7. Тема кнопок выбора: $.dialog уже перекрасил их в этом кадре.
    tickChoiceTheme(run.def);

    // 8. Указатель «дальше» у панели диалога.
    const stage = run.def.stage;
    if (stage && stage.next) {
        const open = api.dialog && api.dialog.isOpen && api.dialog.isOpen();
        const typing = api.dialog && api.dialog.isTyping && api.dialog.isTyping();
        const choices = api.dialog && api.dialog.choices ? api.dialog.choices().length : 0;
        const ready = !!(open && !typing && choices === 0 && run.wait && run.wait.kind === 'say');
        stage.next.node.visible(ready);
        if (ready) {
            stage.next.blink += dt * 1000;
            stage.next.alpha = 0.45 + 0.55 * Math.abs(Math.sin(stage.next.blink / 420));
        } else {
            stage.next.blink = 0;
            stage.next.alpha = 0;
        }
    }
}

/**
 * Реплика, нарисованная документом RmlUi.
 *
 * Что делает RmlUi: раскладку, перенос строк по ширине блока, шрифт, рамку,
 * подсветку кнопок под курсором. Что остаётся здесь: отдать ему текст, имя
 * говорящего и варианты, а также спрятать штатную панель `$.dialog` — она
 * создаётся всегда, и без этого реплика рисовалась бы дважды.
 */
function tickDialogView(def) {
    const view = def.dialog_view;
    if (!view || view.kind !== 'rml') return;
    if (!api.ui || typeof api.ui.doc !== 'function') return;

    if (!view.handle) {
        view.handle = api.ui.doc(view.doc);
        // Кнопки создаются один раз (их фиксированное число), поэтому подписка
        // на клик не теряется при смене реплики — в отличие от пересборки HTML.
        for (let i = 0; i < view.choices; i++) {
            const id = view.choice_prefix + i;
            const index = i;
            view.handle.on(id, 'click', () => {
                if (api.dialog && typeof api.dialog.isOpen === 'function' && api.dialog.isOpen()) {
                    api.dialog.choose(index);
                }
            });
        }
    }

    const open = !!(api.dialog && typeof api.dialog.isOpen === 'function' && api.dialog.isOpen());
    if (!open) {
        if (view.shown !== false) { view.handle.hide(); view.shown = false; }
        return;
    }
    if (view.shown !== true) { view.handle.show(); view.shown = true; }
    hideNativeDialog();

    const speaker = typeof api.dialog.speaker === 'function' ? api.dialog.speaker() : '';
    if (view.last_speaker !== speaker) {
        view.last_speaker = speaker;
        view.handle.text(view.speaker, speaker || '');
        view.handle.cls(view.speaker, view.off_class, !speaker);
    }

    const text = typeof api.dialog.text === 'function' ? api.dialog.text() : '';
    if (view.last_text !== text) {
        view.last_text = text;
        view.handle.text(view.text, text);
    }

    const choices = typeof api.dialog.choices === 'function' ? api.dialog.choices() : [];
    const focus = typeof api.dialog.choiceFocus === 'function' ? api.dialog.choiceFocus() : 0;
    const signature = choices.map((c) => c.text).join('\u0000') + '#' + focus;
    if (view.last_choices !== signature) {
        view.last_choices = signature;
        for (let i = 0; i < view.choices; i++) {
            const id = view.choice_prefix + i;
            const choice = choices[i];
            view.handle.text(id, choice ? choice.text : '');
            view.handle.cls(id, view.off_class, !choice);
            view.handle.cls(id, view.selected_class, !!choice && i === focus);
        }
    }
}

/** Спрятать штатную панель $.dialog: её рисует RmlUi (см. tickDialogView). */
function hideNativeDialog() {
    const ids = ['__dialog', '__dialog_portrait', '__dialog_speaker'];
    for (let i = 0; i < 4; i++) ids.push('__dialog_line' + i);
    for (let i = 0; i < 6; i++) ids.push('__dialog_choice' + i);
    for (const id of ids) {
        const node = query('#' + id)[0];
        if (node) node.visible = false;
    }
}

/** Перенести альфы объектов сцены в их узлы (твины пишут в объект). */
function syncStage(stage) {
    if (!stage) return;
    for (const key of ['bg_a', 'bg_b', 'mood', 'card', 'fade', 'flash', 'next']) {
        const item = stage[key];
        if (!item || !item.node) continue;
        if (item.alpha !== undefined) item.node.alpha(item.alpha);
    }
}

// ===========================================================================
// Служебное
// ===========================================================================

function runState() {
    if (!run) {
        return {
            running: false,
            id: last_run.id,
            scene: last_run.scene,
            ended: last_run.ended,
            ending: last_run.ending,
            location: last_run.location,
            waiting: null,
            beats: last_run.beats,
            ticks: last_run.ticks,
            time: last_run.time,
            depth: 0,
            label: null,
            actors: [],
            choices: [],
            text: '',
            auto: runtime.auto,
            flags: api && api.store && api.store.all ? api.store.all() : {},
        };
    }
    const frame = run.frames[run.frames.length - 1];
    const actors = [];
    for (const [who, rig] of run.rigs) {
        actors.push({
            who,
            pose: rig.pose,
            visible: !!rig.el.visible,
            x: Math.round(rig.el.x),
            y: Math.round(rig.el.y),
            alpha: Number(rig.alpha.toFixed(3)),
            scale: Number(rig.scale.toFixed(3)),
        });
    }
    return {
        running: true,
        id: run.def.id,
        scene: run.def.scene,
        ending: run.ending ? run.ending.id : null,
        ended: run.ended,
        location: run.location,
        waiting: run.wait ? run.wait.kind : null,
        wait_left: run.wait && run.wait.left !== undefined ? Math.round(run.wait.left) : (run.wait ? run.wait.ms : null),
        timers: run.timers.length,
        beats: run.beats,
        ticks: run.ticks,
        time: Math.round(run.time),
        depth: run.frames.length,
        label: labelAt(run, frame),
        actors,
        choices: api && api.dialog && api.dialog.choices ? api.dialog.choices() : [],
        text: api && api.dialog && api.dialog.text ? api.dialog.text() : '',
        auto: runtime.auto,
        flags: api && api.store && api.store.all ? api.store.all() : {},
    };
}

/** Ближайшая метка позади текущей позиции — читаемое «где мы в сценарии». */
function labelAt(state, frame) {
    if (!frame) return null;
    let best = null;
    for (const [name, beat] of state.def.labels) {
        const index = state.def.script.indexOf(beat);
        if (index >= 0 && index < frame.index && (best === null || index > best.index)) best = { name, index };
    }
    return best ? best.name : null;
}

function playTimeline(id, opts) {
    const def = definitions.get(id);
    if (!def) {
        if (ctx && typeof ctx.log === 'function') ctx.log(`$.timeline.play: таймлайн "${id}" не объявлен — см. $.timeline.list()`);
        return false;
    }
    const transition = opts && opts.transition !== undefined ? opts.transition : 'fade';
    if (api.scene && api.scene.current && api.scene.current() !== def.scene) {
        def.pending = { opts: opts || {} };
        api.scene.load(def.scene, { transition });
        return true;
    }
    startRun(def, opts || {});
    return true;
}
