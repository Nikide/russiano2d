// ===========================================================================
// Таблицы: $.csv — разбор и сборка CSV/TSV, плюс безопасный JSON.
//
// Игры держат в CSV баланс оружия, диалоги, уровни. Разборщик здесь
// самодостаточный: кавычки, удвоенные кавычки внутри, переводы строк внутри
// поля, выбор разделителя и первая строка как заголовки.
//
//   const rows = $.csv.parse(text);                   // [[...], [...]] — все строки
//   const items = $.csv.parseTable('name,damage\nмеч,10');  // [{ name: 'меч', damage: '10' }]
//   $.csv.stringify(items, { header: ['name', 'damage'] });
//
// JSON-помощники ($.csv.jsonParse / jsonStringify) не бросают исключений:
// битый файл даёт запасное значение и понятную запись в журнал. Сам движок
// JSON умеет, но «разобрать или вернуть запасное» из игры не выразить.
// ===========================================================================

import { ctx } from './core.js';

/** Разделители, среди которых выбирает автодетект. Порядок — приоритет при равенстве. */
const DELIMITERS = [',', ';', '\t', '|'];

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

/**
 * Определить разделитель по первой значащей строке. Считаются только
 * вхождения вне кавычек, иначе «a,"x;y"» уводило бы на точку с запятой.
 * Если ни одного разделителя нет — запятая.
 */
export function detectDelimiter(text) {
    const src = String(text || '');

    // Первая строка, ещё и без учёта кавычек — только для подсчёта.
    let line = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === '"') { quoted = !quoted; continue; }
        if (!quoted && (ch === '\n' || ch === '\r')) break;
        if (!quoted) line += ch;
    }

    let best = ',';
    let bestCount = 0;
    for (const d of DELIMITERS) {
        let n = 0;
        let inside = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inside = !inside; continue; }
            if (!inside && ch === d) n++;
        }
        if (n > bestCount) { bestCount = n; best = d; }
    }
    return best;
}

/**
 * Разобрать CSV/TSV в массив строк, каждая строка — массив полей (строки).
 *
 * opts.delimiter — один символ; без него определяется автоматически;
 * opts.trim — обрезать пробелы у полей (по умолчанию false, пробелы значимы);
 * opts.skipEmptyLines — выбросить полностью пустые строки.
 *
 * Пустой текст даёт [], а последний перевод строки не создаёт лишнюю строку.
 */
export function parse(text, opts) {
    const o = opts || {};
    const src = String(text === undefined || text === null ? '' : text);
    if (src === '') return [];

    const delim = o.delimiter === undefined ? detectDelimiter(src) : String(o.delimiter).charAt(0);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let i = 0;

    const pushField = () => { row.push(o.trim ? field.trim() : field); field = ''; };

    while (i < src.length) {
        const ch = src[i];

        if (quoted) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i += 2; continue; }   // "" → "
                quoted = false;
                i++;
                continue;
            }
            field += ch;                     // переводы строк внутри кавычек сохраняются
            i++;
            continue;
        }

        if (ch === '"' && field === '') { quoted = true; i++; continue; }
        if (ch === delim) { pushField(); i++; continue; }
        if (ch === '\r') { i++; continue; }  // CRLF и одиночный CR — один перевод строки
        if (ch === '\n') {
            pushField();
            rows.push(row);
            row = [];
            i++;
            continue;
        }
        field += ch;
        i++;
    }

    // Хвост без перевода строки. Незакрытая кавычка не ошибка: поле берётся
    // как есть — битый файл лучше показать целиком, чем потерять данные.
    if (field !== '' || row.length > 0) {
        pushField();
        rows.push(row);
    }

    if (!o.skipEmptyLines) return rows;
    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * Разобрать таблицу с заголовком: первая строка — имена полей, остальные —
 * данные. Возвращает массив объектов; недостающие поля — пустая строка.
 *
 * opts.keys — свой список имён: тогда первая строка тоже считается данными.
 * Пустые и повторяющиеся заголовки получают имена col1, col2… и суффикс _2.
 */
export function parseTable(text, opts) {
    const o = opts || {};
    const rows = parse(text, o);
    if (rows.length === 0) return [];

    const header = Array.isArray(o.keys) ? o.keys.slice() : rows.shift();
    const names = uniqueNames(header);
    const out = [];

    for (const row of rows) {
        const obj = {};
        for (let i = 0; i < names.length; i++) {
            obj[names[i]] = row[i] === undefined ? '' : row[i];
        }
        out.push(obj);
    }
    return out;
}

