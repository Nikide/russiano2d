#!/usr/bin/env python3
# ===========================================================================
# Тест явного отказа от параллакса (часть I1 отчёта BASHNYA).
#
# Дефект: у ребёнка слоя с parallax коэффициент наследуется каждый кадр, а
# `.parallax(null)` только удалял поле. На следующем кадре propagateLayer
# видел `undefined` и снова раздавал коэффициент родителя — отказ не держался,
# и узел продолжал уезжать с камерой. Игра ставила `.parallax(null)` на свет и
# декор, а он молча не работал.
#
# Контракт: null — это ЯВНЫЙ отказ (отличается от «коэффициент не задан»),
# наследование его не перезаписывает; повторная установка числа снова включает
# параллакс. Позиция при отказе остаётся там, где узел нарисован сейчас:
# владение позицией при активном параллаксе — отдельное ограничение (layers.md).
#
# Запуск (собранный движок):
#   python3 tests/agent/layers_parallax_optout_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "layers")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(2)
        a.eval("$.camera.at(0, 0)")
        a.step(2)

        check(abs(a.eval("$.layers.parallax('#star0')") - 0.5) < 1e-6,
              "ребёнок слоя bg наследует parallax 0.5")
        check(abs(a.eval("$('#star0').pos().x") - 60) < 2,
              "камера 0: звезда на x≈60")

        # Явный отказ.
        a.eval("(() => { $('#star0').parallax(null); })()")
        check(a.eval("$.layers.parallax('#star0')") is None,
              "сразу после parallax(null) коэффициент = null")
        a.step(2)
        check(a.eval("$.layers.parallax('#star0')") is None,
              "отказ держится на следующем кадре (наследование не вернуло 0.5)")

        x_before = a.eval("$('#star0').pos().x")
        a.eval("$.camera.at(200, 0)")
        a.step(2)
        x_after = a.eval("$('#star0').pos().x")
        check(abs(x_after - x_before) < 2,
              f"узел без параллакса не уезжает с камерой ({x_before:.0f} → {x_after:.0f}, ждём ≈60)")
        check(abs(a.eval("$.layers.offset('#star0').x")) < 1e-6,
              "без параллакса смещение отрисовки = 0")

        # Повторная установка числа снова включает параллакс.
        a.eval("(() => { $('#star0').parallax(0.5); })()")
        a.step(2)
        check(abs(a.eval("$.layers.parallax('#star0')") - 0.5) < 1e-6,
              "parallax(0.5) снова включает узел")
        check(abs(a.eval("$('#star0').pos().x") - 60) < 2,
              "включение не телепортирует узел (остаётся x≈60)")
        a.eval("$.camera.at(300, 0)")
        a.step(2)
        check(abs(a.eval("$('#star0').pos().x") - 60) < 2,
              "I1: .pos() — позиция игры, не уезжает (остаётся 60)")
        check(abs(a.eval("$.layers.offset('#star0').x") - 50) < 3,
              "после включения смещение отрисовки считается от камеры (300 → 50)")
        check(abs(a.eval("$('#star0').pos().x") + a.eval("$.layers.offset('#star0').x") - 110) < 3,
              "нарисованное место — 110, как раньше")

        # Снятие у слоя не трогает уже розданные коэффициенты детей, но и не
        # возвращает их наследованием.
        a.eval("(() => { $.layers.get('bg').parallax(null); })()")
        check(a.eval("$.layers.parallax('bg')") is None, "у слоя bg коэффициент снят")
        check(abs(a.eval("$.layers.parallax('#star0')") - 0.5) < 1e-6,
              "у ребёнка остался свой коэффициент")

    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
