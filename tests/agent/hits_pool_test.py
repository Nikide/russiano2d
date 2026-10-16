#!/usr/bin/env python3
# ===========================================================================
# C3 отчёта BASHNYA: пул эмиттеров `$.hits`.
#
# `$.hits.play()` бьёт частицами из кольца эмиттеров (узлы `__hitfx_<slot>`):
# удар случается часто, и создавать узел на каждый удар — мусор в реестре.
# Кольцо рассчитано на 8 слотов, поэтому ДЕВЯТЫЙ одновременный удар
# переиспользует первый слот: `restart()` чистит его пул, и залп первого удара
# обрывается. Отчёт внешней команды просил либо поднять дефолт, либо дать
# настраиваемое число слотов с честной границей.
#
# Здесь проверяется ФАКТИЧЕСКОЕ поведение пула (оно и есть контракт, пока
# `$.hits.pool` не подключён): сколько узлов заводится, что девятый удар
# забирает нулевой слот, и что числа из `$.hits.stats()` это подтверждают.
# Часть про `$.hits.pool(n)` включается сама, как только метод появится, — до
# этого она печатает честную пометку, а не «ok».
#
# Запуск (после сборки):
#   python3 tests/agent/hits_pool_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "hello")

#: Кольцо эмиттеров хит-фидбека: столько слотов заводит `spawnBurst`
#: (src/highlevel/hits.js, `state.next_emitter++ % 8`).
RING = 8


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


def hit(a, x, y):
    return ev(a, "$.hits.play({ x: %r, y: %r }, { preset: 'crit' }).point" % (x, y))


def emitter_pos(a, slot):
    return ev(a, "(function(){ var n = $('#__hitfx_%d');"
                " return n.length ? n.pos() : null; })()" % slot)


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)
        check(ev(a, "typeof $.hits.play") == "function", "$.hits.play доступен")
        stats0 = ev(a, "$.hits.stats()", {})
        check(stats0.get("emitters") == 0, "на старте пул эмиттеров пуст")

        # --- 1. Кольцо: 3 удара → 3 узла, 8 → 8 -------------------------------
        for i in range(3):
            hit(a, 100 + i * 40, 200)
        a.step(1)
        s3 = ev(a, "$.hits.stats()", {})
        check(s3.get("emitters") == 3, "три удара заводят три эмиттера (%s)"
              % s3.get("emitters"))
        check(s3.get("plays") == 3, "три удара посчитаны (%s)" % s3.get("plays"))

        for i in range(5):
            hit(a, 300 + i * 40, 200)
        a.step(1)
        s8 = ev(a, "$.hits.stats()", {})
        check(s8.get("emitters") == RING,
              "восемь ударов занимают всё кольцо (%s из %d)" % (s8.get("emitters"), RING))
        alive8 = sum(1 for i in range(RING)
                     if ev(a, "$('#__hitfx_%d').length" % i) == 1)
        check(alive8 == RING, "все %d узлов кольца существуют (%d)" % (RING, alive8))

        # --- 2. Девятый удар: слот 0 переиспользуется -------------------------
        point9 = {"x": 900, "y": 500}
        hit(a, point9["x"], point9["y"])
        a.step(1)
        s9 = ev(a, "$.hits.stats()", {})
        check(s9.get("emitters") == RING,
              "девятый удар не заводит девятый узел (%s)" % s9.get("emitters"))
        pos0 = emitter_pos(a, 0)
        check(isinstance(pos0, dict) and abs(pos0["x"] - point9["x"]) < 1e-6
              and abs(pos0["y"] - point9["y"]) < 1e-6,
              "девятый удар забрал нулевой слот: %s" % (pos0,))
        # Обрыв первого залпа — следствие того же restart(): у эмиттера 0
        # рождённые ранее частицы заменены залпом девятого удара.
        check(ev(a, "$('#__hitfx_0').count()") > 0,
              "в нулевом слоте живёт залп девятого удара (частиц: %s)"
              % ev(a, "$('#__hitfx_0').count()"))
        check(ev(a, "Object.keys($.hits.stats()).sort().join(',')") == "emitters,plays,tweens",
              "stats() отдаёт plays/tweens/emitters")

        # --- 3. Настраиваемый пул (появится вместе с патчем hits.js) ----------
        has_pool = ev(a, "typeof $.hits.pool") == "function"
        if not has_pool:
            print("  --   $.hits.pool ещё не подключён (патч у Lead'а): "
                  "проверка настраиваемого пула не выполнена, текущий контракт — "
                  "кольцо на %d слотов" % RING)
        else:
            check(ev(a, "$.hits.pool()") == RING, "pool() без аргумента — текущий размер")
            check(ev(a, "$.hits.pool(16)") is True, "pool(16) принят")
            check(ev(a, "$.hits.pool()") == 16, "pool() вернул 16")
            ev(a, "$.hits.clear()")
            # Кольцо продолжается с того места, где остановилось (next_emitter не
            # сбрасывается — это состояние пула, а не размер). Поэтому проверяем
            # ДЕТЕРМИНИРОВАННО: 16 ударов обязаны занять все 16 слотов, сколько бы
            # ударов ни было до этого.
            for i in range(16):
                hit(a, 1000 + i * 20, 300)
            a.step(1)
            sixteen = sum(1 for i in range(16) if ev(a, "$('#__hitfx_%d').length" % i) == 1)
            check(sixteen == 16, "при пуле 16 все шестнадцать слотов заведены (%d)" % sixteen)
            s16 = ev(a, "$.hits.stats()", {})
            check(s16.get("emitters") == 16,
                  "в пуле ровно 16 эмиттеров, а не 8 (%s)" % s16.get("emitters"))
            # Девять одновременных ударов при пуле 16 не должны ничего обрывать:
            # каждый берёт свой слот, число эмиттеров не растёт и не падает.
            before9 = s16.get("emitters")
            for i in range(9):
                hit(a, 2000 + i * 30, 300)
            a.step(1)
            s9b = ev(a, "$.hits.stats()", {})
            check(s9b.get("emitters") == before9,
                  "девять ударов при пуле 16 никого не обрывают (%s → %s)"
                  % (before9, s9b.get("emitters")))
            check(ev(a, "$.hits.pool(0)") is False, "pool(0) отклонён")
            check(ev(a, "$.hits.pool(1000)") is False, "pool(1000) отклонён (потолок)")
            check(ev(a, "$.hits.pool()") == 16, "отказы не поменяли размер пула")
            check(ev(a, "$.hits.pool(8)") is True, "возврат к дефолту принят")

        check(a.ping().get("pong") is True, "движок отвечает после проверок пула")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
