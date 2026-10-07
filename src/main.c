// ===========================================================================
// russiano2d — точка входа.
//
// Схема кадра:
//   1. события SDL и тайминги            (r2d_app_begin_frame)
//   2. фиксированный шаг физики Box2D    (r2d_physics_step)
//   3. JS: onUpdate(dt) → игровая логика (r2d_script_call_update)
//   4. JS: onRender()   → набор батча    (r2d_script_call_render)
//   5. GPU: copy pass → render pass      (спрайты, ImGui, RmlUi)
// ===========================================================================

#include "agent.h"
#include "app.h"
#include "payload.h"
#include "project.h"
#include "json.h"
#include "physics.h"
#include "http.h"
#include "profile.h"
#include "render.h"
#include "script.h"
#include "text.h"
#include "font.h"

#ifdef R2D_ENABLE_IMGUI
#include "debug_ui.h"
#endif
#ifdef R2D_ENABLE_RMLUI
#include "gui.h"
#endif

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>

#include <stdio.h>

#define R2D_FIXED_DT      (1.0f / 60.0f)
#define R2D_MAX_SUBSTEPS  5

// --- Мосты «событие SDL → подсистема» (нужны, чтобы не тащить контекст) ------

#ifdef R2D_ENABLE_RMLUI
static void r2d__gui_event(void *user, const SDL_Event *ev)
{
    r2d_gui_process_event((R2DGui *)user, ev);
}
#endif

#ifdef R2D_ENABLE_IMGUI
static void r2d__debug_event(void *user, const SDL_Event *ev)
{
    r2d_debug_ui_process_event((R2DDebugUI *)user, ev);
}

// Мост для engine.setOverlay(bool) из игры: управляет тем же оверлеем.
static void r2d__set_overlay_requested(void *user, bool visible)
{
    r2d_debug_ui_set_visible((R2DDebugUI *)user, visible);
}
#endif

// --- Перезапуск скриптов по кнопке в оверлее --------------------------------

#ifdef R2D_ENABLE_IMGUI
static void r2d__on_reload_requested(void *user)
{
    R2DScript *s = (R2DScript *)user;
    r2d_script_reload(s);
}
#endif

// --- Опции командной строки -------------------------------------------------

static void r2d__print_usage(const char *exe)
{
    printf(
        "Russiano2D " R2D_VERSION_STRING " — движок и демо-игра\n"
        "\n"
        "Использование: %s [опции]\n"
        "\n"
        "  --game <каталог>   каталог игры (по умолчанию game); точка входа — <каталог>/main.js\n"
        "  --scene <имя>      сразу открыть указанную сцену (см. engine.startScene)\n"
        "  --screenshot <файл> сохранить кадр в PNG и продолжить работу\n"
        "  --screenshot-at <сек>  когда снимать кадр (по умолчанию 2.0)\n"
        "  --overlay          показать отладочный оверлей сразу (иначе F1)\n"
        "  --stats            печатать раз в секунду статистику кадра\n"
        "  --seconds <N>      выйти автоматически через N секунд (для тестов)\n"
        "  --frames <N>       выйти ровно после N кадров\n"
        "  --no-hot-reload    не следить за изменениями .js\n"
        "\n"
        "  --- Режим агента (см. docs/AGENT_API.md) ---\n"
        "  --agent            читать JSON-команды со stdin и отвечать в stdout\n"
        "  --headless         скрытое окно: рендер и скриншоты работают, экран чист\n"
        "  --fixed-dt <сек>   детерминированный шаг времени (например 0.0166666667)\n"
        "  --seed <N>         зерно случайных чисел для $.random\n"
        "\n"
        "  --help             эта справка\n"
        "\n"
        "  --title <текст>    имя окна (иначе берётся из project.json проекта)\n"
        "  --width  <N>       ширина окна, точек\n"
        "  --height <N>       высота окна, точек\n"
        "Базовый каталог берётся из R2D_GAME_DIR, иначе — текущий каталог,\n"
        "если в нём есть game/main.js, иначе каталог исполняемого файла.\n",
        exe);
}

