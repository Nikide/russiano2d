#!/usr/bin/env python3
# ===========================================================================
# A4 отчёта BASHNYA (0.1.34): `.frame(i)` не обновлял `node.frame_index`.
#
# Их числа: после анимации листа и `.stopAnim(); .frame(0)` на экране кадр 0,
# а `frame_index` остаётся 3 (последний кадр анимации); `sprite` при этом 0.
# Поле двигали только дорожки `.animate()` (api.js: animateSprites) и дорожки
# animplayer'а, поэтому любое чтение `frame_index` (prefab §14, сохранение,
# DevTools) после ручной смены кадра врало.
#
# Тест проверяет не только поле, но и то, что оно совпадает с НАРИСОВАННЫМ
# кадром: лист — текстура 4x1 из четырёх чистых цветов, каждый кадр — свой
# спрайт, и пиксель кадра читается из скриншота.
#
# Сцена собирается из теста (отдельная фикстура не нужна):
#   textureFromPixels(4, 1) → 4 спрайта-кадра → узел #reel с .frames([...]).
#
# Запуск (после сборки):
#   python3 tests/agent/frame_index_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/frame_index_test.py
# ===========================================================================

import os
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "bare")
FAILURES = []

# Цвета кадров: R, G, B, Y — по одному на кадр листа 4x1.
FRAME_COLORS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


SETUP = """(() => {
    // Лист 4x1: четыре разных пикселя — четыре различимых кадра.
    const px = new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255]);
    const tex = engine.textureFromPixels(4, 1, px);
    const frames = [0, 1, 2, 3].map((i) => engine.createSprite(tex, i, 0, 1, 1));
    const reel = $('<sprite>', { id: 'reel' }).at(160, 120)
        .frames(frames).sprite(frames[0]).size(48, 48).appendTo($.world);
    globalThis.__reel = { tex, frames };
    return { tex, frames, sprite: reel.get(0).sprite, frame_index: reel.get(0).frame_index };
})()"""


