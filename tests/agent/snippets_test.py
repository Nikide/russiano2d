#!/usr/bin/env python3
# ===========================================================================
# Система сниппетов, сквозной путь (docs/SNIPPETS.md): каталог → add/set →
# generate → validate → настоящий runtime.
#
# Работает на копии tests/fixtures/snippets_basic во временном каталоге:
#   * catalog --strict: встроенные пакеты проходят manifest/API/зависимости;
#   * add/set: неверное значение не пишется (SNIP026), верное — пишется;
#   * generate --write детерминирован: повтор даёт "same", --check — ok;
#   * ручная правка generated → SNIP120, файл не перезаписан;
#   * validate проекта чист; kit раскрывается в состав + набор;
#   * runtime: поведение movement.top-down двигает #hero, sprite назначен.
# Запуск: python3 tests/agent/snippets_test.py
# ===========================================================================
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent   # noqa: E402

R2D = os.path.abspath(os.environ.get("R2D_BINARY") or os.path.join(ROOT, "build-xmake/macos-arm64/macosx/arm64/release/r2d"))
os.environ["R2D_BINARY"] = R2D   # агент запускает тот же бинарник
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def r2d(*args):
    out = subprocess.run([R2D, *args], cwd=ROOT, capture_output=True, text=True).stdout
    line = [l for l in out.splitlines() if l.startswith("{")][-1]
    return json.loads(line)


def codes(res):
    return [d["code"] for d in res.get("diagnostics", [])]


