// ===========================================================================
// Асинхронный ввод-вывод и декодирование картинок — src/async.c
//
// Зачем: §45 требует, чтобы тяжёлое чтение и декодирование не блокировали кадр.
// Модуль даёт маленькую очередь заданий и один рабочий поток:
//
//   * главный поток ставит задание (прочитать файл / прочитать+декодировать
//     картинку в RGBA8) и продолжает кадр;
//   * рабочий поток делает дорогую часть: SDL_LoadFile / IMG_Load_IO +
//     SDL_ConvertSurface. QuickJS тут не трогается вообще;
//   * главный поток в безопасной фазе забирает готовые результаты
//     (r2d_async_poll) и применяет их: строку — в JS, пиксели — в GPU-текстуру
//     (r2d_async_take_texture → r2d_texture_create_rgba).
//
// Отмена: у задания есть флаг. Задание в очереди снимается сразу; идущее —
// доводится до конца и выбрасывается (точнее одного decode прервать нельзя,
// это честно описано в docs/highlevel/loading.md).
//
// Если SDL_CreateThread недоступен (или поток не создался), модуль честно
// работает синхронно: задания выполняются в r2d_async_poll на главном потоке.
// r2d_async_workers() возвращает 0 — по нему JS узнаёт, что I/O не фоновый.
// ===========================================================================

#include "async.h"

#include "app.h"
#include "payload.h"
#include "render.h"

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>

#include <stdlib.h>
#include <string.h>

// Сколько готовых результатов держим до применения. Потолок нужен, чтобы
// зависшая игра не копила память: JS обязан забирать результаты каждый кадр.
#define R2D_ASYNC_MAX_JOBS     256
#define R2D_ASYNC_MAX_READY     64

typedef struct R2DAsyncJob {
    int      id;
    int      kind;
    bool     cancelled;      // отменено до начала работы
    bool     running;
    bool     done;
    bool     ok;
    bool     from_payload;
    size_t   size;           // размер файла / прочитанных байт
    int      width, height;
    char     path[512];      // путь, как его дала игра (для кэша текстур)
    char     full[4096];     // разрешённый путь на диске
    char     error[256];
    uint8_t *vfs;            // байты из груза (владелец — главный поток)
    uint8_t *text;           // прочитанный текст (владелец — результат)
    uint8_t *pixels;         // RGBA8 после декодирования
    struct R2DAsyncJob *next;
} R2DAsyncJob;

static R2DApp *g_app = NULL;
static SDL_Thread *g_thread = NULL;
static SDL_Mutex *g_mutex = NULL;
static SDL_Condition *g_cond = NULL;
static bool g_stop = false;
static bool g_thread_ok = false;
static int g_next_id = 1;

static R2DAsyncJob *g_queue = NULL;      // ждут рабочего потока
static R2DAsyncJob *g_queue_tail = NULL;
static R2DAsyncJob *g_running = NULL;    // задание в работе у потока
static R2DAsyncJob *g_ready = NULL;      // готовы к применению (главный поток)
static R2DAsyncJob *g_ready_tail = NULL;
static R2DAsyncJob *g_released = NULL;   // показаны игрой, ждут take_/release
static int g_ready_count = 0;
static int g_active = 0;                 // в работе у потока
static int g_live = 0;                   // всего незакрытых заданий

static int g_stat_done = 0;
static int g_stat_failed = 0;
static int g_stat_cancelled = 0;
static long long g_stat_bytes = 0;

static void job_free(R2DAsyncJob *job)
{
    if (!job) return;
    free(job->text);
    free(job->pixels);
    free(job);
}

// ---------------------------------------------------------------------------
// Очередь (под mutex)
// ---------------------------------------------------------------------------

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

