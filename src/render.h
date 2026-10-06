// ===========================================================================
// Рендер: текстуры, спрайты и пакетный (batched) вывод.
//
// Ключевая идея из ТЗ, п. 4.1: JS не вызывает отрисовку на каждый спрайт.
// За кадр набирается плоский массив команд, который одним вызовом уходит в C,
// а тот раскладывает его в вершинный/индексный буфер и делает минимум
// draw call'ов (по одному на смену текстуры).
// ===========================================================================
#pragma once

#include "r2d.h"

// Предварительные объявления QuickJS: render.h не тянет quickjs.h целиком,
// но объявляет регистрацию engine.*, которую реализует render.c.
typedef struct JSContext JSContext;
typedef struct JSValue JSValue;

#include <SDL3/SDL_gpu.h>

#ifdef __cplusplus
extern "C" {
#endif

// Режимы смешивания. Порядок менять НЕЛЬЗЯ: это же порядок конвейеров в
// R2DRenderer.pipelines и порядок BLEND_NAMES на JS-стороне
// (src/highlevel/render.js). Четвёртый аргумент submitSprites — имя режима,
// оно приходит сюда как индекс.
typedef enum R2DBlendMode {
    R2D_BLEND_ALPHA = 0,   // обычное альфа-смешивание (по умолчанию)
    R2D_BLEND_ADD,         // аддитивное: src + dst
    R2D_BLEND_MULTIPLY,    // умножение: src * dst
    R2D_BLEND_NONE,        // без смешивания: src заменяет dst
    R2D_BLEND_COUNT
} R2DBlendMode;

// Параметры пост-обработки. Раскладка обязана совпадать с юниформой PostParams
// в shaders/post.frag.glsl: шесть vec4 подряд, 24 float.
typedef struct R2DPostParams {
    // p0
    float glow;       // сила свечения (0 — выключено)
    float vignette;   // затемнение краёв
    float chromatic;  // расхождение каналов (доли экрана)
    float lens;       // сила линзы: UV тянется к центру
    // p1
    float center_x;   // центр искажения, 0..1
    float center_y;
    float radius;     // радиус искажения, доли высоты
    float grain;      // зерно
    // p2
    float scanline;   // скан-линии
    float time;       // время для зерна
    float enabled;    // 0 — пост выключен, кадр идёт прямо в swapchain
    float posterize;  // уровней квантования цвета; <= 1.5 — выключено
    // p3
    float tint_r;     // оттенок: множители каналов (1,1,1 — без сдвига)
    float tint_g;
    float tint_b;
    float tint_amount;
    // p4
    float saturation; // 1 — как есть, 0 — ч/б
    float contrast;   // 1 — как есть
    float brightness; // 0 — как есть
    float blood;      // красная пелена по краям (урон)
    // p5 — запас под будущие эффекты, чтобы не менять размер блока
    float _pad[4];
} R2DPostParams;

typedef struct R2DTexture {
    SDL_GPUTexture *handle;
    char            name[128];
    int             width;
    int             height;
    bool            alive;
} R2DTexture;

typedef struct R2DSprite {
    int   texture;
    float u0, v0, u1, v1;
    float width, height;   // размер исходного прямоугольника в пикселях
    bool  alive;
} R2DSprite;

typedef struct R2DDrawCmd {
    int      sprite;
    float    x, y, w, h, angle;
    uint32_t color;
    uint8_t  blend;    // R2DBlendMode, зафиксированный на момент добавления
} R2DDrawCmd;

// Один вызов r2d_batch_triangles: диапазон в общем индексном буфере и его
// режим смешивания. Диапазоны хранятся раздельно, потому что треугольники
// уходят в общий IB одним куском, но рисоваться могут разными конвейерами.
typedef struct R2DTriBatch {
    int     vertex_offset;   // смещение в tri_vertices (оно же — в индексах)
    int     vertex_count;
    uint8_t blend;
} R2DTriBatch;

// Вершина: позиция уже в clip-space (проекция запекается на CPU).
typedef struct R2DVertex {
    float    x, y;
    float    u, v;
    uint8_t  r, g, b, a;
} R2DVertex;

typedef struct R2DRenderer {
    SDL_GPUDevice *device;
    SDL_Window    *window;

    // По конвейеру на каждый режим смешивания; индекс — R2DBlendMode.
    SDL_GPUGraphicsPipeline *pipelines[R2D_BLEND_COUNT];
    SDL_GPUSampler          *sampler;

    R2DTexture textures[R2D_MAX_TEXTURES];
    int         texture_count;
    int         white_texture;   // индекс текстуры 1x1 для прямоугольников
    int         white_sprite;    // спрайт поверх этой текстуры

    R2DSprite  *sprites;
    int          sprite_count;
    int          sprite_cap;

    R2DDrawCmd *cmds;
    int          cmd_count;
    int          cmd_cap;

    // Произвольные треугольники с цветом на вершину. Хранятся отдельно от
    // cmds/спрайтов, но при заливке дописываются в общий вершинный и
    // индексный буфер (индексы идут последовательно 0,1,2, 3,4,5, ...).
    R2DVertex *tri_vertices;
    int         tri_vertex_count;
    int         tri_cap;
    R2DTriBatch *tri_batches;      // по одной записи на вызов r2d_batch_triangles
    int          tri_batch_count;
    int          tri_batch_cap;
    int          tri_index_start;  // первый индекс диапазона в общем IB

    // Режим, который получит следующая r2d_batch_add. Живёт только внутри
    // r2d_batch_submit_blend и всегда возвращается к ALPHA, поэтому старые
    // drawSprite/drawRect (без режима) ведут себя как раньше.
    uint8_t     batch_blend;

    R2DVertex *vertices;
    int         vertex_count;
    int         vertex_cap;

    uint32_t *indices;
    int       index_count;
    int       index_cap;

    SDL_GPUBuffer         *vertex_buffer;
    SDL_GPUBuffer         *index_buffer;
    uint32_t               vb_capacity;   // вершины
    uint32_t               ib_capacity;   // индексы
    SDL_GPUTransferBuffer *upload_buffer;
    uint32_t               upload_capacity;

    int    screen_w, screen_h;   // размер буфера кадра в пикселях

    // --- Пост-обработка -----------------------------------------------------
    // Сцена рисуется в offscreen-текстуру, а на swapchain идёт полноэкранный
    // проход с эффектами. Когда пост выключен, всё как раньше: сразу в swapchain.
    SDL_GPUGraphicsPipeline *post_pipeline;
    SDL_GPUTexture          *scene_target;
    int    scene_w, scene_h;
    R2DPostParams post;
    // Граница интерфейса в списке команд: JS помечает её перед отдачей
    // ui-спрайтов, чтобы с постом HUD рисовался поверх обработки, а не под ней.
    int ui_cmd_start;

    // Статистика текущего кадра
    int    stat_draws;
    int    stat_sprites;
    int    stat_vertices;
    size_t stat_upload_bytes;

    float clear_r, clear_g, clear_b, clear_a;
} R2DRenderer;

bool r2d_render_init(R2DRenderer *r, SDL_GPUDevice *device, SDL_Window *window);
void r2d_render_shutdown(R2DRenderer *r);

// --- Текстуры ---------------------------------------------------------------
// Загружает PNG (или другой формат, который понимает SDL_image).
// Возвращает id >= 0 либо -1. Второй вызов с тем же путём вернёт тот же id.
int  r2d_texture_load(R2DRenderer *r, const char *path);
int  r2d_texture_find(const R2DRenderer *r, const char *path);
void r2d_texture_info(const R2DRenderer *r, int id, int *w, int *h);
const char *r2d_texture_name(const R2DRenderer *r, int id);
SDL_GPUTexture *r2d_texture_handle(const R2DRenderer *r, int id);

// --- Спрайты ----------------------------------------------------------------
// Регистрирует прямоугольник внутри текстуры и возвращает его id.
int  r2d_sprite_create(R2DRenderer *r, int texture, float sx, float sy, float sw, float sh);
bool r2d_sprite_alive(const R2DRenderer *r, int id);

// --- Батч текущего кадра ----------------------------------------------------
void r2d_render_begin_frame(R2DRenderer *r, int screen_w, int screen_h);
void r2d_batch_add(R2DRenderer *r, int sprite, float x, float y, float w, float h,
                    float angle, uint32_t color);
void r2d_batch_rect(R2DRenderer *r, float x, float y, float w, float h, uint32_t color);

// Добавляет треугольники одним вызовом. verts — stride 6:
//   x, y (в пикселях ЛОГИЧЕСКОГО экрана), r, g, b, a (0..255).
// vertex_count должен быть кратен 3.
void r2d_batch_triangles(R2DRenderer *r, const float *verts, int vertex_count);

// Разбор плоского JS-массива: transforms — stride 6 (sprite,x,y,w,h,angle),
// colors — stride 1. Один вызов на весь кадр.
int  r2d_batch_submit(R2DRenderer *r, const float *transforms, const uint32_t *colors, int count);
// То же, но с явным режимом смешивания для всего пакета (R2DBlendMode).
// r2d_batch_submit — это вызов с R2D_BLEND_ALPHA, поведение прежнее.
int  r2d_batch_submit_blend(R2DRenderer *r, const float *transforms, const uint32_t *colors,
                            int count, int blend);
int  r2d_batch_count(const R2DRenderer *r);

// Имя режима ("alpha"/"add"/"multiply"/"none") -> R2DBlendMode.
// Пустая строка/NULL — ALPHA (как без аргумента), неизвестное имя — -1.
int  r2d_blend_from_name(const char *name);

// --- Вывод ------------------------------------------------------------------
// Заливает накопленный батч в GPU-буферы (copy pass). Вызывать ДО render pass.
void r2d_render_upload(R2DRenderer *r, SDL_GPUCommandBuffer *cmd);
// Рисует батч внутри уже открытого render pass.
void r2d_render_draw(R2DRenderer *r, SDL_GPURenderPass *pass);
// Пометить границу интерфейса: всё, что добавлено после, считается ui-слоем.
// Нужно, чтобы с пост-обработкой HUD рисовался поверх неё, а не под ней.
void r2d_render_mark_ui(R2DRenderer *r);
// Рисует только ui-слой (спрайты после границы). Треугольники (свет, VFX) —
// часть мира и в ui-слой не попадают.
void r2d_render_draw_ui(R2DRenderer *r, SDL_GPURenderPass *pass);
// Рисует только мир: спрайты до границы интерфейса и все треугольники.
void r2d_render_draw_world(R2DRenderer *r, SDL_GPURenderPass *pass);

// --- Пост-обработка ---------------------------------------------------------
// Включён ли пост: если да, кадр надо рисовать в offscreen-текстуру
// (r2d_render_scene_target), а затем наложить её на swapchain (r2d_render_post).
bool r2d_render_post_enabled(const R2DRenderer *r);
void r2d_render_set_post(R2DRenderer *r, const R2DPostParams *params);
const R2DPostParams *r2d_render_get_post(const R2DRenderer *r);
// Текстура сцены нужного размера; пересоздаётся при смене размера окна.
// NULL — создать не удалось (тогда рисуем напрямую в swapchain).
SDL_GPUTexture *r2d_render_scene_target(R2DRenderer *r, int w, int h);
// Полноэкранный проход на swapchain: сэмплирует текстуру сцены с эффектами.
void r2d_render_post(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass);

// --- JS-биндинги, которые живут в render.c ---------------------------------
// Вызывается из script.c при сборке объекта engine: сюда переезжают вызовы,
// которых нет в script.c (blend-режимы, render target), чтобы не плодить
// правки в одном общем файле.
void r2d_render_register_js(JSContext *ctx, JSValue engine);

#ifdef __cplusplus
}
#endif
