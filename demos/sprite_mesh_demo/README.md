# SpriteMesh Demo

Small runtime example using a regular `$` Sprite and existing atlas animation
frames. It uses the same generated cache consumed by the SDK and runtime.

1. Open `assets/witch.atlas.json` in the SDK SpriteMesh Studio and choose
   **Save and Bake** (or run `./build/r2d-sdk sprite-mesh-bake demos/sprite_mesh_demo/assets/witch.atlas.json`).
2. Run `./build/russiano2d --game demos/sprite_mesh_demo`.
3. Press `1`, `2`, or `3` to switch clips, `M` to toggle the baked mesh, and `R`
   to rotate the character.

The atlas has `idle`, `walk`, and `attack` clips. Sprite animation selects the
frame; the renderer selects the corresponding prebuilt mesh from the cache.
