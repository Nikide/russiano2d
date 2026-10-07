// ===========================================================================
// Граф кадров (cel-graph) — $.cels
//
// Порт из aarthificial/reanimation (Runtime/Nodes/*.cs, Runtime/Common/*.cs).
// Идея: персонаж — это ГРАФ, который по «водителям» (драйверам) решает, какой
// кадр показать. Граф не хранит ни спрайтов, ни таймингов анимации: узел
// выбирает узел, лист отдаёт имя кадра, а игра рисует его как хочет.
//
//   $.cels.define({
//       drivers: { x: 0, grounded: 1, hurt: 0 },
//       root: {
//           type: 'switch',
//           driver: 'hurt',              // по водителю
//           nodes: [
//               { type: 'switch', driver: 'grounded', nodes: [
//                   { type: 'switch', driver: 'x', percentage: true, nodes: [
//                       { type: 'anim', cels: ['idle_0', 'idle_1'], driver: 'time', auto: true },
//                       { type: 'anim', cels: ['run_0', 'run_1', 'run_2'], driver: 'time', auto: true },
//                       { type: 'anim', cels: ['run_0', 'run_1', 'run_2'], driver: 'time', auto: true, mirror: true },
//                   ]},
//                   { type: 'anim', cels: ['jump_0'], driver: 'time' },
//               ]},
//               { type: 'anim', cels: ['hurt_0'] },     // hurt != 0
//           ],
//       },
//   });
//
//   const cels = $.cels.create('hero');
//   cels.state({ x: 0.2, grounded: 1 });    // водители
//   cels.tick(dt);                          // один шаг графа
//   cels.cel();                             // 'idle_0'
//   cels.flip();                            // зеркалить?
//
// Что перенесено:
//   * узлы `switch` (выбор по водителю: точное значение, доля, автоинкремент),
//     `anim` (лист: кадры + собственный водитель), `override` (постоянный
//     выбор), `termination` (конец);
//   * водители: числа в состоянии, объединяемые узлами (`drivers` в узле);
//   * `trace` — путь, которым граф пришёл к кадру (для отладки);
//   * `mirror` — зеркальный кадр (в оригинале MirroredCel/MirroredAnimationNode);
//   * `fps` — граф решается не чаще, чем раз в кадр анимации.
//
// Ядро (createCelGraph, createCelRuntime) не касается движка: это чистое
// дерево и числа, поэтому поведение целиком проверяет юнит-тест
// (tests/js/cels_test.mjs).
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: разбор графа
// ---------------------------------------------------------------------------

/** Нормализовать водителя: имя, автоинкремент, режим доли. */
export function normalizeDriver(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw === 'string') return { name: raw, auto: false, percentage: false };
    return {
        name: String(raw.name === undefined ? raw.driver || '' : raw.name),
        auto: !!raw.auto,
        // `percentage` — доля 0..1 превращается в индекс, как в оригинале.
        percentage: !!(raw.percentage || raw.percent),
    };
}

/**
 * Разобрать определение узла в дерево. Поддерживает краткие формы:
 *   'idle_0' — одиночный кадр; [{...}] — список узлов для switch.
 */
