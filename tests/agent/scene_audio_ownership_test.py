#!/usr/bin/env python3
# ===========================================================================
# BASHNYA G1 (task-54): смена сцены глушит звук уходящей сцены.
#
# Дока `docs/highlevel/sound.md` обещала: музыка — часть сцены, сменилась
# сцена → всё, что она запустила, перестаёт играть; переживает переход только
# `{ keep: true }`. Фактически владение было привязано к области §5 и комнате,
# а к `$.scene` — нет: музыка меню играла поверх следующей сцены (живой замер
# BASHNYA: через 2 с в новой сцене `musicPlaying()` → true).
#
# Проверяется ЧИСЛАМИ: `musicPlaying()` до/после, сколько миллисекунд идёт
# затухание, что с `play`/`playAt` уходящей сцены, что переживает `{ keep: true }`,
# и что быстрый повторный переход не оставляет «хвостов».
#
# Запуск:
#   python3 tests/agent/scene_audio_ownership_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/scene_audio_ownership_test.py
# ===========================================================================

import math
import os
import struct
import sys
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
DIR = os.path.join(ROOT, "build", "scene_audio")
FADE_LIMIT_MS = 600          # затухание по умолчанию 250 мс; допуск на кадры
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


def write_wav(path, freq, seconds=1.0, rate=44100):
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"".join(
            struct.pack("<h", int(0.4 * 32767 * math.sin(2 * math.pi * freq * i / rate)))
            for i in range(int(rate * seconds))))


def wait_until(a, code, timeout=1.5, step_ms=20):
    """Ждём, пока выражение станет истинным; возвращаем (стало, мс)."""
    started = time.perf_counter()
    while (time.perf_counter() - started) * 1000 < timeout * 1000:
        if a.eval(code) is True:
            return True, (time.perf_counter() - started) * 1000
        a.step(1)
        time.sleep(step_ms / 1000.0)
    return False, (time.perf_counter() - started) * 1000


