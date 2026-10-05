// ===========================================================================
// Юнит-тест $.http без движка и без сети.
//
// Проверяем то, что можно проверить за секунды: сборка URL и заголовков,
// разбор сырых заголовков, форма ответа и — главное — очередь Promise:
// запрос ставится в очередь, не разрешается до готовности и всегда
// завершается (ответом, ошибкой или таймаутом).
//
// Реальная сеть подменяется через $.http._setBackend(fn): fn(request) → null
// означает «ещё не готово», любой объект — финальный ответ.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/http_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    buildUrl, normalizeHeaders, parseHeaders, makeResponse,
    installHttp, tickHttp,
} from '../../src/highlevel/http.js';

const $ = {};
installHttp($);

// --- Чистые помощники -------------------------------------------------------

test('buildUrl добавляет query с кодированием', () => {
    eq(buildUrl('http://a/b', { q: 'привет мир', n: 2 }), 'http://a/b?q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%D0%BC%D0%B8%D1%80&n=2');
    eq(buildUrl('http://a/b?x=1', { y: '2' }), 'http://a/b?x=1&y=2');
    eq(buildUrl('http://a/b', null), 'http://a/b');
    eq(buildUrl('http://a/b', {}), 'http://a/b');
    eq(buildUrl('http://a/b', { skip: undefined }), 'http://a/b');
});

test('buildUrl разворачивает массив значений в повторяющийся ключ', () => {
    eq(buildUrl('/s', { id: [1, 2] }), '/s?id=1&id=2');
});

test('normalizeHeaders принимает объект и плоский массив', () => {
    eq(normalizeHeaders({ 'X-A': '1', 'X-B': 2 }).join(','), 'X-A,1,X-B,2');
    eq(normalizeHeaders(['X-A', '1', 'X-B', '2']).join(','), 'X-A,1,X-B,2');
    eq(normalizeHeaders(null).length, 0);
    eq(normalizeHeaders(['X-A']).length, 0, 'нечётный массив отбрасывается');
});

test('parseHeaders даёт имена в нижнем регистре', () => {
    const raw = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Long: a: b\r\n\r\n';
    const headers = parseHeaders(raw);
    eq(headers['content-type'], 'application/json');
    eq(headers['x-long'], 'a: b');
});

test('parseHeaders оставляет заголовки финального ответа после редиректа', () => {
    const raw = 'HTTP/1.1 302 Found\r\nLocation: /next\r\nSet-Cookie: a=1\r\n\r\n' +
                'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n';
    const headers = parseHeaders(raw);
    eq(headers['content-type'], 'text/plain');
    eq(headers['location'], undefined, 'заголовки редиректа не должны протекать в ответ');
});

test('makeResponse собирает ответ, ok и text/json', () => {
    const res = makeResponse({ status: 201, body: '{"a":1}', headers: 'HTTP/1.1 201\r\n\r\n', timeMs: 7 },
                             'http://a/b');
    eq(res.status, 201);
    eq(res.ok, true);
    eq(res.text(), '{"a":1}');
    eq(res.json().a, 1);
    eq(res.timeMs, 7);
    eq(res.error, null);
    eq(res.url, 'http://a/b');

    const bad = makeResponse({ status: 404, body: 'нет', headers: '' }, 'http://a/404');
    eq(bad.ok, false);
    eq(bad.status, 404);
});

test('makeResponse на транспортной ошибке даёт status 0 и текст', () => {
    const res = makeResponse({ status: 0, error: 'нет соединения', body: '', headers: '' }, 'http://a/');
    eq(res.ok, false);
    eq(res.error, 'нет соединения');
    eq(res.status, 0);
    eq(res.text(), '');
});

// --- Публичная поверхность --------------------------------------------------

test('installHttp вешает ожидаемые методы', () => {
    for (const name of ['get', 'post', 'put', 'delete', 'del', 'request', 'json', 'text',
                        'download', 'pending', 'backend', 'available', '_setBackend']) {
        eq(typeof $.http[name], 'function', 'нет метода $.http.' + name);
    }
    eq($.http.pending(), 0);
    eq($.http.backend(), 'none', 'без движка бэкенд — none');
    falsy($.http.available(), 'без движка $.http.available() ложно');
});

// --- Очередь Promise через подменённый бэкенд -------------------------------

const captured = {};

test('запрос ждёт готовности и не разрешается до ответа бэкенда', () => {
    let calls = 0;
    $.http._setBackend((request) => {
        calls++;
        captured.request = request;
        if (calls < 2) return null;   // первый кадр — «ещё в работе»
        return {
            status: 200,
            body: '{"ok":true}',
            headers: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n',
            timeMs: 5,
        };
    });
    truthy($.http.available(), 'с подменой бэкенда доступность истинна');
    eq($.http.backend(), 'mock');

    $.http.get('http://local.test/data', { query: { a: '1' }, headers: { 'X-Test': 'yes' } })
        .then((res) => { captured.res = res; }, (err) => { captured.err = err; });

    eq($.http.pending(), 1, 'запрос встал в очередь');
    tickHttp(1 / 60);
    captured.after_first = $.http.pending();
    captured.resolved_first = captured.res !== undefined;
    tickHttp(1 / 60);
    captured.after_second = $.http.pending();
    captured.calls = calls;
});

// Даём микротаскам выполниться: Promise разрешается в tickHttp, а .then —
// следующим шагом очереди заданий QuickJS.
await null;
await null;

test('первый кадр не завершил запрос, второй — завершил', () => {
    eq(captured.calls, 2, 'бэкенд опрашивался каждый кадр');
    eq(captured.after_first, 1, 'после первого кадра запрос ещё в очереди');
    falsy(captured.resolved_first, 'Promise не должен был разрешиться до готовности');
    eq(captured.after_second, 0, 'после готовности запись ушла из очереди');
});

