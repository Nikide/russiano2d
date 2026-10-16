// Эталонные значения из НЕПАТЧЕННОГО апстрима FastNoiseLite.
//
// Зачем файл лежит в репозитории: числа в tests/agent/noise_set_test.py — не
// «наши», а снятые с оригинального заголовка. Читающий тест должен уметь
// проверить это сам, а не верить комментарию.
//
// Запуск (заголовок — ровно тот, что вендорен рядом, без правок):
//   c++ -O2 -std=c++17 -I third_party/fastnoise_lite \
//       third_party/fastnoise_lite/reference.cpp -o /tmp/fnl_ref && /tmp/fnl_ref
//
// Печатает таблицу `имя значение...`; значения перенесены в тест как GOLD.
// Строка readme_4x4 дополнительно сверена с опубликованным тестом апстрима
// (JavaScript/test/FastNoiseLite.test.ts, коммит 785f37a): числа совпадают до
// последнего знака формата (%.5f), а readme_warp — точно (0.98362, 1.95825).
#include <FastNoiseLite.h>
#include <cstdio>

static void same_line(const char *label, FastNoiseLite &n, float x, float y)
{
    std::printf("%s %.9g\n", label, (double)n.GetNoise(x, y));
}

int main()
{
    // 1. Пример из README/JS-теста апстрима: OpenSimplex2 по умолчанию (seed 1337,
    //    frequency 0.01), сетка 4x4. Именно эти числа опубликованы в апстриме.
    {
        FastNoiseLite n;
        n.SetNoiseType(FastNoiseLite::NoiseType_OpenSimplex2);
        std::printf("readme_4x4");
        for (int x = 0; x < 4; x++)
            for (int y = 0; y < 4; y++)
                std::printf(" %.5f", (double)n.GetNoise((float)x, (float)y));
        std::printf("\n");
    }

    // 2. Domain warp из README апстрима: тип OpenSimplex2, amp 1.5, точка (1,2).
    {
        FastNoiseLite n;
        n.SetDomainWarpType(FastNoiseLite::DomainWarpType_OpenSimplex2);
        n.SetDomainWarpAmp(1.5f);
        float x = 1.0f, y = 2.0f;
        n.DomainWarp(x, y);
        std::printf("readme_warp %.5f %.5f\n", (double)x, (double)y);
    }

    // 3. По источникам: seed 1337, frequency 0.01, точка (12.5, -3.25).
    {
        const FastNoiseLite::NoiseType types[] = {
            FastNoiseLite::NoiseType_OpenSimplex2, FastNoiseLite::NoiseType_OpenSimplex2S,
            FastNoiseLite::NoiseType_Perlin, FastNoiseLite::NoiseType_Value,
            FastNoiseLite::NoiseType_ValueCubic, FastNoiseLite::NoiseType_Cellular,
        };
        const char *names[] = {"simplex2", "simplex2S", "perlin", "value", "cubic", "cellular"};
        for (int i = 0; i < 6; i++) {
            FastNoiseLite n;
            n.SetSeed(1337);
            n.SetFrequency(0.01f);
            n.SetNoiseType(types[i]);
            std::printf("src_%s %.9g %.9g\n", names[i],
                        (double)n.GetNoise(12.5f, -3.25f), (double)n.GetNoise(0.0f, 0.0f));
        }
    }

    // 4. 3D (perlin) и большие/отрицательные координаты.
    {
        FastNoiseLite n;
        n.SetSeed(1337);
        n.SetFrequency(0.01f);
        n.SetNoiseType(FastNoiseLite::NoiseType_Perlin);
        std::printf("perlin3d %.9g\n", (double)n.GetNoise(12.5f, -3.25f, 0.75f));
        std::printf("perlin_big %.9g %.9g\n",
                    (double)n.GetNoise(1.0e6f, 1.0e6f), (double)n.GetNoise(-999999.5f, 123456.25f));
    }

    // 5. Фракталы: simplex2, octaves 5, lacunarity 2, gain 0.5, frequency 0.01.
    {
        const FastNoiseLite::FractalType fr[] = {
            FastNoiseLite::FractalType_FBm, FastNoiseLite::FractalType_Ridged,
            FastNoiseLite::FractalType_PingPong};
        const char *names[] = {"fbm", "ridged", "pingpong"};
        for (int i = 0; i < 3; i++) {
            FastNoiseLite n;
            n.SetSeed(1337);
            n.SetFrequency(0.01f);
            n.SetNoiseType(FastNoiseLite::NoiseType_OpenSimplex2);
            n.SetFractalType(fr[i]);
            n.SetFractalOctaves(5);
            n.SetFractalLacunarity(2.0f);
            n.SetFractalGain(0.5f);
            std::printf("frac_%s %.9g\n", names[i], (double)n.GetNoise(12.5f, -3.25f));
        }
    }

    // 6. Cellular: метрики расстояния и типы возврата.
    {
        const FastNoiseLite::CellularDistanceFunction dist[] = {
            FastNoiseLite::CellularDistanceFunction_Euclidean,
            FastNoiseLite::CellularDistanceFunction_EuclideanSq,
            FastNoiseLite::CellularDistanceFunction_Manhattan,
            FastNoiseLite::CellularDistanceFunction_Hybrid};
        const char *dnames[] = {"euclidean", "euclideanSq", "manhattan", "hybrid"};
        for (int i = 0; i < 4; i++) {
            FastNoiseLite n;
            n.SetSeed(1337);
            n.SetFrequency(0.01f);
            n.SetNoiseType(FastNoiseLite::NoiseType_Cellular);
            n.SetCellularDistanceFunction(dist[i]);
            n.SetCellularReturnType(FastNoiseLite::CellularReturnType_Distance);
            std::printf("cell_%s %.9g\n", dnames[i], (double)n.GetNoise(12.5f, -3.25f));
        }
        const FastNoiseLite::CellularReturnType ret[] = {
            FastNoiseLite::CellularReturnType_CellValue,
            FastNoiseLite::CellularReturnType_Distance,
            FastNoiseLite::CellularReturnType_Distance2,
            FastNoiseLite::CellularReturnType_Distance2Add,
            FastNoiseLite::CellularReturnType_Distance2Sub,
            FastNoiseLite::CellularReturnType_Distance2Mul,
            FastNoiseLite::CellularReturnType_Distance2Div};
        const char *rnames[] = {"value", "distance", "distance2", "distance2Add",
                                "distance2Sub", "distance2Mul", "distance2Div"};
        for (int i = 0; i < 7; i++) {
            FastNoiseLite n;
            n.SetSeed(1337);
            n.SetFrequency(0.01f);
            n.SetNoiseType(FastNoiseLite::NoiseType_Cellular);
            n.SetCellularDistanceFunction(FastNoiseLite::CellularDistanceFunction_Hybrid);
            n.SetCellularReturnType(ret[i]);
            std::printf("cellret_%s %.9g\n", rnames[i], (double)n.GetNoise(12.5f, -3.25f));
        }
    }

    // 7. Domain warp с фракталом (progressive, 3 октавы) — отдельная настройка
    //    fractal-режима, как в апстриме.
    {
        FastNoiseLite n;
        n.SetSeed(1337);
        n.SetFrequency(0.01f);
        n.SetDomainWarpType(FastNoiseLite::DomainWarpType_OpenSimplex2);
        n.SetDomainWarpAmp(1.5f);
        n.SetFractalType(FastNoiseLite::FractalType_DomainWarpProgressive);
        n.SetFractalOctaves(3);
        float x = 12.5f, y = -3.25f;
        n.DomainWarp(x, y);
        std::printf("warp_progressive %.9g %.9g\n", (double)x, (double)y);
    }
    return 0;
}
