// ===========================================================================
// Зоны-триггеры: событие enter / leave + покадровые наблюдатели пересечений.
//
// Тег <trigger> в ядре объявлен, но ничего не делал: узел рисовался и молчал.
// Этот модуль наполняет его смыслом:
//
//   $('<trigger>', { id: 'door' }).at(300, 300).size(80, 80).appendTo($.world);
//   $('#door').on('enter', (e) => $.sound.play('door'));
//   $('#door').on('leave', (e) => $.log('вышел ' + e.data.other.get(0).id));
//
// Здесь же живёт реестр `watchOverlap` — на нём интегратор замыкает
// `.overlaps(sel, cb)`, который раньше подписывался на событие 'tick' и
// поэтому не срабатывал ни разу.
//
// Ключевые решения:
//   * список целей собирается ОДИН раз за кадр (один проход по ctx.nodes),
//     дальше каждая зона фильтрует его по своему attrs.detect;
//   * зона и другие зоны никогда не попадают в цели — иначе триггеры
//     срабатывали бы друг на друга;
//   * исчезнувшая цель считается вышедшей: событие leave всё равно приходит,
//     а в e.data.other лежит уже удалённый узел (removed === true);
//   * zoneContains/diffOverlaps — чистые функции, их проверяет qjs-харнесс
//     (см. _CONTRACT.md §4); модуль не обращается к engine на верхнем уровне.
// ===========================================================================

import { ctx, Node, wrapOne, query, registrySummary } from './core.js';

// ---------------------------------------------------------------------------
// Чистые функции (экспортируются — тестируются qjs)
// ---------------------------------------------------------------------------

/**
 * Прямоугольник объекта в мировых координатах. Понимает и узел, и простой
 * дескриптор { x, y, w, h } — так чистые функции можно проверять без узлов.
 * Повторяет правила nodeBounds из ядра, но не требует экземпляр Node:
 * хитбокс и масштаб учитываются, если заданы.
 */
function rectOf(obj, out) {
    const r = out || { x0: 0, y0: 0, x1: 0, y1: 0 };
    if (!obj) { r.x0 = r.y0 = r.x1 = r.y1 = 0; return r; }
    const w = obj.hitbox ? obj.hitbox.w : obj.w;
    const h = obj.hitbox ? obj.hitbox.h : obj.h;
    const sx = Math.abs(obj.scale_x === undefined ? 1 : obj.scale_x);
    const sy = Math.abs(obj.scale_y === undefined ? 1 : obj.scale_y);
    const hw = ((w === undefined ? 0 : Number(w)) / 2) * (isFinite(sx) ? sx : 1);
    const hh = ((h === undefined ? 0 : Number(h)) / 2) * (isFinite(sy) ? sy : 1);
    const x = Number(obj.x) || 0;
    const y = Number(obj.y) || 0;
    r.x0 = x - hw; r.y0 = y - hh; r.x1 = x + hw; r.y1 = y + hh;
    return r;
}

// Переиспользуемые прямоугольники: пара «зона × цель» на каждом кадре давала
// два новых объекта (docs/HIGH_LEVEL_API_PERF.md §3.3).
const RECT_A = { x0: 0, y0: 0, x1: 0, y1: 0 };
const RECT_B = { x0: 0, y0: 0, x1: 0, y1: 0 };

/**
 * Пересекаются ли прямоугольники зоны и узла. Строгое пересечение: общий край
 * (касание) входом не считается — так же, как boundsOverlap в ядре.
 */
