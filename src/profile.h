// ===========================================================================
// Профайлер кадра.
//
// Задача: показать, куда уходит время кадра, не прибегая к внешним инструментам.
// Замеры CPU-зон — на стороне CPU (SDL_GetPerformanceCounter), поэтому они честно
// показывают и запись команд, и JS, и физику.
//
// GPU-время. В SDL3 (проверено на 3.4.16 и на ветке main) у SDL_GPU нет
// timestamp-запросов: из «временных» примитивов есть только fence
// (SDL_SubmitGPUCommandBufferAndAcquireFence / SDL_QueryGPUFence). Поэтому
// GPU-время кадра меряется по fence: от отправки командного буфера до его
// фактического сигнала. Опрос идёт в отдельном лёгком потоке, главный поток
// кадр не блокирует; готовый замер забирается со сдвигом 1–2 кадра — та же
// схема «пул на N кадров вперёд», только вместо пула запросов кольцо слотов
// с fence. Замер включает и ожидание в очереди GPU, поэтому в нагруженном
// кадре он чуть больше «чистого» времени проходов.
//
// Если устройство недоступно, fence не получен или замер не успел — строки GPU
// показываются как «н/д» (поле valid = false). Никаких ассертов и падений:
// отсутствие таймингов не должно ломать кадр.
//
// Зоны фиксированы: так их можно выводить таблицей и сравнивать между кадрами.
// ===========================================================================

#ifndef R2D_PROFILE_H
#define R2D_PROFILE_H

#include <stdbool.h>

// Типы SDL_GPU — только по указателю, поэтому хватает предварительных
// объявлений: profile.h не тянет SDL целиком.
typedef struct SDL_GPUDevice SDL_GPUDevice;
typedef struct SDL_GPUFence  SDL_GPUFence;

#ifdef __cplusplus
extern "C" {
#endif

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

// GPU-зоны. Пока одна: fence один на командный буфер, разделить upload/draw/ui
// нечем (для этого нужны timestamp-запросы, которых в SDL3 нет — см. шапку).
typedef enum {
    R2D_PROF_GPU_FRAME = 0,  // весь кадр: upload + draw + ui
    R2D_PROF_GPU_COUNT
} R2DProfileGpuZone;

// Сколько всего строк отдаёт r2d_prof_rows: сначала CPU-зоны, затем GPU.
// Приведение к int: в C++ сложение двух разных enum-типов — ошибка стиля.
#define R2D_PROF_ROW_MAX ((int)R2D_PROF_COUNT + (int)R2D_PROF_GPU_COUNT)

// Строка снимка: имя зоны, среднее и пик за окно наблюдения.
// name/ms/peak — прежние поля, их читают старые потребители; gpu/valid
// добавлены для GPU-строк и для «н/д».
typedef struct R2DProfileRow {
    const char *name;
    float ms;        // среднее за окно
    float peak;      // максимум за окно
    bool  gpu;       // true — строка измерена на GPU
    bool  valid;     // false — данных нет, в оверлее показываем «н/д»
} R2DProfileRow;

void r2d_prof_begin(R2DProfileZone zone);
void r2d_prof_end(R2DProfileZone zone);

// Закрывает кадр: переносит накопленное в окно наблюдения. real_ms — реальное
// время кадра (обычно dt из цикла), чтобы показать неучтённый остаток.
// Здесь же забирается готовый GPU-замер (не блокируя кадр).
void r2d_prof_frame_end(float real_ms);

// Сброс накопленного (кнопка в оверлее, engine.profileReset()).
void r2d_prof_reset(void);

bool  r2d_prof_enabled(void);
void  r2d_prof_set_enabled(bool on);

// Снимок: сколько строк заполнено (не больше max). CPU-зоны идут первыми,
// GPU — после них; порядок внутри групп совпадает с порядком в enum.
int   r2d_prof_rows(R2DProfileRow *out, int max);
float r2d_prof_frame_ms(void);   // среднее время кадра
float r2d_prof_real_ms(void);        // реальное время кадра (dt)
float r2d_prof_unaccounted_ms(void); // реальное минус сумма зон
int   r2d_prof_frames(void);     // сколько кадров в окне

// --- GPU-замер --------------------------------------------------------------
// init вызывается один раз после создания GPU-устройства; device == NULL —
// замера не будет, строки GPU покажут «н/д». Повторный вызов безопасен.
void r2d_prof_gpu_init(SDL_GPUDevice *device);
// Останавливает поток-поллер и отпускает оставшиеся fence. Вызывать до
// уничтожения GPU-устройства (после SDL_WaitForGPUIdle).
void r2d_prof_gpu_shutdown(void);

// Передаёт fence кадра профайлеру. Владение переходит к профайлеру: он сам
// отпустит fence после опроса (или сразу, если замер недоступен/нет места).
// Вызывать только при r2d_prof_enabled(); fence == NULL — кадр без GPU-работы.
void r2d_prof_gpu_submit(SDL_GPUFence *fence);

bool  r2d_prof_gpu_available(void);  // false — GPU-строки показываем как «н/д»
float r2d_prof_gpu_ms(void);         // среднее GPU-время за окно, < 0 — нет данных
int   r2d_prof_gpu_frames(void);     // сколько кадров окна имеют GPU-замер
const char *r2d_prof_gpu_note(void); // короткое пояснение механизма для оверлея

#ifdef __cplusplus
}
#endif

#endif  // R2D_PROFILE_H
