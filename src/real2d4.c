// ===========================================================================
// Real2D v4 — детерминированный CPU layered warp-рендер персонажа.
//
// Стадия A (head-only): полный круг yaw, pitch = 0, 12 geometry anchors,
// Fourier K = 3, L = 0. Кадр собирается инверсно-барицентрической
// растеризацией РЕАЛЬНЫХ texels атласа: cage деформируется по вычисленным
// параметрам патча, mesh-вершины берутся из барицентрических привязок,
// видимость задаётся гейтами-кольцами, детали лица отсекаются маской лица,
// порядок слоёв — по псевдоглубине. Готовых полнофигурных кадров в контейнере
// нет и быть не может: каждый непустой пиксель объясняется цепочкой
// patch → треугольник → UV → texel атласа (см. debugProvenance).
//
// Контейнер `.r2d4` — ZIP store-only с фиксированными именами:
//   manifest.json, atlas/atlas_00.png, geometry/*.f32|.u32
// Загрузчик ограничивает число записей и размеры, запрещает traversal и
// дубликаты, проверяет CRC32 каждой секции и конечность чисел.
//
// Спецификация: demos/real2d/REAL2D_V4_SPEC.md. Границы стадии — честные:
// pitch не вход (OUT_OF_DOMAIN), полнотелого персонажа здесь нет.
// ===========================================================================
#include "real2d4.h"
#include "script.h"
#include "payload.h"
#include "json.h"
#include "rotsprite3.h"
#include "r2d.h"

#include <SDL3/SDL.h>
#include <SDL3_image/SDL_image.h>

#include <math.h>
#include <stdlib.h>
#include <string.h>

// --- 1. Константы и типы ----------------------------------------------------

#define R2D4_MAX_ASSETS 4
// Полный персонаж: 12 yaw-колонок × ~22 семантические детали ≈ 265 патчей.
// Память: base_area[R2D4_MAX_MESH_VERTS] на патч ≈ 2 КБ → ~1 МБ на предел.
#define R2D4_MAX_PATCHES 512
// Полный персонаж: 26 колец (голова 14 + тело/одежда 12). Запас до 64.
#define R2D4_MAX_RINGS 64
#define R2D4_MAX_ENTRIES 32          // записей ZIP в контейнере
#define R2D4_MAX_RING_ENTRIES 16
#define R2D4_MAX_NAME 160
#define R2D4_MAX_SECTION (32u << 20)  // потолок на секцию контейнера
#define R2D4_MAX_MESH_VERTS 512       // вершин mesh на патч
#define R2D4_CANVAS_MIN 128
#define R2D4_CANVAS_MAX 1024
#define R2D4_CULL_THRESHOLD (1.0f / 1024.0f)
#define R2D4_MIN_AREA_RATIO 0.05f

// Фазовые замеры кадра: без них «стало быстрее» — догадка, а не факт
// (правило 6). Значения отдаются структурно через info().ms.
static double r2d4_now_ms(void)
{
    static Uint64 freq;
    if (!freq) freq = SDL_GetPerformanceFrequency();
    return (double)SDL_GetPerformanceCounter() * 1000.0 / (double)freq;
}

enum { R2D4_PHASE_CLEAR = 0, R2D4_PHASE_EVAL, R2D4_PHASE_RASTER,
       R2D4_PHASE_COMPOSITE, R2D4_PHASE_ENCODE, R2D4_PHASE_UPLOAD, R2D4_PHASE_COUNT };
static const char *const r2d4_phase_names[R2D4_PHASE_COUNT] = {
    "clear", "evaluate", "raster", "composite", "encode", "upload" };

typedef struct { float x, y; } R2d4V2;


typedef struct {
    char id[48];
    int owner_group;          // 0 face, 1 eye, 2 eyelid, 3 nose, 4 mouth, 5 bangs, 6 hair_back, 7 lock
    int mirror;
    int clip_face;
    int state_gate;           // 0 нет, 1 blink, 2 mouth_open, 3 mouth_closed
    // Видимость по yaw (SPEC §7): деталь живёт в окне вокруг center_deg с
    // полной видимостью до half_deg и затуханием fade_deg. has_visibility == 0
    // означает «видима всегда».
    int has_clip_rect;        // 1 — деталь обрезается прямоугольником канваса
    float clip_rect[4];       // [x0, y0, x1, y1] в единицах H от начала координат
    int has_visibility;
    float vis_center_deg, vis_half_deg, vis_fade_deg;
    float depth;
    float rect[4];            // padded rect в texels атласа
    float scale_px;           // пикселей атласа на единицу H у этого патча
    float anchor[2];
    int vert_offset, vert_count;
    int uv_offset;
    int tri_offset, tri_count;
    int bind_offset;
    int cage_offset, cage_count;
    int ring, ring_entry;     // где патч виден (-1 — нигде)
    float base_area[R2D4_MAX_MESH_VERTS]; // базовая площадь треугольника (для validator'а)
} R2d4Patch;

typedef struct {
    int patch;
    float a, b;               // начало и конец записи кольца, градусы
} R2d4RingEntry;

typedef struct {
    int closed;
    float fade;
    int count;
    R2d4RingEntry entries[R2D4_MAX_RING_ENTRIES];
} R2d4Ring;

typedef struct {
    float x, y, u, v;
} R2d4Vert;

typedef struct R2d4Asset {
    bool used;
    char path[1024];

    // атлас: straight-alpha sRGB, RGBA8
    uint8_t *atlas;
    int atlas_w, atlas_h;
    uint8_t *atlas_override;   // мутация источника для доказательных тестов

    // секции контейнера (владение)
    float *verts;  int vert_count;
    float *uvs;    int uv_count;
    uint32_t *tris; int tri_count;
    uint32_t *bind_tri; int bind_count;
    float *bind_w;
    float *cage;   int cage_count;
    float *manifold; int manifold_count;

    int dim, rank, features, yaw_K;
    float canvas_unit_px, origin[2];
    int canvas_w, canvas_h;       // текущий размер растра (совпадает с текстурой)
    int default_size;             // размер из манифеста

    R2d4Patch patches[R2D4_MAX_PATCHES];
    int patch_count;
    R2d4Ring rings[R2D4_MAX_RINGS];
    int ring_count;

    // рабочая память кадра
    float *canvas;             // premultiplied linear RGBA, canvas_w*canvas_h*4
    float *layer;              // premultiplied linear RGBA текущего патча
    float *clip;               // покрытие лица (маска окклюзии)
    float *group;              // накопитель группы лиц: premultiplied linear RGBA
    int group_bbox[4];
    bool group_dirty;
    float *cover;              // счётчик записей (проверка fill rule)
    uint8_t *rgba;             // выход: sRGB8 straight alpha
    int layer_bbox[4];         // где слой был записан в прошлый раз
    int clip_bbox[4];
    int dirty[4];              // что перерисовано в этом кадре
    int prev_dirty[4];         // что было перерисовано в прошлом (для очистки и загрузки)
    int prev_clip[4];
    int prev_group[4];

    uint16_t *prov_patch;      // provenance: индекс патча+1 (0 — пусто)
    uint16_t *prov_tri;
    bool prov_alloc;
    int prov_size;             // ширина растра, под который выделены буферы
    int prov_h;                // высота того же растра

    int texture, sprite, tex_size, tex_h;

    // факты последнего кадра (правило 8: структурная диагностика)
    int last_patches_drawn, last_tris_drawn, last_pixels, last_fold_rejects;
    double last_ms[R2D4_PHASE_COUNT];
    long long dbg_tests, dbg_hits, dbg_tris;   // сколько пикселей проверено/записано
    float last_max_cover;
    int declared_w, declared_h;   // размер канваса из манифеста (аспект кадра)
    float last_yaw;
    char last_error[256];
} R2d4Asset;

static R2d4Asset *g_assets[R2D4_MAX_ASSETS];

// --- 2. Утилиты ------------------------------------------------------------

static uint32_t rd_u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint16_t rd_u16(const uint8_t *p)
{
    return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t crc_table[256];
static bool crc_ready;


static void crc_init(void)
{
    if (crc_ready) return;
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t c = i;
        for (int k = 0; k < 8; ++k) c = (c & 1u) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        crc_table[i] = c;
    }
    crc_ready = true;
}

static uint32_t crc32_of(const uint8_t *data, size_t size)
{
    crc_init();
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < size; ++i) c = crc_table[(c ^ data[i]) & 0xFFu] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}

static float read_f32(const uint8_t *p)
{
    float v;
    memcpy(&v, p, sizeof v);
    return v;
}

static void srgb_tables_init(void);

// --- 3. ZIP store-only: поиск и проверка записей ---------------------------

typedef struct {
    const uint8_t *data;
    size_t size;
} R2d4Slice;

static bool zip_find(const uint8_t *bytes, size_t size, const char *want,
                     R2d4Slice *out, char *err, size_t err_size)
{
    if (size < 22) { snprintf(err, err_size, "контейнер короче 22 байт"); return false; }
    size_t low = size > (65557u) ? size - 65557u : 0;
    size_t eocd = SIZE_MAX;
    for (size_t i = size - 22 + 1; i-- > low; ) {
        if (rd_u32(bytes + i) == 0x06054b50u) { eocd = i; break; }
    }
    if (eocd == SIZE_MAX) { snprintf(err, err_size, "нет конца центрального каталога"); return false; }
    int count = rd_u16(bytes + eocd + 10);
    uint32_t cd_size = rd_u32(bytes + eocd + 12);
    uint32_t cd_off = rd_u32(bytes + eocd + 16);
    if (count <= 0 || count > R2D4_MAX_ENTRIES) {
        snprintf(err, err_size, "записей в контейнере %d (предел %d)", count, R2D4_MAX_ENTRIES);
        return false;
    }
    if ((size_t)cd_off + cd_size > size) { snprintf(err, err_size, "каталог выходит за файл"); return false; }

    char seen[R2D4_MAX_ENTRIES][R2D4_MAX_NAME];
    int seen_count = 0;
    const uint8_t *p = bytes + cd_off;
    const uint8_t *cd_end = bytes + cd_off + cd_size;
    for (int i = 0; i < count; ++i) {
        if (p + 46 > cd_end) { snprintf(err, err_size, "каталог обрезан"); return false; }
        if (rd_u32(p) != 0x02014b50u) { snprintf(err, err_size, "битая запись каталога"); return false; }
        int method = rd_u16(p + 10);
        uint32_t csize = rd_u32(p + 20);
        uint32_t usize = rd_u32(p + 24);
        int nlen = rd_u16(p + 28);
        int elen = rd_u16(p + 30);
        int clen = rd_u16(p + 32);
        uint32_t local = rd_u32(p + 42);
        p += 46;
        if (nlen <= 0 || nlen >= R2D4_MAX_NAME || p + nlen > cd_end) {
            snprintf(err, err_size, "недопустимое имя записи"); return false;
        }
        char name[R2D4_MAX_NAME];
        memcpy(name, p, (size_t)nlen);
        name[nlen] = 0;
        if (name[0] == '/' || name[0] == '\\' || strstr(name, "..") || strchr(name, '\\')) {
            snprintf(err, err_size, "запрещённый путь в контейнере: %s", name); return false;
        }
        for (int s = 0; s < seen_count; ++s) {
            if (strcmp(seen[s], name) == 0) {
                snprintf(err, err_size, "дубликат записи: %s", name); return false;
            }
        }
        strcpy(seen[seen_count++], name);
        if (method != 0) {
            snprintf(err, err_size, "запись %s сжата (нужен store)", name); return false;
        }
        if (csize != usize || csize > R2D4_MAX_SECTION) {
            snprintf(err, err_size, "недопустимый размер записи %s", name); return false;
        }
        if ((size_t)local + 30 > size || rd_u32(bytes + local) != 0x04034b50u) {
            snprintf(err, err_size, "битый локальный заголовок %s", name); return false;
        }
        int lnlen = rd_u16(bytes + local + 26);
        int lelen = rd_u16(bytes + local + 28);
        size_t data_off = (size_t)local + 30 + (size_t)lnlen + (size_t)lelen;
        if (data_off + csize > size) { snprintf(err, err_size, "данные %s выходят за файл", name); return false; }
        if (crc32_of(bytes + data_off, csize) != rd_u32(bytes + local + 14)) {
            snprintf(err, err_size, "не сходится CRC32 записи %s", name); return false;
        }
        if (strcmp(name, want) == 0) {
            out->data = bytes + data_off;
            out->size = csize;
            return true;
        }
        p += (size_t)nlen + (size_t)elen + (size_t)clen;
    }
    snprintf(err, err_size, "в контейнере нет записи %s", want);
    return false;
}

