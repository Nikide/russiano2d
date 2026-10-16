#!/usr/bin/env python3
# ===========================================================================
# §18 Спецификации: детектор долгих кадров (hitch detector).
#
# Проверяется поведение, а не наличие полей:
#   * на ровных кадрах захватов нет;
#   * искусственно удлинённый кадр ловится, и его длительность измерена;
#   * у захвата названа причина — самая дорогая зона спайка (здесь это
#     «JS: логика»: спайк сделан в хуке $.update);
#   * контекст захвата — N кадров до и N после: времена и зоны каждого;
#   * порог реально управляет детектором: спайк ниже порога не ловится,
#     тот же спайк выше порога — ловится;
#   * clear() чистит кольцо, но не забывает выставленный порог.
#
# Спайк делается честно: код игры крутится в занятом цикле по engine.now(),
# пока не истечёт заданное время. Никаких «подставленных» чисел в C нет, а
# детектор меряет фактический интервал работы кадра — поэтому спайк виден и в
# детерминированном режиме (--fixed-dt), где dt движка фиксирован.
#
# Запуск (после сборки):
#   python3 tests/agent/devtools_hitch_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "bare")
FAILURES = []

#: Длительность искусственного спайка, мс: заметно выше порога по умолчанию.
SPIKE_MS = 80.0
#: Сколько кадров «до» и «после» хранит захват (R2D_PROF_HITCH_CONTEXT).
CONTEXT = 2

