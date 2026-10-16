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

import { ctx, wrapOne } from './core.js';

/** Кольцо записей: диагностика не растёт вместе с длительностью запуска (§28). */
const LIMIT = 128;
/** Сколько первых повторов одного и того же сообщения печатать. */
const REPEAT_LOG_LIMIT = 3;
/**
 * Как часто напоминать о подавленных повторах. §15 запрещает молчаливое
 * исчезновение: у каждой записи есть счётчик `repeats`, а лог раз в N повторов
 * печатает строку с «repeated xN» — поток строк при этом остаётся ограничен.
 */
const REPEAT_NOTICE_EVERY = 10;

const entries = [];
let next_seq = 1;
let dropped = 0;
const repeats = new Map();   // ключ → { count, lost, printed, code, operation, message }

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
        //: Сколько раз подряд повторилось это же сообщение (§15): 1 — первый раз.
        repeats: 1,
    };
    remember(entry);

    // Подавление повторов: ключ — код + место + текст. Первые несколько
    // повторов печатаем, дальше — раз в REPEAT_NOTICE_EVERY: иначе один
    // сломанный кадр превращает stderr в поток и прячет остальные ошибки, но
    // и молчать нельзя (§15). Счётчик повторов виден и в записи (`repeats`),
    // и в сводке (`repeated`), и в тексте строки — «repeated x37».
    const key = entry.code + '|' + entry.operation + '|' + entry.message;
    const seen = repeats.get(key);
    if (seen === undefined) {
        repeats.set(key, {
            count: 1, lost: 0, printed: 1,
            code: entry.code, operation: entry.operation, message: entry.message,
        });
        entry.repeats = 1;
        print(entry, error, 1);
    } else {
        seen.count++;
        entry.repeats = seen.count;
        if (seen.count <= REPEAT_LOG_LIMIT || seen.count % REPEAT_NOTICE_EVERY === 0) {
            seen.printed++;
            print(entry, error, seen.count);
        } else {
            seen.lost++;
        }
    }
    return entry;
}

