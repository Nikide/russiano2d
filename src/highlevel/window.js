import { engine } from './native.js';
import { engineOf, ctx } from './core.js';
// ===========================================================================
// $.window — окно игры: имя, размер, режим, курсор и события окна.
//
// Всё, что игрок видит «вокруг» игры, живёт здесь. Низкий уровень —
// engine.window.* (src/script.c), механика — src/app.c.
//
//   $.window.title('Моя игра');            // имя в заголовке и в доке
//   $.window.resize(1600, 900);            // размер в точках
//   $.window.fullscreen(true);             // во весь экран
//   $.window.cursor('hidden');             // спрятать курсор в игре
//   $.window.on('resize', ({ w, h }) => …);// реакция на изменение размера
//
// Где брать имя и размер по умолчанию: файл project.json рядом с main.js
// (см. docs/BUILD.md). Здесь их меняют уже во время игры.
// ===========================================================================

const CURSORS = ['normal', 'hidden', 'crosshair', 'hand', 'text', 'wait'];

// Обработчики событий окна и последнее известное состояние — на уровне модуля:
// их видит и установка подсистемы, и покадровый опрос (tickWindow).
const handlers = new Map();
let last = null;
let subs = 0;      // живых подписок: handlers.size не годится — в нём остаются пустые массивы
let api = null;   // ссылка на $, нужна fire() для сообщений об ошибках

function fire(name, data) {
    const list = handlers.get(name);
    if (!list || list.length === 0) return;
    // Копия списка: обработчик вправе отписаться прямо во время вызова.
    for (const fn of [...list]) {
        try {
            fn(data);
        } catch (err) {
            // Раньше здесь вызывался несуществующий ctx.reportError(err, …):
            // catch падал сам, и исключение из обработчика окна валило кадр.
            if (api && api.ctx && typeof api.ctx.reportError === 'function') {
                api.ctx.reportError(`$.window.on('${name}')`, err);
            } else if (api && api.ctx) {
                api.ctx.log(`$: ошибка в $.window.on('${name}'): ${err}`);
            }
        }
    }
}

/**
 * Текущее состояние окна одним объектом.
 *
 * Без движка (модульные тесты) отдаём нули: подсистема ставится при создании
 * API, и обращение к engine здесь роняло ВЕСЬ bootstrap — в игре это выглядело
 * как «$ не определён» (та же ошибка, что была у ctx.log).
 */
function readState() {
    const env = engineOf();
    if (!env || typeof env.window.size !== 'function') {
        return { w: 0, h: 0, pixel_w: 0, pixel_h: 0,
                 focused: false, visible: false, fullscreen: false };
    }
    const size = env.window.size();
    const pixels = env.window.pixelSize();
    const mode = typeof env.window.fullscreenMode === 'function'
        ? env.window.fullscreenMode() : (env.window.fullscreen() ? 'desktop' : 'windowed');
    const info = typeof env.window.displayInfo === 'function' ? env.window.displayInfo() : [0, 0, 0];
    return {
        w: size[0], h: size[1],
        pixel_w: pixels[0], pixel_h: pixels[1],
        focused: env.window.focused(),
        visible: env.window.visible(),
        fullscreen: env.window.fullscreen(),
        // Факт, а не намерение: 'windowed' | 'desktop' | 'exclusive'.
        fullscreen_mode: mode,
        display_w: info[0], display_h: info[1], display_refresh: info[2],
    };
}

