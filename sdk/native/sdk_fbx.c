// ===========================================================================
// Re2D Baker: импорт FBX (ASCII/binary) через ufbx — временный источник данных
// (docs/SDK.md §7). Как GLB/OBJ, FBX живёт только на этапе импорта: из него берутся
// треугольники, UV, материалы и текстуры, результат — обычный PNG v2 + `*.character.json`.
//
// Что умеет загрузчик:
//  * меши с кожей (skin) и без; вершины в выбранной позе: --fbx-stack <клип> --fbx-time <секунды>
//    (вычисляется ufbx_evaluate_scene + skin-матрицы вершин; рантайм кость/кожу не видит);
//  * материалы: базовый цвет (pbr.base_color / fbx.diffuse_color), множитель, текстура base color;
//  * текстуры ищутся: путь из файла → рядом с моделью → textures/, ../textures/, tex/ (по имени файла).
// Не поддержано и сообщается: blendshape/morph, нормали и остальные карты (normal/AO/spec — Baker
// считает нормали сам), несколько UV-наборов (берётся первый).
// Оси как у glTF (правосторонние, Y вверх), единицы — метры (ufbx приводит сцену к ним).
// ===========================================================================
#include "sdk_bake.h"
#include "ufbx.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FBX_MAX_TRIS 4000000

static char  g_stack[128];
static float g_time;
static bool  g_pose;

static char g_tint[1024], g_ao[2048];
static bool g_character;
static char g_rot[512];
void bk_fbx_set_rotations(const char *spec) { snprintf(g_rot, sizeof g_rot, "%s", spec ? spec : ""); }
void bk_fbx_set_character(bool on) { g_character = on; }

// Mixamo-кость (без префикса «mixamorig:») → имя humanoid-кости VRM; NULL — кость не из humanoid.
static const char *humanoid_of_mixamo(const char *name, char *buf, size_t cap)
{
    const char *colon = strrchr(name, ':');
    if (colon) name = colon + 1;
    static const struct { const char *m, *h; } T[] = {
        { "Hips", "hips" }, { "Spine", "spine" }, { "Spine1", "chest" }, { "Spine2", "upperChest" },
        { "Neck", "neck" }, { "Head", "head" },
    };
    for (size_t i = 0; i < sizeof T / sizeof T[0]; ++i) if (!strcmp(name, T[i].m)) return T[i].h;
    const char *side = NULL, *rest = NULL;
    if (!strncmp(name, "Left", 4)) { side = "left"; rest = name + 4; }
    else if (!strncmp(name, "Right", 5)) { side = "right"; rest = name + 5; }
    if (!side) return NULL;
    static const struct { const char *m, *h; } L[] = {
        { "Shoulder", "Shoulder" }, { "Arm", "UpperArm" }, { "ForeArm", "LowerArm" }, { "Hand", "Hand" },
        { "UpLeg", "UpperLeg" }, { "Leg", "LowerLeg" }, { "Foot", "Foot" }, { "ToeBase", "Toes" },
    };
    for (size_t i = 0; i < sizeof L / sizeof L[0]; ++i) if (!strcmp(rest, L[i].m)) { snprintf(buf, cap, "%s%s", side, L[i].h); return buf; }
    static const char *fingers[][2] = { { "Thumb", "Thumb" }, { "Index", "Index" }, { "Middle", "Middle" }, { "Ring", "Ring" }, { "Pinky", "Little" } };
    static const char *seg[] = { "", "Proximal", "Intermediate", "Distal" };
    if (!strncmp(rest, "Hand", 4) && rest[4]) {
        for (size_t f = 0; f < 5; ++f) {
            const size_t n = strlen(fingers[f][0]);
            if (!strncmp(rest + 4, fingers[f][0], n) && rest[4 + n] >= '1' && rest[4 + n] <= '3') {
                snprintf(buf, cap, "%s%s%s", side, fingers[f][1], seg[rest[4 + n] - '0']);
                return buf;
            }
        }
    }
    return NULL;
}

