"""Дообучение модели эмбеддингов r2d-help на парах «вопрос → API».

    python3 tools/help_train/train.py --binary build/r2d-help --root . --index bm25.idx \
        --base путь/multilingual-e5-small --out путь/e5-r2d [--epochs 3]
        [--state каталог] [--max-seconds 150]

Пары — tools/help_train/pairs.tsv. Текст записи («passage») берётся у самого
r2d-help (`show <имя>`), поэтому модель учится ровно на том, что потом лежит
в индексе. Трудный отрицательный пример — первая чужая API-запись из
BM25-поиска по этому же вопросу. Потеря — MultipleNegativesRanking: остальные
записи батча и трудный отрицательный — «чужие».

Обучение можно прерывать: с --state и --max-seconds скрипт сохраняет модель,
оптимизатор и номер шага, а следующий запуск продолжает с того же места
(машина с ограничением времени команды, медленный CPU). Выход 0 — обучение
закончено и модель записана в --out; выход 3 — нужен ещё запуск.

Матрица словаря (96 млн из 118 млн параметров e5-small) заморожена: на
сотнях пар её не переучить, а память оптимизатора падает в разы. Обучаются
слои трансформера. Python и PyTorch нужны только здесь, при подготовке
модели; в r2d-help остаётся GGUF и C (docs/HELP.md §4).
"""
import argparse
import json
import random
import subprocess
import sys
import time
from pathlib import Path

START = time.time()
p = argparse.ArgumentParser()
p.add_argument('--binary', required=True)
p.add_argument('--root', required=True)
p.add_argument('--index', required=True, help='готовый индекс r2d-help (например bm25.idx)')
p.add_argument('--base', required=True)
p.add_argument('--out', required=True)
p.add_argument('--pairs', default=str(Path(__file__).with_name('pairs.tsv')))
p.add_argument('--epochs', type=int, default=3)
p.add_argument('--batch', type=int, default=16)
p.add_argument('--lr', type=float, default=2e-5)
p.add_argument('--max-seq', type=int, default=256)
p.add_argument('--seed', type=int, default=7)
p.add_argument('--state', help='каталог состояния для продолжения обучения')
p.add_argument('--max-seconds', type=float, default=0, help='0 — без ограничения')
args = p.parse_args()

state = Path(args.state) if args.state else Path(args.out + '.state')
state.mkdir(parents=True, exist_ok=True)


def out_of_time(margin=0.0):
    return args.max_seconds > 0 and time.time() - START > args.max_seconds - margin


# ---------------------------------------------------------------------------
# Данные: один раз, затем из кэша состояния
# ---------------------------------------------------------------------------
def help_json(*cmd):
    out = subprocess.run([args.binary, *cmd, '--root', args.root, '--index', args.index, '--no-update'],
                         capture_output=True, check=False)
    return json.loads(out.stdout.decode('utf-8'))


cache = state / 'examples.json'
if cache.is_file():
    examples = json.loads(cache.read_text(encoding='utf-8'))
else:
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
    for q, name in pairs:
        pos = passage(name)
        if not pos:
            continue
        neg = None
        for r in help_json('search', q, '--top', '10').get('results', []):
            if r['kind'] != 'doc' and r['name'] != name:
                neg = passage(r['name'])
                if neg:
                    break
        examples.append([q, pos, neg])
    if not examples:
        sys.exit('нет обучающих пар')
    # Без трудного отрицательного — случайная чужая запись: у всех троек
    # одинаковая форма, батч собирается без особых случаев.
    rng = random.Random(args.seed)
    for e in examples:
        if not e[2]:
            other = rng.choice(examples)
            e[2] = other[1] if other[1] != e[1] else examples[0][1]
    cache.write_text(json.dumps(examples, ensure_ascii=False), encoding='utf-8')
print('обучающих троек (вопрос, запись, чужая запись): %d' % len(examples), flush=True)

# ---------------------------------------------------------------------------
# Модель и состояние
# ---------------------------------------------------------------------------
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from sentence_transformers import SentenceTransformer  # noqa: E402

torch.manual_seed(args.seed)
device = 'mps' if torch.backends.mps.is_available() else 'cpu'
ckpt = state / 'model'
meta_path = state / 'meta.json'
meta = json.loads(meta_path.read_text()) if meta_path.is_file() else {'step': 0}
model = SentenceTransformer(str(ckpt if (ckpt / 'config.json').is_file() else args.base), device=device)
model.max_seq_length = args.max_seq
for prm in model[0].auto_model.embeddings.word_embeddings.parameters():
    prm.requires_grad = False
params = [prm for prm in model.parameters() if prm.requires_grad]
opt = torch.optim.AdamW(params, lr=args.lr)
if (state / 'optim.pt').is_file():
    opt.load_state_dict(torch.load(state / 'optim.pt', map_location=device))

steps_per_epoch = (len(examples) + args.batch - 1) // args.batch
total = steps_per_epoch * args.epochs
warmup = max(1, total // 10)
print('устройство %s, шагов %d (эпох %d по %d), начало с шага %d'
      % (device, total, args.epochs, steps_per_epoch, meta['step']), flush=True)


def lr_at(step):
    if step < warmup:
        return args.lr * (step + 1) / warmup
    return args.lr * max(0.0, (total - step) / max(1, total - warmup))


def batch_of(step):
    # Порядок эпохи зависит только от зерна и номера эпохи: продолжение после
    # остановки видит те же батчи, что непрерывный прогон.
    epoch, k = divmod(step, steps_per_epoch)
    order = list(range(len(examples)))
    random.Random(args.seed * 1000 + epoch).shuffle(order)
    return [examples[i] for i in order[k * args.batch:(k + 1) * args.batch]]


def embed(texts):
    feats = model.tokenize(texts)
    feats = {k: (v.to(device) if torch.is_tensor(v) else v) for k, v in feats.items()}
    return F.normalize(model(feats)['sentence_embedding'], dim=-1)


def save_state():
    model.save(str(ckpt))
    torch.save(opt.state_dict(), state / 'optim.pt')
    meta_path.write_text(json.dumps(meta))


model.train()
t_step = 0.0
while meta['step'] < total:
    # Сохраняемся заранее: запись модели занимает секунды.
    if out_of_time(margin=max(25.0, 2.5 * t_step)):
        save_state()
        print('остановка по времени на шаге %d/%d, продолжите тем же вызовом' % (meta['step'], total), flush=True)
        sys.exit(3)
    t0 = time.time()
    b = batch_of(meta['step'])
    q = embed(['query: ' + e[0] for e in b])
    d = embed(['passage: ' + e[1] for e in b] + ['passage: ' + e[2] for e in b])
    scores = q @ d.T * 20.0
    loss = F.cross_entropy(scores, torch.arange(len(b), device=device))
    for g in opt.param_groups:
        g['lr'] = lr_at(meta['step'])
    opt.zero_grad()
    loss.backward()
    opt.step()
    meta['step'] += 1
    t_step = time.time() - t0
    if meta['step'] % 5 == 0 or meta['step'] == total:
        print('шаг %d/%d  loss %.4f  %.1f с/шаг' % (meta['step'], total, loss.item(), t_step), flush=True)

save_state()
out = Path(args.out)
# Полная модель sentence-transformers: в корне — обычный каталог Hugging Face
# (config, веса, токенизатор) для конвертера llama.cpp, рядом — modules.json и
# пулинг, чтобы сверка check_gguf.py шла тем же путём, что обучение.
model.save(str(out))
print('готово: %s' % out, flush=True)
