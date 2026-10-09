// ===========================================================================
// Re2D Baker: импорт Wavefront OBJ (+ MTL) — временный источник данных
// (docs/SDK.md §7). Как и GLB/glTF, OBJ живёт только на этапе импорта: из него
// берутся треугольники, UV и материалы, а результат — обычный PNG v2 +
// `*.character.json`.
//
// Поддержано: v, vt, f (v, v/vt, v//vn, v/vt/vn; отрицательные индексы; полигоны
// разворачиваются веером), usemtl, mtllib, MTL: newmtl, Kd, d / Tr, map_Kd
// (PNG/JPEG/BMP рядом с моделью). Не поддержано и сообщается: линии и точки (`l`, `p`),
// сглаживание и нормали (`vn`, `s` игнорируются — Baker считает нормали сам), остальные
// карты MTL (bump, Ks, …). Оси те же, что у glTF (правосторонние, Y вверх); V
// текстурной координаты OBJ идёт снизу вверх, поэтому переворачивается (1 − v).
// ===========================================================================
#include "sdk_bake.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define OBJ_MAX_VERTS 20000000
#define OBJ_MAX_TRIS  8000000

typedef struct ObjCtx {
    BkScene   *s;
    SdkReport *rep;
    const char *path;
    char       dir[1024];
    float     *pos;        // x, y, z
    int        npos, cpos;
    float     *uv;         // u, v
    int        nuv, cuv;
    char     (*mat_name)[80];
    int        nmat_names;
    int        cur_mat;
    int        groups;
    int        lines_skipped;
    bool       failed;
} ObjCtx;

static bool push_f(float **a, int *n, int *cap, int stride, const float *v)
{
    if (*n == *cap) {
        const int c = *cap ? *cap * 2 : 1024;
        float *g = (float *)realloc(*a, (size_t)c * (size_t)stride * sizeof(float));
        if (!g) return false;
        *a = g;
        *cap = c;
    }
    memcpy(*a + (size_t)(*n) * (size_t)stride, v, (size_t)stride * sizeof(float));
    (*n)++;
    return true;
}

static char *trim(char *s)
{
    while (*s == ' ' || *s == '\t' || *s == '\r') ++s;
    char *e = s + strlen(s);
    while (e > s && (e[-1] == ' ' || e[-1] == '\t' || e[-1] == '\r')) *--e = '\0';
    return s;
}

static bool lower_eq(const char *a, const char *b)
{
    for (; *a && *b; ++a, ++b) {
        char x = *a, y = *b;
        if (x >= 'A' && x <= 'Z') x = (char)(x - 'A' + 'a');
        if (y >= 'A' && y <= 'Z') y = (char)(y - 'A' + 'a');
        if (x != y) return false;
    }
    return *a == *b;
}

static int add_material(ObjCtx *c, const char *name)
{
    BkScene *s = c->s;
    BkMaterial *g = (BkMaterial *)realloc(s->mats, (size_t)(s->nmat + 1) * sizeof(BkMaterial));
    char (*names)[80] = (char (*)[80])realloc(c->mat_name, (size_t)(s->nmat + 1) * sizeof *names);
    if (!g || !names) { c->failed = true; return -1; }
    s->mats = g;
    c->mat_name = names;
    BkMaterial *m = &s->mats[s->nmat];
    memset(m, 0, sizeof *m);
    snprintf(m->name, sizeof m->name, "%s", name);
    snprintf(c->mat_name[s->nmat], 80, "%s", name);
    m->base[0] = m->base[1] = m->base[2] = 0.8f;
    m->base[3] = 1.0f;
    m->tex = -1;
    m->alpha = BK_ALPHA_OPAQUE;
    m->cutoff = 0.5f;
    m->uv_scale[0] = m->uv_scale[1] = 1.0f;
    return s->nmat++;
}

static int find_material(const ObjCtx *c, const char *name)
{
    for (int i = 0; i < c->s->nmat; ++i) if (strcmp(c->mat_name[i], name) == 0) return i;
    return -1;
}