export function zoneContains(zone, node) {
    if (!zone || !node) return false;
    const a = rectOf(zone, RECT_A);
    const b = rectOf(node, RECT_B);
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function toSet(value) {
    if (value instanceof Set) return value;
    if (Array.isArray(value)) return new Set(value);
    if (value && Array.isArray(value.nodes)) return new Set(value.nodes);
    return new Set();
}

/**
 * Разница двух множеств целей: кто вошёл и кто вышел.
 * Возвращает { entered, left } — массивы в порядке nextSet/prevSet.
 * Работает и с Set, и с массивами (удобно в тестах).
 */
export function diffOverlaps(prevSet, nextSet) {
    const prev = toSet(prevSet);
    const next = toSet(nextSet);
    const entered = [];
    const left = [];
    for (const node of next) if (!prev.has(node)) entered.push(node);
    for (const node of prev) if (!next.has(node)) left.push(node);
    return { entered, left };
}

/** Зона ли это: тег trigger, класс trigger или attrs.trigger === true. */
export function isZoneNode(node) {
    if (!node) return false;
    if (node.tag === 'trigger') return true;
    if (node.classes && typeof node.classes.has === 'function' && node.classes.has('trigger')) return true;
    return !!(node.attrs && node.attrs.trigger === true);
}

// ---------------------------------------------------------------------------
// Отбор целей
// ---------------------------------------------------------------------------

function matchesOne(node, detect) {
    if (detect === null || detect === undefined || detect === false) return false;
    if (typeof detect === 'function') return !!detect(node);
    if (typeof detect === 'string') {
        const sel = detect.trim();
        if (!sel) return false;
        return !!(node.matches && node.matches(sel));
    }
    if (typeof detect === 'object') {
        if (Array.isArray(detect.nodes)) return detect.nodes.indexOf(node) >= 0;  // Wrapper
        if (Array.isArray(detect)) return detect.some((d) => matchesOne(node, d));
        if (detect.uid !== undefined) return detect === node;                     // сам узел
    }
    return false;
}

function matchesDetect(node, detect) {
    if (Array.isArray(detect)) return detect.some((d) => matchesOne(node, d));
    return matchesOne(node, detect);
}

/**
 * Кого зона считает целями. По умолчанию — узлы с физическим телом; если у
 * зоны задан attrs.detect (селектор/тег/класс/функция/массив) — только
 * совпавшие с ним узлы, даже без тела. Зоны из целей исключены всегда.
 */
function selectTargets(zone, all, bodies) {
    const detect = zone.attrs ? zone.attrs.detect : undefined;
    if (detect === undefined || detect === null || detect === false) return bodies;
    const out = [];
    for (let i = 0; i < all.length; i++) {
        const node = all[i];
        if (node === zone || isZoneNode(node)) continue;
        if (matchesDetect(node, detect)) out.push(node);
    }
    return out;
}

/** Цели, которые пересекают зону прямо сейчас (для inside/count). */
function overlapsOf(zone, all, bodies) {
    const out = [];
    const targets = selectTargets(zone, all, bodies);
    for (let i = 0; i < targets.length; i++) {
        if (zoneContains(zone, targets[i])) out.push(targets[i]);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Снимок мира за кадр
// ---------------------------------------------------------------------------

// Массивы переиспользуются между кадрами: обход ctx.nodes должен быть один,
// а не «на каждую цель заново» (см. требования к производительности).
const all_list = [];
const body_list = [];
const zone_list = [];

function collectFrame() {
    all_list.length = 0;
    body_list.length = 0;
    zone_list.length = 0;
    const nodes = ctx.nodes;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node || node.removed) continue;
        if (node.attrs && node.attrs.ui) continue;   // интерфейс живёт в экранных координатах
        all_list.push(node);
        if (isZoneNode(node)) zone_list.push(node);
        else if (node.body >= 0) body_list.push(node);
    }
}

// ---------------------------------------------------------------------------
// Зоны
// ---------------------------------------------------------------------------

function overlapData(zone, other) {
    return { other: wrapOne(other), self: wrapOne(zone) };
}

function updateZone(zone, all, bodies) {
    const prev = zone.__trigPrev instanceof Set ? zone.__trigPrev : new Set();
    let next;
    if (zone.visible === false) {
        // Скрытая зона не работает. Если до этого кого-то видели — это выход,
        // иначе игра «забыла» бы про leave при выключенной зоне.
        next = new Set();
    } else {
        next = new Set(overlapsOf(zone, all, bodies));
    }
    zone.__trigPrev = next;

    const { entered, left } = diffOverlaps(prev, next);
    for (let i = 0; i < entered.length; i++) zone.emit('enter', overlapData(zone, entered[i]));
    for (let i = 0; i < left.length; i++) {
        // Цель могла быть удалена — leave всё равно нужен, чтобы обработчики
        // не остались в состоянии «внутри». e.data.other.removed будет true.
        zone.emit('leave', overlapData(zone, left[i]));
    }
}

// ---------------------------------------------------------------------------
// Наблюдатели .overlaps(sel, cb)
// ---------------------------------------------------------------------------

const watchers = [];
let prune_needed = false;

/**
 * Покадровый наблюдатель пересечения: каждый кадр вызывает
 * cb(обёрткаНайденнойЦели | null, обёрткаСамого). Потерянные (удалённые) цели
 * пропускаются и дают null, а не исключение. Возвращает функцию отписки.
 *
 * Это точка подключения для api.js: .overlaps(sel, cb) должен звать
 * watchOverlap(node, query(sel), cb) — сам api.js правит интегратор.
 */
export function watchOverlap(node, others, cb) {
    if (!node || typeof cb !== 'function') return () => {};
    const list = Array.isArray(others) ? others
        : (others && Array.isArray(others.nodes) ? others.nodes : []);
    const watcher = { node, others: list, cb, alive: true };
    watchers.push(watcher);
    return () => { watcher.alive = false; prune_needed = true; };
}

function updateWatchers() {
    for (let i = 0; i < watchers.length; i++) {
        const watcher = watchers[i];
        if (!watcher.alive) { prune_needed = true; continue; }
        const self = watcher.node;
        if (!self || self.removed) { watcher.alive = false; prune_needed = true; continue; }
        let hit = null;
        for (let j = 0; j < watcher.others.length; j++) {
            const other = watcher.others[j];
            if (!other || other === self || other.removed) continue;
            if (zoneContains(self, other)) { hit = other; break; }
        }
        try {
            watcher.cb(hit ? wrapOne(hit) : null, wrapOne(self));
        } catch (e) {
            ctx.log(`$.triggers: ошибка в наблюдателе .overlaps(): ${e}`);
        }
    }
    if (prune_needed) pruneWatchers();
}

function pruneWatchers() {
    prune_needed = false;
    for (let i = watchers.length - 1; i >= 0; i--) {
        if (!watchers[i].alive) watchers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Кадровый тик
// ---------------------------------------------------------------------------

/**
 * Обрабатывает все зоны и наблюдателей. Вызывается из api.js раз в кадр
 * (tickTriggers). dt не участвует в расчёте пересечений — они зависят от
 * позиций, уже синхронизированных из физики; параметр оставлен для
 * единообразия с другими tick-функциями.
 */
export function tickTriggers(dt) {
    void dt;
    // Ни зон, ни наблюдателей — снимок мира (полный проход по реестру) не
    // нужен никому (§3.3 отчёта). Сводка кэшируется на версию реестра.
    if (watchers.length === 0 && registrySummary('trigger_zones', countZoneNodes) === 0) return;
    collectFrame();
    for (let i = 0; i < zone_list.length; i++) updateZone(zone_list[i], all_list, body_list);
    updateWatchers();
}

/** Сколько в реестре узлов-зон (тот же предикат, что у collectFrame). */
function countZoneNodes(nodes) {
    let count = 0;
    for (let i = 0; i < nodes.length; i++) if (isZoneNode(nodes[i])) count++;
    return count;
}

// ---------------------------------------------------------------------------
// Установка подсистемы
// ---------------------------------------------------------------------------

function resolveNode(value) {
    if (!value) return null;
    if (value.nodes) return value.nodes[0] || null;
    if (typeof value === 'string') return query(value)[0] || null;
    return value;
}

export function installTriggers($) {
    $.triggers = {
        /**
         * Создаёт зону. opts:
         *   { x, y, w, h, detect, id, class, color, alpha, visible, tag,
         *     parent, onEnter(other, self), onLeave(other, self) }
         * x/y — центр, как у остальных узлов. По умолчанию тег <trigger>
         * (полупрозрачный зелёный прямоугольник). visible: false выключает
         * зону; чтобы зона была невидимой, но рабочей — color/alpha.
         */
        zone(opts) {
            const o = opts || {};
            const node = new Node(o.tag || 'trigger', {
                x: o.x === undefined ? 0 : o.x,
                y: o.y === undefined ? 0 : o.y,
                w: o.w === undefined ? 100 : o.w,
                h: o.h === undefined ? 100 : o.h,
            });
            if (o.id !== undefined) node.set('id', o.id);
            if (o.class !== undefined) node.addClass(o.class);
            if (o.color !== undefined) node.set('color', o.color);
            if (o.alpha !== undefined) node.set('alpha', o.alpha);
            if (o.visible !== undefined) node.visible = !!o.visible;
            if (o.detect !== undefined) node.attrs.detect = o.detect;
            if (typeof o.onEnter === 'function') {
                node.on('enter', (e) => o.onEnter(e.data.other, e.data.self));
            }
            if (typeof o.onLeave === 'function') {
                node.on('leave', (e) => o.onLeave(e.data.other, e.data.self));
            }
            const parent = o.parent === undefined ? ($ && $.world) : o.parent;
            // appendTo живёт в api.js: в юнит-тесте без него зона всё равно
            // работает, потому что Node уже лежит в ctx.nodes.
            if (parent && typeof node.appendTo === 'function') node.appendTo(parent);
            return wrapOne(node);
        },

        /** Все зоны мира (массив обёрток) в порядке создания. */
        list() {
            const out = [];
            for (const node of ctx.nodes) if (isZoneNode(node)) out.push(wrapOne(node));
            return out;
        },

        /** Убирает ВСЕ зоны мира; история пересечений уходит вместе с ними. */
        clear() {
            for (const node of ctx.nodes.slice()) {
                if (isZoneNode(node)) node.destroy();
            }
            return $;
        },

        /** Пересекается ли узел с зоной сейчас (bool). Принимает и селекторы. */
        inside(zone, node) {
            const z = resolveNode(zone);
            const n = resolveNode(node);
            return !!(z && n && z !== n && zoneContains(z, n));
        },

        /**
         * Сколько живых целей сейчас в зоне (с учётом её attrs.detect).
         * Собирает свой снимок мира, а не переиспользует кадровый: count()
         * может быть вызван из обработчика enter прямо во время tickTriggers.
         */
        count(zone) {
            const z = resolveNode(zone);
            if (!z) return 0;
            const all = [];
            const bodies = [];
            for (const node of ctx.nodes) {
                if (!node || node.removed) continue;
                if (node.attrs && node.attrs.ui) continue;
                all.push(node);
                if (!isZoneNode(node) && node.body >= 0) bodies.push(node);
            }
            return overlapsOf(z, all, bodies).length;
        },
    };
    return $;
}
