#!/usr/bin/env bash
# Полная пересборка и публикация сайта r2d.nikiniki.ru.
#
# Что делает:
#   1. python3 build-doc.py   — пересобирает site/doc/ из docs/ репозитория;
#   2. ./sync-downloads.sh    — обновляет ссылки на свежие сборки из dist/;
#   3. python3 sync-index.py  — подставляет версию движка и размеры архивов;
#   4. веб-сборка play/       — пересобирает играбельные демо (web/export.py);
#                               пропускается, если нет emsdk/SDL3 или WEB=0;
#   5. ./deploy-fast.sh --go       — заливает site/ на хостинг по FTP.
#
# Использование:
#   ./build-site.sh             # пересобрать и залить
#   ./build-site.sh --dry-run   # пересобрать, но не заливать
#   ./build-site.sh --prepare   # только шаги 1–4 (без заливки)
#   ./build-site.sh --upload    # только заливка (шаги 1–4 уже сделаны)
#   WEB=1 FORCE_WEB=1 ./build-site.sh   # пересобрать play/ даже если исходники не менялись
#
# --prepare и --upload нужны build_and_push.sh: подготовка сайта идёт параллельно
# с git push, а заливка — после того, как пуш подтверждён.
#
# Этим скриптом пользуется build_and_push.sh: после удачного пуша билды
# автоматически оказываются на сайте.
set -euo pipefail

cd "$(dirname "$0")"

DRY_RUN=0
PREPARE=1
UPLOAD=1
case "${1:-}" in
    --dry-run) DRY_RUN=1 ;;
    --prepare) UPLOAD=0 ;;
    --upload)  PREPARE=0 ;;
    "") ;;
    *) echo "неизвестный аргумент: $1 (есть --dry-run, --prepare, --upload)" >&2; exit 2 ;;
esac

step() { printf '\n=== %s ===\n' "$1"; }

if [ ! -f .env.deploy ]; then
    echo "!! нет site/.env.deploy с доступами к хостингу — публиковать некуда"
    echo "   (пересборку можно сделать так: ./build-site.sh --dry-run)"
    [ "$DRY_RUN" = 1 ] || exit 1
fi

if [ "$PREPARE" = 1 ]; then
    step "Документация из docs/"
    python3 build-doc.py

    step "Ссылки на сборки из dist/"
    ./sync-downloads.sh

    step "Версия и размеры в index.html"
    python3 sync-index.py

    # Веб-сборка демо для страницы /play/: index.html + .js + .wasm + .data.
    # Шаг необязательный: ему нужны emsdk и SDL3 с WebGPU-бэкендом
    # (см. docs/WEB_EXPORT.md), которых на машине сборки может и не быть. Если их
    # нет — публикуем то, что уже лежит в play/, и честно об этом говорим.
    step "Веб-сборка демо (play/)"
    if [ "${WEB:-1}" = "0" ]; then
        echo "WEB=0 — веб-сборку не трогаю, публикую текущую"
    elif [ "${FORCE_WEB:-0}" != "1" ] && [ -f play/russiano2d.wasm ] \
         && [ -z "$(find ../src ../shaders ../web ../demos ../assets ../cmake ../third_party \
                      -type f -newer play/russiano2d.wasm ! -name '.DS_Store' -print -quit 2>/dev/null)" ]; then
        echo "исходники не менялись со времени play/russiano2d.wasm — веб-сборку пропускаю (FORCE_WEB=1 — пересобрать)"
    elif [ ! -d "${EMSDK:-/tmp/r2d-web/emsdk}" ] || [ ! -d "${SDL_PREFIX:-/tmp/r2d-web/sdl-install}" ]; then
        echo "нет emsdk (${EMSDK:-/tmp/r2d-web/emsdk}) или SDL3 с WebGPU (${SDL_PREFIX:-/tmp/r2d-web/sdl-install})"
        echo "  → пересборку play/ пропускаю, на сайт уедет текущая ($(du -sh play 2>/dev/null | cut -f1))"
        echo "  → собрать вручную: python3 ../web/export.py --game demos --out play --index"
    else
        python3 ../web/export.py --game demos --out play --index
    fi
fi

if [ "$UPLOAD" = 0 ]; then
    step "Подготовка готова"
    echo "заливка пропущена (--prepare); залить: ./build-site.sh --upload"
    exit 0
fi

if [ "$DRY_RUN" = 1 ]; then
    step "Готово (dry-run)"
    echo "заливка пропущена; залить: ./build-site.sh"
    exit 0
fi

step "Заливка на хостинг"
./deploy-fast.sh --go

step "Готово $(date '+%Y-%m-%d %H:%M:%S')"
echo "сайт: https://r2d.nikiniki.ru/   документация: https://r2d.nikiniki.ru/doc/"
