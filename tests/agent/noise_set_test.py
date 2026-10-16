#!/usr/bin/env python3
# ===========================================================================
# Комплект шумов: FastNoiseLite + $.noise
#
# Проверяется поведение, а не наличие имён:
#   * эталонные значения апстрима — по каждому источнику, 3D, фракталам,
#     cellular (метрики и типы возврата) и domain warp. Без этой сверки
#     «OpenSimplex» мог бы оказаться чем угодно: свои числа мы бы не заметили;
#   * зерно: без явного seed берётся зерно СЕССИИ (--seed), явное побеждает.
#     При --seed 1 и --seed 999 поле разное, при одном зерне — побитово равное;
#   * диапазоны и статистика: конечные значения, среднее около нуля, никаких
#     NaN на больших и отрицательных координатах;
#   * cellular: разные метрики расстояния дают разные значения;
#   * фракталы: octaves/lacunarity/gain влияют предсказуемо;
#   * массовый field() побитово совпадает с поштучными вызовами тех же
#     координат — это и есть доказательство, что быстрый путь не врёт;
#   * fieldRGBA() годится прямо в engine.textureFromPixels;
#   * мусорные параметры отвергаются с внятной ошибкой (а не «взяли 0»);
#   * существующий шум ($.random.simplex2D/noise2D/noise1D) не тронут.
#
# Эталон (GOLD) снят с НЕПАТЧЕННОГО апстрима — программы
# third_party/fastnoise_lite/reference.cpp; как её собрать и что она печатает,
# написано там же. Строка readme_4x4 сверена с опубликованным тестом апстрима
# (JavaScript/test/FastNoiseLite.test.ts), readme_warp — тоже.
#
# Запуск (после сборки):
#   python3 tests/agent/noise_set_test.py
# ===========================================================================

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "bare")
FAILURES = []

#: Эталон апстрима: имя → значение (см. reference.cpp).
GOLD = {
    "src_simplex2": 0.274064004,
    "src_simplex2S": 0.154386789,
    "src_perlin": 0.0545770712,
    "src_value": 0.375854313,
    "src_cubic": 0.175246984,
    "src_cellular": -0.825569928,
    "perlin3d": 0.0382427834,
    "frac_fbm": 0.290359944,
    "frac_ridged": 0.0863444358,
    "frac_pingpong": 0.0282907803,
    "cell_euclidean": -0.582351744,
    "cell_euclideanSq": -0.825569928,
    "cell_manhattan": -0.49034071,
    "cell_hybrid": -0.315910637,
    "cellret_value": 0.0546948947,
    "cellret_distance": -0.315910637,
    "cellret_distance2": 0.109107733,
    "cellret_distance2Add": -0.103401423,
    "cellret_distance2Sub": -0.57498163,
    "cellret_distance2Mul": -0.620635629,
    "cellret_distance2Div": -0.3832075,
    "warp_progressive_x": 12.4494705,
    "warp_progressive_y": -3.37761235,
}

#: Опубликованная в апстриме таблица 4×4 (OpenSimplex2 по умолчанию, seed 1337,
#: frequency 0.01). В апстриме она записана как noiseData[x][y] — то есть
#: строка таблицы это фиксированный x и меняющийся y; наше поле построчное по
#: y, поэтому порядок сравнивается явно (см. проверку field vs эталон).
GOLD_README_4X4 = [
    [0.00000, 0.04946, 0.09869, 0.14744],   # x = 0, y = 0..3
    [0.03796, 0.08735, 0.13645, 0.18501],   # x = 1
    [0.07573, 0.12497, 0.17386, 0.22216],   # x = 2
    [0.11314, 0.16216, 0.21076, 0.25871],   # x = 3
]

TOL = 1e-6


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def close(got, want, tol=TOL):
    return got is not None and abs(got - want) <= tol


