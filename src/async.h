// ===========================================================================
// Асинхронный ввод-вывод и декодирование картинок (§45) — интерфейс.
//
// Рабочий поток читает файлы и декодирует картинки в RGBA8; главный поток
// забирает результаты и применяет их в безопасной фазе (GPU upload, установка
// JS-объектов). QuickJS из чужого потока не трогается.
// ===========================================================================

#ifndef R2D_ASYNC_H
#define R2D_ASYNC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct R2DApp R2DApp;
typedef struct R2DRenderer R2DRenderer;

enum {
    R2D_ASYNC_READ = 0,     // прочитать файл (текст/JSON/данные)
    R2D_ASYNC_IMAGE = 1,    // прочитать и декодировать картинку в RGBA8
};

/** Готовый результат: метаданные; тяжёлое забирается take_text/take_texture. */
typedef struct R2DAsyncResult {
    int         id;
    int         kind;
    bool        ok;
    bool        cancelled;
    bool        from_payload;
    size_t      size;        // размер файла / прочитанных байт
    int         width;
    int         height;
    char        path[512];
    char        error[256];
} R2DAsyncResult;

bool r2d_async_init(R2DApp *app);
void r2d_async_shutdown(void);

/** Размер файла без чтения (для точного progress в байтах); -1 — неизвестен. */
long long r2d_async_size(R2DApp *app, const char *path);

/** Поставить задание. Возвращает id (>0) или -1. */
int  r2d_async_request(R2DApp *app, const char *path, int kind);
/** Отменить задание: из очереди — сразу, идущее — по завершении шага. */
bool r2d_async_cancel(int id);

/** Забрать готовые результаты (метаданные). Возвращает число записей. */
int  r2d_async_poll(R2DAsyncResult *out, int max);
/** Текст результата (malloc) — владение переходит вызывающему; NULL, если нет. */
char *r2d_async_take_text(int id, size_t *size);
/** Поднять текстуру из декодированных пикселей и зарегистрировать путь.
 *  Только главный поток и безопасная фаза. -1 — не вышло. */
int  r2d_async_take_texture(int id, R2DRenderer *r);
/** Освободить результат, который игра не забрала (отмена, ошибка). */
void r2d_async_release(int id);
void r2d_async_stats(int *pending, int *done, int *failed, int *cancelled, long long *bytes);
/** Сколько рабочих потоков реально работает (0 — честная синхронная деградация). */
int  r2d_async_workers(void);

#endif
