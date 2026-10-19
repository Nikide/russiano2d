// ===========================================================================
// Формат `*.fonts.json` (Font / Text Tools): шрифты и текстовые стили `$.font`.
//
//   const f = $.fs.readJSON('ui.fonts.json');
//   for (const x of f.fonts || []) $.font.load(x.name, x.path);
//   for (const name of Object.keys(f.styles)) $.font.define(name, f.styles[name]);
//
// См. docs/highlevel/font.md. Движок умеет у текста размер, цвет, выравнивание
// и межстрочный интервал; жирный/курсив — только отдельным файлом шрифта.
// Чистая логика без движка.
// ===========================================================================

import { isObj, isStr, isNum, inRange, colorOk, err, warn, checkRoot, duplicateNames } from '../kit.js';

export const ID = 'fonts';
export const SUFFIX = '.fonts.json';
export const PREFIX = 'SDK_FONTS';
export const ALIGNS = ['left', 'center', 'right'];
const NAME_RE = /^[A-Za-z0-9_\-]{1,48}$/;

export function create() {
    return {
        version: 1,
        fonts: [],
        styles: {
            default: { size: 18, color: '#e9edf6', align: 'left' },
            hud: { size: 20, color: '#ffffff', align: 'left' },
            title: { base: 'hud', size: 40, color: '#ffb03a' },
        },
    };
}

/** Цепочка наследования; повтор имени (цикл) обрывается. */
export function chain(styles, name) {
    const out = [];
    let cur = name;
    while (cur && isObj(styles) && isObj(styles[cur]) && out.indexOf(cur) < 0) {
        out.push(cur);
        cur = styles[cur].base;
    }
    return out;
}

/** Итоговый стиль: default → base → сам стиль (как `$.font.get`). */
export function resolve(styles, name) {
    const merged = { size: 20, color: '#ffffff', align: 'left', lineHeight: 1.25 };
    const layers = [];
    if (isObj(styles.default) && name !== 'default') layers.push('default');
    for (const n of chain(styles, name).reverse()) layers.push(n);
    for (const n of layers) {
        const s = styles[n];
        for (const k of Object.keys(s)) if (k !== 'base') merged[k] = s[k];
    }
    return merged;
}

export function validate(root) {
    const out = [];
    if (!checkRoot(PREFIX, root, out)) return out;
    if (root.fonts !== undefined) {
        if (!Array.isArray(root.fonts) || root.fonts.length > 32) {
            out.push(err(PREFIX + '_FONTS', 'fonts — массив до 32 шрифтов', { field: 'fonts' }));
        } else {
            root.fonts.forEach((f, i) => {
                const loc = { font: i };
                if (!isObj(f) || !isStr(f.name) || !NAME_RE.test(f.name)) out.push(err(PREFIX + '_FONT', 'Шрифт ' + i + ': name из латиницы, цифр, «_», «-»', loc));
                else if (!isStr(f.path) || !/\.(ttf|otf)$/i.test(f.path)) out.push(err(PREFIX + '_FONT', 'Шрифт ' + i + ': path к .ttf или .otf', loc));
            });
            out.push(...duplicateNames(PREFIX, root.fonts, 'Шрифт'));
        }
    }
    if (!isObj(root.styles) || Object.keys(root.styles).length > 128) {
        out.push(err(PREFIX + '_STYLES', 'styles — объект «имя → стиль» (до 128)', { field: 'styles' }));
        return out;
    }
    const names = Object.keys(root.styles);
    for (const name of names) {
        const s = root.styles[name];
        const loc = { style: name };
        if (!NAME_RE.test(name)) out.push(err(PREFIX + '_STYLE', 'Имя стиля «' + name + '»: латиница, цифры, «_», «-»', loc));
        if (!isObj(s)) { out.push(err(PREFIX + '_STYLE', 'Стиль «' + name + '» должен быть объектом', loc)); continue; }
        if (s.size !== undefined && !inRange(s.size, 4, 512)) out.push(err(PREFIX + '_SIZE', 'Стиль «' + name + '»: size 4..512', loc));
        if (s.color !== undefined && !colorOk(s.color)) out.push(err(PREFIX + '_COLOR', 'Стиль «' + name + '»: нераспознанный цвет', loc));
        if (s.align !== undefined && ALIGNS.indexOf(s.align) < 0) out.push(err(PREFIX + '_ALIGN', 'Стиль «' + name + '»: align left | center | right', loc));
        if (s.lineHeight !== undefined && !inRange(s.lineHeight, 0.5, 4)) out.push(err(PREFIX + '_LINEHEIGHT', 'Стиль «' + name + '»: lineHeight 0.5..4', loc));
        if (s.font !== undefined) {
            if (!isStr(s.font) || !s.font) out.push(err(PREFIX + '_STYLE', 'Стиль «' + name + '»: font — имя семейства строкой', loc));
            else if (s.font !== 'default' && !(Array.isArray(root.fonts) && root.fonts.some((f) => isObj(f) && f.name === s.font))) {
                out.push(warn(PREFIX + '_FONT_MISSING', 'Стиль «' + name + '»: семейство «' + s.font + '» не объявлено в fonts (годятся только семейства самого движка)', loc));
            }
        }
        if (s.base !== undefined) {
            if (!isStr(s.base)) out.push(err(PREFIX + '_STYLE', 'Стиль «' + name + '»: base — строка', loc));
            else if (!isObj(root.styles[s.base])) out.push(warn(PREFIX + '_BASE_MISSING', 'Стиль «' + name + '»: база «' + s.base + '» не объявлена', loc));
            else {
                // цикл: возвращаемся к уже посещённому имени
                const seen = [name];
                let cur = s.base;
                while (cur && isObj(root.styles[cur])) {
                    if (seen.indexOf(cur) >= 0) { out.push(err(PREFIX + '_CYCLE', 'Стиль «' + name + '»: цикл наследования через «' + cur + '»', loc)); break; }
                    seen.push(cur);
                    cur = root.styles[cur].base;
                }
            }
        }
    }
    return out;
}

export function summary(root) {
    return 'шрифтов ' + (Array.isArray(root && root.fonts) ? root.fonts.length : 0) + ' · стилей ' + (isObj(root && root.styles) ? Object.keys(root.styles).length : 0);
}
export function snippet(rel) {
    return "const f = $.fs.readJSON('" + rel + "'); for (const x of f.fonts || []) $.font.load(x.name, x.path); for (const n of Object.keys(f.styles)) $.font.define(n, f.styles[n]);";
}
