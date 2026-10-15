#!/usr/bin/env python3
# ===========================================================================
# Агентский тест $.flow: последовательности, параллельность, повторы,
# отложенные вызовы, отмена через область владения (§5) и остановка на паузе.
#
# Фикстура: tests/fixtures/flow. Контракт времени — игровое время ($.time),
# поэтому проверка детерминирована при фиксированном шаге.
#
# Запуск (после сборки):
#   python3 tools/run_tests.py highlevel_flow_test
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "flow")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def state(a):
    return a.state().get("flow") or {}


def main():
    with Agent(game=GAME, seed=23) as a:
        a.step(30)   # ~500 мс игрового времени

        # --- Серия, параллель, повторы, after --------------------------------
        s = state(a)
        check(s.get("series") == 1, f"шаг серии выполнен один раз ({s.get('series')})")
        check(s.get("seriesDone") == 1, "then серии сработал ровно один раз")
        check(len(s.get("repeats") or []) == 3,
              f"repeat(3) сработал три раза ({s.get('repeats')})")
        check(s.get("repeats") == [0, 1, 2], "повторы идут по порядку индексов")
        check(s.get("parallelDone") == 1, "parallel завершился один раз")
        check(s.get("parallel") == ["a", "b"],
              f"ветки параллели стартовали в порядке шагов ({s.get('parallel')})")
        check(s.get("afterFired") == 1, "after(50 мс) сработал")

        # --- Область владения отменяет поток --------------------------------
        ticks = s.get("scopedTicks", 0)
        check(ticks > 0, f"поток области работал ({ticks} тиков)")
        check(a.eval("$.flow.active()") >= 1, "поток области виден в $.flow.active()")
        check(a.eval("$.scene.closeScope('flow:room', { immediate: true })") is True,
              "область закрыта")
        s = state(a)
        check(s.get("scopedCancelled") == 1, "then-ветка потока получила отмену")
        frozen = s.get("scopedTicks", 0)
        a.step(10)
        check(state(a).get("scopedTicks", 0) == frozen,
              f"отменённый поток больше не тикает ({frozen})")

        # --- Пауза останавливает расписание ----------------------------------
        a.eval("$.flow.after(200, () => $.store.set('pausedFire', 1)); 'ok'")
        a.eval("$.time.pause(); 'ok'")
        a.step(30)
        check(a.eval("$.store.get('pausedFire', 0)") == 0,
              "на паузе отложенный поток не сработал")
        a.eval("$.time.resume(); 'ok'")
        a.step(30)
        check(a.eval("$.store.get('pausedFire', 0)") == 1,
              "после resume поток догнал время")

        # --- Завершённые потоки не текут -------------------------------------
        a.step(10)
        check(a.eval("$.flow.active()") == 0,
              f"после завершения активных потоков нет ({a.eval('$.flow.active()')})")
        check(a.ping().get("pong") is True, "движок жив")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
