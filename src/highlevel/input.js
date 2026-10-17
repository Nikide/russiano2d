// ===========================================================================
// Ввод: $.input — клавиши, действия, мышь, геймпад, события.
//
// Одна точка входа для всей игры. Низкоуровневые engine.keyDown() не
// запрещены, но всё, что нужно игре, должно быть здесь: так ввод можно
// переопределить (агентский режим, перенастройка клавиш) в одном месте.
//
// Имена клавиш — «человеческие»: 'space', 'w', 'left', 'escape', 'f1',
// 'leftshift'. Регистр не важен.
// ===========================================================================

import { engine } from './native.js';
import { ctx, query, engineOf } from './core.js';

// Псевдонимы: то, что пишет игрок → имя, которое понимает SDL.
const ALIASES = {
    space: 'Space', spacebar: 'Space',
    enter: 'Return', return: 'Return',
    esc: 'Escape', escape: 'Escape',
    left: 'Left', right: 'Right', up: 'Up', down: 'Down',
    lshift: 'Left Shift', rshift: 'Right Shift',
    shift: 'Left Shift', lctrl: 'Left Ctrl', rctrl: 'Right Ctrl',
    ctrl: 'Left Ctrl', lalt: 'Left Alt', ralt: 'Right Alt', alt: 'Left Alt',
    tab: 'Tab', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
    home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
    cmd: 'Left GUI', win: 'Left GUI', meta: 'Left GUI',
    minus: '-', plus: '=', equals: '=', comma: ',', period: '.',
    slash: '/', backslash: '\\', semicolon: ';', quote: "'",
};

const GAMEPAD_BUTTONS = {
    a: 0, south: 0, b: 1, east: 1, x: 2, west: 2, y: 3, north: 3,
    back: 4, guide: 5, start: 6, leftstick: 7, rightstick: 8,
    leftshoulder: 9, rightshoulder: 10, dpup: 11, dpdown: 12, dpleft: 13, dpright: 14,
};

const GAMEPAD_AXES = {
    leftx: 0, lefty: 1, rightx: 2, righty: 3, lefttrigger: 4, righttrigger: 5,
};

//: Канонические имена кнопок и осей — в том порядке, в каком их перечисляет
//: `$.input.padState()`. Псевдонимы (south/east/…) живут отдельно, чтобы
//: снимок состояния не показывал одну кнопку дважды.
const GAMEPAD_BUTTON_NAMES = ['a', 'b', 'x', 'y', 'back', 'guide', 'start',
                              'leftstick', 'rightstick', 'leftshoulder', 'rightshoulder',
                              'dpup', 'dpdown', 'dpleft', 'dpright'];
const GAMEPAD_AXIS_NAMES = ['leftX', 'leftY', 'rightX', 'rightY', 'leftTrigger', 'rightTrigger'];

const MOUSE_BUTTONS = { left: 1, middle: 2, right: 3, x1: 4, x2: 5 };

const code_cache = new Map();
const binds = new Map();          // имя действия → [имена клавиш]
const listeners = new Map();      // 'key' | 'mouse' | 'wheel' | 'gamepadOn' | 'gamepadOff'
const prev_mouse = { buttons: 0 };
let gamepad_was_connected = false;
let api = null;                   // $, поставленный installInput: нужен для $.trace
let tick_scene = null;            // смена сцены освобождает input.lock-токены

/**
 * Запись ввода в журнал событий (§23, вкладка EVENTS). `$.trace.note` сам
 * ничего не делает при выключенной трассировке, поэтому вызов безопасен на
 * рёбрах ввода — а они дешёвые: нажатие/отпускание, а не каждый кадр.
 */
function noteInput(data) {
    if (api && api.trace && typeof api.trace.note === 'function') api.trace.note('input', null, data);
}

/** Идёт ли трассировка: тогда рёбра ввода собираются даже без подписчиков. */
function tracing() {
    return !!(api && api.trace && typeof api.trace.on === 'function' && api.trace.on());
}

// Настройки осей. Мёртвая зона гасит дребезг стика: под ним ось считается
// нулевой. 0.2 по умолчанию — привычное значение для геймпадов.
const input_state = { deadzone: 0.2 };

// §15: контексты ввода. Одно действие (confirm, attack) объявлено в нескольких
// контекстах, и вопрос «кто его съел» решается не порядком подписок, а
// приоритетом активного контекста. Без этого confirm одновременно закрывает
// реплику и запускает атаку.
const CONTEXTS = ['gameplay', 'menu', 'dialogue', 'loading'];
const contexts = new Map();              // имя → запись контекста
const waiters = [];                      // ожидания «следующего ввода» (rebind)
const devices = new Map();               // слот → { serial, player, held, last_seen }
let consumes = null;                     // { action, context, at } — что уже съедено
const CONSUME_MS = 120;                  // окно, в котором повторное чтение видит съеденное
const AMBIGUOUS_GAP = 0.12;              // гистерезис: ниже порога — «не действие»

const BINDINGS_KEY = 'input.bindings';   // ключ $.store для save/loadBindings()
const DEFAULTS_KEY = 'input.defaults';   // эталонные привязки для resetDefaults()

let waiter_seq = 1;                      // номера ожиданий захвата ввода
let default_binds = new Map();           // эталон привязок для resetDefaults()
let context_order = 0;                   // порядок включения контекстов
const axis_actions = new Map();          // имя действия оси → настройки (§15)

// Подписи кнопок геймпада для UI: игра показывает их, а не «Button 0».
// Раскладка Xbox — самая распространённая; для других геймпадов подписи
// отличаются, но перепутать кнопки хуже, чем показать привычное имя.
const PAD_GLYPHS = {
    a: 'A', b: 'B', x: 'X', y: 'Y',
    back: 'Back', guide: 'Guide', start: 'Start',
    leftstick: 'LS', rightstick: 'RS',
    leftshoulder: 'LB', rightshoulder: 'RB',
    dpup: 'D-Pad ↑', dpdown: 'D-Pad ↓', dpleft: 'D-Pad ←', dpright: 'D-Pad →',
};

/** Включить/выключить контекст, запомнив порядок включения. */
function setActive(c, on) {
    if (!!on === c.active) return c;
    c.active = !!on;
    if (on) c.order = context_order++;
    return c;
}

/** Погасить дребезг оси: всё, что меньше мёртвой зоны, — ноль. */
function applyDeadzone(value) {
    return Math.abs(value) < input_state.deadzone ? 0 : value;
}

function scancodeOf(name) {
    if (typeof name === 'number') return name;
    // 'mouse.left' — это кнопка мыши, а не клавиша.
    if (String(name).startsWith('mouse.')) return 0;
    const raw = String(name).trim();
    const key = raw.toLowerCase().replace(/[\s_-]/g, '');
    if (code_cache.has(key)) return code_cache.get(key);

    let sdl_name;
    if (ALIASES[key]) sdl_name = ALIASES[key];
    else if (raw.length === 1) sdl_name = raw.toUpperCase();
    else if (/^f\d{1,2}$/.test(key)) sdl_name = key.toUpperCase();
    else sdl_name = raw.replace(/\b\w/g, (c) => c.toUpperCase());

    const code = engine.scancode(sdl_name);
    if (code === 0) ctx.log(`$: неизвестная клавиша "${name}"`);
    code_cache.set(key, code);
    return code;
}