def main():
    # --- Эталон, зерно и параметры на одной сессии --------------------------
    with Agent(game=GAME, seed=7, start_timeout=60) as a:
        # --- Набор на месте --------------------------------------------------
        sources = a.eval("$.noise.sources()") or []
        check(sources == ["simplex2", "simplex2S", "perlin", "value", "cubic", "cellular"],
              "источники перечислены: %s" % sources)
        check(a.eval("$.noise.fractals()") == ["none", "fbm", "ridged", "pingpong"],
              "фракталы перечислены: %s" % a.eval("$.noise.fractals()"))
        check(len(a.eval("$.noise.cellularDistances()") or []) == 4,
              "метрики cellular перечислены (%s)" % a.eval("$.noise.cellularDistances()"))
        check(len(a.eval("$.noise.cellularReturns()") or []) == 7,
              "типы возврата cellular перечислены (%s)" % a.eval("$.noise.cellularReturns()"))

        # --- Эталон апстрима: источники --------------------------------------
        for name in ("simplex2", "simplex2S", "perlin", "value", "cubic", "cellular"):
            got = a.eval("$.noise.%s(12.5, -3.25, { seed: 1337 })" % name)
            check(close(got, GOLD["src_" + name]),
                  "эталон апстрима: %-9s %.9g (у нас %.9g)"
                  % (name, GOLD["src_" + name], got))

        # --- Эталон: 3D -------------------------------------------------------
        got3 = a.eval("$.noise.create({ seed: 1337, source: 'perlin' })"
                      ".get3(12.5, -3.25, 0.75)")
        check(close(got3, GOLD["perlin3d"]),
              "эталон апстрима: perlin 3D %.9g (у нас %.9g)" % (GOLD["perlin3d"], got3))

        # --- Эталон: фракталы -------------------------------------------------
        for name in ("fbm", "ridged", "pingpong"):
            got = a.eval("$.noise.%s(12.5, -3.25, { seed: 1337, octaves: 5 })" % name)
            check(close(got, GOLD["frac_" + name]),
                  "эталон апстрима: %-8s %.9g (у нас %.9g)"
                  % (name, GOLD["frac_" + name], got))

        # --- Эталон: cellular, метрики расстояния -----------------------------
        for dist in ("euclidean", "euclideanSq", "manhattan", "hybrid"):
            got = a.eval("$.noise.cellular(12.5, -3.25, "
                         "{ seed: 1337, cellularDistance: '%s' })" % dist)
            check(close(got, GOLD["cell_" + dist]),
                  "эталон апстрима: cellular/%-11s %.9g (у нас %.9g)"
                  % (dist, GOLD["cell_" + dist], got))
        values = [a.eval("$.noise.cellular(12.5, -3.25, "
                         "{ seed: 1337, cellularDistance: '%s' })" % d)
                  for d in ("euclidean", "euclideanSq", "manhattan", "hybrid")]
        check(len(set(values)) == len(values),
              "разные метрики дают разные значения: %s" % ["%.4f" % v for v in values])

        # --- Эталон: cellular, типы возврата ----------------------------------
        for ret in ("value", "distance", "distance2", "distance2Add",
                    "distance2Sub", "distance2Mul", "distance2Div"):
            got = a.eval("$.noise.cellular(12.5, -3.25, { seed: 1337, "
                         "cellularDistance: 'hybrid', cellularReturn: '%s' })" % ret)
            check(close(got, GOLD["cellret_" + ret]),
                  "эталон апстрима: cellularReturn/%-12s %.9g (у нас %.9g)"
                  % (ret, GOLD["cellret_" + ret], got))

        # --- Эталон: domain warp (пример из README апстрима) -------------------
        warp = a.eval("$.noise.create({ seed: 1337, warpType: 'simplex2', warpAmp: 1.5 })"
                      ".warp2(1, 2)") or []
        check(len(warp) == 2 and close(warp[0], 0.98362, 1e-5) and close(warp[1], 1.95825, 1e-5),
              "эталон апстрима: warp(1,2) = (0.98362, 1.95825), у нас (%s, %s)"
              % (warp[0] if warp else None, warp[1] if len(warp) > 1 else None))
        warped = a.eval("""(() => {
            const w = $.noise.create({ seed: 1337, warpType: 'simplex2', warpAmp: 1.5,
                                       warpFractal: 'progressive', warpOctaves: 3 });
            const p = w.warp2(12.5, -3.25);
            return p;
        })()""") or []
        check(len(warped) == 2 and close(warped[0], GOLD["warp_progressive_x"], 1e-5)
              and close(warped[1], GOLD["warp_progressive_y"], 1e-5),
              "эталон апстрима: фрактальный warp (%.9g, %.9g), у нас (%s, %s)"
              % (GOLD["warp_progressive_x"], GOLD["warp_progressive_y"],
                 warped[0] if warped else None, warped[1] if len(warped) > 1 else None))

        # --- Эталон: таблица 4×4 из теста апстрима ----------------------------
        # Сравниваем через field(): апстрим пишет noiseData[x][y], а наше поле
        # построчное по y, поэтому значение (x, y) берётся как field[y*w + x].
        mismatch = a.eval("""(() => {
            const w = 4, h = 4;
            const f = $.noise.field({ w, h, seed: 1337 });
            let bad = 0;
            for (let x = 0; x < w; x++)
                for (let y = 0; y < h; y++) {
                    const v = f[y * w + x];        // (x, y) в нашем порядке
                    if (Math.abs(v - GOLD_4X4[x][y]) > 1e-5) bad++;
                }
            return bad;
        })()""".replace("GOLD_4X4", "[%s]" % ",".join(
            "[" + ",".join("%.5f" % v for v in row) + "]" for row in GOLD_README_4X4)))
        check(mismatch == 0,
              "field() совпадает с опубликованной таблицей 4×4 апстрима (%s расхождений)"
              % mismatch)

        # --- Массовый путь побитово равен поштучному --------------------------
        diff = a.eval("""(() => {
            const w = 48, h = 32, opts = { seed: 11, frequency: 0.03 };
            const f = $.noise.field(Object.assign({ w, h }, opts));
            const g = $.noise.create(opts);
            let bad = 0, nan = 0;
            for (let j = 0; j < h; j++)
                for (let i = 0; i < w; i++) {
                    const v = g.get2(i, j);
                    if (!(v === f[j * w + i])) bad++;      // побитово, не «почти»
                    if (!Number.isFinite(v)) nan++;
                }
            return { bad, nan, total: w * h };
        })()""") or {}
        check(diff.get("bad") == 0,
              "field() побитово равен поштучным вызовам (%s расхождений из %s)"
              % (diff.get("bad"), diff.get("total")))
        check(diff.get("nan") == 0, "в поле нет NaN (%s)" % diff.get("nan"))

        # --- Диапазоны и статистика -------------------------------------------
        stats = a.eval("""(() => {
            const g = $.noise.create({ seed: 3, source: 'simplex2', frequency: 0.05 });
            let min = Infinity, max = -Infinity, sum = 0, nan = 0, n = 0;
            for (let j = 0; j < 64; j++)
                for (let i = 0; i < 64; i++) {
                    const v = g.get2(i * 0.5, j * 0.5);
                    if (!Number.isFinite(v)) { nan++; continue; }
                    if (v < min) min = v;
                    if (v > max) max = v;
                    sum += v; n++;
                }
            return { min, max, mean: sum / n, nan, n };
        })()""") or {}
        check(stats.get("nan") == 0 and stats.get("n") == 64 * 64,
              "все значения конечны (%s NaN из %s)" % (stats.get("nan"), stats.get("n")))
        check(-1.5 <= stats.get("min", 0) and stats.get("max", 0) <= 1.5,
              "диапазон примерно [-1,1]: %.3f … %.3f" % (stats.get("min"), stats.get("max")))
        check(abs(stats.get("mean", 1)) < 0.15,
              "среднее около нуля: %.4f" % stats.get("mean"))

        # --- Большие и отрицательные координаты --------------------------------
        big = a.eval("""(() => {
            const g = $.noise.create({ seed: 1337, source: 'perlin', frequency: 0.01 });
            const pts = [[1e6, 1e6], [-999999.5, 123456.25], [-1e6, -1e6], [123456.75, -1e6]];
            return pts.map(([x, y]) => g.get2(x, y));
        })()""") or []
        check(len(big) == 4 and all(isinstance(v, (int, float)) and v == v and abs(v) <= 1.5
                                    for v in big),
              "большие и отрицательные координаты: %s" % ["%.6g" % v for v in big])
        # Апстрим на (1e6, 1e6) даёт ровно 0: во float-32 дробная часть теряется.
        # Это честное поведение формата, и оно зафиксировано эталоном.
        check(big and big[0] == 0.0,
              "на 1e6 координата вырождается как у апстрима (%.6g)" % (big[0] if big else None))

        # --- Фракталы: octaves влияет предсказуемо -----------------------------
        octaves = a.eval("""(() => {
            const mk = (o) => $.noise.create({ seed: 1337, source: 'simplex2',
                                               fractal: 'fbm', octaves: o }).get2(12.5, -3.25);
            return [mk(1), mk(2), mk(5), mk(5)];
        })()""") or []
        check(len(octaves) == 4 and octaves[2] == octaves[3],
              "одинаковые параметры дают одинаковый результат (%.9g)" % (octaves[2] if octaves else 0))
        check(octaves[0] != octaves[1] and octaves[1] != octaves[2],
              "octaves меняет результат: %s" % ["%.6g" % v for v in octaves])
        check(close(octaves[2], GOLD["frac_fbm"]),
              "fbm с 5 октавами совпадает с эталоном (%.9g)" % (octaves[2] if octaves else 0))

        # --- Параметры: имена → номера -----------------------------------------
        params = a.eval("$.noise.params({ source: 'cellular', cellularDistance: 'hybrid', "
                        "cellularReturn: 'distance2', seed: 42 })") or {}
        c = params.get("c") or {}
        check(c.get("source") == 5 and c.get("cell_distance") == 3 and c.get("cell_return") == 2,
              "имена переведены в номера C-контракта: source=%s, distance=%s, return=%s"
              % (c.get("source"), c.get("cell_distance"), c.get("cell_return")))
        check(params.get("names", {}).get("source") == "cellular"
              and c.get("seed") == 42,
              "params() отдаёт и имена, и числа (seed=%s)" % c.get("seed"))
        defaults = a.eval("$.noise.defaults()") or {}
        check(defaults.get("seed") == 1337 and abs(defaults.get("frequency", 0) - 0.01) < 1e-9
              and defaults.get("octaves") == 3,
              "умолчания приходят из C: seed=%s frequency=%s octaves=%s"
              % (defaults.get("seed"), defaults.get("frequency"), defaults.get("octaves")))

        # --- Мусор отвергается с внятной ошибкой -------------------------------
        rejects = [
            ("$.noise.simplex2(0, 0, { frequency: 0 })", "frequency: 0"),
            ("$.noise.simplex2(0, 0, { octaves: 13 })", "octaves: 13"),
            ("$.noise.simplex2(0, 0, { source: 'opensimplex' })", "неизвестный источник"),
            ("$.noise.simplex2(0, 0, { gain: 2 })", "gain: 2"),
            ("$.noise.simplex2(0, 0, { fractal: 'fbm', warpFractal: 'progressive' })",
             "фрактальный шум и фрактальный warp вместе"),
            ("$.noise.simplex2(0, 0, { frequency: 'мелко' })", "нечисловая частота"),
        ]
        for code, what in rejects:
            text = a.eval("""(() => { try { %s; return ''; } catch (e) { return String(e.message || e); } })()"""
                          % code)
            check(bool(text) and "noise" in text.lower(),
                  "отвергнуто: %s → «%s»" % (what, (text or "")[:70]))

        # --- fieldRGBA годится в текстуру --------------------------------------
        tex = a.eval("""(() => {
            const px = $.noise.fieldRGBA({ w: 32, h: 32, seed: 5, source: 'perlin',
                                           frequency: 0.05 });
            const id = engine.textureFromPixels(32, 32, px);
            const f = $.noise.field({ w: 32, h: 32, seed: 5, source: 'perlin',
                                      frequency: 0.05 });
            // серый канал = round((v*0.5+0.5)*255), альфа 255
            let bad = 0;
            for (let i = 0; i < 32 * 32; i++) {
                const want = Math.max(0, Math.min(255, Math.round((f[i] * 0.5 + 0.5) * 255)));
                if (px[i * 4] !== want || px[i * 4 + 1] !== want ||
                    px[i * 4 + 2] !== want || px[i * 4 + 3] !== 255) bad++;
            }
            return { id, bad, bytes: px.length };
        })()""") or {}
        check(tex.get("id", -1) > 0,
              "fieldRGBA → engine.textureFromPixels даёт текстуру (id=%s, %s байт)"
              % (tex.get("id"), tex.get("bytes")))
        check(tex.get("bad") == 0,
              "серый канал RGBA — ровно отображение значений поля (%s расхождений)"
              % tex.get("bad"))

        # --- Существующий шум не тронут ----------------------------------------
        legacy = a.eval("""(() => {
            const n1 = $.random.noise1D(3.5, 7);
            const n2 = $.random.noise2D(3.5, -1.25, 7);
            const s2 = $.random.simplex2D(3.5, -1.25, { seed: 7 });
            const gen = $.random.noise({ algorithm: 'simplex2d', seed: 7 });
            return { n1, n2, s2, again: gen.sample2D(3.5, -1.25), keys: Object.keys($.random).length };
        })()""") or {}
        check(isinstance(legacy.get("n1"), (int, float)) and isinstance(legacy.get("s2"), (int, float)),
              "$.random.noise1D/noise2D/simplex2D по-прежнему работают")
        check(close(legacy.get("s2"), legacy.get("again"), 1e-12),
              "$.random.noise() и simplex2D дают одно и то же (%.9g)" % legacy.get("s2"))

        # --- Цена: поле 256×256 и поштучный путь --------------------------------
        times = a.eval("""(() => {
            const bench = (fn, repeat) => {
                const t0 = engine.now();
                for (let r = 0; r < repeat; r++) fn();
                return engine.now() - t0;
            };
            const one = (opts) => bench(() => $.noise.field(Object.assign({ w: 256, h: 256 }, opts)), 3) / 3;
            const simplex = one({ source: 'simplex2', frequency: 0.01 });
            const fbm = one({ source: 'simplex2', fractal: 'fbm', octaves: 5, frequency: 0.01 });
            const cellular = one({ source: 'cellular', frequency: 0.01 });
            // Поштучно 256×256: тот же объём работы, но через JS-цикл.
            const g = $.noise.create({ source: 'simplex2', frequency: 0.01 });
            const per_point = bench(() => {
                let acc = 0;
                for (let j = 0; j < 256; j++)
                    for (let i = 0; i < 256; i++) acc += g.get2(i, j);
                return acc;
            }, 1);
            return { simplex, fbm, cellular, per_point };
        })()""") or {}
        print("  --   256×256: simplex2 %.1f мс, fbm(5) %.1f мс, cellular %.1f мс; "
              "поштучно (65 536 вызовов) %.1f мс"
              % (times.get("simplex", -1), times.get("fbm", -1), times.get("cellular", -1),
                 times.get("per_point", -1)))
        check(times.get("simplex", 0) > 0 and times.get("fbm", 0) > 0
              and times.get("cellular", 0) > 0,
              "время генерации поля измеримо")
        check(times.get("simplex", 1e9) < 500 and times.get("fbm", 1e9) < 1000
              and times.get("cellular", 1e9) < 2000,
              "поле 256×256 укладывается в грубые пределы (симплекс %.1f, fbm %.1f, cellular %.1f мс)"
              % (times.get("simplex", -1), times.get("fbm", -1), times.get("cellular", -1)))
        speedup = (times.get("per_point", 0) / times.get("simplex", 1)) if times.get("simplex") else 0
        check(speedup > 3.0,
              "массовый путь быстрее поштучного: ×%.1f (%.1f мс против %.1f мс)"
              % (speedup, times.get("per_point", -1), times.get("simplex", -1)))

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "нет ошибок игрового кода: %s" % errors[:2])

    # --- Зерно сессии: --seed 1 против --seed 999 ---------------------------
    sample = ("(() => { const f = $.noise.field({ w: 8, h: 8, source: 'simplex2', "
              "frequency: 0.02 }); return Array.from(f); })()")
    with Agent(game=GAME, seed=1, start_timeout=60) as a1:
        first = a1.eval(sample)
        explicit = a1.eval(sample.replace("frequency: 0.02", "frequency: 0.02, seed: 4242"))
        session_again = a1.eval(sample)
        print("  --   --seed 1: первые значения %s" % ["%.4f" % v for v in first[:4]])
    with Agent(game=GAME, seed=999, start_timeout=60) as a2:
        second = a2.eval(sample)
        explicit_999 = a2.eval(sample.replace("frequency: 0.02", "frequency: 0.02, seed: 4242"))
        print("  --   --seed 999: первые значения %s" % ["%.4f" % v for v in second[:4]])

    check(first == session_again,
          "одно зерно сессии — побитово одинаковое поле (в одном процессе)")
    check(first != second,
          "--seed 1 и --seed 999 дают РАЗНОЕ поле (шум слушает зерно сессии)")
    check(explicit == explicit_999,
          "явный seed побеждает зерно сессии: поле одинаково при --seed 1 и 999")
    check(explicit != first, "явный seed 4242 не совпадает с полем от --seed 1")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
