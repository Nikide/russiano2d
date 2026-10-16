// ===========================================================================
// Профайлер кадра: реализация (см. profile.h).
//
// Никаких аллокаций в кадре: история — статические массивы, замеры CPU —
// SDL_GetPerformanceCounter. Стоимость включённого профайлера — единицы
// микросекунд на кадр.
//
// GPU-замер — по fence командного буфера (timestamp-запросов в SDL3 нет,
// подробности в profile.h). Поток-поллер опрашивает SDL_QueryGPUFence и
// складывает готовое время в слот; главный поток забирает его в
// r2d_prof_frame_end, не блокируясь. Когда профайлер выключен, ни один fence
// не передаётся профайлеру и ни один запрос не делается.
//
// Кроме средних по окну профайлер отдаёт историю кадра с перцентилями (§17.2)
// и ловит долгие кадры — hitch-детектор (§18). И то и другое читает то же
// кольцо: второго профайлера здесь нет.
// ===========================================================================

#include "profile.h"
#include "r2d.h"

#include <SDL3/SDL.h>
#include <string.h>

#ifdef R2D_TRACY
// Клиент Tracy (BSD-3-Clause) подключается только опцией -DR2D_TRACY=ON
// (cmake/Tracy.cmake). Без неё файл не меняется ни на байт.
#include <tracy/TracyC.h>
#endif

// Окно наблюдения: средние и пики считаются по последним кадрам.
#define R2D_PROF_WINDOW 120
// Буфер истории у вызывающего (script.c) рассчитан на R2D_PROF_WINDOW_MAX из
// profile.h: окно не должно его перерасти, иначе история молча обрежется.
_Static_assert(R2D_PROF_WINDOW <= R2D_PROF_WINDOW_MAX,
               "окно профайлера больше R2D_PROF_WINDOW_MAX");

// Кольцо слотов GPU-замера: столько кадров могут быть «в полёте» до того, как
// профайлер отпустит fence. Четырёх хватает с запасом: замер готовится за
// 1–2 кадра, а если GPU отстал сильнее — кадр просто не измеряется.
#define R2D_PROF_GPU_SLOTS 4
// Пауза между опросами fence. 0,2 мс — точность замера при почти нулевой
// нагрузке на CPU (поток живёт только пока кадр GPU не завершён).
#define R2D_PROF_GPU_POLL_NS 200000

static const char *ZONE_NAMES[R2D_PROF_COUNT] = {
    "JS: логика",
    "JS: сборка батча",
    "физика (Box2D)",
    "ожидание swapchain",
    "загрузка VB/IB",
    "draw-команды",
    "интерфейс (RmlUi)",
    "прочее",
};

static const char *GPU_ZONE_NAMES[R2D_PROF_GPU_COUNT] = {
    "GPU: кадр",
};

// --- Tracy: те же зоны, что видит оверлей -----------------------------------
//
// Правило «один источник правды»: зона начинается и заканчивается только в
// r2d_prof_begin/end. Tracy получает ровно эти зоны и ровно эти имена — имена
// берутся из ZONE_NAMES выше, отдельной таблицы имён нет. Второй системы зон
// не появляется: новый инструмент читает тот же единственный источник.
//
// Цена при выключенном сервере: клиент собирается с TRACY_ON_DEMAND (см.
// cmake/Tracy.cmake), поэтому без подключённого tracy-profiler на зону
// остаётся одна проверка «подключён ли» — ни буферов, ни блокировок.
#ifdef R2D_TRACY

static struct ___tracy_source_location_data g_tracy_zone[R2D_PROF_COUNT];
static TracyCZoneCtx g_tracy_ctx[R2D_PROF_COUNT];
static bool          g_tracy_zones_ready = false;

// Мьютекс слотов GPU-замера — единственный лок профайлера. В Tracy он виден
// как объект синхронизации: по таймлайну понятно, ждёт ли кадр поток опроса
// fence или наоборот.
static TracyCLockCtx g_tracy_lock = NULL;

