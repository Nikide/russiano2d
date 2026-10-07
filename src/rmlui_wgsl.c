// ===========================================================================
// WGSL-варианты шейдеров RmlUi для веб-сборки.
//
// Зачем это здесь, а не в дереве RmlUi. Бэкенд RmlUi под SDL_GPU
// (Backends/RmlUi_Renderer_SDL_GPU.cpp) знает ровно три формата шейдеров —
// SPIR-V, MSL и DXIL — и на WebGPU-устройстве честно отказывается работать
// («Invalid shader format»). Форматов у RmlUi всего три, шейдеры крошечные,
// поэтому веб-сборка добавляет к ним WGSL: тексты живут в движке, а к чужому
// файлу применяется маленькая правка third_party/patches/rmlui-webgpu.patch
// (ветка «если устройство умеет WGSL — спросить у движка»).
//
// Соответствие оригиналу (Backends/RmlUi_SDL_GPU/shader_*.{vert,frag} — HLSL):
//   vert            — две юниформы: матрица (group 1 / binding 0) и перенос
//                     (group 1 / binding 1), атрибуты 0..2, выходы 0..1;
//   frag_color      — просто цвет вершины;
//   frag_texture    — цвет × текстура (group 2: текстура binding 0, сэмплер 1).
//
// Раскладка привязок — та же конвенция SDL_GPU для WGSL, что и в наших
// шейдерах (см. shaders/wgsl/sprite.frag.wgsl): ресурсы фрагментной стадии в
// группе 2, её юниформы в группе 3, юниформы вершинной стадии в группе 1.
// ===========================================================================

#include "rmlui_wgsl.h"

#include <SDL3/SDL_gpu.h>
#include <SDL3/SDL_log.h>
#include <SDL3/SDL_stdinc.h>

// --- Тексты WGSL ------------------------------------------------------------

static const char RMLUI_WGSL_VERT[] =
    // Юниформы объявлены БЕЗ структур-обёрток: разбор WGSL в WebGPU-бэкенде
    // SDL (ветка PR #16020) сам признаётся, что структуры разбирает плохо, а
    // здесь важна точная раскладка привязок. Типы простые: матрица и vec2.
    "@group(1) @binding(0) var<uniform> u_transform: mat4x4<f32>;\n"
    "@group(1) @binding(1) var<uniform> u_translate: vec2<f32>;\n"
    "\n"
    "struct VertexOutput {\n"
    "    @builtin(position) position: vec4<f32>,\n"
    "    @location(0)       color:    vec4<f32>,\n"
    "    @location(1)       texcoord: vec2<f32>,\n"
    "};\n"
    "\n"
    "@vertex\n"
    "fn main(\n"
    "    @location(0) a_position: vec2<f32>,\n"
    "    @location(1) a_color:    vec4<f32>,\n"
    "    @location(2) a_texcoord: vec2<f32>,\n"
    ") -> VertexOutput {\n"
    "    var out: VertexOutput;\n"
    "    let p = vec4<f32>(a_position + u_translate, 0.0, 1.0);\n"
    "    out.position = u_transform * p;\n"
    "    out.color    = a_color;\n"
    "    out.texcoord = a_texcoord;\n"
    "    return out;\n"
    "}\n";

static const char RMLUI_WGSL_FRAG_COLOR[] =
    "@fragment\n"
    "fn main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {\n"
    "    return color;\n"
    "}\n";

static const char RMLUI_WGSL_FRAG_TEXTURE[] =
    "@group(2) @binding(0) var u_texture: texture_2d<f32>;\n"
    "@group(2) @binding(1) var u_sampler: sampler;\n"
    "\n"
    "@fragment\n"
    "fn main(\n"
    "    @location(0) color:    vec4<f32>,\n"
    "    @location(1) texcoord: vec2<f32>,\n"
    ") -> @location(0) vec4<f32> {\n"
    "    return color * textureSample(u_texture, u_sampler, texcoord);\n"
    "}\n";

// Порядок обязан совпадать с enum ShaderType в RmlUi_Renderer_SDL_GPU.cpp:
// 0 — color, 1 — texture, 2 — vert. Поля uniforms/samplers/stage — те же, что
// в таблице shaders[] у RmlUi (иначе SDL_GPU откажется создавать конвейер).
typedef struct R2DRmluiShaderDesc {
    const char       *source;
    Uint32            num_uniform_buffers;
    Uint32            num_samplers;
    SDL_GPUShaderStage stage;
} R2DRmluiShaderDesc;

static const R2DRmluiShaderDesc RMLUI_SHADERS[] = {
    { RMLUI_WGSL_FRAG_COLOR,   0, 0, SDL_GPU_SHADERSTAGE_FRAGMENT },
    { RMLUI_WGSL_FRAG_TEXTURE, 0, 1, SDL_GPU_SHADERSTAGE_FRAGMENT },
    { RMLUI_WGSL_VERT,         2, 0, SDL_GPU_SHADERSTAGE_VERTEX   },
};

SDL_GPUShader *r2d_rmlui_create_wgsl_shader(SDL_GPUDevice *device, int type)
{
    if (!device || type < 0 || type >= (int)SDL_arraysize(RMLUI_SHADERS)) return NULL;

    const R2DRmluiShaderDesc *desc = &RMLUI_SHADERS[type];
    SDL_GPUShaderCreateInfo info;
    SDL_zero(info);
    info.code                = (const Uint8 *)desc->source;
    info.code_size           = SDL_strlen(desc->source);
    info.entrypoint          = "main";
    info.format              = SDL_GPU_SHADERFORMAT_WGSL;
    info.stage               = desc->stage;
    info.num_samplers        = desc->num_samplers;
    info.num_uniform_buffers = desc->num_uniform_buffers;

    SDL_GPUShader *shader = SDL_CreateGPUShader(device, &info);
    if (!shader) {
        SDL_LogError(SDL_LOG_CATEGORY_GPU,
                     "[r2d] RmlUi WGSL: SDL_CreateGPUShader(тип %d): %s",
                     type, SDL_GetError());
    }
    return shader;
}
