#!/usr/bin/env python3
"""recall@k / MRR для GGUF-модели через llama-server (тот же тест, что eval_embed.py).

    python3 tools/ai/eval_gguf.py --data tools/ai/data --gguf model.gguf [--port 8765]

Нужен `llama-server` из llama.cpp в PATH. Сервер запускается и гасится скриптом.
Используется, чтобы выбрать квантизацию: сравнивайте метрики с eval_embed.py (до GGUF).
"""
import argparse
import json
import subprocess
import time
import urllib.request
from pathlib import Path


def post(port, texts):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/embeddings", method="POST",
                                 data=json.dumps({"input": texts, "model": "x"}).encode(),
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return [d["embedding"] for d in json.load(r)["data"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--gguf", required=True)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--split", default="test")
    ap.add_argument("--max-len", type=int, default=160)
    args = ap.parse_args()
    import numpy as np

    rows = [json.loads(l) for l in (Path(args.data) / f"{args.split}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    srv = subprocess.Popen(["llama-server", "-m", args.gguf, "--embedding", "--pooling", "mean", "--port", str(args.port),
                            "-c", "8192", "-ub", "2048", "-b", "2048", "--parallel", "4", "--log-disable"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{args.port}/health", timeout=2)
                break
            except Exception:
                time.sleep(1)
        def enc(prefix, texts):
            out = []
            for i in range(0, len(texts), 16):
                out += post(args.port, [prefix + t[:args.max_len * 4] for t in texts[i:i + 16]])
            m = np.array(out, dtype=np.float32)
            return m / np.linalg.norm(m, axis=1, keepdims=True)
        # Одинаковые positive (несколько запросов к одной карточке) кодируем один раз: сервер
        # при разных позициях в батче даёт чуть разные float, и «дубли» обгоняли бы сами себя.
        uniq = list(dict.fromkeys(r["positive"] for r in rows))
        index = {t: i for i, t in enumerate(uniq)}
        q = enc("query: ", [r["query"] for r in rows])
        pu = enc("passage: ", uniq)
        p = pu[[index[r["positive"]] for r in rows]]
    finally:
        srv.terminate()
    sims = q @ p.T
    ranks = (sims > sims.diagonal()[:, None]).sum(axis=1) + 1
    print(json.dumps({"gguf": args.gguf, "n": len(rows), "recall@1": float((ranks <= 1).mean()),
                      "recall@5": float((ranks <= 5).mean()), "mrr": float((1.0 / ranks).mean())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
