#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Обновить документацию и сайт документации, затем собрать, запушить и выложить
# релиз. Это тонкая обёртка над build_and_push.sh: он уже умеет версию, сборку
# платформ, коммит, тег, пуш и публикацию сайта. Обёртка добавляет то, чего в
# нём нет как отдельного шага:
#
#   1. проверку, что документация сходится с кодом (doc-гейты из PHILOSOPHY §4);
#   2. пересборку site/doc/ из docs/ — до сборки релиза, чтобы страницы успели
#      попасть и в пакет, и в site/;
#   3. полный прогон агентских тестов и обеих конфигураций движка, чтобы в релиз
#      не уехало недоделанное состояние.
#
# Использование:
#   ./push_and_deploy.sh "Сообщение коммита"
#   SKIP_TESTS=1 ./push_and_deploy.sh      # только доки + сайт + релиз
#   SITE=0 ./push_and_deploy.sh            # без публикации сайта
#   ALLOW_PARTIAL=1 ./push_and_deploy.sh   # разрешить частичную сборку платформ
#   DRY_RUN=1 ./push_and_deploy.sh         # всё, кроме пуша и выкладки
#   REMOTES="github gitverse" ./push_and_deploy.sh
#
# Переменные окружения пробрасываются в build_and_push.sh как есть.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MESSAGE="${1:-Документация и релиз}"
DRY_RUN="${DRY_RUN:-0}"

step() { printf '\n=== %s ===\n' "$1"; }

# --- 1. Документация сходится с кодом --------------------------------------
# PHILOSOPHY.md §4: это те же гейты, что в CI. Если они красные — публиковать
# документацию нельзя: страницы разошлись бы с кодом на сайте и в пакете.
step "Проверяю документацию ($(date '+%Y-%m-%d %H:%M:%S'))"
python3 tests/doc_coverage_test.py
python3 tests/doc_claims_test.py
python3 tests/repository_hygiene_test.py

# --- 2. Полный прогон тестов и обеих конфигураций ---------------------------
# Дорого, но релиз — не место для «должно работать». SKIP_TESTS=1 оставлен для
# случаев, когда прогон уже сделан вручную на этой же ревизии.
if [ "$SKIP_TESTS" = "1" ]; then
    step "SKIP_TESTS=1 — тесты не гоняю"
else
    step "Собираю движок в обеих конфигурациях"
    cmake --build build --target russiano2d qjs_exe -j 6
    cmake --build build-2d --target russiano2d -j 6

    step "Агентские тесты (полный набор)"
    R2D_TEST_TIMEOUT="${R2D_TEST_TIMEOUT:-600}" python3 tools/run_tests.py

    step "Сборка без RE2D: ключевые тесты"
    R2D_BINARY=build-2d/russiano2d R2D_TEST_TIMEOUT=400 python3 tools/run_tests.py \
        game_test re2d_gate_test demos_test foundations_test
fi

# --- 3. Пересборка страниц сайта из docs/ -----------------------------------
# site/build-doc.py наполняет site/doc/ из docs/ репозитория. build_and_push.sh
# делает это ещё раз перед заливкой; здесь — чтобы результат был виден в git
# до коммита (страницы сайта — часть коммита).
if [ -x site/build-site.sh ]; then
    step "Пересобираю site/doc/ из docs/"
    if [ "$DRY_RUN" = "1" ]; then
        (cd site && python3 build-doc.py)
        echo "DRY_RUN=1 — страницы пересобраны, пуш и выкладка пропущены"
        echo "проверить страницы: site/doc/"
        exit 0
    fi
    (cd site && python3 build-doc.py)
else
    echo "!! site/build-site.sh не найден — сайт не пересобираю"
fi

# --- 4. Релиз: версия, сборка платформ, коммит, тег, пуш, сайт --------------
step "Релиз: сборка, коммит, тег, пуш, публикация сайта"
exec "$ROOT/build_and_push.sh" "$MESSAGE"
