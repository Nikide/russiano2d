#!/usr/bin/env python3
# ===========================================================================
# Тест сценок: DSL сценариев, реплики, выборы, флаги и катсцена.
#
# Проверяется путь целиком: разбор текста, показ реплики, ожидание выбора,
# применение флагов, отбор управления у катсцены (@free этого не делает) и
# завершение по end с возвратом управления.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_story_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

# Разбор PNG и яркость не дублируем: они уже есть в соседнем тесте света
# (так же делают light_area_layer_test.py и debug_draw_coords_test.py).
sys.path.insert(0, os.path.dirname(__file__))
from light_receiver_mask_test import read_png, luma   # noqa: E402

SHOTS = os.path.join(os.path.dirname(__file__), "..", "..", "build")
FRAME_PNG = os.path.join(SHOTS, "story_f2_frame.png")


def make_frame_png(path, rgb=(240, 240, 240), size=64):
    """Белый кадр для команды image: по нему видно, нарисован ли оверлей."""
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n"
                     + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw))
                     + chunk(b"IEND", b""))

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")

PROLOGUE = """@free
:start
set seen += 1
~ Пролог начался.
Некотян: Ты очнулся?
if seen < 2 -> start
objective Найди выход
end
"""

CUTSCENE = """Некотян: Кто здесь?
- Свой -> friend
- Молчать {silent = 1} -> end
:friend
set trust += 1
end
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(message):
    """Замер без вердикта: печатается в отчёт, на итог не влияет."""
    print("  --   " + message)


def main():
    with Agent(game=GAME, seed=5) as a:
        check(a.eval("typeof $.story") == "object", "$.story доступна игре")

        # --- Флаги и условия ---------------------------------------------------
        flags = a.eval("JSON.stringify($.story.parse('set trust = 2').commands[0])")
        check("trust" in flags, "разбор set-команды")

        # --- Сценка с @free: не отбирает управление ---------------------------
        check(a.eval("$.story.play({ text: %r })" % PROLOGUE) is True, "сценка запущена")
        check(a.eval("$.story.running()") is True, "сценка идёт")
        check(a.eval("$.story.locked()") is False, "@free не отбирает управление")

        # Первый кадр без автолистания: реплика стоит и ждёт игрока.
        a.step(1)
        check(a.eval("$.story.flags.seen") == 1, "set выполнился")
        line = a.eval("JSON.stringify($.story.last_line)")
        check("Пролог" in line, f"реплика показана: {line}")

        # Включаем автолистание: цикл `if seen < 2 -> start` проходит второй
        # раз и сценка заканчивается на end.
        a.eval("$.story.auto(true)")
        a.step(6)
        seen = a.eval("$.story.flags.seen")
        check(seen >= 2, f"цикл по метке прошёл (seen = {seen})")
        check(a.eval("$.story.running()") is False, "сценка дошла до end")
        a.eval("$.story.auto(false)")
        a.eval("$.story.stop()")

        # --- Катсцена: управление отобрано, выбор работает ---------------------
        a.eval("$.story.resetFlags()")
        a.eval("globalThis.__picked = 0")
        check(a.eval("$.story.play({ text: %r })" % CUTSCENE) is True, "катсцена запущена")
        a.eval("$.story.auto(true)")
        check(a.eval("$.story.locked()") is True, "катсцена отбирает управление")

        a.step(3)
        check(a.eval("$.story.flags.silent === undefined"), "до выбора флага нет")

        # Отвечаем за игрока: первый вариант — «Свой» (метка friend, trust += 1).
        a.eval("$.story.choose(0)")
        a.step(4)
        check(a.eval("$.story.flags.trust") == 1, "выбор применил флаг trust")
        check(a.eval("$.story.flags._last_choice") == 0, "запомнен номер выбора")
        check(a.eval("$.story.running()") is False, "после end сценка закончилась")
        check(a.eval("$.story.locked()") is False, "после конца управление вернулось")

        # --- Второй вариант ведёт в end и ставит свой флаг --------------------
        a.eval("$.story.resetFlags()")
        a.eval("$.story.play({ text: %r })" % CUTSCENE)
        a.step(3)
        a.eval("$.story.choose(1)")
        a.step(4)
        check(a.eval("$.story.flags.silent") == 1, "флаг варианта применён")
        check(a.eval("$.story.flags.trust === undefined"), "ветка friend не выполнялась")
        check(a.eval("$.story.running()") is False, "goto end завершил сценку")

        # --- Ошибки разбора уходят в журнал, но не роняют игру -----------------
        a.eval("$.story.play({ text: 'ерунда без двоеточия' })")
        a.step(1)
        check(a.eval("$.story.running()") in (True, False), "сценка с ошибкой не роняет движок")
        a.eval("$.story.stop()")

    # --- F2: кадр сценки — экранный оверлей, а не мир-узел ------------------
    #
    # BASHNYA (PHASE 2, пункт F2): в enter() сцены сценка с командой `image`
    # узел кадра создаёт, но кадр не рисуется; любой мир-узел с большей
    # глубиной рисует поверх кадра. Проверяем ФАКТ по кадру: команда image
    # ставит белый PNG во весь экран, яркость центра читается со скриншота.
    make_frame_png(FRAME_PNG)
    with Agent(game=GAME, seed=5) as a:
        a.step(3)

        def shot(name):
            path = os.path.join(SHOTS, name)
            a.screenshot(path)
            return read_png(path)

        def settle(limit=24):
            """Дождаться конца перехода сцены (у него своё затемнение ~300 мс).

            Без этого замер ловит ПЕРЕХОД, а не оверлей: у `$.scene.load` есть
            собственный fade, и на 30-м кадре он ещё держит экран (замер:
            transitionAlpha 0.11 при яркости 227 вместо 240). Предел с
            диагностикой — как требует правило «у ожиданий должен быть предел».
            """
            for _ in range(limit):
                if a.eval("$.scene.busy()") is False:
                    return True
                a.step(5)
            check(False, "F2: переход сцены не завершился за %d шагов" % limit)
            return False

        # Мир-узел с большой глубиной — как фон меню (#menu_bg, depth 10) у них.
        a.eval("$('<rect>', { id: 'menu_bg' }).at(400, 300).size(800, 600)"
               ".color('#000000').depth(10).appendTo($.world); 'ok'")
        check(a.eval("$.story.parse('fade out 0.2').commands[0].out") is True,
              "F2: команда fade out разбирается (нужна для проверки инварианта)")
        a.eval("$.camera.at(400, 300); $.scene.add('f2_enter', { enter() {"
               " $.story.play({ text: ':start\\nimage %s 30.0\\nwait 30.0\\nend' }); } });"
               " $.scene.load('f2_enter'); 'ok'" % FRAME_PNG)
        settle()
        a.step(2)
        check(a.eval("$.story.running()") is True,
              "F2: сценка ещё идёт на момент замера (иначе мерили бы погашенный оверлей)")
        check(a.eval("$('#__story_image').length") == 1, "F2: узел кадра создан")
        enter_luma = luma(shot("story_f2_enter.png"), 400, 300)
        number("F2: яркость центра при запуске сценки из enter() = %.1f "
               "(белый кадр даёт ~240, перекрытый — 0)" % enter_luma)
        check(enter_luma > 200,
              "F2: кадр нарисован при запуске сценки из enter() (%.1f)" % enter_luma)

        # Камера уезжает: экранный оверлей остаётся на месте, мир-узел — нет.
        a.eval("$.camera.at(5000, 5000); 'ok'")
        a.step(3)
        away_luma = luma(shot("story_f2_camera.png"), 400, 300)
        number("F2: камера уехала в (5000, 5000) — яркость центра %.1f" % away_luma)
        check(away_luma > 200,
              "F2: кадр не зависит от камеры (%.1f)" % away_luma)

        # Мир-узел с ещё большей глубиной не должен перекрывать кадр.
        a.eval("$('#menu_bg').depth(100); 'ok'")
        a.step(3)
        deep_luma = luma(shot("story_f2_depth.png"), 400, 300)
        number("F2: мир-узел depth 100 — яркость центра %.1f" % deep_luma)
        check(deep_luma > 200,
              "F2: мир-узел с большей глубиной не перекрывает кадр (%.1f)" % deep_luma)

        # Инвариант: затемнение сценки по-прежнему закрывает экран, когда его
        # просят (fade out), и открывает обратно (fade in).
        a.eval("$.story.stop(); $.camera.at(400, 300); 'ok'")
        a.eval("$.story.play({ text: ':start\\nimage %s 0.05\\nfade out 0.2\\n"
               "wait 2.0\\nfade in 0.2\\nwait 2.0\\nend' }); 'ok'" % FRAME_PNG)
        a.step(30)
        faded = luma(shot("story_f2_fadeout.png"), 400, 300)
        number("F2: после fade out яркость центра %.1f" % faded)
        check(faded < 40, "F2: fade out закрывает экран (%.1f)" % faded)
        a.step(150)
        back = luma(shot("story_f2_fadein.png"), 400, 300)
        number("F2: после fade in яркость центра %.1f" % back)
        check(back > 200, "F2: fade in открывает кадр обратно (%.1f)" % back)

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
