#!/usr/bin/env python3
"""Собирает содержимое site/doc/ из документации репозитория.

Что делает:
  1. копирует docs/*.md, docs/highlevel/*.md, docs/images/, docs/screenshots/;
  2. добавляет «внешние» документы: README.md, CHANGELOG, CONTRIBUTING,
     CODE_OF_CONDUCT, SECURITY, LICENSE, THIRD_PARTY_NOTICES, demos/*/README.md;
  3. переписывает ссылки под Docsify:
       * ссылки на документы -> хеш-маршруты вида #/HIGH_LEVEL_API
         (якоря #section у межстраничных ссылок отбрасываются: id заголовков
          в Docsify генерируются иначе, чем в GitVerse, и угадывать их нельзя);
       * ссылки на файлы исходников (src/…, tools/… , CMakeLists.txt) —
         абсолютные URL на репозиторий hub.mos.ru;
       * картинки -> абсолютные /doc/… (хеш-роутинг Docsify не меняет базу URL,
          поэтому относительные пути ломались бы на вложенных страницах);
  4. генерирует _sidebar.md с заголовками, взятыми из самих документов.

Запуск из корня репозитория:
    python3 site/build-doc.py
"""

from __future__ import annotations

import datetime as dt
import posixpath
import re
import shutil
import sys
from urllib.parse import unquote, quote
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / "site"
DOC = SITE / "doc"

REPO_BLOB = "https://github.com/Nikide/russiano2d/blob/main/"
REPO_TREE = "https://github.com/Nikide/russiano2d/tree/main/"

# repo-относительный путь -> маршрут Docsify
SOURCES: dict[str, str] = {}
for p in sorted((REPO / "docs").glob("*.md")):
    SOURCES[f"docs/{p.name}"] = p.name[:-3]
for p in sorted((REPO / "docs" / "highlevel").glob("*.md")):
    if p.name.startswith("_"): continue
    SOURCES[f"docs/highlevel/{p.name}"] = f"highlevel/{p.name[:-3]}"
for p in sorted((REPO / "docs" / "internal").glob("*.md")):
    SOURCES[f"docs/internal/{p.name}"] = f"internal/{p.name[:-3]}"
for p in sorted((REPO / "docs" / "ci-archive").glob("*.md")):
    SOURCES[f"docs/ci-archive/{p.name}"] = f"ci-archive/{p.name[:-3]}"
for extra, route in [
    ("README.md", "overview"),
    ("CHANGELOG.md", "CHANGELOG"),
    ("CONTRIBUTING.md", "CONTRIBUTING"),
    ("CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT"),
    ("SECURITY.md", "SECURITY"),
    ("LICENSE", "LICENSE"),
    ("THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES"),
]:
    if (REPO / extra).exists():
        SOURCES[extra] = route
for d in sorted((REPO / "demos").glob("*/README.md")):
    SOURCES[f"demos/{d.parent.name}/README.md"] = f"demos/{d.parent.name}"
if (REPO / "demos/assets/CREDITS.md").exists():
    SOURCES["demos/assets/CREDITS.md"] = "demos/assets/CREDITS"

# картинки: repo-путь -> путь внутри site/doc
IMAGES: dict[str, str] = {}
for sub in ("images", "screenshots"):
    for p in sorted((REPO / "docs" / sub).glob("*")):
        if p.is_file():
            IMAGES[f"docs/{sub}/{p.name}"] = f"{sub}/{p.name}"
# Иконка сайта нужна обложке Docsify: она должна лежать внутри /doc/,
# потому что docsify резолвит картинки от каталога текущей страницы.
if (SITE / "img" / "icon.png").exists():
    IMAGES["site/img/icon.png"] = "images/icon.png"

