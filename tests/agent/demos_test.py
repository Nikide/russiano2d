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
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

# Сцена → (минимум узлов мира, минимум узлов интерфейса).
# Ноль там, где сцена обходится без соответствующего слоя: меню целиком
# собрано из узлов <ui.*> и в счёт мира не попадает.
SCENES = {
    "platformer": (2, 0),
    "shooter25d": (2, 0),
    "gallery": (2, 0),
    "arena": (3, 0),
    "physics": (3, 0),
    "bsp": (2, 0),
    "light": (2, 0),
    "launcher": (0, 5),
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
    try:
        with Agent(game="demos", scene=name, seed=11) as a:
            a.step(20)

            current = a.eval("$.scene.current()")
            check(current == name, f"{name}: сцена открылась ({current})")

            min_world, min_ui = minimum
            count = a.eval("$.world.count()")
            check(count >= min_world,
                  f"{name}: мир построен ({count} узлов, ждали ≥ {min_world})")

            ui = a.eval("$.ctx.nodes.filter(n => n.attrs.ui).length")
            check(ui >= min_ui, f"{name}: интерфейс собран ({ui} узлов ui, ждали ≥ {min_ui})")

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
