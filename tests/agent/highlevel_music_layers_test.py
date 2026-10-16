#!/usr/bin/env python3
# ===========================================================================
# §25 (P1-08): музыкальные слои и transport.
#
# Проверяется то, что нельзя проверить юнит-тестом: нативные PCM-позиции
# слоёв. Старт, seek и pause идут одной командой под локом микшера, поэтому
# слои обязаны стоять в фазе (расхождение — 0 кадров), а не «примерно рядом».
#
# Числа, которые печатает тест:
#   * расхождение слоёв в кадрах и миллисекундах после старта и после seek;
#   * позиция после зацикливания (должна вернуться к loopStart, а не к нулю);
#   * громкости слоёв во время кроссфейда (сумма не превышает единицу).
#
# Звуки тест генерирует сам (3 с, 44.1 кГц, щелчки на 0/1/2 с) — в фикстурах
# звуков нет. Устройство вывода в headless может быть dummy, но transport
# считает реальные PCM-кадры SDL_mixer.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_music_layers_test.py
# ===========================================================================

import math
import os
import struct
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "music")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def make_wav(path, seconds=3.0, sr=44100, clicks=(0.0, 1.0, 2.0), freq=880.0):
    """Короткий щелчок в каждой точке: по нему слышно и петлю, и рассинхрон."""
    n = int(sr * seconds)
    data = bytearray()
    for i in range(n):
        t = i / sr
        v = 0
        for c in clicks:
            d = t - c
            if 0.0 <= d < 0.05:
                v += int(12000 * math.sin(2 * math.pi * freq * d) * (1 - d / 0.05))
        data += struct.pack("<h", max(-32000, min(32000, v)))
    hdr = (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt "
           + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
           + b"data" + struct.pack("<I", len(data)))
    with open(path, "wb") as f:
        f.write(hdr + bytes(data))
    return path


