// ===========================================================================
// Текстовые стили: $.font — именованные наборы параметров текста.
//
// Зачем: в игре одни и те же «размер + цвет + выравнивание» повторяются в
// каждом узле (`<ui.label>`, `<text>`, подписи кнопок). Стиль описывается один
// раз и применяется по имени — правка в одном месте меняет весь HUD.
//
//   $.font.define('hud', { size: 20, color: '#ffffff', align: 'left' });
//   $.font.define('title', { base: 'hud', size: 40, color: '#ffd166' });
//   $.font.apply($('#score'), 'hud');
//   $('#score').textStyle('title');            // то же самое методом узла
//
// Модуль — только НАДСТРОЙКА: он не заменяет $.gfx.text(), .fontSize() и
// .text(), а раскладывает готовый набор по уже существующим свойствам узла
// (size, color/text_color, attrs.align, attrs.lineHeight).
//
// Ключевая тонкость: у контролов (кнопка, поле, список, ползунок, флажок,
// полоса, диалог) свойство `color` — это ФОН, а цвет подписи лежит в
// text_color. Поэтому apply() сам выбирает, куда положить цвет стиля
// (см. textColorTarget), иначе стиль перекрашивал бы фон кнопки.
//
// Чистые функции (normalizeFontStyle/mergeFontStyles/resolveFontStyle)
// экспортируются наружу — их проверяет qjs-харнесс без движка (§4 контракта).
// ===========================================================================

import { engine } from './native.js';
import { ctx, def, query, packColor } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: разбор и слияние стилей
// ---------------------------------------------------------------------------

/** Параметры текста по умолчанию — то, что получает узел без стиля. */
export const FONT_DEFAULTS = Object.freeze({
    size: 20,
    color: '#ffffff',
    align: 'left',
    lineHeight: 1.25,
});

const ALIGNS = new Set(['left', 'center', 'right']);

// Поля, которые модуль раскладывает по свойствам узла. Всё остальное из
// описания стиля попадает в attrs как есть: так стиль может нести, например,
// letterSpacing для другой подсистемы, а $.font о нём знать не обязан.
const KNOWN_FIELDS = new Set(['size', 'color', 'align', 'lineHeight', 'base', 'font']);

/**
 * Теги, у которых цвет подписи лежит в text_color, а `color` — фон контрола.
 * Остальные теги (<text>, <ui.label>, <ui.panel>) рисуют текст цветом color.
 */
const TEXT_COLOR_TAGS = new Set([
    'ui.button', 'ui.bar', 'ui.checkbox', 'ui.slider', 'ui.input', 'ui.list', 'ui.dialog',
]);

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Куда класть цвет стиля у узла этого тега: 'text' → text_color, иначе color. */
export function textColorTarget(tag) {
    return TEXT_COLOR_TAGS.has(String(tag)) ? 'text' : 'color';
}

/**
 * Разбор описания стиля. Незаданные поля остаются незаданными (undefined) —
 * иначе дочерний стиль затирал бы наследование своим значением по умолчанию.
 */
export function normalizeFontStyle(name, spec) {
    const s = spec || {};
    const out = { name: String(name), base: s.base == null ? null : String(s.base), set: {}, extra: {} };
    if (s.size !== undefined) out.set.size = Math.max(1, num(s.size, FONT_DEFAULTS.size));
    if (s.color !== undefined && s.color !== null) out.set.color = s.color;
    if (s.align !== undefined) {
        out.set.align = ALIGNS.has(s.align) ? s.align : FONT_DEFAULTS.align;
        if (!ALIGNS.has(s.align)) out.badAlign = String(s.align);
    }
    if (s.lineHeight !== undefined) out.set.lineHeight = Math.max(0.5, num(s.lineHeight, FONT_DEFAULTS.lineHeight));
    // Семейство шрифта: пустая строка и null означают «шрифт по умолчанию».
    if (s.font !== undefined) out.set.font = s.font ? String(s.font) : '';
    for (const key of Object.keys(s)) {
        if (!KNOWN_FIELDS.has(key)) out.extra[key] = s[key];
    }
    return out;
}