// --- Снимок кадра -----------------------------------------------------------
//
// Копируем уже отрисованный swapchain в transfer-буфер, ждём fence и
// сохраняем PNG. Формат буфера кадра зависит от бэкенда, поэтому его нужно
// привести к подходящему формату поверхности SDL, иначе каналы R и B
// поменяются местами.
static bool r2d__save_screenshot(R2DApp *app, SDL_GPUTransferBuffer *tb,
                                  Uint32 w, Uint32 h, const char *path)
{
    void *pixels = SDL_MapGPUTransferBuffer(app->device, tb, false);
    if (!pixels) {
        R2D_ERROR("SDL_MapGPUTransferBuffer: %s", SDL_GetError());
        return false;
    }

    SDL_PixelFormat format;
    switch (SDL_GetGPUSwapchainTextureFormat(app->device, app->window)) {
    case SDL_GPU_TEXTUREFORMAT_B8G8R8A8_UNORM:
    case SDL_GPU_TEXTUREFORMAT_B8G8R8A8_UNORM_SRGB:
        format = SDL_PIXELFORMAT_BGRA32;
        break;
    default:
        format = SDL_PIXELFORMAT_RGBA32;
        break;
    }

    bool ok = false;
    SDL_Surface *surface = SDL_CreateSurfaceFrom((int)w, (int)h, format, pixels, (int)(w * 4));
    if (!surface) {
        R2D_ERROR("SDL_CreateSurfaceFrom: %s", SDL_GetError());
    } else {
        ok = IMG_SavePNG(surface, path);
        if (!ok) R2D_ERROR("IMG_SavePNG(%s): %s", path, SDL_GetError());
        SDL_DestroySurface(surface);
    }

    SDL_UnmapGPUTransferBuffer(app->device, tb);
    if (ok) R2D_LOG("снимок кадра сохранён: %s (%ux%u)", path, w, h);
    return ok;
}

static void r2d__log_stats(const R2DApp *app, const R2DRenderer *r,
                            const R2DPhysics *p, const R2DAudio *audio){
    R2D_LOG("статистика: %.1f FPS | %.2f мс | спрайтов %d | draw calls %d | вершин %d | "
             "аплоад %.1f КБ | тел %d | текстур %d | звук: каналов %d%s",
             app->fps, app->dt * 1000.0f,
             r->stat_sprites, r->stat_draws, r->stat_vertices,
             (double)r->stat_upload_bytes / 1024.0,
             r2d_physics_live_count(p), r->texture_count,
             r2d_audio_active_channels(audio),
             r2d_audio_music_playing(audio) ? ", музыка играет" : "");
}

// --- Кадр -------------------------------------------------------------------
//
// Один кадр вынесен в отдельную функцию, потому что его гоняют двое: обычный
// цикл (пока открыто окно) и агентский режим (по команде step). Логика кадра
// обязана быть одной и той же — иначе агент проверял бы не то, что видит игрок.

typedef struct FrameContext {
    R2DApp      *app;
    R2DRenderer *renderer;
    R2DPhysics  *physics;
    R2DAudio    *audio;
    R2DScript   *script;
    R2DGui      *gui;
    R2DDebugUI  *debug;

    float  accumulator;
    bool   stats;
    double stats_last;
    bool   auto_shot_taken;   // снимок по --screenshot уже сделан
} FrameContext;

