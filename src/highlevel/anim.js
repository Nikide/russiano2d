// ===========================================================================
// Анимация и состояния: $.anim + .playClip()/.stateMachine().
//
// Аналог AnimationPlayer + AnimationTree из Godot 4, но в духе $:
//
//   $.anim.define('hit', {
//       duration: 180,
//       loop: 'once',
//       tracks: [{ prop: 'scale_x', keys: [{ t: 0, v: 1 }, { t: 1, v: 1.6, ease: 'quadOut' }] }],
//       events: [{ at: 0.5, name: 'impact' }],
//   });
//   $('#hero').playClip('hit');
//   $('#hero').on('key', (e) => { if (e.data.name === 'impact') $.sound.play('hit'); });
//
// Чем это отличается от твинов (tween.js): твин — одноразовый переход к
// цели, а клип — именованная дорожка времени с ключами, режимом
// once/loop/pingpong, событиями в процентах и необязательной машиной
// состояний. Твины и клипы не мешают друг другу: узел может одновременно
// ехать твином и «дышать» клипом, если они трогают разные свойства.
//
// Модуль намеренно не знает про физику: чистые свойства узла (x, y, alpha,
// scale_x…) меняются напрямую. Это позволяет тестировать логику в qjs без
// движка и не создаёт скрытых тел/телепортов из анимации.
// ===========================================================================

import { ctx, def, facetCount, nodesWithFacet, touchRegistry } from './core.js';
import { easeFunction, easeNames } from './tween.js';

// ---------------------------------------------------------------------------
// Плавность
// ---------------------------------------------------------------------------

// В tween.js имена длинные ('easeInQuad'), а в спецификации клипов хочется
// короткие ('quadIn'). Таблица — только перевод имён; сами кривые живут в
// одном месте (tween.js), чтобы анимация и твины не разъезжались.
const EASE_ALIASES = {
    quadIn: 'easeInQuad', quadOut: 'easeOutQuad', quadInOut: 'easeInOutQuad',
    cubicIn: 'easeInCubic', cubicOut: 'easeOutCubic', cubicInOut: 'easeInOutCubic',
    quartIn: 'easeInQuart', quartOut: 'easeOutQuart', quartInOut: 'easeInOutQuart',
    sineIn: 'easeInSine', sineOut: 'easeOutSine', sineInOut: 'easeInOutSine',
    backIn: 'easeInBack', backOut: 'easeOutBack', backInOut: 'easeInOutBack',
    elasticIn: 'easeInElastic', elasticOut: 'easeOutElastic',
    bounceIn: 'easeInBounce', bounceOut: 'easeOutBounce',
    in: 'easeIn', out: 'easeOut', inOut: 'easeInOut',
};

/**
 * Функция плавности по имени или по готовой функции.
 * Неизвестное имя не роняет игру: tween.js подставляет easeInOut и пишет в
 * журнал — так опечатка 'quаdIn' (кириллическая «а») сразу видна.
 * Отсутствие ease — это именно линейность: ключи клипа по умолчанию прямые.
 */
export function chooseEase(ease) {
    if (typeof ease === 'function') return ease;
    if (ease === undefined || ease === null) return easeFunction('linear');
    return easeFunction(EASE_ALIASES[ease] || ease);
}

/** Все имена плавностей, которые принимает клип (короткие + длинные). */
export function animEases() {
    return easeNames().concat(Object.keys(EASE_ALIASES)).sort();
}

// ---------------------------------------------------------------------------
// Ключи и выборка значения
// ---------------------------------------------------------------------------

/**
 * Приводит ключи к предсказуемому виду: числа, t в [0..1], сортировка по t.
 * Некорректный ключ — ошибка с подсказкой, а не тихий ноль: молчаливая
 * анимация «ничего не происходит» отлаживается дольше всего.
 */
export function normalizeKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    const out = keys.map((key) => {
        if (!key || typeof key !== 'object') {
            throw new Error('$.anim: ключ дорожки — объект { t, v, ease? }');
        }
        if (typeof key.v !== 'number' || !isFinite(key.v)) {
            throw new Error(`$.anim: в ключе t=${key.t} нужно число v (получено ${JSON.stringify(key.v)})`);
        }
        let t = Number(key.t);
        if (!isFinite(t)) t = 0;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        return { t, v: key.v, ease: key.ease };
    });
    out.sort((a, b) => a.t - b.t);
    return out;
}

