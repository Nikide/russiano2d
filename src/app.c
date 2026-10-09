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
    // Во всех случаях base_path — наша копия: строку окружения освобождать
    // нельзя, а r2d_app_shutdown() освобождает base_path единообразно.
    const char *env = SDL_getenv("R2D_GAME_DIR");
    if (env && *env) {
        char *copy = SDL_strdup(env);
        if (copy) {
            app->base_path = copy;
            app->base_path_owned = true;
        }
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
            app->base_path_owned = true;
            return;
        }
        SDL_free(cwd);
    }

    // SDL_GetBasePath() возвращает строку, которую нужно освободить SDL_free().
    app->base_path = SDL_GetBasePath();
    app->base_path_owned = app->base_path != NULL;
}

bool r2d_app_init(R2DApp *app, const char *title, int width, int height, bool vsync,
                  bool headless, const char *gpu_driver)
{
    SDL_zero(*app);
    // Имя бэкенда задаётся СРАЗУ: SDL_zero обнуляет структуру, поэтому
    // записать его до вызова было бы недостаточно.
    if (gpu_driver) SDL_strlcpy(app->gpu_driver, gpu_driver, sizeof app->gpu_driver);

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

    // Просим все форматы шейдеров, которые движок умеет собирать — SDL выберет
    // тот, что поддержит бэкенд: на macOS это MSL (Metal), на Linux — SPIR-V
    // (Vulkan), на Windows — DXIL, в браузере — WGSL (WebGPU).
    SDL_GPUShaderFormat formats =
        SDL_GPU_SHADERFORMAT_SPIRV | SDL_GPU_SHADERFORMAT_MSL |
        SDL_GPU_SHADERFORMAT_DXIL;
#ifdef SDL_GPU_SHADERFORMAT_WGSL
    // WGSL есть только в SDL с WebGPU-бэкендом (ветка PR libsdl-org/SDL#16020):
    // в апстриме такого формата нет, и эта строка там просто не компилируется.
    formats |= SDL_GPU_SHADERFORMAT_WGSL;
#endif

#ifdef NDEBUG
    const bool gpu_debug = false;
#else
    const bool gpu_debug = true;
#endif

    // Выбор бэкенда: `--gpu vulkan` или R2D_GPU. Без явного выбора SDL берёт
    // первый подходящий — обычно это и нужно; при отладке важно уметь назвать
    // бэкенд и получить понятный отказ вместо пустого окна.
    const char *requested = (app->gpu_driver[0] != '\0') ? app->gpu_driver
                                                          : SDL_getenv("R2D_GPU");
    if (requested && requested[0] == '\0') requested = NULL;
    if (requested && SDL_strcasecmp(requested, "d3d12") == 0) requested = "direct3d12";

    if (requested) {
        app->device = SDL_CreateGPUDevice(formats, gpu_debug, requested);
        if (!app->device) {
            // Не «неизвестное имя», а «этот бэкенд здесь не работает»: SDL
            // знает имя (оно есть в списке), но создать устройство не смог.
            R2D_ERROR("SDL_CreateGPUDevice(\"%s\"): %s", requested, SDL_GetError());
            const int count = SDL_GetNumGPUDrivers();
            char list[256] = "";
            for (int i = 0; i < count; ++i) {
                const char *name = SDL_GetGPUDriver(i);
                if (!name) continue;
                SDL_strlcat(list, name, sizeof list);
                if (i + 1 < count) SDL_strlcat(list, ", ", sizeof list);
            }
            R2D_ERROR("бэкенд \"%s\" недоступен в этой сборке или на этой машине. "
                      "Собранные бэкенды: %s", requested, count > 0 ? list : "(ни одного)");
            if (SDL_strcasecmp(requested, "direct3d12") == 0) {
                R2D_ERROR("D3D12 работает только с DXIL: нужна сборка движка с поддержкой "
                          "DXIL (DXC) либо другой бэкенд — --gpu vulkan или --gpu metal");
            }
        }
    } else {
        app->device = SDL_CreateGPUDevice(formats, gpu_debug, NULL);
    }

    if (!app->device) {
        if (!requested) R2D_ERROR("SDL_CreateGPUDevice: %s", SDL_GetError());
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

// Кэш системных курсоров. SDL_CreateSystemCursor() выделяет ресурс, а
// SDL_SetCursor() владение не забирает; раньше курсор создавался на каждый
// вызов, и $.window.cursor() в цикле копил SDL_Cursor/NSCursor без предела.
static SDL_Cursor *g_cursors[SDL_SYSTEM_CURSOR_COUNT];

static void free_cursors(void)
{
    for (int i = 0; i < SDL_SYSTEM_CURSOR_COUNT; ++i) {
        if (g_cursors[i]) SDL_DestroyCursor(g_cursors[i]);
        g_cursors[i] = NULL;
    }
}

// Последнее окно: курсором управляют из скриптов, а R2DApp* им не передать.
static R2DApp *g_cursor_app = NULL;

void r2d_app_set_cursor(R2DApp *app, const char *kind)
{
    if (app) g_cursor_app = app;
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

        SDL_Cursor *cursor = g_cursors[shape];
        if (!cursor) {
            cursor = SDL_CreateSystemCursor(shape);
            g_cursors[shape] = cursor;
        }
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
    free_cursors();
    if (app->base_path_owned) SDL_free((void *)app->base_path);
    app->base_path = NULL;
    app->base_path_owned = false;
    for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
        if (app->gamepads[slot]) {
            SDL_CloseGamepad(app->gamepads[slot]);
            app->gamepads[slot] = NULL;
            app->gamepad_ids[slot] = 0;
        }
    }
    if (app->clipboard) {
        SDL_free(app->clipboard);
        app->clipboard = NULL;
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

static void r2d__open_gamepads(R2DApp *app)
{
    // Открываем до R2D_MAX_GAMEPADS подключённых. Уже открытые слоты не
    // трогаем: иначе переподключение четвёртого закрывало бы первый.
    int count = 0;
    SDL_JoystickID *ids = SDL_GetGamepads(&count);
    if (!ids) return;

    for (int i = 0; i < count; ++i) {
        // Уже открыт в каком-то слоте?
        bool known = false;
        for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
            if (app->gamepads[slot] && app->gamepad_ids[slot] == ids[i]) { known = true; break; }
        }
        if (known) continue;

        for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
            if (app->gamepads[slot]) continue;
            SDL_Gamepad *pad = SDL_OpenGamepad(ids[i]);
            if (!pad) continue;
            app->gamepads[slot] = pad;
            app->gamepad_ids[slot] = ids[i];
            R2D_LOG("подключён геймпад %d: %s", slot, SDL_GetGamepadName(pad));
            break;
        }
    }
    SDL_free(ids);
}

/** Закрыть геймпад по id устройства (отключили физически). */
static void r2d__close_gamepad_id(R2DApp *app, SDL_JoystickID id)
{
    for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
        if (!app->gamepads[slot] || app->gamepad_ids[slot] != id) continue;
        SDL_CloseGamepad(app->gamepads[slot]);
        app->gamepads[slot] = NULL;
        app->gamepad_ids[slot] = 0;
        SDL_zero(app->pad_buttons_cur[slot]);
        SDL_zero(app->pad_buttons_prev[slot]);
        SDL_zero(app->pad_axes[slot]);
        R2D_LOG("геймпад %d отключён", slot);
        return;
    }
}

