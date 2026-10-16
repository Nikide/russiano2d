#!/usr/bin/env python3
"""Скачивает Windows/Linux артефакты CI в локальный ``dist/`` (без сборки).

План дополировки (RUSSIANO2D_PRODUCTION_POLISH.md §4.6–4.7, §57.1) делит
ответственность так: Windows и Linux собирает GitHub Actions, macOS собирается
локально. Но ``dist/`` в репозитории — это витрина, из которой сайт раздаёт
архивы, поэтому в неё должны попадать все поддерживаемые платформы. Этот шаг
переносит готовые артефакты CI в ``dist/`` **скачиванием**: он ничего не
собирает и не подменяет CI.

Скрипт ничего не создаёт: если релиза по тегу нет, он останавливается.

Использование::

    python3 tools/fetch_release_assets.py --dry-run
    python3 tools/fetch_release_assets.py --yes
    python3 tools/fetch_release_assets.py --yes --no-unpack   # только архивы
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import release  # noqa: E402  (путь к tools/ добавляется выше)

#: Платформы, которые собирает CI (macOS здесь быть не должно: он локальный).
CI_PLATFORMS = ("linux-x86_64", "linux-aarch64", "windows-x86_64")


def log(message: str) -> None:
    print(message, flush=True)


def confirm(question: str, assume_yes: bool) -> None:
    if assume_yes:
        log("Подтверждено ключом --yes.")
        return
    if not sys.stdin.isatty():
        raise SystemExit("ошибка: нет терминала для подтверждения; "
                         "используйте --yes или --dry-run")
    if input("%s Введите 'да' для продолжения: " % question).strip().lower() != "да":
        raise SystemExit("отменено пользователем")


def unpack(archive: Path, target: Path) -> None:
    """Разложить архив релиза в dist/<платформа>/ (заменяя прежнее содержимое)."""
    staging = target.parent / (target.name + ".new")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(staging)
    else:
        with tarfile.open(archive) as bundle:
            bundle.extractall(staging, filter="data")
    shutil.rmtree(target, ignore_errors=True)
    staging.rename(target)


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Скачать Windows/Linux артефакты CI в dist/ (сборку не выполняет)")
    parser.add_argument("--tag", help="тег релиза (по умолчанию v<версия проекта>)")
    parser.add_argument("--dist", default="dist", help="каталог витрины")
    parser.add_argument("--repo", help="owner/repo для gh (по умолчанию — remote github)")
    parser.add_argument("--no-unpack", action="store_true",
                        help="не раскладывать архивы в dist/<платформа>/")
    parser.add_argument("--dry-run", action="store_true", help="только показать план")
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждение")
    args = parser.parse_args(argv)

    version = release.read_version()
    tag = args.tag or ("v%s" % version)
    if tag != "v%s" % version:
        raise SystemExit("ошибка: тег %s не совпадает с версией проекта %s"
                         % (tag, version))
    gh = shutil.which("gh")
    if not gh:
        raise SystemExit("ошибка: не найден gh (GitHub CLI)")
    base = [gh, "release"] + (["--repo", args.repo] if args.repo else [])

    log("=" * 70)
    log("russiano2d — перенос артефактов CI в %s%s"
        % (args.dist, "  (ПЛАН, ничего не меняется)" if args.dry_run else ""))
    log("=" * 70)
    log("1. Релиз %s (создаёт его только CI)" % tag)
    if not args.dry_run:
        probe = subprocess.run(base + ["view", tag, "--json", "assets"],
                               capture_output=True, text=True)
        if probe.returncode != 0:
            sys.stderr.write(probe.stdout + probe.stderr)
            raise SystemExit("ошибка: релиза %s нет. Дождитесь workflow по тегу — "
                             "этот скрипт ничего не собирает и не создаёт." % tag)

    dist = Path(args.dist)
    work = Path(tempfile.mkdtemp(prefix="r2d-fetch-"))
    try:
        log("")
        log("2. Скачиваю архивы CI")
        patterns = []
        for platform_name in CI_PLATFORMS:
            patterns += ["--pattern", release.archive_name(platform_name, version)]
        if args.dry_run:
            log("    $ " + " ".join(base + ["download", tag, "--dir", str(work),
                                            "--clobber"] + patterns))
        else:
            result = subprocess.run(base + ["download", tag, "--dir", str(work),
                                            "--clobber"] + patterns,
                                    capture_output=True, text=True)
            if result.returncode != 0:
                sys.stderr.write(result.stdout + result.stderr)
                raise SystemExit("ошибка: не удалось скачать архивы релиза %s" % tag)

        log("")
        log("3. Проверяю и раскладываю в %s" % dist)
        dist.mkdir(parents=True, exist_ok=True)
        for platform_name in CI_PLATFORMS:
            name = release.archive_name(platform_name, version)
            archive = work / name
            if args.dry_run:
                log("    %s → %s/" % (name, dist))
                continue
            if not archive.is_file():
                raise SystemExit("ошибка: в релизе %s нет %s" % (tag, name))
            shutil.copy2(archive, dist / name)
            log("    %s" % name)
            if not args.no_unpack:
                unpack(dist / name, dist / platform_name)
                log("      разложен в %s/" % (dist / platform_name))

        log("")
        log("4. Убираю архивы этих платформ с устаревшим именем и пересчитываю суммы")
        if not args.dry_run:
            for stale in release.prune_stale_archives(str(dist), CI_PLATFORMS, version):
                log("    убран устаревший архив: %s" % stale)
            release._write_global_sums(str(dist))
            log("    %s/SHA256SUMS.txt:" % dist)
            for line in (dist / "SHA256SUMS.txt").read_text().splitlines():
                log("      " + line)

        log("")
        if not args.dry_run:
            confirm("Перенести артефакты CI версии %s в %s?" % (version, dist), args.yes)
        log("")
        log("Готово: в %s/ лежат все поддерживаемые платформы версии %s." % (dist, version))
        log("Витрину можно коммитить; macOS-архивы к релизу прикладывает "
            "tools/attach_macos_release.py.")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
