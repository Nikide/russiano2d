#include "render.h"
#include "shader_live.h"

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
    } else {
        R2D_ERROR("GPU-бэкенд не поддерживает ни SPIR-V, ни MSL, ни DXIL");
        return NULL;
    }

    SDL_GPUShader *shader = SDL_CreateGPUShader(device, &info);
    if (!shader) {
        R2D_ERROR("SDL_CreateGPUShader: %s", SDL_GetError());
    }
    return shader;
}

// Создаёт конвейер спрайтов под конкретный режим смешивания. Вершинный вход
// у всех режимов общий — меняется только blend_state цветового таргета.
static SDL_GPUGraphicsPipeline *r2d__create_pipeline(
        SDL_GPUDevice *device, SDL_Window *window,
        SDL_GPUShader *vs, SDL_GPUShader *fs,
        const SDL_GPUVertexBufferDescription *vbuf,
        const SDL_GPUVertexAttribute *attribs,
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
    pipe.vertex_input_state.num_vertex_attributes = 3;
    pipe.vertex_input_state.vertex_attributes     = attribs;

    pipe.target_info.num_color_targets         = 1;
    pipe.target_info.color_target_descriptions = &target;

    pipe.rasterizer_state.fill_mode  = SDL_GPU_FILLMODE_FILL;
    pipe.rasterizer_state.cull_mode  = SDL_GPU_CULLMODE_NONE;
    pipe.rasterizer_state.front_face = SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE;

    pipe.multisample_state.sample_count = SDL_GPU_SAMPLECOUNT_1;

    return SDL_CreateGPUGraphicsPipeline(device, &pipe);
}

// ---------------------------------------------------------------------------
// Текстуры
// ---------------------------------------------------------------------------

static SDL_GPUTexture *r2d__create_texture(R2DRenderer *r, int w, int h)
{
    SDL_GPUTextureCreateInfo info;
    SDL_zero(info);
    info.type         = SDL_GPU_TEXTURETYPE_2D;
    info.format       = SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM;
    info.usage        = SDL_GPU_TEXTUREUSAGE_SAMPLER;
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

// Заливает RGBA8-пиксели в текстуру через одноразовый command buffer.
static bool r2d__upload_pixels(R2DRenderer *r, SDL_GPUTexture *tex,
                                const void *pixels, int w, int h, int pitch)
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

int r2d_texture_load(R2DRenderer *r, const char *path)
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
    SDL_GPUTexture *tex = r2d__create_texture(r, w, h);
    if (!tex || !r2d__upload_pixels(r, tex, rgba->pixels, w, h, rgba->pitch)) {
        if (tex) SDL_ReleaseGPUTexture(r->device, tex);
        if (rgba != loaded) SDL_DestroySurface(rgba);
        SDL_DestroySurface(loaded);
        return -1;
    }

    if (rgba != loaded) SDL_DestroySurface(rgba);
    SDL_DestroySurface(loaded);

    const int id = slot;
    R2DTexture *t = &r->textures[id];
    t->handle = tex;
    t->width  = w;
    t->height = h;
    t->alive  = true;
    SDL_snprintf(t->name, sizeof t->name, "%s", path);

    R2D_LOG("текстура #%d: %s (%dx%d)", id, path, w, h);
    return id;
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
    if (!r2d__grow((void **)&r->sprites, &r->sprite_cap, r->sprite_count + 1, sizeof(R2DSprite))) {
        return -1;
    }

    const float tw = (float)r->textures[texture].width;
    const float th = (float)r->textures[texture].height;

    R2DSprite *s = &r->sprites[r->sprite_count];
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
    s->alive  = true;

    return r->sprite_count++;
}

bool r2d_sprite_alive(const R2DRenderer *r, int id)
{
    return id >= 0 && id < r->sprite_count && r->sprites[id].alive;
}

