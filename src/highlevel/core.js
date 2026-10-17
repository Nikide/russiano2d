// ===========================================================================
// Ядро высокоуровневого API: $ — одна точка входа.
//
// Философия (docs/ARCHITECTURE.md):
//   * $ — единственная точка входа, всё остальное живёт на нём;
//   * любой вызов возвращает один и тот же wrapper, поэтому работают цепочки;
//   * создание как в HTML: $('<player>', { id: 'hero' });
//   * поиск как в CSS: $('#hero'), $('.enemy'), $('enemy:alive');
//   * неявная итерация: $('.enemy').damage(10) бьёт всех;
//   * никаких new/extends/this в игре — только декларативные цепочки.
//
// Этот файл — только ядро: узлы, коллекция, селекторы, события, $.fn.
// Мир, камера, ввод, звук и прочее подключаются в api.js через install($).
// ===========================================================================

// Общее состояние API. Модули ссылаются друг на друга через него, а не через
// импорты — иначе получилось бы кольцо импортов (мир знает про узлы, узлы про
// мир, камера про мир и так далее).
import { engine } from './native.js';
import { report as diagReport } from './diag.js';
export const ctx = {
    $: null,
    nodes: [],          // все живые узлы мира, в порядке создания
    byId: new Map(),    // id → узел (для '#hero')
    byBody: new Map(),  // id тела → узел (для лучей и запросов)
    world: null,
    camera: null,
    input: null,
    time: null,
    sound: null,
    scene: null,
    ui: null,
    store: null,
    debug: null,
    agent: null,
    gfx: null,
    frame: { hooks: [], renderHooks: [], ready: [], exit: [] },
    // Журнал безопасен вне движка: модульные тесты под qjs не имеют `engine`,
    // и любое предупреждение внутри подсистемы роняло весь тест (так и вышло
    // с предметами: add() писал предупреждение — и тест падал «не влезло»).
    log: (msg) => {
        // A7: «неизвестный тег» — одна строка на имя тега, а не на узел.
        if (unknownTagAlreadyReported(msg)) return;
        if (typeof engine !== 'undefined' && engine && typeof engine.log === 'function') {
            engine.log(msg);
        } else if (typeof console !== 'undefined' && console && typeof console.log === 'function') {
            console.log(msg);
        }
    },
};

// ---------------------------------------------------------------------------
// A7. «Неизвестный тег» — одна строка на имя, а не на узел
//
// Узел с незнакомым тегом создаётся и работает (класс, тело, коллизия,
// селектор), но предупреждение писалось на КАЖДЫЙ узел: уровень с ~50 врагами
// и ~70 ловушками давал 106–125 строк шума за загрузку, и настоящие сообщения
// в журнале тонули (docs/EXTERNAL_FEEDBACK.md, A7).
//
// Текст пишут четыре места (api.js — «создаю пустой узел», world.js, prefab.js,
// pool.js), но про один и тот же тег он один: «неизвестный тег <имя>». Поэтому
// повторы гасятся здесь, на общем журнале: каждое имя сообщается один раз за
// запуск. Запоминается именно ИМЯ: «создаю пустой узел» и «возьмите
// существующий» — про один тег, и второй раз это уже шум.
// ---------------------------------------------------------------------------

const unknown_tag_re = /неизвестный тег <([^>]+)>/;
const unknown_tags = new Set();

/** true — про это имя тега уже сообщали (значит, писать не нужно). */
function unknownTagAlreadyReported(msg) {
    // Дешёвая проверка до регулярки: журнал может звать и горячий код игры.
    if (typeof msg !== 'string' || msg.indexOf('неизвестный тег') < 0) return false;
    const m = unknown_tag_re.exec(msg);
    if (!m) return false;
    if (unknown_tags.has(m[1])) return true;
    unknown_tags.add(m[1]);
    return false;
}

/** Имена тегов, про которые журнал уже предупредил (для тестов и диагностики). */
export function reportedUnknownTags() { return Array.from(unknown_tags); }

/**
 * Объявить свой тег: `$.tag.define('walker', { body: 'dynamic', w: 24, h: 32 })`.
 *
 * Умолчания — те же поля, что у встроенных тегов (см. TAGS): тело, размеры,
 * цвет, `sprite`, `ui` и прочее. После объявления тег перестаёт быть
 * «неизвестным»: предупреждения про него нет вовсе, а узлы получают эти
 * умолчания. Объект копируется — правка умолчаний вызывающим на тег не влияет.
 *
 * Публичный фасад (`$.tag.define`) ставит api.js: ядро отдаёт саму операцию,
 * чтобы объявление тега не заводило вторую таблицу тегов рядом с TAGS.
 */
export function defineTag(name, defaults) {
    const key = String(name === undefined || name === null ? '' : name).trim();
    if (!key) return null;
    const base = defaults && typeof defaults === 'object' ? Object.assign({}, defaults) : {};
    TAGS[key] = base;
    return base;
}

// Ядро доступно подсистемам и юнит-тестам qjs; публикует это api.js как $.tag.
ctx.defineTag = defineTag;

// ---------------------------------------------------------------------------
// Версия реестра и сводки по нему
// ---------------------------------------------------------------------------
//
// Кадр `$` был устроен так, что каждая подсистема сама обходила ВЕСЬ ctx.nodes,
// проверяя «а есть ли тут мои?»: ≈20 полных проходов за кадр, ≈7 мс на 1000
// узлов, причём почти вся работа — впустую (docs/HIGH_LEVEL_API_PERF.md §3.3).
//
// Здесь — общий механизм, чтобы подсистема могла выйти на первой строке:
//
//   * version растёт при любом изменении состава реестра и признаков, от
//     которых зависят подсистемы (классы, attrs.ui, attrs.trigger);
//   * registrySummary() пересчитывает сводку ТОЛЬКО когда версия изменилась,
//     то есть один раз на пачку изменений, а не каждый кадр.
//
// Предикат остаётся в своём модуле (isZoneNode знает только triggers.js) —
// сводка лишь кэширует его результат до следующего изменения реестра.

let registry_version = 0;
const registry_summaries = new Map();

/** Версия реестра: меняется при добавлении/удалении узлов и смене признаков. */
/**
 * Движок, если он есть, иначе безопасная заглушка.
 *
 * Высокоуровневое API обязано ставиться и БЕЗ движка: его подсистемы
 * импортируются в модульных тестах, где globalThis.engine нет. Обращение к
 * engine прямо в установке роняло весь bootstrap — в игре это выглядело как
 * «$ не определён». Возвращаем заглушку с теми же методами: вызовы ничего не
 * делают, свойства читаются нулями.
 */
export function engineOf() {
    if (typeof engine !== 'undefined' && engine) return engine;
    if (!globalThis.__r2d_engine_stub) {
        const noop = () => undefined;
        globalThis.__r2d_engine_stub = {
            time: 0, dt: 0, frame: 0, fps: 0, seed: 12345,
            agent: false, headless: false, paused: false,
            now: () => 0,
            log: () => undefined,
            setUpdate: noop, setRender: noop, setSnapshot: noop, quit: noop,
            // §39/§40: проход локальных трансформов и области — за пределами
            // движка (юнит-тест qjs) молча ничего не делают.
            setResolveTransforms: noop, setShape: noop, setShapeEnabled: noop,
            shapeOverlaps: () => [], addShape: () => -1, shapeCount: () => 0,
            setExit: noop, markUI: noop, setErrorHandler: noop, requestReload: noop,
            reloadPending: () => false, hotReload: noop,
            // Общие для подсистем: рисование, физика, окно, ввод.
            window: {
                size: () => [0, 0], pixelSize: () => [0, 0], focused: () => false,
                visible: () => false, fullscreen: () => false, on: noop,
            },
            setPosition: noop, setAngle: noop,
            bodyCount: () => 0,
            getVelocity: () => [0, 0], setVelocity: noop, setPosition: noop,
            applyImpulse: noop, setGravityScale: noop, createJoint: () => -1,
            setAwake: noop, setBullet: noop, isBullet: () => false,
            destroyJoint: noop, createBody: () => -1, destroyBody: noop,
        };
    }
    return globalThis.__r2d_engine_stub;
}

export function registryVersion() { return registry_version; }

/**
 * Нативные проходы кадра по узлам (engine.nodes, src/nodes.c) или null:
 * без движка (юнит-тесты qjs) и при `$.debug.nativePasses(false)` работает
 * прежний JS-путь. Переключатель нужен для сверки «C против JS» в тестах.
 */
export function nativeNodes() {
    if (ctx.native_off === true) return null;
    const n = engine && engine.nodes;
    return n && typeof n === 'object' && typeof n.drawWorld === 'function' ? n : null;
}

/** Отметить реестр изменённым (см. места вызова: конструктор, destroy, пул). */
export function touchRegistry() { registry_version++; }

/**
 * Сводка по ctx.nodes с кэшем на версию реестра. `compute` вызывается не чаще,
 * чем меняется реестр, и получает живой массив узлов.
 */
export function registrySummary(key, compute) {
    let entry = registry_summaries.get(key);
    if (entry === undefined) {
        entry = { version: -1, value: null };
        registry_summaries.set(key, entry);
    }
    if (entry.version !== registry_version) {
        entry.version = registry_version;
        entry.value = compute(ctx.nodes);
    }
    return entry.value;
}

// ---------------------------------------------------------------------------
// Индекс реестра: один проход вместо N (docs/HIGH_LEVEL_API_PERF.md §5, P2)
// ---------------------------------------------------------------------------
//
// Подсистемы каждый кадр спрашивают «есть ли в мире мои узлы?». Через
// registrySummary() ответ кэшируется на версию реестра, но в сцене, где узлы
// рождаются и умирают каждый кадр, версия меняется каждый кадр — и десяток
// подсистем делает десяток независимых полных проходов по ctx.nodes.
//
// Здесь проход один: по узлам строятся карты byTag/byClass и срезы по
// признакам (ui, tr, controls, anim, clip, parallax, зоны). Всё живёт на
// версию реестра: touchRegistry() обесценивает индекс, первый запрос после
// изменения его перестраивает. Подсистема читает готовый срез: O(1) на кадр.
//
// Срезы — снимки: при перестройке создаются НОВЫЕ массивы, старые не
// переиспользуются. Иначе обход среза, внутри которого узел создаётся или
// удаляется (а это обычное дело), ронял бы итерацию.

/** Пустой срез: у тега/класса/признака нет узлов. */
const EMPTY_NODES = [];
Object.freeze(EMPTY_NODES);

let registry_index = null;

function buildRegistryIndex() {
    // Нативный проход (src/nodes.c): та же раскладка за один проход в C —
    // при пачках спавна индекс перестраивается каждый кадр (§0.6 отчёта).
    const native = nativeNodes();
    if (native && typeof native.buildIndex === 'function') {
        const built = native.buildIndex(ctx.nodes);
        registry_index = {
            version: registry_version,
            all: built.all,
            by_tag: built.by_tag,
            by_class: built.by_class,
            facets: built.facets,
            counts: built.counts,
            selects: new Map(),
        };
        return registry_index;
    }
    const by_tag = new Map();
    const by_class = new Map();
    const facets = {
        ui: [], tr: [], controls: [], anim: [], clip: [], parallax: [], zones: [], body: [],
    };
    const counts = {
        ui: 0, tr: 0, controls: 0, anim: 0, clip: 0, parallax: 0, zones: 0, body: 0,
    };
    const all = [];

    // Одноэлементный кэш «имя → список»: в типичной сцене подряд идут узлы
    // одного тега и одного класса (1000 спрайтов, 5000 'rect'), а Map по
    // строке в QuickJS стоит до микросекунды — на 5000 узлов это миллисекунды.
    // Кэш убирает почти все обращения к Map в однородной сцене.
    // Сентинел, а не null: у узла-заглушки тега может не быть вовсе.
    const NO_NAME = {};
    let last_tag = NO_NAME;
    let last_tag_list = null;
    let last_class = NO_NAME;
    let last_class_list = null;

    const nodes = ctx.nodes;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        // null в реестре — не норма, но triggers.js исторически проверяет его,
        // поэтому индекс тоже не падает на дырке.
        if (node === null || node === undefined || node.removed) continue;
        all.push(node);

        const tag = node.tag;
        if (tag !== last_tag) {
            last_tag = tag;
            last_tag_list = by_tag.get(tag);
            if (last_tag_list === undefined) by_tag.set(tag, last_tag_list = []);
        }
        last_tag_list.push(node);

        const classes = node.classes;
        if (classes !== undefined && classes.size !== 0) {
            for (const name of classes) {
                if (name !== last_class) {
                    last_class = name;
                    last_class_list = by_class.get(name);
                    if (last_class_list === undefined) by_class.set(name, last_class_list = []);
                }
                last_class_list.push(node);
            }
        }

        // Признак зоны — тот же предикат, что у triggers.js (isZoneNode):
        // тег <trigger>, класс "trigger" или attrs.trigger === true.
        // Класс здесь не проверяем: Set.has на каждом узле — самая дорогая
        // строка прохода, а класс добирается после цикла по готовому срезу.
        let zone = tag === 'trigger';
        const attrs = node.attrs;
        if (attrs !== undefined) {
            if (attrs.ui) { facets.ui.push(node); counts.ui++; }
            if (attrs.tr !== undefined) { facets.tr.push(node); counts.tr++; }
            if (attrs.controls) { facets.controls.push(node); counts.controls++; }
            if (attrs.trigger === true) zone = true;
        }
        if (zone) { facets.zones.push(node); counts.zones++; }

        if (node.anim) { facets.anim.push(node); counts.anim++; }
        if (node.__clip) { facets.clip.push(node); counts.clip++; }
        if (node.body >= 0) { facets.body.push(node); counts.body++; }
        const parallax = node.parallax_factor;
        if (parallax !== undefined && parallax !== null) {
            facets.parallax.push(node);
            counts.parallax++;
        }
    }

    // Зоны по классу "trigger" (третий случай isZoneNode). Их порядок в срезе —
    // после зон по тегу и attrs: движку нужен только счётчик для раннего
    // выхода, а список зон триггеры собирают сами, в порядке реестра.
    const trigger_class = by_class.get('trigger');
    if (trigger_class !== undefined) {
        for (let i = 0; i < trigger_class.length; i++) {
            const node = trigger_class[i];
            if (node.tag === 'trigger') continue;
            const attrs = node.attrs;
            if (attrs !== undefined && attrs.trigger === true) continue;
            facets.zones.push(node);
            counts.zones++;
        }
    }

    registry_index = {
        version: registry_version,
        all,
        by_tag,
        by_class,
        facets,
        counts,
        // Кэш выборок по структурным селекторам ('.mob', 'enemy.mob'): живёт
        // на версию реестра, поэтому не может устареть.
        selects: new Map(),
    };
    return registry_index;
}

/**
 * Индекс реестра на текущую версию. Строится при первом запросе после
 * изменения реестра, дальше отдаётся как есть.
 */
export function registryIndex() {
    if (registry_index === null || registry_index.version !== registry_version) {
        return buildRegistryIndex();
    }
    return registry_index;
}

/** Срез по тегу: живой массив индекса, только для чтения. */
export function nodesByTag(tag) {
    const list = registryIndex().by_tag.get(tag);
    return list === undefined ? EMPTY_NODES : list;
}

/** Срез по классу: живой массив индекса, только для чтения. */
export function nodesByClass(name) {
    const list = registryIndex().by_class.get(name);
    return list === undefined ? EMPTY_NODES : list;
}

