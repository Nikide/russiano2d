#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы пула объектов ($.pool) через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/pool и проверяет то, что видит игра:
# регистрацию пулов, spawn/release, переиспользование объекта узла, лимит
# роста, releaseAll/clear, работу с телами Box2D, сброс состояния между
# выдачами и счётчики подсистем в $.debug.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_pool_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "pool")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Пространство имён и фикстура -------------------------------------
        check(a.eval("typeof $.pool") == "object", "$.pool доступно")
        check(a.eval("$.pool.has('bullets')") is True, "фикстура создала пул bullets")
        check(a.eval("$.pool.has('shots')") is True, "фикстура создала пул shots")
        check(a.eval("$.pool.get('bullets').max") == 3, "дескриптор пула читается")
        check(a.eval("$.pool.get('bullets').created") == 1, "initial=1 предсоздал узел")
        check(a.eval("$.pool.get('bullets').free") == 1, "предсозданный узел свободен")
        check(a.eval("$.pool.get('bullets').active") == 0, "свободных в мир не вывели")
        check(a.eval("$.pool.get('нет-такого')") is None, "неизвестный пул — None")

        # --- spawn и release ---------------------------------------------------
        a.eval("globalThis.__w = $.pool.spawn('bullets', { id: 'b1', x: 100, y: 120 })")
        check(a.eval("globalThis.__w.length") == 1, "spawn выдал узел")
        check(a.eval("typeof globalThis.__w.release") == "function", "у обёртки есть .release()")
        check(a.eval("$('#b1').length") == 1, "выданный узел найден селектором")
        pos = a.eval("$('#b1').pos()")
        check(isinstance(pos, dict) and pos.get("x") == 100 and pos.get("y") == 120,
              "opts применились к узлу (%s)" % pos)
        check(a.eval("globalThis.__w.nodes[0].visible") is True, "выданный узел видим")
        check(a.eval("globalThis.__w.nodes[0].attrs.acquired") == 1, "onAcquire вызван")
        check(a.eval("$.pool.get('bullets').active") == 1, "узел числится выданным")
        check(a.eval("$.pool.get('bullets').free") == 0, "свободных не осталось")

        base_world = a.eval("$.world.count()")
        a.eval("globalThis.__node = globalThis.__w.nodes[0]; globalThis.__w.release()")
        check(a.eval("$.pool.get('bullets').active") == 0, "release вернул узел в пул")
        check(a.eval("$.pool.get('bullets').free") == 1, "узел снова свободен")
        check(a.eval("$('#b1').length") == 0, "освобождённый узел не найден селектором")
        check(a.eval("$.world.count()") == base_world - 1, "освобождённый узел вышел из мира")
        check(a.eval("globalThis.__node.visible") is False, "освобождённый узел невидим")
        check(a.eval("globalThis.__node.attrs.released") == 1, "onRelease вызван")

        # --- Переиспользование и сброс состояния -------------------------------
        a.eval("globalThis.__w2 = $.pool.spawn('bullets', { x: 10, y: 10 })")
        check(a.eval("globalThis.__w2.nodes[0] === globalThis.__node") is True,
              "spawn после release вернул тот же объект Node")
        check(a.eval("$.pool.get('bullets').created") == 1, "новый узел не создавался")
        check(a.eval("globalThis.__node.x") == 10 and a.eval("globalThis.__node.y") == 10,
              "новые opts применились")

        # --- Лимит роста -------------------------------------------------------
        a.eval("$.pool.spawn('bullets'); $.pool.spawn('bullets'); $.pool.spawn('bullets')")
        check(a.eval("$.pool.get('bullets').created") == 3, "создано ровно max узлов")
        check(a.eval("$.pool.get('bullets').active") == 3, "выданы все три")
        check(a.eval("$.pool.get('bullets').stats().skipped") >= 1, "лишний spawn пропущен")
        check(a.eval("$.pool.spawn('bullets').length") == 0, "сверх лимита — пустая обёртка")
        check(a.eval("$.pool.releaseAll('bullets')") == 3, "releaseAll вернул всех")
        check(a.eval("$.pool.get('bullets').active") == 0, "после releaseAll пул пуст")
        check(a.eval("$.pool.get('bullets').free") == 3, "все узлы снова свободны")

        # --- Тела Box2D --------------------------------------------------------
        a.eval("globalThis.__s = $.pool.spawn('shots', { x: 200, y: 200 })")
        check(a.eval("globalThis.__s.length") == 1, "spawn физического пула сработал")
        check(a.eval("globalThis.__s.nodes[0].body") >= 0, "spawn создал тело")
        a.eval("globalThis.__s.release()")
        # Тело больше не уничтожается: пул держит его выключенным и включает
        # обратно на spawn (docs/HIGH_LEVEL_API_PERF.md §3.6, пункт 15 плана).
        check(a.eval("globalThis.__s.nodes[0].body") >= 0, "тело осталось живым")
        check(a.eval("engine.bodyEnabled(globalThis.__s.nodes[0].body)") is False,
              "release выключил тело")
        a.eval("globalThis.__s2 = $.pool.spawn('shots')")
        check(a.eval("globalThis.__s2.nodes[0] === globalThis.__s.nodes[0]") is True,
              "узел с телом переиспользован")
        check(a.eval("globalThis.__s2.nodes[0].body") >= 0, "тело живо")
        check(a.eval("engine.bodyEnabled(globalThis.__s2.nodes[0].body)") is True,
              "spawn включил тело обратно")
        a.eval("globalThis.__s2.release()")

        # --- Счётчики подсистем ------------------------------------------------
        a.step(1)
        stats = a.eval("$.pool.stats()")
        check(isinstance(stats, dict) and stats.get("pools") == 2, "$.pool.stats() знает оба пула")
        check(stats.get("created") == 4, "создано 4 узла за всё время")
        counters = a.eval("$.debug.counters()")
        check(isinstance(counters, dict), "$.debug.counters() отвечает объектом")
        check(counters.get("pools") == 2, "счётчик пулов")
        check(counters.get("pool_created") == 4, "счётчик созданных узлов пулов")
        check(counters.get("pool_free") == 4, "счётчик свободных узлов пулов")
        check(counters.get("pool_active") == 0, "счётчик выданных узлов пулов")
        check(isinstance(a.eval("$.debug.stats().counters"), dict),
              "$.debug.stats() выводит счётчики")

        # --- clear и защита от ошибок -----------------------------------------
        a.eval("$.pool.clear('shots')")
        check(a.eval("$.pool.has('shots')") is False, "clear снял пул с учёта")
        check(a.eval("$.pool.get('shots')") is None, "после clear get возвращает None")
        check(a.eval("$.pool.create({ tag: 'rect' })") is None, "create без имени — None")
        check(a.eval("$.pool.create({ name: 'x', tag: 'нет-такого' })") is None,
              "create с неизвестным тегом — None")
        check(a.eval("$.pool.spawn('нет-такого').length") == 0,
              "spawn неизвестного пула не роняет кадр")

        # --- Движок жив --------------------------------------------------------
        check(a.ping().get("pong") is True, "движок отвечает после работы пула")
        check(a.eval("engine.frame") > 0, "кадры идут")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
