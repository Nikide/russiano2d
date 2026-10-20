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
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT, resolve_binary   # noqa: E402

GAME = os.path.join("tests", "fixtures", "input_walk")
FAILURES = []


def run_replay(path, frames, extra=(), game=GAME, seed=4242):
    """Прямой запуск движка (не агент): нужен код возврата процесса."""
    argv = [resolve_binary(), "--headless", "--no-hot-reload",
            "--fixed-dt", "0.0166666667", "--seed", str(seed),
            "--game", game, "--replay", path, "--frames", str(frames)]
    argv += list(extra)
    return subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=60)


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with tempfile.TemporaryDirectory(prefix="r2d-replay-") as tmp:
        path = os.path.join(tmp, "walk.r2replay")

        # --- запись: герой едет вправо 30 кадров, потом стоит 5 ---
        # checkpoint на кадре 20 (первый кадр — engine.frame 1) пишет нативный
        # hash физического состояния; на воспроизведении он сверяется.
        with Agent(game=GAME, seed=4242, fixed_dt=1.0 / 60.0,
                   extra_args=["--record", path,
                               "--checkpoint", "20:after_walk"]) as a:
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

        # --- content ID: FNV-1a 64 по каноническим файлам проекта ---
        content = header.get("content", "")
        check(bool(re.fullmatch(r"fnv1a64:[0-9a-f]{16}", content)),
              f"content ID записан как fnv1a64:<16 hex>: {content!r}")
        check(header.get("content_files", 0) >= 2,
              f"в content ID вошли project.json и main.js: {header.get('content_files')} файлов")
        check(header.get("content_bytes", 0) > 0,
              f"в content ID вошли байты файлов: {header.get('content_bytes')}")

        # --- checkpoint: настоящая строка с hash в том же потоке ---
        checks = []
        for ln in lines[1:]:
            if ln.lstrip().startswith('{"check"'):
                checks.append(json.loads(ln)["check"])
        check(len(checks) == 1, f"checkpoint записан ровно один: {len(checks)}")
        checkpoint = checks[0] if checks else {}
        check(checkpoint.get("frame") == 20, f"кадр checkpoint'а: {checkpoint.get('frame')}")
        check(checkpoint.get("name") == "after_walk", f"имя checkpoint'а: {checkpoint.get('name')}")
        check(bool(re.fullmatch(r"[0-9a-f]{16}", checkpoint.get("hash", ""))),
              f"checkpoint несёт 64-битный hash: {checkpoint.get('hash')!r}")

        # --- воспроизведение: никакого ввода руками ---
        with Agent(game=GAME, seed=4242, fixed_dt=1.0 / 60.0,
                   extra_args=["--replay", path]) as a:
            a.step(36)
            replay_x = a.eval("$('#hero').pos().x")
            replay_stderr = a.stderr_text()

        check(abs(replay_x - recorded_x) < 0.01,
              f"воспроизведение пришло туда же: {replay_x:.3f} против {recorded_x:.3f}")
        check(replay_x > 50, "и это не ноль: ввод действительно подставился")
        check("разошёлся" not in replay_stderr,
              "checkpoint при воспроизведении сошёлся (нет предупреждения)")

        # --- дивергенция: подменённый hash ловится и даёт код 3 ---
        bad_check = os.path.join(tmp, "bad_checkpoint.r2replay")
        with open(path, encoding="utf-8") as fh:
            recorded_lines = fh.readlines()
        with open(bad_check, "w", encoding="utf-8") as fh:
            for ln in recorded_lines:
                if ln.lstrip().startswith('{"check"'):
                    ln = ln.replace(checkpoint.get("hash", ""), "0000000000000000")
                fh.write(ln)

        res = run_replay(bad_check, 40)
        check(res.returncode == 3,
              f"дивергенция возвращает код 3 (получено {res.returncode})")
        check("checkpoint" in res.stderr and "after_walk" in res.stderr,
              "в stderr есть имя разошедшегося checkpoint'а")
        check("0000000000000000" in res.stderr,
              "в stderr есть ожидаемый hash")
        check("на кадре 20" in res.stderr, "в stderr есть кадр checkpoint'а")

        res = run_replay(bad_check, 40, ["--checkpoints", "off"])
        check(res.returncode == 0,
              f"--checkpoints off не считает дивергенцию ошибкой (код {res.returncode})")
        check("разошёлся" not in res.stderr,
              "--checkpoints off не печатает расхождение")

        # --- content mismatch: предупреждение, но не отказ ---
        bad_content = os.path.join(tmp, "bad_content.r2replay")
        with open(bad_content, "w", encoding="utf-8") as fh:
            for idx, ln in enumerate(recorded_lines):
                if idx == 0:
                    ln = re.sub(r'"content":"[^"]*"',
                                '"content":"fnv1a64:0000000000000000"', ln)
                fh.write(ln)
        res = run_replay(bad_content, 5)
        check(res.returncode == 0,
              f"чужой content не роняет воспроизведение (код {res.returncode})")
        check("content" in res.stderr,
              "изменившийся content виден в stderr")

        # --- старый файл (без content/checkpoints) остаётся загружаемым ---
        old = os.path.join(tmp, "old.r2replay")
        with open(old, "w", encoding="utf-8") as fh:
            fh.write('{"r2d_replay":1,"version":"0.1.15","game":"x",'
                     '"fixed_dt":0.0166666675,"seed":4242}\n')
            fh.write('{"f":0,"keys":[4],"mx":0,"my":0,"mb":0,"wheel":0}\n')
        res = run_replay(old, 3)
        check(res.returncode == 0, f"старая запись без новых полей читается (код {res.returncode})")

        # --- настоящая дивергенция: hash чувствителен к нативной физике -----
        # physics_ext роняет динамический шар под гравитацией. Другой --fixed-dt
        # даёт другое число шагов физики за кадр — позиция шара на кадре 30
        # честно расходится, без подмены hash в файле.
        phys = os.path.join("tests", "fixtures", "physics_ext")
        phys_path = os.path.join(tmp, "physics_ext.r2replay")
        with Agent(game=phys, seed=7, fixed_dt=1.0 / 60.0,
                   extra_args=["--record", phys_path, "--checkpoint", "30:ball"]) as a:
            a.step(60)
        with open(phys_path, encoding="utf-8") as fh:
            phys_checks = [json.loads(ln)["check"] for ln in fh
                           if ln.lstrip().startswith('{"check"')]
        check(len(phys_checks) == 1 and phys_checks[0]["name"] == "ball",
              "physics_ext: checkpoint нативного состояния записан")

        res = run_replay(phys_path, 60, game=phys, seed=7)
        check(res.returncode == 0,
              f"physics_ext: тот же fixed-dt воспроизводится (код {res.returncode})")
        res = run_replay(phys_path, 60, ["--fixed-dt", "0.0333333333"],
                         game=phys, seed=7)
        check(res.returncode == 3,
              f"physics_ext: другой fixed-dt ловится checkpoints (код {res.returncode})")
        check(phys_checks[0]["hash"] in res.stderr,
              "physics_ext: в stderr есть записанный hash")

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
