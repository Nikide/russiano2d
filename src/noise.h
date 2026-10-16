// ===========================================================================
// Комплект шумов: тонкий C-фасад над FastNoiseLite (см. third_party/fastnoise_lite).
//
// Зачем фасад. FastNoiseLite — заголовок C++; движок и его биндинги написаны на
// C. Здесь ровно прослойка: конфигурация в C-структуре, снаружи C-функции,
// внутри — один объект FastNoiseLite. Никакой второй реализации шума: все
// числа считает апстрим, поэтому эталонные значения из его тестов совпадают с
// нашими (tests/agent/noise_set_test.py).
//
// Правило зерна — как у остальных шумов движка: если зерно не задано явно, его
// подставляет JS-слой (зерно сессии, `--seed`); в C «нулевого» зерна по
// умолчанию нет, чтобы нельзя было случайно получить одинаковый всегда мир.
//
// Зоны ответственности: C — конфигурация, поштучный вызов, массовая сетка и
// упаковка в RGBA; JS ($.noise) — имена, параметры по умолчанию, разбор
// опций, зерно сессии и кэш генераторов.
// ===========================================================================

#ifndef R2D_NOISE_H
#define R2D_NOISE_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Источники шума. Значения — часть публичного контракта (их передаёт JS),
// поэтому перечисление фиксировано и не следует порядку enum апстрима.
typedef enum {
    R2D_NOISE_SIMPLEX2 = 0,   // OpenSimplex2
    R2D_NOISE_SIMPLEX2S,      // OpenSimplex2S — сглаженный вариант
    R2D_NOISE_PERLIN,
    R2D_NOISE_VALUE,          // value noise
    R2D_NOISE_CUBIC,          // ValueCubic — кубическая интерполяция value
    R2D_NOISE_CELLULAR,       // Worley
    R2D_NOISE_SOURCE_COUNT
} R2DNoiseSource;

// Фрактал поверх выбранного источника.
typedef enum {
    R2D_NOISE_FRACTAL_NONE = 0,
    R2D_NOISE_FRACTAL_FBM,
    R2D_NOISE_FRACTAL_RIDGED,
    R2D_NOISE_FRACTAL_PINGPONG,
    R2D_NOISE_FRACTAL_COUNT
} R2DNoiseFractal;

// Метрика расстояния для cellular.
typedef enum {
    R2D_NOISE_CELL_EUCLIDEAN = 0,
    R2D_NOISE_CELL_EUCLIDEAN_SQ,
    R2D_NOISE_CELL_MANHATTAN,
    R2D_NOISE_CELL_HYBRID,
    R2D_NOISE_CELL_DISTANCE_COUNT
} R2DNoiseCellDistance;

// Что возвращает cellular.
typedef enum {
    R2D_NOISE_CELL_VALUE = 0,      // значение своей ячейки
    R2D_NOISE_CELL_DIST,           // расстояние до ближайшей
    R2D_NOISE_CELL_DIST2,          // до второй ближайшей
    R2D_NOISE_CELL_DIST2_ADD,
    R2D_NOISE_CELL_DIST2_SUB,
    R2D_NOISE_CELL_DIST2_MUL,
    R2D_NOISE_CELL_DIST2_DIV,
    R2D_NOISE_CELL_RETURN_COUNT
} R2DNoiseCellReturn;

// Тип domain warp.
typedef enum {
    R2D_NOISE_WARP_SIMPLEX2 = 0,
    R2D_NOISE_WARP_SIMPLEX2_REDUCED,
    R2D_NOISE_WARP_BASIC_GRID,
    R2D_NOISE_WARP_COUNT
} R2DNoiseWarpType;

// Поворот осей для 3D (апстрим: RotationType3D). У апстрима вариантов ровно
// два, кроме «без поворота»: ImproveXY и ImproveXZ — третий не выдумываем.
typedef enum {
    R2D_NOISE_ROT3D_NONE = 0,
    R2D_NOISE_ROT3D_IMPROVE_XY,
    R2D_NOISE_ROT3D_IMPROVE_XZ,
    R2D_NOISE_ROT3D_COUNT
} R2DNoiseRotation3D;

// Фрактал внутри domain warp. Внимание: у апстрима fractal-режим один на
// объект — он же задаёт фрактал самого шума. Поэтому «фрактальный шум и
// фрактальный warp в одном генераторе» невозможно, и JS-слой обязан сказать
// об этом явно, а не подменить одно другим.
typedef enum {
    R2D_NOISE_WARP_FRACTAL_NONE = 0,
    R2D_NOISE_WARP_FRACTAL_PROGRESSIVE,
    R2D_NOISE_WARP_FRACTAL_INDEPENDENT,
    R2D_NOISE_WARP_FRACTAL_COUNT
} R2DNoiseWarpFractal;

