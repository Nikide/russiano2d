// ===========================================================================
// Dear ImGui: отладочный оверлей (FPS, физика, менеджер текстур, скрипты).
// ===========================================================================

#include "debug_ui.h"

#include "app.h"
#include "icons.h"
#include "physics.h"
#include "profile.h"
#include "render.h"
#include "script.h"
#include "payload.h"
#include "text.h"

#include "imgui.h"
#include "imgui_impl_sdl3.h"
#include "imgui_impl_sdlgpu3.h"

#include <cstdio>

// Начинался ли хотя бы один кадр ImGui: до этого шрифт ещё не выбран, и
// измерять строки нельзя. Нужен r2d_text_measure_ui() из src/text.c.
static bool g_frame_started = false;

static void draw_scene_text(void);

struct R2DDebugUI {
    SDL_GPUDevice *device = nullptr;
    SDL_Window    *window = nullptr;

    bool show_stats = true;
    bool show_physics = true;
    bool show_textures = false;
    bool show_scripts = true;
    bool visible = true;

    // Кадр ImGui идёт всегда, даже когда оверлей скрыт: через него рисуется
    // текст игры ($.gfx.text, $('<text>')). Флаг нужен, чтобы измерять строки
    // шрифтом ImGui только после первого NewFrame.
    bool frame_active = false;

    float gravity[2] = { 0.0f, -9.81f };
    bool  gravity_dirty = false;
};

R2DDebugUI *r2d_debug_ui_create(SDL_GPUDevice *device, SDL_Window *window,
                                  const char *base_path, bool visible)
{
    R2DDebugUI *ui = new R2DDebugUI();
    ui->device = device;
    ui->window = window;
    ui->visible = visible;

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();

    ImGuiIO &io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.IniFilename = nullptr;   // не мусорим imgui.ini рядом с игрой

    // Встроенный шрифт ImGui содержит только латиницу: русский текст в оверлее
    // превращается в вопросительные знаки. Подхватываем тот же Noto Sans,
    // который использует игровой интерфейс.
    bool base_font_loaded = false;

    // Собранная игра: шрифт лежит в грузе, читаем его из памяти.
    for (int i = 0; i < r2d_vfs_count() && !base_font_loaded; ++i) {
        const char *p = r2d_vfs_path_at(i);
        if (!p || !SDL_strstr(p, "assets/fonts/")) continue;
        const size_t len = SDL_strlen(p);
        if (len < 5 || SDL_strcasecmp(p + len - 4, ".ttf") != 0) continue;

        size_t size = 0;
        uint8_t *data = r2d_vfs_read(p, &size);
        if (!data || size == 0) continue;

        ImFontConfig cfg;
        cfg.OversampleH = 2;
        cfg.OversampleV = 1;
        // Данные принадлежат грузу и живут весь процесс — атлас их не трогает.
        cfg.FontDataOwnedByAtlas = false;
        if (io.Fonts->AddFontFromMemoryTTF(data, (int)size, 16.0f, &cfg,
                                           io.Fonts->GetGlyphRangesCyrillic())) {
            R2D_LOG("ImGui: шрифт из груза — %s", p);
            base_font_loaded = true;
        }
    }

    if (!base_font_loaded && base_path && *base_path) {
        char font_path[4096];
        SDL_snprintf(font_path, sizeof font_path,
                     "%s/assets/fonts/NotoSans-Regular.ttf", base_path);

        SDL_PathInfo info;
        if (SDL_GetPathInfo(font_path, &info)) {
            ImFontConfig cfg;
            cfg.OversampleH = 2;
            cfg.OversampleV = 1;
            if (io.Fonts->AddFontFromFileTTF(font_path, 16.0f, &cfg,
                                             io.Fonts->GetGlyphRangesCyrillic())) {
                R2D_LOG("ImGui: шрифт с кириллицей — %s", font_path);
                base_font_loaded = true;
            } else {
                R2D_WARN("ImGui: не удалось загрузить %s", font_path);
            }
        } else {
            R2D_WARN("ImGui: %s не найден — кириллица в оверлее не отрисуется", font_path);
        }
    }

    // Если кириллического шрифта нет (игра без assets/fonts), берём встроенный
    // шрифт ImGui. Это обязательно: MergeMode для иконок требует, чтобы в
    // атласе уже был хотя бы один шрифт, иначе ImGui падает с ассертом.
    bool base_is_default = false;
    if (!base_font_loaded) {
        io.Fonts->AddFontDefault();
        base_is_default = true;
        if (io.Fonts->Fonts.Size == 0) {
            R2D_ERROR("ImGui: не удалось создать ни одного шрифта");
        }
    }

    // Иконки Material Design — тот же встроенный шрифт, что и в RmlUi.
    // MergeMode приклеивает диапазон Private Use Area к основному шрифту.
    if (io.Fonts->Fonts.Size > 0) {
        unsigned int icon_size = 0;
        const unsigned char *icon_data = r2d_icon_font_data(&icon_size);
        if (icon_data && icon_size > 0) {
            static const ImWchar icon_ranges[] = { 0xE000, 0xF8FF, 0 };
            ImFontConfig icon_cfg;
            icon_cfg.MergeMode = true;
            icon_cfg.PixelSnapH = true;
            // Данные статические, атлас не должен пытаться их освободить.
            icon_cfg.FontDataOwnedByAtlas = false;
            // У встроенного шрифта ImGui размер «неявный»: склеивать с ним
            // иконки можно только с нулевым кеглем, иначе ImGui падает с
            // ассертом. У загруженного с диска или из груза шрифта размер
            // задан явно, и туда иконки идут обычным кеглем.
            const float icon_size_px = base_is_default ? 0.0f : 16.0f;
            if (io.Fonts->AddFontFromMemoryTTF((void *)icon_data, (int)icon_size, icon_size_px,
                                               &icon_cfg, icon_ranges)) {
                R2D_LOG("ImGui: иконки Material Design подключены (%d шт.)", r2d_icon_total());
            } else {
                R2D_WARN("ImGui: не удалось подключить встроенные иконки");
            }
        }
    }

    ImGui::StyleColorsDark();
    ImGui::GetStyle().WindowRounding = 4.0f;

    if (!ImGui_ImplSDL3_InitForSDLGPU(window)) {
        R2D_ERROR("ImGui_ImplSDL3_InitForSDLGPU не удалась");
        ImGui::DestroyContext();
        delete ui;
        return nullptr;
    }

    ImGui_ImplSDLGPU3_InitInfo info = {};
    info.Device               = device;
    info.ColorTargetFormat    = SDL_GetGPUSwapchainTextureFormat(device, window);
    info.MSAASamples          = SDL_GPU_SAMPLECOUNT_1;
    info.SwapchainComposition = SDL_GPU_SWAPCHAINCOMPOSITION_SDR;
    info.PresentMode          = SDL_GPU_PRESENTMODE_VSYNC;

    if (!ImGui_ImplSDLGPU3_Init(&info)) {
        R2D_ERROR("ImGui_ImplSDLGPU3_Init не удалась");
        ImGui_ImplSDL3_Shutdown();
        ImGui::DestroyContext();
        delete ui;
        return nullptr;
    }

    R2D_LOG("Dear ImGui готов (%s)", IMGUI_VERSION);
    return ui;
}

