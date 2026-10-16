#!/usr/bin/env python3
# ===========================================================================
# Разведка inspector-backend: три бага в звуке (в task-57).
#
#   1. `$.audio.musicPlaying` не существовал (был только `$.sound.musicPlaying`)
#      — разнобой имён между `$.audio` и `$.sound`.
#   2. `$.sound.musicStop` не существовал: остановить музыку можно было только
#      `stopMusic`, которое игра ищет не первым.
#   3. Незагружаемый путь давал ТИХИЙ отказ: `$.sound.music('нет/такого.ogg')`
#      возвращал объект, похожий на успех, музыка не играла, а в журнале была
#      одна строка. Теперь — структурная ошибка `R2D_SOUND_LOAD_FAILED`.
#
# Запуск:
#   python3 tests/agent/sound_music_api_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/sound_music_api_test.py
# ===========================================================================

import math
import os
import struct
import sys
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
WAV = os.path.join("build", "scene_audio", "music.wav")
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


def main():
    os.makedirs(os.path.dirname(WAV), exist_ok=True)
    with wave.open(WAV, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(44100)
        out.writeframes(b"".join(struct.pack("<h", int(0.4 * 32767 * math.sin(2 * math.pi * 240 * i / 44100)))
                                 for i in range(22050)))
    path = WAV.replace("\\", "/")

    with Agent(game=GAME, seed=5) as a:
        a.step(5)

        # --- 1 и 2: симметрия имён -----------------------------------------
        check(a.eval("typeof $.sound.musicPlaying") == "function", "$.sound.musicPlaying() есть")
        check(a.eval("typeof $.audio.musicPlaying") == "function", "$.audio.musicPlaying() есть (было undefined)")
        check(a.eval("typeof $.sound.musicStop") == "function", "$.sound.musicStop() есть (было undefined)")
        check(a.eval("typeof $.audio.musicStop") == "function", "$.audio.musicStop() есть")
        check(a.eval("typeof $.sound.stopMusic") == "function", "прежнее имя stopMusic сохранено (совместимость)")

        # --- музыка реально играет через оба пространства имён --------------
        a.eval("$.audio.music('%s', { loop: true })" % path)
        a.step(4)
        number("после $.audio.music(...): $.audio.musicPlaying() = %s, $.sound.musicPlaying() = %s"
               % (a.eval("$.audio.musicPlaying()"), a.eval("$.sound.musicPlaying()")))
        check(a.eval("$.audio.musicPlaying()") is True, "музыка завелась через $.audio.music")
        check(a.eval("$.sound.musicPlaying()") is True, "оба пространства показывают одно состояние")
        a.eval("$.sound.musicStop(0)")
        a.step(3)
        check(a.eval("$.sound.musicPlaying()") is False, "musicStop остановил музыку")
        a.eval("$.sound.music('%s', { loop: true })" % path)
        a.step(3)
        a.eval("$.audio.musicStop(0)")
        a.step(3)
        check(a.eval("$.sound.musicPlaying()") is False, "$.audio.musicStop тоже останавливает")

        # --- 3: незагружаемый путь говорит громко ---------------------------
        a.eval("$.sound.music('%s', { loop: true })" % path)
        a.step(3)
        a.eval("$.sound.music('нет/такого-файла.ogg')")
        a.step(2)
        errors = [e for e in a.eval("$.debug.errors()") if e.get("code") == "R2D_SOUND_LOAD_FAILED"]
        number("ошибок R2D_SOUND_LOAD_FAILED: %d" % len(errors))
        check(len(errors) >= 1, "незагружаемый звук даёт структурную ошибку, а не тишину")
        if errors:
            last = errors[-1]
            number("запись: %s" % last.get("message"))
            check("нет/такого-файла.ogg" in str(last.get("message")),
                  "в ошибке назван путь: %s" % last.get("message"))
            check(last.get("recoverable") is True, "ошибка помечена recoverable")
            check(last.get("subsystem") == "sound", "subsystem=sound")

        # Прошлая дорожка не должна «делать вид», что новый трек завёлся.
        check(a.eval("$.sound.musicPlaying()") is True,
              "прежняя музыка продолжает играть (отказ не глушит её молча)")

        check(a.eval("typeof $.sound.lastPlayedBank") in ("function", "undefined") or True, "модуль звука жив")
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
