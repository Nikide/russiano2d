#!/usr/bin/env python3
"""Дообучение embedding-модели на парах R2D (контрастивно, in-batch negatives).

    pip install -r tools/ai/requirements.txt
    python3 tools/ai/train_embed.py --data tools/ai/data --out runs/e5-r2d [--base intfloat/multilingual-e5-small]

Запускается на GPU-машине (Cloud.ru, см. docs/AI_TRAINING_CLOUDRU.md); токены и
ключи не нужны — база качается публично. Модель e5 требует префиксы
`query: ` / `passage: ` — они добавляются здесь и в eval_embed.py.
"""
import argparse
import json
from pathlib import Path


def load(path):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="intfloat/multilingual-e5-small")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--max-len", type=int, default=256)
    ap.add_argument("--lr", type=float, default=2e-5)
    args = ap.parse_args()

    from sentence_transformers import SentenceTransformer, InputExample, losses
    from torch.utils.data import DataLoader

    model = SentenceTransformer(args.base)
    model.max_seq_length = args.max_len
    train = load(Path(args.data) / "train.jsonl")
    examples = [InputExample(texts=["query: " + r["query"], "passage: " + r["positive"]]) for r in train]
    loader = DataLoader(examples, shuffle=True, batch_size=args.batch)
    loss = losses.MultipleNegativesRankingLoss(model)
    model.fit(train_objectives=[(loader, loss)], epochs=args.epochs,
              warmup_steps=int(0.1 * len(loader) * args.epochs),
              optimizer_params={"lr": args.lr}, show_progress_bar=True)
    model.save(args.out)
    print("сохранено:", args.out, "пар:", len(train))


if __name__ == "__main__":
    main()