// Списки «имя=значение» через запятую: tint — #rrggbb (цвет материала без текстуры), ao — путь к PNG затенения.
void bk_fbx_set_materials(const char *tint, const char *ao)
{
    snprintf(g_tint, sizeof g_tint, "%s", tint ? tint : "");
    snprintf(g_ao, sizeof g_ao, "%s", ao ? ao : "");
}

static bool list_lookup(const char *list, const char *name, char *out, size_t cap)
{
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

void bk_fbx_set_pose(const char *stack, float time)
{
    g_pose = stack && stack[0];
    snprintf(g_stack, sizeof g_stack, "%s", g_pose ? stack : "");
    g_time = time;
}

static bool file_exists(const char *p)
{
    FILE *f = fopen(p, "rb");
    if (!f) return false;
    fclose(f);
    return true;
}

static const char *base_name(const char *p)
{
    const char *s = strrchr(p, '/');
    const char *b = strrchr(p, '\\');
    if (b && (!s || b > s)) s = b;
    return s ? s + 1 : p;
}

// Находит файл текстуры и загружает RGBA; -1, если не нашли.
static int load_texture(BkScene *s, SdkReport *rep, const char *model, const ufbx_texture *t, int *cache, int tex_count)
{
    if (!t) return -1;
    if (cache[t->typed_id] >= -1 && cache[t->typed_id] != -2) return cache[t->typed_id];
    char dir[1024];
    sdk_dirname(model, dir, sizeof dir);
    char cand[2048];
    const char *names[2] = { t->filename.data, t->relative_filename.data };
    const char *subdirs[] = { "", "textures", "../textures", "tex", "../tex", "74tex", "../74tex", "source", "../source" };
    char found[2048] = { 0 };
    if (names[0][0] && file_exists(names[0])) snprintf(found, sizeof found, "%s", names[0]);
    for (int n = 1; !found[0] && n >= 0; --n) {
        if (!names[n][0]) continue;
        sdk_join(dir, names[n], cand, sizeof cand);
        if (file_exists(cand)) snprintf(found, sizeof found, "%s", cand);
    }
    for (size_t k = 0; !found[0] && k < sizeof subdirs / sizeof *subdirs; ++k) {
        char sub[2048];
        sdk_join(dir, subdirs[k], sub, sizeof sub);
        sdk_join(sub, base_name(names[0][0] ? names[0] : names[1]), cand, sizeof cand);
        if (file_exists(cand)) snprintf(found, sizeof found, "%s", cand);
    }
    int w = 0, h = 0;
    uint8_t *px = found[0] ? sdk_image_load_rgba(found, &w, &h) : NULL;
    if (!px) {
        sdk_diag(rep, SDK_WARNING, "SDK_BAKE_TEXTURE_MISSING", model, NULL, NULL,
                 "Текстура «%s» не найдена рядом с моделью (искали textures/, tex/ и рядом): материал получит цвет",
                 base_name(names[0][0] ? names[0] : names[1]));
        cache[t->typed_id] = -1;
        return -1;
    }
    BkTexture *g = (BkTexture *)realloc(s->texs, (size_t)(s->ntex + 1) * sizeof(BkTexture));
    if (!g) { sdk_image_free(px); return -1; }
    s->texs = g;
    s->texs[s->ntex].px = px;
    s->texs[s->ntex].w = w;
    s->texs[s->ntex].h = h;
    (void)tex_count;
    return cache[t->typed_id] = s->ntex++;
}

static void material_overrides(BkScene *scene, SdkReport *rep, const char *path, BkMaterial *m, bool has_tex)
{
    char val[1024];
    if (list_lookup(g_tint, m->name, val, sizeof val) && val[0] == '#' && strlen(val) == 7) {
        unsigned rgb = 0;
        if (sscanf(val + 1, "%x", &rgb) == 1) {
            m->base[0] = ((rgb >> 16) & 255) / 255.0f;
            m->base[1] = ((rgb >> 8) & 255) / 255.0f;
            m->base[2] = (rgb & 255) / 255.0f;
        }
    }
    if (!has_tex && list_lookup(g_ao, m->name, val, sizeof val)) {
        int w = 0, h = 0;
        uint8_t *px = sdk_image_load_rgba(val, &w, &h);
        if (!px) {
            sdk_diag(rep, SDK_WARNING, "SDK_BAKE_TEXTURE_MISSING", path, NULL, NULL, "Карта затенения «%s» не читается: материал «%s» остаётся плоским цветом", val, m->name);
        } else {
            for (size_t i = 0; i < (size_t)w * (size_t)h; ++i) {            // цвет материала × AO
                px[i * 4 + 0] = (uint8_t)(px[i * 4 + 0] * m->base[0]);
                px[i * 4 + 1] = (uint8_t)(px[i * 4 + 1] * m->base[1]);
                px[i * 4 + 2] = (uint8_t)(px[i * 4 + 2] * m->base[2]);
                px[i * 4 + 3] = 255;
            }
            BkTexture *g = (BkTexture *)realloc(scene->texs, (size_t)(scene->ntex + 1) * sizeof(BkTexture));
            if (g) {
                scene->texs = g;
                scene->texs[scene->ntex] = (BkTexture){ px, w, h };
                m->tex = scene->ntex++;
                m->base[0] = m->base[1] = m->base[2] = 1.0f;
            } else sdk_image_free(px);
        }
    }
}

bool bk_load_fbx(const char *path, BkScene *scene, SdkReport *rep)
{
    memset(scene, 0, sizeof *scene);
    snprintf(scene->source_kind, sizeof scene->source_kind, "fbx");

    ufbx_load_opts opts = { 0 };
    opts.target_axes = ufbx_axes_right_handed_y_up;
    opts.target_unit_meters = 1.0f;
    opts.load_external_files = false;
    ufbx_error err;
    ufbx_scene *base = ufbx_load_file(path, &opts, &err);
    if (!base) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", path, NULL, NULL, "FBX не прочитан: %s", err.description.data);
        return false;
    }
    scene->animations = (int)base->anim_stacks.count;
    scene->skins = (int)base->skin_deformers.count;

    ufbx_scene *eval = base;
    ufbx_transform_override *overrides = NULL;
    if (g_character && g_rot[0]) {
        // «Кость=rx,ry,rz;…» — локальные повороты (градусы, порядок XYZ) поверх позы привязки: A-поза для ретаргета
        size_t n = 0, cap = 8;
        overrides = (ufbx_transform_override *)calloc(cap, sizeof *overrides);
        char spec[512];
        snprintf(spec, sizeof spec, "%s", g_rot);
        char *save = NULL;
        for (char *tok = strtok_r(spec, ";", &save); tok && overrides && n < cap; tok = strtok_r(NULL, ";", &save)) {
            char *eq = strchr(tok, '=');
            double rx = 0, ry = 0, rz = 0;
            if (!eq) continue;
            *eq = '\0';
            if (sscanf(eq + 1, "%lf,%lf,%lf", &rx, &ry, &rz) != 3) continue;
            ufbx_node *target = NULL;
            for (size_t i = 0; i < base->nodes.count && !target; ++i) {
                const char *nm = base->nodes.data[i]->name.data, *c = strrchr(nm, ':');
                if (!strcmp(c ? c + 1 : nm, tok)) target = base->nodes.data[i];
            }
            if (!target) {
                sdk_diag(rep, SDK_WARNING, "SDK_BAKE_FBX_BONE", path, NULL, NULL, "--fbx-rot: кости «%s» нет в FBX", tok);
                continue;
            }
            ufbx_transform t = target->local_transform;
            t.rotation = ufbx_quat_mul(t.rotation, ufbx_euler_to_quat((ufbx_vec3){ rx, ry, rz }, UFBX_ROTATION_ORDER_XYZ));
            overrides[n].node_id = target->typed_id;
            overrides[n].transform = t;
            ++n;
        }
        ufbx_anim_opts ao = { 0 };
        ao.transform_overrides.data = overrides;
        ao.transform_overrides.count = n;
        ufbx_anim *custom = ufbx_create_anim(base, &ao, &err);
        eval = custom ? ufbx_evaluate_scene(base, custom, 0.0, NULL, &err) : NULL;
        if (custom) ufbx_free_anim(custom);
        if (!eval) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", path, NULL, NULL, "FBX: поза с --fbx-rot не вычислена: %s", err.description.data);
            free(overrides);
            ufbx_free_scene(base);
            return false;
        }
    }
    if (g_pose && !g_character) {
        ufbx_anim_stack *stack = NULL;
        for (size_t i = 0; i < base->anim_stacks.count && !stack; ++i) {
            const char *name = base->anim_stacks.data[i]->name.data;
            const char *bar = strrchr(name, '|');
            if (!strcmp(name, g_stack) || (bar && !strcmp(bar + 1, g_stack))) stack = base->anim_stacks.data[i];
        }
        if (!stack) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FBX_STACK", path, NULL, NULL,
                     "В FBX нет анимационного клипа «%s» (доступно: %zu); имена — r2d-sdk animation-import --list или ufbx", g_stack, base->anim_stacks.count);
            ufbx_free_scene(base);
            return false;
        }
        double t = stack->time_begin + (double)g_time;
        if (t > stack->time_end) t = stack->time_end;
        ufbx_evaluate_opts eo = { 0 };
        eval = ufbx_evaluate_scene(base, stack->anim, t, &eo, &err);
        if (!eval) {
            sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", path, NULL, NULL, "FBX: поза «%s» @%.3f с не вычислена: %s", g_stack, g_time, err.description.data);
            ufbx_free_scene(base);
            return false;
        }
    }

    // --- материалы: по одному на ufbx-материал, последний — по умолчанию ---
    const int nm = (int)eval->materials.count;
    scene->mats = (BkMaterial *)calloc((size_t)nm + 1, sizeof(BkMaterial));
    int *tex_cache = (int *)malloc((eval->textures.count + 1) * sizeof(int));
    if (!scene->mats || !tex_cache) { free(tex_cache); if (eval != base) ufbx_free_scene(eval); ufbx_free_scene(base); return false; }
    for (size_t i = 0; i <= eval->textures.count; ++i) tex_cache[i] = -2;
    for (int i = 0; i <= nm; ++i) {
        BkMaterial *m = &scene->mats[i];
        snprintf(m->name, sizeof m->name, "%s", i < nm ? eval->materials.data[i]->name.data : "default");
        m->base[0] = m->base[1] = m->base[2] = 0.8f;
        m->base[3] = 1.0f;
        m->tex = -1;
        m->alpha = BK_ALPHA_OPAQUE;
        m->cutoff = 0.5f;
        m->uv_scale[0] = m->uv_scale[1] = 1.0f;
        if (i == nm) break;
        const ufbx_material *um = eval->materials.data[i];
        const ufbx_material_map *bc = um->pbr.base_color.has_value ? &um->pbr.base_color : &um->fbx.diffuse_color;
        if (bc->has_value) {
            const float f = um->pbr.base_factor.has_value ? (float)um->pbr.base_factor.value_real : 1.0f;
            m->base[0] = (float)bc->value_vec3.x * f;
            m->base[1] = (float)bc->value_vec3.y * f;
            m->base[2] = (float)bc->value_vec3.z * f;
        }
        const ufbx_texture *tx = um->pbr.base_color.texture ? um->pbr.base_color.texture : um->fbx.diffuse_color.texture;
        material_overrides(scene, rep, path, m, tx != NULL);
        if (tx) {
            m->tex = load_texture(scene, rep, path, tx, tex_cache, (int)eval->textures.count);
            if (m->tex >= 0) { m->base[0] = m->base[1] = m->base[2] = 1.0f; }
        }
    }
    material_overrides(scene, rep, path, &scene->mats[nm], false);   // «default=…» — цвет/текстура для мешей без материала
    scene->nmat = nm + 1;                    // материал по умолчанию — последний, как у glTF/OBJ
    free(tex_cache);

    // --- Character: узлы, humanoid-соответствие и скины (поза файла по умолчанию = поза привязки) ---
    if (g_character) {
        const int nn = (int)eval->nodes.count;
        scene->nodes = (BkNode *)calloc((size_t)nn, sizeof(BkNode));
        scene->nnode = nn;
        scene->vrm.version = 2;                         // лицом к +Z, как VRM 1.0: разворот не нужен
        snprintf(scene->vrm.title, sizeof scene->vrm.title, "Mixamo FBX");
        for (int i = 0; i < nn && scene->nodes; ++i) {
            const ufbx_node *n = eval->nodes.data[i];
            BkNode *o = &scene->nodes[i];
            snprintf(o->name, sizeof o->name, "%s", n->name.data);
            o->parent = n->parent ? (int)n->parent->typed_id : -1;
            const ufbx_matrix *m = &n->node_to_world;
            const float w[16] = { (float)m->m00, (float)m->m10, (float)m->m20, 0, (float)m->m01, (float)m->m11, (float)m->m21, 0,
                                  (float)m->m02, (float)m->m12, (float)m->m22, 0, (float)m->m03, (float)m->m13, (float)m->m23, 1 };
            memcpy(o->world, w, sizeof w);
            o->pos[0] = (float)m->m03; o->pos[1] = (float)m->m13; o->pos[2] = (float)m->m23;
            o->humanoid = -1;
            char hb[48];
            const char *h = humanoid_of_mixamo(n->name.data, hb, sizeof hb);
            if (h && scene->vrm.nbones < BK_VRM_BONES) {
                const int k = scene->vrm.nbones++;
                snprintf(scene->vrm.bone_name[k], sizeof scene->vrm.bone_name[k], "%s", h);
                scene->vrm.bone_node[k] = i;
                o->humanoid = k;
            }
        }
        scene->nskin = (int)base->skin_deformers.count;
        scene->skin_list = (BkSkin *)calloc((size_t)(scene->nskin ? scene->nskin : 1), sizeof(BkSkin));
        for (int i = 0; i < scene->nskin && scene->skin_list; ++i) {
            const ufbx_skin_deformer *sk = base->skin_deformers.data[i];
            scene->skin_list[i].n = (int)sk->clusters.count;
            scene->skin_list[i].joints = (int *)calloc(sk->clusters.count ? sk->clusters.count : 1, sizeof(int));
            for (size_t k = 0; k < sk->clusters.count && scene->skin_list[i].joints; ++k)
                scene->skin_list[i].joints[k] = sk->clusters.data[k]->bone_node ? (int)sk->clusters.data[k]->bone_node->typed_id : 0;
        }
    }

    // --- треугольники всех мешей в мировых координатах, в выбранной позе ---
    bool ok = true;
    uint32_t *tri_idx = NULL;
    size_t tri_cap = 0;
    for (size_t ni = 0; ni < eval->nodes.count && ok; ++ni) {
        const ufbx_node *node = eval->nodes.data[ni];
        const ufbx_mesh *mesh = node->mesh;
        if (!mesh || mesh->num_triangles == 0) continue;
        scene->meshes++;
        if (mesh->blend_deformers.count) {
            sdk_diag(rep, SDK_WARNING, "SDK_BAKE_FBX_MORPH", path, NULL, NULL, "Меш «%s»: blendshape игнорируются", mesh->name.data);
        }
        const ufbx_skin_deformer *skin = mesh->skin_deformers.count ? mesh->skin_deformers.data[0] : NULL;
        if (mesh->max_face_triangles * 3 > tri_cap) {
            tri_cap = mesh->max_face_triangles * 3;
            uint32_t *g = (uint32_t *)realloc(tri_idx, tri_cap * sizeof(uint32_t));
            if (!g) { ok = false; break; }
            tri_idx = g;
        }
        // позиции вершин в мире (с кожей — по матрице вершины)
        ufbx_vec3 *wp = (ufbx_vec3 *)malloc(mesh->num_vertices * sizeof(ufbx_vec3));
        if (!wp) { ok = false; break; }
        for (size_t v = 0; v < mesh->num_vertices; ++v) {
            const ufbx_vec3 p = mesh->vertices.data[v];
            if (skin) {
                const ufbx_matrix m = ufbx_get_skin_vertex_matrix(skin, v, &node->geometry_to_world);
                wp[v] = ufbx_transform_position(&m, p);
            } else {
                wp[v] = ufbx_transform_position(&node->geometry_to_world, p);
            }
        }
        for (size_t fi = 0; fi < mesh->num_faces && ok; ++fi) {
            const ufbx_face face = mesh->faces.data[fi];
            const uint32_t nt = ufbx_triangulate_face(tri_idx, tri_cap, mesh, face);
            int mat = nm;
            if (mesh->face_material.count) {
                const uint32_t slot = mesh->face_material.data[fi];
                if (slot < mesh->materials.count) mat = (int)mesh->materials.data[slot]->typed_id;
            }
            for (uint32_t t = 0; t < nt; ++t) {
                if (scene->ntri >= FBX_MAX_TRIS) {
                    sdk_diag(rep, SDK_ERROR, "SDK_BAKE_MEMORY", path, NULL, NULL, "В FBX больше %d треугольников", FBX_MAX_TRIS);
                    ok = false;
                    break;
                }
                if (scene->ntri == scene->cap) {
                    const int c = scene->cap ? scene->cap * 2 : 4096;
                    BkTri *g = (BkTri *)realloc(scene->tris, (size_t)c * sizeof(BkTri));
                    if (!g) { ok = false; break; }
                    scene->tris = g;
                    scene->cap = c;
                }
                BkTri *tri = &scene->tris[scene->ntri++];
                memset(tri, 0, sizeof *tri);
                tri->material = mat;
                tri->node = -1;
                tri->skin = -1;
                tri->has_uv = mesh->vertex_uv.exists;
                if (g_character && skin) {
                    tri->skinned = true;
                    tri->node = (int)node->typed_id;
                    tri->skin = (int)skin->typed_id;
                }
                for (int k = 0; k < 3; ++k) {
                    const uint32_t corner = tri_idx[t * 3 + k];
                    if (tri->skinned) {
                        const ufbx_skin_vertex sv = skin->vertices.data[mesh->vertex_indices.data[corner]];
                        float sum = 0;
                        for (uint32_t q = 0; q < 4; ++q) {
                            const bool has = q < sv.num_weights;
                            const ufbx_skin_weight sw = has ? skin->weights.data[sv.weight_begin + q] : (ufbx_skin_weight){ 0, 0 };
                            tri->j[k][q] = has ? (uint16_t)sw.cluster_index : 0;
                            tri->w[k][q] = has ? (float)sw.weight : 0.0f;
                            sum += tri->w[k][q];
                        }
                        if (sum > 1e-6f) for (int q = 0; q < 4; ++q) tri->w[k][q] /= sum;
                        else tri->w[k][0] = 1.0f;
                    }
                    const ufbx_vec3 p = wp[mesh->vertex_indices.data[corner]];
                    tri->p[k][0] = (float)p.x;
                    tri->p[k][1] = (float)p.y;
                    tri->p[k][2] = (float)p.z;
                    if (tri->has_uv) {
                        const ufbx_vec2 uv = ufbx_get_vertex_vec2(&mesh->vertex_uv, corner);
                        tri->uv[k][0] = (float)uv.x;
                        tri->uv[k][1] = 1.0f - (float)uv.y;        // FBX: V снизу вверх; Baker ждёт V сверху вниз
                    }
                }
            }
        }
        free(wp);
    }
    free(tri_idx);
    if (ok && scene->ntri == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", path, NULL, NULL, "В FBX нет ни одного треугольника");
        ok = false;
    }
    if (eval != base) ufbx_free_scene(eval);
    free(overrides);
    ufbx_free_scene(base);
    return ok;
}