// ---------------------------------------------------------------------------
// Батч
// ---------------------------------------------------------------------------

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
    r->light_vertex_count = 0;
    r->light_batch_count  = 0;
    r->light_index_start  = 0;
    // Свет этого кадра ещё не ушёл в текстуру: если lightmap выключится или
    // кадр окажется в чужом render target, свет дорисует проход сцены.
    r->lightmap_used      = false;
    r->batch_blend      = R2D_BLEND_ALPHA;
    r->batch_fx         = 0;
    r->fx_count         = 0;
    // Связывание viewport'а живёт кадр: игра вызывает bind() в своём кадре.
    r->bound_viewport   = -1;
    // -1 — «интерфейс ещё не помечен»: тогда все спрайты считаются миром.
    r->ui_cmd_start     = -1;
    r->stat_draws     = 0;
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
    if (!r2d_sprite_alive(r, sprite)) return;
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

    R2DVertex *verts = &r->vertices[r->vertex_count];
    for (int i = 0; i < 4; ++i) {
        const float rx = lx[i] * cs - ly[i] * sn;
        const float ry = lx[i] * sn + ly[i] * cs;
        const float px = x + rx;
        const float py = y + ry;

        verts[i].x = px * inv_w - 1.0f;
        verts[i].y = 1.0f - py * inv_h;   // экранный Y направлен вниз
        verts[i].u = uu[i];
        verts[i].v = vv[i];
        verts[i].r = cr;
        verts[i].g = cg;
        verts[i].b = cb;
        verts[i].a = ca;
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
    }

    *count += vertex_count;
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
    r2d__pack_triangles(r, verts, vertex_count, blend, R2D_BLEND_ADD,
                        &r->light_vertices, &r->light_vertex_count, &r->light_vertex_cap,
                        &r->light_batches, &r->light_batch_count, &r->light_batch_cap);
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

    SDL_GPUVertexAttribute attrs[3];
    SDL_zero(attrs);
    attrs[0].location = 0; attrs[0].buffer_slot = 0; attrs[0].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[0].offset = 0;
    attrs[1].location = 1; attrs[1].buffer_slot = 0; attrs[1].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[1].offset = sizeof(float) * 2;
    attrs[2].location = 2; attrs[2].buffer_slot = 0; attrs[2].format = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM; attrs[2].offset = sizeof(float) * 4;

    SDL_GPUGraphicsPipeline *pipes[R2D_BLEND_COUNT];
    SDL_zero(pipes);
    bool ok = true;
    for (int m = 0; m < R2D_BLEND_COUNT && ok; ++m) {
        pipes[m] = r2d__create_pipeline(r->device, r->window, vertex, fragment, &vb, attrs,
                                        (R2DBlendMode)m);
        if (!pipes[m]) {
            SDL_snprintf(r->user_shader_error, sizeof r->user_shader_error,
                         "конвейер для режима %d не создался: %s", m, SDL_GetError());
            ok = false;
        }
    }
    SDL_ReleaseGPUShader(r->device, vertex);

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
    if (r->index_count == 0 && r->tri_vertex_count == 0 && r->light_vertex_count == 0) return;

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
    if (!r2d__ensure_upload_buffer(r, vertex_bytes + index_bytes)) return;

    // cycle=true — SDL сам ротирует внутренние ресурсы, поэтому не нужно
    // вручную следить за тем, что предыдущий кадр ещё читает эти данные.
    void *mapped = SDL_MapGPUTransferBuffer(r->device, r->upload_buffer, true);
    if (!mapped) {
        R2D_ERROR("SDL_MapGPUTransferBuffer: %s", SDL_GetError());
        return;
    }
    SDL_memcpy(mapped, r->vertices, vertex_bytes);
    SDL_memcpy((Uint8 *)mapped + vertex_bytes, r->indices, index_bytes);
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

    src.offset = vertex_bytes;
    dst.buffer = r->index_buffer;
    dst.offset = 0;
    dst.size   = index_bytes;
    SDL_UploadToGPUBuffer(cp, &src, &dst, true);

    SDL_EndGPUCopyPass(cp);

    r->stat_upload_bytes = vertex_bytes + index_bytes;
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

