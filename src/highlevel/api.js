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

import { engine } from './native.js';
import {
    ctx, Node, Wrapper, TAGS, wrap, wrapOne, query, def, defGet,
    packColor, withAlpha, registerSelector, nodeBounds, boundsOverlap,
    makeRandom, dotSprite, resolveSprite, sheetFrames, regionSprite,
    nodesWithFacet, touchRegistry, beginBatch, endBatch, liveNodes, engineOf, nativeNodes,
    // §39/§40: локальные трансформы и независимые области (см. core.js).
    setWorldPosition, setWorldAngle, setWorldScale, worldScaleOf, isLocalSpace,
    enterLocalSpace, exitLocalSpace, worldPointOf, localPointOf, worldTransformOf,
    invalidateNodeTransform,
    installTransformResolution, areaDefine, areaEnable, areaFind, areaListOf,
    areaInfo, areaOverlap, areaByIndex, areaOwnerNode,
    flushPhysAttrReports } from './core.js';
import { installWorld } from './world.js';
import { installCamera, cameraTransform } from './camera.js';
import { installViewports } from './viewports.js';
import { installTime, tickTime } from './time.js';
import { installInput, shiftDown, ctrlDown, altDown } from './input.js';
import { installSound } from './sound.js';
import { installScene, tickLifecycle, installSceneRooms } from './scene.js';
import { installUi } from './ui.js';
import { installDebug } from './debug.js';
import { installDiag, report as diagReport } from './diag.js';
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
import { installReload } from './reload.js';   // §27: хот-релоад ассетов
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
import { installTask, tickTask } from './task.js';
import { installScript } from './script.js';
import { installStory } from './story.js';
import { installQuest } from './quest.js';
import { installSoundBank } from './soundbank.js';
import { installClip } from './clip.js';
import { installSteps, installBarks } from './steps.js';
import { installItems } from './items.js';
import { installCombat } from './combat.js';
import { installWeapons } from './weapons.js';
import { installRaid } from './raid.js';
import { installProc } from './proc.js';
import { installKinds } from './kinds.js';
// --- RE2D — необязательный слой 3D-авторинга спрайтов ------------------------
// Модули ниже ставятся только когда нативное ядро их собрало
// (R2D_ENABLE_RE2D=ON, см. src/CMakeLists.txt). В сборке платформера
// (`-DR2D_ENABLE_RE2D=OFF`) engine.re2d / engine.rotsprite / engine.real2d не
// существуют, и установка молча пропускается: $ остаётся обычным 2D-API.
// Проверка одна на файл — loadRe2dSupport() ниже.
import { installCels } from './cels.js';
import { installRe2d, re2dMove } from './re2d.js';
import { installRotSprite, tickRotSprite } from './rotsprite.js';
import { installReal2d, tickReal2d } from './real2d.js';
import { installMesh } from './mesh.js';
import { installAlive } from './alive.js';
import { installNet } from './net.js';
import { installReplay } from './replay.js';
import { installWidgets, tickWidgets } from './widgets.js';
import { installTriggers, tickTriggers, watchOverlap, processingAllows } from './triggers.js';
import { installWatch, tickWatch } from './watch.js';
import { installDevTools, tickDevTools } from './devtools.js';
import { installI18n, tickI18n } from './i18n.js';
import { installPool, tickPool } from './pool.js';
import { installViewport, tickViewport } from './viewport.js';
import { installHttp, tickHttp } from './http.js';
import { installSdk, tickSdk } from './sdk.js';
import { installCutscene, tickCutscene } from './cutscene.js';

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
/**
 * Какие параметры принимает эффект: имя → «число» | «цвет».
 *
 * Зачем таблица: раньше `.shader('wave', { amplitude: NaN })` и опечатка
 * (`{ amplitud: 0.5 }`) проходили МОЛЧА — параметр превращался в значение по
 * умолчанию, эффект «не работал», и узнать причину было неоткуда (пункт I13
 * отчёта BASHNYA). Теперь неизвестное имя и нечисло называют себя.
 */
const FX_PARAMS = {
    flash:    { amount: 'number', color: 'color' },
    dissolve: { threshold: 'number', scale: 'number', color: 'color' },
    chroma:   { offset: 'number', color: 'color' },
    wave:     { amplitude: 'number', amount: 'number', frequency: 'number',
                phase: 'number', time: 'number', color: 'color' },
};

/** Проверка одного параметра: '' — ок, иначе причина. */
function shaderParamProblem(effect, name, value) {
    const table = FX_PARAMS[effect];
    if (!table) return '';                       // свой шейдер: контракт p1..p3, color
    const kind = table[name];
    if (!kind) {
        return `неизвестный параметр "${name}" (у эффекта ${effect}: ${Object.keys(table).join(', ')})`;
    }
    if (kind === 'color') return '';             // цвет принимает строку/число/массив
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean' || !Number.isFinite(Number(value))) {
        return `параметр "${name}" должен быть числом, получено ${JSON.stringify(value)}`;
    }
    return '';
}

/** Сообщить о проблеме параметра: журнал + структурная ошибка. */
function reportShaderParam(where, effect, problem) {
    const message = `${where}: ${problem}`;
    const debug = ctx.$ && ctx.$._debug_public ? ctx.$._debug_public : (ctx.$ && ctx.$.debug);
    if (debug && typeof debug.reportError === 'function') {
        debug.reportError(where, message, {
            code: 'R2D_SHADER_PARAM_INVALID', subsystem: 'shader',
            recoverable: true, effect: String(effect),
        });
    } else {
        ctx.log('$: ' + message);
    }
}

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

/**
 * Собрано ли нативное ядро с RE2D (3D-авторинг спрайтов)?
 *
 * Единственная проверка, по которой `$` решает, ставить ли модули Re2D /
 * RotSprite / Real2D / mesh / cels. Движок с `-DR2D_ENABLE_RE2D=OFF`
 * (2D-платформерная сборка, см. src/CMakeLists.txt) не создаёт ни одного из
 * этих объектов `engine.*`, поэтому установка пропускается целиком — а не
 * падает на первом же `engine.re2d.*` внутри чужого модуля.
 *
 * Проверка живёт здесь, а не в отдельном «модуле возможностей», потому что
 * читает ровно то, что видит загрузчик: наличие нативных биндингов. Тесты
 * (tests/js/_harness.mjs) подставляют мок движка, поэтому проверка работает и
 * без бинарника: нет мока `engine.re2d` — нет и 3D-модулей.
 */
function re2dAvailable() {
    return !!(engine && engine.re2d && typeof engine.re2d.view === 'function');
}

/**
 * Собрано ли нативное ядро с RE2D — на весь запуск.
 *
 * Значение выставляет createApi() (см. re2dAvailable()), читают кадровый цикл
 * и applyControls: обе функции живут в этом же модуле, но вызываются после
 * установки. Модульная переменная, а не локальная в createApi(): обработчики
 * кадра — отдельные функции, локальную переменную они не видят
 * (ReferenceError: re2dSupport is not defined каждым кадром).
 */
let re2dSupport = false;

