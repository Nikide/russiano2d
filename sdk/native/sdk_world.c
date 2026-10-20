// ===========================================================================
// Re2D World: исходник карты `*.re2dmap` → описание для `$.re2d.world(...)`.
//
// Автор редактирует понятный исходник (cells, height spans, walls, portals,
// stairs, slopes); компилятор проверяет его теми же правилами, что и рантайм
// (`src/re2d_world.c`, `src/re2d.c`), и выдаёт `{walls, cells}`. BSP руками не
// правится: рантайм строит его сам по XY-стенам.
//
// Default output preserves the legacy runtime contract: slopes are stepped and
// portal/PVS metadata is diagnostic. --renderer emits native continuous slopes,
// portal topology and prebuilt BSP/incidence tables for $.re2dWorld.
// ===========================================================================
#include "sdk.h"
#include "re2d_world_bake.h"
#include "re2d_world_polygon.h"
#include "re2d_world_region.h"
#include "sdk_brush.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define W_EPS 0.001f
#define W_LIMIT 1000000.0f
#define W_MAX 65536

typedef struct WSpan {
    float bottom, top, floor_a, floor_b;
    char  floor_c[40], ceil_c[40];
    R2DWorldSpanLight light;bool lit;
    // P0.1 user surface tags: floor `tags` + optional `ceilingTags`. Fixed
    // compiler-side storage because WSpan is copied by value between stages;
    // bounds match the native validator (R2D_WORLD_TAG_MAX / _LENGTH).
    char tags[R2D_WORLD_TAG_MAX][R2D_WORLD_TAG_LENGTH+1];
    unsigned char ntag;
    char ceiling_tags[R2D_WORLD_TAG_MAX][R2D_WORLD_TAG_LENGTH+1];
    unsigned char nceiling_tag;
} WSpan;

typedef struct WCell {
    char   id[64];
    float  x, y, w, h;
    WSpan *spans;
    int    nspan;
    bool   generated;   // polygon compiler tile: runtime portals are auto-generated
    bool   portal_authored; // brush compiler already emitted this cell's portals
} WCell;

typedef struct WWall {
    char  id[64];
    float x1, y1, x2, y2, bottom, top;
    char  color[40];
    uint16_t flags;
} WWall;

typedef struct WOpening { float bottom, top; } WOpening;

typedef struct WPortal {
    char      id[64], a[64], b[64];
    float     x1, y1, x2, y2;
    WOpening *open;
    int       nopen;
    bool      area_portal;
} WPortal;

// Скомпилированная ячейка (одна или несколько spans) с происхождением.
typedef struct CCell {
    float  x, y, w, h;
    WSpan *spans;
    int    nspan;
    char   owner[96];       // id источника: «hall», «stairs1#3»
    int    explicit_index;  // индекс в source.cells или -1
    bool   portal_authored; // brush compiler portals must not be duplicated
} CCell;

typedef struct World {
    char     name[128];
    char *lighting_json,*lights_json;
    char *entities_json;
    WCell   *cells;    int ncell;
    WWall   *walls;    int nwall;
    WPortal *portals;  int nportal;
    // Brush authoring (#5) and region partition (R-04).
    SdkBrushSpec *brushes; int nbrush;
    SdkBrushStats brush_stats;
    SdkBrushEntityRef *entity_refs; int nentity_refs;
    SdkBrushEntityMap *entity_map; int nentity_map;
    int nentities, npoint_entities, nbrush_entities;
    int authored_lights;
    float region_size;
    int region_count, region_columns, region_rows, region_pvs_edges;
    int *region_cell_counts;
    double stage_load_ms, stage_compile_ms, stage_region_ms;
    // Скомпилированное
    CCell   *cc;       int ncc, cap_cc;
    WWall   *cw;       int ncw, cap_cw;
    int      stair_steps, slope_segments, nstairs, nslopes;
} World;

static void world_free(World *w)
{
    for (int i = 0; i < w->ncell; ++i) free(w->cells[i].spans);
    free(w->cells);
    free(w->walls);
    for (int i = 0; i < w->nportal; ++i) free(w->portals[i].open);
    free(w->portals);
    for (int i = 0; i < w->ncc; ++i) free(w->cc[i].spans);
    free(w->cc);
    free(w->cw);free(w->lighting_json);free(w->lights_json);
    free(w->entities_json);
    free(w->brushes);
    free(w->entity_refs);
    free(w->entity_map);
    free(w->region_cell_counts);
    memset(w, 0, sizeof *w);
}

// ---------------------------------------------------------------------------
// Разбор с проверкой полей
// ---------------------------------------------------------------------------
typedef struct Ctx {
    SdkReport *rep;
    const char *path;
} Ctx;

// Escape identifiers inserted into diagnostic JSON; buffers live until sdk_diag copies them.
static const char *json_fragment(const char *s)
{
    static char slots[8][1024];
    static unsigned next;
    char *out = slots[next++ % 8];
    R2dSb b; r2d_sb_init(&b); r2d_sb_put_json_string(&b, s ? s : "");
    const size_t n = b.len >= 2 ? b.len - 2 : 0;
    memcpy(out, b.data + 1, n); out[n] = 0; r2d_sb_free(&b);
    return out;
}

static void field_diag(Ctx *c, const char *section, int index, const char *id, const char *field, const char *msg)
{
    char loc[2048];
    snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"index\":%d,\"id\":\"%s\",\"field\":\"%s\"}", section, index, json_fragment(id ? id : ""), field);
    sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_FIELD", c->path, loc, NULL, "%s[%d]%s%s: %s", section, index, id && id[0] ? " «" : "", id && id[0] ? id : "", msg);
}

static bool get_float(Ctx *c, const R2dJson *o, const char *section, int index, const char *id, const char *key, float *out, bool required, float def)
{
    const R2dJson *v = r2d_json_get(o, key);
    if (!v) {
        if (required) {
            char m[96];
            snprintf(m, sizeof m, "нет поля %s", key);
            field_diag(c, section, index, id, key, m);
            return false;
        }
        *out = def;
        return true;
    }
    if (v->type != R2D_JSON_NUM || !isfinite(v->number)) {
        char m[96];
        snprintf(m, sizeof m, "поле %s должно быть конечным числом", key);
        field_diag(c, section, index, id, key, m);
        return false;
    }
    if (fabs(v->number) > W_LIMIT) {
        char loc[2048], m[96];
        snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"index\":%d,\"id\":\"%s\",\"field\":\"%s\"}", section, index, json_fragment(id ? id : ""), key);
        snprintf(m, sizeof m, "поле %s вне ±1000000", key);
        sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_RANGE", c->path, loc, NULL, "%s[%d]: %s", section, index, m);
        return false;
    }
    *out = (float)v->number;
    return true;
}

static bool get_pair(Ctx *c, const R2dJson *o, const char *section, int index, const char *id, const char *key, float out[2])
{
    const R2dJson *v = r2d_json_get(o, key);
    if (!v || v->type != R2D_JSON_ARR || v->count != 2 || v->items[0]->type != R2D_JSON_NUM || v->items[1]->type != R2D_JSON_NUM) {
        field_diag(c, section, index, id, key, "нужен массив из двух чисел [x, y]");
        return false;
    }
    for (int i = 0; i < 2; ++i) {
        if (!isfinite(v->items[i]->number)) {
            field_diag(c, section, index, id, key, "координата должна быть конечной");
            return false;
        }
        if (fabs(v->items[i]->number) > W_LIMIT) {
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"index\":%d,\"id\":\"%s\",\"field\":\"%s\"}", section, index, json_fragment(id), key);
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_RANGE", c->path, loc, NULL, "%s: координата вне ±1000000", key);
            return false;
        }
        out[i] = (float)v->items[i]->number;
    }
    return true;
}

static bool get_rect(Ctx *c, const R2dJson *o, const char *section, int index, const char *id, const char *key, float r[4])
{
    const R2dJson *v = r2d_json_get(o, key);
    if (!v || v->type != R2D_JSON_ARR || v->count != 4) {
        field_diag(c, section, index, id, key, "нужен массив [x, y, w, h]");
        return false;
    }
    for (int i = 0; i < 4; ++i) {
        if (v->items[i]->type != R2D_JSON_NUM || !isfinite(v->items[i]->number)) {
            field_diag(c, section, index, id, key, "числа [x, y, w, h] должны быть конечными в пределах ±1000000");
            return false;
        }
        if (fabs(v->items[i]->number) > W_LIMIT) {
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"index\":%d,\"id\":\"%s\",\"field\":\"%s\"}", section, index, json_fragment(id), key);
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_RANGE", c->path, loc, NULL, "%s: значение вне ±1000000", key);
            return false;
        }
        r[i] = (float)v->items[i]->number;
    }
    if (!(r[2] > 0) || !(r[3] > 0)) {
        char loc[2048];
        snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"index\":%d,\"id\":\"%s\",\"field\":\"%s\"}", section, index, json_fragment(id ? id : ""), key);
        sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_CELL_SIZE", c->path, loc, NULL, "%s[%d] «%s»: ширина и высота прямоугольника должны быть > 0", section, index, id ? id : "");
        return false;
    }
    return true;
}

// Цвет: строка; «#…» проверяется на длину и hex. Остальные формы принимает $.color.
static bool color_ok(const char *s)
{
    if (s[0] != '#') return s[0] != '\0';
    const size_t n = strlen(s + 1);
    if (n != 3 && n != 4 && n != 6 && n != 8) return false;
    for (size_t i = 1; i <= n; ++i) {
        const char ch = s[i];
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'))) return false;
    }
    return true;
}

static bool get_color(Ctx *c, const R2dJson *o, const char *section, int index, const char *id, const char *key, char *out, size_t cap, const char *def)
{
    const R2dJson *v = r2d_json_get(o, key);
    if (!v) { snprintf(out, cap, "%s", def); return true; }
    if (v->type != R2D_JSON_STR || !color_ok(v->string)) {
        field_diag(c, section, index, id, key, "цвет — строка вида #rrggbb");
        return false;
    }
    snprintf(out, cap, "%s", v->string);
    return true;
}

static bool get_id(Ctx *c, const R2dJson *o, const char *section, int index, char *out, size_t cap)
{
    const R2dJson *v = r2d_json_get(o, "id");
    if (!v || v->type != R2D_JSON_STR || !v->string[0] || strlen(v->string) >= cap) {
        field_diag(c, section, index, NULL, "id", "нужна непустая строка id (до 63 символов)");
        return false;
    }
    snprintf(out, cap, "%s", v->string);
    return true;
}

// Optional user surface tags (P0.1): array of <=32 strings, each trimmed to
// 1..32 printable bytes; duplicates ignored. Tags are data, not an SDK enum.
static bool get_tags(Ctx *c, const R2dJson *o, const char *section, int index, const char *id,
                     const char *key, char tags[R2D_WORLD_TAG_MAX][R2D_WORLD_TAG_LENGTH+1],
                     unsigned char *count)
{
    *count = 0;
    const R2dJson *arr = r2d_json_get(o, key);
    if (!arr) return true;
    if (arr->type != R2D_JSON_ARR || arr->count > R2D_WORLD_TAG_MAX) {
        field_diag(c, section, index, id, key, "нужен массив не более 32 строк-тегов");
        return false;
    }
    for (int i = 0; i < arr->count; ++i) {
        const R2dJson *v = arr->items[i];
        if (v->type != R2D_JSON_STR) {
            field_diag(c, section, index, id, key, "тег должен быть строкой");
            return false;
        }
        char name[R2D_WORLD_TAG_LENGTH+1];
        if (!r2d_world_tag_normalize(v->string, name, NULL)) {
            field_diag(c, section, index, id, key, "тег: 1..32 печатных байта после trim");
            return false;
        }
        bool duplicate = false;
        for (int j = 0; j < *count; ++j) if (!strcmp(tags[j], name)) { duplicate = true; break; }
        if (duplicate) continue;
        snprintf(tags[*count], R2D_WORLD_TAG_LENGTH+1, "%s", name);
        (*count)++;
    }
    return true;
}
static bool load_spans(Ctx *c, const R2dJson *o, const char *section, int index, const char *id, WSpan **out, int *n)
{
    const R2dJson *arr = r2d_json_get(o, "spans");
    if (!arr || arr->type != R2D_JSON_ARR || arr->count > W_MAX) {
        field_diag(c, section, index, id, "spans", "нужен массив spans");
        return false;
    }
    *n = arr->count;
    *out = (WSpan *)calloc((size_t)(arr->count ? arr->count : 1), sizeof(WSpan));
    bool ok = true;
    for (int i = 0; i < arr->count; ++i) {
        const R2dJson *s = arr->items[i];
        WSpan *sp = &(*out)[i];
        char sec[64];
        snprintf(sec, sizeof sec, "%s.spans", section);
        if (s->type != R2D_JSON_OBJ) { field_diag(c, sec, i, id, "span", "span должен быть объектом"); ok = false; continue; }
        ok &= get_float(c, s, sec, i, id, "bottom", &sp->bottom, true, 0);
        ok &= get_float(c, s, sec, i, id, "top", &sp->top, true, 0);
        ok &= get_color(c, s, sec, i, id, "floorColor", sp->floor_c, sizeof sp->floor_c, "#ffffff");
        ok &= get_color(c, s, sec, i, id, "ceilingColor", sp->ceil_c, sizeof sp->ceil_c, "#ffffff");
        ok &= get_tags(c, s, sec, i, id, "tags", sp->tags, &sp->ntag);
        ok &= get_tags(c, s, sec, i, id, "ceilingTags", sp->ceiling_tags, &sp->nceiling_tag);
        const R2dJson *lighting=r2d_json_get(s,"lighting");if(lighting){sp->lit=r2d_world_span_light_json(lighting,&sp->light);if(!sp->lit){field_diag(c,sec,i,id,"lighting","invalid classic span lighting");ok=false;}}
        if (ok && !(sp->top > sp->bottom)) {
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"index\":%d,\"id\":\"%s\",\"span\":%d}", section, index, json_fragment(id), i);
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_SPAN_HEIGHT", c->path, loc, NULL,
                     "cell «%s», span %d: top (%g) должен быть больше bottom (%g)", id, i, sp->top, sp->bottom);
            ok = false;
        }
    }
    return ok;
}

// ---------------------------------------------------------------------------
// Накопление скомпилированных данных
// ---------------------------------------------------------------------------
static CCell *add_cc(World *w)
{
    if (w->ncc == w->cap_cc) {
        w->cap_cc = w->cap_cc ? w->cap_cc * 2 : 16;
        w->cc = (CCell *)realloc(w->cc, (size_t)w->cap_cc * sizeof(CCell));
    }
    CCell *c = &w->cc[w->ncc++];
    memset(c, 0, sizeof *c);
    c->explicit_index = -1;
    return c;
}

static WWall *add_cw(World *w)
{
    if (w->ncw == w->cap_cw) {
        w->cap_cw = w->cap_cw ? w->cap_cw * 2 : 16;
        w->cw = (WWall *)realloc(w->cw, (size_t)w->cap_cw * sizeof(WWall));
    }
    WWall *c = &w->cw[w->ncw++];
    memset(c, 0, sizeof *c);
    return c;
}

static void put_num(R2dSb *sb, float v) { r2d_sb_put_json_number(sb, (double)v); }

// ---------------------------------------------------------------------------
// Загрузка исходника
// ---------------------------------------------------------------------------
static bool dup_check(Ctx *c, const char *section, char (*ids)[64], int n, int i)
{
    for (int j = 0; j < i; ++j) {
        if (!strcmp(ids[j], ids[i])) {
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"index\":%d,\"id\":\"%s\"}", section, i, json_fragment(ids[i]));
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_ID_DUPLICATE", c->path, loc, NULL, "%s: id «%s» повторяется (индексы %d и %d)", section, ids[i], j, i);
            return false;
        }
    }
    (void)n;
    return true;
}


// --- Polygon cells (P1 authoring) -----------------------------------------
// Compiler-side only: rectilinear authored polygons are tiled into axis-aligned
// runtime cells (the runtime cell model stays XY-rect based). Slanted edges are
// an explicit SDK_ERROR, never a silent AABB fallback.
typedef struct { float x,y,w,h; } PolyRect;
typedef struct { WWall wall; } GenWall;

static WSpan *clone_spans(const WSpan *src, int n)
{
    if (n <= 0) return NULL;
    WSpan *copy = (WSpan *)malloc((size_t)n * sizeof *copy);
    if (copy) memcpy(copy, src, (size_t)n * sizeof *copy);
    return copy;
}
static int cmp_float(const void *a, const void *b)
{
    float x = *(const float *)a, y = *(const float *)b;
    return x < y ? -1 : x > y ? 1 : 0;
}
static int dedupe_floats(float *v, int n)
{
    int out = 0;
    for (int i = 0; i < n; ++i) if (!out || fabsf(v[i] - v[out - 1]) > W_EPS) v[out++] = v[i];
    return out;
}
static bool point_in_ring(const R2DWorldPoint *ring, int n, float x, float y)
{
    bool inside = false;
    for (int i = 0, j = n - 1; i < n; j = i++) {
        const R2DWorldPoint *a = &ring[i], *b = &ring[j];
        if (((a->y > y) != (b->y > y)) &&
            (x < (b->x - a->x) * (y - a->y) / (b->y - a->y) + a->x)) inside = !inside;
    }
    return inside;
}
static int polygon_rect_tiles(const R2DWorldPoint *ring, int n, PolyRect *tiles, int cap, char *err, size_t errsz)
{
    if (!ring || n < 3 || !tiles || cap <= 0) return -1;
    for (int i = 0; i < n; ++i) {
        const R2DWorldPoint *a = &ring[i], *b = &ring[(i + 1) % n];
        if (fabsf(a->x - b->x) > W_EPS && fabsf(a->y - b->y) > W_EPS) {
            snprintf(err, errsz, "polygon edge %d→%d is slanted; P1 runtime supports rectilinear polygons only", i, (i + 1) % n);
            return -1;
        }
    }
    if (!r2d_world_polygon_valid(ring, n, err, errsz)) return -1;
    float *xs = (float *)malloc((size_t)n * 2 * sizeof *xs);
    float *ys = (float *)malloc((size_t)n * 2 * sizeof *ys);
    if (!xs || !ys) { free(xs); free(ys); snprintf(err, errsz, "polygon tiling out of memory"); return -1; }
    for (int i = 0; i < n; ++i) { xs[i] = ring[i].x; ys[i] = ring[i].y; }
    qsort(xs, (size_t)n, sizeof *xs, cmp_float);
    qsort(ys, (size_t)n, sizeof *ys, cmp_float);
    const int nx = dedupe_floats(xs, n), ny = dedupe_floats(ys, n);
    int count = 0;
    for (int ix = 0; ix + 1 < nx; ++ix) for (int iy = 0; iy + 1 < ny; ++iy) {
        const float x0 = xs[ix], x1 = xs[ix + 1], y0 = ys[iy], y1 = ys[iy + 1];
        if (x1 - x0 <= W_EPS || y1 - y0 <= W_EPS) continue;
        if (!point_in_ring(ring, n, (x0 + x1) * 0.5f, (y0 + y1) * 0.5f)) continue;
        if (count == cap) { free(xs); free(ys); snprintf(err, errsz, "polygon needs more than %d tiles", cap); return -1; }
        tiles[count++] = (PolyRect){x0, y0, x1 - x0, y1 - y0};
    }
    free(xs); free(ys);
    if (!count) { snprintf(err, errsz, "polygon tiled to zero cells"); return -1; }
    return count;
}
static bool polygon_boundary_side(const PolyRect *tiles, int n, int i, int side)
{
    const PolyRect *a = &tiles[i];
    for (int j = 0; j < n; ++j) {
        if (j == i) continue;
        const PolyRect *b = &tiles[j];
        if (side == 0 && fabsf(a->x - (b->x + b->w)) < W_EPS && fabsf(a->y - b->y) < W_EPS && fabsf(a->h - b->h) < W_EPS) return true;
        if (side == 1 && fabsf((a->x + a->w) - b->x) < W_EPS && fabsf(a->y - b->y) < W_EPS && fabsf(a->h - b->h) < W_EPS) return true;
        if (side == 2 && fabsf(a->y - (b->y + b->h)) < W_EPS && fabsf(a->x - b->x) < W_EPS && fabsf(a->w - b->w) < W_EPS) return true;
        if (side == 3 && fabsf((a->y + a->h) - b->y) < W_EPS && fabsf(a->x - b->x) < W_EPS && fabsf(a->w - b->w) < W_EPS) return true;
    }
    return false;
}
static bool parse_polygon(Ctx *c, const R2dJson *o, int index, const char *id, R2DWorldPoint *ring, int *count)
{
    const R2dJson *poly = r2d_json_get(o, "polygon");
    if (!poly || poly->type != R2D_JSON_ARR || poly->count < 3 || poly->count > 1024) {
        field_diag(c, "cells", index, id, "polygon", "нужен массив вершин [(x,y),...] (3..1024)");
        return false;
    }
    for (int i = 0; i < poly->count; ++i) {
        const R2dJson *pt = poly->items[i];
        if (pt->type != R2D_JSON_ARR || pt->count != 2 ||
            pt->items[0]->type != R2D_JSON_NUM || pt->items[1]->type != R2D_JSON_NUM) {
            field_diag(c, "cells", index, id, "polygon", "вершина должна быть [x, y]");
            return false;
        }
        ring[i].x = (float)pt->items[0]->number;
        ring[i].y = (float)pt->items[1]->number;
        if (!isfinite(ring[i].x) || !isfinite(ring[i].y) || fabsf(ring[i].x) > W_LIMIT || fabsf(ring[i].y) > W_LIMIT) {
            field_diag(c, "cells", index, id, "polygon", "координаты вершин должны быть конечными");
            return false;
        }
    }
    *count = poly->count;
    return true;
}

