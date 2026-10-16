#!/usr/bin/env python3
# ===========================================================================
# BASHNYA E8: видимость слоя — ОДИН смысл у `$.layers.*` и у узла-слоя.
#
# До правки было два разных смысла: `$.layers.hide/show(name)` гасили и
# показывали глубоко (слой + все потомки), а `.hide()/.show()/.visible()` у
# узла-слоя трогали только сам узел. Смесь «глубоко спрятали — поверхностно
# показали» оставляла слой нарисованным ПУСТЫМ: `layer.visible = true`, а дети
# `visible = false`. Тест падает на старом коде именно на смешанных вызовах.
#
# Проверяется и обратное направление (`$.layers.get('bg').hide()` →
# `$.layers.show('bg')`), дети, добавленные ПОСЛЕ `hide()`, вложенные узлы,
# `isVisible()` и пиксель кадра (слой не просто «видим флагом», а нарисован).
#
# Запуск после сборки:
#   python3 tests/agent/layers_visibility_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "layers")
FAILURES = []
STAR = (43, 74, 122)      # '#2b4a7a' — цвет #star0 из фикстуры


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def visible(a, sel):
    return a.eval("$('%s').isVisible()" % sel)


def run(a):
    check(visible(a, "#star0") is True, "исходно ребёнок слоя виден")

    # --- смесь 1: глубокий hide подсистемой → поверхностный show обёрткой ----
    a.eval("$.layers.hide('bg')")
    a.step(1)
    check(visible(a, "#star0") is False, "после $.layers.hide('bg') ребёнок скрыт")
    a.eval("$.layers.get('bg').show()")
    a.step(1)
    check(visible(a, "#star0") is True,
          "после $.layers.get('bg').show() ребёнок ВЕРНУЛСЯ (BASHNYA E8)")
    check(a.eval("$.layers.get('bg').isVisible()") is True, "сам слой видим")

    # --- смесь 2: поверхностный hide обёрткой → глубокий show подсистемой ---
    a.eval("$.layers.get('bg').hide()")
    a.step(1)
    check(visible(a, "#star0") is False,
          "hide() у узла-слоя гасит и детей (один смысл видимости)")
    a.eval("$.layers.show('bg')")
    a.step(1)
    check(visible(a, "#star0") is True, "после $.layers.show('bg') ребёнок виден")

    # --- обёртка → обёртка ---------------------------------------------------
    a.eval("$.layers.get('bg').hide()")
    a.step(1)
    a.eval("$.layers.get('bg').show()")
    a.step(1)
    check(visible(a, "#star0") is True, "обёртка hide() → обёртка show() возвращает детей")

    # --- .visible(false) у узла-слоя — тот же глубокий путь ------------------
    a.eval("$.layers.get('bg').visible(false)")
    a.step(1)
    check(visible(a, "#star0") is False, ".visible(false) у слоя гасит детей")
    a.eval("$.layers.get('bg').visible(true)")
    a.step(1)
    check(visible(a, "#star0") is True, ".visible(true) у слоя показывает детей")

    # --- дети, добавленные ПОСЛЕ hide() --------------------------------------
    a.eval("$.layers.hide('bg')")
    a.step(1)
    a.eval("$('<rect>', { id: 'late' }).at(700, 120).size(10, 10)"
           ".color('#e8e8f0').appendTo($.layers.get('bg'))")
    a.step(2)
    check(visible(a, "#late") is False, "ребёнок, добавленный в скрытый слой, скрыт")
    a.eval("$.layers.get('bg').show()")
    a.step(2)
    check(visible(a, "#late") is True, "show() возвращает и позже добавленного ребёнка")
    check(visible(a, "#star0") is True, "и прежних детей тоже")

    # --- вложенность ---------------------------------------------------------
    # ВАЖНО: `.appendTo('#star0')` (строка-селектор) молча ни к чему не
    # прикрепляет — `resolveContainer()` принимает только узел или обёртку
    # (найдено при написании теста, см. отчёт). Поэтому здесь обёртка.
    a.eval("$('<rect>', { id: 'inner' }).at(64, 84).size(6, 6)"
           ".color('#ff0000').appendTo($('#star0'))")
    a.step(2)
    check(a.eval("$('#star0').children().length") == 1, "вложенный узел прикреплён к ребёнку слоя")
    a.eval("$.layers.hide('bg')")
    a.step(1)
    check(visible(a, "#inner") is False, "вложенный узел гасится вместе со слоем")
    a.eval("$.layers.get('bg').show()")
    a.step(2)
    check(visible(a, "#inner") is True, "вложенный узел возвращается вместе со слоем")
    check(a.eval("$('#inner').get(0).visible") is True
          and a.eval("$('#star0').get(0).visible") is True,
          "флаги узлов согласованы с isVisible()")

    # --- обычный узел вне слоя: прежняя семантика (только сам узел) ----------
    a.eval("$('<rect>', { id: 'plain' }).at(300, 400).size(20, 20).color('#00ff00')"
           ".appendTo($.world)")
    a.eval("$('<rect>', { id: 'plain_child' }).at(300, 400).size(6, 6).color('#ffff00')"
           ".appendTo($('#plain'))")
    a.step(1)
    a.eval("$('#plain').hide()")
    a.step(1)
    check(a.eval("$('#plain_child').get(0).visible") is True,
          "у обычного узла .hide() не трогает детей (поведение не расширено)")

    # --- пиксель: слой не просто «видим флагом», а нарисован ------------------
    a.eval("$.layers.hide('bg')")
    a.step(2)
    off = Image.open(a.screenshot(os.path.join(ROOT, "build", "layers_hidden.png"))).convert("RGB")
    a.eval("$.layers.get('bg').show()")
    a.step(2)
    on = Image.open(a.screenshot(os.path.join(ROOT, "build", "layers_shown.png"))).convert("RGB")

    def star_pixel(image):
        return image.getpixel((int(60 + 400), int(80 + 300)))    # камера фикстуры в (0,0)

    check(star_pixel(on) == STAR and star_pixel(off) != STAR,
          "после смешанного hide/show звезда НАРИСОВАНА: %s против %s"
          % (star_pixel(on), star_pixel(off)))


def main():
    with Agent(game=GAME, seed=11, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки видимости слоёв (E8) пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
