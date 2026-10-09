// ===========================================================================
// Re2D Baker (Character): VRM / humanoid-скин → псевдоскелет Re2D.
//
// Владение частями: каждый треугольник принадлежит одной кости Re2D (root, head,
// arm*, forearm*, hip*, knee*) по доминирующему влиянию скина через humanoid-
// соответствие. Неоднозначность (кости делят вес примерно поровну) считается и
// сообщается, а не прячется. Выражения VRM запекаются с --expression; без выбора
// отчёт даёт сопоставление с эмоциями Re2DSprite.
// ===========================================================================
#include "sdk_bake.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { B_ROOT, B_HEAD, B_ARM0, B_FORE0, B_ARM1, B_FORE1, B_HIP0, B_KNEE0, B_HIP1, B_KNEE1 };

// Имя humanoid-кости → кость Re2D (-1: не влияет). 0.x и 1.0 используют одни имена.
static int bone_of_humanoid(const char *n)
{
    static const struct { const char *name; int b; } T[] = {
        { "hips", B_ROOT }, { "spine", B_ROOT }, { "chest", B_ROOT }, { "upperChest", B_ROOT },
        { "neck", B_HEAD }, { "head", B_HEAD }, { "jaw", B_HEAD }, { "leftEye", B_HEAD }, { "rightEye", B_HEAD },
        { "leftShoulder", B_ARM0 }, { "leftUpperArm", B_ARM0 }, { "leftLowerArm", B_FORE0 }, { "leftHand", B_FORE0 },
        { "rightShoulder", B_ARM1 }, { "rightUpperArm", B_ARM1 }, { "rightLowerArm", B_FORE1 }, { "rightHand", B_FORE1 },
        { "leftUpperLeg", B_HIP0 }, { "leftLowerLeg", B_KNEE0 }, { "leftFoot", B_KNEE0 }, { "leftToes", B_KNEE0 },
        { "rightUpperLeg", B_HIP1 }, { "rightLowerLeg", B_KNEE1 }, { "rightFoot", B_KNEE1 }, { "rightToes", B_KNEE1 },
    };
    for (size_t i = 0; i < sizeof T / sizeof T[0]; ++i) if (!strcmp(T[i].name, n)) return T[i].b;
    // Пальцы: left/right + Thumb|Index|Middle|Ring|Little + сегмент.
    if (!strncmp(n, "left", 4) && (strstr(n, "Thumb") || strstr(n, "Index") || strstr(n, "Middle") || strstr(n, "Ring") || strstr(n, "Little"))) return B_FORE0;
    if (!strncmp(n, "right", 5) && (strstr(n, "Thumb") || strstr(n, "Index") || strstr(n, "Middle") || strstr(n, "Ring") || strstr(n, "Little"))) return B_FORE1;
    return -1;
}

static int humanoid_node(const BkScene *s, const char *bone)
{
    for (int i = 0; i < s->vrm.nbones; ++i) if (!strcmp(s->vrm.bone_name[i], bone)) return s->vrm.bone_node[i];
    return -1;
}

// Кость Re2D узла: ближайший humanoid-предок; -1 если такого нет.
static int bone_of_node(const BkScene *s, int node)
{
    for (int depth = 0; node >= 0 && node < s->nnode && depth < 64; ++depth) {
        const int h = s->nodes[node].humanoid;
        if (h >= 0) {
            const int b = bone_of_humanoid(s->vrm.bone_name[h]);
            if (b >= 0) return b;
        }
        node = s->nodes[node].parent;
    }
    return -1;
}

static void flip_y180(float *p) { p[0] = -p[0]; p[2] = -p[2]; }

