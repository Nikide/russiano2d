// ===========================================================================
// Prefab и сериализация узлов: $.prefab — аналог PackedScene / instantiate /
// наследования сцен из Godot 4.
//
// Зачем отдельный модуль: $.scene умеет менять сцены, но не умеет описывать
// дерево узлов данными. Здесь узел (или целый мир) превращается в обычный
// JSON-совместимый объект, который можно:
//   * сохранить в $.store (saveTo/loadFrom) или в строку (toJSON/fromJSON);
//   * зарегистрировать под именем и инстанцировать сколько угодно раз;
//   * унаследовать: register('child', { extend: 'base', overrides: {...},
//     add: [...] }) — как inherited scene.
//
//   $.prefab.register('hero', $.prefab.save($('<player>')));
//   $.prefab.instantiate('hero', { x: 100, y: 200, parent: $.world, id: 'p1' });
//
// Два правила, из которых растёт весь файл:
//   1) наружу — только сериализуемые данные: ни функций, ни ссылок на живые
//      объекты (sanitize() выбрасывает функции и защищается от циклов);
//   2) восстановление идемпотентно: save → load → save даёт тот же объект.
//      Поэтому nodeToData() всегда пишет один и тот же набор полей в одном и
//      том же порядке, а тело и спрайт хранятся описанием, а не числовым id
//      (id тела Box2D и спрайта после загрузки будут другими).
//
// Модуль не обращается к engine на верхнем уровне: чистые nodeToData(),
// applyData(), mergeSpec() тестируются под qjs без движка (tests/js/prefab_test.mjs).
// ===========================================================================

import {
    ctx, Node, Wrapper, TAGS, wrap, wrapOne, query, def, defGet,
    packColor, sheetFrames,
} from './core.js';

// ---------------------------------------------------------------------------
// Захват источника спрайта
//
// Узел хранит уже разрешённый числовой id спрайта (node.sprite), а исходный
// путь/спецификацию листа ядро нигде не запоминает. Чтобы prefab пересоздал
// картинку после загрузки, модуль запоминает аргумент .sprite()/setSprite()
// в WeakMap. Хук ставится один раз в installPrefab() и ничего не меняет по
// сути: он лишь записывает аргумент и вызывает оригинал.
// ---------------------------------------------------------------------------

const sprite_sources = new WeakMap();
const prefab_names = new WeakMap();
let sprite_hook = false;
let frames_hook = false;

/** Нормализованная копия спецификации листа — чтобы save→load→save совпадал. */
function normalizeSpriteSource(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((v) => num(v, 0));
    if (value && typeof value === 'object' && value.src) {
        const spec = { src: String(value.src) };
        if (value.cols !== undefined) spec.cols = num(value.cols, 1);
        if (value.rows !== undefined) spec.rows = num(value.rows, 1);
        if (value.cw !== undefined) spec.cw = num(value.cw, 0);
        if (value.ch !== undefined) spec.ch = num(value.ch, 0);
        return spec;
    }
    return null;
}

function rememberSprite(node, value) {
    const normalized = normalizeSpriteSource(value);
    if (normalized === null) {
        // Число — уже готовый id спрайта, источника у него нет; null/undefined
        // означают «сбросить»: и то и другое забываем, чтобы не serialize-ить id.
        if (value === null || value === undefined) sprite_sources.delete(node);
        return;
    }
    sprite_sources.set(node, normalized);
}

/**
 * Ставит хуки на Node.prototype.setSprite и Wrapper.prototype.frames.
 * Wrapper.prototype.frames определяется в api.js ПОСЛЕ installPrefab(),
 * поэтому хук ставится лениво — при первом обращении к $.prefab или в tick.
 */
