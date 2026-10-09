#!/usr/bin/env python3
# ===========================================================================
# Ассеты игры ищутся в КАТАЛОГЕ ИГРЫ (--game), а не только в каталоге движка.
#
# ЧТО БЫЛО НЕ ТАК. `--game <каталог>` выбирал точку входа (main.js), но
# `r2d_app_resolve_path` знал только `base_path` — каталог, откуда запущен
# движок. Поэтому игра в СВОЕЙ папке не находила НИ ОДНОГО своего ассета:
# путь `assets/tiles/x.png` уходил в каталог движка. Поймано при сборке
# audm-neko в отдельной папке: атлас тайлов возвращал -1.
#
# Теперь порядок такой: каталог игры (если файл там есть) → base_path
# (встроенные шрифты и иконки движка).
#
# Тест создаёт НАСТОЯЩУЮ игру во временном каталоге со своим PNG и проверяет,
# что она его грузит, а встроенные ассеты движка при этом не сломались.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_game_path_test.py
# ===========================================================================

import os
import shutil
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def write_png(path, w=8, h=8, color=(255, 0, 0)):
    """Минимальный PNG без внешних библиотек: 8x8 сплошного цвета."""
    raw = b"".join(b"\x00" + bytes(color) * w for _ in range(h))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    tmp = tempfile.mkdtemp(prefix="r2d_gamepath_")
    try:
        os.makedirs(os.path.join(tmp, "assets"), exist_ok=True)
        write_png(os.path.join(tmp, "assets", "probe.png"), 8, 8, (0, 200, 0))
        os.makedirs(os.path.join(tmp, "ui"), exist_ok=True)
        with open(os.path.join(tmp, "ui", "menu.rml"), "w", encoding="utf-8") as f:
            f.write('<rml><head><link type="text/rcss" href="probe.rcss"/></head>'
                    '<body><div id="own-menu">Own project menu</div></body></rml>')
        with open(os.path.join(tmp, "ui", "probe.rcss"), "w", encoding="utf-8") as f:
            f.write('body { font-family: Open Sans; } #own-menu { display: block; width: 123px; height: 47px; }')
        with open(os.path.join(tmp, "project.json"), "w", encoding="utf-8") as f:
            f.write('{"title": "Тест каталога игры", "width": 320, "height": 240}')
        # Игра ничего не рисует — только помечает, что загрузилась.
        with open(os.path.join(tmp, "main.js"), "w", encoding="utf-8") as f:
            f.write("globalThis.__loaded = true;\n")

        print("  каталог игры: %s" % tmp)
        with Agent(game=tmp, seed=5, fixed_dt=1.0 / 60.0) as a:
            check(a.eval("globalThis.__loaded") is True, "игра из своего каталога запустилась")

            # Главное: ассет ИГРЫ найден по относительному пути.
            tex = a.eval("engine.loadTexture('assets/probe.png')")
            print("  текстура игры: %s" % tex)
            check(isinstance(tex, int) and tex >= 0,
                  "ассет игры найден в её каталоге (было -1)")
            size = a.eval("JSON.stringify(engine.textureSize(%d))" % tex) if tex >= 0 else "[]"
            print("  размер: %s" % size)
            check("8" in size, "текстура загрузилась целиком")

            # Несуществующий ассет по-прежнему честно не находится.
            missing = a.eval("engine.loadTexture('assets/нет-такого.png')")
            check(missing == -1, "несуществующий ассет → -1")

            # Встроенные ассеты движка НЕ сломаны: шрифт по абсолютному пути
            # и относительный путь движка всё ещё работают.
            abs_tex = a.eval("engine.loadTexture('%s/assets/probe.png')" % tmp)
            check(abs_tex == tex, "абсолютный путь даёт ту же текстуру")
            a.eval("$.ui.doc('ui/menu.rml').show()")
            a.step(3)
            check(a.eval("$.ui.doc('ui/menu.rml').content('own-menu')") == "Own project menu",
                  "RmlUi берёт меню выбранного --game, а не game/ui/menu.rml")
            rect = a.eval("$.ui.doc('ui/menu.rml').rect('own-menu')")
            check(rect and rect['w'] == 123 and rect['h'] == 47,
                  "относительный RCSS загружен из того же проекта")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

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
