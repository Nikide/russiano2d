#!/usr/bin/env bash
# ===========================================================================
# Локальная сборка релизных пакетов через Xmake.
#
# Единственный builder релиза: build_and_push вызывает этот скрипт до создания
# тега. Контейнеры и GitHub-раннеры здесь не участвуют. Windows — mingw-w64.
# Linux x86_64 — только opt-in R2D_BUILD_LINUX=1: локальная Zig-кросс-сборка
# на машине релиза виснет, Linux-пользователи собирают движок на своей ОС.
#
# Выход: dist/<platform>/{russiano2d,r2d-sdk,russiano2d-sdk}[.exe]
# Финальные архивы собирает tools/release.py (--package-only) в dist/.
#
# Пока xmake.lua отсутствует (миграция не завершена), скрипт честно падает с
# кодом 3 ДО коммита/тега: релиз не может быть собран без канонического builder.
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

fail() { echo "!! release_build: $*" >&2; exit 3; }

command -v xmake >/dev/null 2>&1 || fail "xmake не найден в PATH (brew install xmake)"
[ -f xmake.lua ] || fail "нет xmake.lua — миграция на Xmake не завершена"

if [ "${R2D_BUILD_LINUX:-0}" = "1" ]; then
    command -v zig >/dev/null 2>&1 || fail "zig не найден в PATH (brew install zig) для Linux cross"
fi
# CMake 4.x ломает try_compile у кросс-пакетов; для Windows нужен CMake 3.31.
if [ -d /tmp/cmake331/CMake.app/Contents/bin ]; then
    export PATH="/tmp/cmake331/CMake.app/Contents/bin:$PATH"
fi
# host tools for autotools X11 stack (target libraries are still built by Zig)
if [ -d /opt/homebrew/opt/libtool/libexec/gnubin ]; then
    export PATH="/opt/homebrew/opt/libtool/libexec/gnubin:$PATH"
fi
if [ -d /opt/homebrew/opt/m4/bin ]; then
    export PATH="/opt/homebrew/opt/m4/bin:$PATH"
fi
if command -v cmake >/dev/null 2>&1; then
    cmake_major=$(cmake --version | head -1 | sed -E 's/.* ([0-9]+)\..*/\1/')
    if [ "${cmake_major:-0}" -ge 4 ]; then
        fail "для кросс-пакетов нужен CMake 3.31, найден $(cmake --version | head -1)"
    fi
fi
if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
    if [ -d /opt/homebrew/opt/mingw-w64/bin ]; then
        export PATH="/opt/homebrew/opt/mingw-w64/bin:$PATH"
    else
        fail "нет mingw-w64 (brew install mingw-w64) для Windows"
    fi
fi

mkdir -p build-xmake dist

build_target() {
    local platform="$1" args="$2"
    local builddir="build-xmake/$platform"
    echo
    echo "=== Xmake: $platform ==="
    if [ "$platform" = "linux-x86_64" ]; then
        # Изолированный кэш пакетов: target-библиотеки не смешиваются с macOS.
        export XMAKE_GLOBALDIR="${R2D_XMAKE_GLOBALDIR:-/tmp/xmake-linux-home}"
        export PKG_CONFIG_PATH=""
        export PKG_CONFIG_LIBDIR="$(find "$XMAKE_GLOBALDIR/.xmake/packages" -type d -name pkgconfig 2>/dev/null | paste -sd: -)"
    else
        unset XMAKE_GLOBALDIR PKG_CONFIG_LIBDIR
    fi
    rm -rf "$builddir"
    # shellcheck disable=SC2086
    local cfg
    if ! cfg=$(xmake f -y -m release -o "$builddir" $args 2>&1); then
        echo "$cfg" | tail -20
        fail "configure $platform"
    fi
    # xmake возвращает 0 даже когда пакет не установился; это ловим явно,
    # иначе соберётся конфигурация предыдущей платформы.
    if echo "$cfg" | grep -q 'install failed'; then
        echo "$cfg" | grep -B2 -A2 'install failed' | tail -20
        fail "зависимость не собралась для $platform"
    fi
    if ! xmake build -y -r; then
        fail "build $platform"
    fi
    local suffix=""
    case "$platform" in windows-*) suffix=".exe" ;; esac
    mkdir -p "dist/$platform"
    local found=0
    for name in russiano2d r2d-sdk russiano2d-sdk; do
        local src
        src="$(find "$builddir" -maxdepth 7 -type f -name "${name}${suffix}" | head -1 || true)"
        if [ -z "$src" ]; then
            fail "не найден ${name}${suffix} после сборки $platform"
        fi
        cp -f "$src" "dist/$platform/${name}${suffix}"
        found=$((found + 1))
    done
    echo "  ok  $platform: $found бинарника -> dist/$platform"
}

if [ "$DRY_RUN" = "1" ]; then
    echo "release_build dry-run: xmake=$(command -v xmake), zig=$(command -v zig), xmake.lua=есть"
    exit 0
fi

# Порядок как в релизном плане; каждый таргет обязан собраться.
build_target macos-arm64   "-p macosx -a arm64"
build_target macos-x86_64  "-p macosx -a x86_64"
# Linux x86_64 исключён из локального релиза: Zig-кросс на этой машине
# зависает. Linux-пользователи собирают движок на своей ОС; вернуть в релиз —
# R2D_BUILD_LINUX=1.
if [ "${R2D_BUILD_LINUX:-0}" = "1" ]; then
    build_target linux-x86_64 "-p linux -a x86_64 --toolchain=zigcc"
else
    echo "  --  linux-x86_64 пропущен (R2D_BUILD_LINUX=1 чтобы включить)"
fi
# Windows: Homebrew mingw-w64 (GCC) — Zig cc не умеет windres/windows.h для RC.
build_target windows-x86_64 "-p mingw -a x86_64"

echo
if [ "${R2D_BUILD_LINUX:-0}" = "1" ]; then
    echo "release_build: собраны все четыре платформы"
else
    echo "release_build: собраны macOS arm64/x86_64 + Windows x86_64 (Linux — сборка на целевой ОС)"
fi