void r2d_debug_ui_destroy(R2DDebugUI *ui)
{
    if (!ui) return;
    ImGui_ImplSDLGPU3_Shutdown();
    ImGui_ImplSDL3_Shutdown();
    ImGui::DestroyContext();
    delete ui;
}

bool r2d_debug_ui_wants_mouse(const R2DDebugUI *ui)
{
    if (!ui || !ui->visible) return false;
    return ImGui::GetIO().WantCaptureMouse;
}

void r2d_debug_ui_toggle(R2DDebugUI *ui)
{
    if (ui) ui->visible = !ui->visible;
}

void r2d_debug_ui_set_visible(R2DDebugUI *ui, bool visible)
{
    if (ui) ui->visible = visible;
}

bool r2d_debug_ui_visible(const R2DDebugUI *ui)
{
    return ui && ui->visible;
}

bool r2d_debug_ui_wants_keyboard(const R2DDebugUI *ui)
{
    if (!ui || !ui->visible) return false;
    return ImGui::GetIO().WantCaptureKeyboard;
}

void r2d_debug_ui_process_event(R2DDebugUI *ui, const SDL_Event *ev)
{
    if (!ui || !ev) return;
    ImGui_ImplSDL3_ProcessEvent(ev);
}

// ---------------------------------------------------------------------------

