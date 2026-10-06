// ===========================================================================
// Юнит-тесты таймлайн-сцен (timeline.js) без движка.
//
// Проверяют то, ради чего модуль и написан: объявление сцены-таймлайна,
// порядок битов, паузы, реплики через $.dialog, выборы с флагами и переходами,
// условия и вложенные ветки, метки, тряску/вспышки, концовки и остановку.
//
// Заглушки повторяют то, что видит модуль в движке: узел — настоящий Node из
// core.js, обёртка — свои цепочные методы, $.dialog — настоящая подсистема
// (так проверяется стык «таймлайн ↔ диалог», а не два мока друг с другом).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/timeline_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import { installDialog, tickDialog } from '../../src/highlevel/dialog.js';
import { installTimeline, tickTimeline, conditionValue } from '../../src/highlevel/timeline.js';
import { installFont } from '../../src/highlevel/font.js';

// --- Заглушки ---------------------------------------------------------------

const keys = {};
const store = new Map();
const shakes = [];
const sounds = [];
const music = [];
const events = [];

/** Цепочная обёртка: то, чем игра пользуется в $. */
function chain(nodes) {
    const api = {
        nodes,
        length: nodes.length,
        get: (i) => nodes[i],
        each(fn) { nodes.forEach((n, i) => fn.call(api, i, n)); return api; },
        at(x, y) { nodes.forEach((n) => { n.x = x; n.y = y; }); return api; },
        size(w, h) { nodes.forEach((n) => { n.w = w; n.h = h; }); return api; },
        alpha(v) { nodes.forEach((n) => { n.alpha = v; }); return api; },
        color(v) { nodes.forEach((n) => { n.color = v; }); return api; },
        layer(v) { nodes.forEach((n) => { n.layer = v; }); return api; },
        sprite(v) { nodes.forEach((n) => n.setSprite(v)); return api; },
        text(v) { nodes.forEach((n) => { n.text = v; }); return api; },
        visible(v) { nodes.forEach((n) => { n.visible = v === undefined ? true : !!v; }); return api; },
        appendTo(parent) {
            const target = parent && parent.nodes ? parent.nodes[0] : parent;
            nodes.forEach((n) => { n.parent_node = target; });
            return api;
        },
        remove() {
            nodes.forEach((n) => {
                n.removed = true;
                const index = ctx.nodes.indexOf(n);
                if (index >= 0) ctx.nodes.splice(index, 1);   // как реестр движка
                if (n.attrs && n.attrs.id) ctx.byId.delete(n.attrs.id);
            });
            return api;
        },
        on() { return api; },
        off() { return api; },
        attr() { return api; },
        data() { return api; },
        set() { return api; },
    };
    return api;
}

