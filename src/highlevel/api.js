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
    makeRandom, dotSprite, resolveSprite, sheetFrames, regionSprite,
    nodesWithFacet, touchRegistry, beginBatch, endBatch, liveNodes,
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
import { tweenProps, clearNodeTweens, pauseNodeTweens, shakeNode, flashNode, sequence, wait, activeTweenCount, easeFunction, installTween, noteEffect } from './tween.js';

// --- Подсистемы, добавленные после аудита API (docs/GAP_ANALYSIS.md) --------
// Каждый модуль сам регистрирует свои теги, методы и отрисовщики; api.js
// только ставит их и вызывает tick в кадровом цикле. Порядок установки
// важен: модули пользуются уже готовыми $.world/$.gfx/$.input.
import { installAnim, tickAnim } from './anim.js';
import { installAnimPlayer, tickAnimPlayer } from './animplayer.js';
import { installRu } from './ru.js';
import { installMath } from './mathx.js';
import { installRandom } from './random.js';
import { installGrid } from './grid.js';
import { installCsv } from './csv.js';
import { installSignal } from './signal.js';
import { installState, tickState } from './state.js';
import { installFlow, tickFlow } from './flow.js';
import { installFont } from './font.js';
import { installScreen, tickScreen } from './screen.js';
import { installDialog, tickDialog } from './dialog.js';
import { installTimeline, tickTimeline } from './timeline.js';
import { installSave } from './save.js';
import { installResource } from './resource.js';
import { installTilemap, tickTilemap } from './tilemap.js';
import { installParticles, tickParticles } from './particles.js';
import { installFx, tickFx } from './fx.js';
import { installNav, tickNav } from './nav.js';
import { installPrefab, tickPrefab } from './prefab.js';
import { installAudiobus, tickAudiobus } from './audiobus.js';
import { installAcoustics, tickAcoustics } from './acoustics.js';
import { installLayers, tickLayers, nodeScreenPos } from './layers.js';
import { installCollisionLayers } from './collision.js';
import { installBsp } from './bsp.js';
import { installAtlas } from './atlas.js';
import { installCurve } from './curve.js';
import { installTask } from './task.js';
import { installScript } from './script.js';
import { installStory } from './story.js';
import { installQuest } from './quest.js';
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

// ---------------------------------------------------------------------------
// Русские имена: псевдонимы тегов и селекторов.
//
// Подсистема $.ru (src/highlevel/ru.js) объявляет «свет» → «light». Узел при
// этом создаётся с КАНОНИЧЕСКИМ тегом: иначе его не узнают ни отрисовка, ни
// селекторы, ни снимок для агента. Селектор переводим словарём, трогая только
// известные слова — имена классов и id остаются как есть.
// ---------------------------------------------------------------------------

const tag_aliases = new Map();

/** Канонический тег для русского имени (или имя как есть). */
function resolveTagAlias(name) {
    return tag_aliases.get(name) || name;
}

