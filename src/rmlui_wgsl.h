// ===========================================================================
// WGSL-варианты шейдеров RmlUi для веб-сборки (см. src/rmlui_wgsl.c).
//
// Объявление отдельным заголовком, потому что его подключает ПАТЧ к чужому
// файлу RmlUi (Backends/RmlUi_Renderer_SDL_GPU.cpp) — см.
// third_party/patches/rmlui-webgpu.patch. Заголовок намеренно без C++:
// патч включён под extern "C"-совместимым объявлением.
// ===========================================================================
#pragma once

#include <SDL3/SDL_gpu.h>

#ifdef __cplusplus
extern "C" {
#endif

// Создаёт шейдер RmlUi в формате WGSL.
// type: 0 — frag_color, 1 — frag_texture, 2 — vert (порядок enum ShaderType
// из RmlUi_Renderer_SDL_GPU.cpp). Возвращает NULL, если SDL отказал.
SDL_GPUShader *r2d_rmlui_create_wgsl_shader(SDL_GPUDevice *device, int type);

#ifdef __cplusplus
}
#endif