static void ready_push(R2DAsyncJob *job)
{
    job->next = NULL;
    if (g_ready_count >= R2D_ASYNC_MAX_READY) {
        // Применять не успевают: результат теряем, но факт сообщаем.
        SDL_snprintf(job->error, sizeof job->error,
                     "очередь применений переполнена (R2D_ASYNC_MAX_READY)");
        job->ok = false;
    }
    if (g_ready_tail) g_ready_tail->next = job;
    else g_ready = job;
    g_ready_tail = job;
    g_ready_count++;
}

static R2DAsyncJob *ready_pop(void)
{
    R2DAsyncJob *job = g_ready;
    if (!job) return NULL;
    g_ready = job->next;
    if (!g_ready) g_ready_tail = NULL;
    g_ready_count--;
    job->next = NULL;
    return job;
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
        } else {
            job->text = bytes;             // владение переходит результату
            bytes = NULL;
        }
        return true;
    }

    // Картинка: декодирование целиком здесь (IMG_Load_IO + конвертация в RGBA8).
    SDL_IOStream *io = SDL_IOFromConstMem(bytes, size);
    SDL_Surface *loaded = io ? IMG_Load_IO(io, true) : NULL;
    if (job->from_payload) free(bytes);
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

static int SDLCALL worker_main(void *unused)
{
    (void)unused;
    SDL_LockMutex(g_mutex);
    for (;;) {
        while (!g_stop && !g_queue) SDL_WaitCondition(g_cond, g_mutex);
        if (g_stop && !g_queue) break;
        R2DAsyncJob *job = queue_pop();
        if (!job) break;
        if (job->cancelled) {
            g_stat_cancelled++;
            g_live--;
            ready_push(job);
            continue;
        }
        job->running = true;
        g_active++;
        g_running = job;
        SDL_UnlockMutex(g_mutex);

        const bool ok = job_run(job);

        SDL_LockMutex(g_mutex);
        g_active--;
        g_running = NULL;
        job->running = false;
        job->done = true;
        if (job->cancelled) {
            // Отменили, пока считали: результат выбрасываем, буферы освободим
            // при release() на главном потоке.
            g_stat_cancelled++;
        } else if (ok) {
            job->ok = true;
            g_stat_done++;
            g_stat_bytes += (long long)job->size;
        } else {
            g_stat_failed++;
        }
        g_live--;
        ready_push(job);
        SDL_BroadcastCondition(g_cond);
    }
    SDL_UnlockMutex(g_mutex);
    return 0;
}

// ---------------------------------------------------------------------------
// Публичный интерфейс
// ---------------------------------------------------------------------------

bool r2d_async_init(R2DApp *app)
{
    if (g_mutex) { g_app = app; return true; }
    g_app = app;
    g_mutex = SDL_CreateMutex();
    g_cond = SDL_CreateCondition();
    if (!g_mutex || !g_cond) {
        R2D_ERROR("async: не удалось создать mutex/condition: %s", SDL_GetError());
        return false;
    }
    g_thread = SDL_CreateThread(worker_main, "r2d_async", NULL);
    g_thread_ok = g_thread != NULL;
    if (!g_thread_ok) {
        // Честная деградация: задания будут выполнены синхронно в poll().
        SDL_Log("russiano2d: async I/O без рабочего потока (%s) — загрузка пойдёт по кадру",
                SDL_GetError());
    }
    return true;
}

void r2d_async_shutdown(void)
{
    if (!g_mutex) return;
    SDL_LockMutex(g_mutex);
    g_stop = true;
    SDL_BroadcastCondition(g_cond);
    SDL_UnlockMutex(g_mutex);
    if (g_thread) { SDL_WaitThread(g_thread, NULL); g_thread = NULL; }
    while (g_queue) job_free(queue_pop());
    while (g_ready) job_free(ready_pop());
    SDL_DestroyCondition(g_cond);
    SDL_DestroyMutex(g_mutex);
    g_cond = NULL;
    g_mutex = NULL;
    g_thread_ok = false;
    g_stop = false;
    g_live = 0;
}

