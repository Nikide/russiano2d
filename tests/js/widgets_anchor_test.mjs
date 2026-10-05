// ===========================================================================
// Юнит-тест якорей, процентных размеров и тем UI-контролов (qjs, без движка).
//
// Проверяет:
//   * чистые функции якорей (parseAnchor/anchorPreset/computeAnchorRect);
//   * расчёт прямоугольников при разных размерах окна и по событию resize;
//   * пресеты top-left/center/full-rect/bottom-wide/…;
//   * процентные размеры, .rect() относительно родителя и атрибуты anchorLeft/…;
//   * темы: цвета состояний, размер/отступы, наследование extends и от
//     родителя, per-tag правила, .style() поверх темы, disabled;
//   * совместимость: узлы без якорей и тем живут как раньше.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/widgets_anchor_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, def, wrap, wrapOne, query, packColor } from '../../src/highlevel/core.js';
import {
    installWidgets, tickWidgets,
    parseAnchor, anchorPreset, computeAnchorRect, defaultAnchorOffsets,
    parseOffsets, percentValue, isAnchored,
} from '../../src/highlevel/widgets.js';

// --- Минимальные методы api.js, которых нет в qjs ---------------------------

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
    this.nodes.forEach((n) => { if (target) { n.parent_node = target; target.child_nodes.push(n); } });
    return this;
});

ctx.$ = { _dispatchGlobal() {} };

// --- Мок $ и окна -----------------------------------------------------------

const view = { w: 800, h: 600 };
const resize_handlers = [];

function makeDollar() {
    const $ = function (arg, attrs) {
        if (typeof arg !== 'string') return wrap([]);
        const m = /^\s*<([^>]+)>\s*$/.exec(arg);
        if (m) return wrapOne(new Node(m[1], attrs));
        return wrap(query(arg));
    };
    $.ui = {};
    $.gfx = { size: () => ({ w: view.w, h: view.h }) };
    // Окно: size() — актуальный размер, on('resize') — подписка. Именно так
    // widgets.js узнаёт о новом разрешении.
    $.window = {
        size: () => ({ w: view.w, h: view.h }),
        on: (name, fn) => { if (name === 'resize') resize_handlers.push(fn); },
    };
    $.input = {
        mouse: () => ({ x: -999, y: -999 }),
        mousePressed: () => false,
        mouseDown: () => false,
        pressed: () => false,
        down: () => false,
        wheel: () => ({ x: 0, y: 0 }),
        text: () => '',
    };
    return $;
}

const $ = makeDollar();
installWidgets($);
ctx.gfx = { push: { sprite() {}, circle() {}, triangle() {}, line() {} }, _queueText() {}, measureText: engine.measureText };

function frame() { tickWidgets(1 / 60); }

function reset() {
    ctx.nodes.length = 0;
    $.ui.blur();
    view.w = 800;
    view.h = 600;
}

/** Новое разрешение окна + событие resize, как это делает движок. */
function resizeTo(w, h) {
    view.w = w;
    view.h = h;
    for (const fn of resize_handlers.slice()) fn({ w, h });
}

const node = (sel) => $(sel).get(0);

// --- Чистые функции якорей --------------------------------------------------

test('parseAnchor понимает строки, объект и число', () => {
    eq(JSON.stringify(parseAnchor('left top')), JSON.stringify({ left: 0, top: 0, right: 0, bottom: 0 }));
    eq(JSON.stringify(parseAnchor('center')), JSON.stringify({ left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 }));
    eq(JSON.stringify(parseAnchor('left center')), JSON.stringify({ left: 0, top: 0.5, right: 0, bottom: 0.5 }));
    eq(JSON.stringify(parseAnchor('right bottom')), JSON.stringify({ left: 1, top: 1, right: 1, bottom: 1 }));
    eq(JSON.stringify(parseAnchor('full-rect')), JSON.stringify({ left: 0, top: 0, right: 1, bottom: 1 }));
    eq(JSON.stringify(parseAnchor({ left: 0.2, bottom: 1 })), JSON.stringify({ left: 0.2, top: 0, right: 0, bottom: 1 }));
    eq(JSON.stringify(parseAnchor(0.25)), JSON.stringify({ left: 0.25, top: 0.25, right: 0.25, bottom: 0.25 }));
    eq(JSON.stringify(parseAnchor('')), JSON.stringify(parseAnchor({})));
});

