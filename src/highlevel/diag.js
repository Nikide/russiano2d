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
import { engine } from './native.js';

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


// ---------------------------------------------------------------------------
// Диагностический пакет ($.diag.bundle).
//
// Пишет diagnostics/<timestamp>/ рядом с игрой через $.fs: паспорт сборки,
// сцену, seed/fixed dt, счётчики/пределы/ресурсы, журнал ошибок, хвост
// консоли DevTools, недавние события $.trace и заголовок реплея.
//
// Границы, за которые модуль не выходит:
//   * только существующие источники — ничего не измеряет сам;
//   * путь проверяется: абсолютные пути, "..", "~", двоеточия и разделители
//     внутри сегментов отклоняются, а не «исправляются молча»;
//   * никакой сети/телеметрии; размер ограничен кольцами источников;
//   * автосборки на fatal-ошибке нет: bundle зовут явно (безопасного хука,
//     который не рискует рекурсией и потерей исходной ошибки, в движке нет).
// ---------------------------------------------------------------------------

const BUNDLE_DEFAULT_DIR = 'diagnostics';
const BUNDLE_DIR_MAX_SEGMENTS = 4;
const BUNDLE_TRACE_LIMIT = 128;
const BUNDLE_ERROR_LIMIT = 128;
const BUNDLE_LOG_LIMIT = 64;

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function defaultTimestamp() {
    const d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
        + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

/** Относительный каталог: сегменты [A-Za-z0-9._-], без "..", без абсолютных путей. */
function safeBundleDir(value) {
    if (value === undefined || value === null || value === '') return BUNDLE_DEFAULT_DIR;
    if (typeof value !== 'string') return null;
    const s = value.replace(/\\/g, '/').trim();
    if (!s || s.charAt(0) === '/' || /^[A-Za-z]:/.test(s) || s.indexOf('~') === 0) return null;
    const parts = s.split('/');
    if (parts.length > BUNDLE_DIR_MAX_SEGMENTS) return null;
    const out = [];
    for (const part of parts) {
        if (!part || part === '.' || part === '..') return null;
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(part)) return null;
        out.push(part);
    }
    return out.join('/');
}

function safeTimestamp(value) {
    if (value === undefined || value === null || value === '') return defaultTimestamp();
    const s = (typeof value === 'number') ? String(value) : String(value).trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) return null;
    if (s === '.' || s === '..' || s.charAt(0) === '.') return null;
    return s;
}

function limitOf(value, fallback, max) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
}

/** JSON без исключений и без циклов: функции выпадают, ссылки помечаются. */
function safeJSON(value, pretty) {
    const seen = [];
    try {
        return JSON.stringify(value, (key, v) => {
            const t = typeof v;
            if (t === 'function') return undefined;
            if (t === 'bigint') return String(v);
            if (v && t === 'object') {
                if (seen.indexOf(v) >= 0) return '[circular]';
                seen.push(v);
            }
            return v;
        }, pretty ? 2 : 0);
    } catch (e) {
        try { return JSON.stringify(String(value)); } catch (e2) { return '"[unserializable]"'; }
    }
}

function safeCall(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
}

function bundleEngineInfo($) {
    const e = engine || {};
    const caps = ($.agent && typeof $.agent.capabilities === 'function')
        ? safeCall(() => $.agent.capabilities(), null) : null;
    const identity = ($.replay && typeof $.replay.identity === 'function')
        ? safeCall(() => $.replay.identity(), null) : null;
    const version = typeof e.version === 'string' ? e.version
        : ($.version && typeof $.version === 'function' ? safeCall(() => $.version(), null) : null);
    const build = e.buildId !== undefined ? e.buildId
        : (e.build !== undefined ? e.build : (identity ? identity.build : null));
    return {
        version,
        build,
        platform: typeof e.platform === 'string' ? e.platform
            : (caps && typeof caps.platform === 'string' ? caps.platform : null),
        arch: typeof e.arch === 'string' ? e.arch : null,
        gpu: typeof e.gpu === 'string' ? e.gpu
            : (caps && typeof caps.gpu === 'string' ? caps.gpu : null),
        backend: typeof e.backend === 'string' ? e.backend : null,
        renderer: {
            info: (typeof e.renderInfo === 'function' ? safeCall(() => e.renderInfo(), null) : null),
            depth: (typeof e.depthInfo === 'function' ? safeCall(() => e.depthInfo(), null) : null),
            sprite_filter: (typeof e.spriteFilter === 'function' ? safeCall(() => e.spriteFilter(), null) : null),
        },
        // null — честное «движок этих данных в JS не отдаёт», а не подстановка.
        note: 'platform/gpu приходят из C только в ответе агента; без него — null',
    };
}

