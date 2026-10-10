#!/usr/bin/env bash
# site/deploy-fast.sh — быстрая выкладка сайта на Jino по FTP.
#
# Чем быстрее deploy.sh:
#   1. Грузит ТОЛЬКО изменившееся. Что уже лежит на сервере, помнит локальный
#      файл .deploy-state (sha256 + размер + mtime). Вторая выкладка без правок —
#      ноль передач и ноль обращений к серверу; правка одной страницы — один файл.
#      (CHANGED=1 у старого скрипта сверял только размер и тратил HEAD на каждый
#      файл; тут сверяется содержимое и сеть не нужна.)
#   2. Одно FTP-соединение на много файлов. Раньше каждый файл = новый логин, а
#      логин на этом хостинге — это секунды. Теперь файлы делятся на JOBS «полос»,
#      и каждая полоса льёт свою пачку одним curl поверх одного соединения.
#   3. Полосы выровнены по размеру: самые крупные файлы (play/*.data, архивы)
#      идут первыми и в разные полосы, мелочь добивает остаток.
#
# Использование:
#   ./deploy-fast.sh                 # показать, что уедет (dry-run)
#   ./deploy-fast.sh --go            # загрузить изменившееся
#   ./deploy-fast.sh --adopt         # считать всё текущее уже выложенным, ничего не грузя
#                                    #   (запустить один раз, если сайт уже на сервере)
#   FORCE=1 ./deploy-fast.sh --go    # игнорировать состояние, грузить всё
#   JOBS=8 ./deploy-fast.sh --go     # шире окно (по умолчанию 5)
#   SKIP_DOWNLOAD=1 ./deploy-fast.sh --go   # не трогать download/ и play/
#
# Доступы — site/.env.deploy (в .gitignore). Его и .askpass.sh не грузим никогда:
# FTP-корень = корень сайта, всё загруженное публично.
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env.deploy"
STATE_FILE=".deploy-state"
[ -f "$ENV_FILE" ] || { echo "нет $ENV_FILE с доступами" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; . "./$ENV_FILE"; set +a
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PASS:?}"
DEPLOY_PORT="${DEPLOY_PORT:-21}"
FTP_BASE="ftp://$DEPLOY_HOST:$DEPLOY_PORT"

MODE="dry"
case "${1:-}" in
  --go) MODE="go" ;;
  --adopt) MODE="adopt" ;;
  ""|--dry-run) ;;
  *) echo "неизвестный аргумент: $1 (есть --go, --adopt, --dry-run)" >&2; exit 2 ;;
esac

JOBS="${JOBS:-5}"
case "$JOBS" in ''|*[!0-9]*) JOBS=5 ;; esac
[ "$JOBS" -lt 1 ] && JOBS=1

WORK="$(mktemp -d "${TMPDIR:-/tmp}/r2d-deploy.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# stat у macOS и GNU разный; -L — идти по симлинку (в download/ лежат ссылки на dist/).
if stat -f '%z' / >/dev/null 2>&1; then
  stat_key() { stat -L -f '%z:%m' "$1"; }
else
  stat_key() { stat -L -c '%s:%Y' "$1"; }
fi
sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# --- Что вообще выкладываем ----------------------------------------------------
FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && FILES+=("$f")
done < <(find . \( -type f -o -type l \) \
  ! -name '.env.deploy' ! -name '.askpass.sh' ! -name '.deploy-state' \
  ! -name 'deploy.sh' ! -name 'deploy-fast.sh' ! -name 'build-doc.py' \
  ! -name 'sync-downloads.sh' ! -name 'sync-index.py' ! -name 'build-site.sh' ! -name 'list-removed-docs.py' \
  ! -name '*.pyc' ! -name '*.pyo' ! -path '*/__pycache__/*' ! -name '.DS_Store' ! -path './README.md' ! -path './.preview/*' ! -path './.git/*' \
  | sed 's|^\./||' | sort)

