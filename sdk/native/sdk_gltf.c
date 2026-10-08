// ===========================================================================
// Загрузчик GLB/glTF 2.0 для Re2D Baker: меши → треугольники в мировых
// координатах, материалы, текстуры baseColor.
//
// Поддержано: GLB и .gltf (внешние .bin и data:-URI), иерархия узлов (матрицы
// и TRS), TRIANGLES/STRIP/FAN, индексы u8/u16/u32, POSITION/TEXCOORD_0 с
// нормализованными целыми и byteStride, baseColorFactor/baseColorTexture,
// alphaMode. Не поддержано (и сообщается кодом): sparse-аксессоры, Draco,
// meshopt, KHR_texture_basisu. Скины (JOINTS_0/WEIGHTS_0 + inverseBind) дают позу, VRM 0.x/1.0 — humanoid и выражения; анимации не переносятся.
// ===========================================================================
#include "sdk_bake.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Buf {
    uint8_t *data;
    size_t   size;
    bool     owned;
} Buf;

typedef struct Gltf {
    R2dJson   *root;
    Buf       *bufs;
    int        nbuf;
    char       dir[1024];
    const char *path;
    SdkReport *rep;
    uint8_t   *glb_bin;
    size_t     glb_bin_size;
    int       *tex_loaded;        // кэш: индекс текстуры glTF → индекс в scene->texs (-2 не пробовали, -1 ошибка)
    BkScene   *scene;
    int        depth;
    float    **skin_jm;           // на скин: матрицы суставов (мир * inverseBind), 16 float на сустав
    int        cur_node, cur_skin;
} Gltf;

// ---------------------------------------------------------------------------
// Base64 для data:-URI
// ---------------------------------------------------------------------------
static int b64v(int c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+' || c == '-') return 62;
    if (c == '/' || c == '_') return 63;
    return -1;
}

static uint8_t *b64_decode(const char *s, size_t len, size_t *out_len)
{
    uint8_t *out = (uint8_t *)malloc(len / 4 * 3 + 4);
    if (!out) return NULL;
    size_t n = 0;
    int acc = 0, bits = 0;
    for (size_t i = 0; i < len; ++i) {
        if (s[i] == '=') break;
        const int v = b64v((unsigned char)s[i]);
        if (v < 0) continue;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[n++] = (uint8_t)((acc >> bits) & 0xff);
        }
    }
    *out_len = n;
    return out;
}

// Читает URI: data: или файл рядом. Возвращает malloc'нутые байты.
static uint8_t *read_uri(Gltf *g, const char *uri, size_t *size)
{
    if (strncmp(uri, "data:", 5) == 0) {
        const char *comma = strchr(uri, ',');
        if (!comma) return NULL;
        return b64_decode(comma + 1, strlen(comma + 1), size);
    }
    // Процентное кодирование в путях (пробел → %20).
    char decoded[1024];
    size_t di = 0;
    for (size_t i = 0; uri[i] && di < sizeof decoded - 1; ++i) {
        if (uri[i] == '%' && isxdigit((unsigned char)uri[i + 1]) && isxdigit((unsigned char)uri[i + 2])) {
            char hex[3] = { uri[i + 1], uri[i + 2], 0 };
            decoded[di++] = (char)strtol(hex, NULL, 16);
            i += 2;
        } else {
            decoded[di++] = uri[i];
        }
    }
    decoded[di] = '\0';
    char full[2048];
    sdk_join(g->dir, decoded, full, sizeof full);
    size_t n = 0;
    char *data = sdk_read_file(full, &n);
    if (!data) return NULL;
    *size = n;
    return (uint8_t *)data;
}

// ---------------------------------------------------------------------------
// Матрицы 4×4 (столбцы, как в glTF)
// ---------------------------------------------------------------------------
typedef struct M4 { float m[16]; } M4;

static M4 m4_identity(void)
{
    M4 r;
    memset(&r, 0, sizeof r);
    r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1;
    return r;
}

static M4 m4_mul(M4 a, M4 b)
{
    M4 r;
    for (int c = 0; c < 4; ++c) {
        for (int row = 0; row < 4; ++row) {
            float s = 0;
            for (int k = 0; k < 4; ++k) s += a.m[k * 4 + row] * b.m[c * 4 + k];
            r.m[c * 4 + row] = s;
        }
    }
    return r;
}

