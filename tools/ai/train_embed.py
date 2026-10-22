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
    ap.add_argument("--freeze-embeddings", action="store_true",
                    help="не обучать таблицу слов (96M из 118M параметров e5-small): влезает в память Mac")
    args = ap.parse_args()

    import random
    import torch
    import torch.nn.functional as F
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    model = SentenceTransformer(args.base, device=device)
    model.max_seq_length = args.max_len
    if args.freeze_embeddings:
        for prm in model[0].auto_model.embeddings.word_embeddings.parameters():
            prm.requires_grad = False
    train = load(Path(args.data) / "train.jsonl")
    pairs = [("query: " + r["query"], "passage: " + r["positive"]) for r in train]
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.01)
    steps_per_epoch = len(pairs) // args.batch
    total = steps_per_epoch * args.epochs
    warm = max(1, int(0.1 * total))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda t: min((t + 1) / warm, max(0.0, (total - t) / max(1, total - warm))))
    rnd = random.Random(1)
    model.train()

    def embed(texts):
        feats = {k: v.to(device) for k, v in model.tokenize(texts).items() if hasattr(v, 'to')}
        return F.normalize(model(feats)["sentence_embedding"], dim=-1)

    step = 0
    for epoch in range(args.epochs):
        rnd.shuffle(pairs)
        for b in range(steps_per_epoch):
            batch = pairs[b * args.batch:(b + 1) * args.batch]
            q = embed([x[0] for x in batch])
            p = embed([x[1] for x in batch])
            logits = q @ p.T * 20.0       # масштаб как у MultipleNegativesRankingLoss
            labels = torch.arange(len(batch), device=device)
            loss = F.cross_entropy(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
            step += 1
            if step % 10 == 0:
                if device == "mps":
                    torch.mps.empty_cache()   # кэш аллокатора MPS растёт и упирается в лимит памяти Mac
                print(f"шаг {step}/{total} эпоха {epoch + 1} loss {loss.item():.4f}", flush=True)
    model.eval()
    model.save(args.out)
    print("сохранено:", args.out, "пар:", len(train))


if __name__ == "__main__":
    main()
