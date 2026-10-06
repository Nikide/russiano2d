#!/usr/bin/env python3
# ===========================================================================
# Интеграционный тест диалогов, экранов и текстовых стилей
# (dialog.js + screen.js + font.js).
#
# Гоняет фикстуру tests/fixtures/dialog: экран паузы со строками, стражник с
# ветками и условием, ключ словаря i18n. Проверяет раскладку, фокус с
# клавиатуры и мыши, печатную машинку, выборы и события.
#
# Требует подключения в src/highlevel/api.js:
#   import { installDialog, tickDialog } from './dialog.js';   (install + кадр)
#   installFont/installScreen/tickScreen там уже есть.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_dialog_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "dialog")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def center(a, target):
    """Центр узла экрана (левый верхний угол + размеры)."""
    r = a.eval(f"$.screen.rect('{target}')")
    return r["x"] + r["w"] / 2, r["y"] + r["h"] / 2


def main():
    with Agent(game=GAME, seed=5) as a:
        # --- $.font: стили, наследование, неизвестный стиль -------------------
        check(a.eval("$.font.list().join(',')") == "hud,title", "$.font.list() знает оба стиля")
        check(a.eval("$.font.of('#hud_label')") == "hud", "стиль применён к узлу")
        check(a.eval("$.font.styleOf('#hud_label').size") == 20, "размер взят из стиля")
        check(a.eval("$.font.get('title').size") == 30, "base: title взял размер 30")
        check(a.eval("$.font.get('title').color") == "#ffd166", "base: title взял свой цвет")
        check(a.eval("$.font.get('title').align") == "center", "base: выравнивание от hud")
        check(a.eval("$.font.get('нет-такого')") is None, "неизвестный стиль → null")
        check(a.eval("$('#hud_label').textStyle()") == "hud", "метод узла .textStyle() читает имя")

        # --- $.screen: открытие и раскладка ----------------------------------
        check(a.eval("$.screen.isOpen()") is False, "экран закрыт на старте")
        a.eval("$.screen.open('pause'); true")
        a.step(1)
        check(a.eval("$.screen.isOpen()") is True, "экран открылся")
        check(a.eval("$.screen.current()") == "pause", "имя открытого экрана")
        check(a.eval("$.screen.focused()") == "resume", "фокус на первой кнопке")

        title = a.eval("$.screen.rect('pause_title')")
        resume = a.eval("$.screen.rect('resume')")
        quit_ = a.eval("$.screen.rect('quit')")
        check(title["y"] < resume["y"] < quit_["y"], "строки разложены сверху вниз")
        check(resume["w"] == quit_["w"] == title["w"], "строки растянуты на ширину панели")
        check(resume["h"] == 44, "высота кнопки по умолчанию")
        check(a.eval("$.screen.panelRect().w") == resume["w"] + 32, "панель обнимает содержимое с padding 16")
        check(a.eval("$.screen.rect('нет-такого')") is None, "неизвестный элемент → null")

        # --- $.screen: клавиатура, активация, мышь, Escape --------------------
        a.key("Down")
        a.step(2)
        check(a.eval("$.screen.focused()") == "quit", "стрелка вниз двигает фокус")
        check(a.eval("$.store.get('screen_focus')") == "quit", "событие focus дошло до игры")
        a.key("Down")
        a.step(2)
        check(a.eval("$.screen.focused()") == "resume", "фокус идёт по кругу")
        a.key("Return")
        a.step(2)
        check(a.eval("$.store.get('screen_action')") == "resume", "Enter активировал кнопку")

        mx, my = center(a, "quit")
        a.mouse_move(x=mx, y=my)
        a.step(2)
        check(a.eval("$.screen.focused()") == "quit", "мышь переносит фокус на узел под курсором")
        a.mouse(button=1, action="click")
        a.step(2)
        check(a.eval("$.store.get('clicked')") is True, "клик мышью дошёл до обработчика узла")

        a.key("Escape")
        a.step(2)
        check(a.eval("$.screen.isOpen()") is False, "Escape закрыл экран")
        check(a.eval("$.store.get('screen_closed')") is True, "событие close дошло до игры")

        # --- $.dialog: открытие, печатная машинка ----------------------------
        check(a.eval("$.dialog.play('guard')") is True, "диалог открылся")
        a.step(1)
        check(a.eval("$.dialog.isOpen()") is True, "$.dialog.isOpen()")
        check(a.eval("$.dialog.definition()") == "guard", "id диалога")
        check(a.eval("$.dialog.node()") == "hello", "стартовая реплика")
        check(a.eval("$.dialog.speaker()") == "Стражник", "имя говорящего")
        check(a.eval("$.dialog.portrait()") == "art/guard.png", "портрет")
        check(a.eval("$.dialog.fullText()") == "Стой! Кто идёт?", "полный текст реплики")
        check(a.eval("$.dialog.isTyping()") is True, "текст печатается")
        shown = a.eval("$.dialog.text().length")
        check(shown < 15, "виден не весь текст сразу")
        a.step(3)
        check(a.eval("$.dialog.text().length") > shown,
              "печатная машинка двигается по кадрам (нужен tickDialog в api.js)")
        a.eval("$.dialog.skip(); true")
        check(a.eval("$.dialog.isTyping()") is False, "skip() допечатал реплику")
        check(a.eval("$.dialog.text()") == "Стой! Кто идёт?", "текст допечатан целиком")

        # --- $.dialog: условия и ветки ---------------------------------------
        check(len(a.eval("$.dialog.choices()")) == 1, "выбор с ложным if скрыт")
        a.eval("$.store.set('has_pass', true); true")
        check(len(a.eval("$.dialog.choices()")) == 2, "с флагом виден второй выбор")
        check(a.eval("$.dialog.choices()[0].text") == "Я свой", "текст первого выбора")
        a.eval("$.dialog.chooseByText('Я свой'); true")
        check(a.eval("$.dialog.node()") == "pass", "выбор повёл по ветке на pass")
        a.eval("$.dialog.skip(); $.dialog.next(); true")
        check(a.eval("$.dialog.node()") == "bye", "цепочка to довела до bye")
        check(a.eval("$.store.get('dialog_line')") == "bye", "событие line дошло до игры")
        a.eval("$.dialog.skip(); $.dialog.next(); true")
        check(a.eval("$.dialog.isOpen()") is False, "последняя реплика закрыла диалог")
        check(a.eval("$.store.get('dialog_end')") == "end", "событие end с reason 'end'")
        check(a.eval("$.store.get('talked')") == 1, "обработчик end выполнился один раз")

        # --- $.dialog: выбор с клавиатуры ------------------------------------
        a.eval("$.dialog.play('guard'); true")
        a.step(2)
        a.eval("$.dialog.skip(); true")
        a.key("Down")
        a.step(2)
        check(a.eval("$.dialog.choiceFocus()") == 1, "стрелка вниз двигает подсветку выбора")
        a.key("Up")
        a.step(2)
        check(a.eval("$.dialog.choiceFocus()") == 0, "стрелка вверх возвращает подсветку")
        a.key("Return")
        a.step(2)
        check(a.eval("$.dialog.node()") == "pass", "Enter выбрал подсвеченный вариант")
        check(a.eval("$.store.get('dialog_choice')") == "Я свой", "событие choice с текстом")
        a.eval("$.dialog.close(); true")
        check(a.eval("$.dialog.isOpen()") is False, "close() закрыл диалог")
        check(a.eval("$.dialog.node()") is None, "у закрытого диалога нет реплики")

        # --- $.dialog: условие на реплике и ключ i18n ------------------------
        a.eval("$.store.set('has_pass', false); $.dialog.play('locked'); true")
        a.eval("$.dialog.skip(); $.dialog.next(); true")
        check(a.eval("$.dialog.node()") == "final", "реплика с ложным if пропущена")
        a.eval("$.dialog.close(); true")

        a.eval("$.dialog.vars({ name: 'Игрок' }); $.dialog.play('greet'); true")
        a.eval("$.dialog.skip(); true")
        check(a.eval("$.dialog.fullText()") == "Привет, Игрок!", "ключ словаря переведён с подстановкой")
        a.eval("$.dialog.close(); true")
        check(a.eval("$.dialog.play('нет-такого')") is False, "неизвестный диалог не открывается")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
