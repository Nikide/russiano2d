#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Запуск приложения Russiano2D SDK (docs/SDK.md §12).
#
# SDK — обычный проект движка: интерфейс на RmlUi (`sdk/ui/*.rml`), логика на
# публичном `$`, тяжёлые операции — в нативном `r2d-sdk` через мост `$.sdk`
# (`sdk/project.json`: "toolHost": true). Поэтому запуск — это движок с
# `--game sdk`, а этот скрипт лишь находит бинарник, при необходимости собирает
# его и запускает из корня репозитория.
#
# Почему из корня: `sdk_tools.json` (список инструментов) и `sdk/state.local.json`
# движок ищет от каталога игры, затем от каталога запуска. Каталог запуска —
# корень репозитория, если в нём есть `game/main.js`; из другой папки SDK
# откроется без списка инструментов. Скрипт сам переходит в корень.
#
# Использование:
#   ./run_sdk.sh                      # собрать (если нужно) и открыть SDK
#   ./run_sdk.sh --stats              # любые флаги движка уходят дальше
#   ./run_sdk.sh --headless --seconds 5   # дымовой прогон без окна
#   ./run_sdk.sh --build              # пересобрать движок и r2d-sdk, потом открыть
#   NO_BUILD=1 ./run_sdk.sh           # только запуск, без сборки
#   JOBS=4 ./run_sdk.sh --build       # ограничить параллелизм сборки
#   BUILD_DIR=build-release ./run_sdk.sh
#   R2D_BINARY=/path/to/russiano2d ./run_sdk.sh
#
# Переменные окружения:
#   R2D_BINARY  — готовый бинарник движка (перебивает поиск по каталогам);
#   BUILD_DIR   — каталог сборки (по умолчанию `build`);
#   JOBS        — параллелизм `cmake --build` (по умолчанию все ядра);
#   NO_BUILD=1  — не собирать даже если бинарника нет (запуск упадёт с подсказкой);
#   R2D_*       — обычные переменные движка (`R2D_GAME_DIR`, `R2D_GPU`, …)
#                 передаются как есть.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

GAME="sdk"
BUILD_DIR="${BUILD_DIR:-build}"
JOBS="${JOBS:-}"
FORCE_BUILD=0
NO_BUILD="${NO_BUILD:-0}"
PASSTHRU=()

step() { printf '\n=== %s ===\n' "$1"; }

usage() {
    sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
}

# --- Аргументы: свои флаги отдельно, остальное — движку ----------------------
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage ;;
        --build)    FORCE_BUILD=1; shift ;;
        --no-build) NO_BUILD=1; shift ;;
        --game)     echo "!! --game задаёт сам скрипт (${GAME}); передайте свои флаги без него." >&2; exit 2 ;;
        *)          PASSTHRU+=("$1"); shift ;;
    esac
done

# --- Бинарник движка --------------------------------------------------------
find_engine() {
    if [ -n "${R2D_BINARY:-}" ]; then
        if [ -x "$R2D_BINARY" ]; then
            printf '%s\n' "$R2D_BINARY"
            return 0
        fi
        if command -v "$R2D_BINARY" >/dev/null 2>&1; then
            command -v "$R2D_BINARY"
            return 0
        fi
        echo "!! R2D_BINARY=$R2D_BINARY не исполняется и не найден в PATH." >&2
        return 1
    fi
    for candidate in "$BUILD_DIR/russiano2d" "$BUILD_DIR/nikiniki2d" "build-release/russiano2d"; do
        [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
    done
    return 1
}

engine_build() {
    local jobs=()
    [ -n "$JOBS" ] && jobs=(-j "$JOBS")
    if [ ! -f "$BUILD_DIR/CMakeCache.txt" ]; then
        step "Конфигурация сборки ($BUILD_DIR)"
        cmake -S "$ROOT" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE="${BUILD_TYPE:-Release}"
    fi
    step "Сборка движка и r2d-sdk"
    # ${arr[@]+…} — чтобы пустой массив не спотыкался о set -u в bash 3.2 (macOS).
    cmake --build "$BUILD_DIR" ${jobs[@]+"${jobs[@]}"}
}

ENGINE=""
if ENGINE="$(find_engine)"; then
    if [ "$FORCE_BUILD" = 1 ]; then
        engine_build
        ENGINE="$(find_engine)"
    fi
elif [ "$NO_BUILD" = 1 ]; then
    echo "!! бинарник движка не найден (искал: ${R2D_BINARY:-$BUILD_DIR/russiano2d, $BUILD_DIR/nikiniki2d, build-release/russiano2d})," >&2
    echo "   а NO_BUILD=1 запрещает сборку. Уберите NO_BUILD или задайте R2D_BINARY." >&2
    exit 1
else
    echo "бинарник движка не найден — собираю (NO_BUILD=1 отключает сборку)"
    engine_build
    ENGINE="$(find_engine)" || { echo "!! сборка прошла, но бинарника нет — проверьте BUILD_DIR=$BUILD_DIR" >&2; exit 1; }
fi

# --- Нативный бэкенд инструментов -------------------------------------------
# Без `r2d-sdk` SDK-приложение всё равно откроется: `$.sdk.available()` вернёт
# false, и тяжёлые операции (bake, импорт моделей) будут недоступны. Об этом
# честно предупреждаем, но запуск не отменяем.
if [ ! -x "$BUILD_DIR/r2d-sdk" ]; then
    echo "!! $BUILD_DIR/r2d-sdk не найден: инструменты SDK будут недоступны."
    echo "   Соберите его: cmake --build $BUILD_DIR --target r2d-sdk"
fi

# --- Каталоги данных --------------------------------------------------------
[ -f "$ROOT/sdk/project.json" ] || { echo "!! нет sdk/project.json — это не checkout Russiano2D?" >&2; exit 1; }
[ -f "$ROOT/sdk_tools.json" ]   || echo "!! нет sdk_tools.json: список инструментов будет пуст."

step "Запуск SDK"
echo "движок:   $ENGINE"
echo "проект:   $ROOT/$GAME (project.json: toolHost)"
echo "аргументы: --game $GAME ${PASSTHRU[*]:-}"
echo

exec "$ENGINE" --game "$GAME" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
