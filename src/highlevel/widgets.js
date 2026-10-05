// ===========================================================================
// UI-контролы: $.ui.row/col/grid/scroll/checkbox/slider/input/list/dialog.
//
// Модуль дополняет $.ui (ui.js) и закрывает раздел 3.8 GAP_ANALYSIS: поверх
// уже существующего механизма <ui.*>-узлов (координаты окна, attrs.ui = true,
// отрисовка через registerUINodeRenderer) появляются контейнеры с раскладкой,
// прокрутка, фокус и клавиатурная навигация, а также контролы ввода.
//
// Ключевые решения:
//   * раскладка вынесена в чистые функции layoutRow/layoutCol/layoutGrid и
//     hitTestRect — их гоняет qjs-харнесс без движка (см. _CONTRACT.md §4);
//   * tickWidgets пересчитывает раскладку контейнера только когда менялись
//     дети, размер или параметры (подпись в attrs._wsig), а не каждый кадр;
//   * ввод текста берётся у АКТИВНОГО поля (engine.textInput() отдаёт символы
//     за кадр один раз на всех) — см. tickInputField;
//   * контролы ставятся в общий список фокуса, Tab/Shift+Tab обходят его в
//     порядке создания с учётом tabIndex.
//
// Сверх раскладки модуль даёт две вещи, которых не хватало интерфейсу на
// разных разрешениях:
//   * ЯКОРЯ в духе Godot Control: края узла задаются долей родителя плюс
//     пиксельный отступ (anchorLeft/…, .anchor(), .anchorPreset(), .rect(),
//     .sizePercent()). Пока якорь не задан, узел живёт в абсолютных пикселях,
//     поэтому старый код работает как раньше; якорные узлы пересчитываются в
//     tickWidgets, в том числе при изменении размера окна.
//   * ТЕМЫ: $.ui.theme(name, spec) — цвета состояний (normal/hover/pressed/
//     disabled), размер шрифта, отступы; .theme(name) на узле, .style({…}) для
//     точечных правок. Тема наследуется детьми от родителя.
// ===========================================================================

import { ctx, TAGS, def, defGet, query, wrapOne, packColor, withAlpha } from './core.js';
import { registerUINodeRenderer } from './render.js';

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

// Теги-контейнеры: их дети раскладываются автоматически.
const CONTAINER_TAGS = new Set(['ui.row', 'ui.col', 'ui.grid', 'ui.scroll']);

// Узлы, которые могут получить фокус с клавиатуры.
const FOCUSABLE_TAGS = new Set(['ui.input', 'ui.checkbox', 'ui.slider', 'ui.list', 'ui.button', 'ui.scroll']);

// ---------------------------------------------------------------------------
// Чистая раскладка (экспортируется наружу — тестируется qjs)
//
// Все прямоугольники здесь задаются ЛЕВЫМ ВЕРХНИМ углом: так формулы читаются
// как в CSS. В узлы координаты переводятся в центр (x + w/2) уже в
// applyContainerLayout: узлы интерфейса, как и ui.button, позиционируются
// центром.
// ---------------------------------------------------------------------------

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function boxOf(value) {
    const b = value || {};
    return {
        x: num(b.x, 0), y: num(b.y, 0),
        w: Math.max(0, num(b.w, 0)), h: Math.max(0, num(b.h, 0)),
    };
}

function itemOf(value) {
    if (typeof value === 'number') return { w: Math.max(0, value), h: 0 };
    const it = value || {};
    return { w: Math.max(0, num(it.w, 0)), h: Math.max(0, num(it.h, 0)) };
}

function optOf(opts) {
    const o = opts || {};
    const align = o.align === 'center' || o.align === 'end' || o.align === 'stretch' ? o.align : 'start';
    return {
        gap: Math.max(0, num(o.gap, 0)),
        padding: Math.max(0, num(o.padding, 0)),
        align,
        columns: Math.max(1, Math.round(num(o.columns, 2))),
    };
}

/** Дети контейнера, которые участвуют в раскладке (видимые ui-узлы). */
function layoutChildren(node) {
    // Узел с якорем родитель не раскладывает: его прямоугольник считает
    // applyAnchors. Иначе автоматическая раскладка затирала бы якорь.
    return (node.child_nodes || []).filter((c) => c && c.attrs && c.attrs.ui && c.visible !== false && !isAnchored(c));
}

/** Размер содержимого контейнера — для авторазмера (когда w/h не заданы). */
function measureItems(items) {
    let maxW = 0, maxH = 0, sumW = 0, sumH = 0;
    for (const value of items) {
        const it = itemOf(value);
        maxW = Math.max(maxW, it.w);
        maxH = Math.max(maxH, it.h);
        sumW += it.w;
        sumH += it.h;
    }
    return { maxW, maxH, sumW, sumH };
}

/** Горизонтальный ряд: дети слева направо, `align` двигает их по вертикали. */
export function layoutRow(box, items, opts) {
    const b = boxOf(box);
    const o = optOf(opts);
    const innerH = Math.max(0, b.h - o.padding * 2);
    const out = [];
    let x = b.x + o.padding;
    for (const value of items || []) {
        const it = itemOf(value);
        let h = it.h;
        let y = b.y + o.padding;
        if (o.align === 'stretch') h = innerH;
        else if (o.align === 'center') y += (innerH - h) / 2;
        else if (o.align === 'end') y += innerH - h;
        out.push({ x, y, w: it.w, h });
        x += it.w + o.gap;
    }
    return out;
}

/** Вертикальная колонка: дети сверху вниз, `align` двигает их по горизонтали. */
export function layoutCol(box, items, opts) {
    const b = boxOf(box);
    const o = optOf(opts);
    const innerW = Math.max(0, b.w - o.padding * 2);
    const out = [];
    let y = b.y + o.padding;
    for (const value of items || []) {
        const it = itemOf(value);
        let w = it.w;
        let x = b.x + o.padding;
        if (o.align === 'stretch') w = innerW;
        else if (o.align === 'center') x += (innerW - w) / 2;
        else if (o.align === 'end') x += innerW - w;
        out.push({ x, y, w, h: it.h });
        y += it.h + o.gap;
    }
    return out;
}

/**
 * Сетка: `columns` ячеек в строке, дальше перенос. Ширина ячейки делит
 * внутреннюю ширину поровну; высота строки — максимальная высота её элементов.
 */
export function layoutGrid(box, items, opts) {
    const b = boxOf(box);
    const o = optOf(opts);
    const list = (items || []).map(itemOf);
    const innerW = Math.max(0, b.w - o.padding * 2);
    const cellW = Math.max(0, (innerW - o.gap * (o.columns - 1)) / o.columns);

    const rows = Math.max(1, Math.ceil(list.length / o.columns));
    const row_top = [];
    const row_h = [];
    let y = b.y + o.padding;
    for (let r = 0; r < rows; r++) {
        let h = 0;
        for (let c = 0; c < o.columns; c++) {
            const i = r * o.columns + c;
            if (i < list.length) h = Math.max(h, list[i].h);
        }
        row_top.push(y);
        row_h.push(h);
        y += h + o.gap;
    }

    const out = [];
    for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const c = i % o.columns;
        const r = Math.floor(i / o.columns);
        const cellX = b.x + o.padding + c * (cellW + o.gap);
        let w = it.w;
        let h = it.h;
        let x = cellX;
        if (o.align === 'stretch') { w = cellW; h = row_h[r]; }
        else if (o.align === 'center') x += (cellW - w) / 2;
        else if (o.align === 'end') x += cellW - w;
        out.push({ x, y: row_top[r], w, h });
    }
    return out;
}

