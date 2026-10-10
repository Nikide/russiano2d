// ===========================================================================
// Re2D Baker v3: модель (FBX/OBJ/GLB) → плотная «геометрическая картинка» Re2DSprite v3.
//
// Закон Baker'а (docs/SDK.md §7): 3D живёт только на этапе импорта. Результат — один PNG
// (6 слоёв сетки W×H, без меша) + `*.character.json` (+ клипы скелета). Каждый тексель
// сетки хранит: цвет, позицию (16 бит на ось), нормаль, до 4 костей с весами и блеск.
// Рантайм (src/rotsprite3.c) строит из соседних текселей поверхность и рисует её в
// обычный 2D-спрайт. Формат описан в docs/RE2DSPRITE_V3.md.
// ===========================================================================
#include "sdk_bake.h"
#include "ufbx.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define B3_LAYERS 6
#define B3_COLS 3
#define B3_MAX_BONES 126
#define B3_MARGIN 2.5f

typedef struct B3Tri {
    float p[3][3], uv[3][2], n[3][3], t[3][3], b[3][3];
    bool has_n, has_t, has_uv;
    uint8_t bone[3][4];
    float w[3][4];
    int mat;
    float puv[3][2];                // упакованные координаты в сетке (после раскладки островов)
    bool packed;
} B3Tri;

typedef struct B3Bone {
    char name[64];
    double bind_to_world[16];       // 4×4 строками
    int node;
    bool used;
} B3Bone;

typedef struct B3Mat {
    char name[80];
    float base[4];
    int tex, ntex, ao;               // индексы в scene.texs или -1
    float spec;
} B3Mat;

typedef struct B3Scene {
    B3Tri *tris;
    int ntri, cap;
    B3Mat *mats;
    int nmat;
    BkTexture *texs;
    int ntex;
    B3Bone *bones;
    int nbones;
    float bmin[3], bmax[3];
} B3Scene;

typedef struct B3Options {
    const char *name, *tint, *ao, *spec, *clips, *tiles;
    int grid, extent;
    float scale, fit;               // scale — единиц на метр; 0 = подобрать по fit (доля extent)
    bool has_pivot;
    float pivot[3];
    bool has_eye;
    float eye[3];                   // положение камеры в исходных координатах (метры): viewmodel с перспективой
    float zoom;                     // projection.bodyScale: увеличение проекции (1 — весь extent в спрайте)
    int raster;                     // projection.raster: размер синтеза, 0 — по умолчанию рантайма
    int motion_lod;                 // projection.motionLod: на сколько уровней грубее рисовать движение
    float detail;                   // projection.detail: размер текселя выбранного уровня в пикселях, 0 — по умолчанию
    bool has_window, cull;
    float window[4];                // projection.window: видимое окно спрайта в долях
    float fps;
    bool normal_flip_y;
} B3Options;

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------
static bool list_get(const char *list, const char *name, char *out, size_t cap)
{
    if (!list) return false;
    const size_t n = strlen(name);
    for (const char *p = list; *p;) {
        const char *end = strchr(p, ',');
        const size_t len = end ? (size_t)(end - p) : strlen(p);
        if (len > n && !strncmp(p, name, n) && p[n] == '=') {
            snprintf(out, cap, "%.*s", (int)(len - n - 1), p + n + 1);
            return true;
        }
        if (!end) break;
        p = end + 1;
    }
    return false;
}

static bool file_exists_b3(const char *p)
{
    FILE *f = fopen(p, "rb");
    if (!f) return false;
    fclose(f);
    return true;
}

static const char *base_name_b3(const char *p)
{
    const char *s = strrchr(p, '/'), *b = strrchr(p, '\\');
    if (b && (!s || b > s)) s = b;
    return s ? s + 1 : p;
}

static int add_texture(B3Scene *s, uint8_t *px, int w, int h)
{
    BkTexture *g = (BkTexture *)realloc(s->texs, (size_t)(s->ntex + 1) * sizeof(BkTexture));
    if (!g) { sdk_image_free(px); return -1; }
    s->texs = g;
    s->texs[s->ntex] = (BkTexture){ px, w, h };
    return s->ntex++;
}

static int load_texture_file(B3Scene *s, SdkReport *rep, const char *model, const char *file1, const char *file2, int *cache_slot)
{
    if (cache_slot && *cache_slot != -2) return *cache_slot;
    char dir[1024], cand[2048], found[2048] = { 0 };
    sdk_dirname(model, dir, sizeof dir);
    const char *names[2] = { file1 ? file1 : "", file2 ? file2 : "" };
    const char *subdirs[] = { "", "textures", "../textures", "tex", "../tex", "source", "../source" };
    if (names[0][0] && file_exists_b3(names[0])) snprintf(found, sizeof found, "%s", names[0]);
    for (int n = 1; !found[0] && n >= 0; --n) {
        if (!names[n][0]) continue;
        sdk_join(dir, names[n], cand, sizeof cand);
        if (file_exists_b3(cand)) snprintf(found, sizeof found, "%s", cand);
    }
    for (size_t k = 0; !found[0] && k < sizeof subdirs / sizeof *subdirs; ++k) {
        char sub[2048];
        sdk_join(dir, subdirs[k], sub, sizeof sub);
        sdk_join(sub, base_name_b3(names[0][0] ? names[0] : names[1]), cand, sizeof cand);
        if (file_exists_b3(cand)) snprintf(found, sizeof found, "%s", cand);
    }
    int w = 0, h = 0, id = -1;
    uint8_t *px = found[0] ? sdk_image_load_rgba(found, &w, &h) : NULL;
    if (px) id = add_texture(s, px, w, h);
    else sdk_diag(rep, SDK_WARNING, "SDK_BAKE_TEXTURE_MISSING", model, NULL, NULL, "Текстура «%s» не найдена (искали рядом, в textures/, tex/)", base_name_b3(names[0][0] ? names[0] : names[1]));
    if (cache_slot) *cache_slot = id;
    return id;
}

static B3Tri *push_tri(B3Scene *s)
{
    if (s->ntri == s->cap) {
        const int c = s->cap ? s->cap * 2 : 8192;
        B3Tri *g = (B3Tri *)realloc(s->tris, (size_t)c * sizeof(B3Tri));
        if (!g) return NULL;
        s->tris = g;
        s->cap = c;
    }
    B3Tri *t = &s->tris[s->ntri++];
    memset(t, 0, sizeof *t);
    return t;
}

