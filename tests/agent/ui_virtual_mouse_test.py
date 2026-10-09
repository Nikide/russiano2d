#!/usr/bin/env python3
# ===========================================================================
# Виртуальная мышь агента доходит до RmlUi (docs/AGENT_API.md §3.5).
#
# RmlUi получает ввод только событиями SDL, а виртуальная мышь агента — это
# опросное состояние. Движок (r2d_app_begin_frame) отправляет изменения
# позиции, кнопок и колеса подписчикам событий тем же путём, что настоящая
# мышь: агент нажимает кнопки интерфейса, наводит курсор и крутит списки.
#
# Запуск (после сборки): python3 tests/agent/ui_virtual_mouse_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
DOC = "$.ui.doc('tests/fixtures/uiclick/ui/p.rml')"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def counts(a):
    return json.loads(a.eval("JSON.stringify($.agent.snapshot().uiclick || null)") or "null") or a.state()["state"].get("uiclick") or {}


def center(a, element):
    r = json.loads(a.eval(f"JSON.stringify({DOC}.rect('{element}'))"))
    return r["x"] + r["w"] / 2, r["y"] + r["h"] / 2


def main():
    with Agent(game="tests/fixtures/uiclick", seed=1) as a:
        a.step(5)
        c = a.state()["uiclick"]
        check(c == {"a": 0, "b": 0, "over": 0, "down": 0, "up": 0}, "старт: счётчики нулевые")

        # Наведение: mouseover приходит без нажатия.
        x, y = center(a, "btn-a")
        a.mouse_move(x=x, y=y)
        a.step(3)
        c = a.state()["uiclick"]
        check(c["over"] >= 1, "наведение мыши агента даёт mouseover у кнопки (%r)" % c)
        check(c["a"] == 0, "наведение без нажатия клик не вызывает")

        # Клик: down и up в разных кадрах, затем click.
        a.mouse(button=1, action="click")
        a.step(5)
        c = a.state()["uiclick"]
        check(c["a"] == 1 and c["down"] == 1 and c["up"] == 1, "клик агента по кнопке: click, mousedown, mouseup по одному разу (%r)" % c)

        # Другая кнопка получает свой клик, первая — нет.
        x, y = center(a, "btn-b")
        a.mouse_move(x=x, y=y)
        a.step(3)
        a.mouse(button=1, action="click")
        a.step(5)
        c = a.state()["uiclick"]
        check(c["b"] == 1 and c["a"] == 1, "клик по соседней кнопке не задевает первую (%r)" % c)

        # Клик мимо кнопок ничего не нажимает.
        a.mouse_move(x=700, y=500)
        a.step(3)
        a.mouse(button=1, action="click")
        a.step(5)
        c2 = a.state()["uiclick"]
        check(c2["a"] == 1 and c2["b"] == 1, "клик мимо кнопок ничего не нажимает")

        # Удержание: down без up не создаёт click, up на другом элементе — тоже.
        x, y = center(a, "btn-a")
        a.mouse_move(x=x, y=y)
        a.step(2)
        a.mouse(button=1, action="down")
        a.step(3)
        xb, yb = center(a, "btn-b")
        a.mouse_move(x=xb, y=yb)
        a.step(2)
        a.mouse(button=1, action="up")
        a.step(4)
        c3 = a.state()["uiclick"]
        check(c3["a"] == 1 and c3["b"] == 1, "нажали на A, отпустили над B — click не засчитан (%r)" % c3)

        # Колесо крутит прокручиваемый список под курсором.
        lx, ly = center(a, "list")
        a.mouse_move(x=lx, y=ly)
        a.step(2)
        before = json.loads(a.eval(f"JSON.stringify({DOC}.rect('row-30'))"))["y"]
        a.cmd("wheel", amount=-3)
        a.step(4)
        after = json.loads(a.eval(f"JSON.stringify({DOC}.rect('row-30'))"))["y"]
        check(after < before, "колесо агента прокрутило список (y строки 30: %.1f → %.1f)" % (before, after))

        # Обычный игровой ввод по-прежнему работает: опросное состояние мыши не пропало.
        check(a.eval("Math.round($.input.mouse().x)") == round(lx), "позиция мыши в $.input совпадает с виртуальной")

    if FAILURES:
        print("\nПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


main()
