#pragma once
// Re2DSprite v3: плотная «геометрическая картинка» (docs/RE2DSPRITE_V3.md).
// PNG хранит сетку W×H из текселей; каждый тексель — цвет, позиция (16 бит на ось), нормаль,
// блеск и до 4 костей с весами. Рантайм строит из соседних текселей поверхность, переносит
// её костями и рисует в обычный 2D-спрайт (RGBA + карта глубины для World). Меша в игре нет.
#include <stdbool.h>
#include <stdint.h>
#include "rotsprite_math.h"

#define R3_MAX_LEVELS 8

typedef struct R3Level {
    int w, h, n, nq;
    float *pos;        // 3n: позиции в единицах Re2D
    int8_t *nrm;       // 3n: нормали ×127
    uint8_t *rgb;      // 3n: цвет (sRGB)
    uint8_t *spec;     // n: блеск
    uint8_t *bone;     // 4n: id костей (= id части, 1..254; 0 — нет)
    uint8_t *wt;       // 4n: веса, сумма 255
    uint32_t *quad;    // 4nq: углы ячейки (x,y), (x+1,y), (x,y+1), (x+1,y+1); порядок — по блокам 16×16 ячеек
    int nblocks;
    uint32_t *block;   // nblocks+1: начало блока в массиве quad (в ячейках)
    float spacing;     // медианное расстояние между соседними текселями (единицы Re2D)
} R3Level;

typedef struct R3Model {
    int levels, extent, grid_w, grid_h, vertices;
    R3Level lv[R3_MAX_LEVELS];
} R3Model;

// Освещение синтеза: в пространстве вида (x вправо, y вниз, z к зрителю).
typedef struct R3Light {
    float key_dir[3], key_col[3];      // основной свет (направление К источнику)
    float fill_dir[3], fill_col[3];    // заполняющий
    float sky[3], ground[3];           // полусферное окружение (вверх/вниз по экрану)
    float rim;                         // контровой свет по краю
    float spec;                        // множитель блеска
    float shine;                       // степень блика (мин. 4)
    float tint[3];                     // множитель итогового цвета (освещение мира)
} R3Light;
void r2d_rot3_default_light(R3Light *light);

// Параллельный цикл (по умолчанию последовательный): task(ctx, 0..count-1).
typedef void (*R3Task)(void *ctx, int index);
typedef void (*R3Parallel)(R3Task task, void *ctx, int count);

typedef struct R3Work {
    int size, ss, cap_vertices;
    float *depth;                      // (size*ss)²
    uint8_t *rgba;                     // (size*ss)²
    float *vx, *vy, *vz, *vn, *vc, *vs; // экранные позиции, нормаль вида, линейный цвет, блеск
    uint8_t *vhide;
    float *bb;                         // 4 числа на блок: минимум/максимум экранных x,y
    int cap_blocks;
    R3Parallel parallel;
    int bands;
    int bounds[4];                     // грязный прямоугольник внутреннего буфера
    int last_level;
    float detail;                      // наибольший размер текселя выбранного уровня в пикселях результата (по умолчанию 1.25)
    double last_ms[3];                 // замер: преобразование, растр, свёртка
} R3Work;
void r2d_rot3_work_free(R3Work *w);

bool r2d_rot3_header(const uint8_t *px, int w, int h, int stride);
bool r2d_rot3_decode(const uint8_t *px, int w, int h, int stride, R3Model *out);
void r2d_rot3_free(R3Model *m);

// out — RGBA size×size; sample_depth — size×size (глубина в долях холста, как у v2 anime).
// Матрицы костей берутся из rig->model (parts[id], их scale — масштаб проекции).
bool r2d_rot3_draw(const R3Model *m, double yaw, double pitch, const R2DRotRig *rig, const R3Light *light,
                   int size, R3Work *work, uint8_t *out, float *sample_depth);
