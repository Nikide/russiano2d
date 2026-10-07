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
    // p5 — свечение (bloom). Порог и сила размытия приходят из JS,
    // bloom_ready заполняет C: 1 — размытая текстура готова и привязана.
    float bloom_threshold;  // порог яркости; <= 0 — 0.75 по умолчанию
    float bloom_radius;     // сила размытия; <= 0 — 1 по умолчанию
    float bloom_ready;      // только чтение: буферы свечения готовы
    float _pad;
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
    uint8_t  fx;       // индекс в таблице шейдеров узла; 0 — обычный спрайт
} R2DDrawCmd;

// Шейдер узла: вид эффекта и его параметры. Юниформа шейдера — два vec4,
// раскладка совпадает с push-константами в render.c.
typedef struct R2DNodeFx {
    int      kind;     // 0 — нет эффекта, 1 flash, 2 dissolve, 3 chroma, 4 wave
    int      user;     // индекс пользовательского шейдера, 0 — встроенный
    float    p1, p2, p3;
    uint32_t color;
} R2DNodeFx;

#define R2D_MAX_NODE_FX 64

// Пользовательский шейдер: имя (для справки и логов) и конвейеры под каждый
// режим смешивания. Фрагментный шейдер компилируется в рантайме, вершинный
// берётся встроенный — интерфейс у них общий.
typedef struct R2DUserShader {
    bool                     used;
    char                     name[32];
    SDL_GPUShader           *fragment;
    SDL_GPUGraphicsPipeline *pipelines[R2D_BLEND_COUNT];
} R2DUserShader;

// --- Render target игры (viewport) -------------------------------------------
// Кадр можно рисовать не в swapchain, а в свою текстуру: так делают шлейфы,
// накопление, порталы и «буфер прошлого кадра». Текстур две: в одну рисуется
// текущий кадр, вторая хранит прошлый — игрушка читает её как спрайт и не
// получает чтение-запись одной и той же текстуры в одном проходе.
#define R2D_MAX_VIEWPORTS 8

// --- Пользовательские шейдеры узлов ------------------------------------------
// Игра компилирует свой фрагментный шейдер в рантайме (glslang + spirv-cross)
// и получает конвейеры под каждый режим смешивания. Встроенные эффекты узла
// (flash/dissolve/chroma/wave) остаются отдельным конвейером: у них одна общая
// таблица параметров, а у пользовательских шейдеров — своя на каждый.
#define R2D_MAX_USER_SHADERS 16