// --- 4. Разбор манифеста ---------------------------------------------------

static int group_from_name(const char *name)
{
    if (!name) return 0;
    if (strcmp(name, "face") == 0) return 0;
    if (strcmp(name, "eye") == 0) return 1;
    if (strcmp(name, "eyelid") == 0) return 2;
    if (strcmp(name, "nose") == 0) return 3;
    if (strcmp(name, "mouth") == 0) return 4;
    if (strcmp(name, "bangs") == 0) return 5;
    if (strcmp(name, "hair_back") == 0) return 6;
    if (strcmp(name, "lock") == 0) return 7;
    return 0;
}

static int state_from_name(const char *name)
{
    if (!name) return 0;
    if (strcmp(name, "blink") == 0) return 1;
    if (strcmp(name, "mouth_open") == 0) return 2;
    if (strcmp(name, "mouth_closed") == 0) return 3;
    return 0;
}

static void vec4_from_json(const R2dJson *v, float *out, int count, const float *fallback)
{
    for (int i = 0; i < count; ++i) {
        const R2dJson *item = r2d_json_at(v, i);
        out[i] = item ? (float)r2d_json_num(item, fallback[i]) : fallback[i];
    }
}

static bool copy_section_f32(R2d4Asset *a, const R2dJson *sections, const char *name,
                             const uint8_t *zip, size_t zip_size,
                             float **out, int *out_count, int expected_stride,
                             char *err, size_t err_size)
{
    const R2dJson *sec = r2d_json_get(sections, name);
    if (!sec) { snprintf(err, err_size, "в манифесте нет секции %s", name); return false; }
    const char *path = r2d_json_str(r2d_json_get(sec, "path"), NULL);
    int count = r2d_json_int(r2d_json_get(sec, "count"), -1);
    int stride = r2d_json_int(r2d_json_get(sec, "stride"), expected_stride);
    if (!path || count < 0 || stride != expected_stride) {
        snprintf(err, err_size, "секция %s: неверные count/stride", name); return false;
    }
    R2d4Slice slice;
    if (!zip_find(zip, zip_size, path, &slice, err, err_size)) return false;
    size_t need = (size_t)count * (size_t)stride * sizeof(float);
    if (slice.size != need) {
        snprintf(err, err_size, "секция %s: %zu байт вместо %zu", name, slice.size, need); return false;
    }
    float *data = (float *)malloc(need ? need : 1);
    if (!data) { snprintf(err, err_size, "нет памяти под %s", name); return false; }
    for (int i = 0; i < count * stride; ++i) {
        data[i] = read_f32(slice.data + (size_t)i * 4);
        if (!isfinite(data[i])) {
            free(data);
            snprintf(err, err_size, "секция %s содержит не-конечное значение", name);
            return false;
        }
    }
    *out = data;
    *out_count = count;
    return true;
}

static bool load_manifest(R2d4Asset *a, const uint8_t *zip, size_t zip_size, char *err, size_t err_size)
{
    R2d4Slice manifest;
    if (!zip_find(zip, zip_size, "manifest.json", &manifest, err, err_size)) return false;
    char *text = (char *)malloc(manifest.size + 1);
    if (!text) { snprintf(err, err_size, "нет памяти под манифест"); return false; }
    memcpy(text, manifest.data, manifest.size);
    text[manifest.size] = 0;

    char jerr[160];
    R2dJson *root = r2d_json_parse(text, jerr, sizeof jerr);
    free(text);
    if (!root) { snprintf(err, err_size, "манифест не разобран: %s", jerr); return false; }

    bool ok = false;
    do {
        const char *format = r2d_json_str(r2d_json_get(root, "format"), "");
        int version = r2d_json_int(r2d_json_get(root, "version"), 0);
        if (strcmp(format, "r2d4") != 0 || version != 4) {
            snprintf(err, err_size, "формат %s версии %d не поддерживается", format, version);
            break;
        }
        const R2dJson *canvas = r2d_json_get(root, "canvas");
        if (!canvas) { snprintf(err, err_size, "в манифесте нет canvas"); break; }
        a->declared_w = r2d_json_int(r2d_json_get(canvas, "width"), 0);
        a->declared_h = r2d_json_int(r2d_json_get(canvas, "height"), 0);
        a->default_size = a->declared_w;
        a->canvas_unit_px = (float)r2d_json_num(r2d_json_get(canvas, "unit_px"), 0.0);
        vec4_from_json(r2d_json_get(canvas, "origin"), a->origin, 2, (const float[]){0.0f, 0.0f});
        if (a->declared_w < R2D4_CANVAS_MIN || a->declared_w > R2D4_CANVAS_MAX ||
            a->declared_h < R2D4_CANVAS_MIN || a->declared_h > R2D4_CANVAS_MAX ||
            a->declared_w > R2D4_CANVAS_MAX * 2 ||
            a->canvas_unit_px <= 0.0f) {
            snprintf(err, err_size, "недопустимый canvas в манифесте"); break;
        }
        const R2dJson *manifold = r2d_json_get(root, "manifold");
        if (!manifold) { snprintf(err, err_size, "в манифесте нет manifold"); break; }
        a->dim = r2d_json_int(r2d_json_get(manifold, "dim"), 0);
        a->rank = r2d_json_int(r2d_json_get(manifold, "rank"), 0);
        a->features = r2d_json_int(r2d_json_get(manifold, "features"), 0);
        a->yaw_K = r2d_json_int(r2d_json_get(manifold, "yaw_K"), 0);
        if (a->dim <= 0 || a->rank <= 0 || a->features != 2 * a->yaw_K + 1) {
            snprintf(err, err_size, "недопустимый manifold (dim=%d rank=%d features=%d)",
                     a->dim, a->rank, a->features);
            break;
        }

        const R2dJson *sections = r2d_json_get(root, "sections");
        if (!sections ||
            !copy_section_f32(a, sections, "verts", zip, zip_size, &a->verts, &a->vert_count, 2, err, err_size) ||
            !copy_section_f32(a, sections, "uvs", zip, zip_size, &a->uvs, &a->uv_count, 2, err, err_size) ||
            !copy_section_f32(a, sections, "cage", zip, zip_size, &a->cage, &a->cage_count, 2, err, err_size) ||
            !copy_section_f32(a, sections, "bind_w", zip, zip_size, &a->bind_w, &a->bind_count, 3, err, err_size) ||
            !copy_section_f32(a, sections, "manifold", zip, zip_size, &a->manifold, &a->manifold_count, 1, err, err_size)) {
            break;
        }
        if (a->manifold_count != a->dim + a->dim * a->rank + a->rank * a->features) {
            snprintf(err, err_size, "манифолд: %d чисел вместо %d", a->manifold_count,
                     a->dim + a->dim * a->rank + a->rank * a->features);
            break;
        }
        {
            const R2dJson *sec = r2d_json_get(sections, "tris");
            const char *path = sec ? r2d_json_str(r2d_json_get(sec, "path"), NULL) : NULL;
            int count = sec ? r2d_json_int(r2d_json_get(sec, "count"), -1) : -1;
            R2d4Slice slice;
            if (!path || count < 0 || !zip_find(zip, zip_size, path, &slice, err, err_size)) break;
            if (slice.size != (size_t)count * 3 * sizeof(uint32_t)) {
                snprintf(err, err_size, "секция tris: неверный размер"); break;
            }
            a->tris = (uint32_t *)malloc(slice.size ? slice.size : 1);
            if (!a->tris) { snprintf(err, err_size, "нет памяти под tris"); break; }
            for (int i = 0; i < count * 3; ++i) a->tris[i] = rd_u32(slice.data + (size_t)i * 4);
            a->tri_count = count;
        }
        {
            const R2dJson *sec = r2d_json_get(sections, "bind_tri");
            const char *path = sec ? r2d_json_str(r2d_json_get(sec, "path"), NULL) : NULL;
            int count = sec ? r2d_json_int(r2d_json_get(sec, "count"), -1) : -1;
            R2d4Slice slice;
            if (!path || count < 0 || !zip_find(zip, zip_size, path, &slice, err, err_size)) break;
            if (slice.size != (size_t)count * 3 * sizeof(uint32_t)) {
                snprintf(err, err_size, "секция bind_tri: неверный размер"); break;
            }
            a->bind_tri = (uint32_t *)malloc(slice.size ? slice.size : 1);
            if (!a->bind_tri) { snprintf(err, err_size, "нет памяти под bind_tri"); break; }
            for (int i = 0; i < count * 3; ++i) a->bind_tri[i] = rd_u32(slice.data + (size_t)i * 4);
            a->bind_count = count;
        }
        if (a->bind_count != a->vert_count) {
            snprintf(err, err_size, "привязок %d, вершин mesh %d — не совпадает", a->bind_count, a->vert_count);
            break;
        }

        // Атлас: PNG внутри контейнера.
        R2d4Slice png;
        if (!zip_find(zip, zip_size, "atlas/atlas_00.png", &png, err, err_size)) break;
        SDL_IOStream *io = SDL_IOFromConstMem(png.data, png.size);
        SDL_Surface *image = io ? IMG_LoadPNG_IO(io) : NULL;
        if (io) SDL_CloseIO(io);
        if (!image) { snprintf(err, err_size, "атлас не декодирован"); break; }
        SDL_Surface *rgba = SDL_ConvertSurface(image, SDL_PIXELFORMAT_RGBA32);
        SDL_DestroySurface(image);
        if (!rgba) { snprintf(err, err_size, "атлас не приведён к RGBA8"); break; }
        a->atlas_w = rgba->w;
        a->atlas_h = rgba->h;
        a->atlas = (uint8_t *)malloc((size_t)rgba->w * rgba->h * 4);
        if (!a->atlas) { SDL_DestroySurface(rgba); snprintf(err, err_size, "нет памяти под атлас"); break; }
        for (int y = 0; y < rgba->h; ++y) {
            memcpy(a->atlas + (size_t)y * rgba->w * 4,
                   (const uint8_t *)rgba->pixels + (size_t)y * rgba->pitch,
                   (size_t)rgba->w * 4);
        }
        SDL_DestroySurface(rgba);

        // Патчи.
        const R2dJson *patches = r2d_json_get(root, "patches");
        int patch_count = r2d_json_size(patches);
        if (patch_count <= 0 || patch_count > R2D4_MAX_PATCHES) {
            snprintf(err, err_size, "патчей %d (предел %d)", patch_count, R2D4_MAX_PATCHES);
            break;
        }
        a->patch_count = patch_count;
        bool patches_ok = true;
        for (int i = 0; i < patch_count && patches_ok; ++i) {
            const R2dJson *p = r2d_json_at(patches, i);
            R2d4Patch *patch = &a->patches[i];
            const char *id = r2d_json_str(r2d_json_get(p, "id"), "");
            if (!*id || strlen(id) >= sizeof patch->id) {
                snprintf(err, err_size, "патч %d без корректного id", i); patches_ok = false; break;
            }
            strcpy(patch->id, id);
            patch->owner_group = group_from_name(r2d_json_str(r2d_json_get(p, "owner_group"), NULL));
            patch->mirror = r2d_json_bool(r2d_json_get(p, "mirror"), false) ? 1 : 0;
            patch->clip_face = strcmp(r2d_json_str(r2d_json_get(p, "clip_to"), ""), "face") == 0;
            patch->state_gate = state_from_name(r2d_json_str(r2d_json_get(p, "state_gate"), NULL));
            const R2dJson *clip_rect = r2d_json_get(p, "clip_rect");
            if (clip_rect && clip_rect->type == R2D_JSON_ARR) {
                patch->has_clip_rect = 1;
                vec4_from_json(clip_rect, patch->clip_rect, 4, (const float[]){-1e9f, -1e9f, 1e9f, 1e9f});
            }
            const R2dJson *vis = r2d_json_get(p, "visibility");
            if (vis && vis->type == R2D_JSON_OBJ) {
                patch->has_visibility = 1;
                patch->vis_center_deg = (float)r2d_json_num(r2d_json_get(vis, "center_deg"), 0.0);
                patch->vis_half_deg = (float)r2d_json_num(r2d_json_get(vis, "half_deg"), 180.0);
                patch->vis_fade_deg = (float)r2d_json_num(r2d_json_get(vis, "fade_deg"), 0.0);
            }
            patch->depth = (float)r2d_json_num(r2d_json_get(p, "depth"), 0.0);
            vec4_from_json(r2d_json_get(p, "rect_padded"), patch->rect, 4, (const float[]){0, 0, 0, 0});
            patch->scale_px = (float)r2d_json_num(r2d_json_get(p, "scale_px_per_unit"), 0.0);
            vec4_from_json(r2d_json_get(p, "anchor_px"), patch->anchor, 2, (const float[]){0, 0});
            patch->vert_offset = r2d_json_int(r2d_json_get(p, "vert_offset"), -1);
            patch->vert_count = r2d_json_int(r2d_json_get(p, "vert_count"), 0);
            patch->uv_offset = r2d_json_int(r2d_json_get(p, "uv_offset"), -1);
            patch->tri_offset = r2d_json_int(r2d_json_get(p, "tri_offset"), -1);
            patch->tri_count = r2d_json_int(r2d_json_get(p, "tri_count"), 0);
            patch->bind_offset = r2d_json_int(r2d_json_get(p, "bind_offset"), -1);
            patch->cage_offset = r2d_json_int(r2d_json_get(p, "cage_offset"), -1);
            patch->cage_count = r2d_json_int(r2d_json_get(p, "cage_count"), 0);
            patch->ring = patch->ring_entry = -1;
            if (patch->vert_count <= 0 || patch->vert_count > R2D4_MAX_MESH_VERTS ||
                patch->tri_count <= 0 || patch->tri_count > R2D4_MAX_MESH_VERTS ||
                patch->vert_offset < 0 || patch->uv_offset < 0 || patch->tri_offset < 0 ||
                patch->bind_offset < 0 || patch->cage_offset < 0 || patch->cage_count < 3 ||
                patch->cage_count > R2D4_MAX_MESH_VERTS ||
                patch->vert_offset + patch->vert_count > a->vert_count ||
                patch->uv_offset + patch->vert_count > a->uv_count ||
                patch->tri_offset + patch->tri_count > a->tri_count ||
                patch->bind_offset + patch->vert_count > a->bind_count ||
                patch->cage_offset + patch->cage_count > a->cage_count ||
                patch->scale_px <= 0.0f ||
                patch->rect[2] <= patch->rect[0] || patch->rect[3] <= patch->rect[1] ||
                patch->rect[0] < 0.0f || patch->rect[1] < 0.0f ||
                patch->rect[2] > (float)a->atlas_w || patch->rect[3] > (float)a->atlas_h) {
                snprintf(err, err_size, "патч %s: выход за границы секций или атласа", patch->id);
                patches_ok = false; break;
            }
            for (int t = 0; t < patch->tri_count; ++t) {
                uint32_t ia = a->tris[(patch->tri_offset + t) * 3 + 0];
                uint32_t ib = a->tris[(patch->tri_offset + t) * 3 + 1];
                uint32_t ic = a->tris[(patch->tri_offset + t) * 3 + 2];
                if (ia >= (uint32_t)patch->vert_count || ib >= (uint32_t)patch->vert_count ||
                    ic >= (uint32_t)patch->vert_count) {
                    snprintf(err, err_size, "патч %s: индекс вершины вне диапазона", patch->id);
                    patches_ok = false; break;
                }
                // Базовая площадь — эталон для validator'а вывернутых треугольников.
                const float *v = &a->verts[(patch->vert_offset + (int)ia) * 2];
                const float *w = &a->verts[(patch->vert_offset + (int)ib) * 2];
                const float *u = &a->verts[(patch->vert_offset + (int)ic) * 2];
                patch->base_area[t] = 0.5f * ((w[0] - v[0]) * (u[1] - v[1]) - (w[1] - v[1]) * (u[0] - v[0]));
            }
            if (!patches_ok) break;
        }
        if (!patches_ok) break;

        // Кольца видимости: записи ссылаются на патчи по id.
        const R2dJson *rings = r2d_json_get(root, "rings");
        int ring_count = 0;
        if (rings && rings->type == R2D_JSON_OBJ) ring_count = rings->count;
        if (ring_count <= 0 || ring_count > R2D4_MAX_RINGS) {
            snprintf(err, err_size, "колец видимости %d", ring_count);
            break;
        }
        bool rings_ok = true;
        for (int r = 0; r < ring_count && rings_ok; ++r) {
            R2d4Ring *ring = &a->rings[r];
            const R2dJson *spec = rings->items[r];
            ring->closed = r2d_json_bool(r2d_json_get(spec, "closed"), false) ? 1 : 0;
            ring->fade = (float)r2d_json_num(r2d_json_get(spec, "fade"), 15.0);
            if (ring->fade <= 0.0f || ring->fade > 90.0f) {
                snprintf(err, err_size, "кольцо %s: недопустимая растушёвка", rings->keys[r]);
                rings_ok = false; break;
            }
            const R2dJson *entries = r2d_json_get(spec, "entries");
            int count = r2d_json_size(entries);
            if (count <= 0 || count > R2D4_MAX_RING_ENTRIES) {
                snprintf(err, err_size, "кольцо %s: записей %d", rings->keys[r], count);
                rings_ok = false; break;
            }
            ring->count = count;
            for (int e = 0; e < count && rings_ok; ++e) {
                const R2dJson *entry = r2d_json_at(entries, e);
                const char *pid = r2d_json_str(r2d_json_get(entry, "patch"), "");
                int found = -1;
                for (int i = 0; i < a->patch_count; ++i) {
                    if (strcmp(a->patches[i].id, pid) == 0) { found = i; break; }
                }
                if (found < 0) {
                    snprintf(err, err_size, "кольцо %s ссылается на неизвестный патч %s", rings->keys[r], pid);
                    rings_ok = false; break;
                }
                if (a->patches[found].ring >= 0) {
                    snprintf(err, err_size, "патч %s встречается более чем в одном кольце", pid);
                    rings_ok = false; break;
                }
                a->patches[found].ring = r;
                a->patches[found].ring_entry = e;
                ring->entries[e].patch = found;
                ring->entries[e].a = (float)r2d_json_num(r2d_json_get(entry, "a"), 0.0);
                ring->entries[e].b = (float)r2d_json_num(r2d_json_get(entry, "b"), 0.0);
                if (ring->entries[e].b < ring->entries[e].a) ring->entries[e].b += 360.0f;
            }
        }
        if (!rings_ok) break;
        a->ring_count = ring_count;
        ok = true;
    } while (0);

    r2d_json_free(root);
    return ok;
}

