#!/usr/bin/env python3
# ===========================================================================
# §17 Спецификации: ошибки и диагностика пригодны машине, а не только человеку.
#
# Проверяется на живом движке:
#   * исключение в кадровом хуке даёт запись с кодом, подсистемой, операцией,
#     сообщением, стеком/файлом и признаком устранимости;
#   * повторные одинаковые ошибки считаются, но подавляются (счётчик виден);
#   * неустранимая ошибка (`fatal`) делает сводку нечистой — загрузчик обязан
#     считать такую операцию неуспешной;
#   * журнал ограничен по размеру (§28), а `.expectClean()` бросает исключение
#     на неустранимой ошибке.
#
# Запуск:
#   python3 tests/agent/highlevel_diag_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/highlevel_diag_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "diag")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        check(a.eval("typeof $.debug.errors") == "function", "$.debug.errors() есть")
        check(a.eval("typeof $.debug.report") == "function", "$.debug.report() есть")
        check(a.eval("$.debug.report().total") == 0, "до ошибок журнал пуст")

        # --- Устранимая ошибка кадра -----------------------------------------
        a.eval("globalThis.__throw_frame = true; $.debug.clearErrors()")
        a.step(10)
        report = a.eval("$.debug.report()")
        check(report.get("total", 0) > 0, "ошибка кадра записана (%s)" % report.get("total"))
        check(report.get("by_code", {}).get("R2D_SCRIPT_CALLBACK") is not None,
              "код callback зафиксирован: %s" % report.get("by_code"))
        check(report.get("clean") is True, "устранимая ошибка не делает журнал грязным")

        entry = (a.eval("$.debug.errors()") or [{}])[0]
        check(entry.get("code") == "R2D_SCRIPT_CALLBACK", "code записи: %s" % entry.get("code"))
        check(entry.get("subsystem") == "update", "subsystem записи: %s" % entry.get("subsystem"))
        check(entry.get("operation") == "$.update", "operation записи: %s" % entry.get("operation"))
        check("сломанный кадр" in str(entry.get("message")),
              "message записи: %s" % entry.get("message"))
        check(entry.get("recoverable") is True, "recoverable=true у ошибки кадра")
        src = entry.get("source")
        check(isinstance(src, dict) and src.get("file"),
              "source с файлом и строкой: %s" % src)
        check(entry.get("frame", -1) >= 0, "frame записан (%s)" % entry.get("frame"))

        # --- Подавление повторов ----------------------------------------------
        a.step(20)
        s = a.eval("$.debug.report()")
        check(s.get("total", 0) >= 25, "все повторы посчитаны (%s)" % s.get("total"))
        check(s.get("suppressed", 0) > 0,
              "повторы подавлены со счётчиком: %s" % s.get("suppressed"))

        # --- Неустранимая ошибка ----------------------------------------------
        a.eval("globalThis.__throw_scene = true; void $.scene.load('broken', { transition: 'none' })")
        a.step(4)
        s = a.eval("$.debug.report()")
        check(s.get("by_code", {}).get("R2D_ASSET_MISSING") == 1,
              "неустранимая ошибка в сводке по коду: %s" % s.get("by_code"))
        check(s.get("fatal", 0) == 1, "счётчик неустранимых: %s" % s.get("fatal"))
        check(s.get("clean") is False, "сводка нечистая при неустранимой ошибке")
        fatal = a.eval("$.debug.errors('R2D_ASSET_MISSING')[0]")
        check(fatal.get("recoverable") is False, "recoverable=false у неустранимой")
        check(fatal.get("assetPath") == "assets/nope.png", "assetPath записи: %s" % fatal.get("assetPath"))
        check(a.eval("""(() => { try { $.debug.expectClean(); return 'не бросил'; }
                               catch (e) { return String(e.message); } })()""").find("неустранимая") >= 0,
              "$.debug.expectClean() сообщает о неустранимой ошибке")

        # --- Ограничение журнала ----------------------------------------------
        a.eval("$.debug.clearErrors()")
        check(a.eval("$.debug.report().total") == 0, "clearErrors() очищает журнал")
        check(a.eval("typeof $.debug.report().dropped") == "number", "счётчик вытесненных доступен")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
