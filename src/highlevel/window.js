import { engine } from './native.js';
import { engineOf } from './core.js';
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
    return {
        w: size[0], h: size[1],
        pixel_w: pixels[0], pixel_h: pixels[1],
        focused: env.window.focused(),
        visible: env.window.visible(),
        fullscreen: env.window.fullscreen(),
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

        /** Полноэкранный режим: без аргумента — прочитать, с аргументом — задать. */
        fullscreen(on) {
            if (on === undefined) return engineOf().window.fullscreen();
            engineOf().window.setFullscreen(!!on);
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
export function tickWindow() {
    if (!last) return;   // окно ещё не установлено
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
    if (now.fullscreen !== last.fullscreen) fire('fullscreen', now);
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