function ensureHooks() {
    if (!sprite_hook && Node && Node.prototype && typeof Node.prototype.setSprite === 'function') {
        const current = Node.prototype.setSprite;
        if (current.__prefabHooked) {
            // Хук уже стоит (например, после перезагрузки модуля на лету):
            // второй слой не нужен, но своя WeakMap наполнится и так.
            sprite_hook = true;
        } else {
            const original = current;
            const wrapped = function (value) {
                rememberSprite(this, value);
                return original.call(this, value);
            };
            wrapped.__prefabHooked = true;
            Node.prototype.setSprite = wrapped;
            sprite_hook = true;
        }
    }
    if (!frames_hook && Wrapper && Wrapper.prototype && typeof Wrapper.prototype.frames === 'function') {
        const current = Wrapper.prototype.frames;
        if (current.__prefabHooked) {
            frames_hook = true;
        } else {
            const original = current;
            const wrapped = function (spec) {
                const result = original.apply(this, arguments);
                if (spec && typeof spec === 'object' && spec.src) {
                    for (const node of this.nodes) {
                        const normalized = normalizeSpriteSource(spec);
                        if (normalized) sprite_sources.set(node, normalized);
                    }
                }
                return result;
            };
            wrapped.__prefabHooked = true;
            Wrapper.prototype.frames = wrapped;
            frames_hook = true;
        }
    }
}

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------

function warn(message) { ctx.log('$.prefab: ' + message); }

function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
}

/** Упакованный RGBA → '#rrggbbaa' (низкий байт — красный, как в engine.rgba). */
function colorToHex(packed) {
    if (typeof packed !== 'number') return '#ffffffff';
    const byte = (n) => {
        const h = (n & 0xff).toString(16);
        return h.length === 1 ? '0' + h : h;
    };
    return '#' + byte(packed) + byte(packed >> 8) + byte(packed >> 16) + byte(packed >>> 24);
}

/**
 * Приводит значение к JSON-совместимому виду: функции и undefined исчезают,
 * циклы разрываются, Set/Map/типизированные массивы превращаются в массивы и
 * объекты. Возвращает undefined, если значение сериализовать нельзя.
 */
export function sanitize(value, seen) {
    if (value === null) return null;
    const type = typeof value;
    if (type === 'string' || type === 'boolean') return value;
    if (type === 'number') return isFinite(value) ? value : null;
    if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') return undefined;
    if (Array.isArray(value)) {
        // Массивы тоже надо охранять: [a, a] или самоссылающийся массив иначе
        // уводили рекурсию в бесконечность (RangeError на $.prefab.save).
        const guard = seen || new Set();
        if (guard.has(value)) return undefined;   // цикл — молча рвём
        guard.add(value);
        const out = value.map((item) => {
            const clean = sanitize(item, guard);
            return clean === undefined ? null : clean;
        });
        guard.delete(value);
        return out;
    }
    if (value instanceof Set) return sanitize([...value], seen);
    if (value instanceof Map) return sanitize(Object.fromEntries(value), seen);
    if (ArrayBuffer.isView(value)) return sanitize(Array.from(value), seen);
    if (type === 'object') {
        const guard = seen || new Set();
        if (guard.has(value)) return undefined;   // цикл — молча рвём
        guard.add(value);
        const out = {};
        for (const key of Object.keys(value)) {
            const clean = sanitize(value[key], guard);
            if (clean !== undefined) out[key] = clean;
        }
        guard.delete(value);
        return out;
    }
    return undefined;
}

/** Глубокая копия JSON-совместимого значения (для data_store и spec). */
function clonePlain(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clonePlain);
    const out = {};
    for (const key of Object.keys(value)) out[key] = clonePlain(value[key]);
    return out;
}

/** Данные из save() или произвольный объект → безопасная глубокая копия. */
export function dataToSpec(value) {
    const clean = sanitize(value, new Set());
    return clean === undefined ? null : clean;
}

// ---------------------------------------------------------------------------
// Узел → данные (чистая функция: движок не нужен)
// ---------------------------------------------------------------------------

/** Тип тела описываем строкой; false — «тело выключено», null — как в теге. */
function bodyField(node) {
    if (node.body_kind) return node.body_kind;
    if (node.body_disabled) return false;
    return null;
}

