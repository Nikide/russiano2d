// ===========================================================================
// Юнит-тест UI-контролов без движка (qjs).
//
// Проверяет чистую раскладку (row/col/grid с gap/padding/align и переносом),
// хит-тест точки и поведение контролов через мок ввода: шаг ползунка,
// обрезку текста по maxLength, порядок фокуса Tab и клик по флажку.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/widgets_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, def, wrap, wrapOne, query } from '../../src/highlevel/core.js';
import {
    installWidgets, tickWidgets,
    layoutRow, layoutCol, layoutGrid, hitTestRect, pointInNode,
} from '../../src/highlevel/widgets.js';

// Минимальный api.js: цепочные методы, которые в игре ставит installNodeMethods,
// здесь задаём сами — тест проверяет только виджеты.
def('at', function (x, y) { this.nodes.forEach((n) => { n.x = x; n.y = y; }); return this; });
def('size', function (w, h) {
    if (w === undefined) { const n = this.nodes[0]; return n ? { w: n.w, h: n.h } : { w: 0, h: 0 }; }
    this.nodes.forEach((n) => { n.w = w; n.h = h === undefined ? w : h; });
    return this;
});
def('on', function (name, fn) { this.nodes.forEach((n) => n.on(name, fn)); return this; });
def('text', function (v) {
    if (v === undefined) return this.nodes[0] ? this.nodes[0].text : '';
    this.nodes.forEach((n) => { n.text = String(v); });
    return this;
});
def('appendTo', function (parent) {
    const target = parent && parent.nodes ? parent.nodes[0] : parent;
    this.nodes.forEach((n) => { if (target) target.child_nodes.push(n); });
    return this;
});

// Ядро рассылает глобальные события через ctx.$ — в тесте он не нужен.
ctx.$ = { _dispatchGlobal() {} };

// --- Мок $ и ввода ---------------------------------------------------------

const keys = {};       // нажатия «в этом кадре»
const held = {};       // удержание
const mouse = { x: -999, y: -999 };
let mouse_pressed = false;
let mouse_down = false;
let typed = '';
let wheel = 0;

function makeDollar() {
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
    $.ui = {};
    $.gfx = { size: () => ({ w: 800, h: 600 }) };
    $.input = {
        mouse: () => mouse,
        mousePressed: () => mouse_pressed,
        mouseDown: () => mouse_down,
        pressed: (k) => !!keys[k],
        down: (k) => !!held[k],
        wheel: () => ({ x: 0, y: wheel }),
        text: () => typed,
    };
    return $;
}

const $ = makeDollar();
installWidgets($);
ctx.gfx = { push: { sprite() {}, circle() {}, triangle() {}, line() {} }, _queueText() {}, measureText: engine.measureText };

/** Один кадр: сбрасывает «фронты» ввода, как это делает движок. */
function frame() {
    tickWidgets(1 / 60);
    for (const k of Object.keys(keys)) delete keys[k];
    mouse_pressed = false;
    typed = '';
    wheel = 0;
}

/** Чистый реестр узлов между проверками (destroy() в моке недоступен). */
function reset() {
    ctx.nodes.length = 0;
    $.ui.blur();
}

// --- Раскладка -------------------------------------------------------------

test('layoutRow раскладывает по порядку с gap и padding', () => {
    const rects = layoutRow({ x: 0, y: 0, w: 100, h: 50 },
                            [{ w: 20, h: 10 }, { w: 30, h: 20 }],
                            { gap: 5, padding: 10, align: 'start' });
    eq(rects.length, 2);
    eq(JSON.stringify(rects[0]), JSON.stringify({ x: 10, y: 10, w: 20, h: 10 }));
    eq(JSON.stringify(rects[1]), JSON.stringify({ x: 35, y: 10, w: 30, h: 20 }));
});

test('layoutRow align=center/end/stretch двигает по поперечной оси', () => {
    const items = [{ w: 20, h: 10 }];
    const box = { x: 0, y: 0, w: 100, h: 50 };
    eq(layoutRow(box, items, { padding: 10, align: 'center' })[0].y, 20);
    eq(layoutRow(box, items, { padding: 10, align: 'end' })[0].y, 30);
    eq(layoutRow(box, items, { padding: 10, align: 'stretch' })[0].h, 30);
});

