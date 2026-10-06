// ===========================================================================
// Юнит-тест экранов и меню (screen.js) без движка.
//
// Проверяет чистую раскладку (строки/колонки/вложенность/grow/якоря),
// построение узлов, фокус по кругу, клавиатуру через мок $.input, мышь
// (фокус по .hovered без повторного click), открытие/закрытие и поведение на
// неизвестном экране.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/screen_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import {
    installScreen, tickScreen, layoutScreen, anchorPosition, parseScreenAnchor,
    normalizeScreen, isFocusableTag, SCREEN_LEAF_DEFAULTS,
} from '../../src/highlevel/screen.js';
import { installFont } from '../../src/highlevel/font.js';

// --- Мок $, ввода и окна ---------------------------------------------------

let viewport = { w: 800, h: 600 };
const keys = {};                       // «нажатия в этом кадре»
const mouse = { x: -999, y: -999 };
let mouse_pressed = false;
let blurred = 0;

function makeDollar() {
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
    $.ui = { blur() { blurred++; } };
    $.gfx = { size: () => ({ ...viewport }) };
    $.input = {
        pressed: (k) => !!keys[k],
        down: () => false,
        mouse: () => mouse,
        mousePressed: () => mouse_pressed,
    };
    return $;
}

// Ядро рассылает глобальные события через ctx.$ — в тесте он не нужен.
ctx.$ = { _dispatchGlobal() {} };

const $ = makeDollar();
installFont($);
const screen = installScreen($);

const real_log = ctx.log;
let logs = [];
ctx.log = (msg) => { logs.push(String(msg)); };

function reset() {
    if (screen.isOpen()) screen.close();
    ctx.nodes.length = 0;
    ctx.byId.clear();
    logs = [];
    blurred = 0;
    for (const k of Object.keys(keys)) delete keys[k];
    mouse.x = -999;
    mouse.y = -999;
    mouse_pressed = false;
    viewport = { w: 800, h: 600 };
}

/** Один кадр: как движок, сбрасывает «фронты» нажатий после шага. */
function frame() {
    tickScreen(1 / 60);
    for (const k of Object.keys(keys)) delete keys[k];
    mouse_pressed = false;
}

const PAUSE = {
    anchor: 'center', gap: 10, padding: 16,
    rows: [
        { id: 'title', tag: 'ui.label', text: 'Пауза', size: 28, h: 40 },
        { id: 'resume', text: 'Продолжить', action: 'resume' },
        { id: 'quit', text: 'В меню', action: 'quit' },
    ],
};

// --- Чистая раскладка ------------------------------------------------------

test('layoutScreen: строки идут сверху вниз и растягиваются по ширине', () => {
    const { panel, items } = layoutScreen(PAUSE, { w: 800, h: 600 });
    eq(JSON.stringify(panel), JSON.stringify({ x: 284, y: 210, w: 232, h: 180 }));
    eq(items.length, 3);
    eq(items[0].x, 300);
    eq(items[0].y, 226);
    eq(items[0].w, 200, 'подпись растянута на внутреннюю ширину');
    eq(items[1].y, 276, 'учтён gap 10 после строки высотой 40');
    eq(items[2].y, 330);
    eq(items[2].h, 44, 'высота кнопки по умолчанию');
});

test('layoutScreen: колонки идут слева направо, anchor top-left учитывает margin', () => {
    const { panel, items } = layoutScreen({
        anchor: 'top-left', columns: [
            { id: 'a', w: 100, h: 30 },
            { id: 'b', w: 80, h: 30 },
        ],
        gap: 10, padding: 20,
    }, { w: 800, h: 600 });
    eq(JSON.stringify(panel), JSON.stringify({ x: 8, y: 8, w: 230, h: 70 }));
    eq(items[0].x, 28);
    eq(items[1].x, 138);
    eq(items[1].y, 28);
});

test('layoutScreen: panel по якорю bottom-right прижат к правому низу', () => {
    const { panel } = layoutScreen({ anchor: 'bottom-right', rows: [{ id: 'x', w: 100, h: 50 }], padding: 0, gap: 0 },
                                   { w: 800, h: 600 });
    eq(panel.x, 800 - 100 - 8);
    eq(panel.y, 600 - 50 - 8);
    eq(anchorPosition('center', 100, 50, { w: 800, h: 600 }, 0).x, 350);
});

test('layoutScreen: anchor full занимает всё окно', () => {
    const { panel } = layoutScreen({ anchor: 'full', padding: 0, rows: [{ id: 'x', w: 10, h: 10 }] }, { w: 320, h: 200 });
    eq(JSON.stringify(panel), JSON.stringify({ x: 0, y: 0, w: 320, h: 200 }));
});

