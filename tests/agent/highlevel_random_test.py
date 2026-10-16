#!/usr/bin/env python3
# ===========================================================================
# §43 (seeded simplex noise), §26-часть (состояние и потоки RNG) и §24
# (generation validation) в той части, что зависит от шума.
#
# Что проверяется:
#   * $.random.simplex2D/noise/algorithms — именованный алгоритм с version,
#     seed mapping, frequency и нормализацией в [0,1];
#   * эталонные samples и hash сеток из
#     tests/fixtures/generation_noise/reference_samples.json;
#   * старые последовательности $.random и value noise не сдвинулись
#     (legacy_rng_golden.json, зафиксирован ДО правки);
#   * именованные потоки gameplay/generation/presentation изолированы;
#   * state/restore продолжают последовательность с середины, испорченный
#     снимок отклоняется понятной ошибкой;
#   * фикстура tests/fixtures/generation_noise: три профиля одним набором
#     примитивов, validation до публикации, одинаковый hash при разном
#     бюджете $.task, отказ на невалидном профиле.
#
# Запуск (после сборки):
#   python3 tools/run_tests.py highlevel_random_test
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "generation_noise")
REFERENCE = os.path.join(ROOT, GAME, "reference_samples.json")
LEGACY = os.path.join(ROOT, GAME, "legacy_rng_golden.json")
TOL = 1e-12


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def close(actual, expected, tol=TOL):
    try:
        return abs(float(actual) - float(expected)) <= tol
    except (TypeError, ValueError):
        return False


def close_list(actual, expected, tol=TOL):
    if not isinstance(actual, list) or len(actual) != len(expected):
        return False
    return all(close(a, b, tol) for a, b in zip(actual, expected))


def wait_ready(a, max_iters=120, chunk=3):
    """Крутить кадры, пока задача генерации не завершится."""
    for _ in range(max_iters):
        if a.eval("$.gen.ready"):
            return True
        a.step(chunk)
    return False


def build(a, profile, budget=4, seed=None):
    if seed is None:
        return a.eval("$.gen.build('%s', { budget: %s }); $.gen.status" % (profile, budget))
    return a.eval("$.gen.build('%s', { budget: %s, seed: %d }); $.gen.status"
                  % (profile, budget, seed))


