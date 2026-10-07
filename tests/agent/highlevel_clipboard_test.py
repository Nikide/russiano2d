#!/usr/bin/env python3
# ===========================================================================
# Проверка буфера обмена и предпросмотра IME.
#
# Копирование, вырезание и вставка — то, что пользователь считает само собой
# разумеющимся, а в движке этого не было вовсе: ни Ctrl+C/V/X/A, ни выделения,
# ни SDL_EVENT_TEXT_EDITING. Буфер обмена в headless-режиме недоступен
# (системного нет), поэтому движок подменяется на стороне JS: проверяются
# ГОРЯЧИЕ КЛАВИШИ и логика правки текста, а не платформенный буфер.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_clipboard_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def text_of(a, sel="#f"):
    return a.eval(f"String($('{sel}').nodes[0].text)")


def press(a, key):
    a.key(key, "down")
    a.step(1)
    a.key(key, "up")
    a.step(1)


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        # Поле в фокусе и подмена буфера: headless-среда системного не имеет.
        a.eval("""
            $('<ui.input>', { id: 'f', maxLength: 64 }).at(200, 100).size(200, 32)
                .appendTo($.ui);
            $.ui.focus('#f');
            globalThis.__clip = '';
            const real_get = engine.clipboard;
            engine.clipboard = () => globalThis.__clip;
            engine.setClipboard = (t) => { globalThis.__clip = String(t); return true; };
        """)
        a.step(1)
        check(a.eval("$.ui.focusedId()") == "f", "поле в фокусе")

        # Ввод текста (через агентскую команду text).
        a.cmd("text", text="Привет")
        a.step(1)
        check(text_of(a) == "Привет", f"текст введён: {text_of(a)}")

        # Ctrl+A — выделить всё, Ctrl+C — скопировать.
        a.key("Left Ctrl", "down")
        press(a, "A")
        a.step(1)
        check(a.eval("globalThis.__clip") == "", "Ctrl+A ничего не копирует (только выделяет)")
        press(a, "C")
        a.step(1)
        a.key("Left Ctrl", "up")
        a.step(1)
        check(a.eval("globalThis.__clip") == "Привет",
              f"Ctrl+C скопировал всё: {a.eval('globalThis.__clip')!r}")

        # Ctrl+V — вставить в конец (выделение снято).
        a.eval("$('#f').nodes[0].attrs.sel_from = -1; $('#f').nodes[0].attrs.sel_to = -1;")
        a.key("Left Ctrl", "down")
        press(a, "V")
        a.key("Left Ctrl", "up")
        a.step(1)
        check(text_of(a) == "ПриветПривет", f"Ctrl+V вставил: {text_of(a)}")

        # Ctrl+A, затем Ctrl+X — вырезать всё: поле пустое, буфер полный.
        a.key("Left Ctrl", "down")
        press(a, "A")
        press(a, "X")
        a.key("Left Ctrl", "up")
        a.step(1)
        check(text_of(a) == "", f"Ctrl+X вырезал всё: {text_of(a)!r}")
        check(a.eval("globalThis.__clip") == "ПриветПривет", "вырезанное попало в буфер")

        # Ctrl+V возвращает текст обратно.
        a.key("Left Ctrl", "down")
        press(a, "V")
        a.key("Left Ctrl", "up")
        a.step(1)
        check(text_of(a) == "ПриветПривет", f"вставка вернула текст: {text_of(a)}")

        # Выделение и Backspace. Проверяем ТОЧНО: ставим выделение прямо (символы
        # в кириллице двухбайтные, и «Shift+Right дважды» проверяло бы не это),
        # и убеждаемся, что Backspace снёс ИМЕННО выделение.
        a.eval("$('#f').text('abcdef'); $('#f').nodes[0].attrs.cursor = 4; "
               "$('#f').nodes[0].attrs.sel_from = 1; $('#f').nodes[0].attrs.sel_to = 4;")
        press(a, "Backspace")
        check(text_of(a) == "aef", f"Backspace снёс выделение: {text_of(a)!r} (ждали 'aef')")

        # Без выделения Backspace удаляет один символ — прежнее поведение цело.
        a.eval("$('#f').text('abc'); $('#f').nodes[0].attrs.cursor = 3; "
               "$('#f').nodes[0].attrs.sel_from = -1; $('#f').nodes[0].attrs.sel_to = -1;")
        press(a, "Backspace")
        check(text_of(a) == "ab", f"без выделения удалён один символ: {text_of(a)!r}")

        # Shift+стрелка ВЫДЕЛЯЕТ: sel_from/sel_to становятся разными.
        a.eval("$('#f').text('abcd'); $('#f').nodes[0].attrs.cursor = 1; "
               "$('#f').nodes[0].attrs.sel_from = -1; $('#f').nodes[0].attrs.sel_to = -1;")
        a.key("Left Shift", "down")
        a.step(1)
        press(a, "Right")
        press(a, "Right")
        a.key("Left Shift", "up")
        a.step(1)
        sel = json.loads(a.eval("JSON.stringify({f: $('#f').nodes[0].attrs.sel_from, "
                                "t: $('#f').nodes[0].attrs.sel_to, c: $('#f').nodes[0].attrs.cursor})"))
        print(f"  после Shift+Right×2: {sel}")
        check(sel["f"] >= 0 and sel["t"] > sel["f"],
              f"Shift+стрелки выделили диапазон: {sel}")

        # Вставка заменяет выделение.
        a.eval("$('#f').text('ABC'); $('#f').nodes[0].attrs.cursor = 3; "
               "$('#f').nodes[0].attrs.sel_from = 0; $('#f').nodes[0].attrs.sel_to = 3; "
               "globalThis.__clip = 'XYZ';")
        a.key("Left Ctrl", "down")
        press(a, "V")
        a.key("Left Ctrl", "up")
        a.step(1)
        check(text_of(a) == "XYZ", f"вставка заменила выделение: {text_of(a)}")

        # maxLength соблюдается и при вставке.
        a.eval("$('#f').text(''); $('#f').nodes[0].attrs.cursor = 0; "
               "$('#f').nodes[0].attrs.sel_from = -1; $('#f').nodes[0].attrs.sel_to = -1; "
               "$('#f').nodes[0].attrs.maxLength = 5; globalThis.__clip = '1234567890';")
        a.key("Left Ctrl", "down")
        press(a, "V")
        a.key("Left Ctrl", "up")
        a.step(1)
        check(text_of(a) == "12345", f"вставка обрезана по maxLength: {text_of(a)}")

        # --- IME ------------------------------------------------------------
        ime = json.loads(a.eval("JSON.stringify(engine.ime())"))
        check("text" in ime and "start" in ime, f"engine.ime() отдаёт поля: {ime}")
        check(ime["text"] == "", "по умолчанию композиции нет")
        check(a.eval("typeof engine.textInputArea") == "function",
              "engine.textInputArea есть (окно кандидатов у поля)")

        # Модификаторы доступны из игры.
        check(a.eval("typeof $.input.ctrlDown") == "function", "$.input.ctrlDown есть")
        check(a.eval("typeof $.input.shiftDown") == "function", "$.input.shiftDown есть")

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
