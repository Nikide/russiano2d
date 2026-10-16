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

import { ctx, Node, wrapOne, query, facetCount, def, engineOf, isLocalSpace, worldPointOf } from './core.js';
import { engine } from './native.js';

// ---------------------------------------------------------------------------
// §44. Политики обработки узла (processing)
// ---------------------------------------------------------------------------
//
// Четыре разных операции, которые нельзя смешивать:
//   * `.visible(false)/.hide()` — узел не рисуется (визуал);
//   * сон тела (`engine.setAwake`) — физика не считает спящее тело;
//   * политика обработки (§44) — узел не получает кадровых/фиксированных
//     обновлений, таймеров или участия в физике;
//   * `.areaOn(name, false)` (§40) — выключенная sensor-область.
//
// Политика — opt-in данные: пока её никто не задавал, `processingAllows()`
// выходит первой строкой и ничего не стоит. Наследование — от области
// владения §5 (`$.scene.scope`), и только если игра явно позвала
// `$.processing.scope(scope, spec)`; узлы, взятые областью через `scope.node()`,
// запоминают её и получают политику области.

/** Поля политики: что именно отключается. */
export const PROCESSING_FIELDS = ['update', 'fixed', 'animation', 'timers', 'physics'];

/** Умолчания: всё обрабатывается (поведение до §44 не меняется). */
export const PROCESSING_DEFAULTS = {
    update: true, fixed: true, animation: true, timers: true, physics: true,
};

/** «Неактивный» набор: движение, фиксированный шаг, таймеры и физика стоят,
 *  анимация НЕ трогается — завершение клипа обязано доиграть (приёмка §44). */
export const PROCESSING_INACTIVE = {
    update: false, fixed: false, animation: true, timers: false, physics: false,
};

const PRESET_PROCESSING = new Map();     // имя → patch
const scope_policies = new WeakMap();    // scope (§5) → patch
const policy_nodes = [];                 // узлы с явной политикой (для физики)
let policy_ver = 1;                      // версия: кэш эффективной политики на узле

/**
 * Привести частичный набор к понятному виду: неизвестные поля отбрасываются,
 * `movement` — читаемый псевдоним `update` (контроллер/движение), `true` —
 * «всё включено», `false` — «всё выключено, кроме анимации» (как `.active(false)`).
 */
export function normalizeProcessing(spec) {
    if (spec === undefined || spec === null) return null;
    if (spec === true) return Object.assign({}, PROCESSING_DEFAULTS);
    if (spec === false) return Object.assign({}, PROCESSING_INACTIVE);
    if (typeof spec === 'string') {
        const preset = PRESET_PROCESSING.get(spec);
        return preset ? Object.assign({}, preset) : null;
    }
    if (typeof spec !== 'object') return null;
    const out = {};
    for (const key of Object.keys(spec)) {
        const field = key === 'movement' ? 'update' : key;
        if (PROCESSING_FIELDS.indexOf(field) < 0) continue;
        out[field] = spec[key] !== false;
    }
    return out;
}

/** Слить слои политики: умолчания → область → узел. Возвращает полный набор. */
export function mergeProcessing(...layers) {
    const out = Object.assign({}, PROCESSING_DEFAULTS);
    for (const layer of layers) {
        if (!layer) continue;
        for (const key of PROCESSING_FIELDS) {
            if (layer[key] !== undefined) out[key] = layer[key] !== false;
        }
    }
    return out;
}

function ownPatch(node) {
    return node && node.attrs ? (node.attrs.processing || null) : null;
}

function scopePatchOf(node) {
    const scope = node ? node._scope_ref : null;
    return scope ? (scope_policies.get(scope) || null) : null;
}

/** Эффективная политика узла (кэш на версию политик). */
export function effectiveProcessing(node) {
    if (!node || node.removed) return Object.assign({}, PROCESSING_DEFAULTS);
    const own = ownPatch(node);
    const scope = scopePatchOf(node);
    const cached = node._proc_cache;
    // Кэш проверяет и сами слои: узел из пула мог сохранить старую запись,
    // а политику с него сняли — вернуть её было бы враньём.
    if (cached && cached.ver === policy_ver && cached.own === own && cached.scope === scope) {
        return cached.value;
    }
    const value = mergeProcessing(scope, own);
    node._proc_cache = { ver: policy_ver, own, scope, value };
    return value;
}

