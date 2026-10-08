// ===========================================================================
// Исполнитель сценок — $.story
//
// Порт из audm-neko (game/story/story_runner.gd). Сценарий — текстовый файл
// (разбор в src/highlevel/story_script.js), здесь его исполнение: реплики,
// выборы, флаги, ведение актёров, камера, полосы катсцены, затемнение и кадры.
//
//   $.story.actor('Некотян', '#companion');   // имя из сценария → узел
//   $.story.play('story/prologue.scene');
//   if ($.story.locked()) return;             // игрок не управляет собой
//
// Почему так. В Godot исполнитель был корутиной (`await`), и сценка шла «сама
// собой»: реплика ждёт нажатия, `move` ждёт прихода, `wait` ждёт времени.
// Здесь то же самое делается генератором: `yield` отдаёт кадр, а `$.task.each`
// крутит его, пока сценка не кончится. Никаких вложенных колбэков и «кадра
// позже» — код читается как сценарий.
//
// Катсцена (сценка без `@free`) отбирает управление: `$.story.locked()` истинно,
// сверху и снизу появляются полосы. Сценка с `@free` идёт поверх игры и ничего
// не блокирует.
//
// Флаги сценок — общие на игру: выбор в одной сценке виден в следующих.
// ===========================================================================

import { engine } from './native.js';
import { ctx, query } from './core.js';
import { parseStory, checkCondition, applySet, labelIndex } from './story_script.js';

/** Сколько ждать, пока актёр дойдёт (застрял — сценка идёт дальше). */
export const MOVE_TIMEOUT = 6.0;
/** На каком расстоянии считать, что актёр пришёл. */
export const MOVE_ARRIVE_PX = 18.0;
/** Доля высоты экрана под полосы катсцены. */
export const LETTERBOX = 0.09;

