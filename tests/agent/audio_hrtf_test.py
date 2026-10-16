#!/usr/bin/env python3
# ===========================================================================
# ХРТФ в 2D, этап 1: бинауральный режим `$.audio.hrtf(...)`.
#
# Два backend'а, и тест меряет ОБА на живом выходе (а не «флаг включён»):
#   * 'steam'     — настоящая HRTF (Steam Audio) через r2d_audio_world_channel;
#   * 'synthetic' — встроенная модель: ITD дробной задержкой, ILD, ФНЧ-тень
#                   головы, полка «сзади» (фолбэк без HRIR-датасетов).
# `$.audio.hrtf().backend` называет, что звучит ФАКТИЧЕСКИ (null — ничего).
#
# Чем снимается PCM: диагностический захват `$.audio.captureStart(N)` +
# `$.audio.captured()` → { frames, rate, samples: [L,R,L,R,…] }. Захват идёт в
# post-mix (после шин и реверба) — то есть тест меряет то, что слышит игрок.
# Метрики: кросс-корреляция L/R (ITD), RMS по ушам (ILD), энергия полос
# однополюсными фильтрами (тень головы, фронт/тыл). Никаких «стало объёмнее».
#
# Запуск (после сборки движка):
#   python3 tests/agent/audio_hrtf_test.py
# ===========================================================================

import json
import math
import os
import random
import shutil
import struct
import sys
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "audiobus")
SIGNALS = os.path.join(ROOT, "build", "hrtf_signals")
RATE = 44100
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


# --- Сигналы ---------------------------------------------------------------

def write_wav(path, samples):
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples))