/**
 * Срез по признаку. Имена: `ui`, `tr`, `controls`, `anim`, `clip`,
 * `parallax`, `zones`, `body`. Живой массив индекса, только для чтения.
 */
export function nodesWithFacet(name) {
    const list = registryIndex().facets[name];
    return list === undefined ? EMPTY_NODES : list;
}

/** Сколько узлов с признаком (см. nodesWithFacet). */
export function facetCount(name) {
    const count = registryIndex().counts[name];
    return count === undefined ? 0 : count;
}

/** Все узлы реестра, кроме помеченных на удаление. Только для чтения. */
export function liveNodes() { return registryIndex().all; }

// ---------------------------------------------------------------------------
// Пакетные операции ($.batch)
// ---------------------------------------------------------------------------
//
// Массовое удаление (очередь пуль, волна врагов, осколки) стоит K × O(N):
// каждый destroy() ищет узел в реестре и сдвигает хвост массива, а возврат в
// пул делает то же самое. Внутри пакета удаления только помечаются, а реестр
// чистится одной компактификацией в конце — O(K + N) вместо O(K·N)
// (docs/HIGH_LEVEL_API_PERF.md §3.6, пункты 14–15 плана).

let batch_depth = 0;
const drop_queue = [];

/** Начало пакета — см. $.batch(fn). */
export function beginBatch() { batch_depth++; }

/** Конец пакета: на выходе из внешнего — одна уборка реестра. */
export function endBatch() {
    if (batch_depth === 0) return;
    batch_depth--;
    if (batch_depth === 0) flushDrops();
}

/** Идёт ли пакет прямо сейчас (нужно пулу: он тоже убирает узлы из реестра). */
export function inBatch() { return batch_depth > 0; }

/**
 * Убрать узел из реестра. Внутри пакета — отложенно (одна уборка в конце),
 * иначе — сразу, как было.
 */
export function dropFromRegistry(node) {
    if (batch_depth > 0) {
        if (!node._drop_queued) {
            node._drop_queued = true;
            drop_queue.push(node);
            // Сводки подсистем (ui-узлы, зоны, карты…) должны увидеть удаление
            // сразу: уборка реестра отложена, но версия — нет.
            touchRegistry();
        }
        return;
    }
    // С конца: свежие узлы (пули, частицы, волна врагов) живут меньше всех,
    // и поиск обычно заканчивается на первых шагах, а не через весь реестр.
    const i = ctx.nodes.lastIndexOf(node);
    if (i >= 0) ctx.nodes.splice(i, 1);
    node.in_registry = false;
    touchRegistry();
}

/** Одна компактификация реестра вместо K сплайсов. */
function flushDrops() {
    if (drop_queue.length === 0) return;
    const nodes = ctx.nodes;
    let w = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node._drop_queued === true) {
            node._drop_queued = false;
            node.in_registry = false;
            continue;
        }
        nodes[w++] = node;
    }
    nodes.length = w;
    drop_queue.length = 0;
    touchRegistry();
}

/** Сколько узлов интерфейса (attrs.ui) в реестре. Общий предикат для $.ui,
 *  виджетов и отрисовки: attrs.ui ставится тегом при создании и меняется
 *  только через .attr('ui'), который отмечает реестр изменённым. */
export function countUiNodes(nodes) {
    let count = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.attrs && node.attrs.ui) count++;
    }
    return count;
}

// ---------------------------------------------------------------------------
// Цвет
// ---------------------------------------------------------------------------

const NAMED_COLORS = {
    transparent: [0, 0, 0, 0],
    black: [0, 0, 0, 255],
    white: [255, 255, 255, 255],
    red: [255, 0, 0, 255],
    green: [0, 200, 0, 255],
    blue: [0, 100, 255, 255],
    yellow: [255, 220, 0, 255],
    orange: [255, 150, 0, 255],
    purple: [160, 60, 220, 255],
    pink: [255, 105, 180, 255],
    cyan: [0, 220, 220, 255],
    gray: [128, 128, 128, 255],
    grey: [128, 128, 128, 255],
    brown: [150, 100, 60, 255],
    lime: [160, 255, 60, 255],
    navy: [20, 30, 80, 255],
    sky: [120, 200, 255, 255],
};

/** '#f00' | '#ff0000' | '#ff0000ff' | 'red' | [r,g,b,a] | число → упакованный RGBA. */
export function packColor(value, alpha) {
    if (value === undefined || value === null) {
        return alpha === undefined ? engine.WHITE : engine.rgba(255, 255, 255, Math.round(alpha * 255));
    }
    if (typeof value === 'number') {
        // Уже упакованный цвет. Раньше alpha здесь молча терялась, из-за чего
        // .alpha() не действовал на ui.* с цветом-числом (панели, кнопки,
        // картинки): drawUINode передаёт alpha вторым аргументом.
        return alpha === undefined ? value : withAlpha(value, alpha);
    }
    if (typeof value === 'string') {
        // Разбор строки — регулярки и parseInt — стоил ≈0,6 мкс на каждый
        // узел с цветом тега ('#ffffff' у каждого <rect>). Кэш по строке.
        const hit = color_cache.get(value);
        if (hit !== undefined) return hit;
        const packed = parseColorString(value);
        if (color_cache.size >= 512) color_cache.clear();
        color_cache.set(value, packed);
        return packed;
    }
    if (Array.isArray(value)) {
        const a = value.length > 3 ? Math.round(value[3] * 255) : 255;
        return engine.rgba(value[0] | 0, value[1] | 0, value[2] | 0, a);
    }
    return engine.WHITE;
}

const color_cache = new Map();

/** Строка цвета → упакованный RGBA (без кэша; см. packColor). */
function parseColorString(value) {
    const named = NAMED_COLORS[value.toLowerCase()];
    if (named) return engine.rgba(named[0], named[1], named[2], named[3]);
    if (value[0] === '#') {
        let hex = value.slice(1);
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length === 6) hex += 'ff';
        if (hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const a = parseInt(hex.slice(6, 8), 16);
            return engine.rgba(r, g, b, a);
        }
    }
    const m = /^rgba?\(([^)]+)\)$/.exec(value);
    if (m) {
        const parts = m[1].split(',').map((s) => parseFloat(s));
        const a = parts.length > 3 ? Math.round(parts[3] * 255) : 255;
        return engine.rgba(parts[0] | 0, parts[1] | 0, parts[2] | 0, a);
    }
    ctx.log(`$: непонятный цвет "${value}" — беру белый`);
    return engine.WHITE;
}

/** Меняет альфу у упакованного цвета, не трогая RGB. */
export function withAlpha(packed, alpha) {
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
    return (((packed >>> 24) & 0xff) === a) ? packed
        : ((packed & 0x00ffffff) | (a << 24));
}

// ---------------------------------------------------------------------------
// Узел
// ---------------------------------------------------------------------------

// Теги, которые умеет создавать $. Каждый — набор полей по умолчанию и
// признак «у узла есть физическое тело».
export const TAGS = {
    // Игровые сущности
    player:   { body: 'dynamic', w: 28, h: 40, hp: 100, speed: 250, controlled: true, sprite: null },
    enemy:    { body: 'dynamic', w: 28, h: 40, hp: 30, speed: 90, team: 2, sprite: null },
    npc:      { body: 'dynamic', w: 28, h: 40, hp: 40, speed: 70, team: 3, sprite: null },
    pickup:   { body: null, w: 20, h: 20, hp: 1, sprite: null },
    // <bullet> — снаряд: CCD включён по умолчанию, гравитация не тянет.
    bullet:   { body: 'dynamic', w: 6, h: 6, hp: 1, gravity: false, bullet: true, sprite: null },

    // Геометрия и картинки
    sprite:   { body: null, w: 32, h: 32, sprite: null },
    rect:     { body: null, w: 32, h: 32, color: '#ffffff' },
    circle:   { body: null, w: 32, h: 32, r: 16, color: '#ffffff', shape: 'circle' },
    text:     { body: null, w: 0, h: 0, text: 'Текст', size: 20, color: '#ffffff' },
    tilemap:  { body: null, w: 0, h: 0, src: null, tile: 32 },
    light:    { body: null, w: 0, h: 0, radius: 200, color: '#ffaa00', intensity: 1 },
    particles:{ body: null, w: 0, h: 0, src: null },
    trigger:  { body: null, w: 100, h: 100, color: '#00ff0033' },
    area:     { body: null, w: 100, h: 100 },
    wall:     { body: 'static', w: 32, h: 32, color: '#555555' },

    // Интерфейс (screen space, камера не влияет)
    'ui.panel':  { ui: true, w: 200, h: 100, color: '#000000cc' },
    'ui.label':  { ui: true, w: 0, h: 0, text: 'Текст', size: 20, color: '#ffffff' },
    'ui.button': { ui: true, w: 160, h: 44, text: 'Кнопка', size: 20,
                   color: '#22304aee', hoverColor: '#2e405f', textColor: '#ffffff' },
    'ui.bar':    { ui: true, w: 200, h: 16, value: 1, max: 1,
                   color: '#22304a', fillColor: '#4fd166' },
    'ui.image':  { ui: true, w: 64, h: 64, sprite: null },
};

// Свойства, которые нельзя задавать просто так: у них есть осмысленная
// логика (создание тела, загрузка текстуры, подписка).
const RESERVED = new Set([
    'id', 'class', 'classes', 'tag', 'tags', 'parent', 'script', 'body',
    'sprite', 'frames', 'on', 'child', 'children',
]);

let next_uid = 1;

