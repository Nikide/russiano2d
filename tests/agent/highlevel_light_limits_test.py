#!/usr/bin/env python3
# ===========================================================================
# Приёмка §20: лимиты качества света, маски, неосвещённые узлы, динамический
# occluder и инвалидация по затронутой области.
#
# Проверяет числами и пикселями:
#   * превышение лимита источников с тенями даёт документированную деградацию
#     (свет остаётся, тень уходит) и предупреждение, а не тихую потерю света;
#   * maxRays / maxSegments урезают работу и попадают в stats()/qualityReport();
#   * маска препятствий (occluderMask + mask у отрезка) разделяет свет и
#     препятствия;
#   * узел с .lit(false) не получает ни света, ни темноты, но остаётся в мире;
#   * свои препятствия узла (.occluders) реально заслоняют свет;
#   * изменение реестра пересчитывает тени только у источников рядом, а индекс
#     дополняется без полного пересбора.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_light_limits_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "light_limits")
FAILURES = []


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


def luma(image, lx, ly, half=10, scale_x=1.0, scale_y=1.0):
    width, height, channels, data = image
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
            total += data[o] + data[o + 1] + data[o + 2]
            count += 3
    return total / float(max(1, count))


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=9) as a:
        a.step(3)

        # --- API профиля качества --------------------------------------------
        check(a.eval("typeof $.gfx.light.quality") == "function", "$.gfx.light.quality() есть")
        check(a.eval("typeof $.gfx.light.qualityReport") == "function",
              "$.gfx.light.qualityReport() есть")
        q = a.eval("$.gfx.light.quality()")
        check(isinstance(q, dict) and q.get("maxShadowLights") == 32 and q.get("maxRays") == 96,
              "умолчания профиля: %s" % (q,))
        check(q.get("lightmapScale") == 0.5, "разрешение карты света сообщается как факт сборки")
        a.eval("$.gfx.light.quality({ maxShadowLights: 1, maxRays: 16, maxSegments: 64 })")
        q2 = a.eval("$.gfx.light.quality()")
        check(q2.get("maxShadowLights") == 1 and q2.get("maxRays") == 16 and q2.get("maxSegments") == 64,
              "профиль применяется: %s" % (q2,))

        def shot(name):
            path = os.path.join(shots, name)
            a.screenshot(path)
            image = read_png(path)
            sx = image[0] / float(a.eval("engine.width"))
            sy = image[1] / float(a.eval("engine.height"))
            return image, sx, sy

        # --- budget: источников с тенями больше лимита ------------------------
        a.eval("lightScene('budget')")
        a.step(3)
        img, sx, sy = shot("light_limits_budget.png")
        far_lit = luma(img, 650, 300, 12, sx, sy)
        near_lit = luma(img, 150, 300, 12, sx, sy)
        a.step(1)
        report = a.eval("$.gfx.light.qualityReport()")
        print("  --   бюджет: %s" % (report,))
        check(report.get("lights") == 3, "все три источника активны (%s)" % report.get("lights"))
        check(report.get("shadowLights") == 1, "тени считает только лимит (%s)" % report.get("shadowLights"))
        check(report.get("culledLights") == 2, "лишние источники деградировали (%s)" % report.get("culledLights"))
        check(report.get("warned", {}).get("shadows") is True, "о лимите теней есть предупреждение")
        check(near_lit > 40 and far_lit > 40,
              "свет не пропал у источников без теней (%s / %s)" % (near_lit, far_lit))
        check(abs(near_lit - far_lit) < 60,
              "деградация не выключает источник целиком (%s ≈ %s)" % (near_lit, far_lit))

        # --- maxRays урезает веер, а не молчит --------------------------------
        a.eval("$('#b_lamp0').attr('segments', 200); 'ok'")
        a.step(1)
        rays_report = a.eval("$.gfx.light.qualityReport()")
        check(rays_report.get("degradedRays", 0) >= 1,
              "segments сверх maxRays засчитан как деградация: %s" % (rays_report.get("degradedRays"),))
        check(rays_report.get("warned", {}).get("rays") is True, "о лимите лучей есть предупреждение")
        a.eval("$('#b_lamp0').attr('segments', 24); 'ok'")

        # --- maxSegments ------------------------------------------------------
        a.eval("lightScene('mask')")
        a.eval("$.gfx.light.quality({ maxSegments: 16 })")
        a.eval("$.gfx.light.occluders((() => { const out = [];"
               " for (let i = 0; i < 30; i++) out.push({ x: 200 + i, y: 200, w: 8, h: 8 }); return out; })())")
        a.step(1)
        seg_report = a.eval("$.gfx.light.qualityReport()")
        check(seg_report.get("degradedSegments", 0) >= 1,
              "лимит отрезков засчитан: %s" % (seg_report.get("degradedSegments"),))
        check(seg_report.get("warned", {}).get("segments") is True, "о лимите отрезков есть предупреждение")
        a.eval("$.gfx.light.quality({ maxShadowLights: 32, maxRays: 96, maxSegments: 4096 })")

        # --- маска препятствий ------------------------------------------------
        a.eval("lightScene('mask')")
        a.step(3)
        img, sx, sy = shot("light_limits_mask_all.png")
        shadowed = luma(img, 400, 300, 10, sx, sy)     # за препятствием
        control = luma(img, 200, 420, 10, sx, sy)      # на том же радиусе, открыто
        a.eval("$('#m_lamp').occluderMask(2); 'ok'")
        a.step(3)
        img, sx, sy = shot("light_limits_mask_filtered.png")
        free = luma(img, 400, 300, 10, sx, sy)
        print("  --   маска: в тени=%s, открыто=%s, чужая маска=%s" % (shadowed, control, free))
        check(shadowed < control * 0.6, "препятствие с подходящей маской даёт тень (%s < %s)"
              % (shadowed, control))
        check(free > shadowed * 1.5, "чужая маска пропускает свет (%s > %s)" % (free, shadowed))
        check(a.eval("$('#m_lamp').occluderMask()") == 2, ".occluderMask() читается")
        a.eval("$('#m_lamp').occluderMask(0); 'ok'")

        # --- unlit: узел вне света и темноты ----------------------------------
        a.eval("lightScene('unlit')")
        a.step(3)
        img, sx, sy = shot("light_limits_unlit_ambient.png")
        a.eval("$.gfx.light.ambient({ level: 1, color: '#000000' })")
        a.step(3)
        img, sx, sy = shot("light_limits_unlit_dark.png")
        lit_px = luma(img, 400, 120, 12, sx, sy)
        unlit_px = luma(img, 400, 480, 12, sx, sy)
        print("  --   unlit: lit=%s, unlit=%s (темнота level 1)" % (lit_px, unlit_px))
        check(lit_px < 20, "обычный узел гаснет в темноте (%s)" % lit_px)
        check(unlit_px > 100, "узел .lit(false) темноту не получает (%s)" % unlit_px)
        a.eval("$.gfx.light.ambient.off(); $('#u_lamp').show(); 'ok'")
        a.step(3)
        img, sx, sy = shot("light_limits_unlit_light.png")
        lit_light = luma(img, 400, 120, 12, sx, sy)
        unlit_light = luma(img, 400, 480, 12, sx, sy)
        print("  --   unlit под светом: lit=%s, unlit=%s" % (lit_light, unlit_light))
        check(lit_light > 150, "обычный узел светится под фонарём (%s)" % lit_light)
        check(unlit_light < 140, "узел .lit(false) светом не засвечивается (%s)" % unlit_light)
        check(a.eval("$('#u_unlit').lit()") is False, ".lit() читается")
        a.eval("$('#u_lamp').hide(); 'ok'")

        # --- динамический occluder: свои препятствия узла --------------------
        a.eval("lightScene('dynamic')")
        a.step(4)
        img, sx, sy = shot("light_limits_dynamic_off.png")
        open_px = luma(img, 400, 300, 10, sx, sy)
        a.eval("$('#d_crate').show(); 'ok'")
        a.step(4)
        img, sx, sy = shot("light_limits_dynamic_on.png")
        blocked_px = luma(img, 400, 300, 10, sx, sy)
        a.step(1)
        stats = a.eval("$.gfx.light.stats()")
        print("  --   динамический occluder: открыто=%s, заслонено=%s, built=%s"
              % (open_px, blocked_px, stats.get("built")))
        check(blocked_px < open_px * 0.6,
              "свои препятствия узла заслоняют свет (%s < %s)" % (blocked_px, open_px))

        # --- инвалидация только затронутой области ----------------------------
        # Сначала «засеваем» реестр так, чтобы сетка индекса покрывала уровень
        # (рамка 0..800): тогда последующая правка дописывается в индекс без
        # полного пересбора, а кэш теней остаётся точечным.
        a.eval("lightScene('far')")
        a.eval("$.gfx.light.addOccluders([{ x: 0, y: 0, w: 800, h: 600 }]); 'ok'")
        a.step(3)
        a.eval("$.gfx.light.resetStats(); 'ok'")
        a.step(1)
        warm = a.eval("$.gfx.light.stats()")
        check(warm.get("built") == 0 and warm.get("cached") == 2,
              "прогретый кадр берёт обе тени из кэша (built=%s, cached=%s)"
              % (warm.get("built"), warm.get("cached")))
        a.eval("$.gfx.light.addOccluders([{ x: 200, y: 280, w: 20, h: 40 }]); 'ok'")
        a.eval("$.gfx.light.resetStats(); 'ok'")
        a.step(1)
        near_change = a.eval("$.gfx.light.stats()")
        print("  --   правка рядом с A: built=%s, cached=%s, indexAppended=%s, indexRebuilt=%s"
              % (near_change.get("built"), near_change.get("cached"),
                 near_change.get("indexAppended"), near_change.get("indexRebuilt")))
        check(near_change.get("built") == 1 and near_change.get("cached") == 1,
              "пересчитан только ближний источник (built=%s, cached=%s)"
              % (near_change.get("built"), near_change.get("cached")))
        check(near_change.get("indexAppended") == 1 and near_change.get("indexRebuilt") == 0,
              "индекс дополнен без полного пересбора (appended=%s, rebuilt=%s)"
              % (near_change.get("indexAppended"), near_change.get("indexRebuilt")))
        a.eval("$.gfx.light.resetStats(); 'ok'")
        a.step(1)
        warm2 = a.eval("$.gfx.light.stats()")
        check(warm2.get("built") == 0 and warm2.get("cached") == 2,
              "после правки кэш снова работает (built=%s, cached=%s)"
              % (warm2.get("built"), warm2.get("cached")))

        # --- световая карта: композит виден в счётчиках ------------------------
        a.eval("$.gfx.light.map({ on: true, soft: 2 }); 'ok'")
        a.step(2)
        stats = a.eval("$.gfx.light.stats()")
        check(stats.get("lightmap") is True and stats.get("compositePasses") == 3,
              "карта света сообщает проходы композита (%s)" % (stats.get("compositePasses"),))
        a.eval("$.gfx.light.map({ on: false }); 'ok'")
        a.step(1)

        # --- материалы спрайтов (§20.2) ---------------------------------------
        check(a.eval("typeof $.gfx.material") == "function", "$.gfx.material() есть")
        check(a.eval("typeof $.gfx.flatNormal") == "function", "$.gfx.flatNormal() есть")
        flat = a.eval("JSON.stringify($.gfx.flatNormal())")
        check(flat == "[0.5,0.5,1]", "нейтральная норма — (0.5,0.5,1): %s" % (flat,))
        a.eval("lightScene('material')")
        a.step(3)
        img, sx, sy = shot("light_limits_material.png")
        plain_px = luma(img, 250, 200, 12, sx, sy)
        flat_px = luma(img, 400, 200, 12, sx, sy)
        norm_px = luma(img, 550, 200, 12, sx, sy)
        tint_px = luma(img, 400, 450, 12, sx, sy)
        print("  --   материалы: plain=%s flat=%s normal=%s tint=%s"
              % (plain_px, flat_px, norm_px, tint_px))
        check(abs(plain_px - flat_px) < 2,
              "материал без normal-карты совпадает с базовым (flat normal): %s ≈ %s"
              % (plain_px, flat_px))
        check(abs(plain_px - norm_px) < 2,
              "материал с normal-картой пока рисуется нейтральной нормой: %s ≈ %s"
              % (plain_px, norm_px))
        check(tint_px < plain_px * 0.7,
              "tint материала умножает albedo (%s < %s)" % (tint_px, plain_px))

        mats = a.eval("$.gfx.materials()")
        check(isinstance(mats, list) and "glow" in mats and "metal" in mats,
              "реестр материалов: %s" % (mats,))
        glow = a.eval("$.gfx.material('glow')")
        check(isinstance(glow, dict) and glow.get("lit") is False and glow.get("perPixelNormal") is False,
              "материал читается с полями: %s" % (glow,))
        check(a.eval("$('#mat_glow').material().lit") is False,
              ".material() узла отдаёт материал")

        # §20.2: расширенный путь объявлен недоступным, и это видно машине.
        check(a.eval("$.gfx.perPixelNormal()") is False,
              "$.gfx.perPixelNormal() по умолчанию false")
        path = a.eval("$.gfx.normalPath()")
        check(isinstance(path, dict) and path.get("supported") is False
              and path.get("fallback") == "flat_normal",
              "normalPath() объявляет fallback: %s" % (path,))
        check(a.eval("$.gfx.perPixelNormal(true)") is False,
              "запрос расширенного режима честно возвращает false")

        # Emissive: в полной темноте обычный узел чёрный, светящийся — виден.
        a.eval("$.gfx.light.ambient({ level: 1, color: '#000000' })")
        a.step(3)
        img, sx, sy = shot("light_limits_material_dark.png")
        dark_plain = luma(img, 250, 200, 12, sx, sy)
        dark_glow = luma(img, 250, 450, 12, sx, sy)
        print("  --   emissive в темноте: plain=%s glow=%s" % (dark_plain, dark_glow))
        check(dark_plain < 20, "обычный узел в темноте гаснет (%s)" % dark_plain)
        check(dark_glow > 100, "emissive-материал светится в темноте (%s)" % dark_glow)
        a.eval("$.gfx.light.ambient.off(); 'ok'")

        # --- Замеры: числа, не «стало лучше» ---------------------------------
        # Восемь источников с тенями и реестр из 1000 отрезков. Мерим: сколько
        # теней пересчитывается при правке рядом с одним источником, сколько
        # лучей считается за кадр, сколько стоит пересбор индекса и досыпка.
        a.eval("""(() => {
            lightScene('far');
            $('#f_a').hide();
            $('#f_b').hide();
            $.gfx.light.quality({ maxShadowLights: 32, maxRays: 96, maxSegments: 4096 });
            $.gfx.light.occluders([]);
            // восемь фонарей в ряд, каждый со своими тенями
            for (let i = 0; i < 8; i++) {
                $('<light>', { id: 'm_l' + i, radius: 90, intensity: 1, color: '#ffffff',
                               shadows: true, segments: 48 })
                    .at(80 + i * 90, 500).blend('add').appendTo($.world);
            }
            // 1000 отрезков-препятствий на другом краю уровня
            const many = [];
            for (let i = 0; i < 250; i++) many.push({ x: 0, y: 0 + i * 2, w: 4, h: 1 });
            $.gfx.light.addOccluders(many);
            return 1;
        })()""")
        a.step(3)
        a.eval("$.gfx.light.resetStats(); 'ok'")
        a.step(1)
        warm = a.eval("$.gfx.light.stats()")
        rays_per_frame = warm.get("rays")
        print("  --   замер: 8 источников, 1000 отрезков — прогретый кадр: built=%s cached=%s rays=%s"
              % (warm.get("built"), warm.get("cached"), rays_per_frame))
        check(warm.get("built") == 0 and warm.get("cached") == 8,
              "все восемь теней берутся из кэша (built=%s, cached=%s)"
              % (warm.get("built"), warm.get("cached")))
        check(rays_per_frame == 0, "в прогретом кадре лучи не считаются (%s)" % (rays_per_frame,))

        # Правка рядом с ОДНИМ источником: остальные семь не пересчитываются.
        a.eval("$.gfx.light.addOccluders([{ x: 70, y: 460, w: 8, h: 8 }]); 'ok'")
        a.eval("$.gfx.light.resetStats(); 'ok'")
        a.step(1)
        moved = a.eval("$.gfx.light.stats()")
        print("  --   замер: правка рядом с одним — built=%s cached=%s (было бы 8 без области)"
              % (moved.get("built"), moved.get("cached")))
        check(moved.get("built") == 1 and moved.get("cached") == 7,
              "пересчитан один источник из восьми (built=%s, cached=%s)"
              % (moved.get("built"), moved.get("cached")))

        # Цена пересбора индекса против досыпки (мс, одна и та же карта).
        ms_rebuild = a.eval("(() => { const t0 = $.time.perfNow(); "
                            "$.gfx.light.occluders([{ x: 0, y: 0, w: 800, h: 600 }]); "
                            "return $.time.perfNow() - t0; })()")
        a.step(1)
        ms_append = a.eval("(() => { const t0 = $.time.perfNow(); "
                           "$.gfx.light.addOccluders([{ x: 200, y: 200, w: 4, h: 4 }]); "
                           "return $.time.perfNow() - t0; })()")
        a.step(1)
        idx = a.eval("$.gfx.light.stats()")
        print("  --   замер: замена реестра %.3f мс, досыпка %.3f мс (appended=%s, rebuilt=%s, "
              "отрезков через индекс=%s)"
              % (ms_rebuild, ms_append, idx.get("indexAppended"), idx.get("indexRebuilt"),
                 idx.get("indexSegments")))
        check(idx.get("indexSegments") == idx.get("indexRebuilt") * 1000 + 0
              or idx.get("indexSegments") < 1000,
              "досыпка обрабатывает только новые отрезки (indexSegments=%s)"
              % (idx.get("indexSegments"),))
        check(idx.get("indexAppended") == 1 and idx.get("indexRebuilt") == 0,
              "досыпка внутри сетки не пересобирает индекс")

        check(a.ping().get("pong") is True, "движок жив после проверок §20")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
