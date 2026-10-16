// ===========================================================================
// Комплект шумов: реализация C-фасада (см. src/noise.h).
//
// Единственная задача этого файла — перевести C-конфигурацию в настройки
// FastNoiseLite и обратно, не добавляя ни одного собственного алгоритма шума.
// Все числа считает апстрим: именно поэтому наши значения обязаны совпадать с
// его эталонами, и это проверяется тестом.
//
// Компилируется как C++ (FastNoiseLite — заголовок C++); наружу отдаёт только
// C-функции из noise.h.
// ===========================================================================

#include "noise.h"

#include <FastNoiseLite.h>

#include <cmath>
#include <cstring>
#include <new>

// Непрозрачный для C тип: снаружи никто не знает, что внутри FastNoiseLite.
struct R2DNoise {
    FastNoiseLite fn;
};

// ---------------------------------------------------------------------------
// Настройки по умолчанию
// ---------------------------------------------------------------------------
// Значения взяты из конструктора апстрима (Cpp/FastNoiseLite.h: FastNoiseLite(int seed = 1337)):
// seed 1337, frequency 0.01, OpenSimplex2, без фрактала, 3 октавы,
// lacunarity 2.0, gain 0.5, weightedStrength 0, pingPongStrength 2.0,
// cellular: EuclideanSq / Distance / jitter 1.0, warp: OpenSimplex2 / amp 1.0.
// Если апстрим поменяет умолчания, это поймает сверка эталона: она снимает
// значения с непатченного заголовка.

void r2d_noise_config_defaults(R2DNoiseConfig *cfg)
{
    if (!cfg) return;
    std::memset(cfg, 0, sizeof(*cfg));
    cfg->source            = R2D_NOISE_SIMPLEX2;
    cfg->seed              = 1337;
    cfg->frequency         = 0.01f;
    cfg->fractal           = R2D_NOISE_FRACTAL_NONE;
    cfg->octaves           = 3;
    cfg->lacunarity        = 2.0f;
    cfg->gain              = 0.5f;
    cfg->weighted_strength = 0.0f;
    cfg->pingpong_strength = 2.0f;
    cfg->cell_distance     = R2D_NOISE_CELL_EUCLIDEAN_SQ;
    cfg->cell_return       = R2D_NOISE_CELL_DIST;
    cfg->cell_jitter       = 1.0f;
    cfg->warp_type         = R2D_NOISE_WARP_SIMPLEX2;
    cfg->warp_amp          = 1.0f;
    cfg->warp_fractal      = R2D_NOISE_WARP_FRACTAL_NONE;
    cfg->warp_octaves      = 3;
    cfg->warp_lacunarity   = 2.0f;
    cfg->warp_gain         = 0.5f;
    cfg->rotation3d        = R2D_NOISE_ROT3D_NONE;
}

// ---------------------------------------------------------------------------
// Проверка конфигурации
// ---------------------------------------------------------------------------
// Задача — отвергнуть заведомый мусор до создания генератора, а не «починить»
// его молча: молчаливая правка параметра означала бы, что игра получает не то,
// что попросила. Сравнения написаны так, чтобы NaN не проходил нигде.

static bool in_range(float v, float lo, float hi)
{
    return v >= lo && v <= hi;   // NaN не проходит ни одно сравнение
}