// Конец разбора ввода: итоговое состояние геймпадов становится «предыдущим»
// для следующего кадра. Делать это раньше нельзя — виртуальный ввод ложится
// поверх опрошенного, и фронт нажатия иначе не виден.
static void r2d__app_end_input(R2DApp *app)
{
    for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
        for (int b = 0; b < SDL_GAMEPAD_BUTTON_COUNT; ++b) {
            // Виртуальную кнопку пропускаем в первом кадре нажатия: иначе
            // «предыдущее» станет true и фронт нажатия не будет виден.
            if (app->pad_virt_buttons[slot][b] && !app->pad_virt_seen[slot][b]) {
                app->pad_virt_seen[slot][b] = true;
                app->pad_buttons_prev[slot][b] = false;
                continue;
            }
            app->pad_buttons_prev[slot][b] = app->pad_buttons_cur[slot][b];
        }
    }
}

// Виртуальная мышь агента для подписчиков SDL-событий. RmlUi получает ввод
// только событиями, а опросное состояние (mouse_virt) его не видит, поэтому
// изменения позиции, кнопок и колеса отправляются тем же путём, что и события
// настоящей мыши: агент может нажимать кнопки интерфейса и крутить его списки.
static void r2d__app_dispatch(R2DApp *app, const SDL_Event *ev)
{
    for (int i = 0; i < app->event_listener_count; ++i) {
        app->event_listeners[i](app->event_listener_user[i], ev);
    }
}

