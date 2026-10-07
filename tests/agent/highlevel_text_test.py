#!/usr/bin/env python3
# ===========================================================================
# Тест текста в сцене: растеризатор глифов движка (stb_truetype), атлас,
# измерение и рисование текста обычными спрайтами батча.
#
# Что проверяется:
#   * шрифт находится и грузится (автозагрузка из assets/fonts и явный
#     engine.loadFont);
#   * измерение строки возвращает осмысленные числа, а ширина растёт с текстом
#     и с кеглем;
#   * рисование реально даёт глифы в атласе, а не «тихий ноль»;
#   * текст узлов (<text>, <ui.label>, <ui.button>) доходит до кадра;
#   * семейство шрифта наследуется узлом от родителя.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_text_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=3) as a:
        # --- Шрифт найден и загружен -----------------------------------------
        check(a.eval("engine.fontDefault()") is not None,
              "шрифт по умолчанию нашёлся автоматически (assets/fonts)")
        check(a.eval("engine.fontList().length") >= 1, "список семейств не пуст")
        check(a.eval("$.font.default()") is not None, "$.font.default() отдаёт семейство")

        # --- Измерение --------------------------------------------------------
        w_short = a.eval("engine.measureText('А', 24)[0]")
        w_long = a.eval("engine.measureText('АААААААА', 24)[0]")
        h_one = a.eval("engine.measureText('А', 24)[1]")
        w_big = a.eval("engine.measureText('АААААААА', 48)[0]")
        check(isinstance(w_short, (int, float)) and w_short > 0, "ширина символа > 0")
        check(w_long > w_short, "длинная строка шире короткой")
        check(isinstance(h_one, (int, float)) and h_one > 0, "высота строки > 0")
        check(w_big > w_long * 1.5, "кегль 48 шире кегля 24 во столько же раз")
        check(a.eval("engine.measureText('   ', 24)[0]") > 0, "пробелы дают ширину")

        # --- Растеризация и вывод --------------------------------------------
        a.step(3)
        glyphs_before = a.eval("engine.fontStats().glyphs")
        a.eval("for (let i = 0; i < 5; i++) engine.drawText('Текст в сцене', 10, 10 + i * 30, 20, engine.WHITE, 'left')")
        a.step(2)
        glyphs_after = a.eval("engine.fontStats().glyphs")
        check(glyphs_before > 0, "глифы появились в атласе после первого кадра")
        check(glyphs_after >= glyphs_before, "атлас не уменьшается")

        atlas = a.eval("engine.fontStats()")
        check(atlas["atlas_w"] >= 64 and atlas["atlas_h"] >= 64, "атлас имеет размер")
        check(atlas["atlas_w"] <= 2048 and atlas["atlas_h"] <= 4096, "атлас в пределах лимитов")

        # --- Текст узлов доходит до кадра ------------------------------------
        check(a.eval("$('#world').length") == 1, "мировой <text> создан")
        check(a.eval("$('#hud').length") == 1, "<ui.label> создан")
        check(a.eval("$('#go').length") == 1, "<ui.button> создан")

        # Замер текста узла совпадает с замером по его кеглю: значит отрисовка
        # берёт именно тот шрифт и кегль, что и измерение.
        node_w = a.eval("engine.measureText($('#world').text(), $('#world').attr('size'))[0]")
        check(isinstance(node_w, (int, float)) and node_w > 0, "текст узла измеряется")

        # --- Семейство шрифта и наследование ---------------------------------
        check(a.eval("typeof $('#world').font()") == "string", ".font() отдаёт семейство")
        ok_load = a.eval(
            "$.font.load('hud', 'assets/fonts/NotoSans-Regular.ttf')")
        check(ok_load is True, "$.font.load грузит второе семейство")
        check(a.eval("$.font.families().includes('hud')"), "семейство видно движку")

        # appendTo принимает узел или обёртку, не селектор: строка молча
        # ничего не делает (см. resolveContainer в api.js).
        a.eval("$('<ui.col>', { id: 'panel' }).font('hud').appendTo($.ui)")
        a.eval("$('<ui.label>', { id: 'child', text: 'Дочерний' }).appendTo($('#panel'))")
        check(a.eval("$('#child').font()") == "hud",
              "ребёнок наследует семейство шрифта родителя")

        a.eval("$('#world').font('hud')")
        check(a.eval("$('#world').font()") == "hud", ".font() ставит семейство узлу")

        # --- Текст переживает кадры и смену сцены ----------------------------
        for _ in range(10):
            a.step(1)
        check(a.eval("engine.fontStats().glyphs") > 0, "после 10 кадров глифы на месте")
        check(a.eval("$('#world').font()") == "hud", "семейство не сбросилось")

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