def main():
    with open(REFERENCE, encoding="utf-8") as fh:
        reference = json.load(fh)
    with open(LEGACY, encoding="utf-8") as fh:
        legacy = json.load(fh)
    gen = reference["generation"]["profiles"]

    with Agent(game=GAME, seed=7) as a:
        # --- 1. API и метаданные алгоритма ---------------------------------
        methods = ["simplex2D", "noise", "algorithms", "hashCells",
                   "stream", "streamNames", "state", "restore", "validateState",
                   "noise1D", "noise2D"]
        missing = [m for m in methods if a.eval("typeof $.random.%s" % m) != "function"]
        check(not missing, "$.random: новые методы на месте (нет: %s)" % (missing or "нет"))

        algos = a.eval("$.random.algorithms().map(function(x){ return x.name + ':' + x.version; }).join(',')")
        check(algos == "value2d:1,simplex2d:1",
              "algorithms(): value2d:1,simplex2d:1 (получено %r)" % algos)
        seed_map = a.eval("$.random.algorithms()[1].seedMapping")
        check("mulberry32" in str(seed_map), "seed mapping симплекса описан: %r" % seed_map)

        # --- 2. Legacy: старые последовательности не сдвинулись ------------
        got = a.eval("$.random.seed(12345); var o=[]; for (var i=0;i<8;i++) o.push($.random.next()); o")
        check(close_list(got, legacy["next_12345"]), "legacy next(12345): 8 значений без изменений")
        got = a.eval("$.random.seed(12345); var o=[]; for (var i=0;i<8;i++) o.push($.random.int(1,6)); o")
        check(close_list(got, legacy["int_12345"]), "legacy int(1,6) без изменений")
        got = a.eval("$.random.seed(42); var o=[]; for (var i=0;i<6;i++) o.push($.random.range(-1,1)); o")
        check(close_list(got, legacy["range_42"]), "legacy range(-1,1) без изменений")
        got = a.eval("$.random.seed(7); var o=[]; for (var i=0;i<4;i++) o.push($.random.gaussian()); o")
        check(close_list(got, legacy["gaussian_7"]), "legacy gaussian() без изменений")
        legacy_shuffle = legacy["shuffle_12345"]
        check(a.eval("$.random.seed(12345); $.random.shuffle([1,2,3,4,5,6,7,8]).join(',')") ==
              ",".join(str(v) for v in legacy_shuffle), "legacy shuffle без изменений")

        # Зерно задаём явно: это эталон АЛГОРИТМА v1, а не дефолта. С 0.1.35
        # шум без зерна берёт зерно сессии (--seed / $.random.seed), поэтому
        # «без аргумента» больше не означает «зерно 0» — см. noise_seed_test.py.
        got = a.eval("[[0,0],[1.5,1.5],[-3.25,7.5],[100.125,-0.25]].map(function(p){"
                     " return $.random.noise2D(p[0], p[1], 0); })")
        check(close_list(got, legacy["noise2D"]), "legacy value noise noise2D без изменений (алгоритм v1, зерно 0)")
        got = a.eval("[0,0.5,3.25,-7.5,100.125].map(function(x){ return $.random.noise1D(x, 0); })")
        check(close_list(got, legacy["noise1D"]), "legacy value noise noise1D без изменений (алгоритм v1, зерно 0)")

        # --- 3. Эталонные samples симплекс-шума ----------------------------
        worst = 0.0
        for s in reference["samples"]:
            value = a.eval("$.random.simplex2D(%r, %r, { seed: %d, frequency: %r })"
                           % (s["x"], s["y"], s["seed"], s["frequency"]))
            if not close(value, s["value"]):
                worst = max(worst, abs(float(value) - s["value"]))
        check(worst == 0.0,
              "эталонные samples симплекс-шума совпали (худшее расхождение %.3g)" % worst)

        # --- 4. Hash сеток §43 ---------------------------------------------
        grid_ok = True
        for key in ("A", "B", "regular"):
            expected = reference["grids"][key]
            profile = expected["profile"]
            source = ("$.random.noise({ algorithm: 'simplex2d', seed: %d, frequency: %r })"
                      % (profile["seed"], profile["frequency"])) if profile["noise"] else "null"
            code = (
                "var n = %s; var cells = []; var solid = 0;"
                "for (var y = 0; y < %d; y++) { var row = [];"
                " for (var x = 0; x < %d; x++) {"
                "  var v = n ? (n.sample2D(x, y) > %r ? 1 : 0) : ((y %% 5 === 0 || x %% 11 === 0) ? 1 : 0);"
                "  row.push(v); solid += v; } cells.push(row); }"
                "({ hash: $.random.hashCells(cells), solid: solid })"
            ) % (source, expected["rows"], expected["cols"], profile["threshold"])
            got = a.eval(code)
            if not got or got.get("hash") != expected["hash"] or got.get("solid") != expected["solidCount"]:
                grid_ok = False
        check(grid_ok, "hash сеток A/B/regular совпал с фикстурой (два порога и регулярный профиль)")

        # --- 5. §26: изоляция именованных потоков --------------------------
        got = a.eval(
            "$.random.seed(7);"
            "var gen = $.random.stream('generation');"
            "var first = [gen.next(), gen.next(), gen.next()];"
            "var pres = $.random.stream('presentation');"
            "for (var i = 0; i < 2000; i++) pres.next();"
            "var after = [gen.next(), gen.next(), gen.next()];"
            "var defaultHead = [$.random.next(), $.random.next()];"
            "$.random.seed(7);"
            "var gen2 = $.random.stream('generation');"
            "var fresh = [gen2.next(), gen2.next(), gen2.next(), gen2.next(), gen2.next(), gen2.next()];"
            "$.random.seed(7);"
            "var defaultAgain = [$.random.next(), $.random.next()];"
            "({ first: first, after: after, fresh: fresh,"
            "   defaultHead: defaultHead, defaultAgain: defaultAgain })"
        )
        check(close_list(got["fresh"][:3], got["first"]) and close_list(got["fresh"][3:], got["after"]),
              "presentation не съедает поток generation")
        check(close_list(got["defaultHead"], got["defaultAgain"]),
              "presentation не съедает default-поток")
        check(a.eval("$.random.streamNames().sort().join(',')") == "generation,presentation",
              "streamNames() перечисляет созданные потоки")

        # --- 6. §26: снимок состояния --------------------------------------
        got = a.eval(
            "$.random.seed(4242);"
            "for (var i = 0; i < 37; i++) $.random.next();"
            "var snap = JSON.parse(JSON.stringify($.random.state()));"
            "var exp = []; for (var i = 0; i < 5; i++) exp.push($.random.next());"
            "for (var i = 0; i < 9; i++) $.random.next();"
            "$.random.restore(snap);"
            "var got = []; for (var i = 0; i < 5; i++) got.push($.random.next());"
            "({ version: snap.version, algorithm: snap.algorithm, exp: exp, got: got })"
        )
        check(got["version"] == 1 and got["algorithm"] == "mulberry32",
              "state(): version=1, algorithm=mulberry32")
        check(close_list(got["got"], got["exp"]),
              "restore() продолжает default-последовательность с середины")

        got = a.eval(
            "$.random.seed(2024); $.random.next();"
            "var gen = $.random.stream('generation');"
            "for (var i = 0; i < 11; i++) gen.next();"
            "var pres = $.random.stream('presentation');"
            "for (var i = 0; i < 3; i++) pres.next();"
            "var snap = JSON.parse(JSON.stringify($.random.state()));"
            "var e1 = [$.random.next(), $.random.next()];"
            "var e2 = [gen.next(), gen.next()];"
            "var e3 = [pres.next(), pres.next()];"
            "$.random.seed(9); $.random.next();"
            "$.random.restore(snap);"
            "var back = JSON.parse(JSON.stringify($.random.state()));"
            "var g1 = [$.random.next(), $.random.next()];"
            "var g2 = [gen.next(), gen.next()];"
            "var g3 = [pres.next(), pres.next()];"
            "({ same: JSON.stringify(snap) === JSON.stringify(back),"
            "   d: JSON.stringify(e1) === JSON.stringify(g1),"
            "   g: JSON.stringify(e2) === JSON.stringify(g2),"
            "   p: JSON.stringify(e3) === JSON.stringify(g3) })"
        )
        check(got["d"] and got["g"] and got["p"],
              "restore() восстанавливает состояние потоков generation/presentation")
        check(got["same"], "снимок state() переживает JSON-круговорот (default + потоки)")

        message = a.eval(
            "(function(){ try {"
            " $.random.restore({ version: 99, algorithm: 'mulberry32', seed: 1, value: 1 });"
            " return 'нет ошибки'; } catch (e) { return String(e.message); } })()"
        )
        check(str(message).startswith("$.random.restore:") and "99" in str(message),
              "чужой снимок отклонён понятной ошибкой: %r" % message)
        reason = a.eval("$.random.validateState({ version: 1, algorithm: 'xorshift', seed: 1, value: 1 })")
        check(isinstance(reason, str) and "xorshift" in reason,
              "validateState() называет несовместимый алгоритм: %r" % reason)

        # --- 7. §24/§43: фикстура генерации --------------------------------
        status = build(a, "A", budget=4)
        check(status == "building" and a.eval("$.gen.ready") is False
              and a.eval("$.gen.cells") is None,
              "build(A): идёт генерация, карта ещё не опубликована (cells = null)")

        check(wait_ready(a), "задача генерации A завершилась за отведённые кадры")
        got = a.eval("({ status: $.gen.status, hash: $.gen.hash, cells: $.gen.cells.length,"
                     " platforms: $.gen.report.published.platforms, longest: $.gen.report.published.longest,"
                     " free: $.gen.report.published.freeFraction,"
                     " spawn: $.gen.spawn, attempts: $.gen.report.attempts.length })")
        check(got["status"] == "published" and got["hash"] == gen["A"]["hash"],
              "профиль A опубликован с эталонным hash %s (получено %s)" % (gen["A"]["hash"], got["hash"]))
        check(got["cells"] == 512 and got["platforms"] == gen["A"]["platforms"]
              and got["longest"] == gen["A"]["longest"],
              "A: 512 клеток, %d платформ, длиннейшая %d" % (got["platforms"], got["longest"]))
        spawn = got["spawn"]
        spawn_free = a.eval("$.gen.cells[%d * $.gen.rows + %d] === 0" % (spawn["cy"], spawn["cx"])) \
            if spawn else False
        check(bool(spawn) and spawn_free and got["attempts"] == 0,
              "A: спавн %s стоит в свободной клетке, попыток %d" % (spawn, got["attempts"]))

        # Разный бюджет $.task — одинаковые клетки и hash.
        hashes = []
        for budget in (0.05, 4, 50):
            build(a, "A", budget=budget)
            if not wait_ready(a):
                hashes.append("таймаут")
                continue
            hashes.append(a.eval("$.gen.hash"))
        check(len(set(hashes)) == 1 and hashes[0] == gen["A"]["hash"],
              "бюджеты $.task 0.05/4/50 дают один hash: %s" % hashes)

        # Второй пороговый профиль и регулярный безшумовой.
        build(a, "B", budget=4)
        wait_ready(a)
        hash_b = a.eval("$.gen.hash")
        check(hash_b == gen["B"]["hash"] and hash_b != gen["A"]["hash"],
              "профиль B: свой эталонный hash %s, отличный от A" % hash_b)

        regular_hashes = []
        for seed in (7, 1, 999):
            build(a, "regular", budget=4, seed=seed)
            wait_ready(a)
            regular_hashes.append(a.eval("$.gen.hash"))
        check(len(set(regular_hashes)) == 1 and regular_hashes[0] == gen["regular"]["hash"],
              "регулярный безшумовой профиль не зависит от seed: %s" % regular_hashes)

        # Seed порогового профиля действительно влияет на карту.
        build(a, "A", budget=4, seed=12345)
        wait_ready(a)
        check(a.eval("$.gen.hash") != gen["A"]["hash"],
              "другое зерно профиля A даёт другую карту")

        # Невалидный профиль: ограниченный retry и отказ без публикации.
        build(a, "broken", budget=4)
        wait_ready(a)
        got = a.eval("({ status: $.gen.status, hash: $.gen.hash, cells: $.gen.cells,"
                     " attempts: $.gen.report.attempts.length,"
                     " reasons: $.gen.report.attempts[0].reasons,"
                     " seeds: $.gen.report.attempts.map(function(x){ return x.derivedSeed; }) })")
        expected_seeds = [gen["broken"]["attemptSeeds"][i] for i in range(3)]
        check(got["status"] == "rejected" and got["hash"] is None and got["cells"] is None,
              "невалидный профиль отклонён, карта не опубликована")
        check(got["attempts"] == 3 and got["seeds"] == expected_seeds
              and isinstance(got["reasons"], list) and got["reasons"],
              "broken: 3 попытки с derived seed %s и причинами" % got["seeds"])

        # Косметический поток во время генерации не меняет карту.
        build(a, "A", budget=0.05)
        frames = 0
        while not a.eval("$.gen.ready") and frames < 300:
            a.eval("var p = $.random.stream('presentation'); for (var i = 0; i < 500; i++) p.next(); 'ok'")
            a.step(2)
            frames += 2
        check(a.eval("$.gen.hash") == gen["A"]["hash"],
              "потребление presentation во время генерации не меняет hash A")

        check(a.eval("engine.frame") > 0, "кадры идут, фикстура жива")

    print("Все проверки пройдены" if not FAILURES else "ПРОВАЛЕНО: %d" % len(FAILURES))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