def main():
    stem_a = make_wav(os.path.join(tempfile.gettempdir(), "r2d_stem_a.wav"))
    stem_b = make_wav(os.path.join(tempfile.gettempdir(), "r2d_stem_b.wav"))
    print("  слои: %s, %s" % (stem_a, stem_b))

    with Agent(game=GAME, seed=3) as a:
        # --- Транспорт слоёв существует ---------------------------------------
        check(a.eval("typeof $.sound.stems") == "function", "$.sound.stems() есть")
        count = a.eval(
            "(() => { globalThis.__m = $.sound.stems(['%s', '%s'],"
            " { loop: true, loopStart: 1.0, loopEnd: 3.0 });"
            " return globalThis.__m ? globalThis.__m.count() : -1; })()" % (stem_a, stem_b))
        check(count == 2, "два слоя созданы (count=%s)" % count)

        # --- Старт: один sample-clock на все слои ------------------------------
        a.eval("globalThis.__m.play({ fade: 0 }); true")
        a.step(20)
        state = a.eval("JSON.stringify(engine.audio.stemsState())")
        frames = a.eval("[globalThis.__m.frames(0), globalThis.__m.frames(1)]")
        times = a.eval("globalThis.__m.times()")
        drift_ms = a.eval("globalThis.__m.drift()")
        check(a.eval("globalThis.__m.playing()") is True, "транспорт играет")
        check(frames[0] == frames[1],
              "§25: слои стартовали с одного sample-clock (кадры %s)" % frames)
        check(abs(drift_ms) < 0.001,
              "§25: расхождение слоёв после старта %.4f мс" % drift_ms)
        check(abs(times[0] - times[1]) < 1e-6, "позиции слоёв совпадают: %s" % times)
        check("1000" in state, "транспорт помнит точку петли (loopStart=1000 мс)")

        # --- Seek применяется ко всем слоям одинаково --------------------------
        a.eval("globalThis.__m.seek(1.5); true")
        a.step(4)
        frames_seek = a.eval("[globalThis.__m.frames(0), globalThis.__m.frames(1)]")
        drift_seek = a.eval("globalThis.__m.drift()")
        check(abs(frames_seek[0] - frames_seek[1]) <= 1,
              "§25: после seek слои в фазе (кадры %s, расхождение %.4f мс)"
              % (frames_seek, drift_seek))
        check(1.45 < a.eval("globalThis.__m.time(0)") < 1.65,
              "§25: seek действительно перемотал (t=%.3f)" % a.eval("globalThis.__m.time(0)"))

        # --- Pause применяется ко всем слоям -----------------------------------
        a.eval("globalThis.__m.pause(true); true")
        a.step(1)
        stopped = a.eval("[globalThis.__m.time(0), globalThis.__m.time(1)]")
        a.step(10)
        stopped2 = a.eval("[globalThis.__m.time(0), globalThis.__m.time(1)]")
        check(abs(stopped[0] - stopped2[0]) < 1e-6 and abs(stopped[1] - stopped2[1]) < 1e-6,
              "§25: пауза остановила все слои (%s → %s)" % (stopped, stopped2))
        check(a.eval("globalThis.__m.paused()") is True, "транспорт знает, что он на паузе")
        a.eval("globalThis.__m.pause(false); true")
        a.step(5)
        check(a.eval("globalThis.__m.time(0)") > stopped2[0],
              "§25: после resume слои едут дальше")
        check(abs(a.eval("globalThis.__m.drift()")) < 0.001,
              "§25: пауза/resume не развели слои (%.4f мс)" % a.eval("globalThis.__m.drift()"))

        # --- Кроссфейд слоёв: огибающая, сумма не выше единицы ------------------
        a.eval("globalThis.__m.crossfade(1, 500); true")
        a.step(15)                       # ≈ 250 мс из 500
        mid = a.eval("[globalThis.__m.layerGain(0), globalThis.__m.layerGain(1)]")
        check(abs(mid[0] - mid[1]) < 0.15,
              "§25: кроссфейд идёт симметрично (%.3f / %.3f)" % (mid[0], mid[1]))
        check(mid[0] + mid[1] <= 1.0001,
              "§25: сумма громкостей слоёв не превышает единицу (%.3f)" % (mid[0] + mid[1]))
        a.step(30)
        end = a.eval("[globalThis.__m.layerGain(0), globalThis.__m.layerGain(1)]")
        check(abs(end[0]) < 1e-6 and abs(end[1] - 1) < 1e-6,
              "§25: кроссфейд дошёл до цели (%s)" % end)

        # --- Шина музыки умножается на громкость слоя (§48) ---------------------
        a.eval("$.audio.volume('music', 0.5); true")
        a.step(2)
        gains = a.eval("[engine.audio.stemGain(0), engine.audio.stemGain(1)]")
        check(abs(gains[0]) < 1e-6 and abs(gains[1] - 0.5) < 1e-4,
              "§25/§48: громкость шины music применена к слоям (%s)" % gains)
        a.eval("$.audio.volume('music', 1); true")
        a.step(2)

        # --- Зацикливание без щели: возврат к loopStart, а не к нулю -----------
        a.eval("globalThis.__m.seek(2.9); true")
        a.step(2)
        before_loop = a.eval("globalThis.__m.time(0)")
        wrapped = None
        for _ in range(40):                       # ждём реального времени звука
            time.sleep(0.05)
            a.step(1)
            t = a.eval("globalThis.__m.time(0)")
            if t < before_loop - 0.5:
                wrapped = t
                break
            before_loop = max(before_loop, t)
        check(wrapped is not None,
              "§25: транспорт зациклился (позиция дошла до %.3f с)" % before_loop)
        if wrapped is not None:
            check(0.9 <= wrapped <= 1.15,
                  "§25: петля вернулась к loopStart (1.0 с), а не к нулю: %.3f с" % wrapped)
            check(a.eval("globalThis.__m.playing()") is True,
                  "§25: после петли транспорт всё ещё играет (щели нет)")
            frames_loop = a.eval("[globalThis.__m.frames(0), globalThis.__m.frames(1)]")
            check(abs(frames_loop[0] - frames_loop[1]) <= 1,
                  "§25: после петли слои в фазе (кадры %s)" % frames_loop)

        # --- Stop и освобождение ------------------------------------------------
        a.eval("globalThis.__m.stop(0); true")
        a.step(2)
        check(a.eval("globalThis.__m.playing()") is False, "§25: stop остановил транспорт")

        # --- Второй транспорт не путается с первым ------------------------------
        two = a.eval(
            "(() => { globalThis.__m2 = $.sound.stems(['%s'], { loop: false });"
            " globalThis.__m2.play({ fade: 0 }); return globalThis.__m2.count(); })()" % stem_a)
        a.step(3)
        check(two == 1, "одиночный слой создаётся отдельным транспортом")
        check(a.eval("globalThis.__m2.time(0)") >= 0, "у второго транспорта своя позиция")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, "в кадре нет ошибок игрового кода: %s" % errors[:2])
        check(a.ping().get("pong") is True, "движок отвечает")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
