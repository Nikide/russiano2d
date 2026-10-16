#!/usr/bin/env python3
# ===========================================================================
# BASHNYA I5 (task-61): предзагрузка текстур ПО ПУТИ и счётчики.
#
# Было: `$.resource.preload(['art/level1.png'])` отвечал `{loaded: 0, failed: 1}`
# и не грузил ничего — игре приходилось «греть» текстуры выбрасываемыми
# спрайтами. Стало: `$.resource.preloadTexture(path|[paths])` грузит без узлов,
# `$.resource.textureStats()` показывает, сколько занято.
#
# Запуск:
#   python3 tests/agent/texture_preload_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/texture_preload_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
DIR = os.path.join(ROOT, "build", "res_free")
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


def main():
    if not os.path.exists(os.path.join(DIR, "ov0.png")):
        print("нужны файлы build/res_free/ov*.png (их делает resource_free_test)")
        return 1
    a_path = os.path.join(DIR, "ov0.png").replace("\\", "/")
    b_path = os.path.join(DIR, "ov1.png").replace("\\", "/")

    with Agent(game=GAME, seed=5) as a:
        a.step(5)
        check(a.eval("typeof $.resource.preloadTexture") == "function",
              "$.resource.preloadTexture() есть (I5)")
        check(a.eval("typeof $.resource.textureStats") == "function",
              "$.resource.textureStats() есть (I5)")

        before = a.eval("$.resource.textureStats()")
        number("до прогрева: %s" % before)
        check(isinstance(before.get("count"), int) and isinstance(before.get("mb"), (int, float)),
              "textureStats отдаёт числа: %s" % before)

        res = a.eval("$.resource.preloadTexture(['%s', '%s', 'нет/такого.png'])" % (a_path, b_path))
        number("preloadTexture(2 валидных + 1 нет): %s" % res)
        check(res.get("loaded") == 2, "загрузилось ровно две: %s" % res.get("loaded"))
        check(res.get("failed") == 1 and res.get("failedPaths") == ["нет/такого.png"],
              "несуществующий путь назван: %s" % res.get("failedPaths"))
        check(res.get("mb") > 7.5, "прибавка в МБ посчитана: %s" % res.get("mb"))

        after = a.eval("$.resource.textureStats()")
        number("после прогрева: %s" % after)
        check(after.get("count") == before.get("count") + 2,
              "текстур стало на две больше: %s → %s" % (before.get("count"), after.get("count")))
        check(after.get("mb") - before.get("mb") > 7.5,
              "память выросла на кадры: %s → %s" % (before.get("mb"), after.get("mb")))

        freed = a.eval("$.resource.freeTexture('%s')" % a_path)
        number("freeTexture после прогрева (узел не создавали): %s" % freed)
        check(freed.get("ok") is True and freed.get("busy") is False,
              "прогретую текстуру можно освободить: %s" % freed)
        final = a.eval("$.resource.textureStats()")
        check(final.get("count") == after.get("count") - 1, "счётчик вернулся: %s" % final)

        check(a.ping().get("pong") is True, "движок отвечает")

    print()
    for line in NUMBERS:
        print("  --   " + line)
    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
