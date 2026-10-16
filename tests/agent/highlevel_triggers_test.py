#!/usr/bin/env python3
# ===========================================================================
# Интеграционный тест зон-триггеров (src/highlevel/triggers.js).
#
# Гоняет фикстуру tests/fixtures/triggers и проверяет то, ради чего подсистема
# и делалась: <trigger> реально шлёт enter/leave (один раз на вход, leave при
# выходе и при удалении цели), зона с attrs.detect ловит только совпавшие
# узлы, $.triggers.zone/list/clear/inside/count работают, а .overlaps(sel) и
# .overlaps(sel, cb) больше не молчат.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_triggers_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "triggers")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def move(a, selector, x, y):
    """Ставит узел в точку и даёт кадру синхронизировать трансформы."""
    a.eval(f"$('{selector}').at({x}, {y}); true")
    a.step(2)


def main():
    with Agent(game=GAME, seed=5) as a:
        # --- Состав мира ------------------------------------------------------
        check(a.eval("$('#hero').length") == 1, "игрок создан")
        check(a.eval("$('#door').length") == 1, "зона-дверь создана")
        check(a.eval("$.triggers.list().length") >= 3, "$.triggers.list видит зоны")

        # --- enter: ровно один раз на вход ------------------------------------
        check(a.eval("$.store.get('doorEnter')") == 0, "до входа событий нет")
        move(a, "#hero", 300, 300)
        check(a.eval("$.store.get('doorEnter')") == 1, "enter пришёл при входе в зону")
        check(a.eval("$.store.get('lastOther')") == "hero", "в e.data.other — вошедший узел")

        a.step(3)
        check(a.eval("$.store.get('doorEnter')") == 1, "enter не повторяется, пока мы внутри")

        # --- leave и повторный вход -------------------------------------------
        move(a, "#hero", 100, 100)
        check(a.eval("$.store.get('doorLeave')") == 1, "leave пришёл при выходе")
        move(a, "#hero", 300, 300)
        check(a.eval("$.store.get('doorEnter')") == 2, "повторный вход снова шлёт enter")

        # --- исчезновение цели: leave, а не тишина ----------------------------
        a.eval("$.world.spawn('enemy', 600, 500, { id: 'victim' })")
        a.step(2)
        check(a.eval("$.store.get('trapEnter')") == 1, "ловушка поймала тело")
        a.eval("$('#victim').remove(); true")
        a.step(2)
        check(a.eval("$.store.get('trapLeave')") == 1, "удаление цели даёт leave")

        # --- attrs.detect: только совпавшие узлы ------------------------------
        a.step(3)
        check(a.eval("$.store.get('detectEnter')") == 0,
              "detect-зона игнорирует тела и обычные узлы")
        move(a, "#marker", 500, 100)
        check(a.eval("$.store.get('detectEnter')") == 1, "маркер без тела пойман по селектору")
        check(a.eval("$.triggers.inside('#detect', '#marker')") is True,
              "$.triggers.inside отвечает булевым")
        check(a.eval("$.triggers.count('#detect')") == 1,
              "$.triggers.count считает только цели detect")

        # --- $.triggers.zone: колбэки onEnter/onLeave -------------------------
        a.eval("globalThis.__shopEnter = 0; globalThis.__shopLeave = 0; true")
        a.eval("$.triggers.zone({ id: 'shop', x: 200, y: 500, w: 80, h: 80,"
               " onEnter: () => { globalThis.__shopEnter++; },"
               " onLeave: () => { globalThis.__shopLeave++; } }); true")
        a.eval("$.world.spawn('enemy', 200, 500, { id: 'shopper' })")
        a.step(2)
        check(a.eval("globalThis.__shopEnter") == 1, "onEnter у $.triggers.zone сработал")
        a.eval("$('#shopper').remove(); true")
        a.step(2)
        check(a.eval("globalThis.__shopLeave") == 1, "onLeave у $.triggers.zone сработал")

        # --- .overlaps(sel) → bool --------------------------------------------
        move(a, "#hero", 100, 100)
        check(a.eval("$('#hero').overlaps('.wall')") is False,
              "overlaps(bool) не находит стену издалека")
        move(a, "#hero", 400, 400)
        check(a.eval("$('#hero').overlaps('.wall')") is True,
              "overlaps(bool) находит стену вплотную")

        # --- .overlaps(sel, cb) → колбэк каждый кадр --------------------------
        a.eval("$.store.set('cbCalls', 0); $.store.set('cbHit', 0); true")
        a.eval("$('#hero').overlaps('.wall', (hit, self) => {"
               " $.store.set('cbCalls', $.store.get('cbCalls') + 1);"
               " $.store.set('cbHit', hit ? 1 : 0); }); true")
        move(a, "#hero", 100, 100)
        check(a.eval("$.store.get('cbCalls')") >= 2, "колбэк .overlaps зовётся каждый кадр")
        check(a.eval("$.store.get('cbHit')") == 0, "вне стены колбэк получает null")
        move(a, "#hero", 400, 400)
        check(a.eval("$.store.get('cbHit')") == 1, "в стене колбэк получает обёртку цели")

        # --- потерянная цель не ломает наблюдателя ----------------------------
        a.eval("globalThis.__gone = -1;"
               " $('#hero').overlaps('#wall-a', (hit) => { globalThis.__gone = hit ? 1 : 0; }); true")
        a.eval("$('#wall-a').remove(); true")
        a.step(2)
        check(a.eval("globalThis.__gone") == 0, "исчезнувшая цель даёт null, а не исключение")

        # --- §11: stay / once / cooldown ---------------------------------------
        a.eval("$.store.set('stayN', 0); $.store.set('onceN', 0); $.store.set('cdN', 0);"
               " $.triggers.zone({ id: 'stayzone', x: 100, y: 100, w: 120, h: 120,"
               "   detect: 'player', stay_ms: 50,"
               "   onStay: () => $.store.set('stayN', $.store.get('stayN') + 1) });"
               " $.triggers.zone({ id: 'oncezone', x: 100, y: 100, w: 120, h: 120,"
               "   detect: 'player', once: true,"
               "   onEnter: () => $.store.set('onceN', $.store.get('onceN') + 1) });"
               " $.triggers.zone({ id: 'cdzone', x: 100, y: 100, w: 120, h: 120,"
               "   detect: 'player', cooldown: 1500,"
               "   onEnter: () => $.store.set('cdN', $.store.get('cdN') + 1) });"
               " true")
        move(a, "#hero", 100, 100)          # игрок внутри всех трёх зон
        a.step(20)                          # 20 кадров ≈ 333 мс игрового времени
        stay = a.eval("$.store.get('stayN')")
        check(3 <= stay <= 12,
              "stay приходит по интервалу 50 мс, а не каждый кадр (%s за 20 кадров)" % stay)
        check(a.eval("$.store.get('onceN')") == 1, "once: ровно один enter")

        # cooldown: уходим и возвращаемся в окне 1.5 с — входа нет
        cd_first = a.eval("$.store.get('cdN')")
        move(a, "#hero", 700, 100)
        a.step(2)
        move(a, "#hero", 100, 100)
        a.step(3)
        check(a.eval("$.store.get('cdN')") == cd_first,
              "cooldown гасит повторный вход в окне (%s)" % a.eval("$.store.get('cdN')"))
        # ...а вне окна вход снова работает
        move(a, "#hero", 700, 100)
        a.step(100)                          # ≈ 1.7 с игрового времени
        move(a, "#hero", 100, 100)
        a.step(3)
        check(a.eval("$.store.get('cdN')") == cd_first + 1,
              "после окна cooldown вход снова проходит (%s)" % a.eval("$.store.get('cdN')"))

        # once не повторяется при повторном входе, reset() перевзводит
        move(a, "#hero", 700, 100)
        a.step(2)
        move(a, "#hero", 100, 100)
        a.step(2)
        check(a.eval("$.store.get('onceN')") == 1, "once не повторяется при повторном входе")
        a.eval("$.triggers.reset('#oncezone'); true")
        a.step(2)
        check(a.eval("$.store.get('onceN')") == 2, "reset() перевзвёл once-зону")

        # --- создание внутри зоны даёт enter на следующем кадре ----------------
        a.eval("$.store.set('bornN', 0);"
               " $.triggers.zone({ id: 'borntown', x: 300, y: 300, w: 200, h: 200,"
               "   detect: 'player', onEnter: () => $.store.set('bornN', $.store.get('bornN') + 1) });"
               " $('#hero').at(300, 300); true")
        a.step(2)
        check(a.eval("$.store.get('bornN')") == 1,
              "цель, оказавшаяся в зоне (создание/телепорт), получает enter следующим кадром")

        # --- clear ------------------------------------------------------------
        a.eval("$.triggers.clear(); true")
        check(a.eval("$.triggers.list().length") == 0, "clear убирает зоны")
        check(a.ping().get("pong") is True, "движок жив после всех манипуляций")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