// shot_path != NULL — снять кадр в PNG (использует агент и --screenshot).
static bool r2d__run_frame(FrameContext *fc, const char *shot_path)
{
    R2DApp *app = fc->app;
    if (!app->running) return false;

    r2d_app_begin_frame(app);

    // ВАЖНО: движок не перехватывает Esc и другие игровые клавиши —
    // раскладку ввода определяет игра. Выход — кнопка закрытия окна,
    // engine.quit() или Cmd/Ctrl+Q (обрабатывается SDL на уровне ОС).
    if (r2d_key_pressed(app, SDL_SCANCODE_ESCAPE) &&
        (app->keys_cur[SDL_SCANCODE_LGUI] || app->keys_cur[SDL_SCANCODE_RGUI] ||
         app->keys_cur[SDL_SCANCODE_LCTRL] || app->keys_cur[SDL_SCANCODE_RCTRL])) {
        app->running = false;
        return false;
    }

#ifdef R2D_ENABLE_IMGUI
    if (fc->debug) {
        if (r2d_key_pressed(app, SDL_SCANCODE_F1)) r2d_debug_ui_toggle(fc->debug);
        if (r2d_key_pressed(app, SDL_SCANCODE_F5)) r2d_script_reload(fc->script);
    }
#endif

    // --- HTTP: продвигаем активные запросы, не блокируя кадр ---
    r2d_http_update();

    // --- Физика: фиксированный шаг, чтобы симуляция не зависела от FPS ---
    r2d_prof_begin(R2D_PROF_PHYSICS);
    // Буфер событий контакта копится за все подшаги этого кадра: JS читает его
    // один раз (engine.contacts()), поэтому обнуляем строго здесь.
    r2d_physics_begin_contacts(fc->physics);
    fc->accumulator += app->dt;
    int steps = 0;
    while (fc->accumulator >= R2D_FIXED_DT && steps < R2D_MAX_SUBSTEPS) {
        r2d_physics_step(fc->physics, R2D_FIXED_DT);
        fc->accumulator -= R2D_FIXED_DT;
        steps++;
    }
    if (steps == R2D_MAX_SUBSTEPS) {
        fc->accumulator = 0.0f;   // не копим долг после лага
    }
    if (steps == 0) {
        r2d_physics_sync(fc->physics);
    }
    r2d_prof_end(R2D_PROF_PHYSICS);

    // --- Скрипты ---
    r2d_prof_begin(R2D_PROF_OTHER);
    r2d_script_poll_hot_reload(fc->script, app->dt);
    r2d_prof_end(R2D_PROF_OTHER);

    r2d_prof_begin(R2D_PROF_UPDATE);
    r2d_script_call_update(fc->script, app->dt);
    r2d_prof_end(R2D_PROF_UPDATE);

    r2d_render_begin_frame(fc->renderer, app->width, app->height);
    // Атлас глифов, дорисованный в прошлом кадре, уезжает в GPU до того, как
    // начнётся сборка батча: иначе первые кадры нового кегля были бы пустыми.
    r2d_font_begin_frame();
    r2d_prof_begin(R2D_PROF_RENDER_JS);
    r2d_script_call_render(fc->script);
    r2d_prof_end(R2D_PROF_RENDER_JS);

    // --- GPU ---
    SDL_GPUCommandBuffer *cmd = SDL_AcquireGPUCommandBuffer(app->device);
    if (!cmd) {
        R2D_ERROR("SDL_AcquireGPUCommandBuffer: %s", SDL_GetError());
        app->running = false;
        return false;
    }

    SDL_GPUTexture *swapchain = NULL;
    Uint32 swap_w = 0, swap_h = 0;
    r2d_prof_begin(R2D_PROF_ACQUIRE);
    const bool acquired = SDL_WaitAndAcquireGPUSwapchainTexture(cmd, app->window, &swapchain, &swap_w, &swap_h);
    r2d_prof_end(R2D_PROF_ACQUIRE);
    if (!acquired) {
        R2D_ERROR("SDL_WaitAndAcquireGPUSwapchainTexture: %s", SDL_GetError());
        SDL_SubmitGPUCommandBuffer(cmd);
        return app->running;   // кадр пропущен, но не повод выходить
    }

    // Кадр ImGui начинаем только здесь: ниже мы гарантированно его отрисуем.
    // Если начать раньше, любая ветка с continue оставила бы кадр незакрытым,
    // и следующий NewFrame упал бы с ассертом.
    if (swapchain) {
#ifdef R2D_ENABLE_IMGUI
        r2d_debug_ui_begin(fc->debug, app, fc->renderer, fc->physics, fc->script,
                           r2d__on_reload_requested, fc->script);
#endif
        // Копирующие проходы обязаны идти до открытия render pass.
        r2d_prof_begin(R2D_PROF_UPLOAD);
        r2d_render_upload(fc->renderer, cmd);
        r2d_prof_end(R2D_PROF_UPLOAD);
        r2d_prof_begin(R2D_PROF_DRAW);
#ifdef R2D_ENABLE_IMGUI
        r2d_debug_ui_prepare(fc->debug, cmd);
#endif

        // Lightmap: свет копится в отдельной текстуре и накладывается на сцену
        // одним проходом. Считается до сцены — он от неё не зависит, а читает
        // его композит в конце мирового прохода. Вложить проходы нельзя,
        // поэтому это отдельный проход здесь.
        if (r2d_render_lightmap_enabled(fc->renderer)) {
            r2d_render_draw_lights(fc->renderer, cmd);
        }

        // Пост-обработка: если включена, сцена идёт в offscreen-текстуру, а на
        // экран её накладывает отдельный полноэкранный проход.
        // Render target игры важнее поста: если кадр связан с текстурой игры,
        // мир рисуется туда, а на экран он попадает отдельным блитом
        // (r2d_render_viewport_present). Пост при этом не применяется — его
        // пришлось бы считать по чужой текстуре.
        SDL_GPUTexture *user_target = r2d_render_viewport_target(fc->renderer);
        const bool post = !user_target && r2d_render_post_enabled(fc->renderer);
        SDL_GPUTexture *scene = user_target
            ? user_target
            : (post ? r2d_render_scene_target(fc->renderer, (int)swap_w, (int)swap_h) : NULL);

        SDL_GPUColorTargetInfo target;
        SDL_zero(target);
        target.texture = scene ? scene : swapchain;
        target.clear_color = (SDL_FColor){ fc->renderer->clear_r, fc->renderer->clear_g,
                                           fc->renderer->clear_b, fc->renderer->clear_a };
        target.load_op  = SDL_GPU_LOADOP_CLEAR;
        target.store_op = SDL_GPU_STOREOP_STORE;

        SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
        if (pass) {
            // С постом в offscreen уходит только мир: HUD метится JS-стороной
            // (engine.markUI) и рисуется в отдельном проходе поверх обработки.
            r2d_render_draw_world(fc->renderer, cmd, pass);
            // Композит световой карты: после мира и тумана, но до интерфейса,
            // чтобы HUD не засвечивался светом.
            r2d_render_light_composite(fc->renderer, cmd, pass);
            if (!scene) {
                r2d_render_draw_ui(fc->renderer, cmd, pass);
#ifdef R2D_ENABLE_IMGUI
                r2d_debug_ui_draw(fc->debug, cmd, pass);
#endif
            }
            SDL_EndGPURenderPass(pass);
        }

        if (user_target) {
            // Кадр в текстуре игры: показываем его и сохраняем в историю.
            if (!r2d_render_viewport_present(fc->renderer, cmd, swapchain,
                                             (int)swap_w, (int)swap_h)) {
                R2D_WARN("viewport: не удалось показать кадр");
            }
            SDL_GPURenderPass *upass = NULL;
            SDL_GPUColorTargetInfo hud;
            SDL_zero(hud);
            hud.texture = swapchain;
            hud.load_op  = SDL_GPU_LOADOP_LOAD;      // кадр уже на экране
            hud.store_op = SDL_GPU_STOREOP_STORE;
            upass = SDL_BeginGPURenderPass(cmd, &hud, 1, NULL);
            if (upass) {
                r2d_render_draw_ui(fc->renderer, cmd, upass);
#ifdef R2D_ENABLE_IMGUI
                r2d_debug_ui_draw(fc->debug, cmd, upass);
#endif
                SDL_EndGPURenderPass(upass);
            }
        } else if (scene) {
            // Свечение считается отдельными проходами: проход нельзя вложить в
            // другой проход, поэтому bloom идёт между сценой и пост-обработкой.
            // Не вышло (нет буферов, нет пайплайна) — флаг bloom_ready остаётся
            // нулём, и шейдер поста берёт запасную ветку с восемью выборками.
            float bloomed = 0.0f;
            if (fc->renderer->post.glow > 0.0001f) {
                bloomed = r2d_render_bloom(fc->renderer, cmd) ? 1.0f : 0.0f;
            }
            fc->renderer->post.bloom_ready = bloomed;

            SDL_GPUColorTargetInfo out;
            SDL_zero(out);
            out.texture = swapchain;
            out.clear_color = (SDL_FColor){ fc->renderer->clear_r, fc->renderer->clear_g,
                                            fc->renderer->clear_b, fc->renderer->clear_a };
            out.load_op  = SDL_GPU_LOADOP_CLEAR;
            out.store_op = SDL_GPU_STOREOP_STORE;

            SDL_GPURenderPass *ppass = SDL_BeginGPURenderPass(cmd, &out, 1, NULL);
            if (ppass) {
                r2d_render_post(fc->renderer, cmd, ppass);
                r2d_render_draw_ui(fc->renderer, cmd, ppass);
#ifdef R2D_ENABLE_IMGUI
                r2d_debug_ui_draw(fc->debug, cmd, ppass);
#endif
                SDL_EndGPURenderPass(ppass);
            }
        }
    }

    r2d_prof_end(R2D_PROF_DRAW);

#ifdef R2D_ENABLE_RMLUI
    // RmlUi открывает собственный render pass с LOADOP_LOAD.
    r2d_prof_begin(R2D_PROF_UI);
    r2d_gui_update(fc->gui, (int)swap_w, (int)swap_h);
    r2d_gui_render(fc->gui, cmd, swapchain, swap_w, swap_h);
    r2d_prof_end(R2D_PROF_UI);
#endif

#ifndef R2D_ENABLE_IMGUI
    // Очередь текста разбирает только оверлей (r2d_debug_ui_draw). Без ImGui
    // её не чистит никто: строки копились бы до лимита и висели в памяти.
    r2d_text_clear();
#endif

    // Снимок кадра: копируем swapchain в transfer-буфер тем же командным
    // буфером, а читаем уже после fence.
    const char *shot_to = shot_path;
    if (!shot_to && app->take_screenshot && !fc->auto_shot_taken &&
        app->time >= app->screenshot_at) {
        shot_to = app->screenshot_path;
    }

    SDL_GPUTransferBuffer *shot_tb = NULL;
    if (shot_to && swapchain != NULL) {
        SDL_GPUTransferBufferCreateInfo tbi;
        SDL_zero(tbi);
        tbi.usage = SDL_GPU_TRANSFERBUFFERUSAGE_DOWNLOAD;
        tbi.size  = swap_w * swap_h * 4;
        shot_tb = SDL_CreateGPUTransferBuffer(app->device, &tbi);
        if (shot_tb) {
            SDL_GPUCopyPass *cp = SDL_BeginGPUCopyPass(cmd);
            SDL_GPUTextureRegion src;
            SDL_zero(src);
            src.texture = swapchain;
            src.w = swap_w;
            src.h = swap_h;
            src.d = 1;

            SDL_GPUTextureTransferInfo dst;
            SDL_zero(dst);
            dst.transfer_buffer = shot_tb;
            dst.offset = 0;
            dst.pixels_per_row = swap_w;
            dst.rows_per_layer = swap_h;

            SDL_DownloadFromGPUTexture(cp, &src, &dst);
            SDL_EndGPUCopyPass(cp);
        } else {
            R2D_ERROR("не удалось создать transfer-буфер для снимка: %s", SDL_GetError());
        }
    }

    SDL_GPUFence *fence = SDL_SubmitGPUCommandBufferAndAcquireFence(cmd);
    if (!fence) {
        R2D_ERROR("SDL_SubmitGPUCommandBuffer: %s", SDL_GetError());
        // Командный буфер не отправлен — transfer-буфер снимка тоже освобождаем.
        if (shot_tb) SDL_ReleaseGPUTransferBuffer(app->device, shot_tb);
        app->running = false;
        return false;
    }

    if (shot_tb) {
        SDL_GPUFence *fences[1] = { fence };
        SDL_WaitForGPUFences(app->device, true, fences, 1);
        r2d__save_screenshot(app, shot_tb, swap_w, swap_h, shot_to);
        SDL_ReleaseGPUTransferBuffer(app->device, shot_tb);
        // Автоматический снимок (--screenshot) делается один раз. Раньше здесь
        // сравнивалось shot_to == shot_path, что верно только для агентского
        // пути: кадр снимался каждый кадр, с ожиданием GPU-fence и записью PNG.
        if (!shot_path) fc->auto_shot_taken = true;
    }

    // Fence нужен профайлеру для GPU-замера: он опрашивает его в отдельном
    // потоке и отпускает сам. Выключенный профайлер не получает ничего —
    // никаких запросов к GPU не делается.
    if (r2d_prof_enabled()) r2d_prof_gpu_submit(fence);
    else SDL_ReleaseGPUFence(app->device, fence);

    if (fc->stats) {
        if (app->time - fc->stats_last >= 1.0) {
            fc->stats_last = app->time;
            r2d__log_stats(app, fc->renderer, fc->physics, fc->audio);
        }
    }

    // Закрываем кадр профайлера: dt — реальное время кадра, разница с суммой
    // зон показывает неучтённое (ожидание GPU, планировщик).
    r2d_prof_frame_end(app->dt * 1000.0f);

    return app->running;
}

