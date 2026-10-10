#!/usr/bin/env bash
# Обучение эмбеддингов r2d-help в Docker с жёсткими лимитами памяти и ядер,
# чтобы не съесть весь Mac. Запуск из корня проекта:
#   bash tools/help_train/docker.sh            # лимиты по умолчанию
#   MEM=5g CPUS=6 bash tools/help_train/docker.sh
# Результаты — в build/help_train/ проекта; кэш pip/HF/сборки — в томах docker.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MEM="${MEM:-6g}"
CPUS="${CPUS:-8}"
IMG=r2d-help-train

docker build -t "$IMG" -f - "$ROOT/tools/help_train" <<'DOCKERFILE'
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build git rsync curl ca-certificates pkg-config patchelf \
    libfreetype-dev libpng-dev libjpeg-dev zlib1g-dev libcurl4-openssl-dev libfribidi-dev \
    libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxi-dev libxfixes-dev libxss-dev \
    libxtst-dev libxrender-dev libxinerama-dev libxkbcommon-dev libwayland-dev wayland-protocols \
    libdecor-0-dev libegl1-mesa-dev libgl1-mesa-dev libgles2-mesa-dev libvulkan-dev libdrm-dev libgbm-dev \
    libasound2-dev libpulse-dev libpipewire-0.3-dev libsndio-dev libudev-dev libdbus-1-dev \
    libibus-1.0-dev libusb-1.0-0-dev \
 && rm -rf /var/lib/apt/lists/*
DOCKERFILE

mkdir -p "$ROOT/build/help_train"
# Проект монтируется только на чтение; пишем лишь в build/help_train.
exec docker run --rm -it \
    --memory="$MEM" --memory-swap="$MEM" --cpus="$CPUS" --pids-limit=2048 \
    -e R2D_HELP_COPY=1 -e R2D_HELP_WORKTREE=/cache/wt -e R2D_HELP_JOBS=4 \
    -e R2D_HELP_THREADS="$((CPUS - 1))" -e R2D_HELP_BATCH="${BATCH:-8}" \
    -e R2D_HELP_VENV=/cache/venv -e HF_HOME=/cache/hf -e PIP_CACHE_DIR=/cache/pip -e OMP_NUM_THREADS="$((CPUS - 1))" \
    -v "$ROOT":/project:ro \
    -v "$ROOT/build/help_train":/project/build/help_train \
    -v r2d-help-cache:/cache \
    -w /project "$IMG" bash tools/help_train/run.sh