function makeDollar() {
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return chain([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) {
            const node = new Node(m[1], attrs || {});
            if (attrs) {
                for (const key of Object.keys(attrs)) {
                    if (key === 'id' || key === 'frames') continue;
                    try { node.set(key, attrs[key]); } catch (e) { /* атрибут — в attrs */ }
                }
            }
            return chain([node]);
        }
        return chain(query(arg));
    };
    $.ui = chain([]);
    $.world = chain([]);
    $.gfx = { size: () => ({ w: 1280, h: 720 }) };
    $.camera = {
        shake: (power, ms) => { shakes.push([power, ms]); return $.camera; },
        at: () => $.camera, zoom: () => $.camera, zoomTo: () => $.camera,
        unfollow: () => $.camera, limits: () => $.camera, follow: () => $.camera,
    };
    $.sound = {
        play: (path) => { sounds.push(path); return 0; },
        music: (path) => { music.push(path); return $.sound; },
        stopMusic: () => $.sound,
        crossfade: (path) => { music.push(path); return $.sound; },
        musicVolume: () => $.sound,
        volume: () => $.sound,
    };
    $.store = {
        get: (k, fallback) => (store.has(String(k)) ? store.get(String(k)) : fallback),
        set: (k, v) => { store.set(String(k), v); return $.store; },
        has: (k) => store.has(String(k)),
        keys: () => [...store.keys()],
        all: () => Object.fromEntries(store),
        clear: () => { store.clear(); return $.store; },
        save: () => $.store,
        autoSave: () => $.store,
    };
    $.input = { pressed: (k) => !!keys[k], down: (k) => !!keys[k], mouse: () => ({ x: -999, y: -999 }) };
    $.dialog = null;                     // ставится installDialog ниже
    $.font = null;
    $.fs = { exists: () => false };
    $.window = { on: () => {} };
    $.color = (value) => value;
    $.agent = { expose: () => {} };
    $.log = (msg) => ctx.log(String(msg));
    $.i18n = { has: () => false, tr: (key) => String(key) };
    $.scenes = new Map();
    $.current_scene = null;
    $.scene = {
        add(name, def) { $.scenes.set(name, def); return $.scene; },
        remove(name) { $.scenes.delete(name); return $.scene; },
        has: (name) => $.scenes.has(name),
        names: () => [...$.scenes.keys()],
        current: () => $.current_scene,
        load(name) {
            const def = $.scenes.get(name);
            if (!def) { $.current_scene = name; return $.scene; }
            if (def.exit && $.current_scene) def.exit();
            $.current_scene = name;
            if (def.enter) def.enter($, {});
            return $.scene;
        },
    };
    // Твин-заглушка: значение применяется сразу, finished() — синхронный
    // thenable, поэтому ожидание бита продолжается на следующем tickTimeline.
    $.tweenOf = (target) => {
        const handlers = { finished: [] };
        const tween = {
            property(prop, to) { target[prop] = to; return tween; },
            method(fn, from, to, seconds) { if (fn) fn(to); return tween; },
            chain() { return tween; },
            interval() { return tween; },
            callback(fn) { if (fn) fn(); return tween; },
            loops() { return tween; },
            on(name, fn) { if (name === 'finished' && typeof fn === 'function') handlers.finished.push(fn); return tween; },
            kill() { return tween; },
            // Синхронный thenable: бит продолжается на следующем tickTimeline.
            finished() {
                const chainable = {
                    then: (cb) => {
                        for (const fn of handlers.finished.splice(0)) fn(tween);
                        if (cb) cb(tween);
                        return chainable;
                    },
                    catch: () => chainable,
                };
                return chainable;
            },
        };
        return tween;
    };
    $.timeline = null;
    $.animatedTimelineScene2d = null;
    $._dispatchGlobal = (node, name, data) => { events.push({ name, data }); };
    return $;
}

ctx.$ = { _dispatchGlobal() {} };

const $ = makeDollar();
installFont($);
$.dialog = installDialog($);
installTimeline($);

const real_log = ctx.log;
let logs = [];
ctx.log = (msg) => { logs.push(String(msg)); };

function reset() {
    if ($.dialog.isOpen()) $.dialog.close();
    if ($.timeline.running()) $.timeline.stop('test');
    ctx.nodes.length = 0;
    ctx.byId.clear();
    logs = [];
    shakes.length = 0;
    sounds.length = 0;
    music.length = 0;
    events.length = 0;
    store.clear();
    for (const k of Object.keys(keys)) delete keys[k];
    $.dialog.speed(40);
    $.timeline.auto(false);
}

/** Кадр движка: диалог печатает, таймлайн тикает, «фронты» нажатий гаснут. */
function frame(dt) {
    tickDialog(dt === undefined ? 1 / 60 : dt);
    tickTimeline(dt === undefined ? 1 / 60 : dt);
    for (const k of Object.keys(keys)) delete keys[k];
}

function frames(count, dt) {
    for (let i = 0; i < count; i++) frame(dt);
}

/** Промотать до конца прогона: не больше limit кадров, иначе тест висит. */
function runUntil(limit) {
    for (let i = 0; i < (limit || 4000); i++) {
        if (!$.timeline.running()) return i;
        frame();
    }
    return -1;
}

