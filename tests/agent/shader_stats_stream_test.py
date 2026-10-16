#!/usr/bin/env python3
# ===========================================================================
# BASHNYA E10 + F3 (task-51): снятие шейдера, счётчики текстур, поток кадров.
#
# E10: `shader(null)`/`shader(false)` должны возвращать узел к обычной отрисовке
#      (раньше `false` уходил в «неизвестный эффект» и узел МОЛЧА оставался со
#      старым шейдером — выключить искажение из игры было нельзя).
# F3:  `$.gfx.stats()` должен отдавать числа текстур (включая загруженные
#      спрайтами ПО ПУТИ), а поток кадров «текущий + следующий» — освобождать
#      предыдущие: 17 кадров 1920×1080 иначе держат ~141 МБ.
#
# Запуск:
#   python3 tests/agent/shader_stats_stream_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/shader_stats_stream_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("demos", "litsprites")
STREAM = os.path.join(ROOT, "build", "stream")
FRAMES = 17
KEEP = 2                      # «текущий + следующий»
W, H = 1920, 1080
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
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(kind, data):
        body = struct.pack(">I", len(data)) + kind + data
        return body + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n"
                     + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 1))
                     + chunk(b"IEND", b""))


def main():
    os.makedirs(STREAM, exist_ok=True)
    for i in range(FRAMES):
        write_png(os.path.join(STREAM, "f%02d.png" % i), W, H, (40 + i, 70, 110))

    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(5)

        # --- E10: снятие шейдера -------------------------------------------
        a.eval("$('<sprite>', { id: 'bg', src: 'assets/sign.png' }).size(64, 64).at(300, 300).appendTo($.world); 1")
        a.step(2)
        check(a.eval("$('#bg').shader()") == "none", "узел без эффекта: 'none'")
        a.eval("$('#bg').shader('wave', { amplitude: 0.05, frequency: 30 })")
        a.step(2)
        check(a.eval("$('#bg').shader()") == "wave", "эффект поставлен: %s" % a.eval("$('#bg').shader()"))
        a.eval("$('#bg').shader(null)")
        a.step(2)
        cleared = a.eval("$('#bg').shader()")
        number("shader(null) → %s" % cleared)
        check(cleared == "none", "shader(null) снимает эффект: %s" % cleared)
        a.eval("$('#bg').shader('wave')")
        a.step(1)
        a.eval("$('#bg').shader(false)")
        a.step(2)
        via_false = a.eval("$('#bg').shader()")
        number("shader(false) → %s" % via_false)
        check(via_false == "none", "shader(false) тоже снимает эффект (E10): %s" % via_false)
        a.eval("$('#bg').shader('chroma', { offset: 0.006 })")
        a.step(2)
        again = a.eval("$('#bg').shader()")
        check(again == "chroma", "после сброса эффект снова включается: %s" % again)
        # Пустая выборка не молчит: без узла эффект не «поставлен в никуда».
        quiet = a.eval("$('#нет-такого').shader('wave')")
        check(quiet is not None, "вызов на пустой выборке не падает")

        # --- F3: числа текстур видны игре ----------------------------------
        stats = a.eval("$.gfx.stats()")
        number("stats до потока: textures=%s, texture_bytes=%s, texture_mb=%s"
               % (stats.get("textures"), stats.get("texture_bytes"), stats.get("texture_mb")))
        check(isinstance(stats.get("textures"), int) and stats["textures"] > 0,
              "textures — число, а не null: %s" % stats.get("textures"))
        check(isinstance(stats.get("texture_bytes"), int) and stats["texture_bytes"] > 0,
              "texture_bytes — число: %s" % stats.get("texture_bytes"))
        base_mb = float(stats.get("texture_mb") or 0)

        # --- F3: поток кадров «текущий + следующий» ------------------------
        stream_dir = STREAM.replace("\\", "/")
        returned = 0.0
        for i in range(FRAMES):
            a.eval("""(() => {
                const old = $('#frame');
                if (old.length) old.remove();
                $('<sprite>', { id: 'frame', src: '%s/f%02d.png' })
                    .size(320, 180).at(300, 300).appendTo($.world);
                return 1;
            })()""" % (stream_dir, i))
            a.step(1)
            if i >= KEEP:
                res = a.eval("$.resource.freeTexture('%s/f%02d.png')" % (stream_dir, i - KEEP))
                if res.get("ok"):
                    returned += float(res.get("freed") or 0)
                else:
                    number("кадр f%02d не освободился: %s" % (i - KEEP, res.get("error")))
        alive = [t for t in a.eval("$.resource.textures()") if "stream" in t["path"]]
        after = a.eval("$.gfx.stats()")
        per_frame = W * H * 4 / (1024 * 1024)
        number("кадр %dx%d = %g МБ; без выгрузки %d кадров дали бы %.1f МБ"
               % (W, H, per_frame, FRAMES, per_frame * FRAMES))
        number("живых кадров потока после %d итераций: %s"
               % (FRAMES, [(t["path"].split("/")[-1], "%g МБ" % t["mb"]) for t in alive]))
        number("вернулось при выгрузке: %.1f МБ" % returned)
        number("stats после потока: textures=%s, texture_mb=%s (было %s)"
               % (after.get("textures"), after.get("texture_mb"), base_mb))
        check(len(alive) == KEEP, "живыми остались «текущий + следующий»: %d" % len(alive))
        check(returned >= per_frame * (FRAMES - KEEP) - 0.5,
              "вернулось не меньше %.1f МБ: %.1f МБ" % (per_frame * (FRAMES - KEEP) - 0.5, returned))
        check(float(after.get("texture_mb") or 0) < per_frame * (KEEP + 1) + base_mb + 0.5,
              "память текстур осталась в пределах %d кадров: %s МБ"
              % (KEEP, after.get("texture_mb")))
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
