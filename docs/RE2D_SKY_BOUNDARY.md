# Re2D Sky / Clip Boundary (issue #6)

Status: supported authoring contract + native wall policy. A translucent wall
with `opacity:0` is **not** the boundary contract.

## Why not translucent opacity:0

A translucent wall with opacity 0 still behaves like a wall in several paths:
surface selection/render passes, portal/occlusion checks, shadow rays and audio
rays. It also has no explicit sky semantics: the renderer does not know whether
the hole is a window, a distant boundary or a sky. Re2D therefore has an
explicit boundary policy instead of faking it with alpha.

## Wall policy flags

`R2DWorldWall.flags` (0 = legacy all-on) carries the policy:

| bit | meaning |
|---|---|
| `R2D_WALL_RENDER` | submit a drawable wall surface |
| `R2D_WALL_COLLIDE` | block movement (`r2d_world_blocked`) |
| `R2D_WALL_RAY` | block native rays (hitscan, light/shadow, audio occlusion) |
| `R2D_WALL_SHADOW` | policy bit for renderer shadow passes |
| `R2D_WALL_ACOUSTIC` | policy bit for audio occlusion |
| `R2D_WALL_SKY` | sky/clip boundary (no wall surface) |
| `R2D_WALL_OCCLUDER` | visibility blocker marker |

Query it from C:

```c
R2DWorldWallPolicy p = r2d_world_wall_policy(&world, wall_index);
if (p.sky) { /* boundary: panorama/sky portal, not a wall texture */ }
```

## Boundary policy table

| authoring | render | collision | ray/shadow | acoustic | visible geometry |
|---|---|---|---|---|---|
| `world.boundary: "sky"` | no | yes | yes | no | panorama / sky portal |
| brush `tool: "sky"` | no | yes | yes | no | panorama / sky portal |
| brush `tool: "clip"` | no | yes | no | no | none |
| brush `tool: "nodraw"` | no | yes | yes | yes | none |
| brush `tool: "occluder"` | no | no | yes | no | none |
| legacy wall (flags 0) | yes | yes | yes | yes | ordinary wall |

The compiler emits four `sky`-policy envelope walls for a brush map by default,
so the world is sealed against sky leakage without abusing transparency. A
`tool:"sky"` brush can additionally mark a collidable sky boundary around a
well, tower opening or outdoor contour.

## Using it with the existing sky system

* **Ceiling sky / sky portal**: use the existing `world.sky(...)` and
  `r2d_world_portal_set_sky()`; the portal shows the panorama and does not
  traverse into the far cell.
* **External brush contour**: author `world.boundary:"sky"` (or a `tool:"sky"`
  brush) and place the camera inside the envelope. The sky boundary is collidable
  and ray-blocking but never submitted as a drawable wall, so the renderer can
  draw the panorama behind it.
* **Distant/open world**: combine the boundary with a region grid
  (`--region-size`), coarse PVS and distant region LOD; see
  `RE2D_HUGE_WORLD.md`.

## What is not supported

* No general 3D sky renderer, no mesh skybox and no portal recursion.
* A `sky` brush does not paint the sky by itself; it defines the boundary policy.
  The panorama/sky portal/ceiling sky remains the visual source.
* GPU shadow-map construction currently consumes walls directly and does not yet
  filter `R2D_WALL_SHADOW`; the policy is exposed and the ray path already
  respects `R2D_WALL_RAY`. This is documented rather than silently assumed.
* Full acoustic occlusion filtering of `R2D_WALL_ACOUSTIC` is exposed for the
  audio pass; the native ray path follows `R2D_WALL_RAY`.

## Tests

`tests/re2d/world_tools_test.c` checks the policy bits, collision vs ray
behaviour for clip/sky/default walls, the areaportal portal marker, the baked
RDW5 round trip and legacy RDW1 compatibility. `r2d_check` runs it.
