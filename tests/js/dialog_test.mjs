// ===========================================================================
// Юнит-тест диалогов (dialog.js) без движка.
//
// Проверяет ветвление по выборам, условия (if) на репликах и выборах,
// печатную машинку с skip(), страницы текста, ключи $.i18n, портрет и имя,
// события start/line/choice/end и поведение на неизвестной реплике.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/dialog_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import {
    installDialog, tickDialog, conditionValue, visibleChoices,
    revealText, advanceTyping, wrapDialogText,
} from '../../src/highlevel/dialog.js';
import { installFont } from '../../src/highlevel/font.js';

// --- Мок $, ввода и «словаря» i18n -----------------------------------------

const keys = {};
const mouse = { x: -999, y: -999 };
let blurred = 0;
const dict = new Map([['dlg.hello', 'Привет, {name}!']]);

function makeDollar() {
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
    $.ui = { blur() { blurred++; } };
    $.gfx = { size: () => ({ w: 800, h: 600 }) };
    $.input = {
        pressed: (k) => !!keys[k],
        down: () => false,
        mouse: () => mouse,
    };
    $.i18n = {
        has: (key) => dict.has(String(key)),
        tr: (key, params) => String(dict.get(String(key))).replace(/\{(\w+)\}/g,
            (whole, name) => (params && params[name] !== undefined ? params[name] : whole)),
    };
    const store = new Map();
    $.store = {
        get: (key, fallback) => (store.has(String(key)) ? store.get(String(key)) : fallback),
        set: (key, value) => { store.set(String(key), value); return $.store; },
        has: (key) => store.has(String(key)),
        clear: () => store.clear(),
    };
    return $;
}

// Ядро рассылает глобальные события через ctx.$ — в тесте он не нужен.
ctx.$ = { _dispatchGlobal() {} };

const $ = makeDollar();
installFont($);
const dialog = installDialog($);

const real_log = ctx.log;
let logs = [];
ctx.log = (msg) => { logs.push(String(msg)); };

function reset() {
    if (dialog.isOpen()) dialog.close();
    ctx.nodes.length = 0;
    ctx.byId.clear();
    logs = [];
    blurred = 0;
    for (const k of Object.keys(keys)) delete keys[k];
    mouse.x = -999;
    mouse.y = -999;
    $.store.clear();
    dialog.flag('has_pass', undefined);
    dialog.flag('friendly', undefined);
    dialog.speed(40);
}

/** Кадр: печать + ввод, «фронты» нажатий сбрасываются, как в движке. */
function frame(dt) {
    tickDialog(dt === undefined ? 1 / 60 : dt);
    for (const k of Object.keys(keys)) delete keys[k];
}

/** Промотать печатную машинку до конца текущей страницы. */
function typeOut() {
    for (let i = 0; i < 600 && dialog.isTyping(); i++) frame(1 / 60);
}

const GUARD = {
    start: 'hello',
    nodes: {
        hello: {
            speaker: 'Стражник', portrait: 'art/guard.png',
            text: 'Стой! Кто идёт?',
            choices: [
                { text: 'Я свой', to: 'pass', if: 'has_pass' },
                { text: 'Уйти', to: null, do: () => $.store.set('left', true) },
            ],
        },
        pass: { text: 'Проходи.', to: 'bye' },
        bye: { text: 'Не задерживайся.', to: null },
    },
};

// --- Чистые помощники ------------------------------------------------------

test('conditionValue понимает функцию, boolean и строку-флаг', () => {
    eq(conditionValue(undefined, () => false), true, 'нет условия — реплика видна');
    eq(conditionValue(true, () => false), true);
    eq(conditionValue(() => 1 + 1 === 2, null), true);
    eq(conditionValue(() => false, null), false);
    eq(conditionValue('has_pass', (n) => n === 'has_pass'), true);
    eq(conditionValue('has_pass', () => undefined), false);
});

test('исключение в условии считается ложным и попадает в лог', () => {
    reset();
    eq(conditionValue(() => { throw new Error('бум'); }, null), false);
    eq(logs.length, 1);
    truthy(logs[0].includes('бум'));
});

test('visibleChoices сохраняет исходные индексы выборов', () => {
    const line = { choices: [{ text: 'a' }, { text: 'b', if: false }, { text: 'c' }] };
    const list = visibleChoices(line, () => undefined);
    eq(list.length, 2);
    eq(list[0].index, 0);
    eq(list[1].index, 2, 'index — позиция в исходном массиве, а не на экране');
    eq(list[0].to, undefined);
});

test('revealText и advanceTyping считают символы, а не байты', () => {
    eq(revealText('привет', 3), 'при');
    eq(revealText('привет', 99), 'привет');
    eq(revealText('аbc', 0), '');
    eq(advanceTyping(0, 10, 40, 0.1), 4);
    eq(advanceTyping(8, 10, 40, 1), 10, 'дальше конца не уходит');
});

