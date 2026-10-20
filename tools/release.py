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

Лицензия проекта (авторская) лежит в ``LICENSE``; настоящий запуск без этого
файла останавливается — см. ``docs/RELEASING.md``.

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

import glob
import gzip
import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
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

#: Фиксированное время файлов внутри архива: повторная упаковка из того же
#: дерева даёт побайтно тот же архив (SPEC: «повторная упаковка не меняет
#: содержимое»). Обычные mtime файлов и gzip-заголовок иначе текут.
ARCHIVE_MTIME = 0

#: Файл с версией пакета: manifest версии рядом с SHA256SUMS.
VERSION_FILE = "VERSION"

#: Файлы, которые кладутся в каждый пакет рядом с бинарником.
DOC_FILES = ("CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "LICENSE")

#: Внутренние документы, публикующиеся правила и фильтры копирования живут в
#: tools/public_docs.py: то же правило использует сайт документации
#: (site/build-doc.py, файл вне репозитория), и разъезжаться им нельзя.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from public_docs import (  # noqa: E402  (импорт после правки sys.path)
    INTERNAL_DOCS,
    PACKAGE_IGNORE,
    internal_files,
    is_internal_doc,
    package_ignore,
    public_docs_ignore,
)

#: Корневые элементы пакета (кладутся рядом с бинарником).
PACKAGE_ROOT_ENTRIES = ("sdk", "sdk_tools.json", "SDK_HANDOFF.md",
                        "Следующая цель SDK AGENT.md", "docs",
                        # Generated $ API artifacts: SDK consumers get the same
                        # schema/typings the CLI/lint/doctor use.
                        "api.schema.json", "russiano2d.d.ts")


def package_root_entries() -> List[str]:
    """Корневые элементы пакета без внутренних документов."""
    return [name for name in PACKAGE_ROOT_ENTRIES if not is_internal_doc(name)]

#: Шаблоны README.md и AGENTS.md для пакета платформы.
TEMPLATE_DIR = os.path.join(ROOT, "tools", "templates")

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


def bump_version(current: str, kind: str = "patch") -> str:
    """Следующая версия от ``current``.

    ``kind`` — что именно поднимаем:

    * ``patch`` (по умолчанию) — 0.1.0 → 0.1.1;
    * ``minor`` — 0.1.5 → 0.2.0;
    * ``major`` — 0.1.5 → 1.0.0;
    * явная версия ``X.Y.Z`` — берётся как есть (например ``1.2.0``), но
      обязательно БОЛЬШЕ текущей: понижать версию молча нельзя.
    """
    if not check_version(current):
        raise SystemExit("ошибка: версия %r не похожа на x.y.z" % current)
    major, minor, patch = (int(part) for part in current.split("."))
    kind = (kind or "patch").strip()
    if check_version(kind):
        target = tuple(int(part) for part in kind.split("."))
        if target <= (major, minor, patch):
            raise SystemExit(
                "ошибка: версия %s не больше текущей %s — понижение версии "
                "делается вручную и осознанно" % (kind, current))
        return "%d.%d.%d" % target
    if kind == "patch":
        return "%d.%d.%d" % (major, minor, patch + 1)
    if kind == "minor":
        return "%d.%d.0" % (major, minor + 1)
    if kind == "major":
        return "%d.0.0" % (major + 1)
    raise SystemExit(
        "ошибка: неизвестный вид подъёма версии %r (patch|minor|major|X.Y.Z)" % kind)