export function installWindow($) {
    api = $;
    const windowApi = {
        /** Имя окна: без аргумента — прочитать, с аргументом — задать. */
        title(text) {
            if (text === undefined) return engineOf().window.title();
            engineOf().window.setTitle(String(text));
            return windowApi;
        },

        /** Размер окна в точках: { w, h }. */
        size() {
            const s = engineOf().window.size();
            return { w: s[0], h: s[1] };
        },

        /** Размер в пикселях — на Retina он вдвое больше точек. */
        pixels() {
            const s = engineOf().window.pixelSize();
            return { w: s[0], h: s[1] };
        },

        /** Задать размер. Высота необязательна: сохраним пропорции. */
        resize(w, h) {
            const cur = engineOf().window.size();
            const height = h === undefined
                ? Math.round(w * (cur[1] / Math.max(1, cur[0])))
                : h;
            engineOf().window.setSize(w, height);
            return windowApi;
        },

        /** Доступные полноэкранные режимы дисплея: [{width, height, refresh, desktop}]. */
        displayModes() {
            const env = engineOf();
            return typeof env.window.displayModes === 'function' ? env.window.displayModes() : [];
        },

        /**
         * Полноэкранный режим: без аргумента — прочитать, с аргументом — задать.
         *
         *   $.window.fullscreen(true);                              // desktop (как раньше)
         *   $.window.fullscreen(false);                             // окно
         *   $.window.fullscreen({ mode: 'exclusive' });             // лучший режим дисплея
         *   $.window.fullscreen({ mode: 'exclusive', width: 1920, height: 1080, refresh: 60 });
         *
         * Возвращает `windowApi` при успехе и `{ error, option? }` — при отказе
         * (неизвестная опция, неизвестный режим, система не дала режим). Факт
         * применённого режима виден в `$.window.state().fullscreen_mode`, а
         * точное совпадение запрошенного — в поле `exact` ответа движка.
         */
        fullscreen(onOrOpts) {
            const env = engineOf();
            if (onOrOpts === undefined) return env.window.fullscreen();
            if (onOrOpts === null || typeof onOrOpts !== 'object') {
                env.window.setFullscreenMode(onOrOpts ? 'desktop' : 'windowed', 0, 0, 0);
                return windowApi;
            }
            // Разбор опций: неизвестная — отказ с её ИМЕНЕМ. Молча принять
            // объект за «включить» нельзя: опечатка ({mod:'exclusive'}) тихо
            // переключала бы режим (нашёл проверяющий).
            const known = ['mode', 'width', 'height', 'refresh', 'on'];
            const unknown = Object.keys(onOrOpts).filter((k) => known.indexOf(k) < 0);
            if (unknown.length) {
                const name = unknown[0];
                ctx.log('$.window.fullscreen: неизвестная опция "' + name
                        + '" (есть: ' + known.join(', ') + ')');
                return { error: 'неизвестная опция', option: name };
            }
            const opts = onOrOpts;
            let mode = opts.mode;
            if (mode === undefined) mode = opts.on === false ? 'windowed' : (opts.on === true ? 'desktop' : 'exclusive');
            mode = String(mode);
            if (['windowed', 'desktop', 'exclusive'].indexOf(mode) < 0) {
                ctx.log('$.window.fullscreen: неизвестный режим "' + mode
                        + '" (есть: windowed, desktop, exclusive)');
                return { error: 'неизвестный режим', option: 'mode' };
            }
            const res = env.window.setFullscreenMode(mode,
                                                     Math.max(0, Math.floor(Number(opts.width) || 0)),
                                                     Math.max(0, Math.floor(Number(opts.height) || 0)),
                                                     Math.max(0, Number(opts.refresh) || 0));
            if (res && res.ok === false) {
                ctx.log('$.window.fullscreen: ' + mode + ' не удался — ' + (res.error || 'причина не сообщена'));
                return { error: res.error || 'не удалось', mode: mode };
            }
            last = null;      // состояние прочитаем заново: режим мог не совпасть с запрошенным
            return windowApi;
        },

        /**
         * Горячая клавиша фуллскрина. По умолчанию — **F11** (Alt+Enter не
         * вешаем: его может обрабатывать ОС/WM, и переключение было бы двойным).
         *
         *   $.window.hotkey(false);          // отвязать
         *   $.window.hotkey('f11');          // вернуть (по умолчанию)
         *   $.window.hotkey('f');            // своя клавиша
         *
         * Нажатие НЕ съедается: игра видит его в `$.input` и режим меняется.
         */
        hotkey(onOrKey) {
            // Без аргумента — текущая настройка (для тестов и отладки).
            if (onOrKey === undefined) {
                return { key: hotkey_key, toggles: hotkey_toggles, frames: hotkey_seen_frames,
                         last_down: hotkey_last_down, last_pressed: hotkey_last_pressed };
            }
            if (onOrKey === false) { hotkey_key = null; return windowApi; }
            hotkey_key = (onOrKey === undefined || onOrKey === true) ? 'f11' : String(onOrKey);
            return windowApi;
        },

        toggleFullscreen() {
            engineOf().window.setFullscreen(!engineOf().window.fullscreen());
            return windowApi;
        },

        /** Положение окна на экране: { x, y }. */
        position() {
            const p = engineOf().window.position();
            return { x: p[0], y: p[1] };
        },

        move(x, y) { engineOf().window.move(x, y); return windowApi; },
        center() { engineOf().window.center(); return windowApi; },

        minimize() { engineOf().window.minimize(); return windowApi; },
        maximize() { engineOf().window.maximize(); return windowApi; },
        restore() { engineOf().window.restore(); return windowApi; },
        show() { engineOf().window.show(); return windowApi; },
        hide() { engineOf().window.hide(); return windowApi; },
        focus() { engineOf().window.focus(); return windowApi; },
        visible() { return engineOf().window.visible(); },
        focused() { return engineOf().window.focused(); },

        /** Можно ли менять размер мышью. */
        resizable(on) {
            if (on === undefined) return engineOf().window.resizable();
            engineOf().window.setResizable(!!on);
            return windowApi;
        },

        /** Вертикальная синхронизация: false — максимум кадров, но возможен разрыв. */
        vsync(on) {
            if (on === undefined) return engineOf().window.vsync();
            engineOf().window.setVsync(!!on);
            return windowApi;
        },

        /** Курсор: normal | hidden | crosshair | hand | text | wait. */
        cursor(kind) {
            if (kind === undefined) return engineOf().window.cursor();
            const name = String(kind);
            if (CURSORS.indexOf(name) < 0) {
                $.ctx.log(`$: неизвестный курсор "${name}" — оставляю как есть`);
                return windowApi;
            }
            engineOf().window.setCursor(name);
            return windowApi;
        },

        /**
         * Захват мыши для взгляда (Re2D, шутеры): курсор скрыт, движение
         * приходит только относительным (`$.input.mouseDelta()`). Без
         * аргумента читает состояние. Возвращает, включён ли захват на самом
         * деле: скрытое окно или окно без фокуса может отказать.
         */
        mouseLock(on) {
            const engine = engineOf();
            if (typeof engine.mouseLock !== 'function') return false;
            return !!(on === undefined ? engine.mouseLock() : engine.mouseLock(!!on));
        },

        /** Подписка на события окна: resize, focus, blur, show, hide. */
        on(name, fn) {
            if (!handlers.has(name)) handlers.set(name, []);
            handlers.get(name).push(fn);
            subs++;
            // Пока слушателей не было, состояние окна не опрашивалось, и
            // сравнивать с устаревшим снимком нельзя: первый же кадр после
            // подписки прислал бы ложный resize/focus. Берём свежий снимок
            // «на момент подписки» — ровно то, что видела бы игра раньше.
            if (last !== null) last = readState();
            return windowApi;
        },

        off(name, fn) {
            if (!name) { subs = 0; handlers.clear(); return windowApi; }
            if (!fn) {
                const list = handlers.get(name);
                if (list) subs -= list.length;
                handlers.delete(name);
                return windowApi;
            }
            const list = handlers.get(name);
            if (list) {
                const kept = list.filter((f) => f !== fn);
                subs -= list.length - kept.length;
                handlers.set(name, kept);
            }
            return windowApi;
        },

        /** Снимок состояния окна — его же видит агент в state.window. */
        state() { return readState(); },

        /** Список поддерживаемых курсоров (для подсказок). */
        cursors() { return CURSORS.slice(); },
    };

    $.window = windowApi;
    windowFullscreen = (on) => windowApi.fullscreen(on);
    if (typeof $.update === 'function') $.update(hotkeyTick);

    // SDL-события окна до скриптов не доходят (движок разбирает их сам),
    // поэтому состояние опрашивается раз в кадр и сравнивается с прошлым.
    // Для resize/focus этого достаточно: задержка — один кадр.
    last = readState();
    return windowApi;
}