typedef struct R2DViewport {
    bool            used;
    SDL_GPUTexture *target;   // куда рисуется текущий кадр
    SDL_GPUTexture *history;  // прошлый кадр: его игра рисует как спрайт
    int             w, h;
    int             sprite;   // спрайт всей history-текстуры
} R2DViewport;

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
    // Конвейеры шейдеров узла: по одному на режим смешивания. Включаются,
    // только когда у спрайта есть эффект (.shader()).
    SDL_GPUGraphicsPipeline *fx_pipelines[R2D_BLEND_COUNT];
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

    // --- Шейдеры узлов ------------------------------------------------------
    // Таблица на кадр: узлов с эффектом мало, а параметры у них разные,
    // поэтому команда хранит не сами параметры, а индекс сюда.
    R2DNodeFx fx[R2D_MAX_NODE_FX];
    int       fx_count;

    // --- Пользовательские шейдеры -------------------------------------------
    R2DUserShader user_shaders[R2D_MAX_USER_SHADERS];
    int           user_shader_count;
    char          user_shader_error[1024];
    uint8_t   batch_fx;      // индекс для следующей r2d_batch_add

    // --- Render target игры -------------------------------------------------
    R2DViewport viewports[R2D_MAX_VIEWPORTS];
    int         bound_viewport;   // -1 — кадр идёт как обычно

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

    // --- Свечение (bloom) ---------------------------------------------------
    // Честный bloom: яркий проход в половинном разрешении, затем разделяемое
    // размытие (горизонталь и вертикаль) и композит в пост-обработке.
    SDL_GPUGraphicsPipeline *bloom_pre_pipeline;   // порог + даунсэмпл
    SDL_GPUGraphicsPipeline *bloom_blur_pipeline;  // размытие по одной оси
    SDL_GPUTexture          *bloom_a;
    SDL_GPUTexture          *bloom_b;
    int    bloom_w, bloom_h;
    SDL_GPUTexture          *bloom_result;    // что уходит в пост как u_bloom
    SDL_GPUSampler          *linear_sampler;  // линейная фильтрация для размытия
    SDL_GPUTexture          *black_texture;   // 1×1 чёрная заглушка для u_bloom

    // --- Lightmap -----------------------------------------------------------
    // Свет копится в отдельной текстуре половинного разрешения, при желании
    // размывается и накладывается на сцену одним полноэкранным проходом.
    // Порядок отрисовки света перестаёт зависеть от порядка сцены, а половинное
    // разрешение с линейной фильтрацией само даёт мягкую кромку.
    bool            lightmap_on;
    float           lightmap_intensity;   // множитель силы света в композите
    float           lightmap_soft;        // сила размытия карты света
    bool            lightmap_used;        // в этом кадре свет ушёл в текстуру
    SDL_GPUTexture *light_target;         // накопленный свет
    SDL_GPUTexture *light_blur;           // второй буфер для размытия
    int             light_w, light_h;
    SDL_GPUGraphicsPipeline *light_blur_pipeline;
    SDL_GPUGraphicsPipeline *light_composite_pipeline;

    // Треугольники света: тот же формат вершин, но свой список и свой проход.
    R2DVertex   *light_vertices;
    int          light_vertex_count;
    int          light_vertex_cap;
    R2DTriBatch *light_batches;
    int          light_batch_count;
    int          light_batch_cap;
    int          light_index_start;   // первый индекс диапазона в общем IB

    // Граница интерфейса в списке команд: JS помечает её перед отдачей
    // ui-спрайтов, чтобы с постом HUD рисовался поверх обработки, а не под ней.
    int ui_cmd_start;

    // Статистика текущего кадра
    int    stat_draws;
    int    stat_passes;    // полноэкранных проходов (пост + свечение)
    int    stat_fx_cmds;   // спрайтов, нарисованных шейдером узла
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

// Текстура из пикселей в памяти (RGBA8). Нужна подсистемам, которые рисуют
// сами: атлас глифов (src/font.c), процедурный пиксель-арт. Возвращает id
// текстуры (>= 0) или -1. Уже созданную текстуру можно обновить частично —
// `r2d_texture_upload_region` пишет прямоугольник (x, y, w, h) из буфера с
// шагом строк pitch байт.
int  r2d_texture_create_rgba(R2DRenderer *r, const void *pixels, int w, int h);
bool r2d_texture_upload_region(R2DRenderer *r, int id, int x, int y, int w, int h,
                               const void *pixels, int pitch);

// --- Спрайты ----------------------------------------------------------------
// Регистрирует прямоугольник внутри текстуры и возвращает его id.
int  r2d_sprite_create(R2DRenderer *r, int texture, float sx, float sy, float sw, float sh);
bool r2d_sprite_alive(const R2DRenderer *r, int id);

// --- Батч текущего кадра ----------------------------------------------------
void r2d_render_begin_frame(R2DRenderer *r, int screen_w, int screen_h);
void r2d_batch_add(R2DRenderer *r, int sprite, float x, float y, float w, float h,
                    float angle, uint32_t color);

// --- Шейдеры узлов ----------------------------------------------------------
// Таблица эффектов сбрасывается каждый кадр (r2d_render_begin_frame), а
// заполняет её JS вызовом engine.defineSpriteFx(index, kind, p1, p2, p3, color).
// Индекс — от 1: ноль означает «обычный спрайт» и в таблице не хранится.
bool r2d_render_fx_define(R2DRenderer *r, int index, int kind,
                          float p1, float p2, float p3, uint32_t color,
                          int user_shader);

// --- Пользовательские шейдеры -----------------------------------------------
// Компиляция GLSL в рантайме (недоступна при R2D_ENABLE_LIVE_SHADERS=OFF).
int  r2d_render_user_shader_define(R2DRenderer *r, const char *name, const char *source);
const char *r2d_render_user_shader_error(const R2DRenderer *r);
int  r2d_render_user_shader_count(const R2DRenderer *r);
bool r2d_render_user_shader_supported(void);
const char *r2d_render_user_shader_preamble(void);
// Пакет спрайтов с эффектом: fx — массив индексов на каждый спрайт (может
// быть NULL — тогда весь пакет идёт обычным конвейером).
int r2d_batch_submit_fx(R2DRenderer *r, const float *transforms, const uint32_t *colors,
                        const int32_t *fx, int count, int blend);