test('anchorPreset сохраняет размер и раскладывает по краям', () => {
    eq(anchorPreset('unknown'), null);
    const full = anchorPreset('full-rect', 100, 50);
    eq(JSON.stringify([full.left, full.top, full.right, full.bottom]), JSON.stringify([0, 0, 1, 1]));
    eq(JSON.stringify(full.offsets), JSON.stringify({ left: 0, top: 0, right: 0, bottom: 0 }));

    const center = anchorPreset('center', 40, 20);
    eq(JSON.stringify(center.offsets), JSON.stringify({ left: -20, top: -10, right: 20, bottom: 10 }));

    const br = anchorPreset('bottom-right', 120, 40);
    eq(JSON.stringify(br.offsets), JSON.stringify({ left: -120, top: -40, right: 0, bottom: 0 }));

    const wide = anchorPreset('bottom-wide', 120, 40);
    eq(JSON.stringify([wide.left, wide.top, wide.right, wide.bottom]), JSON.stringify([0, 1, 1, 1]));
    eq(JSON.stringify(wide.offsets), JSON.stringify({ left: 0, top: -40, right: 0, bottom: 0 }));
});

test('defaultAnchorOffsets считает отступы от края', () => {
    eq(JSON.stringify(defaultAnchorOffsets(parseAnchor('top-left'), 30, 10)),
       JSON.stringify({ left: 0, top: 0, right: 30, bottom: 10 }));
    eq(JSON.stringify(defaultAnchorOffsets(parseAnchor('bottom-right'), 30, 10)),
       JSON.stringify({ left: -30, top: -10, right: 0, bottom: 0 }));
});

test('computeAnchorRect считает края при разных размерах родителя', () => {
    const full = computeAnchorRect(parseAnchor('full-rect'), {}, { x: 0, y: 0, w: 800, h: 600 });
    eq(JSON.stringify(full), JSON.stringify({ x: 0, y: 0, w: 800, h: 600 }));

    const br = anchorPreset('bottom-right', 120, 40);
    const r1 = computeAnchorRect(br, br.offsets, { x: 0, y: 0, w: 800, h: 600 });
    eq(JSON.stringify(r1), JSON.stringify({ x: 680, y: 560, w: 120, h: 40 }));
    // То же правило при другом разрешении окна.
    const r2 = computeAnchorRect(br, br.offsets, { x: 0, y: 0, w: 1024, h: 768 });
    eq(JSON.stringify(r2), JSON.stringify({ x: 904, y: 728, w: 120, h: 40 }));

    const ins = computeAnchorRect(parseAnchor('full-rect'), { left: 10, top: 5, right: -10, bottom: -5 },
                                  { x: 0, y: 0, w: 100, h: 50 });
    eq(JSON.stringify(ins), JSON.stringify({ x: 10, y: 5, w: 80, h: 40 }));
});

test('parseOffsets/percentValue понимают формы записи', () => {
    eq(JSON.stringify(parseOffsets(4)), JSON.stringify({ left: 4, top: 4, right: 4, bottom: 4 }));
    eq(JSON.stringify(parseOffsets([1, 2, 3, 4])), JSON.stringify({ left: 1, top: 2, right: 3, bottom: 4 }));
    eq(JSON.stringify(parseOffsets({ x: 10, y: 20, w: 30, h: 40 })),
       JSON.stringify({ left: 10, top: 20, right: 40, bottom: 60 }));
    eq(percentValue('50%'), 0.5);
    eq(percentValue(50), 0.5);
    eq(percentValue(0.5), 0.5);
    eq(percentValue('25'), 0.25);
});

// --- Якоря на узлах ---------------------------------------------------------

test('.anchorPreset("full-rect") растягивает узел на окно', () => {
    reset();
    const p = $('<ui.panel>', { id: 'full' });
    p.anchorPreset('full-rect');
    frame();
    eq(node('#full').w, 800);
    eq(node('#full').h, 600);
    eq(node('#full').x, 400);
    eq(node('#full').y, 300);
});

test('.anchorPreset("bottom-right") держит узел у правого нижнего угла', () => {
    reset();
    const p = $('<ui.button>', { id: 'br' });
    p.size(120, 40).anchorPreset('bottom-right');
    frame();
    eq(node('#br').x, 740);
    eq(node('#br').y, 580);
    eq(node('#br').w, 120);
    eq(node('#br').h, 40);
});

test('.sizePercent задаёт размер в долях родителя', () => {
    reset();
    $('<ui.panel>', { id: 'pct' }).sizePercent('50%', '25%');
    frame();
    eq(node('#pct').w, 400);
    eq(node('#pct').h, 150);
    eq(node('#pct').x, 200);
    eq(node('#pct').y, 75);
});