# ---------------------------------------------------------------------------
# Разбор PNG — тот же, что в tests/agent/light_receiver_mask_test.py.
# ---------------------------------------------------------------------------
def read_png(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG: " + path)
    pos = 8
    width = height = channels = 0
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise ValueError("неподдерживаемый PNG")
            channels = 3 if color_type == 2 else 4
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    offset = 0
    for y in range(height):
        filt = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        if filt == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filt == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filt == 4:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                up = prev[i]
                upleft = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(up - upleft), abs(left - upleft), abs(left + up - 2 * upleft)
                pred = left if (pa <= pb and pa <= pc) else (up if pb <= pc else upleft)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, bytes(out)


def pixel(image, x, y, half=4):
    width, height, channels, data = image
    x = int(round(x))
    y = int(round(y))
    total = [0, 0, 0]
    count = 0
    for yy in range(max(0, y - half), min(height, y + half + 1)):
        row = yy * width
        for xx in range(max(0, x - half), min(width, x + half + 1)):
            o = (row + xx) * channels
            total[0] += data[o]
            total[1] += data[o + 1]
            total[2] += data[o + 2]
            count += 1
    return tuple(v / float(max(1, count)) for v in total)


def near(got, want, eps=8):
    return all(abs(got[i] - want[i]) <= eps for i in range(3))


def state(a):
    """Состояние кадра: что нарисовано, что записано и совпадают ли они."""
    return a.eval("(() => { const n = $('#reel').get(0);"
                  " return { sprite: n.sprite, frame_index: n.frame_index,"
                  " frames: n.frames.slice(),"
                  " index_of_sprite: n.frames.indexOf(n.sprite) }; })()")


def main():
    shots = tempfile.mkdtemp(prefix="r2d_frame_index_")
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(2)
        setup = a.eval(SETUP)
        a.step(2)
        frames = setup["frames"]

        check(len(frames) == 4 and len(set(frames)) == 4,
              "лист из четырёх различимых спрайтов-кадров: %s" % frames)
        st = state(a)
        check(st["sprite"] == frames[0] and st["frame_index"] == 0,
              "стартовое состояние: sprite=%s frame_index=%s" % (st["sprite"], st["frame_index"]))

        # --- Анимация доезжает до последнего кадра ------------------------------
        a.eval("$('#reel').animate({ from: 0, to: 3, speed: 20, loop: false }); 'ok'")
        a.step(20)
        st = state(a)
        check(st["frame_index"] == 3 and st["sprite"] == frames[3],
              "анимация остановилась на кадре 3: sprite=%s frame_index=%s"
              % (st["sprite"], st["frame_index"]))
        check(st["index_of_sprite"] == st["frame_index"],
              "после анимации frame_index совпадает с frames.indexOf(sprite) (%s == %s)"
              % (st["frame_index"], st["index_of_sprite"]))

        # --- Главный случай отчёта: .frame(0) после .stopAnim() -----------------
        a.eval("$('#reel').stopAnim(); $('#reel').frame(0); 'ok'")
        a.step(1)
        st = state(a)
        print("  --   после .stopAnim().frame(0): sprite=%s frame_index=%s (ждали 0 и 0)"
              % (st["sprite"], st["frame_index"]))
        check(st["sprite"] == frames[0], "показан кадр 0 (sprite=%s)" % st["sprite"])
        check(st["frame_index"] == 0,
              "frame_index обновился вместе с кадром (получено %s)" % st["frame_index"])
        check(st["frame_index"] == st["index_of_sprite"],
              "frame_index совпадает с frames.indexOf(sprite) (%s == %s)"
              % (st["frame_index"], st["index_of_sprite"]))

        # --- И нарисованный кадр — тот же, что в поле ---------------------------
        img = read_png(a.screenshot(os.path.join(shots, "frame0.png")))
        pos = a.eval("$('#reel').globalPos()")
        got = pixel(img, pos["x"], pos["y"])
        check(near(got, FRAME_COLORS[0]),
              "на экране кадр 0 (RGB %s ≈ %s)" % (tuple(round(v) for v in got), FRAME_COLORS[0]))

        a.eval("$('#reel').frame(2); 'ok'")
        a.step(1)
        st = state(a)
        check(st["sprite"] == frames[2] and st["frame_index"] == 2,
              "кадр 2: sprite=%s frame_index=%s" % (st["sprite"], st["frame_index"]))
        img = read_png(a.screenshot(os.path.join(shots, "frame2.png")))
        pos = a.eval("$('#reel').globalPos()")
        got = pixel(img, pos["x"], pos["y"])
        check(near(got, FRAME_COLORS[2]),
              "на экране кадр 2 (RGB %s ≈ %s)" % (tuple(round(v) for v in got), FRAME_COLORS[2]))
        check(st["frame_index"] == st["index_of_sprite"],
              "frame_index кадра 2 совпадает с frames.indexOf(sprite)")

        # --- Кадр вне листа ничего не ломает ------------------------------------
        a.eval("$('#reel').frame(99); 'ok'")
        a.step(1)
        after = state(a)
        check(after["sprite"] == frames[2] and after["frame_index"] == 2,
              "индекс вне листа не меняет ни спрайт, ни frame_index (sprite=%s frame_index=%s)"
              % (after["sprite"], after["frame_index"]))
        a.eval("$('#reel').frame(-1); 'ok'")
        a.step(1)
        after = state(a)
        check(after["sprite"] == frames[2] and after["frame_index"] == 2,
              "отрицательный индекс тоже ничего не меняет (frame_index=%s)" % after["frame_index"])

        # «Кадра не просили» — тоже ничего не меняет (null/undefined).
        a.eval("$('#reel').frame(null); $('#reel').frame(); 'ok'")
        a.step(1)
        after = state(a)
        check(after["sprite"] == frames[2] and after["frame_index"] == 2,
              "frame(null)/frame() не двигают ни спрайт, ни frame_index (frame_index=%s)"
              % after["frame_index"])

        # --- Префаб-снимок читает то же поле ------------------------------------
        snap = a.eval("(() => { const n = $('#reel').get(0);"
                      " return { frame_index: n.frame_index, sprite: n.sprite,"
                      " frames: n.frames.slice() }; })()")
        check(snap["frame_index"] == snap["frames"].index(snap["sprite"]),
              "публичное состояние согласовано: frame_index=%s, frames.indexOf(sprite)=%s"
              % (snap["frame_index"], snap["frames"].index(snap["sprite"])))

    print("  --   кадры прогона: %s" % shots)


if __name__ == "__main__":
    main()
    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")
    sys.exit(0)