static M4 node_matrix(const R2dJson *node)
{
    const R2dJson *mat = r2d_json_get(node, "matrix");
    if (mat && mat->type == R2D_JSON_ARR && mat->count == 16) {
        M4 r;
        for (int i = 0; i < 16; ++i) r.m[i] = (float)r2d_json_num(mat->items[i], i % 5 == 0 ? 1 : 0);
        return r;
    }
    float t[3] = { 0, 0, 0 }, s[3] = { 1, 1, 1 }, q[4] = { 0, 0, 0, 1 };
    const R2dJson *jt = r2d_json_get(node, "translation"), *js = r2d_json_get(node, "scale"), *jq = r2d_json_get(node, "rotation");
    for (int i = 0; i < 3; ++i) {
        if (jt && jt->type == R2D_JSON_ARR && jt->count == 3) t[i] = (float)r2d_json_num(jt->items[i], 0);
        if (js && js->type == R2D_JSON_ARR && js->count == 3) s[i] = (float)r2d_json_num(js->items[i], 1);
    }
    for (int i = 0; i < 4; ++i) if (jq && jq->type == R2D_JSON_ARR && jq->count == 4) q[i] = (float)r2d_json_num(jq->items[i], i == 3 ? 1 : 0);
    const float n = sqrtf(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (n > 0) for (int i = 0; i < 4; ++i) q[i] /= n;
    const float x = q[0], y = q[1], z = q[2], w = q[3];
    M4 r = m4_identity();
    r.m[0] = (1 - 2 * (y * y + z * z)) * s[0]; r.m[1] = (2 * (x * y + z * w)) * s[0];     r.m[2] = (2 * (x * z - y * w)) * s[0];
    r.m[4] = (2 * (x * y - z * w)) * s[1];     r.m[5] = (1 - 2 * (x * x + z * z)) * s[1]; r.m[6] = (2 * (y * z + x * w)) * s[1];
    r.m[8] = (2 * (x * z + y * w)) * s[2];     r.m[9] = (2 * (y * z - x * w)) * s[2];     r.m[10] = (1 - 2 * (x * x + y * y)) * s[2];
    r.m[12] = t[0]; r.m[13] = t[1]; r.m[14] = t[2];
    return r;
}

static void m4_point(const M4 *m, const float *p, float *out)
{
    for (int r = 0; r < 3; ++r) out[r] = m->m[r] * p[0] + m->m[4 + r] * p[1] + m->m[8 + r] * p[2] + m->m[12 + r];
}

// ---------------------------------------------------------------------------
// Аксессоры
// ---------------------------------------------------------------------------
typedef struct AccView {
    const uint8_t *base;
    int  comps, ctype, count;
    size_t stride;
    bool normalized;
} AccView;

static int comp_size(int ctype)
{
    switch (ctype) {
    case 5120: case 5121: return 1;
    case 5122: case 5123: return 2;
    case 5125: case 5126: return 4;
    }
    return 0;
}

static int type_comps(const char *t)
{
    if (!strcmp(t, "SCALAR")) return 1;
    if (!strcmp(t, "VEC2")) return 2;
    if (!strcmp(t, "VEC3")) return 3;
    if (!strcmp(t, "VEC4")) return 4;
    if (!strcmp(t, "MAT4")) return 16;
    return 0;
}

static bool acc_view(Gltf *g, int index, AccView *v, const char *what)
{
    const R2dJson *accs = r2d_json_get(g->root, "accessors");
    const R2dJson *views = r2d_json_get(g->root, "bufferViews");
    const R2dJson *a = r2d_json_at(accs, index);
    char loc[96];
    snprintf(loc, sizeof loc, "{\"accessor\":%d}", index);
    if (!a || a->type != R2D_JSON_OBJ) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_ACCESSOR", g->path, loc, NULL, "%s: аксессор %d не существует", what, index);
        return false;
    }
    if (r2d_json_get(a, "sparse")) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_SPARSE_UNSUPPORTED", g->path, loc, NULL, "%s: sparse-аксессоры не поддерживаются", what);
        return false;
    }
    v->ctype = r2d_json_int(r2d_json_get(a, "componentType"), 0);
    v->count = r2d_json_int(r2d_json_get(a, "count"), 0);
    v->comps = type_comps(r2d_json_str(r2d_json_get(a, "type"), ""));
    v->normalized = r2d_json_bool(r2d_json_get(a, "normalized"), false);
    const int csz = comp_size(v->ctype);
    if (!csz || !v->comps || v->count < 0) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_ACCESSOR", g->path, loc, NULL, "%s: аксессор %d с неверным типом/размером", what, index);
        return false;
    }
    const int bv = r2d_json_int(r2d_json_get(a, "bufferView"), -1);
    const R2dJson *view = r2d_json_at(views, bv);
    if (!view) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_ACCESSOR", g->path, loc, NULL, "%s: у аксессора %d нет bufferView", what, index);
        return false;
    }
    const int buf = r2d_json_int(r2d_json_get(view, "buffer"), -1);
    if (buf < 0 || buf >= g->nbuf || !g->bufs[buf].data) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_BUFFER_MISSING", g->path, loc, NULL, "%s: буфер %d недоступен", what, buf);
        return false;
    }
    const size_t off = (size_t)r2d_json_num(r2d_json_get(view, "byteOffset"), 0) + (size_t)r2d_json_num(r2d_json_get(a, "byteOffset"), 0);
    size_t stride = (size_t)r2d_json_int(r2d_json_get(view, "byteStride"), 0);
    const size_t elem = (size_t)csz * (size_t)v->comps;
    if (stride == 0) stride = elem;
    if (v->count > 0 && off + stride * (size_t)(v->count - 1) + elem > g->bufs[buf].size) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_ACCESSOR_RANGE", g->path, loc, NULL,
                 "%s: аксессор %d выходит за пределы буфера (смещение %zu, %d элементов)", what, index, off, v->count);
        return false;
    }
    v->base = g->bufs[buf].data + off;
    v->stride = stride;
    return true;
}

static float acc_float(const AccView *v, int i, int c)
{
    const uint8_t *p = v->base + (size_t)i * v->stride + (size_t)c * (size_t)comp_size(v->ctype);
    switch (v->ctype) {
    case 5126: { float f; memcpy(&f, p, 4); return f; }
    case 5120: { int8_t x = (int8_t)*p; return v->normalized ? fmaxf(x / 127.0f, -1.0f) : (float)x; }
    case 5121: return v->normalized ? *p / 255.0f : (float)*p;
    case 5122: { int16_t x; memcpy(&x, p, 2); return v->normalized ? fmaxf(x / 32767.0f, -1.0f) : (float)x; }
    case 5123: { uint16_t x; memcpy(&x, p, 2); return v->normalized ? x / 65535.0f : (float)x; }
    case 5125: { uint32_t x; memcpy(&x, p, 4); return (float)x; }
    }
    return 0;
}

