#!/usr/bin/env python3
"""Собрать AGENTS.md (и README.md) из шаблона и ВСЕЙ документации движка.

Список документов не задаётся руками: берутся все ``docs/*.md`` и
``docs/highlevel/*.md``, поэтому новый файл документации попадает в AGENTS.md
сам, и документ не может разойтись с текстами.

Один и тот же код использует упаковщик релиза (``tools/release.py``) и
локальный скрипт сборки (``build_and_push.sh``) — вручную ничего собирать не
нужно.

Использование::

    # один файл конкретной платформы
    python3 tools/agents_doc.py --platform macos-arm64 \\
        --out dist/macos-arm64/AGENTS.md

    # обновить документы во всех папках dist/<платформа>/
    python3 tools/agents_doc.py --all

    # посмотреть, какие документы попадут в приложение
    python3 tools/agents_doc.py --list
"""

from __future__ import annotations

import argparse
import os
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
    print("AGENTS.md: %s — %d КБ, документов %d"
          % (out_path, len(text.encode("utf-8")) // 1024,
             len(release.agents_doc_files())))
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
        release.render_platform_docs(target, name, version)
        agents = os.path.join(target, "AGENTS.md")
        if os.path.exists(agents):
            print("  %s — %d КБ" % (agents, os.path.getsize(agents) // 1024))
        updated += 1
    if updated == 0:
        print("в %s нет папок платформ" % out_dir, file=sys.stderr)
        return 1
    print("обновлено платформ: %d" % updated)
    return 0


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Собрать AGENTS.md/README.md из документации движка")
    parser.add_argument("--platform", help="платформа, например macos-arm64")
    parser.add_argument("--out", help="куда записать AGENTS.md")
    parser.add_argument("--all", action="store_true",
                        help="обновить README.md и AGENTS.md во всех dist/<платформа>/")
    parser.add_argument("--dir", default="dist", help="каталог сборок (по умолчанию dist)")
    parser.add_argument("--version", default=None, help="версия (по умолчанию из CMakeLists.txt)")
    parser.add_argument("--list", action="store_true", help="показать список документов")
    options = parser.parse_args(argv)

    version = options.version or release.read_version()

    if options.list:
        for name in release.agents_doc_files():
            print(name)
        print("всего документов: %d" % len(release.agents_doc_files()))
        return 0

    if options.all:
        return refresh_out_dir(options.dir, version)

    if not options.platform or not options.out:
        parser.print_help()
        return 2
    return write_one(options.platform, options.out, version)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