// Рисует диапазон спрайтов [from, to): соседние команды с одной текстурой и
// одним режимом смешивания склеиваются в один draw call. bound_blend — «что
// уже привязано» (-1 — ничего), состояние переживает вызовы, потому что
// диапазоны рисуются в разных проходах и конвейер всё равно перепривяжется.
static void r2d__draw_sprite_range(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                   SDL_GPURenderPass *pass,
                                   int from, int to, int *bound_blend)
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
            (r->cmds[i].fx != r->cmds[run_start].fx);

        if (!end_of_run) continue;

        const int texture = r->sprites[r->cmds[run_start].sprite].texture;
        const uint8_t mode = r->cmds[run_start].blend;
        const uint8_t fx_index = r->cmds[run_start].fx;
        if (fx_index > 0) {
            // Шейдер узла: свой конвейер на каждый режим смешивания и
            // юниформы с видом эффекта и его параметрами.
            const R2DNodeFx *node_fx = &r->fx[fx_index];
            const uint8_t pipe_mode = mode < R2D_BLEND_COUNT ? mode : R2D_BLEND_ALPHA;
            // Пользовательский шейдер — свой конвейер на каждый режим
            // смешивания; встроенные эффекты живут на общем конвейере.
            SDL_GPUGraphicsPipeline *pipe =
                node_fx->user > 0
                    ? r->user_shaders[node_fx->user].pipelines[pipe_mode]
                    : r->fx_pipelines[pipe_mode];
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
                *bound_blend = -1;      // следующий обычный участок перебиндит пайплайн
            } else {
                if ((int)mode != *bound_blend) {
                    r2d__bind_pipeline(r, pass, mode);
                    *bound_blend = (int)mode;
                }
            }
        } else if ((int)mode != *bound_blend) {
            r2d__bind_pipeline(r, pass, mode);
            *bound_blend = (int)mode;
        }

        SDL_GPUTextureSamplerBinding tex_binding;
        SDL_zero(tex_binding);
        tex_binding.texture = r->textures[texture].handle;
        tex_binding.sampler = r->sampler;
        SDL_BindGPUFragmentSamplers(pass, 0, &tex_binding, 1);

        const Uint32 first_index = (Uint32)(run_start * 6);
        const Uint32 num_indices = (Uint32)((i - run_start) * 6);
        SDL_DrawGPUIndexedPrimitives(pass, num_indices, 1, first_index, 0, 0);

        r->stat_draws++;
        if (fx_index > 0) r->stat_fx_cmds += (i - run_start);
        run_start = i;
    }
}

// Рисует пакеты треугольников в текущий проход: у каждого пакета свой конвейер
// (режим смешивания), текстура всегда белая, потому что цвет приходит с вершин.
// index_start — смещение диапазона в общем индексном буфере: у сцены и у света
// lightmap диапазоны разные, а буфер один.
static void r2d__draw_tri_batches(R2DRenderer *r, SDL_GPURenderPass *pass,
                                  const R2DTriBatch *batches, int count,
                                  int index_start, int *bound_blend)
{
    for (int b = 0; b < count; ++b) {
        const R2DTriBatch *tb = &batches[b];
        if (tb->vertex_count <= 0) continue;

        if ((int)tb->blend != *bound_blend) {
            r2d__bind_pipeline(r, pass, tb->blend);
            *bound_blend = (int)tb->blend;
        }

        SDL_GPUTextureSamplerBinding tex_binding;
        SDL_zero(tex_binding);
        tex_binding.texture = r->textures[r->white_texture].handle;
        tex_binding.sampler = r->sampler;
        SDL_BindGPUFragmentSamplers(pass, 0, &tex_binding, 1);

        SDL_DrawGPUIndexedPrimitives(pass, (Uint32)tb->vertex_count, 1,
                                     (Uint32)(index_start + tb->vertex_offset), 0, 0);
        r->stat_draws++;
    }
}

