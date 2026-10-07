#!/usr/bin/env python3
# ===========================================================================
# Тест выбора GPU-бэкенда из командной строки.
#
# Проверяется поведение, которое видно только снаружи движка: список бэкендов,
# понятный отказ на недоступный бэкенд (а не пустое окно) и рабочий выбор
# своего бэкенда на этой машине.
#
# Запуск после сборки:
#   python3 tests/agent/cli_gpu_test.py
# ===========================================================================

import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import resolve_binary   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "text")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run(args):
    proc = subprocess.run([resolve_binary()] + args, capture_output=True, text=True, timeout=120)
    return (proc.stdout or "") + (proc.stderr or "")


def main():
    listing = run(["--list-gpu"])
    names = re.findall(r"\]\s+(metal|vulkan|direct3d12)\s*$", listing, re.M)
    check(len(names) >= 1, f"--list-gpu показывает бэкенды: {names}")

    bad = run(["--gpu", "нет-такого", "--game", GAME, "--headless", "--frames", "1"])
    check("недоступен" in bad or "unsupported" in bad,
          "неизвестный бэкенд отвергнут с объяснением")
    check(any(n in bad for n in names) or "ни одного" in bad,
          "в отказе перечислены доступные бэкенды")

    if "metal" in names:
        good = run(["--gpu", "metal", "--game", GAME, "--headless", "--frames", "2"])
        check("GPU-бэкенд: metal" in good, "выбор metal работает")

    env = dict(os.environ, R2D_GPU=names[0])
    proc = subprocess.run([resolve_binary(), "--game", GAME, "--headless", "--frames", "2"],
                          capture_output=True, text=True, timeout=120, env=env)
    check(f"GPU-бэкенд: {names[0]}" in (proc.stdout or "") + (proc.stderr or ""),
          "переменная R2D_GPU тоже выбирает бэкенд")

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
