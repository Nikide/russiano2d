#!/usr/bin/env python3
# ===========================================================================
# Опция сборки R2D_ENABLE_RE2D: 3D-авторинг включён или выключен.
#
# Движок собирается в двух конфигурациях (см. xmake.lua):
#
#   build/     -DR2D_ENABLE_RE2D=ON   (по умолчанию) — 3D-авторинг спрайтов есть;
#   build-2d/  -DR2D_ENABLE_RE2D=OFF  — сборка 2D-платформера: ни RE2D, ни
#                                       Real2D, ни RotSprite, ни EXR-неба.
#
# Тест проверяет ОБЕ стороны опции и то, что обычный 2D при этом не задет:
#
#   * $.re2dEnabled совпадает с реальной сборкой (а не с обещанием);
#   * в выключенной сборке нет ни $.re2d, ни $.mesh, ни $.cels, ни $.rotSprite,
#     ни $.real2d, и камера внятно отказывается включать вид 're2d';
#   * в обеих сборках работают узлы, тела, .controls(), тайлмап и камера 2D;
#   * в игре нет ошибок игровой логики (stderr) — это ловит «молчаливый»
#     ReferenceError от незакрытого engine.re2d.* в выключенной сборке.
#
# Запуск:
#   python3 tests/agent/re2d_gate_test.py                       # build/
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/re2d_gate_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, resolve_binary   # noqa: E402

GAME = os.path.join("tests", "fixtures", "re2d_gate")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_of(a):
    """Ошибки игровой логики из stderr: движок печатает их строкой [error]."""
    tail = a.stderr_tail(200) or ""
    return [line.strip() for line in tail.splitlines() if "[error]" in line]


def main():
    binary = resolve_binary()
    # Ожидание берём из имени каталога сборки: build-2d — это -DR2D_ENABLE_RE2D=OFF.
    # Явный признак — сам движок: $.re2dEnabled. Здесь лишь то, что мы должны
    # увидеть, если опция работает: подпись для сообщений.
    expected_off = "build-2d" in binary
    print("  сборка: %s (ожидаем RE2D=%s)" % (binary, "OFF" if expected_off else "ON"))

    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(5)
        gate = a.eval("globalThis.__gate")
        check(isinstance(gate, dict), "фикстура опубликовала снимок возможностей")

        enabled = bool(gate.get("re2dEnabled"))
        check(enabled == (not expected_off),
              "$.re2dEnabled=%s соответствует сборке RE2D=%s"
              % (enabled, "OFF" if expected_off else "ON"))

        # --- Сторона «выключено»: ничего из 3D-слоя не установлено -----------
        if expected_off:
            for name in ("re2d", "mesh", "cels", "rotSprite", "real2d"):
                check(gate.get(name) == "undefined",
                      "в сборке без RE2D нет $.%s (%s)" % (name, gate.get(name)))
            message = str(gate.get("cameraError") or "")
            check(message != "", "вид камеры 're2d' отказал внятной ошибкой: %r" % message)
            check("re2d" in message.lower() or "re2d" in message,
                  "в отказе назван вид re2d: %r" % message)
            check(gate.get("cameraKindAfter") == "2d",
                  "после отказа камера осталась 2D (%s)" % gate.get("cameraKindAfter"))
        # --- Сторона «включено»: 3D-слой на месте ----------------------------
        else:
            for name in ("re2d", "mesh", "cels", "rotSprite", "real2d"):
                check(gate.get(name) == "object",
                      "в сборке с RE2D есть $.%s (%s)" % (name, gate.get(name)))
            check(gate.get("cameraKindAfter") != "2d" or gate.get("cameraError") == "",
                  "вид камеры 're2d' включился без ошибки")

        # --- Обычный 2D не задет ни в одной из сборок ------------------------
        check(gate.get("heroKind") == "2d", "игрок остался обычным 2D-узлом")
        check(gate.get("russiKind") == "re2d", "вид узла kind(Re2D) — данные, а не сборка")
        check("2d" in str(gate.get("kinds")), "$.kinds.list() содержит вид 2d: %s" % gate.get("kinds"))

        check(a.eval("$('#hero').length") == 1, "узел игрока существует")
        check(a.eval("$('.brick').length") == 1, "узел платформы (класс brick) существует")
        check(a.eval("$('#map').length") == 1, "тайлмап существует")
        check(a.eval("$('#hero').onFloor()") is not None, ".onFloor() отвечает")

        # Ходьба и прыжок — базовая механика платформера в обеих сборках.
        a.step(30)   # приземлиться на пол: без опоры прыжка нет
        x0 = a.eval("$('#hero').pos().x")
        a.keys(["D"])
        a.step(30)
        a.keys([])
        x1 = a.eval("$('#hero').pos().x")
        check(x1 > x0, "игрок идёт вправо (%.0f -> %.0f)" % (x0, x1))

        y0 = a.eval("$('#hero').pos().y")
        a.key("Space", "tap")
        top = y0
        for _ in range(15):
            a.step(1)
            top = min(top, a.eval("$('#hero').pos().y"))
        check(top < y0, "игрок прыгает (y %.0f -> минимум %.0f)" % (y0, top))

        a.step(5)
        errors = errors_of(a)
        check(not errors, "нет ошибок игровой логики: %s" % (errors[:3] if errors else "нет"))

    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        sys.exit(1)
    print("  ok   re2d_gate_test: все проверки прошли")


if __name__ == "__main__":
    main()
