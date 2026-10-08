// ===========================================================================
// Re2D Baker: временный импорт 3D (GLB/glTF) → нативный ассет Re2DSprite.
//
// Закон Baker'а (docs/SDK.md §10): 3D живёт ТОЛЬКО на этапе импорта. Меш —
// источник данных; в результате остаются PNG v2 (материал + карты ID/глубина/
// покрытие/XYZ) и `*.character.json`. Runtime не читает GLB, MeshRenderer'а нет.
// ===========================================================================
#pragma once

#include "sdk.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct BkTexture {
    uint8_t *px;            // RGBA8
    int      w, h;
} BkTexture;

typedef enum BkAlpha { BK_ALPHA_OPAQUE = 0, BK_ALPHA_MASK, BK_ALPHA_BLEND } BkAlpha;

typedef struct BkMaterial {
    char    name[80];
    float   base[4];        // baseColorFactor
    int     tex;            // индекс в BkScene.texs или -1
    int     tex_coord;      // номер набора UV (поддержан 0)
    BkAlpha alpha;
    float   cutoff;
} BkMaterial;

// Треугольник в мировых координатах glTF (после матриц узлов).
typedef struct BkTri {
    float p[3][3];
    float uv[3][2];
    int   material;
    bool  has_uv;
    // Скининг (Character): влияния вершин и узел меша (для жёстких креплений).
    bool     skinned;
    int      node;                  // узел с мешем
    int      skin;                  // индекс скина или -1
    uint16_t j[3][4];               // индексы в skin.joints
    float    w[3][4];
} BkTri;

// Узел сцены: нужен Character для скелета и владения частями.
typedef struct BkNode {
    char  name[64];
    int   parent;
    float world[16];                // мировая матрица (столбцы, как в glTF)
    float pos[3];                   // мировое положение начала узла
    int   humanoid;                 // индекс в BkVrm.bone_* или -1
} BkNode;

typedef struct BkSkin {
    int *joints;                    // индексы узлов
    int  n;
} BkSkin;

// Данные VRM (0.x: extensions.VRM, 1.0: VRMC_vrm).
#define BK_VRM_BONES 64
#define BK_VRM_EXPR  24
typedef struct BkVrm {
    int  version;                   // 0 — не VRM, 1 — VRM 0.x, 2 — VRM 1.0
    char title[128], author[128], license[128], spec[16];
    int  nbones;
    char bone_name[BK_VRM_BONES][24];
    int  bone_node[BK_VRM_BONES];
    int  nexpr;
    char expr[BK_VRM_EXPR][24];     // нормализованные имена пресетов выражений
} BkVrm;

typedef struct BkScene {
    BkTri      *tris;
    int         ntri, cap;
    BkMaterial *mats;
    int         nmat;
    BkTexture  *texs;
    int         ntex;
    BkNode     *nodes;
    int         nnode;
    BkSkin     *skin_list;
    int         nskin;
    BkVrm       vrm;
    int         skins, animations, meshes, primitives_skipped;
    char        source_kind[8];      // "glb" / "gltf"
} BkScene;

bool bk_load(const char *path, BkScene *scene, SdkReport *rep);
void bk_free(BkScene *scene);

// --- Параметры и результат bake ------------------------------------------------
typedef enum BkUvMode { BK_UV_AUTO = 0, BK_UV_EXISTING } BkUvMode;
typedef enum BkOrigin { BK_ORIGIN_CENTER = 0, BK_ORIGIN_FEET } BkOrigin;

typedef struct BkOptions {
    const char *type;       // "prop"
    const char *name;       // базовое имя ассета
    BkUvMode    uv;
    BkOrigin    origin;
    int         size;       // 1024 / 2048 / 4096 (размер PNG)
    float       scale;      // 0 — вписать автоматически
    float       margin;     // доля свободного места при авто-вписывании (0.98)
    int         first_id;   // ID первой части (80)
    const char *style;      // anime / pixel
} BkOptions;

typedef struct BkResult {
    bool   ok;
    int    parts, triangles, materials, textures;
    float  scale;
    float  min[3], max[3];          // габарит после вписывания (координаты Re2D)
    float  sample_spacing;          // шаг отсчёта в единицах модели (auto) или 0
    double atlas_usage;             // доля отсчётов с покрытием 0..1
    int    samples_active;
    int    uv_overlap_texels;
    char   png_path[1024], json_path[1024], report_path[1024], anim_path[1024];
    char  *report_json;             // машинно-читаемый отчёт (malloc), заполняется всегда
    char  *extra_json;              // character: владение, VRM, выражения (JSON-объект)
} BkResult;

// --- Character (VRM / humanoid → псевдоскелет Re2D) ---------------------------
#define CH_BONES 10
typedef struct ChRig {
    int   owner_bone[CH_BONES];     // не используется вызывающим; индексы 0..CH_BONES-1 фиксированы
    char  name[CH_BONES][24];       // имена костей Re2D (root, head, armLeft, ...)
    float pivot[CH_BONES][3];       // в координатах glTF (после поворота VRM 0.x)
    bool  have_hand[2], have_foot[2];
    float hand[2][3], foot[2][3];   // 0 — VRM left, 1 — VRM right
    int   slot_of_vrm_left;         // 0 — VRM left = Left по X<0
    bool  flipped;                  // VRM 0.x: модель повернута на 180° вокруг Y
    int   tris_per_bone[CH_BONES];
    int   ambiguous, rigid, unmapped_joints, total;
    int   pair[CH_BONES][CH_BONES]; // сколько неоднозначных треугольников делят кости
} ChRig;

// Назначает владельца каждому треугольнику (индекс кости 0..CH_BONES-1) по весам скина
// и humanoid VRM. Ошибки (нет humanoid, неполный набор костей) — в `rep`.
bool ch_assign(BkScene *scene, int *tri_owner, ChRig *rig, SdkReport *rep, const char *source);
void ch_json(R2dSb *out, const ChRig *rig, const float pivot_re2d[CH_BONES][3], const float hand_re2d[2][3], const float foot_re2d[2][3],
             const bool used[CH_BONES], int first_id, const char *atlas, const char *style, const char *anim_file);
void ch_anim_json(R2dSb *out, const ChRig *rig);
void ch_report_json(R2dSb *out, const ChRig *rig, const BkScene *scene);

void bk_default_options(BkOptions *o);
void bk_result_free(BkResult *res);

// Одна реализация bake для GUI и CLI. out_dir создаётся при необходимости.
bool bk_bake(const char *source, const char *out_dir, const BkOptions *opt, BkResult *res, SdkReport *rep);

// Пишет машинно-читаемый отчёт (docs/SDK.md §10) в `out` (как JSON-объект).
void bk_report_json(const BkResult *res, const BkOptions *opt, const BkScene *scene, const SdkReport *rep, R2dSb *out);

int sdk_cmd_bake_re2d(const SdkArgs *a);

#ifdef __cplusplus
}
#endif
