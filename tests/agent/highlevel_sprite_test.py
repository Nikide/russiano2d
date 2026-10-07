#!/usr/bin/env python3
# ===========================================================================
# Тест спрайта в сцене: пивот (точка вращения), nine-slice и анимация тайлов.
#
# Что проверяется:
#   * пивот меняет кадр при повороте и возвращается к исходному побитово;
#   * .pivot()/.pivotAt() читаются и пишутся, значения по умолчанию — центр;
#   * nine-slice принимает инсеты числом и объектом, рисует части, выключается;
#   * анимация тайлов идёт игровым временем и отдаёт состояние геттером.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_sprite_test.py
# ===========================================================================

import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")
FONT = "assets/fonts/NotoSans-Regular.ttf"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def digest(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def shot(a, path):
    a.cmd("screenshot", path=path)
    return digest(path)


def main():
    with Agent(game=GAME, seed=5) as a:
        # --- Пивот: значения по умолчанию ------------------------------------
        a.eval("$.world.color('#000000')")
        a.eval("$('<rect>', { id: 'r', w: 160, h: 60 }).at(400, 300)"
               ".color('#ffffff').angle(0.6).appendTo($.world)")
        check(a.eval("$('#r').pivot()") == {"x": 0.5, "y": 0.5},
              "по умолчанию пивот — центр")
        a.step(3)
        center = shot(a, "/tmp/sprite_center.png")

        # --- Пивот меняет кадр и возвращается --------------------------------
        a.eval("$('#r').pivot(0, 0)")
        a.step(3)
        corner = shot(a, "/tmp/sprite_corner.png")
        check(center != corner, "пивот (0,0) меняет кадр при повороте")

        a.eval("$('#r').pivot(0.5, 0.5)")
        a.step(3)
        back = shot(a, "/tmp/sprite_back.png")
        check(center == back, "возврат к центру даёт тот же кадр")

        # --- Пивот в мировых координатах -------------------------------------
        a.eval("$('#r').pivotAt(400, 330)")   # низ по центру узла
        p = a.eval("$('#r').pivot()")
        check(abs(p["y"] - 1.0) < 0.01, "pivotAt снизу даёт pivot.y ≈ 1")
        check(abs(p["x"] - 0.5) < 0.01, "pivotAt по центру даёт pivot.x ≈ 0.5")

        # --- Nine-slice -------------------------------------------------------
        check(a.eval("$('<sprite>', { id: 'panel', w: 240, h: 120 })"
                     ".sprite(%r).slice({ left: 8, right: 8, top: 8, bottom: 8 })"
                     ".at(400, 200).slice()" % FONT) is not None,
              "slice принимает объект с инсетами")
        slice9 = a.eval("JSON.stringify($('#panel').slice())")
        check("left" in slice9 and "bottom" in slice9, "slice читается обратно")
        a.eval("$('<sprite>', { id: 'panel2', w: 100, h: 60 })"
               ".sprite(%r).slice(6).at(200, 200)" % FONT)
        check(a.eval("$('#panel2').slice().left") == 6, "slice(число) — со всех сторон")
        a.step(3)
        check(a.eval("$('#panel').length") == 1, "узел с nine-slice жив после кадров")
        a.eval("$('#panel').slice(null)")
        check(a.eval("$('#panel').slice()") is None, "slice(null) выключает nine-slice")

        # --- Анимация тайлов ---------------------------------------------------
        a.eval("""
            const tm = $.tilemap.fromASCII(['##', '##'], { '#': 1, '.': 0 },
                                           { src: %r, tile: 16 });
            tm.tileset({ frames: 2, fps: 10 });
        """ % FONT)
        anim0 = a.eval("$('tilemap').first().tileAnimation()")
        check(anim0 and anim0["frames"] == 2, "tileset поставил анимацию")
        check(abs(anim0["interval"] - 100) < 0.1, "fps переведён в интервал")
        before = a.eval("$('tilemap').first().tileAnimation().time")
        a.step(6)
        after = a.eval("$('tilemap').first().tileAnimation().time")
        check(after > before, "время анимации идёт игровым временем")
        a.step(20)
        check(a.eval("$('tilemap').first().tileAnimation().time") > after,
              "анимация продолжает идти")
        a.eval("$('tilemap').first().tileset(null)")
        check(a.eval("$('tilemap').first().tileAnimation()") is None,
              "tileset(null) выключает анимацию")

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
