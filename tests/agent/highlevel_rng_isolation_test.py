#!/usr/bin/env python3
# ===========================================================================
# §11 PRODUCTION_POLISH — Deterministic RNG: gameplay- и presentation-ГПСЧ
# обязаны быть разделены.
#
#   «Частицы, camera shake и декоративный шум не должны изменять
#    последовательность procedural/gameplay random.»
#
# Фикстура tests/fixtures/rng_isolation/main.js гоняет ОДИН и тот же
# детерминированный сценарий дважды; между прогонами меняется ровно одно —
# флаг косметики globalThis.__cosmetic:
#
#   OFF — частицы и тряска камеры не запускаются;
#   ON  — каждый кадр залп частиц и $.camera.shake().
#
# Что проверяется:
#   * захват default-потока $.random.next() (gameplay) совпадает поэлементно
#     у обоих прогонов — косметика не съедает и не сдвигает его;
#   * поток generation тоже не сдвинулся;
#   * косметика во втором прогоне РЕАЛЬНО работала (залпы, живые частицы,
#     ненулевая тряска) — иначе проверка выше прошла бы тривиально;
#   * поток presentation, наоборот, РАЗЛИЧАЕТСЯ: косметика ест именно его —
#     в этом и смысл разделения §11 (симметричная проверка асимметрии).
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_rng_isolation_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "rng_isolation")
FRAMES = 60
TOL = 1e-12


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def diff_index(left, right, tol=TOL):
    """Первый индекс расхождения списков; None — совпали поэлементно.

    Не тот же тип/длина — расхождение на первом несовпавшем месте.
    """
    if not isinstance(left, list) or not isinstance(right, list):
        return -1
    if len(left) != len(right):
        return min(len(left), len(right))
    for i, (a, b) in enumerate(zip(left, right)):
        if abs(float(a) - float(b)) > tol:
            return i
    return None


def show(values, index):
    """Значение списка на месте расхождения — для текста ошибки."""
    if not isinstance(values, list) or not values:
        return "[]"
    i = min(max(index, 0), len(values) - 1)
    return "#%d = %.10g" % (i, values[i])


def run(a, cosmetic):
    """Один прогон: seed(7) → reset → флаг косметики → FRAMES кадров → read."""
    a.eval("$.random.seed(7); __rng.reset(); globalThis.__cosmetic = %s;"
           % ("true" if cosmetic else "false"))
    a.step(FRAMES)
    return a.eval("__rng.read()")


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        # --- 1. Каркас фикстуры -------------------------------------------
        shape = a.eval("({ flag: typeof globalThis.__cosmetic, reset: typeof __rng.reset,"
                       " read: typeof __rng.read, every: __rng.every, size: __rng.captureSize })")
        check(shape.get("flag") == "boolean" and shape.get("reset") == "function"
              and shape.get("read") == "function",
              "фикстура выставила globalThis.__cosmetic и __rng.reset()/read()")

        # --- 2. Прогон OFF: косметика выключена ---------------------------
        off = run(a, False)
        expected = FRAMES // shape["every"] * shape["size"]
        check(off["frames"] == FRAMES and len(off["gameplay"]) == expected
              and len(off["generation"]) == expected
              and len(off["presentation"]) == FRAMES // shape["every"],
              "прогон OFF: %d кадров, захват gameplay/generation по %d значений"
              % (off["frames"], expected))
        check(len(set(off["gameplay"])) == len(off["gameplay"]),
              "прогон OFF: захват gameplay не вырожден (все значения различны)")
        m_off = off["metrics"]
        check(m_off["burst_total"] == 0 and m_off["particles_max"] == 0
              and m_off["shake_max"] == 0,
              "прогон OFF: частицы и тряска не запускались (залпов %d, пик частиц %d,"
              " тряска %.3g)" % (m_off["burst_total"], m_off["particles_max"], m_off["shake_max"]))

        # --- 3. Прогон ON: та же сцена + косметика каждый кадр -------------
        on = run(a, True)
        check(on["frames"] == FRAMES and len(on["gameplay"]) == len(off["gameplay"])
              and len(on["generation"]) == len(off["generation"]),
              "прогон ON: тот же сценарий, те же длины захватов")

        # --- 4. §11: gameplay-поток не сдвинулся ---------------------------
        idx = diff_index(off["gameplay"], on["gameplay"])
        check(idx is None,
              "§11: косметика не изменяет последовательность gameplay random —"
              " $.random.next() совпал поэлементно (%d значений)%s"
              % (len(off["gameplay"]), "" if idx is None else
                 "; первое расхождение #%d: %s против %s"
                 % (idx, show(off["gameplay"], idx), show(on["gameplay"], idx))))

        # --- 5. Симметрично: поток generation тоже не сдвинулся ------------
        gidx = diff_index(off["generation"], on["generation"])
        check(gidx is None,
              "§11: косметика не изменяет поток generation —"
              " $.random.stream('generation') совпал поэлементно (%d значений)%s"
              % (len(off["generation"]), "" if gidx is None else
                 "; первое расхождение #%d: %s против %s"
                 % (gidx, show(off["generation"], gidx), show(on["generation"], gidx))))

        # --- 6. Косметика реально работала (иначе п.4 тривиален) -----------
        m_on = on["metrics"]
        check(m_on["burst_total"] > 0 and m_on["particles_max"] > 0,
              "прогон ON: эмиттер реально выдал частицы (залпов на %d частиц, пик %d,"
              " живых после прогона %d)"
              % (m_on["burst_total"], m_on["particles_max"], m_on["particles_alive"]))
        check(m_on["shake_max"] > 0,
              "прогон ON: camera shake ненулевой (пик |shake| = %.3f px)" % m_on["shake_max"])

        # --- 7. Асимметрия: presentation косметике и принадлежит -----------
        pidx = diff_index(off["presentation"], on["presentation"])
        check(pidx is not None,
              "поток presentation РАЗЛИЧАЕТСЯ между прогонами — косметика потребляет"
              " именно его, gameplay при этом не тронут%s"
              % ("" if pidx is None else " (первое расхождение #%d: %s против %s)"
                 % (pidx, show(off["presentation"], pidx), show(on["presentation"], pidx))))

        check(a.eval("engine.frame") > 0, "кадры идут, фикстура жива")

        if FAILURES:
            print(a.stderr_tail(15))

    print("Все проверки пройдены" if not FAILURES else "ПРОВАЛЕНО: %d" % len(FAILURES))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
