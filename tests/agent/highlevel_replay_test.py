#!/usr/bin/env python3
# ===========================================================================
# Проверка реплеев в движке: запись, воспроизведение и совпадение позиции.
#
# Юнит-тесты (tests/js/replay_test.mjs) проверяют ядро без движка. Здесь —
# главное обещание реплея: ЗАПИСАННАЯ СЕССИЯ ВОСПРОИЗВОДИТСЯ В ТУ ЖЕ ПОЗИЦИЮ.
# Фикстура tests/fixtures/replay/main.js двигает квадрат ровно по вводу, и
# ничего, кроме ввода, на движение не влияет — поэтому расхождение означало бы
# ошибку реплея, а не «мир сложный».
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_replay_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "replay")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def press(a, key, down):
    a.key(key, "down" if down else "up")


def main():
    with Agent(game=GAME, seed=777, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("typeof $.replay") == "object", "$.replay подсистема есть")
        check(a.eval("$.replay.mode()") == "idle", "сначала без режима")

        # --- запись «из коробки»: движок сам ставит обвязку ---
        a.eval("$.replay.record(globalThis.__input, globalThis.__apply)")
        check(a.eval("$.replay.isRecording()") is True, "запись началась одним вызовом")

        press(a, "Right", True)
        a.step(9)
        press(a, "Right", False)
        a.step(3)
        check(a.eval("$.replay.length()") >= 10, "кадры записаны")

        recorded_x = a.eval("$('#hero').pos().x")
        head = json.loads(a.eval("JSON.stringify($.replay.header())"))
        check(head.get("seed") == 777, f"зерно запуска в заголовке: {head.get('seed')}")
        check(abs(head.get("dt", 0) - 1.0 / 60.0) < 1e-6, f"шаг времени: {head.get('dt')}")
        check(recorded_x > 20, f"во время записи герой уехал: x = {recorded_x:.1f}")

        text = a.eval("$.replay.toText()")
        a.eval("$.replay.stop()")
        check(a.eval("$.replay.isRecording()") is False, "запись остановлена")

        # --- воспроизведение: возвращаем мир в начало и играем ту же запись ---
        a.eval("$('#hero').at(20, 180)")
        a.eval("$.replay.load($.replay.toText())")
        a.eval("$.replay.play()")
        check(a.eval("$.replay.isPlaying()") is True, "проигрывание началось")
        # Клавишу НЕ жмём: если бы ввод брался с клавиатуры, герой не сдвинулся бы.
        a.step(12)
        played_x = a.eval("$('#hero').pos().x")
        print(f"  записано: x = {recorded_x:.1f} | воспроизведено: x = {played_x:.1f}")
        check(abs(played_x - recorded_x) < 1.0,
              f"позиция совпала с записанной (разница {abs(played_x - recorded_x):.2f} px)")

        # Регресс-проверка «мир пришёл туда же» сравнивает ввод, а не пиксели.
        # Регресс-проверка «мир пришёл туда же» сравнивает ввод, а не пиксели:
        # её удобно звать в своём тесте после проигрывания.
        check(a.eval("typeof $.replay.verify") == "function",
              "$.replay.verify доступна для регресс-проверок")

        # Текст записи читается обратно и содержит те же кадры.
        parsed = json.loads(text)
        check(len(parsed["frames"]) >= 10, f"в тексте записи {len(parsed['frames'])} кадров")
        check(parsed["header"]["seed"] == 777, "в тексте зерно запуска")

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
