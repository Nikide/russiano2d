#!/usr/bin/env python3
# ===========================================================================
# Сборка: встроенный JavaScript совпадает с исходниками.
#
# Зачем: движок не читает `src/highlevel/*.js` с диска — сборка встраивает их
# в бинарник (`build/generated/r2d_js_data.h`). Если этот шаг отстал или
# испортил escaping, движок падает на старте с «SyntaxError» или «$ не
# определён», а исходники при этом выглядят целыми. Такой случай уже был:
# правки модулей шли параллельно сборке, и один прогон поймал битый бандл.
#
# Тест сверяет КАЖДЫЙ встроенный модуль с файлом на диске побайтово (в
# терминах исходного текста) и отдельно проверяет, что набор модулей совпадает
# с набором файлов (минус явно исключённые).
#
# Запуск:
#   python3 tests/embed_sync_test.py
#   R2D_EMBED_HEADER=build-2d/generated/r2d_js_data.h python3 tests/embed_sync_test.py
# ===========================================================================

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HEADER = (os.environ.get("R2D_EMBED_HEADER")
          or next((p for p in (os.path.join("build-xmake", "generated", "r2d_js_data.h"),
                               os.path.join("build", "generated", "r2d_js_data.h"))
                   if os.path.exists(p)),
                  os.path.join("build-xmake", "generated", "r2d_js_data.h")))
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def decode_literal(lit):
    """Склеить C-строковые литералы блока в исходный текст.

    В C кириллица выходит восьмеричными escape (`\320\277`), то есть байтами.
    Поэтому собираем БАЙТЫ и декодируем UTF-8 — иначе сравнение ломается на
    первом же русском комментарии, и тест «падал» бы всегда.
    """
    buf = bytearray()
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', lit):
        chunk = m.group(1)
        i = 0
        while i < len(chunk):
            ch = chunk[i]
            if ch != "\\":
                buf.extend(ch.encode("utf-8"))
                i += 1
                continue
            nxt = chunk[i + 1] if i + 1 < len(chunk) else ""
            simple = {"n": b"\n", "t": b"\t", "r": b"\r", '"': b'"', "?": b"?", "\\": b"\\",
                      "'": b"'", "0": b"\0", "a": b"\a", "b": b"\b", "f": b"\f", "v": b"\v"}
            if nxt in simple:
                buf.extend(simple[nxt])
                i += 2
                continue
            if nxt in "01234567":
                j = i + 1
                digits = ""
                while j < len(chunk) and len(digits) < 3 and chunk[j] in "01234567":
                    digits += chunk[j]
                    j += 1
                buf.append(int(digits, 8) & 0xFF)
                i = j
                continue
            if nxt == "x":
                j = i + 2
                digits = ""
                while j < len(chunk) and chunk[j] in "0123456789abcdefABCDEF":
                    digits += chunk[j]
                    j += 1
                buf.append(int(digits or "0", 16) & 0xFF)
                i = j
                continue
            buf.extend(nxt.encode("utf-8"))
            i += 2
    return buf.decode("utf-8", "replace")


def main():
    header_path = os.path.join(ROOT, HEADER)
    print("== Встроенный JavaScript: %s ==" % HEADER)
    if not os.path.exists(header_path):
        print("  пропуск: заголовка нет (соберите движок)")
        return 0

    with open(header_path, encoding="utf-8") as f:
        header = f.read()

    modules = dict(re.findall(r'\{\s*"r2d/([^"]+)",\s*r2d__js_(\d+)\s*\}', header))
    by_index = {int(v): k for k, v in modules.items()}
    blocks = re.findall(r"static const char r2d__js_(\d+)\[\] =\s*(.*?);\n", header, re.S)

    check(bool(blocks), "в заголовке есть встроенные модули (%d)" % len(blocks))

    mismatched = []
    missing = []
    for idx, lit in blocks:
        name = by_index.get(int(idx))
        if name is None:
            missing.append("<индекс %s без имени>" % idx)
            continue
        path = os.path.join(ROOT, "src", "highlevel", name)
        if not os.path.exists(path):
            missing.append(name)
            continue
        with open(path, encoding="utf-8") as f:
            source = f.read()
        embedded = decode_literal(lit)
        if embedded != source:
            # Показываем первое расхождение — по нему видно, отстал бандл или
            # испортился escaping.
            for i, (a, b) in enumerate(zip(embedded, source)):
                if a != b:
                    mismatched.append((name, i, repr(a), repr(b)))
                    break
            else:
                mismatched.append((name, min(len(embedded), len(source)),
                                   "длина %d" % len(embedded), "длина %d" % len(source)))

    check(not missing, "у каждого встроенного модуля есть файл-исходник (нет: %s)" % (missing[:5] or "ничего"))
    for name, pos, got, want in mismatched[:5]:
        print("  FAIL %s: расхождение на позиции %d (%s ≠ %s) — пересоберите движок"
              % (name, pos, got, want))
    check(not mismatched, "встроенный код совпадает с src/highlevel/*.js (расхождений: %d)" % len(mismatched))

    # Набор файлов не должен быть шире встроенного набора (иначе кто-то добавил
    # модуль, но не пересобрал).
    on_disk = sorted(f for f in os.listdir(os.path.join(ROOT, "src", "highlevel")) if f.endswith(".js"))
    excluded = set(re.findall(r'"([^"]+\.js)"', header[header.find("r2d_js_module_excluded"):]
                               if "r2d_js_module_excluded" in header else ""))
    embedded_names = set(modules)
    extra = [f for f in on_disk if f not in embedded_names and f not in excluded]
    check(not extra, "все модули src/highlevel встроены или явно исключены (лишние: %s)" % (extra[:5] or "ничего"))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