/**
 * Значение дорожки на прогрессе t (0..1). Чистая функция — её проверяет qjs.
 *
 * Плавность берётся у ключа-назначения (правого), а если там её нет — у
 * начального. Так работают обе привычные записи:
 *   [{t:0,v:0}, {t:1,v:100,ease:'quadOut'}]   — ease «на приезде»,
 *   [{t:0,v:0,ease:'quadIn'}, {t:1,v:100}]    — ease «на выезде».
 */
export function sampleKeys(keys, t) {
    if (!Array.isArray(keys) || keys.length === 0) return 0;
    if (keys.length === 1) return keys[0].v;
    const x = t < 0 ? 0 : (t > 1 ? 1 : t);
    if (x <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (x >= last.t) return last.v;
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i];
        const b = keys[i + 1];
        if (x >= a.t && x <= b.t) {
            const span = b.t - a.t;
            if (!(span > 0)) return b.v;               // два ключа в одной точке
            const local = (x - a.t) / span;
            const ease = chooseEase(b.ease !== undefined ? b.ease : a.ease);
            return a.v + (b.v - a.v) * ease(local);
        }
    }
    return last.v;
}

// ---------------------------------------------------------------------------
// Время клипа
// ---------------------------------------------------------------------------

const LOOPS = ['once', 'loop', 'pingpong'];

/**
 * Прогресс клипа [0..1] по «единицам длительности» u (u = время/длительность).
 * once — упирается в 1, loop — пила, pingpong — треугольник (0→1→0).
 * Чистая функция: на ней стоит и отрисовка кадра, и события.
 */
export function clipPhase(u, loop) {
    if (loop === 'loop') return u - Math.floor(u);
    if (loop === 'pingpong') {
        const cycle = u - Math.floor(u / 2) * 2;
        return cycle <= 1 ? cycle : 2 - cycle;
    }
    return u <= 0 ? 0 : (u >= 1 ? 1 : u);
}

/**
 * События клипа, попавшие в интервал прогресса (fromU, toU].
 *
 * События повторяются каждый цикл: для события at они происходят в точках
 * at + n (n = 0, 1, 2…). Интервал задаётся в тех же «единицах длительности»,
 * поэтому loop и pingpong переиспользуют одну и ту же проверку, а не
 * накапливают состояние в узле. Возвращает события по возрастанию момента.
 */
export function eventsBetween(events, fromU, toU) {
    const out = [];
    if (!Array.isArray(events) || !(toU > fromU)) return out;
    for (const ev of events) {
        const at = ev.at;
        if (!Number.isFinite(at)) continue;
        let n = Math.ceil(fromU - at + 1e-9);
        if (n < 0) n = 0;
        // Один кадр может накрыть несколько циклов (лагающий кадр), поэтому
        // перебираем ВСЕ повторы в интервале, а не только первый. Потолок —
        // предохранитель от мусорного at вроде -1e9.
        let moment = at + n;
        for (let guard = 0; guard < 1000 && moment <= toU + 1e-9; ++guard, moment += 1) {
            if (moment > fromU + 1e-9) out.push({ ev, moment });
        }
    }
    out.sort((a, b) => a.moment - b.moment);
    return out.map((entry) => entry.ev);
}

/**
 * Состояние клипа на момент timeMs: прогресс, фаза, признак конца и значения
 * свойств. Чистая функция — основной «мозг» подсистемы, её удобно проверять
 * таблицей значений, не поднимая ни одного узла.
 */
export function evalClip(clip, timeMs) {
    const duration = clip && clip.duration > 0 ? clip.duration : 1;
    const loop = clip ? clip.loop : 'once';
    const u = timeMs / duration;
    const phase = clipPhase(u, loop);
    const done = loop === 'once' && u >= 1;
    const values = {};
    for (const track of (clip && clip.tracks) || []) {
        if (track.kind === 'prop') values[track.prop] = sampleKeys(track.keys, phase);
    }
    return { u, phase, done, values };
}

