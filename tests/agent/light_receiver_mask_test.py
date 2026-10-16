#!/usr/bin/env python3
# ===========================================================================
# Приёмка §20.1: маска ПОЛУЧАТЕЛЯ света и слои источников.
#
# Проверяется числами из скриншота (фикстура tests/fixtures/light_mask, сцена
# `accept`): два СООСНЫХ источника одинаковой силы и цвета с разными слоями и
# два получателя на равном расстоянии с разными масками. Всё различие между
# получателями — только биты маски, поэтому яркость читается как факт.
#
#   * узел с `.lightMask(1)` ярче под источником слоя 1 и НЕ ярче под слоем 2;
#   * наоборот — тоже;
#   * узел без маски получает оба источника (прежнее поведение);
#   * `.lit(false)` вне света и при включённой световой карте;
#   * тень/occluder не сломаны;
#   * путь масок объявлен: `$.gfx.light.maskPath()`, а без световой карты
#     работает fallback «свет получают все»;
#   * без масок в кадре цена прежняя: проходов маски ноль.
#
# Запуск:
#   python3 tests/agent/light_receiver_mask_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/light_receiver_mask_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "light_mask")
FAILURES = []

# Точки замера (камера фикстуры: мир == экран).
RECV_1 = (530, 420)     # получатель под левым источником
RECV_2 = (750, 420)     # получатель под правым источником
PLAIN = (640, 420)      # узел без маски
UNLIT = (480, 240)      # `.lit(false)` внутри радиуса источника
SHADOW = (300, 420)     # цель под движущимся occluder


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


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


