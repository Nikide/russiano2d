// ===========================================================================
// Асинхронный ввод-вывод и декодирование картинок — src/async.c
//
// Зачем: §45 требует, чтобы тяжёлое чтение и декодирование не блокировали кадр.
// §23 (масштабирование) добавляет к этому честный планировщик:
//
//   * явные состояния QUEUED → RUNNING → READY → DELIVERED и терминальное
//     CANCELLED; каждое задание находится ровно в одном из них;
//   * outstanding = QUEUED+RUNNING+READY, а не «сколько потоков занято»;
//   * готовые результаты лежат в очереди применений с high/low watermark:
//     рабочий поток перестаёт брать новые задания выше high и просыпается
//     только когда главный поток разгрузит очередь ниже low. Полная очередь
//     применений больше НЕ помечает успешную работу ошибкой;
//   * бюджеты max_jobs/max_bytes/max_ready/max_ready_bytes; при переполнении
//     producer либо ждёт на condition (block_producer и не главный поток),
//     либо получает явную ошибку и -1 — но начатая работа не страдает;
//   * worker pool структурно 1..N (по умолчанию 1); SDL_GPU и QuickJS из
//     рабочих потоков не трогаются вообще.
//
// Отмена: задание в очереди снимается сразу (и выдаётся как cancelled),
// идущее — доводится до конца и выбрасывается (decode не прервать).
//
// Если SDL_CreateThread недоступен (или поток не создался), модуль честно
// работает синхронно: задания выполняются в r2d_async_request на главном
// потоке, r2d_async_workers() возвращает 0.
// ===========================================================================

#include "async.h"

#ifndef R2D_ASYNC_TEST
#include "app.h"
#include "payload.h"
#include "render.h"
#else
#include "r2d.h"     // R2D_ERROR/R2D_WARN и базовые типы; без app/render/quickjs
#endif

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>

#include <limits.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Модель задания и глобальное состояние
// ---------------------------------------------------------------------------

typedef struct R2DAsyncJob {
    int            id;
    int            kind;
    R2DAsyncState  state;
    bool           cancelled;     // отменено (в т.ч. после выдачи — флаг для игры)
    bool           ok;
    bool           from_payload;
    size_t         size;          // размер файла / прочитанных байт
    long long      est_bytes;     // бюджетная оценка памяти задания
    int            width, height;
    char           path[512];     // путь, как его дала игра (для кэша текстур)
    char           full[4096];    // разрешённый путь на диске
    char           error[256];
    uint8_t       *vfs;           // байты из груза (владелец — главный поток)
    uint8_t       *text;          // прочитанный текст (владелец — результат)
    uint8_t       *pixels;        // RGBA8 после декодирования
    struct R2DAsyncJob *next;
#ifdef R2D_ASYNC_TEST
    // Синтетическое задание для нативного теста: без файла и GPU.
    int  test_work_ms;
    bool test_fail;
    bool test_synthetic;
#endif
} R2DAsyncJob;

static R2DApp *g_app = NULL;
static SDL_Thread *g_workers[R2D_ASYNC_MAX_WORKERS];
static int g_worker_count = 0;          // сколько реально запущено (0 — sync)
static SDL_Mutex *g_mutex = NULL;
static SDL_Condition *g_cond = NULL;
static bool g_stop = false;
static bool g_thread_ok = false;
static SDL_ThreadID g_main_thread = 0;
static int g_next_id = 1;
// Producers, находящиеся внутри r2d_async_request/enqueue_job. Нужны shutdown,
// чтобы не уничтожить mutex/condition под заблокированным на бюджете потоком.
static int g_active_producers = 0;

static R2DAsyncLimits g_limits = {
    R2D_ASYNC_DEFAULT_MAX_JOBS,
    R2D_ASYNC_DEFAULT_MAX_BYTES,
    R2D_ASYNC_DEFAULT_MAX_READY,
    R2D_ASYNC_DEFAULT_MAX_READY_BYTES,
    R2D_ASYNC_DEFAULT_MAX_READY / 2,
    R2D_ASYNC_DEFAULT_MAX_READY_BYTES / 2,
    R2D_ASYNC_DEFAULT_WORKERS,
    false,          // block_producer: по умолчанию главный поток не блокируем
};

// Списки. Все переходы — под g_mutex.
static R2DAsyncJob *g_queue = NULL;
static R2DAsyncJob *g_queue_tail = NULL;
static R2DAsyncJob *g_running_list = NULL;
static R2DAsyncJob *g_ready = NULL;        // READY + CANCELLED (ждут poll)
static R2DAsyncJob *g_ready_tail = NULL;
static R2DAsyncJob *g_released = NULL;     // DELIVERED (ждут take_*/release)
static R2DAsyncJob *g_released_tail = NULL;

// Счётчики состояний/байт. Outstanding = queued+running+ready.
static int g_queued_jobs = 0;
static int g_running_jobs = 0;
static int g_ready_jobs = 0;
static int g_cancelled_pending = 0;        // CANCELLED в очереди применений
static int g_delivered_jobs = 0;
static long long g_queued_bytes = 0;
static long long g_running_bytes = 0;
static long long g_ready_bytes = 0;
static long long g_cancelled_bytes = 0;
static long long g_delivered_bytes = 0;

// Пики/диагностика.
static int g_peak_outstanding = 0;
static int g_peak_live = 0;
static int g_peak_ready = 0;
static long long g_peak_outstanding_bytes = 0;
static long long g_peak_live_bytes = 0;
static long long g_peak_ready_bytes = 0;
static long long g_bp_waits = 0;
static long long g_bp_ms = 0;

// Накопительная статистика (совместимость r2d_async_stats).
static int g_stat_done = 0;
static int g_stat_failed = 0;
static int g_stat_cancelled = 0;
static long long g_stat_bytes = 0;

// ---------------------------------------------------------------------------
// Платформенные зависимости: под R2D_ASYNC_TEST они не тянут движок.
// ---------------------------------------------------------------------------