#: Хук, удлиняющий кадр: занятой цикл по E.now(). Ставится из теста, поэтому
#: фикстура остаётся нетронутой. Важно: engine захватывается в замыкание — в
#: коде, вычисленном через eval агента, глобального `engine` внутри отложенного
#: хука уже нет.
SPIN_HOOK = """(() => {
    const E = engine;
    globalThis.__spikeLeft = 0;
    globalThis.__spikeMs = 0;
    globalThis.__spike = (frames, ms) => {
        globalThis.__spikeLeft = frames;
        globalThis.__spikeMs = ms;
    };
    $.update(() => {
        if (globalThis.__spikeLeft <= 0) return;
        globalThis.__spikeLeft--;
        const t0 = E.now();
        while (E.now() - t0 < globalThis.__spikeMs) {}
    });
    return true;
})()"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def arm(a, frames=1, ms=SPIKE_MS):
    """Взвести спайк: следующие `frames` кадров удлиняются на `ms` мс."""
    a.eval("globalThis.__spike(%d, %s)" % (frames, ms))


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=60) as a:
        a.step(20)   # прогреваем сцену и кольцо профайлера
        a.eval(SPIN_HOOK)

        # --- Биндинги на месте -------------------------------------------------
        for name in ("count", "total", "get", "threshold", "clear"):
            check(a.eval("typeof engine.hitch.%s" % name) == "function",
                  "engine.hitch.%s есть" % name)

        default_threshold = a.eval("engine.hitch.threshold()")
        check(isinstance(default_threshold, (int, float)) and default_threshold > 0,
              "порог по умолчанию назван (%.2f мс)" % default_threshold)
        check(a.eval("engine.hitch.get(0)") is None,
              "на пустом кольце get(0) → null")

        # --- Ровные кадры не создают захватов ---------------------------------
        a.eval("engine.hitch.clear()")
        a.step(30)
        level = a.eval("engine.hitch.count()")
        check(level == 0, "на ровных кадрах захватов нет (%s)" % level)

        # --- Искусственный спайк ----------------------------------------------
        arm(a, 1, SPIKE_MS)
        a.step(1 + CONTEXT)   # сам спайк и кадры «после»: контекст дозаполнится
        caught = a.eval("engine.hitch.count()")
        check(caught == 1, "долгий кадр пойман (захватов: %s)" % caught)
        check(a.eval("engine.hitch.total()") == 1,
              "счётчик пойманных растёт (%s)" % a.eval("engine.hitch.total()"))

        cap = a.eval("engine.hitch.get(0)")
        check(isinstance(cap, dict),
              "захват читается объектом (%s)" % type(cap).__name__)
        if not isinstance(cap, dict):
            return report()

        check(cap.get("frame_ms", 0.0) >= SPIKE_MS * 0.9,
              "длительность спайка измерена (%.1f мс при спайке %.0f мс)"
              % (cap.get("frame_ms", -1.0), SPIKE_MS))
        check(cap.get("reason") == "JS: логика",
              "причина названа — самая дорогая зона (reason=%r, %.1f мс)"
              % (cap.get("reason"), cap.get("reason_ms", -1.0)))
        check(cap.get("reason_ms", 0.0) >= SPIKE_MS * 0.8,
              "время причины того же порядка, что спайк (%.1f мс)"
              % cap.get("reason_ms", -1.0))
        check(cap.get("zones_ms", 0.0) <= cap.get("frame_ms", 0.0) + 1e-3,
              "сумма зон не больше измеренного кадра (%.1f ≤ %.1f мс)"
              % (cap.get("zones_ms", 0.0), cap.get("frame_ms", 0.0)))

        ms = cap.get("ms") or []
        zones = cap.get("zones") or []
        check(cap.get("center") == CONTEXT and cap.get("filled") == CONTEXT * 2 + 1,
              "контекст захвата: %d кадра до и %d после (center=%s, filled=%s)"
              % (CONTEXT, CONTEXT, cap.get("center"), cap.get("filled")))
        check(len(ms) == cap.get("filled"),
              "времена кадров контекста отданы целиком (%d)" % len(ms))
        if len(ms) == CONTEXT * 2 + 1:
            check(ms[CONTEXT] == cap.get("frame_ms"),
                  "спайк стоит в центре контекста (%.1f мс)" % ms[CONTEXT])
            check(ms[0] < ms[CONTEXT] and ms[-1] < ms[CONTEXT],
                  "кадры до и после короче спайка (%.1f, %.1f < %.1f)"
                  % (ms[0], ms[-1], ms[CONTEXT]))
        check(len(zones) == len(ms) and all(len(z) == 8 for z in zones),
              "у каждого кадра контекста есть зоны (%d кадров)" % len(zones))
        check(cap.get("threshold_ms") == default_threshold,
              "в захвате записан порог, по которому поймали (%s)"
              % cap.get("threshold_ms"))
        check(cap.get("frame", 0) > 0,
              "у захвата есть номер кадра (%s)" % cap.get("frame"))

        # --- Порог управляет детектором ---------------------------------------
        check(a.eval("engine.hitch.threshold(120)") == 120, "порог выставлен: 120 мс")
        check(a.eval("engine.hitch.threshold()") == 120,
              "threshold() без аргумента читает порог")
        check(a.eval("engine.hitch.threshold(undefined)") == 120,
              "threshold(undefined) — чтение, а не сброс")
        a.eval("engine.hitch.clear()")
        arm(a, 1, SPIKE_MS)
        a.step(1 + CONTEXT)
        above = a.eval("engine.hitch.count()")
        check(above == 0, "спайк %.0f мс ниже порога 120 мс не ловится (%s)"
              % (SPIKE_MS, above))

        check(a.eval("engine.hitch.threshold(50)") == 50, "порог понижен до 50 мс")
        arm(a, 1, SPIKE_MS)
        a.step(1 + CONTEXT)
        below = a.eval("engine.hitch.count()")
        check(below == 1, "тот же спайк выше порога ловится (%s)" % below)

        # --- clear() чистит кольцо, порог остаётся -----------------------------
        a.eval("engine.hitch.clear()")
        cleared = a.eval("engine.hitch.count()") == 0
        check(cleared and a.eval("engine.hitch.total()") == 0,
              "clear() очищает кольцо и счётчик")
        check(a.eval("engine.hitch.threshold()") == 50, "clear() не трогает порог")
        check(a.eval("engine.hitch.get(0)") is None, "после clear() захватов нет")

        # --- Кольцо: порядок и выход за границы --------------------------------
        a.eval("engine.hitch.threshold(30)")
        arm(a, 3, 60.0)
        a.step(3 + CONTEXT)
        n = a.eval("engine.hitch.count()")
        check(n >= 3, "три долгих кадра подряд дали три захвата (%s)" % n)
        oldest = a.eval("engine.hitch.get(0)") or {}
        newest = a.eval("engine.hitch.get(%d)" % (n - 1)) or {}
        check(oldest.get("frame", 0) < newest.get("frame", 0),
              "кольцо отдаёт захваты по времени: get(0) старее get(count-1) (%s < %s)"
              % (oldest.get("frame"), newest.get("frame")))
        check(a.eval("engine.hitch.get(%d)" % n) is None, "get(count) → null")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "нет ошибок игрового кода: %s" % errors[:2])

    # --- Перцентили на РАЗНЫХ временах кадра ---------------------------------
    # Детерминированный режим (--fixed-dt) даёт ровное окно, и перцентили на нём
    # проверяются только на вырожденном случае. Здесь кадры идут по реальным
    # часам, а часть кадров удлиняется занятым циклом: на таком окне видно, что
    # p50/p95/p99 — порядковые статистики фактической истории, а не догадка.
    with Agent(game=GAME, seed=7, fixed_dt=None, start_timeout=60) as a:
        a.step(10)
        a.eval(SPIN_HOOK)
        arm(a, 3, 25.0)
        a.step(60)

        prof = a.eval("engine.profile()") or {}
        stats = prof.get("stats") or {}
        hist = prof.get("history") or []
        check(len(hist) > 0 and len(hist) == stats.get("count"),
              "окно статистики совпадает с историей (%d значений)" % len(hist))
        check(len(set(hist)) > 1,
              "окно не ровное: перцентили считаются по разным кадрам (%d разных)"
              % len(set(hist)))
        p = [stats.get(k) for k in ("min", "p50", "p95", "p99", "max")]
        if all(isinstance(v, (int, float)) for v in p) and hist:
            check(p == sorted(p),
                  "перцентили не убывают: " + " ≤ ".join("%.2f" % v for v in p))
            check(abs(p[0] - min(hist)) < 1e-9 and abs(p[4] - max(hist)) < 1e-9,
                  "min/max совпадают с фактической историей (%.2f … %.2f)"
                  % (min(hist), max(hist)))
            check(abs(stats.get("mean", 0.0) - sum(hist) / len(hist)) < 0.05,
                  "mean — среднее истории (%.3f против %.3f)"
                  % (stats.get("mean", 0.0), sum(hist) / len(hist)))
            check(stats.get("max", 0.0) >= 24.0,
                  "хвост видит искусственные 25 мс (max %.1f мс)" % stats.get("max", 0.0))
        else:
            check(False, "min/p50/p95/p99/max — числа (%s)" % (p,))

        # --- Один спайк — один захват, когда часы настоящие --------------------
        # Здесь dt движка не фиксирован: тот же долгий кадр виден ещё раз в dt
        # следующего кадра. Захват должен остаться один — это одно событие, а не
        # два долгих кадра.
        a.eval("engine.hitch.clear()")
        arm(a, 1, SPIKE_MS)
        a.step(4)
        echo = a.eval("engine.hitch.count()")
        check(echo == 1, "один спайк дал ровно один захват, а не эхо в dt (%s)" % echo)
        only = a.eval("engine.hitch.get(0)") or {}
        check(only.get("frame_ms", 0.0) >= SPIKE_MS * 0.9,
              "длительность единственного захвата — время спайка (%.1f мс)"
              % only.get("frame_ms", -1.0))

        # --- Порядок истории после переполнения кольца -------------------------
        # Спайк, затем ровно 30 кадров: в окне на 120 кадров след спайка в dt
        # обязан стоять на 120-30 = 90-м месте (старые → новые). Физический
        # порядок кольца дал бы другое место — проверка ловит такую путаницу.
        a.eval("engine.profileReset()")
        a.step(130)
        arm(a, 1, SPIKE_MS)
        a.step(1 + 30)
        prof = a.eval("engine.profile()") or {}
        hist = prof.get("history") or []
        stats = prof.get("stats") or {}
        check(len(hist) == 120 and stats.get("count") == 120 == prof.get("frames"),
              "окно ограничено 120 кадрами (%d, count=%s)"
              % (len(hist), stats.get("count")))
        at = len(hist) - 30
        check(at >= 0 and hist[at] >= SPIKE_MS * 0.9,
              "история идёт старые → новые: след спайка на %d-м месте из %d (%.1f мс)"
              % (at, len(hist), hist[at] if hist else -1.0))
        check(bool(hist) and abs(stats.get("max", -1.0) - max(hist)) < 1e-9,
              "max статистики — максимум истории (%.1f мс)" % stats.get("max", -1.0))

    return report()


def report():
    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
