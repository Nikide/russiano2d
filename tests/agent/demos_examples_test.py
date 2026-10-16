#!/usr/bin/env python3
# ===========================================================================
# §31 Спецификации: вертикальные примеры работают как проекты.
#
# Приёмка §31: «примеры работают из установленного пакета и имеют короткую
# автоматическую проверку; документированные вызовы проверяются на совпадение
# с реализацией». Здесь проверяется первая половина по факту:
#   * у каждого примера есть project.json, точка входа и README;
#   * пример запускается движком headless и не пишет ошибок игрового кода;
#   * пример описан в docs/demos.md (иначе о нём знает только автор);
#   * у примера есть своя приёмочная проверка в tests/agent.
#
# Запуск:
#   python3 tests/demos_examples_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/demos_examples_test.py
# ===========================================================================

import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BINARY = os.environ.get("R2D_BINARY") or os.path.join(ROOT, "build", "russiano2d")
FAILURES = []

#: Семь примеров §31 и их приёмочные проверки. Данные, а не ветвления.
EXAMPLES = [
    ("foundations", "foundations_test"),
    ("melee", "melee_test"),
    ("arena", "arena_test"),
    ("roguerooms", "roguerooms_test"),
    ("litsprites", "litsprites_test"),
    ("showcase", "showcase_test"),
    ("recovery", "recovery_test"),
]

#: Слова, которых не должно быть в stderr запуска: это ошибки игрового кода.
ERROR_MARKERS = ("$: ошибка", "SyntaxError", "ReferenceError", "TypeError")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    print("== §31: вертикальные примеры ==")
    if not os.path.exists(BINARY):
        print("  пропуск: %s не собран" % os.path.relpath(BINARY, ROOT))
        return 0

    docs = read(os.path.join(ROOT, "docs", "demos.md"))
    for name, test in EXAMPLES:
        folder = os.path.join(ROOT, "demos", name)
        check(os.path.isdir(folder), "%s: каталог примера есть" % name)
        if not os.path.isdir(folder):
            continue

        # --- Структура проекта -------------------------------------------------
        project = os.path.join(folder, "project.json")
        check(os.path.exists(project), "%s: есть project.json" % name)
        entries = [f for f in ("main.js", "index.js") if os.path.exists(os.path.join(folder, f))]
        check(bool(entries), "%s: есть точка входа (%s)" % (name, entries or "нет"))
        readme = os.path.join(folder, "README.md")
        check(os.path.exists(readme), "%s: есть README" % name)

        # --- Описан в документации --------------------------------------------
        check("demos/%s" % name in docs, "%s: описан в docs/demos.md" % name)

        # --- Своя автоматическая проверка --------------------------------------
        check(os.path.exists(os.path.join(ROOT, "tests", "agent", test + ".py")),
              "%s: есть приёмочная проверка %s" % (name, test))

        # --- Запуск из установленного пакета (headless) ------------------------
        try:
            run = subprocess.run([BINARY, "--game", "demos/%s" % name,
                                  "--headless", "--frames", "6"],
                                 capture_output=True, text=True, timeout=120, cwd=ROOT)
        except Exception as exc:                       # noqa: BLE001
            check(False, "%s: запуск не удался (%s)" % (name, exc))
            continue
        log = (run.stdout or "") + (run.stderr or "")
        found = [m for m in ERROR_MARKERS if m in log]
        check(run.returncode == 0 and not found,
              "%s: запускается headless без ошибок (%s)" % (name, found or "чисто"))

    # Запуск не должен оставлять прогресс в корне репозитория: примеры пишут
    # только в build/ или в свой каталог.
    stray = os.path.join(ROOT, "save.json")
    check(not os.path.exists(stray),
          "запуск примеров не оставляет save.json в корне репозитория")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