bool ch_assign(BkScene *s, int *tri_owner, ChRig *rig, SdkReport *rep, const char *source)
{
    memset(rig, 0, sizeof *rig);
    if (s->vrm.version == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_CHARACTER_NO_HUMANOID", source, NULL, NULL,
                 "Для типа character нужна модель VRM (расширение VRM или VRMC_vrm с humanoid): в файле humanoid-соответствия костей нет");
        return false;
    }
    static const char *REQUIRED[] = { "hips", "head", "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
                                      "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg" };
    char missing[256] = "";
    int nmissing = 0;
    for (size_t i = 0; i < sizeof REQUIRED / sizeof REQUIRED[0]; ++i) {
        if (humanoid_node(s, REQUIRED[i]) < 0) {
            if (nmissing++) strncat(missing, ", ", sizeof missing - strlen(missing) - 1);
            strncat(missing, REQUIRED[i], sizeof missing - strlen(missing) - 1);
        }
    }
    if (nmissing) {
        char d[320];
        snprintf(d, sizeof d, "{\"missing\":\"%s\"}", missing);
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_HUMANOID_INCOMPLETE", source, NULL, d, "В humanoid VRM не хватает костей: %s", missing);
        return false;
    }
    if (s->vrm.version == 1) {                      // VRM 0.x смотрит в -Z: разворачиваем на 180° вокруг Y
        rig->flipped = true;
        for (int i = 0; i < s->ntri; ++i) for (int v = 0; v < 3; ++v) flip_y180(s->tris[i].p[v]);
        for (int i = 0; i < s->nnode; ++i) flip_y180(s->nodes[i].pos);
    }
    static const char *BASE[CH_BONES] = { "root", "head", "arm", "forearm", "arm", "forearm", "hip", "knee", "hip", "knee" };
    const int ref_l = humanoid_node(s, "leftUpperArm");
    rig->slot_of_vrm_left = s->nodes[ref_l].pos[0] < 0 ? 0 : 1;      // Left = X<0 (как у Russi: экранная левая)
    for (int b = 0; b < CH_BONES; ++b) {
        const int vrm_side = (b == B_ROOT || b == B_HEAD) ? -1 : ((b - B_ARM0) % 4 < 2 ? 0 : 1);   // 0 — VRM left, 1 — VRM right
        if (vrm_side < 0) snprintf(rig->name[b], sizeof rig->name[0], "%s", BASE[b]);
        else {
            // Left = сторона X<0: если VRM left стоит на X<0 (slot 0), он зовётся Left, иначе наоборот.
            const bool name_left = vrm_side == rig->slot_of_vrm_left;
            snprintf(rig->name[b], sizeof rig->name[0], "%s%s", BASE[b], name_left ? "Left" : "Right");
        }
    }
    // Точки шарниров.
    int n;
    const char *head_src = humanoid_node(s, "neck") >= 0 ? "neck" : "head";
    n = humanoid_node(s, head_src); memcpy(rig->pivot[B_HEAD], s->nodes[n].pos, sizeof rig->pivot[0]);
    n = humanoid_node(s, "hips");   memcpy(rig->pivot[B_ROOT], s->nodes[n].pos, sizeof rig->pivot[0]);
    static const char *PIV[CH_BONES] = { NULL, NULL, "leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm",
                                         "leftUpperLeg", "leftLowerLeg", "rightUpperLeg", "rightLowerLeg" };
    for (int b = B_ARM0; b < CH_BONES; ++b) { n = humanoid_node(s, PIV[b]); memcpy(rig->pivot[b], s->nodes[n].pos, sizeof rig->pivot[0]); }
    static const char *HAND[2] = { "leftHand", "rightHand" }, *FOOT[2] = { "leftFoot", "rightFoot" };
    for (int k = 0; k < 2; ++k) {
        n = humanoid_node(s, HAND[k]); if (n >= 0) { rig->have_hand[k] = true; memcpy(rig->hand[k], s->nodes[n].pos, sizeof rig->hand[0]); }
        n = humanoid_node(s, FOOT[k]); if (n >= 0) { rig->have_foot[k] = true; memcpy(rig->foot[k], s->nodes[n].pos, sizeof rig->foot[0]); }
    }

    // Владельцы суставов скина (кэш) и узлов.
    int **joint_bone = (int **)calloc((size_t)(s->nskin ? s->nskin : 1), sizeof(int *));
    for (int i = 0; i < s->nskin; ++i) {
        joint_bone[i] = (int *)malloc((size_t)(s->skin_list[i].n ? s->skin_list[i].n : 1) * sizeof(int));
        for (int k = 0; k < s->skin_list[i].n; ++k) {
            joint_bone[i][k] = bone_of_node(s, s->skin_list[i].joints[k]);
            if (joint_bone[i][k] < 0) { rig->unmapped_joints++; joint_bone[i][k] = B_ROOT; }
        }
    }
    for (int i = 0; i < s->ntri; ++i) {
        const BkTri *t = &s->tris[i];
        float score[CH_BONES] = { 0 };
        if (t->skinned && t->skin >= 0 && t->skin < s->nskin) {
            for (int v = 0; v < 3; ++v) for (int k = 0; k < 4; ++k) score[joint_bone[t->skin][t->j[v][k]]] += t->w[v][k];
        } else {
            int b = bone_of_node(s, t->node);
            if (b < 0) b = B_ROOT;
            score[b] = 3.0f;
            rig->rigid++;
        }
        int best = 0, second = -1;
        for (int b = 1; b < CH_BONES; ++b) if (score[b] > score[best]) best = b;
        for (int b = 0; b < CH_BONES; ++b) if (b != best && score[b] > 0 && (second < 0 || score[b] > score[second])) second = b;
        tri_owner[i] = best;
        rig->tris_per_bone[best]++;
        rig->total++;
        if (second >= 0 && score[best] < 0.7f * 3.0f) {
            rig->ambiguous++;
            rig->pair[best < second ? best : second][best < second ? second : best]++;
        }
    }
    for (int i = 0; i < s->nskin; ++i) free(joint_bone[i]);
    free(joint_bone);
    return true;
}

