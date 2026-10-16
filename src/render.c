#include "render.h"
#include "shader_live.h"
#ifdef R2D_ENABLE_RE2D
#include "rotsprite_math.h"
#endif

#include <quickjs.h>
#include "payload.h"
// R2DScript и JS_GetContextOpaque: нужны, чтобы engine.submitSprites/submitTriangles
// (они живут здесь, а не в script.c) достали рендерер из контекста.
#include "script.h"

#include "r2d_shaders.h"

#include <SDL3/SDL_gpu.h>
#include <SDL3_image/SDL_image.h>

#include <math.h>

// ---------------------------------------------------------------------------
// Служебное
// ---------------------------------------------------------------------------

static bool r2d__grow(void **ptr, int *cap, int needed, size_t elem)
{
    if (needed <= *cap) return true;
    int next = (*cap > 0) ? *cap : 64;
    while (next < needed) next *= 2;
    void *p = SDL_realloc(*ptr, (size_t)next * elem);
    if (!p) {
        R2D_ERROR("не хватило памяти (нужно %d элементов по %zu байт)", next, elem);
        return false;
    }
    *ptr = p;
    *cap = next;
    return true;
}

// Цвет вершины из float (0..255) с насыщением вместо переполнения.
static uint8_t r2d__color_f32(float c)
{
    if (!(c > 0.0f)) return 0;      // заодно отсекает NaN
    if (c >= 255.0f) return 255;
    return (uint8_t)(c + 0.5f);
}

// ---------------------------------------------------------------------------
// Режимы смешивания
// ---------------------------------------------------------------------------

int r2d_blend_from_name(const char *name)
{
    // Пустое имя — то же, что аргумент не передан: прежнее альфа-смешивание.
    if (!name || !*name) return R2D_BLEND_ALPHA;
    if (SDL_strcmp(name, "alpha") == 0)    return R2D_BLEND_ALPHA;
    if (SDL_strcmp(name, "add") == 0)      return R2D_BLEND_ADD;
    if (SDL_strcmp(name, "multiply") == 0) return R2D_BLEND_MULTIPLY;
    if (SDL_strcmp(name, "none") == 0)     return R2D_BLEND_NONE;
    return -1;
}

// Заполняет blend_state конвейера под режим. Для alpha значения в точности
// прежние: старые игры рисуются ровно как раньше.
static void r2d__blend_state(SDL_GPUColorTargetBlendState *bs, R2DBlendMode mode)
{
    SDL_zero(*bs);
    switch (mode) {
    case R2D_BLEND_NONE:
        // Без смешивания: src пишется поверх dst как есть (трафарет, маска).
        bs->enable_blend = false;
        return;

    case R2D_BLEND_ADD:
        // src * src_alpha + dst. Альфа вершины ОБЯЗАНА ослаблять вклад: без
        // этого полупрозрачное свечение (фонарь, вспышка, трассер) било в
        // полную яркость, и альфа вершин в режиме add просто не работала.
        bs->enable_blend          = true;
        bs->src_color_blendfactor = SDL_GPU_BLENDFACTOR_SRC_ALPHA;
        bs->dst_color_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
        bs->color_blend_op        = SDL_GPU_BLENDOP_ADD;
        bs->src_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ZERO;
        bs->dst_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
        bs->alpha_blend_op        = SDL_GPU_BLENDOP_ADD;
        return;

    case R2D_BLEND_MULTIPLY:
        // src * dst. Стандартная формула multiply для 2D: цвет источника
        // умножается на цвет назначения, вклад назначения — через DST_COLOR.
        bs->enable_blend          = true;
        bs->src_color_blendfactor = SDL_GPU_BLENDFACTOR_DST_COLOR;
        bs->dst_color_blendfactor = SDL_GPU_BLENDFACTOR_ZERO;
        bs->color_blend_op        = SDL_GPU_BLENDOP_ADD;
        bs->src_alpha_blendfactor = SDL_GPU_BLENDFACTOR_DST_ALPHA;
        bs->dst_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ZERO;
        bs->alpha_blend_op        = SDL_GPU_BLENDOP_ADD;
        return;

    case R2D_BLEND_ALPHA:
    default:
        bs->enable_blend          = true;
        bs->src_color_blendfactor = SDL_GPU_BLENDFACTOR_SRC_ALPHA;
        bs->dst_color_blendfactor = SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        bs->color_blend_op        = SDL_GPU_BLENDOP_ADD;
        bs->src_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
        bs->dst_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        bs->alpha_blend_op        = SDL_GPU_BLENDOP_ADD;
        return;
    }
}

// Выбирает вариант шейдера под текущий GPU-бэкенд.
static SDL_GPUShader *r2d__make_shader(SDL_GPUDevice *device,
                                        const R2DShaderBlob *blob,
                                        SDL_GPUShaderStage stage,
                                        Uint32 num_uniform_buffers,
                                        Uint32 num_samplers)
{
    const SDL_GPUShaderFormat formats = SDL_GetGPUShaderFormats(device);

    SDL_GPUShaderCreateInfo info;
    SDL_zero(info);
    info.stage               = stage;
    info.num_uniform_buffers = num_uniform_buffers;
    info.num_samplers        = num_samplers;
#ifndef __EMSCRIPTEN__
    if(blob==&r2d_shader_world_frag)info.num_storage_buffers=1;
#endif

    // Порядок предпочтений: сначала «родные» форматы бэкенда, WGSL — последним.
    // Так нативный WebGPU (если появится) сможет взять SPIR-V, а браузерный,
    // который отдаёт только WGSL, — встроенный WGSL-текст.
    if (formats & SDL_GPU_SHADERFORMAT_SPIRV) {
        info.format     = SDL_GPU_SHADERFORMAT_SPIRV;
        info.code       = blob->spirv;
        info.code_size  = blob->spirv_size;
        info.entrypoint = "main";
    } else if (formats & SDL_GPU_SHADERFORMAT_MSL) {
        // Metal принимает исходник MSL; SPIRV-Cross переименовывает точку входа в main0.
        info.format     = SDL_GPU_SHADERFORMAT_MSL;
        info.code       = (const Uint8 *)blob->msl;
        info.code_size  = blob->msl_size;
        info.entrypoint = "main0";
    } else if (formats & SDL_GPU_SHADERFORMAT_DXIL) {
        R2D_ERROR("бэкенд требует DXIL, но DXIL-вариант шейдеров не собирается "
                   "(нужен DXC). См. README, раздел «Шейдеры».");
        return NULL;
#ifdef SDL_GPU_SHADERFORMAT_WGSL
    } else if (formats & SDL_GPU_SHADERFORMAT_WGSL) {
        // WebGPU не принимает ни SPIR-V, ни MSL — только WGSL. Текст встроен в
        // блоб целиком (shaders/wgsl/*.wgsl), точка входа у всех наших — main.
        // Константа есть только в SDL с WebGPU-бэкендом, поэтому ветка
        // компилируется не везде.
        if (!blob->wgsl) {
            R2D_ERROR("бэкенд требует WGSL, но WGSL-вариант шейдера не собран "
                       "(нужна сборка с -DR2D_SHADERS_WGSL_ONLY=ON)");
            return NULL;
        }
        info.format     = SDL_GPU_SHADERFORMAT_WGSL;
        info.code       = (const Uint8 *)blob->wgsl;
        info.code_size  = blob->wgsl_size;
        info.entrypoint = "main";
#endif
    } else {
        R2D_ERROR("GPU-бэкенд не поддерживает ни одного из собранных форматов шейдеров");
        return NULL;
    }

    SDL_GPUShader *shader = SDL_CreateGPUShader(device, &info);
    if (!shader) {
        R2D_ERROR("SDL_CreateGPUShader: %s", SDL_GetError());
    }
    return shader;
}

SDL_GPUShader *r2d_render_world_shader(R2DRenderer *r,bool fragment)
{
#ifdef __EMSCRIPTEN__
    (void)r;(void)fragment;return NULL;
#else
    return r2d__make_shader(r->device,fragment?&r2d_shader_world_frag:&r2d_shader_world_vert,
        fragment?SDL_GPU_SHADERSTAGE_FRAGMENT:SDL_GPU_SHADERSTAGE_VERTEX,fragment?1:0,fragment?3:0);
#endif
}

// Создаёт конвейер спрайтов под конкретный режим смешивания. Вершинный вход
// у всех режимов общий — меняется только blend_state цветового таргета.
static SDL_GPUGraphicsPipeline *r2d__create_pipeline(
        SDL_GPUDevice *device, SDL_Window *window,
        SDL_GPUShader *vs, SDL_GPUShader *fs,
        const SDL_GPUVertexBufferDescription *vbuf,
        const SDL_GPUVertexAttribute *attribs,
        int attribute_count,
        R2DBlendMode mode)
{
    SDL_GPUColorTargetDescription target;
    SDL_zero(target);
    target.format = SDL_GetGPUSwapchainTextureFormat(device, window);
    r2d__blend_state(&target.blend_state, mode);

    SDL_GPUGraphicsPipelineCreateInfo pipe;
    SDL_zero(pipe);
    pipe.vertex_shader   = vs;
    pipe.fragment_shader = fs;
    pipe.primitive_type  = SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;

    pipe.vertex_input_state.num_vertex_buffers    = 1;
    pipe.vertex_input_state.vertex_buffer_descriptions = vbuf;
    pipe.vertex_input_state.num_vertex_attributes = attribute_count > 0 ? attribute_count : 3;
    pipe.vertex_input_state.vertex_attributes     = attribs;

    pipe.target_info.num_color_targets         = 1;
    pipe.target_info.color_target_descriptions = &target;
    // Z-буфер: тот же формат, что у цели глубины сцены. Спрайты пишут z = 0
    // (вершинный шейдер), то есть «ближе всего», и потому всегда поверх меша;
    // сам меш сортируется своим z между треугольниками. Отдельного буфера у
    // спрайтов нет.
    pipe.target_info.has_depth_stencil_target      = true;
    pipe.target_info.depth_stencil_format          = SDL_GPU_TEXTUREFORMAT_D32_FLOAT;

    // Тест и запись глубины включены. Спрайты пишут z = 0 («ближе всего»),
    // меш — свою глубину из вершины, поэтому меш НЕ перекрывает спрайты, а
    // между собой треугольники меша сортируются z-буфером (проверено).
    //
    // Здесь стоял комментарий про «LESS валит Metal, держимся на GREATER,
    // глубина обратная» — он был следствием несостоятельных проб (в отрисовке
    // меша стоял ранний return, поэтому «падало/не падало» ничего не значило)
    // и не соответствовал коду: сравнение всё время было LESS_OR_EQUAL.
    pipe.depth_stencil_state.enable_depth_test  = true;
    pipe.depth_stencil_state.enable_depth_write = true;
    pipe.depth_stencil_state.compare_op         = SDL_GPU_COMPAREOP_LESS_OR_EQUAL;

    pipe.rasterizer_state.fill_mode  = SDL_GPU_FILLMODE_FILL;
    pipe.rasterizer_state.cull_mode  = SDL_GPU_CULLMODE_NONE;
    pipe.rasterizer_state.front_face = SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE;

    pipe.multisample_state.sample_count = SDL_GPU_SAMPLECOUNT_1;

    return SDL_CreateGPUGraphicsPipeline(device, &pipe);
}

// ---------------------------------------------------------------------------
// Текстуры
// ---------------------------------------------------------------------------

// Текстура с явным набором применений. Загрузка пикселей возможна только в
// текстуру с флагом COPY_DST: без него SDL_UploadToGPUTexture молча ничего не
// делает, и спрайты остаются прозрачными (именно так «не рисовался» атлас
// глифов — данные лежали в памяти, но в GPU не попадали).
static SDL_GPUTexture *r2d__create_texture_usage(R2DRenderer *r, int w, int h,
                                                 SDL_GPUTextureUsageFlags usage)
{
    SDL_GPUTextureCreateInfo info;
    SDL_zero(info);
    info.type         = SDL_GPU_TEXTURETYPE_2D;
    info.format       = SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM;
    info.usage        = usage;
    info.width              = (Uint32)w;
    info.height             = (Uint32)h;
    info.layer_count_or_depth = 1;
    info.num_levels         = 1;
    info.sample_count       = SDL_GPU_SAMPLECOUNT_1;

    SDL_GPUTexture *tex = SDL_CreateGPUTexture(r->device, &info);
    if (!tex) {
        R2D_ERROR("SDL_CreateGPUTexture: %s", SDL_GetError());
    }
    return tex;
}

/** Сколько уровней у текстуры w×h, если строить полную пирамиду. */
static SDL_GPUTexture *r2d__create_texture_levels(R2DRenderer *r, int w, int h,
                                                  Uint32 levels);
static Uint32 r2d__mip_levels(int w, int h)
{
    Uint32 levels = 1;
    int size = w > h ? w : h;
    while (size > 1) { size /= 2; levels++; }
    return levels > 16 ? 16 : levels;   // предел SDL_GPU
}

static SDL_GPUTexture *r2d__create_texture(R2DRenderer *r, int w, int h)
{
    return r2d__create_texture_levels(r, w, h, 1);
}

/** Создать текстуру с нужным числом уровней (мипмапы — если больше 1). */
static SDL_GPUTexture *r2d__create_texture_levels(R2DRenderer *r, int w, int h,
                                                  Uint32 levels)
{
    SDL_GPUTextureCreateInfo info;
    SDL_zero(info);
    info.type         = SDL_GPU_TEXTURETYPE_2D;
    info.format       = SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM;
    // Мипмапы SDL строит, РИСУЯ уровни, поэтому текстуре нужен COLOR_TARGET.
    // Для одноуровневых он ни к чему — не просим лишнего.
    info.usage        = SDL_GPU_TEXTUREUSAGE_SAMPLER;
    if (levels > 1) info.usage |= SDL_GPU_TEXTUREUSAGE_COLOR_TARGET;
    info.width              = (Uint32)w;
    info.height             = (Uint32)h;
    info.layer_count_or_depth = 1;
    info.num_levels         = levels;
    info.sample_count       = SDL_GPU_SAMPLECOUNT_1;

    SDL_GPUTexture *tex = SDL_CreateGPUTexture(r->device, &info);
    if (!tex) {
        R2D_ERROR("SDL_CreateGPUTexture: %s", SDL_GetError());
    }
    return tex;
}

// Заливает RGBA8-пиксели в текстуру через одноразовый command buffer.
static bool r2d__upload_pixels(R2DRenderer *r, SDL_GPUTexture *tex,
                                const void *pixels, int w, int h, int pitch,
                                bool mipmaps)
{
    const Uint32 row_bytes = (Uint32)w * 4u;
    const Uint32 total     = row_bytes * (Uint32)h;

    SDL_GPUTransferBufferCreateInfo tb_info;
    SDL_zero(tb_info);
    tb_info.usage = SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;
    tb_info.size  = total;
    SDL_GPUTransferBuffer *tb = SDL_CreateGPUTransferBuffer(r->device, &tb_info);
    if (!tb) {
        R2D_ERROR("SDL_CreateGPUTransferBuffer: %s", SDL_GetError());
        return false;
    }

    void *dst = SDL_MapGPUTransferBuffer(r->device, tb, false);
    if (!dst) {
        R2D_ERROR("SDL_MapGPUTransferBuffer: %s", SDL_GetError());
        SDL_ReleaseGPUTransferBuffer(r->device, tb);
        return false;
    }
    const Uint8 *src = (const Uint8 *)pixels;
    for (int y = 0; y < h; ++y) {
        SDL_memcpy((Uint8 *)dst + (size_t)y * row_bytes, src + (size_t)y * pitch, row_bytes);
    }
    SDL_UnmapGPUTransferBuffer(r->device, tb);

    SDL_GPUCommandBuffer *cmd = SDL_AcquireGPUCommandBuffer(r->device);
    if (!cmd) {
        R2D_ERROR("SDL_AcquireGPUCommandBuffer: %s", SDL_GetError());
        SDL_ReleaseGPUTransferBuffer(r->device, tb);
        return false;
    }

    SDL_GPUCopyPass *cp = SDL_BeginGPUCopyPass(cmd);

    // Для текстур нужен SDL_GPUTextureTransferInfo (с раскладкой строк),
    // а не SDL_GPUTransferBufferLocation. Данные упакованы плотно, поэтому
    // 0 означает «взять размеры из региона».
    SDL_GPUTextureTransferInfo src_loc;
    SDL_zero(src_loc);
    src_loc.transfer_buffer = tb;
    src_loc.offset          = 0;
    src_loc.pixels_per_row  = 0;
    src_loc.rows_per_layer  = 0;

    SDL_GPUTextureRegion region;
    SDL_zero(region);
    region.texture = tex;
    region.w       = (Uint32)w;
    region.h       = (Uint32)h;
    region.d       = 1;

    SDL_UploadToGPUTexture(cp, &src_loc, &region, false);
    SDL_EndGPUCopyPass(cp);

    // Мипмапы: SDL строит пирамиду сам. Вызывать ВНЕ проходов — copy pass уже
    // закрыт, а командный буфер ещё не отправлен.
    if (mipmaps && tex) SDL_GenerateMipmapsForGPUTexture(cmd, tex);

    SDL_GPUFence *fence = SDL_SubmitGPUCommandBufferAndAcquireFence(cmd);
    if (fence) {
        SDL_GPUFence *fences[1] = { fence };
        SDL_WaitForGPUFences(r->device, true, fences, 1);
        SDL_ReleaseGPUFence(r->device, fence);
    }
    SDL_ReleaseGPUTransferBuffer(r->device, tb);
    return true;
}

// Занять слот в таблице текстур: сначала свободный из уже отжитых, потом новый.
//
// Раньше все вызывающие делали `texture_count++` напрямую, и таблица росла
// только вверх: выгруженная текстура навсегда съедала слот, а viewport.create
// вообще писал за границу массива (256 слотов) и портил поля рендерера.
// Возвращает -1, только если свободных слотов нет вовсе.
static int r2d__texture_slot_alloc(R2DRenderer *r)
{
    for (int i = 0; i < r->texture_count; ++i) {
        if (!r->textures[i].alive) return i;
    }
    if (r->texture_count < R2D_MAX_TEXTURES) return r->texture_count++;
    return -1;
}

// Средний цвет непрозрачных пикселей RGBA32-буфера. Пиксели с alpha < 16 не
// учитываются: у спрайта с прозрачной рамкой они бы «разбавили» цвет серым.
static void r2d__texture_average(const void *pixels, int w, int h, int pitch,
                                 float out[4], bool *has)
{
    out[0] = out[1] = out[2] = out[3] = 0.0f;
    *has = false;
    if (!pixels || w <= 0 || h <= 0) return;
    const uint8_t *base = (const uint8_t *)pixels;
    double sum[3] = { 0.0, 0.0, 0.0 };
    double weight = 0.0;
    for (int y = 0; y < h; ++y) {
        const uint8_t *row = base + (size_t)y * (size_t)pitch;
        for (int x = 0; x < w; ++x) {
            const uint8_t *px = row + (size_t)x * 4u;
            const double a = px[3] / 255.0;
            if (px[3] < 16) continue;
            sum[0] += px[0] * a; sum[1] += px[1] * a; sum[2] += px[2] * a;
            weight += a;
        }
    }
    if (weight <= 0.0) return;
    out[0] = (float)(sum[0] / weight);
    out[1] = (float)(sum[1] / weight);
    out[2] = (float)(sum[2] / weight);
    out[3] = 255.0f;
    *has = true;
}

#define R2D_THUMB_MAX 64   // сторона миниатюры: дальше блоки, точность падает

// Миниатюра среднего цвета по блокам. Нужна для спрайтов-регионов (атлас,
// процедурный лист): без неё `color:'auto'` у кадра листа возвращал цвет всего
// листа — заявленный «средний цвет спрайта» не выполнялся (находка BASHNYA E1).
static void r2d__texture_thumb(const void *pixels, int w, int h, int pitch, R2DTexture *t)
{
    if (t->thumb) { SDL_free(t->thumb); t->thumb = NULL; }
    t->thumb_w = t->thumb_h = 0;
    t->thumb_scale = 1;
    if (!pixels || w <= 0 || h <= 0) return;
    int scale = 1;
    const int longest = w > h ? w : h;
    while (longest / scale > R2D_THUMB_MAX) scale *= 2;
    const int tw = (w + scale - 1) / scale;
    const int th = (h + scale - 1) / scale;
    uint8_t *thumb = (uint8_t *)SDL_malloc((size_t)tw * (size_t)th * 4u);
    if (!thumb) return;
    const uint8_t *base = (const uint8_t *)pixels;
    for (int by = 0; by < th; ++by) {
        for (int bx = 0; bx < tw; ++bx) {
            double sum[3] = { 0.0, 0.0, 0.0 };
            double weight = 0.0;
            int count = 0;
            for (int y = by * scale; y < (by + 1) * scale && y < h; ++y) {
                const uint8_t *row = base + (size_t)y * (size_t)pitch;
                for (int x = bx * scale; x < (bx + 1) * scale && x < w; ++x) {
                    const uint8_t *px = row + (size_t)x * 4u;
                    ++count;
                    const double a = px[3] / 255.0;
                    if (px[3] < 16) continue;
                    sum[0] += px[0] * a; sum[1] += px[1] * a; sum[2] += px[2] * a;
                    weight += a;
                }
            }
            uint8_t *out = thumb + ((size_t)by * (size_t)tw + (size_t)bx) * 4u;
            if (weight > 0.0) {
                out[0] = (uint8_t)(sum[0] / weight + 0.5);
                out[1] = (uint8_t)(sum[1] / weight + 0.5);
                out[2] = (uint8_t)(sum[2] / weight + 0.5);
                out[3] = (uint8_t)(255.0 * weight / (double)(count > 0 ? count : 1) + 0.5);
            } else {
                out[0] = out[1] = out[2] = 0;
                out[3] = 0;
            }
        }
    }
    t->thumb = thumb;
    t->thumb_w = tw;
    t->thumb_h = th;
    t->thumb_scale = scale;
}

// Средний цвет ПРЯМОУГОЛЬНИКА текстуры (пиксельные координаты) по миниатюре.
// Возвращает false, если миниатюры нет — тогда вызывающий честно скажет, что
// цвета региона он не знает.
static bool r2d__texture_average_region(const R2DTexture *t, int sx, int sy, int sw, int sh,
                                        float out[4])
{
    if (!t || !t->thumb || t->thumb_w <= 0 || t->thumb_h <= 0 || sw <= 0 || sh <= 0) return false;
    const int scale = t->thumb_scale > 0 ? t->thumb_scale : 1;
    const int bx0 = sx / scale, by0 = sy / scale;
    const int bx1 = (sx + sw - 1) / scale, by1 = (sy + sh - 1) / scale;
    double sum[3] = { 0.0, 0.0, 0.0 };
    double weight = 0.0;
    for (int by = by0; by <= by1 && by < t->thumb_h; ++by) {
        if (by < 0) continue;
        for (int bx = bx0; bx <= bx1 && bx < t->thumb_w; ++bx) {
            if (bx < 0) continue;
            const uint8_t *px = t->thumb + ((size_t)by * (size_t)t->thumb_w + (size_t)bx) * 4u;
            const double a = px[3] / 255.0;
            if (a <= 0.0) continue;
            sum[0] += px[0] * a; sum[1] += px[1] * a; sum[2] += px[2] * a;
            weight += a;
        }
    }
    if (weight <= 0.0) return false;
    out[0] = (float)(sum[0] / weight);
    out[1] = (float)(sum[1] / weight);
    out[2] = (float)(sum[2] / weight);
    out[3] = 255.0f;
    return true;
}

int r2d_texture_create_rgba(R2DRenderer *r, const void *pixels, int w, int h)
{
    if (!r || !r->device || w <= 0 || h <= 0 || w > 16384 || h > 16384) return -1;

    const int slot = r2d__texture_slot_alloc(r);
    if (slot < 0) {
        R2D_ERROR("достигнут лимит текстур (%d)", R2D_MAX_TEXTURES);
        return -1;
    }

    SDL_GPUTexture *tex = r2d__create_texture_usage(
        r, w, h, SDL_GPU_TEXTUREUSAGE_SAMPLER);
    if (!tex) return -1;
    if (pixels && !r2d__upload_pixels(r, tex, pixels, w, h, w * 4, false)) {
        SDL_ReleaseGPUTexture(r->device, tex);
        return -1;
    }

    R2DTexture *t = &r->textures[slot];
    t->handle = tex;
    t->width  = w;
    t->height = h;
    t->alive  = true;
    t->has_avg = false;
    if (pixels) {
        r2d__texture_average(pixels, w, h, w * 4, t->avg, &t->has_avg);
        r2d__texture_thumb(pixels, w, h, w * 4, t);
    }
    SDL_snprintf(t->name, sizeof t->name, "<memory %dx%d>", w, h);
    return slot;
}

bool r2d_texture_upload_region(R2DRenderer *r, int id, int x, int y, int w, int h,
                               const void *pixels, int pitch)
{
    if (!r || !pixels || id < 0 || id >= r->texture_count) return false;
    if (!r->textures[id].alive || w <= 0 || h <= 0) return false;

    const Uint32 row_bytes = (Uint32)w * 4u;
    const Uint32 total     = row_bytes * (Uint32)h;

    SDL_GPUTransferBufferCreateInfo tb_info;
    SDL_zero(tb_info);
    tb_info.usage = SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;
    tb_info.size  = total;
    SDL_GPUTransferBuffer *tb = SDL_CreateGPUTransferBuffer(r->device, &tb_info);
    if (!tb) return false;

    void *dst = SDL_MapGPUTransferBuffer(r->device, tb, false);
    if (!dst) {
        SDL_ReleaseGPUTransferBuffer(r->device, tb);
        return false;
    }
    const Uint8 *src = (const Uint8 *)pixels;
    for (int row = 0; row < h; ++row) {
        SDL_memcpy((Uint8 *)dst + (size_t)row * row_bytes,
                   src + (size_t)row * (size_t)pitch, row_bytes);
    }
    SDL_UnmapGPUTransferBuffer(r->device, tb);

    SDL_GPUCommandBuffer *cmd = SDL_AcquireGPUCommandBuffer(r->device);
    if (!cmd) {
        SDL_ReleaseGPUTransferBuffer(r->device, tb);
        return false;
    }

    SDL_GPUCopyPass *cp = SDL_BeginGPUCopyPass(cmd);

    SDL_GPUTextureTransferInfo src_loc;
    SDL_zero(src_loc);
    src_loc.transfer_buffer = tb;
    src_loc.offset          = 0;

    SDL_GPUTextureRegion region;
    SDL_zero(region);
    region.texture = r->textures[id].handle;
    region.x       = (Uint32)x;
    region.y       = (Uint32)y;
    region.w       = (Uint32)w;
    region.h       = (Uint32)h;
    region.d       = 1;

    SDL_UploadToGPUTexture(cp, &src_loc, &region, false);
    SDL_EndGPUCopyPass(cp);

    SDL_GPUFence *fence = SDL_SubmitGPUCommandBufferAndAcquireFence(cmd);
    if (fence) {
        SDL_GPUFence *fences[1] = { fence };
        SDL_WaitForGPUFences(r->device, true, fences, 1);
        SDL_ReleaseGPUFence(r->device, fence);
    }
    SDL_ReleaseGPUTransferBuffer(r->device, tb);

    // Байты нового региона обязаны попасть на GPU до того, как их увидит
    // отрисовка следующего кадра: атлас глифов дорисовывается по ходу игры.
    return true;
}

