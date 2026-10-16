// ===========================================================================
// Канвас-слои, параллакс и полноэкранные оттенки: $.layers.
//
// Подсистема даёт три вещи, которых не было в ядре:
//   * <layer> — узел-контейнер (аналог CanvasLayer): его дети рисуются
//     подряд и упорядочены относительно других слоёв. Порядок задаётся
//     существующим полем node.layer, поэтому render.js править не нужно:
//     при добавлении ребёнка в слой мы проставляем ему node.layer, а при
//     смене порядка — обновляем всё поддерево;
//   * параллакс — узел с коэффициентом f получает
//     x = anchor_x + cam.x * (1 - f) (0 — приколот к экрану, 1 — как мир);
//   * modulate и fade — полноэкранный оттенок через общий батч
//     $.gfx.push.sprite (engine.whiteSprite).
//
// Чего здесь СОЗНАТЕЛЬНО НЕТ (и почему — см. docs/highlevel/layers.md):
//   * пользовательских шейдеров — конвейер движка один, .shader() в ядре
//     лишь предупреждает;
//   * режимов смешивания (multiply/add) — их у движка нет, поэтому modulate
//     честно работает как альфа-наложение поверх сцены, а не как умножение;
//   * отдельного рендер-таргета на слой — слой не рисуется в текстуру, а
//     полноэкранный оттенок накрывает всё, что нарисовано до него.
//
// Контракт модуля: installLayers($) и tickLayers(dt).
// Чистые функции parallaxOffset() и layerSortKey() экспортируются наружу —
// их гоняет qjs-харнесс без движка.
// ===========================================================================

import { engine } from './native.js';
import { ctx, Node, TAGS, wrap, wrapOne, query, def,
         packColor, withAlpha, facetCount, nodesByTag, nodesWithFacet,
         touchRegistry } from './core.js';
import { registerNodeRenderer } from './render.js';
import { cameraTransform } from './camera.js';

// Порядок слоя по умолчанию: чуть выше обычных узлов мира (у них layer = 0),
// как CanvasLayer c layer = 1 в Godot. Меняется опцией order.
const DEFAULT_ORDER = 1;
// Служебная глубина узла-контейнера: слой рисует свой modulate после детей
// (сортировка идёт по layer, затем по depth), а сам спрайт не выводит.
const LAYER_DEPTH = 1000000;
// Слой глобального оттенка/затемнения: поверх мира, но под интерфейсом
// (узлы <ui.*> рисуются отдельным проходом после всех узлов мира).
const OVERLAY_ORDER = 9000;
const OVERLAY_NAME = '@overlay';
// Насколько узел должен разойтись с прошлым кадром, чтобы считать движение
// «игровым» и перезакрепить якорь параллакса.
const PARALLAX_EPS = 1e-4;

// Имя слоя → узел. Нужен для $.layers.get/has/order/show/...
const registry = new Map();
// Узел → { ax, ay, last_x, last_y }: якорь и то, что мы выставили в прошлый
// кадр. Сравнивать позицию нужно именно с прошлым значением модуля, а не с
// новым ожидаемым: после движения камеры они заведомо разные, и узел
// перезакреплялся бы каждый кадр, то есть параллакс бы не работал.
const parallax_state = new WeakMap();

// Состояние перехода-затемнения. Цвет ленивый: packColor() трогает engine,
// а на верхнем уровне модуля этого делать нельзя.
const fade = {
    color: null,
    alpha: 0,
    from: 0,
    to: 0,
    ms: 0,
    t: 0,
    resolve: null,
};

let overlay_node = null;
let body_warned = false;
let patched = false;

// ---------------------------------------------------------------------------
// Чистые функции (тестируются qjs без движка)
// ---------------------------------------------------------------------------

/**
 * Смещение узла с параллаксом: anchor_x + cam * (1 - f).
 *
 *   f = 0   — узел приколот к экрану (уезжает вместе с камерой);
 *   f = 1   — обычная мировая координата (камера на узел не влияет);
 *   f = 0.5 — движется вдвое медленнее мира.
 */
export function parallaxOffset(anchor, camValue, factor) {
    const a = Number.isFinite(anchor) ? anchor : 0;
    const c = Number.isFinite(camValue) ? camValue : 0;
    const f = Number.isFinite(factor) ? factor : 0;
    return a + c * (1 - f);
}

/**
 * Ключ сортировки «слой важнее глубины»: render.js сортирует по layer, затем
 * по depth, поэтому ключ = layer * 1e6 + depth. Годится для |depth| < 500000
 * (у игровых узлов глубина измеряется единицами).
 *
 * Принимает (layer, depth) либо сам узел: layerSortKey(node).
 */
