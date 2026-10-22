#!/usr/bin/env python3
"""r2d docs context: гибридный поиск (встроенная модель эмбеддингов + BM25) по докам, кирпичикам и API.

Без вшитой модели (сборка без models/r2d-embed.gguf) режим «bm25» — проверяются те же ожидания
для лексических запросов. Первый вызов с моделью строит кэш векторов (~минута).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = os.environ.get("R2D_BINARY") or str(ROOT / "build-xmake/macos-arm64/macosx/arm64/release/r2d")
failures = 0


def ctx(query, *extra):
    out = subprocess.run([BINARY, "docs", "context", query, "--limit", "5", "--quiet", *extra],
                         capture_output=True, text=True, timeout=600, cwd=ROOT)
    return json.loads(out.stdout)


def check(ok, label):
    global failures
    print(("  ok   " if ok else "  FAIL ") + label, flush=True)
    failures += 0 if ok else 1


first = ctx("прыжок платформер персонаж")
mode = first["mode"]
print("режим:", mode)
check(first["ok"] and first["chunks"], "ответ непустой")
check(any(c["kind"] == "snippet" and "movement.platformer" in c["path"] for c in first["chunks"]), "«прыжок платформер» → кирпичик movement.platformer")
check(any(c["path"].endswith("ai.chase/snippet.json") for c in ctx("враг преследует игрока")["chunks"]), "«враг преследует игрока» → ai.chase")
check(any(c["path"].endswith("ability.cooldown/snippet.json") for c in ctx("способность перезарядка")["chunks"]), "«способность перезарядка» → ability.cooldown")
http = ctx("как отправить http запрос")
check(any("http" in c["path"] for c in http["chunks"]), "«http запрос» → страница http")
check({c["kind"] for c in ctx("прыжок платформер")["chunks"]} <= {"doc", "snippet", "api"}, "у каждого куска есть тип doc/snippet/api")
bm = ctx("прыжок платформер персонаж", "--no-ai")
check(bm["mode"] == "bm25" and bm["chunks"], "--no-ai даёт чистый BM25")
if mode == "hybrid":
    check(len(first["chunks"]) == 5, "гибрид возвращает limit кусков")
print("ai_context_test:", "ПРОВАЛ" if failures else "все проверки пройдены")
sys.exit(1 if failures else 0)