test('layoutCol раскладывает сверху вниз и центрирует', () => {
    const rects = layoutCol({ x: 0, y: 0, w: 100, h: 60 },
                            [{ w: 10, h: 20 }, { w: 10, h: 10 }],
                            { gap: 5, padding: 10, align: 'center' });
    eq(JSON.stringify(rects[0]), JSON.stringify({ x: 45, y: 10, w: 10, h: 20 }));
    eq(rects[1].y, 35);
    eq(layoutCol({ x: 0, y: 0, w: 100, h: 60 }, [{ w: 10, h: 10 }],
                 { padding: 10, align: 'stretch' })[0].w, 80);
});

test('layoutGrid делит ширину и переносит по строкам', () => {
    const items = [{ w: 1, h: 10 }, { w: 1, h: 10 }, { w: 1, h: 20 }, { w: 1, h: 10 }, { w: 1, h: 10 }];
    const rects = layoutGrid({ x: 0, y: 0, w: 100, h: 100 }, items,
                             { columns: 2, gap: 5, padding: 10, align: 'start' });
    near(rects[0].x, 10);
    near(rects[1].x, 52.5, 1e-6);
    near(rects[2].y, 25, 1e-6);       // вторая строка: 10 + 10 + 5
    near(rects[4].y, 50, 1e-6);       // третья строка: 25 + 20 + 5
    eq(rects[3].y, 25);
    // «stretch» растягивает элемент на всю ячейку.
    eq(layoutGrid({ x: 0, y: 0, w: 100, h: 100 }, [{ w: 1, h: 10 }],
                  { columns: 2, gap: 5, padding: 10, align: 'stretch' })[0].w, 37.5);
});

test('hitTestRect и pointInNode понимают границы', () => {
    truthy(hitTestRect({ x: 10, y: 10, w: 20, h: 20 }, 10, 10));
    truthy(hitTestRect({ x: 10, y: 10, w: 20, h: 20 }, 30, 30));
    falsy(hitTestRect({ x: 10, y: 10, w: 20, h: 20 }, 9.9, 20));
    const node = { x: 0, y: 0, w: 40, h: 20 };
    truthy(pointInNode(node, -20, -10));
    falsy(pointInNode(node, 21, 0));
});

// --- Контейнеры как узлы ----------------------------------------------------

test('ui.row раскладывает детей с gap/padding через tickWidgets', () => {
    reset();
    const row = $('<ui.row>', { id: 'r', gap: 4, padding: 6 });
    row.at(100, 50).size(120, 40);
    $('<ui.button>', { id: 'b1' }).at(0, 0).size(20, 10).appendTo(row);
    $('<ui.button>', { id: 'b2' }).at(0, 0).size(30, 10).appendTo(row);
    frame();
    // Левый верх контейнера: 100-60=40, 50-20=30 → первый ребёнок в 46,36.
    near($('#b1').get(0).x, 46 + 10, 1e-9);
    near($('#b2').get(0).x, 46 + 20 + 4 + 15, 1e-9);
    near($('#b1').get(0).y, 30 + 6 + 5, 1e-9);
});

test('ui.grid переносит детей по columns', () => {
    reset();
    const grid = $('<ui.grid>', { id: 'g', columns: 2, gap: 0, padding: 0 });
    grid.at(20, 20).size(40, 40);
    const kids = [];
    for (let i = 0; i < 3; i++) {
        const b = $(`<ui.button>`, { id: 'gb' + i }).at(0, 0).size(10, 10).appendTo(grid);
        kids.push(b);
    }
    frame();
    near(kids[0].get(0).x, 5);
    near(kids[1].get(0).x, 25);
    near(kids[2].get(0).x, 5);
    near(kids[2].get(0).y, 15);
});

// --- Ползунок ---------------------------------------------------------------