static void r2d__app_forward_virtual_mouse(R2DApp *app)
{
    if (!app->mouse_virt_active) return;
    const Uint64 now = SDL_GetTicksNS();

    if (!app->mouse_virt_sent_pos ||
        app->mouse_virt_sent_x != app->mouse_virt_x || app->mouse_virt_sent_y != app->mouse_virt_y) {
        SDL_Event ev;
        SDL_zero(ev);
        ev.type = SDL_EVENT_MOUSE_MOTION;
        ev.motion.timestamp = now;
        ev.motion.x = app->mouse_virt_x;
        ev.motion.y = app->mouse_virt_y;
        ev.motion.xrel = app->mouse_virt_sent_pos ? app->mouse_virt_x - app->mouse_virt_sent_x : 0.0f;
        ev.motion.yrel = app->mouse_virt_sent_pos ? app->mouse_virt_y - app->mouse_virt_sent_y : 0.0f;
        app->mouse_virt_sent_pos = true;
        app->mouse_virt_sent_x = app->mouse_virt_x;
        app->mouse_virt_sent_y = app->mouse_virt_y;
        r2d__app_dispatch(app, &ev);
    }

    const uint32_t changed = app->mouse_virt ^ app->mouse_virt_sent_buttons;
    for (int b = SDL_BUTTON_LEFT; b <= SDL_BUTTON_X2 && changed; ++b) {
        const uint32_t mask = SDL_BUTTON_MASK(b);
        if (!(changed & mask)) continue;
        SDL_Event ev;
        SDL_zero(ev);
        const bool down = (app->mouse_virt & mask) != 0;
        ev.type = down ? SDL_EVENT_MOUSE_BUTTON_DOWN : SDL_EVENT_MOUSE_BUTTON_UP;
        ev.button.timestamp = now;
        ev.button.button = (Uint8)b;
        ev.button.down = down;
        ev.button.clicks = 1;
        ev.button.x = app->mouse_virt_x;
        ev.button.y = app->mouse_virt_y;
        r2d__app_dispatch(app, &ev);
    }
    app->mouse_virt_sent_buttons = app->mouse_virt;

    if (app->wheel_virt != 0.0f) {
        SDL_Event ev;
        SDL_zero(ev);
        ev.type = SDL_EVENT_MOUSE_WHEEL;
        ev.wheel.timestamp = now;
        ev.wheel.y = app->wheel_virt;
        ev.wheel.mouse_x = app->mouse_virt_x;
        ev.wheel.mouse_y = app->mouse_virt_y;
        r2d__app_dispatch(app, &ev);
    }
}