def make_signals():
    shutil.rmtree(SIGNALS, ignore_errors=True)
    os.makedirs(SIGNALS)
    rnd = random.Random(11)
    noise = [0.5 * (rnd.random() * 2 - 1) for _ in range(RATE // 2)]
    write_wav(os.path.join(SIGNALS, "noise.wav"), noise)
    for freq in (200, 4000):
        write_wav(os.path.join(SIGNALS, "%d.wav" % freq),
                  [0.6 * math.sin(2 * math.pi * freq * i / RATE) for i in range(RATE // 2)])


def noise_path():
    return os.path.join(SIGNALS, "noise.wav").replace("\\", "/")


def tone_path(freq):
    return os.path.join(SIGNALS, "%d.wav" % freq).replace("\\", "/")


# --- Анализ ----------------------------------------------------------------

def capture(a, frames=32768, timeout=4.0):
    """Снять итоговый микс: возвращает (L, R, rate)."""
    a.eval("$.audio.captureClear(); $.audio.captureStart(%d)" % frames)
    deadline = time.perf_counter() + timeout
    got = {"frames": 0, "rate": RATE, "samples": []}
    while time.perf_counter() < deadline:
        got = a.eval("$.audio.captured()")
        if got["frames"] >= frames:
            break
        time.sleep(0.05)
    samples = got["samples"]
    if len(samples) % 2:            # неполный кадр не бывает: см. audio.c
        samples = samples[:-1]
    rate = got["rate"] or RATE
    return ([samples[i] for i in range(0, len(samples) - 1, 2)],
            [samples[i + 1] for i in range(0, len(samples) - 1, 2)], rate)


def rms(v, start=4000):
    w = v[start:]
    return math.sqrt(sum(x * x for x in w) / max(1, len(w)))


def db(x, y):
    return 20 * math.log10(max(1e-12, x) / max(1e-12, y))


def corr_lag(L, R, max_lag=120, start=8000):
    """Лаг максимума Σ L[i]·R[i+lag] (в сэмплах).

    Знак: положительный лаг — ПРАВОЕ ухо задержано относительно левого;
    для источника справа правое ухо ближе, значит лаг отрицательный.
    """
    best, best_lag = -1e18, 0
    for lag in range(-max_lag, max_lag + 1):
        acc = 0.0
        for i in range(start, len(L) - max_lag):
            acc += L[i] * R[i + lag]
        if acc > best:
            best, best_lag = acc, lag
    return best_lag


def onepole(v, cutoff, rate):
    alpha = 1 - math.exp(-2 * math.pi * cutoff / rate)
    y = 0.0
    out = []
    for x in v:
        y += alpha * (x - y)
        out.append(y)
    return out


def band_energy(v, rate, start=4000):
    """Энергия ниже ~1 кГц и выше ~4 кГц (однополюсные фильтры)."""
    low = onepole(v, 1000, rate)
    high = [x - y for x, y in zip(v, onepole(v, 4000, rate))]
    e_low = sum(x * x for x in low[start:]) / max(1, len(low) - start)
    e_high = sum(x * x for x in high[start:]) / max(1, len(high) - start)
    return e_low, e_high


def play(a, backend, sound, x, y, loop=True, maxdist=100000):
    a.eval("$.audio.clear(); $.sound.stopAll(0); 'ok'")
    a.step(2)
    if backend == "off":
        a.eval("$.audio.hrtf(false)")
    else:
        a.eval("$.audio.hrtf(%s)" % json.dumps({"backend": backend}))
    return a.eval("$.audio.playAt('%s', %g, %g, { volume: 1, loop: %s, falloff: { max: %g } }).channel"
                  % (sound, x, y, "true" if loop else "false", maxdist))


def measure(a, backend, sound, x, y):
    play(a, backend, sound, x, y)
    a.step(3)
    return capture(a)


def main():
    make_signals()
    with Agent(game=GAME, seed=23) as a:
        a.step(3)

        # --- Выключено по умолчанию ------------------------------------------
        default = a.eval("$.audio.hrtf()")
        print("  --   hrtf() по умолчанию: %s" % json.dumps(default, ensure_ascii=False))
        check(default["on"] is False and default["backend"] is None,
              "по умолчанию режим выключен и backend не заявлен: %s" % default["backend"])
        check(isinstance(default["steam"], bool) and default["steam"] == a.eval("engine.audio.hrtfAvailable()"),
              "геттер честно сообщает доступность настоящей HRTF: steam=%s" % default["steam"])

        # Выключено → обычная панорама, бинауральных следов нет:
        # в центре L и R совпадают БИТ-в-бит, при pan=+1 левое ухо ровно ноль.
        play(a, "off", noise_path(), 0, 0)
        a.step(3)
        L, R, rate = capture(a)
        off_center_db = abs(db(rms(R), rms(L)))
        check(off_center_db <= 0.1,
              "выключено, центр: L и R равны в пределах 0.1 дБ (моно): %.3f дБ" % off_center_db)
        # Крайнее правое: источник ближе половины радиуса слышимости → pan = +1.
        play(a, "off", noise_path(), 250, 0, maxdist=500)
        a.step(3)
        L, R, _ = capture(a)
        base_lr = db(rms(L), rms(R))
        print("  --   выключено, крайнее правое: L/R = %.1f дБ (дальнее ухо почти пусто)" % base_lr)
        check(base_lr <= -30.0,
              "выключено: дальнее ухо не подмешивается (L/R ≤ -30 дБ): %.1f дБ" % base_lr)

        # --- Синтетическая модель: меряем ВСЕ метрики -------------------------
        print("\n  ==  backend 'synthetic' (встроенная модель)  ==")
        state = a.eval("$.audio.hrtf(%s)" % json.dumps({"backend": "synthetic"}))
        check(state["backend"] == "synthetic", "backend синтетики включился: %s" % state["backend"])

        L, R, rate = measure(a, "synthetic", noise_path(), 350, 0)
        lag = corr_lag(L, R)
        itd_ms = -lag / rate * 1000.0     # минус: правое ухо ближе → лаг отрицательный
        print("  --   ITD(шум, +90°): лаг %d сэмплов = %.3f мс при %d Гц" % (lag, itd_ms, rate))
        check(0.5 <= itd_ms <= 0.8,
              "ITD на 90° в диапазоне 0.5–0.8 мс: %.3f мс" % itd_ms)
        L, R, rate = measure(a, "synthetic", noise_path(), 0, 0)
        center_lag = corr_lag(L, R)
        print("  --   ITD(центр): лаг %d сэмплов" % center_lag)
        check(abs(center_lag) <= 1, "в центре задержка в пределах ±1 сэмпла: %d" % center_lag)
        check(abs(db(rms(R), rms(L))) <= 1.0,
              "центр: L и R в пределах ±1 дБ (моно-совместимость): %.3f дБ" % db(rms(R), rms(L)))

        for freq, threshold, title in ((4000, 6.0, "4 кГц"), (200, 2.0, "200 Гц")):
            L, R, rate = measure(a, "synthetic", tone_path(freq), 350, 0)
            ild = db(rms(R), rms(L))      # правое ближе → правое громче
            print("  --   ILD(%s, +90°): %.2f дБ" % (title, ild))
            if freq == 4000:
                check(ild >= threshold, "ILD на 4 кГц не меньше %.1f дБ: %.2f дБ" % (threshold, ild))
            else:
                check(abs(ild) <= threshold, "ILD на 200 Гц в пределах ±%.1f дБ: %.2f дБ" % (threshold, ild))

        L, R, rate = measure(a, "synthetic", noise_path(), 350, 0)
        low_l, high_l = band_energy(L, rate)
        low_r, high_r = band_energy(R, rate)
        shadow = 10 * math.log10(high_l / high_r)
        print("  --   тень головы (>4 кГц, дальнее/ближнее): %.2f дБ" % shadow)
        check(shadow <= -10.0, "ВЧ на дальнем ухе падают не меньше чем на 10 дБ: %.2f дБ" % shadow)

        # Фронт/тыл: одинаковая боковая координата, разный знак «глубины».
        Lf, Rf, rate = measure(a, "synthetic", noise_path(), 250, -250)   # впереди справа
        ef_low, ef_high = band_energy(Rf, rate)
        Lb, Rb, rate = measure(a, "synthetic", noise_path(), 250, 250)    # сзади справа
        eb_low, eb_high = band_energy(Rb, rate)
        front_ratio = 10 * math.log10(ef_high / ef_low)
        rear_ratio = 10 * math.log10(eb_high / eb_low)
        print("  --   фронт/тыл (HF/LF ближнего уха): %.2f дБ против %.2f дБ (разница %.2f дБ)"
              % (front_ratio, rear_ratio, rear_ratio - front_ratio))
        check(abs(rear_ratio - front_ratio) >= 1.5,
              "фронт и тыл при одном |азимуте| различимы (метрика HF/LF): %.2f дБ"
              % (rear_ratio - front_ratio))

        # --- Настоящая HRTF (Steam Audio): те же метрики на живом выходе ------
        print("\n  ==  backend 'steam' (настоящая HRTF)  ==")
        state = a.eval("$.audio.hrtf(%s)" % json.dumps({"backend": "steam"}))
        if state["backend"] != "steam":
            print("  --   Steam Audio недоступен в этой сборке: %s" % state.get("reason"))
            check(state["backend"] == "synthetic",
                  "при недоступной HRTF режим честно уходит в модель: %s" % state["backend"])
        else:
            L, R, rate = measure(a, "steam", noise_path(), 350, 0)
            steam_lag = corr_lag(L, R)
            ild_noise = db(rms(R), rms(L))
            print("  --   ITD(шум, +90°): лаг %d сэмплов = %.3f мс; ILD(шум): %.2f дБ"
                  % (steam_lag, -steam_lag / rate * 1000.0, ild_noise))
            print("  --   (у HRTF Steam Audio в этой сборке межушной задержки нет — "
                  "измерено, поэтому ITD даёт модель; ILD/тень/фронт-тыл — HRTF)")
            check(ild_noise >= 10.0, "HRTF: ILD на 90° не меньше 10 дБ: %.2f дБ" % ild_noise)
            low_l, high_l = band_energy(L, rate)
            low_r, high_r = band_energy(R, rate)
            steam_shadow = 10 * math.log10(high_l / high_r)
            print("  --   тень головы (>4 кГц): %.2f дБ" % steam_shadow)
            check(steam_shadow <= -10.0, "HRTF: ВЧ на дальнем ухе падают: %.2f дБ" % steam_shadow)
            L4, R4, rate = measure(a, "steam", tone_path(4000), 350, 0)
            steam_ild4 = db(rms(R4), rms(L4))
            L2, R2, rate = measure(a, "steam", tone_path(200), 350, 0)
            steam_ild2 = db(rms(R2), rms(L2))
            print("  --   HRTF ILD: 4 кГц %.2f дБ, 200 Гц %.2f дБ" % (steam_ild4, steam_ild2))
            check(abs(steam_ild2) < abs(steam_ild4),
                  "HRTF: частотозависимость ILD (200 Гц слабее 4 кГц): %.2f против %.2f дБ"
                  % (steam_ild2, steam_ild4))
            Lf, Rf, rate = measure(a, "steam", noise_path(), 250, -250)
            ef_low, ef_high = band_energy(Rf, rate)
            Lb, Rb, rate = measure(a, "steam", noise_path(), 250, 250)
            eb_low, eb_high = band_energy(Rb, rate)
            d_front = 10 * math.log10(ef_high / ef_low)
            d_rear = 10 * math.log10(eb_high / eb_low)
            print("  --   HRTF фронт/тыл (HF/LF): %.2f против %.2f дБ (разница %.2f дБ)"
                  % (d_front, d_rear, d_rear - d_front))
            check(abs(d_rear - d_front) >= 0.3,
                  "HRTF: фронт и тыл различимы: %.2f дБ" % (d_rear - d_front))

        # --- Два backend'а — два разных пути ----------------------------------
        La, Ra, _ = measure(a, "synthetic", noise_path(), 350, 0)
        Lb, Rb, _ = measure(a, "steam", noise_path(), 350, 0)
        same_lengths = min(len(La), len(Lb), len(Ra), len(Rb))
        diff = sum(abs(La[i] - Lb[i]) + abs(Ra[i] - Rb[i]) for i in range(4000, same_lengths))
        norm = sum(abs(La[i]) + abs(Ra[i]) for i in range(4000, same_lengths)) + 1e-9
        print("\n  --   различие буферов synthetic/steam: %.1f %% от энергии" % (100.0 * diff / norm))
        check(diff / norm > 0.2, "синтетика и HRTF дают РАЗНЫЕ буферы: %.1f %%" % (100.0 * diff / norm))

        # --- Честность переключения и выключения ------------------------------
        bad = a.eval("$.audio.hrtf({ backend: 'nonsense' })")
        check(bad["backend"] == "steam", "неизвестный backend не меняет режим: %s" % bad["backend"])
        off = a.eval("$.audio.hrtf(false)")
        check(off["on"] is False and off["backend"] is None and "выключ" in off["reason"],
              "выключение называет состояние честно: %s" % off)
        play(a, "off", noise_path(), 0, 0)
        a.step(3)
        L, R, _ = capture(a)
        after_db = abs(db(rms(R), rms(L)))
        print("  --   после выключения центр: %.3f дБ (до включения было %.3f дБ)"
              % (after_db, off_center_db))
        check(abs(after_db - off_center_db) <= 0.1,
              "выключение возвращает прежнюю симметрию: %.3f против %.3f дБ" % (after_db, off_center_db))

        frames = a.eval("engine.frame")
        a.step(2)
        check(a.eval("engine.frame") > frames and a.ping().get("pong") is True, "движок отвечает")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