static bool async_vfs_has(const char *path)
{
#ifdef R2D_ASYNC_TEST
    (void)path;
    return false;
#else
    return r2d_vfs_has(path);
#endif
}

static uint8_t *async_vfs_read(const char *path, size_t *size)
{
#ifdef R2D_ASYNC_TEST
    (void)path; (void)size;
    return NULL;
#else
    return r2d_vfs_read(path, size);
#endif
}

static void async_vfs_free(uint8_t *data)
{
    if (!data) return;
#ifdef R2D_ASYNC_TEST
    free(data);
#else
    r2d_vfs_free(data);
#endif
}

static void async_resolve_path(R2DApp *app, char *out, size_t out_size, const char *path)
{
#ifdef R2D_ASYNC_TEST
    (void)app;
    SDL_snprintf(out, out_size, "%s", path ? path : "");
#else
    if (app) r2d_app_resolve_path(app, out, out_size, path);
    else out[0] = 0;
#endif
}

// ---------------------------------------------------------------------------
// Списки/учёт (все функции — под g_mutex, если не сказано иное)
// ---------------------------------------------------------------------------

static void update_peaks_locked(void)
{
    const int outstanding = g_queued_jobs + g_running_jobs + g_ready_jobs;
    const int live = outstanding + g_cancelled_pending;
    const long long outstanding_bytes = g_queued_bytes + g_running_bytes + g_ready_bytes;
    const long long live_bytes = outstanding_bytes + g_cancelled_bytes;
    const int ready_list = g_ready_jobs + g_cancelled_pending;
    const long long ready_list_bytes = g_ready_bytes + g_cancelled_bytes;

    if (outstanding > g_peak_outstanding) g_peak_outstanding = outstanding;
    if (live > g_peak_live) g_peak_live = live;
    if (outstanding_bytes > g_peak_outstanding_bytes) g_peak_outstanding_bytes = outstanding_bytes;
    if (live_bytes > g_peak_live_bytes) g_peak_live_bytes = live_bytes;
    if (ready_list > g_peak_ready) g_peak_ready = ready_list;
    if (ready_list_bytes > g_peak_ready_bytes) g_peak_ready_bytes = ready_list_bytes;
}

static void accounting_add(R2DAsyncState state, long long bytes)
{
    if (bytes < 0) bytes = 0;
    switch (state) {
    case R2D_ASYNC_STATE_QUEUED:
        g_queued_jobs++; g_queued_bytes += bytes; break;
    case R2D_ASYNC_STATE_RUNNING:
        g_running_jobs++; g_running_bytes += bytes; break;
    case R2D_ASYNC_STATE_READY:
        g_ready_jobs++; g_ready_bytes += bytes; break;
    case R2D_ASYNC_STATE_CANCELLED:
        g_cancelled_pending++; g_cancelled_bytes += bytes; break;
    case R2D_ASYNC_STATE_DELIVERED:
        g_delivered_jobs++; g_delivered_bytes += bytes; break;
    }
    update_peaks_locked();
}

static void accounting_sub(R2DAsyncState state, long long bytes)
{
    if (bytes < 0) bytes = 0;
    switch (state) {
    case R2D_ASYNC_STATE_QUEUED:
        g_queued_jobs--; g_queued_bytes -= bytes; break;
    case R2D_ASYNC_STATE_RUNNING:
        g_running_jobs--; g_running_bytes -= bytes; break;
    case R2D_ASYNC_STATE_READY:
        g_ready_jobs--; g_ready_bytes -= bytes; break;
    case R2D_ASYNC_STATE_CANCELLED:
        g_cancelled_pending--; g_cancelled_bytes -= bytes; break;
    case R2D_ASYNC_STATE_DELIVERED:
        g_delivered_jobs--; g_delivered_bytes -= bytes; break;
    }
    if (g_queued_jobs < 0) g_queued_jobs = 0;
    if (g_running_jobs < 0) g_running_jobs = 0;
    if (g_ready_jobs < 0) g_ready_jobs = 0;
    if (g_cancelled_pending < 0) g_cancelled_pending = 0;
    if (g_delivered_jobs < 0) g_delivered_jobs = 0;
    if (g_queued_bytes < 0) g_queued_bytes = 0;
    if (g_running_bytes < 0) g_running_bytes = 0;
    if (g_ready_bytes < 0) g_ready_bytes = 0;
    if (g_cancelled_bytes < 0) g_cancelled_bytes = 0;
    if (g_delivered_bytes < 0) g_delivered_bytes = 0;
}

static int live_jobs_locked(void)
{
    return g_queued_jobs + g_running_jobs + g_ready_jobs + g_cancelled_pending;
}

static long long live_bytes_locked(void)
{
    return g_queued_bytes + g_running_bytes + g_ready_bytes + g_cancelled_bytes;
}

static int outstanding_jobs_locked(void)
{
    return g_queued_jobs + g_running_jobs + g_ready_jobs;
}

static long long outstanding_bytes_locked(void)
{
    return g_queued_bytes + g_running_bytes + g_ready_bytes;
}

static int ready_list_jobs_locked(void)
{
    return g_ready_jobs + g_cancelled_pending;
}

static long long ready_list_bytes_locked(void)
{
    return g_ready_bytes + g_cancelled_bytes;
}

static void job_free(R2DAsyncJob *job)
{
    if (!job) return;
    free(job->text);
    free(job->pixels);
    async_vfs_free(job->vfs);
    free(job);
}

static void job_drop_buffers(R2DAsyncJob *job)
{
    if (!job) return;
    free(job->text);
    free(job->pixels);
    async_vfs_free(job->vfs);
    job->text = NULL;
    job->pixels = NULL;
    job->vfs = NULL;
}

static void queue_push(R2DAsyncJob *job)
{
    job->next = NULL;
    if (g_queue_tail) g_queue_tail->next = job;
    else g_queue = job;
    g_queue_tail = job;
}