static bool parse_brush_policy(Ctx *c, const R2dJson *o, int index, const char *id,
                               SdkBrushTool tool, uint16_t *out)
{
    uint16_t flags = sdk_brush_tool_flags(tool);
    const R2dJson *render = r2d_json_get(o, "render");
    const R2dJson *collision = r2d_json_get(o, "collision");
    const R2dJson *shadows = r2d_json_get(o, "shadows");
    const R2dJson *cast = r2d_json_get(o, "castShadow");
    const R2dJson *acoustic = r2d_json_get(o, "acoustic");
    const R2dJson *explicit_flags = r2d_json_get(o, "flags");
    if (explicit_flags) {
        if (explicit_flags->type != R2D_JSON_NUM || !isfinite(explicit_flags->number) ||
            explicit_flags->number < 0 || explicit_flags->number > 65535 ||
            floor(explicit_flags->number) != explicit_flags->number) {
            field_diag(c, "brushes", index, id, "flags", "flags — целое 0..65535");
            return false;
        }
        *out = (uint16_t)explicit_flags->number;
        return true;
    }
    if ((render && render->type != R2D_JSON_BOOL) ||
        (collision && collision->type != R2D_JSON_BOOL) ||
        (shadows && shadows->type != R2D_JSON_BOOL) ||
        (cast && cast->type != R2D_JSON_BOOL) ||
        (acoustic && acoustic->type != R2D_JSON_BOOL)) {
        field_diag(c, "brushes", index, id, "render/collision/shadows",
                   "render, collision, shadows, castShadow, acoustic — bool");
        return false;
    }
    if ((render || collision || shadows || cast || acoustic) && flags == 0)
        flags = (uint16_t)R2D_WALL_DEFAULT_POLICY;
    if (render) {
        if (render->boolean) flags |= R2D_WALL_RENDER;
        else flags &= (uint16_t)~R2D_WALL_RENDER;
    }
    if (collision) {
        if (collision->boolean) flags |= R2D_WALL_COLLIDE;
        else flags &= (uint16_t)~R2D_WALL_COLLIDE;
    }
    if (shadows) {
        if (shadows->boolean) flags |= R2D_WALL_SHADOW;
        else flags &= (uint16_t)~R2D_WALL_SHADOW;
    }
    if (cast) {
        if (cast->boolean) flags |= R2D_WALL_SHADOW;
        else flags &= (uint16_t)~R2D_WALL_SHADOW;
    }
    if (acoustic) {
        if (acoustic->boolean) flags |= R2D_WALL_ACOUSTIC;
        else flags &= (uint16_t)~R2D_WALL_ACOUSTIC;
    }
    *out = flags;
    return true;
}

static bool parse_brush(Ctx *c, const R2dJson *o, int index, SdkBrushSpec *brush)
{
    memset(brush, 0, sizeof *brush);
    if (!get_id(c, o, "brushes", index, brush->id, sizeof brush->id)) return false;
    const char *tool_name = r2d_json_str(r2d_json_get(o, "tool"), "solid");
    if (!sdk_brush_tool_parse(tool_name, &brush->tool)) {
        field_diag(c, "brushes", index, brush->id, "tool",
                   "tool: solid|nodraw|sky|hint|skip|trigger|areaportal|clip|enemyclip|playerclip|occluder");
        return false;
    }
    // Tool brushes that only affect the compiler never carve solid space.
    bool solid = !(brush->tool == SDK_BRUSH_TOOL_HINT ||
                   brush->tool == SDK_BRUSH_TOOL_SKIP ||
                   brush->tool == SDK_BRUSH_TOOL_TRIGGER ||
                   brush->tool == SDK_BRUSH_TOOL_AREAPORTAL ||
                   brush->tool == SDK_BRUSH_TOOL_OCCLUDER);
    const R2dJson *solid_json = r2d_json_get(o, "solid");
    const R2dJson *carve_json = r2d_json_get(o, "carve");
    if ((solid_json && solid_json->type != R2D_JSON_BOOL) ||
        (carve_json && carve_json->type != R2D_JSON_BOOL)) {
        field_diag(c, "brushes", index, brush->id, "solid", "solid/carve — bool");
        return false;
    }
    if (solid_json) solid = solid_json->boolean;
    if (carve_json) solid = carve_json->boolean;
    brush->solid = solid;
    brush->carve = solid;
    const R2dJson *subtract_json = r2d_json_get(o, "subtract");
    if (subtract_json) {
        if (subtract_json->type != R2D_JSON_BOOL) {
            field_diag(c, "brushes", index, brush->id, "subtract", "subtract — bool");
            return false;
        }
        brush->subtract = subtract_json->boolean;
    }
    if (brush->subtract && (!solid || brush->tool != SDK_BRUSH_TOOL_NONE)) {
        field_diag(c, "brushes", index, brush->id, "subtract",
                   "subtract brush must be a plain solid brush (no tool)");
        return false;
    }

    if (!get_float(c, o, "brushes", index, brush->id, "bottom", &brush->bottom, true, 0) ||
        !get_float(c, o, "brushes", index, brush->id, "top", &brush->top, true, 0))
        return false;
    if (!(brush->top > brush->bottom)) {
        field_diag(c, "brushes", index, brush->id, "top", "top должен быть больше bottom");
        return false;
    }
    if (!get_color(c, o, "brushes", index, brush->id, "sideColor",
                   brush->side_color, sizeof brush->side_color, "#8f7a58") ||
        !get_color(c, o, "brushes", index, brush->id, "floorColor",
                   brush->floor_color, sizeof brush->floor_color, "#9a9a9a") ||
        !get_color(c, o, "brushes", index, brush->id, "ceilingColor",
                   brush->ceiling_color, sizeof brush->ceiling_color, "#6a7078"))
        return false;
    if (!get_tags(c, o, "brushes", index, brush->id, "tags",
                  brush->tags.names, &brush->tags.count) ||
        !get_tags(c, o, "brushes", index, brush->id, "ceilingTags",
                  brush->ceiling_tags.names, &brush->ceiling_tags.count))
        return false;
    snprintf(brush->visgroup, sizeof brush->visgroup, "%s",
             r2d_json_str(r2d_json_get(o, "visgroup"), ""));

    const R2dJson *poly = r2d_json_get(o, "polygon");
    if (poly) {
        if (poly->type != R2D_JSON_ARR || poly->count < 3 || poly->count > SDK_BRUSH_MAX_POINTS) {
            field_diag(c, "brushes", index, brush->id, "polygon", "polygon: 3..64 вершин [x,y]");
            return false;
        }
        brush->ring_count = poly->count;
        for (int i = 0; i < poly->count; i++) {
            const R2dJson *pt = poly->items[i];
            if (pt->type != R2D_JSON_ARR || pt->count != 2 ||
                pt->items[0]->type != R2D_JSON_NUM || pt->items[1]->type != R2D_JSON_NUM ||
                !isfinite(pt->items[0]->number) || !isfinite(pt->items[1]->number) ||
                fabs(pt->items[0]->number) > W_LIMIT || fabs(pt->items[1]->number) > W_LIMIT) {
                field_diag(c, "brushes", index, brush->id, "polygon", "вершина должна быть [x,y]");
                return false;
            }
            brush->ring[i].x = (float)pt->items[0]->number;
            brush->ring[i].y = (float)pt->items[1]->number;
        }
    } else {
        float r[4];
        if (!get_rect(c, o, "brushes", index, brush->id, "rect", r)) return false;
        brush->ring_count = 4;
        brush->ring[0] = (SdkBrushPoint){r[0], r[1]};
        brush->ring[1] = (SdkBrushPoint){r[0] + r[2], r[1]};
        brush->ring[2] = (SdkBrushPoint){r[0] + r[2], r[1] + r[3]};
        brush->ring[3] = (SdkBrushPoint){r[0], r[1] + r[3]};
    }

    // Rectilinear holes: [[x,y,w,h], ...] or [{x,y,w,h}, ...].
    const R2dJson *holes = r2d_json_get(o, "holes");
    if (holes) {
        if (holes->type != R2D_JSON_ARR || holes->count > SDK_BRUSH_MAX_HOLES) {
            field_diag(c, "brushes", index, brush->id, "holes",
                       "holes: массив до 8 прямоугольников [x,y,w,h]");
            return false;
        }
        brush->hole_count = holes->count;
        for (int h = 0; h < holes->count; h++) {
            SdkBrushHole *hole = &brush->holes[h];
            const R2dJson *item = holes->items[h];
            if (item->type == R2D_JSON_ARR && item->count == 4) {
                for (int k = 0; k < 4; k++) {
                    const R2dJson *v = item->items[k];
                    if (v->type != R2D_JSON_NUM || !isfinite(v->number) ||
                        fabs(v->number) > W_LIMIT) {
                        field_diag(c, "brushes", index, brush->id, "holes",
                                   "hole: [x,y,w,h] из конечных чисел");
                        return false;
                    }
                }
                hole->x = (float)item->items[0]->number;
                hole->y = (float)item->items[1]->number;
                hole->w = (float)item->items[2]->number;
                hole->h = (float)item->items[3]->number;
            } else if (item->type == R2D_JSON_OBJ) {
                float v[4];
                if (!get_float(c, item, "brushes", index, brush->id, "x", &v[0], true, 0) ||
                    !get_float(c, item, "brushes", index, brush->id, "y", &v[1], true, 0) ||
                    !get_float(c, item, "brushes", index, brush->id, "w", &v[2], true, 0) ||
                    !get_float(c, item, "brushes", index, brush->id, "h", &v[3], true, 0))
                    return false;
                hole->x = v[0]; hole->y = v[1]; hole->w = v[2]; hole->h = v[3];
            } else {
                field_diag(c, "brushes", index, brush->id, "holes",
                           "hole: [x,y,w,h] или {x,y,w,h}");
                return false;
            }
            if (!(hole->w > 0) || !(hole->h > 0)) {
                field_diag(c, "brushes", index, brush->id, "holes",
                           "hole: w/h должны быть > 0");
                return false;
            }
        }
    }
    return parse_brush_policy(c, o, index, brush->id, brush->tool, &brush->wall_flags);
}

static bool load_brush_bounds(Ctx *c, const R2dJson *root, World *w)
{
    const R2dJson *region_size = r2d_json_get(root, "regionSize");
    w->region_size = 1024.0f;
    if (region_size) {
        if (region_size->type != R2D_JSON_NUM || !isfinite(region_size->number) ||
            region_size->number < 16.0 || region_size->number > W_LIMIT) {
            field_diag(c, "world", 0, NULL, "regionSize", "regionSize — число 16..1000000");
            return false;
        }
        w->region_size = (float)region_size->number;
    }
    if (w->nbrush == 0) return true;
    SdkBrushBounds bounds;
    memset(&bounds, 0, sizeof bounds);
    const R2dJson *world = r2d_json_get(root, "world");
    if (!world) world = r2d_json_get(root, "bounds");
    bool derived = false;
    if (world) {
        float r[4], bottom = 0, top = 0;
        const R2dJson *rect = r2d_json_get(world, "rect");
        if (rect) {
            if (!get_rect(c, world, "world", 0, NULL, "rect", r)) return false;
        } else {
            // Accept {x,y,w,h} as well as {rect:[...]}.
            if (!get_float(c, world, "world", 0, NULL, "x", &r[0], true, 0) ||
                !get_float(c, world, "world", 0, NULL, "y", &r[1], true, 0) ||
                !get_float(c, world, "world", 0, NULL, "w", &r[2], true, 0) ||
                !get_float(c, world, "world", 0, NULL, "h", &r[3], true, 0))
                return false;
            if (!(r[2] > 0) || !(r[3] > 0)) {
                field_diag(c, "world", 0, NULL, "w", "world bounds: w/h > 0");
                return false;
            }
        }
        if (!get_float(c, world, "world", 0, NULL, "bottom", &bottom, true, 0) ||
            !get_float(c, world, "world", 0, NULL, "top", &top, true, 0))
            return false;
        if (!(top > bottom)) {
            field_diag(c, "world", 0, NULL, "top", "world bounds: top > bottom");
            return false;
        }
        bounds.x = r[0]; bounds.y = r[1]; bounds.w = r[2]; bounds.h = r[3];
        bounds.bottom = bottom; bounds.top = top;
        if (!get_color(c, world, "world", 0, NULL, "floorColor",
                       bounds.floor_color, sizeof bounds.floor_color, "#9a9a9a") ||
            !get_color(c, world, "world", 0, NULL, "ceilingColor",
                       bounds.ceiling_color, sizeof bounds.ceiling_color, "#6a7078") ||
            !get_color(c, world, "world", 0, NULL, "sideColor",
                       bounds.side_color, sizeof bounds.side_color, "#8f7a58"))
            return false;
        if (!get_tags(c, world, "world", 0, NULL, "tags",
                      bounds.tags.names, &bounds.tags.count) ||
            !get_tags(c, world, "world", 0, NULL, "ceilingTags",
                      bounds.ceiling_tags.names, &bounds.ceiling_tags.count))
            return false;
        SdkBrushTool boundary = SDK_BRUSH_TOOL_SKY;
        const char *boundary_name = r2d_json_str(r2d_json_get(world, "boundary"), "sky");
        if (!sdk_brush_tool_parse(boundary_name, &boundary)) {
            field_diag(c, "world", 0, NULL, "boundary", "boundary: sky|nodraw|clip|solid");
            return false;
        }
        bounds.boundary_flags = sdk_brush_tool_flags(boundary);
        if (bounds.boundary_flags == 0) bounds.boundary_flags = R2D_WALL_DEFAULT_POLICY;
    } else {
        // Derive a usable envelope with a one-cell margin around all brushes.
        float minx = INFINITY, miny = INFINITY, maxx = -INFINITY, maxy = -INFINITY;
        float bottom = INFINITY, top = -INFINITY;
        for (int i = 0; i < w->nbrush; i++) {
            const SdkBrushSpec *b = &w->brushes[i];
            for (int p = 0; p < b->ring_count; p++) {
                minx = fminf(minx, b->ring[p].x);
                miny = fminf(miny, b->ring[p].y);
                maxx = fmaxf(maxx, b->ring[p].x);
                maxy = fmaxf(maxy, b->ring[p].y);
            }
            bottom = fminf(bottom, b->bottom);
            top = fmaxf(top, b->top);
        }
        const float margin = 64.0f;
        bounds.x = minx - margin; bounds.y = miny - margin;
        bounds.w = (maxx - minx) + margin * 2.0f;
        bounds.h = (maxy - miny) + margin * 2.0f;
        bounds.bottom = bottom; bounds.top = top;
        snprintf(bounds.floor_color, sizeof bounds.floor_color, "#9a9a9a");
        snprintf(bounds.ceiling_color, sizeof bounds.ceiling_color, "#6a7078");
        snprintf(bounds.side_color, sizeof bounds.side_color, "#8f7a58");
        bounds.boundary_flags = sdk_brush_tool_flags(SDK_BRUSH_TOOL_SKY);
        derived = true;
    }
    if (derived) {
        char loc[2048];
        snprintf(loc, sizeof loc, "{\"section\":\"brushes\",\"brushCount\":%d}", w->nbrush);
        sdk_diag(c->rep, SDK_WARNING, "SDK_WORLD_BRUSH_BOUNDS_DERIVED", c->path, loc, NULL,
                 "Карта без блока «world»: границы выведены из brushes с полями %g; авторский sky/clip-контур не задан",
                 (double)64.0f);
    }
    // Compile and append.
    SdkBrushOutput output;
    SdkBrushStats stats;
    char error[256] = {0};
    clock_t started = clock();
    if (!sdk_brush_compile(w->brushes, w->nbrush, &bounds, &output, &stats,
                           error, sizeof error)) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_BRUSH_COMPILE", c->path, NULL, NULL,
                 "Компиляция brushes: %s", error);
        sdk_brush_output_free(&output);
        return false;
    }
    w->brush_stats = stats;
    (void)started;
    bool ok = true;
    if (w->ncell + output.cell_count > W_MAX || w->nwall + output.wall_count > W_MAX ||
        w->nportal + output.portal_count > W_MAX) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_LIMIT", c->path, NULL, NULL,
                 "Brushes превышают лимит %d cells/walls/portals", W_MAX);
        ok = false;
    }
    if (ok && output.cell_count) {
        WCell *grown = (WCell *)realloc(w->cells, (size_t)(w->ncell + output.cell_count) * sizeof(WCell));
        if (!grown) ok = false;
        else {
            w->cells = grown;
            for (int i = 0; i < output.cell_count; i++) {
                const SdkBrushCell *bc = &output.cells[i];
                WCell *cell = &w->cells[w->ncell + i];
                memset(cell, 0, sizeof *cell);
                snprintf(cell->id, sizeof cell->id, "%s", bc->owner);
                cell->x = bc->x; cell->y = bc->y; cell->w = bc->w; cell->h = bc->h;
                cell->nspan = bc->span_count;
                cell->spans = (WSpan *)calloc((size_t)(cell->nspan ? cell->nspan : 1), sizeof(WSpan));
                if (!cell->spans) { ok = false; break; }
                for (int s = 0; s < cell->nspan; s++) {
                    const SdkBrushSpan *bs = &output.spans[bc->first_span + s];
                    cell->spans[s].bottom = bs->bottom;
                    cell->spans[s].top = bs->top;
                    snprintf(cell->spans[s].floor_c, sizeof cell->spans[s].floor_c, "%s", bs->floor_color);
                    snprintf(cell->spans[s].ceil_c, sizeof cell->spans[s].ceil_c, "%s", bs->ceiling_color);
                    cell->spans[s].ntag = bs->tags.count;
                    cell->spans[s].nceiling_tag = bs->ceiling_tags.count;
                    for (int t = 0; t < (int)bs->tags.count; t++)
                        snprintf(cell->spans[s].tags[t], R2D_WORLD_TAG_LENGTH+1, "%s", bs->tags.names[t]);
                    for (int t = 0; t < (int)bs->ceiling_tags.count; t++)
                        snprintf(cell->spans[s].ceiling_tags[t], R2D_WORLD_TAG_LENGTH+1, "%s", bs->ceiling_tags.names[t]);
                }
                cell->generated = true;
                cell->portal_authored = true;
            }
            if (ok) w->ncell += output.cell_count;
        }
    }
    if (ok && output.wall_count) {
        WWall *grown = (WWall *)realloc(w->walls, (size_t)(w->nwall + output.wall_count) * sizeof(WWall));
        if (!grown) ok = false;
        else {
            w->walls = grown;
            for (int i = 0; i < output.wall_count; i++) {
                const SdkBrushWall *bw = &output.walls[i];
                WWall *wall = &w->walls[w->nwall + i];
                memset(wall, 0, sizeof *wall);
                snprintf(wall->id, sizeof wall->id, "%s", bw->id);
                wall->x1 = bw->x1; wall->y1 = bw->y1;
                wall->x2 = bw->x2; wall->y2 = bw->y2;
                wall->bottom = bw->bottom; wall->top = bw->top;
                snprintf(wall->color, sizeof wall->color, "%s", bw->color);
                wall->flags = bw->flags;
            }
            w->nwall += output.wall_count;
        }
    }
    if (ok && output.portal_count) {
        WPortal *grown = (WPortal *)realloc(w->portals, (size_t)(w->nportal + output.portal_count) * sizeof(WPortal));
        if (!grown) ok = false;
        else {
            w->portals = grown;
            for (int i = 0; i < output.portal_count; i++) {
                const SdkBrushPortal *bp = &output.portals[i];
                WPortal *portal = &w->portals[w->nportal + i];
                memset(portal, 0, sizeof *portal);
                snprintf(portal->id, sizeof portal->id, "%s", bp->id);
                snprintf(portal->a, sizeof portal->a, "%s", output.cells[bp->cell_a].owner);
                snprintf(portal->b, sizeof portal->b, "%s", output.cells[bp->cell_b].owner);
                portal->x1 = bp->ax; portal->y1 = bp->ay;
                portal->x2 = bp->bx; portal->y2 = bp->by;
                portal->nopen = bp->opening_count;
                portal->open = (WOpening *)calloc((size_t)(portal->nopen ? portal->nopen : 1), sizeof(WOpening));
                if (!portal->open) { ok = false; break; }
                for (int k = 0; k < portal->nopen; k++)
                    portal->open[k] = (WOpening){output.openings[bp->first_opening + k].bottom,
                                                 output.openings[bp->first_opening + k].top};
                portal->area_portal = bp->area_portal;
            }
            if (ok) w->nportal += output.portal_count;
        }
    }
    sdk_brush_output_free(&output);
    return ok;
}

