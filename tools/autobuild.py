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

#: Флаги кросс-компиляции под Windows (MinGW). Набор один на оба пути сборки —
#: контейнерный (Docker) и нативный (Linux-раннер GitVerse, см. --no-docker),
#: чтобы они не разъехались.
#: R2D_MINGW_ROOT переопределяет кросс-корень: в CI freetype ставится не в
#: системный /usr/x86_64-w64-mingw32, а в префикс сборки.
MINGW_ROOT = os.environ.get("R2D_MINGW_ROOT", "/usr/x86_64-w64-mingw32")
MINGW_CMAKE_FLAGS = [
    "-DCMAKE_SYSTEM_NAME=Windows",
    "-DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc",
    "-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++",
    "-DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres",
    "-DCMAKE_FIND_ROOT_PATH=" + MINGW_ROOT,
    "-DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER",
    "-DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY",
    "-DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY",
]

#: Библиотеки, которые в пакет не тащим: они есть в любой системе с glibc.
SKIP_SYSTEM_LIBS = r"lib(c|m|pthread|dl|rt|gcc_s|stdc++).so"


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
    build_cmd = ["docker", "buildx", "build", "--load", "-f", str(dockerfile), "-t", tag]
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
    backend = "r2d-sdk.exe" if windows else "r2d-sdk"
    run(["docker", "cp", "%s:/src/%s/%s" % (name, build_dir_name, backend), str(binary.parent / backend)])
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
    # Keep the real Docker config: redirecting it hides buildx plugins and
    # legacy builder can silently ignore the requested base-image platform.
    pass


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


def ensure_builder_image(with_mingw: bool, container_platform: Optional[str] = None) -> str:
    """Собрать (или переиспользовать) образ-сборщик. Вернуть его имя."""
    container_platform = container_platform or ("linux/arm64" if platform.machine().lower() in ("arm64", "aarch64") else "linux/amd64")
    tag = (BUILDER_IMAGE_MINGW if with_mingw else BUILDER_IMAGE + ":linux") + "-" + container_platform.split("/")[-1]
    marker = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", tag],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if marker.returncode == 0:
        actual = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Architecture}}", tag], text=True).strip()
        if actual == container_platform.split('/')[-1]:
            log("[образ] %s уже собран" % tag)
            return tag
        log("[образ] неверная архитектура %s: %s; пересобираю" % (tag, actual))

    log("[образ] собираю %s (один раз, дальше берётся из кэша)" % tag)
    run([
        "docker", "buildx", "build", "--load", "--platform", container_platform,
        "--build-arg", "WITH_MINGW=1" if with_mingw else "WITH_MINGW=0",
        "-t", tag,
        "-f", str(DOCKER_DIR / "Dockerfile.linux-builder"),
        str(DOCKER_DIR),
    ])
    return tag


def cmake_flags(build_type: str) -> List[str]:
    return ["-DCMAKE_BUILD_TYPE=" + build_type]


def collect_native_libs(binary: Path) -> None:
    """Собрать внешние .so рядом с бинарником — то же, что делает контейнер.

    Бинарник ищет их через rpath ``$ORIGIN/lib`` (см. CMakeLists.txt), а самим
    библиотекам прописываем ``$ORIGIN``: RUNPATH не действует на транзитивные
    зависимости, поэтому libfreetype должен находить libpng рядом с собой.
    """
    lib_dir = binary.parent / "lib"
    lib_dir.mkdir(parents=True, exist_ok=True)
    # Путь бинарника приходит то абсолютным (из build_native), то относительным
    # (если функцию позвали руками) — relative_to на относительном падает.
    try:
        shown = lib_dir.resolve().relative_to(ROOT)
    except ValueError:
        shown = lib_dir
    log("  собираю внешние .so в %s" % shown)
    pipe = (
        "ldd %s 2>/dev/null | awk '{print $3}' | grep -E '^/' "
        "| grep -vE '%s' | xargs -r -I{} cp -L {} %s/ 2>/dev/null || true"
        % (shlex.quote(str(binary)), SKIP_SYSTEM_LIBS, shlex.quote(str(lib_dir)))
    )
    subprocess.run(["bash", "-lc", pipe], check=False)
    libs = list(lib_dir.glob("*.so*"))
    if not libs:
        # Не падаем: у статической сборки внешних .so может не быть вовсе.
        log("  ! внешних .so не нашлось — пакет будет без lib/")
        return
    patchelf = shutil.which("patchelf")
    if patchelf is None:
        # Без patchelf пакет соберётся, но транзитивные зависимости (libfreetype
        # → libpng) могут не найтись на чужой системе. В CI он ставится из apt,
        # локально — тоже; поэтому это предупреждение, а не ошибка.
        log("  ! patchelf не найден — rpath у библиотек не поправлен "
            "(apt-get install patchelf)")
        return
    for so in libs:
        subprocess.run([patchelf, "--set-rpath", "$ORIGIN", str(so)],
                       check=False)
    log("  в lib/ уехало библиотек: %d" % len(libs))


