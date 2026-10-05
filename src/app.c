#include "app.h"

#include "payload.h"

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>

// Журнал движка по умолчанию идёт в stdout; агентский режим переключает его
// в stderr, освобождая stdout под протокол (см. src/r2d.h).
bool r2d_log_stderr = false;

// ---------------------------------------------------------------------------
// Инициализация
// ---------------------------------------------------------------------------

static void r2d__pick_base_path(R2DApp *app)
{
    // Порядок поиска: переменная окружения → текущий каталог (удобно при
    // запуске из корня проекта) → каталог исполняемого файла (релиз).
    const char *env = SDL_getenv("R2D_GAME_DIR");
    if (env && *env) {
        app->base_path = env;
        return;
    }

    char *cwd = SDL_GetCurrentDirectory();
    if (cwd) {
        char probe[4096];
        SDL_PathInfo info;
        // Прямой слэш понимают и Windows-версии файловых функций SDL.
        SDL_snprintf(probe, sizeof probe, "%s/game/main.js", cwd);
        if (SDL_GetPathInfo(probe, &info) && info.type == SDL_PATHTYPE_FILE) {
            app->base_path = cwd;
            return;
        }
        SDL_free(cwd);
    }

    // SDL_GetBasePath() возвращает строку, которой владеет SDL.
    app->base_path = SDL_GetBasePath();
}

bool r2d_app_init(R2DApp *app, const char *title, int width, int height, bool vsync, bool headless)
{
    SDL_zero(*app);

    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMEPAD | SDL_INIT_AUDIO)) {
        R2D_ERROR("SDL_Init: %s", SDL_GetError());
        return false;
    }

    app->width  = width;
    app->height = height;
    app->headless = headless;
    app->vsync = vsync;
    SDL_snprintf(app->title, sizeof app->title, "%s", title ? title : "");
    SDL_snprintf(app->cursor, sizeof app->cursor, "normal");

    SDL_WindowFlags flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
    // Скрытое окно: агентам и CI нужен настоящий GPU-проход (скриншоты,
    // проверка кадра), но не нужно ничего показывать на экране.
    if (headless) flags |= SDL_WINDOW_HIDDEN;

    app->window = SDL_CreateWindow(title, width, height, flags);
    if (!app->window) {
        R2D_ERROR("SDL_CreateWindow: %s", SDL_GetError());
        return false;
    }

    // Включаем текстовый ввод: без этого платформа не присылает
    // SDL_EVENT_TEXT_INPUT, и <ui.input> остаётся без символов.
    SDL_StartTextInput(app->window);

    // Просим все три формата шейдеров — SDL выберет тот, что поддержит бэкенд.
    // На macOS это MSL (Metal), на Linux — SPIR-V (Vulkan), на Windows — DXIL.
    SDL_GPUShaderFormat formats =
        SDL_GPU_SHADERFORMAT_SPIRV | SDL_GPU_SHADERFORMAT_MSL | SDL_GPU_SHADERFORMAT_DXIL;

#ifdef NDEBUG
    const bool gpu_debug = false;
#else
    const bool gpu_debug = true;