/**
 * Разрешена ли обработка узла этого вида. Горячий путь: узлы без политики
 * выходят здесь же, без слияния слоёв.
 */
export function processingAllows(node, kind) {
    if (policy_ver === 1 && policy_nodes.length === 0) return true;
    if (!node) return true;
    const own = ownPatch(node);
    const scope = scopePatchOf(node);
    if (!own && !scope) return true;
    const value = effectiveProcessing(node);
    return value[kind] !== false;
}

function rememberPolicyNode(node) {
    if (node && policy_nodes.indexOf(node) < 0) policy_nodes.push(node);
}

/** Записать политику на узел. `null` — снять (вернуть умолчания). */
function setNodeProcessing(node, spec) {
    const patch = normalizeProcessing(spec);
    if (!node || !node.attrs) return false;
    if (patch === null) delete node.attrs.processing;
    else node.attrs.processing = patch;
    node._proc_cache = null;
    node._proc_body = undefined;
    policy_ver++;
    rememberPolicyNode(node);
    return true;
}

/** Пометить узлы областью: их политика наследуется от `scope`. */
function stampScope(value, scope) {
    const list = value && value.nodes ? value.nodes : (Array.isArray(value) ? value : [value]);
    for (const node of list) {
        if (node && !node.removed) node._scope_ref = scope;
    }
}

// ---------------------------------------------------------------------------
// §44. Visibility/activation: enter/exit видимой области или региона
// ---------------------------------------------------------------------------
//
// Считаем по РЕАЛЬНЫМ world bounds узла (`rectOf`: hitbox, подписанный scale,
// и — для local-space узлов §39 — скомпонованный мировой трансформ), а не по
// camera-space: камера не участвует в координатах узла.
//
// Пороги разные для входа и выхода (hysteresis): вошли при
// `margin + hysteresis`, вышли при `margin`. На границе кадра это не даёт
// дребезга enter/exit.

const activation_watchers = [];

/** Прямоугольник узла в мировых координатах; local-space узел сначала компонуется. */
export function activationBounds(node) {
    if (!node) return null;
    if (isLocalSpace(node)) worldPointOf(node, 0, 0);   // §39: домотать цепочку
    return rectOf(node, { x0: 0, y0: 0, x1: 0, y1: 0 });
}

/** Расширить прямоугольник на `margin` пикселей во все стороны. */
export function expandRect(rect, margin) {
    const m = Number(margin) || 0;
    return { x0: rect.x0 - m, y0: rect.y0 - m, x1: rect.x1 + m, y1: rect.y1 + m };
}

/** Пересекается ли прямоугольник узла хоть с одним прямоугольником (с полем). */
export function rectsOverlapAny(bounds, rects) {
    if (!bounds || !rects || rects.length === 0) return false;
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (bounds.x0 < r.x1 && bounds.x1 > r.x0 && bounds.y0 < r.y1 && bounds.y1 > r.y0) return true;
    }
    return false;
}

/**
 * Состояние видимости с hysteresis: пока не были внутри — проверяем по
 * `enter_margin`, уже внутри — по `exit_margin` (он БОЛЬШЕ: из активной зоны
 * узел должен уйти дальше, чем нужно было для входа, — так граница кадра не
 * даёт дребезга enter/exit).
 */
export function activationInside(bounds, rects, prev_inside, enter_margin, exit_margin) {
    const margin = prev_inside ? exit_margin : enter_margin;
    return rectsOverlapAny(bounds, rects.length ? rects.map((r) => expandRect(r, margin)) : rects);
}

/**
 * Выбор камер для политики `any`/`main`/имя/индекс/список. Возвращает
 * подмножество `views` в исходном порядке.
 */
export function selectCameras(views, policy) {
    const list = views || [];
    if (list.length === 0) return list;
    if (policy === undefined || policy === null || policy === 'any') return list;
    if (policy === 'main') return list.slice(0, 1);
    const wanted = Array.isArray(policy) ? policy : [policy];
    const out = [];
    for (const want of wanted) {
        for (let i = 0; i < list.length; i++) {
            const view = list[i];
            if (view.name === want || i === want) {
                if (out.indexOf(view) < 0) out.push(view);
                break;
            }
        }
    }
    return out;
}