void r2d_render_draw_world(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                           SDL_GPURenderPass *pass)
{
    if (r->cmd_count == 0 && r->tri_batch_count == 0 && r->light_batch_count == 0) return;

    // Интерфейс помечен JS-стороной; если метки нет — все спрайты считаются
    // миром (старое поведение, HUD тогда тоже под пост-обработкой).
    const int ui_from = r->ui_cmd_start >= 0 ? r->ui_cmd_start : r->cmd_count;

    int bound_blend = -1;
    r2d__draw_sprite_range(r, cmd, pass, 0, ui_from, &bound_blend);

    r->stat_sprites = r->cmd_count;

    // Треугольники рисуем ПОСЛЕ всех спрайтов, белой текстурой, каждый свой
    // вызов со своим конвейером. Это осознанно: свет накладывается поверх сцены.
    r2d__draw_tri_batches(r, pass, r->tri_batches, r->tri_batch_count,
                          r->tri_index_start, &bound_blend);

    // Свет, который не ушёл в lightmap (он выключен, идёт чужой render target
    // или не удалось создать текстуру), рисуем прямо в сцену — как до появления
    // lightmap. Иначе свет просто исчез бы.
    if (r->light_batch_count > 0 && !r->lightmap_used) {
        r2d__draw_tri_batches(r, pass, r->light_batches, r->light_batch_count,
                              r->light_index_start, &bound_blend);
    }
}

void r2d_render_draw_ui(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass)
{
    if (r->ui_cmd_start < 0) return;
    int bound_blend = -1;
    r2d__draw_sprite_range(r, cmd, pass, r->ui_cmd_start, r->cmd_count, &bound_blend);
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

bool r2d_render_post_enabled(const R2DRenderer *r)
{
    if (!r || !r->post_pipeline) return false;
    const R2DPostParams *p = &r->post;
    if (p->enabled <= 0.5f) return false;
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
    if (r->scene_target && r->scene_w == w && r->scene_h == h) return r->scene_target;

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
    return r->scene_target;
}

void r2d_render_post(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass)
{
    if (!r || !r->post_pipeline || !r->scene_target || !cmd || !pass) return;

    SDL_BindGPUGraphicsPipeline(pass, r->post_pipeline);

    // binding 0 — сцена, binding 1 — готовая размытая яркая часть (bloom).
    // Если свечения не было, туда уходит чёрная текстура 1×1 и вклад нулевой,
    // а флаг bloom_ready заставляет шейдер взять запасную ветку.
    SDL_GPUTextureSamplerBinding binding[2];
    SDL_zero(binding);
    binding[0].texture = r->scene_target;
    binding[0].sampler = r->sampler;
    binding[1].texture = r->bloom_result ? r->bloom_result : r->black_texture;
    binding[1].sampler = r->linear_sampler ? r->linear_sampler : r->sampler;
    SDL_BindGPUFragmentSamplers(pass, 0, binding, 2);

    // Push-константы: шесть vec4, раскладка совпадает с R2DPostParams.
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

bool r2d_render_draw_lights(R2DRenderer *r, SDL_GPUCommandBuffer *cmd)
{
    if (!r || !cmd || !r->lightmap_on) return false;
    if (r->light_batch_count <= 0) return false;
    // В render target игры формат цели может не совпасть с форматом
    // полноэкранных конвейеров — тогда свет дорисует проход сцены (см.
    // r2d_render_draw_world): терять свет нельзя ни при каких условиях.
    if (r->bound_viewport >= 0) return false;
    if (!r2d__lightmap_ready(r, r->screen_w, r->screen_h)) return false;

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
        r2d__draw_tri_batches(r, pass, r->light_batches, r->light_batch_count,
                              r->light_index_start, &bound_blend);
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
        }
    }

    r->lightmap_used = true;
    return true;
}