static void put_pt(R2dSb *o, const float *p) { r2d_sb_printf(o, "[%.4f,%.4f,%.4f]", p[0], p[1], p[2]); }

void ch_json(R2dSb *o, const ChRig *rig, const float pv[CH_BONES][3], const float hand[2][3], const float foot[2][3],
             const bool used[CH_BONES], int first_id, const char *atlas, const char *style, const char *anim_file)
{
    static const int PARENT[CH_BONES] = { -1, B_ROOT, B_ROOT, B_ARM0, B_ROOT, B_ARM1, B_ROOT, B_HIP0, B_ROOT, B_HIP1 };
    r2d_sb_puts(o, "{\"version\":1,\"atlas\":");
    r2d_sb_put_json_string(o, atlas);
    r2d_sb_printf(o, ",\"style\":\"%s\",\"rig\":{\"bones\":[", style);
    for (int b = 0; b < CH_BONES; ++b) {
        r2d_sb_printf(o, "%s{\"name\":", b ? "," : "");
        r2d_sb_put_json_string(o, rig->name[b]);
        if (PARENT[b] >= 0) { r2d_sb_puts(o, ",\"parent\":"); r2d_sb_put_json_string(o, rig->name[PARENT[b]]); }
        r2d_sb_puts(o, ",\"pivot\":");
        if (b == B_ROOT) { const float z[3] = { 0, 0, 0 }; put_pt(o, z); } else put_pt(o, pv[b]);
        r2d_sb_putc(o, '}');
    }
    r2d_sb_puts(o, "],\"parts\":[");
    int np = 0;
    for (int b = 0; b < CH_BONES; ++b) {
        if (!used[b]) continue;
        r2d_sb_printf(o, "%s{\"id\":%d,\"bone\":", np++ ? "," : "", first_id + b);
        r2d_sb_put_json_string(o, rig->name[b]);
        r2d_sb_putc(o, '}');
    }
    r2d_sb_puts(o, "],\"joints\":[{\"name\":\"head\",\"bone\":\"head\",\"point\":");
    put_pt(o, pv[B_HEAD]);
    r2d_sb_putc(o, '}');
    static const int JOINT_BONE[CH_BONES] = { -1, -1, B_ARM0, B_FORE0, B_ARM1, B_FORE1, B_HIP0, B_KNEE0, B_HIP1, B_KNEE1 };
    static const char *JOINT_NAME[CH_BONES] = { NULL, NULL, "shoulder", "elbow", "shoulder", "elbow", "hip", "knee", "hip", "knee" };
    for (int b = B_ARM0; b < CH_BONES; ++b) {
        const char *side = strstr(rig->name[b], "Left") ? "Left" : "Right";
        r2d_sb_puts(o, ",{\"name\":\"");
        r2d_sb_printf(o, "%s%s\",\"bone\":", JOINT_NAME[b], side);
        r2d_sb_put_json_string(o, rig->name[JOINT_BONE[b]]);
        r2d_sb_puts(o, ",\"point\":");
        put_pt(o, pv[b]);
        r2d_sb_putc(o, '}');
    }
    // Кисти и стопы: из humanoid, если есть. Сторона по X (как у костей), а не по VRM-имени.
    for (int k = 0; k < 2; ++k) {
        const bool name_left = k == rig->slot_of_vrm_left;
        const char *side = name_left ? "Left" : "Right";
        const int fb = k == 0 ? B_FORE0 : B_FORE1, kb = k == 0 ? B_KNEE0 : B_KNEE1;
        if (rig->have_hand[k]) {
            r2d_sb_printf(o, ",{\"name\":\"hand%s\",\"bone\":", side);
            r2d_sb_put_json_string(o, rig->name[fb]);
            r2d_sb_puts(o, ",\"point\":");
            put_pt(o, hand[k]);
            r2d_sb_putc(o, '}');
        }
        if (rig->have_foot[k]) {
            r2d_sb_printf(o, ",{\"name\":\"foot%s\",\"bone\":", side);
            r2d_sb_put_json_string(o, rig->name[kb]);
            r2d_sb_puts(o, ",\"point\":");
            put_pt(o, foot[k]);
            r2d_sb_putc(o, '}');
        }
    }
    r2d_sb_puts(o, "],\"sockets\":[");
    int ns = 0;
    for (int k = 0; k < 2; ++k) {
        if (!rig->have_hand[k]) continue;
        const bool name_left = k == rig->slot_of_vrm_left;
        const int fb = k == 0 ? B_FORE0 : B_FORE1;
        r2d_sb_printf(o, "%s{\"name\":\"hand%s\",\"bone\":", ns++ ? "," : "", name_left ? "Left" : "Right");
        r2d_sb_put_json_string(o, rig->name[fb]);
        r2d_sb_puts(o, ",\"point\":");
        put_pt(o, hand[k]);
        r2d_sb_putc(o, '}');
    }
    r2d_sb_puts(o, "]},\"groups\":{");
    int ng = 0;
    for (int b = 0; b < CH_BONES; ++b) {
        if (!used[b]) continue;
        r2d_sb_printf(o, "%s", ng++ ? "," : "");
        r2d_sb_put_json_string(o, rig->name[b]);
        r2d_sb_printf(o, ":[%d]", first_id + b);
    }
    r2d_sb_puts(o, "},\"defaults\":{\"body\":true,\"motion\":\"spin\"},\"animations\":");
    r2d_sb_put_json_string(o, anim_file);
    r2d_sb_putc(o, '}');
}

