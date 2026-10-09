#!/usr/bin/env python3
# ===========================================================================
# Re2D Baker: импорт Wavefront OBJ (+ MTL) — docs/SDK.md §7.
#
#   OBJ → parse → тот же конвейер, что у GLB → PNG v2 + character.json
#
# OBJ — временный источник данных, как и GLB: результат не содержит меша, рантайм
# OBJ не читает. Движок не нужен (только r2d-sdk), настоящий рантайм проверяют
# sdk_baker_test.py (общий конвейер) и sdk_studios_test.py (Baker открывает *.obj).
#
# Запуск (после сборки): python3 tests/agent/sdk_obj_test.py
# ===========================================================================

import json
import os
import shutil
import struct
import subprocess
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import ROOT   # noqa: E402

FAILURES = []
SDK_BIN = os.environ.get("R2D_SDK_BINARY", os.path.join(ROOT, "build", "r2d-sdk"))
PROPS = os.path.join(ROOT, "tests", "fixtures", "sdk", "props")
OUT = os.path.join(ROOT, "build", "sdk_obj_out")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def cli(*args):
    p = subprocess.run([SDK_BIN, *args], cwd=ROOT, capture_output=True, text=True, timeout=300)
    try:
        return p.returncode, json.loads(p.stdout)
    except ValueError:
        lines = [l for l in p.stdout.splitlines() if l.strip()]
        return p.returncode, (json.loads(lines[-1]) if lines else {})


def codes(d):
    return [x["code"] for x in d.get("diagnostics", [])]


