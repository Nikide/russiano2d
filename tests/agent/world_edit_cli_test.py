#!/usr/bin/env python3
# ===========================================================================
# CLI-контракт native world-edit: r2d world-edit <map> --op ... --args ...
#
# Проверяет ровно то, чем пользуются GUI и агент: один JSON-объект в stdout,
# канонический файл при --out, data без --out, коды выхода 0/1/2 и отказ
# невалидной правки без изменения исходника. Python здесь только тестовая
# обвязка; backend — native-команды единого бинарника `r2d`.
#
# Запуск (после сборки): python3 tests/agent/world_edit_cli_test.py
# ===========================================================================

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SDK = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "r2d"))
FAILURES = []

BASE_MAP = {
    "version": 1,
    "name": "world-edit cli fixture",
    "regionSize": 128,
    "customRoot": {"keep": True},
    "world": {
        "x": 0, "y": 0, "w": 512, "h": 512,
        "bottom": 0, "top": 256,
        "floorColor": "#9a9a9a",
        "ceilingColor": "#6a7078",
        "sideColor": "#8f7a58",
        "boundary": "sky",
    },
    "brushes": [
        {"id": "box.a", "rect": [0, 0, 64, 64], "bottom": 0, "top": 64,
         "customBrush": 7},
        {"id": "poly.a", "polygon": [[100, 0], [200, 0], [200, 100], [100, 100]],
         "bottom": 0, "top": 64},
    ],
    "entities": [
        {"id": "player.start", "kind": "player_spawn", "x": 16, "y": 16, "h": 0},
    ],
}


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run(*args):
    proc = subprocess.run([SDK, *args], cwd=ROOT, capture_output=True, text=True,
                          timeout=120)
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    check(len(lines) == 1, f"{args[0] if args else 'sdk'}: одна строка JSON (строк: {len(lines)})")
    try:
        data = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        data = None
    check(isinstance(data, dict), "stdout — валидный JSON-объект")
    return proc.returncode, data or {}


def codes(data):
    return [d.get("code") for d in data.get("diagnostics", [])]


def write_map(directory, name, root):
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(root, handle, indent=2)
        handle.write("\n")
    return path


def find(obj, key, ident):
    for entry in obj.get(key, []):
        if entry.get("id") == ident:
            return entry
    return None