/** Допечатать реплику и нажать «дальше». */
function advance() {
    for (let i = 0; i < 400 && $.dialog.isTyping(); i++) frame();
    const before = $.dialog.isOpen() ? $.dialog.fullText() + '#' + $.dialog.node() : '';
    $.dialog.next();
    // Ждём смены реплики (или закрытия диалога): биты, ждущие твин, идут
    // следующим кадром, и фиксированное число кадров тут — гадание.
    for (let i = 0; i < 80; i++) {
        frame();
        const now = $.dialog.isOpen() ? $.dialog.fullText() + '#' + $.dialog.node() : '';
        if (now !== before) break;
    }
}

function defineSimple(script, extra) {
    const spec = Object.assign({
        id: 'vn',
        scene: 'vn',
        locations: {
            room: { bg: 'art/room.png', music: 'music/room.ogg', title: 'Комната' },
            roof: { bg: 'art/roof.png', music: 'music/roof.ogg', title: 'Крыша', mood: { color: '#ff8800', alpha: 0.3 } },
        },
        cast: { russi: { name: 'Руси-тян', poses: { neutral: 'art/n.png', angry: 'art/a.png' }, x: 0.6, height: 0.9 } },
        script,
    }, extra || {});
    $.animatedTimelineScene2d(spec);
    $.scene.load('vn');
    // Сцена строится на входе, а первый бит выполняется в кадре — как в движке.
    // Три кадра: хватает, чтобы прошли пауза и биты, ждущие твин (вход героя).
    frames(3);
    return spec;
}

// --- Чистые условия ---------------------------------------------------------

test('conditionValue понимает функцию, boolean, флаг и сравнение', () => {
    eq(conditionValue(undefined), true, 'нет условия — ветка выполняется');
    eq(conditionValue(true), true);
    eq(conditionValue(() => 1 + 1 === 2), true);
    eq(conditionValue(() => false), false);
    store.set('has_pass', true);
    eq(conditionValue('has_pass'), true);
    eq(conditionValue('!has_pass'), false);
    eq(conditionValue('nope'), false);
    store.set('trust', 3);
    eq(conditionValue('trust >= 2'), true);
    eq(conditionValue('trust >= 5'), false);
    eq(conditionValue('trust == 3'), true);
    eq(conditionValue('trust != 3'), false);
    eq(conditionValue('trust < 4'), true);
    store.set('route', 'love');
    eq(conditionValue("route == 'love'"), true, 'строковое сравнение в кавычках');
    eq(conditionValue('route == "hate"'), false);
});

// --- Объявление и запуск ----------------------------------------------------

test('animatedTimelineScene2d регистрирует сцену и диалог', () => {
    reset();
    defineSimple([{ say: 'Привет.' }]);
    truthy($.scene.has('vn'), 'сцена появилась');
    truthy($.timeline.has('vn'), 'таймлайн в реестре');
    eq($.timeline.list().join(','), 'vn');
    eq($.timeline.current(), 'vn', 'прогон стартовал при входе в сцену');
    truthy($.dialog.isOpen(), 'реплика открылась через $.dialog');
    eq($.dialog.speaker(), 'Руси-тян', 'говорит героиня по умолчанию');
});

test('биты идут по порядку: локация, показ героя, реплика', () => {
    reset();
    defineSimple([
        { location: 'room' },
        { show: 'russi', from: 'left' },
        { say: 'Бака!' },
    ]);
    const state = $.timeline.state();
    eq(state.location, 'room', 'локация применена до реплики');
    eq(state.actors.length, 1);
    eq(state.actors[0].visible, true, 'герой показан');
    eq(state.waiting, 'say', 'ждём нажатия игрока');
    eq($.dialog.fullText(), 'Бака!');
});

test('пауза { wait } держит биты, пока не выйдет время', () => {
    reset();
    defineSimple([{ wait: 500 }, { say: 'Позже.' }]);
    frames(5);
    falsy($.dialog.isOpen(), 'на пятнадцати кадрах пауза ещё не прошла');
    eq($.timeline.state().waiting, 'wait');
    frames(40);
    truthy($.dialog.isOpen(), 'через полсекунды реплика открылась');
});

