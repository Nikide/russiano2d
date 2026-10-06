// ===========================================================================
// Окно, GPU-устройство, ввод и тайминги.
// ===========================================================================
#pragma once

#include "r2d.h"

#include <SDL3/SDL.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct R2DApp {
    SDL_Window    *window;
    SDL_GPUDevice *device;

    // Подписчики на события SDL (GUI, отладочный оверлей). События
    // разбираются один раз в r2d_app_begin_frame и рассылаются всем.
    void (*event_listeners[8])(void *user, const SDL_Event *ev);
    void  *event_listener_user[8];
    int    event_listener_count;

    char title[256];     // текущее имя окна (его можно менять на ходу)
    bool vsync;          // вертикальная синхронизация презентации
    char cursor[16];     // вид курсора: normal | hidden | crosshair | hand

    int  width;   // логический размер (в точках)
    int  height;
    int  pixel_width;   // размер в пикселях (Retina/HiDPI)
    int  pixel_height;

    bool running;
    bool quit_requested;
    bool headless;       // окно создано скрытым (--headless)

    // --- Детерминированный шаг (--fixed-dt) ---------------------------------
    // > 0 — время идёт ровно на эту величину за кадр, реальные таймеры не
    // читаются. Нужно агентам и CI: один и тот же сценарий даёт один и тот же
    // кадр независимо от загрузки машины.
    float fixed_dt;

    // --- Виртуальный ввод ---------------------------------------------------
    // Наполняется агентским протоколом (src/agent.c) и накладывается поверх
    // настоящего ввода в начале кадра — игра разницы не видит.
    bool     keys_virt[SDL_SCANCODE_COUNT];   // удерживается
    bool     keys_tap[SDL_SCANCODE_COUNT];    // нажатие ровно на один кадр
    uint32_t mouse_virt;                      // маска кнопок
    bool     mouse_virt_active;               // позиция курсора задана агентом
    float    mouse_virt_x, mouse_virt_y;
    float    mouse_virt_dx, mouse_virt_dy;
    float    wheel_virt;

    // --- Тайминги ---
    uint64_t perf_freq;
    uint64_t frame_start;
    double   time;        // секунды с момента старта
    float    dt;          // длительность текущего кадра, сек
    double   fps;         // сглаженный FPS
    uint64_t frame;       // номер кадра

    // --- Клавиатура ---
    bool keys_cur[SDL_SCANCODE_COUNT];
    bool keys_prev[SDL_SCANCODE_COUNT];

    // --- Мышь ---
    float    mouse_x, mouse_y;
    float    mouse_dx, mouse_dy;
    float    wheel_y;
    uint32_t mouse_cur;
    uint32_t mouse_prev;

    // --- Текст с клавиатуры ---
    // SDL присылает готовые UTF-8-символы событием SDL_EVENT_TEXT_INPUT.
    // Копим их за кадр: высокоуровневые <ui.input> читают буфер через
    // engine.textInput(). Без этого текстовые поля пришлось бы собирать из
    // скан-кодов, а раскладка и IME так не работают.
    //
    // Виртуальный ввод (агентская команда text) приходит МЕЖДУ кадрами,
    // поэтому сначала попадает в text_pending, а в text_input переносится
    // на ближайшем begin_frame — иначе его стёрло бы очисткой буфера кадра.
    char text_input[256];
    int  text_input_len;
    char text_pending[256];
    int  text_pending_len;

    // --- Геймпад (первый подключённый) ---
    SDL_Gamepad *gamepad;
    bool  pad_buttons_cur[SDL_GAMEPAD_BUTTON_COUNT];
    bool  pad_buttons_prev[SDL_GAMEPAD_BUTTON_COUNT];
    float pad_axes[SDL_GAMEPAD_AXIS_COUNT];

    // --- Служебное ---
    const char *base_path;   // каталог, относительно которого ищутся game/ и assets/
    bool  base_path_owned;   // base_path выделен нами и освобождается в shutdown
    const char *start_scene; // сцена, которую просят открыть сразу (--scene), или NULL

    // Снимок кадра по расписанию (--screenshot / --screenshot-at). Агентский
    // режим снимает кадры иначе — по команде screenshot.
    bool        take_screenshot;
    const char *screenshot_path;
    double      screenshot_at;
} R2DApp;

// Создаёт окно и GPU-устройство. Возвращает false и печатает причину при ошибке.
// headless — окно создаётся скрытым (агентский режим, CI): рендер, GPU-проход и
// скриншоты работают, но на экране ничего не появляется.
bool r2d_app_init(R2DApp *app, const char *title, int width, int height, bool vsync, bool headless);

// --- Окно -------------------------------------------------------------------
//
// Всё, что делает окно окном, собрано здесь: высокоуровневое API ($.window)
// и скриптовый слой (engine.window.*) — тонкие обёртки над этими вызовами.
// Функции безопасны с NULL и молча ничего не делают, если окна нет
// (например, в headless-режиме оно скрыто, но существует).

void        r2d_app_set_title(R2DApp *app, const char *title);
const char *r2d_app_title(const R2DApp *app);

