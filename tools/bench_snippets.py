#!/usr/bin/env python3
"""Стенд замера сниппетов (ТЗ §16.5): цена generated JS на сотнях и тысячах узлов.

Три сценария на одном наборе узлов (N врагов + герой):
  * bare     — узлы без поведения;
  * snippets — на каждом враге ai.chase + health.base + health.regeneration
               (editor.snippets → r2d snippet generate, как из Editor);
  * manual   — та же логика вручную одним $.update по всем врагам.
Время — зона «JS: логика» профайлера ($.debug.profile), среднее по окну.

    python3 tools/bench_snippets.py [--ns 100,500,1000] [--frames 120] [--json out.json]
"""
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent  # noqa: E402

R2D = os.path.abspath(os.environ.get("R2D_BINARY") or os.path.join(ROOT, "build-xmake/macos-arm64/macosx/arm64/release/r2d"))
os.environ["R2D_BINARY"] = R2D
ZONE_LOGIC = "JS: логика"
PKGS = ["ai.chase", "health.base", "health.regeneration"]


def r2d(*args):
    out = subprocess.run([R2D, *args], cwd=ROOT, capture_output=True, text=True).stdout
    return json.loads([l for l in out.splitlines() if l.startswith("{")][-1])


def main_js(n, manual):
    lines = ["$.ready(() => {", "    $.world.gravity(0, 0);",
             "    $('<hero>', { id: 'hero' }).at(640, 360).size(16, 16).appendTo($.world);"]
    for i in range(n):
        lines.append("    $('<enemy>', { id: 'e%d', class: 'enemy' }).at(%d, %d).size(8, 8).appendTo($.world);" % (i, (i * 37) % 1200 + 40, (i * 53) % 640 + 40))
    lines.append("});")
    if manual:
        lines.append("""$.ready(() => { $('.enemy').health(100); });
$.update((dt) => {
    const hero = $('#hero');
    $('.enemy').each((i, e) => {
        if (e.distanceTo(hero) < 200) e.moveTowards(hero, 120);
        if (e.alive() && e.hp() < 100) e.heal(1);
    });
});""")
    return "\n".join(lines) + "\n"


def make(tmp, n, mode):
    game = os.path.join(tmp, "%s-%d" % (mode, n))
    os.makedirs(game)
    open(os.path.join(game, "main.js"), "w").write(main_js(n, mode == "manual"))
    json.dump({"schema_version": 2, "project": {"name": "bench", "version": "0.1.0"}, "runtime": {"entry": "main.js"}},
              open(os.path.join(game, "project.json"), "w"))
    if mode != "snippets":
        return game
    r2d("project-index", game, "--write")
    cat = {p["id"]: p for p in r2d("snippet", "catalog")["packages"]}
    pj = json.load(open(os.path.join(game, "project.json")))
    inst = []
    for i in range(n):
        for pid in PKGS:
            inst.append({"id": "snippet:e%d:%s" % (i, pid), "package": pid, "version": cat[pid]["version"], "owner": "object:e%d" % i,
                         "values": {"target": "#hero"} if pid == "ai.chase" else {}})
            if cat[pid]["slots"]:
                inst[-1]["slot"] = cat[pid]["slots"][0]["id"]
    pj["editor"]["snippets"] = {"format": 1, "instances": inst, "sets": [],
                                "catalog_lock": {pid: {"version": cat[pid]["version"], "manifest_hash": cat[pid]["manifest_hash"], "source": "builtin"} for pid in PKGS},
                                "generation": {"output": "generated/snippets", "entry": "generated/snippets/index.js"}}
    json.dump(pj, open(os.path.join(game, "project.json"), "w"), ensure_ascii=False)
    g = r2d("snippet", "generate", game, "--write")
    if not g["ok"]:
        raise SystemExit("generate: %s" % [d["message"] for d in g["diagnostics"]][:3])
    return game


def measure(game, warm, frames):
    with Agent(game=game, seed=1, start_timeout=120, timeout=240) as a:
        a.step(warm)
        a.cmd("eval", code="$.debug.profileReset()")
        a.step(frames)
        prof = a.eval("$.debug.profile()")
        errs = a.eval("$.debug.errors()") or []
        moved = a.eval("$('.enemy').nodes.filter((n) => Math.hypot(n.x - 640, n.y - 360) < 200).length")
    zones = {row["name"]: row["ms"] for row in prof["zones"]}
    return {"logic_ms": round(zones.get(ZONE_LOGIC, 0.0), 3), "frame_ms": round(prof["frame_ms"], 3), "errors": len(errs), "near_hero": moved}


def main():
    ns, frames, warm, out = [100, 500, 1000], 120, 40, None
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--ns": ns = [int(x) for x in args[i + 1].split(",")]
        if a == "--frames": frames = int(args[i + 1])
        if a == "--json": out = args[i + 1]
    tmp = tempfile.mkdtemp(prefix="r2d-bench-snip-")
    rows = []
    for n in ns:
        for mode in ("bare", "manual", "snippets"):
            r = measure(make(tmp, n, mode), warm, frames)
            r.update({"n": n, "mode": mode})
            rows.append(r)
            print("N=%5d %-8s логика %7.3f мс  кадр %7.3f мс  ошибок %d" % (n, mode, r["logic_ms"], r["frame_ms"], r["errors"]), flush=True)
    shutil.rmtree(tmp, ignore_errors=True)
    meta = {"machine": platform.platform(), "cpu": platform.processor() or platform.machine(), "binary": R2D,
            "frames": frames, "warm": warm, "build": "xmake release", "behaviors_per_enemy": PKGS}
    if out:
        json.dump({"meta": meta, "rows": rows}, open(out, "w"), ensure_ascii=False, indent=1)
    return rows


if __name__ == "__main__":
    main()