void r2d_render_light_composite(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                SDL_GPURenderPass *pass)
{
    if (!r || !cmd || !pass) return;
    if (!r->lightmap_on || !r->lightmap_used || !r->light_target) return;
    if (!r->light_composite_pipeline) return;

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
    // Свет в lightmap по умолчанию не ослабляется: карта включается явно, и
    // при включении свет должен выглядеть как раньше.
    r->lightmap_intensity = 1.0f;

    SDL_GPUShader *vs = r2d__make_shader(device, &r2d_shader_sprite_vert,
                                          SDL_GPU_SHADERSTAGE_VERTEX, 0, 0);
    SDL_GPUShader *fs = r2d__make_shader(device, &r2d_shader_sprite_frag,
                                          SDL_GPU_SHADERSTAGE_FRAGMENT, 0, 1);
    if (!vs || !fs) {
        if (vs) SDL_ReleaseGPUShader(device, vs);
        if (fs) SDL_ReleaseGPUShader(device, fs);
        return false;
    }

    SDL_GPUVertexAttribute attribs[3];
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

    SDL_GPUVertexBufferDescription vbuf;
    SDL_zero(vbuf);
    vbuf.slot       = 0;
    vbuf.pitch      = (Uint32)sizeof(R2DVertex);
    vbuf.input_rate = SDL_GPU_VERTEXINPUTRATE_VERTEX;

    // Конвейер на каждый режим смешивания: рисовать разными режимами в одном
    // render pass можно, переключая пайплайн перед сменой режима у батча.
    for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
        r->pipelines[m] = r2d__create_pipeline(device, window, vs, fs, &vbuf, attribs,
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
        if (!white || !r2d__upload_pixels(r, white, &pixel, 1, 1, 4)) {
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
        if (black && r2d__upload_pixels(r, black, &pixel, 1, 1, 4)) {
            r->black_texture = black;
        } else {
            R2D_WARN("не удалось создать чёрную текстуру для свечения");
            if (black) SDL_ReleaseGPUTexture(device, black);
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

            SDL_GPUVertexAttribute attrs[3];
            SDL_zero(attrs);
            attrs[0].location = 0; attrs[0].buffer_slot = 0; attrs[0].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[0].offset = 0;
            attrs[1].location = 1; attrs[1].buffer_slot = 0; attrs[1].format = SDL_GPU_VERTEXELEMENTFORMAT_FLOAT2; attrs[1].offset = sizeof(float) * 2;
            attrs[2].location = 2; attrs[2].buffer_slot = 0; attrs[2].format = SDL_GPU_VERTEXELEMENTFORMAT_UBYTE4_NORM; attrs[2].offset = sizeof(float) * 4;

            r->fx_pipelines[mode] = r2d__create_pipeline(device, window, fx_vs, fx_fs, &vb, attrs,
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
    return o;
}

static JSValue r2d__js_post_supported(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    R2DRenderer *r = s ? s->renderer : NULL;
    return JS_NewBool(ctx, r && r->post_pipeline != NULL);
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

    const int blend = r2d__js_blend_arg(ctx, argc, argv, 3);
    const int drawn = r2d_batch_submit_fx(s->renderer, transforms, colors, fx, count, blend);

    if (!JS_IsUndefined(colors_ab)) JS_FreeValue(ctx, colors_ab);
    if (!JS_IsUndefined(fx_ab)) JS_FreeValue(ctx, fx_ab);
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
        r2d_batch_light_triangles_blend(s->renderer, (const float *)(base + off), count, blend);
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
// В этой сборке render target не поддержан осознанно: r2d_render_draw()
// получает уже открытый render pass от main.c, а кадр идёт прямо в swapchain.
// Начать второй проход внутрь offscreen-текстуры из JS нельзя — это не
// заглушка «на потом», а отказ, чтобы код игры получил внятную ошибку вместо
// молча неверной картинки. Что нужно перестроить — docs/highlevel/render.md.
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
        r2d__js_set_fn(ctx, engine, "submitSprites",   r2d__js_submit_sprites, 5);
        r2d__js_set_fn(ctx, engine, "submitTriangles", r2d__js_submit_triangles, 3);
        // Свет для lightmap: свой список, свой проход, тот же формат вершин.
        r2d__js_set_fn(ctx, engine, "submitLightTriangles", r2d__js_submit_light_triangles, 3);
        r2d__js_set_fn(ctx, engine, "lightMap",             r2d__js_light_map, 3);
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
    r2d__js_set_fn(ctx, engine, "setPost", r2d__js_set_post, 22);
    r2d__js_set_fn(ctx, engine, "getPost", r2d__js_get_post, 0);
    r2d__js_set_fn(ctx, engine, "postSupported", r2d__js_post_supported, 0);
    r2d__js_set_fn(ctx, engine, "renderInfo", r2d__js_render_info, 0);
    r2d__js_set_fn(ctx, engine, "markUI", r2d__js_mark_ui, 0);

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