static int r2d_texture_load_ex(R2DRenderer *r, const char *path, bool mipmaps);

int r2d_texture_load(R2DRenderer *r, const char *path)
{
    return r2d_texture_load_ex(r, path, false);
}

int r2d_texture_load_mipped(R2DRenderer *r, const char *path)
{
    return r2d_texture_load_ex(r, path, true);
}

static int r2d_texture_load_ex(R2DRenderer *r, const char *path, bool mipmaps)
{
    const int existing = r2d_texture_find(r, path);
    if (existing >= 0) return existing;

    const int slot = r2d__texture_slot_alloc(r);
    if (slot < 0) {
        R2D_ERROR("достигнут лимит текстур (%d)", R2D_MAX_TEXTURES);
        return -1;
    }

    // В собранной игре картинки лежат в грузе: читаем из памяти, а на диск
    // обращаемся только если файла там нет.
    SDL_Surface *loaded = NULL;
    if (r2d_vfs_has(path)) {
        size_t data_size = 0;
        uint8_t *data = r2d_vfs_read(path, &data_size);
        if (data) {
            SDL_IOStream *io = SDL_IOFromConstMem(data, data_size);
            if (io) loaded = IMG_Load_IO(io, true);
            r2d_vfs_free(data);
        }
    } else {
        loaded = IMG_Load(path);
    }
    if (!loaded) {
        R2D_ERROR("не удалось загрузить картинку %s: %s", path, SDL_GetError());
        return -1;
    }

    SDL_Surface *rgba = loaded;
    if (loaded->format != SDL_PIXELFORMAT_RGBA32) {
        rgba = SDL_ConvertSurface(loaded, SDL_PIXELFORMAT_RGBA32);
        if (!rgba) {
            R2D_ERROR("SDL_ConvertSurface: %s", SDL_GetError());
            SDL_DestroySurface(loaded);
            return -1;
        }
    }

    const int w = rgba->w;
    const int h = rgba->h;
    const Uint32 levels = mipmaps ? r2d__mip_levels(w, h) : 1;
    SDL_GPUTexture *tex = r2d__create_texture_levels(r, w, h, levels);
    if (!tex || !r2d__upload_pixels(r, tex, rgba->pixels, w, h, rgba->pitch, mipmaps)) {
        if (tex) SDL_ReleaseGPUTexture(r->device, tex);
        if (rgba != loaded) SDL_DestroySurface(rgba);
        SDL_DestroySurface(loaded);
        return -1;
    }

    // Средний цвет снимаем ДО освобождения поверхностей. Раньше он считался
    // ниже, уже после SDL_DestroySurface(rgba) — то есть читал освобождённую
    // память: has_avg оставался false (или в avg попадал мусор), и `color:'auto'`
    // у emissive-спрайтов молча становился белым (находка BASHNYA E1:
    // auto_color_known:false, цвет [255,255,255]).
    float avg[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    bool has_avg = false;
    r2d__texture_average(rgba->pixels, w, h, rgba->pitch, avg, &has_avg);
    uint8_t *thumb = NULL;
    int thumb_w = 0, thumb_h = 0, thumb_scale = 1;
    {
        // Миниатюру собираем здесь же: после DestroySurface пикселей уже нет.
        R2DTexture tmp;
        SDL_zero(tmp);
        r2d__texture_thumb(rgba->pixels, w, h, rgba->pitch, &tmp);
        thumb = tmp.thumb; thumb_w = tmp.thumb_w; thumb_h = tmp.thumb_h;
        thumb_scale = tmp.thumb_scale;
    }

    if (rgba != loaded) SDL_DestroySurface(rgba);
    SDL_DestroySurface(loaded);

    const int id = slot;
    R2DTexture *t = &r->textures[id];
    t->handle = tex;
    t->width  = w;
    t->height = h;
    t->alive  = true;
    SDL_memcpy(t->avg, avg, sizeof avg);
    t->has_avg = has_avg;
    t->thumb = thumb;
    t->thumb_w = thumb_w;
    t->thumb_h = thumb_h;
    t->thumb_scale = thumb_scale;
    SDL_snprintf(t->name, sizeof t->name, "%s", path);

    R2D_LOG("текстура #%d: %s (%dx%d)", id, path, w, h);
    return id;
}

// Выгрузка текстуры: GPU-ресурс освобождается, слот помечается мёртвым и
// переиспользуется следующим loadTexture/createTexture. Спрайты, ссылающиеся
// на эту текстуру, тоже гасятся — иначе в батч попадёт команда с невалидным
// спрайтом.
//
// Белую текстуру (основа drawRect и nine-slice) выгружать нельзя: движок
// рисует ею прямоугольники, и без неё развалится интерфейс.
void r2d_render_set_filter(R2DRenderer *r, bool linear)
{
    if (r) r->filter_linear = linear;
}

bool r2d_render_filter(const R2DRenderer *r)
{
    return r ? r->filter_linear : false;
}

void r2d_render_set_snap(R2DRenderer *r, bool on)
{
    if (r) r->snap = on;
}

bool r2d_render_snap(const R2DRenderer *r)
{
    return r ? r->snap : false;
}

int r2d_texture_users(const R2DRenderer *r, int id)
{
    if (!r || id < 0 || id >= r->texture_count || !r->textures[id].alive) return 0;
    int users = 0;
    for (int i = 0; i < r->sprite_count; ++i) {
        if (r->sprites[i].alive && r->sprites[i].texture == id) users++;
    }
    return users;
}

bool r2d_texture_free(R2DRenderer *r, int id)
{
    if (!r || id < 0 || id >= r->texture_count) return false;
    if (id == r->white_texture) {
        R2D_WARN("freeTexture: белую текстуру выгружать нельзя");
        return false;
    }
    R2DTexture *t = &r->textures[id];
    if (!t->alive) return false;

    if (t->handle) SDL_ReleaseGPUTexture(r->device, t->handle);
    t->handle = NULL;
    t->alive = false;
    t->width = 0;
    t->height = 0;
    t->name[0] = '\0';
    if (t->thumb) { SDL_free(t->thumb); t->thumb = NULL; }
    t->thumb_w = t->thumb_h = 0;
    t->thumb_scale = 1;

    for (int i = 0; i < r->sprite_count; ++i) {
        if (r->sprites[i].alive && r->sprites[i].texture == id) {
            r->sprites[i].alive = false;
        }
    }
    return true;
}

// Сколько живых текстур сейчас (для отладочного отчёта о лимитах).
int r2d_texture_live_count(const R2DRenderer *r)
{
    int live = 0;
    if (!r) return 0;
    for (int i = 0; i < r->texture_count; ++i) {
        if (r->textures[i].alive) live++;
    }
    return live;
}

int r2d_texture_find(const R2DRenderer *r, const char *path)
{
    for (int i = 0; i < r->texture_count; ++i) {
        if (r->textures[i].alive && SDL_strcmp(r->textures[i].name, path) == 0) return i;
    }
    return -1;
}

void r2d_texture_info(const R2DRenderer *r, int id, int *w, int *h)
{
    if (w) *w = 0;
    if (h) *h = 0;
    if (id < 0 || id >= r->texture_count || !r->textures[id].alive) return;
    if (w) *w = r->textures[id].width;
    if (h) *h = r->textures[id].height;
}

const char *r2d_texture_name(const R2DRenderer *r, int id)
{
    if (id < 0 || id >= r->texture_count || !r->textures[id].alive) return "";
    return r->textures[id].name;
}

SDL_GPUTexture *r2d_texture_handle(const R2DRenderer *r, int id)
{
    if (id < 0 || id >= r->texture_count || !r->textures[id].alive) return NULL;
    return r->textures[id].handle;
}

// ---------------------------------------------------------------------------
// Спрайты
// ---------------------------------------------------------------------------

int r2d_sprite_create(R2DRenderer *r, int texture, float sx, float sy, float sw, float sh)
{
    if (texture < 0 || texture >= r->texture_count || !r->textures[texture].alive) {
        R2D_ERROR("r2d_sprite_create: неверная текстура %d", texture);
        return -1;
    }
    // Слот мёртвого спрайта переиспользуется: $.viewport.create()/destroy()
    // заводит спрайт истории кадра на каждый цикл, а r2d_sprite_create только
    // дописывал строку — таблица росла линейно (100 циклов → +100 записей,
    // замерено tests/agent/render_target_lifecycle_test.py). Живые строки не
    // трогаем: освободившиеся отдаём по порядку.
    int slot = -1;
    for (int i = 0; i < r->sprite_count; ++i) {
        if (!r->sprites[i].alive) { slot = i; break; }
    }
    if (slot < 0) {
        if (!r2d__grow((void **)&r->sprites, &r->sprite_cap, r->sprite_count + 1, sizeof(R2DSprite))) {
            return -1;
        }
        slot = r->sprite_count++;
    }

    const float tw = (float)r->textures[texture].width;
    const float th = (float)r->textures[texture].height;

    R2DSprite *s = &r->sprites[slot];
    s->texture = texture;
    // Полтексельный отступ: край квада попадает ровно на границу текселя, и
    // при выборке по центру пикселя затягивался соседний кадр атласа.
    // Сдвиг внутрь на полтекселя убирает эту «протечку».
    if (sw > 1.0f && sh > 1.0f) {
        s->u0 = (sx + 0.5f) / tw;
        s->v0 = (sy + 0.5f) / th;
        s->u1 = (sx + sw - 0.5f) / tw;
        s->v1 = (sy + sh - 0.5f) / th;
    } else {
        s->u0 = sx / tw;
        s->v0 = sy / th;
        s->u1 = (sx + sw) / tw;
        s->v1 = (sy + sh) / th;
    }
    s->width  = sw;
    s->height = sh;
    s->force_nearest = false;
    s->force_linear = false;
    s->alive  = true;

    return slot;
}

bool r2d_sprite_alive(const R2DRenderer *r, int id)
{
    return id >= 0 && id < r->sprite_count && r->sprites[id].alive;
}

// ---------------------------------------------------------------------------
// Батч
// ---------------------------------------------------------------------------

// Обрезка вывода: прямоугольник экрана (scissor). Нужна там, где содержимое
// выходит за свои рамки — прокрутка списка, портрет в рамке, миникарта.
//
// Прямоугольников на кадр несколько: игра может обрезать разные узлы
// по-разному, поэтому каждая команда помнит СВОЙ (R2DDrawCmd.clip), а проход
// сменяет scissor на границе участков.
void r2d_render_set_clip(R2DRenderer *r, int x, int y, int w, int h)
{
    if (!r) return;
    if (w <= 0 || h <= 0) { r->clip_cur = -1; return; }
    // Повтор той же обрезки не занимает новый слот: скролл ставит её каждый
    // кадр, и таблица иначе переполнилась бы за пару секунд.
    if (r->clip_cur >= 0) {
        const SDL_Rect *c = &r->clips[r->clip_cur];
        if (c->x == x && c->y == y && c->w == w && c->h == h) return;
    }
    if (r->clip_count >= R2D_MAX_CLIPS) {
        // Не роняем кадр: игра теряет обрезку, но получает след в журнале.
        static bool logged = false;
        if (!logged) {
            logged = true;
            R2D_WARN("обрезок за кадр больше %d — лишние игнорируются", R2D_MAX_CLIPS);
        }
        r->clip_cur = -1;
        return;
    }
    SDL_Rect *c = &r->clips[r->clip_count];
    c->x = x; c->y = y; c->w = w; c->h = h;
    r->clip_cur = r->clip_count++;
}

void r2d_render_clear_clip(R2DRenderer *r)
{
    if (r) r->clip_cur = -1;
}

bool r2d_render_get_clip(const R2DRenderer *r, SDL_Rect *out)
{
    if (!r || r->clip_cur < 0) return false;
    if (out) *out = r->clips[r->clip_cur];
    return true;
}

int r2d_render_clip_count(const R2DRenderer *r)
{
    return r ? r->clip_count : 0;
}

void r2d_render_begin_frame(R2DRenderer *r, int screen_w, int screen_h)
{
    r->screen_w       = screen_w > 0 ? screen_w : 1;
    r->screen_h       = screen_h > 0 ? screen_h : 1;
    r->cmd_count      = 0;
    r->vertex_count   = 0;
    r->index_count    = 0;
    r->tri_vertex_count = 0;
    r->tri_batch_count  = 0;
    r->tri_index_start  = 0;
    // Меш: начало кадра сбрасывает только УЖЕ отрисованное. Очередь вершин не
    // трогаем: игра собирает её в $.update, то есть ДО begin_frame, и ранний
    // сброс стирал меш целиком — он никогда не доезжал до заливки (нашлось
    // сравнением счётчиков: вершин 3, а на заливке 0).
    r->mesh_vertex_upload  = 0;
    r->mesh_batch_upload   = 0;
    r->mesh_index_start    = 0;
    r->stat_mesh_cmds      = 0;
    r->stat_frames++;
    r->revision++;
    r->light_vertex_count = 0;
    r->light_batch_count  = 0;
    r->light_index_start  = 0;
    // Свет этого кадра ещё не ушёл в текстуру: если lightmap выключится или
    // кадр окажется в чужом render target, свет дорисует проход сцены.
    r->lightmap_used      = false;
    // §20.1. Маски получателя и композит живут кадр: признак «есть маски»
    // ставят команды спрайтов при сборке батча (они собираются после этого
    // сброса — см. порядок кадра в main.c).
    r->light_mask_used    = false;
    r->light_composited   = false;
    r->light_blur_used    = false;
    r->scene_target_used  = false;
    // §37. Список источников света живёт кадр: JS-путь света публикует его
    // заново (drawLightNode → engine.devtools.light), а инспектор читает уже
    // готовый список. Источников прошлого кадра здесь быть не должно.
    r->light_reading_count   = 0;
    r->light_reading_dropped = 0;
    // Число проходов маски читается игрой из JS в начале кадра — то есть после
    // этого сброса. Поэтому храним ещё и значение прошлого кадра.
    r->prev_mask_passes   = r->stat_mask_passes;
    r->stat_mask_nodes    = 0;
    r->stat_mask_passes   = 0;
    r->batch_blend      = R2D_BLEND_ALPHA;
    r->batch_fx         = 0;
    r->fx_count         = 0;
    // Связывание viewport'а живёт кадр: игра вызывает bind() в своём кадре.
    r->bound_viewport   = -1;
    // -1 — «интерфейс ещё не помечен»: тогда все спрайты считаются миром.
    r->ui_cmd_start     = -1;
    // -1 — «неосвещённый слой не помечен»: тогда свет ложится на все спрайты.
    r->unlit_cmd_start  = -1;
    // Обрезки живут кадр: игра задаёт их заново.
    r->clip_count       = 0;
    r->clip_cur         = -1;
    r->stat_draws     = 0;
    r->stat_batches   = 0;
    r->stat_passes    = 0;
    r->stat_fx_cmds   = 0;
    r->stat_sprites   = 0;
    r->stat_vertices  = 0;
    r->stat_upload_bytes = 0;
    // Буферы свечения живут между кадрами, но результат — нет: если в этом
    // кадре свечение не считалось, пост обязан получить чёрную заглушку.
    r->bloom_result   = NULL;
}

void r2d_batch_add(R2DRenderer *r, int sprite, float x, float y, float w, float h,
                    float angle, uint32_t color)
{
    // Без маски узел принимает все слои света — прежнее поведение.
    r2d_batch_add_mask(r, sprite, x, y, w, h, angle, color, 0xFFFFFFFFu);
}

void r2d_batch_add_mask(R2DRenderer *r, int sprite, float x, float y, float w, float h,
                        float angle, uint32_t color, uint32_t mask)
{
    if (!r2d_sprite_alive(r, sprite)) {
        return;
    }
    if (!r2d__grow((void **)&r->cmds, &r->cmd_cap, r->cmd_count + 1, sizeof(R2DDrawCmd))) return;
    if (!r2d__grow((void **)&r->vertices, &r->vertex_cap, r->vertex_count + 4, sizeof(R2DVertex))) return;
    if (!r2d__grow((void **)&r->indices, &r->index_cap, r->index_count + 6, sizeof(uint32_t))) return;

    R2DDrawCmd *c = &r->cmds[r->cmd_count++];
    c->sprite = sprite;
    c->x = x; c->y = y;
    c->w = w; c->h = h;
    c->angle = angle;
    c->color = color;
    // Режим фиксируем на момент добавления: submitSprites с 4-м аргументом
    // проставляет его только на время своего пакета.
    c->blend = r->batch_blend;
    c->fx    = r->batch_fx;
    c->filter = !r->sprites[sprite].force_nearest && (r->filter_linear || r->sprites[sprite].force_linear) ? 1 : 0;
    c->clip   = (int16_t)r->clip_cur;
    // §20.1. Маска получателя: «все слои» — обычный случай, тогда и прохода
    // маски в кадре не будет (см. r2d_render_light_mask_used).
    c->mask   = mask;
    if (mask != 0xFFFFFFFFu) {
        r->light_mask_used = true;
        r->stat_mask_nodes++;
    }

    const R2DSprite *sp = &r->sprites[sprite];
    const uint8_t cr = (uint8_t)(color & 0xFF);
    const uint8_t cg = (uint8_t)((color >> 8) & 0xFF);
    const uint8_t cb = (uint8_t)((color >> 16) & 0xFF);
    const uint8_t ca = (uint8_t)((color >> 24) & 0xFF);

    // Ортографическая проекция запекается здесь — шейдеру она не нужна.
    const float inv_w = 2.0f / (float)r->screen_w;
    const float inv_h = 2.0f / (float)r->screen_h;

    const float hw = w * 0.5f;
    const float hh = h * 0.5f;
    const float cs = cosf(angle);
    const float sn = sinf(angle);

    // Порядок: TL, TR, BR, BL — совпадает с порядком UV.
    const float lx[4] = { -hw,  hw,  hw, -hw };
    const float ly[4] = { -hh, -hh,  hh,  hh };
    const float uu[4] = { sp->u0, sp->u1, sp->u1, sp->u0 };
    const float vv[4] = { sp->v0, sp->v0, sp->v1, sp->v1 };

    // Снаппинг — только для осевых квадов: у повёрнутого спрайта округление
    // вершин ломало бы форму. Позиция узла и тело при этом не меняются.
    const bool snap_verts = r->snap && angle == 0.0f;

    R2DVertex *verts = &r->vertices[r->vertex_count];
    for (int i = 0; i < 4; ++i) {
        const float rx = lx[i] * cs - ly[i] * sn;
        const float ry = lx[i] * sn + ly[i] * cs;
        float px = x + rx;
        float py = y + ry;
        if (snap_verts) {
            px = floorf(px + 0.5f);
            py = floorf(py + 0.5f);
        }

        verts[i].x = px * inv_w - 1.0f;
        verts[i].y = 1.0f - py * inv_h;   // экранный Y направлен вниз
        verts[i].u = uu[i];
        verts[i].v = vv[i];
        verts[i].r = cr;
        verts[i].g = cg;
        verts[i].b = cb;
        verts[i].a = ca;
        verts[i].mask = mask;
    }

    const uint32_t base = (uint32_t)r->vertex_count;
    uint32_t *idx = &r->indices[r->index_count];
    idx[0] = base + 0; idx[1] = base + 1; idx[2] = base + 2;
    idx[3] = base + 0; idx[4] = base + 2; idx[5] = base + 3;

    r->vertex_count += 4;
    r->index_count  += 6;
}

void r2d_batch_rect(R2DRenderer *r, float x, float y, float w, float h, uint32_t color)
{
    r2d_batch_add(r, r->white_sprite, x, y, w, h, 0.0f, color);
}

// Раскладка плоских треугольников (stride 6: x, y, r, g, b, a) в список вершин
// вместе с записью диапазона-пакета. Общая для сцены и для света lightmap:
// формат вершин и проекция у них одинаковые, различаются только списки.
static void r2d__pack_triangles(R2DRenderer *r, const float *verts, int vertex_count,
                                int blend, int fallback_blend,
                                R2DVertex **vertices, int *count, int *cap,
                                R2DTriBatch **batches, int *batch_count, int *batch_cap)
{
    if (!verts || vertex_count <= 0) return;
    if (vertex_count % 3 != 0) {
        R2D_ERROR("треугольники: vertex_count=%d не кратен 3", vertex_count);
        return;
    }
    if (!r2d__grow((void **)vertices, cap, *count + vertex_count, sizeof(R2DVertex))) return;
    if (!r2d__grow((void **)batches, batch_cap, *batch_count + 1, sizeof(R2DTriBatch))) return;
    if (blend < 0 || blend >= R2D_BLEND_COUNT) blend = fallback_blend;

    // Запоминаем диапазон ДО раскладки: рисоваться он будет своим конвейером.
    R2DTriBatch *batch = &(*batches)[(*batch_count)++];
    batch->vertex_offset = *count;
    batch->vertex_count  = vertex_count;
    batch->blend         = (uint8_t)blend;
    // Слой источника: у сцены и меша он не используется («все слои»).
    batch->layer         = 0xFFFFFFFFu;

    // Та же проекция, что и у спрайтов: пиксели логического экрана -> clip-space.
    // Добавки 0.5 на центр пикселя в спрайтовом пути нет, поэтому её нет и здесь.
    const float inv_w = 2.0f / (float)r->screen_w;
    const float inv_h = 2.0f / (float)r->screen_h;

    R2DVertex *dst = &(*vertices)[*count];
    for (int i = 0; i < vertex_count; ++i) {
        const float *v = verts + (size_t)i * 6;
        dst[i].x = v[0] * inv_w - 1.0f;
        dst[i].y = 1.0f - v[1] * inv_h;   // экранный Y направлен вниз
        dst[i].u = 0.5f;                  // всё равно рисуем белой текстурой
        dst[i].v = 0.5f;
        dst[i].r = r2d__color_f32(v[2]);
        dst[i].g = r2d__color_f32(v[3]);
        dst[i].b = r2d__color_f32(v[4]);
        dst[i].a = r2d__color_f32(v[5]);
        // Треугольники — не спрайты: маска получателя у них не своя, гейт
        // света едет юниформой пакета (batch->layer).
        dst[i].mask = 0xFFFFFFFFu;
    }

    *count += vertex_count;
}

/**
 * Меш псевдо-3D: 8 float на вершину (x, y, z, u, v, r, g, b).
 *
 * x и y — в МИРОВЫХ пикселях экрана (как у треугольников), z — глубина 0..1
 * (ближе — меньше), u/v — текстурные координаты, цвет — 0..1. Вершины идут в
 * общий буфер: формат совпадает с байтами, отличается только конвейер.
 */
void r2d_batch_mesh(R2DRenderer *r, const float *verts, int vertex_count, int texture)
{
    if (!r || !verts || vertex_count <= 0) return;
    if (vertex_count % 3 != 0) {
        R2D_ERROR("меш: vertex_count=%d не кратен 3", vertex_count);
        return;
    }
    if (!r2d__grow((void **)&r->mesh_vertices, &r->mesh_vertex_cap,
                   r->mesh_vertex_count + vertex_count, sizeof(R2DMeshVertex))) return;
    if (!r2d__grow((void **)&r->mesh_batches, &r->mesh_batch_cap,
                   r->mesh_batch_count + 1, sizeof(R2DTriBatch))) return;

    R2DTriBatch *batch = &r->mesh_batches[r->mesh_batch_count++];
    batch->vertex_offset = r->mesh_vertex_count;
    batch->vertex_count  = vertex_count;
    batch->blend         = (uint8_t)R2D_BLEND_ALPHA;
    // Текстура ПАКЕТА: раньше меш всегда сэмплил белую, и u/v были мертвы —
    // текстурированный псевдо-3D был невозможен (§4.1 TASKS). Сюда приходит
    // id ТЕКСТУРЫ (engine.loadTexture), а не спрайта.
    batch->texture       = texture;

    const float inv_w = 2.0f / (float)r->screen_w;
    const float inv_h = 2.0f / (float)r->screen_h;

    R2DMeshVertex *dst = &r->mesh_vertices[r->mesh_vertex_count];
    for (int i = 0; i < vertex_count; ++i) {
        const float *v = verts + (size_t)i * 8;
        dst[i].x = v[0] * inv_w - 1.0f;
        dst[i].y = 1.0f - v[1] * inv_h;   // экранный Y направлен вниз
        dst[i].z = v[2];                   // глубина уже в 0..1
        dst[i].u = v[3];
        dst[i].v = v[4];
        dst[i].r = r2d__color_f32(v[5]);
        dst[i].g = r2d__color_f32(v[6]);
        dst[i].b = r2d__color_f32(v[7]);
        dst[i].a = 255;
    }
    r->mesh_vertex_count += vertex_count;
    r->stat_mesh_built += vertex_count;
}

void r2d_batch_triangles_blend(R2DRenderer *r, const float *verts, int vertex_count, int blend)
{
    r2d__pack_triangles(r, verts, vertex_count, blend, R2D_BLEND_ALPHA,
                        &r->tri_vertices, &r->tri_vertex_count, &r->tri_cap,
                        &r->tri_batches, &r->tri_batch_count, &r->tri_batch_cap);
}

// Свет lightmap. Тот же формат, но свой список: рисуется он не в сцену, а в
// текстуру света. Смешивание по умолчанию аддитивное — свет складывается.
void r2d_batch_light_triangles_blend(R2DRenderer *r, const float *verts,
                                     int vertex_count, int blend)
{
    // Без явного слоя источник освещает всех — прежнее поведение.
    r2d_batch_light_triangles_layer(r, verts, vertex_count, blend, 0xFFFFFFFFu);
}

void r2d_batch_light_triangles_layer(R2DRenderer *r, const float *verts, int vertex_count,
                                     int blend, uint32_t layer)
{
    const int before = r->light_batch_count;
    r2d__pack_triangles(r, verts, vertex_count, blend, R2D_BLEND_ADD,
                        &r->light_vertices, &r->light_vertex_count, &r->light_vertex_cap,
                        &r->light_batches, &r->light_batch_count, &r->light_batch_cap);
    if (r->light_batch_count <= before) return;

    // §20.1. Гейт по маске получателя передаётся юниформой на draw call,
    // поэтому пакет света рвётся там, где меняется слой источника. Соседние
    // вызовы с тем же слоем и режимом остаются ОДНИМ пакетом — цена не растёт.
    R2DTriBatch *batch = &r->light_batches[r->light_batch_count - 1];
    batch->layer = layer;
    if (before > 0) {
        const R2DTriBatch *prev = &r->light_batches[before - 1];
        const bool same = prev->layer == layer && prev->blend == batch->blend &&
                          prev->vertex_offset + prev->vertex_count == batch->vertex_offset;
        if (same) {
            // Склеиваем: тот же слой, тот же режим, вершины идут подряд.
            r->light_batches[before - 1].vertex_count += batch->vertex_count;
            r->light_batch_count--;
        }
    }
}

void r2d_batch_light_triangles(R2DRenderer *r, const float *verts, int vertex_count)
{
    r2d_batch_light_triangles_blend(r, verts, vertex_count, R2D_BLEND_ADD);
}

void r2d_batch_triangles(R2DRenderer *r, const float *verts, int vertex_count)
{
    r2d_batch_triangles_blend(r, verts, vertex_count, R2D_BLEND_ALPHA);
}

// Заполняет запись таблицы шейдеров узла. Индекс даёт JS: он же ведёт
// таблицу на своей стороне, поэтому ноль всегда «обычный спрайт».
bool r2d_render_fx_define(R2DRenderer *r, int index, int kind,
                          float p1, float p2, float p3, uint32_t color,
                          int user_shader)
{
    if (!r || index <= 0 || index >= R2D_MAX_NODE_FX) return false;
    if (user_shader < 0 || user_shader >= R2D_MAX_USER_SHADERS) user_shader = 0;
    if (user_shader > 0 && !r->user_shaders[user_shader].used) user_shader = 0;
    R2DNodeFx *fx = &r->fx[index];
    fx->kind = kind;
    fx->user = user_shader;
    fx->p1 = p1;
    fx->p2 = p2;
    fx->p3 = p3;
    fx->color = color;
    if (index > r->fx_count) r->fx_count = index;
    return true;
}

// ---------------------------------------------------------------------------
// Пользовательские шейдеры
//
// Компиляция — glslang (GLSL → SPIR-V) и spirv-cross (SPIR-V → MSL), см.
// shader_live.cpp. Здесь только конвейеры: вершинный шейдер берём встроенный
// (интерфейс общий), фрагментный — скомпилированный игрой. Конвейер нужен на
// каждый режим смешивания, как и у встроенных эффектов.
// ---------------------------------------------------------------------------

bool r2d_render_user_shader_supported(void) { return r2d_live_shader_supported(); }

const char *r2d_render_user_shader_preamble(void) { return r2d_live_shader_preamble(); }

static void r2d__user_shader_destroy(R2DRenderer *r, R2DUserShader *us)
{
    if (us->fragment) {
        SDL_ReleaseGPUShader(r->device, us->fragment);
        us->fragment = NULL;
    }
    for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
        if (us->pipelines[m]) {
            SDL_ReleaseGPUGraphicsPipeline(r->device, us->pipelines[m]);
            us->pipelines[m] = NULL;
        }
    }
    us->used = false;
    us->name[0] = '\0';
}