/** Имена колонок без пустых и повторов — иначе объект потерял бы поле. */
function uniqueNames(header) {
    const seen = new Map();
    const names = [];
    for (let i = 0; i < header.length; i++) {
        let name = header[i] === undefined || header[i] === null ? '' : String(header[i]);
        if (name === '') name = 'col' + (i + 1);
        const n = (seen.get(name) || 0) + 1;
        seen.set(name, n);
        names.push(n === 1 ? name : name + '_' + n);
    }
    return names;
}

// ---------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------

/**
 * Экранировать одно поле: кавычки нужны, если внутри разделитель, кавычка,
 * перевод строки или пробелы по краям. Кавычка внутри удваивается.
 */
export function quoteField(value, delimiter) {
    const delim = delimiter === undefined ? ',' : String(delimiter).charAt(0);
    let s;
    if (value === null || value === undefined) s = '';
    else if (typeof value === 'object') {
        const json = JSON.stringify(value);
        s = json === undefined ? '' : json;
    } else s = String(value);

    const needsQuotes = s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 ||
        s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0 ||
        (s.length > 0 && (s.charAt(0) === ' ' || s.charAt(s.length - 1) === ' '));
    if (!needsQuotes) return s;
    return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Собрать CSV из массива строк (или объектов при opts.header).
 *
 * opts.delimiter — разделитель (по умолчанию ','); для TSV удобно '\t';
 * opts.eol — перевод строки (по умолчанию '\n');
 * opts.header — массив имён: печатается первой строкой, а строки-объекты
 * берут значения по этим именам.
 * null/undefined → пустое поле, объекты → JSON, остальное → String.
 */
export function stringify(rows, opts) {
    const o = opts || {};
    const delim = o.delimiter === undefined ? ',' : String(o.delimiter).charAt(0);
    const eol = o.eol === undefined ? '\n' : String(o.eol);
    const list = Array.isArray(rows) ? rows : [];
    const header = Array.isArray(o.header) ? o.header : null;

    const lines = [];
    if (header) lines.push(header.map((v) => quoteField(v, delim)).join(delim));

    for (const row of list) {
        if (row === null || row === undefined) { lines.push(''); continue; }
        if (Array.isArray(row)) {
            lines.push(row.map((v) => quoteField(v, delim)).join(delim));
            continue;
        }
        const keys = header || Object.keys(row);
        lines.push(keys.map((k) => quoteField(row[k], delim)).join(delim));
    }
    return lines.join(eol);
}

// ---------------------------------------------------------------------------
// JSON без исключений
// ---------------------------------------------------------------------------

/**
 * Разобрать JSON; при ошибке вернуть fallback (по умолчанию null) и написать
 * в журнал, что именно не так. Не-строки и пустая строка тоже дают fallback.
 */
export function jsonParse(text, fallback) {
    const fb = fallback === undefined ? null : fallback;
    if (typeof text !== 'string') return fb;

    const src = text.trim();
    if (src === '') return fb;

    try {
        return JSON.parse(src);
    } catch (e) {
        ctx.log('$.csv.jsonParse: не разобрал JSON (' + (e && e.message ? e.message : e) +
            '); отдаю запасное значение. Начало текста: ' + src.slice(0, 60));
        return fb;
    }
}

/**
 * Собрать JSON; при невозможности (ссылка на себя, BigInt, функция) вернуть
 * null и написать в журнал. pretty — true или число пробелов отступа.
 */
export function jsonStringify(value, pretty) {
    const indent = pretty === true ? 2 : (Number(pretty) > 0 ? Math.floor(Number(pretty)) : 0);
    try {
        const text = JSON.stringify(value, null, indent);
        if (text === undefined) {
            ctx.log('$.csv.jsonStringify: значение нельзя превратить в JSON — ' +
                'это функция, undefined или символ');
            return null;
        }
        return text;
    } catch (e) {
        ctx.log('$.csv.jsonStringify: не смог собрать JSON (' + (e && e.message ? e.message : e) +
            ') — скорее всего, в данных есть ссылка на себя');
        return null;
    }
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

/** Подключить $.csv (разбор, сборка, таблицы с заголовком, безопасный JSON). */
export function installCsv($) {
    const csv = {
        parse,
        parseTable,
        stringify,
        detectDelimiter,
        quoteField,
        jsonParse,
        jsonStringify,
    };

    $.csv = csv;
    ctx.csv = csv;
    return csv;
}
