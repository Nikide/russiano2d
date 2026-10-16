#!/usr/bin/env python3
# ===========================================================================
# BASHNYA H1 (аудит костылей): `doc.hide(id)` скрывал ВЕСЬ документ, а
# `rect(id)` продолжал отдавать прежние размеры — автопроверка игры «элемент
# есть и у него есть размер» оставалась зелёной, ничего не доказывая.
#
# Проверяется на живом движке:
#   * hide/show по ЭЛЕМЕНТУ не трогают документ;
#   * rect() отдаёт null для скрытого элемента (а не размеры «как до скрытия»);
#   * скрытый РОДИТЕЛЬ делает невидимыми детей (rect(ребёнка) → null);
#   * hide()/show() без аргумента по-прежнему работают с документом целиком.
#
# Запуск: python3 tests/agent/ui_hide_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "uiclick")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(4)
        # $.ui.doc(path) отдаёт обёртку {id, path}: методы зовём у неё,
        # а числовой id документа берём из поля — так и делает игра.
        doc = a.eval("$.ui.doc('ui/p.rml').id")
        check(isinstance(doc, int) and doc >= 0, "документ загружен (id=%s)" % doc)
        # В фикстуре документ создаётся скрытым (игра показывает его сама) —
        # приводим к видимому состоянию, иначе rect() честно вернёт null.
        a.eval("$.ui.doc('ui/p.rml').show()")
        a.step(4)
        if not a.eval("engine.ui.visible(%d)" % doc):
            a.eval("engine.ui.show(%d)" % doc)
            a.step(4)

        def rect(el):
            return a.eval("engine.ui.rect(%d, %r)" % (doc, el))

        def visible():
            return a.eval("engine.ui.visible(%d)" % doc)

        check(rect("list") is not None and rect("row-0") is not None,
              "до скрытия: rect(list) и rect(row-0) — боксы")
        check(visible() is True, "до скрытия документ видим")

        # --- H1: скрытие ЭЛЕМЕНТА не скрывает документ -----------------------
        a.eval("$.ui.doc('ui/p.rml').hide('row-0')")
        a.step(4)
        check(rect("row-0") is None,
              "rect(скрытого элемента) → null, а не прежние размеры")
        check(visible() is True and rect("list") is not None,
              "документ остался видимым: скрыт элемент, а не весь документ (H1)")
        check(rect("row-1") is not None,
              "соседний элемент не задет (rect(row-1) — бокс)")

        a.eval("$.ui.doc('ui/p.rml').show('row-0')")
        a.step(4)
        check(rect("row-0") is not None, "show(id) вернул элемент: rect снова бокс")

        # --- H1: скрытый РОДИТЕЛЬ делает детей невидимыми --------------------
        a.eval("$.ui.doc('ui/p.rml').hide('list')")
        a.step(4)
        check(rect("list") is None, "rect(скрытого родителя) → null")
        check(rect("row-1") is None,
              "rect(ребёнка скрытого родителя) → null (обход предков)")
        a.eval("$.ui.doc('ui/p.rml').show('list')")
        a.step(4)
        check(rect("row-1") is not None, "после показа родителя rect(ребёнка) снова бокс")

        # --- Обратная совместимость: без аргумента — документ целиком --------
        a.eval("$.ui.doc('ui/p.rml').hide()")
        a.step(4)
        check(visible() is False, "hide() без аргумента скрывает документ целиком")
        check(rect("list") is None, "у скрытого документа rect тоже null")
        a.eval("$.ui.doc('ui/p.rml').show()")
        a.step(4)
        check(visible() is True and rect("list") is not None,
              "show() без аргумента вернул документ")

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
