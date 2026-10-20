# Orbital Garden — SDK integration showcase

This is a runnable project created from the SDK `tilemap-room` template. It uses the same ordinary project files that SDK studios edit, then loads them through the runtime `$` API.

## Scenes

Run from the repository root:

```sh
./build/russiano2d --game demos/sdk_showcase
./build/russiano2d --game demos/sdk_showcase --scene workshop
./build/russiano2d --game demos/sdk_showcase --scene re2d
```

`garden` and `workshop` exercise the 2D tilemap, atlas sprite, collision shapes, particles, parallax, font/text, audio buses/zones, input bindings, RmlUi HUD, and VN narrative. Use WASD, Space, and I. The `re2d` scene loads the authored `.re2dmap` after SDK compilation and displays its metadata and spawn points through native Re2D World.

## Edit with SDK tools

Open the SDK with `./run_sdk.sh`, open this project, then use the tool catalog or Asset Browser to open the matching assets:

- `level.tilemap.json` — Tilemap Studio
- `assets/botanist.atlas.json` and `assets/botanist.png` — Sprite Studio / Animation Studio
- `assets/particles.particles.json` — Particle Studio
- `assets/props.collision.json` — Collision / Physics Tools
- `assets/parallax.layers.json` — Parallax Tools
- `assets/ui.fonts.json` — Font / Text Tools
- `assets/sounds.audio.json` — Audio Tools
- `assets/controls.input.json` — Input Tools
- `ui/hud.rml` and `ui/game.rcss` — RmlUi Studio
- `story/intro.scene` — Visual Novel Maker
- `maps/orbital_garden.re2dmap` — Re2D World Editor
- `assets/automation.batch.json` — Automation / Batch

The source image assets were generated for this showcase. `deps.json` records the atlas generation inputs; from this directory, run `../../build/r2d-sdk deps . --record --json` once, then `../../build/r2d-sdk deps . --check --json` to check whether the output is stale.

## Repeatable checks

```sh
./build/r2d-sdk lint demos/sdk_showcase/main.js --json
./build/r2d-sdk validate demos/sdk_showcase --json
./build/r2d-sdk story validate demos/sdk_showcase --assets-root demos/sdk_showcase --json
./build/r2d-sdk dialog validate demos/sdk_showcase/ui/dialog/dialog.rml --json
./build/r2d-sdk world-compile demos/sdk_showcase/maps/orbital_garden.re2dmap --renderer --output demos/sdk_showcase/maps/orbital_garden.re2dworld --json
./build/r2d-sdk batch demos/sdk_showcase/assets/automation.batch.json --json
python3 tests/agent/sdk_showcase_test.py
```

To dogfood the interactive SDK tools themselves, run `python3 tests/agent/sdk_studios_test.py` and `python3 tests/agent/sdk_classic2d_test.py` from the repository root.