/** Попадает ли точка в прямоугольник (левый верхний угол + размеры). */
export function hitTestRect(rect, x, y) {
    const r = boxOf(rect);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Попадает ли точка в узел (координаты узла — центр, как у ui.button). */
export function pointInNode(node, x, y) {
    if (!node) return false;
    const hw = Math.abs(node.w) / 2;
    const hh = Math.abs(node.h) / 2;
    return x >= node.x - hw && x <= node.x + hw && y >= node.y - hh && y <= node.y + hh;
}

// ---------------------------------------------------------------------------
// Якоря и относительные размеры (модель Godot Control)
//
// Узел в режиме якоря задаёт края прямоугольника как долю родителя плюс
// пиксельный отступ:
//
//     edge = parent.origin + anchor * parent.size + offset
//
// Для узлов верхнего уровня (parent_node === null) родителем считается окно.
// Пока ни один якорь не задан, узел живёт как раньше — в абсолютных пикселях.
// ---------------------------------------------------------------------------

// Готовые пресеты: [left, top, right, bottom].
const ANCHOR_PRESETS = {
    'top-left':     [0, 0, 0, 0],
    'top-right':    [1, 0, 1, 0],
    'bottom-left':  [0, 1, 0, 1],
    'bottom-right': [1, 1, 1, 1],
    'center':       [0.5, 0.5, 0.5, 0.5],
    'full-rect':    [0, 0, 1, 1],
    'full':         [0, 0, 1, 1],
    'top-wide':     [0, 0, 1, 0],
    'bottom-wide':  [0, 1, 1, 1],
    'left-tall':    [0, 0, 0, 1],
    'right-tall':   [1, 0, 1, 1],
    'hcenter':      [0.5, 0, 0.5, 0],
    'vcenter':      [0, 0.5, 0, 0.5],
};

/**
 * Отступы двух краёв одной оси, чтобы отрезок длиной size стоял относительно
 * якоря: 0 — тянется вправо/вниз, 1 — влево/вверх, 0.5 — по центру.
 */
function edgeOffsets(anchor, size) {
    const s = Math.max(0, num(size, 0));
    if (anchor >= 1) return { first: -s, second: 0 };
    if (anchor > 0 && anchor < 1) return { first: -s / 2, second: s / 2 };
    return { first: 0, second: s };
}

/**
 * Отступы, при которых узел сохраняет текущий размер w×h: нужны, когда якорь
 * задаётся без явных offsets — иначе узел схлопнулся бы в точку.
 */
export function defaultAnchorOffsets(anchors, w, h) {
    const a = anchors || {};
    const out = { left: 0, top: 0, right: 0, bottom: 0 };
    if (num(a.left, 0) === num(a.right, 0)) {
        const e = edgeOffsets(num(a.left, 0), w);
        out.left = e.first; out.right = e.second;
    }
    if (num(a.top, 0) === num(a.bottom, 0)) {
        const e = edgeOffsets(num(a.top, 0), h);
        out.top = e.first; out.bottom = e.second;
    }
    return out;
}

/** Полный разбор отступов: число, массив [l,t,r,b], {left,…} или {x,y,w,h}. */
export function parseOffsets(spec) {
    if (spec === undefined || spec === null) return { left: 0, top: 0, right: 0, bottom: 0 };
    if (typeof spec === 'number') {
        const v = num(spec, 0);
        return { left: v, top: v, right: v, bottom: v };
    }
    if (Array.isArray(spec)) {
        return { left: num(spec[0], 0), top: num(spec[1], 0), right: num(spec[2], 0), bottom: num(spec[3], 0) };
    }
    const o = spec || {};
    if (o.w !== undefined || o.h !== undefined || (o.x !== undefined && o.left === undefined)) {
        const x = num(o.x, 0), y = num(o.y, 0);
        return { left: x, top: y, right: x + num(o.w, 0), bottom: y + num(o.h, 0) };
    }
    return {
        left: num(o.left, 0), top: num(o.top, 0),
        right: num(o.right, 0), bottom: num(o.bottom, 0),
    };
}

/** Частичный патч отступов для .offset(): задаёт только указанные стороны. */
export function partialOffsets(spec) {
    if (spec === undefined || spec === null) return {};
    if (typeof spec === 'number') return parseOffsets(spec);
    if (Array.isArray(spec)) return parseOffsets(spec);
    const o = spec || {};
    if (o.w !== undefined || o.h !== undefined || (o.x !== undefined && o.left === undefined)) {
        return parseOffsets(o);
    }
    const out = {};
    for (const side of ['left', 'top', 'right', 'bottom']) {
        if (o[side] !== undefined) out[side] = num(o[side], 0);
    }
    return out;
}

/**
 * Разбор спецификации якоря:
 *   'left top' | 'center' | 'full-rect' | 'bottom-wide' | 'left center',
 *   объект { left, top, right, bottom } или одно число (все края).
 */
export function parseAnchor(spec) {
    if (spec && typeof spec === 'object') {
        return {
            left: num(spec.left, 0), top: num(spec.top, 0),
            right: num(spec.right, 0), bottom: num(spec.bottom, 0),
        };
    }
    if (typeof spec === 'number') {
        const v = num(spec, 0);
        return { left: v, top: v, right: v, bottom: v };
    }
    const text = String(spec === undefined || spec === null ? '' : spec)
        .trim().toLowerCase().replace(/[_,]+/g, ' ').replace(/\s+/g, ' ');
    const a = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!text) return a;
    if (ANCHOR_PRESETS[text]) {
        const p = ANCHOR_PRESETS[text];
        return { left: p[0], top: p[1], right: p[2], bottom: p[3] };
    }
    let hset = false, vset = false;
    for (const token of text.split(' ')) {
        switch (token) {
        case 'left':    a.left = 0; a.right = 0; hset = true; break;
        case 'right':   a.left = 1; a.right = 1; hset = true; break;
        case 'hcenter': case 'center-x': case 'xcenter':
            a.left = 0.5; a.right = 0.5; hset = true; break;
        case 'top':     a.top = 0; a.bottom = 0; vset = true; break;
        case 'bottom':  a.top = 1; a.bottom = 1; vset = true; break;
        case 'vcenter': case 'center-y': case 'ycenter':
            a.top = 0.5; a.bottom = 0.5; vset = true; break;
        case 'center':
            if (!hset) { a.left = 0.5; a.right = 0.5; hset = true; }
            if (!vset) { a.top = 0.5; a.bottom = 0.5; vset = true; }
            break;
        case 'full': case 'fill': case 'stretch':
            a.left = 0; a.top = 0; a.right = 1; a.bottom = 1; hset = true; vset = true; break;
        case 'wide':    a.left = 0; a.right = 1; hset = true; break;
        case 'tall':    a.top = 0; a.bottom = 1; vset = true; break;
        default: break;   // неизвестный токен игнорируем, чтобы не ронять интерфейс
        }
    }
    return a;
}

/**
 * Пресет целиком: якоря + отступы, сохраняющие размер w×h.
 * Возвращает null, если имени нет в таблице, — вызывающий решает, что делать.
 */
export function anchorPreset(name, w, h) {
    const key = String(name === undefined ? '' : name).trim().toLowerCase();
    const p = ANCHOR_PRESETS[key];
    if (!p) return null;
    const anchors = { left: p[0], top: p[1], right: p[2], bottom: p[3] };
    return { ...anchors, offsets: defaultAnchorOffsets(anchors, w, h) };
}