def main():
    check(os.path.isfile(SDK), f"единый бинарник r2d собран: {SDK}")
    if not os.path.isfile(SDK):
        return 1

    # --- usage --------------------------------------------------------------
    rc, d = run("world-edit")
    check(rc == 2 and not d.get("ok"), "нет аргументов: код 2, ok=false")
    check("SDK_WORLD_EDIT_USAGE" in codes(d), "нет аргументов: SDK_WORLD_EDIT_USAGE")
    for key in ("file", "op", "changed", "result", "errors", "warnings", "diagnostics"):
        check(key in d, f"ответ содержит {key}")

    rc, d = run("world-edit", "/nonexistent/map.re2dmap", "--op", "noop")
    check(rc == 1 and "SDK_WORLD_EDIT_FILE" in codes(d), "нет файла: код 1, SDK_WORLD_EDIT_FILE")

    with tempfile.TemporaryDirectory(prefix="r2d-world-edit-") as tmp:
        src = write_map(tmp, "in.re2dmap", BASE_MAP)
        out = os.path.join(tmp, "out.re2dmap")

        rc, d = run("world-edit", src, "--op", "no.such.op", "--args", "{}")
        check(rc == 2 and "SDK_WORLD_EDIT_OP" in codes(d), "неизвестная операция: код 2")

        rc, d = run("world-edit", src, "--op", "noop", "--args", "{")
        check(rc == 2 and "SDK_WORLD_EDIT_ARGS" in codes(d), "битый --args: код 2")

        # --- create + каноническая запись + перечитывание -------------------
        args = {"rect": [300, 300, 32, 32], "bottom": 0, "top": 64,
                "sideColor": "#101010"}
        rc, d = run("world-edit", src, "--op", "brush.create",
                    "--args", json.dumps(args), "--out", out)
        check(rc == 0 and d.get("ok") and d.get("changed") is True,
              "brush.create --out: код 0, changed=true")
        check(d.get("result", {}).get("ids") == ["brush_1"],
              "result.ids содержит новый id")
        check("data" not in d, "с --out ответ не содержит data")
        with open(out, encoding="utf-8") as handle:
            text = handle.read()
        reloaded = json.loads(text)
        check(text.startswith('{\n  "version": 1,'), "канонический отступ 2 пробела")
        check(text.endswith("\n"), "канонический файл завершается переводом строки")
        created = find(reloaded, "brushes", "brush_1")
        check(created is not None and created["rect"] == [300, 300, 32, 32],
              "созданная кисть перечитывается из файла")
        check(reloaded.get("customRoot") == {"keep": True},
              "неизвестный корневой ключ сохранён")
        check(find(reloaded, "brushes", "box.a").get("customBrush") == 7,
              "неизвестное поле кисти сохранено")

        # --- без --out: data и отсутствие записи ----------------------------
        before = open(src, encoding="utf-8").read()
        rc, d = run("world-edit", src, "--op", "brush.move",
                    "--args", '{"ids":["box.a"],"dx":5,"dy":6,"dz":0}')
        check(rc == 0 and d.get("ok"), "brush.move без --out: код 0")
        check("data" in d, "без --out ответ содержит data")
        moved = find(d.get("data", {}), "brushes", "box.a")
        check(moved is not None and moved["rect"] == [5, 6, 64, 64],
              "data содержит результат правки")
        check(open(src, encoding="utf-8").read() == before,
              "без --out исходный файл не изменён")

        # --- patch-алиас brush.set + id/ids-алиасы --------------------------
        rc, d = run("world-edit", src, "--op", "brush.set",
                    "--args", '{"id":"poly.a","patch":{"rect":[10,10,20,20]}}')
        check(rc == 0 and d.get("result", {}).get("ids") == ["poly.a"],
              "brush.set: id-алиас и patch приняты")
        patched = find(d.get("data", {}), "brushes", "poly.a")
        check(patched.get("rect") == [10, 10, 20, 20] and "polygon" not in patched,
              "brush.set patch: footprint заменён")

        # --- невалидная вершина отклонена, файл не тронут -------------------
        unchanged = open(src, encoding="utf-8").read()
        rejected_out = os.path.join(tmp, "rejected.re2dmap")
        rc, d = run("world-edit", src, "--op", "brush.vertex.move",
                    "--args", '{"id":"poly.a","vertex":0,"x":250,"y":50}',
                    "--out", rejected_out)
        check(rc == 1 and not d.get("ok"), "невыпуклая вершина: код 1, ok=false")
        check("SDK_WORLD_EDIT_GEOMETRY" in codes(d),
              "невыпуклая вершина: SDK_WORLD_EDIT_GEOMETRY")
        check(open(src, encoding="utf-8").read() == unchanged,
              "отклонённая правка не меняет исходник")
        check(not os.path.exists(rejected_out),
              "отклонённая правка не пишет --out")

        # --- result.id у create-операций (пишем рабочую копию) --------------
        work = write_map(tmp, "work.re2dmap", BASE_MAP)
        rc, d = run("world-edit", work, "--op", "entity.create",
                    "--args", '{"kind":"light","x":1,"y":2,"h":3,"id":"light.a"}',
                    "--out", work)
        check(rc == 0 and d.get("result", {}).get("id") == "light.a",
              "entity.create: result.id")
        rc, d = run("world-edit", work, "--op", "path.create",
                    "--args", '{"id":"p1","nodes":[{"x":1,"y":2}],"note":"n"}',
                    "--out", work)
        check(rc == 0 and d.get("result", {}).get("id") == "p1",
              "path.create: result.id")
        rc, d = run("world-edit", work, "--op", "path.node.add",
                    "--args", '{"id":"p1","x":3,"y":4,"index":1}',
                    "--out", work)
        check(rc == 0 and d.get("result", {}).get("index") == 1,
              "path.node.add: плоские x/y и index")
        rc, d = run("world-edit", work, "--op", "visgroup.ensure",
                    "--args", '{"name":"Detail","visible":false}',
                    "--out", work)
        check(rc == 0 and d.get("result", {}).get("id") == "Detail",
              "visgroup.ensure: result.id")
        rc, d = run("world-edit", work, "--op", "visgroup.state",
                    "--args", '{"id":"Detail","hidden":false}',
                    "--out", work)
        check(rc == 0, "visgroup.state: hidden применяется")

        # --- clip + duplicate ----------------------------------------------
        rc, d = run("world-edit", work, "--op", "brush.clip",
                    "--args", '{"id":"box.a","axis":"x","coordinate":32,"keep":"both"}',
                    "--out", work)
        check(rc == 0 and d.get("result", {}).get("ids") == ["box.a#a", "box.a#b"],
              "brush.clip both: result.ids")
        rc, d = run("world-edit", work, "--op", "brush.duplicate",
                    "--args", '{"ids":["box.a#a"],"dx":1,"dy":1}',
                    "--out", work)
        check(rc == 0 and d.get("result", {}).get("ids") == ["box.a#a-copy"],
              "brush.duplicate: id с суффиксом -copy")

    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
