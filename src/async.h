// ===========================================================================
// Асинхронный ввод-вывод и декодирование картинок (§45) — интерфейс.
//
// Рабочий поток читает файлы и декодирует картинки в RGBA8; главный поток
// забирает результаты и применяет их в безопасной фазе (GPU upload, установка
// JS-объектов). QuickJS и SDL_GPU из чужого потока не трогаются.
//
// Планировщик (§23, масштабирование движка) ведёт explicit-состояния задания:
//
//   QUEUED → RUNNING → READY → DELIVERED
//                  ↘ CANCELLED (ожидает выдачи) ↗
//
// «Outstanding» считаются все задания, ещё не выданные игре: QUEUED+RUNNING+
// READY. Готовые результаты живут в очереди применений; у неё есть high/low
// watermarks, и рабочий поток перестаёт брать новые задания, пока главный
// поток не разгрузит очередь ниже low. Успешная работа НИКОГДА не становится
// ошибкой из-за переполнения очереди — она ждёт.
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

// --- Пределы планировщика --------------------------------------------------
// Значения по умолчанию. Все они — «мягкие» границы: producer либо ждёт
// (block_producer, не главный поток), либо получает явную ошибку и -1; уже
// запущенная успешная работа не превращается в ошибку никогда.
#define R2D_ASYNC_DEFAULT_MAX_JOBS         256
#define R2D_ASYNC_DEFAULT_MAX_BYTES        (256LL * 1024 * 1024)
#define R2D_ASYNC_DEFAULT_MAX_READY        64
#define R2D_ASYNC_DEFAULT_MAX_READY_BYTES  (64LL * 1024 * 1024)
#define R2D_ASYNC_DEFAULT_WORKERS          1

// Больше потоков структурно поддерживается, но по умолчанию один: декод
// картинок не должен отбирать у кадра все ядра.
#define R2D_ASYNC_MAX_WORKERS 8

/** Явные состояния задания (одно на задание в любой момент). */
typedef enum R2DAsyncState {
    R2D_ASYNC_STATE_QUEUED = 0,   // в очереди, рабочий поток ещё не взял
    R2D_ASYNC_STATE_RUNNING = 1,  // читается/декодируется рабочим потоком
    R2D_ASYNC_STATE_READY = 2,    // готово, ждёт r2d_async_poll
    R2D_ASYNC_STATE_DELIVERED = 3,// выдано игре, ждёт take_*/release
    R2D_ASYNC_STATE_CANCELLED = 4 // отменено, ждёт выдачи как cancelled
} R2DAsyncState;

/** Настройки планировщика. 0 в любом поле means «значение по умолчанию». */
typedef struct R2DAsyncLimits {
    int       max_jobs;          // невыданных заданий (queued+running+ready)
    long long max_bytes;         // оценка байт невыданных заданий
    int       max_ready;         // high watermark очереди применений, шт.
    long long max_ready_bytes;   // high watermark очереди применений, байт
    int       ready_low;         // low watermark (0 => половина high)
    long long ready_low_bytes;   // low watermark в байтах (0 => половина high)
    int       workers;           // 1..R2D_ASYNC_MAX_WORKERS (0 => 1)
    // Ждать освобождения бюджета в r2d_async_request. Главный поток не ждёт
    // никогда (он же единственный, кто разгружает очередь через poll) —
    // вместо вечного ожидания он получает явную ошибку и -1.
    bool      block_producer;
} R2DAsyncLimits;

/** Снимок диагностики. Все счётчики — под mutex и согласованы между собой. */
typedef struct R2DAsyncPressure {
    int   queued;             // R2D_ASYNC_STATE_QUEUED
    int   running;            // R2D_ASYNC_STATE_RUNNING
    int   ready;              // R2D_ASYNC_STATE_READY (ещё не poll)
    int   delivered;          // R2D_ASYNC_STATE_DELIVERED (ждёт take/release)
    int   cancelled;          // всего отменено за жизнь (накопительно)
    int   cancelled_pending;  // CANCELLED в очереди применений (ещё не poll)

    int   outstanding;        // queued+running+ready
    int   live;               // outstanding+cancelled_pending (всё невыданное)
    int   peak_outstanding;
    int   peak_live;
    int   peak_ready;         // максимум длины очереди применений

    long long outstanding_bytes;   // оценка байт queued+running+ready
    long long live_bytes;          // + cancelled_pending
    long long ready_bytes;         // оценка байт всей очереди применений
    long long peak_outstanding_bytes;
    long long peak_live_bytes;
    long long peak_ready_bytes;

    long long done_bytes;          // суммарно прочитано/декодировано успешно
    long long backpressure_waits;  // сколько раз producer/worker ждал watermark
    long long backpressure_ms;     // суммарное ожидание, мс

    int workers;                   // реально запущенных потоков (0 — sync)
    // Действующие пределы (после применения defaults).
    int       max_jobs;
    long long max_bytes;
    int       max_ready;
    long long max_ready_bytes;
} R2DAsyncPressure;

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

/** Поставить задание. Возвращает id (>0) или -1.
 *
 *  При переполнении бюджета задание НЕ ставится: если block_producer и вызов
 *  не с главного потока — ждём освобождения; иначе — явная ошибка R2D_ERROR и
 *  -1. Уже начатая работа от этого не страдает. */
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

// --- Новый диагностический/настроечный интерфейс (обратная совместимость) ---

/** Заполнить структуру значениями по умолчанию. */
void r2d_async_limits_default(R2DAsyncLimits *out);
/** Применить новые пределы (0 => default, workers зажимается в 1..MAX).
 *  Изменение workers после init применяется только после перезапуска —
 *  об этом честно пишется в журнал. */
bool r2d_async_set_limits(const R2DAsyncLimits *limits);
/** Действующие пределы (с уже применёнными defaults). */
void r2d_async_get_limits(R2DAsyncLimits *out);
/** Снимок счётчиков/watermark-давления. Безопасен в любой момент, в т.ч.
 *  до init (вернёт нули) и после shutdown. */
void r2d_async_pressure(R2DAsyncPressure *out);

// --- Только для нативного теста tests/async/backpressure_test.c ------------
// Собирается с -DR2D_ASYNC_TEST: синтетическое задание без файла и GPU,
// чтобы детерминированно проверить состояния/watermarks/бюджеты.
#ifdef R2D_ASYNC_TEST
int  r2d_async_test_request(int kind, long long estimated_bytes, int work_ms, bool fail);
#endif

#endif
