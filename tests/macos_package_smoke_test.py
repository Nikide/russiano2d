#!/usr/bin/env python3
# ===========================================================================
# macOS package smoke: пакет проверяется как пакет, а не как дерево сборки.
#
# План дополировки (RUSSIANO2D_PRODUCTION_POLISH.md §4.5, §66) требует, чтобы
# локальная macOS-сборка проходила отдельный документированный smoke/acceptance
# шаг: собирать и тестировать движок в build/ недостаточно, потому что релиз
# раздаётся архивом, а не каталогом сборки. Здесь архив распаковывается во
# временный каталог, и уже оттуда проверяются:
#
#   * VERSION внутри пакета совпадает с версией проекта (§58, одна версия);
#   * `russiano2d --version` и `r2d-sdk version` называют ту же версию;
#   * SHA256SUMS.txt пакета сходится с файлами пакета;
#   * движок из пакета реально запускается: headless-прогон 30 кадров
#     демо-игры заканчивается кодом 0.
#
# На Apple Silicon x86_64-пакет запускается через Rosetta (`arch -x86_64`):
# если Rosetta недоступна, это сообщается как пропуск архитектуры, а не как
# «зелено» — иначе Intel-сборка выглядела бы проверенной без проверки.
#
# Запуск:
#   python3 tests/macos_package_smoke_test.py            # все macOS-архивы в dist/
#   python3 tests/macos_package_smoke_test.py --arch arm64
# ===========================================================================

import argparse
import hashlib
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import release  # noqa: E402  (путь к tools/ добавлен выше)

FAILURES = []
SKIPS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def skip(message):
    print("  skip " + message)
    SKIPS.append(message)


def runner_for(archive_platform):
    """Как запускать бинарник этой архитектуры на текущей машине."""
    host = platform.machine()
    if archive_platform == "macos-arm64":
        return None if host == "arm64" else "unsupported-host"
    if archive_platform == "macos-x86_64":
        if host == "x86_64":
            return None
        return ["arch", "-x86_64"] if shutil.which("arch") else "no-rosetta"
    return "unsupported-host"


def run(argv, prefix, timeout=180):
    command = (prefix or []) + argv
    result = subprocess.run([str(part) for part in command], capture_output=True,
                            text=True, timeout=timeout)
    return result


def has_rosetta():
    probe = subprocess.run(["arch", "-x86_64", "/usr/bin/true"],
                           capture_output=True, text=True)
    return probe.returncode == 0


def verify_package_sums(package, label):
    manifest = package / "SHA256SUMS.txt"
    if not manifest.is_file():
        check(False, "%s: нет SHA256SUMS.txt" % label)
        return
    bad = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, name = line.split("  ", 1)
        target = package / name
        if not target.is_file():
            bad.append(name + " (нет файла)")
            continue
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            bad.append(name)
    check(not bad, "%s: контрольные суммы пакета сходятся%s"
          % (label, "" if not bad else " (расхождения: %s)" % bad[:3]))


def smoke_archive(archive, version):
    platform_name = "macos-arm64" if "arm64" in archive.name else "macos-x86_64"
    print("\n== %s ==" % archive.name)
    prefix = runner_for(platform_name)
    if prefix == "no-rosetta" or prefix == "unsupported-host":
        reason = ("нет Rosetta (arch -x86_64 не запускается)" if prefix == "no-rosetta"
                  else "хост %s не может запускать %s" % (platform.machine(), platform_name))
        skip("%s: запуск не проверен — %s" % (archive.name, reason))
        return
    if prefix is not None and not has_rosetta():
        skip("%s: запуск не проверен — Rosetta недоступна" % archive.name)
        return

    with tempfile.TemporaryDirectory(prefix="r2d-macos-smoke-") as tmp:
        package = Path(tmp)
        with tarfile.open(archive) as bundle:
            bundle.extractall(package, filter="data")

        version_file = package / "VERSION"
        check(version_file.is_file() and version_file.read_text().strip() == version,
              "%s: VERSION внутри пакета == %s" % (archive.name, version))
        verify_package_sums(package, archive.name)

        engine = package / "russiano2d"
        sdk = package / "r2d-sdk"
        check(engine.is_file() and os.access(engine, os.X_OK),
              "%s: в пакете есть исполняемый russiano2d" % archive.name)
        if not engine.is_file():
            return

        probe = run([engine, "--version"], prefix)
        check(probe.returncode == 0
              and probe.stdout.strip() == "Russiano2D " + version,
              "%s: russiano2d --version == Russiano2D %s (%r)"
              % (archive.name, version, probe.stdout.strip()))

        probe = run([sdk, "version"], prefix)
        ok = probe.returncode == 0 and ('"version":"%s"' % version) in probe.stdout
        check(ok, "%s: r2d-sdk version сообщает %s" % (archive.name, version))

        # Настоящий запуск: пакет обязан работать headless, без окна и GPU-стека.
        probe = run([engine, "--headless", "--frames", "30", "--game", "game"],
                    prefix, timeout=300)
        check(probe.returncode == 0,
              "%s: headless-прогон 30 кадров вышел с кодом 0 (код %d)"
              % (archive.name, probe.returncode))
        if probe.returncode != 0:
            tail = (probe.stdout + probe.stderr).strip().splitlines()[-6:]
            for line in tail:
                print("        " + line)


def main(argv):
    parser = argparse.ArgumentParser(description="Smoke-проверка macOS-пакетов")
    parser.add_argument("--dist", default="dist", help="каталог с архивами релиза")
    parser.add_argument("--arch", choices=["arm64", "x86_64", "all"], default="all",
                        help="какие macOS-платформы проверять")
    args = parser.parse_args(argv)

    print("macOS package smoke (хост: %s, %s)" % (platform.machine(), platform.platform()))
    if sys.platform != "darwin":
        print("  skip это не macOS — проверка пакетов macOS здесь неприменима")
        return 0

    version = release.read_version()
    wanted = {"arm64": ["macos-arm64"], "x86_64": ["macos-x86_64"],
              "all": ["macos-arm64", "macos-x86_64"]}[args.arch]
    archives = []
    for platform_name in wanted:
        archive = Path(args.dist) / release.archive_name(platform_name, version)
        if archive.is_file():
            archives.append(archive)
        else:
            check(False, "нет архива %s — соберите macOS локально "
                         "(tools/autobuild.py --platforms %s)" % (archive, platform_name))

    for archive in archives:
        smoke_archive(archive, version)

    print()
    if FAILURES:
        print("ПРОВАЛЕНО: %d" % len(FAILURES))
        for line in FAILURES:
            print("  - " + line)
        return 1
    if SKIPS:
        print("Пройдено, но с пропусками (не «зелено»): %d" % len(SKIPS))
        for line in SKIPS:
            print("  - " + line)
        return 2
    print("Все проверки пройдены: %d пакетов" % len(archives))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