static void mat4_ident(double m[16]) { memset(m, 0, 16 * sizeof(double)); m[0] = m[5] = m[10] = m[15] = 1; }
static void mat4_mul(const double a[16], const double b[16], double o[16])
{
    double r[16];
    for (int i = 0; i < 4; ++i) for (int j = 0; j < 4; ++j) {
        double v = 0;
        for (int k = 0; k < 4; ++k) v += a[i * 4 + k] * b[k * 4 + j];
        r[i * 4 + j] = v;
    }
    memcpy(o, r, sizeof r);
}
static bool mat4_inv_affine(const double m[16], double o[16])
{
    const double a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const double det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (fabs(det) < 1e-18) return false;
    double r[16] = { (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0,
                     (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0,
                     (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1 };
    for (int row = 0; row < 3; ++row) r[row * 4 + 3] = -(r[row * 4] * m[3] + r[row * 4 + 1] * m[7] + r[row * 4 + 2] * m[11]);
    memcpy(o, r, sizeof r);
    return true;
}
static void from_ufbx(const ufbx_matrix *m, double o[16])
{
    const double v[16] = { m->m00, m->m01, m->m02, m->m03, m->m10, m->m11, m->m12, m->m13, m->m20, m->m21, m->m22, m->m23, 0, 0, 0, 1 };
    memcpy(o, v, sizeof v);
}

// ---------------------------------------------------------------------------
// Загрузка FBX напрямую через ufbx (скин, нормали, тангенты, карты)
// ---------------------------------------------------------------------------
static int bone_for_node(B3Scene *s, const ufbx_skin_cluster *cl)
{
    const int node = (int)cl->bone_node->typed_id;
    for (int i = 0; i < s->nbones; ++i) if (s->bones[i].node == node) return i;
    if (s->nbones >= B3_MAX_BONES) return -1;
    B3Bone *b = &s->bones[s->nbones];
    memset(b, 0, sizeof *b);
    snprintf(b->name, sizeof b->name, "%s", cl->bone_node->name.data);
    b->node = node;
    from_ufbx(&cl->bind_to_world, b->bind_to_world);
    return s->nbones++;
}

static bool load_fbx(const char *path, const B3Options *o, B3Scene *s, SdkReport *rep)
{
    ufbx_load_opts lo = { 0 };
    lo.target_axes = ufbx_axes_right_handed_y_up;
    lo.target_unit_meters = 1.0f;
    lo.load_external_files = false;
    ufbx_error err;
    ufbx_scene *fs = ufbx_load_file(path, &lo, &err);
    if (!fs) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", path, NULL, NULL, "FBX не прочитан: %s", err.description.data);
        return false;
    }
    s->bones = (B3Bone *)calloc(B3_MAX_BONES + 1, sizeof(B3Bone));
    const int nm = (int)fs->materials.count;
    s->mats = (B3Mat *)calloc((size_t)nm + 1, sizeof(B3Mat));
    int *cache = (int *)malloc((fs->textures.count + 1) * sizeof(int));
    if (!s->bones || !s->mats || !cache) { free(cache); ufbx_free_scene(fs); return false; }
    for (size_t i = 0; i <= fs->textures.count; ++i) cache[i] = -2;
    for (int i = 0; i <= nm; ++i) {
        B3Mat *m = &s->mats[i];
        snprintf(m->name, sizeof m->name, "%s", i < nm ? fs->materials.data[i]->name.data : "default");
        m->base[0] = m->base[1] = m->base[2] = .8f;
        m->base[3] = 1;
        m->tex = m->ntex = m->ao = -1;
        m->spec = strstr(m->name, "arms") || strstr(m->name, "hand") ? .18f : strstr(m->name, "wood") ? .22f : .62f;
        if (i == nm) continue;
        const ufbx_material *um = fs->materials.data[i];
        const ufbx_material_map *bc = um->pbr.base_color.has_value ? &um->pbr.base_color : &um->fbx.diffuse_color;
        if (bc->has_value) {
            const float f = um->pbr.base_factor.has_value ? (float)um->pbr.base_factor.value_real : 1.0f;
            m->base[0] = (float)bc->value_vec3.x * f;
            m->base[1] = (float)bc->value_vec3.y * f;
            m->base[2] = (float)bc->value_vec3.z * f;
        }
        const ufbx_texture *tx = um->pbr.base_color.texture ? um->pbr.base_color.texture : um->fbx.diffuse_color.texture;
        if (tx) {
            m->tex = load_texture_file(s, rep, path, tx->filename.data, tx->relative_filename.data, &cache[tx->typed_id]);
            if (m->tex >= 0) m->base[0] = m->base[1] = m->base[2] = 1;
        }
        const ufbx_texture *nt = um->pbr.normal_map.texture ? um->pbr.normal_map.texture : um->fbx.normal_map.texture;
        if (nt) m->ntex = load_texture_file(s, rep, path, nt->filename.data, nt->relative_filename.data, &cache[nt->typed_id]);
    }
    free(cache);
    // Переопределения: --fbx-tint «имя=#rrggbb», --fbx-ao «имя=файл.png», --fbx-spec «имя=0..1».
    for (int i = 0; i <= nm; ++i) {
        char val[1024];
        B3Mat *m = &s->mats[i];
        if (list_get(o->tint, m->name, val, sizeof val) && val[0] == '#' && strlen(val) == 7) {
            unsigned rgb = 0;
            if (sscanf(val + 1, "%x", &rgb) == 1 && m->tex < 0) {
                m->base[0] = ((rgb >> 16) & 255) / 255.0f;
                m->base[1] = ((rgb >> 8) & 255) / 255.0f;
                m->base[2] = (rgb & 255) / 255.0f;
            }
        }
        if (list_get(o->ao, m->name, val, sizeof val)) m->ao = load_texture_file(s, rep, path, val, NULL, NULL);
        if (list_get(o->spec, m->name, val, sizeof val)) m->spec = (float)atof(val);
    }
    s->nmat = nm + 1;

    uint32_t *idx = NULL;
    size_t idx_cap = 0;
    bool ok = true;
    bool any_skin = false;
    for (size_t ni = 0; ni < fs->nodes.count && ok; ++ni) {
        const ufbx_node *node = fs->nodes.data[ni];
        const ufbx_mesh *mesh = node->mesh;
        if (!mesh || !mesh->num_triangles) continue;
        const ufbx_skin_deformer *skin = mesh->skin_deformers.count ? mesh->skin_deformers.data[0] : NULL;
        any_skin |= skin != NULL;
        if (mesh->max_face_triangles * 3 > idx_cap) {
            idx_cap = mesh->max_face_triangles * 3;
            uint32_t *g = (uint32_t *)realloc(idx, idx_cap * sizeof(uint32_t));
            if (!g) { ok = false; break; }
            idx = g;
        }
        // Кости вершин (скин) — один раз на вершину меша.
        uint8_t (*vb)[4] = (uint8_t (*)[4])calloc(mesh->num_vertices, 4);
        float (*vw)[4] = (float (*)[4])calloc(mesh->num_vertices, 16);
        if (!vb || !vw) { free(vb); free(vw); ok = false; break; }
        for (size_t v = 0; v < mesh->num_vertices; ++v) {
            if (!skin) { vw[v][0] = 1; continue; }
            const ufbx_skin_vertex sv = skin->vertices.data[v];
            float sum = 0;
            for (uint32_t q = 0; q < sv.num_weights && q < 4; ++q) {
                const ufbx_skin_weight sw = skin->weights.data[sv.weight_begin + q];
                const int b = bone_for_node(s, skin->clusters.data[sw.cluster_index]);
                if (b < 0) continue;
                vb[v][q] = (uint8_t)b;
                vw[v][q] = (float)sw.weight;
                sum += vw[v][q];
            }
            if (sum > 1e-6f) for (int q = 0; q < 4; ++q) vw[v][q] /= sum;
            else vw[v][0] = 1;
        }
        for (size_t fi = 0; fi < mesh->num_faces && ok; ++fi) {
            const ufbx_face face = mesh->faces.data[fi];
            const uint32_t nt = ufbx_triangulate_face(idx, idx_cap, mesh, face);
            int mat = nm;
            if (mesh->face_material.count) {
                const uint32_t slot = mesh->face_material.data[fi];
                if (slot < mesh->materials.count) mat = (int)mesh->materials.data[slot]->typed_id;
            }
            for (uint32_t t = 0; t < nt; ++t) {
                B3Tri *tri = push_tri(s);
                if (!tri) { ok = false; break; }
                tri->mat = mat;
                tri->has_uv = mesh->vertex_uv.exists;
                tri->has_n = mesh->vertex_normal.exists;
                tri->has_t = mesh->vertex_tangent.exists && mesh->vertex_bitangent.exists;
                for (int k = 0; k < 3; ++k) {
                    const uint32_t c = idx[t * 3 + k];
                    const uint32_t v = mesh->vertex_indices.data[c];
                    const ufbx_vec3 p = ufbx_transform_position(&node->geometry_to_world, mesh->vertices.data[v]);
                    tri->p[k][0] = (float)p.x; tri->p[k][1] = (float)p.y; tri->p[k][2] = (float)p.z;
                    if (tri->has_uv) {
                        const ufbx_vec2 uv = ufbx_get_vertex_vec2(&mesh->vertex_uv, c);
                        tri->uv[k][0] = (float)uv.x;
                        tri->uv[k][1] = 1.0f - (float)uv.y;
                    }
                    if (tri->has_n) {
                        const ufbx_vec3 n = ufbx_transform_direction(&node->geometry_to_world, ufbx_get_vertex_vec3(&mesh->vertex_normal, c));
                        const double l = sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
                        tri->n[k][0] = (float)(n.x / l); tri->n[k][1] = (float)(n.y / l); tri->n[k][2] = (float)(n.z / l);
                    }
                    if (tri->has_t) {
                        const ufbx_vec3 tg = ufbx_transform_direction(&node->geometry_to_world, ufbx_get_vertex_vec3(&mesh->vertex_tangent, c));
                        const ufbx_vec3 bt = ufbx_transform_direction(&node->geometry_to_world, ufbx_get_vertex_vec3(&mesh->vertex_bitangent, c));
                        const double lt = sqrt(tg.x * tg.x + tg.y * tg.y + tg.z * tg.z), lb = sqrt(bt.x * bt.x + bt.y * bt.y + bt.z * bt.z);
                        if (lt > 1e-12 && lb > 1e-12) {
                            tri->t[k][0] = (float)(tg.x / lt); tri->t[k][1] = (float)(tg.y / lt); tri->t[k][2] = (float)(tg.z / lt);
                            tri->b[k][0] = (float)(bt.x / lb); tri->b[k][1] = (float)(bt.y / lb); tri->b[k][2] = (float)(bt.z / lb);
                        } else tri->has_t = false;
                    }
                    memcpy(tri->bone[k], vb[v], 4);
                    memcpy(tri->w[k], vw[v], 16);
                }
            }
        }
        free(vb);
        free(vw);
    }
    free(idx);
    if (ok && !s->ntri) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", path, NULL, NULL, "В FBX нет ни одного треугольника");
        ok = false;
    }
    if (ok && !any_skin) {            // жёсткая модель: одна кость «root»
        B3Bone *b = &s->bones[s->nbones++];
        memset(b, 0, sizeof *b);
        snprintf(b->name, sizeof b->name, "root");
        mat4_ident(b->bind_to_world);
        b->node = -1;
    }
    ufbx_free_scene(fs);
    return ok;
}

// OBJ/GLB/VRM: загрузчики общего Baker'а; нормали считаем сами, кость одна.
static bool load_generic(const char *path, const B3Options *o, B3Scene *s, SdkReport *rep)
{
    BkScene bs;
    if (!bk_load_expression(path, NULL, &bs, rep)) return false;
    s->bones = (B3Bone *)calloc(B3_MAX_BONES + 1, sizeof(B3Bone));
    s->mats = (B3Mat *)calloc((size_t)bs.nmat + 1, sizeof(B3Mat));
    if (!s->bones || !s->mats) { bk_free(&bs); return false; }
    snprintf(s->bones[0].name, sizeof s->bones[0].name, "root");
    mat4_ident(s->bones[0].bind_to_world);
    s->bones[0].node = -1;
    s->nbones = 1;
    for (int i = 0; i < bs.ntex; ++i) {
        const BkTexture *t = &bs.texs[i];
        uint8_t *px = (uint8_t *)malloc((size_t)t->w * t->h * 4);
        if (px) memcpy(px, t->px, (size_t)t->w * t->h * 4);
        add_texture(s, px, t->w, t->h);
    }
    for (int i = 0; i < bs.nmat; ++i) {
        B3Mat *m = &s->mats[i];
        snprintf(m->name, sizeof m->name, "%s", bs.mats[i].name);
        memcpy(m->base, bs.mats[i].base, sizeof m->base);
        m->tex = bs.mats[i].tex;
        m->ntex = m->ao = -1;
        m->spec = .5f;
        char val[1024];
        if (list_get(o->spec, m->name, val, sizeof val)) m->spec = (float)atof(val);
        if (list_get(o->ao, m->name, val, sizeof val)) m->ao = load_texture_file(s, rep, path, val, NULL, NULL);
    }
    s->nmat = bs.nmat;
    for (int i = 0; i < bs.ntri; ++i) {
        const BkTri *src = &bs.tris[i];
        B3Tri *t = push_tri(s);
        if (!t) { bk_free(&bs); return false; }
        memcpy(t->p, src->p, sizeof t->p);
        memcpy(t->uv, src->uv, sizeof t->uv);
        t->has_uv = src->has_uv;
        t->mat = src->material < 0 ? 0 : src->material;
        for (int k = 0; k < 3; ++k) t->w[k][0] = 1;
    }
    bk_free(&bs);
    // Гладкие нормали: свар по позиции, взвешивание площадью.
    const int n = s->ntri;
    const int hs = 1 << 20;
    int *head = (int *)malloc((size_t)hs * sizeof(int)), *next = (int *)malloc((size_t)n * 3 * sizeof(int));
    float (*acc)[3] = (float (*)[3])calloc((size_t)n * 3, sizeof(float[3]));
    int *rep_id = (int *)malloc((size_t)n * 3 * sizeof(int));
    if (!head || !next || !acc || !rep_id) { free(head); free(next); free(acc); free(rep_id); return false; }
    memset(head, -1, (size_t)hs * sizeof(int));
    for (int v = 0; v < n * 3; ++v) {
        const float *p = s->tris[v / 3].p[v % 3];
        const long qx = lroundf(p[0] * 2000), qy = lroundf(p[1] * 2000), qz = lroundf(p[2] * 2000);
        const uint32_t h = (uint32_t)((qx * 73856093L) ^ (qy * 19349663L) ^ (qz * 83492791L)) & (hs - 1);
        int found = -1;
        for (int c = head[h]; c >= 0; c = next[c]) {
            const float *q = s->tris[c / 3].p[c % 3];
            if (lroundf(q[0] * 2000) == qx && lroundf(q[1] * 2000) == qy && lroundf(q[2] * 2000) == qz) { found = c; break; }
        }
        rep_id[v] = found >= 0 ? rep_id[found] : v;
        next[v] = head[h];
        head[h] = v;
    }
    for (int i = 0; i < n; ++i) {
        const B3Tri *t = &s->tris[i];
        const float e1[3] = { t->p[1][0] - t->p[0][0], t->p[1][1] - t->p[0][1], t->p[1][2] - t->p[0][2] };
        const float e2[3] = { t->p[2][0] - t->p[0][0], t->p[2][1] - t->p[0][1], t->p[2][2] - t->p[0][2] };
        const float fn[3] = { e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0] };
        for (int k = 0; k < 3; ++k) for (int c = 0; c < 3; ++c) acc[rep_id[i * 3 + k]][c] += fn[c];
    }
    for (int i = 0; i < n; ++i) {
        B3Tri *t = &s->tris[i];
        for (int k = 0; k < 3; ++k) {
            const float *a = acc[rep_id[i * 3 + k]];
            const float l = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
            if (l > 1e-12f) { t->n[k][0] = a[0] / l; t->n[k][1] = a[1] / l; t->n[k][2] = a[2] / l; }
            else t->n[k][2] = 1;
        }
        t->has_n = true;
    }
    free(head); free(next); free(acc); free(rep_id);
    return true;
}