void r2d_app_begin_frame(R2DApp *app)
{
    // Предыдущее состояние ввода нужно для детекта фронтов нажатий.
    //
    // ВАЖНО: геймпад копируется НЕ здесь, а в конце кадра — после того, как
    // поверх опрошенного состояния лёг виртуальный ввод. Иначе фронт нажатия
    // виртуальной кнопки не виден: «предыдущее» уже было true (нашлось тестом).
    SDL_memcpy(app->keys_prev, app->keys_cur, sizeof app->keys_cur);
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
    // Композиция IME живёт до нового события или конца кадра: очищаем здесь,
    // иначе подчёркнутый предпросмотр «залипал» бы на экране.
    app->text_editing[0] = '\0';
    app->text_editing_len = 0;
    app->text_editing_start = 0;

    r2d__open_gamepads(app);

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
            // Логический размер тоже меняется, а main.c берёт его для
            // ортопроекции кадра, и его же видят engine.width/height. Без
            // этого после ресайза сцена растягивалась, а попадание мыши
            // расходилось с нарисованным.
            SDL_GetWindowSize(app->window, &app->width, &app->height);
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

        case SDL_EVENT_TEXT_EDITING: {
            // Незавершённая композиция IME: показываем подчёркнутой, но текст
            // НЕ вставляем — он придёт событием TEXT_INPUT. Без этого
            // пользователь не видел, что набирает на японском или китайском.
            const char *editing = ev.edit.text ? ev.edit.text : "";
            const size_t n = SDL_strlen(editing);
            const size_t cap = sizeof app->text_editing - 1;
            const size_t take = n > cap ? cap : n;
            SDL_memcpy(app->text_editing, editing, take);
            app->text_editing[take] = '\0';
            app->text_editing_len = (int)take;
            app->text_editing_start = ev.edit.start;
            break;
        }

        case SDL_EVENT_GAMEPAD_ADDED:
            r2d__open_gamepads(app);
            break;

        case SDL_EVENT_GAMEPAD_REMOVED:
            r2d__close_gamepad_id(app, ev.gdevice.which);
            break;

        case SDL_EVENT_FINGER_DOWN:
        case SDL_EVENT_FINGER_MOTION:
        case SDL_EVENT_FINGER_UP: {
            // SDL отдаёт позицию в НОРМАЛИЗОВАННЫХ координатах (0..1): переводим
            // в логические точки окна — той же системы, что мышь и сцена.
            const float fx = ev.tfinger.x * (float)app->width;
            const float fy = ev.tfinger.y * (float)app->height;
            const int index = (int)ev.tfinger.fingerID;
            if (index >= 0 && index < R2D_MAX_TOUCHES) {
                if (ev.type == SDL_EVENT_FINGER_UP) {
                    app->touch_active[index] = false;
                    app->touch_pressure[index] = 0.0f;
                    app->touch_dx[index] = 0.0f;
                    app->touch_dy[index] = 0.0f;
                } else {
                    if (app->touch_active[index]) {
                        app->touch_dx[index] += fx - app->touch_x[index];
                        app->touch_dy[index] += fy - app->touch_y[index];
                    }
                    app->touch_prev_x[index] = app->touch_x[index];
                    app->touch_prev_y[index] = app->touch_y[index];
                    app->touch_active[index] = true;
                    app->touch_x[index] = fx;
                    app->touch_y[index] = fy;
                    app->touch_pressure[index] = ev.tfinger.pressure;
                }
            }
            break;
        }

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

    for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
        if (app->gamepads[slot]) {
            for (int b = 0; b < SDL_GAMEPAD_BUTTON_COUNT; ++b) {
                app->pad_buttons_cur[slot][b] =
                    SDL_GetGamepadButton(app->gamepads[slot], (SDL_GamepadButton)b);
            }
            for (int a = 0; a < SDL_GAMEPAD_AXIS_COUNT; ++a) {
                app->pad_axes[slot][a] =
                    SDL_GetGamepadAxis(app->gamepads[slot], (SDL_GamepadAxis)a);
            }
        } else {
            SDL_zero(app->pad_buttons_cur[slot]);
            SDL_zero(app->pad_axes[slot]);
        }
    }
    // Виртуальный геймпад накладывается поверх опрошенного состояния: у
    // настоящего устройства SDL отдаёт «не нажато», и без этого шага
    // виртуальная кнопка исчезала бы в том же кадре.
    for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
        for (int b = 0; b < SDL_GAMEPAD_BUTTON_COUNT; ++b) {
            if (app->pad_virt_buttons[slot][b]) app->pad_buttons_cur[slot][b] = true;
        }
        for (int a = 0; a < SDL_GAMEPAD_AXIS_COUNT; ++a) {
            if (app->pad_virt_axes[slot][a] != 0.0f) app->pad_axes[slot][a] = app->pad_virt_axes[slot][a];
        }
    }

    // Пальцы: активные точки начинают кадр с нулевым сдвигом. Виртуальные
    // касания живут между кадрами, поэтому переносим их в состояние кадра.
    for (int i = 0; i < R2D_MAX_TOUCHES; ++i) {
        app->touch_dx[i] = 0.0f;
        app->touch_dy[i] = 0.0f;
        if (app->touch_virt[i]) {
            if (app->touch_active[i]) {
                app->touch_dx[i] = app->touch_x[i] - app->touch_prev_x[i];
                app->touch_dy[i] = app->touch_y[i] - app->touch_prev_y[i];
            }
            app->touch_prev_x[i] = app->touch_x[i];
            app->touch_prev_y[i] = app->touch_y[i];
            app->touch_active[i] = true;
        }
    }
    app->touch_count = r2d_app_touch_count(app);

    // Виртуальный ввод агента накладывается поверх настоящего: игра видит
    // единое состояние, а SDL и агент могут работать одновременно.
    for (int sc = 0; sc < SDL_SCANCODE_COUNT; ++sc) {
        if (app->keys_virt[sc] || app->keys_tap[sc]) app->keys_cur[sc] = true;
    }
    r2d__app_forward_virtual_mouse(app);
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
    r2d__app_end_input(app);
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
    // SDL_BUTTON_MASK — это 1u << (button-1): при button вне диапазона сдвиг
    // формально UB, а на практике проверяется чужой бит (button=0 читал бы X2).
    // Кнопка приходит из JS, поэтому проверяем её здесь.
    if (button < SDL_BUTTON_LEFT || button > SDL_BUTTON_X2) return false;
    const uint32_t mask = SDL_BUTTON_MASK(button);
    return (app->mouse_cur & mask) != 0;
}

