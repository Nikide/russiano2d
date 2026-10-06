// ===========================================================================
// Подсистема $.viewport — render target игры — и глобальный $.blend.
//
//   * Режимы смешивания — работают по-настоящему. Сами конвейеры живут в
//     render.c (alpha/add/multiply/none, порядок = BLEND_NAMES в render.js),
//     render.js режет батч на непрерывные участки и отдаёт каждый своим
//     4-м аргументом submitSprites. Здесь — только $.blend(name), тонкая
//     обёртка над $.gfx.blend(name), и чистые хелперы для проверок.
//
//   * Render target — кадр можно рисовать не в swapchain, а в свою текстуру.
//     Так делают шлейфы, накопление, порталы и «буфер прошлого кадра»:
//     `bind(vp)` — мир рисуется в текстуру, `sprite(vp)` — спрайт прошлого
//     кадра, который игра рисует как обычную картинку. Текстур у viewport'а
//     две (текущий кадр и история), поэтому чтения и записи одной текстуры в
//     одном проходе не бывает.
//
//     Ограничение честное: это цель всего кадра, а не произвольный проход
//     посреди кадра. Пост-обработка при связанном viewport'е не применяется.
// ===========================================================================

import { ctx } from './core.js';

// Порядок обязан совпадать с R2DBlendMode в src/render.h и BLEND_NAMES
// в src/highlevel/render.js: индекс режима — это индекс конвейера.
export const BLEND_MODES = ['alpha', 'add', 'multiply', 'none'];
export const DEFAULT_BLEND = 'alpha';

/** Текст ошибки, если сборка без рендерера (юнит-тесты, заглушка). */
export const UNSUPPORTED =
    'render target недоступен: эта сборка без графического рендерера ' +
    '(см. docs/highlevel/render.md)';

// Запасной режим по умолчанию: используется, только если ctx.gfx ещё нет
// (юнит-тесты без движка). В собранной игре источник истины — $.gfx.blend.
let fallback_blend = DEFAULT_BLEND;

/** Приводит имя режима к каноническому виду; null — неизвестный режим. */
export function normalizeBlend(name) {
    if (typeof name !== 'string') return null;
    const value = name.trim().toLowerCase();
    return BLEND_MODES.includes(value) ? value : null;
}

/** Режим узла из node.blend_mode; null — режим не задан (решает вызывающий). */
export function nodeBlendMode(node) {
    if (!node) return null;
    return normalizeBlend(node.blend_mode);
}

/** Текущий запасной режим по умолчанию. */
export function getDefaultBlend() { return fallback_blend; }

/** Установить запасной режим; возвращает каноническое имя или null. */
export function setDefaultBlend(name) {
    const mode = normalizeBlend(name);
    if (mode === null) return null;
    fallback_blend = mode;
    return fallback_blend;
}

/** Режим узла с учётом запасного значения: node.blend_mode → default. */
export function resolveBlend(node) {
    return nodeBlendMode(node) || fallback_blend;
}

/**
 * Режет список на непрерывные участки с одинаковым режимом.
 * modeOf(item) → имя режима; по умолчанию resolveBlend(item).
 * Порядок элементов сохраняется: это порядок отрисовки, менять его нельзя.
 */
export function blendRuns(items, modeOf) {
    const runs = [];
    if (!items || items.length === 0) return runs;
    const fn = typeof modeOf === 'function' ? modeOf : resolveBlend;
    for (const item of items) {
        const mode = normalizeBlend(fn(item)) || DEFAULT_BLEND;
        const last = runs.length > 0 ? runs[runs.length - 1] : null;
        if (last && last.blend === mode) last.items.push(item);
        else runs.push({ blend: mode, items: [item] });
    }
    return runs;
}

// Низкоуровневые вызовы render target'а: в юнит-тестах без движка их нет.
function vpApi() {
    return (typeof engine === 'undefined' || !engine) ? null : (engine.viewport || null);
}

function viewportSupported() {
    const vp = vpApi();
    return !!(vp && vp.supported === true);
}

