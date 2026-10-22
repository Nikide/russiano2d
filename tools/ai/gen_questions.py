#!/usr/bin/env python3
"""Живые вопросы к кускам корпуса от языковой модели (OpenAI-совместимый API) → data_v3.

    AG_KEY=<ключ> python3 tools/ai/gen_questions.py --data tools/ai/data_v2 --out tools/ai/data_v3 \
        [--base https://api.inceptionlabs.ai/v1] [--model mercury-3] [--limit N] [--workers 6]

Для каждого doc/snippet-куска просит 3 вопроса так, как их задаёт разработчик игры агенту (RU и EN, не копируя заголовок).
Сплит наследуется от источника: вопрос к куску из test остаётся в test. Прогресс кэшируется в <out>/questions.cache.jsonl
(повторный запуск продолжает). Ключ только из окружения, на диск не пишется.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROMPT = ("Ниже фрагмент документации игрового 2D-движка Russiano2D. Придумай 3 коротких вопроса, которые разработчик игры "
          "задал бы ИИ-агенту, чтобы получить именно этот фрагмент: 2 по-русски и 1 по-английски. Говори своими словами, "
          "про задачу («как сделать…», «чем…», «где…»), а не копируй заголовок и названия функций целиком. "
          "Ответ — только JSON-массив из 3 строк.\n\nФРАГМЕНТ:\n")


def rows(path):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


_giga = {"token": None, "exp": 0, "ctx": None}


def giga_ctx():
    """TLS-контекст с корневым сертификатом Минцифры (тот же PEM, что в editor/lib/ru_root_ca.js)."""
    import ssl
    if not _giga["ctx"]:
        js = (Path(__file__).resolve().parents[2] / "editor/lib/ru_root_ca.js").read_text(encoding="utf-8")
        lines = re.findall(r"'([^']*)'", js)
        a = lines.index("-----BEGIN CERTIFICATE-----"); b = lines.index("-----END CERTIFICATE-----")
        pem = "\n".join(lines[a:b + 1]) + "\n"
        ctx = ssl.create_default_context()
        ctx.load_verify_locations(cadata=pem)
        _giga["ctx"] = ctx
    return _giga["ctx"]


def giga_token(key):
    import uuid
    if _giga["token"] and time.time() < _giga["exp"]:
        return _giga["token"]
    req = urllib.request.Request("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", data=b"scope=GIGACHAT_API_PERS",
                                 headers={"content-type": "application/x-www-form-urlencoded", "authorization": "Basic " + key,
                                          "RqUID": str(uuid.uuid4()), "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30, context=giga_ctx()) as r:
        d = json.loads(r.read())
    _giga["token"], _giga["exp"] = d["access_token"], time.time() + 25 * 60
    return _giga["token"]


def ask(base, model, key, text, retries=6):
    body = json.dumps({"model": model, "max_tokens": 1500, "temperature": 0.7, **({"reasoning_effort": "low"} if "inceptionlabs" in base else {}),
                       "messages": [{"role": "user", "content": PROMPT + text[:1400]}]}).encode()
    for attempt in range(retries):
        try:
            giga = "giga.chat" in base or "sberbank" in base
            req = urllib.request.Request(base.rstrip("/") + "/chat/completions", data=body,
                                         headers={"content-type": "application/json", "authorization": "Bearer " + (giga_token(key) if giga else key)})
            with urllib.request.urlopen(req, timeout=90, context=giga_ctx() if giga else None) as r:
                content = json.loads(r.read())["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("пустой ответ модели")
            m = re.search(r"\[.*\]", content, re.S)
            items = json.loads(m.group(0)) if m else []
            flat = []
            for x in items:   # GigaChat иногда отвечает объектами {"запрос": "...", "язык": "..."}
                if isinstance(x, dict):
                    x = next((v for k, v in x.items() if isinstance(v, str) and k.lower() in ("запрос", "вопрос", "question", "query", "text")), "")
                if isinstance(x, str):
                    flat.append(x)
            return [x.strip() for x in flat if 8 <= len(x.strip()) <= 220][:3]
        except Exception as e:  # noqa: BLE001
            time.sleep((8 if '429' in str(e) else 1.5) * (attempt + 1))
            err = str(e)
    print("пропуск:", err[:80], file=sys.stderr)
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default="https://api.inceptionlabs.ai/v1")
    ap.add_argument("--model", default="mercury-3")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--cache", default="questions.cache.jsonl", help="имя файла кэша в --out (для каждого провайдера свой)")
    args = ap.parse_args()
    key = os.environ.get("AG_KEY")
    if not key:
        raise SystemExit("нужен AG_KEY")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cache_path = out / args.cache
    cache = {}
    if cache_path.exists():
        for r in rows(cache_path):
            cache[r["id"]] = r["questions"]
    # куски: уникальные positive doc/snippet с их сплитом
    chunks = {}
    for sp in ("train", "val", "test"):
        for r in rows(Path(args.data) / f"{sp}.jsonl"):
            if r["kind"] in ("doc", "snippet"):
                cid = hashlib.sha1(r["positive"].encode()).hexdigest()[:16]
                chunks.setdefault(cid, (sp, r))
    todo = [(cid, v) for cid, v in chunks.items() if cid not in cache]
    if args.limit:
        todo = todo[:args.limit]
    print(f"кусков: {len(chunks)}, уже есть: {len(cache)}, к генерации: {len(todo)}", flush=True)
    lock = threading.Lock()
    done = [0]
    f = cache_path.open("a", encoding="utf-8")

    def work(item):
        cid, (sp, r) = item
        qs = ask(args.base, args.model, key, r["positive"])
        with lock:
            if qs:
                cache[cid] = qs
                f.write(json.dumps({"id": cid, "questions": qs}, ensure_ascii=False) + "\n"); f.flush()
            done[0] += 1
            if done[0] % 100 == 0:
                print(f"{done[0]}/{len(todo)}", flush=True)

    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(work, todo))
    merged = {}
    for cp in sorted(out.glob("*.cache.jsonl")):
        for r in rows(cp):
            merged.setdefault(r["id"], []).extend(r["questions"])
    cache = merged
    # сборка data_v3: исходные пары + вопросы моделей (тот же сплит)
    for sp in ("train", "val", "test"):
        items = rows(Path(args.data) / f"{sp}.jsonl")
        extra = []
        for cid, (csp, r) in chunks.items():
            if csp != sp:
                continue
            for q in cache.get(cid, []):
                extra.append({"query": q, "positive": r["positive"], "source": r["source"], "kind": r["kind"] + "-q"})
        (out / f"{sp}.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items + extra), encoding="utf-8")
        print(sp, len(items), "+", len(extra))


if __name__ == "__main__":
    main()
