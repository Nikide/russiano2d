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
// ===========================================================================

#include "profile.h"
#include "r2d.h"

#include <SDL3/SDL.h>
#include <string.h>

// Окно наблюдения: средние и пики считаются по последним кадрам.
#define R2D_PROF_WINDOW 120

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

static bool   g_enabled = true;
static Uint64 g_freq = 0;

// Текущий кадр.
static Uint64 g_start[R2D_PROF_COUNT];
static bool   g_running[R2D_PROF_COUNT];
static double g_acc[R2D_PROF_COUNT];

// История: последняя колонка — полное время кадра.
static double g_hist[R2D_PROF_WINDOW][R2D_PROF_COUNT + 1];
static double g_real[R2D_PROF_WINDOW];   // реальное время кадра
// GPU-история. -1 — в этом кадре замера не было (в среднее такие кадры не идут).
static double g_hist_gpu[R2D_PROF_WINDOW][R2D_PROF_GPU_COUNT];
static int    g_head = 0;
static int    g_filled = 0;

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

    SDL_LockMutex(g_gpu_lock);
    for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
        if (!g_gpu_slots[i].ready) continue;
        g_gpu_ms = (float)g_gpu_slots[i].elapsed_ms;
        done[n++] = g_gpu_slots[i].fence;
        g_gpu_slots[i].fence = NULL;
        g_gpu_slots[i].ready = false;
    }
    SDL_UnlockMutex(g_gpu_lock);

    for (int i = 0; i < n; i++) {
        if (done[i]) SDL_ReleaseGPUFence(g_gpu_device, done[i]);
    }
}

// Поток-поллер: ждёт сигнала fence и запоминает время. Кадр не блокирует —
// главный поток только передаёт fence и забирает готовое.
static int SDLCALL r2d__gpu_poll_thread(void *user)
{
    SDL_GPUDevice *device = (SDL_GPUDevice *)user;

    for (;;) {
        SDL_WaitSemaphore(g_gpu_wake);
        if (SDL_GetAtomicInt(&g_gpu_stop)) break;

        for (;;) {
            SDL_GPUFence *fence = NULL;
            double submit_ms = 0.0;

            SDL_LockMutex(g_gpu_lock);
            for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
                if (g_gpu_slots[i].fence && !g_gpu_slots[i].ready) {
                    fence = g_gpu_slots[i].fence;
                    submit_ms = g_gpu_slots[i].submit_ms;
                    break;
                }
            }
            SDL_UnlockMutex(g_gpu_lock);

            if (!fence) break;   // всё опрошено — спим до следующего кадра

            while (!SDL_QueryGPUFence(device, fence)) {
                if (SDL_GetAtomicInt(&g_gpu_stop)) return 0;
                SDL_DelayPrecise(R2D_PROF_GPU_POLL_NS);
            }
            const double elapsed = r2d__now_ms() - submit_ms;

            SDL_LockMutex(g_gpu_lock);
            for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
                if (g_gpu_slots[i].fence == fence) {
                    g_gpu_slots[i].elapsed_ms = elapsed;
                    g_gpu_slots[i].ready = true;
                    break;
                }
            }
            SDL_UnlockMutex(g_gpu_lock);
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
        SDL_LockMutex(g_gpu_lock);
        for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
            if (g_gpu_slots[i].fence && g_gpu_device) {
                SDL_ReleaseGPUFence(g_gpu_device, g_gpu_slots[i].fence);
            }
            g_gpu_slots[i].fence = NULL;
            g_gpu_slots[i].ready = false;
            g_gpu_slots[i].elapsed_ms = 0.0;
        }
        SDL_UnlockMutex(g_gpu_lock);
        SDL_DestroyMutex(g_gpu_lock);
        g_gpu_lock = NULL;
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
    SDL_LockMutex(g_gpu_lock);
    for (int i = 0; i < R2D_PROF_GPU_SLOTS; i++) {
        if (g_gpu_slots[i].fence) continue;
        g_gpu_slots[i].fence = fence;
        g_gpu_slots[i].submit_ms = r2d__now_ms();
        g_gpu_slots[i].elapsed_ms = 0.0;
        g_gpu_slots[i].ready = false;
        placed = true;
        break;
    }
    SDL_UnlockMutex(g_gpu_lock);

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
    g_start[zone] = SDL_GetPerformanceCounter();
    g_running[zone] = true;
}

void r2d_prof_end(R2DProfileZone zone)
{
    if (!g_enabled || zone < 0 || zone >= R2D_PROF_COUNT || !g_running[zone]) return;
    const Uint64 freq = g_freq ? g_freq : (g_freq = SDL_GetPerformanceFrequency());
    const double ms = (double)(SDL_GetPerformanceCounter() - g_start[zone]) * 1000.0 / (double)freq;
    g_acc[zone] += ms;
    g_running[zone] = false;
}

void r2d_prof_frame_end(float real_ms)
{
    if (!g_enabled) return;

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
    if (real_ms > 0.0f) g_real[g_head] = (double)real_ms;
    else g_real[g_head] = total;
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
    for (int f = 0; f < R2D_PROF_WINDOW; f++) {
        for (int i = 0; i < R2D_PROF_GPU_COUNT; i++) g_hist_gpu[f][i] = -1.0;
    }
    g_gpu_ms = -1.0f;
    g_head = 0;
    g_filled = 0;
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
