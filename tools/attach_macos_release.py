#!/usr/bin/env python3
"""Прикладывает локальные macOS-архивы к уже созданному CI-релизу.

План дополировки (RUSSIANO2D_PRODUCTION_POLISH.md §4.7, шаг 5) требует именно
такой порядок:

1. macOS собирается, тестируется и пакуется локально на рабочем Mac;
2. push commit/tag;
3. GitHub Actions собирает Windows/Linux, считает суммы и создаёт релиз;
4. **этот скрипт** прикладывает macOS-архивы к тому же релизу и пересчитывает
   ``SHA256SUMS.txt`` на все пять архивов.

Скрипт **не создаёт релиз** и не умеет его создавать: единственный владелец
GitHub Releases — CI (§4.8). Если релиза по тегу ещё нет, скрипт останавливается
с понятным сообщением, а не подменяет CI.

Использование::

    python3 tools/attach_macos_release.py --dry-run   # показать план
    python3 tools/attach_macos_release.py             # спросит подтверждение
    python3 tools/attach_macos_release.py --yes       # без вопросов (CI/скрипт)

Архивы берутся из ``dist/`` (их кладёт ``tools/release_build.sh`` через
Xmake). Перед загрузкой проверяется архитектура бинарника внутри
пакета: перепутать arm64 и x86_64 в релизе нельзя.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import release  # noqa: E402  (путь к tools/ добавляется выше)

#: Платформы, которые собирает и прикладывает локальный Mac.
MACOS_PLATFORMS = ("macos-arm64", "macos-x86_64")

#: Платформы, архивы которых обязан выложить CI. Проверяются как ожидание:
#: если чего-то нет, релиз неполный и об этом нужно сказать, а не молчать.
CI_PLATFORMS = ("linux-x86_64", "linux-aarch64", "windows-x86_64")


def log(message: str) -> None:
    print(message, flush=True)


def run(command: List[str], dry_run: bool, **kwargs) -> str:
    if dry_run:
        log("    $ " + " ".join(command))
        return ""
    result = subprocess.run(command, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit("ошибка: команда завершилась с кодом %d: %s"
                         % (result.returncode, " ".join(command)))
    return result.stdout


def confirm(question: str, assume_yes: bool) -> None:
    """Спросить подтверждение. Без TTY и без --yes — отказ (как release.py)."""
    if assume_yes:
        log("Подтверждено ключом --yes.")
        return
    if not sys.stdin.isatty():
        raise SystemExit("ошибка: нет терминала для подтверждения; "
                         "используйте --yes или --dry-run")
    if input("%s Введите 'да' для продолжения: " % question).strip().lower() != "да":
        raise SystemExit("отменено пользователем")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Приложить локальные macOS-архивы к релизу, созданному CI")
    parser.add_argument("--tag", help="тег релиза (по умолчанию v<версия проекта>)")
    parser.add_argument("--dist", default="dist", help="каталог с локальными архивами")
    parser.add_argument("--repo", help="owner/repo для gh (по умолчанию — remote github)")
    parser.add_argument("--dry-run", action="store_true",
                        help="показать план и ничего не менять")
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждение")
    args = parser.parse_args(argv)

    version = release.read_version()
    tag = args.tag or ("v%s" % version)
    expected_tag = "v%s" % version
    if tag != expected_tag:
        raise SystemExit("ошибка: тег %s не совпадает с версией проекта %s "
                         "(одна версия на проект — §58)" % (tag, expected_tag))

    dist = Path(args.dist)
    local = {}
    for platform_name in MACOS_PLATFORMS:
        archive = dist / release.archive_name(platform_name, version)
        if not archive.is_file():
            raise SystemExit("ошибка: нет локального архива %s; соберите macOS "
                             "локально (tools/release_build.sh; платформы: %s)"
                             % (archive, ",".join(MACOS_PLATFORMS)))
        # Архитектура внутри пакета: имя артефакта не должно врать.
        binary = (dist / platform_name
                  / ("r2d" + release.PLATFORMS[platform_name][1]))
        if binary.is_file():
            actual = release.binary_platform(str(binary))
            if actual != platform_name:
                raise SystemExit("ошибка: в %s лежит бинарник архитектуры %s, "
                                 "а имя обещает %s" % (archive, actual, platform_name))
        local[archive.name] = archive

    gh = shutil.which("gh")
    if not gh:
        raise SystemExit("ошибка: не найден gh (GitHub CLI); установите его "
                         "или приложите архивы вручную")

    gh_base = [gh, "release"]
    if args.repo:
        gh_base += ["--repo", args.repo]

    log("=" * 70)
    log("russiano2d — прикладывание macOS к релизу %s%s"
        % (tag, "  (ПЛАН, ничего не меняется)" if args.dry_run else ""))
    log("=" * 70)
    log("1. Релиз обязан уже существовать (создаёт его только CI)")
    log("    $ %s view %s" % (" ".join(gh_base), tag))
    if not args.dry_run:
        probe = subprocess.run(gh_base + ["view", tag, "--json", "assets"],
                               capture_output=True, text=True)
        if probe.returncode != 0:
            sys.stderr.write(probe.stdout + probe.stderr)
            raise SystemExit(
                "ошибка: релиз %s ещё не создан (или недоступен).\n"
                "Этот скрипт релизы не создаёт: дождитесь workflow по тегу %s "
                "или проверьте его статус в GitHub Actions." % (tag, tag))

    work = Path(tempfile.mkdtemp(prefix="r2d-attach-"))
    try:
        log("")
        log("2. Забираю артефакты, которые уже выложил CI")
        run(gh_base + ["download", tag, "--dir", str(work), "--clobber"], args.dry_run)

        log("")
        log("3. Докладываю локальные macOS-архивы")
        for name, path in sorted(local.items()):
            log("    %s" % name)
            if not args.dry_run:
                shutil.copy2(path, work / name)

        log("")
        log("4. Полнота релиза")
        if not args.dry_run:
            present = {p.name for p in work.iterdir() if p.is_file()}
            missing = [release.archive_name(p, version) for p in CI_PLATFORMS
                       if release.archive_name(p, version) not in present]
            if missing:
                raise SystemExit(
                    "ошибка: в релизе %s нет архивов CI: %s\n"
                    "Релиз неполный — сначала дождитесь успешного workflow."
                    % (tag, ", ".join(missing)))
            unexpected = sorted(n for n in present
                                if n not in {release.archive_name(p, version)
                                             for p in CI_PLATFORMS + MACOS_PLATFORMS})
            log("    в релизе будет архивов: %d%s"
                % (len(CI_PLATFORMS) + len(MACOS_PLATFORMS),
                   ("; прочие файлы: " + ", ".join(unexpected)) if unexpected else ""))

        log("")
        log("5. Пересчитываю SHA256SUMS.txt на все поддерживаемые платформы")
        if not args.dry_run:
            names = sorted(release.archive_name(p, version)
                           for p in CI_PLATFORMS + MACOS_PLATFORMS)
            lines = []
            for name in names:
                path = work / name
                if not path.is_file():
                    raise SystemExit("ошибка: нет %s для подсчёта суммы" % path)
                lines.append("%s  %s" % (release.sha256_file(str(path)), name))
            (work / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
            log("    " + "\n    ".join(lines))

        log("")
        log("6. Прикладываю к релизу %s" % tag)
        if not args.dry_run:
            confirm("Приложить macOS-архивы и обновлённый SHA256SUMS.txt к релизу %s?" % tag,
                    args.yes)
        upload = ([release.archive_name(p, version) for p in MACOS_PLATFORMS]
                  + ["SHA256SUMS.txt"])
        run(gh_base + ["upload", tag] + upload + ["--clobber"], args.dry_run,
            cwd=str(work))

        log("")
        log("7. Что лежит в релизе теперь")
        if args.dry_run:
            log("    (план: 5 архивов + SHA256SUMS.txt)")
        else:
            listing = run(gh_base + ["view", tag, "--json", "assets",
                                     "--jq", ".assets[].name"], args.dry_run)
            log("    " + "\n    ".join(sorted(listing.split())))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    log("")
    log("Готово. Релиз %s содержит Windows/Linux из CI и macOS с локальной машины." % tag)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
