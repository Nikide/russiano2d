// ===========================================================================
// Диагностика: структурированные ошибки и предупреждения (§17 Спецификации).
//
// Задача, которую решает модуль: ошибка должна быть пригодна машине, а не
// только человеку, читающему stderr. Раньше всё сводилось к строке в логе
// (`$: ошибка в …`): по ней нельзя ни посчитать повторы, ни отфильтровать по
// подсистеме, ни показать в DevTools то же, что получает автоматический тест.
//
// Что даёт:
//   * запись фиксированной формы: code, subsystem, operation, message,
//     recoverability, nodeId/assetPath, source (файл:строка), jsonPath, frame;
//   * `$.debug.errors()` — список записей в порядке появления, `$.debug.report()`
//     — сводка по кодам и подсистемам;
//   * подавление повторов: одинаковые сообщения не заливают лог, но счётчик
//     потерь виден (`lost`), как требует §17;
//   * `$.debug.expectClean()` — для тестов и приёмки: список ошибок за прогон.
//
// Структура не заменяет существующее поведение: строка в лог по-прежнему
// пишется (её читают люди и тесты, ищущие «$: ошибка»), запись лишь идёт рядом.
// ===========================================================================

import { ctx } from './core.js';

/** Кольцо записей: диагностика не растёт вместе с длительностью запуска (§28). */
const LIMIT = 128;
/** Сколько первых повторов одного и того же сообщения печатать. */
const REPEAT_LOG_LIMIT = 3;

const entries = [];
let next_seq = 1;
let dropped = 0;
const repeats = new Map();   // ключ → { count, lost }

/**
 * Классификатор: из подписи места выводится код и подсистема.
 *
 * Коды — часть контракта (§17: «имена полей — проектный контракт»), поэтому
 * они стабильны и не зависят от текста сообщения. Игра может передать свой код
 * явно — тогда используется он.
 */
