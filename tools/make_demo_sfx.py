#!/usr/bin/env python3
# ===========================================================================
# Генератор недостающих звуков для демо-шутера.
#
# Зачем свой синтез, а не скачивание: у процедурных звуков нет лицензии и
# автора, они воспроизводимы одной командой и весят копейки. Остальные звуки
# демо берёт из набора Juhani Junkala (CC0, см. LICENSE-файл рядом).
#
# Использование:
#   python3 tools/make_demo_sfx.py
# ===========================================================================

import math
import os
import random
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "demos", "assets", "audio", "sfx")
RATE = 44100


def write_wav(name, samples, rate=RATE):
    path = os.path.join(OUT, name)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for s in samples:
            v = max(-1.0, min(1.0, s))
            frames += struct.pack("<h", int(v * 32000))
        w.writeframes(bytes(frames))
    print("записан %s (%.2f с)" % (path, len(samples) / rate))


def env(t, attack, decay):
    """Простая огибающая: быстрый вход, экспоненциальный спад."""
    if t < attack:
        return t / max(1e-6, attack)
    return math.exp(-(t - attack) / max(1e-6, decay))


def zap(dur=0.28):
    """Электрический разряд: пила вниз + шум, резкий спад."""
    n = int(RATE * dur)
    out = []
    random.seed(7)
    phase = 0.0
    for i in range(n):
        t = i / RATE
        k = env(t, 0.004, 0.07)
        f = 1800.0 * math.exp(-t * 9) + 180.0        # свип вниз
        phase += 2 * math.pi * f / RATE
        saw = 2.0 * ((phase / (2 * math.pi)) % 1.0) - 1.0
        noise = random.uniform(-1, 1)
        crackle = 1.0 if (i // 140) % 2 == 0 else 0.35   # «треск» разряда
        out.append(0.5 * k * crackle * (0.7 * saw + 0.5 * noise))
    return out


def blackhole(dur=2.6):
    """Схлопывание: низкий гул, подъём и обрыв в удар."""
    n = int(RATE * dur)
    out = []
    random.seed(11)
    phase = 0.0
    lp = 0.0
    for i in range(n):
        t = i / RATE
        p = t / dur
        # Гул уходит вниз по частоте, к концу — удар.
        f = 90.0 * (1.0 - 0.75 * p) + 18.0
        phase += 2 * math.pi * f / RATE
        tone = math.sin(phase) + 0.4 * math.sin(phase * 0.5)
        noise = random.uniform(-1, 1)
        lp += 0.02 * (noise - lp)                      # тёмный шум
        amp = 0.25 + 0.75 * p                            # нарастание
        if p > 0.92:
            amp *= (1.0 - (p - 0.92) / 0.08) ** 0.6      # обрыв
        out.append(0.55 * amp * (0.8 * tone + 0.6 * lp))
    return out


def cast(dur=0.45):
    """Колдовство: восходящий синус с вибрато."""
    n = int(RATE * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / RATE
        k = env(t, 0.05, 0.25)
        f = 320.0 + 520.0 * (t / dur)
        phase += 2 * math.pi * f / RATE
        vib = 1.0 + 0.02 * math.sin(2 * math.pi * 7 * t)
        out.append(0.4 * k * math.sin(phase * vib))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    write_wav("witch_zap.wav", zap())
    write_wav("witch_blackhole.wav", blackhole())
    write_wav("witch_cast.wav", cast())


if __name__ == "__main__":
    main()