function print(entry, error, count) {
    const stack = error && error.stack ? `\n${error.stack}` : '';
    const tail = entry.recoverable ? '' : ' [неустранимая]';
    const repeated = count > 1 ? ` (repeated x${count})` : '';
    ctx.log(`$: ошибка в ${entry.operation}: ${entry.message}${tail}${repeated}${stack}`);
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
    // Построчные счётчики повторов: по сводке видно, ЧТО именно повторялось,
    // а не только «сколько строк подавлено» (§15: suppression должен быть
    // видимым). Сортируем по убыванию частоты — самое шумное сверху.
    const repeated = [];
    for (const v of repeats.values()) {
        lost += v.lost;
        if (v.count > 1) {
            repeated.push({
                code: v.code, operation: v.operation, message: v.message,
                count: v.count, printed: v.printed, suppressed: v.lost,
            });
        }
    }
    repeated.sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
    return {
        total: entries.length,
        fatal,
        dropped,       // вытеснено кольцом
        suppressed: lost,   // не напечатано из-за подавления повторов
        by_code, by_subsystem, by_operation,
        repeated,      // повторы по сообщениям: count/printed/suppressed
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
    // -----------------------------------------------------------------------
    // §28 P0: фактические представления состояния узла и боя.
    //
    // Всё, что нужно для отладки боя, уже есть в разных подсистемах, но чтобы
    // ответить на вопрос «почему удар не прошёл», приходилось смотреть пять
    // мест в консоли. `anatomy()` собирает их в один снимок — и он же служит
    // расширением существующего агентского протокола (новый протокол не
    // вводится: DevTools и агент читают тот же объект).
    // -----------------------------------------------------------------------

    /** Первый узел выборки; принимает селектор, обёртку или узел. */
    function pickNode(sel) {
        if (sel === undefined || sel === null) return null;
        if (typeof sel === 'string') {
            const found = ctx.$ ? ctx.$(sel).get(0) : null;
            return found || null;
        }
        // Обёртку разворачиваем: иначе `anatomy()` получал бы объект-обёртку
        // без прямых полей узла, и вызывающие ожидали бы то же, что от селектора.
        const raw = sel.nodes ? sel.nodes[0] : sel;
        return raw && raw.tag ? raw : null;
    }

    /** Обёртка для методов узла (`.areas()`, `.ground()`): сырой узел их не имеет. */
    function wrapFor(node) {
        try { return wrapOne(node); } catch (e) { return null; }
    }

    /**
     * Полная «анатомия» узла: тело, области с ролями, опора, активные окна и
     * политики обработки.
     *
     * ```js
     * $.debug.anatomy('#hero');
     * // { found, nid, tag, pos, body, areas: [{name, role, enabled, index}…],
     * //   ground, windows: ['attack'], processing: {...}, watching: [...] }
     * ```
     */
    debug.anatomy = function (sel) {
        const node = pickNode(sel);
        if (!node) return { found: false, selector: typeof sel === 'string' ? sel : null };
        const wrapped = wrapFor(node);
        const areas = wrapped && typeof wrapped.areas === 'function' ? wrapped.areas() : [];
        const processing = (ctx.$ && ctx.$.processing && typeof ctx.$.processing.get === 'function')
            ? ctx.$.processing.get(node) : null;
        const windows = (ctx.$ && ctx.$.anim && typeof ctx.$.anim.openWindows === 'function')
            ? ctx.$.anim.openWindows(node) : null;
        let ground = null;
        try { ground = wrapped && typeof wrapped.ground === 'function' ? wrapped.ground() : null; } catch (e) { ground = null; }
        return {
            found: true,
            nid: node.nid || null,
            tag: node.tag || null,
            id: node.id || null,
            pos: { x: node.x, y: node.y },
            size: { w: node.w, h: node.h },
            visible: node.visible !== false,
            body: node.body >= 0
                ? { id: node.body, layer: node.layer_bits, mask: node.collision_mask, group: node.collision_group }
                : null,
            areas: areas.map((a) => ({
                name: a.name, role: a.role, index: a.index,
                enabled: a.enabled !== false, sensor: a.sensor !== false,
                owner: a.owner === null || a.owner === undefined ? null : (a.owner.nid || String(a.owner)),
                shape: a.shape, x: a.x, y: a.y, w: a.w, h: a.h,
            })),
            ground: ground ? {
                on: !!ground.on, slope: ground.slope, vx: ground.vx, vy: ground.vy,
                oneWay: !!ground.oneWay, node: ground.node ? (ground.node.nid || null) : null,
            } : null,
            windows: windows === null ? null : (Array.isArray(windows) ? windows.slice() : [windows]),
            processing: processing || null,
            // Наблюдатели видимости (§44) и владельцы таймеров — тоже часть
            // «почему объект не двигается».
            watching: (ctx.$ && ctx.$.activation && typeof ctx.$.activation.stats === 'function')
                ? (ctx.$.activation.stats().watchers || 0) : null,
        };
    };

    /**
     * Контакты за прошедший шаг в удобном виде (§28 P0): нормаль, точка, фаза и
     * роли областей, а не сырые id.
     *
     * ```js
     * $.debug.contacts();
     * // [{ phase, self, other, nx, ny, x, y, areaA, areaB, roleA, roleB, sensor }]
     * ```
     */
    debug.contacts = function (opts) {
        const eng = ctx.engine || (ctx.native && ctx.native.engine);
        if (!eng || typeof eng.contacts !== 'function') return [];
        const list = eng.contacts() || [];
        const limit = opts && opts.limit ? opts.limit : 64;
        return list.slice(0, limit).map((c) => ({
            phase: c.phase || (c.begin ? 'begin' : (c.end ? 'end' : 'hit')),
            self: c.self !== undefined ? c.self : (c.source_id || null),
            other: c.other !== undefined ? c.other : (c.target_id || null),
            nx: c.nx === undefined ? null : c.nx,
            ny: c.ny === undefined ? null : c.ny,
            x: c.x === undefined ? null : c.x,
            y: c.y === undefined ? null : c.y,
            areaA: c.areaA === undefined ? null : c.areaA,
            areaB: c.areaB === undefined ? null : c.areaB,
            roleA: c.roleA === undefined ? null : c.roleA,
            roleB: c.roleB === undefined ? null : c.roleB,
            sensor: c.sensor === true,
            hasNormal: c.hasNormal !== false && c.nx !== null && c.nx !== undefined,
        }));
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