// Мост для агентского протокола: один кадр, необязательный снимок.
static bool r2d__agent_frame(void *user, const char *shot_path)
{
    return r2d__run_frame((FrameContext *)user, shot_path);
}

int main(int argc, char **argv)
{
    // Подкоманда сборки: `russiano2d build ...` собирает игру в один файл и
    // завершается, не создавая окна (см. src/build.c).
    if (argc > 1 && SDL_strcmp(argv[1], "build") == 0) {
        return r2d_build_main(argc, argv);
    }

    bool   opt_stats = false;
    bool   opt_hot_reload = true;
    bool   opt_agent = false;
    bool   opt_headless = false;
    double opt_seconds = 0.0;
    const char *opt_game = "game";
    const char *opt_scene = NULL;
    const char *opt_title = NULL;      // --title: своё имя окна
    int         opt_width = 0;         // --width/--height: свой размер окна
    int         opt_height = 0;
    const char *opt_screenshot = NULL;
    double opt_screenshot_at = 2.0;
    bool   opt_overlay = false;
    double opt_fixed_dt = 0.0;
    unsigned opt_seed = 0;
    long   opt_frame_limit = 0;

    for (int i = 1; i < argc; ++i) {
        if (SDL_strcmp(argv[i], "--stats") == 0) {
            opt_stats = true;
        } else if (SDL_strcmp(argv[i], "--no-hot-reload") == 0) {
            opt_hot_reload = false;
        } else if (SDL_strcmp(argv[i], "--agent") == 0) {
            opt_agent = true;
        } else if (SDL_strcmp(argv[i], "--headless") == 0) {
            opt_headless = true;
        } else if (SDL_strcmp(argv[i], "--fixed-dt") == 0 && i + 1 < argc) {
            opt_fixed_dt = SDL_atof(argv[++i]);
        } else if (SDL_strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            opt_seed = (unsigned)SDL_strtoul(argv[++i], NULL, 10);
        } else if (SDL_strcmp(argv[i], "--frames") == 0 && i + 1 < argc) {
            opt_frame_limit = SDL_strtol(argv[++i], NULL, 10);
        } else if (SDL_strcmp(argv[i], "--seconds") == 0 && i + 1 < argc) {
            opt_seconds = SDL_atof(argv[++i]);
        } else if (SDL_strcmp(argv[i], "--game") == 0 && i + 1 < argc) {
            opt_game = argv[++i];
        } else if (SDL_strcmp(argv[i], "--scene") == 0 && i + 1 < argc) {
            opt_scene = argv[++i];
        } else if (SDL_strcmp(argv[i], "--title") == 0 && i + 1 < argc) {
            opt_title = argv[++i];
        } else if (SDL_strcmp(argv[i], "--width") == 0 && i + 1 < argc) {
            opt_width = SDL_atoi(argv[++i]);
        } else if (SDL_strcmp(argv[i], "--height") == 0 && i + 1 < argc) {
            opt_height = SDL_atoi(argv[++i]);
        } else if (SDL_strcmp(argv[i], "--screenshot") == 0 && i + 1 < argc) {
            opt_screenshot = argv[++i];
        } else if (SDL_strcmp(argv[i], "--screenshot-at") == 0 && i + 1 < argc) {
            opt_screenshot_at = SDL_atof(argv[++i]);
        } else if (SDL_strcmp(argv[i], "--overlay") == 0) {
            opt_overlay = true;
        } else if (SDL_strcmp(argv[i], "--help") == 0 || SDL_strcmp(argv[i], "-h") == 0) {
            r2d__print_usage(argv[0]);
            return 0;
        } else {
            R2D_WARN("неизвестная опция: %s (см. --help)", argv[i]);
        }
    }

    // В агентском режиме stdout принадлежит протоколу, поэтому перенаправляем
    // его в stderr ДО инициализации подсистем: RmlUi, ImGui и Box2D печатают
    // туда сами, и без этого JSON смешался бы с их сообщениями.
    if (opt_agent) r2d_agent_capture_stdout();

    // Собранная игра носит скрипты и ассеты внутри себя: если груз найден,
    // точка входа берётся из него, а не из --game.
    const bool has_payload = r2d_payload_attach_self();

    // Точка входа выбранной игры: <--game>/main.js
    char entry_relative[1024];
    if (has_payload && r2d_payload_entry()[0]) {
        SDL_snprintf(entry_relative, sizeof entry_relative, "%s", r2d_payload_entry());
    } else {
        SDL_snprintf(entry_relative, sizeof entry_relative, "%s/main.js", opt_game);
    }

    R2DApp app;
    // Имя окна и размер: флаги командной строки старше манифеста проекта,
    // манифест — старше значений по умолчанию. Манифест ищется и в папке
    // проекта, и внутри собранной игры.
    R2dProject project;
    r2d_project_load(&project, opt_game, r2d_payload_entry());

    char window_title[512];
    if (opt_title) {
        SDL_snprintf(window_title, sizeof window_title, "%s", opt_title);
    } else if (project.has_title) {
        SDL_snprintf(window_title, sizeof window_title, "%s", project.title);
    } else {
        SDL_snprintf(window_title, sizeof window_title, "Russiano2D " R2D_VERSION_STRING);
    }

    const int window_width  = opt_width  > 0 ? opt_width  : project.width;
    const int window_height = opt_height > 0 ? opt_height : project.height;

    if (!r2d_app_init(&app, window_title, window_width, window_height, true, opt_headless)) {
        r2d_app_shutdown(&app);
        return 1;
    }
    app.start_scene = opt_scene;   // читается скриптовым слоем как engine.startScene
    app.fixed_dt = (float)opt_fixed_dt;
    app.take_screenshot = (opt_screenshot != NULL);
    app.screenshot_path = opt_screenshot;
    app.screenshot_at = opt_screenshot_at;

    R2DRenderer renderer;
    if (!r2d_render_init(&renderer, app.device, app.window)) {
        R2D_ERROR("не удалось инициализировать рендер");
        r2d_app_shutdown(&app);
        return 1;
    }

    // Шрифты: свой растеризатор глифов (stb_truetype) и атлас. Инициализируем
    // сразу после рендера — текстура атласа создаётся в рендерере.
    r2d_font_init(&renderer, app.base_path);

    R2DPhysics physics;
    // Экранные координаты: +y направлен вниз, поэтому и гравитация «вниз».
    // Значение в пикселях на секунду в квадрате.
    r2d_physics_init(&physics, 0.0f, 2000.0f);

#ifdef R2D_ENABLE_RMLUI
    R2DGui *gui = r2d_gui_create(app.device, app.window, app.base_path);
    if (gui) r2d_app_add_event_listener(&app, r2d__gui_event, gui);
#else
    R2DGui *gui = NULL;
#endif

    // Звук инициализируется до скриптов: игра может сразу запустить музыку.
    R2DAudio audio;
    if (!r2d_audio_init(&audio)) {
        R2D_WARN("звук недоступен — игра продолжится без него");
    }

    // HTTP-клиент: без него $.http сообщает об ошибке, но движок работает.
    if (!r2d_http_init()) {
        R2D_LOG("HTTP недоступен ($.http сообщит об этом игре)");
    }

#ifdef R2D_ENABLE_IMGUI
    // Оверлей по умолчанию скрыт, чтобы не закрывать демо; F1 показывает его.
    R2DDebugUI *debug = r2d_debug_ui_create(app.device, app.window, app.base_path, opt_overlay);
    if (debug) {
        r2d_app_add_event_listener(&app, r2d__debug_event, debug);
        // engine.setOverlay() из игры управляет тем же оверлеем.
        r2d_script_set_overlay_hook(r2d__set_overlay_requested, debug);
    }
#else
    R2DDebugUI *debug = NULL;
#endif

    R2DScript script;
#ifdef R2D_ENABLE_HOTRELOAD
    const bool hot_reload = opt_hot_reload && !opt_agent;
#else
    const bool hot_reload = false;
#endif
    if (!r2d_script_init(&script, &app, &renderer, &physics, gui, &audio,
                          entry_relative, hot_reload,
                          opt_agent, opt_headless, opt_fixed_dt, opt_seed)) {
        R2D_WARN("скрипты не загрузились — окно откроется, но сцена будет пустой");
    }

    FrameContext fc;
    SDL_zero(fc);
    fc.app = &app;
    fc.renderer = &renderer;
    fc.physics = &physics;
    fc.audio = &audio;
    fc.script = &script;
    fc.gui = gui;
    fc.debug = debug;
    fc.stats = opt_stats;

    R2D_LOG("управление: F1 — оверлей, F5 — перезапуск скриптов, закрытие окна — выход");

    // GPU-замер профайлера: fence'ы кадра уходят сюда (см. src/profile.c).
    // Устройства нет — строки GPU в оверлее покажут «н/д».
    r2d_prof_gpu_init(app.device);

    // --- Агентский режим ----------------------------------------------------
    if (opt_agent) {
        R2DAgent *agent = r2d_agent_create(&app, &script);
        if (!agent) {
            R2D_ERROR("не удалось включить агентский режим");
            r2d_script_shutdown(&script);
            r2d_prof_gpu_shutdown();
            r2d_app_shutdown(&app);
            return 1;
        }
        R2D_LOG("агентский режим: команды читаются со stdin, ответы — в stdout");

        // Первый кадр рисуем сразу: без него сцена не построена, а скриншот
        // до первого шага был бы пустым.
        r2d__run_frame(&fc, NULL);
        r2d_agent_signal_ready(agent);

        R2DAgentHooks hooks;
        hooks.user = &fc;
        hooks.frame = r2d__agent_frame;
        r2d_agent_serve(agent, &hooks);

        r2d_script_call_exit(&script);
        r2d_agent_destroy(agent);
        SDL_WaitForGPUIdle(app.device);
        r2d_prof_gpu_shutdown();   // после WaitForGPUIdle: fence'ы уже сигнальны
        r2d_script_shutdown(&script);
#ifdef R2D_ENABLE_IMGUI
        r2d_debug_ui_destroy(debug);
#endif
#ifdef R2D_ENABLE_RMLUI
        r2d_gui_destroy(gui);
#endif
        r2d_font_shutdown();
        r2d_render_shutdown(&renderer);
        r2d_physics_shutdown(&physics);
        r2d_http_shutdown();
        r2d_audio_shutdown(&audio);
        r2d_app_shutdown(&app);
        r2d_payload_shutdown();   // в обычном режиме это делается ниже
        return 0;
    }

    // --- Обычный режим ------------------------------------------------------
    while (app.running) {
        if (!r2d__run_frame(&fc, NULL)) break;

        if (opt_frame_limit > 0 && (long)app.frame >= opt_frame_limit) {
            R2D_LOG("достигнут лимит --frames %ld — выходим", opt_frame_limit);
            break;
        }
        if (opt_seconds > 0.0 && app.time >= opt_seconds) {
            R2D_LOG("достигнут лимит --seconds %.1f — выходим", opt_seconds);
            break;
        }
    }

    // --- Завершение ---
    SDL_WaitForGPUIdle(app.device);
    r2d_prof_gpu_shutdown();   // после WaitForGPUIdle: fence'ы уже сигнальны

    r2d_script_call_exit(&script);
    r2d_script_shutdown(&script);
#ifdef R2D_ENABLE_IMGUI
    r2d_debug_ui_destroy(debug);
#endif
#ifdef R2D_ENABLE_RMLUI
    r2d_gui_destroy(gui);
#endif
    r2d_font_shutdown();   // до рендера: атлас — его текстура
    r2d_render_shutdown(&renderer);
    r2d_physics_shutdown(&physics);
    r2d_http_shutdown();
    r2d_audio_shutdown(&audio);
    r2d_app_shutdown(&app);
    r2d_payload_shutdown();
    return 0;
}