test('sliderValue приводит значение к min/max/step', () => {
    reset();
    const s = $('<ui.slider>', { id: 's1', min: 0, max: 100, step: 5, value: 52 });
    s.sliderValue(s.sliderValue());
    eq(s.sliderValue(), 50, 'значение приводится к шагу');
    s.sliderValue(33);
    eq(s.sliderValue(), 35);
    s.sliderValue(1000);
    eq(s.sliderValue(), 100);
    s.sliderValue(-5);
    eq(s.sliderValue(), 0);
});

test('стрелки клавиатуры меняют ползунок на шаг и шлют change', () => {
    reset();
    const s = $('<ui.slider>', { id: 's2', min: 0, max: 100, step: 5, value: 40 });
    let changed = 0;
    s.on('change', () => { changed++; });
    s.focus();
    keys.right = true;
    frame();
    eq(s.sliderValue(), 45);
    eq(changed, 1);
    keys.left = true;
    keys.left = true;
    frame();
    eq(s.sliderValue(), 40);
});

test('клик по дорожке ползунка ставит значение по позиции', () => {
    reset();
    const s = $('<ui.slider>', { id: 's3', min: 0, max: 100, step: 1, value: 0 });
    s.at(100, 50).size(200, 28);
    mouse.x = 150;
    mouse.y = 50;
    mouse_pressed = true;
    mouse_down = true;
    frame();
    near(s.sliderValue(), 75, 1e-6);   // дорожка [0..200], клик в 150 — это 75%
});

// --- Текстовое поле ---------------------------------------------------------

test('maxLength обрезает ввод, backspace удаляет символ', () => {
    reset();
    const f = $('<ui.input>', { id: 'i1', maxLength: 3 });
    f.focus();
    typed = 'привет';
    frame();
    eq(f.text(), 'при');
    keys.backspace = true;
    frame();
    eq(f.text(), 'пр');
    eq(f.inputValue(), 'пр');
});

test('ввод идёт только в поле в фокусе', () => {
    reset();
    const a = $('<ui.input>', { id: 'i2' });
    const b = $('<ui.input>', { id: 'i3' });
    b.focus();
    typed = 'да';
    frame();
    eq(a.text(), '');
    eq(b.text(), 'да');
});

test('Enter шлёт submit, стрелки двигают курсор', () => {
    reset();
    const f = $('<ui.input>', { id: 'i4', maxLength: 10 });
    f.focus();
    typed = 'ab';
    frame();
    keys.left = true;
    frame();
    typed = 'X';
    frame();
    eq(f.text(), 'aXb');
    let submitted = null;
    f.on('submit', (e) => { submitted = e.data.value; });
    keys.enter = true;
    frame();
    eq(submitted, 'aXb');
});

// --- Список и флажок --------------------------------------------------------

test('ui.list: стрелки и клик выбирают элемент и шлют select', () => {
    reset();
    const l = $('<ui.list>', { id: 'l1', items: ['один', 'два', 'три'] });
    l.at(100, 100).size(100, 72);
    let picked = null;
    l.on('select', (e) => { picked = e.data.item; });
    l.focus();
    keys.down = true;
    frame();
    eq(l.selectedIndex(), 1);
    eq(picked, 'два');

    mouse.x = 100;
    mouse.y = 100 + 24;               // вторая строка (itemHeight = 24)
    mouse_pressed = true;
    mouse_down = true;
    frame();
    eq(l.selectedIndex(), 2);
    eq(l.selectedItem(), 'три');
});

test('клик по флажку переключает checked и шлёт change', () => {
    reset();
    const c = $('<ui.checkbox>', { id: 'c1', text: 'Да' });
    c.at(100, 40).size(160, 28);
    let changes = 0;
    c.on('change', () => { changes++; });
    eq(c.checked(), false);
    mouse.x = 100;
    mouse.y = 40;
    mouse_pressed = true;
    mouse_down = true;
    frame();
    eq(c.checked(), true);
    eq(changes, 1);
    // Флажок получил фокус, пробел снимает отметку.
    mouse_pressed = false;
    mouse_down = false;
    frame();
    keys.space = true;
    frame();
    eq(c.checked(), false);
});

