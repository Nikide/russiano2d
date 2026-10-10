#!/bin/sh
# AKS-74U viewmodel: FBX -> dense Re2DSprite v3 with skin clips and a first-person camera, all through the SDK.
#   sh demos/re2d_dust2/aks3/bake_aks3.sh <dir with source/fp_hands_aks74u.fbx and textures/AKS74U_AO.png>
# The FBX and its textures are third-party assets supplied by the user and are not kept in the repository.
# --eye is the camera in the FBX's own metres (5.6 cm left, 2.7 cm below and 0.9 cm behind the FBX origin);
# --motion-lod 1 draws moving frames one level coarser (the still frame is refined to full detail);
# --zoom/--window match a 1920x1080 window at a 52 degree vertical field of view (see AKS in demos/re2d_dust2/main.js).
set -e
SRC="$1"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
AO="$SRC/textures/AKS74U_AO.png"
"$ROOT/build/r2d-sdk" bake-re2d3 "$SRC/source/fp_hands_aks74u.fbx" --output "$ROOT/demos/re2d_dust2/aks3" --name aks \
  --grid 2048 --extent 96 --scale 72 --pivot 0.006,-0.249,-0.283 \
  --eye -0.0565,-0.0268,0.0087 --zoom 2.4102 --raster 2048 --window 0.03,0.22,0.97,0.78 --cull --motion-lod 1 \
  --fbx-tint "aks74u=#4a4f58,aks74u.wood=#8a4a20,bullet=#d0aa58" --fbx-ao "aks74u=$AO,aks74u.wood=$AO" \
  --tiles "aks74u=60,aks74u.wood=20,bullet=6,arms=70" \
  --clips "idle=armatureAction,draw=Put_in,fire=Fire_single,reload=reload" --fps 30
