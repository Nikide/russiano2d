// ===========================================================================
// Профайлер кадра: реализация (см. profile.h).
//
// Никаких аллокаций в кадре: история — статический массив, замеры —
// SDL_GetPerformanceCounter. Стоимость включённого профайлера — единицы
// микросекунд на кадр.
// ===========================================================================

#include "profile.h"

#include <SDL3/SDL.h>
#include <string.h>

// Окно наблюдения: средние и пики считаются по последним кадрам.
#define R2D_PROF_WINDOW 120

static const char *ZONE_NAMES[R2D_PROF_COUNT] = {
    "JS: логика",
    "JS: сборка батча",
    "физика (Box2D)",
    "ожидание swapchain",
    "загрузка VB/IB",
    "draw-команды",
    "интерфейс (ImGui/RmlUi)",
    "прочее",
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
static int    g_head = 0;
static int    g_filled = 0;

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

    double total = 0.0;
    for (int i = 0; i < R2D_PROF_COUNT; i++) {
        g_hist[g_head][i] = g_acc[i];
        total += g_acc[i];
        g_acc[i] = 0.0;
        g_running[i] = false;
    }
    g_hist[g_head][R2D_PROF_COUNT] = total;
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
    const int n = max < R2D_PROF_COUNT ? max : R2D_PROF_COUNT;

    for (int i = 0; i < n; i++) {
        double sum = 0.0;
        double peak = 0.0;
        for (int f = 0; f < g_filled; f++) {
            const double v = g_hist[f][i];
            sum += v;
            if (v > peak) peak = v;
        }
        out[i].name = ZONE_NAMES[i];
        out[i].ms = (float)(sum / (double)g_filled);
        out[i].peak = (float)peak;
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
