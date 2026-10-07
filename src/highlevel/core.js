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
        if (typeof engine !== 'undefined' && engine && typeof engine.log === 'function') {
            engine.log(msg);
        } else if (typeof console !== 'undefined' && console && typeof console.log === 'function') {
            console.log(msg);
        }
    },
};

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
    const i = ctx.nodes.indexOf(node);
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
    if (Array.isArray(value)) {
        const a = value.length > 3 ? Math.round(value[3] * 255) : 255;
        return engine.rgba(value[0] | 0, value[1] | 0, value[2] | 0, a);
    }
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

// Псевдонимы событий: в документации контакт исторически называли 'collision'
// (и так же писали в примерах про пул пуль), а движок шлёт 'collide'. Приводим
// оба имени к каноническому в on/off/emit — иначе канонический пример
// «пуля вернулась в пул» молча не срабатывает.
const EVENT_ALIASES = {
    collision: 'collide',
    contact: 'collide',
    separation: 'separate',
};

/** Каноническое имя события (или исходное, если псевдонима нет). */
export function eventName(name) {
    if (typeof name !== 'string') return name;
    return EVENT_ALIASES[name.toLowerCase()] || name;
}

export class Node {
    constructor(tag, attrs) {
        const defaults = TAGS[tag] || {};
        this.uid = next_uid++;
        this.tag = tag;
        this.attrs = {};                 // всё, что не описано ниже
        this.classes = new Set();
        this.tags_extra = null;   // ленивый Set: см. addTag/removeTag

        // Узлы интерфейса живут в координатах окна: камера на них не влияет,
        // и в игровой мир они не попадают. Признак хранится в attrs, потому
        // что именно там его ищут отрисовка, снимок для агента и подсчёт узлов.
        if (defaults.ui) this.attrs.ui = true;

        this.x = 0;
        this.y = 0;
        this.w = defaults.w !== undefined ? defaults.w : 32;
        this.h = defaults.h !== undefined ? defaults.h : 32;
        this.r = defaults.r;
        this.angle = 0;
        this.scale_x = 1;
        this.scale_y = 1;
        this.alpha = 1;
        this.color = packColor(defaults.color);
        this.hover_color = defaults.hoverColor ? packColor(defaults.hoverColor) : null;
        this.text_color = defaults.textColor ? packColor(defaults.textColor) : engine.WHITE;
        this.fill_color = defaults.fillColor ? packColor(defaults.fillColor) : engine.rgba(80, 200, 100, 255);
        this.visible = true;
        this.layer = defaults.ui ? 1000 : 0;
        this.depth = 0;
        this.z = 0;                       // алиас depth, используется .depth()

        this.sprite = -1;
        this.default_sprite = dotSprite();
        this.anim = null;                 // текущая спрайт-анимация
        this.frames = null;               // массив кадров
        this.frame_index = 0;

        // Физика
        this.body_kind = defaults.body || null;   // 'static' | 'dynamic' | 'kinematic'
        this.body = -1;
        this.gravity_on = defaults.gravity !== false;
        // CCD: быстрое тело (пуля) проверяется непрерывно — иначе за шаг оно
        // проходит десятки пикселей и проскакивает тонкие стены.
        this.bullet_on = defaults.bullet === true;
        this.hitbox = null;               // {w, h} — если задан явно
        this.circle_hitbox = 0;
        // Форма тела: 'box' (по умолчанию) | 'circle' | 'capsule' | 'polygon'.
        // У <circle> форма задана тегом; остальные включают её явно.
        this.shape_kind = defaults.shape || null;
        this.poly_points = null;          // для 'polygon': плоский массив x,y
        // Односторонняя платформа: тело проходит сквозь снизу и встаёт сверху.
        this.one_way = false;
        this.one_way_angle = -Math.PI / 2;   // куда смотрит лицевая сторона
        this.sensor = !!defaults.sensor;     // зона без отталкивания
        // События контакта (collide/separate/hit). По умолчанию включены
        // динамическим телам: именно они во что-то врезаются. Явный вызов
        // .contacts(true/false) перебивает автоматику — для этого и храним
        // режим отдельно от текущего значения.
        this.contacts_mode = defaults.contacts !== undefined ? !!defaults.contacts : null;
        this.contacts_enabled = false;
        // Слои и маски коллизий (b2Filter). layer_bits — «в каком слое лежит
        // тело», collision_mask — «с какими слоями сталкивается». Умолчания
        // повторяют прежнее поведение движка: слой 1, сталкивается со всеми.
        // Маски 32-битные: побитовые операторы JS всё равно 32-битные.
        this.layer_bits = defaults.layerBits !== undefined ? defaults.layerBits >>> 0 : 0x1;
        this.collision_mask = defaults.mask !== undefined ? defaults.mask >>> 0 : 0xffffffff;
        this.collision_group = defaults.group !== undefined ? defaults.group | 0 : 0;
        this.velocity_cache = { x: 0, y: 0 };

        // Здоровье
        this.max_hp = defaults.hp || 0;
        this.cur_hp = this.max_hp;
        // Прошлый кадр для автособытий мира (hit/heal/death/show/hide). Поля
        // самого узла, а не Map по uid: числовой ключ в QuickJS стоит ~6 мкс,
        // и эти четыре операции съедали половину кадра (см.
        // docs/HIGH_LEVEL_API_PERF.md §3.1). undefined = «узел ещё не виден».
        this._hp_seen = undefined;
        this._vis_seen = undefined;
        // Скорость из TAGS: без этого умолчания тегов (enemy 90, npc 70) не
        // доходили ни до .controls(), ни до .attr('speed') — враг с
        // управлением ехал 150, хотя справочник обещал 90.
        this.speed = defaults.speed !== undefined ? defaults.speed : 0;
        this.team = defaults.team !== undefined ? defaults.team : 0;
        this.iframes = 0;

        // Визуальные состояния
        this.tint = null;                 // временный цвет (.flash)
        this.tint_timer = 0;
        this.shake_timer = 0;
        this.shake_amount = 0;

        // Иерархия
        this.parent_node = null;
        this.child_nodes = [];
        this.removed = false;
        this.detached = false;
        // Узел лежит в ctx.nodes. Флаг нужен там, где раньше был
        // ctx.nodes.indexOf(node) — это O(N) на проверку (§3.3 отчёта).
        this.in_registry = false;

        // События. Контейнеры ленивые: пустые Map/Set — это malloc на каждый
        // узел, а подписки и data() есть у единиц узлов (§3.5, пункт 13).
        this.listeners = null;
        this.data_store = null;
        // Узел помечен на удаление внутри $.batch (см. dropFromRegistry).
        this._drop_queued = false;

        // Интерфейс
        this.hovered = false;
        this.pressed = false;
        this.value = defaults.value !== undefined ? defaults.value : 0;
        this.max_value = defaults.max !== undefined ? defaults.max : 1;

        this.tile_src = null;
        this.text = defaults.text !== undefined ? defaults.text : '';
        this.size = defaults.size !== undefined ? defaults.size : 20;
        this.radius = defaults.radius !== undefined ? defaults.radius : 200;
        this.intensity = defaults.intensity !== undefined ? defaults.intensity : 1;

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
            if (key === 'parent') { this.appendTo(value); continue; }
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
        case 'w': case 'width':  this.w = Number(value); return this;
        case 'h': case 'height': this.h = Number(value); return this;
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

    moveToX(x) {
        if (this.body >= 0) {
            const t = engine.getTransforms();
            const y = t[this.body * 3 + 1];
            const a = t[this.body * 3 + 2];
            engine.setPosition(this.body, x, y, a);
        }
        this.x = x;
        return this;
    }

    moveToY(y) {
        if (this.body >= 0) {
            const t = engine.getTransforms();
            const x = t[this.body * 3];
            const a = t[this.body * 3 + 2];
            engine.setPosition(this.body, x, y, a);
        }
        this.y = y;
        return this;
    }

    setSprite(value) {
        if (value === null || value === undefined) { this.sprite = this.default_sprite; return; }
        this.sprite = resolveSprite(value);
        const [w, h] = spriteSize(this.sprite);
        if (w > 0 && (this.w === 32 || this.w === 0)) { this.w = w; this.h = h; }
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
        this.body_kind = kind;
        if (this.body < 0) {
            ctx.log(`$: не удалось создать тело для <${this.tag}>`);
            return;
        }

        ctx.byBody.set(this.body, this);
        // Узел вошёл в срез body индекса реестра: кадровый синк физики ходит
        // только по нему, а не по всему миру (§5, P2 отчёта).
        touchRegistry();

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
        const list = String(name).split(/\s+/).filter(Boolean);
        let changed = false;
        for (const c of list) if (!this.classes.has(c)) { this.classes.add(c); changed = true; }
        // Классы читают селекторы и зоны (isZoneNode): сводки подсистем
        // должны узнать об изменении.
        if (changed) touchRegistry();
        return this;
    }
    removeClass(name) {
        const list = String(name).split(/\s+/).filter(Boolean);
        let changed = false;
        for (const c of list) if (this.classes.delete(c)) changed = true;
        if (changed) touchRegistry();
        return this;
    }
    toggleClass(name, force) {
        const has = this.classes.has(name);
        const want = force === undefined ? !has : !!force;
        if (want) this.classes.add(name); else this.classes.delete(name);
        if (want !== has) touchRegistry();
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

// ---------------------------------------------------------------------------
// Обёртка-коллекция (то, что возвращает $)
// ---------------------------------------------------------------------------

export class Wrapper {
    constructor(nodes) {
        this.nodes = nodes || [];
        this.length = this.nodes.length;
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
}

let wrapper_proto_ready = false;

/** Объявляет метод обёртки: он применяется к каждому узлу и возвращает this. */
export function def(name, fn) {
    Wrapper.prototype[name] = fn;
}

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
export function wrapOne(node) {
    return new Wrapper([node]);
}

function makeEvent(node, name, data) {
    const self = wrapOne(node);
    return {
        self,
        target: self,
        source: self,
        name,
        data: data === undefined ? {} : data,
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
const fx_random = makeRandom(0x2d5eed);

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
