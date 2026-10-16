#!/usr/bin/env python3
# ===========================================================================
# BASHNYA H8 и H9 (task-58): зона пробуждения и подмножество пресета.
#
# H8. `auto(what, { region })` — зона пробуждения — уже работал, но об этом не
# было написано; `$.camera.isOnScreen(node, {w,h,dx,dy})` МОЛЧА игнорировал
# объект (отвечал как без него); не было `wakeForever` — «разбудили и не
# усыпляем» (узел, вышедший из зоны, глох на полпути).
#
# H9. `$.hits.play(what, { only: [...] })` принимался и МОЛЧА игнорировался:
# пресет применялся целиком. Теперь `only` — белый список: поля вне списка
# нейтральны (particles/flash/screen → null, shake/hitStop/knockback/squash → 0,
# sound → ''), явные поля opts по-прежнему главнее.
#
# Запуск после сборки:
#   python3 tests/agent/activation_wake_hits_only_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
FAILURES = []
#: Зона вокруг узла в (100, 300): 400×400.
ZONE = "{ x: 100, y: 300, w: 400, h: 400 }"


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run_h8(a):
    print("--- H8: зона пробуждения и isOnScreen ---")
    a.eval("$.camera.unfollow(); $.camera.at(0, 0); $('#hero').at(3000, 300)")
    a.step(2)
    check(a.eval("$.camera.isOnScreen('#hero')") is False,
          "узел вне кадра: isOnScreen без аргумента = false")
    check(a.eval("$.camera.isOnScreen('#hero', 5000)") is True,
          "число осталось запасом в пикселях (совместимость): margin 5000 = true")
    check(a.eval("$.camera.isOnScreen('#hero', { w: 8000, h: 8000 })") is True,
          "ЗОНА {w:8000,h:8000} учитывается (раньше объект игнорировался)")
    check(a.eval("$.camera.isOnScreen('#hero', { w: 100, h: 100 })") is False,
          "малая зона вокруг узла не достаёт до кадра: false")
    check(a.eval("$.camera.isOnScreen('#hero', { w: 100, h: 100, dx: -2900 })") is True,
          "смещение зоны dx учитывается: зона у кадра = true")

    # auto по видимости узла против auto по зоне.
    a.eval("$.activation.clear(); $('#hero').at(3000, 300)")
    a.eval("$.activation.auto('#hero')")
    a.step(2)
    off = a.eval("$('#hero').processing()")
    check(off.get("update") is False and off.get("physics") is False,
          "auto без зоны: узел вне кадра усыплён %s" % (off,))

    a.eval("$.activation.clear(); $('#hero').at(3000, 300)")
    a.eval("$.activation.auto('#hero', { region: { x: 3000, y: 300, w: 4000, h: 4000 } })")
    a.step(2)
    on = a.eval("$('#hero').processing()")
    check(on.get("update") is True and on.get("physics") is True and on.get("timers") is True,
          "auto со ЗОНОЙ: узел вне кадра, но в зоне — обработка включена %s" % (on,))

    # wakeForever: разбудили — не усыпляем.
    a.eval("$.activation.clear(); $.camera.follow('#hero'); $('#hero').at(100, 300)")
    a.step(2)
    a.eval("$.activation.auto('#hero', { region: %s, wakeForever: true })" % ZONE)
    a.step(2)
    check(a.eval("$('#hero').processing().update") is True, "wakeForever: в зоне обработка включена")
    a.eval("$('#hero').at(3000, 300)")
    a.step(3)
    check(a.eval("$('#hero').processing().update") is True,
          "wakeForever: ушёл из зоны — обработка ОСТАЛАСЬ включённой")

    # Контроль: без флага тот же сценарий усыпляет.
    a.eval("$.activation.clear(); $('#hero').at(100, 300)")
    a.step(2)
    a.eval("$.activation.auto('#hero', { region: %s })" % ZONE)
    a.step(2)
    check(a.eval("$('#hero').processing().update") is True, "контроль: в зоне обработка включена")
    a.eval("$('#hero').at(3000, 300)")
    a.step(3)
    check(a.eval("$('#hero').processing().update") is False,
          "контроль без wakeForever: ушёл из зоны — усыплён (прежнее поведение)")
    a.eval("$.activation.clear()")


def run_h9(a):
    print("--- H9: only как белый список пресета ---")
    full = a.eval("(function(){ const s = $.hits.spec('crit');"
                  " return { particles: !!s.particles, flash: !!s.flash, screen: !!s.screen,"
                  " shake: s.shake, hitStop: s.hitStop, squash: s.squash }; })()")
    check(full.get("shake") == 7 and full.get("hitStop") == 110 and full.get("screen") is True,
          "пресет crit целиком: %s" % (full,))

    part = a.eval("(function(){ const s = $.hits.spec('crit', { only: ['particles','flash'] });"
                  " return { particles: !!s.particles, flash: !!s.flash, screen: !!s.screen,"
                  " shake: s.shake, hitStop: s.hitStop, squash: s.squash,"
                  " knockback: s.knockback, sound: s.sound }; })()")
    check(part.get("particles") is True and part.get("flash") is True,
          "only: частицы и вспышка из пресета на месте: %s" % (part,))
    check(part.get("shake") == 0 and part.get("hitStop") == 0 and part.get("squash") == 0
          and part.get("knockback") == 0 and part.get("screen") is False and part.get("sound") == "",
          "only: тряска/заморозка/сжатие/отдача/экран/звук нейтральны: %s" % (part,))

    over = a.eval("(function(){ const s = $.hits.spec('crit', { only: ['flash'], shake: 5 });"
                  " return { shake: s.shake, flash: !!s.flash, particles: s.particles }; })()")
    check(over.get("shake") == 5 and over.get("flash") is True and over.get("particles") is None,
          "only + явное поле opts: opts главнее списка: %s" % (over,))

    played = a.eval("typeof $.hits.play('#hero', { preset: 'hit', only: ['flash'] }).spec")
    check(played == "object", "play с only отрабатывает и отдаёт spec (%s)" % (played,))

    check(a.eval("$.hits.pool()") == 8, "pool по умолчанию 8")
    check(a.eval("$.hits.pool(16)") is True and a.eval("$.hits.pool()") == 16,
          "pool(16) — потолок эмиттеров поднят")
    check(a.eval("$.hits.pool(999)") is False and a.eval("$.hits.pool()") == 16,
          "pool(999) отклонён, размер не изменён (потолок 64)")
    a.eval("$.hits.pool(8)")


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run_h8(a)
        run_h9(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки H8/H9 пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
