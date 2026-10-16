#!/usr/bin/env python3
# ===========================================================================
# Единое правило промаха селектора: alive / bsp / camera (task-47).
#
# Продолжение task-46. Там правило ввели для целей `$`-методов (appendTo,
# lookAt, mask…), здесь — для трёх подсистем, которые селектор принимали, а
# промах ГЛУШИЛИ:
#   * `$.alive.of('#…')`     → null молча;
#   * `$.world.bsp.order('#…')` / `indices` → точка (0, 0) молча;
#   * `$.camera.worldToScreen('#…')`, `screenToWorld`, `follow` → (0, 0)/null.
#
# Правило: промах СЛЫШЕН (сообщение в журнал), возврат остаётся прежним —
# `null`/`(0, 0)` (совместимость: код проверяет `if (!node)`), а повторный
# промах НЕ заливает журнал: одно сообщение на пару «место + селектор», пока
# селектор не начнёт разрешаться.
#
# Тест падает на старом коде: сообщений нет вовсе.
#
# Запуск после сборки:
#   python3 tests/agent/selector_miss_uniform_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
FAILURES = []
MISS = "нет-такого"

CAPTURE = """
(function (fn) {
    const ctx = $.ctx;
    const real = ctx.log;
    const seen = [];
    ctx.log = function (msg) { seen.push(String(msg)); };
    try { fn(); } finally { ctx.log = real; }
    return seen;
})
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def logs(a, code):
    return a.eval("(%s)(function () { %s })" % (CAPTURE, code))


def hits(msgs, needle=MISS):
    return [m for m in msgs if needle in m]


def run_alive(a):
    print("--- $.alive.of (#%s) ---" % MISS)
    msgs = logs(a, "const r = $.alive.of('#%s'); $.alive.of('#%s'); $.alive.of('#%s');" % (MISS, MISS, MISS))
    check(len(hits(msgs)) == 1,
          "три промаха подряд — одно сообщение: %s" % (hits(msgs),))
    check(any("alive" in m for m in hits(msgs)), "в сообщении названо место: %s" % (hits(msgs),))
    check(logs(a, "$.alive.of('#hero')") == [], "рабочий id не пишет ничего")

    # Промах после успешного разрешения ТОГО ЖЕ селектора — снова слышен
    # (дедупликация не «глухая»: серия промахов начинается заново).
    a.eval("$('<rect>', { id: '%s' }).at(10, 10).size(4, 4).appendTo($.world)" % MISS)
    a.step(1)
    check(logs(a, "$.alive.of('#%s')" % MISS) == [],
          "появившийся узел разрешается без сообщений")
    a.eval("$('#%s').remove()" % MISS)
    a.step(1)
    check(len(hits(logs(a, "$.alive.of('#%s')" % MISS))) == 1,
          "после успешного разрешения промах слышен снова")

    # Полная форма селектора: класс/тег, не только id.
    check(a.eval("$.alive.of('.goblin') === null") is True,
          "селектор класса разрешается (психики нет → null)")
    check(logs(a, "$.alive.of('.goblin')") == [],
          "селектор класса не считается промахом")

    # attach с промахом молчит не должен (тут сообщение уже было) и не падает.
    msgs = logs(a, "$.alive.attach('#%s')" % MISS)
    check(len(hits(msgs)) >= 1, "attach с промахом говорит: %s" % (hits(msgs),))
    check(a.eval("$.alive.attach('#hero') !== null") is True, "attach по рабочему id работает")


def run_bsp(a):
    print("--- $.world.bsp.order / indices / segment ---")
    built = a.eval("$.world.bsp.build([[0,0,200,0],[200,0,200,200],[0,200,200,200],[0,0,0,200]])")
    a.step(1)
    check(built is True, "дерево построено для проверки")

    msgs = logs(a, "$.world.bsp.order('#%s'); $.world.bsp.order('#%s');" % (MISS, MISS))
    check(len(hits(msgs)) == 1,
          "order с промахом: одно сообщение на два вызова: %s" % (hits(msgs),))
    check(any("bsp" in m for m in hits(msgs)), "в сообщении назван bsp: %s" % (hits(msgs),))

    msgs = logs(a, "$.world.bsp.indices('#%s')" % MISS)
    check(len(hits(msgs)) == 1, "indices с промахом говорит: %s" % (hits(msgs),))

    check(logs(a, "$.world.bsp.order('#hero')") == [], "order по рабочему селектору молчит")
    check(isinstance(a.eval("$.world.bsp.order({ x: 10, y: 10 })"), list),
          "order по точке работает как раньше")

    msgs = logs(a, "$.world.bsp.segment(-1); $.world.bsp.segment(99999);")
    check(any("segment" in m for m in hits(msgs, "segment")),
          "segment с индексом вне диапазона говорит: %s" % (msgs,))
    check(a.eval("$.world.bsp.segment(0) !== null") is True, "segment(0) отвечает как раньше")


def run_camera(a):
    print("--- $.camera.worldToScreen / screenToWorld / follow ---")
    msgs = logs(a, "$.camera.worldToScreen('#%s'); $.camera.worldToScreen('#%s');" % (MISS, MISS))
    check(len(hits(msgs)) == 1,
          "worldToScreen с промахом: одно сообщение: %s" % (hits(msgs),))
    check(any("camera" in m for m in hits(msgs)), "в сообщении названа камера: %s" % (hits(msgs),))
    check(a.eval("typeof $.camera.worldToScreen('#%s').x" % MISS) == "number",
          "возврат сохранён (точка, а не null)")

    msgs = logs(a, "$.camera.screenToWorld('#%s')" % MISS)
    check(len(hits(msgs)) == 1, "screenToWorld с промахом говорит: %s" % (hits(msgs),))
    check(logs(a, "$.camera.worldToScreen('#hero')") == [], "рабочий селектор молчит")

    # Главная проверка «не залить журнал»: follow резолвит цель КАЖДЫЙ кадр,
    # а узел по селектору может появиться позже (это осознанная ленивость).
    a.eval("$.camera.follow('#%s')" % MISS)
    a.step(5)
    msgs = logs(a, "$.camera.followed();")
    check(len(hits(msgs)) == 0 or len(hits(msgs)) == 1,
          "follow: за 5 кадров не больше одного сообщения (%s)" % (len(hits(msgs)),))

    # Считаем сообщения на настоящих кадрах: подменяем лог и крутим кадры.
    a.eval("""
    (function () {
        const ctx = $.ctx;
        globalThis.__miss = [];
        const real = ctx.log;
        ctx.log = function (msg) { if (String(msg).indexOf('%s') >= 0) globalThis.__miss.push(String(msg)); };
        globalThis.__restore = function () { ctx.log = real; };
    })()
    """ % MISS)
    a.step(6)
    count = a.eval("globalThis.__miss.length")
    a.eval("globalThis.__restore()")
    check(count <= 1,
          "follow с промахом за 6 кадров: сообщений %s (ждали ≤ 1)" % (count,))

    a.eval("$.camera.follow('#hero')")
    a.step(3)
    check(a.eval("$.camera.followed() !== null") is True, "follow по рабочему селектору работает")


def run_extra(a):
    """Прочие «тихие» промахи в тех же файлах (пункт 4 задачи)."""
    print("--- typeBias и зона камеры ---")
    msgs = logs(a, "$.alive.typeBias('нет-такого'); $.alive.typeBias('нет-такого');")
    check(len(hits(msgs)) == 1,
          "typeBias: одно сообщение на два вызова: %s" % (hits(msgs),))
    check(a.eval("$.alive.typeBias($.alive.types()[0]) !== null") is True,
          "typeBias по рабочему id отвечает как раньше")

    msgs = hits(logs(a, "$.camera.zone('нет-такого'); $.camera.zone('нет-такого');"))
    check(len(msgs) == 1, "camera.zone: одно сообщение на неизвестную зону: %s" % (msgs,))
    check(any("зона" in m and "не найдена" in m for m in msgs),
          "camera.zone: сообщение про зону, а не про точку: %s" % (msgs,))
    a.eval("$.camera.zone('well', { x: 0, y: 700, w: 900, h: 800, zoom: 1.25 })")
    check(logs(a, "$.camera.zone('well')") == [], "рабочая зона молчит")


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run_alive(a)
        run_bsp(a)
        run_camera(a)
        run_extra(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки единого правила промаха пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