#endif

    app->device = SDL_CreateGPUDevice(formats, gpu_debug, NULL);
    if (!app->device) {
        R2D_ERROR("SDL_CreateGPUDevice: %s", SDL_GetError());
        return false;
    }

    R2D_LOG("GPU-бэкенд: %s", SDL_GetGPUDeviceDriver(app->device));

    if (!SDL_ClaimWindowForGPUDevice(app->device, app->window)) {
        R2D_ERROR("SDL_ClaimWindowForGPUDevice: %s", SDL_GetError());
        return false;
    }

    const SDL_GPUPresentMode present = vsync ? SDL_GPU_PRESENTMODE_VSYNC
                                             : SDL_GPU_PRESENTMODE_IMMEDIATE;
    if (!SDL_SetGPUSwapchainParameters(app->device, app->window,
                                       SDL_GPU_SWAPCHAINCOMPOSITION_SDR, present)) {
        R2D_WARN("не удалось выставить VSync: %s", SDL_GetError());
    }

    // width/height — логические точки (в них работает игровой код),
    // pixel_width/pixel_height — реальный размер буфера кадра (Retina/HiDPI).
    SDL_GetWindowSize(app->window, &app->width, &app->height);
    SDL_GetWindowSizeInPixels(app->window, &app->pixel_width, &app->pixel_height);
    if (app->width <= 0) app->width = width;
    if (app->height <= 0) app->height = height;

    app->perf_freq   = SDL_GetPerformanceFrequency();
    app->frame_start = SDL_GetPerformanceCounter();
    app->running     = true;
    app->fps         = 0.0;

    r2d__pick_base_path(app);

    // Иконка приложения. Файл лежит рядом с игрой, поэтому грузим её после
    // выбора базового каталога. На macOS SDL ставит её как иконку приложения
    // (док), на Windows и Linux — как иконку окна.
    char icon_path[4096];
    r2d_app_resolve_path(app, icon_path, sizeof icon_path, "assets/icons/russiano2d.png");
    // В собранной игре иконка лежит в грузе — читаем из памяти.
    SDL_Surface *icon = NULL;
    if (r2d_vfs_has(icon_path)) {
        size_t data_size = 0;
        uint8_t *data = r2d_vfs_read(icon_path, &data_size);
        if (data) {
            SDL_IOStream *io = SDL_IOFromConstMem(data, data_size);
            if (io) icon = IMG_Load_IO(io, true);
            r2d_vfs_free(data);
        }
    } else {
        icon = IMG_Load(icon_path);
    }
    if (icon) {
        if (!SDL_SetWindowIcon(app->window, icon)) {
            R2D_WARN("не удалось поставить иконку окна: %s", SDL_GetError());
        }
        SDL_DestroySurface(icon);
    } else {
        // Не ошибка: движок запускается и из каталога без ассетов.
        R2D_WARN("иконка не найдена: %s", icon_path);
    }

    R2D_LOG("окно %dx%d (буфер %dx%d)%s, базовый каталог: %s",
             width, height, app->pixel_width, app->pixel_height,
             headless ? " [скрыто]" : "",
             app->base_path ? app->base_path : "?");
    return true;
}

// ---------------------------------------------------------------------------
// Окно
//
// Тонкие обёртки над SDL: вся политика (кто и когда меняет окно) — в
// высокоуровневом API. Здесь только механика и запоминание состояния, чтобы
// скрипт мог прочитать то, что сам же и поставил (SDL не всегда отдаёт
// симметричный геттер, например у vsync).
// ---------------------------------------------------------------------------

void r2d_app_set_title(R2DApp *app, const char *title)
{
    if (!app || !title) return;
    SDL_snprintf(app->title, sizeof app->title, "%s", title);
    if (app->window) SDL_SetWindowTitle(app->window, app->title);
}

const char *r2d_app_title(const R2DApp *app)
{
    return app ? app->title : "";
}

void r2d_app_set_size(R2DApp *app, int width, int height)
{
    if (!app || !app->window || width <= 0 || height <= 0) return;
    SDL_SetWindowSize(app->window, width, height);
}

void r2d_app_get_size(const R2DApp *app, int *width, int *height)
{
    int w = 0, h = 0;
    if (app && app->window) SDL_GetWindowSize(app->window, &w, &h);
    if (width) *width = w;
    if (height) *height = h;
}

void r2d_app_get_pixel_size(const R2DApp *app, int *width, int *height)
{
    int w = 0, h = 0;
    if (app && app->window) SDL_GetWindowSizeInPixels(app->window, &w, &h);
    if (width) *width = w;
    if (height) *height = h;
}

void r2d_app_center(R2DApp *app)
{
    if (app && app->window) {
        SDL_SetWindowPosition(app->window, SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED);
    }
}

void r2d_app_set_fullscreen(R2DApp *app, bool on)
{
    if (app && app->window) SDL_SetWindowFullscreen(app->window, on);
}

bool r2d_app_is_fullscreen(const R2DApp *app)
{
    if (!app || !app->window) return false;
    return (SDL_GetWindowFlags(app->window) & SDL_WINDOW_FULLSCREEN) != 0;
}

void r2d_app_set_position(R2DApp *app, int x, int y)
{
    if (app && app->window) SDL_SetWindowPosition(app->window, x, y);
}

void r2d_app_get_position(const R2DApp *app, int *x, int *y)
{
    int px = 0, py = 0;
    if (app && app->window) SDL_GetWindowPosition(app->window, &px, &py);
    if (x) *x = px;
    if (y) *y = py;
}

