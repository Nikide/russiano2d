#!/usr/bin/env python3
# ===========================================================================
# Сжатие груза игры (zstd, task-20).
#
# Что проверяется на живом движке и на настоящем грузе (фикстура
# tests/fixtures/text — шрифт 569 КБ + PNG, самый показательный набор):
#   * сжатый груз ЧИТАЕТСЯ: standalone стартует из одного файла;
#   * распаковка даёт ПОБАЙТОВО те же данные — размер + две независимые хеш-
#     суммы (FNV-1a 32 и сумма байт) файла из груза против файла на диске,
#     плюс полное побайтовое сравнение маленького файла (hex);
#   * формат версионирован: у сжатого контейнера версия 2 и признак zstd,
#     у сборки с --no-compress — версия 1 (байт в байт прежняя раскладка);
#   * ВОСПРОИЗВОДИМОСТЬ: две сборки из одного дерева дают один и тот же
#     SHA256 контейнера (уровень и версия zstd зафиксированы);
#   * повреждённый сжатый блок ОТВЕРГАЕТСЯ с кодом R2D_PAYLOAD_ZSTD_CORRUPT,
#     а не превращается в мусор (в кадре контрольная сумма zstd-кадра);
#   * неизвестная версия контейнера отвергается с кодом
#     R2D_PAYLOAD_UNKNOWN_VERSION;
#   * сборка БЕЗ zstd (харнесс компилирует src/payload.c без R2D_ENABLE_ZSTD):
#     старый груз (версия 1) читается, а сжатый отвергается с кодом
#     R2D_PAYLOAD_NO_ZSTD.
#
# Числа печатаются здесь же (размер тела/груза до и после, время сжатия,
# время распаковки на старте) — они же идут в отчёт задачи.
#
# Запуск (после сборки):
#   python3 tests/agent/payload_compression_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/payload_compression_test.py
# ===========================================================================

import hashlib
import os
import shutil
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

BINARY = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "text")
BIG_ASSET = "assets/fonts/NotoSans-Regular.ttf"   # 569 КБ, лежит в грузе как есть
SMALL_ASSET = "assets/tiles.png"                  # 145 Б, сравниваем побайтово

FOOTER_SIZE = 128
VERSION_PLAIN = 1
VERSION_ZSTD = 2
FLAG_ZSTD = 1

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def note(message):
    print("  --   " + message)


# ---------------------------------------------------------------------------
# Сборка и разбор контейнера
# ---------------------------------------------------------------------------
def build(out, *extra):
    cmd = [BINARY, "build", "--project", FIXTURE, "--out", out, "--no-encrypt"] + list(extra)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, timeout=600)
    return proc.returncode, proc.stdout


def footer_of(path):
    with open(path, "rb") as f:
        f.seek(-FOOTER_SIZE, os.SEEK_END)
        footer = f.read(FOOTER_SIZE)
    magic = struct.unpack("<I", footer[0:4])[0]
    offset = struct.unpack("<Q", footer[8:16])[0]
    size = struct.unpack("<Q", footer[16:24])[0]
    flags = struct.unpack("<I", footer[84:88])[0]
    return magic, offset, size, flags


def container_of(path):
    _magic, offset, size, _flags = footer_of(path)
    with open(path, "rb") as f:
        f.seek(offset)
        return bytearray(f.read(size))


def container_header(container):
    """(magic, version, flags, raw_size) — заголовок контейнера."""
    magic, version = struct.unpack("<II", container[0:8])
    if version == VERSION_PLAIN:
        return magic, version, None, None
    flags = struct.unpack("<I", container[8:12])[0]
    raw = struct.unpack("<Q", container[12:20])[0]
    return magic, version, flags, raw


def builder_numbers(text):
    """Числа из вывода билдера: тело, сжатое тело, время сжатия, контейнер."""
    body = stored = cms = container = None
    for line in text.splitlines():
        if line.startswith("Сжатие:") and "→" in line:
            parts = line.split("тело", 1)[1].split("байт")[0].split("→")
            body = int(parts[0].strip())
            stored = int(parts[1].strip())
            cms = float(line.rsplit(" ", 2)[-2].replace("мс", "").strip())
        if line.startswith("Итого"):
            container = int(line.split("контейнер")[1].split("байт")[0].strip())
    return body, stored, cms, container


# ---------------------------------------------------------------------------
# Чтение файла из груза и хеши
# ---------------------------------------------------------------------------
FNV_JS = """(() => {
    const b = engine.readBytes('%s');
    if (!b) return null;
    let h = 0x811c9dc5, sum = 0;
    for (let i = 0; i < b.length; i++) {
        h = (h ^ b[i]) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
        sum = (sum + b[i]) >>> 0;
    }
    return { len: b.length, fnv: h >>> 0, sum: sum >>> 0 };
})()"""

HEX_JS = """(() => {
    const b = engine.readBytes('%s');
    if (!b) return null;
    let out = '';
    for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
    return out;
})()"""


def fnv1a(data):
    h = 0x811c9dc5
    for byte in data:
        h = ((h ^ byte) * 0x01000193) & 0xFFFFFFFF
    return h


