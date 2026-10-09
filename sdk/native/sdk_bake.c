// ===========================================================================
// Re2D Baker (Prop): меш → поверхность Re2DSprite.
//
//   S(u,v) = { x, y, z, part, coverage, material }          (docs/SDK.md §10)
//
// Конвейер: загрузка GLB/glTF → перевод осей в Re2D (X вправо, Y ВНИЗ,
// Z к зрителю) → вписывание в допустимый диапазон → раскладка UV (авто:
// 6 плоских карт по доминирующей оси нормали; existing: UV модели как есть)
// → растеризация в сетку текселей → отсчёты поверхности (ID, глубина, покрытие,
// XYZ) → PNG v2 + `*.character.json` + анимация `spin` + отчёт.
//
// Один код на GUI и CLI. 3D-данные после bake не нужны и не сохраняются.
// ===========================================================================
#include "sdk_bake.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Допустимый диапазон координат карт (RE2DSPRITE_MATH.md §2).
#define LIM_XMIN (-32.0f)
#define LIM_XMAX (31.75f)
#define LIM_YMIN (-64.0f)
#define LIM_YMAX (63.5f)
#define LIM_ZMIN (-32.0f)
#define LIM_ZMAX (31.75f)

#define MAP_W 256
#define MAP_H 192

void bk_default_options(BkOptions *o)
{
    memset(o, 0, sizeof *o);
    o->type = "prop";
    o->uv = BK_UV_AUTO;
    o->origin = BK_ORIGIN_CENTER;
    o->size = 1024;
    o->scale = 0;
    o->margin = 0.98f;
    o->first_id = 80;
    o->style = "anime";
}

// ---------------------------------------------------------------------------
// Раскладка: плоские карты
// ---------------------------------------------------------------------------
typedef struct Chart {
    int   axis, sign;
    int   ua, va;                  // оси модели для u и v
    float umin, vmin, umax, vmax;
    int   ox, oy, sw, sh;          // положение и размер в отсчётах
    int   tris;
    float weight, area, weighted_area;
    bool  used;
} Chart;

static void chart_axes(int axis, int *ua, int *va)
{
    if (axis == 0) { *ua = 2; *va = 1; }
    else if (axis == 1) { *ua = 0; *va = 2; }
    else { *ua = 0; *va = 1; }
}

typedef struct PackItem { int index, w, h; } PackItem;

static int cmp_pack(const void *a, const void *b)
{
    const PackItem *x = (const PackItem *)a, *y = (const PackItem *)b;
    if (x->h != y->h) return y->h - x->h;
    return y->w - x->w;
}