int r2d_render_user_shader_define(R2DRenderer *r, const char *name, const char *source)
{
    if (!r || !r->device || !name || !source) return -1;
    if (!r2d_live_shader_supported()) {
        SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error,
                     "эта сборка без компилятора шейдеров (R2D_ENABLE_LIVE_SHADERS=OFF)");
        return -1;
    }

    // Один и тот же шейдер перекомпилируется на месте: так работает hot reload
    // и правка эффекта в консоли.
    int slot = 0;
    for (int i = 1; i < R2D_MAX_USER_SHADERS; ++i) {
        if (r->user_shaders[i].used && SDL_strcmp(r->user_shaders[i].name, name) == 0) {
            slot = i;
            break;
        }
        if (slot == 0 && !r->user_shaders[i].used) slot = i;
    }
    if (slot == 0) {
        SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error,
                     "достигнут лимит пользовательских шейдеров (%d)", R2D_MAX_USER_SHADERS - 1);
        return -1;
    }

    R2DLiveShader live;
    if (!r2d_live_shader_compile(source, &live)) {
        SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error, "%s", live.error);
        r2d_live_shader_free(&live);
        return -1;
    }

    const SDL_GPUShaderFormat formats = SDL_GetGPUShaderFormats(r->device);
    SDL_GPUShaderCreateInfo info;
    SDL_zero(info);
    info.stage               = SDL_GPU_SHADERSTAGE_FRAGMENT;
    info.num_uniform_buffers = 1;
    info.num_samplers        = 1;
    if ((formats & SDL_GPU_SHADERFORMAT_MSL) && live.msl) {
        info.format     = SDL_GPU_SHADERFORMAT_MSL;
        info.code       = (const Uint8 *)live.msl;
        info.code_size  = live.msl_size;
        info.entrypoint = "main0";
    } else if (formats & SDL_GPU_SHADERFORMAT_SPIRV) {
        info.format     = SDL_GPU_SHADERFORMAT_SPIRV;
        info.code       = (const Uint8 *)live.spirv;
        info.code_size  = live.spirv_size;
        info.entrypoint = "main";
    } else {
        SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error,
                     "бэкенд не принимает ни MSL, ни SPIR-V: %s", live.error);
        r2d_live_shader_free(&live);
        return -1;
    }

    SDL_GPUShader *fragment = SDL_CreateGPUShader(r->device, &info);
    r2d_live_shader_free(&live);
    if (!fragment) {
        SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error,
                     "SDL_CreateGPUShader: %s", SDL_GetError());
        return -1;
    }

    SDL_GPUShader *vertex = r2d__make_shader(r->device, &r2d_shader_sprite_vert,
                                             SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
    if (!vertex) {
        SDL_ReleaseGPUShader(r->device, fragment);
        SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error,
                     "нет вершинного шейдера спрайтов: %s", SDL_GetError());
        return -1;
    }

    SDL_GPUVertexBufferDescription vb;
    SDL_zero(vb);
    vb.slot = 0;
    vb.pitch = sizeof(R2DVertex);
    vb.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

    SDL_GPUVertexAttribute attrs[4];
    SDL_zero(attrs);
    attrs[0].location = 0; attrs[0].buffer_slot = 0; attrs[0].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[0].offset = 0;
    attrs[1].location = 1; attrs[1].buffer_slot = 0; attrs[1].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[1].offset = sizeof(float) * 2;
    attrs[2].location = 2; attrs[2].buffer_slot = 0; attrs[2].format = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM; attrs[2].offset = sizeof(float) * 4;
    // §20.1: тот же вершинный шейдер, значит и тот же набор атрибутов.
    attrs[3].location = 3; attrs[3].buffer_slot = 0; attrs[3].format = SDL_GPU_VERTEXELEMENTFORMAT_UINT; attrs[3].offset = sizeof(float) * 4 + 4;

    SDL_GPUGraphicsPipeline *pipes[R2D_BLEND_COUNT];
    SDL_zero(pipes);
    bool ok = true;
    for (int m = 0; m < R2D_BLEND_COUNT && ok; ++m) {
        pipes[m] = r2d__create_pipeline(r->device, r->window, vertex, fragment, &vb, attrs, 4,
                                        (R2DBlendMode)m);
        if (!pipes[m]) {
            SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error,
                         "конвейер для режима %d не создался: %s", m, SDL_GetError());
            ok = false;
        }
    }
    SDL_ReleaseGPUShader(r->device, vertex);

    // Конвейер меша: свой формат вершины (глубина третьим компонентом
    // позиции). Нужен один раз — при первой компиляции спрайтов.
    if (ok && !r->mesh_pipelines[0]) {
        SDL_GPUVertexBufferDescription mesh_vb;
        SDL_zero(mesh_vb);
        mesh_vb.slot = 0;
        mesh_vb.pitch = sizeof(R2DMeshVertex);
        mesh_vb.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

        SDL_GPUVertexAttribute mesh_attrs[3];
        SDL_zero(mesh_attrs);
        // Позиция — float3 (глубина третьим компонентом): так атрибуты не
        // пересекаются. Отдельный float на нулевом смещении делил бы байты с
        // позицией, и конвейер молча не создавался (нашлось проверкой).
        mesh_attrs[0].location = 0; mesh_attrs[0].buffer_slot = 0; mesh_attrs[0].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT3; mesh_attrs[0].offset = 0;
        mesh_attrs[1].location = 1; mesh_attrs[1].buffer_slot = 0; mesh_attrs[1].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; mesh_attrs[1].offset = sizeof(float) * 3;
        mesh_attrs[2].location = 2; mesh_attrs[2].buffer_slot = 0; mesh_attrs[2].format = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM; mesh_attrs[2].offset = sizeof(float) * 5;

        SDL_GPUShader *mesh_vs = r2d__make_shader(r->device, &r2d_shader_mesh_vert,
                                                  SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
        if (mesh_vs) {
            for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
                r->mesh_pipelines[m] = r2d__create_pipeline(r->device, r->window, mesh_vs,
                                                            fragment, &mesh_vb, mesh_attrs, 3,
                                                            (R2DBlendMode)m);
            }
            SDL_ReleaseGPUShader(r->device, mesh_vs);
        }
    }

    if (!ok) {
        for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
            if (pipes[m]) SDL_ReleaseGPUGraphicsPipeline(r->device, pipes[m]);
        }
        SDL_ReleaseGPUShader(r->device, fragment);
        return -1;
    }

    R2DUserShader *us = &r->user_shaders[slot];
    r2d__user_shader_destroy(r, us);   // перекомпиляция поверх старого
    us->used = true;
    SDL_snprintf(us->name, sizeof us->name, "%s", name);
    us->fragment = fragment;
    for (int m = 0; m < R2D_BLEND_COUNT; ++m) us->pipelines[m] = pipes[m];
    if (slot > r->user_shader_count) r->user_shader_count = slot;

    r->user_shader_error[0] = '\0';
    R2D_WARN("пользовательский шейдер \"%s\" скомпилирован (слот %d)", name, slot);
    return slot;
}

const char *r2d_render_user_shader_error(const R2DRenderer *r)
{
    return r ? r->user_shader_error : "";
}

int r2d_render_user_shader_count(const R2DRenderer *r)
{
    int n = 0;
    if (r) {
        for (int i = 1; i < R2D_MAX_USER_SHADERS; ++i) {
            if (r->user_shaders[i].used) n++;
        }
    }
    return n;
}

int r2d_batch_submit_fx(R2DRenderer *r, const float *transforms, const uint32_t *colors,
                        const int32_t *fx, int count, int blend)
{
    if (count <= 0) return 0;
    if (!transforms) {
        R2D_ERROR("submitSprites: не передан массив трансформов");
        return 0;
    }
    if (blend < 0 || blend >= R2D_BLEND_COUNT) blend = R2D_BLEND_ALPHA;

    // Режим и эффект действуют только на этот пакет: после цикла возвращаем
    // прежние (обычно ALPHA и «без эффекта»), чтобы старые drawSprite/drawRect
    // не подхватили чужой конвейер.
    const uint8_t prev_blend = r->batch_blend;
    const uint8_t prev_fx = r->batch_fx;
    r->batch_blend = (uint8_t)blend;

    const int before = r->cmd_count;
    for (int i = 0; i < count; ++i) {
        const float *t = transforms + (size_t)i * 6;
        const uint32_t color = colors ? colors[i] : R2D_WHITE;
        const int32_t index = fx ? fx[i] : 0;
        r->batch_fx = (uint8_t)((index > 0 && index < R2D_MAX_NODE_FX) ? index : 0);
        r2d_batch_add(r, (int)t[0], t[1], t[2], t[3], t[4], t[5], color);
    }

    r->batch_blend = prev_blend;
    r->batch_fx = prev_fx;
    return r->cmd_count - before;
}

int r2d_batch_submit_blend(R2DRenderer *r, const float *transforms, const uint32_t *colors,
                           int count, int blend)
{
    return r2d_batch_submit_fx(r, transforms, colors, NULL, count, blend);
}

int r2d_batch_submit_fx_mask(R2DRenderer *r, const float *transforms, const uint32_t *colors,
                             const int32_t *fx, const uint32_t *masks, int count, int blend)
{
    if (count <= 0) return 0;
    if (!transforms) {
        R2D_ERROR("submitSprites: не передан массив трансформов");
        return 0;
    }
    if (blend < 0 || blend >= R2D_BLEND_COUNT) blend = R2D_BLEND_ALPHA;

    const uint8_t prev_blend = r->batch_blend;
    const uint8_t prev_fx = r->batch_fx;
    r->batch_blend = (uint8_t)blend;

    const int before = r->cmd_count;
    for (int i = 0; i < count; ++i) {
        const float *t = transforms + (size_t)i * 6;
        const uint32_t color = colors ? colors[i] : R2D_WHITE;
        const int32_t index = fx ? fx[i] : 0;
        // §20.1. Маска получателя света: без массива — «все слои».
        const uint32_t mask = masks ? masks[i] : 0xFFFFFFFFu;
        r->batch_fx = (uint8_t)((index > 0 && index < R2D_MAX_NODE_FX) ? index : 0);
        r2d_batch_add_mask(r, (int)t[0], t[1], t[2], t[3], t[4], t[5], color, mask);
    }

    r->batch_blend = prev_blend;
    r->batch_fx = prev_fx;
    return r->cmd_count - before;
}

int r2d_batch_submit(R2DRenderer *r, const float *transforms, const uint32_t *colors, int count)
{
    return r2d_batch_submit_blend(r, transforms, colors, count, R2D_BLEND_ALPHA);
}

int r2d_batch_count(const R2DRenderer *r)
{
    return r->cmd_count;
}

// ---------------------------------------------------------------------------
// Вывод
// ---------------------------------------------------------------------------

static bool r2d__ensure_gpu_buffers(R2DRenderer *r, uint32_t vertices, uint32_t indices)
{
    if (r->vertex_buffer && vertices <= r->vb_capacity && r->index_buffer && indices <= r->ib_capacity) {
        return true;
    }

    if (r->vertex_buffer) {
        SDL_ReleaseGPUBuffer(r->device, r->vertex_buffer);
        r->vertex_buffer = NULL;
        r->vb_capacity = 0;
    }
    if (r->index_buffer) {
        SDL_ReleaseGPUBuffer(r->device, r->index_buffer);
        r->index_buffer = NULL;
        r->ib_capacity = 0;
    }

    uint32_t vcap = 4096;
    while (vcap < vertices) vcap *= 2;
    uint32_t icap = 8192;
    while (icap < indices) icap *= 2;

    SDL_GPUBufferCreateInfo vb;
    SDL_zero(vb);
    vb.usage = SDL_GPU_BUFFERUSAGE_VERTEX;
    vb.size  = vcap * (Uint32)sizeof(R2DVertex);
    r->vertex_buffer = SDL_CreateGPUBuffer(r->device, &vb);

    SDL_GPUBufferCreateInfo ib;
    SDL_zero(ib);
    ib.usage = SDL_GPU_BUFFERUSAGE_INDEX;
    ib.size  = icap * (Uint32)sizeof(uint32_t);
    r->index_buffer = SDL_CreateGPUBuffer(r->device, &ib);

    if (!r->vertex_buffer || !r->index_buffer) {
        R2D_ERROR("не удалось создать GPU-буферы: %s", SDL_GetError());
        return false;
    }

    r->vb_capacity = vcap;
    r->ib_capacity = icap;
    R2D_LOG("GPU-буферы: %u вершин / %u индексов", vcap, icap);
    return true;
}

static bool r2d__ensure_upload_buffer(R2DRenderer *r, uint32_t bytes)
{
    if (r->upload_buffer && bytes <= r->upload_capacity) return true;
    if (r->upload_buffer) {
        SDL_ReleaseGPUTransferBuffer(r->device, r->upload_buffer);
        r->upload_buffer = NULL;
        r->upload_capacity = 0;
    }

    uint32_t cap = 256 * 1024;
    while (cap < bytes) cap *= 2;

    SDL_GPUTransferBufferCreateInfo info;
    SDL_zero(info);
    info.usage = SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;
    info.size  = cap;
    r->upload_buffer = SDL_CreateGPUTransferBuffer(r->device, &info);
    if (!r->upload_buffer) {
        R2D_ERROR("не удалось создать transfer-буфер: %s", SDL_GetError());
        return false;
    }
    r->upload_capacity = cap;
    return true;
}

void r2d_render_upload(R2DRenderer *r, SDL_GPUCommandBuffer *cmd)
{
    // Треугольники могут быть и без спрайтов: тогда r->index_count == 0,
    // но буферы всё равно должны быть созданы и залиты.
    if (r->index_count == 0 && r->tri_vertex_count == 0 && r->light_vertex_count == 0
        && r->mesh_vertex_count == 0) return;

    // Дописываем треугольники в конец общего вершинного/индексного буфера.
    // tri_vertex_count обнуляем после раскладки, чтобы повторный upload в том
    // же кадре не продублировал данные; tri_index_start и tri_batches живут
    // до конца кадра и нужны r2d_render_draw.
    if (r->tri_vertex_count > 0) {
        if (!r2d__grow((void **)&r->vertices, &r->vertex_cap,
                        r->vertex_count + r->tri_vertex_count, sizeof(R2DVertex))) return;
        if (!r2d__grow((void **)&r->indices, &r->index_cap,
                        r->index_count + r->tri_vertex_count, sizeof(uint32_t))) return;

        const int base = r->vertex_count;
        SDL_memcpy(&r->vertices[base], r->tri_vertices,
                   (size_t)r->tri_vertex_count * sizeof(R2DVertex));
        for (int i = 0; i < r->tri_vertex_count; ++i) {
            r->indices[r->index_count + i] = (uint32_t)(base + i);
        }

        // Индексы идут последовательно, поэтому vertex_offset пакета — это
        // сразу и смещение индексов от начала диапазона треугольников.
        r->tri_index_start  = r->index_count;
        r->vertex_count    += r->tri_vertex_count;
        r->index_count     += r->tri_vertex_count;
        r->tri_vertex_count = 0;
    }

    // Меш идёт своим диапазоном: свой формат вершины (с глубиной), но тот же
    // индексный буфер. Рисуется ПЕРВЫМ в проходе сцены, чтобы успеть записать
    // глубину до спрайтов.
    r->stat_mesh_uploads++;
    if (r->mesh_vertex_count > r->stat_mesh_peak) r->stat_mesh_peak = r->mesh_vertex_count;
    // Громкий след в stderr: агентский клиент логи R2D_LOG не показывает, а
    // WARN видно всегда — им и проверяем, доходит ли меш до заливки.

    if (r->mesh_vertex_count > 0) {
        if (!r2d__grow((void **)&r->mesh_vertex_buffer, &r->mesh_vb_cap,
                        r->mesh_vertex_count, sizeof(R2DMeshVertex))) return;
        SDL_memcpy(r->mesh_vertex_buffer, r->mesh_vertices,
                   (size_t)r->mesh_vertex_count * sizeof(R2DMeshVertex));
        if (!r2d__grow((void **)&r->indices, &r->index_cap,
                        r->index_count + r->mesh_vertex_count, sizeof(uint32_t))) return;
        // Индексы меша нумеруются ОТ НАЧАЛА СВОЕГО буфера: он отдельный от
        // спрайтов, и прибавление общего r->vertex_count уводило чтение за
        // пределы буфера — движок падал с сегфолтом на первом же меше.
        for (int i = 0; i < r->mesh_vertex_count; ++i) {
            r->indices[r->index_count + i] = (uint32_t)i;
        }
        r->mesh_index_start = r->index_count;
        r->mesh_vertex_upload = r->mesh_vertex_count;
        r->index_count += r->mesh_vertex_count;
        // Очередь переехала в буфер: заливка её очищает, а не начало кадра.
        r->mesh_vertex_count = 0;
    }
    // Отрисовка читает ЗАЛИТЫЕ батчи: очередь в этот момент уже пуста.
    if (r->mesh_batch_count > 0) {
        r->mesh_batch_upload = r->mesh_batch_count;
        r->mesh_batch_count = 0;
    }

    // Свет идёт в тот же вершинный/индексный буфер, но своим диапазоном: его
    // рисует отдельный проход в текстуру света, а не проход сцены.
    if (r->light_vertex_count > 0) {
        if (!r2d__grow((void **)&r->vertices, &r->vertex_cap,
                        r->vertex_count + r->light_vertex_count, sizeof(R2DVertex))) return;
        if (!r2d__grow((void **)&r->indices, &r->index_cap,
                        r->index_count + r->light_vertex_count, sizeof(uint32_t))) return;

        const int base = r->vertex_count;
        SDL_memcpy(&r->vertices[base], r->light_vertices,
                   (size_t)r->light_vertex_count * sizeof(R2DVertex));
        for (int i = 0; i < r->light_vertex_count; ++i) {
            r->indices[r->index_count + i] = (uint32_t)(base + i);
        }

        r->light_index_start  = r->index_count;
        r->vertex_count      += r->light_vertex_count;
        r->index_count       += r->light_vertex_count;
        r->light_vertex_count = 0;
    }

    if (r->index_count == 0) return;
    if (!r2d__ensure_gpu_buffers(r, (uint32_t)r->vertex_count, (uint32_t)r->index_count)) return;

    const Uint32 vertex_bytes = (Uint32)r->vertex_count * (Uint32)sizeof(R2DVertex);
    const Uint32 index_bytes  = (Uint32)r->index_count * (Uint32)sizeof(uint32_t);
    if (!r2d__ensure_upload_buffer(r, vertex_bytes + index_bytes
                                   + (uint32_t)(r->mesh_vertex_upload * (int)sizeof(R2DMeshVertex)))) return;

    // cycle=true — SDL сам ротирует внутренние ресурсы, поэтому не нужно
    // вручную следить за тем, что предыдущий кадр ещё читает эти данные.
    // Буфер меша: свой, потому что формат вершины шире спрайтового.
    const uint32_t mesh_bytes = (uint32_t)(r->mesh_vertex_upload * (int)sizeof(R2DMeshVertex));
    if (r->mesh_vertex_upload > 0) {
        if (r->mesh_buffer && r->mesh_vb_capacity >= r->mesh_vertex_upload) {
            // Места хватает — переиспользуем.
        } else {
            if (r->mesh_buffer) {
                SDL_ReleaseGPUBuffer(r->device, r->mesh_buffer);
                r->mesh_buffer = NULL;
                r->mesh_vb_capacity = 0;
            }
            uint32_t cap = 1024;
            while (cap < (uint32_t)r->mesh_vertex_upload) cap *= 2;
            SDL_GPUBufferCreateInfo mb;
            SDL_zero(mb);
            mb.usage = SDL_GPU_BUFFERUSAGE_VERTEX;
            mb.size  = cap * (Uint32)sizeof(R2DMeshVertex);
            r->mesh_buffer = SDL_CreateGPUBuffer(r->device, &mb);
            if (!r->mesh_buffer) {
                R2D_ERROR("не удалось создать GPU-буфер меша: %s", SDL_GetError());
                return;
            }
            r->mesh_vb_capacity = cap;
        }
    }

    void *mapped = SDL_MapGPUTransferBuffer(r->device, r->upload_buffer, true);
    if (!mapped) {
        R2D_ERROR("SDL_MapGPUTransferBuffer: %s", SDL_GetError());
        return;
    }
    SDL_memcpy(mapped, r->vertices, vertex_bytes);
    if (mesh_bytes > 0) {
        SDL_memcpy((Uint8 *)mapped + vertex_bytes, r->mesh_vertex_buffer, mesh_bytes);
    }
    SDL_memcpy((Uint8 *)mapped + vertex_bytes + mesh_bytes, r->indices, index_bytes);
    SDL_UnmapGPUTransferBuffer(r->device, r->upload_buffer);

    SDL_GPUCopyPass *cp = SDL_BeginGPUCopyPass(cmd);

    SDL_GPUTransferBufferLocation src;
    SDL_zero(src);
    src.transfer_buffer = r->upload_buffer;
    src.offset          = 0;

    SDL_GPUBufferRegion dst;
    SDL_zero(dst);
    dst.buffer = r->vertex_buffer;
    dst.offset = 0;
    dst.size   = vertex_bytes;
    SDL_UploadToGPUBuffer(cp, &src, &dst, true);

    if (mesh_bytes > 0 && r->mesh_buffer) {
        src.offset = vertex_bytes;
        SDL_GPUBufferRegion mdst;
        SDL_zero(mdst);
        mdst.buffer = r->mesh_buffer;
        mdst.offset = 0;
        mdst.size   = mesh_bytes;
        SDL_UploadToGPUBuffer(cp, &src, &mdst, true);
    }

    src.offset = vertex_bytes + mesh_bytes;
    dst.buffer = r->index_buffer;
    dst.offset = 0;
    dst.size   = index_bytes;
    SDL_UploadToGPUBuffer(cp, &src, &dst, true);

    SDL_EndGPUCopyPass(cp);

    r->stat_upload_bytes = vertex_bytes + mesh_bytes + index_bytes;
    r->stat_vertices     = r->vertex_count;
}

// Привязывает конвейер режима и общие вершинный/индексный буферы. Буферы
// привязываем при каждой смене конвейера: так состояние точно не зависит от
// того, переживает ли привязка буферов смену пайплайна на конкретном бэкенде.
static void r2d__bind_pipeline(R2DRenderer *r, SDL_GPURenderPass *pass, uint8_t mode)
{
    if (mode >= R2D_BLEND_COUNT) mode = R2D_BLEND_ALPHA;
    SDL_BindGPUGraphicsPipeline(pass, r->pipelines[mode]);

    SDL_GPUBufferBinding vb;
    SDL_zero(vb);
    vb.buffer = r->vertex_buffer;
    vb.offset = 0;
    SDL_BindGPUVertexBuffers(pass, 0, &vb, 1);

    SDL_GPUBufferBinding ib;
    SDL_zero(ib);
    ib.buffer = r->index_buffer;
    ib.offset = 0;
    SDL_BindGPUIndexBuffer(pass, &ib, SDL_GPU_INDEXELEMENTSIZE_32BIT);
}