/**
 * Источник спрайта: сначала запомненный .sprite(), затем attrs.sprite, и лишь
 * как запасной вариант attrs.src — но только если спрайт реально загружен
 * (иначе у <tilemap> поле src попало бы в спрайт и лишний раз грузило текстуру).
 */
function spriteField(node) {
    const remembered = sprite_sources.get(node);
    if (remembered !== undefined) return sanitize(remembered, new Set());
    const attrs = node.attrs || {};
    if (attrs.sprite !== undefined && attrs.sprite !== null && typeof attrs.sprite !== 'number') {
        return sanitize(attrs.sprite, new Set());
    }
    if (attrs.src && node.sprite >= 0) return String(attrs.src);
    return null;
}

/**
 * Узел → обычный объект со всем поддеревом. Числовые id тела и спрайта НЕ
 * сохраняются: body — описание типа, sprite — путь/спецификация листа.
 *
 * Набор ключей и их порядок фиксированы: это гарантирует, что save → load →
 * save даст побайтово одинаковый JSON.
 */
export function nodeToData(node) {
    if (!node || typeof node !== 'object') return null;
    const attrs = sanitize(node.attrs || {}, new Set());
    return {
        tag: node.tag,
        id: node.id === undefined || node.id === null ? null : String(node.id),
        class: node.classes ? [...node.classes].join(' ') : '',
        tags: node.tags_extra ? [...node.tags_extra] : [],
        data: node.data_store ? (sanitize(Object.fromEntries(node.data_store), new Set()) || {}) : {},

        x: num(node.x, 0),
        y: num(node.y, 0),
        w: num(node.w, 0),
        h: num(node.h, 0),
        angle: num(node.angle, 0),
        scaleX: num(node.scale_x, 1),
        scaleY: num(node.scale_y, 1),

        alpha: num(node.alpha, 1),
        visible: node.visible !== false,
        layer: num(node.layer, 0),
        depth: num(node.depth, 0),

        color: colorToHex(node.color),
        hoverColor: node.hover_color === undefined || node.hover_color === null
            ? null : colorToHex(node.hover_color),
        textColor: colorToHex(node.text_color),
        fillColor: colorToHex(node.fill_color),

        text: node.text === undefined ? '' : String(node.text),
        fontSize: num(node.size, 20),
        value: num(node.value, 0),
        max: num(node.max_value, 1),
        radius: num(node.radius, 200),
        intensity: num(node.intensity, 1),
        r: node.r === undefined ? null : num(node.r, 0),

        team: num(node.team, 0),
        hp: num(node.cur_hp, 0),
        maxHp: num(node.max_hp, 0),

        body: bodyField(node),
        gravity: node.gravity_on !== false,
        hitbox: node.hitbox ? [num(node.hitbox.w, 0), num(node.hitbox.h, 0)] : null,
        collisionMask: num(node.collision_mask, 0xffffffff),
        layerBits: num(node.layer_bits, 1),
        collisionGroup: num(node.collision_group, 0),

        sprite: spriteField(node),
        frame: num(node.frame_index, 0),

        attrs: attrs === undefined ? {} : attrs,
        children: (node.child_nodes || []).map(nodeToData),
    };
}

// ---------------------------------------------------------------------------
// Данные → узел
// ---------------------------------------------------------------------------

/** Родитель для load/instantiate: узел, обёртка, селектор или мир (null). */
export function resolveParent(parent) {
    if (parent === undefined || parent === null) return null;
    if (parent === ctx.world) return null;
    if (parent instanceof Wrapper) return parent.nodes[0] || null;
    if (parent instanceof Node || (parent && parent.tag)) return parent;
    if (typeof parent === 'string') return query(parent)[0] || null;
    return null;
}

function resolveNodes(target) {
    if (!target) return [];
    if (target instanceof Wrapper) return target.nodes.slice();
    if (target instanceof Node || (target && target.tag)) return [target];
    if (typeof target === 'string') return query(target);
    if (Array.isArray(target)) return target.filter((n) => n && n.tag);
    return [];
}

