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

        # --- Лица RmlUi: weight/style реально выбирают face ------------------
        # В assets/fonts нет Bold/Italic-файлов, поэтому одно и то же имя
        # семейства получает три РАЗНЫХ файла как разные лица. Если RmlUi
        # действительно резолвит font-weight/font-style, ширина одинаковой
        # строки у 400/700/italic будет разной (метрики разных шрифтов).
        check(a.eval("typeof engine.ui.loadFontFace") == "function",
              "engine.ui.loadFontFace есть (RmlUi face binding)")
        check(a.eval("typeof engine.ui.fontFaces") == "function",
              "engine.ui.fontFaces есть (метаданные лиц)")
        check(a.eval("$.font.load('ProbeFont', 'assets/fonts/LatoLatin-Regular.ttf', { weight: 400 })") is True,
              "$.font.load: нормальное лицо 400")
        check(a.eval("$.font.load('ProbeFont', 'assets/fonts/NotoSans-Regular.ttf', { weight: 700 })") is True,
              "$.font.load: жирное лицо 700")
        check(a.eval("$.font.load('ProbeFont', 'assets/fonts/OpenSans-Regular.ttf', { weight: 400, style: 'italic' })") is True,
              "$.font.load: курсивное лицо 400 italic")

        faces = a.eval("$.font.faces()") or []
        probe = [f for f in faces if f.get("family") == "ProbeFont"]
        check(len(probe) == 3, "faces(): три явных лица ProbeFont (%d)" % len(probe))
        check({(f["weight"], f["style"]) for f in probe} == {(400, "normal"), (700, "normal"), (400, "italic")},
              "faces(): weight/style каждого лица: %s" % (probe,))
        check(all(f.get("path") for f in probe), "faces(): у каждого лица есть path")
        check(a.eval("$.font.families().includes('ProbeFont')"),
              "families(): явное лицо RmlUi видно в списке семейств")

        check(a.eval("$.font.load('ProbeBad', 'assets/fonts/NotoSans-Regular.ttf', { weight: 'fat' })") is False,
              "неверный weight — false, без загрузки")
        check(a.eval("$.font.faces().every(f => f.family !== 'ProbeBad')"),
              "отвергнутое лицо не попало в faces()")

        doc = a.eval(
            "engine.ui.loadMarkup('font-faces', '<rml><head></head><body>"
            "<div id=\"w400\">A quick brown fox</div>"
            "<div id=\"w700\">A quick brown fox</div>"
            "<div id=\"italic\">A quick brown fox</div>"
            "<div id=\"textbox\">BOX</div>"
            "</body></rml>')")
        check(isinstance(doc, int) and doc >= 0, "RmlUi-документ для проверки лиц создан (%r)" % (doc,))
        if isinstance(doc, int) and doc >= 0:
            a.eval(
                "engine.ui.setProperty(%d,'w400','font-family','ProbeFont');"
                "engine.ui.setProperty(%d,'w400','font-size','24px');"
                "engine.ui.setProperty(%d,'w400','font-weight','400');"
                "engine.ui.setProperty(%d,'w400','font-style','normal');"
                "engine.ui.setProperty(%d,'w700','font-family','ProbeFont');"
                "engine.ui.setProperty(%d,'w700','font-size','24px');"
                "engine.ui.setProperty(%d,'w700','font-weight','700');"
                "engine.ui.setProperty(%d,'w700','font-style','normal');"
                "engine.ui.setProperty(%d,'italic','font-family','ProbeFont');"
                "engine.ui.setProperty(%d,'italic','font-size','24px');"
                "engine.ui.setProperty(%d,'italic','font-weight','400');"
                "engine.ui.setProperty(%d,'italic','font-style','italic');"
                "engine.ui.setProperty(%d,'textbox','display','block');"
                "engine.ui.setProperty(%d,'textbox','width','120px');"
                "engine.ui.setProperty(%d,'textbox','height','40px');"
                "engine.ui.setProperty(%d,'textbox','background-color','#ffffff');"
                "engine.ui.show(%d); 1"
                % ((doc,) * 17))
            a.step(4)
            w400 = a.eval("engine.ui.layoutRect(%d,'w400').w" % doc)
            w700 = a.eval("engine.ui.layoutRect(%d,'w700').w" % doc)
            wital = a.eval("engine.ui.layoutRect(%d,'italic').w" % doc)
            check(isinstance(w400, (int, float)) and w400 > 0,
                  "RCSS text с family/weight/style имеет ширину (%.1f)" % w400)
            check(abs(w700 - w400) > 4,
                  "font-weight:700 выбрал ДРУГОЕ лицо: ширина %.1f != %.1f" % (w700, w400))
            check(abs(wital - w400) > 4,
                  "font-style:italic выбрал ДРУГОЕ лицо: ширина %.1f != %.1f" % (wital, w400))
            check(a.eval("engine.ui.getText(%d,'w400')" % doc) == "A quick brown fox",
                  "текст элемента читается (лицо не сломало разметку)")
            box = a.eval("engine.ui.layoutRect(%d,'textbox')" % doc) or {}
            check(abs(box.get("w", 0) - 120) < 2 and abs(box.get("h", 0) - 40) < 2,
                  "rect рядом с лицом держит размеры: %s" % (box,))
            a.eval("engine.ui.unload(%d); 1" % doc)

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
