// ===========================================================================
// HTTP-клиент для игрового API ($.http).
//
// Запросы асинхронные: r2d_http_request() только ставит задачу и возвращает
// id, а r2d_http_update() продвигает её каждый кадр. Игровой цикл не стоит.
//
// Бэкенд выбирается при сборке:
//   * libcurl (R2D_HTTP_WITH_CURL) — http и https, редиректы, заголовки;
//   * встроенный сокетный — только http://, без TLS (аварийный вариант,
//     когда libcurl не нашлась).
//
// Заголовок намеренно не тянет QuickJS: биндинги живут в http.c.
// ===========================================================================
#pragma once

#include <stdbool.h>
#include <stddef.h>

// Только предварительные объявления: http.h не тянет quickjs.h, но умеет
// объявить регистрацию engine.http.*.
typedef struct JSContext JSContext;
typedef struct JSValue JSValue;

#ifdef __cplusplus
extern "C" {
#endif

typedef struct R2DHttpResult {
    long   status;      // HTTP-код; 0 — запрос не дошёл
    char  *body;        // тело ответа (владеет вызывающий через r2d_http_free)
    size_t body_len;
    char  *headers;     // сырые заголовки ответа или NULL
    char  *error;       // текст ошибки или NULL
    double time_ms;     // сколько занял запрос
} R2DHttpResult;

// Инициализация/останов. Возвращает false, если бэкенда нет вовсе.
bool r2d_http_init(void);
void r2d_http_shutdown(void);

// Продвинуть все активные запросы. Вызывать раз в кадр.
void r2d_http_update(void);

// Поставить запрос. method — "GET"/"POST"/...; body может быть NULL.
// headers — массив имён и значений длиной header_count (может быть NULL).
// timeout_ms <= 0 — значение по умолчанию. Возвращает id >= 0 или -1.
int r2d_http_request(const char *method, const char *url, const char *body,
                     const char *const *header_names,
                     const char *const *header_values, int header_count,
                     double timeout_ms);

// Готов ли запрос. При true результат копируется в out (его надо освободить
// через r2d_http_free) и запись удаляется.
bool r2d_http_poll(int id, R2DHttpResult *out);

void r2d_http_cancel(int id);
int  r2d_http_active(void);
bool r2d_http_available(void);
const char *r2d_http_backend(void);   // "curl" | "socket" | "none"

// Освободить строки результата и обнулить структуру.
void r2d_http_free(R2DHttpResult *r);

// Регистрация engine.http.* в объекте engine (реализация в http.c).
void r2d_http_register_js(JSContext *ctx, JSValue engine);

#ifdef __cplusplus
}
#endif
