#!/usr/bin/env python3
"""Встроенный пакет: бинарник r2d один, без editor/ docs/ templates/ рядом.

Копирует r2d в пустой каталог и проверяет: `r2d docs list|show|search`,
`r2d lint` со встроенной схемой `$` и запуск редактора из бинарника.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BINARY = os.environ.get("R2D_BINARY") or "build-xmake/macos-arm64/macosx/arm64/release/r2d"
BINARY = BINARY if os.path.isabs(BINARY) else os.path.join(ROOT, BINARY)
FAILURES = []


def check(ok, label):
    print(("  ok   " if ok else "  FAIL ") + label)
    if not ok:
        FAILURES.append(label)


def run(binary, *args, cwd, timeout=60):
    return subprocess.run([binary, *args], cwd=cwd, capture_output=True, text=True, encoding='utf-8', timeout=timeout)


with tempfile.TemporaryDirectory(prefix="r2d-bundle-") as tmp:
    exe = os.path.join(tmp, "r2d")
    shutil.copy2(BINARY, exe)
    for name in ("editor", "docs", "templates", "api.schema.json"):
        check(not os.path.exists(os.path.join(tmp, name)), f"рядом с бинарником нет {name}")

    listing = json.loads(run(exe, "docs", "list", cwd=tmp).stdout)
    check(listing["ok"] and listing["count"] > 100, f"docs list: {listing.get('count')} страниц")
    check(all(d["path"].startswith("docs/") for d in listing["docs"]), "docs list: только docs/*.md")
    check(not any("/internal/" in d["path"] for d in listing["docs"]), "внутренние документы не встроены")

    page = json.loads(run(exe, "docs", "show", "highlevel/ui", cwd=tmp).stdout)
    check(page["ok"] and "$.ui" in page["text"], "docs show highlevel/ui")
    check(json.loads(run(exe, "docs", "show", "nope", cwd=tmp).stdout)["code"] == "SDK_DOCS_NOT_FOUND",
          "docs show: нет страницы — код SDK_DOCS_NOT_FOUND")
    hit = json.loads(run(exe, "docs", "search", "палитра", "--limit", "3", cwd=tmp).stdout)
    check(hit["ok"] and 0 < hit["count"] <= 3, "docs search находит русский текст без учёта регистра")

    proj = os.path.join(tmp, "proj")
    os.makedirs(proj)
    open(os.path.join(proj, "main.js"), "w").write("$.ready(() => { $('<sprite>'); });\n")
    lint = json.loads(run(exe, "lint", proj, cwd=tmp).stdout)
    check(lint["ok"], "lint работает со встроенной схемой api.schema.json")

    env = dict(os.environ, R2D_EDITOR_BUILTIN="1")
    shot = os.path.join(tmp, "shot.png")
    res = subprocess.run([exe, "edit", proj, "--headless", "--seconds", "2", "--screenshot", shot,
                          "--screenshot-at", "1"], cwd=tmp, env=env, capture_output=True, text=True, timeout=90)
    err = res.stdout + res.stderr
    check("скрипты не загрузились" not in err and "SyntaxError" not in err, "редактор стартует из встроенного пакета")
    check(os.path.exists(shot) and os.path.getsize(shot) > 20000, "редактор нарисовал кадр")

if FAILURES:
    print("ПРОВАЛЕНО: %d" % len(FAILURES))
    sys.exit(1)
print("Все проверки пройдены")