/** Наложение разобранного стиля на родительский: поля и «прочее» сливаются. */
export function mergeFontStyles(base, over) {
    const b = base || { set: {}, extra: {} };
    const o = over || { set: {}, extra: {} };
    return {
        name: o.name !== undefined ? o.name : b.name,
        base: o.base !== undefined ? o.base : b.base,
        set: { ...(b.set || {}), ...(o.set || {}) },
        extra: { ...(b.extra || {}), ...(o.extra || {}) },
        badAlign: o.badAlign,
    };
}

/** Дополнение разобранного стиля значениями по умолчанию — итог для узла. */
export function resolveFontStyle(style) {
    const s = style || { set: {}, extra: {} };
    const set = s.set || {};
    return {
        name: s.name === undefined ? '' : s.name,
        size: set.size === undefined ? FONT_DEFAULTS.size : set.size,
        color: set.color === undefined ? FONT_DEFAULTS.color : set.color,
        align: set.align === undefined ? FONT_DEFAULTS.align : set.align,
        lineHeight: set.lineHeight === undefined ? FONT_DEFAULTS.lineHeight : set.lineHeight,
        font: set.font === undefined ? '' : set.font,
        extra: { ...(s.extra || {}) },
    };
}

// ---------------------------------------------------------------------------
// Лица RmlUi: weight/style для $.font.load
// ---------------------------------------------------------------------------

/** Веса RmlUi: любое определённое 1..1000; 400/700 — имена normal/bold. */
export const FONT_WEIGHT_NORMAL = 400;
export const FONT_WEIGHT_BOLD = 700;

/**
 * Разобрать opts у $.font.load: weight ('normal'|'bold'|1..1000) и style
 * ('normal'|'italic'). Возвращает { weight, style, error }: error — строка для
 * журнала, если опция неверна (загрузка тогда не начинается, а не «тихо
 * подменяется» нормальным начертанием).
 *
 * Это ТОЛЬКО RmlUi-лицо: кастомный рендерер текста (src/font.c) одноатласный и
 * weight/style не подделывает; $.font.load с не-400/normal грузит лицо для
 * HTML-интерфейса.
 */
export function normalizeFontFaceOptions(opts) {
    const o = opts || {};
    let weight = FONT_WEIGHT_NORMAL;
    if (o.weight !== undefined && o.weight !== null) {
        const raw = o.weight;
        if (typeof raw === 'string') {
            const key = raw.trim().toLowerCase();
            if (key === 'normal' || key === 'regular') weight = FONT_WEIGHT_NORMAL;
            else if (key === 'bold') weight = FONT_WEIGHT_BOLD;
            else {
                const n = Number(key);
                if (!Number.isInteger(n) || n < 1 || n > 1000) {
                    return { weight: null, style: null,
                             error: 'weight="' + raw + '" — ожидалось normal/bold или целое 1..1000' };
                }
                weight = n;
            }
        } else if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 1000) {
            weight = raw;
        } else {
            return { weight: null, style: null,
                     error: 'weight=' + String(raw) + ' — ожидалось normal/bold или целое 1..1000' };
        }
    }
    let style = 'normal';
    if (o.style !== undefined && o.style !== null) {
        const key = String(o.style).trim().toLowerCase();
        if (key === 'normal' || key === 'italic') style = key;
        else return { weight: null, style: null,
                      error: 'style="' + String(o.style) + '" — RmlUi знает только normal/italic' };
    }
    return { weight, style, error: null };
}

/** Ширина строки в пикселях. Без движка (qjs) возвращает 0 — это не ошибка. */
/**
 * Ширина строки в пикселях: единственный правильный путь к engine.measureText.
 *
 * Движок отдаёт ПАРУ `[ширина, высота]` (см. r2d__js_measure_text), а не число.
 * Раньше результат прогонялся через num(): Number([830, 34]) — это NaN, то есть
 * функция возвращала 0. Из-за нуля `$.dialog` считал, что любая строка помещается
 * в панель, и перенос по словам не срабатывал вовсе — реплики уезжали за рамку
 * ({@link wrapDialogText}). Поэтому форму ответа разбираем здесь, а не у вызова.
 */
export function measureTextWidth(result) {
    if (Array.isArray(result)) return num(result[0], 0);
    if (result && typeof result === 'object') {
        return num(result.w !== undefined ? result.w : result.width, 0);
    }
    return num(result, 0);
}