// --- Стабильный идентификатор узла (nid) -------------------------------------
// `uid` — номер создания: он сбрасывается при перезагрузке скриптов и не
// переживает сохранение. `nid` — стабильный логический ID (§14 и §4.2
// Спецификации): он уникален в пределах запуска, попадает в снимок узла
// (prefab.js) и восстанавливается вместе с ним, поэтому по нему можно
// сопоставлять состояние (FSM, таймеры, RNG-потоки) между сохранением и
// загрузкой, не полагаясь на порядок узлов в обходе дерева.
//
// Формат — строка `n<счётчик>`, а не число: так ID переживает JSON без
// округления, отличается от Box2D body id и не выглядит как индекс массива.
// Старый код продолжает пользоваться `uid`; nid только добавляется.
let next_nid = 1;
const nid_digits = new Set(['n', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** Назначить узлу новый nid (вызывается при создании, если его ещё нет). */
//: Узлы, которым физический атрибут выставили ПОСЛЕ создания тела. Проверяем
//: не сразу, а на следующем кадре: `.body()`/`.collision()` пересоздают тело и
//: читают attrs заново, поэтому мгновенное сообщение было бы ложным — именно
//: так оно и сработало на демо melee («трение задаётся до .collision(): тело
//: пересоздаётся и читает attrs»). Сообщаем, только если тело с тех пор не
//: пересоздавали: значит значение действительно не применилось.
const phys_pending = [];

function notePhysAttr(node, key, value) {
    phys_pending.push({ node, key, value, body: node.body, gen: node._body_gen || 0 });
}

/** Вызывается раз в кадр (api.js). Дёшево: список обычно пуст. */
export function flushPhysAttrReports() {
    if (phys_pending.length === 0) return;
    for (let i = phys_pending.length - 1; i >= 0; i--) {
        const p = phys_pending[i];
        const node = p.node;
        if (!node || node.removed) { phys_pending.splice(i, 1); continue; }
        if ((node._body_gen || 0) !== p.gen || node.body !== p.body) {
            phys_pending.splice(i, 1);   // тело пересоздали — значение прочитано
            continue;
        }
        phys_pending.splice(i, 1);
        diagReport('$.attr', new Error(
            `$.attr('${p.key}') после создания тела не меняет физику: ` +
            'Box2D читает это число один раз, при создании тела'), {
            code: 'R2D_ATTR_AFTER_BODY',
            subsystem: 'physics',
            operation: 'attr',
            nodeId: node.id,
            recoverable: true,
            data: { attr: p.key, value: p.value, body: p.body },
        });
    }
}

export function assignNid(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.nid === undefined || node.nid === null || node.nid === '') {
        node.nid = 'n' + (next_nid++);
    }
    return node.nid;
}

/** Проверка формы nid: 'n' + цифры. Нужна валидаторам данных и save. */
export function isNid(value) {
    if (typeof value !== 'string' || value.length < 2) return false;
    for (const ch of value) if (!nid_digits.has(ch)) return false;
    return value[0] === 'n';
}

/**
 * Проставляет фильтр коллизий живому телу узла. Менять фильтр можно без
 * пересоздания тела: Box2D хранит его на форме, а .setBody() при следующем
 * пересоздании возьмёт те же поля узла.
 */
function applyFilter(node) {
    if (node.body >= 0 && typeof engine.setBodyFilter === 'function') {
        engine.setBodyFilter(node.body, node.layer_bits, node.collision_mask, node.collision_group);
    }
    return node;
}

// ---------------------------------------------------------------------------
// §39. Локальные трансформы: opt-in композиция по цепочке родителей
// ---------------------------------------------------------------------------
//
// Узел по умолчанию живёт в МИРОВЫХ координатах: x/y/angle/scale_x/scale_y —
// его собственный трансформ, и так его читают отрисовка, физика и старый
// игровой код. Опционально узел переводится в локальный режим
// (`.transformSpace('local')`, `.localAt(...)`): тогда в тех же полях лежит
// УЖЕ СКОМПОНИРОВАННЫЙ мировой трансформ, а исходные локальные значения — в
// local_x/local_y/local_angle/local_scale_x/local_scale_y. Поэтому ни одна
// подсистема не меняется: рендер и физика читают те же поля, что и раньше.
//
// Композиция по цепочке родителей:
//   angle = angle_родителя + local_angle;
//   scale = scale_родителя * local_scale (знак сохраняется — flip зеркалит);
//   point = parent + R(angle_родителя) * (local_xy * scale_родителя).
// Неравномерный масштаб родителя масштабирует сдвиг по своим осям, но не даёт
// shear: произвольный наклон запрещён (§39).
//
// Проход кадра пересчитывает все локальные узлы пакетно и с защитой от циклов:
// нативный — engine.nodes.resolveTransforms (src/nodes.c), без движка (юнит-тест
// qjs, $.debug.nativePasses(false)) — резервный JS-путь ниже. Движок зовёт его в
// конце кадра логики и перед отрисовкой (src/script.c), поэтому к началу
// следующего физического шага и к сборке кадра трансформы детей уже верны.

// Список узлов в локальном режиме: проход кадра идёт по нему, а не по всему
// реестру, — без локальных узлов §39 не стоит ничего.
const local_nodes = [];

// Поколение пересчёта. Растёт на каждом проходе: поля _t_gen/_t_busy узла
// хранят номер поколения, в котором он уже пересчитан (или находится в
// обработке — защита от цикла в цепочке родителей).
let local_gen = 0;

/** Включён ли у узла локальный режим (§39). */
export function isLocalSpace(node) {
    return node !== null && node !== undefined && node.local_mode === true;
}

/** Число с запасным значением: поля локального трансформа могут быть не заданы. */
function numOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function addLocalNode(node) {
    if (node._t_local === true) return;
    node._t_local = true;
    local_nodes.push(node);
}

function dropLocalNode(node) {
    if (node._t_local !== true) return;
    node._t_local = false;
    const i = local_nodes.indexOf(node);
    if (i >= 0) local_nodes.splice(i, 1);
}

/**
 * Собрать мировой трансформ локального узла из его локальных значений и
 * мирового трансформа родителя. Возвращает true, если поля узла изменились.
 * Значения родителя берутся из его x/y/angle/scale — они всегда мировые.
 */
function composeLocalInto(node, parent) {
    const lx = numOr(node.local_x, 0);
    const ly = numOr(node.local_y, 0);
    const la = numOr(node.local_angle, 0);
    const lsx = numOr(node.local_scale_x, 1);
    const lsy = numOr(node.local_scale_y, 1);

    let nx, ny, na, nsx, nsy;
    if (!parent) {
        // Корень: мир и локальное совпадают.
        nx = lx; ny = ly; na = la; nsx = lsx; nsy = lsy;
    } else {
        const pa = numOr(parent.angle, 0);
        const psx = numOr(parent.scale_x, 1);
        const psy = numOr(parent.scale_y, 1);
        const c = Math.cos(pa);
        const s = Math.sin(pa);
        const ox = lx * psx;
        const oy = ly * psy;
        nx = parent.x + c * ox - s * oy;
        ny = parent.y + s * ox + c * oy;
        na = pa + la;
        nsx = psx * lsx;
        nsy = psy * lsy;
    }
    const changed = nx !== node.x || ny !== node.y || na !== node.angle ||
                    nsx !== node.scale_x || nsy !== node.scale_y;
    node.x = nx;
    node.y = ny;
    node.angle = na;
    node.scale_x = nsx;
    node.scale_y = nsy;
    return changed;
}

/** Синхронизация тела локального узла: форма едет за скомпонованным трансформом. */
function syncLocalBody(node) {
    if (node.body >= 0) engineOf().setPosition(node.body, node.x, node.y, node.angle);
}

/**
 * Пересчитать цепочку локального узла в текущем поколении (родители — раньше
 * детей). Цикл в цепочке не зацикливает проход: узел, уже находящийся в
 * обработке, второй раз не считается (его ветка берёт текущие значения).
 */
function resolveLocalChain(node) {
    if (node.local_mode !== true) return false;
    if (node._t_gen === local_gen) return false;      // уже пересчитан
    if (node._t_busy === local_gen) return false;     // цикл: узел в обработке
    node._t_busy = local_gen;
    const parent = node.parent_node;
    if (parent && parent.local_mode === true) resolveLocalChain(parent);
    adoptWorldWrite(node, parent);
    const changed = composeLocalInto(node, parent);
    node._t_gen = local_gen;
    node._t_wx = node.x;
    node._t_wy = node.y;
    node._t_wa = node.angle;
    node._t_wsx = node.scale_x;
    node._t_wsy = node.scale_y;
    if (changed) syncLocalBody(node);
    return changed;
}

/**
 * Внешняя запись мирового трансформа: нативный твин (src/nodes.c) и чужие
 * модули пишут `node.x/y/angle/scale_*` напрямую. Если значения разошлись с
 * последним скомпонованным (`_t_w*`), запись принимается как МИРОВАЯ и
 * пересчитывается в локальные поля — иначе проход §39 молча вернул бы узел
 * назад. Собственный проход сюда не попадает: он сам обновляет `_t_w*`.
 */
function adoptWorldWrite(node, parent) {
    if (node._t_wx === undefined) return;              // ещё не компоновался
    if (node.x === node._t_wx && node.y === node._t_wy && node.angle === node._t_wa &&
        node.scale_x === node._t_wsx && node.scale_y === node._t_wsy) return;
    if (!parent) {
        node.local_x = node.x;
        node.local_y = node.y;
        node.local_angle = node.angle;
        node.local_scale_x = numOr(node.scale_x, 1);
        node.local_scale_y = numOr(node.scale_y, 1);
        return;
    }
    const pa = numOr(parent.angle, 0);
    const psx = numOr(parent.scale_x, 1) || 1;
    const psy = numOr(parent.scale_y, 1) || 1;
    const c = Math.cos(pa);
    const s = Math.sin(pa);
    const dx = node.x - parent.x;
    const dy = node.y - parent.y;
    node.local_x = (dx * c + dy * s) / psx;
    node.local_y = (-dx * s + dy * c) / psy;
    node.local_angle = numOr(node.angle, 0) - pa;
    node.local_scale_x = numOr(node.scale_x, 1) / psx;
    node.local_scale_y = numOr(node.scale_y, 1) / psy;
}

/**
 * Кадровый проход §39: пересчитать все локальные узлы. Возвращает число узлов,
 * у которых мировой трансформ изменился. Движок зовёт это сам (src/script.c);
 * вручную вызывать не нужно.
 */
export function resolveLocalTransforms() {
    const count = local_nodes.length;
    if (count === 0) return 0;
    local_gen++;
    const native = nativeNodes();
    if (native && typeof native.resolveTransforms === 'function') {
        return native.resolveTransforms(local_nodes, local_gen, syncLocalBody) | 0;
    }
    let changed = 0;
    for (let i = 0; i < count; i++) {
        const node = local_nodes[i];
        if (!node || node.removed === true) continue;
        if (resolveLocalChain(node)) changed++;
    }
    return changed;
}

/**
 * Регистрация прохода §39 в движке: script.c зовёт его в конце кадра логики и
 * перед отрисовкой. Без движка (юнит-тест qjs) — молча ничего.
 */
export function installTransformResolution() {
    const eng = engineOf();
    if (eng && typeof eng.setResolveTransforms === 'function') {
        eng.setResolveTransforms(resolveLocalTransforms);
    }
}

/** Пометить локальное поддерево устаревшим: следующий запрос/проход пересчитает. */
function invalidateLocalSubtree(node) {
    if (node.local_mode === true) node._t_gen = -1;
    const children = node.child_nodes;
    for (let i = 0; i < children.length; i++) invalidateLocalSubtree(children[i]);
}

/**
 * Метод изменил локальные значения узла: пометить поддерево устаревшим и сразу
 * пересчитать сам узел. Нужно геттерам, которые читают результат сразу после
 * записи (`.localAt(10, 0).worldPoint(0, 0)` — в одном вызове).
 */
export function invalidateNodeTransform(node) {
    invalidateLocalSubtree(node);
    if (node.local_mode !== true) return;
    local_gen++;
    resolveLocalChain(node);
}

/** Есть ли смысл помечать поддерево (в мире есть локальные узлы). */
function node_child_dirty(node) {
    return local_nodes.length !== 0 && node.child_nodes.length !== 0;
}

/**
 * Мировой трансформ узла изменился (`.at()`, `.flip()`, физика): дети в
 * локальном режиме устарели. В проекте без локальных узлов проверка стоит одно
 * сравнение длины списка — §39 не платит за себя там, где не используется.
 */
function noteWorldChanged(node) {
    if (local_nodes.length === 0) return;
    if (node.child_nodes.length !== 0) invalidateLocalSubtree(node);
}

/**
 * Перевести узел в локальный режим, сохранив текущий вид (keep-world):
 * `local_*` выводятся из текущего мирового трансформа и родителя, поэтому
 * снаружи ничего не двигается. Возвращает true, если режим включился.
 */
export function enterLocalSpace(node) {
    if (!node || node.local_mode === true) return false;
    node.local_mode = true;
    const parent = node.parent_node;
    if (!parent || parent.local_mode !== true) {
        // Локальное относительно мирового родителя (или корня).
        if (!parent) {
            node.local_x = node.x;
            node.local_y = node.y;
            node.local_angle = node.angle;
            node.local_scale_x = numOr(node.scale_x, 1);
            node.local_scale_y = numOr(node.scale_y, 1);
        } else {
            enterLocalWithParent(node, parent);
        }
    } else {
        enterLocalWithParent(node, parent);
    }
    addLocalNode(node);
    invalidateLocalSubtree(node);
    resolveLocalChain(node);
    return true;
}

/** Сложить текущий мировой трансформ узла в локальные поля относительно parent. */
function enterLocalWithParent(node, parent) {
    if (parent.local_mode === true) {
        local_gen++;
        resolveLocalChain(parent);
    }
    const pa = numOr(parent.angle, 0);
    const psx = numOr(parent.scale_x, 1);
    const psy = numOr(parent.scale_y, 1);
    const c = Math.cos(pa);
    const s = Math.sin(pa);
    const dx = node.x - parent.x;
    const dy = node.y - parent.y;
    node.local_x = (dx * c + dy * s) / (psx === 0 ? 1 : psx);
    node.local_y = (-dx * s + dy * c) / (psy === 0 ? 1 : psy);
    node.local_angle = numOr(node.angle, 0) - pa;
    node.local_scale_x = numOr(node.scale_x, 1) / (psx === 0 ? 1 : psx);
    node.local_scale_y = numOr(node.scale_y, 1) / (psy === 0 ? 1 : psy);
}

/**
 * Вернуть узел в мировой режим. Мировой трансформ уже лежит в x/y/angle/scale,
 * поэтому ничего не двигается — меняется только способ его вычисления.
 */
export function exitLocalSpace(node) {
    if (!node || node.local_mode !== true) return false;
    node.local_mode = false;
    dropLocalNode(node);
    // Дети в локальном режиме остаются локальными: их цепочка теперь начинается
    // с мирового трансформа этого узла.
    invalidateLocalSubtree(node);
    return true;
}

/** Мировой трансформ узла — всегда в x/y/angle/scale (см. шапку блока). */
export function worldTransformOf(node, out) {
    if (isLocalSpace(node)) {
        if (node._t_gen !== local_gen) {
            local_gen++;
            resolveLocalChain(node);
        }
    }
    const t = out || { x: 0, y: 0, angle: 0, sx: 1, sy: 1 };
    t.x = node.x;
    t.y = node.y;
    t.angle = numOr(node.angle, 0);
    t.sx = numOr(node.scale_x, 1);
    t.sy = numOr(node.scale_y, 1);
    return t;
}

/** Точка локального пространства узла → мировая (§39, камера не участвует). */
export function worldPointOf(node, lx, ly) {
    if (isLocalSpace(node)) {
        if (node._t_gen !== local_gen) {
            local_gen++;
            resolveLocalChain(node);
        }
    }
    const a = numOr(node.angle, 0);
    const sx = numOr(node.scale_x, 1);
    const sy = numOr(node.scale_y, 1);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const ox = lx * sx;
    const oy = ly * sy;
    return { x: node.x + c * ox - s * oy, y: node.y + s * ox + c * oy };
}

/** Мировая точка → локальное пространство узла (обратное к worldPointOf). */
export function localPointOf(node, wx, wy) {
    if (isLocalSpace(node)) {
        if (node._t_gen !== local_gen) {
            local_gen++;
            resolveLocalChain(node);
        }
    }
    const a = numOr(node.angle, 0);
    let sx = numOr(node.scale_x, 1);
    let sy = numOr(node.scale_y, 1);
    if (sx === 0) sx = 1;
    if (sy === 0) sy = 1;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = wx - node.x;
    const dy = wy - node.y;
    return { x: (dx * c + dy * s) / sx, y: (-dx * s + dy * c) / sy };
}

// --- Запись мирового трансформа на узле в локальном режиме ----------------
//
// `.at/.angle/.scale/.flip` сохраняют МИРОВУЮ семантику для любого узла: что
// задали, то и покажет `.pos()`. На локальном узле значение пересчитывается в
// локальное (обратная композиция), поэтому цепочки родителей не «съедают»
// выставленную координату. Локальные значения задают .localAt/.localAngle/
// .localScale.

/** Свежий мировой трансформ родителя (или null, если узел — корень). */
function freshParent(node) {
    const parent = node.parent_node;
    if (parent && parent.local_mode === true && parent._t_gen !== local_gen) {
        local_gen++;
        resolveLocalChain(parent);
    }
    return parent;
}

/** `.at(x, y)` с учётом локального режима. */
export function setWorldPosition(node, x, y) {
    if (isLocalSpace(node)) {
        const parent = freshParent(node);
        if (!parent) {
            node.local_x = x;
            node.local_y = y;
        } else {
            const pa = numOr(parent.angle, 0);
            const psx = numOr(parent.scale_x, 1) || 1;
            const psy = numOr(parent.scale_y, 1) || 1;
            const c = Math.cos(pa);
            const s = Math.sin(pa);
            const dx = x - parent.x;
            const dy = y - parent.y;
            node.local_x = (dx * c + dy * s) / psx;
            node.local_y = (-dx * s + dy * c) / psy;
        }
        invalidateLocalSubtree(node);
    } else {
        noteWorldChanged(node);
    }
    node.x = x;
    node.y = y;
    if (node.body >= 0) engineOf().setPosition(node.body, x, y, node.angle);
}

/** `.angle(rad)` / `.rotate(deg)` с учётом локального режима. */
export function setWorldAngle(node, rad) {
    if (isLocalSpace(node)) {
        const parent = freshParent(node);
        node.local_angle = rad - (parent ? numOr(parent.angle, 0) : 0);
        invalidateLocalSubtree(node);
    } else {
        noteWorldChanged(node);
    }
    node.angle = rad;
    if (node.body >= 0) engineOf().setPosition(node.body, node.x, node.y, rad);
}

/** `.scale(sx, sy)` с учётом локального режима (мировой масштаб узла). */
export function setWorldScale(node, sx, sy) {
    if (isLocalSpace(node)) {
        const parent = freshParent(node);
        const psx = parent ? numOr(parent.scale_x, 1) : 1;
        const psy = parent ? numOr(parent.scale_y, 1) : 1;
        node.local_scale_x = psx === 0 ? sx : sx / psx;
        node.local_scale_y = psy === 0 ? sy : sy / psy;
        invalidateLocalSubtree(node);
    } else {
        noteWorldChanged(node);
    }
    node.scale_x = sx;
    node.scale_y = sy;
}

/** Мировой масштаб узла (скомпонованный) — для .flip() и геттеров. */
export function worldScaleOf(node) {
    if (isLocalSpace(node) && node._t_gen !== local_gen) {
        local_gen++;
        resolveLocalChain(node);
    }
    return { x: numOr(node.scale_x, 1), y: numOr(node.scale_y, 1) };
}

// ---------------------------------------------------------------------------
// §40. Области (areas): несколько независимых форм одного владельца
// ---------------------------------------------------------------------------
//
// Область — это дополнительная native-форма на теле узла (compound shape) со
// своей ролью, локальным смещением/углом, слоями и признаком enabled:
//
//   $('#hero').area('sword', { shape: 'box', w: 48, h: 20, x: 14, angle: -0.3,
//                              sensor: true, role: 'attack', enabled: false });
//   $('#hero').areaOn('sword', true);          // окно атаки открыто
//   $('#hero').areaOverlap('sword');           // кто внутри ПРЯМО СЕЙЧАС
//
// Описания живут на узле (JS), а native-формы пересобираются после каждого
// пересоздания тела (.size(), .sensor(), .collision()): для игры внутреннее
// представление не меняется, как и требует §40. Индексы форм при пересборке
// могут смениться — идентичность области держит её имя, а не handle, поэтому
// дедупликация атак (attack/window id) в игре не сбрасывается.

/** Список областей узла (ленивый). */
export function areaListOf(node) {
    return node.area_list || null;
}

/** Найти описание области по имени. */
export function areaFind(node, name) {
    const list = node.area_list;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
}

/** Числа области: undefined/NaN → запасное значение. */
function areaNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Фильтр области: своё значение, иначе — фильтр ТЕЛА (§40).
 *
 * Одно место на все пути (описание, включение, пересборка): раньше путь
 * `.area(name, opts)`/`applyAreas()` передавал сырые `area.layer/mask/group`, а
 * `areaEnable()` — с подстановкой тела. Из-за расхождения `areaOn(false)` →
 * `areaOn(true)` оставлял форму с ЧУЖИМ фильтром (маска по умолчанию вместо
 * маски тела), и включённую область не видели ни свои запросы, ни чужие формы.
 */
export function areaFilter(node, area) {
    const body_layer = node.layer_bits === undefined ? 1 : node.layer_bits;
    const body_mask = node.collision_mask === undefined ? 0xffffffff : node.collision_mask;
    const body_group = node.collision_group === undefined ? 0 : node.collision_group;
    return {
        layer: area.layer === undefined ? body_layer : area.layer,
        mask: area.mask === undefined ? body_mask : area.mask,
        group: area.group === undefined ? body_group : area.group,
    };
}

/**
 * Форма области в виде описания для engine.addShape/setShape. `w`/`h` — В
 * пикселях (как .size()), в native уходит половина.
 */
function areaShapeDesc(area, node) {
    const filter = node ? areaFilter(node, area)
                        : { layer: area.layer, mask: area.mask, group: area.group };
    const half_w = areaNum(area.w, 32) / 2;
    const half_h = areaNum(area.h, 32) / 2;
    const desc = {
        shape: area.kind,
        x: areaNum(area.x, 0),
        y: areaNum(area.y, 0),
        angle: areaNum(area.angle, 0),
        halfW: half_w,
        halfH: half_h,
        radius: areaNum(area.radius, area.kind === 1 ? Math.min(half_w, half_h) : 0),
        polyRadius: areaNum(area.polyRadius, 0),
        density: 0,
        friction: 0,
        restitution: 0,
        sensor: area.sensor === true,
        contacts: area.contacts === true,
        enabled: area.enabled !== false,
        // Слои: у области свои, иначе — слои тела (одно правило на все пути).
        layerBits: filter.layer,
        mask: filter.mask,
        group: filter.group,
    };
    return desc;
}

/**
 * Пересобрать native-формы областей узла. Зовётся после создания тела и при
 * каждом изменении описания; без тела — запоминает и ждёт (форма появится,
 * когда тело создадут).
 */
export function applyAreas(node) {
    const list = node.area_list;
    if (!list || list.length === 0) return 0;
    const eng = engineOf();
    if (node.body < 0 || typeof eng.addShape !== 'function') {
        for (let i = 0; i < list.length; i++) list[i].index = -1;
        return 0;
    }
    let applied = 0;
    for (let i = 0; i < list.length; i++) {
        const area = list[i];
        // Фильтр НЕ замораживаем в описании: «не задано» значит «как у тела»,
        // поэтому смена слоёв тела остаётся видна и новым, и пересобранным
        // формам (иначе пути описания и включения расходятся).
        const desc = areaShapeDesc(area, node);
        // Индекс мог остаться от прежнего тела (setBody зовёт resetAreaIndices):
        // тогда формы с ним нет и её надо создать заново.
        if (area.index >= 0 && typeof eng.setShape === 'function') {
            const next = eng.setShape(node.body, area.index, desc);
            area.index = next >= 0 ? next : -1;
        }
        if (area.index < 0 && typeof eng.addShape === 'function') {
            const next = eng.addShape(node.body, desc);
            area.index = next >= 0 ? next : -1;
        }
        if (area.index >= 0) {
            applied++;
            // Выключенная область остаётся у тела, но выходит из столкновений и
            // запросов: фильтр обнуляется, игровой владелец жив (§40).
            if (area.enabled === false && typeof eng.setShapeEnabled === 'function') {
                eng.setShapeEnabled(node.body, area.index, false, desc.layerBits, desc.mask, desc.group);
            } else if (area.enabled !== false && typeof eng.setShapeEnabled === 'function') {
                // Пересборка тела возвращает форму включённой — возвращаем ей
                // ровно тот фильтр, который положен по описанию.
                eng.setShapeEnabled(node.body, area.index, true, desc.layerBits, desc.mask, desc.group);
            }
        }
    }
    return applied;
}

/** После пересоздания тела формы теряются: индексы областей недействительны. */
function resetAreaIndices(node) {
    const list = node.area_list;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].index = -1;
}

