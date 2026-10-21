#!/usr/bin/env python3
# ===========================================================================
# Сниппеты оружия и зон в настоящем runtime (docs/SNIPPETS.md):
#   weapon.base + weapon.hitscan — луч снимает здоровье цели перед героем;
#   weapon.base + weapon.projectile — снаряд долетает и бьёт;
#   weapon.melee — удар в радиусе; trigger.base — $.emit при входе в зону.
# Всё подключается командами r2d snippet и генерацией, без ручного JS.
# Запуск: python3 tests/agent/snippets_combat_test.py
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
    $('<hero>', { id: 'gunner' }).at(100, 100).size(16, 16).body('dynamic').health(100).appendTo($.world);
    $('<enemy>', { id: 'target', class: 'enemy' }).at(300, 100).size(20, 20).body('static').health(100).appendTo($.world);
    $('<hero>', { id: 'shooter' }).at(100, 300).size(16, 16).body('dynamic').health(100).appendTo($.world);
    $('<enemy>', { id: 'target2', class: 'enemy' }).at(260, 300).size(20, 20).body('static').health(100).appendTo($.world);
    $('<hero>', { id: 'brawler' }).at(100, 500).size(16, 16).body('dynamic').health(100).appendTo($.world);
    $('<enemy>', { id: 'target3', class: 'enemy' }).at(124, 500).size(16, 16).body('static').health(100).appendTo($.world);
    $('<zone>', { id: 'gate' }).at(700, 100).size(60, 60).appendTo($.world);
    $('<player>', { id: 'walker' }).at(600, 100).size(16, 16).body('dynamic').appendTo($.world);
});
"""


def main():
    tmp = tempfile.mkdtemp(prefix="r2d-snipcombat-")
    game = os.path.join(tmp, "game")
    os.makedirs(game)
    open(os.path.join(game, "main.js"), "w").write(MAIN)
    json.dump({"schema_version": 2, "project": {"name": "Combat", "version": "0.1.0"},
               "runtime": {"entry": "main.js", "window": {"title": "Combat", "width": 960, "height": 640}}},
              open(os.path.join(game, "project.json"), "w"))
    r2d("project-index", game, "--write")
    steps = [
        ("weapon.hitscan", "object:gunner", []),
        ("weapon.projectile", "object:shooter", []),
        ("weapon.melee", "object:brawler", []),
        ("trigger.base", "object:gate", ['detect="#walker"', 'enterEvent="gate:open"']),
    ]
    for pkg, owner, values in steps:
        res = r2d("snippet", "add", game, pkg, "--owner", owner)
        check(res["ok"], "%s → %s: %s" % (pkg, owner, res.get("added")))
        if values:
            check(r2d("snippet", "set", game, "snippet:%s:%s" % (owner.split(":")[1], pkg), *values)["ok"], "%s: значения" % pkg)
    # Снаряду — свой ствол, чтобы темп не делился с hitscan.
    r2d("snippet", "set", game, "snippet:shooter:weapon.base", 'weapon="blaster"', 'fireKey="u"')
    r2d("snippet", "set", game, "snippet:gunner:weapon.base", 'weapon="rifle"', "damage=30")
    gen = r2d("snippet", "generate", game, "--write")
    check(gen["ok"], "generate: %s" % [d["message"] for d in gen["diagnostics"]])
    v = r2d("validate", game)
    check(v["ok"], "validate: %s" % [(d["code"], d["message"]) for d in v["diagnostics"] if d["severity"] == "error"])

    with Agent(game=game, seed=4) as a:
        a.step(5)
        a.eval("globalThis.__gate = 0; $.on('gate:open', () => { __gate++; }); 'ok'")
        a.tap("J")
        a.step(3)
        hp = a.eval("$('#target').hp()")
        check(hp == 70, "hitscan: урон 30 по цели (hp %s)" % hp)
        a.tap("U")
        a.step(30)
        hp2 = a.eval("$('#target2').hp()")
        check(hp2 < 100, "projectile: снаряд попал (hp %s)" % hp2)
        check(a.eval("$('bullet').length") == 0, "снаряд удалён после попадания")
        a.tap("K")
        a.step(3)
        hp3 = a.eval("$('#target3').hp()")
        check(hp3 == 85, "melee: урон 15 в радиусе (hp %s)" % hp3)
        a.eval("$('#walker').at(700, 100); 'ok'")
        a.step(5)
        check(a.eval("__gate") == 1, "trigger: $.emit('gate:open') при входе (%s)" % a.eval("__gate"))
        errs = a.eval("$.debug.errors()") or []
        check(not errs, "без ошибок runtime: %s" % [e.get("message") for e in errs[:3]])

    shutil.rmtree(tmp, ignore_errors=True)
    if FAILURES:
        print("FAILED: %d" % len(FAILURES))
        sys.exit(1)
    print("snippets_combat_test: ok")


if __name__ == "__main__":
    main()
