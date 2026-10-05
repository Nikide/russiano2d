# HTTP-запросы — `$.http`

`$.http` ходит в сеть так, чтобы не останавливать кадр: запрос ставится в
очередь, движок продвигает его по частям, а `Promise` разрешается в кадровом
`tickHttp()`. Игре не нужны ни колбэки, ни ручной опрос — только `.then()` или
`await`.

```js
$.ready(() => {
    $.http.get('http://localhost:8080/score')
        .then((res) => $.store.set('score', res.json().score))
        .catch((e) => $.log(e.message));
});

// то же самое, но по-современному
const level = await $.http.json('http://localhost:8080/level/1');
```

Подсистема не ходит в интернет сама по себе: всё, что делает игра, делает через
`$.http`. Если сети нет или сборка без HTTP, запрос **отклоняется** понятной
ошибкой — зависших `Promise` не бывает.

---

## 1. Быстрый старт

```js
// GET
const res = await $.http.get('http://localhost:8080/ping');
res.status;      // 200
res.ok;          // true
res.body;        // '{"pong":true}'
res.json();      // { pong: true }
res.headers;     // { 'content-type': 'application/json', ... }
res.timeMs;      // сколько занял запрос

// POST: объект уходит как JSON, Content-Type подставляется сам
await $.http.post('http://localhost:8080/save', { hp: 42, name: 'герой' });

// PUT / DELETE
await $.http.put('http://localhost:8080/item/1', { hp: 10 });
await $.http.delete('http://localhost:8080/item/1');

// JSON и текст — сразу тело
const data = await $.http.json('http://localhost:8080/level/1');
const html = await $.http.text('http://localhost:8080/page');

// скачать в файл рядом с игрой (нужен $.fs из модуля store)
await $.http.download('http://localhost:8080/pack.json', 'downloads/pack.json');
```

---

## 2. Методы

| Метод | Возвращает | Назначение |
|---|---|---|
| `$.http.get(url, opts?)` | `Promise<ответ>` | GET-запрос |
| `$.http.post(url, body?, opts?)` | `Promise<ответ>` | POST; `body` — строка или объект (→ JSON) |
| `$.http.put(url, body?, opts?)` | `Promise<ответ>` | PUT |
| `$.http.delete(url, opts?)` | `Promise<ответ>` | DELETE (алиас `$.http.del`) |
| `$.http.request(opts)` | `Promise<ответ>` | произвольный запрос; `opts.url` обязателен |
| `$.http.json(url, opts?)` | `Promise<any>` | запрос и `JSON.parse` тела |
| `$.http.text(url, opts?)` | `Promise<string>` | запрос и тело строкой |
| `$.http.download(url, path)` | `Promise<{path,bytes,status,response}>` | GET и запись тела в файл |
| `$.http.pending()` | `number` | сколько запросов ещё не завершено |
| `$.http.backend()` | `строка` | `'curl' \| 'socket' \| 'mock' \| 'none'` |
| `$.http.available()` | `bool` | есть ли чем выполнять запросы |
| `$.http._setBackend(fn)` | `$.http` | подмена бэкенда для тестов и офлайна |

`url` может быть и первым аргументом, и полем `opts`: `$.http.json({ url, method })`.

`download()` пишет тело **как текст** (UTF-8): так сохраняются JSON, тексты,
разметка и таблицы. Двоичные файлы (PNG, OGG, архивы) этим путём не скачать —
движок отдаёт тело строкой, и байты вне UTF-8 заменяются. Для картинок и
звука держите их в грузе или рядом с игрой.

---

## 3. `opts`

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `url` | строка | — | адрес; обязателен |
| `method` | строка | `'GET'` | `GET`, `POST`, `PUT`, `DELETE`, `PATCH`… |
| `headers` | объект/массив | — | `{ 'X-A': '1' }` или `['X-A', '1']` |
| `body` | строка/объект | — | строка как есть; объект → JSON |
| `json` | любое | — | сериализуется в тело, ставит `Content-Type: application/json` |
| `query` | объект | — | добавляется к URL: `{ q: 'да' }` → `?q=%D0%B4%D0%B0` |
| `timeout` | мс | `15000` | таймаут запроса; по истечении — `reject` |

```js
await $.http.post('http://localhost:8080/login',
    { user: 'кот' },
    { headers: { 'X-Game': 'demo' }, timeout: 3000, query: { v: 2 } });
```

---

## 4. Ответ

