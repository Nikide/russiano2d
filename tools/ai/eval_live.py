#!/usr/bin/env python3
"""Живые вопросы (RU/EN, как их задают агенту) → `r2d docs context`: попал ли ожидаемый документ в топ-k.

    R2D_BINARY=… python3 tools/ai/eval_live.py [--limit 4] [--data tools/ai/data/live.jsonl]

Считает BM25 (`--no-ai`) и гибрид (BM25 + встроенная модель) на одних и тех же вопросах:
`expect` — подстроки пути через «|» (документ или id кирпичика, любая подходит), достаточно одного попадания в первые k.
Это то, что реально видит агент, а не метрики синтетической пары запрос/пассаж.
"""
import argparse
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def ask(binary, query, limit, ai):
    cmd = [binary, "docs", "context", query, "--limit", str(limit), "--quiet"] + ([] if ai else ["--no-ai"])
    out = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, timeout=300).stdout
    d = json.loads(out)
    return [c["path"] for c in d.get("chunks", [])], d.get("mode")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "tools/ai/data/live.jsonl"))
    ap.add_argument("--limit", type=int, default=4)
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args()
    binary = os.environ.get("R2D_BINARY")
    if not binary:
        raise SystemExit("нужен R2D_BINARY")
    rows = [json.loads(l) for l in Path(args.data).read_text(encoding="utf-8").splitlines() if l.strip()]
    res = {}
    for name, ai in (("bm25", False), ("hybrid", True)):
        hit = {1: 0, args.limit: 0}
        miss = []
        mode = None
        for r in rows:
            paths, mode = ask(binary, r["query"], args.limit, ai)
            ranks = [i for i, p in enumerate(paths) if any(e in p for e in r["expect"].split("|"))]
            if ranks:
                hit[args.limit] += 1
                if ranks[0] == 0:
                    hit[1] += 1
            else:
                miss.append((r["query"], r["expect"], paths[:2]))
        res[name] = {"mode": mode, "n": len(rows), "recall@1": round(hit[1] / len(rows), 3), f"recall@{args.limit}": round(hit[args.limit] / len(rows), 3)}
        if args.v:
            for m in miss:
                print(name, "MISS", m)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