/**
 * Опрос состояния окна раз в кадр — вызывается из общего цикла (api.js), как
 * tickTime(). Через $.update() подписываться нельзя: подсистемы ставятся
 * раньше, чем появляется сам $.update.
 */

// Опрос горячей клавиши фуллскрина — в $.update, а не в tickWindow: tickWindow
// идёт в начале кадра (шаг 4), а ввод (в том числе виртуальный ввод агентского
// протокола) применяется позже, и хоткей просто не видел нажатия. Нажатие НЕ
// съедается: мы только читаем состояние клавиши, событие остаётся игре.
function hotkeyTick() {
    if (!hotkey_key) { hotkey_was_down = false; hotkey_latch = false; return; }
    const $ = api || ctx.$;
    const input = $ && ($.input || ctx.input);
    if (!input || typeof input.down !== 'function') return;
    let is_down = false;
    let is_pressed = false;
    try { is_down = input.down(hotkey_key) === true; } catch (e) { is_down = false; }
    try { is_pressed = typeof input.pressed === 'function' && input.pressed(hotkey_key) === true; } catch (e) { is_pressed = false; }
    // Фронт КОПИМ ПО УРОВНЮ, а не читаем один кадр: в агентском режиме ввод
    // может примениться после нашего опроса, и следующий кадр уже снимает
    // `down` — тогда нажатие теряется между кадрами (та же болезнь, что была у
    // геймпада). Защёлка переживает пропущенный тик, а снимается только когда
    // клавишу отпустили.
    hotkey_last_down = is_down;
    hotkey_last_pressed = is_pressed;
    hotkey_seen_frames++;
    if (is_down || is_pressed) hotkey_latch = true;
    if (hotkey_latch && !hotkey_acted) {
        hotkey_acted = true;
        hotkey_toggles++;
        const env = engineOf();
        if (env && typeof env.window.fullscreen === 'function') {
            windowFullscreen(!env.window.fullscreen());
        }
    }
    if (!is_down && !is_pressed) hotkey_acted = false;   // рука отпустила — можно снова
    hotkey_was_down = is_down;
}