def main():
    os.makedirs(DIR, exist_ok=True)
    write_wav(os.path.join(DIR, "menu.wav"), 220)
    write_wav(os.path.join(DIR, "level.wav"), 330)
    write_wav(os.path.join(DIR, "ui.wav"), 880)
    menu = DIR.replace("\\", "/") + "/menu.wav"
    level = DIR.replace("\\", "/") + "/level.wav"
    ui = DIR.replace("\\", "/") + "/ui.wav"

    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(5)
        check(a.eval("typeof $.sound.musicPlaying") == "function", "$.sound.musicPlaying() есть")

        # --- Воспроизведение G1: музыка сцены не гасла ----------------------
        a.eval("$.sound.music('%s', { loop: true, volume: 0.5 })" % menu)
        channel = a.eval("$.sound.play('%s', { loop: true })" % ui)
        a.step(2)
        number("до смены: musicPlaying=%s, канал %s играет=%s"
               % (a.eval("$.sound.musicPlaying()"), channel, a.eval("$.sound.playing(%d)" % channel)))
        check(a.eval("$.sound.musicPlaying()") is True, "музыка меню играет")
        check(a.eval("$.sound.playing(%d)" % channel) is True, "звук меню играет")

        a.eval("$.scene.load('second', { transition: 'none' })")
        a.step(1)
        # Сразу после перехода звук ещё гаснет (затухание), поэтому проверяем
        # и «погасло», и «за это время»: без единой строки кода игры.
        gone, ms = wait_until(a, "$.sound.musicPlaying() === false")
        number("музыка меню погасла через %.0f мс после $.scene.load('second')" % ms)
        check(gone, "музыка уходящей сцены погасла сама: musicPlaying() === false")
        check(ms <= FADE_LIMIT_MS,
              "затухание уложилось в %d мс: %.0f мс" % (FADE_LIMIT_MS, ms))
        chan_gone, chan_ms = wait_until(a, "$.sound.playing(%d) === false" % channel)
        number("звук меню (play) погас через %.0f мс" % chan_ms)
        check(chan_gone, "звук уходящей сцены (play) тоже снят")
        check(a.eval("$.scene.current()") == "second", "сцена действительно сменилась: %s" % a.eval("$.scene.current()"))

        # --- Затухание слышно в миксе, а не только по флагу -----------------
        # Флаг `musicPlaying()` снимается сразу (это состояние, а не звук),
        # поэтому «есть ли затухание» проверяем по ЗАХВАТУ микса: RMS в начале
        # должен быть заметно выше, чем через 150–300 мс.
        a.eval("$.sound.music('%s', { loop: true, volume: 1.0 })" % menu)
        a.step(3)
        a.eval("$.audio.captureClear(); $.audio.captureStart(22050)")
        a.eval("$.scene.load('second', { transition: 'none' })")
        a.step(1)
        deadline = time.perf_counter() + 4.0
        captured = a.eval("$.audio.captured()")
        while time.perf_counter() < deadline and captured["frames"] < 22050:
            a.step(1)
            captured = a.eval("$.audio.captured()")
            time.sleep(0.01)
        samples = captured["samples"]
        rate = captured["rate"] or 44100

        def rms(from_s, to_s):
            window = samples[int(from_s * rate) * 2:int(to_s * rate) * 2]
            return math.sqrt(sum(x * x for x in window) / max(1, len(window)))

        early = rms(0.0, 0.05)
        late = rms(0.25, 0.35)
        number("затухание по захвату микса: RMS 0–50 мс %.5f → 250–350 мс %.5f (кадров %d)"
               % (early, late, captured["frames"]))
        check(early > late * 3 or (early < 0.005 and late < 0.005),
              "звук не обрывается мгновенно: хвост затухает (%.5f → %.5f)" % (early, late))
        check(a.eval("$.sound.musicPlaying()") is False, "после затухания музыка действительно снята")

        # --- keep: сквозная тема переживает переход -------------------------
        a.eval("$.sound.music('%s', { loop: true, keep: true })" % level)
        keep_channel = a.eval("$.sound.play('%s', { loop: true, keep: true })" % ui)
        a.step(2)
        a.eval("$.scene.load('main', { transition: 'none' })")
        a.step(6)
        number("keep после смены: musicPlaying=%s, канал %s играет=%s"
               % (a.eval("$.sound.musicPlaying()"), keep_channel, a.eval("$.sound.playing(%d)" % keep_channel)))
        check(a.eval("$.sound.musicPlaying()") is True, "{ keep: true } музыку переход не снимает")
        check(a.eval("$.sound.playing(%d)" % keep_channel) is True, "{ keep: true } звук тоже переживает")
        a.eval("$.sound.stopMusic(0); $.sound.stopAll(0)")
        a.step(3)
        check(a.eval("$.sound.musicPlaying()") is False, "ручная остановка работает")

        # --- Быстрый повторный переход: меню → вступление → уровень ---------
        a.eval("$.sound.music('%s', { loop: true })" % menu)
        a.eval("$.scene.load('second', { transition: 'none' })")
        a.eval("$.scene.load('main', { transition: 'none' })")     # во время затухания
        a.step(4)
        quick, quick_ms = wait_until(a, "$.sound.musicPlaying() === false")
        number("после быстрых переходов музыка погасла через %.0f мс" % quick_ms)
        check(quick, "быстрый повторный переход не оставляет играющую музыку")
        check(a.eval("$.scene.current()") in ("main", "second"),
              "сцена в согласованном состоянии: %s" % a.eval("$.scene.current()"))

        # --- Комната + сцена -------------------------------------------------
        a.eval("$.sound.music('%s', { loop: true })" % level)
        a.step(2)
        room_ok = a.eval("(() => { try { $.room.enter('room:test'); return true; } catch (e) { return String(e); } })()")
        number("вход в комнату: %s" % room_ok)
        a.eval("$.scene.load('second', { transition: 'none' })")
        a.step(4)
        room_gone, _ = wait_until(a, "$.sound.musicPlaying() === false")
        check(room_gone, "смена сцены снимает и звук, запущенный при комнате")

        check(a.ping().get("pong") is True, "движок отвечает")

    print()
    for line in NUMBERS:
        print("  --   " + line)
    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
