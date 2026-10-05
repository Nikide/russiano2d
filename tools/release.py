#!/usr/bin/env python3
"""Подготовка и выпуск релиза russiano2d.

Скрипт делает всю механическую часть релиза: поднимает версию в
``CMakeLists.txt``, собирает Release, прогоняет тесты без окна, раскладывает
``dist/<os>-<arch>/``, считает SHA256SUMS и (по желанию) ставит тег.

Главное правило — **ничего не делать без явного согласия**:

* ``--dry-run`` печатает план и не пишет ни одного файла, не запускает
  сборку и не трогает git (кроме чтения);
* без ``--dry-run`` нужен либо ввод слова ``да`` в терминале, либо ключ
  ``--yes`` (для неинтерактивных сценариев).

Лицензии у проекта пока нет — это блокер публичного релиза. Настоящий запуск
без файла ``LICENSE`` в корне останавливается; см. ``docs/RELEASING.md``.

Использование::

    # План: показать, что будет сделано, и ничего не изменить
    python3 tools/release.py --dry-run
    python3 tools/release.py --dry-run --version 0.2.0

    # Реальный выпуск: поднять версию, собрать, протестировать, упаковать, тег
    python3 tools/release.py --version 0.2.0

    # Только упаковка уже собранного бинарника (режим CI)
    python3 tools/release.py --package-only --platform linux-x86_64 \\
        --binary build-gcc/russiano2d --out dist

Аргументы разбираются вручную через ``sys.argv`` (без argparse) — как в
остальных инструментах проекта. Внешних зависимостей нет.
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
from typing import Dict, List, Optional, Sequence, Tuple

#: Абсолютный путь к корню репозитория.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Файл, в котором живёт версия проекта.
CMAKE_FILE = os.path.join(ROOT, "CMakeLists.txt")

#: Регулярное выражение версии в CMakeLists.txt (строка `VERSION x.y.z`).
VERSION_RE = re.compile(r"(VERSION\s+)(\d+\.\d+\.\d+)")

#: Каталог сборки Release по умолчанию.
DEFAULT_BUILD_DIR = "build-release"

#: Каталог релизных артефактов по умолчанию.
DEFAULT_OUT_DIR = "dist"

#: Файлы, которые кладутся в каждый пакет рядом с бинарником.
DOC_FILES = ("README.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "LICENSE")

#: Известные платформы: имя пакета → (система, исполняемый суффикс, формат архива).
PLATFORMS: Dict[str, Tuple[str, str, str]] = {
    "linux-x86_64": ("linux", "", "tar.gz"),
    "linux-aarch64": ("linux", "", "tar.gz"),
    "windows-x86_64": ("windows", ".exe", "zip"),
    "macos-arm64": ("macos", "", "tar.gz"),
    "macos-x86_64": ("macos", "", "tar.gz"),
}

#: Русские названия систем для заголовков.
OS_TITLES = {"linux": "Linux", "windows": "Windows", "macos": "macOS"}

#: Соответствие «платформа → заголовок», чтобы не повторяться в тексте.
PLATFORM_TITLES = {
    "linux-x86_64": "Linux x86_64",
    "linux-aarch64": "Linux aarch64",
    "windows-x86_64": "Windows x86_64",
    "macos-arm64": "macOS Apple Silicon",
    "macos-x86_64": "macOS Intel",
}


def log(message: str = "") -> None:
    """Напечатать строку и сбросить буфер (важно для CI)."""
    print(message, flush=True)


def host_platform() -> str:
    """Определить платформу текущей машины в терминах ``PLATFORMS``."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    if machine in ("amd64", "x86_64"):
        arch = "x86_64"
    elif machine in ("arm64", "aarch64"):
        arch = "arm64" if system == "darwin" else "aarch64"
    else:
        arch = machine
    if system == "darwin":
        return "macos-%s" % arch
    if system == "windows":
        return "windows-%s" % arch
    return "linux-%s" % arch


def binary_name(platform_name: str) -> str:
    """Имя исполняемого файла для платформы."""
    return "russiano2d" + PLATFORMS[platform_name][1]


