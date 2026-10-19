#!/usr/bin/env bash
# Генерация встроенных в движок ресурсов для Xmake-сборки.
# Запускается xmake-правилом before_build; host-tools собираются нативно,
# поэтому результат одинаков для macOS/Linux/Windows кросс-сборок.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="${1:-build-xmake/generated}"
mkdir -p "$OUT/shaders" "$OUT/tools"

CC="${CC:-cc}"
CXX="${CXX:-c++}"

build_tool() {
    local name="$1"
    if [ ! -x "$OUT/tools/$name" ] || [ "$ROOT/tools/$name.c" -nt "$OUT/tools/$name" ]; then
        "$CC" -O2 -o "$OUT/tools/$name" "tools/$name.c"
    fi
}

build_tool r2d_embed_js
build_tool r2d_embed_icons
build_tool r2d_embed_assets

echo "generated: JS"
"$OUT/tools/r2d_embed_js" src/highlevel "$OUT/r2d_js_data.h"

echo "generated: icons"
"$OUT/tools/r2d_embed_icons" third_party/material_icons/MaterialIcons-Regular.ttf \
    third_party/material_icons/MaterialIcons-Regular.codepoints "$OUT/r2d_icons_data.h"

echo "generated: splash"
"$OUT/tools/r2d_embed_assets" "$OUT/r2d_splash_data.h" \
    sdk/assets/splash.jpg sdk/assets/splash.jpg \
    sdk/ui/splash.rml sdk/ui/splash.rml \
    sdk/ui/splash.rcss sdk/ui/splash.rcss

GLSLANG="${GLSLANG:-glslangValidator}"
SPIRV_CROSS="${SPIRV_CROSS:-spirv-cross}"
command -v "$GLSLANG" >/dev/null || { echo "нет glslangValidator" >&2; exit 3; }
command -v "$SPIRV_CROSS" >/dev/null || { echo "нет spirv-cross" >&2; exit 3; }

ENTRIES=""
shader() {
    local name="$1" stage="$2" src="$3"; shift 3
    local base="${name}_${stage}"
    local spv="$OUT/shaders/$base.spv"
    local msl="$OUT/shaders/$base.msl"
    "$GLSLANG" -V --target-env vulkan1.1 --quiet "$@" -o "$spv" "$src"
    "$SPIRV_CROSS" "$spv" --msl --msl-version 20100 --msl-decoration-binding --output "$msl"
    if { [ "$name" = world ] || [ "$name" = world_batch ]; } && [ "$stage" = frag ]; then
        cmake -DINPUT="$msl" -P cmake/WorldMetalBindings.cmake >/dev/null
    fi
    ENTRIES="$ENTRIES$base,"
    echo "generated: shader $base"
}

shader sprite vert shaders/sprite.vert.glsl
shader sprite frag shaders/sprite.frag.glsl
shader mesh vert shaders/mesh.vert.glsl
shader sprite_fx frag shaders/sprite_fx.frag.glsl
shader post vert shaders/post.vert.glsl
shader post frag shaders/post.frag.glsl
shader smaa frag shaders/post.frag.glsl -DR2D_SMAA_MODE=1
shader bloom_pre frag shaders/bloom_pre.frag.glsl
shader bloom_blur frag shaders/bloom_blur.frag.glsl
shader light_map frag shaders/light_map.frag.glsl
shader world vert shaders/world.vert.glsl
shader world frag shaders/world.frag.glsl
shader world_batch vert shaders/world.vert.glsl -DR2D_BATCH_SSBO=1
shader world_batch frag shaders/world.frag.glsl -DR2D_BATCH_SSBO=1

cmake -DSHADER_DIR="$OUT/shaders" -DSHADER_ENTRIES="$ENTRIES" \
      -DSHADER_MODE=glsl -DOUTPUT="$OUT/shaders/r2d_shaders.h" \
      -P cmake/EmbedShader.cmake
echo "generated: $OUT"
