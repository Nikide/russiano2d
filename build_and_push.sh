#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Локальная сборка, patch bump, коммит и публикация нового тега на GitHub.
# GitHub Actions запускается только по тегу vX.Y.Z.
#
# ./build_and_push.sh "Сообщение коммита"
# SITE=0 ./build_and_push.sh   # без публикации сайта
# ALLOW_PARTIAL=1 ./build_and_push.sh  # разрешить частичную локальную сборку
# KEEP_DIST=0 ./build_and_push.sh      # без добавления новых бинарников
# BUMP=0 / TAG=0 отключают bump / тег; без нового тега CI не запускается.
# REMOTES="github origin gitverse" — независимая отправка на три хоста.
# Версия берётся из CMakeLists.txt через tools/release.py.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MESSAGE="${1:-Новые билды}"
REMOTES="${REMOTES:-github origin gitverse}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
KEEP_DIST="${KEEP_DIST:-1}"
ALLOW_PARTIAL="${ALLOW_PARTIAL:-0}"
BUMP="${BUMP:-1}"
TAG="${TAG:-1}"
SITE="${SITE:-1}"
push_failed=""
site_failed=""
LOG="$ROOT/build_and_push.log"

# Весь вывод — и на экран, и в лог. Process substitution есть не везде
# (песочницы, systemd без /dev/fd запрещают запись в /dev/fd) — тогда падать
# не нужно, просто пишем только в лог.
if ( : > >(cat >/dev/null) ) 2>/dev/null; then
    exec > >(tee -a "$LOG") 2>&1
else
    exec >>"$LOG" 2>&1
    echo "process substitution недоступна — вывод идёт только в $LOG"
fi

# В ограниченных окружениях (песочница, свежий сервер) ~/.ssh/known_hosts
# недоступен, и `git push` падает с «Host key verification failed».
# Разрешаем принять ключ автоматически; на обычной машине это ничего не меняет.
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new}"

step() { printf '\n=== %s ===\n' "$1"; }

step "Автосборка $(date '+%Y-%m-%d %H:%M:%S')"
echo "ветка: $BRANCH   remotes: $REMOTES   сообщение: «${MESSAGE}»"

# Проверки до изменения версии и запуска сборок.
if [ "$BRANCH" != "$(git branch --show-current)" ]; then
    echo "!! BRANCH должен совпадать с текущей веткой; переключите её сначала."
    exit 1
fi
for remote in $REMOTES; do git remote get-url --push "$remote" >/dev/null || echo "!! remote $remote недоступен — остальные продолжат"; done
if [ "$BUMP" = "1" ] && [ "$TAG" = "1" ]; then
    candidate_tag="$(python3 - <<'PYTAG'
import sys
sys.path.insert(0, 'tools')
import release
major, minor, patch = map(int, release.read_version().split('.'))
print(f'v{major}.{minor}.{patch + 1}')
PYTAG
)"
    if git show-ref --verify --quiet "refs/tags/$candidate_tag"; then
        echo "!! Новый тег $candidate_tag уже существует; история не изменена."
        exit 1
    fi
    for remote in $REMOTES; do
      while IFS= read -r publish_url; do
        remote_tag="$(git ls-remote --exit-code "$publish_url" "refs/tags/$candidate_tag")" && remote_status=0 || remote_status=$?
        if [ "$remote_status" = 0 ]; then
            echo "!! Тег $candidate_tag уже опубликован в $publish_url."; exit 1
        elif [ "$remote_status" != 2 ]; then
            echo "!! $publish_url недоступен для проверки; попытка push будет независимой."
        fi
      done < <(git remote get-url --push --all "$remote" 2>/dev/null || true)
    done
fi

# --- 0. Версия: +1 к патчу ДО сборки ---------------------------------------
# Версия должна подняться раньше сборки, иначе пакеты и README в dist/
# соберутся со старым номером. BUMP=0 отключает шаг.
if [ "$BUMP" = "1" ]; then
    step "Поднимаю версию"
    old_version="$(python3 -c "
