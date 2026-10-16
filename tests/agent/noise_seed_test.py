#!/usr/bin/env python3
# ===========================================================================
# C1/C2 отчёта BASHNYA (docs/EXTERNAL_FEEDBACK.md): зерно шума и независимые
# потоки `$.random`.
#
# C1 было (0.1.34): `noise1D`, `noise2D`, `simplex2D` и `noise()` брали зерно
# только из аргумента, а по умолчанию — жёсткий `0`. Смена `--seed` не меняла
# карту шума: их замер `noise2D(1.5, 2.5) = 0.6002521668560803` совпадал при
# `--seed 1` и `--seed 999`, хотя `$.random.next()` различался. Игра выглядела
# детерминированной, но это был «другой детерминизм»: одинаково всегда.
#
# C1 стало: шум по умолчанию берёт зерно у своего генератора — у `$.random`
# это зерно сессии (`--seed`, после `seed(n)` — новое), у потока — зерно
# потока. Явно переданное зерно побеждает всегда, в том числе 0.
#
# C2: `seed(n)` по-прежнему разворачивает все обычные потоки, но поток
# `stream(name, { independent: true })` этим не трогается — он получает зерно
# один раз и живёт своей жизнью.
#
# Запуск (после сборки):
#   python3 tests/agent/noise_seed_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")

#: Точки, по которым сравниваются карты шума (несколько — чтобы «случайно
#: совпало» было исключено, а не замаскировано одной точкой).
POINTS = [(1.5, 2.5), (-3.25, 7.5), (100.125, -0.25), (0.0, 0.0)]


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:140])
        return default


def noise_map(a):
    """Значения всех четырёх входов шума в нескольких точках."""
    out = {}
    for x, y in POINTS:
        key = "%.3f,%.3f" % (x, y)
        out["noise2D:" + key] = ev(a, "$.random.noise2D(%r, %r)" % (x, y))
        out["noise1D:" + key] = ev(a, "$.random.noise1D(%r)" % x)
        out["simplex2D:" + key] = ev(a, "$.random.simplex2D(%r, %r)" % (x, y))
        out["source_simplex:" + key] = ev(
            a, "$.random.noise({ algorithm: 'simplex2d' }).sample2D(%r, %r)" % (x, y))
        out["source_value:" + key] = ev(
            a, "$.random.noise({ algorithm: 'value2d' }).sample2D(%r, %r)" % (x, y))
        out["stream_generation:" + key] = ev(
            a, "$.random.stream('generation').noise2D(%r, %r)" % (x, y))
    return out


def run(seed, code=None):
    """Сессия движка с заданным --seed; возвращает (agent-результат, значения)."""
    with Agent(game=GAME, seed=seed) as a:
        a.step(3)
        if code is None:
            return a, noise_map(a)
        return a, ev(a, code)


