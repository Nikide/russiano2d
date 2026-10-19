#!/usr/bin/env bash
# Unity tests перед локальным релизом. Пока Xmake-миграция не завершена
# (нет xmake.lua), используется нативный macOS CTest-набор, собранный CMake:
# это тот же Unity, а не второй тестовый фреймворк.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f xmake.lua ] && command -v xmake >/dev/null 2>&1; then
    echo "Unity tests: xmake test"
    exec xmake test -y
fi

for dir in build-autobuild/macos-arm64 build-autobuild/macos-x86_64; do
    if [ -f "$dir/CTestTestfile.cmake" ]; then
        echo "Unity tests (transitional CMake build): $dir"
        exec ctest --test-dir "$dir" --output-on-failure -j "${JOBS:-8}"
    fi
done

echo "!! нет xmake.lua и нет CTest-каталога — Unity tests не прогнаны" >&2
exit 3