static uint32_t acc_index(const AccView *v, int i)
{
    const uint8_t *p = v->base + (size_t)i * v->stride;
    switch (v->ctype) {
    case 5121: return *p;
    case 5123: { uint16_t x; memcpy(&x, p, 2); return x; }
    case 5125: { uint32_t x; memcpy(&x, p, 4); return x; }
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Материалы и текстуры
// ---------------------------------------------------------------------------
static int load_texture(Gltf *g, int tex_index)
{
    if (tex_index < 0) return -1;
    const R2dJson *textures = r2d_json_get(g->root, "textures");
    if (tex_index >= r2d_json_size(textures)) return -1;
    if (g->tex_loaded[tex_index] != -2) return g->tex_loaded[tex_index];
    g->tex_loaded[tex_index] = -1;

    const R2dJson *t = r2d_json_at(textures, tex_index);
    const R2dJson *images = r2d_json_get(g->root, "images");
    const int src = r2d_json_int(r2d_json_get(t, "source"), -1);
    const R2dJson *img = r2d_json_at(images, src);
    char loc[96];
    snprintf(loc, sizeof loc, "{\"texture\":%d}", tex_index);
    if (!img) {
        const R2dJson *ext = r2d_json_get(t, "extensions");
        if (ext && (r2d_json_get(ext, "KHR_texture_basisu") || r2d_json_get(ext, "EXT_texture_webp"))) {
            sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_EXTENSION_UNSUPPORTED", g->path, loc, NULL,
                     "Текстура %d использует KHR_texture_basisu/webp — поддержаны PNG и JPEG", tex_index);
        } else {
            sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_TEXTURE_MISSING", g->path, loc, NULL, "У текстуры %d нет изображения", tex_index);
        }
        return -1;
    }
    uint8_t *bytes = NULL;
    size_t size = 0;
    bool owned = false;
    const char *uri = r2d_json_str(r2d_json_get(img, "uri"), NULL);
    if (uri) {
        bytes = read_uri(g, uri, &size);
        owned = true;
        if (!bytes) {
            sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_TEXTURE_MISSING", g->path, loc, NULL, "Изображение «%s» не найдено рядом с моделью", uri);
            return -1;
        }
    } else {
        const R2dJson *view = r2d_json_at(r2d_json_get(g->root, "bufferViews"), r2d_json_int(r2d_json_get(img, "bufferView"), -1));
        const int buf = r2d_json_int(r2d_json_get(view, "buffer"), -1);
        const size_t off = (size_t)r2d_json_num(r2d_json_get(view, "byteOffset"), 0);
        const size_t len = (size_t)r2d_json_num(r2d_json_get(view, "byteLength"), 0);
        if (!view || buf < 0 || buf >= g->nbuf || !g->bufs[buf].data || off + len > g->bufs[buf].size) {
            sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_TEXTURE_MISSING", g->path, loc, NULL, "Встроенное изображение %d повреждено", src);
            return -1;
        }
        bytes = g->bufs[buf].data + off;
        size = len;
    }
    // stb читает из памяти: пишем во временный файл не нужно — используем загрузку из буфера.
    int w = 0, h = 0;
    uint8_t *px = sdk_image_load_rgba_mem(bytes, size, &w, &h);
    if (owned) free(bytes);
    if (!px) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_IMAGE_FORMAT", g->path, loc, NULL, "Изображение %d не читается (нужны PNG/JPEG/BMP)", src);
        return -1;
    }
    BkScene *s = g->scene;
    s->texs = (BkTexture *)realloc(s->texs, (size_t)(s->ntex + 1) * sizeof(BkTexture));
    s->texs[s->ntex].px = px;
    s->texs[s->ntex].w = w;
    s->texs[s->ntex].h = h;
    g->tex_loaded[tex_index] = s->ntex;
    return s->ntex++;
}

static void load_materials(Gltf *g)
{
    const R2dJson *mats = r2d_json_get(g->root, "materials");
    const int n = r2d_json_size(mats);
    BkScene *s = g->scene;
    s->nmat = n + 1;                                  // +1: материал по умолчанию
    s->mats = (BkMaterial *)calloc((size_t)s->nmat, sizeof(BkMaterial));
    for (int i = 0; i < n; ++i) {
        BkMaterial *m = &s->mats[i];
        const R2dJson *jm = mats->items[i];
        snprintf(m->name, sizeof m->name, "%s", r2d_json_str(r2d_json_get(jm, "name"), ""));
        if (!m->name[0]) snprintf(m->name, sizeof m->name, "material%d", i);
        m->base[0] = m->base[1] = m->base[2] = m->base[3] = 1.0f;
        m->tex = -1;
        const R2dJson *pbr = r2d_json_get(jm, "pbrMetallicRoughness");
        const R2dJson *bc = r2d_json_get(pbr, "baseColorFactor");
        for (int c = 0; bc && bc->type == R2D_JSON_ARR && c < 4 && c < bc->count; ++c) m->base[c] = (float)r2d_json_num(bc->items[c], 1);
        const R2dJson *bt = r2d_json_get(pbr, "baseColorTexture");
        if (bt) {
            m->tex_coord = r2d_json_int(r2d_json_get(bt, "texCoord"), 0);
            m->tex = load_texture(g, r2d_json_int(r2d_json_get(bt, "index"), -1));
            if (m->tex_coord != 0) {
                char loc[64];
                snprintf(loc, sizeof loc, "{\"material\":%d}", i);
                sdk_diag(g->rep, SDK_WARNING, "SDK_BAKE_TEXCOORD_UNSUPPORTED", g->path, loc, NULL,
                         "Материал «%s»: texCoord %d не поддержан — текстура игнорируется", m->name, m->tex_coord);
                m->tex = -1;
            }
            const R2dJson *ext = r2d_json_get(bt, "extensions");
            if (ext && r2d_json_get(ext, "KHR_texture_transform")) {
                char loc[64];
                snprintf(loc, sizeof loc, "{\"material\":%d}", i);
                sdk_diag(g->rep, SDK_WARNING, "SDK_BAKE_TEXTURE_TRANSFORM", g->path, loc, NULL,
                         "Материал «%s»: KHR_texture_transform игнорируется — UV читаются как есть", m->name);
            }
        }
        const char *am = r2d_json_str(r2d_json_get(jm, "alphaMode"), "OPAQUE");
        m->alpha = !strcmp(am, "MASK") ? BK_ALPHA_MASK : !strcmp(am, "BLEND") ? BK_ALPHA_BLEND : BK_ALPHA_OPAQUE;
        m->cutoff = (float)r2d_json_num(r2d_json_get(jm, "alphaCutoff"), 0.5);
    }
    BkMaterial *d = &s->mats[n];
    snprintf(d->name, sizeof d->name, "default");
    d->base[0] = d->base[1] = d->base[2] = 0.8f;
    d->base[3] = 1.0f;
    d->tex = -1;
    d->cutoff = 0.5f;
}