bool r2d_mouse_pressed(const R2DApp *app, int button)
{
    if (button < SDL_BUTTON_LEFT || button > SDL_BUTTON_X2) return false;
    const uint32_t mask = SDL_BUTTON_MASK(button);
    return (app->mouse_cur & mask) != 0 && (app->mouse_prev & mask) == 0;
}

int r2d_pad_slot_count(void) { return R2D_MAX_GAMEPADS; }

int r2d_app_pad_count(const R2DApp *app)
{
    if (!app) return 0;
    int n = 0;
    for (int slot = 0; slot < R2D_MAX_GAMEPADS; ++slot) {
        if (app->gamepads[slot]) n++;
    }
    return n;
}

bool r2d_app_pad_connected_at(const R2DApp *app, int slot)
{
    if (!app || slot < 0 || slot >= R2D_MAX_GAMEPADS) return false;
    return app->gamepads[slot] != NULL;
}

bool r2d_pad_down_at(const R2DApp *app, int slot, SDL_GamepadButton button)
{
    if (!app || slot < 0 || slot >= R2D_MAX_GAMEPADS) return false;
    if (button < 0 || button >= SDL_GAMEPAD_BUTTON_COUNT) return false;
    return app->pad_buttons_cur[slot][button];
}

bool r2d_pad_pressed_at(const R2DApp *app, int slot, SDL_GamepadButton button)
{
    if (!app || slot < 0 || slot >= R2D_MAX_GAMEPADS) return false;
    if (button < 0 || button >= SDL_GAMEPAD_BUTTON_COUNT) return false;
    return app->pad_buttons_cur[slot][button] && !app->pad_buttons_prev[slot][button];
}

float r2d_pad_axis_at(const R2DApp *app, int slot, SDL_GamepadAxis axis)
{
    if (!app || slot < 0 || slot >= R2D_MAX_GAMEPADS) return 0.0f;
    if (axis < 0 || axis >= SDL_GAMEPAD_AXIS_COUNT) return 0.0f;
    return app->pad_axes[slot][axis];
}

// Слот 0 — «первый геймпад»: старые вызовы остаются рабочими.
bool r2d_pad_down(const R2DApp *app, SDL_GamepadButton button)
{
    return r2d_pad_down_at(app, 0, button);
}

bool r2d_pad_pressed(const R2DApp *app, SDL_GamepadButton button)
{
    return r2d_pad_pressed_at(app, 0, button);
}

float r2d_pad_axis(const R2DApp *app, SDL_GamepadAxis axis)
{
    return r2d_pad_axis_at(app, 0, axis);
}

// --- Касания -----------------------------------------------------------------

bool r2d_app_touch(const R2DApp *app, int index, float *x, float *y)
{
    if (!app || index < 0 || index >= R2D_MAX_TOUCHES || !app->touch_active[index]) return false;
    if (x) *x = app->touch_x[index];
    if (y) *y = app->touch_y[index];
    return true;
}

bool r2d_app_touch_delta(const R2DApp *app, int index, float *dx, float *dy)
{
    if (!app || index < 0 || index >= R2D_MAX_TOUCHES || !app->touch_active[index]) return false;
    if (dx) *dx = app->touch_dx[index];
    if (dy) *dy = app->touch_dy[index];
    return true;
}

float r2d_app_touch_pressure(const R2DApp *app, int index)
{
    if (!app || index < 0 || index >= R2D_MAX_TOUCHES || !app->touch_active[index]) return 0.0f;
    return app->touch_pressure[index];
}

int r2d_app_touch_count(const R2DApp *app)
{
    if (!app) return 0;
    int n = 0;
    for (int i = 0; i < R2D_MAX_TOUCHES; ++i) {
        if (app->touch_active[i]) n++;
    }
    return n;
}

