#!/usr/bin/env python3
"""Обучающие пары (запрос → кусок документации) для embedding-модели R2D.

    build_pairs.py [--out tools/ai/data] [--seed 1]

Пары синтетические, без LLM:
  * заголовок раздела → текст раздела (docs/**/*.md, публичные страницы);
  * описание функции из api.schema.json → «путь + описание» (4111 имён `$`-API);
  * кирпичики (snippets/*/snippet.json): название, описание, теги, «категория + название» → карточка
    кирпичика (та же, что строит `r2d docs context`).
Делит по ФАЙЛАМ/путям на train/val/test (80/10/10), чтобы val/test не пересекались
с train по источнику. Пишет jsonl: {"query","positive","source","kind"}.
Это стартовый, слабый сигнал; живые вопросы пользователей (RU/EN) его заменят.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import public_docs  # noqa: E402

MAX_CHUNK = 1800


def split_chunks(text: str):
    """Куски по заголовкам; возвращает (заголовок, тело)."""
    head, buf, out = "", [], []
    for line in text.splitlines():
        if re.match(r"#{1,4} ", line):
            if buf:
                out.append((head, "\n".join(buf).strip()))
            head, buf = re.sub(r"^#+\s*", "", line).strip(), []
        else:
            buf.append(line)
    if buf:
        out.append((head, "\n".join(buf).strip()))
    return [(h, b[:MAX_CHUNK]) for h, b in out if h and len(b) > 80]


def bucket(key: str) -> str:
    n = int(hashlib.sha1(key.encode()).hexdigest()[:8], 16) % 10
    return "train" if n < 8 else "val" if n == 8 else "test"


def doc_pairs():
    for path in sorted((ROOT / "docs").rglob("*.md")):
        rel = path.relative_to(ROOT).as_posix()
        if public_docs.is_internal_doc(rel):
            continue
        for head, body in split_chunks(path.read_text(encoding="utf-8")):
            yield bucket(rel), {"query": head, "positive": head + "\n" + body, "source": rel, "kind": "doc"}


def api_pairs():
    schema = json.loads((ROOT / "api.schema.json").read_text(encoding="utf-8"))
    for n in schema["names"]:
        desc = (n.get("description") or "").strip()
        if len(desc) < 12 or n.get("kind") != "function":
            continue
        pos = f'{n["path"]}: {desc}'
        yield bucket(n["path"]), {"query": desc, "positive": pos, "source": n["path"], "kind": "api"}


def loc(v):
    if isinstance(v, dict):
        return v.get("ru") or v.get("en") or ""
    return v or ""


def snippet_pairs():
    for path in sorted((ROOT / "snippets").glob("*/snippet.json")):
        m = json.loads(path.read_text(encoding="utf-8"))
        sid, title, desc = m.get("id", ""), loc(m.get("title")), loc(m.get("description"))
        tags = [t for t in m.get("tags", []) if isinstance(t, str)]
        fields = " ".join(f'{f.get("id","")} ({loc(f.get("label"))})' for f in m.get("fields", []))
        card = (f"Кирпичик {sid} — {title}\n{desc}\nКатегория: {m.get('category','')}\nТеги: {' '.join(tags)}"
                + (f"\nПоля: {fields}" if fields else "") + "\nПрименение: snippet_apply")
        queries = [title, desc, ", ".join(tags), f"{m.get('category','')}: {title}"]
        if isinstance(m.get("title"), dict) and m["title"].get("en"):
            queries.append(m["title"]["en"])
        if isinstance(m.get("description"), dict) and m["description"].get("en"):
            queries.append(m["description"]["en"])
        for q in dict.fromkeys(x.strip() for x in queries if x and len(x.strip()) >= 4):
            yield bucket(sid), {"query": q, "positive": card, "source": f"snippets/{sid}", "kind": "snippet"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "tools/ai/data"))
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    rows = {"train": [], "val": [], "test": []}
    for split, row in list(doc_pairs()) + list(api_pairs()) + list(snippet_pairs()):
        rows[split].append(row)
    rnd = random.Random(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for split, items in rows.items():
        rnd.shuffle(items)
        (out / f"{split}.jsonl").write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in items), encoding="utf-8")
        print(f"{split}: {len(items)} пар")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
