# Re2D Open World lab (R-04/R-05/R-06)

A runnable demonstration of the brush authoring pipeline and huge-world region
foundation. The map is authored as Hammer-like solid brushes, compiled by the
native SDK compiler into constrained Re2D primitives, and loaded through the
normal `$.re2dWorld` runtime. There is no polygon mesh API, no custom renderer
and no second scene graph.

## Build the map

```bash
r2d-sdk world compile demos/re2d_openworld_lab/openworld.re2dmap \
    --renderer --region-size 256 \
    --output demos/re2d_openworld_lab/openworld.re2dworld
```

Compiler output (this fixture):

| metric | value |
|---|---|
| brushes | 17 (11 solids, 9 tool brushes) |
| cells / spans | 39 / 39 |
| walls | 124 (8 occluder markers, 18 hint barriers) |
| portals | 65 (21 areaportal-marked edges) |
| entities | 7 (6 point, 1 brush) |
| region grid | 8 x 8 @ 256, 25 occupied regions |
| coarse PVS edges | 600 |
| runtime occluder cull | regionOccluderCulled=16 at west spawn (39 cells -> 11 allowed) |
| compile stages | load 0.83 ms, compile 0.13 ms, regions 0.05 ms |

## Run

```bash
./build/russiano2d --game demos --scene re2d_openworld_lab
```

Controls: WASD walk, arrows look, F1 toggle HUD, Escape exit. The HUD shows the
camera region, compiled cells/portals, brush/tool counts and coarse PVS edges.

## What is real / what is demo-side

* Real: native brush compiler, cell/span/wall/portal output, tool-material
  policy bits, occluder wall-chain markers, hint barriers, areaportal-marked
  portals, region grid partition and coarse PVS built by
  `src/re2d_world_region.c`.
* Demo-side: the compact region index shown in the HUD is derived from the
  compiler's occupied grid slots shipped in `index.js`; runtime streaming state
  lives in the native region module and is not yet exposed through
  `world.info()` (the high-level binding is owned by another pass).