/** Прямоугольник якоря в координатах родителя: левый верхний угол + размеры. */
export function computeAnchorRect(anchors, offsets, parent) {
    const a = anchors || {};
    const o = offsets || {};
    const p = boxOf(parent);
    const left = p.x + num(a.left, 0) * p.w + num(o.left, 0);
    const top = p.y + num(a.top, 0) * p.h + num(o.top, 0);
    const right = p.x + num(a.right, 0) * p.w + num(o.right, 0);
    const bottom = p.y + num(a.bottom, 0) * p.h + num(o.bottom, 0);
    return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/** '50%' | 50 | 0.5 → 0.5. Числа больше единицы считаются процентами. */
export function percentValue(value) {
    if (typeof value === 'string') {
        const m = /^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/.exec(value);
        return m ? percentValue(parseFloat(m[1])) : 0;
    }
    const n = num(value, 0);
    return n > 1 ? n / 100 : n;
}

/** Задан ли у узла режим якорей (методом или атрибутами anchorLeft/offsetTop/…). */
export function isAnchored(node) {
    if (!node || !node.attrs) return false;
    const a = node.attrs;
    return !!a._anchor || a.anchorLeft !== undefined || a.anchorTop !== undefined ||
        a.anchorRight !== undefined || a.anchorBottom !== undefined ||
        a.offsetLeft !== undefined || a.offsetTop !== undefined ||
        a.offsetRight !== undefined || a.offsetBottom !== undefined;
}

/**
 * Спецификация якоря узла: то, что задал .anchor()/.rect(), плюс одиночные
 * атрибуты anchorLeft/offsetTop и т. п. — они сильнее, чтобы узел можно было
 * донастроить прямо в $('<ui.button>', { anchorRight: 1 }).
 */
export function anchorSpecOf(node) {
    const a = (node && node.attrs) || {};
    const spec = a._anchor || {};
    const anchors = spec.anchors
        ? { ...spec.anchors }
        : { left: 0, top: 0, right: 0, bottom: 0 };
    const offsets = spec.offsets
        ? { ...spec.offsets }
        : { left: 0, top: 0, right: 0, bottom: 0 };
    for (const side of ['left', 'top', 'right', 'bottom']) {
        const cap = side[0].toUpperCase() + side.slice(1);
        if (a['anchor' + cap] !== undefined) anchors[side] = num(a['anchor' + cap], anchors[side]);
        if (a['offset' + cap] !== undefined) offsets[side] = num(a['offset' + cap], offsets[side]);
    }
    return { anchors, offsets };
}

// ---------------------------------------------------------------------------
// Состояние подсистемы
// ---------------------------------------------------------------------------

let api = null;              // ссылка на $, ставится installWidgets
let blink_time = 0;          // для мигания курсора
let cursor_visible = true;
let focus_node = null;       // узел в фокусе (или null)

// Якоря: последний известный размер окна и признак «пересчитать раскладку».
let last_view = null;
let anchors_dirty = false;

// Темы: определения, кэш разбора наследования и номер правки (участвует в
// подписи узла, чтобы правка темы применилась ко всем узлам сразу).
const themes = new Map();
const theme_cache = new Map();
let theme_rev = 0;
let default_theme_active = false;

// ---------------------------------------------------------------------------
// Размер окна и якоря
// ---------------------------------------------------------------------------

/**
 * Размер окна для якорей верхнего уровня. $.window.size() — самый точный
 * источник (engine.width замирает на значении при старте и не обновляется при
 * resize), $.gfx.size() — запасной, engine.width/height — последний.
 */
function viewportSize() {
    const win = api && api.window;
    if (win && typeof win.size === 'function') {
        const s = win.size();
        if (s && num(s.w, 0) > 0 && num(s.h, 0) > 0) return { w: num(s.w, 0), h: num(s.h, 0) };
    }
    const gfx = api && api.gfx;
    if (gfx && typeof gfx.size === 'function') {
        const s = gfx.size();
        if (s && num(s.w, 0) > 0 && num(s.h, 0) > 0) return { w: num(s.w, 0), h: num(s.h, 0) };
    }
    return { w: num(engine.width, 800), h: num(engine.height, 600) };
}

/** Родительский прямоугольник для якоря: узел-родитель или окно. */
function anchorParentRect(node) {
    const p = node && node.parent_node;
    if (p && p.attrs && p.attrs.ui) {
        return { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
    }
    const vp = viewportSize();
    return { x: 0, y: 0, w: vp.w, h: vp.h };
}

function setAnchorOnNode(node, anchors, offsets) {
    node.attrs._anchor = { anchors: { ...anchors }, offsets: { ...offsets } };
    anchors_dirty = true;
}

/**
 * Пересчитывает прямоугольники всех узлов с якорем. Узлы идут в порядке
 * создания: родитель, как правило, создан раньше детей, поэтому к моменту
 * расчёта ребёнка размер родителя уже актуален. Запись только при изменении,
 * чтобы не плодить лишние сбросы подписи раскладки.
 */
function applyAnchors() {
    for (const node of ctx.nodes) {
        if (!isAnchored(node)) continue;
        const spec = anchorSpecOf(node);
        const rect = computeAnchorRect(spec.anchors, spec.offsets, anchorParentRect(node));
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        if (rect.w !== node.w) node.w = rect.w;
        if (rect.h !== node.h) node.h = rect.h;
        if (cx !== node.x) node.x = cx;
        if (cy !== node.y) node.y = cy;
    }
}

// ---------------------------------------------------------------------------
// Темы
//
// Тема — это набор значений, которых у узла может не быть (null = «не задано»,
// тогда остаётся то, что стоит у узла). Наследование — цепочкой extends, по
// умолчанию от темы 'default'. Узел выбирает тему методом .theme(name) или
// наследует её от родителя; точечные правки — .style({…}).
// ---------------------------------------------------------------------------

function emptyTheme() {
    return {
        size: null, padding: null, gap: null,
        colors: {
            normal: null, hover: null, pressed: null, disabled: null,
            text: null, textDisabled: null, fill: null,
            border: null, accent: null, focus: null,
        },
        tags: {},
    };
}

function cloneTheme(src) {
    const s = src || {};
    const out = emptyTheme();
    if (s.size !== undefined) out.size = s.size;
    if (s.padding !== undefined) out.padding = s.padding;
    if (s.gap !== undefined) out.gap = s.gap;
    Object.assign(out.colors, s.colors || {});
    for (const tag of Object.keys(s.tags || {})) out.tags[tag] = cloneTheme(s.tags[tag]);
    return out;
}

// Короткие ключи темы — синонимы полей colors: так тему пишут без вложенности.
// Имена состояний (normal/hover/pressed/disabled) тоже допустимы напрямую.
const THEME_COLOR_ALIASES = {
    color: 'normal', normal: 'normal',
    hover: 'hover', hoverColor: 'hover',
    pressed: 'pressed', pressedColor: 'pressed',
    disabled: 'disabled', disabledColor: 'disabled',
    text: 'text', textColor: 'text', textDisabled: 'textDisabled',
    fill: 'fill', fillColor: 'fill',
    border: 'border', borderColor: 'border',
    accent: 'accent', accentColor: 'accent',
    focus: 'focus', focusColor: 'focus',
};

/** Слияние темы с надстройкой: цвета и per-tag правила сливаются, размеры перекрываются. */
export function mergeTheme(base, spec) {
    const out = cloneTheme(base);
    const s = spec || {};
    if (s.size !== undefined && s.size !== null) out.size = num(s.size, out.size);
    if (s.padding !== undefined && s.padding !== null) out.padding = Math.max(0, num(s.padding, out.padding));
    if (s.gap !== undefined && s.gap !== null) out.gap = Math.max(0, num(s.gap, out.gap));

    const colors = { ...(s.colors || {}) };
    for (const key of Object.keys(THEME_COLOR_ALIASES)) {
        if (s[key] !== undefined) colors[THEME_COLOR_ALIASES[key]] = s[key];
    }
    for (const key of Object.keys(colors)) {
        if (colors[key] !== undefined && colors[key] !== null) out.colors[key] = colors[key];
    }
    for (const tag of Object.keys(s.tags || {})) {
        out.tags[tag] = mergeTheme(out.tags[tag] || emptyTheme(), s.tags[tag] || {});
    }
    return out;
}

/** Разбор темы с наследованием (extends) и кэшированием. */
export function resolveTheme(name) {
    const key = name === undefined || name === null ? 'default' : String(name);
    if (theme_cache.has(key)) return theme_cache.get(key);
    const raw = themes.get(key) || {};
    let parent = raw.extends ? String(raw.extends) : (key === 'default' ? null : 'default');
    if (parent === key) parent = null;   // защита от самоссылки
    const base = parent ? resolveTheme(parent) : emptyTheme();
    const resolved = mergeTheme(base, raw);
    theme_cache.set(key, resolved);
    return resolved;
}

function defineTheme(name, spec) {
    const key = name === undefined || name === null ? 'default' : String(name);
    const prev = themes.get(key) || {};
    // Дополнение, а не замена: повторный вызов с одним цветом не теряет
    // остальные поля ранее заданной темы.
    themes.set(key, {
        ...prev,
        ...(spec || {}),
        colors: { ...(prev.colors || {}), ...((spec || {}).colors || {}) },
        tags: { ...(prev.tags || {}), ...((spec || {}).tags || {}) },
    });
    theme_cache.clear();
    theme_rev++;
    if (key === 'default') default_theme_active = true;
    return resolveTheme(key);
}

/** Имя темы узла: своё, затем ближайшего родителя, затем тема по умолчанию. */
function inheritThemeName(node) {
    let cur = node;
    while (cur) {
        if (cur.attrs && cur.attrs.themeName !== undefined) return String(cur.attrs.themeName);
        cur = cur.parent_node;
    }
    return default_theme_active ? 'default' : null;
}

/** Тема узла с учётом per-tag правил, либо null, если темы нет. */
function resolvedStyleOf(node) {
    const name = inheritThemeName(node);
    if (!name) return null;
    const base = resolveTheme(name);
    const own = base.tags[node.tag];
    return own ? mergeTheme(base, own) : base;
}

/**
 * Переносит значения темы и .style() на поля узла. Прямые сеттеры
 * (.color(), .size()) не затираются: тема перекрывает только то, что сама
 * задаёт. Цвета состояний кладутся в attrs._styleStates для отрисовки.
 */
function applyThemeToNode(node) {
    const resolved = resolvedStyleOf(node);
    const style = node.attrs._style || {};
    const has_style = Object.keys(style).length > 0;
    if (!resolved && !has_style) return;
    const colors = (resolved && resolved.colors) || {};

    if (style.color !== undefined) node.color = packColor(style.color);
    else if (colors.normal != null) node.color = packColor(colors.normal);

    if (style.hoverColor !== undefined) node.hover_color = packColor(style.hoverColor);
    else if (colors.hover != null) node.hover_color = packColor(colors.hover);

    if (style.fillColor !== undefined) node.fill_color = packColor(style.fillColor);
    else if (colors.fill != null) node.fill_color = packColor(colors.fill);

    if (style.textColor !== undefined) node.text_color = packColor(style.textColor);
    else if (colors.text != null) node.text_color = packColor(colors.text);

    if (style.size !== undefined) node.size = num(style.size, node.size);
    else if (resolved && resolved.size != null) node.size = num(resolved.size, node.size);

    if (style.padding !== undefined) node.attrs.padding = Math.max(0, num(style.padding, 0));
    else if (resolved && resolved.padding != null) node.attrs.padding = Math.max(0, num(resolved.padding, 0));

    if (style.gap !== undefined) node.attrs.gap = Math.max(0, num(style.gap, 0));
    else if (resolved && resolved.gap != null) node.attrs.gap = Math.max(0, num(resolved.gap, 0));

    if (style.disabled !== undefined) node.attrs.disabled = !!style.disabled;

    node.attrs._styleStates = {
        normal: node.color,
        hover: node.hover_color != null ? node.hover_color : node.color,
        pressed: colors.pressed != null ? packColor(colors.pressed) : node.color,
        disabled: colors.disabled != null ? packColor(colors.disabled) : node.color,
        text: node.text_color,
        textDisabled: colors.textDisabled != null ? packColor(colors.textDisabled) : node.text_color,
        fill: node.fill_color,
        border: colors.border != null ? packColor(colors.border) : null,
        accent: colors.accent != null ? packColor(colors.accent) : null,
        focus: colors.focus != null ? packColor(colors.focus)
            : (colors.accent != null ? packColor(colors.accent) : null),
    };
    node.attrs._themed = true;
}

function themeSig(node) {
    const name = inheritThemeName(node) || '-';
    const style = node.attrs._style;
    return `${theme_rev}|${name}|${style ? JSON.stringify(style) : '-'}`;
}

/** Применяет темы к «грязным» узлам: подпись меняется при смене темы/стиля. */
function applyThemes() {
    for (const node of ctx.nodes) {
        if (!node.attrs || !node.attrs.ui) continue;
        if (!inheritThemeName(node) && !node.attrs._style) {
            node.attrs._styleStates = null;
            continue;
        }
        const sig = themeSig(node);
        if (sig !== node.attrs._tsig) {
            applyThemeToNode(node);
            node.attrs._tsig = sig;
        }
    }
}

/** Событие resize окна: помечаем якоря и подписи раскладки грязными. */
function watchResize($) {
    const win = $ && $.window;
    if (!win || typeof win.on !== 'function') return;
    win.on('resize', () => {
        anchors_dirty = true;
        last_view = null;
    });
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

export function installWidgets($) {
    api = $;

    registerTags();
    registerRenderers();
    installUiApi($);
    installNodeMethods($);
    watchResize($);
}

function registerTags() {
    // Контейнеры: цвет по умолчанию прозрачный, иначе ui.row закрасил бы фон
    // (у Node цвет по умолчанию белый).
    const container = () => ({
        ui: true, w: 0, h: 0, color: '#00000000',
        gap: 8, padding: 8, align: 'start',
    });

    TAGS['ui.row'] = container();
    TAGS['ui.col'] = container();
    TAGS['ui.grid'] = { ...container(), columns: 2 };
    TAGS['ui.scroll'] = { ...container(), w: 240, h: 160, color: '#0f1520ee', gap: 6, padding: 8 };

    TAGS['ui.checkbox'] = {
        ui: true, w: 200, h: 28, text: '', size: 18,
        color: '#22304aee', hoverColor: '#2e405f', textColor: '#ffffff', fillColor: '#4fd166',
    };
    TAGS['ui.slider'] = {
        ui: true, w: 240, h: 28, value: 0, max: 1, size: 16,
        color: '#22304a', hoverColor: '#2e405f', fillColor: '#4fa3ff',
    };
    TAGS['ui.input'] = {
        ui: true, w: 240, h: 32, text: '', size: 18,
        color: '#101722ee', textColor: '#ffffff', fillColor: '#4fa3ff',
    };
    TAGS['ui.list'] = {
        ui: true, w: 220, h: 160, size: 18,
        color: '#101722ee', hoverColor: '#24304a', textColor: '#ffffff', fillColor: '#2e6bd6cc',
    };
    TAGS['ui.dialog'] = {
        ui: true, w: 360, h: 200, size: 18, text: '',
        color: '#1b2434f2', textColor: '#ffffff', fillColor: '#2e6bd6',
    };
}

function registerRenderers() {
    registerUINodeRenderer('ui.row', drawBox);
    registerUINodeRenderer('ui.col', drawBox);
    registerUINodeRenderer('ui.grid', drawBox);
    registerUINodeRenderer('ui.scroll', drawScroll);
    registerUINodeRenderer('ui.checkbox', drawCheckbox);
    registerUINodeRenderer('ui.slider', drawSlider);
    registerUINodeRenderer('ui.input', drawInput);
    registerUINodeRenderer('ui.list', drawList);
    registerUINodeRenderer('ui.dialog', drawDialog);
}

// ---------------------------------------------------------------------------
// Публичный API $.ui
// ---------------------------------------------------------------------------

function installUiApi($) {
    const ui = $.ui || ctx.ui || {};
    $.ui = ui;

    /** Поставить фокус: узел, обёртка или селектор. */
    ui.focus = function (target) { setFocus(resolveNode(target)); return ui; };

    /** Узел в фокусе (обёртка) или null. */
    ui.focused = function () { return focus_node ? wrapOne(focus_node) : null; };

    /** id узла в фокусе (или null) — удобно для тестов и агента. */
    ui.focusedId = function () { return focus_node ? (focus_node.id || focus_node.tag) : null; };

    ui.focusNext = function () { moveFocus(1); return ui; };
    ui.focusPrev = function () { moveFocus(-1); return ui; };

    /** Снять фокус (без аргумента — с текущего, с аргументом — с указанного). */
    ui.blur = function (target) {
        if (target === undefined) { setFocus(null); return ui; }
        const node = resolveNode(target);
        if (node && node === focus_node) setFocus(null);
        return ui;
    };

    /**
     * Быстрый модальный диалог:
     *   $.ui.dialog({ title: 'Выход', text: 'Точно?', buttons: ['Отмена', 'Да'],
     *                 onConfirm: () => $.scene.load('menu') });
     */
    ui.dialog = function (opts) {
        const o = typeof opts === 'string' ? { title: opts } : (opts || {});
        const size = viewportSize();
        const attrs = {
            title: o.title || 'Диалог',
            text: o.text || '',
            buttons: o.buttons || ['OK'],
        };
        if (o.id) attrs.id = o.id;
        const w = $(`<ui.dialog>`, attrs);
        if (o.w) w.size(o.w, o.h || 200);
        w.at(Math.round(num(size.w, 800) / 2), Math.round(num(size.h, 600) / 2));
        if (o.onConfirm) w.on('confirm', o.onConfirm);
        if (o.onCancel) w.on('cancel', o.onCancel);
        bringToFront(w.get(0));
        return w;
    };

    /**
     * Тема интерфейса.
     *   $.ui.theme({ color: '#101722', size: 18 })        — тема по умолчанию
     *   $.ui.theme('dark', { colors: { hover: '#24304a' } }) — именованная
     *   $.ui.theme('dark')                                 — прочитать разобранную
     *
     * Тема по умолчанию применяется ко всем контролам, у которых нет своей;
     * именованная — только к узлам с .theme('dark') и их детям.
     */
    ui.theme = function (name, spec) {
        if (name === undefined) return resolveTheme('default');
        if (typeof name === 'object' && name !== null) return defineTheme('default', name);
        if (spec === undefined) return resolveTheme(String(name));
        return defineTheme(String(name), spec);
    };

    /** Имя действующей темы узла/селектора (с учётом наследования) или null. */
    ui.themeOf = function (target) {
        const node = resolveNode(target);
        return node ? (inheritThemeName(node) || null) : null;
    };

    /** Разобранная тема узла/селектора — для тестов и агента. */
    ui.styleOf = function (target) {
        const node = resolveNode(target);
        if (!node) return null;
        const resolved = resolvedStyleOf(node);
        const st = node.attrs._styleStates;
        return {
            theme: inheritThemeName(node),
            size: node.size,
            padding: num(node.attrs.padding, 0),
            gap: num(node.attrs.gap, 0),
            color: node.color,
            hoverColor: node.hover_color,
            textColor: node.text_color,
            fillColor: node.fill_color,
            states: st ? { ...st } : null,
            themeSpec: resolved,
        };
    };

    /** Пресеты якорей, доступные в .anchorPreset(). */
    ui.anchorPresets = function () { return Object.keys(ANCHOR_PRESETS); };
}

function resolveNode(target) {
    if (!target) return null;
    if (target.nodes) return target.nodes[0] || null;   // обёртка
    if (typeof target === 'string') return query(target)[0] || null;
    if (target.tag) return target;
    return null;
}

function isControl(node) {
    return !!(node && node.attrs && node.attrs.ui && !node.attrs.disabled && FOCUSABLE_TAGS.has(node.tag));
}

function focusables() {
    const list = ctx.nodes.filter((n) => isControl(n) && n.visible !== false);
    return list.sort((a, b) => {
        const ta = num(a.attrs.tabIndex, 0);
        const tb = num(b.attrs.tabIndex, 0);
        if (ta !== tb) return ta - tb;
        return ctx.nodes.indexOf(a) - ctx.nodes.indexOf(b);
    });
}

function moveFocus(dir) {
    const list = focusables();
    if (!list.length) { setFocus(null); return; }
    const cur = list.indexOf(focus_node);
    const i = cur < 0
        ? (dir > 0 ? 0 : list.length - 1)
        : (cur + dir + list.length) % list.length;
    setFocus(list[i]);
}

function setFocus(node) {
    if (node === focus_node) return;
    const old = focus_node;
    focus_node = node || null;
    if (old) old.emit('blur', {});
    if (focus_node) focus_node.emit('focus', {});
}

// ---------------------------------------------------------------------------
// Методы узлов (имена не пересекаются с _CONTRACT.md §5)
// ---------------------------------------------------------------------------

// Методы намеренно обходят this.nodes напрямую, а не через this.each(): так
// модуль остаётся работоспособным и в qjs-тесте, где api.js не подключён.
function installNodeMethods($) {
    void $;

    def('checked', function (value) {
        if (value === undefined) return this.nodes.length ? !!this.nodes[0].attrs.checked : false;
        this.nodes.forEach((node) => setChecked(node, value));
        return this;
    });

    def('focus', function () { this.nodes.forEach(setFocus); return this; });
    def('blur', function () {
        this.nodes.forEach((node) => { if (node === focus_node) setFocus(null); });
        return this;
    });

    def('items', function (value) {
        if (value === undefined) {
            const n = this.nodes[0];
            return n && Array.isArray(n.attrs.items) ? n.attrs.items.slice() : [];
        }
        this.nodes.forEach((n) => {
            n.attrs.items = Array.isArray(value) ? value.slice() : [];
            n.attrs.index = Math.min(num(n.attrs.index, 0), Math.max(0, n.attrs.items.length - 1));
        });
        return this;
    });

    def('selectedIndex', function (value) {
        if (value === undefined) return this.nodes.length ? listIndex(this.nodes[0]) : -1;
        this.nodes.forEach((node) => selectIndex(node, value));
        return this;
    });

    def('selectedItem', function () {
        const n = this.nodes[0];
        if (!n) return null;
        const items = Array.isArray(n.attrs.items) ? n.attrs.items : [];
        return items[listIndex(n)] === undefined ? null : items[listIndex(n)];
    });

    def('sliderValue', function (value) {
        if (value === undefined) return this.nodes.length ? num(this.nodes[0].value, 0) : 0;
        this.nodes.forEach((node) => setSlider(node, value));
        return this;
    });

    def('min', function (value) {
        if (value === undefined) return this.nodes.length ? num(this.nodes[0].attrs.min, 0) : 0;
        this.nodes.forEach((node) => { node.attrs.min = num(value, 0); });
        return this;
    });

    def('step', function (value) {
        if (value === undefined) return this.nodes.length ? num(this.nodes[0].attrs.step, 0) : 0;
        this.nodes.forEach((node) => { node.attrs.step = Math.max(0, num(value, 0)); });
        return this;
    });

    def('maxLength', function (value) {
        if (value === undefined) return this.nodes.length ? num(this.nodes[0].attrs.maxLength, 0) : 0;
        this.nodes.forEach((node) => { node.attrs.maxLength = Math.max(0, Math.round(num(value, 0))); });
        return this;
    });

    def('placeholder', function (value) {
        if (value === undefined) return this.nodes.length ? (this.nodes[0].attrs.placeholder || '') : '';
        this.nodes.forEach((node) => { node.attrs.placeholder = String(value); });
        return this;
    });

    /** Строка <ui.input>; синоним .text() с явным именем, чтобы не путать с label. */
    def('inputValue', function (value) {
        if (value === undefined) return this.nodes.length ? inputText(this.nodes[0]) : '';
        this.nodes.forEach((node) => setInputText(node, String(value)));
        return this;
    });

    def('align', function (value) {
        if (value === undefined) return this.nodes.length ? (this.nodes[0].attrs.align || 'start') : 'start';
        this.nodes.forEach((node) => { node.attrs.align = String(value); });
        return this;
    });
    def('gap', function (value) {
        this.nodes.forEach((node) => { node.attrs.gap = Math.max(0, num(value, 0)); });
        return this;
    });
    def('padding', function (value) {
        this.nodes.forEach((node) => { node.attrs.padding = Math.max(0, num(value, 0)); });
        return this;
    });

    def('openDialog', function () {
        this.nodes.forEach((node) => { node.visible = true; bringToFront(node); });
        return this;
    });
    def('closeDialog', function () {
        this.nodes.forEach((node) => { node.visible = false; });
        return this;
    });

    // --- Якоря (см. § «Якоря» в docs/highlevel/widgets.md) -------------------

    /**
     * Задать якоря: .anchor('left top'), .anchor('center'), .anchor('full-rect').
     * Второй аргумент — отступы; без него узел сохраняет текущий размер.
     */
    def('anchor', function (spec, offsets) {
        this.nodes.forEach((node) => {
            const anchors = parseAnchor(spec);
            const base = defaultAnchorOffsets(anchors, node.w, node.h);
            const off = offsets === undefined ? base : { ...base, ...partialOffsets(offsets) };
            setAnchorOnNode(node, anchors, off);
        });
        return this;
    });

    /** Готовый пресет: 'center', 'top-left', 'full-rect', 'bottom-wide', … */
    def('anchorPreset', function (name, offsets) {
        this.nodes.forEach((node) => {
            const preset = anchorPreset(name, node.w, node.h);
            if (!preset) {
                if (ctx.log) ctx.log(`$.ui: неизвестный пресет якоря "${name}" — см. $.ui.anchorPresets()`);
                return;
            }
            const anchors = { left: preset.left, top: preset.top, right: preset.right, bottom: preset.bottom };
            const off = offsets === undefined
                ? preset.offsets
                : { ...preset.offsets, ...partialOffsets(offsets) };
            setAnchorOnNode(node, anchors, off);
        });
        return this;
    });

    /** Точечная правка отступов якоря; недостающие стороны берутся как есть. */
    def('offset', function (spec) {
        const patch = partialOffsets(spec);
        this.nodes.forEach((node) => {
            const cur = anchorSpecOf(node);
            const anchored = isAnchored(node);
            const anchors = anchored ? cur.anchors : { left: 0, top: 0, right: 0, bottom: 0 };
            const base = anchored ? cur.offsets : defaultAnchorOffsets(anchors, node.w, node.h);
            setAnchorOnNode(node, anchors, { ...base, ...patch });
        });
        return this;
    });

    /**
     * Прямоугольник относительно родителя (или окна): .rect(x, y, w, h).
     * В отличие от .at() координаты отсчитываются от родителя, а не от окна.
     */
    def('rect', function (x, y, w, h) {
        if (x && typeof x === 'object') { h = x.h; w = x.w; y = x.y; x = x.x; }
        this.nodes.forEach((node) => {
            const nx = num(x, 0);
            const ny = num(y, 0);
            const nw = num(w, node.w);
            const nh = num(h === undefined ? w : h, node.h);
            setAnchorOnNode(node,
                { left: 0, top: 0, right: 0, bottom: 0 },
                { left: nx, top: ny, right: nx + nw, bottom: ny + nh });
        });
        return this;
    });

    /**
     * Размер в долях родителя: .sizePercent('50%', '25%') или .sizePercent(50, 25).
     * Левый/верхний угол берётся из текущего якоря (по умолчанию 0,0).
     */
    def('sizePercent', function (w, h) {
        this.nodes.forEach((node) => {
            const spec = anchorSpecOf(node);
            const wf = percentValue(w);
            const hf = h === undefined ? wf : percentValue(h);
            setAnchorOnNode(node, {
                left: spec.anchors.left,
                top: spec.anchors.top,
                right: spec.anchors.left + wf,
                bottom: spec.anchors.top + hf,
            }, { left: 0, top: 0, right: 0, bottom: 0 });
        });
        return this;
    });

    /** Блокировка контрола: смена цвета и пропуск ввода. */
    def('disabled', function (value) {
        if (value === undefined) return this.nodes.length ? !!this.nodes[0].attrs.disabled : false;
        this.nodes.forEach((node) => {
            node.attrs.disabled = !!value;
            node.attrs._tsig = null;
            applyThemeToNode(node);
        });
        return this;
    });

    // --- Темы ---------------------------------------------------------------

    /** Тема узла (с наследованием от родителя); без аргумента — чтение. */
    def('theme', function (name) {
        if (name === undefined) {
            const node = this.nodes[0];
            return node ? (inheritThemeName(node) || null) : null;
        }
        this.nodes.forEach((node) => {
            if (name === null || name === false) delete node.attrs.themeName;
            else node.attrs.themeName = String(name);
            node.attrs._tsig = null;
            applyThemeToNode(node);
        });
        return this;
    });

    /**
     * Точечные правки поверх темы: .style({ color: '#f00', size: 20 }).
     * Без аргумента — чтение текущих правок.
     */
    def('style', function (spec) {
        if (spec === undefined) {
            return this.nodes.length ? { ...(this.nodes[0].attrs._style || {}) } : {};
        }
        this.nodes.forEach((node) => {
            node.attrs._style = { ...(node.attrs._style || {}), ...(spec || {}) };
            node.attrs._tsig = null;
            applyThemeToNode(node);
        });
        return this;
    });
}

defGet('anchors', (node) => anchorSpecOf(node).anchors, { left: 0, top: 0, right: 0, bottom: 0 });
defGet('anchorRect', (node) => {
    const spec = anchorSpecOf(node);
    return computeAnchorRect(spec.anchors, spec.offsets, anchorParentRect(node));
}, { x: 0, y: 0, w: 0, h: 0 });

// ---------------------------------------------------------------------------
// Значения контролов (общая логика для методов, ввода и отрисовки)
// ---------------------------------------------------------------------------

function setChecked(node, value, silent) {
    if (!node) return;
    const next = !!value;
    const prev = !!node.attrs.checked;
    if (next === prev) return;
    node.attrs.checked = next;
    if (!silent) node.emit('change', { checked: next, value: next });
}

function sliderBounds(node) {
    const min = num(node.attrs.min, 0);
    const max = Math.max(min, num(node.max_value, 1));
    return { min, max, step: Math.max(0, num(node.attrs.step, 0)) };
}

/** Приводит значение к min/max/step — общая точка для мыши и клавиатуры. */
function clampSlider(value, b) {
    let v = Math.min(b.max, Math.max(b.min, num(value, b.min)));
    if (b.step > 0) v = b.min + Math.round((v - b.min) / b.step) * b.step;
    v = Math.min(b.max, Math.max(b.min, v));
    return Math.round(v * 1e6) / 1e6;
}

function setSlider(node, value, silent) {
    if (!node) return;
    const b = sliderBounds(node);
    const next = clampSlider(value, b);
    const prev = num(node.value, b.min);
    if (next === prev) return;
    node.value = next;
    if (!silent) node.emit('change', { value: next });
}

function listIndex(node) {
    const items = Array.isArray(node.attrs.items) ? node.attrs.items : [];
    if (!items.length) return -1;
    const i = Math.round(num(node.attrs.index, 0));
    return Math.min(items.length - 1, Math.max(0, i));
}

function selectIndex(node, value, silent) {
    if (!node) return;
    const items = Array.isArray(node.attrs.items) ? node.attrs.items : [];
    if (!items.length) return;
    const next = Math.min(items.length - 1, Math.max(0, Math.round(num(value, 0))));
    if (next === listIndex(node)) return;
    node.attrs.index = next;
    if (!silent) node.emit('select', { index: next, item: items[next], value: items[next] });
}

// --- Текстовое поле ---------------------------------------------------------

function inputText(node) {
    return typeof node.text === 'string' ? node.text : String(node.text || '');
}

function setInputText(node, value) {
    if (!node) return;
    node.text = String(value);
    node.value = node.text;
    node.attrs._wlast = node.text;
    node.attrs.cursor = node.text.length;
}

/**
 * Согласование строки поля: ядро приводит атрибут `value` к числу, поэтому
 * строку можно задать либо `.value('...')` (метод не приводит), либо
 * `.text('...')`. Отслеживаем, что изменилось последним, и синхронизируем.
 */
function syncInput(node) {
    const last = node.attrs._wlast;
    const value_str = typeof node.value === 'string' ? node.value : null;
    if (last === undefined) {
        if (value_str) node.text = value_str;
        else if (typeof node.value === 'number' && Number.isFinite(node.value) && node.value !== 0 && !node.text) {
            node.text = String(node.value);
        }
    } else if (node.text !== last) {
        // .text()/правка — строка уже актуальна.
    } else if (value_str !== null && value_str !== node.text) {
        node.text = value_str;
    }
    node.attrs._wlast = node.text;
    node.value = node.text;
    node.attrs.cursor = Math.min(num(node.attrs.cursor, node.text.length), node.text.length);
}

/** Границы кодовых точек: курсор не должен разрывать суррогатную пару. */
function prevBoundary(s, i) {
    if (i <= 0) return 0;
    const c = s.charCodeAt(i - 1);
    if (c >= 0xDC00 && c <= 0xDFFF && i >= 2) {
        const p = s.charCodeAt(i - 2);
        if (p >= 0xD800 && p <= 0xDBFF) return i - 2;
    }
    return i - 1;
}

function nextBoundary(s, i) {
    if (i >= s.length) return s.length;
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const n = s.charCodeAt(i + 1);
        if (n >= 0xDC00 && n <= 0xDFFF) return i + 2;
    }
    return i + 1;
}

function textChanged(node) {
    node.value = node.text;
    node.attrs._wlast = node.text;
    node.emit('change', { value: node.text, text: node.text });
}

function editInsert(node, str) {
    if (!str) return false;
    const value = inputText(node);
    const cursor = Math.min(num(node.attrs.cursor, value.length), value.length);
    const max = num(node.attrs.maxLength, 0);
    let allowed = str;
    if (max > 0) {
        const points = [...str];
        const room = max - [...value].length;
        if (room <= 0) return false;
        if (points.length > room) allowed = points.slice(0, room).join('');
    }
    node.text = value.slice(0, cursor) + allowed + value.slice(cursor);
    node.attrs.cursor = cursor + allowed.length;
    textChanged(node);
    return true;
}

function editEraseBefore(node) {
    const value = inputText(node);
    const cursor = Math.min(num(node.attrs.cursor, value.length), value.length);
    if (cursor <= 0) return false;
    const from = prevBoundary(value, cursor);
    node.text = value.slice(0, from) + value.slice(cursor);
    node.attrs.cursor = from;
    textChanged(node);
    return true;
}

function editEraseAfter(node) {
    const value = inputText(node);
    const cursor = Math.min(num(node.attrs.cursor, value.length), value.length);
    if (cursor >= value.length) return false;
    const to = nextBoundary(value, cursor);
    node.text = value.slice(0, cursor) + value.slice(to);
    textChanged(node);
    return true;
}

// ---------------------------------------------------------------------------
// Раскладка контейнеров
// ---------------------------------------------------------------------------

function isContainer(node) {
    return !!(node && CONTAINER_TAGS.has(node.tag));
}

/**
 * Пересчитывает раскладку всех «грязных» контейнеров. Подпись включает детей,
 * их размеры и параметры контейнера: если ничего не менялось — дерево не
 * трогаем (требование производительности).
 */
function layoutTree() {
    for (const node of ctx.nodes.slice()) {
        if (!isContainer(node)) continue;
        if (node.attrs._wlaying) continue;
        if (containerSig(node) !== node.attrs._wsig) relayout(node);
    }
}

function containerSig(node) {
    const kids = layoutChildren(node);
    const a = node.attrs;
    let sig = `${node.w}x${node.h}|${num(a.gap, 8)}|${num(a.padding, 8)}|${a.align || 'start'}|${num(a.columns, 2)}|${num(a.scroll, 0)}|`;
    for (const c of kids) sig += `${c.uid}:${c.w}x${c.h}:${c.tag},`;
    return sig;
}

function relayout(node) {
    node.attrs._wlaying = true;
    applyContainerLayout(node);
    for (const child of layoutChildren(node)) {
        if (isContainer(child)) relayout(child);
    }
    node.attrs._wsig = containerSig(node);
    node.attrs._wlaying = false;
}

function applyContainerLayout(node) {
    const kids = layoutChildren(node);
    const pad = num(node.attrs.padding, 8);
    const gap = num(node.attrs.gap, 8);
    const align = node.attrs.align || 'start';
    const isScroll = node.tag === 'ui.scroll';
    const kind = node.tag === 'ui.grid' ? 'grid' : (node.tag === 'ui.row' ? 'row' : 'col');
    const items = kids.map((c) => ({ w: c.w, h: c.h }));
    const m = measureItems(items);
    const opts = { gap, padding: pad, align, columns: Math.max(1, Math.round(num(node.attrs.columns, 2))) };

    // Авторазмер: контейнер без явных размеров обнимает содержимое. Для
    // scroll ширина/высота — это окно просмотра, его не трогаем.
    if (!isScroll) {
        if (kind === 'row') {
            if (node.w <= 0) node.w = pad * 2 + m.sumW + gap * Math.max(0, items.length - 1);
            if (node.h <= 0) node.h = pad * 2 + m.maxH;
        } else if (kind === 'col') {
            if (node.w <= 0) node.w = pad * 2 + m.maxW;
            if (node.h <= 0) node.h = pad * 2 + m.sumH + gap * Math.max(0, items.length - 1);
        } else {
            const cols = opts.columns;
            const rows = Math.max(1, Math.ceil(items.length / cols));
            let total = 0;
            for (let r = 0; r < rows; r++) {
                let h = 0;
                for (let c = 0; c < cols; c++) {
                    const i = r * cols + c;
                    if (i < items.length) h = Math.max(h, items[i].h);
                }
                total += h;
            }
            if (node.w <= 0) node.w = pad * 2 + cols * m.maxW + gap * (cols - 1);
            if (node.h <= 0) node.h = pad * 2 + total + gap * (rows - 1);
        }
    }

    const box = { x: node.x - node.w / 2, y: node.y - node.h / 2, w: node.w, h: node.h };
    let rects;

    if (isScroll) {
        const content_h = pad * 2 + m.sumH + gap * Math.max(0, items.length - 1);
        rects = layoutCol({ ...box, h: content_h }, items, opts);
        const max_scroll = Math.max(0, content_h - node.h);
        const scroll = Math.min(max_scroll, Math.max(0, num(node.attrs.scroll, 0)));
        node.attrs.scroll = scroll;
        node.attrs.contentHeight = content_h;
        node.attrs.maxScroll = max_scroll;
        for (const r of rects) r.y -= scroll;
    } else if (kind === 'row') {
        rects = layoutRow(box, items, opts);
    } else if (kind === 'col') {
        rects = layoutCol(box, items, opts);
    } else {
        rects = layoutGrid(box, items, opts);
    }

    // Прямоугольник обрезки: у scroll — его внутренняя область, у остальных —
    // унаследованный от родителя.
    const clip = isScroll
        ? { x0: box.x + 1, y0: box.y + 1, x1: box.x + box.w - 1, y1: box.y + box.h - 1 }
        : (node.attrs._clip || null);

    for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        const r = rects[i];
        if (!r) continue;
        if (r.w !== child.w) child.w = r.w;
        if (r.h !== child.h) child.h = r.h;
        child.x = r.x + r.w / 2;
        child.y = r.y + r.h / 2;
        child.attrs._clip = clip;
    }

    if (isScroll) layoutScrollbar(node, box);
}

function layoutScrollbar(node, box) {
    const content_h = num(node.attrs.contentHeight, 0);
    if (content_h <= node.h + 0.5) {
        node.attrs._thumb = null;
        node.attrs._bar = null;
        return;
    }
    const bar_w = 8;
    const bar = { x0: box.x + box.w - bar_w - 2, y0: box.y + 2, x1: box.x + box.w - 2, y1: box.y + box.h - 2 };
    const track_h = bar.y1 - bar.y0;
    const ratio = node.h / content_h;
    const thumb_h = Math.max(20, track_h * ratio);
    const max_scroll = Math.max(1, num(node.attrs.maxScroll, 1));
    const t = num(node.attrs.scroll, 0) / max_scroll;
    const y0 = bar.y0 + (track_h - thumb_h) * t;
    node.attrs._bar = bar;
    node.attrs._thumb = { x0: bar.x0, y0, x1: bar.x1, y1: y0 + thumb_h };
}

// ---------------------------------------------------------------------------
// Фокус, клавиатура и мышь
// ---------------------------------------------------------------------------

function activeDialog() {
    let found = null;
    for (const node of ctx.nodes) {
        if (node.tag === 'ui.dialog' && node.attrs.ui && node.visible !== false) found = node;
    }
    return found;
}

function isDescendantOf(node, ancestor) {
    let cur = node.parent_node;
    while (cur) {
        if (cur === ancestor) return true;
        cur = cur.parent_node;
    }
    return false;
}

function bringToFront(node) {
    if (!node) return;
    const i = ctx.nodes.indexOf(node);
    if (i >= 0 && i !== ctx.nodes.length - 1) {
        ctx.nodes.splice(i, 1);
        ctx.nodes.push(node);
    }
}

function tickKeyboard(input, modal) {
    // Модальный диалог забирает клавиатуру целиком (иначе Tab уводил бы фокус
    // на контролы за ним).
    if (modal) {
        tickDialogKeys(modal, input);
        return;
    }

    // Tab обходит контролы; Shift разворачивает порядок.
    if (input.pressed('tab')) {
        moveFocus(input.down('lshift') || input.down('rshift') ? -1 : 1);
        return;
    }

    const node = focus_node;
    if (!node || node.visible === false || node.attrs.disabled) return;

    switch (node.tag) {
    case 'ui.input': tickInputField(node, input); break;
    case 'ui.checkbox':
        if (input.pressed('space') || input.pressed('enter')) setChecked(node, !node.attrs.checked);
        break;
    case 'ui.slider': tickSliderKeys(node, input); break;
    case 'ui.list': tickListKeys(node, input); break;
    case 'ui.button':
        if (input.pressed('space') || input.pressed('enter')) node.emit('click', { button: 'left', keyboard: true });
        break;
    case 'ui.scroll': tickScrollKeys(node, input); break;
    default: break;
    }
}

function tickInputField(node, input) {
    // Ввод за кадр отдаётся движком один раз — забирает его только активное
    // поле, иначе символы «размножились» бы по всем <ui.input>.
    const typed = input.text();
    if (typed) editInsert(node, typed);

    if (input.pressed('backspace')) editEraseBefore(node);
    if (input.pressed('delete')) editEraseAfter(node);

    const value = inputText(node);
    let cursor = Math.min(num(node.attrs.cursor, value.length), value.length);
    if (input.pressed('left')) cursor = prevBoundary(value, cursor);
    if (input.pressed('right')) cursor = nextBoundary(value, cursor);
    if (input.pressed('home')) cursor = 0;
    if (input.pressed('end')) cursor = value.length;
    node.attrs.cursor = cursor;

    if (input.pressed('enter')) node.emit('submit', { value: value });
    if (input.pressed('escape')) setFocus(null);
}

function tickSliderKeys(node, input) {
    const b = sliderBounds(node);
    const unit = b.step > 0 ? b.step : (b.max - b.min) / 20 || 1;
    if (input.pressed('left') || input.pressed('down')) setSlider(node, num(node.value, b.min) - unit);
    if (input.pressed('right') || input.pressed('up')) setSlider(node, num(node.value, b.min) + unit);
    if (input.pressed('home')) setSlider(node, b.min);
    if (input.pressed('end')) setSlider(node, b.max);
}

function tickListKeys(node, input) {
    const items = Array.isArray(node.attrs.items) ? node.attrs.items : [];
    if (!items.length) return;
    let i = listIndex(node);
    if (input.pressed('up')) i -= 1;
    if (input.pressed('down')) i += 1;
    if (input.pressed('home')) i = 0;
    if (input.pressed('end')) i = items.length - 1;
    selectIndex(node, i);
    if (input.pressed('enter')) node.emit('activate', { index: listIndex(node), item: items[listIndex(node)] });
}

function tickScrollKeys(node, input) {
    const step = 24;
    let scroll = num(node.attrs.scroll, 0);
    if (input.pressed('up')) scroll -= step;
    if (input.pressed('down')) scroll += step;
    if (input.pressed('pageup')) scroll -= node.h;
    if (input.pressed('pagedown')) scroll += node.h;
    if (input.pressed('home')) scroll = 0;
    node.attrs.scroll = Math.min(num(node.attrs.maxScroll, 0), Math.max(0, scroll));
}

function tickMouse(input, modal) {
    const mouse = input.mouse();
    const mx = num(mouse.x, 0);
    const my = num(mouse.y, 0);
    const pressed = input.mousePressed(1);
    const down = input.mouseDown(1);

    if (modal) {
        tickDialogMouse(modal, input, mx, my, pressed);
        return;
    }

    // Прокрутка колесом — контейнеру под курсором.
    const wheel = num((input.wheel() || {}).y, 0);
    if (wheel !== 0) {
        for (const node of ctx.nodes) {
            if (node.tag !== 'ui.scroll' || !node.attrs.ui || node.visible === false) continue;
            if (pointInNode(node, mx, my)) {
                node.attrs.scroll = Math.min(num(node.attrs.maxScroll, 0),
                    Math.max(0, num(node.attrs.scroll, 0) - wheel * 40));
            }
        }
    }

    for (const node of ctx.nodes.slice()) {
        if (!node.attrs.ui || node.visible === false || node.attrs.disabled) continue;
        const tag = node.tag;
        if (tag === 'ui.list') listHover(node, mx, my);
        // Фокус — любому контролу под курсором (в том числе кнопке).
        if (!isControl(node)) continue;
        const over = pointInNode(node, mx, my);
        if (pressed && over) setFocus(node);
        switch (tag) {
        case 'ui.checkbox':
            if (pressed && over) setChecked(node, !node.attrs.checked);
            break;
        case 'ui.slider': tickSliderMouse(node, mx, pressed, down, over); break;
        case 'ui.input': tickInputMouse(node, mx, pressed, over); break;
        case 'ui.list': if (pressed && over) selectIndex(node, listIndexAt(node, my)); break;
        case 'ui.scroll': tickScrollMouse(node, mx, my, pressed, down, over); break;
        default: break;
        }
    }
}

function tickSliderMouse(node, mx, pressed, down, over) {
    if (pressed && over) {
        node.attrs._drag = true;
        setSlider(node, sliderValueAt(node, mx));
    } else if (node.attrs._drag && down) {
        setSlider(node, sliderValueAt(node, mx));
    }
    if (!down) node.attrs._drag = false;
}

function sliderValueAt(node, mx) {
    const b = sliderBounds(node);
    const t = node.w > 0 ? Math.min(1, Math.max(0, (mx - (node.x - node.w / 2)) / node.w)) : 0;
    return b.min + t * (b.max - b.min);
}

function tickInputMouse(node, mx, pressed, over) {
    if (!pressed || !over) return;
    // Ставим курсор по ближайшему символу — так клик по тексту не сбрасывает
    // позицию в конец.
    const value = inputText(node);
    const pad = 8;
    const before = mx - (node.x - node.w / 2 + pad);
    const ctxg = ctx.gfx;
    let cursor = value.length;
    if (ctxg && ctxg.measureText) {
        let acc = 0;
        cursor = 0;
        for (let i = 0; i < value.length; i++) {
            const step = nextBoundary(value, i);
            const w = measureWidth(ctxg, value.slice(0, step), node.size);
            if (before < acc + w / 2) { cursor = i; break; }
            acc = w;
            cursor = step;
            i = step - 1;
        }
    }
    node.attrs.cursor = cursor;
}

function measureWidth(ctxg, text, size) {
    const m = ctxg.measureText(text, size);
    return Array.isArray(m) ? num(m[0], 0) : num(m, 0);
}

function listItemHeight(node) {
    return Math.max(1, num(node.attrs.itemHeight, 24));
}

function listIndexAt(node, my) {
    const items = Array.isArray(node.attrs.items) ? node.attrs.items : [];
    if (!items.length) return 0;
    const h = listItemHeight(node);
    const top = node.y - node.h / 2;
    return Math.min(items.length - 1, Math.max(0, Math.floor((my - top) / h)));
}

function listHover(node, mx, my) {
    node.attrs._hover = pointInNode(node, mx, my) ? listIndexAt(node, my) : -1;
}

function tickScrollMouse(node, mx, my, pressed, down, over) {
    const thumb = node.attrs._thumb;
    if (pressed && over) {
        if (thumb && hitTestRect({ x: thumb.x0, y: thumb.y0, w: thumb.x1 - thumb.x0, h: thumb.y1 - thumb.y0 }, mx, my)) {
            node.attrs._drag = { mode: 'thumb', grab: my - thumb.y0, start_scroll: num(node.attrs.scroll, 0) };
        } else {
            node.attrs._drag = { mode: 'pan', start_y: my, start_scroll: num(node.attrs.scroll, 0) };
        }
    }
    const drag = node.attrs._drag;
    if (drag && down) {
        if (drag.mode === 'pan') {
            node.attrs.scroll = Math.min(num(node.attrs.maxScroll, 0),
                Math.max(0, drag.start_scroll - (my - drag.start_y)));
        } else if (thumb) {
            const track = node.attrs._bar;
            const track_h = Math.max(1, track.y1 - track.y0);
            const thumb_h = thumb.y1 - thumb.y0;
            const t = Math.min(1, Math.max(0, (my - drag.grab - track.y0) / Math.max(1, track_h - thumb_h)));
            node.attrs.scroll = t * num(node.attrs.maxScroll, 0);
        }
    }
    if (!down) node.attrs._drag = null;
}

// --- Диалог -----------------------------------------------------------------

function dialogButtons(node) {
    const raw = node.attrs.buttons;
    const list = Array.isArray(raw) && raw.length ? raw : ['OK'];
    return list.map((b, i) => {
        if (typeof b === 'string') return { text: b, action: isCancelLabel(b) ? 'cancel' : 'confirm' };
        const text = String(b.text || b.label || ('Кнопка ' + (i + 1)));
        return { text, action: b.action || b.id || (isCancelLabel(text) ? 'cancel' : 'confirm') };
    });
}

function isCancelLabel(label) {
    const s = String(label).trim().toLowerCase();
    return s === 'отмена' || s === 'cancel' || s === 'закрыть' || s === 'close' ||
           s === 'нет' || s === 'no' || s === 'esc';
}

/** Прямоугольники кнопок диалога: считаются каждый кадр (дёшево, их 1–3). */
function layoutDialogButtons(node) {
    const buttons = dialogButtons(node);
    const bw = num(node.attrs.buttonWidth, 96);
    const bh = num(node.attrs.buttonHeight, 32);
    const gap = 8;
    const total = buttons.length * bw + (buttons.length - 1) * gap;
    let x = node.x - total / 2 + bw / 2;
    const y = node.y + node.h / 2 - bh / 2 - 12;
    node.attrs._buttons = buttons.map((b) => {
        const rect = { ...b, x, y, w: bw, h: bh };
        x += bw + gap;
        return rect;
    });
    node.attrs._buttonFocus = Math.min(num(node.attrs._buttonFocus, 0), buttons.length - 1);
}

function tickDialogKeys(node, input) {
    layoutDialogButtons(node);
    const buttons = node.attrs._buttons;
    if (input.pressed('escape')) { cancelDialog(node); return; }
    const shift = input.down('lshift') || input.down('rshift');
    if (input.pressed('left') || (input.pressed('tab') && shift)) {
        node.attrs._buttonFocus = (num(node.attrs._buttonFocus, 0) - 1 + buttons.length) % buttons.length;
    } else if (input.pressed('right') || input.pressed('tab')) {
        node.attrs._buttonFocus = (num(node.attrs._buttonFocus, 0) + 1) % buttons.length;
    }
    if (input.pressed('enter') || input.pressed('space')) {
        activateDialogButton(node, num(node.attrs._buttonFocus, 0));
    }
}

function tickDialogMouse(node, input, mx, my, pressed) {
    layoutDialogButtons(node);
    const buttons = node.attrs._buttons;
    node.attrs._buttonHover = -1;
    for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        if (hitTestRect({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }, mx, my)) {
            node.attrs._buttonHover = i;
            if (pressed) { node.attrs._buttonFocus = i; activateDialogButton(node, i); }
        }
    }
    // Клик мимо кнопок — не закрываем: модальное окно требует явного выбора.
    void input;
}