function isGamepadKey(name) {
    return String(name).toLowerCase().startsWith('gamepad.');
}

// Синтетический ввод (§15): нажатия, которые «сделала» игра или тест.
// Живут один кадр (synth_tap) или до явного отпускания (synth_held) и
// участвуют в том же разрешении действий, что настоящие клавиши.
const synth_tap = new Set();      // нажатия, видимые в текущем кадре
const synth_next = new Set();     // нажатия, заказанные на следующий кадр
const synth_held = new Set();     // удерживаемые синтетические клавиши
let synth_seen = false;

/** Контекст по имени; отсутствующий создаётся выключенным. */
function contextOf(name) {
    const key = String(name === undefined || name === null ? 'gameplay' : name);
    let c = contexts.get(key);
    if (!c) {
        c = { name: key, active: false, priority: CONTEXTS.indexOf(key) >= 0 ? 0 : 0,
              binds: new Map() };
        contexts.set(key, c);
    }
    return c;
}

/** Активные контексты: по убыванию приоритета, затем по порядку включения. */
function activeContexts() {
    const out = [];
    for (const c of contexts.values()) if (c.active) out.push(c);
    out.sort((a, b) => (b.priority - a.priority) || (a.order - b.order));
    return out;
}

/** Недавно ли это действие уже потреблено другим контекстом. */
function recentlyConsumed(action) {
    if (!consumes || consumes.action !== action) return false;
    const now = typeof engine !== 'undefined' && engine ? (engine.frame || 0) : 0;
    return now - consumes.at <= 2;
}