test('layoutScreen: вложенные группы и grow делят место', () => {
    const { panel, items } = layoutScreen({
        anchor: 'top-left', margin: 0, padding: 0, gap: 0, w: 500, h: 40,
        columns: [
            { id: 'left', w: 100, h: 20, grow: 1 },
            { id: 'right', w: 100, h: 20, grow: 3 },
        ],
    }, { w: 800, h: 600 });
    eq(panel.w, 500);
    eq(items[0].w, 175, 'остаток 300 делится 1:3');
    eq(items[1].w, 325);
    eq(items[1].x, 175);

    const nested = layoutScreen({
        anchor: 'top-left', margin: 0, padding: 0, gap: 4,
        rows: [
            { id: 'head', tag: 'ui.label', w: 200, h: 20 },
            { columns: [{ id: 'yes', w: 90, h: 30 }, { id: 'no', w: 90, h: 30 }] },
        ],
    }, { w: 800, h: 600 });
    const ids = nested.items.map((i) => i.id);
    eq(ids.join(','), 'head,yes,no');
    eq(nested.items[1].y, 24, 'вложенная группа начинается после заголовка (20) и gap (4)');
    eq(nested.items[2].x, 94, 'во вложенной группе тот же gap 4');
});

test('normalizeScreen и isFocusableTag разбирают описание', () => {
    const root = normalizeScreen({ columns: [{ id: 'a' }] });
    eq(root.dir, 'columns');
    eq(root.items[0].tag, 'ui.button', 'тег по умолчанию — кнопка');
    eq(SCREEN_LEAF_DEFAULTS['ui.button'].h, 44);
    eq(isFocusableTag('ui.button'), true);
    eq(isFocusableTag('ui.label'), false);
    eq(parseScreenAnchor('bottom right').vy, 'bottom');
    eq(parseScreenAnchor('top_right').hx, 'right');
    eq(parseScreenAnchor(undefined).hx, 'center');
});

test('неизвестный якорь не ломает раскладку, но попадает в лог', () => {
    reset();
    const a = parseScreenAnchor('серединка');
    eq(a.hx, 'center');
    eq(logs.length, 1);
    truthy(logs[0].includes('серединка'));
    eq(layoutScreen({ anchor: 'серединка', rows: [{ id: 'x', w: 10, h: 10 }], padding: 0 }, { w: 100, h: 100 }).panel.x, 45,
       'раскладка осталась центрированной');
});

// --- Открытие и узлы -------------------------------------------------------

test('open создаёт панель, подложку и узлы по координатам раскладки', () => {
    reset();
    screen.define('pause', PAUSE);
    const panel = screen.open('pause');
    truthy(panel);
    eq(screen.isOpen(), true);
    eq(screen.current(), 'pause');
    eq($('#__screen_pause').get(0).w, 232, 'ширина панели из раскладки');
    truthy($('#__screen_backdrop'), 'подложка создана');
    const resume = screen.item('resume').get(0);
    eq(resume.x, 300 + 200 / 2, 'x узла — центр');
    eq(resume.y, 276 + 44 / 2);
    eq(resume.tag, 'ui.button');
    eq($('#title').get(0).tag, 'ui.label');
    eq(screen.rect('quit').y, 330);
    eq(blurred, 1, 'экран снимает фокус с контролов widgets.js');
});

test('open по описанию и повторное открытие закрывает прежний экран', () => {
    reset();
    const closed = [];
    screen.on('close', (e) => closed.push(e.id));
    screen.define('one', { rows: [{ id: 'a', text: 'A' }] });
    screen.open('one');
    screen.open({ id: 'two', rows: [{ id: 'b', text: 'B' }] });
    eq(screen.current(), 'two');
    eq(closed.join(','), 'one', 'прежний экран закрылся');
    falsy($('#a').get(0), 'узлы прежнего экрана уничтожены');
    eq($('#b').get(0).text, 'B');
});

test('close уничтожает узлы, isOpen становится false', () => {
    reset();
    screen.define('pause', PAUSE);
    screen.open('pause');
    const closed = [];
    screen.on('close', (e) => closed.push(e.id));
    eq(screen.close(), true);
    eq(screen.isOpen(), false);
    eq(screen.close(), false, 'повторное закрытие — no-op');
    falsy($('#__screen_pause').get(0));
    eq(closed.join(','), 'pause');
});

test('неизвестный экран: open возвращает null и пишет в лог', () => {
    reset();
    eq(screen.open('нет-такого'), null);
    eq(screen.isOpen(), false);
    truthy(logs.some((m) => m.includes('нет-такого')));
    screen.define('', { rows: [] });
    screen.define('bad', null);
    eq(logs.length >= 3, true, 'про пустое имя и неверное описание тоже сказано');
});

test('стиль $.font применяется к элементам экрана', () => {
    reset();
    $.font.define('menu', { size: 26, color: '#ffd166' });
    screen.define('styled', { style: 'menu', rows: [{ id: 'go', text: 'Играть', style: 'menu' }] });
    screen.open('styled');
    const node = screen.item('go').get(0);
    eq(node.size, 26);
    eq($.font.of(node), 'menu');
});