// ---------------------------------------------------------------------------
// Разбор объявления клипа
// ---------------------------------------------------------------------------

/**
 * Проверяет и нормализует spec клипа. Ключи сортируются заранее, скорость и
 * режим приводятся к числам/строкам один раз — в кадре уже нет ветвлений на
 * «а вдруг строка».
 */
export function normalizeClip(name, spec) {
    const src = spec || {};
    const duration = Number(src.duration);
    if (!(duration > 0)) {
        throw new Error(`$.anim.define: у клипа "${name}" нужен duration > 0 (мс)`);
    }
    const loop = src.loop === undefined ? 'once' : src.loop;
    if (LOOPS.indexOf(loop) < 0) {
        throw new Error(`$.anim.define: у клипа "${name}" неверный loop "${loop}" — допустимо once|loop|pingpong`);
    }
    const rawSpeed = src.speed === undefined ? 1 : Number(src.speed);
    const speed = isFinite(rawSpeed) ? rawSpeed : 1;

    const tracks = [];
    for (const raw of (src.tracks || [])) {
        if (!raw || typeof raw !== 'object') continue;
        if (typeof raw.fn === 'function') {
            // Произвольное свойство: функция получает узел и прогресс.
            tracks.push({ kind: 'fn', fn: raw.fn });
            continue;
        }
        if (raw.anim) {
            // Совместимость со спрайт-листом .frames(...): кадры выбираются
            // по прогрессу клипа, а не по отдельному счётчику скорости.
            const cfg = typeof raw.anim === 'object' ? raw.anim : {};
            tracks.push({
                kind: 'anim',
                from: cfg.from === undefined ? 0 : cfg.from,
                to: cfg.to === undefined ? -1 : cfg.to,   // -1 = последний кадр
            });
            continue;
        }
        if (raw.prop) {
            const keys = normalizeKeys(raw.keys);
            if (keys.length === 0) {
                ctx.log(`$.anim: дорожка "${raw.prop}" без ключей — пропускаю`);
                continue;
            }
            tracks.push({ kind: 'prop', prop: raw.prop, keys });
            continue;
        }
        ctx.log('$.anim: дорожка должна содержать prop, fn или anim — пропускаю');
    }

    const events = [];
    for (const raw of (src.events || [])) {
        if (!raw || typeof raw !== 'object') continue;
        const at = Number(raw.at);
        events.push({
            at: isFinite(at) ? Math.max(0, Math.min(1, at)) : 0,
            name: raw.name === undefined ? 'event' : String(raw.name),
            data: raw.data,
        });
    }
    events.sort((a, b) => a.at - b.at);

    return { name, duration, loop, speed, tracks, events };
}

// ---------------------------------------------------------------------------
// Состояние узла
// ---------------------------------------------------------------------------

const clips = new Map();

function blankPlayer() {
    return {
        clip: null,        // нормализованный клип
        name: null,
        u: 0,              // время / длительность, растёт без предела
        speed: 1,
        loop: 'once',
        playing: false,
        paused: false,
        onEnd: null,
        machine: null,     // { states, transitions, current, time, pending }
    };
}

/** Ленивое поле игрока: не трогаем узел, пока анимация не понадобилась. */
function playerOf(node) {
    if (!node.__clip) {
        node.__clip = blankPlayer();
        touchRegistry();   // у узла появился клип — сводка tickAnim устарела
    }
    return node.__clip;
}

/**
 * Обход узлов обёртки. Не полагаемся на Wrapper.prototype.each из api.js:
 * модуль должен работать и в юнит-тесте qjs, где api.js не поднимается.
 */
function eachNode(wrapper, fn) {
    const list = wrapper.nodes;
    if (!list) return wrapper;
    for (let i = 0; i < list.length; i++) fn(list[i]);
    return wrapper;
}