// Полки: возвращает true, если все прямоугольники (с зазором) влезли в W×H отсчётов.
static bool pack_charts(Chart *charts, int n, float spacing)
{
    PackItem items[6];
    int m = 0;
    for (int i = 0; i < n; ++i) {
        if (!charts[i].used) continue;
        items[m].index = i;
        items[m].w = (int)ceilf((charts[i].umax - charts[i].umin) / (spacing / charts[i].weight)) + 2;
        items[m].h = (int)ceilf((charts[i].vmax - charts[i].vmin) / (spacing / charts[i].weight)) + 2;
        ++m;
    }
    qsort(items, (size_t)m, sizeof items[0], cmp_pack);
    int x = 0, y = 0, shelf = 0;
    for (int i = 0; i < m; ++i) {
        if (items[i].w > MAP_W || items[i].h > MAP_H) return false;
        if (x + items[i].w > MAP_W) { x = 0; y += shelf; shelf = 0; }
        if (y + items[i].h > MAP_H) return false;
        Chart *c = &charts[items[i].index];
        c->ox = x;
        c->oy = y;
        c->sw = items[i].w;
        c->sh = items[i].h;
        x += items[i].w;
        if (items[i].h > shelf) shelf = items[i].h;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------
typedef struct V3 { float x, y, z; } V3;

static V3 v3(float x, float y, float z) { V3 r = { x, y, z }; return r; }
static V3 sub(V3 a, V3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static V3 cross(V3 a, V3 b) { return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
static float comp(V3 a, int i) { return i == 0 ? a.x : i == 1 ? a.y : a.z; }

static float qenc(float v, float a)
{
    float q = nearbyintf((a * v + 128.0f) * 16.0f);
    if (q < 0) q = 0;
    if (q > 4080) q = 4080;
    return q;
}

static void put_px(uint8_t *png, int size, int x, int y, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
    uint8_t *p = png + ((size_t)y * (size_t)size + (size_t)x) * 4;
    p[0] = r; p[1] = g; p[2] = b; p[3] = a;
}

// Блок k×k рабочей сетки (карта или заголовок).
static void put_block(uint8_t *png, int size, int k, int bx, int by, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
    for (int dy = 0; dy < k; ++dy) for (int dx = 0; dx < k; ++dx) put_px(png, size, bx * k + dx, by * k + dy, r, g, b, a);
}

// Билинейная выборка с повтором.
static void sample_tex(const BkTexture *t, float u, float v, float out[4])
{
    const float fu = u - floorf(u), fv = v - floorf(v);
    const float x = fu * t->w - 0.5f, y = fv * t->h - 0.5f;
    const int x0 = (int)floorf(x), y0 = (int)floorf(y);
    const float ax = x - x0, ay = y - y0;
    float acc[4] = { 0, 0, 0, 0 };
    for (int j = 0; j < 2; ++j) {
        for (int i = 0; i < 2; ++i) {
            int xx = (x0 + i) % t->w, yy = (y0 + j) % t->h;
            if (xx < 0) xx += t->w;
            if (yy < 0) yy += t->h;
            const float w = (i ? ax : 1 - ax) * (j ? ay : 1 - ay);
            const uint8_t *p = t->px + ((size_t)yy * (size_t)t->w + (size_t)xx) * 4;
            for (int c = 0; c < 4; ++c) acc[c] += w * p[c] / 255.0f;
        }
    }
    memcpy(out, acc, sizeof acc);
}

// Барицентры точки (px,py) в треугольнике из трёх 2D-вершин; false при вырождении.
static bool bary2(const float v[3][2], float px, float py, float b[3])
{
    const float d = (v[1][1] - v[2][1]) * (v[0][0] - v[2][0]) + (v[2][0] - v[1][0]) * (v[0][1] - v[2][1]);
    if (fabsf(d) < 1e-12f) return false;
    b[0] = ((v[1][1] - v[2][1]) * (px - v[2][0]) + (v[2][0] - v[1][0]) * (py - v[2][1])) / d;
    b[1] = ((v[2][1] - v[0][1]) * (px - v[2][0]) + (v[0][0] - v[2][0]) * (py - v[2][1])) / d;
    b[2] = 1.0f - b[0] - b[1];
    return true;
}

// ---------------------------------------------------------------------------
// Состояние bake
// ---------------------------------------------------------------------------
typedef struct Baker {
    BkScene   *scene;
    const BkOptions *opt;
    SdkReport *rep;
    int        k, T, W, H, size;
    Chart      charts[6];
    float      spacing;
    int       *tri_chart;      // индекс карты для треугольника (auto)
    bool      *skip;           // вырожденный треугольник: не растеризуем
    int       *tri_at;         // треугольник в тексель (W*H) или -1
    float     *depth_at;
    int       *part_of_mat;    // материал → индекс части (-1 нет)
    int       *tri_part;       // треугольник → индекс части (prop: по материалу, character: по кости)
    int        nparts;
    int        part_mat[254];
    char       part_name[254][80];
    int        uv_overlap;
} Baker;

// 2D-координаты вершин треугольника в текселях выбранной раскладки.
static void tri_texel_coords(const Baker *b, int ti, float out[3][2])
{
    const BkTri *t = &b->scene->tris[ti];
    if (b->opt->uv == BK_UV_EXISTING) {
        for (int i = 0; i < 3; ++i) { out[i][0] = t->uv[i][0] * b->W; out[i][1] = t->uv[i][1] * b->H; }
        return;
    }
    const Chart *c = &b->charts[b->tri_chart[ti]];
    const float tex_per_unit = (float)b->T * c->weight / b->spacing;
    for (int i = 0; i < 3; ++i) {
        out[i][0] = (float)(c->ox * b->T) + (comp(v3(t->p[i][0], t->p[i][1], t->p[i][2]), c->ua) - c->umin) * tex_per_unit + (float)b->T;
        out[i][1] = (float)(c->oy * b->T) + (comp(v3(t->p[i][0], t->p[i][1], t->p[i][2]), c->va) - c->vmin) * tex_per_unit + (float)b->T;
    }
}

static void rasterize(Baker *b)
{
    for (int ti = 0; ti < b->scene->ntri; ++ti) {
        if (b->skip[ti]) continue;
        const BkTri *t = &b->scene->tris[ti];
        float v[3][2];
        tri_texel_coords(b, ti, v);
        const Chart *c = b->opt->uv != BK_UV_EXISTING ? &b->charts[b->tri_chart[ti]] : NULL;
        float minx = fminf(v[0][0], fminf(v[1][0], v[2][0])), maxx = fmaxf(v[0][0], fmaxf(v[1][0], v[2][0]));
        float miny = fminf(v[0][1], fminf(v[1][1], v[2][1])), maxy = fmaxf(v[0][1], fmaxf(v[1][1], v[2][1]));
        int x0 = (int)floorf(minx), x1 = (int)ceilf(maxx), y0 = (int)floorf(miny), y1 = (int)ceilf(maxy);
        int lo_x = 0, hi_x = b->W, lo_y = 0, hi_y = b->H;
        if (c) {                                           // карта пишет только в свой прямоугольник
            lo_x = c->ox * b->T; hi_x = (c->ox + c->sw) * b->T;
            lo_y = c->oy * b->T; hi_y = (c->oy + c->sh) * b->T;
        }
        if (x0 < lo_x) x0 = lo_x;
        if (y0 < lo_y) y0 = lo_y;
        if (x1 > hi_x) x1 = hi_x;
        if (y1 > hi_y) y1 = hi_y;
        for (int y = y0; y < y1; ++y) {
            for (int x = x0; x < x1; ++x) {
                float bc[3];
                if (!bary2((const float(*)[2])v, x + 0.5f, y + 0.5f, bc)) goto next_tri;
                if (bc[0] < -1e-4f || bc[1] < -1e-4f || bc[2] < -1e-4f) continue;
                const size_t at = (size_t)y * (size_t)b->W + (size_t)x;
                float depth = 0;
                if (c) {
                    for (int i = 0; i < 3; ++i) depth += bc[i] * (float)c->sign * t->p[i][c->axis];
                } else {
                    depth = (float)ti;               // existing: побеждает позднейший
                }
                if (b->tri_at[at] >= 0 && b->opt->uv == BK_UV_EXISTING && b->tri_at[at] != ti) {
                    // Два разных треугольника в одном тексель UV: наложение развёртки.
                    const BkTri *o = &b->scene->tris[b->tri_at[at]];
                    float ob[3];
                    float ov[3][2];
                    tri_texel_coords(b, b->tri_at[at], ov);
                    if (bary2((const float(*)[2])ov, x + 0.5f, y + 0.5f, ob)) {
                        float q1[3] = { 0, 0, 0 }, q2[3] = { 0, 0, 0 };
                        for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j) { q1[j] += bc[i] * t->p[i][j]; q2[j] += ob[i] * o->p[i][j]; }
                        const float dx = q1[0] - q2[0], dy = q1[1] - q2[1], dz = q1[2] - q2[2];
                        if (dx * dx + dy * dy + dz * dz > 0.25f) b->uv_overlap++;
                    }
                }
                if (b->tri_at[at] < 0 || depth >= b->depth_at[at]) {
                    b->tri_at[at] = ti;
                    b->depth_at[at] = depth;
                }
            }
        }
    next_tri:;
    }
}

// Положение/цвет текселя по его треугольнику.
static bool shade_texel(const Baker *b, int tx, int ty, V3 *pos, uint8_t rgba[4])
{
    const int ti = b->tri_at[(size_t)ty * (size_t)b->W + (size_t)tx];
    if (ti < 0) return false;
    const BkTri *t = &b->scene->tris[ti];
    float v[3][2], bc[3];
    tri_texel_coords(b, ti, v);
    if (!bary2((const float(*)[2])v, tx + 0.5f, ty + 0.5f, bc)) return false;
    // Края могут чуть выходить за 0..1 из-за допуска растеризации.
    for (int i = 0; i < 3; ++i) bc[i] = fminf(fmaxf(bc[i], 0.0f), 1.0f);
    const float sum = bc[0] + bc[1] + bc[2];
    if (sum > 0) for (int i = 0; i < 3; ++i) bc[i] /= sum;
    if (pos) {
        pos->x = bc[0] * t->p[0][0] + bc[1] * t->p[1][0] + bc[2] * t->p[2][0];
        pos->y = bc[0] * t->p[0][1] + bc[1] * t->p[1][1] + bc[2] * t->p[2][1];
        pos->z = bc[0] * t->p[0][2] + bc[1] * t->p[1][2] + bc[2] * t->p[2][2];
    }
    const BkMaterial *m = &b->scene->mats[t->material];
    float c[4] = { m->base[0], m->base[1], m->base[2], m->base[3] };
    if (m->tex >= 0 && t->has_uv) {
        const float u = bc[0] * t->uv[0][0] + bc[1] * t->uv[1][0] + bc[2] * t->uv[2][0];
        const float vv = bc[0] * t->uv[0][1] + bc[1] * t->uv[1][1] + bc[2] * t->uv[2][1];
        float s[4];
        sample_tex(&b->scene->texs[m->tex], u, vv, s);
        for (int i = 0; i < 4; ++i) c[i] *= s[i];
    }
    if (m->alpha != BK_ALPHA_OPAQUE && c[3] < (m->alpha == BK_ALPHA_MASK ? m->cutoff : 0.5f)) return false;
    for (int i = 0; i < 3; ++i) rgba[i] = (uint8_t)fminf(fmaxf(c[i] * 255.0f + 0.5f, 0.0f), 255.0f);
    rgba[3] = 255;
    return true;
}

// Временный source preview: только authoring, исходные треугольники не
// поступают в runtime. Правая сторона GUI всегда обычный $.re2dSprite.
static bool write_source_previews(const BkScene *scene, const char *dir, SdkReport *rep)
{
    const int size = 512;
    uint8_t *image = calloc((size_t)size * size, 4);
    float *depth = malloc((size_t)size * size * sizeof(float));
    if (!image || !depth || !SDL_CreateDirectory(dir)) { free(image); free(depth); return false; }
    const int yaws[] = {0,45,90,135,180}, pitches[] = {-45,-20,0,20,45};
    bool ok = true;
    for (int yi=0; yi<5 && ok; yi++) for (int pi=0; pi<5 && ok; pi++) {
        memset(image,0,(size_t)size*size*4);
        for (int i=0;i<size*size;i++) depth[i]=-1e30f;
        float yaw=yaws[yi]*0.01745329252f, pitch=pitches[pi]*0.01745329252f;
        float cy=cosf(yaw),sy=sinf(yaw),cp=cosf(pitch),sp=sinf(pitch);
        for (int ti=0;ti<scene->ntri;ti++) {
            const BkTri *tri=&scene->tris[ti];
            const BkMaterial *mat=&scene->mats[tri->material];
            float xy[3][2],z[3];
            for(int v=0;v<3;v++) {
                float x=tri->p[v][0],y=tri->p[v][1],zz=-sy*x+cy*tri->p[v][2];
                xy[v][0]=256+4*(cy*x+sy*tri->p[v][2]);
                xy[v][1]=256+4*(cp*y-sp*zz); z[v]=sp*y+cp*zz;
            }
            int x0=(int)fmaxf(0,floorf(fminf(xy[0][0],fminf(xy[1][0],xy[2][0]))));
            int x1=(int)fminf(size-1,ceilf(fmaxf(xy[0][0],fmaxf(xy[1][0],xy[2][0]))));
            int y0=(int)fmaxf(0,floorf(fminf(xy[0][1],fminf(xy[1][1],xy[2][1]))));
            int y1=(int)fminf(size-1,ceilf(fmaxf(xy[0][1],fmaxf(xy[1][1],xy[2][1]))));
            for(int y=y0;y<=y1;y++)for(int x=x0;x<=x1;x++) {
                float b[3];if(!bary2((const float(*)[2])xy,x+.5f,y+.5f,b)||b[0]<0||b[1]<0||b[2]<0)continue;
                float d=b[0]*z[0]+b[1]*z[1]+b[2]*z[2];int at=y*size+x;if(d<depth[at])continue;
                float c[4];memcpy(c,mat->base,sizeof c);
                if(mat->tex>=0 && tri->has_uv) {
                    float u=0,v=0,t[4];for(int j=0;j<3;j++){u+=b[j]*tri->uv[j][0];v+=b[j]*tri->uv[j][1];}
                    sample_tex(&scene->texs[mat->tex],u,v,t);for(int j=0;j<4;j++)c[j]*=t[j];
                }
                if(mat->alpha!=BK_ALPHA_OPAQUE && c[3]<(mat->alpha==BK_ALPHA_MASK?mat->cutoff:.5f))continue;
                depth[at]=d;for(int j=0;j<3;j++)image[at*4+j]=(uint8_t)fminf(255,fmaxf(0,c[j]*255+.5f));image[at*4+3]=255;
            }
        }
        char path[1400];snprintf(path,sizeof path,"%s/source-%d-%d.png",dir,yaws[yi],pitches[pi]);
        ok=sdk_image_write_png(path,image,size,size);
    }
    free(image);free(depth);
    if(!ok)sdk_diag(rep,SDK_ERROR,"SDK_SOURCE_PREVIEW_WRITE",dir,NULL,NULL,"Не удалось записать source preview");
    return ok;
}

// ---------------------------------------------------------------------------
// Запись character.json (стиль JSON.stringify отступ 2 — как у Studio)
// ---------------------------------------------------------------------------
static void put_pretty(R2dSb *sb, const R2dJson *v, int depth)
{
    if (!v) { r2d_sb_puts(sb, "null"); return; }
    switch (v->type) {
    case R2D_JSON_NULL: r2d_sb_puts(sb, "null"); break;
    case R2D_JSON_BOOL: r2d_sb_puts(sb, v->boolean ? "true" : "false"); break;
    case R2D_JSON_NUM:  r2d_sb_put_json_number(sb, v->number); break;
    case R2D_JSON_STR:  r2d_sb_put_json_string(sb, v->string); break;
    case R2D_JSON_ARR:
        if (v->count == 0) { r2d_sb_puts(sb, "[]"); break; }
        r2d_sb_puts(sb, "[\n");
        for (int i = 0; i < v->count; ++i) {
            for (int d = 0; d <= depth; ++d) r2d_sb_puts(sb, "  ");
            put_pretty(sb, v->items[i], depth + 1);
            r2d_sb_puts(sb, i + 1 < v->count ? ",\n" : "\n");
        }
        for (int d = 0; d < depth; ++d) r2d_sb_puts(sb, "  ");
        r2d_sb_putc(sb, ']');
        break;
    case R2D_JSON_OBJ:
        if (v->count == 0) { r2d_sb_puts(sb, "{}"); break; }
        r2d_sb_puts(sb, "{\n");
        for (int i = 0; i < v->count; ++i) {
            for (int d = 0; d <= depth; ++d) r2d_sb_puts(sb, "  ");
            r2d_sb_put_json_string(sb, v->keys[i]);
            r2d_sb_puts(sb, ": ");
            put_pretty(sb, v->items[i], depth + 1);
            r2d_sb_puts(sb, i + 1 < v->count ? ",\n" : "\n");
        }
        for (int d = 0; d < depth; ++d) r2d_sb_puts(sb, "  ");
        r2d_sb_putc(sb, '}');
        break;
    }
}

static bool write_pretty(const char *path, const char *compact_json)
{
    char err[128];
    R2dJson *root = r2d_json_parse(compact_json, err, sizeof err);
    if (!root) return false;
    R2dSb sb;
    r2d_sb_init(&sb);
    put_pretty(&sb, root, 0);
    r2d_sb_putc(&sb, '\n');
    const bool ok = sdk_write_file(path, sb.data, sb.len);
    r2d_sb_free(&sb);
    r2d_json_free(root);
    return ok;
}

static void sanitize_group(const char *in, char *out, size_t cap)
{
    size_t n = 0;
    for (; *in && n + 1 < cap && n < 78; ++in) out[n++] = (isalnum((unsigned char)*in) || *in == '_' || *in == '-') ? *in : '_';
    out[n] = '\0';
    if (!n) snprintf(out, cap, "part");
    if (!strcmp(out, "__proto__") || !strcmp(out, "constructor") || !strcmp(out, "prototype")) strncat(out, "_", cap - strlen(out) - 1);
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------
// Отчёт для ранних отказов (до загрузки сцены): те же поля, пустой источник.
static bool early_fail(BkResult *res, const BkOptions *opt, SdkReport *rep, const BkScene *scene)
{
    BkScene empty;
    memset(&empty, 0, sizeof empty);
    R2dSb rj;
    r2d_sb_init(&rj);
    bk_report_json(res, opt, scene ? scene : &empty, rep, &rj);
    res->report_json = r2d_sb_take(&rj);
    return false;
}

bool bk_bake(const char *source, const char *out_dir, const BkOptions *opt, BkResult *res, SdkReport *rep)
{
    memset(res, 0, sizeof *res);
    BkScene scene;
    Baker bk;
    memset(&bk, 0, sizeof bk);
    bool ok = false;
    uint8_t *png = NULL;
    char name[128];

    const bool is_char = opt->type && !strcmp(opt->type, "character");
    ChRig rig;
    int *tri_owner = NULL;
    V3 *normals = NULL;
    memset(&rig, 0, sizeof rig);
    if (strcmp(opt->type, "prop") != 0 && strcmp(opt->type, "weapon") != 0 && strcmp(opt->type, "environment") != 0 && !is_char) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_TYPE_UNSUPPORTED", source, NULL, NULL,
                 "Неверный тип «%s»: доступны prop, character, weapon и environment", opt->type);
        return early_fail(res, opt, rep, NULL);
    }
    if (opt->size != 1024 && opt->size != 2048 && opt->size != 4096) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_SIZE", source, NULL, NULL, "--size должен быть 1024, 2048 или 4096");
        return early_fail(res, opt, rep, NULL);
    }
    if (!isfinite(opt->scale) || opt->scale < 0 || opt->scale > 1e6 ||
        (opt->style && strcmp(opt->style, "anime") && strcmp(opt->style, "pixel")) ||
        (opt->name && (!opt->name[0] || strlen(opt->name) >= sizeof name || strchr(opt->name, '/') || strchr(opt->name, '\\') || !strcmp(opt->name, ".") || !strcmp(opt->name, "..")))) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_OPTIONS", source, NULL, NULL, "Неверные scale, style или имя файла результата");
        return early_fail(res, opt, rep, NULL);
    }
    if (!bk_load_expression(source, opt->expression, &scene, rep)) {
        const bool r = early_fail(res, opt, rep, &scene);
        bk_free(&scene);
        return r;
    }
    res->triangles = scene.ntri;
    res->textures = scene.ntex;
    if (!is_char && scene.skins) {
        sdk_diag(rep, SDK_WARNING, "SDK_BAKE_SKIN_IGNORED", source, NULL, NULL,
                 "В модели %d скин(ов): пресет Prop берёт позу как есть и кости не переносит; для персонажей используйте --type character", scene.skins);
    }
    if (is_char) {
        tri_owner = (int *)calloc((size_t)(scene.ntri ? scene.ntri : 1), sizeof(int));
        if (!ch_assign(&scene, tri_owner, &rig, rep, source)) goto done;
    }

    if (opt->name && opt->name[0]) snprintf(name, sizeof name, "%s", opt->name);
    else {
        snprintf(name, sizeof name, "%s", sdk_basename(source));
        char *dot = strrchr(name, '.');
        if (dot) *dot = '\0';
    }

    // --- Оси Re2D и габарит ---------------------------------------------------------------------
    // glTF: X вправо, Y вверх, Z к зрителю. Re2D: X вправо, Y ВНИЗ, Z к зрителю.
    BkTri *tris = scene.tris;
    float mn[3] = { 1e30f, 1e30f, 1e30f }, mx[3] = { -1e30f, -1e30f, -1e30f };
    normals = (V3 *)calloc((size_t)scene.ntri, sizeof(V3));
    int degenerate = 0;
    for (int i = 0; i < scene.ntri; ++i) {
        BkTri *t = &tris[i];
        const V3 a = v3(t->p[0][0], t->p[0][1], t->p[0][2]), b = v3(t->p[1][0], t->p[1][1], t->p[1][2]), c = v3(t->p[2][0], t->p[2][1], t->p[2][2]);
        V3 n = cross(sub(b, a), sub(c, a));
        const float len = sqrtf(n.x * n.x + n.y * n.y + n.z * n.z);
        if (len < 1e-12f) { degenerate++; normals[i] = v3(0, 0, 0); }
        else normals[i] = v3(n.x / len, -n.y / len, n.z / len);       // нормаль — вектор: Y зеркалится вместе с осью
        for (int v = 0; v < 3; ++v) {
            t->p[v][1] = -t->p[v][1];
            for (int j = 0; j < 3; ++j) {
                if (t->p[v][j] < mn[j]) mn[j] = t->p[v][j];
                if (t->p[v][j] > mx[j]) mx[j] = t->p[v][j];
            }
        }
    }
    if (degenerate) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", degenerate);
        sdk_diag(rep, SDK_INFO, "SDK_BAKE_DEGENERATE", source, NULL, d, "%d вырожденных треугольников пропущены", degenerate);
    }
    const float ext[3] = { mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2] };
    if (ext[0] <= 0 && ext[1] <= 0 && ext[2] <= 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", source, NULL, NULL, "Габарит модели нулевой");
        goto done;
    }

    // Вписывание: допустимое «окно» зависит от начала координат (feet прижимает низ к Y=0).
    const float allow[3] = { LIM_XMAX - LIM_XMIN, opt->origin == BK_ORIGIN_FEET ? -LIM_YMIN : LIM_YMAX - LIM_YMIN, LIM_ZMAX - LIM_ZMIN };
    float scale = opt->scale;
    if (scale <= 0) {
        scale = 1e30f;
        for (int j = 0; j < 3; ++j) if (ext[j] > 1e-9f) scale = fminf(scale, allow[j] / ext[j]);
        scale *= opt->margin > 0 ? opt->margin : 0.98f;
    }
    float shift[3];
    shift[0] = -(mn[0] + mx[0]) / 2;
    shift[2] = -(mn[2] + mx[2]) / 2;
    shift[1] = opt->origin == BK_ORIGIN_FEET ? -mx[1] : -(mn[1] + mx[1]) / 2;     // Y вниз: низ — это max Y
    float lo[3] = { 1e30f, 1e30f, 1e30f }, hi[3] = { -1e30f, -1e30f, -1e30f };
    for (int i = 0; i < scene.ntri; ++i) {
        for (int v = 0; v < 3; ++v) {
            for (int j = 0; j < 3; ++j) {
                tris[i].p[v][j] = (tris[i].p[v][j] + shift[j]) * scale;
                if (tris[i].p[v][j] < lo[j]) lo[j] = tris[i].p[v][j];
                if (tris[i].p[v][j] > hi[j]) hi[j] = tris[i].p[v][j];
            }
        }
    }
    float pv[CH_BONES][3], hand_r[2][3], foot_r[2][3];
    if (is_char) {
        // Тот же перенос, что у вершин: Y вниз, затем сдвиг и масштаб.
        for (int b = 0; b < CH_BONES; ++b) {
            const float q[3] = { rig.pivot[b][0], -rig.pivot[b][1], rig.pivot[b][2] };
            for (int j = 0; j < 3; ++j) pv[b][j] = (q[j] + shift[j]) * scale;
        }
        for (int k = 0; k < 2; ++k) {
            const float h[3] = { rig.hand[k][0], -rig.hand[k][1], rig.hand[k][2] }, f[3] = { rig.foot[k][0], -rig.foot[k][1], rig.foot[k][2] };
            for (int j = 0; j < 3; ++j) { hand_r[k][j] = (h[j] + shift[j]) * scale; foot_r[k][j] = (f[j] + shift[j]) * scale; }
        }
    }
    res->scale = scale;
    memcpy(res->min, lo, sizeof lo);
    memcpy(res->max, hi, sizeof hi);
    {
        const float eps = 1e-3f;
        if (lo[0] < LIM_XMIN - eps || hi[0] > LIM_XMAX + eps || lo[1] < LIM_YMIN - eps || hi[1] > LIM_YMAX + eps ||
            lo[2] < LIM_ZMIN - eps || hi[2] > LIM_ZMAX + eps) {
            char d[320];
            snprintf(d, sizeof d, "{\"x\":[%g,%g],\"y\":[%g,%g],\"z\":[%g,%g],\"limits\":{\"x\":[%g,%g],\"y\":[%g,%g],\"z\":[%g,%g]},\"scale\":%g}",
                     lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], LIM_XMIN, LIM_XMAX, LIM_YMIN, LIM_YMAX, LIM_ZMIN, LIM_ZMAX, scale);
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FIT_OVERFLOW", source, NULL, d,
                     "Модель с масштабом %g выходит за диапазон Re2D: X[%g,%g] Y[%g,%g] Z[%g,%g] — уберите --scale (авто-вписывание) или уменьшите", scale,
                     lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]);
            goto done;
        }
    }

    // --- Части по материалам -------------------------------------------------------------------------
    bk.scene = &scene;
    bk.opt = opt;
    bk.rep = rep;
    bk.size = opt->size;
    bk.k = opt->size / 1024;
    bk.T = 4 * bk.k;
    bk.W = MAP_W * bk.T;
    bk.H = MAP_H * bk.T;
    bk.part_of_mat = (int *)malloc((size_t)scene.nmat * sizeof(int));
    bk.tri_part = (int *)malloc((size_t)(scene.ntri ? scene.ntri : 1) * sizeof(int));
    for (int i = 0; i < scene.nmat; ++i) bk.part_of_mat[i] = -1;
    bool used_bone[CH_BONES] = { false };
    if (is_char) {
        if (opt->first_id + CH_BONES - 1 > 254) {
            sdk_diag(rep, SDK_ERROR, "SDK_USAGE", source, NULL, NULL, "Для character --first-id не больше %d (10 частей)", 254 - CH_BONES + 1);
            goto done;
        }
        for (int i = 0; i < scene.ntri; ++i) {
            bk.tri_part[i] = tri_owner[i];
            if (!(normals[i].x == 0 && normals[i].y == 0 && normals[i].z == 0)) used_bone[tri_owner[i]] = true;
        }
        for (int b = 0; b < CH_BONES; ++b) if (used_bone[b]) bk.nparts++;
    }
    for (int i = 0; !is_char && i < scene.ntri; ++i) {
        if (normals[i].x == 0 && normals[i].y == 0 && normals[i].z == 0) continue;
        const int m = tris[i].material;
        if (bk.part_of_mat[m] >= 0) continue;
        if (bk.nparts >= 254 || opt->first_id + bk.nparts > 254) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_PARTS_LIMIT", source, NULL, NULL,
                     "Слишком много материалов: частей не больше %d (ID %d..254)", 254 - opt->first_id + 1, opt->first_id);
            goto done;
        }
        bk.part_of_mat[m] = bk.nparts;
        bk.part_mat[bk.nparts] = m;
        sanitize_group(scene.mats[m].name, bk.part_name[bk.nparts], sizeof bk.part_name[0]);
        bk.nparts++;
    }
    if (!is_char) for (int i = 0; i < scene.ntri; ++i) bk.tri_part[i] = bk.part_of_mat[tris[i].material];
    res->parts = bk.nparts;
    res->materials = scene.nmat - 1;
    // Текстура без UV на примитиве не может быть наложена: говорим об этом, а не молчим.
    {
        bool warned[4096] = { 0 };
        for (int i = 0; i < scene.ntri; ++i) {
            const int m = tris[i].material;
            if (m < 4096 && !warned[m] && scene.mats[m].tex >= 0 && !tris[i].has_uv && !(normals[i].x == 0 && normals[i].y == 0 && normals[i].z == 0)) {
                warned[m] = true;
                char loc[64];
                snprintf(loc, sizeof loc, "{\"material\":%d}", m);
                sdk_diag(rep, SDK_WARNING, "SDK_BAKE_TEXTURE_NO_UV", source, loc, NULL,
                         "Материал «%s»: есть текстура, но у примитива нет TEXCOORD_0 — берётся только baseColorFactor", scene.mats[m].name);
            }
        }
    }
    if (bk.nparts == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", source, NULL, NULL, "Нет невырожденных треугольников");
        goto done;
    }

    // --- Раскладка ---------------------------------------------------------------------------------------
    bk.skip = (bool *)calloc((size_t)scene.ntri, sizeof(bool));
    for (int i = 0; i < scene.ntri; ++i) bk.skip[i] = normals[i].x == 0 && normals[i].y == 0 && normals[i].z == 0;
    if (opt->uv == BK_UV_EXISTING) {
        for (int i = 0; i < scene.ntri; ++i) {
            if (bk.skip[i]) continue;
            if (!tris[i].has_uv) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_UV_MISSING", source, NULL, NULL,
                         "Режим existing требует TEXCOORD_0 у всех примитивов — используйте --uv auto");
                goto done;
            }
            for (int v = 0; v < 3; ++v) {
                if (tris[i].uv[v][0] < -1e-3f || tris[i].uv[v][0] > 1.001f || tris[i].uv[v][1] < -1e-3f || tris[i].uv[v][1] > 1.001f) {
                    sdk_diag(rep, SDK_ERROR, "SDK_BAKE_UV_RANGE", source, NULL, NULL,
                             "UV выходят за 0..1 (тайлинг): развёртка existing не поддерживает повтор — используйте --uv auto");
                    goto done;
                }
            }
        }
    } else {
        bk.tri_chart = (int *)malloc((size_t)scene.ntri * sizeof(int));
        for (int i = 0; i < 6; ++i) {
            bk.charts[i].weight = 1;
            bk.charts[i].axis = i / 2;
            bk.charts[i].sign = (i % 2) ? -1 : 1;
            chart_axes(bk.charts[i].axis, &bk.charts[i].ua, &bk.charts[i].va);
            bk.charts[i].umin = bk.charts[i].vmin = 1e30f;
            bk.charts[i].umax = bk.charts[i].vmax = -1e30f;
        }
        double total_area = 0;
        for (int i = 0; i < scene.ntri; ++i) {
            const V3 n = normals[i];
            if (bk.skip[i]) { bk.tri_chart[i] = -1; continue; }
            int axis = 0;
            float best = fabsf(n.x);
            if (fabsf(n.y) > best) { axis = 1; best = fabsf(n.y); }
            if (fabsf(n.z) > best) { axis = 2; best = fabsf(n.z); }
            const int sign = comp(n, axis) >= 0 ? 1 : -1;
            const int ci = axis * 2 + (sign > 0 ? 0 : 1);
            bk.tri_chart[i] = ci;
            Chart *c = &bk.charts[ci];
            c->used = true;
            c->tris++;
            for (int v = 0; v < 3; ++v) {
                const float u = comp(v3(tris[i].p[v][0], tris[i].p[v][1], tris[i].p[v][2]), c->ua);
                const float w = comp(v3(tris[i].p[v][0], tris[i].p[v][1], tris[i].p[v][2]), c->va);
                if (u < c->umin) c->umin = u;
                if (u > c->umax) c->umax = u;
                if (w < c->vmin) c->vmin = w;
                if (w > c->vmax) c->vmax = w;
            }
            // Площадь проекции для оценки шага.
            const float *p0 = tris[i].p[0], *p1 = tris[i].p[1], *p2 = tris[i].p[2];
            const float ax = p1[c->ua] - p0[c->ua], ay = p1[c->va] - p0[c->va], bx = p2[c->ua] - p0[c->ua], by = p2[c->va] - p0[c->va];
            const float area = fabsf(ax * by - ay * bx) * .5f;
            float importance = 1;
            if (is_char && !strcmp(rig.name[tri_owner[i]], "head")) importance = 2;
            const char *material = scene.mats[tris[i].material].name;
            if (strstr(material,"eye") || strstr(material,"face")) importance = 3;
            c->area += area; c->weighted_area += area * importance;
            total_area += area;
        }
        if (opt->uv == BK_UV_OPTIMIZED) {
            for (int i=0;i<6;i++) {
                Chart *c=&bk.charts[i];if(!c->used)continue;
                float box=(c->umax-c->umin)*(c->vmax-c->vmin);
                float fill=box>0?fminf(1,c->area/box):1;
                float importance=c->area>0?c->weighted_area/c->area:1;
                // Фронтальная/задняя проекции чаще показывают лицо и силуэт;
                // пустота в chart не должна получать тот же бюджет, что поверхность.
                float projection=c->axis==2?1.4f:1;
                c->weight=sqrtf(fmaxf(.25f,fill*importance*projection));
            }
            sdk_diag(rep, SDK_INFO, "SDK_BAKE_OPTIMIZED_BUDGET", source, NULL, NULL,
                     "Atlas budget учитывает площадь заполнения charts, части head/face/eyes и фронтальные проекции; это не идеальная развёртка");
        }
        // Плотность: самый маленький шаг, при котором все карты умещаются в 256×192 отсчётов.
        float lo_s = 1e-3f, hi_s = 200.0f;
        for (int it = 0; it < 48; ++it) {
            const float mid = sqrtf(lo_s * hi_s);
            if (pack_charts(bk.charts, 6, mid)) hi_s = mid; else lo_s = mid;
        }
        bk.spacing = hi_s;
        pack_charts(bk.charts, 6, bk.spacing);
        res->sample_spacing = bk.spacing;
        if (bk.spacing > 1.0f) {
            char d[96];
            snprintf(d, sizeof d, "{\"spacing\":%g,\"area\":%g}", bk.spacing, total_area);
            sdk_diag(rep, SDK_WARNING, "SDK_BAKE_LOW_DENSITY", source, NULL, d,
                     "Шаг отсчётов %.2f ед. модели больше единицы: поверхность разрежена, возможны просветы при повороте (упростите форму или уменьшите габарит)", bk.spacing);
        }
    }

    // --- Растеризация ---------------------------------------------------------------------------------------------
    bk.tri_at = (int *)malloc((size_t)bk.W * (size_t)bk.H * sizeof(int));
    bk.depth_at = (float *)malloc((size_t)bk.W * (size_t)bk.H * sizeof(float));
    if (!bk.tri_at || !bk.depth_at) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_MEMORY", source, NULL, NULL, "Не хватило памяти под растр %dx%d", bk.W, bk.H);
        goto done;
    }
    for (size_t i = 0; i < (size_t)bk.W * (size_t)bk.H; ++i) { bk.tri_at[i] = -1; bk.depth_at[i] = -1e30f; }
    rasterize(&bk);
    res->uv_overlap_texels = bk.uv_overlap;
    if (bk.uv_overlap > 0) {
        char d[64];
        snprintf(d, sizeof d, "{\"texels\":%d}", bk.uv_overlap);
        sdk_diag(rep, SDK_WARNING, "SDK_BAKE_UV_OVERLAP", source, NULL, d,
                 "Развёртка модели накладывается сама на себя (%d текселей): кадр содержит чужие части — используйте --uv auto", bk.uv_overlap);
    }

    // --- PNG v2 ---------------------------------------------------------------------------------------------------
    const int S = bk.size;
    png = (uint8_t *)calloc((size_t)S * (size_t)S, 4);
    if (!png) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_MEMORY", source, NULL, NULL, "Не хватило памяти под PNG %dx%d", S, S);
        goto done;
    }
    // Материал: цвет в каждом покрытом тексель, alpha бинарная.
    for (int ty = 0; ty < bk.H; ++ty) {
        for (int tx = 0; tx < bk.W; ++tx) {
            uint8_t c[4];
            if (shade_texel(&bk, tx, ty, NULL, c)) put_px(png, S, tx, ty, c[0], c[1], c[2], 255);
        }
    }
    // Отсчёты.
    const int k = bk.k, T = bk.T;
    int active = 0;
    for (int my = 0; my < MAP_H; ++my) {
        for (int mx = 0; mx < MAP_W; ++mx) {
            float best = 1e30f;
            int bx = -1, by = -1;
            const float cx = (mx + 0.5f) * T, cy = (my + 0.5f) * T;
            for (int y = my * T; y < (my + 1) * T; ++y) {
                for (int x = mx * T; x < (mx + 1) * T; ++x) {
                    if (png[((size_t)y * (size_t)S + (size_t)x) * 4 + 3] != 255) continue;      // тексель не покрыт
                    const float d = (x + 0.5f - cx) * (x + 0.5f - cx) + (y + 0.5f - cy) * (y + 0.5f - cy);
                    if (d < best) { best = d; bx = x; by = y; }
                }
            }
            if (bx < 0) continue;
            V3 pos;
            uint8_t c[4];
            shade_texel(&bk, bx, by, &pos, c);
            const int ti = bk.tri_at[(size_t)by * (size_t)bk.W + (size_t)bx];
            const int part = bk.tri_part[ti];
            const float qx = qenc(pos.x, 4), qy = qenc(pos.y, 2), qz = qenc(pos.z, 4);
            const int cx0 = (int)qx / 16, fx = (int)qx % 16, cy0 = (int)qy / 16, fy = (int)qy % 16, cz0 = (int)qz / 16, fz = (int)qz % 16;
            put_block(png, S, k, 0 + mx, 768 + my, (uint8_t)(opt->first_id + part), (uint8_t)(part + 1), 0, 255);          // ID, группа
            put_block(png, S, k, 256 + mx, 768 + my, (uint8_t)cz0, (uint8_t)(fz * 17), 0, 255);                           // глубина Z
            put_block(png, S, k, 512 + mx, 768 + my, 255, 255, 255, 255);                                                 // покрытие
            put_block(png, S, k, 768 + mx, 768 + my, (uint8_t)cx0, (uint8_t)cy0, (uint8_t)((fx << 4) | fy), 255);          // XY
            active++;
        }
    }
    res->samples_active = active;
    res->atlas_usage = (double)active / (double)(MAP_W * MAP_H);
    if (active == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_EMPTY", source, NULL, NULL, "После растеризации не осталось ни одного отсчёта поверхности");
        goto done;
    }
    // Заголовок v2 (R2D / ROT / v2) и маркер SUB.
    put_block(png, S, k, 0, 960, 82, 50, 68, 255);
    put_block(png, S, k, 1, 960, 82, 79, 84, 255);
    put_block(png, S, k, 2, 960, 2, 4, 4, 255);
    put_block(png, S, k, 3, 960, 83, 85, 66, 255);

    // --- Файлы -------------------------------------------------------------------------------------------------------------
    if (!sdk_is_dir(out_dir)) SDL_CreateDirectory(out_dir);
    snprintf(res->png_path, sizeof res->png_path, "%s/%s.png", out_dir, name);
    snprintf(res->json_path, sizeof res->json_path, "%s/%s.character.json", out_dir, name);
    snprintf(res->anim_path, sizeof res->anim_path, "%s/%s.animations.json", out_dir, name);
    snprintf(res->report_path, sizeof res->report_path, "%s/%s.bake.json", out_dir, name);
    if (!sdk_image_write_png(res->png_path, png, S, S)) {
        sdk_diag(rep, SDK_ERROR, "SDK_WRITE_FAILED", res->png_path, NULL, NULL, "Не удалось записать %s", res->png_path);
        goto done;
    }
    {
        R2dSb js;
        r2d_sb_init(&js);
        char base_png[160];
        snprintf(base_png, sizeof base_png, "%s.png", name);
        if (is_char) {
            char anim_base[160];
            snprintf(anim_base, sizeof anim_base, "%s.animations.json", name);
            ch_json(&js, &rig, pv, hand_r, foot_r, used_bone, opt->first_id, base_png, opt->style ? opt->style : "anime", anim_base);
            R2dSb ra;
            r2d_sb_init(&ra);
            ch_anim_json(&ra, &rig);
            const bool wa = write_pretty(res->anim_path, ra.data);
            r2d_sb_free(&ra);
            if (!wa) {
                sdk_diag(rep, SDK_ERROR, "SDK_WRITE_FAILED", res->anim_path, NULL, NULL, "Не удалось записать %s", res->anim_path);
                r2d_sb_free(&js);
                goto done;
            }
            R2dSb rc;
            r2d_sb_init(&rc);
            ch_report_json(&rc, &rig, &scene);
            res->extra_json = r2d_sb_take(&rc);
            if (!write_pretty(res->json_path, js.data)) {
                sdk_diag(rep, SDK_ERROR, "SDK_WRITE_FAILED", res->json_path, NULL, NULL, "Не удалось записать %s", res->json_path);
                r2d_sb_free(&js);
                goto done;
            }
            r2d_sb_free(&js);
            goto files_done;
        }
        r2d_sb_printf(&js, "{\"version\":1,\"atlas\":");
        r2d_sb_put_json_string(&js, base_png);
        r2d_sb_printf(&js, ",\"style\":\"%s\",\"rig\":{\"bones\":[{\"name\":\"object\",\"pivot\":[0,0,0]}],\"parts\":[", opt->style ? opt->style : "anime");
        for (int i = 0; i < bk.nparts; ++i) r2d_sb_printf(&js, "%s{\"id\":%d,\"bone\":\"object\"}", i ? "," : "", opt->first_id + i);
        r2d_sb_puts(&js, "],\"joints\":[{\"name\":\"origin\",\"bone\":\"object\",\"point\":[0,0,0]}]");
        if (!strcmp(opt->type, "weapon")) r2d_sb_puts(&js, ",\"sockets\":[{\"name\":\"grip\",\"bone\":\"object\",\"point\":[0,0,0]}]");
        r2d_sb_puts(&js, "},\"groups\":{");
        for (int i = 0; i < bk.nparts; ++i) {
            // Имена групп уникальны: повтор получает суффикс.
            char gname[96];
            snprintf(gname, sizeof gname, "%s", bk.part_name[i]);
            for (int j = 0; j < i; ++j) if (!strcmp(bk.part_name[j], bk.part_name[i])) { snprintf(gname, sizeof gname, "%s_%d", bk.part_name[i], i); break; }
            r2d_sb_printf(&js, "%s", i ? "," : "");
            r2d_sb_put_json_string(&js, gname);
            r2d_sb_printf(&js, ":[%d]", opt->first_id + i);
        }
        char anim_name[160];
        snprintf(anim_name, sizeof anim_name, "%s.animations.json", name);
        r2d_sb_puts(&js, "},\"defaults\":{\"body\":true,\"motion\":\"spin\"},\"animations\":");
        r2d_sb_put_json_string(&js, anim_name);
        r2d_sb_putc(&js, '}');
        if (!write_pretty(res->json_path, js.data)) {
            sdk_diag(rep, SDK_ERROR, "SDK_WRITE_FAILED", res->json_path, NULL, NULL, "Не удалось записать %s", res->json_path);
            r2d_sb_free(&js);
            goto done;
        }
        r2d_sb_free(&js);
        if (!write_pretty(res->anim_path,
            "{\"version\":1,\"clips\":{\"spin\":{\"duration\":4,\"loop\":true,\"tracks\":[{\"target\":\"object\",\"channel\":\"rotation.y\",\"keys\":[[0,0],[4,360]]}]}}}")) {
            sdk_diag(rep, SDK_ERROR, "SDK_WRITE_FAILED", res->anim_path, NULL, NULL, "Не удалось записать %s", res->anim_path);
            goto done;
        }
    }
