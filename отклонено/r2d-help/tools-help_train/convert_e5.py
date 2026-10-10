"""Конвертация multilingual-e5-small (и дообученной копии) в GGUF.

    python convert_e5.py <llama.cpp> <каталог модели HF> --outfile f.gguf --outtype q8_0

У e5-small в config.json архитектура BertModel, но словарь — sentencepiece от
XLM-RoBERTa. Конвертер llama.cpp для BertModel пишет словарь как WordPiece
(«##»), и модель токенизирует текст неверно. Здесь BertModel получает словарь
XLM-R (unigram, «t5» в GGUF), а позиции остаются как у BERT: смещение
позиций XLM-R (pad + 1) к e5 не относится. Правильность проверяет
check_gguf.py сравнением с исходной моделью.
"""
import runpy
import sys
from pathlib import Path

llama = Path(sys.argv[1]).resolve()
sys.argv = [str(llama / 'convert_hf_to_gguf.py')] + sys.argv[2:]
sys.path.insert(0, str(llama / 'gguf-py'))
sys.path.insert(0, str(llama))

from conversion import bert  # noqa: E402

original = bert.BertModel.set_vocab


def xlmr_tokenizer(dir_model):
    if (dir_model / 'sentencepiece.bpe.model').is_file():
        return True
    cfg = dir_model / 'tokenizer_config.json'
    if cfg.is_file():
        import json
        cls = json.loads(cfg.read_text(encoding='utf-8')).get('tokenizer_class') or ''
        return 'XLMRoberta' in cls
    return False


def set_vocab(self):
    # Только сам BertModel со словарём XLM-R; подклассы со своим set_vocab
    # (XLMRobertaModel, NomicBert…) сюда не попадают.
    if type(self) is bert.BertModel and xlmr_tokenizer(self.dir_model):
        return self._xlmroberta_set_vocab()
    return original(self)


bert.BertModel.set_vocab = set_vocab
runpy.run_path(sys.argv[0], run_name='__main__')