test('advance() доводит линейный скрипт до конца', () => {
    reset();
    defineSimple([{ say: 'Раз.' }, { say: 'Два.' }, { say: 'Три.' }]);
    advance();
    truthy($.dialog.fullText().indexOf('Два') >= 0, 'вторая реплика');
    advance();
    truthy($.dialog.fullText().indexOf('Три') >= 0, 'третья реплика');
    advance();
    falsy($.dialog.isOpen(), 'диалог закрылся на конце скрипта');
    falsy($.timeline.running(), 'прогон завершился');
});

// --- Выборы, флаги, ветки ---------------------------------------------------

test('выбор варианта ставит флаги и уводит на метку', () => {
    reset();
    defineSimple([
        { say: 'Тебе нравится JS?' },
        { choose: [
            { text: 'Да', goto: 'love', add: { trust: 2 } },
            { text: 'Нет', goto: 'hate', set: { route: 'hate' } },
        ] },
        { label: 'love' },
        { say: 'Я так и знала!' },
        { label: 'hate' },
        { say: 'Бака.' },
    ]);
    advance();
    eq($.dialog.choices().length, 2, 'варианты показаны');
    $.dialog.choose(0);
    frames(3);
    eq(store.get('trust'), 2, 'флаг add посчитан');
    eq($.dialog.fullText(), 'Я так и знала!', 'переход на метку love');
});

test('ветка if/else выбирается по сравнению флага', () => {
    reset();
    store.set('trust', 3);
    defineSimple([
        { if: 'trust >= 2', then: [{ say: 'Хорошая ветка.' }], else: [{ say: 'Плохая ветка.' }] },
    ]);
    eq($.dialog.fullText(), 'Хорошая ветка.');
    reset();
    store.set('trust', 0);
    defineSimple([
        { if: 'trust >= 2', then: [{ say: 'Хорошая ветка.' }], else: [{ say: 'Плохая ветка.' }] },
    ]);
    eq($.dialog.fullText(), 'Плохая ветка.');
});

test('после ветки прогон продолжается следующим битом', () => {
    reset();
    store.set('trust', 0);
    defineSimple([
        { if: 'trust >= 2', then: [{ say: 'Тёплое.' }], else: [{ say: 'Холодное.' }] },
        { say: 'А это уже после ветки.' },
    ]);
    advance();
    eq($.dialog.fullText(), 'А это уже после ветки.');
});

test('метка внутри ветки находится и не ломает путь', () => {
    reset();
    store.set('trust', 0);
    defineSimple([
        { goto: 'inside' },
        { say: 'Сюда не должны попасть.' },
        { if: true, then: [
            { label: 'inside' },
            { say: 'Внутри ветки.' },
        ] },
        { say: 'После ветки.' },
    ]);
    eq($.dialog.fullText(), 'Внутри ветки.');
    advance();
    eq($.dialog.fullText(), 'После ветки.');
});

test('вложенные ветки выполняются в порядке вложения', () => {
    reset();
    store.set('a', 1);
    store.set('b', 1);
    defineSimple([
        { if: 'a == 1', then: [
            { say: 'внешняя' },
            { if: 'b == 1', then: [{ say: 'внутренняя' }] },
        ] },
        { say: 'хвост' },
    ]);
    advance();
    eq($.dialog.fullText(), 'внутренняя');
    advance();
    eq($.dialog.fullText(), 'хвост');
});

// --- Герой, экран, звук -----------------------------------------------------

test('{ pose } меняет спрайт героя, { anim } проигрывает акцент', () => {
    reset();
    defineSimple([
        { show: 'russi' },
        { pose: 'angry' },
        { anim: 'bounce', wait: false },
        { say: 'Хм.' },
    ]);
    const state = $.timeline.state();
    eq(state.actors[0].pose, 'angry');
    truthy(events.some((e) => e.name === 'timeline:anim'), 'событие акцента отправлено');
});

