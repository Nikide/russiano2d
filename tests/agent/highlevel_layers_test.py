#!/usr/bin/env python3
# ===========================================================================
# Тест подсистемы канвас-слоёв ($.layers).
#
# Гоняет фикстуру tests/fixtures/layers и проверяет всё, что обещано в
# docs/highlevel/layers.md: реестр слоёв, распространение порядка и
# видимости на потомков, параллакс (включая перезакрепление якоря),
# полноэкранный оттенок modulate и переход-затемнение fade.
#
# Запуск (собранный движок, интегратор):
#   python3 tests/agent/highlevel_layers_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "layers")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(2)

        # --- Реестр слоёв -----------------------------------------------------
        check(a.eval("typeof $.layers") == "object", "$.layers доступно")
        check(a.eval("$.layers.has('bg')") is True, "слой bg зарегистрирован")
        check(a.eval("$.layers.has('hud')") is True, "слой hud зарегистрирован")
        check(a.eval("$.layers.get('bg').length") == 1, "get(name) возвращает слой")
        check(a.eval("$.layers.get('нет-такого').length") == 0, "get несуществующего пуст")
        check(a.eval("$.layers.list()") == ["bg", "hud"], "list() идёт снизу вверх")
        check(a.eval("$.layers.current()") == "hud", "current() — верхний слой")
        check(a.eval("$.layers.order('hud')") == 20, "порядок слоя читается")
        check(a.eval("$.layers.order()[0].name") == "bg",
              "order() без аргументов отдаёт список { name, order }")

        # --- Принадлежность и распространение порядка -------------------------
        check(a.eval("$.layers.of('#star0')") == "bg",
              "ребёнок слоя приписан к bg (порядок слоя разошёлся на потомков)")
        check(a.eval("$.layers.of('#hud_strip')") == "hud",
              "второй слой тоже видит своих детей")
        check(a.eval("$.layers.of('#block')") is None,
              "узел мира не принадлежит ни одному слою")

        # --- bringToFront / sendToBack ----------------------------------------
        check(a.eval("$.layers.bringToFront('bg')") == "bg", "bringToFront вернул имя")
        check(a.eval("$.layers.current()") == "bg", "bringToFront поднял слой")
        check(a.eval("$.layers.order('bg')") > a.eval("$.layers.order('hud')"),
              "после bringToFront порядок bg выше hud")
        check(a.eval("$.layers.sendToBack('bg')") == "bg", "sendToBack вернул имя")
        check(a.eval("$.layers.list()[0]") == "bg", "sendToBack опустил слой вниз")
        check(a.eval("$.layers.order('bg')") < a.eval("$.layers.order('hud')"),
              "порядок bg снова ниже hud")

        # --- Видимость --------------------------------------------------------
        check(a.eval("$.layers.hide('bg')") is True, "hide() нашёл слой")
        a.step(1)
        check(a.eval("$.layers.get('bg').isVisible()") is False, "слой скрыт")
        check(a.eval("$('#star0').isVisible()") is False,
              "скрытие слоя гасит его детей")
        check(a.eval("$.layers.show('bg')") is True, "show() нашёл слой")
        a.step(1)
        check(a.eval("$('#star0').isVisible()") is True, "показ слоя возвращает детей")
        check(a.eval("$.layers.toggle('bg')") is True, "toggle() отработал")
        a.step(1)
        check(a.eval("$.layers.get('bg').isVisible()") is False, "toggle скрыл слой")
        a.eval("$.layers.toggle('bg')")
        a.step(1)
        check(a.eval("$.layers.get('bg').isVisible()") is True, "toggle показал слой")

        # --- Параллакс --------------------------------------------------------
        check(abs(a.eval("$.layers.parallax('#star0')") - 0.5) < 1e-6,
              "ребёнок унаследовал параллакс слоя")
        a.eval("$.camera.at(0, 0)")
        a.step(2)
        x0 = a.eval("$('#star0').pos().x")
        a.eval("$.camera.at(200, 0)")
        a.step(2)
        x1 = a.eval("$('#star0').pos().x")
        check(abs((x1 - x0) - 100) < 2,
              f"камера на 200 двигает звезду на 100 при f=0.5 ({x0:.0f} → {x1:.0f})")

        # Игра сама сдвинула узел: якорь должен перезакрепиться за новой позицией.
        # evals, возвращающие обёртку, агент пытается сериализовать и
        # спотыкается о циклы в узле — гасим результат внутри IIFE.
        a.eval("(() => { $('#star0').at(260, 80); })()")
        a.step(2)
        check(abs(a.eval("$('#star0').pos().x") - 260) < 2,
              "ручной сдвиг узла не «съедается» параллаксом")
        a.eval("$.camera.at(400, 0)")
        a.step(2)
        check(abs(a.eval("$('#star0').pos().x") - 360) < 3,
              "после перезакрепления параллакс считается от новой точки")

        # Метод узла .parallax(f): поставить, прочитать, снять.
        a.eval("(() => { $('#block').parallax(0.25); })()")
        check(abs(a.eval("$('#block').parallax()") - 0.25) < 1e-6,
              "метод узла .parallax(f) задаёт коэффициент")
        a.eval("(() => { $('#block').parallax(null); })()")
        check(a.eval("$('#block').parallax()") is None, ".parallax(null) снимает параллакс")
        a.eval("$.camera.at(0, 0)")

        # --- Оттенок modulate -------------------------------------------------
        check(a.eval("$.layers.modulate().alpha") == 0, "по умолчанию оттенка нет")
        a.eval("$.layers.modulate('#000000', 0.4)")
        check(abs(a.eval("$.layers.modulate().alpha") - 0.4) < 1e-6,
              "modulate(color, alpha) задаёт оттенок")
        check(a.eval("$.layers.modulate().color") is not None, "у оттенка есть цвет")
        a.eval("$.layers.modulate(null)")
        check(a.eval("$.layers.modulate().alpha") == 0, "modulate(null) выключает оттенок")

        # --- Переход-затемнение ----------------------------------------------
        a.eval("$.layers.fade('#000000', 1)")
        check(abs(a.eval("$.layers.fade().alpha") - 1) < 1e-6, "fade задаёт затемнение сразу")
        a.eval("$.layers.fadeTo('#000000', 0, 5000); 0")
        a.step(5)
        mid = a.eval("$.layers.fade().alpha")
        check(0 < mid < 1, f"fadeTo меняет прозрачность плавно (alpha={mid:.3f})")
        a.eval("$.layers.fade('#000000', 0)")
        check(a.eval("$.layers.fade().alpha") == 0, "fade(#000000, 0) сбрасывает затемнение")

        # --- remove / clear ---------------------------------------------------
        check(a.eval("$.layers.has('temp')") is False, "временного слоя ещё нет")
        a.eval("$.layers.create({ name: 'temp', order: 99 })")
        check(a.eval("$.layers.has('temp')") is True, "create() заводит слой")
        check(a.eval("$.layers.remove('temp')") is True, "remove() нашёл слой")
        check(a.eval("$.layers.has('temp')") is False, "remove() убрал слой из реестра")
        a.eval("$.layers.clear()")
        check(a.eval("$.layers.list()") == [], "clear() убирает все слои")

        check(a.ping().get("pong") is True, "движок жив после работы со слоями")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