static R2DAsyncJob *queue_pop(void)
{
    R2DAsyncJob *job = g_queue;
    if (!job) return NULL;
    g_queue = job->next;
    if (!g_queue) g_queue_tail = NULL;
    job->next = NULL;
    return job;
}

static bool queue_remove(int id, R2DAsyncJob **out)
{
    R2DAsyncJob *prev = NULL;
    R2DAsyncJob *cur = g_queue;
    while (cur) {
        if (cur->id == id) {
            if (prev) prev->next = cur->next;
            else g_queue = cur->next;
            if (g_queue_tail == cur) g_queue_tail = prev;
            cur->next = NULL;
            if (out) *out = cur;
            return true;
        }
        prev = cur;
        cur = cur->next;
    }
    return false;
}

static void running_add(R2DAsyncJob *job)
{
    job->next = g_running_list;
    g_running_list = job;
}

static void running_remove(R2DAsyncJob *job)
{
    R2DAsyncJob **link = &g_running_list;
    while (*link) {
        if (*link == job) { *link = job->next; job->next = NULL; return; }
        link = &(*link)->next;
    }
}

static void ready_push(R2DAsyncJob *job)
{
    job->next = NULL;
    if (g_ready_tail) g_ready_tail->next = job;
    else g_ready = job;
    g_ready_tail = job;
}

static R2DAsyncJob *ready_pop(void)
{
    R2DAsyncJob *job = g_ready;
    if (!job) return NULL;
    g_ready = job->next;
    if (!g_ready) g_ready_tail = NULL;
    job->next = NULL;
    return job;
}

static void delivered_push(R2DAsyncJob *job)
{
    job->next = NULL;
    if (g_released_tail) g_released_tail->next = job;
    else g_released = job;
    g_released_tail = job;
}