test('.rect() отсчитывается от родителя', () => {
    reset();
    const parent = $('<ui.panel>', { id: 'rp' }).at(200, 100).size(300, 200);
    $('<ui.button>', { id: 'rc' }).rect(10, 20, 40, 30).appendTo(parent);
    frame();
    // Левый верх родителя (50, 0); ребёнок — (60, 20), центр (80, 35).
    eq(node('#rc').x, 80);
    eq(node('#rc').y, 35);
    eq(node('#rc').w, 40);
    eq(node('#rc').h, 30);
});

test('атрибуты anchorLeft/offsetBottom работают как якорь', () => {
    reset();
    $('<ui.panel>', { id: 'bar', anchorLeft: 0, anchorRight: 1, anchorTop: 0, anchorBottom: 0,
                      offsetTop: 0, offsetBottom: 40 });
    truthy(isAnchored(node('#bar')));
    frame();
    eq(node('#bar').w, 800);
    eq(node('#bar').h, 40);
    eq(node('#bar').x, 400);
    eq(node('#bar').y, 20);
});

test('anchorRect и anchors отдают текущий прямоугольник/спецификацию', () => {
    reset();
    const b = $('<ui.button>', { id: 'ab' });
    b.size(100, 20).anchorPreset('top-left');
    frame();
    eq(JSON.stringify(b.anchorRect()), JSON.stringify({ x: 0, y: 0, w: 100, h: 20 }));
    eq(JSON.stringify(b.anchors()), JSON.stringify({ left: 0, top: 0, right: 0, bottom: 0 }));
});

test('.anchor("center") центрирует, сохраняя размер; .offset двигает края', () => {
    reset();
    const c = $('<ui.button>', { id: 'ac' });
    c.size(60, 20).anchor('center');
    frame();
    eq(node('#ac').w, 60);
    eq(node('#ac').h, 20);
    eq(node('#ac').x, 400);
    eq(node('#ac').y, 300);

    const t = $('<ui.button>', { id: 'at' });
    t.size(60, 20).anchor('top-left').offset({ left: 10, right: 70, top: 5, bottom: 25 });
    frame();
    eq(JSON.stringify(t.anchorRect()), JSON.stringify({ x: 10, y: 5, w: 60, h: 20 }));
    eq(node('#at').x, 40);
    eq(node('#at').y, 15);
});

test('частичные offsets у full-rect делают внутренние поля', () => {
    reset();
    const f = $('<ui.panel>', { id: 'inset' });
    f.anchor('full-rect', { left: 10, right: -10 });
    frame();
    eq(JSON.stringify(f.anchorRect()), JSON.stringify({ x: 10, y: 0, w: 780, h: 600 }));
    eq(node('#inset').x, 400);
    eq(node('#inset').y, 300);
});

test('resize окна пересчитывает якоря в tickWidgets', () => {
    reset();
    const p = $('<ui.panel>', { id: 'rs-full' });
    p.anchorPreset('full-rect');
    const br = $('<ui.button>', { id: 'rs-br' });
    br.size(120, 40).anchorPreset('bottom-right');
    frame();
    eq(node('#rs-br').x, 740);

    resizeTo(1024, 768);
    frame();
    eq(node('#rs-full').w, 1024);
    eq(node('#rs-full').h, 768);
    eq(node('#rs-br').x, 964);
    eq(node('#rs-br').y, 748);
    eq(node('#rs-br').w, 120);

    resizeTo(800, 600);
    frame();
    eq(node('#rs-br').x, 740);
});

test('якорный ребёнок не участвует в раскладке контейнера', () => {
    reset();
    const row = $('<ui.row>', { id: 'row', gap: 0, padding: 0 });
    row.at(100, 50).size(200, 40);
    $('<ui.button>', { id: 'laid' }).size(20, 20).appendTo(row);
    $('<ui.button>', { id: 'anch' }).rect(0, 0, 30, 30).appendTo(row);
    frame();
    // Левый верх ряда (0, 30): обычный ребёнок — (10, 40), якорный — (15, 45).
    eq(node('#laid').x, 10);
    eq(node('#laid').y, 40);
    eq(node('#anch').x, 15);
    eq(node('#anch').y, 45);
});

// --- Темы -------------------------------------------------------------------