export function parseNode(raw, seen, depth) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string') return { type: 'cel', cel: raw };
    // Цикл в определении (игра могла собрать замыкание) вешал разбор: стек
    // QuickJS кончался на рекурсии. Отсекаем по уже разобранным узлам.
    const visited = seen || new Set();
    const level = depth === undefined ? 0 : depth;
    if (typeof raw === 'object') {
        if (visited.has(raw)) return { type: 'termination' };
        visited.add(raw);
    }
    if (level > 256) return { type: 'termination' };
    if (Array.isArray(raw)) {
        return { type: 'switch', driver: null, nodes: raw.map((n) => parseNode(n, visited, level + 1)).filter(Boolean) };
    }

    const type = String(raw.type || (raw.cels ? 'anim' : (raw.nodes ? 'switch' : 'cel'))).toLowerCase();
    const node = { type, raw };
    // Краткая форма: `driver: 'x', percentage: true` рядом с водителем.
    const driverRaw = raw.driver === undefined && raw.percentage !== undefined
        ? { name: raw.percentDriver || raw.driverName || '', percentage: raw.percentage }
        : raw.driver;
    switch (type) {
        case 'cel':
            node.cel = String(raw.cel === undefined ? raw.name || '' : raw.cel);
            if (raw.mirror) node.mirror = true;
            break;
        case 'override':
            node.cel = String(raw.cel === undefined ? raw.name || '' : raw.cel);
            node.mirror = !!raw.mirror;
            break;
        case 'anim':
            node.cels = (raw.cels || []).map((c) => (typeof c === 'string' ? c : String(c && c.cel !== undefined ? c.cel : c)));
            if (!node.cels.length) node.cels = [''];
            node.driver = normalizeDriver(driverRaw);
            node.fps = Math.max(0, Number(raw.fps) || 0);
            // `setDrivers` — водители, которые узел ЗАПИСЫВАЕТ; `drivers`
            // оставлено картой начальных значений (так читает parseGraph).
            node.drivers = raw.setDrivers || null;
            break;
        case 'switch':
            node.nodes = (raw.nodes || []).map((n) => parseNode(n, visited, level + 1)).filter(Boolean);
            if (!node.nodes.length) node.nodes = [{ type: 'termination' }];
            node.driver = normalizeDriver(driverRaw);
            // `setDrivers` — водители, которые узел ЗАПИСЫВАЕТ; `drivers`
            // оставлено картой начальных значений (так читает parseGraph).
            node.drivers = raw.setDrivers || null;
            break;
        case 'termination':
            break;
        default:
            // Неизвестный вид читаем как лист: лучше показать кадр, чем ничего.
            node.type = 'cel';
            node.cel = String(raw.cel || raw.name || '');
            break;
    }
    return node;
}

/** Разобрать определение графа в дерево. */
export function parseGraph(raw) {
    if (!raw) return { root: { type: 'termination' }, drivers: {}, fps: 0, mirrorDriver: null };
    const spec = raw.root !== undefined ? raw : { root: raw };
    return {
        root: parseNode(spec.root) || { type: 'termination' },
        // Начальные значения водителей: ими игра задаёт состояние до первого tick.
        drivers: Object.assign({}, spec.drivers || {}),
        fps: Math.max(0, Number(spec.fps) || 0),
        mirrorDriver: spec.mirrorDriver === undefined ? null : String(spec.mirrorDriver),
    };
}

// ---------------------------------------------------------------------------
// Чистое ядро: состояние и решение
// ---------------------------------------------------------------------------