// Источник локации зоны заполняется один раз и живёт до конца процесса: клиент
// Tracy отдаёт серверу указатель на него, поэтому структура обязана быть
// статической. Вызывается только из r2d_prof_begin (главный поток).
static void r2d__tracy_zones_init(void)
{
    if (g_tracy_zones_ready) return;
    for (int i = 0; i < R2D_PROF_COUNT; i++) {
        g_tracy_zone[i].name = ZONE_NAMES[i];   // одно имя на оба профайлера
        g_tracy_zone[i].function = "r2d_prof_begin";
        g_tracy_zone[i].file = __FILE__;
        g_tracy_zone[i].line = 0;   // зона начинается в вызывающем коде
        g_tracy_zone[i].color = 0;  // 0 — Tracy подберёт цвет сам
    }
    g_tracy_zones_ready = true;
}

// Графики кадра: те же числа, что показывает оверлей, — из того же кольца.
static void r2d__tracy_frame_plots(double real, double zones)
{
    TracyCPlotF("кадр: реальное время, мс", (float)real);
    TracyCPlotF("кадр: сумма зон, мс", (float)zones);
    TracyCPlotF("кадр: неучтённое, мс",
                (float)(real > zones ? real - zones : 0.0));
    TracyCPlotI("hitch: поймано всего", (int64_t)r2d_prof_hitch_total());
}

#endif  // R2D_TRACY

// Мьютексы профайлера: с Tracy отмечаем вход/выход из лока, без Tracy — это
// ровно прежние SDL_LockMutex/SDL_UnlockMutex.
#ifdef R2D_TRACY
static void r2d__lock(SDL_Mutex *m)
{
    if (g_tracy_lock) TracyCLockBeforeLock(g_tracy_lock);
    SDL_LockMutex(m);
    if (g_tracy_lock) TracyCLockAfterLock(g_tracy_lock);
}
static void r2d__unlock(SDL_Mutex *m)
{
    SDL_UnlockMutex(m);
    if (g_tracy_lock) TracyCLockAfterUnlock(g_tracy_lock);
}
#else
#  define r2d__lock(m)   SDL_LockMutex(m)
#  define r2d__unlock(m) SDL_UnlockMutex(m)
#endif

static bool   g_enabled = true;
static Uint64 g_freq = 0;

// Текущий кадр.
static Uint64 g_start[R2D_PROF_COUNT];
static bool   g_running[R2D_PROF_COUNT];
static double g_acc[R2D_PROF_COUNT];

// История: последняя колонка — полное время кадра.
static double g_hist[R2D_PROF_WINDOW][R2D_PROF_COUNT + 1];
static double g_real[R2D_PROF_WINDOW];   // реальное время кадра
// Измеренная длительность кадра: интервал работы кадра, но не меньше того, что
// движок считает временем кадра (см. шапку profile.h). Нужна для контекста
// захватов.
static double g_span[R2D_PROF_WINDOW];
// GPU-история. -1 — в этом кадре замера не было (в среднее такие кадры не идут).
static double g_hist_gpu[R2D_PROF_WINDOW][R2D_PROF_GPU_COUNT];
static int    g_head = 0;
static int    g_filled = 0;
static long long g_frame_no = 0;   // номер кадра профайлера (с момента сброса)

// Начало измеряемого интервала кадра: ставится на первой зоне после
// закрытия предыдущего кадра. Так в интервал не попадает простой между
// кадрами (в агентском режиме движок ждёт команду) — это не долгий кадр.
static double g_work_start = 0.0;
static bool   g_work_open  = false;

// Hitch-детектор: реализация ниже, вызов из r2d_prof_frame_end.
static void r2d__hitch_frame(double measured, double real, double work);

// --- GPU-замер: состояние ---------------------------------------------------

typedef struct R2DProfGpuSlot {
    SDL_GPUFence *fence;      // ждёт опроса; NULL — слот свободен
    double        submit_ms;  // момент отправки командного буфера
    double        elapsed_ms; // готовый замер: submit → сигнал fence
    bool          ready;      // замер готов и ждёт главного потока
} R2DProfGpuSlot;