// Сила вибрации: 0..1 из JS → 0..65535 для SDL. Значения за диапазоном
// зажимаем: отрицательную «тряску» SDL понял бы как почти максимальную.
static Uint16 r2d__rumble_amount(float value)
{
    if (!(value > 0.0f)) return 0;                 // NaN и отрицательные — в ноль
    if (value > 1.0f) value = 1.0f;
    return (Uint16)(value * 65535.0f + 0.5f);
}

bool r2d_pad_connected(const R2DApp *app)
{
    return r2d_app_pad_connected_at(app, 0);
}

bool r2d_pad_rumble(R2DApp *app, float low, float high, uint32_t duration_ms)
{
    return r2d_pad_rumble_at(app, 0, low, high, duration_ms);
}

bool r2d_pad_rumble_at(R2DApp *app, int slot, float low, float high, uint32_t duration_ms)
{
    if (!app || slot < 0 || slot >= R2D_MAX_GAMEPADS) return false;
    SDL_Gamepad *pad = app->gamepads[slot];
    if (!pad) return false;
    return SDL_RumbleGamepad(pad, r2d__rumble_amount(low), r2d__rumble_amount(high), duration_ms);
}

bool r2d_pad_rumble_triggers(R2DApp *app, float left, float right, uint32_t duration_ms)
{
    if (!app || !app->gamepads[0]) return false;
    return SDL_RumbleGamepadTriggers(app->gamepads[0], r2d__rumble_amount(left),
                                     r2d__rumble_amount(right), duration_ms);
}

const char *r2d_app_text_editing(const R2DApp *app)
{
    return app ? app->text_editing : "";
}

int r2d_app_text_editing_start(const R2DApp *app)
{
    return app ? app->text_editing_start : 0;
}

void r2d_app_set_text_input_area(R2DApp *app, int x, int y, int w, int h, int cursor)
{
    if (!app || !app->window) return;
    // SDL ждёт прямоугольник в координатах окна; курсор — смещение от начала
    // строки в пикселях. Без этого окно кандидатов IME всплывает в углу.
    const SDL_Rect area = { x, y, w, h };
    SDL_SetTextInputArea(app->window, &area, cursor);
}

const char *r2d_app_clipboard(R2DApp *app)
{
    if (!app) return NULL;
    // Копию отдаёт SDL, освобождает вызывающий. Храним её до следующего
    // чтения: игра читает буфер несколько раз за кадр.
    if (app->clipboard) {
        SDL_free(app->clipboard);
        app->clipboard = NULL;
    }
    char *text = SDL_GetClipboardText();
    app->clipboard = text;
    return text;
}

bool r2d_app_set_clipboard(R2DApp *app, const char *text)
{
    if (!app) return false;
    // Пустая строка — законное значение (очистить буфер), NULL — тоже.
    return SDL_SetClipboardText(text ? text : "");
}

