#!/usr/bin/env python3
# ===========================================================================
# §40.3: контракт сортировки презентации.
#
# Порядок отрисовки — часть контракта движка, а не «как получилось»:
#
#   1. слой (layer) — по возрастанию;
#   2. внутри слоя — глубина (depth, с учётом depth_relative у родителей) или
#      Y при $.world.sort('y') — по возрастанию (нижний/больший depth позже,
#      то есть поверх);
#   3. при полном равенстве ключей — uid, то есть порядок создания;
#   4. узлы интерфейса рисуются поверх мира и в мировую сортировку не входят.
#
# Проверяется ПО ПИКСЕЛЯМ реального кадра: в точке пересечения цвет принадлежит
# тому, кто нарисован позже. Отдельно проверяется, что порядок не зависит от
# порядка создания (когда он задан слоем/глубиной), что он воспроизводим кадр
# в кадр и что смена слоя/глубины не меняет физику.
#
# Запуск (после сборки):
#   python3 tests/agent/sort_contract_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "render_presentation")
FAILURES = []

RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def read_png(path):
    """PNG → (w, h, channels, bytes). Только 8 бит, без интерлейса."""
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


def pixel(image, x, y):
    width, height, channels, data = image
    x = max(0, min(width - 1, int(x)))
    y = max(0, min(height - 1, int(y)))
    o = (y * width + x) * channels
    return (data[o], data[o + 1], data[o + 2])


def near(got, want, tol=8):
    return all(abs(got[i] - want[i]) <= tol for i in range(3))