static bool delivered_remove(int id, R2DAsyncJob **out)
{
    R2DAsyncJob *prev = NULL;
    R2DAsyncJob *cur = g_released;
    while (cur) {
        if (cur->id == id) {
            if (prev) prev->next = cur->next;
            else g_released = cur->next;
            if (g_released_tail == cur) g_released_tail = prev;
            cur->next = NULL;
            accounting_sub(R2D_ASYNC_STATE_DELIVERED, cur->est_bytes);
            if (out) *out = cur;
            return true;
        }
        prev = cur;
        cur = cur->next;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Оценка памяти задания
// ---------------------------------------------------------------------------

static uint32_t be32(const uint8_t *p)
{
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
           ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

// PNG: ширина/высота лежат в IHDR (offset 16/20). Для прочих форматов честно
// даём грубую оценку по размеру файла (RGBA обычно больше сжатого файла).
static long long estimate_image_bytes(const uint8_t *head, size_t head_len, size_t file_size)
{
    static const uint8_t png_sig[8] = { 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A };
    if (head && head_len >= 24 && memcmp(head, png_sig, sizeof png_sig) == 0) {
        const uint32_t w = be32(head + 16);
        const uint32_t h = be32(head + 20);
        if (w > 0 && h > 0 && w <= 65535u && h <= 65535u) {
            const unsigned long long px = (unsigned long long)w * (unsigned long long)h * 4ULL;
            if (px <= (unsigned long long)LLONG_MAX) return (long long)px;
        }
    }
    unsigned long long est = (unsigned long long)file_size * 4ULL;
    if (est < (unsigned long long)file_size) est = file_size;
    if (est > (unsigned long long)LLONG_MAX) est = (unsigned long long)LLONG_MAX;
    return (long long)est;
}

static void probe_header(const char *path, uint8_t *head, size_t head_size, size_t *out_len)
{
    *out_len = 0;
    if (!path || !*path || head_size == 0) return;
    SDL_IOStream *io = SDL_IOFromFile(path, "rb");
    if (!io) return;
    *out_len = SDL_ReadIO(io, head, head_size);
    SDL_CloseIO(io);
}

static long long estimate_request_bytes(int kind, const char *full,
                                        const uint8_t *vfs, size_t vfs_size,
                                        size_t file_size, bool have_file)
{
    if (kind != R2D_ASYNC_IMAGE) {
        return have_file ? (long long)file_size : 0;
    }
    if (have_file && file_size == 0) return 0;
    if (vfs) return estimate_image_bytes(vfs, vfs_size, vfs_size);
    uint8_t head[24];
    size_t head_len = 0;
    probe_header(full, head, sizeof head, &head_len);
    return estimate_image_bytes(head, head_len, file_size);
}

// После выполнения оценка уточняется: для картинки — точные пиксели.
static long long estimate_after_run(const R2DAsyncJob *job)
{
    if (job->kind == R2D_ASYNC_IMAGE && job->width > 0 && job->height > 0) {
        const unsigned long long px = (unsigned long long)job->width *
                                      (unsigned long long)job->height * 4ULL;
        if (px <= (unsigned long long)LLONG_MAX) return (long long)px;
        return LLONG_MAX;
    }
    if (job->size > 0) return (long long)job->size;
    return job->est_bytes > 0 ? job->est_bytes : 0;
}

// ---------------------------------------------------------------------------
// Работа: чтение и декодирование (в рабочем потоке)
// ---------------------------------------------------------------------------

static bool job_read_bytes(R2DAsyncJob *job, uint8_t **out, size_t *out_size)
{
    if (job->vfs) {                       // груз: байты уже в памяти
        *out = job->vfs;
        *out_size = job->size;
        return true;
    }
    size_t size = 0;
    char *data = (char *)SDL_LoadFile(job->full, &size);
    if (!data) {
        SDL_snprintf(job->error, sizeof job->error, "не удалось прочитать \"%s\": %s",
                     job->path, SDL_GetError());
        return false;
    }
    *out = (uint8_t *)data;
    *out_size = size;
    return true;
}

static bool job_run(R2DAsyncJob *job)
{
#ifdef R2D_ASYNC_TEST
    if (job->test_synthetic) {
        if (job->test_work_ms > 0) SDL_Delay((Uint32)job->test_work_ms);
        if (job->test_fail) {
            SDL_snprintf(job->error, sizeof job->error, "синтетическая ошибка задания");
            return false;
        }
        job->size = job->est_bytes > 0 ? (size_t)job->est_bytes : 0;
        return true;
    }
#endif

    uint8_t *bytes = NULL;
    size_t size = 0;
    if (!job_read_bytes(job, &bytes, &size)) return false;
    job->size = size;

    if (job->kind == R2D_ASYNC_READ) {
        // SDL_LoadFile уже даёт буфер с завершающим нулём; для груза копируем,
        // чтобы владелец результата был один и его можно было освободить.
        if (job->from_payload) {
            uint8_t *copy = (uint8_t *)malloc(size + 1);
            if (!copy) {
                SDL_snprintf(job->error, sizeof job->error, "нет памяти под \"%s\"", job->path);
                return false;
            }
            memcpy(copy, bytes, size);
            copy[size] = 0;
            job->text = copy;
            // bytes == job->vfs: владелец — задание, освободится в job_free.
        } else {
            job->text = bytes;             // владение переходит результату
            bytes = NULL;
        }
        return true;
    }

    // Картинка: декодирование целиком здесь (IMG_Load_IO + конвертация в RGBA8).
    // IMG_Load_IO(..., closeio=true) сам закрывает поток — SDL_CloseIO здесь
    // был бы double-free (нашёл AddressSanitizer нативного теста).
    SDL_IOStream *io = SDL_IOFromConstMem(bytes, size);
    SDL_Surface *loaded = io ? IMG_Load_IO(io, true) : NULL;
    if (!job->from_payload) {              // байты файла больше не нужны
        SDL_free(bytes);
        bytes = NULL;
    }
    if (!loaded) {
        SDL_snprintf(job->error, sizeof job->error, "картинка \"%s\" не декодировалась: %s",
                     job->path, SDL_GetError());
        return false;
    }
    SDL_Surface *rgba = loaded;
    if (loaded->format != SDL_PIXELFORMAT_RGBA32) {
        rgba = SDL_ConvertSurface(loaded, SDL_PIXELFORMAT_RGBA32);
        if (!rgba) {
            SDL_snprintf(job->error, sizeof job->error, "SDL_ConvertSurface(\"%s\"): %s",
                         job->path, SDL_GetError());
            SDL_DestroySurface(loaded);
            return false;
        }
    }
    const size_t row = (size_t)rgba->w * 4;
    uint8_t *pixels = (uint8_t *)malloc(row * (size_t)rgba->h);
    if (!pixels) {
        SDL_snprintf(job->error, sizeof job->error, "нет памяти под пиксели \"%s\"", job->path);
        if (rgba != loaded) SDL_DestroySurface(rgba);
        SDL_DestroySurface(loaded);
        return false;
    }
    const uint8_t *src = (const uint8_t *)rgba->pixels;
    for (int y = 0; y < rgba->h; ++y) {
        memcpy(pixels + (size_t)y * row, src + (size_t)y * rgba->pitch, row);
    }
    job->pixels = pixels;
    job->width = rgba->w;
    job->height = rgba->h;
    if (rgba != loaded) SDL_DestroySurface(rgba);
    SDL_DestroySurface(loaded);
    return true;
}

// ---------------------------------------------------------------------------
// Watermarks и бюджеты (под g_mutex)
// ---------------------------------------------------------------------------

static bool worker_has_ready_space_locked(void)
{
    return ready_list_jobs_locked() < g_limits.max_ready &&
           ready_list_bytes_locked() < g_limits.max_ready_bytes;
}

static bool worker_below_low_locked(void)
{
    return ready_list_jobs_locked() <= g_limits.ready_low &&
           ready_list_bytes_locked() <= g_limits.ready_low_bytes;
}

static void worker_wait_for_ready_space_locked(void)
{
    if (worker_has_ready_space_locked()) return;
    const Uint64 start = SDL_GetTicks();
    g_bp_waits++;
    // Никаких busy sleep: спим на condition, просыпаемся от poll/cancel/stop.
    while (!g_stop && !worker_below_low_locked()) {
        SDL_WaitCondition(g_cond, g_mutex);
    }
    g_bp_ms += (long long)(SDL_GetTicks() - start);
}

static bool budget_available_locked(long long add_bytes)
{
    if (g_limits.max_jobs > 0 && live_jobs_locked() + 1 > g_limits.max_jobs) return false;
    if (g_limits.max_bytes > 0 && live_bytes_locked() + add_bytes > g_limits.max_bytes) return false;
    return true;
}

// Проверка бюджета перед постановкой. Может подождать (не главный поток),
// но никогда не ждёт главный: он же единственный, кто разгружает poll.
static bool admit_locked(const R2DAsyncJob *job)
{
    long long add = job->est_bytes;
    if (add < 0) add = 0;
    if (g_limits.max_bytes > 0 && add > g_limits.max_bytes) {
        R2D_ERROR("async: задание \"%s\" (%lld байт) больше бюджета max_bytes=%lld",
                  job->path, add, g_limits.max_bytes);
        return false;
    }
    bool waited = false;
    Uint64 start = 0;
    while (!budget_available_locked(add)) {
        if (g_stop) return false;
        if (!g_limits.block_producer || SDL_GetCurrentThreadID() == g_main_thread) {
            R2D_ERROR("async: бюджет исчерпан (live %d/%d заданий, %lld/%lld байт, "
                      "нужно ещё %lld) — задание \"%s\" отклонено; сначала poll/release",
                      live_jobs_locked(), g_limits.max_jobs,
                      live_bytes_locked(), g_limits.max_bytes, add, job->path);
            return false;
        }
        if (!waited) {
            waited = true;
            start = SDL_GetTicks();
            g_bp_waits++;
        }
        SDL_WaitCondition(g_cond, g_mutex);
    }
    if (waited) g_bp_ms += (long long)(SDL_GetTicks() - start);
    return true;
}

// ---------------------------------------------------------------------------
// Рабочий поток
// ---------------------------------------------------------------------------

static R2DAsyncState finalize_state_locked(R2DAsyncJob *job, bool ok)
{
    if (job->cancelled) {
        job->ok = false;
        return R2D_ASYNC_STATE_CANCELLED;
    }
    if (ok) {
        job->ok = true;
        g_stat_done++;
        g_stat_bytes += (long long)job->size;
        return R2D_ASYNC_STATE_READY;
    }
    job->ok = false;
    g_stat_failed++;
    return R2D_ASYNC_STATE_READY;
}

static void complete_job_locked(R2DAsyncJob *job, bool ok)
{
    // Снять RUNNING и уточнить оценку уже после декодирования.
    accounting_sub(R2D_ASYNC_STATE_RUNNING, job->est_bytes);
    job->est_bytes = estimate_after_run(job);
    job->state = finalize_state_locked(job, ok);
    accounting_add(job->state, job->est_bytes);
    ready_push(job);
    SDL_BroadcastCondition(g_cond);
}

static int SDLCALL worker_main(void *arg)
{
    const int index = (int)(intptr_t)arg;
    (void)index;
    SDL_LockMutex(g_mutex);
    for (;;) {
        while (!g_stop && !g_queue) SDL_WaitCondition(g_cond, g_mutex);
        if (g_stop) break;

        // Backpressure: выше high watermark новых заданий не берём.
        if (!worker_has_ready_space_locked()) {
            worker_wait_for_ready_space_locked();
            if (g_stop) break;
            continue;
        }

        R2DAsyncJob *job = queue_pop();
        if (!job) continue;

        accounting_sub(R2D_ASYNC_STATE_QUEUED, job->est_bytes);
        job->state = R2D_ASYNC_STATE_RUNNING;
        accounting_add(R2D_ASYNC_STATE_RUNNING, job->est_bytes);
        running_add(job);

        SDL_UnlockMutex(g_mutex);
        const bool ok = job_run(job);
        SDL_LockMutex(g_mutex);

        running_remove(job);
        complete_job_locked(job, ok);
    }
    SDL_UnlockMutex(g_mutex);
    return 0;
}

// ---------------------------------------------------------------------------
// Постановка задания и публичный интерфейс
// ---------------------------------------------------------------------------

// Ставит job в планировщик. Владение переходит сюда в любом случае: при
// отказе job освобождается. Возвращает id (>0) или -1.
static int enqueue_job(R2DAsyncJob *job, bool immediate_failed)
{
    int result = -1;
    SDL_LockMutex(g_mutex);
    g_active_producers++;
    if (g_stop || !admit_locked(job)) {
        job_free(job);
        goto done;
    }
    job->id = g_next_id++;
    result = job->id;

    if (immediate_failed) {
        job->state = R2D_ASYNC_STATE_READY;
        job->ok = false;
        g_stat_failed++;
        accounting_add(R2D_ASYNC_STATE_READY, job->est_bytes);
        ready_push(job);
        SDL_BroadcastCondition(g_cond);
    } else if (!g_thread_ok) {
        // Без потока: выполняем сразу здесь — JS всё равно получит результат,
        // но кадр на это время встанет (об этом честно скажет workers()).
        job->state = R2D_ASYNC_STATE_RUNNING;
        accounting_add(R2D_ASYNC_STATE_RUNNING, job->est_bytes);
        SDL_UnlockMutex(g_mutex);
        const bool ok = job_run(job);
        SDL_LockMutex(g_mutex);
        complete_job_locked(job, ok);
    } else {
        job->state = R2D_ASYNC_STATE_QUEUED;
        accounting_add(R2D_ASYNC_STATE_QUEUED, job->est_bytes);
        queue_push(job);
        SDL_BroadcastCondition(g_cond);
    }
done:
    g_active_producers--;
    SDL_BroadcastCondition(g_cond);
    SDL_UnlockMutex(g_mutex);
    return result;
}

bool r2d_async_init(R2DApp *app)
{
    if (g_mutex) { g_app = app; return true; }
    g_app = app;
    g_main_thread = SDL_GetCurrentThreadID();

    // Свежий запуск: накопительная статистика прошлой сессии не должна
    // протекать в диагностику нового запуска (важно и для нативных тестов).
    g_stat_done = g_stat_failed = g_stat_cancelled = 0;
    g_stat_bytes = 0;
    g_bp_waits = g_bp_ms = 0;
    g_peak_outstanding = g_peak_live = g_peak_ready = 0;
    g_peak_outstanding_bytes = g_peak_live_bytes = g_peak_ready_bytes = 0;
    g_active_producers = 0;

    g_mutex = SDL_CreateMutex();
    g_cond = SDL_CreateCondition();
    if (!g_mutex || !g_cond) {
        R2D_ERROR("async: не удалось создать mutex/condition: %s", SDL_GetError());
        if (g_cond) SDL_DestroyCondition(g_cond);
        if (g_mutex) SDL_DestroyMutex(g_mutex);
        g_cond = NULL;
        g_mutex = NULL;
        return false;
    }

    int want = g_limits.workers;
    if (want < 1) want = 1;
    if (want > R2D_ASYNC_MAX_WORKERS) want = R2D_ASYNC_MAX_WORKERS;

    g_stop = false;
    g_worker_count = 0;
    g_thread_ok = false;
    bool failed = false;
    for (int i = 0; i < want; ++i) {
        g_workers[i] = SDL_CreateThread(worker_main, "r2d_async", (void *)(intptr_t)i);
        if (!g_workers[i]) { failed = true; break; }
        g_worker_count++;
    }
    if (failed) {
        R2D_ERROR("async: SDL_CreateThread не удался (%s) — честный синхронный режим",
                  SDL_GetError());
        SDL_LockMutex(g_mutex);
        g_stop = true;
        SDL_BroadcastCondition(g_cond);
        SDL_UnlockMutex(g_mutex);
        for (int i = 0; i < g_worker_count; ++i) {
            if (g_workers[i]) { SDL_WaitThread(g_workers[i], NULL); g_workers[i] = NULL; }
        }
        g_worker_count = 0;
        g_stop = false;
        g_thread_ok = false;
    } else {
        g_thread_ok = g_worker_count > 0;
    }
    return g_cond != NULL;
}

void r2d_async_shutdown(void)
{
    if (!g_mutex) return;
    SDL_LockMutex(g_mutex);
    g_stop = true;
    SDL_BroadcastCondition(g_cond);
    // Дать заблокированным producer'ам выйти из condition до уничтожения
    // mutex/condition (иначе — use-after-destroy).
    while (g_active_producers > 0) SDL_WaitCondition(g_cond, g_mutex);
    SDL_UnlockMutex(g_mutex);

    for (int i = 0; i < g_worker_count; ++i) {
        if (g_workers[i]) { SDL_WaitThread(g_workers[i], NULL); g_workers[i] = NULL; }
    }
    g_worker_count = 0;
    g_thread_ok = false;

    // По этому моменту рабочих потоков нет — освобождаем всё ровно один раз.
    while (g_queue) job_free(queue_pop());
    while (g_ready) job_free(ready_pop());
    while (g_released) {
        R2DAsyncJob *job = g_released;
        g_released = job->next;
        job->next = NULL;
        job_free(job);
    }
    g_released_tail = NULL;
    while (g_running_list) {              // защита: потоков уже нет
        R2DAsyncJob *job = g_running_list;
        g_running_list = job->next;
        job->next = NULL;
        job_free(job);
    }

    g_queued_jobs = g_running_jobs = g_ready_jobs = 0;
    g_cancelled_pending = g_delivered_jobs = 0;
    g_queued_bytes = g_running_bytes = g_ready_bytes = 0;
    g_cancelled_bytes = g_delivered_bytes = 0;
    g_peak_outstanding = g_peak_live = g_peak_ready = 0;
    g_peak_outstanding_bytes = g_peak_live_bytes = g_peak_ready_bytes = 0;

    SDL_DestroyCondition(g_cond);
    SDL_DestroyMutex(g_mutex);
    g_cond = NULL;
    g_mutex = NULL;
    g_thread_ok = false;
    g_stop = false;
    g_main_thread = 0;
}

long long r2d_async_size(R2DApp *app, const char *path)
{
    if (!path) return -1;
    if (async_vfs_has(path)) {
        size_t size = 0;
        uint8_t *data = async_vfs_read(path, &size);
        if (!data) return -1;
        async_vfs_free(data);
        return (long long)size;
    }
    if (!app) {
#ifdef R2D_ASYNC_TEST
        SDL_PathInfo info;
        if (!SDL_GetPathInfo(path, &info) || info.type != SDL_PATHTYPE_FILE) return -1;
        return (long long)info.size;
#else
        return -1;
#endif
    }
    char full[4096];
    async_resolve_path(app, full, sizeof full, path);
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info) || info.type != SDL_PATHTYPE_FILE) return -1;
    return (long long)info.size;
}

int r2d_async_request(R2DApp *app, const char *path, int kind)
{
    if (!path || !*path) return -1;
    if (!g_mutex && !r2d_async_init(app)) return -1;

    R2DAsyncJob *job = (R2DAsyncJob *)calloc(1, sizeof(R2DAsyncJob));
    if (!job) {
        R2D_ERROR("async: нет памяти под задание \"%s\"", path);
        return -1;
    }
    job->kind = kind;
    SDL_snprintf(job->path, sizeof job->path, "%s", path);

    // Разрешённый путь нужен и для чтения с диска, и для регистрации текстуры
    // в кэше ядра: engine.loadTexture кэширует по АБСОЛЮТНОМУ пути.
    async_resolve_path(app, job->full, sizeof job->full, path);

    bool immediate_failed = false;
    size_t file_size = 0;
    bool have_file = false;

    if (async_vfs_has(path)) {
        size_t size = 0;
        uint8_t *data = async_vfs_read(path, &size);
        if (!data) {
            R2D_ERROR("async: не удалось прочитать груз \"%s\"", path);
            free(job);
            return -1;
        }
        job->vfs = data;
        job->from_payload = true;
        job->size = size;
        file_size = size;
        have_file = true;
    } else {
#ifndef R2D_ASYNC_TEST
        // Старое поведение: без приложения путь не разрешить — сразу -1.
        if (!app) {
            R2D_ERROR("async: нет приложения, чтобы разрешить путь \"%s\"", path);
            free(job);
            return -1;
        }
#endif
        SDL_PathInfo info;
        const char *stat_path = job->full[0] ? job->full : path;
        if (!SDL_GetPathInfo(stat_path, &info) || info.type != SDL_PATHTYPE_FILE) {
            SDL_snprintf(job->error, sizeof job->error, "файл \"%s\" не найден", path);
            immediate_failed = true;
        } else {
            file_size = (size_t)info.size;
            have_file = true;
            job->size = file_size;           // размер известен до чтения
        }
    }

    job->est_bytes = immediate_failed ? (long long)file_size
                                      : estimate_request_bytes(kind, job->full, job->vfs,
                                                               job->size, file_size, have_file);
    if (job->est_bytes < 0) job->est_bytes = 0;

    return enqueue_job(job, immediate_failed);
}

bool r2d_async_cancel(int id)
{
    if (!g_mutex) return false;
    bool found = false;
    SDL_LockMutex(g_mutex);

    // 1. В очереди: снимаем сразу, освобождаем тяжёлые буферы, выдаём cancelled.
    R2DAsyncJob *job = NULL;
    if (queue_remove(id, &job)) {
        accounting_sub(R2D_ASYNC_STATE_QUEUED, job->est_bytes);
        job_drop_buffers(job);
        job->est_bytes = 0;              // памяти под результат больше нет
        job->cancelled = true;
        job->ok = false;
        job->state = R2D_ASYNC_STATE_CANCELLED;
        g_stat_cancelled++;
        accounting_add(R2D_ASYNC_STATE_CANCELLED, job->est_bytes);
        ready_push(job);
        found = true;
    }

    // 2. В работе: ставим флаг — поток доведёт шаг и выбросит результат
    //    (прервать decode нельзя; задержка отмены ≤ одного decode).
    if (!found) {
        for (R2DAsyncJob *it = g_running_list; it; it = it->next) {
            if (it->id == id) {
                if (!it->cancelled) { it->cancelled = true; g_stat_cancelled++; }
                found = true;
                break;
            }
        }
    }

    // 3. Готово, но не забрано: READY → CANCELLED в той же очереди.
    if (!found) {
        for (R2DAsyncJob *it = g_ready; it; it = it->next) {
            if (it->id != id) continue;
            if (it->state == R2D_ASYNC_STATE_READY) {
                accounting_sub(R2D_ASYNC_STATE_READY, it->est_bytes);
                it->state = R2D_ASYNC_STATE_CANCELLED;
                accounting_add(R2D_ASYNC_STATE_CANCELLED, it->est_bytes);
            }
            if (!it->cancelled) { it->cancelled = true; g_stat_cancelled++; }
            it->ok = false;
            found = true;
            break;
        }
    }

    // 4. Уже выдано игре: помечаем, poll больше не будет — только флаги.
    if (!found) {
        for (R2DAsyncJob *it = g_released; it; it = it->next) {
            if (it->id != id) continue;
            if (!it->cancelled) { it->cancelled = true; g_stat_cancelled++; }
            it->ok = false;
            found = true;
            break;
        }
    }

    if (found) SDL_BroadcastCondition(g_cond);   // бюджет освободился
    SDL_UnlockMutex(g_mutex);
    return found;
}

int r2d_async_poll(R2DAsyncResult *out, int max)
{
    if (!g_mutex || !out || max <= 0) return 0;
    int count = 0;
    SDL_LockMutex(g_mutex);
    while (count < max) {
        R2DAsyncJob *job = ready_pop();
        if (!job) break;
        accounting_sub(job->state, job->est_bytes);
        const bool was_cancelled = (job->state == R2D_ASYNC_STATE_CANCELLED) || job->cancelled;
        job->state = R2D_ASYNC_STATE_DELIVERED;
        accounting_add(R2D_ASYNC_STATE_DELIVERED, job->est_bytes);

        R2DAsyncResult *res = &out[count++];
        memset(res, 0, sizeof *res);
        res->id = job->id;
        res->kind = job->kind;
        res->ok = job->ok && !was_cancelled;
        res->cancelled = was_cancelled;
        res->from_payload = job->from_payload;
        res->size = job->size;
        res->width = job->width;
        res->height = job->height;
        SDL_snprintf(res->path, sizeof res->path, "%s", job->path);
        SDL_snprintf(res->error, sizeof res->error, "%s", job->error);
        // Задание остаётся живым до take_*/release: JS обязан закрыть каждое.
        delivered_push(job);
    }
    if (count > 0) SDL_BroadcastCondition(g_cond);
    SDL_UnlockMutex(g_mutex);
    return count;
}

char *r2d_async_take_text(int id, size_t *size)
{
    if (!g_mutex) return NULL;
    char *out = NULL;
    SDL_LockMutex(g_mutex);
    R2DAsyncJob *job = NULL;
    if (delivered_remove(id, &job)) {
        if (size) *size = job->size;
        out = (char *)job->text;
        job->text = NULL;               // владение переходит вызывающему
        job_free(job);
        SDL_BroadcastCondition(g_cond);
    }
    SDL_UnlockMutex(g_mutex);
    return out;
}

int r2d_async_take_texture(int id, R2DRenderer *r)
{
    if (!g_mutex || !r) return -1;
    int tex = -1;
    SDL_LockMutex(g_mutex);
    R2DAsyncJob *job = NULL;
    if (delivered_remove(id, &job)) {
#ifdef R2D_ASYNC_TEST
        (void)r;                        // GPU в нативном тесте не нужен
#else
        if (job->ok && !job->cancelled && job->pixels && job->width > 0 && job->height > 0) {
            // GPU upload — только здесь, на главном потоке и в безопасной
            // фазе кадра (вне render pass).
            tex = r2d_texture_create_rgba(r, job->pixels, job->width, job->height);
            if (tex >= 0 && tex < r->texture_count) {
                // Имя = разрешённый путь (как в engine.loadTexture):
                // тогда .sprite(path)/loadTexture(path) найдут уже
                // созданную текстуру, а не загрузят файл второй раз.
                const char *name = job->full[0] ? job->full : job->path;
                SDL_snprintf(r->textures[tex].name, sizeof r->textures[tex].name, "%s", name);
            }
        }
#endif
        job_free(job);
        SDL_BroadcastCondition(g_cond);
    }
    SDL_UnlockMutex(g_mutex);
    return tex;
}

void r2d_async_release(int id)
{
    if (!g_mutex) return;
    SDL_LockMutex(g_mutex);
    R2DAsyncJob *job = NULL;
    if (delivered_remove(id, &job)) {
        job_free(job);
        SDL_BroadcastCondition(g_cond);
    }
    SDL_UnlockMutex(g_mutex);
}

void r2d_async_stats(int *pending, int *done, int *failed, int *cancelled, long long *bytes)
{
    int p = 0, d = g_stat_done, f = g_stat_failed, c = g_stat_cancelled;
    long long b = g_stat_bytes;
    if (g_mutex) {
        SDL_LockMutex(g_mutex);
        p = outstanding_jobs_locked();
        d = g_stat_done;
        f = g_stat_failed;
        c = g_stat_cancelled;
        b = g_stat_bytes;
        SDL_UnlockMutex(g_mutex);
    }
    if (pending) *pending = p;
    if (done) *done = d;
    if (failed) *failed = f;
    if (cancelled) *cancelled = c;
    if (bytes) *bytes = b;
}

int r2d_async_workers(void) { return g_thread_ok ? g_worker_count : 0; }

// ---------------------------------------------------------------------------
// Новый интерфейс пределов/диагностики
// ---------------------------------------------------------------------------

void r2d_async_limits_default(R2DAsyncLimits *out)
{
    if (!out) return;
    out->max_jobs = R2D_ASYNC_DEFAULT_MAX_JOBS;
    out->max_bytes = R2D_ASYNC_DEFAULT_MAX_BYTES;
    out->max_ready = R2D_ASYNC_DEFAULT_MAX_READY;
    out->max_ready_bytes = R2D_ASYNC_DEFAULT_MAX_READY_BYTES;
    out->ready_low = R2D_ASYNC_DEFAULT_MAX_READY / 2;
    out->ready_low_bytes = R2D_ASYNC_DEFAULT_MAX_READY_BYTES / 2;
    out->workers = R2D_ASYNC_DEFAULT_WORKERS;
    out->block_producer = false;
}

void r2d_async_get_limits(R2DAsyncLimits *out)
{
    if (!out) return;
    if (!g_mutex) { *out = g_limits; return; }
    SDL_LockMutex(g_mutex);
    *out = g_limits;
    SDL_UnlockMutex(g_mutex);
}

bool r2d_async_set_limits(const R2DAsyncLimits *limits)
{
    if (!limits) return false;
    R2DAsyncLimits next = *limits;
    R2DAsyncLimits def;
    r2d_async_limits_default(&def);

    if (next.max_jobs <= 0) next.max_jobs = def.max_jobs;
    if (next.max_bytes <= 0) next.max_bytes = def.max_bytes;
    if (next.max_ready <= 0) next.max_ready = def.max_ready;
    if (next.max_ready_bytes <= 0) next.max_ready_bytes = def.max_ready_bytes;
    if (next.workers <= 0) next.workers = def.workers;
    if (next.workers > R2D_ASYNC_MAX_WORKERS) next.workers = R2D_ASYNC_MAX_WORKERS;

    // low обязан быть строго ниже high, иначе worker никогда не проснётся.
    if (next.ready_low <= 0 || next.ready_low >= next.max_ready)
        next.ready_low = next.max_ready / 2;
    if (next.ready_low_bytes <= 0 || next.ready_low_bytes >= next.max_ready_bytes)
        next.ready_low_bytes = next.max_ready_bytes / 2;

    if (g_mutex) {
        SDL_LockMutex(g_mutex);
        const int old_workers = g_limits.workers;
        g_limits = next;
        if (g_thread_ok && next.workers != g_worker_count) {
            R2D_WARN("async: workers=%d применяется после перезапуска (сейчас %d)",
                     next.workers, g_worker_count);
        } else if (!g_thread_ok && old_workers != next.workers) {
            // Синхронный режим остаётся честным: workers()==0.
        }
        SDL_BroadcastCondition(g_cond);
        SDL_UnlockMutex(g_mutex);
    } else {
        g_limits = next;
    }
    return true;
}

void r2d_async_pressure(R2DAsyncPressure *out)
{
    if (!out) return;
    memset(out, 0, sizeof *out);
    out->max_jobs = g_limits.max_jobs;
    out->max_bytes = g_limits.max_bytes;
    out->max_ready = g_limits.max_ready;
    out->max_ready_bytes = g_limits.max_ready_bytes;
    out->workers = g_thread_ok ? g_worker_count : 0;
    if (!g_mutex) return;

    SDL_LockMutex(g_mutex);
    out->queued = g_queued_jobs;
    out->running = g_running_jobs;
    out->ready = g_ready_jobs;
    out->delivered = g_delivered_jobs;
    out->cancelled = g_stat_cancelled;
    out->cancelled_pending = g_cancelled_pending;

    out->outstanding = outstanding_jobs_locked();
    out->live = live_jobs_locked();
    out->peak_outstanding = g_peak_outstanding;
    out->peak_live = g_peak_live;
    out->peak_ready = g_peak_ready;

    out->outstanding_bytes = outstanding_bytes_locked();
    out->live_bytes = live_bytes_locked();
    out->ready_bytes = ready_list_bytes_locked();
    out->peak_outstanding_bytes = g_peak_outstanding_bytes;
    out->peak_live_bytes = g_peak_live_bytes;
    out->peak_ready_bytes = g_peak_ready_bytes;

    out->done_bytes = g_stat_bytes;
    out->backpressure_waits = g_bp_waits;
    out->backpressure_ms = g_bp_ms;
    out->workers = g_thread_ok ? g_worker_count : 0;

    out->max_jobs = g_limits.max_jobs;
    out->max_bytes = g_limits.max_bytes;
    out->max_ready = g_limits.max_ready;
    out->max_ready_bytes = g_limits.max_ready_bytes;
    SDL_UnlockMutex(g_mutex);
}

// ---------------------------------------------------------------------------
// Только для нативного теста: синтетическое задание без файла/GPU.
// ---------------------------------------------------------------------------
#ifdef R2D_ASYNC_TEST
int r2d_async_test_request(int kind, long long estimated_bytes, int work_ms, bool fail)
{
    if (!g_mutex && !r2d_async_init(NULL)) return -1;
    R2DAsyncJob *job = (R2DAsyncJob *)calloc(1, sizeof(R2DAsyncJob));
    if (!job) return -1;
    job->kind = kind;
    job->est_bytes = estimated_bytes > 0 ? estimated_bytes : 0;
    job->size = estimated_bytes > 0 ? (size_t)estimated_bytes : 0;
    SDL_snprintf(job->path, sizeof job->path, "test:%d", kind);
    job->test_synthetic = true;
    job->test_work_ms = work_ms;
    job->test_fail = fail;
    return enqueue_job(job, false);
}
#endif
