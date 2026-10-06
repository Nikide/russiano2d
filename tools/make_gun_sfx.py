#!/usr/bin/env python3
# ===========================================================================
# Выстрелы для демо «Типичная ночь в Мытищинском лесу»: пистолет, дробовик, тесла.
#
# Почему синтез, а не скачивание: OpenGameArt отдаёт 403 на автоматический
# запрос, а тянуть случайные семплы из поиска — лотерея с лицензиями. Здесь
# каждый выстрел собирается из шума и тона с честной огибающей: короткий
# щелчок + низкий «толчок» + хвост. Результат детерминирован (фиксированный
# seed) и лежит в репозитории как обычные wav.
#
# Использование:
#   python3 tools/make_gun_sfx.py
# ===========================================================================

import math
import os
import random
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "demos", "assets", "audio", "sfx")
RATE = 44100


def envelope(t, attack, decay, power=2.0):
    if t < attack:
        return t / attack
    k = (t - attack) / max(1e-4, decay)
    return math.pow(max(0.0, 1.0 - k), power) if k < 1.0 else 0.0


def shot(duration, attack, decay, noise, body_hz, body_amt, crack, rng, lowpass=0.35):
    """Один выстрел: шум + низкий тон + щелчок в начале."""
    n = int(RATE * duration)
    out = []
    prev = 0.0
    for i in range(n):
        t = i / RATE
        env = envelope(t, attack, decay)
        # Шум с однополюсным фильтром: резче и глуше, чем белый.
        raw = rng.uniform(-1.0, 1.0)
        prev = prev + lowpass * (raw - prev)
        s = prev * noise * env
        # Низкий «толчок» ствола.
        s += math.sin(2 * math.pi * body_hz * t) * body_amt * env
        # Щелчок: очень короткий всплеск в первые миллисекунды.
        if t < 0.004:
            s += rng.uniform(-1.0, 1.0) * crack * (1.0 - t / 0.004)
        out.append(max(-1.0, min(1.0, s)))
    return out


def zap(duration, rng):
    """Тесла: треск с быстро прыгающей частотой."""
    n = int(RATE * duration)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / RATE
        env = envelope(t, 0.002, duration * 0.75, 1.6)
        freq = 900 + 2600 * abs(math.sin(2 * math.pi * 7 * t)) + rng.uniform(-120, 120)
        phase += 2 * math.pi * freq / RATE
        s = math.sin(phase) * 0.5 * env
        s += rng.uniform(-1.0, 1.0) * 0.25 * env
        out.append(max(-1.0, min(1.0, s)))
    return out


def save(name, samples):
    path = os.path.join(OUT, name)
    data = b"".join(struct.pack("<h", int(s * 32000)) for s in samples)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data)
    print("звук: %s (%.2f с)" % (path, len(samples) / RATE))


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = random.Random(20261006)

    # Пистолет: коротко, звонко, с щелчком.
    save("gun_pistol.wav", shot(0.16, 0.0008, 0.055, 0.85, 150, 0.5, 0.7, rng, 0.55))
    # Дробовик: длиннее, ниже, «бум».
    save("gun_shotgun.wav", shot(0.34, 0.0012, 0.16, 1.0, 85, 0.75, 0.5, rng, 0.35))
    # Тесла: треск.
    save("gun_tesla.wav", zap(0.28, rng))


if __name__ == "__main__":
    main()
