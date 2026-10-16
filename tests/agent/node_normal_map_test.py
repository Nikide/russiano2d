#!/usr/bin/env python3
# ===========================================================================
# Приёмка §20.2: материалы спрайтов, объявленный fallback нормалей и проверка
# изображениями/числами (свет слева/справа, ориентация узла, trimmed атлас,
# тень за движущимся occluder).
#
# ВАЖНО про выбранный путь. Попиксельного света по normal-карте в конвейере нет
# (измерение — в docs/highlevel/render.md §4.7): у спрайтовой фрагментной стадии
# один сэмплер и нет доступа к свету, а вершинная стадия не несёт ни нормали, ни
# мировой позиции. Поэтому §20.2 закрыт ОБЪЯВЛЕННЫМ fallback: материал с
# normal-картой рисуется нейтральной нормой, картинка совпадает с базовым
# материалом, а `$.gfx.perPixelNormal(true)` возвращает `false` и сообщает
# фактическую причину. Тест проверяет именно это, а не воображаемый PBR.
#
# Камера фикстуры стоит в центре кадра с зумом 1: мир == экран.
#
# Запуск:
#   python3 tests/agent/node_normal_map_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/node_normal_map_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "normal_map")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


# --- Чтение PNG без зависимостей (приём из highlevel_light_limits_test) ------

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


def luma(image, lx, ly, half=8):
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


