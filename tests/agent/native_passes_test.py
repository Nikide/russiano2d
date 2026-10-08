#!/usr/bin/env python3
# ===========================================================================
# Нативные проходы кадра (src/nodes.c) рисуют и считают ровно то же, что
# прежний JS-путь: кадр совпадает до байта, наведение и события мира те же.
#
# Переключатель — $.debug.nativePasses(false): он возвращает JS-проходы, не
# трогая сцену. Фикстура tests/fixtures/native_passes статична.
#
# Запуск после сборки:
#   python3 tests/agent/native_passes_test.py
# ===========================================================================

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "native_passes")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, folder, name):
    path = a.screenshot(os.path.join(folder, name + ".png"))
    with open(path, "rb") as f:
        return f.read()


def main():
    folder = tempfile.mkdtemp(prefix="r2d_native_passes_")
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(5)   # атлас глифов текста доезжает в GPU со следующего кадра
        check(a.eval("$.debug.nativePasses()") is True, "нативные проходы включены по умолчанию")

        native = shot(a, folder, "native")
        stats_native = a.eval("JSON.stringify($.gfx.stats())")
        a.eval("$.debug.nativePasses(false); true")
        check(a.eval("$.debug.nativePasses()") is False, "переключатель возвращает JS-путь")
        a.step(1)
        js = shot(a, folder, "js")
        stats_js = a.eval("JSON.stringify($.gfx.stats())")
        check(native == js, "кадр C и кадр JS совпадают до байта (%s)" % folder)
        check(stats_native == stats_js, "статистика кадра та же: %s / %s" % (stats_native, stats_js))

        # Индекс реестра: те же выборки по тегу, классу и признакам. Узел
        # создаётся и убирается, чтобы индекс перестроился в каждом режиме.
        digest = ("(() => { $('<rect>').remove(); const q = s => $(s).nodes.map(n => n.uid).join(',');"
                  " return [q('rect'), q('.cell'), q('rect.cell'), q('text'), q('light'), q('*'),"
                  " q('.cell:visible'), q('#parent > *')].join('|'); })()")
        index = {}
        for mode in (True, False):
            a.eval("$.debug.nativePasses(%s); true" % ("true" if mode else "false"))
            index[mode] = a.eval(digest)
        check(index[True] == index[False] and len(index[True]) > 20, "индекс реестра C и JS совпадает")

        # Наведение: тот же «верхний» узел и те же события в обоих режимах.
        a.eval("globalThis.__ev = []; $('*').on('mouseenter', e => __ev.push('in:' + (e.self.attr('id') || e.self.get(0).uid)));"
               "$('*').on('mouseleave', e => __ev.push('out:' + (e.self.attr('id') || e.self.get(0).uid))); true")
        results = {}
        for mode in (False, True):
            # Одинаковый старт: мышь в пустом углу, события прошлого режима отброшены.
            a.eval("$.debug.nativePasses(%s); true" % ("true" if mode else "false"))
            a.mouse_move(x=10, y=10)
            a.step(2)
            a.eval("globalThis.__ev.length = 0; true")
            trace = []
            for (x, y) in ((620, 420), (330, 300), (10, 10), (640, 440)):
                a.mouse_move(x=x, y=y)
                a.step(1)
                picked = a.eval("(() => { const n = $(':picked'); return n.length; })()")
                trace.append((x, y, picked))
            results[mode] = (trace, a.eval("JSON.stringify(globalThis.__ev)"))
        check(results[True] == results[False], "наведение совпадает: %s / %s"
              % (json.dumps(results[True]), json.dumps(results[False])))

        # События мира: урон, лечение, смерть, скрытие — в обоих режимах.
        events = {}
        for mode in (False, True):
            a.eval("$.debug.nativePasses(%s); true" % ("true" if mode else "false"))
            a.eval("(() => { globalThis.__w = []; const n = $('<npc>', { id: 'v%d' }).at(-500, -500).appendTo($.world);"
                   "for (const ev of ['hit', 'heal', 'death', 'dead', 'respawn', 'show', 'hide'])"
                   "  n.on(ev, e => __w.push(ev + ':' + JSON.stringify(e.data))); return true; })()" % mode)
            a.step(1)
            a.eval("$('#v%d').damage(5); true" % mode)
            a.step(1)
            a.eval("$('#v%d').heal(2); $('#v%d').hide(); true" % (mode, mode))
            a.step(1)
            a.eval("$('#v%d').kill(); true" % mode)
            a.step(1)
            a.eval("$('#v%d').respawn(-500, -500).show(); true" % mode)
            a.step(1)
            events[mode] = a.eval("JSON.stringify(globalThis.__w)")
        check(events[True] == events[False], "события мира совпадают: %s" % events[True])
        check("hit:" in events[True] and "death:" in events[True] and "hide:" in events[True],
              "события вообще приходят")

        # Синк физики: тело падает одинаково в обоих режимах.
        falls = {}
        for mode in (False, True):
            a.eval("$.debug.nativePasses(%s); $.world.gravity(0, 900);"
                   "$('<enemy>', { id: 'fall%d' }).at(100, 100).appendTo($.world); true"
                   % ("true" if mode else "false", mode))
            a.step(20)
            falls[mode] = a.eval("(() => { const p = $('#fall%d').pos(); return [Math.round(p.x * 1000), Math.round(p.y * 1000)]; })()" % mode)
            a.eval("$('#fall%d').remove(); $.world.gravity(0, 0); true" % mode)
        check(falls[True] == falls[False] and falls[True][1] > 100000,
              "синк тела одинаков: %s / %s" % (falls[True], falls[False]))

    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        sys.exit(1)
    print("Все проверки пройдены")


if __name__ == "__main__":
    main()