import sys; sys.path.insert(0, 'tools')
import release
print(release.read_version())" 2>/dev/null || true)"
    if new_version="$(python3 tools/release.py --bump 2>/dev/null)"; then
        echo "версия: ${old_version:-?} → ${new_version}"
        echo "родится тег v${new_version} — им же запускается CI на GitHub Actions"
    else
        echo "!! не удалось поднять версию — публикация отменена"
        exit 1
    fi
else
    echo "BUMP=0 — версию не трогаю"
fi

# --- 1. Сборка -------------------------------------------------------------
build_status=0
python3 tools/autobuild.py --platforms "${PLATFORMS:-macos-arm64,macos-x86_64,linux-x86_64,linux-aarch64,windows-x86_64}" || build_status=$?

if [ "$build_status" -ne 0 ]; then
    echo
    echo "!! Часть платформ не собралась (код $build_status)."
    if [ "$ALLOW_PARTIAL" != "1" ]; then
        # Версия уже поднята, а публикации не будет — возвращаем прежнюю,
        # иначе следующий запуск шагнёт через номер (0.1.0 → 0.1.2).
        if [ -n "${old_version:-}" ] && [ -n "${new_version:-}" ]; then
            if python3 -c "
import sys
sys.path.insert(0, 'tools')
import release
release.write_version(sys.argv[1])" "$old_version" 2>/dev/null; then
                echo "   версия возвращена: ${new_version} → ${old_version}"
            else
                echo "   !! вернуть версию ${old_version} не вышло — поправьте CMakeLists.txt вручную"
            fi
        fi
        echo "   Коммит и пуш отменены. Подробности выше и в ${LOG}."
        echo "   Если публиковать частичную сборку всё равно нужно:"
        echo "       ALLOW_PARTIAL=1 $0"
        exit 1
    fi
    echo "   ALLOW_PARTIAL=1 — продолжаю с тем, что собралось."
fi

# --- 2. Документы: AGENTS.md и README.md собираются из docs/ автоматически ---
step "Обновляю AGENTS.md и README.md из документации"
if python3 tools/agents_doc.py --all; then
    echo "документы в dist/ пересобраны из docs/"
else
    echo "!! не удалось обновить документы — публикация отменена"; exit 1
fi

# --- 2б. Сайт: подготовка параллельно с git ----------------------------------
# Документация, ссылки на архивы, версия в лендинге и веб-сборка play/ не зависят
# от пуша — делаем их, пока идут коммит и push. Заливка по FTP — только после
# подтверждённого пуша (шаг 6). Вывод копится в файл и печатается целиком позже,
# чтобы логи не перемешались.
site_prep_pid=""
site_prep_ok=1
SITE_PREP_LOG="$(mktemp "${TMPDIR:-/tmp}/r2d-site-prep.XXXXXX")"
if [ "$SITE" = "1" ] && [ -x site/build-site.sh ]; then
    step "Сайт: подготовка в фоне"
    site/build-site.sh --prepare >"$SITE_PREP_LOG" 2>&1 &
    site_prep_pid=$!
fi

# Site sources are tracked: finish regeneration before git add/commit.
if [ -n "$site_prep_pid" ]; then
    if wait "$site_prep_pid"; then
        cat "$SITE_PREP_LOG"
        site_prep_pid=""
    else
        cat "$SITE_PREP_LOG"
        echo "!! подготовка сайта не удалась — Git-хосты будут опубликованы независимо"
        site_prep_ok=0
        site_prep_pid=""
    fi
fi

# --- 3. Что собралось ------------------------------------------------------
step "Результат в dist/"
if [ -d dist ]; then
    ls -lh dist/ || true
    echo
    echo "размер dist/: $(du -sh dist | cut -f1)"
else
    echo "каталог dist/ отсутствует — сборка ничего не оставила"
fi

# --- 4. Git ----------------------------------------------------------------
step "Коммит"
git add -A
if [ "$KEEP_DIST" = "1" ]; then
    # dist/ лежит в репозитории осознанно: готовые сборки раздаются отсюда.
    git add -f dist