Все методы запроса разрешаются одним и тем же объектом:

| Поле/метод | Тип | Смысл |
|---|---|---|
| `status` | `number` | HTTP-код; `0`, если запрос не дошёл |
| `ok` | `bool` | `true` для 2xx |
| `body` | `string` | тело ответа как есть |
| `headers` | `object` | заголовки, имена в нижнем регистре |
| `error` | `string \| null` | текст ошибки транспорта, если была |
| `timeMs` | `number` | время запроса в миллисекундах |
| `url` | `string` | фактический URL (с query) |
| `text()` | `string` | тело строкой |
| `json()` | `any` | `JSON.parse(body)`; бросает на невалидном JSON |

HTTP-статус 4xx/5xx **не** отклоняет `Promise`: это состоявшийся запрос, и
игра сама решает, смотреть `res.ok` или нет. `reject` случается только при
транспортной ошибке (нет соединения, таймаут, невалидный URL, нет бэкенда) —
либо у `$.http.json()`, если тело не разобралось.

---

## 5. Ошибки и деградация

Текст ошибки всегда начинается с `$.http: ` и объясняет причину по-русски:

| Ситуация | Что в `reject` |
|---|---|
| нет соединения | `$.http: не удалось подключиться к серверу: …` |
| таймаут | `$.http: таймаут запроса` |
| невалидный URL | `$.http: невалидный URL: нужен http:// или https://` |
| HTTPS без libcurl | `$.http: https недоступен: движок собран без libcurl…` |
| HTTP выключен при сборке | `$.http: нет доступного HTTP-бэкенда — движок собран без HTTP` |
| тело не JSON | `$.http: ответ не является JSON: …` |

`Promise` завершается **всегда**: даже если бэкенда нет вовсе, запрос
отклоняется сразу на месте. Ошибка не роняет кадр — её достаточно поймать:

```js
$.http.get(url).catch((e) => $.log(e.message));
```

Сборка без libcurl оставляет аварийный сокетный бэкенд: он умеет только
`http://`, а на `https://` честно отвечает ошибкой.

---

## 6. Подмена бэкенда (тесты и офлайн)

`$.http._setBackend(fn)` заменяет настоящую сеть функцией
`fn(request) → результат | null`. `null` означает «запрос ещё в работе», и
`tickHttp()` вызовет `fn` снова — так проверяется очередь `Promise` без сети:

```js
$.http._setBackend(() => ({ status: 200, body: '{"n":5}', headers: '' }));
$.http.get('http://local.test/').then((r) => r.json().n);   // 5
$.http._setBackend(null);   // вернуть настоящий движок
```

`$.http.backend()` в этом режиме возвращает `'mock'`, `$.http.available()` —
`true`.

---

## 7. Как это устроено

```
$.http (src/highlevel/http.js)  ──►  engine.http.* (src/http.c)
        Promise-очередь                  неблокирующий клиент
        tickHttp(dt) каждый кадр          ├─ libcurl (curl_multi): http + https
                                          └─ встроенный сокет: только http
```

Низкоуровневый контракт — в `src/http.h`:

| Функция | Смысл |
|---|---|
| `r2d_http_init()` / `r2d_http_shutdown()` | поднять/остановить бэкенд |
| `r2d_http_request(method, url, body, names, values, count, timeout_ms)` | поставить запрос, вернуть `id` |
| `r2d_http_poll(id, out)` | забрать готовый результат (иначе `false`) |
| `r2d_http_cancel(id)` | отменить и освободить запись |
| `r2d_http_update()` | продвинуть все запросы; вызывается раз в кадр |
| `r2d_http_active()` / `r2d_http_available()` / `r2d_http_backend()` | состояние |
| `r2d_http_free(&result)` | освободить строки результата |

В JS видны `engine.http.request/poll/cancel/active/backend/available`.

---

## 8. Ограничения

* одновременно может висеть не больше 64 запросов; освобождение — `poll`/`cancel`;
* сокетный бэкенд (без libcurl) не умеет TLS, прокси и сжатие — только `http://`;
* редиректы ограничены пятью переходами;
* `download()` пишет файл через `$.fs` (модуль `store`) и перезаписывает его;
* `body` в ответе — строка; для бинарных данных игра сама решает, что с ней делать;
* модуль обязан инициализироваться без движка, поэтому `engine` трогается только
  внутри функций — это проверяет `tests/js/http_test.mjs`.
