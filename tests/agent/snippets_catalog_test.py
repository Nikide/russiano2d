#!/usr/bin/env python3
# ===========================================================================
# Каталог сниппетов в настоящем runtime (docs/SNIPPETS.md, ТЗ §16.2).
#
# Для каждого behavior-пакета встроенного каталога — свой объект в проекте;
# пакет подключается через `r2d snippet add` со значениями из его example,
# kit — на отдельный объект целиком. Затем generate → validate → игра:
#   * 90 кадров с удерживаемым вводом — без ошибок $.debug.errors();
#   * у всех объектов отнимается здоровье (ветки урона/регенерации/смерти);
#   * удаление всех узлов — подписки сняты, ошибок нет.
# Запуск: python3 tests/agent/snippets_catalog_test.py
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


ASSET_BY_KIND = {"data": "maps/level.tilemap.json", "audio": "sfx/beep.ogg", "animation": "art/hero.atlas.json"}


def asset_for(field):
    return ASSET_BY_KIND.get(field.get("assetKind"), "art/hero.png")


def slug(pid):
    return "o_" + pid.replace(".", "_").replace("-", "_")


def main():
    m = subprocess.run([sys.executable, os.path.join(ROOT, "scripts/snippet_matrix.py"), "--check"], capture_output=True, text=True)
    check(m.returncode == 0, "матрица §12 актуальна и все пакеты из неё: %s" % m.stdout.strip())
    cat = r2d("snippet", "catalog", "--fields")
    pkgs = [p for p in cat["packages"] if p["scope"] == "builtin"]
    check(cat["ok"] and len(pkgs) == cat["total"], "каталог: %d пакетов" % len(pkgs))
    tmp = tempfile.mkdtemp(prefix="r2d-snipcat-")
    game = os.path.join(tmp, "game")
    os.makedirs(os.path.join(game, "art"))
    shutil.copy(os.path.join(ROOT, "assets/atlas.png"), os.path.join(game, "art/hero.png"))
    os.makedirs(os.path.join(game, "maps"))
    # Атлас — штатной командой SDK, как его сделал бы пользователь.
    r2d("atlas-grid", os.path.join(game, "art/hero.png"), "--out", os.path.join(game, "art/hero.atlas.json"), "--cols", "2", "--rows", "1", "--tags", "idle:0-0,run:1-1")
    os.makedirs(os.path.join(game, "sfx"))
    shutil.copy(os.path.join(ROOT, "assets/audio/sfx/pickup_01.ogg"), os.path.join(game, "sfx/beep.ogg"))
    json.dump({"version": 1, "tile": 16, "cols": 4, "solid": [1], "layers": [{"name": "ground", "depth": 0, "solid": True, "data": [[1, 1, 1, 1], [1, 0, 0, 1], [1, 1, 1, 1]]}]}, open(os.path.join(game, "maps/level.tilemap.json"), "w"))
    lines = ["$.ready(() => {",
             "    $('<ground>', { id: 'floor' }).at(640, 700).size(1280, 20).body('static').appendTo($.world);",
             "    $('<hero>', { id: 'hero' }).at(200, 600).size(16, 24).body('dynamic').health(50).appendTo($.world);"]
    for i, p in enumerate(pkgs):
        lines.append("    $('<thing>', { id: '%s' }).at(%d, 600).size(16, 16).body('dynamic').health(50).appendTo($.world);"
                     % (slug(p["id"]), 300 + (i % 20) * 40))
    lines.append("});")
    open(os.path.join(game, "main.js"), "w").write("\n".join(lines) + "\n")
    json.dump({"schema_version": 2, "project": {"name": "Catalog", "version": "0.1.0"},
               "runtime": {"entry": "main.js", "window": {"title": "Catalog", "width": 1280, "height": 720}}},
              open(os.path.join(game, "project.json"), "w"), ensure_ascii=False, indent=2)
    check(r2d("project-index", game, "--write")["ok"], "граф проекта построен")

    for p in pkgs:
        owner = "project" if p["targets"] == ["project"] else "object:" + slug(p["id"])
        res = r2d("snippet", "add", game, p["id"], "--owner", owner)
        if not res["ok"] and not all(d["code"] == "SNIP144" for d in res["diagnostics"]):
            check(False, "%s: add — %s" % (p["id"], [d["message"] for d in res["diagnostics"]]))
            continue                     # SNIP144 — уже подключён как зависимость другого пакета
        example = json.load(open(os.path.join(ROOT, "snippets", p["id"], "examples/example.json")))
        values = dict(example.get("values", {}))
        for f in p.get("fields", []):
            if f["type"] == "asset" and f.get("required") and f["id"] not in values:
                values[f["id"]] = asset_for(f)
            if f["type"] == "asset" and values.get(f["id"]) and not os.path.exists(os.path.join(game, values[f["id"]])):
                values[f["id"]] = asset_for(f)
        pairs = ["%s=%s" % (k, json.dumps(v)) for k, v in values.items() if v is not None]
        if pairs and p["kind"] == "behavior":
            iid = "snippet:%s:%s" % (owner.split(":")[-1], p["id"])
            sres = r2d("snippet", "set", game, iid, *pairs)
            check(sres["ok"], "%s: значения example проходят схему %s" % (p["id"], [d["message"] for d in sres["diagnostics"]]))
    # Пакеты «и узел, и проект» — ещё и на project: так проверяется якорь #__snippets.
    for p in pkgs:
        if "project" in p["targets"] and p["targets"] != ["project"]:
            res = r2d("snippet", "add", game, p["id"], "--owner", "project")
            check(res["ok"] or all(d["code"] in ("SNIP144", "SNIP062") for d in res["diagnostics"]),
                  "%s: на project — %s" % (p["id"], [d["message"] for d in res["diagnostics"]][:2]))

    # Обязательные ресурсы и у экземпляров-зависимостей (добавлены автоматически).
    fields = {p["id"]: p.get("fields", []) for p in pkgs}
    for inst in json.load(open(os.path.join(game, "project.json")))["editor"]["snippets"]["instances"]:
        miss = ["%s=%s" % (f["id"], json.dumps(asset_for(f)))
                for f in fields.get(inst["package"], []) if f["type"] == "asset" and f.get("required") and f["id"] not in inst.get("values", {})]
        if miss:
            r2d("snippet", "set", game, inst["id"], *miss)
    gen = r2d("snippet", "generate", game, "--write")
    check(gen["ok"], "generate всего каталога: %s" % [d["message"] for d in gen["diagnostics"]][:3])
    again = r2d("snippet", "generate", game, "--check")
    check(again["ok"], "повторная генерация детерминирована")
    lint = r2d("lint", game)
    check(lint["ok"], "lint authored/generated JS: %s" % lint.get("diagnostics", [])[:3])
    v = r2d("validate", game)
    bad = [(d["code"], d["message"]) for d in v["diagnostics"] if d["severity"] in ("error", "fatal")]
    check(not bad, "validate проекта: %s" % bad[:3])

    with Agent(game=game, seed=2) as a:
        a.step(5)
        a.hold(["D", "Space", "Left Shift", "J"])
        a.step(45)
        a.release_all()
        for key in ["K", "G", "M", "H", "E", "I", "Q", "1", "2", "R", "U"]:
            a.tap(key)
            a.step(3)
        for t in ["normal", "fire", "ice", "poison", "cut", "explosion"]:
            a.eval("$('thing, hero').damage(5, null, '%s'); 'ok'" % t)
            a.step(10)
        a.eval("$('thing').emit('status', { kind: 'slow', factor: 0.5, ms: 300 }); $('thing').emit('modifier', { stat: 'speed', add: 10, ms: 200 }); $.emit('noise', { x: 300, y: 600, radius: 500 }); 'ok'")
        a.step(60)
        errs = a.eval("$.debug.errors()") or []
        check(not errs, "~200 кадров с вводом и уроном без ошибок: %s" % [(e.get("message"), (e.get("source") or {}).get("file")) for e in errs[:3]])
        a.eval("$('thing, hero, ground').remove(); 'ok'")
        a.step(10)
        errs = a.eval("$.debug.errors()") or []
        check(not errs, "после удаления узлов ошибок нет")

    shutil.rmtree(tmp, ignore_errors=True)
    if FAILURES:
        print("FAILED: %d" % len(FAILURES))
        sys.exit(1)
    print("snippets_catalog_test: ok (%d пакетов)" % len(pkgs))


if __name__ == "__main__":
    main()
