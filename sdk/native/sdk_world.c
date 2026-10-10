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

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define W_EPS 0.001f
#define W_LIMIT 1000000.0f
#define W_MAX 65536

typedef struct WSpan {
    float bottom, top, floor_a, floor_b;
    char  floor_c[40], ceil_c[40];
    R2DWorldSpanLight light;bool lit;
} WSpan;

typedef struct WCell {
    char   id[64];
    float  x, y, w, h;
    WSpan *spans;
    int    nspan;
} WCell;

typedef struct WWall {
    char  id[64];
    float x1, y1, x2, y2, bottom, top;
    char  color[40];
} WWall;

typedef struct WOpening { float bottom, top; } WOpening;

typedef struct WPortal {
    char      id[64], a[64], b[64];
    float     x1, y1, x2, y2;
    WOpening *open;
    int       nopen;
} WPortal;

// Скомпилированная ячейка (одна или несколько spans) с происхождением.
typedef struct CCell {
    float  x, y, w, h;
    WSpan *spans;
    int    nspan;
    char   owner[96];       // id источника: «hall», «stairs1#3»
    int    explicit_index;  // индекс в source.cells или -1
} CCell;

typedef struct World {
    char     name[128];
    char *lighting_json,*lights_json;
    WCell   *cells;    int ncell;
    WWall   *walls;    int nwall;
    WPortal *portals;  int nportal;
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
    // --- cells ---
    const R2dJson *cells = r2d_json_get(root, "cells");
    w->ncell = r2d_json_size(cells);
    w->cells = (WCell *)calloc((size_t)(w->ncell ? w->ncell : 1), sizeof(WCell));
    char (*cids)[64] = (char (*)[64])calloc((size_t)(w->ncell ? w->ncell : 1), 64);
    for (int i = 0; i < w->ncell; ++i) {
        const R2dJson *o = cells->items[i];
        WCell *cell = &w->cells[i];
        if (o->type != R2D_JSON_OBJ) { field_diag(&c, "cells", i, NULL, "cell", "cell должен быть объектом"); ok = false; continue; }
        if (!get_id(&c, o, "cells", i, cell->id, sizeof cell->id)) { ok = false; continue; }
        memcpy(cids[i], cell->id, 64);
        float r[4];
        if (!get_rect(&c, o, "cells", i, cell->id, "rect", r)) { ok = false; continue; }
        cell->x = r[0]; cell->y = r[1]; cell->w = r[2]; cell->h = r[3];
        if (!load_spans(&c, o, "cells", i, cell->id, &cell->spans, &cell->nspan)) ok = false;
        if (cell->nspan == 0) {
            char loc[2048];
            snprintf(loc, sizeof loc, "{\"section\":\"cells\",\"index\":%d,\"id\":\"%s\"}", i, json_fragment(cell->id));
            sdk_diag(rep, SDK_WARNING, "SDK_WORLD_CELL_NO_SPANS", path, loc, NULL, "cell «%s» без spans: в мир ничего не попадёт", cell->id);
        }
    }
    for (int i = 0; i < w->ncell; ++i) if (cids[i][0] && !dup_check(&c, "cells", cids, w->ncell, i)) ok = false;
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
static void check_leaks(Ctx *c, const World *w)
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
        c->explicit_index = i;
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

static void put_description(const World *w, R2dSb *sb, bool pretty)
{
    const char *nl = pretty ? "\n" : "";
    r2d_sb_printf(sb, "{%s\"walls\":[", nl);
    for (int i = 0; i < w->ncw; ++i) {
        const WWall *wl = &w->cw[i];
        r2d_sb_printf(sb, "%s%s{\"from\":[", i ? "," : "", pretty ? "\n  " : "");
        put_num(sb, wl->x1); r2d_sb_putc(sb, ','); put_num(sb, wl->y1);
        r2d_sb_puts(sb, "],\"to\":[");
        put_num(sb, wl->x2); r2d_sb_putc(sb, ','); put_num(sb, wl->y2);
        r2d_sb_puts(sb, "],\"bottom\":"); put_num(sb, wl->bottom);
        r2d_sb_puts(sb, ",\"top\":"); put_num(sb, wl->top);
        r2d_sb_puts(sb, ",\"color\":"); r2d_sb_put_json_string(sb, wl->color);
        r2d_sb_putc(sb, '}');
    }
    r2d_sb_printf(sb, "%s],%s\"cells\":[", nl, nl);
    for (int i = 0; i < w->ncc; ++i) {
        const CCell *c = &w->cc[i];
        r2d_sb_printf(sb, "%s%s{\"x\":", i ? "," : "", pretty ? "\n  " : "");
        put_num(sb, c->x); r2d_sb_puts(sb, ",\"y\":"); put_num(sb, c->y);
        r2d_sb_puts(sb, ",\"w\":"); put_num(sb, c->w); r2d_sb_puts(sb, ",\"h\":"); put_num(sb, c->h);
        r2d_sb_puts(sb, ",\"spans\":[");
        for (int k = 0; k < c->nspan; ++k) {
            r2d_sb_printf(sb, "%s{\"bottom\":", k ? "," : "");
            put_num(sb, c->spans[k].bottom); r2d_sb_puts(sb, ",\"top\":"); put_num(sb, c->spans[k].top);
            if(c->spans[k].floor_a || c->spans[k].floor_b) r2d_sb_printf(sb,",\"floorSlope\":{\"a\":%g,\"b\":%g}",c->spans[k].floor_a,c->spans[k].floor_b);
            r2d_sb_puts(sb, ",\"floorColor\":"); r2d_sb_put_json_string(sb, c->spans[k].floor_c);
            r2d_sb_puts(sb, ",\"ceilingColor\":"); r2d_sb_put_json_string(sb, c->spans[k].ceil_c);
            if(c->spans[k].lit){const R2DWorldSpanLight *l=&c->spans[k].light;unsigned color=((unsigned)roundf(l->r*255)<<16)|((unsigned)roundf(l->g*255)<<8)|(unsigned)roundf(l->b*255),fog=((unsigned)roundf(l->fog_r*255)<<16)|((unsigned)roundf(l->fog_g*255)<<8)|(unsigned)roundf(l->fog_b*255);
                r2d_sb_printf(sb,",\"lighting\":{\"level\":%g,\"color\":\"#%06x\",\"fog\":{\"density\":%g,\"start\":%g,\"color\":\"#%06x\"}}",l->level,color,l->fog_density,l->fog_start,fog);}

            r2d_sb_putc(sb, '}');
        }
        r2d_sb_puts(sb, "]}");
    }
    r2d_sb_printf(sb, "%s]%s}", nl, nl);
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
    put_description(w,sb,false);
    // put_description ends in a closing object brace; append new format fields.
    if(sb->len&&sb->data[sb->len-1]=='}')sb->data[--sb->len]=0;
    r2d_sb_puts(sb,",\"version\":1,\"portals\":[");
    for(int i=0;i<w->nportal;i++) {
        const WPortal *p=&w->portals[i];
        r2d_sb_printf(sb,"%s{\"cellA\":%d,\"cellB\":%d,\"from\":[",i?",":"",compiled[i*2],compiled[i*2+1]);
        put_num(sb,p->x1);r2d_sb_putc(sb,',');put_num(sb,p->y1);r2d_sb_puts(sb,"],\"to\":[");put_num(sb,p->x2);r2d_sb_putc(sb,',');put_num(sb,p->y2);
        r2d_sb_puts(sb,"],\"openings\":[");
        for(int j=0;j<p->nopen;j++)r2d_sb_printf(sb,"%s{\"bottom\":%g,\"top\":%g}",j?",":"",p->open[j].bottom,p->open[j].top);
        r2d_sb_puts(sb,"]}");
    }
    int emitted=w->nportal;
    // Generated stairs/slopes connect across their shared XY edge. Authored cells
    // retain explicit portal control; a solid authored wall blocks generation.
    for(int a=0;a<w->ncc;a++)for(int b=0;b<a;b++) {
        const CCell *ca=&w->cc[a],*cb=&w->cc[b];
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
    r2d_sb_putc(sb,']');if(w->lighting_json)r2d_sb_printf(sb,",\"lighting\":%s",w->lighting_json);if(w->lights_json)r2d_sb_printf(sb,",\"lights\":%s",w->lights_json);r2d_sb_putc(sb,'}');free(compiled);
    R2DRe2dWorld runtime={0};char error[256];
    if(!r2d_world_load_json(&runtime,sb->data,error,sizeof error)){
        sdk_diag(rep,SDK_ERROR,"SDK_WORLD_RENDERER_BAKE",path,NULL,NULL,"%s",error);return false;}
    if(sb->len&&sb->data[sb->len-1]=='}')sb->data[--sb->len]=0;
    r2d_sb_putc(sb,',');bool baked=r2d_world_put_baked(&runtime,sb);r2d_sb_putc(sb,'}');r2d_world_free(&runtime);if(!baked)sdk_diag(rep,SDK_ERROR,"SDK_WORLD_RENDERER_BAKE",path,NULL,NULL,"Native static light precompute failed");return baked;
}

// Консервативная достижимость через порталы (данные компилятора; рантайм PVS не использует).
static void put_pvs(const World *w, R2dSb *sb)
{
    r2d_sb_puts(sb, "{\"kind\":\"portal-reachability\",\"conservative\":true,\"runtimeUsed\":false,\"cells\":{");
    int *seen = (int *)calloc((size_t)(w->ncell ? w->ncell : 1), sizeof(int));
    int *queue = (int *)calloc((size_t)(w->ncell ? w->ncell : 1), sizeof(int));
    for (int s = 0; s < w->ncell; ++s) {
        memset(seen, 0, (size_t)w->ncell * sizeof(int));
        int head = 0, tail = 0;
        queue[tail++] = s;
        seen[s] = 1;
        while (head < tail) {
            const int cur = queue[head++];
            for (int p = 0; p < w->nportal; ++p) {
                const int a = find_cell(w, w->portals[p].a), b = find_cell(w, w->portals[p].b);
                if (a < 0 || b < 0) continue;
                const int nxt = a == cur ? b : b == cur ? a : -1;
                if (nxt >= 0 && !seen[nxt]) { seen[nxt] = 1; queue[tail++] = nxt; }
            }
        }
        r2d_sb_printf(sb, "%s", s ? "," : "");
        r2d_sb_put_json_string(sb, w->cells[s].id);
        r2d_sb_putc(sb, ':');
        r2d_sb_putc(sb, '[');
        int first = 1;
        for (int i = 0; i < w->ncell; ++i) {
            if (i == s || !seen[i]) continue;
            r2d_sb_printf(sb, "%s", first ? "" : ",");
            r2d_sb_put_json_string(sb, w->cells[i].id);
            first = 0;
        }
        r2d_sb_putc(sb, ']');
    }
    free(seen);
    free(queue);
    r2d_sb_puts(sb, "}}");
}

// Полный проход: загрузка + раскрытие + проверки. `compiled` — доступно при ok.
static bool compile_world(const char *path, World *w, SdkReport *rep, StackInfo **stacks, int *nstacks, int *total_spans, bool renderer)
{
    *stacks = NULL;
    *nstacks = 0;
    *total_spans = 0;
    Ctx c = { rep, path };
    bool ok = load_world(path, w, rep, renderer);
    if (!ok) return false;
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
    compile_world(path, &w, rep, &stacks, &n, &spans, false);
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
static int world_cmd(const SdkArgs *a, bool write)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *src = sdk_arg_positional(a, 0);
    if (!src) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", write ? "Использование: r2d-sdk world-compile <карта.re2dmap> [--output описание.json]" : "Использование: r2d-sdk world-info <карта.re2dmap>");
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
    bool ok = compile_world(src, &w, &rep, &stacks, &nstacks, &spans, renderer);
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
        if(renderer)r2d_sb_puts(&file,renderer_data.data);else put_description(&w, &file, true);
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
    r2d_sb_printf(&out, ",\"stats\":{\"cells\":%d,\"walls\":%d,\"portals\":%d,\"stairs\":%d,\"slopes\":%d,\"compiledCells\":%d,\"compiledWalls\":%d,\"spans\":%d,\"stairSteps\":%d,\"slopeSegments\":%d,\"stacks\":%d}",
                  w.ncell, w.nwall, w.nportal, w.nstairs, w.nslopes, w.ncc, w.ncw, spans, w.stair_steps, w.slope_segments, nstacks);
    r2d_sb_puts(&out, ",\"stacks\":[");
    for (int i = 0; i < nstacks && i < 64; ++i) { if (i) r2d_sb_putc(&out, ','); put_stack(&out, &stacks[i]); }
    r2d_sb_puts(&out, "]");
    if (ok) {
        r2d_sb_puts(&out, ",\"world\":");
        if(renderer)r2d_sb_puts(&out,renderer_data.data);else put_description(&w, &out, false);
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
        put_pvs(&w, &out);
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

int sdk_cmd_world_compile(const SdkArgs *a) { return world_cmd(a, true); }
int sdk_cmd_world_info(const SdkArgs *a) { return world_cmd(a, false); }