test('disabled и focusable:false не берут фокус', () => {
    reset();
    screen.define('d', {
        rows: [
            { id: 'off', text: 'Недоступно', disabled: true },
            { id: 'label', tag: 'ui.label', text: 'Подпись' },
            { id: 'on', text: 'Можно' },
        ],
    });
    screen.open('d');
    eq(screen.focused(), 'on', 'первый доступный — on');
    eq(screen.items().join(','), 'off,label,on');
});

// --- Фокус и клавиатура ----------------------------------------------------

test('фокус ходит по кругу через next/prev/focus', () => {
    reset();
    screen.define('pause', PAUSE);
    screen.open('pause');
    eq(screen.focused(), 'resume', 'первый доступный элемент');
    screen.next();
    eq(screen.focused(), 'quit');
    screen.next();
    eq(screen.focused(), 'resume', 'после последнего — снова первый');
    screen.prev();
    eq(screen.focused(), 'quit', 'назад с первого — последний');
    eq(screen.focus('quit') && screen.focused(), 'quit');
    eq(screen.focusedNode().get(0).hasClass('screen-focus'), true);
    eq(screen.focus('нет-такого'), false);
    truthy(logs.some((m) => m.includes('нет-такого')));
});

test('клавиатура: стрелки двигают фокус, Enter активирует', () => {
    reset();
    screen.define('pause', PAUSE);
    screen.open('pause');
    const seen = [];
    screen.on('activate', (e) => seen.push(e.id + ':' + e.action));
    const clicks = [];
    screen.item('resume').get(0).on('click', (e) => clicks.push(e.data.action));

    keys.down = true;
    frame();
    eq(screen.focused(), 'quit', 'стрелка вниз — следующий');

    keys.up = true;
    frame();
    eq(screen.focused(), 'resume', 'стрелка вверх — предыдущий');

    keys.enter = true;
    frame();
    eq(seen.join(','), 'resume:resume');
    eq(clicks.join(','), 'resume', 'узел получил click, как от мыши');
});

test('Escape закрывает экран, Space активирует', () => {
    reset();
    screen.define('pause', PAUSE);
    screen.open('pause');
    let ended = 0;
    screen.on('activate', () => { ended++; });
    keys.space = true;
    frame();
    eq(ended, 1, 'Space нажал на элементе');
    keys.escape = true;
    frame();
    eq(screen.isOpen(), false, 'Escape закрыл экран');
});

test('мышь: фокус переходит на узел под курсором без повторного click', () => {
    reset();
    screen.define('pause', PAUSE);
    screen.open('pause');
    const quit = screen.item('quit').get(0);
    const clicks = [];
    quit.on('click', () => clicks.push(1));

    // ui.js _tick выставил .hovered — на него и ориентируется экран.
    quit.hovered = true;
    frame();
    eq(screen.focused(), 'quit');

    mouse.x = quit.x;
    mouse.y = quit.y;
    mouse_pressed = true;
    frame();
    eq(clicks.length, 0, 'click по узлу шлёт ui-слой, а не экран');
    eq(screen.focused(), 'quit');
});

test('tickScreen пересчитывает раскладку при смене размера окна', () => {
    reset();
    screen.define('pause', PAUSE);
    screen.open('pause');
    const before = screen.rect('resume').y;
    viewport = { w: 800, h: 700 };
    frame();
    const after = screen.rect('resume').y;
    eq(after, before + 50, 'панель по центру сместилась на половину прироста');
    eq(screen.item('resume').get(0).y, after + 22, 'узел переехал вместе с раскладкой');
});

test('фокус подсвечивает кнопку цветом hoverColor и снимает подсветку', () => {
    reset();
    screen.define('pause', PAUSE);
    screen.open('pause');
    const resume = screen.item('resume').get(0);
    const quit = screen.item('quit').get(0);
    const base = quit.color;                       // «спокойный» цвет кнопки
    truthy(resume.hover_color !== null && base !== resume.hover_color, 'у кнопки есть hoverColor');
    eq(resume.color, resume.hover_color, 'кнопка в фокусе подсвечена');
    screen.next();
    eq(resume.color, base, 'цвет вернулся при уходе фокуса');
    eq(quit.color, quit.hover_color, 'подсветилась следующая');
    screen.close();
    screen.open('pause');
    eq(screen.item('quit').get(0).color, base, 'после переоткрытия подсветки на невыбранной кнопке нет');
    eq(screen.item('resume').get(0).color, screen.item('resume').get(0).hover_color, 'первый элемент снова в фокусе');
});

test('без открытого экрана tickScreen и методы не падают', () => {
    reset();
    frame();
    eq(screen.focused(), null);
    eq(screen.next(), false);
    eq(screen.activate(), false);
    eq(screen.rect('x'), null);
    eq(screen.panel(), null);
    eq(screen.items().join(','), '');
});

finish();
