#!/usr/bin/env python3
"""recall@k / MRR на test.jsonl: база против дообученной модели.

    python3 tools/ai/eval_embed.py --data tools/ai/data --model intfloat/multilingual-e5-small
    python3 tools/ai/eval_embed.py --data tools/ai/data --model runs/e5-r2d

Корпус поиска — все positive из test; запрос — query. Печатает JSON с метриками,
чтобы сравнить прогоны (в том числе с BM25). Метрики — только по реально
выполненному прогону.
"""
import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--split", default="test")
    args = ap.parse_args()

    import numpy as np
    from sentence_transformers import SentenceTransformer

    rows = [json.loads(l) for l in (Path(args.data) / f"{args.split}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    model = SentenceTransformer(args.model)
    q = model.encode(["query: " + r["query"] for r in rows], normalize_embeddings=True, batch_size=64)
    p = model.encode(["passage: " + r["positive"] for r in rows], normalize_embeddings=True, batch_size=64)
    sims = q @ p.T
    ranks = (sims > sims.diagonal()[:, None]).sum(axis=1) + 1
    out = {"model": args.model, "split": args.split, "n": len(rows),
           "recall@1": float((ranks <= 1).mean()), "recall@5": float((ranks <= 5).mean()),
           "recall@10": float((ranks <= 10).mean()), "mrr": float((1.0 / ranks).mean())}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