test('ответ разобран в объект с методами text/json', () => {
    truthy(captured.res, 'Promise должен разрешиться');
    falsy(captured.err, 'ошибки быть не должно');
    eq(captured.res.status, 200);
    eq(captured.res.ok, true);
    eq(captured.res.text(), '{"ok":true}');
    eq(captured.res.json().ok, true);
    eq(captured.res.headers['content-type'], 'application/json');
    eq(captured.res.url, 'http://local.test/data?a=1');
    near(captured.res.timeMs, 5);
});

test('запрос ушёл с методом, query и заголовками', () => {
    eq(captured.request.method, 'GET');
    eq(captured.request.url, 'http://local.test/data?a=1');
    eq(captured.request.headers.join(','), 'X-Test,yes');
});

// --- Тело запроса и JSON ----------------------------------------------------

test('post с объектом тела уходит как JSON с Content-Type', () => {
    let seen = null;
    $.http._setBackend((request) => { seen = request; return { status: 200, body: 'ok' }; });
    $.http.post('http://local.test/save', { hp: 42 });
    tickHttp(1 / 60);
    eq(seen.method, 'POST');
    eq(seen.body, '{"hp":42}');
    truthy(seen.headers.join(',').toLowerCase().includes('content-type,application/json'),
           'Content-Type: application/json должен подставиться');
});

test('opts.json сериализуется, opts.body как строка не трогается', () => {
    let seen = null;
    $.http._setBackend((request) => { seen = request; return { status: 201, body: '' }; });
    $.http.request({ url: 'http://local.test/a', method: 'put', json: { n: 1 } });
    tickHttp(1 / 60);
    eq(seen.method, 'PUT');
    eq(seen.body, '{"n":1}');
    $.http.request({ url: 'http://local.test/b', method: 'POST', body: 'raw' });
    tickHttp(1 / 60);
    eq(seen.body, 'raw');
});

// --- Ошибки не зависают -----------------------------------------------------

test('ошибка бэкенда отклоняет Promise с русским текстом', () => {
    $.http._setBackend(() => ({ status: 0, error: 'нет соединения с сервером' }));
    $.http.get('http://local.test/fail')
        .then(() => { captured.unexpected = true; }, (err) => { captured.reject_err = err; });
    tickHttp(1 / 60);
    eq($.http.pending(), 0, 'ошибка тоже завершает запись');
});

test('исключение бэкенда становится отклонённым Promise, а не падением кадра', () => {
    $.http._setBackend(() => { throw new Error('бэкенд сломался'); });
    $.http.request({ url: 'http://local.test/throw' })
        .then(() => { captured.unexpected2 = true; }, (err) => { captured.throw_err = err; });
    tickHttp(1 / 60);
    eq($.http.pending(), 0);
});

test('таймаут завершает зависший запрос', () => {
    $.http._setBackend(() => null);
    $.http.request({ url: 'http://local.test/slow', timeout: 100 })
        .then(() => { captured.unexpected3 = true; }, (err) => { captured.timeout_err = err; });
    eq($.http.pending(), 1);
    tickHttp(2.5);   // 2500 мс > 100 мс таймаута + запас
    captured.timeout_pending = $.http.pending();
});

// --- Без бэкенда ------------------------------------------------------------

test('без бэкенда запрос отклоняется сразу, а не висит', () => {
    $.http._setBackend(null);
    $.http.get('http://local.test/none')
        .then(() => { captured.unexpected4 = true; }, (err) => { captured.no_backend_err = err; });
    eq($.http.pending(), 0, 'без бэкенда в очередь ничего не попадает');
    falsy($.http.available());
    eq($.http.backend(), 'none');
});

test('пустой url отклоняется понятной ошибкой', () => {
    $.http._setBackend(() => ({ status: 200, body: '' }));
    $.http.get('')
        .then(() => { captured.unexpected5 = true; }, (err) => { captured.empty_url_err = err; });
    eq($.http.pending(), 0);
});

await null;
await null;
await null;

test('отклонённые Promise дошли до .catch с ожидаемым текстом', () => {
    truthy(captured.reject_err, 'ошибка бэкенда должна дойти до catch');
    truthy(captured.reject_err.message.startsWith('$.http: '), 'текст ошибки помечен подсистемой');
    truthy(captured.reject_err.message.includes('нет соединения'), 'причина ошибки сохранена');

    truthy(captured.throw_err, 'исключение бэкенда должно стать reject');
    truthy(captured.throw_err.message.includes('бэкенд сломался'));

    truthy(captured.timeout_err, 'таймаут должен отклонять Promise');
    truthy(captured.timeout_err.message.includes('таймаут'), 'текст про таймаут понятен');
    eq(captured.timeout_pending, 0, 'зависший запрос убран из очереди');

    truthy(captured.no_backend_err, 'запрос без бэкенда отклоняется');
    truthy(captured.no_backend_err.message.includes('бэкенд'), 'в тексте сказано про бэкенд');

    truthy(captured.empty_url_err, 'пустой url отклоняется');
    eq(captured.unexpected, undefined);
    eq(captured.unexpected2, undefined);
    eq(captured.unexpected3, undefined);
    eq(captured.unexpected4, undefined);
    eq(captured.unexpected5, undefined);
});

test('доступность снова false после снятия подмены', () => {
    $.http._setBackend(null);
    falsy($.http.available());
    eq($.http.backend(), 'none');
    eq($.http.pending(), 0);
});

finish();
