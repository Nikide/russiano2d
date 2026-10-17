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

/**
 * Compile a parsed .scene script into the shared Narrative IR.
 *
 * IR is presentation-agnostic: $.story feeds say/choice into $.dialog, timeline
 * and cutscene reuse the same dialog runtime. It is a plain data array so it can
 * be inspected, saved or validated without a fourth UI engine.
 */
export function compileStory(script) {
    const commands = script && Array.isArray(script.commands) ? script.commands : [];
    const labels = new Map();
    if (script && script.labels) for (const [name, index] of Object.entries(script.labels)) labels.set(index, name);
    const ir = [];
    for (let i = 0; i < commands.length; ++i) {
        const cmd = commands[i] || {};
        if (labels.has(i)) ir.push({ op: 'label', name: labels.get(i) });
        switch (cmd.op) {
            case 'say': {
                ir.push({ op: 'say', speaker: cmd.who || '', expression: cmd.emotion || '', text: cmd.text });
                const next = commands[i + 1];
                if (next && next.op === 'choices') {
                    ir.push(compileChoice(next));
                    i += 1;
                }
                break;
            }
            case 'choices':
                ir.push(compileChoice(cmd));
                break;
            case 'set':
                ir.push({ op: 'commit', key: String(cmd.flag), mode: cmd.mode || '=', value: cmd.value });
                break;
            case 'if':
                ir.push({ op: 'branch', condition: cmd.cond, goto: cmd.to });
                break;
            case 'goto':
                ir.push({ op: cmd.to === 'end' ? 'end' : 'goto', goto: cmd.to });
                break;
            case 'end':
                ir.push({ op: 'end' });
                break;
            case 'wait':
                ir.push({ op: 'wait', seconds: Number(cmd.sec) || 0 });
                break;
            case 'bubble':
                ir.push({ op: 'bubble', speaker: cmd.who || '', text: cmd.text, expression: cmd.emotion || '' });
                break;
            default:
                ir.push({ op: 'command', command: cmd.op, data: { ...cmd } });
                break;
        }
    }
    return ir;
}

