#!/usr/bin/env python3
"""Собрать AGENTS.md и README.md пакета из шаблонов tools/templates.

AGENTS.md короткий: документация лежит внутри бинарника, и файл объясняет,
как достать её командой ``r2d docs``. Рядом с бинарником каталога docs/ нет.

Один и тот же код использует упаковщик релиза (``tools/release.py``) и
локальный скрипт сборки (``build_and_push.command``) — вручную ничего собирать не
нужно.

Использование::

    # один файл конкретной платформы
    python3 tools/agents_doc.py --platform macos-arm64 \\
        --out dist/macos-arm64/AGENTS.md

    # обновить README.md и AGENTS.md во всех папках dist/<платформа>/
    python3 tools/agents_doc.py --all
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from typing import List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import release  # noqa: E402  (лежит рядом, в tools/)


def write_one(platform_name: str, out_path: str, version: str) -> int:
    """Собрать AGENTS.md для одной платформы в указанный файл."""
    if platform_name not in release.PLATFORMS:
        print("неизвестная платформа: %s (есть: %s)"
              % (platform_name, ", ".join(sorted(release.PLATFORMS))), file=sys.stderr)
        return 2
    text = release.render_agents_doc(platform_name, version)
    if not text:
        print("не найден шаблон tools/templates/AGENTS-platform.md", file=sys.stderr)
        return 2
    folder = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(folder, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(text)
    print("AGENTS.md: %s — %d КБ" % (out_path, len(text.encode("utf-8")) // 1024))
    return 0


def refresh_out_dir(out_dir: str, version: str) -> int:
    """Обновить README.md и AGENTS.md во всех dist/<платформа>/. """
    if not os.path.isdir(out_dir):
        print("каталог %s не найден — нечего обновлять" % out_dir, file=sys.stderr)
        return 1
    updated = 0
    for name in sorted(os.listdir(out_dir)):
        target = os.path.join(out_dir, name)
        if not os.path.isdir(target) or name not in release.PLATFORMS:
            continue
        # Refresh source documentation too, then regenerate checksums AND the
        # archive. Editing only AGENTS/README made dist differ from its tarball.
        # Рядом с бинарником нет ни документации, ни редактора, ни шаблонов, ни
        # ресурсов: всё это вшито в r2d. Каталоги от прежних сборок убираем,
        # чтобы они не уехали в архив.
        for stale in ('docs', 'editor', 'templates', 'assets', 'game'):
            stale_dir = os.path.join(target, stale)
            if os.path.isdir(stale_dir): shutil.rmtree(stale_dir)
        for source in release.package_root_entries():
            path = os.path.join(ROOT, source)
            if os.path.isfile(path):
                shutil.copy2(path, os.path.join(target, source))
        for source in release.DOC_FILES:
            if os.path.isfile(os.path.join(ROOT, source)):
                shutil.copy2(os.path.join(ROOT, source), os.path.join(target, source))
        release.render_platform_docs(target, name, version)
        entries=[]
        for folder, _, files in os.walk(target):
            for file in files:
                full=os.path.join(folder,file)
                rel=os.path.relpath(full,target)
                if rel != 'SHA256SUMS.txt':
                    entries.append((rel,release.sha256_file(full)))
        with open(os.path.join(target,'SHA256SUMS.txt'),'w') as out:
            out.write(''.join(sha+'  '+rel+'\n' for rel,sha in sorted(entries)))
        fmt=release.PLATFORMS[name][2]
        # Архив пересобираем тем же кодом, что и релиз (release.write_archive):
        # shutil.make_archive кладёт в архив текущее время файлов, и «та же
        # ревизия — тот же SHA256» перестаёт быть правдой ровно после
        # обновления документов.
        base=os.path.join(out_dir, release.archive_name(name, version))
        release.write_archive(target, base, fmt)
        agents = os.path.join(target, "AGENTS.md")
        if os.path.exists(agents):
            print("  %s — %d КБ" % (agents, os.path.getsize(agents) // 1024))
        updated += 1
    if updated == 0:
        print("в %s нет папок платформ" % out_dir, file=sys.stderr)
        return 1
    # Архивы платформ, которые тут обновлялись, обязаны носить единственное
    # актуальное имя: рядом со свежим архивом не должно остаться старого.
    for stale in release.prune_stale_archives(
            out_dir, [n for n in sorted(os.listdir(out_dir))
                      if os.path.isdir(os.path.join(out_dir, n))], version):
        print("  убран устаревший архив: %s" % stale)
    release._write_global_sums(out_dir)
    print("обновлено платформ и архивов: %d" % updated)
    return 0


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Собрать AGENTS.md/README.md из документации движка")
    parser.add_argument("--platform", help="платформа, например macos-arm64")
    parser.add_argument("--out", help="куда записать AGENTS.md")
    parser.add_argument("--all", action="store_true",
                        help="обновить README.md и AGENTS.md во всех dist/<платформа>/")
    parser.add_argument("--dir", default="dist", help="каталог сборок (по умолчанию dist)")
    parser.add_argument("--version", default=None, help="версия (по умолчанию из VERSION)")
    options = parser.parse_args(argv)

    version = options.version or release.read_version()

    if options.all:
        return refresh_out_dir(options.dir, version)

    if not options.platform or not options.out:
        parser.print_help()
        return 2
    return write_one(options.platform, options.out, version)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
