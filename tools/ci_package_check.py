#!/usr/bin/env python3
"""Проверка ГОТОВОГО релизного архива (release-critical gate).

Проверяется сам пакет, а не репозиторий: архив открывается, в нём есть
обязательные файлы, VERSION совпадает с тегом, нет мусора ОС/сборки.
Используется в release-джобах CI и повторно в publish-job на скачанных
артефактах — публикуется ровно тот архив, который прошёл проверку.

Запуск:
    python3 tools/ci_package_check.py --archive dist-ci/<name> --platform linux-x86_64
    python3 tools/ci_package_check.py --archive <name> --version 1.2.13
"""
import argparse
import io
import sys
import tarfile
import zipfile
from pathlib import PurePosixPath

REQUIRED = (
    "VERSION",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "api.schema.json",
    "sdk/main.js",
    "sdk/ui/shell.rml",
    "sdk/tools/world-editor.js",
)
BINARIES = {
    "linux": ("russiano2d", "r2d-sdk", "russiano2d-sdk"),
    "macos": ("russiano2d", "r2d-sdk", "russiano2d-sdk"),
    "windows": ("russiano2d.exe", "r2d-sdk.exe", "russiano2d-sdk.exe"),
}
FORBIDDEN_PARTS = (".DS_Store", "__pycache__", ".pyc", ".git/", "build-autobuild/",
                   "dist-ci/", "/.cache/")


def read_version():
    try:
        sys.path.insert(0, "tools")
        import release  # noqa: F401
        return release.read_version()
    except Exception:
        return None


def names_and_root(archive):
    # Дескриптор НЕ закрываем здесь: из архива ещё читается VERSION.
    if archive.endswith(".zip"):
        z = zipfile.ZipFile(archive)
        return [n.replace("\\", "/") for n in z.namelist()], z
    t = tarfile.open(archive, "r:*")
    return [m.name.replace("\\", "/") for m in t.getmembers()], t


def normalized(name):
    name = name.replace("\\", "/").lstrip("./")
    while name.startswith("./"):
        name = name[2:]
    return name


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--archive", required=True)
    p.add_argument("--platform", choices=("linux-x86_64", "linux-aarch64", "macos-arm64", "macos-x86_64", "windows-x86_64"),
                   help="платформа: выбирает имена бинарников")
    p.add_argument("--version", default=None, help="ожидаемая версия (по умолчанию из CMakeLists)")
    args = p.parse_args()

    failures = []

    def check(ok, message):
        print(("  ok   " if ok else "  FAIL ") + message)
        if not ok:
            failures.append(message)

    try:
        names, handle = names_and_root(args.archive)
    except Exception as exc:  # noqa: BLE001 — любая ошибка открытия = битый архив
        print("  FAIL архив не открывается: %s (%s)" % (args.archive, exc))
        return 1

    check(bool(names), "архив открывается и не пуст (%d записей)" % len(names))
    flat = {}
    for raw in names:
        name = normalized(raw)
        if name:
            flat[name] = raw

    expected_version = args.version or read_version()
    check("VERSION" in flat, "VERSION в корне архива")
    if "VERSION" in flat and expected_version:
        try:
            if args.archive.endswith(".zip"):
                raw = handle.read(flat["VERSION"])
            else:
                raw = handle.extractfile(flat["VERSION"]).read()
            inside = raw.decode("utf-8", "replace").strip()
            check(inside == expected_version,
                  "VERSION внутри пакета %s == %s" % (inside, expected_version))
        except Exception as exc:  # noqa: BLE001
            check(False, "VERSION читается: %s" % exc)

    binaries = BINARIES["windows" if (args.platform or "").startswith("windows") else ("macos" if (args.platform or "").startswith("macos") else "linux")]
    for binary in binaries:
        check(binary in flat, "исполняемый файл %s в корне" % binary)
    for required in REQUIRED:
        check(required in flat, "обязательный файл %s" % required)
    if (args.platform or "").startswith("macos"):
        for required in ("Russiano2D SDK.app/Contents/Info.plist",
                         "Russiano2D SDK.app/Contents/MacOS/russiano2d-sdk",
                         "Russiano2D SDK.app/Contents/MacOS/russiano2d",
                         "Russiano2D SDK.app/Contents/MacOS/r2d-sdk",
                         "Russiano2D SDK.app/Contents/Resources/sdk/project.json"):
            check(required in flat, "Finder SDK app содержит %s" % required)

    junk = sorted(n for n in flat if any(part in n for part in FORBIDDEN_PARTS))
    check(not junk, "в пакете нет мусора ОС/сборки" + (" (%s)" % ", ".join(junk[:5]) if junk else ""))

    # Архив не должен быть «сплющен»: бинарники лежат в корне, а не в подпапке.
    check(not any(n.count("/") > 0 and PurePosixPath(n).name in binaries and "/" in n
                  for n in flat),
          "бинарники лежат в корне архива, а не во вложенном каталоге")

    if not args.archive.endswith(".zip"):
        handle.close()
    print()
    if failures:
        print("FAILED: пакет %s невалиден (%d)" % (args.archive, len(failures)))
        return 1
    print("OK: пакет %s" % args.archive)
    return 0


if __name__ == "__main__":
    sys.exit(main())