/**
 * Узел или обёртка → данные (у одного узла объект, у многих массив).
 * Возвращает null, если передан не узел: по одному полю tag данные узла и
 * обычные данные prefab не различить, поэтому смотрим на класс.
 */
function toDataArg(value) {
    if (value instanceof Wrapper) {
        const nodes = value.nodes.slice();
        if (nodes.length === 0) return null;
        return nodes.length === 1 ? nodeToData(nodes[0]) : nodes.map(nodeToData);
    }
    if (value instanceof Node) return nodeToData(value);
    return null;
}

/** Свободный id: если base занят живым узлом, добавляем числовой суффикс. */
function freshId(base) {
    if (base === undefined || base === null || base === '') return null;
    const id = String(base);
    if (!ctx.byId || !ctx.byId.has(id)) return id;
    const taken = ctx.byId.get(id);
    if (!taken || taken.removed) return id;
    let n = 2;
    while (ctx.byId.has(id + n)) n++;
    return id + n;
}

/**
 * Создаёт узел (с детьми) из данных save(). parent — узел, обёртка, селектор
 * или null (мир). Возвращает Node. Если в данных есть extend, его надо
 * разрешить заранее (instantiate/get делают это сами).
 */
export function applyData(data, parent) {
    if (!data || typeof data !== 'object') {
        warn('applyData: нужны данные узла');
        return null;
    }
    if (data.extend !== undefined) {
        warn('applyData: extend не разрешён — используйте $.prefab.instantiate');
    }
    const tag = data.tag ? String(data.tag) : 'rect';
    if (!TAGS[tag]) warn(`неизвестный тег <${tag}> — создаю пустым`);

    const attrs = Object.assign({}, data.attrs || {});
    if (data.id !== undefined && data.id !== null) attrs.id = String(data.id);
    if (data.class) attrs.class = data.class;
    if (data.x !== undefined) attrs.x = num(data.x, 0);
    if (data.y !== undefined) attrs.y = num(data.y, 0);

    const node = new Node(tag, attrs);

    // Спрайт ставим до геометрии: setSprite() может подогнать w/h под размер
    // текстуры, а сохранённые размеры авторитетнее автоматических.
    if (data.sprite !== undefined && data.sprite !== null) {
        node.setSprite(data.sprite);
        if (data.sprite && typeof data.sprite === 'object' && data.sprite.src) {
            const frames = sheetFrames(data.sprite);
            if (frames) node.frames = frames;
        }
    }

    if (data.w !== undefined) node.w = num(data.w, node.w);
    if (data.h !== undefined) node.h = num(data.h, node.h);
    if (data.angle !== undefined) node.angle = num(data.angle, 0);
    if (data.scaleX !== undefined) node.scale_x = num(data.scaleX, 1);
    if (data.scaleY !== undefined) node.scale_y = num(data.scaleY, 1);
    if (data.alpha !== undefined) node.alpha = num(data.alpha, 1);
    if (data.visible !== undefined) node.visible = data.visible !== false;
    if (data.layer !== undefined) node.layer = num(data.layer, 0);
    if (data.depth !== undefined) { node.depth = num(data.depth, 0); node.z = node.depth; }

    if (data.color !== undefined) node.color = packColor(data.color);
    if (data.hoverColor !== undefined) {
        node.hover_color = data.hoverColor === null ? null : packColor(data.hoverColor);
    }
    if (data.textColor !== undefined) node.text_color = packColor(data.textColor);
    if (data.fillColor !== undefined) node.fill_color = packColor(data.fillColor);

    if (data.text !== undefined) node.text = String(data.text);
    if (data.fontSize !== undefined) node.size = num(data.fontSize, 20);
    if (data.value !== undefined) node.value = num(data.value, 0);
    if (data.max !== undefined) node.max_value = num(data.max, 1);
    if (data.radius !== undefined) node.radius = num(data.radius, 200);
    if (data.intensity !== undefined) node.intensity = num(data.intensity, 1);
    if (data.r !== undefined && data.r !== null) node.r = num(data.r, 0);

    if (data.team !== undefined) node.team = num(data.team, 0);
    if (data.maxHp !== undefined) node.max_hp = num(data.maxHp, 0);
    if (data.hp !== undefined) node.cur_hp = num(data.hp, 0);

    if (data.hitbox) node.hitbox = { w: num(data.hitbox[0], node.w), h: num(data.hitbox[1], node.h) };
    // Слои и маски: пишем через set(), чтобы фильтр доехал и до уже
    // созданного тела (ниже тело всё равно пересоздаётся — поля успеют).
    if (data.layerBits !== undefined) node.set('layerBits', num(data.layerBits, 1));
    if (data.collisionMask !== undefined) node.set('mask', num(data.collisionMask, 0xffffffff));
    if (data.collisionGroup !== undefined) node.set('group', num(data.collisionGroup, 0));
    if (data.gravity !== undefined) node.gravity_on = data.gravity !== false;

    // Тело: строка — тип, false — выключено, null — как в теге. Пересоздаём
    // всегда, потому что размеры узла могли измениться после конструктора.
    if (data.body === false) node.setBody(null);
    else if (typeof data.body === 'string') node.setBody(data.body);
    else if (node.body_kind) node.setBody(node.body_kind);
    if (node.body >= 0) engine.setGravityScale(node.body, node.gravity_on === false ? 0 : 1);

    if (data.tags) for (const extra of [].concat(data.tags)) node.addTag(extra);
    if (data.data && typeof data.data === 'object') {
        const store = node.dataMap();   // контейнер ленивый: создаётся при записи
        for (const key of Object.keys(data.data)) store.set(key, clonePlain(data.data[key]));
    }
    if (data.frame) {
        node.frame_index = num(data.frame, 0);
        if (node.frames && node.frames[node.frame_index] !== undefined) node.sprite = node.frames[node.frame_index];
    }

    for (const childData of (data.children || [])) applyData(childData, node);

    if (parent && !node.parent_node) {
        node.parent_node = parent;
        parent.child_nodes.push(node);
    }
    return node;
}

