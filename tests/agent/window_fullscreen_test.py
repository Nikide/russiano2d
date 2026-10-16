#!/usr/bin/env python3
# ===========================================================================
# Нативный фуллскрин «на лету» (task-40): режимы, desktop/exclusive, F11,
# возврат геометрии, инвариант двух полей, headless-норма.
#
# Проверяется ЧИСЛАМИ с живой машины: сколько режимов у дисплея, какое
# максимальное разрешение и герцовки, что стало с drawable (viewport/pixelSize)
# при входе в эксклюзив, вернулась ли геометрия окна, сколько стоит переключение.
#
# Инвариант (нашёл проверяющий): `state().fullscreen === (state().fullscreen_mode
# !== 'windowed')` — ВСЕГДА: окно, desktop, exclusive, после каждого шага цикла.
#
# В `finally` — гарантированный возврат в `windowed`: рабочий стол пользователя
# должен остаться как был.
#
# Запуск:
#   python3 tests/agent/window_fullscreen_test.py
# ===========================================================================

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("demos", "litsprites")
FAILURES = []
LIMITATIONS = []
NUMBERS = []
INVARIANT = ("(() => { const s = $.window.state();"
             " return s.fullscreen === (s.fullscreen_mode !== 'windowed'); })()")


def press_f11(a, limit=24):
    """Нажать F11 и дождаться результата.

    Хоткей после смены режима держит выдержку 6 кадров (см. docs/highlevel/window.md),
    поэтому «2 кадра и проверяем» — неверная проверка: она мерила не механику, а
    свою нетерпеливость. Ждём факта (toggles вырос) с пределом кадров.
    """
    before = a.eval("$.window.hotkey().toggles")
    mode_before = a.eval("$.window.state()['fullscreen_mode']")
    a.key("f11", "down")
    frames = 0
    for _ in range(limit):
        a.step(1)
        frames += 1
        if a.eval("$.window.hotkey().toggles") > before:
            break
    mode_after = a.eval("$.window.state()['fullscreen_mode']")
    poll = a.eval("$.window.hotkey()")
    held = a.eval("$.input.down('f11')")
    a.key("f11", "up")
    a.step(3)
    return {"frames": frames, "before": before, "after": poll.get("toggles"),
            "mode_before": mode_before, "mode_after": mode_after, "poll": poll, "held": held}


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0, env={"R2D_HEADLESS": "0"}) as a:
        a.step(10)
        try:
            modes = a.eval("$.window.displayModes()")
            biggest = max(modes, key=lambda m: (m["width"] * m["height"], m["refresh"])) if modes else None
            refreshes = sorted({m["refresh"] for m in modes})
            number("режимов дисплея: %d" % len(modes))
            if biggest:
                number("максимальный: %dx%d @ %g Гц" % (biggest["width"], biggest["height"], biggest["refresh"]))
                number("герцовки в списке: %s" % refreshes)
            check(isinstance(modes, list), "displayModes() возвращает список")
            check(a.eval("$.window.state()['fullscreen_mode']") == "windowed",
                  "стартуем в оконном режиме")
            check(a.eval(INVARIANT) is True, "инвариант в окне")

            # --- Неизвестные опции отклоняются (требование проверяющего) ------
            typo = a.eval("$.window.fullscreen({ mod: 'exclusive' })")
            number("опечатка {mod:'exclusive'} → %s" % typo)
            check(isinstance(typo, dict) and typo.get("option") == "mod"
                  and typo.get("error") == "неизвестная опция",
                  "неизвестная опция отклонена с именем: %s" % typo)
            check(a.eval("$.window.state()['fullscreen_mode']") == "windowed",
                  "после опечатки режим НЕ переключился")
            unknown = a.eval("$.window.fullscreen({ mode: 'nonsense' })")
            check(isinstance(unknown, dict) and unknown.get("option") == "mode",
                  "неизвестный режим отклонён: %s" % unknown)

            # --- desktop (обратная совместимость fullscreen(true)) ------------
            before_geom = (a.eval("engine.window.size()"), a.eval("engine.window.position()"))
            a.eval("$.window.fullscreen(true)")
            a.step(3)
            desktop = a.eval("$.window.state()")
            number("fullscreen(true) → режим %s, размер %s" % (desktop["fullscreen_mode"], (desktop["w"], desktop["h"])))
            check(desktop["fullscreen_mode"] == "desktop",
                  "fullscreen(true) даёт 'desktop' (прежнее поведение): %s" % desktop["fullscreen_mode"])
            check(a.eval(INVARIANT) is True, "инвариант в desktop")
            a.eval("$.window.fullscreen(false)")
            a.step(3)
            check(a.eval("$.window.state()['fullscreen_mode']") == "windowed", "возврат из desktop в окно")

            # --- exclusive: режим, размеры, drawable ---------------------------
            viewport_before = a.eval("engine.renderInfo().viewport")
            pixels_before = a.eval("engine.window.pixelSize()")
            target = None
            for m in modes:
                if m["width"] >= 1200 and m["height"] >= 700:
                    target = m
                    break
            if target is None and modes:
                target = biggest
            started = time.perf_counter()
            a.eval("$.window.fullscreen({ mode: 'exclusive', width: %d, height: %d, refresh: %g })"
                   % (target["width"], target["height"], target["refresh"]))
            cost_ms = (time.perf_counter() - started) * 1000.0
            a.step(3)
            state = a.eval("$.window.state()")
            viewport_after = a.eval("engine.renderInfo().viewport")
            pixels_after = a.eval("engine.window.pixelSize()")
            number("вход в эксклюзив %dx%d@%g: %.1f мс" % (target["width"], target["height"], target["refresh"], cost_ms))
            number("drawable: pixelSize %s → %s, viewport %sx%s → %sx%s"
                   % (pixels_before, pixels_after, viewport_before["w"], viewport_before["h"],
                      viewport_after["w"], viewport_after["h"]))
            check(state["fullscreen_mode"] == "exclusive",
                  "режим эксклюзивный: %s" % state["fullscreen_mode"])
            check(state["display_w"] == target["width"] and state["display_h"] == target["height"],
                  "размер равен выбранному режиму: %dx%d" % (state["display_w"], state["display_h"]))
            check(a.eval("engine.window.fullscreen()") is True, "флаг SDL_WINDOW_FULLSCREEN выставлен")
            check(viewport_after["w"] != viewport_before["w"] or viewport_after["h"] != viewport_before["h"]
                  or pixels_after != pixels_before,
                  "drawable реально изменился, а не только флаги: %s → %s" % (pixels_before, pixels_after))
            check(a.eval(INVARIANT) is True, "инвариант в эксклюзиве")

            # --- Переключение ВО ВРЕМЯ игры: мир и время не трогаются ---------
            ticks_before = a.eval("engine.frame")
            nodes_before = a.eval("$.world.length")
            hero_before = a.eval("$('#crate').length ? $('#crate').x : null")
            a.eval("$.window.fullscreen({ mode: 'desktop' })")
            a.step(5)
            check(a.eval("engine.frame") > ticks_before,
                  "кадры идут после переключения: %s → %s" % (ticks_before, a.eval("engine.frame")))
            check(a.eval("$.world.length") == nodes_before,
                  "число узлов не изменилось: %s" % nodes_before)
            if hero_before is not None:
                check(abs(a.eval("$('#crate').x") - hero_before) < 0.001,
                      "позиция узла та же: %s" % hero_before)

            # --- Возврат геометрии --------------------------------------------
            a.eval("$.window.fullscreen(false)")
            a.step(3)
            after_geom = (a.eval("engine.window.size()"), a.eval("engine.window.position()"))
            number("геометрия: до %s → после %s" % (before_geom, after_geom))
            check(after_geom[0] == before_geom[0],
                  "размер окна восстановлен: %s против %s" % (after_geom[0], before_geom[0]))
            check(a.eval(INVARIANT) is True, "инвариант после возврата")

            # --- Цикл окно → desktop → эксклюзив → окно, пять раз --------------
            info_before = a.eval("engine.renderInfo()")
            for i in range(5):
                a.eval("$.window.fullscreen({ mode: 'desktop' })")
                a.step(2)
                check(a.eval(INVARIANT) is True, "цикл %d: инвариант в desktop" % (i + 1)) if i == 0 else None
                a.eval("$.window.fullscreen({ mode: 'exclusive', width: %d, height: %d })"
                       % (target["width"], target["height"]))
                a.step(2)
                a.eval("$.window.fullscreen(false)")
                a.step(2)
                if a.eval(INVARIANT) is not True:
                    check(False, "цикл %d: инвариант сломан после возврата" % (i + 1))
            check(a.eval(INVARIANT) is True, "инвариант после 5 циклов")
            info_after = a.eval("engine.renderInfo()")
            number("renderInfo до/после 5 циклов: textur… %s / %s"
                   % ({k: v for k, v in info_before.items() if k != "viewport"},
                      {k: v for k, v in info_after.items() if k != "viewport"}))
            check(after_geom[0] == a.eval("engine.window.size()"),
                  "после 5 циклов окно того же размера: %s" % (a.eval("engine.window.size()"),))
            check(a.eval("engine.frame") > 0, "движок продолжает рисовать кадры")

            # --- F11: переключает и НЕ съедает нажатие -------------------------
            # Держим клавишу, а не тапаем: фронт нажатия живёт один кадр, и
            # «tap» успевает отпуститься до проверки — тогда «съедено/не съедено»
            # не отличить от «уже отпущено».
            a.eval("$.window.fullscreen(false); $.window.hotkey('f11')")
            a.step(2)
            first = press_f11(a)
            number("F11: режим %s → %s, toggles %s → %s, сработал за %s кадров, опрос %s"
                   % (first["mode_before"], first["mode_after"], first["before"], first["after"],
                      first["frames"], first["poll"]))
            check(first["held"] is True, "нажатие НЕ съедено: игра видит его в $.input (%s)" % first["held"])
            check(first["poll"].get("frames", 0) > 0,
                  "опрос хоткея исполняется каждый кадр (%s кадров)" % first["poll"].get("frames"))
            check(first["poll"].get("last_down") is True,
                  "опрос ВИДИТ клавишу в кадре (last_down=%s) — раньше здесь было "
                  "«ограничение доставки виртуального ввода», а на деле опрос выключался "
                  "гейтом по снимку окна" % first["poll"].get("last_down"))
            check(first["after"] == first["before"] + 1,
                  "одно нажатие = одно переключение: toggles %s → %s" % (first["before"], first["after"]))
            check(first["mode_after"] != first["mode_before"],
                  "F11 переключает режим: %s → %s" % (first["mode_before"], first["mode_after"]))
            back = a.eval("$.window.state()['fullscreen_mode']")
            check(back == first["mode_after"],
                  "после отпускания режим не откатился: %s (нажатие дало %s)"
                  % (back, first["mode_after"]))

            # --- F11 СРАЗУ ПОСЛЕ СМЕНЫ РЕЖИМА (транзиент) ----------------------
            # Проверяющий 1.2.0 видел здесь «то посчитано, но не применено, то
            # нажатия не видно». Причина оказалась не в среде: tickWindow()
            # выходил по гейту `if (!last)`, а `last` обнуляется при смене
            # режима — опрос хоткея выключался НАВСЕГДА после первого перехода.
            # Держим окно в циклах и жмём сразу: нажатие обязано сработать.
            for _cycle in range(5):
                a.eval("$.window.fullscreen({ mode: 'desktop' })")
                a.eval("$.window.fullscreen({ mode: 'exclusive' })")
                a.eval("$.window.fullscreen(false)")
            a.step(1)
            cycled = press_f11(a, limit=30)
            number("F11 после 5 циклов: режим %s → %s, toggles %s → %s, сработал за %s кадров"
                   % (cycled["mode_before"], cycled["mode_after"], cycled["before"],
                      cycled["after"], cycled["frames"]))
            check(cycled["after"] == cycled["before"] + 1,
                  "после 5 циклов F11 посчитан ровно один раз: %s → %s"
                  % (cycled["before"], cycled["after"]))
            check(cycled["mode_after"] != cycled["mode_before"],
                  "и режим реально сменился: %s → %s" % (cycled["mode_before"], cycled["mode_after"]))
            a.eval("$.window.hotkey(false)")
            mode_off_before = a.eval("$.window.state()['fullscreen_mode']")
            off_toggles = a.eval("$.window.hotkey().toggles")
            a.key("f11", "down")
            a.step(20)
            after_off = a.eval("$.window.state()['fullscreen_mode']")
            a.key("f11", "up")
            a.step(2)
            check(after_off == mode_off_before and a.eval("$.window.hotkey().toggles") == off_toggles,
                  "после hotkey(false) F11 больше не переключает: %s → %s, toggles %s"
                  % (mode_off_before, after_off, off_toggles))
            a.eval("$.window.hotkey('f11')")

            # --- Инвариант на всех четырёх состояниях --------------------------
            for mode, opts in (("windowed", None), ("desktop", "{ mode: 'desktop' }"),
                               ("exclusive", "{ mode: 'exclusive', width: %d, height: %d }" % (target["width"], target["height"])),
                               ("windowed-again", "false")):
                if opts is None:
                    a.eval("$.window.fullscreen(false)")
                elif opts == "false":
                    a.eval("$.window.fullscreen(false)")
                else:
                    a.eval("$.window.fullscreen(%s)" % opts)
                a.step(2)
                s = a.eval("$.window.state()")
                check(s["fullscreen"] == (s["fullscreen_mode"] != "windowed"),
                      "инвариант (%s): fullscreen=%s, mode=%s" % (mode, s["fullscreen"], s["fullscreen_mode"]))

            check(a.ping().get("pong") is True, "движок отвечает")
        finally:
            # Рабочий стол пользователя должен остаться как был.
            try:
                a.eval("$.window.fullscreen(false)")
                a.step(2)
                number("finally: режим %s" % a.eval("$.window.state()['fullscreen_mode']"))
            except Exception as error:      # noqa: BLE001
                print("  --   finally: не удалось вернуть окно: %s" % error)

    print()
    for line in NUMBERS:
        print("  --   " + line)
    # --- Headless: «эксклюзив» не рапортует успех, которого нет -------------
    # Правило: state().fullscreen_mode не говорит 'exclusive', если drawable не
    # менялся. На машине с дисплеем скрытое окно может применить режим по-настоящему
    # (тогда drawable меняется и успех честный); на X11-поде CI SDL принимает
    # вызовы и НЕ меняет drawable — там обязателен отказ. Инвариант проверяем в
    # обеих средах: либо отказ с причиной, либо смена drawable.
    with Agent(game=GAME, seed=5) as a:
        a.step(3)
        pixels_before = a.eval("engine.window.pixelSize()")
        result = a.eval("$.window.fullscreen({ mode: 'exclusive' })")
        a.step(3)
        state = a.eval("$.window.state()")
        pixels_after = a.eval("engine.window.pixelSize()")
        changed = list(pixels_before) != list(pixels_after)
        number("headless exclusive: результат %s, drawable %s → %s, drawable_changed=%s"
               % (result, pixels_before, pixels_after, state.get("drawable_changed")))
        if isinstance(result, dict) and result.get("error"):
            check(state["fullscreen_mode"] != "exclusive",
                  "отказ честный: режим остался %s (в state не 'exclusive')" % state["fullscreen_mode"])
            check(changed is False,
                  "и drawable действительно не менялся: %s → %s" % (pixels_before, pixels_after))
        else:
            check(state["fullscreen_mode"] == "exclusive" and changed,
                  "успех подтверждён сменой drawable: %s → %s" % (pixels_before, pixels_after))
            check(state.get("drawable_changed") is True,
                  "state().drawable_changed говорит правду (%s)" % state.get("drawable_changed"))
        check("drawable_changed" in state,
              "в state() есть поле drawable_changed — по нему CI отличает успех от тишины")

    if LIMITATIONS:
        print("\nОграничения среды (не провалы, с причиной):")
        for item in LIMITATIONS:
            print("  ! " + item)
    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
