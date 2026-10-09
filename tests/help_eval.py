"""Замер качества r2d-help: recall@1, recall@5 и MRR на наборе вопросов.

    python3 tests/help_eval.py [--binary build/r2d-help] [--model f.gguf] [--min-recall5 0.0]

Без модели меряет BM25, с моделью — гибридный поиск. Число — доказательство
для docs/HELP.md (правило 6 AGENT_IMPLEMENTATION_RULES: измерять, а не верить).
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

p = argparse.ArgumentParser()
p.add_argument('--binary', default=str(ROOT / 'build' / 'r2d-help'))
p.add_argument('--model')
p.add_argument('--index')
p.add_argument('--queries', default=str(ROOT / 'tests' / 'fixtures' / 'help' / 'queries.json'))
p.add_argument('--top', type=int, default=10)
p.add_argument('--min-recall5', type=float, default=0.0)
p.add_argument('--verbose', action='store_true')
args = p.parse_args()

queries = json.loads(Path(args.queries).read_text(encoding='utf-8'))['queries']
hit1 = hit5 = 0
rr = 0.0
mode = None
misses = []
for item in queries:
    cmd = [args.binary, 'search', item['q'], '--top', str(args.top), '--root', str(ROOT)]
    if args.model:
        cmd += ['--model', args.model]
    if args.index:
        cmd += ['--index', args.index]
    out = subprocess.run(cmd, capture_output=True, text=True, check=False)
    data = json.loads(out.stdout)
    mode = data.get('mode')
    # Ответ на вопрос «как сделать» — имя API: замер идёт по списку api.
    names = [r['name'] for r in data.get('api', data.get('results', []))]
    rank = next((i + 1 for i, n in enumerate(names) if n in item['expect']), None)
    if rank == 1:
        hit1 += 1
    if rank and rank <= 5:
        hit5 += 1
    if rank:
        rr += 1.0 / rank
    if not rank or rank > 5:
        misses.append((item['q'], rank, names[:3]))
    if args.verbose:
        print('%-55s %s' % (item['q'][:55], rank))

n = len(queries)
r1, r5, mrr = hit1 / n, hit5 / n, rr / n
print('режим %s, вопросов %d: recall@1 %.2f  recall@5 %.2f  MRR %.2f' % (mode, n, r1, r5, mrr))
for q, rank, top in misses:
    print('  мимо (ранг %s): %s → %s' % (rank, q, ', '.join(top)))
sys.exit(0 if r5 >= args.min_recall5 else 1)
