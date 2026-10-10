"""Сверка GGUF-модели в r2d-help с исходной моделью sentence-transformers.

    python check_gguf.py --binary r2d-help --gguf f.gguf --hf каталог_модели

Считает векторы одних и тех же вопросов и разделов двумя путями: исходной
моделью (PyTorch) и r2d-help (llama.cpp, GGUF q8_0). Косинус должен быть
близок к 1; иначе конвертация сломана (словарь, позиции, пулинг), и все
дальнейшие замеры качества недостоверны — выход с кодом 1.
"""
import argparse
import json
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument('--binary', required=True)
p.add_argument('--gguf', required=True)
p.add_argument('--hf', required=True)
p.add_argument('--min-cos', type=float, default=0.98)
args = p.parse_args()

SAMPLES = [
    ('как поставить игру на паузу', True),
    ('enemy follows the player around walls', True),
    ('$.nav.mesh(opts) создаёт навмеш — прямоугольную декомпозицию области', False),
    ('.navigateTo(target, opts) Ставит узел на маршрут к цели.', False),
    ('Ёлка, ёжик и «кавычки» — UTF-8 с эмодзи 🎮 и цифрами 12345', True),
]

from sentence_transformers import SentenceTransformer  # noqa: E402

model = SentenceTransformer(args.hf, device='cpu')
worst = 1.0
for text, is_query in SAMPLES:
    prefix = 'query: ' if is_query else 'passage: '
    ref = model.encode(prefix + text, normalize_embeddings=True)
    cmd = [args.binary, 'embed', text, '--model', args.gguf]
    if is_query:
        cmd.append('--query')
    out = subprocess.run(cmd, capture_output=True, check=False)
    data = json.loads(out.stdout.decode('utf-8'))
    if not data.get('ok'):
        sys.exit('r2d-help embed: %s' % data.get('error'))
    vec = data['vector']
    if len(vec) != len(ref):
        sys.exit('размерность разная: gguf %d, исходная %d' % (len(vec), len(ref)))
    cos = float(sum(a * b for a, b in zip(vec, ref)))
    worst = min(worst, cos)
    print('cos %.4f  %s' % (cos, text[:60]))
print('худший косинус %.4f (порог %.2f)' % (worst, args.min_cos))
sys.exit(0 if worst >= args.min_cos else 1)
