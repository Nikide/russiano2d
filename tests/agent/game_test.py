#!/usr/bin/env python3
# ===========================================================================
# Тест игры по умолчанию (каталог game/): меню, уровень, управление, монеты.
#
# Это проверка того, что «игра из коробки» действительно играется: движок
# запускает меню, из меню открывается уровень, игрок ходит и собирает монеты.
#
# Запуск:
#   python3 tests/agent/game_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    shot = os.path.join(ROOT, "build", "test_game_shot.png")

    # --- Меню -----------------------------------------------------------------
    with Agent(seed=7) as a:
        a.step(5)
        check(a.eval("$.scene.current()") == "menu", "игра начинается с меню")
        check(a.eval("$.scene.names().join(',')") == "menu,platformer",
              "зарегистрированы обе сцены")

        # Enter из меню открывает уровень — как и клик по кнопке RmlUi.
        # Переход идёт через затемнение (~0.22 с), поэтому ждём его конца.
        a.key("Return", "tap")
        a.step(20)
        check(a.eval("$.scene.current()") == "platformer", "Enter из меню открывает уровень")

        a.step(30)
        check(a.eval("$('#hero').length") == 1, "на уровне есть игрок")
        check(a.eval("$('.coin').length") > 0, "на уровне есть монеты")
        check(a.eval("$('.brick').length") > 0, "на уровне есть кирпичи")
        check(a.eval("$('.walker').length") > 0, "на уровне есть враги")

        # --- Управление --------------------------------------------------------
        x0 = a.eval("$('#hero').pos().x")
        a.keys(["D"])
        a.step(45)
        a.keys([])
        x1 = a.eval("$('#hero').pos().x")
        check(x1 > x0, f"игрок идёт вправо ({x0:.0f} → {x1:.0f})")

        a.keys(["A"])
        a.step(30)
        a.keys([])
        x2 = a.eval("$('#hero').pos().x")
        check(x2 < x1, f"игрок идёт влево ({x1:.0f} → {x2:.0f})")

        # Прыжок: следим за минимальной высотой за время полёта — игрок может
        # приземлиться раньше, чем закончатся кадры.
        y_before = a.eval("$('#hero').pos().y")
        a.key("Space", "tap")
        top = y_before
        for _ in range(12):
            a.step(1)
            top = min(top, a.eval("$('#hero').pos().y"))
        check(top < y_before - 4, f"прыжок поднимает игрока ({y_before:.0f} → {top:.0f})")

        # --- Пауза -------------------------------------------------------------
        a.key("Escape", "tap")
        a.step(2)
        check(a.eval("$.time.isPaused()") is True, "Escape ставит игру на паузу")
        check(a.eval("$('#overlay').isVisible()") is True, "на паузе показан экран паузы")
        a.key("Escape", "tap")
        a.step(2)
        check(a.eval("$.time.isPaused()") is False, "повторный Escape снимает паузу")

        # --- HUD ---------------------------------------------------------------
        check(a.eval("$('#hud-hp').text().indexOf('Здоровье')") == 0, "HUD показывает здоровье")
        check(a.eval("$('#hud-coins').text().indexOf('Монет')") == 0, "HUD показывает монеты")

        # --- Монеты собираются -------------------------------------------------
        a.eval("$.store.set('coins_before', $('.coin').length)")
        a.eval("$('.coin').each((i, c) => c.at($('#hero').pos().x, $('#hero').pos().y))")
        a.step(3)
        check(a.eval("$('.coin').length") < a.eval("$.store.get('coins_before')"),
              "монеты подбираются при касании")

        # --- Кадр рисуется -----------------------------------------------------
        a.step(5)
        a.screenshot(shot)
        check(os.path.getsize(shot) > 1000, f"кадр игры сохранён ({os.path.getsize(shot)} байт)")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, f"в игре нет ошибок игрового кода ({len(errors)} шт.)")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
