#!/usr/bin/env python3
"""Живые вопросы (data/live.jsonl) против пула кусков корпуса: сравнение моделей без пересборки r2d.

    python3 tools/ai/eval_live_st.py --data tools/ai/data_v2 --model runs/e5-r2d-v2 [--k 4]

Пул — все positive из train/val/test (doc/api/snippet; демо-код в пул не входит: агент ищет по документации и кирпичикам).
Попадание: в первых k разных источниках есть подстрока из `expect` (через «|»).
"""
import argparse
import json
from pathlib import Path


def rows(path):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--live", default=str(Path(__file__).parent / "data" / "live.jsonl"))
    ap.add_argument("--k", type=int, default=4)
    args = ap.parse_args()
    import numpy as np
    from sentence_transformers import SentenceTransformer

    pool = [r for sp in ("train", "val", "test") for r in rows(Path(args.data) / f"{sp}.jsonl") if r["kind"] in ("doc", "api", "snippet")]
    live = rows(args.live)
    model = SentenceTransformer(args.model)
    model.max_seq_length = 256
    p = model.encode(["passage: " + r["positive"] for r in pool], normalize_embeddings=True, batch_size=32)
    q = model.encode(["query: " + r["query"] for r in live], normalize_embeddings=True, batch_size=32)
    sims = q @ p.T
    h1 = hk = 0
    for i, r in enumerate(live):
        seen, srcs = set(), []
        for j in np.argsort(-sims[i]):
            s = pool[j]["source"]
            if s not in seen:
                seen.add(s); srcs.append(s)
            if len(srcs) >= args.k:
                break
        ok = [any(e in s for e in r["expect"].split("|")) for s in srcs]
        h1 += bool(ok and ok[0]); hk += any(ok)
    n = len(live)
    print(json.dumps({"model": args.model, "n": n, "pool": len(pool), "recall@1": round(h1 / n, 3), f"recall@{args.k}": round(hk / n, 3)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