// ---------------------------------------------------------------------------
// Текселизация
// ---------------------------------------------------------------------------
typedef struct Texel {
    float p[3], n[3];
    uint8_t rgba[4], spec, bone[4], w[4], flag;
} Texel;

static void sample_bilinear(const BkTexture *t, float u, float v, float out[4])
{
    u = u - floorf(u);
    v = v - floorf(v);
    const float fx = u * t->w - .5f, fy = v * t->h - .5f;
    int x0 = (int)floorf(fx), y0 = (int)floorf(fy);
    const float ax = fx - x0, ay = fy - y0;
    for (int c = 0; c < 4; ++c) out[c] = 0;
    for (int j = 0; j < 4; ++j) {
        int x = x0 + (j & 1), y = y0 + (j >> 1);
        x = (x % t->w + t->w) % t->w;
        y = (y % t->h + t->h) % t->h;
        const float wgt = ((j & 1) ? ax : 1 - ax) * ((j >> 1) ? ay : 1 - ay);
        const uint8_t *px = t->px + ((size_t)y * t->w + x) * 4;
        for (int c = 0; c < 4; ++c) out[c] += wgt * px[c];
    }
}

typedef struct Frame {          // отображение: исходные метры → единицы Re2D
    double L[9];                // линейная часть
    double c[3];                // сдвиг: p' = L*(p-c)
} Frame;

static void frame_apply(const Frame *f, const float p[3], float out[3])
{
    const double q[3] = { p[0] - f->c[0], p[1] - f->c[1], p[2] - f->c[2] };
    for (int i = 0; i < 3; ++i) out[i] = (float)(f->L[i * 3] * q[0] + f->L[i * 3 + 1] * q[1] + f->L[i * 3 + 2] * q[2]);
}

typedef struct Rect { int x0, y0, w, h; } Rect;

typedef struct Bake {
    B3Scene *s;
    Rect *rect;                  // прямоугольник сетки каждого материала (у них общее пространство UV 0..1)
    const B3Options *o;
    Frame f;
    int W, H;
    Texel *texels;
    float *mdist;                // поля: расстояние до уже выбранного треугольника (ближайший выигрывает)
    long overlaps, margin_texels;
    int islands;
} Bake;


// Материалы FBX обычно делят одно пространство UV (у каждого своя текстура): раздаём каждому свой прямоугольник сетки.
static void alloc_rects(int *ids, int n, const double *wt, Rect r, Rect *out)
{
    if (n <= 0) return;
    if (n == 1) { out[ids[0]] = r; return; }
    for (int i = 1; i < n; ++i) { int v = ids[i], j = i; while (j > 0 && wt[ids[j - 1]] < wt[v]) { ids[j] = ids[j - 1]; --j; } ids[j] = v; }
    int a[B3_MAX_BONES * 2], b[B3_MAX_BONES * 2], na = 0, nb = 0;
    double sa = 0, sb = 0;
    for (int i = 0; i < n; ++i) { if (sa <= sb) { a[na++] = ids[i]; sa += wt[ids[i]]; } else { b[nb++] = ids[i]; sb += wt[ids[i]]; } }
    const double f = sa / (sa + sb);
    Rect ra = r, rb = r;
    if (r.w >= r.h) { ra.w = (int)(r.w * f + .5); rb.x0 = r.x0 + ra.w; rb.w = r.w - ra.w; }
    else { ra.h = (int)(r.h * f + .5); rb.y0 = r.y0 + ra.h; rb.h = r.h - ra.h; }
    alloc_rects(a, na, wt, ra, out);
    alloc_rects(b, nb, wt, rb, out);
}

