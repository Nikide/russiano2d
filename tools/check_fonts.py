#!/usr/bin/env python3
"""Проверяет, что встроенные шрифты покрывают все символы интерфейса.

Зачем: LatoLatin — это подмножество только с латиницей. Если сослаться на него
в RCSS, весь русский текст в интерфейсе молча исчезнет: RmlUi не находит глиф
и ничего не рисует, без единой ошибки в консоли. Этот скрипт ловит такую
ситуацию до запуска.

    python3 tools/check_fonts.py

Код возврата 0 — всё покрыто, 1 — есть непокрытые символы.
"""

from __future__ import annotations

import glob
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, "assets", "fonts")

# Теги, содержимое которых рисовать не нужно.
SKIP_TAGS = re.compile(r"<(/?)(rml|head|body|div|span|p|h1|h2|h3|button|link|title)\b[^>]*>",
                       re.IGNORECASE)
STYLE_BLOCK = re.compile(r"<style.*?</style>", re.IGNORECASE | re.DOTALL)


def cmap_codepoints(path: str) -> set[int]:
    """Читает таблицу cmap TrueType/OpenType и возвращает набор кодпоинтов."""
    data = open(path, "rb").read()

    if data[:4] == b"ttcf":
        off = struct.unpack(">I", data[12:16])[0]
    else:
        off = 0

    num_tables = struct.unpack(">H", data[off + 4:off + 6])[0]
    cmap_off = None
    for i in range(num_tables):
        rec = off + 12 + i * 16
        if data[rec:rec + 4] == b"cmap":
            cmap_off = struct.unpack(">I", data[rec + 8:rec + 12])[0]
    if cmap_off is None:
        return set()

    n = struct.unpack(">H", data[cmap_off + 2:cmap_off + 4])[0]
    best = None
    for i in range(n):
        pid, eid, sub = struct.unpack(">HHI", data[cmap_off + 4 + i * 8:cmap_off + 12 + i * 8])
        if (pid, eid) == (3, 1):
            best = cmap_off + sub
            break
        if (pid, eid) in ((3, 10), (0, 3), (0, 4)) and best is None:
            best = cmap_off + sub

    if best is None:
        return set()

    fmt = struct.unpack(">H", data[best:best + 2])[0]
    cps: set[int] = set()

    if fmt == 4:
        seg_x2 = struct.unpack(">H", data[best + 6:best + 8])[0]
        seg = seg_x2 // 2
        ends = struct.unpack(">%dH" % seg, data[best + 14:best + 14 + seg_x2])
        starts = struct.unpack(">%dH" % seg, data[best + 16 + seg_x2:best + 16 + 2 * seg_x2])
        for i in range(seg):
            if starts[i] > ends[i] or ends[i] == 0xFFFF:
                continue
            cps.update(range(starts[i], ends[i] + 1))
    elif fmt == 12:
        ngroups = struct.unpack(">I", data[best + 12:best + 16])[0]
        for i in range(ngroups):
            s, e, _g = struct.unpack(">III", data[best + 16 + i * 12:best + 16 + i * 12 + 12])
            # Ограничиваем, чтобы не разворачивать огромные диапазоны CJK.
            cps.update(range(s, min(e, s + 40000) + 1))

    return cps


def collect_ui_chars() -> set[str]:
    """Собирает все символы, которые реально попадут в интерфейс."""
    chars: set[str] = set()
    patterns = [
        os.path.join(ROOT, "demos", "ui", "*.rml"),
        os.path.join(ROOT, "game", "ui", "*.rml"),
    ]
    for pattern in patterns:
        for path in glob.glob(pattern):
            text = open(path, encoding="utf-8").read()
            text = STYLE_BLOCK.sub("", text)
            text = SKIP_TAGS.sub("", text)
            chars.update(text)

    # Пробельные и служебные рисовать не нужно.
    chars -= set("\n\r\t")
    return chars