static int load_texture(ObjCtx *c, const char *file, const char *mtl_path)
{
    char full[2048];
    if (file[0] == '/' || (file[0] && file[1] == ':')) snprintf(full, sizeof full, "%s", file);
    else {
        char dir[1024];
        sdk_dirname(mtl_path, dir, sizeof dir);
        sdk_join(dir, file, full, sizeof full);
    }
    BkScene *s = c->s;
    int w = 0, h = 0;
    uint8_t *px = sdk_image_load_rgba(full, &w, &h);
    if (!px) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_BAKE_TEXTURE_MISSING", mtl_path, NULL, NULL, "Текстура «%s» не найдена рядом с моделью или не читается (нужны PNG/JPEG/BMP)", file);
        return -1;
    }
    BkTexture *t = (BkTexture *)realloc(s->texs, (size_t)(s->ntex + 1) * sizeof(BkTexture));
    if (!t) { sdk_image_free(px); c->failed = true; return -1; }
    s->texs = t;
    s->texs[s->ntex].px = px;
    s->texs[s->ntex].w = w;
    s->texs[s->ntex].h = h;
    return s->ntex++;
}

static void load_mtl(ObjCtx *c, const char *name)
{
    char path[2048];
    sdk_join(c->dir, name, path, sizeof path);
    size_t size = 0;
    char *text = sdk_read_file(path, &size);
    if (!text) {
        sdk_diag(c->rep, SDK_WARNING, "SDK_BAKE_MTL_MISSING", path, NULL, NULL, "Файл материалов «%s» не найден: материалы получат цвет по умолчанию", name);
        return;
    }
    int cur = -1;
    char *save = NULL;
    for (char *line = strtok_r(text, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
        char *l = trim(line);
        if (!*l || *l == '#') continue;
        char *sp = l;
        while (*sp && *sp != ' ' && *sp != '\t') ++sp;
        char *arg = sp;
        if (*sp) { *sp = '\0'; arg = trim(sp + 1); }
        if (lower_eq(l, "newmtl")) {
            cur = find_material(c, arg);
            if (cur < 0) cur = add_material(c, arg);
        } else if (cur >= 0 && lower_eq(l, "kd")) {
            float r, g, b;
            if (sscanf(arg, "%f %f %f", &r, &g, &b) == 3 && isfinite(r) && isfinite(g) && isfinite(b)) {
                c->s->mats[cur].base[0] = r < 0 ? 0 : r > 1 ? 1 : r;
                c->s->mats[cur].base[1] = g < 0 ? 0 : g > 1 ? 1 : g;
                c->s->mats[cur].base[2] = b < 0 ? 0 : b > 1 ? 1 : b;
            }
        } else if (cur >= 0 && (lower_eq(l, "d") || lower_eq(l, "tr"))) {
            float d;
            if (sscanf(arg, "%f", &d) == 1 && isfinite(d)) {
                if (lower_eq(l, "tr")) d = 1.0f - d;
                c->s->mats[cur].base[3] = d < 0 ? 0 : d > 1 ? 1 : d;
                if (d < 0.999f) c->s->mats[cur].alpha = BK_ALPHA_BLEND;
            }
        } else if (cur >= 0 && lower_eq(l, "map_kd")) {
            // последняя «лексема» — имя файла (перед ним могут стоять опции -s, -o …)
            char *file = arg;
            for (char *p = arg; *p; ++p) if ((*p == ' ' || *p == '\t') && p[1] && p[1] != '-' && p[1] != ' ') file = p + 1;
            file = trim(file);
            if (*file) c->s->mats[cur].tex = load_texture(c, file, path);
        }
    }
    free(text);
}

// Индекс вершины из «v», «v/vt», «v//vn», «v/vt/vn»; отрицательные — от конца.
static bool parse_vert(const char *tok, int npos, int nuv, int *vi, int *ti)
{
    char *end = NULL;
    long v = strtol(tok, &end, 10);
    if (end == tok) return false;
    *ti = -1;
    if (*end == '/') {
        const char *p = end + 1;
        if (*p != '/') {
            long t = strtol(p, &end, 10);
            if (end == p) return false;
            if (t < 0) t = nuv + t + 1;
            if (t < 1 || t > nuv) return false;
            *ti = (int)t - 1;
        }
    }
    if (v < 0) v = npos + v + 1;
    if (v < 1 || v > npos) return false;
    *vi = (int)v - 1;
    return true;
}

static bool add_tri(ObjCtx *c, const int vi[3], const int ti[3])
{
    BkScene *s = c->s;
    if (s->ntri >= OBJ_MAX_TRIS) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_BAKE_MEMORY", c->path, NULL, NULL, "В OBJ больше %d треугольников", OBJ_MAX_TRIS);
        c->failed = true;
        return false;
    }
    if (s->ntri == s->cap) {
        const int cap = s->cap ? s->cap * 2 : 1024;
        BkTri *g = (BkTri *)realloc(s->tris, (size_t)cap * sizeof(BkTri));
        if (!g) { c->failed = true; return false; }
        s->tris = g;
        s->cap = cap;
    }
    BkTri *t = &s->tris[s->ntri++];
    memset(t, 0, sizeof *t);
    t->skin = -1;
    t->node = -1;
    const bool has_uv = ti[0] >= 0 && ti[1] >= 0 && ti[2] >= 0;
    for (int k = 0; k < 3; ++k) {
        memcpy(t->p[k], c->pos + (size_t)vi[k] * 3, 3 * sizeof(float));
        if (has_uv) {
            t->uv[k][0] = c->uv[(size_t)ti[k] * 2];
            t->uv[k][1] = 1.0f - c->uv[(size_t)ti[k] * 2 + 1];   // V OBJ идёт снизу вверх
        }
    }
    t->has_uv = has_uv;
    t->material = c->cur_mat;   // -1 — без usemtl: ниже получит материал по умолчанию
    return true;
}