static void plan_tiles(Bake *bk)
{
    B3Scene *s = bk->s;
    double *wt = (double *)calloc((size_t)s->nmat + 1, sizeof(double));
    bk->rect = (Rect *)calloc((size_t)s->nmat + 1, sizeof(Rect));
    int ids[B3_MAX_BONES * 2], n = 0;
    for (int i = 0; i < s->ntri; ++i) {
        const B3Tri *t = &s->tris[i];
        const float e1[3] = { t->p[1][0] - t->p[0][0], t->p[1][1] - t->p[0][1], t->p[1][2] - t->p[0][2] };
        const float e2[3] = { t->p[2][0] - t->p[0][0], t->p[2][1] - t->p[0][1], t->p[2][2] - t->p[0][2] };
        const double cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
        wt[t->mat] += .5 * sqrt(cx * cx + cy * cy + cz * cz);
    }
    for (int m = 0; m < s->nmat; ++m) {
        char val[256];
        if (wt[m] > 0) {
            wt[m] = sqrt(wt[m]) * (s->mats[m].ntex >= 0 ? 1.5 : 1.0);
            if (list_get(bk->o->tiles, s->mats[m].name, val, sizeof val)) wt[m] = atof(val);
            if (wt[m] > 0 && n < (int)(sizeof ids / sizeof *ids)) ids[n++] = m;
        }
    }
    if (n <= 1) { for (int i = 0; i < s->nmat; ++i) bk->rect[i] = (Rect){ 0, 0, bk->W, bk->H }; free(wt); return; }
    alloc_rects(ids, n, wt, (Rect){ 0, 0, bk->W, bk->H }, bk->rect);
    for (int i = 0; i < n; ++i) {                      // зазор между плитками
        Rect *r = &bk->rect[ids[i]];
        const int g = 3;
        if (r->x0 > 0) { r->x0 += g; r->w -= g; }
        if (r->y0 > 0) { r->y0 += g; r->h -= g; }
        if (r->x0 + r->w < bk->W) r->w -= g;
        if (r->y0 + r->h < bk->H) r->h -= g;
    }
    free(wt);
}


// ---------------------------------------------------------------------------
// Острова UV: у материалов FBX острова часто лежат друг на друге (зеркальные руки, копии пуль).
// Сшиваем вершины по (UV, позиция), пакуем острова в плитку материала, а цвет берём по исходным UV.
// ---------------------------------------------------------------------------
typedef struct VKey { uint64_t key; int vtx; } VKey;
static int cmp_vkey(const void *a, const void *b) { const uint64_t x = ((const VKey *)a)->key, y = ((const VKey *)b)->key; return x < y ? -1 : x > y; }
static int uf_find(int *p, int x) { while (p[x] != x) { p[x] = p[p[x]]; x = p[x]; } return x; }
typedef struct Island { int first, count, mat; float u0, v0, u1, v1, shift_u, shift_v; int px, py, pw, ph; float scale; } Island;
static int cmp_island_h(const void *a, const void *b) { const Island *x = a, *y = b; return (y->v1 - y->v0) > (x->v1 - x->v0) ? 1 : (y->v1 - y->v0) < (x->v1 - x->v0) ? -1 : 0; }

static bool pack_in_tile(Island *isl, int n, Rect r, float *out_scale)
{
    const float pad = 3;
    double area = 0;
    for (int i = 0; i < n; ++i) area += (double)(isl[i].u1 - isl[i].u0) * (isl[i].v1 - isl[i].v0);
    if (area <= 0) return false;
    double scale = sqrt((double)r.w * r.h * .62 / area);
    for (int attempt = 0; attempt < 60; ++attempt, scale *= .96) {
        int x = 0, y = 0, shelf = 0;
        bool fits = true;
        for (int i = 0; i < n && fits; ++i) {
            const int w = (int)ceil((isl[i].u1 - isl[i].u0) * scale) + 2 * (int)pad, h = (int)ceil((isl[i].v1 - isl[i].v0) * scale) + 2 * (int)pad;
            if (w > r.w) { fits = false; break; }
            if (x + w > r.w) { x = 0; y += shelf; shelf = 0; }
            if (y + h > r.h) { fits = false; break; }
            isl[i].px = r.x0 + x + (int)pad;
            isl[i].py = r.y0 + y + (int)pad;
            isl[i].pw = w;
            isl[i].ph = h;
            x += w;
            if (h > shelf) shelf = h;
        }
        if (fits) { *out_scale = (float)scale; return true; }
    }
    return false;
}

static bool plan_islands(Bake *bk, SdkReport *rep)
{
    B3Scene *s = bk->s;
    const int nv = s->ntri * 3;
    VKey *keys = (VKey *)malloc((size_t)nv * sizeof(VKey));
    int *par = (int *)malloc((size_t)nv * sizeof(int));
    if (!keys || !par) { free(keys); free(par); return false; }
    for (int v = 0; v < nv; ++v) {
        const B3Tri *t = &s->tris[v / 3];
        const int k = v % 3;
        uint64_t h = 1469598103934665603ull;
        const long q[6] = { t->mat, lroundf(t->uv[k][0] * 4000), lroundf(t->uv[k][1] * 4000), lroundf(t->p[k][0] * 3000), lroundf(t->p[k][1] * 3000), lroundf(t->p[k][2] * 3000) };
        for (int i = 0; i < 6; ++i) { h ^= (uint64_t)q[i]; h *= 1099511628211ull; h ^= h >> 29; }
        keys[v] = (VKey){ h, v };
        par[v] = v;
    }
    for (int i = 0; i < s->ntri; ++i) { par[uf_find(par, i * 3 + 1)] = uf_find(par, i * 3); par[uf_find(par, i * 3 + 2)] = uf_find(par, i * 3); }
    qsort(keys, (size_t)nv, sizeof(VKey), cmp_vkey);
    for (int i = 1; i < nv; ++i) if (keys[i].key == keys[i - 1].key) par[uf_find(par, keys[i].vtx)] = uf_find(par, keys[i - 1].vtx);
    free(keys);
    // острова
    int *isl_of = (int *)malloc((size_t)s->ntri * sizeof(int)), *map = (int *)malloc((size_t)nv * sizeof(int));
    for (int i = 0; i < nv; ++i) map[i] = -1;
    Island *isl = (Island *)calloc((size_t)s->ntri, sizeof(Island));
    int ni = 0;
    for (int i = 0; i < s->ntri; ++i) {
        const int root = uf_find(par, i * 3);
        if (map[root] < 0) {
            map[root] = ni;
            Island *is = &isl[ni++];
            is->mat = s->tris[i].mat;
            is->u0 = is->v0 = 1e30f;
            is->u1 = is->v1 = -1e30f;
            is->shift_u = floorf((s->tris[i].uv[0][0] + s->tris[i].uv[1][0] + s->tris[i].uv[2][0]) / 3);
            is->shift_v = floorf((s->tris[i].uv[0][1] + s->tris[i].uv[1][1] + s->tris[i].uv[2][1]) / 3);
        }
        isl_of[i] = map[root];
        Island *is = &isl[map[root]];
        is->count++;
        for (int k = 0; k < 3; ++k) {
            const float u = s->tris[i].uv[k][0] - is->shift_u, v = s->tris[i].uv[k][1] - is->shift_v;
            if (u < is->u0) is->u0 = u;
            if (u > is->u1) is->u1 = u;
            if (v < is->v0) is->v0 = v;
            if (v > is->v1) is->v1 = v;
        }
    }
    free(map);
    free(par);
    // пакуем по материалам
    bool ok = true;
    long total = 0;
    for (int m = 0; m < s->nmat && ok; ++m) {
        int cnt = 0;
        for (int i = 0; i < ni; ++i) if (isl[i].mat == m) ++cnt;
        if (!cnt) continue;
        Island *list = (Island *)malloc((size_t)cnt * sizeof(Island));
        int *orig = (int *)malloc((size_t)cnt * sizeof(int));
        int c = 0;
        for (int i = 0; i < ni; ++i) if (isl[i].mat == m) { list[c] = isl[i]; list[c].first = i; ++c; }
        qsort(list, (size_t)cnt, sizeof(Island), cmp_island_h);
        float scale;
        if (!pack_in_tile(list, cnt, bk->rect[m], &scale)) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_PACK", NULL, NULL, NULL, "Материал «%s»: острова не помещаются в плитку %dx%d (увеличьте --grid или вес в --tiles)", s->mats[m].name, bk->rect[m].w, bk->rect[m].h);
            ok = false;
        } else {
            for (int i = 0; i < cnt; ++i) { isl[list[i].first].px = list[i].px; isl[list[i].first].py = list[i].py; isl[list[i].first].scale = scale; }
            total += cnt;
        }
        free(list);
        free(orig);
    }
    if (ok) for (int i = 0; i < s->ntri; ++i) {
        const Island *is = &isl[isl_of[i]];
        B3Tri *t = &s->tris[i];
        for (int k = 0; k < 3; ++k) {
            t->puv[k][0] = is->px + (t->uv[k][0] - is->shift_u - is->u0) * is->scale;
            t->puv[k][1] = is->py + (t->uv[k][1] - is->shift_v - is->v0) * is->scale;
        }
        t->packed = true;
    }
    bk->islands = ni;
    free(isl);
    free(isl_of);
    return ok;
}