static SDL_GPUDevice *g_gpu_device = NULL;
static SDL_Mutex     *g_gpu_lock   = NULL;   // защищает слоты
static SDL_Semaphore *g_gpu_wake   = NULL;   // «появился fence» для поллера
static SDL_Thread    *g_gpu_thread = NULL;
static SDL_AtomicInt  g_gpu_stop;
static R2DProfGpuSlot g_gpu_slots[R2D_PROF_GPU_SLOTS];
static bool           g_gpu_ok  = false;     // замер доступен
static float          g_gpu_ms  = -1.0f;     // последний забранный замер, < 0 — нет

static double r2d__now_ms(void)
{
    if (!g_freq) g_freq = SDL_GetPerformanceFrequency();
    return (double)SDL_GetPerformanceCounter() * 1000.0 / (double)g_freq;
}

// Забирает готовые замеры из слотов и отпускает их fence. Вызывается только из
// главного потока (r2d_prof_frame_end): все вызовы SDL_GPU — в одном потоке.
static void r2d__gpu_harvest(void)
{
    if (!g_gpu_lock) return;

    SDL_GPUFence *done[R2D_PROF_GPU_SLOTS];
    int n = 0;

    r2d__lock(g_gpu_lock);
    for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
        if (!g_gpu_slots[i].ready) continue;
        g_gpu_ms = (float)g_gpu_slots[i].elapsed_ms;
        done[n++] = g_gpu_slots[i].fence;
        g_gpu_slots[i].fence = NULL;
        g_gpu_slots[i].ready = false;
    }
    r2d__unlock(g_gpu_lock);

    for (int i = 0; i < n; i++) {
        if (done[i]) SDL_ReleaseGPUFence(g_gpu_device, done[i]);
    }
}

// Поток-поллер: ждёт сигнала fence и запоминает время. Кадр не блокирует —
// главный поток только передаёт fence и забирает готовое.
static int SDLCALL r2d__gpu_poll_thread(void *user)
{
    SDL_GPUDevice *device = (SDL_GPUDevice *)user;

#ifdef R2D_TRACY
    // Имя потока в таймлайне: видно, что ожидание fence — это отдельный поток,
    // а не «залипший» кадр.
    TracyCSetThreadName("профайлер: опрос fence");
#endif

    for (;;) {
        SDL_WaitSemaphore(g_gpu_wake);
        if (SDL_GetAtomicInt(&g_gpu_stop)) break;

        for (;;) {
            SDL_GPUFence *fence = NULL;
            double submit_ms = 0.0;

            r2d__lock(g_gpu_lock);
            for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
                if (g_gpu_slots[i].fence && !g_gpu_slots[i].ready) {
                    fence = g_gpu_slots[i].fence;
                    submit_ms = g_gpu_slots[i].submit_ms;
                    break;
                }
            }
            r2d__unlock(g_gpu_lock);

            if (!fence) break;   // всё опрошено — спим до следующего кадра

            while (!SDL_QueryGPUFence(device, fence)) {
                if (SDL_GetAtomicInt(&g_gpu_stop)) return 0;
                SDL_DelayPrecise(R2D_PROF_GPU_POLL_NS);
            }
            const double elapsed = r2d__now_ms() - submit_ms;

            r2d__lock(g_gpu_lock);
            for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
                if (g_gpu_slots[i].fence == fence) {
                    g_gpu_slots[i].elapsed_ms = elapsed;
                    g_gpu_slots[i].ready = true;
                    break;
                }
            }
            r2d__unlock(g_gpu_lock);
        }
    }
    return 0;
}

void r2d_prof_gpu_init(SDL_GPUDevice *device)
{
    r2d_prof_gpu_shutdown();
    g_gpu_ms = -1.0f;
    g_gpu_device = device;
    if (!device) return;   // без устройства замер недоступен: строки «н/д»

    g_gpu_lock = SDL_CreateMutex();
    g_gpu_wake = SDL_CreateSemaphore(0);
    if (!g_gpu_lock || !g_gpu_wake) {
        R2D_WARN("профайлер: GPU-замер недоступен (%s)", SDL_GetError());
        r2d_prof_gpu_shutdown();
        return;
    }
#ifdef R2D_TRACY
    // Лок объявляем Tracy ровно тогда, когда он реально существует.
    TracyCLockAnnounce(g_tracy_lock);
    TracyCLockCustomName(g_tracy_lock, "профайлер: слоты GPU-замера",
                         sizeof("профайлер: слоты GPU-замера") - 1);
#endif

    SDL_SetAtomicInt(&g_gpu_stop, 0);
    g_gpu_thread = SDL_CreateThread(r2d__gpu_poll_thread, "r2d_gpu_prof", device);
    if (!g_gpu_thread) {
        R2D_WARN("профайлер: не удалось запустить поток опроса fence (%s)", SDL_GetError());
        r2d_prof_gpu_shutdown();
        return;
    }
    g_gpu_ok = true;
}

