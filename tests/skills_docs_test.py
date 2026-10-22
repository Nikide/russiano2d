#!/usr/bin/env python3
"""Навыки агента (docs/skills/*.md): каждый кирпичик и `$`-путь, на который они ссылаются, существует."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = sorted((ROOT / "docs" / "skills").glob("*.md"))
failures = 0


def check(ok, label):
    global failures
    print(("  ok   " if ok else "  FAIL ") + label, flush=True)
    failures += 0 if ok else 1


snippets = {p.name for p in (ROOT / "snippets").iterdir() if p.is_dir()}
families = {s.split(".")[0] for s in snippets}
api = {n["path"] for n in json.loads((ROOT / "api.schema.json").read_text(encoding="utf-8"))["names"]}

check(len(SKILLS) >= 10, "навыков не меньше 10 (%d)" % len(SKILLS))
for md in SKILLS:
    text = md.read_text(encoding="utf-8")
    check(text.startswith("# Навык:"), md.name + ": заголовок «# Навык: …»")
    bad_snip, bad_api = [], []
    for code in re.findall(r"`([^`\n]+)`", text):
        bare = re.sub(r"[\w$.]*\$\.[\w.]+|\.[a-z]\w*\(|<[\w.]+>", " ", code)    # `$`-пути и вызовы методов — не кирпичики
        for tok in re.findall(r"\b([a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9-]+)+)\b(?!-?\*)", bare):
            if tok.split(".")[0] in families and not tok.endswith((".js", ".json", ".md", ".png", ".rml", ".rcss", ".ogg", ".wav", ".mp3")):
                head = tok.rstrip(".")
                if head not in snippets and not any(s.startswith(head.rstrip("*")) for s in snippets if head.endswith("*")):
                    bad_snip.append(tok)
        for path in re.findall(r"(\$\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)", code):
            if path not in api and not any(a.startswith(path + ".") for a in api):
                bad_api.append(path)
    # `quest.objective-*`, `ability.*` и т.п. — шаблоны, их пропускаем
    bad_snip = [s for s in bad_snip if "*" not in s]
    check(not bad_snip, md.name + ": кирпичики существуют" + ((" — нет: " + ", ".join(sorted(set(bad_snip)))) if bad_snip else ""))
    check(not bad_api, md.name + ": `$`-пути есть в схеме" + ((" — нет: " + ", ".join(sorted(set(bad_api)))) if bad_api else ""))

print("OK" if not failures else "ПРОВАЛЕНО: %d" % failures)
sys.exit(1 if failures else 0)
