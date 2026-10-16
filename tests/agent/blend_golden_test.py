#!/usr/bin/env python3
# ===========================================================================
# §40.2: golden-сцены блендинга.
#
# Фикстура tests/fixtures/blend_golden рисует одну и ту же сцену (подложка +
# полупрозрачная накладка) и меняет ТОЛЬКО режим смешивания накладки. Для
# каждого режима на диске лежит эталонный PNG, снятый один раз локально и
# закоммиченный. Тест:
#   * берёт список режимов из РЕАЛЬНОГО реестра движка: он просит неизвестный
#     режим, движок сам печатает «доступны: …», и список парсится оттуда; его
#     длина сверяется с renderInfo().sprite_pipelines (счётчик из C);
#   * сверяет живой кадр каждого режима с эталоном по числу различающихся
#     пикселей и по максимальной разнице на канал;
#   * проверяет ожидаемые значения на трёх точках (накладка, подложка, фон) по
#     формулам режимов, посчитанным из цвета сцены, который отдаёт фикстура;
#   * требует, чтобы кадры разных режимов РАЗЛИЧАЛИСЬ: если режим совпал с
#     другим (тихий откат в alpha), это названо провалом с именем режима, а не
#     пропущено;
#   * проверяет, что неизвестный режим диагностируется: `$.blend()` называет
#     список доступных, узел откатывается в alpha, и кадр совпадает с alpha.
#
# Перегенерация эталонов (после осознанного изменения сцены/блендинга):
#   python3 tests/agent/blend_golden_test.py --write-golden
# Команда перезаписывает tests/fixtures/blend_golden/golden/<режим>.png и тут же
# печатает наблюдённую разницу «живой кадр против только что записанного» —
# по этим числам и выбирались допуски ниже.
#
# Допуски и почему такие:
#   * CHANNEL_TOLERANCE = 2. Сравнение идёт на том же бэкенде, поэтому разница
#     может появиться только от округления блендинга в UNORM8 (round-to-nearest
#     против truncate в бленд-юните разных GPU/Metal/Vulkan). Наблюдённый
#     максимум — 0–1 LSB. 2 LSB оставляют запас, но структурная ошибка (не тот
#     режим, сдвиг геометрии) двигает целый регион на 16–100+ LSB и в допуск не
#     попадает: это проверяет отдельный счётчик пикселей «выше допуска».
#   * MAX_DIFF_SHARE = 0.01 (1% кадра). Пиксели ровно на кромке прямоугольника
#     теоретически могут разойтись на 1 LSB от растеризации; 1% от 76800 — это
#     768 пикселей, тогда как смена режима меняет тысячи.
#   * MIN_MODE_DIFF_PIXELS = 500: кадры двух РАЗНЫХ режимов обязаны отличаться
#     заметно (область накладки — 120x80 = 9600 пикселей).
#
# Запуск (после сборки):
#   python3 tests/agent/blend_golden_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/blend_golden_test.py
# ===========================================================================

import os
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "blend_golden")
GOLDEN_DIR = os.path.join(GAME, "golden")

FAILURES = []

# Допуски (обоснование — в шапке файла).
CHANNEL_TOLERANCE = 2
MAX_DIFF_SHARE = 0.01
MIN_MODE_DIFF_PIXELS = 500

# Имя, которого в реестре заведомо нет: по нему движок сам называет доступные
# режимы. Форму проверки менять не нужно, даже если реестр вырастет.
UNKNOWN_MODE = "__probe_unknown_mode__"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


# ---------------------------------------------------------------------------
# Разбор PNG — тот же, что в tests/agent/light_receiver_mask_test.py
# (стандартная библиотека, без внешних зависимостей).
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


def pixel(image, x, y):
    width, height, channels, data = image
    x = max(0, min(width - 1, int(x)))
    y = max(0, min(height - 1, int(y)))
    o = (y * width + x) * channels
    return data[o], data[o + 1], data[o + 2]


def avg_pixel(image, x, y, half=3):
    """Средний цвет квадрата — точка замера не должна дрожать от одного пикселя."""
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


def diff_stats(a_img, b_img):
    """(различающихся пикселей, максимум разницы на канал, пикселей выше допуска)."""
    aw, ah, ac, ad = a_img
    bw, bh, bc, bd = b_img
    if (aw, ah) != (bw, bh):
        return None
    differing = 0
    over = 0
    max_delta = 0
    for i in range(aw * ah):
        oa = i * ac
        ob = i * bc
        delta = 0
        for c in range(3):
            d = abs(ad[oa + c] - bd[ob + c])
            if d > delta:
                delta = d
        if delta:
            differing += 1
            if delta > CHANNEL_TOLERANCE:
                over += 1
        if delta > max_delta:
            max_delta = delta
    return differing, max_delta, over