// --- 5. Манифолд, гейты, цветовые таблицы ----------------------------------

static float srgb_to_linear[256];
static uint8_t linear_to_srgb[4097];

static void srgb_tables_init(void)
{
    static bool ready;
    if (ready) return;
    for (int i = 0; i < 256; ++i) {
        float c = (float)i / 255.0f;
        srgb_to_linear[i] = (c <= 0.04045f) ? (c / 12.92f) : powf((c + 0.055f) / 1.055f, 2.4f);
    }
    for (int i = 0; i <= 4096; ++i) {
        float c = (float)i / 4096.0f;
        float s = (c <= 0.0031308f) ? (12.92f * c) : (1.055f * powf(c, 1.0f / 2.4f) - 0.055f);
        int v = (int)(s * 255.0f + 0.5f);
        linear_to_srgb[i] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
    }
    ready = true;
}

static void eval_fourier(float yaw, int K, float *out)
{
    out[0] = 1.0f;
    for (int k = 1; k <= K; ++k) {
        out[2 * k - 1] = cosf(k * yaw);
        out[2 * k] = sinf(k * yaw);
    }
}

// q(θ) = μ + B·a(θ), a_n = Σ_k c_nk F_k(θ). Спека §5: производные аналитические.
static void eval_manifold(const R2d4Asset *a, float yaw, float *q)
{
    float F[32];
    eval_fourier(yaw, a->yaw_K, F);
    float latent[32];
    const float *basis = a->manifold + a->dim;
    const float *coeff = basis + (size_t)a->dim * a->rank;
    for (int n = 0; n < a->rank; ++n) {
        const float *c = coeff + (size_t)n * a->features;
        float sum = 0.0f;
        for (int k = 0; k < a->features; ++k) sum += c[k] * F[k];
        latent[n] = sum;
    }
    for (int d = 0; d < a->dim; ++d) {
        float sum = a->manifold[d];
        const float *row = basis + (size_t)d * a->rank;
        for (int n = 0; n < a->rank; ++n) sum += row[n] * latent[n];
        q[d] = sum;
    }
}

static float smoothstep01(float t)
{
    if (t <= 0.0f) return 0.0f;
    if (t >= 1.0f) return 1.0f;
    return t * t * (3.0f - 2.0f * t);
}

// Круговая знаковая разность в градусах, [-180, 180).
static float angle_delta(float x, float a)
{
    float d = fmodf(x - a + 180.0f, 360.0f);
    if (d < 0.0f) d += 360.0f;
    return d - 180.0f;
}

// Вес записи кольца: растушёвка по краям отрезка [a, b] «вперёд по кругу».
//
// Расстояние считается В СИСТЕМЕ ОТРЕЗКА (forward от a), а не круговой
// разностью до b: у длинных записей (волосы сзади занимают 200°) круговая
// разность даёт «x позади b» и гейт обнуляется, хотя угол внутри отрезка.
// Соседние записи делят окно перехода, поэтому внутри кольца сумма весов = 1
// (спека §7 правило 5: один semantic feature не рисуется дважды).
static float ring_weight(const R2d4Ring *ring, int entry, float yaw_deg)
{
    const R2d4RingEntry *e = &ring->entries[entry];
    // Кольцо из одной записи — вырожденный partition-of-unity: делить не с
    // чем, вес обязан быть 1.0. Иначе up*smoothstep даёт 0.5 в самой
    // anchor-точке и кадр выходит полупрозрачным (SPEC §7).
    if (ring->count <= 1) return 1.0f;

    // ring->fade — ПОЛНАЯ ширина перехода в градусах (SPEC §18: 15°), поэтому
    // полуокно h = fade/2. Раньше fade трактовался как полуокно: тогда в самой
    // anchor-точке (середина дуги в 30°) up = smoothstep(0.5) = 0.5, вес не
    // доходил до 1, рисовались сразу две соседние колонки — это давало двойные
    // черты на переходах и общую бледность кадра.
    float h = 0.5f * ring->fade;
    if (h <= 0.0f) h = 1e-3f;
    float b = e->b;
    if (b < e->a) b += 360.0f;
    float delta = angle_delta(yaw_deg, e->a);
    float forward = (delta < 0.0f) ? delta + 360.0f : delta;   // [0, 360)
    float up = smoothstep01((forward + h) / (2.0f * h));
    float down = 1.0f - smoothstep01((forward - (b - e->a) + h) / (2.0f * h));
    return up * down;
}