function compileChoice(cmd) {
    const items = Array.isArray(cmd.items) ? cmd.items : [];
    return {
        op: 'choice',
        choices: items.map((item) => ({
            text: item.text,
            goto: item.to || null,
            commits: (item.sets || []).map((st) => ({
                key: String(st.flag), mode: st.mode || '=', value: st.value,
            })),
        })),
    };
}

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
    let story_lock = null;

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

    /**
     * Служебные узлы сценки — ЭКРАННЫЙ ОВЕРЛЕЙ (`<ui.*>`), а не мир-узлы.
     *
     * BASHNYA, пункт F2: кадр `image` был мир-спрайтом в мировых координатах,
     * поэтому уезжал вместе с камерой и проигрывал по глубине любому мир-узлу
     * (фон меню `#menu_bg`, depth 10, закрывал вступление целиком). Хуже:
     * затемнение создавалось НЕПРОЗРАЧНЫМ и рисовалось поверх кадра — при
     * запуске сценки из `enter()` кадр не был виден вовсе (замер: яркость
     * центра 0.0 при белом кадре, 240.0 после правки).
     *
     * Узлы `<ui.*>` рисуются в экранном проходе поверх мира: ни камера, ни
     * глубина мир-узлов на них не влияют. Порядок создания здесь = порядок
     * отрисовки, поэтому затемнение создаётся ПОСЛЕДНИМ и стартует прозрачным:
     * экран оно закрывает только по команде `fade out`.
     */
    function ensureUi() {
        if (ui) return ui;
        const bars = [];
        const bar_h = Math.max(1, Math.round(engine.height * LETTERBOX));
        const image = makeNode('<ui.image>', {
            id: '__story_image', w: engine.width, h: engine.height,
        }).at(engine.width / 2, engine.height / 2);
        for (const top of [true, false]) {
            const bar = makeNode('<ui.panel>', {
                id: top ? '__story_bar_top' : '__story_bar_bottom',
                w: engine.width, h: bar_h, color: '#000000',
            });
            bar.at(engine.width / 2, top ? bar_h / 2 : engine.height - bar_h / 2);
            bars.push(bar);
        }
        // Текст реплик и выборов принадлежит $.dialog: у story своего
        // текстового UI нет. Здесь остаются только кадр, полосы и затемнение.
        // Затемнение — последним: оно обязано быть выше кадра и полос.
        // Стартует прозрачным (0), иначе первый же показ сценки закрывает экран.
        const fade = makeNode('<ui.panel>', {
            id: '__story_fade', w: engine.width, h: engine.height, color: '#000000',
        }).at(engine.width / 2, engine.height / 2).alpha(0);

        ui = { bars, image, fade, visible: false };
        attachOverlay([image].concat(bars, [fade]));
        showUi(false);
        return ui;
    }

    /**
     * Прикрепить оверлей к корню интерфейса: порядок узлов = порядок отрисовки
     * (тем же способом это делает `$.timeline` для своего затемнения). Без
     * `$.ui` узлы всё равно рисуются — привязка лишь фиксирует порядок.
     */
    function attachOverlay(parts) {
        if (!$ || !$.ui || typeof $.ui.appendTo !== 'function') return;
        for (const part of parts) {
            try { part.appendTo($.ui); } catch (e) { /* интерфейса нет — не беда */ }
        }
    }

    function showUi(on) {
        const u = ensureUi();
        u.visible = !!on;
        for (const part of [u.image, u.fade]) {
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

    // --- Реплики: только через $.dialog --------------------------------------
    // У story нет своего текстового UI. Narrative IR/replики и выборы идут в
    // тот же runtime, что timeline и cutscene; здесь остаются актёры, камера,
    // кадры и ожидания.

    let line_seq = 0;
    let last_choice = null;
    let dialog_hooked = false;

    function dialogApi() { return $ && $.dialog; }

    // installStory() runs before installDialog() in api.js, so the choice
    // listener is attached lazily on the first dialogue, not at install time.
    function hookDialogChoices() {
        if (dialog_hooked) return;
        const d = dialogApi();
        if (!d || typeof d.on !== 'function') return;
        d.on('choice', (event) => { last_choice = event && event.index !== undefined ? event.index : null; });
        dialog_hooked = true;
    }

    function openDialogNode(who, text, emotion, items) {
        hookDialogChoices();
        const d = dialogApi();
        if (!d || typeof d.define !== 'function' || typeof d.play !== 'function') return false;
        const id = '__story_' + (++line_seq);
        const node = { text: String(text === undefined || text === null ? '' : text) };
        if (who) node.speaker = who;
        if (emotion) node.expression = emotion;
        if (items && items.length) node.choices = items.map((item) => ({ text: item.text }));
        d.define(id, { start: 'line', nodes: { line: node } });
        last_choice = null;
        return d.play(id, 'line');
    }

    function noteLine(who, text, emotion) {
        const info = { who: who || '', text, emotion: emotion || '' };
        story.last_line = info;
        emit('story:line', info);
    }

    /** Wait for the shared dialog runtime; never mutates gameplay state on skip. */
    function* waitOpenDialog() {
        const d = dialogApi();
        for (;;) {
            if (!d || typeof d.isOpen !== 'function' || !d.isOpen()) return;
            if (chooser !== null) {
                const index = Math.floor(Number(chooser));
                chooser = null;
                const choices = typeof d.choices === 'function' ? d.choices() : [];
                if (choices.length) d.choose(Math.max(0, Math.min(index, choices.length - 1)));
            }
            if (advance_queued) {
                advance_queued = false;
                if (typeof d.isTyping === 'function' && d.isTyping() && typeof d.skip === 'function') d.skip();
                else if (typeof d.next === 'function') d.next();
            }
            if (auto_advance) {
                // Story auto mode advances immediately (no 1.2s dialog auto
                // timer): the old story runtime had the same frame-based pace.
                if (typeof d.isTyping === 'function' && d.isTyping() && typeof d.skip === 'function') d.skip();
                else if (typeof d.next === 'function') d.next();
            }
            yield;
        }
    }

    /**
     * Play one say (optionally with attached choices) and return the chosen item.
     * `items` — DSL choices; their sets/to stay story-owned.
     */
    function* sayAndChoose(who, text, emotion, items) {
        const d = dialogApi();
        noteLine(who, text, emotion);
        if (!openDialogNode(who, text, emotion, items)) {
            // No dialog runtime: presentation is skipped, gameplay continues.
            yield;
            return items && items.length ? items[0] : null;
        }
        yield;
        yield* waitOpenDialog();
        if (!items || !items.length) return null;
        const index = last_choice === null ? 0 : last_choice;
        return items[Math.max(0, Math.min(index, items.length - 1))];
    }

    function applyChoice(chosen) {
        if (!chosen) return { to: '', sets: [] };
        for (const st of chosen.sets || []) applySet(st, flags);
        return chosen;
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
                    index = next;
                    let items = null;
                    if (index < script.commands.length && script.commands[index].op === 'choices') {
                        items = script.commands[index].items;
                        index += 1;
                    }
                    const chosen = yield* sayAndChoose(displayName(cmd.who, actor), cmd.text, cmd.emotion, items);
                    if (chosen) {
                        applyChoice(chosen);
                        flags._last_choice = items ? items.indexOf(chosen) : -1;
                        if (chosen.to === 'end') return;
                        if (chosen.to) {
                            const at = labelIndex(script, chosen.to);
                            if (at === null) {
                                ctx.log(`$.story: нет метки «${chosen.to}» — сценка закончена`);
                                return;
                            }
                            index = at;
                        }
                    }
                    continue;
                }
                case 'choices': {
                    const chosen = yield* sayAndChoose('', '', '', cmd.items);
                    applyChoice(chosen);
                    if (chosen && chosen.to === 'end') return;
                    if (chosen && chosen.to) {
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
        if ($ && $.dialog && typeof $.dialog.isOpen === 'function' && $.dialog.isOpen()
            && typeof $.dialog.close === 'function') {
            try { $.dialog.close(); } catch (e) { /* диалог уже закрыт */ }
        }
        if (story_lock && typeof story_lock.release === 'function') {
            story_lock.release('story end');
            story_lock = null;
        }
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
        if (!free && $ && $.input && typeof $.input.lock === 'function' && !story_lock)
            story_lock = $.input.lock('story');
        if (!free && $.dialog && typeof $.dialog.worldMode === 'function')
            $.dialog.worldMode('cinematic');

        // `done` получает признак отмены: если задача упала (исключение внутри
        // генератора), сценка не должна выглядеть как доигранная. Текст самой
        // ошибки уже печатает $.task — здесь важно не молчать о факте.
        const done = (aborted) => {
            if (aborted) {
                const why = task && task.error ? ` — ${task.error.message || task.error}` : '';
                ctx.log(`$.story: сценка прервана (задача упала)${why}`);
            }
            finish(spec, script);
        };
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

        /** Narrative IR: единая структура для story/timeline/cutscene. */
        compile(source) {
            const script = source && typeof source === 'object' && source.commands
                ? source : parseStory(String(source === undefined ? '' : source));
            return compileStory(script);
        },

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