export function layerSortKey(layer, depth) {
    if (layer && typeof layer === 'object') {
        depth = layer.depth;
        layer = layer.layer !== undefined ? layer.layer : layer.order;
    }
    const l = Number.isFinite(layer) ? layer : 0;
    const d = Number.isFinite(depth) ? depth : 0;
    return l * 1e6 + d;
}

function clamp01(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/** Положительное число или запасное значение: шаг полосы не может быть ≤ 0. */
function numOr(value, fallback) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
    const f = Number(fallback);
    return Number.isFinite(f) && f > 0 ? f : 1;
}

function blackPacked() { return packColor('#000000'); }

// ---------------------------------------------------------------------------
// Патч Node: перехватываем поля слоя
//
// Ядро ничего не знает про name/order/parallax/modulate, а applyInitial()
// зовётся в конструкторе всегда — даже когда attrs нет, поэтому именно там
// удобно доинициализировать узел-слой (в том числе порядок по умолчанию).
// ---------------------------------------------------------------------------

const LAYER_KEYS = new Set(['name', 'order', 'layer', 'parallax', 'modulate']);

function patchNode() {
    if (patched) return;
    patched = true;
    const proto = Node.prototype;

    const original_set = proto.set;
    proto.set = function (key, value) {
        if (this.tag === 'layer' && LAYER_KEYS.has(key)) return setLayerField(this, key, value);
        return original_set.call(this, key, value);
    };

    const original_init = proto.applyInitial;
    proto.applyInitial = function (attrs) {
        const result = original_init.call(this, attrs);
        if (this.tag === 'layer') initLayerNode(this);
        return result;
    };
}

/**
 * Один смысл видимости для узла-слоя: ЛЮБАЯ запись `node.visible` (в том числе
 * из обёртки — `.hide()/.show()/.visible(flag)`) идёт тем же путём, что
 * `$.layers.show/hide(name)` — глубоко, через `applyLayerVisibility`.
 *
 * Иначе получались два разных смысла, и смесь «глубоко спрятали
 * (`$.layers.hide`) — поверхностно показали (`layer.show()`)" оставляла слой
 * пустым (BASHNYA E8). Для обычных узлов поведение прежнее: флаг ставится
 * только самому узлу.
 *
 * Почему аксессор на узле, а не патч `Wrapper.prototype.visible`: подсистемы
 * ставятся РАНЬШЕ, чем ядро объявляет `.visible()`, и ядро перезаписывает
 * обёртку; аксессор на узле-слое от порядка установки не зависит, а свой флаг
 * живёт в НЕперечисляемом `__visible_flag`, чтобы не попадать в переборы
 * свойств (дампы/снимки) и в заморозку публичных имён.
 */
function installLayerVisibility(node) {
    const initial = node.visible !== false;
    Object.defineProperty(node, '__visible_flag', {
        value: initial, writable: true, enumerable: false, configurable: true,
    });
    Object.defineProperty(node, 'visible', {
        configurable: true,
        enumerable: true,
        get() { return node.__visible_flag; },
        set(value) { applyLayerVisibility(node, value !== false); },
    });
}

function setLayerField(node, key, value) {
    switch (key) {
    case 'name': {
        const name = String(value);
        node.layer_name = name;
        if (!node.internal && name) registry.set(name, node);
        return node;
    }
    case 'order':
        node.layer_order = Number(value);
        node.layer = node.layer_order;
        return node;
    case 'layer':
        node.layer = Number(value);
        node.layer_order = node.layer;
        return node;
    case 'parallax':
        setParallaxFactor(node, value);
        return node;
    case 'modulate':
        applyModulateSpec(node, value);
        return node;
    default:
        return node;
    }
}

/** Доинициализация узла <layer>: имя, порядок, служебная глубина, реестр. */
function initLayerNode(node) {
    if (!node.layer_registered) {
        node.layer_registered = true;
        node.depth = LAYER_DEPTH;
    }
    if (!node.layer_name) node.layer_name = 'layer' + node.uid;
    if (node.layer_order === undefined) {
        node.layer_order = DEFAULT_ORDER;
        node.layer = DEFAULT_ORDER;
    }
    // Имя могло смениться через .attr('name', ...) — держим реестр в актуале.
    if (!node.internal && registry.get(node.layer_name) !== node) registry.set(node.layer_name, node);
    node.attrs.name = node.layer_name;
    node.attrs.order = node.layer_order;
    installLayerVisibility(node);
    return node;
}

// ---------------------------------------------------------------------------
// Параллакс
// ---------------------------------------------------------------------------

/** Задаёт коэффициент и тут же фиксирует якорь по текущей позиции. */
function setParallaxFactor(node, value) {
    if (value === null || value === undefined) {
        delete node.parallax_factor;
        parallax_state.delete(node);
        touchRegistry();   // состав параллакс-узлов изменился — сводка устарела
        return;
    }
    const factor = Number(value);
    if (!Number.isFinite(factor)) {
        ctx.log(`$.layers: коэффициент параллакса "${value}" не число — игнорирую`);
        return;
    }
    node.parallax_factor = factor;
    const cam = cameraTransform();
    const st = parallax_state.get(node) || {};
    st.ax = node.x - cam.x * (1 - factor);
    st.ay = node.y - cam.y * (1 - factor);
    st.last_x = node.x;
    st.last_y = node.y;
    parallax_state.set(node, st);
    touchRegistry();
}