// --- 6. Деформация и растеризация ------------------------------------------

static void patch_params(const float *q, int patch_index, float *dx, float *dy,
                         float *sx, float *sy, float *rot, float *weight,
                         float blink, float mouth)
{
    const float *p = q + patch_index * 5;
    *dx = p[0]; *dy = p[1]; *sx = p[2]; *sy = p[3]; *rot = p[4];
    (void)weight; (void)blink; (void)mouth;
}

static void sample_atlas(const R2d4Asset *a, const R2d4Patch *patch,
                         float u, float v, float out[4])
{
    const uint8_t *px = a->atlas_override ? a->atlas_override : a->atlas;
    float lo_x = patch->rect[0], hi_x = patch->rect[2] - 1.0f;
    float lo_y = patch->rect[1], hi_y = patch->rect[3] - 1.0f;
    float tx = u * (float)a->atlas_w - 0.5f;
    float ty = v * (float)a->atlas_h - 0.5f;
    if (tx < lo_x) tx = lo_x;
    if (tx > hi_x) tx = hi_x;
    if (ty < lo_y) ty = lo_y;
    if (ty > hi_y) ty = hi_y;
    int x0 = (int)floorf(tx), y0 = (int)floorf(ty);
    float fx = tx - (float)x0, fy = ty - (float)y0;
    if (x0 < (int)lo_x) x0 = (int)lo_x;
    if (y0 < (int)lo_y) y0 = (int)lo_y;
    int x1 = x0 + 1, y1 = y0 + 1;
    if (x1 > (int)hi_x) x1 = (int)hi_x;
    if (y1 > (int)hi_y) y1 = (int)hi_y;

    float acc[4] = {0, 0, 0, 0};
    const float wx[2] = {1.0f - fx, fx};
    const float wy[2] = {1.0f - fy, fy};
    for (int j = 0; j < 2; ++j) {
        int yy = j ? y1 : y0;
        for (int i = 0; i < 2; ++i) {
            int xx = i ? x1 : x0;
            const uint8_t *texel = px + ((size_t)yy * a->atlas_w + xx) * 4;
            float w = wx[i] * wy[j];
            float alpha = (float)texel[3] / 255.0f;
            acc[0] += w * srgb_to_linear[texel[0]] * alpha;
            acc[1] += w * srgb_to_linear[texel[1]] * alpha;
            acc[2] += w * srgb_to_linear[texel[2]] * alpha;
            acc[3] += w * alpha;
        }
    }
    out[0] = acc[0]; out[1] = acc[1]; out[2] = acc[2]; out[3] = acc[3];
}

static void layer_bbox_reset(R2d4Asset *a, int bbox[4])
{
    bbox[0] = a->canvas_w; bbox[1] = a->canvas_h; bbox[2] = -1; bbox[3] = -1;
}

static void layer_clear_bbox(R2d4Asset *a, int bbox[4])
{
    if (bbox[2] < bbox[0] || bbox[3] < bbox[1]) return;
    for (int y = bbox[1]; y <= bbox[3]; ++y) {
        memset(a->layer + ((size_t)y * a->canvas_w + bbox[0]) * 4, 0,
               (size_t)(bbox[2] - bbox[0] + 1) * 4 * sizeof(float));
        if (a->cover) {
            memset(a->cover + (size_t)y * a->canvas_w + bbox[0], 0,
                   (size_t)(bbox[2] - bbox[0] + 1) * sizeof(float));
        }
    }
}

// Инверсно-барицентрическая растеризация с правилом top-left: пиксель на
// общей кромке двух треугольников заполняется ровно один раз, поэтому швов нет.
static void raster_triangle(R2d4Asset *a, const R2d4Vert *v0, const R2d4Vert *v1,
                            const R2d4Vert *v2, int patch_index, int tri_index,
                            int bbox[4], long long *tests, long long *hits)
{
    float area = (v1->x - v0->x) * (v2->y - v0->y) - (v1->y - v0->y) * (v2->x - v0->x);
    if (fabsf(area) < 1e-9f) return;
    R2d4Vert p0 = *v0, p1 = *v1, p2 = *v2;
    if (area < 0.0f) { p1 = *v2; p2 = *v1; area = -area; }

    float minx = fminf(p0.x, fminf(p1.x, p2.x));
    float maxx = fmaxf(p0.x, fmaxf(p1.x, p2.x));
    float miny = fminf(p0.y, fminf(p1.y, p2.y));
    float maxy = fmaxf(p0.y, fmaxf(p1.y, p2.y));
    int x0 = (int)floorf(minx); if (x0 < 0) x0 = 0;
    int y0 = (int)floorf(miny); if (y0 < 0) y0 = 0;
    int x1 = (int)ceilf(maxx);  if (x1 > a->canvas_w - 1) x1 = a->canvas_w - 1;
    int y1 = (int)ceilf(maxy);  if (y1 > a->canvas_h - 1) y1 = a->canvas_h - 1;
    if (x1 < x0 || y1 < y0) return;

    const float e0dx = p2.x - p1.x, e0dy = p2.y - p1.y;
    const float e1dx = p0.x - p2.x, e1dy = p0.y - p2.y;
    const float e2dx = p1.x - p0.x, e2dy = p1.y - p0.y;
    // Top-left правило в экранных координатах (y вниз): нулевая кромка
    // принимается, если она верхняя (dy == 0, dx < 0) или левая (dy > 0).
    const bool a0 = (e0dy > 0.0f) || (e0dy == 0.0f && e0dx < 0.0f);
    const bool a1 = (e1dy > 0.0f) || (e1dy == 0.0f && e1dx < 0.0f);
    const bool a2 = (e2dy > 0.0f) || (e2dy == 0.0f && e2dx < 0.0f);
    const float inv_area = 1.0f / area;

    for (int y = y0; y <= y1; ++y) {
        float py = (float)y + 0.5f;
        for (int x = x0; x <= x1; ++x) {
            float px = (float)x + 0.5f;
            float w0 = (e0dx * (py - p1.y) - e0dy * (px - p1.x));
            float w1 = (e1dx * (py - p2.y) - e1dy * (px - p2.x));
            float w2 = (e2dx * (py - p0.y) - e2dy * (px - p0.x));
            ++*tests;
            bool inside = (w0 > 0.0f || (w0 == 0.0f && a0)) &&
                          (w1 > 0.0f || (w1 == 0.0f && a1)) &&
                          (w2 > 0.0f || (w2 == 0.0f && a2));
            if (!inside) continue;
            ++*hits;
            float b0 = w0 * inv_area, b1 = w1 * inv_area, b2 = w2 * inv_area;
            float u = b0 * p0.u + b1 * p1.u + b2 * p2.u;
            float v = b0 * p0.v + b1 * p1.v + b2 * p2.v;
            float color[4];
            sample_atlas(a, &a->patches[patch_index], u, v, color);
            float *dst = a->layer + ((size_t)y * a->canvas_w + x) * 4;
            dst[0] = color[0]; dst[1] = color[1]; dst[2] = color[2]; dst[3] = color[3];
            if (a->cover && color[3] > 0.0f) {
                float *cov = a->cover + (size_t)y * a->canvas_w + x;
                *cov += 1.0f;
            }
            // Provenance пишется только для НЕПУСТЫХ сэмплов: прозрачный texel
            // не объясняет пиксель, и запись «владельца» на нём делала бы карту
            // покрытия врущей (спека §17: цепочка объясняет непустой output).
            if (a->prov_alloc && a->prov_size == a->canvas_w && a->prov_h == a->canvas_h &&
                color[3] > 1.0f / 255.0f) {
                a->prov_patch[(size_t)y * a->canvas_w + x] = (uint16_t)(patch_index + 1);
                a->prov_tri[(size_t)y * a->canvas_w + x] = (uint16_t)tri_index;
            }
            if (x < bbox[0]) bbox[0] = x;
            if (y < bbox[1]) bbox[1] = y;
            if (x > bbox[2]) bbox[2] = x;
            if (y > bbox[3]) bbox[3] = y;
        }
    }
}

// --- 7. Кадр ---------------------------------------------------------------

static bool ensure_scratch(R2d4Asset *a, int width, int height)
{
    if (width < 1) width = 1;
    if (height < 1) height = 1;
    if (a->canvas_w == width && a->canvas_h == height && a->canvas) return true;
    size_t pixels = (size_t)width * (size_t)height;
    float *canvas = (float *)realloc(a->canvas, pixels * 4 * sizeof(float));
    float *layer = (float *)realloc(a->layer, pixels * 4 * sizeof(float));
    float *clip = (float *)realloc(a->clip, pixels * sizeof(float));
    float *group = (float *)realloc(a->group, pixels * 4 * sizeof(float));
    uint8_t *rgba = (uint8_t *)realloc(a->rgba, pixels * 4);
    if (!canvas || !layer || !clip || !group || !rgba) {
        a->canvas = canvas ? canvas : a->canvas;
        a->layer = layer ? layer : a->layer;
        a->clip = clip ? clip : a->clip;
        a->group = group ? group : a->group;
        a->rgba = rgba ? rgba : a->rgba;
        snprintf(a->last_error, sizeof a->last_error, "нет памяти под канвас %dx%d", width, height);
        return false;
    }
    a->canvas = canvas; a->layer = layer; a->clip = clip; a->group = group; a->rgba = rgba;
    a->canvas_w = width;
    a->canvas_h = height;
    // Свежие буферы обязаны быть нулевыми: очистка по грязному прямоугольнику
    // предполагает, что «ничего не рисовали» = прозрачно. Без этого в кадр
    // попадала неинициализированная память (нашлось доказательным тестом
    // зануления атласа: кадр не становился пустым).
    memset(a->canvas, 0, pixels * 4 * sizeof(float));
    memset(a->layer, 0, pixels * 4 * sizeof(float));
    memset(a->clip, 0, pixels * sizeof(float));
    memset(a->group, 0, pixels * 4 * sizeof(float));
    memset(a->rgba, 0, pixels * 4);
    layer_bbox_reset(a, a->layer_bbox);
    layer_bbox_reset(a, a->clip_bbox);
    layer_bbox_reset(a, a->group_bbox);
    layer_bbox_reset(a, a->prev_dirty);
    layer_bbox_reset(a, a->prev_clip);
    layer_bbox_reset(a, a->prev_group);
    return true;
}

// Чанк растеризации: треугольники патча делятся между потоками. Каждый
// пиксель пишет ровно один треугольник (правило top-left), поэтому гонок нет,
// а результат не зависит от планировщика — это важно для доказательных тестов.
#define R2D4_RASTER_CHUNK 24
#define R2D4_MAX_CHUNKS 32

typedef struct {
    R2d4Asset *asset;
    const R2d4Vert *verts;
    int patch_index;
    int first, count;
    int bbox[4];
    long long tests, hits;
} R2d4RasterJob;

