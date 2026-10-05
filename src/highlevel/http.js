// ===========================================================================
// HTTP-запросы из игры: $.http.
//
// Тонкая обёртка над engine.http.*: запрос ставится в очередь и продвигается
// неблокирующим бэкендом движка (libcurl или встроенный сокет). Promise
// разрешается в tickHttp(), который api.js вызывает раз в кадр.
//
//   $.http.get('http://localhost:8080/score')
//       .then(res => $.store.set('score', res.json().score))
//       .catch(e => ctx.log(e.message));
//
//   const data = await $.http.json('http://localhost:8080/level/1');
//   await $.http.post('/api/save', { hp: 42 });
//
// Модуль обязан импортироваться без движка: к engine обращаемся только внутри
// функций, поэтому qjs-тест гоняет очередь Promise через $.http._setBackend().
// ===========================================================================

import { ctx } from './core.js';

const DEFAULT_TIMEOUT_MS = 15000;   // таймаут запроса, если игра не задала свой
const TIMEOUT_GRACE_MS = 2000;      // запас JS-таймаута над таймаутом движка

const state = {
    pending: new Map(),   // id → запись запроса
    backend: null,        // подмена бэкенда для тестов (null — настоящий движок)
    next_mock_id: -1,     // отрицательные id, чтобы не столкнуться с engine.http
};

// ---------------------------------------------------------------------------
// Чистые помощники: их проверяет tests/js/http_test.mjs без сети и движка
// ---------------------------------------------------------------------------

/** Собрать URL с query-параметрами: $.http.get('/s', { query: { q: 'да' } }). */
export function buildUrl(url, query) {
    const base = String(url);
    if (!query) return base;
    const parts = [];
    for (const key of Object.keys(query)) {
        const value = query[key];
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(item));
            }
        } else {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        }
    }
    if (parts.length === 0) return base;
    return base + (base.includes('?') ? '&' : '?') + parts.join('&');
}

/**
 * Заголовки → плоский массив [имя, значение, ...]: движку так дешевле.
 * Принимает и объект { 'X-A': '1' }, и уже плоский массив.
 */
export function normalizeHeaders(headers) {
    if (!headers) return [];
    const out = [];
    if (Array.isArray(headers)) {
        for (const item of headers) out.push(String(item));
        if (out.length % 2 !== 0) out.pop();
        return out;
    }
    if (typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
            const value = headers[key];
            if (value === undefined || value === null) continue;
            out.push(String(key), String(value));
        }
    }
    return out;
}

/**
 * Сырые заголовки ответа → объект с именами в нижнем регистре.
 * Блоки от редиректов перезаписываются: остаётся последний (финальный) ответ.
 */
export function parseHeaders(raw) {
    const out = {};
    if (!raw) return out;
    for (const line of String(raw).split(/\r?\n/)) {
        if (line === '') continue;
        if (/^HTTP\//i.test(line)) {
            // Новый блок заголовков (после редиректа) — прошлый уже неактуален.
            for (const key of Object.keys(out)) delete out[key];
            continue;
        }
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (name) out[name] = value;
    }
    return out;
}

/** Собрать объект ответа из того, что вернул движок (или тестовый бэкенд). */
export function makeResponse(raw, url) {
    const status = Number(raw && raw.status) || 0;
    const error = raw && raw.error ? String(raw.error) : null;
    const body = raw && raw.body !== undefined && raw.body !== null ? String(raw.body) : '';
    return {
        status,
        ok: status >= 200 && status < 300,
        body,
        headers: parseHeaders(raw && raw.headers),
        error,
        timeMs: (raw && Number(raw.timeMs)) || 0,
        url: url || '',
        text() { return body; },
        json() {
            if (!body) throw new Error('пустой ответ — JSON не разобрать');
            return JSON.parse(body);
        },
    };
}

/** Ошибка подсистемы: текст всегда начинается с «$.http: », чтобы было видно, кто виноват. */
export function makeHttpError(message, raw, url) {
    const error = new Error('$.http: ' + message);
    error.name = 'HttpError';
    if (raw) {
        error.status = Number(raw.status) || 0;
        error.body = raw.body === undefined || raw.body === null ? '' : String(raw.body);
    }
    if (url) error.url = url;
    return error;
}