def run_bump(options: "Options") -> int:
    """Режим ``--bump``: поднять патч-версию в CMakeLists.txt.

    В stdout уходит ТОЛЬКО новая версия — её подхватывает build_and_push.command:
    ``NEW=$(python3 tools/release.py --bump)``. Человеческое сообщение идёт в
    stderr, чтобы не попасть в подстановку.
    """
    current = read_version()
    new_version = bump_version(current, getattr(options, "bump", "patch")
                               if isinstance(getattr(options, "bump", None), str) else "patch")
    if options.dry_run:
        print("Сухой прогон: версия осталась бы %s → %s" % (current, new_version),
              file=sys.stderr)
        print(new_version)
        return 0
    write_version(new_version)
    print("Версия в CMakeLists.txt: %s → %s" % (current, new_version),
          file=sys.stderr)
    print(new_version)
    return 0


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
    suffix = '.exe' if binary.lower().endswith('.exe') else ''
    sdk_binary = os.path.join(os.path.dirname(binary), 'r2d-sdk' + suffix)
    files.append((sdk_binary, 'r2d-sdk' + suffix))
    # Кликабельный запуск SDK (двойной клик): тот же runtime, `--game sdk`.
    launcher = os.path.join(os.path.dirname(binary), 'russiano2d-sdk' + suffix)
    if os.path.exists(launcher):
        files.append((launcher, 'russiano2d-sdk' + suffix))
    macos_app = os.path.join(os.path.dirname(binary), 'Russiano2D SDK.app')
    if os.path.isdir(macos_app):
        files.append((macos_app, 'Russiano2D SDK.app'))
    for name in package_root_entries():
        files.append((name, name))
    for name in DOC_FILES:
        if os.path.exists(os.path.join(ROOT, name)):
            files.append((name, name))
    # Игра по умолчанию — демо VN (game_vn). Платформер из game/ в пакет
    # больше не кладём; он остаётся в репозитории как демо.
    if os.path.isdir(os.path.join(ROOT, "game_vn")):
        files.append(("game_vn", "game"))
    elif os.path.isdir(os.path.join(ROOT, "game")):
        files.append(("game", "game"))
    if os.path.isdir(os.path.join(ROOT, "assets")):
        files.append(("assets", "assets"))
    if with_demos and os.path.isdir(os.path.join(ROOT, "demos")):
        files.append(("demos", "demos"))
    return files


#: Порядок, в котором документы идут в приложении; остальные — по алфавиту.
AGENTS_DOC_ORDER = (
    "docs/AGENT_IMPLEMENTATION_RULES.md",
    "docs/PHILOSOPHY.md",
    "docs/UI_RMLUI_LAW.md",
    "docs/ARCHITECTURE.md",
    "docs/HIGH_LEVEL_API.md",
    "docs/AGENT_API.md",
    "docs/BUILD.md",
    "docs/tutorial-first-game.md",
    "docs/tutorial-platformer.md",
    "docs/tutorial-menus.md",
    # Вертикальные примеры спецификации: у каждого свой гайд рядом с API.
    "docs/tutorial-melee.md",
    "docs/tutorial-runtime-integration.md",
    "docs/demos.md",
    "docs/TASKS.md",
    "docs/HIGH_LEVEL_API_PERF.md",
)


def agents_doc_files() -> List[str]:
    """ПУБЛИЧНЫЕ документы движка: ``docs/*.md`` и ``docs/highlevel/*.md``.

    Список не задаётся руками: новый файл в docs/ попадёт в AGENTS.md сам,
    поэтому документ не может разойтись с документацией. Исключение одно —
    `INTERNAL_DOCS`: внутренние рабочие документы в поставку не идут (иначе
    чужой отчёт и наши журналы приёмки уезжали бы в пакет одним файлом).
    """
    found = [
        os.path.relpath(path, ROOT)
        for path in (
            glob.glob(os.path.join(ROOT, "docs", "*.md"))
            + glob.glob(os.path.join(ROOT, "docs", "highlevel", "*.md"))
        )
        if not is_internal_doc(os.path.relpath(path, ROOT))
    ]
    preferred = [name for name in AGENTS_DOC_ORDER if name in found]
    rest = sorted(name for name in found if name not in preferred)
    return preferred + rest


def agents_docs_appendix() -> str:
    """Собрать приложение со всей документацией движка целиком."""
    files = agents_doc_files()
    if not files:
        return ""

    toc = ["\n\n---\n\n# Приложение: вся документация движка\n",
           "\nНиже — полные тексты справочников, чтобы не искать их в интернете.\n\n"]
    bodies = []
    for name in files:
        with open(os.path.join(ROOT, name), encoding="utf-8") as handle:
            text = handle.read()
        title = name
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        toc.append("* %s — `%s`\n" % (title, name))
        bodies.append(
            "\n\n---\n\n## %s\n\n<sub>источник: `%s`</sub>\n\n%s"
            % (title, name, text)
        )
    return "".join(toc) + "".join(bodies)


def render_agents_doc(platform_name: str, version: str) -> str:
    """Полный текст AGENTS.md для платформы: шаблон + вся документация."""
    binary = binary_name(platform_name)
    run, run_note, build_note = platform_runtime_note(platform_name, binary)
    values = {
        "VERSION": version,
        "PLATFORM": platform_name,
        "PLATFORM_TITLE": PLATFORM_TITLES.get(platform_name, platform_name),
        "BINARY": binary,
        "RUN": run,
        "RUN_NOTE": run_note,
        "BUILD_NOTE": build_note,
    }
    template_path = os.path.join(TEMPLATE_DIR, "AGENTS-platform.md")
    if not os.path.exists(template_path):
        return ""
    with open(template_path, encoding="utf-8") as handle:
        text = handle.read()
    for key, value in values.items():
        text = re.sub(r"\{\{\s*" + key + r"\s*\}\}", lambda _m, v=value: v, text)
    return text + agents_docs_appendix()