void r2d_app_minimize(R2DApp *app) { if (app && app->window) SDL_MinimizeWindow(app->window); }
void r2d_app_maximize(R2DApp *app) { if (app && app->window) SDL_MaximizeWindow(app->window); }
void r2d_app_restore(R2DApp *app)  { if (app && app->window) SDL_RestoreWindow(app->window); }
void r2d_app_hide(R2DApp *app)     { if (app && app->window) SDL_HideWindow(app->window); }

void r2d_app_show(R2DApp *app)
{
    if (!app || !app->window) return;
    SDL_ShowWindow(app->window);
    // Приподнять: иначе окно может открыться «под» другими.
    SDL_RaiseWindow(app->window);
}

void r2d_app_focus(R2DApp *app)
{
    if (app && app->window) SDL_RaiseWindow(app->window);
}

bool r2d_app_is_visible(const R2DApp *app)
{
    if (!app || !app->window) return false;
    return (SDL_GetWindowFlags(app->window) & SDL_WINDOW_HIDDEN) == 0;
}

bool r2d_app_is_focused(const R2DApp *app)
{
    if (!app || !app->window) return false;
    const SDL_WindowFlags flags = SDL_GetWindowFlags(app->window);
    return (flags & (SDL_WINDOW_INPUT_FOCUS | SDL_WINDOW_MOUSE_FOCUS)) != 0;
}

void r2d_app_set_resizable(R2DApp *app, bool on)
{
    if (app && app->window) SDL_SetWindowResizable(app->window, on);
}

bool r2d_app_is_resizable(const R2DApp *app)
{
    if (!app || !app->window) return false;
    return (SDL_GetWindowFlags(app->window) & SDL_WINDOW_RESIZABLE) != 0;
}

void r2d_app_set_vsync(R2DApp *app, bool on)
{
    if (!app || !app->device || !app->window) return;
    // Режим презентации: SDL пересоздаёт swapchain сам, следующий кадр просто
    // получит новый.
    SDL_SetGPUSwapchainParameters(app->device, app->window,
                                  SDL_GPU_SWAPCHAINCOMPOSITION_SDR,
                                  on ? SDL_GPU_PRESENTMODE_VSYNC
                                     : SDL_GPU_PRESENTMODE_IMMEDIATE);
    app->vsync = on;
}

bool r2d_app_vsync(const R2DApp *app)
{
    return app ? app->vsync : false;
}

void r2d_app_set_cursor(R2DApp *app, const char *kind)
{
    if (!app || !app->window || !kind) return;

    if (SDL_strcmp(kind, "hidden") == 0) {
        SDL_HideCursor();
    } else {
        SDL_ShowCursor();
        SDL_SystemCursor shape = SDL_SYSTEM_CURSOR_DEFAULT;
        if (SDL_strcmp(kind, "crosshair") == 0) shape = SDL_SYSTEM_CURSOR_CROSSHAIR;
        else if (SDL_strcmp(kind, "hand") == 0) shape = SDL_SYSTEM_CURSOR_POINTER;
        else if (SDL_strcmp(kind, "wait") == 0) shape = SDL_SYSTEM_CURSOR_WAIT;
        else if (SDL_strcmp(kind, "text") == 0) shape = SDL_SYSTEM_CURSOR_TEXT;

        SDL_Cursor *cursor = SDL_CreateSystemCursor(shape);
        if (cursor) SDL_SetCursor(cursor);
    }
    SDL_snprintf(app->cursor, sizeof app->cursor, "%s", kind);
}

const char *r2d_app_cursor(const R2DApp *app)
{
    return app ? app->cursor : "normal";
}

