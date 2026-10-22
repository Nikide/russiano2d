#!/usr/bin/env python3
"""Экспорт дообученной embedding-модели в GGUF для встраивания в r2d.

    python3 tools/ai/export_gguf.py --model tools/ai/runs/e5-r2d --out models/r2d-embed.gguf

Шаги: рабочая копия модели (без tokenizer.json, с sentencepiece.bpe.model) → конвертер
llama.cpp (тег LLAMA_TAG, скачивается) → llama-quantize Q4_0 с таблицей токенов в Q4_0.
Нужны: torch + transformers + gguf-зависимости (tools/ai/requirements.txt), `llama-quantize`
в PATH той же версии. Результат ~70 МБ; на тестовых парах recall@1 совпадает с f16
(проверка — tools/ai/eval_gguf.py).

Две ловушки (проверено): e5 — это BERT с токенизатором XLM-R, поэтому конвертеру
объявляется XLMRobertaModel, но `pad_token_id` удаляется — иначе он срежет 2 строки
позиционных эмбеддингов (recall@1 падал с 0,96 до 0,77).
"""
import argparse
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

LLAMA_TAG = "b11669"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="каталог дообученной модели (sentence-transformers)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="intfloat/multilingual-e5-small", help="откуда взять sentencepiece.bpe.model")
    args = ap.parse_args()
    model = Path(args.model)
    out = Path(args.out)
    with tempfile.TemporaryDirectory(prefix="r2d-gguf-") as tmp:
        tmp = Path(tmp)
        url = f"https://github.com/ggml-org/llama.cpp/archive/refs/tags/{LLAMA_TAG}.tar.gz"
        print("скачиваю конвертер", url, flush=True)
        tgz = tmp / "src.tgz"
        urllib.request.urlretrieve(url, tgz)
        with tarfile.open(tgz) as t:
            t.extractall(tmp)
        src = next(tmp.glob("llama.cpp-*"))
        work = tmp / "model"
        work.mkdir()
        for name in ("model.safetensors", "config.json", "tokenizer_config.json"):
            shutil.copy(model / name, work / name)
        from huggingface_hub import hf_hub_download
        shutil.copy(hf_hub_download(args.base, "sentencepiece.bpe.model"), work / "sentencepiece.bpe.model")
        cfg = json.loads((work / "config.json").read_text(encoding="utf-8"))
        cfg["architectures"] = ["XLMRobertaModel"]
        cfg.pop("pad_token_id", None)
        (work / "config.json").write_text(json.dumps(cfg), encoding="utf-8")
        f16 = tmp / "f16.gguf"
        env = {"PYTHONPATH": str(src / "gguf-py"), "PATH": __import__("os").environ["PATH"]}
        subprocess.run([sys.executable, str(src / "convert_hf_to_gguf.py"), str(work), "--outfile", str(f16), "--outtype", "f16"],
                       check=True, env=env)
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["llama-quantize", "--token-embedding-type", "q4_0", str(f16), str(out), "Q4_0"], check=True)
    print("готово:", out, f"{out.stat().st_size / 1048576:.0f} МБ")


if __name__ == "__main__":
    main()