def font_family_name(path: str) -> str:
    """Возвращает имя семейства из таблицы name шрифта (nameID 1).

    Именно это имя нужно писать в RCSS: RmlUi сопоставляет font-family с ним,
    а не с именем файла. Ошибка в одну букву ('NotoSans' вместо 'Noto Sans')
    приводит к тому, что текст молча не рисуется.
    """
    data = open(path, "rb").read()
    off = struct.unpack(">I", data[12:16])[0] if data[:4] == b"ttcf" else 0

    num_tables = struct.unpack(">H", data[off + 4:off + 6])[0]
    name_off = None
    for i in range(num_tables):
        rec = off + 12 + i * 16
        if data[rec:rec + 4] == b"name":
            name_off = struct.unpack(">I", data[rec + 8:rec + 12])[0]
    if name_off is None:
        return ""

    count, string_off = struct.unpack(">HH", data[name_off + 2:name_off + 6])
    for i in range(count):
        rec = name_off + 6 + i * 12
        platform, _enc, _lang, name_id, length, offset = struct.unpack(">HHHHHH", data[rec:rec + 12])
        if name_id != 1:
            continue
        raw = data[name_off + string_off + offset:name_off + string_off + offset + length]
        try:
            # Платформы 0 (Unicode) и 3 (Windows) пишут в UTF-16BE.
            return raw.decode("utf-16-be") if platform in (0, 3) else raw.decode("mac-roman")
        except UnicodeDecodeError:
            continue
    return ""


def collect_rcss_families() -> dict[str, list[str]]:
    """Имена семейств, которые запрашивают стили: family -> откуда."""
    families: dict[str, list[str]] = {}
    patterns = [
        os.path.join(ROOT, "demos", "ui", "*.rcss"),
        os.path.join(ROOT, "game", "ui", "*.rcss"),
    ]
    for pattern in patterns:
        for path in glob.glob(pattern):
            text = open(path, encoding="utf-8").read()
            for value in re.findall(r"font-family\s*:\s*([^;]+);", text):
                # RmlUi НЕ поддерживает списки через запятую: всё значение —
                # это одно имя семейства, поэтому запятую не разбиваем.
                name = value.strip().strip('"').strip("'")
                families.setdefault(name, []).append(os.path.basename(path))
    return families


def main() -> int:
    fonts = sorted(glob.glob(os.path.join(FONT_DIR, "*.ttf")) +
                   glob.glob(os.path.join(FONT_DIR, "*.otf")))
    if not fonts:
        print(f"в {FONT_DIR} нет шрифтов", file=sys.stderr)
        return 1

    coverage: dict[str, set[int]] = {}
    families: dict[str, str] = {}
    for path in fonts:
        base = os.path.basename(path)
        try:
            coverage[base] = cmap_codepoints(path)
            families[base] = font_family_name(path)
        except Exception as exc:  # noqa: BLE001
            print(f"  не удалось прочитать {path}: {exc}", file=sys.stderr)

    # Иконки Material Design регистрируются в рантайме из встроенного шрифта,
    # файла в assets/fonts у них нет.
    runtime_families = {"Material Icons"}

    print("Шрифты:")
    for name, cps in sorted(coverage.items()):
        ru = sum(1 for c in range(0x0410, 0x0450) if c in cps)
        print(f"  {name:32s} семейство '{families.get(name, '?')}', "
              f"кириллица {ru:3d}/64, глифов {len(cps)}")

    failed = False

    # --- Проверка 1: имена семейств в стилях должны существовать ---
    known = set(families.values()) | runtime_families
    requested = collect_rcss_families()
    unknown = {n: f for n, f in requested.items() if n and n not in known}

    if unknown:
        failed = True
        print("\nНЕИЗВЕСТНЫЕ СЕМЕЙСТВА в font-family:")
        for name, files in sorted(unknown.items()):
            print(f"  '{name}' — {', '.join(sorted(set(files)))}")
        print(f"  Доступны: {', '.join(sorted(known))}")
        print("  RmlUi требует РОВНО имя из таблицы name шрифта; списки через "
              "запятую он не поддерживает.")

    # --- Проверка 2: глифы интерфейса должны быть покрыты ---
    union: set[int] = set()
    for cps in coverage.values():
        union |= cps

    chars = collect_ui_chars()
    missing = sorted(c for c in chars if ord(c) not in union and not c.isspace())

    print(f"\nСимволов в интерфейсе: {len(chars)}")
    if missing:
        failed = True
        print(f"НЕ ПОКРЫТЫ ({len(missing)}):")
        for c in missing:
            print(f"  U+{ord(c):04X} {c!r}")
        print("\nДобавьте шрифт с этими глифами в assets/fonts и укажите его "
              "в font-family соответствующего .rcss.")

    if failed:
        return 1

    print("Семейства в стилях известны, все символы интерфейса покрыты.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
