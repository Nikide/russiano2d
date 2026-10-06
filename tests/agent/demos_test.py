#!/usr/bin/env python3
# ===========================================================================
# Тест демо-проекта: каждая сцена строится, рисуется и не пишет ошибок.
#
# Проверяет весь набор демо одним прогоном: агент открывает сцену, шагает
# кадры, смотрит снимок состояния и журнал. Так проверяется то, ради чего
# агентский интерфейс и делался, — игра без глаз и рук.
#
# Запуск:
#   python3 tests/agent/demos_test.py            # все демо
#   python3 tests/agent/demos_test.py light      # только выбранные
# ===========================================================================

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

# Сцена → (минимум узлов мира, минимум узлов интерфейса, сколько кадров шагать).
# Ноль там, где сцена обходится без соответствующего слоя: меню целиком
# собрано из узлов <ui.*> и в счёт мира не попадает.
#
# Кадры важны для игровых сцен: у «Ведьмы» интересные пути (смерть зомби,
# сбор опыта) включаются только через несколько секунд боя, поэтому ей даём
# длинный прогон — иначе ошибка в этих ветках не поймается.
SCENES = {
    "platformer": (2, 0, 20),
    "shooter25d": (2, 0, 20),
    "gallery": (2, 0, 20),
    "arena": (3, 0, 20),
    "physics": (3, 0, 20),
    "bsp": (2, 0, 20),
    "light": (2, 0, 20),
    "shooter_witch": (4, 6, 900),
    "launcher": (0, 5, 20),
}

FAILURES = []

# Документ RmlUi → кнопки, у каждой из которых обязан быть свой слушатель.
# $.ui.doc().on() подписывает конкретный элемент, поэтому «один обработчик на
# документ с ветвлением по id» оставлял часть кнопок мёртвыми.
DOC_BUTTONS = {
    "light": ("demos/ui/light.rml", ["light-shadows", "light-fill", "light-rays"]),
    "bsp": ("demos/ui/bsp.rml", ["bsp-splits", "bsp-order"]),
    "shooter25d": ("demos/ui/shooter-death.rml", ["death-retry", "death-menu"]),
}


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run_scene(name, minimum):
    """Открывает сцену, шагает кадры и проверяет, что она живая."""
    shot = os.path.join(ROOT, "build", f"test_demo_{name}.png")
    world_min, ui_min, steps = minimum[0], minimum[1], (minimum[2] if len(minimum) > 2 else 20)
    try:
        with Agent(game="demos", scene=name, seed=11) as a:
            # Шагаем порциями: одна большая команда не укладывается в таймаут
            # агентского клиента, и тест падал бы на «приложение остановилось».
            left = steps
            while left > 0:
                portion = min(150, left)
                a.step(portion)
                left -= portion

            current = a.eval("$.scene.current()")
            check(current == name, f"{name}: сцена открылась ({current})")

            count = a.eval("$.world.count()")
            check(count >= world_min,
                  f"{name}: мир построен ({count} узлов, ждали ≥ {world_min})")

            ui = a.eval("$.ctx.nodes.filter(n => n.attrs.ui).length")
            check(ui >= ui_min, f"{name}: интерфейс собран ({ui} узлов ui, ждали ≥ {ui_min})")

            # Ввод и кадры не должны ломать демо.
            a.keys(["D"]); a.step(20); a.keys([])
            a.mouse_move(x=640, y=360)
            a.step(10)

            a.screenshot(shot)
            check(os.path.getsize(shot) > 1000, f"{name}: кадр сохранён ({os.path.getsize(shot)} байт)")

            errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
            check(not errors, f"{name}: нет ошибок игрового кода ({len(errors)} шт.)")
            for line in errors[:3]:
                print("        " + line.strip())

            state = a.state()
            check(isinstance(state.get("entities"), list), f"{name}: снимок узлов доступен")

            # Игровой прогон: у «Ведьмы» за длинный прогон обязаны погибнуть
            # враги — так проверяются ветки смерти, добычи и крови.
            if name == "shooter_witch":
                stats = a.eval("$('#stats').text()") or ""
                match = re.search(r"[Уу]бито\D*(\d+)", stats)
                kills = int(match.group(1)) if match else -1
                check(kills > 0,
                      f"{name}: бой идёт, враги гибнут (убито {kills}, HUD: {stats.strip()})")

            buttons = DOC_BUTTONS.get(name)
            if buttons:
                path, elements = buttons
                listeners = a.eval(
                    "$.ui.doc(%r).listeners().map(s => s.split('\\u0000')[0])" % path)
                missing = [e for e in elements if e not in listeners]
                check(not missing,
                      f"{name}: кнопки документа подписаны ({', '.join(elements)})"
                      + (f"; без слушателя: {missing}" if missing else ""))
    except Exception as error:   # движок не поднялся или не ответил
        check(False, f"{name}: запуск не удался — {error}")


def main():
    wanted = sys.argv[1:]
    names = [n for n in SCENES if not wanted or n in wanted]
    if not names:
        print("нет таких демо: " + ", ".join(wanted))
        return 2

    for name in names:
        print(f"\n— {name} —")
        run_scene(name, SCENES[name])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
