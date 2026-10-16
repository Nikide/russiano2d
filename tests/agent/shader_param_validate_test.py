#!/usr/bin/env python3
# ===========================================================================
# BASHNYA I13 (task-61): параметры эффекта называют себя, а не молчат.
#
# Было: `.shader('wave', { amplitude: NaN })` и опечатка `{ amplitud: 0.5 }`
# проходили МОЛЧА — параметр превращался в значение по умолчанию, эффект «не
# работал», и узнать причину было неоткуда. Стало: нечисло и неизвестное имя
# отклоняются, причина уходит в `$.debug.errors()` кодом
# `R2D_SHADER_PARAM_INVALID`, а валидные параметры применяются как раньше.
#
# Запуск:
#   python3 tests/agent/shader_param_validate_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/shader_param_validate_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("demos", "litsprites")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5) as a:
        a.step(5)
        a.eval("$('<sprite>', { id: 'bg', src: 'assets/sign.png' }).size(64, 64).at(300, 300).appendTo($.world); 1")
        a.step(2)

        params = a.eval("""(() => {
            $('#bg').shader('wave', { amplitude: 0.05, frequency: 24, phase: 0 });
            return $('#bg').shaderParam();
        })()""")
        check(params.get("amplitude") == 0.05 and params.get("frequency") == 24,
              "валидные параметры применяются: %s" % params)

        nan = a.eval("""(() => {
            $('#bg').shader('wave', { amplitude: NaN, frequency: 30 });
            return $('#bg').shaderParam();
        })()""")
        check("amplitude" not in nan, "NaN отклонён, а не подменён значением по умолчанию: %s" % nan)
        check(nan.get("frequency") == 30, "остальные параметры применились: %s" % nan)

        typo = a.eval("""(() => {
            $('#bg').shader('wave', { amplitud: 0.5 });
            return $('#bg').shaderParam();
        })()""")
        check("amplitud" not in typo, "опечатка не попала в параметры: %s" % typo)

        one = a.eval("""(() => {
            $('#bg').shader('wave', { amplitude: 0.05, frequency: 30 });
            $('#bg').shaderParam('frequency', 'abc');
            return $('#bg').shaderParam();
        })()""")
        check(one.get("frequency") == 30, "shaderParam тоже проверяет тип: %s" % one)

        errors = [e for e in a.eval("$.debug.errors()") if e.get("code") == "R2D_SHADER_PARAM_INVALID"]
        check(len(errors) >= 3, "каждый отказ оставил структурную ошибку: %d" % len(errors))
        if errors:
            check("amplitud" in str(errors[0].get("message")) or "amplitud" in str(errors[-1].get("message")),
                  "в ошибке назван параметр: %s" % errors[-1].get("message"))
            check(errors[-1].get("subsystem") == "shader", "subsystem=shader: %s" % errors[-1].get("subsystem"))

        still = a.eval("$('#bg').shader()")
        check(still == "wave", "эффект остался на узле: %s" % still)
        check(a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