export function installInput($) {
    api = $;
    // VN/input lock tokens: advisory ownership slots, not a second input system.
    // `$.input.lock('cutscene')` holds gameplay back; the token auto-releases on
    // scene change, and the dialogue runtime releases its own token on stop.
    const locks = new Map();
    let lock_seq = 0;

    function lockReleaseToken(name, token) {
        const bucket = locks.get(name);
        if (!bucket || !bucket.tokens.has(token)) return false;
        bucket.tokens.delete(token);
        bucket.count -= 1;
        if (bucket.count <= 0) locks.delete(name);
        return true;
    }

    function lockCreate(name, owner, options) {
        const key = String(name === undefined || name === null || name === '' ? 'input' : name);
        const opts = options || {};
        const token = { id: ++lock_seq, name: key, owner: owner === undefined ? null : String(owner),
                        hard: !!opts.hard };
        let bucket = locks.get(key);
        if (!bucket) { bucket = { name: key, count: 0, tokens: new Set() }; locks.set(key, bucket); }
        bucket.count += 1;
        bucket.tokens.add(token);
        token.release = (reason) => {
            const released = lockReleaseToken(key, token);
            if (released) token.reason = reason === undefined ? 'manual' : String(reason);
            return released;
        };
        token.active = () => bucket.tokens.has(token);
        return token;
    }

    /** Есть ли жесткий лок: пока он жив, gameplay-запросы ввода = false. */
    function hardLocked() {
        for (const bucket of locks.values()) {
            for (const token of bucket.tokens) if (token.hard) return true;
        }
        return false;
    }

    function releaseLocks(reason) {
        const released = [];
        for (const [name, bucket] of [...locks.entries()]) {
            for (const token of [...bucket.tokens]) {
                if (lockReleaseToken(name, token)) {
                    token.reason = reason === undefined ? 'releaseAll' : String(reason);
                    released.push(name);
                }
            }
        }
        return released;
    }

    const input = {
        // --- Клавиши --------------------------------------------------------
        // Gameplay-запросы. Пока жив хотя бы один hard-lock, они возвращают
        // false; UI/диалог, который сам держит такой лок, читает raw-варианты.
        down(name) { return input.hardLocked() ? false : input._any(name, 'down'); },
        pressed(name) { return input.hardLocked() ? false : input._any(name, 'pressed'); },
        released(name) { return input.hardLocked() ? false : input._any(name, 'released'); },
        rawDown(name) { return input._any(name, 'down'); },
        rawPressed(name) { return input._any(name, 'pressed'); },
        rawReleased(name) { return input._any(name, 'released'); },

        /**
         * Hold gameplay input for a named owner; returns a release token.
         * `lock(name, owner, {hard:true})` makes down/pressed/released return
         * false until every hard token is released. Advisory tokens stay.
         */
        lock(name, owner, options) { return lockCreate(name, owner, options); },
        /** Advisory ownership query; does not itself gate input. */
        locked(name) {
            if (name === undefined) return locks.size > 0;
            const bucket = locks.get(String(name));
            return !!(bucket && bucket.count > 0);
        },
        /** True while any hard lock is alive; down/pressed/released are gated. */
        hardLocked() { return hardLocked(); },
        hardLocks() {
            const out = [];
            for (const bucket of locks.values()) for (const token of bucket.tokens) if (token.hard) out.push(token.name);
            return out.sort();
        },
        locks() { return [...locks.keys()].sort(); },
        lockCount() { let n = 0; for (const bucket of locks.values()) n += bucket.count; return n; },
        releaseLocks(reason) { return releaseLocks(reason); },

        // Внутренний raw-путь: hard-lock НЕ проверяется здесь, иначе UI не смог
        // бы прочитать собственные клавиши. Гейт стоит в public down/pressed.
        _any(name, kind, seen) {
            if (Array.isArray(name)) return name.some((n) => input._any(n, kind, seen));
            // Кнопки геймпада: у объекта слота есть down(), но не down/released —
            // отсутствие метода означает «состояния нет», а не падение. Раньше
            // здесь был TypeError: not a function, и он убивал `released()`
            // целиком (нашлось тестом §15).
            if (isGamepadKey(name)) {
                const btn = String(name).split('.')[1];
                const pad = input.gamepad(0);
                if (typeof pad[kind] !== 'function') return false;
                return !!pad[kind](btn);
            }

            // §15: явно потреблённое действие не видит НИКТО — ни контексты,
            // ни общий слой привязок. Именно это требование «один confirm не
            // должен одновременно закрывать реплику и выполнять атаку»: меню
            // обработало ввод и погасило его для остальных.
            if (kind === 'pressed' && recentlyConsumed(name)) return false;

            // Действие, объявленное в активном контексте, спрашивается у самого
            // приоритетного такого контекста.
            if (kind === 'pressed' && !binds.has(name)) {
                const owner = activeContexts().find((c) => c.binds.has(name));
                if (owner) return owner.binds.get(name).some((k) => input._any(k, kind, seen));
            }

            // Защита от самоссылки: привязка вроде bind('up', ['w', 'up'])
            // раньше уходила в бесконечную рекурсию, потому что имя действия
            // совпадало с именем клавиши.
            const visited = seen || new Set();
            const bound = binds.get(name);
            if (bound && !visited.has(name)) {
                visited.add(name);
                return bound.some((k) => input._any(k, kind, visited));
            }

            // Порядок важен: 'left' и 'right' — это СТРЕЛКИ, а не кнопки мыши.
            // Поэтому сначала пробуем имя как клавишу и только потом — как
            // кнопку мыши (кнопки мыши доступны и как 'mouse.left').
            const code = scancodeOf(name);
            if (code === 0) {
                const button = MOUSE_BUTTONS[String(name).replace(/^mouse\./, '')];
                if (button === undefined) return false;
                if (kind === 'down') return engine.mouseDown(button);
                if (kind === 'pressed') return engine.mousePressed(button);
                return false;
            }
            if (kind === 'down') return engine.keyDown(code) || synth_held.has(code) || synth_tap.has(code);
            if (kind === 'pressed') return engine.keyPressed(code) || (synth_seen && synth_tap.has(code));
            return engine.keyReleased(code) || (synth_seen && synth_tap.has(code));
        },

        /** Ось -1..1 по двум именам (клавиша, действие или кнопка геймпада). */
        axis(negative, positive) {
            let v = 0;
            if (input.down(negative)) v -= 1;
            if (input.down(positive)) v += 1;
            return applyDeadzone(v);
        },

        /**
         * Мёртвая зона осей (0..1): $.input.deadzone(0.3). Без аргумента —
         * текущее значение. Влияет на axis() и на аналоговый стик в vec().
         */
        deadzone(value) {
            if (value === undefined) return input_state.deadzone;
            const v = Number(value);
            if (!Number.isFinite(v) || v < 0) {
                ctx.log(`$.input.deadzone: нужно число 0..1, получено ${value}`);
                return input_state.deadzone;
            }
            input_state.deadzone = Math.min(1, v);
            return input;
        },

        /** Готовый вектор: vec('wasd') → {x, y}; vec('arrows'), vec('both'). */
        vec(what) {
            const scheme = what || 'wasd';
            const sets = {
                wasd:   [['a'], ['d'], ['w'], ['s']],
                arrows: [['left'], ['right'], ['up'], ['down']],
                both:   [['a', 'left'], ['d', 'right'], ['w', 'up'], ['s', 'down']],
            };
            const s = sets[scheme] || sets.wasd;
            let x = 0, y = 0;
            if (s[0].some((k) => input.down(k))) x -= 1;
            if (s[1].some((k) => input.down(k))) x += 1;
            if (s[2].some((k) => input.down(k))) y -= 1;
            if (s[3].some((k) => input.down(k))) y += 1;
            const gx = applyDeadzone(input.padAxis(0));
            const gy = applyDeadzone(input.padAxis(1));
            x += gx;
            y += gy;
            const len = Math.hypot(x, y);
            return len > 1 ? { x: x / len, y: y / len } : { x, y };
        },

        /** Ось геймпада по индексу или имени. */
        padAxis(axis) {
            const index = typeof axis === 'string' ? (GAMEPAD_AXES[axis.toLowerCase()] ?? 0) : axis;
            return engine.padAxis(index);
        },

        padDown(button) {
            const index = typeof button === 'string' ? (GAMEPAD_BUTTONS[button.toLowerCase()] ?? -1) : button;
            return index < 0 ? false : engine.padDown(index);
        },

        /**
         * Состояние слота геймпада одним объектом — для отладочного оверлея,
         * экрана настроек и тестов (один вызов вместо пятнадцати):
         *
         *   $.input.padState(0)
         *   // { slot: 0, connected: false, virtual: true,
         *   //   down: ['a'], pressed: [], held: [0],
         *   //   axes: { leftX: 0.5, leftY: 0, …, leftTrigger: 0, rightTrigger: 0 } }
         *
         *   * `down` — кнопки, удерживаемые сейчас; `pressed` — фронты этого
         *     кадра (одно нажатие = один кадр с `true`);
         *   * `axes` — СЫРЫЕ значения: мёртвая зона применяется там, где ось
         *     читают (`$.input.vec()`, `$.input.axis()`), а не в снимке;
         *     курки идут 0..1, как их отдаёт SDL (не −1..1);
         *   * `virtual` — состояние есть, а устройства нет: так выглядит слот,
         *     в который пишет агентская команда `pad` (см. docs/AGENT_API.md);
         *   * `held` — то же, что помнит слой устройств (`$.input.device(slot).held()`).
         */
        padState(slot) {
            const i = Math.max(0, Math.floor(Number(slot) || 0));
            const pad = input.gamepad(i);
            const down = [];
            const pressed = [];
            for (const name of GAMEPAD_BUTTON_NAMES) {
                if (pad.down(name)) down.push(name);
                if (pad.pressed(name)) pressed.push(name);
            }
            const axes = {};
            for (const name of GAMEPAD_AXIS_NAMES) axes[name] = pad.axis(name);
            const d = devices.get(i);
            const connected = pad.connected();
            const active = down.length > 0 || pressed.length > 0
                || GAMEPAD_AXIS_NAMES.some((n) => axes[n] !== 0);
            return {
                slot: i,
                connected,
                virtual: !connected && active,
                down,
                pressed,
                held: d ? [...d.held] : [],
                axes,
            };
        },

        /**
         * Геймпад по НОМЕРУ: `$.input.gamepad(1).down('a')` — для игры вдвоём-
         * вчетвером. Слот 0 — тот же геймпад, что и у `$.input.padDown`.
         */
        gamepad(slot) {
            const index = Math.max(0, Math.floor(Number(slot) || 0));
            // В модуле НЕТ глобального `engine`: подсистемы берут движок через
            // engineOf() (иначе ReferenceError и вся подсистема мертва —
            // нашлось тестом).
            const api = engineOf();
            const has = typeof api.padDownAt === 'function';
            return {
                slot: index,
                connected() {
                    if (typeof api.padConnectedAt === 'function') return !!api.padConnectedAt(index);
                    return index === 0 && !!api.padConnected();
                },
                /** Кнопка по имени ('a', 'leftTrigger') или номеру. */
                button(name) { return this.down(name); },
                down(button) {
                    if (!has) return index === 0 && input.padDown(button);
                    const b = typeof button === 'string'
                        ? (GAMEPAD_BUTTONS[button.toLowerCase()] ?? -1) : button;
                    if (b < 0) return false;
                    return !!api.padDownAt(index, b);
                },
                pressed(button) {
                    if (typeof api.padPressedAt !== 'function') return false;
                    const b = typeof button === 'string'
                        ? (GAMEPAD_BUTTONS[button.toLowerCase()] ?? -1) : button;
                    return b < 0 ? false : !!api.padPressedAt(index, b);
                },
                axis(name) {
                    if (typeof api.padAxisAt !== 'function') return 0;
                    const a = typeof name === 'string' ? (GAMEPAD_AXES[name.toLowerCase()] ?? 0) : name;
                    return api.padAxisAt(index, a);
                },
                rumble(opts) {
                    if (typeof api.padRumbleAt !== 'function') return false;
                    const o = opts || {};
                    // Честно: виброаппарата может не быть — игра обязана узнать.
                    return !!api.padRumbleAt(index,
                        o.low === undefined ? 0.6 : o.low,
                        o.high === undefined ? 0.6 : o.high,
                        o.ms === undefined ? 220 : o.ms);
                },
                describe() {
                    return `геймпад ${index}: ${this.connected() ? 'подключён' : 'нет'}`;
                },
            };
        },

        /** Сколько геймпадов подключено и сколько слотов всего. */
        padCount() {
            const api = engineOf();
            return typeof api.padCount === 'function' ? api.padCount() : 0;
        },
        padSlots() {
            const api = engineOf();
            return typeof api.padSlots === 'function' ? api.padSlots() : 1;
        },

        /**
         * Касания: `$.input.touches()` отдаёт список пальцев текущего кадра —
         * `[{ id, x, y, dx, dy, pressure }]`. Пальцы приходят ОТДЕЛЬНО от мыши:
         * подменять их мышью нельзя, мультитач так не сделать.
         */
        touches() {
            const out = [];
            const api = engineOf();
            if (typeof api.touchCount !== 'function') return out;
            const count = api.touchCount();
            for (let i = 0; i < count; ++i) {
                const one = input.touch(i);
                if (one) out.push(one);
            }
            return out;
        },
        /**
         * Модификаторы — доступны и из игры: `$.input.ctrlDown()`.
         * Нужны для Ctrl+C/V/X/A в текстовых полях и для своих сокращений.
         */
        shiftDown() { return shiftDown(); },
        ctrlDown() { return ctrlDown(); },
        altDown() { return altDown(); },

        /** Сколько пальцев на экране. */
        touchCount() {
            const api = engineOf();
            return typeof api.touchCount === 'function' ? api.touchCount() : 0;
        },
        /** Палец по индексу (или null). */
        touch(index) {
            const i = Math.floor(Number(index) || 0);
            const api = engineOf();
            if (typeof api.touchDown !== 'function' || !api.touchDown(i)) return null;
            const at = api.touch(i);
            if (!at) return null;
            const d = api.touchDelta ? api.touchDelta(i) : null;
            return { id: i, x: at.x, y: at.y, dx: d ? d.x : 0, dy: d ? d.y : 0,
                     pressure: api.touchPressure ? api.touchPressure(i) : 1 };
        },
        /** Есть ли касание (любое). */
        touched() { return input.touchCount() > 0; },

        // --- Мышь ------------------------------------------------------------
        mouse() { return { x: engine.mouseX, y: engine.mouseY }; },

        /**
         * Системный курсор: `$.mouse.cursor('crosshair')`, формы — arrow, hand,
         * crosshair, text, wait, hidden (без аргумента — текущая).
         * `$.mouse.cursorVisible(false)` прячет курсор совсем.
         */
        cursor(shape) {
            return typeof engine.setCursor === 'function' ? engine.setCursor(shape) : 'arrow';
        },
        cursorVisible(on) {
            return typeof engine.cursorVisible === 'function' ? engine.cursorVisible(on) : true;
        },
        mouseDelta() {
            const d = engine.mouseDelta();
            return { x: d[0], y: d[1] };
        },
        mouseDown(button) { return input.hardLocked() ? false : engine.mouseDown(MOUSE_BUTTONS[button] || button || 1); },
        mousePressed(button) { return input.hardLocked() ? false : engine.mousePressed(MOUSE_BUTTONS[button] || button || 1); },
        rawMouseDown(button) { return engine.mouseDown(MOUSE_BUTTONS[button] || button || 1); },
        rawMousePressed(button) { return engine.mousePressed(MOUSE_BUTTONS[button] || button || 1); },
        wheel() { return { x: 0, y: engine.wheel }; },

        // --- Текст -----------------------------------------------------------
        /** Символы, введённые за этот кадр (UTF-8, с учётом раскладки).
         *  Основа <ui.input>: скан-коды не знают про IME и compose. */
        text() { return engine.textInput(); },

        /** Курсор в мировых координатах. */
        mouseWorld() { return ctx.camera.screenToWorld(input.mouse()); },

        // --- Подписки --------------------------------------------------------
        on(name, fn) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(fn);
            return input;
        },

        off(name, fn) {
            if (!name) { listeners.clear(); return input; }
            if (!fn) { listeners.delete(name); return input; }
            listeners.set(name, (listeners.get(name) || []).filter((f) => f !== fn));
            return input;
        },

        // --- Действия --------------------------------------------------------
        bind(action, keys) {
            binds.set(action, Array.isArray(keys) ? keys : [keys]);
            return input;
        },
        unbind(action) { binds.delete(action); return input; },
        bindings() { return Object.fromEntries(binds); },

        /** Имена всех объявленных действий — для меню перенастройки. */
        actions() { return [...binds.keys()]; },

        /**
         * Отладочная сводка по действию: { action, keys, down, pressed }.
         * down/pressed считаются по текущему состоянию ввода.
         */
        describe(action) {
            const keys = binds.has(action) ? binds.get(action).slice() : [];
            const bound = keys.length > 0;
            return {
                action,
                keys,
                down: bound ? input.down(action) : false,
                pressed: bound ? input.pressed(action) : false,
            };
        },

        /**
         * Алиас bind() с проверками: неизвестное действие, пустой список или
         * нестроковый ключ — предупреждение вместо молчаливой поломки.
         */
        rebind(action, keys) {
            if (typeof action !== 'string' || action.trim() === '') {
                ctx.log('$.input.rebind: нужно имя действия непустой строкой');
                return input;
            }
            const list = Array.isArray(keys) ? keys : (keys === undefined || keys === null ? [] : [keys]);
            if (list.length === 0) {
                ctx.log(`$.input.rebind: для действия "${action}" нужен хотя бы один ключ`);
                return input;
            }
            const bad = list.find((k) => typeof k !== 'string');
            if (bad !== undefined) {
                ctx.log(`$.input.rebind: ключи действия "${action}" должны быть строками, получено ${JSON.stringify(bad)}`);
                return input;
            }
            if (!binds.has(action)) {
                // Новое действие не запрещено, но чаще всего это опечатка —
                // поэтому говорим, а не молчим.
                ctx.log(`$.input.rebind: действие "${action}" не было объявлено — создаю новое`);
            }
            binds.set(action, list.slice());
            return input;
        },

        /** Сохранить привязки в $.store (ключ input.bindings). */
        saveBindings() {
            const store = ctx.store || (ctx.$ && ctx.$.store);
            if (!store || typeof store.set !== 'function') {
                ctx.log('$.input.saveBindings: $.store недоступен — привязки не сохранены');
                return false;
            }
            const data = {};
            for (const [action, keys] of binds) data[action] = keys.slice();
            store.set(BINDINGS_KEY, data);
            return true;
        },

        /**
         * Восстановить привязки из $.store. Восстанавливаются только
         * непустые массивы строк: испорченная запись пропускается с
         * предупреждением, а не превращает down()/pressed() в мусор.
         */
        loadBindings() {
            const store = ctx.store || (ctx.$ && ctx.$.store);
            if (!store || typeof store.get !== 'function') {
                ctx.log('$.input.loadBindings: $.store недоступен');
                return false;
            }
            const data = store.get(BINDINGS_KEY, null);
            if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
            let restored = 0;
            for (const action of Object.keys(data)) {
                const keys = data[action];
                if (!Array.isArray(keys) || keys.length === 0 || keys.some((k) => typeof k !== 'string')) {
                    ctx.log(`$.input.loadBindings: привязка "${action}" пропущена — ожидался непустой массив строк`);
                    continue;
                }
                binds.set(action, keys.slice());
                restored++;
            }
            return restored > 0;
        },

        /**
         * Виртуальное (скриптовое) нажатие клавиши.
         *
         * Ввод от скрипта идёт тем же путём, что и настоящий: `down/pressed/
         * released`, действия, контексты и потребление видят его одинаково.
         * Это и есть требование §15 «virtual input использует тот же action
         * resolution» — и заодно единственный способ надёжно протестировать
         * ввод: настоящая клавиша живёт один кадр, а скрипт может попросить
         * нажатие ровно на своём кадре.
         *
         *   $.input.synthPress('space');   // нажато ровно в этом кадре
         *   $.input.synthDown('space');    // держится
         *   $.input.synthRelease('space');
         *   $.input.synthClear();
         */
        synthPress(name) {
            // Всегда заказываем на ближайший кадр, а не пишем прямо в текущий:
            // начало кадра чистит видимый набор, поэтому «немедленная» запись
            // терялась, если её сделали между кадрами (нашлось тестом §15).
            synth_next.add(scancodeOf(name));
            noteInput({ action: 'key down', key: String(name), code: scancodeOf(name), synth: true });
            return input;
        },
        synthDown(name) {
            synth_held.add(scancodeOf(name));
            noteInput({ action: 'key down', key: String(name), code: scancodeOf(name), synth: true, hold: true });
            return input;
        },
        synthRelease(name) {
            synth_held.delete(scancodeOf(name));
            noteInput({ action: 'key up', key: String(name), code: scancodeOf(name), synth: true });
            return input;
        },
        synthClear() { synth_held.clear(); synth_tap.clear(); synth_next.clear(); return input; },
        /** Правило: синтетические нажатия видны в этом кадре или нет. */
        synthSeen() { return synth_seen; },
        synthRule(enabled) { synth_seen = !!enabled; return input; },

        /** Клавиши, нажатые в этом кадре (имена для $.input.on). */
        _pressedCodes() {
            const out = engine.keysPressed().slice();
            if (!synth_seen) return out;
            for (const code of synth_tap) if (!out.includes(code)) out.push(code);
            return out;
        },
        _releasedCodes() {
            const out = engine.keysReleased().slice();
            if (!synth_seen) return out;
            for (const code of synth_tap) if (!out.includes(code)) out.push(code);
            return out;
        },

        /**
         * Виброотклик: трясёт первый подключённый геймпад и возвращает true,
         * если тряска действительно ушла в устройство. Без геймпада (или если
         * он не умеет вибрировать) — false: игра должна узнать, что её тряска
         * ушла в пустоту, а не считать, что игрока тряхнуло.
         *
         *   $.input.rumble();                                    // импульс 0.5/0.5, 250 мс
         *   $.input.rumble({ weak: 0.3, strong: 0.8, duration: 400 });
         *   $.input.rumble({ triggers: [0.5, 0.5] });            // вибрация курков
         *   $.input.rumble(0);                                   // остановить
         *
         * weak — слабый (высокочастотный) мотор, strong — сильный
         * (низкочастотный), duration — миллисекунды. Адресно —
         * `$.input.gamepad(i).rumble(...)`.
         */
        rumble(opts) {
            for (let i = 0; i < 8; i++) {
                if (pad_connected(i)) return rumble(i, opts);
            }
            return false;
        },

        /** Есть ли геймпад, которому можно адресовать виброотклик. */
        rumbleSupported() { return pad_connected(0); },

        /** Остановить вибрацию — то же, что `$.input.rumble(0)`. */
        stopRumble() { return rumble(0, 0); },

        // --- §15: контексты, потребление и захват ввода -----------------------

        /**
         * Объявить/включить контекст ввода.
         *
         *   $.input.context('menu', { active: true, priority: 10, binds: { confirm: ['space','gamepad.a'] } });
         *   $.input.context('gameplay').active(true);
         *   $.input.context()                       // список контекстов
         *
         * `active(true)` поднимает контекст наверх стека потребления: пока он
         * активен, `pressed(action)` отдаёт действие именно ему, а не тому, кто
         * успел подписаться раньше. Это и есть ответ на «один confirm не должен
         * закрывать реплику и бить одновременно».
         */
        context(name, opts) {
            if (name === undefined) {
                const out = [];
                for (const c of contexts.values()) {
                    out.push({ name: c.name, active: c.active, priority: c.priority,
                               binds: Object.fromEntries(c.binds) });
                }
                out.sort((a, b) => b.priority - a.priority);
                return out;
            }
            const c = contextOf(name);
            if (opts && typeof opts === 'object') {
                if (opts.priority !== undefined) c.priority = Number(opts.priority) || 0;
                if (opts.binds && typeof opts.binds === 'object') {
                    for (const action of Object.keys(opts.binds)) {
                        c.binds.set(action, Array.isArray(opts.binds[action])
                            ? opts.binds[action].slice() : [opts.binds[action]]);
                    }
                }
                if (opts.active !== undefined) setActive(c, !!opts.active);
            }
            // Обёртка, чтобы `$.input.context('menu').active(true)` читалось
            // как обычная цепочка $.
            const view = {
                name: c.name,
                active(value) {
                    if (value === undefined) return c.active;
                    setActive(c, !!value);
                    return view;
                },
                priority(value) {
                    if (value === undefined) return c.priority;
                    c.priority = Number(value) || 0;
                    return view;
                },
                bind(action, keys) { c.binds.set(action, Array.isArray(keys) ? keys.slice() : [keys]); return view; },
                binds() { return Object.fromEntries(c.binds); },
            };
            return view;
        },

        /** Явно выключить контекст (то же, что `.active(false)`). */
        contextOff(name) { setActive(contextOf(name), false); return input; },

        /**
         * Потребление действия активными контекстами.
         *
         *   if ($.input.consume('confirm')) { ... }     // я обработал confirm
         *   $.input.consumed()                          // кто съел ввод в кадре
         *   $.input.consume()                           // сбросить отметку
         *
         * Потребление действует на кадр и на 2 кадра вперёд: если меню закрыло
         * реплику на `pressed`, gameplay в этом же кадре уже не должен видеть
         * то же нажатие. Сбрасывается само на следующем кадре.
         */
        consume(action) {
            if (action === undefined) { consumes = null; return input; }
            const c = activeContexts()[0];
            consumes = { action: String(action), context: c ? c.name : null,
                         at: typeof engine !== 'undefined' && engine ? (engine.frame || 0) : 0 };
            return true;
        },

        /** Что и кем потреблено в этом кадре (для отладки и §28). */
        consumed() { return consumes ? Object.assign({}, consumes) : null; },

        /** Ожидание следующего подходящего ввода: перепривязка «нажми клавишу». */
        waitForInput(opts) {
            const o = opts || {};
            const waiter = {
                id: 'w' + (waiter_seq++),
                action: o.action === undefined ? null : String(o.action),
                resolve: null, reject: null,
                timeout_ms: Number(o.timeout || o.timeout_ms || 0) || 0,
                started: typeof engine !== 'undefined' && engine ? (engine.frame || 0) : 0,
                // Игнорируем УЖЕ УДЕРЖАННЫЕ клавиши: иначе захват ловит ту же
                // кнопку, которой игрок открыл экран перенастройки. Набор
                // фиксируется сейчас и не меняется — иначе отпускание кнопки
                // съедало бы собственное нажатие.
                // Явный список того, что игнорировать; пустой по умолчанию:
                // удержанные клавиши не дают нового фронта нажатия и так.
                ignore: Array.isArray(o.ignore) ? o.ignore.slice() : [],
                onDone: typeof o.onDone === 'function' ? o.onDone : null,
                promise: null,
            };
            waiter.promise = new Promise((resolve, reject) => { waiter.resolve = resolve; waiter.reject = reject; });
            waiters.push(waiter);
            return waiter.promise;
        },

        /** Сколько ожиданий захвата сейчас висит. */
        waiters() { return waiters.length; },

        /** Отменить все ожидания (например, экран перенастройки закрыли). */
        cancelWaits(reason) {
            while (waiters.length) {
                const w = waiters.pop();
                if (w.onDone) w.onDone(null, reason || 'cancel');
                w.reject(new Error(reason || 'cancel'));
            }
            return input;
        },

        /**
         * Конфликт привязок: какие ещё действия используют эти клавиши.
         * Возвращает `[{ action, keys }]` без самого переназначаемого действия.
         */
        conflicts(action, keys) {
            const want = (Array.isArray(keys) ? keys : [keys]).filter((k) => typeof k === 'string')
                .map((k) => k.toLowerCase());
            const out = [];
            for (const [name, list] of binds) {
                if (name === action) continue;
                const shared = list.filter((k) => want.includes(String(k).toLowerCase()));
                if (shared.length) out.push({ action: name, keys: shared });
            }
            for (const c of contexts.values()) {
                for (const [name, list] of c.binds) {
                    if (name === action) continue;
                    const shared = list.filter((k) => want.includes(String(k).toLowerCase()));
                    if (shared.length) out.push({ action: name, context: c.name, keys: shared });
                }
            }
            return out;
        },

        /** Запомнить текущие привязки как эталон для resetDefaults(). */
        markDefaults() {
            default_binds = new Map();
            for (const [a, k] of binds) default_binds.set(a, k.slice());
            return input;
        },

        /** Вернуть привязки к эталону (markDefaults или первой загрузке). */
        resetDefaults() {
            if (default_binds.size === 0) {
                ctx.log('$.input.resetDefaults: эталон не задан — вызовите $.input.markDefaults() после объявления привязок');
                return false;
            }
            binds.clear();
            for (const [a, k] of default_binds) binds.set(a, k.slice());
            return true;
        },

        /** Что игрок реально видит на кнопках: подписи для текущего устройства. */
        glyphs(action) {
            const list = binds.get(action) || [];
            const pad = typeof engineOf().padConnected === 'function' && engineOf().padConnected();
            const out = [];
            for (const key of list) {
                const k = String(key);
                if (k.startsWith('gamepad.')) {
                    if (pad) out.push(PAD_GLYPHS[k.split('.')[1].toLowerCase()] || k.split('.')[1]);
                } else {
                    out.push(k.replace(/^left|^right/, (m) => m).toUpperCase());
                }
            }
            return out;
        },

        /**
         * Политика устройств: слот геймпада → игрок. Перестановка слотов НЕ
         * должна молча менять игрока: слот закрепляется за игроком, пока
         * устройство подключено, а освободившийся слот достаётся новому
         * устройству только по явному `assign`.
         */
        device(slot) {
            const i = Math.max(0, Math.floor(Number(slot) || 0));
            if (!devices.has(i)) devices.set(i, { serial: null, player: i, held: new Set() });
            const d = devices.get(i);
            return {
                slot: i,
                player() { return d.player; },
                assign(player) { d.player = Math.max(0, Math.floor(Number(player) || 0)); return this; },
                connected() {
                    const api = engineOf();
                    if (typeof api.padConnectedAt === 'function') return !!api.padConnectedAt(i);
                    return i === 0 && typeof api.padConnected === 'function' && !!api.padConnected();
                },
                held() { return [...d.held]; },
            };
        },

        /** Все слоты устройств с их игроками. */
        devices() {
            const out = [];
            for (const [slot, d] of devices) out.push({ slot, player: d.player, serial: d.serial, held: [...d.held] });
            return out;
        },

        /**
         * Сбросить состояние удержаний: вызывается автоматически при
         * отключении геймпада, но игру это тоже касается — после отключения
         * «зажатая» кнопка не должна остаться зажатой навсегда.
         */
        resetHeld(slot) {
            const d = devices.get(Math.max(0, Math.floor(Number(slot) || 0)));
            if (!d) return false;
            d.held.clear();
            // Сбрасываем и внутреннее состояние «был нажат», иначе первый
            // pressed после переподключения придёт как released.
            for (let i = 0; i < pad_prev.length; i++) pad_prev[i] = false;
            return true;
        },

        /** Осталась ли «зажатой» кнопка, которой уже нет на устройстве. */
        stuck() {
            const out = [];
            for (const [slot, d] of devices) {
                if (padSlotLive(slot) || d.held.size === 0) continue;
                out.push({ slot, held: [...d.held] });
            }
            return out;
        },

        // --- Аналоговые оси: порог и гистерезис (§15) -------------------------

        /**
         * Ось как ДЕЙСТВИЕ: значение выше порога считается нажатием, но чтобы
         * отпустить, стик должен вернуться ниже порога минус гистерезис —
         * иначе на границе получается дребезг.
         *
         *   $.input.axisAction('moveleft', { axis: 'leftx', sign: -1, threshold: 0.4 });
         *   $.input.axisAction('moveleft')   // true/false
         */
        axisAction(name, opts) {
            if (opts && typeof opts === 'object') {
                axis_actions.set(String(name), {
                    axis: opts.axis === undefined ? 'leftx' : opts.axis,
                    sign: Number(opts.sign || 1) < 0 ? -1 : 1,
                    threshold: opts.threshold === undefined ? 0.4 : Number(opts.threshold),
                    hysteresis: opts.hysteresis === undefined ? AMBIGUOUS_GAP : Number(opts.hysteresis),
                    active: false,
                });
                return input;
            }
            const a = axis_actions.get(String(name));
            if (!a) return false;
            const raw = input.padAxis(a.axis) * a.sign;
            const limit = a.active ? a.threshold - a.hysteresis : a.threshold;
            a.active = raw > limit;
            return a.active;
        },

        /** Определённые действия осей — для отладки и меню. */
        axisActions() {
            const out = {};
            for (const [name, a] of axis_actions) {
                out[name] = { axis: a.axis, sign: a.sign, threshold: a.threshold,
                              hysteresis: a.hysteresis, active: a.active };
            }
            return out;
        },
    };

    ctx.input = input;
    return input;
}

