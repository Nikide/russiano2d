#!/usr/bin/env python3
# ===========================================================================
# Паритет проверок студий данных: JS-модель (sdk/lib/kinds/*.js, rml_model.js)
# против нативного валидатора r2d-sdk (sdk/native/sdk_data.c).
#
# QuickJS в инструментах SDK запрещён, поэтому правила продублированы в C;
# этот тест держит копии согласованными: одни и те же правки базовых файлов
# должны давать одинаковые множества «severity:code» в обеих реализациях.
# Движок не нужен: только qjs и r2d-sdk.
#
# Запуск (после сборки): python3 tests/agent/sdk_data_parity_test.py
# ===========================================================================

import copy
import json
import os
import random
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SDK = os.environ.get("R2D_SDK_BINARY", os.path.join(ROOT, "build", "r2d-sdk"))
QJS = os.environ.get("R2D_QJS", os.path.join(ROOT, "build", "_deps", "quickjs-build", "qjs"))
WORK = os.path.join(ROOT, "build", "sdk_parity")
DRIVER = os.path.join(ROOT, "tests", "js", "sdk_parity_driver.mjs")
SUFFIX = {"tilemap": ".tilemap.json", "particles": ".particles.json", "collision": ".collision.json", "layers": ".layers.json",
          "fonts": ".fonts.json", "audio": ".audio.json", "input": ".input.json", "rml": ".rml", "rcss": ".rcss"}

BASES = {
    "tilemap": {"version": 1, "tile": 16, "src": "assets/tiles.png", "cols": 16, "solid": [1, 2], "autotile": {"mode": "bit16", "base": 1, "solid": [1]},
                "layers": [{"name": "ground", "depth": 0, "solid": True, "data": [[1, 0, 2], [0, 3, 0]]},
                           {"name": "deco", "depth": 10, "data": [[0, 4], [5, 0]]}]},
    "particles": {"version": 1, "name": "fire", "emitting": True, "amount": 32, "max_particles": 128, "rate": 40, "interval": 50, "lifetime": [400, 900],
                  "speed": [20, 70], "direction": -90, "spread": 26, "gravity": [0, -45], "angle": [0, 90], "angular_velocity": 10, "size": [12, 22],
                  "end_size": 2, "color": "#fff6c2", "end_color": "rgba(10,20,30,0.5)", "size_ramp": [{"t": 0, "size": 4}, {"t": 1, "size": 20}],
                  "color_ramp": [{"t": 0, "color": "#fff"}, {"t": 1, "color": "red"}], "alpha_ramp": [{"t": 0, "value": 1}, {"t": 1, "alpha": 0}],
                  "damping": 0.5, "src": "a.png", "local": True, "global": False, "one_shot": False, "burst": [10, 20], "emit_zone": {"shape": "rect", "w": 10},
                  "emit_zone_w": 5, "emit_zone_h": 6, "emit_zone_radius": 7, "seed": 7, "layer": 1, "depth": 2, "blend": "add",
                  "on_death": {"preset": "smoke", "amount": 2}, "extra_field": 1},
    "collision": {"version": 1, "shapes": [
        {"name": "floor", "tag": "wall", "shape": "box", "x": 400, "y": 560, "w": 800, "h": 40, "oneWay": True, "oneWayAngle": -1.57, "layerBits": 1, "mask": 3},
        {"name": "ball", "tag": "trigger", "shape": "circle", "x": 10, "y": 20, "radius": 12, "sensor": True},
        {"name": "cap", "tag": "area", "shape": "capsule", "x": 1, "y": 2, "radius": 5, "h": 20},
        {"name": "tri", "shape": "polygon", "x": 5, "y": 5, "points": [-30, 20, 30, 20, 0, -30]}]},
    "layers": {"version": 1, "modulate": {"color": "#0a1430", "alpha": 0.3}, "layers": [
        {"name": "far", "order": -30, "parallax": 0.2, "visible": True, "modulate": "#102030", "sprites": [{"src": "a.png", "x": 0, "y": 0, "w": 10, "h": 10}]},
        {"name": "near", "order": -10, "parallax": 0.6, "sprites": []}]},
    "fonts": {"version": 1, "fonts": [{"name": "sample", "path": "assets/Sample.ttf"}],
              "styles": {"default": {"size": 18, "color": "#e9edf6", "align": "left"}, "hud": {"size": 20, "color": "#fff", "lineHeight": 1.25, "font": "sample"},
                         "title": {"base": "hud", "size": 40, "color": "#ffb03a", "align": "center"}}},
    "audio": {"version": 1, "buses": {"music": {"volume": 0.6}, "sfx": {"volume": 1}, "ui": {"parent": "sfx", "volume": 0.5, "muted": False, "solo": False,
                                                                                               "effect": "echo", "effectParams": {"a": 1}}},
              "sounds": {"hit": {"path": "assets/hit.ogg", "bus": "ui", "volume": 0.8, "pitch": 1.2, "loop": False}},
              "zones": [{"name": "hall", "rect": [0, 0, 640, 640], "height": 6, "material": "concrete"}]},
    "input": {"version": 1, "deadzone": 0.2, "actions": {"jump": ["space", "w", "gamepad.a"], "left": ["a", "left"], "fire": ["mouse.left", "F5"], "mod": ["cmd", "Ctrl", "lshift", "F24", "F25", "f0", "f05", "щ"]}},
}