test('wrapDialogText переносит по словам и режет длинное слово', () => {
    const measure = (s) => String(s).length * 10;
    const lines = wrapDialogText('раз два три четыре', 70, measure);
    eq(lines.join('|'), 'раз два|три|четыре');
    const long = wrapDialogText('аааааааааа', 30, measure);
    eq(long.join('|'), 'ааа|ааа|ааа|а', 'слово шире строки режется по символам');
    eq(wrapDialogText('текст', 0, measure).length, 1, 'без ширины — одна строка');
});

// --- Запуск и состав реплики ----------------------------------------------

test('define/play: реплика, имя и портрет открываются', () => {
    reset();
    dialog.define('guard', GUARD);
    eq(dialog.has('guard'), true);
    eq(dialog.list().join(','), 'guard');
    eq(dialog.play('guard'), true);
    eq(dialog.isOpen(), true);
    eq(dialog.definition(), 'guard');
    eq(dialog.node(), 'hello');
    eq(dialog.speaker(), 'Стражник');
    eq(dialog.portrait(), 'art/guard.png');
    eq(dialog.fullText(), 'Стой! Кто идёт?');
    eq(blurred, 1, 'диалог снимает фокус с контролов widgets.js');
    truthy($('#__dialog'), 'панель диалога создана');
    truthy($('#__dialog_speaker').get(0).visible);
    truthy($('#__dialog_portrait').get(0).visible);
});

test('define отклоняет пустое имя и описание без nodes', () => {
    reset();
    dialog.define('', { nodes: {} });
    dialog.define('bad', { start: 'x' });
    eq(logs.length, 2);
    eq(dialog.has('bad'), false);
});

test('play по одному аргументу находит реплику последнего диалога', () => {
    reset();
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.play('pass');
    eq(dialog.node(), 'pass');
    eq(dialog.fullText(), 'Проходи.');
});

test('play неизвестного диалога: false, лог, диалог не открыт', () => {
    reset();
    eq(dialog.play('нет-такого'), false);
    eq(dialog.isOpen(), false);
    truthy(logs.some((m) => m.includes('нет-такого')));
});

// --- Печатная машинка ------------------------------------------------------

test('печатная машинка печатает по буквам и доходит до конца', () => {
    reset();
    dialog.define('guard', GUARD);
    dialog.speed(10);          // 10 символов в секунду — предсказуемо
    dialog.play('guard');
    eq(dialog.isTyping(), true);
    eq(dialog.text(), '');
    frame(0.5);                // 5 символов
    eq(dialog.text(), 'Стой!');
    typeOut();
    eq(dialog.isTyping(), false);
    eq(dialog.text(), 'Стой! Кто идёт?');
    eq($('#__dialog_line0').get(0).text, 'Стой! Кто идёт?', 'текст доехал до узла');
});

test('skip() допечатывает страницу, next() сначала допечатывает, потом идёт дальше', () => {
    reset();
    dialog.define('guard', GUARD);
    dialog.speed(5);
    dialog.play('guard');
    frame(0.2);
    eq(dialog.skip(), true);
    eq(dialog.text(), 'Стой! Кто идёт?');
    eq(dialog.isTyping(), false);
    eq(dialog.skip(), false, 'второй skip — no-op');

    // next() на печатающейся реплике — досрочное допечатывание.
    dialog.define('chain', { nodes: { a: { text: 'Раз', next: 'b' }, b: { text: 'Два', to: null } } });
    dialog.play('chain');
    frame(0.01);
    truthy(dialog.isTyping());
    eq(dialog.next(), true);
    eq(dialog.node(), 'a', 'next() сначала допечатал, а не ушёл вперёд');
    eq(dialog.isTyping(), false);
    dialog.next();
    eq(dialog.node(), 'b');
});

test('реплики с to/next идут цепочкой, последняя закрывает диалог', () => {
    reset();
    const lines = [];
    const ends = [];
    dialog.on('line', (e) => lines.push(e.id));
    dialog.on('end', (e) => ends.push(e.reason));
    dialog.define('chain', {
        nodes: {
            hello: { text: 'Стой! Кто идёт?', to: 'pass' },
            pass: { text: 'Проходи.', next: 'bye' },
            bye: { text: 'Не задерживайся.', to: null },
        },
    });
    dialog.play('chain');
    dialog.skip();
    dialog.next();                       // hello → pass
    eq(dialog.node(), 'pass');
    dialog.skip();                       // «Проходи.» печатается — допечатываем
    dialog.next();                       // pass → bye (через next)
    eq(dialog.node(), 'bye');
    eq(dialog.fullText(), 'Не задерживайся.');
    dialog.skip();
    dialog.next();                       // to: null → конец
    eq(dialog.isOpen(), false);
    eq(ends.join(','), 'end');
    eq(lines.join(','), 'hello,pass,bye');
    eq(dialog.listenerCount('end'), 1);
});