void r2d_batch_rect(R2DRenderer *r, float x, float y, float w, float h, uint32_t color);

// Добавляет треугольники одним вызовом. verts — stride 6:
//   x, y (в пикселях ЛОГИЧЕСКОГО экрана), r, g, b, a (0..255).
// vertex_count должен быть кратен 3.
void r2d_batch_triangles(R2DRenderer *r, const float *verts, int vertex_count);

// То же, но для света lightmap: треугольники копятся в отдельном списке и
// рисуются не в сцену, а в текстуру света (r2d_render_draw_lights).
void r2d_batch_light_triangles(R2DRenderer *r, const float *verts, int vertex_count);
void r2d_batch_light_triangles_blend(R2DRenderer *r, const float *verts,
                                     int vertex_count, int blend);

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
void r2d_render_draw(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass);
// Пометить границу интерфейса: всё, что добавлено после, считается ui-слоем.
// Нужно, чтобы с пост-обработкой HUD рисовался поверх неё, а не под ней.
void r2d_render_mark_ui(R2DRenderer *r);
// Рисует только ui-слой (спрайты после границы). Треугольники (свет, VFX) —
// часть мира и в ui-слой не попадают.
void r2d_render_draw_ui(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass);
// Рисует только мир: спрайты до границы интерфейса и все треугольники.
void r2d_render_draw_world(R2DRenderer *r, SDL_GPUCommandBuffer *cmd, SDL_GPURenderPass *pass);

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

// --- Свечение (bloom) -------------------------------------------------------
// Свечение — отдельные проходы, а не выборки в пост-обработке: яркий проход
// с понижением разрешения (порог с мягким коленом), затем разделяемое
// размытие по горизонтали и вертикали. Результат уходит в пост как u_bloom.
//
// r2d_render_bloom вызывается между проходом сцены и проходом пост-обработки:
// вложить проходы друг в друга нельзя, поэтому буферы и пайплайны готовятся
// заранее (r2d_render_bloom_ready), а рисует их эта функция.
bool r2d_render_bloom_ready(R2DRenderer *r, int w, int h);
bool r2d_render_bloom(R2DRenderer *r, SDL_GPUCommandBuffer *cmd);

// --- Lightmap ---------------------------------------------------------------
// Свет (аддитивные треугольники) копится в отдельной текстуре половинного
// разрешения, при желании размывается и накладывается на сцену одним
// полноэкранным проходом. Так порядок света перестаёт зависеть от порядка
// сцены, а половинное разрешение даёт мягкую кромку.
//
// Порядок вызовов в кадре: r2d_render_draw_lights — отдельным проходом ПОСЛЕ
// r2d_render_upload и до прохода сцены; r2d_render_light_composite — в конце
// прохода сцены, после мира и до интерфейса.
bool r2d_render_lightmap_enabled(const R2DRenderer *r);
void r2d_render_lightmap_set(R2DRenderer *r, bool on, float intensity, float soft);
bool r2d_render_draw_lights(R2DRenderer *r, SDL_GPUCommandBuffer *cmd);
void r2d_render_light_composite(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                SDL_GPURenderPass *pass);

// --- Render target игры -----------------------------------------------------
// Текстура связанного viewport'а (NULL — кадр идёт как обычно) и функция
// «показать кадр»: копирует его в swapchain и в историю для следующего кадра.
SDL_GPUTexture *r2d_render_viewport_target(R2DRenderer *r);
bool r2d_render_viewport_present(R2DRenderer *r, SDL_GPUCommandBuffer *cmd,
                                 SDL_GPUTexture *swapchain, int w, int h);

// --- JS-биндинги, которые живут в render.c ---------------------------------
// Вызывается из script.c при сборке объекта engine: сюда переезжают вызовы,
// которых нет в script.c (blend-режимы, render target), чтобы не плодить
// правки в одном общем файле.
void r2d_render_register_js(JSContext *ctx, JSValue engine);

#ifdef __cplusplus
}
#endif
