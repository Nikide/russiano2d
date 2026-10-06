// ===========================================================================
// Экраны и меню: $.screen — вёрстка из ui.*-узлов без ручных координат.
//
// Зачем: собрать паузу, главное меню или экран настроек сейчас можно только
// расставляя .at(x, y) каждому узлу — при смене числа пунктов или разрешения
// всё разъезжается. Здесь экран описывается данными (строки/колонки, отступы,
// выравнивание), а координаты считает раскладка:
//
//   $.screen.define('pause', {
//       anchor: 'center', gap: 10, padding: 16, backdrop: true,
//       rows: [
//           { tag: 'ui.label', text: 'Пауза', size: 28, h: 40 },
//           { id: 'resume', text: 'Продолжить', action: 'resume' },
//           { id: 'quit',   text: 'В меню',     action: 'quit' },
//       ],
//   });
//   $.screen.open('pause');
//   $.screen.on('activate', (e) => { if (e.id === 'quit') $.screen.close(); });
//
// Ключевые решения:
//   * раскладка — чистые функции layoutScreen/anchorPosition/parseScreenAnchor:
//     их гоняет qjs-харнесс без движка (§4 контракта), а координаты в тестах
//     проверяются как числа, а не «на глаз»;
//   * экран строит СВОИ узлы при open() и уничтожает их при close(): игра не
//     обязана помнить обёртки, а повторное открытие всегда даёт свежие узлы;
//   * Enter обрабатывает сам экран (activate()), а мышь — уже существующий
//     ui-слой: он шлёт 'click' по узлу под курсором. Так один клик не приходит
//     в игру дважды (см. docs/highlevel/screen.md, «Мышь»);
//   * фокус подсвечивается через .hovered — единственное визуальное состояние
//     ui-узла; класс 'screen-focus' остаётся игре для своего оформления.
// ===========================================================================

import { ctx, wrapOne } from './core.js';

// ---------------------------------------------------------------------------
// Чистая раскладка
//
// Все прямоугольники задаются ЛЕВЫМ ВЕРХНИМ углом (как в CSS), а в узлы
// переводятся центром (x + w/2) уже в builder'е: ui.*-узлы позиционируются
// центром.
// ---------------------------------------------------------------------------

/** Размеры листа по умолчанию: тег → { w, h }. */
export const SCREEN_LEAF_DEFAULTS = Object.freeze({
    'ui.button': { w: 200, h: 44 },
    'ui.label': { w: 160, h: 28 },
    'ui.panel': { w: 200, h: 100 },
    'ui.image': { w: 64, h: 64 },
    'ui.bar': { w: 200, h: 16 },
    'ui.input': { w: 240, h: 32 },
    'ui.checkbox': { w: 200, h: 28 },
    'ui.slider': { w: 240, h: 28 },
    'ui.list': { w: 220, h: 160 },
    'ui.scroll': { w: 240, h: 160 },
});

const FALLBACK_LEAF = { w: 160, h: 32 };

const FOCUSABLE_TAGS = new Set(['ui.button', 'ui.checkbox', 'ui.slider', 'ui.input', 'ui.list', 'ui.scroll']);

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function size(value, fallback) {
    return Math.max(0, num(value, fallback));
}

function alignOf(value, fallback) {
    return value === 'center' || value === 'end' || value === 'stretch' || value === 'start' ? value : fallback;
}

/** Может ли узел этого тега получить фокус экрана. */
export function isFocusableTag(tag) {
    return FOCUSABLE_TAGS.has(String(tag));
}

/**
 * Разбор якоря: 'center' (по умолчанию), 'top', 'bottom-right', 'top left',
 * 'full' или объект { x: 'left'|'center'|'right', y: 'top'|'center'|'bottom' }.
 * Возвращает { hx, vy, full }.
 */
