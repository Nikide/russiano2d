#!/usr/bin/env python3
# ===========================================================================
# Порядок отрисовки при РАВНОЙ глубине — детерминизм и контракт (BASHNYA I10).
#
# Пункт I10 второго прохода: «при равной глубине порядок отрисовки не
# воспроизводится между прогонами». Проверяем фактом по кадру:
#
#   1. два прогона с одинаковым порядком создания дают ОДИН и тот же кадр
#      (сверху тот, кто создан позже: ключ сортировки layer → depth → uid);
#   2. повторный `appendTo()` порядок НЕ меняет — «поднять наверх» им нельзя;
#   3. пересоздание узла (.remove() + новый узел) даёт новый uid и уводит его
#      наверх — вот это и «мигает», если игра создаёт узел каждый раз заново;
#   4. узел, переиспользованный пулом после release(), получает НОВЫЙ uid и
#      рисуется поверх прежних равноглубинных.
#
# Запуск:
#   python3 tests/agent/draw_order_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from light_receiver_mask_test import read_png   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")
SHOTS = os.path.join(os.path.dirname(__file__), "..", "..", "build")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(message):
    print("  --   " + message)


def overlap_pixel(a, tag):
    """Цвет в точке пересечения узлов (400, 300)."""
    path = os.path.join(SHOTS, "draw_order_%s.png" % tag)
    a.screenshot(path)
    width, height, channels, data = read_png(path)
    offset = (300 * width + 400) * channels
    return (data[offset], data[offset + 1], data[offset + 2])


def scene(a):
    a.step(3)
    a.eval("$.world.gravity(0,0).color('#000000'); $.camera.at(400, 300); 'ok'")
    a.eval("""$('<rect>', { id: 'A' }).at(400, 300).size(200, 200).color('#ff0000').appendTo($.world);
             $('<rect>', { id: 'B' }).at(400, 300).size(200, 200).color('#0000ff').appendTo($.world); 'ok'""")
    a.step(2)


def main():
    # --- 1. Детерминизм: два независимых прогона ----------------------------
    runs = []
    for tag in ("run1", "run2"):
        with Agent(game=GAME, seed=5) as a:
            scene(a)
            runs.append(overlap_pixel(a, tag))
            uid = a.eval("JSON.stringify([$('#A').get(0).uid, $('#B').get(0).uid])")
            number("прогон %s: цвет в точке %s, uid A/B = %s" % (tag, runs[-1], uid))
    check(runs[0] == runs[1],
          "I10: два прогона дают один кадр при равной глубине (%s и %s)" % (runs[0], runs[1]))
    check(runs[0] == (0, 0, 255),
          "I10: сверху узел, созданный позже (uid больше): %s" % (runs[0],))

    # --- 2..4. Что меняет порядок, а что нет --------------------------------
    with Agent(game=GAME, seed=5) as a:
        scene(a)
        base = overlap_pixel(a, "base")
        number("исходно: %s" % (base,))

        # 2. Повторный appendTo — «поднять наверх» им нельзя.
        a.eval("$('#A').appendTo($.world); $('#B').appendTo($.world); 'ok'")
        a.step(2)
        after_append = overlap_pixel(a, "append")
        number("после appendTo обоих: %s" % (after_append,))
        check(after_append == base,
              "I10: appendTo не меняет порядок (%s против %s)" % (after_append, base))

        # 2b. detach/hide/show — тоже не меняют.
        a.eval("$('#A').detach(); $('#A').appendTo($.world); $('#A').hide(); $('#A').show(); 'ok'")
        a.step(2)
        after_detach = overlap_pixel(a, "detach")
        number("после detach/appendTo/hide/show: %s" % (after_detach,))
        check(after_detach == base,
              "I10: detach/hide/show порядок не меняют (%s)" % (after_detach,))

        # 3. Пересоздание узла — новый uid, узел уходит наверх.
        a.eval("$('#A').remove(); 'ok'")
        a.step(1)
        a.eval("$('<rect>', { id: 'A' }).at(400, 300).size(200, 200).color('#ff0000').appendTo($.world); 'ok'")
        a.step(2)
        recreated = overlap_pixel(a, "recreated")
        number("после пересоздания A (uid %s): %s" % (a.eval("$('#A').get(0).uid"), recreated))
        check(recreated == (255, 0, 0),
              "I10: пересозданный узел рисуется сверху — вот источник «мигания» (%s)" % (recreated,))

        # 4. Пул: переиспользованный узел получает новый uid и рисуется сверху.
        a.eval("$.pool.create({ name: 'q', tag: 'rect', max: 3, w: 200, h: 200 }); 'ok'")
        a.eval("$.pool.spawn('q', { x: 400, y: 300, id: 'P1' }).color('#00ff00'); 'ok'")
        a.eval("$.pool.spawn('q', { x: 400, y: 300, id: 'P2' }).color('#ffff00'); 'ok'")
        a.step(2)
        uids1 = a.eval("JSON.stringify([$('#P1').get(0).uid, $('#P2').get(0).uid])")
        pool_top = overlap_pixel(a, "pool1")
        number("пул: uid %s, сверху %s" % (uids1, pool_top))
        a.eval("$.pool.release($('#P1')); 'ok'")
        a.step(1)
        a.eval("$.pool.spawn('q', { x: 400, y: 300, id: 'P3' }).color('#ff00ff'); 'ok'")
        a.step(2)
        uid3 = a.eval("$('#P3').get(0).uid")
        recycled = overlap_pixel(a, "pool2")
        number("после release(P1)+spawn(P3): uid %s, сверху %s" % (uid3, recycled))
        check(recycled == (255, 0, 255),
              "I10: узел из пула получает новый uid и рисуется сверху (%s)" % (recycled,))

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d:" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
