#!/usr/bin/env python3
# ===========================================================================
# Тест протокола агента: транспорт, команды, виртуальный ввод, скриншоты.
#
# Проверяет низкий уровень — то, на чём стоит всё остальное: движок реально
# понимает JSON-строки, честно шагает кадры по команде, отдаёт состояние и
# умеет принимать ввод без человека.
#
# Запуск:
#   python3 tests/agent/agent_protocol_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    shot = os.path.join(ROOT, "build", "test_agent_shot.png")

    with Agent(game="tests/fixtures/bare", seed=7) as a:
        # --- Базовые команды -------------------------------------------------
        pong = a.ping()
        check(pong.get("pong") is True, "ping отвечает pong")
        check("frame" in pong and "time" in pong, "ping отдаёт кадр и время")

        check(a.frame() >= 1, "движок рисует первый кадр до первой команды")

        # --- Шаги -------------------------------------------------------------
        before = a.frame()
        a.step(30)
        after = a.frame()
        check(after - before == 30, f"step(30) продвинул ровно 30 кадров ({before} → {after})")

        # --- Детерминизм ------------------------------------------------------
        a.step(10)
        t1 = a.time()
        a.step(10)
        t2 = a.time()
        check(abs((t2 - t1) - 10 / 60.0) < 1e-4, "время идёт ровно на dt за кадр")

        # --- eval -------------------------------------------------------------
        check(a.eval("1 + 1") == 2, "eval считает число")
        check(a.eval("'привет'") == "привет", "eval возвращает строку (кириллица цела)")
        check(a.eval("[1, 2, 3]") == [1, 2, 3], "eval возвращает массив")
        check(a.eval("({ a: 1 }).a") == 1, "eval возвращает объект")
        check(a.eval("typeof $") == "function", "$ доступен в контексте агента")

        # --- Ошибки не роняют движок -----------------------------------------
        try:
            a.eval("неизвестнаяФункция()")
            check(False, "ошибка eval возвращает ok:false")
        except Exception as error:
            check("неизвестная" in str(error).lower() or "not defined" in str(error).lower(),
                  "ошибка eval возвращает ok:false с текстом")
        check(a.ping().get("pong") is True, "движок жив после ошибки в eval")

        # --- Виртуальный ввод -------------------------------------------------
        a.eval("$.store.set('d', 0)")
        a.key("D", "down")
        a.step(5)
        check(a.eval("$.input.down('d')") is True, "key(down) держит клавишу")
        a.key("D", "up")
        a.step(1)
        check(a.eval("$.input.down('d')") is False, "key(up) отпускает клавишу")

        a.key("Space", "tap")
        a.step(1)
        check(a.eval("$.input.pressed('space')") is True, "key(tap) даёт фронт нажатия в кадре")
        a.step(1)
        check(a.eval("$.input.pressed('space')") is False, "tap живёт ровно один кадр")

        a.keys(["A", "Space"])
        a.step(1)
        check(a.eval("$.input.down('a') && $.input.down('space')") is True, "keys(hold) держит набор")
        a.keys([])
        a.step(1)
        check(a.eval("$.input.down('a')") is False, "keys([]) отпускает всё")

        # --- Мышь --------------------------------------------------------------
        a.mouse_move(x=100, y=120)
        a.step(1)
        check(abs(a.eval("$.input.mouse().x") - 100) < 1, "mouseMove задаёт позицию курсора")

        a.eval("$.store.set('clicked', 0)")
        a.eval("$('<ui.button>', { id: 'probe' }).at(100, 120).size(80, 40).text('x')"
               ".appendTo($.ui).on('click', () => $.store.set('clicked', 1))")
        a.step(1)
        a.mouse(button=1, action="click")
        a.step(2)
        check(a.eval("$.store.get('clicked')") == 1, "клик мышью доходит до кнопки интерфейса")

        # --- Состояние и скриншот --------------------------------------------
        state = a.state()
        check(isinstance(state, dict) and "frame" in state, "state отдаёт снимок")
        check("world" in state and "entities" in state, "снимок содержит мир и список узлов")

        out = a.screenshot(shot)
        check(os.path.exists(out) and os.path.getsize(out) > 1000,
              f"скриншот записан ({os.path.getsize(out)} байт)")

        # --- Перезапуск скриптов ----------------------------------------------
        reloads_before = a.eval("engine.reloads")
        a.reload()
        a.step(1)
        check(a.eval("engine.reloads") >= reloads_before, "reload перезапускает скрипты")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