def build_native(platform_name: str, build_type: str, jobs: int,
                 windows: bool = False) -> Path:
    """Собрать нативно (macOS, Linux или кросс-сборка MinGW без Docker)."""
    build_dir = BUILD_ROOT / platform_name
    log("[%s] нативная сборка в %s" % (platform_name, build_dir.relative_to(ROOT)))
    extra = list(MINGW_CMAKE_FLAGS) if windows else []
    if platform_name.startswith("macos"):
        extra.append("-DCMAKE_OSX_ARCHITECTURES=" + ("arm64" if platform_name.endswith("arm64") else "x86_64"))
        if platform_name != host_platform():
            extra += ["-DR2D_BUNDLED_FREETYPE=ON", "-DCMAKE_DISABLE_FIND_PACKAGE_SDL3=ON"]
    run(["cmake", "-S", str(ROOT), "-B", str(build_dir), "-G", "Ninja",
         *cmake_flags(build_type), *extra])
    run(["cmake", "--build", str(build_dir), "-j", str(jobs)])
    binary = build_dir / ("russiano2d.exe" if windows else "russiano2d")
    if not binary.exists():
        raise SystemExit("не найден бинарник после сборки: %s" % binary)
    if not windows and platform_name.startswith("linux"):
        collect_native_libs(binary)
    return binary