// Процедурные клипы: поворот целиком и ходьба маятником по конечностям (заглушка авторской анимации).
void ch_anim_json(R2dSb *o, const ChRig *rig)
{
    r2d_sb_puts(o, "{\"version\":1,\"clips\":{\"spin\":{\"duration\":4,\"loop\":true,\"tracks\":[{\"target\":\"root\",\"channel\":\"rotation.y\",\"keys\":[[0,0],[4,360]]}]},"
                   "\"walk\":{\"duration\":1,\"loop\":true,\"tracks\":[");
    static const int LIMB[4] = { B_ARM0, B_ARM1, B_HIP0, B_HIP1 };
    for (int i = 0; i < 4; ++i) {
        // Левая рука качается вперёд вместе с правой ногой; знак по стороне X, а не по VRM-имени.
        const bool left = strstr(rig->name[LIMB[i]], "Left") != NULL;
        const float a = (i < 2 ? 25.0f : -22.0f) * (left ? 1.0f : -1.0f);
        r2d_sb_printf(o, "%s{\"target\":", i ? "," : "");
        r2d_sb_put_json_string(o, rig->name[LIMB[i]]);
        r2d_sb_printf(o, ",\"channel\":\"rotation.x\",\"keys\":[[0,%g],[0.5,%g],[1,%g]]}", a, -a, a);
    }
    r2d_sb_puts(o, "]}}}");
}