// ---------------------------------------------------------------------------
// Меши
// ---------------------------------------------------------------------------
static BkTri *push_tri(BkScene *s, const float p[3][3], const float uv[3][2], bool has_uv, int material)
{
    if (s->ntri == s->cap) {
        const int cap = s->cap ? s->cap * 2 : 1024;
        BkTri *t = (BkTri *)realloc(s->tris, (size_t)cap * sizeof(BkTri));
        if (!t) return NULL;
        s->tris = t;
        s->cap = cap;
    }
    BkTri *t = &s->tris[s->ntri++];
    memset(t, 0, sizeof *t);
    t->skin = -1;
    memcpy(t->p, p, sizeof t->p);
    if (has_uv) memcpy(t->uv, uv, sizeof t->uv);
    else memset(t->uv, 0, sizeof t->uv);
    t->has_uv = has_uv;
    t->material = material;
    return t;
}

static void load_primitive(Gltf *g, const R2dJson *prim, const M4 *xf, int mesh_index, int prim_index)
{
    char loc[96];
    snprintf(loc, sizeof loc, "{\"mesh\":%d,\"primitive\":%d}", mesh_index, prim_index);
    const int mode = r2d_json_int(r2d_json_get(prim, "mode"), 4);
    BkScene *s = g->scene;
    if (mode != 4 && mode != 5 && mode != 6) {
        s->primitives_skipped++;
        sdk_diag(g->rep, SDK_WARNING, "SDK_BAKE_MODE_UNSUPPORTED", g->path, loc, NULL,
                 "Примитив %d меша %d: режим %d (точки/линии) пропущен", prim_index, mesh_index, mode);
        return;
    }
    const R2dJson *attrs = r2d_json_get(prim, "attributes");
    const R2dJson *ext = r2d_json_get(prim, "extensions");
    if (ext && (r2d_json_get(ext, "KHR_draco_mesh_compression") || r2d_json_get(ext, "EXT_meshopt_compression"))) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_EXTENSION_UNSUPPORTED", g->path, loc, NULL,
                 "Примитив %d меша %d сжат Draco/meshopt: распакуйте модель при экспорте", prim_index, mesh_index);
        return;
    }
    AccView pos;
    if (!attrs || r2d_json_get(attrs, "POSITION") == NULL) {
        sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_NO_POSITION", g->path, loc, NULL, "Примитив %d меша %d без POSITION", prim_index, mesh_index);
        return;
    }
    if (!acc_view(g, r2d_json_int(r2d_json_get(attrs, "POSITION"), -1), &pos, "POSITION") || pos.comps != 3) return;
    AccView uvv;
    bool has_uv = false;
    if (r2d_json_get(attrs, "TEXCOORD_0")) {
        has_uv = acc_view(g, r2d_json_int(r2d_json_get(attrs, "TEXCOORD_0"), -1), &uvv, "TEXCOORD_0") && uvv.comps == 2 && uvv.count == pos.count;
    }
    AccView idx;
    const bool indexed = r2d_json_get(prim, "indices") != NULL;
    if (indexed && !acc_view(g, r2d_json_int(r2d_json_get(prim, "indices"), -1), &idx, "indices")) return;
    const int n = indexed ? idx.count : pos.count;
    int material = r2d_json_int(r2d_json_get(prim, "material"), -1);
    if (material < 0 || material >= s->nmat - 1) material = s->nmat - 1;

    // Скининг: JOINTS_0/WEIGHTS_0 + матрицы суставов скина узла.
    AccView jv, wv;
    bool skinned = false;
    const BkSkin *sk = (g->cur_skin >= 0 && g->cur_skin < s->nskin) ? &s->skin_list[g->cur_skin] : NULL;
    if (sk && g->skin_jm && g->skin_jm[g->cur_skin] && r2d_json_get(attrs, "JOINTS_0") && r2d_json_get(attrs, "WEIGHTS_0")) {
        skinned = acc_view(g, r2d_json_int(r2d_json_get(attrs, "JOINTS_0"), -1), &jv, "JOINTS_0") && jv.comps == 4 && jv.count == pos.count &&
                  acc_view(g, r2d_json_int(r2d_json_get(attrs, "WEIGHTS_0"), -1), &wv, "WEIGHTS_0") && wv.comps == 4 && wv.count == pos.count;
        if (!skinned) {
            sdk_diag(g->rep, SDK_WARNING, "SDK_BAKE_SKIN_ATTRS", g->path, loc, NULL,
                     "Примитив %d меша %d: JOINTS_0/WEIGHTS_0 не читаются — геометрия берётся без скининга", prim_index, mesh_index);
        }
    }
    // Вершины → мировые координаты.
    float *wp = (float *)malloc((size_t)pos.count * 3 * sizeof(float));
    uint16_t (*vj)[4] = skinned ? (uint16_t (*)[4])malloc((size_t)pos.count * sizeof *vj) : NULL;
    float (*vw)[4] = skinned ? (float (*)[4])malloc((size_t)pos.count * sizeof *vw) : NULL;
    for (int i = 0; i < pos.count; ++i) {
        const float p[3] = { acc_float(&pos, i, 0), acc_float(&pos, i, 1), acc_float(&pos, i, 2) };
        if (!skinned) { m4_point(xf, p, wp + i * 3); continue; }
        float wsum = 0, acc[3] = { 0, 0, 0 };
        for (int k = 0; k < 4; ++k) {
            const int ji = (int)acc_float(&jv, i, k);
            vj[i][k] = (uint16_t)(ji >= 0 && ji < sk->n ? ji : 0);
            vw[i][k] = ji >= 0 && ji < sk->n ? fmaxf(acc_float(&wv, i, k), 0.0f) : 0.0f;
            wsum += vw[i][k];
        }
        for (int k = 0; k < 4; ++k) {
            if (wsum > 0) vw[i][k] /= wsum;
            if (vw[i][k] <= 0) continue;
            M4 jm;
            memcpy(jm.m, g->skin_jm[g->cur_skin] + (size_t)vj[i][k] * 16, sizeof jm.m);
            float q[3];
            m4_point(&jm, p, q);
            for (int c = 0; c < 3; ++c) acc[c] += vw[i][k] * q[c];
        }
        if (wsum <= 0) m4_point(xf, p, acc);
        memcpy(wp + i * 3, acc, sizeof acc);
    }
    const int tri_count = mode == 4 ? n / 3 : (n >= 3 ? n - 2 : 0);
    for (int t = 0; t < tri_count; ++t) {
        uint32_t vi[3];
        if (mode == 4) { vi[0] = 3 * t; vi[1] = 3 * t + 1; vi[2] = 3 * t + 2; }
        else if (mode == 5) {                              // STRIP: чётность меняет обход
            vi[0] = t; vi[1] = (t & 1) ? t + 2 : t + 1; vi[2] = (t & 1) ? t + 1 : t + 2;
        } else { vi[0] = 0; vi[1] = t + 1; vi[2] = t + 2; } // FAN
        if (indexed) for (int k = 0; k < 3; ++k) vi[k] = acc_index(&idx, (int)vi[k]);
        bool bad = false;
        for (int k = 0; k < 3; ++k) bad = bad || vi[k] >= (uint32_t)pos.count;
        if (bad) {
            sdk_diag(g->rep, SDK_ERROR, "SDK_BAKE_INDEX_RANGE", g->path, loc, NULL,
                     "Примитив %d меша %d: индекс вершины вне 0..%d", prim_index, mesh_index, pos.count - 1);
            free(wp);
            free(vj);
            free(vw);
            return;
        }
        float p[3][3], uv[3][2];
        for (int k = 0; k < 3; ++k) {
            memcpy(p[k], wp + vi[k] * 3, sizeof p[k]);
            if (has_uv) { uv[k][0] = acc_float(&uvv, (int)vi[k], 0); uv[k][1] = acc_float(&uvv, (int)vi[k], 1); }
        }
        BkTri *nt = push_tri(s, p, uv, has_uv, material);
        if (!nt) continue;
        nt->node = g->cur_node;
        nt->skin = skinned ? g->cur_skin : -1;
        nt->skinned = skinned;
        if (skinned) {
            for (int k = 0; k < 3; ++k) {
                memcpy(nt->j[k], vj[vi[k]], sizeof nt->j[k]);
                memcpy(nt->w[k], vw[vi[k]], sizeof nt->w[k]);
            }
        }
    }
    free(wp);
    free(vj);
    free(vw);
}

