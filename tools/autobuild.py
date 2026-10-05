#!/usr/bin/env python3
"""Автосборка Russiano2D под доступные платформы, результат — в ``dist/``.

Что делает:

* **macOS** — собирает нативно (cmake+ninja) в ``build-autobuild/macos``;
* **Linux** — собирает в контейнере ``ubuntu:24.04`` (образ-сборщик из
  ``tools/docker/Dockerfile.linux-builder``), репозиторий монтируется в
  контейнер, поэтому артефакты сразу ложатся на диск рядом с проектом;
* **Windows** — кросс-компиляция MinGW в том же контейнере (``--with-windows``).

Сборка каждой платформы упаковывается тем же кодом, что и релиз:
``tools/release.py --package-only``. На выходе — ``dist/<platform>/``,
архив и общий ``dist/SHA256SUMS.txt``.

Примеры:

    python3 tools/autobuild.py                       # что можно на этой машине
    python3 tools/autobuild.py --platforms macos-arm64,linux-x86_64
    python3 tools/autobuild.py --debug --jobs 4
    python3 tools/autobuild.py --with-windows        # + кросс-сборка MinGW
"""

from __future__ import annotations

import argparse
import os
import platform
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent
DOCKER_DIR = ROOT / "tools" / "docker"
BUILDER_IMAGE = "russiano2d-builder"
BUILDER_IMAGE_MINGW = "russiano2d-builder:mingw"

#: Сборка каждой платформы идёт в свой каталог; ``build-*/`` уже в .gitignore.
BUILD_ROOT = ROOT / "build-autobuild"

#: Docker CLI пишет служебные файлы в ~/.docker, а агенту этот каталог
#: недоступен — уводим конфиг в /tmp, иначе `docker build` падает на
#: «failed to update builder last activity time».
DOCKER_CONFIG_DIR = "/tmp/russiano2d-docker-config"

ALL_PLATFORMS = ("macos-arm64", "macos-x86_64", "linux-x86_64",
                 "linux-aarch64", "windows-x86_64")

#: Какую платформу контейнера просить у Docker. На Apple Silicon контейнеры по
#: умолчанию arm64, поэтому для linux-x86_64 нужна эмуляция (--platform
#: linux/amd64) — иначе получится arm64-бинарник под именем x86_64.
CONTAINER_PLATFORM = {
    "linux-x86_64": "linux/amd64",
    "linux-aarch64": "linux/arm64",
    "windows-x86_64": None,   # кросс-компиляция, архитектура контейнера не важна
}


def log(message: str = "") -> None:
    print(message, flush=True)


def run(cmd: Sequence[str], cwd: Optional[Path] = None, quiet: bool = False) -> None:
    """Запустить команду, показать её и упасть с понятной ошибкой."""
    shown = " ".join(str(part) for part in cmd)
    log("  $ " + shown)
    result = subprocess.run(
        [str(part) for part in cmd],
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.DEVNULL if quiet else None,
        stderr=subprocess.STDOUT if quiet else None,
    )
    if result.returncode != 0:
        raise SystemExit("команда завершилась с кодом %d:\n  %s" % (result.returncode, shown))