// Сопоставление пресетов выражений VRM с эмоциями Re2DSprite (Russi: neutral/happy/angry/sad/surprised/sleepy).
static const char *emotion_of(const char *vrm)
{
    static const struct { const char *v, *e; } M[] = {
        { "neutral", "neutral" }, { "happy", "happy" }, { "joy", "happy" }, { "fun", "happy" }, { "angry", "angry" },
        { "sad", "sad" }, { "sorrow", "sad" }, { "surprised", "surprised" }, { "relaxed", "neutral" }, { "blink", "sleepy" },
    };
    for (size_t i = 0; i < sizeof M / sizeof M[0]; ++i) if (!strcmp(M[i].v, vrm)) return M[i].e;
    return NULL;
}

void ch_report_json(R2dSb *o, const ChRig *rig, const BkScene *s)
{
    r2d_sb_printf(o, "{\"vrm\":{\"version\":%d,\"spec\":", s->vrm.version == 2 ? 1 : 0);
    r2d_sb_put_json_string(o, s->vrm.spec);
    r2d_sb_puts(o, ",\"title\":"); r2d_sb_put_json_string(o, s->vrm.title);
    r2d_sb_puts(o, ",\"author\":"); r2d_sb_put_json_string(o, s->vrm.author);
    r2d_sb_puts(o, ",\"license\":"); r2d_sb_put_json_string(o, s->vrm.license);
    r2d_sb_printf(o, ",\"humanBones\":%d,\"rotated180\":%s},", s->vrm.nbones, rig->flipped ? "true" : "false");
    r2d_sb_printf(o, "\"ownership\":{\"triangles\":%d,\"ambiguous\":%d,\"rigid\":%d,\"unmappedJoints\":%d,\"perBone\":{",
                  rig->total, rig->ambiguous, rig->rigid, rig->unmapped_joints);
    for (int b = 0; b < CH_BONES; ++b) {
        r2d_sb_printf(o, "%s", b ? "," : "");
        r2d_sb_put_json_string(o, rig->name[b]);
        r2d_sb_printf(o, ":%d", rig->tris_per_bone[b]);
    }
    r2d_sb_puts(o, "},\"pairs\":[");
    int n = 0;
    for (int a = 0; a < CH_BONES; ++a) for (int b = a + 1; b < CH_BONES; ++b) {
        if (!rig->pair[a][b]) continue;
        r2d_sb_printf(o, "%s{\"a\":", n++ ? "," : "");
        r2d_sb_put_json_string(o, rig->name[a]);
        r2d_sb_puts(o, ",\"b\":");
        r2d_sb_put_json_string(o, rig->name[b]);
        r2d_sb_printf(o, ",\"triangles\":%d}", rig->pair[a][b]);
    }
    r2d_sb_puts(o, "]},\"mapping\":[");
    for (int i = 0; i < s->vrm.nbones; ++i) {
        int b = bone_of_node(s, s->vrm.bone_node[i]);
        r2d_sb_printf(o, "%s{\"humanoid\":", i ? "," : "");
        r2d_sb_put_json_string(o, s->vrm.bone_name[i]);
        r2d_sb_printf(o, ",\"node\":%d,\"re2d\":", s->vrm.bone_node[i]);
        if (b >= 0) r2d_sb_put_json_string(o, rig->name[b]); else r2d_sb_puts(o, "null");
        r2d_sb_putc(o, '}');
    }
    r2d_sb_puts(o, "],\"expressions\":[");
    for (int i = 0; i < s->vrm.nexpr; ++i) {
        const char *e = emotion_of(s->vrm.expr[i]);
        r2d_sb_printf(o, "%s{\"vrm\":", i ? "," : "");
        r2d_sb_put_json_string(o, s->vrm.expr[i]);
        r2d_sb_puts(o, ",\"re2d\":");
        if (e) r2d_sb_put_json_string(o, e); else r2d_sb_puts(o, "null");
        r2d_sb_putc(o, '}');
    }
    r2d_sb_puts(o, "]}");
}