void r2d_app_shutdown(R2DApp *app)
{
    if (app->gamepad) {
        SDL_CloseGamepad(app->gamepad);
        app->gamepad = NULL;
    }
    if (app->device) {
        if (app->window) {
            SDL_ReleaseWindowFromGPUDevice(app->device, app->window);
        }
        SDL_DestroyGPUDevice(app->device);
        app->device = NULL;
    }
    if (app->window) {
        SDL_DestroyWindow(app->window);
        app->window = NULL;
    }
    SDL_Quit();
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

static void r2d__open_first_gamepad(R2DApp *app)
{
    if (app->gamepad) return;

    int count = 0;
    SDL_JoystickID *ids = SDL_GetGamepads(&count);
    if (ids) {
        for (int i = 0; i < count; ++i) {
            app->gamepad = SDL_OpenGamepad(ids[i]);
            if (app->gamepad) break;
        }
        SDL_free(ids);
    }
    if (app->gamepad) {
        R2D_LOG("подключён геймпад: %s", SDL_GetGamepadName(app->gamepad));
    }
}

void r2d_app_begin_frame(R2DApp *app)
{
    // Предыдущее состояние ввода нужно для детекта фронтов нажатий.
    SDL_memcpy(app->keys_prev, app->keys_cur, sizeof app->keys_cur);
    SDL_memcpy(app->pad_buttons_prev, app->pad_buttons_cur, sizeof app->pad_buttons_cur);
    app->mouse_prev = app->mouse_cur;

    app->mouse_dx = 0.0f;
    app->mouse_dy = 0.0f;
    app->wheel_y  = 0.0f;

    // Текст копится за кадр: игра читает его через engine.textInput().
    // Виртуальный ввод пришёл между кадрами — переносим его в буфер кадра
    // здесь, иначе очистка стёрла бы его до того, как игра увидит символы.
    if (app->text_pending_len > 0) {
        SDL_memcpy(app->text_input, app->text_pending, (size_t)app->text_pending_len);
        app->text_input_len = app->text_pending_len;
        app->text_input[app->text_input_len] = '\0';
        app->text_pending[0] = '\0';
        app->text_pending_len = 0;
    } else {
        app->text_input[0] = '\0';
        app->text_input_len = 0;
    }

    if (!app->gamepad) {
        r2d__open_first_gamepad(app);
    }

    SDL_Event ev;
    while (SDL_PollEvent(&ev)) {
        for (int i = 0; i < app->event_listener_count; ++i) {
            app->event_listeners[i](app->event_listener_user[i], &ev);
        }

        switch (ev.type) {
        case SDL_EVENT_QUIT:
            app->quit_requested = true;
            break;

        case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
        case SDL_EVENT_WINDOW_RESIZED:
            SDL_GetWindowSizeInPixels(app->window, &app->pixel_width, &app->pixel_height);
            break;

        case SDL_EVENT_MOUSE_MOTION:
            app->mouse_dx += ev.motion.xrel;
            app->mouse_dy += ev.motion.yrel;
            break;

        case SDL_EVENT_MOUSE_WHEEL:
            app->wheel_y += ev.wheel.y;
            break;

        case SDL_EVENT_TEXT_INPUT:
            // Готовый UTF-8 от платформы: раскладка, IME и compose уже учтены.
            if (ev.text.text && *ev.text.text) {
                const int room = (int)sizeof(app->text_input) - 1 - app->text_input_len;
                if (room > 0) {
                    const size_t n = SDL_strlen(ev.text.text);
                    const size_t take = (n < (size_t)room) ? n : (size_t)room;
                    SDL_memcpy(app->text_input + app->text_input_len, ev.text.text, take);
                    app->text_input_len += (int)take;
                    app->text_input[app->text_input_len] = '\0';
                }
            }
            break;

        case SDL_EVENT_GAMEPAD_ADDED:
            r2d__open_first_gamepad(app);
            break;

        case SDL_EVENT_GAMEPAD_REMOVED:
            if (app->gamepad && ev.gdevice.which == SDL_GetGamepadID(app->gamepad)) {
                SDL_CloseGamepad(app->gamepad);
                app->gamepad = NULL;
            }
            break;

        default:
            break;
        }
    }

    // Клавиатура и мышь: снимок текущего состояния.
    const bool *keys = SDL_GetKeyboardState(NULL);
    if (keys) {
        SDL_memcpy(app->keys_cur, keys, sizeof app->keys_cur);
    }

    float mx = 0.0f, my = 0.0f;
    app->mouse_cur = SDL_GetMouseState(&mx, &my);

    // Мышь уже в логических точках — той же системе, что и координаты сцены.
    app->mouse_x = mx;
    app->mouse_y = my;

    if (app->gamepad) {
        for (int b = 0; b < SDL_GAMEPAD_BUTTON_COUNT; ++b) {
            app->pad_buttons_cur[b] = SDL_GetGamepadButton(app->gamepad, (SDL_GamepadButton)b);
        }
        for (int a = 0; a < SDL_GAMEPAD_AXIS_COUNT; ++a) {
            app->pad_axes[a] = SDL_GetGamepadAxis(app->gamepad, (SDL_GamepadAxis)a);
        }
    } else {
        SDL_zero(app->pad_buttons_cur);
        SDL_zero(app->pad_axes);
    }

    // Виртуальный ввод агента накладывается поверх настоящего: игра видит
    // единое состояние, а SDL и агент могут работать одновременно.
    for (int sc = 0; sc < SDL_SCANCODE_COUNT; ++sc) {
        if (app->keys_virt[sc] || app->keys_tap[sc]) app->keys_cur[sc] = true;
    }
    app->mouse_cur |= app->mouse_virt;
    if (app->mouse_virt_active) {
        app->mouse_x = app->mouse_virt_x;
        app->mouse_y = app->mouse_virt_y;
    }
    if (app->mouse_virt_dx != 0.0f || app->mouse_virt_dy != 0.0f) {
        app->mouse_dx += app->mouse_virt_dx;
        app->mouse_dy += app->mouse_virt_dy;
    }
    if (app->wheel_virt != 0.0f) app->wheel_y += app->wheel_virt;

    // Тайминги: dt ограничен сверху, чтобы после паузы/перетаскивания окна
    // физика не получила гигантский шаг и не «взорвалась».
    if (app->fixed_dt > 0.0f) {
        // Детерминированный режим: время идёт ровно на fixed_dt за кадр, а
        // реальные часы не читаются вовсе. Нужно агентам и CI.
        app->dt = app->fixed_dt;
        app->time += app->fixed_dt;
        if (app->fixed_dt > 0.0f) app->fps = 1.0 / app->fixed_dt;
    } else {
        const uint64_t now = SDL_GetPerformanceCounter();
        double dt = (double)(now - app->frame_start) / (double)app->perf_freq;
        app->frame_start = now;
        if (dt > 0.25) dt = 0.25;
        app->dt = (float)dt;
        app->time += dt;

        if (dt > 0.0) {
            const double inst = 1.0 / dt;
            app->fps = (app->fps <= 0.0) ? inst : app->fps * 0.9 + inst * 0.1;
        }
    }

    app->frame++;
    app->running = !app->quit_requested;

    // Разовые нажатия живут один кадр: гасим их сразу после применения, а
    // удерживаемые клавиши остаются до явного отпускания.
    SDL_zero(app->keys_tap);
    app->mouse_virt_dx = 0.0f;
    app->mouse_virt_dy = 0.0f;
    app->wheel_virt = 0.0f;
}

// ---------------------------------------------------------------------------
// Ввод
// ---------------------------------------------------------------------------

bool r2d_key_down(const R2DApp *app, SDL_Scancode sc)
{
    return (sc >= 0 && sc < SDL_SCANCODE_COUNT) ? app->keys_cur[sc] : false;
}

bool r2d_key_pressed(const R2DApp *app, SDL_Scancode sc)
{
    return (sc >= 0 && sc < SDL_SCANCODE_COUNT) ? (app->keys_cur[sc] && !app->keys_prev[sc]) : false;
}

bool r2d_key_released(const R2DApp *app, SDL_Scancode sc)
{
    return (sc >= 0 && sc < SDL_SCANCODE_COUNT) ? (!app->keys_cur[sc] && app->keys_prev[sc]) : false;
}

bool r2d_mouse_down(const R2DApp *app, int button)
{
    const uint32_t mask = SDL_BUTTON_MASK(button);
    return (app->mouse_cur & mask) != 0;
}

bool r2d_mouse_pressed(const R2DApp *app, int button)
{
    const uint32_t mask = SDL_BUTTON_MASK(button);
    return (app->mouse_cur & mask) != 0 && (app->mouse_prev & mask) == 0;
}

bool r2d_pad_down(const R2DApp *app, SDL_GamepadButton button)
{
    return (button >= 0 && button < SDL_GAMEPAD_BUTTON_COUNT) ? app->pad_buttons_cur[button] : false;
}

bool r2d_pad_pressed(const R2DApp *app, SDL_GamepadButton button)
{
    return (button >= 0 && button < SDL_GAMEPAD_BUTTON_COUNT)
               ? (app->pad_buttons_cur[button] && !app->pad_buttons_prev[button])
               : false;
}

float r2d_pad_axis(const R2DApp *app, SDL_GamepadAxis axis)
{
    return (axis >= 0 && axis < SDL_GAMEPAD_AXIS_COUNT) ? app->pad_axes[axis] : 0.0f;
}

void r2d_app_resolve_path(const R2DApp *app, char *out, size_t out_size, const char *relative)
{
    // Абсолютный путь берём как есть: агент и тесты передают именно такие
    // (скриншоты в /tmp), и склеивать их с каталогом игры — заведомая ошибка.
    const bool absolute = relative && (relative[0] == '/' || relative[0] == '\\' ||
#ifdef _WIN32
                                       (SDL_strlen(relative) > 1 && relative[1] == ':')
#else
                                       false
#endif
                                       );
    if (absolute) {
        SDL_snprintf(out, out_size, "%s", relative);
        return;
    }

    if (app->base_path && *app->base_path) {
        const size_t len = SDL_strlen(app->base_path);
        const bool has_sep = len > 0 && (app->base_path[len - 1] == '/' || app->base_path[len - 1] == '\\');
        SDL_snprintf(out, out_size, "%s%s%s", app->base_path, has_sep ? "" : "/", relative);
    } else {
        SDL_snprintf(out, out_size, "%s", relative);
    }
}

void r2d_app_add_event_listener(R2DApp *app, void (*fn)(void *user, const SDL_Event *ev), void *user)
{
    if (!fn) return;
    if (app->event_listener_count >= (int)(sizeof app->event_listeners / sizeof app->event_listeners[0])) {
        R2D_WARN("достигнут лимит подписчиков на события SDL");
        return;
    }
    const int i = app->event_listener_count++;
    app->event_listeners[i] = fn;
    app->event_listener_user[i] = user;
}

// ---------------------------------------------------------------------------
// Виртуальный ввод
// ---------------------------------------------------------------------------

void r2d_app_virtual_key(R2DApp *app, SDL_Scancode sc, bool down)
{
    if (sc < 0 || sc >= SDL_SCANCODE_COUNT) return;
    app->keys_virt[sc] = down;
}

void r2d_app_virtual_tap(R2DApp *app, SDL_Scancode sc)
{
    if (sc < 0 || sc >= SDL_SCANCODE_COUNT) return;
    app->keys_tap[sc] = true;
}

void r2d_app_virtual_release_all(R2DApp *app)
{
    SDL_zero(app->keys_virt);
    SDL_zero(app->keys_tap);
    app->mouse_virt = 0;
}

void r2d_app_virtual_mouse(R2DApp *app, int button, bool down)
{
    const uint32_t mask = SDL_BUTTON_MASK(button);
    if (down) app->mouse_virt |= mask;
    else      app->mouse_virt &= ~mask;
}

void r2d_app_virtual_mouse_pos(R2DApp *app, float x, float y)
{
    app->mouse_virt_active = true;
    app->mouse_virt_x = x;
    app->mouse_virt_y = y;
}

void r2d_app_virtual_mouse_move(R2DApp *app, float dx, float dy)
{
    app->mouse_virt_dx += dx;
    app->mouse_virt_dy += dy;
}

void r2d_app_virtual_wheel(R2DApp *app, float amount)
{
    app->wheel_virt += amount;
}

void r2d_app_virtual_text(R2DApp *app, const char *utf8)
{
    if (!app || !utf8 || !*utf8) return;
    // Пишем в pending: команда приходит между кадрами, а буфер кадра будет
    // очищен на ближайшем begin_frame — там pending и станет вводом кадра.
    const int room = (int)sizeof(app->text_pending) - 1 - app->text_pending_len;
    if (room <= 0) return;
    const size_t n = SDL_strlen(utf8);
    const size_t take = (n < (size_t)room) ? n : (size_t)room;
    SDL_memcpy(app->text_pending + app->text_pending_len, utf8, take);
    app->text_pending_len += (int)take;
    app->text_pending[app->text_pending_len] = '\0';
}

const char *r2d_app_text_input(const R2DApp *app)
{
    if (!app) return "";
    return app->text_input;
}