// ---------------------------------------------------------------------------
// Внутреннее состояние
// ---------------------------------------------------------------------------

// Настоящий бэкенд движка, если он есть: мок engine из qjs-харнесса отдаёт
// no-op вместо http, поэтому проверяем именно метод request.
function engineHttp() {
    const http = typeof engine === 'undefined' || !engine ? null : engine.http;
    if (http && typeof http.request === 'function' && typeof http.poll === 'function') return http;
    return null;
}

// Привести (url, opts) и (opts) к одному виду — opts с полем url.
function asOptions(url, opts) {
    if (typeof url === 'string') return Object.assign({}, opts || {}, { url });
    return url || {};
}

function hasHeader(flat, name) {
    const lower = String(name).toLowerCase();
    for (let i = 0; i + 1 < flat.length; i += 2) {
        if (String(flat[i]).toLowerCase() === lower) return true;
    }
    return false;
}

// Нормализовать opts в то, что понимает engine.http.request.
function buildRequest(opts) {
    const request = {
        method: String(opts.method || 'GET').toUpperCase(),
        url: opts.url === undefined || opts.url === null ? '' : String(opts.url),
        headers: normalizeHeaders(opts.headers),
        body: null,
        timeout: DEFAULT_TIMEOUT_MS,
    };
    if (Number(opts.timeout) > 0) request.timeout = Number(opts.timeout);

    if (opts.json !== undefined) {
        request.body = JSON.stringify(opts.json);
        if (!hasHeader(request.headers, 'content-type')) {
            request.headers.push('Content-Type', 'application/json');
        }
    } else if (opts.body !== undefined && opts.body !== null) {
        if (typeof opts.body === 'string') {
            request.body = opts.body;
        } else {
            // Объект без opts.json тоже разумно отправить как JSON.
            request.body = JSON.stringify(opts.body);
            if (!hasHeader(request.headers, 'content-type')) {
                request.headers.push('Content-Type', 'application/json');
            }
        }
    }

    request.url = buildUrl(request.url, opts.query);
    return request;
}

// Разрешить/отклонить запись ровно один раз.
function settle(record, raw) {
    if (!state.pending.has(record.id)) return;
    state.pending.delete(record.id);
    if (raw && raw.error) {
        record.reject(makeHttpError(String(raw.error), raw, record.request.url));
        return;
    }
    record.resolve(makeResponse(raw, record.request.url));
}

function start(opts) {
    return new Promise((resolve, reject) => {
        let request;
        try {
            request = buildRequest(opts || {});
        } catch (e) {
            reject(makeHttpError('не удалось собрать запрос: ' + (e && e.message ? e.message : e)));
            return;
        }
        if (!request.url) {
            reject(makeHttpError('нужен url запроса'));
            return;
        }

        const record = {
            id: 0,
            engine_id: null,
            request,
            resolve,
            reject,
            elapsed: 0,
            timeout: request.timeout,
        };

        // Подмена бэкенда: тесты и игры без сети. Запрос продвигается в tickHttp.
        if (state.backend) {
            record.id = state.next_mock_id--;
            state.pending.set(record.id, record);
            return;
        }

        const http = engineHttp();
        if (!http) {
            reject(makeHttpError('нет доступного HTTP-бэкенда — движок собран без HTTP'));
            return;
        }
        const id = http.request(request);
        if (typeof id !== 'number' || id < 0) {
            reject(makeHttpError('не удалось поставить запрос в очередь (нет свободных слотов)'));
            return;
        }
        record.id = id;
        record.engine_id = id;
        state.pending.set(id, record);
    });
}

// ---------------------------------------------------------------------------
// Кадровый шаг
// ---------------------------------------------------------------------------

/**
 * Продвинуть очередь запросов. Вызывается раз в кадр из api.js, dt — секунды.
 * Каждый запрос гарантированно завершается: либо ответом бэкенда, либо
 * ошибкой (в том числе таймаутом), — Promise не может висеть вечно.
 */