function bundleSceneInfo($) {
    const e = engine || {};
    const scene = ($.scene && typeof $.scene.current === 'function')
        ? safeCall(() => $.scene.current(), null)
        : (ctx.scene && typeof ctx.scene.current === 'function' ? safeCall(() => ctx.scene.current(), null) : null);
    return {
        scene,
        seed: Number.isFinite(Number(e.seed)) ? Number(e.seed) : null,
        fixed_dt: Number.isFinite(Number(e.fixedDt)) ? Number(e.fixedDt) : null,
        frame: Number.isFinite(Number(e.frame)) ? Number(e.frame) : null,
        time: Number.isFinite(Number(e.time)) ? Number(e.time) : null,
        dt: Number.isFinite(Number(e.dt)) ? Number(e.dt) : null,
        size: { width: Number.isFinite(Number(e.width)) ? Number(e.width) : null,
                height: Number.isFinite(Number(e.height)) ? Number(e.height) : null },
    };
}

function bundleTraceInfo($, limit) {
    const api = $.trace;
    if (!api || typeof api.list !== 'function') {
        return { available: false, on: false, dropped: null, total: 0, rows: [],
                 note: '$.trace не установлен' };
    }
    const all = safeCall(() => api.list(), []) || [];
    return {
        available: true,
        on: safeCall(() => api.on(), null),
        dropped: safeCall(() => api.dropped(), null),
        limit: typeof api.limit === 'function' ? safeCall(() => api.limit(), null) : api.limit,
        total: all.length,
        rows: all.slice(-limit).map((r) => ({
            n: r.n, kind: r.kind, frame: r.frame,
            source: r.source === undefined ? null : r.source,
            target: r.target === undefined ? null : r.target,
            data: r.data === undefined ? null : r.data,
        })),
    };
}

function bundleReplayInfo($) {
    const r = $.replay;
    if (!r || typeof r.mode !== 'function') return { available: false, note: '$.replay не установлен' };
    return {
        available: true,
        mode: safeCall(() => r.mode(), null),
        length: safeCall(() => r.length(), null),
        position: safeCall(() => r.position(), null),
        dropped: safeCall(() => r.dropped(), null),
        header: safeCall(() => r.header(), null),
        checkpoints: typeof r.checkpointsList === 'function'
            ? safeCall(() => r.checkpointsList(), []) : null,
        named: typeof r.namedCheckpoints === 'function'
            ? safeCall(() => r.namedCheckpoints(), []) : null,
    };
}

function bundleLog($, limit) {
    const dev = ctx.devtools;
    const rows = (dev && typeof dev.consoleLog === 'function')
        ? safeCall(() => dev.consoleLog(), []) : [];
    if (!rows || !rows.length) {
        return {
            available: false,
            source: 'DevTools console',
            lines: [],
            note: 'движок не хранит лог stderr в JS; хвост появится, если панель DevTools писала команды. '
                + 'Структурные ошибки — в log/errors.json',
        };
    }
    return { available: true, source: 'DevTools console', lines: rows.slice(-limit),
             note: 'это лог консоли DevTools ($.console/панель), а не перехват stderr' };
}

function bundleREADME(path, files) {
    return [
        'R2D diagnostic bundle',
        '====================',
        '',
        'Создан явным вызовом $.diag.bundle() — без сети и телеметрии.',
        'Каталог: ' + path,
        'Файлы:',
        ...files.map((f) => '  - ' + f),
        '',
        'Что внутри:',
        '  engine.json  — версия/сборка/платформа/GPU (что движок отдаёт в JS),',
        '                 сцена, seed, fixed dt, кадр/время, реплей.',
        '  stats.json   — $.debug.stats()/limits()/counters() и $.debug.resources().',
        '  trace.json   — хвост $.trace.list() (если журнал включён).',
        '  replay.json  — режим/заголовок/checkpoints $.replay (если установлен).',
        '  log.txt      — структурные ошибки $.debug.errors() и хвост консоли DevTools.',
        '',
        'Ограничения (честно):',
        '  * platform/gpu/arch = null, если движок не передал их в JS;',
        '  * текст stderr не перехватывается — движок не хранит его в JS;',
        '  * размер ограничен кольцами источников, снимков экрана нет;',
        '  * путь проверен: абсолютные пути и ".." отклоняются.',
        '',
        'Сгенерировано: ' + new Date().toString(),
    ].join('\n') + '\n';
}