/** Значение водителя: число, иначе 0. */
function driverValue(state, name) {
    if (!name) return 0;
    const value = state.values[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Решить водителя в индекс: та же логика, что ControlDriver.ResolveDriver.
 * `size` — сколько вариантов; возвращает индекс 0..size-1.
 */
export function resolveIndex(state, driver, size, next) {
    const n = Math.max(1, Math.floor(size) || 1);
    if (!driver || !driver.name) return 0;
    const value = driverValue(state, driver.name);
    if (driver.percentage) {
        const clamped = Math.max(0, Math.min(1, value));
        if (clamped < 1) return Math.min(n - 1, Math.floor(clamped * n));
        return n - 1;
    }
    // Отрицательные значения приводим к положительным: % в C# сохраняет знак,
    // а индекс кадра не может быть отрицательным.
    const index = ((Math.trunc(value) % n) + n) % n;
    if (driver.auto && next) {
        next.values[driver.name] = (index + 1) % n;
    }
    return index;
}

/**
 * Создать состояние графа. `spec` — `{ graph, drivers }`.
 */
export function createCelRuntime(spec) {
    const cfg = spec || {};
    const graph = cfg.graph || parseGraph(cfg.definition);
    const drivers = graph.drivers || {};
    // Прошлое и будущее состояние: как в оригинале, граф читает прошлое и
    // пишет будущее, а в конце шага они меняются местами.
    let previous = { values: Object.assign({}, drivers), cels: [], trace: [], node: null };
    let next = { values: Object.assign({}, drivers), cels: [], trace: [], node: null };
    let cel = '';
    let mirrored = false;
    let accumulator = 0;
    let steps = 0;

    const runtime = {
        /** Текущий кадр. */
        cel() { return cel; },
        /** Зеркалить ли кадр. */
        flip() { return mirrored; },
        /** Значения водителей (прошлое состояние). */
        values() { return Object.assign({}, previous.values); },
        /** Значение одного водителя. */
        get(name) { return previous.values[String(name)]; },
        /** Путь к кадру: имена узлов и индексы. */
        trace() { return previous.trace.slice(); },
        /** Какой узел решил кадр. */
        node() { return previous.node; },
        /** Сколько раз граф решался (шагов). */
        steps() { return steps; },

        /** Задать водителя на следующем шаге. */
        set(name, value) {
            const key = String(name);
            const num = Number(value);
            // Пишем в ТЕКУЩЕЕ состояние: `set()` вызывается игрой между
            // кадрами, и граф должен увидеть значение на ближайшем решении.
            // Прежняя версия писала в «будущее», и оно тут же терялось при
            // обмене состояниями — set() не действовал вовсе.
            previous.values[key] = Number.isFinite(num) ? num : 0;
            next.values[key] = previous.values[key];
            return runtime;
        },

        /** Задать сразу несколько водителей: `state({ x: 0.5, grounded: 1 })`. */
        state(values) {
            if (values && typeof values === 'object') {
                for (const key of Object.keys(values)) runtime.set(key, values[key]);
            }
            return runtime;
        },

        /** Сбросить водители к начальным. */
        reset(values) {
            const base = Object.assign({}, drivers, values || {});
            previous.values = Object.assign({}, base);
            next.values = Object.assign({}, base);
            cel = '';
            mirrored = false;
            accumulator = 0;
            steps = 0;
            return runtime;
        },

        /**
         * Один шаг: граф решается, `cel()` отдаёт кадр. С учётом `fps` шаг может
         * быть пропущен — тогда кадр и водители не меняются.
         */
        tick(dt) {
            const step = Math.max(0, Number(dt) || 0);
            const fps = graph.fps;
            if (fps > 0) {
                accumulator += step;
                const frame = 1 / fps;
                if (accumulator < frame) return cel;
                // Прошли несколько кадров анимации — решаем один раз: графу
                // важнее состояние, чем число шагов.
                accumulator = Math.max(0, accumulator - frame);
            }
            runtime.resolve();
            return cel;
        },

        /** Решить граф немедленно (без учёта fps). */
        resolve() {
            next.cels = [];
            next.trace = [];
            // Будущее состояние начинается с прошлого: водители, которых узлы
            // не переписали, остаются в силе. Прежняя версия оставляла в next
            // старые значения и переносила прошлые после обмена — из-за этого
            // set() между кадрами не действовал (граф видел прошлое значение).
            next.values = Object.assign({}, previous.values);
            const seen = new Set();
            const result = resolveNode(graph.root, previous, next, 0, seen);
            cel = result ? String(result.cel || '') : '';
            mirrored = !!(result && result.mirror);
            next.node = result ? result.nodeId : null;
            // Прошлое и будущее меняются местами: значения, записанные узлами
            // (автоинкремент), становятся входом следующего шага.
            const swap = previous;
            previous = next;
            next = swap;
            steps++;
            return cel;
        },

        /** Снимок состояния (водители и кадр) для сейва. */
        save() {
            return { values: Object.assign({}, previous.values), cel, mirrored, steps };
        },

        /** Восстановить состояние из сейва. */
        load(data) {
            if (!data || typeof data !== 'object') return runtime;
            if (data.values && typeof data.values === 'object') {
                previous.values = Object.assign({}, data.values);
                next.values = Object.assign({}, data.values);
            }
            if (typeof data.cel === 'string') cel = data.cel;
            mirrored = !!data.mirrored;
            steps = Math.max(0, Math.floor(Number(data.steps) || 0));
            return runtime;
        },

        /** Дерево графа (для отладки). */
        graph() { return graph.root; },
    };

    return runtime;
}

/**
 * Решить узел. Возвращает `{ cel, mirror, nodeId }` или null.
 * `depth` защищает от цикла в графе: он возможен, если игра собрала его с
 * замыканием, и без предела решение ушло бы в бесконечность.
 */
function resolveNode(node, previous, next, depth, seen) {
    if (!node) return null;
    // Цикл в дереве (игра могла собрать замыкание) отсекаем по посещённым
    // узлам: счётчик глубины не спасал, стек QuickJS кончался раньше.
    if (seen && seen.has(node)) return null;
    if (seen) seen.add(node);
    if (depth > 512) return null;
    switch (node.type) {
        case 'cel':
            next.cels.push(node.cel);
            next.trace.push(`cel:${node.cel}`);
            return { cel: node.cel, mirror: !!node.mirror, nodeId: node.cel };

        case 'override':
            next.cels.push(node.cel);
            next.trace.push(`override:${node.cel}`);
            return { cel: node.cel, mirror: !!node.mirror, nodeId: node.cel };

        case 'anim': {
            // Сначала выбор по ТЕКУЩИМ водителям, потом запись водителей узла:
            // если водитель узла подменить до выбора, ветка перебивает сама
            // себя (нашлось тестом: `drivers: { local: 1 }` выбирал ветку 0).
            mergeDrivers(node.drivers, next);
            const index = resolveIndex(next, node.driver, node.cels.length, next);
            const chosen = node.cels[Math.max(0, Math.min(index, node.cels.length - 1))];
            next.cels.push(chosen);
            next.trace.push(`anim:${index}`);
            return { cel: chosen, mirror: false, nodeId: `anim:${index}` };
        }

        case 'switch': {
            // Как в оригинале: сначала узел вливает СВОИ водители в следующее
            // состояние (next.Merge(drivers)), и уже потом выбирает ветку по
            // текущему состоянию. Читать next, а не previous, обязательно:
            // водитель игры, выставленный в этом кадре, иначе не подействует
            // до следующего решения.
            mergeDrivers(node.drivers, next);
            const index = resolveIndex(next, node.driver, node.nodes.length, next);
            const child = node.nodes[Math.max(0, Math.min(index, node.nodes.length - 1))];
            next.trace.push(`switch:${index}`);
            return resolveNode(child, previous, next, depth + 1, seen);
        }

        case 'termination':
        default:
            return null;
    }
}

/** Применить водители узла: `drivers: { hurt: 1 }`. */
function mergeDrivers(list, next) {
    if (!list || typeof list !== 'object') return;
    for (const key of Object.keys(list)) {
        const num = Number(list[key]);
        next.values[key] = Number.isFinite(num) ? num : 0;
    }
}

// ---------------------------------------------------------------------------
// Чистое ядро: библиотека графов
// ---------------------------------------------------------------------------

export function createCelLibrary() {
    const graphs = new Map();

    const lib = {
        /** Описать граф по имени: `define('hero', { drivers, root })`. */
        define(name, raw) {
            const key = String(name);
            if (!key) { ctx.log('$.cels.define: нужно имя'); return null; }
            const graph = parseGraph(raw);
            graphs.set(key, graph);
            return graph;
        },

        /** Граф по имени (или null). */
        get(name) { return graphs.get(String(name)) || null; },
        has(name) { return graphs.has(String(name)); },
        names() { return [...graphs.keys()]; },
        remove(name) { return graphs.delete(String(name)); },
        clear() { const n = graphs.size; graphs.clear(); return n; },

        /** Загрузить пачку: `{ hero: {...}, guard: {...} }` или `{ graphs: {} }`. */
        load(data) {
            if (!data || typeof data !== 'object') return 0;
            const source = data.graphs && typeof data.graphs === 'object' ? data.graphs : data;
            let count = 0;
            for (const name of Object.keys(source)) {
                if (lib.define(name, source[name])) count++;
            }
            return count;
        },
    };

    return lib;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installCels($) {
    const lib = createCelLibrary();
    const running = new WeakMap();     // узел → состояние графа

    /** Показать кадр на узле: спрайт по имени кадра или спрайт из `src`. */
    function applyToNode(node, runtime, opts) {
        const spec = opts || {};
        const cel = runtime.cel();
        if (!cel) return false;
        // Имя кадра — либо прямой спрайт (`spec.sprites`), либо картинка
        // `spec.src` с нарезкой сеткой, либо имя ресурса.
        const sprites = spec.sprites || null;
        if (sprites && sprites[cel] !== undefined) node.set('sprite', sprites[cel]);
        if (spec.fields && typeof spec.fields === 'object') node.set(spec.fields);
        if (node.set) {
            node.set('flip_x', runtime.flip() ? true : (spec.flipX || false));
        }
        if (spec.onCel) spec.onCel(cel, runtime);
        return true;
    }

    const api = {
        /** Описать граф. */
        define(name, raw) { return lib.define(name, raw); },
        get(name) { return lib.get(name); },
        has(name) { return lib.has(name); },
        names() { return lib.names(); },
        remove(name) { return lib.remove(name); },
        clear() { return lib.clear(); },
        load(data) { return lib.load(data); },

        /**
         * Создать состояние графа по имени: `$.cels.create('hero')`.
         * Второй аргумент — начальные водители.
         */
        create(name, drivers) {
            const graph = lib.get(name);
            if (!graph) { ctx.log(`$.cels: нет графа "${name}"`); return null; }
            return createCelRuntime({ graph, drivers });
        },

        /** Чистые ядра — для тестов и своих графов. */
        createCelRuntime,
        createCelLibrary,
        parseGraph,
        resolveIndex,

        /**
         * Привязать граф к узлу: `$.cels.attach('#hero', 'hero', { sprites })`.
         * Водители ставятся через `$.cels.state(узел, {...})`.
         */
        attach(what, name, opts) {
            const node = nodeOf(what);
            if (!node) { ctx.log('$.cels.attach: узел не найден'); return null; }
            const runtime = api.create(name);
            if (!runtime) return null;
            const spec = opts || {};
            node.set('flip_x', false);
            running.set(node, { runtime, opts: spec });
            // Кадр применяем сразу, чтобы узел не мигал пустым.
            applyToNode(node, runtime, spec);
            return runtime;
        },

        /** Состояние графа узла (или null). */
        of(what) {
            const node = nodeOf(what);
            const entry = node ? running.get(node) : null;
            return entry ? entry.runtime : null;
        },

        /** Задать водителей узлу: `$.cels.state('#hero', { x: 1, grounded: 0 })`. */
        state(what, values) {
            const runtime = api.of(what);
            if (!runtime) return null;
            return runtime.state(values);
        },

        /** Тик всех привязанных графов: `$.cels.tick(dt)`. */
        tick(dt) {
            let count = 0;
            for (const node of ctx.nodes || []) {
                const entry = running.get(node);
                if (!entry) continue;
                entry.runtime.tick(dt);
                applyToNode(node, entry.runtime, entry.opts);
                count++;
            }
            return count;
        },

        /** Тик одного узла. */
        tickNode(what, dt) {
            const node = nodeOf(what);
            const entry = node ? running.get(node) : null;
            if (!entry) return null;
            entry.runtime.tick(dt);
            applyToNode(node, entry.runtime, entry.opts);
            return entry.runtime;
        },
    };

    $.cels = api;
    ctx.cels = api;
    return api;
}

/**
 * Узел по обёртке, узлу или селектору. Имя отличается от внутреннего
 * `resolveNode` ядра: одноимённые функции в модуле — ошибка в QuickJS
 * («invalid redefinition of global identifier»), и это уже случалось.
 */
function nodeOf(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        const byId = ctx.byId;
        return byId && byId.get ? (byId.get(String(what).replace(/^#/, '')) || null) : null;
    }
    if (what.nodes) return what.nodes[0] || null;
    return what.tag ? what : null;
}