test('массив text — это страницы, next() листает их', () => {
    reset();
    dialog.define('book', { nodes: { a: { text: ['Страница 1', 'Страница 2'], to: null } } });
    dialog.play('book');
    eq(dialog.pageCount(), 2);
    eq(dialog.page(), 0);
    dialog.skip();
    dialog.next();
    eq(dialog.page(), 1);
    eq(dialog.fullText(), 'Страница 2');
    dialog.skip();
    dialog.next();
    eq(dialog.isOpen(), false, 'после последней страницы диалог закрылся');
});

// --- Выборы и условия ------------------------------------------------------

test('условие ложно → выбора нет, реплика-узел пропускается', () => {
    reset();
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.skip();
    eq(dialog.choices().length, 1, 'вариант «Я свой» скрыт: флага нет');
    eq(dialog.choices()[0].text, 'Уйти');

    dialog.flag('has_pass', true);
    dialog.play('guard');
    dialog.skip();
    eq(dialog.choices().length, 2);
    eq(dialog.choices()[0].index, 0, 'index — позиция в исходном массиве');

    // Узел с ложным if не показывается: переход идёт по его to.
    dialog.define('branch', {
        nodes: {
            a: { text: 'Начало', to: 'secret' },
            secret: { text: 'Секрет', if: 'has_pass', to: 'final' },
            final: { text: 'Финал', to: null },
        },
    });
    dialog.flag('has_pass', undefined);
    dialog.play('branch');
    dialog.skip();
    dialog.next();
    eq(dialog.node(), 'final', 'реплика secret пропущена');
});

test('choose(i) идёт по ветке, выполняет do и шлёт choice', () => {
    reset();
    dialog.flag('has_pass', true);
    const chosen = [];
    dialog.on('choice', (e) => chosen.push(e.index + ':' + e.text + ':' + e.to));
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.skip();
    eq(dialog.choose(0), true);
    eq(dialog.node(), 'pass', 'выбран «Я свой» — переход на pass');
    eq(chosen.join(','), '0:Я свой:pass');

    dialog.play('guard');
    dialog.skip();
    eq(dialog.choose(1), true, 'второй вариант — «Уйти»');
    eq($.store.get('left'), true, 'do выбора выполнился');
    eq(dialog.isOpen(), false, 'to: null завершает диалог');
});

test('chooseByText выбирает по тексту, неизвестный — лог и false', () => {
    reset();
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.skip();
    eq(dialog.chooseByText('Уйти'), true);
    eq(dialog.isOpen(), false, 'вариант с to: null завершает диалог');

    dialog.flag('has_pass', true);
    dialog.play('guard');
    dialog.skip();
    eq(dialog.chooseByText('я свой'), true, 'регистр не важен');
    eq(dialog.node(), 'pass');
    eq(dialog.chooseByText('нет такого'), false);
    truthy(logs.some((m) => m.includes('нет такого')));
});

test('choose вне диапазона не ломает диалог', () => {
    reset();
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.skip();
    eq(dialog.choose(5), false);
    eq(dialog.node(), 'hello');
    truthy(logs.some((m) => m.includes('нет выбора с номером 5')));
});

test('выбор без to завершает диалог и шлёт end', () => {
    reset();
    const ends = [];
    dialog.on('end', (e) => ends.push(e.reason));
    dialog.define('d', { nodes: { a: { text: 'Да или нет?', choices: [{ text: 'Да' }] } } });
    dialog.play('d');
    dialog.skip();
    dialog.choose(0);
    eq(dialog.isOpen(), false);
    eq(ends.join(','), 'end');
});

// --- i18n, портреты, события ----------------------------------------------

test('ключ $.i18n переводится, литерал остаётся как есть', () => {
    reset();
    dialog.vars({ name: 'Игрок' });
    dialog.define('i18n', {
        nodes: {
            a: { speaker: 'dlg.hello', text: 'dlg.hello', to: 'b' },
            b: { text: 'Просто текст', to: null },
        },
    });
    dialog.play('i18n');
    dialog.skip();
    eq(dialog.fullText(), 'Привет, Игрок!');
    eq(dialog.speaker(), 'Привет, Игрок!');
    dialog.next();
    eq(dialog.fullText(), 'Просто текст');
});

test('text-функция берёт данные из игры в момент показа', () => {
    reset();
    $.store.set('name', 'Мира');
    dialog.vars({});
    dialog.define('dyn', { nodes: { a: { text: () => 'Привет, ' + $.store.get('name'), to: null } } });
    dialog.play('dyn');
    dialog.skip();
    eq(dialog.fullText(), 'Привет, Мира');
});

