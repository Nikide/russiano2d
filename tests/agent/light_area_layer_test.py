#!/usr/bin/env python3
# ===========================================================================
# §37: слой площадного света (<lightarea>) обязан уважаться.
#
# Найдено при отдаче списка источников в DevTools: у <light> слой брался из
# узла (lightLayerOf), а у <lightarea> стояла жёсткая единица. Значит
# `.lightLayer(bits)` у площадного света при включённой карте света молча не
# действовал: свет уходил в слой 1 независимо от объявленного, и получателя с
# маской другого слоя он либо освещал зря, либо не видел.
#
# Проверка визуальная и в обе стороны: свет объявлен в слое 2 — освещён
# получатель с маской 2; переключаем слой на 1 — освещён получатель с маской 1.
# Так проверяется именно СЛОЙ, а не «свет вообще дошёл».
#
# Фикстура — tests/fixtures/light_mask: камера мира совпадает с экраном,
# получатели уже стоят на известных точках, разбор PNG берётся из
# light_receiver_mask_test (там же проверены точки замера).
#
# Запуск (после сборки движка):
#   python3 tests/agent/light_area_layer_test.py
# ===========================================================================

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
sys.path.insert(0, HERE)

from agent_client import Agent                       # noqa: E402
from light_receiver_mask_test import read_png, luma  # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "light_mask")
RECV_1 = (530, 420)   # получатель слева
RECV_2 = (750, 420)   # получатель справа
AREA = "area"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


SHOTS = tempfile.mkdtemp(prefix="r2d-light-area-")


def pair(a, name):
    # Скриншоты — во временный каталог: корень репозитория не должен собирать
    # отладочные PNG (их потом приходится вычищать руками).
    img = read_png(a.screenshot(os.path.join(SHOTS, name)))
    return luma(img, *RECV_1), luma(img, *RECV_2)


def main():
    with Agent(game=GAME, scene="accept", seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        # Точечные источники фикстуры прячем: проверяем ровно площадной свет.
        a.eval("$('#lamp_1').hide(); $('#lamp_2').hide();"
               " $('#plain').hide(); $('#unlit').hide();"
               " $('<lightarea>', { id: 'area', radius: 320, intensity: 1.2,"
               " color: '#ffffff', samples: 2 })"
               "   .at(640, 240).size(220, 12).blend('add').appendTo($.world);"
               " $('#recv_1').lightMask(1); $('#recv_2').lightMask(2); 'ok'")
        a.step(3)
        check(a.eval("$.gfx.light.stats().maskNodes") == 2,
              "оба получателя с маской видны движку (%s)" % a.eval("$.gfx.light.stats().maskNodes"))

        # --- Свет объявлен в слое 2: освещён правый получатель ---------------
        a.eval("$('#%s').lightLayer(2); 'ok'" % AREA)
        a.step(3)
        left2, right2 = pair(a, "light_area_layer2.png")
        print("  --   слой 2: recv_1(маска 1)=%.1f recv_2(маска 2)=%.1f" % (left2, right2))
        check(right2 > left2 + 20,
              "в слое 2 освещён получатель маски 2 (%.1f > %.1f + 20)" % (right2, left2))

        # --- Тот же свет в слое 1: картина обязана перевернуться -------------
        a.eval("$('#%s').lightLayer(1); 'ok'" % AREA)
        a.step(3)
        left1, right1 = pair(a, "light_area_layer1.png")
        print("  --   слой 1: recv_1(маска 1)=%.1f recv_2(маска 2)=%.1f" % (left1, right1))
        check(left1 > right1 + 20,
              "в слое 1 освещён получатель маски 1 (%.1f > %.1f + 20)" % (left1, right1))
        check(left1 > left2 + 20 and right2 > right1 + 20,
              "смена слоя источника действительно переключает получателя "
              "(%.1f→%.1f и %.1f→%.1f)" % (left2, left1, right2, right1))

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