export function measureFontText(text, size, family) {
    if (typeof engine === 'undefined' || !engine || typeof engine.measureText !== 'function') return 0;
    return measureTextWidth(engine.measureText(String(text), num(size, FONT_DEFAULTS.size), family));
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

/**
 * Поставить $.font. Реестр стилей живёт в замыкании: повторный installFont()
 * (например, при перезагрузке игры) начинает с чистого листа.
 */
export function installFont($) {
    const api = $ || {};

    /** name → разобранное описание (без значений по умолчанию). */
    const registry = new Map();

    // Про уже сообщённую неизвестную базу больше не пишем: resolve() зовётся
    // на каждый get/apply, и лог бы заспамился.
    const warned_bases = new Set();

    /** Цепочка наследования: default → …base → сам стиль. */
    function chainOf(name, seen) {
        const guard = seen || new Set();
        const record = registry.get(name);
        if (!record || guard.has(name)) return [];
        guard.add(name);
        const parents = [];
        // Неявная база: стиль 'default' (если объявлен) — общий для всех.
        if (name !== 'default' && registry.has('default')) parents.push(...chainOf('default', guard));
        if (record.base && registry.has(record.base)) {
            parents.push(...chainOf(record.base, guard));
        } else if (record.base && !warned_bases.has(name)) {
            warned_bases.add(name);
            ctx.log(`$.font: стиль "${name}" ссылается на неизвестную базу "${record.base}" — беру без неё`);
        }
        return [...parents, record];
    }

    function resolve(name) {
        const key = String(name);
        if (!registry.has(key)) return null;
        const chain = chainOf(key);
        let merged = { name: key, set: {}, extra: {} };
        for (const record of chain) merged = mergeFontStyles(merged, record);
        merged.name = key;
        return resolveFontStyle(merged);
    }

    /** Записать стиль в узел: понятные полям — по свойствам, прочее — в attrs. */
    function applyToNode(node, style) {
        node.size = style.size;
        node.attrs.align = style.align;
        node.attrs.lineHeight = style.lineHeight;
        const packed = packColor(style.color);
        if (textColorTarget(node.tag) === 'text') node.text_color = packed;
        else node.color = packed;
        for (const key of Object.keys(style.extra)) node.attrs[key] = style.extra[key];
        // Семейство шрифта: стиль может задавать его, но не обязан — тогда
        // узел остаётся на шрифте родителя или на шрифте по умолчанию.
        if (style.font) node.attrs.font = style.font;
        node.attrs._font = style.name;
    }

    function nodesOf(target) {
        if (!target) return [];
        if (typeof target === 'string') return query(target);
        if (Array.isArray(target)) return target.flatMap(nodesOf);
        if (target.nodes) return target.nodes.slice();     // обёртка $
        if (target.tag) return [target];                   // сам узел
        return [];
    }

    /** Семейства, загруженные через $.font.load() — для подсказок и тестов. */
    const loaded = [];

    const font = {
        /** Объявить стиль: имя → { size, color, align, lineHeight, base }. */
        define(name, spec) {
            if (name === undefined || name === null || name === '') {
                ctx.log('$.font.define: нужно непустое имя стиля, например define("hud", { size: 20 })');
                return font;
            }
            const style = normalizeFontStyle(name, spec);
            if (style.badAlign) {
                ctx.log(`$.font.define("${name}"): align="${style.badAlign}" — знаю только left/center/right`);
            }
            registry.set(String(name), style);
            return font;
        },

        /** Разобранный стиль (копия) или null, если стиль не объявлен. */
        get(name) {
            const style = resolve(name);
            if (!style) return null;
            return { ...style, extra: { ...style.extra } };
        },

        /** Есть ли такой стиль. */
        has(name) { return registry.has(String(name)); },

        /** Имена стилей по алфавиту. */
        list() { return [...registry.keys()].sort(); },

        /** Удалить стиль (дети, ссылавшиеся на него, просто потеряют базу). */
        remove(name) { registry.delete(String(name)); return font; },

        /**
         * Применить стиль к узлу, обёртке $(…) или селектору:
         *   $.font.apply('#score', 'hud');  $.font.apply($('#score'), 'hud');
         * Неизвестный стиль — предупреждение в лог, узел не меняется.
         */
        apply(target, name) {
            const style = resolve(name);
            if (!style) {
                ctx.log(`$.font.apply: неизвестный стиль "${name}" — объявите его через $.font.define()`);
                return target;
            }
            for (const node of nodesOf(target)) applyToNode(node, style);
            return target;
        },

        /** Имя стиля, последним применённого к узлу (или null). */
        of(target) {
            const node = nodesOf(target)[0];
            return node ? (node.attrs._font || null) : null;
        },

        /** Текущие параметры текста узла — то, что реально читает отрисовка. */
        styleOf(target) {
            const node = nodesOf(target)[0];
            if (!node) return null;
            return {
                font: node.attrs._font || null,
                size: num(node.size, FONT_DEFAULTS.size),
                align: node.attrs.align || FONT_DEFAULTS.align,
                lineHeight: num(node.attrs.lineHeight, FONT_DEFAULTS.lineHeight),
                color: textColorTarget(node.tag) === 'text' ? node.text_color : node.color,
            };
        },

        /** Ширина строки в пикселях этим стилем: $.font.measure('Счёт: 10', 'hud'). */
        measure(text, name) {
            const style = resolve(name);
            if (!style) ctx.log(`$.font.measure: неизвестный стиль "${name}" — беру размер по умолчанию`);
            return measureFontText(text, style ? style.size : FONT_DEFAULTS.size, style && style.font);
        },

        /** Значения по умолчанию (копия) — для расчётов игры и подсказок агенту. */
        defaults() { return { ...FONT_DEFAULTS }; },

        // --- Файлы шрифтов и семейства ---------------------------------------
        /**
         * Загрузить .ttf/.otf как семейство:
         *   `$.font.load('title', 'fonts/Bold.ttf')`
         *   `$.font.load('title', 'fonts/Bold.ttf', { weight: 'bold' })`
         *   `$.font.load('title', 'fonts/Italic.ttf', { weight: 600, style: 'italic' })`
         *
         * Путь — от корня игры, как у `.sprite()`; без имени берётся имя файла.
         * opts: `weight` — 'normal'|'bold' или целое 1..1000, `style` —
         * 'normal'|'italic'. Неверная опция — строка в журнал и `false`, без
         * тихой подмены начертания.
         *
         * С opts по умолчанию (400/normal) поведение прежнее: файл грузится в
         * атлас сцены (`engine.loadFont`) И, если GUI доступен, регистрируется
         * как лицо RmlUi — теперь RCSS `font-family` видит это семейство.
         * С не-400/normal атлас сцены НЕ трогается (он одноатласный и начертаний
         * не умеет): регистрируется только лицо RmlUi для HTML-интерфейса.
         */
        load(name, path, opts) {
            if (typeof name === 'object' && name) {
                const spec = name;
                path = spec.src || spec.path || spec.file;
                if (opts === undefined) opts = { weight: spec.weight, style: spec.style };
                name = spec.name || spec.family || spec.id;
            }
            if (!path) {
                ctx.log('$.font.load: нужен путь к .ttf/.otf');
                return false;
            }
            const face = normalizeFontFaceOptions(opts);
            if (face.error) {
                ctx.log('$.font.load: ' + face.error);
                return false;
            }
            const family = String(name || String(path).replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, ''));
            const legacy = face.weight === FONT_WEIGHT_NORMAL && face.style === 'normal';

            // Атлас сцены — прежний путь и прежний контракт возврата для
            // load(name,path) без начертаний. Семейство не перезагружаем
            // чужим файлом ради bold: это тихо подменило бы обычный текст.
            let atlas_ok = false;
            if (legacy) {
                atlas_ok = typeof engine.loadFont === 'function' && engine.loadFont(family, String(path));
                if (!atlas_ok) {
                    ctx.log(`$.font.load: не удалось загрузить шрифт "${family}" из ${path}`);
                    return false;
                }
            }

            // RmlUi-лицо: weight/style реально уходят в Rml::LoadFontFace.
            const ui = engine.ui;
            const can_face = ui && typeof ui.loadFontFace === 'function';
            const face_ok = can_face
                ? ui.loadFontFace(String(path), family, face.weight, face.style) === true
                : false;

            if (legacy) {
                // Старое поведение: атлас решает успех. Отсутствие GUI — не
                // ошибка сцены, поэтому предупреждаем только если GUI есть, но
                // лицо не принял.
                if (can_face && !face_ok) {
                    ctx.log(`$.font.load: атлас "${family}" загружен, но RmlUi не принял лицо`);
                }
                loaded.push(family);
                return true;
            }
            if (!face_ok) {
                ctx.log(can_face
                    ? `$.font.load: RmlUi не принял лицо "${family}" (${face.weight}, ${face.style}) из ${path}`
                    : '$.font.load: opts weight/style требуют GUI RmlUi — лицо не зарегистрировано');
                return false;
            }
            loaded.push(family);
            return true;
        },

        /** Семейства, загруженные через это API (не весь список движка). */
        uploaded() { return loaded.slice(); },

        /** Семейство по умолчанию: первый загруженный шрифт или null. */
        default() {
            return typeof engine.fontDefault === 'function' ? engine.fontDefault() : null;
        },

        /**
         * Явные лица RmlUi: `[{ family, weight, style, path }]`.
         *
         * Источник — engine.ui.fontFaces(); это лица, зарегистрированные через
         * `$.font.load(..., { weight, style })` / engine.ui.loadFontFace.
         * Автозагруженные assets/fonts сюда не входят: их семейство RmlUi
         * выводит из файла и обратно не отдаёт.
         */
        faces() {
            const ui = engine.ui;
            if (!ui || typeof ui.fontFaces !== 'function') return [];
            const list = ui.fontFaces();
            return Array.isArray(list) ? list : [];
        },

        /**
         * Все семейства, известные движку: атлас сцены (`engine.fontList()`)
         * плюс семейства явных лиц RmlUi. Порядок атласа сохраняется, новые
         * семейства дописываются без дублей. Пустой список — не ошибка.
         */
        families() {
            const base = typeof engine.fontList === 'function' ? engine.fontList() : [];
            const out = Array.isArray(base) ? base.slice() : [];
            for (const face of font.faces()) {
                if (face && face.family && out.indexOf(face.family) < 0) out.push(face.family);
            }
            return out;
        },

        /** Состояние атласа глифов: `{ glyphs, atlas_w, atlas_h }`. */
        atlas() {
            return typeof engine.fontStats === 'function'
                ? engine.fontStats()
                : { glyphs: 0, atlas_w: 0, atlas_h: 0 };
        },

        /** Ширина строки независимо от стиля: `$.font.width('HP', 24, 'hud')`. */
        width(text, size, family) {
            return measureFontText(text, num(size, FONT_DEFAULTS.size), family);
        },
    };

    api.font = font;
    ctx.font = font;

    /**
     * Метод узла: .textStyle('hud') — применить стиль, .textStyle({size:30}) —
     * разовый набор без регистрации, .textStyle() — имя действующего стиля.
     */
    def('textStyle', function (name) {
        if (name === undefined) {
            const node = this.nodes[0];
            return node ? (node.attrs._font || null) : null;
        }
        this.nodes.forEach((node) => {
            if (name && typeof name === 'object') {
                const inline = resolveFontStyle(mergeFontStyles(null, normalizeFontStyle('', name)));
                applyToNode(node, inline);
                return;
            }
            const style = resolve(name);
            if (!style) {
                ctx.log(`$.textStyle: неизвестный стиль "${name}" — см. $.font.list()`);
                return;
            }
            applyToNode(node, style);
        });
        return this;
    });

    /**
     * Метод узла: `.font('title')` — семейство шрифта для текста этого узла и
     * его детей. Без аргумента — чтение (своё или унаследованное от родителя).
     */
    def('font', function (name) {
        if (name === undefined) {
            const node = this.nodes[0];
            for (let cur = node; cur; cur = cur.parent_node) {
                const family = cur.attrs && cur.attrs.font;
                if (family) return family;
            }
            return typeof engine.fontDefault === 'function' ? engine.fontDefault() : null;
        }
        if (name === null || name === false) name = '';
        return this.eachNode((_, el) => {
            const node = el;
            if (name) node.attrs.font = String(name);
            else delete node.attrs.font;
        });
    });

    return font;
}