def pixel(image, x, y):
    width, height, channels, data = image
    o = (y * width + x) * channels
    return data[o], data[o + 1], data[o + 2]


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(6)

        def shot(name):
            path = os.path.join(shots, name)
            a.screenshot(path)
            return read_png(path)

        def show(*visible):
            for sel in ("mat_base", "mat_flat", "mat_normal",
                        "pose_plain", "pose_flip", "pose_rot", "trim_off", "trim_on"):
                a.eval("$('#%s').%s()" % (sel, "show" if sel in visible else "hide"))
            a.step(3)

        # --- Объявленный fallback: контракт, а не догадка ---------------------
        check(a.eval("$.gfx.perPixelNormal()") is False,
              "по умолчанию попиксельный свет выключен")
        info = a.eval("$.gfx.normalPath()")
        check(isinstance(info, dict) and info.get("supported") is False
              and info.get("fallback") == "flat_normal"
              and isinstance(info.get("required"), list) and info["required"],
              "normalPath() отдаёт факты: %s" % info)
        check(a.eval("$.gfx.perPixelNormal(true)") is False,
              "запрос расширенного режима возвращает false, а не обещание")
        check(a.eval("$.gfx.material('convex_n').perPixelNormal") is False,
              "у материала с normal-картой perPixelNormal === false")
        check(a.eval("$.gfx.flatNormal()") == [0.5, 0.5, 1], "flat normal — нейтраль")
        _ = shot("node_normal_map_fallback.png")

        # --- Свет слева/справа: однородное поле и выпуклый спрайт -------------
        # Поле меряется с СКРЫТЫМ выпуклым спрайтом (он лежит в той же точке и
        # перекрыл бы замер), спрайт — со скрытым полем.
        a.eval("$('#field').show(); $('#convex').hide(); 'ok'")
        a.eval("void $('#lamp').at(420, 220); 'ok'")
        a.step(4)
        img = shot("node_normal_map_lamp_left.png")
        field_l = luma(img, 590, 220)
        field_r = luma(img, 690, 220)
        a.eval("void $('#lamp').at(860, 220); 'ok'")
        a.step(4)
        img = shot("node_normal_map_lamp_right.png")
        field_l2 = luma(img, 590, 220)
        field_r2 = luma(img, 690, 220)
        print("  --   поле: лампа слева L=%.1f R=%.1f; лампа справа L=%.1f R=%.1f"
              % (field_l, field_r, field_l2, field_r2))
        check(field_l > field_r + 15,
              "лампа слева: левая половина ярче (%.1f > %.1f)" % (field_l, field_r))
        check(field_r2 > field_l2 + 15,
              "лампа справа: правая половина ярче (%.1f > %.1f)" % (field_r2, field_l2))
        check(abs((field_l - field_r) + (field_l2 - field_r2)) < 4,
              "градиент поля зеркален: %+.1f против %+.1f"
              % (field_l - field_r, field_r2 - field_l2))

        # Выпуклый спрайт: у него запечён блик слева, поэтому «левее-правее» не
        # обнуляется, но баланс обязан сдвинуться вслед за источником.
        a.eval("$('#field').hide(); $('#convex').show(); 'ok'")
        a.eval("void $('#lamp').at(420, 220); 'ok'")
        a.step(4)
        img = shot("node_normal_map_convex_left.png")
        convex_left = luma(img, 590, 220) - luma(img, 690, 220)
        a.eval("void $('#lamp').at(860, 220); 'ok'")
        a.step(4)
        img = shot("node_normal_map_convex_right.png")
        convex_right = luma(img, 590, 220) - luma(img, 690, 220)
        print("  --   выпуклый спрайт: баланс слева-минус-справа %+.1f (лампа слева) → %+.1f (справа)"
              % (convex_left, convex_right))
        check(convex_left - convex_right > 30,
              "свет всё равно идёт со стороны источника (сдвиг баланса %.1f)"
              % (convex_left - convex_right))
        a.eval("$('#convex').hide(); void $('#lamp').at(420, 220); 'ok'")
        a.step(4)

        # --- Материалы: base == flat == normal при объявленном fallback -------
        points = ((640, 480), (620, 470), (660, 500))
        samples = {}
        for sel in ("mat_base", "mat_flat", "mat_normal"):
            show(sel)
            img = shot("node_normal_map_%s.png" % sel)
            samples[sel] = [pixel(img, x, y) for x, y in points]
        print("  --   материал: base=%s flat=%s normal=%s"
              % (samples["mat_base"][0], samples["mat_flat"][0], samples["mat_normal"][0]))
        check(samples["mat_base"] == samples["mat_flat"] == samples["mat_normal"],
              "normal-карта не меняет пиксели: материал совпадает с базовым")

        # --- Ориентация узла: свет зависит от мировой позиции, не от поворота --
        poses = {}
        for sel in ("pose_plain", "pose_flip", "pose_rot"):
            show(sel)
            img = shot("node_normal_map_%s.png" % sel)
            poses[sel] = [round(luma(img, x, 220), 2) for x in (905, 950, 995)]
        print("  --   ориентация: как есть=%s flip=%s rotate=%s"
              % (poses["pose_plain"], poses["pose_flip"], poses["pose_rot"]))
        check(poses["pose_plain"] == poses["pose_flip"],
              "flip при той же позиции не меняет освещённость (fallback)")
        check(poses["pose_plain"] == poses["pose_rot"],
              "поворот при той же позиции не меняет освещённость (fallback)")

        # --- Trimmed атлас не смещает ни арт, ни свет -------------------------
        trim = {}
        for sel in ("trim_off", "trim_on"):
            show(sel)
            img = shot("node_normal_map_%s.png" % sel)
            trim[sel] = [pixel(img, x, 620) for x in (620, 640, 660)]
        print("  --   trim: без trim=%s, trimmed=%s" % (trim["trim_off"][1], trim["trim_on"][1]))
        check(a.eval("$.atlas.get('trim').info('trim').trimmed") is True,
              "кадр помечен trimmed")
        check(a.eval("$.atlas.get('trim').info('trim').x") == 4,
              "trim учтён: кадр 8×8 на смещении (4, 4)")
        check(trim["trim_off"] == trim["trim_on"],
              "trimmed и обычный кадр дают одинаковые пиксели при одной позиции")

        # --- Тень следует за движущимся occluder ------------------------------
        a.eval("void $('#shadow_crate').at(1120, 360); 'ok'")
        a.step(4)
        img = shot("node_normal_map_shadow_between.png")
        between = luma(img, 1120, 420)
        a.eval("void $('#shadow_crate').at(1120, 120); 'ok'")
        a.step(4)
        img = shot("node_normal_map_shadow_away.png")
        away = luma(img, 1120, 420)
        a.eval("void $('#shadow_crate').at(1120, 360); 'ok'")
        a.step(4)
        a.eval("$('#shadow_crate').hide(); 'ok'")
        a.step(4)
        img = shot("node_normal_map_shadow_hidden.png")
        hidden = luma(img, 1120, 420)
        print("  --   тень: между=%.1f, ушёл=%.1f, скрыт=%.1f" % (between, away, hidden))
        check(between < away * 0.5, "occluder между источником и целью гасит свет (%.1f < %.1f)"
              % (between, away))
        check(hidden > between * 1.5, "скрытый occluder света не заслоняет (%.1f)" % hidden)

        errors = [line for line in a.stderr_text().splitlines()
                  if "$: ошибка" in line or "[error]" in line]
        check(not errors, "в фикстуре нет ошибок игрового кода: %s" % errors[:2])

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