void r2d_debug_ui_begin(R2DDebugUI *ui, R2DApp *app, R2DRenderer *renderer,
                         R2DPhysics *physics, R2DScript *script,
                         R2DDebugReloadFn reload_fn, void *reload_user)
{
    if (!ui) return;
    // Кадр ImGui начинается всегда, независимо от видимости оверлея: в нём
    // живёт текст игрового слоя. Окна оверлея строятся только когда он виден,
    // иначе в draw data попал бы только background draw list с текстом.
    ImGui_ImplSDLGPU3_NewFrame();
    ImGui_ImplSDL3_NewFrame();
    ImGui::NewFrame();
    ui->frame_active = true;
    g_frame_started = true;

    if (ui->visible && ui->show_stats && app) {
        ImGui::SetNextWindowPos(ImVec2(12, 12), ImGuiCond_FirstUseEver);
        // Чуть шире прежнего: в таблицу зон должно влезать имя зоны целиком.
        // Размер задаётся каждый кадр (Cond_Always): высоту окно подбирает по
        // содержимому, а таблица зон растёт, пока профайлер не наберёт окно.
        // С Cond_FirstUseEver высота застывала на первых кадрах, и низ таблицы
        // (строка GPU, итоги) уезжал под сгиб.
        ImGui::SetNextWindowSize(ImVec2(400, 0), ImGuiCond_Always);
        if (ImGui::Begin("russiano2d", &ui->show_stats)) {
            ImGui::Text("FPS: %.1f  (%.2f мс)", app->fps, app->dt * 1000.0f);
            ImGui::Text("Кадр: %llu   Время: %.1f с",
                        (unsigned long long)app->frame, app->time);

            ImGui::Text("GPU: %s", SDL_GetGPUDeviceDriver(app->device));
            ImGui::Text("Буфер: %dx%d", app->pixel_width, app->pixel_height);

            if (renderer) {
                ImGui::SeparatorText("Рендер");
                ImGui::Text("Спрайтов: %d", renderer->stat_sprites);
                ImGui::Text("Draw calls: %d", renderer->stat_draws);
                ImGui::Text("Вершин: %d", renderer->stat_vertices);
                ImGui::Text("Загружено: %.1f КБ", (double)renderer->stat_upload_bytes / 1024.0);
                ImGui::Text("Текстур: %d", renderer->texture_count);
                if (renderer->stat_sprites > 0) {
                    const float ratio = (float)renderer->stat_draws / (float)renderer->stat_sprites;
                    ImGui::Text("Draw/спрайт: %.4f", ratio);
                }
            }

            if (physics) {
                ImGui::SeparatorText("Физика");
                ImGui::Text("Тел живо: %d", r2d_physics_live_count(physics));
            }

            if (script) {
                ImGui::SeparatorText("Скрипты");
                ImGui::Text("Перезагрузок: %llu", (unsigned long long)script->reload_count);
                ImGui::Text("onUpdate: %s   onRender: %s",
                            script->has_update ? "да" : "нет",
                            script->has_render ? "да" : "нет");
            }

            // --- Зоны кадра: CPU и GPU в одной таблице (см. src/profile.h) ---
            // Доли считаются от реального времени кадра: GPU-строка идёт
            // параллельно CPU-зонам, поэтому с суммой зон она не складывается.
            ImGui::SeparatorText("Зоны кадра");
            R2DProfileRow rows[R2D_PROF_ROW_MAX];
            const int row_count = r2d_prof_rows(rows, R2D_PROF_ROW_MAX);
            const float frame_ms = r2d_prof_real_ms();
            if (row_count > 0) {
                if (ImGui::BeginTable("profile_zones", 4,
                                      ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg |
                                          ImGuiTableFlags_SizingStretchProp)) {
                    // Имя зоны тянется по остатку ширины, числа — фиксированы:
                    // так таблица влезает в окно целиком, без обрезки «доли %».
                    ImGui::TableSetupColumn("зона", ImGuiTableColumnFlags_WidthStretch);
                    ImGui::TableSetupColumn("среднее мс", ImGuiTableColumnFlags_WidthFixed, 74);
                    ImGui::TableSetupColumn("пик мс", ImGuiTableColumnFlags_WidthFixed, 58);
                    ImGui::TableSetupColumn("доля %", ImGuiTableColumnFlags_WidthFixed, 56);
                    ImGui::TableHeadersRow();

                    for (int i = 0; i < row_count; ++i) {
                        const R2DProfileRow &row = rows[i];
                        ImGui::TableNextRow();

                        ImGui::TableNextColumn();
                        // GPU-строка бледнее: она измерена не на CPU.
                        if (row.gpu) ImGui::TextDisabled("%s", row.name);
                        else ImGui::TextUnformatted(row.name);

                        ImGui::TableNextColumn();
                        if (row.valid) ImGui::Text("%.2f", row.ms);
                        else ImGui::TextDisabled("н/д");

                        ImGui::TableNextColumn();
                        if (row.valid) ImGui::Text("%.2f", row.peak);
                        else ImGui::TextDisabled("н/д");

                        ImGui::TableNextColumn();
                        if (row.valid && frame_ms > 0.0f)
                            ImGui::Text("%.1f", row.ms * 100.0f / frame_ms);
                        else
                            ImGui::TextDisabled("—");
                    }
                    ImGui::EndTable();
                }
            } else {
                ImGui::TextDisabled("нет данных: кадры ещё не прошли");
            }
            ImGui::Text("Итог кадра: %.2f мс (сумма зон)", r2d_prof_frame_ms());
            ImGui::Text("Реальное время: %.2f мс", frame_ms);
            ImGui::Text("Неучтённый остаток: %.2f мс", r2d_prof_unaccounted_ms());
            ImGui::Text("Кадров в окне: %d", r2d_prof_frames());
            ImGui::TextDisabled("GPU: %s", r2d_prof_gpu_note());
            if (r2d_prof_gpu_available()) {
                ImGui::TextDisabled("Замеров GPU в окне: %d", r2d_prof_gpu_frames());
            }
            if (ImGui::Button("Сбросить профайлер")) r2d_prof_reset();
        }
        ImGui::End();
    }

    if (ui->visible && ui->show_physics && physics) {
        // Правее окна статистики: оно стало шире из-за таблицы зон.
        ImGui::SetNextWindowPos(ImVec2(424, 12), ImGuiCond_FirstUseEver);
        if (ImGui::Begin("Физика (Box2D)", &ui->show_physics)) {
            if (!ui->gravity_dirty) {
                r2d_physics_get_gravity(physics, &ui->gravity[0], &ui->gravity[1]);
            }
            ImGui::Text("Гравитация");
            ImGui::SetNextItemWidth(160);
            ImGui::SliderFloat("x", &ui->gravity[0], -50.0f, 50.0f, "%.2f");
            ImGui::SetNextItemWidth(160);
            ImGui::SliderFloat("y", &ui->gravity[1], -50.0f, 50.0f, "%.2f");
            if (ImGui::IsItemEdited()) ui->gravity_dirty = true;

            if (ImGui::Button("Применить")) {
                r2d_physics_set_gravity(physics, ui->gravity[0], ui->gravity[1]);
                ui->gravity_dirty = false;
            }
            ImGui::SameLine();
            if (ImGui::Button("Земная")) {
                ui->gravity[0] = 0.0f;
                ui->gravity[1] = -9.81f;
                r2d_physics_set_gravity(physics, ui->gravity[0], ui->gravity[1]);
                ui->gravity_dirty = false;
            }
            ImGui::SameLine();
            if (ImGui::Button("Нулевая")) {
                ui->gravity[0] = 0.0f;
                ui->gravity[1] = 0.0f;
                r2d_physics_set_gravity(physics, ui->gravity[0], ui->gravity[1]);
                ui->gravity_dirty = false;
            }
        }
        ImGui::End();
    }

    if (ui->visible && ui->show_textures && renderer) {
        ImGui::SetNextWindowSize(ImVec2(430, 350), ImGuiCond_FirstUseEver);
        if (ImGui::Begin("Текстуры", &ui->show_textures)) {
            if (ImGui::BeginTable("textures", 4,
                                  ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg |
                                      ImGuiTableFlags_SizingFixedFit)) {
                ImGui::TableSetupColumn("#", ImGuiTableColumnFlags_WidthFixed, 28);
                ImGui::TableSetupColumn("Превью", ImGuiTableColumnFlags_WidthFixed, 44);
                ImGui::TableSetupColumn("Размер", ImGuiTableColumnFlags_WidthFixed, 76);
                ImGui::TableSetupColumn("Путь");
                ImGui::TableHeadersRow();

                for (int i = 0; i < renderer->texture_count; ++i) {
                    if (!renderer->textures[i].alive) continue;
                    ImGui::TableNextRow();
                    ImGui::TableNextColumn();
                    ImGui::Text("%d", i);

                    ImGui::TableNextColumn();
                    SDL_GPUTexture *tex = renderer->textures[i].handle;
                    if (tex) {
                        ImGui::Image((ImTextureID)(intptr_t)tex, ImVec2(32, 32));
                    }

                    ImGui::TableNextColumn();
                    ImGui::Text("%dx%d", renderer->textures[i].width, renderer->textures[i].height);

                    ImGui::TableNextColumn();
                    const char *name = renderer->textures[i].name;
                    ImGui::TextUnformatted(name);
                    if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", name);
                }
                ImGui::EndTable();
            }
        }
        ImGui::End();
    }

    if (ui->visible && ui->show_scripts && script) {
        // Правее и ниже окна статистики: оно стало шире из-за таблицы зон и
        // иначе перекрывало бы колонку «доля %».
        ImGui::SetNextWindowPos(ImVec2(424, 300), ImGuiCond_FirstUseEver);
        if (ImGui::Begin("Скрипты (QuickJS)", &ui->show_scripts)) {
            ImGui::TextWrapped("Точка входа: %s", script->entry_path);
            ImGui::Text("Перезагрузок: %llu", (unsigned long long)script->reload_count);

            if (script->last_error[0]) {
                ImGui::SeparatorText("Последняя ошибка");
                ImGui::PushStyleColor(ImGuiCol_Text, IM_COL32(255, 120, 120, 255));
                ImGui::TextWrapped("%s", script->last_error);
                ImGui::PopStyleColor();
            }

            if (ImGui::Button("Перезагрузить скрипты") && reload_fn) {
                reload_fn(reload_user);
            }
            ImGui::SameLine();
            ImGui::TextDisabled("(F5)");
        }
        ImGui::End();
    }

    // Текст игрового слоя ($.gfx.text, узлы <text>) — в background draw list:
    // он рисуется под окнами оверлея и под интерфейсом RmlUi, но поверх сцены.
    draw_scene_text();

    ImGui::Render();
    r2d_text_clear();
}