# ---------------------------------------------------------------------------
# Журнал движка приходит АСИНХРОННО
# ---------------------------------------------------------------------------
def wait_log(a, needle, attempts=25, step=1):
    """Дождаться строки в журнале движка с пределом, а не читать один раз.

    stderr движка приезжает отдельным потоком и к моменту ответа на `eval` может
    ещё не лежать в буфере клиента: на нагруженной машине строка опаздывает, и
    однократное чтение даёт «сообщения нет» (наблюдение task-64: 2 провала из 5
    при load ~3.6, при этом отдельно тест зелёный). Ждём до `attempts` шагов по
    `step` кадров, каждый раз перечитывая буфер; возвращаем текст журнала.
    """
    text = a.stderr_text()
    for _ in range(max(0, attempts)):
        if needle in text:
            return text
        a.step(step)
        text = a.stderr_text()
    return text


def log_tail(text, lines=6):
    """Хвост журнала для диагностики: что было вместо ожидаемой строки."""
    rows = [line.strip() for line in text.splitlines() if line.strip()]
    return " | ".join(rows[-lines:])


# ---------------------------------------------------------------------------
# Реестр режимов: список берём у движка, а не из головы
# ---------------------------------------------------------------------------
def engine_modes(a):
    """Список режимов из сообщения самого движка + сверка с числом в C."""
    a.eval("$.blend('alpha'); 'ok'")
    kept = a.eval("$.blend('%s')" % UNKNOWN_MODE)
    check(kept == "alpha",
          "неизвестный режим не меняет текущий (%s → %s)" % (UNKNOWN_MODE, kept))

    log = wait_log(a, "доступны:")
    listed = None
    source = ""
    for line in log.splitlines():
        if "доступны:" in line:
            listed = [m.strip() for m in line.split("доступны:", 1)[1].split(",") if m.strip()]
            source = line.strip()
    check(bool(listed), "движок сам назвал доступные режимы: %s"
          % (source or "сообщения нет; хвост журнала: %s" % log_tail(log)))
    if not listed:
        return []

    pipelines = a.eval("engine.renderInfo().sprite_pipelines")
    check(len(listed) == pipelines,
          "список режимов совпал с числом конвейеров в C: %d == %s" % (len(listed), pipelines))

    roundtrip = []
    for mode in listed:
        got = a.eval("$.blend('%s')" % mode)
        if got != mode:
            roundtrip.append("%s → %s" % (mode, got))
    a.eval("$.blend('alpha'); 'ok'")
    check(not roundtrip, "каждый режим реестра принимается движком (%s)" % (roundtrip or "все"))
    check(UNKNOWN_MODE in source and UNKNOWN_MODE in log,
          "диагностика назвала именно неизвестный режим (%s)" % UNKNOWN_MODE)
    return listed


# ---------------------------------------------------------------------------
# Ожидание по формулам режимов (из цветов, которые отдаёт фикстура)
# ---------------------------------------------------------------------------
def expected_over(mode, colors):
    """Ожидаемый цвет накладки над подложкой. None — формула режима не описана."""
    src = colors["over"]
    dst = colors["back"]
    alpha = colors["over_alpha"] / 255.0
    if mode == "alpha":
        return [src[i] * alpha + dst[i] * (1.0 - alpha) for i in range(3)]
    if mode == "add":
        return [src[i] * alpha + dst[i] for i in range(3)]
    if mode == "multiply":
        return [src[i] * dst[i] / 255.0 for i in range(3)]
    if mode == "none":
        return [float(src[i]) for i in range(3)]
    return None


def shoot(a, mode, directory):
    a.eval("$.fixture.mode('%s'); 'ok'" % mode)
    a.step(2)
    return a.screenshot(os.path.join(directory, "blend_%s.png" % mode))


