// ===========================================================================
// Ядро высокоуровневого API: $ — одна точка входа.
//
// Философия (engine_architecture.txt):
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
    log: (msg) => engine.log(msg),
};

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
        // Уже упакованный цвет либо 0..1 альфа — второе отсекаем по диапазону.
        return value;
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
    bullet:   { body: 'dynamic', w: 6, h: 6, hp: 1, gravity: false, sprite: null },

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

export class Node {
    constructor(tag, attrs) {
        const defaults = TAGS[tag] || {};
        this.uid = next_uid++;
        this.tag = tag;
        this.attrs = {};                 // всё, что не описано ниже
        this.classes = new Set();
        this.tags_extra = new Set();

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
        this.collision_mask = 0xffff;
        this.velocity_cache = { x: 0, y: 0 };

        // Здоровье
        this.max_hp = defaults.hp || 0;
        this.cur_hp = this.max_hp;
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

        // События
        this.listeners = new Map();
        this.data_store = new Map();

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
        this.applyInitial(attrs);

        // Тело создаётся сразу после применения атрибутов: у тегов вроде
        // <player>/<enemy>/<wall> оно подразумевается, а размеры и позиция уже
        // известны. Дальнейшие .at() и .size() тело просто переносят.
        if (defaults.body) this.syncBody();
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
        case 'gravity': this.gravity_on = value !== false;
                        this.no_gravity = !this.gravity_on && this.body >= 0; return this;
        case 'controls': this.attrs.controls = value; return this;
        case 'body':    this.setBody(value); return this;
        case 'collision': this.hitbox = Array.isArray(value) ? { w: value[0], h: value[1] } : { w: value, h: value }; return this;
        default:
            this.attrs[key] = value;
            return this;
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
        const i = ctx.nodes.indexOf(this);
        if (i >= 0) ctx.nodes.splice(i, 1);
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
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push(fn);
        return this;
    }

    off(name, fn) {
        if (!name) { this.listeners.clear(); return this; }
        if (!fn) { this.listeners.delete(name); return this; }
        const list = this.listeners.get(name);
        if (list) this.listeners.set(name, list.filter((f) => f !== fn));
        return this;
    }

    emit(name, data) {
        const list = this.listeners.get(name);
        if (list && list.length) {
            const event = makeEvent(this, name, data);
            for (const fn of list.slice()) {
                try { fn(event); } catch (e) { ctx.log(`$: ошибка в обработчике "${name}": ${e}`); }
                if (event.stopped) break;
            }
        }
        // Глобальные подписки: $('*').on(...) и $.on('entity:...').
        ctx.$._dispatchGlobal(this, name, data);
        return this;
    }

    // --- Классы и теги -----------------------------------------------------

    addClass(name) { String(name).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c)); return this; }
    removeClass(name) { String(name).split(/\s+/).filter(Boolean).forEach((c) => this.classes.delete(c)); return this; }
    toggleClass(name, force) {
        const has = this.classes.has(name);
        const want = force === undefined ? !has : !!force;
        if (want) this.classes.add(name); else this.classes.delete(name);
        return this;
    }
    hasClass(name) { return this.classes.has(name); }
    addTag(name) { this.tags_extra.add(name); return this; }
    removeTag(name) { this.tags_extra.delete(name); return this; }

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
export function wrapOne(node) { return new Wrapper([node]); }

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

export function registerSelector(name, fn) { custom_selectors.set(name, fn); }