/**
 * Вид камеры (`$.camera.views()`: имя, центр x/y, zoom и экранный регион)
 * → прямоугольник видимого мира.
 */
export function viewToWorldRect(view, screen_w, screen_h) {
    const zoom = Number(view.zoom) > 0 ? Number(view.zoom) : 1;
    const rect = view.rect || null;
    const w = ((rect && Number(rect.w) > 0 ? Number(rect.w) : screen_w) || 0) / zoom;
    const h = ((rect && Number(rect.h) > 0 ? Number(rect.h) : screen_h) || 0) / zoom;
    const cx = Number(view.x) || 0;
    const cy = Number(view.y) || 0;
    return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, name: view.name || 'main' };
}

/** Видимые прямоугольники мира для выбранных камер (main — если камер нет). */
function activationRects(opts) {
    const cam = ctx.camera;
    const extra = ctx.viewports;
    let views = null;
    if (cam && typeof cam.views === 'function') {
        try { views = cam.views(); } catch (e) { views = null; }
    }
    if ((!views || views.length === 0) && extra && typeof extra.describe === 'function') {
        try { views = extra.describe(); } catch (e) { views = null; }
    }
    if (!views || views.length === 0) {
        if (cam && typeof cam.viewport === 'function') {
            const vp = cam.viewport();
            return [{ x0: vp.x, y0: vp.y, x1: vp.x + vp.w, y1: vp.y + vp.h, name: 'main' }];
        }
        return [];
    }
    const picked = selectCameras(views, opts ? opts.cameras : 'any');
    const sw = Number(engine.width) || 0;
    const sh = Number(engine.height) || 0;
    return picked.map((v) => viewToWorldRect(v, sw, sh));
}

/** Прямоугольник региона из `{x,y,w,h}`, узла, обёртки или селектора. */
function regionRect(value) {
    if (!value) return null;
    if (typeof value === 'string') return regionRect(query(value)[0] || null);
    if (value.nodes) return regionRect(value.nodes[0] || null);
    if (value.x0 !== undefined) return value;
    if (value.x !== undefined && value.w !== undefined && value.h !== undefined) {
        const hw = Math.abs(Number(value.w)) / 2;
        const hh = Math.abs(Number(value.h)) / 2;
        const cx = Number(value.x);
        const cy = Number(value.y);
        return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
    }
    return activationBounds(value);
}

function rectsForWatcher(watcher) {
    if (watcher.region) {
        const r = regionRect(watcher.region);
        watcher.rects[0] = r;
        watcher.rects.length = r ? 1 : 0;
        return watcher.rects;
    }
    const rects = activationRects(watcher.opts);
    watcher.rects.length = 0;
    for (let i = 0; i < rects.length; i++) watcher.rects.push(rects[i]);
    return watcher.rects;
}

function resolveNodes(value) {
    if (!value) return [];
    if (typeof value === 'string') return query(value);
    if (value.nodes) return value.nodes.slice();
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value];
}

function emitActivation(node, name, payload) {
    try { node.emit(name, payload); } catch (e) { ctx.log(`$.activation: ошибка в обработчике "${name}": ${e}`); }
}

