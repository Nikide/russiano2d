#!/usr/bin/env python3
"""Встроенный пакет движка: editor/, templates/, публичные docs/*.md и шрифты.

    embed_bundle.py <заголовок.h> [корень репозитория]

Собирает контейнер груза (формат src/payload.h, версия 1), сжимает zlib и пишет
C-заголовок с массивом байт. Движок распаковывает его при первом обращении
(`r2d_bundle()`, src/payload.c): так редактор, шаблоны и документация едут
внутри одного бинарника `r2d`, без каталогов рядом.

Раскладка путей внутри контейнера:
  * файлы редактора — от корня editor/ (main.js, lib/…, ui/…): они лежат ПЕРВЫМИ,
    чтобы относительные импорты и project.json находили именно их;
  * assets/fonts, assets/icons — встроенные ресурсы движка (как в base_path);
  * docs/…*.md — только публичные страницы (tools/public_docs.py);
  * templates/… — шаблоны проектов;
  * snippets/<id>/snippet.json — манифесты кирпичиков (поиск контекста агентом);
  * api.schema.json, russiano2d.d.ts — схема и типы `$` (r2d lint без файлов рядом).
Результат детерминирован: одинаковое дерево — одинаковые байты.
"""
from __future__ import annotations

import fnmatch
import os
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import public_docs  # noqa: E402

MAGIC = 0x50324452
VERSION = 1
ENTRY = "main.js"


def walk(root: Path, base: Path, prefix: str, only_ext: tuple[str, ...] | None = None):
    for dirpath, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not any(fnmatch.fnmatch(d, p) for p in public_docs.PACKAGE_IGNORE))
        for name in sorted(names):
            if any(fnmatch.fnmatch(name, p) for p in public_docs.PACKAGE_IGNORE):
                continue
            if only_ext and not name.endswith(only_ext):
                continue
            full = Path(dirpath) / name
            rel = full.relative_to(base).as_posix()
            yield prefix + rel, full


def collect(repo: Path):
    files: list[tuple[str, Path]] = []
    files += walk(repo / "editor", repo / "editor", "")
    files += walk(repo / "assets" / "fonts", repo, "")
    files += walk(repo / "assets" / "icons", repo, "")
    for path, full in walk(repo / "docs", repo, "", only_ext=(".md",)):
        if not public_docs.is_internal_doc(path):
            files.append((path, full))
    files += walk(repo / "templates", repo, "")
    # Манифесты кирпичиков (без исходников): каталог для `r2d docs context` и агента.
    for path, full in walk(repo / "snippets", repo, "", only_ext=("snippet.json",)):
        files.append((path, full))
    for name in ("api.schema.json", "russiano2d.d.ts"):   # схема $ для lint без файлов рядом
        if (repo / name).is_file():
            files.append((name, repo / name))
    seen: dict[str, Path] = {}
    for path, full in files:
        seen.setdefault(path, full)   # первый побеждает: редактор раньше шаблонов
    return list(seen.items())


def container(files) -> bytes:
    out = bytearray()
    entry = ENTRY.encode()
    out += struct.pack("<III", MAGIC, VERSION, len(entry)) + entry
    out += struct.pack("<I", len(files))
    for path, full in files:
        raw = path.encode("utf-8")
        data = full.read_bytes()
        out += struct.pack("<I", len(raw)) + raw + struct.pack("<I", len(data)) + data
    return bytes(out)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    out_path = Path(argv[1])
    repo = Path(argv[2]).resolve() if len(argv) > 2 else HERE.parent
    files = collect(repo)
    raw = container(files)
    packed = zlib.compress(raw, 9)
    lines = []
    for i in range(0, len(packed), 24):
        lines.append("    " + ",".join(str(b) for b in packed[i:i + 24]) + ",")
    text = (
        "// Сгенерировано tools/embed_bundle.py — не править руками.\n"
        "static const unsigned char r2d_bundle_data[] = {\n" + "\n".join(lines) + "\n};\n"
        f"static const unsigned long r2d_bundle_packed_size = {len(packed)}UL;\n"
        f"static const unsigned long r2d_bundle_raw_size = {len(raw)}UL;\n"
        f"static const int r2d_bundle_file_count = {len(files)};\n"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(out_path)
    print(f"bundle: {len(files)} файлов, {len(raw)} -> {len(packed)} байт")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