void r2d_prof_gpu_shutdown(void)
{
    if (g_gpu_thread) {
        SDL_SetAtomicInt(&g_gpu_stop, 1);
        SDL_SignalSemaphore(g_gpu_wake);
        SDL_WaitThread(g_gpu_thread, NULL);
        g_gpu_thread = NULL;
    }

    if (g_gpu_lock) {
        r2d__lock(g_gpu_lock);
        for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
            if (g_gpu_slots[i].fence && g_gpu_device) {
                SDL_ReleaseGPUFence(g_gpu_device, g_gpu_slots[i].fence);
            }
            g_gpu_slots[i].fence = NULL;
            g_gpu_slots[i].ready = false;
            g_gpu_slots[i].elapsed_ms = 0.0;
        }
        r2d__unlock(g_gpu_lock);
        SDL_DestroyMutex(g_gpu_lock);
        g_gpu_lock = NULL;
#ifdef R2D_TRACY
        // Лок исчез — снимаем и его объект в Tracy (порядок: после Destroy).
        if (g_tracy_lock) {
            TracyCLockTerminate(g_tracy_lock);
            g_tracy_lock = NULL;
        }
#endif
    }
    if (g_gpu_wake) {
        SDL_DestroySemaphore(g_gpu_wake);
        g_gpu_wake = NULL;
    }

    g_gpu_device = NULL;
    g_gpu_ok = false;
    g_gpu_ms = -1.0f;
}

void r2d_prof_gpu_submit(SDL_GPUFence *fence)
{
    if (!fence) return;
    // Замер выключен или недоступен — просто отпускаем fence, как раньше.
    if (!g_enabled || !g_gpu_ok) {
        if (g_gpu_device) SDL_ReleaseGPUFence(g_gpu_device, fence);
        return;
    }

    // Сначала освобождаем готовые слоты: если GPU отстал, кольцо не забьётся.
    r2d__gpu_harvest();

    bool placed = false;
    r2d__lock(g_gpu_lock);
    for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
        if (g_gpu_slots[i].fence) continue;
        g_gpu_slots[i].fence = fence;
        g_gpu_slots[i].submit_ms = r2d__now_ms();
        g_gpu_slots[i].elapsed_ms = 0.0;
        g_gpu_slots[i].ready = false;
        placed = true;
        break;
    }
    r2d__unlock(g_gpu_lock);

    if (!placed) {   // GPU отстал больше чем на R2D_PROF_GPU_SLOTS кадров
        SDL_ReleaseGPUFence(g_gpu_device, fence);
        return;
    }
    SDL_SignalSemaphore(g_gpu_wake);
}

bool r2d_prof_gpu_available(void) { return g_gpu_ok; }

// Среднее и пик по колонке GPU-истории. false — валидных кадров не было.
static bool r2d__gpu_avg(int zone, double *avg, double *peak, int *count)
{
    double sum = 0.0, top = 0.0;
    int cnt = 0;
    for (int f = 0; f < g_filled; f++) {
        const double v = g_hist_gpu[f][zone];
        if (v < 0.0) continue;
        sum += v;
        if (v > top) top = v;
        cnt++;
    }
    if (avg)   *avg = cnt ? sum / (double)cnt : 0.0;
    if (peak)  *peak = cnt ? top : 0.0;
    if (count) *count = cnt;
    return cnt > 0;
}

float r2d_prof_gpu_ms(void)
{
    double avg = 0.0, peak = 0.0;
    int cnt = 0;
    if (!r2d__gpu_avg(R2D_PROF_GPU_FRAME, &avg, &peak, &cnt)) return -1.0f;
    return (float)avg;
}