/** Перевод русских слов внутри селектора: 'игрок.boss' → 'player.boss'. */
function translateSelector(selector) {
    if (tag_aliases.size === 0 || typeof selector !== 'string') return selector;
    return selector.replace(/[A-Za-z_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF-]*/g,
                            (word) => tag_aliases.get(word) || word);
}

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
                const raw = tag[1].trim();
                // Русские имена тегов: подсистема $.ru регистрирует псевдонимы
                // («свет» → «light»), но узел всегда создаётся с каноническим
                // тегом — иначе его не узнают ни отрисовка, ни селекторы.
                const name = resolveTagAlias(raw);
                if (!TAGS[name]) ctx.log(`$: неизвестный тег <${name}> — создаю пустой узел`);
                // Русские ключи атрибутов ({ радиус: 200 }) переводит $.ru —
                // подсистемы знают только латинские имена.
                const props = typeof ctx.translateAttrsHook === 'function'
                    ? ctx.translateAttrsHook(attrs) : attrs;
                const node = new Node(name, props);
                // { frames } в конструкторе делал бы то же, что .frames():
                // без этого лист молча превращался в обычный атрибут.
                if (attrs && attrs.frames !== undefined) applyFrames(node, attrs.frames);
                return wrapOne(node);
            }
            return wrap(query(translateSelector(arg)));
        }
        if (arg && arg.nodes) return arg;
        return wrap([]);
    };

    $._wrapper = Wrapper;
    $._node = Node;
    ctx.$ = $;
    // Псевдонимы тегов для $.ru: объявлять их может только подсистема,
    // а читает — фабрика узлов выше.
    ctx.tagAliases = tag_aliases;
    /**
     * Объявить русское имя тега: `$.aliasTag('свет', 'light')`. Дальше
     * `$('<свет>')` и `$('свет')` работают как `<light>` и `light`.
     */
    $.aliasTag = function (alias, canonical) {
        if (typeof alias !== 'string' || typeof canonical !== 'string') return $;
        if (!TAGS[canonical]) {
            ctx.log(`$.aliasTag: тега <${canonical}> нет — псевдоним "${alias}" пропущен`);
            return $;
        }
        tag_aliases.set(alias, canonical);
        return $;
    };
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

    /**
     * Пакетная операция: массовый спавн и удаление внутри одного вызова.
     *
     *   $.batch(() => {
     *       for (const b of bullets) $('<bullet>').at(...);   // вставки — как обычно
     *       $('.bullet').remove();                            // K удалений — одна уборка
     *   });
     *
     * Внутри пакета destroy() и возврат в пул только помечают узел, а реестр
     * чистится одной компактификацией в конце: K удалений перестают стоить
     * K × O(N) (docs/HIGH_LEVEL_API_PERF.md §3.6). Вложенные вызовы
     * складываются, уборка одна — на выходе из внешнего.
     */
    $.batch = function (fn) {
        if (typeof fn !== 'function') return $;
        beginBatch();
        try {
            fn($);
        } catch (e) {
            reportError('$.batch', e);
        } finally {
            endBatch();
        }
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
    /**
     * Верхний мировой узел под курсором (или под точкой `{x, y}`/`[x, y]`).
     * Интерфейс не участвует: у ui-узлов свой обработчик (`$.ui`).
     * Порядок — тот же, что у отрисовки: layer, depth, затем Y.
     */
    $.pick = function (point) {
        // Без точки — просто то, что уже подсвечено курсором в этом кадре.
        if (point === undefined) return ctx.hovered ? wrapOne(ctx.hovered) : wrap([]);
        const world = resolvePoint(point);
        // Точка приходит в МИРОВЫХ координатах (как $.input.mouseWorld()), а
        // попадание считается по нарисованному месту: переводим её на экран.
        const screen = ctx.camera ? ctx.camera.worldToScreen(world) : world;
        const zoom = ctx.camera ? (ctx.camera.zoom() || 1) : 1;
        const nodes = liveNodes();
        let top = null;
        let top_score = -Infinity;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.attrs && node.attrs.ui) continue;
            if (!node.visible || node.alpha <= 0) continue;
            if (node.w <= 0 || node.h <= 0) continue;
            const np = nodeScreenPos(node);
            const hw = Math.abs(node.w * (node.scale_x === undefined ? 1 : node.scale_x) * zoom) / 2;
            const hh = Math.abs(node.h * (node.scale_y === undefined ? 1 : node.scale_y) * zoom) / 2;
            if (Math.abs(screen.x - np.x) > hw || Math.abs(screen.y - np.y) > hh) continue;
            const score = (node.layer || 0) * 1e6 + (node.depth || 0) * 1e3 + node.y;
            if (score >= top_score) { top_score = score; top = node; }
        }
        return top ? wrapOne(top) : wrap([]);
    };

    /** Все мировые узлы под точкой (нижние первыми). */
    $.pickAll = function (point) {
        const world = resolvePoint(point);
        const screen = ctx.camera ? ctx.camera.worldToScreen(world) : world;
        const zoom = ctx.camera ? (ctx.camera.zoom() || 1) : 1;
        const found = [];
        for (const node of liveNodes()) {
            if (node.attrs && node.attrs.ui) continue;
            if (!node.visible || node.alpha <= 0 || node.w <= 0 || node.h <= 0) continue;
            const np = nodeScreenPos(node);
            const hw = Math.abs(node.w * (node.scale_x === undefined ? 1 : node.scale_x) * zoom) / 2;
            const hh = Math.abs(node.h * (node.scale_y === undefined ? 1 : node.scale_y) * zoom) / 2;
            if (Math.abs(screen.x - np.x) <= hw && Math.abs(screen.y - np.y) <= hh) found.push(node);
        }
        found.sort((a, b) => ((a.layer || 0) * 1e6 + (a.depth || 0) * 1e3 + a.y)
                          - ((b.layer || 0) * 1e6 + (b.depth || 0) * 1e3 + b.y));
        return wrap(found);
    };

    $.isAgent = () => !!engine.agent;
    $.quit = () => engine.quit();

    // --- Подсистемы после аудита API ------------------------------------------
    // Ставятся здесь, а не рядом с остальными install*(): им нужны готовые
    // $.world/$.gfx/$.input/$.fn и определённые выше $.ready/$.update.
    installAnim($);
    installAnimPlayer($);       // дополняет $.anim: таймлайны и микширование
    installTilemap($);
    installParticles($);
    installFx($);
    installNav($);
    installPrefab($);
    installAudiobus($);
    installAcoustics($);
    installLayers($);
    installCollisionLayers($);   // именованные слои коллизий ($.collision)
    installBsp($);               // BSP-дерево: $.world.bsp
    installAtlas($);             // атласы из JSON: $.atlas
    installCurve($);             // кривые и градиенты: $.curve
    installTask($);              // работа кусками по кадрам: $.task
    installScript($);            // перезапуск скриптов: $.script
    installStory($);             // сценки: $.story (DSL)
    installQuest($);             // задания: $.quest
    installWidgets($);
    installTriggers($);
    installI18n($);
    installPool($);
    installViewport($);
    installHttp($);

    // --- Утилиты, логика и данные --------------------------------------------
    // Порядок важен: installRandom перекрывает $.random из ядра (там только
    // базовый генератор), логика (signal → state → flow) ставится до диалогов
    // и экранов, а сохранения и ресурсы — последними: они умеют сериализовать
    // всё, что уже зарегистрировано.
    installMath($);
    installRandom($);
    installGrid($);
    installCsv($);
    installSignal($);
    installState($);
    installFlow($);
    installFont($);
    installScreen($);
    installDialog($);
    // Таймлайн-сцены (диалоги и визуальные новеллы) — после диалогов: они
    // листают реплики через $.dialog и подписываются на его события.
    installTimeline($);
    installSave($);
    installResource($);

    // --- Методы узлов ---------------------------------------------------------
    installNodeMethods($);
    // Tween-объекты (Godot-стиль) — после методов узлов: им нужны $.fn и $.time.
    installTween($);
    installFrameHooks($);
    // Русские имена — последними: они ссылаются на уже собранные пространства
    // имён и методы обёртки (см. src/highlevel/ru.js).
    installRu($);
    return $;
}

function dispatchGlobal(node, name, data) {
    // Ранний выход: глобальных подписок нет вовсе — самой частой ситуации в
    // игре. Раньше объект события, три обёртки ($('*')-цели) и строки
    // 'entity:…' строились на КАЖДОЕ событие каждого узла, даже когда слушать
    // было некому (§3.5 отчёта). globals.size читается одним свойством.
    if (globals.size === 0) return;

    const direct = globals.get(name);
    const wildcard = globals.get('*');
    const entity = node ? globals.get('entity:' + name) : null;
    const by_tag = node && node.tag ? globals.get('entity:' + node.tag + ':' + name) : null;
    const any = (list) => list !== undefined && list.length !== 0;
    if (!any(direct) && !any(wildcard) && !any(entity) && !any(by_tag)) return;

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
    fire(direct);
    if (!event.stopped && node) {
        fire(entity);
        fire(by_tag);
    }
    if (!event.stopped) fire(wildcard);
}

// ---------------------------------------------------------------------------
// Цепочные методы узлов
// ---------------------------------------------------------------------------

// Виды шейдеров узла — тот же список, что в render.js (FX_KINDS).
const FX_NAMES = new Set(['none', 'flash', 'dissolve', 'chroma', 'wave']);