/** Один шаг параллакса: применить ожидаемое смещение или перезакрепить якорь. */
function stepParallax(node, cam) {
    if (node.body >= 0) {
        if (!body_warned) {
            body_warned = true;
            ctx.log('$.layers: у узла с физическим телом параллакс не применяется — '
                  + 'позицией управляет Box2D (уберите тело или двигайте тело через velocity)');
        }
        return;
    }
    const f = node.parallax_factor;
    const st = parallax_state.get(node) || {};
    // Экранная позиция ДО сдвига: игровой код сдвигает якорь (телепорт,
    // .moveTo), и по вычисленному node.x параллакс-узел «промахивался» бы при
    // клике. Кладём сюда то, где узел нарисован в этом кадре.
    st.screen_x = node.x;
    st.screen_y = node.y;
    st.screen_frame = ctx.time && typeof ctx.time.frame === 'function' ? ctx.time.frame() : -1;
    // То же на самом узле: нативный проход наведения (src/nodes.c) не видит
    // parallax_state и читает экранную позицию отсюда.
    node._scr_x = st.screen_x;
    node._scr_y = st.screen_y;
    node._scr_frame = st.screen_frame;
    if (!Number.isFinite(st.last_x)) { st.ax = node.x - cam.x * (1 - f); st.last_x = node.x; }
    if (!Number.isFinite(st.last_y)) { st.ay = node.y - cam.y * (1 - f); st.last_y = node.y; }

    // Игра сдвинула узел сама (телепорт, .moveTo) — фиксируем якорь заново,
    // иначе параллакс «съедал» бы игровое перемещение.
    if (Math.abs(node.x - st.last_x) > PARALLAX_EPS) st.ax = node.x - cam.x * (1 - f);
    if (Math.abs(node.y - st.last_y) > PARALLAX_EPS) st.ay = node.y - cam.y * (1 - f);

    node.x = parallaxOffset(st.ax, cam.x, f);
    node.y = parallaxOffset(st.ay, cam.y, f);
    st.last_x = node.x;
    st.last_y = node.y;
    parallax_state.set(node, st);
}

/**
 * Экранная позиция узла в текущем кадре.
 *
 * Для параллакс-узлов `node.x` — не то, где узел нарисован: подсистема двигает
 * его сама, а игровое смещение уходит в якорь. Поэтому храним позицию до
 * сдвига (её пишет stepParallax) и отдаём её из текущего кадра — по ней
 * работает и попадание курсора, и `:picked`.
 */
export function nodeScreenPos(node) {
    if (!node) return { x: 0, y: 0 };
    const st = parallax_state.get(node);
    let scene_x = node.x;
    let scene_y = node.y;
    // frame() есть только у настоящего $.time: мок в тестах отдаёт заглушку,
    // и вызов без проверки ронял отрисовку слоёв.
    const frame = ctx.time && typeof ctx.time.frame === 'function' ? ctx.time.frame() : -1;
    if (st && st.screen_frame !== undefined && st.screen_frame === frame) {
        scene_x = st.screen_x;
        scene_y = st.screen_y;
    }
    // Нарисованное место = сцена → экран тем же преобразованием, что в
    // render.js (nodeTransform): без него попадание считалось бы в мировых
    // координатах, и клик по любому узлу при сдвинутой камере промахивался.
    const cam = cameraTransform();
    const zoom = cam.zoom || 1;
    // Половина ВИДИМОЙ области — та же формула, что в render.js (nodeTransform),
    // а не размер окна: параллакс считается от cam.w/cam.h, и если сравнивать с
    // шириной окна, попадание уезжает ровно на разницу.
    const half_w = cam.w && cam.w > 0 ? cam.w / 2 : engine.width / 2;
    const half_h = cam.h && cam.h > 0 ? cam.h / 2 : engine.height / 2;
    return {
        x: (scene_x - cam.x) * zoom + half_w + (cam.shake_x || 0),
        y: (scene_y - cam.y) * zoom + half_h + (cam.shake_y || 0),
    };
}

/** Раздать коэффициент потомкам слоя (вложенные слои рулят собой сами). */
function applyParallaxDeep(layer, factor) {
    const stack = layer.child_nodes.slice();
    while (stack.length) {
        const n = stack.pop();
        if (n.tag === 'layer') continue;
        setParallaxFactor(n, factor);
        for (const c of n.child_nodes) stack.push(c);
    }
}