test('события start/typed/close приходят подписчикам', () => {
    reset();
    const seen = [];
    dialog.on('start', (e) => seen.push('start:' + e.node));
    dialog.on('typed', () => seen.push('typed'));
    dialog.on('close', (e) => seen.push('close:' + e.reason));
    dialog.define('guard', GUARD);
    dialog.speed(1000);
    dialog.play('guard');
    frame(1);
    dialog.close();
    eq(seen.join(','), 'start:hello,typed,close:manual');
    eq(dialog.isOpen(), false);
    truthy($('#__dialog').get(0) === undefined, 'узлы диалога уничтожены');
});

test('закрытый диалог: методы возвращают пустые значения, tick молчит', () => {
    reset();
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.close();
    frame();
    eq(dialog.text(), '');
    eq(dialog.node(), null);
    eq(dialog.speaker(), '');
    eq(dialog.portrait(), null);
    eq(dialog.choices().length, 0);
    eq(dialog.next(), false);
    eq(dialog.choose(0), false);
    eq(dialog.panel(), null);
});

test('неизвестная реплика внутри диалога заканчивает его с reason missing', () => {
    reset();
    const ends = [];
    dialog.on('end', (e) => ends.push(e.reason));
    dialog.define('bad', { nodes: { a: { text: 'Раз', to: 'нет-такой' } } });
    dialog.play('bad');
    dialog.skip();
    dialog.next();
    eq(dialog.isOpen(), false);
    eq(ends.join(','), 'missing');
    truthy(logs.some((m) => m.includes('нет-такой')));
});

// --- Клавиатура и вид ------------------------------------------------------

test('клавиатура: вниз/вверх двигают подсветку, Enter выбирает', () => {
    reset();
    dialog.flag('has_pass', true);
    dialog.define('guard', GUARD);
    dialog.speed(1000);
    dialog.play('guard');
    typeOut();
    eq(dialog.choiceFocus(), 0);
    keys.down = true;
    frame();
    eq(dialog.choiceFocus(), 1);
    keys.up = true;
    frame();
    eq(dialog.choiceFocus(), 0);
    keys.enter = true;
    frame();
    eq(dialog.node(), 'pass', 'Enter выбрал первый вариант');
    keys.escape = true;
    frame();
    eq(dialog.isOpen(), false, 'Escape закрыл диалог');
});

test('Enter без выборов листает реплики, Space — тоже', () => {
    reset();
    dialog.define('chain', { nodes: { a: { text: 'Раз', to: 'b' }, b: { text: 'Два', to: null } }, speed: 1000 });
    dialog.play('chain');
    typeOut();
    keys.enter = true;
    frame();
    eq(dialog.node(), 'b', 'Enter перешёл к следующей реплике');
    typeOut();
    keys.space = true;
    frame();
    eq(dialog.isOpen(), false, 'Space на последней реплике закрыл диалог');
});

test('вью диалога раскладывает текст, кнопки и подложку по размерам окна', () => {
    reset();
    dialog.flag('has_pass', true);
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.skip();
    const panel = $('#__dialog').get(0);
    eq(panel.w, 640);
    eq(panel.y, Math.round(600 - panel.h - 24) + panel.h / 2, 'панель прижата к низу окна');
    const line = $('#__dialog_line0').get(0);
    const portrait = $('#__dialog_portrait').get(0);
    truthy(line.x > portrait.x, 'текст правее портрета');
    eq($('#__dialog_choice0').get(0).visible, true);
    eq($('#__dialog_choice1').get(0).visible, true);
    eq($('#__dialog_choice2').get(0).visible, false, 'лишние кнопки скрыты');
    truthy(panel.h > 132, 'панель выросла под два выбора');
});

test('подсветка выбора: цвет кнопки следует за choiceFocus', () => {
    reset();
    dialog.flag('has_pass', true);
    dialog.define('guard', GUARD);
    dialog.play('guard');
    dialog.skip();
    const first = $('#__dialog_choice0').get(0);
    const second = $('#__dialog_choice1').get(0);
    eq(first.color, first.hover_color, 'первый выбор подсвечен');
    truthy(second.color !== second.hover_color, 'второй — нет');
    dialog.focusChoice(1);
    eq(second.color, second.hover_color);
    truthy($('#__dialog_choice0').get(0).color !== first.hover_color);
});

test('стиль $.font применяется к тексту диалога', () => {
    reset();
    $.font.define('talk', { size: 26, color: '#ffe0a0' });
    dialog.define('d', { style: 'talk', nodes: { a: { text: 'Стиль', to: null } } });
    dialog.play('d');
    dialog.skip();
    eq($('#__dialog_line0').get(0).size, 26);
    eq($.font.of($('#__dialog_line0').get(0)), 'talk');
});

finish();