def run(write_golden):
    shots = tempfile.mkdtemp(prefix="r2d_blend_golden_")
    golden_path = lambda mode: os.path.join(GOLDEN_DIR, "%s.png" % mode)   # noqa: E731

    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(3)

        modes = engine_modes(a)
        if not modes:
            return
        print("  --   режимы движка: %s" % ", ".join(modes))

        colors = a.eval("$.fixture.colors()")
        geom = a.eval("$.fixture.geometry()")
        win = a.eval("$.window.size()")
        px = a.eval("$.window.pixels()")
        scale_x = px["w"] / float(win["w"])
        scale_y = px["h"] / float(win["h"])
        print("  --   кадр %sx%s, буфер %sx%s, масштаб %.2f" %
              (win["w"], win["h"], px["w"], px["h"], scale_x))

        # --- Запись эталонов (режим перегенерации) ----------------------------
        if write_golden:
            os.makedirs(GOLDEN_DIR, exist_ok=True)
            for mode in modes:
                path = golden_path(mode)
                a.eval("$.fixture.mode('%s'); 'ok'" % mode)
                a.step(2)
                a.screenshot(path)
                # Сразу же снимаем ещё один кадр и меряем разницу с записанным:
                # эти числа и есть обоснование допусков.
                again = read_png(shoot(a, mode, shots))
                stats = diff_stats(read_png(path), again)
                print("  --   эталон %-9s %s: различается %d px, максимум %d LSB, выше допуска %d"
                      % (mode, os.path.basename(path), stats[0], stats[1], stats[2]))
            print("\nЭталоны перезаписаны в %s" % GOLDEN_DIR)
            return

        # --- Эталоны на месте? -------------------------------------------------
        missing = [m for m in modes if not os.path.isfile(golden_path(m))]
        check(not missing,
              "эталоны есть для каждого режима (нет: %s). Перегенерировать: "
              "python3 tests/agent/blend_golden_test.py --write-golden" % (missing or "нет"))
        if missing:
            return

        # --- Каждый режим против своего эталона --------------------------------
        live = {}
        for mode in modes:
            frame_path = shoot(a, mode, shots)
            live[mode] = read_png(frame_path)
            w, h, _, _ = live[mode]
            gold = read_png(golden_path(mode))
            gs = diff_stats(gold, live[mode])
            check(gs is not None and (w, h) == (gold[0], gold[1]),
                  "режим %-9s: размер кадра совпал с эталоном (%dx%d)" % (mode, w, h))
            if gs is None:
                continue
            differing, max_delta, over = gs
            total = w * h
            check(over == 0,
                  "режим %-9s: нет пикселей с разницей > %d LSB (максимум %d, таких %d)"
                  % (mode, CHANNEL_TOLERANCE, max_delta, over))
            check(differing <= total * MAX_DIFF_SHARE,
                  "режим %-9s: различается %d px из %d (%.3f%% <= %.1f%%), максимум %d LSB"
                  % (mode, differing, total, 100.0 * differing / total,
                     100.0 * MAX_DIFF_SHARE, max_delta))

        # --- Ожидаемые значения на трёх точках ---------------------------------
        probes = (("накладка", geom["probe_over"], True),
                  ("подложка", geom["probe_back"], False),
                  ("фон", geom["probe_bg"], False))
        for mode in modes:
            formula = expected_over(mode, colors)
            if formula is None:
                check(False, "режим %-9s: формула смешивания в тесте не описана — "
                             "добавь её и перегенерируй эталон" % mode)
                continue
            for label, point, overlay in probes:
                want = formula if overlay else (
                    colors["back"] if label == "подложка" else colors["bg"])
                got = avg_pixel(live[mode], point["x"] * scale_x, point["y"] * scale_y)
                bad = [i for i in range(3) if abs(got[i] - want[i]) > CHANNEL_TOLERANCE]
                check(not bad,
                      "режим %-9s, %-9s: RGB %s ≈ ожидание %s"
                      % (mode, label,
                         tuple(round(v, 1) for v in got), tuple(round(v, 1) for v in want)))

        # --- Режимы обязаны отличаться друг от друга ---------------------------
        for i, first in enumerate(modes):
            for second in modes[i + 1:]:
                stats = diff_stats(live[first], live[second])
                differing = stats[0] if stats else 0
                check(differing >= MIN_MODE_DIFF_PIXELS,
                      "режимы %s и %s различаются: %d px (>= %d)"
                      % (first, second, differing, MIN_MODE_DIFF_PIXELS))

        # --- Неизвестный режим: честная диагностика, а не тихий пропуск --------
        a.eval("$.blend('alpha'); 'ok'")
        before = a.eval("$.blend()")
        after = a.eval("$.blend('%s')" % UNKNOWN_MODE)
        check(after == before,
              "неизвестный режим у $.blend не меняет состояние (%s → %s)" % (before, after))
        effective = a.eval("$.fixture.mode('%s')" % UNKNOWN_MODE)
        check(effective == "alpha",
              "узел с неизвестным режимом откатывается в alpha (действует %s)" % effective)
        unknown_path = shoot(a, UNKNOWN_MODE, shots)
        stats = diff_stats(read_png(golden_path("alpha")), read_png(unknown_path))
        check(stats is not None and stats[0] <= (px["w"] * px["h"]) * MAX_DIFF_SHARE,
              "кадр с неизвестным режимом совпал с alpha (различается %s px)"
              % (stats[0] if stats else "?"))
        log = wait_log(a, UNKNOWN_MODE)
        check(UNKNOWN_MODE in log,
              "движок записал в журнал, что режим %s неизвестен (хвост: %s)"
              % (UNKNOWN_MODE, log_tail(log)))

        a.eval("$.fixture.mode('alpha'); 'ok'")

    print("  --   кадры прогона: %s" % shots)


def main():
    write_golden = "--write-golden" in sys.argv[1:]
    run(write_golden)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