// ---------------------------------------------------------------------------
// Бесшовное повторение параллакс-полосы
//
// Проблема: слой с параллаксом — один узел, и длинный фон кончается: у края
// экрана появляется пустота. Демо платформера решало это своим
// layoutParallax() — копии спрайта раскладывались по экрану с модульным
// сдвигом. Здесь то же делает подсистема: $.layers.repeat(layer, { period }).
//
// Полоса строится БЕЗ лишних узлов: образец (первый видимый ребёнок слоя со
// спрайтом) прячется, а его картинка рисуется отрисовщиком слоя столько раз,
// сколько нужно, чтобы закрыть видимую область. Сдвиг считается по модулю
// периода в ЭКРАННЫХ точках, поэтому при зуме шаг полосы масштабируется
// вместе с миром и стык не расходится. Якорь полосы — обычный параллакс
// образца: позицию образца двигает tickLayers, отрисовщик только повторяет
// её.
// ---------------------------------------------------------------------------

const repeats = new WeakMap();     // слой → { template, period }
const repeat_nodes = new Set();    // слои с полосой — для уборки удалённых

/** Первый видимый ребёнок слоя, у которого есть картинка. */
function repeatTemplate(layer) {
    const stack = layer.child_nodes.slice();
    while (stack.length) {
        const n = stack.pop();
        if (n.tag === 'layer') continue;
        if (!n.removed && n.sprite !== undefined && n.sprite >= 0) return n;
        if (n.visible) for (const c of n.child_nodes) stack.push(c);
    }
    return null;
}

/**
 * Раскладка полосы: сколько копий и с какого экранного X начинать. Чистая
 * арифметика вынесена сюда, чтобы её проверял qjs-тест без отрисовки.
 *
 * step — шаг полосы на экране (period × zoom), base — экранный X образца,
 * view_w — ширина видимой области. Возвращает { first, count }: центры копий
 * идут с шагом step от `first`; first лежит в (-step, 0], поэтому полоса
 * всегда начинается левее кадра и закрывает его до правого края.
 */
export function repeatLayout(step, base, view_w) {
    const s = Number.isFinite(step) && step > 0 ? step : 1;
    const b = Number.isFinite(base) ? base : 0;
    const w = Number.isFinite(view_w) && view_w > 0 ? view_w : 0;
    // Остаток по модулю приводим к (-step, 0] — целые копии не «убегают».
    const first = ((b % s) + s) % s - s;
    const count = Math.max(1, Math.ceil(w / s) + 2);
    return { first, count };
}

/** Рисует полосу (бесшовное повторение) в отрисовщике слоя. */
function renderRepeatLayer(node, cam) {
    const group = repeats.get(node);
    if (!group) return false;
    const template = group.template;
    if (!template || template.removed || template.sprite < 0) return false;
    const zoom = cam && cam.zoom > 0 ? cam.zoom : 1;
    const view_w = cam && cam.w ? cam.w : engine.width;
    const view_h = cam && cam.h ? cam.h : engine.height;
    const cw = cam ? cam.x : 0;
    const ch = cam ? cam.y : 0;
    const step = group.period * zoom;
    const base_x = (template.x - cw) * zoom + view_w / 2 + (cam ? cam.shake_x || 0 : 0);
    const base_y = (template.y - ch) * zoom + view_h / 2 + (cam ? cam.shake_y || 0 : 0);
    const layout = repeatLayout(step, base_x, view_w);
    const color = template.alpha < 1 ? withAlpha(template.color, template.alpha) : template.color;
    const w = group.period * zoom;
    const h = template.h * zoom;
    for (let i = 0; i < layout.count; i++) {
        ctx.gfx.push.sprite(template.sprite, layout.first + i * step, base_y, w, h, 0,
                            color, template.blend_mode);
    }
    return true;
}

/** Убрать группу повтора: вернуть образец в обычную отрисовку. */
function dropRepeat(layer) {
    const group = repeats.get(layer);
    if (!group) return false;
    if (group.template && !group.template.removed) group.template.visible = true;
    repeats.delete(layer);
    return true;
}

/** Прибрать группы, чьи слои/образцы удалены (иначе полоса жила бы вечно). */
function cleanupRepeats() {
    for (const layer of Array.from(repeat_nodes)) {
        const group = repeats.get(layer);
        if (!group || layer.removed || !group.template || group.template.removed) {
            dropRepeat(layer);
            repeat_nodes.delete(layer);
        }
    }
}

// ---------------------------------------------------------------------------
// Слои: порядок и видимость
// ---------------------------------------------------------------------------

