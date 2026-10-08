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
} BkTri;

typedef struct BkScene {
    BkTri      *tris;
    int         ntri, cap;
    BkMaterial *mats;
    int         nmat;
    BkTexture  *texs;
    int         ntex;
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
} BkResult;

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