static void raster_chunk(void *ctx, int index)
{
    R2d4RasterJob *job = (R2d4RasterJob *)ctx + index;
    R2d4Asset *a = job->asset;
    const R2d4Patch *patch = &a->patches[job->patch_index];
    layer_bbox_reset(a, job->bbox);
    for (int t = job->first; t < job->first + job->count; ++t) {
        uint32_t ia = a->tris[(patch->tri_offset + t) * 3 + 0];
        uint32_t ib = a->tris[(patch->tri_offset + t) * 3 + 1];
        uint32_t ic = a->tris[(patch->tri_offset + t) * 3 + 2];
        raster_triangle(a, &job->verts[ia], &job->verts[ib], &job->verts[ic],
                        job->patch_index, t, job->bbox, &job->tests, &job->hits);
    }
}

// Кодирование sRGB8 только по нужному прямоугольнику: полный проход по канвасу
// (262 тысячи пикселей) на каждом кадре стоил дороже самой растеризации.
static void encode_output(R2d4Asset *a, const int rect[4])
{
    if (rect[2] < rect[0] || rect[3] < rect[1]) return;
    for (int y = rect[1]; y <= rect[3]; ++y) {
    for (int x = rect[0]; x <= rect[2]; ++x) {
        size_t i = (size_t)y * a->canvas_w + x;
        const float *src = a->canvas + i * 4;
        float alpha = src[3];
        if (alpha <= 0.0f) {
            a->rgba[i * 4 + 0] = a->rgba[i * 4 + 1] = a->rgba[i * 4 + 2] = a->rgba[i * 4 + 3] = 0;
            continue;
        }
        if (alpha > 1.0f) alpha = 1.0f;
        float inv = 1.0f / alpha;
        for (int c = 0; c < 3; ++c) {
            float linear = src[c] * inv;
            if (linear < 0.0f) linear = 0.0f;
            if (linear > 1.0f) linear = 1.0f;
            int idx = (int)(linear * 4096.0f + 0.5f);
            if (idx > 4096) idx = 4096;
            a->rgba[i * 4 + c] = linear_to_srgb[idx];
        }
        a->rgba[i * 4 + 3] = (uint8_t)(alpha * 255.0f + 0.5f);
    }
    }
}

// Прямоугольники кадра: объединение и очистка региона.
static void rect_union(int dst[4], const int b[4])
{
    if (b[2] < b[0] || b[3] < b[1]) return;
    if (dst[2] < dst[0]) {
        dst[0] = b[0]; dst[1] = b[1]; dst[2] = b[2]; dst[3] = b[3];
        return;
    }
    if (b[0] < dst[0]) dst[0] = b[0];
    if (b[1] < dst[1]) dst[1] = b[1];
    if (b[2] > dst[2]) dst[2] = b[2];
    if (b[3] > dst[3]) dst[3] = b[3];
}

static void rect_clear(float *buf, int channels, int canvas_w, const int r[4])
{
    if (!buf || r[2] < r[0] || r[3] < r[1]) return;
    for (int y = r[1]; y <= r[3]; ++y) {
        memset(buf + ((size_t)y * canvas_w + r[0]) * channels, 0,
               (size_t)(r[2] - r[0] + 1) * channels * sizeof(float));
    }
}

typedef struct {
    float yaw, blink, mouth;
    bool validate, provenance;
} R2d4Options;

// Видимость детали по yaw (SPEC §7): v = 1 − smoothstep((|Δ| − half)/fade).
// Одна функция на рендер и на диагностику, иначе patchWeights начинает
// расходиться с кадром и перестаёт быть доказательством.
static float visibility_weight(const R2d4Patch *patch, float yaw_deg)
{
    if (!patch->has_visibility) return 1.0f;
    float delta = patch->vis_center_deg - yaw_deg;
    delta = fmodf(delta + 540.0f, 360.0f) - 180.0f;
    float magnitude = fabsf(delta);
    if (patch->vis_fade_deg > 1e-3f) {
        return 1.0f - smoothstep01((magnitude - patch->vis_half_deg) / patch->vis_fade_deg);
    }
    return (magnitude > patch->vis_half_deg) ? 0.0f : 1.0f;
}

// Полный гейт патча: кольцо → видимость → состояние (blink/mouth).
static float patch_gate(const R2d4Asset *a, const R2d4Patch *patch, float yaw_deg,
                        const R2d4Options *opts)
{
    float weight = (patch->ring >= 0) ? ring_weight(&a->rings[patch->ring], patch->ring_entry, yaw_deg) : 1.0f;
    if (weight <= 0.0f) return 0.0f;
    weight *= visibility_weight(patch, yaw_deg);
    if (opts) {
        if (patch->state_gate == 1) weight *= opts->blink;
        else if (patch->state_gate == 2) weight *= opts->mouth;
        else if (patch->state_gate == 3) weight *= (1.0f - opts->mouth);
    }
    if (!isfinite(weight) || weight < 0.0f) weight = 0.0f;
    return weight;
}


// Сброс группы лиц на канвас: внутри группы слои СКЛАДЫВАЮТСЯ (w·α), а не
// накладываются последовательным over. Иначе два appearance-варианта по 0.5
// дают alpha 0.75 — «призрак» и полупрозрачное лицо; при суммировании
// покрытие нормализуется и остаётся 1.0 (спека §7 правило 5: совместимые
// варианты смешивать внутри группы, а не накладывать друг на друга).
static void flush_face_group(R2d4Asset *a)
{
    if (!a->group_dirty) return;
    int x0 = a->group_bbox[0], y0 = a->group_bbox[1];
    int x1 = a->group_bbox[2], y1 = a->group_bbox[3];
    if (x1 >= x0 && y1 >= y0) {
        for (int y = y0; y <= y1; ++y) {
            for (int x = x0; x <= x1; ++x) {
                size_t idx = (size_t)y * a->canvas_w + x;
                const float *src = a->group + idx * 4;
                float alpha = src[3];
                if (alpha <= 0.0f) continue;
                if (alpha > 1.0f) alpha = 1.0f;
                float *dst = a->canvas + idx * 4;
                float keep = 1.0f - alpha;
                dst[0] = src[0] + dst[0] * keep;
                dst[1] = src[1] + dst[1] * keep;
                dst[2] = src[2] + dst[2] * keep;
                dst[3] = alpha + dst[3] * keep;
                if (alpha > a->clip[idx]) a->clip[idx] = alpha;
            }
        }
    }
    // Маска окклюзии деталей лица — покрытие группы; запоминаем её габарит,
    // чтобы очистка была не по всему канвасу.
    if (a->group_bbox[2] >= a->group_bbox[0]) {
        if (a->clip_bbox[2] < a->clip_bbox[0]) {
            a->clip_bbox[0] = a->group_bbox[0]; a->clip_bbox[1] = a->group_bbox[1];
        } else {
            if (a->group_bbox[0] < a->clip_bbox[0]) a->clip_bbox[0] = a->group_bbox[0];
            if (a->group_bbox[1] < a->clip_bbox[1]) a->clip_bbox[1] = a->group_bbox[1];
        }
        if (a->group_bbox[2] > a->clip_bbox[2]) a->clip_bbox[2] = a->group_bbox[2];
        if (a->group_bbox[3] > a->clip_bbox[3]) a->clip_bbox[3] = a->group_bbox[3];
    }
    a->group_dirty = false;
}