void r2d_app_set_game_path(R2DApp *app, const char *dir)
{
    if (!app) return;
    app->game_path[0] = '\0';
    app->game_path_set = false;
    if (!dir || !*dir) return;

    if (dir[0] == '/' || dir[0] == '\\') {
        SDL_snprintf(app->game_path, sizeof app->game_path, "%s", dir);
    } else {
        // Относительный --game (например, `--game demos`) считается от
        // текущего каталога: так же, как его понимает оболочка.
        char *cwd = SDL_GetCurrentDirectory();
        if (!cwd) return;
        SDL_snprintf(app->game_path, sizeof app->game_path, "%s/%s", cwd, dir);
        SDL_free(cwd);
    }
    // Хвостовой слэш убираем: дальше к пути приклеивается "/".
    size_t len = SDL_strlen(app->game_path);
    while (len > 1 && (app->game_path[len - 1] == '/' || app->game_path[len - 1] == '\\')) {
        app->game_path[--len] = '\0';
    }
    app->game_path_set = true;
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

    // Сначала каталог игры: там лежат ЕЁ ассеты. Проверяем существование
    // файла, а не просто склеиваем путь, — иначе первый же промах увёл бы от
    // встроенных ассетов движка (шрифтов), которые живут в base_path.
    if (app->game_path_set && *app->game_path) {
        char probe[4096];
        SDL_snprintf(probe, sizeof probe, "%s/%s", app->game_path, relative);
        SDL_PathInfo info;
        if (SDL_GetPathInfo(probe, &info)) {
            SDL_snprintf(out, out_size, "%s", probe);
            return;
        }
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

void r2d_app_virtual_touch(R2DApp *app, int id, float x, float y, bool down)
{
    if (!app || id < 0 || id >= R2D_MAX_TOUCHES) return;
    if (!down) {
        app->touch_virt[id] = false;
        app->touch_active[id] = false;
        app->touch_pressure[id] = 0.0f;
        return;
    }
    if (app->touch_virt[id]) {
        app->touch_prev_x[id] = app->touch_x[id];
        app->touch_prev_y[id] = app->touch_y[id];
    }
    app->touch_virt[id] = true;
    app->touch_x[id] = x;
    app->touch_y[id] = y;
    // Виртуальный палец нажат «сильно»: у настоящих касаний давление 0..1, и
    // проверка «палец есть» не должна зависеть от платформы.
    app->touch_pressure[id] = 1.0f;
}

void r2d_app_virtual_touch_clear(R2DApp *app)
{
    if (!app) return;
    for (int i = 0; i < R2D_MAX_TOUCHES; ++i) {
        app->touch_virt[i] = false;
        app->touch_active[i] = false;
        app->touch_pressure[i] = 0.0f;
        app->touch_dx[i] = 0.0f;
        app->touch_dy[i] = 0.0f;
    }
    app->touch_count = 0;
}

void r2d_app_virtual_gamepad(R2DApp *app, int slot, int button, bool down)
{
    if (!app || slot < 0 || slot >= R2D_MAX_GAMEPADS) return;
    if (button < 0 || button >= SDL_GAMEPAD_BUTTON_COUNT) return;
    // Виртуальный геймпад отмечается в состоянии ВВОДА, а не как подключённое
    // устройство: у CI нет настоящего геймпада, но поведение проверять надо.
    // Хранится отдельно и накладывается ПОСЛЕ опроса SDL в начале кадра.
    app->pad_virt_buttons[slot][button] = down;
    if (!down) app->pad_virt_seen[slot][button] = false;
}

void r2d_app_virtual_gamepad_axis(R2DApp *app, int slot, int axis, float value)
{
    if (!app || slot < 0 || slot >= R2D_MAX_GAMEPADS) return;
    if (axis < 0 || axis >= SDL_GAMEPAD_AXIS_COUNT) return;
    app->pad_virt_axes[slot][axis] = value;
}

void r2d_app_virtual_mouse(R2DApp *app, int button, bool down)
{
    if (button < SDL_BUTTON_LEFT || button > SDL_BUTTON_X2) return;
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

// Обёртки для скриптов. Указателя на приложение может не быть (скрипты
// вызывают до/вне кадра), поэтому форму ставим сами, а не через R2DApp.
static char g_cursor_kind[32] = "arrow";

void r2d_app_cursor_set(const char *kind)
{
    if (!kind || !*kind) kind = "arrow";
    if (g_cursor_app) {
        r2d_app_set_cursor(g_cursor_app, kind);
        SDL_snprintf(g_cursor_kind, sizeof g_cursor_kind, "%s", kind);
        return;
    }

    if (SDL_strcmp(kind, "hidden") == 0) { SDL_HideCursor(); }
    else {
        SDL_ShowCursor();
        SDL_SystemCursor shape = SDL_SYSTEM_CURSOR_DEFAULT;
        if (SDL_strcmp(kind, "crosshair") == 0) shape = SDL_SYSTEM_CURSOR_CROSSHAIR;
        else if (SDL_strcmp(kind, "hand") == 0) shape = SDL_SYSTEM_CURSOR_POINTER;
        else if (SDL_strcmp(kind, "wait") == 0) shape = SDL_SYSTEM_CURSOR_WAIT;
        else if (SDL_strcmp(kind, "text") == 0) shape = SDL_SYSTEM_CURSOR_TEXT;
        if (!g_cursors[shape]) g_cursors[shape] = SDL_CreateSystemCursor(shape);
        if (g_cursors[shape]) SDL_SetCursor(g_cursors[shape]);
    }
    SDL_snprintf(g_cursor_kind, sizeof g_cursor_kind, "%s", kind);
}

void r2d_app_cursor_visible(bool on)
{
    if (on) SDL_ShowCursor();
    else SDL_HideCursor();
}

const char *r2d_app_cursor_name(void)
{
    if (g_cursor_app && g_cursor_app->cursor[0]) return g_cursor_app->cursor;
    return g_cursor_kind;
}