def luma(image, lx, ly, half=10):
    width, height, channels, data = image
    total = 0
    count = 0
    for y in range(max(0, ly - half), min(height, ly + half)):
        row = y * width
        for x in range(max(0, lx - half), min(width, lx + half)):
            o = (row + x) * channels
            total += data[o] + data[o + 1] + data[o + 2]
            count += 3
    return total / float(max(1, count))


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, scene="accept", seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(10)

        def shot(name):
            path = os.path.join(shots, name)
            a.screenshot(path)
            return read_png(path)

        def lumas(name):
            img = shot(name)
            return (luma(img, *RECV_1), luma(img, *RECV_2), luma(img, *PLAIN),
                    luma(img, *UNLIT), luma(img, *SHADOW))

        # --- API масок и слоёв ----------------------------------------------
        check(a.eval("$.gfx.light.layer()") == 0xFFFFFFFF,
              "слой источников по умолчанию — все биты")
        check(a.eval("$('#recv_1').lightMask()") == 0xFFFFFFFF,
              "без объявленной маски узел принимает все слои")
        path = a.eval("$.gfx.light.maskPath()")
        check(isinstance(path, dict) and path.get("supported") is True
              and path.get("fallback") == "all_receivers",
              "maskPath() объявляет путь и fallback: %s" % (path,))
        # Маски ещё не объявлены: прохода маски в кадре быть не должно.
        a.step(2)
        check(a.eval("$.gfx.light.stats().maskPasses") == 0,
              "без масок проход маски не выполняется (цена прежняя)")

        # --- Базовая линия: без масок оба получателя освещены одинаково ------
        base = lumas("light_mask_before.png")
        print("  --   без масок: recv_1=%.1f recv_2=%.1f plain=%.1f unlit=%.1f shadow=%.1f" % base)
        check(abs(base[0] - base[1]) < 2.0,
              "соосные источники освещают получателей одинаково (%.1f ≈ %.1f)" % (base[0], base[1]))
        check(base[2] > base[0] + 20,
              "узел без маски получает оба источника и ярче (%.1f > %.1f)" % (base[2], base[0]))

        # --- Маски и слои ----------------------------------------------------
        a.eval("$('#lamp_1').lightLayer(1); $('#lamp_2').lightLayer(2);"
               " $('#recv_1').lightMask(1); $('#recv_2').lightMask(2); 'ok'")
        a.step(4)
        check(a.eval("$('#recv_1').lightMask()") == 1 and a.eval("$('#lamp_1').lightLayer()") == 1,
              "маска получателя и слой источника читаются назад")
        a.step(2)
        check(a.eval("$.gfx.light.stats().maskPasses") == 1
              and a.eval("$.gfx.light.stats().maskNodes") == 2,
              "проход маски выполняется, узлов с маской — 2 (%s)"
              % a.eval("$.gfx.light.stats()"))

        both = lumas("light_mask_both.png")
        print("  --   оба слоя: recv_1=%.1f recv_2=%.1f plain=%.1f unlit=%.1f shadow=%.1f" % both)
        check(abs(both[0] - both[1]) < 2.0,
              "под обоими слоями получатели равны (%.1f ≈ %.1f)" % (both[0], both[1]))
        check(abs(both[2] - base[2]) < 2.0,
              "узел без маски не изменился (%.1f ≈ %.1f)" % (both[2], base[2]))
        check(abs(both[3] - base[3]) < 1.0,
              ".lit(false) по-прежнему вне света (%.1f ≈ %.1f)" % (both[3], base[3]))
        check(abs(both[4] - base[4]) < 3.0,
              "тень под occluder не сломана (%.1f ≈ %.1f)" % (both[4], base[4]))

        # Только источник слоя 1: свет получает лишь получатель слоя 1.
        a.eval("$('#lamp_2').hide(); 'ok'")
        a.step(4)
        only1 = lumas("light_mask_only_layer1.png")
        print("  --   только слой 1: recv_1=%.1f recv_2=%.1f plain=%.1f unlit=%.1f shadow=%.1f" % only1)
        check(only1[0] > only1[1] + 20,
              "узел слоя 1 ярче под источником слоя 1 (%.1f > %.1f)" % (only1[0], only1[1]))
        check(abs(only1[1] - both[3]) < 4.0,
              "узел слоя 2 под источником слоя 1 не освещён (%.1f ≈ %.1f тёмного)" % (only1[1], both[3]))
        check(only1[2] > only1[1] + 20,
              "узел без маски получает свет слоя 1 (%.1f > %.1f)" % (only1[2], only1[1]))

        # Только источник слоя 2: ровно наоборот.
        a.eval("$('#lamp_2').show(); $('#lamp_1').hide(); 'ok'")
        a.step(4)
        only2 = lumas("light_mask_only_layer2.png")
        print("  --   только слой 2: recv_1=%.1f recv_2=%.1f plain=%.1f unlit=%.1f shadow=%.1f" % only2)
        check(only2[1] > only2[0] + 20,
              "узел слоя 2 ярче под источником слоя 2 (%.1f > %.1f)" % (only2[1], only2[0]))
        check(abs(only2[0] - both[3]) < 4.0,
              "узел слоя 1 под источником слоя 2 не освещён (%.1f)" % only2[0])

        # Обмен масками меняет картину на противоположную.
        a.eval("$('#recv_1').lightMask(2); $('#recv_2').lightMask(1); 'ok'")
        a.step(4)
        swapped = lumas("light_mask_swapped.png")
        print("  --   маски обменяны, слой 2: recv_1=%.1f recv_2=%.1f" % swapped[:2])
        # После обмена масками у recv_1 биты 2, у recv_2 биты 1, а светит слой 2:
        # ярким обязан быть ИМЕННО recv_1.
        check(swapped[0] > swapped[1] + 20,
              "обмен масками переворачивает картину (%.1f > %.1f)" % (swapped[0], swapped[1]))

        # --- Fallback: без световой карты свет получают все -------------------
        a.eval("$('#lamp_1').show(); $.gfx.light.map({ on: false }); 'ok'")
        a.step(4)
        fallback = a.eval("$.gfx.light.maskPath()")
        check(fallback.get("supported") is False
              and fallback.get("reason") == "light_drawn_into_scene",
              "без световой карты путь масок объявлен недоступным: %s" % (fallback,))
        fb = lumas("light_mask_fallback.png")
        print("  --   fallback (карта света выключена): recv_1=%.1f recv_2=%.1f" % fb[:2])
        check(abs(fb[0] - fb[1]) < 3.0,
              "fallback: свет получают все, как до появления масок (%.1f ≈ %.1f)" % (fb[0], fb[1]))
        a.eval("$.gfx.light.map({ on: true }); 'ok'")
        a.step(4)

        # --- Тень за движущимся occluder при включённых масках ---------------
        a.eval("void $('#shadow_crate').at(300, 120); 'ok'")
        a.step(4)
        away = lumas("light_mask_shadow_away.png")
        print("  --   occluder ушёл: shadow=%.1f (между было %.1f)" % (away[4], both[4]))
        check(away[4] > both[4] + 20,
              "тень следует за occluder и при масках (%.1f → %.1f)" % (both[4], away[4]))

        errors = [line for line in a.stderr_text().splitlines()
                  if "$: ошибка" in line or "[error]" in line]
        check(not errors, "в фикстуре нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
