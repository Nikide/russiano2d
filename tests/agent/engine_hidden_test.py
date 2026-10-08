#!/usr/bin/env python3
# ===========================================================================
# Игре виден только `$`: схема движка C → $, без engine.* в игровом коде.
#
# bootstrap.js убирает globalThis.engine после установки $, а загрузчик модулей
# (src/script.c) отдаёт внутренние r2d/* только самим модулям движка. Агентский
# eval — инструмент диагностики — видит engine на время вызова.
#
# Запуск после сборки:
#   python3 tests/agent/engine_hidden_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "no_engine")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=1, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        check(a.eval("globalThis.__top") == "undefined", "верхний уровень main.js не видит engine")
        check(a.eval("globalThis.__frame") == "undefined", "кадр игры ($.update) не видит engine")
        native = a.eval("globalThis.__native_import")
        check(str(native).startswith("отказ"), "import('r2d/native.js') из игры отклонён: %s" % native)
        check(a.eval("globalThis.__r2d_import") == "тот же $", "import('r2d') отдаёт тот же $")
        check(a.eval("typeof $.ready") == "function", "$ доступен")
        check(a.eval("typeof engine") == "object", "агентский eval видит engine (диагностика)")
        a.step(1)
        check(a.eval("globalThis.__frame") == "undefined", "после eval engine снова скрыт от игры")
        check(a.eval("$.startScene") is None, "$.startScene без --scene — null")
        check(isinstance(a.eval("$.gfx.white"), int), "$.gfx.white — id белого спрайта")

        # То, что раньше игра брала из engine.* напрямую, теперь есть в $.
        a.eval("$('<enemy>', { id: 'spin' }).at(100, 100).appendTo($.world); true")
        a.step(1)
        check(a.eval("$('#spin').mass()") > 0, "$().mass() — масса тела")
        a.eval("$('#spin').angularVelocity(2); $('#spin').allowSleep(false); true")
        a.step(1)
        check(isinstance(a.eval("$('#spin').angularVelocity()"), (int, float)), "$().angularVelocity() читает скорость тела")
        ch = a.eval("$.sound.channel(0)")
        check(isinstance(ch, dict) and "playing" in ch and "volume" in ch, "$.sound.channel(ch) — состояние канала: %s" % ch)
        r = a.eval("$.debug.render()")
        check(isinstance(r, dict) and "info" in r and "depth" in r, "$.debug.render() — факты рендера")
        m = a.eval("$.debug.memory()")
        check(isinstance(m, dict) and m.get("objects", 0) > 0, "$.debug.memory() — факты о куче")

    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