export function parseScreenAnchor(spec) {
    const fallback = { hx: 'center', vy: 'center', full: false };
    if (spec === undefined || spec === null || spec === '') return fallback;
    if (typeof spec === 'object') {
        return {
            hx: axisWord(spec.x, ['left', 'center', 'right'], 'center'),
            vy: axisWord(spec.y, ['top', 'center', 'bottom'], 'center'),
            full: spec.full === true,
        };
    }
    const text = String(spec).toLowerCase().replace(/[_-]/g, ' ').trim();
    if (text === 'full') return { hx: 'left', vy: 'top', full: true };
    const out = { ...fallback };
    for (const word of text.split(/\s+/)) {
        if (word === 'left' || word === 'right') out.hx = word;
        else if (word === 'top' || word === 'bottom') out.vy = word;
        else if (word === 'center') { out.hx = 'center'; out.vy = 'center'; }
        else if (word) ctx.log(`$.screen: не понимаю якорь "${word}" — беру center`);
    }
    return out;
}

function axisWord(value, allowed, fallback) {
    const word = String(value === undefined || value === null ? '' : value).toLowerCase();
    return allowed.includes(word) ? word : fallback;
}

/** Левый верхний угол панели размера w×h по якорю и отступу margin. */
export function anchorPosition(anchor, w, h, viewport, margin) {
    const a = parseScreenAnchor(anchor);
    const vw = num(viewport && viewport.w, 800);
    const vh = num(viewport && viewport.h, 600);
    const m = Math.max(0, num(margin, 8));
    const x = a.hx === 'left' ? m : (a.hx === 'right' ? vw - w - m : (vw - w) / 2);
    const y = a.vy === 'top' ? m : (a.vy === 'bottom' ? vh - h - m : (vh - h) / 2);
    return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Нормализация описания: строки/колонки превращаются в дерево узлов раскладки.
 * Корень — группа (`rows` или `columns`), её элементы — листья или вложенные
 * группы. Поля незаданных размеров остаются undefined: их добирает раскладка.
 */
export function normalizeScreen(spec) {
    const s = spec || {};
    const root = normalizeGroup(s, 0, 'root');
    root.id = s.id === undefined || s.id === null ? null : String(s.id);
    // Поля, которые есть только у корня: якорь, подложка, стиль по умолчанию.
    root.anchor = s.anchor;
    root.margin = s.margin;
    root.backdrop = s.backdrop;
    root.backdropColor = s.backdropColor;
    root.style = s.style;
    root.color = s.color;
    return root;
}

function normalizeGroup(raw, index, path) {
    const r = raw || {};
    const hasRows = Array.isArray(r.rows);
    const hasCols = Array.isArray(r.columns);
    const dir = hasCols && !hasRows ? 'columns' : (r.dir === 'columns' && !hasRows ? 'columns' : 'rows');
    const list = hasCols && !hasRows ? r.columns : (hasRows ? r.rows : []);
    return {
        kind: 'group',
        key: path + '#' + index,
        dir,
        gap: r.gap,
        padding: r.padding,
        align: r.align,
        w: r.w,
        h: r.h,
        grow: r.grow,
        id: r.id === undefined || r.id === null ? null : String(r.id),
        tag: r.tag ? String(r.tag) : null,
        style: r.style,
        items: list.map((child, i) => normalizeItem(child, i, path + '.' + index)),
    };
}

function normalizeItem(raw, index, path) {
    if (raw && (Array.isArray(raw.rows) || Array.isArray(raw.columns))) {
        return normalizeGroup(raw, index, path);
    }
    const r = raw || {};
    const tag = r.tag === undefined || r.tag === null ? 'ui.button' : String(r.tag);
    const def = SCREEN_LEAF_DEFAULTS[tag] || FALLBACK_LEAF;
    return {
        kind: 'leaf',
        key: path + '#' + index,
        id: r.id === undefined || r.id === null ? null : String(r.id),
        tag,
        text: r.text,
        tr: r.tr,
        w: size(r.w, def.w),
        h: size(r.h, def.h),
        grow: Math.max(0, num(r.grow, 0)),
        align: r.align,
        size: r.size,
        color: r.color,
        style: r.style,
        action: r.action,
        on: r.on,
        attrs: r.attrs,
        focusable: r.focusable === undefined ? undefined : r.focusable === true,
        disabled: r.disabled === true,
    };
}

/**
 * Размер группы: главная ось — сумма детей и отступов, поперечная — максимум.
 * Свои w/h группы (если заданы) сильнее измеренного.
 */
function measureGroup(group, defaultGap, defaultPadding, depth) {
    if (depth > 16) return { w: 0, h: 0 };     // защита от дерева «само в себя»
    const gap = size(group.gap, defaultGap);
    const pad = group.padding === undefined ? (depth === 0 ? size(defaultPadding, 0) : 0) : size(group.padding, 0);
    const rows = group.dir === 'rows';
    let main = 0;
    let cross = 0;
    for (const item of group.items) {
        const child = item.kind === 'group'
            ? measureGroup(item, defaultGap, defaultPadding, depth + 1)
            : item;
        const it = { w: size(child.w, 0), h: size(child.h, 0) };
        main += rows ? it.h : it.w;
        cross = Math.max(cross, rows ? it.w : it.h);
    }
    const along = main + gap * Math.max(0, group.items.length - 1) + pad * 2;
    let w = rows ? cross + pad * 2 : along;
    let h = rows ? along : cross + pad * 2;
    if (group.w !== undefined) w = size(group.w, w);
    if (group.h !== undefined) h = size(group.h, h);
    return { w, h };
}

/**
 * Раскладка экрана целиком.
 *
 * spec     — описание (см. docs/highlevel/screen.md);
 * viewport — { w, h } окна (по умолчанию 800×600).
 *
 * Возвращает { panel: {x,y,w,h}, items: [ { id, tag, x, y, w, h, parent, focusable } ] }
 * с координатами ЛЕВОГО ВЕРХНЕГО угла; parent — индекс родителя в items или -1
 * (панель). Промежуточная группа без tag собственного узла не создаёт: её дети
 * попадают в ближайшего родителя с узлом.
 */
export function layoutScreen(spec, viewport) {
    const root = normalizeScreen(spec);
    const vw = num(viewport && viewport.w, 800);
    const vh = num(viewport && viewport.h, 600);
    const gap = size(root.gap, 10);
    const padding = size(root.padding, 16);
    const content = measureGroup(root, gap, padding, 0);

    const anchor = parseScreenAnchor(root.anchor);
    let panel;
    if (anchor.full) {
        panel = { x: 0, y: 0, w: vw, h: vh };
    } else {
        const pos = anchorPosition(root.anchor, content.w, content.h, { w: vw, h: vh }, root.margin);
        panel = { x: pos.x, y: pos.y, w: content.w, h: content.h };
    }

    const items = [];
    placeGroup(root, {
        x: panel.x + padding,
        y: panel.y + padding,
        w: Math.max(0, panel.w - padding * 2),
        h: Math.max(0, panel.h - padding * 2),
    }, gap, -1, items, 0);
    return { panel, items };
}

function placeGroup(group, box, defaultGap, parent, out, depth) {
    if (depth > 16) return;
    const gap = size(group.gap, defaultGap);
    const rows = group.dir === 'rows';
    const innerMain = Math.max(0, rows ? box.h : box.w);
    const innerCross = Math.max(0, rows ? box.w : box.h);
    const fallbackAlign = alignOf(group.align, rows ? 'stretch' : 'center');

    // Естественные размеры: grow делит остаток главной оси пропорционально весу.
    const natural = [];
    let used = 0;
    let weights = 0;
    for (const item of group.items) {
        const measured = item.kind === 'group'
            ? measureGroup(item, defaultGap, 0, depth + 1)
            : { w: item.w, h: item.h };
        natural.push(measured);
        used += rows ? measured.h : measured.w;
        weights += Math.max(0, num(item.grow, 0));
    }
    const leftover = Math.max(0, innerMain - used - gap * Math.max(0, group.items.length - 1));

    let cursor = rows ? box.y : box.x;
    for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i];
        const measured = natural[i];
        const weight = Math.max(0, num(item.grow, 0));
        const main = (rows ? measured.h : measured.w) + (weights > 0 && weight > 0 ? leftover * (weight / weights) : 0);
        const align = alignOf(item.align, fallbackAlign);
        let cross = rows ? measured.w : measured.h;
        let cross_at = rows ? box.x : box.y;
        if (align === 'stretch') cross = innerCross;
        else if (align === 'center') cross_at += (innerCross - cross) / 2;
        else if (align === 'end') cross_at += innerCross - cross;

        const rect = rows
            ? { x: Math.round(cross_at), y: Math.round(cursor), w: Math.round(cross), h: Math.round(main) }
            : { x: Math.round(cursor), y: Math.round(cross_at), w: Math.round(main), h: Math.round(cross) };

        if (item.kind === 'leaf') {
            out.push({
                key: item.key,
                id: item.id,
                tag: item.tag,
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
                parent,
                text: item.text,
                tr: item.tr,
                size: item.size,
                color: item.color,
                style: item.style,
                action: item.action,
                on: item.on,
                attrs: item.attrs,
                disabled: item.disabled,
                focusable: item.focusable === undefined
                    ? (isFocusableTag(item.tag) && item.disabled !== true)
                    : (item.focusable === true && item.disabled !== true),
                index: out.length,
            });
        } else {
            const pad = size(item.padding, 0);
            // Группа со своим тегом — отдельный узел; без тега дети идут в
            // ближайшего родителя с узлом.
            const groupIndex = item.tag ? out.length : parent;
            if (item.tag) {
                out.push({
                    key: item.key,
                    id: item.id,
                    tag: item.tag,
                    x: rect.x,
                    y: rect.y,
                    w: rect.w,
                    h: rect.h,
                    parent,
                    group: true,
                    style: item.style,
                    focusable: false,
                    disabled: true,
                    index: out.length,
                });
            }
            placeGroup(item, {
                x: rect.x + pad,
                y: rect.y + pad,
                w: Math.max(0, rect.w - pad * 2),
                h: Math.max(0, rect.h - pad * 2),
            }, defaultGap, groupIndex, out, depth + 1);
        }
        cursor += main + gap;
    }
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