// Имена форм те же, что у $.world.zone и .shape(): числа — нативный enum
// R2DShapeKind (box, circle, capsule, polygon).
const AREA_KINDS = { box: 0, circle: 1, capsule: 2, polygon: 3 };

function areaKindOf(value, fallback) {
    const k = AREA_KINDS[String(value).toLowerCase()];
    return k === undefined ? fallback : k;
}

/**
 * Объявить/обновить область узла (§40). Возвращает описание области.
 * Повторный вызов с тем же именем меняет только переданные поля.
 */
export function areaDefine(node, name, opts) {
    const o = opts || {};
    if (!node.area_list) node.area_list = [];
    let area = areaFind(node, name);
    let fresh = false;
    if (!area) {
        fresh = true;
        area = {
            name: String(name),
            role: o.role === undefined ? String(name) : String(o.role),
            owner: o.owner === undefined ? null : o.owner,
            owner_nid: null,
            kind: 0, w: 32, h: 32, radius: 0, polyRadius: 0,
            x: 0, y: 0, angle: 0,
            sensor: true, contacts: false,
            layer: undefined, mask: undefined, group: undefined,
            enabled: o.enabled !== false,
            index: -1,
        };
        node.area_list.push(area);
    }
    if (o.role !== undefined) area.role = String(o.role);
    if (o.owner !== undefined) area.owner = o.owner;
    // Владелец-узел из сейва: ссылки на момент создания узла ещё нет —
    // запоминаем nid и достраиваем ссылку после загрузки мира
    // (areaResolveOwners).
    if (o.ownerNid !== undefined && o.ownerNid !== null) {
        area.owner_nid = String(o.ownerNid);
    }
    // shape — основное имя, type — псевдоним (как в $.world.zone).
    if (o.shape !== undefined) area.kind = areaKindOf(o.shape, area.kind);
    if (o.type !== undefined) area.kind = areaKindOf(o.type, area.kind);
    let geometry = fresh;
    if (o.w !== undefined) { area.w = areaNum(o.w, area.w); geometry = true; }
    if (o.h !== undefined) { area.h = areaNum(o.h, area.h); geometry = true; }
    if (o.width !== undefined) { area.w = areaNum(o.width, area.w); geometry = true; }
    if (o.height !== undefined) { area.h = areaNum(o.height, area.h); geometry = true; }
    if (o.radius !== undefined) { area.radius = areaNum(o.radius, area.radius); geometry = true; }
    if (o.polyRadius !== undefined) { area.polyRadius = areaNum(o.polyRadius, 0); geometry = true; }
    if (o.points !== undefined) { area.points = Array.isArray(o.points) ? o.points.slice() : null; geometry = true; }
    if (o.x !== undefined) { area.x = areaNum(o.x, area.x); geometry = true; }
    if (o.y !== undefined) { area.y = areaNum(o.y, area.y); geometry = true; }
    if (o.angle !== undefined) { area.angle = areaNum(o.angle, area.angle); geometry = true; }
    if (o.sensor !== undefined) { area.sensor = o.sensor !== false; geometry = true; }
    if (o.contacts !== undefined) { area.contacts = o.contacts === true; geometry = true; }
    if (o.layer !== undefined) { area.layer = o.layer >>> 0; geometry = true; }
    if (o.mask !== undefined) { area.mask = o.mask >>> 0; geometry = true; }
    if (o.group !== undefined) { area.group = o.group | 0; geometry = true; }
    if (o.enabled !== undefined) area.enabled = o.enabled !== false;

    const eng = engineOf();
    if (node.body < 0 || typeof eng.addShape !== 'function') return area;
    if (geometry && area.index >= 0 && typeof eng.setShape === 'function') {
        const next = eng.setShape(node.body, area.index, areaShapeDesc(area, node));
        area.index = next >= 0 ? next : -1;
    }
    if (area.index < 0) applyAreas(node);
    else if (typeof eng.setShapeEnabled === 'function') {
        const f = areaFilter(node, area);
        eng.setShapeEnabled(node.body, area.index, area.enabled, f.layer, f.mask, f.group);
    }
    return area;
}

/** Включить/выключить область (§40). Возвращает новое состояние. */
export function areaEnable(node, name, on) {
    const area = areaFind(node, name);
    if (!area) return false;
    area.enabled = on !== false;
    if (node.body >= 0 && area.index >= 0) {
        const eng = engineOf();
        if (typeof eng.setShapeEnabled === 'function') {
            const f = areaFilter(node, area);
            eng.setShapeEnabled(node.body, area.index, area.enabled, f.layer, f.mask, f.group);
        }
    }
    return area.enabled;
}

/** Описание области по индексу native-формы — маршрутизация контактов (§40). */
export function areaByIndex(node, index) {
    const list = node.area_list;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (list[i].index === index) return list[i];
    return null;
}

/** Логический владелец области: узел, на котором она объявлена, или owner. */
export function areaOwnerNode(node, area) {
    const o = area.owner;
    if (o === null || o === undefined) return node;
    if (typeof o === 'string') {
        const by_id = ctx.byId.get(o);
        if (by_id) return by_id;
        const found = query(o);
        return found.length ? found[0] : node;
    }
    if (o instanceof Node) return o;
    if (o && o.nodes && o.nodes.length) return o.nodes[0];
    return node;
}

/**
 * Разрешить отложенных владельцев областей (§10).
 *
 * В сейве владелец-узел записан не ссылкой, а `nid` — на момент создания узла
 * соседей ещё нет, и ссылку взять неоткуда. После загрузки всего мира узлы уже
 * существуют, поэтому проход достраивает ссылки; ненайденный владелец остаётся
 * неразрешённым (область по-прежнему считает владельцем свой узел) и попадает
 * в счётчик `missing`, а не превращается в молчаливо потерянную связь.
 */
export function areaResolveOwners() {
    const index = new Map();
    for (const node of ctx.nodes || []) {
        if (node && !node.removed && node.nid) index.set(String(node.nid), node);
    }
    let resolved = 0;
    let missing = 0;
    for (const node of ctx.nodes || []) {
        const list = node && node.area_list;
        if (!list) continue;
        for (const area of list) {
            if (!area.owner_nid) continue;
            const owner = index.get(String(area.owner_nid));
            if (owner) { area.owner = owner; area.owner_nid = null; resolved++; }
            else missing++;
        }
    }
    return { resolved, missing };
}

/**
 * Фактическое состояние формы области по нативному фильтру. Если движка нет
 * или формы ещё нет — берём JS-описание (единственный доступный источник).
 */
export function areaNativeEnabled(node, area) {
    if (node.body < 0 || area.index < 0) return area.enabled !== false;
    const eng = engineOf();
    if (typeof eng.shapeEnabled !== 'function') return area.enabled !== false;
    return eng.shapeEnabled(node.body, area.index) === true;
}

/**
 * §40: синхронизировать JS-описание области с native-состоянием.
 *
 * Форму может переключить не только `.areaOn()`, но и внешний драйвер
 * (анимационная дорожка `shape.enabled`) — он зовёт `engine.setShapeEnabled`
 * напрямую. Тогда единственный источник истины — нативный фильтр, а
 * `.areas()`/`.areaOverlap()` обязаны показывать именно его, иначе игра видит
 * неправду. Возвращает true, если описание пришлось поправить.
 */
export function areaSync(node, area) {
    const actual = areaNativeEnabled(node, area);
    if (actual !== (area.enabled !== false)) {
        area.enabled = actual;
        return true;
    }
    return false;
}

/** Синхронизировать все области узла с native-состоянием. */
export function areaSyncAll(node) {
    const list = node.area_list;
    if (!list) return 0;
    let fixed = 0;
    for (let i = 0; i < list.length; i++) if (areaSync(node, list[i])) fixed++;
    return fixed;
}

/** Краткое описание области для игры и отладки. */
export function areaInfo(node, area) {
    areaSync(node, area);
    return {
        name: area.name,
        role: area.role,
        shape: area.kind === 1 ? 'circle' : (area.kind === 2 ? 'capsule' : (area.kind === 3 ? 'polygon' : 'box')),
        x: area.x, y: area.y, angle: area.angle,
        w: area.w, h: area.h, radius: area.radius,
        sensor: area.sensor === true,
        enabled: area.enabled !== false,
        layer: area.layer === undefined ? node.layer_bits : area.layer,
        mask: area.mask === undefined ? node.collision_mask : area.mask,
        group: area.group === undefined ? node.collision_group : area.group,
        index: area.index,
        owner: area.owner === null || area.owner === undefined ? node.id || node.nid : area.owner,
    };
}

/**
 * Кто пересекается с областью ПРЯМО СЕЙЧАС (§40, «overlap policy»).
 *
 * Это явный геометрический запрос, а не история событий: цель, уже стоящая
 * внутри области в момент открытия окна атаки, обязана обнаружиться без
 * ожидания нового движения. Выключенная область не возвращает никого.
 * Результат: `[{ node, body, shape, area, role, owner }]`, где `node` — узел
 * цели (может быть null, если тело без узла), `owner` — логический владелец
 * области (не сенсор), `area`/`role` — имя и роль области.
 */
export function areaOverlap(node, name, opts) {
    const area = areaFind(node, name);
    if (!area || node.body < 0 || area.index < 0) return [];
    // Состояние читаем у native-формы, а не у JS-флага: форму мог выключить
    // внешний драйвер, и тогда ранний выход по устаревшему флагу врал бы.
    // Выключенную форму сам запрос и не вернёт (нулевой фильтр).
    if (!areaNativeEnabled(node, area)) {
        area.enabled = false;
        return [];
    }
    const eng = engineOf();
    if (typeof eng.shapeOverlaps !== 'function') return [];
    const o = opts || {};
    const mask = o.mask !== undefined ? o.mask >>> 0
               : (area.mask === undefined ? (node.collision_mask >>> 0) : area.mask >>> 0);
    const category = o.category !== undefined ? o.category >>> 0
                   : (area.layer === undefined ? (node.layer_bits >>> 0) : area.layer >>> 0);
    const raw = eng.shapeOverlaps(node.body, area.index, category, mask, o.cap === undefined ? 32 : o.cap) || [];
    const owner = areaOwnerNode(node, area);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (!item) continue;
        const other = ctx.byBody.get(item.body);
        out.push({
            node: other ? wrapOne(other) : null,
            self: wrapOne(node),
            owner: wrapOne(owner),
            body: item.body,
            shape: item.shape,
            area: area.name,
            role: area.role,
        });
    }
    return out;
}


const EVENT_ALIASES = {
    collision: 'collide',
    contact: 'collide',
    separation: 'separate',
};

/** Есть ли в строке пробельный символ (быстрее regexp на коротких именах). */
function hasSpace(text) {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 32 || (c >= 9 && c <= 13) || c === 160) return true;
        // Редкие юникод-пробелы (U+1680, U+2000…) решает тот же regexp, что и раньше.
        if (c >= 0x1680) return /\s/.test(text);
    }
    return false;
}

/** Каноническое имя события (или исходное, если псевдонима нет). */
export function eventName(name) {
    if (typeof name !== 'string') return name;
    return EVENT_ALIASES[name.toLowerCase()] || name;
}

// Упакованные цвета тега считаются один раз на объект умолчаний TAGS, а не
// на каждый узел: четыре разбора строки и вызов engine.rgba в конструкторе.
const tag_colors = new Map();
const NO_DEFAULTS = Object.freeze({});
function tagColors(defaults) {
    let c = tag_colors.get(defaults);
    if (c === undefined) {
        c = {
            color: packColor(defaults.color),
            hover: defaults.hoverColor ? packColor(defaults.hoverColor) : null,
            text: defaults.textColor ? packColor(defaults.textColor) : engine.WHITE,
            fill: defaults.fillColor ? packColor(defaults.fillColor) : engine.rgba(80, 200, 100, 255),
        };
        tag_colors.set(defaults, c);
    }
    return c;
}

