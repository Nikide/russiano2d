#!/usr/bin/env python3
# ===========================================================================
# Регрессия task-33: груз игры + освобождение указателей ВНУТРЬ груза.
#
# Симптом (до фикса): standalone-сборка с ассетами падала SIGABRT (код 134) —
# `malloc: pointer being freed was not allocated`. Стек (lldb):
#
#   #0 ___BUG_IN_CLIENT_OF_LIBMALLOC_POINTER_BEING_FREED_WAS_NOT_ALLOCATED
#   #1 js_load + 776                          (src/real2d4.c, load .r2d4)
#   #2 js_call_c_function → JS_CallInternal … → r2d_script_call_update
#
# Причина одна на два места: `r2d_vfs_read()` для собранной игры возвращает
# указатель ВНУТРЬ буфера груза (владелец — груз, освобождать нельзя), а код
# звал `free()`. Штатный способ — `r2d_vfs_free()`: для указателя из груза это
# no-op, для буфера с диска — SDL_free.
#
#   * src/real2d4.c `js_load`  — 4 × free(bytes) → r2d_vfs_free(bytes);
#   * src/font.c               — free(data)/free(font->data) в загрузке,
#                                перезагрузке и в r2d_font_shutdown.
#
# Тест проверяет ОБА места и оба сценария (первая загрузка и повторная/выход),
# потому что класс ошибки прячется за «первый раз работает»:
#   1. демо real2d standalone: контейнер `.r2d4` лежит в грузе → запуск
#      headless (3 прогона) обязан завершиться кодом 0, и отдельно —
#      `$.real2d.load()` из груза через агентский протокол;
#   2. шрифт из груза: `engine.loadFont()`, повторная загрузка того же имени,
#      `reloadTexture()` для текстуры из груза и ЧИСТЫЙ ВЫХОД (до фикса выход
#      после шрифта из груза давал код -6: r2d_font_shutdown освобождал
#      указатель внутрь груза).
#
# Запуск (после сборки):
#   python3 tests/agent/real2d_payload_crash_test.py
# ===========================================================================

import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

BINARY = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
REAL2D_DEMO = os.path.join(ROOT, "demos", "real2d")
TEXT_FIXTURE = os.path.join(ROOT, "tests", "fixtures", "text")

R2D4_ASSET = "assets/head_real2d_v4.r2d4"          # контейнер RE2D v4 из груза
TTF_ASSET = "assets/fonts/NotoSans-Regular.ttf"    # шрифт из груза
PNG_ASSET = "assets/tiles.png"                     # текстура из груза

CRASH_MARK = "pointer being freed was not allocated"
RUNS = 3

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def note(message):
    print("  --   " + message)


# ---------------------------------------------------------------------------
# Сторож владения указателями VFS (task-33, пункт 2 решения Lead)
#
# Класс ошибки, из-за которой был P0: указатель, полученный из r2d_vfs_read,
# освобождают через free()/SDL_free() вместо r2d_vfs_free(). Сторож читает
# исходники и падает на НОВОМ таком месте — дешевле, чем надежда «все помнят».
#
# Правила (обе формы реального дефекта):
#   R1 — в одной функции `v = r2d_vfs_read(...)`, а перед `free(v)`/`SDL_free(v)`
#        ближайшее присваивание в v — тоже r2d_vfs_read (так падала загрузка
#        .r2d4 в real2d4.c);
#   R2 — указатель утёк через `return v` из функции, а вызывающий его
#        освобождает (так падал шрифт: read_font_file → r2d_font_load/shutdown).
#
# Ветки, где указатель свой, сторож понимает сам, без allowlist: если ближайшее
# присваивание перед free() — malloc/SDL_malloc/SDL_LoadFile, значит в этой
# ветке владелец известен и освобождение законно (так устроены
# re2d_world_runtime.c и ветка диска в real2d4.c). Число таких пропусков
# печатается, чтобы «законных» не становилось молча больше.
VFS_READ = "r2d_vfs_read"
ALLOC_RE = r"(?:SDL_malloc|malloc|calloc|realloc|SDL_LoadFile|SDL_strdup|strdup)\s*\("

FREE_CALL = r"(?<![\w.])(?:SDL_free|free)\s*\(\s*%s\s*\)"


