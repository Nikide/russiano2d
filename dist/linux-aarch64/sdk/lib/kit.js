// ===========================================================================
// Общие чистые помощники студий данных (docs/SDK.md §8): проверки значений,
// диагностика, канонический JSON, разметка полей формы. Без движка и UI —
// проверяется qjs-тестом tests/js/sdk_kinds_test.mjs.
// ===========================================================================

import { escapeHtml } from './model.js';

// --- Типы значений -----------------------------------------------------------
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isStr = (v) => typeof v === 'string';
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v) => isNum(v) && Math.floor(v) === v;
export const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
export const intIn = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;
export const clone = (v) => JSON.parse(JSON.stringify(v));

const NAMED_COLORS = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'gray', 'grey',
    'cyan', 'magenta', 'pink', 'brown', 'transparent'];

/** Цвет в формате, который понимает рантайм: #rgb, #rgba, #rrggbb, #rrggbbaa, rgba(...) или имя. */
export function colorOk(value) {
    if (!isStr(value) || !value) return false;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return true;
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[0-9.]+\s*)?\)$/.test(value)) return true;
    return NAMED_COLORS.indexOf(value.toLowerCase()) >= 0;
}

/** Нормализация для поля цвета: «#F00» → «#ff0000» (остальное без изменений). */
export function colorNormalize(value) {
    const m = /^#([0-9a-fA-F]{3})$/.exec(String(value));
    if (m) return '#' + m[1].split('').map((c) => c + c).join('').toLowerCase();
    return /^#[0-9a-fA-F]{6,8}$/.test(String(value)) ? String(value).toLowerCase() : value;
}

// --- Диагностика ------------------------------------------------------------------
/** Единая форма диагностики SDK: { code, severity, asset, location, message, details }. */
export function diag(severity, code, message, location, details) {
    return { code, severity, asset: null, location: location || null, message, details: details || null };
}
export const err = (code, message, location, details) => diag('error', code, message, location, details);
export const warn = (code, message, location, details) => diag('warning', code, message, location, details);
export const info = (code, message, location, details) => diag('info', code, message, location, details);

/** Корень и версия — одинаковые у всех форматов. */
export function checkRoot(prefix, root, out) {
    if (!isObj(root)) {
        out.push(err(prefix + '_ROOT', 'Корень файла должен быть JSON-объектом'));
        return false;
    }
    if (root.version !== 1) {
        out.push(err(prefix + '_VERSION', 'Поддерживается version: 1, найдено ' + JSON.stringify(root.version === undefined ? null : root.version),
            { field: 'version' }));
    }
    return true;
}

// --- Канонический JSON ------------------------------------------------------------
// Стабильный вид для git diff: объекты раскрыты, массивы скаляров — в строку,
// элементы-объекты в массиве — по одному на строке, если помещаются в 110 знаков.
function compact(v) {
    if (Array.isArray(v)) return '[' + v.map(compact).join(', ') + ']';
    if (isObj(v)) {
        const keys = Object.keys(v);
        if (!keys.length) return '{}';
        return '{ ' + keys.map((k) => JSON.stringify(k) + ': ' + compact(v[k])).join(', ') + ' }';
    }
    return JSON.stringify(v);
}

function pretty(v, indent) {
    const pad = '  '.repeat(indent);
    if (Array.isArray(v)) {
        if (!v.length) return '[]';
        const one = compact(v);
        if (one.length + pad.length <= 110 && !v.some((x) => isObj(x))) return one;
        const items = v.map((x) => {
            const c = compact(x);
            return pad + '  ' + (c.length + pad.length + 2 <= 110 ? c : pretty(x, indent + 1));
        });
        return '[\n' + items.join(',\n') + '\n' + pad + ']';
    }
    if (isObj(v)) {
        const keys = Object.keys(v);
        if (!keys.length) return '{}';
        const items = keys.map((k) => pad + '  ' + JSON.stringify(k) + ': ' + pretty(v[k], indent + 1));
        return '{\n' + items.join(',\n') + '\n' + pad + '}';
    }
    return JSON.stringify(v);
}

export function canonicalJson(value) {
    return pretty(value, 0) + '\n';
}

// --- Выпуск диагностик по правилам ----------------------------------------------------
/** Уникальность имён в списке: возвращает диагностики-дубликаты. */
export function duplicateNames(prefix, items, label) {
    const seen = new Map();
    const out = [];
    items.forEach((it, i) => {
        if (!it || !isStr(it.name) || !it.name) return;
        if (seen.has(it.name)) {
            out.push(warn(prefix + '_DUPLICATE_NAME', label + ' «' + it.name + '» встречается повторно', { index: i, first: seen.get(it.name) }));
        } else {
            seen.set(it.name, i);
        }
    });
    return out;
}

// --- Разметка формы ----------------------------------------------------------------------
/**
 * Строка формы: подпись + поле. `field` — { id, label, value, hint? }.
 * Все значения — текст (RmlUi `input`), разбор — `parseField`.
 */
export function fieldRow(field) {
    return '<div class="field-row"><label>' + escapeHtml(field.label) + '</label>' +
        '<input id="' + escapeHtml(field.id) + '" type="text" value="' + escapeHtml(field.value === undefined || field.value === null ? '' : field.value) + '" class="field"/></div>' +
        (field.hint ? '<div class="hint">' + escapeHtml(field.hint) + '</div>' : '');
}

/** Две ячейки в строке: «X, Y». */
export function pairRow(label, idA, valA, idB, valB) {
    const v = (x) => escapeHtml(x === undefined || x === null ? '' : x);
    return '<div class="field-row"><label>' + escapeHtml(label) + '</label><div class="pair">' +
        '<input id="' + idA + '" type="text" value="' + v(valA) + '" class="field"/>' +
        '<input id="' + idB + '" type="text" value="' + v(valB) + '" class="field"/></div></div>';
}

export function button(key, text, cls) {
    return '<button class="btn ' + (cls || '') + '" data-key="' + escapeHtml(key) + '">' + escapeHtml(text) + '</button>';
}

/** Число из текста поля: запятая как точка; пусто → null; мусор → NaN. */
export function parseNum(text) {
    const t = String(text === undefined || text === null ? '' : text).trim().replace(',', '.');
    if (t === '') return null;
    return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

/** Пара «min, max» или одно число из двух полей: пустые поля → null. */
export function parseRange(minText, maxText) {
    const lo = parseNum(minText), hi = parseNum(maxText);
    if (lo === null && hi === null) return null;
    if (Number.isNaN(lo) || Number.isNaN(hi)) return NaN;
    const a = lo === null ? hi : lo, b = hi === null ? lo : hi;
    return a === b ? a : [Math.min(a, b), Math.max(a, b)];
}

/** Булево из «да/нет»-текста: true/1/да/yes. */
export function parseBool(text) {
    return /^(true|1|да|yes|on)$/i.test(String(text || '').trim());
}
