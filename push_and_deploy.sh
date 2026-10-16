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
# Скрипт собирает ТОЛЬКО macOS (RUSSIANO2D_PRODUCTION_POLISH.md §4.6–4.7):
# Windows и Linux собирает GitHub Actions по тегу. Ни этот скрипт, ни
# build_and_push.sh не запускают Linux-сборку или кросс-сборку, не считают
# суммы платформ и не создают GitHub Release.
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
# Переносимость: M_PI/strtok_r/VLA ломают MSVC-сборку в CI, а локально
# незаметны — поэтому проверка идёт до сборки и публикации.
python3 tests/portability_test.py
# §4.7–4.9: локальный скрипт не собирает Linux/Windows и не создаёт релизы —
# это проверяется по самим скриптам, чтобы разделение не «поплыло» обратно.
python3 tests/release_ownership_test.py

# Чеклист §37 и программа приёмки §35 спецификации: обязательства архитектуры,
# доказательство для каждого P0-пункта и gate производительности. Они дешёвые
# (отчёт замера уже лежит в build/), поэтому идут перед каждым релизом.
python3 tests/checklist_test.py
python3 tests/acceptance_test.py
python3 tests/format_extensions_test.py
# §29: каждый зарегистрированный тип валидатора SDK обязан иметь работающую
# проверку — корректный ассет проходит, сломанный выявляется до запуска.
python3 tests/sdk_validation_test.py
# §29: preview SDK и прямой запуск обязаны давать одни и те же данные —
# сравниваем разбор SDK с разбором движка по числам.
python3 tests/sdk_preview_parity_test.py
# §31: примеры обязаны запускаться как проекты и быть описаны в документации.
# Файл лежит в tests/agent/: раньше здесь стоял несуществующий путь, и скрипт
# падал на этом шаге ещё до сборки — то есть «перед каждым релизом» он не
# доходил до релиза вообще.
python3 tests/agent/demos_examples_test.py

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

    step "Сборка встроила актуальные исходники"
    # Движок не читает src/highlevel с диска: сборка встраивает модули в
    # бинарник. Если шаг встраивания отстал или испортил escaping, движок
    # падает на старте с «SyntaxError», а исходники выглядят целыми.
    python3 tests/embed_sync_test.py
    # Парсер QuickJS строже Node: незакрытая скобка вызова проходила
    # `node --check`, но валила ВЕСЬ бандл на старте. Ловим это до сборки.
    python3 tests/parse_all_test.py

    step "Сборка без RE2D: ключевые тесты"
    R2D_BINARY=build-2d/russiano2d R2D_TEST_TIMEOUT=400 python3 tools/run_tests.py \
        game_test re2d_gate_test demos_test foundations_test

    step "Приёмка профиля 2D (установленное поведение)"
    python3 tests/profile_2d_test.py
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