def platform_runtime_note(platform_name: str, binary: str) -> Tuple[str, str, str]:
    """Вернуть (команда запуска, подсказка к запуску, подсказка к сборке)."""
    system = PLATFORMS[platform_name][0]
    if system == "macos":
        return (
            "./" + binary,
            "**macOS:** если система откажется запускать файл — переподпиши его: "
            "`codesign --force --sign - %s`" % binary,
            "**macOS:** собранную игру тоже подпиши (`codesign --force --sign - mygame-release`). "
            "Груз по умолчанию не шифруется — включить: `--encrypt`.",
        )
    if system == "windows":
        return (
            ".\\" + binary,
            "**Windows:** запускать из PowerShell или cmd в этой папке: `.\\%s`" % binary,
            "**Windows:** собранная игра — такой же `.exe`, дописывать ничего не нужно. "
            "Груз шифруется по умолчанию.",
        )
    return (
        "./" + binary,
        "**Linux:** если файл не запускается — `chmod +x %s`" % binary,
        "**Linux:** запуск: `chmod +x mygame-release`; распространяйте соседний `lib/`, если он создан builder. "
        "Груз шифруется по умолчанию.",
    )


def _macos_deps(path: str) -> List[str]:
    """Внешние (не системные) dylib'ы, от которых зависит файл."""
    result = subprocess.run(["otool", "-L", path], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL)
    if result.returncode != 0:
        return []
    deps: List[str] = []
    for line in result.stdout.decode("utf-8", "replace").splitlines()[1:]:
        dep = line.strip().split(" ")[0]
        # /usr/lib и /System — часть системы, их тащить не нужно.
        if dep.startswith(("/opt/homebrew", "/usr/local")) and os.path.exists(dep):
            deps.append(dep)
    return deps


def _rpaths(path: str) -> List[str]:
    """Список LC_RPATH файла."""
    result = subprocess.run(["otool", "-l", path], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL)
    if result.returncode != 0:
        return []
    return re.findall(r"LC_RPATH\s+cmdsize \d+\s+path (\S+)",
                      result.stdout.decode("utf-8", "replace"))