function tickActivation() {
    for (let i = activation_watchers.length - 1; i >= 0; i--) {
        const watcher = activation_watchers[i];
        if (!watcher.alive) { activation_watchers.splice(i, 1); continue; }
        const rects = rectsForWatcher(watcher);
        let live = 0;
        for (let j = 0; j < watcher.nodes.length; j++) {
            const node = watcher.nodes[j];
            const was = watcher.inside.get(node) === true;
            if (!node || node.removed) {
                // Исчезнувший узел считается вышедшим: обработчик не остаётся
                // в состоянии «внутри» (§11, поведение при destroy участника).
                if (was) watcher.inside.set(node, false);
                watcher.inside.delete(node);      // мёртвый узел не держим в карте
                continue;
            }
            live++;
            const bounds = activationBounds(node);
            const now = activationInside(bounds, rects, was,
                                         watcher.enter_margin, watcher.exit_margin);
            // `wakeForever`: после первого входа выход игнорируется — состояние
            // «внутри» и обработка остаются включёнными.
            if (!now && watcher.wake_forever && watcher.entered.has(node)) continue;
            if (now === was) continue;
            if (now) watcher.entered.add(node);
            watcher.inside.set(node, now);
            const payload = {
                activation: watcher.name,
                camera: rects.length === 1 ? (rects[0].name || null) : null,
                margin: now ? watcher.enter_margin : watcher.exit_margin,
                visible: now,
                self: wrapOne(node),
            };
            emitActivation(node, now ? watcher.enter_event : watcher.exit_event, payload);
            try {
                if (now && typeof watcher.opts.onEnter === 'function') watcher.opts.onEnter(wrapOne(node));
                if (!now && typeof watcher.opts.onExit === 'function') watcher.opts.onExit(wrapOne(node));
            } catch (e) { ctx.log(`$.activation: ошибка в onEnter/onExit: ${e}`); }
            if (once_fired(watcher, now)) { watcher.alive = false; break; }
        }
        if (live === 0 && watcher.prune_when_empty !== false) watcher.alive = false;
        if (!watcher.alive) activation_watchers.splice(i, 1);
    }
}

/** `once: true` — сработать один раз при первом входе и отписаться. */
function once_fired(watcher, now) {
    if (!watcher.once || !now) return false;
    watcher.once_done = true;
    return true;
}

/** Нормализовать один watcher (используют watch/auto/visible). */
function makeWatcher(nodes, opts) {
    const o = opts || {};
    const margin = Number(o.margin) || 0;
    const hysteresis = Number(o.hysteresis) || 0;
    const region = o.region === undefined ? null : o.region;
    const base = o.event || (region ? 'region' : 'screen');
    return {
        name: o.name || base,
        nodes,
        inside: new Map(),
        rects: [],
        region,
        // H8: `wakeForever` — разбудили и больше не усыпляем. Узел, вышедший из
        // зоны, не должен глохнуть на полпути (запрос BASHNYA).
        wake_forever: o.wakeForever === true,
        entered: new Set(),
        opts: o,
        enter_margin: margin,
        exit_margin: margin + hysteresis,
        enter_event: `${base}:enter`,
        exit_event: `${base}:exit`,
        once: o.once === true,
        alive: true,
    };
}

function watchActivation(value, opts) {
    const nodes = resolveNodes(value);
    const watcher = makeWatcher(nodes, opts);
    if (nodes.length === 0) { watcher.alive = false; return watcherHandle(watcher); }
    activation_watchers.push(watcher);
    return watcherHandle(watcher);
}

function watcherHandle(watcher) {
    return {
        stop() { watcher.alive = false; },
        active() { return watcher.alive; },
        nodes() { return watcher.nodes.slice(); },
        inside(node) {
            if (node === undefined) return watcher.inside;
            return watcher.inside.get(node) === true;
        },
        rects() { return watcher.rects.map((r) => Object.assign({}, r)); },
    };
}

function activationVisible(value, opts) {
    const o = opts || {};
    const nodes = resolveNodes(value);
    if (nodes.length === 0) return false;
    const watcher = makeWatcher(nodes, o);
    const rects = rectsForWatcher(watcher);
    const prev = o.inside === true;
    const bounds = activationBounds(nodes[0]);
    return activationInside(bounds, rects, prev, watcher.enter_margin, watcher.exit_margin);
}

// ---------------------------------------------------------------------------
// §44. Физика: участие тела в симуляции (не сон!)
// ---------------------------------------------------------------------------
//
// `physics: false` выключает ТЕЛО (`engine.setBodyEnabled`): оно не падает, не
// сталкивается и не двигается, но остаётся живым и возвращается как было.
// Это не `.visible(false)` (визуал не трогается) и не сон (`setAwake`: спящее
// тело продолжает участвовать, проснётся от толчка).

function readBodyEnabled(id) {
    const eng = engineOf();
    if (eng && typeof eng.bodyEnabled === 'function') {
        try { return eng.bodyEnabled(id) !== false; } catch (e) { return true; }
    }
    return true;
}