def payload_stats(path):
    """Что видел движок при старте: строки журнала про груз."""
    with Agent(binary=path, game=None, seed=7) as a:
        a.step(2)
        ok = a.eval("typeof $ === 'function'")
        big = a.eval(FNV_JS % BIG_ASSET)
        small = a.eval(HEX_JS % SMALL_ASSET)
        stderr = a.stderr_text()
    return ok, big, small, stderr


def log_lines(stderr, needle):
    return [ln for ln in stderr.splitlines() if needle in ln]


# ---------------------------------------------------------------------------
# Харнесс «сборка без zstd»: src/payload.c компилируется без R2D_ENABLE_ZSTD
# ---------------------------------------------------------------------------
HARNESS = r"""
#include "payload.h"
#include <stdio.h>
#include <stdlib.h>

/* Тот же приём, что в tests/payload/payload_test.c: без app.c этот флаг,
 * который читает R2D_LOG, остался бы неопределённым символом. */
bool r2d_log_stderr = false;

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    FILE *f = fopen(argv[1], "rb");
    if (!f) return 2;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    unsigned char *buf = (unsigned char *)malloc((size_t)n);
    if (!buf || fread(buf, 1, (size_t)n, f) != (size_t)n) return 2;
    fclose(f);
    char err[256];
    R2dPayload *p = r2d_payload_parse(buf, (size_t)n, err, sizeof err);
    if (p) {
        printf("OK files=%d entry=%s compressed=%d\n", p->file_count, p->entry,
               p->compressed ? 1 : 0);
        r2d_payload_free(p);
        return 0;
    }
    printf("ERR %s\n", err);
    return 1;
}
"""


