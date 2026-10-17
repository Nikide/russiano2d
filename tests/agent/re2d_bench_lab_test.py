#!/usr/bin/env python3
# ===========================================================================
# Re2D bench lab (P4): переключаемые worst-case сценарии и честные native-числа.
#
# Не проверяет FPS-порог (машины/сборки разные), но фиксирует:
#   * каждый сценарий реально регистрирует ожидаемый объём native-работы;
#   * profiler-поля конечны и не деградируют в NaN;
#   * сценарий можно переключить без stale handles/ошибок.
# Числа печатаются в лог для протокола docs/RE2D_WORLD_PERF.md.
#
# Запуск: python3 tests/agent/re2d_bench_lab_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_bench_lab"
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def state(a):
    return a.state().get("re2dBenchLab") or {}


def main():
    with Agent(game=GAME, scene=SCENE, seed=5) as a:
        if skip_without_re2d(a):
            return 0
        a.step(10)

        scenarios = ["base", "actors_100", "lights_32", "particles_2000",
                     "portals", "movers", "worstcase"]
        for name in scenarios:
            result = a.eval(f"JSON.stringify(re2dBench.apply('{name}'))") if False else None
            a.eval(f"re2dBench.apply('{name}')")
            a.step(12)
            st = state(a)
            NUMBERS.append(st)
            print("  bench %-14s %s" % (name, json.dumps(st, ensure_ascii=False)))
            ok = (st.get("scenario") == name and "frame" in (st.get("hud") or "")
                  and isinstance(st.get("frameMs"), (int, float))
                  and st["frameMs"] == st["frameMs"]
                  and st.get("actors", 0) >= (100 if name in ("actors_100", "worstcase") else 0)
                  and st.get("lights", 0) >= (32 if name in ("lights_32", "worstcase") else 0)
                  and st.get("particles", 0) >= (2000 if name in ("particles_2000", "worstcase") else 0))
            check(ok, f"сценарий {name} снимает нагрузку: {st}")

        check("[]" == a.eval("JSON.stringify($.debug.errors())"),
              f"ошибок игрового кода нет: {a.eval('JSON.stringify($.debug.errors())')}")

    print()
    if FAILURES:
        print("ПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