def _strip_comments(text):
    """Убрать // и /* */ — иначе сторож ловит примеры из комментариев."""
    out = []
    i, n = 0, len(text)
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif text[i] == '"' or text[i] == "'":
            quote = text[i]
            out.append(text[i])
            i += 1
            while i < n:
                if text[i] == "\\":
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                out.append(text[i])
                if text[i] == quote:
                    i += 1
                    break
                i += 1
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def _functions(text):
    """[(имя, тело, номер первой строки тела)] — разбор по скобкам, без парсера C.

    Понимает оба стиля скобки: `int f(...) {` и `int f(...)` + `{` на следующей
    строке (в этом дереве второй стиль — основной, и без него сторож не видел
    бы, например, `read_font_file`, через которую утекал указатель из груза).
    """
    out = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        head_ok = ("(" in stripped
                   and ";" not in stripped.split("(")[0]
                   and not stripped.startswith(("if", "for", "while", "switch",
                                                "else", "do", "}", "{", ")")))
        start = None
        if head_ok:
            if stripped.endswith("{"):
                start = i                       # стиль K&R: int f(...) {
            else:
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines) and lines[j].strip() == "{":
                    start = j                   # стиль Allman: int f(...) \n {
        if start is not None:
            code = stripped[:-1].rstrip() if stripped.endswith("{") else stripped
            if not code.endswith(")"):
                i += 1
                continue
            head = code.rsplit("(", 1)[0].strip()
            name = head.split()[-1].lstrip("*") if head.split() else ""
            if not re.fullmatch(r"[A-Za-z_]\w*", name):
                i += 1
                continue
            depth = 0
            body_lines = []
            j = start
            started = False
            while j < len(lines):
                depth += lines[j].count("{") - lines[j].count("}")
                body_lines.append(lines[j])
                if "{" in lines[j]:
                    started = True
                if started and depth <= 0:
                    break
                j += 1
            out.append((name, "\n".join(body_lines), start + 1))
            i = j + 1
            continue
        i += 1
    return out


def _owner_before(body, var, position):
    """Чей указатель в var непосредственно перед позицией: 'vfs', 'own' или None.

    «Свой» засчитывается только когда присваивание из malloc/диска отделено от
    free() без закрывающей скобки блока: `bytes = malloc(...); if (...) { free(bytes); }`
    — своя ветка. Если же между ними блок закрылся (`} else { bytes = malloc(...); }`
    … `free(bytes);`), то на пути мимо ветки в переменной лежит указатель из
    груза — это нарушение: ровно так падал `real2d4.c`.
    """
    pattern = r"\b%s\s*=\s*([^;]*)" % re.escape(var)
    last_alloc = None
    seen_vfs = False
    for match in re.finditer(pattern, body[:position]):
        rhs = match.group(1)
        if re.search(VFS_READ, rhs):
            seen_vfs = True
        elif re.search(ALLOC_RE, rhs):
            last_alloc = match
    if last_alloc is not None and "}" not in body[last_alloc.end():position]:
        return "own"                      # присваивание в этой же ветке, до закрытия блока
    if seen_vfs or last_alloc is not None:
        return "vfs"                      # ветка могла не выполниться — указатель чужой
    return None


