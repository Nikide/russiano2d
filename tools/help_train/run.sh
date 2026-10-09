#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# r2d-help: модель e5-small → GGUF, замер до/после дообучения на $ API.
#
#   bash tools/help_train/run.sh
#
# Рабочее дерево проекта НЕ меняется: сборка идёт в отдельной копии
# (git worktree) рядом с проектом, к ней применяется патч r2d-help.
# Всё, что получилось, и отчёт — в build/help_train/ основного проекта:
#   report.txt  — цифры recall@1/@5/MRR для bm25, e5-small, e5-small+обучение
#   run.log     — полный журнал
#   *.gguf      — модели
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/build/help_train"
WT="${R2D_HELP_WORKTREE:-$ROOT/../nikiniki2d-help}"
mkdir -p "$OUT"
exec > >(tee "$OUT/run.log") 2>&1

step() { printf '\n=== %s  %s ===\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { echo "ОШИБКА: $*" | tee -a "$OUT/report.txt"; exit 1; }

: > "$OUT/report.txt"
echo "r2d-help: обучение и замер $(date '+%Y-%m-%d %H:%M')" >> "$OUT/report.txt"

step "Проверка инструментов"
for t in git cmake python3; do command -v "$t" >/dev/null || fail "нет $t"; done
command -v ninja >/dev/null && GEN=(-G Ninja) || GEN=()
uname -m; sw_vers -productVersion 2>/dev/null || true
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
    || fail "нужен Python 3.10+ (сейчас $(python3 --version 2>&1)); поставьте свежий python3 первым в PATH"
# e5 обучена с префиксами «query: » / «passage: »: включаем их явно, а не по имени модели.
export R2D_HELP_E5_PREFIX=1

step "Копия проекта для сборки: $WT"
if [ ! -d "$WT/.git" ] && [ ! -f "$WT/.git" ]; then
    git -C "$ROOT" worktree add --detach "$WT" HEAD
fi
if [ ! -f "$WT/sdk/help/help_main.c" ]; then
    git -C "$WT" apply --3way "$HERE/r2d-help.patch" || git -C "$WT" apply "$HERE/r2d-help.patch" \
        || fail "патч r2d-help не применился к $(git -C "$ROOT" rev-parse --short HEAD)"
fi
mkdir -p "$WT/tools/help_train"
cp "$HERE"/pairs.tsv "$HERE"/train.py "$HERE"/convert_e5.py "$HERE"/check_gguf.py "$WT/tools/help_train/"

step "Python-окружение для подготовки модели (только здесь, не в r2d-help)"
VENV="$OUT/venv"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
PY="$VENV/bin/python"
"$PY" -m pip install -q --upgrade pip
"$PY" -m pip install -q torch "sentence-transformers>=3" datasets accelerate huggingface_hub numpy \
    sentencepiece safetensors protobuf pyyaml

step "Сборка r2d-help (Release, llama.cpp CPU)"
BUILD="$WT/build-help"
cmake -S "$WT" -B "$BUILD" ${GEN[@]+"${GEN[@]}"} -DCMAKE_BUILD_TYPE=Release -DR2D_HELP_LLAMA=ON
cmake --build "$BUILD" --target r2d-help r2d_help_test --parallel
BIN="$BUILD/r2d-help"
"$BIN" version
"$BUILD/sdk/help/r2d_help_test" "$WT" > "$OUT/help_test.txt" || fail "r2d_help_test не прошёл: $OUT/help_test.txt"
tail -n 1 "$OUT/help_test.txt"
LLAMA_SRC="$BUILD/_deps/llama_cpp-src"
[ -f "$LLAMA_SRC/convert_hf_to_gguf.py" ] || fail "нет конвертера llama.cpp в $LLAMA_SRC"
"$PY" -m pip install -q -e "$LLAMA_SRC/gguf-py" || true

step "Скачивание multilingual-e5-small"
BASE="$OUT/multilingual-e5-small"
"$PY" - "$BASE" <<'EOF'
import sys
from huggingface_hub import snapshot_download
snapshot_download('intfloat/multilingual-e5-small', local_dir=sys.argv[1])
EOF

convert() {  # каталог HF → GGUF q8_0, затем сверка с исходной моделью
    "$PY" "$WT/tools/help_train/convert_e5.py" "$LLAMA_SRC" "$1" --outfile "$2" --outtype q8_0
    ls -la "$2"
    "$PY" "$WT/tools/help_train/check_gguf.py" --binary "$BIN" --gguf "$2" --hf "$1" | tee "$2.check.txt" \
        || fail "GGUF $(basename "$2") не совпадает с исходной моделью — см. $2.check.txt"
    echo "сверка $(basename "$2"): $(tail -n 1 "$2.check.txt")" >> "$OUT/report.txt"
}

measure() {  # имя режима, модель или пусто
    local label="$1" model="${2:-}" idx="$OUT/$1.idx" args=()
    rm -f "$idx"
    if [ -n "$model" ]; then args=(--model "$model"); fi
    local t0=$SECONDS
    "$BIN" index --root "$WT" --out "$idx" ${args[@]+"${args[@]}"} > "$OUT/$label.index.json"
    local t1=$SECONDS
    local line
    "$PY" "$WT/tests/help_eval.py" --binary "$BIN" --index "$idx" ${args[@]+"${args[@]}"} > "$OUT/$label.eval.txt"
    line="$(sed -n 1p "$OUT/$label.eval.txt")"
    echo "$line"
    printf '%-14s %s  (индекс %d с, %s)\n' "$label" "$line" "$((t1 - t0))" \
        "$(ls -lh "$idx" | awk '{print $5}')" >> "$OUT/report.txt"
}

step "Замер 1: только BM25"
measure bm25

step "Конвертация и замер 2: e5-small как есть"
convert "$BASE" "$OUT/e5-small-q8_0.gguf"
measure e5-small "$OUT/e5-small-q8_0.gguf"

step "Дообучение на парах «вопрос → API»"
FT="$OUT/e5-r2d"
"$PY" "$WT/tools/help_train/train.py" --binary "$BIN" --root "$WT" --index "$OUT/bm25.idx" \
    --base "$BASE" --out "$FT"
# Конвертеру нужны файлы токенизатора исходной модели (sentencepiece).
for f in "$BASE"/sentencepiece* "$BASE"/tokenizer* "$BASE"/special_tokens_map.json; do
    if [ -e "$f" ] && [ ! -e "$FT/$(basename "$f")" ]; then cp "$f" "$FT/"; fi
done

step "Конвертация и замер 3: e5-small + дообучение"
convert "$FT" "$OUT/e5-r2d-q8_0.gguf"
measure e5-r2d "$OUT/e5-r2d-q8_0.gguf"

step "Готово"
echo "размер r2d-help: $(ls -lh "$BIN" | awk '{print $5}')" >> "$OUT/report.txt"
cat "$OUT/report.txt"
