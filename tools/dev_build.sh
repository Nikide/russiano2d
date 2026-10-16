#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Сборка дев-каталога под локаутом.
#
# Зачем: когда над деревом работают несколько агентов/людей, одновременный
# `cmake --build build` в одном каталоге ломается (ninja переписывает одни и те
# же объектные файлы). Здесь сборка одна на всех: берём атомарный локаут
# (mkdir — атомарен и на macOS, и на Linux, в отличие от flock, которого на
# macOS нет по умолчанию), ждём очередь и собираем.
#
# Использование:
#   tools/dev_build.sh                 # build/ : russiano2d, r2d-sdk, qjs_exe
#   tools/dev_build.sh build-2d        # другой каталог сборки
#   tools/dev_build.sh build --target russiano2d
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUILD_DIR="${1:-build}"
shift || true
TARGETS=("$@")
if [ "${#TARGETS[@]}" -eq 0 ]; then
    TARGETS=(russiano2d r2d-sdk qjs_exe)
fi

LOCK="/tmp/r2d-dev-build.lock"
WAITED=0
until mkdir "$LOCK" 2>/dev/null; do
    if [ "$WAITED" -ge 600 ]; then
        echo "dev_build: локаут $LOCK не освободился за 10 минут — убираю принудительно" >&2
        rm -rf "$LOCK"
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done
cleanup() { rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "dev_build: каталог $BUILD_DIR, цели: ${TARGETS[*]}"
cmake --build "$BUILD_DIR" --target "${TARGETS[@]}" --parallel "${R2D_BUILD_JOBS:-6}"
echo "dev_build: готово ($BUILD_DIR/${TARGETS[0]})"
