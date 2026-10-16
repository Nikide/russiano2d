#!/usr/bin/env python3
# ===========================================================================
# Регрессия task-33: груз игры + освобождение указателей ВНУТРЬ груза.
#
# Симптом (до фикса): standalone-сборка с ассетами падала SIGABRT (код 134) —
# `malloc: pointer being freed was not allocated`. Стек (lldb):
#
#   #0 ___BUG_IN_CLIENT_OF_LIBMALLOC_POINTER_BEING_FREED_WAS_NOT_ALLOCATED
#   #1 js_load + 776                          (src/real2d4.c, load .r2d4)
#   #2 js_call_c_function → JS_CallInternal … → r2d_script_call_update
#
# Причина одна на два места: `r2d_vfs_read()` для собранной игры возвращает
# указатель ВНУТРЬ буфера груза (владелец — груз, освобождать нельзя), а код
# звал `free()`. Штатный способ — `r2d_vfs_free()`: для указателя из груза это
# no-op, для буфера с диска — SDL_free.
#
#   * src/real2d4.c `js_load`  — 4 × free(bytes) → r2d_vfs_free(bytes);
#   * src/font.c               — free(data)/free(font->data) в загрузке,
#                                перезагрузке и в r2d_font_shutdown.
#
# Тест проверяет ОБА места и оба сценария (первая загрузка и повторная/выход),
# потому что класс ошибки прячется за «первый раз работает»:
#   1. демо real2d standalone: контейнер `.r2d4` лежит в грузе → запуск
#      headless (3 прогона) обязан завершиться кодом 0, и отдельно —
#      `$.real2d.load()` из груза через агентский протокол;
#   2. шрифт из груза: `engine.loadFont()`, повторная загрузка того же имени,
#      `reloadTexture()` для текстуры из груза и ЧИСТЫЙ ВЫХОД (до фикса выход
#      после шрифта из груза давал код -6: r2d_font_shutdown освобождал
#      указатель внутрь груза).
#
# Запуск (после сборки):
#   python3 tests/agent/real2d_payload_crash_test.py
# ===========================================================================

import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

BINARY = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
REAL2D_DEMO = os.path.join(ROOT, "demos", "real2d")
TEXT_FIXTURE = os.path.join(ROOT, "tests", "fixtures", "text")

R2D4_ASSET = "assets/head_real2d_v4.r2d4"          # контейнер RE2D v4 из груза
TTF_ASSET = "assets/fonts/NotoSans-Regular.ttf"    # шрифт из груза
PNG_ASSET = "assets/tiles.png"                     # текстура из груза

CRASH_MARK = "pointer being freed was not allocated"
RUNS = 3

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def note(message):
    print("  --   " + message)


def build(project, out, *extra):
    """Собрать standalone. --no-compress: сжатие к этому дефекту отношения не имеет,
    а тест должен оставаться быстрым."""
    cmd = [BINARY, "build", "--project", project, "--out", out, "--no-encrypt",
           "--no-compress"] + list(extra)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, timeout=600)
    return proc.returncode, proc.stdout


def run_headless(binary, frames=5):
    proc = subprocess.run([binary, "--headless", "--frames", str(frames)],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, timeout=180)
    return proc.returncode, proc.stdout


def main():
    if not os.path.exists(BINARY):
        print("  FAIL движок не собран: %s" % BINARY)
        return 1

    work = tempfile.mkdtemp(prefix="r2d_real2d_payload_")
    try:
        # --- 1. .r2d4 из груза -------------------------------------------------
        standalone = os.path.join(work, "real2d")
        code, out = build(REAL2D_DEMO, standalone)
        check(code == 0, "standalone демо real2d собран")
        if code != 0:
            print(out[-2000:])
            return 1
        check("файлов 98" in out or "файлов" in out,
              "груз собран: %s" % [ln for ln in out.splitlines() if ln.startswith("Итого")][-1:])

        crashed = 0
        last_code, last_out = 0, ""
        for _ in range(RUNS):
            last_code, last_out = run_headless(standalone)
            if last_code != 0 or CRASH_MARK in last_out:
                crashed += 1
        note("прогонов %d, упало %d (последний код %s)" % (RUNS, crashed, last_code))
        check(crashed == 0,
              "загрузка .r2d4 из груза не валит процесс: упало %d из %d" % (crashed, RUNS))
        check(CRASH_MARK not in last_out,
              "в выводе нет «%s»" % CRASH_MARK)
        check(last_code == 0, "headless-прогон завершился кодом 0 (получено %s)" % last_code)
        check("real2d" in last_out, "демо дошло до своей логики (в выводе есть real2d)")

        # Прямой вызов из JS: контейнер берётся из груза и освобождается.
        with Agent(binary=standalone, game=None, seed=7) as a:
            a.step(2)
            slots = []
            for _ in range(2):
                slots.append(a.eval("$.real2d.load('%s')" % R2D4_ASSET))
            alive = a.eval("typeof $") == "function"
            bytes_len = a.eval("engine.readBytes('%s').length" % R2D4_ASSET)
        check(all(isinstance(s, int) and s >= 0 for s in slots),
              "две загрузки .r2d4 из груза вернули слоты %s" % slots)
        check(alive, "движок жив после повторной загрузки .r2d4")
        check(isinstance(bytes_len, int) and bytes_len > 1024,
              "контейнер читается из груза (%s байт)" % bytes_len)

        # --- 2. Шрифт из груза: загрузка, перезагрузка, выход ------------------
        text_bin = os.path.join(work, "text")
        code, out = build(TEXT_FIXTURE, text_bin)
        check(code == 0, "standalone текстовой фикстуры собран")

        a = Agent(binary=text_bin, game=None, seed=7)
        try:
            a.step(2)
            first = a.eval("engine.loadFont('Probe', '%s')" % TTF_ASSET)
            again = a.eval("engine.loadFont('Probe', '%s')" % TTF_ASSET)   # перезагрузка
            tex = a.eval("engine.loadTexture('%s')" % PNG_ASSET)
            reload_ok = a.eval("engine.reloadTexture(%s, '%s').ok" % (tex, PNG_ASSET)) \
                if isinstance(tex, int) and tex >= 0 else None
            a.step(2)
            alive = a.eval("typeof $") == "function"
        finally:
            a.close()
        exit_code = a.returncode()

        check(first is True, "шрифт из груза загрузился (loadFont → %s)" % first)
        check(again is True, "повторная загрузка того же шрифта прошла (→ %s)" % again)
        check(isinstance(tex, int) and tex >= 0, "текстура из груза загрузилась (id=%s)" % tex)
        check(reload_ok in (True, None), "перезагрузка текстуры из груза: %s" % reload_ok)
        check(alive, "движок жив после перезагрузок")
        check(exit_code == 0,
              "выход после шрифта из груза — код 0 (получено %s; до фикса здесь был SIGABRT)"
              % exit_code)

        note("каталог прогона: %s" % work)
    finally:
        shutil.rmtree(work, ignore_errors=True)

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