// Полная конфигурация генератора. Все поля — простые числа: JS передаёт их
// через биндинги, структура живёт на стеке вызывающего.
typedef struct R2DNoiseConfig {
    int   source;              // R2DNoiseSource
    int   seed;                // задаёт JS (зерно сессии или явное)
    float frequency;           // 0.01 по умолчанию у апстрима
    int   fractal;             // R2DNoiseFractal
    int   octaves;             // 1..R2D_NOISE_MAX_OCTAVES
    float lacunarity;
    float gain;
    float weighted_strength;   // для fBm/ridged: ослабление октав
    float pingpong_strength;   // для pingpong
    int   cell_distance;       // R2DNoiseCellDistance
    int   cell_return;         // R2DNoiseCellReturn
    float cell_jitter;
    int   warp_type;           // R2DNoiseWarpType
    float warp_amp;            // 0 — warp выключен
    int   warp_fractal;        // R2DNoiseWarpFractal
    int   warp_octaves;
    float warp_lacunarity;
    float warp_gain;
    int   rotation3d;          // R2DNoiseRotation3D
} R2DNoiseConfig;

//: Предел октав: апстрим допускает больше, но 8 — уже 256 сэмплов на точку,
//: а биндинг должен отвергать заведомо случайные числа, а не считать их час.
#define R2D_NOISE_MAX_OCTAVES 12

// Настройки «как в апстриме»: тот же генератор, что в его примерах и тестах.
// Нужны и как база для параметров по умолчанию в JS, и для сверки с эталоном.
void r2d_noise_config_defaults(R2DNoiseConfig *cfg);

// Проверка конфигурации: false — значения вне диапазона (тогда create вернёт
// NULL, а биндинг скажет, что именно не так).
bool r2d_noise_config_valid(const R2DNoiseConfig *cfg);

// Генератор. Определение — в noise.cpp (там живёт объект FastNoiseLite).
typedef struct R2DNoise R2DNoise;

// NULL — конфигурация не прошла проверку.
R2DNoise *r2d_noise_create(const R2DNoiseConfig *cfg);
void      r2d_noise_destroy(R2DNoise *noise);

// Поштучный вызов. Диапазон — как у апстрима (обычно примерно [-1, 1]).
float r2d_noise_get2(const R2DNoise *noise, float x, float y);
float r2d_noise_get3(const R2DNoise *noise, float x, float y, float z);

// Domain warp: смещает точку (x, y) и возвращает результат в *out_x/*out_y.
// Отдельный вызов, а не флаг у get2: JS должен уметь и «шум в искажённой
// точке» (warp + get2), и сами сдвиги.
void r2d_noise_warp2(const R2DNoise *noise, float x, float y,
                     float *out_x, float *out_y);
void r2d_noise_warp3(const R2DNoise *noise, float x, float y, float z,
                     float *out_x, float *out_y, float *out_z);

// Массовый путь: сетка w×h с началом (x0, y0) и шагом (step_x, step_y),
// построчно (строка y — последовательные x). Значения — ровно те же, что дал
// бы поштучный r2d_noise_get2 для тех же координат: считает одна и та же
// функция апстрима, а не «похожая» формула.
// Начало и шаг — double: координаты i-й точки считаются как
// (float)(x0 + i * step) в double-арифметике, то есть ровно так же, как их
// видит поштучный вызов (JS передаёт double, биндинг округляет до float).
// Поэтому field() и get2() дают побитово одно и то же.
void r2d_noise_field2(const R2DNoise *noise, float *out, int w, int h,
                      double x0, double y0, double step_x, double step_y);
void r2d_noise_field3(const R2DNoise *noise, float *out, int w, int h, float z,
                      double x0, double y0, double step_x, double step_y);

// Готовые пиксели RGBA (серый по значению): value [-1,1] → канал
// round((value * 0.5 + 0.5) * 255), альфа 255. Массив сразу годится в
// engine.textureFromPixels — без поштучного JS на 65 536 пикселей.
void r2d_noise_field2_rgba(const R2DNoise *noise, uint8_t *out, int w, int h,
                           double x0, double y0, double step_x, double step_y);

#ifdef __cplusplus
}
#endif

#endif  // R2D_NOISE_H
