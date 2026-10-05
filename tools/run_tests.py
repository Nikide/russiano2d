#!/usr/bin/env python3
"""Раннер агентских тестов russiano2d.

Запускает файлы ``tests/agent/*_test.py`` по одному, ограничивает время прогона,
складывает вывод в ``build/test_<основа>.log`` (для ``platformer_test.py`` —
``build/test_platformer.log``) и различает три исхода:

* ``ok``   — код выхода 0 **и** в выводе есть хотя бы одна проверка ``  ok  …``;
* ``fail`` — ненулевой код выхода или строка ``  FAIL …``;
* ``skip`` — код 0, но проверок не было (нет ассета, нет дисплея и т. п.).

«Пропуск» — это **не** «зелено»: он не валит прогон, но о нём печатается
предупреждение (см. ``docs/AGENT_API.md``, раздел 4).

Использование::

    python3 tools/run_tests.py                 # все tests/agent/*_test.py
    python3 tools/run_tests.py --list          # показать имена и выйти
    python3 tools/run_tests.py --fast          # быстрый набор
    python3 tools/run_tests.py platformer_test # только указанные (позиционные)
    python3 tools/run_tests.py --verbose       # печатать вывод тестов на лету

Окружение::

    R2D_TEST_TIMEOUT=120   # таймаут одного теста в секундах (по умолчанию 600)
    R2D_BINARY=...         # бинарник движка для самих тестов

Аргументы разбираются вручную через ``sys.argv`` (без argparse) — как в
остальных инструментах проекта. Внешних зависимостей нет.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from typing import List, Tuple

#: Абсолютный путь к корню репозитория.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Каталог с агентскими тестами.
TESTS_DIR = os.path.join(ROOT, "tests", "agent")

#: Куда складываются логи прогонов (каталог в .gitignore).
BUILD_DIR = os.path.join(ROOT, "build")

#: Таймаут одного теста по умолчанию, секунды.
DEFAULT_TIMEOUT = 600

#: Переменные окружения с таймаутом: текущее имя, затем прежнее.
TIMEOUT_ENV = ("R2D_TEST_TIMEOUT", "NK2D_TEST_TIMEOUT")

#: Быстрый набор: имена без ``.py``. Пустой список — берём первые 5 по алфавиту.
# Быстрый набор: тесты, которые дают максимум сигнала за минимум времени.
# Полный прогон гоняет все tests/agent/*_test.py и занимает несколько минут;
# --fast укладывается примерно в минуту.
FAST: List[str] = [
    "agent_protocol_test",
    "highlevel_api_test",
    "game_test",
]

#: Строки-маркеры проверок в выводе теста (после strip).
OK_MARKER = "ok"
FAIL_MARKER = "FAIL"


def log(message: str) -> None:
    """Напечатать строку прогресса и сбросить буфер (важно для CI)."""
    print(message, flush=True)


def env_timeout() -> int:
    """Таймаут из ``R2D_TEST_TIMEOUT`` (или прежнего ``NK2D_TEST_TIMEOUT``)."""
    raw = None
    for variable in TIMEOUT_ENV:
        if os.environ.get(variable):
            raw = os.environ[variable]
            break
    if not raw:
        return DEFAULT_TIMEOUT
    try:
        value = int(float(raw))
    except ValueError:
        log("предупреждение: R2D_TEST_TIMEOUT=%r не число, беру %d с"
            % (raw, DEFAULT_TIMEOUT))
        return DEFAULT_TIMEOUT
    return value if value > 0 else DEFAULT_TIMEOUT


def discover() -> List[str]:
    """Найти все тесты ``tests/agent/*_test.py``, отсортированные по имени."""
    if not os.path.isdir(TESTS_DIR):
        return []
    names = [name for name in os.listdir(TESTS_DIR)
             if name.endswith("_test.py") and os.path.isfile(os.path.join(TESTS_DIR, name))]
    return sorted(names)


def normalize(name: str) -> str:
    """Привести имя теста к виду ``<имя>_test.py`` (принимает и без расширения)."""
    name = name.strip()
    if name.endswith(".py"):
        return name
    return name + ".py"


def test_name(filename: str) -> str:
    """Имя теста для вывода на экран: ``platformer_test.py`` → ``platformer_test``."""
    return filename[:-3] if filename.endswith(".py") else filename


def test_base(filename: str) -> str:
    """Основа имени для лога: ``platformer_test.py`` → ``platformer``.

    Лог теста — ``build/test_<основа>.log`` (см. ``docs/AGENT_API.md``, раздел 4).
    """
    name = test_name(filename)
    if name.endswith("_test"):
        name = name[: -len("_test")]
    return name or test_name(filename)


def fast_set(available: List[str]) -> List[str]:
    """Быстрый набор: список ``FAST`` либо первые 5 тестов по алфавиту."""
    if FAST:
        return [normalize(name) for name in FAST]
    return available[:5]


def classify(returncode: int, output: List[str], timed_out: bool) -> str:
    """Определить исход теста: ``ok``, ``fail`` или ``skip``.

    ``fail`` приоритетнее: ненулевой код, таймаут или строка ``FAIL``.
    ``skip`` — код 0 без единой строки-проверки (см. модульный docstring).
    """
    if timed_out or returncode != 0:
        return "fail"
    saw_ok = False
    for line in output:
        text = line.strip()
        if text.startswith(FAIL_MARKER):
            return "fail"
        if text.startswith(OK_MARKER):
            saw_ok = True
    return "ok" if saw_ok else "skip"


def run_test(
    path: str, timeout: int, verbose: bool
) -> Tuple[str, int, List[str], float, bool]:
    """Запустить один тест.

    Возвращает ``(имя, код выхода, строки вывода, длительность, был_ли_таймаут)``.
    Вывод одновременно пишется в ``build/test_<основа>.log`` и, при ``verbose``,
    печатается в реальном времени.
    """
    filename = os.path.basename(path)
    name = test_name(filename)
    log_name = "test_%s.log" % test_base(filename)
    os.makedirs(BUILD_DIR, exist_ok=True)
    log_path = os.path.join(BUILD_DIR, log_name)

    lines: List[str] = []
    started = time.monotonic()
    timed_out = False

    proc = subprocess.Popen(
        [sys.executable, path],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    def reader() -> None:
        """Читать вывод теста в список и лог, чтобы труба не переполнилась."""
        assert proc.stdout is not None
        with open(log_path, "w", encoding="utf-8") as log_file:
            for line in proc.stdout:
                log_file.write(line)
                log_file.flush()
                lines.append(line.rstrip("\n"))
                if verbose:
                    sys.stdout.write(line)
                    sys.stdout.flush()

    thread = threading.Thread(target=reader, name="agent-test-reader", daemon=True)
    thread.start()

    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
    if timed_out:
        proc.kill()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    thread.join(timeout=5.0)

    elapsed = time.monotonic() - started
    returncode = proc.returncode if proc.returncode is not None else 0
    if timed_out:
        note = "  FAIL таймаут: тест не уложился в %d с\n" % timeout
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write(note)
        lines.append(note.rstrip("\n"))
    return name, returncode, lines, elapsed, timed_out


def print_table(rows: List[Tuple[str, str, float]]) -> None:
    """Напечатать таблицу «тест — исход — время»."""
    if not rows:
        return
    width = max(len(name) for name, _, _ in rows)
    width = max(width, len("тест"))
    log("")
    log("%-*s  %-6s  %s" % (width, "тест", "исход", "время"))
    log("%s  %s  %s" % ("-" * width, "-" * 6, "-" * 8))
    for name, outcome, elapsed in rows:
        log("%-*s  %-6s  %6.1f с" % (width, name, outcome, elapsed))


def usage() -> str:
    """Текст справки раннера."""
    return (
        "Использование: python3 tools/run_tests.py [ключи] [имена тестов...]\n"
        "\n"
        "Ключи:\n"
        "  --list             показать найденные тесты и выйти\n"
        "  --fast             быстрый набор (константа FAST, иначе первые 5)\n"
        "  --verbose          печатать вывод тестов в реальном времени\n"
        "  --timeout <сек>    таймаут одного теста (по умолчанию %d,\n"
        "                     переопределяется R2D_TEST_TIMEOUT)\n"
        "  --help             эта справка\n"
        "\n"
        "Позиционные аргументы — имена тестов без .py, например platformer_test.\n"
        % DEFAULT_TIMEOUT
    )


def main(argv: List[str]) -> int:
    """Разобрать аргументы, прогнать тесты и вернуть код выхода."""
    verbose = False
    show_list = False
    use_fast = False
    timeout = env_timeout()
    selected: List[str] = []

    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg in ("--help", "-h"):
            print(usage())
            return 0
        if arg == "--list":
            show_list = True
        elif arg == "--fast":
            use_fast = True
        elif arg == "--verbose":
            verbose = True
        elif arg == "--timeout":
            index += 1
            if index >= len(argv):
                log("ошибка: --timeout требует значение в секундах")
                return 2
            try:
                timeout = int(float(argv[index]))
            except ValueError:
                log("ошибка: --timeout %r не число" % argv[index])
                return 2
            if timeout <= 0:
                log("ошибка: таймаут должен быть больше нуля")
                return 2
        elif arg.startswith("--"):
            log("ошибка: неизвестный ключ %r" % arg)
            print(usage())
            return 2
        else:
            selected.append(normalize(arg))
        index += 1

    available = discover()
    if not available:
        log("не найдено ни одного теста в %s" % TESTS_DIR)
        log("создайте файл <имя>_test.py (см. tests/agent/README.md)")
        return 2

    if show_list:
        names = fast_set(available)
        log("найдено тестов: %d" % len(available))
        for name in available:
            mark = "  (быстрый)" if name in names else ""
            log("  %s%s" % (name, mark))
        if not FAST:
            log("константа FAST пуста — быстрый набор: первые 5 по алфавиту")
        return 0

    if selected:
        unknown = [name for name in selected if name not in available]
        if unknown:
            log("ошибка: неизвестные тесты: %s" % ", ".join(unknown))
            log("доступные: %s" % ", ".join(available))
            return 2
        todo = [name for name in available if name in selected]
        source = "указаны в аргументах"
    elif use_fast:
        allowed = fast_set(available)
        todo = [name for name in available if name in allowed]
        source = "быстрый набор"
        if not FAST:
            source += " (FAST пуст: первые 5 по алфавиту)"
    else:
        todo = available
        source = "полный набор"

    log("раннер агентских тестов russiano2d")
    log("тестов к прогону: %d (%s), таймаут одного теста: %d с" % (len(todo), source, timeout))
    log("логи: %s" % os.path.join(BUILD_DIR, "test_<имя>.log"))
    log("")

    rows: List[Tuple[str, str, float]] = []
    counters = {"ok": 0, "fail": 0, "skip": 0}
    total_started = time.monotonic()

    for position, filename in enumerate(todo, start=1):
        path = os.path.join(TESTS_DIR, filename)
        name = test_name(filename)
        log("[%d/%d] %s … запускаю" % (position, len(todo), name))
        try:
            _name, returncode, output, elapsed, timed_out = run_test(path, timeout, verbose)
        except OSError as exc:
            log("  не удалось запустить тест: %s" % exc)
            rows.append((name, "fail", 0.0))
            counters["fail"] += 1
            continue

        outcome = classify(returncode, output, timed_out)
        counters[outcome] += 1
        rows.append((name, outcome, elapsed))

        checks = sum(1 for line in output if line.strip().startswith(OK_MARKER))
        fails = sum(1 for line in output if line.strip().startswith(FAIL_MARKER))
        note = "%s: проверок ok %d, FAIL %d, %.1f с" % (outcome, checks, fails, elapsed)
        if outcome == "skip":
            note = "skip: проверок нет — это не «зелено» (%.1f с)" % elapsed
        elif outcome == "fail" and timed_out:
            note = "fail: таймаут %d с, тест снят (%.1f с)" % (timeout, elapsed)
        elif outcome == "fail" and returncode != 0:
            note = "fail: код выхода %d (%.1f с)" % (returncode, elapsed)
        log("  " + note)

    total_elapsed = time.monotonic() - total_started
    print_table(rows)

    log("")
    log("итого: %d, ok %d, fail %d, skip %d, время %.1f с"
        % (len(rows), counters["ok"], counters["fail"], counters["skip"], total_elapsed))
    if counters["skip"]:
        log("предупреждение: %d тест(ов) пропущено (skip) — пропуск не считается успехом"
            % counters["skip"])
    if counters["fail"]:
        log("провалено тестов: %d" % counters["fail"])
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        log("")
        log("прервано пользователем")
        raise SystemExit(130)
