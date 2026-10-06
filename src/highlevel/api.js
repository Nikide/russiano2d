// ===========================================================================
// Сборка высокоуровневого API.
//
// Здесь $ получает: мир, камеру, ввод, звук, сцены, интерфейс, сохранения,
// отладку, агента — и весь набор цепочных методов узла. Игра видит только $.
//
//   $.ready(() => {
//     $('<player>', { id: 'hero' }).at(100, 200).controls('wasd').appendTo($.world);
//   });
// ===========================================================================

import {
    ctx, Node, Wrapper, TAGS, wrap, wrapOne, query, def, defGet,
    packColor, withAlpha, registerSelector, nodeBounds, boundsOverlap,
    makeRandom, dotSprite, resolveSprite, sheetFrames,
} from './core.js';
import { installWorld } from './world.js';
import { installCamera } from './camera.js';
import { installTime, tickTime } from './time.js';
import { installInput, installControls, shiftDown, ctrlDown, altDown } from './input.js';
import { installSound } from './sound.js';
import { installScene } from './scene.js';
import { installUi } from './ui.js';
import { installDebug } from './debug.js';
import { createLoading } from './loading.js';
import { installGfx } from './render.js';
import { installStore } from './store.js';
import { installAgent } from './agent.js';
import { installWindow, tickWindow } from './window.js';
import { tweenProps, clearNodeTweens, pauseNodeTweens, shakeNode, flashNode, sequence, wait, activeTweenCount, easeFunction, installTween } from './tween.js';

// --- Подсистемы, добавленные после аудита API (docs/GAP_ANALYSIS.md) --------
// Каждый модуль сам регистрирует свои теги, методы и отрисовщики; api.js
// только ставит их и вызывает tick в кадровом цикле. Порядок установки
// важен: модули пользуются уже готовыми $.world/$.gfx/$.input.
import { installAnim, tickAnim } from './anim.js';
import { installTilemap, tickTilemap } from './tilemap.js';
import { installParticles, tickParticles } from './particles.js';
import { installFx, tickFx } from './fx.js';
import { installNav, tickNav } from './nav.js';
import { installPrefab, tickPrefab } from './prefab.js';
import { installAudiobus, tickAudiobus } from './audiobus.js';
import { installAcoustics, tickAcoustics } from './acoustics.js';
import { installLayers, tickLayers } from './layers.js';
import { installWidgets, tickWidgets } from './widgets.js';
import { installTriggers, tickTriggers, watchOverlap } from './triggers.js';
import { installI18n, tickI18n } from './i18n.js';
import { installPool, tickPool } from './pool.js';
import { installViewport, tickViewport } from './viewport.js';
import { installHttp, tickHttp } from './http.js';

// ---------------------------------------------------------------------------
// Кадровые хуки
// ---------------------------------------------------------------------------

// Режимы смешивания, которые понимает конвейер (см. render.c).
// Порядок строк — это порядок конвейеров в C, менять синхронно.
const BLEND_MODES = new Set(['alpha', 'add', 'multiply', 'none']);

const frame = {
    ready: [],
    update: [],
    render: [],
    exit: [],
    started: false,
    running: true,
};

const globals = new Map();   // имя события → [обработчики]

/**
 * Общий код .frames() и $('<sprite>', { frames }) — один источник правды.
 * Лист задаётся как { src, cols, rows, cw, ch }. Живёт на уровне модуля,
 * потому что нужен и фабрике узлов, и методам узла (разные области видимости).
 */
function applyFrames(node, spec) {
    if (spec && spec.src) {
        resolveSprite(spec);
        node.frames = sheetFrames(spec);
        if (node.frames) node.setSprite(node.frames[0]);
        node.anim = null;
        node.attrs.src = spec.src;
    } else if (Array.isArray(spec)) {
        node.frames = spec;
    }
}

// ---------------------------------------------------------------------------
// Создание API
// ---------------------------------------------------------------------------

