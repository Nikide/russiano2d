#!/usr/bin/env python3
# ===========================================================================
# Тест света в стиле Candle через агентский интерфейс.
#
# Проверяем не «функция вызвалась», а то, что видит игрок:
#   * тени внутри <light> реально гасят свет за препятствием — по пикселям
#     двух скриншотов (тени выключены / включены) в одной и той же сцене;
#   * контрольная точка вне тени при этом не гаснет — значит, тёмное пятно
#     это именно тень, а не погасший свет;
#   * <lightarea> и <fog> живут и рисуются, $.gfx.fog() осветляет кадр;
#   * реестр препятствий, конус, .punch(), .flicker() и отладка работают.
#
# Картинку читаем своим мини-декодером PNG (только стандартная библиотека):
# сверять свет «на глаз» нельзя, нужны числа.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_light_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "light")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


# ---------------------------------------------------------------------------
# Мини-декодер PNG: 8 бит, RGB/RGBA, без интерлейса — ровно то, что пишет
# движок. Внешние библиотеки в тестах запрещены, поэтому фильтры распаковываем
# сами (5 штук, все по спецификации PNG).
# ---------------------------------------------------------------------------

def read_png(path):
    """Вернуть (ширина, высота, каналов, байты пикселей)."""
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG: %s" % path)

    pos = 8
    width = height = channels = 0
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color_type, _comp, _filter, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise ValueError("неподдерживаемый PNG: depth=%d type=%d interlace=%d"
                                 % (depth, color_type, interlace))
            channels = 3 if color_type == 2 else 4
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
        pos += 12 + length

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    offset = 0
    for y in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        if filter_type == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filter_type == 4:
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


