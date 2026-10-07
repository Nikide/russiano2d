#!/usr/bin/env python3
# ===========================================================================
# Звук: seek/position и ПРИОРИТЕТЫ КАНАЛОВ.
#
# Закрывает два пункта §11 «осталось незакрытым»:
#   * «seek у звука» — перемотка внутри проигрываемого звука;
#   * «приоритеты и stealing голосов» — раньше при нехватке каналов жертвой
#     ВСЕГДА был канал 0, поэтому важная реплика глушилась первым же шагом по
#     траве. Теперь вытесняется САМЫЙ НЕВАЖНЫЙ звук, и только если новый не
#     менее важен.
#
# Файл звука тест генерирует сам (0.5 с, 440 Гц) — в фикстурах звуков нет.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_sound_seek_test.py
# ===========================================================================

import math
import os
import struct
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def make_wav(path, seconds=2.0, freq=440, sr=44100):
    n = int(sr * seconds)
    data = b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / sr)))
                    for i in range(n))
    hdr = (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt "
           + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
           + b"data" + struct.pack("<I", len(data)))
    with open(path, "wb") as f:
        f.write(hdr + data)
    return path


def main():
    tone = make_wav(os.path.join(tempfile.gettempdir(), "r2d_tone.wav"))
    print("  тестовый звук: %s" % tone)

    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        for name in ("seek", "position", "channelDuration", "channelPriority",
                     "channelCount"):
            check(a.eval("typeof engine.audio.%s" % name) == "function",
                  "engine.audio.%s есть" % name)

        count = a.eval("engine.audio.channelCount()")
        print("  каналов: %s" % count)
        check(count == 16, "движок сообщает 16 эффект-каналов")

        # --- seek и position ---
        sid = a.eval("engine.audio.load('%s')" % tone)
        print("  id звука: %s" % sid)
        check(isinstance(sid, int) and sid >= 0, "звук загрузился")

        dur = a.eval("engine.audio.duration(%d)" % sid)
        print("  длительность: %.3f с" % dur)
        check(abs(dur - 2.0) < 0.05, "длительность 2 с")

        ch = a.eval("engine.audio.play(%d, 1, 0, 0, 3)" % sid)
        print("  канал: %s" % ch)
        check(ch >= 0, "звук играет")

        # Позиция растёт со временем.
        p0 = a.eval("engine.audio.position(%d)" % ch)
        time.sleep(0.15)
        p1 = a.eval("engine.audio.position(%d)" % ch)
        print("  позиция: %.3f → %.3f" % (p0, p1))
        check(p1 > p0, "позиция растёт (звук действительно играет)")

        # Перемотка: после seek позиция оказывается рядом с целью.
        moved = a.eval("String(engine.audio.seek(%d, 0.30))" % ch)
        p2 = a.eval("engine.audio.position(%d)" % ch)
        print("  seek → %s, позиция %.3f" % (moved, p2))
        check(moved == "true", "seek вернул true")
        check(0.25 <= p2 <= 0.45, "позиция после перемотки ≈ 0.30")

        # Перемотка в конец: звук доигрывает и канал освобождается.
        a.eval("engine.audio.seek(%d, %.2f)" % (ch, dur - 0.05))
        time.sleep(0.2)
        ended = a.eval("engine.audio.playing(%d)" % ch)
        print("  после перемотки в конец playing = %s" % ended)
        check(ended is False, "перемотка в конец завершает звук")

        # На неиграющем канале seek честно отказывает.
        check(a.eval("String(engine.audio.seek(15, 0.1))") == "false",
              "seek на неиграющем канале → false")
        check(a.eval("engine.audio.position(15)") == -1,
              "position на неиграющем канале → -1")

        # --- приоритеты: вытесняется САМЫЙ НЕВАЖНЫЙ, а не нулевой ---
        # Занимаем все каналы. Первые 15 — приоритет 0, ПОСЛЕДНИЙ — высокий (9).
        a.eval("""
            globalThis.__chans = [];
            // ВНИМАНИЕ на аргументы: (id, volume, pan, loop, priority).
            // Лишний ноль сдвигает приоритет — на этом я уже обжёгся.
            for (let i = 0; i < %d; i++) {
                const pr = (i === %d - 1) ? 9 : 0;
                __chans.push(engine.audio.play(%d, 1, 0, 0, pr));
            }
        """ % (count, count, sid))
        busy = a.eval("engine.audio.activeChannels()")
        print("  занято каналов: %s" % busy)
        check(busy == count, "все каналы заняты")

        important = a.eval("engine.audio.play(%d, 1, 0, 0, 9)" % sid)
        victim_priority = a.eval("engine.audio.channelPriority(%d)" % important)
        print("  важный звук (приоритет 9) → канал %s" % important)
        check(important >= 0, "важный звук вытеснил кого-то")
        check(victim_priority == 9, "на вытесненном канале теперь приоритет 9")

        # Проверяем, что вытеснен был НЕ важный: канал с приоритетом 9,
        # который мы заняли последним, должен остаться живым.
        kept = a.eval("""
            (() => {
                let alive = 0;
                for (let i = 0; i < %d; i++) {
                    if (engine.audio.playing(i) && engine.audio.channelPriority(i) === 9) alive++;
                }
                return alive;
            })()
        """ % count)
        print("  каналов с приоритетом 9 живо: %s" % kept)
        check(kept >= 2, "важный звук НЕ вытеснен (жертвой стал неважный)")

        # --- приоритет ниже всех: звук НЕ играет, важные не глушатся ---
        # Перезанимаем каналы: 2-секундный тон мог доиграть, и тогда
        # «отказ» случился бы по другой причине — свободный канал.
        a.eval("""
            for (let i = 0; i < %d; i++) engine.audio.play(%d, 1, 0, 0, 0);
        """ % (count, sid))
        check(a.eval("engine.audio.activeChannels()") == count,
              "каналы снова заняты неважными звуками")
        refused = a.eval("engine.audio.play(%d, 1, 0, 0, -5)" % sid)
        print("  звук с приоритетом -5 при полной занятости → %s" % refused)
        check(refused == -1, "слабый звук не вытесняет важные (возвращает -1)")

        # --- $.sound: обёртки ---
        a.eval("engine.audio.stopAll(0)")
        time.sleep(0.05)
        h = a.eval("$.sound.play('%s', { priority: 4 })" % tone)
        check(h >= 0, "$.sound.play принимает priority")
        check(a.eval("$.sound.priorityOf(%d)" % h) == 4, "приоритет канала читается")
        check(a.eval("$.sound.durationOf(%d)" % h) > 0.4, "длительность канала читается")
        a.eval("$.sound.seek(%d, 0.2)" % h)
        pos = a.eval("$.sound.position(%d)" % h)
        print("  $.sound.position после seek: %.3f" % pos)
        check(0.15 <= pos <= 0.4, "$.sound.seek/position работают")

        info = a.eval("JSON.stringify($.sound.busy())")
        print("  $.sound.busy(): %s" % info)
        check('"total":16' in info, "$.sound.busy() знает лимит каналов")

        a.eval("engine.audio.stopAll(0)")

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