export function createApi() {
    const $ = function (arg, attrs) {
        if (typeof arg === 'function') { $.ready(arg); return wrap([]); }
        if (arg === undefined || arg === null || arg === false) return wrap([]);
        if (arg instanceof Wrapper) return arg;
        if (arg instanceof Node) return wrapOne(arg);
        if (Array.isArray(arg)) return wrap(arg.filter((n) => n instanceof Node));

        if (typeof arg === 'string') {
            const tag = /^\s*<([^>]+)>\s*$/.exec(arg);
            if (tag) {
                const name = tag[1].trim();
                if (!TAGS[name]) ctx.log(`$: неизвестный тег <${name}> — создаю пустой узел`);
                const node = new Node(name, attrs);
                // { frames } в конструкторе делал бы то же, что .frames():
                // без этого лист молча превращался в обычный атрибут.
                if (attrs && attrs.frames !== undefined) applyFrames(node, attrs.frames);
                return wrapOne(node);
            }
            return wrap(query(arg));
        }
        if (arg && arg.nodes) return arg;
        return wrap([]);
    };

    $._wrapper = Wrapper;
    $._node = Node;
    ctx.$ = $;
    // Подсистемы (например $.window.on) сообщают об ошибках игрового кода
    // сюда: reportError печатает стек, а не только текст.
    ctx.reportError = reportError;

    // --- Подсистемы ---------------------------------------------------------
    installWorld($);
    installCamera($);
    installTime($);
    installInput($);
    installSound($);
    installScene($);
    installUi($);
    installGfx($);
    installStore($);
    installDebug($);
    installWindow($);
    installAgent($);

    // Экран загрузки: полноэкранная панель с полосой прогресса для смены сцен
    // и построения мира.
    ctx.loading = createLoading(ctx);
    $.loading = ctx.loading;

    $.world = ctx.world;
    $.camera = ctx.camera;
    $.input = ctx.input;
    $.sound = ctx.sound;
    $.scene = ctx.scene;
    $.ui = ctx.ui;
    $.gfx = ctx.gfx;
    $.fs = ctx.fs;
    $.store = ctx.store;
    $.debug = ctx.debug;
    $.console = ctx.console;
    $.agent = ctx.agent;
    $.test = ctx.test;
    $.time = ctx.time;
    $.logger = ctx.log;
    $.easing = easeFunction;
    $.random = makeRandom(engine.seed === undefined ? 12345 : engine.seed);
    $.ctx = ctx;

    // --- Глобальные события --------------------------------------------------
    $.on = function (name, fn) {
        if (!globals.has(name)) globals.set(name, []);
        globals.get(name).push(fn);
        return $;
    };
    $.off = function (name, fn) {
        if (!name) { globals.clear(); return $; }
        if (!fn) { globals.delete(name); return $; }
        globals.set(name, (globals.get(name) || []).filter((f) => f !== fn));
        return $;
    };
    $.emit = function (name, data) {
        dispatchGlobal(null, name, data);
        return $;
    };

    $._dispatchGlobal = dispatchGlobal;
    $.selectors = {
        /** $.selectors[':boss'] = (node) => node.attrs.rank === 'boss'; */
        register(name, fn) { registerSelector(name, fn); return $; },
    };

    // --- Хуки игры -----------------------------------------------------------
    // ВАЖНО: $.ready/$.update/$.render/$.exit определяются здесь, то есть
    // ПОСЛЕ установки подсистем. Подсистема, которая подписывается через них
    // прямо в install*(), получит undefined — так уже ломалось дважды
    // ($.window). Для покадровой работы используйте tick-функцию на манер
    // tickTime/tickWindow и вызывайте её из цикла ниже.
    $.ready = (fn) => { frame.ready.push(fn); return $; };
    $.update = (fn) => { frame.update.push(fn); return $; };

    $.render = (fn) => { frame.render.push(fn); return $; };
    $.exit = (fn) => { frame.exit.push(fn); return $; };
    $.fn = Wrapper.prototype;

    // --- Утилиты --------------------------------------------------------------
    $.color = (value, alpha) => packColor(value, alpha);
    $.alpha = (color, alpha) => withAlpha(color, alpha);
    $.vec = (x, y) => ({ x: x || 0, y: y || 0 });
    $.log = (...args) => ctx.log(args.map(String).join(' '));
    $.now = () => ctx.time.now();
    $.wait = (ms) => wait(ms);
    $.sequence = (steps) => sequence(steps);
    $.find = (sel) => query(sel);
    $.count = (sel) => query(sel).length;
    $.isAgent = () => !!engine.agent;
    $.quit = () => engine.quit();

    // --- Подсистемы после аудита API ------------------------------------------
    // Ставятся здесь, а не рядом с остальными install*(): им нужны готовые
    // $.world/$.gfx/$.input/$.fn и определённые выше $.ready/$.update.
    installAnim($);
    installTilemap($);
    installParticles($);
    installFx($);
    installNav($);
    installPrefab($);
    installAudiobus($);
    installAcoustics($);
    installLayers($);
    installWidgets($);
    installTriggers($);
    installI18n($);
    installPool($);
    installViewport($);
    installHttp($);

    // --- Методы узлов ---------------------------------------------------------
    installNodeMethods($);
    // Tween-объекты (Godot-стиль) — после методов узлов: им нужны $.fn и $.time.
    installTween($);
    installFrameHooks($);
    return $;
}

function dispatchGlobal(node, name, data) {
    const event = {
        self: node ? wrapOne(node) : null,
        target: node ? wrapOne(node) : null,
        source: node ? wrapOne(node) : null,
        name,
        type: name,
        data: data === undefined ? {} : data,
        dt: engine.dt,
        frame: engine.frame,
        stopped: false,
        stop() { this.stopped = true; },
        preventDefault() {},
    };
    const fire = (list) => {
        for (const fn of (list || []).slice()) {
            try { fn(event); } catch (e) { ctx.log(`$: ошибка в $.on("${name}"): ${e}`); }
            if (event.stopped) return;
        }
    };
    fire(globals.get(name));
    if (!event.stopped && node) {
        fire(globals.get('entity:' + name));
        if (node.tag) fire(globals.get('entity:' + node.tag + ':' + name));
    }
    if (!event.stopped) fire(globals.get('*'));
}

// ---------------------------------------------------------------------------
// Цепочные методы узлов
// ---------------------------------------------------------------------------