files_done:
    if (opt->compare) {
        snprintf(res->comparison_dir, sizeof res->comparison_dir, "%s/%s.source-preview", out_dir, name);
        if (!write_source_previews(&scene, res->comparison_dir, rep)) goto done;
    }
    ok = rep->errors == 0;
    res->ok = ok;
    if (is_char && ok) {
        const int pct = rig.total ? (int)(100.0 * rig.ambiguous / rig.total + 0.5) : 0;
        char d[160];
        snprintf(d, sizeof d, "{\"ambiguous\":%d,\"total\":%d,\"percent\":%d}", rig.ambiguous, rig.total, pct);
        sdk_diag(rep, pct > 5 ? SDK_WARNING : SDK_INFO, "SDK_BAKE_SKIN_AMBIGUOUS", source, NULL, d,
                 "Владение частями: %d из %d треугольников (%d%%) делят влияние нескольких костей; часть достаётся доминирующей. Границы суставов могут выглядеть резче, чем в источнике", rig.ambiguous, rig.total, pct);
        if (rig.unmapped_joints) {
            snprintf(d, sizeof d, "{\"joints\":%d}", rig.unmapped_joints);
            sdk_diag(rep, SDK_INFO, "SDK_BAKE_JOINT_UNMAPPED", source, NULL, d, "%d суставов скина без humanoid-предка отнесены к root", rig.unmapped_joints);
        }
        if (scene.vrm.nexpr && !opt->expression) {
            sdk_diag(rep, SDK_INFO, "SDK_BAKE_EXPRESSIONS_NOT_BAKED", source, NULL, NULL,
                     "Выражения VRM (%d) — blendshape: выберите --expression <имя>, чтобы запечь морфы и материалы в отдельный ассет / донор варианта; сопоставление имён — в отчёте", scene.vrm.nexpr);
        }
    }

