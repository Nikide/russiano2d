#!/bin/sh
# Zombie: Mixamo FBX (skin mesh + walk) -> dense Re2DSprite v3 with a skin clip, all through the SDK.
#   sh demos/re2d_dust2/zombie3/bake_zombie3.sh <dir with source/Zombie Walk.fbx and textures/zombie_Packed0_Diffuse.png>
# The FBX and textures are third-party assets supplied by the user and are not kept in the repository.
# --raster 512 matches the 1024x576 world frame the sprite is composed into; --cull skips cells facing away (the mesh is closed).
set -e
SRC="$1"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FBX="$(find "$SRC" -name 'Zombie Walk.fbx' | head -1)"
TEX="$(find "$SRC" -name 'zombie_Packed0_Diffuse.png' | head -1)"
"$ROOT/build/r2d-sdk" bake-re2d3 "$FBX" --output "$ROOT/demos/re2d_dust2/zombie3" --name zombie \
  --grid 1024 --extent 96 --fit 0.9 --raster 512 --cull --fbx-ao "default=$TEX" --clips "walk=mixamo.com:l" --fps 30
