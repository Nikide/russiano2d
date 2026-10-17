# Re2D Brush Authoring (issue #5)

Status: native SDK compiler + tests. Brushes are authoring input; the runtime
still receives only constrained Re2D cells/spans/walls/portals.

## Why brushes

Hand-authoring non-overlapping rectangular XY cells, free height intervals,
exposed faces and portals is slow for altars, arches, bridges and towers. A
brush is one solid prism; the compiler subtracts all solid brush height
intervals from an explicit world envelope, emits free-space cells/spans, exposed
walls with tool-material policy, and portals between adjacent cells.

No polygon mesh API is added. The runtime contract is unchanged:
`R2DWorldCell` is an axis-aligned rect and `R2DWorldSpan` must match its cell
footprint exactly.

## Source format (`.re2dmap` v1)

Brush authoring is additive: existing `cells`, `walls`, `portals`, `stairs`,
`slopes` and `--renderer` output keep working untouched.

```json
{
  "version": 1,
  "regionSize": 256,
  "world": {
    "x": 0, "y": 0, "w": 2048, "h": 2048,
    "bottom": 0, "top": 384,
    "floorColor": "#8f8b82",
    "ceilingColor": "#586070",
    "sideColor": "#6f6250",
    "boundary": "sky"
  },
  "brushes": [
    { "id": "wall.a", "rect": [512,0,32,896], "bottom": 0, "top": 384 },
    { "id": "pillar", "polygon": [[256,256],[352,256],[352,352],[256,352]],
      "bottom": 0, "top": 320, "sideColor": "#7a6a50" },
    { "id": "diamond", "polygon": [[700,256],[760,320],[700,384],[640,320]],
      "bottom": 0, "top": 96 },
    { "id": "frame", "rect": [800,256,96,96], "bottom": 0, "top": 96,
      "holes": [[824,280,48,48]] },
    { "id": "carved", "rect": [960,256,96,96], "bottom": 0, "top": 128 },
    { "id": "cut", "rect": [976,272,64,64], "subtract": true,
      "bottom": 32, "top": 96 },
    { "id": "trigger.vol", "rect": [560,320,48,64], "bottom": 0, "top": 128,
      "tool": "trigger" },
    { "id": "door.area", "rect": [512,896,32,204], "bottom": 0, "top": 384,
      "tool": "areaportal" }
  ],
  "entities": [
    { "id": "player.start", "kind": "player_spawn", "x": 128, "y": 128, "h": 0 },
    { "id": "door.a", "kind": "door", "brush": "door.area", "target": "portal.a" },
    { "id": "trigger.a", "kind": "trigger_volume", "brush": "trigger.vol",
      "target": "door.a" }
  ]
}
```

### Brush fields

| field | meaning |
|---|---|
| `id` | stable non-empty id, unique across brushes |
| `rect` or `polygon` | convex footprint (`polygon`: 3..64 vertices; concave rings are rejected) |
| `holes` | optional array of up to 8 axis-aligned holes `[x,y,w,h]` (or objects) inside a solid footprint; holes may not overlap or touch the outer ring |
| `subtract` | optional CSG negative solid: removes this brush's Z interval from positive solids; subtract brushes cannot use tools or holes |
| `bottom`, `top` | solid height interval; `top > bottom` |
| `tool` | tool material (table below), default `solid` |
| `solid` / `carve` | optional bool override; compiler-only tools default to false |
| `sideColor` | exposed side-face color/material key |
| `floorColor` | visible top-face color when free space starts on this brush |
| `ceilingColor` | visible bottom-face color when free space ends on this brush |
| `render`, `collision`, `shadows`, `castShadow`, `acoustic` | optional policy overrides |
| `flags` | optional raw policy bit mask (advanced; overrides the booleans) |
| `visgroup` | editor layer label, preserved as metadata |

A `world` (or `bounds`) object is the free-space envelope. If omitted, the
compiler derives a bbox + 64-unit margin and emits
`SDK_WORLD_BRUSH_BOUNDS_DERIVED`; authors should always provide it.

### Tool materials

| tool | solid | render | collision | ray/shadow | acoustic | role |
|---|---|---|---|---|---|---|
| `solid` | yes | yes | yes | yes | yes | normal architecture |
| `nodraw` | yes | no | yes | yes | yes | collision/occlusion, invisible |
| `clip` | yes | no | yes | no | no | movement-only clip |
| `enemyclip` | yes | no | yes | no | no | same runtime policy as clip |
| `playerclip` | yes | no | yes | no | no | same runtime policy as clip |
| `sky` | yes | no | yes | ray yes, shadow no | no | sky/clip boundary |
| `occluder` | no | no | no | yes | no | visibility blocker marker |
| `hint` | no | - | - | - | - | compiler visibility split |
| `skip` | no | - | - | - | - | compiler-only no-op |
| `trigger` | no | - | - | - | - | brush entity volume |
| `areaportal` | no | - | - | - | - | marks generated portals on its boundary |

Policy bits are defined in `src/re2d_world.h` (`R2D_WALL_*`). `flags == 0` means
the legacy all-on default, so old maps and old baked files remain valid.

### Point and brush entities

`entities` is validated by the SDK: stable unique `id`, known `kind`, optional
finite `x/y/h`, optional `brush` reference, optional semantic `target`. Point
entities are `player_spawn`, `enemy_spawn`, `item_spawn`, `light`,
`audio_source`, `trigger`, `camera_marker`, `narrative_marker`,
`particle_emitter`. Brush entities are `door`, `lift`, `crusher`,
`moving_wall`, `trigger_volume`, `fog_volume`, `water_volume`, `areaportal`.
An entity with a `brush` must use one of the brush-entity kinds.