def compile_no_zstd_harness(work):
    """Собрать харнесс без zstd. Возвращает путь или None с причиной."""
    sdl = subprocess.run(["pkg-config", "--cflags", "--libs", "sdl3"],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    if sdl.returncode != 0:
        return None, "нет pkg-config sdl3"
    cc = shutil.which("cc") or shutil.which("clang") or shutil.which("gcc")
    if not cc:
        return None, "нет компилятора C"
    src = os.path.join(work, "nozstd_harness.c")
    with open(src, "w") as f:
        f.write(HARNESS)
    exe = os.path.join(work, "nozstd_harness")
    cmd = [cc, "-O0", "-I", os.path.join(ROOT, "src"), src,
           os.path.join(ROOT, "src", "payload.c"), os.path.join(ROOT, "src", "crypto.c"),
           "-o", exe] + sdl.stdout.split()
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        return None, "компиляция харнесса не удалась: %s" % proc.stdout[-300:]
    return exe, ""


def main():
    if not os.path.exists(BINARY):
        print("  FAIL движок не собран: %s" % BINARY)
        return 1

    work = tempfile.mkdtemp(prefix="r2d_payload_zstd_")
    try:
        zst = os.path.join(work, "text_zstd")
        raw = os.path.join(work, "text_raw")
        zst2 = os.path.join(work, "text_zstd2")

        # --- 1. Сжатая сборка ------------------------------------------------
        code, out = build(zst)
        check(code == 0, "сборка со сжатием отработала без ошибок")
        if code != 0:
            print(out)
            return 1
        check("Сжатие: тело" in out, "билдер сообщил числа сжатия")
        body, stored, cms, csize = builder_numbers(out)
        check(body and stored and stored < body,
              "тело груза сжалось: %s → %s байт (%.1f%% от исходного)"
              % (body, stored, 100.0 * stored / body))
        note("сжатие при сборке: %.1f мс, уровень из R2D_PAYLOAD_ZSTD_LEVEL" % cms)

        cont = container_of(zst)
        magic, version, flags, raw_size = container_header(cont)
        check(version == VERSION_ZSTD,
              "заголовок контейнера: версия %d (сжатая раскладка)" % version)
        check(flags == FLAG_ZSTD, "признак контейнера: zstd (flags=%s)" % flags)
        check(raw_size == body, "размер тела до сжатия записан в заголовке (%s)" % raw_size)
        check(len(cont) == csize, "размер контейнера сходится с отчётом билдера (%d)" % len(cont))

        # --- 2. Груз читается, данные распаковываются побайтово ---------------
        ok, big, small, stderr = payload_stats(zst)
        check(ok is True, "standalone со сжатым грузом поднялся, $ на месте")
        check(big is not None and small is not None, "файлы читаются из груза")
        disk_big = open(os.path.join(FIXTURE, BIG_ASSET), "rb").read()
        disk_small = open(os.path.join(FIXTURE, SMALL_ASSET), "rb").read()
        if big and small:
            check(big["len"] == len(disk_big), "размер шрифта из груза совпал (%d)" % big["len"])
            check(big["fnv"] == fnv1a(disk_big) and big["sum"] == sum(disk_big) & 0xFFFFFFFF,
                  "хеши шрифта из груза и с диска совпали (fnv=0x%08X)" % big["fnv"])
            check(bytes.fromhex(small) == disk_small,
                  "маленький файл совпал с диском побайтово (%d байт)" % len(disk_small))
        startup = log_lines(stderr, "разбор")
        check(bool(startup), "движок сообщил время разбора груза: %s" % (startup or "нет строки"))
        if startup:
            note(startup[-1].split("]")[-1].strip())

        # --- 3. Воспроизводимость: две сборки → один SHA256 -------------------
        code, out2 = build(zst2)
        check(code == 0, "вторая сборка отработала")
        h1 = hashlib.sha256(bytes(container_of(zst))).hexdigest()
        h2 = hashlib.sha256(bytes(container_of(zst2))).hexdigest()
        check(h1 == h2, "две сборки из одного дерева дали одинаковый груз (%s)" % h1[:16])

        # --- 4. Старый формат (версия 1) читается -----------------------------
        code, out_raw = build(raw, "--no-compress")
        check(code == 0, "сборка с --no-compress отработала")
        check("Сжатие: выключено" in out_raw, "билдер назвал сжатие выключенным")
        cont_raw = container_of(raw)
        _m, version_raw, _f, _r = container_header(cont_raw)
        check(version_raw == VERSION_PLAIN,
              "контейнер без сжатия — версия %d, прежняя раскладка" % version_raw)
        ok_raw, big_raw, _small_raw, _err_raw = payload_stats(raw)
        check(ok_raw is True and big_raw is not None and big_raw["fnv"] == fnv1a(disk_big),
              "груз версии 1 читается движком (старый формат не сломан)")

        # --- 5. Повреждённый сжатый блок отвергается с кодом ------------------
        broken = os.path.join(work, "text_broken")
        shutil.copyfile(zst, broken)
        _m, offset, size, _fl = footer_of(broken)
        with open(broken, "r+b") as f:
            # Байт в середине СЖАТОГО тела (заголовок не трогаем).
            f.seek(offset + 20 + size // 4)
            byte = f.read(1)
            f.seek(offset + 20 + size // 4)
            f.write(bytes([byte[0] ^ 0x40]))
        os.chmod(broken, 0o755)
        # Мир при отказе груза движок может собрать с диска (это документированный
        # откат), поэтому проверяем ГЛАВНОЕ: груз не подключён и названа причина.
        try:
            with Agent(binary=broken, game=None, seed=7) as a:
                a.step(2)
                errs = a.stderr_text()
            check(not log_lines(errs, "груз найден"),
                  "повреждённый груз не подключён (строки «груз найден» нет)")
        except Exception as exc:   # движок вправе вообще не подняться
            errs = str(exc)
            check(True, "повреждённый груз отвергнут на старте (%s)" % type(exc).__name__)
        check("R2D_PAYLOAD_ZSTD_CORRUPT" in errs,
              "назван код ошибки распаковки: %s"
              % ([ln.split("]")[-1].strip() for ln in errs.splitlines()
                  if "ZSTD_CORRUPT" in ln] or "код не найден"))

        # --- 6. Неизвестная версия контейнера отвергается с кодом -------------
        futuristic = os.path.join(work, "text_v3")
        shutil.copyfile(zst, futuristic)
        _m, offset, _s, _fl = footer_of(futuristic)
        with open(futuristic, "r+b") as f:
            f.seek(offset + 4)
            f.write(struct.pack("<I", 3))   # версия 3 — которой ещё нет
        os.chmod(futuristic, 0o755)
        try:
            with Agent(binary=futuristic, game=None, seed=7) as a:
                a.step(2)
                errs = a.stderr_text()
            check(not log_lines(errs, "груз найден"),
                  "груз неизвестной версии не подключён")
        except Exception as exc:
            errs = str(exc)
            check(True, "груз неизвестной версии отвергнут на старте (%s)" % type(exc).__name__)
        check("R2D_PAYLOAD_UNKNOWN_VERSION" in errs,
              "назван код ошибки версии: %s"
              % ([ln.split("]")[-1].strip() for ln in errs.splitlines()
                  if "UNKNOWN_VERSION" in ln] or "код не найден"))

        # --- 7. Сборка без zstd: старый груз читается, сжатый — с кодом -------
        exe, why = compile_no_zstd_harness(work)
        if not exe:
            note("харнесс без zstd пропущен: %s (проверка R2D_PAYLOAD_NO_ZSTD "
                 "выполняется тестом tests/payload/payload_test.c)" % why)
        else:
            plain_container = os.path.join(work, "plain.container")
            with open(plain_container, "wb") as f:
                f.write(bytes(container_of(raw)))
            proc = subprocess.run([exe, plain_container], stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True)
            check(proc.returncode == 0 and "OK" in proc.stdout,
                  "сборка без zstd читает старый груз (%s)" % proc.stdout.strip())

            zstd_container = os.path.join(work, "zstd.container")
            with open(zstd_container, "wb") as f:
                f.write(bytes(container_of(zst)))
            proc = subprocess.run([exe, zstd_container], stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True)
            check(proc.returncode != 0 and "R2D_PAYLOAD_NO_ZSTD" in proc.stdout,
                  "сборка без zstd отвергает сжатый груз с кодом (%s)" % proc.stdout.strip())

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
