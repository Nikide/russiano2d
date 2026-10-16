#!/usr/bin/env python3
# ===========================================================================
# BASHNYA E6: освобождение текстур, загруженных спрайтами ПО ПУТИ (task-45).
#
# Проблема из отчёта: `$.resource.free(path)` работал только с ИМЕНОВАННЫМИ
# ресурсами, а узлы грузят текстуры по пути напрямую. Потоковая анимация
# (много крупных кадров по очереди) копила GPU-память: у BASHNYA 64 оверлея
# 1672×941 = 402 МБ, `free` по пути отвечал «такого ресурса нет».
#
# Проверяется ЧИСЛАМИ (текстуры/МБ из `engine.renderInfo()` и
# `$.resource.textures()`):
#   * занятая живым узлом текстура НЕ выгружается (отказ с числом users);
#   * после удаления узлов освобождается и память реально возвращается;
#   * повторная загрузка того же пути работает (кэш JS не держит мёртвый id);
#   * освобождение несуществующего пути отвечает внятной причиной.
#
# Запуск:
#   python3 tests/agent/resource_free_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/resource_free_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
DIR = os.path.join(ROOT, "build", "res_free")
COUNT = 4
SIZE = 1024
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


def write_png(path, w, h, rgb):
    """PNG без зависимостей: zlib + несжатые строки с фильтром 0."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(kind, data):
        body = struct.pack(">I", len(data)) + kind + data
        return body + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def mb(pixels):
    return pixels * 4 / (1024 * 1024)


def main():
    os.makedirs(DIR, exist_ok=True)
    for i in range(COUNT):
        write_png(os.path.join(DIR, "ov%d.png" % i), SIZE, SIZE, (30 + i * 40, 60, 90))

    with Agent(game=GAME, seed=5) as a:
        a.step(5)
        base = a.eval("engine.renderInfo()['textures']")
        number("до загрузки: текстур %d, %.1f МБ" % (base["count"], mb(base["pixels"])))

        check(a.eval("typeof $.resource.freeTexture") == "function",
              "$.resource.freeTexture(path) есть")
        check(a.eval("typeof $.resource.textures") == "function",
              "$.resource.textures() есть")

        # --- Загружаем оверлеи СПРАЙТАМИ ПО ПУТИ (сценарий BASHNYA) ---------
        a.eval("""(() => {
            for (let i = 0; i < %d; ++i) {
                $('<sprite>', { id: 'ov' + i, src: '%s/ov' + i + '.png' })
                    .size(64, 64).at(120 + i * 90, 120).appendTo($.world);
            }
            return 1;
        })()""" % (COUNT, DIR.replace("\\", "/")))
        a.step(3)
        loaded = a.eval("engine.renderInfo()['textures']")
        mine = [t for t in a.eval("$.resource.textures()") if "res_free" in t["path"]]
        number("после загрузки: текстур %d, %.1f МБ (вернулось бы %.1f МБ)"
               % (loaded["count"], mb(loaded["pixels"]), mb(loaded["pixels"] - base["pixels"])))
        number("наши текстуры: %s"
               % [(t["path"].split("/")[-1], "%g МБ" % t["mb"], "users=%d" % t["users"]) for t in mine])
        check(len(mine) == COUNT, "загрузилось %d текстур по путям" % len(mine))
        check(loaded["pixels"] - base["pixels"] == COUNT * SIZE * SIZE,
              "память выросла ровно на кадры: %d px" % (loaded["pixels"] - base["pixels"]))
        check(all(t["users"] >= 1 for t in mine), "узлы держат текстуры (users >= 1)")

        # --- ЗАНЯТУЮ текстуру не выгружаем ---------------------------------
        busy = a.eval("$.resource.freeTexture('%s/ov0.png')" % DIR.replace("\\", "/"))
        number("freeTexture занятой: %s" % busy)
        check(busy.get("ok") is False and busy.get("busy") is True,
              "занятая текстура не выгружена: %s" % busy.get("error"))
        check(busy.get("users") == 1, "в отказе названо число пользователей: %s" % busy.get("users"))
        still = a.eval("engine.renderInfo()['textures']")
        check(still["pixels"] == loaded["pixels"],
              "память не изменилась после отказа: %d px" % still["pixels"])
        check(a.eval("$('#ov0').length") == 1, "узел на месте — его не «убрали» выгрузкой")

        # --- Убираем узлы → текстуры больше никто не держит ----------------
        a.eval("(() => { for (let i = 0; i < %d; ++i) $('#ov' + i).remove(); return 1; })()" % COUNT)
        a.step(2)
        freed_total = 0.0
        answers = []
        for i in range(COUNT):
            res = a.eval("$.resource.freeTexture('%s/ov%d.png')" % (DIR.replace("\\", "/"), i))
            answers.append(res)
            freed_total += float(res.get("freed") or 0)
        after = a.eval("engine.renderInfo()['textures']")
        number("освобождение по одному: %s" % [round(float(r.get("freed") or 0), 2) for r in answers])
        number("итог: текстур %d, %.1f МБ (перед загрузкой было %.1f МБ)"
               % (after["count"], mb(after["pixels"]), mb(base["pixels"])))
        check(all(r.get("ok") for r in answers), "все вызовы освободили: %s" % [r.get("ok") for r in answers])
        check(abs(freed_total - COUNT * SIZE * SIZE * 4 / (1024 * 1024)) < 0.01,
              "вернулось ровно %.1f МБ" % freed_total)
        check(after["pixels"] == base["pixels"],
              "память вернулась к исходной: %d px против %d" % (after["pixels"], base["pixels"]))
        check(a.eval("$.resource.textures().filter(t => t.path.indexOf('res_free') >= 0).length") == 0,
              "в списке текстур путей больше нет")

        # --- Повторная загрузка того же пути -------------------------------
        again = a.eval("engine.loadTexture('%s/ov0.png')" % DIR.replace("\\", "/"))
        check(isinstance(again, int) and again >= 0, "повторная загрузка того же пути работает: id=%s" % again)
        node = a.eval("""(() => {
            $('<sprite>', { id: 'ov_again', src: '%s/ov0.png' }).size(32, 32).at(400, 300).appendTo($.world);
            return 1;
        })()""" % DIR.replace("\\", "/"))
        a.step(2)
        check(a.eval("$('#ov_again').length") == 1, "узел с тем же путём снова создался (кэш не мёртвый)")
        again_free = a.eval("$.resource.freeTexture('%s/ov0.png')" % DIR.replace("\\", "/"))
        check(again_free.get("busy") is True, "и снова занятую не выгружаем: %s" % again_free.get("error"))
        a.eval("$('#ov_again').remove(); 1")
        a.step(2)
        final = a.eval("$.resource.freeTexture('%s/ov0.png')" % DIR.replace("\\", "/"))
        check(final.get("ok") is True, "после уборки узла выгрузилось: %s МБ" % round(float(final.get("freed") or 0), 2))

        # --- Несуществующий путь отвечает причиной --------------------------
        missing = a.eval("$.resource.freeTexture('assets/нет-такого.png')")
        number("freeTexture несуществующего: %s" % missing)
        check(missing.get("ok") is False and missing.get("error"),
              "внятная причина вместо тишины: %s" % missing.get("error"))

        check(a.ping().get("pong") is True, "движок отвечает")

    print()
    for line in NUMBERS:
        print("  --   " + line)
    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
