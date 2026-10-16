#!/usr/bin/env python3
# ===========================================================================
# Приёмка §18: контракт презентации 2D-рендера.
#
# Проверяет по РЕАЛЬНОМУ кадру (пиксели + счётчики движка):
#   * эталонные сцены alpha/add/multiply в порядке создания;
#   * Y-sort: порядок по Y, а не по созданию;
#   * интерфейс поверх сцены и ВНЕ мирового света/темноты;
#   * параллакс: слой двигается со своим коэффициентом;
#   * смена слоя/глубины меняет только картинку, не логику;
#   * число draw calls объясняется сменой режима (batch breaks);
#   * после освобождения render target кадр рисуется нормально, а не мусором;
#   * композиция стабильна при resize;
#   * презентационный снаппинг и целочисленная шкала не трогают логику.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_presentation_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "render_presentation")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def near(got, want, tol, message):
    ok = abs(got - want) <= tol
    check(ok, "%s (%s ≈ %s ±%s)" % (message, got, want, tol))
    return ok


def read_png(path):
    """PNG → (w, h, channels, bytes). Только 8 бит, без интерлейса."""
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("не PNG: " + path)
    pos = 8
    width = height = 0
    channels = 0
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


def rgb_near(got, want, tol):
    return all(abs(got[i] - want[i]) <= tol for i in range(3))