def read_version() -> str:
    """Прочитать текущую версию из CMakeLists.txt."""
    with open(CMAKE_FILE, encoding="utf-8") as handle:
        text = handle.read()
    match = VERSION_RE.search(text)
    if not match:
        raise SystemExit("ошибка: не нашёл VERSION x.y.z в %s" % CMAKE_FILE)
    return match.group(2)


def write_version(new_version: str) -> str:
    """Заменить версию в CMakeLists.txt, вернуть прежнюю."""
    with open(CMAKE_FILE, encoding="utf-8") as handle:
        text = handle.read()
    match = VERSION_RE.search(text)
    if not match:
        raise SystemExit("ошибка: не нашёл VERSION x.y.z в %s" % CMAKE_FILE)
    old_version = match.group(2)
    updated = text[: match.start(2)] + new_version + text[match.end(2):]
    with open(CMAKE_FILE, "w", encoding="utf-8") as handle:
        handle.write(updated)
    return old_version


def sha256_file(path: str) -> str:
    """Посчитать SHA256 файла, читая его блоками."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_version(value: str) -> bool:
    """Проверить, что версия похожа на x.y.z."""
    return bool(re.fullmatch(r"\d+\.\d+\.\d+", value or ""))


class Runner:
    """Выполняет команды — или только печатает их в режиме ``--dry-run``."""

    def __init__(self, dry_run: bool) -> None:
        self.dry_run = dry_run
        self.commands: List[List[str]] = []

    def run(self, command: Sequence[str], what: str = "") -> None:
        """Выполнить команду или напечатать её в сухом режиме."""
        printable = " ".join(command)
        if self.dry_run:
            log("    $ %s" % printable)
            self.commands.append(list(command))
            return
        if what:
            log("  → %s" % what)
        log("    $ %s" % printable)
        try:
            subprocess.run(list(command), cwd=ROOT, check=True)
        except FileNotFoundError as exc:
            raise SystemExit("ошибка: команда не найдена: %s" % (exc,)) from exc
        except subprocess.CalledProcessError as exc:
            raise SystemExit(
                "ошибка: команда завершилась с кодом %d: %s"
                % (exc.returncode, printable)
            ) from exc


def git_output(args: Sequence[str]) -> str:
    """Прочитать вывод git (только чтение, безопасно и в сухом режиме)."""
    try:
        result = subprocess.run(
            ["git"] + list(args),
            cwd=ROOT,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return ""
    return result.stdout.strip()


def print_state(version: str, platform_name: str, out_dir: str) -> None:
    """Напечатать текущее состояние репозитория, важное для релиза."""
    log("Состояние репозитория:")
    remotes = git_output(["remote", "-v"])
    if remotes:
        for line in remotes.splitlines():
            log("  %s" % line)
    else:
        log("  (git-remote'ов нет)")
    dirty = git_output(["status", "--porcelain"])
    if dirty:
        log("  рабочее дерево: ЕСТЬ незакоммиченные изменения (%d строк)"
            % len(dirty.splitlines()))
    else:
        log("  рабочее дерево: чистое")
    log("  версия в CMakeLists.txt: %s" % version)
    log("  платформа пакета: %s (%s)" % (platform_name, PLATFORM_TITLES[platform_name]))
    log("  каталог артефактов: %s" % os.path.join(ROOT, out_dir))


def license_blocker(hard: bool) -> bool:
    """Проверить наличие LICENSE.

    ``hard=True`` — настоящий выпуск: без лицензии работа останавливается.
    ``hard=False`` — печать плана и упаковка в CI: только предупреждение.
    """
    found = [
        name for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING")
        if os.path.exists(os.path.join(ROOT, name))
    ]
    if found:
        log("  лицензия: %s" % ", ".join(found))
        return True
    log("  лицензия: НЕ НАЙДЕНА — это блокер публичного релиза")
    log("    кандидаты и их плюсы/минусы: docs/RELEASING.md")
    if hard:
        log("")
        log("Настоящий выпуск отменён: у проекта нет лицензии.")
        log("Выберите лицензию, положите LICENSE в корень и повторите.")
        log("Публикация без лицензии делает код юридически неиспользуемым.")
        raise SystemExit(2)
    return False


def build_steps(runner: Runner, build_dir: str) -> None:
    """Конфигурация и сборка Release."""
    log("")
    log("2. Сборка Release")
    path = os.path.join(ROOT, build_dir)
    runner.run(
        ["cmake", "-S", ".", "-B", build_dir,
         "-DCMAKE_BUILD_TYPE=Release"],
        what="конфигурация",
    )
    runner.run(["cmake", "--build", build_dir, "-j"], what="сборка")
    log("    бинарник: %s" % path)


def test_steps(runner: Runner, build_dir: str, skip_tests: bool) -> None:
    """Тесты без окна: C-тесты и юнит-тесты логики $ под qjs."""
    log("")
    log("3. Тесты без окна")
    if skip_tests:
        log("    пропущены ключом --skip-tests (осознанное решение)")
        return
    suffix = PLATFORMS[host_platform()][1]
    tests_dir = os.path.join(build_dir, "tests")
    for test in ("r2d_json_test", "r2d_crypto_test"):
        runner.run([os.path.join(tests_dir, test + suffix)])
    qjs = os.path.join(build_dir, "_deps", "quickjs-build", "qjs" + suffix)
    if not runner.dry_run and not os.path.exists(os.path.join(ROOT, qjs)):
        log("    предупреждение: не нашёл %s — qjs-тесты пропущены" % qjs)
        return
    for name in sorted(os.listdir(os.path.join(ROOT, "tests", "js"))):
        if name.endswith("_test.mjs"):
            runner.run([qjs, os.path.join("tests", "js", name)])
    log("    оконные и агентские тесты не запускаются: нужен SDL_GPU-драйвер;")
    log("    локально — python3 tools/run_tests.py")


def collect_runtime_files(
    binary: str, with_demos: bool
) -> List[Tuple[str, str]]:
    """Собрать список «бинарник + данные» для пакета.

    Возвращает пары (источник, назначение в пакете) с путями относительно
    корня репозитория. Отсутствующие необязательные элементы отсеиваются
    на этапе копирования.
    """
    files: List[Tuple[str, str]] = []
    files.append((binary, os.path.basename(binary)))
    for name in DOC_FILES:
        if os.path.exists(os.path.join(ROOT, name)):
            files.append((name, name))
    for directory in ("assets", "game"):
        if os.path.isdir(os.path.join(ROOT, directory)):
            files.append((directory, directory))
    if with_demos and os.path.isdir(os.path.join(ROOT, "demos")):
        files.append(("demos", "demos"))
    return files


def package_platform(
    runner: Runner,
    platform_name: str,
    binary: str,
    out_dir: str,
    with_demos: bool,
    version: str,
    force: bool = False,
) -> None:
    """Упаковать одну платформу: dist/<os>-<arch>/ + архив + SHA256SUMS."""
    log("")
    log("4. Упаковка %s" % platform_name)
    target = os.path.join(ROOT, out_dir, platform_name)
    archive_ext = PLATFORMS[platform_name][2]
    archive = os.path.join(ROOT, out_dir, "russiano2d-%s.%s" % (platform_name, archive_ext))

    if runner.dry_run:
        log("    каталог пакета: %s" % target)
        if os.path.isdir(target) and os.listdir(target):
            log("    внимание: каталог уже существует и будет пересобран "
                "(нужен --force)")
        log("    содержимое:")
        for source, dest in collect_runtime_files(binary, with_demos):
            mark = "" if os.path.exists(os.path.join(ROOT, source)) else "  (нет — будет пропущено)"
            log("      %s → %s%s" % (source, dest, mark))
        log("    архив: %s" % archive)
        log("    контрольные суммы: %s/SHA256SUMS.txt" % target)
        return

    if os.path.isdir(target) and os.listdir(target) and not force:
        raise SystemExit(
            "ошибка: %s уже существует и не пуст.\n"
            "Уберите его вручную или повторите с --force "
            "(каталог будет удалён)." % target
        )
    if os.path.isdir(target):
        shutil.rmtree(target)
    os.makedirs(target, exist_ok=True)
    for source, dest in collect_runtime_files(binary, with_demos):
        source_path = os.path.join(ROOT, source)
        dest_path = os.path.join(target, dest)
        if not os.path.exists(source_path):
            log("    пропускаю отсутствующий %s" % source)
            continue
        if os.path.isdir(source_path):
            shutil.copytree(source_path, dest_path, dirs_exist_ok=True)
        else:
            shutil.copy2(source_path, dest_path)
            if source == binary:
                os.chmod(dest_path, 0o755)

    # Предупреждения о лицензиях: полные тексты должны лежать в пакете.
    if not any(os.path.exists(os.path.join(target, name)) for name in ("LICENSE", "LICENSE.md")):
        log("    внимание: в пакете нет LICENSE — см. THIRD_PARTY_NOTICES.md")

    # SHA256SUMS.txt внутри пакета: хеши файлов относительно каталога.
    sums_path = os.path.join(target, "SHA256SUMS.txt")
    entries: List[str] = []
    for root, _dirs, names in os.walk(target):
        for name in sorted(names):
            full = os.path.join(root, name)
            relative = os.path.relpath(full, target)
            if relative == "SHA256SUMS.txt":
                continue
            entries.append("%s  %s" % (sha256_file(full), relative))
    entries.sort(key=lambda line: line.split("  ", 1)[1])
    with open(sums_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(entries) + "\n")
    log("    записано %s (%d файлов)" % (sums_path, len(entries)))

    # Архив: tar.gz или zip.
    os.makedirs(os.path.join(ROOT, out_dir), exist_ok=True)
    base = archive
    if archive_ext == "zip":
        base = archive[: -len(".zip")]
    elif archive_ext == "tar.gz":
        base = archive[: -len(".tar.gz")]
    shutil.make_archive(base, "zip" if archive_ext == "zip" else "gztar", root_dir=target)
    log("    архив: %s" % archive)

    # Сводные суммы по архивам всего релиза.
    _write_global_sums(out_dir)


def _write_global_sums(out_dir: str) -> None:
    """Пересчитать dist/SHA256SUMS.txt по всем архивам релиза."""
    directory = os.path.join(ROOT, out_dir)
    entries: List[str] = []
    for name in sorted(os.listdir(directory)):
        full = os.path.join(directory, name)
        if not os.path.isfile(full) or name == "SHA256SUMS.txt":
            continue
        if name.endswith((".tar.gz", ".zip")):
            entries.append("%s  %s" % (sha256_file(full), name))
    if not entries:
        return
    with open(os.path.join(directory, "SHA256SUMS.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(entries) + "\n")


def tag_steps(runner: Runner, version: str, skip_tag: bool) -> None:
    """Поставить аннотированный тег vX.Y.Z (без push)."""
    log("")
    log("5. Тег")
    if skip_tag:
        log("    пропущен ключом --skip-tag")
        return
    tag = "v%s" % version
    if not runner.dry_run and git_output(["tag", "--list", tag]):
        raise SystemExit("ошибка: тег %s уже существует" % tag)
    runner.run(["git", "tag", "-a", tag, "-m", "Russiano2D %s" % version])
    log("    push тегов не делается: это отдельное осознанное действие")
    log("    git push origin %s && git push mos %s" % (tag, tag))


def print_plan_header(args: "Options") -> None:
    """Напечатать шапку плана."""
    kind = "ПЛАН (сухой прогон, ничего не меняется)" if args.dry_run else "ВЫПУСК РЕЛИЗА"
    log("=" * 70)
    log("russiano2d — %s" % kind)
    log("=" * 70)


class Options:
    """Разобранные аргументы командной строки."""

    def __init__(self) -> None:
        self.dry_run = False
        self.yes = False
        self.version: Optional[str] = None
        self.platforms: List[str] = []
        self.build_dir = DEFAULT_BUILD_DIR
        self.out_dir = DEFAULT_OUT_DIR
        self.binary: Optional[str] = None
        self.skip_build = False
        self.skip_tests = False
        self.skip_tag = False
        self.package_only = False
        self.with_demos = False
        self.force = False


def usage() -> str:
    """Текст справки."""
    return (
        "Использование: python3 tools/release.py [ключи]\n"
        "\n"
        "Режимы:\n"
        "  --dry-run, -n        показать план и ничего не делать (обязательная\n"
        "                       проверка перед настоящим выпуском)\n"
        "  --package-only       только упаковать готовый бинарник (режим CI):\n"
        "                       без версии, сборки, тестов и тега\n"
        "  --yes                не спрашивать подтверждение (для скриптов)\n"
        "\n"
        "Ключи:\n"
        "  --version X.Y.Z      версия релиза (поднимается в CMakeLists.txt)\n"
        "  --platform СПИСОК    платформы через запятую; по умолчанию — текущая.\n"
        "                       Доступны: %s\n"
        "  --build-dir DIR      каталог сборки (по умолчанию %s)\n"
        "  --out DIR            каталог артефактов (по умолчанию %s)\n"
        "  --binary PATH        бинарник для --package-only\n"
        "  --with-demos         положить в пакет ещё и demos/\n"
        "  --force              разрешить пересобрать непустой dist/<os>-<arch>/\n"
        "                       (каталог будет удалён)\n"
        "  --skip-build         не собирать (бинарник уже готов)\n"
        "  --skip-tests         не прогонять тесты\n"
        "  --skip-tag           не ставить тег\n"
        "  --help, -h           эта справка\n"
        % (", ".join(sorted(PLATFORMS)), DEFAULT_BUILD_DIR, DEFAULT_OUT_DIR)
    )


def parse_args(argv: List[str]) -> Options:
    """Разобрать аргументы вручную (без argparse)."""
    options = Options()
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg in ("--help", "-h"):
            print(usage())
            raise SystemExit(0)
        if arg in ("--dry-run", "-n"):
            options.dry_run = True
        elif arg == "--yes":
            options.yes = True
        elif arg == "--package-only":
            options.package_only = True
        elif arg == "--with-demos":
            options.with_demos = True
        elif arg == "--force":
            options.force = True
        elif arg == "--skip-build":
            options.skip_build = True
        elif arg == "--skip-tests":
            options.skip_tests = True
        elif arg == "--skip-tag":
            options.skip_tag = True
        elif arg in ("--version", "--platform", "--build-dir", "--out", "--binary"):
            index += 1
            if index >= len(argv):
                raise SystemExit("ошибка: %s требует значение" % arg)
            value = argv[index]
            if arg == "--version":
                options.version = value
            elif arg == "--platform":
                options.platforms = [item.strip() for item in value.split(",") if item.strip()]
            elif arg == "--build-dir":
                options.build_dir = value
            elif arg == "--out":
                options.out_dir = value
            else:
                options.binary = value
        else:
            log("ошибка: неизвестный ключ %r" % arg)
            print(usage())
            raise SystemExit(2)
        index += 1
    return options


def confirm(question: str, assume_yes: bool) -> None:
    """Спросить подтверждение. Без TTY и без --yes — отказ."""
    if assume_yes:
        log("Подтверждено ключом --yes.")
        return
    if not sys.stdin.isatty():
        raise SystemExit(
            "ошибка: нет терминала для подтверждения; используйте --yes "
            "или --dry-run"
        )
    answer = input("%s Введите 'да' для продолжения: " % question).strip().lower()
    if answer != "да":
        raise SystemExit("отменено пользователем")


def main(argv: List[str]) -> int:
    """Точка входа: собрать план, при необходимости выполнить его."""
    options = parse_args(argv)

    current = read_version()
    version = options.version or current
    if not check_version(version):
        raise SystemExit("ошибка: версия %r не похожа на x.y.z" % version)

    if options.package_only:
        return run_package_only(options, version)

    if not options.platforms:
        options.platforms = [host_platform()]
    unknown = [name for name in options.platforms if name not in PLATFORMS]
    if unknown:
        raise SystemExit(
            "ошибка: неизвестные платформы: %s\nдоступны: %s"
            % (", ".join(unknown), ", ".join(sorted(PLATFORMS)))
        )

    print_plan_header(options)
    log("")
    log("1. Версия")
    if options.version and options.version != current:
        log("    %s → %s (CMakeLists.txt)" % (current, options.version))
    else:
        log("    остаётся %s" % current)

    print_state(current, options.platforms[0], options.out_dir)
    license_blocker(hard=False)

    log("")
    log("Шаги:")
    if options.version and options.version != current:
        log("  1. поднять версию: %s → %s" % (current, options.version))
    else:
        log("  1. версию не менять (%s)" % current)

    # План всегда только печатает команды: настоящая работа — ниже, после
    # подтверждения. Иначе реальный прогон начал бы собирать до вопроса.
    plan = Runner(True)

    if options.skip_build:
        log("  2. сборка: пропущена ключом --skip-build")
    else:
        build_steps(plan, options.build_dir)

    test_steps(plan, options.build_dir, options.skip_tests)

    for name in options.platforms:
        binary = options.binary or os.path.join(
            options.build_dir, binary_name(name)
        )
        package_platform(
            plan, name, binary, options.out_dir, options.with_demos, version,
            force=options.force,
        )

    tag_steps(plan, version, options.skip_tag)

    log("")
    if options.dry_run:
        log("Сухой прогон завершён: план выше, репозиторий не изменён.")
        log("Для настоящего выпуска повторите без --dry-run.")
        return 0

    # --- Настоящий выпуск -------------------------------------------------
    log("")
    log("!" * 70)
    log("ВНИМАНИЕ: сейчас будут реально изменены файлы, собрана сборка и")
    log("поставлен git-тег v%s. Push не делается." % version)
    log("!" * 70)
    confirm("Выпустить релиз v%s?" % version, options.yes)

    # Лицензия — жёсткая проверка ровно перед реальными действиями.
    license_blocker(hard=True)

    if options.version and options.version != current:
        old = write_version(options.version)
        log("Версия в CMakeLists.txt: %s → %s" % (old, options.version))

    real = Runner(False)
    if not options.skip_build:
        build_steps(real, options.build_dir)
    test_steps(real, options.build_dir, options.skip_tests)

    for name in options.platforms:
        binary = options.binary or os.path.join(options.build_dir, binary_name(name))
        package_platform(
            real, name, binary, options.out_dir,
            options.with_demos, version, force=options.force,
        )

    tag_steps(real, version, options.skip_tag)

    log("")
    log("Готово. Дальше вручную:")
    log("  git push origin main && git push origin v%s" % version)
    log("  git push mos main && git push mos v%s" % version)
    log("  проверить выгрузку релиза на hub.mos.ru")
    return 0


def run_package_only(options: Options, version: str) -> int:
    """Режим CI: упаковать уже собранный бинарник, ничего не собирая."""
    if not options.platforms:
        options.platforms = [host_platform()]
    unknown = [name for name in options.platforms if name not in PLATFORMS]
    if unknown:
        raise SystemExit(
            "ошибка: неизвестные платформы: %s" % ", ".join(unknown)
        )
    runner = Runner(options.dry_run)
    log("=" * 70)
    log("russiano2d — УПАКОВКА (--package-only), версия %s" % version)
    log("=" * 70)
    # Упаковка — не публикация: без лицензии только предупреждаем.
    license_blocker(hard=False)
    for name in options.platforms:
        binary = options.binary or os.path.join(
            options.build_dir, binary_name(name)
        )
        if not options.dry_run and not os.path.exists(os.path.join(ROOT, binary)):
            raise SystemExit("ошибка: не нашёл бинарник %s" % binary)
        package_platform(
            runner, name, binary, options.out_dir, options.with_demos, version,
            force=options.force,
        )
    log("")
    log("Упаковка завершена." if not options.dry_run else "Сухой прогон упаковки.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        log("")
        log("прервано пользователем")
        raise SystemExit(130)