function installNodeMethods($) {
    // === Коллекция ==========================================================

    def('each', function (fn) {
        this.nodes.forEach((node, i) => fn.call(this, i, wrapOne(node)));
        return this;
    });
    def('map', function (fn) {
        return this.nodes.map((node, i) => fn.call(this, i, wrapOne(node)));
    });
    def('filter', function (what) {
        if (typeof what === 'function') return wrap(this.nodes.filter((n, i) => what.call(this, i, wrapOne(n))));
        return wrap(this.nodes.filter((n) => n.matches(what)));
    });
    def('not', function (what) {
        if (typeof what === 'function') return wrap(this.nodes.filter((n, i) => !what.call(this, i, wrapOne(n))));
        return wrap(this.nodes.filter((n) => !n.matches(what)));
    });
    def('first', function () { return this.eq(0); });
    def('last', function () { return this.eq(this.nodes.length - 1); });
    def('slice', function (a, b) { return wrap(this.nodes.slice(a, b)); });
    def('add', function (sel) {
        const extra = (sel instanceof Wrapper) ? sel.nodes : (typeof sel === 'string' ? query(sel) : []);
        const seen = new Set(this.nodes);
        const out = this.nodes.slice();
        for (const n of extra) if (!seen.has(n)) { seen.add(n); out.push(n); }
        return wrap(out);
    });
    def('is', function (sel) { return this.nodes.length > 0 && this.nodes.every((n) => n.matches(sel)); });
    def('has', function (sel) {
        return this.nodes.some((n) => query(sel).some((c) => c === n || isDescendant(n, c)));
    });
    def('every', function (fn) { return this.nodes.every((n, i) => fn.call(this, i, wrapOne(n))); });
    def('some', function (fn) { return this.nodes.some((n, i) => fn.call(this, i, wrapOne(n))); });
    def('reduce', function (fn, init) {
        let acc = init;
        this.nodes.forEach((n, i) => { acc = fn(acc, wrapOne(n), i); });
        return acc;
    });

    // === Трансформ ==========================================================

    def('at', function (x, y) {
        if (typeof x === 'object' && x !== null) { y = x.y; x = x.x; }
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.x = x;
            node.y = y;
            if (node.body >= 0) engine.setPosition(node.body, x, y, node.angle);
        });
    });

    def('move', function (dx, dy) {
        if (typeof dx === 'object') { dy = dx.y; dx = dx.x; }
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.x += dx; node.y += dy;
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });

    def('moveTo', function (x, y, ms, ease) {
        if (typeof x === 'object') { ease = ms; ms = y; y = x.y; x = x.x; }
        if (typeof x === 'string' || (x && x.tag) || x instanceof Wrapper) {
            // .moveTo('#hero', speed) — двигаться к цели с этой скоростью.
            return this.each((_, el) => stepTowards(el.nodes ? el.nodes[0] : el, x, y));
        }
        if (!(ms > 0)) return this.at(x, y);
        const promises = [];
        this.each((_, el) => promises.push(tweenProps(el.nodes ? el.nodes[0] : el, { x, y }, ms, ease)));
        // Promise разрешается тем же набором узлов: удобно продолжать цепочку
        // после ожидания (.moveTo(...).then(w => w.fadeOut(200))).
        return Promise.all(promises).then(() => this);
    });

    defGet('pos', (node) => ({ x: node.x, y: node.y }), { x: 0, y: 0 });
    defGet('globalPos', (node) => (ctx.camera ? ctx.camera.worldToScreen(node) : { x: node.x, y: node.y }), { x: 0, y: 0 });
    // .size() без аргументов — размер, с аргументами — сеттер. Так же ведут
    // себя .width() и .height(): геттер при вызове без значения.
    def('size', function (w, h) {
        if (w === undefined) {
            const node = this.nodes[0];
            return node ? { w: node.w, h: node.h } : { w: 0, h: 0 };
        }
        if (typeof w === 'object') { h = w.h; w = w.w; }
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.w = w;
            node.h = h === undefined ? w : h;
            if (node.body >= 0) node.syncBodySize();
        });
    });
    def('width', function (value) {
        if (value === undefined) return this.nodes.length ? this.nodes[0].w : 0;
        return this.each((_, el) => { const n = el.nodes ? el.nodes[0] : el; n.w = value; if (n.body >= 0) n.syncBodySize(); });
    });
    def('height', function (value) {
        if (value === undefined) return this.nodes.length ? this.nodes[0].h : 0;
        return this.each((_, el) => { const n = el.nodes ? el.nodes[0] : el; n.h = value; if (n.body >= 0) n.syncBodySize(); });
    });

    def('rotate', function (deg) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.angle = (node.angle || 0) + deg * Math.PI / 180;
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });
    def('angle', function (rad) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.angle = rad;
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });
    defGet('rotation', (n) => n.angle, 0);

    def('scale', function (sx, sy) {
        if (typeof sx === 'object') { sy = sx.y; sx = sx.x; }
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.scale_x = sx;
            node.scale_y = sy === undefined ? sx : sy;
        });
    });

    def('lookAt', function (target) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            const p = resolvePoint(target);
            node.angle = Math.atan2(p.y - node.y, p.x - node.x);
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });

    def('flip', function (x, y) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (x !== undefined) node.scale_x = Math.abs(node.scale_x) * (x ? -1 : 1);
            if (y !== undefined) node.scale_y = Math.abs(node.scale_y) * (y ? -1 : 1);
        });
    });

    def('depth', function (z) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).depth = z; }); });
    def('layer', function (n) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).layer = n; }); });

    defGet('distanceTo', function (node, target) {
        const p = resolvePoint(target);
        return Math.hypot(p.x - node.x, p.y - node.y);
    }, 0);

    defGet('directionTo', function (node, target) {
        const p = resolvePoint(target);
        const d = Math.hypot(p.x - node.x, p.y - node.y) || 1;
        return { x: (p.x - node.x) / d, y: (p.y - node.y) / d };
    }, { x: 0, y: 0 });

    defGet('angleTo', function (node, target) {
        const p = resolvePoint(target);
        return Math.atan2(p.y - node.y, p.x - node.x);
    }, 0);

    defGet('rayTo', function (node, target) {
        const p = resolvePoint(target);
        return ctx.world.raycast({ x: node.x, y: node.y }, p);
    }, null);

    defGet('toGlobal', function (node, local) {
        if (!ctx.camera) return { x: node.x + (local.x || 0), y: node.y + (local.y || 0) };
        return ctx.camera.worldToScreen({ x: node.x + (local.x || 0), y: node.y + (local.y || 0) });
    }, { x: 0, y: 0 });

    defGet('toLocal', function (node, global) {
        const w = ctx.camera ? ctx.camera.screenToWorld(global) : global;
        return { x: w.x - node.x, y: w.y - node.y };
    }, { x: 0, y: 0 });

    // === Визуал =============================================================

    def('sprite', function (value) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.setSprite(value);
            // Лист-объект задаёт ещё и набор кадров: иначе .frame(n) и
            // .animate() молча ничего не делали бы (кадры брать неоткуда).
            if (value && typeof value === 'object' && value.src) {
                resolveSprite(value);                 // наполняет кэш листа
                node.frames = sheetFrames(value);
                node.attrs.src = value.src;
            } else if (typeof value === 'string') {
                // .region() читает путь из attrs.src: без синхронизации
                // .sprite(path).region(...) молча ничего не вырезал.
                node.attrs.src = value;
            } else if (value === null || value === undefined) {
                delete node.attrs.src;
            }
        });
    });
    def('frames', function (spec) {
        return this.each((_, el) => applyFrames(el.nodes ? el.nodes[0] : el, spec));
    });
    def('region', function (x, y, w, h) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.attrs.src) node.sprite = engine.createSprite(engine.loadTexture(node.attrs.src), x, y, w, h);
        });
    });
    def('frame', function (index) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.frames && node.frames[index] !== undefined) node.sprite = node.frames[index];
        });
    });

    /** Анимация по кадрам листа: .animate({ from: 0, to: 5, speed: 12, loop: true }) */
    def('animate', function (spec) {
        const cfg = typeof spec === 'object' ? spec : { name: spec };
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (!node.frames) {
                ctx.log('$: .animate() — у узла нет кадров; используйте .frames({src, cols, rows, cw, ch})');
                return;
            }
            node.anim = {
                from: cfg.from === undefined ? 0 : cfg.from,
                to: cfg.to === undefined ? node.frames.length - 1 : cfg.to,
                speed: cfg.speed === undefined ? 10 : cfg.speed,
                loop: cfg.loop !== false,
                t: 0,
                playing: true,
            };
        });
    });
    def('stopAnim', function () { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).anim = null; }); });
    def('playing', function (v) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.anim) node.anim.playing = v !== false;
        });
    });

    def('color', function (value) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).color = packColor(value); }); });
    def('alpha', function (value) {
        if (value === undefined) return this.nodes.length ? this.nodes[0].alpha : 0;
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).alpha = Math.max(0, Math.min(1, value)); });
    });
    def('opacity', function (value) { return Wrapper.prototype.alpha.call(this, value); });

    def('visible', function (flag) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).visible = flag !== false; }); });
    def('show', function () { return this.visible(true); });
    def('hide', function () { return this.visible(false); });
    defGet('isVisible', (n) => n.visible, false);

    def('fadeIn', function (ms) { return this.fadeTo(1, ms); });
    def('fadeOut', function (ms) { return this.fadeTo(0, ms); });

    /** Режим смешивания узла: 'alpha' | 'add' | 'multiply' | 'none'. */
    def('blend', function (mode) {
        if (mode === undefined) return this.nodes.length ? (this.nodes[0].blend_mode || 'alpha') : 'alpha';
        const known = BLEND_MODES.has(mode);
        if (!known && !Wrapper.prototype.blend.warned) {
            Wrapper.prototype.blend.warned = true;
            ctx.log(`$: .blend("${mode}") — неизвестный режим; доступны: alpha, add, multiply, none`);
        }
        return this.each((_, el) => {
            (el.nodes ? el.nodes[0] : el).blend_mode = known ? mode : 'alpha';
        });
    });
    def('shader', function (path) {
        if (!Wrapper.prototype.shader.warned) {
            Wrapper.prototype.shader.warned = true;
            ctx.log(`$: .shader("${path}") — свои шейдеры на узел движок не поддерживает (пайплайн общий); вызов проигнорирован`);
        }
        return this;
    });
    def('shaderParam', function () { return this; });

    def('outline', function (width, color) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.outline = { width: width || 2, color: packColor(color) };
        });
    });
    def('shadow', function (opts) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.shadow = Object.assign({ x: 4, y: 4, color: 'rgba(0,0,0,0.4)', blur: 0 }, opts || {});
            node.shadow.color_packed = packColor(node.shadow.color);
        });
    });

    // === Физика ==============================================================

    def('velocity', function (vx, vy) {
        if (vx === undefined) {
            const node = this.nodes[0];
            return node && node.body >= 0 ? vectorOf(engine.getVelocity(node.body)) : { x: 0, y: 0 };
        }
        if (typeof vx === 'object') { vy = vx.y; vx = vx.x; }
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.body >= 0) engine.setVelocity(node.body, vx, vy);
            node.velocity_cache = { x: vx, y: vy };
        });
    });

    def('applyForce', function (fx, fy) {
        // Box2D v3 в обёртке движка отдаёт только импульс — для 2D этого хватает:
        // сила = импульс / dt, чтобы поведение совпадало по ощущениям.
        const k = 1 / Math.max(engine.dt, 1 / 240);
        return Wrapper.prototype.applyImpulse.call(this, fx * k * 0.02, fy * k * 0.02);
    });

    def('applyImpulse', function (ix, iy) {
        if (typeof ix === 'object') { iy = ix.y; ix = ix.x; }
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.body >= 0) engine.applyImpulse(node.body, ix, iy);
        });
    });

    def('gravity', function (on) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.gravity_on = on !== false;
            node.no_gravity = false;
            if (node.body >= 0) engine.setGravityScale(node.body, node.gravity_on ? 1 : 0);
        });
    });

    def('body', function (kind) {
        // kind === null — «без тела»: запоминаем запрет, чтобы узел не получил
        // тело обратно из TAGS при следующем пересчёте размера.
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).setBody(kind); });
    });

    def('collision', function (w, h) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.hitbox = { w, h: h === undefined ? w : h };
            if (node.body >= 0) node.syncBodySize();
        });
    });

    def('collisionCircle', function (r) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.circle_hitbox = r;
            node.hitbox = { w: r * 2, h: r * 2 };
            // Круг — это форма круга, а не «квадрат с нарисованным кругом»:
            // так он честно катится и не цепляется углами.
            node.shape_kind = 'circle';
            if (node.body >= 0) node.syncBodySize();
        });
    });

    /** Форма тела: 'box' | 'circle' | 'capsule' | 'polygon'. */
    def('shape', function (kind, extra) {
        if (kind === undefined) return this.nodes.length ? this.nodes[0].shape_kind : null;
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.shape_kind = kind;
            if (kind === 'polygon' && extra) node.poly_points = Array.isArray(extra) ? extra.slice() : null;
            if (kind === 'capsule' && extra) node.circle_hitbox = extra;
            if (node.body >= 0) node.syncBodySize();
        });
    });

    /**
     * Односторонняя платформа: тело проходит сквозь неё снизу и встаёт
     * сверху. angle — куда смотрит лицевая сторона (по умолчанию вверх).
     */
    def('oneWay', function (on, angle) {
        if (on === undefined) return this.nodes.length ? this.nodes[0].one_way : false;
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.one_way = on !== false;
            if (angle !== undefined) node.one_way_angle = angle;
            if (node.body >= 0) node.syncBodySize();
        });
    });

    /** Сенсор: тело ловит пересечения, но не отталкивает. */
    def('sensor', function (on) {
        if (on === undefined) return this.nodes.length ? this.nodes[0].sensor : false;
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.sensor = on !== false;
            if (node.body >= 0) node.syncBodySize();
        });
    });

    /**
     * События контакта узла: 'collide' (начали касаться), 'separate'
     * (перестали), 'hit' (удар со скоростью). У динамических тел включены
     * сразу; этим методом можно включить и выключить вручную.
     */
    def('contacts', function (on) {
        if (on === undefined) return this.nodes.length ? this.nodes[0].contacts_enabled : false;
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.contacts_enabled = on !== false;
            if (node.body >= 0) node.syncBodySize();
        });
    });

    /**
     * Сустав между этим узлом и другим. opts:
     *   { type: 'revolute'|'distance'|'weld', a: [x,y], b: [x,y],
     *     collide, length, limit, lower, upper, motor, motorSpeed, maxTorque }
     * Возвращает id сустава (или -1) — его можно уничтожить через
     * $.world.destroyJoint(id).
     */
    def('joint', function (other, opts) {
        const self = this.nodes[0];
        const target = typeof other === 'string' ? query(other)[0]
            : (other instanceof Wrapper ? other.nodes[0] : other);
        if (!self || !target) { ctx.log('$.joint: нужен второй узел (узел, обёртка или селектор)'); return -1; }
        if (self.body < 0 || target.body < 0) {
            ctx.log('$.joint: у обоих узлов должно быть физическое тело');
            return -1;
        }
        const o = opts || {};
        const a = o.a || [self.x, self.y];
        // Для шарнира и сварки вторая точка по умолчанию совпадает с первой:
        // обе стороны крепятся в ОДНУ мировую точку. Для distance наоборот —
        // стержень между центрами, иначе длина окажется нулевой.
        const b = o.b || ((o.type === 'distance') ? [target.x, target.y] : a);
        const id = engine.createJoint({
            type: o.type || 'revolute',
            a: self.body, b: target.body,
            ax: a[0], ay: a[1], bx: b[0], by: b[1],
            collide: !!o.collide,
            length: o.length || 0,
            limit: !!o.limit, lower: o.lower || 0, upper: o.upper || 0,
            motor: !!o.motor, motorSpeed: o.motorSpeed || 0, maxTorque: o.maxTorque || 0,
        });
        if (id < 0) ctx.log('$: сустав создать не удалось');
        return id;
    });

    def('mask', function () { return this; });
    def('layerBits', function () { return this; });
    def('collidesWith', function () { return this; });

    /**
     * Стоит ли узел на земле. Луч идёт из центра узла вниз: начинать его у
     * самой нижней грани нельзя — тело узла тогда лежит внутри опоры, а
     * Box2D для луча «игнорирует начальное перекрытие» и ничего не находит.
     * Старт из центра заодно исключает попадание в самого себя.
     */
    defGet('onFloor', function (node) {
        const b = nodeBounds(node);
        const hit = ctx.world.raycast({ x: node.x, y: node.y }, { x: node.x, y: b.y1 + 8 });
        return hit !== null && hit.body !== node.body;
    }, false);

    /** Касается ли стены слева или справа — луч тоже из центра узла. */
    defGet('onWall', function (node) {
        const b = nodeBounds(node);
        const left = ctx.world.raycast({ x: node.x, y: node.y }, { x: b.x0 - 8, y: node.y });
        const right = ctx.world.raycast({ x: node.x, y: node.y }, { x: b.x1 + 8, y: node.y });
        return !!((left && left.body !== node.body) || (right && right.body !== node.body));
    }, false);

    /** Двигаться в сторону цели со скоростью. dt не нужен: скорость в px/с. */
    def('moveTowards', function (target, speed) {
        return this.each((_, el) => stepTowards(el.nodes ? el.nodes[0] : el, target, speed));
    });

    /** В Box2D скольжение вдоль стен делает сам решатель — метод задаёт скорость. */
    def('moveAndSlide', function (vx, vy) {
        if (typeof vx === 'object') { vy = vx.y; vx = vx.x; }
        return Wrapper.prototype.velocity.call(this, vx, vy);
    });

    def('jump', function (force) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.body < 0) return;
            const [, vy] = engine.getVelocity(node.body);
            engine.setVelocity(node.body, engine.getVelocity(node.body)[0],
                               -(force === undefined ? 640 : force) + Math.min(0, vy));
            node.emit('jump', { force });
        });
    });

    // === Здоровье ============================================================

    def('health', function (value) {
        if (value === undefined) return this.nodes[0] ? this.nodes[0].cur_hp : 0;
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.max_hp = value;
            node.cur_hp = value;
            node.attrs.on_ground = value > 0;
        });
    });

    def('hp', function (value) {
        if (value === undefined) return this.nodes[0] ? this.nodes[0].cur_hp : 0;
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.max_hp <= 0) node.max_hp = Math.max(value, 1);
            node.cur_hp = Math.max(0, value);
        });
    });

    def('maxHp', function (value) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).max_hp = value; }); });

    def('damage', function (amount, source) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (node.iframes > 0 || node.cur_hp <= 0) return;
            node.cur_hp = Math.max(0, node.cur_hp - amount);
        });
    });

    def('heal', function (amount) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.cur_hp = Math.min(node.max_hp, node.cur_hp + amount);
        });
    });

    def('kill', function () {
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).cur_hp = 0; });
    });

    def('respawn', function (x, y) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            node.cur_hp = node.max_hp;
            if (x !== undefined) {
                node.x = x; node.y = y;
                if (node.body >= 0) { engine.setPosition(node.body, x, y, 0); engine.setVelocity(node.body, 0, 0); }
            }
        });
    });

    defGet('alive', (n) => n.cur_hp > 0 && !n.removed, false);
    def('team', function (id) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).team = id; }); });
    def('invulnerable', function (ms) {
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).iframes = (ms || 0) / 1000; });
    });

    // === События =============================================================

    def('on', function (name, fn) {
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).on(name, fn); });
    });
    def('off', function (name, fn) {
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).off(name, fn); });
    });
    def('emit', function (name, data) {
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).emit(name, data); });
    });
    def('trigger', function (name, data) { return Wrapper.prototype.emit.call(this, name, data); });

    // === Твины ===============================================================

    def('tween', function (spec, ms, ease) {
        const promises = [];
        this.each((_, el) => promises.push(tweenProps(el.nodes ? el.nodes[0] : el, spec, ms, ease)));
        return Promise.all(promises);
    });
    def('tweenTo', function (spec, ms, ease) { return Wrapper.prototype.tween.call(this, spec, ms, ease); });

    def('rotateTo', function (deg, ms, ease) {
        const promises = [];
        this.each((_, el) => promises.push(tweenProps(el.nodes ? el.nodes[0] : el, { angle: deg * Math.PI / 180 }, ms, ease)));
        return Promise.all(promises);
    });
    def('scaleTo', function (s, ms, ease) {
        const promises = [];
        this.each((_, el) => promises.push(tweenProps(el.nodes ? el.nodes[0] : el, { scale: s }, ms, ease)));
        return Promise.all(promises);
    });
    def('fadeTo', function (value, ms, ease) {
        const promises = [];
        this.each((_, el) => promises.push(tweenProps(el.nodes ? el.nodes[0] : el, { alpha: value }, ms, ease)));
        return Promise.all(promises);
    });
    def('delay', function (ms) { return wait(ms); });

    def('shake', function (intensity, ms) {
        return this.each((_, el) => shakeNode(el.nodes ? el.nodes[0] : el, intensity || 6, ms || 250));
    });
    def('flash', function (color, ms) {
        return this.each((_, el) => flashNode(el.nodes ? el.nodes[0] : el, packColor(color), ms || 120));
    });
    def('bounce', function (height, ms) {
        const promises = [];
        const h = height || 20;
        this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            const y0 = node.y;
            promises.push((async () => {
                await tweenProps(node, { y: y0 - h }, (ms || 300) / 2, 'easeOutQuad');
                await tweenProps(node, { y: y0 }, (ms || 300) / 2, 'easeInQuad');
            })());
        });
        return Promise.all(promises);
    });

    def('sequence', function (steps) { return sequence(steps); });
    def('pauseTweens', function () { return this.each((_, el) => pauseNodeTweens(el.nodes ? el.nodes[0] : el, true)); });
    def('resumeTweens', function () { return this.each((_, el) => pauseNodeTweens(el.nodes ? el.nodes[0] : el, false)); });
    def('clearTweens', function () { return this.each((_, el) => clearNodeTweens(el.nodes ? el.nodes[0] : el, true)); });

    // === Звук ================================================================

    def('sound', function (path) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).attrs.sound = path; }); });
    def('playSound', function (opts) {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            if (!node.attrs.sound) return;
            ctx.sound.playAt(node.attrs.sound, node, opts);
        });
    });
    def('mute', function (flag) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).attrs.muted = flag !== false; }); });
    def('volume', function (v) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).attrs.sound_volume = v; }); });

    // === Иерархия ============================================================

    def('appendTo', function (parent) {
        const target = resolveContainer(parent);
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            detach(node);
            node.parent_node = target;
            if (target) target.child_nodes.push(node);
        });
    });

    def('prependTo', function (parent) { return Wrapper.prototype.appendTo.call(this, parent); });

    def('append', function (child) {
        const nodes = child instanceof Wrapper ? child.nodes : (child && child.tag ? [child] : []);
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            for (const c of nodes) {
                detach(c);
                c.parent_node = node;
                node.child_nodes.push(c);
            }
        });
    });
    def('prepend', function (child) { return Wrapper.prototype.append.call(this, child); });

    def('remove', function () { return this.each((_, el) => { const n = el.nodes ? el.nodes[0] : el; if (n) n.destroy(); }); });

    def('detach', function () {
        return this.each((_, el) => {
            const node = el.nodes ? el.nodes[0] : el;
            detach(node);
            node.detached = true;
        });
    });

    defGet('parent', (n) => (n.parent_node ? wrapOne(n.parent_node) : wrap([])), wrap([]));
    defGet('children', function (node, sel) {
        const list = sel ? node.child_nodes.filter((c) => c.matches(sel)) : node.child_nodes;
        return wrap(list);
    }, wrap([]));
    defGet('find', function (node, sel) {
        return wrap(allDescendants(node).filter((c) => c.matches(sel)));
    }, wrap([]));
    defGet('closest', function (node, sel) {
        while (node) {
            if (node.matches(sel)) return wrapOne(node);
            node = node.parent_node;
        }
        return wrap([]);
    }, wrap([]));
    defGet('siblings', function (node, sel) {
        const parent = node.parent_node;
        const list = parent ? parent.child_nodes.filter((c) => c !== node) : ctx.nodes.filter((c) => c.parent_node === null && c !== node);
        return wrap(sel ? list.filter((c) => c.matches(sel)) : list);
    }, wrap([]));

    // === Data / классы / теги ================================================

    def('data', function (key, value) {
        if (key === undefined) {
            const node = this.nodes[0];
            return node ? Object.fromEntries(node.data_store) : {};
        }
        if (typeof key === 'object') {
            return this.each((_, el) => {
                const node = el.nodes ? el.nodes[0] : el;
                for (const k of Object.keys(key)) node.data_store.set(k, key[k]);
            });
        }
        if (value === undefined) {
            const node = this.nodes[0];
            return node ? node.data_store.get(key) : undefined;
        }
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).data_store.set(key, value); });
    });

    def('attr', function (key, value) {
        // Без аргумента — только свободные атрибуты (совместимость).
        if (key === undefined) return this.nodes[0] ? { ...this.nodes[0].attrs } : {};
        if (typeof key === 'object') {
            return this.each((_, el) => {
                const node = el.nodes ? el.nodes[0] : el;
                for (const k of Object.keys(key)) node.set(k, key[k]);
            });
        }
        // С аргументом — свойство или атрибут: .attr('id') читает id, а не
        // пустой attrs (иначе свойства узла были не видны через .attr()).
        if (value === undefined) {
            const node = this.nodes[0];
            return node ? node.get(key) : undefined;
        }
        return this.each((_, el) => { const n = el.nodes ? el.nodes[0] : el; n.set(key, value); });
    });

    def('addClass', function (name) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).addClass(name); }); });
    def('removeClass', function (name) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).removeClass(name); }); });
    def('toggleClass', function (name, force) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).toggleClass(name, force); }); });
    defGet('hasClass', (n, name) => n.hasClass(name), false);
    def('tag', function (name) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).addTag(name); }); });
    def('addTag', function (name) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).addTag(name); }); });
    def('removeTag', function (name) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).removeTag(name); }); });

    // === Интерфейс и текст ===================================================

    def('text', function (value) {
        if (value === undefined) return this.nodes[0] ? this.nodes[0].text : '';
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).text = String(value); });
    });
    def('html', function (value) { return Wrapper.prototype.text.call(this, value); });
    /** Радиус и яркость источника света: $('<light>', { radius: 200 }). */
    def('radius', function (v) {
        if (v === undefined) return this.nodes.length ? this.nodes[0].radius : 0;
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).radius = v; });
    });
    def('intensity', function (v) {
        if (v === undefined) return this.nodes.length ? this.nodes[0].intensity : 1;
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).intensity = v; });
    });
    /** Кегль текста: $('<text>', { text: 'Привет' }).size(24). */
    def('fontSize', function (v) {
        if (v === undefined) return this.nodes.length ? this.nodes[0].size : 0;
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).size = v; });
    });

    def('value', function (v) {
        if (v === undefined) return this.nodes[0] ? this.nodes[0].value : 0;
        return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).value = v; });
    });
    def('max', function (v) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).max_value = v; }); });
    def('controls', function (scheme) { return this.each((_, el) => { (el.nodes ? el.nodes[0] : el).attrs.controls = scheme; }); });

    // === Массовые операции ===================================================
    def('stopAll', function () { return this.each((_, el) => { const n = el.nodes ? el.nodes[0] : el; if (n.body >= 0) engine.setVelocity(n.body, 0, 0); }); });
    def('pause', function () { return this.each((_, el) => { const n = el.nodes ? el.nodes[0] : el; if (n.body >= 0) engine.setAwake(n.body, false); }); });
    def('wake', function () { return this.each((_, el) => { const n = el.nodes ? el.nodes[0] : el; if (n.body >= 0) engine.setAwake(n.body, true); }); });
    def('overlaps', function (what, cb) {
        const other = typeof what === 'string' ? query(what) : (what instanceof Wrapper ? what.nodes : []);
        if (typeof cb === 'function') {
            // Раньше здесь была подписка на событие 'tick', которое никто не
            // шлёт, — колбэк не вызывался никогда. Теперь наблюдатель
            // покадровый и живёт в подсистеме триггеров.
            return this.each((_, el) => {
                const node = el.nodes ? el.nodes[0] : el;
                watchOverlap(node, other, cb);
            });
        }
        const node = this.nodes[0];
        return !!node && other.some((o) => o !== node && boundsOverlap(node, o));
    });
    defGet('inside', function (node, sel) {
        const zone = query(sel)[0];
        return !!zone && boundsOverlap(node, zone);
    }, false);
}