/**
 * Записать диагностический пакет. Возврат всегда структурный:
 * { ok, path, files, error }.
 */
export function writeBundle($, opts) {
    const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
    const dir = safeBundleDir(o.dir);
    if (dir === null) {
        return { ok: false, path: null, files: [],
                 error: '$.diag.bundle: недопустимый opts.dir — нужен относительный каталог '
                      + 'из сегментов [A-Za-z0-9._-], без "..", "~" и абсолютных путей' };
    }
    const stamp = safeTimestamp(o.timestamp);
    if (stamp === null) {
        return { ok: false, path: null, files: [],
                 error: '$.diag.bundle: недопустимый opts.timestamp — [A-Za-z0-9._-]{1,64}, '
                      + 'без "..","/", ":" и ведущей точки' };
    }
    const fs_api = ($ && ($.fs || ctx.fs)) || null;
    if (!fs_api || typeof fs_api.write !== 'function') {
        return { ok: false, path: null, files: [],
                 error: '$.diag.bundle: нет $.fs.write — модуль store.js не установлен' };
    }
    const path = dir + '/' + stamp;
    const trace_limit = limitOf(o.trace, BUNDLE_TRACE_LIMIT, 512);
    const error_limit = limitOf(o.errors, BUNDLE_ERROR_LIMIT, 512);
    const log_limit = limitOf(o.log, BUNDLE_LOG_LIMIT, 256);
    const files = [];
    const errors = [];
    const write = (name, text) => {
        const rel = path + '/' + name;
        let ok = false;
        try { ok = fs_api.write(rel, text); } catch (e) { errors.push(rel + ': ' + (e && e.message ? e.message : e)); return; }
        if (ok) files.push(rel);
        else errors.push('не удалось записать ' + rel + (typeof fs_api.lastError === 'function'
            ? ': ' + (safeCall(() => fs_api.lastError(), '') || 'причина не сообщена') : ''));
    };

    const scene = bundleSceneInfo($);
    const engine_info = bundleEngineInfo($);
    const stats = {
        stats: safeCall(() => $.debug && $.debug.stats(), null),
        counters: safeCall(() => $.debug && $.debug.counters(), null),
        limits: safeCall(() => $.debug && $.debug.limits(), null),
        resources: safeCall(() => $.debug && $.debug.resources && $.debug.resources(), null),
    };
    // resources — большой объект с top; в stats.json он уместен, но текст
    // панели не дублируем: JSON и есть машиночитаемая форма.
    const trace = bundleTraceInfo($, trace_limit);
    const replay = bundleReplayInfo($);
    const log = bundleLog($, log_limit);
    const errs = ($.debug && typeof $.debug.errors === 'function')
        ? (safeCall(() => $.debug.errors(), []) || []) : [];
    const log_text = [
        '# Структурные ошибки ($.debug.errors), последние ' + Math.min(errs.length, error_limit),
        ...errs.slice(-error_limit).map((e) => '[' + e.code + '] ' + e.operation + ': ' + e.message
            + (e.recoverable === false ? ' [fatal]' : '')
            + (e.source ? ' (' + e.source.file + ':' + e.source.line + ')' : '')),
        '',
        '# Консоль DevTools (' + (log.available ? 'есть' : 'пусто') + ')',
        ...log.lines,
    ].join('\n') + '\n';

    const engine_json = {
        generated_at: new Date().toISOString(),
        engine: engine_info,
        scene,
        stats: { fps: stats.stats ? stats.stats.fps : null, frame: scene.frame, time: scene.time },
        replay,
    };
    write('engine.json', safeJSON(engine_json, true) + '\n');
    write('stats.json', safeJSON(stats, true) + '\n');
    write('trace.json', safeJSON(trace, true) + '\n');
    write('replay.json', safeJSON(replay, true) + '\n');
    write('log.txt', log_text);
    // README последним: в нём список уже записанных файлов.
    write('README.txt', bundleREADME(path, files.concat([path + '/README.txt'])));
    if (errors.length) {
        return { ok: false, path, files, error: errors.join('; ') };
    }
    return { ok: true, path, files, error: null };
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

    // §17/§29: диагностический пакет. Только явный вызов: автосборка на fatal
    // не ставится (см. комментарий к writeBundle) — исходная ошибка важнее.
    $.diag = {
        /**
         * Записать diagnostics/<timestamp>/ через $.fs. Возврат:
         * { ok, path, files, error }. Путь относительный и проверен.
         *
         * opts: dir, timestamp, trace (сколько событий), errors, log.
         */
        bundle(opts) { return writeBundle($, opts); },
    };
    return $;
}