// --- Диалог -----------------------------------------------------------------

test('ui.dialog: кнопки шлют confirm/cancel и закрывают окно', () => {
    reset();
    const d = $('<ui.dialog>', { id: 'd1', title: 'Выход', text: 'Точно?', buttons: ['Отмена', 'OK'] });
    d.at(400, 300).size(300, 180);
    let confirmed = 0, cancelled = 0;
    d.on('confirm', () => { confirmed++; });
    d.on('cancel', () => { cancelled++; });

    frame();                              // раскладка кнопок
    keys.enter = true;                    // первая кнопка — «Отмена»
    frame();
    eq(cancelled, 1);
    eq(d.get(0).visible, false, 'диалог закрылся по действию');

    d.openDialog();
    d.get(0).attrs._buttonFocus = 1;
    keys.enter = true;
    frame();
    eq(confirmed, 1);
    eq(d.get(0).visible, false);
});

test('модальный диалог блокирует контролы под собой', () => {
    reset();
    const c = $('<ui.checkbox>', { id: 'mc', text: 'x' });
    c.at(50, 50).size(120, 28);
    const d = $('<ui.dialog>', { id: 'md', buttons: ['OK'] });
    d.at(400, 300).size(300, 180);
    frame();
    mouse.x = 50; mouse.y = 50;
    mouse_pressed = true; mouse_down = true;
    frame();
    eq(c.checked(), false, 'клик не дошёл до флажка за диалогом');
    mouse_pressed = false; mouse_down = false;
    keys.tab = true;
    frame();
    truthy($.ui.focusedId() !== 'mc', 'Tab не уводит фокус за диалог');
});

// --- Фокус ------------------------------------------------------------------

test('Tab обходит контролы в порядке создания', () => {
    reset();
    $('<ui.checkbox>', { id: 'fa', text: 'a' });
    $('<ui.slider>', { id: 'fb', min: 0, max: 10 });
    $('<ui.input>', { id: 'fc' });
    keys.tab = true;
    frame();
    eq($.ui.focusedId(), 'fa');
    keys.tab = true;
    frame();
    eq($.ui.focusedId(), 'fb');
    keys.tab = true;
    frame();
    eq($.ui.focusedId(), 'fc');
    keys.tab = true;
    keys.lshift = true;
    held.lshift = true;
    frame();
    eq($.ui.focusedId(), 'fb', 'Shift+Tab идёт назад');
});

test('tabIndex меняет порядок обхода', () => {
    reset();
    $('<ui.input>', { id: 'ta', tabIndex: 5 });
    $('<ui.input>', { id: 'tb', tabIndex: 1 });
    $.ui.focusNext();
    eq($.ui.focusedId(), 'tb');
    $.ui.focusNext();
    eq($.ui.focusedId(), 'ta');
});

// --- Прокрутка --------------------------------------------------------------

test('ui.scroll ограничивает прокрутку содержимым', () => {
    reset();
    const sc = $('<ui.scroll>', { id: 'sc1', gap: 0, padding: 0, align: 'start' });
    sc.at(100, 100).size(100, 50);
    for (let i = 0; i < 5; i++) $('<ui.button>', { id: 'sb' + i }).size(100, 30).appendTo(sc);
    frame();
    eq(sc.get(0).attrs.maxScroll, 100);   // 150 контента − 50 окна
    keys.down = true;
    sc.focus();
    frame();
    eq(sc.get(0).attrs.scroll, 24);
    sc.get(0).attrs.scroll = 999;
    frame();
    eq(sc.get(0).attrs.scroll, 100);
});

test('циклический extends тем не вешает движок', () => {
    $.ui.theme('cyc-a', { extends: 'cyc-b', size: 10 });
    $.ui.theme('cyc-b', { extends: 'cyc-a', size: 12 });
    truthy($.ui.theme('cyc-a'), 'тема a разобрана без RangeError');
    truthy($.ui.theme('cyc-b'), 'тема b разобрана');
});

finish();
