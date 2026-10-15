#!/usr/bin/env python3
# ===========================================================================
# Тест «ощущения удара» через агентский интерфейс.
#
# Проверяет в живом движке то, что нельзя проверить юнит-тестом qjs:
#   * $.time.freeze останавливает и логику кадра, и шаг физики Box2D
#     (тело в полёте не двигается ни на пиксель), при этом кадр идёт;
#   * после заморозки мир продолжает движение с той же точки;
#   * при --fixed-dt два одинаковых прогона с заморозкой совпадают кадр в кадр;
#   * событие hit из Box2D даёт полный хит-фидбек от одной подписки
#     ($.hits.on('#foe','crit')): частицы, вспышка узла, вспышка экрана,
#     тряска камеры, hit-stop;
#   * $.fx.flash живёт своей длительностью и гаснет.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_feel_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "feel")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def trace(frames=36, warmup=20, freeze_at=8, freeze_ms=200):
    """Свежий прогон: разгон, заморозка на freeze_at, позиции по кадрам."""
    with Agent(game=GAME, seed=7) as a:
        a.step(warmup)
        out = []
        for i in range(frames):
            if i == freeze_at:
                a.eval(f"$.time.freeze({freeze_ms}); true")
            a.step(1)
            out.append([
                round(a.eval("$('#hero').pos().y"), 6),
                a.eval("$.time.frame()"),
            ])
        return out


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- API на месте ------------------------------------------------------
        check(a.eval("typeof $.time.freeze") == "function", "$.time.freeze есть")
        check(a.eval("typeof $.time.hitStop") == "function", "$.time.hitStop есть")
        check(a.eval("typeof $.time.slow") == "function", "$.time.slow есть")
        check(a.eval("typeof $.time.frozen") == "function", "$.time.frozen есть")
        check(a.eval("typeof $.time.physicsScale") == "function",
              "$.time.physicsScale есть (мост к шагу физики)")
        check(a.eval("typeof $.hits") == "object", "$.hits поставлен")
        check(a.eval("typeof $.hitFx") == "function", "$.hitFx — одна строка для .on('hit')")
        check(a.eval("typeof $.fx.flash") == "function", "$.fx.flash (вспышка экрана) есть")
        check("crit" in (a.eval("$.hits.presets()") or []), "пресет crit на месте")
        check(a.eval("typeof $('#hero').squash") == "function",
              "метод узла .squash() объявлен")
        check(a.eval("typeof $('#hero').knockback") == "function",
              "метод узла .knockback() объявлен")

        # --- Заморозка останавливает физику, кадр идёт -------------------------
        a.step(30)
        y0 = a.eval("$('#hero').pos().y")
        frame0 = a.eval("$.time.frame()")
        check(y0 > 105, f"герой в полёте и разогнался (y={y0:.1f})")

        a.eval("$.time.freeze(2000); true")
        check(a.eval("$.time.frozen()") is True, "заморозка взведена")
        check(abs(a.eval("$.time.physicsScale()")) < 1e-9,
              "шаг физики получил множитель 0")

        a.step(20)
        y1 = a.eval("$('#hero').pos().y")
        frame1 = a.eval("$.time.frame()")
        check(abs(y1 - y0) < 0.01,
              f"тело стоит на заморозке (y {y0:.3f} → {y1:.3f})")
        check(frame1 - frame0 == 20,
              f"кадры идут: {frame0} → {frame1}")
        check(a.eval("$.time.delta()") == 0, "игровая дельта на заморозке — ноль")

        a.eval("$.time.unfreeze(); true")
        a.step(5)
        y2 = a.eval("$('#hero').pos().y")
        check(y2 > y1 + 1.0, f"после заморозки мир поехал дальше (y={y2:.1f})")
        check(abs(a.eval("$.time.physicsScale()") - 1.0) < 1e-9,
              "множитель шага физики вернулся к 1")

        # --- Замедление --------------------------------------------------------
        a.eval("$.time.slow(2000, 0.25, { in: 0, out: 0 }); true")
        a.step(2)
        check(abs(a.eval("$.time.physicsScale()") - 0.25) < 1e-9,
              "замедление отдано и шагу физики (bullet time честный)")
        a.eval("$.time._state.slow.length = 0; $.time.physicsScale && true")
        a.step(1)
        check(abs(a.eval("$.time.physicsScale()") - 1.0) < 1e-9,
              "после замедления шаг снова полный")

        # --- Одна подписка даёт полный хит-фидбек ------------------------------
        hits0 = a.eval("$.hits.stats().plays")
        # Пуля летит во врага: Box2D отдаёт событие hit, обработчик — $.hits.on.
        a.eval(
            "$('<bullet>', { id: 'shot' }).at(480, 500).size(6, 6)"
            ".velocity(700, 0).appendTo($.world); true"
        )
        for _ in range(40):
            a.step(1)
            if a.eval("$.hits.stats().plays") > hits0:
                break
        plays = a.eval("$.hits.stats().plays")
        check(plays > hits0, f"событие hit дошло до $.hits (plays={plays})")
        check(a.eval("$.store.get('feelHits')") > 0, "подписка на 'hit' сработала")

        check(a.eval("$('#foe').get(0).tint_timer") > 0, "вспышка узла (tint) взведена")
        check(a.eval("$.fx.flashLeft()") > 0, "вспышка экрана из пресета crit")
        check(a.eval("$.camera._state.shake_amp") > 0, "тряска камеры взведена")
        check(a.eval("$.time.frozen()") is True, "hit-stop от пресета заморозил время")
        check(a.eval("$('particles').count()") > 0, "искры в точке контакта родились")
        check(a.eval("$.hits.stats().tweens") > 0, "squash/отдача завели таймлайны")
        foe_x = a.eval("$('#foe').get(0).x")

        a.step(20)
        check(a.eval("$.fx.flashLeft()") == 0, "вспышка экрана гаснет сама")

        # Squash обязан вернуть исходный масштаб, а не оставить врага сплюснутым.
        for _ in range(20):
            a.step(1)
            if a.eval("$.hits.stats().tweens") == 0:
                break
        check(a.eval("$.hits.stats().tweens") == 0, "таймлайны хит-фидбека закрылись")
        check(abs(a.eval("$('#foe').get(0).scale_x") - 1.0) < 1e-6,
              "squash вернул масштаб врага к 1")
        check(a.eval("$('#foe').get(0).x") > foe_x,
              "отдача сдвинула врага по направлению удара")

        # --- Детерминизм при --fixed-dt ---------------------------------------
        # Два независимых прогона одного сценария: разгон, заморозка, кадры.
        first = trace()
        second = trace()
        same = len(first) == len(second) and len(first) > 0
        if same:
            for i, (one, two) in enumerate(zip(first, second)):
                if one[1] != two[1] or abs(one[0] - two[0]) > 1e-9:
                    same = False
                    print(f"       расхождение на кадре {i}: {one} != {two}")
                    break
        check(same, "два прогона с заморозкой совпали кадр в кадр (--seed 7, --fixed-dt)")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