def main():
    # --- 1. C1: шум следует за --seed -------------------------------------
    _, m1 = run(1)
    _, m999 = run(999)
    diffs = [k for k in m1 if m1[k] != m999[k]]
    print("  --   --seed 1   : noise2D(1.5,2.5)=%s" % m1["noise2D:1.500,2.500"])
    print("  --   --seed 999 : noise2D(1.5,2.5)=%s" % m999["noise2D:1.500,2.500"])
    check(m1["noise2D:1.500,2.500"] != m999["noise2D:1.500,2.500"],
          "noise2D без зерна зависит от --seed (было 0.6002521668560803 при обоих)")
    # Точка (0, 0) — узел решётки: у симплекса там все вклады градиентов
    # обращаются в ноль, и значение равно ровно 0.5 при ЛЮБОМ зерне. Это
    # свойство алгоритма, а не игнор зерна, поэтому из сравнения карт узел
    # исключён и проверен отдельно ниже.
    origin = "0.000,0.000"
    for kind in ("noise2D", "noise1D", "simplex2D", "source_simplex", "source_value",
                 "stream_generation"):
        keys = [k for k in m1 if k.startswith(kind + ":") and not k.endswith(origin)]
        changed = sum(1 for k in keys if m1[k] != m999[k])
        check(changed == len(keys),
              "%s: все %d точек вне узла решётки разные при разных --seed" % (kind, len(keys)))
    check(m1["simplex2D:" + origin] == m999["simplex2D:" + origin] == 0.5,
          "в узле решётки симплекс равен 0.5 при любом зерне (свойство алгоритма)")
    check(len(diffs) >= len(m1) - 2,
          "карты шума различаются: %d из %d значений (два совпадения — узел решётки)"
          % (len(diffs), len(m1)))
    check(hash(tuple(sorted(m1.items()))) != hash(tuple(sorted(m999.items()))),
          "карта шума целиком (все 24 значения) зависит от --seed")

    # --- 2. Одно зерно — побитово одинаковые карты -------------------------
    _, m7a = run(7)
    _, m7b = run(7)
    check(m7a == m7b, "при одном --seed карты шума побитово одинаковы (%d точек)"
          % len(m7a))

    # --- 3. Явное зерно побеждает сессионное -------------------------------
    explicit = ("({ a: $.random.noise2D(1.5, 2.5, 42),"
                "   b: $.random.noise1D(1.5, 42),"
                "   c: $.random.simplex2D(1.5, 2.5, { seed: 7 }),"
                "   d: $.random.noise({ algorithm: 'simplex2d', seed: 3 }).sample2D(1.5, 2.5),"
                "   e: $.random.noise2D(1.5, 2.5, 0),"
                "   f: $.random.stream('gen2', { seed: 4242 }).next(),"
                "   g: $.random.next() })")
    _, e1 = run(1, explicit)
    _, e999 = run(999, explicit)
    for key in ("a", "b", "c", "d", "e", "f"):
        check(e1[key] == e999[key],
              "явное зерно (%s) не зависит от --seed: %s" % (key, e1[key]))
    check(e1["g"] != e999["g"], "а сам генератор от --seed зависит (next(): %s / %s)"
          % (e1["g"], e999["g"]))

    # --- 4. $.random.seed(n) меняет и шум, и последовательность ------------
    in_session = ("(function(){"
                  "  var n0 = $.random.noise2D(1.5, 2.5);"
                  "  var r1 = $.random.next();"
                  "  $.random.seed(999);"
                  "  return { noise_1: n0, noise_999: $.random.noise2D(1.5, 2.5),"
                  "           next_1: r1, next_999: $.random.next() };"
                  "})()")
    _, s1 = run(1, in_session)
    check(s1["noise_1"] != s1["noise_999"],
          "seed(n) меняет зерно шума (%.17g → %.17g)" % (s1["noise_1"], s1["noise_999"]))
    check(abs(s1["noise_1"] - m1["noise2D:1.500,2.500"]) < 1e-15,
          "шум до seed(n) равен сессионному (--seed 1)")
    check(abs(s1["noise_999"] - m999["noise2D:1.500,2.500"]) < 1e-15,
          "шум после seed(999) равен карте при --seed 999")
    check(s1["next_1"] != s1["next_999"], "seed(n) разворачивает и последовательность")

    # Шум не потребляет состояние ГПСЧ: 40 вызовов не сдвигают next().
    consumed = ("(function(){"
                "  var seq = [];"
                "  for (var i = 0; i < 40; i++) {"
                "    $.random.noise2D(i * 0.37, i * 0.11);"
                "    $.random.simplex2D(i * 0.21, i * 0.13);"
                "    $.random.noise({ algorithm: 'value2d' }).sample2D(i, i);"
                "  }"
                "  for (var k = 0; k < 3; k++) seq.push($.random.next());"
                "  return seq;"
                "})()")
    _, with_noise = run(7, consumed)
    _, without = run(7, "[$.random.next(), $.random.next(), $.random.next()]")
    check(with_noise == without,
          "шум не потребляет состояние ГПСЧ (%s == %s)" % (with_noise, without))

    # --- 5. C2: независимый поток не сдвигается чужим seed() ---------------
    seq_code = ("(function(){"
                "  var s = $.random.stream('fx', { independent: true });"
                "  var out = [];"
                "  for (var i = 0; i < 3; i++) out.push(s.next());"
                "  $.random.seed(999);"
                "  for (var j = 0; j < 3; j++) out.push(s.next());"
                "  return out;"
                "})()")
    plain_code = ("(function(){"
                  "  var s = $.random.stream('fx', { independent: true });"
                  "  var out = [];"
                  "  for (var i = 0; i < 6; i++) out.push(s.next());"
                  "  return out;"
                  "})()")
    _, indep = run(5, seq_code)
    _, indep_ref = run(5, plain_code)
    print("  --   независимый поток: %s" % indep)
    check(indep == indep_ref,
          "независимый поток не замечает $.random.seed() (%s == %s)" % (indep, indep_ref))
    check(len(indep) == 6 and indep[2] != indep[3],
          "последовательность независимого потока продолжается, а не начинается заново")

    plain_stream = ("(function(){"
                    "  var s = $.random.stream('fx');"
                    "  var out = [];"
                    "  for (var i = 0; i < 3; i++) out.push(s.next());"
                    "  $.random.seed(999);"
                    "  for (var j = 0; j < 3; j++) out.push(s.next());"
                    "  return out;"
                    "})()")
    plain_ref = ("(function(){"
                 "  var s = $.random.stream('fx');"
                 "  var out = [];"
                 "  for (var i = 0; i < 6; i++) out.push(s.next());"
                 "  return out;"
                 "})()")
    _, normal = run(5, plain_stream)
    _, normal_ref = run(5, plain_ref)
    check(normal != normal_ref,
          "обычный поток ЧУЖИМ seed() разворачивается — это контракт §4 (%s)" % (normal,))

    # Независимый поток с явным зерном не зависит и от --seed сессии.
    indep_seed = ("(function(){ var s = $.random.stream('edge', { independent: true,"
                  " seed: 4242 }); return [s.next(), s.next(), s.next()]; })()")
    _, ia = run(1, indep_seed)
    _, ib = run(999, indep_seed)
    check(ia == ib, "независимый поток с явным зерном одинаков при разных --seed")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