static bool bary_texel(const float uv[3][2], float px, float py, float b[3], float *min_dist)
{
    const float x0 = uv[0][0], y0 = uv[0][1], x1 = uv[1][0], y1 = uv[1][1], x2 = uv[2][0], y2 = uv[2][1];
    const float det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (fabsf(det) < 1e-9f) return false;
    b[0] = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / det;
    b[1] = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / det;
    b[2] = 1 - b[0] - b[1];
    // расстояние до каждой стороны в текселях = bary * высота
    const float area2 = fabsf(det);
    const float len[3] = { hypotf(x2 - x1, y2 - y1), hypotf(x0 - x2, y0 - y2), hypotf(x1 - x0, y1 - y0) };
    float md = 1e9f;
    for (int i = 0; i < 3; ++i) {
        const float h = len[i] > 1e-9f ? area2 / len[i] : 0;
        const float d = b[i] * h;
        if (d < md) md = d;
    }
    *min_dist = md;
    return true;
}

// Ближайшая к (px,py) точка треугольника (координаты сетки): её барицентры и расстояние до неё в текселях.
static float closest_bary(const float uv[3][2], float px, float py, float b[3])
{
    float best = 1e30f, bx = uv[0][0], by = uv[0][1];
    for (int i = 0; i < 3; ++i) {
        const float ax = uv[i][0], ay = uv[i][1], ex = uv[(i + 1) % 3][0] - ax, ey = uv[(i + 1) % 3][1] - ay;
        const float l2 = ex * ex + ey * ey;
        float t = l2 > 1e-12f ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const float qx = ax + ex * t, qy = ay + ey * t, d = hypotf(px - qx, py - qy);
        if (d < best) { best = d; bx = qx; by = qy; }
    }
    float md;
    if (!bary_texel(uv, bx, by, b, &md)) return 1e30f;
    float sum = 0;
    for (int i = 0; i < 3; ++i) { if (b[i] < 0) b[i] = 0; sum += b[i]; }
    if (sum < 1e-9f) return 1e30f;
    for (int i = 0; i < 3; ++i) b[i] /= sum;
    return best;
}

// margin — тексель поля за краем острова: b уже прижаты к ребру, цвет берём в той же точке (без выхода за остров).
static void shade_texel(Bake *bk, const B3Tri *t, float uv_tex[3][2], int x, int y, const float b[3], bool margin, Texel *out)
{
    const B3Mat *m = &bk->s->mats[t->mat];
    float P[3] = { 0, 0, 0 }, N[3] = { 0, 0, 0 }, T[3] = { 0, 0, 0 }, B[3] = { 0, 0, 0 };
    for (int k = 0; k < 3; ++k) for (int c = 0; c < 3; ++c) {
        P[c] += b[k] * t->p[k][c];
        N[c] += b[k] * t->n[k][c];
        T[c] += b[k] * t->t[k][c];
        B[c] += b[k] * t->b[k][c];
    }
    float nl = sqrtf(N[0] * N[0] + N[1] * N[1] + N[2] * N[2]);
    if (nl < 1e-9f) { N[0] = 0; N[1] = 0; N[2] = 1; nl = 1; }
    for (int c = 0; c < 3; ++c) N[c] /= nl;
    if (!t->has_t) {                                    // тангенты из производных UV
        const float e1[3] = { t->p[1][0] - t->p[0][0], t->p[1][1] - t->p[0][1], t->p[1][2] - t->p[0][2] };
        const float e2[3] = { t->p[2][0] - t->p[0][0], t->p[2][1] - t->p[0][1], t->p[2][2] - t->p[0][2] };
        const float du1 = t->uv[1][0] - t->uv[0][0], dv1 = t->uv[1][1] - t->uv[0][1];
        const float du2 = t->uv[2][0] - t->uv[0][0], dv2 = t->uv[2][1] - t->uv[0][1];
        const float det = du1 * dv2 - du2 * dv1;
        if (fabsf(det) > 1e-12f) for (int c = 0; c < 3; ++c) {
            T[c] = (e1[c] * dv2 - e2[c] * dv1) / det;
            B[c] = (e2[c] * du1 - e1[c] * du2) / det;
        } else { T[0] = 1; B[1] = 1; }
    }
    // Цвет и нормаль-карта: 2×2 подвыборки внутри текселя.
    float col[4] = { 0, 0, 0, 0 }, nm[3] = { 0, 0, 0 };
    const float sub[4][2] = { { .25f, .25f }, { .75f, .25f }, { .25f, .75f }, { .75f, .75f } };
    for (int s = 0; s < 4; ++s) {
        float bs[3], md;
        if (margin) memcpy(bs, b, sizeof bs);
        else if (!bary_texel(uv_tex, x + sub[s][0], y + sub[s][1], bs, &md)) { bs[0] = bs[1] = bs[2] = 1.0f / 3; }
        else if (md < 0) {                                  // подвыборка вышла за треугольник: не тянем цвет из-за края острова
            float sum = 0;
            for (int k = 0; k < 3; ++k) { if (bs[k] < 0) bs[k] = 0; sum += bs[k]; }
            for (int k = 0; k < 3; ++k) bs[k] /= sum > 1e-9f ? sum : 1;
        }
        const float u = bs[0] * t->uv[0][0] + bs[1] * t->uv[1][0] + bs[2] * t->uv[2][0];
        const float v = bs[0] * t->uv[0][1] + bs[1] * t->uv[1][1] + bs[2] * t->uv[2][1];
        float c[4] = { m->base[0] * 255, m->base[1] * 255, m->base[2] * 255, m->base[3] * 255 };
        if (m->tex >= 0) {
            float tx[4];
            sample_bilinear(&bk->s->texs[m->tex], u, v, tx);
            for (int k = 0; k < 4; ++k) c[k] = tx[k] * (k < 3 ? m->base[k] : 1);
        }
        if (m->ao >= 0) {
            float ao[4];
            sample_bilinear(&bk->s->texs[m->ao], u, v, ao);
            for (int k = 0; k < 3; ++k) c[k] *= ao[k] / 255.0f;
        }
        for (int k = 0; k < 4; ++k) col[k] += c[k] * .25f;
        float n_ts[3] = { 0, 0, 1 };
        if (m->ntex >= 0) {
            float nx[4];
            sample_bilinear(&bk->s->texs[m->ntex], u, v, nx);
            n_ts[0] = nx[0] / 127.5f - 1;
            n_ts[1] = (nx[1] / 127.5f - 1) * (bk->o->normal_flip_y ? -1 : 1);
            n_ts[2] = nx[2] / 127.5f - 1;
        }
        for (int k = 0; k < 3; ++k) nm[k] += (n_ts[0] * T[k] + n_ts[1] * B[k] + n_ts[2] * N[k]) * .25f;
    }
    float nl2 = sqrtf(nm[0] * nm[0] + nm[1] * nm[1] + nm[2] * nm[2]);
    if (nl2 < 1e-9f) { memcpy(nm, N, sizeof nm); nl2 = 1; }
    for (int k = 0; k < 3; ++k) nm[k] /= nl2;
    // В пространство Re2D: тот же линейный оператор, что у позиций (нормаль преобразуется транспонированной обратной;
    // для L = scale·diag(1,−1,1) это просто знак Y).
    float pr[3];
    frame_apply(&bk->f, P, pr);
    memcpy(out->p, pr, sizeof pr);
    out->n[0] = nm[0];
    out->n[1] = -nm[1];
    out->n[2] = nm[2];
    for (int k = 0; k < 3; ++k) out->rgba[k] = (uint8_t)fminf(255, fmaxf(0, col[k] + .5f));
    out->rgba[3] = 255;
    out->spec = (uint8_t)fminf(255, fmaxf(0, m->spec * 255 + .5f));
    // скин: суммируем веса вершин по барицентрам, берём 4 сильнейших
    int ids[12], cnt = 0;
    float ws[12];
    for (int k = 0; k < 3; ++k) {
        const float bw = b[k] < 0 ? 0 : b[k];
        for (int q = 0; q < 4; ++q) {
            if (t->w[k][q] <= 0) continue;
            int slot = -1;
            for (int j = 0; j < cnt; ++j) if (ids[j] == t->bone[k][q]) { slot = j; break; }
            if (slot < 0 && cnt < 12) { slot = cnt++; ids[slot] = t->bone[k][q]; ws[slot] = 0; }
            if (slot >= 0) ws[slot] += bw * t->w[k][q];
        }
    }
    memset(out->bone, 0, 4);
    memset(out->w, 0, 4);
    float total = 0;
    int pick[4] = { -1, -1, -1, -1 };
    for (int q = 0; q < 4; ++q) {
        int best = -1;
        for (int j = 0; j < cnt; ++j) {
            bool taken = false;
            for (int z = 0; z < q; ++z) if (pick[z] == j) taken = true;
            if (!taken && (best < 0 || ws[j] > ws[best])) best = j;
        }
        pick[q] = best;
        if (best >= 0) total += ws[best];
    }
    if (total < 1e-9f) { out->bone[0] = t->bone[0][0]; out->w[0] = 255; }
    else {
        int sum = 0, strongest = 0;
        for (int q = 0; q < 4; ++q) {
            if (pick[q] < 0) continue;
            out->bone[q] = (uint8_t)ids[pick[q]];
            out->w[q] = (uint8_t)fminf(255, ws[pick[q]] / total * 255 + .5f);
            sum += out->w[q];
            if (out->w[q] > out->w[strongest]) strongest = q;
        }
        out->w[strongest] = (uint8_t)(out->w[strongest] + (255 - sum));
    }
}