static bool entity_kind_known(const char *kind)
{
    static const char *const kinds[] = {
        "player_spawn", "enemy_spawn", "item_spawn", "light", "audio_source",
        "trigger", "camera_marker", "narrative_marker", "particle_emitter",
        "door", "lift", "crusher", "moving_wall", "trigger_volume",
        "fog_volume", "water_volume", "areaportal"
    };
    for (size_t i = 0; i < sizeof kinds / sizeof kinds[0]; i++)
        if (!strcmp(kind, kinds[i])) return true;
    return false;
}

// Kinds that own a brush volume and map onto an existing runtime contract.
static bool brush_entity_kind_known(const char *kind)
{
    static const char *const kinds[] = {
        "door", "lift", "crusher", "moving_wall", "trigger", "trigger_volume",
        "fog_volume", "water_volume", "areaportal"
    };
    for (size_t i = 0; i < sizeof kinds / sizeof kinds[0]; i++)
        if (!strcmp(kind, kinds[i])) return true;
    return false;
}

static bool load_entities(Ctx *c, const R2dJson *root, World *w)
{
    const R2dJson *entities = r2d_json_get(root, "entities");
    if (!entities) return true;
    if (entities->type != R2D_JSON_ARR || entities->count > W_MAX) {
        field_diag(c, "entities", -1, NULL, "entities", "entities — массив (до 65536)");
        return false;
    }
    char (*ids)[64] = (char (*)[64])calloc((size_t)(entities->count ? entities->count : 1), 64);
    w->entity_refs = (SdkBrushEntityRef *)calloc(
        (size_t)(entities->count ? entities->count : 1), sizeof(SdkBrushEntityRef));
    if (!ids || !w->entity_refs) { free(ids); return false; }
    bool ok = true;
    for (int i = 0; i < entities->count && ok; i++) {
        const R2dJson *o = entities->items[i];
        if (o->type != R2D_JSON_OBJ) { field_diag(c, "entities", i, NULL, "entity", "entity — объект"); ok = false; break; }
        if (!get_id(c, o, "entities", i, ids[i], sizeof ids[i])) { ok = false; break; }
        for (int j = 0; j < i; j++) if (!strcmp(ids[j], ids[i])) {
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"section\":\"entities\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(ids[i]));
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_ID_DUPLICATE", c->path, loc, NULL,
                     "entities: id «%s» повторяется", ids[i]);
            ok = false;
        }
        if (!ok) break;
        const char *kind = r2d_json_str(r2d_json_get(o, "kind"), "");
        if (!entity_kind_known(kind)) {
            field_diag(c, "entities", i, ids[i], "kind",
                       "kind: player_spawn|enemy_spawn|item_spawn|light|audio_source|trigger|camera_marker|narrative_marker|particle_emitter|door|lift|crusher|moving_wall|trigger_volume|fog_volume|water_volume|areaportal");
            ok = false;
            break;
        }
        const R2dJson *brush = r2d_json_get(o, "brush");
        if (brush && brush->type != R2D_JSON_STR) { field_diag(c, "entities", i, ids[i], "brush", "brush — строка id"); ok = false; break; }
        if (brush && brush->string[0]) {
            bool found = false;
            for (int b = 0; b < w->nbrush; b++) if (!strcmp(w->brushes[b].id, brush->string)) found = true;
            if (!found) {
                field_diag(c, "entities", i, ids[i], "brush", "brush ссылается на несуществующий brush");
                ok = false;
                break;
            }
            if (!brush_entity_kind_known(kind)) {
                field_diag(c, "entities", i, ids[i], "kind",
                           "brush entity kind: door|lift|crusher|moving_wall|trigger|trigger_volume|fog_volume|water_volume|areaportal");
                ok = false;
                break;
            }
            SdkBrushEntityRef *ref = &w->entity_refs[w->nentity_refs++];
            snprintf(ref->id, sizeof ref->id, "%s", ids[i]);
            snprintf(ref->kind, sizeof ref->kind, "%s", kind);
            snprintf(ref->brush, sizeof ref->brush, "%s", brush->string);
            snprintf(ref->target, sizeof ref->target, "%s",
                     r2d_json_str(r2d_json_get(o, "target"), ""));
            w->nbrush_entities++;
        } else {
            static const char *const brush_only[] = {
                "door", "lift", "crusher", "moving_wall", "trigger_volume",
                "fog_volume", "water_volume", "areaportal"
            };
            for (size_t k = 0; k < sizeof brush_only / sizeof brush_only[0]; k++) {
                if (!strcmp(kind, brush_only[k])) {
                    field_diag(c, "entities", i, ids[i], "brush",
                               "этот brush entity требует ссылку на brush");
                    ok = false;
                    break;
                }
            }
            if (!ok) break;
            w->npoint_entities++;
            const char *xy[] = {"x", "y", "h"};
            for (int a = 0; a < 3; a++) {
                const R2dJson *v = r2d_json_get(o, xy[a]);
                if (v && (v->type != R2D_JSON_NUM || !isfinite(v->number) || fabs(v->number) > W_LIMIT)) {
                    field_diag(c, "entities", i, ids[i], xy[a], "координата должна быть конечным числом");
                    ok = false;
                    break;
                }
            }
        }
    }
    free(ids);
    if (ok) w->nentities = entities->count;
    if (ok) {
        R2dSb compact;
        r2d_sb_init(&compact);
        sdk_json_put_compact(&compact, entities);
        free(w->entities_json);
        w->entities_json = compact.data;
    }
    return ok;
}

// Resolves brush entities to existing runtime contracts (metadata only). Failures
// are authoring errors: a brush entity must resolve to a real authored brush.
static bool build_entity_map(Ctx *c, World *w)
{
    if (w->nentity_refs <= 0) return true;
    char error[256] = {0};
    w->entity_map = (SdkBrushEntityMap *)calloc((size_t)w->nentity_refs,
                                                sizeof(SdkBrushEntityMap));
    if (!w->entity_map) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_OOM", c->path, NULL, NULL,
                 "brush entity map allocation failed");
        return false;
    }
    const int total = sdk_brush_map_entities(w->brushes, w->nbrush,
                                             w->entity_refs, w->nentity_refs,
                                             w->entity_map, w->nentity_refs,
                                             error, sizeof error);
    if (total < 0 || total != w->nentity_refs) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_BRUSH_ENTITY", c->path, NULL, NULL,
                 "Brush entity mapping failed: %s",
                 error[0] ? error : "count mismatch");
        return false;
    }
    w->nentity_map = total;

    // Resolve concrete wiring after the brush world exists:
    //  * areaportal -> nearest generated portal whose midpoint lies in the brush
    //    footprint; runtime consumes it through r2d_world_portal_set_area().
    //  * fog/water -> number of runtime spans covered by the authored volume;
    //    runtime consumes the volume through r2d_world_apply_*_volume().
    for (int i = 0; i < w->nentity_map; i++) {
        SdkBrushEntityMap *m = &w->entity_map[i];
        const SdkBrushSpec *brush = NULL;
        for (int b = 0; b < w->nbrush; b++)
            if (!strcmp(w->brushes[b].id, m->brush)) { brush = &w->brushes[b]; break; }
        if (!brush) continue;
        if (!strcmp(m->kind, "areaportal")) {
            for (int p = 0; p < w->nportal; p++) {
                const WPortal *portal = &w->portals[p];
                const float mx = (portal->x1 + portal->x2) * 0.5f;
                const float my = (portal->y1 + portal->y2) * 0.5f;
                float minx = INFINITY, miny = INFINITY, maxx = -INFINITY, maxy = -INFINITY;
                for (int v = 0; v < brush->ring_count; v++) {
                    minx = fminf(minx, brush->ring[v].x);
                    miny = fminf(miny, brush->ring[v].y);
                    maxx = fmaxf(maxx, brush->ring[v].x);
                    maxy = fmaxf(maxy, brush->ring[v].y);
                }
                if (mx >= minx - 1e-4f && mx <= maxx + 1e-4f &&
                    my >= miny - 1e-4f && my <= maxy + 1e-4f) {
                    m->portal = p;
                    snprintf(m->hook, sizeof m->hook, "%s", "");
                    if (!m->target[0])
                        snprintf(m->target, sizeof m->target, "%s", portal->id);
                    break;
                }
            }
            if (m->portal < 0)
                snprintf(m->hook, sizeof m->hook, "no generated portal under brush");
        } else if (!strcmp(m->kind, "fog_volume") ||
                   !strcmp(m->kind, "water_volume")) {
            int count = 0;
            for (int ci = 0; ci < w->ncell; ci++) {
                for (int si = 0; si < w->cells[ci].nspan; si++) {
                    const WSpan *span = &w->cells[ci].spans[si];
                    const float sx = w->cells[ci].x, sy = w->cells[ci].y;
                    const float sw = w->cells[ci].w, sh = w->cells[ci].h;
                    if (sx < m->x + m->w - 1e-4f && m->x < sx + sw - 1e-4f &&
                        sy < m->y + m->h - 1e-4f && m->y < sy + sh - 1e-4f &&
                        span->bottom < m->top - 1e-4f &&
                        m->bottom < span->top - 1e-4f)
                        count++;
                }
            }
            m->span_count = count;
        }
    }
    return true;
}