// Мировые матрицы и иерархия всех узлов (до загрузки мешей: скинам нужны суставы).
static void fill_worlds(Gltf *g, int node_index, M4 parent, int parent_index)
{
    const R2dJson *nodes = r2d_json_get(g->root, "nodes");
    const R2dJson *node = r2d_json_at(nodes, node_index);
    if (!node || node_index < 0 || node_index >= g->scene->nnode || ++g->depth > 64) { if (node) g->depth--; return; }
    BkNode *bn = &g->scene->nodes[node_index];
    const M4 world = m4_mul(parent, node_matrix(node));
    bn->parent = parent_index;
    memcpy(bn->world, world.m, sizeof bn->world);
    bn->pos[0] = world.m[12]; bn->pos[1] = world.m[13]; bn->pos[2] = world.m[14];
    const R2dJson *children = r2d_json_get(node, "children");
    for (int i = 0; children && i < children->count; ++i) fill_worlds(g, r2d_json_int(children->items[i], -1), world, node_index);
    g->depth--;
}

static void walk_node(Gltf *g, int node_index, M4 parent)
{
    const R2dJson *nodes = r2d_json_get(g->root, "nodes");
    const R2dJson *node = r2d_json_at(nodes, node_index);
    if (!node || ++g->depth > 64) { if (node) g->depth--; return; }
    const M4 world = m4_mul(parent, node_matrix(node));
    const int mesh = r2d_json_int(r2d_json_get(node, "mesh"), -1);
    if (mesh >= 0) {
        const R2dJson *m = r2d_json_at(r2d_json_get(g->root, "meshes"), mesh);
        const R2dJson *prims = r2d_json_get(m, "primitives");
        g->scene->meshes++;
        g->cur_node = node_index;
        g->cur_skin = r2d_json_int(r2d_json_get(node, "skin"), -1);
        for (int i = 0; prims && i < prims->count; ++i) load_primitive(g, prims->items[i], &world, mesh, i);
        g->cur_skin = -1;
    }
    if (r2d_json_get(node, "skin")) g->scene->skins++;
    const R2dJson *children = r2d_json_get(node, "children");
    for (int i = 0; children && i < children->count; ++i) walk_node(g, r2d_json_int(children->items[i], -1), world);
    g->depth--;
}