def _normalize_rpaths(path: str, keep: str) -> None:
    """Оставить только rpath пакета.

    Иначе динамический загрузчик находит библиотеку по чужому пути раньше
    (например /opt/homebrew/lib) и тянет её из Homebrew, а не из пакета —
    на чужой машине это «Library not loaded».
    """
    for rpath in _rpaths(path):
        if rpath != keep:
            subprocess.run(["install_name_tool", "-delete_rpath", rpath, path],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if keep not in _rpaths(path):
        subprocess.run(["install_name_tool", "-add_rpath", keep, path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def bundle_macos_libs(target: str, binaries: Sequence[str]) -> None:
    """Положить внешние dylib'ы в пакет и переписать пути на @rpath.

    Без этого собранный движок запускается только на машине, где уже стоит
    Homebrew с теми же библиотеками: «Library not loaded: /opt/homebrew/...».
    Целевой rpath (@loader_path/lib) задан при сборке в CMakeLists.txt.
    """
    if not shutil.which("otool") or not shutil.which("install_name_tool"):
        log("    внимание: нет otool/install_name_tool — библиотеки не упакованы")
        return
    deps: List[str] = []
    for binary_path in binaries:
        for dep in _macos_deps(binary_path):
            if dep not in deps:
                deps.append(dep)
    if not deps:
        return

    lib_dir = os.path.join(target, "lib")
    os.makedirs(lib_dir, exist_ok=True)
    copied: List[str] = []
    pending = list(deps)
    seen = set()
    while pending:
        dep = pending.pop()
        name = os.path.basename(dep)
        if name in seen:
            continue
        seen.add(name)
        dest = os.path.join(lib_dir, name)
        if os.path.exists(dest):
            os.chmod(dest, 0o644)
        shutil.copy2(dep, dest)
        # Homebrew dylib'ы бывают read-only; install_name_tool должен уметь
        # переписать файл, иначе упаковка падает на втором прогоне.
        os.chmod(dest, 0o755)
        copied.append(dest)
        # Библиотека ссылается на свои зависимости по @rpath и ищет их рядом.
        subprocess.run(["install_name_tool", "-id", "@rpath/" + name, dest],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _normalize_rpaths(dest, "@loader_path")
        for sub in _macos_deps(dep):
            subprocess.run(["install_name_tool", "-change", sub,
                            "@rpath/" + os.path.basename(sub), dest],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.basename(sub) not in seen:
                pending.append(sub)

    for binary_path in binaries:
        # Бинарник должен искать библиотеки рядом с собой, а не в Homebrew.
        _normalize_rpaths(binary_path, "@loader_path/lib")
        for dep in _macos_deps(binary_path):
            subprocess.run(["install_name_tool", "-change", dep,
                            "@rpath/" + os.path.basename(dep), binary_path],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Правка бинарника сбрасывает подпись — подписываем заново (ad-hoc).
    for path in list(binaries) + copied:
        subprocess.run(["codesign", "--force", "--sign", "-", path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log("    библиотек в пакет: %d" % len(copied))


def render_platform_docs(target: str, platform_name: str, version: str) -> None:
    """Положить в пакет README.md и AGENTS.md именно для этой платформы."""
    if not os.path.isdir(TEMPLATE_DIR):
        log("    шаблоны не найдены (%s) — README/AGENTS в пакет не попали" % TEMPLATE_DIR)
        return
    binary = binary_name(platform_name)
    run, run_note, build_note = platform_runtime_note(platform_name, binary)
    values = {
        "VERSION": version,
        "PLATFORM": platform_name,
        "PLATFORM_TITLE": PLATFORM_TITLES.get(platform_name, platform_name),
        "BINARY": binary,
        "RUN": run,
        "RUN_NOTE": run_note,
        "BUILD_NOTE": build_note,
    }
    for template_name, out_name in (
        ("README-platform.md", "README.md"),
        ("AGENTS-platform.md", "AGENTS.md"),
    ):
        template_path = os.path.join(TEMPLATE_DIR, template_name)
        if not os.path.exists(template_path):
            continue
        with open(template_path, encoding="utf-8") as handle:
            text = handle.read()
        for key, value in values.items():
            text = re.sub(r"\{\{\s*" + key + r"\s*\}\}", lambda _m, v=value: v, text)
        if out_name == "AGENTS.md":
            text = render_agents_doc(platform_name, version)
            if not text:
                continue
        with open(os.path.join(target, out_name), "w", encoding="utf-8") as handle:
            handle.write(text)
        log("    документ: %s" % out_name)


def binary_platform(path: str) -> str:
    """Read executable architecture, rather than trusting archive labels."""
    with open(path, 'rb') as stream:
        header = stream.read(64)
        if header[:4] == b'\x7fELF':
            endian = 'little' if header[5] == 1 else 'big'
            machine = int.from_bytes(header[18:20], endian)
            return {62:'linux-x86_64', 183:'linux-aarch64'}.get(machine, 'unsupported-elf')
        if header[:4] == b'\xcf\xfa\xed\xfe':
            cpu = int.from_bytes(header[4:8], 'little')
            return {0x1000007:'macos-x86_64', 0x100000c:'macos-arm64'}.get(cpu, 'unsupported-macho')
        if header[:2] == b'MZ':
            stream.seek(int.from_bytes(header[60:64], 'little'))
            pe = stream.read(6)
            if pe[:4] == b'PE\0\0' and int.from_bytes(pe[4:6], 'little') == 0x8664:
                return 'windows-x86_64'
        return 'unsupported'


def archive_name(platform_name: str, version: str) -> str:
    """Имя архива релиза — единый контракт имени артефакта.

    Имя собирается в одном месте, потому что его читают сразу четыре стороны:
    локальная упаковка, пакет в CI, шаг прикладывания macOS-архива к уже
    созданному GitHub Release и проверки в тестах. Версия в имени — требование
    §58 плана дополировки: файл релиза обязан быть предсказуемым, а не
    «russiano2d-linux-x86_64.tar.gz» без номера.
    """
    return "russiano2d-v%s-%s.%s" % (version, platform_name, PLATFORMS[platform_name][2])


def prune_stale_archives(out_dir: str, platforms: Sequence[str], version: str) -> List[str]:
    """Убрать из ``out_dir`` архивы этих платформ с другим именем.

    Имя артефакта теперь содержит версию (``archive_name``), поэтому после
    переименования в каталоге релиза оставался бы старый файл без версии — и в
    Dist-хранилище, и в ``SHA256SUMS.txt``, и на странице загрузок оказались бы
    два архива одной платформы. Чужие платформы не трогаем: их обновляет тот,
    кто их собирает (CI или шаг скачивания артефактов).
    """
    removed: List[str] = []
    directory = os.path.join(ROOT, out_dir)
    if not os.path.isdir(directory):
        return removed
    keep = {archive_name(name, version) for name in platforms}
    # Имя платформы в конце: и старое «russiano2d-linux-x86_64.tar.gz», и
    # архив прошлой версии «russiano2d-v0.1.32-linux-x86_64.tar.gz».
    patterns = [re.compile(r"^russiano2d-(?:v[\d.]+-)?%s\.(?:tar\.gz|zip)$"
                           % re.escape(name)) for name in platforms]
    for name in sorted(os.listdir(directory)):
        if name in keep or not any(p.match(name) for p in patterns):
            continue
        os.remove(os.path.join(directory, name))
        removed.append(name)
    return removed


def package_platform(
    runner: Runner,
    platform_name: str,
    binary: str,
    out_dir: str,
    with_demos: bool,
    version: str,
    force: bool = False,
    extras: Sequence[str] = (),
) -> None:
    """Упаковать одну платформу: dist/<os>-<arch>/ + архив + SHA256SUMS.

    ``extras`` — дополнительные готовые файлы (например, собранная игра),
    которые кладутся в тот же каталог платформы до подсчёта контрольных сумм.
    """
    log("")
    log("4. Упаковка %s" % platform_name)
    target = os.path.join(ROOT, out_dir, platform_name)
    archive_ext = PLATFORMS[platform_name][2]
    archive = os.path.join(ROOT, out_dir, archive_name(platform_name, version))

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

    # Не выдавать runtime-only архив за SDK и не стирать старый пакет до
    # проверки обязательного нативного backend.
    suffix = PLATFORMS[platform_name][1]
    sdk_binary = os.path.join(ROOT, os.path.dirname(binary), 'r2d-sdk' + suffix)
    if not os.path.isfile(sdk_binary):
        raise SystemExit('ошибка: SDK backend не найден: %s; соберите r2d-sdk' % sdk_binary)
    if PLATFORMS[platform_name][0] == 'macos':
        app_bundle = os.path.join(ROOT, os.path.dirname(binary), 'Russiano2D SDK.app')
        if not os.path.isdir(app_bundle):
            raise SystemExit('ошибка: macOS app не найден: %s; соберите russiano2d-sdk-app' % app_bundle)
    if not runner.dry_run:
        executables = [os.path.join(ROOT, binary), sdk_binary]
        for executable in executables:
            actual = binary_platform(executable)
            if actual != platform_name:
                raise SystemExit('ошибка: %s имеет архитектуру %s, запрошена %s' % (executable, actual, platform_name))

    # build_and_push передаёт бинарник из dist/<platform>, а target — тот же
    # каталог. Не удаляем источник вместе с target: сначала копируем бинарники
    # и lib/ во временную папку, упаковка читает уже её.
    staged = None
    target_abs = os.path.abspath(target)
    binary_abs = os.path.abspath(os.path.join(ROOT, binary))
    if binary_abs.startswith(target_abs + os.sep):
        staged = tempfile.mkdtemp(prefix='r2d-package-')
        for name in (os.path.basename(binary), 'r2d-sdk' + suffix, 'russiano2d-sdk' + suffix):
            source = os.path.join(os.path.dirname(binary_abs), name)
            if os.path.isfile(source):
                shutil.copy2(source, os.path.join(staged, name))
        source_lib = os.path.join(os.path.dirname(binary_abs), 'lib')
        if os.path.isdir(source_lib):
            shutil.copytree(source_lib, os.path.join(staged, 'lib'), dirs_exist_ok=True)
        source_app = os.path.join(os.path.dirname(binary_abs), 'Russiano2D SDK.app')
        if os.path.isdir(source_app):
            shutil.copytree(source_app, os.path.join(staged, 'Russiano2D SDK.app'),
                            dirs_exist_ok=True)
        binary = os.path.join(staged, os.path.basename(binary))

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
            # package_ignore = мусор ОС + INTERNAL_DOCS: каталог `docs/` едет в
            # пакет без внутренних рабочих документов, но с публичными.
            shutil.copytree(source_path, dest_path, dirs_exist_ok=True,
                            ignore=package_ignore)
        else:
            shutil.copy2(source_path, dest_path)
            if source == binary or dest == 'r2d-sdk' + suffix:
                os.chmod(dest_path, 0o755)

    # Если сборка положила рядом с бинарником каталог lib/ (внешние
    # библиотеки), он едет в пакет: бинарник ищет их через $ORIGIN/lib.
    build_lib = os.path.join(os.path.dirname(os.path.join(ROOT, binary)), "lib")
    if os.path.isdir(build_lib) and os.listdir(build_lib):
        shutil.copytree(build_lib, os.path.join(target, "lib"), dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns(".DS_Store", "__pycache__", "*.pyc", "*.pyo", "state.local.json"))
        log("    библиотек из сборки: %d" % len(os.listdir(build_lib)))

    for extra in extras:
        extra_path = os.path.join(ROOT, extra)
        if not os.path.exists(extra_path):
            log("    пропускаю отсутствующий %s" % extra)
            continue
        extra_dest = os.path.join(target, os.path.basename(extra))
        shutil.copy2(extra_path, extra_dest)
        os.chmod(extra_dest, 0o755)
        log("    дополнительно: %s" % os.path.basename(extra))

    if PLATFORMS[platform_name][0] == "macos":
        executables = []
        for name in sorted(os.listdir(target)):
            path = os.path.join(target, name)
            if os.path.isfile(path) and os.access(path, os.X_OK):
                head = subprocess.run(["file", "-b", path], stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL)
                if b"Mach-O" in head.stdout:
                    executables.append(path)
        bundle_macos_libs(target, executables)

    render_platform_docs(target, platform_name, version)

    # Manifest версии: одна строка с версией из CMakeLists.txt, рядом с
    # SHA256SUMS. Пакет называет свою версию сам, не только в README.
    with open(os.path.join(target, VERSION_FILE), "w", encoding="utf-8") as handle:
        handle.write(version + "\n")

    # Предупреждения о лицензиях: полные тексты должны лежать в пакете.
    if not any(os.path.exists(os.path.join(target, name)) for name in ("LICENSE", "LICENSE.md")):
        log("    внимание: в пакете нет LICENSE — см. THIRD_PARTY_NOTICES.md")

    # SHA256SUMS.txt внутри пакета: хеши файлов относительно каталога.
    # Мусор Finder/питона — из дерева, а не только из списков (см. purge_junk).
    purge_junk(target)

    sums_path = os.path.join(target, "SHA256SUMS.txt")
    entries: List[str] = []
    # Тот же обход, что и для архива: фильтр мусора (.DS_Store, __pycache__ и т.п.)
    # ОБЯЗАН применяться и здесь. Раньше манифест считался своим os.walk, из-за чего
    # в SHA256SUMS попадал .DS_Store, которого в самом архиве уже не было: гейт
    # repository_hygiene ловил «archives: checksums ['.DS_Store']» (v1.2.0).
    for relative in archive_members(target):
        if relative == "SHA256SUMS.txt":
            continue
        entries.append("%s  %s" % (sha256_file(os.path.join(target, relative)), relative))
    entries.sort(key=lambda line: line.split("  ", 1)[1])
    with open(sums_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(entries) + "\n")
    log("    записано %s (%d файлов)" % (sums_path, len(entries)))

    # Архив: tar.gz или zip. Пишем сами: время файлов фиксировано, порядок
    # отсортирован, uid/gid обнулены — повторная упаковка того же дерева даёт
    # тот же архив, а не только тот же список файлов.
    os.makedirs(os.path.join(ROOT, out_dir), exist_ok=True)
    write_archive(target, archive, archive_ext)
    log("    архив: %s" % archive)

    # Старое имя того же архива (без версии) рядом не оставляем: иначе в
    # каталоге релиза лежали бы две копии одной платформы.
    for stale in prune_stale_archives(out_dir, [platform_name], version):
        log("    убран устаревший архив: %s" % stale)

    # Сводные суммы по архивам всего релиза.
    _write_global_sums(out_dir)
    if staged:
        shutil.rmtree(staged, ignore_errors=True)


#: Мусор операционной системы и Python, который не должен попадать в пакет:
#: `.DS_Store` создаётся Finder'ом при любом просмотре каталога и уезжал внутрь
#: архива (нашли в 0.1.35-macos-arm64), `__pycache__` — от локальных прогонов.
ARCHIVE_SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
ARCHIVE_SKIP_DIRS = {"__pycache__", ".git", ".idea", ".vscode"}


def purge_junk(root: str) -> int:
    """Удалить системный мусор из дерева пакета. Возвращает число удалённых.

    Фильтровать только списки (архив, манифест) недостаточно: файлы остаются на
    диске и уезжают в git через `git add -f dist` для KEEP_DIST. Ловили это
    дважды — в релизном коммите v1.2.0 и при его пересборке, поэтому мусор
    убирается из самого дерева сразу после сборки пакета.
    """
    removed = 0
    for dirpath, dirs, names in os.walk(root, topdown=False):
        for name in list(names) + list(dirs):
            if name in ARCHIVE_SKIP_NAMES or name in ARCHIVE_SKIP_DIRS or name.endswith(".pyc"):
                victim = os.path.join(dirpath, name)
                try:
                    if os.path.isdir(victim):
                        shutil.rmtree(victim)
                    else:
                        os.remove(victim)
                    removed += 1
                except OSError:
                    pass
    return removed


def archive_members(target: str) -> List[str]:
    """Отсортированные относительные пути файлов пакета (для архива).

    Системный мусор отфильтровывается здесь, а не «руками перед упаковкой»:
    иначе он возвращается при первом же просмотре каталога в Finder.
    """
    members: List[str] = []
    for root, dirs, names in os.walk(target):
        dirs[:] = sorted(d for d in dirs if d not in ARCHIVE_SKIP_DIRS)
        for name in sorted(names):
            if name in ARCHIVE_SKIP_NAMES or name.endswith(".pyc"):
                continue
            full = os.path.join(root, name)
            if os.path.isfile(full):
                members.append(os.path.relpath(full, target))
    members.sort()
    return members


def write_archive(target: str, archive: str, archive_ext: str) -> str:
    """Записать архив пакета воспроизводимо.

    Формат выбирается по расширению: ``.tar.gz`` или ``.zip``. Время всех
    записей — ``ARCHIVE_MTIME``, права — 0755 для исполняемых и 0644 для
    остальных, порядок — по имени. Так один и тот же каталог даёт один и тот
    же SHA256, и «переупаковали — ничего не изменилось» проверяется хешем.
    """
    if archive_ext == "zip":
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for relative in archive_members(target):
                full = os.path.join(target, relative)
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                mode = 0o755 if os.access(full, os.X_OK) else 0o644
                info.external_attr = mode << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                with open(full, "rb") as handle:
                    bundle.writestr(info, handle.read())
        return archive
    if archive_ext == "tar.gz":
        with open(archive, "wb") as raw:
            # mtime=0 в gzip-заголовке: иначе имя файла и время упаковки в нём.
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=ARCHIVE_MTIME) as packed:
                with tarfile.open(fileobj=packed, mode="w", format=tarfile.PAX_FORMAT) as bundle:
                    for relative in archive_members(target):
                        full = os.path.join(target, relative)
                        info = bundle.gettarinfo(full, arcname="./" + relative)
                        info.mtime = ARCHIVE_MTIME
                        info.uid = info.gid = 0
                        info.uname = info.gname = ""
                        info.mode = 0o755 if os.access(full, os.X_OK) else 0o644
                        with open(full, "rb") as handle:
                            bundle.addfile(info, handle)
        return archive
    raise SystemExit("ошибка: неизвестный формат архива %r" % archive_ext)


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
    log("    git push origin %s   # уедет и на hub.mos.ru, и на gitverse.ru" % tag)


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
        self.extras: List[str] = []
        self.build_dir = DEFAULT_BUILD_DIR
        self.out_dir = DEFAULT_OUT_DIR
        self.binary: Optional[str] = None
        self.skip_build = False
        self.skip_tests = False
        self.skip_tag = False
        self.package_only = False
        self.with_demos = False
        self.force = False
        self.bump = False
        self.check_junk = False


# ---------------------------------------------------------------------------
# Д3: мусор в пакетах — проверка, которая падает ЛОКАЛЬНО
# ---------------------------------------------------------------------------

#: Имена, которых не должно быть ни в дереве пакета, ни в манифесте, ни в архиве.
JUNK_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
JUNK_DIRS = {"__pycache__", ".git", ".idea", ".vscode"}


def _is_junk_path(relative: str) -> bool:
    """Путь (относительный, с /) содержит мусор? Проверяются все сегменты."""
    parts = [p for p in str(relative).replace("\\", "/").split("/") if p]
    for part in parts:
        if part in JUNK_NAMES or part in JUNK_DIRS or part.endswith(".pyc"):
            return True
    return False


def _archive_junk(path: str) -> List[str]:
    """Мусорные записи внутри архива (.zip/.tar.gz/.tar.xz/.tar)."""
    found: List[str] = []
    try:
        if path.endswith(".zip"):
            import zipfile
            with zipfile.ZipFile(path) as archive:
                for name in archive.namelist():
                    if _is_junk_path(name):
                        found.append(name)
        elif path.endswith((".tar.gz", ".tgz", ".tar.xz", ".txz", ".tar")):
            import tarfile
            with tarfile.open(path) as archive:
                for member in archive.getnames():
                    if _is_junk_path(member):
                        found.append(member)
    except (OSError, ValueError, Exception):
        # Битый архив — не наша ошибка Д3; его поймают гейты сборки.
        pass
    return found


def run_check_junk(out_dir: str) -> int:
    """Проверить dist/ на мусор. Возвращает код выхода (0 — чисто).

    Причина: `.DS_Store` трижды попадал в манифесты/архивы, и ловил это CI
    (repository_hygiene) уже после пуша. Здесь проверка стоит на локальном
    пути релиза: build_and_push.command зовёт её ПЕРЕД git add и падает.
    """
    root = out_dir if os.path.isdir(out_dir) else DEFAULT_OUT_DIR
    tree: List[str] = []
    manifests: List[str] = []
    archives: List[str] = []
    for dirpath, dirs, names in os.walk(root if os.path.isdir(root) else "."):
        for name in names:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            if _is_junk_path(rel):
                tree.append(rel)
            if name == "SHA256SUMS.txt":
                manifests.append(full)
            if name.endswith((".zip", ".tar.gz", ".tgz", ".tar.xz", ".txz", ".tar")):
                archives.append(full)

    bad_manifest: List[str] = []
    for manifest in manifests:
        try:
            with open(manifest, encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    if _is_junk_path(line.strip()):
                        bad_manifest.append(os.path.relpath(manifest, root) + ": " + line.strip())
        except OSError:
            continue

    bad_archive: List[str] = []
    for archive in archives:
        for name in _archive_junk(archive):
            bad_archive.append(os.path.relpath(archive, root) + ": " + name)

    problems = tree + bad_manifest + bad_archive
    log("check-junk: %s" % (os.path.abspath(root)))
    log("    файлов мусора в дереве: %d" % len(tree))
    log("    манифестов (SHA256SUMS.txt): %d, строк с мусором: %d" % (len(manifests), len(bad_manifest)))
    log("    архивов: %d, записей с мусором: %d" % (len(archives), len(bad_archive)))
    if not problems:
        log("    чисто")
        return 0
    log("    ПРОВАЛ: мусор не должен уезжать в релиз:")
    for item in problems[:40]:
        log("      - " + item)
    log("    уберите: find %s -name '.DS_Store' -delete, __pycache__ -rm -rf" % root)
    return 1


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
        "  --check-junk         проверить dist/ на мусор (.DS_Store, __pycache__,\n"
        "                       Thumbs.db) в дереве, SHA256SUMS.txt и архивах;\n"
        "                       выход 1 — релиз должен падать ЛОКАЛЬНО, а не в CI\n"
        "  --bump               поднять патч-версию в CMakeLists.txt на 1\n"
        "                       (0.1.0 → 0.1.1) и напечатать её; больше ничего\n"
        "                       не делает — этим пользуется build_and_push.command\n"
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
        elif arg == "--check-junk":
            options.check_junk = True
        elif arg == "--bump":
            options.bump = True
        elif arg.startswith("--bump="):
            options.bump = arg.split("=", 1)[1] or "patch"
        elif arg == "--with-demos":
            options.with_demos = True
        elif arg == "--extra":
            index += 1
            if index >= len(argv):
                raise SystemExit("ошибка: --extra требует значение")
            options.extras.append(argv[index])
        elif arg == "--force":
            options.force = True
        elif arg == "--skip-build":
            options.skip_build = True
        elif arg == "--skip-tests":
            options.skip_tests = True
        elif arg == "--skip-tag":
            options.skip_tag = True
        elif arg == "--print-version":
            options.print_version = True
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

    # --print-version: только версия, без сборки (её читают скрипты).
    if getattr(options, "print_version", False):
        print(read_version())
        return 0

    # --bump ничего не собирает и не проверяет: только версия в CMakeLists.txt.
    if options.bump:
        return run_bump(options)

    if options.check_junk:
        return run_check_junk(options.out_dir)

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
            force=options.force, extras=options.extras,
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
            options.with_demos, version, force=options.force, extras=options.extras,
        )

    tag_steps(real, version, options.skip_tag)

    log("")
    log("Готово. Дальше вручную:")
    log("  git push origin main && git push origin v%s" % version)
    log("  (origin пушит сразу на hub.mos.ru и gitverse.ru)")
    log("  сверка: git ls-remote origin main && git ls-remote gitverse main")
    log("  релиз и ассеты публикует build_and_push (tools/release_publish.py)")
    return 0


def run_package_only(options: Options, version: str) -> int:
    """Упаковать уже собранный бинарник (вызывает build_and_push), ничего не собирая."""
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
            force=options.force, extras=options.extras,
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