int r2d_prof_gpu_frames(void)
{
    int cnt = 0;
    r2d__gpu_avg(R2D_PROF_GPU_FRAME, NULL, NULL, &cnt);
    return cnt;
}

const char *r2d_prof_gpu_note(void)
{
    if (!g_gpu_ok) return "н/д: GPU-замер недоступен";
    return "по fence кадра (timestamp-запросов в SDL3 нет)";
}

// --- CPU-зоны ---------------------------------------------------------------

void r2d_prof_begin(R2DProfileZone zone)
{
    if (!g_enabled || zone < 0 || zone >= R2D_PROF_COUNT) return;
    if (!g_work_open) {   // первая зона кадра — начало измеряемого интервала
        g_work_open = true;
        g_work_start = r2d__now_ms();
    }
#ifdef R2D_TRACY
    // Зона Tracy начинается ровно здесь же, где зона нашего профайлера:
    // отдельного списка зон не существует. Повторный begin без end (наш
    // профайлер просто перезапускает таймер) второй зоны не создаёт — иначе
    // получилась бы пара begin/end, которой нет в источнике правды.
    if (!g_running[zone]) {
        r2d__tracy_zones_init();
        g_tracy_ctx[zone] = ___tracy_emit_zone_begin(&g_tracy_zone[zone], 1);
    }
#endif
    g_start[zone] = SDL_GetPerformanceCounter();
    g_running[zone] = true;
}

void r2d_prof_end(R2DProfileZone zone)
{
    if (!g_enabled || zone < 0 || zone >= R2D_PROF_COUNT || !g_running[zone]) return;
#ifdef R2D_TRACY
    ___tracy_emit_zone_end(g_tracy_ctx[zone]);
#endif
    const Uint64 freq = g_freq ? g_freq : (g_freq = SDL_GetPerformanceFrequency());
    const double ms = (double)(SDL_GetPerformanceCounter() - g_start[zone]) * 1000.0 / (double)freq;
    g_acc[zone] += ms;
    g_running[zone] = false;
}

void r2d_prof_frame_end(float real_ms)
{
    if (!g_enabled) return;

    const double now = r2d__now_ms();

    // GPU-замер готовится в фоне: забираем то, что успело дозреть (1–2 кадра
    // назад). Если ничего не готово — колонка остаётся «нет данных».
    r2d__gpu_harvest();

    double total = 0.0;
    for (int i = 0; i < R2D_PROF_COUNT; i++) {
        g_hist[g_head][i] = g_acc[i];
        total += g_acc[i];
        g_acc[i] = 0.0;
        g_running[i] = false;
    }
    g_hist[g_head][R2D_PROF_COUNT] = total;
    for (int i = 0; i < R2D_PROF_GPU_COUNT; i++) {
        // Держим последний известный замер: между опросами он чуть устаревает,
        // но среднее по окну от этого не страдает.
        g_hist_gpu[g_head][i] = g_gpu_ok ? (double)g_gpu_ms : -1.0;
    }
    // Реальное время кадра кладём рядом: разница с суммой зон — неучтённое
    // (ожидание GPU, планировщик, события).
    const double real = real_ms > 0.0f ? (double)real_ms : total;
    g_real[g_head] = real;

    // Измеренная длительность: интервал работы кадра, но не меньше того, что
    // движок считает временем кадра. В детерминированном режиме dt фиксирован,
    // и без второго слагаемого спайк внутри кадра был бы не виден.
    const double work = g_work_open ? (now - g_work_start) : 0.0;
    g_work_open = false;
    g_span[g_head] = work > real ? work : real;

    // Спайк ищем по измеренной длительности: времена зон этого кадра уже в
    // кольце, поэтому причина захвата указывает на тот же кадр.
    g_frame_no++;
    r2d__hitch_frame(g_span[g_head], real, work);

#ifdef R2D_TRACY
    // Графики кадра: те же числа, что показывает оверлей, — из того же кольца.
    r2d__tracy_frame_plots(real, total);
#endif

    g_head = (g_head + 1) % R2D_PROF_WINDOW;
    if (g_filled < R2D_PROF_WINDOW) g_filled++;
}

float r2d_prof_real_ms(void)
{
    if (g_filled == 0) return 0.0f;
    double sum = 0.0;
    for (int f = 0; f < g_filled; f++) sum += g_real[f];
    return (float)(sum / (double)g_filled);
}