// ---------------------------------------------------------------------------
// События: раз в кадр сверяем состояние ввода с прошлым
// ---------------------------------------------------------------------------

const pad_prev = new Array(32).fill(false);

function pad_connected(index) {
    // Движок открывает первый геймпад и умеет честно сказать, есть ли он.
    // Прежняя догадка «нет осей и кнопок — значит геймпада нет» ошибалась на
    // подключённом, но не тронутом геймпаде, а он вибрировать умеет.
    if (index > 0) return false;
    if (typeof engine.padConnected === 'function') return engine.padConnected() === true;
    return engine.padDown(0) || engine.padDown(1) || engine.padDown(2) ||
           engine.padDown(3) || engine.padAxis(0) !== 0 || engine.padAxis(1) !== 0;
}

function padPressed(index) {
    const now = engine.padDown(index);
    const was = pad_prev[index];
    pad_prev[index] = now;
    return now && !was;
}

/**
 * Приводит аргумент виброотклика к виду { weak, strong, duration, triggers }.
 * Чистая функция — её проверяет qjs-харнесс без движка.
 *
 * Понимает: ничего (умолчания), `0`/`false` (стоп), число (обе силы), объект
 * с `weak`/`strong` (плюс псевдонимы `high`/`low`, как у моторов SDL) и
 * `triggers: [left, right]` для вибрации курков. Силы зажимаются в 0..1:
 * значение вне диапазона — почти всегда опечатка вида `{ strong: 100 }`.
 */
