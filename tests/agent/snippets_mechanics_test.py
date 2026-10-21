#!/usr/bin/env python3
# ===========================================================================
# Механики, добавленные нормализацией §12 (docs/SNIPPET_SYSTEM_PROJECT.md):
# подключение командами r2d snippet → generate → настоящий runtime, проверка
# поведения, а не только отсутствия ошибок.
# Запуск: python3 tests/agent/snippets_mechanics_test.py
# ===========================================================================
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent   # noqa: E402

R2D = os.path.abspath(os.environ.get("R2D_BINARY") or os.path.join(ROOT, "build-xmake/macos-arm64/macosx/arm64/release/r2d"))
os.environ["R2D_BINARY"] = R2D
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def r2d(*args):
    out = subprocess.run([R2D, *args], cwd=ROOT, capture_output=True, text=True).stdout
    return json.loads([l for l in out.splitlines() if l.startswith("{")][-1])


MAIN = """$.ready(() => {
    $.world.gravity(0, 0);
    $.items.define({ id: 'seed_wheat', title: 'Семя' });
    $.items.define({ id: 'wheat', title: 'Пшеница' });
    $('<hero>', { id: 'hero' }).at(100, 100).size(16, 16).body('dynamic').health(50).appendTo($.world);
    $('<plot>', { id: 'plot' }).at(120, 100).size(16, 16).appendTo($.world);
    $('<car>', { id: 'car', class: 'racer' }).at(400, 100).size(16, 16).appendTo($.world);
    $('<gate>', { id: 'g1', class: 'gate' }).at(500, 100).size(20, 60).appendTo($.world);
    $('<gate>', { id: 'g2', class: 'gate' }).at(600, 100).size(20, 60).appendTo($.world);
    $('<unit>', { id: 'u1', class: 'combatant' }).at(100, 300).size(16, 16).appendTo($.world);
    $('<unit>', { id: 'u2', class: 'combatant' }).at(140, 300).size(16, 16).appendTo($.world);
    $('<deck>', { id: 'deck' }).at(300, 300).size(8, 8).appendTo($.world);
    $('<walker>', { id: 'walker' }).at(48, 432).size(16, 16).appendTo($.world);
    $('<light>', { id: 'signal' }).at(700, 300).size(10, 10).appendTo($.world);
    $('<diver>', { id: 'diver' }).at(800, 100).size(16, 16).appendTo($.world);
    $('<water>', { id: 'pool', class: 'water' }).at(800, 100).size(100, 100).appendTo($.world);
});
"""


