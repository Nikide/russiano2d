#!/usr/bin/env python3
# ===========================================================================
# §10 плана дополировки: save хранит gameplay-состояние и НЕ хранит косметику.
#
# Проверяется на реальном движке, через слот на диске:
#   * поток `presentation` не попадает в снимок RNG слота;
#   * gameplay-поток в снимке есть и восстанавливается загрузкой;
#   * после загрузки презентационный поток НЕ откатывается назад — иначе
#     загрузка сейва перематывала бы картинку (частицы, тряску) к моменту
#     сохранения, то есть косметика вела бы себя как gameplay-состояние;
#   * в снимке нет полей, которых там быть не должно (частицы, тряска камеры,
#     вспышки): они не сохраняются вовсе, а не «сохраняются и игнорируются».
#
# Фикстура — tests/fixtures/save (та же, что у highlevel_save_test.py).
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_save_presentation_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "save")
SLOT = "build/test_saves/slot-7.json"
#: Поля, которых в снимке RNG быть не должно: это состояние картинки.
FORBIDDEN_STREAMS = ("presentation",)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(5)

        # Оба потока создаём и «расходуем»: так видно, что сохраняется именно
        # gameplay, а не только default-последовательность.
        a.eval("$.random.stream('gameplay').next(); $.random.stream('gameplay').next()")
        a.eval("$.random.stream('presentation').next(); $.random.stream('presentation').next()")
        before_pres = a.eval("$.random.stream('presentation').state().value")
        before_game = a.eval("$.random.stream('gameplay').state().value")

        check(a.eval("$.save.save(7)") is True, "слот 7 записан")

        payload = json.loads(a.eval("$.fs.readText('%s')" % SLOT))
        rng = payload.get("namespaces", {}).get("run", {}).get("rng", {})
        check(bool(rng), "снимок RNG лежит в слоте")
        streams = rng.get("streams", {})
        check("gameplay" in streams, "gameplay-поток в снимке есть")
        forbidden = [n for n in FORBIDDEN_STREAMS if n in streams]
        check(not forbidden,
              "презентационных потоков в снимке нет (найдено: %s)" % (forbidden or "ничего"))
        check(streams.get("gameplay", {}).get("value") == before_game,
              "сохранено именно текущее состояние gameplay-потока")

        # Косметика живёт дальше: после загрузки она не должна откатиться.
        a.eval("$.random.stream('presentation').next(); $.random.stream('presentation').next();"
               " $.random.stream('presentation').next()")
        advanced_pres = a.eval("$.random.stream('presentation').state().value")
        check(advanced_pres != before_pres, "презентационный поток ушёл вперёд")

        # Ломаем gameplay-поток, чтобы загрузка была видна по нему.
        a.eval("$.random.stream('gameplay').seed(4242); $.random.stream('gameplay').next()")
        check(a.eval("$.random.stream('gameplay').state().value") != before_game,
              "gameplay-поток сбит перед загрузкой")

        check(a.eval("$.save.load(7)") is True, "слот 7 загружен")
        check(a.eval("$.random.stream('gameplay').state().value") == before_game,
              "загрузка вернула состояние gameplay-потока")
        check(a.eval("$.random.stream('presentation').state().value") == advanced_pres,
              "загрузка НЕ откатила презентационный поток назад")

        # В снимке мира нет транзиентных полей: вспышки/тряска/частицы.
        world = json.dumps(payload.get("world", {})) + json.dumps(payload)
        transient = [name for name in ("shake_timer", "iframes", "tint_timer", "emitters", "particles")
                     if ('"%s"' % name) in world]
        check(not transient,
              "транзиентные поля в слот не попали (найдено: %s)" % (transient or "ничего"))

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