/** $.blend(name) без ctx.gfx (юнит-тесты): валидация и локальное значение. */
function fallbackBlend(name) {
    if (name === undefined) return fallback_blend;
    const mode = setDefaultBlend(name);
    if (mode === null) {
        ctx.log(`$: $.blend("${name}") — неизвестный режим; доступны: ${BLEND_MODES.join(', ')}`);
        return fallback_blend;
    }
    return mode;
}

/**
 * Ставит $.viewport и $.blend. Вызывается из api.js после installGfx, поэтому
 * ctx.gfx уже существует.
 */
export function installViewport($) {
    const vp = {
        /** Поддержан ли render target в этой сборке. */
        get supported() { return viewportSupported(); },

        /**
         * Создать offscreen-текстуру размера w×h. Возвращает id (>= 0) или
         * `null`, если рендерера нет или текстуры кончились.
         */
        create(w, h) {
            const api = vpApi();
            if (!api || !viewportSupported()) {
                ctx.log('$: $.viewport.create — ' + UNSUPPORTED);
                return null;
            }
            const id = api.create(Math.max(1, Math.round(Number(w) || 0)),
                                  Math.max(1, Math.round(Number(h) || 0)));
            return id >= 0 ? id : null;
        },

        /** Удалить текстуру (связывание снимается автоматически). */
        destroy(id) {
            const api = vpApi();
            return !!(api && viewportSupported() && api.destroy(id | 0));
        },

        /** Размер текстуры: `{ w, h }` или null. */
        size(id) {
            const api = vpApi();
            if (!api || !viewportSupported()) return null;
            return api.size(id | 0);
        },

        /**
         * Связать кадр с текстурой: мир рисуется в неё, а на экран движок
         * показывает её блитом. `bind(null)` / `.unbind()` возвращают кадр.
         */
        bind(id) {
            const api = vpApi();
            if (!api || !viewportSupported()) return false;
            return !!api.bind(id === null || id === undefined ? -1 : (id | 0));
        },

        /** Вернуть кадр в swapchain. */
        unbind() {
            const api = vpApi();
            return !!(api && viewportSupported() && api.bind(-1));
        },

        /** Какой viewport связан сейчас (id или null). */
        bound() {
            const api = vpApi();
            if (!api || !viewportSupported() || typeof api.bound !== 'function') return null;
            const id = api.bound();
            return id >= 0 ? id : null;
        },

        /**
         * Спрайт прошлого кадра: игра рисует его как обычную картинку —
         * так делается шлейф (`.draw(vp, 0, 0, w, h, { alpha: 0.92 })`).
         */
        sprite(id) {
            const api = vpApi();
            if (!api || !viewportSupported()) return -1;
            return api.sprite(id | 0);
        },

        /** Нарисовать прошлый кадр текстуры как спрайт. */
        draw(id, x, y, w, h, opts) {
            const sprite = vp.sprite(id);
            if (sprite < 0) return false;
            const size = vp.size(id);
            return !!$.gfx.draw.sprite(sprite, x, y,
                                       w === undefined && size ? size.w : w,
                                       h === undefined && size ? size.h : h,
                                       opts || {});
        },

        /** Сколько текстур создано. */
        count() {
            const api = vpApi();
            return (api && viewportSupported()) ? (Number(api.count()) || 0) : 0;
        },
    };
    $.viewport = vp;

    /**
     * Режим смешивания по умолчанию: 'alpha' | 'add' | 'multiply' | 'none'.
     * Без аргумента — геттер. Тонкая обёртка над $.gfx.blend(name), чтобы
     * приоритет «node.blend_mode → режим по умолчанию» жил в одном месте.
     */
    $.blend = function (name) {
        if (ctx.gfx && typeof ctx.gfx.blend === 'function') return ctx.gfx.blend(name);
        return fallbackBlend(name);
    };

    return $;
}

/** Шаг кадра подсистемы. Render target живёт в C — тикать нечего. */
export function tickViewport(dt) {
    void dt;
}