static bool load_world(const char *path, World *w, SdkReport *rep, bool renderer)
{
    memset(w, 0, sizeof *w);
    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return false;
    Ctx c = { rep, path };
    bool ok = true;
    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_WORLD_FORMAT", path, NULL, NULL, "Исходник карты должен быть объектом JSON");
        r2d_json_free(root);
        return false;
    }
    const R2dJson *ver = r2d_json_get(root, "version");
    if (!ver || ver->type != R2D_JSON_NUM || ver->number != 1) {
        sdk_diag(rep, SDK_ERROR, "SDK_WORLD_VERSION", path, "{\"field\":\"version\"}", NULL, "Поддержана version 1 (в файле: %s)", ver ? "другое значение" : "поля нет");
        r2d_json_free(root);
        return false;
    }
    snprintf(w->name, sizeof w->name, "%s", r2d_json_str(r2d_json_get(root, "name"), ""));
    w->authored_lights = r2d_json_size(r2d_json_get(root, "lights"));
    if(renderer){
        const char *fields[]={"lighting","lights"};char **outputs[]={&w->lighting_json,&w->lights_json};
        for(int i=0;i<2;i++){const R2dJson *value=r2d_json_get(root,fields[i]);if(value){R2dSb copy;r2d_sb_init(&copy);sdk_json_put_compact(&copy,value);*outputs[i]=copy.data;}}
    }


    // Reject malformed collections instead of silently compiling an empty map.
    const char *sections[] = {"cells", "walls", "portals", "stairs", "slopes"};
    for (int i = 0; i < 5; ++i) {
        const R2dJson *a = r2d_json_get(root, sections[i]);
        if (a && (a->type != R2D_JSON_ARR || a->count > W_MAX)) {
            field_diag(&c, sections[i], -1, NULL, sections[i], "нужен массив (не более 65536 элементов)");
            ok = false;
        }
    }
    if (!ok) { r2d_json_free(root); return false; }
    // --- cells: rect, or rectilinear polygon tiled into runtime XY rects ---
    const R2dJson *cells = r2d_json_get(root, "cells");
    const int authored_cells = r2d_json_size(cells);
    int cell_cap = authored_cells > 0 ? authored_cells : 1;
    w->cells = (WCell *)calloc((size_t)cell_cap, sizeof(WCell));
    w->ncell = 0;
    char (*cids)[64] = (char (*)[64])calloc((size_t)(authored_cells ? authored_cells : 1), 64);
    GenWall *gen_walls = NULL;
    int ngen_walls = 0, cap_gen_walls = 0;
    if (!w->cells || !cids) { sdk_diag(rep, SDK_ERROR, "SDK_OOM", path, NULL, NULL, "cells allocation failed"); ok = false; }
    for (int i = 0; ok && i < authored_cells; ++i) {
        const R2dJson *o = cells->items[i];
        char src_id[64] = {0};
        if (o->type != R2D_JSON_OBJ) { field_diag(&c, "cells", i, NULL, "cell", "cell должен быть объектом"); ok = false; break; }
        if (!get_id(&c, o, "cells", i, src_id, sizeof src_id)) { ok = false; break; }
        memcpy(cids[i], src_id, 64);
        WSpan *spans = NULL;
        int nspan = 0;
        if (!load_spans(&c, o, "cells", i, src_id, &spans, &nspan)) { ok = false; break; }
        if (nspan == 0) {
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"section\":\"cells\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(src_id));
            sdk_diag(rep, SDK_WARNING, "SDK_WORLD_CELL_NO_SPANS", path, loc, NULL, "cell «%s» без spans: в мир ничего не попадёт", src_id);
        }
        const R2dJson *poly = r2d_json_get(o, "polygon");
        if (poly) {
            R2DWorldPoint ring[1024];
            int ring_n = 0;
            char err[256] = {0};
            if (!parse_polygon(&c, o, i, src_id, ring, &ring_n)) { free(spans); ok = false; break; }
            PolyRect tiles[4096];
            const int tiles_n = polygon_rect_tiles(ring, ring_n, tiles, 4096, err, sizeof err);
            if (tiles_n < 0) {
                char loc[2048];
                snprintf(loc, sizeof loc, "{\"section\":\"cells\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(src_id));
                sdk_diag(rep, SDK_ERROR, "SDK_WORLD_POLYGON", path, loc, NULL, "polygon cell «%s»: %s", src_id, err);
                free(spans); ok = false; break;
            }
            for (int t = 0; t < tiles_n; ++t) {
                if (w->ncell >= W_MAX) { sdk_diag(rep, SDK_ERROR, "SDK_WORLD_LIMIT", path, NULL, NULL, "polygon tiling exceeded %d cells", W_MAX); ok = false; break; }
                if (w->ncell == cell_cap) {
                    int next = cell_cap * 2 > W_MAX ? W_MAX : cell_cap * 2;
                    WCell *grown = (WCell *)realloc(w->cells, (size_t)next * sizeof *grown);
                    if (!grown) { sdk_diag(rep, SDK_ERROR, "SDK_OOM", path, NULL, NULL, "cells growth failed"); ok = false; break; }
                    w->cells = grown; cell_cap = next;
                }
                WCell *cell = &w->cells[w->ncell];
                memset(cell, 0, sizeof *cell);
                if (tiles_n == 1) snprintf(cell->id, sizeof cell->id, "%s", src_id);
                else snprintf(cell->id, sizeof cell->id, "%s#%d", src_id, t);
                cell->x = tiles[t].x; cell->y = tiles[t].y; cell->w = tiles[t].w; cell->h = tiles[t].h;
                cell->spans = clone_spans(spans, nspan);
                if (nspan && !cell->spans) { sdk_diag(rep, SDK_ERROR, "SDK_OOM", path, NULL, NULL, "cell spans copy failed"); ok = false; break; }
                cell->nspan = nspan;
                cell->generated = true;
                w->ncell++;
                float bottom = nspan ? spans[0].bottom : 0, top = nspan ? spans[0].top : 0;
                for (int sp = 1; sp < nspan; ++sp) { if (spans[sp].bottom < bottom) bottom = spans[sp].bottom; if (spans[sp].top > top) top = spans[sp].top; }
                for (int side = 0; side < 4; ++side) {
                    if (polygon_boundary_side(tiles, tiles_n, t, side)) continue;
                    if (ngen_walls == cap_gen_walls) {
                        int next = cap_gen_walls ? cap_gen_walls * 2 : 16;
                        GenWall *grown = (GenWall *)realloc(gen_walls, (size_t)next * sizeof *grown);
                        if (!grown) { sdk_diag(rep, SDK_ERROR, "SDK_OOM", path, NULL, NULL, "boundary wall growth failed"); ok = false; break; }
                        gen_walls = grown; cap_gen_walls = next;
                    }
                    WWall wall; memset(&wall, 0, sizeof wall);
                    snprintf(wall.id, sizeof wall.id, "%s#b%d_%d", src_id, t, side);
                    const float x0 = tiles[t].x, y0 = tiles[t].y, x1 = x0 + tiles[t].w, y1 = y0 + tiles[t].h;
                    if (side == 0) { wall.x1 = x0; wall.y1 = y0; wall.x2 = x0; wall.y2 = y1; }
                    else if (side == 1) { wall.x1 = x1; wall.y1 = y0; wall.x2 = x1; wall.y2 = y1; }
                    else if (side == 2) { wall.x1 = x0; wall.y1 = y0; wall.x2 = x1; wall.y2 = y0; }
                    else { wall.x1 = x0; wall.y1 = y1; wall.x2 = x1; wall.y2 = y1; }
                    wall.bottom = bottom; wall.top = top;
                    snprintf(wall.color, sizeof wall.color, "%s", "#8f7a58");
                    gen_walls[ngen_walls++].wall = wall;
                }
                if (!ok) break;
            }
        } else {
            float r[4];
            if (!get_rect(&c, o, "cells", i, src_id, "rect", r)) { free(spans); ok = false; break; }
            if (w->ncell >= W_MAX) { sdk_diag(rep, SDK_ERROR, "SDK_WORLD_LIMIT", path, NULL, NULL, "too many cells"); free(spans); ok = false; break; }
            if (w->ncell == cell_cap) {
                int next = cell_cap * 2 > W_MAX ? W_MAX : cell_cap * 2;
                WCell *grown = (WCell *)realloc(w->cells, (size_t)next * sizeof *grown);
                if (!grown) { sdk_diag(rep, SDK_ERROR, "SDK_OOM", path, NULL, NULL, "cells growth failed"); free(spans); ok = false; break; }
                w->cells = grown; cell_cap = next;
            }
            WCell *cell = &w->cells[w->ncell++];
            memset(cell, 0, sizeof *cell);
            memcpy(cell->id, src_id, sizeof cell->id);
            cell->x = r[0]; cell->y = r[1]; cell->w = r[2]; cell->h = r[3];
            cell->spans = clone_spans(spans, nspan);
            if (nspan && !cell->spans) { sdk_diag(rep, SDK_ERROR, "SDK_OOM", path, NULL, NULL, "cell spans copy failed"); free(spans); ok = false; break; }
            cell->nspan = nspan;
        }
        free(spans);
    }
    for (int i = 0; i < authored_cells; ++i) if (cids[i][0] && !dup_check(&c, "cells", cids, authored_cells, i)) ok = false;
    free(cids);

    // --- walls ---
    const R2dJson *walls = r2d_json_get(root, "walls");
    w->nwall = r2d_json_size(walls);
    w->walls = (WWall *)calloc((size_t)(w->nwall ? w->nwall : 1), sizeof(WWall));
    char (*wids)[64] = (char (*)[64])calloc((size_t)(w->nwall ? w->nwall : 1), 64);
    for (int i = 0; i < w->nwall; ++i) {
        const R2dJson *o = walls->items[i];
        WWall *wall = &w->walls[i];
        if (o->type != R2D_JSON_OBJ) { field_diag(&c, "walls", i, NULL, "wall", "wall должен быть объектом"); ok = false; continue; }
        if (!get_id(&c, o, "walls", i, wall->id, sizeof wall->id)) { ok = false; continue; }
        memcpy(wids[i], wall->id, 64);
        float a[2], b[2];
        const bool g_from = get_pair(&c, o, "walls", i, wall->id, "from", a);
        const bool g_to = get_pair(&c, o, "walls", i, wall->id, "to", b);
        bool good = g_from && g_to;
        good &= get_float(&c, o, "walls", i, wall->id, "bottom", &wall->bottom, true, 0);
        good &= get_float(&c, o, "walls", i, wall->id, "top", &wall->top, true, 0);
        good &= get_color(&c, o, "walls", i, wall->id, "color", wall->color, sizeof wall->color, "#ffffff");
        if (!good) { ok = false; continue; }
        wall->x1 = a[0]; wall->y1 = a[1]; wall->x2 = b[0]; wall->y2 = b[1];
        char loc[2048];
        snprintf(loc, sizeof loc, "{\"section\":\"walls\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(wall->id));
        if (wall->x1 == wall->x2 && wall->y1 == wall->y2) {
            sdk_diag(rep, SDK_ERROR, "SDK_WORLD_WALL_DEGENERATE", path, loc, NULL, "wall «%s»: начало и конец совпадают", wall->id);
            ok = false;
        }
        if (!(wall->top > wall->bottom)) {
            sdk_diag(rep, SDK_ERROR, "SDK_WORLD_WALL_HEIGHT", path, loc, NULL, "wall «%s»: top (%g) должен быть больше bottom (%g)", wall->id, wall->top, wall->bottom);
            ok = false;
        }
    }
    for (int i = 0; i < w->nwall; ++i) if (wids[i][0] && !dup_check(&c, "walls", wids, w->nwall, i)) ok = false;
    free(wids);
    if (ok && ngen_walls > 0) {
        const int total = w->nwall + ngen_walls;
        WWall *grown = (WWall *)realloc(w->walls, (size_t)total * sizeof *grown);
        if (!grown) { sdk_diag(rep, SDK_ERROR, "SDK_OOM", path, NULL, NULL, "boundary walls realloc failed"); ok = false; }
        else {
            w->walls = grown;
            for (int i = 0; i < ngen_walls; ++i) w->walls[w->nwall + i] = gen_walls[i].wall;
            w->nwall = total;
        }
    }
    free(gen_walls);

    // --- portals ---
    const R2dJson *portals = r2d_json_get(root, "portals");
    w->nportal = r2d_json_size(portals);
    w->portals = (WPortal *)calloc((size_t)(w->nportal ? w->nportal : 1), sizeof(WPortal));
    char (*pids)[64] = (char (*)[64])calloc((size_t)(w->nportal ? w->nportal : 1), 64);
    for (int i = 0; i < w->nportal; ++i) {
        const R2dJson *o = portals->items[i];
        WPortal *p = &w->portals[i];
        if (o->type != R2D_JSON_OBJ) { field_diag(&c, "portals", i, NULL, "portal", "portal должен быть объектом"); ok = false; continue; }
        if (!get_id(&c, o, "portals", i, p->id, sizeof p->id)) { ok = false; continue; }
        memcpy(pids[i], p->id, 64);
        snprintf(p->a, sizeof p->a, "%s", r2d_json_str(r2d_json_get(o, "cellA"), ""));
        snprintf(p->b, sizeof p->b, "%s", r2d_json_str(r2d_json_get(o, "cellB"), ""));
        float a[2], b[2];
        const bool g_from = get_pair(&c, o, "portals", i, p->id, "from", a);
        const bool g_to = get_pair(&c, o, "portals", i, p->id, "to", b);
        bool good = g_from && g_to;
        if (!good) { ok = false; continue; }
        p->x1 = a[0]; p->y1 = a[1]; p->x2 = b[0]; p->y2 = b[1];
        const R2dJson *op = r2d_json_get(o, "openings");
        if (!op || op->type != R2D_JSON_ARR || op->count > W_MAX) {
            field_diag(&c, "portals", i, p->id, "openings", "нужен массив openings");
            ok = false; continue;
        }
        p->nopen = r2d_json_size(op);
        p->open = (WOpening *)calloc((size_t)(p->nopen ? p->nopen : 1), sizeof(WOpening));
        for (int k = 0; k < p->nopen; ++k) {
            if (op->items[k]->type != R2D_JSON_OBJ ||
                !get_float(&c, op->items[k], "portals.openings", k, p->id, "bottom", &p->open[k].bottom, true, 0) ||
                !get_float(&c, op->items[k], "portals.openings", k, p->id, "top", &p->open[k].top, true, 0)) { ok = false; continue; }
            if (!(p->open[k].top > p->open[k].bottom)) {
                char loc[2048];
                snprintf(loc, sizeof loc, "{\"section\":\"portals\",\"index\":%d,\"id\":\"%s\",\"opening\":%d}", i, json_fragment(p->id), k);
                sdk_diag(rep, SDK_ERROR, "SDK_WORLD_SPAN_HEIGHT", path, loc, NULL, "portal «%s», opening %d: top должен быть больше bottom", p->id, k);
                ok = false;
            }
        }
    }
    for (int i = 0; i < w->nportal; ++i) if (pids[i][0] && !dup_check(&c, "portals", pids, w->nportal, i)) ok = false;
    free(pids);

    // --- stairs и slopes раскрываются в compiled ---
    const R2dJson *stairs = r2d_json_get(root, "stairs");
    const R2dJson *slopes = r2d_json_get(root, "slopes");
    w->nstairs = r2d_json_size(stairs);
    w->nslopes = r2d_json_size(slopes);
    char (*sids)[64] = (char (*)[64])calloc((size_t)(w->nstairs + w->nslopes + 1), 64);
    for (int pass = 0; pass < 2; ++pass) {
        const R2dJson *arr = pass == 0 ? stairs : slopes;
        const char *section = pass == 0 ? "stairs" : "slopes";
        const int n = pass == 0 ? w->nstairs : w->nslopes;
        for (int i = 0; i < n; ++i) {
            const R2dJson *o = arr->items[i];
            if (o->type != R2D_JSON_OBJ) { field_diag(&c, section, i, NULL, section, "элемент должен быть объектом"); ok = false; continue; }
            char id[64];
            if (!get_id(&c, o, section, i, id, sizeof id)) { ok = false; continue; }
            snprintf(sids[(pass ? w->nstairs : 0) + i], 64, "%s", id);
            float r[4], base = 0, rise = 0, top = 0, from = 0, to = 0;
            bool good = get_rect(&c, o, section, i, id, "rect", r);
            const char *axis = r2d_json_str(r2d_json_get(o, "axis"), "x");
            if (strcmp(axis, "x") && strcmp(axis, "y")) { field_diag(&c, section, i, id, "axis", "axis — «x» или «y»"); good = false; }
            const R2dJson *dv = r2d_json_get(o, "dir");
            const int dir = dv && dv->type == R2D_JSON_NUM && dv->number == -1 ? -1 : 1;
            if (dv && (dv->type != R2D_JSON_NUM || (dv->number != 1 && dv->number != -1))) {
                field_diag(&c, section, i, id, "dir", "dir — 1 или -1"); good = false;
            }
            const R2dJson *sv = r2d_json_get(o, pass == 0 ? "steps" : "segments");
            const int steps = sv && sv->type == R2D_JSON_NUM && sv->number >= 1 && sv->number <= 256 && floor(sv->number) == sv->number ? (int)sv->number : (renderer && pass == 1 && !sv ? 1 : 0);
            if (steps < 1 || steps > 256) { field_diag(&c, section, i, id, pass == 0 ? "steps" : "segments", "число шагов 1..256"); good = false; }
            good &= get_float(&c, o, section, i, id, "top", &top, true, 0);
            char fc[2][40], cc[40];
            if (pass == 0) {
                good &= get_float(&c, o, section, i, id, "base", &base, true, 0);
                good &= get_float(&c, o, section, i, id, "rise", &rise, true, 0);
                good &= get_color(&c, o, section, i, id, "floorColor", fc[0], sizeof fc[0], "#736348");
                good &= get_color(&c, o, section, i, id, "floorColorAlt", fc[1], sizeof fc[1], fc[0]);
            } else {
                good &= get_float(&c, o, section, i, id, "from", &from, true, 0);
                good &= get_float(&c, o, section, i, id, "to", &to, true, 0);
                good &= get_color(&c, o, section, i, id, "floorColor", fc[0], sizeof fc[0], "#736348");
                snprintf(fc[1], sizeof fc[1], "%s", fc[0]);
            }
            good &= get_color(&c, o, section, i, id, "ceilingColor", cc, sizeof cc, "#344858");
            char stair_tags[R2D_WORLD_TAG_MAX][R2D_WORLD_TAG_LENGTH+1];
            char stair_ctags[R2D_WORLD_TAG_MAX][R2D_WORLD_TAG_LENGTH+1];
            unsigned char n_stair_tags = 0, n_stair_ctags = 0;
            good &= get_tags(&c, o, section, i, id, "tags", stair_tags, &n_stair_tags);
            good &= get_tags(&c, o, section, i, id, "ceilingTags", stair_ctags, &n_stair_ctags);
            char wall_color[40];
            good &= get_color(&c, o, section, i, id, "riserColor", wall_color, sizeof wall_color, "#4f4030");
            R2DWorldSpanLight authored_light;const R2dJson *authored_lighting=r2d_json_get(o,"lighting");
            if(authored_lighting&&!r2d_world_span_light_json(authored_lighting,&authored_light)){field_diag(&c,section,i,id,"lighting","invalid classic span lighting/fog");good=false;}
            if (!good) { ok = false; continue; }
            if (w->ncc + steps > W_MAX || w->ncw + steps > W_MAX) {
                sdk_diag(rep, SDK_ERROR, "SDK_WORLD_LIMIT", path, NULL, NULL, "Слишком много скомпилированных ступеней"); ok = false; continue;
            }
            if (pass == 0 && !(rise != 0)) { field_diag(&c, section, i, id, "rise", "rise не может быть 0"); ok = false; continue; }
            const bool along_x = !strcmp(axis, "x");
            const float len = along_x ? r[2] : r[3];
            if (renderer && pass == 1) {
                if (!(top > fmaxf(from,to))) { field_diag(&c,section,i,id,"top","ceiling must clear both slope endpoints"); ok=false; continue; }
                CCell *cell=add_cc(w);
                cell->x=r[0];cell->y=r[1];cell->w=r[2];cell->h=r[3];
                cell->nspan=1;cell->spans=calloc(1,sizeof(WSpan));
                if(authored_lighting){cell->spans[0].light=authored_light;cell->spans[0].lit=true;}
                cell->spans[0].bottom=dir>0?from:to;cell->spans[0].top=top;
                if(along_x)cell->spans[0].floor_a=(to-from)*(float)dir/len;
                else cell->spans[0].floor_b=(to-from)*(float)dir/len;
                snprintf(cell->spans[0].floor_c,sizeof cell->spans[0].floor_c,"%s",fc[0]);
                snprintf(cell->spans[0].ceil_c,sizeof cell->spans[0].ceil_c,"%s",cc);
                cell->spans[0].ntag=n_stair_tags;cell->spans[0].nceiling_tag=n_stair_ctags;
                for(int t=0;t<n_stair_tags;t++)snprintf(cell->spans[0].tags[t],R2D_WORLD_TAG_LENGTH+1,"%s",stair_tags[t]);
                for(int t=0;t<n_stair_ctags;t++)snprintf(cell->spans[0].ceiling_tags[t],R2D_WORLD_TAG_LENGTH+1,"%s",stair_ctags[t]);
                snprintf(cell->owner,sizeof cell->owner,"%s",id);
                w->slope_segments++;
                continue;
            }
            const float step_len = len / (float)steps;
            for (int k = 0; k < steps; ++k) {
                const int pos = dir > 0 ? k : steps - 1 - k;                // k — по ходу подъёма, pos — положение вдоль оси
                const float height = pass == 0 ? base + (float)(k + 1) * rise : from + (to - from) * (((float)k + 0.5f) / (float)steps);
                const float prev = pass == 0 ? base + (float)k * rise : (k == 0 ? from : from + (to - from) * (((float)k - 0.5f) / (float)steps));
                CCell *cell = add_cc(w);
                cell->x = along_x ? r[0] + (float)pos * step_len : r[0];
                cell->y = along_x ? r[1] : r[1] + (float)pos * step_len;
                cell->w = along_x ? step_len : r[2];
                cell->h = along_x ? r[3] : step_len;
                cell->nspan = 1;
                cell->spans = (WSpan *)calloc(1, sizeof(WSpan));
                if(authored_lighting){cell->spans[0].light=authored_light;cell->spans[0].lit=true;}
                cell->spans[0].bottom = height;
                cell->spans[0].top = top;
                snprintf(cell->spans[0].floor_c, sizeof cell->spans[0].floor_c, "%s", fc[k & 1]);
                snprintf(cell->spans[0].ceil_c, sizeof cell->spans[0].ceil_c, "%s", cc);
                cell->spans[0].ntag=n_stair_tags;cell->spans[0].nceiling_tag=n_stair_ctags;
                for(int t=0;t<n_stair_tags;t++)snprintf(cell->spans[0].tags[t],R2D_WORLD_TAG_LENGTH+1,"%s",stair_tags[t]);
                for(int t=0;t<n_stair_ctags;t++)snprintf(cell->spans[0].ceiling_tags[t],R2D_WORLD_TAG_LENGTH+1,"%s",stair_ctags[t]);
                snprintf(cell->owner, sizeof cell->owner, "%s#%d", id, k);
                // Подступёнок на входной кромке ступени: от предыдущей высоты до этой.
                const float lo = fminf(prev, height), hi = fmaxf(prev, height);
                if (hi > lo) {
                    WWall *rw = add_cw(w);
                    snprintf(rw->id, sizeof rw->id, "%s#riser%d", id, k);
                    const float edge = (dir > 0 ? (float)pos : (float)pos + 1.0f) * step_len;
                    if (along_x) { rw->x1 = rw->x2 = r[0] + edge; rw->y1 = r[1]; rw->y2 = r[1] + r[3]; }
                    else { rw->y1 = rw->y2 = r[1] + edge; rw->x1 = r[0]; rw->x2 = r[0] + r[2]; }
                    rw->bottom = lo;
                    rw->top = hi;
                    snprintf(rw->color, sizeof rw->color, "%s", wall_color);
                }
            }
            if (pass == 0) w->stair_steps += steps; else w->slope_segments += steps;
            if (pass == 1) {
                char d[160], loc[160];
                snprintf(d, sizeof d, "{\"segments\":%d,\"maxStep\":%g}", steps, fabsf(to - from) / (float)steps);
                snprintf(loc, sizeof loc, "{\"section\":\"slopes\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(id));
                sdk_diag(rep, SDK_INFO, "SDK_WORLD_SLOPE_STEPPED", path, loc, d,
                         "slope «%s» аппроксимирован %d ступенями (шаг до %g): рантайм наклонных плоскостей не имеет", id, steps, fabsf(to - from) / (float)steps);
            }
        }
    }
    for (int i = 0; i < w->nstairs + w->nslopes; ++i) {
        if (!sids[i][0]) continue;
        for (int j = 0; j < i; ++j) {
            if (!strcmp(sids[i], sids[j])) {
                char loc[2048];
                snprintf(loc, sizeof loc, "{\"section\":\"%s\",\"id\":\"%s\"}", i < w->nstairs ? "stairs" : "slopes", sids[i]);
                sdk_diag(rep, SDK_ERROR, "SDK_WORLD_ID_DUPLICATE", path, loc, NULL, "stairs/slopes: id «%s» повторяется", sids[i]);
                ok = false;
                break;
            }
        }
    }
    free(sids);
    // --- brushes (issue #5): authoring solids -> cells/spans/walls/portals ---
    if (ok) {
        const R2dJson *brushes = r2d_json_get(root, "brushes");
        if (brushes) {
            if (brushes->type != R2D_JSON_ARR || brushes->count > W_MAX) {
                field_diag(&c, "brushes", -1, NULL, "brushes", "brushes — массив (до 65536)");
                ok = false;
            } else {
                w->nbrush = brushes->count;
                w->brushes = (SdkBrushSpec *)calloc((size_t)(w->nbrush ? w->nbrush : 1),
                                                    sizeof(SdkBrushSpec));
                if (!w->brushes) ok = false;
                for (int i = 0; ok && i < w->nbrush; i++) {
                    if (brushes->items[i]->type != R2D_JSON_OBJ) {
                        field_diag(&c, "brushes", i, NULL, "brush", "brush — объект");
                        ok = false;
                        break;
                    }
                    if (!parse_brush(&c, brushes->items[i], i, &w->brushes[i])) {
                        ok = false;
                        break;
                    }
                    for (int j = 0; j < i; j++) if (!strcmp(w->brushes[j].id, w->brushes[i].id)) {
                        char loc[2048];
                        snprintf(loc, sizeof loc, "{\"section\":\"brushes\",\"index\":%d,\"id\":\"%s\"}", i,
                                 json_fragment(w->brushes[i].id));
                        sdk_diag(rep, SDK_ERROR, "SDK_WORLD_ID_DUPLICATE", path, loc, NULL,
                                 "brushes: id «%s» повторяется", w->brushes[i].id);
                        ok = false;
                    }
                }
            }
        }
    }
    if (ok) ok = load_brush_bounds(&c, root, w);
    if (ok) ok = load_entities(&c, root, w);
    if (ok) ok = build_entity_map(&c, w);
    r2d_json_free(root);
    return ok;
}

// ---------------------------------------------------------------------------
// Геометрия
// ---------------------------------------------------------------------------
static bool rects_cross(float ax, float ay, float aw, float ah, float bx, float by, float bw, float bh)
{
    return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

static int find_cell(const World *w, const char *id)
{
    for (int i = 0; i < w->ncell; ++i) if (!strcmp(w->cells[i].id, id)) return i;
    return -1;
}

// Общая кромка двух прямоугольников: ось (0 — вертикальная, X=const; 1 — горизонтальная), координата, [lo,hi].
static bool shared_edge(const WCell *a, const WCell *b, int *axis, float *coord, float *lo, float *hi)
{
    if (fabsf(a->x + a->w - b->x) < W_EPS || fabsf(b->x + b->w - a->x) < W_EPS) {
        const float l = fmaxf(a->y, b->y), h = fminf(a->y + a->h, b->y + b->h);
        if (h - l > W_EPS) { *axis = 0; *coord = fabsf(a->x + a->w - b->x) < W_EPS ? b->x : a->x; *lo = l; *hi = h; return true; }
    }
    if (fabsf(a->y + a->h - b->y) < W_EPS || fabsf(b->y + b->h - a->y) < W_EPS) {
        const float l = fmaxf(a->x, b->x), h = fminf(a->x + a->w, b->x + b->w);
        if (h - l > W_EPS) { *axis = 1; *coord = fabsf(a->y + a->h - b->y) < W_EPS ? b->y : a->y; *lo = l; *hi = h; return true; }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Проверки скомпилированного мира
// ---------------------------------------------------------------------------
typedef struct StackInfo {
    char  a[96], b[96];
    float ab, at, bb, bt;         // высоты spans
    float rect[4];                // пересечение XY
} StackInfo;

static void check_compiled(Ctx *c, World *w, bool *ok, StackInfo **stacks, int *nstacks, int *total_spans)
{
    SdkReport *rep = c->rep;
    int ns = 0;
    for (int i = 0; i < w->ncc; ++i) ns += w->cc[i].nspan;
    *total_spans = ns;
    for (int i = 0; i < w->ncc; ++i) {
        const CCell *cell = &w->cc[i];
        if (!isfinite(cell->x+cell->w) || !isfinite(cell->y+cell->h) || fabsf(cell->x+cell->w)>W_LIMIT || fabsf(cell->y+cell->h)>W_LIMIT) {
            sdk_diag(rep,SDK_ERROR,"SDK_WORLD_RANGE",c->path,NULL,NULL,"Правая/нижняя граница cell вне ±1000000"); *ok=false;
        }
        for (int j = 0; j < cell->nspan; ++j) {
            const WSpan *sp = &cell->spans[j];
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"id\":\"%s\",\"span\":%d}", json_fragment(cell->owner), j);
            if (!(sp->top > sp->bottom)) {
                sdk_diag(rep, SDK_ERROR, "SDK_WORLD_SPAN_HEIGHT", c->path, loc, NULL, "Потолок должен быть выше пола скомпилированной ступени"); *ok = false;
            }
            if (fabsf(sp->bottom) > W_LIMIT || fabsf(sp->top) > W_LIMIT) {
                sdk_diag(rep, SDK_ERROR, "SDK_WORLD_RANGE", c->path, loc, NULL, "Высота скомпилированной ступени вне ±1000000"); *ok = false;
            }
        }
    }
    if (w->ncw > W_MAX || ns > W_MAX) {
        sdk_diag(rep, SDK_ERROR, "SDK_WORLD_LIMIT", c->path, NULL, NULL, "Рантайм принимает до %d стен и %d spans (в карте: %d стен, %d spans)", W_MAX, W_MAX, w->ncw, ns);
        *ok = false;
        return;
    }
    int cap = 0;
    *stacks = NULL;
    *nstacks = 0;
    // Попарно по spans: те же условия, что в r2d_world_build.
    for (int i = 0; i < w->ncc; ++i) {
        for (int si = 0; si < w->cc[i].nspan; ++si) {
            const CCell *a = &w->cc[i];
            const WSpan *sa = &a->spans[si];
            for (int j = 0; j <= i; ++j) {
                const CCell *b = &w->cc[j];
                for (int sj = 0; sj < b->nspan; ++sj) {
                    if (j == i && sj >= si) break;
                    const WSpan *sb = &b->spans[sj];
                    if (!rects_cross(a->x, a->y, a->w, a->h, b->x, b->y, b->w, b->h)) continue;
                    if (sa->bottom < sb->top && sb->bottom < sa->top) {
                        char loc[2048], d[4096];
                        snprintf(loc, sizeof loc, "{\"cells\":[\"%s\",\"%s\"]}", json_fragment(a->owner), json_fragment(b->owner));
                        snprintf(d, sizeof d, "{\"a\":{\"cell\":\"%s\",\"bottom\":%g,\"top\":%g},\"b\":{\"cell\":\"%s\",\"bottom\":%g,\"top\":%g}}",
                                 json_fragment(a->owner), sa->bottom, sa->top, json_fragment(b->owner), sb->bottom, sb->top);
                        sdk_diag(rep, SDK_ERROR, "SDK_WORLD_SPAN_OVERLAP", c->path, loc, d,
                                 "Свободные интервалы высоты перекрываются на пересекающихся XY: «%s» [%g..%g] и «%s» [%g..%g] — рантайм такой мир отвергнет",
                                 a->owner, sa->bottom, sa->top, b->owner, sb->bottom, sb->top);
                        *ok = false;
                    } else {
                        // Два проходимых spans на одном XY на разных высотах — room-over-room.
                        if (*nstacks >= 4096) continue;
                        if (*nstacks == cap) { cap = cap ? cap * 2 : 16; *stacks = (StackInfo *)realloc(*stacks, (size_t)cap * sizeof(StackInfo)); }
                        StackInfo *st = &(*stacks)[(*nstacks)++];
                        snprintf(st->a, sizeof st->a, "%s", sa->bottom < sb->bottom ? a->owner : b->owner);
                        snprintf(st->b, sizeof st->b, "%s", sa->bottom < sb->bottom ? b->owner : a->owner);
                        st->ab = fminf(sa->bottom, sb->bottom); st->at = sa->bottom < sb->bottom ? sa->top : sb->top;
                        st->bb = fmaxf(sa->bottom, sb->bottom); st->bt = sa->bottom < sb->bottom ? sb->top : sa->top;
                        const float l = fmaxf(a->x, b->x), t = fmaxf(a->y, b->y);
                        st->rect[0] = l; st->rect[1] = t;
                        st->rect[2] = fminf(a->x + a->w, b->x + b->w) - l;
                        st->rect[3] = fminf(a->y + a->h, b->y + b->h) - t;
                    }
                }
            }
        }
    }
}

// Покрыта ли кромка [lo,hi] cell на высоте span стенами, соседями и порталами.
static int interval_compare(const void *a, const void *b)
{
    float x=((const float*)a)[0], y=((const float*)b)[0]; return x<y ? -1 : x>y ? 1 : 0;
}
static void check_leaks(Ctx *c, World *w)
{
    size_t capacity=(size_t)w->ncw+w->nwall+w->ncc+w->nportal+1;
    float (*iv)[2]=malloc(capacity*sizeof *iv);
    if(!iv){sdk_diag(c->rep,SDK_ERROR,"SDK_WORLD_MEMORY",c->path,NULL,NULL,"Не хватило памяти для проверки кромок");return;}
    for (int ci = 0; ci < w->ncell; ++ci) {
        const WCell *cell = &w->cells[ci];
        for (int si = 0; si < cell->nspan; ++si) {
            const WSpan *sp = &cell->spans[si];
            for (int e = 0; e < 4; ++e) {
                // e: 0 west (x=const), 1 east, 2 north (y=const), 3 south
                const bool vertical = e < 2;
                const float coord = e == 0 ? cell->x : e == 1 ? cell->x + cell->w : e == 2 ? cell->y : cell->y + cell->h;
                const float lo = vertical ? cell->y : cell->x, hi = vertical ? cell->y + cell->h : cell->x + cell->w;
                // Интервалы покрытия (простое объединение через сортировку).
                int n = 0;
                for (int k = 0; k < w->ncw + w->nwall; ++k) {
                    const WWall *wl = k < w->nwall ? &w->walls[k] : &w->cw[k - w->nwall];
                    const bool wv = fabsf(wl->x1 - wl->x2) < W_EPS, wh = fabsf(wl->y1 - wl->y2) < W_EPS;
                    if (!((vertical && wv && fabsf(wl->x1 - coord) < W_EPS) || (!vertical && wh && fabsf(wl->y1 - coord) < W_EPS))) continue;
                    if (wl->bottom > sp->bottom + W_EPS || wl->top < sp->top - W_EPS) continue;
                    const float a = vertical ? fminf(wl->y1, wl->y2) : fminf(wl->x1, wl->x2), b = vertical ? fmaxf(wl->y1, wl->y2) : fmaxf(wl->x1, wl->x2);
                    iv[n][0] = a; iv[n][1] = b; ++n;
                }
                for (int k = 0; k < w->ncc; ++k) {
                    const CCell *o = &w->cc[k];
                    if (o->explicit_index == ci) continue;
                    float ocoord, olo, ohi;
                    if (vertical) {
                        const float side = e == 0 ? o->x + o->w : o->x;
                        if (fabsf(side - coord) > W_EPS) continue;
                        ocoord = side; olo = o->y; ohi = o->y + o->h;
                    } else {
                        const float side = e == 2 ? o->y + o->h : o->y;
                        if (fabsf(side - coord) > W_EPS) continue;
                        ocoord = side; olo = o->x; ohi = o->x + o->w;
                    }
                    (void)ocoord;
                    bool conn = false;
                    for (int s2 = 0; s2 < o->nspan; ++s2) if (o->spans[s2].bottom < sp->top && sp->bottom < o->spans[s2].top) conn = true;
                    if (!conn) continue;
                    iv[n][0] = olo; iv[n][1] = ohi; ++n;
                }
                for (int k = 0; k < w->nportal; ++k) {
                    const WPortal *p = &w->portals[k];
                    if (strcmp(p->a, cell->id) && strcmp(p->b, cell->id)) continue;
                    const bool pv = fabsf(p->x1 - p->x2) < W_EPS;
                    if (pv != vertical) continue;
                    if (fabsf((pv ? p->x1 : p->y1) - coord) > W_EPS) continue;
                    bool conn = false;
                    for (int o = 0; o < p->nopen; ++o) if (p->open[o].bottom < sp->top && sp->bottom < p->open[o].top) conn = true;
                    if (!conn) continue;
                    iv[n][0] = pv ? fminf(p->y1, p->y2) : fminf(p->x1, p->x2);
                    iv[n][1] = pv ? fmaxf(p->y1, p->y2) : fmaxf(p->x1, p->x2);
                    ++n;
                }
                // Сортировка по началу и поиск первого разрыва.
                qsort(iv,(size_t)n,sizeof *iv,interval_compare);
                float cur = lo, gap_lo = 0, gap_hi = 0, gap_total = 0;
                bool have_gap = false;
                for (int a = 0; a < n; ++a) {
                    if (iv[a][0] > cur + W_EPS) {
                        const float g0 = cur, g1 = fminf(iv[a][0], hi);
                        if (g1 > g0 + W_EPS) { if (!have_gap) { gap_lo = g0; gap_hi = g1; have_gap = true; } gap_total += g1 - g0; }
                    }
                    if (iv[a][1] > cur) cur = iv[a][1];
                }
                if (cur < hi - W_EPS) { if (!have_gap) { gap_lo = cur; gap_hi = hi; have_gap = true; } gap_total += hi - cur; }
                if (have_gap) {
                    static const char *const names[4] = { "west", "east", "north", "south" };
                    char loc[2048], d[4096];
                    snprintf(loc, sizeof loc, "{\"section\":\"cells\",\"index\":%d,\"id\":\"%s\",\"span\":%d,\"edge\":\"%s\"}", ci, json_fragment(cell->id), si, names[e]);
                    snprintf(d, sizeof d, "{\"edge\":\"%s\",\"from\":%g,\"to\":%g,\"length\":%g,\"coord\":%g,\"span\":[%g,%g]}",
                             names[e], gap_lo, gap_hi, gap_total, coord, sp->bottom, sp->top);
                    sdk_diag(c->rep, SDK_WARNING, "SDK_WORLD_OPEN_EDGE", c->path, loc, d,
                             "cell «%s», span %d [%g..%g]: кромка %s открыта на %g ед. (первый разрыв %g…%g) — нет стены, соседнего cell или портала",
                             cell->id, si, sp->bottom, sp->top, names[e], gap_total, gap_lo, gap_hi);
                }
            }
        }
    }
    free(iv);
}

static void check_portals(Ctx *c, const World *w, bool *ok)
{
    for (int i = 0; i < w->nportal; ++i) {
        const WPortal *p = &w->portals[i];
        char loc[2048];
        snprintf(loc, sizeof loc, "{\"section\":\"portals\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(p->id));
        const int ia = find_cell(w, p->a), ib = find_cell(w, p->b);
        if (ia < 0 || ib < 0) {
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_PORTAL_CELL", c->path, loc, NULL, "portal «%s»: cell «%s» не существует", p->id, ia < 0 ? p->a : p->b);
            *ok = false;
            continue;
        }
        if (ia == ib) {
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_PORTAL_SELF", c->path, loc, NULL, "portal «%s»: cellA и cellB совпадают", p->id);
            *ok = false;
            continue;
        }
        if (p->nopen == 0) {
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_PORTAL_NO_OPENING", c->path, loc, NULL, "portal «%s»: нужен хотя бы один opening {bottom, top}", p->id);
            *ok = false;
        }
        int axis;
        float coord, lo, hi;
        const WCell *A = &w->cells[ia], *B = &w->cells[ib];
        if (!shared_edge(A, B, &axis, &coord, &lo, &hi)) {
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_PORTAL_EDGE", c->path, loc, NULL, "portal «%s»: cells «%s» и «%s» не имеют общей кромки", p->id, p->a, p->b);
            *ok = false;
            continue;
        }
        const bool pv = fabsf(p->x1 - p->x2) < W_EPS, ph = fabsf(p->y1 - p->y2) < W_EPS;
        const float pc = pv ? p->x1 : p->y1;
        const float pl = pv ? fminf(p->y1, p->y2) : fminf(p->x1, p->x2), ph2 = pv ? fmaxf(p->y1, p->y2) : fmaxf(p->x1, p->x2);
        if (!(pv || ph) || (axis == 0) != pv || fabsf(pc - coord) > W_EPS || pl < lo - W_EPS || ph2 > hi + W_EPS) {
            char d[256];
            snprintf(d, sizeof d, "{\"sharedEdge\":{\"axis\":\"%s\",\"coord\":%g,\"from\":%g,\"to\":%g}}", axis == 0 ? "x" : "y", coord, lo, hi);
            sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_PORTAL_EDGE", c->path, loc, d,
                     "portal «%s» не лежит на общей кромке «%s»/«%s» (%s=%g, %g…%g)", p->id, p->a, p->b, axis == 0 ? "x" : "y", coord, lo, hi);
            *ok = false;
            continue;
        }
        for (int k = 0; k < p->nopen; ++k) {
            bool fits = false;
            for (int sa = 0; sa < A->nspan && !fits; ++sa)
                for (int sb = 0; sb < B->nspan && !fits; ++sb) {
                    const float b0 = fmaxf(A->spans[sa].bottom, B->spans[sb].bottom), t0 = fminf(A->spans[sa].top, B->spans[sb].top);
                    if (p->open[k].bottom >= b0 - W_EPS && p->open[k].top <= t0 + W_EPS) fits = true;
                }
            if (!fits) {
                char l2[2048];
                snprintf(l2, sizeof l2, "{\"section\":\"portals\",\"index\":%d,\"id\":\"%s\",\"opening\":%d}", i, json_fragment(p->id), k);
                sdk_diag(c->rep, SDK_WARNING, "SDK_WORLD_PORTAL_OPENING", c->path, l2, NULL,
                         "portal «%s», opening %d [%g..%g]: нет пары spans «%s»/«%s», в которую он помещается", p->id, k, p->open[k].bottom, p->open[k].top, p->a, p->b);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Компиляция
// ---------------------------------------------------------------------------
static void build_compiled(World *w)
{
    // Явные cells идут первыми, ступени и уклоны (уже в cc) — после них.
    CCell *tail = w->cc;
    const int ntail = w->ncc;
    w->cc = NULL;
    w->ncc = w->cap_cc = 0;
    for (int i = 0; i < w->ncell; ++i) {
        CCell *c = add_cc(w);
        c->x = w->cells[i].x; c->y = w->cells[i].y; c->w = w->cells[i].w; c->h = w->cells[i].h;
        c->nspan = w->cells[i].nspan;
        c->spans = (WSpan *)calloc((size_t)(c->nspan ? c->nspan : 1), sizeof(WSpan));
        memcpy(c->spans, w->cells[i].spans, (size_t)c->nspan * sizeof(WSpan));
        snprintf(c->owner, sizeof c->owner, "%s", w->cells[i].id);
        c->explicit_index = w->cells[i].generated ? -1 : i;
        c->portal_authored = w->cells[i].portal_authored;
    }
    for (int i = 0; i < ntail; ++i) {
        CCell *c = add_cc(w);
        *c = tail[i];
        c->explicit_index = -1;
    }
    free(tail);
    // Явные стены — до подступёнков.
    WWall *tailw = w->cw;
    const int ntw = w->ncw;
    w->cw = NULL;
    w->ncw = w->cap_cw = 0;
    for (int i = 0; i < w->nwall; ++i) *add_cw(w) = w->walls[i];
    for (int i = 0; i < ntw; ++i) *add_cw(w) = tailw[i];
    free(tailw);
}

static void put_description(const World *w, R2dSb *sb, bool pretty, bool ids)
{
    const char *nl = pretty ? "\n" : "";
    r2d_sb_printf(sb, "{%s\"walls\":[", nl);
    for (int i = 0; i < w->ncw; ++i) {
        const WWall *wl = &w->cw[i];
        r2d_sb_printf(sb, "%s%s{", i ? "," : "", pretty ? "\n  " : "");
        if (ids && i < w->nwall && wl->id[0]) { r2d_sb_puts(sb, "\"id\":"); r2d_sb_put_json_string(sb, wl->id); r2d_sb_putc(sb, ','); }
        r2d_sb_puts(sb, "\"from\":[");
        put_num(sb, wl->x1); r2d_sb_putc(sb, ','); put_num(sb, wl->y1);
        r2d_sb_puts(sb, "],\"to\":[");
        put_num(sb, wl->x2); r2d_sb_putc(sb, ','); put_num(sb, wl->y2);
        r2d_sb_puts(sb, "],\"bottom\":"); put_num(sb, wl->bottom);
        r2d_sb_puts(sb, ",\"top\":"); put_num(sb, wl->top);
        r2d_sb_puts(sb, ",\"color\":"); r2d_sb_put_json_string(sb, wl->color);
        if (wl->flags) r2d_sb_printf(sb, ",\"flags\":%u", (unsigned)wl->flags);
        r2d_sb_putc(sb, '}');
    }
    r2d_sb_printf(sb, "%s],%s\"cells\":[", nl, nl);
    for (int i = 0; i < w->ncc; ++i) {
        const CCell *c = &w->cc[i];
        r2d_sb_printf(sb, "%s%s{", i ? "," : "", pretty ? "\n  " : "");
        if (ids && i < w->ncell && c->owner[0]) { r2d_sb_puts(sb, "\"id\":"); r2d_sb_put_json_string(sb, c->owner); r2d_sb_putc(sb, ','); }
        r2d_sb_puts(sb, "\"x\":");
        put_num(sb, c->x); r2d_sb_puts(sb, ",\"y\":"); put_num(sb, c->y);
        r2d_sb_puts(sb, ",\"w\":"); put_num(sb, c->w); r2d_sb_puts(sb, ",\"h\":"); put_num(sb, c->h);
        r2d_sb_puts(sb, ",\"spans\":[");
        for (int k = 0; k < c->nspan; ++k) {
            r2d_sb_printf(sb, "%s{\"bottom\":", k ? "," : "");
            put_num(sb, c->spans[k].bottom); r2d_sb_puts(sb, ",\"top\":"); put_num(sb, c->spans[k].top);
            if(c->spans[k].floor_a || c->spans[k].floor_b) r2d_sb_printf(sb,",\"floorSlope\":{\"a\":%g,\"b\":%g}",c->spans[k].floor_a,c->spans[k].floor_b);
            r2d_sb_puts(sb, ",\"floorColor\":"); r2d_sb_put_json_string(sb, c->spans[k].floor_c);
            r2d_sb_puts(sb, ",\"ceilingColor\":"); r2d_sb_put_json_string(sb, c->spans[k].ceil_c);
            // P0.1 authored user surface tags travel into native author JSON
            // (and therefore into the baked .re2dworld tags table).
            if(c->spans[k].ntag){
                r2d_sb_puts(sb,",\"tags\":[");
                for(int t=0;t<c->spans[k].ntag;t++){if(t)r2d_sb_putc(sb,',');r2d_sb_put_json_string(sb,c->spans[k].tags[t]);}
                r2d_sb_putc(sb,']');
            }
            if(c->spans[k].nceiling_tag){
                r2d_sb_puts(sb,",\"ceilingTags\":[");
                for(int t=0;t<c->spans[k].nceiling_tag;t++){if(t)r2d_sb_putc(sb,',');r2d_sb_put_json_string(sb,c->spans[k].ceiling_tags[t]);}
                r2d_sb_putc(sb,']');
            }
            if(c->spans[k].lit){const R2DWorldSpanLight *l=&c->spans[k].light;unsigned color=((unsigned)roundf(l->r*255)<<16)|((unsigned)roundf(l->g*255)<<8)|(unsigned)roundf(l->b*255),fog=((unsigned)roundf(l->fog_r*255)<<16)|((unsigned)roundf(l->fog_g*255)<<8)|(unsigned)roundf(l->fog_b*255);
                r2d_sb_printf(sb,",\"lighting\":{\"level\":%g,\"color\":\"#%06x\",\"fog\":{\"density\":%g,\"start\":%g,\"color\":\"#%06x\"}}",l->level,color,l->fog_density,l->fog_start,fog);}

            r2d_sb_putc(sb, '}');
        }
        r2d_sb_puts(sb, "]}");
    }
    r2d_sb_printf(sb, "%s]%s}", nl, nl);
}


// --- Authored metadata passthrough -----------------------------------------
// The runtime keeps `meta`/`spawns` verbatim; the compiler is a geometry
// compiler and must not silently drop authored presentation data. We copy the
// balanced JSON value of a top-level key instead of re-serializing a schema the
// SDK does not own. Bounded scanner: no recursion, strings/escapes respected.
static char *r2d_sdk_read_text(const char *path,size_t *size)
{
    FILE *f=fopen(path,"rb");if(!f)return NULL;if(fseek(f,0,SEEK_END)!=0){fclose(f);return NULL;}
    long n=ftell(f);if(n<0||n>(long)(32u*1024u*1024u)){fclose(f);return NULL;}rewind(f);
    char *text=malloc((size_t)n+1);if(!text){fclose(f);return NULL;}
    size_t got=fread(text,1,(size_t)n,f);fclose(f);text[got]=0;if(size)*size=got;return text;
}
static const char *skip_ws(const char *p){while(*p==' '||*p=='\t'||*p=='\n'||*p=='\r')p++;return p;}
static const char *json_value_end(const char *v)
{
    if(*v=='"'||*v=='{'||*v=='['){char open=*v,close=open=='{'?'}':']';int depth=0;bool str=false;
        for(;*v;v++){char c=*v;if(str){if(c=='\\'&&v[1]){v++;continue;}if(c=='"')str=false;continue;}
            if(c=='"'){str=true;continue;}if(c=='{'||c=='['){depth++;continue;}if(c=='}'||c==']'){depth--;if(depth==0)return v+1;continue;}}
        (void)open;(void)close;return NULL;}
    const char *p=v;while(*p&&*p!=','&&*p!='}'&&*p!=']'&&*p!='\n'&&*p!='\r')p++;return p;
}
static bool r2d_sdk_copy_top_key(const char *path,const char *key,R2dSb *sb)
{
    size_t size=0;char *text=r2d_sdk_read_text(path,&size);if(!text)return false;
    bool found=false;int depth=0;bool str=false;
    for(const char *p=text;*p;p++){
        char c=*p;
        if(str){if(c=='\\'&&p[1]){p++;continue;}if(c=='"')str=false;continue;}
        if(c=='"'){
            const char *start=p+1;const char *q=start;while(*q&&*q!='"'){if(*q=='\\'&&q[1])q++;q++;}
            if(*q=='"'){size_t len=(size_t)(q-start);
                if(depth==1&&len==strlen(key)&&!memcmp(start,key,len)){
                    const char *colon=skip_ws(q+1);
                    if(*colon==':'){const char *value=skip_ws(colon+1);const char *end=json_value_end(value);
                        if(end){r2d_sb_putc(sb,',');r2d_sb_put_json_string(sb,key);r2d_sb_putc(sb,':');for(const char *c=value;c<end;c++)r2d_sb_putc(sb,*c);found=true;}}
                }
            }
            p=q;continue;
        }
        if(c=='{'||c=='[')depth++;else if(c=='}'||c==']')depth--;
    }
    free(text);return found;
}
// Versioned native renderer input, retaining authored portal geometry.
static bool put_renderer_description(const World *w,R2dSb *sb,SdkReport *rep,const char *path)
{
    // Reject overlapping XY authoring cells explicitly; native topology owns stacked spans per cell.
    for(int i=0;i<w->ncc;i++)for(int j=0;j<i;j++) {
        const CCell *a=&w->cc[i],*b=&w->cc[j];
        if(a->x<b->x+b->w&&b->x<a->x+a->w&&a->y<b->y+b->h&&b->y<a->y+a->h){
            sdk_diag(rep,SDK_ERROR,"SDK_WORLD_RENDERER_XY_OVERLAP",path,NULL,NULL,"Renderer topology requires disjoint XY cells; merge stacked spans into one cell");return false;
        }
    }
    int *compiled=w->nportal?malloc((size_t)w->nportal*2*sizeof(int)):NULL;
    if(w->nportal&&!compiled){sdk_diag(rep,SDK_ERROR,"SDK_OOM",path,NULL,NULL,"Renderer portal index allocation failed");return false;}
    for(int i=0;i<w->nportal;i++) {
        int a=find_cell(w,w->portals[i].a),b=find_cell(w,w->portals[i].b),ca=-1,cb=-1;
        for(int j=0;j<w->ncc;j++){
            const CCell *c=&w->cc[j];
            if(a>=0&&c->x==w->cells[a].x&&c->y==w->cells[a].y&&c->w==w->cells[a].w&&c->h==w->cells[a].h)ca=j;
            if(b>=0&&c->x==w->cells[b].x&&c->y==w->cells[b].y&&c->w==w->cells[b].w&&c->h==w->cells[b].h)cb=j;
        }
        if(ca<0||cb<0){free(compiled);sdk_diag(rep,SDK_ERROR,"SDK_WORLD_RENDERER_PORTAL",path,NULL,NULL,"Portal has no compiled cell owner");return false;}
        compiled[i*2]=ca;compiled[i*2+1]=cb;
    }
    put_description(w,sb,false,true);
    // put_description ends in a closing object brace; append new format fields.
    if(sb->len&&sb->data[sb->len-1]=='}')sb->data[--sb->len]=0;
    r2d_sb_puts(sb,",\"version\":1,\"portals\":[");
    for(int i=0;i<w->nportal;i++) {
        const WPortal *p=&w->portals[i];
        r2d_sb_printf(sb,"%s{",i?",":"");
        r2d_sb_puts(sb,"\"id\":");r2d_sb_put_json_string(sb,p->id);
        r2d_sb_printf(sb,",\"cellA\":%d,\"cellB\":%d,\"from\":[",compiled[i*2],compiled[i*2+1]);
        put_num(sb,p->x1);r2d_sb_putc(sb,',');put_num(sb,p->y1);r2d_sb_puts(sb,"],\"to\":[");put_num(sb,p->x2);r2d_sb_putc(sb,',');put_num(sb,p->y2);
        r2d_sb_puts(sb,"],\"openings\":[");
        for(int j=0;j<p->nopen;j++)r2d_sb_printf(sb,"%s{\"bottom\":%g,\"top\":%g}",j?",":"",p->open[j].bottom,p->open[j].top);
        r2d_sb_puts(sb,"]");
        if(p->area_portal)r2d_sb_puts(sb,",\"areaPortal\":true");
        r2d_sb_puts(sb,"}");
    }
    int emitted=w->nportal;
    // Generated stairs/slopes connect across their shared XY edge. Authored cells
    // retain explicit portal control; a solid authored wall blocks generation.
    for(int a=0;a<w->ncc;a++)for(int b=0;b<a;b++) {
        const CCell *ca=&w->cc[a],*cb=&w->cc[b];
        if(ca->portal_authored||cb->portal_authored)continue;
        if(ca->explicit_index>=0&&cb->explicit_index>=0)continue;
        WCell ra={.x=ca->x,.y=ca->y,.w=ca->w,.h=ca->h};
        WCell rb={.x=cb->x,.y=cb->y,.w=cb->w,.h=cb->h};
        int axis;float co,lo,hi;
        if(!shared_edge(&ra,&rb,&axis,&co,&lo,&hi))continue;
        // A single rectangle at the highest endpoint hides the lower side of a
        // sloped edge. Keep rectangular native portals, subdividing only edges
        // whose floor varies along the shared boundary (floors remain planes).
        bool varying=false;
        for(int i=0;i<ca->nspan;i++)if(axis?ca->spans[i].floor_a:ca->spans[i].floor_b)varying=true;
        for(int i=0;i<cb->nspan;i++)if(axis?cb->spans[i].floor_a:cb->spans[i].floor_b)varying=true;
        int pieces=varying?(int)fminf(256,ceilf(hi-lo)):1;
        for(int piece=0;piece<pieces;piece++) {
        float edge_lo=lo+(hi-lo)*(float)piece/pieces,edge_hi=lo+(hi-lo)*(float)(piece+1)/pieces;
        const float x1=axis?edge_lo:co,y1=axis?co:edge_lo,x2=axis?edge_hi:co,y2=axis?co:edge_hi;
        R2dSb openings;r2d_sb_init(&openings);int count=0;
        for(int i=0;i<ca->nspan;i++)for(int j=0;j<cb->nspan;j++) {
            const WSpan *sa=&ca->spans[i],*sc=&cb->spans[j];
            float floor=fmaxf(fmaxf(sa->bottom+sa->floor_a*(x1-ca->x)+sa->floor_b*(y1-ca->y),sa->bottom+sa->floor_a*(x2-ca->x)+sa->floor_b*(y2-ca->y)),
                             fmaxf(sc->bottom+sc->floor_a*(x1-cb->x)+sc->floor_b*(y1-cb->y),sc->bottom+sc->floor_a*(x2-cb->x)+sc->floor_b*(y2-cb->y)));
            float ceiling=fminf(sa->top,sc->top);
            bool blocked=false;
        for(int k=0;k<w->nwall;k++) {
            const WWall *wall=&w->walls[k];
            if(wall->top<=floor+W_EPS||wall->bottom>=ceiling-W_EPS)continue;
            if((!axis&&fabsf(wall->x1-co)<W_EPS&&fabsf(wall->x2-co)<W_EPS&&fminf(wall->y1,wall->y2)<edge_hi&&fmaxf(wall->y1,wall->y2)>edge_lo)||
               (axis&&fabsf(wall->y1-co)<W_EPS&&fabsf(wall->y2-co)<W_EPS&&fminf(wall->x1,wall->x2)<edge_hi&&fmaxf(wall->x1,wall->x2)>edge_lo)){blocked=true;break;}
        }
            if(blocked)continue;
            if(ceiling>floor+W_EPS)r2d_sb_printf(&openings,"%s{\"bottom\":%.9g,\"top\":%.9g}",count++?",":"",floor,ceiling);
        }
        if(count)r2d_sb_printf(sb,"%s{\"cellA\":%d,\"cellB\":%d,\"from\":[%g,%g],\"to\":[%g,%g],\"openings\":[%s]}",emitted++?",":"",a,b,x1,y1,x2,y2,openings.data);
        r2d_sb_free(&openings);
        }
    }
    r2d_sb_putc(sb,']');
    // Compiler metadata extension: ignored by r2d_world_load_json, preserved in
    // .re2dworld for tools, streaming and diagnostics.
    if (w->brush_stats.brushes || w->region_count) {
        r2d_sb_puts(sb,",\"compiler\":{\"brushes\":");
        r2d_sb_printf(sb,"{\"count\":%d,\"solids\":%d,\"tools\":%d,\"polygons\":%d,\"subtracts\":%d,\"holes\":%d,\"cells\":%d,\"spans\":%d,\"walls\":%d,\"portals\":%d,\"mergedCells\":%d,\"areaPortals\":%d,\"badAreaPortals\":%d,\"hints\":%d,\"hintBarriers\":%d,\"uselessHints\":%d,\"occluders\":%d,\"shadowWalls\":%d,\"acousticWalls\":%d,\"occluderWalls\":%d}",
             w->brush_stats.brushes,w->brush_stats.solids,w->brush_stats.tool_brushes,
             w->brush_stats.polygon_brushes,w->brush_stats.subtract_brushes,
             w->brush_stats.hole_brushes,
             w->brush_stats.cells,w->brush_stats.spans,w->brush_stats.walls,
             w->brush_stats.portals,w->brush_stats.merged_cells,
             w->brush_stats.areaportal_edges,
             w->brush_stats.areaportal_brushes>0&&w->brush_stats.areaportal_edges==0?1:0,
             w->brush_stats.hint_brushes,w->brush_stats.hint_barriers,
             w->brush_stats.hint_brushes>0&&w->brush_stats.hint_edges==0?1:0,
             w->brush_stats.occluder_brushes,
             w->brush_stats.shadow_walls,w->brush_stats.acoustic_walls,
             w->brush_stats.occluder_walls);
        r2d_sb_printf(sb,",\"entities\":{\"total\":%d,\"point\":%d,\"brush\":%d},\"brushEntities\":[",
                      w->nentities,w->npoint_entities,w->nbrush_entities);
        for (int i = 0; i < w->nentity_map; i++) {
            const SdkBrushEntityMap *m = &w->entity_map[i];
            r2d_sb_puts(sb, i ? "," : "");
            r2d_sb_puts(sb, "{\"id\":");
            r2d_sb_put_json_string(sb, m->id);
            r2d_sb_puts(sb, ",\"kind\":");
            r2d_sb_put_json_string(sb, m->kind);
            r2d_sb_puts(sb, ",\"brush\":");
            r2d_sb_put_json_string(sb, m->brush);
            r2d_sb_puts(sb, ",\"runtime\":");
            r2d_sb_put_json_string(sb, m->runtime);
            r2d_sb_puts(sb, ",\"api\":");
            r2d_sb_put_json_string(sb, m->api);
            r2d_sb_puts(sb, ",\"target\":");
            r2d_sb_put_json_string(sb, m->target);
            r2d_sb_puts(sb, ",\"hook\":");
            r2d_sb_put_json_string(sb, m->hook);
            r2d_sb_printf(sb, ",\"moverType\":%d,\"triggerType\":%d,\"portal\":%d,\"spanCount\":%d,\"terrainKind\":%d,"
                          "\"fog\":{\"density\":%g,\"start\":%g,\"rgb\":[%g,%g,%g]},"
                          "\"volume\":[%g,%g,%g,%g,%g,%g],\"flags\":%u}",
                          m->mover_type, m->trigger_type, m->portal, m->span_count,
                          m->terrain_kind, (double)m->fog_density,
                          (double)m->fog_start, (double)m->fog_r,
                          (double)m->fog_g, (double)m->fog_b,
                          (double)m->x, (double)m->y,
                          (double)m->w, (double)m->h, (double)m->bottom,
                          (double)m->top, (unsigned)m->flags);
        }
        r2d_sb_printf(sb, "],\"regionGrid\":{\"size\":%g,\"columns\":%d,\"rows\":%d,\"count\":%d,\"pvsEdges\":%d},\"regionCells\":[",
                      (double)w->region_size,w->region_columns,w->region_rows,
                      w->region_count,w->region_pvs_edges);
        for(int i=0;i<w->region_count;i++)r2d_sb_printf(sb,"%s%d",i?",":"",w->region_cell_counts?w->region_cell_counts[i]:0);
        r2d_sb_puts(sb,"],\"stages\":{");
        r2d_sb_printf(sb,"\"loadMs\":%.3f,\"compileMs\":%.3f,\"regionMs\":%.3f}",
                      w->stage_load_ms,w->stage_compile_ms,w->stage_region_ms);
        r2d_sb_puts(sb,"}");
    }
    if(w->entities_json)r2d_sb_printf(sb,",\"entities\":%s",w->entities_json);
    if(w->lighting_json)r2d_sb_printf(sb,",\"lighting\":%s",w->lighting_json);if(w->lights_json)r2d_sb_printf(sb,",\"lights\":%s",w->lights_json);r2d_sb_putc(sb,'}');free(compiled);
    R2DRe2dWorld runtime={0};char error[256];
    if(!r2d_world_load_json(&runtime,sb->data,error,sizeof error)){
        sdk_diag(rep,SDK_ERROR,"SDK_WORLD_RENDERER_BAKE",path,NULL,NULL,"%s",error);return false;}
    if(sb->len&&sb->data[sb->len-1]=='}')sb->data[--sb->len]=0;
    r2d_sb_putc(sb,',');bool baked=r2d_world_put_baked(&runtime,sb);r2d_world_free(&runtime);
    if(baked){r2d_sdk_copy_top_key(path,"meta",sb);r2d_sdk_copy_top_key(path,"metadata",sb);r2d_sdk_copy_top_key(path,"spawns",sb);}
    r2d_sb_putc(sb,'}');
    if(!baked)sdk_diag(rep,SDK_ERROR,"SDK_WORLD_RENDERER_BAKE",path,NULL,NULL,"Native static light precompute failed");return baked;
}

// Консервативная достижимость через порталы (данные компилятора; рантайм PVS не использует).
static void put_pvs(const World *w, R2dSb *sb)
{
    r2d_sb_puts(sb, "{\"kind\":\"portal-reachability\",\"conservative\":true,\"runtimeUsed\":false,\"cells\":{");
    const int n = w->ncell;
    // Resolve authored portal endpoints once, then work on an adjacency list.
    // The old loop called find_cell for every portal of every BFS node and was
    // O(cells * portals * cells) on large maps (BASHNYA: >11 min after output).
    int *degree = (int *)calloc((size_t)(n ? n : 1), sizeof(int));
    int *offset = (int *)calloc((size_t)(n + 1), sizeof(int));
    int *neighbors = (int *)calloc((size_t)(w->nportal ? w->nportal * 2 : 1), sizeof(int));
    int *seen = (int *)calloc((size_t)(n ? n : 1), sizeof(int));
    int *queue = (int *)calloc((size_t)(n ? n : 1), sizeof(int));
    if (!degree || !offset || !neighbors || !seen || !queue) {
        free(degree); free(offset); free(neighbors); free(seen); free(queue);
        r2d_sb_puts(sb, "}}");
        return;
    }
    for (int p = 0; p < w->nportal; ++p) {
        const int a = find_cell(w, w->portals[p].a), b = find_cell(w, w->portals[p].b);
        if (a < 0 || b < 0 || a == b) continue;
        degree[a]++; degree[b]++;
    }
    for (int i = 0; i < n; ++i) offset[i + 1] = offset[i] + degree[i];
    int *fill = (int *)calloc((size_t)(n ? n : 1), sizeof(int));
    if (!fill) {
        free(degree); free(offset); free(neighbors); free(seen); free(queue);
        r2d_sb_puts(sb, "}}");
        return;
    }
    for (int p = 0; p < w->nportal; ++p) {
        const int a = find_cell(w, w->portals[p].a), b = find_cell(w, w->portals[p].b);
        if (a < 0 || b < 0 || a == b) continue;
        neighbors[offset[a] + fill[a]++] = b;
        neighbors[offset[b] + fill[b]++] = a;
    }
    free(fill); free(degree);
    for (int s0 = 0; s0 < n; ++s0) {
        int stamp = s0 + 1;
        int head = 0, tail = 0;
        queue[tail++] = s0;
        seen[s0] = stamp;
        while (head < tail) {
            const int cur = queue[head++];
            for (int k = offset[cur]; k < offset[cur + 1]; ++k) {
                const int nxt = neighbors[k];
                if (seen[nxt] == stamp) continue;
                seen[nxt] = stamp;
                queue[tail++] = nxt;
            }
        }
        r2d_sb_printf(sb, "%s", s0 ? "," : "");
        r2d_sb_put_json_string(sb, w->cells[s0].id);
        r2d_sb_putc(sb, ':');
        r2d_sb_putc(sb, '[');
        int first = 1;
        for (int i = 0; i < n; ++i) {
            if (i == s0 || seen[i] != stamp) continue;
            r2d_sb_printf(sb, "%s", first ? "" : ",");
            r2d_sb_put_json_string(sb, w->cells[i].id);
            first = 0;
        }
        r2d_sb_putc(sb, ']');
    }
    free(offset); free(neighbors); free(seen); free(queue);
    r2d_sb_puts(sb, "}}");
}

// Полный проход: загрузка + раскрытие + проверки. `compiled` — доступно при ok.
// ---------------------------------------------------------------------------
// Region partition + huge-world compiler warnings (R-04 / issue #5)
// ---------------------------------------------------------------------------
static void world_warn(Ctx *c, const char *code, const char *message)
{
    sdk_diag(c->rep, SDK_WARNING, code, c->path, NULL, NULL, "%s", message);
}

static bool build_regions(Ctx *c, World *w)
{
    if (w->ncell <= 0) return true;
    R2DWorldRegionCell *cells = (R2DWorldRegionCell *)calloc((size_t)w->ncell,
                                                             sizeof(R2DWorldRegionCell));
    R2DWorldRegionPortal *portals = (R2DWorldRegionPortal *)calloc(
        (size_t)(w->nportal ? w->nportal : 1), sizeof(R2DWorldRegionPortal));
    if (!cells || !portals) {
        free(cells); free(portals);
        sdk_diag(c->rep, SDK_ERROR, "SDK_OOM", c->path, NULL, NULL,
                 "region partition allocation failed");
        return false;
    }
    for (int i = 0; i < w->ncell; i++) {
        cells[i].x = w->cells[i].x;
        cells[i].y = w->cells[i].y;
        cells[i].w = w->cells[i].w;
        cells[i].h = w->cells[i].h;
    }
    int portal_count = 0;
    for (int i = 0; i < w->nportal; i++) {
        const int a = find_cell(w, w->portals[i].a);
        const int b = find_cell(w, w->portals[i].b);
        if (a < 0 || b < 0 || a == b) continue;
        portals[portal_count++] = (R2DWorldRegionPortal){
            a, b, false, w->portals[i].area_portal
        };
    }
    char error[256] = {0};
    R2DWorldRegionSet set;
    memset(&set, 0, sizeof set);
    int region_count = r2d_world_region_build(cells, w->ncell, portals, portal_count,
                                              w->region_size, &set, error,
                                              sizeof error);
    if (region_count <= 0) {
        free(cells); free(portals);
        sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_REGION_PARTITION", c->path, NULL, NULL,
                 "Region partition failed: %s", error[0] ? error : "invalid cells");
        return false;
    }
    const int words = set.pvs_words;
    set.regions = (R2DWorldRegion *)calloc((size_t)region_count, sizeof(R2DWorldRegion));
    set.region_capacity = region_count;
    set.cell_region = (int *)calloc((size_t)w->ncell, sizeof(int));
    set.cell_region_capacity = w->ncell;
    set.region_cells = (int *)calloc((size_t)w->ncell, sizeof(int));
    set.region_cells_capacity = w->ncell;
    set.region_portal_offsets = (int *)calloc((size_t)region_count + 1, sizeof(int));
    set.region_portal_offsets_capacity = region_count + 1;
    set.region_portal_refs = (int *)calloc((size_t)(portal_count * 2 + 1), sizeof(int));
    set.region_portal_refs_capacity = portal_count * 2 + 1;
    set.region_adj_offsets = (int *)calloc((size_t)region_count + 1, sizeof(int));
    set.region_adj_offsets_capacity = region_count + 1;
    set.region_adj_refs = (int *)calloc((size_t)(portal_count * 2 + 1), sizeof(int));
    set.region_adj_refs_capacity = portal_count * 2 + 1;
    set.pvs = (uint64_t *)calloc((size_t)region_count * (size_t)words, sizeof(uint64_t));
    set.pvs_capacity = region_count * words;
    if (!set.regions || !set.cell_region || !set.region_cells ||
        !set.region_portal_offsets || !set.region_portal_refs ||
        !set.region_adj_offsets || !set.region_adj_refs || !set.pvs) {
        free(cells); free(portals);
        free(set.regions); free(set.cell_region); free(set.region_cells);
        free(set.region_portal_offsets); free(set.region_portal_refs);
        free(set.region_adj_offsets); free(set.region_adj_refs); free(set.pvs);
        sdk_diag(c->rep, SDK_ERROR, "SDK_OOM", c->path, NULL, NULL,
                 "region partition allocation failed");
        return false;
    }
    const int built = r2d_world_region_build(cells, w->ncell, portals, portal_count,
                                             w->region_size, &set, error,
                                             sizeof error);
    free(cells);
    free(portals);
    if (built != region_count) {
        free(set.regions); free(set.cell_region); free(set.region_cells);
        free(set.region_portal_offsets); free(set.region_portal_refs);
        free(set.region_adj_offsets); free(set.region_adj_refs); free(set.pvs);
        sdk_diag(c->rep, SDK_ERROR, "SDK_WORLD_REGION_PARTITION", c->path, NULL, NULL,
                 "Region partition failed: %s", error[0] ? error : "capacity mismatch");
        return false;
    }
    w->region_count = region_count;
    w->region_columns = set.columns;
    w->region_rows = set.rows;
    w->region_pvs_edges = set.metrics.pvs_edges;
    free(w->region_cell_counts);
    w->region_cell_counts = (int *)calloc((size_t)region_count, sizeof(int));
    if (w->region_cell_counts)
        for (int r = 0; r < region_count; r++)
            w->region_cell_counts[r] = set.regions[r].cell_count;

    if (region_count == 1) {
        float area = 0.0f;
        for (int i = 0; i < w->ncell; i++) area += w->cells[i].w * w->cells[i].h;
        if (area > w->region_size * w->region_size * 4.0f)
            world_warn(c, "SDK_WORLD_GIANT_REGION",
                       "Giant unpartitioned region: lower regionSize or split the map");
    }
    if (region_count > 512)
        world_warn(c, "SDK_WORLD_TOO_MANY_REGIONS",
                   "More than 512 regions: active/preload rings may exceed the streaming budget");
    int reached = 0;
    for (int r = 0; r < region_count; r++)
        if (set.pvs[(size_t)r >> 6] & (1ull << (r & 63))) reached++;
    if (reached < region_count)
        world_warn(c, "SDK_WORLD_UNREACHABLE_REGION",
                   "Some regions are not reachable through open portals");
    if (w->brush_stats.areaportal_brushes > 0 && w->brush_stats.areaportal_edges == 0)
        world_warn(c, "SDK_WORLD_BAD_AREAPORTAL",
                   "Areaportal brush does not cover any generated portal edge");
    if (w->brush_stats.hint_brushes > 0 && w->brush_stats.hint_edges == 0)
        world_warn(c, "SDK_WORLD_USELESS_HINT",
                   "Hint brush does not touch a generated portal edge");
    free(set.regions); free(set.cell_region); free(set.region_cells);
    free(set.region_portal_offsets); free(set.region_portal_refs);
    free(set.region_adj_offsets); free(set.region_adj_refs); free(set.pvs);
    return true;
}

static void check_unreachable_cells(Ctx *c, const World *w)
{
    if (w->ncell <= 1 || w->nportal <= 0) return;
    int *degree = (int *)calloc((size_t)w->ncell, sizeof(int));
    int *offset = (int *)calloc((size_t)w->ncell + 1, sizeof(int));
    int *neighbors = (int *)calloc((size_t)w->nportal * 2, sizeof(int));
    uint8_t *seen = (uint8_t *)calloc((size_t)w->ncell, 1);
    int *queue = (int *)calloc((size_t)w->ncell, sizeof(int));
    if (!degree || !offset || !neighbors || !seen || !queue) {
        free(degree); free(offset); free(neighbors); free(seen); free(queue);
        return;
    }
    int edges = 0;
    for (int p = 0; p < w->nportal; p++) {
        const int a = find_cell(w, w->portals[p].a);
        const int b = find_cell(w, w->portals[p].b);
        if (a < 0 || b < 0 || a == b) continue;
        degree[a]++; degree[b]++;
        edges++;
    }
    for (int i = 0; i < w->ncell; i++) offset[i + 1] = offset[i] + degree[i];
    int *fill = (int *)calloc((size_t)w->ncell, sizeof(int));
    if (!fill) {
        free(degree); free(offset); free(neighbors); free(seen); free(queue);
        return;
    }
    for (int p = 0; p < w->nportal; p++) {
        const int a = find_cell(w, w->portals[p].a);
        const int b = find_cell(w, w->portals[p].b);
        if (a < 0 || b < 0 || a == b) continue;
        neighbors[offset[a] + fill[a]++] = b;
        neighbors[offset[b] + fill[b]++] = a;
    }
    int head = 0, tail = 0, reached = 0;
    queue[tail++] = 0;
    seen[0] = 1;
    while (head < tail) {
        const int current = queue[head++];
        reached++;
        for (int i = offset[current]; i < offset[current + 1]; i++) {
            const int next = neighbors[i];
            if (!seen[next]) { seen[next] = 1; queue[tail++] = next; }
        }
    }
    if (edges > 0 && reached < w->ncell) {
        world_warn(c, "SDK_WORLD_UNREACHABLE_CELL",
                   "Some cells are not reachable through authored portals");
    }
    free(fill); free(degree); free(offset); free(neighbors); free(seen); free(queue);
}

// ---------------------------------------------------------------------------
// Sky-leak flood fill (issue #103): exterior/void is seeded from cell sides with
// no neighbour, then flooded through cell sides that are not fully covered by a
// wall. Reached authoring cells are reported. This replaces the old "any open
// edge = sky leak" heuristic. Walls are treated as sealing for the full edge
// height (the SDK compiler only emits full-height sealing walls in practice);
// the open-edge diagnostic still reports partial coverage.
// ---------------------------------------------------------------------------
static bool wall_covers_side(const World *w, bool vertical, float coord,
                             float lo, float hi)
{
    const float eps = 1e-4f;
    int count = 0;
    float (*iv)[2] = (float (*)[2])malloc((size_t)(w->nwall ? w->nwall : 1) * sizeof *iv);
    if (!iv) return false;
    for (int i = 0; i < w->nwall; i++) {
        const WWall *wall = &w->walls[i];
        float a, b;
        if (vertical) {
            if (fabsf(wall->x1 - wall->x2) > eps || fabsf(wall->x1 - coord) > eps)
                continue;
            a = fminf(wall->y1, wall->y2); b = fmaxf(wall->y1, wall->y2);
        } else {
            if (fabsf(wall->y1 - wall->y2) > eps || fabsf(wall->y1 - coord) > eps)
                continue;
            a = fminf(wall->x1, wall->x2); b = fmaxf(wall->x1, wall->x2);
        }
        a = fmaxf(a, lo); b = fminf(b, hi);
        if (b > a + eps) { iv[count][0] = a; iv[count][1] = b; count++; }
    }
    // insertion sort by start; deterministic and n is small
    for (int i = 1; i < count; i++) {
        float key0 = iv[i][0], key1 = iv[i][1];
        int j = i - 1;
        while (j >= 0 && iv[j][0] > key0) { iv[j + 1][0] = iv[j][0]; iv[j + 1][1] = iv[j][1]; j--; }
        iv[j + 1][0] = key0; iv[j + 1][1] = key1;
    }
    float covered = lo;
    for (int i = 0; i < count; i++) {
        if (iv[i][0] > covered + eps) break;
        if (iv[i][1] > covered) covered = iv[i][1];
        if (covered >= hi - eps) break;
    }
    const bool sealed = covered >= hi - eps;
    free(iv);
    return sealed;
}

static bool cells_share_side(const WCell *a, const WCell *b, bool *vertical,
                             float *coord, float *lo, float *hi)
{
    const float eps = 1e-4f;
    if (fabsf(a->x + a->w - b->x) <= eps || fabsf(b->x + b->w - a->x) <= eps) {
        const float y0 = fmaxf(a->y, b->y);
        const float y1 = fminf(a->y + a->h, b->y + b->h);
        if (y1 > y0 + eps) {
            *vertical = true;
            *coord = fabsf(a->x + a->w - b->x) <= eps ? b->x : a->x;
            *lo = y0; *hi = y1;
            return true;
        }
    }
    if (fabsf(a->y + a->h - b->y) <= eps || fabsf(b->y + b->h - a->y) <= eps) {
        const float x0 = fmaxf(a->x, b->x);
        const float x1 = fminf(a->x + a->w, b->x + b->w);
        if (x1 > x0 + eps) {
            *vertical = false;
            *coord = fabsf(a->y + a->h - b->y) <= eps ? b->y : a->y;
            *lo = x0; *hi = x1;
            return true;
        }
    }
    return false;
}

static void check_sky_leak_flood(Ctx *c, const World *w)
{
    if (!c || !w || w->ncell <= 0) return;
    const int n = w->ncell;
    int *neighbors = (int *)malloc((size_t)n * (size_t)n * sizeof(int));
    int *degree = (int *)calloc((size_t)n, sizeof(int));
    int *queue = (int *)malloc((size_t)n * sizeof(int));
    uint8_t *reached = (uint8_t *)calloc((size_t)n, 1);
    if (!neighbors || !degree || !queue || !reached) {
        free(neighbors); free(degree); free(queue); free(reached);
        return;
    }
    // Adjacency: any shared side not fully sealed by walls is passable.
    for (int a = 0; a < n; a++) {
        for (int b = a + 1; b < n; b++) {
            bool vertical; float coord, lo, hi;
            if (!cells_share_side(&w->cells[a], &w->cells[b], &vertical,
                                  &coord, &lo, &hi))
                continue;
            if (wall_covers_side(w, vertical, coord, lo, hi)) continue;
            neighbors[a * n + degree[a]++] = b;
            neighbors[b * n + degree[b]++] = a;
        }
    }
    int head = 0, tail = 0;
    for (int i = 0; i < n; i++) {
        const WCell *cell = &w->cells[i];
        const float sides[4][4] = {
            {cell->x, cell->y, cell->x, cell->y + cell->h},
            {cell->x + cell->w, cell->y, cell->x + cell->w, cell->y + cell->h},
            {cell->x, cell->y, cell->x + cell->w, cell->y},
            {cell->x, cell->y + cell->h, cell->x + cell->w, cell->y + cell->h}
        };
        for (int side = 0; side < 4 && !reached[i]; side++) {
            const bool vertical = side < 2;
            const float coord = vertical ? sides[side][0] : sides[side][1];
            const float lo = vertical ? cell->y : cell->x;
            const float hi = vertical ? cell->y + cell->h : cell->x + cell->w;
            bool has_neighbor = false;
            for (int j = 0; j < degree[i] && !has_neighbor; j++) {
                const int other = neighbors[i * n + j];
                bool ov; float oc, olo, ohi;
                if (cells_share_side(cell, &w->cells[other], &ov, &oc, &olo, &ohi) &&
                    ov == vertical && fabsf(oc - coord) <= 1e-4f)
                    has_neighbor = true;
            }
            if (has_neighbor) continue;
            if (!wall_covers_side(w, vertical, coord, lo, hi)) {
                reached[i] = 1;
                queue[tail++] = i;
                break;
            }
        }
    }
    // Flood through passable shared sides.
    while (head < tail) {
        const int cell = queue[head++];
        for (int k = 0; k < degree[cell]; k++) {
            const int next = neighbors[cell * n + k];
            if (reached[next]) continue;
            reached[next] = 1;
            queue[tail++] = next;
        }
    }
    int leaked = 0;
    for (int i = 0; i < n; i++) leaked += reached[i] != 0;
    if (leaked > 0) {
        char loc[2048] = {0};
        int off = snprintf(loc, sizeof loc, "{\"kind\":\"sky-leak\",\"cells\":[");
        int listed = 0;
        for (int i = 0; i < n && listed < 12; i++) {
            if (!reached[i]) continue;
            off += snprintf(loc + off, sizeof loc - (size_t)off, "%s\"%s\"",
                            listed ? "," : "", w->cells[i].id);
            listed++;
        }
        snprintf(loc + off, sizeof loc - (size_t)off, "]}");
        sdk_diag(c->rep, SDK_WARNING, "SDK_WORLD_SKY_LEAK", c->path, loc, NULL,
                 "Sky leak: exterior flood fill reached %d cell(s) starting from void boundary; seal walls/brush boundary",
                 leaked);
    }
    free(neighbors); free(degree); free(queue); free(reached);
}

static void compiler_warnings(Ctx *c, const World *w, int total_spans)
{
    if (w->ncc > 4096 || total_spans > 20000)
        world_warn(c, "SDK_WORLD_TOO_MANY_SURFACES",
                   "Too many compiled cells/spans; consider merging equivalent sectors");
    if (w->authored_lights > 64)
        world_warn(c, "SDK_WORLD_TOO_MANY_LIGHTS",
                   "More than 64 authored dynamic lights; light cost may dominate");
    {
        // Giant visible surface heuristic: area in world units. Render-only
        // walls (no collision) stand in for translucent boundaries because the
        // runtime has no per-pixel opacity contract in the compiler.
        bool giant = false, giant_transparent = false;
        for (int i = 0; i < w->ncw; i++) {
            const WWall *wall = &w->cw[i];
            const bool render = wall->flags == 0 ||
                                (wall->flags & R2D_WALL_RENDER) != 0;
            if (!render) continue;
            const float length = hypotf(wall->x2 - wall->x1, wall->y2 - wall->y1);
            const float area = length * (wall->top - wall->bottom);
            if (area > 250000.0f) giant = true;
            if (area > 100000.0f && (wall->flags & R2D_WALL_COLLIDE) == 0)
                giant_transparent = true;
        }
        if (giant)
            world_warn(c, "SDK_WORLD_GIANT_SURFACE",
                       "A rendered wall surface exceeds 250000 square units; split it for visibility/batching");
        if (giant_transparent)
            world_warn(c, "SDK_WORLD_GIANT_TRANSPARENT",
                       "A giant render-only surface looks like a translucent boundary; use a sky/clip brush boundary instead");
    }
    int repeats = 0;
    for (int i = 0; i < w->ncw; i++) {
        int count = 1;
        for (int j = 0; j < i; j++)
            if (!strcmp(w->cw[j].color, w->cw[i].color)) { count = 0; break; }
        if (!count) continue;
        for (int j = i + 1; j < w->ncw; j++)
            if (!strcmp(w->cw[j].color, w->cw[i].color)) count++;
        if (count > repeats) repeats = count;
    }
    if (repeats > 16)
        world_warn(c, "SDK_WORLD_MATERIAL_REPETITION",
                   "One wall color repeats more than 16 times; texture/material variation is at risk");
    if (w->brush_stats.brushes > 0 && w->brush_stats.tool_brushes == 0)
        sdk_diag(c->rep, SDK_INFO, "SDK_WORLD_BRUSH_PLAIN", c->path, NULL, NULL,
                 "Brush map has no tool materials; sky/clip boundary is the default envelope");
    check_unreachable_cells(c, w);
    check_sky_leak_flood(c, w);
}

static bool compile_world(const char *path, World *w, SdkReport *rep, StackInfo **stacks, int *nstacks, int *total_spans, bool renderer, float region_override)

{
    *stacks = NULL;
    *nstacks = 0;
    *total_spans = 0;
    Ctx c = { rep, path };
    clock_t load_started = clock();
    bool ok = load_world(path, w, rep, renderer);
    w->stage_load_ms = (double)(clock() - load_started) * 1000.0 / (double)CLOCKS_PER_SEC;
    if (!ok) return false;
    if (region_override > 0.0f) w->region_size = region_override;
    clock_t compile_started = clock();
    build_compiled(w);
    if(renderer)for(int i=0;i<w->ncc;i++)for(int j=i+1;j<w->ncc;){
        CCell *a=&w->cc[i],*b=&w->cc[j];
        if(a->explicit_index>=0&&b->explicit_index>=0&&a->x==b->x&&a->y==b->y&&a->w==b->w&&a->h==b->h){
            WSpan *spans=realloc(a->spans,(size_t)(a->nspan+b->nspan)*sizeof(WSpan));
            if(!spans){sdk_diag(rep,SDK_ERROR,"SDK_OOM",path,NULL,NULL,"Stacked cell merge failed");return false;}
            a->spans=spans;memcpy(a->spans+a->nspan,b->spans,(size_t)b->nspan*sizeof(WSpan));a->nspan+=b->nspan;free(b->spans);
            memmove(b,b+1,(size_t)(w->ncc-j-1)*sizeof(CCell));w->ncc--;
        }else j++;
    }
    check_compiled(&c, w, &ok, stacks, nstacks, total_spans);
    check_portals(&c, w, &ok);
    clock_t region_started = clock();
    if (ok) ok = build_regions(&c, w);
    w->stage_region_ms += (double)(clock() - region_started) * 1000.0 / (double)CLOCKS_PER_SEC;
    if (ok) compiler_warnings(&c, w, *total_spans);
    w->stage_compile_ms = (double)(clock() - compile_started) * 1000.0 / (double)CLOCKS_PER_SEC;
    if (ok) check_leaks(&c, w);
    if (w->nportal > 0 && !renderer) {
        sdk_diag(rep, SDK_INFO, "SDK_WORLD_PORTALS_NOT_IN_RUNTIME", path, NULL, NULL,
                 "Порталы (%d) и PVS — данные компилятора и диагностика: рантайм Re2D World их не использует", w->nportal);
    }
    if (w->nportal > 0 || w->ncell > 1) {
        // Изолированные cells: нет ни портала, ни общей кромки с соседом.
        for (int i = 0; i < w->ncell; ++i) {
            bool linked = false;
            for (int p = 0; p < w->nportal && !linked; ++p) linked = !strcmp(w->portals[p].a, w->cells[i].id) || !strcmp(w->portals[p].b, w->cells[i].id);
            for (int j = 0; j < w->ncc && !linked; ++j) {
                if (w->cc[j].explicit_index == i) continue;
                int axis; float co, lo, hi;
                WCell tmp = { .x = w->cc[j].x, .y = w->cc[j].y, .w = w->cc[j].w, .h = w->cc[j].h };
                linked = shared_edge(&w->cells[i], &tmp, &axis, &co, &lo, &hi);
            }
            if (!linked) {
                char loc[2048];
                snprintf(loc, sizeof loc, "{\"section\":\"cells\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(w->cells[i].id));
                sdk_diag(rep, SDK_INFO, "SDK_WORLD_CELL_ISOLATED", path, loc, NULL, "cell «%s» не связан ни порталом, ни общей кромкой с другим cell", w->cells[i].id);
            }
        }
    }
    return ok;
}

// ---------------------------------------------------------------------------
// Валидатор типа re2d.world и CLI
// ---------------------------------------------------------------------------
void sdk_validate_re2dmap(const char *path, SdkReport *rep)
{
    World w;
    StackInfo *stacks;
    int n, spans;
    compile_world(path, &w, rep, &stacks, &n, &spans, false, 0.0f);
    free(stacks);
    world_free(&w);
}

static void put_stack(R2dSb *sb, const StackInfo *s)
{
    r2d_sb_puts(sb, "{\"lower\":{\"cell\":"); r2d_sb_put_json_string(sb, s->a);
    r2d_sb_printf(sb, ",\"bottom\":%g,\"top\":%g},\"upper\":{\"cell\":", s->ab, s->at);
    r2d_sb_put_json_string(sb, s->b);
    r2d_sb_printf(sb, ",\"bottom\":%g,\"top\":%g},\"xy\":[%g,%g,%g,%g]}", s->bb, s->bt, s->rect[0], s->rect[1], s->rect[2], s->rect[3]);
}

// `world-compile <карта.re2dmap> [--output файл]`; `world-info` — то же без записи.
static int world_cmd_at(const SdkArgs *a, bool write, int positional)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *src = sdk_arg_positional(a, positional);
    if (!src) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", write ? "Использование: r2d world-compile <карта.re2dmap> [--output описание.json]" : "Использование: r2d world-info <карта.re2dmap>");
        sdk_report_free(&rep);
        return rc;
    }
    if (!sdk_file_exists(src)) {
        const int rc = sdk_fail(&rep, "SDK_FILE_NOT_FOUND", "Файл не найден: %s", src);
        sdk_report_free(&rep);
        return rc;
    }
    World w;
    StackInfo *stacks;
    int nstacks, spans;
    const bool renderer = sdk_arg_flag(a,"--renderer");
    const bool want_pvs = sdk_arg_flag(a,"--pvs");
    float region_override = 0.0f;
    const char *region_arg = sdk_arg_value(a, "--region-size");
    if (region_arg) {
        char *end = NULL;
        region_override = strtof(region_arg, &end);
        if (!end || *end || !isfinite(region_override) || region_override < 16.0f) {
            sdk_diag(&rep, SDK_ERROR, "SDK_USAGE", "--region-size", NULL, NULL,
                     "--region-size requires a number >= 16");
            sdk_report_free(&rep);
            return 1;
        }
    }
    bool ok = compile_world(src, &w, &rep, &stacks, &nstacks, &spans, renderer, region_override);
    R2dSb renderer_data;r2d_sb_init(&renderer_data);
    if(ok&&renderer)ok=put_renderer_description(&w,&renderer_data,&rep,src);
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"source\":");
    r2d_sb_put_json_string(&out, src);
    char outpath[1024] = "";
    if (ok && write) {
        const char *o = sdk_arg_value(a, "--output");
        if (!o) o = sdk_arg_value(a, "--out");
        if (o) snprintf(outpath, sizeof outpath, "%s", o);
        else {
            snprintf(outpath, sizeof outpath, "%s", src);
            char *dot = strrchr(outpath, '.');
            if (dot && strchr(dot, '/') == NULL) *dot = '\0';
            strncat(outpath, renderer?".re2dworld":".compiled.json", sizeof outpath - strlen(outpath) - 1);
        }
        R2dSb file;
        r2d_sb_init(&file);
        bool description_ok=true;
        if(renderer)r2d_sb_puts(&file,renderer_data.data);else put_description(&w, &file, true, false);
        r2d_sb_putc(&file, '\n');
        if(!description_ok){outpath[0]=0;}
        else if (!sdk_write_file(outpath, file.data, file.len)) {
            sdk_diag(&rep, SDK_ERROR, "SDK_WRITE_FAILED", outpath, NULL, NULL, "Не удалось записать %s", outpath);
            outpath[0] = '\0';
        }
        r2d_sb_free(&file);
    }
    r2d_sb_printf(&out, ",\"ok\":%s,\"output\":", ok && rep.errors == 0 ? "true" : "false");
    if (outpath[0]) r2d_sb_put_json_string(&out, outpath); else r2d_sb_puts(&out, "null");
    r2d_sb_printf(&out, ",\"outputFormat\":\"%s\",\"runtimePortals\":%s", renderer?"re2dworld-v1":"legacy-compiled-json",renderer?"true":"false");
    r2d_sb_printf(&out, ",\"stats\":{\"cells\":%d,\"walls\":%d,\"portals\":%d,\"stairs\":%d,\"slopes\":%d,\"compiledCells\":%d,\"compiledWalls\":%d,\"spans\":%d,\"stairSteps\":%d,\"slopeSegments\":%d,\"stacks\":%d,\"brushes\":%d,\"toolBrushes\":%d,\"polygonBrushes\":%d,\"subtractBrushes\":%d,\"holeBrushes\":%d,\"brushCells\":%d,\"brushWalls\":%d,\"brushPortals\":%d,\"mergedCells\":%d,\"areaPortals\":%d,\"hintBarriers\":%d,\"regions\":%d,\"regionColumns\":%d,\"regionRows\":%d,\"pvsEdges\":%d,\"entities\":%d,\"pointEntities\":%d,\"brushEntities\":%d,\"brushEntityMap\":%d,\"loadMs\":%.3f,\"compileMs\":%.3f,\"regionMs\":%.3f}",
                  w.ncell, w.nwall, w.nportal, w.nstairs, w.nslopes, w.ncc, w.ncw, spans, w.stair_steps, w.slope_segments, nstacks,
                  w.brush_stats.brushes, w.brush_stats.tool_brushes,
                  w.brush_stats.polygon_brushes, w.brush_stats.subtract_brushes,
                  w.brush_stats.hole_brushes, w.brush_stats.cells,
                  w.brush_stats.walls, w.brush_stats.portals, w.brush_stats.merged_cells,
                  w.brush_stats.areaportal_edges, w.brush_stats.hint_barriers,
                  w.region_count, w.region_columns,
                  w.region_rows, w.region_pvs_edges, w.nentities, w.npoint_entities,
                  w.nbrush_entities, w.nentity_map, w.stage_load_ms, w.stage_compile_ms,
                  w.stage_region_ms);
    r2d_sb_printf(&out, ",\"stageReport\":[{\"stage\":\"load\",\"ms\":%.3f},{\"stage\":\"compile\",\"ms\":%.3f},{\"stage\":\"regions\",\"ms\":%.3f}]",
                  w.stage_load_ms, w.stage_compile_ms, w.stage_region_ms);
    r2d_sb_puts(&out, ",\"stacks\":[");
    for (int i = 0; i < nstacks && i < 64; ++i) { if (i) r2d_sb_putc(&out, ','); put_stack(&out, &stacks[i]); }
    r2d_sb_puts(&out, "]");
    if (ok) {
        r2d_sb_puts(&out, ",\"world\":");
        if(renderer)r2d_sb_puts(&out,renderer_data.data);else put_description(&w, &out, false, false);
        r2d_sb_puts(&out, ",\"portals\":[");
        for (int i = 0; i < w.nportal; ++i) {
            const WPortal *p = &w.portals[i];
            r2d_sb_printf(&out, "%s{\"id\":", i ? "," : "");
            r2d_sb_put_json_string(&out, p->id);
            r2d_sb_puts(&out, ",\"cellA\":"); r2d_sb_put_json_string(&out, p->a);
            r2d_sb_puts(&out, ",\"cellB\":"); r2d_sb_put_json_string(&out, p->b);
            r2d_sb_puts(&out, ",\"openings\":[");
            for (int k = 0; k < p->nopen; ++k) r2d_sb_printf(&out, "%s{\"bottom\":%g,\"top\":%g}", k ? "," : "", p->open[k].bottom, p->open[k].top);
            r2d_sb_puts(&out, "]}");
        }
        r2d_sb_puts(&out, "],\"pvs\":");
        if(want_pvs)put_pvs(&w, &out);
        else r2d_sb_puts(&out,"{\"kind\":\"skipped\",\"reason\":\"legacy portal-reachability is opt-in; pass --pvs\"}");
    }
    r2d_sb_puts(&out, ",");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_puts(&out, ",");
    sdk_report_put(&rep, &out);
    r2d_sb_puts(&out, "}\n");
    fputs(out.data, stdout);
    fflush(stdout);
    const int rc = (ok && rep.errors == 0) ? 0 : 1;
    r2d_sb_free(&out);r2d_sb_free(&renderer_data);
    free(stacks);
    world_free(&w);
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_world_compile(const SdkArgs *a) { return world_cmd_at(a, true, 0); }
int sdk_cmd_world_info(const SdkArgs *a) { return world_cmd_at(a, false, 0); }
int sdk_cmd_world(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (sub && !strcmp(sub, "compile")) return world_cmd_at(a, true, 1);
    if (sub && !strcmp(sub, "info")) return world_cmd_at(a, false, 1);
    if (sub && !strcmp(sub, "validate")) return world_cmd_at(a, false, 1);
    SdkReport rep;
    sdk_report_init(&rep);
    const int rc = sdk_fail(&rep, "SDK_USAGE",
        "Использование: r2d world compile|info|validate <карта.re2dmap> [--renderer] [--pvs] [--region-size N] [--output file]");
    sdk_report_free(&rep);
    return rc;
}