export function tickHttp(dt) {
    if (state.pending.size === 0) return;
    const dt_ms = (Number(dt) || 0) * 1000;
    const http = state.backend ? null : engineHttp();

    for (const record of [...state.pending.values()]) {
        record.elapsed += dt_ms;

        if (state.backend) {
            let raw = null;
            try {
                raw = state.backend(record.request);
            } catch (e) {
                settle(record, { error: e && e.message ? e.message : String(e) });
                continue;
            }
            if (raw) {
                settle(record, raw);
                continue;
            }
        } else if (http) {
            const raw = http.poll(record.engine_id);
            if (raw) {
                settle(record, raw);
                continue;
            }
        }

        if (record.elapsed >= record.timeout + TIMEOUT_GRACE_MS) {
            if (record.engine_id !== null && http) http.cancel(record.engine_id);
            settle(record, { error: 'таймаут запроса' });
        }
    }
}

// ---------------------------------------------------------------------------
// Установка $.http
// ---------------------------------------------------------------------------

export function installHttp($) {
    const http = {
        /** GET → Promise<ответ>. */
        get(url, opts) { return start(Object.assign({}, asOptions(url, opts), { method: 'GET' })); },

        /** POST с телом → Promise<ответ>. */
        post(url, body, opts) {
            return start(Object.assign({}, asOptions(url, opts), { method: 'POST', body }));
        },

        put(url, body, opts) {
            return start(Object.assign({}, asOptions(url, opts), { method: 'PUT', body }));
        },

        delete(url, opts) {
            return start(Object.assign({}, asOptions(url, opts), { method: 'DELETE' }));
        },

        /** Произвольный запрос: opts = { url, method, headers, body, json, query, timeout }. */
        request(opts) { return start(opts || {}); },

        /** Тело как JSON. Отклоняется на ошибке сети и на невалидном JSON. */
        json(url, opts) {
            return start(asOptions(url, opts)).then((res) => {
                try {
                    return res.json();
                } catch (e) {
                    throw makeHttpError('ответ не является JSON: ' + (e && e.message ? e.message : e),
                                        res, res.url);
                }
            });
        },

        /** Тело как текст (статус не важен — смотрите res.ok). */
        text(url, opts) {
            return start(asOptions(url, opts)).then((res) => res.text());
        },

        /** Скачать в файл рядом с игрой. Нужен $.fs из модуля store. */
        download(url, path) {
            return start(asOptions(url, {})).then((res) => {
                if (!res.ok) throw makeHttpError('не удалось скачать: HTTP ' + res.status, res, res.url);
                const fs = ctx.fs;
                if (!fs || typeof fs.write !== 'function') {
                    throw makeHttpError('для download нужен $.fs (модуль store)', res, res.url);
                }
                if (!fs.write(path, res.body)) {
                    throw makeHttpError('не удалось записать "' + path + '"', res, res.url);
                }
                return { path, bytes: res.body.length, status: res.status, response: res };
            });
        },

        /** Сколько запросов ещё не завершено. */
        pending() { return state.pending.size; },

        /** "curl" | "socket" | "mock" | "none". */
        backend() {
            if (state.backend) return 'mock';
            const bridge = engineHttp();
            return bridge && typeof bridge.backend === 'function' ? bridge.backend() : 'none';
        },

        /** Есть ли чем выполнять запросы (в тестах — да, если задан _setBackend). */
        available() {
            if (state.backend) return true;
            const bridge = engineHttp();
            return !!(bridge && typeof bridge.available === 'function' && bridge.available());
        },

        /**
         * Точка подмены бэкенда для тестов: fn(request) → результат | null.
         * null означает «запрос ещё в работе»; tickHttp вызовет fn снова.
         *
         *   $.http._setBackend(() => ({ status: 200, body: '{}', headers: '' }));
         *   $.http._setBackend(null);   // вернуть настоящий движок
         */
        _setBackend(fn) {
            state.backend = typeof fn === 'function' ? fn : null;
            return http;
        },

        _backend() { return state.backend; },
    };

    http.del = http.delete;   // delete — слово языка: алиас для старых парсеров
    $.http = http;
    ctx.http = http;
    return http;
}