// ---------------------------------------------------------------------------
// §20.1. Параметры спрайтовой фрагментной стадии.
//
// Стадия умеет три режима: обычный спрайт (0), запись маски получателя света
// (1) и накопление света с гейтом (2). Режим — юниформа (SDL_PushGPUFragment
// UniformData), а биты маски — атрибут вершины: так участок спрайтов остаётся
// одним draw call.
// ---------------------------------------------------------------------------
typedef struct R2DSpriteParams {
    float    mode;     // 0 — спрайт, 1 — маска, 2 — свет с гейтом
    uint32_t layer;    // биты слоя источника (шейдер читает их как float-биты)
    float    inv_w;    // 1/ширина маски (для режима 2)
    float    inv_h;    // 1/высота маски
} R2DSpriteParams;

static void r2d__push_sprite_params(SDL_GPUCommandBuffer *cmd, float mode, uint32_t layer,
                                    int mask_w, int mask_h)
{
    R2DSpriteParams p;
    SDL_zero(p);
    p.mode  = mode;
    p.layer = layer;
    p.inv_w = mask_w > 0 ? 1.0f / (float)mask_w : 0.0f;
    p.inv_h = mask_h > 0 ? 1.0f / (float)mask_h : 0.0f;
    SDL_PushGPUFragmentUniformData(cmd, 0, &p, (Uint32)sizeof p);
}

// Две выборки спрайтовой стадии: текстура пакета и маска получателя. Когда
// масок в кадре нет, второй сэмплер — белая 1×1: он не читается (режим 0), но
// привязать его обязательно, иначе рисует невалидный набор ресурсов.
static void r2d__bind_sprite_samplers(R2DRenderer *r, SDL_GPURenderPass *pass,
                                      int texture, SDL_GPUSampler *filter)
{
    SDL_GPUTextureSamplerBinding b[2];
    SDL_zero(b);
    b[0].texture = r->textures[texture].handle;
    b[0].sampler = filter ? filter : r->sampler;
    b[1].texture = (r->light_mask_used && r->light_mask_target)
        ? r->light_mask_target : r->textures[r->white_texture].handle;
    // Маска — биты, а не картинка: только point-фильтрация, иначе байты
    // смешались бы на границе и гейт стал бы случайным.
    b[1].sampler = r->sampler;
    SDL_BindGPUFragmentSamplers(pass, 0, b, 2);
}

// Рисует диапазон спрайтов [from, to): соседние команды с одной текстурой и
// одним режимом смешивания склеиваются в один draw call. bound_blend — «что
// уже привязано» (-1 — ничего), состояние переживает вызовы, потому что
// диапазоны рисуются в разных проходах и конвейер всё равно перепривяжется.
/**
 * @param mode 0 — обычная отрисовка спрайтов; 1 — запись маски получателя
 *             света (§20.1): те же квады, но цвет — биты маски (конвейер без
 *             смешивания и без z-буфера, текстура не читается).
 */
static void r2d__draw_sprite_range(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                   SDL_GPURenderPass *pass,
                                   int from, int to, int *bound_blend, int mode)
{
    if (to <= from) return;

    int run_start = from;
    for (int i = from + 1; i <= to; ++i) {
        // Участок — это непрерывные команды с одной текстурой, режимом
        // смешивания и шейдером узла: только между ними можно не переключать
        // конвейер и не пушить юниформы.
        const bool end_of_run =
            (i == to) ||
            (r->sprites[r->cmds[i].sprite].texture != r->sprites[r->cmds[run_start].sprite].texture) ||
            (r->cmds[i].blend != r->cmds[run_start].blend) ||
            (r->cmds[i].filter != r->cmds[run_start].filter) ||
            (r->cmds[i].fx != r->cmds[run_start].fx) ||
            // Обрезка тоже разрывает участок: scissor ставится на проход, а не
            // на команду, поэтому внутри участка он должен быть одинаков.
            (r->cmds[i].clip != r->cmds[run_start].clip);

        if (!end_of_run) continue;

        const int texture = r->sprites[r->cmds[run_start].sprite].texture;
        // Внимание: это РЕЖИМ СМЕШИВАНИЯ, а не режим стадии (параметр
        // mode). Имена разведены намеренно: их совпадение уже приводило
        // к тому, что проход маски писал картинку спрайта вместо битов.
        const uint8_t blend_mode = r->cmds[run_start].blend;
        const uint8_t fx_index = r->cmds[run_start].fx;
        if (fx_index > 0) {
            // Шейдер узла: свой конвейер на каждый режим смешивания и
            // юниформы с видом эффекта и его параметрами.
            const R2DNodeFx *node_fx = &r->fx[fx_index];
            const uint8_t pipe_mode = blend_mode < R2D_BLEND_COUNT ? blend_mode : R2D_BLEND_ALPHA;
            // Пользовательский шейдер — свой конвейер на каждый режим
            // смешивания; встроенные эффекты живут на общем конвейере.
            // В режиме маски шейдер узла не нужен: биты маски пишет общий
            // конвейер маски, а эффект узла на маску не влияет.
            SDL_GPUGraphicsPipeline *pipe = mode == 1 ? r->light_mask_pipeline
                : (node_fx->user > 0
                    ? r->user_shaders[node_fx->user].pipelines[pipe_mode]
                    : r->fx_pipelines[pipe_mode]);
            if (pipe) {
                SDL_BindGPUGraphicsPipeline(pass, pipe);
                SDL_GPUBufferBinding vb;
                SDL_zero(vb);
                vb.buffer = r->vertex_buffer;
                SDL_BindGPUVertexBuffers(pass, 0, &vb, 1);
                SDL_GPUBufferBinding ib;
                SDL_zero(ib);
                ib.buffer = r->index_buffer;
                SDL_BindGPUIndexBuffer(pass, &ib, SDL_GPU_INDEXELEMENTSIZE_32BIT);
                if (mode != 1) {
                    struct { float p[4]; float c[4]; } uni;
                    // Для встроенного шейдера первый параметр — вид эффекта;
                    // пользовательский вид не различает (у него свой конвейер).
                    uni.p[0] = node_fx->user > 0 ? 0.0f : (float)node_fx->kind;
                    uni.p[1] = node_fx->p1;
                    uni.p[2] = node_fx->p2;
                    uni.p[3] = node_fx->p3;
                    uni.c[0] = (float)(node_fx->color & 0xFF) / 255.0f;
                    uni.c[1] = (float)((node_fx->color >> 8) & 0xFF) / 255.0f;
                    uni.c[2] = (float)((node_fx->color >> 16) & 0xFF) / 255.0f;
                    uni.c[3] = (float)((node_fx->color >> 24) & 0xFF) / 255.0f;
                    SDL_PushGPUFragmentUniformData(cmd, 0, &uni, (Uint32)sizeof uni);
                }
                *bound_blend = -1;      // следующий обычный участок перебиндит пайплайн
            } else {
                if (mode == 1) {
                    if (r->light_mask_pipeline) {
                        SDL_BindGPUGraphicsPipeline(pass, r->light_mask_pipeline);
                    }
                    *bound_blend = -1;
                } else if ((int)blend_mode != *bound_blend) {
                    r2d__bind_pipeline(r, pass, blend_mode);
                    *bound_blend = (int)blend_mode;
                }
            }
        } else if (mode == 1) {
            if (r->light_mask_pipeline) {
                SDL_BindGPUGraphicsPipeline(pass, r->light_mask_pipeline);
            }
            *bound_blend = -1;
        } else if ((int)blend_mode != *bound_blend) {
            r2d__bind_pipeline(r, pass, blend_mode);
            *bound_blend = (int)blend_mode;
        }

        // Обрезка участка: scissor ставится на ПРОХОД, поэтому его надо задать
        // перед рисованием и снять после. Без обрезки — полный кадр, иначе
        // осталась бы обрезка предыдущего участка.
        const int16_t clip = r->cmds[run_start].clip;
        if (clip >= 0 && clip < r->clip_count) {
            SDL_SetGPUScissor(pass, &r->clips[clip]);
        } else {
            const SDL_Rect full = { 0, 0, r->screen_w, r->screen_h };
            SDL_SetGPUScissor(pass, &full);
        }

        // Фильтр переключается на лету: nearest — пиксель-арт без размытия,
        // linear — сглаженный масштаб (текст, крупные спрайты). Сэмплер один
        // на участок, поэтому разные режимы просто разрывают участок.
        SDL_GPUSampler *filter = (r->cmds[run_start].filter && r->linear_sampler)
            ? r->linear_sampler : r->sampler;
        r2d__bind_sprite_samplers(r, pass, texture, filter);
        // Режим стадии: 1 — запись маски, 0 — обычный спрайт. У узла со своим
        // шейдером тот же слот 0 занят ЕГО юниформами (своя раскладка, 32
        // байта): пушить туда параметры стадии нельзя — они перетёрли бы
        // эффект. В режиме маски шейдер узла не рисует, поэтому параметры
        // стадии нужны и там.
        if (mode == 1 || fx_index == 0) {
            r2d__push_sprite_params(cmd, mode == 1 ? 1.0f : 0.0f, 0xFFFFFFFFu, 0, 0);
        }

        const Uint32 first_index = (Uint32)(run_start * 6);
        const Uint32 num_indices = (Uint32)((i - run_start) * 6);
        SDL_DrawGPUIndexedPrimitives(pass, num_indices, 1, first_index, 0, 0);

        r->stat_draws++;
        r->stat_batches++;
        if (fx_index > 0) r->stat_fx_cmds += (i - run_start);
        run_start = i;
    }
}

// Рисует пакеты треугольников в текущий проход: у каждого пакета свой конвейер
// (режим смешивания), текстура всегда белая, потому что цвет приходит с вершин.
// index_start — смещение диапазона в общем индексном буфере: у сцены и у света
// lightmap диапазоны разные, а буфер один.
/**
 * @param is_light true — пакеты СВЕТА (§20.1): каждый пакет несёт свои биты
 *        слоя источника, и свет получают только те пиксели, чья маска
 *        получателя пересекается с этими битами. Для сцены режим стадии 0 —
 *        поведение прежнее.
 */
static void r2d__draw_tri_batches(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                  SDL_GPURenderPass *pass,
                                  const R2DTriBatch *batches, int count,
                                  int index_start, int *bound_blend, bool is_light)
{
    for (int b = 0; b < count; ++b) {
        const R2DTriBatch *tb = &batches[b];
        if (tb->vertex_count <= 0) continue;

        if ((int)tb->blend != *bound_blend) {
            r2d__bind_pipeline(r, pass, tb->blend);
            *bound_blend = (int)tb->blend;
        }

        // Белая 1×1 вместо текстуры: цвет приходит с вершин. Второй сэмплер —
        // маска получателя света: у света она решает, куда свет вообще попадёт.
        r2d__bind_sprite_samplers(r, pass, r->white_texture, r->sampler);
        if (is_light) {
            r2d__push_sprite_params(cmd, 2.0f, tb->layer, r->light_mask_w, r->light_mask_h);
        } else {
            r2d__push_sprite_params(cmd, 0.0f, 0xFFFFFFFFu, 0, 0);
        }

        SDL_DrawGPUIndexedPrimitives(pass, (Uint32)tb->vertex_count, 1,
                                     (Uint32)(index_start + tb->vertex_offset), 0, 0);
        r->stat_draws++;
        r->stat_batches++;
    }
}

/**
 * Готовит z-буфер под размер кадра. Текстура создаётся один раз и
 * пересоздаётся при смене размера: без неё тест глубины нечем делать, а
 * пересоздавать каждый кадр — трата памяти и времени.
 */
bool r2d_render_depth_target(R2DRenderer *r, int w, int h, SDL_GPUDepthStencilTargetInfo *out)
{
    if (!r || !out) return false;
    if (!r->depth_enabled) return false;
    const int dw = w > 0 ? w : 1;
    const int dh = h > 0 ? h : 1;
    if (r->depth_texture && (r->depth_w != dw || r->depth_h != dh)) {
        SDL_ReleaseGPUTexture(r->device, r->depth_texture);
        r->depth_texture = NULL;
    }
    if (!r->depth_texture) {
        SDL_GPUTextureCreateInfo info;
        SDL_zero(info);
        info.type                 = SDL_GPU_TEXTURETYPE_2D;
        info.format               = SDL_GPU_TEXTUREFORMAT_D32_FLOAT;
        info.width                = (Uint32)dw;
        info.height               = (Uint32)dh;
        info.layer_count_or_depth = 1;
        info.num_levels           = 1;
        info.usage                = SDL_GPU_TEXTUREUSAGE_DEPTH_STENCIL_TARGET;
        r->depth_texture = SDL_CreateGPUTexture(r->device, &info);
        if (!r->depth_texture) {
            R2D_ERROR("z-буфер: SDL_CreateGPUTexture: %s", SDL_GetError());
            r->depth_enabled = false;
            return false;
        }
        r->depth_w = dw;
        r->depth_h = dh;
    }
    SDL_zero(*out);
    out->texture     = r->depth_texture;
    out->clear_depth = 1.0f;                     // дальняя плоскость: ближе — меньше
    out->load_op     = SDL_GPU_LOADOP_CLEAR;
    out->store_op    = SDL_GPU_STOREOP_STORE;
    return true;
}

void r2d_render_set_depth(R2DRenderer *r, bool enabled)
{
    if (!r) return;
    r->depth_enabled = enabled;
    // Выключение глубины освобождает текстуру: она нужна только тесту.
    if (!enabled && r->depth_texture) {
        SDL_ReleaseGPUTexture(r->device, r->depth_texture);
        r->depth_texture = NULL;
        r->depth_w = r->depth_h = 0;
    }
}

bool r2d_render_depth(const R2DRenderer *r)
{
    return r ? (r->depth_enabled && r->depth_texture != NULL) : false;
}

/**
 * Рисует накопленный меш. Вызывается ПЕРВЫМ в проходе сцены: меш записывает
 * глубину, и спрайты, нарисованные после, проверяются по ней — поэтому плоский
 * спрайт не рисуется поверх выпуклости персонажа.
 */
void r2d_render_draw_mesh(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass)
{
    (void)cmd;
    if (!r || !pass) return;
    r->stat_mesh_draws++;
    if (!r->depth_enabled) return;
    if (r->mesh_vertex_upload <= 0 || r->mesh_batch_upload <= 0) return;
    if (!r->mesh_vertex_buffer || !r->mesh_pipelines[0]) return;

    // ИНДЕКСНЫЙ БУФЕР НАДО ПРИВЯЗАТЬ ЗДЕСЬ САМИМ.
    //
    // Меш рисуется ПЕРВЫМ в проходе сцены (он пишет глубину, по которой потом
    // проверяются спрайты). Индексный буфер привязывают участки спрайтов и
    // треугольников — то есть ПОСЛЕ меша. Без этой привязки
    // SDL_DrawGPUIndexedPrimitives уходил с непривязанным индексным буфером, и
    // Metal падал с SIGSEGV. Это и был тот дефект, который я искал замерами.
    SDL_GPUBufferBinding ib;
    SDL_zero(ib);
    ib.buffer = r->index_buffer;
    if (!ib.buffer) return;
    SDL_BindGPUIndexBuffer(pass, &ib, SDL_GPU_INDEXELEMENTSIZE_32BIT);

    SDL_GPUBufferBinding vb;
    SDL_zero(vb);
    vb.buffer = r->mesh_buffer ? r->mesh_buffer : NULL;
    if (!vb.buffer) return;
    // Мешевый формат шире спрайтового, поэтому у него свой буфер.
    SDL_BindGPUVertexBuffers(pass, 0, &vb, 1);

    int bound = -1;
    for (int b = 0; b < r->mesh_batch_upload; ++b) {
        const R2DTriBatch *mb = &r->mesh_batches[b];
        if (mb->vertex_count <= 0) continue;
        if ((int)mb->blend != bound) {
            SDL_BindGPUGraphicsPipeline(pass, r->mesh_pipelines[mb->blend]);
            bound = (int)mb->blend;
        }
        SDL_GPUTextureSamplerBinding tex;
        SDL_zero(tex);
        // Текстура ПАКЕТА. У «белого» меша (texture < 0) — белая текстура, как
        // было раньше; иначе сэмплим по u/v ту, что просила игра.
        const int ti = (mb->texture >= 0 && mb->texture < R2D_MAX_TEXTURES
                        && r->textures[mb->texture].handle)
                           ? mb->texture : r->white_texture;
        // Меш рисует тот же спрайтовый фрагментный шейдер, поэтому ему нужны
        // обе выборки и параметры стадии (режим 0 — текстура × цвет).
        (void)tex;
        r2d__bind_sprite_samplers(r, pass, ti, r->sampler);
        r2d__push_sprite_params(cmd, 0.0f, 0xFFFFFFFFu, 0, 0);
        SDL_DrawGPUIndexedPrimitives(pass, (Uint32)mb->vertex_count, 1,
                                     (Uint32)(r->mesh_index_start + mb->vertex_offset), 0, 0);
        r->stat_draws++;
        r->stat_batches++;
    }
    r->stat_mesh_cmds += r->mesh_batch_upload;
    r->stat_mesh_frames++;
}

void r2d_render_mark_unlit(R2DRenderer *r)
{
    if (r) r->unlit_cmd_start = r->cmd_count;
}

void r2d_render_draw_world(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                           SDL_GPURenderPass *pass)
{
    if (r->cmd_count == 0 && r->tri_batch_count == 0 && r->light_batch_count == 0
        && r->mesh_batch_upload == 0) return;

    // Интерфейс помечен JS-стороной; если метки нет — все спрайты считаются
    // миром (старое поведение, HUD тогда тоже под пост-обработкой).
    const int ui_from = r->ui_cmd_start >= 0 ? r->ui_cmd_start : r->cmd_count;
    // Неосвещённый мировой слой: спрайты после этой метки рисуются ПОСЛЕ
    // света, но ДО интерфейса. Без метки диапазон пуст и порядок прежний.
    int unlit_from = r->unlit_cmd_start >= 0 ? r->unlit_cmd_start : ui_from;
    if (unlit_from > ui_from) unlit_from = ui_from;
    if (unlit_from < 0) unlit_from = 0;

    int bound_blend = -1;
    // Меш первым: он пишет глубину, по которой проверяются спрайты.
    r2d_render_draw_mesh(r, cmd, pass);

    r2d__draw_sprite_range(r, cmd, pass, 0, unlit_from, &bound_blend, 0);

    r->stat_sprites = r->cmd_count;

    // Треугольники рисуем ПОСЛЕ всех спрайтов, белой текстурой, каждый свой
    // вызов со своим конвейером. Это осознанно: свет накладывается поверх сцены.
    r2d__draw_tri_batches(r, cmd, pass, r->tri_batches, r->tri_batch_count,
                          r->tri_index_start, &bound_blend, false);

    // Свет, который не ушёл в lightmap (он выключен, идёт чужой render target
    // или не удалось создать текстуру), рисуем прямо в сцену — как до появления
    // lightmap. Иначе свет просто исчез бы.
    if (r->light_batch_count > 0 && !r->lightmap_used) {
        // Запасной путь: свет рисуется прямо в сцену. Цели маски здесь нет,
        // поэтому работает объявленный fallback — свет получают все (см.
        // docs/highlevel/render.md §4.8).
        r2d__draw_tri_batches(r, cmd, pass, r->light_batches, r->light_batch_count,
                              r->light_index_start, &bound_blend, true);
    }

    // Композит световой карты: после освещённого мира и тумана, но ДО
    // неосвещённого слоя — иначе `.lit(false)` получал бы свет поверх себя
    // (нашлось замером: узел внутри радиуса источника при включённой карте
    // света давал 255 вместо собственных 169).
    r2d_render_light_composite(r, cmd, pass);
    // Композит привязал свой конвейер: участок неосвещённого слоя обязан
    // перебиндить спрайтовый, иначе он рисуется полноэкранным шейдером света.
    bound_blend = -1;

    // Неосвещённый мировой слой — после света, но под интерфейсом.
    if (unlit_from < ui_from) {
        r2d__draw_sprite_range(r, cmd, pass, unlit_from, ui_from, &bound_blend, 0);
    }
}

void r2d_render_draw_ui(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass)
{
    if (r->ui_cmd_start < 0) return;
    int bound_blend = -1;
    r2d__draw_sprite_range(r, cmd, pass, r->ui_cmd_start, r->cmd_count, &bound_blend, 0);
}

void r2d_render_draw(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass)
{
    r2d_render_draw_world(r, cmd, pass);
    r2d_render_draw_ui(r, cmd, pass);
}

// ---------------------------------------------------------------------------
// Жизненный цикл
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Пост-обработка
//
// Сцена уходит в offscreen-текстуру формата swapchain (чтобы конвейеры
// спрайтов подходили без изменений), а на экран её накладывает полноэкранный
// проход: свечение, вигнетка, хроматика, зерно, скан-линии и линза.
// ---------------------------------------------------------------------------