def mean_luma(image, lx, ly, half, scale_x, scale_y):
    """Средняя яркость квадрата вокруг ЛОГИЧЕСКОЙ точки (lx, ly)."""
    width, height, channels, pixels = image
    cx = int(round(lx * scale_x))
    cy = int(round(ly * scale_y))
    hx = max(1, int(round(half * scale_x)))
    hy = max(1, int(round(half * scale_y)))
    total = 0
    count = 0
    for y in range(max(0, cy - hy), min(height, cy + hy)):
        row = y * width
        for x in range(max(0, cx - hx), min(width, cx + hx)):
            o = (row + x) * channels
            total += pixels[o] + pixels[o + 1] + pixels[o + 2]
            count += 3
    return total / float(max(1, count))


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Теги и пространства имён на месте --------------------------------
        check(a.eval("typeof $.gfx.light") == "object", "$.gfx.light доступно")
        check(a.eval("typeof $.gfx.fog") == "function", "$.gfx.fog доступно")
        check(a.eval("$('#lamp').nodes.length") == 1, "узел <light> создан")
        check(a.eval("$('#area').nodes.length") == 1, "узел <lightarea> создан")
        check(a.eval("$('#mist').nodes.length") == 1, "узел <fog> создан")

        # --- Реестр препятствий ----------------------------------------------
        check(a.eval("$.gfx.light.count()") == 4,
              "коробка-препятствие дала 4 отрезка")
        check(a.eval("$.gfx.light.occluders([{x:0,y:0,w:10,h:10},{x:50,y:50,w:10,h:10}])") == 8,
              "$.gfx.light.occluders([...]) пересобирает реестр")
        before = a.eval("$.gfx.light.count()")
        after = a.eval("$.gfx.light.tiles(2, 2, function () { return true; }, { cell: 10 })")
        check(after - before == 8,
              "$.gfx.light.tiles() добавил периметр блока (%s → %s)" % (before, after))
        a.eval("$.gfx.light.occluders([{ x: 408, y: 180, w: 24, h: 240 }])")
        check(a.eval("$.gfx.light.count()") == 4, "реестр вернулся к одному препятствию")
        check(a.eval("$.gfx.light.segments().length") == 16,
              "$.gfx.light.segments() отдаёт копию (16 чисел)")

        # --- Конус, тени, мерцание -------------------------------------------
        check(a.eval("$('#lamp').cone()") == 140, "конус задан в конструкторе")
        a.eval("$('#lamp').cone(90, 0.4)")
        check(a.eval("$('#lamp').cone()") == 90, ".cone(deg, soft) меняет угол")
        check(a.eval("$('#lamp').shadows()") is False, "тени по умолчанию выключены")
        a.eval("$('#lamp').shadows(true)")
        check(a.eval("$('#lamp').shadows()") is True, ".shadows(true) включает тени")
        check(a.eval("$('#torch').punch()") is True, ".punch(true) из конструктора")
        a.eval("$('#lamp').flicker(0.2, 9)")
        flicker = a.eval("$('#lamp').flicker()")
        check(isinstance(flicker, dict) and abs(flicker.get("amount", 0) - 0.2) < 1e-9,
              ".flicker(amount, speed) сохранил параметры")

        # --- Кадр рисуется ----------------------------------------------------
        a.step(5)
        stats = a.eval("$.gfx.stats()")
        check(isinstance(stats, dict) and stats.get("triangles", 0) > 0,
              "свет ушёл в батч треугольниками (%s)"
              % (stats.get("triangles") if isinstance(stats, dict) else stats))
        check(a.eval("engine.frame") > 0, "кадры идут")

        # --- Тени: замер по пикселям -----------------------------------------
        # Свет — полный круг радиусом 400. Препятствие — квадрат справа от
        # фонаря: точка (400, 300) стоит ровно за ним, контрольная (200, 500) —
        # на том же расстоянии от света, но открыта.

        def shot(name):
            path = os.path.join(ROOT, "build", name)
            a.screenshot(path)
            image = read_png(path)
            return (image,
                    image[0] / float(a.eval("engine.width")),
                    image[1] / float(a.eval("engine.height")))

        a.eval("$('#lamp').flicker(0)")
        a.eval("$('#lamp').cone(0)")
        a.eval("$('#lamp').shadows(false)")
        a.step(2)
        off, scale_x, scale_y = shot("light_shadows_off.png")
        shadow_off = mean_luma(off, 400, 300, 14, scale_x, scale_y)
        control_off = mean_luma(off, 200, 500, 14, scale_x, scale_y)

        a.eval("$('#lamp').shadows(true)")
        a.step(2)
        on, scale_x, scale_y = shot("light_shadows_on.png")
        shadow_on = mean_luma(on, 400, 300, 14, scale_x, scale_y)
        control_on = mean_luma(on, 200, 500, 14, scale_x, scale_y)

        check(shadow_off > 40, "без теней за препятствием светло (яркость %.0f)" % shadow_off)
        check(control_off > 40, "контрольная точка освещена (яркость %.0f)" % control_off)
        check(shadow_on < shadow_off * 0.4,
              "с тенями за препятствием темно (%.0f → %.0f)" % (shadow_off, shadow_on))
        check(control_on > control_off * 0.8,
              "вне тени свет не погас (%.0f → %.0f)" % (control_off, control_on))

        # --- Кэш границ и отсечение по радиусу --------------------------------
        # Сцена статична: если бы границы считались каждый кадр, built был бы
        # ненулевым. Ноль здесь — это и есть проверка кэша.
        a.step(3)
        a.eval("$.gfx.light.resetStats()")
        a.step(1)
        stats = a.eval("$.gfx.light.stats()")
        check(isinstance(stats, dict) and stats.get("built", -1) == 0,
              "границы теней берутся из кэша (посчитано за кадр: %s)"
              % (stats.get("built") if isinstance(stats, dict) else stats))
        check(isinstance(stats, dict) and stats.get("cached", 0) > 0,
              "кэш границ используется (%s попаданий)"
              % (stats.get("cached") if isinstance(stats, dict) else stats))

        a.eval("$.gfx.light.addOccluders([{ x: 3000, y: 3000, w: 100, h: 100 },"
               " { x: 5000, y: 100, w: 100, h: 100 }])")
        a.step(2)
        a.eval("$.gfx.light.resetStats()")
        a.step(1)
        far = a.eval("$.gfx.light.stats()")
        check(isinstance(far, dict) and far.get("culled", 0) < far.get("considered", 0),
              "далёкие препятствия отсекаются по радиусу (%s из %s дошло)"
              % (far.get("culled") if isinstance(far, dict) else "?",
                 far.get("considered") if isinstance(far, dict) else "?"))
        a.eval("$.gfx.light.occluders([{ x: 408, y: 180, w: 24, h: 240 }])")

        # --- Мягкая кромка тени ------------------------------------------------
        # Край тени проходит около y=190 при x=400: с мягкостью туда попадает
        # часть подлучей, а в глубине тени (400, 300) по-прежнему темно.
        a.step(2)
        crisp, scale_x, scale_y = shot("light_soft_1.png")
        crisp_edge = mean_luma(crisp, 400, 195, 5, scale_x, scale_y)
        a.eval("$('#lamp').shadowSoft(8, 12)")
        check(a.eval("$('#lamp').shadowSoft()") == 8, ".shadowSoft(rays, deg) сохранил число лучей")
        a.step(2)
        soft, scale_x, scale_y = shot("light_soft_8.png")
        soft_edge = mean_luma(soft, 400, 195, 5, scale_x, scale_y)
        soft_deep = mean_luma(soft, 400, 300, 10, scale_x, scale_y)
        check(soft_edge > crisp_edge * 2,
              "мягкая кромка подсвечивает полутень (%.1f → %.1f)" % (crisp_edge, soft_edge))
        check(soft_deep < soft_edge * 0.5,
              "в глубине тени мягкость не светит (%.1f против %.1f)" % (soft_deep, soft_edge))
        a.eval("$('#lamp').shadowSoft(1)")

        # --- Конус -------------------------------------------------------------
        a.eval("$('#lamp').shadows(false).cone(90)")
        a.step(2)
        cone_img, scale_x, scale_y = shot("light_cone.png")
        cone_in = mean_luma(cone_img, 400, 300, 14, scale_x, scale_y)    # справа, в конусе
        cone_out = mean_luma(cone_img, 200, 500, 14, scale_x, scale_y)   # снизу, вне конуса
        check(cone_in > 40, "в конусе светло (яркость %.0f)" % cone_in)
        check(cone_out < cone_in * 0.3,
              "вне конуса темно (%.0f против %.0f)" % (cone_out, cone_in))
        a.eval("$('#lamp').cone(0)")

        # --- Площадной свет ---------------------------------------------------
        area = mean_luma(on, 620, 430, 14, scale_x, scale_y)
        dark = mean_luma(on, 760, 40, 14, scale_x, scale_y)
        check(area > dark * 2, "<lightarea> освещает свою зону (%.0f против %.0f)"
              % (area, dark))

        # --- Туман -------------------------------------------------------------
        a.eval("$.gfx.fog({ color: '#8899bb', density: 0.5, layers: 4 })")
        params = a.eval("$.gfx.fog.params()")
        check(isinstance(params, dict) and abs(params.get("density", 0) - 0.5) < 1e-9,
              "$.gfx.fog() принял плотность")
        a.step(2)
        foggy, scale_x, scale_y = shot("light_fog_screen.png")
        dark_fog = mean_luma(foggy, 760, 40, 14, scale_x, scale_y)
        check(dark_fog > dark + 10,
              "экранный туман осветлил пустое место (%.0f → %.0f)" % (dark, dark_fog))
        a.eval("$.gfx.fog.off()")
        check(a.eval("$.gfx.fog.params()") is None and a.eval("$.gfx.fog.on()") is False,
              "$.gfx.fog.off() выключает туман")

        a.eval("$('#mist').show()")
        a.step(2)
        mist, scale_x, scale_y = shot("light_fog_node.png")
        mist_luma = mean_luma(mist, 760, 40, 14, scale_x, scale_y)
        check(mist_luma > dark + 5,
              "узел <fog> осветлил кадр (%.0f → %.0f)" % (dark, mist_luma))
        a.eval("$('#mist').hide()")

        # --- Темнота и свет, который её прорезает ------------------------------
        # Темнота — multiply поверх кадра: обычный свет гаснет, а свет с
        # .punch(true) рисуется после неё и остаётся ярким.
        a.eval("$('#lamp').shadows(false).cone(0)")
        a.step(2)
        lit, scale_x, scale_y = shot("light_ambient_off.png")
        lamp_before = mean_luma(lit, 200, 300, 10, scale_x, scale_y)
        torch_before = mean_luma(lit, 150, 120, 10, scale_x, scale_y)
        check(a.eval("$.gfx.light.ambient.on()") is False,
              "темнота по умолчанию выключена")

        a.eval("$.gfx.light.ambient({ level: 0.7, color: '#000000' })")
        params = a.eval("$.gfx.light.ambient.params()")
        check(isinstance(params, dict) and abs(params.get("level", 0) - 0.7) < 1e-9,
              "$.gfx.light.ambient() приняла уровень")
        a.step(2)
        dark, scale_x, scale_y = shot("light_ambient_on.png")
        lamp_after = mean_luma(dark, 200, 300, 10, scale_x, scale_y)
        torch_after = mean_luma(dark, 150, 120, 10, scale_x, scale_y)
        check(lamp_before > 40, "до темноты фонарь светит (яркость %.0f)" % lamp_before)
        check(lamp_after < lamp_before * 0.5,
              "темнота гасит обычный свет (%.0f → %.0f)" % (lamp_before, lamp_after))
        check(torch_after > torch_before * 0.75,
              "свет с .punch(true) темноту прорезает (%.0f → %.0f)" % (torch_before, torch_after))

        a.eval("$.gfx.light.ambient.off()")
        check(a.eval("$.gfx.light.ambient.on()") is False,
              "$.gfx.light.ambient.off() выключает темноту")
        check(a.eval("$.gfx.light.ambient.params()") is None,
              "после выключения параметров темноты нет")
        a.step(2)
        back, scale_x, scale_y = shot("light_ambient_back.png")
        lamp_back = mean_luma(back, 200, 300, 10, scale_x, scale_y)
        check(abs(lamp_back - lamp_before) < lamp_before * 0.1,
              "выключение темноты возвращает картинку (%.0f → %.0f)"
              % (lamp_before, lamp_back))

        # --- Lightmap: свет в отдельной текстуре -------------------------------
        # С включённой картой света свет копится в текстуре половинного
        # разрешения и накладывается на сцену одним проходом. Картинка при этом
        # должна остаться той же, а кромка — стать мягче.
        check(a.eval("$.gfx.light.mapSupported()") is True, "световая карта доступна")
        check(a.eval("$.gfx.light.map()")["on"] is False,
              "по умолчанию световая карта выключена")

        a.eval("$('#lamp').shadows(true).cone(0).flicker(0)")
        a.eval("$.gfx.light.occluders([{ x: 408, y: 180, w: 24, h: 240 }])")
        a.step(3)
        plain, scale_x, scale_y = shot("light_map_off.png")
        plain_lit = mean_luma(plain, 200, 300, 10, scale_x, scale_y)
        plain_edge = mean_luma(plain, 400, 193, 4, scale_x, scale_y)

        a.eval("$.gfx.light.map({ on: true, intensity: 1, soft: 0 })")
        params = a.eval("$.gfx.light.map()")
        check(isinstance(params, dict) and params.get("on") is True,
              "$.gfx.light.map({on:true}) включается")
        a.step(3)
        mapped, scale_x, scale_y = shot("light_map_on.png")
        mapped_lit = mean_luma(mapped, 200, 300, 10, scale_x, scale_y)
        mapped_shadow = mean_luma(mapped, 400, 300, 10, scale_x, scale_y)
        check(mapped_lit > plain_lit * 0.7,
              "карта света не теряет свет (%.0f против %.0f)" % (plain_lit, mapped_lit))
        check(mapped_shadow < mapped_lit * 0.2,
              "тени в карте света работают (%.0f против %.0f)" % (mapped_shadow, mapped_lit))
        info = a.eval("engine.renderInfo()")
        check(isinstance(info, dict) and info.get("passes", 0) >= 1,
              "проход световой карты считается (%s)"
              % (info.get("passes") if isinstance(info, dict) else info))

        # Размытие карты: свет размазывается, полутень на кромке растёт.
        a.eval("$.gfx.light.map({ soft: 2 })")
        a.step(3)
        soft_map, scale_x, scale_y = shot("light_map_soft.png")
        soft_edge = mean_luma(soft_map, 400, 193, 4, scale_x, scale_y)
        soft_lit = mean_luma(soft_map, 200, 300, 10, scale_x, scale_y)
        check(soft_edge > plain_edge * 1.3,
              "размытие карты смягчает кромку тени (%.1f → %.1f)" % (plain_edge, soft_edge))
        check(soft_lit > plain_lit * 0.6,
              "после размытия свет не пропал (%.0f против %.0f)" % (plain_lit, soft_lit))

        # С картой света свет ложится уже после темноты — фонарь её прорезает.
        a.eval("$.gfx.light.ambient({ level: 0.7, color: '#000000' })")
        a.step(3)
        dark_map, scale_x, scale_y = shot("light_map_dark.png")
        dark_lit = mean_luma(dark_map, 200, 300, 10, scale_x, scale_y)
        check(dark_lit > soft_lit * 0.8,
              "карта света прорезает темноту (%.0f → %.0f)" % (soft_lit, dark_lit))
        a.eval("$.gfx.light.ambient.off()")
        a.eval("$.gfx.light.map({ on: false })")
        a.step(2)
        check(a.eval("$.gfx.light.map()")["on"] is False, "световая карта выключается")

        # --- Точный полигон из C и отладка ------------------------------------
        check(a.eval("$.gfx.light.polygon(200, 300) ? $.gfx.light.polygon(200, 300).length : -1") > 6,
              "engine.light.visibility() вернул полигон")

        # Подготовленный набор: разрезание O(n^2) делается один раз на версию
        # реестра, поэтому и оценка буфера становится линейной.
        check(a.eval("typeof engine.light.prepare") == "function",
              "engine.light.prepare() доступно")
        prepared_count = a.eval("engine.light.preparedCount()")
        check(isinstance(prepared_count, int) and prepared_count > 0,
              "подготовленный набор не пуст (подотрезков: %s)" % prepared_count)
        same = a.eval("(function () {"
                      " const raw = engine.light.visibility("
                      "Float32Array.from($.gfx.light.segments()), 200, 300);"
                      " const prep = engine.light.visibilityPrepared(200, 300);"
                      " if (!raw || !prep || raw.length !== prep.length) return false;"
                      " for (let i = 0; i < raw.length; i++)"
                      "   if (Math.abs(raw[i] - prep[i]) > 1e-3) return false;"
                      " return true; })()")
        check(same is True, "полигон по подготовленному набору совпадает с обычным")
        prep_max = a.eval("engine.light.preparedMaxPoints()")
        raw_max = a.eval("engine.light.maxPoints($.gfx.light.count())")
        check(isinstance(prep_max, int) and isinstance(raw_max, int) and prep_max < raw_max,
              "оценка буфера по набору линейна (%s против %s)" % (prep_max, raw_max))
        a.eval("$.gfx.light.debug(true)")
        a.step(2)
        check(a.eval("$.gfx.light.debugOn()") is True, "отладка препятствий включается")
        check(a.eval("$.gfx.stats()").get("triangles", 0) > 0, "кадр с отладкой рисуется")
        a.eval("$.gfx.light.debug(false)")

        # --- Свет без препятствий и без конуса не ломает кадр -----------------
        a.eval("$('#lamp').shadows(true).cone(0)")
        a.eval("$.gfx.light.clearOccluders()")
        a.step(2)
        check(a.eval("$.gfx.light.count()") == 0, "реестр очищен")
        check(a.eval("engine.frame") > 0, "кадр без препятствий рисуется")

        shot_path = os.path.join(ROOT, "build", "light_shadows_on.png")
        check(os.path.getsize(shot_path) > 0, "скриншот сохранён: " + shot_path)

    print("Все проверки пройдены" if not FAILURES else "ПРОВАЛЕНО: %d" % len(FAILURES))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