function writeBodyEnabled(id, on) {
    const eng = engineOf();
    if (eng && typeof eng.setBodyEnabled === 'function') {
        try { eng.setBodyEnabled(id, on); } catch (e) { ctx.log(`$.processing: тело ${id}: ${e}`); }
    }
}

/** Применить политику физики ко всем узлам, которым её задавали. */
export function applyProcessing() {
    if (policy_nodes.length === 0) return 0;
    let changed = 0;
    for (let i = policy_nodes.length - 1; i >= 0; i--) {
        const node = policy_nodes[i];
        if (!node || node.removed) { policy_nodes.splice(i, 1); continue; }
        if (node.body < 0) continue;
        const want = effectiveProcessing(node).physics;
        if (want === false) {
            if (readBodyEnabled(node.body)) { writeBodyEnabled(node.body, false); changed++; }
            node._proc_body = false;
        } else if (node._proc_body !== true) {
            // Либо тело выключали мы, либо политику только что задали/сняли:
            // сверяемся с движком, а не с догадкой по кэшу (кэш сбрасывается
            // при каждой смене политики, и «undefined» — это не «включено»).
            if (!readBodyEnabled(node.body)) { writeBodyEnabled(node.body, true); changed++; }
            node._proc_body = true;
        }
    }
    return changed;
}

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

/**
 * Часы зоны для `stay`/`cooldown`: игровое время (`game`, по умолчанию) или
 * шаги симуляции (`ticks`). На паузе игровое время стоит — и `stay` молчит;
 * тиковый вариант останавливается вместе с шагом физики (§6/§44).
 */
function zoneClock(zone) {
    if (zone.attrs && zone.attrs.clock === 'ticks') {
        return ctx.time && typeof ctx.time.tick === 'function' ? ctx.time.tick() : 0;
    }
    return ctx.time && typeof ctx.time.now === 'function' ? ctx.time.now() * 1000 : 0;
}

function zoneCooldown(zone) {
    const raw = zone.attrs ? zone.attrs.cooldown : undefined;
    return Number(raw) > 0 ? Number(raw) : 0;
}

function zoneStayStep(zone) {
    const a = zone.attrs || {};
    if (a.clock === 'ticks') return Number(a.stay_ticks) > 0 ? Number(a.stay_ticks) : 0;
    return a.stay_ms === undefined ? 0 : Math.max(0, Number(a.stay_ms) || 0);
}

/**
 * Обновить зону за кадр. Контракт §11: `enter` при входе, `stay` пока цель
 * внутри (по своему интервалу), `leave` при выходе; `once` — единственный
 * `enter` за всё время; `cooldown` — не чаще одного `enter` на цель за окно.
 */