// ---------------------------------------------------------------------------
// Наследование и переопределения (чистые функции)
// ---------------------------------------------------------------------------

const DATA_FIELDS = new Set([
    'tag', 'id', 'class', 'tags', 'data', 'x', 'y', 'w', 'h', 'angle',
    'scaleX', 'scaleY', 'alpha', 'visible', 'layer', 'depth', 'color',
    'hoverColor', 'textColor', 'fillColor', 'text', 'fontSize', 'value',
    'max', 'radius', 'intensity', 'r', 'team', 'hp', 'maxHp', 'body',
    'gravity', 'hitbox', 'collisionMask', 'sprite', 'frame', 'attrs', 'children',
]);

/** Разбор 'a b' / ['a','b'] → ['a','b']. */
function classList(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return String(value === undefined || value === null ? '' : value).split(/\s+/).filter(Boolean);
}

/**
 * Применяет overrides к данным узла (не к живому узлу): 'size' и 'pos' —
 * короткие формы геометрии, 'class'/'tags' дополняются, известные поля данных
 * перезаписываются, остальное уходит в attrs.
 */
export function applyOverrides(data, overrides) {
    if (!overrides || typeof overrides !== 'object') return data;
    for (const key of Object.keys(overrides)) {
        const value = overrides[key];
        switch (key) {
        case 'size':
            if (Array.isArray(value)) { data.w = num(value[0], data.w); data.h = num(value[1], data.h); }
            break;
        case 'pos':
            if (Array.isArray(value)) { data.x = num(value[0], data.x); data.y = num(value[1], data.y); }
            break;
        case 'class': {
            const merged = classList(data.class).concat(classList(value));
            data.class = [...new Set(merged)].join(' ');
            break;
        }
        case 'tags':
            data.tags = [...new Set([].concat(data.tags || []).concat(value || []))].map(String);
            break;
        default:
            if (DATA_FIELDS.has(key)) data[key] = value;
            else {
                data.attrs = Object.assign({}, data.attrs || {});
                data.attrs[key] = value;
            }
        }
    }
    return data;
}

