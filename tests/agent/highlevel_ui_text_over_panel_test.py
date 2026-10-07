#!/usr/bin/env python3
# ===========================================================================
# Текст интерфейса виден ПОВЕРХ подложки (ui.panel, ui.bar, ui.button).
#
# ЧТО БЫЛО НЕ ТАК. В срезе игры экран исхода («Убит», «R — заново») не
# появлялся: узлы есть, visible=true, а на кадре ничего. Причина — порядок
# отрисовки внутри ui-слоя:
#
#   ui.panel / ui.bar / ui.button → pushSprite → копится в JS-батч и уходит
#                                  в C только в submitSprites() В КОНЦЕ слоя;
#   ui.label                      → engine.drawText → рисуется в C СРАЗУ.
#
# То есть подпись попадала в батч РАНЬШЕ своей подложки и закрашивалась ею.
# В HUD это не замечалось только потому, что подписи стояли ВНЕ панели.
#
# Тест ставит метку ровно в центр непрозрачной панели и проверяет пиксели
# кадра: в центре должен быть цвет текста, а не цвет панели.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_ui_text_over_panel_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def read_png(path):
    data = open(path, "rb").read()
    pos, w, h, idat = 8, 0, 0, b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if tag == b"IHDR":
            w, h, depth, color = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and color in (2, 6), "ожидался 8-битный RGB(A)"
            bpp = 3 if color == 2 else 4
        elif tag == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = w * bpp
    out, prev = [], bytearray(stride)
    p = 0
    for _ in range(h):
        filt = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if filt == 1: line[i] = (line[i] + a) & 0xFF
            elif filt == 2: line[i] = (line[i] + b) & 0xFF
            elif filt == 3: line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif filt == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out.append(bytes(line))
        prev = line
    return w, h, bpp, out


def main():
    tmp = "/tmp/r2d_ui_text_panel"
    os.makedirs(tmp, exist_ok=True)
    shot = os.path.join(tmp, "shot.png")

    with open(os.path.join(tmp, "project.json"), "w", encoding="utf-8") as f:
        f.write('{"title": "UI текст поверх панели", "width": 320, "height": 200}')
    # Метка стоит РОВНО в центре панели: раньше её закрашивала подложка.
    with open(os.path.join(tmp, "main.js"), "w", encoding="utf-8") as f:
        f.write(
            "$.ready(() => {\n"
            "    $.world.gravity(0, 0).color('#000000').bounds(0, 0, 320, 200);\n"
            "    $('<ui.panel>', { id: 'back', x: 160, y: 100, w: 240, h: 90,\n"
            "                      color: '#ffffff' }).appendTo($.ui);\n"
            "    $('<ui.label>', { id: 'cap', x: 160, y: 100, text: 'ТЕКСТ',\n"
            "                      size: 28, color: '#ff0000', align: 'center' })\n"
            "        .appendTo($.ui);\n"
            "});\n")

    with Agent(game=tmp, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(4)
        a.cmd("screenshot", path=shot)

    w, h, bpp, rows = read_png(shot)
    print("  кадр %dx%d" % (w, h))

    # Панель белая, текст красный. Считаем красные и белые пиксели в её полосе.
    red = white = 0
    for y in range(int(h * 0.35), int(h * 0.65)):
        row = rows[y]
        for x in range(int(w * 0.3), int(w * 0.7)):
            r, g, b = row[x * bpp], row[x * bpp + 1], row[x * bpp + 2]
            if r > 150 and g < 90 and b < 90:
                red += 1
            elif r > 200 and g > 200 and b > 200:
                white += 1
    print("  красных пикселей (текст): %d, белых (панель): %d" % (red, white))

    check(white > 500, "панель нарисована")
    check(red > 40, "текст виден ПОВЕРХ панели (было 0)")

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