The compiler resolves each brush entity to its existing runtime contract and
writes a `compiler.brushEntities[]` array (also counted as
`stats.brushEntityMap`):

| entity kind | runtime field | runtime API | params |
|---|---|---|---|
| `door` | `mover` | `world.mover` | `moverType: 0` |
| `lift` | `mover` | `world.mover` | `moverType: 1` |
| `crusher` | `mover` | `world.mover` | `moverType: 2` |
| `moving_wall` | `mover` | `world.mover` | `moverType: 3` (platform) |
| `trigger`, `trigger_volume` | `trigger` | `world.trigger` | `triggerType: 0` (enter) |
| `fog_volume` | `fog` | `world.fogZone` | hook: span resolution + volume field |
| `water_volume` | `water` | `world.liquid` | hook: liquid/volume runtime API missing |
| `areaportal` | `portal` | `portal.areaPortal` | hook: nearest generated portal |

Each map entry carries the resolved brush volume (`volume: [x,y,w,h,bottom,top]`),
the brush's policy `flags`, and the authored `target`. Door/lift/crusher/moving
brush motion still uses the existing native mover timeline; trigger volumes use
the native semantic trigger cylinder. Fog/water/areaportal entries are explicit
metadata hooks, not silently wired gameplay.

## Compile pipeline

```text
.re2dmap -> parse brushes -> validate convex rings/holes/subtract
         -> refine XY grid with polygon-edge intersections
         -> sample solids, subtract CSG volumes, subtract holes
         -> free-space cells/spans -> merge equivalent cells
         -> exposed walls + tool policy -> merge / portals/openings
         -> region grid + coarse PVS -> .re2dworld
```

Run:

```bash
r2d-sdk world compile map.re2dmap --renderer --region-size 256 --output map.re2dworld
# legacy aliases:
r2d-sdk world-compile map.re2dmap --renderer --output map.re2dworld
r2d-sdk world info map.re2dmap
```

`world compile` prints a JSON report with a `stageReport`
(`load`, `compile`, `regions` in ms), `stats` (brushes, solids, tool brushes,
polygon/subtract/hole brushes, cells, spans, walls, portals, merged cells, area
portals, shadow/acoustic/occluder wall counts, regions, PVS edges, entities and
resolved brush-entity mappings) and `diagnostics`. `.re2dworld` carries an
ignored-by-runtime `"compiler"` block with the same stats, region grid,
`brushEntities[]` and entities.

## Compiler warnings

| code | meaning |
|---|---|
| `SDK_WORLD_GIANT_REGION` | one region covers a very large area |
| `SDK_WORLD_TOO_MANY_REGIONS` | more than 512 occupied regions |
| `SDK_WORLD_UNREACHABLE_REGION` | coarse PVS cannot reach some regions |
| `SDK_WORLD_UNREACHABLE_CELL` | authored portals leave some cells isolated |
| `SDK_WORLD_BAD_AREAPORTAL` | areaportal brush touches no generated edge |
| `SDK_WORLD_USELESS_HINT` | hint brush touches no generated portal |
| `SDK_WORLD_TOO_MANY_SURFACES` | compiled cell/span budget warning |
| `SDK_WORLD_MATERIAL_REPETITION` | one wall color repeats heavily |
| `SDK_WORLD_TOO_MANY_LIGHTS` | more than 64 authored dynamic lights |
| `SDK_WORLD_GIANT_SURFACE` | a rendered wall surface exceeds 250000 square units |
| `SDK_WORLD_GIANT_TRANSPARENT` | a giant render-only surface looks like a translucent boundary |
| `SDK_WORLD_SKY_LEAK` | sky-envelope map still has open cell edges (leak) |
| `SDK_WORLD_BRUSH_ENTITY` | brush entity references/kind/mapping failed |
| `SDK_WORLD_BRUSH_BOUNDS_DERIVED` | no explicit world envelope |

## Limits (honest)

* Footprints must be **convex**; concave rings are rejected
  (`SDK_WORLD_BRUSH_COMPILE`) rather than ear-clipped inside the brush compiler.
  Authoring tools may decompose concave rings before writing the map.
* Holes are axis-aligned rectangles inside a positive solid. Arbitrary polygons
  with holes and hole-in-subtract are unsupported.
* CSG is limited to axis-aligned Z subtraction of solid volumes (`subtract`).
  There is no arbitrary 3D boolean, bevel, vertex editor or Studio GUI yet.
* Polygon footprints are rasterised into the constrained runtime grid using
  refined edge/grid intersections + cell-centre sampling; a staircase boundary is
  expected, identical to how the runtime represents all cells.
* Brush entities are validated metadata with an explicit runtime mapping table.
  Door/lift/crusher/moving-wall motion and trigger volumes are consumable by the
  existing native mover/trigger APIs (smoke-tested); fog/water/areaportal need
  the hooks listed above before they affect gameplay.
* `sky` does not draw a new sky system; it marks the external boundary so the
  existing panorama/portal sky can be used (see `RE2D_SKY_BOUNDARY.md`).
* Hint brushes currently act as merge/portal barriers and are validated/reported;
  they do not add new BSP split planes in this pass.
* Sky-leak detection is an open-edge heuristic on the sky envelope, not a full
  exterior flood fill; giant-transparent classification uses render-only policy
  because the compiler has no per-pixel opacity. Warnings state only what the
  data can prove.