void r2d_prof_reset(void)
{
    memset(g_acc, 0, sizeof(g_acc));
    memset(g_running, 0, sizeof(g_running));
    memset(g_hist, 0, sizeof(g_hist));
    memset(g_real, 0, sizeof(g_real));
    memset(g_span, 0, sizeof(g_span));
    for (int f = 0; f < R2D_PROF_WINDOW; f++) {
        for (int i = 0; i < R2D_PROF_GPU_COUNT; i++) g_hist_gpu[f][i] = -1.0;
    }
    g_gpu_ms = -1.0f;
    g_head = 0;
    g_filled = 0;
    g_frame_no = 0;
    g_work_open = false;
    // Захваты принадлежат профайлеру: сброс накопленного чистит и их. Порог —
    // настройка пользователя, её сброс не трогает.
    r2d_prof_hitch_clear();
}

bool r2d_prof_enabled(void) { return g_enabled; }

void r2d_prof_set_enabled(bool on)
{
    if (g_enabled == on) return;
    g_enabled = on;
    r2d_prof_reset();
}

int r2d_prof_rows(R2DProfileRow *out, int max)
{
    if (!out || max <= 0 || g_filled == 0) return 0;
    int n = 0;

    const int cpu_n = max < R2D_PROF_COUNT ? max : R2D_PROF_COUNT;
    for (int i = 0; i < cpu_n; i++) {
        double sum = 0.0;
        double peak = 0.0;
        for (int f = 0; f < g_filled; f++) {
            const double v = g_hist[f][i];
            sum += v;
            if (v > peak) peak = v;
        }
        out[n].name = ZONE_NAMES[i];
        out[n].ms = (float)(sum / (double)g_filled);
        out[n].peak = (float)peak;
        out[n].gpu = false;
        out[n].valid = true;
        n++;
    }

    // GPU-строки — после CPU-зон, порядок внутри группы совпадает с enum.
    for (int i = 0; i < R2D_PROF_GPU_COUNT && n < max; i++) {
        double avg = 0.0, peak = 0.0;
        int cnt = 0;
        const bool has = r2d__gpu_avg(i, &avg, &peak, &cnt);
        out[n].name = GPU_ZONE_NAMES[i];
        out[n].ms = (float)avg;
        out[n].peak = (float)peak;
        out[n].gpu = true;
        out[n].valid = g_gpu_ok && has;
        n++;
    }
    return n;
}

float r2d_prof_frame_ms(void)
{
    if (g_filled == 0) return 0.0f;
    double sum = 0.0;
    for (int f = 0; f < g_filled; f++) sum += g_hist[f][R2D_PROF_COUNT];
    return (float)(sum / (double)g_filled);
}

float r2d_prof_unaccounted_ms(void)
{
    const float real = r2d_prof_real_ms();
    const float zones = r2d_prof_frame_ms();
    const float diff = real - zones;
    return diff > 0.0f ? diff : 0.0f;
}

int r2d_prof_frames(void) { return g_filled; }

// --- История кадра и перцентили (§17.2) -------------------------------------
//
// Второго профайлера здесь нет: и история, и статистика читают то же кольцо
// g_real, что и средние. Сортировка — вставками по копии окна: 120 значений,
// а вызывается статистика по запросу (engine.profile()), не в кадре.

const char *r2d_prof_zone_name(int zone)
{
    if (zone < 0 || zone >= R2D_PROF_COUNT) return NULL;
    return ZONE_NAMES[zone];
}

int r2d_prof_window(void) { return R2D_PROF_WINDOW; }

int r2d_prof_frame_history(float *out, int max)
{
    if (!out || max <= 0 || g_filled == 0) return 0;

    // Старые → новые. Пока кольцо не заполнено, физический порядок совпадает с
    // хронологическим; после переполнения началом становится g_head.
    const int n = g_filled < max ? g_filled : max;
    const int first = (g_filled < R2D_PROF_WINDOW ? 0 : g_head) + (g_filled - n);
    for (int i = 0; i < n; i++) {
        out[i] = (float)g_real[(first + i) % R2D_PROF_WINDOW];
    }
    return n;
}