export function installStory($) {
    const actors = new Map();          // имя из сценария → узел или селектор
    const flags = {};                  // общие флаги сценок
    const bubbles = [];                // облачка над головой
    let running = false;
    let locked = false;
    let task = null;
    let ui = null;
    // Внешний выбор: игре и тестам нужно ответить вместо игрока.
    let chooser = null;
    // Автолистание реплик: тесты и автопилот прогоняют сценку без игрока.
    let auto_advance = false;
    let advance_queued = false;

    // --- Мелочи --------------------------------------------------------------

    /**
     * Создать узел. Идём через сам `$`: `ctx.$` для этого не нужен, а в
     * модульных тестах его и вовсе нет.
     */
    function makeNode(tag, attrs) {
        return $(tag, attrs);
    }

    /** Сигнал шины, если подсистема сигналов уже стоит. */
    function emit(name, data) {
        if ($ && $.signal && typeof $.signal.emit === 'function') $.signal.emit(name, data);
    }

    function nowSeconds() {
        if (ctx.time && typeof ctx.time.now === 'function') return ctx.time.now();
        return typeof engine.time === 'number' ? engine.time : 0;
    }

    /**
     * Подписка на игровой кадр. Хук ставит `$.update`: в `ctx.update` его нет,
     * и эта ошибка роняла установку всего API (проверено на сборке движка).
     * Возвращает функцию отмены (сейчас отписки нет — пустую).
     */
    function addUpdate(fn) {
        if ($ && typeof $.update === 'function') {
            $.update(fn);
            return () => {};
        }
        ctx.log('$.story: нет $.update — покадровые хуки недоступны');
        return () => {};
    }

    // --- Служебные узлы сцены: полосы, кадр, затемнение, окно реплики ---------

    function ensureUi() {
        if (ui) return ui;
        const bars = [];
        const bar_h = Math.max(1, Math.round(engine.height * LETTERBOX));
        for (const top of [true, false]) {
            const bar = makeNode('<rect>', {
                id: top ? '__story_bar_top' : '__story_bar_bottom',
                w: engine.width, h: bar_h, color: '#000000',
            });
            bar.at(engine.width / 2, top ? bar_h / 2 : engine.height - bar_h / 2);
            bars.push(bar);
        }
        const image = makeNode('<sprite>', {
            id: '__story_image', w: engine.width, h: engine.height,
        }).at(engine.width / 2, engine.height / 2);
        const fade = makeNode('<rect>', {
            id: '__story_fade', w: engine.width, h: engine.height, color: '#000000',
        }).at(engine.width / 2, engine.height / 2);
        const panel = makeNode('<rect>', {
            id: '__story_box', w: engine.width - 80, h: 120, color: '#10141ce8',
        }).at(engine.width / 2, engine.height - 90);
        const who = makeNode('<text>', {
            id: '__story_who', text: '', size: 20, color: '#ffd166',
        }).at(56, engine.height - 138);
        const line = makeNode('<text>', {
            id: '__story_line', text: '', size: 24, color: '#ffffff',
        }).at(56, engine.height - 102);
        const choices = makeNode('<ui.col>', { id: '__story_choices' })
            .at(engine.width / 2, engine.height - 250);

        ui = { bars, image, fade, panel, who, line, choices, visible: false };
        showUi(false);
        return ui;
    }

    function showUi(on) {
        const u = ensureUi();
        u.visible = !!on;
        for (const part of [u.image, u.fade, u.panel, u.who, u.line, u.choices]) {
            if (part) part.visible(!!on);
        }
        for (const bar of u.bars) bar.visible(!!on);
    }

    /** Полосы катсцены показываются только не-`@free` сценкам. */
    function showBars(on) {
        for (const bar of ensureUi().bars) bar.visible(!!on);
    }

    // --- Актёры --------------------------------------------------------------

    function resolveTarget(target) {
        if (!target) return null;
        if (typeof target === 'string') return query(target)[0] || null;
        if (target.nodes) return target.nodes[0] || null;
        return target;
    }

    function actorNode(name) {
        if (!name) return null;
        const key = String(name).toLowerCase();
        if (['игрок', 'player', 'я'].includes(key)) {
            const declared = actors.get('player') || actors.get('игрок');
            const node = resolveTarget(declared);
            if (node) return node;
            return query('#player')[0] || query('#hero')[0] || null;
        }
        if (actors.has(key)) return resolveTarget(actors.get(key));
        // Не объявлен — ищем узел с таким id.
        return query('#' + name)[0] || null;
    }

    /** Точка на карте: актёр или узел-маркер с таким именем. */
    function pointOf(name) {
        const actor = actorNode(name);
        if (actor) return { x: actor.x, y: actor.y };
        const marker = query('#' + name)[0];
        return marker ? { x: marker.x, y: marker.y } : null;
    }

    function displayName(who, actor) {
        if (!actor) return who;
        const low = String(who).toLowerCase();
        if (['игрок', 'player', 'я', 'companion', 'спутница'].includes(low)) {
            const named = actor.attr && actor.attr('name');
            return named || who;
        }
        return who;
    }

    // --- Ожидания ------------------------------------------------------------

    function waited(from, sec) {
        if (!(sec > 0)) return true;
        return nowSeconds() - from >= sec;
    }

    function arrived(actor, target) {
        if (!actor || !target) return true;
        const dx = actor.x - target.x;
        const dy = actor.y - target.y;
        return Math.sqrt(dx * dx + dy * dy) <= MOVE_ARRIVE_PX;
    }

    // --- Реплики -------------------------------------------------------------

    function say(who, text, emotion) {
        const u = ensureUi();
        u.who.text = who || '';
        const tail = emotion ? ` (${emotion})` : '';
        u.line.text = (who ? who + tail + ': ' : '') + text;
        const info = { who: who || '', text, emotion: emotion || '' };
        story.last_line = info;
        emit('story:line', info);
    }

    /** Хочет ли игрок листать реплику (пробел, Enter или клик). */
    function advanceReady() {
        if (auto_advance) return true;
        // `$.story.advance()` — ответ из игры или теста: работает так же, как
        // нажатие, и не зависит от того, есть ли у узла ввод.
        if (advance_queued) { advance_queued = false; return true; }
        const input = ctx.input || $.input;
        if (input && typeof input.pressed === 'function') {
            return !!(input.pressed('space') || input.pressed('enter')
                || input.pressed('return') || input.pressed('mouse'));
        }
        if (typeof engine.keyPressed === 'function') {
            return !!(engine.keyPressed('space') || engine.keyPressed('enter')
                || engine.keyPressed('return'));
        }
        return false;
    }

    function makeChoices(items) {
        const u = ensureUi();
        u.choices.clear();
        const nodes = [];
        for (let i = 0; i < items.length; ++i) {
            const button = makeNode('<ui.button>', {
                id: `__story_choice${i}`,
                text: items[i].text,
                w: Math.min(520, engine.width - 120),
                h: 36,
            });
            button.attr('_story_index', i);
            button.appendTo(u.choices);
            nodes.push(button);
        }
        return nodes;
    }

    /** Ждёт выбора и возвращает выбранный вариант. */
    function* pickChoice(items) {
        const nodes = makeChoices(items);
        let focus = 0;
        for (;;) {
            // Выбор из игры: `$.story.choose(2)` отвечает за игрока —
            // нужно для скриптовых тестов и для автопилота.
            if (chooser !== null) {
                const picked = Math.max(0, Math.min(Number(chooser) | 0, items.length - 1));
                chooser = null;
                return items[picked];
            }
            const input = ctx.input || $.input;
            if (input && typeof input.pressed === 'function') {
                if (input.pressed('down')) focus = (focus + 1) % nodes.length;
                if (input.pressed('up')) focus = (focus - 1 + nodes.length) % nodes.length;
                if (input.pressed('space') || input.pressed('enter')
                    || input.pressed('return')) break;
                let digit = -1;
                for (let i = 0; i < nodes.length && i < 9; ++i) {
                    if (input.pressed(String(i + 1))) { digit = i; break; }
                }
                if (digit >= 0) { focus = digit; break; }
            }
            let clicked = -1;
            for (let i = 0; i < nodes.length; ++i) {
                if (nodes[i].attr('_pressed')) { clicked = i; break; }
            }
            if (clicked >= 0) { focus = clicked; break; }
            yield;
        }
        const choice = items[Math.max(0, Math.min(focus, items.length - 1))];
        yield;
        return choice;
    }

    /** Облачко над головой: текст на время, без ожидания. */
    function showBubble(actor, text) {
        const bubble = makeNode('<text>', { text, size: 18, color: '#ffffff' })
            .at(actor.x, actor.y - 48);
        bubbles.push({ node: bubble, until: nowSeconds() + 2.2 });
    }

    function tickBubbles() {
        for (let i = bubbles.length - 1; i >= 0; --i) {
            if (nowSeconds() >= bubbles[i].until) {
                if (bubbles[i].node && bubbles[i].node.remove) bubbles[i].node.remove();
                bubbles.splice(i, 1);
            }
        }
    }

    /** Цель движения: имя маркера, «+200»/«-150» пикселей или актёр. */
    function moveTarget(to, actor) {
        if (!actor) return null;
        const text = String(to);
        if (/^[+-]\d+$/.test(text)) {
            return { x: actor.x + parseInt(text, 10), y: actor.y };
        }
        return pointOf(text);
    }

    // --- Исполнитель ---------------------------------------------------------

    function* exec(script, from) {
        let index = from;
        while (index >= 0 && index < script.commands.length) {
            const cmd = script.commands[index];
            let next = index + 1;
            switch (cmd.op) {
                case 'say': {
                    const actor = actorNode(cmd.who);
                    say(displayName(cmd.who, actor), cmd.text, cmd.emotion);
                    index = next;
                    if (index < script.commands.length && script.commands[index].op === 'choices') {
                        const block = script.commands[index];
                        const chosen = yield* pickChoice(block.items);
                        for (const st of chosen.sets) applySet(st, flags);
                        flags._last_choice = block.items.indexOf(chosen);
                        if (chosen.to === 'end') return;
                        if (chosen.to) {
                            const at = labelIndex(script, chosen.to);
                            if (at === null) {
                                ctx.log(`$.story: нет метки «${chosen.to}» — сценка закончена`);
                                return;
                            }
                            index = at;
                            continue;
                        }
                        continue;
                    }
                    // Кадр, чтобы нажатие, открывшее реплику, не закрыло её сразу.
                    yield;
                    while (!advanceReady()) yield;
                    yield;
                    continue;
                }
                case 'choices': {
                    const chosen = yield* pickChoice(cmd.items);
                    for (const st of chosen.sets) applySet(st, flags);
                    if (chosen.to === 'end') return;
                    if (chosen.to) {
                        const at = labelIndex(script, chosen.to);
                        if (at === null) {
                            ctx.log(`$.story: нет метки «${chosen.to}» — сценка закончена`);
                            return;
                        }
                        index = at;
                        continue;
                    }
                    continue;
                }
                case 'bubble': {
                    const actor = actorNode(cmd.who);
                    if (actor) showBubble(actor, cmd.text);
                    break;
                }
                case 'set':
                    applySet(cmd, flags);
                    break;
                case 'if': {
                    if (checkCondition(cmd.cond, flags)) {
                        if (cmd.to === 'end') return;
                        const at = labelIndex(script, cmd.to);
                        if (at === null) {
                            ctx.log(`$.story: нет метки «${cmd.to}»`);
                            return;
                        }
                        index = at;
                        continue;
                    }
                    break;
                }
                case 'goto': {
                    if (cmd.to === 'end') return;
                    const at = labelIndex(script, cmd.to);
                    if (at === null) {
                        ctx.log(`$.story: нет метки «${cmd.to}» — сценка закончена`);
                        return;
                    }
                    index = at;
                    continue;
                }
                case 'end':
                    return;
                case 'wait': {
                    const from = nowSeconds();
                    while (!waited(from, cmd.sec)) yield;
                    break;
                }
                case 'camera': {
                    const point = pointOf(cmd.target);
                    if (point && ctx.camera && typeof ctx.camera.move === 'function') {
                        ctx.camera.move(point.x, point.y, { ms: (cmd.sec || 0.6) * 1000 });
                    }
                    const from = nowSeconds();
                    while (!waited(from, cmd.sec)) yield;
                    break;
                }
                case 'move': {
                    const actor = actorNode(cmd.actor);
                    const target = moveTarget(cmd.to, actor);
                    if (actor && target) {
                        const from = nowSeconds();
                        if (typeof actor.moveTo === 'function') {
                            actor.moveTo(target.x, target.y, { speed: cmd.run ? 220 : 110 });
                        }
                        while (!arrived(actor, target) && nowSeconds() - from < MOVE_TIMEOUT) yield;
                    }
                    break;
                }
                case 'face': {
                    const actor = actorNode(cmd.actor);
                    if (actor) {
                        const to = String(cmd.to).toLowerCase();
                        if (to === 'left' || to === 'right') {
                            actor.scaleX(to === 'left' ? -1 : 1);
                        } else {
                            const point = pointOf(cmd.to);
                            if (point) actor.scaleX(point.x < actor.x ? -1 : 1);
                        }
                    }
                    break;
                }
                case 'anim': {
                    const actor = actorNode(cmd.actor);
                    if (actor && typeof actor.play === 'function') {
                        try { actor.play(cmd.clip, cmd.speed); } catch (e) { /* клипа нет */ }
                    }
                    break;
                }
                case 'ai': {
                    const actor = actorNode(cmd.actor);
                    if (actor) actor.attr('_story_ai_off', !cmd.on);
                    break;
                }
                case 'image': {
                    const u = ensureUi();
                    if (cmd.path === 'off') u.image.visible(false);
                    else u.image.sprite(cmd.path).visible(true);
                    const from = nowSeconds();
                    while (!waited(from, cmd.sec)) yield;
                    break;
                }
                case 'fade': {
                    // Затемнение — чёрный прямоугольник поверх сцены: появление
                    // или уход. Кадр отдаём, иначе переход был бы мгновенным.
                    const u = ensureUi();
                    const sec = cmd.sec > 0 ? cmd.sec : 0;
                    const from = nowSeconds();
                    for (;;) {
                        const k = sec > 0 ? Math.min(1, (nowSeconds() - from) / sec) : 1;
                        u.fade.alpha(cmd.out ? k : 1 - k);
                        if (k >= 1) break;
                        yield;
                    }
                    u.fade.alpha(cmd.out ? 1 : 0);
                    break;
                }
                case 'sound': {
                    if (ctx.sound && typeof ctx.sound.play === 'function') {
                        try { ctx.sound.play(cmd.path, { volume: 0.8 }); } catch (e) { /* нет файла */ }
                    }
                    break;
                }
                case 'objective': {
                    emit('story:objective', { text: cmd.text });
                    break;
                }
                default:
                    break;
            }
            index = next;
        }
    }

    // --- Запуск и остановка --------------------------------------------------

    function applyLock(on) {
        ctx.story_locked = !!on;
        emit('story:lock', { locked: !!on });
    }

    function finish(spec, script) {
        running = false;
        locked = false;
        task = null;
        applyLock(false);
        showUi(false);
        showBars(false);
        if (spec && typeof spec.done === 'function') spec.done();
        emit('story:end', { script });
    }

    function startRunning(script, spec) {
        const free = spec.free === undefined ? script.free : !!spec.free;
        const label = spec.label === undefined ? '' : String(spec.label);
        const startAt = label ? (labelIndex(script, label) || 0) : 0;

        running = true;
        locked = !free;
        showUi(true);
        showBars(!free);
        applyLock(locked);

        const done = () => finish(spec, script);
        const gen = exec(script, startAt);

        if (ctx.task && typeof ctx.task.each === 'function') {
            task = ctx.task.each(gen, { done });
        } else {
            // Без планировщика сценка всё равно должна пройти.
            const off = addUpdate(() => {
                const step = gen.next();
                if (step.done) { off(); done(); }
            });
            task = { abort: () => off() };
        }
        return true;
    }

    // --- Публичное пространство ---------------------------------------------

    const story = {
        /** Общие флаги сценок: видны во всех сценках игры. */
        flags,

        /** Идёт ли сценка. */
        running() { return running; },

        /** Отобрано ли у игрока управление (сценка без @free). */
        locked() { return locked; },

        /** Последняя показанная реплика: { who, text, emotion }. */
        last_line: null,

        /**
         * Объявить актёра: `$.story.actor('Некотян', '#companion')`. Принимает
         * селектор, узел или обёртку. Особые имена: player/игрок/я.
         */
        actor(name, target) {
            const key = String(name || '').trim().toLowerCase();
            if (!key) return story;
            if (target === undefined) return actors.get(key) || null;
            actors.set(key, target);
            return story;
        },

        /** Объявленные актёры: [{ name, target }]. */
        actors() {
            return [...actors.entries()].map(([name, target]) => ({ name, target }));
        },

        /** Разобрать текст, не играя: удобно проверить сценарий. */
        parse(text) { return parseStory(text); },

        /**
         * Играть сценку: путь к файлу, `{ text }` или разобранный сценарий.
         * `opts`: `{ label, free, done }`. false — если сценка уже идёт.
         */
        play(source, opts) {
            if (running) {
                ctx.log('$.story: сценка уже идёт — новый запуск пропущен');
                return false;
            }
            const spec = opts || {};
            let script = null;
            if (source && typeof source === 'object' && source.commands) {
                script = source;
            } else if (source && typeof source === 'object') {
                script = parseStory(source.text || '');
            } else {
                const fs = $.fs || ctx.fs;
                if (!fs || typeof fs.readText !== 'function') {
                    ctx.log('$.story.play: нет $.fs — передайте текст сценки');
                    return false;
                }
                const text = fs.readText(source, null);
                if (text === null || text === undefined) {
                    ctx.log(`$.story.play: не удалось прочитать «${source}»`);
                    return false;
                }
                script = parseStory(text);
            }
            for (const error of script.errors) ctx.log(`$.story: ${error}`);
            try {
                return startRunning(script, spec);
            } catch (error) {
                ctx.log('$.story.play упал: ' + (error && error.stack ? error.stack : error));
                running = false;
                locked = false;
                applyLock(false);
                throw error;
            }
        },

        /** Остановить сценку: реплики и полосы убираются, управление возвращается. */
        stop() {
            if (!running) return story;
            if (task && typeof task.abort === 'function') task.abort();
            finish({}, null);
            return story;
        },

        /** Проверить условие по флагам: та же логика, что в `if` сценария. */
        check(cond) { return checkCondition(cond, flags); },

        /** Поставить флаг вручную (из игры). */
        set(flag, value) {
            flags[String(flag)] = value;
            return story;
        },

        /** Сбросить флаги (новая игра). */
        resetFlags() {
            for (const key of Object.keys(flags)) delete flags[key];
            return story;
        },

        /**
         * Ответить за игрока: `$.story.choose(1)` выберет второй вариант.
         * Нужно тестам и автопилоту — тот же путь, что у нажатия кнопки.
         */
        choose(index) {
            chooser = Number(index) | 0;
            return story;
        },

        /** Ждёт ли сценка выбора варианта. */
        waitingChoice() { return chooser !== null; },

        /**
         * Листнуть реплику за игрока: как нажатие «дальше». Нужно тестам и
         * автопилоту.
         */
        advance() {
            advance_queued = true;
            return story;
        },

        /**
         * Автолистание: `$.story.auto(true)` — сценка идёт сама, реплики не
         * ждут игрока (демо, тесты, запись трейлера).
         */
        auto(on) {
            auto_advance = on === undefined ? true : !!on;
            return story;
        },

        /** Убрать облачка, у которых вышло время. */
        tick() { tickBubbles(); },
    };

    $.story = story;
    ctx.story = story;
    addUpdate(() => tickBubbles());
    return story;
}