static void load_skins(Gltf *g)
{
    BkScene *s = g->scene;
    const R2dJson *skins = r2d_json_get(g->root, "skins");
    s->nskin = r2d_json_size(skins);
    if (!s->nskin) return;
    s->skin_list = (BkSkin *)calloc((size_t)s->nskin, sizeof(BkSkin));
    g->skin_jm = (float **)calloc((size_t)s->nskin, sizeof(float *));
    for (int i = 0; i < s->nskin; ++i) {
        const R2dJson *joints = r2d_json_get(skins->items[i], "joints");
        const int n = r2d_json_size(joints);
        s->skin_list[i].n = n;
        s->skin_list[i].joints = (int *)calloc((size_t)(n ? n : 1), sizeof(int));
        g->skin_jm[i] = (float *)calloc((size_t)(n ? n : 1) * 16, sizeof(float));
        AccView ibm;
        bool have = false;
        const int ia = r2d_json_int(r2d_json_get(skins->items[i], "inverseBindMatrices"), -1);
        if (ia >= 0) have = acc_view(g, ia, &ibm, "inverseBindMatrices") && ibm.comps == 16 && ibm.count >= n;
        for (int k = 0; k < n; ++k) {
            const int node = r2d_json_int(joints->items[k], -1);
            s->skin_list[i].joints[k] = node;
            M4 w = m4_identity();
            if (node >= 0 && node < s->nnode) memcpy(w.m, s->nodes[node].world, sizeof w.m);
            M4 inv = m4_identity();
            if (have) for (int c = 0; c < 16; ++c) inv.m[c] = acc_float(&ibm, k, c);
            const M4 jm = m4_mul(w, inv);
            memcpy(g->skin_jm[i] + (size_t)k * 16, jm.m, sizeof jm.m);
        }
    }
}

static void copy_str(char *dst, size_t cap, const char *src)
{
    snprintf(dst, cap, "%s", src ? src : "");
}

// VRM 0.x: extensions.VRM; VRM 1.0: extensions.VRMC_vrm. Кости — humanoid, выражения — пресеты.
static void add_vrm_bone(BkScene *s, const char *bone, int node)
{
    BkVrm *v = &s->vrm;
    if (!bone || !bone[0] || node < 0 || node >= s->nnode || v->nbones >= BK_VRM_BONES) return;
    snprintf(v->bone_name[v->nbones], sizeof v->bone_name[0], "%s", bone);
    v->bone_node[v->nbones] = node;
    s->nodes[node].humanoid = v->nbones;
    v->nbones++;
}

static void add_vrm_expr(BkVrm *v, const char *name)
{
    if (!name || !name[0] || v->nexpr >= BK_VRM_EXPR) return;
    for (int i = 0; i < v->nexpr; ++i) if (!strcmp(v->expr[i], name)) return;
    snprintf(v->expr[v->nexpr++], sizeof v->expr[0], "%s", name);
}

static void load_vrm(Gltf *g)
{
    BkScene *s = g->scene;
    BkVrm *v = &s->vrm;
    const R2dJson *ext = r2d_json_get(g->root, "extensions");
    const R2dJson *v1 = r2d_json_get(ext, "VRMC_vrm");
    const R2dJson *v0 = r2d_json_get(ext, "VRM");
    if (v1 && v1->type == R2D_JSON_OBJ) {
        v->version = 2;
        copy_str(v->spec, sizeof v->spec, r2d_json_str(r2d_json_get(v1, "specVersion"), "1.0"));
        const R2dJson *meta = r2d_json_get(v1, "meta");
        copy_str(v->title, sizeof v->title, r2d_json_str(r2d_json_get(meta, "name"), ""));
        const R2dJson *authors = r2d_json_get(meta, "authors");
        copy_str(v->author, sizeof v->author, r2d_json_str(r2d_json_at(authors, 0), ""));
        copy_str(v->license, sizeof v->license, r2d_json_str(r2d_json_get(meta, "licenseUrl"), ""));
        const R2dJson *hb = r2d_json_get(r2d_json_get(v1, "humanoid"), "humanBones");
        if (hb && hb->type == R2D_JSON_OBJ) {
            for (int i = 0; i < hb->count; ++i) add_vrm_bone(s, hb->keys[i], r2d_json_int(r2d_json_get(hb->items[i], "node"), -1));
        }
        const R2dJson *ex = r2d_json_get(v1, "expressions");
        const R2dJson *preset = r2d_json_get(ex, "preset");
        if (preset && preset->type == R2D_JSON_OBJ) for (int i = 0; i < preset->count; ++i) add_vrm_expr(v, preset->keys[i]);
        const R2dJson *custom = r2d_json_get(ex, "custom");
        if (custom && custom->type == R2D_JSON_OBJ) for (int i = 0; i < custom->count; ++i) add_vrm_expr(v, custom->keys[i]);
    } else if (v0 && v0->type == R2D_JSON_OBJ) {
        v->version = 1;
        copy_str(v->spec, sizeof v->spec, r2d_json_str(r2d_json_get(v0, "specVersion"), "0.0"));
        const R2dJson *meta = r2d_json_get(v0, "meta");
        copy_str(v->title, sizeof v->title, r2d_json_str(r2d_json_get(meta, "title"), ""));
        copy_str(v->author, sizeof v->author, r2d_json_str(r2d_json_get(meta, "author"), ""));
        copy_str(v->license, sizeof v->license, r2d_json_str(r2d_json_get(meta, "licenseName"), ""));
        const R2dJson *hb = r2d_json_get(r2d_json_get(v0, "humanoid"), "humanBones");
        for (int i = 0; hb && hb->type == R2D_JSON_ARR && i < hb->count; ++i) {
            add_vrm_bone(s, r2d_json_str(r2d_json_get(hb->items[i], "bone"), NULL), r2d_json_int(r2d_json_get(hb->items[i], "node"), -1));
        }
        const R2dJson *groups = r2d_json_get(r2d_json_get(v0, "blendShapeMaster"), "blendShapeGroups");
        for (int i = 0; groups && groups->type == R2D_JSON_ARR && i < groups->count; ++i) {
            const char *preset = r2d_json_str(r2d_json_get(groups->items[i], "presetName"), "");
            add_vrm_expr(v, preset[0] && strcmp(preset, "unknown") ? preset : r2d_json_str(r2d_json_get(groups->items[i], "name"), ""));
        }
    }
}