/** Прямая запись свойства: без физики и без bodies — анимация чистая. */
function writeProp(node, prop, value) {
    switch (prop) {
    case 'x': node.x = value; return;
    case 'y': node.y = value; return;
    case 'angle': case 'rotation': node.angle = value; return;
    case 'scale_x': case 'scaleX': case 'scale': node.scale_x = value; return;
    case 'scale_y': case 'scaleY': node.scale_y = value; return;
    case 'alpha': case 'opacity': node.alpha = value; return;
    case 'width': case 'w': node.w = value; return;
    case 'height': case 'h': node.h = value; return;
    case 'radius': node.radius = value; return;
    case 'intensity': node.intensity = value; return;
    default:
        if (node.attrs) node.attrs[prop] = value; else node[prop] = value;
        return;
    }
}

function applyAnimTrack(node, track, phase) {
    if (!node.frames || node.frames.length === 0) return;
    const from = track.from;
    const to = track.to < 0 ? node.frames.length - 1 : Math.min(track.to, node.frames.length - 1);
    const span = to - from + 1;
    if (span <= 0) return;
    const index = from + Math.min(span - 1, Math.floor(phase * span));
    node.sprite = node.frames[index];
    node.frame_index = index;
}

function applyTracks(node, clip, phase, player) {
    for (const track of clip.tracks) {
        if (track.kind === 'prop') {
            writeProp(node, track.prop, sampleKeys(track.keys, phase));
        } else if (track.kind === 'fn') {
            track.fn(node, phase, { clip, u: player.u, time: phase * clip.duration, name: player.name });
        } else if (track.kind === 'anim') {
            applyAnimTrack(node, track, phase);
        }
    }
}

/** Событие клипа рассылается и как общий 'key', и под своим именем. */
function fireEvents(node, player, list) {
    for (const ev of list) {
        const payload = {
            name: ev.name,
            data: ev.data === undefined ? {} : ev.data,
            at: ev.at,
            clip: player.clip,
            clipName: player.name,
        };
        node.emit('key', payload);
        if (ev.name) node.emit(ev.name, payload);
    }
}

// ---------------------------------------------------------------------------
// Воспроизведение
// ---------------------------------------------------------------------------

function playClipOn(node, name, opts) {
    const clip = clips.get(String(name));
    if (!clip) {
        ctx.log(`$.anim: клип "${name}" не объявлен — сначала $.anim.define("${name}", { duration, tracks })`);
        return node;
    }
    const o = opts || {};
    const player = playerOf(node);

    // Повторный playClip того же клипа не сбрасывает время: так анимация не
    // «дёргается», когда игровой код вызывает её каждый кадр. Нужен сброс —
    // opts.restart: true.
    if (o.restart !== true && player.playing && player.name === clip.name) return node;

    player.clip = clip;
    player.name = clip.name;
    player.speed = o.speed === undefined ? clip.speed : Number(o.speed);
    if (!isFinite(player.speed)) player.speed = clip.speed;
    player.loop = o.loop === undefined ? clip.loop : o.loop;
    if (LOOPS.indexOf(player.loop) < 0) player.loop = clip.loop;
    player.onEnd = typeof o.onEnd === 'function' ? o.onEnd : null;
    player.u = 0;
    player.playing = true;
    player.paused = false;

    // Нулевой кадр применяем сразу: без этого первый кадр после playClip
    // показывал бы старое значение, пока не придёт tickAnim.
    applyTracks(node, clip, 0, player);
    fireEvents(node, player, eventsBetween(clip.events, -0.5, 0));
    return node;
}

function advanceClip(node, player, dt) {
    const clip = player.clip;
    const prevU = player.u;
    player.u += (dt * 1000 * player.speed) / clip.duration;

    fireEvents(node, player, eventsBetween(clip.events, prevU, player.u));

    const phase = clipPhase(player.u, player.loop);
    applyTracks(node, clip, phase, player);

    if (player.loop === 'once' && player.u >= 1) {
        player.u = 1;
        player.playing = false;
        node.emit('clipEnd', { clip, name: player.name, node });
        if (player.onEnd) player.onEnd(node);
        // Машина состояний умеет «доиграл и дальше»: next у состояния.
        const machine = player.machine;
        const state = machine ? machine.states[machine.current] : null;
        if (state && state.next) enterState(node, player, state.next);
    }
}