static SDL_GPUGraphicsPipeline *r2d__create_post_pipeline(R2DRenderer *r)
{
    SDL_GPUShader *vs = r2d__make_shader(r->device, &r2d_shader_post_vert,
                                          SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
    SDL_GPUShader *fs = r2d__make_shader(r->device, &r2d_shader_post_frag,
                                          SDL_GPU_SHADERSTAGE_FRAGMENT, 1, 2);
    if (!vs || !fs) {
        if (vs) SDL_ReleaseGPUShader(r->device, vs);
        if (fs) SDL_ReleaseGPUShader(r->device, fs);
        return NULL;
    }

    SDL_GPUColorTargetDescription target;
    SDL_zero(target);
    target.format = SDL_GetGPUSwapchainTextureFormat(r->device, r->window);
    target.blend_state.enable_blend = false;

    SDL_GPUGraphicsPipelineCreateInfo pipe;
    SDL_zero(pipe);
    pipe.vertex_shader   = vs;
    pipe.fragment_shader = fs;
    pipe.primitive_type  = SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;
    // Вершинного буфера нет: треугольник строится из gl_VertexIndex.
    pipe.vertex_input_state.num_vertex_buffers    = 0;
    pipe.vertex_input_state.num_vertex_attributes = 0;
    pipe.target_info.num_color_targets         = 1;
    pipe.target_info.color_target_descriptions = &target;
    pipe.rasterizer_state.fill_mode  = SDL_GPU_FILLMODE_FILL;
    pipe.rasterizer_state.cull_mode  = SDL_GPU_CULLMODE_NONE;
    pipe.rasterizer_state.front_face = SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE;
    pipe.multisample_state.sample_count = SDL_GPU_SAMPLECOUNT_1;

    SDL_GPUGraphicsPipeline *result = SDL_CreateGPUGraphicsPipeline(r->device, &pipe);
    SDL_ReleaseGPUShader(r->device, vs);
    SDL_ReleaseGPUShader(r->device, fs);
    return result;
}

// Полноэкранный конвейер для проходов свечения: тот же вершинный шейдер, что у
// пост-обработки, один сэмплер и один блок юниформов во фрагментной стадии.
// mode — режим смешивания (свечение и размытие рисуют без смешивания, композит
// lightmap — аддитивно).
static SDL_GPUGraphicsPipeline *r2d__create_fullscreen_pipeline_blend(R2DRenderer *r,
                                                                      const R2DShaderBlob *frag,
                                                                      R2DBlendMode mode)
{
    SDL_GPUShader *vs = r2d__make_shader(r->device, &r2d_shader_post_vert,
                                          SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
    SDL_GPUShader *fs = r2d__make_shader(r->device, frag,
                                          SDL_GPU_SHADERSTAGE_FRAGMENT, 1, 1);
    if (!vs || !fs) {
        if (vs) SDL_ReleaseGPUShader(r->device, vs);
        if (fs) SDL_ReleaseGPUShader(r->device, fs);
        return NULL;
    }

    SDL_GPUColorTargetDescription target;
    SDL_zero(target);
    target.format = SDL_GetGPUSwapchainTextureFormat(r->device, r->window);
    r2d__blend_state(&target.blend_state, mode);

    SDL_GPUGraphicsPipelineCreateInfo pipe;
    SDL_zero(pipe);
    pipe.vertex_shader   = vs;
    pipe.fragment_shader = fs;
    pipe.primitive_type  = SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;
    pipe.vertex_input_state.num_vertex_buffers    = 0;
    pipe.vertex_input_state.num_vertex_attributes = 0;
    pipe.target_info.num_color_targets         = 1;
    pipe.target_info.color_target_descriptions = &target;
    pipe.rasterizer_state.fill_mode  = SDL_GPU_FILLMODE_FILL;
    pipe.rasterizer_state.cull_mode  = SDL_GPU_CULLMODE_NONE;
    pipe.rasterizer_state.front_face = SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE;
    pipe.multisample_state.sample_count = SDL_GPU_SAMPLECOUNT_1;

    SDL_GPUGraphicsPipeline *result = SDL_CreateGPUGraphicsPipeline(r->device, &pipe);
    SDL_ReleaseGPUShader(r->device, vs);
    SDL_ReleaseGPUShader(r->device, fs);
    return result;
}

// Прежнее имя: полноэкранные проходы свечения рисуют без смешивания.
static SDL_GPUGraphicsPipeline *r2d__create_fullscreen_pipeline(R2DRenderer *r,
                                                                const R2DShaderBlob *frag)
{
    return r2d__create_fullscreen_pipeline_blend(r, frag, R2D_BLEND_NONE);
}

// --- SMAA (§task-22): конвейер варианта post-шейдера с -DR2D_SMAA_MODE=1 ----
//
// SMAA живёт внутри пост-прохода: отдельного render target он не требует,
// потому что читает ту же сцену (u_scene), что и пост. Конвейер — копия
// пост-конвейера с другим фрагментным шейдером; когда AA выключен, рисует
// прежний post_pipeline, поэтому выключенный режим не меняет кадр.
//
// Поля в R2DRenderer под этот конвейер нет (render.h правит другая задача),
// поэтому указатель хранится в файловой статике вместе с устройством: при
// смене устройства конвейер пересоздаётся, при shutdown — освобождается.
static SDL_GPUGraphicsPipeline *g_smaa_pipeline = NULL;
static SDL_GPUDevice          *g_smaa_device   = NULL;

#ifndef __EMSCRIPTEN__
static SDL_GPUGraphicsPipeline *r2d__create_smaa_pipeline(R2DRenderer *r)
{
    SDL_GPUShader *vs = r2d__make_shader(r->device, &r2d_shader_post_vert,
                                          SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
    SDL_GPUShader *fs = r2d__make_shader(r->device, &r2d_shader_smaa_frag,
                                          SDL_GPU_SHADERSTAGE_FRAGMENT, 1, 2);
    if (!vs || !fs) {
        if (vs) SDL_ReleaseGPUShader(r->device, vs);
        if (fs) SDL_ReleaseGPUShader(r->device, fs);
        return NULL;
    }

    SDL_GPUColorTargetDescription target;
    SDL_zero(target);
    target.format = SDL_GetGPUSwapchainTextureFormat(r->device, r->window);
    target.blend_state.enable_blend = false;

    SDL_GPUGraphicsPipelineCreateInfo pipe;
    SDL_zero(pipe);
    pipe.vertex_shader   = vs;
    pipe.fragment_shader = fs;
    pipe.primitive_type  = SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;
    pipe.vertex_input_state.num_vertex_buffers    = 0;
    pipe.vertex_input_state.num_vertex_attributes = 0;
    pipe.target_info.num_color_targets         = 1;
    pipe.target_info.color_target_descriptions = &target;
    pipe.rasterizer_state.fill_mode  = SDL_GPU_FILLMODE_FILL;
    pipe.rasterizer_state.cull_mode  = SDL_GPU_CULLMODE_NONE;
    pipe.rasterizer_state.front_face = SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE;
    pipe.multisample_state.sample_count = SDL_GPU_SAMPLECOUNT_1;

    SDL_GPUGraphicsPipeline *result = SDL_CreateGPUGraphicsPipeline(r->device, &pipe);
    SDL_ReleaseGPUShader(r->device, vs);
    SDL_ReleaseGPUShader(r->device, fs);
    return result;
}

// Конвейер SMAA для этого устройства (создаётся один раз).
static SDL_GPUGraphicsPipeline *r2d__smaa_pipeline(R2DRenderer *r)
{
    if (g_smaa_pipeline && g_smaa_device == r->device) return g_smaa_pipeline;
    if (g_smaa_pipeline && g_smaa_device != r->device) {
        // Устройство сменилось (перезапуск окна/бэкенда): старый конвейер
        // принадлежал другому устройству и уже невалиден.
        g_smaa_pipeline = NULL;
        g_smaa_device = NULL;
    }
    g_smaa_pipeline = r2d__create_smaa_pipeline(r);
    g_smaa_device = g_smaa_pipeline ? r->device : NULL;
    return g_smaa_pipeline;
}
#endif   // __EMSCRIPTEN__

// Доступен ли SMAA в этой сборке: веб-сборка (WebGPU) собирает только
// WGSL-варианты, а SMAA-вариант пока GLSL-only — честно сообщаем об этом.
bool r2d_render_smaa_available(const R2DRenderer *r)
{
#ifdef __EMSCRIPTEN__
    (void)r;
    return false;
#else
    return r != NULL;
#endif
}

// Включён ли SMAA сейчас (поле-запас поста: 0 — выключено, 2/4/8 — шаги).
bool r2d_render_smaa_on(const R2DRenderer *r)
{
    return r && r->post._pad0 >= 1.5f;
}

float r2d_render_smaa_steps(const R2DRenderer *r)
{
    return r ? r->post._pad0 : 0.0f;
}

bool r2d_render_post_enabled(const R2DRenderer *r)
{
    if (!r || !r->post_pipeline) return false;
    const R2DPostParams *p = &r->post;
    if (p->enabled <= 0.5f) return false;
    // SMAA (§task-22) — сам по себе причина считать проход: иначе включённый
    // антиалиасинг молча ничего не делал бы у игры без других эффектов поста
    // (у «нейтральных» параметров проход пропускается ради нулевой цены).
    if (r2d_render_smaa_on(r)) return true;
    // Экранное искажение (§46) само по себе включает проход: без этой строки
    // волна/шум/сдвиг каналов молча не применялись бы — кадр уходил прямо в
    // swapchain, и «параметр дошёл» выдавалось бы за работающий эффект.
    if (p->distort > 0.0001f) return true;
    return p->glow > 0.0001f || p->vignette > 0.0001f || p->chromatic > 0.0001f
        || p->lens > 0.0001f || p->grain > 0.0001f || p->scanline > 0.0001f
        || p->posterize > 1.5f || p->tint_amount > 0.0001f || p->blood > 0.0001f
        || p->saturation < 0.999f || p->saturation > 1.001f
        || p->contrast < 0.999f || p->contrast > 1.001f
        || p->brightness > 0.001f || p->brightness < -0.001f;
}

void r2d_render_mark_ui(R2DRenderer *r)
{
    if (r) r->ui_cmd_start = r->cmd_count;
}

void r2d_render_set_post(R2DRenderer *r, const R2DPostParams *params)
{
    if (!r || !params) return;
    r->post = *params;
}

const R2DPostParams *r2d_render_get_post(const R2DRenderer *r)
{
    return r ? &r->post : NULL;
}

SDL_GPUTexture *r2d_render_scene_target(R2DRenderer *r, int w, int h)
{
    if (!r || !r->device || w <= 0 || h <= 0) return NULL;
    if (r->scene_target && r->scene_w == w && r->scene_h == h) {
        // §25: факт «сцена этого кадра идёт в offscreen» для инспектора рендера.
        r->scene_target_used = true;
        return r->scene_target;
    }

    if (r->scene_target) {
        SDL_ReleaseGPUTexture(r->device, r->scene_target);
        r->scene_target = NULL;
    }

    SDL_GPUTextureCreateInfo info;
    SDL_zero(info);
    info.type   = SDL_GPU_TEXTURETYPE_2D;
    // Формат обязан совпадать с swapchain: те же конвейеры спрайтов рисуют и
    // туда, и туда, а менять формат на ходу нельзя.
    info.format = SDL_GetGPUSwapchainTextureFormat(r->device, r->window);
    info.usage  = SDL_GPU_TEXTUREUSAGE_COLOR_TARGET | SDL_GPU_TEXTUREUSAGE_SAMPLER;
    info.width              = (Uint32)w;
    info.height             = (Uint32)h;
    info.layer_count_or_depth = 1;
    info.num_levels         = 1;
    info.sample_count       = SDL_GPU_SAMPLECOUNT_1;

    r->scene_target = SDL_CreateGPUTexture(r->device, &info);
    if (!r->scene_target) {
        R2D_ERROR("SDL_CreateGPUTexture (сцена для поста): %s", SDL_GetError());
        return NULL;
    }
    r->scene_w = w;
    r->scene_h = h;
    r->scene_target_used = true;
    return r->scene_target;
}

void r2d_render_post(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass)
{
    if (!r || !r->post_pipeline || !r->scene_target || !cmd || !pass) return;

#ifndef __EMSCRIPTEN__
    // SMAA включается полем-запасом поста (0 — выключено): тогда рисует
    // отдельный конвейер с -DR2D_SMAA_MODE=1, а выключенный путь остаётся
    // прежним конвейером и прежним шейдером — кадр не меняется ни на бит.
    SDL_GPUGraphicsPipeline *pipe = r->post_pipeline;
    if (r2d_render_smaa_on(r)) {
        SDL_GPUGraphicsPipeline *smaa = r2d__smaa_pipeline(r);
        if (smaa) pipe = smaa;
    }
    SDL_BindGPUGraphicsPipeline(pass, pipe);
#else
    SDL_BindGPUGraphicsPipeline(pass, r->post_pipeline);
#endif

    // binding 0 — сцена, binding 1 — готовая размытая яркая часть (bloom).
    // Если свечения не было, туда уходит чёрная текстура 1×1 и вклад нулевой,
    // а флаг bloom_ready заставляет шейдер взять запасную ветку.
    SDL_GPUTextureSamplerBinding binding[3];
    SDL_zero(binding);
    binding[0].texture = r->scene_target;
    binding[0].sampler = r->sampler;
    binding[1].texture = r->bloom_result ? r->bloom_result : r->black_texture;
    binding[1].sampler = r->linear_sampler ? r->linear_sampler : r->sampler;
    // Шум для экранного искажения: без него привязка обязана быть валидной,
    // поэтому вместо пустой текстуры идёт та же чёрная заглушка (искажение
    // тогда просто не сдвигает UV — лучше, чем падение прохода).
    binding[2].texture = r->noise_texture ? r->noise_texture : r->black_texture;
    binding[2].sampler = r->sampler;
    SDL_BindGPUFragmentSamplers(pass, 0, binding, 3);

    // Девять vec4: раскладка совпадает с R2DPostParams и с блоком PostParams
    // в shaders/post.frag.glsl. Время эффекта пишется двумя float (lo/hi):
    // одного 32-битного поля не хватало на долгие сессии.
    {
        const double t = (double)SDL_GetTicks() / 1000.0;
        r->post.post_time_lo = (float)t;
        r->post.post_time_hi = (float)(t - (double)r->post.post_time_lo);
    }
    SDL_PushGPUFragmentUniformData(cmd, 0, &r->post, (Uint32)sizeof(R2DPostParams));
    SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
    r->stat_draws++;
    r->stat_passes++;
}

// ---------------------------------------------------------------------------
// Свечение (bloom)
//
// Три прохода после сцены и до пост-обработки:
//   1. яркий проход с понижением разрешения (порог с мягким коленом);
//   2. размытие по горизонтали;
//   3. размытие по вертикали.
// Результат лежит в bloom_a и уходит в пост-обработку как u_bloom. Разделяемое
// размытие — 5 выборок на пиксель вместо 25 у двумерного.
//
// Буферы — половинного разрешения сцены: свечение по своей природе мягкое,
// точность ему не нужна, а стоимость падает вчетверо.
// ---------------------------------------------------------------------------

static SDL_GPUTexture *r2d__create_bloom_texture(R2DRenderer *r, int w, int h)
{
    SDL_GPUTextureCreateInfo info;
    SDL_zero(info);
    info.type   = SDL_GPU_TEXTURETYPE_2D;
    // Формат совпадает с swapchain: конвейеры полноэкранных проходов общие.
    info.format = SDL_GetGPUSwapchainTextureFormat(r->device, r->window);
    info.usage  = SDL_GPU_TEXTUREUSAGE_COLOR_TARGET | SDL_GPU_TEXTUREUSAGE_SAMPLER;
    info.width              = (Uint32)w;
    info.height             = (Uint32)h;
    info.layer_count_or_depth = 1;
    info.num_levels         = 1;
    info.sample_count       = SDL_GPU_SAMPLECOUNT_1;
    return SDL_CreateGPUTexture(r->device, &info);
}

bool r2d_render_bloom_ready(R2DRenderer *r, int w, int h)
{
    if (!r || !r->device || w <= 0 || h <= 0) return false;

    if (!r->bloom_pre_pipeline) {
        r->bloom_pre_pipeline  = r2d__create_fullscreen_pipeline(r, &r2d_shader_bloom_pre_frag);
        r->bloom_blur_pipeline = r2d__create_fullscreen_pipeline(r, &r2d_shader_bloom_blur_frag);
    }
    if (!r->bloom_pre_pipeline || !r->bloom_blur_pipeline) return false;

    // Половинное разрешение, но не меньше 8 пикселей: на крошечных целях
    // размытие превратилось бы в один тексель и свечение исчезло бы.
    const int bw = w / 2 > 8 ? w / 2 : 8;
    const int bh = h / 2 > 8 ? h / 2 : 8;
    if (r->bloom_a && r->bloom_b && r->bloom_w == bw && r->bloom_h == bh) return true;

    if (r->bloom_a) { SDL_ReleaseGPUTexture(r->device, r->bloom_a); r->bloom_a = NULL; }
    if (r->bloom_b) { SDL_ReleaseGPUTexture(r->device, r->bloom_b); r->bloom_b = NULL; }
    r->bloom_result = NULL;

    r->bloom_a = r2d__create_bloom_texture(r, bw, bh);
    r->bloom_b = r2d__create_bloom_texture(r, bw, bh);
    if (!r->bloom_a || !r->bloom_b) {
        R2D_ERROR("SDL_CreateGPUTexture (свечение): %s", SDL_GetError());
        if (r->bloom_a) { SDL_ReleaseGPUTexture(r->device, r->bloom_a); r->bloom_a = NULL; }
        if (r->bloom_b) { SDL_ReleaseGPUTexture(r->device, r->bloom_b); r->bloom_b = NULL; }
        return false;
    }
    r->bloom_w = bw;
    r->bloom_h = bh;
    return true;
}

// ---------------------------------------------------------------------------
// Render target игры (viewport)
//
// Игра создаёт текстуру нужного размера, связывает её на кадр (bind) — и мир
// рисуется в неё, а не в swapchain. Прошлый кадр остаётся отдельной текстурой:
// его игра рисует как обычный спрайт (шлейф, накопление, портал), поэтому
// чтения и записи одной текстуры в одном проходе не возникает.
//
// Пост-обработка при связанном viewport'е не применяется: кадр показывается
// как есть (иначе пришлось бы гонять эффекты по чужой текстуре).
// ---------------------------------------------------------------------------

SDL_GPUTexture *r2d_render_viewport_target(R2DRenderer *r)
{
    if (!r || r->bound_viewport < 0 || r->bound_viewport >= R2D_MAX_VIEWPORTS) return NULL;
    R2DViewport *vp = &r->viewports[r->bound_viewport];
    return vp->used ? vp->target : NULL;
}

int r2d_render_viewport_create(R2DRenderer *r, int w, int h)
{
    if (!r || !r->device || w <= 0 || h <= 0) return -1;
    if (w > 16384 || h > 16384) {
        R2D_ERROR("viewport.create: размер %dx%d слишком велик", w, h);
        return -1;
    }
    int slot = -1;
    for (int i = 0; i < R2D_MAX_VIEWPORTS; ++i) {
        if (!r->viewports[i].used) { slot = i; break; }
    }
    if (slot < 0) {
        R2D_ERROR("viewport.create: достигнут лимит (%d)", R2D_MAX_VIEWPORTS);
        return -1;
    }

    // Слот в таблице текстур занимаем ДО создания GPU-текстур: иначе при
    // переполнении таблицы пришлось бы освобождать уже созданное. Раньше здесь
    // стоял безусловный `texture_count++` — на 256-м вьюпорте он писал за
    // границу массива R2DTexture и затирал поля рендерера.
    const int tex_id = r2d__texture_slot_alloc(r);
    if (tex_id < 0) {
        R2D_ERROR("viewport.create: нет свободного слота текстуры (лимит %d)",
                  R2D_MAX_TEXTURES);
        return -1;
    }

    SDL_GPUTexture *target = r2d__create_bloom_texture(r, w, h);
    SDL_GPUTexture *history = r2d__create_bloom_texture(r, w, h);
    if (!target || !history) {
        if (target) SDL_ReleaseGPUTexture(r->device, target);
        if (history) SDL_ReleaseGPUTexture(r->device, history);
        R2D_ERROR("viewport.create: %s", SDL_GetError());
        return -1;
    }

    // История должна быть спрайтом: игра рисует её как обычную картинку.
    r->textures[tex_id].handle = history;
    r->textures[tex_id].width  = w;
    r->textures[tex_id].height = h;
    r->textures[tex_id].alive  = true;
    SDL_snprintf(r->textures[tex_id].name, sizeof r->textures[tex_id].name,
                 "<viewport %d>", slot);
    const int sprite = r2d_sprite_create(r, tex_id, 0, 0, (float)w, (float)h);

    R2DViewport *vp = &r->viewports[slot];
    vp->used = true;
    vp->target = target;
    vp->history = history;
    vp->w = w;
    vp->h = h;
    vp->sprite = sprite;
    return slot;
}

bool r2d_render_viewport_destroy(R2DRenderer *r, int id)
{
    if (!r || id < 0 || id >= R2D_MAX_VIEWPORTS) return false;
    R2DViewport *vp = &r->viewports[id];
    if (!vp->used) return false;
    if (r->bound_viewport == id) r->bound_viewport = -1;
    if (vp->target) SDL_ReleaseGPUTexture(r->device, vp->target);
    if (vp->history) {
        // Текстура зарегистрирована в таблице — освобождаем её один раз.
        // Слот помечается мёртвым и переиспользуется следующим
        // loadTexture/viewport.create: иначе цикл create/destroy копил бы слоты
        // до переполнения таблицы.
        for (int i = 0; i < r->texture_count; ++i) {
            if (r->textures[i].alive && r->textures[i].handle == vp->history) {
                r->textures[i].alive = false;
                r->textures[i].handle = NULL;
                r->textures[i].name[0] = '\0';
                break;
            }
        }
        SDL_ReleaseGPUTexture(r->device, vp->history);
    }
    if (vp->sprite >= 0 && vp->sprite < r->sprite_count) {
        r->sprites[vp->sprite].alive = false;
    }
    SDL_zero(*vp);
    vp->sprite = -1;
    vp->used = false;
    return true;
}

bool r2d_render_viewport_bind(R2DRenderer *r, int id)
{
    if (!r) return false;
    if (id < 0) { r->bound_viewport = -1; return true; }
    if (id >= R2D_MAX_VIEWPORTS || !r->viewports[id].used) return false;
    r->bound_viewport = id;
    return true;
}

int r2d_render_viewport_sprite(const R2DRenderer *r, int id)
{
    if (!r || id < 0 || id >= R2D_MAX_VIEWPORTS || !r->viewports[id].used) return -1;
    return r->viewports[id].sprite;
}

int r2d_render_viewport_size(const R2DRenderer *r, int id, int *w, int *h)
{
    if (!r || id < 0 || id >= R2D_MAX_VIEWPORTS || !r->viewports[id].used) return -1;
    if (w) *w = r->viewports[id].w;
    if (h) *h = r->viewports[id].h;
    return 0;
}

/** Полноэкранный блит текстуры в цель: пост-конвейер с нулевыми эффектами. */
static void r2d__blit_texture(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                              SDL_GPUTexture *src, SDL_GPUTexture *dst, int w, int h)
{
    if (!src || !dst) return;
    SDL_GPUColorTargetInfo target;
    SDL_zero(target);
    target.texture = dst;
    target.clear_color = (SDL_FColor){ 0, 0, 0, 1 };
    target.load_op  = SDL_GPU_LOADOP_DONT_CARE;
    target.store_op = SDL_GPU_STOREOP_STORE;

    SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
    if (!pass) return;
    SDL_BindGPUGraphicsPipeline(pass, r->post_pipeline);

    SDL_GPUTextureSamplerBinding binding;
    SDL_zero(binding);
    binding.texture = src;
    binding.sampler = r->linear_sampler ? r->linear_sampler : r->sampler;
    SDL_BindGPUFragmentSamplers(pass, 0, &binding, 1);

    // Все эффекты выключены — проход работает как копия кадра.
    R2DPostParams params;
    SDL_zero(params);
    params.center_x = 0.5f;
    params.center_y = 0.5f;
    params.radius = 0.35f;
    params.tint_r = params.tint_g = params.tint_b = 1.0f;
    params.saturation = 1.0f;
    params.contrast = 1.0f;
    SDL_PushGPUFragmentUniformData(cmd, 0, &params, (Uint32)sizeof params);
    SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
    SDL_EndGPURenderPass(pass);
    r->stat_draws++;
    r->stat_passes++;
}

bool r2d_render_viewport_present(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                 SDL_GPUTexture *swapchain, int w, int h)
{
    if (!r || !cmd || !swapchain) return false;
    SDL_GPUTexture *target = r2d_render_viewport_target(r);
    if (!target) return false;
    R2DViewport *vp = &r->viewports[r->bound_viewport];
    // Показываем кадр на экране и сохраняем его в историю для следующего кадра.
    r2d__blit_texture(r, cmd, target, swapchain, w, h);
    if (vp->history) r2d__blit_texture(r, cmd, target, vp->history, vp->w, vp->h);
    return true;
}

bool r2d_render_bloom(R2DRenderer *r, SDL_GPUCommandBuffer *cmd)
{
    if (!r || !cmd || !r->scene_target) return false;
    if (!r2d_render_bloom_ready(r, r->scene_w, r->scene_h)) return false;

    const float threshold = r->post.bloom_threshold > 0.0f ? r->post.bloom_threshold : 0.75f;
    const float radius    = r->post.bloom_radius > 0.0f ? r->post.bloom_radius : 1.0f;

    // --- 1. Яркий проход: сцена → bloom_a (половинное разрешение).
    const struct { float threshold, knee, texel_x, texel_y; } pre = {
        threshold, 0.35f,
        r->scene_w > 0 ? 1.0f / (float)r->scene_w : 0.0f,
        r->scene_h > 0 ? 1.0f / (float)r->scene_h : 0.0f,
    };
    {
        SDL_GPUColorTargetInfo target;
        SDL_zero(target);
        target.texture = r->bloom_a;
        target.clear_color = (SDL_FColor){ 0, 0, 0, 1 };
        target.load_op  = SDL_GPU_LOADOP_CLEAR;
        target.store_op = SDL_GPU_STOREOP_STORE;

        SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
        if (!pass) return false;
        SDL_BindGPUGraphicsPipeline(pass, r->bloom_pre_pipeline);
        SDL_GPUTextureSamplerBinding b;
        SDL_zero(b);
        b.texture = r->scene_target;
        b.sampler = r->linear_sampler ? r->linear_sampler : r->sampler;
        SDL_BindGPUFragmentSamplers(pass, 0, &b, 1);
        SDL_PushGPUFragmentUniformData(cmd, 0, &pre, (Uint32)sizeof pre);
        SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
        SDL_EndGPURenderPass(pass);
        r->stat_draws++;
        r->stat_passes++;
    }

    // --- 2 и 3. Размытие: горизонталь (a → b), затем вертикаль (b → a).
    const struct { float dir_x, dir_y, strength, _pad; } dirs[2] = {
        { 1.0f / (float)r->bloom_w, 0.0f, radius, 0.0f },
        { 0.0f, 1.0f / (float)r->bloom_h, radius, 0.0f },
    };
    SDL_GPUTexture *src[2] = { r->bloom_a, r->bloom_b };
    SDL_GPUTexture *dst[2] = { r->bloom_b, r->bloom_a };

    for (int i = 0; i < 2; ++i) {
        SDL_GPUColorTargetInfo target;
        SDL_zero(target);
        target.texture = dst[i];
        target.clear_color = (SDL_FColor){ 0, 0, 0, 1 };
        target.load_op  = SDL_GPU_LOADOP_DONT_CARE;
        target.store_op = SDL_GPU_STOREOP_STORE;

        SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
        if (!pass) return false;
        SDL_BindGPUGraphicsPipeline(pass, r->bloom_blur_pipeline);
        SDL_GPUTextureSamplerBinding b;
        SDL_zero(b);
        b.texture = src[i];
        b.sampler = r->linear_sampler ? r->linear_sampler : r->sampler;
        SDL_BindGPUFragmentSamplers(pass, 0, &b, 1);
        SDL_PushGPUFragmentUniformData(cmd, 0, &dirs[i], (Uint32)sizeof dirs[i]);
        SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
        SDL_EndGPURenderPass(pass);
        r->stat_draws++;
        r->stat_passes++;
    }

    r->bloom_result = r->bloom_a;   // результат вертикального прохода
    return true;
}

// ---------------------------------------------------------------------------
// Lightmap: свет в отдельную текстуру
//
// Свет — аддитивные треугольники. Если рисовать их прямо в сцену, порядок
// света зависит от порядка сцены (отсюда и .punch() как костыль). Здесь свет
// копится в текстуре половинного разрешения, при желании размывается и
// накладывается на сцену одним полноэкранным проходом: порядок перестаёт
// иметь значение, а половинное разрешение с линейной фильтрацией само даёт
// мягкую кромку тени.
//
// Проход света идёт ДО прохода сцены (он от неё не зависит), композит — в
// конце прохода сцены: после мира и тумана, но до интерфейса.
// ---------------------------------------------------------------------------

bool r2d_render_lightmap_enabled(const R2DRenderer *r)
{
    return r && r->lightmap_on;
}

bool r2d_render_light_mask_used(const R2DRenderer *r)
{
    return r && r->light_mask_used;
}

int r2d_render_light_mask_nodes(const R2DRenderer *r)
{
    return r ? r->stat_mask_nodes : 0;
}

void r2d_render_lightmap_set(R2DRenderer *r, bool on, float intensity, float soft)
{
    if (!r) return;
    r->lightmap_on = on;
    if (intensity > 0.0f) r->lightmap_intensity = intensity;
    r->lightmap_soft = soft >= 0.0f ? soft : 0.0f;
}

static bool r2d__lightmap_ready(R2DRenderer *r, int w, int h)
{
    if (!r || !r->device || w <= 0 || h <= 0) return false;

    if (!r->light_blur_pipeline) {
        // Размытие световой карты — тот же шейдер, что у свечения: он умеет
        // любую силу размаха через юниформу.
        r->light_blur_pipeline =
            r2d__create_fullscreen_pipeline(r, &r2d_shader_bloom_blur_frag);
    }
    if (!r->light_composite_pipeline) {
        r->light_composite_pipeline = r2d__create_fullscreen_pipeline_blend(
            r, &r2d_shader_light_map_frag, R2D_BLEND_ADD);
    }
    if (!r->light_blur_pipeline || !r->light_composite_pipeline) return false;

    // Половинное разрешение, но не меньше 8 пикселей: на крошечной цели свет
    // превратился бы в один тексель.
    const int lw = w / 2 > 8 ? w / 2 : 8;
    const int lh = h / 2 > 8 ? h / 2 : 8;
    if (r->light_target && r->light_blur && r->light_w == lw && r->light_h == lh) return true;

    if (r->light_target) { SDL_ReleaseGPUTexture(r->device, r->light_target); r->light_target = NULL; }
    if (r->light_blur)   { SDL_ReleaseGPUTexture(r->device, r->light_blur);   r->light_blur = NULL; }
    // §20.1: цель маски обязана быть того же размера, что карта света.
    if (r->light_mask_target) {
        SDL_ReleaseGPUTexture(r->device, r->light_mask_target);
        r->light_mask_target = NULL;
    }

    r->light_target = r2d__create_bloom_texture(r, lw, lh);
    r->light_blur   = r2d__create_bloom_texture(r, lw, lh);
    if (!r->light_target || !r->light_blur) {
        R2D_ERROR("SDL_CreateGPUTexture (lightmap): %s", SDL_GetError());
        if (r->light_target) { SDL_ReleaseGPUTexture(r->device, r->light_target); r->light_target = NULL; }
        if (r->light_blur)   { SDL_ReleaseGPUTexture(r->device, r->light_blur);   r->light_blur = NULL; }
        return false;
    }
    r->light_w = lw;
    r->light_h = lh;
    return true;
}

/**
 * §20.1. Цель и конвейер маски получателя света.
 *
 * Маска живёт в половинном разрешении — ровно как карта света: гейт читается
 * при накоплении света, то есть на той же сетке. Формат цели — формат кадра
 * (как у сцены и световой карты), иначе спрайтовый конвейер к ней не подойдёт.
 */
static bool r2d__light_mask_ready(R2DRenderer *r)
{
    if (!r || !r->device || !r->light_target) return false;

    if (!r->light_mask_pipeline) {
        SDL_GPUShader *vs = r2d__make_shader(r->device, &r2d_shader_sprite_vert,
                                             SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
        SDL_GPUShader *fs = r2d__make_shader(r->device, &r2d_shader_sprite_frag,
                                             SDL_GPU_SHADERSTAGE_FRAGMENT, 1, 2);
        if (!vs || !fs) {
            if (vs) SDL_ReleaseGPUShader(r->device, vs);
            if (fs) SDL_ReleaseGPUShader(r->device, fs);
            R2D_ERROR("конвейер маски света: SDL_CreateGPUShader: %s", SDL_GetError());
            return false;
        }

        SDL_GPUVertexBufferDescription vb;
        SDL_zero(vb);
        vb.slot = 0;
        vb.pitch = sizeof(R2DVertex);
        vb.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

        SDL_GPUVertexAttribute attribs[4];
        SDL_zero(attribs);
        attribs[0].location = 0; attribs[0].buffer_slot = 0; attribs[0].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attribs[0].offset = offsetof(R2DVertex, x);
        attribs[1].location = 1; attribs[1].buffer_slot = 0; attribs[1].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attribs[1].offset = offsetof(R2DVertex, u);
        attribs[2].location = 2; attribs[2].buffer_slot = 0; attribs[2].format = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM; attribs[2].offset = offsetof(R2DVertex, r);
        attribs[3].location = 3; attribs[3].buffer_slot = 0; attribs[3].format = SDL_GPU_VERTEXELEMENTFORMAT_UINT; attribs[3].offset = offsetof(R2DVertex, mask);

        SDL_GPUColorTargetDescription target;
        SDL_zero(target);
        target.format = SDL_GetGPUSwapchainTextureFormat(r->device, r->window);
        // Смешивание выключено: маска ЗАМЕНЯЕТ значение в пикселе, а не
        // складывается с ним (иначе биты «протекали» бы из соседей).
        target.blend_state.enable_blend = false;

        SDL_GPUGraphicsPipelineCreateInfo pipe;
        SDL_zero(pipe);
        pipe.vertex_shader   = vs;
        pipe.fragment_shader = fs;
        pipe.primitive_type  = SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;
        pipe.vertex_input_state.num_vertex_buffers         = 1;
        pipe.vertex_input_state.vertex_buffer_descriptions = &vb;
        pipe.vertex_input_state.num_vertex_attributes      = 4;
        pipe.vertex_input_state.vertex_attributes          = attribs;
        pipe.target_info.num_color_targets         = 1;
        pipe.target_info.color_target_descriptions = &target;
        // Z-буфера в проходе маски нет: он про неё ничего не знает.
        pipe.target_info.has_depth_stencil_target  = false;
        pipe.depth_stencil_state.enable_depth_test  = false;
        pipe.depth_stencil_state.enable_depth_write = false;
        pipe.rasterizer_state.fill_mode  = SDL_GPU_FILLMODE_FILL;
        pipe.rasterizer_state.cull_mode  = SDL_GPU_CULLMODE_NONE;
        pipe.rasterizer_state.front_face = SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE;
        pipe.multisample_state.sample_count = SDL_GPU_SAMPLECOUNT_1;

        r->light_mask_pipeline = SDL_CreateGPUGraphicsPipeline(r->device, &pipe);
        SDL_ReleaseGPUShader(r->device, vs);
        SDL_ReleaseGPUShader(r->device, fs);
        if (!r->light_mask_pipeline) {
            R2D_ERROR("конвейер маски света: SDL_CreateGPUGraphicsPipeline: %s", SDL_GetError());
            return false;
        }
    }

    if (r->light_mask_target && r->light_mask_w == r->light_w && r->light_mask_h == r->light_h) {
        return true;
    }
    if (r->light_mask_target) {
        SDL_ReleaseGPUTexture(r->device, r->light_mask_target);
        r->light_mask_target = NULL;
    }
    r->light_mask_target = r2d__create_bloom_texture(r, r->light_w, r->light_h);
    if (!r->light_mask_target) {
        R2D_ERROR("SDL_CreateGPUTexture (маска света): %s", SDL_GetError());
        return false;
    }
    r->light_mask_w = r->light_w;
    r->light_mask_h = r->light_h;
    return true;
}

/**
 * §20.1. Проход маски: те же квады мира, но в цель уходят биты получателя.
 * Цель очищается в «принимает все слои» (0xFFFFFFFF) — фон и всё, что маску не
 * объявляло, ведут себя как раньше.
 */
static bool r2d__draw_light_mask(R2DRenderer *r, SDL_GPUCommandBuffer *cmd)
{
    if (!r->light_mask_used) return false;
    // Конвейер и цель создаются здесь же: до первого кадра с маской их нет.
    if (!r2d__light_mask_ready(r)) return false;

    SDL_GPUColorTargetInfo target;
    SDL_zero(target);
    target.texture = r->light_mask_target;
    target.clear_color = (SDL_FColor){ 1.0f, 1.0f, 1.0f, 1.0f };
    target.load_op  = SDL_GPU_LOADOP_CLEAR;
    target.store_op = SDL_GPU_STOREOP_STORE;

    SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
    if (!pass) return false;

    SDL_GPUBufferBinding vb;
    SDL_zero(vb);
    vb.buffer = r->vertex_buffer;
    SDL_BindGPUVertexBuffers(pass, 0, &vb, 1);
    SDL_GPUBufferBinding ib;
    SDL_zero(ib);
    ib.buffer = r->index_buffer;
    SDL_BindGPUIndexBuffer(pass, &ib, SDL_GPU_INDEXELEMENTSIZE_32BIT);

    // Границы те же, что у мирового прохода: интерфейс в маске не участвует
    // (он и не освещается), а неосвещённый слой — участвует: если он перекрыт
    // спрайтом с маской, биты должны быть его.
    const int world_end = r->ui_cmd_start >= 0 ? r->ui_cmd_start : r->cmd_count;
    int bound = -1;
    r2d__draw_sprite_range(r, cmd, pass, 0, world_end, &bound, 1);

    SDL_EndGPURenderPass(pass);
    r->stat_passes++;
    r->stat_mask_passes++;
    return true;
}

bool r2d_render_draw_lights(R2DRenderer *r, SDL_GPUCommandBuffer *cmd)
{
    if (!r || !cmd || !r->lightmap_on) return false;
    if (r->light_batch_count <= 0) return false;
    // В render target игры формат цели может не совпасть с форматом
    // полноэкранных конвейеров — тогда свет дорисует проход сцены (см.
    // r2d_render_draw_world): терять свет нельзя ни при каких условиях.
    if (r->bound_viewport >= 0) return false;
    if (!r2d__lightmap_ready(r, r->screen_w, r->screen_h)) return false;

    // 0. Маска получателя света: пишется ДО накопления света, потому что гейт
    // читается в самом накоплении. Без масок в кадре прохода нет вовсе.
    r2d__draw_light_mask(r, cmd);


    // 1. Накопление: чёрный фон, дальше свет складывается аддитивно.
    {
        SDL_GPUColorTargetInfo target;
        SDL_zero(target);
        target.texture = r->light_target;
        target.clear_color = (SDL_FColor){ 0, 0, 0, 1 };
        target.load_op  = SDL_GPU_LOADOP_CLEAR;
        target.store_op = SDL_GPU_STOREOP_STORE;

        SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
        if (!pass) return false;

        int bound_blend = -1;
        r2d__draw_tri_batches(r, cmd, pass, r->light_batches, r->light_batch_count,
                              r->light_index_start, &bound_blend, true);
        SDL_EndGPURenderPass(pass);
        r->stat_passes++;
    }

    // 2. Размытие: горизонталь (target → blur), затем вертикаль (blur → target).
    //    Половинное разрешение уже даёт мягкость; размытие добавляет полутень
    //    на кромке тени, там где источнику положено быть не точкой.
    if (r->lightmap_soft > 0.01f) {
        const struct { float dir_x, dir_y, strength, _pad; } dirs[2] = {
            { 1.0f / (float)r->light_w, 0.0f, r->lightmap_soft, 0.0f },
            { 0.0f, 1.0f / (float)r->light_h, r->lightmap_soft, 0.0f },
        };
        SDL_GPUTexture *src[2] = { r->light_target, r->light_blur };
        SDL_GPUTexture *dst[2] = { r->light_blur, r->light_target };

        for (int i = 0; i < 2; ++i) {
            SDL_GPUColorTargetInfo target;
            SDL_zero(target);
            target.texture = dst[i];
            target.clear_color = (SDL_FColor){ 0, 0, 0, 1 };
            target.load_op  = SDL_GPU_LOADOP_DONT_CARE;
            target.store_op = SDL_GPU_STOREOP_STORE;

            SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
            if (!pass) break;

            SDL_BindGPUGraphicsPipeline(pass, r->light_blur_pipeline);
            SDL_GPUTextureSamplerBinding b;
            SDL_zero(b);
            b.texture = src[i];
            b.sampler = r->linear_sampler ? r->linear_sampler : r->sampler;
            SDL_BindGPUFragmentSamplers(pass, 0, &b, 1);
            SDL_PushGPUFragmentUniformData(cmd, 0, &dirs[i], (Uint32)sizeof dirs[i]);
            SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
            SDL_EndGPURenderPass(pass);
            r->stat_draws++;
            r->stat_passes++;
            // §25: буфер размытия света реально участвовал в кадре.
            r->light_blur_used = true;
        }
    }

    r->lightmap_used = true;
    return true;
}

/**
 * Накладывает накопленный свет на сцену. Идемпотентно: вызывается из
 * мирового прохода ПЕРЕД неосвещённым слоем (иначе `.lit(false)` не работал бы
 * при включённой световой карте — свет ложился бы поверх него), а вызов из
 * main.c после мирового прохода становится пустым.
 */
void r2d_render_light_composite(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                SDL_GPURenderPass *pass)
{
    if (!r || !cmd || !pass) return;
    if (!r->lightmap_on || !r->lightmap_used || !r->light_target) return;
    if (!r->light_composite_pipeline) return;
    if (r->light_composited) return;

    SDL_BindGPUGraphicsPipeline(pass, r->light_composite_pipeline);

    SDL_GPUTextureSamplerBinding b;
    SDL_zero(b);
    b.texture = r->light_target;
    b.sampler = r->linear_sampler ? r->linear_sampler : r->sampler;
    SDL_BindGPUFragmentSamplers(pass, 0, &b, 1);

    const struct { float power, _a, _b, _c; } params = {
        r->lightmap_intensity, 0.0f, 0.0f, 0.0f
    };
    SDL_PushGPUFragmentUniformData(cmd, 0, &params, (Uint32)sizeof params);
    SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);
    r->stat_draws++;
    r->light_composited = true;
}

bool r2d_render_init(R2DRenderer *r, SDL_GPUDevice *device, SDL_Window *window)
{
    SDL_zero(*r);
    r->device = device;
    r->window = window;
    r->white_texture = -1;
    r->white_sprite  = -1;
    r->clear_r = 0.09f;
    r->clear_g = 0.10f;
    r->clear_b = 0.13f;
    r->clear_a = 1.0f;
    // Z-буфер включён по умолчанию: спрайты пишут z = 0, поэтому порядок
    // отрисовки между ними сохраняется, а меш может закрывать собой спрайты.
    // Игра может выключить тест (r2d_render_set_depth) для интерфейса.
    r->depth_enabled = true;
    // Свет в lightmap по умолчанию не ослабляется: карта включается явно, и
    // при включении свет должен выглядеть как раньше.
    r->lightmap_intensity = 1.0f;

    SDL_GPUShader *vs = r2d__make_shader(device, &r2d_shader_sprite_vert,
                                          SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
    // §20.1: у спрайтовой фрагментной стадии теперь две выборки (текстура и
    // маска получателя света) и юниформ-буфер с режимом стадии.
    SDL_GPUShader *fs = r2d__make_shader(device, &r2d_shader_sprite_frag,
                                          SDL_GPU_SHADERSTAGE_FRAGMENT, 1, 2);
    if (!vs || !fs) {
        if (vs) SDL_ReleaseGPUShader(device, vs);
        if (fs) SDL_ReleaseGPUShader(device, fs);
        return false;
    }

    // §20.1: четыре атрибута — позиция, UV, цвет и биты получателя света.
    SDL_GPUVertexAttribute attribs[4];
    SDL_zero(attribs);
    attribs[0].location    = 0;
    attribs[0].buffer_slot = 0;
    attribs[0].format      = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2;
    attribs[0].offset      = offsetof(R2DVertex, x);

    attribs[1].location    = 1;
    attribs[1].buffer_slot = 0;
    attribs[1].format      = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2;
    attribs[1].offset      = offsetof(R2DVertex, u);

    attribs[2].location    = 2;
    attribs[2].buffer_slot = 0;
    attribs[2].format      = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM;
    attribs[2].offset      = offsetof(R2DVertex, r);
    // §20.1: биты получателя света. UINT, а не NORM: это битовая маска, а не
    // цвет — нормализация превратила бы её в дробь и потеряла бы биты.
    attribs[3].location    = 3;
    attribs[3].buffer_slot = 0;
    attribs[3].format      = SDL_GPU_VERTEXELEMENTFORMAT_UINT;
    attribs[3].offset      = offsetof(R2DVertex, mask);

    SDL_GPUVertexBufferDescription vbuf;
    SDL_zero(vbuf);
    vbuf.slot       = 0;
    vbuf.pitch      = (Uint32)sizeof(R2DVertex);
    vbuf.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

    // Конвейер на каждый режим смешивания: рисовать разными режимами в одном
    // render pass можно, переключая пайплайн перед сменой режима у батча.
    for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
        r->pipelines[m] = r2d__create_pipeline(device, window, vs, fs, &vbuf, attribs, 4,
                                                (R2DBlendMode)m);
        if (!r->pipelines[m]) {
            R2D_ERROR("SDL_CreateGPUGraphicsPipeline (blend=%d): %s", m, SDL_GetError());
            SDL_ReleaseGPUShader(device, vs);
            SDL_ReleaseGPUShader(device, fs);
            // Освобождаем уже созданные конвейеры: main.c не вызывает
            // r2d_render_shutdown при неудачной инициализации.
            r2d_render_shutdown(r);
            return false;
        }
    }
    // Конвейеры меша: свой формат вершины (глубина третьим компонентом) и
    // свой вершинный шейдер; фрагментный общий со спрайтами.
    {
        SDL_GPUVertexAttribute mattrs[3];
        SDL_zero(mattrs);
        mattrs[0].location = 0; mattrs[0].buffer_slot = 0; mattrs[0].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT3; mattrs[0].offset = 0;
        mattrs[1].location = 1; mattrs[1].buffer_slot = 0; mattrs[1].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; mattrs[1].offset = offsetof(R2DMeshVertex, u);
        mattrs[2].location = 2; mattrs[2].buffer_slot = 0; mattrs[2].format = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM; mattrs[2].offset = offsetof(R2DMeshVertex, r);

        SDL_GPUVertexBufferDescription mvb;
        SDL_zero(mvb);
        mvb.slot       = 0;
        mvb.pitch      = (Uint32)sizeof(R2DMeshVertex);
        mvb.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

        SDL_GPUShader *mvs = r2d__make_shader(device, &r2d_shader_mesh_vert,
                                              SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
        if (mvs) {
            for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
                r->mesh_pipelines[m] = r2d__create_pipeline(device, window, mvs, fs,
                                                            &mvb, mattrs, 3, (R2DBlendMode)m);
                if (!r->mesh_pipelines[m]) {
                    R2D_ERROR("конвейер меша (blend=%d): %s", m, SDL_GetError());
                }
            }
            SDL_ReleaseGPUShader(device, mvs);
        } else {
            R2D_WARN("нет вершинного шейдера меша: %s", SDL_GetError());
        }
    }

    SDL_ReleaseGPUShader(device, vs);
    SDL_ReleaseGPUShader(device, fs);

    SDL_GPUSamplerCreateInfo si;
    SDL_zero(si);
    si.min_filter     = SDL_GPU_FILTER_NEAREST;
    si.mag_filter     = SDL_GPU_FILTER_NEAREST;
    si.mipmap_mode    = SDL_GPU_SAMPLERMIPMAPMODE_NEAREST;
    si.address_mode_u = SDL_GPU_SAMPLERADDRESSMODE_CLAMP_TO_EDGE;
    si.address_mode_v = SDL_GPU_SAMPLERADDRESSMODE_CLAMP_TO_EDGE;
    si.address_mode_w = SDL_GPU_SAMPLERADDRESSMODE_CLAMP_TO_EDGE;
    r->sampler = SDL_CreateGPUSampler(device, &si);
    if (!r->sampler) {
        R2D_ERROR("SDL_CreateGPUSampler: %s", SDL_GetError());
        r2d_render_shutdown(r);
        return false;
    }

    // Линейный сэмплер для свечения: размытие берёт соседние тексели, и без
    // линейной фильтрации «dual filter» превращался бы в выборку одного пикселя.
    si.min_filter = SDL_GPU_FILTER_LINEAR;
    si.mag_filter = SDL_GPU_FILTER_LINEAR;
    r->linear_sampler = SDL_CreateGPUSampler(device, &si);
    if (!r->linear_sampler) {
        R2D_ERROR("SDL_CreateGPUSampler (линейный): %s", SDL_GetError());
        r2d_render_shutdown(r);
        return false;
    }

    // Белая текстура 1x1 — основа для engine.drawRect().
    {
        SDL_GPUTexture *white = r2d__create_texture(r, 1, 1);
        const Uint32 pixel = 0xFFFFFFFFu;
        if (!white || !r2d__upload_pixels(r, white, &pixel, 1, 1, 4, false)) {
            R2D_ERROR("не удалось создать белую текстуру");
            if (white) SDL_ReleaseGPUTexture(device, white);
            r2d_render_shutdown(r);
            return false;
        }
        const int id = r->texture_count++;
        r->textures[id].handle = white;
        r->textures[id].width  = 1;
        r->textures[id].height = 1;
        r->textures[id].alive  = true;
        SDL_snprintf(r->textures[id].name, sizeof r->textures[id].name, "<white>");
        r->white_texture = id;
        r->white_sprite  = r2d_sprite_create(r, id, 0, 0, 1, 1);
    }

    // Чёрная текстура 1x1 — заглушка для сэмплера свечения: когда bloom не
    // считался, шейдер поста обязан получить валидную привязку.
    {
        SDL_GPUTexture *black = r2d__create_texture(r, 1, 1);
        const Uint32 pixel = 0x000000FFu;   // RGBA little-endian: чёрный, alpha 1
        if (black && r2d__upload_pixels(r, black, &pixel, 1, 1, 4, false)) {
            r->black_texture = black;
        } else {
            R2D_WARN("не удалось создать чёрную текстуру для свечения");
            if (black) SDL_ReleaseGPUTexture(device, black);
        }
    }

    // Процедурный шум для экранного искажения (§46). Генерируется здесь, а не
    // берётся из ассета: эффект обязан работать без файлов у игры, а сам шум —
    // это лишь поле дрожания, его художественная ценность нулевая.
    {
        // Размер — константа времени компиляции: в C `const int N = 64` не
        // константное выражение, поэтому `Uint32 pixels[N * N]` было бы VLA,
        // а runtime-sized массивы MSVC не принимает вовсе (C2057/C2133).
        enum { N = 64 };
        Uint32 pixels[N * N];
        Uint32 seed = 0x9e3779b9u;
        for (int i = 0; i < N * N; i++) {
            // xorshift32: одинаковый на всех платформах, без libc rand.
            seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
            const Uint32 v = seed;
            const Uint8 r8 = (Uint8)(v & 0xff);
            const Uint8 g8 = (Uint8)((v >> 8) & 0xff);
            const Uint8 b8 = (Uint8)((v >> 16) & 0xff);
            pixels[i] = (Uint32)r8 | ((Uint32)g8 << 8) | ((Uint32)b8 << 16) | 0xff000000u;
        }
        SDL_GPUTexture *noise = r2d__create_texture(r, N, N);
        if (noise && r2d__upload_pixels(r, noise, pixels, N, N, 4, false)) {
            r->noise_texture = noise;
        } else {
            R2D_WARN("не удалось создать текстуру шума для искажения экрана");
            if (noise) SDL_ReleaseGPUTexture(device, noise);
        }
    }

    // Пост-обработка. Если шейдер не собрался или бэкенд его не принял,
    // движок просто рисует кадр напрямую в swapchain — это не фатально.
    r->post_pipeline = r2d__create_post_pipeline(r);
    if (!r->post_pipeline) {
        R2D_WARN("пост-обработка недоступна: %s", SDL_GetError());
    }
    SDL_zero(r->post);
    r->post.center_x = 0.5f;
    r->post.center_y = 0.5f;
    r->post.radius   = 0.35f;
    r->post.tint_r = r->post.tint_g = r->post.tint_b = 1.0f;
    r->post.saturation = 1.0f;
    r->post.contrast   = 1.0f;
    r->post.bloom_threshold = 0.75f;
    r->post.bloom_radius    = 1.0f;

    // Конвейеры шейдеров узла: тот же вершинный шейдер, но фрагментный с
    // юниформами. По одному на режим смешивания.
    for (int mode = 0; mode < R2D_BLEND_COUNT; ++mode) {
        SDL_GPUShader *fx_vs = r2d__make_shader(device, &r2d_shader_sprite_vert,
                                                 SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
        SDL_GPUShader *fx_fs = r2d__make_shader(device, &r2d_shader_sprite_fx_frag,
                                                 SDL_GPU_SHADERSTAGE_FRAGMENT, 1, 1);
        if (fx_vs && fx_fs) {
            SDL_GPUVertexBufferDescription vb;
            SDL_zero(vb);
            vb.slot = 0;
            vb.pitch = sizeof(R2DVertex);
            vb.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

            SDL_GPUVertexAttribute attrs[4];
            SDL_zero(attrs);
            attrs[0].location = 0; attrs[0].buffer_slot = 0; attrs[0].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[0].offset = 0;
            attrs[1].location = 1; attrs[1].buffer_slot = 0; attrs[1].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[1].offset = sizeof(float) * 2;
            attrs[2].location = 2; attrs[2].buffer_slot = 0; attrs[2].format = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM; attrs[2].offset = sizeof(float) * 4;
            // §20.1: вершинный шейдер спрайтов читает и биты получателя света.
            attrs[3].location = 3; attrs[3].buffer_slot = 0; attrs[3].format = SDL_GPU_VERTEXELEMENTFORMAT_UINT; attrs[3].offset = sizeof(float) * 4 + 4;

            r->fx_pipelines[mode] = r2d__create_pipeline(device, window, fx_vs, fx_fs, &vb, attrs, 4,
                                                          (R2DBlendMode)mode);
            if (!r->fx_pipelines[mode]) {
                R2D_WARN("шейдер узла недоступен для режима %d: %s", mode, SDL_GetError());
            }
        }
        if (fx_vs) SDL_ReleaseGPUShader(device, fx_vs);
        if (fx_fs) SDL_ReleaseGPUShader(device, fx_fs);
    }

    // Конвейеры свечения создаём сразу: буферы появятся под размер окна, а
    // компиляция пайплайна в первом кадре со свечением дала бы заметный рывок.
    r->bloom_pre_pipeline  = r2d__create_fullscreen_pipeline(r, &r2d_shader_bloom_pre_frag);
    r->bloom_blur_pipeline = r2d__create_fullscreen_pipeline(r, &r2d_shader_bloom_blur_frag);
    if (!r->bloom_pre_pipeline || !r->bloom_blur_pipeline) {
        R2D_WARN("свечение недоступно, пост возьмёт запасную ветку: %s", SDL_GetError());
    }

    return true;
}

void r2d_render_shutdown(R2DRenderer *r)
{
#ifndef __EMSCRIPTEN__
    // Конвейер SMAA живёт в файловой статике (в R2DRenderer поля нет).
    if (g_smaa_pipeline && g_smaa_device) {
        SDL_ReleaseGPUGraphicsPipeline(g_smaa_device, g_smaa_pipeline);
    }
    g_smaa_pipeline = NULL;
    g_smaa_device = NULL;
#endif
    // Рабочая память последовательного синтеза Re2DSprite. В сборке без RE2D
    // её никто не выделяет (src/rotsprite.c не компилируется), поэтому и
    // освобождать нечего — поле остаётся, чтобы структура рендерера была одна
    // на обе сборки.
#ifdef R2D_ENABLE_RE2D
    if(r->rot_workspace){r2d_rotsprite_anime_workspace_free(r->rot_workspace);free(r->rot_workspace);r->rot_workspace=NULL;}
#endif
    // Z-буфер живёт вне кадра: освобождаем явно.
    if (r->depth_texture) {
        SDL_ReleaseGPUTexture(r->device, r->depth_texture);
        r->depth_texture = NULL;
        r->depth_w = r->depth_h = 0;
    }
    if (!r->device) return;

    if (r->vertex_buffer) SDL_ReleaseGPUBuffer(r->device, r->vertex_buffer);
    if (r->index_buffer)  SDL_ReleaseGPUBuffer(r->device, r->index_buffer);
    if (r->upload_buffer) SDL_ReleaseGPUTransferBuffer(r->device, r->upload_buffer);
    for (int i = 0; i < r->texture_count; ++i) {
        if (r->textures[i].alive && r->textures[i].handle) {
            SDL_ReleaseGPUTexture(r->device, r->textures[i].handle);
        }
    }
    if (r->sampler)  SDL_ReleaseGPUSampler(r->device, r->sampler);
    if (r->linear_sampler) SDL_ReleaseGPUSampler(r->device, r->linear_sampler);
    if (r->black_texture)  SDL_ReleaseGPUTexture(r->device, r->black_texture);
    if (r->noise_texture)  SDL_ReleaseGPUTexture(r->device, r->noise_texture);
    for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
        if (r->pipelines[m]) SDL_ReleaseGPUGraphicsPipeline(r->device, r->pipelines[m]);
        if (r->fx_pipelines[m]) SDL_ReleaseGPUGraphicsPipeline(r->device, r->fx_pipelines[m]);
    }
    for (int i = 1; i < R2D_MAX_USER_SHADERS; ++i) {
        if (r->user_shaders[i].used) r2d__user_shader_destroy(r, &r->user_shaders[i]);
    }
    if (r->post_pipeline) SDL_ReleaseGPUGraphicsPipeline(r->device, r->post_pipeline);
    if (r->bloom_pre_pipeline)  SDL_ReleaseGPUGraphicsPipeline(r->device, r->bloom_pre_pipeline);
    if (r->bloom_blur_pipeline) SDL_ReleaseGPUGraphicsPipeline(r->device, r->bloom_blur_pipeline);
    if (r->bloom_a) SDL_ReleaseGPUTexture(r->device, r->bloom_a);
    if (r->bloom_b) SDL_ReleaseGPUTexture(r->device, r->bloom_b);
    if (r->scene_target)  SDL_ReleaseGPUTexture(r->device, r->scene_target);

    if (r->light_blur_pipeline)
        SDL_ReleaseGPUGraphicsPipeline(r->device, r->light_blur_pipeline);
    if (r->light_composite_pipeline)
        SDL_ReleaseGPUGraphicsPipeline(r->device, r->light_composite_pipeline);
    if (r->light_target) SDL_ReleaseGPUTexture(r->device, r->light_target);
    if (r->light_blur)   SDL_ReleaseGPUTexture(r->device, r->light_blur);

    SDL_free(r->sprites);
    SDL_free(r->cmds);
    SDL_free(r->tri_vertices);
    SDL_free(r->tri_batches);
    SDL_free(r->light_vertices);
    SDL_free(r->light_batches);
    if (r->light_mask_target && r->device) SDL_ReleaseGPUTexture(r->device, r->light_mask_target);
    if (r->light_mask_pipeline && r->device) SDL_ReleaseGPUGraphicsPipeline(r->device, r->light_mask_pipeline);
    SDL_free(r->vertices);
    SDL_free(r->indices);
    SDL_zero(*r);
}

// ---------------------------------------------------------------------------
// Регистрация engine.* для возможностей рендера
//
// Здесь живут биндинги, которых нет в script.c: 4-й аргумент blend у
// submitSprites/submitTriangles и пространство engine.viewport. script.c —
// общая точка сборки, её не трогаем, поэтому нужные функции переопределяются
// поверх уже зарегистрированных (r2d_render_register_js зовётся последним).
// ---------------------------------------------------------------------------

// Объявляет engine-функцию — то же, что делает статический r2d__set_fn в
// script.c, но доступно из этого файла.
static void r2d__js_set_fn(JSContext *ctx, JSValue obj, const char *name,
                           JSCFunction *fn, int len)
{
    JS_SetPropertyStr(ctx, obj, name, JS_NewCFunction(ctx, fn, name, len));
}

// Числовой аргумент с запасным значением (аналог r2d__arg_int из script.c).
static int r2d__js_arg_int(JSContext *ctx, int argc, JSValueConst *argv, int i, int def)
{
    if (i >= argc) return def;
    int32_t value = 0;
    if (JS_ToInt32(ctx, &value, argv[i])) return def;
    return (int)value;
}

// Число с плавающей точкой; отсутствующий аргумент оставляет прежнее значение.
static float r2d__js_arg_float(JSContext *ctx, int argc, JSValueConst *argv, int i, float def)
{
    if (i >= argc || JS_IsUndefined(argv[i]) || JS_IsNull(argv[i])) return def;
    double value = def;
    if (JS_ToFloat64(ctx, &value, argv[i])) return def;
    return (float)value;
}

// --- Пост-обработка: engine.setPost/getPost/postSupported -------------------
// Порядок аргументов: glow, vignette, chromatic, lens, cx, cy, radius, grain,
// scanline, enabled.
static JSValue r2d__js_set_post(JSContext *ctx, JSValueConst this_val,
                                int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    if (!r) return JS_FALSE;

    R2DPostParams p = r->post;
    p.glow      = r2d__js_arg_float(ctx, argc, argv, 0, p.glow);
    p.vignette  = r2d__js_arg_float(ctx, argc, argv, 1, p.vignette);
    p.chromatic = r2d__js_arg_float(ctx, argc, argv, 2, p.chromatic);
    p.lens      = r2d__js_arg_float(ctx, argc, argv, 3, p.lens);
    p.center_x  = r2d__js_arg_float(ctx, argc, argv, 4, p.center_x);
    p.center_y  = r2d__js_arg_float(ctx, argc, argv, 5, p.center_y);
    p.radius    = r2d__js_arg_float(ctx, argc, argv, 6, p.radius);
    p.grain     = r2d__js_arg_float(ctx, argc, argv, 7, p.grain);
    p.scanline  = r2d__js_arg_float(ctx, argc, argv, 8, p.scanline);
    p.enabled   = r2d__js_arg_float(ctx, argc, argv, 9, 1.0f);
    p.time      = r2d__js_arg_float(ctx, argc, argv, 10, p.time);
    p.posterize = r2d__js_arg_float(ctx, argc, argv, 11, p.posterize);
    p.tint_r    = r2d__js_arg_float(ctx, argc, argv, 12, p.tint_r);
    p.tint_g    = r2d__js_arg_float(ctx, argc, argv, 13, p.tint_g);
    p.tint_b    = r2d__js_arg_float(ctx, argc, argv, 14, p.tint_b);
    p.tint_amount = r2d__js_arg_float(ctx, argc, argv, 15, p.tint_amount);
    p.saturation = r2d__js_arg_float(ctx, argc, argv, 16, p.saturation);
    p.contrast   = r2d__js_arg_float(ctx, argc, argv, 17, p.contrast);
    p.brightness = r2d__js_arg_float(ctx, argc, argv, 18, p.brightness);
    p.blood      = r2d__js_arg_float(ctx, argc, argv, 19, p.blood);
    // Параметры свечения: порог яркости и сила размытия. bloom_ready заполняет
    // движок каждый кадр — из JS он не приходит.
    p.bloom_threshold = r2d__js_arg_float(ctx, argc, argv, 20, p.bloom_threshold);
    p.bloom_radius    = r2d__js_arg_float(ctx, argc, argv, 21, p.bloom_radius);
    // §46: экранное искажение. Идёт тем же вызовом, а не отдельным API: это
    // часть того же пост-прохода, и держать два состояния значило бы
    // рассинхронизировать «включено/выключено».
    p.distort         = r2d__js_arg_float(ctx, argc, argv, 22, p.distort);
    p.wave_amp        = r2d__js_arg_float(ctx, argc, argv, 23, p.wave_amp);
    p.wave_freq       = r2d__js_arg_float(ctx, argc, argv, 24, p.wave_freq);
    p.wave_speed      = r2d__js_arg_float(ctx, argc, argv, 25, p.wave_speed);
    p.wave_axis       = r2d__js_arg_float(ctx, argc, argv, 26, p.wave_axis);
    p.noise_amount    = r2d__js_arg_float(ctx, argc, argv, 27, p.noise_amount);
    p.noise_scale     = r2d__js_arg_float(ctx, argc, argv, 28, p.noise_scale);
    p.channel_shift   = r2d__js_arg_float(ctx, argc, argv, 29, p.channel_shift);
    // SMAA (§task-22): число шагов поиска паттерна (2/4/8 — пресеты качества).
    // Поле _pad0 было запасом на выравнивание push-констант и никем не
    // использовалось: раскладка vec4 не меняется, шейдер читает его как u.p5.w.
    p._pad0           = r2d__js_arg_float(ctx, argc, argv, 30, p._pad0);

    r2d_render_set_post(r, &p);
    return JS_TRUE;
}

static JSValue r2d__js_get_post(JSContext *ctx, JSValueConst this_val,
                                int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    const R2DPostParams *p = r2d_render_get_post(r);

    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "supported", JS_NewBool(ctx, r && r->post_pipeline != NULL));
    JS_SetPropertyStr(ctx, o, "glow",      JS_NewFloat64(ctx, p ? (double)p->glow : 0.0));
    JS_SetPropertyStr(ctx, o, "vignette",  JS_NewFloat64(ctx, p ? (double)p->vignette : 0.0));
    JS_SetPropertyStr(ctx, o, "chromatic", JS_NewFloat64(ctx, p ? (double)p->chromatic : 0.0));
    JS_SetPropertyStr(ctx, o, "lens",      JS_NewFloat64(ctx, p ? (double)p->lens : 0.0));
    JS_SetPropertyStr(ctx, o, "center_x",  JS_NewFloat64(ctx, p ? (double)p->center_x : 0.5));
    JS_SetPropertyStr(ctx, o, "center_y",  JS_NewFloat64(ctx, p ? (double)p->center_y : 0.5));
    JS_SetPropertyStr(ctx, o, "radius",    JS_NewFloat64(ctx, p ? (double)p->radius : 0.35));
    JS_SetPropertyStr(ctx, o, "grain",     JS_NewFloat64(ctx, p ? (double)p->grain : 0.0));
    JS_SetPropertyStr(ctx, o, "scanline",  JS_NewFloat64(ctx, p ? (double)p->scanline : 0.0));
    JS_SetPropertyStr(ctx, o, "enabled",   JS_NewFloat64(ctx, p ? (double)p->enabled : 0.0));
    JS_SetPropertyStr(ctx, o, "posterize", JS_NewFloat64(ctx, p ? (double)p->posterize : 0.0));
    JS_SetPropertyStr(ctx, o, "tint_r",    JS_NewFloat64(ctx, p ? (double)p->tint_r : 1.0));
    JS_SetPropertyStr(ctx, o, "tint_g",    JS_NewFloat64(ctx, p ? (double)p->tint_g : 1.0));
    JS_SetPropertyStr(ctx, o, "tint_b",    JS_NewFloat64(ctx, p ? (double)p->tint_b : 1.0));
    JS_SetPropertyStr(ctx, o, "tint_amount", JS_NewFloat64(ctx, p ? (double)p->tint_amount : 0.0));
    JS_SetPropertyStr(ctx, o, "saturation", JS_NewFloat64(ctx, p ? (double)p->saturation : 1.0));
    JS_SetPropertyStr(ctx, o, "contrast",  JS_NewFloat64(ctx, p ? (double)p->contrast : 1.0));
    JS_SetPropertyStr(ctx, o, "brightness", JS_NewFloat64(ctx, p ? (double)p->brightness : 0.0));
    JS_SetPropertyStr(ctx, o, "blood",     JS_NewFloat64(ctx, p ? (double)p->blood : 0.0));
    JS_SetPropertyStr(ctx, o, "bloom_threshold",
                      JS_NewFloat64(ctx, p ? (double)p->bloom_threshold : 0.75));
    JS_SetPropertyStr(ctx, o, "distort",       JS_NewFloat64(ctx, p ? (double)p->distort : 0.0));
    JS_SetPropertyStr(ctx, o, "wave_amp",      JS_NewFloat64(ctx, p ? (double)p->wave_amp : 0.0));
    JS_SetPropertyStr(ctx, o, "wave_freq",     JS_NewFloat64(ctx, p ? (double)p->wave_freq : 24.0));
    JS_SetPropertyStr(ctx, o, "wave_speed",    JS_NewFloat64(ctx, p ? (double)p->wave_speed : 6.0));
    JS_SetPropertyStr(ctx, o, "wave_axis",     JS_NewFloat64(ctx, p ? (double)p->wave_axis : 0.0));
    JS_SetPropertyStr(ctx, o, "noise_amount",  JS_NewFloat64(ctx, p ? (double)p->noise_amount : 0.0));
    JS_SetPropertyStr(ctx, o, "noise_scale",   JS_NewFloat64(ctx, p ? (double)p->noise_scale : 8.0));
    JS_SetPropertyStr(ctx, o, "channel_shift", JS_NewFloat64(ctx, p ? (double)p->channel_shift : 0.0));
    JS_SetPropertyStr(ctx, o, "bloom_radius",
                      JS_NewFloat64(ctx, p ? (double)p->bloom_radius : 1.0));
    // bloom_ready — факт этого кадра: считалось ли свечение отдельными
    // проходами (иначе пост берёт запасную ветку с восемью выборками).
    JS_SetPropertyStr(ctx, o, "bloom_ready",
                      JS_NewBool(ctx, r && p && p->bloom_ready > 0.5f));
    JS_SetPropertyStr(ctx, o, "bloom_buffers",
                      JS_NewBool(ctx, r && r->bloom_a != NULL && r->bloom_b != NULL));
    return o;
}

// ---------------------------------------------------------------------------
// §19/§37. engine.devtools.* — данные инспекторов физики и света
//
// Живут здесь, а не в script.c: узел рендера уже владеет своими биндингами
// (engine.renderInfo, engine.viewport.*), поэтому общая точка сборки не
// правится. Второго источника истины нет: формы читаются прямо из Box2D, а
// источники света приходят публикацией из JS-пути света (R2DLightReading).
// ---------------------------------------------------------------------------

/** Имя вида формы — то же, что у областей в JS (AREA_KINDS, core.js). */
static const char *r2d__shape_kind_name(int kind)
{
    switch (kind) {
    case R2D_SHAPE_CIRCLE:  return "circle";
    case R2D_SHAPE_CAPSULE: return "capsule";
    case R2D_SHAPE_POLYGON: return "polygon";
    default:                return "box";
    }
}

// §19. engine.devtools.shapes(body) → массив форм тела для overlay:
// { index, kind, kindId, x, y, angle, halfW, halfH, radius, points[], pointCount,
//   sensor, enabled, oneWay, layer, mask, group }.
// Координаты локальные (система тела, пиксели): мировой контур — трансформ
// тела из engine.getTransforms() плюс x/y/angle формы.
static JSValue r2d__js_devtools_shapes(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DPhysics *p = s ? s->physics : NULL;

    JSValue arr = JS_NewArray(ctx);
    if (!p || argc < 1) return arr;

    int32_t body = -1;
    if (JS_ToInt32(ctx, &body, argv[0])) return arr;

    const int count = r2d_physics_shape_count(p, (int)body);
    uint32_t n = 0;
    for (int i = 0; i < count; ++i) {
        R2DPhysShapeInfo info;
        // Форма, тип которой движку неизвестен, в список не попадает: рисовать
        // «похожий» контур вместо настоящего — та же выдумка, что и числа.
        if (!r2d_physics_shape_info(p, (int)body, i, &info)) continue;

        JSValue o = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, o, "index", JS_NewInt32(ctx, i));
        JS_SetPropertyStr(ctx, o, "kind", JS_NewString(ctx, r2d__shape_kind_name(info.kind)));
        JS_SetPropertyStr(ctx, o, "kindId", JS_NewInt32(ctx, info.kind));
        JS_SetPropertyStr(ctx, o, "x", JS_NewFloat64(ctx, (double)info.cx));
        JS_SetPropertyStr(ctx, o, "y", JS_NewFloat64(ctx, (double)info.cy));
        JS_SetPropertyStr(ctx, o, "angle", JS_NewFloat64(ctx, (double)info.angle));
        JS_SetPropertyStr(ctx, o, "halfW", JS_NewFloat64(ctx, (double)info.half_w));
        JS_SetPropertyStr(ctx, o, "halfH", JS_NewFloat64(ctx, (double)info.half_h));
        JS_SetPropertyStr(ctx, o, "radius", JS_NewFloat64(ctx, (double)info.radius));

        JSValue pts = JS_NewArray(ctx);
        for (int k = 0; k < info.point_count; ++k) {
            JSValue pt = JS_NewObject(ctx);
            JS_SetPropertyStr(ctx, pt, "x", JS_NewFloat64(ctx, (double)info.points[k * 2]));
            JS_SetPropertyStr(ctx, pt, "y", JS_NewFloat64(ctx, (double)info.points[k * 2 + 1]));
            JS_SetPropertyUint32(ctx, pts, (uint32_t)k, pt);
        }
        JS_SetPropertyStr(ctx, o, "points", pts);
        JS_SetPropertyStr(ctx, o, "pointCount", JS_NewInt32(ctx, info.point_count));

        JS_SetPropertyStr(ctx, o, "sensor", JS_NewBool(ctx, info.sensor));
        JS_SetPropertyStr(ctx, o, "enabled", JS_NewBool(ctx, info.enabled));
        JS_SetPropertyStr(ctx, o, "oneWay", JS_NewBool(ctx, info.one_way));
        JS_SetPropertyStr(ctx, o, "layer", JS_NewFloat64(ctx, (double)info.category_bits));
        JS_SetPropertyStr(ctx, o, "mask", JS_NewFloat64(ctx, (double)info.mask_bits));
        JS_SetPropertyStr(ctx, o, "group", JS_NewInt32(ctx, info.group_index));
        JS_SetPropertyUint32(ctx, arr, n++, o);
    }
    return arr;
}

// §37. engine.devtools.light(x, y, radius, intensity, shadow, layer) —
// публикация ОДНОГО реально нарисованного источника. Зовётся JS-путём света
// (render.js, drawLightNode/drawLightAreaNode) один раз на источник за кадр.
// Своего света в C нет, поэтому и «списка света» без публикации быть не может.
static JSValue r2d__js_devtools_light(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    if (!r) return JS_FALSE;

    if (r->light_reading_count >= R2D_MAX_LIGHT_READINGS) {
        // Молча терять источники нельзя: список останется неполным, но
        // инспектор узнает об этом из lightsDropped().
        r->light_reading_dropped++;
        return JS_FALSE;
    }

    double x = 0.0, y = 0.0, radius = 0.0, intensity = 0.0, layer = 0.0;
    if (argc > 0) JS_ToFloat64(ctx, &x, argv[0]);
    if (argc > 1) JS_ToFloat64(ctx, &y, argv[1]);
    if (argc > 2) JS_ToFloat64(ctx, &radius, argv[2]);
    if (argc > 3) JS_ToFloat64(ctx, &intensity, argv[3]);

    R2DLightReading *rd = &r->light_readings[r->light_reading_count++];
    rd->x         = (float)x;
    rd->y         = (float)y;
    rd->radius    = (float)radius;
    rd->intensity = (float)intensity;
    // shadow — итоговый флаг ПОСЛЕ деградации по бюджету теней: инспектор
    // обязан видеть то, что случилось, а не то, что просили.
    rd->shadow    = (argc > 4) && JS_ToBool(ctx, argv[4]) != 0;
    if (argc > 5) JS_ToFloat64(ctx, &layer, argv[5]);
    rd->layer     = (uint32_t)layer;
    return JS_TRUE;
}

// engine.devtools.lights() → [{ index, x, y, radius, intensity, shadow, layer }].
// Ровно то, что опубликовал JS-путь света в этом кадре, в порядке отрисовки.
static JSValue r2d__js_devtools_lights(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;

    JSValue arr = JS_NewArray(ctx);
    if (!r) return arr;
    for (int i = 0; i < r->light_reading_count; ++i) {
        const R2DLightReading *rd = &r->light_readings[i];
        JSValue o = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, o, "index", JS_NewInt32(ctx, i));
        JS_SetPropertyStr(ctx, o, "x", JS_NewFloat64(ctx, (double)rd->x));
        JS_SetPropertyStr(ctx, o, "y", JS_NewFloat64(ctx, (double)rd->y));
        JS_SetPropertyStr(ctx, o, "radius", JS_NewFloat64(ctx, (double)rd->radius));
        JS_SetPropertyStr(ctx, o, "intensity", JS_NewFloat64(ctx, (double)rd->intensity));
        JS_SetPropertyStr(ctx, o, "shadow", JS_NewBool(ctx, rd->shadow));
        JS_SetPropertyStr(ctx, o, "layer", JS_NewFloat64(ctx, (double)rd->layer));
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, o);
    }
    return arr;
}