export class Node {
    constructor(tag, attrs) {
        // Общий пустой объект: кэш цветов тега (tagColors) держит ключ по
        // объекту умолчаний, и новый `{}` на каждый неизвестный тег рос бы.
        const defaults = TAGS[tag] || NO_DEFAULTS;
        this.uid = next_uid++;
        // Стабильный логический ID (см. assignNid выше): нужен save/restore,
        // трассировке событий (§13) и диагностике (§17), где uid не годится.
        this.nid = 'n' + (next_nid++);
        this.tag = tag;
        // Вид узла (docs/RE2D.md): '2d' — обычный узел, 're2d' — 2.5D-вид того
        // же мира. Строка, а не null: `[kind=2d]` и сериализация работают без
        // особых случаев, а рендер сравнивает её одним `!==` (kinds.js).
        this.kind = '2d';
        this.attrs = {};                 // всё, что не описано ниже
        this.classes = new Set();
        // Те же классы массивом, в порядке Set: его читает нативная сборка
        // индекса реестра (src/nodes.c) — итерировать Set из C нельзя.
        // Меняется только вместе с classes (addClass/removeClass/toggleClass).
        this.class_list = [];

        // Узлы интерфейса живут в координатах окна: камера на них не влияет,
        // и в игровой мир они не попадают. Признак хранится в attrs, потому
        // что именно там его ищут отрисовка, снимок для агента и подсчёт узлов.
        if (defaults.ui) this.attrs.ui = true;

        this.x = 0;
        this.y = 0;
        // I1/Д13: смещение ТОЛЬКО для отрисовки (параллакс). Позиция x/y — это
        // позиция игры: её читают физика, геймплей и .pos(); нативный проход и
        // render.js прибавляют draw_off при рисовании.
        this.draw_off_x = 0;
        this.draw_off_y = 0;
        this.w = defaults.w !== undefined ? defaults.w : 32;
        this.h = defaults.h !== undefined ? defaults.h : 32;
        // H10: «размер задан явно» — флаг вместо прежней эвристики `w === 32`.
        // Из-за неё `.size(32, 32)` не отличался от «размер не задавали», и
        // смена листа (`.frames()`/`.sprite({cols,rows,cw,ch})`) переписывала
        // габариты узла размером кадра.
        this.size_locked = false;
        this.r = defaults.r;
        this.angle = 0;
        this.scale_x = 1;
        this.scale_y = 1;
        this.alpha = 1;
        const colors = tagColors(defaults);
        this.color = colors.color;
        this.hover_color = colors.hover;
        this.text_color = colors.text;
        this.fill_color = colors.fill;
        this.visible = true;
        this.layer = defaults.ui ? 1000 : 0;
        this.depth = 0;

        this.sprite = -1;
        this.default_sprite = dotSprite();

        // Физика
        this.body_kind = defaults.body || null;   // 'static' | 'dynamic' | 'kinematic'
        this.body = -1;
        this.gravity_on = defaults.gravity !== false;
        // CCD: быстрое тело (пуля) проверяется непрерывно — иначе за шаг оно
        // проходит десятки пикселей и проскакивает тонкие стены.
        this.bullet_on = defaults.bullet === true;
        // Форма тела: 'box' (по умолчанию) | 'circle' | 'capsule' | 'polygon'.
        // У <circle> форма задана тегом; остальные включают её явно.
        this.shape_kind = defaults.shape || null;
        this.sensor = !!defaults.sensor;     // зона без отталкивания
        // События контакта (collide/separate/hit). По умолчанию включены
        // динамическим телам: именно они во что-то врезаются. Явный вызов
        // .contacts(true/false) перебивает автоматику — для этого и храним
        // режим отдельно от текущего значения.
        this.contacts_mode = defaults.contacts !== undefined ? !!defaults.contacts : null;
        // Слои и маски коллизий (b2Filter). layer_bits — «в каком слое лежит
        // тело», collision_mask — «с какими слоями сталкивается». Умолчания
        // повторяют прежнее поведение движка: слой 1, сталкивается со всеми.
        // Маски 32-битные: побитовые операторы JS всё равно 32-битные.
        this.layer_bits = defaults.layerBits !== undefined ? defaults.layerBits >>> 0 : 0x1;
        this.collision_mask = defaults.mask !== undefined ? defaults.mask >>> 0 : 0xffffffff;
        this.collision_group = defaults.group !== undefined ? defaults.group | 0 : 0;

        // Здоровье
        this.max_hp = defaults.hp || 0;
        this.cur_hp = this.max_hp;
        // Прошлый кадр для автособытий мира (_hp_seen/_vis_seen) заводит сам
        // проход worldEvents: пока полей нет, узел «ещё не виден» (§3.1).
        // Скорость из TAGS: без этого умолчания тегов (enemy 90, npc 70) не
        // доходили ни до .controls(), ни до .attr('speed') — враг с
        // управлением ехал 150, хотя справочник обещал 90.
        this.speed = defaults.speed !== undefined ? defaults.speed : 0;
        this.team = defaults.team !== undefined ? defaults.team : 0;

        // Иерархия
        this.parent_node = null;
        this.child_nodes = [];
        this.removed = false;

        // Интерфейс
        this.value = defaults.value !== undefined ? defaults.value : 0;
        this.max_value = defaults.max !== undefined ? defaults.max : 1;

        this.text = defaults.text !== undefined ? defaults.text : '';
        this.size = defaults.size !== undefined ? defaults.size : 20;
        this.radius = defaults.radius !== undefined ? defaults.radius : 200;
        this.intensity = defaults.intensity !== undefined ? defaults.intensity : 1;

        // Узел лежит в ctx.nodes. Флаг нужен там, где раньше был
        // ctx.nodes.indexOf(node) — это O(N) на проверку (§3.3 отчёта).
        ctx.nodes.push(this);
        this.in_registry = true;
        this.applyInitial(attrs);

        // Тело создаётся сразу после применения атрибутов: у тегов вроде
        // <player>/<enemy>/<wall> оно подразумевается, а размеры и позиция уже
        // известны. Дальнейшие .at() и .size() тело просто переносят.
        if (defaults.body) this.syncBody();

        // Реестр изменился — в конце, чтобы attrs.ui из attrs уже был учтён.
        touchRegistry();
    }

    // --- Служебное ---------------------------------------------------------

    applyInitial(attrs) {
        if (!attrs) return;
        for (const key of Object.keys(attrs)) {
            const value = attrs[key];
            if (key === 'class') { this.addClass(value); continue; }
            if (key === 'tag') { this.addTag(value); continue; }
            // Привязку к родителю делает слой `$` сразу после конструктора:
            // здесь у узла ещё нет обёртки, а `appendTo` живёт на обёртке
            // (прежний `this.appendTo(value)` падал с «not a function», task-46).
            if (key === 'parent') { this.attrs.parent = value; continue; }
            if (key === 'script') { this.attrs.script = value; continue; }
            if (key === 'on') {
                for (const ev of Object.keys(value)) this.on(ev, value[ev]);
                continue;
            }
            this.set(key, value);
        }
    }

    /**
     * Ставит свойство по имени. Все поля, которые объявлены в TAGS, должны
     * быть здесь: атрибут из $('<тег>', { … }) иначе осядет в attrs и не
     * подействует (именно так «терялись» hp, value и radius).
     */
    set(key, value) {
        switch (key) {
        case 'id':      ctx.byId.set(String(value), this); this.id = String(value); return this;
        case 'x':       this.moveToX(Number(value)); return this;
        case 'y':       this.moveToY(Number(value)); return this;
        case 'w': case 'width':  this.w = Number(value); this.size_locked = true; return this;
        case 'h': case 'height': this.h = Number(value); this.size_locked = true; return this;
        case 'hp':      this.max_hp = Math.max(this.max_hp, Number(value)); this.cur_hp = Number(value); return this;
        case 'maxHp':   this.max_hp = Number(value); this.cur_hp = Math.min(this.cur_hp, this.max_hp); return this;
        case 'speed':   this.speed = Number(value); this.attrs.speed = this.speed; return this;
        case 'sprite':  this.setSprite(value); return this;
        case 'color':   this.color = packColor(value); return this;
        case 'hoverColor': this.hover_color = packColor(value); return this;
        case 'textColor':  this.text_color = packColor(value); return this;
        case 'fillColor':  this.fill_color = packColor(value); return this;
        case 'alpha': case 'opacity': this.alpha = Number(value); return this;
        case 'visible': this.visible = !!value; return this;
        case 'layer':   this.layer = Number(value); return this;
        case 'depth': case 'z': this.depth = Number(value); return this;
        case 'team':    this.team = Number(value); return this;
        case 'text':    this.text = String(value); return this;
        case 'size':    this.size = Number(value); return this;
        case 'value':   this.value = Number(value); return this;
        case 'max':     this.max_value = Number(value); return this;
        case 'radius':  this.radius = Number(value); return this;
        case 'intensity': this.intensity = Number(value); return this;
        case 'align':   this.attrs.align = String(value); return this;
        // Вид узла (`$('<npc>', { kind: Re2D })`). Реестр видов живёт в
        // kinds.js, который импортирует core.js, поэтому проверка имени
        // подключается через ctx (ставит installKinds), а не импортом.
        case 'kind':    this.kind = ctx.normalizeKind ? ctx.normalizeKind(value) : String(value || '2d'); return this;
        // §39: режим трансформа — 'local' (локальные координаты относительно
        // родителя) или 'world' (прежнее поведение по умолчанию).
        case 'transformSpace':
            if (String(value) === 'local') enterLocalSpace(this);
            else exitLocalSpace(this);
            return this;
        case 'localAt': case 'localPos': {
            // Сначала вход в локальный режим (он выводит local_* из текущего
            // мира), затем явные значения — иначе они были бы перезаписаны.
            enterLocalSpace(this);
            if (Array.isArray(value)) { this.local_x = Number(value[0]) || 0; this.local_y = Number(value[1]) || 0; }
            else if (value && typeof value === 'object') { this.local_x = Number(value.x) || 0; this.local_y = Number(value.y) || 0; }
            invalidateLocalSubtree(this);
            return this;
        }
        case 'localAngle':
            enterLocalSpace(this);
            this.local_angle = Number(value) || 0;
            invalidateLocalSubtree(this);
            return this;
        case 'localScale': {
            enterLocalSpace(this);
            if (Array.isArray(value)) { this.local_scale_x = Number(value[0]); this.local_scale_y = Number(value[1]); }
            else if (value && typeof value === 'object') { this.local_scale_x = Number(value.x); this.local_scale_y = Number(value.y); }
            else { this.local_scale_x = Number(value); this.local_scale_y = this.local_scale_x; }
            if (!Number.isFinite(this.local_scale_x)) this.local_scale_x = 1;
            if (!Number.isFinite(this.local_scale_y)) this.local_scale_y = this.local_scale_x;
            invalidateLocalSubtree(this);
            return this;
        }
        case 'bullet': this.bullet_on = value !== false;
                       if (this.body >= 0) engine.setBullet(this.body, this.bullet_on);
                       return this;
        case 'gravity': this.gravity_on = value !== false;
                        this.no_gravity = !this.gravity_on && this.body >= 0; return this;
        case 'controls':
            // Сводка кадра считает управляемые узлы — состав изменился.
            if (!this.attrs.controls !== !value) touchRegistry();
            this.attrs.controls = value;
            return this;
        case 'body':    this.setBody(value); return this;
        // Слои и маски коллизий. Псевдонимов у имён нет намеренно: `layer`
        // уже занят порядком отрисовки, а `mask` — маска столкновений.
        case 'layerBits':
            this.layer_bits = Number(value) >>> 0;
            return applyFilter(this);
        case 'mask':
            this.collision_mask = Number(value) >>> 0;
            return applyFilter(this);
        case 'group':
            this.collision_group = Number(value) | 0;
            return applyFilter(this);
        case 'collision': this.hitbox = Array.isArray(value) ? { w: value[0], h: value[1] } : { w: value, h: value }; return this;
        case 'src':
            // Грабли: { src } в конструкторе раньше оседал в attrs и картинку
            // не грузил, хотя .sprite(src) работал. У спрайтовых тегов src —
            // псевдоним картинки. У <tilemap>/<particles> свойство src читают
            // их собственные отрисовщики, и грузить им нечего.
            this.attrs.src = value;
            if (TAGS[this.tag] && 'sprite' in TAGS[this.tag]) this.setSprite(value);
            return this;
        case 'density': case 'friction': case 'restitution': {
            // Box2D читает эти числа один раз — при создании тела. Раньше смена
            // после .body() молча ничего не делала: игра думала, что поменяла
            // трение, а физика жила со старым. Теперь расхождение видно в
            // диагностике (и его можно поймать тестом), а значение остаётся в
            // attrs — его прочитает пересоздание тела.
            const was = this.attrs[key];
            this.attrs[key] = value;
            if (was !== value && this.body >= 0 && value !== undefined && value !== null) {
                notePhysAttr(this, key, value);
            }
            return this;
        }
        default:
            // Признаки, от которых зависят сводки подсистем (зоны, ui-узлы),
            // можно сменить и через .attr(): отмечаем реестр изменённым, иначе
            // подсистема с нулевым счётчиком не заметила бы новый узел.
            if ((key === 'ui' || key === 'trigger' || key === 'tr') && this.attrs[key] !== value) touchRegistry();
            this.attrs[key] = value;
            return this;
        }
    }

    /**
     * Читает свойство по тому же имени, что принимает set(). Нужен для
     * .attr(name): он смотрел только в attrs, поэтому .attr('id') возвращал
     * undefined, хотя .attr('src') работал — свойства и атрибуты расходились.
     */
    get(key) {
        switch (key) {
        case 'id':      return this.id;
        case 'x':       return this.x;
        case 'y':       return this.y;
        case 'w': case 'width':  return this.w;
        case 'h': case 'height': return this.h;
        case 'hp':      return this.cur_hp;
        case 'maxHp':   return this.max_hp;
        case 'team':    return this.team;
        case 'speed':   return this.speed;
        case 'sprite':  return this.attrs.sprite !== undefined ? this.attrs.sprite
                             : (this.attrs.src !== undefined ? this.attrs.src : this.sprite);
        case 'color':   return this.color;
        case 'alpha': case 'opacity': return this.alpha;
        case 'visible': return this.visible;
        case 'layer':   return this.layer;
        case 'depth': case 'z': return this.depth;
        case 'text':    return this.text;
        case 'size':    return this.size;
        case 'value':   return this.value;
        case 'max':     return this.max_value;
        case 'radius':  return this.radius;
        case 'intensity': return this.intensity;
        // §39: режим трансформа и локальные значения.
        case 'transformSpace': return this.local_mode === true ? 'local' : 'world';
        case 'localAt': case 'localPos':
            return { x: numOr(this.local_x, 0), y: numOr(this.local_y, 0) };
        case 'localAngle': return this.local_mode === true ? numOr(this.local_angle, 0) : numOr(this.angle, 0);
        case 'localScale':
            return { x: numOr(this.local_scale_x, 1), y: numOr(this.local_scale_y, 1) };
        case 'body':    return this.body_kind;
        case 'layerBits': return this.layer_bits;
        case 'mask':    return this.collision_mask;
        case 'group':   return this.collision_group;
        case 'collision': return this.hitbox ? this.hitbox.w : this.w;
        case 'class':   return Array.from(this.classes).join(' ');
        case 'tag': case 'tags': return this.tags_extra === null ? '' : Array.from(this.tags_extra).join(' ');
        default:        return this.attrs[key];
        }
    }

