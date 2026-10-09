"""Дообучение модели эмбеддингов r2d-help на парах «вопрос → API».

    python3 tools/help_train/train.py --binary build/r2d-help --root . \
        --base путь/multilingual-e5-small --out путь/e5-r2d [--epochs 3]

Пары — tools/help_train/pairs.tsv. Текст записи («passage») берётся у самого
r2d-help (`show <имя>`), поэтому модель учится ровно на том, что потом лежит
в индексе. Трудный отрицательный пример — первая чужая API-запись из
BM25-поиска по этому же вопросу. Обучение — Python и PyTorch только здесь, при
подготовке модели; в r2d-help остаётся GGUF и C (docs/HELP.md §4).
"""
import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--binary', required=True)
p.add_argument('--root', required=True)
p.add_argument('--base', required=True)
p.add_argument('--out', required=True)
p.add_argument('--pairs', default=str(Path(__file__).with_name('pairs.tsv')))
p.add_argument('--epochs', type=int, default=3)
p.add_argument('--batch', type=int, default=32)
p.add_argument('--lr', type=float, default=2e-5)
p.add_argument('--seed', type=int, default=7)
args = p.parse_args()

random.seed(args.seed)


def help_json(*cmd):
    out = subprocess.run([args.binary, *cmd, '--root', args.root, '--no-update'],
                         capture_output=True, check=False)
    return json.loads(out.stdout.decode('utf-8'))


texts = {}


def passage(name):
    if name not in texts:
        data = help_json('show', name)
        api = [e for e in data.get('entries', []) if e['kind'] != 'doc' and e['name'] == name]
        texts[name] = api[0]['text'] if api else None
    return texts[name]


pairs = []
for line in Path(args.pairs).read_text(encoding='utf-8').splitlines():
    if not line.strip() or line.startswith('#'):
        continue
    name, qs = line.split('\t', 1)
    for q in qs.split(' | '):
        pairs.append((q.strip(), name))

examples = []
skipped = 0
for q, name in pairs:
    pos = passage(name)
    if not pos:
        skipped += 1
        continue
    neg = None
    for r in help_json('search', q, '--top', '10').get('results', []):
        if r['kind'] != 'doc' and r['name'] != name:
            neg = passage(r['name'])
            if neg:
                break
    examples.append((q, pos, neg))
print('пар: %d, без текста записи: %d, с трудным отрицательным: %d'
      % (len(examples), skipped, sum(1 for e in examples if e[2])), flush=True)
if not examples:
    sys.exit('нет обучающих пар')

import torch  # noqa: E402
from sentence_transformers import InputExample, SentenceTransformer, losses  # noqa: E402
from torch.utils.data import DataLoader  # noqa: E402

torch.manual_seed(args.seed)
device = 'mps' if torch.backends.mps.is_available() else 'cpu'
print('устройство:', device, flush=True)
model = SentenceTransformer(args.base, device=device)

train = []
for q, pos, neg in examples:
    texts_ = ['query: ' + q, 'passage: ' + pos]
    if neg:
        texts_.append('passage: ' + neg)
        train.append(InputExample(texts=texts_))
    else:
        # Тройка нужна всем элементам батча: без трудного отрицательного
        # второй позитив играет его роль только как ещё один «чужой» пример.
        train.append(InputExample(texts=texts_ + ['passage: ' + random.choice(examples)[1]]))
random.shuffle(train)
loader = DataLoader(train, shuffle=True, batch_size=args.batch)
# In-batch negatives: остальные записи батча — отрицательные примеры.
loss = losses.MultipleNegativesRankingLoss(model)
model.fit(train_objectives=[(loader, loss)], epochs=args.epochs,
          warmup_steps=max(1, len(loader) // 10), optimizer_params={'lr': args.lr},
          show_progress_bar=True)

out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
# Для конвертера llama.cpp нужен обычный каталог модели Hugging Face.
model[0].auto_model.save_pretrained(out)
model[0].tokenizer.save_pretrained(out)
print('сохранено:', out, flush=True)