// Сколько публикаций света не влезло в список за кадр (0 — список полный).
static JSValue r2d__js_devtools_lights_dropped(JSContext *ctx, JSValueConst this_val,
                                               int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    return JS_NewInt32(ctx, r ? r->light_reading_dropped : 0);
}

// engine.renderInfo() → что происходило в кадре: пост, свечение, размеры
// буферов и число полноэкранных проходов. Нужен тестам и отладке: по одним
// параметрам поста не видно, действительно ли свечение считалось.
static JSValue r2d__js_render_info(JSContext *ctx, JSValueConst this_val,
                                   int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;

    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "post", JS_NewBool(ctx, r && r->post_pipeline != NULL));
    JS_SetPropertyStr(ctx, o, "bloom", JS_NewBool(ctx, r && r->bloom_a != NULL));
    JS_SetPropertyStr(ctx, o, "bloom_ready", JS_NewBool(ctx, r && r->post.bloom_ready > 0.5f));
    JS_SetPropertyStr(ctx, o, "bloom_w", JS_NewInt32(ctx, r ? r->bloom_w : 0));
    JS_SetPropertyStr(ctx, o, "bloom_h", JS_NewInt32(ctx, r ? r->bloom_h : 0));
    JS_SetPropertyStr(ctx, o, "scene_w", JS_NewInt32(ctx, r ? r->scene_w : 0));
    JS_SetPropertyStr(ctx, o, "scene_h", JS_NewInt32(ctx, r ? r->scene_h : 0));
    JS_SetPropertyStr(ctx, o, "passes", JS_NewInt32(ctx, r ? r->stat_passes : 0));
    // Сколько шейдеров узлов записала JS-сторона в этом кадре, и поднялись
    // ли конвейеры для них.
    JS_SetPropertyStr(ctx, o, "fx", JS_NewInt32(ctx, r ? r->fx_count : 0));
    JS_SetPropertyStr(ctx, o, "fx_pipelines", JS_NewBool(ctx, r && r->fx_pipelines[0] != NULL));
    JS_SetPropertyStr(ctx, o, "fx_cmds", JS_NewInt32(ctx, r ? r->stat_fx_cmds : 0));
    JS_SetPropertyStr(ctx, o, "draws", JS_NewInt32(ctx, r ? r->stat_draws : 0));

    // --- §25. Счётчики инспектора рендера -----------------------------------
    // batches — пакеты, реально отправленные в этом кадре (участки спрайтов,
    // пакеты треугольников, пакет меша). draw_calls — ВСЕ вызовы отрисовки:
    // пакеты плюс полноэкранные проходы (пост, свечение, свет). Числа читаются
    // из счётчиков GPU-вызовов, а не считаются «на глазок»: draw_calls — это
    // ровно то же, что старое поле draws (оставлено для совместимости).
    JS_SetPropertyStr(ctx, o, "batches", JS_NewInt32(ctx, r ? r->stat_batches : 0));
    JS_SetPropertyStr(ctx, o, "draw_calls", JS_NewInt32(ctx, r ? r->stat_draws : 0));

    // Цели кадра: имя, размер и факт участия в этом кадре. В списке только те
    // цели, которые реально существуют (созданы) — «нулевых» записей нет,
    // иначе инспектор показывал бы буфер, которого нет.
    {
        JSValue targets = JS_NewArray(ctx);
        uint32_t n = 0;
        if (r) {
            struct { const char *name; SDL_GPUTexture *tex; int w, h; bool active; } list[] = {
                { "scene",      r->scene_target,      r->scene_w,      r->scene_h,      r->scene_target_used },
                { "bloom_a",    r->bloom_a,           r->bloom_w,      r->bloom_h,      r->bloom_result == r->bloom_a },
                { "bloom_b",    r->bloom_b,           r->bloom_w,      r->bloom_h,      r->bloom_result == r->bloom_b },
                { "light",      r->light_target,      r->light_w,      r->light_h,      r->lightmap_used },
                { "light_blur", r->light_blur,        r->light_w,      r->light_h,      r->light_blur_used },
                { "light_mask", r->light_mask_target, r->light_mask_w, r->light_mask_h, r->stat_mask_passes > 0 },
                { "depth",      r->depth_texture,     r->depth_w,      r->depth_h,      r->depth_enabled && r->depth_texture != NULL },
            };
            for (size_t i = 0; i < sizeof list / sizeof list[0]; ++i) {
                if (!list[i].tex) continue;
                JSValue t = JS_NewObject(ctx);
                JS_SetPropertyStr(ctx, t, "name", JS_NewString(ctx, list[i].name));
                JS_SetPropertyStr(ctx, t, "w", JS_NewInt32(ctx, list[i].w));
                JS_SetPropertyStr(ctx, t, "h", JS_NewInt32(ctx, list[i].h));
                JS_SetPropertyStr(ctx, t, "active", JS_NewBool(ctx, list[i].active));
                JS_SetPropertyUint32(ctx, targets, n++, t);
            }
            // Цели игры ($.viewport.create): каждая живёт в своём слоте.
            for (int i = 0; i < R2D_MAX_VIEWPORTS; ++i) {
                if (!r->viewports[i].used || !r->viewports[i].target) continue;
                JSValue t = JS_NewObject(ctx);
                char name[32];
                SDL_snprintf(name, sizeof name, "viewport%d", i);
                JS_SetPropertyStr(ctx, t, "name", JS_NewString(ctx, name));
                JS_SetPropertyStr(ctx, t, "w", JS_NewInt32(ctx, r->viewports[i].w));
                JS_SetPropertyStr(ctx, t, "h", JS_NewInt32(ctx, r->viewports[i].h));
                JS_SetPropertyStr(ctx, t, "active", JS_NewBool(ctx, r->bound_viewport == i));
                JS_SetPropertyUint32(ctx, targets, n++, t);
            }
        }
        JS_SetPropertyStr(ctx, o, "targets", targets);
    }

    // Текстуры: сколько живых, потолок и суммарный размер в пикселях. Байты
    // НЕ отдаём: таблица текстур не хранит ни формат, ни число мип-уровней, а
    // считать «примерно по 4 байта» — выдуманное число (вьюпорты игры вообще
    // создаются в формате swapchain). Число пикселей — измеренный факт.
    {
        JSValue tex = JS_NewObject(ctx);
        int live = 0;
        double pixels = 0.0;
        if (r) {
            for (int i = 0; i < r->texture_count; ++i) {
                if (!r->textures[i].alive) continue;
                live++;
                pixels += (double)r->textures[i].width * (double)r->textures[i].height;
            }
        }
        JS_SetPropertyStr(ctx, tex, "count", JS_NewInt32(ctx, live));
        JS_SetPropertyStr(ctx, tex, "max", JS_NewInt32(ctx, R2D_MAX_TEXTURES));
        JS_SetPropertyStr(ctx, tex, "pixels", JS_NewFloat64(ctx, pixels));
        JS_SetPropertyStr(ctx, o, "textures", tex);
    }

    // Кадр: размер, в котором считалась сцена, метка интерфейса и снаппинг.
    // Целочисленная шкала здесь НЕ отдаётся: она живёт в JS
    // ($.gfx.integerScale/presentation) и к буферу кадра отношения не имеет.
    {
        JSValue vp = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, vp, "w", JS_NewInt32(ctx, r ? r->screen_w : 0));
        JS_SetPropertyStr(ctx, vp, "h", JS_NewInt32(ctx, r ? r->screen_h : 0));
        JS_SetPropertyStr(ctx, vp, "snap", JS_NewBool(ctx, r && r->snap));
        // -1 — кадр идёт в swapchain, иначе индекс связанного render target.
        JS_SetPropertyStr(ctx, vp, "bound", JS_NewInt32(ctx, r ? r->bound_viewport : -1));
        JS_SetPropertyStr(ctx, o, "viewport", vp);
    }

    // Презентация: снаппинг вершин и число конвейеров (вариантов пайплайнов).
    // Постоянная смена материала не должна плодить варианты — их потолок
    // виден здесь: 4 режима смешивания + 4 под шейдер узла.
    JS_SetPropertyStr(ctx, o, "snap", JS_NewBool(ctx, r && r->snap));
    // SMAA (§task-22): доступность, включённость и число шагов поиска.
    JS_SetPropertyStr(ctx, o, "smaa_available", JS_NewBool(ctx, r2d_render_smaa_available(r)));
    JS_SetPropertyStr(ctx, o, "smaa_on", JS_NewBool(ctx, r2d_render_smaa_on(r)));
    JS_SetPropertyStr(ctx, o, "smaa_steps", JS_NewFloat64(ctx, (double)r2d_render_smaa_steps(r)));