bool r2d_noise_config_valid(const R2DNoiseConfig *cfg)
{
    if (!cfg) return false;
    if (cfg->source < 0 || cfg->source >= R2D_NOISE_SOURCE_COUNT) return false;
    if (cfg->fractal < 0 || cfg->fractal >= R2D_NOISE_FRACTAL_COUNT) return false;
    if (cfg->cell_distance < 0 || cfg->cell_distance >= R2D_NOISE_CELL_DISTANCE_COUNT)
        return false;
    if (cfg->cell_return < 0 || cfg->cell_return >= R2D_NOISE_CELL_RETURN_COUNT)
        return false;
    if (cfg->warp_type < 0 || cfg->warp_type >= R2D_NOISE_WARP_COUNT) return false;
    if (cfg->warp_fractal < 0 || cfg->warp_fractal >= R2D_NOISE_WARP_FRACTAL_COUNT)
        return false;
    if (cfg->rotation3d < 0 || cfg->rotation3d >= R2D_NOISE_ROT3D_COUNT) return false;

    // Частота 0 даёт константу, отрицательная — зеркало; и то и другое почти
    // всегда опечатка, а не замысел.
    if (!(cfg->frequency > 0.0f) || cfg->frequency > 10000.0f) return false;
    if (cfg->octaves < 1 || cfg->octaves > R2D_NOISE_MAX_OCTAVES) return false;
    if (!(cfg->lacunarity > 0.0f) || cfg->lacunarity > 100.0f) return false;
    if (!in_range(cfg->gain, 0.0f, 1.0f)) return false;
    if (!in_range(cfg->weighted_strength, 0.0f, 1.0f)) return false;
    if (!in_range(cfg->pingpong_strength, 0.0f, 100.0f)) return false;
    // jitter > 1 разрешён апстримом: сетка ячеек «плывёт» сильнее обычного.
    if (!in_range(cfg->cell_jitter, 0.0f, 2.0f)) return false;
    if (!(cfg->warp_amp >= 0.0f) || cfg->warp_amp > 10000.0f) return false;
    if (cfg->warp_octaves < 1 || cfg->warp_octaves > R2D_NOISE_MAX_OCTAVES) return false;
    if (!(cfg->warp_lacunarity > 0.0f) || cfg->warp_lacunarity > 100.0f) return false;
    if (!in_range(cfg->warp_gain, 0.0f, 1.0f)) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Перечисление → enum апстрима
// ---------------------------------------------------------------------------

static FastNoiseLite::NoiseType source_of(int source)
{
    switch (source) {
        case R2D_NOISE_SIMPLEX2:  return FastNoiseLite::NoiseType_OpenSimplex2;
        case R2D_NOISE_SIMPLEX2S: return FastNoiseLite::NoiseType_OpenSimplex2S;
        case R2D_NOISE_PERLIN:    return FastNoiseLite::NoiseType_Perlin;
        case R2D_NOISE_VALUE:     return FastNoiseLite::NoiseType_Value;
        case R2D_NOISE_CUBIC:     return FastNoiseLite::NoiseType_ValueCubic;
        default:                  return FastNoiseLite::NoiseType_Cellular;
    }
}

static FastNoiseLite::FractalType fractal_of(int fractal)
{
    switch (fractal) {
        case R2D_NOISE_FRACTAL_FBM:      return FastNoiseLite::FractalType_FBm;
        case R2D_NOISE_FRACTAL_RIDGED:   return FastNoiseLite::FractalType_Ridged;
        case R2D_NOISE_FRACTAL_PINGPONG: return FastNoiseLite::FractalType_PingPong;
        default:                         return FastNoiseLite::FractalType_None;
    }
}

static FastNoiseLite::CellularDistanceFunction cell_distance_of(int mode)
{
    switch (mode) {
        case R2D_NOISE_CELL_EUCLIDEAN:    return FastNoiseLite::CellularDistanceFunction_Euclidean;
        case R2D_NOISE_CELL_MANHATTAN:    return FastNoiseLite::CellularDistanceFunction_Manhattan;
        case R2D_NOISE_CELL_HYBRID:       return FastNoiseLite::CellularDistanceFunction_Hybrid;
        default:                          return FastNoiseLite::CellularDistanceFunction_EuclideanSq;
    }
}

static FastNoiseLite::CellularReturnType cell_return_of(int mode)
{
    switch (mode) {
        case R2D_NOISE_CELL_VALUE:        return FastNoiseLite::CellularReturnType_CellValue;
        case R2D_NOISE_CELL_DIST2:        return FastNoiseLite::CellularReturnType_Distance2;
        case R2D_NOISE_CELL_DIST2_ADD:    return FastNoiseLite::CellularReturnType_Distance2Add;
        case R2D_NOISE_CELL_DIST2_SUB:    return FastNoiseLite::CellularReturnType_Distance2Sub;
        case R2D_NOISE_CELL_DIST2_MUL:    return FastNoiseLite::CellularReturnType_Distance2Mul;
        case R2D_NOISE_CELL_DIST2_DIV:    return FastNoiseLite::CellularReturnType_Distance2Div;
        default:                          return FastNoiseLite::CellularReturnType_Distance;
    }
}

static FastNoiseLite::DomainWarpType warp_of(int type)
{
    switch (type) {
        case R2D_NOISE_WARP_SIMPLEX2_REDUCED: return FastNoiseLite::DomainWarpType_OpenSimplex2Reduced;
        case R2D_NOISE_WARP_BASIC_GRID:       return FastNoiseLite::DomainWarpType_BasicGrid;
        default:                              return FastNoiseLite::DomainWarpType_OpenSimplex2;
    }
}

static FastNoiseLite::RotationType3D rotation_of(int mode)
{
    switch (mode) {
        case R2D_NOISE_ROT3D_IMPROVE_XY: return FastNoiseLite::RotationType3D_ImproveXYPlanes;
        case R2D_NOISE_ROT3D_IMPROVE_XZ: return FastNoiseLite::RotationType3D_ImproveXZPlanes;
        default:                         return FastNoiseLite::RotationType3D_None;
    }
}

// ---------------------------------------------------------------------------
// Создание и настройка
// ---------------------------------------------------------------------------

R2DNoise *r2d_noise_create(const R2DNoiseConfig *cfg)
{
    if (!r2d_noise_config_valid(cfg)) return nullptr;

    R2DNoise *noise = new (std::nothrow) R2DNoise();
    if (!noise) return nullptr;

    FastNoiseLite &fn = noise->fn;
    fn.SetSeed(cfg->seed);
    fn.SetNoiseType(source_of(cfg->source));
    fn.SetFrequency(cfg->frequency);
    fn.SetRotationType3D(rotation_of(cfg->rotation3d));

    fn.SetFractalType(fractal_of(cfg->fractal));
    fn.SetFractalOctaves(cfg->octaves);
    fn.SetFractalLacunarity(cfg->lacunarity);
    fn.SetFractalGain(cfg->gain);
    fn.SetFractalWeightedStrength(cfg->weighted_strength);
    fn.SetFractalPingPongStrength(cfg->pingpong_strength);

    fn.SetCellularDistanceFunction(cell_distance_of(cfg->cell_distance));
    fn.SetCellularReturnType(cell_return_of(cfg->cell_return));
    fn.SetCellularJitter(cfg->cell_jitter);

    fn.SetDomainWarpType(warp_of(cfg->warp_type));
    fn.SetDomainWarpAmp(cfg->warp_amp);
    // Фрактальность warp задаётся тем же полем FractalType: у апстрима
    // DomainWarp() сам выбирает progressive/independent по нему.
    if (cfg->warp_fractal != R2D_NOISE_WARP_FRACTAL_NONE) {
        fn.SetFractalType(cfg->warp_fractal == R2D_NOISE_WARP_FRACTAL_PROGRESSIVE
                              ? FastNoiseLite::FractalType_DomainWarpProgressive
                              : FastNoiseLite::FractalType_DomainWarpIndependent);
        fn.SetFractalOctaves(cfg->warp_octaves);
        fn.SetFractalLacunarity(cfg->warp_lacunarity);
        fn.SetFractalGain(cfg->warp_gain);
    }
    return noise;
}

void r2d_noise_destroy(R2DNoise *noise) { delete noise; }

// ---------------------------------------------------------------------------
// Поштучные вызовы
// ---------------------------------------------------------------------------

float r2d_noise_get2(const R2DNoise *noise, float x, float y)
{
    if (!noise) return 0.0f;
    return noise->fn.GetNoise(x, y);
}

float r2d_noise_get3(const R2DNoise *noise, float x, float y, float z)
{
    if (!noise) return 0.0f;
    return noise->fn.GetNoise(x, y, z);
}

void r2d_noise_warp2(const R2DNoise *noise, float x, float y,
                     float *out_x, float *out_y)
{
    float wx = x, wy = y;
    if (noise) noise->fn.DomainWarp(wx, wy);
    if (out_x) *out_x = wx;
    if (out_y) *out_y = wy;
}

void r2d_noise_warp3(const R2DNoise *noise, float x, float y, float z,
                     float *out_x, float *out_y, float *out_z)
{
    float wx = x, wy = y, wz = z;
    if (noise) noise->fn.DomainWarp(wx, wy, wz);
    if (out_x) *out_x = wx;
    if (out_y) *out_y = wy;
    if (out_z) *out_z = wz;
}

// ---------------------------------------------------------------------------
// Массовый путь
// ---------------------------------------------------------------------------
// Координаты считаются в double и только потом округляются до float — ровно
// так же, как их видит поштучный вызов из JS (там число приходит double и
// приводится к float на входе в биндинг). Поэтому field() и get2() дают
// побитово одно и то же; это проверяет тест.

void r2d_noise_field2(const R2DNoise *noise, float *out, int w, int h,
                      double x0, double y0, double step_x, double step_y)
{
    if (!noise || !out || w <= 0 || h <= 0) return;
    for (int j = 0; j < h; j++) {
        const float y = (float)(y0 + (double)j * step_y);
        float *row = out + (size_t)j * (size_t)w;
        for (int i = 0; i < w; i++) {
            const float x = (float)(x0 + (double)i * step_x);
            row[i] = noise->fn.GetNoise(x, y);
        }
    }
}

void r2d_noise_field3(const R2DNoise *noise, float *out, int w, int h, float z,
                      double x0, double y0, double step_x, double step_y)
{
    if (!noise || !out || w <= 0 || h <= 0) return;
    for (int j = 0; j < h; j++) {
        const float y = (float)(y0 + (double)j * step_y);
        float *row = out + (size_t)j * (size_t)w;
        for (int i = 0; i < w; i++) {
            const float x = (float)(x0 + (double)i * step_x);
            row[i] = noise->fn.GetNoise(x, y, z);
        }
    }
}

// Серый RGBA: значение → канал. Округление и зажим в [0,255] — шум вправе
// выйти за [-1,1] (фракталы с усилением), и молча завернуть его в байт без
// зажима означало бы «128 + переполнение» вместо честного края диапазона.
static uint8_t gray_byte(float value)
{
    const float v = value * 0.5f + 0.5f;
    const float scaled = v * 255.0f + 0.5f;
    if (!(scaled > 0.0f)) return 0;        // сюда же NaN
    if (scaled >= 255.0f) return 255;
    return (uint8_t)scaled;
}

void r2d_noise_field2_rgba(const R2DNoise *noise, uint8_t *out, int w, int h,
                           double x0, double y0, double step_x, double step_y)
{
    if (!noise || !out || w <= 0 || h <= 0) return;
    for (int j = 0; j < h; j++) {
        const float y = (float)(y0 + (double)j * step_y);
        uint8_t *row = out + (size_t)j * (size_t)w * 4u;
        for (int i = 0; i < w; i++) {
            const float x = (float)(x0 + (double)i * step_x);
            const uint8_t g = gray_byte(noise->fn.GetNoise(x, y));
            row[i * 4 + 0] = g;
            row[i * 4 + 1] = g;
            row[i * 4 + 2] = g;
            row[i * 4 + 3] = 255;
        }
    }
}