    /** Дети в локальном режиме устарели: мировой трансформ узла изменился. */
    noteWorldChanged() { noteWorldChanged(this); return this; }

    moveToX(x) {
        let y = this.y;
        let a = this.angle;
        if (this.body >= 0) {
            const t = engine.getTransforms();
            y = t[this.body * 3 + 1];
            a = t[this.body * 3 + 2];
        }
        if (isLocalSpace(this)) {
            // Локальный узел: .x задаёт МИРОВУЮ координату (совместимость),
            // в локальные поля она пересчитывается обратной композицией.
            this.y = y;
            this.angle = a;
            setWorldPosition(this, x, y);
            return this;
        }
        if (this.body >= 0) engine.setPosition(this.body, x, y, a);
        this.x = x;
        this.noteWorldChanged();
        return this;
    }

    moveToY(y) {
        let x = this.x;
        let a = this.angle;
        if (this.body >= 0) {
            const t = engine.getTransforms();
            x = t[this.body * 3];
            a = t[this.body * 3 + 2];
        }
        if (isLocalSpace(this)) {
            this.x = x;
            this.angle = a;
            setWorldPosition(this, x, y);
            return this;
        }
        if (this.body >= 0) engine.setPosition(this.body, x, y, a);
        this.y = y;
        this.noteWorldChanged();
        return this;
    }

    setSprite(value) {
        if (value === null || value === undefined) { this.sprite = this.default_sprite; return; }
        this.sprite = resolveSprite(value);
        const [w, h] = spriteSize(this.sprite);
        // Размер из спрайта берём, только если его не задавали явно: иначе
        // смена кадра/листа молча меняла габариты узла (H10).
        if (w > 0 && !this.size_locked) { this.w = w; this.h = h; }
        return this;
    }

    setBody(kind) {
        if (kind === null || kind === false) {
            if (this.body >= 0) {
                ctx.byBody.delete(this.body);
                engine.destroyBody(this.body);
            }
            this.body = -1;
            this.body_kind = null;
            // Запоминаем запрет: иначе syncBody() вернул бы тело из тега
            // (так $('<bullet>', { body: null }) молча получал тело).
            this.body_disabled = true;
            return;
        }
        this.body_disabled = false;
        const map = { static: engine.STATIC, dynamic: engine.DYNAMIC, kinematic: engine.KINEMATIC };
        const type = map[kind];
        if (type === undefined) { ctx.log(`$: неизвестный тип тела "${kind}"`); return; }
        // Пересоздание тела не должно терять скорость: иначе цепочка
        // .velocity(...).appendTo(...) или поздний .collision() молча
        // обнуляли бы разгон (и снаряд падал бы вместо полёта).
        let keep_vx = 0, keep_vy = 0, had_velocity = false;
        if (this.body >= 0) {
            const v = engine.getVelocity(this.body);
            if (v && (v[0] !== 0 || v[1] !== 0)) {
                keep_vx = v[0];
                keep_vy = v[1];
                had_velocity = true;
            }
            engine.destroyBody(this.body);
        }
        const hw = (this.hitbox ? this.hitbox.w : this.w) / 2;
        const hh = (this.hitbox ? this.hitbox.h : this.h) / 2;
        const opts = {
            x: this.x, y: this.y, halfW: hw, halfH: hh, angle: this.angle,
            type, density: this.attrs.density !== undefined ? this.attrs.density : 1.0,
            friction: this.attrs.friction !== undefined ? this.attrs.friction : 0.3,
            restitution: this.attrs.restitution !== undefined ? this.attrs.restitution : 0.0,
            fixedRotation: this.attrs.fixedRotation !== undefined ? this.attrs.fixedRotation : true,
            // Слои и маски: тело создаётся сразу с нужным фильтром, иначе
            // первый кадр оно сталкивалось бы со всеми подряд.
            layerBits: this.layer_bits,
            mask: this.collision_mask,
            group: this.collision_group,
        };

        // Форма. Круг и капсула задают радиус, полигон — точки в локальных
        // пикселях. Всё остальное остаётся прямоугольником.
        const kind_shape = this.shape_kind || (TAGS[this.tag] ? TAGS[this.tag].shape : null);
        if (kind_shape === 'circle') {
            opts.shape = 'circle';
            opts.radius = this.circle_hitbox > 0 ? this.circle_hitbox : Math.min(hw, hh);
        } else if (kind_shape === 'capsule') {
            opts.shape = 'capsule';
            opts.radius = this.circle_hitbox > 0 ? this.circle_hitbox : Math.min(hw, hh);
        } else if (kind_shape === 'polygon' && Array.isArray(this.poly_points) && this.poly_points.length >= 6) {
            opts.shape = 'polygon';
            opts.points = this.poly_points;
            opts.polyRadius = this.attrs.polyRadius || 0;
        }

        if (this.one_way) {
            opts.oneWay = true;
            opts.oneWayAngle = this.one_way_angle;
        }
        if (this.sensor) opts.sensor = true;
        if (this.bullet_on) opts.bullet = true;
        // Контакты: явный режим важнее автоматики, автоматика — «динамическим
        // телам по умолчанию». Иначе тело, созданное позже через .body(),
        // молча не присылало бы collide.
        const want_contacts = this.contacts_mode === null ? (kind === 'dynamic') : this.contacts_mode;
        this.contacts_enabled = want_contacts;
        if (want_contacts) opts.contacts = true;

        this.body = engine.createBody(opts);
        // Поколение тела: по нему отложенная проверка атрибутов понимает, что
        // тело пересоздали и значение всё-таки прочитано.
        this._body_gen = (this._body_gen || 0) + 1;
        this.body_kind = kind;
        if (this.body < 0) {
            ctx.log(`$: не удалось создать тело для <${this.tag}>`);
            return;
        }

        ctx.byBody.set(this.body, this);
        // Узел вошёл в срез body индекса реестра: кадровый синк физики ходит
        // только по нему, а не по всему миру (§5, P2 отчёта).
        touchRegistry();

        // §40: тело пересоздано — прежние формы областей уничтожены вместе с
        // ним. Описания областей живут на узле, поэтому формы возвращаются на
        // место (и снова выключаются те, что были выключены): внутреннее
        // представление не меняет gameplay.
        resetAreaIndices(this);
        if (this.area_list) applyAreas(this);

        // Возвращаем скорость, снятую до пересоздания тела.
        if (had_velocity) {
            engine.setVelocity(this.body, keep_vx, keep_vy);
            this.velocity_cache = { x: keep_vx, y: keep_vy };
        }

        // Гравитация задаётся средствами Box2D (множитель на тело), а не
        // гашением скорости в игровом цикле: так тело падает честно, а
        // снаряд с .gravity(false) летит по прямой.
        engine.setGravityScale(this.body, this.gravity_on === false ? 0 : 1);
        this.no_gravity = false;
        return;
    }

    /**
     * Создаёт (или пересоздаёт) тело под текущие координаты и размер.
     * Нужно после смены размеров и при создании узла, у которого тег
     * подразумевает тело (player, enemy, wall…) — тело нельзя создать раньше,
     * чем известны размеры.
     */
    syncBody() {
        if (this.body_disabled) return;
        const kind = this.body_kind || (TAGS[this.tag] ? TAGS[this.tag].body : null);
        if (!kind) return;
        this.setBody(kind);
    }

    /** Пересоздаёт тело под новый размер (вызывается из .size()/.collision()). */
    syncBodySize() {
        if (this.body < 0 && !this.body_kind) return;
        const velocity = this.velocity_cache || { x: 0, y: 0 };
        this.syncBody();
        if (this.body >= 0) engine.setVelocity(this.body, velocity.x, velocity.y);
    }

    destroy() {
        if (this.body >= 0) {
            ctx.byBody.delete(this.body);
            engine.destroyBody(this.body);
            this.body = -1;
        }
        this.removed = true;
        // §39: локальный узел уходит из списка кадрового прохода — мёртвый узел
        // не должен пересчитываться и подавать тело в физику.
        dropLocalNode(this);
        // Раньше запись в byId оставалась жить: '#id' находил удалённый узел
        // до ближайшего ленивого свипа (prefab/save/scene). Чистим сразу —
        // иначе быстрый путь поиска по id в query() отдавал бы мертвеца.
        if (this.id !== undefined && ctx.byId.get(this.id) === this) ctx.byId.delete(this.id);
        dropFromRegistry(this);
        for (const child of this.child_nodes.slice()) child.destroy();
        // Родителем может быть только узел: «мир» — это отсутствие родителя
        // (см. resolveContainer в api.js), иначе здесь падало бы на строке.
        if (this.parent_node && this.parent_node.child_nodes) {
            const j = this.parent_node.child_nodes.indexOf(this);
            if (j >= 0) this.parent_node.child_nodes.splice(j, 1);
        }
        this.parent_node = null;
        this.emit('remove', { self: wrapOne(this) });
    }

    // --- События -----------------------------------------------------------

    on(name, fn) {
        const key = eventName(name);
        if (this.listeners === null) this.listeners = new Map();
        if (!this.listeners.has(key)) this.listeners.set(key, []);
        this.listeners.get(key).push(fn);
        return this;
    }

    off(name, fn) {
        if (this.listeners === null) return this;
        if (!name) { this.listeners.clear(); return this; }
        const key = eventName(name);
        if (!fn) { this.listeners.delete(key); return this; }
        const list = this.listeners.get(key);
        if (list) this.listeners.set(key, list.filter((f) => f !== fn));
        return this;
    }

    emit(name, data) {
        const key = eventName(name);
        const list = this.listeners === null ? null : this.listeners.get(key);
        if (list && list.length) {
            const event = makeEvent(this, key, data);
            for (const fn of list.slice()) {
                try { fn(event); } catch (e) { ctx.log(`$: ошибка в обработчике "${key}": ${e}`); }
                if (event.stopped) break;
            }
        }
        // Глобальные подписки: $('*').on(...) и $.on('entity:...').
        // Если их нет вовсе, dispatchGlobal выходит первой строкой — объекта
        // события, трёх обёрток и строк 'entity:…' не будет (§3.5 отчёта).
        ctx.$._dispatchGlobal(this, key, data);
        return this;
    }

    // --- Классы и теги -----------------------------------------------------

    addClass(name) {
        const text = String(name);
        // Одно имя без пробелов — самый частый случай ($('<rect>', { class:
        // 'mob' })): без split/regexp/filter на каждом узле.
        if (text.length !== 0 && !hasSpace(text)) {
            if (this.classes.has(text)) return this;
            this.classes.add(text);
            this.class_list.push(text);
            touchRegistry();
            return this;
        }
        const list = text.split(/\s+/).filter(Boolean);
        let changed = false;
        for (const c of list) {
            if (!this.classes.has(c)) { this.classes.add(c); this.class_list.push(c); changed = true; }
        }
        // Классы читают селекторы и зоны (isZoneNode): сводки подсистем
        // должны узнать об изменении.
        if (changed) touchRegistry();
        return this;
    }
    removeClass(name) {
        const list = String(name).split(/\s+/).filter(Boolean);
        let changed = false;
        for (const c of list) {
            if (this.classes.delete(c)) {
                changed = true;
                const i = this.class_list.indexOf(c);
                if (i >= 0) this.class_list.splice(i, 1);
            }
        }
        if (changed) touchRegistry();
        return this;
    }
    toggleClass(name, force) {
        const has = this.classes.has(name);
        const want = force === undefined ? !has : !!force;
        if (want === has) return this;
        if (want) {
            this.classes.add(name);
            this.class_list.push(name);
        } else {
            this.classes.delete(name);
            const i = this.class_list.indexOf(name);
            if (i >= 0) this.class_list.splice(i, 1);
        }
        touchRegistry();
        return this;
    }
    hasClass(name) { return this.classes.has(name); }
    /**
     * Хранилище данных узла: создаётся при первой записи. Прямое обращение к
     * полю `data_store` может вернуть null — используйте этот метод.
     */
    dataMap() {
        if (this.data_store === null) this.data_store = new Map();
        return this.data_store;
    }

    addTag(name) {
        if (this.tags_extra === null) this.tags_extra = new Set();
        this.tags_extra.add(name);
        return this;
    }
    removeTag(name) {
        if (this.tags_extra !== null) this.tags_extra.delete(name);
        return this;
    }

    matches(sel) { return matchesSelector(this, sel); }
}

// Неизменяемые умолчания узла живут на прототипе, а не в каждом объекте:
// в QuickJS каждое новое собственное свойство — переход формы (≈28 нс), и
// конструктор с семью десятками полей стоил ≈4 мкс на узел
// (docs/HIGH_LEVEL_API_PERF.md §0.6). Чтение `node.tint` даёт то же значение,
// первая запись создаёт собственное поле. Здесь только примитивы и null —
// общий изменяемый объект на прототипе был бы ошибкой. Горячие поля кадра
// (x, y, w, h, angle, scale, alpha, visible, layer, depth, sprite, color,
// body, removed, parent_node, kind) остаются собственными: их читает C.
Object.assign(Node.prototype, {
    z: 0,                     // алиас depth, используется .depth()
    anim: null,               // текущая спрайт-анимация
    frames: null,             // массив кадров
    frame_index: 0,
    hitbox: null,             // {w, h} — если задан явно
    circle_hitbox: 0,
    poly_points: null,        // для 'polygon': плоский массив x,y
    one_way: false,
    one_way_angle: -Math.PI / 2,   // куда смотрит лицевая сторона
    contacts_enabled: false,
    iframes: 0,
    tint: null,               // временный цвет (.flash)
    tint_timer: 0,
    shake_timer: 0,
    shake_amount: 0,
    detached: false,
    listeners: null,          // события: ленивый Map, см. on()
    data_store: null,         // ленивый Map, см. dataMap()
    _drop_queued: false,      // помечен на удаление внутри $.batch
    hovered: false,
    pressed: false,
    tile_src: null,
    tags_extra: null,         // ленивый Set: см. addTag/removeTag
    velocity_cache: null,     // {x, y} последней заданной скорости (пишут .velocity() и тело)
});

// ---------------------------------------------------------------------------
// Обёртка-коллекция (то, что возвращает $)
// ---------------------------------------------------------------------------

/**
 * Точка из селектора, узла, обёртки или `{ x, y }`; null — цель не найдена
 * (пустой селектор) или на точку не похожа. Благодаря этому `.within()`
 * никогда не бросает исключений: пустая цель даёт пустую выборку.
 */
function targetPoint(target) {
    if (target === null || target === undefined) return null;
    if (typeof target === 'string') {
        const node = query(target)[0];
        return node ? { x: node.x, y: node.y } : null;
    }
    if (target instanceof Wrapper) {
        const node = target.nodes[0];
        return node ? { x: node.x, y: node.y } : null;
    }
    if (target instanceof Node) return { x: target.x, y: target.y };
    if (typeof target === 'object' && Number.isFinite(target.x) && Number.isFinite(target.y)) {
        return { x: target.x, y: target.y };
    }
    return null;
}

/**
 * Узлы, чей центр не дальше `radius` от точки `(x, y)`.
 *
 * `body_ids` — ответ нативного запроса `engine.queryCircle` (список id тел):
 * узлы с телом проверяются по нему, узлы без тела (спрайты, зоны, свет) —
 * по координатам, иначе они молча выпадали бы из выборки. Без `body_ids`
 * (юнит-тест без движка) по координатам считаются все узлы.
 *
 * Чистая функция: реестр не трогает, к движку не обращается.
 */