function updateZone(zone, all, bodies) {
    const prev = zone.__trigPrev instanceof Set ? zone.__trigPrev : new Set();
    const done = zone.__trigDone === true;
    let next;
    if (zone.visible === false || done) {
        // Скрытая (или уже сработавшая once) зона не работает. Если до этого
        // кого-то видели — это выход, иначе игра «забыла» бы про leave.
        next = new Set();
    } else {
        next = new Set(overlapsOf(zone, all, bodies));
    }
    zone.__trigPrev = next;
    if (!zone.__trigMuted) zone.__trigMuted = new Set();
    if (!zone.__trigStay) zone.__trigStay = new Map();

    const now = zoneClock(zone);
    const cooldown = zoneCooldown(zone);
    const { entered, left } = diffOverlaps(prev, next);

    for (let i = 0; i < entered.length; i++) {
        const target = entered[i];
        const last = zone.__trigCd ? zone.__trigCd.get(target) : undefined;
        if (cooldown > 0 && last !== undefined && now - last < cooldown) {
            // В окне cooldown: событий нет вовсе (ни enter, ни leave) — иначе
            // обработчик увидел бы выход из зоны, в которую не входил.
            zone.__trigMuted.add(target);
            continue;
        }
        if (!zone.__trigCd) zone.__trigCd = new Map();
        zone.__trigCd.set(target, now);
        // Вход считается первым «касанием»: первый `stay` придёт только через
        // свой интервал, а не в тот же кадр, что `enter`.
        zone.__trigStay.set(target, now);
        zone.emit('enter', overlapData(zone, target));
        if (zone.attrs && zone.attrs.once === true) {
            zone.__trigDone = true;
            // once сработал — дальше зона молчит; текущие цели считаются
            // вышедшими следующим кадром (leave придёт один раз).
        }
    }
    for (let i = 0; i < left.length; i++) {
        const target = left[i];
        if (zone.__trigMuted.delete(target)) continue;   // вход был подавлен cooldown
        // Цель могла быть удалена — leave всё равно нужен, чтобы обработчики
        // не остались в состоянии «внутри». e.data.other.removed будет true.
        zone.emit('leave', overlapData(zone, target));
        zone.__trigStay.delete(target);
    }

    // stay: пока цель внутри — со своим шагом (0 = каждый кадр).
    const a = zone.attrs || {};
    if (a.stay === true || a.stay_ms !== undefined || a.stay_ticks !== undefined) {
        const step = zoneStayStep(zone);
        for (const target of next) {
            if (zone.__trigMuted.has(target)) continue;
            const last = zone.__trigStay.get(target);
            if (last !== undefined && step > 0 && now - last < step) continue;
            if (last === undefined && step > 0) continue;   // ждём первый интервал
            zone.__trigStay.set(target, now);
            zone.emit('stay', overlapData(zone, target));
        }
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
 * Обрабатывает все зоны, наблюдателей пересечений (§11), activation-наблюдателей
 * и политику участия тел в физике (§44). Вызывается из api.js раз в кадр
 * (tickTriggers). dt не участвует в расчёте пересечений — они зависят от
 * позиций, уже синхронизированных из физики; параметр оставлен для
 * единообразия с другими tick-функциями.
 */
export function tickTriggers(dt) {
    void dt;
    // Снимок мира нужен только зонам; признак зоны считает индекс реестра,
    // одним проходом на изменение (§5, P2 отчёта).
    if (watchers.length > 0 || facetCount('zones') > 0) {
        collectFrame();
        for (let i = 0; i < zone_list.length; i++) updateZone(zone_list[i], all_list, body_list);
        updateWatchers();
    }
    // §44: видимость/активация и участие тел. Оба шага выходят сразу, если
    // наблюдателей и политик нет, — цена для игр без §44 нулевая.
    if (activation_watchers.length > 0) tickActivation();
    if (policy_nodes.length > 0) applyProcessing();
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
         *     parent, stay, stay_ms, stay_ticks, once, cooldown, clock,
         *     onEnter(other, self), onStay(other, self), onLeave(other, self) }
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
            // §11: контракт enter/stay/exit, once и cooldown — данные зоны.
            if (o.stay !== undefined) node.attrs.stay = o.stay === true;
            if (o.stay_ms !== undefined) node.attrs.stay_ms = o.stay_ms;
            if (o.stay_ticks !== undefined) node.attrs.stay_ticks = o.stay_ticks;
            if (o.once !== undefined) node.attrs.once = o.once === true;
            if (o.cooldown !== undefined) node.attrs.cooldown = o.cooldown;
            if (o.clock !== undefined) node.attrs.clock = o.clock;
            if (typeof o.onEnter === 'function') {
                node.on('enter', (e) => o.onEnter(e.data.other, e.data.self));
            }
            if (typeof o.onStay === 'function') {
                node.on('stay', (e) => o.onStay(e.data.other, e.data.self));
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

        /**
         * Перевзвести зону с `once: true` (сбросить «уже сработала»),
         * не удаляя её. Возвращает число сброшенных зон.
         */
        reset(zone) {
            const nodes = zone === undefined ? this.list().map((w) => w.get(0)) : [resolveNode(zone)];
            let n = 0;
            for (const node of nodes) {
                if (!node || !isZoneNode(node)) continue;
                node.__trigDone = false;
                n++;
            }
            return n;
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

    // --- §44: политики обработки ------------------------------------------
    $.processing = {
        /** Поля политики: что можно отключать по отдельности. */
        fields() { return PROCESSING_FIELDS.slice(); },

        /** Готовый «неактивный» набор (анимация остаётся). */
        inactive() { return Object.assign({}, PROCESSING_INACTIVE); },

        /** Объявить именованную политику: `$.processing.define('sleeping', {...})`. */
        define(name, spec) {
            if (typeof name !== 'string' || name === '') return $.processing;
            const patch = normalizeProcessing(spec);
            if (patch === null) return $.processing;
            PRESET_PROCESSING.set(name, patch);
            policy_ver++;
            return $.processing;
        },

        /** Имена объявленных политик. */
        presets() { return Array.from(PRESET_PROCESSING.keys()); },

        /** Итоговый набор по имени/объекту: `$.processing.spec('sleeping')`. */
        spec(value) { return normalizeProcessing(value) || Object.assign({}, PROCESSING_DEFAULTS); },

        /** Задать политику узлам: `$.processing.set('.enemy', { update: false })`. */
        set(what, spec) {
            const nodes = resolveNodes(what);
            for (let i = 0; i < nodes.length; i++) setNodeProcessing(nodes[i], spec);
            return nodes.length;
        },

        /** Эффективная политика узла (селектор/узел/обёртка). */
        get(what) {
            const node = resolveNodes(what)[0] || null;
            return effectiveProcessing(node);
        },

        /** Разрешена ли обработка: `$.processing.allow('#enemy', 'physics')`. */
        allow(what, kind) {
            const node = resolveNodes(what)[0] || null;
            return processingAllows(node, kind);
        },

        /**
         * Привязать политику к области владения §5: узлы, которые область
         * берёт через `scope.node(...)`, наследуют её, пока не задали свою.
         * Наследование ВКЛЮЧАЕТСЯ явно этим вызовом — без него политики нет.
         */
        scope(scope, spec) {
            if (!scope || typeof scope !== 'object') return scope;
            const patch = normalizeProcessing(spec);
            if (patch === null) { scope_policies.delete(scope); policy_ver++; return scope; }
            scope_policies.set(scope, patch);
            policy_ver++;
            // Уже взятые областью узлы получают наследование сразу.
            if (typeof scope.nodes === 'function') stampScope(scope.nodes(), scope);
            // Новые узлы: перехватываем scope.node один раз на область.
            if (!scope._proc_node_patched && typeof scope.node === 'function') {
                const original = scope.node.bind(scope);
                scope.node = function (value) {
                    const taken = original(value);
                    stampScope(value, scope);
                    return taken;
                };
                scope._proc_node_patched = true;
            }
            return scope;
        },

        /** Сколько узлов с политикой и сколько тел сейчас выключено. */
        stats() {
            let bodies_off = 0;
            let inactive = 0;
            for (const node of policy_nodes) {
                if (!node || node.removed) continue;
                const spec = effectiveProcessing(node);
                if (spec.physics === false && node.body >= 0) bodies_off++;
                if (spec.update === false) inactive++;
            }
            return { nodes: policy_nodes.length, bodies_off, inactive, version: policy_ver };
        },
    };

    // --- §44: visibility/activation ---------------------------------------
    $.activation = {
        /**
         * Следить за видимостью/активацией узлов.
         *
         * opts:
         *   margin      — поле вокруг видимой области, px (по умолчанию 0);
         *   hysteresis  — полоса между входом и выходом, px: вошли при
         *                 `margin + hysteresis`, вышли при `margin`;
         *   cameras     — 'any' (по умолчанию) | 'main' | имя/индекс камеры | список;
         *   region      — вместо видимой области следить за регионом
         *                 ({x,y,w,h}, узел, зона или селектор): события
         *                 `region:enter`/`region:exit`;
         *   event       — базовое имя событий (по умолчанию screen или region);
         *   once        — сработать один раз при первом входе и отписаться;
         *   wakeForever — после первого входа выход игнорируется: узел,
         *                 разбуженный зоной, больше не усыпляется (H8);
         *   onEnter/onExit — колбэки дополнительно к событиям узла.
         *
         * Возвращает ручку `{ stop(), active(), nodes(), inside(node), rects() }`.
         */
        watch(what, opts) { return watchActivation(what, opts); },

        /** Виден ли узел сейчас (одноразовая проверка, без подписки). */
        visible(what, opts) { return activationVisible(what, opts); },

        /**
         * Авто-политика по видимости: вошёл в кадр — обработка включена,
         * вышел — выключена (по умолчанию «неактивный» набор: движение,
         * фиксированный шаг, таймеры и физика; анимация продолжает играть).
         *
         * opts: `on`/`off` (наборы или имена), `areas: ['sense']` — включать и
         * выключать sensor-области §40 через `.areaOn()` (отдельная операция,
         * не часть политики), `start: false` — не применять состояние сразу.
         *
         * ВАЖНО: `auto` НЕ скрывает узел и НЕ удаляет его. Уборка остаётся за
         * владельцем (областью §5/таймером): выключенная обработка не должна
         * превращаться в «завис навсегда» (приёмка §44).
         */
        auto(what, opts) {
            const o = opts || {};
            const on_spec = o.on === undefined ? true : o.on;
            const off_spec = o.off === undefined ? PROCESSING_INACTIVE : o.off;
            const areas = o.areas ? [].concat(o.areas) : [];
            const nodes = resolveNodes(what);
            const apply = (wrap, active) => {
                const node = wrap && wrap.nodes ? wrap.nodes[0] : wrap;
                if (!node || node.removed) return;
                setNodeProcessing(node, active ? on_spec : off_spec);
                for (const name of areas) {
                    try {
                        const w = wrapOne(node);
                        if (typeof w.areaOn === 'function') w.areaOn(String(name), active);
                    } catch (e) { ctx.log(`$.activation.auto: areaOn("${name}"): ${e}`); }
                }
            };
            const watcher = watchActivation(nodes, Object.assign({}, o, {
                onEnter: (wrap) => { apply(wrap, true); if (typeof o.onEnter === 'function') o.onEnter(wrap); },
                onExit: (wrap) => { apply(wrap, false); if (typeof o.onExit === 'function') o.onExit(wrap); },
            }));
            if (o.start !== false) {
                // Стартовое состояние — по текущей видимости, иначе узел жил бы
                // в политике по умолчанию до первого перехода.
                for (const node of nodes) {
                    if (!node || node.removed) continue;
                    const visible = activationVisible(node, o);
                    setNodeProcessing(node, visible ? on_spec : off_spec);
                }
            }
            return watcher;
        },

        /** Сколько наблюдателей и узлов под наблюдением — для отладки и тестов. */
        stats() {
            let nodes = 0;
            for (const watcher of activation_watchers) nodes += watcher.nodes.length;
            return { watchers: activation_watchers.length, nodes };
        },

        /** Снять все наблюдения (смена сцены, тесты). */
        clear() {
            for (const watcher of activation_watchers) watcher.alive = false;
            activation_watchers.length = 0;
            return $.activation;
        },
    };

    // --- §44: методы узла --------------------------------------------------
    /**
     * `$('#enemy').processing({ update: false })` — задать политику,
     * `.processing()` — прочитать эффективную, `.processing('fixed')` — одно поле.
     */
    def('processing', function (spec) {
        const node = this.nodes[0] || null;
        if (spec === undefined) return effectiveProcessing(node);
        if (typeof spec === 'string' && PROCESSING_FIELDS.indexOf(spec) >= 0) {
            return effectiveProcessing(node)[spec];
        }
        return this.eachNode((_, el) => setNodeProcessing(el, spec));
    });

    /**
     * `$('.enemy').active(false)` — выключить обработку движения, фиксированного
     * шага, таймеров и физики (анимация и визуал не трогаются), `active(true)` —
     * вернуть всё. Это НЕ `.hide()` и НЕ сон тела.
     */
    def('active', function (value) {
        if (value === undefined) return effectiveProcessing(this.nodes[0] || null).update;
        return this.eachNode((_, el) => setNodeProcessing(el, value === false ? PROCESSING_INACTIVE : true));
    });

    /** `$('#enemy').isActive()` — обрабатывается ли узел как активный. */
    def('isActive', function () {
        const node = this.nodes[0] || null;
        const spec = effectiveProcessing(node);
        return spec.update !== false && spec.physics !== false;
    });

    return $;
}
