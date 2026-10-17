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
    { "id": "door.area", "rect": [512,896,32,204], "bottom": 0, "top": 384,
      "tool": "areaportal" }
  ],
  "entities": [
    { "id": "player.start", "kind": "player_spawn", "x": 128, "y": 128, "h": 0 },
    { "id": "door.a", "kind": "door", "brush": "wall.area" }
  ]
}
```

### Brush fields

| field | meaning |
|---|---|
| `id` | stable non-empty id, unique across brushes |
| `rect` or `polygon` | rectilinear footprint (`polygon`: 3..64 axis-aligned edges) |
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
finite `x/y/h`, optional `brush` reference. Point entities are
`player_spawn`, `enemy_spawn`, `item_spawn`, `light`, `audio_source`, `trigger`,
`camera_marker`, `narrative_marker`, `particle_emitter`. Brush entities are
`door`, `lift`, `crusher`, `moving_wall`, `trigger_volume`, `fog_volume`,
`water_volume`, `areaportal`. Entities are preserved in `.re2dworld` metadata;
runtime gameplay still binds them through the SDK/game layer.

## Compile pipeline

```text
.re2dmap -> parse brushes -> validate rectilinear/simple rings
         -> subtract solid height intervals per XY partition
         -> free-space cells/spans -> merge equivalent cells
         -> exposed walls + tool policy -> portals/openings
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
(`load`, `compile`, `regions` in ms), `stats` (brushes, cells, spans, walls,
portals, merged cells, area portals, regions, PVS edges, entities) and
`diagnostics`. `.re2dworld` carries an ignored-by-runtime `"compiler"` block
with the same stats, region grid and entities.

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
| `SDK_WORLD_BRUSH_BOUNDS_DERIVED` | no explicit world envelope |

## Limits (honest)

* Footprints must be rectilinear. Slanted polygon cells are rejected
  (`SDK_WORLD_BRUSH_COMPILE`), not silently approximated.
* Holes are not supported; one brush is one solid prism.
* Boolean operations are height subtraction inside the envelope. There is no
  arbitrary CSG, vertex editor or Studio GUI yet.
* Brush entities are validated metadata; moving-brush runtime behaviour still
  uses the existing mover/portal API.
* `sky` does not draw a new sky system; it marks the external boundary so the
  existing panorama/portal sky can be used (see `RE2D_SKY_BOUNDARY.md`).
* Hint brushes currently act as merge/portal barriers and are validated/reported;
  they do not add new BSP split planes in this pass.
* Giant-transparent-surface and sky-leak heuristics are limited: the brush
  envelope is sealed by sky-policy boundary walls, and interior/exterior zoning
  is not classified. No warning is fabricated when the data cannot prove a leak.