export function normalizeRumble(opts) {
    const clamp01 = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n > 1 ? 1 : n;
    };
    const dur = (v, fallback) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return fallback;
        return Math.min(60000, Math.round(n));
    };

    if (opts === 0 || opts === false) return { weak: 0, strong: 0, duration: 0, triggers: null };
    if (opts === undefined || opts === null || opts === true) {
        return { weak: 0.5, strong: 0.5, duration: 250, triggers: null };
    }
    if (typeof opts === 'number') {
        return { weak: clamp01(opts), strong: clamp01(opts), duration: 250, triggers: null };
    }
    if (typeof opts !== 'object') {
        return { weak: 0.5, strong: 0.5, duration: 250, triggers: null };
    }

    let triggers = null;
    if (Array.isArray(opts.triggers)) {
        triggers = [clamp01(opts.triggers[0]), clamp01(opts.triggers[1])];
    }

    const weak = opts.weak !== undefined ? opts.weak : opts.high;
    const strong = opts.strong !== undefined ? opts.strong : opts.low;
    return {
        weak: clamp01(weak === undefined ? 0.5 : weak),
        strong: clamp01(strong === undefined ? 0.5 : strong),
        duration: dur(opts.duration, 250),
        triggers,
    };
}

/**
 * Виброотклик: переводит opts в вызовы C и возвращает true, только если
 * тряска действительно ушла в устройство. Движок открывает один геймпад,
 * поэтому адресные вызовы для pad > 0 честно возвращают false.
 */
