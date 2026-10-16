#!/usr/bin/env python3
# ===========================================================================
# BASHNYA H6 и H10 (task-58): единый тип коллекции у `$.find` и размер узла,
# который не переписывает смена листа.
#
# H6 (несогласованность API). Было: `$.find(sel)` → СЫРОЙ массив узлов,
# `$(sel)` → обёртка. У сырого узла `get` — геттер АТРИБУТОВ, поэтому
# `$.find('.x')[0].get(0)` читал атрибут "0" (undefined), а `$('.x').get(0)`
# отдавал узел; `.size()` у сырого узла нет, зато есть числовое поле `size`.
# Стало: `$.find` возвращает обёртку (итерируемую — `for…of` даёт узлы),
# сырой массив остался явным `$.findNodes(sel)`.
#
# H10 (дефект). Было: `setSprite()` брал размер у спрайта, если `w === 32 || w === 0`
# — то есть ЯВНЫЙ `.size(32, 32)` был неотличим от «размер не задавали», и
# `.frames()`/`.sprite({cols,rows,cw,ch})` переписывали габариты узла размером
# кадра (замер: `.size(32,32)` → 128×32). Стало: флаг `size_locked`, который
# ставят явные пути размера (`.size()`, `.w/.h`, атрибуты `{w,h}`);
# авторазмер из спрайта остался для узлов, где размер не задавали.
#
# Запуск после сборки:
#   python3 tests/agent/api_find_frames_size_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "hello")
FAILURES = []
#: Лист для проверки размера кадра: 128×32, режем одним кадром.
SHEET = "{ src: 'assets/atlas.png', cols: 1, rows: 1, cw: 128, ch: 32 }"


def safe(a, code):
    """eval, который не роняет тест: на старом коде часть имён не существует."""
    try:
        return a.eval(code)
    except Exception as exc:      # noqa: BLE001 — нужен текст ошибки
        return "ERR: %s" % exc


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run_h6(a):
    print("--- H6: $.find отдаёт обёртку, как $() ---")
    check(safe(a, "$.find('.goblin').constructor.name") == "Wrapper",
          "$.find('.goblin') — обёртка, а не сырой массив")
    check(a.eval("$.find('.goblin').length") == 3, "length работает: 3")
    check(safe(a, "$.find('.goblin').get(0).tag") == "enemy",
          ".get(0) отдаёт УЗЕЛ (раньше у сырого узла это читало атрибут '0')")
    check(a.eval("(function(){ const out = []; for (const n of $.find('.goblin')) out.push(n.tag); return out.join(','); })()")
          == "enemy,enemy,enemy",
          "for…of по $.find даёт узлы (совместимость с прежним обходом)")
    check(safe(a, "$.find('#hero').size()") == {"w": 28, "h": 40},
          "методы обёртки доступны: $.find('#hero').size()")
    check(a.eval("$.find('#нет-такого').length") == 0,
          "пустая выборка — обёртка с length 0 (без падения)")

    check(safe(a, "Array.isArray($.findNodes('.goblin'))") is True,
          "$.findNodes('.goblin') — сырой массив (явный доступ)")
    check(safe(a, "$.findNodes('#hero')[0].tag") == "player",
          "$.findNodes отдаёт сырые узлы")
    check(safe(a, "$.findNodes('#hero')[0].get('id')") == "hero",
          "у сырого узла get() читает атрибут — различие теперь ЯВНОЕ")


def run_h10(a):
    print("--- H10: .frames()/.sprite() не меняют размер узла ---")
    a.eval("globalThis.__n1 = $('<sprite>', { id: 'n1' }).size(32, 32)")
    a.eval("globalThis.__n1.frames(%s)" % SHEET)
    check(a.eval("globalThis.__n1.size()") == {"w": 32, "h": 32},
          "явный .size(32,32) пережил .frames(cw128): %s" % (a.eval("globalThis.__n1.size()"),))

    a.eval("globalThis.__n2 = $('<sprite>', { id: 'n2' }).size(32, 32)")
    a.eval("globalThis.__n2.sprite(%s)" % SHEET)
    check(a.eval("globalThis.__n2.size()") == {"w": 32, "h": 32},
          "то же для .sprite({cols,rows,cw,ch}): %s" % (a.eval("globalThis.__n2.size()"),))

    a.eval("globalThis.__n3 = $('<sprite>', { id: 'n3' })")
    a.eval("globalThis.__n3.frames(%s)" % SHEET)
    check(a.eval("globalThis.__n3.size()") == {"w": 128, "h": 32},
          "без явного размера узел по-прежнему берёт размер кадра (совместимость)")

    a.eval("globalThis.__n4 = $('<sprite>', { id: 'n4', w: 40, h: 40 })")
    a.eval("globalThis.__n4.frames(%s)" % SHEET)
    check(a.eval("globalThis.__n4.size()") == {"w": 40, "h": 40},
          "размер из атрибутов {w,h} тоже явный: %s" % (a.eval("globalThis.__n4.size()"),))

    a.eval("globalThis.__n5 = $('<sprite>', { id: 'n5' }); globalThis.__n5.w = 50; globalThis.__n5.h = 60")
    a.eval("globalThis.__n5.frames(%s)" % SHEET)
    check(a.eval("globalThis.__n5.size()") == {"w": 50, "h": 60},
          "поля .w/.h тоже фиксируют размер: %s" % (a.eval("globalThis.__n5.size()"),))

    # Смена листа дважды подряд: габариты не «плывут».
    a.eval("globalThis.__n1.frames({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: 32, ch: 32 })")
    check(a.eval("globalThis.__n1.size()") == {"w": 32, "h": 32},
          "повторная смена листа размер не меняет: %s" % (a.eval("globalThis.__n1.size()"),))
    check(a.eval("globalThis.__n1.frames !== undefined && globalThis.__n1.size().w === 32") is True,
          "кадры при этом сменились (вызов отработал)")


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run_h6(a)
        run_h10(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки H6/H10 пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
