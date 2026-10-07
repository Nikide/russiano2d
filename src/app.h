// ===========================================================================
// Окно, GPU-устройство, ввод и тайминги.
// ===========================================================================
#pragma once

#include "r2d.h"

#include <SDL3/SDL.h>

#ifdef __cplusplus
extern "C" {
#endif

// Сколько геймпадов поддерживаем одновременно (слоты). Больше четырёх в
// локальной игре не нужно, а память на слот — пара килобайт.
#define R2D_MAX_GAMEPADS 4
// Сколько пальцев отслеживаем (SDL отдаёт до 10 мультитачей).
#define R2D_MAX_TOUCHES 10

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
    char gpu_driver[32]; // запрошенный GPU-бэкенд ("" — выбрать автоматически)

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
    char text_input[1024];
    int  text_input_len;
    char text_pending[1024];
    int  text_pending_len;
    // Предпросмотр IME: незавершённая композиция («nihao» → 你好). Игра
    // показывает её подчёркнутой, а сам текст приходит отдельным событием.
    char text_editing[256];
    int  text_editing_len;
    int  text_editing_start;   // где началась композиция, в символах UTF-8

    // Буфер обмена: SDL отдаёт копию, её надо освободить SDL_free. Храним
    // последнее прочитанное значение, чтобы не выделять на каждый кадр.
    char *clipboard;
    bool  clipboard_owned;

    // --- Геймпады (до четырёх: одновременная игра вчетвером) ---
    //
    // Раньше был ОДИН геймпад: «подключён первый» — и всё. Для игры вдвоём-
    // вчетвером этого мало, поэтому слоты: у каждого свои кнопки и оси.
    // Слот 0 дублирует «первый геймпад» — им пользуются старые вызовы
    // engine.padDown и $.input.padDown.
    SDL_Gamepad *gamepads[R2D_MAX_GAMEPADS];
    SDL_JoystickID gamepad_ids[R2D_MAX_GAMEPADS];
    bool  pad_buttons_cur[R2D_MAX_GAMEPADS][SDL_GAMEPAD_BUTTON_COUNT];
    bool  pad_buttons_prev[R2D_MAX_GAMEPADS][SDL_GAMEPAD_BUTTON_COUNT];
    float pad_axes[R2D_MAX_GAMEPADS][SDL_GAMEPAD_AXIS_COUNT];
    // Виртуальный геймпад (агент/CI): накладывается поверх настоящего ввода
    // ПОСЛЕ опроса SDL. Если накладывать до, опрос обнулит состояние: на
    // геймпаде, которого нет, SDL отдаёт «не нажато» (нашлось тестом — виртуальная
    // кнопка исчезала сразу).
    bool  pad_virt_buttons[R2D_MAX_GAMEPADS][SDL_GAMEPAD_BUTTON_COUNT];
    float pad_virt_axes[R2D_MAX_GAMEPADS][SDL_GAMEPAD_AXIS_COUNT];
    // Какие из них уже попали в «предыдущее» состояние. Первый кадр нажатия
    // пропускаем: иначе фронт нажатия не виден (prev уже true).
    bool  pad_virt_seen[R2D_MAX_GAMEPADS][SDL_GAMEPAD_BUTTON_COUNT];

    // --- Касания (до десяти точек) ---
    //
    // Тач-экраны и трекпады отдают пальцы, а не мышь: для мобильных портов и
    // «нарисуй жест» нужны именно они. Храним позицию, предыдущую позицию и
    // сдвиг за кадр.
    // Виртуальные касания отдельно от настоящих: агент задаёт их МЕЖДУ кадрами,
    // а SDL-событий касаний в CI нет, и опрос их бы не перезаписал.
    bool  touch_virt[R2D_MAX_TOUCHES];
    bool  touch_active[R2D_MAX_TOUCHES];
    float touch_x[R2D_MAX_TOUCHES], touch_y[R2D_MAX_TOUCHES];
    float touch_prev_x[R2D_MAX_TOUCHES], touch_prev_y[R2D_MAX_TOUCHES];
    float touch_dx[R2D_MAX_TOUCHES], touch_dy[R2D_MAX_TOUCHES];
    float touch_pressure[R2D_MAX_TOUCHES];
    int   touch_count;

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
// gpu_driver — имя бэкенда ("vulkan", "metal", "d3d12", "" — автоматически).
bool r2d_app_init(R2DApp *app, const char *title, int width, int height, bool vsync,
                  bool headless, const char *gpu_driver);

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

// --- Геймпады по слотам ------------------------------------------------------
// Слот 0 — «первый геймпад» (то же, что старые вызовы выше). Слоты
// соответствуют порядку подключения; после отключения слот освобождается.
int   r2d_pad_slot_count(void);                    // сколько слотов всего
int   r2d_app_pad_count(const R2DApp *app);        // сколько подключено сейчас
bool  r2d_app_pad_connected_at(const R2DApp *app, int slot);
bool  r2d_pad_down_at(const R2DApp *app, int slot, SDL_GamepadButton button);
bool  r2d_pad_pressed_at(const R2DApp *app, int slot, SDL_GamepadButton button);
float r2d_pad_axis_at(const R2DApp *app, int slot, SDL_GamepadAxis axis);
bool  r2d_pad_rumble_at(R2DApp *app, int slot, float low, float high, uint32_t duration_ms);

// --- Касания -----------------------------------------------------------------
// Возвращают false, если точки с таким индексом нет в этом кадре.
bool  r2d_app_touch(const R2DApp *app, int index, float *x, float *y);
bool  r2d_app_touch_delta(const R2DApp *app, int index, float *dx, float *dy);
float r2d_app_touch_pressure(const R2DApp *app, int index);
// Сколько пальцев на экране в этом кадре.
int   r2d_app_touch_count(const R2DApp *app);

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

// Незавершённая композиция IME (предпросмотр). Пустая строка, если композиции
// нет. Требует включённого текстового ввода (SDL_StartTextInput).
const char *r2d_app_text_editing(const R2DApp *app);
// Где начинается композиция (в байтах UTF-8) — для подчёркивания.
int r2d_app_text_editing_start(const R2DApp *app);
// Показать системное окно IME рядом с прямоугольником на экране: без этого
// кандидаты всплывают в углу окна. Координаты — в логических точках окна.
void r2d_app_set_text_input_area(R2DApp *app, int x, int y, int w, int h, int cursor);

// --- Буфер обмена -----------------------------------------------------------
// Текст из буфера обмена (или NULL, если буфера нет/он не текстовый). Указатель
// жив до следующего чтения или shutdown.
const char *r2d_app_clipboard(R2DApp *app);
// Положить текст в буфер обмена. false — платформа отказала.
bool r2d_app_set_clipboard(R2DApp *app, const char *text);

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
// Виртуальные касания: агент не может синтезировать SDL_EVENT_FINGER_*, а
// тач-интерфейс нужно проверять в CI без настоящего экрана.
void r2d_app_virtual_touch(R2DApp *app, int id, float x, float y, bool down);
void r2d_app_virtual_touch_clear(R2DApp *app);
void r2d_app_virtual_gamepad(R2DApp *app, int slot, int button, bool down);
void r2d_app_virtual_gamepad_axis(R2DApp *app, int slot, int axis, float value);

#ifdef __cplusplus
}
#endif
