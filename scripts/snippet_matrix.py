#!/usr/bin/env python3
"""Матрица 500 пакетов сниппетов (docs/SNIPPET_SYSTEM_PROJECT.md §12, §20.2).

Источники: список ID из §12 ТЗ, встроенный каталог snippets/ и api.schema.json.
Пишет docs/SNIPPET_MATRIX.md и snippets/matrix.json. `--check` — код 1, если
файлы устарели (CI/тесты). Колонка API — опорные пространства $ по префиксу ID;
у реализованного пакета — его фактические requires из manifest. «Пробел» —
нужное пространство отсутствует в api.schema.json.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs/SNIPPET_SYSTEM_PROJECT.md"
SCHEMA = ROOT / "api.schema.json"
CATALOG = ROOT / "snippets"
OUT_MD = ROOT / "docs/SNIPPET_MATRIX.md"
OUT_JSON = CATALOG / "matrix.json"

# Префикс ID → пространства $ API, на которых пакет должен строиться.
# Новых подсистем не заводим: если пространства нет — это API gap для решения.
PREFIX_API = {
    "actor": ["$.fn", "$.prefab"], "player": ["$.fn", "$.input", "$.camera"], "enemy": ["$.fn", "$.combat"],
    "npc": ["$.fn", "$.nav"], "companion": ["$.fn", "$.nav"], "projectile": ["$.fn", "$.weapons", "$.combat"],
    "pickup": ["$.fn", "$.items"], "breakable": ["$.fn", "$.combat"], "trigger": ["$.triggers"],
    "interactable": ["$.fn", "$.input"], "movement": ["$.fn", "$.input", "$.updateFor"],
    "weapon": ["$.weapons", "$.combat"], "health": ["$.fn", "$.combat"], "ai": ["$.nav", "$.updateFor"],
    "interact": ["$.fn", "$.triggers", "$.input"], "item": ["$.items"], "inventory": ["$.inv", "$.items"],
    "equipment": ["$.items", "$.inv"], "economy": ["$.items", "$.store"], "crafting": ["$.items", "$.inv"],
    "stats": ["$.fn", "$.state"], "progression": ["$.state", "$.store"], "ability": ["$.combat", "$.time"],
    "quest": ["$.quest"], "mission": ["$.quest"], "dialogue": ["$.dialog"], "story": ["$.story", "$.dialog"],
    "puzzle": ["$.fn", "$.triggers", "$.signal"], "world": ["$.world", "$.tilemap", "$.layers"],
    "camera": ["$.camera"], "render": ["$.gfx", "$.fx"], "animation": ["$.anim", "$.tween"],
    "audio": ["$.audio", "$.sound"], "feedback": ["$.hitFx", "$.fx", "$.camera"], "ui": ["$.ui"],
    "save": ["$.save", "$.store"], "settings": ["$.store", "$.ui"], "accessibility": ["$.ui", "$.input"],
    "localization": ["$.i18n"], "net": ["$.net"], "kit": [],
}


def spec_items():
    text = SPEC.read_text(encoding="utf-8")
    sec = text[text.index("## 12."):text.index("## 13.")]
    heads = [(m.start(), m.group(1), m.group(2)) for m in re.finditer(r"^### ([A-ZА-Я]+)\. (.+?) — \d+–\d+", sec, re.M)]
    items = []
    for m in re.finditer(r"^(\d{3})\. ([a-z0-9.-]+) — (.+)$", sec, re.M):
        section = [h for h in heads if h[0] < m.start()][-1]
        items.append({"n": int(m.group(1)), "id": m.group(2), "summary": m.group(3).strip(),
                      "section": section[1], "section_title": section[2]})
    return items


def build():
    names = {x["path"] for x in json.loads(SCHEMA.read_text(encoding="utf-8"))["names"]}
    namespaces = {".".join(p.split(".")[:2]) for p in names if p.startswith("$.")}
    rows = []
    for it in spec_items():
        prefix = it["id"].split(".")[0]
        manifest = CATALOG / it["id"] / "snippet.json"
        row = dict(it, kind="kit" if prefix == "kit" else "behavior", status="planned", api=[], gaps=[], dependencies=[])
        if manifest.exists():
            m = json.loads(manifest.read_text(encoding="utf-8"))
            row["status"] = "implemented"
            row["kind"] = m.get("kind", row["kind"])
            row["api"] = sorted({(r if isinstance(r, str) else r.get("api")) for r in m.get("requires", [])})
            row["dependencies"] = [(d if isinstance(d, str) else d.get("id")) for d in m.get("dependencies", [])]
            row["gaps"] = [a for a in row["api"] if a not in names]
        else:
            row["api"] = PREFIX_API.get(prefix, [])
            row["gaps"] = [a for a in row["api"] if a not in namespaces]
            if prefix not in PREFIX_API:
                row["gaps"] = ["нет опорного пространства для «%s»" % prefix]
        rows.append(row)
    return rows


def render(rows):
    done = sum(r["status"] == "implemented" for r in rows)
    gaps = [r for r in rows if r["gaps"]]
    out = ["# Матрица пакетов сниппетов", "",
           "Сгенерировано `python3 scripts/snippet_matrix.py` из §12 [ТЗ](SNIPPET_SYSTEM_PROJECT.md),",
           "каталога `snippets/` и `api.schema.json`. Руками не править.", "",
           "Реализовано: **%d из %d**. Строк с пробелом API: **%d**." % (done, len(rows), len(gaps)), "",
           "Колонка API: для реализованного пакета — фактические `requires`; для",
           "запланированного — опорные пространства `$` по префиксу ID (предварительно,",
           "уточняется при реализации пакета).", ""]
    section = None
    for r in rows:
        if r["section"] != section:
            section = r["section"]
            done_s = sum(x["status"] == "implemented" for x in rows if x["section"] == section)
            total_s = sum(x["section"] == section for x in rows)
            out += ["", "## %s. %s — %d/%d" % (section, r["section_title"], done_s, total_s), "",
                    "| № | ID | Статус | API | Пробел |", "|---|---|---|---|---|"]
        status = "✅" if r["status"] == "implemented" else "⬜"
        api = ", ".join("`%s`" % a for a in r["api"]) or ("состав kit" if r["kind"] == "kit" else "—")
        gap = ", ".join(r["gaps"]) or "—"
        out.append("| %03d | `%s` | %s | %s | %s |" % (r["n"], r["id"], status, api, gap))
    return "\n".join(out) + "\n"


def main():
    rows = build()
    md = render(rows)
    js = json.dumps({"format": 1, "total": len(rows), "packages": rows}, ensure_ascii=False, indent=1) + "\n"
    if "--check" in sys.argv:
        stale = [p for p, t in ((OUT_MD, md), (OUT_JSON, js)) if not p.exists() or p.read_text(encoding="utf-8") != t]
        extra = sorted(p.name for p in CATALOG.iterdir() if (p / "snippet.json").exists() and p.name not in {r["id"] for r in rows})
        for p in stale:
            print("устарел: %s (python3 scripts/snippet_matrix.py)" % p.relative_to(ROOT))
        for e in extra:
            print("пакет вне §12 ТЗ: %s" % e)
        sys.exit(1 if stale or extra else 0)
    OUT_MD.write_text(md, encoding="utf-8")
    OUT_JSON.write_text(js, encoding="utf-8")
    print("matrix: %d пакетов, реализовано %d" % (len(rows), sum(r["status"] == "implemented" for r in rows)))


if __name__ == "__main__":
    main()