done:
    free(tri_owner);
    free(bk.tri_part);
    free(png);
    free(bk.skip);
    free(normals);
    free(bk.tri_chart);
    free(bk.tri_at);
    free(bk.depth_at);
    free(bk.part_of_mat);
    // Отчёт собирается всегда (по нему видно, почему bake не удался); на диск — только при успехе.
    {
        R2dSb rj;
        r2d_sb_init(&rj);
        bk_report_json(res, opt, &scene, rep, &rj);
        if (ok && res->report_path[0] && !sdk_write_file(res->report_path, rj.data, rj.len)) {
            sdk_diag(rep, SDK_ERROR, "SDK_WRITE_FAILED", res->report_path, NULL, NULL, "Не удалось записать отчёт bake");
            ok = false; res->ok = false;
            r2d_sb_clear(&rj); bk_report_json(res, opt, &scene, rep, &rj);
        }
        res->report_json = r2d_sb_take(&rj);
    }
    bk_free(&scene);
    return ok;
}

void bk_result_free(BkResult *res)
{
    free(res->extra_json);
    res->extra_json = NULL;
    free(res->report_json);
    res->report_json = NULL;
}

// ---------------------------------------------------------------------------
// Отчёт и CLI
// ---------------------------------------------------------------------------
void bk_report_json(const BkResult *res, const BkOptions *opt, const BkScene *scene, const SdkReport *rep, R2dSb *out)
{
    r2d_sb_printf(out, "{\"success\":%s,\"ok\":%s,\"type\":", res->ok ? "true" : "false", res->ok ? "true" : "false");
    r2d_sb_put_json_string(out, opt->type);
    r2d_sb_printf(out, ",\"source\":{\"kind\":\"%s\",\"triangles\":%d,\"materials\":%d,\"textures\":%d,\"skins\":%d,\"animations\":%d},",
                  scene->source_kind, res->triangles, res->materials, res->textures, scene->skins, scene->animations);
    r2d_sb_printf(out, "\"parts\":%d,\"atlasUsage\":%.4f,\"samples\":%d,\"uvMode\":\"%s\",\"size\":%d,\"sampleSpacing\":%.4f,\"uvOverlapTexels\":%d,",
                  res->parts, res->atlas_usage, res->samples_active, opt->uv == BK_UV_EXISTING ? "existing" : opt->uv == BK_UV_OPTIMIZED ? "optimized" : "auto", opt->size,
                  res->sample_spacing, res->uv_overlap_texels);
    r2d_sb_printf(out, "\"fit\":{\"scale\":%.6g,\"origin\":\"%s\",\"x\":[%.4f,%.4f],\"y\":[%.4f,%.4f],\"z\":[%.4f,%.4f],\"limits\":{\"x\":[%g,%g],\"y\":[%g,%g],\"z\":[%g,%g]}},",
                  res->scale, opt->origin == BK_ORIGIN_FEET ? "feet" : "center", res->min[0], res->max[0], res->min[1], res->max[1], res->min[2], res->max[2],
                  LIM_XMIN, LIM_XMAX, LIM_YMIN, LIM_YMAX, LIM_ZMIN, LIM_ZMAX);
    r2d_sb_puts(out, "\"comparison\":");
    if (res->comparison_dir[0]) {
        r2d_sb_puts(out, "{\"sourceOnly\":true,\"size\":512,\"yaw\":[0,45,90,135,180],\"pitch\":[-45,-20,0,20,45],\"directory\":");
        r2d_sb_put_json_string(out, res->comparison_dir); r2d_sb_puts(out, "},");
    } else r2d_sb_puts(out, "null,");
    r2d_sb_puts(out, "\"files\":{\"png\":");
    if (res->png_path[0]) r2d_sb_put_json_string(out, res->png_path); else r2d_sb_puts(out, "null");
    r2d_sb_puts(out, ",\"character\":");
    if (res->json_path[0]) r2d_sb_put_json_string(out, res->json_path); else r2d_sb_puts(out, "null");
    r2d_sb_puts(out, ",\"animations\":");
    if (res->anim_path[0]) r2d_sb_put_json_string(out, res->anim_path); else r2d_sb_puts(out, "null");
    r2d_sb_puts(out, "},");
    if (res->extra_json) {
        r2d_sb_puts(out, "\"character\":");
        r2d_sb_puts(out, res->extra_json);
        r2d_sb_puts(out, ",");
    }
    sdk_report_put_counts(rep, out);
    r2d_sb_puts(out, ",");
    sdk_report_put(rep, out);
    r2d_sb_puts(out, "}\n");
}