// Клавиша фуллскрина: опрос, а не перехват события — нажатие остаётся видно
// игре в $.input (решение №2).
let hotkey_key = 'f11';
let hotkey_was_down = false;
let hotkey_toggles = 0;
let hotkey_latch = false;        // накопленный фронт (переживает пропущенный тик)
let hotkey_acted = false;        // уже переключили на это нажатие
let hotkey_last_down = false;    // что видел опрос в последнем кадре
let hotkey_last_pressed = false;
let hotkey_seen_frames = 0;      // сколько кадров опрос реально работал
let windowFullscreen = null;   // ссылка на $.window.fullscreen (idempotent-путь)

export function tickWindow() {
    if (!last) return;   // окно ещё не установлено
    // Горячая клавиша: опрос ЗДЕСЬ, потому что tickWindow гарантированно
    // исполняется каждый кадр (через него же идёт состояние окна). Регистрация
    // через $.update оказалась ненадёжной: в части сборок хук не вызывался ни
    // разу (диагностика показывала frames: 0) — а защёлка по уровню ниже
    // переживает даже пропущенный кадр.
    hotkeyTick();
    // Никто не слушает окно — не читаем его состояние (6 вызовов C за кадр) и
    // не строим объект. Так в большинстве игр и бывает (§3.7 отчёта); снимок
    // для сравнения обновляет сам on() в момент подписки.
    if (subs === 0) return;
    const now = readState();
    if (now.w !== last.w || now.h !== last.h) {
        fire('resize', { w: now.w, h: now.h, pixel_w: now.pixel_w, pixel_h: now.pixel_h });
    }
    if (now.focused !== last.focused) fire(now.focused ? 'focus' : 'blur', now);
    if (now.visible !== last.visible) fire(now.visible ? 'show' : 'hide', now);
    // Событие одно: и флаг, и режим. Отдельное `displaymode` не плодим —
    // состояние оконное одно, и потребитель у него один (см. window.md).
    if (now.fullscreen !== last.fullscreen || now.fullscreen_mode !== last.fullscreen_mode) {
        fire('fullscreen', now);
    }
    last = now;
}

/** Состояние окна для снимка агента (state.window). */
export function windowSnapshot() {
    const size = engineOf().window.size();
    const pixels = engineOf().window.pixelSize();
    return {
        title: engineOf().window.title(),
        w: size[0], h: size[1],
        pixel_w: pixels[0], pixel_h: pixels[1],
        fullscreen: engineOf().window.fullscreen(),
        resizable: engineOf().window.resizable(),
        visible: engineOf().window.visible(),
        focused: engineOf().window.focused(),
        vsync: engineOf().window.vsync(),
        cursor: engineOf().window.cursor(),
    };
}
