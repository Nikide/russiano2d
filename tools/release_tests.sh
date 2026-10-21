#!/usr/bin/env bash
# Unity C-тесты и JS-наборы перед локальным релизом.
# Цели и тесты описаны в xmake/tests.lua; CMake для этого больше не нужен.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v xmake >/dev/null 2>&1; then
    echo "!! xmake не найден: тесты не прогнаны" >&2
    exit 3
fi

exec xmake test -y -j "${JOBS:-8}"