int sdk_cmd_bake_re2d(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *source = sdk_arg_positional(a, 0);
    if (!source) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk bake-re2d <модель.glb|.gltf|.vrm|.obj> --type prop|character|weapon|environment --output <каталог> "
            "[--name имя] [--uv auto|existing|optimized] [--compare] [--origin center|feet] [--size 1024|2048|4096] [--scale S] [--style anime|pixel] [--first-id N]");
        sdk_report_free(&rep);
        return rc;
    }
    BkOptions opt;
    bk_default_options(&opt);
    const char *v;
    opt.compare = sdk_arg_flag(a, "--compare");
    if ((v = sdk_arg_value(a, "--expression"))) opt.expression = v;
    if ((v = sdk_arg_value(a, "--type"))) opt.type = v;
    if (!strcmp(opt.type, "environment") && !sdk_arg_value(a, "--origin")) opt.origin = BK_ORIGIN_FEET;
    if ((v = sdk_arg_value(a, "--name"))) opt.name = v;
    if ((v = sdk_arg_value(a, "--style"))) opt.style = v;
    if ((v = sdk_arg_value(a, "--uv"))) {
        if (!strcmp(v, "existing")) opt.uv = BK_UV_EXISTING;
        else if (!strcmp(v, "auto")) opt.uv = BK_UV_AUTO;
        else if (!strcmp(v, "optimized")) opt.uv = BK_UV_OPTIMIZED;
        else {
            const int rc = sdk_fail(&rep, "SDK_BAKE_UV_MODE_UNSUPPORTED",
                "Неверный режим UV «%s»: доступны auto, existing и optimized", v);
            sdk_report_free(&rep);
            return rc;
        }
    }
    for (int i=0; i<3; ++i) {
        const char *flag = i==0 ? "--size" : i==1 ? "--scale" : "--first-id";
        const char *raw=sdk_arg_value(a,flag); if(!raw)continue;
        char *end; double number=strtod(raw,&end);
        if(!raw[0] || *end || !isfinite(number) || (i!=1 && floor(number)!=number) ||
           (i==0 && number!=1024 && number!=2048 && number!=4096) ||
           (i==1 && (number<0 || number>1e6)) || (i==2 && (number<1 || number>254))) {
            int rc=sdk_fail(&rep,"SDK_BAKE_OPTIONS","%s: недопустимое числовое значение",flag);sdk_report_free(&rep);return rc;
        }
    }
    v=sdk_arg_value(a,"--origin");
    if(v && strcmp(v,"feet") && strcmp(v,"center")) {int rc=sdk_fail(&rep,"SDK_BAKE_OPTIONS","--origin: center или feet");sdk_report_free(&rep);return rc;}
    if ((v = sdk_arg_value(a, "--origin"))) opt.origin = !strcmp(v, "feet") ? BK_ORIGIN_FEET : BK_ORIGIN_CENTER;
    if ((v = sdk_arg_value(a, "--size"))) opt.size = atoi(v);
    if ((v = sdk_arg_value(a, "--scale"))) opt.scale = (float)atof(v);
    if ((v = sdk_arg_value(a, "--first-id"))) opt.first_id = atoi(v);
    if (opt.first_id < 1 || opt.first_id > 254) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "--first-id должен быть 1..254");
        sdk_report_free(&rep);
        return rc;
    }
    const char *out_dir = sdk_arg_value(a, "--output");
    if (!out_dir) out_dir = sdk_arg_value(a, "--out");
    char dir_buf[1024];
    if (!out_dir) {
        sdk_dirname(source, dir_buf, sizeof dir_buf);
        out_dir = dir_buf;
    }
    BkResult res;
    const bool ok = bk_bake(source, out_dir, &opt, &res, &rep);

    // Ответ — тот же отчёт, что лежит рядом с ассетом (на успехе).
    if (res.report_json) {
        size_t n = strlen(res.report_json);
        while (n && (res.report_json[n - 1] == '\n' || res.report_json[n - 1] == '\r')) res.report_json[--n] = '\0';
        puts(res.report_json);
        fflush(stdout);
    }
    bk_result_free(&res);
    sdk_report_free(&rep);
    return ok ? 0 : 1;
}