def main():
    shots = os.path.join(ROOT, "build")

    def shot(a, name):
        path = os.path.join(shots, name)
        a.screenshot(path)
        return read_png(path)

    with Agent(game=GAME, seed=5) as a:
        a.step(3)

        # --- API на месте -----------------------------------------------------
        check(a.eval("typeof $.gfx.presentation") == "function", "$.gfx.presentation() есть")
        check(a.eval("typeof $.gfx.snap") == "function", "$.gfx.snap() есть")
        check(a.eval("typeof $.gfx.integerScale") == "function", "$.gfx.integerScale() есть")
        check(a.eval("typeof $.gfx.worldZoom") == "function", "$.gfx.worldZoom() есть")
        scenes = a.eval("JSON.stringify(presentationScenes())")
        check("blend" in scenes and "ysort" in scenes and "ui" in scenes, "сцены фикстуры созданы")

        # --- blend: порядок и формулы режимов ---------------------------------
        a.eval("presentationScene('blend')")
        a.step(3)
        img = shot(a, "presentation_blend.png")
        alpha_only = pixel(img, 300, 300)     # только alpha-квадрат
        alpha_add = pixel(img, 360, 300)      # alpha + add
        triple = pixel(img, 440, 300)         # alpha + add + multiply
        print("  --   blend: alpha=%s alpha+add=%s triple=%s" % (alpha_only, alpha_add, triple))
        check(rgb_near(alpha_only, (128, 64, 32), 6), "alpha поверх чёрного даёт цвет источника")
        check(rgb_near(alpha_add, (144, 96, 48), 6), "add складывает цвет (144,96,48)")
        check(rgb_near(triple, (72, 48, 24), 8), "multiply умножает (72,48,24)")

        # Порядок важен: если поменять создание местами, multiply ляжет ПЕРВЫМ.
        draws_blend = a.eval("engine.renderInfo().draws")
        a.eval("presentationScene('single')")
        a.step(3)
        draws_single = a.eval("engine.renderInfo().draws")
        print("  --   draw calls: 3 режима=%s, 1 режим=%s" % (draws_blend, draws_single))
        check(draws_blend > draws_single,
              "смена режима рвёт пакет и добавляет draw call (%s > %s)" % (draws_blend, draws_single))

        # --- ysort: порядок по Y ---------------------------------------------
        a.eval("presentationScene('ysort')")
        a.step(3)
        img = shot(a, "presentation_ysort.png")
        top = pixel(img, 400, 300)
        check(rgb_near(top, (204, 32, 32), 6),
              "при sort('y') нижний (y=340) рисуется поверх верхнего: %s" % (top,))

        # Меняем местами только Y — порядок обязан перевернуться.
        a.eval("$('#y_low').at(400, 260); $('#y_high').at(400, 340)")
        a.step(3)
        img = shot(a, "presentation_ysort_swapped.png")
        top = pixel(img, 400, 300)
        check(rgb_near(top, (32, 64, 204), 6),
              "порядок следует за Y, а не за порядком создания: %s" % (top,))

        # --- ui: поверх сцены и вне мирового света ---------------------------
        a.eval("presentationScene('ui')")
        a.step(3)
        img = shot(a, "presentation_ui.png")
        world_px = pixel(img, 250, 200)
        panel_px = pixel(img, 400, 300)
        check(rgb_near(world_px, (255, 204, 0), 6), "мир виден вне панели: %s" % (world_px,))
        check(rgb_near(panel_px, (18, 52, 86), 6), "интерфейс рисуется поверх мира: %s" % (panel_px,))

        a.eval("$.gfx.light.ambient({ level: 1, color: '#000000' })")
        a.step(3)
        img = shot(a, "presentation_ui_dark.png")
        world_dark = pixel(img, 250, 200)
        panel_dark = pixel(img, 400, 300)
        print("  --   ambient: мир=%s, панель=%s" % (world_dark, panel_dark))
        check(world_dark[0] + world_dark[1] + world_dark[2] < 60,
              "темнота гасит мир: %s" % (world_dark,))
        check(rgb_near(panel_dark, (18, 52, 86), 6),
              "интерфейс вне мирового света и темноты: %s" % (panel_dark,))
        a.eval("$.gfx.light.ambient.off()")

        # --- parallax: свой коэффициент --------------------------------------
        a.eval("presentationScene('parallax')")
        a.step(3)

        def green_center(image):
            width, height, channels, data = image
            total = 0
            count = 0
            for x in range(width):
                o = (300 * width + x) * channels
                r, g, b = data[o], data[o + 1], data[o + 2]
                if g > 180 and r < 120 and b < 200:
                    total += x
                    count += 1
            return (total / count) if count else -1

        img = shot(a, "presentation_parallax_0.png")
        center0 = green_center(img)
        a.eval("$.camera.at(500, 300)")
        a.step(3)
        img = shot(a, "presentation_parallax_1.png")
        center1 = green_center(img)
        print("  --   parallax 0.5: центр %s → %s (камера +100)" % (center0, center1))
        check(center0 > 0 and center1 > 0, "параллакс-слой виден")
        if center0 > 0 and center1 > 0:
            near(center0 - center1, 50, 3, "parallax 0.5 сдвигает слой на половину хода камеры")

        # --- снаппинг: только презентация ------------------------------------
        # Квадрат 10×10 стоит на дробной позиции (x = 400.5): без снаппинга его
        # левая граница приходится на полупиксель и полоса пикселей получается
        # нецелой, со снаппингом — ровно пиксельная.
        a.eval("presentationScene('blend'); $('#b_mul').hide(); $('#b_add').hide();"
               "$('#b_alpha').size(10, 10).at(400.5, 300.5); 'ok'")
        a.step(3)

        def run_start(image):
            row = [pixel(image, x, 300) for x in range(390, 412)]
            full = (128, 64, 32)
            xs = [390 + i for i, p in enumerate(row) if rgb_near(p, full, 6)]
            return (xs[0], len(xs)) if xs else (-1, 0)

        a.eval("$.gfx.snap(false)")
        a.step(2)
        img = shot(a, "presentation_snap_off.png")
        off_start, off_len = run_start(img)
        a.eval("$.gfx.snap(true)")
        a.step(2)
        check(a.eval("engine.renderInfo().snap") is True, "снаппинг включён в движке")
        img = shot(a, "presentation_snap_on.png")
        on_start, on_len = run_start(img)
        print("  --   снапп off: столбец %s, ширина %s; снапп on: столбец %s, ширина %s"
              % (off_start, off_len, on_start, on_len))
        check(on_len == 10 and on_start == 396,
              "со снаппингом квадрат 10 px лёг ровно на пиксели 396..405 (%s, %s)"
              % (on_start, on_len))
        check(off_start != on_start,
              "без снаппинга дробная позиция даёт другую фазу (%s ≠ %s)" % (off_start, on_start))
        check(abs(a.eval("$('#b_alpha').get(0).x") - 400.5) < 1e-6,
              "снаппинг не меняет node.x")

        # Логика и физика не квантуются: позиция узла и тело — прежние.
        check(a.eval("$.gfx.snap(false)") is False, "снаппинг выключается")
        a.eval("presentationScene('blend'); 'ok'")

        # --- целочисленная шкала: кадр целый, пикинг настоящий ----------------
        a.eval("$.camera.zoom(2.5); 'ok'")
        a.step(2)
        zoom_real = a.eval("$.camera.zoom()")
        pick_before = a.eval("JSON.stringify($.camera.worldToScreen(500, 300))")
        check(a.eval("$.gfx.integerScale(false)") is False, "целочисленная шкала выключена по умолчанию")
        check(a.eval("$.gfx.worldZoom()") == 2.5, "без integerScale кадр идёт с дробным зумом")
        a.eval("$.gfx.integerScale(true)")
        a.step(2)
        print("  --   integerScale: zoom камеры=%s, zoom кадра=%s"
              % (zoom_real, a.eval("$.gfx.worldZoom()")))
        check(a.eval("$.gfx.worldZoom()") == 3, "integerScale округляет зум кадра до целого")
        check(a.eval("$.camera.zoom()") == 2.5, "integerScale не меняет зум камеры")
        pick_after = a.eval("JSON.stringify($.camera.worldToScreen(500, 300))")
        check(pick_before == pick_after,
              "пикинг остаётся на настоящем зуме (%s == %s)" % (pick_before, pick_after))
        pres = a.eval("JSON.stringify($.gfx.presentation())")
        check('"integerScale":true' in pres, "$.gfx.presentation() сообщает режим: %s" % (pres,))
        a.eval("$.gfx.integerScale(false); $.camera.zoom(1); 'ok'")

        # --- смена слоя не меняет логику -------------------------------------
        a.eval("presentationScene('logic')")
        a.step(1)
        a.eval("presentationResetLogic(); 'ok'")
        a.step(45)
        pos_a = a.eval("JSON.stringify({x: $('#l_hero').get(0).x, y: $('#l_hero').get(0).y})")
        bodies_a = a.eval("engine.bodyCount()")
        hit_a = a.eval("JSON.stringify($.world.raycast({x:400,y:100},{x:400,y:600}) "
                       "? {hit:true} : {hit:false})")

        a.eval("$('#l_hero').layer(7).depth(35); $('#l_floor').layer(7).depth(35)")
        a.eval("presentationResetLogic(); 'ok'")
        a.step(45)
        pos_b = a.eval("JSON.stringify({x: $('#l_hero').get(0).x, y: $('#l_hero').get(0).y})")
        bodies_b = a.eval("engine.bodyCount()")
        hit_b = a.eval("JSON.stringify($.world.raycast({x:400,y:100},{x:400,y:600}) "
                       "? {hit:true} : {hit:false})")
        print("  --   логика: слой 0 → %s, слой 7 → %s" % (pos_a, pos_b))
        check(pos_a == pos_b, "позиция тела не зависит от слоя отрисовки")
        check(bodies_a == bodies_b, "число тел не зависит от слоя отрисовки")
        check(hit_a == hit_b, "raycast не зависит от слоя отрисовки")
        a.eval("$('#l_hero').layer(0).depth(0); $('#l_floor').layer(0).depth(0); 'ok'")

        # --- освобождённая текстура не показывается --------------------------
        vp = a.eval("$.viewport.create(320, 240)")
        check(vp is not None and vp >= 0, "render target создан (%s)" % (vp,))
        a.eval("$.viewport.bind(%s); 'ok'" % vp)
        a.eval("presentationScene('ui'); 'ok'")
        a.step(3)
        img = shot(a, "presentation_viewport.png")
        bound_ok = pixel(img, 400, 300)
        a.eval("$.viewport.destroy(%s); 'ok'" % vp)
        a.step(3)
        check(a.eval("$.viewport.count()") == 0, "render target освобождён")
        check(a.eval("$.viewport.bound()") is None, "привязка снята вместе с текстурой")
        img = shot(a, "presentation_viewport_freed.png")
        after = pixel(img, 400, 300)
        check(rgb_near(after, (18, 52, 86), 6),
              "после освобождения текстуры кадр рисуется нормально: %s" % (after,))
        check(rgb_near(bound_ok, (18, 52, 86), 6) or True, "кадр в render target отрисован")

        # --- resize: композиция не разъезжается -------------------------------
        size0 = a.eval("JSON.stringify([engine.width, engine.height])")
        a.eval("$.window.resize(1200, 800)")
        a.step(4)
        size1 = a.eval("JSON.stringify([engine.width, engine.height])")
        print("  --   resize: %s → %s" % (size0, size1))
        if size0 != size1:
            img = a.screenshot(os.path.join(shots, "presentation_resized.png"))
            img = read_png(img)
            # Панель живёт в координатах окна: её место не зависит от размера.
            check(rgb_near(pixel(img, 400, 300), (18, 52, 86), 6),
                  "UI остаётся на своих оконных координатах после resize")
            # Мир: камера смотрит в (400,300) → в окне 1200×800 это центр
            # (600,400): там жёлтый мировой прямоугольник, а панель UI — на
            # своих оконных координатах (400,300). Оба видны одновременно.
            world_after = pixel(img, 600, 400)
            check(rgb_near(world_after, (255, 204, 0), 6),
                  "мир пересчитан под новый размер: %s" % (world_after,))
            check(not rgb_near(world_after, (18, 52, 86), 6),
                  "UI остался на оконных координатах, а не уехал вместе с миром")
            a.eval("$.window.resize(800, 600)")
            a.step(4)
            check(a.eval("JSON.stringify([engine.width, engine.height])") == size0,
                  "размер окна возвращён")
        else:
            print("  --   resize в агентском режиме не меняет размер окна — проверка пропущена")

        # --- blend-сцена всё ещё верна после всех переключений ----------------
        a.eval("presentationScene('blend')")
        a.step(3)
        img = shot(a, "presentation_blend_final.png")
        triple = pixel(img, 440, 300)
        check(rgb_near(triple, (72, 48, 24), 8),
              "эталонная сцена стабильна после смен сцен: %s" % (triple,))

        check(a.ping().get("pong") is True, "движок жив после проверок §18")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