// ---------------------------------------------------------------------------
// Машина состояний
// ---------------------------------------------------------------------------

/**
 * Имя события-триггера перехода.
 *   on: 'hit'            — событие узла 'hit';
 *   on: 'signal', signal: 'hit' — то же самое, но явной парой;
 *   on: 'event'          — маркер «условного» перехода: срабатывает when.
 */
function transitionEvent(tr) {
    if (typeof tr.on !== 'string' || tr.on === 'event') return null;
    if (tr.on === 'signal') return tr.signal ? String(tr.signal) : null;
    return tr.on;
}

function enterState(node, player, name) {
    const machine = player.machine;
    const state = machine.states[name];
    if (!state) {
        ctx.log(`$.anim: состояние "${name}" не объявлено — проверьте states у .stateMachine()`);
        return;
    }
    const prev = machine.current;
    if (prev) node.emit('stateExit', { state: prev, next: name, node });
    machine.current = name;
    machine.time = 0;
    machine.pending.clear();
    node.emit('stateEnter', { state: name, prev, node });

    if (state.clip) {
        playClipOn(node, state.clip, { loop: state.loop, speed: state.speed, restart: true });
    } else {
        // Состояние-заглушка: клипа нет, но состояние активно (ждём переход).
        player.playing = false;
        player.clip = null;
        player.name = null;
    }
}

function setupMachine(node, spec) {
    if (!spec || typeof spec !== 'object') {
        ctx.log('$.anim.stateMachine: нужен { initial, states, transitions }');
        return null;
    }
    const states = spec.states || {};
    const names = Object.keys(states);
    if (names.length === 0) {
        ctx.log('$.anim.stateMachine: в states нет ни одного состояния');
        return null;
    }
    const initial = spec.initial && states[spec.initial] ? spec.initial : names[0];
    const transitions = Array.isArray(spec.transitions) ? spec.transitions.slice() : [];
    const player = playerOf(node);
    // Повторный .stateMachine() не должен копить обработчики: снимаем подписки
    // прошлой машины. Иначе после семи вызовов на узле висело бы семь
    // обработчиков одного события (docs обещают, что подписка одна).
    const previous = player.machine;
    if (previous && previous.subs) {
        for (const sub of previous.subs) node.off(sub.event, sub.fn);
    }
    const machine = { states, transitions, current: null, time: 0, pending: new Set(), spec, subs: [] };
    player.machine = machine;

    // Событийные переходы слушаем один раз при объявлении: подписываться и
    // отписываться на каждом входе в состояние — источник утечек обработчиков.
    for (const tr of transitions) {
        const event = transitionEvent(tr);
        if (!event) continue;
        const fn = () => { machine.pending.add(event); };
        machine.subs.push({ event, fn });
        node.on(event, fn);
    }
    enterState(node, player, initial);
    return machine;
}

function updateMachine(node, player, dt) {
    const machine = player.machine;
    machine.time += dt;
    const from = machine.current;

    // Сначала события (сигналы) — они важнее опроса условий: игровой код
    // явно сказал «произошло», и это не должно ждать кадра с when.
    let chosen = null;
    for (const tr of machine.transitions) {
        if (tr.from !== from && tr.from !== '*') continue;
        const event = transitionEvent(tr);
        if (event && machine.pending.has(event)) { chosen = tr; break; }
    }
    if (!chosen) {
        for (const tr of machine.transitions) {
            if (tr.from !== from && tr.from !== '*') continue;
            if (typeof tr.when === 'function' && tr.when(node)) { chosen = tr; break; }
        }
    }
    machine.pending.clear();
    if (chosen) enterState(node, player, chosen.to);
}

// ---------------------------------------------------------------------------
// Покадровый тик
// ---------------------------------------------------------------------------

/**
 * Обновляет все играющие клипы и машины состояний. Вызывается из api.js раз
 * в кадр (как tickTweens); отдельный $.anim.step не нужен и не заводится в
 * угоду одной точке входа в кадр.
 *
 * Список играющих приходит снимком из индекса реестра: onEnd и обработчики
 * событий могут удалять узлы прямо во время обхода, а мутация ctx.nodes в
 * for-of сдвигала бы индексы и «съедала» соседей.
 */

