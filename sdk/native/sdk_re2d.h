// ===========================================================================
// Re2DSprite для инструментов SDK: PNG v2 (карты поверхности) и описание
// модели `*.character.json` (docs/RE2DSPRITE_V2.md, RE2DSPRITE_JSON.md).
//
// Это чтение данных, а не рендерер: SDK НЕ синтезирует спрайт (его синтезирует
// настоящий рантайм через `$.re2dSprite`). Здесь — декодирование карт для
// проверки и отладочных видов поверхности.
// ===========================================================================
#pragma once

#include "sdk.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RE2D_MAP_W 256          // отсчётов карты на рабочую сетку 1024×1024
#define RE2D_MAP_H 192

// PNG v2, загруженный целиком (RGBA8). `k = size/1024`: адреса рабочей сетки
// умножаются на k.
typedef struct Re2dPng {
    uint8_t *px;
    int      w, h;
    int      k;
    bool     header_ok;     // R2D / ROT / v2 в (0..2, 960)
    bool     sub;           // маркер SUB в (3, 960)
    bool     bld;           // маркер BLD в (4, 960)
    bool     size_ok;       // квадрат 1024/2048/3072/4096
} Re2dPng;

// Один отсчёт поверхности.
typedef struct Re2dSample {
    int   mx, my;
    int   id;               // основная часть (ID.R)
    int   group;            // группа материала (ID.G, только SUB)
    int   id2;              // вторая часть (ID.B, только BLD)
    int   coverage;         // 0 нет, 128 опора, 255 непрозрачный
    float x, y, z;
    bool  alpha_ok;         // alpha служебных каналов 255
    uint8_t r, g, b, a;     // средний цвет блока 4×4 (по непрозрачным texel)
} Re2dSample;

bool re2d_png_open(const char *path, Re2dPng *png);
void re2d_png_close(Re2dPng *png);
void re2d_sample(const Re2dPng *png, int mx, int my, Re2dSample *out);

// Палитры отладочных видов — общие для карт v2 и контейнера v3.
void re2d_hsv(float h, float s, float v, uint8_t *out);
void re2d_ramp(float t, uint8_t *out);

// Режимы отладочного вида (имена совпадают с --mode CLI).
typedef enum Re2dMode {
    RE2D_MODE_MATERIAL = 0,
    RE2D_MODE_PART,
    RE2D_MODE_OWNER,
    RE2D_MODE_X,
    RE2D_MODE_Y,
    RE2D_MODE_Z,
    RE2D_MODE_COVERAGE,
    RE2D_MODE_GROUP,
    RE2D_MODE_OVERLAP,
    RE2D_MODE_COUNT
} Re2dMode;

const char *re2d_mode_name(int mode);
int         re2d_mode_from_name(const char *name);

// Описание модели, нужное отладке: кто чем владеет (id → кость).
typedef struct Re2dOwners {
    int  count;
    int  ids[256];
    char bones[256][80];
    int  bone_index[256];   // индекс кости для раскраски
    bool declared[256];
    // Кости по индексу (id = индекс + 1): так адресует кости контейнер v3.
    int  bone_count;
    char bone_names[256][80];
} Re2dOwners;

// Загружает владельцев частей из character.json (NULL → пусто).
void re2d_owners_load(const char *model_path, Re2dOwners *owners);

// Общий разбор входа команд Re2DSprite: <png | character.json> → путь PNG и
// (необязательно) путь описания модели. Используется и v2-, и v3-командами.
bool re2d_resolve_inputs(const SdkArgs *a, char *png_path, size_t cap, const char **model_out, SdkReport *rep);

// Строит RGBA-изображение (RE2D_MAP_W*scale × RE2D_MAP_H*scale) отладочного вида.
uint8_t *re2d_debug_image(const Re2dPng *png, int mode, const Re2dOwners *owners, int scale, int *w, int *h);

// Статистика карт и проверка поверхности (docs/SDK.md §9).
typedef struct Re2dStats {
    int  active;                 // отсчётов с покрытием
    int  anchors;                // прозрачных опор (SUB)
    int  per_id[256];            // активных отсчётов по ID
    int  holes, isolated, seams, stale_id, bad_alpha, bad_id;
    int  first_hole[2], first_isolated[2], first_seam[2], first_bad_id[2];
    int  overlap_max;            // максимум отсчётов в одной ячейке фронтальной проекции
} Re2dStats;

void re2d_stats(const Re2dPng *png, Re2dStats *stats);

// Проверка PNG v2: пишет диагностики SDK_RE2D_PNG_* / SDK_RE2D_MAP_*.
// `declared` — ID частей из описания (NULL — не сравнивать).
void re2d_validate_png(const char *path, const Re2dPng *png, const Re2dStats *stats,
                       const bool declared[256], SdkReport *rep);

// Команды CLI.
int sdk_cmd_re2d_info(const SdkArgs *a);
int sdk_cmd_re2d_debug(const SdkArgs *a);
int sdk_cmd_re2d_sample(const SdkArgs *a);

// Валидатор `re2dsprite.character`.
void sdk_validate_re2d_character(const char *path, SdkReport *rep);

#ifdef __cplusplus
}
#endif
