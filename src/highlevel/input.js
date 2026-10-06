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

import { ctx, query } from './core.js';

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

const MOUSE_BUTTONS = { left: 1, middle: 2, right: 3, x1: 4, x2: 5 };

const code_cache = new Map();
const binds = new Map();          // имя действия → [имена клавиш]
const listeners = new Map();      // 'key' | 'mouse' | 'wheel' | 'gamepadOn' | 'gamepadOff'
const prev_mouse = { buttons: 0 };
let gamepad_was_connected = false;

// Настройки осей. Мёртвая зона гасит дребезг стика: под ним ось считается
// нулевой. 0.2 по умолчанию — привычное значение для геймпадов.
const input_state = { deadzone: 0.2 };
const BINDINGS_KEY = 'input.bindings';   // ключ $.store для save/loadBindings()

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

export function installInput($) {
    const input = {
        // --- Клавиши --------------------------------------------------------
        down(name) { return input._any(name, 'down'); },
        pressed(name) { return input._any(name, 'pressed'); },
        released(name) { return input._any(name, 'released'); },

        _any(name, kind, seen) {
            if (Array.isArray(name)) return name.some((n) => input._any(n, kind, seen));
            if (isGamepadKey(name)) return input.gamepad(0)[kind](String(name).split('.')[1]);

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
            if (kind === 'down') return engine.keyDown(code);
            if (kind === 'pressed') return engine.keyPressed(code);
            return engine.keyReleased(code);
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
        mouseDown(button) { return engine.mouseDown(MOUSE_BUTTONS[button] || button || 1); },
        mousePressed(button) { return engine.mousePressed(MOUSE_BUTTONS[button] || button || 1); },
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

        /** Клавиши, нажатые в этом кадре (имена для $.input.on). */
        _pressedCodes() { return engine.keysPressed(); },
        _releasedCodes() { return engine.keysReleased(); },

        gamepad(index) {
            const pad = index || 0;
            return {
                axis: (name) => input.padAxis(name),
                button: (name) => input.padDown(name),
                down: (name) => input.padDown(name),
                pressed: (name) => {
                    // SDL не отдаёт «нажато в этом кадре» для геймпада — считаем сами.
                    const index2 = GAMEPAD_BUTTONS[String(name).toLowerCase()];
                    return index2 !== undefined ? padPressed(index2) : false;
                },
                released: () => false,
                connected: () => pad_connected(pad),
                rumble: (opts) => rumble(pad, opts),
            };
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

const KEY_NAMES = new Map();
function keyName(code) {
    if (KEY_NAMES.has(code)) return KEY_NAMES.get(code);
    return String(code);
}

/** Вызывается из $.time каждый кадр: рассылает $.input.on('key'/'mouse'/'wheel'). */
export function tickInput() {
    if (listeners.size === 0) return;

    if (listeners.has('key')) {
        const pressed = engine.keysPressed();
        const released = engine.keysReleased();
        for (let i = 0; i < pressed.length; i++) {
            emit('key', { key: keyName(pressed[i]), code: pressed[i], pressed: true, down: true, shift: shift(), ctrl: ctrl(), alt: alt(), frame: engine.frame });
        }
        for (let i = 0; i < released.length; i++) {
            emit('key', { key: keyName(released[i]), code: released[i], pressed: false, down: false, shift: shift(), ctrl: ctrl(), alt: alt(), frame: engine.frame });
        }
    }
    if (listeners.has('mouse')) {
        for (const [name, id] of Object.entries(MOUSE_BUTTONS)) {
            if (engine.mousePressed(id)) {
                emit('mouse', { button: name, x: engine.mouseX, y: engine.mouseY, pressed: true, frame: engine.frame });
            }
        }
    }
    if (listeners.has('wheel') && engine.wheel !== 0) {
        emit('wheel', { x: 0, y: engine.wheel, frame: engine.frame });
    }
    if (listeners.has('gamepadOn') || listeners.has('gamepadOff')) {
        const now = pad_connected(0);
        if (now !== gamepad_was_connected) {
            gamepad_was_connected = now;
            emit(now ? 'gamepadOn' : 'gamepadOff', { index: 0 });
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
export function keyNameOf(name) { return name; }

/** Управление узлом с клавиатуры: $('#hero').controls('wasd'). */
export function installControls(def, defGet) {
    def('controls', function (scheme) {
        const cfg = typeof scheme === 'string'
            ? { up: scheme, jump: 'space', fire: 'mouse' }
            : (scheme || {});
        return this.each((node) => {
            node.attrs.controls = cfg;
            node.attrs.speed_axis = (cfg.axis || (typeof scheme === 'string' && scheme !== 'wasd' && scheme !== 'arrows' ? scheme : 'both'));
        });
    });
}