// Перцентиль по ВОЗРАСТАЮЩЕМУ массиву: метод ближайшего ранга, без
// интерполяции — p95 это фактическое время кадра, а не среднее двух соседних.
// Ранг ceil(q*n), индекс rank-1; целочисленно, без math.h.
static float r2d__percentile(const double *sorted, int n, double q)
{
    if (n <= 0) return 0.0f;
    const double rank = q * (double)n;
    int idx = (int)rank;                       // floor
    if ((double)idx < rank) idx++;              // ceil
    idx--;                                      // 1-based ранг → индекс
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    return (float)sorted[idx];
}

R2DProfileStats r2d_prof_frame_stats(void)
{
    R2DProfileStats st;
    memset(&st, 0, sizeof(st));
    if (g_filled == 0) return st;

    double sorted[R2D_PROF_WINDOW];
    double sum = 0.0;
    for (int f = 0; f < g_filled; f++) {
        sorted[f] = g_real[f];
        sum += g_real[f];
    }
    for (int i = 1; i < g_filled; i++) {   // сортировка вставками
        const double v = sorted[i];
        int j = i - 1;
        while (j >= 0 && sorted[j] > v) {
            sorted[j + 1] = sorted[j];
            j--;
        }
        sorted[j + 1] = v;
    }

    st.count = g_filled;
    st.min = (float)sorted[0];
    st.max = (float)sorted[g_filled - 1];
    st.mean = (float)(sum / (double)g_filled);
    st.p50 = r2d__percentile(sorted, g_filled, 0.50);
    st.p95 = r2d__percentile(sorted, g_filled, 0.95);
    st.p99 = r2d__percentile(sorted, g_filled, 0.99);
    // Текущий кадр — последний закрытый. После переполнения кольца это
    // (g_head - 1), а не последний физический слот.
    st.current = (float)g_real[(g_head + R2D_PROF_WINDOW - 1) % R2D_PROF_WINDOW];
    return st;
}

// --- Hitch-детектор (§18) ---------------------------------------------------
//
// Кольцо последних захватов. Захват открывается на спайке и добирает кадры
// «после» по мере их закрытия; контекст «до» и зоны берутся из того же кольца
// истории, что читает engine.profile().

// Захваты. head — слот следующей записи; count — сколько захватов в кольце.
static R2DHitchCapture g_hitch[R2D_PROF_HITCH_MAX];
static int       g_hitch_head  = 0;
static int       g_hitch_count = 0;
static int       g_hitch_open  = -1;   // захват, которому нужны кадры «после»
static float     g_hitch_threshold = R2D_PROF_HITCH_DEFAULT_MS;
static long long g_hitch_total = 0;
static bool      g_hitch_prev_spike = false;   // прошлый кадр дал захват

// Переносит строку кольца истории (row) в слот захвата.
static void r2d__hitch_fill(R2DHitchCapture *c, int slot, int row, double measured)
{
    c->ms[slot] = (float)measured;
    for (int z = 0; z < R2D_PROF_COUNT; z++) {
        c->zone_ms[slot][z] = (float)g_hist[row][z];
    }
}

// Причина спайка — самая дорогая зона кадра. Если измеренные зоны объясняют
// меньше половины времени кадра, честнее сказать «вне зон» (-1), чем назвать
// случайную зону: остальное — планировщик, события, ожидание вне замеров.
static void r2d__hitch_reason(R2DHitchCapture *c, int row)
{
    double top = 0.0;
    double sum = 0.0;
    int top_zone = -1;
    for (int z = 0; z < R2D_PROF_COUNT; z++) {
        const double v = g_hist[row][z];
        sum += v;
        if (v > top) {
            top = v;
            top_zone = z;
        }
    }
    c->zones_ms = (float)sum;
    c->reason = -1;
    c->reason_ms = 0.0f;
    if (top_zone >= 0 && sum * 2.0 >= (double)c->frame_ms) {
        c->reason = top_zone;
        c->reason_ms = (float)top;
    }
}