bool r2d_debug_ui_has_frame(void)
{
    return g_frame_started;
}

// Рисует накопленную за кадр очередь текста (src/text.c).
static void draw_scene_text()
{
    const int count = r2d_text_count();
    if (count <= 0) return;

    ImDrawList *dl = ImGui::GetBackgroundDrawList();
    const R2DTextItem *items = r2d_text_items();
    for (int i = 0; i < count; ++i) {
        const R2DTextItem &it = items[i];
        if (!it.text) continue;

        const ImVec2 size = ImGui::GetFont()->CalcTextSizeA(it.size, FLT_MAX, 0.0f, it.text);
        float x = it.x;
        if (it.align == R2D_TEXT_CENTER) x -= size.x * 0.5f;
        else if (it.align == R2D_TEXT_RIGHT) x -= size.x;

        // Цвет приходит упакованным как RGBA с младшим байтом R (как везде в
        // движке), а ImGui ждёт ABGR в 32 битах — переводим явно.
        const ImU32 col = IM_COL32(it.color & 0xff, (it.color >> 8) & 0xff,
                                   (it.color >> 16) & 0xff, (it.color >> 24) & 0xff);

        // Тень на пиксель вниз-вправо: текст читается на любом фоне.
        dl->AddText(ImGui::GetFont(), it.size, ImVec2(x + 1.0f, it.y + 1.0f),
                    IM_COL32(0, 0, 0, (int)(col >> 24) * 3 / 4), it.text);
        dl->AddText(ImGui::GetFont(), it.size, ImVec2(x, it.y), col, it.text);
    }
}

bool r2d_text_measure_ui(const char *text, float size, float *w, float *h)
{
    if (!text) return false;
    // До первого NewFrame шрифт ImGui ещё не выбран — измерять нечем.
    if (!r2d_debug_ui_has_frame()) return false;

    const ImVec2 s = ImGui::GetFont()->CalcTextSizeA(size, FLT_MAX, 0.0f, text);
    if (w) *w = s.x;
    if (h) *h = s.y;
    return true;
}

void r2d_debug_ui_prepare(R2DDebugUI *ui, SDL_GPUCommandBuffer *cmd)
{
    if (!ui) return;
    ImDrawData *draw_data = ImGui::GetDrawData();
    if (!draw_data || draw_data->CmdListsCount == 0) return;
    // Внутри открывается copy pass — вызывать строго до SDL_BeginGPURenderPass.
    ImGui_ImplSDLGPU3_PrepareDrawData(draw_data, cmd);
}

void r2d_debug_ui_draw(R2DDebugUI *ui, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass)
{
    if (!ui) return;

    ImDrawData *draw_data = ImGui::GetDrawData();
    if (!draw_data || draw_data->CmdListsCount == 0) return;

    ImGui_ImplSDLGPU3_RenderDrawData(draw_data, cmd, pass);
}
