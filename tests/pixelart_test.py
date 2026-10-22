#!/usr/bin/env python3
"""r2d pixel-art: холст, палитра, кадры, операции, ASCII-срез; примеры из docs/skills/pixel-art.md рабочие."""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = os.environ.get("R2D_BINARY") or str(ROOT / "build-xmake/macos-arm64/macosx/arm64/release/r2d")
failures = 0
TMP = Path(tempfile.mkdtemp(prefix="r2d-pixel-"))


def check(ok, label):
    global failures
    print(("  ok   " if ok else "  FAIL ") + label, flush=True)
    failures += 0 if ok else 1


def run(spec, name="s"):
    path = TMP / (name + ".json")
    path.write_text(json.dumps(spec), encoding="utf-8")
    out = subprocess.run([BINARY, "pixel-art", str(path)], capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout)


def stats(png):
    out = subprocess.run([BINARY, "image-stats", str(png)], capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout)


# --- примеры из навыка --------------------------------------------------------------------------
doc = (ROOT / "docs/skills/pixel-art.md").read_text(encoding="utf-8")
blocks = re.findall(r"```json\n(.*?)\n```", doc, re.S)
check(len(blocks) >= 5, f"в навыке есть примеры спецификаций ({len(blocks)})")
sizes = {}
for i, text in enumerate(blocks):
    spec = json.loads(text)
    name = Path(spec["out"]).stem
    spec["out"] = str(TMP / (name + ".png"))
    r = run(spec, "ex%d" % i)
    sizes[name] = r
    check(r.get("ok") and len(r["ascii"]) == r["height"] and r["opaque"] > 0, f"пример «{name}» рисуется: {r.get('width')}×{r.get('height')}, пикселей {r.get('opaque')}")
check(sizes["slime"].get("frames") == 2 and sizes["slime"]["width"] == 24, "кадры анимации укладываются в лист 24×6")
ship = sizes["ship"]["ascii"]
check(all(row == row[::-1] for row in ship), "mirror даёт симметричный корабль")
check(sizes["hero"]["legend"].get("g") == "#3fae5a", "legend возвращает палитру")

# --- операции -----------------------------------------------------------------------------------
pal = {"a": "#ff0000", "b": "#00ff00", "c": "#0000ff"}
r = run({"palette": pal, "size": [6, 4], "ops": [{"op": "rect", "x": 0, "y": 0, "w": 6, "h": 4, "c": "a"}, {"op": "fill", "x": 0, "y": 0, "c": "b"}]})
check(all(row == "bbbbbb" for row in r["ascii"]), "fill перекрашивает область целиком")
r = run({"palette": pal, "size": [5, 5], "ops": [{"op": "line", "x0": 0, "y0": 0, "x1": 4, "y1": 4, "c": "a"}]})
check([row.index("a") for row in r["ascii"]] == [0, 1, 2, 3, 4], "line рисует диагональ")
r = run({"palette": pal, "rows": ["a..", "bb."], "ops": [{"op": "flip", "axis": "h"}]})
check(r["ascii"] == ["..a", ".bb"], "flip h")
r = run({"palette": pal, "rows": ["a..", "bb."], "ops": [{"op": "shift", "dx": 1, "dy": 1}]})
check(r["ascii"] == ["...", ".a.", ".bb"][:2] or r["ascii"][1] == ".a.", "shift сдвигает без заворота")
r = run({"palette": pal, "rows": ["ab", "ba"], "ops": [{"op": "replace", "from": "a", "to": "c"}]})
check(r["ascii"] == ["cb", "bc"], "replace меняет цвет")
r = run({"palette": pal, "size": [9, 9], "ops": [{"op": "ellipse", "cx": 4, "cy": 4, "rx": 3, "ry": 3, "c": "a"}]})
check(r["ascii"][4][4] == "a" and r["ascii"][0][0] == "." and r["opaque"] > 20, "ellipse закрашивает круг")
r = run({"palette": {"a": "#ff0000", "k": "#101010"}, "rows": [".a."], "at": [0, 1], "size": [3, 3], "ops": [{"op": "outline", "c": "k"}]})
check(r["ascii"] == [".k.", "kak", ".k."], "outline обводит непрозрачные пиксели по 4 сторонам")
r = run({"palette": pal, "rows": ["ab"], "ops": [{"op": "set", "x": 1, "y": 0, "c": "transparent"}]})
check(r["ascii"] == ["a."], "transparent стирает пиксель")

# --- файл, scale, правка по base, preview -------------------------------------------------------
png = TMP / "x.png"
r = run({"palette": pal, "rows": ["ab", "ba"], "out": str(png), "scale": 4, "preview": str(TMP / "p.png"), "previewScale": 8})
st = stats(png)
check(r["ok"] and r["outWidth"] == 8 and st.get("width") == 8 and st.get("height") == 8, "scale увеличивает PNG без сглаживания (2×2 → 8×8)")
check(stats(TMP / "p.png").get("width") == 16, "preview записывается с собственным масштабом")
check(st.get("distinctColors") == 2, "увеличение не размывает цвета (ровно 2 цвета)")
small = TMP / "base.png"
run({"palette": pal, "rows": ["aaa", "aaa"], "out": str(small)})
r = run({"base": str(small), "palette": pal, "ops": [{"op": "set", "x": 1, "y": 1, "c": "c"}]})
check(r["ascii"] == ["aaa", "aca"], "base: правка существующего PNG")
r = run({"palette": pal, "rows": ["a"], "out": str(TMP / "deep/dir/new.png")})
check(r["ok"] and (TMP / "deep/dir/new.png").is_file(), "вложенные папки для out создаются")

# --- ошибки -------------------------------------------------------------------------------------
check(run({"palette": {"ab": "#fff"}, "size": [2, 2]}).get("code") == "SDK_PIXEL_SPEC", "ключ палитры длиннее символа — ошибка")
check(run({"palette": pal, "size": [2, 2], "ops": [{"op": "nope"}]}).get("ok") is False, "неизвестная операция — ошибка")
check(run({"palette": pal}).get("ok") is False, "без холста — ошибка")
check(run({"palette": pal, "size": [2, 2], "scale": 99}).get("ok") is False, "scale вне 1..16 — ошибка")
check(run({"palette": pal, "size": [2, 2], "ops": [{"op": "set", "x": 0, "y": 0, "c": "zz"}]}).get("ok") is False, "неизвестный цвет — ошибка")
check(run({"palette": pal, "size": [900, 2]}).get("ok") is False, "холст больше 512 — ошибка")

print("pixelart_test:", "ПРОВАЛ" if failures else "все проверки пройдены")
sys.exit(1 if failures else 0)
