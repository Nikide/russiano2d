// ===========================================================================
// Отладочный оверлей на Dear ImGui (ТЗ, п. 4.4).
//
// Рисуется тем же SDL_GPU-бэкендом поверх сцены и игрового GUI.
// ===========================================================================
#pragma once

#include "r2d.h"

#include <SDL3/SDL.h>
#include <SDL3/SDL_gpu.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct R2DApp      R2DApp;
typedef struct R2DRenderer R2DRenderer;
typedef struct R2DPhysics  R2DPhysics;
typedef struct R2DScript   R2DScript;
typedef struct R2DDebugUI  R2DDebugUI;

// Колбэк кнопки «Перезапустить скрипты» в оверлее.
typedef void (*R2DDebugReloadFn)(void *user);

R2DDebugUI *r2d_debug_ui_create(SDL_GPUDevice *device, SDL_Window *window,
                                  const char *base_path, bool visible);
void         r2d_debug_ui_destroy(R2DDebugUI *ui);

bool r2d_debug_ui_wants_mouse(const R2DDebugUI *ui);
bool r2d_debug_ui_wants_keyboard(const R2DDebugUI *ui);

// Видимость оверлея. Переключение живёт в главном цикле, а не внутри ImGui:
// пока оверлей скрыт, кадр ImGui вообще не начинается.
void r2d_debug_ui_toggle(R2DDebugUI *ui);
void r2d_debug_ui_set_visible(R2DDebugUI *ui, bool visible);
bool r2d_debug_ui_visible(const R2DDebugUI *ui);

void r2d_debug_ui_process_event(R2DDebugUI *ui, const SDL_Event *ev);

// Строит окна оверлея. Вызывается раз в кадр до r2d_debug_ui_draw().
void r2d_debug_ui_begin(R2DDebugUI *ui, R2DApp *app, R2DRenderer *renderer,
                         R2DPhysics *physics, R2DScript *script,
                         R2DDebugReloadFn reload_fn, void *reload_user);

// Кодирует и рисует накопленный ImGui-кадр в открытый render pass.
// Загрузка вершин/индексов ImGui идёт через copy pass, поэтому вызов
// разделён на два шага: prepare() — до SDL_BeginGPURenderPass, draw() — внутри.
void r2d_debug_ui_prepare(R2DDebugUI *ui, SDL_GPUCommandBuffer *cmd);
void r2d_debug_ui_draw(R2DDebugUI *ui, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass);

#ifdef __cplusplus
}
#endif
