#!/usr/bin/env python3
"""Бенчмарк агента Editor: задачи с автоматической проверкой результата на живой модели.

    R2D_BINARY=… AG_KEY=<ключ> python3 tools/agent_bench.py --provider opencode --model minimax-m3.1-flash-free
        [--tasks file,sound,sprite,code] [--timeout 240] [--json out.json]

Каждая задача идёт в копии пустого проекта (templates/blank или demos/gigachat-platformer): панель «Агент»,
подтверждения принимаются автоматически. Успех — по артефакту на диске, а не по словам модели.
Ключ берётся только из окружения и никуда не пишется.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests/agent"))
from agent_client import Agent  # noqa: E402
from editor_hammer_test import settle  # noqa: E402

E = "$.editorApp"
D = '$.ui.doc("ui/editor.rml")'
BINARY = os.environ.get("R2D_BINARY", "")


def r2d(*args, cwd=None):
    return subprocess.run([BINARY, *args], capture_output=True, text=True, cwd=cwd or ROOT, timeout=120)


def check_file(p):
    f = p / "notes.txt"
    return f.is_file() and "привет" in f.read_text(encoding="utf-8").lower(), "notes.txt с текстом «привет»"


def check_sound(p):
    ws = list(p.rglob("*.wav"))
    return any(w.read_bytes()[:4] == b"RIFF" and w.stat().st_size > 1000 for w in ws), "WAV-файл в проекте"


def check_sprite(p):
    ps = [x for x in p.rglob("*.png") if ".r2d-check" not in str(x)]
    return any(x.read_bytes()[:4] == b"\x89PNG" for x in ps), "PNG-спрайт в проекте"


def check_code(p):
    js = (p / "main.js").read_text(encoding="utf-8")
    lint = r2d("lint", str(p / "main.js"), "--json")
    try:
        ok_lint = json.loads(lint.stdout).get("ok", lint.returncode == 0)
    except ValueError:
        ok_lint = lint.returncode == 0
    control = "controls" in js or "$.input" in js or "snippet" in js
    return bool(ok_lint and len(js) > 300 and control), f"main.js {len(js)} симв., lint {'ок' if ok_lint else 'ошибки'}, управление {'есть' if control else 'нет'}"


TASKS = {
    "file": ("Создай файл notes.txt с текстом «привет от агента», затем прочитай его и ответь одним предложением, что в нём.", check_file),
    "sound": ("Сгенерируй звук прыжка и сохрани его в assets/sfx/jump.wav.", check_sound),
    "sprite": ("Нарисуй пиксельный спрайт монеты 16x16 и сохрани в assets/coin.png.", check_sprite),
    "code": ("Сделай в main.js простой платформер: герой двигается стрелками и прыгает, есть пол и две платформы, счёт на экране. Проверь lint.", check_code),
}


def run_task(name, args):
    prompt, check = TASKS[name]
    tmp = Path(tempfile.mkdtemp(prefix="r2d-bench-")) / "p"
    shutil.copytree(ROOT / "demos/gigachat-platformer", tmp)
    t0 = time.time()
    usage = {}
    tools = 0
    err = ""
    with Agent(game="editor", scene=str(tmp), seed=1) as a:
        settle(a, E + ".state.project!==null && " + E + ".state.busy===0")
        a.eval(E + f'.models.set({json.dumps(args.provider)},{{key:{json.dumps(os.environ["AG_KEY"])}' + (f',model:{json.dumps(args.model)}' if args.model else '') + '});'
               + E + f'.models.activate({json.dumps(args.provider)});' + E + f'.models.setBehavior({{maxSteps:{args.steps}}});'
               + D + '.click("bt-agent");' + D + f'.setValue("ag-input",{json.dumps(prompt)});' + D + '.click("ag-send");1')
        while time.time() - t0 < args.timeout:
            time.sleep(1)
            a.step(2)
            if a.eval(E + ".agent.state.pending!==null"):
                a.eval(D + '.click("ag-yes");1')
            if not a.eval(E + ".agent.state.busy") and time.time() - t0 > 5:
                break
        else:
            err = "таймаут"
        usage = a.eval("JSON.stringify(" + E + ".agent.state.usage)")
        tools = a.eval(E + ".agent.state.log.filter((e)=>e.kind==='tool').length")
        errs = a.eval(E + ".agent.state.log.filter((e)=>e.kind==='tool'&&e.status==='err').length")
        last_err = a.eval("(()=>{const e=" + E + ".agent.state.log.filter((x)=>x.kind==='err').pop();return e?e.text:''})()")
    ok, what = check(tmp)
    return {"task": name, "ok": bool(ok), "check": what, "seconds": round(time.time() - t0, 1), "tool_calls": tools,
            "tool_errors": errs, "detail": what, "usage": json.loads(usage) if usage else {}, "error": err or last_err}


def main():
    prefs = Path('agent.local.json')   # бенчмарк меняет настройки агента в корне запуска — возвращаем как были
    saved = prefs.read_bytes() if prefs.exists() else None
    try:
        _main()
    finally:
        if saved is None: prefs.unlink(missing_ok=True)
        else: prefs.write_bytes(saved)


def _main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", required=True)
    ap.add_argument("--model", default="")
    ap.add_argument("--tasks", default=",".join(TASKS))
    ap.add_argument("--timeout", type=int, default=240)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--json", default="")
    args = ap.parse_args()
    if not BINARY or not os.environ.get("AG_KEY"):
        raise SystemExit("нужны R2D_BINARY и AG_KEY")
    rows = []
    for name in args.tasks.split(","):
        r = run_task(name, args)
        rows.append(r)
        print(("ok   " if r["ok"] else "FAIL ") + f'{name:7} {r["seconds"]:6}s вызовов {r["tool_calls"]} (ошибок {r["tool_errors"]}) токенов {r["usage"].get("input", 0)}+{r["usage"].get("output", 0)} {r["error"][:60]} [{r["detail"]}]', flush=True)
    done = sum(r["ok"] for r in rows)
    print(f"итого: {done}/{len(rows)} · {args.provider} {args.model}")
    if args.json:
        Path(args.json).write_text(json.dumps({"provider": args.provider, "model": args.model, "results": rows}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