export function withinRadius(nodes, x, y, radius, body_ids) {
    const r = Number(radius);
    if (!(r > 0)) return [];
    const r2 = r * r;
    const native = body_ids ? new Set(body_ids) : null;
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (native && node.body >= 0) {
            if (native.has(node.body)) out.push(node);
            continue;
        }
        const dx = node.x - x;
        const dy = node.y - y;
        if (dx * dx + dy * dy <= r2) out.push(node);
    }
    return out;
}

export class Wrapper {
    constructor(nodes) {
        this.nodes = nodes || [];
        this.length = this.nodes.length;
        // A1: присваивание неизвестного свойства обёртке не должно молча
        // исчезать. Игровые модули — строгий режим, поэтому запись нового
        // свойства в нерасширяемый объект бросает TypeError с именем свойства и
        // строкой кода: `$('#r').foo = 1` больше не создаёт мёртвое JS-поле
        // (раньше так же молча терялся `node.x = 500` — docs/EXTERNAL_FEEDBACK.md, A1).
        // Поля `.x/.y/.w/.h` — аксессоры прототипа (ниже), их это не касается.
        Object.preventExtensions(this);
    }

    [Symbol.iterator]() { return this.nodes[Symbol.iterator](); }
    get(i) { return this.nodes[i]; }

    /**
     * Обход коллекции: колбэк получает `(i, обёртка)`. Живёт в ядре, а не в
     * api.js: модули (слои, частицы, виджеты) зовут его из своих методов, а
     * api.js в юнит-тесте qjs не поднимается.
     */
    each(fn) {
        const nodes = this.nodes;
        for (let i = 0; i < nodes.length; i++) fn.call(this, i, wrapOne(nodes[i]));
        return this;
    }

    /**
     * Обход без обёртки: колбэк получает сам узел — `(i, node)`. Цепочные
     * методы ядра ходят этим путём: две аллокации на узел (обёртка и её
     * массив) в горячем цикле не нужны (docs/HIGH_LEVEL_API_PERF.md §3.5).
     */
    eachNode(fn) {
        const nodes = this.nodes;
        for (let i = 0; i < nodes.length; i++) fn.call(this, i, nodes[i]);
        return this;
    }
    toArray() { return this.nodes.slice(); }
    index() {
        const first = this.nodes[0];
        return first ? ctx.nodes.indexOf(first) : -1;
    }
    eq(i) { return new Wrapper(this.nodes[i] === undefined ? [] : [this.nodes[i]]); }

    /**
     * Узлы выборки в радиусе от цели: `$('.enemy').within('#hero', 500)`.
     *
     * Цель — селектор, узел, обёртка или точка `{ x, y }`; радиус — пиксели.
     * Расстояние считается по ЦЕНТРУ узла. Для узлов с телом кандидатов даёт
     * нативный запрос `engine.queryCircle` (broadphase Box2D): полного перебора
     * узлов в JS не нужно, а для сотен врагов это и есть горячий путь. Узлы без
     * тела проверяются по координатам — иначе спрайты и зоны выпадали бы.
     *
     * Результат сохраняет порядок выборки (порядок реестра) — на него можно
     * положиться в тестах и реплеях.
     */
    within(target, radius) {
        const point = targetPoint(target);
        const r = Number(radius);
        if (!point || !(r > 0)) return new Wrapper([]);

        const eng = engineOf();
        let body_ids = null;
        if (eng && typeof eng.queryCircle === 'function') {
            body_ids = eng.queryCircle(point.x, point.y, r, 0);
        }
        return new Wrapper(withinRadius(this.nodes, point.x, point.y, r, body_ids));
    }
}

let wrapper_proto_ready = false;

/** Объявляет метод обёртки: он применяется к каждому узлу и возвращает this. */
export function def(name, fn) {
    Wrapper.prototype[name] = fn;
}

// ---------------------------------------------------------------------------
// A1. Поля узла на обёртке: `.x`, `.y`, `.w`, `.h`
//
// `$('#r').x` давало `undefined`, а `$('#r').x = 500` молча вешало на обёртку
// обычное JS-свойство и узел не двигало (docs/EXTERNAL_FEEDBACK.md, A1). На
// этом же потерялся пример самого движка: game/level.js сравнивал `hero.x` со
// `spike.x` (оба `undefined` — отбрасывание всегда в одну сторону) и «поправлял»
// позицию платформы через `node.x = …`, то есть не поправлял вовсе.
//
// Аксессоры тонкие, без второго источника правды: чтение — через Node.get()
// (тот же разбор имён, что у `.attr()`), запись — через setWorldPosition() и
// syncBodySize(), то есть ровно тем же путём, что `.at()` и `.size()`. Запись
// действует на ВСЮ выборку (как `.at(0, 0)`), а не на первый узел.
//
// `.angle`, `.scale`, `.width`, `.height` аксессорами НЕ сделаны намеренно: это
// методы прототипа (`.angle(rad)`, `.scale(sx, sy)`, …), и свойство с тем же
// именем их бы затёрло. Читаются они как и раньше — `.rotation()`, `.size()`.
// ---------------------------------------------------------------------------

//: О нечисловой записи сообщаем один раз на имя поля, а не каждый кадр.
const field_warned = new Set();

/**
 * Число из значения или null. Принимаются конечные числа и строки с числом
 * («80» из поля ввода — да), а `NaN`, `±Infinity`, `null`, `undefined`,
 * булевы, пустая строка и объекты — нет: `Number(null)` равен нулю, и без этой
 * строгости `wrapper.x = null` молча переносил бы узел в начало координат.
 */
function fieldNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const v = Number(value);
        return Number.isFinite(v) ? v : null;
    }
    return null;
}

function warnBadField(name, value) {
    if (field_warned.has(name)) return;
    field_warned.add(name);
    ctx.log(`$: .${name} = ${String(value)} — не число; поле узла не изменено`);
}

function defineWrapperField(name, apply) {
    Object.defineProperty(Wrapper.prototype, name, {
        get() {
            const node = this.nodes[0];
            if (!node) return 0;                       // пустая выборка — как .pos()
            const v = fieldNumber(node.get(name));
            return v === null ? 0 : v;
        },
        set(value) {
            const v = fieldNumber(value);
            if (v === null) { warnBadField(name, value); return; }
            this.eachNode((_, node) => apply(node, v));
        },
        enumerable: false,
        configurable: true,
    });
}

defineWrapperField('x', (node, v) => setWorldPosition(node, v, node.y));
defineWrapperField('y', (node, v) => setWorldPosition(node, node.x, v));
defineWrapperField('w', (node, v) => {
    node.w = v; node.size_locked = true;
    if (node.body >= 0) node.syncBodySize();
});
defineWrapperField('h', (node, v) => {
    node.h = v; node.size_locked = true;
    if (node.body >= 0) node.syncBodySize();
});

/** Метод-геттер первого узла (или значение по умолчанию). */
export function defGet(name, fn, defValue) {
    Wrapper.prototype[name] = function (...args) {
        const node = this.nodes[0];
        if (!node) return defValue;
        return fn.call(this, node, ...args);
    };
}

export function wrap(nodes) { return new Wrapper(Array.isArray(nodes) ? nodes.slice() : Array.from(nodes)); }

/**
 * Обёртка одного узла.
 *
 * Кэшировать её в самом узле нельзя: поле `_wrapper` замыкает цикл
 * «узел → обёртка → узел», и JSON.stringify узла (агент, $.store, отладка)
 * падает с «circular reference». Кэш в Map/WeakMap экономит всего ~0,1 мкс из
 * 0,8 (замер в QuickJS), поэтому горячие циклы ядра ходят через
 * `eachNode()` и не создают обёртку вовсе.
 */
/**
 * Выдать узлу НОВЫЙ uid — то есть поставить его «последним» в порядке отрисовки
 * при равной глубине (полный ключ сортировки: `layer` → `depth` → `uid`,
 * см. docs/highlevel/render.md §4.5).
 *
 * Зачем отдельная функция: узел, живущий между выдачами (пул), сохранял uid
 * ПЕРВОГО создания, поэтому свежая выдача вставала НИЖЕ ранее выданных, а
 * порядок зависел от того, освободился ли узел к этому моменту — между
 * прогонами он не воспроизводился (BASHNYA, пункт I10).
 */
export function refreshUid(node) {
    if (!node) return 0;
    node.uid = next_uid++;
    return node.uid;
}

export function wrapOne(node) {
    return new Wrapper([node]);
}

function makeEvent(node, name, data) {
    const self = wrapOne(node);
    // §13 Спецификации: событие production-сценария несёт устойчивые ID, по
    // которым его находит трассировка и диагностика. `self`/`source`/`target`
    // остаются обёртками (совместимость), а рядом лежат логические ID:
    //   nid       — узел-получатель;
    //   source_id — источник события из data (у контактов это участник пары);
    //   target_id — адресат из data.
    // Поля берутся из data только если это строка: произвольный payload игры
    // не должен подменять идентичность события.
    const payload = data === undefined ? null : data;
    const source_id = payload && typeof payload.source === 'string' ? payload.source : node.nid;
    const target_id = payload && typeof payload.target === 'string' ? payload.target : node.nid;
    return {
        self,
        target: self,
        source: self,
        nid: node.nid,
        source_id,
        target_id,
        name,
        data: payload === null ? {} : payload,
        type: name,
        dt: ctx.time ? ctx.time.delta() : 1 / 60,
        frame: engine.frame,
        stopped: false,
        stop() { this.stopped = true; },
        preventDefault() { this.defaultPrevented = true; },
    };
}

// ---------------------------------------------------------------------------
// Селекторы
// ---------------------------------------------------------------------------

const custom_selectors = new Map();

export function registerSelector(name, fn) {
    custom_selectors.set(name, fn);
    // Разобранные селекторы держат ссылку на пользовательский псевдокласс,
    // поэтому новый регистр сбрасывает кэш (см. compileSelector).
    selector_cache.clear();
}

// --- Компилятор селекторов -------------------------------------------------
//
// Раньше строка селектора разбиралась ЗАНОВО на каждом узле: до пяти regexp
// (exec/replace/split) и столько же временных строк и массивов на узел. При
// 1000 узлах один $('.mob') стоил 15,4 мс (docs/HIGH_LEVEL_API_PERF.md §3.2).
// Теперь строка разбирается один раз на вызов, а по узлам идёт замыкание.

const ATTR_EXTRACT = /\[([a-zA-Z_][\w.]*)\s*(<=|>=|!=|=|<|>)\s*([^\]]+)\]/;
const PSEUDO_EXTRACT = /:([a-zA-Z][\w]*)(\(([^)]*)\))?/;
const ATTR_STRIP = /\[[^\]]*\]/g;
const PSEUDO_STRIP = /:[a-zA-Z][\w]*(\([^)]*\))?/g;
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Кэш «строка селектора → предикат». Ограничен: сцены редко имеют >512 видов. */
const selector_cache = new Map();
const SELECTOR_CACHE_MAX = 512;

const alwaysTrue = () => true;
const notRemoved = (node) => !node.removed;

/** Собрать предикат из списка проверок: пустой список — «подходит всем». */
function allOf(checks) {
    if (checks.length === 0) return alwaysTrue;
    if (checks.length === 1) return checks[0];
    return (node) => {
        for (let i = 0; i < checks.length; i++) if (!checks[i](node)) return false;
        return true;
    };
}

/** Предикат по строке селектора — один терм (без запятых и комбинаторов). */
export function compileSelector(sel) {
    // '*' и пустой селектор тоже не должны находить удалённые узлы (см. buildSelector).
    if (!sel || sel === '*') return notRemoved;
    const cached = selector_cache.get(sel);
    if (cached !== undefined) return cached;
    const compiled = buildSelector(sel.trim());
    if (selector_cache.size >= SELECTOR_CACHE_MAX) selector_cache.clear();
    selector_cache.set(sel, compiled);
    return compiled;
}