function activateDialogButton(node, index) {
    const buttons = node.attrs._buttons || dialogButtons(node);
    const b = buttons[Math.min(index, buttons.length - 1)];
    if (!b) return;
    const payload = { index, text: b.text, action: b.action };
    if (b.action === 'cancel') node.emit('cancel', payload);
    else node.emit('confirm', payload);
    if (node.attrs.closeOnAction !== false) node.visible = false;
}

function cancelDialog(node) {
    node.emit('cancel', { index: -1, text: null, action: 'cancel' });
    if (node.attrs.closeOnAction !== false) node.visible = false;
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

export function tickWidgets(dt) {
    if (!api) return;
    const input = api.input || ctx.input;
    if (!input) return;

    blink_time += num(dt, 0);
    cursor_visible = (blink_time % 1.06) < 0.53;

    // Размер окна отслеживаем и событием, и опросом: событие приходит с
    // задержкой в кадр, а $.window.size() — всегда актуальный источник.
    const vp = viewportSize();
    if (!last_view || last_view.w !== vp.w || last_view.h !== vp.h) {
        last_view = { w: vp.w, h: vp.h };
        anchors_dirty = true;
    }
    if (anchors_dirty) {
        // Контейнеры под якорями должны пересобрать раскладку детей.
        for (const node of ctx.nodes) {
            if (isAnchored(node) && isContainer(node)) node.attrs._wsig = null;
        }
        anchors_dirty = false;
    }

    applyAnchors();
    layoutTree();
    applyThemes();

    for (const node of ctx.nodes) {
        if (node.tag === 'ui.input' && node.attrs.ui) syncInput(node);
    }

    const modal = activeDialog();
    tickKeyboard(input, modal);
    tickMouse(input, modal);
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

function inClip(node) {
    const c = node.attrs._clip;
    if (!c) return true;
    return node.x + node.w / 2 > c.x0 && node.x - node.w / 2 < c.x1 &&
           node.y + node.h / 2 > c.y0 && node.y - node.h / 2 < c.y1;
}

function push() { return ctx.gfx.push; }

function queueText(text, x, y, size, color, align) {
    if (!text) return;
    ctx.gfx._queueText(String(text), x, y, num(size, 18), color, align || 'left');
}

function fillRect(node, color) {
    push().sprite(engine.whiteSprite, node.x, node.y, node.w, node.h, 0, color);
}

function borderRect(node, width, color) {
    const p = push();
    p.sprite(engine.whiteSprite, node.x, node.y - node.h / 2 + width / 2, node.w + width, width, 0, color);
    p.sprite(engine.whiteSprite, node.x, node.y + node.h / 2 - width / 2, node.w + width, width, 0, color);
    p.sprite(engine.whiteSprite, node.x - node.w / 2 + width / 2, node.y, width, node.h, 0, color);
    p.sprite(engine.whiteSprite, node.x + node.w / 2 - width / 2, node.y, width, node.h, 0, color);
}

/** Состояние контрола — по нему тема выбирает цвет. */
function controlState(node) {
    if (node.attrs.disabled) return 'disabled';
    if (node.pressed || node.attrs._pressed) return 'pressed';
    if (node.hovered) return 'hover';
    return 'normal';
}

function surfaceColor(node) {
    let color;
    const st = node.attrs._styleStates;
    if (st) {
        const state = controlState(node);
        color = st[state] != null ? st[state] : node.color;
    } else {
        color = node.hovered && node.hover_color && !node.attrs.disabled ? node.hover_color : node.color;
    }
    if (node.alpha < 1) color = withAlpha(color, node.alpha);
    return color;
}

/** Цвет текста с учётом темы и блокировки. */
function textColorOf(node) {
    const st = node.attrs._styleStates;
    if (st) {
        if (node.attrs.disabled && st.textDisabled != null) return st.textDisabled;
        if (st.text != null) return st.text;
    }
    return node.text_color;
}

/** Акцентный цвет темы (обводка фокуса, флажок). */
function accentColorOf(node) {
    const st = node.attrs._styleStates;
    const c = st && st.focus != null ? st.focus : (st && st.accent != null ? st.accent : packColor('#4fa3ff'));
    return withAlpha(c, node.alpha);
}

function drawBox(node) {
    if (!inClip(node)) return;
    const alpha = (node.color >>> 24) & 0xff;
    if (alpha > 0) fillRect(node, node.alpha < 1 ? withAlpha(node.color, node.alpha) : node.color);
    if (node.attrs.border) borderRect(node, 1, packColor(node.attrs.border, node.alpha));
}

function drawScroll(node) {
    if (!inClip(node)) return;
    fillRect(node, node.color);
    const thumb = node.attrs._thumb;
    if (thumb) {
        const bar = node.attrs._bar;
        push().sprite(engine.whiteSprite, (bar.x0 + bar.x1) / 2, (bar.y0 + bar.y1) / 2,
                      bar.x1 - bar.x0, bar.y1 - bar.y0, 0, packColor('#00000055'));
        push().sprite(engine.whiteSprite, (thumb.x0 + thumb.x1) / 2, (thumb.y0 + thumb.y1) / 2,
                      thumb.x1 - thumb.x0, thumb.y1 - thumb.y0, 0,
                      packColor('#7f93b8', node.alpha * (node.attrs._drag ? 0.95 : 0.7)));
    }
}

function drawCheckbox(node) {
    if (!inClip(node)) return;
    const size = Math.min(Math.max(10, node.h - 8), 22);
    const bx = node.x - node.w / 2 + size / 2 + 2;
    const by = node.y;
    const accent = node.attrs.accent ? packColor(node.attrs.accent, node.alpha) : accentColorOf(node);

    push().sprite(engine.whiteSprite, bx, by, size + 4, size + 4, 0,
                  focus_node === node ? accent : packColor('#0a0f18aa', node.alpha));
    push().sprite(engine.whiteSprite, bx, by, size, size, 0, surfaceColor(node));
    if (node.attrs.checked) {
        push().sprite(engine.whiteSprite, bx, by, size * 0.6, size * 0.6, 0,
                      withAlpha(node.fill_color, node.alpha));
    }
    const tx = bx + size / 2 + 8;
    queueText(node.text, tx, node.y, node.size, textColorOf(node), 'left');
}

function drawSlider(node) {
    if (!inClip(node)) return;
    const b = sliderBounds(node);
    const ratio = b.max > b.min ? (num(node.value, b.min) - b.min) / (b.max - b.min) : 0;
    const track_h = 6;
    const knob_r = Math.max(6, Math.min(10, node.h / 2 - 4));

    push().sprite(engine.whiteSprite, node.x, node.y, node.w, track_h, 0, surfaceColor(node));
    if (ratio > 0) {
        push().sprite(engine.whiteSprite, node.x - node.w / 2 + (node.w * ratio) / 2, node.y,
                      node.w * ratio, track_h, 0, withAlpha(node.fill_color, node.alpha));
    }
    const kx = node.x - node.w / 2 + node.w * ratio;
    if (focus_node === node || node.attrs._drag) {
        push().circle(kx, node.y, knob_r + 3, withAlpha(accentColorOf(node), 0.45 * node.alpha), 20);
    }
    push().circle(kx, node.y, knob_r, withAlpha(node.fill_color, node.alpha), 20);
}

function drawInput(node) {
    if (!inClip(node)) return;
    fillRect(node, node.color);
    if (focus_node === node) borderRect(node, 2, accentColorOf(node));
    else borderRect(node, 1, packColor('#00000066', node.alpha));

    const value = inputText(node);
    const pad = 8;
    const tx = node.x - node.w / 2 + pad;
    if (value) {
        queueText(value, tx, node.y, node.size, textColorOf(node), 'left');
    } else if (node.attrs.placeholder) {
        queueText(node.attrs.placeholder, tx, node.y, node.size,
                  packColor('#8fa0bb', node.alpha), 'left');
    }

    if (focus_node === node && cursor_visible) {
        const cursor = Math.min(num(node.attrs.cursor, value.length), value.length);
        let cx = tx;
        if (ctx.gfx && ctx.gfx.measureText) cx += measureWidth(ctx.gfx, value.slice(0, cursor), node.size);
        push().sprite(engine.whiteSprite, cx + 1, node.y, 2, node.size + 4, 0, packColor('#ffffff'));
    }
}

function drawList(node) {
    if (!inClip(node)) return;
    fillRect(node, node.color);
    const items = Array.isArray(node.attrs.items) ? node.attrs.items : [];
    const item_h = listItemHeight(node);
    const top = node.y - node.h / 2;
    const index = listIndex(node);
    for (let i = 0; i < items.length; i++) {
        const cy = top + i * item_h + item_h / 2;
        if (cy + item_h / 2 < node.y - node.h / 2) continue;
        if (cy - item_h / 2 > node.y + node.h / 2) break;
        if (i === index) {
            push().sprite(engine.whiteSprite, node.x, cy, node.w - 4, item_h - 2, 0,
                          withAlpha(node.fill_color, node.alpha));
        } else if (i === num(node.attrs._hover, -1)) {
            push().sprite(engine.whiteSprite, node.x, cy, node.w - 4, item_h - 2, 0,
                          surfaceColor(node));
        }
        queueText(items[i], node.x - node.w / 2 + 10, cy, node.size,
                  i === index ? packColor('#ffffff') : textColorOf(node), 'left');
    }
}

function drawDialog(node) {
    // Затемнение сцены: диалог модальный, фон не должен отвлекать.
    push().sprite(engine.whiteSprite, engine.width / 2, engine.height / 2,
                  engine.width, engine.height, 0, packColor('#000000', 0.45 * node.alpha));
    fillRect(node, node.color);
    push().sprite(engine.whiteSprite, node.x, node.y - node.h / 2 + 22, node.w, 44, 0,
                  packColor('#00000033'));

    queueText(node.attrs.title || 'Диалог', node.x, node.y - node.h / 2 + 22, (node.size || 18) + 2,
              textColorOf(node), 'center');
    if (node.text) queueText(node.text, node.x, node.y - 6, node.size, textColorOf(node), 'center');

    layoutDialogButtons(node);
    const buttons = node.attrs._buttons || [];
    const bf = num(node.attrs._buttonFocus, 0);
    for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        const hot = i === bf || i === num(node.attrs._buttonHover, -1);
        push().sprite(engine.whiteSprite, b.x, b.y, b.w, b.h, 0,
                      hot ? withAlpha(node.fill_color, node.alpha) : packColor('#2a3549', node.alpha));
        queueText(b.text, b.x, b.y, node.size, packColor('#ffffff'), 'center');
    }
}