// ---------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------
bool bk_load(const char *path, BkScene *scene, SdkReport *rep)
{
    memset(scene, 0, sizeof *scene);
    size_t size = 0;
    char *data = sdk_read_file(path, &size);
    if (!data) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_INPUT_MISSING", path, NULL, NULL, "Исходный файл не найден или не читается: %s", path);
        return false;
    }
    Gltf g;
    memset(&g, 0, sizeof g);
    g.path = path;
    g.rep = rep;
    g.scene = scene;
    sdk_dirname(path, g.dir, sizeof g.dir);

    const char *json_text = NULL;
    size_t json_len = 0;
    bool ok = false;
    if (size >= 12 && memcmp(data, "glTF", 4) == 0) {
        snprintf(scene->source_kind, sizeof scene->source_kind, "glb");
        uint32_t version, total;
        memcpy(&version, data + 4, 4);
        memcpy(&total, data + 8, 4);
        if (version != 2) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_GLB_HEADER", path, NULL, NULL, "GLB версии %u: поддержана только 2", version);
            goto done;
        }
        if (total > size) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_GLB_HEADER", path, NULL, NULL, "GLB усечён: заголовок обещает %u байт, в файле %zu", total, size);
            goto done;
        }
        size_t pos = 12;
        while (pos + 8 <= total) {
            uint32_t len, type;
            memcpy(&len, data + pos, 4);
            memcpy(&type, data + pos + 4, 4);
            pos += 8;
            if (pos + len > total) {
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_GLB_CHUNK", path, NULL, NULL, "Чанк GLB выходит за пределы файла");
                goto done;
            }
            if (type == 0x4E4F534Au && !json_text) { json_text = data + pos; json_len = len; }
            else if (type == 0x004E4942u && !g.glb_bin) { g.glb_bin = (uint8_t *)data + pos; g.glb_bin_size = len; }
            pos += (len + 3u) & ~3u;
        }
        if (!json_text) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_GLB_CHUNK", path, NULL, NULL, "В GLB нет JSON-чанка");
            goto done;
        }
    } else {
        snprintf(scene->source_kind, sizeof scene->source_kind, "gltf");
        json_text = data;
        json_len = size;
    }
    {
        char *text = (char *)malloc(json_len + 1);
        memcpy(text, json_text, json_len);
        text[json_len] = '\0';
        char err[256];
        g.root = r2d_json_parse(text, err, sizeof err);
        free(text);
        if (!g.root || g.root->type != R2D_JSON_OBJ) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", path, NULL, NULL, "Не GLB/glTF: %s", g.root ? "корень не объект" : err);
            goto done;
        }
    }

    const char *version = r2d_json_str(r2d_json_get(r2d_json_get(g.root, "asset"), "version"), "");
    if (version[0] != '2') {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_GLTF_VERSION", path, NULL, NULL, "glTF версии «%s»: поддержана 2.0", version);
        goto done;
    }
    const R2dJson *required = r2d_json_get(g.root, "extensionsRequired");
    for (int i = 0; required && i < required->count; ++i) {
        const char *ext = r2d_json_str(required->items[i], "");
        if (!strcmp(ext, "KHR_draco_mesh_compression") || !strcmp(ext, "EXT_meshopt_compression")) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_EXTENSION_UNSUPPORTED", path, NULL, NULL,
                     "Модель требует %s: экспортируйте без сжатия геометрии", ext);
            goto done;
        }
    }

    // Буферы.
    const R2dJson *bufs = r2d_json_get(g.root, "buffers");
    g.nbuf = r2d_json_size(bufs);
    g.bufs = (Buf *)calloc((size_t)(g.nbuf ? g.nbuf : 1), sizeof(Buf));
    for (int i = 0; i < g.nbuf; ++i) {
        const char *uri = r2d_json_str(r2d_json_get(bufs->items[i], "uri"), NULL);
        if (!uri && i == 0 && g.glb_bin) {
            g.bufs[i].data = g.glb_bin;
            g.bufs[i].size = g.glb_bin_size;
        } else if (uri) {
            size_t n = 0;
            g.bufs[i].data = read_uri(&g, uri, &n);
            g.bufs[i].size = n;
            g.bufs[i].owned = true;
            if (!g.bufs[i].data) {
                char loc[64];
                snprintf(loc, sizeof loc, "{\"buffer\":%d}", i);
                sdk_diag(rep, SDK_ERROR, "SDK_BAKE_BUFFER_MISSING", path, loc, NULL, "Буфер «%s» не найден рядом с моделью", uri);
            }
        }
    }

    g.tex_loaded = (int *)malloc((size_t)(r2d_json_size(r2d_json_get(g.root, "textures")) + 1) * sizeof(int));
    for (int i = 0; i <= r2d_json_size(r2d_json_get(g.root, "textures")); ++i) g.tex_loaded[i] = -2;
    load_materials(&g);

    // Узлы (иерархия, мировые матрицы), скины, VRM — до мешей.
    {
        const R2dJson *jn = r2d_json_get(g.root, "nodes");
        scene->nnode = r2d_json_size(jn);
        scene->nodes = (BkNode *)calloc((size_t)(scene->nnode ? scene->nnode : 1), sizeof(BkNode));
        for (int i = 0; i < scene->nnode; ++i) {
            BkNode *bn = &scene->nodes[i];
            bn->parent = -1;
            bn->humanoid = -1;
            bn->world[0] = bn->world[5] = bn->world[10] = bn->world[15] = 1;
            const char *nm = r2d_json_str(r2d_json_get(jn->items[i], "name"), "");
            if (nm[0]) snprintf(bn->name, sizeof bn->name, "%s", nm); else snprintf(bn->name, sizeof bn->name, "node%d", i);
        }
        const M4 id0 = m4_identity();
        const R2dJson *sc0 = r2d_json_at(r2d_json_get(g.root, "scenes"), r2d_json_int(r2d_json_get(g.root, "scene"), 0));
        const R2dJson *roots0 = sc0 ? r2d_json_get(sc0, "nodes") : NULL;
        if (roots0) {
            for (int i = 0; i < roots0->count; ++i) fill_worlds(&g, r2d_json_int(roots0->items[i], -1), id0, -1);
        } else {
            bool *ch = (bool *)calloc((size_t)(scene->nnode ? scene->nnode : 1), sizeof(bool));
            for (int i = 0; i < scene->nnode; ++i) {
                const R2dJson *cc = r2d_json_get(jn->items[i], "children");
                for (int k = 0; cc && k < cc->count; ++k) {
                    const int c = r2d_json_int(cc->items[k], -1);
                    if (c >= 0 && c < scene->nnode) ch[c] = true;
                }
            }
            for (int i = 0; i < scene->nnode; ++i) if (!ch[i]) fill_worlds(&g, i, id0, -1);
            free(ch);
        }
        load_skins(&g);
        load_vrm(&g);
        g.cur_skin = -1;
    }

    const R2dJson *scenes = r2d_json_get(g.root, "scenes");
    const int scene_index = r2d_json_int(r2d_json_get(g.root, "scene"), 0);
    const R2dJson *sc = r2d_json_at(scenes, scene_index);
    const M4 id = m4_identity();
    if (sc) {
        const R2dJson *roots = r2d_json_get(sc, "nodes");
        for (int i = 0; roots && i < roots->count; ++i) walk_node(&g, r2d_json_int(roots->items[i], -1), id);
    } else {
        // Сцен нет: берём корневые узлы (не являющиеся чьими-то детьми).
        const R2dJson *nodes = r2d_json_get(g.root, "nodes");
        const int nn = r2d_json_size(nodes);
        bool *child = (bool *)calloc((size_t)(nn ? nn : 1), sizeof(bool));
        for (int i = 0; i < nn; ++i) {
            const R2dJson *ch = r2d_json_get(nodes->items[i], "children");
            for (int k = 0; ch && k < ch->count; ++k) {
                const int c = r2d_json_int(ch->items[k], -1);
                if (c >= 0 && c < nn) child[c] = true;
            }
        }
        for (int i = 0; i < nn; ++i) if (!child[i]) walk_node(&g, i, id);
        free(child);
    }
    scene->animations = r2d_json_size(r2d_json_get(g.root, "animations"));
    if (scene->animations) {
        sdk_diag(rep, SDK_INFO, "SDK_BAKE_ANIMATION_IGNORED", path, NULL, NULL, "Анимации модели (%d) не переносятся в Prop", scene->animations);
    }
    if (scene->ntri == 0 && rep->errors == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", path, NULL, NULL, "В модели нет ни одного треугольника");
    }
    ok = rep->errors == 0;

done:
    for (int i = 0; i < g.nbuf; ++i) if (g.bufs[i].owned) free(g.bufs[i].data);
    free(g.bufs);
    free(g.tex_loaded);
    if (g.skin_jm) { for (int i = 0; i < scene->nskin; ++i) free(g.skin_jm[i]); free(g.skin_jm); }
    r2d_json_free(g.root);
    free(data);
    return ok;
}

void bk_free(BkScene *s)
{
    for (int i = 0; i < s->ntex; ++i) sdk_image_free(s->texs[i].px);
    free(s->texs);
    free(s->mats);
    free(s->tris);
    free(s->nodes);
    for (int i = 0; i < s->nskin; ++i) free(s->skin_list[i].joints);
    free(s->skin_list);
    memset(s, 0, sizeof *s);
}