def main():
    tmp = tempfile.mkdtemp(prefix="r2d-snippets-")
    game = os.path.join(tmp, "game")
    shutil.copytree(os.path.join(ROOT, "tests/fixtures/snippets_basic"), game,
                    ignore=shutil.ignore_patterns("generated", "project.json.bak"))
    # Чистый старт: без editor.snippets и без подключения в main.js.
    pj = json.load(open(os.path.join(game, "project.json")))
    pj.get("editor", {}).pop("snippets", None)
    json.dump(pj, open(os.path.join(game, "project.json"), "w"), ensure_ascii=False, indent=2)
    main_js = os.path.join(game, "main.js")
    text = "".join(l for l in open(main_js) if "r2d:snippets" not in l)
    open(main_js, "w").write(text)
    r2d("project-index", game, "--write")

    cat = r2d("snippet", "catalog", "--strict")
    check(cat["ok"] and cat["total"] >= 9, "каталог проходит --strict (%d пакетов)" % cat["total"])
    q = r2d("snippet", "catalog", "--query", "прыж")
    ids = [p["id"] for p in q["packages"]]
    check("movement.platformer" in ids and "movement.top-down" not in ids, "русский поиск: %s" % ids)

    check(r2d("snippet", "add", game, "movement.top-down", "--owner", "object:hero")["ok"], "add movement.top-down")
    check("SNIP060" in codes(r2d("snippet", "add", game, "ai.waypoint-patrol", "--owner", "object:nobody")), "неизвестный owner — SNIP060")
    check(r2d("snippet", "add", game, "actor.visual-profile", "--owner", "object:hero")["ok"], "add actor.visual-profile")
    gen = r2d("snippet", "generate", game)
    check("SNIP027" in codes(gen) and not gen["ok"], "обязательный ресурс не задан — SNIP027 блокирует генерацию")
    bad = r2d("snippet", "set", game, "snippet:hero:movement.top-down", "speed=5000")
    check(not bad["written"] and "SNIP026" in codes(bad), "speed=5000 не записан (SNIP026)")
    check("SNIP041" in codes(r2d("snippet", "set", game, "snippet:hero:actor.visual-profile", 'image="art/none.png"')),
          "отсутствующий ресурс — SNIP041")
    check(r2d("snippet", "set", game, "snippet:hero:actor.visual-profile", 'image="art/hero.png"')["written"], "set image")
    check(r2d("snippet", "set", game, "snippet:hero:movement.top-down", "speed=240")["written"], "set speed=240")
    check("SNIP062" in codes(r2d("snippet", "add", game, "movement.platformer", "--owner", "object:hero", "--dry-run")),
          "второй movement на том же owner — SNIP062")

    w = r2d("snippet", "generate", game, "--write")
    check(w["ok"] and w["written"], "generate --write: %s" % codes(w))
    first = open(os.path.join(game, "generated/snippets/index.js")).read()
    again = r2d("snippet", "generate", game, "--check")
    check(again["ok"] and all(f["status"] == "same" for f in again["files"]), "повтор детерминирован (--check)")
    check(open(main_js).read().count("r2d:snippets") == 1, "подключение в main.js ровно одно")
    r2d("snippet", "generate", game, "--write")
    check(open(os.path.join(game, "generated/snippets/index.js")).read() == first, "побайтно тот же index.js")
    check("engine." not in first, "generated не обращается к engine.*")

    v = r2d("validate", game)
    errs = [d for d in v["diagnostics"] if d["severity"] in ("error", "fatal", "warning")]
    check(v["ok"] and not errs, "validate проекта чист: %s" % [(d["code"], d["message"]) for d in errs])

    pkg = os.path.join(game, "generated/snippets/packages/movement.top-down.js")
    open(pkg, "a").write("// ручная правка\n")
    c = r2d("snippet", "generate", game, "--write")
    check(not c["ok"] and "SNIP120" in codes(c), "ручная правка — SNIP120")
    check(open(pkg).read().endswith("// ручная правка\n"), "ручная правка не перезаписана")
    shutil.copy(os.path.join(ROOT, "snippets/movement.top-down/src/behavior.js"), pkg)
    r2d("snippet", "generate", game, "--write", "--overwrite")
    for f in os.listdir(os.path.dirname(pkg)):
        if f.endswith(".r2d-user"):
            os.remove(os.path.join(os.path.dirname(pkg), f))

    with Agent(game=game, seed=1) as a:
        a.step(5)
        x0 = a.eval("$('#hero').pos().x")
        a.hold(["D"])
        a.step(30)
        a.release_all()
        x1 = a.eval("$('#hero').pos().x")
        check(x1 - x0 > 50, "runtime: D двигает #hero (%.1f → %.1f)" % (x0, x1))
        check(a.eval("$('#hero').attr('src') || $('#hero').get(0).attrs.src") == "art/hero.png",
              "runtime: спрайт назначен из editor.snippets")
        errors = a.eval("$.debug.errors()") or []
        check(not errors, "runtime без ошибок: %s" % errors[:2])

    # Kit раскрывается: удаляем движение и ставим набор игрока на того же героя.
    r2d("snippet", "remove", game, "snippet:hero:movement.top-down")
    k = r2d("snippet", "add", game, "kit.platformer-core", "--owner", "object:hero")
    check(k["ok"] and len(k["added"]) == 3, "kit раскрыт: %s" % k.get("added"))
    sec = json.load(open(os.path.join(game, "project.json")))["editor"]["snippets"]
    check(any(s["id"] == "set:hero:kit.platformer-core" for s in sec["sets"]), "набор kit записан")
    rm = r2d("snippet", "remove", game, "set:hero:kit.platformer-core")
    check(rm["ok"] and len(rm["removed"]) == 3, "удаление набора убирает состав: %s" % rm.get("removed"))
    sec = json.load(open(os.path.join(game, "project.json")))["editor"]["snippets"]
    check(sorted(sec["catalog_lock"]) == ["actor.visual-profile"], "catalog_lock — только используемые: %s" % sorted(sec["catalog_lock"]))

    shutil.rmtree(tmp, ignore_errors=True)
    if FAILURES:
        print("FAILED: %d" % len(FAILURES))
        sys.exit(1)
    print("snippets_test: ok")


if __name__ == "__main__":
    main()