export function createApi() {
    // Один раз на весь запуск: наличие нативных RE2D-биндингов во время работы
    // не меняется (сборка либо с RE2D, либо без него).
    re2dSupport = re2dAvailable();
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
                // { parent } — та же дорога, что у .appendTo(): узел, обёртка
                // или СЕЛЕКТОР. Привязка делается здесь, а не в конструкторе:
                // к этому моменту применены все атрибуты (x/y/scale), поэтому
                // keep-world для локальных узлов считает позицию правильно, а
                // промах селектора попадает в журнал, а не в тишину (task-46).
                if (props && props.parent !== undefined) {
                    attachToTarget(wrapOne(node), props.parent, {}, 'parent');
                }
                // §5: узел, созданный в контексте $.scene.scope(...) или с
                // атрибутом { scope }, принадлежит области владения.
                if (typeof ctx.scopeTrack === 'function') ctx.scopeTrack(node);
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
    // §7: машиночитаемые ошибки физики. Ошибка лимита тел или отвергнутого
    // контура не должна жить только в логе: у игры и агента есть список фактов,
    // который можно разобрать и, при желании, отправить в $.debug.reportError.
    $.physics = {
        /** Ошибки физики: `{ total, overflow, errors: [{ code, body, shape, value, detail }] }`. */
        errors() {
            const eng = engineOf();
            if (typeof eng.physicsErrors !== 'function') return { total: 0, overflow: false, errors: [] };
            return eng.physicsErrors();
        },
        /** Перенести накопленные ошибки в журнал диагностики и очистить кольцо. */
        report() {
            const list = $.physics.errors();
            if (!list.errors.length) return 0;
            if ($.debug && typeof $.debug.reportError === 'function') {
                for (const e of list.errors) {
                    $.debug.reportError('physics', new Error(e.detail || e.code), {
                        code: e.code,
                        fatal: e.code === 'body_limit',
                    });
                }
            }
            if (typeof engineOf().clearPhysicsErrors === 'function') engineOf().clearPhysicsErrors();
            return list.errors.length;
        },
        /** Очистить кольцо ошибок. */
        clear() {
            if (typeof engineOf().clearPhysicsErrors === 'function') engineOf().clearPhysicsErrors();
        },
    };

    // Мультикамерность ставится ДО камеры: камера публикует её методы у себя
    // ($.camera.add/split/...), потому что для игры это одна подсистема.
    const viewports = installViewports($);
    installCamera($, viewports);
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
    installDevTools($);

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
    // §17: структурированные ошибки дописываются в УЖЕ опубликованный $.debug
    // (installDebug отдаёт объект через ctx, поэтому раньше он не виден).
    installDiag($);
    $.console = ctx.console;
    $.agent = ctx.agent;
    $.test = ctx.test;
    $.expect = ctx.expect;
    $.time = ctx.time;
    $.logger = ctx.log;
    $.easing = easeFunction;
    // Сид движка, если он есть: без движка (модульные тесты) — свой постоянный.
    const bootSeed = (typeof engine !== 'undefined' && engine && engineOf().seed !== undefined)
        ? engineOf().seed : 12345;
    $.random = makeRandom(bootSeed);
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
    /**
     * Все узлы по селектору — ОБЁРТКА, как у `$()` (task-58, H6).
     *
     * Раньше здесь был сырой массив узлов, и один и тот же по смыслу вызов вёл
     * себя по-разному: `$.find('.x')[0].get(0)` читал АТРИБУТ "0" (у сырого узла
     * `get` — геттер атрибутов), а `$('.x').get(0)` отдавал узел; у сырого узла
     * нет `.size()`, зато есть числовое поле `size`. Теперь тип один: обёртка
     * (итерируемая — `for…of` даёт узлы, есть `.length`, `.get(i)`, `.each`).
     * Сырой массив остался явным `$.findNodes(sel)`.
     */
    $.find = (sel) => wrap(query(sel));
    /** Сырые узлы по селектору — то, что `$.find` возвращал до 1.2.1. */
    $.findNodes = (sel) => query(sel);
    $.count = (sel) => query(sel).length;
    /**
     * Верхний мировой узел под курсором (или под точкой `{x, y}`/`[x, y]`).
     * Интерфейс не участвует: у ui-узлов свой обработчик (`$.ui`).
     * Порядок — тот же, что у отрисовки: layer, depth, затем Y.
     */
    $.pick = function (point) {
        // Без точки — просто то, что уже подсвечено курсором в этом кадре.
        if (point === undefined) return ctx.hovered ? wrapOne(ctx.hovered) : wrap([]);
        const world = resolvePoint(point, 'pick');
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
        const world = resolvePoint(point, 'pickAll');
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

    $.isAgent = () => !!engineOf().agent;
    $.quit = () => engineOf().quit();
    // Имя сцены из --scene (или null): то, что раньше игра читала как
    // engine.startScene. Известно до выполнения main.js, не меняется за сессию.
    $.startScene = engineOf().startScene || null;

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
    installSceneRooms($);        // §23: комнаты поверх $.scene/$.prefab/$.tilemap
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
    installSoundBank($);         // банки звуков: $.sound.playBank
    installClip($);              // клипы анимации: $.clip
    installSteps($);             // шаги по материалу: $.steps
    installBarks($);             // реплики NPC: $.barks
    installItems($);             // предметы и инвентарь: $.items, $.inv
    installCombat($);            // здоровье по зонам: $.combat
    installWeapons($);           // оружие и баллистика: $.weapons
    installRaid($);              // генерация рейда: $.raid
    installProc($);              // процедурный пиксель-арт: $.proc
    installKinds($);             // виды узла: .kind(), $.kinds
    installTrace($);             // журнал событий боя и сценария: $.trace (§13, §28)
    // RE2D-семейство — только если нативное ядро собрано с ним (см. re2dAvailable).
    // installKinds() выше ставится всегда: виды узлов нужны обычному 2D, а
    // $.Re2D в выключенной сборке остаётся строкой-константой, которую нечем
    // отрисовать — это честнее, чем отсутствующее поле (снимки и prefab'ы
    // переживают JSON, docs/highlevel/kinds.md).
    if (re2dAvailable()) {
        installCels($);              // граф кадров (псевдо-3D): $.cels
        installRotSprite($);         // развёртка всего персонажа: прототип головы
        installReal2d($);            // Real2D v4: вычисляемый layered warp (docs/highlevel/real2d.md)
        installRe2d($);              // Re2D: проход вида от первого лица, $.re2d (docs/RE2D.md)
        $.mesh = installMesh($);     // меш со скелетом: $.mesh
    }
    /**
     * Собрано ли нативное ядро с RE2D. `false` — сборка платформера
     * (`-DR2D_ENABLE_RE2D=OFF`): нет ни `$.re2d`, ни `$.rotsprite`, ни
     * `$.real2d`, ни `$.mesh`, ни `$.cels`. Поле нужно игре и инструментам,
     * чтобы отличить «выключено при сборке» от «я неправильно вызвал».
     */
    $.re2dEnabled = re2dSupport;
    installReplay($);            // реплеи: запись ввода и воспроизведение
    installCutscene($, placeBody);   // катсцены в текущей сцене: $.cutscene
    installAlive($);             // психика NPC и режиссёр рейда: $.alive
    installNet($);               // сеть, только авторитарная: $.net
    installWidgets($);
    installTriggers($);
    installI18n($);
    installPool($);
    installViewport($);
    installHttp($);
    installSdk($);               // мост инструментов SDK: $.sdk (включается project.json "toolHost")

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
    installWatch($);
    installFlow($);
    installFont($);
    installScreen($);
    installDialog($);
    // Таймлайн-сцены (диалоги и визуальные новеллы) — после диалогов: они
    // листают реплики через $.dialog и подписываются на его события.
    installTimeline($);
    installSave($);
    installResource($);
    // §27: хот-релоад ассетов — после ресурсов, атласа, интерфейса и скриптов:
    // он только пользуется их публичным API (граф зависимостей, версии,
    // отложенное освобождение) и ставит свой кадровый ход через $.update.
    installReload($);

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
        dt: engineOf().dt,
        frame: engineOf().frame,
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
    // === Идентичность =======================================================

    /**
     * Стабильный логический ID узла (`nid`, §4.2 и §14 Спецификации).
     *
     * Отличается от `uid` (номер создания, сбрасывается при перезагрузке
     * скриптов) и от нативного body id: переживает снимок узла, по нему
     * сопоставляется состояние между сохранением и загрузкой, он же попадает
     * в события (§13) для трассировки. Только чтение: ID выдаёт движок.
     */
    def('nid', function () {
        const node = this.nodes[0];
        return node ? node.nid : null;
    });

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
    //
    // §39: узел по умолчанию живёт в мировых координатах (прежнее поведение).
    // `.transformSpace('local')` включает локальный режим: координаты считаются
    // относительно родителя, а .at/.angle/.scale/.flip на таком узле по-прежнему
    // задают МИРОВЫЕ значения (пересчитываются в локальные) — совместимость.
    // Локальные значения задают .localAt/.localAngle/.localScale.
    installTransformResolution();

    def('at', function (x, y) {
        if (typeof x === 'object' && x !== null) { y = x.y; x = x.x; }
        return this.eachNode((_, el) => {
            const node = el;
            setWorldPosition(node, x, y);
        });
    });

    def('move', function (dx, dy) {
        if (typeof dx === 'object') { dy = dx.y; dx = dx.x; }
        return this.eachNode((_, el) => {
            const node = el;
            setWorldPosition(node, node.x + dx, node.y + dy);
        });
    });

    def('moveTo', function (x, y, ms, ease) {
        if (typeof x === 'object') { ease = ms; ms = y; y = x.y; x = x.x; }
        if (typeof x === 'string' || (x && x.tag) || x instanceof Wrapper) {
            // .moveTo('#hero', speed) — двигаться к цели с этой скоростью.
            return this.eachNode((_, el) => stepTowards(el, x, y, 'moveTo'));
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
            // H10: размер задан явно — смена листа его больше не перепишет.
            node.size_locked = true;
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
            setWorldAngle(node, (node.angle || 0) + deg * Math.PI / 180);
        });
    });
    def('angle', function (rad) {
        return this.eachNode((_, el) => {
            const node = el;
            setWorldAngle(node, rad);
        });
    });
    defGet('rotation', (n) => n.angle, 0);

    def('scale', function (sx, sy) {
        if (typeof sx === 'object') { sy = sx.y; sx = sx.x; }
        return this.eachNode((_, el) => {
            const node = el;
            setWorldScale(node, sx, sy === undefined ? sx : sy);
        });
    });

    // --- §39: локальные трансформы ------------------------------------------

    /**
     * Режим трансформа узла: `.transformSpace('local')` — координаты
     * относительно родителя, `.transformSpace('world')` — обратно (по
     * умолчанию мир). Без аргумента возвращает текущий режим строкой.
     *
     * Включение сохраняет вид: текущий мировой трансформ пересчитывается в
     * локальный, поэтому ни узел, ни его дети не двигаются.
     */
    def('transformSpace', function (mode) {
        if (mode === undefined) {
            const node = this.nodes[0];
            return node ? (isLocalSpace(node) ? 'local' : 'world') : 'world';
        }
        const local = String(mode) === 'local';
        return this.eachNode((_, el) => { if (local) enterLocalSpace(el); else exitLocalSpace(el); });
    });

    /**
     * Локальные координаты узла (относительно родителя). Включает локальный
     * режим. `.localAt()` без аргументов возвращает `{ x, y }`.
     */
    def('localAt', function (x, y) {
        if (x === undefined) {
            const node = this.nodes[0];
            return { x: node ? node.local_x || 0 : 0, y: node ? node.local_y || 0 : 0 };
        }
        if (typeof x === 'object' && x !== null) { y = x.y; x = x.x; }
        return this.eachNode((_, el) => {
            const node = el;
            enterLocalSpace(node);
            node.local_x = Number(x) || 0;
            node.local_y = Number(y) || 0;
            invalidateNodeTransform(node);
        });
    });

    /** Локальный угол (радианы). Без аргумента — геттер. */
    def('localAngle', function (rad) {
        if (rad === undefined) {
            const node = this.nodes[0];
            if (!node) return 0;
            return isLocalSpace(node) ? (node.local_angle || 0) : (node.angle || 0);
        }
        return this.eachNode((_, el) => {
            const node = el;
            enterLocalSpace(node);
            node.local_angle = Number(rad) || 0;
            invalidateNodeTransform(node);
        });
    });

    /** Локальный масштаб (знаковый). Без аргумента — `{ x, y }`. */
    def('localScale', function (sx, sy) {
        if (sx === undefined) {
            const node = this.nodes[0];
            if (!node) return { x: 1, y: 1 };
            return {
                x: isLocalSpace(node) ? (node.local_scale_x === undefined ? 1 : node.local_scale_x) : node.scale_x,
                y: isLocalSpace(node) ? (node.local_scale_y === undefined ? 1 : node.local_scale_y) : node.scale_y,
            };
        }
        if (typeof sx === 'object' && sx !== null) { sy = sx.y; sx = sx.x; }
        return this.eachNode((_, el) => {
            const node = el;
            enterLocalSpace(node);
            node.local_scale_x = Number(sx);
            node.local_scale_y = sy === undefined ? node.local_scale_x : Number(sy);
            if (!Number.isFinite(node.local_scale_x)) node.local_scale_x = 1;
            if (!Number.isFinite(node.local_scale_y)) node.local_scale_y = node.local_scale_x;
            invalidateNodeTransform(node);
        });
    });

    /**
     * Точка в локальном пространстве узла → мировая координата:
     * `$('#weapon').worldPoint(0, -12)` — дуло. Учитывает всю цепочку
     * родителей, поворот и знаковый масштаб; камера не участвует.
     */
    defGet('worldPoint', function (node, lx, ly) {
        if (lx !== undefined && typeof lx === 'object' && lx !== null) { ly = lx.y; lx = lx.x; }
        return worldPointOf(node, Number(lx) || 0, Number(ly) || 0);
    }, { x: 0, y: 0 });

    /** Мировая точка → локальное пространство узла (обратное к .worldPoint()). */
    defGet('localPoint', function (node, wx, wy) {
        if (wx !== undefined && typeof wx === 'object' && wx !== null) { wy = wx.y; wx = wx.x; }
        return localPointOf(node, Number(wx) || 0, Number(wy) || 0);
    }, { x: 0, y: 0 });

    /** Мировой трансформ узла с учётом цепочки: `{ x, y, angle, sx, sy }`. */
    defGet('worldTransform', function (node) {
        const t = worldTransformOf(node);
        return { x: t.x, y: t.y, angle: t.angle, sx: t.sx, sy: t.sy };
    }, { x: 0, y: 0, angle: 0, sx: 1, sy: 1 });

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
            const p = resolvePoint(target, 'lookAt');
            setWorldAngle(node, Math.atan2(p.y - node.y, p.x - node.x));
        });
    });

    def('flip', function (x, y) {
        return this.eachNode((_, el) => {
            const node = el;
            // Знаковый масштаб — мировой (скомпонованный): у локального узла он
            // пересчитывается в локальный, поэтому зеркало наследуется детьми.
            const s = worldScaleOf(node);
            let sx = s.x;
            let sy = s.y;
            if (x !== undefined) sx = Math.abs(sx) * (x ? -1 : 1);
            if (y !== undefined) sy = Math.abs(sy) * (y ? -1 : 1);
            if (x !== undefined || y !== undefined) setWorldScale(node, sx, sy);
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
        const p = resolvePoint(target, 'distanceTo');
        return Math.hypot(p.x - node.x, p.y - node.y);
    }, 0);

    defGet('directionTo', function (node, target) {
        const p = resolvePoint(target, 'directionTo');
        const d = Math.hypot(p.x - node.x, p.y - node.y) || 1;
        return { x: (p.x - node.x) / d, y: (p.y - node.y) / d };
    }, { x: 0, y: 0 });

    defGet('angleTo', function (node, target) {
        const p = resolvePoint(target, 'angleTo');
        return Math.atan2(p.y - node.y, p.x - node.x);
    }, 0);

    defGet('rayTo', function (node, target) {
        const p = resolvePoint(target, 'rayTo');
        return ctx.world.raycast({ x: node.x, y: node.y }, p);
    }, null);

    /**
     * Ищет препятствие для хитбокса узла на пути к цели: свип формы из центра
     * узла в точку цели. Возвращает тот же дескриптор, что
     * `$.world.castShape`, либо null. Размеры берутся из хитбокса узла, их
     * можно перебить через `opts` (`w`, `h`, `capsule`, `mask`, `ignore`).
     */
    defGet('sweepTo', function (node, target, opts) {
        const p = resolvePoint(target, 'sweepTo');
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

    /**
     * Показать конкретный кадр листа: `.frame(3)`.
     *
     * Меняет и `node.sprite` (что рисуется), и `node.frame_index` (какой это
     * кадр): поле читают prefab-сериализация (§14), сохранение и DevTools, и
     * раньше его двигали только дорожки `.animate()` — после `.stopAnim();
     * .frame(0)` рисовался кадр 0, а `frame_index` оставался последним кадром
     * анимации (A4 отчёта BASHNYA). Индекс вне листа ничего не меняет: состояние
     * остаётся согласованным с нарисованным спрайтом.
     */
    def('frame', function (index) {
        return this.eachNode((_, el) => {
            const node = el;
            if (!node.frames) return;
            // Приводим к целому числу: frame_index — публичное число, строка или
            // дробь в нём ломали бы prefab и сравнение с frames.indexOf(sprite).
            // null/undefined — «кадра не просили»: ничего не меняем.
            if (index === null || index === undefined) return;
            const i = Math.trunc(Number(index));
            if (!Number.isFinite(i) || node.frames[i] === undefined) return;
            node.sprite = node.frames[i];
            node.frame_index = i;
        });
    });

    /**
     * Анимация по кадрам листа: `.animate({ from: 0, to: 5, speed: 12, loop: true })`
     * или по именованному клипу: `.animate({ clip: 'walk' })` / `.animate('walk')`.
     *
     * Клип (`$.clip.define`) задаёт кадры (в том числе с РАЗНЫХ листов), `fps`,
     * `loop` и `pivot`; пивот двигает только точку вращения — размер узла клип
     * не меняет (граница с H10).
     */
    def('animate', function (spec) {
        const cfg = typeof spec === 'object' && spec !== null ? spec : { clip: spec };
        const clip_name = cfg.clip === undefined && typeof spec === 'string' ? spec : cfg.clip;
        return this.eachNode((_, el) => {
            const node = el;
            if (clip_name !== undefined && clip_name !== null) {
                const clip = ctx._clip && typeof ctx._clip._raw === 'function'
                    ? ctx._clip._raw(clip_name) : null;
                if (!clip) {
                    ctx.log(`$: .animate("${clip_name}") — клип не объявлен (см. $.clip.define)`);
                    return;
                }
                node.frames = clip.frames.slice();
                node.setSprite(node.frames[0]);
                // Обработчики клипа (onEnd/onFrame) — подписка на события ЭТОГО
                // узла; повторное применение снимает прежние подписки, чтобы не
                // копились (иначе клик «доиграл» выстрелил бы дважды).
                if (node._clip_events) {
                    if (node._clip_events.end) node.off('anim:end', node._clip_events.end);
                    if (node._clip_events.frame) node.off('anim:frame', node._clip_events.frame);
                    node._clip_events = null;
                }
                if (clip.onEnd || clip.onFrame) {
                    node._clip_events = {
                        end: clip.onEnd ? (e) => clip.onEnd(e.data) : null,
                        frame: clip.onFrame ? (e) => clip.onFrame(e.data) : null,
                    };
                    if (node._clip_events.end) node.on('anim:end', node._clip_events.end);
                    if (node._clip_events.frame) node.on('anim:frame', node._clip_events.frame);
                }
                node.anim = {
                    from: 0,
                    to: node.frames.length - 1,
                    speed: clip.fps,
                    loop: clip.loop,
                    t: 0,
                    playing: true,
                    clip: clip.name,
                };
                if (clip.pivot) {
                    node.pivot_x = clip.pivot[0];
                    node.pivot_y = clip.pivot[1];
                }
                touchRegistry();
                return;
            }
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

    /**
     * Обрезать узел прямоугольником: `.clip(true)` — по своей коробке,
     * `.clip({x, y, w, h})` — по экранным координатам, `.clip(false)` — снять.
     *
     * Обрезка действует ТОЛЬКО на этот узел: после него клип возвращается как
     * был, поэтому соседи не обрезаются. Для контейнера с детьми поставьте
     * обрезку каждому ребёнку (дети — отдельные узлы, они не наследуют).
     */
    def('clip', function (value) {
        return this.eachNode((_, el) => {
            const n = el;
            if (value === undefined || value === true) n.attrs.clip = true;
            else if (value === false || value === null) delete n.attrs.clip;
            else n.attrs.clip = value;
        });
    });
    defGet('clipRect', (n) => (n.attrs && n.attrs.clip) ? n.attrs.clip : null, null);

    /**
     * Глубина ОТНОСИТЕЛЬНО родителя: `.depthRelative(true)`.
     *
     * Абсолютная (по умолчанию): узел сравнивается с другими по своему `depth`.
     * Относительная: складывается с глубиной родителя, поэтому весь контейнер
     * можно поднять одним вызовом, не пересчитывая детей.
     */
    def('depthRelative', function (on) {
        return this.eachNode((_, el) => { (el).depth_relative = on !== false; });
    });
    defGet('isDepthRelative', (n) => n.depth_relative === true, false);

    /** Эффективная глубина с учётом родителя — для отладки порядка. */
    defGet('effectiveDepth', (n) => ctx.gfx.effectiveDepth(n), 0);

    /** Эффективная прозрачность с учётом родителей. */
    defGet('effectiveAlpha', (n) => ctx.gfx.effectiveAlpha(n), 1);

    /** Виден ли узел с учётом родителей. */
    defGet('effectivelyVisible', (n) => ctx.gfx.effectiveVisible(n), true);

    /**
     * Добавить телу узла ещё одну ФОРМУ-ЗОНУ: `.zone({ type, w, h, tag })`.
     *
     * Несколько форм на тело — это «попал в голову, а не в ногу»: в
     * `$.world.contactBetween` приходят `shapeA`/`shapeB` и теги зон.
     *
     * ```js
     * $('#hero').zone({ type: 'box', w: 40, h: 24, tag: 'head' });
     * ```
     *
     * Имя `zone`, а не `shape`: `.shape()` уже занято формой хитбокса.
     */
    def('zone', function (opts) {
        const out = [];
        this.eachNode((_, el) => out.push(ctx.world.zone(el, opts)));
        return out.length === 1 ? out[0] : out;
    });
    defGet('zoneCount', (n) => ctx.world.zoneCount(n), 0);

    // --- §40: независимые области одного владельца ---------------------------
    //
    // Область — native-форма на теле узла со своей ролью, локальным
    // смещением/углом, слоями и признаком enabled. Несколько областей живут
    // независимо: движение (основная форма тела), contact circle, weapon rect
    // не влияют друг на друга, а выключение одной не трогает остальные.
    //
    // Описания живут на узле и возвращаются на место после пересоздания тела
    // (.size(), .sensor(), .collision()), поэтому внутреннее представление не
    // меняет gameplay, а дедупликация атак в игре держится на имени/attack-id,
    // а не на native handle (§40).

    /**
     * Объявить или обновить область: `#hero.area('sword', { shape: 'box',
     * w: 48, h: 20, x: 14, angle: -0.3, sensor: true, role: 'attack',
     * enabled: false })`.
     *
     * Повторный вызов меняет только переданные поля; `enabled` управляет
     * участием в столкновениях и запросах, не удаляя область и не трогая
     * видимость узла (`.hide()` — отдельная операция).
     */
    def('area', function (name, opts) {
        if (name === undefined) return this;
        if (opts === undefined) {
            const node = this.nodes[0];
            const area = node ? areaFind(node, String(name)) : null;
            return area ? areaInfo(node, area) : null;
        }
        return this.eachNode((_, el) => areaDefine(el, String(name), opts));
    });

    /**
     * Включить/выключить область: `.areaOn('sword', true)`. Мутация возвращает
     * обёртку (цепочка), как остальные сеттеры; без второго аргумента —
     * текущее состояние (`bool`).
     */
    def('areaOn', function (name, on) {
        if (on === undefined) {
            const node = this.nodes[0];
            const area = node ? areaFind(node, String(name)) : null;
            return area ? area.enabled !== false : false;
        }
        return this.eachNode((_, el) => areaEnable(el, String(name), on));
    });

    /** Все области узла: `[{ name, role, enabled, sensor, x, y, angle, … }]`. */
    defGet('areas', function (node) {
        const list = areaListOf(node);
        if (!list) return [];
        const out = [];
        for (let i = 0; i < list.length; i++) out.push(areaInfo(node, list[i]));
        return out;
    }, []);

    // §9. Роли форм — метаданные области существующего узла, не компоненты.
    // Основная форма тела — movement collider; области получают роль и живут
    // по общим правилам §40 (локальное смещение, свой слой, вкл/выкл).
    const ROLE_METHODS = {
        hitbox: 'hitbox',        // чем бьём: обычно sensor, окно атаки
        hurtbox: 'hurtbox',      // куда бьют: цель урона
        interaction: 'interaction',   // подбор/двери/зоны взаимодействия
    };
    for (const method of Object.keys(ROLE_METHODS)) {
        const role = ROLE_METHODS[method];
        def(method, function (name, opts) {
            if (name === undefined) return this;
            const spec = Object.assign({ role }, opts || {});
            // Роли — зоны смысла, а не препятствия: по умолчанию сенсор.
            // Явный `sensor: false` делает форму физической (щит, стена).
            if (spec.sensor === undefined) spec.sensor = true;
            return this.eachNode((_, el) => areaDefine(el, String(name), spec));
        });
    }

    /**
     * Кто пересекается с областью ПРЯМО СЕЙЧАС — явная overlap policy §40.
     * Цель, уже находящаяся внутри в момент открытия окна атаки, находится этим
     * вызовом без ожидания нового движения; выключенная область не возвращает
     * никого. Результат: `[{ node, owner, body, shape, area, role }]`, где
     * `node` — узел цели, `owner` — логический владелец области.
     *
     * Фильтр — как у ВСЕХ запросов движка (`$.world.raycast`,
     * `$.world.queryPoint/Box/Circle`, `engine.castShape`): у запроса нет
     * своего слоя, поэтому решает ТОЛЬКО маска области, а маска цели не
     * участвует. Иначе маска чужого тела решала бы, увидит ли его моя область
     * (A3 отчёта BASHNYA: цель со слоем 0x2 и маской 0x1|0x4 не находилась
     * областью со слоем 0x8, хотя область её видит).
     *
     * Осознанное исключение одно и то же во всех запросах: тело с маской 0
     * («не сталкивается ни с кем») Box2D не отдаёт ни одному запросу.
     *
     * Прежний двусторонний фильтр Box2D (маска цели тоже проверяется) остался
     * доступен явно: `{ both: true }` — для кода, который на него полагался.
     */
    defGet('areaOverlap', function (node, name, opts) {
        const o = opts || {};
        // Двусторонний режим по явной просьбе (или свой слой запроса задан
        // вручную): ядро возьмёт слой области, и Box2D проверит фильтр в обе
        // стороны — ровно как до A3.
        if (o.both === true || o.category !== undefined) {
            return areaOverlap(node, String(name), o);
        }
        // Односторонний запрос: категория запроса — «все биты» (у запроса нет
        // слоя), маска — маска области. Ровно это делает r2d__query_filter для
        // лучей и запросов в C.
        return areaOverlap(node, String(name), Object.assign({}, o, { category: 0xFFFFFFFF }));
    }, []);
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
        // `null`, `false`, `'none'` и пустая строка — все означают «снять
        // эффект». Раньше `false` уходил в ветку «неизвестный эффект» и узел
        // МОЛЧА оставался со старым шейдером: выключить искажение из игры было
        // нельзя, только пересоздать узел (пункт E10 отчёта BASHNYA).
        const off = value === null || value === false || value === 0 || value === ''
            || String(value) === 'none';
        if (!off && !this.nodes.length) {
            ctx.log(`$: .shader("${value}") — узел не найден (пустая выборка), `
                  + 'эффект не поставлен');
            return this;
        }
        const custom = !off && ctx.gfx && typeof ctx.gfx.userShaders === 'function'
            && ctx.gfx.userShaders().indexOf(String(value)) >= 0;
        if (!off && !FX_NAMES.has(String(value)) && !custom) {
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
            if (off) {
                node.shader_name = null;
                node.shader_params = null;
                return;
            }
            node.shader_name = String(value);
            const raw = params === undefined ? {} : Object.assign({}, params);
            const clean = {};
            for (const key of Object.keys(raw)) {
                const problem = shaderParamProblem(String(value), key, raw[key]);
                if (problem) { reportShaderParam(`.shader("${value}")`, value, problem); continue; }
                clean[key] = raw[key];
            }
            node.shader_params = clean;
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
            // Один параметр проверяем так же, как набор в .shader(): опечатка и
            // NaN должны называть себя, а не превращаться в «по умолчанию».
            const problem = shaderParamProblem(node.shader_name, String(name), value);
            if (problem) {
                reportShaderParam(`.shaderParam("${name}")`, node.shader_name, problem);
                return;
            }
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
            return node && node.body >= 0 ? vectorOf(engineOf().getVelocity(node.body)) : { x: 0, y: 0 };
        }
        if (typeof vx === 'object') { vy = vx.y; vx = vx.x; }
        return this.eachNode((_, el) => {
            const node = el;
            if (node.body >= 0) engineOf().setVelocity(node.body, vx, vy);
            node.velocity_cache = { x: vx, y: vy };
        });
    });

    def('applyForce', function (fx, fy) {
        // Box2D v3 в обёртке движка отдаёт только импульс — для 2D этого хватает:
        // сила = импульс / dt, чтобы поведение совпадало по ощущениям.
        const k = 1 / Math.max(engineOf().dt, 1 / 240);
        return Wrapper.prototype.applyImpulse.call(this, fx * k * 0.02, fy * k * 0.02);
    });

    def('applyImpulse', function (ix, iy) {
        if (typeof ix === 'object') { iy = ix.y; ix = ix.x; }
        return this.eachNode((_, el) => {
            const node = el;
            if (node.body >= 0) engineOf().applyImpulse(node.body, ix, iy);
        });
    });

    /**
     * CCD: `$('#bullet').bullet(true)`. Быстрое тело проверяется непрерывно —
     * без этого пуля за подшаг проходит десятки пикселей и проскакивает тонкие
     * стены (дефект §1.3). Box2D просит тратить bullets экономно.
     */
    def('bullet', function (on) {
        this.eachNode((_, el) => {
            const node = el;
            node.bullet_on = on === undefined ? true : on !== false;
            if (node.body >= 0) engineOf().setBullet(node.body, node.bullet_on);
        });
        return this;   // цепочка: $('...').bullet(true).velocity(…)
    });

    def('gravity', function (on) {
        return this.eachNode((_, el) => {
            const node = el;
            node.gravity_on = on !== false;
            node.no_gravity = false;
            if (node.body >= 0) engineOf().setGravityScale(node.body, node.gravity_on ? 1 : 0);
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

    /**
     * Спрыгнуть вниз с односторонней платформы: на `ms` игрового времени
     * (по умолчанию 250) её контакт с этим телом выключен, и узел падает
     * сквозь. Обычно вызывать не нужно — встроенное управление само делает
     * это по S/↓+Space, пока узел стоит НА односторонней платформе
     * (см. [PHILOSOPHY.md] и .controls()).
     *
     * Платформу метод не трогает: на ней могут стоять другие тела, и
     * проваливается только вызвавший.
     */
    def('dropThrough', function (ms) {
        return this.eachNode((_, el) => {
            const node = el;
            if (node.body < 0) return;
            const ground = probeGround(node);
            const platform = ground && ground.node && ground.node.one_way ? ground.node : null;
            startDropThrough(node, platform, ms === undefined ? 250 : ms);
        });
    });

    /**
     * §8. Внешняя скорость узла (урон, отдача, ветер) на `ms` игрового
     * времени: `.externalVelocity(vx, vy, 150)`. Скрипт управления прибавляет
     * её к своей скорости, поэтому импульс урона не стирается следующим тиком;
     * сама она линейно затухает до нуля.
     *
     * Без аргументов возвращает `{ x, y, ms, left }` или `null`.
     */
    def('externalVelocity', function (vx, vy, ms) {
        if (vx === undefined) {
            const node = this.nodes[0];
            const e = node && node.ext_vel;
            return e ? { x: e.x, y: e.y, ms: e.ms * 1000, left: Math.max(0, e.left) * 1000 } : null;
        }
        if (typeof vx === 'object' && vx !== null) { ms = vy; vy = vx.y; vx = vx.x; }
        return this.eachNode((_, el) => { setExternalVelocity(el, vx, vy, ms); });
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
     *
     * Второй аргумент — опции: `{ stay: true }` добавляет фазу 'stay' (касание
     * продолжается) для этого тела. Stay — opt-in: обход контактов тела каждый
     * кадр не бесплатный.
     */
    def('contacts', function (on, opts) {
        if (on === undefined) return this.nodes.length ? this.nodes[0].contacts_enabled : false;
        const stay = !!(opts && opts.stay);
        return this.eachNode((_, el) => {
            const node = el;
            node.contacts_enabled = on !== false;
            if (node.body >= 0) node.syncBodySize();
            setContactStay(node, node.contacts_enabled && stay);
        });
    });

    /**
     * Фаза 'stay' отдельно: `.contactsStay(true)` — узел получает событие
     * 'stay' каждый кадр, пока касается (в дополнение к begin/end/hit).
     */
    def('contactsStay', function (on) {
        if (on === undefined) return this.nodes.length ? !!this.nodes[0].contacts_stay : false;
        return this.eachNode((_, el) => setContactStay(el, on !== false));
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
        const id = engineOf().createJoint({
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
        const bits = layerBitsOf(value, 'mask');
        if (bits === null) return this;
        return this.eachNode((_, node) => { node.set('mask', bits); });
    });

    /** .layerBits() — слой тела; .layerBits(bits|узел|селектор) — задать. */
    def('layerBits', function (value) {
        if (arguments.length === 0) {
            const node = this.nodes[0];
            return node ? node.layer_bits : 1;
        }
        const bits = layerBitsOf(value, 'layerBits');
        if (bits === null) return this;
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
            const other = resolveNodeArg(target, 'collidesWith');
            if (!other) return false;
            if (self.collision_group !== 0 && self.collision_group === other.collision_group) {
                return self.collision_group > 0;
            }
            return ((self.collision_mask & (other.layer_bits >>> 0)) !== 0) &&
                   ((other.collision_mask & (self.layer_bits >>> 0)) !== 0);
        }

        const bits = layerBitsOf(target, 'collidesWith');
        if (bits === null) return this;
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
     *
     * Геометрия одна на всех: тот же луч, что у встроенного управления
     * (probeGround), — иначе «стою на земле» и «могу прыгнуть» разошлись бы.
     */
    defGet('onFloor', function (node) {
        return probeGround(node) !== null;
    }, false);

    /** Касается ли стены слева или справа — луч тоже из центра узла. */
    defGet('onWall', function (node) {
        const b = nodeBounds(node);
        const opts = { mask: node.collision_mask };
        const left = ctx.world.raycast({ x: node.x, y: node.y }, { x: b.x0 - 8, y: node.y }, opts);
        const right = ctx.world.raycast({ x: node.x, y: node.y }, { x: b.x1 + 8, y: node.y }, opts);
        return !!((left && left.body !== node.body) || (right && right.body !== node.body));
    }, false);

    /**
     * §8. Опора узла: не «истина/ложь», а данные —
     * `{ on, body, node, x, y, nx, ny, slope, distance, vx, vy, oneWay }`.
     *
     * `null` — опоры нет. Опора ищется лучами ПО ШИРИНЕ тела (центр и края), а
     * не центральным лучом: на кромке платформы центр уже вне опоры, хотя ноги
     * ещё стоят. `slope` — угол поверхности от вертикали в радианах (0 —
     * ровный пол), `vx`/`vy` — скорость опоры (движущаяся платформа несёт
     * стоящего).
     */
    defGet('ground', function (node, opts) {
        const g = probeGround(node, opts);
        if (!g) return null;
        return {
            on: true,
            body: g.body,
            node: g.node ? wrapOne(g.node) : null,
            x: g.x, y: g.y,
            nx: g.nx, ny: g.ny,
            slope: g.slope,
            slopeDegrees: g.slope * 180 / Math.PI,
            distance: g.distance,
            vx: g.vx, vy: g.vy,
            oneWay: g.oneWay,
            hit: g.hit,
        };
    }, null);

    /** §8. Потолок над узлом: лучи по ширине тела вверх. → bool. */
    defGet('onCeiling', function (node) {
        return probeCeiling(node) !== null;
    }, false);

    /** Двигаться в сторону цели со скоростью. dt не нужен: скорость в px/с. */
    def('moveTowards', function (target, speed) {
        return this.eachNode((_, el) => stepTowards(el, target, speed, 'moveTowards'));
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
            const [, vy] = engineOf().getVelocity(node.body);
            engineOf().setVelocity(node.body, engineOf().getVelocity(node.body)[0],
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
                if (node.body >= 0) { engineOf().setPosition(node.body, x, y, 0); engineOf().setVelocity(node.body, 0, 0); }
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
    //
    // §39: у привязки есть политика keep-world / keep-local. Для узла в
    // мировом режиме (прежние проекты) не меняется ничего: его x/y абсолютны,
    // и после appendTo он остаётся на месте. Для локального узла по умолчанию
    // сохраняется мировая позиция (`{ keep: 'world' }`), а `{ keep: 'local' }`
    // оставляет локальные координаты — узел переезжает в систему родителя.

    def('appendTo', function (parent, opts) {
        return attachToTarget(this, parent, opts, 'appendTo');
    });

    def('prependTo', function (parent, opts) {
        return attachToTarget(this, parent, opts, 'prependTo');
    });

    def('append', function (child, opts) {
        const nodes = resolveChildNodes(child, 'append');
        if (!nodes) return this;
        const keep = keepPolicy(opts);
        return this.eachNode((_, el) => {
            const node = el;
            for (const c of nodes) attachNode(c, node, keep);
        });
    });
    def('prepend', function (child, opts) {
        const nodes = resolveChildNodes(child, 'prepend');
        if (!nodes) return this;
        const keep = keepPolicy(opts);
        return this.eachNode((_, el) => {
            const node = el;
            for (const c of nodes) attachNode(c, node, keep);
        });
    });

    // Несколько узлов разом — одна уборка реестра в конце вызова, как в
    // $.batch: иначе каждый destroy() искал свой узел и сдвигал хвост
    // массива, и $('.enemy').remove() на N узлах стоил O(N²) (§0.6 отчёта).
    // К возврату из remove() реестр уже чист — снаружи разницы нет.
    def('remove', function () {
        const nodes = this.nodes;
        if (nodes.length > 1) beginBatch();
        try {
            for (let i = 0; i < nodes.length; i++) if (nodes[i]) nodes[i].destroy();
        } finally {
            if (nodes.length > 1) endBatch();
        }
        return this;
    });

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
    def('stopAll', function () { return this.eachNode((_, el) => { const n = el; if (n.body >= 0) engineOf().setVelocity(n.body, 0, 0); }); });
    def('pause', function () { return this.eachNode((_, el) => { const n = el; if (n.body >= 0) engineOf().setAwake(n.body, false); }); });
    def('wake', function () { return this.eachNode((_, el) => { const n = el; if (n.body >= 0) engineOf().setAwake(n.body, true); }); });
    /**
     * .sleeping() — спит ли тело (Box2D усыпляет неподвижные). Спящее тело не
     * считается физикой: полезно, чтобы не будить его лишней логикой.
     */
    // Угловая скорость тела, рад/с: `.angularVelocity()` — прочитать,
    // `.angularVelocity(w)` — задать всем узлам выборки. У узла без тела — 0.
    def('angularVelocity', function (w) {
        if (w === undefined) {
            const node = this.nodes[0];
            return node && node.body >= 0 && typeof engineOf().getAngularVelocity === 'function'
                ? engineOf().getAngularVelocity(node.body) : 0;
        }
        return this.eachNode((_, node) => {
            if (node.body >= 0) engineOf().setAngularVelocity(node.body, Number(w) || 0);
        });
    });
    // Масса тела, кг (32 px = 1 м, плотность из attrs.density). Без тела — 0.
    defGet('mass', function (node) {
        return node.body >= 0 && typeof engineOf().bodyMass === 'function' ? engineOf().bodyMass(node.body) : 0;
    }, 0);
    // Разрешить Box2D усыплять тело (по умолчанию да). `false` нужен, если
    // игра двигает тело скоростью: уснувшее тело перестаёт её слушать.
    def('allowSleep', function (on) {
        return this.eachNode((_, node) => {
            if (node.body >= 0 && typeof engineOf().setSleeping === 'function') {
                engineOf().setSleeping(node.body, on !== false);
            }
        });
    });

    defGet('sleeping', function (node) {
        return node.body >= 0 && typeof engineOf().isAwake === 'function'
            ? !engineOf().isAwake(node.body)
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
    // Профайлер выключен по умолчанию: 24 вызова engineOf().now() и 24 поиска в Map
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
        const now = typeof engineOf().now === 'function' ? engineOf().now() : engineOf().time * 1000;
        if (prof_name !== null) profiler.record(prof_name, now - prof_at);
        prof_name = name;
        prof_at = now;
    }

    engineOf().setUpdate((dt) => {
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
        // Катсцена тикает ДО applyControls: иначе гейт ввода опоздает на кадр
        // и герой «проползёт» лишние пиксели (docs/TASKS.md §3).
        prof('катсцена'); tickCutscene(dt);
        prof('анимация+ввод'); animateSprites(); tickWorldHover(); applyControls(dt);
        // Отложенные сообщения о физических атрибутах, выставленных после
        // создания тела (§6.6): проверяем раз в кадр, когда уже видно,
        // пересоздавали тело или нет.
        flushPhysAttrReports();
        // Клипы, машины состояний и таймлайны тикают игровым временем, а не
        // сырым dt: иначе пауза и масштаб времени двигали твины, но не
        // анимацию персонажа. Интерфейс (экраны, диалоги, виджеты) остаётся
        // на реальном времени — кнопки обязаны работать и на паузе.
        const game_dt = ctx.time.delta();
        // RE2D-тикалки — только когда модули поставлены (см. re2dAvailable()).
        // Сборка без RE2D не должна платить за два вызова в кадре, которых не
        // к чему применять.
        prof('анимация'); tickAnim(game_dt);
        if (re2dSupport) tickRotSprite(dt, game_dt);
        if (re2dSupport) { prof('real2d'); tickReal2d(game_dt); }
        prof('плеер анимации'); tickAnimPlayer(game_dt);
        prof('состояния'); tickState(game_dt);
        prof('последовательности'); tickFlow(dt);
        // §5: задачи кусками тикает один общий насос (без хука $.update на
        // каждую задачу), а области владения закрываются в безопасной фазе —
        // после контактов и отложенных изменений.
        prof('задачи'); tickTask(dt);
        prof('области'); tickLifecycle(dt);
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
        prof('наблюдения'); tickWatch();
        prof('devtools'); tickDevTools();
        prof('i18n'); tickI18n(dt);
        prof('пулы'); tickPool(dt);
        prof('вьюпорты'); tickViewport(dt);
        prof('http'); tickHttp(dt);
        prof('sdk'); tickSdk(dt);
        prof('шины звука'); tickAudiobus(dt);
        prof('акустика'); tickAcoustics(dt);
        prof('интерфейс'); ctx.ui._tick();
        prof(null);
    });

    engineOf().setRender(() => {
        if (!frame.running) return;
        // Обрезки живут кадр и задаются заново. Сброс ЗДЕСЬ, а не в _render:
        // игра ставит клип в $.render / scene.render, которые идут раньше, и
        // сброс внутри _render стирал бы его перед самой отрисовкой.
        ctx.gfx.clipReset();
        const scene = ctx.scene._state.current;
        if (scene && typeof scene.render === 'function') {
            try { scene.render($); } catch (e) { reportError('render сцены', e); }
        }
        for (const fn of frame.render) {
            try { fn(engineOf().dt, $); } catch (e) { reportError('$.render', e); }
        }
        ctx.gfx._render();
        ctx.debug._render();
    });

    // engineOf().quit() перехватывать нечем — выход обрабатывает движок.
    engineOf().setExit(() => {
        for (const fn of frame.exit) {
            try { fn($); } catch (e) { reportError('$.exit', e); }
        }
    });
}

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

function detach(node) {
    const parent = node.parent_node;
    if (parent) {
        const i = parent.child_nodes.indexOf(node);
        if (i >= 0) parent.child_nodes.splice(i, 1);
        node.parent_node = null;
    }
    // §39: у локального узла после отвязки корнем становится он сам, поэтому
    // мировой трансформ складывается в локальные поля — узел не переезжает.
    if (isLocalSpace(node)) {
        node.local_x = node.x;
        node.local_y = node.y;
        node.local_angle = node.angle;
        node.local_scale_x = node.scale_x;
        node.local_scale_y = node.scale_y;
        invalidateNodeTransform(node);
    }
}

/** Политика переноса узла: 'world' (по умолчанию) или 'local' (§39). */
function keepPolicy(opts) {
    if (typeof opts === 'string') return opts === 'local' ? 'local' : 'world';
    if (opts && typeof opts === 'object' && opts.keep === 'local') return 'local';
    return 'world';
}

/**
 * §39: привязать узел к новому родителю. Мировой узел не меняется вовсе
 * (прежнее поведение); локальный по умолчанию сохраняет мировую позицию
 * (keep-world), а `{ keep: 'local' }` оставляет локальные значения.
 * Перенос в собственного потомка отклоняется: цикл в цепочке родителей
 * сломал бы композицию трансформа.
 */
function attachNode(node, target, keep) {
    if (target && (target === node || isDescendant(node, target))) {
        ctx.log('$.appendTo: нельзя привязать узел к своему потомку — перенос пропущен');
        return;
    }
    const local = isLocalSpace(node);
    const wx = node.x;
    const wy = node.y;
    const wa = node.angle;
    const ws = local ? worldScaleOf(node) : null;
    detach(node);
    node.parent_node = target;
    if (target) target.child_nodes.push(node);
    if (!local) return;
    if (keep === 'local') {
        invalidateNodeTransform(node);
        return;
    }
    // keep-world: локальные значения выводятся заново из нового родителя.
    setWorldPosition(node, wx, wy);
    setWorldAngle(node, wa);
    if (ws) setWorldScale(node, ws.x, ws.y);
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
 *
 * Строку-селектор разрешает `resolveAttachTarget` (там же сообщение о промахе):
 * «мир» и «цель не найдена» — разные вещи, и путать их нельзя, иначе промах
 * выглядел бы как «узел уехал в мир».
 */
const MISS = { miss: true };

function resolveContainer(parent) {
    if (parent === null || parent === undefined) return null;
    if (parent === ctx.world || parent === ctx.$.world) return null;
    if (parent instanceof Wrapper) return parent.nodes[0] || null;
    if (parent && parent.tag) return parent;
    return null;
}

/**
 * Точка из аргумента: `{x, y}`, массив, узел, обёртка или селектор.
 *
 * `method` — имя публичного метода для сообщения о промахе селектора: раньше
 * `$('#hero').lookAt('#нет-такого')` молча целился в (0, 0). Поведение
 * (запасная точка) сохранено, но теперь о промахе сказано в журнале.
 */
    // Цель-контейнер у appendTo/prependTo: строка-селектор разрешается так же,
// как в `$(selector)` (task-46: раньше строковая форма — ровно та, что
// стоит в доке, — молча ни к чему не прикрепляла узел). Промах селектора не
// тишина: пишем в журнал и НЕ прикрепляем (иначе узел уехал бы в мир, то
// есть выглядел бы прикреплённым не туда).
function resolveAttachTarget(parent, method) {
    if (typeof parent === 'string') {
        const found = query(parent);
        if (!found.length) {
            ctx.log(`$.${method}: селектор "${parent}" ни к чему не подошёл — узел не прикреплён`);
            return MISS;
        }
        if (found.length > 1) {
            ctx.log(`$.${method}: селектор "${parent}" подошёл к ${found.length} узлам — беру первый`);
        }
        return found[0];
    }
    if (parent instanceof Wrapper) {
        if (!parent.nodes.length) {
            ctx.log(`$.${method}: обёртка пуста (селектор ни к чему не подошёл) — узел не прикреплён`);
            return MISS;
        }
        return parent.nodes[0];
    }
    return resolveContainer(parent);
}

function attachToTarget(api, parent, opts, method) {
    const target = resolveAttachTarget(parent, method);
    if (target === MISS) return api;
    const keep = keepPolicy(opts);
    return api.eachNode((_, el) => attachNode(el, target, keep));
}

    // Дети для .append()/.prepend(): узел, обёртка или селектор. Раньше всё,
// что не узел и не обёртка, молча игнорировалось — теперь про это сказано.
function resolveChildNodes(child, method) {
    if (child instanceof Wrapper) return child.nodes;
    if (child && child.tag) return [child];
    if (typeof child === 'string') {
        const found = query(child);
        if (!found.length) {
            ctx.log(`$.${method}: селектор "${child}" ни к чему не подошёл — узлы не добавлены`);
            return null;
        }
        return found;
    }
    ctx.log(`$.${method}: ожидался узел, обёртка или селектор, а получено `
          + `${child === null ? 'null' : typeof child} — ничего не добавлено`);
    return null;
}

function resolvePoint(target, method) {
    if (typeof target === 'string') {
        const node = query(target)[0];
        if (!node) {
            ctx.log(`$.${method || 'цель'}: селектор "${target}" ни к чему не подошёл — `
                  + 'беру точку (0, 0)');
            return { x: 0, y: 0 };
        }
        return { x: node.x, y: node.y };
    }
    if (target instanceof Wrapper) {
        const node = target.nodes[0];
        if (!node) {
            ctx.log(`$.${method || 'цель'}: обёртка пуста (селектор ни к чему не подошёл) — `
                  + 'беру точку (0, 0)');
            return { x: 0, y: 0 };
        }
        return { x: node.x, y: node.y };
    }
    if (target && target.tag) return { x: target.x, y: target.y };
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    if (target && typeof target === 'object') return { x: target.x || 0, y: target.y || 0 };
    return { x: 0, y: 0 };
}

/** Один узел из аргумента: узел, обёртка или селектор. */
function resolveNodeArg(target, method) {
    if (!target) return null;
    if (target instanceof Wrapper) {
        if (!target.nodes.length && method) {
            ctx.log(`$.${method}: обёртка пуста (селектор ни к чему не подошёл)`);
        }
        return target.nodes[0] || null;
    }
    if (target && target.tag) return target;
    if (typeof target === 'string') {
        const node = query(target)[0];
        if (!node && method) {
            ctx.log(`$.${method}: селектор "${target}" ни к чему не подошёл`);
        }
        return node || null;
    }
    return null;
}

/**
 * Биты слоёв из аргумента: число, узел, обёртка или селектор. Для нескольких
 * узлов биты складываются по ИЛИ — так .mask('.wall') означает «сталкиваться
 * со всеми слоями, в которых есть стены».
 *
 * `null` — селектор ни к чему не подошёл: вызывающий обязан НЕ менять маску.
 * Раньше промах давал 0 бит, то есть типичная опечатка в `.mask('#стена')`
 * молча выключала столкновения у узла (task-46).
 */
function layerBitsOf(value, method) {
    if (typeof value === 'number') return value >>> 0;
    if (value === null || value === undefined) return 0;
    let list;
    if (value instanceof Wrapper) {
        if (!value.nodes.length) {
            if (method) ctx.log(`$.${method}: обёртка пуста — биты слоя не изменены`);
            return null;
        }
        list = value.nodes;
    } else if (value && value.tag) list = [value];
    else if (typeof value === 'string') {
        list = query(value);
        if (!list.length) {
            ctx.log(`$.${method || 'layerBits'}: селектор "${value}" ни к чему не подошёл — `
                  + 'биты слоя не изменены');
            return null;
        }
    } else return 0;

    let bits = 0;
    for (let i = 0; i < list.length; i++) bits |= (list[i].layer_bits >>> 0);
    return bits >>> 0;
}

function vectorOf(list) { return { x: list[0], y: list[1] }; }

function stepTowards(node, target, speed, method) {
    if (!node) return;
    const p = resolvePoint(target, method);
    const dx = p.x - node.x;
    const dy = p.y - node.y;
    const d = Math.hypot(dx, dy);
    const v = (typeof speed === 'object' && speed !== null && speed.speed !== undefined) ? speed.speed : (speed || 100);

    if (d <= 1) {
        if (node.body >= 0) engineOf().setVelocity(node.body, 0, 0);
        node.emit('arrived', {});
        return;
    }
    if (node.body >= 0) {
        engineOf().setVelocity(node.body, (dx / d) * v, (dy / d) * v);
    } else {
        // У узла без тела нет инерции: двигаем ровно на шаг кадра.
        const dt = engineOf().dt;
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
const hover_params = new Float64Array(13);

// --- Журнал трассировки (§13, §28) -------------------------------------------
// Требование Спецификации: игровой сценарий должен быть воспроизводим в
// журнале — по hit ID найти источник, контакт, решение фильтра и результат
// урона. Журнал выключен по умолчанию и стоит одну проверку булева флага на
// событие (не аллокацию): включение — opt-in через `$.trace.on(true)`.
//
// Хранится кольцевой буфер фиксированной длины: диагностика не должна расти
// вместе с длительностью боя (§28: «debug buffers ограничены»).
const TRACE_LIMIT = 256;
const trace_ring = new Array(TRACE_LIMIT);
let trace_head = 0;
let trace_count = 0;
let trace_on = false;
let trace_dropped = 0;

/** Записать запись в журнал. Дёшево: объект строится только при включении. */
function noteTrace(kind, a, b, extra) {
    const entry = {
        n: trace_count + trace_dropped,
        kind,
        frame: ctx.time && typeof ctx.time.frame === 'function' ? ctx.time.frame() : -1,
        source: a ? a.nid : null,
        target: b ? b.nid : null,
        data: extra === undefined ? null : extra,
    };
    if (trace_count >= TRACE_LIMIT) { trace_dropped++; trace_head = (trace_head + 1) % TRACE_LIMIT; }
    trace_ring[(trace_head + trace_count) % TRACE_LIMIT] = entry;
    if (trace_count < TRACE_LIMIT) trace_count++; else trace_count = TRACE_LIMIT;
}

/**
 * Цепочка по hit ID: общая реализация для `$.trace.hit` и `$.trace.hits`.
 *
 * Чистая функция от журнала — её же проверяет юнит-тест без движка.
 */
function chainOf(list, hitId) {
    const id = hitId === undefined || hitId === null ? null : hitId;
    const wanted = id === null ? null : String(id);
    const steps = [];
    let owner = null, target = null;
    for (const entry of list) {
        const d = entry.data || {};
        const ids = [d.attack, d.attackId, d.hit, d.id];
        const match = id === null
            ? (entry.kind === 'attack' || entry.kind === 'damage' || entry.kind === 'death')
            : ids.some((v) => v !== undefined && v !== null && String(v) === wanted);
        if (!match) continue;
        steps.push({ kind: entry.kind, node: entry.source || entry.target || null,
                     frame: entry.frame, data: d });
        if (entry.kind === 'attack') owner = entry.source;
        if (entry.target) target = entry.target;
    }
    const kinds = new Set(steps.map((x) => x.kind));
    return {
        found: steps.length > 0,
        hit: id,
        owner, target,
        steps,
        // «Полная» цепочка — та, где видно решение фильтра И результат: именно
        // это требование §28 («источник, контакт, решение фильтра и damage
        // result»), а не просто наличие записи.
        complete: kinds.has('attack') && kinds.has('combat:filter') && kinds.has('damage'),
    };
}

/** Публичный журнал: массив записей в порядке появления + счётчик потерь. */
function traceSnapshot() {
    const out = [];
    for (let i = 0; i < trace_count; i++) out.push(trace_ring[(trace_head + i) % TRACE_LIMIT]);
    return out;
}

function installTrace($) {
    $.trace = {
        /**
         * Включить/выключить запись. Журнал opt-in: цена в выключенном
         * состоянии — одна проверка флага на событие, а не объект.
         */
        on(value) {
            if (value === undefined) return trace_on;
            trace_on = value !== false;
            return trace_on;
        },
        /** Записи в порядке появления (без копирования внутренних ссылок). */
        list() { return traceSnapshot(); },
        /** Сколько записей вытеснено переполнением кольца. */
        dropped() { return trace_dropped; },
        /** Очистить журнал и счётчик потерь. */
        clear() { trace_count = 0; trace_head = 0; trace_dropped = 0; trace_ring.length = 0; trace_ring.length = TRACE_LIMIT; },
        /**
         * Цепочка по hit ID (§28): источник → контакт → решение фильтра →
         * результат урона.
         *
         * ```js
         * const chain = $.trace.hit(7);
         * // { found, complete, steps: [{ kind, node, frame, data }…], owner, target }
         * ```
         *
         * `hit` — id события атаки (его отдают `$.combat.attack()` и
         * `$.combat.attacks()`). По нему видно, ЧЕМ ударили, ЧТО столкнулось,
         * каким было решение фильтра и что стало с целью — без чтения кода боя.
         */
        hit(hitId) { return chainOf(traceSnapshot(), hitId); },

        /** Все цепочки в журнале: `[{ hit, steps, complete }…]`. */
        hits() {
            const ids = new Set();
            for (const entry of traceSnapshot()) {
                const d = entry.data || {};
                const id = d.attack === undefined ? d.attackId : d.attack;
                if (id !== undefined && id !== null) ids.add(id);
            }
            return [...ids].map((id) => chainOf(traceSnapshot(), id));
        },

        /** Запись игры: `$.trace.note('phase', node, {…})` — для сюжетных шагов. */
        note(kind, node, data) {
            if (!trace_on) return false;
            noteTrace(String(kind), node || null, null, data === undefined ? null : data);
            return true;
        },
        limit: TRACE_LIMIT,
    };
}

function tickWorldHover() {
    const nodes = liveNodes();
    const mx = engineOf().mouseX;
    const my = engineOf().mouseY;
    const zoom = ctx.camera ? (ctx.camera.zoom() || 1) : 1;
    let top = null;
    let top_score = -Infinity;

    // Нативный проход (src/nodes.c): попадание и «верхний» узел считает C,
    // а на узле, у которого попадание сменилось, отдаёт управление сюда —
    // mouseenter/mouseleave рассылаются в том же порядке, что и раньше.
    const native = nativeNodes();
    if (native) {
        if (nodes.length === 0) { ctx.hovered = null; return null; }
        const cam = cameraTransform();
        const P = hover_params;
        P[0] = mx; P[1] = my; P[2] = zoom;
        P[3] = cam.x; P[4] = cam.y;
        P[5] = cam.w && cam.w > 0 ? cam.w / 2 : engineOf().width / 2;
        P[6] = cam.h && cam.h > 0 ? cam.h / 2 : engineOf().height / 2;
        P[7] = cam.shake_x || 0; P[8] = cam.shake_y || 0;
        P[9] = ctx.time && typeof ctx.time.frame === 'function' ? ctx.time.frame() : -1;
        P[10] = cam.zoom || 1;
        P[11] = -Infinity; P[12] = -1;
        let i = native.hover(nodes, 0, P);
        while (i >= 0) {
            const node = nodes[i];
            node.emit(node.hovered ? 'mouseenter' : 'mouseleave', {});
            i = native.hover(nodes, i + 1, P);
        }
        top = P[12] >= 0 ? nodes[P[12]] : null;
        ctx.hovered = top;
        return top;
    }

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

// Запись позиции узла в его тело: режиссёр катсцены двигает узлы, а узел с
// телом каждый кадр перезаписывается из физики — без этой записи NPC стоит на
// месте (нашлось тестом: он сдвинулся на один кадр и замер).
function placeBody(node) {
    if (!node || node.body < 0) return;
    engineOf().setPosition(node.body, node.x, node.y, node.angle);
}

// --- Встроенное управление: тайминги прыжка --------------------------------
//
// Всё, что решает «прыгать или нет», живёт в чистых функциях без движка: их
// проверяет tests/js/controls_test.mjs под QuickJS за секунды. applyControls
// только читает ввод, зовёт их и применяет результат к телу.
//
// Время здесь — накопленная сумма dt, а не номер кадра: при --fixed-dt,
// переменном шаге и замедлении окно в 120 мс означает одно и то же
// (PHILOSOPHY.md §2.8 про детерминизм, §2.11 про замеры).

/** Число из настройки: нечисло и undefined дают умолчание. */
function ctlNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Миллисекунды настройки → секунды игрового времени. */
function ctlSeconds(value, fallback_ms) {
    return Math.max(0, ctlNum(value, fallback_ms)) / 1000;
}

/**
 * Множитель «обрезания» прыжка при отпускании кнопки. `true` — 0.35,
 * число в (0,1) — как задано, всё прочее (0, 1, мусор) — выключено.
 */
function ctlJumpCut(value) {
    if (value === true) return 0.35;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0;
}

/** Клавиши «вниз» для спрыгивания: зависят от раскладки оси. */
// Массивы общие и не меняются: applyControls зовётся каждый кадр на каждый
// управляемый узел, и новая аллокация на узел здесь ни к чему.
const CTL_DROP_BOTH = ['s', 'down'];
const CTL_DROP_WASD = ['s'];
const CTL_DROP_ARROWS = ['down'];

function ctlDropKeys(axis) {
    if (axis === 'arrows') return CTL_DROP_ARROWS;
    if (axis === 'wasd') return CTL_DROP_WASD;
    return CTL_DROP_BOTH;
}

// §8: на сколько пикселей ниже ступней луч ищет опору. Меньше — теряет землю
// на мелких ступеньках и склонах, больше — «прилипает» на прыжке.
const GROUND_TOLERANCE = 8;

// ---------------------------------------------------------------------------
// §6.3. Удержание стоящего на склоне
//
// Стоящий на склоне игрок без ввода сползал вниз ровно и бесконечно: шаг
// физики идёт ДО апдейта скрипта, гравитация за шаг разгоняет тело вдоль
// склона, а контроллер каждый кадр переписывал горизонтальную скорость нулём.
// Тело из-за этого не засыпало, а трение по умолчанию (0.2 < tan 30° = 0.577)
// его не удерживало. Замер до правки: 11.0 px за 120 кадров, одинаково в
// каждом следующем окне (55 px за 600 кадров) — «ползёт вечно».
//
// Лечится это скоростью, без телепортов и без правки позиции: контроллер
// помнит, на сколько пикселей тело сдвинулось за прошлый кадр, и выставляет
// скорость так, чтобы следующий шаг не сдвинул его снова:
//
//     v ← v_прошлая − Δx / dt
//
// Это статическое трение контроллера, и оно обратная связь по измеренному
// сносу, а не константа: где Box2D держит сам (μ > tan θ), снос нулевой и
// скорость остаётся нулевой; на другом наклоне, трении или шаге физики
// удержание само подстраивается под фактический снос (проверено на 30° с
// трением 0.2 и 1.0 — снос 0.000 px за 120 кадров в обоих случаях).
//
// Удержание включается только там, где оно нужно, и не трогает остальное:
//   * пол наклона от HOLD_SLOPE_DEG (на ровном полу поведение прежнее);
//   * ввод по оси отсутствует, игрок уже стоит (своя скорость нулевая);
//   * опора не движется (перенос платформой — не наше дело) и внешней
//     скорости (урон, отдача) на узле нет;
//   * нужная скорость не больше g·dt: больше гравитация за кадр телу не
//     добавит ни на каком склоне, значит это толчок — держать его нельзя.
// ---------------------------------------------------------------------------

//: Пол наклона опоры, с которого включается удержание (градусы).
const HOLD_SLOPE_DEG = 2;
//: Нижняя граница скорости удержания (px/с): шум решателя удержание не включает.
const HOLD_SPEED_MIN = 8;

/**
 * Предел скорости удержания: какую скорость контроллер вправе выставить
 * «стоячему» узлу, чтобы погасить сползание. Гравитация за кадр может добавить
 * телу не больше g·dt (вертикальный склон — предельный случай), поэтому большая
 * скорость — это уже толчок или удар, и держать её контроллер не вправе.
 */
function holdSpeedLimit(dt) {
    let g = 0;
    const world = ctx.world;
    if (world && typeof world.gravity === 'function') {
        const grav = world.gravity();
        if (grav) g = Math.hypot(Number(grav.x) || 0, Number(grav.y) || 0);
    }
    return Math.max(HOLD_SPEED_MIN, g * Math.max(0, Number(dt) || 0));
}

/**
 * §7. Включить/выключить фазу 'stay' у тела узла.
 *
 * Флаг живёт в нативном теле, поэтому после пересоздания тела
 * (`.size()`, `.collision()`, `.sensor()`) его нужно поставить снова —
 * вызовите `.contacts(true, { stay: true })` последним.
 */
function setContactStay(node, on) {
    node.contacts_stay = !!on;
    const eng = engineOf();
    if (node.body >= 0 && typeof eng.setContactStay === 'function') {
        eng.setContactStay(node.body, node.contacts_stay);
    }
}

/** Приблизить значение к цели не быстрее `maxDelta` (px/с² → px/с за кадр). */
export function approachValue(current, target, maxDelta) {
    const cur = Number(current) || 0;
    const dst = Number(target) || 0;
    const step = Math.max(0, Number(maxDelta) || 0);
    const delta = dst - cur;
    if (Math.abs(delta) <= step) return dst;
    return cur + (delta > 0 ? step : -step);
}

/**
 * Схема управления со умолчаниями. Строка — сокращение для `{ axis }`,
 * поэтому `.controls('both')` работает как раньше, а настройки — необязательные
 * поля объекта: чего нет, то ведёт себя по-старому.
 */
export function controlsScheme(scheme) {
    const cfg = typeof scheme === 'string' ? { axis: scheme } : (scheme || {});
    const axis = cfg.axis || 'both';
    return {
        cfg,
        axis,
        jump_key: cfg.jump || 'space',
        up_key: cfg.up || 'w',
        // По умолчанию оба окна нулевые: существующие игры не получают
        // прыжков, которых раньше не было (PHILOSOPHY.md §2.10). Включаются
        // осознанно: .controls({ coyote: 100, jumpBuffer: 120 }).
        coyote: ctlSeconds(cfg.coyote, 0),
        jump_buffer: ctlSeconds(cfg.jumpBuffer, 0),
        jump_cut: ctlJumpCut(cfg.jumpCut),
        air_jumps: Math.max(0, Math.floor(ctlNum(cfg.airJump, 0))),
        // Спрыгивание — часть односторонних платформ, а не украшение: по
        // умолчанию включено, выключается `dropThrough: false`.
        drop: cfg.dropThrough !== false,
        drop_time: Math.max(0, ctlNum(cfg.dropTime, 250)),
        drop_keys: cfg.drop ? (Array.isArray(cfg.drop) ? cfg.drop : [cfg.drop]) : ctlDropKeys(axis),
        // §8: ускорение/торможение в px/с². 0 — мгновенная скорость, как было
        // до появления опции: старые игры не меняют ощущение управления.
        accel: Math.max(0, ctlNum(cfg.accel, 0)),
        decel: Math.max(0, ctlNum(cfg.decel, 0)),
        air_accel: Math.max(0, ctlNum(cfg.airAccel, 0)),
        // §8: допустимый угол поверхности в градусах. 90 — любая опора
        // считается землёй (прежнее поведение). Круче лимита — не земля:
        // персонаж скользит и не прыгает.
        max_slope: Math.min(90, Math.max(0, ctlNum(cfg.maxSlope, 90))),
    };
}

/** Состояние таймингов прыжка одного узла (живёт, пока жив узел). */
export function makeControlsState() {
    return { t: 0, coyote_until: 0, buffer_until: 0, air_left: 0, jumping: false, self_vx: 0 };
}

/**
 * Один шаг таймингов прыжка. Чистая функция: меняет только `state` и
 * сообщает, что сделать с телом.
 *
 * `input`: { pressed, released, down, grounded, oneWay, vy }.
 * Возврат: { jump, air, cut, drop } — `jump` прыгнуть, `air` это воздушный
 * прыжок, `cut` множитель скорости при обрезании, `drop` спрыгнуть вниз.
 */
export function controlsTimingStep(state, s, dt, input) {
    if (dt > 0) state.t += dt;
    const out = { jump: false, air: false, cut: 0, drop: false };

    // Прыжок завершён, когда тело перестало подниматься. Без этого отпускание
    // кнопки в падении «обрезало» бы падение, а не подъём.
    if (state.jumping && input.vy >= 0) state.jumping = false;

    if (input.grounded) {
        state.coyote_until = state.t + s.coyote;
        state.air_left = s.air_jumps;
    }
    if (input.pressed) state.buffer_until = state.t + s.jump_buffer;

    // Спрыгивание проверяется ДО прыжка: вниз — это не вверх. Нажатие при
    // этом считается израсходованным, иначе буфер тут же прыгнул бы от земли.
    if (s.drop && input.pressed && input.down && input.oneWay) {
        state.buffer_until = 0;
        out.drop = true;
    } else if (input.pressed || state.buffer_until > state.t) {
        // Право на прыжок: земля, ещё не истёкшая coyote-фора или запас
        // воздушных прыжков.
        if (input.grounded || state.coyote_until > state.t) {
            out.jump = true;
        } else if (state.air_left > 0) {
            out.jump = true;
            out.air = true;
            state.air_left--;   // запас расходуется: следующий прыжок — только от земли
        }
        if (out.jump) {
            state.buffer_until = 0;
            state.coyote_until = 0;
            state.jumping = true;
        }
    }

    if (s.jump_cut && input.released) {
        // Тап (нажатие и отпускание в одном кадре) — сразу короткий прыжок:
        // иначе «отпустил» опоздало бы на кадр и высота не отличалась бы.
        if (out.jump || (state.jumping && input.vy < 0)) {
            out.cut = s.jump_cut;
            state.jumping = false;
        }
    }
    return out;
}

/**
 * §8. Что под ногами: опора и её свойства.
 *
 * Центрального луча мало: на самом краю платформы центр тела уже вне опоры,
 * хотя ноги ещё стоят — и персонаж «терял землю» на кромке. Поэтому опора
 * ищется НЕСКОЛЬКИМИ лучами по ширине тела (края с отступом и центр), вниз до
 * низа тела + tolerance. Побеждает самый «горизонтальный» (коллинеарный земле)
 * луч, при равенстве — ближайший.
 *
 * `null` — опоры нет. Иначе: тело и узел опоры, точка и нормаль контакта,
 * расстояние, угол поверхности (`slope`, радианы; 0 — ровная земля) и скорость
 * опоры (`vx`/`vy`, px/с) — движущаяся платформа несёт стоящего на ней.
 */
export function groundSlope(nx, ny) {
    // Опора «вверх» в экранных координатах — отрицательный Y. Угол считаем от
    // вертикали: ровный пол даёт 0, стеноподобная поверхность — π/2.
    const up = -ny;
    const len = Math.hypot(nx, ny);
    if (!(len > 1e-6)) return Math.PI / 2;
    return Math.atan2(Math.abs(nx) / len, up / len);
}

/** Точка опоры одним лучом: `null`, если под этой точкой ничего нет. */
function groundRay(node, x, bottom, tolerance) {
    // Маска узла: с чем тело не сталкивается, на том и не стоит.
    const hit = ctx.world.raycast({ x, y: node.y }, { x, y: bottom + tolerance },
                                  { mask: node.collision_mask });
    if (!hit || hit.body === node.body) return null;
    return hit;
}

/** Опоры по ширине тела. Отступ от краёв — чтобы не задевать соседние стены. */
function groundProbePoints(node, b) {
    const inset = Math.min(4, (b.x1 - b.x0) * 0.25);
    return [b.x0 + inset, node.x, b.x1 - inset];
}

function probeGround(node, opts) {
    const b = nodeBounds(node);
    const tolerance = opts && opts.tolerance !== undefined
        ? Math.max(0, Number(opts.tolerance) || 0) : GROUND_TOLERANCE;
    const points = groundProbePoints(node, b);
    let best = null;
    for (let i = 0; i < points.length; i++) {
        const hit = groundRay(node, points[i], b.y1, tolerance);
        if (!hit) continue;
        const slope = groundSlope(hit.normal.x, hit.normal.y);
        const distance = Math.hypot(hit.point.x - node.x, hit.point.y - node.y);
        const candidate = {
            hit, body: hit.body, node: hit.node || null,
            x: hit.point.x, y: hit.point.y,
            nx: hit.normal.x, ny: hit.normal.y,
            slope, distance,
        };
        // Односторонняя платформа — опора, только если тело НАД её лицевой
        // стороной. При подъёме снизу луч ещё видит её верх, и без этой
        // проверки onFloor() два кадра рапортовал «на земле», пока тело внутри
        // платформы: нажатый в этот момент прыжок считался прыжком с земли
        // (и не тратил воздушный запас). Та же проверка, что и у спрыгивания.
        if (candidate.node && candidate.node.one_way) {
            if (!isOneWayTop(node, candidate)) continue;
            // Низ тела не должен быть ниже поверхности больше, чем допуск:
            // иначе это проход сквозь платформу, а не опора на ней (мгновенное
            // перекрытие на кадре подъёма).
            if (b.y1 > candidate.y + tolerance) continue;
        }
        // Лучше та опора, что «горизонтальнее»; при равном угле — ближе.
        if (!best || slope < best.slope - 1e-6
            || (Math.abs(slope - best.slope) <= 1e-6 && distance < best.distance)) {
            best = candidate;
        }
    }
    if (!best) return null;
    const g = best.node;
    if (g && g.body >= 0) {
        const [gvx, gvy] = engineOf().getVelocity(g.body);
        best.vx = gvx;
        best.vy = gvy;
        best.oneWay = !!g.one_way;
    } else {
        best.vx = 0;
        best.vy = 0;
        best.oneWay = false;
    }
    return best;
}

/** §8: потолок — лучи по ширине тела вверх. */
function probeCeiling(node) {
    const b = nodeBounds(node);
    const points = groundProbePoints(node, b);
    for (let i = 0; i < points.length; i++) {
        const hit = ctx.world.raycast({ x: points[i], y: node.y }, { x: points[i], y: b.y0 - GROUND_TOLERANCE },
                                      { mask: node.collision_mask });
        if (hit && hit.body !== node.body) return hit;
    }
    return null;
}

/**
 * Стоит ли узел именно СВЕРХУ односторонней платформы (а не висит на кромке
 * или упирается в неё сбоку). Нормаль луча направлена против луча, то есть
 * вверх; сверяем её с лицевой нормалью платформы — той же формулой, что в
 * physics.c (one_way_angle, по умолчанию «вверх»), и проверяем, что центр
 * узла с лицевой стороны плоскости.
 */
function isOneWayTop(node, ground) {
    const g = ground.node;
    if (!g || !g.one_way) return false;
    const face = g.one_way_angle === 0 ? -Math.PI / 2 : g.one_way_angle;
    const a = face + (g.angle || 0);
    const nx = Math.cos(a), ny = Math.sin(a);
    if (ground.nx * nx + ground.ny * ny < 0.5) return false;
    return (node.x - ground.x) * nx + (node.y - ground.y) * ny > 0;
}

/**
 * Скорость опоры, которую надо прибавить игроку: движущаяся платформа
 * переносит стоящего на ней. Несёт только кинематическое тело — это
 * транспорт, который игра ведёт сама; динамический ящик под ногами не
 * обязан тащить игрока за собой.
 *
 * Прибавка скорости (а не сдвиг позиции) исключает двойное интегрирование:
 * позицию двигает физика, JS задаёт лишь намерение скорости на кадр.
 */
function carryVelocity(ground) {
    const g = ground.node;
    if (!g || g.body < 0 || g.body_kind !== 'kinematic') return null;
    const [vx] = engineOf().getVelocity(g.body);
    return vx;
}

/**
 * §8. Внешняя скорость узла (урон, отдача, ветер) — то, что скрипт управления
 * НЕ имеет права стирать. `.controls()` каждый кадр задаёт горизонтальную
 * скорость, поэтому импульс урона без этого канала исчезал бы в следующем тике.
 *
 * Хранится как скорость, линейно затухающая до нуля за `ms` игрового времени.
 * Вертикаль складывается с физической скоростью и вычитается на следующем
 * кадре (`applied_y`), иначе одно и то же значение интегрировалось бы дважды.
 */
function setExternalVelocity(node, vx, vy, ms) {
    const life = Math.max(1, ctlNum(ms, 120)) / 1000;
    node.ext_vel = {
        x: ctlNum(vx, 0), y: ctlNum(vy, 0),
        ms: life, left: life,
        applied_y: node.ext_vel ? node.ext_vel.applied_y : 0,
    };
    return node.ext_vel;
}

/** Остаток внешней скорости на этот кадр (или null, если канал пуст). */
function stepExternalVelocity(node, dt) {
    const e = node.ext_vel;
    if (!e) return null;
    e.left -= dt;
    if (e.left <= 0) {
        node.ext_vel = null;
        return { x: 0, y: 0, remove_y: e.applied_y };
    }
    const k = e.left / e.ms;
    return { x: e.x * k, y: e.y * k, remove_y: e.applied_y };
}

/**
 * Включить игнор односторонних платформ на `ms` игрового времени:
 * `preSolve` в physics.c перестанет держать тело на платформе, и оно
 * провалится. Платформа при этом не трогается — на ней могут стоять другие.
 */
function startDropThrough(node, platform, ms) {
    if (!node || node.body < 0) return;
    const time = ctx.$ && ctx.$.time;
    if (node._drop_timer !== undefined && time && typeof time.cancel === 'function') {
        time.cancel(node._drop_timer);   // повторный вызов продлевает окно
    }
    node._drop_body = platform ? platform.body : -1;
    engineOf().setOneWayIgnore(node.body, true);
    const wait = Math.max(0, ctlNum(ms, 250));
    if (!time || typeof time.after !== 'function') {
        // $.time ставится до кода игры, поэтому сюда попадаем только вне
        // движка (юнит-тест). Снимаем флаг сразу: залипший игнор хуже
        // короткого окна.
        engineOf().setOneWayIgnore(node.body, false);
        node._drop_body = -1;
        return;
    }
    node._drop_timer = time.after(wait, () => endDropThrough(node));
}

/**
 * Снять игнор односторонних платформ. Пока центр узла выше низа платформы,
 * он ещё внутри неё: включить контакт в этот момент — значит вытолкнуть узел
 * вверх или зажать. Поэтому проверяем ещё раз через 100 мс игрового времени.
 */
function endDropThrough(node) {
    if (!node || node.removed || node.body < 0) return;
    const time = ctx.$ && ctx.$.time;
    const platform = node._drop_body >= 0 ? ctx.byBody.get(node._drop_body) : null;
    if (platform && !platform.removed && node.y < platform.y + platform.h * 0.5) {
        if (time && typeof time.after === 'function') {
            node._drop_timer = time.after(100, () => endDropThrough(node));
        }
        return;
    }
    engineOf().setOneWayIgnore(node.body, false);
    node._drop_body = -1;
    node._drop_timer = undefined;
}

function applyControls(dt) {
    // Гейт катсцены: пока ввод забран, игроком НЕ управляем. Иначе во время
    // катсцены герой продолжал бы бегать под управлением игрока.
    const cutscene = ctx.$ && ctx.$.cutscene;
    const gated = !!(cutscene && typeof cutscene.blocking === 'function' && cutscene.blocking());
    // Срез управляемых узлов держит индекс реестра: при пустом срезе нет ни
    // обхода мира, ни опроса ввода (§5, P2 отчёта).
    const nodes = nodesWithFacet('controls');
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        // §44: политика `update` выключает кадровую логику узла (контроллер).
        // Скорость тела при этом не обнуляется: усыпление и сон — другие
        // операции, а «не обрабатывать» значит «не трогать узел из кадра».
        if (!processingAllows(node, 'update')) continue;
        const scheme = node.attrs.controls;
        if (!scheme) continue;
        // Время идёт и когда узлом не управляют. Иначе coyote-фора и буфер
        // прыжка «замирали» бы на паузе катсцены и оживали после неё — уже
        // недействительное нажатие сработало бы как свежее.
        if (node.cur_hp <= 0) {
            if (node._ctl && dt > 0) node._ctl.t += dt;
            continue;
        }
        // Забран ввод — гасим скорость управляемого тела, но не «замораживаем»
        // узел: на время катсцены его ведёт режиссёр (walk и т.п.).
        if (gated) {
            if (node._ctl && dt > 0) node._ctl.t += dt;
            if (node.body >= 0) {
                const [junk_vx, vy] = engineOf().getVelocity(node.body);
                engineOf().setVelocity(node.body, 0, node.gravity_on === false ? 0 : vy);
            }
            continue;
        }
        const s = controlsScheme(scheme);
        const vec = ctx.input.vec(s.axis);
        // Скорость: явный атрибут → умолчание тега из TAGS (player 250,
        // enemy 90, npc 70) → запасное значение для тега без умолчания.
        const speed = node.attrs.speed !== undefined ? node.attrs.speed
            : (node.speed > 0 ? node.speed : (node.tag === 'player' ? 250 : 150));

        const jump_pressed = ctx.input.pressed(s.jump_key) || ctx.input.pressed(s.up_key);
        const jump_released = ctx.input.released(s.jump_key) || ctx.input.released(s.up_key);

        // Ветка Re2D — только в сборке с RE2D. Без него 're2d'-вид камеры не
        // имеет прохода (camera.js: hasRe2d()), и узел управляется как обычный
        // 2D: иначе ввод молча не работал бы на узле, помеченном kind('re2d').
        if (re2dSupport && node.kind === 're2d' && ctx.camera.kind() === 're2d') {
            // Re2D: «вперёд» — туда, куда смотрит камера (yaw), A/D — боком;
            // мир плоский, поэтому скорость задаётся по обеим осям пола.
            const m = re2dMove(ctx.camera.rotation(), vec, speed);
            if (node.body >= 0) engineOf().setVelocity(node.body, m.vx, m.vy);
            else { node.x += m.vx * dt; node.y += m.vy * dt; }
        } else if (node.body >= 0) {
            const ground = probeGround(node);
            const [vx, vy] = engineOf().getVelocity(node.body);
            const ctl = node._ctl || (node._ctl = makeControlsState());
            let down = false;
            for (let k = 0; k < s.drop_keys.length && !down; k++) down = ctx.input.down(s.drop_keys[k]);
            // §8: слишком крутая поверхность — не земля: персонаж на ней не
            // стоит и не прыгает. По умолчанию лимит 90°, то есть не влияет.
            const steep = ground !== null && ground.slope > s.max_slope * Math.PI / 180;
            const on_ground = ground !== null && !steep;
            const step = controlsTimingStep(ctl, s, dt, {
                pressed: jump_pressed,
                released: jump_released,
                down,
                grounded: on_ground,
                oneWay: ground !== null && !steep && isOneWayTop(node, ground),
                vy,
            });

            // §8. Приоритет скоростей, явно и по порядку:
            //   своя скорость (ввод) → перенос платформой → внешняя скорость
            //   (урон/отдача). Ни один источник не стирает другой.
            const carry = ground ? carryVelocity(ground) : null;
            const ext = stepExternalVelocity(node, dt);
            // Своя скорость: 0 ускорения — мгновенно (как было), иначе
            // приближаемся к желаемой с заданным ускорением/торможением.
            const want_self = vec.x * speed;
            let self_vx = ctl.self_vx === undefined ? want_self : ctl.self_vx;
            if (s.accel > 0 || s.decel > 0 || s.air_accel > 0) {
                const rate = on_ground
                    ? (vec.x !== 0 ? s.accel : s.decel)
                    : (s.air_accel > 0 ? s.air_accel : s.accel);
                self_vx = approachValue(self_vx, want_self, rate * dt);
            } else {
                self_vx = want_self;
            }

            // §6.3: стоящий на склоне держится скоростью, а не трением Box2D
            // (трение по умолчанию 0.2 < tan 30° тело не удерживает). Подробности
            // и границы применимости — в комментарии к HOLD_SLOPE_DEG.
            if (dt > 0 && vec.x === 0 && on_ground && self_vx === 0
                && carry === null && !ext
                && ground.slope >= HOLD_SLOPE_DEG * Math.PI / 180) {
                const dx = ctl.hold_x === undefined ? 0 : node.x - ctl.hold_x;
                const v_prev = ctl.hold_vx === undefined ? 0 : ctl.hold_vx;
                const want = v_prev - dx / dt;
                if (Math.abs(want) <= holdSpeedLimit(dt)) self_vx = want;
                ctl.hold_vx = self_vx;
                ctl.hold_x = node.x;
            } else {
                ctl.hold_vx = undefined;
                ctl.hold_x = undefined;
            }
            ctl.self_vx = self_vx;

            let target_vx = self_vx + (carry === null ? 0 : carry) + (ext ? ext.x : 0);
            // Вертикаль: физическая скорость (гравитация, импульс) плюс остаток
            // внешней, минус уже применённый остаток — без двойного интегрирования.
            let target_vy = node.gravity_on === false ? 0 : vy;
            if (ext) target_vy += ext.y - ext.remove_y;
            if (ext) node.ext_vel.applied_y = ext.y;
            engineOf().setVelocity(node.body, target_vx, target_vy);

            if (step.jump) {
                // Сила прыжка: настройка схемы → атрибут узла → умолчание.
                // .attr('jumpForce') документирован в tutorial-platformer.md и
                // работал только в объектной схеме — теперь одним путём.
                const force = s.cfg.jumpForce !== undefined ? s.cfg.jumpForce
                    : (node.attrs.jumpForce !== undefined ? node.attrs.jumpForce : 640);
                Wrapper.prototype.jump.call(wrapOne(node), force);
            } else if (step.cut) {
                // Переменная высота: кнопку отпустили на подъёме — гасим часть
                // скорости.
                engineOf().setVelocity(node.body, target_vx, vy * step.cut);
            }
            if (step.drop) startDropThrough(node, ground.node, s.drop_time);
            node.attrs.on_ground = on_ground;
            node.attrs.on_slope = ground ? ground.slope : 0;
        } else {
            node.x += vec.x * speed * dt;
            node.y += vec.y * speed * dt;
            // У узла без тела прыжок и опора не считаются: физики нет.
            node.attrs.on_ground = true;
        }

        const fire_key = s.cfg.fire;
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
/**
 * §7: поколение тела. Событие контакта несёт genA/genB; если нативное
 * поколение уже другое, тело уничтожено, а его id занят новым — событие к
 * новому владельцу не относится. Заглушка без биндинга считается совпадением
 * (мок-тесты и старые сборки).
 */
function bodyGenerationOf(body) {
    const eng = engineOf();
    if (typeof eng.bodyGeneration !== 'function') return undefined;
    return eng.bodyGeneration(body);
}

function dispatchContacts() {
    if (typeof engineOf().contacts !== 'function') return;
    const list = engineOf().contacts();
    if (!list || list.length === 0) return;

    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        let na = ctx.byBody.get(c.a) || null;
        let nb = ctx.byBody.get(c.b) || null;
        // §7: устаревший handle и callback после destroy. body id переиспользуется
        // после уничтожения, поэтому «то же число» — не «то же тело»: сверяем
        // поколение. Уничтоженный узел дальнейших вызовов не получает.
        if (na && (na.removed || (c.genA !== undefined && bodyGenerationOf(c.a) !== c.genA))) na = null;
        if (nb && (nb.removed || (c.genB !== undefined && bodyGenerationOf(c.b) !== c.genB))) nb = null;
        if (!na && !nb) continue;

        // Фазы: begin → collide, end → separate, hit → hit, stay → stay (§7).
        const name = c.kind === 'begin' ? 'collide'
                   : (c.kind === 'end' ? 'separate'
                      : (c.kind === 'stay' ? 'stay' : 'hit'));
        // §7: чего backend не дал — обозначено явно. У сенсора контактной
        // нормали нет, поэтому `nx`/`ny` равны null, а не нулевому вектору;
        // код, которому нужна нормаль, обязан проверить hasNormal.
        const has_normal = c.hasNormal === true;
        const has_point = c.hasPoint === true;
        const info = {
            kind: c.kind,
            x: has_point ? c.x : null,
            y: has_point ? c.y : null,
            nx: has_normal ? c.nx : null,
            ny: has_normal ? c.ny : null,
            hasNormal: has_normal,
            hasPoint: has_point,
            sensor: !!c.sensor,
            speed: c.speed,
            // Устойчивые логические ID участников (§4.2, §13): нужны трассировке
            // и диагностике, чтобы по событию найти узлы, а не нативные body id.
            source: na ? na.nid : null,
            target: nb ? nb.nid : null,
            // Псевдонимы из contracts §4.3: то же значение, читаемое имя.
            source_id: na ? na.nid : null,
            target_id: nb ? nb.nid : null,
            a: na ? wrapOne(na) : null,
            b: nb ? wrapOne(nb) : null,
        };
        if (trace_on) noteTrace(name, na, nb, c);

        // §40: маршрутизация контакта — индекс native-формы и область каждого
        // участника отдельно от узла-сенсора. Игра различает «какая именно
        // область» и «чей это логический владелец», не заглядывая в handle'ы.
        if (c.shapeA !== undefined) {
            info.shapeA = c.shapeA;
            info.shapeB = c.shapeB;
            const area_a = na ? areaByIndex(na, c.shapeA) : null;
            const area_b = nb ? areaByIndex(nb, c.shapeB) : null;
            info.areaA = area_a ? area_a.name : null;
            info.areaB = area_b ? area_b.name : null;
            info.roleA = area_a ? area_a.role : null;
            info.roleB = area_b ? area_b.role : null;
            info.ownerA = na ? wrapOne(area_a ? areaOwnerNode(na, area_a) : na) : null;
            info.ownerB = nb ? wrapOne(area_b ? areaOwnerNode(nb, area_b) : nb) : null;
        }

        // Каждому участнику — СВОЙ объект события. Общий `info`, который
        // мутировали между двумя emit'ами, отдавал обработчику чужие псевдонимы,
        // если тот сохранил e.data (журнал, трассировка §23, отложенный разбор):
        // к моменту чтения `self/selfArea/selfOwner` в объекте уже лежали
        // значения ПРОТИВНИКА. Шесть §7-полей (areaA/areaB/roleA/roleB/ownerA/
        // ownerB) остаются общими и стабильными: это факт контакта, а не сторона.
        if (na) {
            const view_a = Object.assign({}, info, {
                self: wrapOne(na),
                other: nb ? wrapOne(nb) : null,
                selfArea: info.areaA || null,
                otherArea: info.areaB || null,
                selfShape: c.shapeA,
                otherShape: c.shapeB,
                selfOwner: info.ownerA || wrapOne(na),
                otherOwner: info.ownerB || (nb ? wrapOne(nb) : null),
            });
            try { na.emit(name, view_a); } catch (e) { reportError(`событие ${name}`, e); }
        }
        if (nb) {
            const view_b = Object.assign({}, info, {
                self: wrapOne(nb),
                other: na ? wrapOne(na) : null,
                selfArea: info.areaB || null,
                otherArea: info.areaA || null,
                selfShape: c.shapeB,
                otherShape: c.shapeA,
                selfOwner: info.ownerB || wrapOne(nb),
                otherOwner: info.ownerA || (na ? wrapOne(na) : null),
            });
            try { nb.emit(name, view_b); } catch (e) { reportError(`событие ${name}`, e); }
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
        // §44: политика `animation` выключает кадровую анимацию узла, не
        // трогая движение и физику. Узлы без политики проходят без затрат.
        if (!processingAllows(node, 'animation')) continue;
        if (!node.anim || !node.anim.playing || !node.frames) continue;
        const anim = node.anim;
        anim.t += dt * anim.speed;
        const span = anim.to - anim.from + 1;
        let index = anim.from + Math.floor(anim.t) % span;
        // Событие КАДРА — только когда кадр действительно сменился: иначе
        // слушатель получал бы вызовы на каждом тике (цена и смысл).
        if (anim.last_index !== index) {
            anim.last_index = index;
            node.emit('anim:frame', { frame: index, frame_in_clip: index - anim.from,
                                      clip: anim.clip || null, anim });
        }
        if (!anim.loop && Math.floor(anim.t) >= span) {
            anim.playing = false;
            index = anim.to;
            node.emit('anim:end', { clip: anim.clip || null, loops: 1, anim });
        } else if (anim.loop && Math.floor(anim.t) >= span) {
            // Петля: считаем циклы и сообщаем о каждом — «доиграл» для клипа с
            // повтором случается на каждом обороте (описано в доках).
            anim.loops = (anim.loops || 0) + 1;
            node.emit('anim:end', { clip: anim.clip || null, loops: anim.loops, anim });
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
    // §17: ошибка идёт и человеку (строка в лог — её ищут тесты и люди), и
    // машине (запись с кодом/подсистемой/операцией в $.debug.errors()).
    // Логика записи живёт в diag.js: одна точка на весь движок.
    return diagReport(where, error);
}

/** Программный вызов хука выхода (движок не даёт события выхода в JS). */
export function callExitHooks($) {
    for (const fn of frame.exit) {
        try { fn($); } catch (e) { reportError('$.exit', e); }
    }
}