else
    echo "KEEP_DIST=0 — бинарники в коммит не попадут"
fi

if git diff --cached --quiet; then
    echo "изменений нет — коммит не нужен"
else
    # Версию дописываем в сообщение, чтобы по истории было видно, какой
    # номер уехал в этом коммите (и какой тег ставить).
    commit_message="$MESSAGE"
    if [ -n "${new_version:-}" ]; then
        commit_message="$MESSAGE v$new_version"
    fi
    echo "сообщение: «${commit_message}»"
    git commit -m "$commit_message"
fi

# Тег vX.Y.Z — это и есть метка релиза: сборки лежат в dist/ репозитория,
# а тег привязывает их к конкретному коммиту на обоих хостах. Ставим его ДО
# пуша, чтобы ветка и тег уехали вместе.
push_list=("refs/heads/$BRANCH")
if [ "$TAG" = "1" ] && [ -n "${new_version:-}" ]; then
    step "Тег v${new_version}"
    tag="v${new_version}"
    if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
        echo "!! тег $tag уже существует — не переиспользую его"
        exit 1
    else
        git tag -a "$tag" -m "Russiano2D ${new_version}"
        echo "поставлен: $tag → $(git rev-parse --short HEAD)"
    fi
    push_list+=("refs/tags/$tag")
elif [ "$TAG" != "1" ]; then
    echo "TAG=0 — тег не ставлю"
fi

step "Независимая публикация: $REMOTES"
# Один и тот же URL отправляем лишь раз (origin также содержит GitVerse).
python3 tools/publish_refs.py --remotes $REMOTES --refs "${push_list[@]}" || push_failed=1

step "Готово $(date '+%Y-%m-%d %H:%M:%S')"
git log --oneline -1
echo "сборки лежат в dist/ — их и раздают как релиз"
echo "лог: $LOG"

# --- 6. Сайт ----------------------------------------------------------------
# Билды и документация уже в репозитории — публикуем их и на сайте:
# site/build-site.sh пересобирает site/doc/ из docs/, обновляет ссылки на
# свежие архивы из dist/, подставляет версию в лендинг и заливает всё по FTP.
# SITE=0 отключает шаг; при неудачном пуше сайт не трогаем, чтобы не выложить
# то, чего нет в репозитории.
if [ "$SITE" != "1" ]; then
    step "Сайт"
    echo "SITE=0 — сайт не публикую"
elif [ ! -x site/build-site.sh ]; then
    step "Сайт"
    echo "site/build-site.sh не найден — сайт не публикую"

else
    step "Публикация сайта r2d.nikiniki.ru"
    site_ok="$site_prep_ok"
    if [ -n "$site_prep_pid" ]; then
        wait "$site_prep_pid" || site_ok=0
        cat "$SITE_PREP_LOG"
    elif [ ! -s "$SITE_PREP_LOG" ]; then
        site/build-site.sh --prepare || site_ok=0
    fi
    if [ "$site_ok" = 1 ] && site/build-site.sh --upload; then
        echo "сайт обновлён: https://r2d.nikiniki.ru/"
    else
        echo "!! публикация сайта не удалась (код, git и тег уже отправлены)"
        echo "   повторить отдельно: site/build-site.sh"
        site_failed=1
    fi
fi
rm -f "$SITE_PREP_LOG"

# Подготовка сайта в фоне не должна пережить скрипт (например, при SITE=0 её нет,
# а при неудачном пуше мы сюда попадаем без ожидания).
if [ -n "$site_prep_pid" ]; then wait "$site_prep_pid" 2>/dev/null || true; fi

# Ненулевой код, если хоть что-то не доехало: по логу выше видно, что именно.
if [ -n "${push_failed:-}" ]; then
    echo
    echo "!! Часть ссылок не доехала до всех хостов — смотрите отметки выше."
    exit 1
fi

if [ -n "${site_failed:-}" ]; then
    echo
    echo "!! Сайт не обновился — смотрите вывод выше."
    exit 1
fi
