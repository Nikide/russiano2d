#!/usr/bin/env python3
# ===========================================================================
# Интеграционный тест UI-контролов (widgets.js).
#
# Гоняет фикстуру tests/fixtures/widgets: колонка с флажком, ползунком,
# текстовым полем и списком. Проверяет клик по флажку, ввод текста командой
# `text` агентского протокола, шаг ползунка, выбор в списке и модальный диалог.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_widgets_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "widgets")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def click(a, selector):
    """Клик мышью в центр узла: позиция берётся из игры, а не из констант."""
    p = a.eval(f"$('{selector}').pos()")
    a.mouse_move(x=p["x"], y=p["y"])
    a.mouse(button=1, action="click")
    a.step(2)


def main():
    with Agent(game=GAME, seed=3) as a:
        # --- Состав и раскладка ------------------------------------------------
        check(a.eval("$.world.count()") == 0, "UI-узлы не входят в $.world.count()")
        check(a.eval("$('#panel').length") == 1, "контейнер <ui.col> создан")

        cb_y = a.eval("$('#cb').pos().y")
        vol_y = a.eval("$('#vol').pos().y")
        name_y = a.eval("$('#name').pos().y")
        check(cb_y < vol_y < name_y, "колонка разложила детей сверху вниз")

        # --- Флажок: клик мышью → change --------------------------------------
        check(a.eval("$('#cb').checked()") is False, "флажок изначально снят")
        click(a, "#cb")
        check(a.eval("$('#cb').checked()") is True, "клик ставит флажок")
        check(a.eval("$.store.get('checked')") is True, "событие change дошло до игры")
        check(a.eval("$.ui.focusedId()") == "cb", "клик ставит фокус на флажок")
        click(a, "#cb")
        check(a.eval("$('#cb').checked()") is False, "повторный клик снимает флажок")

        # --- Ползунок: значение, шаг, клик по дорожке -------------------------
        check(a.eval("$('#vol').sliderValue()") == 50, "начальное значение ползунка")
        a.eval("$('#vol').sliderValue(37); true")
        check(a.eval("$('#vol').sliderValue()") == 35, "значение приводится к шагу 5")
        check(a.eval("$.store.get('vol')") == 35, "событие change ползунка дошло")

        p = a.eval("$('#vol').pos()")
        a.mouse_move(x=p["x"] + 70, y=p["y"])      # правее середины дорожки
        a.mouse(button=1, action="click")
        a.step(2)
        check(a.eval("$('#vol').sliderValue()") > 50, "клик по дорожке меняет значение")

        # --- Текстовое поле: фокус, ввод, maxLength, submit -------------------
        a.eval("$.ui.focus('#name'); true")
        a.step(1)
        check(a.eval("$.ui.focusedId()") == "name", "фокус ставится на поле")
        a.cmd("text", text="привет")
        a.step(1)
        check(a.eval("$('#name').text()") == "привет", "текст попал в поле через команду text")

        a.eval("$('#name').inputValue(''); true")
        a.step(1)
        a.cmd("text", text="abcdefghijklmnopqrstuvwxyz")
        a.step(1)
        check(len(a.eval("$('#name').text()")) == 16, "maxLength обрезает ввод до 16")

        a.key("Return")
        a.step(2)
        check(a.eval("$.store.get('submitted')") == a.eval("$('#name').text()"),
              "Enter шлёт submit со значением поля")

        # --- Список: навигация стрелками → select -----------------------------
        a.eval("$.ui.focus('#list'); true")
        a.step(1)
        a.key("Down")
        a.step(2)
        check(a.eval("$('#list').selectedIndex()") == 1, "стрелка вниз двигает выбор")
        check(a.eval("$.store.get('picked')") == "два", "событие select дошло до игры")

        # --- Диалог: модальность и отмена по Escape ---------------------------
        a.eval("$.store.set('cancelled', false); "
               "$.ui.dialog({ id: 'dlg', title: 'Проверка', text: 'Текст', "
               "buttons: ['Отмена', 'OK'], onCancel: () => $.store.set('cancelled', true) }); true")
        a.step(1)
        check(a.eval("$('#dlg').isVisible()") is True, "диалог показан")
        a.key("Escape")
        a.step(2)
        check(a.eval("$.store.get('cancelled')") is True, "Escape шлёт cancel")
        check(a.eval("$('#dlg').isVisible()") is False, "диалог закрылся")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
