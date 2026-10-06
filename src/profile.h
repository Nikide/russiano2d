// ===========================================================================
// Профайлер кадра.
//
// Задача: показать, куда уходит время кадра, не прибегая к внешним инструментам.
// Замеры — на стороне CPU (SDL_GetPerformanceCounter), поэтому они честно
// показывают и запись команд, и JS, и физику; время исполнения на GPU сюда не
// входит (для него нужны timestamp-запросы SDL_GPU — отдельная история).
//
// Зоны фиксированы: так их можно выводить таблицей и сравнивать между кадрами.
// ===========================================================================

#ifndef R2D_PROFILE_H
#define R2D_PROFILE_H

#include <stdbool.h>

// Зоны кадра. Порядок = порядок вывода в оверлее.
typedef enum {
    R2D_PROF_UPDATE = 0,     // JS: логика кадра (onUpdate)
    R2D_PROF_RENDER_JS,      // JS: сборка батча (onRender)
    R2D_PROF_PHYSICS,        // Box2D: шаги мира
    R2D_PROF_ACQUIRE,        // ожидание swapchain (vsync/ограничитель)
    R2D_PROF_UPLOAD,         // копирующий проход: VB/IB, текстуры
    R2D_PROF_DRAW,           // запись draw-команд (мир, UI, пост)
    R2D_PROF_UI,             // ImGui/RmlUi: подготовка интерфейса
    R2D_PROF_OTHER,          // события, ввод, горячая перезагрузка, http
    R2D_PROF_COUNT
} R2DProfileZone;

// Строка снимка: имя зоны, среднее и пик за окно наблюдения.
typedef struct R2DProfileRow {
    const char *name;
    float ms;        // среднее за окно
    float peak;      // максимум за окно
} R2DProfileRow;

void r2d_prof_begin(R2DProfileZone zone);
void r2d_prof_end(R2DProfileZone zone);

// Закрывает кадр: переносит накопленное в окно наблюдения. real_ms — реальное
// время кадра (обычно dt из цикла), чтобы показать неучтённый остаток.
void r2d_prof_frame_end(float real_ms);

// Сброс накопленного (кнопка в оверлее, engine.profileReset()).
void r2d_prof_reset(void);

bool  r2d_prof_enabled(void);
void  r2d_prof_set_enabled(bool on);

// Снимок: сколько строк заполнено (не больше max).
int   r2d_prof_rows(R2DProfileRow *out, int max);
float r2d_prof_frame_ms(void);   // среднее время кадра
float r2d_prof_real_ms(void);        // реальное время кадра (dt)
float r2d_prof_unaccounted_ms(void); // реальное минус сумма зон
int   r2d_prof_frames(void);     // сколько кадров в окне

#endif  // R2D_PROFILE_H