test('тема применяет цвета, размер шрифта и отступы', () => {
    reset();
    $.ui.theme('test-dark', {
        colors: { normal: '#101010', hover: '#202020', text: '#eeeeee', fill: '#506070' },
        size: 22, padding: 12, gap: 6,
    });
    const cb = $('<ui.checkbox>', { id: 't1', text: 'x' });
    cb.theme('test-dark');
    frame();
    eq(node('#t1').color, packColor('#101010'));
    eq(node('#t1').hover_color, packColor('#202020'));
    eq(node('#t1').text_color, packColor('#eeeeee'));
    eq(node('#t1').fill_color, packColor('#506070'));
    eq(node('#t1').size, 22);
    eq(node('#t1').attrs.padding, 12);
    eq($.ui.themeOf('#t1'), 'test-dark');
});

test('тема наследуется через extends и перекрывает цвета', () => {
    reset();
    $.ui.theme('inherit-base', { color: '#111111', textColor: '#aaaaaa', size: 20 });
    $.ui.theme('inherit-top', { extends: 'inherit-base', color: '#222222' });
    const resolved = $.ui.theme('inherit-top');
    eq(resolved.colors.normal, '#222222');       // перекрыто
    eq(resolved.colors.text, '#aaaaaa');         // унаследовано
    eq(resolved.size, 20);

    const cb = $('<ui.checkbox>', { id: 't2', text: 'x' });
    cb.theme('inherit-top');
    frame();
    eq(node('#t2').color, packColor('#222222'));
    eq(node('#t2').size, 20);
});

test('per-tag правила темы переопределяют общий цвет', () => {
    reset();
    $.ui.theme('tagged', {
        color: '#333333',
        tags: { 'ui.slider': { color: '#ff0000', fillColor: '#00ff00' } },
    });
    const s = $('<ui.slider>', { id: 't3' });
    s.theme('tagged');
    const c = $('<ui.checkbox>', { id: 't4', text: '' });
    c.theme('tagged');
    frame();
    eq(node('#t3').color, packColor('#ff0000'));
    eq(node('#t3').fill_color, packColor('#00ff00'));
    eq(node('#t4').color, packColor('#333333'));
});

test('.style() перекрывает тему и работает без неё', () => {
    reset();
    $.ui.theme('styled', { color: '#444444', hoverColor: '#555555' });
    const b = $('<ui.button>', { id: 't5' });
    b.theme('styled').style({ color: '#00ff00' });
    frame();
    eq(node('#t5').color, packColor('#00ff00'));
    eq(node('#t5').hover_color, packColor('#555555'));
    eq($.ui.styleOf('#t5').color, packColor('#00ff00'));

    // Без темы .style() тоже действует — прямые правки узла.
    const b2 = $('<ui.button>', { id: 't6' });
    b2.style({ color: '#123456' });
    frame();
    eq(node('#t6').color, packColor('#123456'));
});

test('тема наследуется ребёнком от родителя', () => {
    reset();
    $.ui.theme('parent-theme', { color: '#0a0a0a', textColor: '#f0f0f0' });
    const col = $('<ui.col>', { id: 'tcol', gap: 0, padding: 0 }).theme('parent-theme');
    const kid = $('<ui.checkbox>', { id: 'tkid', text: 'x' }).appendTo(col);
    frame();
    eq($.ui.themeOf('#tkid'), 'parent-theme');
    eq(kid.theme(), 'parent-theme');
    eq(node('#tkid').color, packColor('#0a0a0a'));
    eq(node('#tkid').text_color, packColor('#f0f0f0'));
});

test('disabled убирает контрол из фокуса и меняет цвет состояния', () => {
    reset();
    $.ui.theme('dis-theme', { color: '#202020', disabled: '#404040' });
    const en = $('<ui.input>', { id: 'en1' });
    const dis = $('<ui.input>', { id: 'dis1' });
    en.theme('dis-theme');
    dis.theme('dis-theme').disabled(true);
    frame();
    eq(dis.disabled(), true);
    eq($.ui.styleOf('#dis1').states.disabled, packColor('#404040'));

    $.ui.focusNext();
    eq($.ui.focusedId(), 'en1');
    $.ui.focusNext();
    eq($.ui.focusedId(), 'en1', 'заблокированный контрол пропущен');
});

test('без темы поведение узлов не меняется', () => {
    reset();
    const b = $('<ui.button>', { id: 'plain' });
    const before = node('#plain').color;
    frame();
    eq(node('#plain').color, before);
    falsy(node('#plain').attrs._styleStates);
});

test('тема по умолчанию применяется ко всем контролам', () => {
    reset();
    $.ui.theme({ color: '#0d0d0d', size: 21 });
    const b = $('<ui.button>', { id: 'def1' });
    frame();
    eq(b.theme(), 'default');
    eq(node('#def1').color, packColor('#0d0d0d'));
    eq(node('#def1').size, 21);
});

finish();
