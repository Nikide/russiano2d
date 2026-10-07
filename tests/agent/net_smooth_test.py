#!/usr/bin/env python3
# ===========================================================================
# Сглаживание откатов: $.net.prediction().visual(dt, opts).
#
# Зачем: клиент откатывается к серверному состоянию и повторяет неподтверждённый
# ввод. Если рисовать `predicted` напрямую, каждая коррекция ДЁРГАЕТ картинку.
# Сглаживание держит отдельное визуальное состояние и подтягивает его плавно.
#
# Чистая часть (smoothState) покрыта юнит-тестом tests/js/net_test.mjs; здесь
# проверяем, что метод есть В ДВИЖКЕ и ведёт себя так же.
#
# Запуск после сборки:
#   python3 tests/agent/net_smooth_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.eval("""
            $.net.bindEngine();
            $.net.predict((state, input) => ({ x: (state.x || 0) + (input.dx || 0) }));
        """)
        pred = a.eval("typeof $.net.prediction().visual")
        check(pred == "function", "$.net.prediction().visual есть в движке")
        check(a.eval("typeof $.net.prediction().visualError") == "function",
              "visualError есть")
        check(a.eval("typeof $.net.prediction().resetVisual") == "function",
              "resetVisual есть")

        # Инициализация: первый вызов ставит цель как есть.
        a.eval("$.net.applyInput({ seq: 1, dx: 100 })")
        check(a.eval("$.net.prediction().state().x") == 100, "предсказание дало 100")
        v0 = a.eval("$.net.prediction().visual(1/60, { rate: 12 }).x")
        check(abs(v0 - 100) < 1e-9, f"первый visual — без сглаживания ({v0})")
        check(a.eval("$.net.prediction().visualError()") == 0,
              "и отставания нет")

        # Цель уехала: визуал должен догонять, а не прыгнуть.
        a.eval("$.net.applyInput({ seq: 2, dx: 100 })")
        check(a.eval("$.net.prediction().state().x") == 200, "предсказание дало 200")
        v1 = a.eval("$.net.prediction().visual(1/60, { rate: 12 }).x")
        print(f"  визуал после сдвига цели: {v1:.1f} (между 100 и 200)")
        check(100 < v1 < 200, f"визуал НЕ телепортировался ({v1:.1f})")
        check(a.eval("$.net.prediction().visualError()") > 0, "отставание видно")

        # Догоняет за секунду.
        a.eval("for (let i = 0; i < 120; i++) $.net.prediction().visual(1/60, { rate: 12 });")
        err = a.eval("$.net.prediction().visualError()")
        print(f"  отставание через 2 с: {err:.4f}")
        check(err < 1, f"визуал догнал цель ({err:.4f})")

        # snap: далёкий скачок ставится сразу (телепорт, а не коррекция).
        a.eval("$.net.applyInput({ seq: 3, dx: 5000 })")
        v2 = a.eval("$.net.prediction().visual(1/60, { rate: 12, snap: 500 }).x")
        print(f"  при snap 500 и скачке 5000: {v2:.1f}")
        check(abs(v2 - 5200) < 1e-9, f"телепорт поставлен сразу ({v2:.1f})")

        # Сброс визуала.
        a.eval("$.net.prediction().resetVisual()")
        check(a.eval("$.net.prediction().visualError()") == 0,
              "resetVisual забыл визуал")

        # Сглаживание не ломает саму модель: правда остаётся серверной, а
        # неподтверждённый ввод ПОВТОРЯЕТСЯ поверх неё.
        a.eval("$.net.prediction().acknowledge({ x: 10 }, 2)")
        st2 = a.eval("$.net.prediction().state().x")
        print(f"  acknowledge до seq 2: {st2} (10 + неподтверждённый ввод 5000)")
        check(abs(st2 - 5010) < 1e-9,
              f"неподтверждённый ввод повторён поверх правды ({st2})")

        a.eval("$.net.prediction().acknowledge({ x: 10 }, 3)")
        st3 = a.eval("$.net.prediction().state().x")
        print(f"  acknowledge до seq 3 (все подтверждены): {st3}")
        check(abs(st3 - 10) < 1e-9, f"правда серверная, вводов нет ({st3})")

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