static bool render_frame(R2d4Asset *a, const R2d4Options *opts, int size)
{
    srgb_tables_init();
    // Аспект канваса задаёт манифест: у head-only он квадратный, у полного
    // роста 1:2. Ширину выбирает вызывающий (опция size), высоту считаем сами.
    int frame_w = size;
    int frame_h = size;
    if (a->declared_w > 0 && a->declared_h > 0 && a->declared_h != a->declared_w) {
        frame_h = (int)((double)size * (double)a->declared_h / (double)a->declared_w + 0.5);
        if (frame_h < 1) frame_h = 1;
    }
    if (!ensure_scratch(a, frame_w, frame_h)) return false;
    a->dbg_tests = a->dbg_hits = a->dbg_tris = 0;
    a->last_error[0] = 0;
    a->last_patches_drawn = a->last_tris_drawn = a->last_pixels = a->last_fold_rejects = 0;
    a->last_max_cover = 0.0f;
    a->last_yaw = opts->yaw;
    a->dirty[0] = a->canvas_w; a->dirty[1] = a->canvas_h; a->dirty[2] = -1; a->dirty[3] = -1;

    for (int phase = 0; phase < R2D4_PHASE_COUNT; ++phase) a->last_ms[phase] = 0.0;
    double t_phase = r2d4_now_ms();
    // Чистим только то, что было нарисовано в прошлом кадре.
    rect_clear(a->canvas, 4, a->canvas_w, a->prev_dirty);
    rect_clear(a->clip, 1, a->canvas_w, a->prev_clip);
    rect_clear(a->group, 4, a->canvas_w, a->prev_group);
    a->last_ms[R2D4_PHASE_CLEAR] = r2d4_now_ms() - t_phase;

    t_phase = r2d4_now_ms();
    float *q = (float *)malloc((size_t)a->dim * sizeof(float));
    if (!q) { snprintf(a->last_error, sizeof a->last_error, "нет памяти под вектор параметров"); return false; }
    eval_manifold(a, opts->yaw, q);
    a->last_ms[R2D4_PHASE_EVAL] = r2d4_now_ms() - t_phase;
    layer_bbox_reset(a, a->clip_bbox);
    layer_bbox_reset(a, a->group_bbox);
    a->group_dirty = false;
    if (a->prov_alloc) {
        if (a->prov_size != a->canvas_w || a->prov_h != a->canvas_h) {
            // Размер растра сменился: старые буферы меньше канваса, писать в
            // них нельзя (выход за границу), поэтому переаллоцируем.
            free(a->prov_patch);
            free(a->prov_tri);
            a->prov_patch = (uint16_t *)calloc((size_t)a->canvas_w * a->canvas_h, sizeof(uint16_t));
            a->prov_tri = (uint16_t *)calloc((size_t)a->canvas_w * a->canvas_h, sizeof(uint16_t));
            a->prov_alloc = a->prov_patch && a->prov_tri;
            a->prov_size = a->prov_alloc ? a->canvas_w : 0;
            a->prov_h = a->prov_alloc ? a->canvas_h : 0;
            if (!a->prov_alloc) {
                snprintf(a->last_error, sizeof a->last_error, "нет памяти под provenance");
                return false;
            }
        }
        memset(a->prov_patch, 0, (size_t)a->canvas_w * a->canvas_h * sizeof(uint16_t));
        memset(a->prov_tri, 0, (size_t)a->canvas_w * a->canvas_h * sizeof(uint16_t));
    }

    // Порядок слоёв: по псевдоглубине, tie — по индексу патча (детерминированно).
    int order[R2D4_MAX_PATCHES];
    for (int i = 0; i < a->patch_count; ++i) order[i] = i;
    for (int i = 1; i < a->patch_count; ++i) {
        int key = order[i];
        int j = i - 1;
        while (j >= 0 && (a->patches[order[j]].depth > a->patches[key].depth ||
                          (a->patches[order[j]].depth == a->patches[key].depth && order[j] > key))) {
            order[j + 1] = order[j];
            --j;
        }
        order[j + 1] = key;
    }

    float yaw_deg = opts->yaw * (180.0f / 3.14159265358979323846f);
    while (yaw_deg < 0.0f) yaw_deg += 360.0f;
    yaw_deg = fmodf(yaw_deg, 360.0f);

    for (int oi = 0; oi < a->patch_count; ++oi) {
        int pi = order[oi];
        R2d4Patch *patch = &a->patches[pi];
        float weight = patch_gate(a, patch, yaw_deg, opts);
        if (weight <= R2D4_CULL_THRESHOLD) continue;

        float dx, dy, sx, sy, rot, unused_weight;
        patch_params(q, pi, &dx, &dy, &sx, &sy, &rot, &unused_weight, opts->blink, opts->mouth);
        if (sx <= 0.0f || sy <= 0.0f) {
            snprintf(a->last_error, sizeof a->last_error, "патч %s: неположительный масштаб", patch->id);
            ++a->last_fold_rejects;
            continue;
        }
        float cs = cosf(rot), sn = sinf(rot);

        // 1. cage патча: базовые вершины в локальных единицах → экран.
        R2d4V2 cage[R2D4_MAX_MESH_VERTS];
        for (int i = 0; i < patch->cage_count; ++i) {
            float x = a->cage[(patch->cage_offset + i) * 2 + 0] * sx;
            float y = a->cage[(patch->cage_offset + i) * 2 + 1] * sy;
            float rx = x * cs - y * sn + dx;
            float ry = x * sn + y * cs + dy;
            cage[i].x = a->origin[0] + rx * a->canvas_unit_px;
            cage[i].y = a->origin[1] + ry * a->canvas_unit_px;
        }

        // 2. mesh: барицентрические привязки к cage + UV атласа.
        R2d4Vert verts[R2D4_MAX_MESH_VERTS];
        for (int i = 0; i < patch->vert_count; ++i) {
            const uint32_t *tri = &a->bind_tri[(patch->bind_offset + i) * 3];
            const float *wts = &a->bind_w[(patch->bind_offset + i) * 3];
            float x = 0.0f, y = 0.0f;
            for (int k = 0; k < 3; ++k) {
                if (tri[k] >= (uint32_t)patch->cage_count) {
                    snprintf(a->last_error, sizeof a->last_error,
                             "патч %s: привязка ссылается на вершину cage вне диапазона", patch->id);
                    x = y = -10000.0f;
                    break;
                }
                x += wts[k] * cage[tri[k]].x;
                y += wts[k] * cage[tri[k]].y;
            }
            verts[i].x = x;
            verts[i].y = y;
            verts[i].u = a->uvs[(patch->uv_offset + i) * 2 + 0];
            verts[i].v = a->uvs[(patch->uv_offset + i) * 2 + 1];
        }

        // 3. Hard validator: ни одного видимого вывернутого/вырожденного
        //    треугольника. Bake failure — здесь отказ патча с диагностикой,
        //    а не «починка» сортировкой вершин (спека §8).
        bool bad = false;
        float worst_ratio = 1.0f;
        for (int t = 0; t < patch->tri_count; ++t) {
            uint32_t ia = a->tris[(patch->tri_offset + t) * 3 + 0];
            uint32_t ib = a->tris[(patch->tri_offset + t) * 3 + 1];
            uint32_t ic = a->tris[(patch->tri_offset + t) * 3 + 2];
            float area = (verts[ib].x - verts[ia].x) * (verts[ic].y - verts[ia].y) -
                         (verts[ib].y - verts[ia].y) * (verts[ic].x - verts[ia].x);
            float base = patch->base_area[t] * 2.0f * a->canvas_unit_px * a->canvas_unit_px * sx * sy;
            float ratio = (fabsf(base) < 1e-9f) ? 1.0f : area / base;
            if (ratio < worst_ratio) worst_ratio = ratio;
            if (ratio <= 0.0f || ratio < R2D4_MIN_AREA_RATIO) { bad = true; break; }
        }
        if (bad) {
            ++a->last_fold_rejects;
            snprintf(a->last_error, sizeof a->last_error,
                     "патч %s: вывернутый/вырожденный треугольник (ratio %.4f) — патч отвергнут",
                     patch->id, (double)worst_ratio);
            continue;
        }

        // 4. Растеризация в слой патча.
        double t_raster = r2d4_now_ms();
        layer_clear_bbox(a, a->layer_bbox);
        layer_bbox_reset(a, a->layer_bbox);
        int chunks = (patch->tri_count + R2D4_RASTER_CHUNK - 1) / R2D4_RASTER_CHUNK;
        if (chunks < 1) chunks = 1;
        if (chunks > R2D4_MAX_CHUNKS) chunks = R2D4_MAX_CHUNKS;
        R2d4RasterJob jobs[R2D4_MAX_CHUNKS];
        int per_chunk = (patch->tri_count + chunks - 1) / chunks;
        int used = 0, cursor = 0;
        while (cursor < patch->tri_count && used < R2D4_MAX_CHUNKS) {
            int take = patch->tri_count - cursor;
            if (take > per_chunk) take = per_chunk;
            R2d4RasterJob *job = &jobs[used++];
            job->asset = a;
            job->verts = verts;
            job->patch_index = pi;
            job->first = cursor;
            job->count = take;
            job->tests = job->hits = 0;
            layer_bbox_reset(a, job->bbox);
            cursor += take;
        }
        r2d_rot_parallel(raster_chunk, jobs, used);
        for (int c = 0; c < used; ++c) {
            rect_union(a->layer_bbox, jobs[c].bbox);
            a->dbg_tests += jobs[c].tests;
            a->dbg_hits += jobs[c].hits;
        }
        a->last_tris_drawn += patch->tri_count;
        a->last_ms[R2D4_PHASE_RASTER] += r2d4_now_ms() - t_raster;
        if (a->layer_bbox[2] < a->layer_bbox[0]) { continue; }

        double t_composite = r2d4_now_ms();
        // 5. Композит. Слои группы лиц (owner_group == 0) сначала копятся в
        //    общем буфере группы и сбрасываются на канвас одним проходом.
        if (patch->owner_group != 0) flush_face_group(a);
        for (int y = a->layer_bbox[1]; y <= a->layer_bbox[3]; ++y) {
            for (int x = a->layer_bbox[0]; x <= a->layer_bbox[2]; ++x) {
                size_t idx = (size_t)y * a->canvas_w + x;
                const float *src = a->layer + idx * 4;
                float m = weight;
                if (patch->clip_face) m *= a->clip[idx];
                if (patch->has_clip_rect) {
                    // Мягкая рамка: 1 px перехода, чтобы край не был рубленым.
                    float cx = (float)x - a->origin[0], cy = (float)y - a->origin[1];
                    float lo_x = patch->clip_rect[0] * a->canvas_unit_px;
                    float lo_y = patch->clip_rect[1] * a->canvas_unit_px;
                    float hi_x = patch->clip_rect[2] * a->canvas_unit_px;
                    float hi_y = patch->clip_rect[3] * a->canvas_unit_px;
                    float fade = 1.0f;
                    if (cx < lo_x) fade *= smoothstep01((cx - (lo_x - 1.5f)) / 1.5f);
                    if (cy < lo_y) fade *= smoothstep01((cy - (lo_y - 1.5f)) / 1.5f);
                    if (cx > hi_x) fade *= smoothstep01(((hi_x + 1.5f) - cx) / 1.5f);
                    if (cy > hi_y) fade *= smoothstep01(((hi_y + 1.5f) - cy) / 1.5f);
                    if (fade <= 0.0f) continue;
                    m *= fade;
                }
                if (m <= 0.0f) continue;
                float sr = src[0] * m, sg = src[1] * m, sb = src[2] * m, sa = src[3] * m;
                if (patch->owner_group == 0) {
                    float *g = a->group + idx * 4;
                    g[0] += sr; g[1] += sg; g[2] += sb; g[3] += sa;
                    continue;
                }
                float *dst = a->canvas + idx * 4;
                float keep = 1.0f - sa;
                dst[0] = sr + dst[0] * keep;
                dst[1] = sg + dst[1] * keep;
                dst[2] = sb + dst[2] * keep;
                dst[3] = sa + dst[3] * keep;
                if (a->cover && a->cover[idx] > a->last_max_cover) a->last_max_cover = a->cover[idx];
            }
        }

        // 6. Габарит группы лиц — по нему потом обновляется маска окклюзии.
        if (patch->owner_group == 0) {
            if (a->group_bbox[2] < a->group_bbox[0]) {
                a->group_bbox[0] = a->layer_bbox[0]; a->group_bbox[1] = a->layer_bbox[1];
            } else {
                if (a->layer_bbox[0] < a->group_bbox[0]) a->group_bbox[0] = a->layer_bbox[0];
                if (a->layer_bbox[1] < a->group_bbox[1]) a->group_bbox[1] = a->layer_bbox[1];
            }
            if (a->layer_bbox[2] > a->group_bbox[2]) a->group_bbox[2] = a->layer_bbox[2];
            if (a->layer_bbox[3] > a->group_bbox[3]) a->group_bbox[3] = a->layer_bbox[3];
            a->group_dirty = true;
        }

        a->last_ms[R2D4_PHASE_COMPOSITE] += r2d4_now_ms() - t_composite;
        ++a->last_patches_drawn;
        if (a->dirty[2] < a->dirty[0]) {
            a->dirty[0] = a->layer_bbox[0]; a->dirty[1] = a->layer_bbox[1];
            a->dirty[2] = a->layer_bbox[2]; a->dirty[3] = a->layer_bbox[3];
        } else {
            if (a->layer_bbox[0] < a->dirty[0]) a->dirty[0] = a->layer_bbox[0];
            if (a->layer_bbox[1] < a->dirty[1]) a->dirty[1] = a->layer_bbox[1];
            if (a->layer_bbox[2] > a->dirty[2]) a->dirty[2] = a->layer_bbox[2];
            if (a->layer_bbox[3] > a->dirty[3]) a->dirty[3] = a->layer_bbox[3];
        }
    }

    flush_face_group(a);
    free(q);
    // Загрузка в текстуру и кодирование обязаны покрыть и прошлый прямоугольник:
    // иначе в текстуре остаются следы от предыдущего угла (там теперь ноль).
    rect_union(a->dirty, a->prev_dirty);
    a->prev_dirty[0] = a->dirty[0]; a->prev_dirty[1] = a->dirty[1];
    a->prev_dirty[2] = a->dirty[2]; a->prev_dirty[3] = a->dirty[3];
    a->prev_clip[0] = a->clip_bbox[0]; a->prev_clip[1] = a->clip_bbox[1];
    a->prev_clip[2] = a->clip_bbox[2]; a->prev_clip[3] = a->clip_bbox[3];
    a->prev_group[0] = a->group_bbox[0]; a->prev_group[1] = a->group_bbox[1];
    a->prev_group[2] = a->group_bbox[2]; a->prev_group[3] = a->group_bbox[3];
    a->last_pixels = a->canvas_w * a->canvas_h;
    if (opts->validate && a->last_max_cover > 1.0f + 1e-3f && !a->last_error[0]) {
        snprintf(a->last_error, sizeof a->last_error,
                 "перекрытие треугольников внутри патча (cover %.3f) — шов fill rule",
                 (double)a->last_max_cover);
    }
    t_phase = r2d4_now_ms();
    encode_output(a, a->dirty);
    a->last_ms[R2D4_PHASE_ENCODE] = r2d4_now_ms() - t_phase;
    return a->last_error[0] == 0;
}

// --- 8. JS-биндинги --------------------------------------------------------

static double opt_number(JSContext *ctx, JSValueConst obj, const char *key, double fallback, bool *present)
{
    JSValue v = JS_GetPropertyStr(ctx, obj, key);
    double out = fallback;
    if (JS_IsUndefined(v) || JS_IsNull(v)) {
        if (present) *present = false;
    } else {
        if (JS_ToFloat64(ctx, &out, v) < 0) { JS_FreeValue(ctx, v); JS_GetException(ctx); out = fallback; }
        if (present) *present = true;
    }
    JS_FreeValue(ctx, v);
    return out;
}

static bool opt_bool(JSContext *ctx, JSValueConst obj, const char *key)
{
    JSValue v = JS_GetPropertyStr(ctx, obj, key);
    bool out = JS_IsUndefined(v) ? false : JS_ToBool(ctx, v) > 0;
    JS_FreeValue(ctx, v);
    return out;
}