/** Пробрасывает порядок слоя на всё поддерево (кроме вложенных слоёв). */
function propagateLayer(layer) {
    const order = layer.layer;
    const factor = layer.parallax_factor;
    const stack = layer.child_nodes.slice();
    while (stack.length) {
        const n = stack.pop();
        // Вложенный слой — самостоятельный контейнер: у него свой порядок.
        if (n.tag === 'layer') continue;
        n.layer = order;
        // Параллакс слоя наследуют только те дети, у кого своего нет.
        if (n.parallax_factor === undefined && Number.isFinite(factor)) setParallaxFactor(n, factor);
        for (const c of n.child_nodes) stack.push(c);
    }
}

function hideDescendants(layer) {
    const stack = layer.child_nodes.slice();
    while (stack.length) {
        const n = stack.pop();
        n.visible = false;
        for (const c of n.child_nodes) stack.push(c);
    }
}

function setVisibleDeep(layer, value) {
    const stack = layer.child_nodes.slice();
    while (stack.length) {
        const n = stack.pop();
        n.visible = value;
        for (const c of n.child_nodes) stack.push(c);
    }
}

/**
 * ЕДИНАЯ точка смены видимости слоя: сам слой и все потомки.
 *
 * До неё было два разных смысла: `$.layers.hide/show(name)` гасили и
 * показывали глубоко, а `.hide()/.show()/.visible()` у узла-слоя (обёртка)
 * трогали только сам узел. Из-за этого смесь «глубоко спрятали — поверхностно
 * показали» оставляла слой нарисованным ПУСТЫМ: `layer.visible = true`, а дети
 * `visible = false` (BASHNYA E8: «`layer.show()` не возвращает детей после
 * `hide()`»). Теперь обе дороги идут сюда, и смешанные вызовы безопасны.
 *
 * Образец полосы (`.repeat()`) обязан остаться скрытым: полосы рисует
 * отрисовщик слоя, иначе картинка удвоилась бы.
 */
function applyLayerVisibility(node, value) {
    node.__visible_flag = value;
    setVisibleDeep(node, value);
    const group = repeats.get(node);
    if (group && group.template && !group.template.removed) group.template.visible = false;
}

function sortedLayers() {
    const out = [];
    for (const node of ctx.nodes) {
        if (node.tag === 'layer' && !node.removed && !node.internal) out.push(node);
    }
    out.sort((a, b) => {
        const ka = layerSortKey(a.layer, 0);
        const kb = layerSortKey(b.layer, 0);
        if (ka !== kb) return ka - kb;
        return a.uid - b.uid;
    });
    return out;
}

function findByName(name) {
    const node = registry.get(String(name));
    if (!node || node.removed || node.internal) return null;
    return node;
}

function ownerLayer(node) {
    let cur = node;
    while (cur) {
        if (cur.tag === 'layer') return cur;
        cur = cur.parent_node;
    }
    return null;
}

function resolveNode(what) {
    if (what instanceof Node) return what;
    if (what && what.nodes) return what.nodes[0] || null;
    if (typeof what === 'string') {
        // Сначала имя слоя, затем селектор: 'hud' — имя, '#hud' — селектор.
        return findByName(what) || query(what)[0] || null;
    }
    return null;
}

function resolveNodes(what) {
    if (what instanceof Node) return [what];
    if (what && what.nodes) return what.nodes.slice();
    if (typeof what === 'string') {
        const by_name = findByName(what);
        if (by_name) return [by_name];
        return query(what);
    }
    return [];
}

/** Имя слоя или узел/обёртка/селектор → узел слоя (для bringToFront и т.п.). */
function layerNodeOf(what) {
    // Имя слоя ищем до селектора: 'hud' — это имя, а не тег.
    if (typeof what === 'string') {
        const by_name = findByName(what);
        if (by_name) return by_name;
    }
    const node = resolveNode(what);
    if (!node) return null;
    return node.tag === 'layer' ? node : ownerLayer(node);
}

// ---------------------------------------------------------------------------
// Полноэкранный оттенок и затемнение
// ---------------------------------------------------------------------------

/**
 * Разбирает спецификацию modulate: строка/число цвета, '#rrggbbaa' либо
 * { color, alpha }. Если альфа не задана отдельно — берётся из самого цвета.
 */
function applyModulateSpec(node, value) {
    if (value === null || value === undefined) {
        node.modulate_color = null;
        node.modulate_alpha = 0;
        return;
    }
    let color = value;
    let alpha;
    if (value && typeof value === 'object' && !Array.isArray(value) && value.color !== undefined) {
        color = value.color;
        alpha = value.alpha;
    }
    const packed = packColor(color);
    node.modulate_color = packed;
    node.modulate_alpha = alpha === undefined
        ? clamp01((packed >>> 24) / 255)
        : clamp01(alpha);
}

/** Служебный узел-слой для глобального modulate и fade. */
function ensureOverlay() {
    if (overlay_node && !overlay_node.removed) return overlay_node;
    overlay_node = new Node('layer', { name: OVERLAY_NAME, order: OVERLAY_ORDER });
    overlay_node.internal = true;
    overlay_node.depth = LAYER_DEPTH;
    overlay_node.modulate_color = null;
    overlay_node.modulate_alpha = 0;
    registry.delete(OVERLAY_NAME);
    return overlay_node;
}