LINK_RE = re.compile(r"(!?\[[^\]]*\]\()([^)\s]+)(\))")
IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\ssrc=")([^"]+)(")')
HEAD_RE = re.compile(r"^#\s+(.*)$", re.M)


def title_of(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    m = HEAD_RE.search(text)
    if not m:
        return path.stem
    t = m.group(1).strip()
    t = re.sub(r"[*`]", "", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    return t


def rewrite_md(text: str, origin: str, route: str) -> str:
    """origin — путь файла относительно корня репозитория, route — маршрут в Docsify.

    Правила Docsify (проверены на живом docsify 4, hash-роутинг, basePath /doc/):
      * ссылка `[x](маршрут)` резолвится ОТ КОРНЯ доков, поэтому из вложенной
        страницы нужен полный маршрут (`highlevel/anim`), а не сосед по папке;
      * `[x](#/маршрут)` и `[x](/doc/#/маршрут)` docsify превращает в якорь
        текущей страницы (`?id=…`) — так ссылаться нельзя;
      * картинка резолвится ОТ КАТАЛОГА ТЕКУЩЕЙ СТРАНИЦЫ, поэтому путь считается
        относительно маршрута страницы (`../images/…` из `highlevel/`);
      * абсолютные пути в сыром HTML docsify не трогает — этим пользуемся
        в _coverpage.md, _navbar.md и _404.md.
    """
    origin_dir = posixpath.dirname(origin)
    page_dir = posixpath.dirname(route)

    def resolve(target: str) -> str:
        return posixpath.normpath(posixpath.join(origin_dir, target))

    def candidates(target: str) -> list[str]:
        """Варианты трактовки относительной ссылки.

        В документации часть ссылок написана от корня репозитория, хотя файл
        лежит в подкаталоге (например, `../demos/...` из `docs/highlevel/`).
        Поэтому пробуем и обычный разбор, и разбор от корня, и со снятыми `../`.
        """
        out = [resolve(target)]
        flat = target.lstrip("./")
        while flat.startswith("../"):
            flat = flat[3:]
        for cand in (posixpath.normpath(target), flat):
            if cand not in out:
                out.append(cand)
        return out

    def sub(m: re.Match) -> str:
        prefix, target, suffix = m.group(1), m.group(2), m.group(3)
        is_image = prefix.startswith("!")

        if re.match(r"^(https?:|mailto:|data:|//)", target):
            return m.group(0)
        if target.startswith("#"):
            return m.group(0)  # якорь внутри страницы — Docsify сам разберётся

        anchor = ""
        if "#" in target:
            target, anchor = target.split("#", 1)

        cands = candidates(unquote(target))

        # картинка: путь относительно каталога текущей страницы
        if is_image:
            for c in cands:
                if c in IMAGES:
                    href = posixpath.relpath(IMAGES[c], page_dir or ".")
                    return f"{prefix}{href}{suffix}"
            print(f"  ! картинка не найдена: {target} (в {origin})", file=sys.stderr)
            return m.group(0)

        # внутренний документ -> маршрут от корня доков (docsify так и резолвит)
        if target.endswith(".md") or any(c in SOURCES for c in cands):
            for c in cands:
                if c in SOURCES:
                    return f"{prefix}{SOURCES[c]}{suffix}"
            for c in cands:
                if (REPO / c).is_file():
                    return f"{prefix}{REPO_BLOB}{quote(c)}{suffix}"
            print(f"  ! документ не найден: {target} (в {origin})", file=sys.stderr)
            return m.group(0)

        # файл репозитория -> ссылка на hub.mos.ru
        resolved = cands[0]
        for c in cands:
            if (REPO / c).exists():
                resolved = c
                break
        base = REPO_TREE if target.endswith("/") else REPO_BLOB
        return f"{prefix}{base}{resolved}{suffix}"

    def sub_img(m: re.Match) -> str:
        prefix, target, suffix = m.group(1), m.group(2), m.group(3)
        if re.match(r"^(https?:|data:|//)", target):
            return m.group(0)
        for c in candidates(target):
            if c in IMAGES:
                href = posixpath.relpath(IMAGES[c], page_dir or ".")
                return f"{prefix}{href}{suffix}"
        print(f"  ! картинка в <img> не найдена: {target} (в {origin})", file=sys.stderr)
        return m.group(0)

    text = LINK_RE.sub(sub, text)
    return IMG_SRC_RE.sub(sub_img, text)


def main() -> int:
    DOC.mkdir(parents=True, exist_ok=True)

    keep = {"index.html", "custom.css", "README.md", "_sidebar.md", "_coverpage.md",
            "_404.md", "_navbar.md", "vendor", ".nojekyll"}
    for child in DOC.iterdir():
        if child.name in keep:
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()

    written: list[str] = []
    for src, route in SOURCES.items():
        text = rewrite_md((REPO / src).read_text(encoding="utf-8", errors="replace"), src, route)
        dest = DOC / (route + ".md")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        written.append(route)

    for src, rel in IMAGES.items():
        dest = DOC / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / src, dest)

    (DOC / 'README.md').write_text((DOC / 'overview.md').read_text())
    (DOC / '_coverpage.md').write_text("""# Russiano2D

> Игры — код и данные. Ядро C, публичный API `$`, интерфейсы RmlUi.

Движок и SDK: справочник API, инструменты ассетов, сборка и примеры.

[Первая игра](tutorial-first-game)
[SDK](SDK)
[Справочник `$`](HIGH_LEVEL_API)
<a href="/">Главная сайта</a>
""")
    (DOC / '_navbar.md').write_text("""* <a href="/">Главная сайта</a>
* [Исходники](https://github.com/Nikide/russiano2d)
* [Релизы](https://github.com/Nikide/russiano2d/releases)
* [SDK](SDK)
""")
    write_sidebar()
    write_sitemap()
    version = re.search(r"project\(russiano2d\s+VERSION\s+([0-9.]+)", (REPO / 'CMakeLists.txt').read_text()).group(1)
    (SITE / 'llms.txt').write_text(f"# Russiano2D {version}\n\nC → `$`; RmlUi UI; native C SDK.\n\n" + '\n'.join(f"- [{title_of(REPO / src)}](https://r2d.nikiniki.ru/doc/#/{route})" for src, route in SOURCES.items()) + '\n')
    (SITE / 'llms-full.txt').write_text('\n\n'.join((DOC / (route + '.md')).read_text() for route in SOURCES.values()))
    print(f"готово: {len(written)} документов, {len(IMAGES)} картинок -> {DOC}")
    return 0


SITE_URL = "https://r2d.nikiniki.ru"


def write_sitemap() -> None:
    """Карта сайта: главная, страницы документации и машинные манифесты.

    Адреса документов — это реальные .md-файлы (Docsify отдаёт их как есть),
    поэтому в карту идут именно они: хеш-маршруты `#/Имя` для поисковика не
    отдельные страницы. `lastmod` берётся из файла-источника.
    """
    entries: list[tuple[str, str, str]] = []   # loc, lastmod, priority

    def add(loc: str, src: Path, priority: str) -> None:
        try:
            stamp = dt.date.fromtimestamp(src.stat().st_mtime).isoformat()
        except OSError:
            stamp = dt.date.today().isoformat()
        entries.append((loc, stamp, priority))

    add(f"{SITE_URL}/", SITE / "index.html", "1.0")
    add(f"{SITE_URL}/doc/", DOC / "index.html", "0.9")
    for src, route in sorted(SOURCES.items(), key=lambda kv: kv[1]):
        add(f"{SITE_URL}/doc/{route}.md", REPO / src, "0.8" if "/" not in route else "0.6")
    add(f"{SITE_URL}/llms.txt", SITE / "llms.txt", "0.4")
    add(f"{SITE_URL}/llms-full.txt", SITE / "llms-full.txt", "0.4")

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod, priority in entries:
        out.append("  <url>")
        out.append(f"    <loc>{loc}</loc>")
        out.append(f"    <lastmod>{lastmod}</lastmod>")
        out.append(f"    <priority>{priority}</priority>")
        out.append("  </url>")
    out.append("</urlset>")
    (SITE / "sitemap.xml").write_text("\n".join(out) + "\n", encoding="utf-8")


def write_sidebar() -> None:
    groups: list[tuple[str, list[str]]] = [
        ("Начало", ["overview", "tutorial-first-game", "ARCHITECTURE"]),
        ("Справочники", ["HIGH_LEVEL_API", "API", "AGENT_API", "API_PERFORMANCE", "HIGH_LEVEL_API_PERF"]),
        ("Подсистемы <code>$</code>", sorted(r for r in SOURCES.values() if r.startswith("highlevel/"))),
        ("Практика", ["tutorial-platformer", "tutorial-menus", "demos",
                      "demos/platformer", "demos/shooter_witch", "demos/russi_vn",
                      "BUILD", "WEB_EXPORT", "demos/assets/CREDITS"]),
        ("Внутреннее и разработка", ["internal/NATIVE", "SDK", "SDK_VERIFICATION", "TASKS", "RELEASING"]),
        ("Проект", ["CHANGELOG", "CONTRIBUTING", "CODE_OF_CONDUCT", "SECURITY",
                    "LICENSE", "THIRD_PARTY_NOTICES"]),
    ]
    by_route = {route: src for src, route in SOURCES.items()}

    out = ["<!-- Сгенерировано site/build-doc.py — руками не править. -->", ""]
    for name, routes in groups:
        out.append(f"* **{name}**")
        for route in routes:
            if route not in by_route:
                continue
            title = title_of(REPO / by_route[route])
            if route.startswith("highlevel/"):
                stem = route.split("/", 1)[1]
                # в самих файлах заголовок часто повторяет имя: «anim — $.anim — …»
                title = re.sub(rf"^{re.escape(stem)}\s+—\s+", "", title)
            out.append(f"  * [{title}]({route})")
        out.append("")
    (DOC / "_sidebar.md").write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
