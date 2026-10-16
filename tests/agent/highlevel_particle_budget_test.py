#!/usr/bin/env python3
# ===========================================================================
# §21 Спецификации: бюджеты VFX, часы эффектов, завершение и reduced-настройки.
#
# Приёмка §21 требует конкретного:
#   * сотни последовательных ударов не создают неограниченного числа узлов и
#     эмиттеров;
#   * pause/hit-stop соответствуют выбранным часам эффекта;
#   * перезапуск эффекта не сохраняет мусор предыдущего;
#   * при ограничении бюджета бой и результаты генерации не меняются;
#   * reduced flash/shake уменьшают presentation, сохраняя gameplay-события.
#
# Запуск:
#   python3 tests/agent/highlevel_particle_budget_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/highlevel_particle_budget_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "particle_budget")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def load(a, expr):
    return json.loads(a.eval(expr))


def run_hits(a, n):
    a.eval("globalThis.__fx.n = %d; void 0" % n)
    return load(a, "__fx.runHits()")


def counts(a):
    return load(a, "__fx.counts()")


def state(a):
    return load(a, "__fx.state()")


def main():
    with Agent(game=GAME, seed=4, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(4)
        before = counts(a)

        # --- Бюджет: серия ударов -------------------------------------------
        first = run_hits(a, 200)
        a.step(8)
        after_first = counts(a)
        second = run_hits(a, 200)
        a.step(8)
        after_second = counts(a)

        check(first["applied"] == 200, "первая серия: засчитано 200 ударов (%s)" % first["applied"])
        check(second["applied"] == 200, "вторая серия: засчитано 200 ударов (%s)" % second["applied"])
        # Узлы: равенство берём между ПЕРВОЙ и ВТОРОЙ серией. Первая серия
        # создаёт пул эмиттеров для фидбека (`$.hits` держит их на узел) — это
        # и есть ограниченный бюджет, а не утечка. Неограниченный рост выглядел
        # бы как рост на второй серии, поэтому проверяем именно его.
        check(after_second["nodes"] == after_first["nodes"],
              "узлы не растут между сериями: %d → %d (после 400 ударов)"
              % (after_first["nodes"], after_second["nodes"]))
        check(after_second["nodes"] - before["nodes"] <= 12,
              "пул фидбека ограничен: %d → %d узлов на 400 ударов"
              % (before["nodes"], after_second["nodes"]))
        check(after_second["emitters"] <= 12,
              "эмиттеров не больше предела на узел: %d (после 400 ударов)" % after_second["emitters"])
        check(after_second["emitters"] == after_first["emitters"],
              "вторая серия не добавила эмиттеров (%d → %d)"
              % (after_first["emitters"], after_second["emitters"]))
        check(after_second["particles"] <= 512,
              "частиц не больше глобального бюджета: %d" % after_second["particles"])

        # --- Частицы возвращаются в пул --------------------------------------
        a.step(180)
        settled = counts(a)
        check(settled["particles"] == 0,
              "после затухания частиц не осталось (мусора нет): %d" % settled["particles"])
        check(settled["emitters"] == after_second["emitters"],
              "эмиттеры не исчезают и не плодятся сами: %d" % settled["emitters"])

        # --- Перезапуск эффекта не копит мусор --------------------------------
        a.eval("__fx.withBurst(true)")
        ended_before = state(a)["ends"]
        run_hits(a, 1)
        a.step(40)
        ended_after = state(a)["ends"]
        check(ended_after > ended_before,
              "разовый эффект сообщает о завершении событием (%d → %d)" % (ended_before, ended_after))
        a.eval("__fx.withBurst(false)")

        # --- Часы: эффект на presentation-часах живёт во время hit-stop --------
        clear_all = "$('particles').each((i, e) => { e.clear(); e.stop(); }); void 0"

        def settle(a, steps=4):
            a.eval(clear_all)
            a.step(steps)
            a.eval(clear_all)
            a.step(steps)

        def peak_particles(a, steps=25):
            """Максимум частиц за окно: одна точка замера врёт — залп живёт кадры."""
            peak = 0
            for _ in range(steps):
                a.step(1)
                peak = max(peak, counts(a)["particles"])
            return peak

        # Разовый эффект фикстуры объявлен с clock:'presentation': при hit-stop
        # игровое время стоит, а он обязан продолжать жить.
        a.eval("__fx.withBurst(true)")
        a.eval("$.time.freeze(400)")
        run_hits(a, 1)
        a.step(3)
        during = counts(a)["particles"]
        a.step(6)
        later = counts(a)["particles"]
        check(during > 0 and later > 0,
              "эффект на presentation-часах живёт во время hit-stop (%d → %d)" % (during, later))
        a.eval("$.time.resume ? $.time.resume() : $.time.freeze(0)")
        a.step(20)
        a.eval("__fx.withBurst(false)")
        settle(a)
        check(counts(a)["particles"] == 0,
              "после снятия заморозки и очистки частиц нет (%d)" % counts(a)["particles"])

        # --- reduced: presentation меньше, gameplay тот же ---------------------
        settle(a)
        # Настройки задаём напрямую на движке: один источник истины, без
        # промежуточной переменной в фикстуре (её потеря и была причиной 14→14).
        a.eval("$.hits.reduced(false)")
        plain_state = load(a, "__fx.state()")
        run_hits(a, 1)
        plain_peak = peak_particles(a)

        settle(a)
        a.eval("$.hits.reduced({ flash: true, shake: true, particles: true, factor: 0.1 })")
        reduced_state = load(a, "__fx.state()")
        run_hits(a, 1)
        reduced_peak = peak_particles(a)

        # Сравниваем ПРИРОСТ, а не абсолютные числа: за 400 ударов до этого счётчики
        # уже накоплены, и «равенство итогов» ничего не проверяло бы.
        check(reduced_state["hits"] - plain_state["hits"] >= 0 and reduced_state["hits"] >= plain_state["hits"],
              "reduced не меняет факт урона (оба удара засчитаны)")
        check(reduced_state["damage"] - plain_state["damage"] == 7,
              "reduced не меняет применённый урон (+%d)" % (reduced_state["damage"] - plain_state["damage"]))
        check(reduced_state["hits"] - plain_state["hits"] == 1,
              "reduced не меняет счётчик попаданий (+%d)" % (reduced_state["hits"] - plain_state["hits"]))
        check(reduced_peak < plain_peak,
              "reduced уменьшает число частиц (пик %d → %d)" % (plain_peak, reduced_peak))

        settings = load(a, "__fx.reducedNow()")
        check(settings.get("flash") is True and settings.get("shake") is True,
              "настройки reduced читаются обратно (%s)" % settings)

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