/**
 * Наследование: base — данные родителя, child — { overrides, add } плюс
 * необязательные поля, которые тоже считаются переопределениями.
 */
export function mergeSpec(base, child) {
    const out = dataToSpec(base) || {};
    if (!child || typeof child !== 'object') return out;
    const inline = {};
    for (const key of Object.keys(child)) {
        if (key === 'extend' || key === 'overrides' || key === 'add' || key === 'children') continue;
        inline[key] = child[key];
    }
    applyOverrides(out, inline);
    applyOverrides(out, child.overrides);
    const extra = [];
    if (Array.isArray(child.add)) extra.push(...child.add);
    if (Array.isArray(child.children)) extra.push(...child.children);
    if (extra.length) out.children = (out.children || []).concat(extra.map((c) => dataToSpec(c)));
    return out;
}

// ---------------------------------------------------------------------------
// Реестр и установка
// ---------------------------------------------------------------------------

const registry = new Map();       // имя → данные или функция (opts) => data

function resolveRegistered(name, opts, seen) {
    const key = String(name);
    const guard = seen || new Set();
    if (guard.has(key)) { warn(`циклическое наследование "${key}"`); return null; }
    if (!registry.has(key)) { warn(`неизвестный prefab "${key}"`); return null; }
    guard.add(key);
    const spec = registry.get(key);
    const raw = typeof spec === 'function' ? spec(opts || {}) : spec;
    let out;
    if (raw && typeof raw === 'object' && raw.extend !== undefined) {
        const base = resolveRegistered(String(raw.extend), opts, guard);
        out = base ? mergeSpec(base, raw) : null;
    } else {
        out = dataToSpec(raw);
    }
    guard.delete(key);
    return out;
}

function resolveInline(data, opts) {
    if (data && typeof data === 'object' && data.extend !== undefined) {
        const base = resolveRegistered(String(data.extend), opts, new Set());
        return base ? mergeSpec(base, data) : null;
    }
    return dataToSpec(data);
}

function markPrefab(node, name) {
    if (!node) return;
    prefab_names.set(node, name);
    for (const child of node.child_nodes || []) markPrefab(child, name);
}

function copyPrefabName(source, target) {
    const name = prefab_names.get(source);
    if (name) markPrefab(target, name);
}

function clearAllNodes() {
    for (const node of ctx.nodes.slice()) node.destroy();
    if (ctx.byId) {
        for (const [id, node] of [...ctx.byId.entries()]) if (node.removed) ctx.byId.delete(id);
    }
}