function installNodeMethods($) {
    // === Коллекция ==========================================================

    // .each() и .eachNode() объявлены в ядре (core.js, класс Wrapper): их зовут
    // и модули-подсистемы, а api.js в юнит-тестах qjs не поднимается.
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
        return this.eachNode((_, el) => {
            const node = el;
            node.x = x;
            node.y = y;
            if (node.body >= 0) engine.setPosition(node.body, x, y, node.angle);
        });
    });

    def('move', function (dx, dy) {
        if (typeof dx === 'object') { dy = dx.y; dx = dx.x; }
        return this.eachNode((_, el) => {
            const node = el;
            node.x += dx; node.y += dy;
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });

    def('moveTo', function (x, y, ms, ease) {
        if (typeof x === 'object') { ease = ms; ms = y; y = x.y; x = x.x; }
        if (typeof x === 'string' || (x && x.tag) || x instanceof Wrapper) {
            // .moveTo('#hero', speed) — двигаться к цели с этой скоростью.
            return this.eachNode((_, el) => stepTowards(el, x, y));
        }
        if (!(ms > 0)) return this.at(x, y);
        const promises = [];
        this.eachNode((_, el) => promises.push(tweenProps(el, { x, y }, ms, ease)));
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
        return this.eachNode((_, el) => {
            const node = el;
            node.w = w;
            node.h = h === undefined ? w : h;
            if (node.body >= 0) node.syncBodySize();
        });
    });
    def('width', function (value) {
        if (value === undefined) return this.nodes.length ? this.nodes[0].w : 0;
        return this.eachNode((_, el) => { const n = el; n.w = value; if (n.body >= 0) n.syncBodySize(); });
    });
    def('height', function (value) {
        if (value === undefined) return this.nodes.length ? this.nodes[0].h : 0;
        return this.eachNode((_, el) => { const n = el; n.h = value; if (n.body >= 0) n.syncBodySize(); });
    });

    def('rotate', function (deg) {
        return this.eachNode((_, el) => {
            const node = el;
            node.angle = (node.angle || 0) + deg * Math.PI / 180;
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });
    def('angle', function (rad) {
        return this.eachNode((_, el) => {
            const node = el;
            node.angle = rad;
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });
    defGet('rotation', (n) => n.angle, 0);

    def('scale', function (sx, sy) {
        if (typeof sx === 'object') { sy = sx.y; sx = sx.x; }
        return this.eachNode((_, el) => {
            const node = el;
            node.scale_x = sx;
            node.scale_y = sy === undefined ? sx : sy;
        });
    });

    // Скорость в пикселях в секунду. Раньше её можно было задать только
    // атрибутом в конструкторе, хотя справочник обещал цепочку `.speed(250)`
    // (и это был первый же пример API, который падал с TypeError).
    def('speed', function (value) {
        if (value === undefined) return this.nodes.length ? this.nodes[0].speed : 0;
        return this.eachNode((_, el) => {
            const node = el;
            node.speed = Number(value) || 0;
            node.attrs.speed = node.speed;
        });
    });

    def('lookAt', function (target) {
        return this.eachNode((_, el) => {
            const node = el;
            const p = resolvePoint(target);
            node.angle = Math.atan2(p.y - node.y, p.x - node.x);
            if (node.body >= 0) engine.setPosition(node.body, node.x, node.y, node.angle);
        });
    });

    def('flip', function (x, y) {
        return this.eachNode((_, el) => {
            const node = el;
            if (x !== undefined) node.scale_x = Math.abs(node.scale_x) * (x ? -1 : 1);
            if (y !== undefined) node.scale_y = Math.abs(node.scale_y) * (y ? -1 : 1);
        });
    });

    /**
     * Пивот: точка узла, вокруг которой идёт вращение и масштаб.
     * `.pivot(0.5, 1)` — «ноги» (низ по центру), `.pivot(0, 0)` — левый верх,
     * `.pivot()` — вернуть текущий, `.pivot(0.5, 0.5)` — снова центр.
     *
     * Значения 0..1 — доля размера узла; больше 1 — пиксели от левого верхнего
     * угла. Без явного пивота спрайт вращается вокруг центра, как раньше.
     */
    def('pivot', function (x, y) {
        if (x === undefined) {
            const node = this.nodes[0];
            return {
                x: node && node.pivot_x !== undefined ? node.pivot_x : 0.5,
                y: node && node.pivot_y !== undefined ? node.pivot_y : 0.5,
            };
        }
        return this.eachNode((_, el) => {
            const node = el;
            node.pivot_x = Number(x) || 0;
            node.pivot_y = y === undefined ? node.pivot_x : (Number(y) || 0);
            touchRegistry();
        });
    });

    /** Пивот в мировых координатах: `.pivotAt(x, y)` сам считает доли. */
    def('pivotAt', function (x, y) {
        return this.eachNode((_, el) => {
            const node = el;
            const w = node.w || 1;
            const h = node.h || 1;
            node.pivot_x = (Number(x) - node.x) / w + 0.5;
            node.pivot_y = (Number(y) - node.y) / h + 0.5;
            touchRegistry();
        });
    });

    def('depth', function (z) { return this.eachNode((_, el) => { (el).depth = z; }); });
    def('layer', function (n) { return this.eachNode((_, el) => { (el).layer = n; }); });

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

    /**
     * Ищет препятствие для хитбокса узла на пути к цели: свип формы из центра
     * узла в точку цели. Возвращает тот же дескриптор, что
     * `$.world.castShape`, либо null. Размеры берутся из хитбокса узла, их
     * можно перебить через `opts` (`w`, `h`, `capsule`, `mask`, `ignore`).
     */
    defGet('sweepTo', function (node, target, opts) {
        const p = resolvePoint(target);
        const o = opts || {};
        // Явная форма в opts важнее хитбокса узла: иначе `{ w, h }` из opts
        // перебивалось бы halfW/halfH, подставленными из узла.
        const explicit = o.w !== undefined || o.h !== undefined ||
                         o.halfW !== undefined || o.halfH !== undefined ||
                         o.radius !== undefined || o.capsule !== undefined ||
                         o.shape !== undefined;
        const spec = explicit ? Object.assign({}, o) : Object.assign({
            halfW: (node.hitbox ? node.hitbox.w : node.w) / 2,
            halfH: (node.hitbox ? node.hitbox.h : node.h) / 2,
            shape: node.shape_kind === 'circle' ? 'circle'
                 : (node.shape_kind === 'capsule' ? 'capsule' : 'box'),
            radius: node.circle_hitbox > 0 ? node.circle_hitbox : 0,
            angle: node.angle,
        }, o);
        // Своё тело свип пропускает всегда: без этого он «находил» бы сам
        // себя в начальной точке (fraction = 0) и не двигался бы с места.
        spec.ignore = o.ignore ? [node, o.ignore] : node;
        return ctx.world.castShape({ x: node.x, y: node.y }, p, spec);
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
        return this.eachNode((_, el) => {
            const node = el;
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
        return this.eachNode((_, el) => applyFrames(el, spec));
    });
    def('region', function (x, y, w, h) {
        return this.eachNode((_, el) => {
            const node = el;
            if (node.attrs.src) node.sprite = regionSprite(node.attrs.src, x, y, w, h);
        });
    });
    /**
     * Nine-slice: `.slice({ left: 8, right: 8, top: 8, bottom: 8 })` — спрайт
     * режется на девять частей и растягивается под размер узла: углы целые,
     * края тянутся, центр заполняет. Числа 0..1 — доля стороны, больше 1 —
     * пиксели исходного спрайта. `.slice(null)` — выключить.
     *
     * Требует `src` (или `.sprite()`), потому что части режутся из текстуры.
     */
    def('slice', function (insets) {
        if (insets === undefined) {
            const node = this.nodes[0];
            return node ? (node.nine_slice || null) : null;
        }
        return this.eachNode((_, el) => {
            const node = el;
            if (!insets) { node.nine_slice = null; return; }
            const spec = typeof insets === 'number'
                ? { left: insets, right: insets, top: insets, bottom: insets }
                : insets;
            // Числа приводим на месте: у api.js нет своего num(), а тянуть
            // его из ядра ради четырёх полей незачем.
            const number = (value) => {
                const n = Number(value);
                return Number.isFinite(n) ? n : 0;
            };
            node.nine_slice = {
                left: number(spec.left),
                right: number(spec.right),
                top: number(spec.top),
                bottom: number(spec.bottom),
            };
            if (!node.attrs.src) {
                ctx.log('$.slice: нужен src — nine-slice режет части из текстуры (см. .sprite())');
            }
        });
    });

    def('frame', function (index) {
        return this.eachNode((_, el) => {
            const node = el;
            if (node.frames && node.frames[index] !== undefined) node.sprite = node.frames[index];
        });
    });

    /** Анимация по кадрам листа: .animate({ from: 0, to: 5, speed: 12, loop: true }) */
    def('animate', function (spec) {
        const cfg = typeof spec === 'object' ? spec : { name: spec };
        return this.eachNode((_, el) => {
            const node = el;
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
            touchRegistry();   // у узла появилась анимация — сводка кадра устарела
        });
    });
    def('stopAnim', function () {
        return this.eachNode((_, el) => {
            const node = el;
            if (node.anim) { node.anim = null; touchRegistry(); }
        });
    });
    def('playing', function (v) {
        return this.eachNode((_, el) => {
            const node = el;
            if (node.anim) node.anim.playing = v !== false;
        });
    });

    def('color', function (value) { return this.eachNode((_, el) => { (el).color = packColor(value); }); });
    def('alpha', function (value) {
        if (value === undefined) return this.nodes.length ? this.nodes[0].alpha : 0;
        return this.eachNode((_, el) => { (el).alpha = Math.max(0, Math.min(1, value)); });
    });
    def('opacity', function (value) { return Wrapper.prototype.alpha.call(this, value); });

    def('visible', function (flag) { return this.eachNode((_, el) => { (el).visible = flag !== false; }); });
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
        return this.eachNode((_, el) => {
            (el).blend_mode = known ? mode : 'alpha';
        });
    });
    /**
     * Шейдер узла: эффект поверх спрайта. Виды — flash, dissolve, chroma, wave
     * (см. `$.gfx.fxKinds()`), параметры — объектом. Имя читается без
     * аргументов; `null`/`'none'` выключают эффект.
     *
     *   $('#hero').shader('flash', { color: '#ff8080', amount: 0.7 });
     *   $('#ghost').shader('dissolve', { threshold: 0.4 });
     *   $('#hero').shader('chroma', { offset: 0.006 });
     *   $('#lava').shader('wave', { amplitude: 0.05, frequency: 30, phase: t });
     *
     * Эффект рисуется тем же батчем: узлы с одинаковым эффектом и одинаковыми
     * параметрами идут одним вызовом. Узлы без шейдера — прежним конвейером.
     */
    def('shader', function (value, params) {
        if (value === undefined) {
            const node = this.nodes[0];
            return node && node.shader_name ? node.shader_name : 'none';
        }
        const custom = value !== null && ctx.gfx && typeof ctx.gfx.userShaders === 'function'
            && ctx.gfx.userShaders().indexOf(String(value)) >= 0;
        if (value !== null && !FX_NAMES.has(String(value)) && !custom) {
            const known = Array.from(FX_NAMES);
            if (ctx.gfx && typeof ctx.gfx.userShaders === 'function') {
                known.push(...ctx.gfx.userShaders());
            }
            ctx.log(`$: .shader("${value}") — неизвестный эффект; доступны: `
                  + `${known.join(', ')} (свой шейдер регистрирует $.gfx.defineShader). `
                  + 'Вызов проигнорирован');
            return this;
        }
        return this.eachNode((_, node) => {
            if (value === null || String(value) === 'none') {
                node.shader_name = null;
                node.shader_params = null;
                return;
            }
            node.shader_name = String(value);
            node.shader_params = params === undefined ? {} : Object.assign({}, params);
        });
    });

    /** Один параметр шейдера узла: `.shaderParam('threshold', 0.6)`. */
    def('shaderParam', function (name, value) {
        // Без аргументов — все параметры, с одним — конкретный, с двумя —
        // установка: иначе `.shaderParam('amount')` молча обнулял бы параметр.
        if (arguments.length === 0) {
            const node = this.nodes[0];
            return node && node.shader_params ? Object.assign({}, node.shader_params) : {};
        }
        if (arguments.length === 1) {
            const node = this.nodes[0];
            const params = node && node.shader_params;
            return params ? params[String(name)] : undefined;
        }
        return this.eachNode((_, node) => {
            if (!node.shader_name) return;
            if (!node.shader_params) node.shader_params = {};
            node.shader_params[String(name)] = value;
        });
    });

    def('outline', function (width, color) {
        return this.eachNode((_, el) => {
            const node = el;
            node.outline = { width: width || 2, color: packColor(color) };
        });
    });
    def('shadow', function (opts) {
        return this.eachNode((_, el) => {
            const node = el;
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
        return this.eachNode((_, el) => {
            const node = el;
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
        return this.eachNode((_, el) => {
            const node = el;
            if (node.body >= 0) engine.applyImpulse(node.body, ix, iy);
        });
    });

    def('gravity', function (on) {
        return this.eachNode((_, el) => {
            const node = el;
            node.gravity_on = on !== false;
            node.no_gravity = false;
            if (node.body >= 0) engine.setGravityScale(node.body, node.gravity_on ? 1 : 0);
        });
    });

    def('body', function (kind) {
        // kind === null — «без тела»: запоминаем запрет, чтобы узел не получил
        // тело обратно из TAGS при следующем пересчёте размера.
        return this.eachNode((_, el) => { (el).setBody(kind); });
    });

    def('collision', function (w, h) {
        return this.eachNode((_, el) => {
            const node = el;
            node.hitbox = { w, h: h === undefined ? w : h };
            if (node.body >= 0) node.syncBodySize();
        });
    });

    def('collisionCircle', function (r) {
        return this.eachNode((_, el) => {
            const node = el;
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
        return this.eachNode((_, el) => {
            const node = el;
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
        return this.eachNode((_, el) => {
            const node = el;
            node.one_way = on !== false;
            if (angle !== undefined) node.one_way_angle = angle;
            if (node.body >= 0) node.syncBodySize();
        });
    });

    /** Сенсор: тело ловит пересечения, но не отталкивает. */
    def('sensor', function (on) {
        if (on === undefined) return this.nodes.length ? this.nodes[0].sensor : false;
        return this.eachNode((_, el) => {
            const node = el;
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
        return this.eachNode((_, el) => {
            const node = el;
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

    // --- Слои и маски коллизий ---------------------------------------------
    // Тело лежит в слое (layerBits) и сталкивается с теми слоями, что
    // перечислены в маске (mask). Числа 32-битные: побитовые операторы JS
    // всё равно 32-битные, а старшие биты b2Filter остаются доступны только
    // C-стороне. Значения по умолчанию — слой 1 и «сталкиваться со всеми»,
    // то есть ровно прежнее поведение движка.

    /** .mask() — текущая маска; .mask(bits|узел|селектор) — задать. */
    def('mask', function (value) {
        if (arguments.length === 0) {
            const node = this.nodes[0];
            return node ? node.collision_mask : 0xffffffff;
        }
        const bits = layerBitsOf(value);
        return this.eachNode((_, node) => { node.set('mask', bits); });
    });

    /** .layerBits() — слой тела; .layerBits(bits|узел|селектор) — задать. */
    def('layerBits', function (value) {
        if (arguments.length === 0) {
            const node = this.nodes[0];
            return node ? node.layer_bits : 1;
        }
        const bits = layerBitsOf(value);
        return this.eachNode((_, node) => { node.set('layerBits', bits); });
    });

    /**
     * .collidesWith(цель) — сталкиваются ли узлы с учётом слоёв, масок и
     * групп; .collidesWith(цель, true|false) — добавить или убрать слои цели
     * из своей маски. Логика та же, что у Box2D при выборе пар.
     */
    def('collidesWith', function (target, on) {
        const self = this.nodes[0];
        if (!self) return arguments.length < 2 ? false : this;

        if (arguments.length < 2) {
            const other = resolveNodeArg(target);
            if (!other) return false;
            if (self.collision_group !== 0 && self.collision_group === other.collision_group) {
                return self.collision_group > 0;
            }
            return ((self.collision_mask & (other.layer_bits >>> 0)) !== 0) &&
                   ((other.collision_mask & (self.layer_bits >>> 0)) !== 0);
        }

        const bits = layerBitsOf(target);
        return this.eachNode((_, node) => {
            const next = on === false ? (node.collision_mask & ~bits) : (node.collision_mask | bits);
            node.set('mask', next >>> 0);
        });
    });

    /**
     * Стоит ли узел на земле. Луч идёт из центра узла вниз: начинать его у
     * самой нижней грани нельзя — тело узла тогда лежит внутри опоры, а
     * Box2D для луча «игнорирует начальное перекрытие» и ничего не находит.
     * Старт из центра заодно исключает попадание в самого себя.
     */
    defGet('onFloor', function (node) {
        const b = nodeBounds(node);
        // Маска узла: с чем тело не сталкивается, на том и не стоит.
        const hit = ctx.world.raycast({ x: node.x, y: node.y }, { x: node.x, y: b.y1 + 8 },
                                      { mask: node.collision_mask });
        return hit !== null && hit.body !== node.body;
    }, false);

    /** Касается ли стены слева или справа — луч тоже из центра узла. */
    defGet('onWall', function (node) {
        const b = nodeBounds(node);
        const opts = { mask: node.collision_mask };
        const left = ctx.world.raycast({ x: node.x, y: node.y }, { x: b.x0 - 8, y: node.y }, opts);
        const right = ctx.world.raycast({ x: node.x, y: node.y }, { x: b.x1 + 8, y: node.y }, opts);
        return !!((left && left.body !== node.body) || (right && right.body !== node.body));
    }, false);

    /** Двигаться в сторону цели со скоростью. dt не нужен: скорость в px/с. */
    def('moveTowards', function (target, speed) {
        return this.eachNode((_, el) => stepTowards(el, target, speed));
    });

    /** В Box2D скольжение вдоль стен делает сам решатель — метод задаёт скорость. */
    def('moveAndSlide', function (vx, vy) {
        if (typeof vx === 'object') { vy = vx.y; vx = vx.x; }
        return Wrapper.prototype.velocity.call(this, vx, vy);
    });

    def('jump', function (force) {
        return this.eachNode((_, el) => {
            const node = el;
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
        return this.eachNode((_, el) => {
            const node = el;
            node.max_hp = value;
            node.cur_hp = value;
            node.attrs.on_ground = value > 0;
        });
    });

    def('hp', function (value) {
        if (value === undefined) return this.nodes[0] ? this.nodes[0].cur_hp : 0;
        return this.eachNode((_, el) => {
            const node = el;
            if (node.max_hp <= 0) node.max_hp = Math.max(value, 1);
            node.cur_hp = Math.max(0, value);
        });
    });

    def('maxHp', function (value) { return this.eachNode((_, el) => { (el).max_hp = value; }); });

    def('damage', function (amount, source) {
        return this.eachNode((_, el) => {
            const node = el;
            if (node.iframes > 0 || node.cur_hp <= 0) return;
            node.cur_hp = Math.max(0, node.cur_hp - amount);
        });
    });

    def('heal', function (amount) {
        return this.eachNode((_, el) => {
            const node = el;
            node.cur_hp = Math.min(node.max_hp, node.cur_hp + amount);
        });
    });

    def('kill', function () {
        return this.eachNode((_, el) => { (el).cur_hp = 0; });
    });

    def('respawn', function (x, y) {
        return this.eachNode((_, el) => {
            const node = el;
            node.cur_hp = node.max_hp;
            if (x !== undefined) {
                node.x = x; node.y = y;
                if (node.body >= 0) { engine.setPosition(node.body, x, y, 0); engine.setVelocity(node.body, 0, 0); }
            }
        });
    });

    defGet('alive', (n) => n.cur_hp > 0 && !n.removed, false);
    def('team', function (id) { return this.eachNode((_, el) => { (el).team = id; }); });
    def('invulnerable', function (ms) {
        return this.eachNode((_, el) => {
            const node = el;
            node.iframes = (ms || 0) / 1000;
            if (ms > 0) noteEffect(node);   // подсистема эффектов должна проснуться
        });
    });

    // === События =============================================================

    def('on', function (name, fn) {
        return this.eachNode((_, el) => { (el).on(name, fn); });
    });
    def('off', function (name, fn) {
        return this.eachNode((_, el) => { (el).off(name, fn); });
    });
    def('emit', function (name, data) {
        return this.eachNode((_, el) => { (el).emit(name, data); });
    });
    def('trigger', function (name, data) { return Wrapper.prototype.emit.call(this, name, data); });

    // === Твины ===============================================================

    def('tween', function (spec, ms, ease) {
        const promises = [];
        this.eachNode((_, el) => promises.push(tweenProps(el, spec, ms, ease)));
        return Promise.all(promises);
    });
    def('tweenTo', function (spec, ms, ease) { return Wrapper.prototype.tween.call(this, spec, ms, ease); });

    def('rotateTo', function (deg, ms, ease) {
        const promises = [];
        this.eachNode((_, el) => promises.push(tweenProps(el, { angle: deg * Math.PI / 180 }, ms, ease)));
        return Promise.all(promises);
    });
    def('scaleTo', function (s, ms, ease) {
        const promises = [];
        this.eachNode((_, el) => promises.push(tweenProps(el, { scale: s }, ms, ease)));
        return Promise.all(promises);
    });
    def('fadeTo', function (value, ms, ease) {
        const promises = [];
        this.eachNode((_, el) => promises.push(tweenProps(el, { alpha: value }, ms, ease)));
        return Promise.all(promises);
    });
    def('delay', function (ms) { return wait(ms); });

    def('shake', function (intensity, ms) {
        return this.eachNode((_, el) => shakeNode(el, intensity || 6, ms || 250));
    });
    def('flash', function (color, ms) {
        return this.eachNode((_, el) => flashNode(el, packColor(color), ms || 120));
    });
    def('bounce', function (height, ms) {
        const promises = [];
        const h = height || 20;
        this.eachNode((_, el) => {
            const node = el;
            const y0 = node.y;
            promises.push((async () => {
                await tweenProps(node, { y: y0 - h }, (ms || 300) / 2, 'easeOutQuad');
                await tweenProps(node, { y: y0 }, (ms || 300) / 2, 'easeInQuad');
            })());
        });
        return Promise.all(promises);
    });

    def('sequence', function (steps) { return sequence(steps); });
    def('pauseTweens', function () { return this.eachNode((_, el) => pauseNodeTweens(el, true)); });
    def('resumeTweens', function () { return this.eachNode((_, el) => pauseNodeTweens(el, false)); });
    def('clearTweens', function () { return this.eachNode((_, el) => clearNodeTweens(el, true)); });

    // === Звук ================================================================

    def('sound', function (path) { return this.eachNode((_, el) => { (el).attrs.sound = path; }); });
    def('playSound', function (opts) {
        return this.eachNode((_, el) => {
            const node = el;
            if (!node.attrs.sound) return;
            ctx.sound.playAt(node.attrs.sound, node, opts);
        });
    });
    def('mute', function (flag) { return this.eachNode((_, el) => { (el).attrs.muted = flag !== false; }); });
    def('volume', function (v) { return this.eachNode((_, el) => { (el).attrs.sound_volume = v; }); });

    // === Иерархия ============================================================

    def('appendTo', function (parent) {
        const target = resolveContainer(parent);
        return this.eachNode((_, el) => {
            const node = el;
            detach(node);
            node.parent_node = target;
            if (target) target.child_nodes.push(node);
        });
    });

    def('prependTo', function (parent) { return Wrapper.prototype.appendTo.call(this, parent); });

    def('append', function (child) {
        const nodes = child instanceof Wrapper ? child.nodes : (child && child.tag ? [child] : []);
        return this.eachNode((_, el) => {
            const node = el;
            for (const c of nodes) {
                detach(c);
                c.parent_node = node;
                node.child_nodes.push(c);
            }
        });
    });
    def('prepend', function (child) { return Wrapper.prototype.append.call(this, child); });

    def('remove', function () { return this.eachNode((_, el) => { const n = el; if (n) n.destroy(); }); });

    def('detach', function () {
        return this.eachNode((_, el) => {
            const node = el;
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

    // Хранилище узла ленивое (см. Node: пустой Map на каждый узел — лишний
    // malloc), поэтому запись создаёт его, а чтение терпит null.
    def('data', function (key, value) {
        if (key === undefined) {
            const node = this.nodes[0];
            return node && node.data_store ? Object.fromEntries(node.data_store) : {};
        }
        if (typeof key === 'object') {
            return this.eachNode((_, el) => {
                const node = el;
                const store = node.dataMap();
                for (const k of Object.keys(key)) store.set(k, key[k]);
            });
        }
        if (value === undefined) {
            const node = this.nodes[0];
            return node && node.data_store ? node.data_store.get(key) : undefined;
        }
        return this.eachNode((_, el) => {
            const node = el;
            node.dataMap().set(key, value);
        });
    });

    def('attr', function (key, value) {
        // Без аргумента — только свободные атрибуты (совместимость).
        if (key === undefined) return this.nodes[0] ? { ...this.nodes[0].attrs } : {};
        if (typeof key === 'object') {
            return this.eachNode((_, el) => {
                const node = el;
                for (const k of Object.keys(key)) node.set(k, key[k]);
            });
        }
        // С аргументом — свойство или атрибут: .attr('id') читает id, а не
        // пустой attrs (иначе свойства узла были не видны через .attr()).
        if (value === undefined) {
            const node = this.nodes[0];
            return node ? node.get(key) : undefined;
        }
        return this.eachNode((_, el) => { const n = el; n.set(key, value); });
    });

    def('addClass', function (name) { return this.eachNode((_, el) => { (el).addClass(name); }); });
    def('removeClass', function (name) { return this.eachNode((_, el) => { (el).removeClass(name); }); });
    def('toggleClass', function (name, force) { return this.eachNode((_, el) => { (el).toggleClass(name, force); }); });
    defGet('hasClass', (n, name) => n.hasClass(name), false);
    def('tag', function (name) { return this.eachNode((_, el) => { (el).addTag(name); }); });
    def('addTag', function (name) { return this.eachNode((_, el) => { (el).addTag(name); }); });
    def('removeTag', function (name) { return this.eachNode((_, el) => { (el).removeTag(name); }); });

    // === Интерфейс и текст ===================================================

    def('text', function (value) {
        if (value === undefined) return this.nodes[0] ? this.nodes[0].text : '';
        return this.eachNode((_, el) => { (el).text = String(value); });
    });
    def('html', function (value) { return Wrapper.prototype.text.call(this, value); });
    /** Радиус и яркость источника света: $('<light>', { radius: 200 }). */
    def('radius', function (v) {
        if (v === undefined) return this.nodes.length ? this.nodes[0].radius : 0;
        return this.eachNode((_, el) => { (el).radius = v; });
    });
    def('intensity', function (v) {
        if (v === undefined) return this.nodes.length ? this.nodes[0].intensity : 1;
        return this.eachNode((_, el) => { (el).intensity = v; });
    });
    /** Кегль текста: $('<text>', { text: 'Привет' }).size(24). */
    def('fontSize', function (v) {
        if (v === undefined) return this.nodes.length ? this.nodes[0].size : 0;
        return this.eachNode((_, el) => { (el).size = v; });
    });

    def('value', function (v) {
        if (v === undefined) return this.nodes[0] ? this.nodes[0].value : 0;
        return this.eachNode((_, el) => { (el).value = v; });
    });
    def('max', function (v) { return this.eachNode((_, el) => { (el).max_value = v; }); });
    def('controls', function (scheme) {
        return this.eachNode((_, el) => {
            const node = el;
            if (!node.attrs.controls !== !scheme) touchRegistry();   // сводка кадра
            node.attrs.controls = scheme;
        });
    });

    // === Массовые операции ===================================================
    def('stopAll', function () { return this.eachNode((_, el) => { const n = el; if (n.body >= 0) engine.setVelocity(n.body, 0, 0); }); });
    def('pause', function () { return this.eachNode((_, el) => { const n = el; if (n.body >= 0) engine.setAwake(n.body, false); }); });
    def('wake', function () { return this.eachNode((_, el) => { const n = el; if (n.body >= 0) engine.setAwake(n.body, true); }); });
    /**
     * .sleeping() — спит ли тело (Box2D усыпляет неподвижные). Спящее тело не
     * считается физикой: полезно, чтобы не будить его лишней логикой.
     */
    defGet('sleeping', function (node) {
        return node.body >= 0 && typeof engine.isAwake === 'function'
            ? !engine.isAwake(node.body)
            : false;
    }, true);
    def('overlaps', function (what, cb) {
        const other = typeof what === 'string' ? query(what) : (what instanceof Wrapper ? what.nodes : []);
        if (typeof cb === 'function') {
            // Раньше здесь была подписка на событие 'tick', которое никто не
            // шлёт, — колбэк не вызывался никогда. Теперь наблюдатель
            // покадровый и живёт в подсистеме триггеров.
            return this.eachNode((_, el) => {
                const node = el;
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
    //
    // Метка ставится ДО работы, которую меряет: иначе отрезок записывается под
    // именем предыдущей подсистемы, и отчёт врёт на одну позицию (§1.3 отчёта).
    //
    // Профайлер выключен по умолчанию: 24 вызова engine.now() и 24 поиска в Map
    // по строке за кадр — плата ни за что в релизной игре (§3.7). Включается
    // явно: $.debug.profiler.on(true).
    const profiler = ($.debug && $.debug.profiler) || null;
    let prof_name = null;
    let prof_at = 0;
    function profilerMark(name) {
        if (profiler === null || profiler.enabled !== true) {
            prof_name = null;   // включили посреди кадра — начнём с чистого листа
            return;
        }
        const now = typeof engine.now === 'function' ? engine.now() : engine.time * 1000;
        if (prof_name !== null) profiler.record(prof_name, now - prof_at);
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

        // 5. $.ready — один раз, на первом кадре; дальше — код самой игры.
        //    Отрезок называется «логика игры», а не «окно»: под старым именем
        //    он мерил tickWindow(), а теперь это честно код игры (§1.3 отчёта).
        prof('логика игры');
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

        // 7. Подсистемы после аудита API. Порядок: сначала те, кто меняет
        //    состояние мира (анимация, частицы, навигация), затем слои и
        //    интерфейс, последней — шины звука (затухания громкости).
        //    Имя метки — это имя СВОЕГО отрезка: метка ставится до вызова.
        prof('анимация+ввод'); animateSprites(); tickWorldHover(); applyControls(dt);
        // Клипы, машины состояний и таймлайны тикают игровым временем, а не
        // сырым dt: иначе пауза и масштаб времени двигали твины, но не
        // анимацию персонажа. Интерфейс (экраны, диалоги, виджеты) остаётся
        // на реальном времени — кнопки обязаны работать и на паузе.
        const game_dt = ctx.time.delta();
        prof('анимация'); tickAnim(game_dt);
        prof('плеер анимации'); tickAnimPlayer(game_dt);
        prof('состояния'); tickState(game_dt);
        prof('последовательности'); tickFlow(dt);
        prof('экраны'); tickScreen(dt);
        prof('диалоги'); tickDialog(dt);
        prof('таймлайн'); tickTimeline(game_dt);
        prof('tilemap'); tickTilemap(dt);
        prof('vfx'); tickFx(dt);
        prof('частицы'); tickParticles(dt);
        prof('навигация'); tickNav(dt);
        prof('префабы'); tickPrefab(dt);
        prof('слои'); tickLayers(dt);
        prof('виджеты'); tickWidgets(dt);
        prof('триггеры'); tickTriggers(dt);
        prof('i18n'); tickI18n(dt);
        prof('пулы'); tickPool(dt);
        prof('вьюпорты'); tickViewport(dt);
        prof('http'); tickHttp(dt);
        prof('шины звука'); tickAudiobus(dt);
        prof('акустика'); tickAcoustics(dt);
        prof('интерфейс'); ctx.ui._tick();
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

/** Один узел из аргумента: узел, обёртка или селектор. */
function resolveNodeArg(target) {
    if (!target) return null;
    if (target instanceof Wrapper) return target.nodes[0] || null;
    if (target && target.tag) return target;
    if (typeof target === 'string') return query(target)[0] || null;
    return null;
}

/**
 * Биты слоёв из аргумента: число, узел, обёртка или селектор. Для нескольких
 * узлов биты складываются по ИЛИ — так .mask('.wall') означает «сталкиваться
 * со всеми слоями, в которых есть стены».
 */
function layerBitsOf(value) {
    if (typeof value === 'number') return value >>> 0;
    if (value === null || value === undefined) return 0;
    let list;
    if (value instanceof Wrapper) list = value.nodes;
    else if (value && value.tag) list = [value];
    else if (typeof value === 'string') list = query(value);
    else return 0;

    let bits = 0;
    for (let i = 0; i < list.length; i++) bits |= (list[i].layer_bits >>> 0);
    return bits >>> 0;
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

/**
 * Попадание курсора в мировые узлы.
 *
 * Раньше `:picked` был истиной только для ui-узлов (`hovered` ставил `ui._tick`),
 * а `$.input.mouseWorld()` не знал о параллаксе: узел в параллакс-слое рисуется
 * сдвинутым, и клик по нему промахивался на величину сдвига.
 *
 * Здесь обходим те узлы, у которых есть габарит и которых не рисует интерфейс:
 * совпадение по экранному прямоугольнику (zoom учитывается), позиция берётся из
 * `nodeScreenPos` — она верна и для параллакса.
 */
function tickWorldHover() {
    const nodes = liveNodes();
    const mx = engine.mouseX;
    const my = engine.mouseY;
    const zoom = ctx.camera ? (ctx.camera.zoom() || 1) : 1;
    let top = null;
    let top_score = -Infinity;

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.attrs && node.attrs.ui) continue;
        if (!node.visible || node.alpha <= 0) continue;
        if (node.w <= 0 || node.h <= 0) continue;

        const p = nodeScreenPos(node);
        const hw = Math.abs(node.w * (node.scale_x === undefined ? 1 : node.scale_x) * zoom) / 2;
        const hh = Math.abs(node.h * (node.scale_y === undefined ? 1 : node.scale_y) * zoom) / 2;
        const inside = !node._drop_queued &&
            Math.abs(mx - p.x) <= hw && Math.abs(my - p.y) <= hh;
        if (inside !== node.attrs.picked) {
            node.attrs.picked = inside;
            // :picked читает node.hovered (см. core.js) — держим его в курсе
            // для мировых узлов; ui-узлами занимается ui._tick.
            node.hovered = inside;
            if (inside) node.emit('mouseenter', {});
            else node.emit('mouseleave', {});
        }
        if (!inside) continue;

        // Верхним считается то, что позже в порядке отрисовки: layer, depth, y.
        const score = (node.layer || 0) * 1e6 + (node.depth || 0) * 1e3 + node.y;
        if (score >= top_score) { top_score = score; top = node; }
    }

    ctx.hovered = top;
    return top;
}

function applyControls(dt) {
    // Срез управляемых узлов держит индекс реестра: при пустом срезе нет ни
    // обхода мира, ни опроса ввода (§5, P2 отчёта).
    const nodes = nodesWithFacet('controls');
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const scheme = node.attrs.controls;
        if (!scheme || node.cur_hp <= 0) continue;
        const cfg = typeof scheme === 'string' ? { axis: scheme } : scheme;
        const axis_name = cfg.axis || 'both';
        const vec = ctx.input.vec(axis_name);
        // Скорость: явный атрибут → умолчание тега из TAGS (player 250,
        // enemy 90, npc 70) → запасное значение для тега без умолчания.
        const speed = node.attrs.speed !== undefined ? node.attrs.speed
            : (node.speed > 0 ? node.speed : (node.tag === 'player' ? 250 : 150));

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

/** Кадровый шаг спрайт-анимаций: ходит по срезу `anim` из индекса реестра. */
function animateSprites() {
    const dt = ctx.time.delta();
    if (dt <= 0) return;
    // Срез узлов со спрайт-анимацией держит индекс реестра: ни счётчика, ни
    // полного обхода мира (§5, P2 отчёта).
    const nodes = nodesWithFacet('anim');
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
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