def scan_vfs_ownership(root):
    """Нарушения контракта VFS: [(файл, строка, переменная, функция, правило)].

    Возвращает (нарушения, файлов, функций-поставщиков, законных веток)."""
    files = sorted(f for f in os.listdir(root) if f.endswith(".c"))
    parsed = {}
    for name in files:
        path = os.path.join(root, name)
        with open(path, encoding="utf-8", errors="replace") as handle:
            parsed[name] = _functions(_strip_comments(handle.read()))

    # R2-подготовка: какие функции возвращают указатель из груза.
    returns_borrowed = set()
    for _name, funcs in parsed.items():
        for fname, body, _line in funcs:
            for var in set(re.findall(r"(\w+)\s*=\s*%s\s*\(" % VFS_READ, body)):
                if re.search(r"return\s+%s\s*;" % re.escape(var), body):
                    returns_borrowed.add(fname)

    owned_branches = 0
    violations = []
    for name, funcs in sorted(parsed.items()):
        for fname, body, line0 in funcs:
            borrowed = set(re.findall(r"(\w+)\s*=\s*%s\s*\(" % VFS_READ, body))
            # R1: free() там, где перед этим в переменную положили указатель из груза.
            for var in borrowed:
                for match in re.finditer(FREE_CALL % re.escape(var), body):
                    line_no = line0 + body[:match.start()].count("\n")
                    line_text = body.splitlines()[line_no - line0].strip()
                    if re.search(r"r2d_vfs_free\s*\(\s*%s\s*\)" % re.escape(var), line_text):
                        owned_branches += 1      # ветка сама выбирает способ (if (packed) …)
                        continue
                    owner = _owner_before(body, var, match.start())
                    if owner == "own":
                        owned_branches += 1      # в этой ветке указатель свой (malloc/диск)
                        continue
                    if owner != "vfs":
                        continue                 # не разобрались — не выдумываем нарушение
                    violations.append((name, line_no, var, fname,
                                       "R1: free() указателя из груза"))
            # R2: вызывающий освобождает то, что вернула функция с указателем из груза
            for producer in sorted(returns_borrowed):
                for match in re.finditer(r"(\w+)\s*=\s*%s\s*\(" % re.escape(producer), body):
                    var = match.group(1)
                    for free_match in re.finditer(FREE_CALL % re.escape(var), body):
                        line_no = line0 + body[:free_match.start()].count("\n")
                        violations.append((name, line_no, var, fname,
                                           "R2: free() того, что вернул %s()" % producer))
    return violations, len(files), len(returns_borrowed), owned_branches


def guard_self_test():
    """Подложенный пример: сторож обязан найти обе формы дефекта."""
    import tempfile
    work = tempfile.mkdtemp(prefix="r2d_vfs_guard_")
    try:
        bad = os.path.join(work, "planted_bad.c")
        with open(bad, "w", encoding="utf-8") as handle:
            handle.write(
                "// Подложенный пример: обе формы P0 (в дерево не попадает)\n"
                "// Поставщик — стиль «скобка на следующей строке», как в font.c\n"
                "static unsigned char *read_thing(const char *p, size_t *n)\n"
                "{\n"
                "    unsigned char *data = r2d_vfs_read(p, n);\n"
                "    return data;\n"
                "}\n"
                "int use_thing(const char *p) {\n"
                "    size_t n = 0;\n"
                "    unsigned char *bytes = r2d_vfs_read(p, &n);\n"
                "    if (!bytes) { free(bytes); return -1; }\n"
                "    unsigned char *copy = read_thing(p, &n);\n"
                "    SDL_free(copy);\n"
                "    // Ветка, где указатель свой: нарушением быть не должно.\n"
                "    unsigned char *mine = (unsigned char *)malloc(4);\n"
                "    free(mine);\n"
                "    return 0;\n"
                "}\n"
                "// Пример в комментарии не должен считаться: free(bytes) тут просто текст\n")
        violations, _files, _ret, _owned = scan_vfs_ownership(work)
        kinds = sorted({v[4].split(":")[0] for v in violations})
        note("подложенный пример: найдено нарушений %d (%s), законных веток %d"
             % (len(violations), kinds, _owned))
        for v in violations:
            note("   %s:%s %s в %s() — %s" % (v[0], v[1], v[2], v[3], v[4]))
        check(len(violations) == 2 and kinds == ["R1", "R2"],
              "сторож видит подложенные R1 и R2 и не считает законную ветку "
              "(нашёл %d: %s)" % (len(violations), kinds))
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)


def check_vfs_guard(root):
    violations, files, borrowed_funcs, owned = scan_vfs_ownership(root)
    note("сторож VFS: файлов %d, функций-поставщиков указателя из груза %d, "
         "законных веток (указатель свой) %d" % (files, borrowed_funcs, owned))
    for v in violations:
        note("НАРУШЕНИЕ %s:%s %s в %s() — %s" % v)
    check(not violations,
          "контракт владения VFS не нарушен: free()/SDL_free() по r2d_vfs_read нет "
          "(нарушений %d)" % len(violations))


def build(project, out, *extra):
    """Собрать standalone. --no-compress: сжатие к этому дефекту отношения не имеет,
    а тест должен оставаться быстрым."""
    cmd = [BINARY, "build", "--project", project, "--out", out, "--no-encrypt",
           "--no-compress"] + list(extra)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, timeout=600)
    return proc.returncode, proc.stdout


def run_headless(binary, frames=5):
    proc = subprocess.run([binary, "--headless", "--frames", str(frames)],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, timeout=180)
    return proc.returncode, proc.stdout