export function installPrefab($) {
    ensureHooks();

    const prefab = {
        // --- Запись/чтение ---------------------------------------------------
        /** Узел/селектор → данные (объект или массив для нескольких узлов). */
        save(nodeOrSelector) {
            ensureHooks();
            const nodes = resolveNodes(nodeOrSelector);
            if (nodes.length === 0) { warn('save: узел не найден'); return null; }
            if (nodes.length === 1) return nodeToData(nodes[0]);
            return nodes.map(nodeToData);
        },

        /** Данные → новые узлы. parent — узел/обёртка/селектор (по умолчанию мир). */
        load(data, parent) {
            ensureHooks();
            if (data instanceof Node || data instanceof Wrapper) data = toDataArg(data);
            const target = resolveParent(parent);
            if (Array.isArray(data)) return wrap(data.map((d) => loadOne(d, target)).filter(Boolean));
            const node = loadOne(data, target);
            return node ? wrapOne(node) : wrap([]);
        },

        // --- Именованные prefab ---------------------------------------------
        /**
         * Инстанцировать по имени или данным. opts: { x, y, parent, id, class,
         * overrides, count }. При count > 1 возвращается обёртка со всеми
         * копиями; id каждой следующей копии делается уникальным.
         */
        instantiate(nameOrData, opts) {
            ensureHooks();
            const o = opts || {};
            const named = typeof nameOrData === 'string';
            const asData = named ? null : toDataArg(nameOrData);
            const resolved = named ? resolveRegistered(nameOrData, o, new Set())
                : (asData !== null ? asData : resolveInline(nameOrData, o));
            if (!resolved) return wrap([]);
            // Данные одного узла или массив корней (save() от нескольких узлов).
            const list = Array.isArray(resolved) ? resolved : [resolved];

            const count = Math.max(1, Math.floor(num(o.count, 1)));
            const parent = resolveParent(o.parent);
            const roots = [];
            for (let i = 0; i < count; i++) {
                // Копию делаем всегда, включая первую: иначе uniquifyIds()
                // подправил бы id в самом зарегистрированном spec.
                const copies = dataToSpec(list);
                for (let j = 0; j < copies.length; j++) {
                    const copy = copies[j];
                    if (j === 0) {
                        // Смещение, id и overrides — только первому корню группы:
                        // иначе копии наложились бы друг на друга.
                        applyOverrides(copy, o.overrides);
                        if (o.class) applyOverrides(copy, { class: o.class });
                        if (o.x !== undefined) copy.x = num(o.x, copy.x);
                        if (o.y !== undefined) copy.y = num(o.y, copy.y);
                        if (o.id !== undefined) copy.id = String(o.id);
                    }
                    uniquifyIds(copy);
                    const node = applyData(copy, parent);
                    if (!node) continue;
                    if (named) markPrefab(node, nameOrData);
                    roots.push(node);
                }
            }
            return wrap(roots);
        },

        register(name, spec) {
            ensureHooks();
            const key = String(name);
            if (spec === null || spec === undefined) { warn('register: пустая спецификация'); return prefab; }
            if (typeof spec === 'function') registry.set(key, spec);
            else {
                const asData = toDataArg(spec);
                registry.set(key, asData !== null ? asData : dataToSpec(spec));
            }
            return prefab;
        },

        /** Разрешённые данные prefab (с учётом extend) или null. */
        get(name) {
            ensureHooks();
            return resolveRegistered(name, {}, new Set());
        },

        has(name) { return registry.has(String(name)); },
        list() { return [...registry.keys()]; },
        remove(name) { return registry.delete(String(name)); },
        clear() { registry.clear(); return prefab; },

        // --- Копирование -----------------------------------------------------
        /** Глубокая копия поддерева рядом с оригиналом (id не дублируется). */
        clone(nodeOrSelector) {
            ensureHooks();
            const out = [];
            for (const source of resolveNodes(nodeOrSelector)) out.push(cloneNode(source));
            return wrap(out);
        },

        // --- Файлы и сцены ---------------------------------------------------
        /** Сохранить узел под именем в $.store (и сразу на диск). */
        saveTo(name, nodeOrSelector) {
            const data = prefab.save(nodeOrSelector);
            if (!data) return null;
            if (ctx.store) {
                ctx.store.set('prefab:' + name, data);
                ctx.store.save();
            }
            return data;
        },

        /** Взять prefab из $.store (или prefabs/<name>.json) и инстанцировать. */
        loadFrom(name, opts) {
            ensureHooks();
            const data = readNamed('prefab:', name, 'prefabs/' + name + '.json');
            if (!data) { warn(`loadFrom: не нашёл prefab "${name}"`); return wrap([]); }
            const wrapper = prefab.instantiate(data, opts);
            for (const node of wrapper.nodes) markPrefab(node, String(name));
            return wrapper;
        },

        /** Сохранить весь мир (корневые узлы со всем поддеревом). */
        saveScene(name) {
            ensureHooks();
            const nodes = ctx.nodes.filter((n) => !n.removed && !n.parent_node).map(nodeToData);
            const data = { version: 1, name: String(name), nodes };
            if (ctx.store) {
                ctx.store.set('scene:' + name, data);
                ctx.store.save();
            }
            return data;
        },

        /** Восстановить мир из сцены. opts: { clear: true } — сначала очистить. */
        loadScene(name, opts) {
            ensureHooks();
            const data = readNamed('scene:', name, 'scenes/' + name + '.json');
            if (!data || !Array.isArray(data.nodes)) { warn(`loadScene: не нашёл сцену "${name}"`); return wrap([]); }
            if (opts && opts.clear) clearAllNodes();
            const roots = [];
            for (const raw of data.nodes) {
                const spec = dataToSpec(raw);
                if (!spec) continue;
                uniquifyIds(spec);
                const node = applyData(spec, null);
                if (node) roots.push(node);
            }
            return wrap(roots);
        },

        // --- Строки ----------------------------------------------------------
        toJSON(data) { return JSON.stringify(data === undefined ? null : data); },
        fromJSON(text) {
            try { return JSON.parse(text); }
            catch (e) { warn(`fromJSON: не разобрал JSON (${e})`); return null; }
        },
    };

    $.prefab = prefab;
    installNodeMethods($);
    // Wrapper.prototype.frames определяется в installNodeMethods уже ПОСЛЕ
    // нас, поэтому хук на листы ставим в ready — до ready-колбэков игры.
    if (typeof $.ready === 'function') $.ready(() => ensureHooks());
    return $;
}