// Открытый экран один на процесс, а tickScreen вызывается из кадрового цикла
// без ссылки на $ — поэтому рабочее состояние лежит на уровне модуля.
let runtime = null;

/**
 * Поставить $.screen. Определения экранов живут в замыкании: повторный
 * installScreen() начинает с чистого списка экранов.
 */
export function installScreen($) {
    const api = $ || {};
    const definitions = new Map();
    const listeners = new Map();

    const rt = {
        api,
        current: null,        // { id, spec, layout, viewport, panel, backdrop, nodes, order, focus }
        viewportSize,
        relayout,
        moveFocus,
        setFocus,
        activate,
        close,
        emit,
        definitions,
    };

    function on(name, fn) {
        if (typeof fn !== 'function') return screen;
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
        return screen;
    }

    function emit(name, data) {
        const list = listeners.get(name);
        if (!list || !list.length) return;
        for (const fn of list.slice()) {
            try { fn(data === undefined ? {} : data); } catch (e) { ctx.log(`$.screen: ошибка в обработчике "${name}": ${e}`); }
        }
    }

    function viewportSize() {
        const win = api.window;
        if (win && typeof win.size === 'function') {
            const s = win.size();
            if (s && num(s.w, 0) > 0 && num(s.h, 0) > 0) return { w: num(s.w, 0), h: num(s.h, 0) };
        }
        const gfx = api.gfx;
        if (gfx && typeof gfx.size === 'function') {
            const s = gfx.size();
            if (s && num(s.w, 0) > 0 && num(s.h, 0) > 0) return { w: num(s.w, 0), h: num(s.h, 0) };
        }
        const e = typeof engine !== 'undefined' ? engine : null;
        return { w: num(e && e.width, 800), h: num(e && e.height, 600) };
    }

    /** Узел из обёртки $('<ui.button>', …): модуль работает и без методов обёртки. */
    function makeNode(tag, attrs) {
        let result = null;
        try {
            result = api('<' + tag + '>', attrs);
        } catch (e) {
            ctx.log(`$.screen: не удалось создать <${tag}> — ${e}`);
            return null;
        }
        if (!result) return null;
        if (result.nodes) return result.nodes[0] || null;
        return result.tag ? result : null;
    }

    function applyStyle(node, name) {
        const font = api.font;
        if (!name || !font || typeof font.apply !== 'function') return;
        font.apply(node, name);
    }

    /** Расставляет узлы по посчитанной раскладке (и при resize тоже). */
    function placeNodes() {
        const cur = rt.current;
        if (!cur) return;
        const vp = cur.viewport;
        if (cur.backdrop) {
            cur.backdrop.x = vp.w / 2;
            cur.backdrop.y = vp.h / 2;
            cur.backdrop.w = vp.w;
            cur.backdrop.h = vp.h;
        }
        for (const entry of cur.layout.items) {
            if (!entry.node) continue;
            entry.node.x = entry.x + entry.w / 2;
            entry.node.y = entry.y + entry.h / 2;
            entry.node.w = entry.w;
            entry.node.h = entry.h;
        }
    }

    function relayout() {
        const cur = rt.current;
        if (!cur) return;
        cur.viewport = viewportSize();
        cur.layout = layoutScreen(cur.spec, cur.viewport);
        // Узлы пересоздаются: раскладка могла добавить или убрать элемент.
        for (const node of cur.nodes) if (node && typeof node.destroy === 'function') node.destroy();
        cur.nodes = [];
        const panel = cur.panel;
        if (panel) {
            panel.x = cur.layout.panel.x + cur.layout.panel.w / 2;
            panel.y = cur.layout.panel.y + cur.layout.panel.h / 2;
            panel.w = cur.layout.panel.w;
            panel.h = cur.layout.panel.h;
        }
        buildItems(panel);
        cur.order = cur.layout.items.map((e, i) => (e.focusable ? i : -1)).filter((i) => i >= 0);
        if (cur.order.length) setFocus(cur.order.includes(cur.focus) ? cur.focus : cur.order[0], true);
        else cur.focus = -1;
    }

    /**
     * Создаёт узлы по раскладке. Индекс родителя — позиция в layout.items,
     * поэтому адресуем узлы картой, а не порядком удачных созданий.
     */
    function buildItems(panel) {
        const cur = rt.current;
        if (!cur) return;
        const by_index = new Map();
        for (const entry of cur.layout.items) {
            const attrs = { ...(entry.attrs || {}) };
            if (entry.id) attrs.id = entry.id;
            if (entry.text !== undefined) attrs.text = String(entry.text);
            if (entry.tr !== undefined) attrs.tr = entry.tr;
            if (entry.size !== undefined) attrs.size = entry.size;
            if (entry.color !== undefined) attrs.color = entry.color;
            if (entry.disabled) attrs.disabled = true;
            if (entry.on) attrs.on = entry.on;
            const node = makeNode(entry.tag, attrs);
            if (!node) continue;
            node.x = entry.x + entry.w / 2;
            node.y = entry.y + entry.h / 2;
            node.w = entry.w;
            node.h = entry.h;
            applyStyle(node, entry.style || (cur.spec && cur.spec.style));
            const parent = entry.parent >= 0 ? by_index.get(entry.parent) : panel;
            if (parent) { node.parent_node = parent; parent.child_nodes.push(node); }
            by_index.set(entry.index, node);
            entry.node = node;
        }
        cur.nodes = [...by_index.values()];
    }

    function setFocus(index, silent) {
        const cur = rt.current;
        if (!cur) return;
        const prev = cur.focus >= 0 ? cur.layout.items[cur.focus] : null;
        if (prev && prev.node) unhighlight(prev.node);
        cur.focus = index;
        const entry = index >= 0 ? cur.layout.items[index] : null;
        if (!entry || !entry.node) return;
        entry.node.addClass('screen-focus');
        entry.node.attrs.screenFocus = true;
        highlight(entry.node);
        if (!silent) emit('focus', { id: entry.id, node: entry.node, index });
    }

    /**
     * Подсветка фокуса. `.hovered` — единственное состояние, которое рисуют
     * ui-узлы, но ui._tick() сбрасывает его по положению мыши в КОНЦЕ кадра
     * (tickScreen идёт раньше), поэтому цвет меняем сами: у кнопки hover_color
     * и есть её подсвеченный вид. Исходный цвет возвращаем при снятии фокуса.
     */
    function highlight(node) {
        node.hovered = true;
        const accent = node.hover_color;
        if (accent === null || accent === undefined || accent === node.color) return;
        if (node.attrs._screenColor === undefined) node.attrs._screenColor = node.color;
        node.color = accent;
    }

    function unhighlight(node) {
        node.hovered = false;
        if (node.attrs._screenColor !== undefined) {
            node.color = node.attrs._screenColor;
            node.attrs._screenColor = undefined;
        }
    }

    function moveFocus(step) {
        const cur = rt.current;
        if (!cur || !cur.order.length) return false;
        const at = cur.order.indexOf(cur.focus);
        const next = at < 0 ? (step > 0 ? cur.order[0] : cur.order[cur.order.length - 1])
                            : cur.order[(at + step + cur.order.length) % cur.order.length];
        setFocus(next);
        return true;
    }

    function activate() {
        const cur = rt.current;
        if (!cur || cur.focus < 0) return false;
        const entry = cur.layout.items[cur.focus];
        if (!entry || !entry.node) return false;
        entry.node.emit('click', { button: 'left', keyboard: true, id: entry.id, action: entry.action });
        emit('activate', { id: entry.id, action: entry.action, node: entry.node, index: cur.focus });
        return true;
    }

    function close() {
        const cur = rt.current;
        if (!cur) return false;
        const id = cur.id;
        setFocus(-1, true);
        if (cur.panel && typeof cur.panel.destroy === 'function') cur.panel.destroy();
        if (cur.backdrop && typeof cur.backdrop.destroy === 'function') cur.backdrop.destroy();
        rt.current = null;
        emit('close', { id });
        return true;
    }

    const screen = {
        /** Объявить экран: $.screen.define('pause', { rows: [...] }). */
        define(id, spec) {
            if (id === undefined || id === null || id === '') {
                ctx.log('$.screen.define: нужно непустое имя экрана, например define("pause", { rows: [...] })');
                return screen;
            }
            if (!spec || typeof spec !== 'object') {
                ctx.log(`$.screen.define("${id}"): описание должно быть объектом с rows/columns`);
                return screen;
            }
            definitions.set(String(id), { ...spec, id: String(id) });
            return screen;
        },

        has(id) { return definitions.has(String(id)); },
        list() { return [...definitions.keys()].sort(); },
        remove(id) {
            definitions.delete(String(id));
            if (rt.current && rt.current.id === String(id)) close();
            return screen;
        },

        /**
         * Открыть экран по имени или по описанию:
         *   $.screen.open('pause');  $.screen.open({ rows: [{ text: 'Ещё' }] });
         * Возвращает обёртку панели или null, если открыть не вышло.
         */
        open(idOrSpec) {
            let spec = null;
            let id = null;
            if (typeof idOrSpec === 'string') {
                const def = definitions.get(idOrSpec);
                if (!def) {
                    ctx.log(`$.screen.open: экран "${idOrSpec}" не объявлен — см. $.screen.list()`);
                    return null;
                }
                spec = def;
                id = idOrSpec;
            } else if (idOrSpec && typeof idOrSpec === 'object') {
                spec = idOrSpec;
                id = spec.id === undefined || spec.id === null ? null : String(spec.id);
            } else {
                ctx.log('$.screen.open: нужно имя экрана или описание { rows/columns }');
                return null;
            }

            if (rt.current) close();

            const vp = viewportSize();
            const cur = {
                id,
                spec,
                layout: layoutScreen(spec, vp),
                viewport: vp,
                panel: null,
                backdrop: null,
                nodes: [],
                order: [],
                focus: -1,
            };
            rt.current = cur;

            if (spec.backdrop !== false) {
                const backdrop = makeNode('ui.panel', {
                    id: '__screen_backdrop',
                    color: spec.backdropColor || '#00000088',
                });
                if (backdrop) {
                    backdrop.layer = -1;
                    cur.backdrop = backdrop;
                }
            }
            const panel = makeNode('ui.panel', {
                id: id ? '__screen_' + id : '__screen',
                color: spec.color || '#101722ee',
            });
            if (!panel) {
                rt.current = null;
                if (cur.backdrop && typeof cur.backdrop.destroy === 'function') cur.backdrop.destroy();
                ctx.log('$.screen.open: не удалось создать узлы экрана — проверьте, что installUi() уже прошёл');
                return null;
            }
            cur.panel = panel;
            panel.x = cur.layout.panel.x + cur.layout.panel.w / 2;
            panel.y = cur.layout.panel.y + cur.layout.panel.h / 2;
            panel.w = cur.layout.panel.w;
            panel.h = cur.layout.panel.h;

            buildItems(panel);
            placeNodes();
            cur.order = cur.layout.items.map((e, i) => (e.focusable ? i : -1)).filter((i) => i >= 0);

            // Экран забирает фокус у контролов: иначе Enter нажал бы и кнопку
            // экрана, и узел, оставшийся в фокусе у widgets.js.
            if (api.ui && typeof api.ui.blur === 'function') api.ui.blur();
            emit('open', { id, node: panel });
            if (cur.order.length) setFocus(cur.order[0], true);
            return wrapOne(panel);
        },

        /** Закрыть открытый экран (узлы уничтожаются). */
        close,

        isOpen() { return !!rt.current; },
        /** Имя открытого экрана (у открытого по описанию — его id или null). */
        current() { return rt.current ? rt.current.id : null; },
        /** Обёртка панели открытого экрана. */
        panel() { return rt.current && rt.current.panel ? wrapOne(rt.current.panel) : null; },
        /** Узел элемента по id в обёртке $: $.screen.item('resume'). */
        item(id) {
            const entry = findEntry(id);
            return entry && entry.node ? wrapOne(entry.node) : null;
        },
        /** Прямоугольник элемента (левый верхний угол) — для тестов и агента. */
        rect(id) {
            const entry = findEntry(id);
            return entry ? { x: entry.x, y: entry.y, w: entry.w, h: entry.h } : null;
        },
        /** Прямоугольник панели открытого экрана. */
        panelRect() {
            return rt.current ? { ...rt.current.layout.panel } : null;
        },
        /** id всех элементов открытого экрана в порядке раскладки. */
        items() {
            if (!rt.current) return [];
            return rt.current.layout.items.filter((e) => e.id).map((e) => e.id);
        },

        /** Фокус на элемент по id: $.screen.focus('resume'). */
        focus(id) {
            const cur = rt.current;
            if (!cur) return false;
            const index = cur.layout.items.findIndex((e) => e.id === id && e.focusable);
            if (index < 0) {
                ctx.log(`$.screen.focus: элемент "${id}" не найден или не берёт фокус`);
                return false;
            }
            setFocus(index);
            return true;
        },
        /** id элемента в фокусе (или null). */
        focused() {
            const cur = rt.current;
            if (!cur || cur.focus < 0) return null;
            const entry = cur.layout.items[cur.focus];
            return entry ? entry.id : null;
        },
        /** Узел в фокусе (обёртка) или null. */
        focusedNode() {
            const cur = rt.current;
            if (!cur || cur.focus < 0) return null;
            const entry = cur.layout.items[cur.focus];
            return entry && entry.node ? wrapOne(entry.node) : null;
        },
        /** Следующий элемент по кругу. */
        next() { return moveFocus(1); },
        /** Предыдущий элемент по кругу. */
        prev() { return moveFocus(-1); },

        /**
         * Нажать на элементе в фокусе: узел получает 'click' (как от мыши), а
         * подписчики $.screen.on('activate') — событие с id и action.
         */
        activate,

        /** Подписка на события экрана: open/close/activate/focus. */
        on,
        off(name, fn) {
            if (!name) { listeners.clear(); return screen; }
            const list = listeners.get(name);
            if (!list) return screen;
            listeners.set(name, fn ? list.filter((f) => f !== fn) : []);
            return screen;
        },
        /** Сколько подписчиков у события — для тестов. */
        listenerCount(name) { return (listeners.get(name) || []).length; },
    };

    function findEntry(id) {
        const cur = rt.current;
        if (!cur || id === undefined) return null;
        return cur.layout.items.find((e) => e.id === id) || null;
    }

    runtime = rt;
    api.screen = screen;
    ctx.screen = screen;
    return screen;
}