function rumble(pad, opts) {
    if (pad > 0) return false;
    const o = normalizeRumble(opts);
    let sent = false;

    if (o.triggers && typeof engine.padRumbleTriggers === 'function') {
        sent = engine.padRumbleTriggers(o.triggers[0], o.triggers[1], o.duration) === true || sent;
    }
    // Нулевая длительность — это «стоп»: её тоже надо отправить в SDL.
    if (o.weak > 0 || o.strong > 0 || o.duration === 0) {
        sent = engine.padRumble(o.strong, o.weak, o.duration) === true || sent;
    }
    return sent;
}

function emit(name, payload) {
    const list = listeners_of(name);
    for (const fn of list) {
        try { fn(payload); } catch (e) { ctx.log(`$: ошибка в обработчике ввода "${name}": ${e}`); }
    }
}

function listeners_of(name) { return listeners.get(name) || []; }

// Имена клавиш. Движок умеет их отдавать (engine.keyName), но раньше таблица
// никем не заполнялась, и $.input.on('key') получал ЧИСЛО вместо «Space» —
// значит, нельзя было показать «нажмите Пробел» и тяжело было делать ребинд.
const KEY_NAMES = new Map();
function keyName(code) {
    const key = Math.floor(Number(code) || 0);
    if (KEY_NAMES.has(key)) return KEY_NAMES.get(key);
    let name = '';
    if (typeof engine !== 'undefined' && engine && typeof engine.keyName === 'function') {
        try { name = String(engine.keyName(key) || ''); } catch (e) { name = ''; }
    }
    // Без движка (юнит-тесты) остаётся номер: лучше число, чем пустая строка.
    if (!name || name === String(key)) name = String(key);
    KEY_NAMES.set(key, name);
    return name;
}

