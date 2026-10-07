#!/usr/bin/env python3
# ===========================================================================
# Проверка CLI-реплея: `--record` записывает ввод, `--replay` его возвращает.
#
# Обещание (docs/RECORD_REPLAY.md): записанная сессия воспроизводится в то же
# состояние мира. Фикстура tests/fixtures/input_walk/main.js двигает героя
# ровно по вводу и ни от чего больше не зависит, поэтому расхождение означало
# бы ошибку реплея, а не «сложный мир».
#
# Запуск после сборки:
#   python3 tests/agent/replay_cli_test.py
# ===========================================================================

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "input_walk")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with tempfile.TemporaryDirectory(prefix="r2d-replay-") as tmp:
        path = os.path.join(tmp, "walk.r2replay")

        # --- запись: герой едет вправо 30 кадров, потом стоит 5 ---
        with Agent(game=GAME, seed=4242, fixed_dt=1.0 / 60.0,
                   extra_args=["--record", path]) as a:
            a.step(1)
            a.key("Right", "down")
            a.step(30)
            a.key("Right", "up")
            a.step(5)
            recorded_x = a.eval("$('#hero').pos().x")

        check(os.path.isfile(path), "файл записи создан")
        check(recorded_x > 50, f"во время записи герой уехал: x = {recorded_x:.1f}")

        # --- формат: версионированный заголовок ---
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        header = json.loads(lines[0])
        check(header.get("r2d_replay") == 1, f"версия формата в заголовке: {header.get('r2d_replay')}")
        check(bool(header.get("version")), f"версия движка записана: {header.get('version')}")
        check(header.get("game") == GAME.replace(os.sep, "/") or header.get("game") == GAME,
              f"каталог игры записан: {header.get('game')}")
        check(header.get("seed") == 4242, f"зерно записано: {header.get('seed')}")
        check(abs(header.get("fixed_dt", 0) - 1.0 / 60.0) < 1e-6,
              f"шаг времени записан: {header.get('fixed_dt')}")
        check(len(lines) >= 36, f"кадров в записи не меньше 36: {len(lines) - 1}")
        check(any('"keys":[4' in ln or '"keys":[4,' in ln or '"keys":[' in ln for ln in lines[1:]),
              "кадры содержат список клавиш")

        # --- воспроизведение: никакого ввода руками ---
        with Agent(game=GAME, seed=4242, fixed_dt=1.0 / 60.0,
                   extra_args=["--replay", path]) as a:
            a.step(36)
            replay_x = a.eval("$('#hero').pos().x")

        check(abs(replay_x - recorded_x) < 0.01,
              f"воспроизведение пришло туда же: {replay_x:.3f} против {recorded_x:.3f}")
        check(replay_x > 50, "и это не ноль: ввод действительно подставился")

        # --- чужую версию формата отвергаем, но не падаем ---
        bad = os.path.join(tmp, "bad.r2replay")
        with open(bad, "w", encoding="utf-8") as fh:
            fh.write('{"r2d_replay":99,"version":"x","game":"x","fixed_dt":0.016,"seed":1}\n')
            fh.write('{"f":0,"keys":[4],"mx":0,"my":0,"mb":0,"wheel":0}\n')

        with Agent(game=GAME, seed=4242, fixed_dt=1.0 / 60.0,
                   extra_args=["--replay", bad]) as a:
            a.step(10)
            x_after_bad = a.eval("$('#hero').pos().x")
            alive = a.eval("engine.frame")

        check(x_after_bad == 0, f"несовместимую запись не применили: x = {x_after_bad}")
        check(isinstance(alive, int) and alive > 0, "движок продолжил работать")

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