/** Размер файла без чтения: для точного progress в байтах. -1 — неизвестен. */
long long r2d_async_size(R2DApp *app, const char *path)
{
    if (!path) return -1;
    if (r2d_vfs_has(path)) {
        size_t size = 0;
        uint8_t *data = r2d_vfs_read(path, &size);
        if (!data) return -1;
        r2d_vfs_free(data);
        return (long long)size;
    }
    if (!app) return -1;
    char full[4096];
    r2d_app_resolve_path(app, full, sizeof full, path);
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info) || info.type != SDL_PATHTYPE_FILE) return -1;
    return (long long)info.size;
}

int r2d_async_request(R2DApp *app, const char *path, int kind)
{
    if (!path || !*path) return -1;
    if (!g_mutex && !r2d_async_init(app)) return -1;
    if (g_live >= R2D_ASYNC_MAX_JOBS) {
        R2D_ERROR("async: очередь заданий переполнена (%d)", R2D_ASYNC_MAX_JOBS);
        return -1;
    }
    R2DAsyncJob *job = (R2DAsyncJob *)calloc(1, sizeof(R2DAsyncJob));
    if (!job) return -1;
    job->kind = kind;
    SDL_snprintf(job->path, sizeof job->path, "%s", path);

    // Разрешённый путь нужен и для чтения с диска, и для регистрации текстуры
    // в кэше ядра: engine.loadTexture кэширует по АБСОЛЮТНОМУ пути, поэтому
    // имя созданной из пикселей текстуры должно быть таким же.
    if (app) r2d_app_resolve_path(app, job->full, sizeof job->full, path);

    if (r2d_vfs_has(path)) {
        size_t size = 0;
        uint8_t *data = r2d_vfs_read(path, &size);
        if (!data) { free(job); return -1; }
        job->vfs = data;
        job->from_payload = true;
        job->size = size;
    } else {
        if (!app) { free(job); return -1; }
        SDL_PathInfo info;
        if (!SDL_GetPathInfo(job->full, &info) || info.type != SDL_PATHTYPE_FILE) {
            SDL_snprintf(job->error, sizeof job->error, "файл \"%s\" не найден", path);
            job->done = true;
            job->ok = false;
        } else {
            job->size = (size_t)info.size;
        }
    }

    SDL_LockMutex(g_mutex);
    job->id = g_next_id++;
    g_live++;
    if (job->done) {                 // файла нет — результат сразу
        g_stat_failed++;
        g_live--;
        ready_push(job);
    } else if (!g_thread_ok) {
        // Без потока: выполняем сразу здесь — JS всё равно получит результат,
        // но кадр на это время встанет (об этом честно скажет workers()).
        const bool ok = job_run(job);
        job->done = true;
        job->ok = ok;
        if (ok) { g_stat_done++; g_stat_bytes += (long long)job->size; }
        else g_stat_failed++;
        g_live--;
        ready_push(job);
    } else {
        queue_push(job);
        SDL_BroadcastCondition(g_cond);
    }
    SDL_UnlockMutex(g_mutex);
    return job->id;
}

bool r2d_async_cancel(int id)
{
    if (!g_mutex) return false;
    bool found = false;
    SDL_LockMutex(g_mutex);
    // 1. В очереди: снимаем сразу и сообщаем как cancelled.
    R2DAsyncJob **link = &g_queue;
    while (*link) {
        if ((*link)->id == id) {
            R2DAsyncJob *job = *link;
            *link = job->next;
            if (!*link && g_queue_tail == job) g_queue_tail = NULL;
            job->done = true;
            job->cancelled = true;
            g_stat_cancelled++;
            g_live--;
            ready_push(job);
            found = true;
            break;
        }
        link = &(*link)->next;
    }
    // 2. В работе: ставим флаг — поток доведёт шаг и выбросит результат
    //    (прервать decode нельзя; задержка отмены ≤ одного decode).
    if (!found && g_running && g_running->id == id) {
        g_running->cancelled = true;
        found = true;
    }
    // 3. Уже готово, но игрой не забрано: помечаем, poll вернёт cancelled.
    if (!found) {
        for (R2DAsyncJob *job = g_ready; job; job = job->next) {
            if (job->id == id) { job->cancelled = true; job->ok = false; found = true; break; }
        }
    }
    if (!found) {
        for (R2DAsyncJob *job = g_released; job; job = job->next) {
            if (job->id == id) { job->cancelled = true; job->ok = false; found = true; break; }
        }
    }
    SDL_UnlockMutex(g_mutex);
    return found;
}

