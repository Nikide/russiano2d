#!/usr/bin/env python3
# ===========================================================================
# Интеграционный тест якорей и тем UI (widgets.js).
#
# Гоняет фикстуру tests/fixtures/widgets_anchor: узлы с якорями, процентными
# размерами, .rect() от родителя, тема-зонд с наследованием и заблокированный
# контрол. Проверяет размеры/позиции при 800×600 и после resize до 1024×768.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_widgets_anchor_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "widgets_anchor")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5) as a:
        # --- Состав -----------------------------------------------------------
        check(a.eval("$.world.count()") == 0, "UI-узлы не входят в $.world.count()")
        check(a.eval("$('#topbar').length") == 1, "узел с якорями-атрибутами создан")
        check("full-rect" in a.eval("$.ui.anchorPresets()"), "$.ui.anchorPresets() отдаёт пресеты")

        # --- Якоря при 800×600 ------------------------------------------------
        check(a.eval("$('#topbar').size()") == {"w": 800, "h": 40},
              "полоса во всю ширину окна")
        check(a.eval("$('#topbar').pos()") == {"x": 400, "y": 20},
              "полоса прижата к верху окна")
        check(a.eval("$('#br').pos()") == {"x": 740, "y": 580},
              "пресет bottom-right держит угол")
        check(a.eval("$('#br').size()") == {"w": 120, "h": 40},
              "пресет сохраняет размер узла")
        check(a.eval("$('#half').size()") == {"w": 400, "h": 150},
              "sizePercent считает доли окна")
        check(a.eval("$('#tl').pos()") == {"x": 50, "y": 15},
              "пресет top-left ставит узел в угол")
        check(a.eval("$('#tl').anchors()") == {"left": 0, "top": 0, "right": 0, "bottom": 0},
              "anchors() отдаёт спецификацию якоря")

        # --- .rect() относительно родителя -----------------------------------
        check(a.eval("$('#box').pos()") == {"x": 200, "y": 300}, "родитель стоит в своих координатах")
        check(a.eval("$('#inner').pos()") == {"x": 80, "y": 235},
              ".rect() отсчитывается от левого верхнего угла родителя")

        # --- Темы -------------------------------------------------------------
        check(a.eval("$.ui.themeOf('#kid')") == "probe", "ребёнок наследует тему родителя")
        check(a.eval("$('#kid').theme()") == "probe", ".theme() читает унаследованную тему")
        check(a.eval("$('#kid').get(0).size") == 22, "тема задаёт размер шрифта")
        check(a.eval("$('#kid').get(0).color") == a.eval("$.color('#112233')"),
              "тема задаёт цвет normal")
        check(a.eval("$.ui.theme('probe-child').colors.hover") == "#223344",
              "extends наследует цвета родительской темы")
        check(a.eval("$.ui.theme('probe-child').colors.normal") == "#334455",
              "extends перекрывает указанный цвет")
        check(a.eval("$('#sl').get(0).color") == a.eval("$.color('#334455')"),
              "узел применяет тему-наследник")

        # --- .style() поверх темы --------------------------------------------
        a.eval("$('#kid').style({ textColor: '#ff0000' }); true")
        a.step(1)
        check(a.eval("$('#kid').get(0).text_color") == a.eval("$.color('#ff0000')"),
              ".style() перекрывает цвет текста темы")
        check(a.eval("$('#kid').get(0).color") == a.eval("$.color('#112233')"),
              ".style() не затирает остальные поля темы")

        # --- Заблокированный контрол ------------------------------------------
        check(a.eval("$('#off').disabled()") is True, ".disabled(true) отмечает контрол")
        check(a.eval("(() => { $.ui.blur(); for (let i = 0; i < 20; i++) "
                     "{ $.ui.focusNext(); if ($.ui.focusedId() === 'off') return false; } "
                     "return true; })()") is True,
              "заблокированный контрол пропущен обходом фокуса")

        # --- Resize: всё пересчитывается --------------------------------------
        a.eval("$.window.resize(1024, 768)")
        a.step(3)
        check(a.eval("$('#topbar').size()") == {"w": 1024, "h": 40},
              "resize: полоса растянулась на новую ширину")
        check(a.eval("$('#br').pos()") == {"x": 964, "y": 748},
              "resize: bottom-right уехал к новому углу")
        check(a.eval("$('#half').size()") == {"w": 512, "h": 192},
              "resize: проценты пересчитаны")
        check(a.eval("$.store.get('resized')") >= 1, "событие resize дошло до игры")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