def run_capture(cmd: Sequence[str]) -> subprocess.CompletedProcess:
    """Запустить команду, показать её и вернуть результат (без падения)."""
    log("  $ " + " ".join(str(part) for part in cmd))
    return subprocess.run([str(part) for part in cmd],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def build_via_context(platform_name: str, image: str, inner: str, windows: bool,
                      container_platform: Optional[str]) -> Path:
    """Собрать без общих папок: исходники уезжают в контейнер контекстом.

    Нужен, когда Docker не видит каталог проекта (Resources → File sharing).
    Сборка идёт в ``docker build``, готовый бинарник достаётся через
    ``docker cp`` — общие папки не участвуют вообще.
    """
    build_dir_name = "build-autobuild/" + platform_name
    binary_rel = build_dir_name + ("/russiano2d.exe" if windows else "/russiano2d")

    dockerfile = BUILD_ROOT / ("Dockerfile.%s" % platform_name)
    dockerfile.parent.mkdir(parents=True, exist_ok=True)
    dockerfile.write_text(
        "FROM %s\nCOPY . /src/\nWORKDIR /src\nRUN bash -lc %s\n"
        % (image, shlex.quote(inner)),
        encoding="utf-8",
    )

    tag = "r2d-artifact:" + platform_name
    build_cmd = ["docker", "build", "-f", str(dockerfile), "-t", tag]
    if container_platform:
        build_cmd += ["--platform", container_platform]
    build_cmd.append(str(ROOT))
    run(build_cmd)

    name = "r2d-copy-" + platform_name
    subprocess.run(["docker", "rm", "-f", name],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run(["docker", "create", "--name", name, tag])

    binary = ROOT / build_dir_name / ("russiano2d.exe" if windows else "russiano2d")
    binary.parent.mkdir(parents=True, exist_ok=True)
    run(["docker", "cp", "%s:/src/%s" % (name, binary_rel), str(binary)])
    run(["docker", "rm", "-f", name], quiet=True)
    subprocess.run(["docker", "rmi", "-f", tag],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return binary


def host_platform() -> str:
    """Платформа этой машины в терминах PLATFORMS."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin":
        return "macos-arm64" if machine in ("arm64", "aarch64") else "macos-x86_64"
    if system == "windows":
        return "windows-x86_64"
    return "linux-x86_64"


def prepare_docker_env() -> None:
    """Увести конфиг Docker CLI в доступный каталог (см. DOCKER_CONFIG_DIR)."""
    os.makedirs(DOCKER_CONFIG_DIR, exist_ok=True)
    os.environ.setdefault("DOCKER_CONFIG", DOCKER_CONFIG_DIR)


def docker_available() -> bool:
    """Есть ли живой демон Docker (нужен для Linux и Windows-сборок)."""
    if not shutil.which("docker"):
        return False
    result = subprocess.run(
        ["docker", "info", "--format", "{{.ServerVersion}}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def ensure_builder_image(with_mingw: bool) -> str:
    """Собрать (или переиспользовать) образ-сборщик. Вернуть его имя."""
    tag = BUILDER_IMAGE_MINGW if with_mingw else BUILDER_IMAGE + ":linux"
    marker = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", tag],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if marker.returncode == 0:
        log("[образ] %s уже собран" % tag)
        return tag

    log("[образ] собираю %s (один раз, дальше берётся из кэша)" % tag)
    run([
        "docker", "build",
        "--build-arg", "WITH_MINGW=1" if with_mingw else "WITH_MINGW=0",
        "-t", tag,
        "-f", str(DOCKER_DIR / "Dockerfile.linux-builder"),
        str(DOCKER_DIR),
    ])
    return tag


def cmake_flags(build_type: str) -> List[str]:
    return ["-DCMAKE_BUILD_TYPE=" + build_type]


def build_native(platform_name: str, build_type: str, jobs: int) -> Path:
    """Собрать нативно (macOS или Linux без Docker). Вернуть путь к бинарнику."""
    build_dir = BUILD_ROOT / platform_name
    log("[%s] нативная сборка в %s" % (platform_name, build_dir.relative_to(ROOT)))
    run(["cmake", "-S", str(ROOT), "-B", str(build_dir), "-G", "Ninja",
         *cmake_flags(build_type)])
    run(["cmake", "--build", str(build_dir), "-j", str(jobs)])
    binary = build_dir / "russiano2d"
    if not binary.exists():
        raise SystemExit("не найден бинарник после сборки: %s" % binary)
    return binary


def build_in_container(platform_name: str, build_type: str, jobs: int,
                       image: str, windows: bool = False) -> Path:
    """Собрать Linux (или Windows кросс-сборкой) в контейнере."""
    build_dir_name = "build-autobuild/" + platform_name
    log("[%s] сборка в контейнере %s" % (platform_name, image))

    cmake_extra: List[str] = []
    if windows:
        cmake_extra = [
            "-DCMAKE_SYSTEM_NAME=Windows",
            "-DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc",
            "-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++",
            "-DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres",
            "-DCMAKE_FIND_ROOT_PATH=/usr/x86_64-w64-mingw32",
            "-DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER",
            "-DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY",
            "-DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY",
        ]

    inner = (
        "set -e; "
        "cmake -S /src -B /src/{build} -G Ninja {flags} {extra}; "
        "cmake --build /src/{build} -j {jobs}"
    ).format(
        build=build_dir_name,
        flags=" ".join(cmake_flags(build_type)),
        extra=" ".join(cmake_extra),
        jobs=jobs,
    )

    docker_args = ["docker", "run", "--rm"]
    container_platform = CONTAINER_PLATFORM.get(platform_name)
    if container_platform:
        docker_args += ["--platform", container_platform]
    result = run_capture(docker_args + [
        "--user", "%d:%d" % (os.getuid(), os.getgid()),
        "-e", "HOME=/tmp",
        "-v", "%s:/src" % ROOT,
        "-w", "/src",
        image,
        "bash", "-lc", inner,
    ])
    output = result.stdout.decode("utf-8", "replace")
    if result.returncode != 0:
        print(output, flush=True)

    binary = ROOT / build_dir_name / ("russiano2d.exe" if windows else "russiano2d")

    if result.returncode != 0:
        # Самая частая причина на macOS — каталог проекта не расшарен Docker'у.
        if "mounts denied" in output or "is not shared" in output:
            log("[%s] общие папки не настроены — собираю через контекст "
                "(исходники копируются в контейнер)" % platform_name)
            return build_via_context(platform_name, image, inner, windows,
                                     container_platform)
        raise SystemExit("сборка упала с кодом %d" % result.returncode)

    if not binary.exists():
        raise SystemExit("не найден бинарник после сборки: %s" % binary)
    return binary


def package(platform_name: str, binary: Path, out_dir: Path) -> None:
    """Упаковать собранный бинарник штатным релизным кодом."""
    log("[%s] упаковка в %s" % (platform_name, out_dir))
    run([
        sys.executable, str(ROOT / "tools" / "release.py"),
        "--package-only",
        "--force",
        "--platform", platform_name,
        "--binary", str(binary.relative_to(ROOT)),
        "--out", str(out_dir.relative_to(ROOT)),
    ], cwd=ROOT)


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Собрать Russiano2D под доступные платформы в dist/",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--platforms", default="auto",
                        help="список через запятую или auto (по умолчанию): "
                             + ", ".join(ALL_PLATFORMS))
    parser.add_argument("--debug", action="store_true", help="Debug вместо Release")
    parser.add_argument("--jobs", type=int, default=0, help="параллельных задач (по умолчанию — по числу ядер)")
    parser.add_argument("--with-windows", action="store_true",
                        help="добавить кросс-сборку windows-x86_64 (MinGW в контейнере)")
    parser.add_argument("--out", default="dist", help="каталог артефактов")
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    options = parse_args(argv)
    prepare_docker_env()
    started = time.time()

    jobs = options.jobs or (os.cpu_count() or 2)
    build_type = "Debug" if options.debug else "Release"
    out_dir = Path(options.out)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    docker = docker_available()
    host = host_platform()

    if options.platforms == "auto":
        platforms = [host]
        if docker:
            platforms.append("linux-aarch64" if host == "macos-arm64" else "linux-x86_64")
        if options.with_windows and docker:
            platforms.append("windows-x86_64")
    else:
        platforms = [item.strip() for item in options.platforms.split(",") if item.strip()]
        if options.with_windows and "windows-x86_64" not in platforms:
            platforms.append("windows-x86_64")

    unknown = [name for name in platforms if name not in ALL_PLATFORMS]
    if unknown:
        raise SystemExit("неизвестные платформы: %s\nдоступно: %s"
                         % (", ".join(unknown), ", ".join(ALL_PLATFORMS)))

    log("=" * 70)
    log("Автосборка Russiano2D")
    log("  платформа машины : %s" % host)
    log("  собираем         : %s" % ", ".join(platforms))
    log("  тип сборки       : %s" % build_type)
    log("  задач параллельно: %d" % jobs)
    log("  Docker           : %s" % ("работает" if docker else "недоступен"))
    log("  артефакты        : %s" % out_dir)
    log("=" * 70)

    if not docker and "windows-x86_64" in platforms:
        raise SystemExit("windows-x86_64 собирается кросс-компиляцией в контейнере, "
                         "а Docker не запущен — запусти Docker Desktop и повтори")

    if not docker:
        missing = [p for p in platforms if p != host]
        if missing:
            log("! Docker не запущен — пропускаю: %s" % ", ".join(missing))
            log("  Запусти Docker Desktop и повтори, либо собери только %s." % host)
            platforms = [p for p in platforms if p == host]

    built: List[str] = []
    failed: List[str] = []

    image: Optional[str] = None
    for platform_name in platforms:
        log("")
        log("── %s" % platform_name)
        try:
            if platform_name == host:
                binary = build_native(platform_name, build_type, jobs)
            else:
                if image is None:
                    image = ensure_builder_image("windows-x86_64" in platforms)
                windows = platform_name == "windows-x86_64"
                binary = build_in_container(platform_name, build_type, jobs, image, windows)
            package(platform_name, binary, out_dir)
            built.append(platform_name)
            log("   готово: %s" % binary.relative_to(ROOT))
        except SystemExit as exc:
            failed.append(platform_name)
            log("   ПРОВАЛ: %s" % exc)

    log("")
    log("=" * 70)
    log("Итог за %.1f мин" % ((time.time() - started) / 60.0))
    log("  собрано: %s" % (", ".join(built) if built else "ничего"))
    if failed:
        log("  провалено: %s" % ", ".join(failed))
    log("  артефакты: %s" % out_dir)
    if out_dir.exists():
        for item in sorted(out_dir.iterdir()):
            log("    %s" % item.name)
    log("=" * 70)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
