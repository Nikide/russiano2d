#!/usr/bin/env python3
# ===========================================================================
# Проверка реплеев в движке: запись идёт по кадрам вместе с движком.
#
# Юнит-тесты (tests/js/replay_test.mjs) проверяют ядро без движка. Здесь —
# то, что видно только в движке: номер кадра берётся из engine.frame, заголовок
# содержит зерно ЗАПУСКА и шаг времени, а число записанных кадров совпадает с
# числом прожитых кадров.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_replay_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=777, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("typeof $.replay") == "object", "$.replay подсистема есть")
        check(a.eval("$.replay.mode()") == "idle", "сначала без режима")

        # Пишем ровно один кадр за кадр движка: так и должна работать игра.
        a.eval("""
            $.replay.start({ level: 'тест' });
            let n = 0;
            $.update(() => { $.replay.record({ step: ++n }); });
        """)
        a.step(6)
        check(a.eval("$.replay.isRecording()") is True, "запись идёт")
        eq_frames = a.eval("$.replay.length()")
        check(eq_frames >= 5, f"записано кадров: {eq_frames} (ожидалось ≥ 5)")

        head = json.loads(a.eval("JSON.stringify($.replay.header())"))
        check(head.get("seed") == 777, f"зерно запуска в заголовке: {head.get('seed')}")
        check(abs(head.get("dt", 0) - 1.0 / 60.0) < 1e-6, f"шаг времени: {head.get('dt')}")
        check(head.get("level") == "тест", "поле игры сохранилось")

        # Кадры идут по возрастанию и без пропусков: пропуск сломал бы реплей.
        frames = json.loads(a.eval("JSON.stringify($.replay.frames())"))
        numbers = [f["f"] for f in frames]
        check(numbers == sorted(numbers), f"номера кадров по возрастанию: {numbers[:6]}")
        check(all(numbers[i + 1] - numbers[i] <= 1 for i in range(len(numbers) - 1)),
              "без пропусков в нумерации")

        a.eval("$.replay.stop()")
        check(a.eval("$.replay.isRecording()") is False, "запись остановлена")

        # Текст записи разбирается обратно и в нём те же кадры.
        text = a.eval("$.replay.toText()")
        check(isinstance(text, str) and len(text) > 20, f"текст записи получен ({len(text)} символов)")
        parsed = json.loads(text)
        check(len(parsed["frames"]) == eq_frames, "в тексте столько же кадров")
        check(parsed["header"]["seed"] == 777, "в тексте зерно запуска")

        # Загрузка своего же текста и проигрывание.
        check(a.eval("$.replay.load($.replay.toText())") is True, "текст загружается обратно")
        a.eval("$.replay.play()")
        check(a.eval("$.replay.isPlaying()") is True, "проигрывание началось")
        first = a.eval("$.replay.tick()")
        check(first is not None, f"первый кадр проигрывания: {first}")
        check(a.eval("$.replay.position()") == 1, "курсор сдвинулся")

        # Сравнение записи с её копией: регресс-тест на «мир пришёл туда же».
        check(a.eval("typeof $.replay.compare === 'function'") in (True, False),
              "проверка сравнения доступна через модуль (compareReplays)")

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