bool bk_load_obj(const char *path, BkScene *scene, SdkReport *rep)
{
    memset(scene, 0, sizeof *scene);
    snprintf(scene->source_kind, sizeof scene->source_kind, "obj");
    size_t size = 0;
    char *text = sdk_read_file(path, &size);
    if (!text) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_INPUT_MISSING", path, NULL, NULL, "Исходный файл не найден или не читается: %s", path);
        return false;
    }
    ObjCtx c;
    memset(&c, 0, sizeof c);
    c.s = scene;
    c.rep = rep;
    c.path = path;
    c.cur_mat = -1;
    sdk_dirname(path, c.dir, sizeof c.dir);

    int line_no = 0;
    for (char *next = text; *next && !c.failed; ) {
        // Свой разбор строк (а не strtok): пустые строки считаются, номера в диагностике верны.
        char *line = next;
        char *nl = strchr(next, '\n');
        if (nl) { *nl = '\0'; next = nl + 1; } else next += strlen(next);
        ++line_no;
        char *l = trim(line);
        if (!*l || *l == '#') continue;
        char loc[48];
        snprintf(loc, sizeof loc, "{\"line\":%d}", line_no);
        if (l[0] == 'v' && (l[1] == ' ' || l[1] == '\t')) {
            float v[3];
            if (sscanf(l + 1, "%f %f %f", &v[0], &v[1], &v[2]) != 3 || !isfinite(v[0]) || !isfinite(v[1]) || !isfinite(v[2])) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_OBJ_SYNTAX", path, loc, NULL, "Строка %d: вершина «v» требует три конечных числа", line_no);
                c.failed = true;
                break;
            }
            if (c.npos >= OBJ_MAX_VERTS || !push_f(&c.pos, &c.npos, &c.cpos, 3, v)) { c.failed = true; break; }
        } else if (l[0] == 'v' && l[1] == 't' && (l[2] == ' ' || l[2] == '\t')) {
            float v[2] = { 0, 0 };
            if (sscanf(l + 2, "%f %f", &v[0], &v[1]) < 1 || !isfinite(v[0]) || !isfinite(v[1])) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_OBJ_SYNTAX", path, loc, NULL, "Строка %d: «vt» требует число u [v]", line_no);
                c.failed = true;
                break;
            }
            if (c.nuv >= OBJ_MAX_VERTS || !push_f(&c.uv, &c.nuv, &c.cuv, 2, v)) { c.failed = true; break; }
        } else if (l[0] == 'f' && (l[1] == ' ' || l[1] == '\t')) {
            int vi[64], ti[64], n = 0;
            char *tsave = NULL;
            char buf[1024];
            snprintf(buf, sizeof buf, "%s", l + 1);
            for (char *tok = strtok_r(buf, " \t", &tsave); tok && n < 64; tok = strtok_r(NULL, " \t", &tsave)) {
                if (!parse_vert(tok, c.npos, c.nuv, &vi[n], &ti[n])) {
                    sdk_diag(rep, SDK_ERROR, "SDK_BAKE_INDEX_RANGE", path, loc, NULL, "Строка %d: индекс «%s» вне вершин (v: %d, vt: %d)", line_no, tok, c.npos, c.nuv);
                    c.failed = true;
                    break;
                }
                ++n;
            }
            if (c.failed) break;
            if (n < 3) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_OBJ_SYNTAX", path, loc, NULL, "Строка %d: грань из %d вершин", line_no, n);
                c.failed = true;
                break;
            }
            for (int k = 1; k + 1 < n && !c.failed; ++k) {
                const int a[3] = { vi[0], vi[k], vi[k + 1] }, b[3] = { ti[0], ti[k], ti[k + 1] };
                add_tri(&c, a, b);
            }
        } else if (strncmp(l, "mtllib", 6) == 0 && (l[6] == ' ' || l[6] == '\t')) {
            load_mtl(&c, trim(l + 7));
        } else if (strncmp(l, "usemtl", 6) == 0 && (l[6] == ' ' || l[6] == '\t')) {
            const char *name = trim(l + 7);
            c.cur_mat = find_material(&c, name);
            if (c.cur_mat < 0) {
                sdk_diag(rep, SDK_WARNING, "SDK_BAKE_MATERIAL_MISSING", path, loc, NULL, "Материал «%s» не описан в MTL: цвет по умолчанию", name);
                c.cur_mat = add_material(&c, name);
            }
        } else if ((l[0] == 'o' || l[0] == 'g') && (l[1] == ' ' || l[1] == '\t')) {
            c.groups++;
        } else if ((l[0] == 'l' || l[0] == 'p') && (l[1] == ' ' || l[1] == '\t')) {
            c.lines_skipped++;
        }
    }

    bool ok = !c.failed;
    if (ok && scene->ntri == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", path, NULL, NULL, "В OBJ нет ни одной грани (f)");
        ok = false;
    }
    if (ok && c.lines_skipped) {
        scene->primitives_skipped += c.lines_skipped;
        sdk_diag(rep, SDK_WARNING, "SDK_BAKE_MODE_UNSUPPORTED", path, NULL, NULL, "Линии и точки (l, p) пропущены: %d", c.lines_skipped);
    }
    if (ok) {
        // Как у glTF-загрузчика: материал по умолчанию — последний (nmat − 1); пользовательские — 0..nmat − 2.
        const int def = add_material(&c, "default");
        if (def < 0) ok = false;
        else for (int i = 0; i < scene->ntri; ++i) if (scene->tris[i].material < 0) scene->tris[i].material = def;
    }
    scene->meshes = c.groups > 0 ? c.groups : 1;
    free(c.pos);
    free(c.uv);
    free(c.mat_name);
    free(text);
    return ok;
}