VALUES = [None, "__delete__", "x", "", -1, 0, 0.5, 3, 1e9, True, False, [], {}, [1], [0, 1], [3, 1], {"a": 1}, "#fff", "#zzz", "rgba(1,2,3)", "red",
          "alpha", "add", "left", "wall", "box", "polygon", [1, 2, 3, 4, 5, 6], [0, 0, 10, 0, 5, 5], [0, 0, 10, 0, 5, 5, 0, 5]]

RML = [
    '<rml><head><title>t</title></head><body><div id="a" class="b">x</div></body></rml>',
    '<rml><body><div></body></rml>', '<rml><body><div>', '<html></html>', '', '<rml><!-- x', '<rml></rml>',
    '<rml><body><input type="text" value="a>b"/><br/></body></rml>', '<rml><body></div></body></rml>', '<rml><body><p></body></p></rml>',
    '<?xml version="1.0"?><rml><body/></rml>', '<rml><head><link type="text/rcss" href="a.rcss"/></head><body><p>t</p></body></rml>',
    '<rml><body><a><b></a></b></body></rml>', '<rml><body><div a="1" b=\'2\' c=3>t</div></body>', '<rml><body>text only</body></rml>',
    '<!DOCTYPE rml><rml><body></body></rml>', '<rml><body><div <p></body></rml>', '<div>', '</rml>', '<rml><body></body></rml></rml>',
]
RCSS = [
    'a { color: red; }', 'a { color: red;', 'a { } }', 'a { } /* x', '/* c } */ b { x: "}"; }', '', '}', '{{', 'a { b: "unterminated\n }',
    'a { b { c: d; } }', "a { content: '}'; }", '@font-face { font-family: x; } p { }', '/* a */ /* b */ x { }', 'x { y: z; } } {',
]


def paths(node, prefix=()):
    yield prefix
    if isinstance(node, dict):
        for k in node:
            yield from paths(node[k], prefix + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from paths(v, prefix + (i,))


def mutate(base, path, value):
    doc = copy.deepcopy(base)
    if not path:
        return value if value != "__delete__" else None
    cur = doc
    for p in path[:-1]:
        cur = cur[p]
    if value == "__delete__":
        if isinstance(cur, dict):
            del cur[path[-1]]
        else:
            cur.pop(path[-1])
    else:
        cur[path[-1]] = value
    return doc


def main():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    rnd = random.Random(20261009)
    files = []   # (kind, path)
    n = 0

    def put(kind, text):
        nonlocal n
        n += 1
        d = os.path.join(WORK, kind)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "%04d%s" % (n, SUFFIX[kind]))
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        files.append((kind, p))

    for kind, base in BASES.items():
        put(kind, json.dumps(base))
        cases = [(p, v) for p in paths(base) for v in VALUES]
        rnd.shuffle(cases)
        for p, v in cases[:350]:
            put(kind, json.dumps(mutate(base, p, v)))
        put(kind, "[1,2]")
        put(kind, "3")
        put(kind, '"s"')
    for t in RML:
        put("rml", t)
    for t in RCSS:
        put("rcss", t)
    # Случайные «ломающие» правки текста разметки и стилей.
    for src_kind, texts in (("rml", RML[:3] + RML[7:8] + RML[11:12]), ("rcss", RCSS[:1] + RCSS[4:5] + RCSS[9:10])):
        for t in texts:
            for _ in range(25):
                if not t:
                    continue
                a = rnd.randrange(len(t))
                b = min(len(t), a + rnd.randrange(1, 6))
                put(src_kind, t[:a] + t[b:])
                junk = rnd.choice(["<", ">", "</", "/>", "{", "}", "/*", "*/", '"', "'", "<!--", "-->"])
                put(src_kind, t[:a] + junk + t[a:])

    listing = os.path.join(WORK, "list.txt")
    with open(listing, "w", encoding="utf-8") as f:
        f.write("\n".join(k + "\t" + p for k, p in files) + "\n")

    js = json.loads(subprocess.run([QJS, "-m", DRIVER, "--", listing], capture_output=True, text=True, timeout=300, check=True).stdout)

    fails = 0
    checked = 0
    for kind, path in files:
        r = subprocess.run([SDK, "validate", path], capture_output=True, text=True, timeout=30)
        try:
            out = json.loads(r.stdout.strip().splitlines()[-1])
        except Exception:
            print("  FAIL нет JSON от r2d-sdk для", path, r.stdout[:200], r.stderr[:200])
            fails += 1
            continue
        c_sig = sorted(d["severity"] + ":" + d["code"] for d in out["diagnostics"])
        j_sig = js[path]
        checked += 1
        if c_sig != j_sig:
            fails += 1
            if fails <= 15:
                print("  FAIL %s\n       JS %s\n       C  %s" % (os.path.relpath(path, ROOT), j_sig, c_sig))
                print("       " + open(path, encoding="utf-8").read()[:300].replace("\n", "\\n"))
    print(("  ok   " if not fails else "  FAIL ") + "паритет JS и C: проверено файлов %d, расхождений %d" % (checked, fails))
    base_ok = all(js[p] == [] or all(not s.startswith("error:") for s in js[p]) for k, p in files[:1])
    print("  ok   базовые документы проходят без ошибок" if base_ok else "  FAIL базовый документ с ошибками")
    if fails or not base_ok:
        print("ПРОВАЛОВ:", fails)
        sys.exit(1)
    print("Все проверки пройдены")


main()
