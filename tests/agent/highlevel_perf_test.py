#!/usr/bin/env python3
# ===========================================================================
# Тест стенда производительности `$` (tests/fixtures/bench, tools/bench_highlevel.py).
#
# Порогов в миллисекундах здесь нет намеренно: замер зависит от машины, а тест
# с секундами в условии — источник ложных падений. Проверяется то, что обязано
# быть верным всегда:
#
#   * стенд запускается и его сцена действительно содержит N узлов;
#   * профайлер кадра отдаёт зоны, и окно замера непустое;
#   * цена кадра растёт с числом узлов (сцена не «оптимизирована» в ноль);
#   * заведомо патологический рост (случайный O(N²) в кадре) виден как провал
#     грубой отсечки — 1000 простых узлов не могут стоить сотни миллисекунд;
#   * штатный платформер из game/ запускается, и стоимость его update измерима
#     (сегодня это десятки миллисекунд — селекторы в кадре, см. отчёт §2.4).
#
# Числа печатаются рядом с каждой проверкой — по логу теста видно, сколько
# кадр стоил на этой машине. Подробный разбор — docs/HIGH_LEVEL_API_PERF.md.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_perf_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "bench")

#: Грубая отсечка «это уже не медленно, а сломано»: миллисекунды JS на кадр.
SANITY_MS = 400.0


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def measure(kind, nodes, warm=30, frames=60):
    """Прогон сценария стенда: возвращает (логика, батч, физика, узлов, кадров)."""
    with Agent(game=GAME, scene="%s:%d" % (kind, nodes), seed=1,
               start_timeout=60, timeout=120) as a:
        a.step(warm)
        a.cmd("eval", code="engine.profileReset()")
        a.step(frames)
        prof = a.eval("engine.profile()")
        zones = {row["name"]: row["ms"] for row in prof["zones"]}
        return (zones.get("JS: логика", -1.0),
                zones.get("JS: сборка батча", -1.0),
                zones.get("физика (Box2D)", -1.0),
                a.eval("$.bench && $.bench.nodes"),
                prof["frames"])


def measure_game(warm=120, frames=120):
    """Штатный платформер: сколько кадра стоит код самой игры (`update` сцены)."""
    with Agent(game="game", scene="platformer", seed=7,
               start_timeout=60, timeout=120) as a:
        a.step(warm)
        # Покадровый профайлер подсистем выключен по умолчанию (он стоит 24
        # метки за кадр, docs/HIGH_LEVEL_API_PERF.md §3.7) — включаем явно.
        a.cmd("eval", code="engine.profileReset(); "
                           "$.debug.profiler.on(true); $.debug.profiler.reset()")
        a.step(frames)
        prof = a.eval("engine.profile()")
        zones = {row["name"]: row["ms"] for row in prof["zones"]}
        report = a.eval("$.debug.profiler.report()")
        # Метка «логика игры» = код самой игры: $.ready + update сцены + хуки
        # $.update (метки профайлера точны — docs/HIGH_LEVEL_API_PERF.md §0.1).
        game_ms = report["логика игры"]["avg_ms"] if "логика игры" in report else 0.0
        return (zones.get("JS: логика", -1.0), zones.get("JS: сборка батча", -1.0),
                game_ms, a.eval("$.world.count()"))


def main():
    try:
        logic100, batch100, _, nodes100, frames100 = measure("sprite", 100)
        logic1000, batch1000, _, nodes1000, frames1000 = measure("sprite", 1000)
    except AgentError as exc:
        # Нет дисплея, GPU или бинарника — это пропуск, а не «зелено».
        print("пропуск: движок не запустился (%s)" % exc)
        return 0

    check(nodes100 == 100, "стенд собрал 100 узлов (получено %s)" % nodes100)
    check(nodes1000 == 1000, "стенд собрал 1000 узлов (получено %s)" % nodes1000)
    check(frames100 > 0 and frames1000 > 0,
          "профайлер отдал окно замера (%d и %d кадров)" % (frames100, frames1000))
    check(logic100 > 0 and batch100 > 0 and logic1000 > 0 and batch1000 > 0,
          "зоны кадра непусты: логика %.2f/%.2f мс, батч %.2f/%.2f мс"
          % (logic100, logic1000, batch100, batch1000))

    js100 = logic100 + batch100
    js1000 = logic1000 + batch1000
    check(js1000 > js100,
          "цена кадра растёт с числом узлов: %.2f мс (100) → %.2f мс (1000)"
          % (js100, js1000))
    check(js1000 < SANITY_MS,
          "1000 узлов укладываются в грубую отсечку %.0f мс (получено %.2f мс)"
          % (SANITY_MS, js1000))

    # Штатная игра: проверяем, что она запускается и что её собственный update
    # измерим. Сегодня он стоит десятки миллисекунд (селекторы в кадре,
    # docs/HIGH_LEVEL_API_PERF.md §2.4) — тест это только показывает в логе.
    try:
        logic_game, batch_game, game_ms, nodes_game = measure_game()
    except AgentError as exc:
        print("пропуск: игра game/ не запустилась (%s)" % exc)
        return 1 if FAILURES else 0
    check(nodes_game > 50, "платформер собрал сцену (%s узлов)" % nodes_game)
    check(0 <= game_ms < SANITY_MS,
          "update платформера измерим и укладывается в %.0f мс (%.2f мс)"
          % (SANITY_MS, game_ms))

    print("прогон стенда: 100 узлов — %.2f мс JS/кадр, 1000 узлов — %.2f мс"
          % (js100, js1000))
    print("платформер game/: update %.2f мс, весь JS %.2f мс"
          % (game_ms, logic_game + batch_game))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