// Кадр закрыт: дописать его в открытый захват и, если он сам долгий,
// открыть новый. Вызывается из r2d_prof_frame_end, когда кадр уже лежит в
// кольце по индексу g_head, а g_filled ещё не учитывает этот кадр.
// work — интервал работы этого кадра, real — dt движка.
static void r2d__hitch_frame(double measured, double real, double work)
{
    // 1) Кадр «после» для открытого захвата.
    if (g_hitch_open >= 0) {
        R2DHitchCapture *c = &g_hitch[g_hitch_open];
        if (c->filled < R2D_PROF_HITCH_FRAMES) {
            r2d__hitch_fill(c, c->filled, g_head, measured);
            c->filled++;
        }
        if (c->filled >= R2D_PROF_HITCH_FRAMES) g_hitch_open = -1;
    }

    const double thr = (double)g_hitch_threshold;
    if (measured <= thr) {
        g_hitch_prev_spike = false;
        return;
    }

    // Эхо спайка в dt движка. dt описывает период, который ЗАКОНЧИЛСЯ в начале
    // этого кадра, поэтому долгий кадр виден в нём ещё раз — уже как real_ms
    // следующего. Если сам кадр по зонам короткий, а спайк был только что,
    // это эхо одного события, а не второй долгий кадр.
    if (g_hitch_prev_spike && work <= thr) {
        g_hitch_prev_spike = false;
        return;
    }
    g_hitch_prev_spike = true;

    // 2) Спайк: предыдущий открытый захват закрываем — этот кадр уже стал его
    //    кадром «после», а дальше идёт отдельная история.
    g_hitch_total++;
    g_hitch_open = -1;

    R2DHitchCapture *c = &g_hitch[g_hitch_head];
    memset(c, 0, sizeof(*c));
    c->frame = g_frame_no;
    c->frame_ms = (float)measured;
    c->real_ms = (float)real;
    c->threshold_ms = g_hitch_threshold;
    c->reason = -1;

    // Контекст «до»: на старте профайлера кадров может быть меньше.
    int before = R2D_PROF_HITCH_CONTEXT;
    if (before > g_filled) before = g_filled;
    for (int k = before; k >= 1; k--) {
        const int row = (g_head + R2D_PROF_WINDOW - k) % R2D_PROF_WINDOW;
        r2d__hitch_fill(c, before - k, row, g_span[row]);
    }
    c->center = before;
    r2d__hitch_fill(c, before, g_head, measured);   // сам спайк
    c->filled = before + 1;
    r2d__hitch_reason(c, g_head);

    g_hitch_open = g_hitch_head;
    g_hitch_head = (g_hitch_head + 1) % R2D_PROF_HITCH_MAX;
    if (g_hitch_count < R2D_PROF_HITCH_MAX) g_hitch_count++;
}

float r2d_prof_hitch_threshold(void) { return g_hitch_threshold; }

float r2d_prof_hitch_set_threshold(float ms)
{
    // Мусор (NaN, ноль, отрицательное) порог не меняет: молча превратить его в
    // 1 мс значило бы заваливать кольцо захватами на каждом кадре.
    if (!(ms >= R2D_PROF_HITCH_MIN_MS)) return g_hitch_threshold;
    if (ms > R2D_PROF_HITCH_MAX_MS) ms = R2D_PROF_HITCH_MAX_MS;
    g_hitch_threshold = ms;
    return g_hitch_threshold;
}

int r2d_prof_hitch_count(void) { return g_hitch_count; }

long long r2d_prof_hitch_total(void) { return g_hitch_total; }

bool r2d_prof_hitch_get(int index, R2DHitchCapture *out)
{
    if (!out || index < 0 || index >= g_hitch_count) return false;
    // Индекс 0 — самый старый из хранимых: кольцо пишет в g_hitch_head.
    const int first = (g_hitch_head - g_hitch_count + R2D_PROF_HITCH_MAX)
                      % R2D_PROF_HITCH_MAX;
    *out = g_hitch[(first + index) % R2D_PROF_HITCH_MAX];
    return true;
}

void r2d_prof_hitch_clear(void)
{
    memset(g_hitch, 0, sizeof(g_hitch));
    g_hitch_head = 0;
    g_hitch_count = 0;
    g_hitch_open = -1;
    g_hitch_total = 0;
    g_hitch_prev_spike = false;
}
