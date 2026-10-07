#!/usr/bin/env python3
"""Экспорт игры в веб: Emscripten + SDL_GPU с WebGPU-бэкендом.

Обёртка над cmake: подготавливает конфигурацию веб-сборки (в том числе
настройки страницы), собирает и раскладывает готовые файлы в --out.

Примеры:

    # Демо целиком, со стандартным экраном загрузки (маскот + кнопка «Играть»)
    python3 web/export.py --game demos --out dist/web-demos

    # Своя страница, своя картинка и старт без кнопки
    python3 web/export.py --game demos --out dist/web-demos \\
        --custom_loader my/loader.html --custom_image my/logo.png --force_play

    # Собрать, но не копировать (смотреть прямо в каталоге сборки)
    python3 web/export.py --game game --build-dir /tmp/r2d-web/build

Что нужно один раз подготовить (см. docs/WEB_EXPORT.md):
  * emsdk — задаётся --emsdk или переменной EMSDK (по умолчанию /tmp/r2d-web/emsdk);
  * SDL3 с WebGPU-бэкендом, установленный в префикс (--sdl-prefix,
    по умолчанию /tmp/r2d-web/sdl-install).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Что копировать в --out: страница, загрузчик, движок и груз.
ARTIFACTS = ["russiano2d.html", "russiano2d.js", "russiano2d.wasm",
             "russiano2d.data", "loader.png", "russiano2d.png"]


def die(message: str) -> "None":
    sys.exit(f"[export] {message}")


def check_sdl_webgpu(prefix: Path) -> None:
    header = prefix / "include/SDL3/SDL_gpu.h"
    if not header.exists():
        die(f"нет {header} — укажите --sdl-prefix на установленный SDL3 с WebGPU "
            f"(порядок сборки — docs/WEB_EXPORT.md)")
    text = header.read_text(errors="ignore")
    if "SDL_GPU_SHADERFORMAT_WGSL" not in text:
        die(f"SDL3 в {prefix} не знает WGSL: это апстрим без WebGPU-бэкенда. "
            f"Нужен форк из PR libsdl-org/SDL#16020 (см. docs/WEB_EXPORT.md)")


def run_in_emsdk(emsdk: Path, command: str) -> None:
    """Выполняет команду с активированным emsdk (он правит PATH и EM_CONFIG)."""
    env_script = emsdk / "emsdk_env.sh"
    if not env_script.exists():
        die(f"нет {env_script} — укажите --emsdk")
    full = f'set -e; source "{env_script}" >/dev/null 2>&1; {command}'
    result = subprocess.run(["bash", "-c", full], cwd=REPO)
    if result.returncode != 0:
        die(f"команда не выполнилась (код {result.returncode}): {command}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Экспорт игры Russiano2D в веб")
    # Игра и груз
    ap.add_argument("--game", default="game",
                    help="каталог игры внутри репозитория (по умолчанию game)")
    ap.add_argument("--preload", default=None,
                    help="свой список груза «каталог@точка-монтирования» через ';' "
                         "(по умолчанию <game>@/<game>;assets@/assets)")
    # Настройки страницы
    ap.add_argument("--custom_loader", "--custom-loader", dest="custom_loader",
                    default=None, help="своя HTML-оболочка (в ней работают @ИМЯ@ и {{{ SCRIPT }}})")
    ap.add_argument("--custom_image", "--custom-image", dest="custom_image",
                    default=None, help="своя картинка экрана загрузки")
    ap.add_argument("--force_play", "--force-play", dest="force_play",
                    action="store_true",
                    help="начинать игру сразу после загрузки, без кнопки «Играть»")
    ap.add_argument("--index", action="store_true",
                    help="назвать страницу index.html (для выкладки в каталог сайта)")
    # Инструменты и выход
    ap.add_argument("--emsdk", default=os.environ.get("EMSDK", "/tmp/r2d-web/emsdk"))
    ap.add_argument("--sdl-prefix", default="/tmp/r2d-web/sdl-install")
    ap.add_argument("--build-dir", default=None,
                    help="каталог сборки (по умолчанию <репозиторий>/build-web)")
    ap.add_argument("--out", default=None,
                    help="куда положить готовые файлы (по умолчанию только собрать)")
    ap.add_argument("--debug", action="store_true",
                    help="RelWithDebInfo вместо Release (быстрее собирается, .wasm больше)")
    ap.add_argument("--clean", action="store_true", help="снести каталог сборки перед сборкой")
    args = ap.parse_args(argv)

    emsdk = Path(args.emsdk).resolve()
    sdl_prefix = Path(args.sdl_prefix).resolve()
    check_sdl_webgpu(sdl_prefix)

    build_dir = Path(args.build_dir).resolve() if args.build_dir else REPO / "build-web"
    if args.clean and build_dir.exists():
        print(f"[export] убираю {build_dir}", flush=True)
        shutil.rmtree(build_dir)

    game_dir = (REPO / args.game).resolve()
    if not (game_dir / "main.js").exists():
        die(f"в {game_dir} нет main.js — это не каталог игры")

    preload = args.preload or f"{args.game}@/{args.game};assets@/assets"

    # Каталоги зависимостей берём из нативной сборки, если она есть: так
    # FetchContent не качает те же исходники второй раз.
    deps = REPO / "build/_deps"
    source_dirs = {
        "SDL3_IMAGE": deps / "sdl3_image-src",
        "QUICKJS": deps / "quickjs-src",
        "BOX2D": deps / "box2d-src",
        "STB": deps / "stb-src",
        "VISIBILITY": deps / "visibility-src",
        "SDL3_MIXER": deps / "sdl3_mixer-src",
        "RMLUI": deps / "rmlui-src",
    }

    cmake_args = [
        f'-DCMAKE_BUILD_TYPE={"RelWithDebInfo" if args.debug else "Release"}',
        f"-DCMAKE_PREFIX_PATH={sdl_prefix}",
        f"-DR2D_WEB_PRELOAD={preload}",
    ]
    if args.custom_loader:
        cmake_args.append(f"-DR2D_WEB_SHELL={(Path(args.custom_loader).resolve())}")
    if args.custom_image:
        cmake_args.append(f"-DR2D_WEB_LOADER_IMAGE={(Path(args.custom_image).resolve())}")
    # Значение задаём ВСЕГДА, а не только когда флаг включён: переменная
    # кэшируется, и «не передали» означало бы «оставить как в прошлой сборке».
    cmake_args.append(f"-DR2D_WEB_FORCE_PLAY={'ON' if args.force_play else 'OFF'}")
    for name, path in source_dirs.items():
        if path.is_dir():
            cmake_args.append(f"-DFETCHCONTENT_SOURCE_DIR_{name}={path}")

    quoted = " ".join(f"'{a}'" for a in cmake_args)
    print(f"[export] игра: {game_dir}", flush=True)
    print(f"[export] сборка: {build_dir}", flush=True)
    if args.force_play:
        print("[export] старт без кнопки «Играть»", flush=True)

    run_in_emsdk(emsdk, f'emcmake cmake -S "{REPO}" -B "{build_dir}" -G Ninja {quoted}')
    run_in_emsdk(emsdk, f'cmake --build "{build_dir}" -j{os.cpu_count() or 4}')

    missing = [name for name in ARTIFACTS if not (build_dir / name).exists()]
    if missing:
        die(f"после сборки нет файлов: {', '.join(missing)}")

    if args.out:
        out = Path(args.out).resolve()
        out.mkdir(parents=True, exist_ok=True)
        for name in ARTIFACTS:
            target = "index.html" if (args.index and name == "russiano2d.html") else name
            shutil.copy2(build_dir / name, out / target)
        total = sum((out / ("index.html" if args.index and n == "russiano2d.html" else n)).stat().st_size
                    for n in ARTIFACTS)
        print(f"[export] готово: {out} ({total / 1048576:.1f} МБ, "
              f"{len(ARTIFACTS)} файлов)", flush=True)
        print(f"[export] запуск: python3 -m http.server -d {out} 8080", flush=True)
    else:
        print(f"[export] собрано в {build_dir}", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
