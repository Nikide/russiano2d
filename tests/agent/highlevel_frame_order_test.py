#!/usr/bin/env python3
# ===========================================================================
# §8 (порядок фаз кадра) через агентский интерфейс.
#
# Проверяется ФАКТИЧЕСКИЙ порядок фаз, а не «какая-то фаза вызвалась»:
#   * фикстура tests/fixtures/frame_order пишет метку из каждой фазы своим
#     штатным путём (обработчик 'stay' → контакты; update сцены; $.update;
#     fn-дорожка $.anim → подсистема анимации; scope.onClosed → безопасная фаза
#     tickLifecycle; render сцены и $.render → отрисовка);
#   * трасса одного кадра сравнивается с полным ожидаемым списком;
#   * отдельно сверяется порядок подсистем по собственному профайлеру движка
#     ($.debug.profiler.report(), метки prof() в api.js:2081-2164) — это тот же
#     порядок, что и в docs/FRAME_PHASES.md (шаги 1-11).
#
# ВАЖНО (замечание к формулировке ТЗ §8): «cleanup/safe phase last of all» —
# неверно для реального рантайма. Безопасная фаза (tickLifecycle, зона
# «области», api.js:2142) идёт ВНУТРИ скриптового кадра после логики игры, а
# ПОСЛЕДНЯЯ фаза кадра — отрисовка (setRender: scene.render → $.render →
# gfx._render → debug._render, api.js:2167-2182). С docs/FRAME_PHASES.md код
# согласован (там отрисовка — шаг 11, подсистемы — шаг 10), поэтому тест
# утверждает реальный порядок: cleanup < presentation.
#
# Запуск:
#   python3 tests/agent/highlevel_frame_order_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "frame_order")

# Полный порядок меток одного кадра: каждая — из своей фазы.
EXPECTED = ["contact", "scene_update", "game_update", "anim", "cleanup",
            "scene_render", "render"]

# Порядок подсистем из prof() в installFrameHooks (api.js:2081-2164).
ZONES = ["синк физики", "сеть", "контакты", "сцена", "время", "логика игры", "катсцена",
         "анимация+ввод", "анимация", "плеер анимации", "состояния",
         "последовательности", "задачи", "области", "экраны", "диалоги",
         "таймлайн", "tilemap", "vfx", "частицы", "навигация", "префабы",
         "слои", "виджеты", "триггеры", "наблюдения", "devtools", "i18n",
         "пулы", "вьюпорты", "http", "sdk", "шины звука", "акустика",
         "интерфейс"]
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def index_of(trace, name):
    return trace.index(name) if name in trace else -1


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(40)          # тело садится на пол: 'stay' идёт каждый кадр

        # --- трасса одного кадра ---------------------------------------------
        a.eval("$.fixture.reset()")
        check(a.eval("$.fixture.armCleanup()") is True,
              "§8 область владения закрыта перед кадром (onClosed — в безопасной фазе)")
        a.step(1)
        trace = a.eval("$.fixture.order()")
        print(f"       трасса кадра: {trace}")

        check(trace == EXPECTED,
              f"§8 полный порядок фаз кадра: {trace} (ожидалось {EXPECTED})")
        for name in EXPECTED:
            check(trace.count(name) == 1,
                  f"§8 фаза {name} сработала ровно один раз за кадр: {trace.count(name)}")

        # --- обязательства порядка по отдельности (читаемые сообщения) --------
        i_contact = index_of(trace, "contact")
        i_scene = index_of(trace, "scene_update")
        i_game = index_of(trace, "game_update")
        i_anim = index_of(trace, "anim")
        i_clean = index_of(trace, "cleanup")
        i_srender = index_of(trace, "scene_render")
        i_render = index_of(trace, "render")

        check(0 <= i_contact < i_scene,
              f"§8 контакты (фаза 2) до обновления сцены (фаза 6): {i_contact} < {i_scene}")
        check(0 <= i_scene < i_game,
              f"§8 update сцены раньше хуков $.update: {i_scene} < {i_game}")
        check(i_game < i_anim,
              f"§8 анимация (tickAnim) после логики игры: {i_game} < {i_anim}")
        check(i_anim < i_clean,
              f"§8 безопасная фаза (области) после анимации: {i_anim} < {i_clean}")
        check(i_clean < i_srender,
              f"§8 уборка/безопасная фаза ДО отрисовки: {i_clean} < {i_srender}")
        check(0 <= i_srender < i_render,
              f"§8 render сцены раньше хуков $.render: {i_srender} < {i_render}")
        check(i_render == len(trace) - 1,
              f"§8 презентация — последняя фаза кадра (индекс {i_render} из {len(trace) - 1})")

        # --- без закрытия области метки cleanup в кадре нет -------------------
        a.eval("$.fixture.reset()")
        a.step(1)
        plain = a.eval("$.fixture.order()")
        check("cleanup" not in plain and plain == [m for m in EXPECTED if m != "cleanup"],
              f"§8 метка cleanup приходит именно из безопасной фазы: {plain}")

        # --- порядок подсистем по профайлеру самого движка --------------------
        a.eval("$.debug.profiler.reset(); $.debug.profiler.on(true)")
        a.step(1)
        zones = a.eval("Object.keys($.debug.profiler.report())")
        expected_zones = list(ZONES)
        if a.eval("$.re2dEnabled") is True:
            expected_zones.insert(expected_zones.index("плеер анимации"), "real2d")
        print(f"       зоны кадра: {zones}")
        check(zones == expected_zones,
              f"§8 порядок подсистем кадра (prof-зоны) совпадает с кодом: {zones}")
        check(index_of(zones, "синк физики") == 0 and index_of(zones, "интерфейс") == len(zones) - 1,
              "§8 кадр начинается с синка физики и заканчивается интерфейсом (до отрисовки)")
        check(0 <= index_of(zones, "контакты") < index_of(zones, "сцена") < index_of(zones, "логика игры"),
              "§8 контакты → сцена → логика игры: "
              f"{index_of(zones, 'контакты')} < {index_of(zones, 'сцена')} < {index_of(zones, 'логика игры')}")
        check(index_of(zones, "логика игры") < index_of(zones, "области") < index_of(zones, "интерфейс"),
              "§8 логика игры → области (безопасная фаза) → интерфейс: "
              f"{index_of(zones, 'логика игры')} < {index_of(zones, 'области')} < {index_of(zones, 'интерфейс')}")
        a.eval("$.debug.profiler.on(false)")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, f"§8 в кадре нет ошибок игрового кода: {errors[:2]}")

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