// ---------------------------------------------------------------------------
// Кадровые хуки: игровой цикл
// ---------------------------------------------------------------------------

function installFrameHooks($) {
    // Последовательный профайлер подсистем кадра: prof('имя') закрывает
    // предыдущий отрезок и открывает следующий, prof(null) закрывает последний.
    // Живёт здесь, а не в createApi: раньше функция оказалась в другой области
    // видимости, каждый кадр падал ReferenceError, и весь блок подсистем
    // (fx, частицы, акустика, интерфейс) не выполнялся вообще.
    let prof_name = null;
    let prof_at = 0;
    function profilerMark(name) {
        const now = typeof engine.now === 'function' ? engine.now() : engine.time * 1000;
        if (prof_name !== null && $.debug && $.debug.profiler) {
            $.debug.profiler.record(prof_name, now - prof_at);
        }
        prof_name = name;
        prof_at = now;
    }

    engine.setUpdate((dt) => {
        // Замеры первой половины кадра: именно здесь раньше терялись десятки
        // миллисекунд, а профайлер показывал только «JS: логика».
        const prof = profilerMark;

        // 1. Свежие трансформы из физики.
        prof('синк физики'); ctx.world.sync(dt);

        // 2. События контакта за прошедший шаг физики: collide/separate/hit.
        prof('контакты'); dispatchContacts();

        // 3. Смена сцены — до логики, чтобы новая сцена прожила кадр целиком.
        prof('сцена'); ctx.scene._tick(dt);

        // 4. Время: твины, таймеры, камера, события ввода.
        prof('время'); tickTime();
        tickWindow();
        prof('окно');

        // 5. $.ready — один раз, на первом кадре.
        if (!frame.started) {
            frame.started = true;
            for (const fn of frame.ready) {
                try { fn($); } catch (e) { reportError('$.ready', e); }
            }
        }

        // 6. Обновление сцены и игры.
        const scene = ctx.scene._state.current;
        if (scene && typeof scene.update === 'function') {
            try { scene.update(dt, $); } catch (e) { reportError('update сцены', e); }
        }
        for (const fn of frame.update) {
            try { fn(dt, $); } catch (e) { reportError('$.update', e); }
        }

        prof('логика игры');
        animateSprites();
        applyControls(dt);
        prof('анимация+ввод');

        // 7. Подсистемы после аудита API. Порядок: сначала те, кто меняет
        //    состояние мира (анимация, частицы, навигация), затем слои и
        //    интерфейс, последней — шины звука (затухания громкости).
        // Замеры — для $.debug.profiler.report(): видно, какая подсистема
        // съедает кадр, без внешних инструментов. prof('имя') закрывает
        // предыдущий отрезок и открывает новый, prof(null) закрывает последний.
        tickAnim(dt);   prof('анимация');
        tickTilemap(dt); prof('tilemap');
        tickFx(dt);      prof('vfx');
        tickParticles(dt); prof('частицы');
        tickNav(dt);     prof('навигация');
        tickPrefab(dt);  prof('префабы');
        tickLayers(dt);  prof('слои');
        tickWidgets(dt); prof('виджеты');
        tickTriggers(dt); prof('триггеры');
        tickI18n(dt);    prof('i18n');
        tickPool(dt);    prof('пулы');
        tickViewport(dt); prof('вьюпорты');
        tickHttp(dt);    prof('http');
        tickAudiobus(dt); prof('шины звука');
        tickAcoustics(dt); prof('акустика');
        ctx.ui._tick();  prof('интерфейс');
        prof(null);
    });

    engine.setRender(() => {
        if (!frame.running) return;
        const scene = ctx.scene._state.current;
        if (scene && typeof scene.render === 'function') {
            try { scene.render($); } catch (e) { reportError('render сцены', e); }
        }
        for (const fn of frame.render) {
            try { fn(engine.dt, $); } catch (e) { reportError('$.render', e); }
        }
        ctx.gfx._render();
        ctx.debug._render();
    });

    // engine.quit() перехватывать нечем — выход обрабатывает движок.
    engine.setExit(() => {
        for (const fn of frame.exit) {
            try { fn($); } catch (e) { reportError('$.exit', e); }
        }
    });
}

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