function loadOne(data, parent) {
    const spec = dataToSpec(data);
    if (!spec) return null;
    uniquifyIds(spec);
    return applyData(spec, parent);
}

function cloneNode(source) {
    const data = nodeToData(source);
    if (!data) return null;
    uniquifyIds(data);
    const copy = applyData(data, source.parent_node || null);
    if (copy) copyPrefabName(source, copy);
    return copy;
}

/**
 * Делает уникальными id всего поддерева: и корня, и детей. Одного freshId()
 * для корня мало — у клона ребёнок с id 'gun' иначе столкнулся бы с живым
 * оригиналом. used — ids, уже выданные соседям по группе.
 */
export function uniquifyIds(data, used) {
    if (!data || typeof data !== 'object') return data;
    const taken = used || new Set();
    if (data.id !== undefined && data.id !== null && data.id !== '') {
        let id = freshId(data.id);
        if (taken.has(id)) {
            let n = 2;
            while (taken.has(id + n) || (ctx.byId && ctx.byId.has(id + n))) n++;
            id = id + n;
        }
        taken.add(id);
        data.id = id;
    }
    for (const child of data.children || []) uniquifyIds(child, taken);
    return data;
}

/** Имя prefab, из которого инстанцирован узел (или null). */
export function prefabOf(node) {
    return prefab_names.get(node) || null;
}

function readNamed(prefix, name, path) {
    if (ctx.store) {
        const key = prefix + name;
        if (ctx.store.has(key)) return ctx.store.get(key);
        try {
            ctx.store.load();
        } catch (e) {
            warn(`не смог прочитать $.store (${e})`);
        }
        if (ctx.store.has(key)) return ctx.store.get(key);
    }
    if (ctx.fs) return ctx.fs.readJSON(path, null);
    return null;
}

// ---------------------------------------------------------------------------
// Методы узла
// ---------------------------------------------------------------------------

function installNodeMethods($) {
    def('toData', function () {
        if (this.nodes.length === 0) return null;
        if (this.nodes.length === 1) return nodeToData(this.nodes[0]);
        return this.nodes.map(nodeToData);
    });

    // clone не занят (см. _CONTRACT.md §5), но рядом живёт явный псевдоним
    // prefabClone — на случай, если имя clone когда-нибудь займут.
    def('prefabClone', function () {
        const out = [];
        for (const node of this.nodes) {
            const copy = cloneNode(node);
            if (copy) out.push(copy);
        }
        return wrap(out);
    });
    def('clone', function () { return Wrapper.prototype.prefabClone.call(this); });

    def('savePrefab', function (name) {
        const node = this.nodes[0];
        if (!node) { warn('savePrefab: узел не найден'); return this; }
        $.prefab.register(name, nodeToData(node));
        return this;
    });

    defGet('prefab', (node) => prefab_names.get(node) || null, null);
}

/** Шаг кадра: лениво доставляет хук на Wrapper.prototype.frames. */
export function tickPrefab(dt) {
    void dt;
    ensureHooks();
}
