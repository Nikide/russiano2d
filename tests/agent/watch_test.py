#!/usr/bin/env python3
# ===========================================================================
# Проверка `$.watch` в движке (ROADMAP, фаза 7): вход/выход по составу выборки.
#
# Юнит-тест tests/js/watch_test.mjs проверяет то же без движка; здесь — что тик
# встроен в кадр `$` и что удаление тела/узла действительно даёт выход.
#
# Фикстура tests/fixtures/within/main.js: hero + три врага `.enemy` + спрайты.
#
# Запуск после сборки:
#   python3 tests/agent/watch_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=13, fixed_dt=1.0 / 60.0) as a:
        a.step(2)

        check(a.eval("typeof $.watch") == "function", "$.watch установлен")
        a.eval("globalThis.__entered = []; globalThis.__left = [];")
        a.eval("$.watch('.enemy', { onEnter: (n) => globalThis.__entered.push(n.attr('id')),"
               "                   onLeave: (n) => globalThis.__left.push(n.attr('id')) })")
        check(a.eval("$.watch.count()") == 1, "наблюдение зарегистрировано")

        # Первый кадр: кто уже подходил — не «вошёл».
        a.step(1)
        check(a.eval("globalThis.__entered.length") == 0, "первый тик молчит")
        check(a.eval("JSON.stringify($.watch.list())").find('"size":3') != -1,
              "в наблюдении трое врагов")

        # Новый враг — вход.
        a.eval("$('<enemy>', { id: 'newcomer', class: 'goblin enemy', w: 16, h: 16 })"
               ".at(700, 100).body('static').appendTo($.world)")
        a.step(1)
        check(a.eval("JSON.stringify(globalThis.__entered)") == '["newcomer"]',
              f"вход нового врага: {a.eval('JSON.stringify(globalThis.__entered)')}")

        # Удаление — выход (узел с телом).
        a.eval("$('#enemy1').remove()")
        a.step(1)
        check(a.eval("JSON.stringify(globalThis.__left)") == '["enemy1"]',
              f"выход удалённого врага: {a.eval('JSON.stringify(globalThis.__left)')}")
        check(a.eval("$.watch.list()[0].size") == 3, "в выборке снова трое")

        # Смена класса — тоже выход.
        a.eval("$('#enemy2').removeClass('enemy')")
        a.step(1)
        check(a.eval("globalThis.__left.length") == 2, "выход по смене класса")

        # Остановка наблюдения: события больше не приходят.
        a.eval("$.watch.clear()")
        check(a.eval("$.watch.count()") == 0, "clear снял наблюдения")
        a.eval("$('#enemy0').remove()")
        a.step(1)
        check(a.eval("globalThis.__left.length") == 2, "после stop события не идут")

        # Кадр без наблюдений не ломается и игра живёт.
        a.step(3)
        check(a.eval("$('#hero').pos().x") == 100, "сцена продолжает жить")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