static R2d4Asset *asset_at(JSContext *ctx, JSValueConst v, const char *what)
{
    int id = -1;
    if (JS_ToInt32(ctx, &id, v) < 0 || id < 0 || id >= R2D4_MAX_ASSETS || !g_assets[id] ||
        !g_assets[id]->used) {
        JS_ThrowRangeError(ctx, "real2d: %s — нет загруженного ассета с id %d", what, id);
        return NULL;
    }
    return g_assets[id];
}

static void asset_free(R2d4Asset *a)
{
    if (!a) return;
    free(a->atlas);
    free(a->atlas_override);
    free(a->verts);
    free(a->uvs);
    free(a->tris);
    free(a->bind_tri);
    free(a->bind_w);
    free(a->cage);
    free(a->manifold);
    free(a->canvas);
    free(a->layer);
    free(a->clip);
    free(a->group);
    free(a->cover);
    free(a->rgba);
    free(a->prov_patch);
    free(a->prov_tri);
    free(a);
}

static JSValue js_load(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (!s || !s->renderer || argc < 1 || !JS_IsString(argv[0])) {
        return JS_ThrowTypeError(ctx, "real2d.load: нужен путь к контейнеру .r2d4");
    }
    int slot = -1;
    for (int i = 0; i < R2D4_MAX_ASSETS; ++i) {
        if (!g_assets[i] || !g_assets[i]->used) { slot = i; break; }
    }
    if (slot < 0) return JS_ThrowRangeError(ctx, "real2d.load: уже загружено %d ассетов", R2D4_MAX_ASSETS);

    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, path);
    JS_FreeCString(ctx, path);

    uint8_t *bytes = NULL;
    size_t size = 0;
    if (r2d_vfs_has(full)) {
        bytes = r2d_vfs_read(full, &size);
    } else {
        SDL_IOStream *io = SDL_IOFromFile(full, "rb");
        if (io) {
            Sint64 length = SDL_GetIOSize(io);
            if (length > 0) {
                bytes = (uint8_t *)malloc((size_t)length);
                if (bytes && SDL_ReadIO(io, bytes, (size_t)length) != (size_t)length) {
                    free(bytes); bytes = NULL;
                } else {
                    size = (size_t)length;
                }
            }
            SDL_CloseIO(io);
        }
    }
    if (!bytes || size < 64) {
        free(bytes);
        return JS_ThrowTypeError(ctx, "real2d.load: не прочитан контейнер %s", full);
    }

    R2d4Asset *a = (R2d4Asset *)calloc(1, sizeof *a);
    if (!a) { free(bytes); return JS_ThrowOutOfMemory(ctx); }
    a->used = true;
    a->texture = a->sprite = -1;
    a->tex_size = 0;
    strcpy(a->path, full);
    layer_bbox_reset(a, a->layer_bbox);
    layer_bbox_reset(a, a->clip_bbox);
    layer_bbox_reset(a, a->group_bbox);
    layer_bbox_reset(a, a->prev_dirty);
    layer_bbox_reset(a, a->prev_clip);
    layer_bbox_reset(a, a->prev_group);
    a->dirty[0] = a->dirty[1] = a->dirty[2] = a->dirty[3] = -1;

    char err[220];
    if (!load_manifest(a, bytes, size, err, sizeof err)) {
        free(bytes);
        asset_free(a);
        return JS_ThrowRangeError(ctx, "real2d.load: %s", err);
    }
    free(bytes);

    int size_px = a->default_size;
    int load_h = size_px;
    if (a->declared_w > 0 && a->declared_h > 0 && a->declared_h != a->declared_w) {
        load_h = (int)((double)size_px * (double)a->declared_h / (double)a->declared_w + 0.5);
        if (load_h < 1) load_h = 1;
    }
    a->canvas_w = a->canvas_h = 0;
    if (!ensure_scratch(a, size_px, load_h)) {
        char why[220];
        SDL_strlcpy(why, a->last_error, sizeof why);
        asset_free(a);
        R2D_ERROR("real2d.load: %s", why);
        return JS_ThrowOutOfMemory(ctx);
    }
    a->texture = r2d_texture_create_rgba(s->renderer, a->rgba, a->canvas_w, a->canvas_h);
    if (a->texture >= 0) {
        a->sprite = r2d_sprite_create(s->renderer, a->texture, 0, 0,
                                      (float)a->canvas_w, (float)a->canvas_h);
    }
    if (a->sprite < 0) {
        asset_free(a);
        return JS_ThrowInternalError(ctx, "real2d.load: не удалось создать текстуру/спрайт (лимит текстур)");
    }
    {
        R2DSprite *sp = &s->renderer->sprites[a->sprite];
        sp->force_linear = true;
        sp->u0 = sp->v0 = 0; sp->u1 = sp->v1 = 1;
    }
    a->tex_size = size_px;
    a->tex_h = a->canvas_h;
    g_assets[slot] = a;
    return JS_NewInt32(ctx, slot);
}

static JSValue js_render(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (!s || !s->renderer || argc < 1) return JS_ThrowTypeError(ctx, "real2d.render(id, opts)");
    R2d4Asset *a = asset_at(ctx, argv[0], "render");
    if (!a) return JS_EXCEPTION;

    R2d4Options opts = {0.0f, 0.0f, 0.0f, false, false};
    int size = a->default_size;
    if (argc > 1 && JS_IsObject(argv[1])) {
        opts.yaw = (float)opt_number(ctx, argv[1], "yaw", 0.0, NULL);
        opts.blink = (float)opt_number(ctx, argv[1], "blink", 0.0, NULL);
        opts.mouth = (float)opt_number(ctx, argv[1], "mouth", 0.0, NULL);
        size = (int)opt_number(ctx, argv[1], "scale", (double)a->default_size, NULL);
        opts.validate = opt_bool(ctx, argv[1], "validate");
        opts.provenance = opt_bool(ctx, argv[1], "provenance");
    }
    if (!isfinite(opts.yaw) || !isfinite(opts.blink) || !isfinite(opts.mouth)) {
        return JS_ThrowRangeError(ctx, "real2d.render: не-конечные параметры");
    }
    if (size < R2D4_CANVAS_MIN || size > R2D4_CANVAS_MAX) {
        return JS_ThrowRangeError(ctx, "real2d.render: scale %d вне [%d, %d]", size,
                                  R2D4_CANVAS_MIN, R2D4_CANVAS_MAX);
    }
    if (opts.blink < 0.0f) opts.blink = 0.0f;
    if (opts.blink > 1.0f) opts.blink = 1.0f;
    if (opts.mouth < 0.0f) opts.mouth = 0.0f;
    if (opts.mouth > 1.0f) opts.mouth = 1.0f;

    // Проверка fill rule включается явно: счётчик записей на пиксель.
    if (opts.validate && !a->cover) {
        a->cover = (float *)calloc((size_t)size * size, sizeof(float));
    }
    // cover-буфер нужен только валидатору fill rule и живёт в квадратном
    // размере size; пиксели кадра он не хранит.
    if (!render_frame(a, &opts, size)) {
        if (a->last_error[0]) R2D_WARN("real2d: %s", a->last_error);
    }
    if (opts.provenance && (!a->prov_alloc || a->prov_size != a->canvas_w || a->prov_h != a->canvas_h)) {
        free(a->prov_patch);
        free(a->prov_tri);
        size_t prov_pixels = (size_t)a->canvas_w * (size_t)a->canvas_h;
        a->prov_patch = (uint16_t *)calloc(prov_pixels, sizeof(uint16_t));
        a->prov_tri = (uint16_t *)calloc(prov_pixels, sizeof(uint16_t));
        a->prov_alloc = a->prov_patch && a->prov_tri;
        a->prov_size = a->prov_alloc ? a->canvas_w : 0;
        a->prov_h = a->prov_alloc ? a->canvas_h : 0;
        if (a->prov_alloc) {
            // Второй проход уже с включённым provenance: растеризация
            // детерминирована, картинка та же — дописывается только цепочка.
            render_frame(a, &opts, size);
        }
    }
    // Смена размера растра требует пересоздания текстуры: загрузка области в
    // текстуру другого размера записала бы кадр мимо.
    if (a->texture < 0 || a->tex_size != a->canvas_w || a->tex_h != a->canvas_h) {
        if (a->sprite >= 0) s->renderer->sprites[a->sprite].alive = false;
        if (a->texture >= 0) r2d_texture_free(s->renderer, a->texture);
        a->texture = r2d_texture_create_rgba(s->renderer, a->rgba, a->canvas_w, a->canvas_h);
        a->sprite = (a->texture >= 0) ? r2d_sprite_create(s->renderer, a->texture, 0, 0,
                                                          (float)a->canvas_w, (float)a->canvas_h) : -1;
        if (a->sprite < 0) return JS_ThrowInternalError(ctx, "real2d.render: нет слота текстуры/спрайта");
        R2DSprite *sp = &s->renderer->sprites[a->sprite];
        sp->force_linear = true;
        sp->u0 = sp->v0 = 0; sp->u1 = sp->v1 = 1;
        a->tex_size = a->canvas_w;
        a->tex_h = a->canvas_h;
    } else {
        // Обновляем только грязный прямоугольник кадра.
        int x0 = a->dirty[0], y0 = a->dirty[1], x1 = a->dirty[2], y1 = a->dirty[3];
        if (x1 < x0 || y1 < y0) { x0 = y0 = 0; x1 = y1 = size - 1; }
        double t_upload = r2d4_now_ms();
        const uint8_t *base = a->rgba + ((size_t)y0 * size + x0) * 4;
        r2d_texture_upload_region(s->renderer, a->texture, x0, y0, x1 - x0 + 1, y1 - y0 + 1,
                                  base, size * 4);
        a->last_ms[R2D4_PHASE_UPLOAD] = r2d4_now_ms() - t_upload;
    }
    return JS_NewInt32(ctx, a->sprite);
}

static JSValue js_pixels(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    if (argc < 1) return JS_ThrowTypeError(ctx, "real2d.pixels(id)");
    R2d4Asset *a = asset_at(ctx, argv[0], "pixels");
    if (!a) return JS_EXCEPTION;
    if (!a->rgba) return JS_NewArrayBufferCopy(ctx, NULL, 0);
    return JS_NewArrayBufferCopy(ctx, a->rgba, (size_t)a->canvas_w * a->canvas_h * 4);
}

static JSValue js_atlas_pixels(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    if (argc < 1) return JS_ThrowTypeError(ctx, "real2d.atlasPixels(id)");
    R2d4Asset *a = asset_at(ctx, argv[0], "atlasPixels");
    if (!a) return JS_EXCEPTION;
    const uint8_t *px = a->atlas_override ? a->atlas_override : a->atlas;
    return JS_NewArrayBufferCopy(ctx, px, (size_t)a->atlas_w * a->atlas_h * 4);
}

