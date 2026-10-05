#!/usr/bin/env python3
# ===========================================================================
# Интеграционный тест локализации (i18n.js) и мёртвой зоны ввода (input.js).
#
# Фикстура tests/fixtures/i18n: два <ui.label> с attrs.tr (один — плюральный)
# и привязки действий. Проверяется: смена языка меняет текст узла, плюральные
# формы, падение на запасной язык, deadzone гасит аналоговый вклад в vec,
# save/loadBindings через $.store с отбраковкой испорченных записей.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_i18n_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "i18n")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=3) as a:
        a.step(2)

        # --- Локализация: словарь, tr, автоподстановка ----------------------
        check(a.eval("$.i18n.lang()") == "ru", "язык по умолчанию — ru")
        check(a.eval("$('#title').text()") == "Играть", "attrs.tr переведён на ru")
        check(a.eval("$.i18n.auto()") is True, "автоподстановка включена")
        check(a.eval("$.i18n.has('menu.play')") is True, "has() видит ключ")
        check(a.eval("$.i18n.has('нет.такого')") is False, "has() не выдумывает ключи")

        a.eval("$.i18n.lang('en'); true")
        a.step(1)
        check(a.eval("$.i18n.lang()") == "en", "язык переключился на en")
        check(a.eval("$('#title').text()") == "Play", "смена языка обновила текст узла")
        check(a.eval("$.store.get('i18n.lang')") == "en", "язык сохранён в $.store")

        # --- Плюральные формы и подстановка ---------------------------------
        check(a.eval("$.i18n.plural('kills', 1)") == "1 item", "en: форма для одного")
        check(a.eval("$.i18n.plural('kills', 4)") == "4 items", "en: форма для многих")
        check(a.eval("$('#counter').text()") == "3 items",
              "узел с tr {key, n} получил плюральную форму")

        a.eval("$.i18n.lang('ru'); true")
        a.step(1)
        check(a.eval("$('#title').text()") == "Играть", "возврат на ru обновил текст")
        check(a.eval("$('#counter').text()") == "3 штуки", "ru: форма 2-4")
        check(a.eval("$.i18n.plural('kills', 11)") == "11 штук", "ru: 11-14 — форма 5+")
        check(a.eval("$.i18n.plural('kills', 21)") == "21 штука", "ru: 21 — форма 1")
        check(a.eval("$.tr('menu.play')") == "Играть", "$.tr возвращает перевод")
        check(a.eval("$.tr('нет.ключа')") == "нет.ключа", "нет ключа — вернулся ключ")

        # --- Запасной язык ---------------------------------------------------
        a.eval("$.i18n.lang('fr'); true")
        a.step(1)
        check(a.eval("$.tr('menu.play')") == "Играть", "неизвестный язык падает на ru")
        a.eval("$.i18n.lang('ru'); true")
        a.step(1)

        # --- Мёртвая зона ввода ----------------------------------------------
        check(a.eval("$.input.deadzone()") == 0.2, "мёртвая зона по умолчанию 0.2")
        v = a.eval("$.input.deadzone(0); $.input.vec('wasd')")
        check(abs(v["x"] - 0.5) < 1e-6 and abs(v["y"] - 0.5) < 1e-6,
              "без мёртвой зоны стик попадает в vec")
        v = a.eval("$.input.deadzone(0.9); $.input.vec('wasd')")
        check(v["x"] == 0 and v["y"] == 0, "мёртвая зона 0.9 гасит слабый стик")
        a.eval("$.input.deadzone(0.2); true")

        # --- Привязки: save/load через $.store -------------------------------
        check("jump" in a.eval("$.input.actions()"), "actions() перечисляет действия")
        d = a.eval("$.input.describe('jump')")
        check(d["action"] == "jump" and d["keys"] == ["space"], "describe() даёт ключи")
        check(a.eval("$.input.saveBindings()") is True, "saveBindings() записал в store")
        check(a.eval("$.store.get('input.bindings')['jump']") == ["space"],
              "привязки лежат в $.store")

        a.eval("$.input.bind('jump', ['x']); true")
        check(a.eval("$.input.bindings()['jump'][0]") == "x", "bind() перебил привязку")
        check(a.eval("$.input.loadBindings()") is True, "loadBindings() вернул привязки")
        check(a.eval("$.input.bindings()['jump'][0]") == "space",
              "loadBindings() восстановил исходный ключ")

        # Испорченная запись не должна ломать соседние рабочие привязки.
        a.eval("$.input.bind('jump', ['x']); "
               "$.store.set('input.bindings', { jump: 'space', fire: ['f'], bad: [1] }); "
               "$.input.loadBindings(); true")
        check(a.eval("$.input.bindings()['jump'][0]") == "x",
              "строка вместо массива не восстановлена")
        check(a.eval("$.input.bindings()['fire'][0]") == "f",
              "корректная привязка восстановлена рядом с испорченной")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