function detach(node) {
    if (node.parent_node) {
        const i = node.parent_node.child_nodes.indexOf(node);
        if (i >= 0) node.parent_node.child_nodes.splice(i, 1);
        node.parent_node = null;
    }
}

function allDescendants(node) {
    const out = [];
    const stack = node.child_nodes.slice();
    while (stack.length) {
        const n = stack.pop();
        out.push(n);
        for (const c of n.child_nodes) stack.push(c);
    }
    return out;
}

function isDescendant(parent, node) {
    let cur = node.parent_node;
    while (cur) {
        if (cur === parent) return true;
        cur = cur.parent_node;
    }
    return false;
}

/**
 * Родитель для .appendTo(): узел, обёртка или $.world.
 * «Мир» — это отсутствие узла-родителя, поэтому для него возвращается null:
 * узлы мира и так лежат в общем реестре, а строка в parent_node ломала
 * наследование и destroy().
 */
function resolveContainer(parent) {
    if (parent === null || parent === undefined) return null;
    if (parent === ctx.world || parent === ctx.$.world) return null;
    if (parent instanceof Wrapper) return parent.nodes[0] || null;
    if (parent && parent.tag) return parent;
    return null;
}

function resolvePoint(target) {
    if (typeof target === 'string') {
        const node = query(target)[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (target instanceof Wrapper) {
        const node = target.nodes[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (target && target.tag) return { x: target.x, y: target.y };
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    if (target && typeof target === 'object') return { x: target.x || 0, y: target.y || 0 };
    return { x: 0, y: 0 };
}

function vectorOf(list) { return { x: list[0], y: list[1] }; }

function stepTowards(node, target, speed) {
    if (!node) return;
    const p = resolvePoint(target);
    const dx = p.x - node.x;
    const dy = p.y - node.y;
    const d = Math.hypot(dx, dy);
    const v = (typeof speed === 'object' && speed !== null && speed.speed !== undefined) ? speed.speed : (speed || 100);

    if (d <= 1) {
        if (node.body >= 0) engine.setVelocity(node.body, 0, 0);
        node.emit('arrived', {});
        return;
    }
    if (node.body >= 0) {
        engine.setVelocity(node.body, (dx / d) * v, (dy / d) * v);
    } else {
        // У узла без тела нет инерции: двигаем ровно на шаг кадра.
        const dt = engine.dt;
        node.x += (dx / d) * v * dt;
        node.y += (dy / d) * v * dt;
        if (d <= v * dt) node.emit('arrived', {});
    }
}

// --- Встроенное управление (.controls('wasd')) ------------------------------

function applyControls(dt) {
    for (const node of ctx.nodes) {
        const scheme = node.attrs.controls;
        if (!scheme || node.cur_hp <= 0) continue;
        const cfg = typeof scheme === 'string' ? { axis: scheme } : scheme;
        const axis_name = cfg.axis || 'both';
        const vec = ctx.input.vec(axis_name);
        const speed = node.attrs.speed !== undefined ? node.attrs.speed
            : (node.tag === 'player' ? 250 : 150);

        const jump_key = cfg.jump || 'space';
        const up_key = cfg.up || 'w';
        const jump_pressed = ctx.input.pressed(jump_key) || ctx.input.pressed(up_key);

        if (node.body >= 0) {
            const [vx, vy] = engine.getVelocity(node.body);
            engine.setVelocity(node.body, vec.x * speed, node.gravity_on === false ? 0 : vy);
            if (jump_pressed && Wrapper.prototype.onFloor.call(wrapOne(node))) {
                Wrapper.prototype.jump.call(wrapOne(node), cfg.jumpForce || 640);
            }
        } else {
            node.x += vec.x * speed * dt;
            node.y += vec.y * speed * dt;
        }
        node.attrs.on_ground = node.body >= 0 ? Wrapper.prototype.onFloor.call(wrapOne(node)) : true;

        const fire_key = cfg.fire;
        if (fire_key && ctx.input.pressed(fire_key)) node.emit('fire', {});
    }
}

// --- Спрайт-анимация --------------------------------------------------------

/**
 * Разносит события контакта Box2D по узлам: collide / separate / hit.
 *
 * C копит события за шаг и отдаёт их списком; здесь мы переводим id тел в
 * узлы (ctx.byBody) и шлём событие обеим сторонам — как ContactMonitor в
 * Godot. Событие приходит в том кадре, в котором контакт начался/кончился.
 */
function dispatchContacts() {
    if (typeof engine.contacts !== 'function') return;
    const list = engine.contacts();
    if (!list || list.length === 0) return;

    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const na = ctx.byBody.get(c.a) || null;
        const nb = ctx.byBody.get(c.b) || null;
        if (!na && !nb) continue;

        const name = c.kind === 'begin' ? 'collide' : (c.kind === 'end' ? 'separate' : 'hit');
        const info = {
            kind: c.kind,
            x: c.x, y: c.y,
            nx: c.nx, ny: c.ny,
            speed: c.speed,
            a: na ? wrapOne(na) : null,
            b: nb ? wrapOne(nb) : null,
        };

        if (na) {
            info.self = wrapOne(na);
            info.other = nb ? wrapOne(nb) : null;
            try { na.emit(name, info); } catch (e) { reportError(`событие ${name}`, e); }
        }
        if (nb) {
            info.self = wrapOne(nb);
            info.other = na ? wrapOne(na) : null;
            try { nb.emit(name, info); } catch (e) { reportError(`событие ${name}`, e); }
        }
    }
}

function animateSprites() {
    const dt = ctx.time.delta();
    if (dt <= 0) return;
    for (const node of ctx.nodes) {
        if (!node.anim || !node.anim.playing || !node.frames) continue;
        const anim = node.anim;
        anim.t += dt * anim.speed;
        const span = anim.to - anim.from + 1;
        let index = anim.from + Math.floor(anim.t) % span;
        if (!anim.loop && Math.floor(anim.t) >= span) {
            anim.playing = false;
            index = anim.to;
            node.emit('animEnd', { anim });
        }
        node.sprite = node.frames[index];
        node.frame_index = index;
    }
}

/**
 * Сообщает об ошибке в игровом коде так, чтобы её можно было починить:
 * текст, стек и подпись места. Без стека отладка превращается в угадывание,
 * поэтому он есть всегда, когда движок его отдаёт.
 */
function reportError(where, error) {
    const stack = error && error.stack ? `\n${error.stack}` : '';
    ctx.log(`$: ошибка в ${where}: ${error}${stack}`);
}

/** Программный вызов хука выхода (движок не даёт события выхода в JS). */
export function callExitHooks($) {
    for (const fn of frame.exit) {
        try { fn($); } catch (e) { reportError('$.exit', e); }
    }
}
