#!/usr/bin/env python3
# ===========================================================================
# Промах цели в $.sound, $.ui (8 методов) и $.tilemap (resolveTm): слышен и
# не заливает журнал (task-49, продолжение task-46/47/48).
#
# До правки: `$.sound.playAt(what, '#нет')` → точка (0, 0) молча;
# `$.ui.hide/label/aria/ariaOf/persist/transient` → тихий no-op;
# `$.tilemap.*` (19 методов через resolveTm) → умолчания молча. Плюс в $.ui не
# различалось «ничего не нашлось» и «нашлось несколько».
#
# После правки: одно сообщение на пару «место + цель» (ключ — сырая цель, после
# успешного разрешения серия начинается заново), возвраты прежние,
# множественные совпадения названы вслух («применяю ко всем» / «беру первый»).
#
# Запуск после сборки:
#   python3 tests/agent/target_miss_ui_sound_tilemap_test.py
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


def misses(msgs):
    """Сообщения о цели: промах, «не карта» или множественное совпадение."""
    return [m for m in msgs
            if ("ни к чему не подошёл" in m or "не карта" in m
                or "не найдена" in m or "подошёл к" in m)]


def run_sound(a):
    print("--- $.sound ---")
    msgs = logs(a, "$.sound.playAt('нет.wav', '#%s'); $.sound.playAt('нет.wav', '#%s');"
                    % (MISS, MISS))
    check(len(misses(msgs)) == 1,
          "playAt: два вызова с промахом → одно сообщение: %s" % (misses(msgs),))
    check(any("sound.playAt" in m for m in misses(msgs)),
          "в сообщении назван метод: %s" % (misses(msgs),))
    got = a.eval("$.sound.playAt('нет.wav', '#%s')" % MISS)
    check(got == -1, "playAt: возврат -1 сохранён (получено %s)" % (got,))
    check(misses(logs(a, "$.sound.playAt('нет.wav', '#hero')")) == [],
          "рабочий селектор не считается промахом")


def run_ui(a):
    print("--- $.ui ---")
    a.eval("""(function(){
        $('<ui.label>', { id: 'u1', class: 'multi', text: 'A' }).appendTo($.ui);
        $('<ui.label>', { id: 'u2', class: 'multi', text: 'B' }).appendTo($.ui);
    })()""")
    a.step(1)

    for method, expr in [
        ("hide", "$.ui.hide('#%s')" % MISS),
        ("label", "$.ui.label('#%s', 'x')" % MISS),
        ("bar", "$.ui.bar('#%s', 0.5)" % MISS),
        ("persist", "$.ui.persist('#%s')" % MISS),
    ]:
        msgs = misses(logs(a, expr))
        check(len(msgs) == 1, "%s: промах слышен один раз: %s" % (method, msgs))
        check(any("ui.%s" % method in m for m in msgs),
              "%s: в сообщении назван метод: %s" % (method, msgs))

    msgs = misses(logs(a, "$.ui.ariaOf('#%s')" % MISS))
    check(len(msgs) == 1, "ariaOf: промах слышен: %s" % (msgs,))
    check(a.eval("$.ui.ariaOf('#%s') === null" % MISS) is True, "ariaOf: возврат null сохранён")
    check(a.eval("$.ui.hide('#%s') === $.ui" % MISS) is True, "hide: цепочка (возврат $.ui) сохранена")

    # Множественные совпадения — названы вслух, но поведение прежнее (все узлы).
    msgs = misses(logs(a, "$.ui.hide('.multi')"))
    check(len(msgs) == 1 and "2" in msgs[0],
          "hide('.multi'): сказано про 2 совпадения: %s" % (msgs,))
    check(a.eval("$('#u1').isVisible() === false && $('#u2').isVisible() === false") is True,
          "hide('.multi') скрыл ОБА узла (поведение прежнее)")
    check(logs(a, "$.ui.hide('.multi')") == [] or len(misses(logs(a, "$.ui.hide('.multi')"))) == 0,
          "повторный hide('.multi') не повторяет сообщение")

    msgs = misses(logs(a, "$.ui.ariaOf('.multi')"))
    check(len(msgs) == 1 and "первый" in msgs[0],
          "ariaOf('.multi'): сказано, что берётся первый: %s" % (msgs,))

    # Горячий путь: UI-цикл не должен заливать журнал.
    a.eval("""
    (function () {
        const ctx = $.ctx;
        globalThis.__miss = [];
        const real = ctx.log;
        ctx.log = function (msg) { if (String(msg).indexOf('нет-в-цикле') >= 0) globalThis.__miss.push(String(msg)); };
        globalThis.__restore = function () { ctx.log = real; };
    })()
    """)
    for _ in range(5):
        a.step(1)
        a.eval("$.ui.hide('#нет-в-цикле'); $.ui.label('#нет-в-цикле', 'x')")
    count = a.eval("globalThis.__miss.length")
    a.eval("globalThis.__restore()")
    check(count == 2,
          "ui в цикле: 5 кадров × 2 метода → сообщений %s (ждали 2: по одному на метод)"
          % (count,))


