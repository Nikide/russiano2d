#include "render.h"

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
        // src + dst. Альфу тоже складываем: свет поверх света не должен
        // внезапно «гаснуть» из-за неучтённой альфы назначения.
        bs->enable_blend          = true;
        bs->src_color_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
        bs->dst_color_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
        bs->color_blend_op        = SDL_GPU_BLENDOP_ADD;
        bs->src_alpha_blendfactor = SDL_GPU_BLENDFACTOR_ONE;
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

int r2d_texture_load(R2DRenderer *r, const char *path)
{
    const int existing = r2d_texture_find(r, path);
    if (existing >= 0) return existing;

    if (r->texture_count >= R2D_MAX_TEXTURES) {
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

    const int id = r->texture_count++;
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
    s->u0 = sx / tw;
    s->v0 = sy / th;
    s->u1 = (sx + sw) / tw;
    s->v1 = (sy + sh) / th;
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
    r->batch_blend      = R2D_BLEND_ALPHA;
    r->stat_draws     = 0;
    r->stat_sprites   = 0;
    r->stat_vertices  = 0;
    r->stat_upload_bytes = 0;
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

void r2d_batch_triangles_blend(R2DRenderer *r, const float *verts, int vertex_count, int blend)
{
    if (!verts || vertex_count <= 0) return;
    if (vertex_count % 3 != 0) {
        R2D_ERROR("r2d_batch_triangles: vertex_count=%d не кратен 3", vertex_count);
        return;
    }
    if (!r2d__grow((void **)&r->tri_vertices, &r->tri_cap,
                    r->tri_vertex_count + vertex_count, sizeof(R2DVertex))) {
        return;
    }
    if (!r2d__grow((void **)&r->tri_batches, &r->tri_batch_cap,
                    r->tri_batch_count + 1, sizeof(R2DTriBatch))) {
        return;
    }
    if (blend < 0 || blend >= R2D_BLEND_COUNT) blend = R2D_BLEND_ALPHA;

    // Запоминаем диапазон ДО раскладки: рисоваться он будет своим конвейером.
    R2DTriBatch *batch = &r->tri_batches[r->tri_batch_count++];
    batch->vertex_offset = r->tri_vertex_count;
    batch->vertex_count  = vertex_count;
    batch->blend         = (uint8_t)blend;

    // Та же проекция, что и у спрайтов: пиксели логического экрана -> clip-space.
    // Добавки 0.5 на центр пикселя в спрайтовом пути нет, поэтому её нет и здесь.
    const float inv_w = 2.0f / (float)r->screen_w;
    const float inv_h = 2.0f / (float)r->screen_h;

    R2DVertex *dst = &r->tri_vertices[r->tri_vertex_count];
    for (int i = 0; i < vertex_count; ++i) {
        const float *v = verts + (size_t)i * 6;
        const float px = v[0];
        const float py = v[1];

        dst[i].x = px * inv_w - 1.0f;
        dst[i].y = 1.0f - py * inv_h;   // экранный Y направлен вниз
        dst[i].u = 0.5f;                // всё равно рисуем белой текстурой
        dst[i].v = 0.5f;
        dst[i].r = r2d__color_f32(v[2]);
        dst[i].g = r2d__color_f32(v[3]);
        dst[i].b = r2d__color_f32(v[4]);
        dst[i].a = r2d__color_f32(v[5]);
    }

    r->tri_vertex_count += vertex_count;
}

void r2d_batch_triangles(R2DRenderer *r, const float *verts, int vertex_count)
{
    r2d_batch_triangles_blend(r, verts, vertex_count, R2D_BLEND_ALPHA);
}

int r2d_batch_submit_blend(R2DRenderer *r, const float *transforms, const uint32_t *colors,
                           int count, int blend)
{
    if (count <= 0) return 0;
    if (!transforms) {
        R2D_ERROR("submitSprites: не передан массив трансформов");
        return 0;
    }
    if (blend < 0 || blend >= R2D_BLEND_COUNT) blend = R2D_BLEND_ALPHA;

    // Режим действует только на этот пакет: после цикла возвращаем прежний
    // (обычно ALPHA), чтобы старые drawSprite/drawRect не подхватили чужой.
    const uint8_t prev = r->batch_blend;
    r->batch_blend = (uint8_t)blend;

    const int before = r->cmd_count;
    for (int i = 0; i < count; ++i) {
        const float *t = transforms + (size_t)i * 6;
        const uint32_t color = colors ? colors[i] : R2D_WHITE;
        r2d_batch_add(r, (int)t[0], t[1], t[2], t[3], t[4], t[5], color);
    }

    r->batch_blend = prev;
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
    if (r->index_count == 0 && r->tri_vertex_count == 0) return;

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

void r2d_render_draw(R2DRenderer *r, SDL_GPURenderPass *pass)
{
    if (r->cmd_count == 0 && r->tri_batch_count == 0) return;

    // Идём по командам и группируем соседние с одинаковой текстурой И
    // одинаковым режимом смешивания в один draw call. -1 — «ещё ничего не
    // привязано»; первый же участок привяжет нужный конвейер.
    int bound_blend = -1;
    int run_start = 0;
    for (int i = 1; i <= r->cmd_count; ++i) {
        const bool end_of_run =
            (i == r->cmd_count) ||
            (r->sprites[r->cmds[i].sprite].texture != r->sprites[r->cmds[run_start].sprite].texture) ||
            (r->cmds[i].blend != r->cmds[run_start].blend);

        if (!end_of_run) continue;

        const int texture = r->sprites[r->cmds[run_start].sprite].texture;
        const uint8_t mode = r->cmds[run_start].blend;
        if ((int)mode != bound_blend) {
            r2d__bind_pipeline(r, pass, mode);
            bound_blend = (int)mode;
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
        run_start = i;
    }

    r->stat_sprites = r->cmd_count;

    // Треугольники рисуем ПОСЛЕ всех спрайтов, белой текстурой, каждый свой
    // вызов со своим конвейером. Это осознанно: свет накладывается поверх сцены.
    for (int b = 0; b < r->tri_batch_count; ++b) {
        const R2DTriBatch *tb = &r->tri_batches[b];
        if (tb->vertex_count <= 0) continue;

        if ((int)tb->blend != bound_blend) {
            r2d__bind_pipeline(r, pass, tb->blend);
            bound_blend = (int)tb->blend;
        }

        SDL_GPUTextureSamplerBinding tex_binding;
        SDL_zero(tex_binding);
        tex_binding.texture = r->textures[r->white_texture].handle;
        tex_binding.sampler = r->sampler;
        SDL_BindGPUFragmentSamplers(pass, 0, &tex_binding, 1);

        SDL_DrawGPUIndexedPrimitives(pass, (Uint32)tb->vertex_count, 1,
                                     (Uint32)(r->tri_index_start + tb->vertex_offset), 0, 0);
        r->stat_draws++;
    }
}

// ---------------------------------------------------------------------------
// Жизненный цикл
// ---------------------------------------------------------------------------

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
        return false;
    }

    // Белая текстура 1x1 — основа для engine.drawRect().
    {
        SDL_GPUTexture *white = r2d__create_texture(r, 1, 1);
        const Uint32 pixel = 0xFFFFFFFFu;
        if (!white || !r2d__upload_pixels(r, white, &pixel, 1, 1, 4)) {
            R2D_ERROR("не удалось создать белую текстуру");
            if (white) SDL_ReleaseGPUTexture(device, white);
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
    for (int m = 0; m < R2D_BLEND_COUNT; ++m) {
        if (r->pipelines[m]) SDL_ReleaseGPUGraphicsPipeline(r->device, r->pipelines[m]);
    }

    SDL_free(r->sprites);
    SDL_free(r->cmds);
    SDL_free(r->tri_vertices);
    SDL_free(r->tri_batches);
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

    const int blend = r2d__js_blend_arg(ctx, argc, argv, 3);
    const int drawn = r2d_batch_submit_blend(s->renderer, transforms, colors, count, blend);

    if (!JS_IsUndefined(colors_ab)) JS_FreeValue(ctx, colors_ab);
    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, drawn);
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
// engine.viewport — render target
//
// В этой сборке render target не поддержан осознанно: r2d_render_draw()
// получает уже открытый render pass от main.c, а кадр идёт прямо в swapchain.
// Начать второй проход внутрь offscreen-текстуры из JS нельзя — это не
// заглушка «на потом», а отказ, чтобы код игры получил внятную ошибку вместо
// молча неверной картинки. Что нужно перестроить — docs/highlevel/render.md.
// ---------------------------------------------------------------------------

static JSValue r2d__js_viewport_unsupported(JSContext *ctx, JSValueConst this_val,
                                            int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2D_UNUSED(argc);
    R2D_UNUSED(argv);
    return JS_ThrowTypeError(ctx,
        "render target не поддержан в этой сборке: кадр рисуется напрямую в swapchain, "
        "а render pass открывает main.c. Что нужно перестроить — docs/highlevel/render.md");
}

// count() — единственный запрос, который безопасно отвечает нулём: он нужен
// коду игры для проверки, есть ли вообще буферы.
static JSValue r2d__js_viewport_count(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2D_UNUSED(argc);
    R2D_UNUSED(argv);
    return JS_NewInt32(ctx, 0);
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
        r2d__js_set_fn(ctx, engine, "submitSprites",   r2d__js_submit_sprites, 4);
        r2d__js_set_fn(ctx, engine, "submitTriangles", r2d__js_submit_triangles, 3);
    }

    // --- engine.viewport.*: честная заглушка -------------------------------
    JSValue vp = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, vp, "supported", JS_FALSE);
    r2d__js_set_fn(ctx, vp, "create",  r2d__js_viewport_unsupported, 2);
    r2d__js_set_fn(ctx, vp, "destroy", r2d__js_viewport_unsupported, 1);
    r2d__js_set_fn(ctx, vp, "size",    r2d__js_viewport_unsupported, 1);
    r2d__js_set_fn(ctx, vp, "begin",   r2d__js_viewport_unsupported, 1);
    r2d__js_set_fn(ctx, vp, "end",     r2d__js_viewport_unsupported, 0);
    r2d__js_set_fn(ctx, vp, "draw",    r2d__js_viewport_unsupported, 7);
    r2d__js_set_fn(ctx, vp, "capture", r2d__js_viewport_unsupported, 1);
    r2d__js_set_fn(ctx, vp, "count",   r2d__js_viewport_count, 0);
    JS_SetPropertyStr(ctx, engine, "viewport", vp);
}
