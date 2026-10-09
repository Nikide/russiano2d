#!/usr/bin/env python3
"""Подставляет в index.html актуальные версию движка и размеры архивов.

Версия берётся из CMakeLists.txt (единственный источник правды), размеры —
из dist/*.tar.gz и dist/*.zip. Ничего не выдумывает: чего нет в dist/,
то и не подставляется.

Запуск: python3 site/sync-index.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent
ROOT = SITE.parent
INDEX = SITE / "index.html"


def read_version() -> str | None:
    text = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
    m = re.search(r"VERSION\s+(\d+\.\d+\.\d+)", text)
    return m.group(1) if m else None


def human_size(path: Path) -> str:
    mb = path.stat().st_size / (1024 * 1024)
    return f"{mb:.0f} МБ" if mb >= 10 else f"{mb:.1f} МБ"


def main() -> int:
    html = INDEX.read_text(encoding="utf-8")
    changed = []

    version = read_version()
    if version:
        html, n = re.subn(r'(class="ver">)v[\d.]+(<)', rf"\g<1>v{version}\g<2>", html)
        if n:
            changed.append(f"версия -> v{version} ({n} мест)")

    def sub_size(m: re.Match) -> str:
        name = m.group("name")
        path = ROOT / "dist" / name
        if not path.exists():
            print(f"  ! нет dist/{name} — размер не трогаю", file=sys.stderr)
            return m.group(0)
        size = human_size(path)
        changed.append(f"{name} -> {size}")
        return f'{m.group("head")}{size}</p>'

    html = re.sub(
        r'(?P<head><p class="dl-size" data-size="(?P<name>[^"]+)">)[^<]*(</p>)',
        sub_size,
        html,
    )

    if not changed:
        print("нечего обновлять")
        return 0
    INDEX.write_text(html, encoding="utf-8")
    for line in changed:
        print("  " + line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