static void rasterize_triangles(Bake *bk, int pass)
{
    const int W = bk->W, H = bk->H;
    B3Scene *s = bk->s;
    for (int ti = 0; ti < s->ntri; ++ti) {
        const B3Tri *t = &s->tris[ti];
        if (!t->has_uv) continue;
        if (!t->packed) continue;
        const Rect rc = bk->rect[t->mat];
        float uv[3][2];
        for (int k = 0; k < 3; ++k) { uv[k][0] = t->puv[k][0]; uv[k][1] = t->puv[k][1]; }
        float minx = uv[0][0], maxx = minx, miny = uv[0][1], maxy = miny;
        for (int k = 1; k < 3; ++k) {
            if (uv[k][0] < minx) minx = uv[k][0];
            if (uv[k][0] > maxx) maxx = uv[k][0];
            if (uv[k][1] < miny) miny = uv[k][1];
            if (uv[k][1] > maxy) maxy = uv[k][1];
        }
        const float pad = pass == 2 ? B3_MARGIN + 1 : 1;
        int x0 = (int)floorf(minx - pad), x1 = (int)ceilf(maxx + pad), y0 = (int)floorf(miny - pad), y1 = (int)ceilf(maxy + pad);
        if (x0 < rc.x0) x0 = rc.x0;
        if (y0 < rc.y0) y0 = rc.y0;
        if (x1 > rc.x0 + rc.w - 1) x1 = rc.x0 + rc.w - 1;
        if (y1 > rc.y0 + rc.h - 1) y1 = rc.y0 + rc.h - 1;
        for (int y = y0; y <= y1; ++y) for (int x = x0; x <= x1; ++x) {
            float b[3], md;
            if (!bary_texel(uv, x + .5f, y + .5f, b, &md)) continue;
            Texel *tx = &bk->texels[(size_t)y * W + x];
            const bool inside = md >= -1e-4f;
            if (pass == 1) {
                if (!inside) continue;
                if (tx->flag == 1) { bk->overlaps++; continue; }
            } else {
                // поле: тексель за краем острова ложится точно на ближайшую точку ребра (поверхность доходит до ребра и не торчит за него)
                if (inside || tx->flag == 1) continue;
                const float d = closest_bary(uv, x + .5f, y + .5f, b);
                const size_t idx = (size_t)y * W + x;
                if (d > B3_MARGIN || (tx->flag == 2 && d >= bk->mdist[idx])) continue;
                if (!tx->flag) bk->margin_texels++;
                bk->mdist[idx] = d;
            }
            shade_texel(bk, t, uv, x, y, b, pass == 2, tx);
            tx->flag = pass == 1 ? 1 : 2;
        }
    }
}

// ---------------------------------------------------------------------------
// Запись контейнера v3
// ---------------------------------------------------------------------------
static uint16_t enc16(float v)
{
    const float q = (v + 128.0f) * 256.0f;
    return (uint16_t)fminf(65535.0f, fmaxf(0.0f, q + .5f));
}

static bool write_png_v3(Bake *bk, const char *path, int extent)
{
    const int W = bk->W, H = bk->H, PW = W * B3_COLS, PH = 1 + ((B3_LAYERS + B3_COLS - 1) / B3_COLS) * H;
    uint8_t *png = (uint8_t *)calloc((size_t)PW * PH, 4);
    if (!png) return false;
    const uint8_t head[7][4] = { { 82, 50, 68, 255 }, { 82, 79, 84, 255 }, { 3, 0, 0, 255 },
                                 { (uint8_t)(W >> 8), (uint8_t)W, (uint8_t)(H >> 8), (uint8_t)H },
                                 { B3_COLS, B3_LAYERS, 0, 0 }, { (uint8_t)(extent >> 8), (uint8_t)extent, 0, 0 }, { 0, 0, 0, 0 } };
    memcpy(png, head, sizeof head);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        const Texel *t = &bk->texels[(size_t)y * W + x];
        uint8_t *px[B3_LAYERS];
        for (int l = 0; l < B3_LAYERS; ++l) px[l] = png + ((size_t)(1 + (l / B3_COLS) * H + y) * PW + (l % B3_COLS) * W + x) * 4;
        if (!t->flag) continue;
        memcpy(px[0], t->rgba, 4);
        px[0][3] = 255;
        uint16_t q[3];
        for (int c = 0; c < 3; ++c) q[c] = enc16(t->p[c]);
        for (int c = 0; c < 3; ++c) { px[1][c] = (uint8_t)(q[c] >> 8); px[2][c] = (uint8_t)q[c]; }
        px[1][3] = 255;
        px[2][3] = 255;
        for (int c = 0; c < 3; ++c) px[3][c] = (uint8_t)fminf(255, fmaxf(0, (t->n[c] * .5f + .5f) * 255 + .5f));
        px[3][3] = t->spec;
        memcpy(px[4], t->bone, 4);
        memcpy(px[5], t->w, 4);
        if (px[4][3] == 0 && px[5][3] == 0) px[4][3] = 0;
    }
    const bool ok = sdk_image_write_png(path, png, PW, PH);
    free(png);
    return ok;
}

// ---------------------------------------------------------------------------
// Клипы скелета: FBX-анимация → матрицы костей в пространстве Re2D
// ---------------------------------------------------------------------------
static void frame_matrix(const Frame *f, double F[16], double Finv[16])
{
    for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j) F[i * 4 + j] = f->L[i * 3 + j];
    for (int i = 0; i < 3; ++i) F[i * 4 + 3] = -(f->L[i * 3] * f->c[0] + f->L[i * 3 + 1] * f->c[1] + f->L[i * 3 + 2] * f->c[2]);
    F[12] = F[13] = F[14] = 0;
    F[15] = 1;
    mat4_inv_affine(F, Finv);
}