test('{ shake } трясёт камеру, { flash } и { fade } не ломают прогон', () => {
    reset();
    defineSimple([
        { shake: 12, ms: 400 },
        { flash: { color: '#ff0000', alpha: 0.5, ms: 200 } },
        { fade: '#000000', ms: 300 },
        { fade: null, ms: 300 },
        { say: 'После вспышек.' },
    ]);
    eq(shakes.length, 1, 'камера тряхнула один раз');
    eq(shakes[0][0], 12);
    eq(shakes[0][1], 400);
    frames(80);
    eq($.dialog.fullText(), 'После вспышек.');
});

test('{ sfx } и локация с музыкой доходят до $.sound', () => {
    reset();
    defineSimple([
        { location: 'room' },
        { sfx: 'sfx/hit.ogg' },
        { say: 'Тук.' },
    ]);
    truthy(sounds.indexOf('sfx/hit.ogg') >= 0, 'звук проигран');
    truthy(music.length >= 1, 'музыка локации запущена');
});

test('{ show } из-за края и { hide } управляют видимостью', () => {
    reset();
    defineSimple([
        { show: 'russi', from: 'left', ms: 200 },
        { hide: 'russi', ms: 200 },
        { wait: 5000 },                     // прогон жив: проверяем середину, а не конец
    ]);
    frames(20);
    eq($.timeline.state().actors[0].visible, false, 'после hide герой скрыт');
    // Реплика возвращает героиню на сцену: молча говорить в пустоту она не станет.
    reset();
    defineSimple([{ hide: 'russi' }, { say: 'Я тут.' }, { wait: 5000 }]);
    frames(20);
    eq($.timeline.state().actors[0].visible, true, 'реплика показывает героиню обратно');
});

test('dialogTheme красит панель, имя и кнопки выбора', () => {
    reset();
    defineSimple([{ say: 'Привет.' }], {
        dialogTheme: { panel: '#0b1220e6', speaker: '#ffb3d9', text: '#eef3ff',
                       choice: '#1b2436f0', choiceHover: '#3b4a72f0' },
    });
    const panel = query('#__dialog')[0];
    truthy(panel, 'панель диалога существует');
    eq(panel.color, '#0b1220e6', 'фон панели взят из темы');
    const speaker = query('#__dialog_speaker')[0];
    eq(speaker.color, '#ffb3d9', 'имя говорящего перекрашено');
    const line = query('#__dialog_line0')[0];
    eq(line.color, '#eef3ff', 'текст реплики перекрашен');
    const choice = query('#__dialog_choice0')[0];
    eq(choice.hover_color, '#3b4a72f0', 'подсветка выбора перекрашена');
});

test('цвета кнопок выбора живут в кадре, а не один тик', () => {
    reset();
    defineSimple([{ choose: [ { text: 'Да' }, { text: 'Нет' } ] }], {
        dialogTheme: { choice: '#1b2436f0', choiceHover: '#3b4a72f0' },
    });
    const first = query('#__dialog_choice0')[0];
    const second = query('#__dialog_choice1')[0];
    eq(first.color, '#3b4a72f0', 'подсвечен первый вариант');
    eq(second.color, '#1b2436f0', 'второй — обычным цветом');
    $.dialog.focusChoice(1);
    frame();
    eq(second.color, '#3b4a72f0', 'подсветка переехала на второй вариант');
    eq(first.color, '#1b2436f0');
});

test('битая тема не мешает реплике открыться', () => {
    reset();
    defineSimple([{ say: 'Живая реплика.' }], { dialogTheme: { panel: null, text: '#fff' } });
    truthy($.dialog.isOpen(), 'диалог открылся');
    eq($.dialog.fullText(), 'Живая реплика.');
});

// --- Концовки ---------------------------------------------------------------