export function tickAnim(dt) {
    if (!(dt > 0)) return;
    // Ни одного клипа — шагу нечего делать: признак считает индекс реестра
    // (docs/HIGH_LEVEL_API_PERF.md §5, P2), отдельного прохода по ctx.nodes нет.
    if (facetCount('clip') === 0) return;
    const nodes = nodesWithFacet('clip');
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const player = node.__clip;
        if (!player || node.removed) continue;
        if (player.machine) updateMachine(node, player, dt);
        if (player.playing && !player.paused && player.clip) advanceClip(node, player, dt);
    }
}

// ---------------------------------------------------------------------------
// Методы узла
// ---------------------------------------------------------------------------

function installNodeMethods() {
    def('playClip', function (name, opts) {
        if (name === undefined) return this;
        return eachNode(this, (node) => playClipOn(node, name, opts));
    });

    def('stopClip', function () {
        return eachNode(this, (node) => {
            const player = playerOf(node);
            player.playing = false;
            player.paused = false;
            player.clip = null;
            player.name = null;
            player.onEnd = null;
        });
    });

    def('pauseClip', function () {
        return eachNode(this, (node) => { playerOf(node).paused = true; });
    });

    def('resumeClip', function () {
        return eachNode(this, (node) => { playerOf(node).paused = false; });
    });

    // isPlayingClip() остаётся истинным и на паузе: клип не завершён, он ждёт.
    def('isPlayingClip', function () {
        const node = this.nodes[0];
        return !!(node && node.__clip && node.__clip.playing);
    });

    def('clipTime', function () {
        const node = this.nodes[0];
        if (!node || !node.__clip || !node.__clip.clip) return 0;
        const player = node.__clip;
        return clipPhase(player.u, player.loop) * player.clip.duration;
    });

    def('clipProgress', function () {
        const node = this.nodes[0];
        if (!node || !node.__clip || !node.__clip.clip) return 0;
        const player = node.__clip;
        return clipPhase(player.u, player.loop);
    });

    def('clipSpeed', function (value) {
        if (value === undefined) {
            const node = this.nodes[0];
            return node && node.__clip ? node.__clip.speed : 0;
        }
        return eachNode(this, (node) => { playerOf(node).speed = Number(value); });
    });

    def('stateMachine', function (spec) {
        return eachNode(this, (node) => setupMachine(node, spec));
    });

    def('toState', function (name) {
        return eachNode(this, (node) => {
            const player = playerOf(node);
            if (!player.machine) {
                ctx.log('$.anim.toState: у узла нет машины состояний — вызовите .stateMachine({ initial, states })');
                return;
            }
            enterState(node, player, name);
        });
    });

    def('state', function () {
        const node = this.nodes[0];
        return node && node.__clip && node.__clip.machine ? node.__clip.machine.current : null;
    });

    // Секунды — как dt в игровом цикле; clipTime при этом в миллисекундах,
    // потому что duration клипа задаётся в мс.
    def('stateTime', function () {
        const node = this.nodes[0];
        return node && node.__clip && node.__clip.machine ? node.__clip.machine.time : 0;
    });

    def('states', function () {
        const node = this.nodes[0];
        return node && node.__clip && node.__clip.machine ? Object.keys(node.__clip.machine.states) : [];
    });
}

// ---------------------------------------------------------------------------
// Установка подсистемы
// ---------------------------------------------------------------------------

export function installAnim($) {
    $.anim = {
        /** Объявить клип. spec: { duration, loop, speed, tracks, events }. */
        define(name, spec) {
            const key = String(name);
            clips.set(key, normalizeClip(key, spec));
            return $;
        },
        /** Нормализованный клип или null. */
        get(name) { return clips.get(String(name)) || null; },
        has(name) { return clips.has(String(name)); },
        /** Имена всех клипов — для отладочных экранов и тестов. */
        list() { return Array.from(clips.keys()); },
        remove(name) { return clips.delete(String(name)); },
        clear() { clips.clear(); return $; },
    };

    installNodeMethods();
    return $;
}