if [ "${SKIP_DOWNLOAD:-0}" = "1" ]; then
  KEPT=()
  for f in "${FILES[@]}"; do
    case "$f" in download/*|play/*) ;; *) KEPT+=("$f") ;; esac
  done
  FILES=("${KEPT[@]}")
  echo "SKIP_DOWNLOAD=1 — download/ и play/ пропущены"
fi
[ "${#FILES[@]}" -eq 0 ] && { echo "нечего загружать"; exit 0; }

# --- Сверка с состоянием --------------------------------------------------------
# Формат .deploy-state: путь<TAB>размер:mtime<TAB>sha256. Если размер и mtime те
# же — файл не читаем вовсе (быстро даже для 60-мегабайтного .data); если
# изменились — считаем sha256 и сравниваем: «тронули, но содержимое то же»
# (например, симлинк на пересобранный, но идентичный архив) тоже не грузим.
STATE_IN="$WORK/state.in"
if [ -f "$STATE_FILE" ] && [ "${FORCE:-0}" != "1" ]; then cp "$STATE_FILE" "$STATE_IN"; else : > "$STATE_IN"; fi

TODO_LIST="$WORK/todo.tsv"     # путь<TAB>размер<TAB>ключ<TAB>sha
KEEP_STATE="$WORK/state.keep"  # записи, которые остаются как есть
: > "$TODO_LIST"; : > "$KEEP_STATE"
skipped=0
for f in "${FILES[@]}"; do
  key="$(stat_key "$f")"
  old="$(awk -F'\t' -v p="$f" '$1==p{print $2 "\t" $3; exit}' "$STATE_IN")"
  old_key="${old%%$'\t'*}"; old_sha="${old#*$'\t'}"
  if [ -n "$old" ] && [ "$old_key" = "$key" ]; then
    printf '%s\t%s\t%s\n' "$f" "$key" "$old_sha" >> "$KEEP_STATE"; skipped=$((skipped + 1)); continue
  fi
  sha="$(sha_of "$f")"
  if [ -n "$old" ] && [ "$old_sha" = "$sha" ]; then
    printf '%s\t%s\t%s\n' "$f" "$key" "$sha" >> "$KEEP_STATE"; skipped=$((skipped + 1)); continue
  fi
  printf '%s\t%s\t%s\t%s\n' "$f" "${key%%:*}" "$key" "$sha" >> "$TODO_LIST"
done
# Prune only obsolete documentation previously tracked by this deployment.
DELETE_LIST="$WORK/delete.list"
awk -F'\t' '$1 ~ /^doc\// || $1 ~ /(^|\/)__pycache__\/.*\.py[co]$/ {print $1}' "$STATE_IN" | while IFS= read -r f; do
  case "$f" in */__pycache__/*) printf '%s\n' "$f" ;; *) [ -e "$f" ] || printf '%s\n' "$f" ;; esac
done > "$DELETE_LIST"
if [ "${DEPLOY_INVENTORY:-1}" = 1 ]; then
  if python3 list-removed-docs.py > "$WORK/remote-removed"; then
    cat "$WORK/remote-removed" >> "$DELETE_LIST"
  else
    echo "!! remote inventory unavailable; pruning known manifest entries only" >&2
  fi
  sort -u "$DELETE_LIST" -o "$DELETE_LIST"
fi
deleted_count=$(wc -l < "$DELETE_LIST" | tr -d ' ')
todo=$(wc -l < "$TODO_LIST" | tr -d ' ')
total_bytes=$(awk -F'\t' '{s+=$2} END{printf "%d", s}' "$TODO_LIST")
human() { awk -v b="$1" 'BEGIN{ if(b>=1048576) printf "%.1f МБ", b/1048576; else printf "%.0f КБ", b/1024 }'; }

echo "Хост: $DEPLOY_HOST:$DEPLOY_PORT, пользователь: $DEPLOY_USER"
echo "Файлов: ${#FILES[@]}, без изменений: $skipped, к загрузке: $todo ($(human "$total_bytes")), полос: $JOBS"

# --- --adopt: записать состояние и выйти -----------------------------------------
if [ "$MODE" = "adopt" ]; then
  { cat "$KEEP_STATE"; awk -F'\t' '{print $1 "\t" $3 "\t" $4}' "$TODO_LIST"; } | sort > "$STATE_FILE"
  echo "Состояние записано в $STATE_FILE: ${#FILES[@]} файлов считаются выложенными."
  exit 0
fi

if [ "$todo" -eq 0 ] && [ "$deleted_count" -eq 0 ]; then echo "Всё актуально — грузить нечего."; exit 0; fi

if [ "$MODE" = "dry" ]; then
  sed "s/^/  [dry-run] удалить /" "$DELETE_LIST"
  sort -t$'\t' -k2,2nr "$TODO_LIST" | while IFS=$'\t' read -r p s _; do
    printf '  [dry-run] %-52s %s\n' "$p" "$(human "$s")"
  done
  echo; echo "Это был dry-run. Загрузить: ./deploy-fast.sh --go"
  exit 0
fi

# --- Раскладка по полосам: крупные первыми, каждый — в самую лёгкую полосу ------
lanes=$JOBS; [ "$todo" -gt 0 ] && [ "$lanes" -gt "$todo" ] && lanes=$todo
sort -t$'\t' -k2,2nr "$TODO_LIST" | awk -F'\t' -v n="$lanes" -v dir="$WORK" '
  { best=0; for (i=1;i<n;i++) if (load[i]<load[best]) best=i;
    load[best]+=$2; print $1 >> (dir "/lane." best) }'

# Одна полоса = один curl с парами «-T файл URL»: соединение переиспользуется.
# -g: не трактовать [] и {} в именах как шаблоны. -w печатает итог по каждому файлу.
run_lane() {
  local lane_file="$1" idx="$2" f
  local ok="$WORK/ok.$idx"
  local -a args=(-sS -g --connect-timeout 20 --retry 3 --retry-delay 1 --max-time 1200
                 --ftp-create-dirs --user "$DEPLOY_USER:$DEPLOY_PASS"
                 -w 'RESULT %{exitcode} %{url_effective}\n' -o /dev/null)
  while IFS= read -r f; do args+=(-T "$f" "$FTP_BASE/$f"); done < "$lane_file"
  curl "${args[@]}" 2>"$WORK/err.$idx" | while read -r tag code url; do
    [ "$tag" = RESULT ] || continue
    path="${url#"$FTP_BASE"/}"
    if [ "$code" = 0 ]; then printf '  ok   %s\n' "$path"; printf '%s\n' "$path" >> "$ok"
    else printf '  FAIL %s (curl %s)\n' "$path" "$code" >&2; fi
  done
}

STARTED="$(date +%s)"
pids=()
for lane_file in "$WORK"/lane.*; do
  [ -e "$lane_file" ] || continue
  run_lane "$lane_file" "${lane_file##*.}" &
  pids+=("$!")
done
for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" || true; done
ELAPSED=$(( $(date +%s) - STARTED ))

# --- Состояние: только то, что реально доехало -----------------------------------
cat "$WORK"/ok.* 2>/dev/null | sort -u > "$WORK/ok.all" || true
ok=$(wc -l < "$WORK/ok.all" | tr -d ' ')
{ cat "$KEEP_STATE"
  awk -F'\t' 'NR==FNR{ok[$1]=1; next} ($1 in ok){print $1 "\t" $3 "\t" $4}' "$WORK/ok.all" "$TODO_LIST"
} | sort > "$STATE_FILE"
# Keep pending deletion entries until each DELE actually succeeds.
while IFS= read -r f; do
  if ! awk -F'\t' -v p="$f" '$1==p{found=1;print} END{exit !found}' "$STATE_IN" >> "$STATE_FILE"; then
    printf '%s\t0:0\tpending-delete\n' "$f" >> "$STATE_FILE"
  fi
done < "$DELETE_LIST"

echo
echo "Загружено: $ok из $todo за ${ELAPSED} с"
if [ "$ok" -ne "$todo" ]; then
  echo "Не удалось: $((todo - ok)) — повторите ./deploy-fast.sh --go: доехавшее пропустится." >&2
  for e in "$WORK"/err.*; do [ -s "$e" ] && head -3 "$e" >&2; done
  exit 1
fi

# Only after replacement pages are uploaded, remove obsolete doc files.
prune_failed=0
while IFS= read -r f; do
  case "$f" in doc/*|__pycache__/*.pyc|__pycache__/*.pyo) ;; *) echo "invalid prune path"; exit 1 ;; esac
  case "$f" in *..*|*$'\n'*) echo "invalid prune path"; exit 1 ;; esac
  if curl -sS --connect-timeout 20 --max-time 60 --user "$DEPLOY_USER:$DEPLOY_PASS" \
      -Q "DELE $f" "$FTP_BASE/" -o /dev/null 2>"$WORK/prune.err"; then
    echo "  удалено $f"
    awk -F'\t' -v p="$f" '$1!=p' "$STATE_FILE" > "$WORK/pruned.state"
    mv "$WORK/pruned.state" "$STATE_FILE"
  else
    echo "  FAIL удалить $f"; prune_failed=1
  fi
done < "$DELETE_LIST"
[ "$prune_failed" = 0 ] || exit 1