export function classify(where) {
    const w = String(where || '');
    if (w.startsWith('$.')) {
        // $.ready, $.update, $.render, $.batch, $.exit … — подсистема по имени
        const name = w.slice(2).split(/[\s.(]/)[0] || 'api';
        return { code: 'R2D_SCRIPT_CALLBACK', subsystem: name };
    }
    if (w.startsWith('update сцены')) return { code: 'R2D_SCENE_UPDATE', subsystem: 'scene' };
    if (w.startsWith('render сцены')) return { code: 'R2D_SCENE_RENDER', subsystem: 'scene' };
    if (w.startsWith('событие ')) return { code: 'R2D_NODE_EVENT', subsystem: 'events' };
    return { code: 'R2D_ERROR', subsystem: 'engine' };
}

/** Стек QuickJS → первый кадр с файлом и строкой, если он там есть. */
export function sourceOf(error) {
    if (!error) return null;
    const stack = error.stack ? String(error.stack) : '';
    if (stack === '') return null;
    const match = /\(([^()\s:]+):(\d+)(?::(\d+))?\)|at\s+([^\s(:]+):(\d+)(?::(\d+))?/.exec(stack);
    if (!match) return null;
    const file = match[1] || match[4];
    const line = Number(match[2] || match[5]);
    return file ? { file, line: Number.isFinite(line) ? line : 0 } : null;
}

function remember(entry) {
    if (entries.length >= LIMIT) { entries.shift(); dropped++; }
    entries.push(entry);
}

/**
 * Записать ошибку.
 *
 * opts (все необязательны): code, subsystem, operation, nodeId, assetPath,
 * jsonPath, recoverable, fatal, data.
 *
 * `recoverable` — может ли игра продолжать: по умолчанию да (обработчик кадра
 * упал, но кадр живёт). `fatal` ставит recoverable=false и поднимает счётчик
 * фатальных: загрузчик обязан считать такую операцию неуспешной, а не
 * «завершившейся с успехом» (§17).
 */
export function report(where, error, opts) {
    const o = opts || {};
    // Классификация нужна только для тех полей, которые не задал вызывающий:
    // если он передал и код, и подсистему, гадать по строке нечего.
    const cls = (o.code && o.subsystem) ? null : classify(where);
    const message = error === undefined || error === null
        ? String(where)
        : (error && error.message ? String(error.message) : String(error));
    const entry = {
        seq: next_seq++,
        code: o.code || cls.code,
        subsystem: o.subsystem || cls.subsystem,
        operation: o.operation || String(where || ''),
        message,
        recoverable: o.fatal === true ? false : (o.recoverable === undefined ? true : o.recoverable !== false),
        nodeId: o.nodeId === undefined ? null : o.nodeId,
        assetPath: o.assetPath === undefined ? null : o.assetPath,
        jsonPath: o.jsonPath === undefined ? null : o.jsonPath,
        source: sourceOf(error),
        frame: ctx.time && typeof ctx.time.frame === 'function' ? ctx.time.frame() : -1,
        data: o.data === undefined ? null : o.data,
    };
    remember(entry);

    // Подавление повторов: ключ — код + место + текст. Первые несколько
    // повторов печатаем, остальные считаем: иначе один сломанный кадр
    // превращает stderr в поток и прячет остальные ошибки.
    const key = entry.code + '|' + entry.operation + '|' + entry.message;
    const seen = repeats.get(key);
    if (seen === undefined) {
        repeats.set(key, { count: 1, lost: 0 });
        print(entry, error);
    } else {
        seen.count++;
        if (seen.count <= REPEAT_LOG_LIMIT) print(entry, error);
        else seen.lost++;
    }
    return entry;
}

function print(entry, error) {
    const stack = error && error.stack ? `\n${error.stack}` : '';
    const tail = entry.recoverable ? '' : ' [неустранимая]';
    ctx.log(`$: ошибка в ${entry.operation}: ${entry.message}${tail}${stack}`);
}

/** Оформление исключения движка (те же поля, что у report). */
export function reportException(where, error, opts) {
    if (error instanceof Error) return report(where, error, opts);
    return report(where, error === undefined ? 'исключение' : error, opts);
}

/** Записи в порядке появления. Возвращается копия: вызывающий не меняет журнал. */
export function list() { return entries.slice(); }

/** Сводка §17: по кодам, подсистемам и потерям подавления. */
export function summary() {
    const by_code = {};
    const by_subsystem = {};
    const by_operation = {};
    let fatal = 0;
    for (const e of entries) {
        by_code[e.code] = (by_code[e.code] || 0) + 1;
        by_subsystem[e.subsystem] = (by_subsystem[e.subsystem] || 0) + 1;
        by_operation[e.operation] = (by_operation[e.operation] || 0) + 1;
        if (!e.recoverable) fatal++;
    }
    let lost = 0;
    for (const v of repeats.values()) lost += v.lost;
    return {
        total: entries.length,
        fatal,
        dropped,       // вытеснено кольцом
        suppressed: lost,   // не напечатано из-за подавления повторов
        by_code, by_subsystem, by_operation,
        // Явный флаг для приёмки: журнал чист, если нет неустранимых ошибок.
        clean: fatal === 0,
    };
}

/** Очистить журнал (для тестов и приёмки). */
export function clear() {
    entries.length = 0;
    repeats.clear();
    dropped = 0;
    next_seq = 1;
}

export function installDiag($) {
    // `$.debug.errors()` — записи, `$.debug.report()` — сводка. Первым
    // аргументом можно передать код/подсистему/узел для фильтра.
    const debug = $.debug || ($.debug = {});
    debug.errors = function (filter) {
        const all = list();
        if (filter === undefined || filter === null) return all;
        const f = String(filter);
        return all.filter((e) => e.code === f || e.subsystem === f || e.nodeId === f);
    };
    debug.report = function () { return summary(); };
    debug.clearErrors = function () { clear(); return true; };
    debug.expectClean = function () {
        const s = summary();
        if (s.clean) return true;
        const first = list().find((e) => !e.recoverable);
        throw new Error(`в журнале есть неустранимая ошибка: ${first.code} ${first.message}`);
    };
    debug.classify = classify;

    /**
     * Записать факт диагностики из подсистемы игры или движка:
     * `$.debug.report('load', err, { fatal: true, assetPath: 'a.png' })`.
     * Неустранимая запись (`fatal`) обнуляет `clean` и считается провалом
     * обязательной операции (§17).
     */
    debug.reportError = function (where, error, opts) {
        return report(where, error, opts);
    };
    return $;
}