#ifndef __EMSCRIPTEN__
    // Готов ли конвейер SMAA (создаётся лениво при первом включении):
    // поле нужно тестам и DevTools, чтобы отличать «выключено» от «не создался».
    JS_SetPropertyStr(ctx, o, "smaa_pipeline", JS_NewBool(ctx, r && r2d__smaa_pipeline(r) != NULL));
#else
    JS_SetPropertyStr(ctx, o, "smaa_pipeline", JS_NewBool(ctx, false));
#endif
    JS_SetPropertyStr(ctx, o, "sprite_pipelines", JS_NewInt32(ctx, R2D_BLEND_COUNT));
    {
        int fx_ready = 0;
        for (int i = 0; r && i < R2D_BLEND_COUNT; ++i) if (r->fx_pipelines[i]) fx_ready++;
        JS_SetPropertyStr(ctx, o, "fx_pipelines_ready", JS_NewInt32(ctx, fx_ready));
    }
    return o;
}

// engine.setSnap(on)/engine.renderSnap() — презентационный снаппинг вершин.
static JSValue r2d__js_set_snap(JSContext *ctx, JSValueConst this_val,
                                int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    if (argc >= 1 && r) r->snap = JS_ToBool(ctx, argv[0]) != 0;
    return JS_NewBool(ctx, r && r->snap);
}