/**
 * Открыть окно синтетического ввода на текущий кадр.
 *
 * Разовые нажатия гасятся здесь, а НЕ в конце кадра: кадр состоит из
 * нескольких шагов (ввод → таймеры → логика игры → рендер), и если погасить
 * нажатие в конце tickInput, логика игры его уже не увидит — проверено тестом.
 * Заказанное до кадра (`synth_next`) переносится в видимые в этом кадре.
 */
function startSynthFrame() {
    synth_tap.clear();
    for (const code of synth_next) synth_tap.add(code);
    synth_next.clear();
    synth_seen = true;
}

/**
 * Состояние устройств ввода (§15).
 *
 * Отдельная функция, а не «побочный эффект события»: отключение геймпада во
 * время удержания кнопки обязано сбросить удержание, даже если игра не
 * подписана на gamepadOff. Иначе действие остаётся «зажатым» навсегда.
 */
/**
 * Жив ли слот: устройство подключено ИЛИ в слот пишет инъекция.
 *
 * Второе важно и для игры, и для тестов: команда `pad` (docs/AGENT_API.md)
 * наполняет слот без железа — в CI его иначе не проверить. Слот, который
 * ничего не отдаёт и ничем не управляется, считается мёртвым, и удержания по
 * нему сбрасываются (это и есть защита от «залипшей» кнопки).
 */