// ---------------------------------------------------------------------------
// Кадровый шаг: клавиатура (стрелки/Enter/Escape) и мышь (фокус под курсором)
// ---------------------------------------------------------------------------

export function tickScreen(dt) {
    void dt;
    const rt = runtime;
    const cur = rt && rt.current;
    if (!cur) return;

    // Разрешение изменилось — пересчитываем раскладку и переносим узлы.
    const vp = rt.viewportSize();
    if (vp.w !== cur.viewport.w || vp.h !== cur.viewport.h) {
        rt.relayout();
    }

    const input = rt.api.input;
    if (!input) return;
    if (input.pressed('down') || input.pressed('right')) rt.moveFocus(1);
    else if (input.pressed('up') || input.pressed('left')) rt.moveFocus(-1);
    if (input.pressed('enter') || input.pressed('space')) rt.activate();
    else if (input.pressed('escape')) rt.close();

    // Мышь: фокус переходит на элемент под курсором. Клик по узлу уже шлёт
    // ui-слой (ui.js _tick) — второй раз отсюда не отправляем.
    if (!cur.order.length) return;
    // Подсветку фокуса ui-слой сбрасывает в конце кадра по положению мыши —
    // возвращаем её своему узлу (он единственный «в фокусе»).
    const focused = cur.focus >= 0 ? cur.layout.items[cur.focus] : null;
    if (focused && focused.node) focused.node.hovered = true;

    const m = typeof input.mouse === 'function' ? input.mouse() : null;
    // Геометрия точнее: если мышь в окне — берём узел под ней.
    let over = validMouse(m) ? entryAt(cur, m) : null;
    // Запасной путь: мышь в кадре не двигалась, но ui-слой уже выставил
    // .hovered на узле под курсором.
    if (!over) over = hoveredEntry(cur);
    if (!over || !over.focusable) return;
    const index = cur.layout.items.indexOf(over);
    if (index >= 0 && index !== cur.focus) rt.setFocus(index);
}

function validMouse(m) {
    return !!m && Number.isFinite(m.x) && Number.isFinite(m.y) && m.x >= 0 && m.y >= 0;
}

function entryAt(cur, m) {
    for (const entry of cur.layout.items) {
        if (!entry.node || entry.node.visible === false) continue;
        const hw = Math.abs(entry.node.w) / 2;
        const hh = Math.abs(entry.node.h) / 2;
        if (m.x >= entry.node.x - hw && m.x <= entry.node.x + hw &&
            m.y >= entry.node.y - hh && m.y <= entry.node.y + hh) return entry;
    }
    return null;
}

/** Узел с .hovered, кроме уже сфокусированного: свою подсветку не считаем. */
function hoveredEntry(cur) {
    for (let i = 0; i < cur.layout.items.length; i++) {
        const entry = cur.layout.items[i];
        if (i === cur.focus || !entry.focusable || !entry.node) continue;
        if (entry.node.visible !== false && entry.node.hovered) return entry;
    }
    return null;
}