def main():
    shots = os.path.join(ROOT, "build")

    def shot(a, name):
        path = os.path.join(shots, name)
        a.screenshot(path)
        return path, read_png(path)

    with Agent(game=GAME, seed=5) as a:
        a.step(3)

        # Эталонные сцены фикстуры прячем: дальше строим свои узлы.
        a.eval("presentationScene('single'); $('#s_a').hide(); $('#s_b').hide(); $('#s_c').hide();"
               "$.world.sort('layer'); 'ok'")

        def rect(rid, color, layer, depth, x=400, y=300):
            return ("$('<rect>', { id: '%s', x: %s, y: %s, w: 200, h: 200, color: '%s' })"
                    ".layer(%s).depth(%s).appendTo($.world);"
                    % (rid, x, y, color, layer, depth))

        # --- 1. Слой решает, независимо от порядка создания ------------------
        a.eval(rect("s_hi", "#ff0000", 5, 0) + rect("s_lo", "#00ff00", 1, 0))
        a.step(2)
        _, img = shot(a, "sort_layer_1.png")
        top = pixel(img, 400, 300)
        check(near(top, RED), "больший layer поверх меньшего, хотя создан первым: %s" % (top,))

        # Меняем только слои местами — картинка обязана перевернуться.
        a.eval("$('#s_hi').layer(1); $('#s_lo').layer(5)")
        a.step(2)
        _, img = shot(a, "sort_layer_2.png")
        top = pixel(img, 400, 300)
        check(near(top, GREEN), "смена слоёв меняет порядок: %s" % (top,))

        # Тот же результат при обратном порядке создания: порядок задаёт слой.
        a.eval("$('#s_hi').remove(); $('#s_lo').remove();"
               + rect("s_lo", "#00ff00", 1, 0) + rect("s_hi", "#ff0000", 5, 0))
        a.step(2)
        _, img = shot(a, "sort_layer_3.png")
        top = pixel(img, 400, 300)
        check(near(top, RED), "порядок создания не влияет на порядок по слою: %s" % (top,))

        # --- 2. Глубина внутри слоя ------------------------------------------
        # Слои выравниваем: иначе спор решает слой, а не глубина.
        a.eval("$('#s_hi').layer(3); $('#s_lo').layer(3);"
               "$('#s_hi').depth(0); $('#s_lo').depth(7)")
        a.step(2)
        _, img = shot(a, "sort_depth_1.png")
        top = pixel(img, 400, 300)
        check(near(top, GREEN), "внутри слоя больший depth поверх: %s" % (top,))
        a.eval("$('#s_hi').depth(9)")
        a.step(2)
        _, img = shot(a, "sort_depth_2.png")
        top = pixel(img, 400, 300)
        check(near(top, RED), "depth перебивает порядок создания: %s" % (top,))

        # --- 3. Относительная глубина складывается с родителем ---------------
        a.eval("$('#s_hi').remove(); $('#s_lo').remove();"
               "$('<group>', { id: 'g_parent' }).at(400, 300).depth(10).depthRelative(true)"
               ".appendTo($.world);"
               "$('<rect>', { id: 'g_child', w: 200, h: 200, color: '#ff0000' }).at(400, 300)"
               ".depth(1).depthRelative(true).appendTo($('#g_parent'));"
               "$('<rect>', { id: 'g_rival', w: 200, h: 200, color: '#00ff00' }).at(400, 300)"
               ".depth(10).appendTo($.world); 'ok'")
        a.step(2)
        eff = a.eval("$('#g_child').effectiveDepth()")
        check(eff == 11, "effectiveDepth ребёнка складывается с родителем (%s)" % eff)
        _, img = shot(a, "sort_depth_relative.png")
        top = pixel(img, 400, 300)
        check(near(top, RED), "ребёнок относительной глубины поверх соседа: %s" % (top,))
        check(a.eval("$('#g_rival').effectiveDepth()") == 10,
              "абсолютная глубина соседа не меняется")
        a.eval("$('#g_parent').remove(); $('#g_rival').remove()")

        # --- 4. Y-sort: порядок по Y, а не по созданию ------------------------
        a.eval("$.world.sort('y');"
               + rect("y_a", "#ff0000", 0, 0, 400, 260)
               + rect("y_b", "#00ff00", 0, 0, 400, 340))
        a.step(2)
        _, img = shot(a, "sort_y_1.png")
        top = pixel(img, 400, 300)
        check(near(top, GREEN), "при sort('y') нижний (y=340) поверх верхнего: %s" % (top,))
        a.eval("$('#y_a').at(400, 340); $('#y_b').at(400, 260)")
        a.step(2)
        _, img = shot(a, "sort_y_2.png")
        top = pixel(img, 400, 300)
        check(near(top, RED), "порядок следует за Y, а не за созданием: %s" % (top,))
        a.eval("$('#y_a').remove(); $('#y_b').remove(); $.world.sort('layer')")

        # --- 5. Равные ключи: uid, и это воспроизводимо -----------------------
        a.eval(rect("t_1", "#ff0000", 0, 0) + rect("t_2", "#00ff00", 0, 0)
               + rect("t_3", "#0000ff", 0, 0))
        a.step(2)
        p1, img1 = shot(a, "sort_tie_1.png")
        p2, img2 = shot(a, "sort_tie_2.png")
        p3, img3 = shot(a, "sort_tie_3.png")
        top = pixel(img1, 400, 300)
        check(near(top, BLUE), "при равных ключах поверх последний созданный: %s" % (top,))
        check(img1[3] == img2[3] == img3[3],
              "три кадра подряд совпадают побайтово — сортировка детерминирована")
        check(pixel(img2, 400, 300) == top and pixel(img3, 400, 300) == top,
              "порядок не «дышит» между кадрами")
        a.eval("$('#t_1').remove(); $('#t_2').remove(); $('#t_3').remove()")

        # --- 6. Свой компаратор ($.world.sortWith) ----------------------------
        a.eval(rect("c_1", "#ff0000", 0, 0) + rect("c_2", "#00ff00", 0, 0))
        a.eval("$.world.sortWith((a, b) => b.uid - a.uid)")
        a.step(2)
        _, img = shot(a, "sort_custom.png")
        top = pixel(img, 400, 300)
        check(near(top, RED), "sortWith() задаёт порядок сам (обратный uid): %s" % (top,))
        a.eval("$.world.sortWith(null); $('#c_1').remove(); $('#c_2').remove()")
        a.step(1)

        # --- 7. Интерфейс поверх мира и порядок внутри интерфейса -------------
        a.eval("$('<rect>', { id: 'u_w', x: 400, y: 300, w: 300, h: 300, color: '#ffff00' })"
               ".layer(9).depth(99).appendTo($.world);"
               "$('<ui.panel>', { id: 'u_p1', x: 400, y: 300, w: 200, h: 200,"
               " color: '#0000ff' }).appendTo($.ui);"
               "$('<ui.panel>', { id: 'u_p2', x: 400, y: 300, w: 150, h: 150,"
               " color: '#ff0000' }).appendTo($.ui); 'ok'")
        a.step(2)
        _, img = shot(a, "sort_ui.png")
        center = pixel(img, 400, 300)
        # Панель u_p1 — 200×200 (y 200..400), u_p2 — 150×150 (y 225..375):
        # точка y=210 внутри первой и снаружи второй.
        edge = pixel(img, 400, 210)
        check(near(center, RED),
              "интерфейс поверх мира и в порядке создания: %s" % (center,))
        check(near(edge, BLUE), "вне перекрытия панелей виден первый ui-узел: %s" % (edge,))
        a.eval("$('#u_w').remove(); $('#u_p1').remove(); $('#u_p2').remove()")
        a.step(1)

        # --- 8. Порядок презентации не влияет на физику -----------------------
        def fall(layers):
            a.eval("presentationScene('logic')")
            a.eval("$('#l_hero').layer(%d).depth(%d); $('#l_floor').layer(%d).depth(%d); 'ok'"
                   % (layers[0], layers[1], layers[2], layers[3]))
            a.step(40)
            return (a.eval("$('#l_hero').pos().y"), a.eval("$('#l_hero').velocity().y"),
                    a.eval("$('#l_floor').pos().y"))

        plain = fall((0, 0, 0, 0))
        fancy = fall((5, 20, 3, 90))
        print("  --   физика при layer/depth 0: %s; при 5/20 и 3/90: %s" % (plain, fancy))
        check(plain == fancy, "смена слоя и глубины не меняет падение тела")
        check(abs(plain[0] - 200) > 1, "тело действительно падало (y=%.2f)" % plain[0])

        # --- 9. Живость --------------------------------------------------------
        check(a.ping().get("pong") is True, "движок отвечает после проверок порядка")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
