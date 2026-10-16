#!/usr/bin/env python3
# ===========================================================================
# A5 (отчёт BASHNYA 0.1.34). Отказ записи файла обязан быть виден.
#
# Контракт приёмки — ДВА условия, проверяются в ОДНОМ прогоне:
#   1) неудачная запись даёт РОВНО ОДНУ строку с путём и причиной
#      (read-only / EACCES / ENOENT) и структурную запись R2D_FS_WRITE_FAILED;
#      проверяются все четыре точки входа: $.fs.write, $.fs.writeJSON,
#      $.store.save(), $.store.file(f).save();
#   2) успешная запись журнал НЕ трогает.
#
# Недоступность воспроизводится как в поставке: базовый каталог (R2D_GAME_DIR)
# — каталог только для чтения, относительные пути игрового сохранения уходят
# туда. Внутри лежит симлинк assets → настоящие ассеты, иначе движок не нашёл
# бы шрифты и не поднялся бы.
#
# Если тест запущен с правами root, chmod запись не запрещает: тогда случай
# read-only честно помечается пропущенным, а недоступность берётся из
# детерминированного пути (запись внутрь файла → ENOTDIR).
#
# Запуск (после сборки движка):
#   python3 tests/agent/fs_write_failure_test.py
# ===========================================================================

import json
import os
import shutil
import stat
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join(ROOT, "tests", "fixtures", "hello")
READONLY_DIR = os.path.join(ROOT, "build", "fs_write_readonly")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def quote(value):
    return json.dumps(str(value))


def fresh_lines(a, before):
    return [l for l in a.stderr_text().splitlines()[before:] if l.strip()]


