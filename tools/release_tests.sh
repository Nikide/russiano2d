#!/usr/bin/env bash
# Native/runtime tests and repository release gates before a local release.
# Project build/test targets are owned by Xmake; CMake is not used here.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v xmake >/dev/null 2>&1; then
    echo "!! xmake не найден: тесты не прогнаны" >&2
    exit 3
fi

step() { printf '\n=== %s ===\n' "$1"; }
run() { echo "+ $*"; "$@"; }

step "Xmake native and JS tests"
run xmake test -y -j "${JOBS:-8}"

step "Documentation and API contracts"
run python3 scripts/api_docs_pipeline.py check
run python3 tests/doc_claims_test.py
run python3 tests/doc_coverage_test.py
run python3 tests/api_docs_sync_test.py
run python3 tests/release_notes_test.py
run python3 tests/format_extensions_test.py

step "Portability, packaging, and release ownership"
run python3 tools/release_git_guard.py
run python3 tests/release_git_guard_test.py
run python3 tests/portability_test.py
run python3 tests/package_docs_refresh_test.py
run python3 tests/release_ownership_test.py
run python3 tests/release_architecture_test.py
run python3 tests/checklist_test.py
run python3 tests/acceptance_test.py
run python3 tests/repository_hygiene_test.py
run python3 tests/production_polish_checklist_test.py

if [ -n "${R2D_BINARY:-}" ]; then
    if [ ! -x "$R2D_BINARY" ]; then
        echo "!! R2D_BINARY не найден или не исполняемый: $R2D_BINARY" >&2
        exit 3
    fi
    step "Packaged runtime CLI smoke"
    run "$R2D_BINARY" commands --json
    run "$R2D_BINARY" lint game --json
    run "$R2D_BINARY" validate game --json
    run "$R2D_BINARY" snippet catalog --strict --json
    run python3 scripts/snippet_matrix.py --check
fi

echo
echo "Все релизные тесты и гейты пройдены"