/** Отдать готовые результаты (метаданные). Тяжёлое забирается take_*. */
int r2d_async_poll(R2DAsyncResult *out, int max)
{
    if (!g_mutex || !out || max <= 0) return 0;
    int count = 0;
    SDL_LockMutex(g_mutex);
    while (count < max) {
        R2DAsyncJob *job = ready_pop();
        if (!job) break;
        R2DAsyncResult *res = &out[count++];
        memset(res, 0, sizeof *res);
        res->id = job->id;
        res->kind = job->kind;
        res->ok = job->ok && !job->cancelled;
        res->cancelled = job->cancelled;
        res->from_payload = job->from_payload;
        res->size = job->size;
        res->width = job->width;
        res->height = job->height;
        SDL_snprintf(res->path, sizeof res->path, "%s", job->path);
        SDL_snprintf(res->error, sizeof res->error, "%s", job->error);
        // Задание остаётся живым до take_*/release: JS обязан закрыть каждое.
        job->next = NULL;
        if (!g_released) g_released = job;
        else { R2DAsyncJob *tail = g_released; while (tail->next) tail = tail->next; tail->next = job; }
    }
    SDL_UnlockMutex(g_mutex);
    return count;
}

char *r2d_async_take_text(int id, size_t *size)
{
    if (!g_mutex) return NULL;
    char *out = NULL;
    SDL_LockMutex(g_mutex);
    R2DAsyncJob **link = &g_released;
    while (*link) {
        if ((*link)->id == id) {
            R2DAsyncJob *job = *link;
            *link = job->next;
            job->next = NULL;
            if (size) *size = job->size;
            out = (char *)job->text;
            job->text = NULL;               // владение переходит вызывающему
            job_free(job);
            break;
        }
        link = &(*link)->next;
    }
    SDL_UnlockMutex(g_mutex);
    return out;
}

int r2d_async_take_texture(int id, R2DRenderer *r)
{
    if (!g_mutex || !r) return -1;
    int tex = -1;
    SDL_LockMutex(g_mutex);
    R2DAsyncJob **link = &g_released;
    while (*link) {
        if ((*link)->id == id) {
            R2DAsyncJob *job = *link;
            *link = job->next;
            job->next = NULL;
            if (job->ok && job->pixels && job->width > 0 && job->height > 0) {
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
            job_free(job);
            break;
        }
        link = &(*link)->next;
    }
    SDL_UnlockMutex(g_mutex);
    return tex;
}

void r2d_async_release(int id)
{
    if (!g_mutex) return;
    SDL_LockMutex(g_mutex);
    R2DAsyncJob **link = &g_released;
    while (*link) {
        if ((*link)->id == id) {
            R2DAsyncJob *job = *link;
            *link = job->next;
            job->next = NULL;
            job_free(job);
            break;
        }
        link = &(*link)->next;
    }
    SDL_UnlockMutex(g_mutex);
}

void r2d_async_stats(int *pending, int *done, int *failed, int *cancelled, long long *bytes)
{
    if (pending) *pending = g_live;
    if (done) *done = g_stat_done;
    if (failed) *failed = g_stat_failed;
    if (cancelled) *cancelled = g_stat_cancelled;
    if (bytes) *bytes = g_stat_bytes;
}

int r2d_async_workers(void) { return g_thread_ok ? 1 : 0; }