def run_tilemap(a):
    print("--- $.tilemap ---")
    a.eval("""$.tilemap.create({ id: 'lv', src: null, tile: 32, cols: 2, rows: 1,
        solid: true, data: ['10'] }).at(0, 0)""")
    a.step(2)

    cases = [
        ("solidAt", "$.tilemap.solidAt('#%s', 0, 0)" % MISS, "false"),
        ("layer", "$.tilemap.layer('#%s')" % MISS, "null"),
        ("visualOf", "$.tilemap.visualOf('#%s', 1)" % MISS, "null"),
        ("shapeAt", "$.tilemap.shapeAt('#%s', 0, 0)" % MISS, "null"),
    ]
    for method, expr, want in cases:
        msgs = misses(logs(a, expr))
        got = a.eval("String(%s)" % expr)
        check(len(msgs) == 1, "%s: промах карты слышен: %s" % (method, msgs))
        check(any("tilemap.%s" % method in m for m in msgs),
              "%s: в сообщении назван метод: %s" % (method, msgs))
        check(got == want, "%s: возврат %s сохранён (получено %s)" % (method, want, got))

    check(misses(logs(a, "$.tilemap.solidAt('#lv', 0, 0)")) == [],
          "рабочий селектор карты не считается промахом")
    check(a.eval("$.tilemap.solidAt('#lv', 0, 0)") is True, "solidAt рабочей карты отвечает true")

    # Узел найден, но это не карта — раньше выглядело как «пустая карта».
    msgs = misses(logs(a, "$.tilemap.solidAt('#hero', 0, 0)"))
    check(len(msgs) == 1 and "не карта" in msgs[0],
          "не-карта названа вслух: %s" % (msgs,))
    check(a.eval("$.tilemap.solidAt('#hero', 0, 0)") is False, "возврат для не-карты прежний")

    # Игровой цикл: solidAt в кадре — классический источник «сообщение на кадр».
    a.eval("""
    (function () {
        const ctx = $.ctx;
        globalThis.__miss = [];
        const real = ctx.log;
        ctx.log = function (msg) { if (String(msg).indexOf('нет-в-цикле') >= 0) globalThis.__miss.push(String(msg)); };
        globalThis.__restore = function () { ctx.log = real; };
    })()
    """)
    for _ in range(5):
        a.step(1)
        a.eval("$.tilemap.solidAt('#нет-в-цикле', 0, 0)")
    count = a.eval("globalThis.__miss.length")
    a.eval("globalThis.__restore()")
    check(count == 1,
          "solidAt в кадре: 5 вызовов → сообщений %s (ждали 1)" % (count,))


def run_doc_examples(a):
    """Примеры доков: sound.md:10/24, ui.md:72–74/120–121, tilemap.md:199/310/858."""
    print("--- примеры доков ---")
    a.eval("""(function(){
        for (const id of ['hp', 'stam', 'hud', 'hud_hp', 'hud_bar', 'pause_menu']) {
            $('<ui.label>', { id: id, text: id }).appendTo($.ui);
        }
        $.tilemap.create({ id: 'level', src: null, tile: 32, cols: 4, rows: 1,
            layers: [ { data: ['1111'], solid: false }, { data: ['2222'], solid: false } ] }).at(0, 0);
    })()""")
    a.step(2)

    cases = [
        ("$.ui.aria('#hp', { role: 'status', label: 'Здоровье', live: 'polite' }); "
         "$.ui.ariaOf('#hp').role", "status", "ui.md:72/74 aria+ariaOf"),
        ("$.ui.aria('#stam', { role: 'progressbar', max: 100 }) === $.ui", True, "ui.md:73 aria"),
        ("$.ui.persist('#hud, #hud_hp, #hud_bar') === $.ui && $.ui.persistCount() >= 3",
         True, "ui.md:120 persist со списком селекторов"),
        ("$.ui.transient('#pause_menu') === $.ui", True, "ui.md:121 transient"),
        ("$.sound.playAt('boom.wav', 500, 200, { radius: 600 })", -1,
         "sound.md:10 playAt числами"),
        ("$.tilemap.layer('#level', 1)", 1, "tilemap.md:199 layer('#level', 1)"),
        ("Array.isArray($.tilemap.runsOf('#level', 0))", True, "tilemap.md:310 runsOf('#level', 0)"),
        ("$.tilemap.visualOf('#level', 4) === null || typeof $.tilemap.visualOf('#level', 4) === 'object'",
         True, "tilemap.md:858 visualOf('#level', 4)"),
        ("typeof $.tilemap.solidAt('#level', 0, 0)", "boolean", "tilemap.md: контракт solidAt"),
    ]
    for code, want, label in cases:
        msgs = misses(logs(a, code))
        got = a.eval(code)
        check(got == want, "%s → %s" % (label, got))
        check(msgs == [], "%s: без промахов цели: %s" % (label, msgs))


def main():
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(3)
        run_sound(a)
        run_ui(a)
        run_tilemap(a)
        run_doc_examples(a)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки промахов sound/ui/tilemap пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