def main():
    # --scan-root <каталог>: прогнать сторожа по другому каталогу (самопроверка,
    # демонстрация на подложенном примере). По умолчанию — src/ репозитория.
    scan_root = os.path.join(ROOT, "src")
    argv = sys.argv[1:]
    if "--scan-root" in argv:
        scan_root = argv[argv.index("--scan-root") + 1]

    if not os.path.exists(BINARY):
        print("  FAIL движок не собран: %s" % BINARY)
        return 1

    # --- 0. Сторож владения указателями VFS (быстро, до сборок) -------------
    guard_self_test()
    check_vfs_guard(scan_root)

    work = tempfile.mkdtemp(prefix="r2d_real2d_payload_")
    try:
        # --- 1. .r2d4 из груза -------------------------------------------------
        standalone = os.path.join(work, "real2d")
        code, out = build(REAL2D_DEMO, standalone)
        check(code == 0, "standalone демо real2d собран")
        if code != 0:
            print(out[-2000:])
            return 1
        check("файлов 98" in out or "файлов" in out,
              "груз собран: %s" % [ln for ln in out.splitlines() if ln.startswith("Итого")][-1:])

        crashed = 0
        last_code, last_out = 0, ""
        for _ in range(RUNS):
            last_code, last_out = run_headless(standalone)
            if last_code != 0 or CRASH_MARK in last_out:
                crashed += 1
        note("прогонов %d, упало %d (последний код %s)" % (RUNS, crashed, last_code))
        check(crashed == 0,
              "загрузка .r2d4 из груза не валит процесс: упало %d из %d" % (crashed, RUNS))
        check(CRASH_MARK not in last_out,
              "в выводе нет «%s»" % CRASH_MARK)
        check(last_code == 0, "headless-прогон завершился кодом 0 (получено %s)" % last_code)
        check("real2d" in last_out, "демо дошло до своей логики (в выводе есть real2d)")

        # Прямой вызов из JS: контейнер берётся из груза и освобождается.
        with Agent(binary=standalone, game=None, seed=7) as a:
            a.step(2)
            slots = []
            for _ in range(2):
                slots.append(a.eval("$.real2d.load('%s')" % R2D4_ASSET))
            alive = a.eval("typeof $") == "function"
            bytes_len = a.eval("engine.readBytes('%s').length" % R2D4_ASSET)
        check(all(isinstance(s, int) and s >= 0 for s in slots),
              "две загрузки .r2d4 из груза вернули слоты %s" % slots)
        check(alive, "движок жив после повторной загрузки .r2d4")
        check(isinstance(bytes_len, int) and bytes_len > 1024,
              "контейнер читается из груза (%s байт)" % bytes_len)

        # --- 2. Шрифт из груза: загрузка, перезагрузка, выход ------------------
        text_bin = os.path.join(work, "text")
        code, out = build(TEXT_FIXTURE, text_bin)
        check(code == 0, "standalone текстовой фикстуры собран")

        a = Agent(binary=text_bin, game=None, seed=7)
        try:
            a.step(2)
            first = a.eval("engine.loadFont('Probe', '%s')" % TTF_ASSET)
            again = a.eval("engine.loadFont('Probe', '%s')" % TTF_ASSET)   # перезагрузка
            tex = a.eval("engine.loadTexture('%s')" % PNG_ASSET)
            reload_ok = a.eval("engine.reloadTexture(%s, '%s').ok" % (tex, PNG_ASSET)) \
                if isinstance(tex, int) and tex >= 0 else None
            a.step(2)
            alive = a.eval("typeof $") == "function"
        finally:
            a.close()
        exit_code = a.returncode()

        check(first is True, "шрифт из груза загрузился (loadFont → %s)" % first)
        check(again is True, "повторная загрузка того же шрифта прошла (→ %s)" % again)
        check(isinstance(tex, int) and tex >= 0, "текстура из груза загрузилась (id=%s)" % tex)
        check(reload_ok in (True, None), "перезагрузка текстуры из груза: %s" % reload_ok)
        check(alive, "движок жив после перезагрузок")
        check(exit_code == 0,
              "выход после шрифта из груза — код 0 (получено %s; до фикса здесь был SIGABRT)"
              % exit_code)

        note("каталог прогона: %s" % work)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