function renderLayer(node, t, cam) {
    const w = cam.w, h = cam.h;
    // Полоса параллакса (бесшовное повторение) — под оттенком слоя.
    renderRepeatLayer(node, cam);
    const color = node.modulate_color;
    const alpha = node.modulate_alpha || 0;
    // Режим берём у узла: `multiply` — затемнение, `add` — засветка (вспышка,
    // молния), `alpha` — обычная пелена. Раньше режим игнорировался.
    const blend = node.blend_mode || 'alpha';
    if (color !== null && color !== undefined && alpha > 0) {
        ctx.gfx.push.sprite(engine.whiteSprite, w / 2, h / 2, w, h, 0,
                            withAlpha(color, alpha), blend);
    }
    // Глобальное затемнение перехода — поверх оттенка и всей сцены.
    if (node === overlay_node && fade.alpha > 0) {
        const fc = fade.color === null ? blackPacked() : fade.color;
        ctx.gfx.push.sprite(engine.whiteSprite, w / 2, h / 2, w, h, 0,
                            withAlpha(fc, fade.alpha), blend);
    }
}

function tickFade(dt) {
    if (!(fade.ms > 0)) return;
    // Игровое время ($.time), чтобы переходы уважали паузу и масштаб времени.
    // rawDelta() здесь был ошибкой: при $.time.pause() затемнение продолжало
    // ползти, хотя комментарий обещал обратное.
    const step = (ctx.time && typeof ctx.time.delta === 'function') ? ctx.time.delta() : dt;
    fade.t += step * 1000;
    const p = Math.min(1, fade.t / fade.ms);
    fade.alpha = fade.from + (fade.to - fade.from) * p;
    if (p >= 1) {
        fade.ms = 0;
        fade.alpha = fade.to;
        const resolve = fade.resolve;
        fade.resolve = null;
        if (resolve) resolve();
    }
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

export function installLayers($) {
    patchNode();

    TAGS.layer = Object.assign(TAGS.layer || {}, {
        body: null, w: 0, h: 0, color: '#ffffff',
    });

    registerNodeRenderer('layer', renderLayer);

    const layers = {
        /** Создать слой. opts: { name, order, parallax, visible, modulate, ... }. */
        create(opts) {
            const node = new Node('layer', opts || {});
            initLayerNode(node);
            return wrapOne(node);
        },

        /** Обёртка слоя по имени; пустая обёртка, если слоя нет. */
        get(name) {
            const node = findByName(name);
            return node ? wrapOne(node) : wrap([]);
        },

        has(name) { return !!findByName(name); },

        /**
         * Имена слоёв в порядке отрисовки (снизу вверх). Служебный слой
         * глобального оттенка в список не попадает.
         */
        list() { return sortedLayers().map((n) => n.layer_name); },

        /**
         * Порядок слоёв. Без аргументов — массив { name, order } снизу вверх;
         * order(name) — число (или null); order(name, n) — задать порядок;
         * order(n) — задать порядок верхнего слоя.
         */
        order(name, value) {
            if (name === undefined) return sortedLayers().map((n) => ({ name: n.layer_name, order: n.layer }));
            if (typeof name === 'number') {
                const top = sortedLayers();
                if (!top.length) return null;
                return layers.order(top[top.length - 1].layer_name, name);
            }
            const node = findByName(name);
            if (!node) return null;
            if (value === undefined) return node.layer;
            node.layer_order = Number(value);
            node.layer = node.layer_order;
            propagateLayer(node);
            return layers;
        },

        /** Имя верхнего (последнего по порядку) слоя или null. */
        current() {
            const list = sortedLayers();
            return list.length ? list[list.length - 1].layer_name : null;
        },

        /** Имя слоя, которому принадлежит узел (сам слой тоже считается). */
        of(what) {
            const node = resolveNode(what);
            if (!node) return null;
            const layer = ownerLayer(node);
            return layer ? layer.layer_name : null;
        },

        /** Удалить слой вместе с детьми. Возвращает true, если слой был. */
        remove(name) {
            const node = findByName(name);
            if (!node) return false;
            registry.delete(node.layer_name);
            node.destroy();
            return true;
        },

        /** Удалить все пользовательские слои (служебный оверлей остаётся). */
        clear() {
            for (const node of ctx.nodes.slice()) {
                if (node.tag === 'layer' && !node.internal && !node.removed) node.destroy();
            }
            registry.clear();
            return layers;
        },

        show(name) {
            const node = findByName(name);
            if (!node) return false;
            applyLayerVisibility(node, true);
            return true;
        },

        hide(name) {
            const node = findByName(name);
            if (!node) return false;
            applyLayerVisibility(node, false);
            return true;
        },

        toggle(name) {
            const node = findByName(name);
            if (!node) return false;
            return node.visible ? layers.hide(name) : layers.show(name);
        },

        /** Поднять слой (по имени или узлу) выше всех остальных. */
        bringToFront(nameOrNode) {
            const node = layerNodeOf(nameOrNode);
            if (!node) return null;
            let max = -Infinity;
            for (const l of sortedLayers()) if (l.layer > max) max = l.layer;
            node.layer_order = max + 1;
            node.layer = node.layer_order;
            propagateLayer(node);
            return node.layer_name;
        },

        /** Опустить слой ниже всех остальных. */
        sendToBack(nameOrNode) {
            const node = layerNodeOf(nameOrNode);
            if (!node) return null;
            let min = Infinity;
            for (const l of sortedLayers()) if (l.layer < min) min = l.layer;
            node.layer_order = min - 1;
            node.layer = node.layer_order;
            propagateLayer(node);
            return node.layer_name;
        },

        /**
         * Бесшовное повторение слоя: `$.layers.repeat(layer, opts)`.
         *
         * Слой задаёт образец — первый свой ребёнок со спрайтом; образец
         * прячется, а его картинка рисуется столько раз, сколько нужно, чтобы
         * закрыть видимый кадр. Шаг полосы — `period` мировых пикселей (по
         * умолчанию ширина образца), сдвиг считается по модулю в экранных
         * точках и потому сходится при любом зуме.
         *
         *   const sky = $.layers.create({ name: 'sky', order: -30 });
         *   $('<sprite>', { src: 'assets/sky.png' }).size(512, 256).at(0, 200).appendTo(sky);
         *   sky.parallax(0.9);                        // коэффициент параллакса
         *   $.layers.repeat(sky, { period: 512 });    // бесшовная полоса
         *   $.layers.repeatOff(sky);                  // вернуть обычный слой
         *
         * Ограничения: образец — спрайт (не тайлмап и не узел с физикой);
         * копии не анимируются и не являются узлами, поэтому в `$.world.count()`
         * и в дереве DevTools их нет.
         */
        repeat(what, opts) {
            const o = opts || {};
            const layer = layerNodeOf(what);
            if (!layer) return null;
            const template = repeatTemplate(layer);
            if (!template) {
                ctx.log('$.layers.repeat: у слоя нет ребёнка со спрайтом — '
                      + 'сначала добавьте <sprite> с картинкой');
                return null;
            }
            const period = Math.max(1, numOr(o.period !== undefined ? o.period : o.tileW, template.w));
            template.visible = false;         // образец рисует отрисовщик слоя
            repeats.set(layer, { template, period });
            repeat_nodes.add(layer);
            return layers;
        },

        /** Выключить повторение слоя; образец снова рисуется сам. */
        repeatOff(what) {
            const layer = layerNodeOf(what);
            if (!layer) return false;
            repeat_nodes.delete(layer);
            return dropRepeat(layer);
        },

        /** Факты о полосе: { template, period, factor } или null. */
        repeatInfo(what) {
            const layer = layerNodeOf(what);
            const group = layer ? repeats.get(layer) : null;
            if (!group) return null;
            return {
                template: group.template ? group.template.tag : null,
                period: group.period,
                factor: group.template && group.template.parallax_factor !== undefined
                    ? group.template.parallax_factor : null,
            };
        },

        /**
         * Коэффициент параллакса узла/слоя. Без factor — чтение (число или
         * null). Для слоя коэффициент раздаётся и потомкам. null — снять.
         */
        parallax(what, factor) {
            const nodes = resolveNodes(what);
            if (factor === undefined) {
                if (!nodes.length) return null;
                return nodes[0].parallax_factor === undefined ? null : nodes[0].parallax_factor;
            }
            if (!nodes.length) return null;
            for (const node of nodes) {
                setParallaxFactor(node, factor);
                if (node.tag === 'layer' && factor !== null && factor !== undefined) {
                    applyParallaxDeep(node, Number(factor));
                }
            }
            return layers;
        },

        /**
         * Глобальный оттенок поверх мира: modulate(color, alpha). Без
         * аргументов — { color, alpha }. null — выключить.
         *
         * Это именно наложение с альфа-смешиванием (светлые цвета
         * высветляют, тёмные затемняют), а не умножение — режимов смешивания
         * у движка нет.
         */
        modulate(color, alpha) {
            // Чтение не должно создавать служебный узел — иначе он появился бы
            // в мире от одного только любопытного вызова.
            if (color === undefined) {
                const ov = overlay_node && !overlay_node.removed ? overlay_node : null;
                return {
                    color: ov && ov.modulate_color !== undefined ? ov.modulate_color : null,
                    alpha: ov ? (ov.modulate_alpha || 0) : 0,
                };
            }
            const ov = ensureOverlay();
            applyModulateSpec(ov, color);
            if (alpha !== undefined) ov.modulate_alpha = clamp01(alpha);
            return layers;
        },

        /** Мгновенно задать полноэкранное затемнение. Без аргументов — чтение. */
        fade(color, alpha) {
            if (color === undefined) {
                return { color: fade.color === null ? blackPacked() : fade.color, alpha: fade.alpha };
            }
            ensureOverlay();
            if (color !== null) fade.color = packColor(color);
            fade.alpha = alpha === undefined ? 1 : clamp01(alpha);
            fade.from = fade.to = fade.alpha;
            fade.ms = 0;
            fade.t = 0;
            return layers;
        },

        /** Плавно изменить затемнение за ms мс. Возвращает Promise. */
        fadeTo(color, alpha, ms) {
            ensureOverlay();
            if (color !== null && color !== undefined) fade.color = packColor(color);
            const to = clamp01(alpha);
            const duration = Number(ms) || 0;
            // Прошлый незавершённый переход отпускаем, чтобы его await не завис.
            if (fade.resolve) {
                const resolve = fade.resolve;
                fade.resolve = null;
                resolve();
            }
            if (!(duration > 0)) {
                fade.alpha = to;
                fade.from = fade.to = to;
                fade.ms = 0;
                return Promise.resolve(layers);
            }
            fade.from = fade.alpha;
            fade.to = to;
            fade.ms = duration;
            fade.t = 0;
            return new Promise((resolve) => { fade.resolve = resolve; });
        },

        /** Переход «в чёрное»: fadeOut(ms). */
        fadeOut(ms) { return layers.fadeTo('#000000', 1, ms === undefined ? 400 : ms); },
    };

    $.layers = layers;

    // Метод узла: .parallax(f) — то же, что $.layers.parallax(node, f).
    // Обходим this.nodes напрямую: в юнит-тесте без api.js метода .each() нет.
    def('parallax', function (factor) {
        if (factor === undefined) {
            const node = this.nodes[0];
            return !node || node.parallax_factor === undefined ? null : node.parallax_factor;
        }
        for (const node of this.nodes) {
            setParallaxFactor(node, factor);
            if (node.tag === 'layer' && factor !== null) applyParallaxDeep(node, Number(factor));
        }
        return this;
    });

    return $;
}

/**
 * Кадровый шаг подсистемы. Вызывается из игрового цикла (api.js) до отрисовки,
 * чтобы параллакс успел применить позиции к текущему кадру.
 */
/**
 * Сводка подсистемы: сколько в реестре слоёв и параллакс-узлов. Оба признака
 * держит индекс реестра — отдельного прохода по ctx.nodes нет
 * (docs/HIGH_LEVEL_API_PERF.md §5, P2). Объект переиспользуется: сводка живёт
 * до конца кадра и её читают сразу.
 */
const layer_summary = { layers: 0, parallax: 0 };

function layersSummary() {
    layer_summary.layers = nodesByTag('layer').length;
    layer_summary.parallax = facetCount('parallax');
    return layer_summary;
}

export function tickLayers(dt) {
    const summary = layersSummary();
    // Переход-затемнение живёт вне узлов: пока он идёт, шаг нужен всегда.
    // Полосы повторения тоже: их раскладку двигает параллакс образца, а сам
    // образец может не иметь facet'а (тогда его двигать нечего).
    if (summary.layers === 0 && summary.parallax === 0 && repeat_nodes.size === 0 && !(fade.ms > 0)) return;

    const cam = cameraTransform();

    // 1. Слои: порядок по умолчанию, распространение порядка и видимости.
    const layers = nodesByTag('layer');
    for (let i = 0; i < layers.length; i++) {
        const node = layers[i];
        if (node.removed) continue;
        initLayerNode(node);
        // Прямое .layer(n) на слое (цепочный метод ядра) тоже считаем сменой
        // порядка: иначе tick вернул бы старое значение.
        if (node.layer_order !== node.layer) node.layer_order = node.layer;
        propagateLayer(node);
        if (!node.visible) hideDescendants(node);
    }

    // 2. Параллакс — после распространения, иначе добавленный в кадре ребёнок
    //    слоя сдвинулся бы только на следующем кадре.
    const parallax = nodesWithFacet('parallax');
    for (let i = 0; i < parallax.length; i++) {
        const node = parallax[i];
        if (node.removed) continue;
        stepParallax(node, cam);
    }

    // 3. Реестр: выкидываем удалённые и служебные узлы.
    for (const [name, node] of registry) {
        if (node.removed || node.internal) registry.delete(name);
    }

    // 3.1. Полосы повторения: снимаем те, чей слой или образец удалён.
    if (repeat_nodes.size) cleanupRepeats();

    // 4. Переход-затемнение.
    tickFade(dt);
}