def png_colors(path):
    """Множество цветов RGB (без прозрачных отсчётов) PNG v2: достаточно проверить, что цвета текстуры попали в атлас."""
    data = open(path, "rb").read()
    pos, idat, w, h, ct = 8, b"", 0, 0, 0
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        t, c = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if t == b"IHDR":
            w, h, _, ct = struct.unpack(">IIBB", c[:10])
        elif t == b"IDAT":
            idat += c
    raw = zlib.decompress(idat)
    bpp = 4 if ct == 6 else 3
    stride, prev, i, colors = w * bpp, bytearray(w * bpp), 0, set()
    for y in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        if y < 768:   # материальные карты — верхняя часть листа; нижние 256 строк — служебные карты v2
            for x in range(0, w, 3):
                px = line[x * bpp:x * bpp + bpp]
                if bpp == 4 and px[3] == 0:
                    continue
                colors.add((px[0] // 40, px[1] // 40, px[2] // 40))
        prev = line
    return colors


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)

    rc, r = cli("bake-re2d", os.path.join(PROPS, "cube.obj"), "--type", "prop", "--output", os.path.join(OUT, "cube"))
    check(rc == 0 and r.get("ok") and r.get("success"), "куб из OBJ запекается: ok (%s)" % codes(r))
    check(r["source"]["kind"] == "obj" and r["source"]["triangles"] == 12 and r["source"]["textures"] == 1 and r["source"]["materials"] == 1,
          "OBJ: 12 треугольников (6 квадов веером), 1 текстура из MTL (%s)" % r["source"])
    png = os.path.join(OUT, "cube", "cube.png")
    check(os.path.isfile(png) and os.path.isfile(os.path.join(OUT, "cube", "cube.character.json")), "результат — обычный PNG v2 и character.json")
    check(r["atlasUsage"] > 0.05 and r["parts"] >= 1, "в атласе есть покрытие (%.3f) и части (%d)" % (r["atlasUsage"], r["parts"]))
    colors = png_colors(png)
    reddish = any(c[0] >= 5 and c[2] <= 1 for c in colors)
    bluish = any(c[2] >= 5 and c[0] <= 1 for c in colors)
    check(reddish and bluish, "обе половины текстуры (красная и синяя) попали в карту материала: V не потерян (%d цветов)" % len(colors))
    rc2, v = cli("validate", os.path.join(OUT, "cube", "cube.character.json"))
    check(rc2 == 0 and v["errors"] == 0, "r2d-sdk validate: описание модели без ошибок")
    rc3, again = cli("bake-re2d", os.path.join(PROPS, "cube.obj"), "--type", "prop", "--output", os.path.join(OUT, "cube2"))
    same = open(png, "rb").read() == open(os.path.join(OUT, "cube2", "cube.png"), "rb").read()
    check(rc3 == 0 and same, "результат детерминирован: два запуска дают один и тот же PNG")

    rc, r = cli("bake-re2d", os.path.join(PROPS, "quad_neg.obj"), "--type", "prop", "--output", os.path.join(OUT, "quad"))
    check(rc == 0 and r["source"]["triangles"] == 2, "отрицательные индексы и четырёхугольник: 2 треугольника (%s)" % r.get("source"))

    rc, r = cli("bake-re2d", os.path.join(PROPS, "no_mtl.obj"), "--type", "prop", "--output", os.path.join(OUT, "nomtl"))
    check(rc == 0 and "SDK_BAKE_MTL_MISSING" in codes(r), "нет MTL: предупреждение SDK_BAKE_MTL_MISSING, bake проходит")

    rc, r = cli("bake-re2d", os.path.join(PROPS, "bad_index.obj"), "--type", "prop", "--output", os.path.join(OUT, "bad1"))
    d = [x for x in r["diagnostics"] if x["code"] == "SDK_BAKE_INDEX_RANGE"]
    check(rc != 0 and d and d[0]["location"] == {"line": 5}, "индекс вне вершин: SDK_BAKE_INDEX_RANGE со строкой 5 (пустая строка учтена)")
    rc, r = cli("bake-re2d", os.path.join(PROPS, "bad_empty.obj"), "--type", "prop", "--output", os.path.join(OUT, "bad2"))
    check(rc != 0 and "SDK_BAKE_NO_MESH" in codes(r), "нет граней: SDK_BAKE_NO_MESH")
    rc, r = cli("bake-re2d", os.path.join(PROPS, "bad_syntax.obj"), "--type", "prop", "--output", os.path.join(OUT, "bad3"))
    check(rc != 0 and "SDK_BAKE_OBJ_SYNTAX" in codes(r), "нечисловая вершина: SDK_BAKE_OBJ_SYNTAX")
    rc, r = cli("bake-re2d", os.path.join(PROPS, "cube.obj"), "--type", "character", "--output", os.path.join(OUT, "bad4"))
    check(rc != 0 and any(c.startswith("SDK_BAKE_CHARACTER") or c == "SDK_BAKE_HUMANOID_INCOMPLETE" for c in codes(r)), "OBJ как character: отказ (нет humanoid)")
    rc, r = cli("bake-re2d", os.path.join(PROPS, "cube.obj"), "--type", "prop", "--expression", "happy", "--output", os.path.join(OUT, "expr"))
    check(rc == 0 and "SDK_BAKE_EXPRESSION_UNSUPPORTED" in codes(r), "--expression у OBJ игнорируется с предупреждением")

    # Batch: тот же бейкер, ошибка одного задания не прерывает пакет.
    manifest = os.path.join(OUT, "obj.batch.json")
    json.dump({"version": 1, "jobs": [
        {"op": "bake-re2d", "source": os.path.join(PROPS, "cube.obj"), "type": "prop", "output": os.path.join(OUT, "b_cube")},
        {"op": "bake-re2d", "source": os.path.join(PROPS, "bad_index.obj"), "type": "prop", "output": os.path.join(OUT, "b_bad")},
        {"op": "bake-re2d", "source": os.path.join(PROPS, "quad_neg.obj"), "type": "prop", "output": os.path.join(OUT, "b_quad")},
    ]}, open(manifest, "w"))
    rc, r = cli("batch", manifest)
    check(rc == 1 and r["total"] == 3 and r["succeeded"] == 2 and r["failed"] == 1, "batch: 3 задания, 2 успешных, 1 ошибка (%s)" % {k: r.get(k) for k in ("total", "succeeded", "failed")})

    # Реестр: Baker открывает *.obj, Asset Browser связывает файл с инструментом.
    rc, reg = cli("assets", PROPS, "--registry", os.path.join(ROOT, "sdk_tools.json"))
    tools = {e["path"]: e["tool"] for e in reg["entries"]}
    check(tools.get("cube.obj") == "re2d-baker" and tools.get("quad_neg.obj") == "re2d-baker", "Asset Browser: *.obj открывается в Re2D Baker")

    if FAILURES:
        print("\nПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


main()