// Структурная диагностика кадра: что именно решил движок для каждого патча
// (правило 8 — тест не разбирает журнал и не догадывается).
static JSValue js_patch_weights(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    if (argc < 2) return JS_ThrowTypeError(ctx, "real2d.patchWeights(id, yaw)");
    R2d4Asset *a = asset_at(ctx, argv[0], "patchWeights");
    if (!a) return JS_EXCEPTION;
    double yaw = 0.0;
    if (JS_ToFloat64(ctx, &yaw, argv[1]) < 0) return JS_EXCEPTION;
    if (!isfinite(yaw)) return JS_ThrowRangeError(ctx, "real2d.patchWeights: yaw не конечен");
    float *q = (float *)malloc((size_t)a->dim * sizeof(float));
    if (!q) return JS_ThrowOutOfMemory(ctx);
    eval_manifold(a, (float)yaw, q);
    float yaw_deg = (float)yaw * (180.0f / 3.14159265358979323846f);
    while (yaw_deg < 0.0f) yaw_deg += 360.0f;
    yaw_deg = fmodf(yaw_deg, 360.0f);
    JSValue list = JS_NewArray(ctx);
    int written = 0;
    for (int i = 0; i < a->patch_count; ++i) {
        const R2d4Patch *patch = &a->patches[i];
        float gate = patch_gate(a, patch, yaw_deg, NULL);
        if (gate <= R2D4_CULL_THRESHOLD) continue;
        const float *p = q + i * 5;
        JSValue item = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, item, "id", JS_NewString(ctx, patch->id));
        JS_SetPropertyStr(ctx, item, "ring", JS_NewInt32(ctx, patch->ring));
        JS_SetPropertyStr(ctx, item, "gate", JS_NewFloat64(ctx, (double)gate));
        JS_SetPropertyStr(ctx, item, "depth", JS_NewFloat64(ctx, (double)patch->depth));
        JS_SetPropertyStr(ctx, item, "dx", JS_NewFloat64(ctx, (double)p[0]));
        JS_SetPropertyStr(ctx, item, "dy", JS_NewFloat64(ctx, (double)p[1]));
        JS_SetPropertyStr(ctx, item, "sx", JS_NewFloat64(ctx, (double)p[2]));
        JS_SetPropertyStr(ctx, item, "sy", JS_NewFloat64(ctx, (double)p[3]));
        JS_SetPropertyUint32(ctx, list, (uint32_t)written++, item);
    }
    free(q);
    return list;
}

static JSValue js_provenance_map(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    if (argc < 1) return JS_ThrowTypeError(ctx, "real2d.provenanceMap(id)");
    R2d4Asset *a = asset_at(ctx, argv[0], "provenanceMap");
    if (!a) return JS_EXCEPTION;
    if (!a->prov_alloc || !a->prov_patch) {
        return JS_ThrowRangeError(ctx, "real2d.provenanceMap: рендер без provenance");
    }
    return JS_NewArrayBufferCopy(ctx, (const uint8_t *)a->prov_patch,
                                 (size_t)a->canvas_w * a->canvas_h * sizeof(uint16_t));
}

static JSValue js_info(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    if (argc < 1) return JS_ThrowTypeError(ctx, "real2d.info(id)");
    R2d4Asset *a = asset_at(ctx, argv[0], "info");
    if (!a) return JS_EXCEPTION;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "ok", JS_NewBool(ctx, a->last_error[0] == 0));
    JS_SetPropertyStr(ctx, o, "stage", JS_NewString(ctx, "A-head-only"));
    JS_SetPropertyStr(ctx, o, "canvas", JS_NewInt32(ctx, a->canvas_w));
    JS_SetPropertyStr(ctx, o, "atlas_w", JS_NewInt32(ctx, a->atlas_w));
    JS_SetPropertyStr(ctx, o, "atlas_h", JS_NewInt32(ctx, a->atlas_h));
    JS_SetPropertyStr(ctx, o, "patches", JS_NewInt32(ctx, a->patch_count));
    JS_SetPropertyStr(ctx, o, "rings", JS_NewInt32(ctx, a->ring_count));
    JS_SetPropertyStr(ctx, o, "dim", JS_NewInt32(ctx, a->dim));
    JS_SetPropertyStr(ctx, o, "rank", JS_NewInt32(ctx, a->rank));
    JS_SetPropertyStr(ctx, o, "features", JS_NewInt32(ctx, a->features));
    JS_SetPropertyStr(ctx, o, "yaw_K", JS_NewInt32(ctx, a->yaw_K));
    JS_SetPropertyStr(ctx, o, "sprite", JS_NewInt32(ctx, a->sprite));
    JS_SetPropertyStr(ctx, o, "triangles", JS_NewInt32(ctx, a->tri_count));
    JS_SetPropertyStr(ctx, o, "triangles_drawn", JS_NewInt32(ctx, a->last_tris_drawn));
    JS_SetPropertyStr(ctx, o, "patches_drawn", JS_NewInt32(ctx, a->last_patches_drawn));
    JS_SetPropertyStr(ctx, o, "pixels", JS_NewInt32(ctx, a->last_pixels));
    JS_SetPropertyStr(ctx, o, "fold_rejects", JS_NewInt32(ctx, a->last_fold_rejects));
    JS_SetPropertyStr(ctx, o, "max_coverage", JS_NewFloat64(ctx, (double)a->last_max_cover));
    JS_SetPropertyStr(ctx, o, "pixels_tested", JS_NewFloat64(ctx, (double)a->dbg_tests));
    JS_SetPropertyStr(ctx, o, "pixels_written", JS_NewFloat64(ctx, (double)a->dbg_hits));
    JS_SetPropertyStr(ctx, o, "yaw", JS_NewFloat64(ctx, (double)a->last_yaw));
    JS_SetPropertyStr(ctx, o, "atlas_mutated", JS_NewBool(ctx, a->atlas_override != NULL));
    {
        JSValue ms = JS_NewObject(ctx);
        for (int phase = 0; phase < R2D4_PHASE_COUNT; ++phase) {
            JS_SetPropertyStr(ctx, ms, r2d4_phase_names[phase],
                              JS_NewFloat64(ctx, a->last_ms[phase]));
        }
        JS_SetPropertyStr(ctx, o, "ms", ms);
    }
    JS_SetPropertyStr(ctx, o, "last_error", JS_NewString(ctx, a->last_error));
    JS_SetPropertyStr(ctx, o, "path", JS_NewString(ctx, a->path));
    {
        // Патчи — структурой: тест обязан видеть те же id и rect'ы, что и
        // рантайм, а не разбирать журнал (правило 8).
        JSValue ids = JS_NewArray(ctx);
        JSValue rects = JS_NewObject(ctx);
        for (int i = 0; i < a->patch_count; ++i) {
            JS_SetPropertyUint32(ctx, ids, (uint32_t)i, JS_NewString(ctx, a->patches[i].id));
            JSValue rect = JS_NewArray(ctx);
            for (int c = 0; c < 4; ++c) {
                JS_SetPropertyUint32(ctx, rect, (uint32_t)c,
                                     JS_NewFloat64(ctx, (double)a->patches[i].rect[c]));
            }
            JS_SetPropertyStr(ctx, rects, a->patches[i].id, rect);
        }
        JS_SetPropertyStr(ctx, o, "patch_ids", ids);
        JS_SetPropertyStr(ctx, o, "patch_rects", rects);
    }
    return o;
}

static JSValue js_provenance(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    if (argc < 3) return JS_ThrowTypeError(ctx, "real2d.provenance(id, x, y)");
    R2d4Asset *a = asset_at(ctx, argv[0], "provenance");
    if (!a) return JS_EXCEPTION;
    int x = -1, y = -1;
    if (JS_ToInt32(ctx, &x, argv[1]) < 0 || JS_ToInt32(ctx, &y, argv[2]) < 0) return JS_EXCEPTION;
    if (!a->prov_alloc) return JS_ThrowRangeError(ctx, "real2d.provenance: рендер без provenance");
    if (x < 0 || y < 0 || x >= a->canvas_w || y >= a->canvas_h) return JS_NULL;
    size_t idx = (size_t)y * a->canvas_w + x;
    if (a->prov_patch[idx] == 0) return JS_NULL;
    int patch_index = (int)a->prov_patch[idx] - 1;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "patch", JS_NewString(ctx, a->patches[patch_index].id));
    JS_SetPropertyStr(ctx, o, "triangle", JS_NewInt32(ctx, (int)a->prov_tri[idx]));
    JS_SetPropertyStr(ctx, o, "x", JS_NewInt32(ctx, x));
    JS_SetPropertyStr(ctx, o, "y", JS_NewInt32(ctx, y));
    const uint8_t *px = a->rgba + idx * 4;
    JSValue rgba = JS_NewArray(ctx);
    for (int c = 0; c < 4; ++c) JS_SetPropertyUint32(ctx, rgba, (uint32_t)c, JS_NewInt32(ctx, px[c]));
    JS_SetPropertyStr(ctx, o, "rgba", rgba);
    return o;
}

static JSValue js_debug_set_atlas(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    if (argc < 2) return JS_ThrowTypeError(ctx, "real2d.debugSetAtlas(id, bytes|null)");
    R2d4Asset *a = asset_at(ctx, argv[0], "debugSetAtlas");
    if (!a) return JS_EXCEPTION;
    if (JS_IsNull(argv[1]) || JS_IsUndefined(argv[1])) {
        free(a->atlas_override);
        a->atlas_override = NULL;
        return JS_TRUE;
    }
    size_t need = (size_t)a->atlas_w * a->atlas_h * 4;
    size_t offset = 0, length = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[1], (size_t *)&offset, &length, &bpe);
    uint8_t *data = NULL;
    if (!JS_IsException(ab)) {
        size_t ab_len = 0;
        data = JS_GetArrayBuffer(ctx, &ab_len, ab);
        if (data) { data += offset; length = (length < ab_len - offset) ? length : ab_len - offset; }
        JS_FreeValue(ctx, ab);
    } else {
        JS_FreeValue(ctx, JS_GetException(ctx));
    }
    if (!data || length < need) {
        return JS_ThrowTypeError(ctx, "real2d.debugSetAtlas: нужен Uint8Array на %zu байт (RGBA атласа)", need);
    }
    free(a->atlas_override);
    a->atlas_override = (uint8_t *)malloc(need);
    if (!a->atlas_override) return JS_ThrowOutOfMemory(ctx);
    memcpy(a->atlas_override, data, need);
    return JS_TRUE;
}

static JSValue js_dispose(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (argc < 1) return JS_ThrowTypeError(ctx, "real2d.dispose(id)");
    int id = -1;
    if (JS_ToInt32(ctx, &id, argv[0]) < 0) return JS_EXCEPTION;
    if (id < 0 || id >= R2D4_MAX_ASSETS || !g_assets[id]) return JS_FALSE;
    R2d4Asset *a = g_assets[id];
    if (s && s->renderer) {
        if (a->sprite >= 0) s->renderer->sprites[a->sprite].alive = false;
        if (a->texture >= 0) r2d_texture_free(s->renderer, a->texture);
    }
    asset_free(a);
    g_assets[id] = NULL;
    return JS_TRUE;
}

int r2d_real2d_install(JSContext *ctx, JSValue engine)
{
    JSValue real2d = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, real2d, "load", JS_NewCFunction(ctx, js_load, "load", 1));
    JS_SetPropertyStr(ctx, real2d, "render", JS_NewCFunction(ctx, js_render, "render", 2));
    JS_SetPropertyStr(ctx, real2d, "pixels", JS_NewCFunction(ctx, js_pixels, "pixels", 1));
    JS_SetPropertyStr(ctx, real2d, "info", JS_NewCFunction(ctx, js_info, "info", 1));
    JS_SetPropertyStr(ctx, real2d, "provenance", JS_NewCFunction(ctx, js_provenance, "provenance", 3));
    JS_SetPropertyStr(ctx, real2d, "provenanceMap", JS_NewCFunction(ctx, js_provenance_map, "provenanceMap", 1));
    JS_SetPropertyStr(ctx, real2d, "patchWeights", JS_NewCFunction(ctx, js_patch_weights, "patchWeights", 2));
    JS_SetPropertyStr(ctx, real2d, "atlasPixels", JS_NewCFunction(ctx, js_atlas_pixels, "atlasPixels", 1));
    JS_SetPropertyStr(ctx, real2d, "debugSetAtlas", JS_NewCFunction(ctx, js_debug_set_atlas, "debugSetAtlas", 2));
    JS_SetPropertyStr(ctx, real2d, "dispose", JS_NewCFunction(ctx, js_dispose, "dispose", 1));
    JS_SetPropertyStr(ctx, engine, "real2d", real2d);
    return 0;
}
