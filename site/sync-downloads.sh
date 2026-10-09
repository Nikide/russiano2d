#!/usr/bin/env bash
# Пересобирает симлинки site/download/ по фактическому содержимому dist/.
#
# Сайт раздаёт архивы движка из dist/, не копируя их себе: ссылка всегда
# указывает на свежую сборку, поэтому после autobuild ничего копировать не надо.
set -euo pipefail

cd "$(dirname "$0")"
DIST="../dist"
mkdir -p download

created=0 removed=0
# сносим битые и устаревшие ссылки (архив мог переименоваться)
for link in download/*; do
  [ -e "$link" ] && [ ! -L "$link" ] && continue
  if [ -L "$link" ] && [ ! -e "$link" ]; then
    rm -f "$link"; removed=$((removed + 1))
  fi
done

for f in "$DIST"/*.tar.gz "$DIST"/*.zip "$DIST"/SHA256SUMS.txt; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  target="../../dist/$name"
  if [ ! -L "download/$name" ] || [ "$(readlink "download/$name")" != "$target" ]; then
    ln -sfn "$target" "download/$name"
    created=$((created + 1))
  fi
done

echo "download/: ссылок создано $created, битых удалено $removed"
ls -1 download/ | sed 's/^/  /'