function padSlotLive(i) {
    const api = engineOf();
    if (typeof api.padConnectedAt === 'function') {
        if (api.padConnectedAt(i)) return true;
    } else if (i === 0 && typeof api.padConnected === 'function' && api.padConnected()) {
        return true;
    }
    if (typeof api.padDownAt === 'function') {
        for (let b = 0; b < 32; b++) if (api.padDownAt(i, b)) return true;
    }
    if (typeof api.padAxisAt === 'function') {
        for (let a = 0; a < 8; a++) if (api.padAxisAt(i, a) !== 0) return true;
    }
    return false;
}

function tickDevices() {
    const api = engineOf();
    const slots = typeof api.padSlots === 'function' ? Math.max(1, api.padSlots()) : 4;
    for (let i = 0; i < Math.max(4, slots); i++) {
        let d = devices.get(i);
        if (!d) { d = { serial: null, player: i, held: new Set() }; devices.set(i, d); }
        const live = padSlotLive(i);
        if (!live) {
            if (d.held.size) d.held.clear();
            d.serial = null;
            continue;
        }
        for (let b = 0; b < 32; b++) {
            const val = typeof api.padDownAt === 'function'
                ? !!api.padDownAt(i, b)
                : (i === 0 ? !!api.padDown(b) : false);
            if (val) d.held.add(b); else d.held.delete(b);
        }
    }
}

/**
 * Ожидания «нажми клавишу» (§15). Раз в кадр смотрим, что игрок нажал, и
 * отдаём первому ожидающему. Удержанные клавиши не считаются: иначе захват
 * ловит ту самую кнопку, которой открыли экран перенастройки.
 */
function tickWaiters() {
    if (waiters.length === 0) return;
    const frame = typeof engine !== 'undefined' && engine ? (engine.frame || 0) : 0;
    // Нажатие начинается отпусканием: пока кнопка держится, ждать нечего.
    // Игнор фиксируется в момент запроса захвата (см. waitForInput) и БОЛЬШЕ не
    // пополняется: раньше сюда попадало и отпускание той же кнопки, из-за чего
    // обычный тап не ловился — ожидание висело до таймаута (нашлось тестом §15).
    const pressed = engine.keysPressed();
    for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.timeout_ms > 0 && (frame - w.started) * (1000 / 60) > w.timeout_ms) {
            waiters.splice(i, 1);
            if (w.onDone) w.onDone(null, 'timeout');
            w.reject(new Error('timeout'));
            continue;
        }
        const hit = pressed.find((code) => !w.ignore.includes(code));
        if (hit !== undefined) {
            waiters.splice(i, 1);
            const named = keyName(hit);
            if (w.onDone) w.onDone(named);
            w.resolve(named);
        }
    }
}

/** Вызывается из $.time каждый кадр: рассылает $.input.on('key'/'mouse'/'wheel'). */
export function tickInput() {
    // VN lock contract: any scene change releases held input locks.
    if (api && api.input && typeof api.input.releaseLocks === 'function') {
        const current = ctx.scene && typeof ctx.scene.current === 'function' ? ctx.scene.current() : null;
        if (tick_scene !== current) {
            if (tick_scene !== null) api.input.releaseLocks('scene change');
            tick_scene = current;
        }
    }
    // §15: состояние устройств и захват ввода должны работать даже без
    // подписок на события — иначе отключённый геймпад оставлял бы «зажатую»
    // кнопку до тех пор, пока игра не подписалась на что-нибудь.
    tickDevices();
    tickWaiters();
    // Синтетический ввод должен быть разрешён в начале кадра и погашен в
    // конце: иначе нажатие либо не видно игре, либо живёт лишний кадр.
    startSynthFrame();

    // Трассировка собирает рёбра ввода даже без подписчиков: вкладке EVENTS
    // (§23) нужен журнал того, что реально нажимали, а не только то, на что
    // игра подписалась.
    const trace_edges = tracing();
    if (listeners.size === 0 && !trace_edges) return;

    if (listeners.has('key') || trace_edges) {
        const pressed = engine.keysPressed();
        const released = engine.keysReleased();
        for (let i = 0; i < pressed.length; i++) {
            noteInput({ action: 'key down', key: keyName(pressed[i]), code: pressed[i] });
            if (listeners.has('key')) emit('key', { key: keyName(pressed[i]), code: pressed[i], pressed: true, down: true, shift: shift(), ctrl: ctrl(), alt: alt(), frame: engine.frame });
        }
        for (let i = 0; i < released.length; i++) {
            noteInput({ action: 'key up', key: keyName(released[i]), code: released[i] });
            if (listeners.has('key')) emit('key', { key: keyName(released[i]), code: released[i], pressed: false, down: false, shift: shift(), ctrl: ctrl(), alt: alt(), frame: engine.frame });
        }
    }
    if (listeners.has('mouse') || trace_edges) {
        for (const [name, id] of Object.entries(MOUSE_BUTTONS)) {
            if (engine.mousePressed(id)) {
                noteInput({ action: 'mouse down', button: name, x: engine.mouseX, y: engine.mouseY });
                if (listeners.has('mouse')) emit('mouse', { button: name, x: engine.mouseX, y: engine.mouseY, pressed: true, frame: engine.frame });
            }
        }
    }
    if ((listeners.has('wheel') || trace_edges) && engine.wheel !== 0) {
        noteInput({ action: 'wheel', delta: engine.wheel, x: engine.mouseX, y: engine.mouseY });
        if (listeners.has('wheel')) emit('wheel', { x: 0, y: engine.wheel, frame: engine.frame });
    }
    if (listeners.has('gamepadOn') || listeners.has('gamepadOff') || trace_edges) {
        const now = pad_connected(0);
        if (now !== gamepad_was_connected) {
            gamepad_was_connected = now;
            noteInput({ action: now ? 'gamepad on' : 'gamepad off', index: 0 });
            if (listeners.has('gamepadOn') || listeners.has('gamepadOff')) {
                emit(now ? 'gamepadOn' : 'gamepadOff', { index: 0 });
            }
        }
    }
}

export function shiftDown() { return engine.keyDown(engine.scancode('Left Shift')) || engine.keyDown(engine.scancode('Right Shift')); }
export function ctrlDown() { return engine.keyDown(engine.scancode('Left Ctrl')) || engine.keyDown(engine.scancode('Right Ctrl')); }
export function altDown() { return engine.keyDown(engine.scancode('Left Alt')) || engine.keyDown(engine.scancode('Right Alt')); }
function shift() { return shiftDown(); }
function ctrl() { return ctrlDown(); }
function alt() { return altDown(); }

export { scancodeOf };

// Имена для сообщений: код → имя клавиши (для отладочного вывода).
/**
 * Имя клавиши по коду: `keyNameOf(32) === 'Space'`. Без движка отдаёт номер,
 * поэтому функцию можно звать и в юнит-тестах.
 */
export function keyNameOf(code) { return keyName(code); }

/** Управление узлом с клавиатуры: $('#hero').controls('wasd'). */
