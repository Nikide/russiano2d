#!/usr/bin/env python3
# ===========================================================================
# Сборка: каждый модуль движка РАЗБИРАЕТСЯ тем же парсером, что и в игре.
#
# Зачем отдельный тест, если есть embed_sync_test и qjs-тесты: движок встраивает
# `src/highlevel/*.js` и парсит их QuickJS-ng. Парсер QuickJS строже и иначе
# сообщает об ошибках, чем Node: реальный случай — незакрытая скобка вызова
# (`normalizeAttack({...};`) проходила `node --check` и ломала весь движок
# (`$ is not defined`), потому что падал ВЕСЬ бандл, а не один модуль.
#
# Тест разбирает каждый модуль тем же qjs, которым гоняются юнит-тесты:
# SyntaxError = провал; остальные ошибки (нет зависимости, нет движка) — норма,
# потому что на этом шаге проверяется только синтаксис.
#
# Запуск:
#   python3 tests/parse_all_test.py
# ===========================================================================

import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
QJS = os.path.join(ROOT, "build", "_deps", "quickjs-build", "qjs")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def parse_error(qjs, rel_path):
    """Вернуть текст SyntaxError или None, если модуль разбирается."""
    code = ("import('./%s').then(() => 0).catch((e) => { print(String(e)); });" % rel_path)
    try:
        out = subprocess.run([qjs, "-e", code], cwd=ROOT, capture_output=True,
                             text=True, timeout=60)
    except Exception as exc:                          # noqa: BLE001
        return "не удалось запустить qjs: %s" % exc
    for line in (out.stdout + out.stderr).splitlines():
        if "SyntaxError" in line:
            return line.strip()
    return None


def main():
    print("== Разбор всех модулей движка (QuickJS-ng) ==")
    if not os.path.exists(QJS):
        print("  пропуск: %s не найден (соберите цель qjs_exe)" % os.path.relpath(QJS, ROOT))
        return 0

    targets = []
    for base in ("src/highlevel",):
        for name in sorted(os.listdir(os.path.join(ROOT, base))):
            if name.endswith(".js"):
                targets.append("%s/%s" % (base, name))

    bad = []
    for rel in targets:
        err = parse_error(QJS, rel)
        if err:
            bad.append((rel, err))

    for rel, err in bad[:10]:
        print("  FAIL %s: %s" % (rel, err))
    check(not bad, "все модули src/highlevel разбираются (%d из %d)" % (len(targets) - len(bad), len(targets)))

    # Точки входа игры и примеров: они тоже встраиваются и парсятся.
    entries = []
    for base in ("game", "demos"):
        root = os.path.join(ROOT, base)
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if name == "main.js":
                    entries.append(os.path.relpath(os.path.join(dirpath, name), ROOT))
    bad_entries = [(rel, parse_error(QJS, rel)) for rel in sorted(entries)]
    bad_entries = [(rel, err) for rel, err in bad_entries if err]
    for rel, err in bad_entries[:5]:
        print("  FAIL %s: %s" % (rel, err))
    check(not bad_entries,
          "точки входа игры и примеров разбираются (%d проверено)" % len(entries))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
