// ===========================================================================
// Re2DSprite v3 для инструментов SDK: чтение плотного контейнера (цвет,
// позиция, нормаль+блеск, кости, веса) и правка сетки текселей
// (docs/RE2DSPRITE_V3.md).
//
// Это чтение данных и правка данных, а не рендерер: SDK НЕ синтезирует спрайт
// (его синтезирует настоящий рантайм через `$.re2dSprite`) и не меняет формат —
// контейнер остаётся PNG `3·W × (1 + 2·H)`, который читает ядро
// (src/rotsprite3.c). Запись возвращает тот же контейнер: заголовок строки 0
// не пересобирается, меняются только слои сетки.
// ===========================================================================
#pragma once

#include "sdk.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RE2D3_LAYERS         6      // цвет, позиция hi, позиция lo, нормаль+блеск, кости, веса
#define RE2D3_MAX_GRID       4096

// Контейнер v3, загруженный целиком (RGBA8).
typedef struct Re2d3Png {
    uint8_t *px;
    int      w, h;          // размер PNG: cols·W × (1 + ряды·H)
    int      tw, th;        // сетка текселей (W × H из заголовка)
    int      cols, layers, extent;
    bool     header_ok;     // R2D / ROT / (3,0,0) в первых четырёх пикселях
    bool     size_ok;       // размеры PNG совпадают с заголовком
    bool     editable;      // ровно шесть слоёв — правка сетки поддержана
    int      live;          // текселей с alpha слоя позиции 255
} Re2d3Png;

// Один тексель плотной поверхности.
typedef struct Re2d3Sample {
    int     x, y;
    bool    live;
    uint8_t rgba[4];        // цвет (слой 0); alpha живого текселя 255
    float   px, py, pz;     // позиция в единицах Re2D (−128…128)
    float   nx, ny, nz;     // нормаль −1…1
    int     gloss;          // 0…255 (alpha слоя нормали)
    int     bones[4];       // id костей 1…255 (в контейнере хранится id−1)
    int     weights[4];     // веса 0…255, сумма 255
} Re2d3Sample;

// `path` — PNG контейнера v3. false — файл не читается (формат проверяет
// вызывающий через header_ok/size_ok, чтобы диагностика была точной).
bool re2d3_open(const char *path, Re2d3Png *png);
// То же из уже загруженных пикселей: контейнер забирает владение `pixels`.
bool re2d3_open_mem(uint8_t *pixels, int w, int h, Re2d3Png *png);
void re2d3_close(Re2d3Png *png);

void re2d3_sample(const Re2d3Png *png, int x, int y, Re2d3Sample *out);

// Статистика сетки: факты для `re2d-info` и проверки.
typedef struct Re2d3Stats {
    int    live, slots;
    int    bone_texels[256];      // живых текселей, где кость доминирует по весу
    double bone_weight[256];      // сумма весов по костям
    int    bones_used;            // сколько костей встречается
    int    bad_weights;           // сумма весов != 255
    int    zero_weights;          // сумма весов == 0
    int    bad_normal;            // нулевая нормаль
    int    bad_color_alpha;       // цвет живого текселя с alpha != 255
    int    bad_position_alpha;    // служебная alpha слоёв позиции не 255
    int    gloss_min, gloss_max;
    double gloss_mean;
    float  pos_min[3], pos_max[3];
    int    isolated;              // живые тексели без живых соседей (4 связности)
    int    first_isolated[2];
} Re2d3Stats;

void re2d3_stats(const Re2d3Png *png, Re2d3Stats *st);

// Отладочные виды поверх сетки текселей (имена совпадают с `--mode`).
typedef enum Re2d3Mode {
    RE2D3_MODE_MATERIAL = 0,
    RE2D3_MODE_NORMAL,
    RE2D3_MODE_GLOSS,
    RE2D3_MODE_OWNER,
    RE2D3_MODE_WEIGHT,
    RE2D3_MODE_COVERAGE,
    RE2D3_MODE_X,
    RE2D3_MODE_Y,
    RE2D3_MODE_Z,
    RE2D3_MODE_COUNT
} Re2d3Mode;

const char *re2d3_mode_name(int mode);
int         re2d3_mode_from_name(const char *name);

// Изображение tw·scale × th·scale (RGBA8, malloc) или NULL.
uint8_t *re2d3_debug_image(const Re2d3Png *png, int mode, int scale, int *out_w, int *out_h);

// Проверка контейнера: диагностики SDK_RE2D3_*.
void re2d3_validate_png(const char *path, const Re2d3Png *png, const Re2d3Stats *st, SdkReport *rep);

// --- Правка сетки (редактор «Сетка») --------------------------------------
// Меняются только живые тексели прямоугольника [x, x+w) × [y, y+h); выходит за
// границы сетки — обрезается. Возвращают число затронутых живых текселей.
int re2d3_paint_bone(Re2d3Png *png, int x, int y, int w, int h, const int bones[4], const int weights[4]);
int re2d3_paint_gloss(Re2d3Png *png, int x, int y, int w, int h, int gloss);
int re2d3_paint_color(Re2d3Png *png, int x, int y, int w, int h, const uint8_t rgb[3]);

// Запись контейнера (атомарная: временный файл → rename).
bool re2d3_write(const Re2d3Png *png, const char *path);

// --- Команды CLI ----------------------------------------------------------
// `re2d3-paint <png|character.json> --edits ops.json [--out путь]`:
// применяет операции к сетке и пишет контейнер.
int sdk_cmd_re2d3_paint(const SdkArgs *a);

// Версия контейнера: 3 — Re2DSprite v3 (`png` остаётся открытым, владелец —
// вызывающий), 2 — не v3 (`png` закрыт: читайте карты v2 обычным путём),
// 0 — файл не декодируется. Заголовок v3 живёт в пикселях, а не в байтах
// файла, поэтому проверка идёт после декодирования — но только один раз.
int re2d_container_version(const char *path, Re2d3Png *png);

#ifdef __cplusplus
}
#endif