static bool export_clips(const char *path, Bake *bk, const char *out_json, SdkReport *rep, int *clip_count)
{
    *clip_count = 0;
    if (!bk->o->clips || !bk->o->clips[0]) return true;
    ufbx_load_opts lo = { 0 };
    lo.target_axes = ufbx_axes_right_handed_y_up;
    lo.target_unit_meters = 1.0f;
    lo.load_external_files = false;
    lo.ignore_geometry = true;
    ufbx_error err;
    ufbx_scene *fs = ufbx_load_file(path, &lo, &err);
    if (!fs) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", path, NULL, NULL, "FBX (клипы) не прочитан: %s", err.description.data);
        return false;
    }
    double F[16], Finv[16];
    frame_matrix(&bk->f, F, Finv);
    B3Scene *s = bk->s;
    double bind_inv[B3_MAX_BONES][16];
    for (int i = 0; i < s->nbones; ++i) if (!mat4_inv_affine(s->bones[i].bind_to_world, bind_inv[i])) mat4_ident(bind_inv[i]);
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_puts(&sb, "{\"version\":1,\"clips\":{");
    char spec[2048];
    snprintf(spec, sizeof spec, "%s", bk->o->clips);
    char *save = NULL;
    int clips = 0;
    bool ok = true;
    for (char *tok = strtok_r(spec, ",", &save); tok && ok; tok = strtok_r(NULL, ",", &save)) {
        char *eq = strchr(tok, '=');
        const char *clip_name = eq ? tok : tok, *stack_name = eq ? eq + 1 : tok;
        if (eq) *eq = 0;
        char loop_mark = 0;
        char *colon = strchr((char *)stack_name, ':');
        if (colon) { loop_mark = colon[1]; *colon = 0; }
        ufbx_anim_stack *stack = NULL;
        for (size_t i = 0; i < fs->anim_stacks.count && !stack; ++i) {
            const char *nm = fs->anim_stacks.data[i]->name.data, *bar = strrchr(nm, '|');
            if (!strcmp(nm, stack_name) || (bar && !strcmp(bar + 1, stack_name))) stack = fs->anim_stacks.data[i];
        }
        if (!stack) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FBX_STACK", path, NULL, NULL, "В FBX нет клипа «%s»", stack_name);
            ok = false;
            break;
        }
        const double dur = stack->time_end - stack->time_begin;
        const int frames = (int)ceil(dur * bk->o->fps) + 1;
        if (dur <= 0 || frames < 2 || frames > 4096) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FBX_STACK", path, NULL, NULL, "Клип «%s»: длительность вне допустимого", stack_name);
            ok = false;
            break;
        }
        r2d_sb_printf(&sb, "%s", clips ? "," : "");
        r2d_sb_put_json_string(&sb, clip_name);
        r2d_sb_printf(&sb, ":{\"duration\":%.6f,\"loop\":%s,\"tracks\":[],\"skin\":{\"fps\":%.3f,\"frames\":%d,\"bones\":%d,\"data\":[", dur, loop_mark == 'l' ? "true" : "false", (frames - 1) / dur, frames, s->nbones);
        for (int fr = 0; fr < frames; ++fr) {
            const double t = stack->time_begin + dur * fr / (frames - 1);
            ufbx_scene *pose = ufbx_evaluate_scene(fs, stack->anim, t, NULL, &err);
            if (!pose) { ok = false; break; }
            for (int i = 0; i < s->nbones; ++i) {
                double M[16];
                mat4_ident(M);
                if (s->bones[i].node >= 0) {
                    double N[16];
                    from_ufbx(&pose->nodes.data[s->bones[i].node]->node_to_world, N);
                    mat4_mul(N, bind_inv[i], M);
                }
                mat4_mul(F, M, M);
                mat4_mul(M, Finv, M);
                for (int j = 0; j < 12; ++j) r2d_sb_printf(&sb, "%s%.5g", (fr || i || j) ? "," : "", M[j]);
            }
            ufbx_free_scene(pose);
        }
        r2d_sb_puts(&sb, "]}}");
        ++clips;
    }
    r2d_sb_puts(&sb, "}}\n");
    ufbx_free_scene(fs);
    if (ok && !sdk_write_file(out_json, sb.data, sb.len)) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_WRITE_FAILED", out_json, NULL, NULL, "Не удалось записать клипы");
        ok = false;
    }
    r2d_sb_free(&sb);
    *clip_count = clips;
    return ok;
}

// ---------------------------------------------------------------------------
// Основная команда
// ---------------------------------------------------------------------------
static void default_b3(B3Options *o)
{
    memset(o, 0, sizeof *o);
    o->grid = 1024;
    o->extent = 128;
    o->fit = .94f;
    o->fps = 30;
}

static bool bake3(const char *source, const char *out_dir, const B3Options *o, SdkReport *rep, R2dSb *report)
{
    B3Scene s;
    memset(&s, 0, sizeof s);
    const bool fbx = sdk_ends_with(source, ".fbx") || sdk_ends_with(source, ".FBX");
    bool ok = fbx ? load_fbx(source, o, &s, rep) : load_generic(source, o, &s, rep);
    Bake bk = { 0 };
    char png_path[1024] = "", json_path[1024] = "", anim_path[1024] = "", rep_path[1024] = "";
    int clips = 0;
    long used = 0, bones_used = 0;
    if (ok) {
        // габарит исходной модели и отображение в единицы Re2D
        float mn[3] = { 1e30f, 1e30f, 1e30f }, mx[3] = { -1e30f, -1e30f, -1e30f };
        for (int i = 0; i < s.ntri; ++i) for (int k = 0; k < 3; ++k) for (int c = 0; c < 3; ++c) {
            if (s.tris[i].p[k][c] < mn[c]) mn[c] = s.tris[i].p[k][c];
            if (s.tris[i].p[k][c] > mx[c]) mx[c] = s.tris[i].p[k][c];
        }
        double scale = o->scale;
        if (scale <= 0) {
            float ext = 0;
            for (int c = 0; c < 3; ++c) if (mx[c] - mn[c] > ext) ext = mx[c] - mn[c];
            scale = ext > 0 ? o->extent * o->fit / ext : 1;
        }
        bk.s = &s;
        bk.o = o;
        bk.W = bk.H = o->grid;
        memset(bk.f.L, 0, sizeof bk.f.L);
        bk.f.L[0] = scale;
        bk.f.L[4] = -scale;
        bk.f.L[8] = scale;
        for (int c = 0; c < 3; ++c) bk.f.c[c] = o->has_pivot ? o->pivot[c] : (mn[c] + mx[c]) * .5;
        bk.texels = (Texel *)calloc((size_t)bk.W * bk.H, sizeof(Texel));
        if (!bk.texels) ok = false;
        if (ok) {
            plan_tiles(&bk);
            if (!plan_islands(&bk, rep)) ok = false;
            if (ok) {
            rasterize_triangles(&bk, 1);
            bk.mdist = (float *)malloc((size_t)bk.W * bk.H * sizeof(float));
            if (bk.mdist) rasterize_triangles(&bk, 2);
            else ok = false;
            }
            for (long i = 0; i < (long)bk.W * bk.H; ++i) {
                const Texel *t = &bk.texels[i];
                if (!t->flag) continue;
                ++used;
                for (int q = 0; q < 4; ++q) if (t->w[q]) s.bones[t->bone[q]].used = true;
            }
            for (int i = 0; i < s.nbones; ++i) if (s.bones[i].used) ++bones_used;
            if (!used) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", source, NULL, NULL, "Ни один тексель не покрыт: у модели нет UV или они вне 0..1");
                ok = false;
            }
        }
        if (ok && bk.overlaps > (used / 50 > 64 ? used / 50 : 64))
            sdk_diag(rep, SDK_WARNING, "SDK_BAKE_UV_OVERLAP", source, NULL, NULL, "UV накладываются: %ld текселей получили вторую поверхность (зеркальные/общие острова дают мусор; нужна уникальная развёртка)", bk.overlaps);
        if (ok) {
            char base[256];
            snprintf(base, sizeof base, "%s", o->name ? o->name : "model");
            char tmp[1100];
            sdk_join(out_dir, base, tmp, sizeof tmp);
            snprintf(png_path, sizeof png_path, "%s.png", tmp);
            snprintf(json_path, sizeof json_path, "%s.character.json", tmp);
            snprintf(anim_path, sizeof anim_path, "%s.animations.json", tmp);
            snprintf(rep_path, sizeof rep_path, "%s.bake.json", tmp);
            if (!write_png_v3(&bk, png_path, o->extent)) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_WRITE_FAILED", png_path, NULL, NULL, "Не удалось записать PNG v3");
                ok = false;
            }
        }
        if (ok && fbx) ok = export_clips(source, &bk, anim_path, rep, &clips);
        if (ok) {
            // rig: кости = части (id = индекс+1)
            R2dSb js;
            r2d_sb_init(&js);
            char atlas[300];
            snprintf(atlas, sizeof atlas, "%s.png", o->name ? o->name : "model");
            r2d_sb_puts(&js, "{\"version\":1,\"atlas\":");
            r2d_sb_put_json_string(&js, atlas);
            r2d_sb_puts(&js, ",\"style\":\"anime\",\"rig\":{\"bones\":[");
            int emitted = 0;
            for (int i = 0; i < s.nbones; ++i) {
                r2d_sb_printf(&js, "%s{\"name\":", emitted++ ? "," : "");
                r2d_sb_put_json_string(&js, s.bones[i].name);
                r2d_sb_puts(&js, ",\"pivot\":[0,0,0]}");
            }
            r2d_sb_puts(&js, "],\"parts\":[");
            for (int i = 0; i < s.nbones; ++i) {
                r2d_sb_printf(&js, "%s{\"id\":%d,\"bone\":", i ? "," : "", i + 1);
                r2d_sb_put_json_string(&js, s.bones[i].name);
                r2d_sb_putc(&js, '}');
            }
            r2d_sb_printf(&js, "],\"joints\":[],\"sockets\":[]},\"groups\":{},\"defaults\":{\"body\":true},\"projection\":{\"bodyScale\":%.5g,\"portraitScale\":2,\"extent\":%d,\"v3\":true", o->zoom > 0 ? o->zoom : 1.0, o->extent);
            if (o->raster) r2d_sb_printf(&js, ",\"raster\":%d", o->raster);
            if (o->has_window) r2d_sb_printf(&js, ",\"window\":[%.4g,%.4g,%.4g,%.4g]", o->window[0], o->window[1], o->window[2], o->window[3]);
            if (o->cull) r2d_sb_puts(&js, ",\"cull\":true");
            if (o->motion_lod) r2d_sb_printf(&js, ",\"motionLod\":%d", o->motion_lod);
            if (o->detail > 0) r2d_sb_printf(&js, ",\"detail\":%.4g", o->detail);
            if (o->has_eye) {
                float e[3];
                frame_apply(&bk.f, o->eye, e);
                r2d_sb_printf(&js, ",\"eye\":[%.4g,%.4g,%.4g]", e[0], e[1], e[2]);
            }
            r2d_sb_putc(&js, '}');
            if (clips) {
                char animfile[300];
                snprintf(animfile, sizeof animfile, "%s.animations.json", o->name ? o->name : "model");
                r2d_sb_puts(&js, ",\"animations\":");
                r2d_sb_put_json_string(&js, animfile);
            }
            r2d_sb_puts(&js, "}\n");
            if (!sdk_write_file(json_path, js.data, js.len)) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_WRITE_FAILED", json_path, NULL, NULL, "Не удалось записать character.json");
                ok = false;
            }
            r2d_sb_free(&js);
        }
    }
    r2d_sb_init(report);
    r2d_sb_printf(report, "{\"success\":%s,\"ok\":%s,\"format\":\"v3\",\"source\":{\"triangles\":%d,\"materials\":%d,\"textures\":%d,\"bones\":%d},"
                  "\"grid\":%d,\"texels\":%ld,\"coverage\":%.4f,\"marginTexels\":%ld,\"uvOverlaps\":%ld,\"bonesUsed\":%ld,\"clips\":%d,\"extent\":%d,",
                  ok ? "true" : "false", ok ? "true" : "false", s.ntri, s.nmat, s.ntex, s.nbones, o->grid, used,
                  o->grid ? (double)used / ((double)o->grid * o->grid) : 0.0, bk.margin_texels, bk.overlaps, bones_used, clips, o->extent);
    r2d_sb_printf(report, "\"scale\":%.6g,\"files\":{\"png\":", bk.f.L[0]);
    r2d_sb_put_json_string(report, png_path);
    r2d_sb_puts(report, ",\"character\":");
    r2d_sb_put_json_string(report, json_path);
    r2d_sb_puts(report, ",\"animations\":");
    r2d_sb_put_json_string(report, clips ? anim_path : "");
    r2d_sb_puts(report, "},");
    sdk_report_put_counts(rep, report);
    r2d_sb_putc(report, ',');
    sdk_report_put(rep, report);
    r2d_sb_puts(report, "}\n");
    if (ok && rep_path[0]) sdk_write_file(rep_path, report->data, report->len);
    free(bk.texels);
    free(bk.mdist);
    free(bk.rect);
    for (int i = 0; i < s.ntex; ++i) sdk_image_free(s.texs[i].px);
    free(s.texs);
    free(s.tris);
    free(s.mats);
    free(s.bones);
    return ok;
}