void r2d_app_set_size(R2DApp *app, int width, int height);
void r2d_app_get_size(const R2DApp *app, int *width, int *height);
void r2d_app_get_pixel_size(const R2DApp *app, int *width, int *height);
void r2d_app_center(R2DApp *app);

void r2d_app_set_fullscreen(R2DApp *app, bool on);
bool r2d_app_is_fullscreen(const R2DApp *app);

void r2d_app_set_position(R2DApp *app, int x, int y);
void r2d_app_get_position(const R2DApp *app, int *x, int *y);

void r2d_app_minimize(R2DApp *app);
void r2d_app_maximize(R2DApp *app);
void r2d_app_restore(R2DApp *app);
void r2d_app_show(R2DApp *app);
void r2d_app_hide(R2DApp *app);
void r2d_app_focus(R2DApp *app);
bool r2d_app_is_visible(const R2DApp *app);
bool r2d_app_is_focused(const R2DApp *app);

void r2d_app_set_resizable(R2DApp *app, bool on);
bool r2d_app_is_resizable(const R2DApp *app);

void        r2d_app_set_vsync(R2DApp *app, bool on);
bool        r2d_app_vsync(const R2DApp *app);

void        r2d_app_set_cursor(R2DApp *app, const char *kind);
void        r2d_app_cursor_set(const char *kind);
void        r2d_app_cursor_visible(bool on);
const char *r2d_app_cursor_name(void);
const char *r2d_app_cursor(const R2DApp *app);

// Освобождает всё, что создал r2d_app_init.
void r2d_app_shutdown(R2DApp *app);

// Начало кадра: копирует предыдущее состояние ввода, разбирает события SDL,
// обновляет тайминги. Вызывать первым делом в каждом кадре.
void r2d_app_begin_frame(R2DApp *app);

// --- Запросы ввода ----------------------------------------------------------
bool  r2d_key_down(const R2DApp *app, SDL_Scancode sc);
bool  r2d_key_pressed(const R2DApp *app, SDL_Scancode sc);   // только в кадре нажатия
bool  r2d_key_released(const R2DApp *app, SDL_Scancode sc);
bool  r2d_mouse_down(const R2DApp *app, int button);         // button: 1=ЛКМ, 2=ПКМ, 3=СКМ
bool  r2d_mouse_pressed(const R2DApp *app, int button);

bool  r2d_pad_down(const R2DApp *app, SDL_GamepadButton button);
bool  r2d_pad_pressed(const R2DApp *app, SDL_GamepadButton button);
float r2d_pad_axis(const R2DApp *app, SDL_GamepadAxis axis);

// --- Виброотклик -------------------------------------------------------------
// low/high и left/right — сила 0..1 (SDL принимает 0..65535). false означает
// «геймпада нет или он не умеет вибрировать» — притворяться, что виброаппарат
// работает, нельзя: игра должна узнать, что её тряска ушла в пустоту.
// duration_ms = 0 останавливает вибрацию.
bool r2d_pad_rumble(R2DApp *app, float low, float high, uint32_t duration_ms);
bool r2d_pad_rumble_triggers(R2DApp *app, float left, float right, uint32_t duration_ms);
bool r2d_pad_connected(const R2DApp *app);

// Текст, введённый с клавиатуры за текущий кадр (UTF-8, уже с учётом
// раскладки и IME). Пустая строка, если ввода не было. Указатель жив до
// следующего r2d_app_begin_frame.
const char *r2d_app_text_input(const R2DApp *app);

// Абсолютный путь к файлу внутри каталога запуска (base_path).
// Результат пишется в out и валиден, пока out не изменён.
void r2d_app_resolve_path(const R2DApp *app, char *out, size_t out_size, const char *relative);

// Подписка на события SDL. Максимум 8 подписчиков; при переполнении — предупреждение.
void r2d_app_add_event_listener(R2DApp *app, void (*fn)(void *user, const SDL_Event *ev), void *user);

// --- Виртуальный ввод (агентский режим) -------------------------------------
// Эти функции не заменяют настоящий ввод, а добавляются к нему: SDL и агент
// могут работать одновременно, и игра не знает, кто нажал клавишу.
// Клавиши, отмеченные до r2d_app_begin_frame, действуют в этом кадре.
void r2d_app_virtual_key(R2DApp *app, SDL_Scancode sc, bool down);   // удерживать
void r2d_app_virtual_tap(R2DApp *app, SDL_Scancode sc);              // ровно один кадр
void r2d_app_virtual_release_all(R2DApp *app);
void r2d_app_virtual_mouse(R2DApp *app, int button, bool down);
void r2d_app_virtual_mouse_pos(R2DApp *app, float x, float y);
void r2d_app_virtual_mouse_move(R2DApp *app, float dx, float dy);
void r2d_app_virtual_wheel(R2DApp *app, float amount);
// Виртуальный ввод текста: нужен агентским тестам <ui.input>, потому что
// синтезировать SDL_EVENT_TEXT_INPUT снаружи нельзя.
void r2d_app_virtual_text(R2DApp *app, const char *utf8);

#ifdef __cplusplus
}
#endif