def main():
    shutil.rmtree(READONLY_DIR, ignore_errors=True)
    os.makedirs(READONLY_DIR)
    os.symlink(os.path.join(ROOT, "assets"), os.path.join(READONLY_DIR, "assets"))
    # Файл внутри: каталог непустой (проверка ENOTEMPTY) и есть что удалять
    # там, где прав на запись в каталог нет (проверка EACCES).
    with open(os.path.join(READONLY_DIR, "keep.json"), "w", encoding="utf-8") as handle:
        handle.write("{}")
    os.chmod(READONLY_DIR, stat.S_IRUSR | stat.S_IXUSR)
    readonly_blocked = os.geteuid() != 0
    print("  --   базовый каталог только для чтения: %s (chmod действует: %s)"
          % (READONLY_DIR, readonly_blocked))
    if not readonly_blocked:
        print("  --   тест запущен с правами root: случай read-only пропущен (не выдаётся за пройденный)")

    try:
        # ------------------------------------------------------------------
        # Условие 2: успешная запись молчит
        # ------------------------------------------------------------------
        with Agent(game=GAME, seed=5) as a:
            a.step(3)
            a.eval("$.debug.clearErrors(); 'ok'")
            a.step(1)
            out_dir = os.path.join(ROOT, "build", "fs_write_ok")
            shutil.rmtree(out_dir, ignore_errors=True)
            os.makedirs(out_dir)
            ok_path = os.path.join(out_dir, "ok.json")
            before = len(a.stderr_text().splitlines())
            ok1 = a.eval("$.fs.write(%s, '{}')" % quote(ok_path))
            ok2 = a.eval("$.store.file(%s).save()" % quote(os.path.join(out_dir, "store.json")))
            ok3 = a.eval("$.store.file(%s).save()" % quote(os.path.join(out_dir, "store2.json")))
            a.step(1)
            quiet = fresh_lines(a, before)
            print("  --   успешная запись: fs.write=%s store.save=%s, новых строк stderr: %d"
                  % (ok1, ok2, len(quiet)))
            for line in quiet:
                print("       | " + line)
            check(ok1 is True and ok2 is True and ok3 is True, "запись в доступный каталог удалась")
            check(os.path.isfile(ok_path), "файл действительно на диске: %s" % ok_path)
            check(not quiet, "успешная запись не пишет в журнал ни строки: %s" % quiet)
            check(a.eval("$.debug.errors().length") == 0,
                  "успешная запись не оставила записей в $.debug.errors()")

        # ------------------------------------------------------------------
        # Условие 1: отказ = ровно одна строка с путём и причиной
        # ------------------------------------------------------------------
        targets = [
            ("$.fs.write", lambda p: "$.fs.write(%s, '{}')" % quote(p), "one.json"),
            ("$.fs.writeJSON", lambda p: "$.fs.writeJSON(%s, {a: 1})" % quote(p), "two.json"),
            ("$.store.file(f).save()", lambda p: "$.store.file(%s).save()" % quote(p), "three.json"),
            ("$.store.save()", lambda p: "$.store.file(%s).save()" % quote(p), "save.json"),
        ]
        if readonly_blocked:
            env = dict(os.environ, R2D_GAME_DIR=READONLY_DIR)
            with Agent(game=GAME, seed=5, env=env) as a:
                a.step(3)
                base = a.eval("$.fs.basePath()")
                print("  --   базовый каталог движка: %s" % base)
                check(base.rstrip("/") == READONLY_DIR,
                      "движок взял каталог только для чтения как базовый: %s" % base)
                for name, make, filename in targets:
                    target = os.path.join(READONLY_DIR, filename)
                    a.eval("$.debug.clearErrors(); 'ok'")
                    a.step(1)
                    before = len(a.stderr_text().splitlines())
                    a.eval("$.store.file('save.json')")
                    result = a.eval(make(target))
                    a.step(1)
                    lines = fresh_lines(a, before)
                    entries = a.eval("$.debug.errors()")
                    print("  --   %s → %s" % (name, result))
                    for line in lines:
                        print("       | " + line)
                    check(result is False, "%s: вернул false, а не исключение" % name)
                    check(len(lines) == 1,
                          "%s: ровно одна строка в журнале (получено %d)" % (name, len(lines)))
                    if lines:
                        line = lines[0]
                        check("R2D_FS_WRITE_FAILED" in line, "%s: строка называет код отказа" % name)
                        check(READONLY_DIR in line, "%s: строка называет путь" % name)
                        check(("Permission denied" in line) or ("Read-only" in line)
                              or ("errno 13" in line) or ("errno 30" in line),
                              "%s: строка называет причину: %s" % (name, line[:120]))
                    check(len(entries) == 1 and entries[0].get("code") == "R2D_FS_WRITE_FAILED",
                          "%s: структурная запись R2D_FS_WRITE_FAILED: %s"
                          % (name, [e.get("code") for e in entries]))
                    if entries:
                        entry = entries[0]
                        check(entry.get("subsystem") == "fs" and entry.get("recoverable") is True,
                              "%s: подсистема fs, recoverable=true" % name)
                        check(entry.get("assetPath") == target,
                              "%s: запись помнит путь: %s" % (name, entry.get("assetPath")))
                        check(("Permission denied" in entry.get("message", ""))
                              or ("Read-only" in entry.get("message", "")),
                              "%s: причина в тексте записи: %s" % (name, entry.get("message", ""))[:110])

        # ------------------------------------------------------------------
        # C5: удаление — идемпотентно молчит, но настоящий отказ виден
        # ------------------------------------------------------------------
        with Agent(game=GAME, seed=5) as a:
            a.step(3)
            # «Файла нет» — не отказ: тишина и ни одной записи в диагностике.
            a.eval("$.debug.clearErrors(); 'ok'")
            before = len(a.stderr_text().splitlines())
            missing_remove = a.eval("$.fs.remove(%s)" % quote(os.path.join(READONLY_DIR, "gone.json")))
            a.step(1)
            quiet = fresh_lines(a, before)
            print("  --   удаление отсутствующего файла: %s, новых строк %d" % (missing_remove, len(quiet)))
            check(missing_remove is False and not quiet,
                  "отсутствующий файл: удалять нечего — тишина (идемпотентность): %s" % quiet)
            check(a.eval("$.debug.errors().length") == 0,
                  "отсутствующий файл не оставил записей в $.debug.errors()")

            # Настоящий отказ: непустой каталог. Одна строка с путём и причиной.
            a.eval("$.debug.clearErrors(); 'ok'")
            before = len(a.stderr_text().splitlines())
            busy_dir = a.eval("$.fs.remove(%s)" % quote(READONLY_DIR))
            a.step(1)
            lines = fresh_lines(a, before)
            entries = a.eval("$.debug.errors()")
            print("  --   удаление непустого каталога: %s" % busy_dir)
            for line in lines:
                print("       | " + line)
            check(busy_dir is False, "непустой каталог не удалён (false)")
            check(len(lines) == 1, "ровно одна строка в журнале (получено %d)" % len(lines))
            if lines:
                check("R2D_FS_REMOVE_FAILED" in lines[0], "строка называет код отказа")
                check(READONLY_DIR in lines[0], "строка называет путь")
                check(any(word in lines[0] for word in ("Directory not empty", "errno 66",
                                                        "Not a directory", "Permission denied",
                                                        "errno 13")),
                      "строка называет причину: %s" % lines[0][:130])
            check(len(entries) == 1 and entries[0].get("code") == "R2D_FS_REMOVE_FAILED",
                  "структурная запись R2D_FS_REMOVE_FAILED: %s" % [e.get("code") for e in entries])
            if entries:
                entry = entries[0]
                check(entry.get("subsystem") == "fs" and entry.get("recoverable") is True,
                      "подсистема fs, recoverable=true")
                check(entry.get("assetPath") == READONLY_DIR,
                      "запись помнит путь: %s" % entry.get("assetPath"))

            # Отказ по правам: файл внутри каталога без права записи.
            if readonly_blocked:
                a.eval("$.debug.clearErrors(); 'ok'")
                before = len(a.stderr_text().splitlines())
                denied = a.eval("$.fs.remove(%s)" % quote(os.path.join(READONLY_DIR, "keep.json")))
                a.step(1)
                lines = fresh_lines(a, before)
                entries = a.eval("$.debug.errors()")
                print("  --   удаление файла из каталога без прав: %s" % denied)
                for line in lines:
                    print("       | " + line)
                check(denied is False and len(lines) == 1,
                      "отказ по правам: false и одна строка (получено %d)" % len(lines))
                check(bool(lines) and ("Permission denied" in lines[0] or "errno 13" in lines[0]),
                      "причина названа системой: %s" % (lines[0] if lines else "нет"))
                check(len(entries) == 1 and entries[0].get("code") == "R2D_FS_REMOVE_FAILED",
                      "структурная запись R2D_FS_REMOVE_FAILED на отказе по правам")

            # Успешное удаление молчит (тишина — не только на ошибке).
            ok_dir = os.path.join(ROOT, "build", "fs_remove_ok")
            shutil.rmtree(ok_dir, ignore_errors=True)
            os.makedirs(ok_dir)
            ok_file = os.path.join(ok_dir, "temp.json")
            with open(ok_file, "w", encoding="utf-8") as handle:
                handle.write("{}")
            a.eval("$.debug.clearErrors(); 'ok'")
            before = len(a.stderr_text().splitlines())
            removed = a.eval("$.fs.remove(%s)" % quote(ok_file))
            a.step(1)
            lines = fresh_lines(a, before)
            print("  --   успешное удаление: %s, новых строк %d" % (removed, len(lines)))
            check(removed is True and not lines and a.eval("$.debug.errors().length") == 0,
                  "успешное удаление не пишет ни строки: %s" % lines)
            check(not os.path.exists(ok_file), "файл действительно удалён")
            shutil.rmtree(ok_dir, ignore_errors=True)

        # ------------------------------------------------------------------
        # Детерминированный недоступный путь (не зависит от прав)
        # ------------------------------------------------------------------
        with Agent(game=GAME, seed=5) as a:
            a.step(3)
            a.eval("$.debug.clearErrors(); 'ok'")
            before = len(a.stderr_text().splitlines())
            # CMakeLists.txt — обычный файл в корне: запись «внутрь файла»
            # невыполнима при любых правах (ENOTDIR), каталог не создаётся.
            blocked = a.eval("$.fs.write('CMakeLists.txt/inner.json', '{}')")
            a.step(1)
            lines = fresh_lines(a, before)
            print("  --   путь внутри файла → %s" % blocked)
            for line in lines:
                print("       | " + line)
            check(blocked is False and len(lines) == 1,
                  "запись по пути внутри файла: false и одна строка (получено %d)" % len(lines))
            check(bool(lines) and ("Not a directory" in lines[0] or "errno 20" in lines[0]),
                  "причина названа системой (ENOTDIR/errno 20): %s" % (lines[0] if lines else "нет"))
            frames = a.eval("engine.frame")
            a.step(2)
            check(a.eval("engine.frame") > frames and a.ping().get("pong") is True,
                  "движок отвечает после отказов записи")
    finally:
        os.chmod(READONLY_DIR, stat.S_IRWXU)
        shutil.rmtree(READONLY_DIR, ignore_errors=True)
        shutil.rmtree(os.path.join(ROOT, "build", "fs_write_ok"), ignore_errors=True)

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
