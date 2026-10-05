// ===========================================================================
// Подсистема $.viewport и глобальный режим смешивания $.blend.
//
// Две вещи, разные по готовности:
//
//   * Режимы смешивания — работают по-настоящему. Сами конвейеры живут в
//     render.c (alpha/add/multiply/none, порядок = BLEND_NAMES в render.js),
//     render.js режет батч на непрерывные участки и отдаёт каждый своим
//     4-м аргументом submitSprites. Здесь — только $.blend(name), тонкая
//     обёртка над $.gfx.blend(name), и чистые хелперы для проверок.
//
//   * Render target (рисование в offscreen-текстуру) — НЕ поддержан. Кадр
//     идёт прямо в swapchain, а render pass открывает main.c; из JS начать
//     второй проход внутрь текстуры нельзя. Пространство имён всё равно
//     создаётся, но запросы возвращают внятную ошибку, а не молча ломают
//     картинку. Что именно нужно перестроить — docs/highlevel/render.md.
// ===========================================================================

import { ctx } from './core.js';

// Порядок обязан совпадать с R2DBlendMode в src/render.h и BLEND_NAMES
// в src/highlevel/render.js: индекс режима — это индекс конвейера.
export const BLEND_MODES = ['alpha', 'add', 'multiply', 'none'];
export const DEFAULT_BLEND = 'alpha';

/** Текст ошибки для всех вызовов render target. */
export const UNSUPPORTED =
    'render target не поддержан в этой сборке: viewport рисует только в swapchain, ' +
    'render target требует отдельного render pass и offscreen-текстуры ' +
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

// Движок отдаёт engine.viewport; в юнит-тестах без движка его нет, поэтому
// поддержку проверяем по объекту с явным supported === true.
function engineViewport() {
    const vp = typeof engine === 'undefined' ? null : engine.viewport;
    return vp && typeof vp === 'object' ? vp : null;
}

function viewportSupported() {
    const vp = engineViewport();
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
        /** Render target в этой сборке не поддержан — всегда false. */
        get supported() { return viewportSupported(); },

        /** Создать offscreen-буфер. id не выдаётся: бросает понятную ошибку. */
        create(w, h) {
            if (viewportSupported()) return engineViewport().create(w, h);
            throw new Error(UNSUPPORTED);
        },
        /** Буфер по id либо null, если render target не поддержан. */
        get(id) {
            return viewportSupported() ? engineViewport().get(id) : null;
        },
        /** Удалить буфер; false, если render target не поддержан. */
        remove(id) {
            return viewportSupported() ? engineViewport().remove(id) : false;
        },
        /** Список буферов; пустой массив, если render target не поддержан. */
        list() {
            return viewportSupported() ? engineViewport().list() : [];
        },
        /** Нарисовать буфер как спрайт. Без поддержки — понятная ошибка. */
        draw(...args) {
            if (viewportSupported()) return engineViewport().draw(...args);
            throw new Error(UNSUPPORTED);
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

/** Шаг кадра подсистемы. Render target не поддержан — делать нечего. */
export function tickViewport(dt) {
    void dt;
}