def build_in_container(platform_name: str, build_type: str, jobs: int,
                       image: str, windows: bool = False) -> Path:
    """Собрать Linux (или Windows кросс-сборкой) в контейнере."""
    build_dir_name = "build-autobuild/" + platform_name
    log("[%s] сборка в контейнере %s" % (platform_name, image))

    cmake_extra: List[str] = list(MINGW_CMAKE_FLAGS) if windows else []

    binary_rel = build_dir_name + ("/russiano2d.exe" if windows else "/russiano2d")
    flags = " ".join(cmake_flags(build_type))
    extra_flags = " ".join(cmake_extra)

    # После сборки собираем внешние .so рядом с бинарником: пакет должен
    # работать на системе, где этих библиотек нет. Бинарник ищет их в lib/
    # через rpath $ORIGIN/lib, заданный в CMakeLists.txt.
    skip_system = SKIP_SYSTEM_LIBS
    collect_libs = (
        "mkdir -p /src/" + build_dir_name + "/lib; "
        "ldd /src/" + binary_rel + " 2>/dev/null | awk '{print $3}' "
        "| grep -E '^/' "
        "| grep -vE '" + skip_system + "' "
        "| xargs -r -I{} cp -L {} /src/" + build_dir_name + "/lib/ 2>/dev/null || true; "
        # RUNPATH не действует на транзитивные зависимости, поэтому библиотекам
        # прописываем свой: libfreetype находит libpng рядом с собой.
        # Образ-сборщик переиспользуется по факту существования, а не по
        # Dockerfile, поэтому patchelf в нём может отсутствовать (тогда шаг
        # молча ничего не делал) — предупреждаем вслух.
        "if command -v patchelf >/dev/null; then "
        "for so in /src/" + build_dir_name + "/lib/*.so*; do "
        "[ -e \"$so\" ] && patchelf --set-rpath '$ORIGIN' \"$so\" 2>/dev/null || true; done; "
        "else echo '  ! в образе нет patchelf — rpath у .so не поправлен; "
        "пересобери образ: docker rmi " + image + "'; fi"
    )

    inner = (
        "set -e; "
        "cmake -S /src -B /src/" + build_dir_name + " -G Ninja " + flags + " " + extra_flags + "; "
        "cmake --build /src/" + build_dir_name + " -j " + str(jobs) + "; "
        + collect_libs
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


def build_game(platform_name: str, engine: Path) -> Optional[Path]:
    """Собрать игру по умолчанию в один файл — если движок запускается локально.

    Для Linux и Windows движок собирается в контейнере под чужую архитектуру,
    запустить его здесь нельзя, поэтому игра собирается только для платформы
    текущей машины. Без этого переупаковка «съедала» игру из пакета.
    """
    entry = ROOT / "game" / "main.js"
    if not entry.exists():
        return None
    # Имя без платформы: файл лежит внутри dist/<платформа>/ и так.
    out = BUILD_ROOT / "russiano2d-platformer"
    try:
        run([str(engine), "build", "--project", str(ROOT),
             "--entry", "game/main.js", "--out", str(out)])
    except SystemExit as exc:
        log("    игру собрать не удалось: %s" % exc)
        return None
    if out.exists() and platform_name.startswith("macos"):
        subprocess.run(["codesign", "--force", "--sign", "-", str(out)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out if out.exists() else None


def package(platform_name: str, binary: Path, out_dir: Path,
            extras: Sequence[Path] = ()) -> None:
    """Упаковать собранный бинарник штатным релизным кодом."""
    log("[%s] упаковка в %s" % (platform_name, out_dir))
    cmd = [
        sys.executable, str(ROOT / "tools" / "release.py"),
        "--package-only",
        "--force",
        "--platform", platform_name,
        "--binary", str(binary.relative_to(ROOT)),
        "--out", str(out_dir.relative_to(ROOT)),
    ]
    for extra in extras:
        cmd += ["--extra", str(extra.relative_to(ROOT))]
    run(cmd, cwd=ROOT)


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
    parser.add_argument("--no-docker", action="store_true",
                        help="не использовать Docker: Linux собирается нативно, "
                             "Windows — кросс-компиляцией MinGW на этой же машине "
                             "(нужны mingw-w64 и freetype под него; так собирает CI)")
    parser.add_argument("--out", default="dist", help="каталог артефактов")
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    options = parse_args(argv)
    if not options.no_docker:
        prepare_docker_env()
    started = time.time()

    jobs = options.jobs or (os.cpu_count() or 2)
    build_type = "Debug" if options.debug else "Release"
    out_dir = Path(options.out)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # В режиме --no-docker Docker не нужен и не ищется: Linux собирается
    # нативно, Windows — тем же кросс-компилятором MinGW, но прямо на машине.
    docker = False if options.no_docker else docker_available()
    host = host_platform()
    can_cross = host.startswith("linux") and shutil.which("x86_64-w64-mingw32-gcc") is not None

    if options.platforms == "auto":
        platforms = [host]
        if options.no_docker:
            if options.with_windows and can_cross:
                platforms.append("windows-x86_64")
        else:
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
    if options.no_docker:
        log("  Docker           : не используется (--no-docker)")
        log("  кросс-компилятор : MinGW %s" % ("найден" if can_cross else "НЕ найден"))
    else:
        log("  Docker           : %s" % ("работает" if docker else "недоступен"))
    log("  артефакты        : %s" % out_dir)
    log("=" * 70)

    if options.no_docker:
        if "windows-x86_64" in platforms and not can_cross:
            raise SystemExit(
                "windows-x86_64 требует кросс-компилятор MinGW, а "
                "x86_64-w64-mingw32-gcc не найден.\n"
                "Установи: sudo apt-get install -y mingw-w64 xz-utils "
                "(и freetype под MinGW — см. tools/docker/Dockerfile.linux-builder)")
        not_native = [p for p in platforms if p != host and p != "windows-x86_64"]
        if not_native:
            raise SystemExit(
                "в режиме --no-docker на %s нельзя собрать: %s\n"
                "Эти платформы доступны только в контейнере (без --no-docker)."
                % (host, ", ".join(not_native)))
    else:
        if not docker and "windows-x86_64" in platforms:
            raise SystemExit("windows-x86_64 собирается кросс-компиляцией в контейнере, "
                             "а Docker не запущен — запусти Docker Desktop и повтори")
        if not docker:
            missing = [p for p in platforms if p != host]
            if missing:
                log("! Docker не запущен — пропускаю: %s" % ", ".join(missing))
                log("  Запусти Docker Desktop и повтори, либо собери только %s." % host)
                platforms = [p for p in platforms if p == host or (host.startswith("macos") and p.startswith("macos"))]

    built: List[str] = []
    failed: List[str] = []

    images = {}
    for platform_name in platforms:
        log("")
        log("── %s" % platform_name)
        try:
            if options.no_docker:
                binary = build_native(platform_name, build_type, jobs,
                                      windows=(platform_name == "windows-x86_64"))
            elif platform_name == host or (host.startswith("macos") and platform_name.startswith("macos")):
                binary = build_native(platform_name, build_type, jobs)
            else:
                windows = platform_name == "windows-x86_64"
                image_key = (windows, CONTAINER_PLATFORM[platform_name])
                if image_key not in images:
                    images[image_key] = ensure_builder_image(*image_key)
                binary = build_in_container(platform_name, build_type, jobs, images[image_key], windows)
            extras = []
            if platform_name == host:
                game = build_game(platform_name, binary)
                if game:
                    extras.append(game)
            package(platform_name, binary, out_dir, extras)
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