static JSValue r2d__js_post_supported(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    return JS_NewBool(ctx, r && r->post_pipeline != NULL);
}

// engine.markUnlit() — «дальше идёт неосвещённый мировой слой»: без света,
// тумана и темноты, но под интерфейсом (узлы с .lit(false)).
static JSValue r2d__js_mark_unlit(JSContext *ctx, JSValueConst this_val,
                                  int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (s && s->renderer) r2d_render_mark_unlit(s->renderer);
    return JS_UNDEFINED;
}

// engine.markUI() — «дальше идёт интерфейс». С пост-обработкой HUD рисуется
// после неё, поэтому вигнетка и линза его не затемняют.
static JSValue r2d__js_mark_ui(JSContext *ctx, JSValueConst this_val,
                               int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (s && s->renderer) r2d_render_mark_ui(s->renderer);
    return JS_UNDEFINED;
}

// Имя режима из 4-го аргумента. Возвращает R2DBlendMode; неизвестное имя
// один раз ругается в лог и трактуется как alpha, чтобы старый код не падал.
static int r2d__js_blend_arg(JSContext *ctx, int argc, JSValueConst *argv, int i)
{
    if (i >= argc || JS_IsUndefined(argv[i]) || JS_IsNull(argv[i])) return R2D_BLEND_ALPHA;

    const char *name = JS_ToCString(ctx, argv[i]);
    if (!name) return R2D_BLEND_ALPHA;   // не строка — оставляем прежнее поведение

    const int mode = r2d_blend_from_name(name);
    if (mode < 0) {
        static bool warned = false;
        if (!warned) {
            warned = true;
            R2D_ERROR("submitSprites: неизвестный режим смешивания \"%s\"; "
                       "доступны: alpha, add, multiply, none", name);
        }
        JS_FreeCString(ctx, name);
        return R2D_BLEND_ALPHA;
    }
    JS_FreeCString(ctx, name);
    return mode;
}

// engine.submitSprites(transforms, colors, count?, blend?) — главный путь
// отрисовки, повторяет реализацию из script.c и добавляет режим смешивания.
static JSValue r2d__js_submit_sprites(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, 0);
    if (argc < 2) {
        JS_ThrowTypeError(ctx, "submitSprites(transforms: Float32Array, colors: Uint32Array, count?, blend?)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t ab_size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &ab_size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }
    const float *transforms = (const float *)(base + off);
    const size_t transform_count = len / sizeof(float);

    const uint32_t *colors = NULL;
    JSValue colors_ab = JS_UNDEFINED;
    size_t colors_len = 0;
    if (argc >= 2 && !JS_IsUndefined(argv[1]) && !JS_IsNull(argv[1])) {
        size_t coff = 0, clen = 0, cbpe = 0;
        colors_ab = JS_GetTypedArrayBuffer(ctx, argv[1], &coff, &clen, &cbpe);
        if (!JS_IsException(colors_ab)) {
            size_t csize = 0;
            uint8_t *cbase = JS_GetArrayBuffer(ctx, &csize, colors_ab);
            if (cbase) {
                colors = (const uint32_t *)(cbase + coff);
                colors_len = clen / sizeof(uint32_t);
            }
        } else {
            JS_FreeValue(ctx, colors_ab);
            colors_ab = JS_UNDEFINED;
        }
    }

    int count = (int)(transform_count / 6);
    if (argc >= 3) {
        const int requested = r2d__js_arg_int(ctx, argc, argv, 2, count);
        if (requested >= 0 && requested < count) count = requested;
    }
    if (colors && colors_len < (size_t)count) {
        // Цветов меньше, чем спрайтов — остальным достаётся белый.
        count = (int)colors_len;
    }

    // Пятый аргумент — индексы шейдеров узла (Int32Array), по одному на спрайт.
    // Без него пакет идёт обычным конвейером: старые игры ничего не заметят.
    const int32_t *fx = NULL;
    JSValue fx_ab = JS_UNDEFINED;
    if (argc >= 5 && !JS_IsUndefined(argv[4]) && !JS_IsNull(argv[4])) {
        size_t foff = 0, flen = 0, fbpe = 0;
        fx_ab = JS_GetTypedArrayBuffer(ctx, argv[4], &foff, &flen, &fbpe);
        if (!JS_IsException(fx_ab)) {
            size_t fsize = 0;
            uint8_t *fbase = JS_GetArrayBuffer(ctx, &fsize, fx_ab);
            if (fbase && flen / sizeof(int32_t) >= (size_t)count) {
                fx = (const int32_t *)(fbase + foff);
            }
        } else {
            JS_FreeValue(ctx, fx_ab);
            fx_ab = JS_UNDEFINED;
        }
    }

    // §20.1. Шестой аргумент — биты получателя света (Uint32Array), по одному
    // на спрайт. Без него у всех «все слои»: поведение и цена прежние.
    const uint32_t *mask = NULL;
    JSValue mask_ab = JS_UNDEFINED;
    if (argc >= 6 && !JS_IsUndefined(argv[5]) && !JS_IsNull(argv[5])) {
        size_t moff = 0, mlen = 0, mbpe = 0;
        mask_ab = JS_GetTypedArrayBuffer(ctx, argv[5], &moff, &mlen, &mbpe);
        if (!JS_IsException(mask_ab)) {
            size_t msize = 0;
            uint8_t *mbase = JS_GetArrayBuffer(ctx, &msize, mask_ab);
            if (mbase && mlen / sizeof(uint32_t) >= (size_t)count) {
                mask = (const uint32_t *)(mbase + moff);
            }
        } else {
            JS_FreeValue(ctx, mask_ab);
            mask_ab = JS_UNDEFINED;
        }
    }

    const int blend = r2d__js_blend_arg(ctx, argc, argv, 3);
    const int drawn = r2d_batch_submit_fx_mask(s->renderer, transforms, colors, fx, mask,
                                               count, blend);

    if (!JS_IsUndefined(colors_ab)) JS_FreeValue(ctx, colors_ab);
    if (!JS_IsUndefined(fx_ab)) JS_FreeValue(ctx, fx_ab);
    if (!JS_IsUndefined(mask_ab)) JS_FreeValue(ctx, mask_ab);
    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, drawn);
}

// engine.defineSpriteFx(index, kind, p1, p2, p3, color) — запись шейдера узла.
// Индекс ведёт JS-сторона (она же решает, какие узлы попадают в один участок),
// ноль зарезервирован под «обычный спрайт».
static JSValue r2d__js_define_sprite_fx(JSContext *ctx, JSValueConst this_val,
                                        int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_FALSE;
    const bool ok = r2d_render_fx_define(s->renderer,
                                         r2d__js_arg_int(ctx, argc, argv, 0, 0),
                                         r2d__js_arg_int(ctx, argc, argv, 1, 0),
                                         (float)r2d__js_arg_float(ctx, argc, argv, 2, 0.0),
                                         (float)r2d__js_arg_float(ctx, argc, argv, 3, 0.0),
                                         (float)r2d__js_arg_float(ctx, argc, argv, 4, 0.0),
                                         (uint32_t)r2d__js_arg_int(ctx, argc, argv, 5, 0xFFFFFFFF),
                                         r2d__js_arg_int(ctx, argc, argv, 6, 0));
    return JS_NewBool(ctx, ok);
}

// engine.submitTriangles(vertices, count?, blend?) — произвольные
// треугольники с цветом на вершину и собственным режимом смешивания.
static JSValue r2d__js_submit_triangles(JSContext *ctx, JSValueConst this_val,
                                        int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, 0);
    if (argc < 1) {
        JS_ThrowTypeError(ctx, "submitTriangles(vertices: Float32Array, count?, blend?)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }

    const int available = (int)(len / sizeof(float) / 6);
    int count = argc >= 2 ? r2d__js_arg_int(ctx, argc, argv, 1, available) : available;
    if (count > available) count = available;
    if (count < 0) count = 0;
    count -= count % 3;   // неполный треугольник рисовать нечем

    if (count > 0) {
        const int blend = r2d__js_blend_arg(ctx, argc, argv, 2);
        r2d_batch_triangles_blend(s->renderer, (const float *)(base + off), count, blend);
    }

    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, count);
}

// ---------------------------------------------------------------------------
// engine.submitLightTriangles — свет для lightmap
//
// Формат тот же, что у submitTriangles (stride 6: x, y, r, g, b, a), но
// треугольники попадают в отдельный список и рисуются не в сцену, а в текстуру
// света (r2d_render_draw_lights). Порядок в списке задаёт порядок внутри карты
// света; на сцену она ложится одним проходом.
// ---------------------------------------------------------------------------

static JSValue r2d__js_submit_light_triangles(JSContext *ctx, JSValueConst this_val,
                                              int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, 0);
    if (argc < 1) {
        JS_ThrowTypeError(ctx, "submitLightTriangles(vertices: Float32Array, count?, blend?)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }

    const int available = (int)(len / sizeof(float) / 6);
    int count = argc >= 2 ? r2d__js_arg_int(ctx, argc, argv, 1, available) : available;
    if (count > available) count = available;
    if (count < 0) count = 0;
    count -= count % 3;   // неполный треугольник рисовать нечем

    if (count > 0) {
        const int blend = r2d__js_blend_arg(ctx, argc, argv, 2);
        // §20.1. Четвёртый аргумент — биты слоя источника (0xFFFFFFFF — все
        // получатели, прежнее поведение). Пакет света рвётся по смене слоя.
        uint32_t layer = 0xFFFFFFFFu;
        if (argc >= 4 && !JS_IsUndefined(argv[3]) && !JS_IsNull(argv[3])) {
            double v = 0;
            if (!JS_ToFloat64(ctx, &v, argv[3])) layer = (uint32_t)v;
        }
        r2d_batch_light_triangles_layer(s->renderer, (const float *)(base + off), count,
                                        blend, layer);
    }

    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, count);
}

// ---------------------------------------------------------------------------
// engine.lightMap(on?, intensity?, soft?) — режим lightmap
//
// Без аргументов возвращает текущее состояние (1/0). С аргументами включает или
// выключает карту света: { on, intensity, soft } уходит в рендерер, который
// решает, рисовать свет в текстуру или прямо в сцену.
// ---------------------------------------------------------------------------

// engine.lightMaskPasses() — сколько раз за прошлый кадр писалась маска
// получателя света (§20.1). Ноль — масок в кадре не было.
static JSValue r2d__js_light_mask_passes(JSContext *ctx, JSValueConst this_val,
                                         int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2D_UNUSED(argc);
    R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, 0);
    return JS_NewInt32(ctx, s->renderer->prev_mask_passes);
}

static JSValue r2d__js_light_map(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, 0);

    if (argc < 1) return JS_NewInt32(ctx, r2d_render_lightmap_enabled(s->renderer) ? 1 : 0);

    const bool on = JS_ToBool(ctx, argv[0]) > 0;
    float intensity = -1.0f, soft = -1.0f;
    if (argc >= 2) {
        double v = 0;
        if (!JS_ToFloat64(ctx, &v, argv[1]) && v > 0) intensity = (float)v;
    }
    if (argc >= 3) {
        double v = 0;
        if (!JS_ToFloat64(ctx, &v, argv[2]) && v >= 0) soft = (float)v;
    }

    r2d_render_lightmap_set(s->renderer, on, intensity, soft);
    return JS_NewInt32(ctx, on ? 1 : 0);
}

// ---------------------------------------------------------------------------
// engine.viewport — render target
//
// Работает так: привязанная игра текстура имеет приоритет над пост-обработкой,
// кадр уходит в неё (main.c), а на экран попадает отдельным блитом
// (r2d_render_viewport_present); HUD при этом рисуется в проходе поверх.
// Прежний комментарий «render target не поддержан осознанно» устарел и врал:
// реализация ниже — рабочая. Подробности — docs/highlevel/render.md.
// ---------------------------------------------------------------------------

// engine.viewport.create(w, h) → id или -1.
static JSValue r2d__js_viewport_create(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, -1);
    return JS_NewInt32(ctx, r2d_render_viewport_create(s->renderer,
                                                       r2d__js_arg_int(ctx, argc, argv, 0, 0),
                                                       r2d__js_arg_int(ctx, argc, argv, 1, 0)));
}

static JSValue r2d__js_viewport_destroy(JSContext *ctx, JSValueConst this_val,
                                        int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_FALSE;
    return JS_NewBool(ctx, r2d_render_viewport_destroy(s->renderer,
                                                       r2d__js_arg_int(ctx, argc, argv, 0, -1)));
}

// engine.viewport.bind(id) — рисовать кадр в эту текстуру; bind(-1) — как обычно.
static JSValue r2d__js_viewport_bind(JSContext *ctx, JSValueConst this_val,
                                     int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_FALSE;
    return JS_NewBool(ctx, r2d_render_viewport_bind(s->renderer,
                                                    r2d__js_arg_int(ctx, argc, argv, 0, -1)));
}

static JSValue r2d__js_viewport_size(JSContext *ctx, JSValueConst this_val,
                                     int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    int w = 0, h = 0;
    if (!s || !s->renderer
        || r2d_render_viewport_size(s->renderer, r2d__js_arg_int(ctx, argc, argv, 0, -1),
                                    &w, &h) != 0) {
        return JS_NULL;
    }
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "w", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, o, "h", JS_NewInt32(ctx, h));
    return o;
}

// engine.viewport.sprite(id) — спрайт прошлого кадра: игра рисует его как
// обычную картинку и получает шлейф/накопление.
static JSValue r2d__js_viewport_sprite(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, -1);
    return JS_NewInt32(ctx, r2d_render_viewport_sprite(s->renderer,
                                                       r2d__js_arg_int(ctx, argc, argv, 0, -1)));
}

// engine.viewport.bound() → id связанного viewport'а или -1.
static JSValue r2d__js_viewport_bound(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    return JS_NewInt32(ctx, r ? r->bound_viewport : -1);
}

// Занято ли слотов вьюпорта (для $.debug.limits: игра должна видеть, близко ли
// к потолку, а не только сам потолок).
int r2d_render_viewport_live_count(const R2DRenderer *r)
{
    if (!r) return 0;
    int n = 0;
    for (int i = 0; i < R2D_MAX_VIEWPORTS; ++i) {
        if (r->viewports[i].used) n++;
    }
    return n;
}

static JSValue r2d__js_viewport_count(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    int n = 0;
    if (r) {
        for (int i = 0; i < R2D_MAX_VIEWPORTS; ++i) {
            if (r->viewports[i].used) n++;
        }
    }
    return JS_NewInt32(ctx, n);
}

// engine.defineUserShader(name, source) → слот (>= 1) или -1.
static JSValue r2d__js_define_user_shader(JSContext *ctx, JSValueConst this_val,
                                          int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, -1);
    const char *name = argc > 0 ? JS_ToCString(ctx, argv[0]) : NULL;
    const char *source = argc > 1 ? JS_ToCString(ctx, argv[1]) : NULL;
    int id = -1;
    if (name && source) id = r2d_render_user_shader_define(s->renderer, name, source);
    else if (s && s->renderer) SDL_snprintf(s->renderer->user_shader_error,
                                            sizeof s->renderer->user_shader_error,
                                            "defineUserShader(имя, исходник): нужен исходник");
    if (name) JS_FreeCString(ctx, name);
    if (source) JS_FreeCString(ctx, source);
    return JS_NewInt32(ctx, id);
}

static JSValue r2d__js_user_shader_error(JSContext *ctx, JSValueConst this_val,
                                         int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    return JS_NewString(ctx, r2d_render_user_shader_error(s ? s->renderer : NULL));
}

static JSValue r2d__js_user_shader_count(JSContext *ctx, JSValueConst this_val,
                                         int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    return JS_NewInt32(ctx, r2d_render_user_shader_count(s ? s->renderer : NULL));
}

static JSValue r2d__js_user_shader_preamble(JSContext *ctx, JSValueConst this_val,
                                            int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewString(ctx, r2d_render_user_shader_preamble());
}

static JSValue r2d__js_user_shader_supported(JSContext *ctx, JSValueConst this_val,
                                             int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewBool(ctx, r2d_render_user_shader_supported());
}

// engine.textureAverageColor(id, isSprite?) → [r, g, b, a] (0..255) или null.
// `isSprite: true` — id это спрайт, берётся его текстура (см. ниже про столы).
//
// Средний цвет снимается один раз при создании текстуры (см.
// r2d__texture_average) и лежит в R2DTexture. Нужен emissive-спрайтам: цвет
// 'auto' берётся из пикселей спрайта, а в кадре пикселей уже нет — SDL_Surface
// освобождается сразу после загрузки. В кадре стоимость нулевая.
static JSValue r2d__js_texture_average_color(JSContext *ctx, JSValueConst this_val,
                                             int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    if (!r || argc < 1) return JS_NULL;
    int32_t id = -1;
    if (JS_ToInt32(ctx, &id, argv[0])) return JS_EXCEPTION;
    // Идентификаторы текстур и спрайтов живут в РАЗНЫХ столах и могут
    // совпадать по номеру, поэтому вид указывается явно: второй аргумент
    // `true` — это спрайт (тогда берём его текстуру). Иначе легко вернуть
    // цвет чужой текстуры с тем же номером.
    const bool is_sprite = argc > 1 && JS_ToBool(ctx, argv[1]) == 1;
    int tex = id;
    float region[4];
    bool have_region = false;
    if (is_sprite) {
        if (id < 0 || id >= r->sprite_count || !r->sprites[id].alive) return JS_NULL;
        tex = r->sprites[id].texture;
        // Спрайт может быть РЕГИОНОМ листа (атлас, процедурный лист): тогда
        // средний цвет текстуры — это цвет всего листа, а не кадра. Считаем
        // регион по миниатюре; для спрайта во всю текстуру регион совпадает с
        // ней, и ответ прежний — точный `avg`.
        if (tex >= 0 && tex < r->texture_count && r->textures[tex].alive) {
            const R2DTexture *t = &r->textures[tex];
            const R2DSprite *sp = &r->sprites[id];
            if (t->width > 0 && t->height > 0) {
                const int sx = (int)(sp->u0 * (float)t->width + 0.5f);
                const int sy = (int)(sp->v0 * (float)t->height + 0.5f);
                const int sw = (int)((sp->u1 - sp->u0) * (float)t->width + 0.5f);
                const int sh = (int)((sp->v1 - sp->v0) * (float)t->height + 0.5f);
                const bool full = sx <= 0 && sy <= 0 && sw >= t->width && sh >= t->height;
                if (!full) have_region = r2d__texture_average_region(t, sx, sy, sw, sh, region);
            }
        }
    }
    if (have_region) {
        JSValue out = JS_NewArray(ctx);
        for (int i = 0; i < 4; ++i) {
            JS_SetPropertyUint32(ctx, out, (uint32_t)i, JS_NewFloat64(ctx, (double)region[i]));
        }
        return out;
    }
    if (tex < 0 || tex >= r->texture_count || !r->textures[tex].alive
        || !r->textures[tex].has_avg) {
        return JS_NULL;   // честный null: «среднего цвета нет», а не чёрный
    }
    const float *avg = r->textures[tex].avg;
    JSValue out = JS_NewArray(ctx);
    for (int i = 0; i < 4; ++i) {
        JS_SetPropertyUint32(ctx, out, (uint32_t)i,
                             JS_NewFloat64(ctx, (double)avg[i]));
    }
    return out;
}

void r2d_render_register_js(JSContext *ctx, JSValue engine)
{
    // Рендерер достаём из opaque контекста: r2d_render_register_js зовётся из
    // r2d__make_engine уже после JS_SetContextOpaque.
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;

    // --- Пакеты с режимом смешивания ---------------------------------------
    // Переопределяем функции script.c: 4-й аргумент живёт здесь, а script.c —
    // общая точка сборки, править её нельзя. Без 4-го аргумента поведение
    // прежнее (alpha), поэтому старые игры не замечают подмены.
    if (r) {
        r2d__js_set_fn(ctx, engine, "submitSprites",   r2d__js_submit_sprites, 6);
        r2d__js_set_fn(ctx, engine, "lightMaskPasses", r2d__js_light_mask_passes, 0);
        r2d__js_set_fn(ctx, engine, "submitTriangles", r2d__js_submit_triangles, 3);
        // Свет для lightmap: свой список, свой проход, тот же формат вершин.
        r2d__js_set_fn(ctx, engine, "submitLightTriangles", r2d__js_submit_light_triangles, 3);
        r2d__js_set_fn(ctx, engine, "lightMap",             r2d__js_light_map, 3);
        // Средний цвет спрайта/текстуры: нужен emissive-спрайтам для цвета 'auto'.
        r2d__js_set_fn(ctx, engine, "textureAverageColor",  r2d__js_texture_average_color, 1);
        // Шейдер узла: JS ведёт таблицу эффектов на своей стороне, поэтому
        // запись в таблицу движка — явный вызов с индексом.
        r2d__js_set_fn(ctx, engine, "defineSpriteFx",  r2d__js_define_sprite_fx, 7);
        // Пользовательские шейдеры: компиляция GLSL в рантайме (glslang +
        // spirv-cross). Имя ведёт JS-сторона, сюда приходит и оно, и исходник.
        r2d__js_set_fn(ctx, engine, "defineUserShader",      r2d__js_define_user_shader, 2);
        r2d__js_set_fn(ctx, engine, "userShaderError",       r2d__js_user_shader_error, 0);
        r2d__js_set_fn(ctx, engine, "userShaderCount",       r2d__js_user_shader_count, 0);
        r2d__js_set_fn(ctx, engine, "userShaderPreamble",    r2d__js_user_shader_preamble, 0);
        r2d__js_set_fn(ctx, engine, "userShadersSupported",  r2d__js_user_shader_supported, 0);
    }

    // --- Пост-обработка ------------------------------------------------------
    // Позиционные аргументы: отсутствующие сохраняют текущее значение, чтобы
    // игра могла менять один эффект, не переписывая остальные. Последний
    // аргумент — время (нужно зерну).
    r2d__js_set_fn(ctx, engine, "setPost", r2d__js_set_post, 31);
    r2d__js_set_fn(ctx, engine, "getPost", r2d__js_get_post, 0);
    r2d__js_set_fn(ctx, engine, "postSupported", r2d__js_post_supported, 0);
    r2d__js_set_fn(ctx, engine, "renderInfo", r2d__js_render_info, 0);
    r2d__js_set_fn(ctx, engine, "setSnap", r2d__js_set_snap, 1);
    r2d__js_set_fn(ctx, engine, "markUI", r2d__js_mark_ui, 0);
    r2d__js_set_fn(ctx, engine, "markUnlit", r2d__js_mark_unlit, 0);

    // --- engine.devtools.*: данные инспекторов (§19 физика, §37 свет) --------
    // Регистрируется здесь, а не в script.c: рендерер уже владеет своими
    // биндингами, и общая точка сборки остаётся нетронутой. Если сборка не
    // имеет этого объекта (старый SDK), JS-путь света просто не публикует
    // источники — проверка наличия функции обязательна на стороне JS.
    {
        JSValue devtools = JS_NewObject(ctx);
        r2d__js_set_fn(ctx, devtools, "shapes",        r2d__js_devtools_shapes, 1);
        r2d__js_set_fn(ctx, devtools, "light",         r2d__js_devtools_light, 6);
        r2d__js_set_fn(ctx, devtools, "lights",        r2d__js_devtools_lights, 0);
        r2d__js_set_fn(ctx, devtools, "lightsDropped", r2d__js_devtools_lights_dropped, 0);
        JS_SetPropertyStr(ctx, engine, "devtools", devtools);
    }

    // --- engine.viewport.*: render target игры ------------------------------
    JSValue vp = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, vp, "supported", JS_NewBool(ctx, r != NULL));
    r2d__js_set_fn(ctx, vp, "create",  r2d__js_viewport_create, 2);
    r2d__js_set_fn(ctx, vp, "destroy", r2d__js_viewport_destroy, 1);
    r2d__js_set_fn(ctx, vp, "bind",    r2d__js_viewport_bind, 1);
    r2d__js_set_fn(ctx, vp, "unbind",  r2d__js_viewport_bind, 0);
    r2d__js_set_fn(ctx, vp, "size",    r2d__js_viewport_size, 1);
    r2d__js_set_fn(ctx, vp, "sprite",  r2d__js_viewport_sprite, 1);
    r2d__js_set_fn(ctx, vp, "bound",   r2d__js_viewport_bound, 0);
    r2d__js_set_fn(ctx, vp, "count",   r2d__js_viewport_count, 0);
    JS_SetPropertyStr(ctx, engine, "viewport", vp);
}