int sdk_cmd_bake_re2d3(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *source = sdk_arg_positional(a, 0);
    if (!source) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk bake-re2d3 <модель.fbx|.glb|.gltf|.obj> --output <каталог> [--name имя] [--grid 512..2048] [--extent N] [--scale S] [--fit 0.94] "
            "[--pivot x,y,z] [--eye x,y,z] [--zoom k] [--raster N] [--window x0,y0,x1,y1] [--cull] [--motion-lod 0..4] [--detail 0.25..8] [--fbx-tint имя=#rrggbb,…] [--fbx-ao имя=файл.png,…] [--fbx-spec имя=0..1,…] [--tiles имя=вес,…] [--clips имя=клип[:l],…] [--fps 30] [--normal-flip-y]");
        sdk_report_free(&rep);
        return rc;
    }
    B3Options o;
    default_b3(&o);
    const char *v;
    const char *out_dir = sdk_arg_value(a, "--output");
    if (!out_dir) out_dir = sdk_arg_value(a, "--out");
    char dir_buf[1024];
    if (!out_dir) { sdk_dirname(source, dir_buf, sizeof dir_buf); out_dir = dir_buf; }
    if ((v = sdk_arg_value(a, "--name"))) o.name = v;
    else {
        static char nm[128];
        snprintf(nm, sizeof nm, "%s", sdk_basename(source));
        char *dot = strrchr(nm, '.');
        if (dot) *dot = 0;
        o.name = nm;
    }
    if ((v = sdk_arg_value(a, "--grid"))) o.grid = atoi(v);
    if ((v = sdk_arg_value(a, "--extent"))) o.extent = atoi(v);
    if ((v = sdk_arg_value(a, "--scale"))) o.scale = (float)atof(v);
    if ((v = sdk_arg_value(a, "--fit"))) o.fit = (float)atof(v);
    if ((v = sdk_arg_value(a, "--fps"))) o.fps = (float)atof(v);
    o.tint = sdk_arg_value(a, "--fbx-tint");
    o.ao = sdk_arg_value(a, "--fbx-ao");
    o.spec = sdk_arg_value(a, "--fbx-spec");
    o.clips = sdk_arg_value(a, "--clips");
    o.tiles = sdk_arg_value(a, "--tiles");
    o.normal_flip_y = sdk_arg_flag(a, "--normal-flip-y");
    if ((v = sdk_arg_value(a, "--zoom"))) o.zoom = (float)atof(v);
    if ((v = sdk_arg_value(a, "--raster"))) o.raster = atoi(v);
    if ((v = sdk_arg_value(a, "--motion-lod"))) o.motion_lod = atoi(v);
    if ((v = sdk_arg_value(a, "--detail"))) o.detail = (float)atof(v);
    o.cull = sdk_arg_flag(a, "--cull");
    if ((v = sdk_arg_value(a, "--window"))) {
        if (sscanf(v, "%f,%f,%f,%f", &o.window[0], &o.window[1], &o.window[2], &o.window[3]) != 4 || !(o.window[0] >= 0 && o.window[1] >= 0 && o.window[2] <= 1 && o.window[3] <= 1 && o.window[2] > o.window[0] && o.window[3] > o.window[1])) {
            const int rc = sdk_fail(&rep, "SDK_BAKE_OPTIONS", "--window: x0,y0,x1,y1 в долях 0..1, x1>x0 и y1>y0");
            sdk_report_free(&rep);
            return rc;
        }
        o.has_window = true;
    }
    if ((v = sdk_arg_value(a, "--eye"))) {
        if (sscanf(v, "%f,%f,%f", &o.eye[0], &o.eye[1], &o.eye[2]) != 3) {
            const int rc = sdk_fail(&rep, "SDK_BAKE_OPTIONS", "--eye: три числа через запятую x,y,z (метры исходной модели)");
            sdk_report_free(&rep);
            return rc;
        }
        o.has_eye = true;
    }
    if ((v = sdk_arg_value(a, "--pivot"))) {
        if (sscanf(v, "%f,%f,%f", &o.pivot[0], &o.pivot[1], &o.pivot[2]) != 3) {
            const int rc = sdk_fail(&rep, "SDK_BAKE_OPTIONS", "--pivot: три числа через запятую x,y,z");
            sdk_report_free(&rep);
            return rc;
        }
        o.has_pivot = true;
    }
    if (o.grid < 256 || o.grid > 2048 || o.extent < 16 || o.extent > 250 || !(o.fit > .1f && o.fit <= 1) || o.scale < 0 || !(o.fps >= 1 && o.fps <= 120) ||
        o.zoom < 0 || o.zoom > 8 || (o.raster && (o.raster < 128 || o.raster > 2048)) || o.motion_lod < 0 || o.motion_lod > 4 || (o.detail != 0 && !(o.detail >= .25f && o.detail <= 8))) {
        const int rc = sdk_fail(&rep, "SDK_BAKE_OPTIONS", "Недопустимые опции: grid 256..2048, extent 16..250, fit 0.1..1, scale>=0, fps 1..120, zoom 0..8, raster 128..2048, motion-lod 0..4, detail 0.25..8");
        sdk_report_free(&rep);
        return rc;
    }
    R2dSb report;
    const bool ok = bake3(source, out_dir, &o, &rep, &report);
    fputs(report.data, stdout);
    fflush(stdout);
    r2d_sb_free(&report);
    sdk_report_free(&rep);
    return ok ? 0 : 1;
}