def main():
    tmp = tempfile.mkdtemp(prefix="r2d-snipmech-")
    game = os.path.join(tmp, "game")
    os.makedirs(game)
    open(os.path.join(game, "main.js"), "w").write(MAIN)
    json.dump({"schema_version": 2, "project": {"name": "Mech", "version": "0.1.0"},
               "runtime": {"entry": "main.js", "window": {"title": "Mech", "width": 960, "height": 640}}},
              open(os.path.join(game, "project.json"), "w"))
    r2d("project-index", game, "--write")
    plan = [
        ("inventory.grid", "object:hero", ['start=["seed_wheat=2"]']),
        ("farming.crop", "object:plot", ["growMs=1000", "needsWater=false"]),
        ("racing.lap-counter", "object:car", ["laps=1"]),
        ("turn.initiative-queue", "project", []),
        ("cards.deck-hand", "object:deck", ['deck=["strike=1","strike=1","heal=2"]', "hand=3", "energy=3", "shuffle=false"]),
        ("grid.pathfinding", "object:walker", ["moves=4", "cell=32", "area=[640,480]", "speed=400"]),
        ("traffic.signal", "object:signal", ["green=200", "yellow=0", "red=200"]),
        ("survival.oxygen", "object:diver", ["drain=50", "damage=100"]),
    ]
    for pkg, owner, values in plan:
        res = r2d("snippet", "add", game, pkg, "--owner", owner)
        check(res["ok"] or all(d["code"] == "SNIP144" for d in res["diagnostics"]), "%s → %s" % (pkg, owner))
        if values:
            iid = "snippet:%s:%s" % (owner.split(":")[-1], pkg)
            s = r2d("snippet", "set", game, iid, *values)
            check(s["ok"], "%s: значения %s" % (pkg, [d["message"] for d in s["diagnostics"]]))
    gen = r2d("snippet", "generate", game, "--write")
    check(gen["ok"], "generate: %s" % [d["message"] for d in gen["diagnostics"]])
    with Agent(game=game, seed=3) as a:
        a.step(5)
        # Грядка: посадить (E рядом), вырасти, собрать.
        a.tap("E"); a.step(3)
        check(a.eval("$('#plot').data('crop')") == "growing", "грядка: посажено (%s)" % a.eval("$('#plot').data('crop')"))
        check(a.eval("$('#hero').data('inv').count('seed_wheat')") == 1, "семя ушло из инвентаря")
        a.step(75)
        check(a.eval("$('#plot').data('crop')") == "ripe", "грядка: созрело (%s)" % a.eval("$('#plot').data('crop')"))
        a.tap("E"); a.step(3)
        check(a.eval("$('#hero').data('inv').count('wheat')") == 3, "урожай в инвентаре: %s" % a.eval("$('#hero').data('inv').count('wheat')"))
        # Круги: проехать ворота по порядку.
        a.eval("globalThis.__fin = null; $.on('race:finish', (e) => { __fin = e.data; }); $('#g1').data('order', 1); $('#g2').data('order', 2); 'ok'")
        a.eval("$('#car').at(500, 100); 'ok'"); a.step(2)
        a.eval("$('#car').at(600, 100); 'ok'"); a.step(2)
        check(a.eval("__fin && __fin.id") == "car", "гонка: финиш после круга (%s)" % a.eval("__fin"))
        # Очередь ходов по инициативе.
        a.eval("$('#u1').data('initiative', 1); $('#u2').data('initiative', 9); globalThis.__turns = []; $.on('turn', (e) => __turns.push(e.data.unit)); $.emit('turn:next'); $.emit('turn:next'); $.emit('turn:next'); 'ok'")
        check(a.eval("__turns") == ["u2", "u1", "u2"], "очередь: по инициативе и по кругу: %s" % a.eval("__turns"))
        # Карты: ход, розыгрыш за энергию, отказ без энергии.
        a.eval("globalThis.__card = []; $('#deck').on('cards:played', (e) => __card.push(e.data.id)); $('#deck').on('cards:denied', () => __card.push('denied')); $('#deck').emit('turn:start'); 'ok'")
        check(a.eval("$('#deck').data('cards').hand.length") == 3, "карты: в руке 3")
        a.eval("$('#deck').emit('cards:play', { index: 2 }); $('#deck').emit('cards:play', { index: 0 }); $('#deck').emit('cards:play', { index: 0 }); 'ok'")
        check(a.eval("__card") == ["heal", "strike", "denied"], "карты: энергия тратится и кончается: %s" % a.eval("__card"))
        # Путь по клеткам: в пределах очков хода — дойти, дальше — отказ.
        a.eval("globalThis.__g = []; $('#walker').on('grid:arrived', () => __g.push('arrived')); $('#walker').on('grid:denied', () => __g.push('denied')); $('#walker').emit('grid:move', { x: 112, y: 432 }); 'ok'")
        a.step(30)
        p = a.eval("$('#walker').pos()")
        check(abs(p["x"] - 112) < 3 and "arrived" in a.eval("__g"), "клетки: дошёл (%s)" % p)
        a.eval("$('#walker').emit('grid:move', { x: 600, y: 32 }); 'ok'")
        check("denied" in a.eval("__g"), "клетки: дальше очков хода — отказ")
        # Светофор: фазы меняются.
        phases = set()
        for _ in range(4):
            phases.add(a.eval("$('#signal').data('signal')")); a.step(8)
        check({"green", "red"} <= phases, "светофор: фазы %s" % phases)
        # Кислород: под водой падает, затем урон.
        a.step(80)
        check(a.eval("$('#diver').data('oxygen')") == 0, "кислород кончился под водой")
        errs = a.eval("$.debug.errors()") or []
        check(not errs, "без ошибок runtime: %s" % [e.get("message") for e in errs[:3]])
    shutil.rmtree(tmp, ignore_errors=True)
    if FAILURES:
        print("FAILED: %d" % len(FAILURES))
        sys.exit(1)
    print("snippets_mechanics_test: ok")


if __name__ == "__main__":
    main()