function buildSelector(sel) {
    // Удалённый узел не должен находиться селектором: вне пакета его в реестре
    // уже нет, а внутри $.batch он лежит там до уборки.
    const checks = [(node) => !node.removed];

    // Комбинирование через запятую живёт в query(), здесь — один терм.
    // Атрибутные условия: [hp<20], [team=1], [speed>100].
    const attrMatch = ATTR_EXTRACT.exec(sel);
    if (attrMatch) {
        const key = attrMatch[1];
        const op = attrMatch[2];
        const rawValue = attrMatch[3];
        const wanted = NUMERIC.test(rawValue) ? parseFloat(rawValue)
                                              : rawValue.replace(/^['"]|['"]$/g, '');
        switch (op) {
        case '=':  checks.push((node) => readAttr(node, key) == wanted); break;
        case '!=': checks.push((node) => readAttr(node, key) != wanted); break;
        case '<':  checks.push((node) => readAttr(node, key) < wanted); break;
        case '>':  checks.push((node) => readAttr(node, key) > wanted); break;
        case '<=': checks.push((node) => readAttr(node, key) <= wanted); break;
        case '>=': checks.push((node) => readAttr(node, key) >= wanted); break;
        }
    }

    // Псевдоклассы — как и раньше, учитывается первый.
    const pseudo = PSEUDO_EXTRACT.exec(sel);
    if (pseudo) checks.push(pseudoCheck(pseudo[1], pseudo[3]));

    const cleaned = sel.replace(ATTR_STRIP, '').replace(PSEUDO_STRIP, '');
    if (!cleaned) return allOf(checks);

    for (const part of cleaned.split(/(?=[.#])/)) {
        if (!part) continue;
        if (part[0] === '#') {
            const id = part.slice(1);
            // node.id — дешёвая отсечка перед Map: id есть у единиц узлов.
            checks.push((node) => node.id === id && ctx.byId.get(id) === node);
        } else if (part[0] === '.') {
            const cls = part.slice(1);
            checks.push((node) => node.classes.has(cls));
        } else {
            const tag = part.split('.').filter((s) => s && s[0] !== '.');
            if (tag.length) {
                const name = tag[0];
                checks.push((node) => node.tag === name);
            }
            for (const cls of part.split('.').slice(1)) {
                if (cls) checks.push((node) => node.classes.has(cls));
            }
        }
    }
    return allOf(checks);
}

function pseudoCheck(pname, parg) {
    switch (pname) {
    case 'alive':     return (node) => node.cur_hp > 0 && !node.removed;
    case 'dead':      return (node) => node.cur_hp <= 0 || node.removed;
    case 'visible':   return (node) => !!node.visible;
    case 'hidden':    return (node) => !node.visible;
    case 'onScreen':  return (node) => !!(ctx.camera && ctx.camera.isOnScreen(node));
    case 'offScreen': return (node) => !(ctx.camera && ctx.camera.isOnScreen(node));
    case 'paused':    return () => !!(ctx.time && ctx.time.isPaused());
    case 'picked':    return (node) => !!node.hovered;
    case 'first':     return (node) => ctx.nodes.indexOf(node) === 0;
    case 'last':      return (node) => ctx.nodes.indexOf(node) === ctx.nodes.length - 1;
    case 'even':      return (node) => ctx.nodes.indexOf(node) % 2 === 0;
    case 'odd':       return (node) => ctx.nodes.indexOf(node) % 2 !== 0;
    case 'eq': {
        const want = parseInt(parg, 10);
        return (node) => ctx.nodes.indexOf(node) === want;
    }
    case 'has': {
        const inner = compileSelector(parg);
        return (node) => node.child_nodes.some(inner);
    }
    case 'parent':    return (node) => node.child_nodes.length !== 0;
    case 'empty':     return (node) => node.child_nodes.length === 0;
    case 'not': {
        const inner = compileSelector(parg);
        return (node) => !inner(node);
    }
    default: {
        const custom = custom_selectors.get(':' + pname);
        if (!custom) return alwaysTrue;
        return (node) => !custom(node, parg) ? false : true;
    }
    }
}

/** Совместимость: проверить один узел одним термом селектора. */
function matchesSelector(node, sel) {
    if (typeof sel !== 'string') return !sel;
    return compileSelector(sel)(node);
}

function readAttr(node, key) {
    if (key in node) return node[key];
    if (key === 'hp') return node.cur_hp;
    if (key === 'maxhp') return node.max_hp;
    if (key === 'class') return [...node.classes].join(' ');
    const parts = key.split('.');
    let value = node.attrs[parts[0]];
    for (let i = 1; i < parts.length && value != null; i++) value = value[parts[i]];
    return value === undefined ? null : value;
}

/** Полный разбор селектора: запятые, вложенность (' ', '>'). */
export function query(sel) {
    if (sel === null || sel === undefined) return [];
    if (typeof sel !== 'string') return [];
    if (sel === '*') return liveNodes().slice();

    // Быстрый путь: '#hero' — один id, без запятых, комбинаторов и условий.
    // Раньше и он перебирал весь реестр: 14,2 мс на 1000 узлов (§3.2 отчёта).
    const id = plainId(sel);
    if (id !== null) {
        const node = ctx.byId.get(id);
        return node && !node.removed ? [node] : [];
    }

    // Одна структурная ветка ('.mob', 'enemy', 'enemy.mob') — готовая выборка
    // из индекса: ни предиката, ни прохода по реестру (P2, §5 отчёта).
    // Возвращаем копию: вызывающий вправе менять полученный массив.
    if (sel.indexOf(',') < 0) {
        const whole = structuralSelect(sel.trim());
        if (whole !== null) return whole.slice();
    }

    const branches = sel.split(',');
    const result = [];
    // Уникализация нужна только при нескольких ветках: одна ветка дублей не
    // даёт, а Set — это аллокация на каждый вызов.
    const seen = branches.length > 1 ? new Set() : null;
    for (const branch of branches) {
        const trimmed = branch.trim();
        if (!trimmed) continue;
        for (const node of querySingle(trimmed)) {
            if (seen === null) { result.push(node); continue; }
            if (!seen.has(node)) { seen.add(node); result.push(node); }
        }
    }
    return result;
}

/**
 * '  #hero  ' → 'hero'; всё остальное (комбинаторы, условия, несколько термов)
 * → null. Разделители — те же, что знает синтаксис селекторов: пробел, '.',
 * ':', '[', ',', '>'.
 */
function plainId(sel) {
    const s = sel.trim();
    if (s.length < 2 || s[0] !== '#') return null;
    for (let i = 1; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 32 || c === 9 || c === 46 || c === 58 || c === 91 || c === 44 || c === 62) return null;
    }
    return s.slice(1);
}

function querySingle(sel) {
    // Разбиваем на «прямой потомок» и «любой потомок»: '#hero .weapon' и
    // '#hero > .weapon'.
    const parts = sel.split(/\s*(>)\s*|\s+/).filter((s) => s !== undefined && s !== '');
    if (parts.length === 1) {
        const match = compileSelector(parts[0]);
        // Якорь — ведущий тег/классы терма: '.mob:alive' проверяется только по
        // узлам класса mob, а не по всему реестру (P2, §5 отчёта).
        const anchor = anchorList(parts[0]);
        return (anchor === null ? ctx.nodes : anchor).filter(match);
    }

    const first = compileSelector(parts[0]);
    const first_anchor = anchorList(parts[0]);
    let current = (first_anchor === null ? ctx.nodes : first_anchor).filter(first);
    let direct = false;
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (part === '>') { direct = true; continue; }
        const match = compileSelector(part);
        const next = [];
        for (const node of current) {
            const pool = direct ? node.child_nodes : descendants(node);
            for (const child of pool) if (match(child)) next.push(child);
        }
        current = next;
        direct = false;
    }
    return current;
}

// ---------------------------------------------------------------------------
// Структурные селекторы: выборка из индекса, без прохода по реестру
// ---------------------------------------------------------------------------
//
// Структурный терм — это тег и/или классы: 'enemy', '.mob', 'enemy.mob'.
// Он не зависит ни от чего, кроме состава реестра и классов, а оба меняют
// версию реестра. Поэтому выборку можно кэшировать на версию — как и делает
// registryIndex().selects. Условия ([hp<5]), псевдоклассы (:alive) и
// комбинаторы в структурный терм не входят: такие селекторы идут обычным
// путём, но по якорю (см. anchorList), то есть без полного прохода.

const STRUCTURAL_RE = /^(?:([a-zA-Z][\w-]*))?((?:\.[\w-]+)*)$/;

/** 'enemy.mob' → { tag: 'enemy', classes: ['mob'] }; не структурный — null. */
function structuralTerms(compound) {
    const m = STRUCTURAL_RE.exec(compound);
    if (m === null) return null;
    const tag = m[1] === undefined ? null : m[1];
    const classes = m[2] === '' ? [] : m[2].slice(1).split('.');
    if (tag === null && classes.length === 0) return null;   // '*' и пустая строка
    return { tag, classes };
}

/** Пересечение двух срезов с сохранением порядка base. */
function intersectLists(base, other) {
    const keep = new Set(other);
    const out = [];
    for (let i = 0; i < base.length; i++) if (keep.has(base[i])) out.push(base[i]);
    return out;
}

/** Выборка по структурным термам: срез индекса или новое пересечение. */
function listForTerms(terms) {
    let list = terms.tag === null ? null : nodesByTag(terms.tag);
    for (let i = 0; i < terms.classes.length; i++) {
        const by_class = nodesByClass(terms.classes[i]);
        list = list === null ? by_class : intersectLists(list, by_class);
    }
    return list === null ? EMPTY_NODES : list;
}

/**
 * Готовая выборка по чисто структурному селектору — или null, если селектор
 * сложнее (условия, псевдоклассы, комбинаторы, несколько веток).
 */
function structuralSelect(sel) {
    const terms = structuralTerms(sel);
    if (terms === null) return null;
    const index = registryIndex();
    let list = index.selects.get(sel);
    if (list === undefined) {
        list = listForTerms(terms);
        index.selects.set(sel, list);
    }
    return list;
}

/**
 * Якорь для сложного терма: ведущие тег/классы до первого условия,
 * псевдокласса или комбинатора. '.mob:alive' → срез класса mob;
 * '[hp<5]' и ':first' → null (якоря нет, нужен полный проход).
 */
function anchorList(compound) {
    const cut = compound.search(/[:[>]/);
    const head = cut < 0 ? compound : compound.slice(0, cut);
    if (head === '' || head === '*') return null;
    const terms = structuralTerms(head);
    if (terms === null) return null;
    return listForTerms(terms);
}

function descendants(node) {
    const out = [];
    const stack = node.child_nodes.slice();
    while (stack.length) {
        const n = stack.pop();
        out.push(n);
        for (const c of n.child_nodes) stack.push(c);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Проверка пересечений и расстояний (используется методами узлов)
// ---------------------------------------------------------------------------

export function halfExtents(node) {
    const w = node.hitbox ? node.hitbox.w : node.w;
    const h = node.hitbox ? node.hitbox.h : node.h;
    return [w / 2, h / 2];
}

export function nodeBounds(node) {
    const [hw, hh] = halfExtents(node);
    const s = Math.abs(node.scale_x);
    const sy = Math.abs(node.scale_y);
    return { x0: node.x - hw * s, y0: node.y - hh * sy, x1: node.x + hw * s, y1: node.y + hh * sy };
}

export function boundsOverlap(a, b) {
    const A = nodeBounds(a), B = nodeBounds(b);
    return A.x0 < B.x1 && A.x1 > B.x0 && A.y0 < B.y1 && A.y1 > B.y0;
}

// ---------------------------------------------------------------------------
// Реестр спрайтов и вспомогательные функции
// ---------------------------------------------------------------------------

const texture_cache = new Map();
const sprite_cache = new Map();
// Размер кадра по id спрайта. Движок умеет отдавать размер текстуры
// (engine.textureSize), но не размер уже созданного спрайта, поэтому кадры
// запоминаются здесь в момент создания — иначе spriteSize() всегда давал бы
// [0,0], и .sprite('hero.png') молча оставлял узел 32×32.
const sprite_sizes = new Map();
let dot_sprite = -1;

/** Запомнить размер созданного кадра и вернуть его id (для цепочек). */
function rememberSprite(id, w, h) {
    if (id >= 0 && w > 0 && h > 0) sprite_sizes.set(id, [w, h]);
    return id;
}

/** Размер текстуры с запасом на отказ загрузки: всегда [w, h], не undefined. */
function textureSizeSafe(tex) {
    const size = tex >= 0 ? engine.textureSize(tex) : null;
    return size ? [Number(size[0]) || 0, Number(size[1]) || 0] : [0, 0];
}

/** Белый спрайт 1×1 из ядра — им рисуются rect/circle/частицы и полосы UI. */
export function dotSprite() {
    if (dot_sprite < 0) dot_sprite = engine.whiteSprite;
    return dot_sprite;
}

export function resolveSprite(value) {
    if (value === null || value === undefined) return -1;
    if (typeof value === 'number') return value;
    if (Array.isArray(value)) {
        const key = 'arr' + value.join(',');
        if (!sprite_cache.has(key)) {
            const tex = value[0];
            // w/h <= 0 означают «весь кадр текстуры» — так же, как в C.
            const full = textureSizeSafe(tex);
            const id = rememberSprite(
                engine.createSprite(tex, value[1], value[2], value[3], value[4]),
                value[3] > 0 ? value[3] : full[0],
                value[4] > 0 ? value[4] : full[1],
            );
            sprite_cache.set(key, id);
        }
        return sprite_cache.get(key);
    }
    if (typeof value === 'string') {
        if (sprite_cache.has('path:' + value)) return sprite_cache.get('path:' + value);
        const tex = engine.loadTexture(value);
        if (tex < 0) {
            ctx.log(`$: не удалось загрузить "${value}"`);
            sprite_cache.set('path:' + value, -1);
            return -1;
        }
        const size = textureSizeSafe(tex);
        const id = rememberSprite(engine.createSprite(tex, 0, 0, 0, 0), size[0], size[1]);
        sprite_cache.set('path:' + value, id);
        return id;
    }
    if (typeof value === 'object' && value.src) {
        return resolveSheet(value);
    }
    return -1;
}

/**
 * Лист-объект: { src, cols, rows, cw, ch } → массив кадров.
 * Возвращает спрайт первого кадра, а массив кладёт в sprite_cache по ключу.
 */
export function resolveSheet(spec) {
    const key = `sheet:${spec.src}|${spec.cols}x${spec.rows}|${spec.cw}x${spec.ch}`;
    if (sprite_cache.has(key)) return sprite_cache.get(key)[0];
    const tex = engine.loadTexture(spec.src);
    if (tex < 0) { ctx.log(`$: не удалось загрузить лист "${spec.src}"`); return -1; }
    const frames = [];
    for (let r = 0; r < spec.rows; r++) {
        for (let c = 0; c < spec.cols; c++) {
            frames.push(rememberSprite(
                engine.createSprite(tex, c * spec.cw, r * spec.ch, spec.cw, spec.ch),
                spec.cw, spec.ch));
        }
    }
    sprite_cache.set(key, frames);
    sprite_cache.set('path:' + spec.src, frames[0]);
    return frames[0];
}

export function sheetFrames(spec) {
    const key = `sheet:${spec.src}|${spec.cols}x${spec.rows}|${spec.cw}x${spec.ch}`;
    return sprite_cache.get(key) || null;
}

/** Размер кадра спрайта: [w, h] или [0, 0], если он неизвестен. */
export function spriteSize(id) {
    if (id < 0) return [0, 0];
    const size = sprite_sizes.get(id);
    return size ? [size[0], size[1]] : [0, 0];
}

/**
 * Забыть кэши текстуры и её спрайтов.
 *
 * Нужно после выгрузки: в C слот возвращается движку и будет использован
 * следующей загрузкой, а у нас остались бы старые id — `loadTexture` вернул бы
 * чужую текстуру, а `.sprite()` — мёртвый спрайт.
 */
export function forgetTexture(path) {
    const key = String(path);
    texture_cache.delete(key);
    for (const cache_key of [...sprite_cache.keys()]) {
        if (cache_key === 'path:' + key || cache_key.startsWith(`region:${key}|`)
            || cache_key.startsWith(`sheet:${key}|`)) {
            sprite_cache.delete(cache_key);
        }
    }
}

export function textureSizeOf(path) {
    const tex = texture_cache.get(path) || engine.loadTexture(path);
    texture_cache.set(path, tex);
    return engine.textureSize(tex);
}

/**
 * Спрайт области текстуры с кэшем: `regionSprite('sheet.png', 16, 0, 16, 16)`.
 *
 * Нужен `.region()`: раньше он звал `engine.createSprite` на каждый вызов, а
 * таблица спрайтов в C не чистится — вызов в кадре (анимация, скролл) рос бы
 * без предела. Ключ включает путь и прямоугольник, поэтому повторные вызовы с
 * теми же аргументами возвращают тот же спрайт.
 */
export function regionSprite(path, x, y, w, h) {
    const key = `region:${path}|${x},${y},${w},${h}`;
    const cached = sprite_cache.get(key);
    if (cached !== undefined) return cached;

    const tex = engine.loadTexture(path);
    if (tex < 0) {
        sprite_cache.set(key, -1);
        return -1;
    }
    const id = rememberSprite(engine.createSprite(tex, x, y, w, h), w, h);
    sprite_cache.set(key, id);
    return id;
}

// Отдельный генератор для визуальных эффектов (тряска кадра, узлов, тайлов).
// Он не трогает игровой поток $.random, но делает картинку воспроизводимой:
// при --seed и --fixed-dt прогон даёт одинаковые кадры, а Math.random() этого
// не обещал.
//
// Зерно берётся из сессии: с постоянной константой дрожание картинки было
// побитово одинаковым в каждом запуске, и «разный --seed — разный прогон»
// переставало быть правдой для косметики. База — seed движка, если он известен.
const fx_random = makeRandom(0x2d5eed);

/**
 * Поставить зерно генератору эффектов из зерна сессии.
 *
 * Вызывается при установке подсистем (когда `engine.seed` уже известен):
 * с постоянной константой дрожание картинки было побитово одинаковым в каждом
 * запуске, и «разный --seed — разный прогон» переставало быть правдой для
 * косметики. Гарантия §11 при этом не страдает: отдельный генератор по-прежнему
 * не трогает ни $.random, ни поток generation.
 */
export function fxReseed(seed) {
    const value = Number(seed);
    fx_random.seed(Number.isFinite(value) ? ((value >>> 0) ^ 0x2d5eed) >>> 0 : 0x2d5eed);
    return fx_random;
}

/** Случайное число 0..1 для эффектов — детерминировано при фиксированном шаге. */
export function fxRandom() { return fx_random.next(); }

/** Случайная последовательность с зерном — для $.random и тестов. */
export function makeRandom(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return {
        seed(value) { s = (value >>> 0) || 0x9e3779b9; return this; },
        next() {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
        range(a, b) { return a + this.next() * (b - a); },
        int(a, b) { return Math.floor(this.range(a, b + 1)); },
        pick(list) { return list[this.int(0, list.length - 1)]; },
        chance(p) { return this.next() < p; },
    };
}

export { wrapper_proto_ready };