function matchesSelector(node, sel) {
    if (!sel || sel === '*') return true;
    sel = sel.trim();

    // Комбинирование через запятую живёт в query(), здесь — один терм.
    // Атрибутные условия: [hp<20], [team=1], [speed>100].
    const attrMatch = /\[([a-zA-Z_][\w.]*)\s*(<=|>=|!=|=|<|>)\s*([^\]]+)\]/.exec(sel);
    if (attrMatch) {
        const [, key, op, rawValue] = attrMatch;
        const actual = readAttr(node, key);
        const wanted = /^-?\d+(\.\d+)?$/.test(rawValue) ? parseFloat(rawValue) : rawValue.replace(/^['"]|['"]$/g, '');
        switch (op) {
        case '=':  if (actual != wanted) return false; break;
        case '!=': if (actual == wanted) return false; break;
        case '<':  if (!(actual < wanted)) return false; break;
        case '>':  if (!(actual > wanted)) return false; break;
        case '<=': if (!(actual <= wanted)) return false; break;
        case '>=': if (!(actual >= wanted)) return false; break;
        }
    }

    // Псевдоклассы.
    const pseudo = /:([a-zA-Z][\w]*)(\(([^)]*)\))?/.exec(sel);
    if (pseudo) {
        const [, pname, , parg] = pseudo;
        switch (pname) {
        case 'alive':   if (!(node.cur_hp > 0 && !node.removed)) return false; break;
        case 'dead':    if (!(node.cur_hp <= 0 || node.removed)) return false; break;
        case 'visible': if (!node.visible) return false; break;
        case 'hidden':  if (node.visible) return false; break;
        case 'onScreen': if (!ctx.camera || !ctx.camera.isOnScreen(node)) return false; break;
        case 'offScreen': if (ctx.camera && ctx.camera.isOnScreen(node)) return false; break;
        case 'paused':  if (!(ctx.time && ctx.time.isPaused())) return false; break;
        case 'picked':  if (!node.hovered) return false; break;
        case 'first':   if (ctx.nodes.indexOf(node) !== 0) return false; break;
        case 'last':    if (ctx.nodes.indexOf(node) !== ctx.nodes.length - 1) return false; break;
        case 'even':    if (ctx.nodes.indexOf(node) % 2 !== 0) return false; break;
        case 'odd':     if (ctx.nodes.indexOf(node) % 2 === 0) return false; break;
        case 'eq':      if (ctx.nodes.indexOf(node) !== parseInt(parg, 10)) return false; break;
        case 'has':     if (!node.child_nodes.some((c) => matchesSelector(c, parg))) return false; break;
        case 'parent':  if (node.child_nodes.length === 0) return false; break;
        case 'empty':   if (node.child_nodes.length !== 0) return false; break;
        case 'not':     if (matchesSelector(node, parg)) return false; break;
        default: {
            const custom = custom_selectors.get(':' + pname);
            if (custom && !custom(node, parg)) return false;
            break;
        }
        }
    }

    const cleaned = sel.replace(/\[[^\]]*\]/g, '').replace(/:[a-zA-Z][\w]*(\([^)]*\))?/g, '');
    if (!cleaned) return true;

    for (const part of cleaned.split(/(?=[.#])/)) {
        if (!part) continue;
        if (part[0] === '#') {
            if (ctx.byId.get(part.slice(1)) !== node) return false;
        } else if (part[0] === '.') {
            if (!node.classes.has(part.slice(1))) return false;
        } else {
            const tag = part.split('.').filter((s) => s && s[0] !== '.');
            if (tag.length && node.tag !== tag[0]) return false;
            for (const cls of part.split('.').slice(1)) {
                if (cls && !node.classes.has(cls)) return false;
            }
        }
    }
    return true;
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
    if (sel === '*') return ctx.nodes.slice();

    const result = [];
    const seen = new Set();
    for (const branch of sel.split(',')) {
        const trimmed = branch.trim();
        if (!trimmed) continue;
        for (const node of querySingle(trimmed)) {
            if (!seen.has(node)) { seen.add(node); result.push(node); }
        }
    }
    return result;
}

function querySingle(sel) {
    // Разбиваем на «прямой потомок» и «любой потомок»: '#hero .weapon' и
    // '#hero > .weapon'.
    const parts = sel.split(/\s*(>)\s*|\s+/).filter((s) => s !== undefined && s !== '');
    if (parts.length === 1) return ctx.nodes.filter((n) => matchesSelector(n, parts[0]));

    let current = ctx.nodes.filter((n) => matchesSelector(n, parts[0]));
    let direct = false;
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (part === '>') { direct = true; continue; }
        const next = [];
        for (const node of current) {
            const pool = direct ? node.child_nodes : descendants(node);
            for (const child of pool) if (matchesSelector(child, part)) next.push(child);
        }
        current = next;
        direct = false;
    }
    return current;
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
let dot_sprite = -1;

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
        if (!sprite_cache.has(key)) sprite_cache.set(key, engine.createSprite(value[0], value[1], value[2], value[3], value[4]));
        return sprite_cache.get(key);
    }
    if (typeof value === 'string') {
        if (sprite_cache.has('path:' + value)) return sprite_cache.get('path:' + value);
        let id = engine.loadTexture(value);
        if (id < 0) {
            ctx.log(`$: не удалось загрузить "${value}"`);
            sprite_cache.set('path:' + value, -1);
            return -1;
        }
        id = engine.createSprite(id, 0, 0, 0, 0);
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
            frames.push(engine.createSprite(tex, c * spec.cw, r * spec.ch, spec.cw, spec.ch));
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

export function spriteSize(id) {
    if (id < 0) return [0, 0];
    for (const entry of sprite_cache.values()) {
        const frames = Array.isArray(entry) ? entry : null;
        if (frames) continue;
    }
    return [0, 0];
}

export function textureSizeOf(path) {
    const tex = texture_cache.get(path) || engine.loadTexture(path);
    texture_cache.set(path, tex);
    return engine.textureSize(tex);
}

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
