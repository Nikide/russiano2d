#!/usr/bin/env python3
# ===========================================================================
# Приёмка §22: атласы — страницы, padding/extrusion, import-манифест, ошибки.
#
# Проверяет по РЕАЛЬНОМУ движку:
#   * два кадра на соседних страницах одного файла рисуются из своих регионов;
#   * кадр не «протекает» на соседа при linear-фильтрации и мипмапах (политика
#     padding/extrusion, иначе мипмапы выключаются — числа в pages());
#   * отсутствующая страница даёт структурированную ошибку ($.debug.errors() и
#     $.atlas.errors()), а не пустой спрайт;
#   * повёрнутый кадр отклоняет весь обязательный атлас с точной диагностикой;
#   * import-манифест (hash, версия, импортёр) читается и проверяется.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_atlas_test.py
# ===========================================================================

import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "render_atlas")
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


def pixel(image, x, y):
    width, height, channels, data = image
    x = max(0, min(width - 1, int(x)))
    y = max(0, min(height - 1, int(y)))
    o = (y * width + x) * channels
    return (data[o], data[o + 1], data[o + 2])


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=13) as a:
        a.step(3)

        # --- Страницы одного файла --------------------------------------------
        check(a.eval("typeof $.atlas.verify") == "function", "$.atlas.verify() есть")
        check(a.eval("typeof $.atlas.errors") == "function", "$.atlas.errors() есть")
        check(a.eval("atlasSheets.hero !== null") is True, "атлас hero загружен")
        check(a.eval("atlasSheets.paged !== null") is True, "мультистраничный атлас загружен")
        check(a.eval("atlasSheets.padded !== null") is True, "атлас с padding загружен")

        pages = a.eval("JSON.stringify(atlasSheets.paged.pages())")
        print("  --   страницы: %s" % (pages,))
        check('"name":"body"' in pages and '"name":"props"' in pages, "обе страницы описаны")
        check(a.eval("atlasSheets.paged.page('body_0')") == 0, "кадр body_0 на первой странице")
        check(a.eval("atlasSheets.paged.page('prop_0')") == 1, "кадр prop_0 на второй странице")
        check(a.eval("atlasSheets.paged.tag('run')") == [], "у атласа без тегов тег пуст")
        check(a.eval("atlasSheets.hero.tag('run').length") == 2, "тег run из двух кадров")
        # size() раньше падал с ReferenceError (свободное имя texture), хотя
        # docs/highlevel/atlas.md его обещает: проверяем фактический размер.
        hero_size = a.eval("JSON.stringify(atlasSheets.hero.size())")
        check(hero_size and hero_size != "[0,0]",
              "size() отдаёт размер листа без исключения (%s)" % hero_size)
        check(a.eval("atlasSheets.hero.info('run_1').duration") == 80, "длительность кадра 80 мс")

        # --- Мипмапы: политика padding/extrusion ------------------------------
        hero_pages = a.eval("JSON.stringify(atlasSheets.hero.pages())")
        padded_pages = a.eval("JSON.stringify(atlasSheets.padded.pages())")
        print("  --   мипмапы: без padding %s; с padding %s" % (hero_pages, padded_pages))
        check('"mipmaps":false' in hero_pages,
              "атлас без padding грузится без мипмапов (защита от протечки)")
        check('"mipmaps":true' in padded_pages,
              "атлас с padding/extrusion грузится с мипмапами")

        # --- Кадры рисуются из своих регионов --------------------------------
        a.step(2)
        shot = os.path.join(shots, "atlas_pages.png")
        a.screenshot(shot)
        img = read_png(shot)
        red = pixel(img, 300, 300)
        green = pixel(img, 450, 300)
        print("  --   кадры: run_0=%s prop_0=%s" % (red, green))
        check(red[0] > 180 and red[2] < 70, "кадр первой страницы красный: %s" % (red,))
        check(green[1] > 180 and green[0] < 70, "кадр второй страницы зелёный: %s" % (green,))

        # Край кадра не должен «протекать» в соседний (синий) при linear.
        edge = pixel(img, 307, 300)
        check(edge[2] < 70, "край кадра не затягивает соседа через linear: %s" % (edge,))

        # --- Import-манифест --------------------------------------------------
        man = a.eval("JSON.stringify($.atlas.manifest('hero'))")
        print("  --   манифест: %s" % (man,))
        check('"version":1' in man and '"contentHash":"h1"' in man
              and 'r2d-atlas/1.0' in man and 'raw/hero.ase' in man,
              "манифест импорта прочитан целиком")

        # --- Проверка данных без загрузки ------------------------------------
        report = a.eval("JSON.stringify($.atlas.verify(atlasData(), "
                        "{ manifestVersion: 1, importer: 'r2d-atlas/1.0' }))")
        print("  --   verify: %s" % (report,))
        check('"ok":true' in report, "данные атласа проходят проверку")
        check('atlas_no_padding' in report,
              "отсутствие padding отмечено предупреждением, а не ошибкой")

        # --- Отсутствующая страница: структурированная ошибка -----------------
        a.eval("$.atlas.clearErrors(); $.debug.clearErrors(); 'ok'")
        missing = a.eval("""(() => {
            const s = $.atlas.load('broken', { data: {
                meta: { pages: [{ name: 'body', image: 'assets/nope.png' }] },
                frames: { a: { frame: { x: 0, y: 0, w: 8, h: 8 }, page: 'body' } },
            } });
            return s === null;
        })()""")
        check(missing is True, "атлас с отсутствующей страницей не загружается")
        codes = a.eval("$.atlas.errors().map(function (e) { return e.code; })")
        check("atlas_page_missing" in codes, "$.atlas.errors(): %s" % (codes,))
        diag = a.eval("$.debug.errors().map(function (e) { return e.code + '@' + e.subsystem; })")
        print("  --   diagnostics: %s" % (diag,))
        check(any(c.split("@")[0] == "atlas_page_missing" for c in diag),
              "ошибка попала и в $.debug.errors() с подсистемой: %s" % (diag,))

        # --- Повёрнутый кадр: весь обязательный атлас отклоняется -------------
        a.eval("$.atlas.clearErrors(); $.debug.clearErrors(); 'ok'")
        rot = a.eval("""(() => {
            const data = { meta: { image: 'assets/pages.png' },
                           frames: { r0: { frame: { x: 0, y: 0, w: 32, h: 32, rotated: true } } } };
            const rejected = $.atlas.load('rot', { data }) === null;
            const allowed = $.atlas.load('rot_ok', { data, allowRotated: true }) !== null;
            return { rejected, allowed };
        })()""")
        print("  --   поворот: %s" % (rot,))
        check(rot.get("rejected") is True, "повёрнутый кадр отклоняет атлас целиком")
        check(rot.get("allowed") is True, "allowRotated: true — явное разрешение работает")
        codes = a.eval("$.atlas.errors().map(function (e) { return e.code; })")
        check("atlas_rotated_frame" in codes, "код ошибки поворота: %s" % (codes,))

        # --- Нет кадров: понятная причина ------------------------------------
        a.eval("$.atlas.clearErrors(); 'ok'")
        empty = a.eval("$.atlas.load('empty', { data: { frames: {} } }) === null")
        check(empty is True, "атлас без кадров не загружается")
        check("atlas_no_frames" in a.eval("$.atlas.errors().map(function (e) { return e.code; })"),
              "код atlas_no_frames")

        check(a.ping().get("pong") is True, "движок жив после проверок §22")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
