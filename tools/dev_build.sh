#!/usr/bin/env bash
# Сборка единственного приложения проекта через Xmake.
#
#   tools/dev_build.sh                          # build-xmake/: r2d
#   tools/dev_build.sh build-local r2d          # отдельный каталог/цели
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUILD_DIR="${1:-build-xmake}"
shift || true
TARGETS=("$@")
if [ "${#TARGETS[@]}" -eq 0 ]; then TARGETS=(r2d); fi

LOCK="/tmp/r2d-dev-build.lock"
WAITED=0
until mkdir "$LOCK" 2>/dev/null; do
    if [ "$WAITED" -ge 600 ]; then
        echo "dev_build: локаут $LOCK не освободился за 10 минут" >&2
        exit 2
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done
cleanup() { rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "dev_build: каталог $BUILD_DIR, цели: ${TARGETS[*]}"
xmake f -y -m release -o "$BUILD_DIR"
xmake build -y -j "${R2D_BUILD_JOBS:-8}" "${TARGETS[@]}"
echo "dev_build: готово"