test('{ ending } ставит флаг, шлёт события и останавливает прогон', () => {
    reset();
    defineSimple([
        { say: 'Последний вопрос.' },
        { ending: { id: 'love', title: 'Хорошая концовка', text: 'Она влюбилась.' } },
        { say: 'Этот бит не должен выполниться.' },
    ]);
    advance();
    falsy($.timeline.running(), 'прогон остановлен');
    eq(store.get('ending:love'), true, 'концовка записана в $.store');
    truthy(events.some((e) => e.name === 'timeline:ending' && e.data.id === 'love'), 'событие ending');
    eq($.timeline.state().ending, 'love', 'состояние помнит концовку');
    eq($.timeline.state().running, false);
});

test('концовка ставит карточку и реагирует на ввод', () => {
    reset();
    defineSimple([
        { ending: { id: 'hate', mood: 'bad', title: 'Плохо', text: 'Она ушла.' } },
    ]);
    truthy(query('#__tl_ending_title').length > 0, 'карточка концовки создана');
    keys.space = true;
    frame();
    truthy($.timeline.running(), 'Space начинает прогон заново');
    eq($.timeline.current(), 'vn');
});

// --- Управление -------------------------------------------------------------

test('программный перезапуск убирает карточку концовки', () => {
    reset();
    defineSimple([
        { say: 'Последний вопрос.' },
        { ending: { id: 'love', title: 'Финал', text: 'Текст.' } },
    ]);
    advance();
    truthy($.timeline.ended(), 'концовка достигнута');
    eq($.timeline.current(), 'vn', 'current() помнит прогон и после концовки');
    const before = query('#__tl_ending_title')[0];
    truthy(before, 'карточка концовки создана');

    $.timeline.play('vn');
    frames(3);
    const after = query('#__tl_ending_title')[0];
    falsy(after, 'старая карточка убрана: финальный экран не висит над новым прогоном');
    truthy($.timeline.running(), 'новый прогон идёт и ждёт реплику');
    eq($.dialog.fullText(), 'Последний вопрос.', 'прогон начался с начала');
});

test('$.timeline.stop закрывает диалог и снимает прогон', () => {
    reset();
    defineSimple([{ say: 'Долгая история.' }]);
    $.timeline.stop('test');
    falsy($.timeline.running());
    falsy($.dialog.isOpen());
});

test('$.timeline.play перезапускает прогон с начала', () => {
    reset();
    defineSimple([{ say: 'Раз.' }, { say: 'Два.' }]);
    advance();
    eq($.dialog.fullText(), 'Два.');
    $.timeline.play('vn');
    frames(3);
    eq($.dialog.fullText(), 'Раз.', 'прогон начался заново');
});

test('авто-режим сам листает реплики', () => {
    reset();
    const said = [];
    $.timeline.on('say', (event) => said.push(event.text));
    defineSimple([{ say: 'Раз.' }, { say: 'Два.' }]);
    $.timeline.auto(100);
    frames(80);
    $.timeline.auto(false);
    eq(said.join('|'), 'Раз.|Два.', 'обе реплики пролистались сами');
    falsy($.timeline.running(), 'без нажатий прогон дошёл до конца');
});

test('state() описывает прогон для агента и тестов', () => {
    reset();
    defineSimple([{ location: 'room' }, { show: 'russi' }, { pose: 'angry' }, { say: 'Смотри.' }]);
    const state = $.timeline.state();
    eq(state.id, 'vn');
    eq(state.scene, 'vn');
    eq(state.location, 'room');
    eq(state.waiting, 'say');
    truthy(state.beats >= 4, 'биты посчитаны');
    eq(state.actors[0].who, 'russi');
    truthy(typeof state.flags === 'object');
});

test('неизвестная метка не роняет прогон, а пишет в лог', () => {
    reset();
    defineSimple([{ goto: 'нет-такой' }, { say: 'Продолжаем.' }]);
    truthy(logs.some((l) => l.indexOf('нет-такой') >= 0), 'метка попала в лог');
    truthy($.timeline.running(), 'прогон жив');
});

finish();
