#!/usr/bin/env python3
"""r2d snippet update: декларативные миграции значений между версиями пакета.

Пакет проекта 1.0.0 (поле speed) → 1.1.0 (maxSpeed, accel) с миграцией
rename/defaults: --dry-run показывает шаги и не пишет файл, update переносит
значения, неполная цепочка — SNIP146, плохая миграция в manifest — SNIP146.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
R2D = os.path.abspath(os.environ.get("R2D_BINARY") or os.path.join(ROOT, "build-xmake/macos-arm64/macosx/arm64/release/r2d"))
FAILURES = []


def check(c, msg):
    print(("  ok   " if c else "  FAIL ") + msg)
    if not c:
        FAILURES.append(msg)


def r2d(*args):
    out = subprocess.run([R2D, *args], cwd=ROOT, capture_output=True, text=True).stdout
    return json.loads([l for l in out.splitlines() if l.startswith("{")][-1])


def manifest(version, fields, migrations=None):
    m = {"format": "r2d-snippet/1", "id": "game.mover", "version": version, "title": {"ru": "Мувер"}, "kind": "behavior",
         "category": "Пакеты проекта", "targets": ["node"], "slots": [], "requires": [{"api": "$.updateFor"}], "dependencies": [],
         "fields": fields, "source": "src/behavior.js", "examples": [], "tests": []}
    if migrations is not None:
        m["migrations"] = migrations
    return m


def main():
    tmp = tempfile.mkdtemp(prefix="r2d-snipmig-")
    game = os.path.join(tmp, "game")
    pkg = os.path.join(game, "snippets", "game.mover")
    os.makedirs(os.path.join(pkg, "src"))
    open(os.path.join(pkg, "src/behavior.js"), "w").write("export default function mover(node, config, $) { return $.updateFor(node, () => {}); }\n")
    open(os.path.join(game, "main.js"), "w").write("$.ready(() => { $('<hero>', { id: 'hero' }).appendTo($.world); });\n")
    json.dump({"schema_version": 2, "project": {"name": "Mig", "version": "0.1.0"}, "runtime": {"entry": "main.js"}}, open(os.path.join(game, "project.json"), "w"))
    mp = os.path.join(pkg, "snippet.json")
    json.dump(manifest("1.0.0", [{"id": "speed", "type": "number", "default": 100, "min": 0, "max": 1000}, {"id": "old", "type": "bool", "default": False}]), open(mp, "w"))
    r2d("project-index", game, "--write")
    check(r2d("snippet", "add", game, "game.mover", "--owner", "object:hero")["ok"], "экземпляр 1.0.0 добавлен")
    check(r2d("snippet", "set", game, "snippet:hero:game.mover", "speed=250", "old=true")["ok"], "значения 1.0.0 заданы")

    fields2 = [{"id": "maxSpeed", "type": "number", "default": 100, "min": 0, "max": 1000}, {"id": "accel", "type": "number", "default": 500, "min": 0, "max": 5000}]
    json.dump(manifest("1.1.0", fields2, [{"from": "1.0.0", "to": "1.1.0", "rename": {"speed": "maxSpeed"}, "remove": ["old"], "defaults": {"accel": 800}}]), open(mp, "w"))
    v = r2d("snippet", "validate", pkg)
    check(v["ok"], "manifest 1.1.0 с миграцией валиден: %s" % [d["message"] for d in v["diagnostics"]])
    chk = r2d("snippet", "check", game)
    check(any(d["code"] == "SNIP142" for d in chk["diagnostics"]), "до обновления — SNIP142 (версия в проекте старая)")
    before = open(os.path.join(game, "project.json")).read()
    dry = r2d("snippet", "update", game, "--dry-run")
    ch = dry.get("changes", [{}])[0]
    check(dry["ok"] and ch.get("steps") == ["1.0.0→1.1.0"] and ch.get("dropped_fields") == [], "dry-run: шаг миграции и ничего не теряется: %s" % ch)
    check(open(os.path.join(game, "project.json")).read() == before, "dry-run не пишет project.json")
    up = r2d("snippet", "update", game)
    check(up["ok"] and up["written"], "update записан")
    inst = json.load(open(os.path.join(game, "project.json")))["editor"]["snippets"]["instances"][0]
    check(inst["version"] == "1.1.0" and inst["values"] == {"maxSpeed": 250, "accel": 800}, "значения перенесены: %s" % inst["values"])
    check(r2d("snippet", "check", game)["ok"], "после update секция валидна")

    # Неполная цепочка и плохая миграция.
    json.dump(manifest("1.3.0", fields2, [{"from": "1.2.0", "to": "1.3.0"}]), open(mp, "w"))
    gap = r2d("snippet", "update", game)
    check(not gap["ok"] and any(d["code"] == "SNIP146" for d in gap["diagnostics"]), "нет цепочки 1.1.0 → 1.3.0 — SNIP146")
    json.dump(manifest("1.1.0", fields2, [{"from": "1.0.0", "to": "1.1.0", "rename": {"speed": "nope"}}]), open(mp, "w"))
    bad = r2d("snippet", "validate", pkg)
    check(not bad["ok"] and any(d["code"] == "SNIP146" for d in bad["diagnostics"]), "rename в несуществующее поле — SNIP146")

    shutil.rmtree(tmp, ignore_errors=True)
    if FAILURES:
        print("FAILED: %d" % len(FAILURES))
        sys.exit(1)
    print("sdk_snippet_migration_test: ok")


if __name__ == "__main__":
    main()
