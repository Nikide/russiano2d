#!/usr/bin/env python3
"""r2d sfx-gen: текстовые описания, пресеты, ошибки и рецепты из docs/skills/generate-sound.md дают звук в заявленных границах."""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = os.environ.get("R2D_BINARY") or str(ROOT / "build-xmake/macos-arm64/macosx/arm64/release/r2d")
TMP = Path(tempfile.mkdtemp(prefix="r2d-sfx-"))
failures = 0


def check(ok, label):
    global failures
    print(("  ok   " if ok else "  FAIL ") + label, flush=True)
    failures += 0 if ok else 1


def run(spec, name="s"):
    path = TMP / (name + ".json")
    path.write_text(json.dumps(spec), encoding="utf-8")
    out = subprocess.run([BINARY, "sfx-gen", str(path)], capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout)


text = (ROOT / "docs/skills/generate-sound.md").read_text(encoding="utf-8")
recipes = [json.loads(b) for b in re.findall(r"```json\n(.*?)\n```", text, re.S)]
check(len(recipes) >= 8, "в навыке не меньше 8 рецептов (%d)" % len(recipes))
for rec in recipes:
    out = TMP / (rec["name"] + ".wav")
    r = run({"params": rec["params"], "out": str(out)}, rec["name"])
    lo, hi = rec["seconds"]
    check(r.get("ok") and lo <= r["seconds"] <= hi, "рецепт %s: %.3f с в [%s, %s]" % (rec["name"], r.get("seconds", -1), lo, hi))
    check(r.get("ok") and r["clipped"] == 0 and 0.1 < r["peak"] < 0.99, "рецепт %s: без среза, пик %.2f" % (rec["name"], r.get("peak", -1)))
    check(out.is_file() and out.read_bytes()[:4] == b"RIFF", "рецепт %s: WAV записан" % rec["name"])

for words, preset in (("монета", "coin"), ("Выстрел из лазера", "laser"), ("огромный взрыв", "explosion"), ("jump", "jump"),
                      ("получил урон", "hurt"), ("бонус", "powerup"), ("клик по кнопке", "blip")):
    r = run({"text": words, "seed": 3})
    check(r.get("ok") and r["preset"] == preset, "«%s» → %s" % (words, preset))

a = run({"preset": "coin", "seed": 1}); b = run({"preset": "coin", "seed": 2}); c = run({"preset": "coin", "seed": 1})
check(a["params"] == c["params"] and a["params"] != b["params"], "seed меняет дескриптор, повтор — тот же")
check(run({"preset": "coin", "mutate": 0.3, "seed": 4})["params"] != run({"preset": "coin", "seed": 4})["params"], "mutate меняет звук")

nested = TMP / "a" / "b" / "n.wav"
check(run({"preset": "blip", "out": str(nested)}).get("ok") and nested.is_file(), "out: недостающие каталоги создаются")

rfx = TMP / "x.rfx"
r1 = run({"preset": "explosion", "seed": 8, "rfx": str(rfx)})
r2 = run({"from": str(rfx)})
check(rfx.is_file() and rfx.stat().st_size == 104 and r2.get("ok") and abs(r2["seconds"] - r1["seconds"]) < 0.001, ".rfx: запись и чтение, 104 байта")

for spec, frag in (({"text": "абракадабра"}, "не понял"), ({"preset": "нету"}, "нет «нету»"), ({"preset": "coin", "params": {"freqq": 1}}, "нет такого поля"),
                   ({"preset": "coin", "params": {"wave": "tri"}}, "wave"), ({}, "нужен"), ({"from": "/nonexistent.rfx"}, "rfx")):
    r = run(spec)
    check(r.get("ok") is False and frag in r.get("message", ""), "ошибка: %s" % frag)

print("sfxgen_skill_test: все проверки пройдены" if not failures else "ПРОВАЛЕНО: %d" % failures)
sys.exit(1 if failures else 0)
